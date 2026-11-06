//! Declare as a CHILD of effect_reconciliation, not as a sibling of RunStore.
//! Reuses its exact checksum/intent/gate validation; no DDL, migration or dispatch.
use super::{decode_row, DispatchGateEvent, DispatchGateSnapshot, DispatchPhase, EffectJournal,
    EffectRecord, EffectState, JournalEvent, OperationOwner, ResourceClaim, EXTENSION_VERSION};
use super::super::{hash, id, json, Result, RunStore, StoreError};
use serde::Serialize;
use super::super::project_memory::{MemoryExecution, VerifiedMemoryBatch};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, sync::atomic::{AtomicBool, Ordering}, time::{Duration, Instant}};

const PAGE: usize = 16;
const MAX_PROJECTS: usize = 4096;
const MAX_ROWS_PER_TABLE: usize = 4096;
const MAX_PAYLOAD_BYTES: usize = 262_144;
const MAX_TOTAL_PAYLOAD_BYTES: usize = 16 * 1024 * 1024;
const MAX_SCAN_TIME: Duration = Duration::from_secs(2);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BarrierReason { PreparedReview, DispatchOpen, HandoffUnsettled, EffectUnknown, ManualReview }
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DurableEffectBarrier {
    pub project_id: String,
    pub operation_id: String,
    pub owner: OperationOwner,
    pub root_object_id: String,
    pub resources: Vec<ResourceClaim>,
    pub intent_digest: String,
    pub revision: i64,
    pub state: EffectState,
    pub dispatch: DispatchGateSnapshot,
    pub reason: BarrierReason,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyUnknown {
    pub project_id: String,
    pub run_id: String,
    pub record_id: String,
    pub source: &'static str,
    pub status: String,
}
/// Descriptive stamp only. Hash/data_version/total_changes do NOT establish live ownership.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotStamp {
    pub catalog_digest: String,
    #[serde(skip)]
    source_instance_digest: String,
    pub connection_data_version: i64,
    pub connection_total_changes: i64,
    pub project_count: usize,
    pub effect_rows_scanned: usize,
    pub history_rows_scanned: usize,
}
impl SnapshotStamp {
    /// Comparison descriptor only. The native fence must also retain/prove the actual
    /// physical database/writer ownership; this hash is neither a handle nor authority.
    pub fn matches_store_instance(&self, store: &RunStore) -> bool { self.source_instance_digest == source_instance_digest(store) }
}
fn source_instance_digest(store: &RunStore) -> String {
    hash(format!("{:p}|{}", store, store.root.to_string_lossy()).as_bytes())
}
/// Only this same-connection reader constructs a production scan; not deserializable.
pub struct DurableRecoverySnapshot {
    stamp: SnapshotStamp,
    effects: Vec<DurableEffectBarrier>,
    legacy: Vec<LegacyUnknown>,
    pending_native_creators:usize,
}
impl DurableRecoverySnapshot {
    pub fn stamp(&self) -> &SnapshotStamp { &self.stamp }
    pub fn effects(&self) -> &[DurableEffectBarrier] { &self.effects }
    pub fn legacy(&self) -> &[LegacyUnknown] { &self.legacy }
    pub(crate) fn pending_native_creators(&self)->usize {self.pending_native_creators}
}
/// Private borrowed witness to the complete real catalog on the SAME physical
/// connection/IMMEDIATE transaction as A. It cannot leave the callback or worker.
/// No timestamp/data_version/cached catalog/renderer object constructs this proof.
pub(crate) struct PhysicalRecoverySnapshot<'transaction> {
    snapshot: &'transaction DurableRecoverySnapshot,
    database_pin: std::sync::Arc<super::super::database_owner::NativeDatabasePin>,
    execution: MemoryExecution<'transaction>,
    current_creation:Option<std::sync::Arc<super::super::native_run_creation::NativeRunCreation>>,
    _worker: std::marker::PhantomData<std::rc::Rc<()>>,
}
impl PhysicalRecoverySnapshot<'_> {
    pub(crate) fn snapshot(&self) -> &DurableRecoverySnapshot { self.snapshot }
    pub(crate) fn database_pin(&self) -> &std::sync::Arc<super::super::database_owner::NativeDatabasePin> { &self.database_pin }
    pub(crate) fn check_execution(&self) -> Result<()> { self.execution.check() }
    pub(crate) fn is_for_creation(&self,creation:&std::sync::Arc<super::super::native_run_creation::NativeRunCreation>)->bool {
        self.current_creation.as_ref().is_some_and(|original|std::sync::Arc::ptr_eq(original,creation))
    }
}
struct Budget<'a> { start: Instant, cancelled: &'a AtomicBool, bytes: usize }
impl Budget<'_> {
    fn check(&self) -> Result<()> {
        if self.cancelled.load(Ordering::Acquire) { return Err(failure("catalogScanCancelled")); }
        if self.start.elapsed() > MAX_SCAN_TIME { return Err(failure("catalogScanExpired")); }
        Ok(())
    }
    fn payload(&mut self, row: &[super::super::sqlite::Value]) -> Result<()> {
        let text = row.get(6).ok_or_else(StoreError::corrupt)?.text()?;
        self.text(&text)
    }
    fn text(&mut self, text: &str) -> Result<()> {
        self.bytes = self.bytes.checked_add(text.len()).ok_or_else(|| failure("catalogScanCapacity"))?;
        if text.len() > MAX_PAYLOAD_BYTES || self.bytes > MAX_TOTAL_PAYLOAD_BYTES { return Err(failure("catalogScanCapacity")); }
        self.check()
    }
}
fn failure(kind: &str) -> StoreError { StoreError::new(kind, "persistent recovery catalog is incomplete; admission remains unknown") }
fn feed<T: Serialize>(digest: &mut Sha256, value: &T) -> Result<()> {
    let bytes = json(value)?;
    digest.update((bytes.len() as u64).to_le_bytes()); digest.update(bytes.as_bytes()); Ok(())
}
impl RunStore {
    /// Native original file pin for startup catalog installation, without reopen.
    pub(crate) fn pin_runtime_host_database(&self) -> Result<std::sync::Arc<super::super::database_owner::NativeDatabasePin>> {
        self.db.pin_original_database()
    }
    /// Reads the ALREADY OPEN native app-data connection. Does not open paths from rows,
    /// create an extension, call open_effect_journal, fence a ticket, or modify any row.
    /// BEGIN DEFERRED holds one consistent read snapshot across ALL projects/tables/pages.
    pub fn read_runtime_host_recovery_snapshot(&self, cancelled: &AtomicBool) -> Result<DurableRecoverySnapshot> {
        // The driver child owns the raw connection/progress callback. Its guard encloses
        // every query, transaction rollback and statement finalization, including orphans.
        self.db.with_runtime_host_scan_budget(cancelled, MAX_SCAN_TIME,
            || self.read_runtime_host_recovery_snapshot_bounded(cancelled))
    }
    fn read_runtime_host_recovery_snapshot_bounded(&self, cancelled: &AtomicBool) -> Result<DurableRecoverySnapshot> {
        self.db.execute("BEGIN DEFERRED", &[])?;
        struct ReadRollback<'a>(&'a super::super::sqlite::Db, bool);
        impl Drop for ReadRollback<'_> { fn drop(&mut self) { if self.1 { let _ = self.0.execute("ROLLBACK", &[]); } } }
        let mut rollback = ReadRollback(&self.db, true);
        let mut budget = Budget { start: Instant::now(), cancelled, bytes: 0 };
        let snapshot = self.read_runtime_host_recovery_rows(&mut budget,None)?;
        self.db.execute("COMMIT", &[])?;
        rollback.1 = false;
        budget.check()?;
        Ok(snapshot)
    }

    /// Called only by A's live callback. Reuses its exact SQL handlers/VM budget
    /// and BEGIN IMMEDIATE; a second connection or nested budget is never opened.
    pub(crate) fn with_memory_recovery_snapshot<T>(
        &self,execution:&MemoryExecution<'_>,memory:&VerifiedMemoryBatch<'_>,
        admit:impl for<'transaction> FnOnce(PhysicalRecoverySnapshot<'transaction>)->Result<T>,
    )->Result<T>{self.with_memory_recovery_snapshot_original(execution,memory,None,admit)}
    pub(crate) fn with_owned_memory_recovery_snapshot<T>(
        &self,execution:&MemoryExecution<'_>,memory:&VerifiedMemoryBatch<'_>,
        creation:&std::sync::Arc<super::super::native_run_creation::NativeRunCreation>,
        owner:&std::sync::Arc<AtomicBool>,
        admit:impl for<'transaction> FnOnce(PhysicalRecoverySnapshot<'transaction>)->Result<T>,
    )->Result<T>{self.with_memory_recovery_snapshot_original(execution,memory,Some((creation,owner)),admit)}
    /// A task with no selected project-memory records still requires its original
    /// native running row and a complete physical recovery snapshot at admission.
    pub(crate) fn with_owned_task_recovery_snapshot<T>(
        &self, execution: &MemoryExecution<'_>,
        creation: &std::sync::Arc<super::super::native_run_creation::NativeRunCreation>,
        owner: &std::sync::Arc<AtomicBool>,
        admit: impl for<'transaction> FnOnce(PhysicalRecoverySnapshot<'transaction>) -> Result<T>,
    ) -> Result<T> {
        let result = self.db.with_project_memory_budget(execution, true, || {
            execution.check()?;
            creation.check_original_owner(owner)?;
            self.db.require_project_memory_write_transaction()?;
            let database_pin = self.db.pin_original_database()?;
            let row = self.run(creation.project_id(), creation.run_id())?;
            creation.matches_original_row(&database_pin, &row)?;
            let mut budget = Budget { start: Instant::now(), cancelled: execution.cancelled, bytes: 0 };
            let snapshot = self.read_runtime_host_recovery_rows(&mut budget, Some(creation))?;
            if !snapshot.stamp().matches_store_instance(self) { return Err(StoreError::corrupt()); }
            self.db.require_project_memory_write_transaction()?;
            creation.check_original_owner(owner)?;
            execution.check()?;
            let pending = admit(PhysicalRecoverySnapshot { snapshot: &snapshot, database_pin,
                execution: *execution, current_creation: Some(creation.clone()), _worker: std::marker::PhantomData })?;
            creation.check_original_owner(owner)?;
            execution.check()?;
            Ok(pending)
        })?;
        execution.check()?;
        self.db.check_owner()?;
        Ok(result)
    }
    fn with_memory_recovery_snapshot_original<T>(
        &self,execution:&MemoryExecution<'_>,memory:&VerifiedMemoryBatch<'_>,
        original:Option<(&std::sync::Arc<super::super::native_run_creation::NativeRunCreation>,&std::sync::Arc<AtomicBool>)>,
        admit:impl for<'transaction> FnOnce(PhysicalRecoverySnapshot<'transaction>)->Result<T>,
    )->Result<T>{
        memory.check_execution()?;
        execution.check()?;
        self.db.require_project_memory_write_transaction()?;
        let database_pin = self.db.pin_original_database()?;
        if let Some((creation,owner))=original {
            creation.check_original_owner(owner)?;
            // Exact original native row/revision on this SAME physical transaction.
            let row=self.run(memory.project_id(),creation.run_id())?;
            creation.matches_original_row(&database_pin,&row)?;
        }
        let mut budget = Budget { start: Instant::now(), cancelled: execution.cancelled, bytes: 0 };
        let snapshot = self.read_runtime_host_recovery_rows(&mut budget,original.map(|(creation,_)|creation))?;
        self.db.require_project_memory_write_transaction()?;
        if !snapshot.stamp().matches_store_instance(self) { return Err(StoreError::corrupt()); }
        memory.check_execution()?;
        execution.check()?;
        let result = admit(PhysicalRecoverySnapshot {
            snapshot: &snapshot, database_pin, execution: *execution, current_creation:original.map(|(creation,_)|creation.clone()), _worker: std::marker::PhantomData,
        });
        memory.check_execution()?;
        execution.check()?;
        result
    }

    /// ONE implementation for standalone startup scans and live physical admission.
    /// Caller owns both the native SQL budget and the actual transaction.
    fn read_runtime_host_recovery_rows(&self, budget: &mut Budget<'_>,current:Option<&std::sync::Arc<super::super::native_run_creation::NativeRunCreation>>) -> Result<DurableRecoverySnapshot> {
        budget.check()?;
        if self.db.query("PRAGMA user_version", &[])?[0][0].int()? != super::super::SCHEMA_VERSION { return Err(failure("catalogBaseSchemaUnsupported")); }
        let names = self.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('effect_journal_meta','effect_intents','effect_journal_events','effect_dispatch_gates','effect_dispatch_events') ORDER BY name", &[])?;
        if names.len() != 5 { return Err(failure("catalogJournalAbsentOrPartial")); }
        let versions = self.db.query("SELECT CASE WHEN typeof(singleton)='integer' THEN singleton END,CASE WHEN typeof(version)='integer' THEN version END FROM effect_journal_meta LIMIT 2", &[])?;
        if versions.len() != 1 || versions[0][0].int()? != 1 { return Err(failure("catalogJournalMetaInvalid")); }
        if versions[0][1].int()? != EXTENSION_VERSION { return Err(failure("catalogJournalSchemaUnsupported")); }
        let projects = self.db.query("SELECT CASE WHEN length(CAST(id AS BLOB))<=256 THEN id END FROM projects ORDER BY id LIMIT 4097", &[])?;
        if projects.len() > MAX_PROJECTS { return Err(failure("catalogScanCapacity")); }
        let mut project_ids = HashSet::new();
        let mut digest = Sha256::new();
        for row in projects { let project = row[0].text()?; id(&project)?; feed(&mut digest, &project)?; project_ids.insert(project); }
        // A read-only borrowed view: no nonce/ticket/context is issued or returned.
        let journal = EffectJournal { store: self, instance_nonce: String::new(), prepared_contexts: Default::default() };
        // Bound ALL auxiliary rows before tail lookups or anti-joins. LIMIT on the
        // outer orphan query alone does not bound a no-orphan full-table scan.
        bounded_auxiliary_tables(self, budget)?;
        let mut effects = Vec::new();
        let mut effect_count = 0;
        loop {
            budget.check()?;
            // CASE bounds data crossing the SQLite FFI, including corrupt oversized payloads.
            let rows = self.db.query("SELECT CASE WHEN length(CAST(project_id AS BLOB))<=256 THEN project_id END,CASE WHEN length(CAST(operation_id AS BLOB))<=256 THEN operation_id END,CASE WHEN length(CAST(run_id AS BLOB))<=256 THEN run_id END,CASE WHEN length(CAST(idempotency_key AS BLOB))<=64 THEN idempotency_key END,CASE WHEN length(CAST(intent_digest AS BLOB))<=64 THEN intent_digest END,CASE WHEN typeof(revision)='integer' THEN revision END,CASE WHEN length(CAST(payload AS BLOB))<=262144 THEN payload END,CASE WHEN length(CAST(payload_sha256 AS BLOB))<=64 THEN payload_sha256 END FROM effect_intents ORDER BY project_id,operation_id LIMIT ? OFFSET ?", &[(PAGE as i64).into(), (effect_count as i64).into()])?;
            let count = rows.len();
            if effect_count + count > MAX_ROWS_PER_TABLE { return Err(failure("catalogScanCapacity")); }
            for row in rows {
                budget.payload(&row)?;
                let record = decode_row(&row)?;
                if !project_ids.contains(&record.intent.key.project_id) { return Err(StoreError::corrupt()); }
                bounded_gate_preflight(self, &record)?;
                let gate = journal.gate_for(&record)?.snapshot;
                validate_tail(self, &record, &gate, budget)?;
                feed(&mut digest, &(&record.intent_digest, record.revision, &record.state, &gate, hash(row[6].text()?.as_bytes())))?;
                if let Some(reason) = barrier_reason(&record, &gate)? {
                    effects.push(DurableEffectBarrier { project_id: record.intent.key.project_id.clone(), operation_id: record.intent.key.operation_id.clone(),
                        owner: record.intent.owner.clone(), root_object_id: record.intent.root_object_id.clone(), resources: record.intent.resources.clone(),
                        intent_digest: record.intent_digest, revision: record.revision, state: record.state, dispatch: gate, reason });
                }
                effect_count += 1;
            }
            if count < PAGE { break; }
        }
        // An orphan gate/event cannot be mistaken for an empty valid catalog.
        for sql in [
            "SELECT 1 FROM effect_dispatch_gates g LEFT JOIN effect_intents i ON i.project_id=g.project_id AND i.operation_id=g.operation_id WHERE i.operation_id IS NULL LIMIT 1",
            "SELECT 1 FROM effect_dispatch_events e LEFT JOIN effect_dispatch_gates g ON g.project_id=e.project_id AND g.operation_id=e.operation_id WHERE g.operation_id IS NULL LIMIT 1",
            "SELECT 1 FROM effect_journal_events e LEFT JOIN effect_intents i ON i.project_id=e.project_id AND i.operation_id=e.operation_id WHERE i.operation_id IS NULL LIMIT 1",
        ] { budget.check()?; if !self.db.query(sql, &[])?.is_empty() { return Err(StoreError::corrupt()); } }
        let mut legacy = Vec::new();
        let mut pending_native_creators=0usize;
        let native_database=match self.db.pin_original_database() {
            Ok(pin)=>Some(pin),
            Err(error) if cfg!(test)&&error.kind=="physicalStoreRequired"=>None,
            Err(error)=>return Err(error),
        };
        let mut history_count = 0;
        for source in ["runs", "tool_calls", "steps", "changesets"] {
            let mut offset = 0;
            loop {
                budget.check()?;
                let sql = match source {
                    "runs" => "SELECT CASE WHEN length(CAST(project_id AS BLOB))<=256 THEN project_id END,CASE WHEN length(CAST(id AS BLOB))<=256 THEN id END,CASE WHEN length(CAST(id AS BLOB))<=256 THEN id END,CASE WHEN length(CAST(status AS BLOB))<=32 THEN status END FROM runs ORDER BY project_id,id LIMIT ? OFFSET ?",
                    "tool_calls" => "SELECT CASE WHEN length(CAST(project_id AS BLOB))<=256 THEN project_id END,CASE WHEN length(CAST(run_id AS BLOB))<=256 THEN run_id END,CASE WHEN length(CAST(id AS BLOB))<=256 THEN id END,CASE WHEN length(CAST(payload AS BLOB))<=262144 THEN CASE WHEN json_valid(payload) THEN CASE WHEN length(CAST(json_extract(payload,'$.status') AS BLOB))<=32 THEN json_extract(payload,'$.status') END END END FROM tool_calls ORDER BY project_id,run_id,id LIMIT ? OFFSET ?",
                    "steps" => "SELECT CASE WHEN length(CAST(project_id AS BLOB))<=256 THEN project_id END,CASE WHEN length(CAST(run_id AS BLOB))<=256 THEN run_id END,CASE WHEN length(CAST(id AS BLOB))<=256 THEN id END,CASE WHEN length(CAST(payload AS BLOB))<=262144 THEN CASE WHEN json_valid(payload) THEN CASE WHEN length(CAST(json_extract(payload,'$.status') AS BLOB))<=32 THEN json_extract(payload,'$.status') END END END FROM steps ORDER BY project_id,run_id,id LIMIT ? OFFSET ?",
                    _ => "SELECT CASE WHEN length(CAST(project_id AS BLOB))<=256 THEN project_id END,CASE WHEN length(CAST(run_id AS BLOB))<=256 THEN run_id END,CASE WHEN length(CAST(id AS BLOB))<=256 THEN id END,CASE WHEN length(CAST(payload AS BLOB))<=262144 THEN CASE WHEN json_valid(payload) THEN CASE WHEN length(CAST(json_extract(payload,'$.status') AS BLOB))<=32 THEN json_extract(payload,'$.status') END END END FROM changesets ORDER BY project_id,run_id,id LIMIT ? OFFSET ?",
                };
                let rows = self.db.query(sql, &[(PAGE as i64).into(), (offset as i64).into()])?;
                let count = rows.len();
                if offset + count > MAX_ROWS_PER_TABLE { return Err(failure("catalogScanCapacity")); }
                for row in rows {
                    budget.check()?;
                    let project_id = row[0].text()?; let run_id = row[1].text()?; let record_id = row[2].text()?; let status = row[3].text()?;
                    id(&project_id)?; id(&run_id)?; id(&record_id)?;
                    if !project_ids.contains(&project_id) { return Err(StoreError::corrupt()); }
                    let valid = if source == "runs" { ["created", "running", "paused", "succeeded", "failed", "cancelled", "needsReconciliation"].contains(&status.as_str()) }
                        else { ["prepared", "inFlight", "succeeded", "failed", "unknown", "skipped"].contains(&status.as_str()) };
                    if !valid { return Err(StoreError::corrupt()); }
                    feed(&mut digest, &(source, &project_id, &run_id, &record_id, &status))?;
                    let unknown = if source == "runs" { status == "running" || status == "needsReconciliation" } else { status == "inFlight" || status == "unknown" };
                    if unknown {
                        let mut retain=true;
                        if source=="runs"&&status=="running" {
                            if let Some(database)=&native_database {
                                let row=self.run(&project_id,&run_id)?;
                                use super::super::native_run_creation::{classify_running_native_row,NativeRunningClassification};
                                match classify_running_native_row(database,&row,current) {
                                    NativeRunningClassification::Owned=>retain=false,
                                    NativeRunningClassification::Pending=>{retain=false;pending_native_creators+=1;},
                                    NativeRunningClassification::Unknown=>{},
                                }
                            }
                        }
                        if retain {legacy.push(LegacyUnknown { project_id, run_id, record_id, source, status });}
                    }
                    history_count += 1;
                }
                offset += count;
                if count < PAGE { break; }
            }
        }
        budget.check()?;
        let data_version = self.db.query("PRAGMA data_version", &[])?[0][0].int()?;
        let total_changes = self.db.query("SELECT total_changes()", &[])?[0][0].int()?;
        budget.check()?;
        Ok(DurableRecoverySnapshot { stamp: SnapshotStamp { catalog_digest: format!("{:x}", digest.finalize()), source_instance_digest: source_instance_digest(self), connection_data_version: data_version,
            connection_total_changes: total_changes, project_count: project_ids.len(), effect_rows_scanned: effect_count, history_rows_scanned: history_count }, effects, legacy, pending_native_creators })
    }
}
fn bounded_auxiliary_tables(store: &RunStore, budget: &Budget<'_>) -> Result<()> {
    // No ORDER BY/COUNT of an unbounded table: each subquery stops after cap + 1
    // identities. The connection's VM/deadline handler also covers missing indices.
    for sql in [
        "SELECT count(*) FROM (SELECT 1 FROM effect_dispatch_gates LIMIT ?)",
        "SELECT count(*) FROM (SELECT 1 FROM effect_dispatch_events LIMIT ?)",
        "SELECT count(*) FROM (SELECT 1 FROM effect_journal_events LIMIT ?)",
    ] {
        budget.check()?;
        let rows = store.db.query(sql, &[((MAX_ROWS_PER_TABLE + 1) as i64).into()])?;
        if rows[0][0].int()? > MAX_ROWS_PER_TABLE as i64 { return Err(failure("catalogScanCapacity")); }
        budget.check()?;
    }
    Ok(())
}
fn bounded_gate_preflight(store: &RunStore, record: &EffectRecord) -> Result<()> {
    let rows = store.db.query("SELECT CASE WHEN length(CAST(intent_digest AS BLOB))<=64 THEN intent_digest END,CASE WHEN length(CAST(phase AS BLOB))<=32 THEN phase END,CASE WHEN typeof(epoch)='integer' THEN epoch END,CASE WHEN claim_id IS NULL OR length(CAST(claim_id AS BLOB))<=64 THEN 1 ELSE 0 END FROM effect_dispatch_gates WHERE project_id=? AND operation_id=? LIMIT 2", &[record.intent.key.project_id.as_str().into(), record.intent.key.operation_id.as_str().into()])?;
    if rows.len() != 1 { return Err(StoreError::corrupt()); }
    rows[0][0].text()?; rows[0][1].text()?; rows[0][2].int()?;
    if rows[0][3].int()? != 1 { return Err(StoreError::corrupt()); }
    Ok(())
}
fn validate_tail(store: &RunStore, record: &EffectRecord, gate: &DispatchGateSnapshot, budget: &mut Budget<'_>) -> Result<()> {
    let params = [record.intent.key.project_id.as_str().into(), record.intent.key.operation_id.as_str().into()];
    let rows = store.db.query("SELECT revision,CASE WHEN length(CAST(payload AS BLOB))<=262144 THEN payload END FROM effect_journal_events WHERE project_id=? AND operation_id=? ORDER BY revision DESC LIMIT 1", &params)?;
    let row = rows.first().ok_or_else(StoreError::corrupt)?;
    budget.text(&row[1].text()?)?;
    let event: JournalEvent = super::super::decode(&row[1])?;
    if row[0].int()? != record.revision || event.record != *record || event.kind.len() > 128 { return Err(StoreError::corrupt()); }
    let rows = store.db.query("SELECT epoch,CASE WHEN length(CAST(payload AS BLOB))<=1024 THEN payload END FROM effect_dispatch_events WHERE project_id=? AND operation_id=? ORDER BY epoch DESC LIMIT 1", &params)?;
    let row = rows.first().ok_or_else(StoreError::corrupt)?;
    budget.text(&row[1].text()?)?;
    let event: DispatchGateEvent = super::super::decode(&row[1])?;
    if row[0].int()? != gate.epoch || event.gate != *gate || event.kind.len() > 128 { return Err(StoreError::corrupt()); }
    Ok(())
}
fn barrier_reason(record: &EffectRecord, gate: &DispatchGateSnapshot) -> Result<Option<BarrierReason>> {
    if gate.phase == DispatchPhase::InCallback { return Ok(Some(BarrierReason::HandoffUnsettled)); }
    if matches!(gate.phase, DispatchPhase::Prepared | DispatchPhase::Open) {
        if matches!(record.state, EffectState::VerifiedCompleted | EffectState::VerifiedNotOccurred) { return Err(StoreError::corrupt()); }
        return Ok(Some(if gate.phase == DispatchPhase::Open { BarrierReason::DispatchOpen } else { BarrierReason::PreparedReview }));
    }
    if record.manual_review_required { return Ok(Some(BarrierReason::ManualReview)); }
    if record.blocks_conflicting_admission() { return Ok(Some(BarrierReason::EffectUnknown)); }
    if record.state == EffectState::Prepared { return Ok(Some(BarrierReason::PreparedReview)); }
    Ok(None)
}



