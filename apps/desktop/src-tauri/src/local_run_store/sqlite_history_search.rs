//! Bounded history-search cursor, included as a child of sqlite.rs so raw handles stay private.
//! Integration: add #[path = "sqlite_history_search.rs"] mod history_search; to sqlite.rs.

use super::{
    c_int, c_void, ptr, sqlite3_busy_timeout, sqlite3_column_bytes, sqlite3_column_int64,
    sqlite3_column_text, sqlite3_column_type, sqlite3_step, Db, Result, Statement, StoreError,
    DONE, ROW,
};
use super::super::{id, Message, Origin, Role, RunStore};
use std::{cell::Cell, time::{Duration, Instant}};

const MAX_BODY_BYTES: usize = 64 * 1024;
const MAX_TOTAL_BODY_BYTES: usize = 512 * 1024;
const MAX_SQL_VALUE_BYTES: c_int = 128 * 1024;
const PROGRESS_INTERVAL: c_int = 1000;
const MAX_VM_INSTRUCTIONS: u64 = 250_000;
const MAX_ELAPSED: Duration = Duration::from_millis(250);
const SQLITE_LIMIT_LENGTH: c_int = 0;

#[link(name = "winsqlite3", kind = "raw-dylib")]
extern "C" {
    fn sqlite3_progress_handler(db: *mut c_void, interval: c_int,
        callback: Option<unsafe extern "C" fn(*mut c_void) -> c_int>, context: *mut c_void);
    fn sqlite3_limit(db: *mut c_void, category: c_int, value: c_int) -> c_int;
}
fn capacity() -> StoreError {
    StoreError::new("searchCapacity", "native history search exceeded its message byte budget")
}
fn interrupted() -> StoreError {
    StoreError::new("searchBudget", "native history search exceeded its execution budget")
}
fn sql_error(code: c_int) -> StoreError {
    match code & 255 {
        9 => interrupted(),
        18 => capacity(),
        5 | 6 => StoreError::new("busy", "native history search database is busy"),
        _ => StoreError::new("sqlite", "native history search statement failed"),
    }
}
struct ProgressBudget {
    started: Instant,
    remaining: Cell<u64>,
    stopped: Cell<bool>,
}
impl ProgressBudget {
    fn check(&self) -> Result<()> {
        if self.stopped.get() || self.started.elapsed() >= MAX_ELAPSED {
            self.stopped.set(true);
            return Err(interrupted());
        }
        Ok(())
    }
}
unsafe extern "C" fn progress(context: *mut c_void) -> c_int {
    let budget = &*(context as *const ProgressBudget);
    if budget.check().is_err() || budget.remaining.get() <= PROGRESS_INTERVAL as u64 {
        budget.stopped.set(true);
        return 1;
    }
    budget.remaining.set(budget.remaining.get() - PROGRESS_INTERVAL as u64);
    0
}
struct SearchConnectionBudget<'a> {
    db: &'a Db,
    state: Box<ProgressBudget>,
    previous_length: c_int,
    previous_busy_ms: c_int,
    _sql_budget_lease: super::project_memory_budget::ScopedSqlBudgetLease,
}
impl<'a> SearchConnectionBudget<'a> {
    fn install(db: &'a Db, instructions: u64) -> Result<Self> {
        let sql_budget_lease = db.claim_scoped_sql_budget()?;
        // This connection belongs to this command's worker. It has no other progress handler.
        let busy = db.query("PRAGMA busy_timeout", &[])?;
        let previous_busy_ms = c_int::try_from(busy[0][0].int()?)
            .map_err(|_| StoreError::corrupt())?;
        let previous_length = unsafe { sqlite3_limit(db.0, SQLITE_LIMIT_LENGTH, MAX_SQL_VALUE_BYTES) };
        let guard = Self {
            db, previous_length, previous_busy_ms, _sql_budget_lease: sql_budget_lease,
            state: Box::new(ProgressBudget { started: Instant::now(), remaining: Cell::new(instructions), stopped: Cell::new(false) }),
        };
        db.check(unsafe { sqlite3_busy_timeout(db.0, 50) })?;
        unsafe {
            sqlite3_progress_handler(db.0, PROGRESS_INTERVAL, Some(progress),
                (&*guard.state as *const ProgressBudget).cast_mut().cast());
        }
        Ok(guard)
    }
}
impl Drop for SearchConnectionBudget<'_> {
    fn drop(&mut self) {
        // All borrowing Statements are finalized before this guard is dropped.
        // Detach before freeing the boxed callback state or closing the connection.
        unsafe {
            sqlite3_progress_handler(self.db.0, 0, None, ptr::null_mut());
            sqlite3_limit(self.db.0, SQLITE_LIMIT_LENGTH, self.previous_length);
            sqlite3_busy_timeout(self.db.0, self.previous_busy_ms);
        }
    }
}
fn text_len(stmt: &Statement<'_>, column: c_int) -> Result<usize> {
    if unsafe { sqlite3_column_type(stmt.raw, column) } != 3 {
        return Err(StoreError::corrupt());
    }
    usize::try_from(unsafe { sqlite3_column_bytes(stmt.raw, column) })
        .map_err(|_| StoreError::corrupt())
}
fn text(stmt: &Statement<'_>, column: c_int, max: usize) -> Result<String> {
    let length = text_len(stmt, column)?;
    if length > max { return Err(capacity()); }
    let raw = unsafe { sqlite3_column_text(stmt.raw, column) };
    if raw.is_null() { return Err(StoreError::corrupt()); }
    // No Rust text allocation occurs until column_bytes has passed its limit.
    let bytes = unsafe { std::slice::from_raw_parts(raw, length) };
    Ok(std::str::from_utf8(bytes).map_err(|_| StoreError::corrupt())?.to_owned())
}
fn integer(stmt: &Statement<'_>, column: c_int) -> Result<i64> {
    if unsafe { sqlite3_column_type(stmt.raw, column) } != 1 {
        return Err(StoreError::corrupt());
    }
    Ok(unsafe { sqlite3_column_int64(stmt.raw, column) })
}

