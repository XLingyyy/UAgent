//! Child of sqlite.rs; the connection owner must include this leaf and serialize access.
//! No raw connection escapes, and no statement/transaction remains when its handler detaches.
use super::{c_int, c_void, ptr, sqlite3_busy_timeout, sqlite3_extended_errcode, Db, Result, StoreError};
use super::super::session_catalog::control::CatalogControl;
use std::{cell::{Cell, RefCell}, collections::HashMap, sync::atomic::Ordering};

const INTERVAL: c_int = 100;
const SQLITE_LIMIT_LENGTH: c_int = 0;
const VALUE_LIMIT: c_int = 300 * 1024;
const BUSY_MS: c_int = 25;
#[link(name = "winsqlite3", kind = "raw-dylib")]
extern "C" {
    fn sqlite3_progress_handler(db: *mut c_void, interval: c_int, callback: Option<unsafe extern "C" fn(*mut c_void) -> c_int>, context: *mut c_void);
    fn sqlite3_limit(db: *mut c_void, category: c_int, value: c_int) -> c_int;
}
thread_local! { static ACTIVE: RefCell<HashMap<usize, CatalogControl>> = RefCell::new(HashMap::new()); }
struct State { control: CatalogControl, remaining: Cell<u64>, stopped: Cell<Option<&'static str>> }
impl State {
    fn check(&self) -> Result<()> {
        let kind = self.stopped.get().or_else(|| {
            if self.control.cancelled.load(Ordering::Acquire) { Some("catalogCancelled") }
            else if self.control.started.elapsed() >= self.control.max_elapsed { Some("catalogDeadline") }
            else if self.remaining.get() == 0 { Some("catalogBudget") } else { None }
        });
        if let Some(kind) = kind { self.stopped.set(Some(kind)); return Err(StoreError::new(kind, "session catalog execution was interrupted; no partial result is returned")); }
        Ok(())
    }
}
unsafe extern "C" fn progress(context: *mut c_void) -> c_int {
    let state = &*(context as *const State);
    if state.check().is_err() { return 1; }
    let remaining = state.remaining.get().saturating_sub(INTERVAL as u64);
    state.remaining.set(remaining);
    if remaining == 0 { state.stopped.set(Some("catalogBudget")); return 1; }
    0
}
struct Guard<'a> { db: &'a Db, state: Box<State>, previous_busy: c_int, previous_length: c_int, attached: Cell<bool>, _sql_budget_lease: super::project_memory_budget::ScopedSqlBudgetLease }
impl<'a> Guard<'a> {
    fn install(db: &'a Db, control: &CatalogControl) -> Result<Self> {
        let sql_budget_lease = db.claim_scoped_sql_budget()?;
        // A central owner must ensure no other feature's handler is active on this connection.
        // Reject nested calls here instead of silently replacing this feature's handler.
        let key = db.0 as usize;
        if ACTIVE.with(|active| active.borrow().contains_key(&key)) { return Err(StoreError::new("busy", "session catalog connection already has an active budget")); }
        let busy = db.query("PRAGMA busy_timeout", &[])?;
        let previous_busy = c_int::try_from(busy[0][0].int()?).map_err(|_| StoreError::corrupt())?;
        let state = Box::new(State { control: control.clone(), remaining: Cell::new(control.max_vm_instructions), stopped: Cell::new(None) });
        state.check()?;
        let previous_length = unsafe { sqlite3_limit(db.0, SQLITE_LIMIT_LENGTH, -1) };
        unsafe { sqlite3_limit(db.0, SQLITE_LIMIT_LENGTH, previous_length.min(VALUE_LIMIT)); }
        let guard = Self { db, state, previous_busy, previous_length, attached: Cell::new(false), _sql_budget_lease: sql_budget_lease };
        ACTIVE.with(|active| { active.borrow_mut().insert(key, control.clone()); });
        db.check(unsafe { sqlite3_busy_timeout(db.0, BUSY_MS) })?;
        unsafe { sqlite3_progress_handler(db.0, INTERVAL, Some(progress), (&*guard.state as *const State).cast_mut().cast()); }
        guard.attached.set(true);
        Ok(guard)
    }
    fn detach(&self) {
        if self.attached.replace(false) { unsafe { sqlite3_progress_handler(self.db.0, 0, None, ptr::null_mut()); } }
    }
    fn result<T>(&self, result: Result<T>) -> Result<T> {
        if let Err(error) = self.state.check() { return Err(error); }
        result.map_err(|error| {
            if unsafe { sqlite3_extended_errcode(self.db.0) } & 255 == 18 { StoreError::new("catalogCapacity", "session catalog SQL value exceeds the byte budget") } else { error }
        })
    }
}
impl Drop for Guard<'_> {
    fn drop(&mut self) {
        self.detach();
        unsafe { sqlite3_limit(self.db.0, SQLITE_LIMIT_LENGTH, self.previous_length); sqlite3_busy_timeout(self.db.0, self.previous_busy); }
        ACTIVE.with(|active| { active.borrow_mut().remove(&(self.db.0 as usize)); });
    }
}
// Declared inside the transaction closure: unwinding and errors detach the interrupting
// callback BEFORE the existing transaction owner's rollback, so cancellation cannot abort it.
struct BeforeTransactionEnd<'a, 'db>(&'a Guard<'db>);
impl Drop for BeforeTransactionEnd<'_, '_> { fn drop(&mut self) { self.0.detach(); } }
impl Db {
    pub(crate) fn check_session_catalog_budget(&self) -> Result<()> {
        let control = ACTIVE.with(|active| active.borrow().get(&(self.0 as usize)).cloned())
            .ok_or_else(|| StoreError::invalid("session prefix work requires its managed execution budget"))?;
        control.check()
    }
    pub(crate) fn with_session_catalog_budget<T>(&self, control: &CatalogControl, write_transaction: bool, work: impl FnOnce() -> Result<T>) -> Result<T> {
        let guard = Guard::install(self, control)?;
        if write_transaction {
            self.transaction(|| {
                let _finish = BeforeTransactionEnd(&guard);
                guard.state.check()?;
                guard.result(work())
            })
        } else { guard.result(work()) }
        // guard outlives all statements, COMMIT/ROLLBACK and bounded lock waiting. Its Drop
        // restores busy_timeout/SQL length and removes callback+registry even on unwind.
    }
}