#[cfg(test)]
mod tests {
    use super::*;
    use super::super::super::{schema, sqlite::Db, StoreOptions};
    use std::path::{Path, PathBuf};

    fn store() -> RunStore {
        let db = Db::open(Path::new(":memory:")).unwrap();
        schema::migrate(&db).unwrap();
        let store = RunStore { db, root: PathBuf::from("G:/Synthetic/not-opened"), options: StoreOptions::default() };
        // Deliberately synthetic rows only; no filesystem/project path is opened.
        store.db.execute("INSERT INTO projects(id,root,label,created_at) VALUES('p','G:/Synthetic/not-opened','synthetic',1)", &[]).unwrap();
        store.db.execute("INSERT INTO sessions(project_id,id,title,created_at,origin) VALUES('p','s','synthetic',1,'native')", &[]).unwrap();
        store.db.execute("INSERT INTO runs(project_id,id,session_id,goal,status,created_at,updated_at) VALUES('p','r','s','synthetic','succeeded',1,1)", &[]).unwrap();
        drop(store.open_effect_journal().unwrap());
        store
    }
    fn step(store: &RunStore, key: &str, status: &str) {
        let payload = serde_json::json!({ "status": status }).to_string();
        store.db.execute("INSERT INTO steps(project_id,run_id,id,payload) VALUES('p','r',?,?)",
            &[key.into(), payload.into()]).unwrap();
    }
    fn assert_no_read_transaction(store: &RunStore) {
        store.db.execute("BEGIN DEFERRED", &[]).unwrap();
        store.db.execute("ROLLBACK", &[]).unwrap();
        assert_eq!(store.db.query("PRAGMA busy_timeout", &[]).unwrap()[0][0].int().unwrap(), 5000);
    }
    #[test]
    fn legacy_steps_across_page_boundary_keep_both_unknown_statuses() {
        let store = store();
        for index in 0..15 { step(&store, &format!("step-{index:02}"), "succeeded"); }
        step(&store, "step-15", "inFlight");
        step(&store, "step-16", "unknown");
        let snapshot = store.read_runtime_host_recovery_snapshot(&AtomicBool::new(false)).unwrap();
        assert_eq!(snapshot.stamp().history_rows_scanned, 18);
        assert_eq!(snapshot.legacy().len(), 2);
        assert!(snapshot.legacy().iter().all(|item| item.source == "steps" && item.project_id == "p" && item.run_id == "r"));
        assert_eq!(snapshot.legacy()[0].status, "inFlight");
        assert_eq!(snapshot.legacy()[1].status, "unknown");
        assert_no_read_transaction(&store);
    }
    #[test]
    fn invalid_legacy_step_status_rejects_the_snapshot() {
        let store = store();
        step(&store, "bad-step", "unrecognized");
        let error = store.read_runtime_host_recovery_snapshot(&AtomicBool::new(false)).err().unwrap();
        assert_eq!(error.kind, "corrupt");
        assert_no_read_transaction(&store);
    }
    #[test]
    fn auxiliary_table_capacity_is_checked_before_orphan_queries() {
        for insert in [
            "INSERT INTO effect_dispatch_gates(project_id,operation_id,intent_digest,phase,epoch) SELECT 'p',printf('op-%05d',x),'digest','closed',0 FROM n",
            "INSERT INTO effect_dispatch_events(project_id,operation_id,epoch,payload) SELECT 'p',printf('op-%05d',x),0,'{}' FROM n",
            "INSERT INTO effect_journal_events(project_id,operation_id,revision,payload) SELECT 'p',printf('op-%05d',x),1,'{}' FROM n",
        ] {
            let store = store();
            // Intentionally construct orphan/capacity corruption in this in-memory fixture.
            store.db.execute("PRAGMA foreign_keys=OFF", &[]).unwrap();
            let sql = format!("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<4097) {insert}");
            store.db.execute(&sql, &[]).unwrap();
            let error = store.read_runtime_host_recovery_snapshot(&AtomicBool::new(false)).err().unwrap();
            assert_eq!(error.kind, "catalogScanCapacity");
            assert_no_read_transaction(&store);
        }
    }
    #[test]
    fn cancelled_scan_returns_no_snapshot_and_leaves_connection_reusable() {
        let store = store();
        let error = store.read_runtime_host_recovery_snapshot(&AtomicBool::new(true)).err().unwrap();
        assert_eq!(error.kind, "catalogScanCancelled");
        assert_no_read_transaction(&store);
    }
}
#[cfg(test)]
mod physical_memory_tests {
    use super::*;
    use super::super::super::{project_memory::{
        MemoryContent, MemoryOrigin, MemoryMutation, MemoryDispatchScope, MemoryDispatchSelection,
    }, sqlite::Db};
    use std::path::PathBuf;

