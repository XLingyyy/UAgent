//! Real T18 read-snapshot -> native host startup barriers. No DDL, dispatch or unlock.
#![cfg(windows)]
use crate::local_run_store::effect_reconciliation::runtime_host_catalog_reader::{
    DurableEffectBarrier, DurableRecoverySnapshot, LegacyUnknown, PhysicalRecoverySnapshot, SnapshotStamp,
};
use crate::local_run_store::RunStore;
use crate::runtime_host_service::{RecoveryAdmission, RecoveryCatalog, ResourceClaim};
use serde::Serialize;
use std::{collections::BTreeMap, sync::{atomic::AtomicBool, Arc, RwLock, OnceLock}, time::{Duration, Instant}};

const MAX_STICKY_BARRIERS: usize = 4096;
const MAX_ADMISSION_SNAPSHOT_AGE: Duration = Duration::from_secs(2);
/// A native OWNED writer/physical-database fence, never a deserialized Boolean/epoch/hash.
/// Must be nonblocking, check stamp.matches_store_instance against the retained original
/// store, and prove its physical database + complete native writer epoch;
/// invalidate BEFORE any writer can publish a new unsafe row, including other connections.
/// This slice installs NO implementation: data_version and a recent scan alone are insufficient.
/// A real implementation must not block an operation on its own newly prepared intent: keep
/// startup/recovery barriers separate from the current host's exact live execution registry.
pub trait CurrentLedgerFence: Send + Sync {
    fn is_current(&self, stamp: &SnapshotStamp) -> bool;
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryCatalogReport {
    pub scan_complete: bool,
    pub status: &'static str,
    pub stamp: Option<SnapshotStamp>,
    pub persistent_effect_barriers: Vec<DurableEffectBarrier>,
    pub legacy_unknown: Vec<LegacyUnknown>,
    pub native_writer_fence_installed: bool,
    /// A descriptive status only; never a caller-supplied grant or release proof.
    pub positive_admission_ready: bool,
}
struct State {
    complete: bool,
    status: &'static str,
    stamp: Option<SnapshotStamp>,
    captured_at: Option<Instant>,
    effects: BTreeMap<(String, String), DurableEffectBarrier>,
    legacy: BTreeMap<(String, String, &'static str, String), LegacyUnknown>,
    scan_running: bool,
    database_pin: Option<Arc<crate::local_run_store::database_owner::NativeDatabasePin>>,
    physical_database_changed: bool,
}
pub struct PersistentRecoveryCatalog {
    state: RwLock<State>,
    fence: Option<Arc<dyn CurrentLedgerFence>>,
    startup_closed: OnceLock<Arc<AtomicBool>>,
    startup_released: OnceLock<Instant>,
}
/// Borrowed while BOTH the actual SQLite write transaction and this original
/// catalog's publication lock remain held. No general Ready flag/fence is installed.
pub(crate) struct TransactionRecoveryAdmission<'fence> {
    catalog: &'fence PersistentRecoveryCatalog,
    state: &'fence State,
    physical: &'fence PhysicalRecoverySnapshot<'fence>,
}
impl TransactionRecoveryAdmission<'_> {
    pub(crate) fn is_for_creation(&self,creation:&Arc<crate::local_run_store::native_run_creation::NativeRunCreation>)->bool {
        self.physical.is_for_creation(creation)
    }
    pub(crate) fn check_execution(&self) -> crate::local_run_store::Result<()> {
        self.physical.check_execution()
    }
    /// Concrete pointer comparison only, never a callback under host/session locks.
    pub(crate) fn is_for_catalog(&self, catalog: &dyn RecoveryCatalog) -> bool {
        std::ptr::eq(self.catalog as *const _ as *const (), catalog as *const _ as *const ())
    }
    pub(crate) fn admission(&self, project: &str, root: Option<&str>, claims: &[ResourceClaim]) -> RecoveryAdmission {
        if self.check_execution().is_err() || !self.state.complete || self.state.scan_running {
            return RecoveryAdmission::Unknown;
        }
        retained_admission(self.state, project, root, claims)
    }
}
impl PersistentRecoveryCatalog {
    /// A's callback only: publish the complete real SAME-transaction snapshot,
    /// retain every old uncertainty, and exclude competing publication until L.
    /// Callback is native short admission only; no SQL/root/transport work belongs in it.
    pub(crate) fn with_transaction_admission<T>(&self, physical: PhysicalRecoverySnapshot<'_>,
        admit: impl for<'fence> FnOnce(TransactionRecoveryAdmission<'fence>) -> crate::local_run_store::Result<T>,
    ) -> crate::local_run_store::Result<T> {
        use crate::local_run_store::StoreError;
        let unavailable = || StoreError {kind:"memoryRecoveryUnavailable".into(),
            message:"complete physical recovery admission is unavailable".into()};
        physical.check_execution()?;
        let mut state = self.state.try_write().map_err(|_|unavailable())?;
        if state.scan_running || state.physical_database_changed { return Err(unavailable()); }
        if state.database_pin.as_ref().is_some_and(|original|
            !original.same_original_database(physical.database_pin())) {
            state.complete=false;
            state.captured_at=None;
            state.status="physical_database_changed";
            state.physical_database_changed=true;
            return Err(unavailable());
        }
        // Retain the ORIGINAL deny-delete handle across all later idle periods
        // and scans; matching strings or a new connection's data_version cannot
        // switch this catalog to another physical database.
        if state.database_pin.is_none() { state.database_pin=Some(physical.database_pin().clone()); }
        if let Err(code) = merge(&mut state, physical.snapshot()) {
            state.complete = false;
            state.captured_at = None;
            state.status = code;
            return Err(unavailable());
        }
        physical.check_execution()?;
        let result = admit(TransactionRecoveryAdmission {catalog:self,state:&state,physical:&physical});
        physical.check_execution()?;
        result
    }
    pub(crate) fn bind_startup_lifetime(&self,closed:Arc<AtomicBool>)->Result<(), &'static str>{
        self.startup_closed.set(closed).map_err(|_|"startup_scan_already_bound")
    }
    fn startup_visible(&self)->bool{
        self.startup_closed.get().map_or(true,|closed|
            !closed.load(std::sync::atomic::Ordering::Acquire)
            && self.startup_released.get().is_some())
    }
    /// Only the original worker's post-release completion calls this.
    pub(crate) fn finish_startup_scan(&self,cancelled:&AtomicBool,deadline:Instant)->bool{
        // Capture the completion instant AFTER all owner observations. No callback or
        // lock acquisition separates this final validation from one-time publication.
        let completed_at=Instant::now();
        if completed_at>=deadline || cancelled.load(std::sync::atomic::Ordering::Acquire)
            || self.startup_closed.get().is_some_and(|closed|closed.load(std::sync::atomic::Ordering::Acquire)){
            return false;
        }
        self.startup_released.set(completed_at).is_ok()
    }
    /// Production default: real scans reveal durable blockers; positive admission stays
    /// Unknown until an actual native writer-ownership fence has been integrated.
    pub fn new() -> Self { Self::construct(None) }
    pub fn with_native_writer_fence(fence: Arc<dyn CurrentLedgerFence>) -> Self { Self::construct(Some(fence)) }
    fn construct(fence: Option<Arc<dyn CurrentLedgerFence>>) -> Self {
        Self { state: RwLock::new(State { complete: false, status: "not_scanned", stamp: None, captured_at: None,
            effects: BTreeMap::new(), legacy: BTreeMap::new(), scan_running: false, database_pin:None, physical_database_changed:false }), fence, startup_closed:OnceLock::new(), startup_released:OnceLock::new() }
    }
    /// Existing native RunStore only. Invoke on the existing bounded worker, outside the
    /// host queue lock; never open a store from a persisted project/root descriptor.
    /// Refresh adds barriers. It cannot remove an old unknown/unsettled barrier.
    pub fn scan_existing_store(&self, store: &RunStore, cancelled: &AtomicBool) -> Result<RecoveryCatalogReport, &'static str> {
        self.scan_startup_store(store,cancelled,Instant::now()+MAX_ADMISSION_SNAPSHOT_AGE)
    }
    /// Publication remains descriptive; it never installs a writer fence.
    pub(crate) fn scan_startup_store(&self,store:&RunStore,cancelled:&AtomicBool,deadline:Instant)
        ->Result<RecoveryCatalogReport,&'static str>{
        if cancelled.load(std::sync::atomic::Ordering::Acquire)||Instant::now()>=deadline {
            self.startup_scan_failed("startup_scan_cancelled_or_expired");
            return Err("startup_scan_cancelled_or_expired");
        }
        let pin=store.pin_runtime_host_database().map_err(|_|"catalog_database_pin_unavailable")?;
        {
            let mut state = self.state.write().map_err(|_| "catalog_unavailable")?;
            if state.physical_database_changed { return Err("physical_database_changed"); }
            if state.database_pin.as_ref().is_some_and(|original|!original.same_original_database(&pin)) {
                state.complete=false;state.captured_at=None;state.status="physical_database_changed";
                state.physical_database_changed=true;
                return Err("physical_database_changed");
            }
            if state.database_pin.is_none(){state.database_pin=Some(pin);}
            if state.scan_running { return Err("catalog_scan_in_progress"); }
            state.scan_running = true;
            state.complete = false;
            state.captured_at = None;
            state.status = "scanning";
        }
        // Catch an unexpected reader panic without discarding retained barriers or poisoning
        // the admission RwLock. The reader's read-transaction rollback still runs on unwind.
        let snapshot = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| store.read_runtime_host_recovery_snapshot(cancelled)));
        let mut state = self.state.write().map_err(|_| "catalog_unavailable")?;
        state.scan_running = false;
        // close sets the same flag before invalidation; recheck under publication lock.
        if cancelled.load(std::sync::atomic::Ordering::Acquire)||Instant::now()>=deadline {
            state.complete=false;state.captured_at=None;state.status="startup_scan_cancelled_or_expired";
            return Err("startup_scan_cancelled_or_expired");
        }
        match snapshot {
            Ok(Ok(snapshot)) => {
                if let Err(code) = merge(&mut state, &snapshot) {
                    state.complete = false; state.status = code; state.captured_at = None;
                }
            }
            Ok(Err(error)) => {
                state.complete = false;
                state.status = match error.kind.as_str() {
                    "catalogScanCancelled" => "scan_cancelled",
                    "catalogScanExpired" => "scan_expired",
                    "catalogScanCapacity" => "scan_capacity",
                    "catalogJournalAbsentOrPartial" => "journal_absent_or_partial",
                    "catalogJournalSchemaUnsupported" => "journal_schema_unsupported",
                    "catalogBaseSchemaUnsupported" => "base_schema_unsupported",
                    "busy" => "database_busy",
                    "corrupt" => "corrupt_catalog",
                    _ => "scan_unavailable",
                };
            }
            Err(_) => { state.complete = false; state.status = "scan_panicked"; }
        }
        Ok(self.report_locked(&state))
    }
    /// Failure preserves retained barriers and the original physical pin.
    pub(crate) fn startup_scan_failed(&self,status:&'static str){
        if let Ok(mut state)=self.state.write(){
            state.complete=false;state.captured_at=None;state.status=status;
        }
    }
    /// Native metadata query. Contains original owner/correlation descriptors, never handles,
    /// approval tickets, raw target bodies, credentials or a persisted executable path to reopen.
    pub fn report(&self) -> Result<RecoveryCatalogReport, &'static str> {
        let state = self.state.try_read().map_err(|_| "catalog_busy_or_unavailable")?;
        Ok(self.report_locked(&state))
    }
    fn stamp_is_current(&self, state: &State) -> bool {
        if !self.startup_visible() || !state.complete || state.scan_running || !state.captured_at.is_some_and(|at| at.elapsed() <= MAX_ADMISSION_SNAPSHOT_AGE) { return false; }
        let (Some(fence), Some(stamp)) = (&self.fence, &state.stamp) else { return false; };
        // The trait is a trusted nonblocking native observer. A panic can only deny admission.
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| fence.is_current(stamp))).unwrap_or(false)
    }
    fn report_locked(&self, state: &State) -> RecoveryCatalogReport {
        RecoveryCatalogReport { scan_complete: state.complete && self.startup_visible(), status: if self.startup_closed.get().is_some_and(|flag|flag.load(std::sync::atomic::Ordering::Acquire)) { "startup_scan_closed" } else if state.complete && !self.startup_visible() { "startup_scan_pending_release" } else if state.complete && state.effects.is_empty() && state.legacy.is_empty() && self.fence.is_none() { "scan_complete_native_fence_required" } else { state.status }, stamp: state.stamp.clone(),
            persistent_effect_barriers: state.effects.values().cloned().collect(), legacy_unknown: state.legacy.values().cloned().collect(),
            native_writer_fence_installed: self.fence.is_some(),
            positive_admission_ready: state.effects.is_empty() && state.legacy.is_empty() && self.stamp_is_current(state) }
    }
}
impl RecoveryCatalog for PersistentRecoveryCatalog {
    fn admission(&self, project_id: &str, root_object_id: Option<&str>, claims: &[ResourceClaim]) -> RecoveryAdmission {
        // Never wait on a scan/publication while the application-wide queue mutex is held.
        let Ok(state) = self.state.try_read() else { return RecoveryAdmission::Unknown; };
        let retained = retained_admission(&state, project_id, root_object_id, claims);
        if retained != RecoveryAdmission::Ready { return retained; }
        if !self.stamp_is_current(&state) { RecoveryAdmission::Unknown } else { RecoveryAdmission::Ready }
    }
}
fn retained_admission(state: &State, project_id: &str, root_object_id: Option<&str>, claims: &[ResourceClaim]) -> RecoveryAdmission {
    if state.effects.values().any(|barrier| barrier.project_id == project_id || root_object_id == Some(barrier.root_object_id.as_str()) ||
        claims.iter().any(|claim| barrier.resources.iter().any(|resource| resource.key == claim.key))) ||
        state.legacy.values().any(|barrier| barrier.project_id == project_id) {
        return RecoveryAdmission::Blocked;
    }
    // Unknown legacy footprints and empty physical claims remain global barriers.
    if !state.legacy.is_empty() || state.effects.values().any(|effect| effect.resources.is_empty()) {
        RecoveryAdmission::Unknown
    } else { RecoveryAdmission::Ready }
}
fn merge(state: &mut State, snapshot: &DurableRecoverySnapshot) -> Result<(), &'static str> {
    if state.physical_database_changed { return Err("physical_database_changed"); }
    for barrier in snapshot.effects() {
        let key = (barrier.project_id.clone(), barrier.operation_id.clone());
        if let Some(old) = state.effects.get(&key) {
            if old.intent_digest != barrier.intent_digest || old.owner != barrier.owner || old.root_object_id != barrier.root_object_id || barrier.revision < old.revision {
                return Err("catalog_identity_or_revision_changed");
            }
        }
        if !state.effects.contains_key(&key) && state.effects.len() + state.legacy.len() >= MAX_STICKY_BARRIERS { return Err("retained_barrier_capacity"); }
        state.effects.insert(key, barrier.clone());
    }
    for barrier in snapshot.legacy() {
        let key = (barrier.project_id.clone(), barrier.run_id.clone(), barrier.source, barrier.record_id.clone());
        if !state.legacy.contains_key(&key) && state.effects.len() + state.legacy.len() >= MAX_STICKY_BARRIERS { return Err("retained_barrier_capacity"); }
        state.legacy.insert(key, barrier.clone());
    }
    // No retain/filter/clear operation: disappearance, newer verified JSON, acknowledgement,
    // cancellation or a second empty scan cannot erase a previously discovered uncertainty.
    state.stamp = Some(snapshot.stamp().clone());
    state.captured_at = Some(Instant::now());
    state.complete = snapshot.pending_native_creators()==0;
    state.status = if snapshot.pending_native_creators()>0 { "native_run_owner_pending" }
        else if !state.legacy.is_empty() { "legacy_unknown_retained" }
        else if !state.effects.is_empty() { "effect_barriers_retained" } else { "scan_complete" };
    Ok(())
}


