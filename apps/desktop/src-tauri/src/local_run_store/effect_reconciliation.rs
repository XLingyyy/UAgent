//! Opt-in T18 extension of RunStore. No IPC, executor, credential or permission is installed.
//! This child module reuses its parent's connection, FULL/DELETE journal and transactions.
#[path = "runtime_host_catalog_reader.rs"]
pub(crate) mod runtime_host_catalog_reader;

use super::{hash, id, json, timestamp, valid_hash, Result, RunStore, StoreError};
use crate::trusted_root_handle::TrustedRootHandle;
use serde::{Deserialize, Serialize};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    time::{Duration, Instant},
};

const EXTENSION_VERSION: i64 = 2;
const MAX_TARGETS: usize = 128;
const MAX_RESOURCES: usize = 16;
const FRESH_OBSERVATION_TTL: Duration = Duration::from_secs(5);

macro_rules! dto {
    ($name:ident { $($field:ident : $ty:ty),* $(,)? }) => {
        #[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all="camelCase", deny_unknown_fields)]
        pub struct $name { $(pub $field: $ty),* }
    }
}
macro_rules! tags {
    ($name:ident { $($variant:ident),* $(,)? }) => {
        #[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all="camelCase")]
        pub enum $name { $($variant),* }
    }
}
dto!(EffectKey {
    project_id: String,
    operation_id: String
});
// T19 QueueOwner fields, plus an exact native execution owner. All are descriptors.
dto!(OperationOwner {
    scope_id: String,
    run_id: String,
    project_id: String,
    root_ref: String,
    conversation_id: String,
    provider_id: String,
    model_id: String,
    step_id: String,
    execution_id: String,
    host_generation: String
});
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceKind {
    UeEditor,
    Ubt,
    FileWrite,
}
dto!(ResourceClaim {
    kind: ResourceKind,
    key: String
});
dto!(AdapterIdentity {
    id: String,
    version: u32
});
tags!(TargetKind {
    File,
    UePackage,
    UeWorld,
    NativeReceipt
});
// Read-only locators; never execution arguments. Hash equality alone is not ownership proof.
dto!(EffectTarget {
    kind: TargetKind, locator: String,
    before_digest: Option<String>, after_digest: Option<String>
});
dto!(EffectIntent {
    key: EffectKey, owner: OperationOwner, root_object_id: String,
    adapter: AdapterIdentity, idempotency_key: String,
    approved_plan_digest: String, plan_summary: String,
    targets: Vec<EffectTarget>, resources: Vec<ResourceClaim>, created_at: i64
});
impl EffectIntent {
    pub fn digest(&self) -> Result<String> {
        Ok(hash(json(self)?.as_bytes()))
    }
    pub fn query_scope_digest(&self) -> Result<String> {
        Ok(hash(json(&(&self.adapter, &self.targets))?.as_bytes()))
    }
    fn validate(&self) -> Result<()> {
        id(&self.key.project_id)?;
        id(&self.key.operation_id)?;
        owner_valid(&self.owner)?;
        if self.owner.project_id != self.key.project_id {
            return Err(invalid("intent project/owner mismatch"));
        }
        root_key(&self.root_object_id)?;
        short(&self.adapter.id, 128)?;
        if self.adapter.version == 0
            || !valid_hash(&self.idempotency_key)
            || !valid_hash(&self.approved_plan_digest)
        {
            return Err(invalid(
                "invalid adapter version or plan/idempotency digest",
            ));
        }
        short(&self.plan_summary, 512)?;
        timestamp(self.created_at)?;
        if self.targets.is_empty()
            || self.targets.len() > MAX_TARGETS
            || self.resources.is_empty()
            || self.resources.len() > MAX_RESOURCES
        {
            return Err(invalid("effect target/resource count out of range"));
        }
        let mut targets = std::collections::HashSet::new();
        for t in &self.targets {
            short(&t.locator, 1024)?;
            match t.kind {
                TargetKind::File => {
                    // A spelling accepted here still needs a fresh native scoped reader to resolve it.
                    crate::trusted_root_handle::ReadRule::exact_file(&t.locator)
                        .map_err(|_| invalid("invalid relative file locator"))?;
                    if t.locator.contains('\\') {
                        return Err(invalid("file locators use canonical slash spelling"));
                    }
                }
                TargetKind::UePackage | TargetKind::UeWorld => {
                    if !t.locator.starts_with("/Game/")
                        || t.locator.split('/').skip(1).any(|s| {
                            s.is_empty()
                                || !s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
                        })
                    {
                        return Err(invalid("invalid exact /Game package locator"));
                    }
                }
                TargetKind::NativeReceipt => {
                    id(&t.locator)?;
                }
            }
            for digest in [&t.before_digest, &t.after_digest].into_iter().flatten() {
                if !valid_hash(digest) {
                    return Err(invalid("invalid expected target digest"));
                }
            }
            if !targets.insert((json(&t.kind)?, t.locator.to_lowercase())) {
                return Err(invalid("duplicate/aliased effect target"));
            }
        }
        let mut resources = std::collections::HashSet::new();
        for r in &self.resources {
            short(&r.key, 512)?;
            if !resources.insert((json(&r.kind)?, &r.key)) {
                return Err(invalid("duplicate resource claim"));
            }
        }
        Ok(())
    }
}
tags!(EffectState {
    Prepared,
    MayHaveBeenSent,
    ResultUnknown,
    VerifiedCompleted,
    VerifiedNotOccurred
});
tags!(ExecutionObservation {
    Quiescent,
    Active,
    Unknown
});
tags!(EffectOutcome {
    Completed,
    NotOccurred,
    Unknown
});
tags!(Coverage { Exact, Partial });
tags!(Attribution {
    OperationBound,
    Unproven
});
tags!(UnknownReason {
    None,
    NotRecorded,
    TransportLost,
    ObserverUnavailable,
    UnsupportedAdapter,
    PartialCoverage,
    OwnershipUnproven,
    ExecutionActive,
    ExecutionUnknown,
    Cancelled,
    CancelledBeforeDispatch,
    ExternalChange,
    ConflictingEvidence
});
dto!(EffectObservation {
    query_id: String, key: EffectKey, owner: OperationOwner, root_object_id: String,
    intent_digest: String, idempotency_key: String, query_scope_digest: String,
    outcome: EffectOutcome, execution: ExecutionObservation, coverage: Coverage,
    attribution: Attribution, evidence_digest: Option<String>, reason: UnknownReason
});
dto!(EffectRecord {
    intent: EffectIntent, intent_digest: String, revision: i64,
    state: EffectState, may_have_been_sent: bool, cancel_requested: bool,
    manual_review_required: bool, reason: UnknownReason, updated_at: i64,
    last_observation: Option<EffectObservation>,
    last_verified_outcome: Option<EffectOutcome>
});
impl EffectRecord {
    pub fn blocks_conflicting_admission(&self) -> bool {
        self.manual_review_required
            || matches!(
                self.state,
                EffectState::MayHaveBeenSent | EffectState::ResultUnknown
            )
    }
    /// Data for review only; this module has no resend/resume mutation API.
    pub fn recovery_advice(&self) -> RecoveryAdvice {
        if self.manual_review_required {
            RecoveryAdvice::ManualReview
        } else {
            match self.state {
                EffectState::Prepared => RecoveryAdvice::ReviewPreparedWithFreshApproval,
                EffectState::MayHaveBeenSent | EffectState::ResultUnknown => {
                    RecoveryAdvice::QueryOnly
                }
                EffectState::VerifiedCompleted => RecoveryAdvice::SkipVerifiedCompleted,
                EffectState::VerifiedNotOccurred => RecoveryAdvice::NewAttemptNeedsFreshApproval,
            }
        }
    }
}
tags!(RecoveryAdvice {
    ReviewPreparedWithFreshApproval,
    QueryOnly,
    SkipVerifiedCompleted,
    NewAttemptNeedsFreshApproval,
    ManualReview
});