impl RunStore {
    /// Dedicated worker connection only. Each borrowed message expires before the next sqlite3_step.
    /// On any limit/error the caller must discard its projected page and return the error.
    pub(crate) fn visit_history_search_messages(
        &self, project: &str, query: &str, limit: usize, offset: usize,
        visit: impl FnMut(&Message) -> Result<()>,
    ) -> Result<()> {
        self.visit_history_search_messages_with_limits(project, query, limit, offset,
            MAX_BODY_BYTES, MAX_TOTAL_BODY_BYTES, MAX_VM_INSTRUCTIONS, visit)
    }
    fn visit_history_search_messages_with_limits(
        &self, project: &str, query: &str, limit: usize, offset: usize,
        max_body: usize, max_total: usize, instructions: u64,
        mut visit: impl FnMut(&Message) -> Result<()>,
    ) -> Result<()> {
        id(project)?;
        if query.trim().is_empty() || query.len() > 2048 || query.chars().count() > 512
            || query.contains('\0') || limit == 0 || limit > 51 || offset > 1_000_000
        {
            return Err(StoreError::invalid("history search cursor input is invalid"));
        }
        // The guard is declared before every statement and outlives all sqlite3_finalize calls.
        let budget = SearchConnectionBudget::install(&self.db, instructions)?;
        // Sort only identities/order keys in the inner query. LIMIT/OFFSET and the outer JOIN
        // prevent flattening; full message bodies are fetched only for this bounded page.
        let stmt = self.db.prepare(
            "SELECT m.session_id,m.id,m.ordinal,m.role,m.body,m.created_at,m.origin
             FROM (SELECT rowid AS message_rowid,created_at,session_id,ordinal FROM messages
                   WHERE project_id=? AND instr(lower(body),lower(?))>0
                   ORDER BY created_at,session_id,ordinal LIMIT ? OFFSET ?) AS found
             JOIN messages m ON m.rowid=found.message_rowid AND m.project_id=?
             ORDER BY found.created_at,found.session_id,found.ordinal",
            &[project.into(), query.into(), (limit as i64).into(), (offset as i64).into(), project.into()],
        ).map_err(|error| if budget.state.stopped.get() { interrupted() } else { error })?;
        let mut total = 0usize;
        loop {
            budget.state.check()?;
            match unsafe { sqlite3_step(stmt.raw) } {
                DONE => { budget.state.check()?; return Ok(()); }
                ROW => {
                    let bytes = text_len(&stmt, 4)?;
                    // Check both budgets before copying any body into Rust, including lookahead.
                    if bytes > max_body { return Err(capacity()); }
                    total = total.checked_add(bytes).filter(|value| *value <= max_total)
                        .ok_or_else(capacity)?;
                    let row = Message {
                        project_id: project.into(), session_id: text(&stmt, 0, 256)?, id: text(&stmt, 1, 256)?,
                        ordinal: integer(&stmt, 2)?, role: Role::parse(&text(&stmt, 3, 16)?)?,
                        body: text(&stmt, 4, max_body)?, created_at: integer(&stmt, 5)?,
                        origin: Origin::parse(&text(&stmt, 6, 32)?)?,
                    };
                    visit(&row)?;
                    budget.state.check()?;
                }
                code => return Err(sql_error(code)),
            }
        }
    }
    /// Identity-only lookup used inside the same budgeted search callback; no goal/body is copied.
    pub(crate) fn history_search_run_revision(&self, project: &str, run: &str, session: &str) -> Result<Option<i64>> {
        id(project)?; id(run)?; id(session)?;
        let stmt = self.db.prepare(
            "SELECT revision FROM runs WHERE project_id=? AND id=? AND session_id=?",
            &[project.into(), run.into(), session.into()],
        )?;
        match unsafe { sqlite3_step(stmt.raw) } {
            DONE => Ok(None),
            ROW => Ok(Some(integer(&stmt, 0)?)),
            code => Err(sql_error(code)),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::super::{schema, NewMessage, Project, Session, StoreOptions};
    use std::path::{Path, PathBuf};

    #[link(name = "winsqlite3", kind = "raw-dylib")]
    extern "C" { fn sqlite3_next_stmt(db: *mut c_void, current: *mut c_void) -> *mut c_void; }

    fn store() -> RunStore {
        let db = Db::open(Path::new(":memory:")).unwrap();
        schema::migrate(&db).unwrap();
        let store = RunStore { db, root: PathBuf::from("G:/Synthetic/not-opened"), options: StoreOptions::default() };
        store.create_project(&Project { id: "p".into(), root: "G:/Synthetic/not-opened".into(), label: "synthetic".into(), created_at: 1 }).unwrap();
        store.create_session(&Session { project_id: "p".into(), id: "s".into(), title: "synthetic".into(), created_at: 1, archived: false, parent_id: None, origin: Origin::Native }).unwrap();
        store
    }
    fn append(store: &RunStore, id: &str, body: &str) {
        store.append_messages("p", "s", &[NewMessage { id: id.into(), role: Role::User, body: body.into(), created_at: 2 }]).unwrap();
    }
    fn assert_released(store: &RunStore) {
        assert!(unsafe { sqlite3_next_stmt(store.db.0, ptr::null_mut()) }.is_null());
        assert_eq!(store.db.query("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<2000) SELECT sum(x) FROM n", &[]).unwrap()[0][0].int().unwrap(), 2_001_000);
    }
    #[test]
    fn rejects_single_body_before_callback_and_finalizes_statement() {
        let store = store(); append(&store, "m", "needle-too-large");
        let mut seen = 0;
        let error = store.visit_history_search_messages_with_limits("p", "needle", 2, 0, 5, 100, MAX_VM_INSTRUCTIONS, |_| { seen += 1; Ok(()) }).unwrap_err();
        assert_eq!(error.kind, "searchCapacity"); assert_eq!(seen, 0); assert_released(&store);
    }
    #[test]
    fn rejects_cumulative_bytes_instead_of_returning_partial_page() {
        let store = store(); append(&store, "one", "xx"); append(&store, "two", "xx");
        let mut seen = 0;
        let error = store.visit_history_search_messages_with_limits("p", "x", 2, 0, 10, 3, MAX_VM_INSTRUCTIONS, |_| { seen += 1; Ok(()) }).unwrap_err();
        assert_eq!(error.kind, "searchCapacity"); assert_eq!(seen, 1); assert_released(&store);
    }
    #[test]
    fn sqlite_length_limit_rejects_large_lower_input_without_callback() {
        let store = store(); append(&store, "big", &"x".repeat(MAX_SQL_VALUE_BYTES as usize + 100));
        let mut seen = 0;
        let error = store.visit_history_search_messages("p", "missing", 2, 0, |_| { seen += 1; Ok(()) }).unwrap_err();
        assert_eq!(error.kind, "searchCapacity"); assert_eq!(seen, 0); assert_released(&store);
    }
    #[test]
    fn progress_interrupts_scan_and_detaches_before_reusing_connection() {
        let store = store();
        for index in 0..200 { append(&store, &format!("m-{index}"), "needle"); }
        let error = store.visit_history_search_messages_with_limits("p", "needle", 1, 0, 10, 100, 0, |_| Ok(())).unwrap_err();
        assert_eq!(error.kind, "searchBudget"); assert_released(&store);
    }
    #[test]
    fn callback_failure_also_releases_statement_and_progress_handler() {
        let store = store(); append(&store, "m", "needle");
        let error = store.visit_history_search_messages("p", "needle", 1, 0, |_| Err(StoreError::new("syntheticCallback", "synthetic"))).unwrap_err();
        assert_eq!(error.kind, "syntheticCallback"); assert_released(&store);
    }
}