    fn memory_store(journal: bool) -> RunStore {
        let root = PathBuf::from(r"E:\Codex\UAgent\2026-10-29\tmp\physical-memory-catalog-tests")
            .join(format!("{}-{}",std::process::id(),std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let store = RunStore::open(&root).unwrap();
        seed(&store, journal);
        store
    }
    fn seed(store: &RunStore, journal: bool) {
        store.db.execute("INSERT INTO projects(id,root,label,created_at) VALUES('p','G:/Synthetic/memory-recovery','synthetic',1)", &[]).unwrap();
        if journal { drop(store.open_effect_journal().unwrap()); }
        let flag = AtomicBool::new(false);
        let execution = MemoryExecution::new(&flag, Instant::now() + Duration::from_secs(2));
        store.create_project_memory(&execution,"p","m",MemoryContent {
            kind:"decision".into(), body:"an exact synthetic decision".into(), source_refs:vec![],
            share_paths:vec![String::new()], priority:"normal".into(), visibility:"project".into(),
            origin:MemoryOrigin{kind:"user".into(),session_id:None,message_id:None}, read_at:1,
        }).unwrap();
        store.update_project_memory(&execution,"p","m",1,MemoryMutation::Confirm,2).unwrap();
    }
    fn verify<T>(store: &RunStore, flag: &AtomicBool,
        work: impl for<'m> FnOnce(&MemoryExecution<'_>, VerifiedMemoryBatch<'m>) -> Result<T>
    ) -> Result<T> {
        let execution = MemoryExecution::new(flag, Instant::now() + Duration::from_secs(2));
        let paths = vec![String::new()];
        let scope = MemoryDispatchScope {project_id:"p",read_prefixes:&paths,share_prefixes:&paths,max_context_bytes:24_576};
        let rows = store.project_memory_dispatch_snapshot(&execution,&scope,&[MemoryDispatchSelection{id:"m",revision:2}])?;
        store.with_verified_project_memory_batch(&execution,&scope,&rows,|memory|work(&execution,memory))
    }
    #[test]
    fn complete_scan_and_memory_rows_use_one_live_immediate_transaction() {
        let store = memory_store(true);
        let flag = AtomicBool::new(false);
        let count = verify(&store,&flag,|execution,memory| {
            store.with_memory_recovery_snapshot(execution,&memory,|physical| {
                physical.check_execution()?;
                assert!(physical.snapshot().stamp().matches_store_instance(&store));
                assert!(physical.snapshot().effects().is_empty() && physical.snapshot().legacy().is_empty());
                // A nested SQL budget is refused: the existing handlers are still owned by A.
                assert!(store.read_runtime_host_recovery_snapshot(&flag).is_err());
                Ok(physical.snapshot().stamp().project_count)
            })
        }).unwrap();
        assert_eq!(count,1);
        store.db.execute("BEGIN IMMEDIATE",&[]).unwrap();
        store.db.execute("ROLLBACK",&[]).unwrap();
    }
    #[test]
    fn missing_journal_never_calls_physical_admission() {
        let store = memory_store(false);
        let called = std::cell::Cell::new(false);
        let error = verify(&store,&AtomicBool::new(false),|execution,memory| {
            store.with_memory_recovery_snapshot(execution,&memory,|_| {called.set(true); Ok(())})
        }).unwrap_err();
        assert_eq!(error.kind,"catalogJournalAbsentOrPartial");
        assert!(!called.get());
    }
    #[test]
    fn cancellation_inside_physical_callback_cannot_export_success() {
        let store = memory_store(true);
        let flag = AtomicBool::new(false);
        let error = verify(&store,&flag,|execution,memory| {
            store.with_memory_recovery_snapshot(execution,&memory,|physical| {
                physical.check_execution()?;
                flag.store(true,Ordering::Release);
                Ok(())
            })
        }).unwrap_err();
        assert_eq!(error.kind,"projectMemoryCancelled");
    }
    #[test]
    fn a_second_real_connection_cannot_write_until_physical_callback_returns() {
        let root = PathBuf::from(r"E:\Codex\UAgent\2026-10-29\tmp\physical-memory-sql-tests")
            .join(format!("{}-{}",std::process::id(),std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let store = RunStore::open(&root).unwrap();
        seed(&store,true);
        let other = Db::open(&root.join("runs.sqlite3")).unwrap();
        other.execute("PRAGMA busy_timeout=0",&[]).unwrap();
        verify(&store,&AtomicBool::new(false),|execution,memory| {
            store.with_memory_recovery_snapshot(execution,&memory,|_| {
                assert!(other.execute("BEGIN IMMEDIATE",&[]).is_err());
                Ok(())
            })
        }).unwrap();
        other.execute("BEGIN IMMEDIATE",&[]).unwrap();
        other.execute("ROLLBACK",&[]).unwrap();
        // Retain this isolated fixture; no file/data deletion.
    }
}

/// Borrowed only inside dispatch_once_admitted's IMMEDIATE claim transaction.
/// Separate from memory admission; never constructed from a renderer or cached scan.
pub(crate) struct OperationRecoverySnapshot<'a> {
    pub(super) snapshot: DurableRecoverySnapshot,
    pub(super) database_pin: std::sync::Arc<super::super::database_owner::NativeDatabasePin>,
    pub(super) record: &'a EffectRecord,
    pub(super) cancelled: &'a AtomicBool,
    pub(super) deadline: Instant,
}
impl OperationRecoverySnapshot<'_> {
    pub(crate) fn snapshot(&self)->&DurableRecoverySnapshot { &self.snapshot }
    pub(crate) fn database_pin(&self)->&std::sync::Arc<super::super::database_owner::NativeDatabasePin>{&self.database_pin}
    pub(crate) fn record(&self)->&EffectRecord{self.record}
    pub(crate) fn check(&self)->Result<()> {
        if self.cancelled.load(Ordering::Acquire)||Instant::now()>=self.deadline {return Err(failure("operationAdmissionRevoked"));}
        Ok(())
    }
}
impl EffectJournal<'_> {
    /// Owns the real transaction/claim; the physical witness cannot escape this callback.
    pub(crate) fn dispatch_once_with_operation_snapshot(
        &self, context:&super::CurrentRun<'_>,ticket:&mut super::DispatchTicket,
        cancelled:&AtomicBool,deadline:Instant,
        admit:impl for<'a> FnOnce(OperationRecoverySnapshot<'a>)->Result<()>,
        send:impl FnOnce(&super::EffectIntent),
    )->Result<()> {
        self.dispatch_once_admitted(context,ticket,|store,record|{
            let remaining=deadline.checked_duration_since(Instant::now()).ok_or_else(||failure("operationAdmissionRevoked"))?;
            store.db.with_runtime_host_scan_budget(cancelled,remaining.min(MAX_SCAN_TIME),||{
                let database_pin=store.db.pin_original_database()?;
                let mut budget=Budget{start:Instant::now(),cancelled,bytes:0};
                let snapshot=store.read_runtime_host_recovery_rows(&mut budget,None)?;
                // The exact current effect must be present with the freshly claimed gate.
                let own=snapshot.effects().iter().find(|b|b.project_id==record.intent.key.project_id&&b.operation_id==record.intent.key.operation_id)
                    .ok_or_else(||failure("operationClaimMissing"))?;
                if own.intent_digest!=record.intent_digest||own.owner!=record.intent.owner||own.revision!=record.revision
                    ||own.dispatch.phase!=DispatchPhase::InCallback {return Err(failure("operationClaimChanged"));}
                let proof=OperationRecoverySnapshot{snapshot,database_pin,record,cancelled,deadline};
                proof.check()?;
                admit(proof)
            })
        },send)
    }
}

