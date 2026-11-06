//! Private admission for a task model request without selected project-memory records.
//! Uses the existing physical recovery catalog, model lane and final transport lock.
use super::*;
use crate::local_run_store::{native_run_creation::NativeRunCreation, project_memory::MemoryExecution, RunStore, StoreError};
use crate::managed_run_store::ReleasedStoreDomain;
use crate::runtime_host_recovery_catalog::{PersistentRecoveryCatalog, TransactionRecoveryAdmission};
use crate::runtime_host_service::{NativeModelOwner, RegisteredExecution};
use crate::trusted_root_handle::TrustedRootHandle;

struct Unstarted(Option<RegisteredExecution>);
impl Drop for Unstarted {
    fn drop(&mut self) {
        if let Some(execution) = self.0.take() { let _ = execution.finish_not_started(); }
    }
}
pub(crate) struct TaskPreflight {
    execution: Unstarted,
    session: NativeSession,
    request: Arc<PreparedRequest>,
    lease: Lease,
    approval: ApprovalGrant,
    root: Arc<TrustedRootHandle>,
    creation: Arc<NativeRunCreation>,
    alive: Arc<AtomicBool>,
    checker: Arc<dyn SourceChecker>,
    transport_identity: Arc<()>,
}
pub(crate) struct TaskTransport<'a> {
    transport: &'a mut dyn Transport,
    identity: Arc<()>,
}
pub(crate) struct PendingTaskPermit {
    session: NativeSession,
    request: Arc<PreparedRequest>,
    lease: Lease,
    root: Arc<TrustedRootHandle>,
    checker: Arc<dyn SourceChecker>,
    transport_identity: Arc<()>,
    credential: Secret,
    execution: RegisteredExecution,
}
pub(crate) struct ReadyTaskPermit(PendingTaskPermit);

fn host_owner(owner: &Owner) -> NativeModelOwner<'_> {
    NativeModelOwner { project: &owner.project, run: &owner.run, conversation: &owner.conversation,
        provider: &owner.provider, model: &owner.model }
}
fn store_error(code: FailureCode) -> StoreError {
    StoreError { kind: code.code().into(), message: "native task model admission was revoked".into() }
}
// Call only after validating the lease under the session lock. DispatchSignal
// also locks that session, so using it in this critical section would deadlock.
fn cancelled_under_session_lock(request: &PreparedRequest) -> bool {
    request.cancelled.load(Ordering::Acquire)
        || request.host_cancel.get().is_some_and(|flag| flag.load(Ordering::Acquire))
}

impl NativeSession {
    /// Native task admission supplies the original creation, live owner and root.
    /// Model/tool JSON cannot construct any of these capabilities.
    pub(crate) fn task_preflight<'a>(&self, request: Arc<PreparedRequest>, lease: Lease, approval: ApprovalGrant,
        execution: RegisteredExecution, root: Arc<TrustedRootHandle>, creation: Arc<NativeRunCreation>,
        alive: Arc<AtomicBool>, checker: Arc<dyn SourceChecker>, transport: &'a mut dyn Transport,
    ) -> Result<(TaskPreflight, TaskTransport<'a>)> {
        let cancel = execution.cancellation();
        let execution = Unstarted(Some(execution));
        if request.memory.is_some() || request.memory_marker { return Err(FailureCode::MemoryFenceRequired); }
        creation.check_original_owner(&alive).map_err(|_| FailureCode::Cancelled)?;
        root.check_current().map_err(|_| FailureCode::SourceChanged)?;
        request.host_cancel.set(cancel).map_err(|_| FailureCode::GrantConsumed)?;
        request.matches_lease(&lease)?;
        request.verify_body()?;
        self.check_source(&lease, checker.as_ref(), SourcePhase::BeforeDispatch)?;
        transport.before_dispatch(request.view()).map_err(|_| FailureCode::TransportFailed)?;
        let identity = Arc::new(());
        Ok((TaskPreflight { execution, session: self.clone(), request, lease, approval, root, creation,
            alive, checker, transport_identity: identity.clone() }, TaskTransport { transport, identity }))
    }

    pub(crate) fn verify_task_on_store(&self, preflight: TaskPreflight, store: &RunStore,
        execution: &MemoryExecution<'_>, catalog: &PersistentRecoveryCatalog,
    ) -> crate::local_run_store::Result<PendingTaskPermit> {
        let creation = preflight.creation.clone();
        let alive = preflight.alive.clone();
        store.with_owned_task_recovery_snapshot(execution, &creation, &alive, |physical| {
            catalog.with_transaction_admission(physical, |recovery| {
                self.admit_task(preflight, &recovery).map_err(store_error)
            })
        })
    }

    fn admit_task(&self, mut preflight: TaskPreflight, recovery: &TransactionRecoveryAdmission<'_>)
        -> Result<PendingTaskPermit> {
        if !self.same_instance(&preflight.session) { return Err(FailureCode::InvalidLease); }
        let credential = {
            // Same concrete order as memory sends: SQL -> catalog -> host -> session.
            let mut host = preflight.execution.0.as_mut().ok_or(FailureCode::Unavailable)?
                .lock_memory_admission(recovery).map_err(|_| FailureCode::Cancelled)?;
            let state = self.shared.state.lock().map_err(|_| FailureCode::Unavailable)?;
            self.validate(&state, &preflight.lease)?;
            recovery.check_execution().map_err(|_| FailureCode::Cancelled)?;
            if preflight.root.is_revoked() || cancelled_under_session_lock(&preflight.request) { return Err(FailureCode::Cancelled); }
            if !Arc::ptr_eq(&preflight.request.identity, &preflight.approval.request)
                || !Arc::ptr_eq(&preflight.lease.0, &preflight.approval.lease.0)
                || preflight.approval.binding != preflight.request.binding || preflight.approval.memory.is_some()
            { return Err(FailureCode::ApprovalMismatch); }
            if preflight.approval.consumed.load(Ordering::Acquire)
                || preflight.request.progress.load(Ordering::Acquire) != 0 { return Err(FailureCode::GrantConsumed); }
            let credential = Secret(state.credential.as_ref().ok_or(FailureCode::MissingCredential)?.secret.0.clone());
            self.validate(&state, &preflight.lease)?;
            recovery.check_execution().map_err(|_| FailureCode::Cancelled)?;
            host.start_at_l(&host_owner(&preflight.request.binding.owner), &preflight.root)
                .map_err(|_| FailureCode::Cancelled)?;
            preflight.approval.consumed.store(true, Ordering::Release);
            preflight.request.progress.store(1, Ordering::Release);
            credential
        };
        let execution = preflight.execution.0.take().ok_or(FailureCode::Unavailable)?;
        Ok(PendingTaskPermit { session: self.clone(), request: preflight.request, lease: preflight.lease,
            root: preflight.root, checker: preflight.checker, transport_identity: preflight.transport_identity,
            credential, execution })
    }
}