/// Native-only current execution identity. The callback must validate the actual host run lease.
/// Construction does not approve an operation, outbound body, file write or process launch.
pub struct CurrentRun<'a> {
    root: &'a TrustedRootHandle,
    owner: OperationOwner,
    is_current: &'a dyn Fn() -> bool,
    nonce: String,
}
impl<'a> CurrentRun<'a> {
    pub fn from_verified_host(
        root: &'a TrustedRootHandle,
        owner: OperationOwner,
        is_current: &'a dyn Fn() -> bool,
    ) -> Result<Self> {
        owner_valid(&owner)?;
        let value = Self {
            root,
            owner,
            is_current,
            nonce: nonce()?,
        };
        value.check()?;
        Ok(value)
    }
    fn check(&self) -> Result<()> {
        if !(self.is_current)() {
            return Err(stale());
        }
        self.root.check_current().map_err(|_| stale())
    }
    fn matches(&self, intent: &EffectIntent) -> Result<()> {
        self.check()?;
        if intent.owner != self.owner
            || intent.root_object_id != self.root.identity().observation_key()
        {
            return Err(stale());
        }
        Ok(())
    }
}
/// New host-selected read permission for exactly one archived operation. No old trust is reopened.
/// The host must first authorize its exact read scope and select this project/root itself.
pub struct RecoveryReadScope<'a> {
    root: &'a TrustedRootHandle,
    key: EffectKey,
    owner: OperationOwner,
    reader_generation: String,
    is_current: &'a dyn Fn() -> bool,
    nonce: String,
}
impl<'a> RecoveryReadScope<'a> {
    pub fn from_verified_host_read(
        root: &'a TrustedRootHandle,
        key: EffectKey,
        original_owner: OperationOwner,
        reader_generation: String,
        is_current: &'a dyn Fn() -> bool,
    ) -> Result<Self> {
        id(&key.project_id)?;
        id(&key.operation_id)?;
        owner_valid(&original_owner)?;
        id(&reader_generation)?;
        if key.project_id != original_owner.project_id {
            return Err(stale());
        }
        let value = Self {
            root,
            key,
            owner: original_owner,
            reader_generation,
            is_current,
            nonce: nonce()?,
        };
        value.check()?;
        Ok(value)
    }
    pub fn root(&self) -> &TrustedRootHandle {
        self.root
    }
    fn check(&self) -> Result<()> {
        if !(self.is_current)() {
            return Err(stale());
        }
        self.root.check_current().map_err(|_| stale())
    }
    fn matches(&self, intent: &EffectIntent) -> Result<()> {
        self.check()?;
        if self.key != intent.key
            || self.owner != intent.owner
            || intent.root_object_id != self.root.identity().observation_key()
        {
            return Err(stale());
        }
        Ok(())
    }
}
tags!(DispatchPhase {
    Prepared,
    Open,
    InCallback,
    Settled,
    Closed
});
dto!(DispatchGateSnapshot {
    phase: DispatchPhase,
    epoch: i64
});
dto!(DispatchGateEvent {
    gate: DispatchGateSnapshot,
    kind: String
});
struct GateRow {
    snapshot: DispatchGateSnapshot,
    claim_id: Option<String>,
}
struct HandoffClaim {
    key: EffectKey,
    intent_digest: String,
    claim_id: String,
    epoch: i64,
}

