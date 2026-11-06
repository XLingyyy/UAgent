//! Concrete native memory-model reservation and final physical-snapshot admission.
//! Validation reservations are visible BEFORE scheduling and grant no right to send.
use super::*;
use crate::runtime_host_recovery_catalog::{PersistentRecoveryCatalog, TransactionRecoveryAdmission};
use crate::trusted_root_handle::TrustedRootHandle;

/// Descriptive comparisons from the SAME native session owner; never authority.
pub(crate) struct NativeModelOwner<'a> {
    pub project: &'a str,
    pub run: &'a str,
    pub conversation: &'a str,
    pub provider: &'a str,
    pub model: &'a str,
}
impl NativeResourceBinding {
    /// A read-only model pin has no invented UE/write resource claim.
    fn for_memory_model(root: Arc<TrustedRootHandle>) -> HostResult<Self> {
        root.check_current().map_err(|_|"runtime_host_root_stale")?;
        Ok(Self {root_object_id:root.identity().observation_key(),held:Some(root),claims:vec![]})
    }
}
impl RuntimeHostService {
    /// Native run owner only. A queued validation reservation is NOT positive
    /// recovery admission. Only lock_memory_admission + the real SQL witness can
    /// start it. The unique return value MUST move into the original sender.
    pub(crate) fn register_memory_model_pending(&self, window: &str, input: ModelJobInput,
        root: Arc<TrustedRootHandle>, expected: &OwnerIdentity,
        catalog: &Arc<PersistentRecoveryCatalog>,
        creation:Arc<crate::local_run_store::native_run_creation::NativeRunCreation>,run_alive:Arc<AtomicBool>,
    ) -> HostResult<RegisteredExecution> {
        creation.check_original_owner(&run_alive).map_err(|_|"runtime_host_native_creation_required")?;
        valid_id(&input.job_id)?;
        valid_id(&input.step_id)?;
        if !(1..=3_600_000).contains(&input.queue_timeout_ms)
            || !(1..=3_600_000).contains(&input.execution_timeout_ms) {
            return Err("runtime_host_invalid_timeout");
        }
        let resources = NativeResourceBinding::for_memory_model(root)?;
        let mut inner = self.lock()?;
        let now = Instant::now();
        refresh(&mut inner,now);
        prune(&mut inner,now);
        self.check_owner(&inner,window,&input.owner,true)?;
        if inner.closed || !inner.monitor_active { return Err("runtime_host_closed"); }
        let installed = inner.catalog.as_ref().ok_or("runtime_host_recovery_blocked")?;
        if !std::ptr::eq(Arc::as_ptr(installed) as *const (), Arc::as_ptr(catalog) as *const ()) {
            return Err("runtime_host_catalog_changed");
        }
        let original = inner.owners.get(&input.owner.owner_id).ok_or("runtime_host_owner_unknown")?;
        if original.identity != *expected { return Err("runtime_host_owner_mismatch"); }
        if inner.jobs.len() >= MAX_JOBS { return Err("runtime_host_capacity"); }
        if inner.jobs.iter().any(|job|job.ticket.owner_id==input.owner.owner_id && job.job_id==input.job_id) {
            return Err("runtime_host_duplicate_job");
        }
        if inner.jobs.iter().filter(|job|job.kind==JobKind::Model && job.holds()).count()>=3 {
            return Err("runtime_host_model_capacity");
        }
        let ticket = TicketRef {host_generation:self.generation.to_string(),
            owner_id:input.owner.owner_id,ticket_id:random_id()?};
        let identity = NativeExecutionIdentity {ticket:ticket.clone(),owner:expected.clone(),
            execution_id:random_id()?,step_id:input.step_id.clone()};
        let cancel=Arc::new(AtomicBool::new(false));
        let duration=Duration::from_millis(input.execution_timeout_ms.min(input.queue_timeout_ms));
        inner.jobs.push_back(Job {ticket,job_id:input.job_id,step_id:input.step_id,
            execution_id:identity.execution_id.clone(),project_id:expected.project_id.clone(),
            kind:JobKind::Model,phase:JobPhase::HandoffPending,reason:Some("memory_recovery_validation_pending"),
            queued_deadline:now+duration,execution_duration:duration,execution_deadline:Some(now+duration),
            finished_at:None,resources:Some(resources),observer:None,
            observation:ExecutionObservation::Unknown,observing:false,callback_settled:false,
            began:false,requires_memory_transaction:true,requires_operation_transaction:false,native_creation:Some(creation),cancel:cancel.clone()});
        Ok(RegisteredExecution {host:self.clone(),identity,cancel,closed:false})
    }
}

