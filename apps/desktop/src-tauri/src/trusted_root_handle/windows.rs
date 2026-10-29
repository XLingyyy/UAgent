use super::*;
use std::ffi::c_void;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
use std::mem::size_of;
use std::os::windows::fs::{FileExt, OpenOptionsExt};
use std::os::windows::io::{AsRawHandle, FromRawHandle, RawHandle};
use std::path::PathBuf;
use std::ptr::null_mut;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

type Handle = *mut c_void;
const SHARE_READ: u32 = 1;
const READ_ATTRIBUTES: u32 = 0x80;
const SYNCHRONIZE: u32 = 0x10_0000;
const OPEN_REPARSE_POINT: u32 = 0x20_0000;
const SYNCHRONOUS_NONALERT: u32 = 0x20;
const DIRECTORY: u32 = 0x10;
const REPARSE: u32 = 0x400;
const UNAVAILABLE_DATA: u32 = 0x1000 | 0x40000 | 0x400000; // offline / recall-on-open / recall-on-data

#[repr(C)]
struct UnicodeString {
    length: u16,
    maximum_length: u16,
    buffer: *mut u16,
}
#[repr(C)]
struct ObjectAttributes {
    length: u32,
    root_directory: Handle,
    object_name: *mut UnicodeString,
    attributes: u32,
    security_descriptor: *mut c_void,
    security_qos: *mut c_void,
}
#[repr(C)]
struct IoStatusBlock {
    status_or_pointer: usize,
    information: usize,
}
#[repr(C)]
#[derive(Default)]
struct FileIdInfo {
    volume: u64,
    id: [u8; 16],
}
#[repr(C)]
#[derive(Default)]
struct FileTagInfo {
    attributes: u32,
    reparse_tag: u32,
}
#[repr(C)]
#[derive(Default)]
struct FileStandardInfo {
    allocation_size: i64,
    end_of_file: i64,
    number_of_links: u32,
    delete_pending: u8,
    directory: u8,
}
#[repr(C)]
#[derive(Default)]
struct FileBasicInfo {
    creation: i64,
    access: i64,
    last_write: i64,
    change: i64,
    attributes: u32,
}
#[link(name = "kernel32")]
extern "system" {
    fn GetFileInformationByHandleEx(
        file: Handle,
        class: u32,
        information: *mut c_void,
        length: u32,
    ) -> i32;
    fn GetFileType(file: Handle) -> u32;
    fn GetDriveTypeW(path: *const u16) -> u32;
    fn GetVolumeInformationByHandleW(
        file: Handle,
        volume_name: *mut u16,
        volume_len: u32,
        serial: *mut u32,
        max_component: *mut u32,
        flags: *mut u32,
        fs_name: *mut u16,
        fs_len: u32,
    ) -> i32;
}
#[link(name = "ntdll")]
extern "system" {
    fn NtOpenFile(
        file: *mut Handle,
        desired_access: u32,
        attributes: *mut ObjectAttributes,
        io: *mut IoStatusBlock,
        share: u32,
        options: u32,
    ) -> i32;
    fn RtlNtStatusToDosError(status: i32) -> u32;
}
fn io_error(code: &'static str, e: std::io::Error) -> RootError {
    RootError {
        code,
        os_code: e.raw_os_error().map(|v| v as u32),
    }
}
fn information<T: Default>(file: &File, class: u32) -> Result<T> {
    let mut value = T::default();
    // SAFETY: T is one of the fixed repr(C) Windows structures at every private call site.
    let ok = unsafe {
        GetFileInformationByHandleEx(
            file.as_raw_handle(),
            class,
            (&mut value as *mut T).cast(),
            size_of::<T>() as u32,
        )
    };
    if ok == 0 {
        return Err(io_error(
            "handle_information_unavailable",
            std::io::Error::last_os_error(),
        ));
    }
    Ok(value)
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct Metadata {
    identity: ObjectIdentity,
    kind: NodeKind,
    size: u64,
    links: u32,
    attributes: u32,
    last_write: i64,
    change: i64,
}
fn metadata(file: &File, kind: NodeKind) -> Result<Metadata> {
    if unsafe { GetFileType(file.as_raw_handle()) } != 1 {
        return Err(RootError::new("not_local_disk_object"));
    }
    let tag: FileTagInfo = information(file, 9)?; // FileAttributeTagInfo
    if tag.attributes & REPARSE != 0 || tag.reparse_tag != 0 {
        return Err(RootError::new("reparse_point_rejected"));
    }
    if tag.attributes & UNAVAILABLE_DATA != 0 {
        return Err(RootError::new("offline_or_recall_object_rejected"));
    }
    let standard: FileStandardInfo = information(file, 1)?;
    if standard.delete_pending != 0 || standard.end_of_file < 0 {
        return Err(RootError::new("delete_pending_or_invalid_size"));
    }
    let is_directory = tag.attributes & DIRECTORY != 0;
    if is_directory != (kind == NodeKind::Directory) || (standard.directory != 0) != is_directory {
        return Err(RootError::new("unexpected_object_type"));
    }
    if kind == NodeKind::File && standard.number_of_links != 1 {
        return Err(RootError::new("multiple_file_links_rejected"));
    }
    let id: FileIdInfo = information(file, 18)?; // FileIdInfo: full 64-bit volume + 128-bit file ID.
    if id.volume == 0 || id.id == [0; 16] {
        return Err(RootError::new("object_identity_unavailable"));
    }
    let basic: FileBasicInfo = information(file, 0)?;
    Ok(Metadata {
        identity: ObjectIdentity {
            volume_serial_number: id.volume,
            file_id: id.id,
        },
        kind,
        size: standard.end_of_file as u64,
        links: standard.number_of_links,
        attributes: tag.attributes,
        last_write: basic.last_write,
        change: basic.change,
    })
}
#[derive(Debug)]
struct Node {
    file: File,
    identity: ObjectIdentity,
    kind: NodeKind,
}
impl Node {
    fn new(file: File, kind: NodeKind) -> Result<Self> {
        let identity = metadata(&file, kind)?.identity;
        Ok(Self {
            file,
            identity,
            kind,
        })
    }
    fn check(&self) -> Result<()> {
        if metadata(&self.file, self.kind)?.identity != self.identity {
            return Err(RootError::new("object_identity_changed"));
        }
        Ok(())
    }
}
fn open_drive(drive: &str) -> Result<Node> {
    let path: Vec<u16> = drive.encode_utf16().chain(Some(0)).collect();
    if unsafe { GetDriveTypeW(path.as_ptr()) } != 3 {
        return Err(RootError::new("local_fixed_drive_required"));
    }
    let file = OpenOptions::new()
        .read(true)
        .share_mode(SHARE_READ)
        .custom_flags(0x0200_0000 | OPEN_REPARSE_POINT)
        .open(drive)
        .map_err(|e| io_error("drive_anchor_open_failed", e))?;
    let mut name = [0u16; 32];
    let ok = unsafe {
        GetVolumeInformationByHandleW(
            file.as_raw_handle(),
            null_mut(),
            0,
            null_mut(),
            null_mut(),
            null_mut(),
            name.as_mut_ptr(),
            name.len() as u32,
        )
    };
    if ok == 0 {
        return Err(io_error(
            "filesystem_identity_unavailable",
            std::io::Error::last_os_error(),
        ));
    }
    let count = name
        .iter()
        .position(|v| *v == 0)
        .ok_or_else(|| RootError::new("filesystem_identity_unavailable"))?;
    if String::from_utf16_lossy(&name[..count]) != "NTFS" {
        return Err(RootError::new("filesystem_not_accepted"));
    }
    Node::new(file, NodeKind::Directory)
}
fn open_child(parent: &File, name: &str, kind: NodeKind) -> Result<Node> {
    let mut utf16: Vec<u16> = name.encode_utf16().collect();
    let mut string = UnicodeString {
        length: (utf16.len() * 2) as u16,
        maximum_length: (utf16.len() * 2) as u16,
        buffer: utf16.as_mut_ptr(),
    };
    let mut attrs = ObjectAttributes {
        length: size_of::<ObjectAttributes>() as u32,
        root_directory: parent.as_raw_handle(),
        object_name: &mut string,
        attributes: 0x40 | 0x1000, // OBJ_CASE_INSENSITIVE | OBJ_DONT_REPARSE
        security_descriptor: null_mut(),
        security_qos: null_mut(),
    };
    let mut io = IoStatusBlock {
        status_or_pointer: 0,
        information: 0,
    };
    let mut raw: Handle = null_mut();
    let (rights, type_option) = match kind {
        NodeKind::Directory => (0x20 | READ_ATTRIBUTES | SYNCHRONIZE, 1), // FILE_TRAVERSE
        NodeKind::File => (1 | READ_ATTRIBUTES | SYNCHRONIZE, 0x40), // FILE_READ_DATA / NON_DIRECTORY
    };
    // SAFETY: one validated normal component, live held parent, initialized repr(C) buffers.
    // FILE_OPEN only; no create, write, delete or security-setting API exists in this module.
    let status = unsafe {
        NtOpenFile(
            &mut raw,
            rights,
            &mut attrs,
            &mut io,
            SHARE_READ,
            type_option | SYNCHRONOUS_NONALERT | OPEN_REPARSE_POINT,
        )
    };
    if status != 0 {
        if !raw.is_null() && raw as isize != -1 {
            drop(unsafe { File::from_raw_handle(raw as RawHandle) });
        }
        return Err(RootError {
            code: "relative_open_failed",
            os_code: Some(unsafe { RtlNtStatusToDosError(status) }),
        });
    }
    if raw.is_null() || raw as isize == -1 {
        return Err(RootError::new("relative_open_missing_handle"));
    }
    Node::new(unsafe { File::from_raw_handle(raw as RawHandle) }, kind)
}
fn walk(parent: &Node, parts: &[String], kind: NodeKind) -> Result<Vec<Node>> {
    let mut nodes: Vec<Node> = Vec::with_capacity(parts.len());
    for (i, part) in parts.iter().enumerate() {
        let parent = nodes.last().unwrap_or(parent);
        parent.check()?;
        let node = open_child(
            &parent.file,
            part,
            if i + 1 == parts.len() {
                kind
            } else {
                NodeKind::Directory
            },
        )?;
        if node.identity.volume_serial_number != parent.identity.volume_serial_number {
            return Err(RootError::new("volume_boundary_rejected"));
        }
        nodes.push(node);
    }
    Ok(nodes)
}
#[derive(Debug)]
struct RootInner {
    drive: String,
    components: Vec<String>,
    path_hint: PathBuf,
    chain: Vec<Node>,
    revoked: AtomicBool,
}
impl RootInner {
    fn check_current(&self) -> Result<()> {
        if self.revoked.load(Ordering::Acquire) {
            return Err(RootError::new("root_lease_revoked"));
        }
        for node in &self.chain {
            node.check()?;
        }
        let drive = open_drive(&self.drive)?;
        if drive.identity != self.chain[0].identity {
            return Err(RootError::new("drive_anchor_changed"));
        }
        let fresh = walk(&drive, &self.components, NodeKind::Directory)?;
        if fresh
            .iter()
            .zip(&self.chain[1..])
            .any(|(a, b)| a.identity != b.identity)
        {
            return Err(RootError::new("root_path_identity_changed"));
        }
        if self.revoked.load(Ordering::Acquire) {
            return Err(RootError::new("root_lease_revoked"));
        }
        Ok(())
    }
    fn root(&self) -> &Node {
        self.chain.last().expect("constructor retains project root")
    }
}
/// A host-selected live root and its ancestor chain. Clone retains this exact lease, never a new one.
#[derive(Clone, Debug)]
pub struct TrustedRootHandle {
    inner: Arc<RootInner>,
}
impl TrustedRootHandle {
    pub fn open_from_host_selection(path: &Path) -> Result<Self> {
        let (drive, components) = absolute_components(path)?;
        let anchor = open_drive(&drive)?;
        let children = walk(&anchor, &components, NodeKind::Directory)?;
        let mut chain = vec![anchor];
        chain.extend(children);
        let path_hint = PathBuf::from(format!("{}{}", drive, components.join("\\")));
        let root = Self {
            inner: Arc::new(RootInner {
                drive,
                components,
                path_hint,
                chain,
                revoked: AtomicBool::new(false),
            }),
        };
        root.check_current()?;
        Ok(root)
    }
    pub fn identity(&self) -> ObjectIdentity {
        self.inner.root().identity
    }
    /// For existing APIs/display only. Opening this path later does not carry this lease's authority.
    pub fn path_hint(&self) -> &Path {
        &self.inner.path_hint
    }
    pub fn check_current(&self) -> Result<()> {
        self.inner.check_current()
    }
    pub fn revoke(&self) {
        self.inner.revoked.store(true, Ordering::Release);
    }
    pub fn scope_from_verified_host(&self, rules: Vec<ReadRule>) -> Result<ScopedReader> {
        if rules.is_empty() || rules.len() > 32 {
            return Err(RootError::new("explicit_bounded_read_rules_required"));
        }
        self.check_current()?;
        let mut bound = Vec::with_capacity(rules.len());
        for rule in rules {
            let path = BoundPath::open(&self.inner, rule.components, rule.kind)?;
            bound.push(RuleBinding {
                kind: rule.kind,
                path,
            });
        }
        self.check_current()?;
        Ok(ScopedReader {
            inner: Arc::new(ScopeInner {
                root: self.inner.clone(),
                rules: bound,
            }),
        })
    }
}
#[derive(Debug)]
struct BoundPath {
    components: Vec<String>,
    nodes: Vec<Node>,
}
impl BoundPath {
    fn open(root: &RootInner, components: Vec<String>, kind: NodeKind) -> Result<Self> {
        root.check_current()?;
        let nodes = walk(root.root(), &components, kind)?;
        let path = Self { components, nodes };
        path.check_current(root)?;
        Ok(path)
    }
    fn check_current(&self, root: &RootInner) -> Result<()> {
        root.check_current()?;
        for node in &self.nodes {
            node.check()?;
        }
        let fresh = walk(root.root(), &self.components, self.target().kind)?;
        if fresh
            .iter()
            .zip(&self.nodes)
            .any(|(a, b)| a.identity != b.identity)
        {
            return Err(RootError::new("target_path_identity_changed"));
        }
        root.check_current()
    }
    fn target(&self) -> &Node {
        self.nodes.last().expect("validated nonempty relative path")
    }
    fn path_hint(&self, root: &RootInner) -> PathBuf {
        root.path_hint.join(self.components.join("\\"))
    }
}
#[derive(Debug)]
struct RuleBinding {
    kind: NodeKind,
    path: BoundPath,
}
#[derive(Debug)]
struct ScopeInner {
    root: Arc<RootInner>,
    rules: Vec<RuleBinding>,
}
#[derive(Clone, Debug)]
pub struct ScopedReader {
    inner: Arc<ScopeInner>,
}
impl ScopedReader {
    fn open(&self, relative: &str, kind: NodeKind) -> Result<BoundPath> {
        let parts = relative_components(relative)?;
        // Deliberately case-exact policy spelling; no Unicode folding or 8.3 alias broadening.
        let rule = self
            .inner
            .rules
            .iter()
            .find(|r| match r.kind {
                NodeKind::File => kind == NodeKind::File && parts == r.path.components,
                NodeKind::Directory => parts.starts_with(&r.path.components),
            })
            .ok_or_else(|| RootError::new("relative_path_outside_read_scope"))?;
        rule.path.check_current(&self.inner.root)?;
        let opened = BoundPath::open(&self.inner.root, parts, kind)?;
        if opened.nodes[rule.path.components.len() - 1].identity != rule.path.target().identity {
            return Err(RootError::new("scope_anchor_identity_changed"));
        }
        Ok(opened)
    }
    pub fn open_file(&self, relative: &str) -> Result<BoundReadFile> {
        Ok(BoundReadFile {
            path: self.open(relative, NodeKind::File)?,
            scope: self.clone(),
            read_lock: Mutex::new(()),
        })
    }
    pub fn pin_directory(&self, relative: &str) -> Result<PinnedDirectory> {
        Ok(PinnedDirectory {
            path: self.open(relative, NodeKind::Directory)?,
            scope: self.clone(),
        })
    }
}
#[derive(Debug)]
pub struct PinnedDirectory {
    path: BoundPath,
    scope: ScopedReader,
}
impl PinnedDirectory {
    pub fn identity(&self) -> ObjectIdentity {
        self.path.target().identity
    }
    pub fn path_hint(&self) -> PathBuf {
        self.path.path_hint(&self.scope.inner.root)
    }
    pub fn check_current(&self) -> Result<()> {
        self.path.check_current(&self.scope.inner.root)
    }
}
#[derive(Debug)]
pub struct BoundReadFile {
    path: BoundPath,
    scope: ScopedReader,
    read_lock: Mutex<()>,
}
impl BoundReadFile {
    pub fn identity(&self) -> ObjectIdentity {
        self.path.target().identity
    }
    pub fn path_hint(&self) -> PathBuf {
        self.path.path_hint(&self.scope.inner.root)
    }
    pub fn check_current(&self) -> Result<()> {
        self.path.check_current(&self.scope.inner.root)
    }
    /// The actual file length observed through this held handle, never a path read.
    pub fn byte_len(&self) -> Result<u64> {
        let _guard = self
            .read_lock
            .lock()
            .map_err(|_| RootError::new("bound_read_lock_poisoned"))?;
        self.check_current()?;
        let before = metadata(&self.path.target().file, NodeKind::File)?;
        let after = metadata(&self.path.target().file, NodeKind::File)?;
        if before != after {
            return Err(RootError::new("bound_file_changed_during_read"));
        }
        self.check_current()?;
        Ok(before.size)
    }
    /// Reads at most limit bytes from offset zero of the same held file.
    /// This does not decode UTF-8 or imply the whole file was read. Compare with
    /// byte_len() for truncation; callers may explicitly request UTF-8 lookahead.
    pub fn read_prefix_bounded(&self, limit: usize) -> Result<ReadObservation> {
        self.read_prefix_with_final_hook(limit, || {})
    }
    fn read_prefix_with_final_hook(
        &self,
        limit: usize,
        before_final_check: impl FnOnce(),
    ) -> Result<ReadObservation> {
        if limit == 0 || limit > MAX_READ_BYTES {
            return Err(RootError::new("invalid_read_limit"));
        }
        // A shared Arc may issue several prefix observations. Serialize those
        // reads and use explicit offsets on the original File, with no reopen.
        let _guard = self
            .read_lock
            .lock()
            .map_err(|_| RootError::new("bound_read_lock_poisoned"))?;
        self.check_current()?;
        let target = self.path.target();
        let before = metadata(&target.file, NodeKind::File)?;
        let length = before.size.min(limit as u64) as usize;
        let mut bytes = vec![0u8; length];
        let mut offset = 0;
        while offset < length {
            match target.file.seek_read(&mut bytes[offset..], offset as u64) {
                Ok(0) => return Err(RootError::new("bound_file_changed_during_read")),
                Ok(count) => offset += count,
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(io_error("bound_read_failed", error)),
            }
        }
        let after = metadata(&target.file, NodeKind::File)?;
        if before != after {
            return Err(RootError::new("bound_file_changed_during_read"));
        }
        before_final_check();
        self.check_current()?;
        Ok(ReadObservation {
            root_identity: self.scope.inner.root.root().identity,
            file_identity: before.identity,
            relative_path: self.path.components.join("/"),
            bytes,
        })
    }
    #[cfg(test)]
    pub(super) fn read_prefix_and_revoke_at_final_gate(
        &self,
        limit: usize,
        root: &TrustedRootHandle,
    ) -> Result<ReadObservation> {
        self.read_prefix_with_final_hook(limit, || root.revoke())
    }
    pub fn read_bounded(&mut self, limit: usize) -> Result<ReadObservation> {
        self.read_with_final_hook(limit, || {})
    }
    fn read_with_final_hook(
        &mut self,
        limit: usize,
        before_final_check: impl FnOnce(),
    ) -> Result<ReadObservation> {
        if limit == 0 || limit > MAX_READ_BYTES {
            return Err(RootError::new("invalid_read_limit"));
        }
        self.check_current()?;
        let target = self.path.nodes.last_mut().expect("bound target");
        let before = metadata(&target.file, NodeKind::File)?;
        if before.size > limit as u64 {
            return Err(RootError::new("file_exceeds_read_limit"));
        }
        target
            .file
            .seek(SeekFrom::Start(0))
            .map_err(|e| io_error("bound_read_seek_failed", e))?;
        let mut bytes = Vec::with_capacity(before.size as usize);
        (&mut target.file)
            .take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| io_error("bound_read_failed", e))?;
        let after = metadata(&target.file, NodeKind::File)?;
        if before != after || bytes.len() as u64 != before.size {
            return Err(RootError::new("bound_file_changed_during_read"));
        }
        before_final_check();
        self.check_current()?;
        Ok(ReadObservation {
            root_identity: self.scope.inner.root.root().identity,
            file_identity: before.identity,
            relative_path: self.path.components.join("/"),
            bytes,
        })
    }
    #[cfg(test)]
    pub(super) fn read_and_revoke_at_final_gate(
        &mut self,
        root: &TrustedRootHandle,
    ) -> Result<ReadObservation> {
        self.read_with_final_hook(MAX_READ_BYTES, || root.revoke())
    }
}