/// Native handoff ownership across managed-store release. Drop never closes the
/// durable InCallback barrier. No serialization/Clone or restoration constructor.
pub(crate) struct OwnedOperationHandoff {
    database:std::sync::Arc<super::database_owner::NativeDatabasePin>,
    claim:HandoffClaim,
}
/// Created only after the original owned claim's settlement COMMIT.
pub(crate) struct SettledOperationProof {
    database:std::sync::Arc<super::database_owner::NativeDatabasePin>,key:EffectKey,digest:String,
}
impl SettledOperationProof {
    pub(crate) fn matches_intent(&self,intent:&EffectIntent,database:&super::database_owner::NativeDatabasePin)->bool {
        self.key==intent.key && intent.digest().map(|digest|digest==self.digest).unwrap_or(false)
            &&self.database.same_original_database(database)
    }
    pub(crate) fn matches(&self,record:&EffectRecord,database:&super::database_owner::NativeDatabasePin)->bool {
        self.key==record.intent.key&&self.digest==record.intent_digest&&self.database.same_original_database(database)
    }
}
/// A volatile, nonserializable one-use gate returned only after the durable pre-send commit.
/// It is neither a user approval nor a native executor capability.
pub struct DispatchTicket {
    key: EffectKey,
    digest: String,
    revision: i64,
    context_nonce: String,
    used: bool,
    gate_epoch: i64,
    journal_nonce: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EffectQuery {
    pub query_id: String,
    pub reader_generation: String,
    pub intent: EffectIntent,
    pub intent_digest: String,
    pub query_scope_digest: String,
}
/// Implementations must only read the exact original operation/targets. No load/compile/save,
/// dispatch, termination, credential renewal or trust extension is allowed in this observer.
pub trait ReadOnlyEffectObserver {
    fn adapter_identity(&self) -> AdapterIdentity;
    fn observe(
        &self,
        scope: &RecoveryReadScope<'_>,
        query: &EffectQuery,
        cancelled: &AtomicBool,
    ) -> std::result::Result<EffectObservation, ObserverFailure>;
}
tags!(ObserverFailure {
    Unavailable,
    Unsupported,
    Partial
});
/// A fresh execution observation, not a serialized DB fact. T19 still needs its own callback
/// settled check and original ticket/owner. This is not an OS/cross-process lock.
pub struct ReconciliationResult {
    pub record: EffectRecord,
    context_nonce: String,
    reader_generation: String,
    execution: ExecutionObservation,
    observed_at: Instant,
}
impl ReconciliationResult {
    pub fn execution_observation(&self, scope: &RecoveryReadScope<'_>) -> ExecutionObservation {
        if self.context_nonce != scope.nonce
            || self.reader_generation != scope.reader_generation
            || self.observed_at.elapsed() > FRESH_OBSERVATION_TTL
            || scope.matches(&self.record.intent).is_err()
        {
            ExecutionObservation::Unknown
        } else {
            self.execution
        }
    }
}
/// Borrowed extension; it never creates a second connection/database or migrates user_version.
pub struct EffectJournal<'a> {
    store: &'a RunStore,
    instance_nonce: String,
    // Volatile provenance only: existing/recovered rows cannot recreate a dispatch gate.
    prepared_contexts: std::cell::RefCell<std::collections::HashMap<(String, String), String>>,
}
impl RunStore {
    /// Explicit opt-in only. The production module declaration/IPC registration is not installed.
    pub fn open_effect_journal(&self) -> Result<EffectJournal<'_>> {
        self.open_effect_journal_inner(false)
    }
    // Bootstrap only a completely absent journal. Existing/partial evidence is never repaired.
    pub(crate) fn ensure_memory_effect_journal(&self) -> Result<()> {
        self.open_effect_journal_inner(true).map(drop)
    }
    fn open_effect_journal_inner(&self, memory_bootstrap: bool) -> Result<EffectJournal<'_>> {
        self.db.transaction(|| {
            if memory_bootstrap {
                let tables = self.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('effect_journal_meta','effect_intents','effect_journal_events','effect_dispatch_gates','effect_dispatch_events')", &[])?;
                if tables.len() == 5 { return Ok(()); }
                if !tables.is_empty() {
                    return Err(StoreError::new("catalogJournalAbsentOrPartial", "partial effect journal requires reconciliation; memory bootstrap cannot repair it"));
                }
            }
            self.db.execute("CREATE TABLE IF NOT EXISTS effect_journal_meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), version INTEGER NOT NULL)", &[])?;
            let version = self.db.query("SELECT version FROM effect_journal_meta WHERE singleton=1", &[])?;
            if let Some(row) = version.first() {
                let version = row[0].int()?;
                if version != EXTENSION_VERSION {
                    return Err(StoreError::new(if version < EXTENSION_VERSION { "unfencedLegacySchema" } else { "newerSchema" }, "effect journal lacks this dispatch-fence protocol; no migration or old confirmation adopted"));
                }
            } else { self.db.execute("INSERT INTO effect_journal_meta(singleton,version) VALUES(1,2)", &[])?; }
            self.db.execute("CREATE TABLE IF NOT EXISTS effect_intents (project_id TEXT NOT NULL, operation_id TEXT NOT NULL, run_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, intent_digest TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), payload TEXT NOT NULL, payload_sha256 TEXT NOT NULL, PRIMARY KEY(project_id,operation_id), UNIQUE(project_id,idempotency_key), FOREIGN KEY(project_id,run_id) REFERENCES runs(project_id,id))", &[])?;
            self.db.execute("CREATE TABLE IF NOT EXISTS effect_journal_events (project_id TEXT NOT NULL, operation_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(project_id,operation_id,revision), FOREIGN KEY(project_id,operation_id) REFERENCES effect_intents(project_id,operation_id))", &[])?;
            self.db.execute("CREATE TABLE IF NOT EXISTS effect_dispatch_gates (project_id TEXT NOT NULL, operation_id TEXT NOT NULL, intent_digest TEXT NOT NULL, phase TEXT NOT NULL CHECK(phase IN ('prepared','open','inCallback','settled','closed')), epoch INTEGER NOT NULL CHECK(epoch>=0), claim_id TEXT, PRIMARY KEY(project_id,operation_id), FOREIGN KEY(project_id,operation_id) REFERENCES effect_intents(project_id,operation_id))", &[])?;
            self.db.execute("CREATE TABLE IF NOT EXISTS effect_dispatch_events (project_id TEXT NOT NULL, operation_id TEXT NOT NULL, epoch INTEGER NOT NULL CHECK(epoch>=0), payload TEXT NOT NULL, PRIMARY KEY(project_id,operation_id,epoch), FOREIGN KEY(project_id,operation_id) REFERENCES effect_dispatch_gates(project_id,operation_id))", &[])?;
            Ok(())
        })?;
        Ok(EffectJournal {
            store: self,
            instance_nonce: nonce()?,
            prepared_contexts: Default::default(),
        })
    }
}
impl EffectJournal<'_> {
    pub fn prepare(&self, context: &CurrentRun<'_>, intent: &EffectIntent) -> Result<EffectRecord> {
        intent.validate()?;
        context.matches(intent)?;
        self.prune_prepared_contexts()?;
        let (record, inserted) = self.store.db.transaction(|| {
            let run = self.store.run(&intent.key.project_id, &intent.owner.run_id)?;
            if matches!(run.status, super::RunStatus::Succeeded | super::RunStatus::Failed | super::RunStatus::Cancelled) {
                return Err(StoreError::new("terminalRun", "a new operation requires a live nonterminal run"));
            }
            if let Some(old) = self.find(&intent.key)? {
                if old.intent != *intent { return Err(conflict("operation identity/plan cannot be changed")); }
                // Idempotent record creation does not return another dispatch ticket.
                return Ok((old, false));
            }
            if self.prepared_contexts.borrow().len() >= 128 {
                return Err(StoreError::new("capacity", "too many volatile prepared operation contexts"));
            }
            context.matches(intent)?;
            let record = EffectRecord { intent: intent.clone(), intent_digest: intent.digest()?, revision: 1,
                state: EffectState::Prepared, may_have_been_sent: false, cancel_requested: false,
                manual_review_required: false, reason: UnknownReason::None, updated_at: intent.created_at, last_observation: None, last_verified_outcome: None };
            let text = json(&record)?;
            self.store.db.execute("INSERT INTO effect_intents(project_id,operation_id,run_id,idempotency_key,intent_digest,revision,payload,payload_sha256) VALUES(?,?,?,?,?,?,?,?)", &[
                intent.key.project_id.as_str().into(), intent.key.operation_id.as_str().into(), intent.owner.run_id.as_str().into(), intent.idempotency_key.as_str().into(), record.intent_digest.as_str().into(), 1_i64.into(), text.as_str().into(), hash(text.as_bytes()).into()
            ])?;
            self.store.db.execute("INSERT INTO effect_dispatch_gates(project_id,operation_id,intent_digest,phase,epoch,claim_id) VALUES(?,?,?,'prepared',0,NULL)", &[intent.key.project_id.as_str().into(), intent.key.operation_id.as_str().into(), record.intent_digest.as_str().into()])?;
            self.gate_event(&record.intent.key, &DispatchGateSnapshot { phase: DispatchPhase::Prepared, epoch: 0 }, "prepared")?;
            self.event(&record, "prepared")?;
            Ok((record, true))
        })?;
        if inserted {
            self.prepared_contexts.borrow_mut().insert(
                (
                    intent.key.project_id.clone(),
                    intent.key.operation_id.clone(),
                ),
                context.nonce.clone(),
            );
        }
        Ok(record)
    }
    /// Must commit BEFORE handing any operation to its protected native executor.
    /// A failed/uncertain commit returns no ticket; never infer that dispatch is allowed.
    pub fn mark_may_have_been_sent(
        &self,
        context: &CurrentRun<'_>,
        key: &EffectKey,
        expected_revision: i64,
        at: i64,
    ) -> Result<DispatchTicket> {
        let registry_key = (key.project_id.clone(), key.operation_id.clone());
        if self.prepared_contexts.borrow().get(&registry_key) != Some(&context.nonce) {
            return Err(StoreError::new("freshApprovalRequired", "recovered/existing prepared data cannot recreate a dispatch gate; review a new operation"));
        }
        let record = self.store.db.transaction(|| {
            let mut record = self.required(key)?;
            context.matches(&record.intent)?;
            revision(&record, expected_revision, at)?;
            if record.state != EffectState::Prepared
                || record.cancel_requested
                || record.may_have_been_sent
            {
                return Err(conflict("operation cannot be dispatched again"));
            }
            let gate = self.gate_for(&record)?;
            if gate.snapshot.phase != DispatchPhase::Prepared {
                return Err(conflict(
                    "dispatch gate is irreversibly closed or already claimed",
                ));
            }
            self.transition_gate(&record, &gate, DispatchPhase::Open, None, "ticketIssued")?;
            record.state = EffectState::MayHaveBeenSent;
            record.may_have_been_sent = true;
            record.reason = UnknownReason::NotRecorded;
            self.update(&mut record, expected_revision, at, "mayHaveBeenSent")?;
            context.matches(&record.intent)?;
            Ok(record)
        })?;
        self.prepared_contexts.borrow_mut().remove(&registry_key);
        Ok(DispatchTicket {
            key: key.clone(),
            digest: record.intent_digest,
            revision: record.revision,
            context_nonce: context.nonce.clone(),
            used: false,
            gate_epoch: 1,
            journal_nonce: self.instance_nonce.clone(),
        })
    }
    /// Durable one-use synchronous handoff. This is not approval or an external stop proof.
    /// Queries cannot confirm anything while this invocation is pending, even after reconnect.
    pub fn dispatch_once(
        &self,
        context: &CurrentRun<'_>,
        ticket: &mut DispatchTicket,
        send: impl FnOnce(&EffectIntent),
    ) -> Result<()> {
        self.dispatch_once_admitted(context, ticket, |_, _| Ok(()), send)
    }
    /// Native operation bridge only: admission executes inside the same IMMEDIATE
    /// transaction as the one-use handoff claim. No callback runs before COMMIT.
    pub(crate) fn dispatch_once_admitted(
        &self, context: &CurrentRun<'_>, ticket: &mut DispatchTicket,
        admit: impl FnOnce(&RunStore, &EffectRecord) -> Result<()>,
        send: impl FnOnce(&EffectIntent),
    ) -> Result<()> {
        let (record,claim)=self.claim_once_admitted(context,ticket,admit)?;
        // The claim COMMIT above must succeed before entering the callback. If a query won
        // first, it already closed this ticket; if we won, it must refuse InCallback.
        let eligible = (|| {
            context.matches(&record.intent)?;
            let current = self.required(&ticket.key)?;
            if current.cancel_requested || current.manual_review_required {
                return Err(conflict("handoff cancelled before callback entry"));
            }
            Ok(())
        })();
        if let Err(error) = eligible {
            self.finish_handoff(&claim, DispatchPhase::Closed)?;
            return Err(error);
        }
        // No DB write lock spans external work. A panic/abort before settlement leaves the
        // durable InCallback barrier intact; no timeout/reopen can infer it has returned.
        send(&record.intent);
        self.finish_handoff(&claim, DispatchPhase::Settled)?;
        Ok(())
    }
    fn claim_once_admitted(
        &self,context:&CurrentRun<'_>,ticket:&mut DispatchTicket,
        admit:impl FnOnce(&RunStore,&EffectRecord)->Result<()>,
    )->Result<(EffectRecord,HandoffClaim)>{
        if ticket.used {
            return Err(conflict("dispatch ticket already consumed"));
        }
        ticket.used = true;
        if ticket.context_nonce != context.nonce || ticket.journal_nonce != self.instance_nonce {
            return Err(stale());
        }
        let (record, claim) = self.store.db.transaction(|| {
            let record = self.required(&ticket.key)?;
            context.matches(&record.intent)?;
            let gate = self.gate_for(&record)?;
            if record.intent_digest != ticket.digest
                || record.revision != ticket.revision
                || record.state != EffectState::MayHaveBeenSent
                || record.cancel_requested
                || record.manual_review_required
                || gate.snapshot.phase != DispatchPhase::Open
                || gate.snapshot.epoch != ticket.gate_epoch
            {
                return Err(conflict(
                    "dispatch gate/state changed; query instead of resending",
                ));
            }
            let claim_id = nonce()?;
            let next = self.transition_gate(
                &record,
                &gate,
                DispatchPhase::InCallback,
                Some(&claim_id),
                "handoffClaimed",
            )?;
            context.matches(&record.intent)?;
            let claim = HandoffClaim {
                key: record.intent.key.clone(),
                intent_digest: record.intent_digest.clone(),
                claim_id,
                epoch: next.epoch,
            };
            admit(self.store, &record)?;
            context.matches(&record.intent)?;
            Ok((record, claim))
        })?;
        Ok((record,claim))
    }
    pub(crate) fn claim_owned_operation(
        &self,context:&CurrentRun<'_>,ticket:&mut DispatchTicket,
        admit:impl FnOnce(&RunStore,&EffectRecord)->Result<()>,
    )->Result<OwnedOperationHandoff>{
        let database=self.store.db.pin_original_database()?;
        let (record,claim)=self.claim_once_admitted(context,ticket,admit)?;
        // An error here retains the committed InCallback gate. It never fabricates settlement.
        context.matches(&record.intent)?;
        Ok(OwnedOperationHandoff{database,claim})
    }
    pub(crate) fn ended_repair_record(&self,project:&str,run:&str)->Result<EffectRecord>{
        let backup=self.store.read_artifact_bounded(project,run,"nativeRepairBefore",2*1024*1024)?;
        let value:serde_json::Value=serde_json::from_slice(&backup).map_err(|_|stale())?;
        let operation=value["executionIdentity"]["operationId"].as_str().ok_or_else(stale)?;
        let record=self.required(&EffectKey{project_id:project.into(),operation_id:operation.into()})?;
        if record.intent.owner.run_id!=run||record.intent.adapter.id!="native.ue-source-repair.v1"||record.intent.adapter.version!=1||self.gate_for(&record)?.snapshot.phase!=DispatchPhase::Settled{return Err(stale());}
        let database=self.store.db.pin_original_database().map_err(|_|stale())?;
        if crate::ue_repair_recovery::observe_original_process(&backup,database.lookup_key(),&record.intent).map_err(|_|stale())?!=crate::repair_execution_identity::ProcessObservation::Ended{return Err(stale());}
        Ok(record)
    }
    /// Restricted restart path for a durably settled synchronous source repair.
    /// The unique idempotency key atomically reserves one restoration; all normal
    /// RuntimeHost admission and fresh explicit write approval remain mandatory.
    pub(crate) fn prepare_ended_repair_restore(
        &self,context:&CurrentRun<'_>,next:&EffectIntent,original_key:&EffectKey,
        preview:&crate::ue_build_repair::NativeRepairPreview,
        cancelled:&AtomicBool,deadline:std::time::Instant,
    )->Result<crate::runtime_host_recovery_catalog::SettledRepairRestore>{
        context.matches(next)?;
        let original=self.required(original_key)?;
        if original.intent.adapter.id!="native.ue-source-repair.v1"||original.intent.adapter.version!=1
            ||original.intent.key.project_id!=next.key.project_id||original.intent.root_object_id!=next.root_object_id
            ||self.gate_for(&original)?.snapshot.phase!=DispatchPhase::Settled
            ||next.idempotency_key!=hash(format!("restart-restore:{}:{}",original.intent.key.project_id,original.intent_digest).as_bytes()) {
            return Err(StoreError::new("restartRestoreBlocked","original settled repair and one-use binding required"));
        }
        let backup=self.store.read_artifact_bounded(&original.intent.key.project_id,&original.intent.owner.run_id,"nativeRepairBefore",2*1024*1024)?;
        let result=self.store.read_artifact_bounded(&original.intent.key.project_id,&original.intent.owner.run_id,"nativeRepairResult",2*1024*1024)?;
        let database=self.store.db.pin_original_database().map_err(|_|stale())?;
        if crate::ue_repair_recovery::observe_original_process(&backup,database.lookup_key(),&original.intent)
            .map_err(|_|stale())?!=crate::repair_execution_identity::ProcessObservation::Ended{return Err(stale());}
        let report=crate::ue_repair_recovery::inspect(context.root,&next.key.project_id,&original.intent.owner.run_id,&backup,Some(&result),cancelled,deadline).map_err(|_|stale())?;
        if report.restore_candidates.is_empty()||report.restore_candidates.len()!=preview.preview.files.len()
            ||report.restore_candidates.iter().zip(&preview.preview.files).any(|(a,b)|a.path!=b.path||a.before!=b.before||a.after!=b.after||a.before_hash!=b.before_hash||a.after_hash!=b.after_hash) {
            return Err(StoreError::new("restartRestoreChanged","reviewed reverse diff no longer matches durable backup and files"));
        }
        let proof=SettledOperationProof{database,key:original.intent.key.clone(),digest:original.intent_digest.clone()};
        let restore=crate::runtime_host_recovery_catalog::SettledRepairRestore::new(proof,original.intent,preview).map_err(|_|stale())?;
        if self.find(&next.key)?.is_some(){return Err(conflict("restart restore already reserved"));}
        self.prepare(context,next)?;
        Ok(restore)
    }
    /// Original claim only, after the owned callback/executor has actually returned.
    pub(crate) fn settle_owned_operation(&self,handoff:OwnedOperationHandoff)->Result<SettledOperationProof> {
        let current=self.store.db.pin_original_database()?;
        if !handoff.database.same_original_database(&current){return Err(stale());}
        self.finish_handoff(&handoff.claim,DispatchPhase::Settled)?;
        Ok(SettledOperationProof{database:handoff.database,key:handoff.claim.key,digest:handoff.claim.intent_digest})
    }
    fn finish_handoff(&self, claim: &HandoffClaim, phase: DispatchPhase) -> Result<()> {
        self.store.db.transaction(|| {
            let record = self.required(&claim.key)?;
            let gate = self.gate_for(&record)?;
            if record.intent_digest != claim.intent_digest || gate.snapshot.phase != DispatchPhase::InCallback
                || gate.snapshot.epoch != claim.epoch || gate.claim_id.as_deref() != Some(&claim.claim_id) {
                return Err(conflict("handoff settlement does not own the durable claim"));
            }
            self.transition_gate(&record, &gate, phase, Some(&claim.claim_id), "handoffReturned")?;
            Ok(())
        }).map_err(|_| StoreError::new("handoffUnsettled", "callback may have run; its durable settlement is unavailable; confirmation and replay remain blocked"))
    }
    /// Closes any not-yet-entered callback BEFORE an observer can take a snapshot.
    /// A callback already claimed by any connection must settle first; observer assertions
    /// alone cannot override this local handoff uncertainty.
    fn fence_query(
        &self,
        scope: &RecoveryReadScope<'_>,
        expected_revision: i64,
        at: i64,
    ) -> Result<(EffectRecord, DispatchGateSnapshot)> {
        let fenced = self.store.db.transaction(|| {
            let record = self.read(scope)?;
            revision(&record, expected_revision, at)?;
            let gate = self.gate_for(&record)?;
            let fence = match gate.snapshot.phase {
                DispatchPhase::Prepared | DispatchPhase::Open => self.transition_gate(&record, &gate, DispatchPhase::Closed, None, "closedBeforeObservation")?,
                DispatchPhase::InCallback => return Err(StoreError::new("handoffUnsettled", "original handoff callback has no durable settlement; observation cannot confirm quiescence")),
                DispatchPhase::Settled | DispatchPhase::Closed => gate.snapshot,
            };
            scope.matches(&record.intent)?;
            Ok((record, fence))
        })?;
        self.prepared_contexts
            .borrow_mut()
            .remove(&(scope.key.project_id.clone(), scope.key.operation_id.clone()));
        Ok(fenced)
    }
    pub fn dispatch_gate(&self, scope: &RecoveryReadScope<'_>) -> Result<DispatchGateSnapshot> {
        let record = self.read(scope)?;
        Ok(self.gate_for(&record)?.snapshot)
    }
    pub fn dispatch_events(
        &self,
        scope: &RecoveryReadScope<'_>,
        after_epoch: i64,
        limit: usize,
    ) -> Result<Vec<DispatchGateEvent>> {
        self.read(scope)?;
        if after_epoch < -1 || limit == 0 || limit > 100 {
            return Err(invalid("gate event page out of range"));
        }
        self.store.db.query("SELECT payload FROM effect_dispatch_events WHERE project_id=? AND operation_id=? AND epoch>? ORDER BY epoch LIMIT ?", &[scope.key.project_id.as_str().into(), scope.key.operation_id.as_str().into(), after_epoch.into(), (limit as i64).into()])?.iter().map(|r| super::decode(&r[0])).collect()
    }
    pub fn mark_result_unknown(
        &self,
        context: &CurrentRun<'_>,
        key: &EffectKey,
        expected_revision: i64,
        at: i64,
    ) -> Result<EffectRecord> {
        self.store.db.transaction(|| {
            let mut record = self.required(key)?;
            context.matches(&record.intent)?;
            revision(&record, expected_revision, at)?;
            if !matches!(
                record.state,
                EffectState::MayHaveBeenSent | EffectState::ResultUnknown
            ) {
                return Err(conflict("no pending dispatch result"));
            }
            record.state = EffectState::ResultUnknown;
            record.reason = UnknownReason::TransportLost;
            self.update(&mut record, expected_revision, at, "resultUnknown")?;
            Ok(record)
        })
    }
    pub fn read(&self, scope: &RecoveryReadScope<'_>) -> Result<EffectRecord> {
        scope.check()?;
        let record = self.required(&scope.key)?;
        scope.matches(&record.intent)?;
        Ok(record)
    }
    /// App-data cancellation only: it never sends cancellation to an external process/editor.
    pub fn request_cancel(
        &self,
        scope: &RecoveryReadScope<'_>,
        expected_revision: i64,
        at: i64,
    ) -> Result<EffectRecord> {
        let record = self.store.db.transaction(|| {
            let mut record = self.read(scope)?;
            revision(&record, expected_revision, at)?;
            if record.cancel_requested {
                return Ok(record);
            }
            let gate = self.gate_for(&record)?;
            if matches!(
                gate.snapshot.phase,
                DispatchPhase::Prepared | DispatchPhase::Open
            ) {
                self.transition_gate(
                    &record,
                    &gate,
                    DispatchPhase::Closed,
                    None,
                    "closedByCancellation",
                )?;
            }
            record.cancel_requested = true;
            if record.state == EffectState::Prepared && !record.may_have_been_sent {
                record.state = EffectState::VerifiedNotOccurred;
                record.reason = UnknownReason::CancelledBeforeDispatch;
                record.last_verified_outcome = Some(EffectOutcome::NotOccurred);
            } else if record.blocks_conflicting_admission() {
                record.state = EffectState::ResultUnknown;
                record.reason = UnknownReason::Cancelled;
            }
            self.update(&mut record, expected_revision, at, "cancelRequested")?;
            scope.matches(&record.intent)?;
            Ok(record)
        })?;
        self.prepared_contexts.borrow_mut().remove(&(
            record.intent.key.project_id.clone(),
            record.intent.key.operation_id.clone(),
        ));
        Ok(record)
    }
    /// Bounded paginated catalog of saved operations only; no filesystem is opened from rows.
    /// Resolve fresh host read permission/root before reading or querying a selected record.
    pub fn pending(&self, project: &str, limit: usize, offset: usize) -> Result<PendingPage> {
        id(project)?;
        if limit == 0 || limit > 100 || offset > 1_000_000 {
            return Err(invalid("pending page out of range"));
        }
        let mut rows = self.store.db.query("SELECT project_id,operation_id,run_id,idempotency_key,intent_digest,revision,payload,payload_sha256 FROM effect_intents WHERE project_id=? ORDER BY operation_id LIMIT ? OFFSET ?", &[project.into(), ((limit + 1) as i64).into(), (offset as i64).into()])?;
        let more = rows.len() > limit;
        if more {
            rows.pop();
        }
        let mut records = Vec::new();
        for row in rows {
            let record = decode_row(&row)?;
            self.gate_for(&record)?;
            if record.blocks_conflicting_admission() || record.state == EffectState::Prepared {
                records.push(record);
            }
        }
        // A page can contain no pending rows while later pages still do. Follow next_offset.
        Ok(PendingPage {
            records,
            next_offset: more.then_some(offset + limit),
        })
    }

    /// Only reads external effects, then commits a bound observation with revision CAS.
    /// Unsupported/unavailable/partial observations remain unknown; no mutation is retried.
    pub fn reconcile(
        &self,
        scope: &RecoveryReadScope<'_>,
        expected_revision: i64,
        at: i64,
        observer: &dyn ReadOnlyEffectObserver,
        cancelled: &AtomicBool,
    ) -> Result<ReconciliationResult> {
        let before = self.read(scope)?;
        revision(&before, expected_revision, at)?;
        if cancelled.load(Ordering::Acquire) {
            return Err(StoreError::new(
                "cancelled",
                "effect query cancelled; no outcome inferred",
            ));
        }
        if observer.adapter_identity() != before.intent.adapter {
            return Err(invalid(
                "observer adapter/version does not match the original operation",
            ));
        }
        let (before, dispatch_fence) = self.fence_query(scope, expected_revision, at)?;
        let query = EffectQuery {
            query_id: nonce()?,
            reader_generation: scope.reader_generation.clone(),
            intent: before.intent.clone(),
            intent_digest: before.intent_digest.clone(),
            query_scope_digest: before.intent.query_scope_digest()?,
        };
        let observed_at = Instant::now();
        // Deliberately outside the SQLite transaction: query failure never holds a DB write lock.
        let observation = match observer.observe(scope, &query, cancelled) {
            Ok(o) => o,
            Err(failure) => unknown_observation(
                &query,
                match failure {
                    ObserverFailure::Unavailable => UnknownReason::ObserverUnavailable,
                    ObserverFailure::Unsupported => UnknownReason::UnsupportedAdapter,
                    ObserverFailure::Partial => UnknownReason::PartialCoverage,
                },
            ),
        };
        scope.matches(&before.intent)?;
        if cancelled.load(Ordering::Acquire) {
            return Err(StoreError::new(
                "cancelled",
                "effect query cancelled; late observation discarded",
            ));
        }
        query_fresh(observed_at)?;
        validate_observation(&query, &observation)?;
        let normalized = normalize(observation);
        // This proof is never reconstructed from the database on a later startup.
        let execution = if normalized.coverage == Coverage::Exact
            && normalized.attribution == Attribution::OperationBound
        {
            normalized.execution
        } else {
            ExecutionObservation::Unknown
        };
        let record = self.store.db.transaction(|| {
            let mut record = self.required(&scope.key)?;
            scope.matches(&record.intent)?;
            revision(&record, expected_revision, at)?;
            query_fresh(observed_at)?;
            if self.gate_for(&record)?.snapshot != dispatch_fence
                || !matches!(
                    dispatch_fence.phase,
                    DispatchPhase::Closed | DispatchPhase::Settled
                )
            {
                return Err(conflict("dispatch fence changed while querying"));
            }
            if record.intent_digest != query.intent_digest {
                return Err(conflict("intent changed while querying"));
            }
            if record
                .last_observation
                .as_ref()
                .is_some_and(|o| same_fact(o, &normalized))
            {
                return Ok(record); // Duplicate confirmation must not manufacture another completion.
            }
            let observed_state = match normalized.outcome {
                EffectOutcome::Completed => EffectState::VerifiedCompleted,
                EffectOutcome::NotOccurred => EffectState::VerifiedNotOccurred,
                EffectOutcome::Unknown => EffectState::ResultUnknown,
            };
            let impossible_completion = (!record.may_have_been_sent
                || dispatch_fence.phase == DispatchPhase::Closed)
                && observed_state == EffectState::VerifiedCompleted;
            let conflicting_final = normalized.outcome != EffectOutcome::Unknown
                && record
                    .last_verified_outcome
                    .is_some_and(|known| known != normalized.outcome);
            let explicit_external_change = normalized.reason == UnknownReason::ExternalChange;
            if record.manual_review_required
                || impossible_completion
                || conflicting_final
                || explicit_external_change
            {
                record.manual_review_required = true;
                record.state = EffectState::ResultUnknown;
                record.reason = if explicit_external_change {
                    UnknownReason::ExternalChange
                } else {
                    UnknownReason::ConflictingEvidence
                };
            } else {
                record.state = observed_state;
                record.reason = normalized.reason;
                if normalized.outcome != EffectOutcome::Unknown {
                    record.last_verified_outcome = Some(normalized.outcome);
                }
            }
            record.last_observation = Some(normalized);
            self.update(&mut record, expected_revision, at, "observed")?;
            query_fresh(observed_at)?;
            scope.matches(&record.intent)?;
            if cancelled.load(Ordering::Acquire) {
                return Err(StoreError::new(
                    "cancelled",
                    "query cancelled before commit",
                ));
            }
            Ok(record)
        })?;
        self.prepared_contexts.borrow_mut().remove(&(
            record.intent.key.project_id.clone(),
            record.intent.key.operation_id.clone(),
        ));
        Ok(ReconciliationResult {
            record,
            context_nonce: scope.nonce.clone(),
            reader_generation: scope.reader_generation.clone(),
            execution,
            observed_at,
        })
    }
    pub fn events(
        &self,
        scope: &RecoveryReadScope<'_>,
        after_revision: i64,
        limit: usize,
    ) -> Result<Vec<JournalEvent>> {
        self.read(scope)?;
        if after_revision < 0 || limit == 0 || limit > 100 {
            return Err(invalid("event page out of range"));
        }
        self.store.db.query("SELECT payload FROM effect_journal_events WHERE project_id=? AND operation_id=? AND revision>? ORDER BY revision LIMIT ?", &[scope.key.project_id.as_str().into(), scope.key.operation_id.as_str().into(), after_revision.into(), (limit as i64).into()])?.iter().map(|r| super::decode(&r[0])).collect()
    }
    fn prune_prepared_contexts(&self) -> Result<()> {
        let keys: Vec<_> = self.prepared_contexts.borrow().keys().cloned().collect();
        for (project_id, operation_id) in keys {
            let key = EffectKey {
                project_id: project_id.clone(),
                operation_id: operation_id.clone(),
            };
            let still_prepared = if let Some(r) = self.find(&key)? {
                r.state == EffectState::Prepared
                    && !r.cancel_requested
                    && !r.may_have_been_sent
                    && self.gate_for(&r)?.snapshot.phase == DispatchPhase::Prepared
            } else {
                false
            };
            if !still_prepared {
                self.prepared_contexts
                    .borrow_mut()
                    .remove(&(project_id, operation_id));
            }
        }
        Ok(())
    }
    fn required(&self, key: &EffectKey) -> Result<EffectRecord> {
        self.find(key)?
            .ok_or_else(|| StoreError::new("notFound", "operation does not exist in this project"))
    }
    fn find(&self, key: &EffectKey) -> Result<Option<EffectRecord>> {
        id(&key.project_id)?;
        id(&key.operation_id)?;
        let rows = self.store.db.query("SELECT project_id,operation_id,run_id,idempotency_key,intent_digest,revision,payload,payload_sha256 FROM effect_intents WHERE project_id=? AND operation_id=?", &[key.project_id.as_str().into(), key.operation_id.as_str().into()])?;
        let record = rows.first().map(|r| decode_row(r)).transpose()?;
        if let Some(record) = &record {
            self.gate_for(record)?;
        }
        Ok(record)
    }
    fn gate_for(&self, record: &EffectRecord) -> Result<GateRow> {
        let rows = self.store.db.query("SELECT intent_digest,phase,epoch,claim_id FROM effect_dispatch_gates WHERE project_id=? AND operation_id=?", &[record.intent.key.project_id.as_str().into(), record.intent.key.operation_id.as_str().into()])?;
        let row = rows.first().ok_or_else(StoreError::corrupt)?;
        if row[0].text()? != record.intent_digest {
            return Err(StoreError::corrupt());
        }
        let phase = match row[1].text()?.as_str() {
            "prepared" => DispatchPhase::Prepared,
            "open" => DispatchPhase::Open,
            "inCallback" => DispatchPhase::InCallback,
            "settled" => DispatchPhase::Settled,
            "closed" => DispatchPhase::Closed,
            _ => return Err(StoreError::corrupt()),
        };
        let epoch = row[2].int()?;
        let claim_id = match &row[3] {
            super::sqlite::Value::Null => None,
            value => Some(value.text()?),
        };
        if epoch < 0
            || claim_id.as_ref().is_some_and(|s| !valid_hash(s))
            || (matches!(phase, DispatchPhase::InCallback | DispatchPhase::Settled)
                && claim_id.is_none())
        {
            return Err(StoreError::corrupt());
        }
        Ok(GateRow {
            snapshot: DispatchGateSnapshot { phase, epoch },
            claim_id,
        })
    }
    fn transition_gate(
        &self,
        record: &EffectRecord,
        old: &GateRow,
        phase: DispatchPhase,
        claim: Option<&str>,
        kind: &str,
    ) -> Result<DispatchGateSnapshot> {
        let phase_text = |p| match p {
            DispatchPhase::Prepared => "prepared",
            DispatchPhase::Open => "open",
            DispatchPhase::InCallback => "inCallback",
            DispatchPhase::Settled => "settled",
            DispatchPhase::Closed => "closed",
        };
        let next = DispatchGateSnapshot {
            phase,
            epoch: old
                .snapshot
                .epoch
                .checked_add(1)
                .ok_or_else(|| invalid("dispatch gate epoch overflow"))?,
        };
        if self.store.db.execute("UPDATE effect_dispatch_gates SET phase=?,epoch=?,claim_id=? WHERE project_id=? AND operation_id=? AND intent_digest=? AND phase=? AND epoch=?", &[
            phase_text(phase).into(), next.epoch.into(), claim.map(super::sqlite::Value::from).unwrap_or(super::sqlite::Value::Null),
            record.intent.key.project_id.as_str().into(), record.intent.key.operation_id.as_str().into(), record.intent_digest.as_str().into(), phase_text(old.snapshot.phase).into(), old.snapshot.epoch.into()
        ])? != 1 { return Err(conflict("dispatch gate changed")); }
        self.gate_event(&record.intent.key, &next, kind)?;
        Ok(next)
    }
    fn gate_event(&self, key: &EffectKey, gate: &DispatchGateSnapshot, kind: &str) -> Result<()> {
        self.store.db.execute("INSERT INTO effect_dispatch_events(project_id,operation_id,epoch,payload) VALUES(?,?,?,?)", &[key.project_id.as_str().into(), key.operation_id.as_str().into(), gate.epoch.into(), json(&DispatchGateEvent { gate: gate.clone(), kind: kind.into() })?.into()])?;
        Ok(())
    }
    fn update(&self, record: &mut EffectRecord, expected: i64, at: i64, kind: &str) -> Result<()> {
        record.revision = expected
            .checked_add(1)
            .ok_or_else(|| invalid("effect revision overflow"))?;
        record.updated_at = at;
        let text = json(record)?;
        if self.store.db.execute("UPDATE effect_intents SET revision=?,payload=?,payload_sha256=? WHERE project_id=? AND operation_id=? AND revision=? AND intent_digest=?", &[
            record.revision.into(), text.as_str().into(), hash(text.as_bytes()).into(), record.intent.key.project_id.as_str().into(), record.intent.key.operation_id.as_str().into(), expected.into(), record.intent_digest.as_str().into()
        ])? != 1 { return Err(conflict("effect revision changed")); }
        self.event(record, kind)
    }
    fn event(&self, record: &EffectRecord, kind: &str) -> Result<()> {
        let event = JournalEvent {
            kind: kind.into(),
            record: record.clone(),
        };
        self.store.db.execute("INSERT INTO effect_journal_events(project_id,operation_id,revision,payload) VALUES(?,?,?,?)", &[record.intent.key.project_id.as_str().into(), record.intent.key.operation_id.as_str().into(), record.revision.into(), json(&event)?.into()])?;
        Ok(())
    }
}
dto!(JournalEvent {
    kind: String,
    record: EffectRecord
});
dto!(PendingPage { records: Vec<EffectRecord>, next_offset: Option<usize> });
fn invalid(message: &str) -> StoreError {
    StoreError::invalid(message)
}
fn conflict(message: &str) -> StoreError {
    StoreError::new("conflict", message)
}
fn stale() -> StoreError {
    StoreError::new(
        "staleOwner",
        "fresh selected project/root/owner permission is required",
    )
}
fn short(value: &str, max: usize) -> Result<()> {
    if value.is_empty()
        || value.len() > max
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        Err(invalid("invalid bounded descriptor"))
    } else {
        Ok(())
    }
}
fn root_key(value: &str) -> Result<()> {
    let key = value
        .strip_prefix("windows-fileid128:v1:")
        .ok_or_else(|| invalid("held-root identity required"))?;
    let (volume, file) = key
        .split_once(':')
        .ok_or_else(|| invalid("invalid held-root identity"))?;
    if volume.len() != 16
        || file.len() != 32
        || !key
            .bytes()
            .all(|b| b == b':' || b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(invalid("invalid held-root identity"));
    }
    Ok(())
}
fn owner_valid(owner: &OperationOwner) -> Result<()> {
    for v in [
        &owner.scope_id,
        &owner.run_id,
        &owner.project_id,
        &owner.root_ref,
        &owner.conversation_id,
        &owner.provider_id,
        &owner.model_id,
        &owner.step_id,
        &owner.execution_id,
        &owner.host_generation,
    ] {
        id(v)?;
    }
    Ok(())
}
fn revision(record: &EffectRecord, expected: i64, at: i64) -> Result<()> {
    timestamp(at)?;
    if expected != record.revision || at < record.updated_at {
        return Err(conflict(
            "effect revision/time changed; reload before confirming",
        ));
    }
    Ok(())
}
fn nonce() -> Result<String> {
    let mut bytes = [0_u8; 32];
    getrandom::getrandom(&mut bytes)
        .map_err(|_| StoreError::new("random", "fresh query correlation unavailable"))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn decode_row(row: &[super::sqlite::Value]) -> Result<EffectRecord> {
    if row.len() != 8 {
        return Err(StoreError::corrupt());
    }
    let text = row[6].text()?;
    if hash(text.as_bytes()) != row[7].text()? {
        return Err(StoreError::corrupt());
    }
    let record: EffectRecord = serde_json::from_str(&text).map_err(|_| StoreError::corrupt())?;
    record
        .intent
        .validate()
        .map_err(|_| StoreError::corrupt())?;
    if record.intent.key.project_id != row[0].text()?
        || record.intent.key.operation_id != row[1].text()?
        || record.intent.owner.run_id != row[2].text()?
        || record.intent.idempotency_key != row[3].text()?
        || record.intent_digest != row[4].text()?
        || record.revision != row[5].int()?
        || record.intent_digest != record.intent.digest()?
        || record.revision < 1
        || record.updated_at < record.intent.created_at
    {
        return Err(StoreError::corrupt());
    }
    if record.last_verified_outcome == Some(EffectOutcome::Unknown)
        || (record.state == EffectState::VerifiedCompleted
            && record.last_verified_outcome != Some(EffectOutcome::Completed))
        || (record.state == EffectState::VerifiedNotOccurred
            && record.last_verified_outcome != Some(EffectOutcome::NotOccurred))
    {
        return Err(StoreError::corrupt());
    }
    if record.manual_review_required && record.state != EffectState::ResultUnknown {
        return Err(StoreError::corrupt());
    }
    if matches!(record.state, EffectState::Prepared)
        && (record.may_have_been_sent
            || record.cancel_requested
            || record.last_observation.is_some())
    {
        return Err(StoreError::corrupt());
    }
    if record.state == EffectState::VerifiedCompleted && !record.may_have_been_sent {
        return Err(StoreError::corrupt());
    }
    Ok(record)
}
fn unknown_observation(query: &EffectQuery, reason: UnknownReason) -> EffectObservation {
    EffectObservation {
        query_id: query.query_id.clone(),
        key: query.intent.key.clone(),
        owner: query.intent.owner.clone(),
        root_object_id: query.intent.root_object_id.clone(),
        intent_digest: query.intent_digest.clone(),
        idempotency_key: query.intent.idempotency_key.clone(),
        query_scope_digest: query.query_scope_digest.clone(),
        outcome: EffectOutcome::Unknown,
        execution: ExecutionObservation::Unknown,
        coverage: Coverage::Partial,
        attribution: Attribution::Unproven,
        evidence_digest: None,
        reason,
    }
}
fn validate_observation(query: &EffectQuery, o: &EffectObservation) -> Result<()> {
    if o.query_id != query.query_id
        || o.key != query.intent.key
        || o.owner != query.intent.owner
        || o.root_object_id != query.intent.root_object_id
        || o.intent_digest != query.intent_digest
        || o.idempotency_key != query.intent.idempotency_key
        || o.query_scope_digest != query.query_scope_digest
    {
        return Err(StoreError::new(
            "observationMismatch",
            "effect observation is not bound to this exact fresh query/original owner",
        ));
    }
    if o.reason == UnknownReason::ExternalChange && o.evidence_digest.is_none() {
        return Err(invalid("explicit external-change evidence digest required"));
    }
    if o.evidence_digest.as_ref().is_some_and(|h| !valid_hash(h)) {
        return Err(invalid("invalid evidence digest"));
    }
    Ok(())
}
fn normalize(mut o: EffectObservation) -> EffectObservation {
    // A supported adapter's concrete drift evidence must not be hidden by a simultaneous
    // partial/active execution observation. Keep drift quarantined; partial/active proof cannot release T19.
    if o.reason == UnknownReason::ExternalChange {
        o.outcome = EffectOutcome::Unknown;
        return o;
    }
    let reason = if o.coverage != Coverage::Exact {
        Some(UnknownReason::PartialCoverage)
    } else if o.attribution != Attribution::OperationBound {
        Some(UnknownReason::OwnershipUnproven)
    } else if o.execution == ExecutionObservation::Active {
        Some(UnknownReason::ExecutionActive)
    } else if o.execution == ExecutionObservation::Unknown {
        Some(UnknownReason::ExecutionUnknown)
    } else if o.outcome != EffectOutcome::Unknown && o.evidence_digest.is_none() {
        Some(UnknownReason::OwnershipUnproven)
    } else {
        None
    };
    if let Some(reason) = reason {
        // Preserve a precise observer failure rather than replacing it with generic partialness.
        if !matches!(
            o.reason,
            UnknownReason::ObserverUnavailable | UnknownReason::UnsupportedAdapter
        ) {
            o.reason = reason;
        }
        o.outcome = EffectOutcome::Unknown;
    } else if o.outcome == EffectOutcome::Unknown {
        if o.reason == UnknownReason::None {
            o.reason = UnknownReason::NotRecorded;
        }
    } else {
        o.reason = UnknownReason::None;
    }
    o
}
fn query_fresh(started: Instant) -> Result<()> {
    if started.elapsed() > FRESH_OBSERVATION_TTL {
        Err(StoreError::new(
            "observationExpired",
            "late effect observation discarded; execution remains unresolved",
        ))
    } else {
        Ok(())
    }
}
fn same_fact(a: &EffectObservation, b: &EffectObservation) -> bool {
    let mut a = a.clone();
    a.query_id = b.query_id.clone();
    a == *b
}

#[cfg(test)]
#[path = "effect_reconciliation_tests.rs"]
mod tests;
