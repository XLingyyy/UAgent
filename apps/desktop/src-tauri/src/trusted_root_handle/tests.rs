use super::*;
use std::fs::{self, OpenOptions};
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::os::windows::io::AsRawHandle;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
static NEXT: AtomicUsize = AtomicUsize::new(0);
struct Fixture {
    base: PathBuf,
    root: PathBuf,
}
impl Fixture {
    fn new(name: &str) -> Self {
        let base = PathBuf::from(
            std::env::var("UAGENT_TRUSTED_ROOT_TEST_DIR")
                .expect("explicit E/G test directory required")
                .replace('/', "\\"),
        );
        let canonical = fs::canonicalize(&base)
            .unwrap()
            .to_string_lossy()
            .to_ascii_uppercase();
        assert!(canonical.starts_with(r"\\?\E:\") || canonical.starts_with(r"\\?\G:\"));
        let base = base.join(format!(
            "{name}-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&base).unwrap();
        let root = base.join("Project");
        fs::create_dir(&root).unwrap();
        Self { base, root }
    }
    fn file(&self, p: &str, b: &[u8]) {
        let path = self.root.join(p);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b).unwrap();
    }
    fn lease(&self) -> TrustedRootHandle {
        TrustedRootHandle::open_from_host_selection(&self.root).unwrap()
    }
    fn source(&self, root: &TrustedRootHandle) -> ScopedReader {
        root.scope_from_verified_host(vec![ReadRule::subtree("Source").unwrap()])
            .unwrap()
    }
    fn junction(&self, link: &Path, target: &Path) {
        assert!(link.starts_with(&self.base) && target.starts_with(&self.base));
        let cmd = PathBuf::from(std::env::var_os("SystemRoot").unwrap())
            .join("System32")
            .join("cmd.exe");
        let out = std::process::Command::new(cmd)
            .args(["/D", "/C", "mklink", "/J"])
            .arg(link.to_string_lossy().replace('/', "\\"))
            .arg(target.to_string_lossy().replace('/', "\\"))
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "owned junction fixture failed: {:?} stdout={:?} stderr={:?}",
            out.status,
            out.stdout,
            out.stderr
        );
    }
}
fn code<T: std::fmt::Debug>(r: Result<T>, expected: &str) {
    assert_eq!(r.unwrap_err().code, expected);
}
#[test]
fn syntax_rejects_aliases_streams_traversal_and_reserved_names() {
    for p in [
        "",
        ".",
        "..",
        "Source/../private",
        "Source/./x",
        "Source//x",
        "/Source/x",
        r"\Source\x",
        r"E:\x",
        "file:stream",
        "a.",
        "a ",
        "NUL.txt",
        "COM1",
        "LPT\u{00b2}.log",
        "SOURCE~1/file",
        "a\0b",
    ] {
        assert!(ReadRule::subtree(p).is_err(), "accepted {p:?}");
    }
    for p in [
        r"E:",
        r"E:relative",
        r"\\server\share\project",
        r"\\?\E:\Project",
        r"\\.\pipe\x",
        r"E:\Project\..\Other",
    ] {
        assert!(absolute_components(Path::new(p)).is_err(), "accepted {p:?}");
    }
    assert_eq!(
        relative_components("Source/folder/file.cpp").unwrap(),
        vec!["Source", "folder", "file.cpp"]
    );
}
#[test]
fn actual_volume_file_id_is_stable_and_distinguishes_objects() {
    let f = Fixture::new("identity");
    fs::create_dir(f.base.join("Other")).unwrap();
    let a = f.lease();
    let b = f.lease();
    let c = TrustedRootHandle::open_from_host_selection(&f.base.join("Other")).unwrap();
    assert_eq!(a.identity(), b.identity());
    assert_ne!(a.identity(), c.identity());
    assert_ne!(a.identity().file_id(), [0; 16]);
    assert_ne!(a.identity().volume_serial_number(), 0);
    assert!(a
        .identity()
        .observation_key()
        .starts_with("windows-fileid128:v1:"));
    a.check_current().unwrap();
}
#[test]
fn root_and_ancestor_rename_blocked_while_lease_held() {
    let f = Fixture::new("root-rename");
    let root = f.lease();
    let moved = f.base.join("Moved");
    assert!(fs::rename(&f.root, &moved).is_err());
    assert!(fs::rename(&f.base, f.base.with_extension("moved")).is_err());
    root.check_current().unwrap();
    drop(root);
    fs::rename(&f.root, &moved).unwrap();
    assert!(!f.root.exists());
}
#[repr(C)]
struct FileTime {
    low: u32,
    high: u32,
}
#[link(name = "kernel32")]
extern "system" {
    fn SetFileTime(
        file: *mut std::ffi::c_void,
        creation: *const FileTime,
        access: *const FileTime,
        write: *const FileTime,
    ) -> i32;
}
#[test]
fn replacement_with_equal_creation_time_has_different_file_id() {
    let f = Fixture::new("replacement");
    let root = f.lease();
    let id = root.identity();
    let time = fs::metadata(&f.root).unwrap().creation_time();
    drop(root);
    fs::rename(&f.root, f.base.join("Original")).unwrap();
    fs::create_dir(&f.root).unwrap();
    let h = OpenOptions::new()
        .access_mode(0x100)
        .share_mode(7)
        .custom_flags(0x0200_0000 | 0x0020_0000)
        .open(&f.root)
        .unwrap();
    let ft = FileTime {
        low: time as u32,
        high: (time >> 32) as u32,
    };
    assert_ne!(
        unsafe { SetFileTime(h.as_raw_handle(), &ft, std::ptr::null(), std::ptr::null()) },
        0
    );
    drop(h);
    assert_eq!(fs::metadata(&f.root).unwrap().creation_time(), time);
    assert_ne!(id, f.lease().identity());
}
#[test]
fn scoped_read_rejects_sibling_and_case_expansion() {
    let f = Fixture::new("scope");
    f.file("Source/a", b"bound bytes");
    f.file("SourceOther/private", b"private");
    f.file("Project.uproject", b"{}");
    let root = f.lease();
    let r = root
        .scope_from_verified_host(vec![
            ReadRule::subtree("Source").unwrap(),
            ReadRule::exact_file("Project.uproject").unwrap(),
        ])
        .unwrap();
    let mut file = r.open_file("Source/a").unwrap();
    let o = file.read_bounded(1024).unwrap();
    assert_eq!(o.bytes, b"bound bytes");
    assert_eq!(o.file_identity, file.identity());
    assert_eq!(o.root_identity, root.identity());
    assert_eq!(o.relative_path, "Source/a");
    code(
        r.open_file("SourceOther/private"),
        "relative_path_outside_read_scope",
    );
    code(r.open_file("source/a"), "relative_path_outside_read_scope");
    code(
        r.pin_directory("Project.uproject"),
        "relative_path_outside_read_scope",
    );
    code(
        root.scope_from_verified_host(vec![]),
        "explicit_bounded_read_rules_required",
    );
    r.open_file("Project.uproject")
        .unwrap()
        .read_bounded(10)
        .unwrap();
}
#[test]
fn read_limits_are_hard_and_empty_file_is_valid() {
    let f = Fixture::new("limit");
    f.file("Source/a", b"12345");
    f.file("Source/empty", b"");
    let root = f.lease();
    let r = f.source(&root);
    let mut file = r.open_file("Source/a").unwrap();
    code(file.read_bounded(4), "file_exceeds_read_limit");
    code(file.read_bounded(0), "invalid_read_limit");
    code(file.read_bounded(MAX_READ_BYTES + 1), "invalid_read_limit");
    assert_eq!(file.read_bounded(5).unwrap().bytes, b"12345");
    assert!(r
        .open_file("Source/empty")
        .unwrap()
        .read_bounded(1)
        .unwrap()
        .bytes
        .is_empty());
}
#[test]
fn bound_file_and_directory_prevent_write_delete_rename_replacement() {
    let f = Fixture::new("target-lock");
    f.file("Source/nested/a", b"original");
    let path = f.root.join("Source/nested/a");
    let root = f.lease();
    let r = f.source(&root);
    let mut file = r.open_file("Source/nested/a").unwrap();
    let dir = r.pin_directory("Source/nested").unwrap();
    assert!(fs::write(&path, b"changed").is_err());
    assert!(fs::remove_file(&path).is_err());
    assert!(fs::rename(&path, path.with_extension("old")).is_err());
    assert!(fs::rename(f.root.join("Source/nested"), f.root.join("Source/replaced")).is_err());
    assert_eq!(file.read_bounded(100).unwrap().bytes, b"original");
    dir.check_current().unwrap();
    drop(file);
    drop(dir);
    fs::write(path, b"now writable").unwrap();
}
#[test]
fn exact_file_scope_pins_approved_object_until_release() {
    let f = Fixture::new("exact-anchor");
    f.file("config.txt", b"one");
    let root = f.lease();
    let r = root
        .scope_from_verified_host(vec![ReadRule::exact_file("config.txt").unwrap()])
        .unwrap();
    assert!(fs::write(f.root.join("config.txt"), b"two").is_err());
    drop(r);
    fs::write(f.root.join("config.txt"), b"two").unwrap();
}
#[test]
fn reparse_root_ancestor_scope_and_target_rejected_without_following() {
    let f = Fixture::new("junctions");
    fs::create_dir_all(f.base.join("Outside/Child")).unwrap();
    fs::write(f.base.join("Outside/secret"), b"outside").unwrap();
    f.junction(&f.base.join("Alias"), &f.base.join("Outside"));
    assert!(TrustedRootHandle::open_from_host_selection(&f.base.join("Alias")).is_err());
    assert!(TrustedRootHandle::open_from_host_selection(&f.base.join("Alias/Child")).is_err());
    fs::create_dir(f.root.join("Source")).unwrap();
    f.junction(&f.root.join("Link"), &f.base.join("Outside"));
    f.junction(&f.root.join("Source/Link"), &f.base.join("Outside"));
    let root = f.lease();
    assert!(root
        .scope_from_verified_host(vec![ReadRule::subtree("Link").unwrap()])
        .is_err());
    let r = f.source(&root);
    assert!(r.open_file("Source/Link/secret").is_err());
    assert!(r.open_file("Source/Link").is_err());
}
#[test]
fn scope_anchor_cannot_swap_to_junction_and_new_link_scope_fails() {
    let f = Fixture::new("swap");
    f.file("Source/a", b"inside");
    fs::create_dir(f.base.join("Outside")).unwrap();
    fs::write(f.base.join("Outside/a"), b"outside").unwrap();
    let root = f.lease();
    let r = f.source(&root);
    assert!(fs::rename(f.root.join("Source"), f.root.join("OldSource")).is_err());
    assert_eq!(
        r.open_file("Source/a")
            .unwrap()
            .read_bounded(100)
            .unwrap()
            .bytes,
        b"inside"
    );
    drop(r);
    // Ancestor handles may still block directory moves; release the entire lease for the positive control.
    drop(root);
    fs::rename(f.root.join("Source"), f.root.join("OldSource")).unwrap();
    f.junction(&f.root.join("Source"), &f.base.join("Outside"));
    let root = f.lease();
    assert!(root
        .scope_from_verified_host(vec![ReadRule::subtree("Source").unwrap()])
        .is_err());
    root.check_current().unwrap();
}
#[test]
fn hardlink_cannot_import_outside_bytes_into_scope() {
    let f = Fixture::new("hardlinks");
    fs::create_dir(f.root.join("Source")).unwrap();
    fs::write(f.base.join("outside.txt"), b"outside").unwrap();
    fs::hard_link(f.base.join("outside.txt"), f.root.join("Source/linked.txt")).unwrap();
    let root = f.lease();
    let r = f.source(&root);
    code(
        r.open_file("Source/linked.txt"),
        "multiple_file_links_rejected",
    );
}
#[test]
fn revocation_invalidates_bound_files_directories_and_clones() {
    let f = Fixture::new("revoke");
    f.file("Source/a", b"data");
    let root = f.lease();
    let other = root.clone();
    let r = f.source(&root);
    let mut file = r.open_file("Source/a").unwrap();
    let dir = r.pin_directory("Source").unwrap();
    other.revoke();
    code(file.read_bounded(100), "root_lease_revoked");
    code(dir.check_current(), "root_lease_revoked");
    code(root.check_current(), "root_lease_revoked");
    code(r.open_file("Source/a"), "root_lease_revoked");
}
#[test]
fn revocation_after_actual_read_discards_bytes_at_final_gate() {
    let f = Fixture::new("revoke-final");
    f.file("Source/a", b"must not return");
    let root = f.lease();
    let r = f.source(&root);
    let mut file = r.open_file("Source/a").unwrap();
    code(
        file.read_and_revoke_at_final_gate(&root),
        "root_lease_revoked",
    );
}
#[test]
fn missing_or_wrong_type_never_falls_back_to_path_read() {
    let f = Fixture::new("type");
    f.file("Source/a", b"data");
    let root = f.lease();
    let r = f.source(&root);
    assert!(r.open_file("Source/missing").is_err());
    assert!(r.open_file("Source").is_err());
    assert!(r.pin_directory("Source/a").is_err());
}
