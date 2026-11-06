//! Include as a CHILD of sqlite.rs: #[path = "sqlite_runtime_host_scan.rs"] mod runtime_host_scan;
//! Same exclusive native worker connection; no raw handle escapes this module.
use super::{c_int, c_void, ptr, sqlite3_busy_timeout, Db, Result, StoreError};
use std::{cell::Cell, sync::atomic::{AtomicBool, Ordering}, time::{Duration, Instant}};

const PROGRESS_INTERVAL: c_int = 1000;
const MAX_VM_INSTRUCTIONS: u64 = 16_000_000;
const SQLITE_LIMIT_LENGTH: c_int = 0;
const MAX_SQL_VALUE_BYTES: c_int = 512 * 1024;
const MAX_BUSY_MS: c_int = 50;

#[link(name = "winsqlite3", kind = "raw-dylib")]
extern "C" {
    fn sqlite3_progress_handler(db: *mut c_void, interval: c_int,
        callback: Option<unsafe extern "C" fn(*mut c_void) -> c_int>, context: *mut c_void);
    fn sqlite3_limit(db: *mut c_void, category: c_int, value: c_int) -> c_int;
}

fn incomplete(kind: &str) -> StoreError {
    StoreError::new(kind, "persistent recovery catalog exceeded its native scan budget; admission remains unknown")
}
struct ProgressBudget<'a> {
    started: Instant,
    max_elapsed: Duration,
    cancelled: &'a AtomicBool,
    remaining: Cell<u64>,
    stopped: Cell<Option<&'static str>>,
}
impl ProgressBudget<'_> {
    fn stop_reason(&self) -> Option<&'static str> {
        let reason = self.stopped.get().or_else(|| {
            if self.cancelled.load(Ordering::Acquire) { Some("catalogScanCancelled") }
            else if self.started.elapsed() >= self.max_elapsed { Some("catalogScanExpired") }
            else { None }
        });
        if let Some(reason) = reason { self.stopped.set(Some(reason)); }
        reason
    }
    fn check(&self) -> Result<()> {
        if let Some(reason) = self.stop_reason() { return Err(incomplete(reason)); }
        Ok(())
    }
}
unsafe extern "C" fn progress(context: *mut c_void) -> c_int {
    // Boxed state outlives every statement and is detached before it can be freed.
    let state = &*(context as *const ProgressBudget<'_>);
    if state.stop_reason().is_some() { return 1; }
    if state.remaining.get() <= PROGRESS_INTERVAL as u64 {
        state.stopped.set(Some("catalogScanCapacity"));
        return 1;
    }
    state.remaining.set(state.remaining.get() - PROGRESS_INTERVAL as u64);
    0
}
struct ConnectionBudget<'db, 'cancel> {
    db: &'db Db,
    state: Box<ProgressBudget<'cancel>>,
    previous_busy_ms: c_int,
    previous_length: c_int,
    _sql_budget_lease: super::project_memory_budget::ScopedSqlBudgetLease,
}
impl<'db, 'cancel> ConnectionBudget<'db, 'cancel> {
    fn install(db: &'db Db, cancelled: &'cancel AtomicBool, max_elapsed: Duration, instructions: u64) -> Result<Self> {
        let sql_budget_lease = db.claim_scoped_sql_budget()?;
        let state = Box::new(ProgressBudget { started: Instant::now(), max_elapsed, cancelled,
            remaining: Cell::new(instructions), stopped: Cell::new(None) });
        state.check()?;
        // RunStore owns this connection on one worker. Scoped search/scan handlers never
        // overlap; the normal connection has no persistent progress or custom busy handler.
        let busy = db.query("PRAGMA busy_timeout", &[])?;
        let previous_busy_ms = c_int::try_from(busy[0][0].int()?).map_err(|_| StoreError::corrupt())?;
        if previous_busy_ms < 0 { return Err(StoreError::corrupt()); }
        let previous_length = unsafe { sqlite3_limit(db.0, SQLITE_LIMIT_LENGTH, -1) };
        let guard = Self { db, state, previous_busy_ms, previous_length, _sql_budget_lease: sql_budget_lease };
        // Never relax a stricter pre-existing limit.
        unsafe { sqlite3_limit(db.0, SQLITE_LIMIT_LENGTH, previous_length.min(MAX_SQL_VALUE_BYTES)); }
        db.check(unsafe { sqlite3_busy_timeout(db.0, previous_busy_ms.min(MAX_BUSY_MS)) })?;
        unsafe {
            sqlite3_progress_handler(db.0, PROGRESS_INTERVAL, Some(progress),
                (&*guard.state as *const ProgressBudget<'_>).cast_mut().cast());
        }
        guard.state.check()?;
        Ok(guard)
    }
}
impl Drop for ConnectionBudget<'_, '_> {
    fn drop(&mut self) {
        // Work's local statements/read-transaction rollback have already unwound.
        // Detach before freeing callback state, then restore the exact connection settings.
        unsafe {
            sqlite3_progress_handler(self.db.0, 0, None, ptr::null_mut());
            sqlite3_limit(self.db.0, SQLITE_LIMIT_LENGTH, self.previous_length);
            sqlite3_busy_timeout(self.db.0, self.previous_busy_ms);
        }
    }
}
impl Db {
    pub(crate) fn with_runtime_host_scan_budget<T>(
        &self, cancelled: &AtomicBool, max_elapsed: Duration, work: impl FnOnce() -> Result<T>,
    ) -> Result<T> {
        self.runtime_host_scan_with_limits(cancelled, max_elapsed, MAX_VM_INSTRUCTIONS, work)
    }
    fn runtime_host_scan_with_limits<T>(
        &self, cancelled: &AtomicBool, max_elapsed: Duration, instructions: u64, work: impl FnOnce() -> Result<T>,
    ) -> Result<T> {
        let budget = ConnectionBudget::install(self, cancelled, max_elapsed, instructions)?;
        let result = work();
        // sqlite3_step errors normally have a generic SQLite kind. Preserve the actual
        // cancellation/deadline/VM reason recorded by this connection's callback.
        budget.state.check()?;
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[link(name = "winsqlite3", kind = "raw-dylib")]
    extern "C" { fn sqlite3_next_stmt(db: *mut c_void, current: *mut c_void) -> *mut c_void; }
    const SCAN: &str = "WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<20000) SELECT sum(x) FROM n";
    fn assert_restored(db: &Db, length: c_int) {
        assert!(unsafe { sqlite3_next_stmt(db.0, ptr::null_mut()) }.is_null());
        assert_eq!(db.query("PRAGMA busy_timeout", &[]).unwrap()[0][0].int().unwrap(), 5000);
        assert_eq!(unsafe { sqlite3_limit(db.0, SQLITE_LIMIT_LENGTH, -1) }, length);
        assert_eq!(db.query(SCAN, &[]).unwrap()[0][0].int().unwrap(), 200_010_000);
    }
    #[test]
    fn cancellation_interrupts_active_sql_and_restores_connection() {
        let db = Db::open(Path::new(":memory:")).unwrap();
        let length = unsafe { sqlite3_limit(db.0, SQLITE_LIMIT_LENGTH, -1) };
        let cancelled = AtomicBool::new(false);
        let error = db.with_runtime_host_scan_budget(&cancelled, Duration::from_secs(2), || {
            cancelled.store(true, Ordering::Release);
            db.query(SCAN, &[])
        }).unwrap_err();
        assert_eq!(error.kind, "catalogScanCancelled");
        assert_restored(&db, length);
    }
    #[test]
    fn vm_budget_interrupts_active_sql_and_restores_connection() {
        let db = Db::open(Path::new(":memory:")).unwrap();
        let length = unsafe { sqlite3_limit(db.0, SQLITE_LIMIT_LENGTH, -1) };
        let error = db.runtime_host_scan_with_limits(&AtomicBool::new(false), Duration::from_secs(2), 0,
            || db.query(SCAN, &[])).unwrap_err();
        assert_eq!(error.kind, "catalogScanCapacity");
        assert_restored(&db, length);
    }
    #[test]
    fn expired_deadline_interrupts_callback_without_sleep() {
        let cancelled = AtomicBool::new(false);
        let state = ProgressBudget { started: Instant::now(), max_elapsed: Duration::ZERO, cancelled: &cancelled,
            remaining: Cell::new(MAX_VM_INSTRUCTIONS), stopped: Cell::new(None) };
        assert_eq!(unsafe { progress((&state as *const ProgressBudget<'_>).cast_mut().cast()) }, 1);
        assert_eq!(state.stopped.get(), Some("catalogScanExpired"));
    }
    #[test]
    fn callback_error_and_unwind_restore_connection_settings() {
        let db = Db::open(Path::new(":memory:")).unwrap();
        let length = unsafe { sqlite3_limit(db.0, SQLITE_LIMIT_LENGTH, -1) };
        let cancelled = AtomicBool::new(false);
        let error = db.with_runtime_host_scan_budget(&cancelled, Duration::from_secs(2),
            || Err::<(), _>(StoreError::new("syntheticCallback", "synthetic"))).unwrap_err();
        assert_eq!(error.kind, "syntheticCallback");
        assert_restored(&db, length);
        let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _: Result<()> = db.with_runtime_host_scan_budget(&cancelled, Duration::from_secs(2), || panic!("synthetic"));
        }));
        assert!(panicked.is_err());
        assert_restored(&db, length);
    }
}