impl EffectJournal<'_>{
    pub(crate) fn claim_once_with_operation_snapshot(
        &self,context:&super::CurrentRun<'_>,ticket:&mut super::DispatchTicket,cancelled:&AtomicBool,deadline:Instant,
        admit:impl for<'a> FnOnce(OperationRecoverySnapshot<'a>)->Result<()>,
    )->Result<super::OwnedOperationHandoff>{
        self.claim_owned_operation(context,ticket,|store,record|{
            let remaining=deadline.checked_duration_since(Instant::now()).ok_or_else(||failure("operationAdmissionRevoked"))?;
            store.db.with_runtime_host_scan_budget(cancelled,remaining.min(MAX_SCAN_TIME),||{
                let database_pin=store.db.pin_original_database()?;
                let mut budget=Budget{start:Instant::now(),cancelled,bytes:0};
                let snapshot=store.read_runtime_host_recovery_rows(&mut budget,None)?;
                // The exact current effect must be present with the freshly claimed gate.
                let own=snapshot.effects().iter().find(|b|b.project_id==record.intent.key.project_id&&b.operation_id==record.intent.key.operation_id)
                    .ok_or_else(||failure("operationClaimMissing"))?;
                if own.intent_digest!=record.intent_digest||own.owner!=record.intent.owner||own.revision!=record.revision
                    ||own.dispatch.phase!=DispatchPhase::InCallback {return Err(failure("operationClaimChanged"));}
                let proof=OperationRecoverySnapshot{snapshot,database_pin,record,cancelled,deadline};
                proof.check()?;
                admit(proof)
            })
        })
    }
}

#[cfg(test)]
pub(crate) fn inject_operation_claim_commit_failure(store:&RunStore){
    store.db.execute("CREATE TABLE ue_gate_parent(id INTEGER PRIMARY KEY)",&[]).unwrap();
    store.db.execute("CREATE TABLE ue_gate_child(id INTEGER PRIMARY KEY,parent INTEGER REFERENCES ue_gate_parent(id) DEFERRABLE INITIALLY DEFERRED)",&[]).unwrap();
    store.db.execute("CREATE TRIGGER ue_gate_commit_failure AFTER UPDATE ON effect_dispatch_gates WHEN NEW.phase='inCallback' BEGIN INSERT INTO ue_gate_child(id,parent) VALUES(1,999); END",&[]).unwrap();
}
