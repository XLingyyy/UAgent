//! Shared test-only second connection; bypasses the cooperative Store gate.
use std::{ffi::{c_char,c_int,c_void,CString},path::{Path,PathBuf},ptr,sync::mpsc,time::Duration};
// A raw SECOND SQLite connection intentionally does not acquire UAgent's
// cooperative database_owner gate. All symbols and fixtures are Windows-native.
#[link(name = "winsqlite3", kind = "raw-dylib")]
extern "C" {
    fn sqlite3_open_v2(name: *const c_char, db: *mut *mut c_void, flags: c_int, vfs: *const c_char) -> c_int;
    fn sqlite3_close_v2(db: *mut c_void) -> c_int;
    fn sqlite3_busy_timeout(db: *mut c_void, milliseconds: c_int) -> c_int;
    fn sqlite3_exec(db: *mut c_void, sql: *const c_char,
        callback: Option<unsafe extern "C" fn(*mut c_void, c_int, *mut *mut c_char, *mut *mut c_char) -> c_int>,
        context: *mut c_void, error: *mut *mut c_char) -> c_int;
}
struct RawWriter(*mut c_void);
impl RawWriter {
    fn open(path: &Path) -> Self {
        let path = CString::new(path.to_str().unwrap()).unwrap();
        let mut raw = ptr::null_mut();
        let opened = unsafe { sqlite3_open_v2(path.as_ptr(), &mut raw, 2 | 0x10000, ptr::null()) };
        let writer = Self(raw);
        assert_eq!(opened, 0);
        assert_eq!(unsafe { sqlite3_busy_timeout(writer.0, 0) }, 0);
        writer
    }
    fn execute(&self, sql: &str) -> c_int {
        let sql = CString::new(sql).unwrap();
        (unsafe { sqlite3_exec(self.0, sql.as_ptr(), None, ptr::null_mut(), ptr::null_mut()) }) & 255
    }
}
impl Drop for RawWriter { fn drop(&mut self) { let _ = unsafe { sqlite3_close_v2(self.0) }; } }
#[derive(Debug)]
struct WriterWork { sql: String, reply: mpsc::SyncSender<c_int> }
#[derive(Clone)]
pub(crate) struct WriterPort(mpsc::SyncSender<WriterWork>);
impl WriterPort {
    pub(crate) fn execute(&self, sql: String) -> c_int {
        let (reply, receive) = mpsc::sync_channel(1);
        self.0.try_send(WriterWork { sql, reply }).unwrap();
        receive.recv_timeout(Duration::from_secs(1)).unwrap()
    }
}
pub(crate) fn with_raw_writer<T>(path: PathBuf, work: impl FnOnce(&WriterPort) -> T) -> T {
    std::thread::scope(|threads| {
        let (send, receive) = mpsc::sync_channel::<WriterWork>(1);
        let (ready, opened) = mpsc::sync_channel(1);
        let worker = threads.spawn(move || {
            let writer = RawWriter::open(&path);
            ready.send(()).unwrap();
            while let Ok(work) = receive.recv_timeout(Duration::from_secs(2)) {
                let result = writer.execute(&work.sql);
                let _ = work.reply.send(result);
            }
        });
        opened.recv_timeout(Duration::from_secs(1)).unwrap();
        let port = WriterPort(send);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| work(&port)));
        drop(port);
        worker.join().unwrap();
        match result { Ok(value) => value, Err(payload) => std::panic::resume_unwind(payload) }
    })
}
