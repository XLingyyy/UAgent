//! Small ownership wrapper for the SQLite shipped with supported Windows 10/11.
//! SQL and transactions stay native; no subprocess, shell, or additional SQLite package.
use super::{Result, StoreError};
use std::{
    ffi::{c_char, c_int, c_void, CStr, CString},
    path::Path,
    ptr,
};

#[link(name = "winsqlite3", kind = "raw-dylib")]
extern "C" {
    fn sqlite3_libversion_number() -> c_int;
    fn sqlite3_open_v2(
        name: *const c_char,
        db: *mut *mut c_void,
        flags: c_int,
        vfs: *const c_char,
    ) -> c_int;
    fn sqlite3_close_v2(db: *mut c_void) -> c_int;
    fn sqlite3_errmsg(db: *mut c_void) -> *const c_char;
    fn sqlite3_extended_errcode(db: *mut c_void) -> c_int;
    fn sqlite3_extended_result_codes(db: *mut c_void, on: c_int) -> c_int;
    fn sqlite3_busy_timeout(db: *mut c_void, ms: c_int) -> c_int;
    fn sqlite3_prepare_v2(
        db: *mut c_void,
        sql: *const c_char,
        len: c_int,
        stmt: *mut *mut c_void,
        tail: *mut *const c_char,
    ) -> c_int;
    fn sqlite3_bind_text(
        stmt: *mut c_void,
        pos: c_int,
        value: *const c_char,
        len: c_int,
        free: Option<unsafe extern "C" fn(*mut c_void)>,
    ) -> c_int;
    fn sqlite3_bind_int64(stmt: *mut c_void, pos: c_int, value: i64) -> c_int;
    fn sqlite3_bind_null(stmt: *mut c_void, pos: c_int) -> c_int;
    fn sqlite3_step(stmt: *mut c_void) -> c_int;
    fn sqlite3_finalize(stmt: *mut c_void) -> c_int;
    fn sqlite3_column_count(stmt: *mut c_void) -> c_int;
    fn sqlite3_column_type(stmt: *mut c_void, col: c_int) -> c_int;
    fn sqlite3_column_int64(stmt: *mut c_void, col: c_int) -> i64;
    fn sqlite3_column_text(stmt: *mut c_void, col: c_int) -> *const u8;
    fn sqlite3_column_bytes(stmt: *mut c_void, col: c_int) -> c_int;
    fn sqlite3_changes(db: *mut c_void) -> c_int;
    fn sqlite3_backup_init(
        dest: *mut c_void,
        dest_name: *const c_char,
        src: *mut c_void,
        src_name: *const c_char,
    ) -> *mut c_void;
    fn sqlite3_backup_step(backup: *mut c_void, pages: c_int) -> c_int;
    fn sqlite3_backup_finish(backup: *mut c_void) -> c_int;
}

const OK: c_int = 0;
const ROW: c_int = 100;
const DONE: c_int = 101;
#[derive(Clone, Debug)]
pub(super) enum Value {
    Text(String),
    Int(i64),
    Null,
}
impl From<&str> for Value {
    fn from(v: &str) -> Self {
        Self::Text(v.into())
    }
}
impl From<String> for Value {
    fn from(v: String) -> Self {
        Self::Text(v)
    }
}
impl From<i64> for Value {
    fn from(v: i64) -> Self {
        Self::Int(v)
    }
}
impl Value {
    pub fn text(&self) -> Result<String> {
        if let Self::Text(v) = self {
            Ok(v.clone())
        } else {
            Err(StoreError::corrupt())
        }
    }
    pub fn int(&self) -> Result<i64> {
        if let Self::Int(v) = self {
            Ok(*v)
        } else {
            Err(StoreError::corrupt())
        }
    }
}

pub(super) struct Db(*mut c_void);
struct Statement<'a> {
    db: &'a Db,
    raw: *mut c_void,
}
impl Drop for Db {
    fn drop(&mut self) {
        unsafe {
            sqlite3_close_v2(self.0);
        }
    }
}
impl Drop for Statement<'_> {
    fn drop(&mut self) {
        unsafe {
            sqlite3_finalize(self.raw);
        }
    }
}

impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        if unsafe { sqlite3_libversion_number() } < 3_031_000 {
            return Err(StoreError::new(
                "unsupportedRuntime",
                "Windows SQLite 3.31 or newer is required",
            ));
        }
        let name = CString::new(
            path.to_str()
                .ok_or_else(|| StoreError::invalid("database path is not Unicode"))?,
        )
        .map_err(|_| StoreError::invalid("database path contains NUL"))?;
        let mut raw = ptr::null_mut();
        // READWRITE | CREATE | FULLMUTEX; one owner, statements borrow their connection.
        let code =
            unsafe { sqlite3_open_v2(name.as_ptr(), &mut raw, 2 | 4 | 0x10000, ptr::null()) };
        if raw.is_null() {
            return Err(StoreError::new("sqlite", "cannot open database"));
        }
        let db = Self(raw);
        db.check(code)?;
        db.check(unsafe { sqlite3_extended_result_codes(db.0, 1) })?;
        db.check(unsafe { sqlite3_busy_timeout(db.0, 5000) })?;
        Ok(db)
    }
    fn error(&self) -> StoreError {
        let code = unsafe { sqlite3_extended_errcode(self.0) };
        let message = unsafe { CStr::from_ptr(sqlite3_errmsg(self.0)) }.to_string_lossy();
        let kind = match code & 255 {
            5 | 6 => "busy",
            13 => "capacity",
            19 => "constraint",
            _ => "sqlite",
        };
        StoreError::new(kind, &format!("SQLite {code}: {message}"))
    }
    fn check(&self, code: c_int) -> Result<()> {
        if code == OK {
            Ok(())
        } else {
            Err(self.error())
        }
    }
    fn prepare(&self, sql: &str, params: &[Value]) -> Result<Statement<'_>> {
        let sql = CString::new(sql).map_err(|_| StoreError::invalid("SQL contains NUL"))?;
        let mut raw = ptr::null_mut();
        self.check(unsafe {
            sqlite3_prepare_v2(self.0, sql.as_ptr(), -1, &mut raw, ptr::null_mut())
        })?;
        let stmt = Statement { db: self, raw };
        if raw.is_null() {
            return Err(StoreError::invalid("empty SQL"));
        }
        for (index, value) in params.iter().enumerate() {
            let pos =
                i32::try_from(index + 1).map_err(|_| StoreError::invalid("too many parameters"))?;
            let code = match value {
                Value::Text(v) => {
                    let len = i32::try_from(v.len()).map_err(|_| {
                        StoreError::new("capacity", "text exceeds SQLite binding size")
                    })?;
                    // SQLITE_TRANSIENT tells SQLite to copy the bytes before this call returns.
                    let transient = unsafe {
                        std::mem::transmute::<isize, Option<unsafe extern "C" fn(*mut c_void)>>(-1)
                    };
                    unsafe { sqlite3_bind_text(raw, pos, v.as_ptr().cast(), len, transient) }
                }
                Value::Int(v) => unsafe { sqlite3_bind_int64(raw, pos, *v) },
                Value::Null => unsafe { sqlite3_bind_null(raw, pos) },
            };
            self.check(code)?;
        }
        Ok(stmt)
    }
    pub fn query(&self, sql: &str, params: &[Value]) -> Result<Vec<Vec<Value>>> {
        let stmt = self.prepare(sql, params)?;
        let mut rows = Vec::new();
        loop {
            match unsafe { sqlite3_step(stmt.raw) } {
                DONE => return Ok(rows),
                ROW => {
                    let mut row = Vec::new();
                    for col in 0..unsafe { sqlite3_column_count(stmt.raw) } {
                        row.push(match unsafe { sqlite3_column_type(stmt.raw, col) } {
                            1 => Value::Int(unsafe { sqlite3_column_int64(stmt.raw, col) }),
                            3 => {
                                let len = unsafe { sqlite3_column_bytes(stmt.raw, col) } as usize;
                                let p = unsafe { sqlite3_column_text(stmt.raw, col) };
                                if p.is_null() {
                                    return Err(StoreError::corrupt());
                                }
                                let bytes = unsafe { std::slice::from_raw_parts(p, len) };
                                Value::Text(
                                    String::from_utf8(bytes.to_vec())
                                        .map_err(|_| StoreError::corrupt())?,
                                )
                            }
                            5 => Value::Null,
                            _ => return Err(StoreError::corrupt()),
                        });
                    }
                    rows.push(row);
                }
                _ => return Err(stmt.db.error()),
            }
        }
    }
    pub fn execute(&self, sql: &str, params: &[Value]) -> Result<usize> {
        self.query(sql, params)?;
        Ok(unsafe { sqlite3_changes(self.0) } as usize)
    }
    pub fn transaction<T>(&self, work: impl FnOnce() -> Result<T>) -> Result<T> {
        self.execute("BEGIN IMMEDIATE", &[])?;
        // Roll back on errors and unwinding, including a failed COMMIT (disk full, etc.).
        struct Rollback<'a>(&'a Db, bool);
        impl Drop for Rollback<'_> {
            fn drop(&mut self) {
                if self.1 {
                    let _ = self.0.execute("ROLLBACK", &[]);
                }
            }
        }
        let mut rollback = Rollback(self, true);
        let result = work()?;
        self.execute("COMMIT", &[])?;
        rollback.1 = false;
        Ok(result)
    }
    pub fn backup_to(&self, destination: &Db) -> Result<()> {
        let main = b"main\0";
        let backup = unsafe {
            sqlite3_backup_init(
                destination.0,
                main.as_ptr().cast(),
                self.0,
                main.as_ptr().cast(),
            )
        };
        if backup.is_null() {
            return Err(destination.error());
        }
        let code = unsafe { sqlite3_backup_step(backup, -1) };
        let finish = unsafe { sqlite3_backup_finish(backup) };
        if code != DONE {
            return Err(destination.error());
        }
        destination.check(finish)
    }
}