impl PendingTaskPermit {
    fn check_host(&self) -> Result<()> {
        self.execution.check_started_memory_owner(&host_owner(&self.request.binding.owner), &self.root)
            .map_err(|_| FailureCode::Cancelled)
    }
    pub(crate) fn finish_owner_release(self, domain: &ReleasedStoreDomain) -> Result<ReadyTaskPermit> {
        domain.check_current().map_err(|_| FailureCode::Unavailable)?;
        self.check_host()?;
        {
            let state = self.session.shared.state.lock().map_err(|_| FailureCode::Unavailable)?;
            self.session.validate(&state, &self.lease)?;
            if cancelled_under_session_lock(&self.request) || self.root.is_revoked() { return Err(FailureCode::Cancelled); }
            if self.request.progress.load(Ordering::Acquire) != 1 { return Err(FailureCode::GrantConsumed); }
        }
        domain.check_current().map_err(|_| FailureCode::Unavailable)?;
        self.check_host()?;
        Ok(ReadyTaskPermit(self))
    }
}

impl ReadyTaskPermit {
    pub(crate) fn send(self, transport: TaskTransport<'_>) -> DispatchOutcome {
        let permit = self.0;
        let checked = (|| -> Result<()> {
            if !Arc::ptr_eq(&permit.transport_identity, &transport.identity) { return Err(FailureCode::ApprovalMismatch); }
            permit.check_host()?;
            permit.root.check_current().map_err(|_| FailureCode::SourceChanged)?;
            permit.session.check_source(&permit.lease, permit.checker.as_ref(), SourcePhase::BeforeDispatch)?;
            let state = permit.session.shared.state.lock().map_err(|_| FailureCode::Unavailable)?;
            permit.session.validate(&state, &permit.lease)?;
            if cancelled_under_session_lock(&permit.request) { return Err(FailureCode::Cancelled); }
            if permit.request.progress.load(Ordering::Acquire) != 1 { return Err(FailureCode::GrantConsumed); }
            Ok(())
        })();
        let mut outcome = match checked {
            Err(code) => permit.request.failed(code),
            Ok(()) => permit.session.dispatch_with_credential(&permit.request, &permit.lease, &permit.credential, transport.transport),
        };
        if permit.check_host().is_err() { outcome.error = Some(FailureCode::Cancelled); outcome.response = None; }
        match permit.execution.finish(outcome.error.is_none()) {
            Ok(settled) if !settled.cancel_requested => {},
            _ => { outcome.error = Some(FailureCode::Cancelled); outcome.response = None; },
        }
        outcome
    }
}

#[cfg(test)]
#[path = "native_task_admission_tests.rs"]
mod tests;
