//! Native cancellation and execution policy, supplied to the SQLite connection owner.
use std::{sync::{Arc, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}};
use super::{Result, StoreError};

#[derive(Clone)]
pub(crate) struct CatalogControl {
    pub(crate) cancelled: Arc<AtomicBool>,
    pub(crate) max_vm_instructions: u64,
    pub(crate) started: Instant,
    pub(crate) max_elapsed: Duration,
}
impl CatalogControl {
    pub(crate) fn new(cancelled: Arc<AtomicBool>) -> Self {
        Self { cancelled, max_vm_instructions: 250_000, started: Instant::now(), max_elapsed: Duration::from_millis(250) }
    }
    #[cfg(test)]
    pub(crate) fn cancel(&self) { self.cancelled.store(true, Ordering::Release); }
    pub(crate) fn check(&self) -> Result<()> {
        if self.cancelled.load(Ordering::Acquire) { return Err(StoreError::new("catalogCancelled", "session catalog request was cancelled")); }
        if self.started.elapsed() >= self.max_elapsed { return Err(StoreError::new("catalogDeadline", "session catalog request exceeded its execution deadline")); }
        Ok(())
    }
    #[cfg(test)]
    pub(crate) fn for_test(instructions: u64, elapsed: Duration) -> Self {
        Self { max_vm_instructions: instructions, max_elapsed: elapsed, ..Self::new(Arc::new(AtomicBool::new(false))) }
    }
}