/// SQL -> original catalog publication -> host -> NativeSession is the sole order.
/// No trait callback/root I/O/broker lookup occurs while this guard is alive.
pub(crate) struct MemoryHostAdmission<'host,'fence> {
    inner: MutexGuard<'host,Inner>,
    identity: &'host NativeExecutionIdentity,
    cancel: &'host Arc<AtomicBool>,
    closed: &'host bool,
    recovery: &'host TransactionRecoveryAdmission<'fence>,
}
impl RegisteredExecution {
    pub(crate) fn lock_memory_admission<'host,'fence>(&'host mut self,
        recovery: &'host TransactionRecoveryAdmission<'fence>,
    ) -> HostResult<MemoryHostAdmission<'host,'fence>> {
        if self.closed { return Err("runtime_host_dispatch_already_claimed"); }
        // No refresh(): it calls the generic catalog observer, which is not
        // allowed to reenter the held physical catalog publication domain.
        let inner=self.host.lock()?;
        let installed=inner.catalog.as_ref().ok_or("runtime_host_recovery_blocked")?;
        if !recovery.is_for_catalog(installed.as_ref()) { return Err("runtime_host_catalog_changed"); }
        Ok(MemoryHostAdmission {inner,identity:&self.identity,cancel:&self.cancel,
            closed:&self.closed,recovery})
    }
    /// AFTER L only; it cannot mint a replacement physical recovery proof.
    pub(crate) fn check_started_memory_owner(&self,owner:&NativeModelOwner<'_>,
        root:&Arc<TrustedRootHandle>) -> HostResult<()> {
        let inner=self.host.lock()?;
        validate_owned_model(&inner,&self.identity,&self.cancel,self.closed,owner,root,true)
    }
}
fn validate_owned_model(inner:&Inner,identity:&NativeExecutionIdentity,cancel:&Arc<AtomicBool>,
    closed:bool,expected:&NativeModelOwner<'_>,root:&Arc<TrustedRootHandle>,began:bool,
) -> HostResult<()> {
    let now=Instant::now();
    if closed || inner.closed || !inner.monitor_active { return Err("runtime_host_dispatch_revoked"); }
    let owner=inner.owners.get(&identity.ticket.owner_id).ok_or("runtime_host_owner_unknown")?;
    if !owner.connected || owner.expires<=now || owner.identity!=identity.owner
        || owner.identity.project_id!=expected.project || owner.identity.run_id!=expected.run
        || owner.identity.conversation_id!=expected.conversation || owner.identity.provider_id!=expected.provider
        || owner.identity.model_id!=expected.model { return Err("runtime_host_owner_revoked"); }
    let job=inner.jobs.iter().find(|job|job.ticket==identity.ticket).ok_or("runtime_host_job_unknown")?;
    if job.execution_id!=identity.execution_id || job.step_id!=identity.step_id
        || job.project_id!=expected.project || job.kind!=JobKind::Model || job.began!=began
        || !job.requires_memory_transaction || job.callback_settled || !Arc::ptr_eq(&job.cancel,cancel) || cancel.load(Ordering::SeqCst)
        || job.execution_deadline.map_or(true,|deadline|deadline<=now)
        || job.phase!=(if began {JobPhase::Running} else {JobPhase::HandoffPending})
        || root.is_revoked() { return Err("runtime_host_dispatch_revoked"); }
    job.native_creation.as_ref().ok_or("runtime_host_native_creation_required")?
        .check_bound_liveness().map_err(|_|"runtime_host_dispatch_revoked")?;
    let binding=job.resources.as_ref().ok_or("runtime_host_root_pin_missing")?;
    let pin=binding.held.as_ref().ok_or("runtime_host_root_pin_missing")?;
    if !binding.claims.is_empty()
        || !std::ptr::eq(Arc::as_ptr(pin) as *const (),Arc::as_ptr(root) as *const ()) {
        return Err("runtime_host_root_stale");
    }
    Ok(())
}
impl MemoryHostAdmission<'_,'_> {
    pub(crate) fn start_at_l(&mut self,owner:&NativeModelOwner<'_>,root:&Arc<TrustedRootHandle>) -> HostResult<()> {
        self.recovery.check_execution().map_err(|_|"runtime_host_dispatch_revoked")?;
        validate_owned_model(&self.inner,self.identity,self.cancel,*self.closed,owner,root,false)?;
        let job=self.inner.jobs.iter().find(|job|job.ticket==self.identity.ticket).ok_or("runtime_host_job_unknown")?;
        if !job.native_creation.as_ref().is_some_and(|creation|self.recovery.is_for_creation(creation)) {
            return Err("runtime_host_native_creation_required");
        }
        if self.recovery.admission(&job.project_id,job.root(),job.claims())!=RecoveryAdmission::Ready {
            return Err("runtime_host_recovery_blocked");
        }
        // A read-only model has no fabricated write claim, but live/queued native
        // operations on the SAME project/root must still be respected at L.
        if self.inner.jobs.iter().any(|other|other.ticket!=job.ticket && other.kind==JobKind::Operation
            && (other.holds()||other.phase==JobPhase::Queued)
            && (other.project_id==job.project_id || (other.root().is_some()&&other.root()==job.root()))) {
            return Err("runtime_host_resource_conflict");
        }
        self.recovery.check_execution().map_err(|_|"runtime_host_dispatch_revoked")?;
        // Final clock/cancel/identity checks are in this SAME host critical section.
        validate_owned_model(&self.inner,self.identity,self.cancel,*self.closed,owner,root,false)?;
        let job=find_job(&mut self.inner,&self.identity.ticket)?;
        job.began=true;
        job.phase=JobPhase::Running;
        job.reason=None;
        Ok(())
    }
}


#[cfg(test)]
#[path = "runtime_host_memory_admission_tests.rs"]
mod tests;
