//! Shared production Store task/release and startup-scan coordination.
//! No Tauri/transport adapter. The owning state passes its original OnceLocks/closed Arc.
#![cfg(windows)]
use crate::local_run_store::{RunStore, StoreError};
use std::{sync::{atomic::{AtomicBool, Ordering}, Arc, OnceLock}, time::{Duration, Instant}};

pub(super) type StoreResult<T> = Result<T, StoreError>;
pub(super) const OPERATION_TIMEOUT: Duration = Duration::from_secs(15);
pub(super) fn unavailable() -> StoreError { StoreError { kind: "unavailable".into(), message: "the managed RunStore owner is unavailable".into() } }
pub(super) fn expired(write: bool) -> StoreError { StoreError { kind: if write { "outcomeUnknown" } else { "busy" }.into(),
    message: if write { "the submitted local mutation outcome is unknown; refresh before retrying" } else { "the managed store request expired" }.into() } }

/// Native-only queue owner. ConnectionLease enforces the same gate on legacy opens.
/// This local CRUD port must never be presented as a recovery or dispatch fence.
pub(crate) trait NativeManagedStoreOwner: Send + Sync {
    fn is_current(&self) -> bool;
    fn submit(&self, work: ManagedStoreWork) -> StoreResult<()>;
    /// Request native worker shutdown; never block UI or close a SQLite handle on another thread.
    fn close(&self);
}

pub(crate) struct ManagedStoreWork {
    pub(super) write: bool,
    pub(super) deadline: Instant,
    pub(super) cancelled: Arc<AtomicBool>,
    pub(super) apply: Option<Box<dyn FnOnce(&RunStore) + Send>>,
    pub(super) complete: Option<Box<dyn FnOnce(&ReleasedStoreDomain) + Send>>,
    pub(super) reject: Option<Box<dyn FnOnce(StoreError) + Send>>,
}
impl ManagedStoreWork {
    pub(crate) fn deadline(&self) -> Instant { self.deadline }
    pub(crate) fn cancelled(&self) -> Arc<AtomicBool> { self.cancelled.clone() }
    /// Consume the connection and scope on their original worker. Completion may
    /// transfer a native value only AFTER both have been dropped and their release
    /// failures have had an opportunity to quarantine this storage domain.
    pub(crate) fn run(mut self, store: RunStore,
        operation: crate::local_run_store::database_owner::OperationScope) {
        let stopped = self.cancelled.load(Ordering::Acquire) || Instant::now() >= self.deadline;
        let panicked = if stopped { false } else {
            let apply = self.apply.take();
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                if let Some(apply) = apply { apply(&store); }
            })).is_err()
        };
        if panicked { crate::local_run_store::database_owner::quarantine(); }
        drop(store);
        drop(operation);
        if stopped || panicked || !crate::local_run_store::database_owner::available() {
            let error = if self.write { expired(true) } else { unavailable() };
            self.reject(error);
            return;
        }
        let released=ReleasedStoreDomain{worker:std::thread::current().id(),_thread:std::marker::PhantomData};
        if let Some(complete) = self.complete.take() { complete(&released); }
        self.reject.take();
    }
    pub(crate) fn reject(mut self, error: StoreError) {
        // Destroy the never-entered closure's native request envelope BEFORE reply.
        // No future/queue can run this unique FnOnce after it has been dropped.
        drop(self.apply.take());
        drop(self.complete.take());
        if let Some(reject) = self.reject.take() { reject(error); }
    }
}
impl Drop for ManagedStoreWork {
    fn drop(&mut self) {
        let unwinding=std::thread::panicking();
        if unwinding { crate::local_run_store::database_owner::quarantine(); }
        drop(self.apply.take());
        drop(self.complete.take());
        if let Some(reject) = self.reject.take() { reject(if unwinding&&self.write { expired(true) } else { unavailable() }); }
    }
}
/// Constructed only by run() after the exact store and operation scope drop.
/// A borrowed !Send witness cannot be serialized, cloned or exported to sender.
pub(crate) struct ReleasedStoreDomain {
    worker:std::thread::ThreadId,
    _thread:std::marker::PhantomData<std::rc::Rc<()>>,
}
impl ReleasedStoreDomain {
    pub(crate) fn check_current(&self)->StoreResult<()>{
        if self.worker!=std::thread::current().id() || !crate::local_run_store::database_owner::available(){
            return Err(unavailable());
        }
        Ok(())
    }
}
/// Setup-only, once per owner. No renderer can request a scan or a retry.
pub(super) fn schedule_startup_scan(
    startup_catalog: &OnceLock<Arc<crate::runtime_host_recovery_catalog::PersistentRecoveryCatalog>>,
    owner_slot: &OnceLock<Arc<dyn NativeManagedStoreOwner>>,
    closed: &Arc<AtomicBool>,
    catalog: Arc<crate::runtime_host_recovery_catalog::PersistentRecoveryCatalog>) -> StoreResult<()> {
    startup_catalog.set(catalog.clone()).map_err(|_|unavailable())?;
    catalog.bind_startup_lifetime(closed.clone()).map_err(|_|unavailable())?;
    let owner = match owner_slot.get().cloned().filter(|owner|current(owner)) {
        Some(owner) if !closed.load(Ordering::Acquire) => owner,
        _ => {catalog.startup_scan_failed("startup_scan_unavailable");return Err(unavailable());}
    };
    let deadline=Instant::now()+OPERATION_TIMEOUT;
    let cancelled=closed.clone();
    let scan_catalog=catalog.clone();let scan_cancelled=cancelled.clone();
    let finish_catalog=catalog.clone();let finish_cancelled=cancelled.clone();
    let finish_owner=owner.clone();let reject_catalog=catalog.clone();
    let task=ManagedStoreWork{write:false,deadline,cancelled,
        apply:Some(Box::new(move |store|{
            if scan_catalog.scan_startup_store(store,&scan_cancelled,deadline).is_err(){
                scan_catalog.startup_scan_failed("startup_scan_unavailable");
            }
        })),
        complete:Some(Box::new(move |released|{
            complete_startup_scan(released,&finish_owner,&finish_catalog,&finish_cancelled,deadline);
        })),
        reject:Some(Box::new(move |_|reject_catalog.startup_scan_failed("startup_scan_rejected"))),
    };
    let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||owner.submit(task)))
        .map_err(|_|unavailable()).and_then(|result|result);
    if result.is_err(){catalog.startup_scan_failed("startup_scan_submit_failed");}
    result
}

/// Owner observation may take time; no owner callback follows final checked publication.
fn complete_startup_scan(released:&ReleasedStoreDomain,owner:&Arc<dyn NativeManagedStoreOwner>,
    catalog:&crate::runtime_host_recovery_catalog::PersistentRecoveryCatalog,
    cancelled:&AtomicBool,deadline:Instant){
    if released.check_current().is_err() || !current(owner){
        catalog.startup_scan_failed("startup_scan_completion_revoked");
    } else if !catalog.finish_startup_scan(cancelled,deadline){
        catalog.startup_scan_failed("startup_scan_completion_revoked");
    }
}
pub(super) fn current(owner: &Arc<dyn NativeManagedStoreOwner>) -> bool {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| owner.is_current())).unwrap_or(false)
}


#[cfg(test)]
#[path = "managed_startup_recovery_tests.rs"]
mod startup_recovery_tests;