/// No persistent Ready state is installed. Exclusion applies only to the exact
/// freshly claimed effect in this borrowed SQL transaction; all other barriers stay.
/// Live original callback proof plus one exact reverse preview. Never serialized or rebuilt
/// from a saved phase. Does not retire the original uncertain effect.
pub(crate) struct SettledRepairRestore {
    proof:crate::local_run_store::effect_reconciliation::SettledOperationProof,
    original:crate::local_run_store::effect_reconciliation::EffectIntent,
    digest:String,
    targets:Vec<crate::local_run_store::effect_reconciliation::EffectTarget>,
}
impl SettledRepairRestore {
    pub(crate) fn new(proof:crate::local_run_store::effect_reconciliation::SettledOperationProof,
        original:crate::local_run_store::effect_reconciliation::EffectIntent,
        preview:&crate::ue_build_repair::NativeRepairPreview)->Result<Self,String>{
        use crate::local_run_store::effect_reconciliation::TargetKind;
        let p=&preview.preview;
        if original.adapter.id!="native.ue-source-repair.v1"||original.adapter.version!=1
            ||p.binding.project_id!=original.key.project_id||p.binding.root_object_id!=original.root_object_id
            ||p.files.is_empty()||crate::ue_build_repair_io::hash(&serde_json::to_vec(p).map_err(|_|"restore_encoding")?)!=preview.native_plan_digest {
            return Err("restore_original_binding_required".into());
        }
        let mut seen=std::collections::BTreeSet::new();let mut targets=Vec::new();
        for f in &p.files {
            if !seen.insert(f.path.to_lowercase())||!original.targets.iter().any(|t|t.kind==TargetKind::File
                &&t.locator==f.path&&t.after_digest.as_ref()==Some(&f.before_hash)&&t.before_digest.as_ref()==Some(&f.after_hash)) {
                return Err("restore_exact_reverse_required".into());
            }
            targets.push(crate::local_run_store::effect_reconciliation::EffectTarget{kind:TargetKind::File,locator:f.path.clone(),before_digest:Some(f.before_hash.clone()),after_digest:Some(f.after_hash.clone())});
        }
        Ok(Self{proof,original,digest:preview.native_plan_digest.clone(),targets})
    }
    fn validates(&self,physical:&crate::local_run_store::effect_reconciliation::runtime_host_catalog_reader::OperationRecoverySnapshot<'_>)->bool {
        let i=&physical.record().intent;
        // Completed repairs have no remaining barrier; settlement and the exact reverse plan bind this approval.
        self.proof.matches_intent(&self.original,physical.database_pin())&&i.key!=self.original.key
            &&i.key.project_id==self.original.key.project_id&&i.root_object_id==self.original.root_object_id
            &&i.adapter==self.original.adapter&&i.approved_plan_digest==self.digest&&i.targets==self.targets
            &&i.resources==self.original.resources
    }
    fn excludes_run_summary(&self,b:&LegacyUnknown)->bool {
        b.source=="runs"&&b.status=="needsReconciliation"&&b.project_id==self.original.key.project_id
            &&b.run_id==self.original.owner.run_id&&b.record_id==self.original.owner.run_id
    }
    fn excludes(&self,b:&DurableEffectBarrier)->bool {
        b.project_id==self.original.key.project_id&&b.operation_id==self.original.key.operation_id
            &&b.intent_digest==self.original.digest().unwrap_or_default()&&b.owner==self.original.owner
            &&b.root_object_id==self.original.root_object_id
            &&b.dispatch.phase==crate::local_run_store::effect_reconciliation::DispatchPhase::Settled
    }
}
pub(crate) struct OperationRecoveryAdmission<'a> {
    catalog:&'a PersistentRecoveryCatalog,
    state:&'a State,
    physical:&'a crate::local_run_store::effect_reconciliation::runtime_host_catalog_reader::OperationRecoverySnapshot<'a>,
    restore:Option<&'a SettledRepairRestore>,
}
impl OperationRecoveryAdmission<'_> {
    pub(crate) fn is_for_catalog(&self,catalog:&dyn RecoveryCatalog)->bool{
        std::ptr::eq(self.catalog as *const _ as *const (),catalog as *const _ as *const ())
    }
    pub(crate) fn record(&self)->&crate::local_run_store::effect_reconciliation::EffectRecord{self.physical.record()}
    pub(crate) fn ready(&self)->bool {
        if self.physical.check().is_err()||!self.state.complete||self.state.scan_running{return false;}
        if self.restore.is_some_and(|r|!r.validates(self.physical)){return false;}
        let record=self.record();let intent=&record.intent;
        if self.state.legacy.values().any(|b|!self.restore.is_some_and(|r|r.excludes_run_summary(b))){return false;}
        !self.state.effects.values().any(|b|{
            let own=b.project_id==intent.key.project_id&&b.operation_id==intent.key.operation_id
                &&b.intent_digest==record.intent_digest&&b.owner==intent.owner&&b.revision==record.revision
                &&b.dispatch.phase==crate::local_run_store::effect_reconciliation::DispatchPhase::InCallback;
            let restoring=self.restore.is_some_and(|r|r.excludes(b));
            !own&&!restoring&&(b.resources.is_empty()||b.project_id==intent.key.project_id||b.root_object_id==intent.root_object_id
                ||b.resources.iter().any(|a|intent.resources.iter().any(|c|a.key==c.key)))
        })
    }
}
impl PersistentRecoveryCatalog {
    pub(crate) fn with_operation_admission<T>(
        &self,physical:crate::local_run_store::effect_reconciliation::runtime_host_catalog_reader::OperationRecoverySnapshot<'_>,
        admit:impl FnOnce(OperationRecoveryAdmission<'_>)->crate::local_run_store::Result<T>,
    )->crate::local_run_store::Result<T>{
        self.with_restore_operation_admission(physical,None,admit)
    }
    pub(crate) fn with_restore_operation_admission<T>(
        &self,physical:crate::local_run_store::effect_reconciliation::runtime_host_catalog_reader::OperationRecoverySnapshot<'_>,
        restore:Option<&SettledRepairRestore>,
        admit:impl FnOnce(OperationRecoveryAdmission<'_>)->crate::local_run_store::Result<T>,
    )->crate::local_run_store::Result<T>{
        use crate::local_run_store::StoreError;
        let unavailable=||StoreError{kind:"operationRecoveryUnavailable".into(),message:"original operation transaction admission is unavailable".into()};
        physical.check()?;
        let mut state=self.state.try_write().map_err(|_|unavailable())?;
        if state.scan_running||state.physical_database_changed{return Err(unavailable());}
        if state.database_pin.as_ref().is_some_and(|pin|!pin.same_original_database(physical.database_pin())){
            state.physical_database_changed=true;state.complete=false;state.status="physical_database_changed";
            return Err(unavailable());
        }
        if state.database_pin.is_none(){state.database_pin=Some(physical.database_pin().clone());}
        merge(&mut state,physical.snapshot()).map_err(|_|unavailable())?;
        physical.check()?;
        let result=admit(OperationRecoveryAdmission{catalog:self,state:&state,physical:&physical,restore});
        physical.check()?;
        result
    }
}

impl PersistentRecoveryCatalog {
    /// Only the original native completion can retire its exact known effect.
    /// Saved data, an empty scan or acknowledgement never calls this path.
    pub(crate) fn retire_original_settled_operation(&self,
        proof:&crate::local_run_store::effect_reconciliation::SettledOperationProof,
        result:&crate::local_run_store::effect_reconciliation::ReconciliationResult,
        scope:&crate::local_run_store::effect_reconciliation::RecoveryReadScope<'_>,
    )->Result<bool,&'static str>{
        use crate::local_run_store::effect_reconciliation::{EffectState,ExecutionObservation};
        let record=&result.record;
        if result.execution_observation(scope)!=ExecutionObservation::Quiescent||record.manual_review_required
            ||!matches!(record.state,EffectState::VerifiedCompleted|EffectState::VerifiedNotOccurred){return Ok(false);}
        let mut state=self.state.try_write().map_err(|_|"catalog_busy_or_unavailable")?;
        if state.physical_database_changed||!state.database_pin.as_ref().is_some_and(|pin|proof.matches(record,pin)){
            return Err("catalog_original_settlement_required");
        }
        let key=(record.intent.key.project_id.clone(),record.intent.key.operation_id.clone());
        if let Some(barrier)=state.effects.get(&key){
            if barrier.intent_digest!=record.intent_digest||barrier.owner!=record.intent.owner
                ||barrier.root_object_id!=record.intent.root_object_id||barrier.revision>record.revision{
                return Err("catalog_settlement_identity_changed");
            }
        }else{return Ok(false);}
        state.effects.remove(&key);
        // No stamp refresh, legacy clearing, new owner or positive global admission.
        Ok(true)
    }
}
