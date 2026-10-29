//! Read-only native freshness stamps for explicitly named trusted-project files.
//!
//! The source-version probe reads attributes only. The scoped-preview helper reads
//! a bounded UTF-8 prefix through its validated Windows handle. A stamp is metadata
//! fingerprint, not a content hash: equal stamps do not prove equal contents.
//! Filesystem timestamp precision, restored timestamps, hash collisions and edits
//! after this call can hide changes. Callers must re-probe immediately before use;
//! this command grants no read, write, approval or permission-restoration authority.
//! Windows holds non-delete-sharing metadata handles for every traversed directory
//! and rejects every reparse point. Other platforms use before/after identity
//! checks; this is a bounded observation, not an atomic filesystem snapshot.

use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs::{self, Metadata};
use std::hash::{Hash, Hasher};
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_SOURCES: usize = 64;
const MAX_RELATIVE_PATH_BYTES: usize = 1024;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InspectNativeProjectSourcesInput {
    pub project_id: String,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NativeProjectSourceStatus {
    Ready,
    Missing,
    Blocked,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeProjectSourceVersion {
    pub path: String,
    pub status: NativeProjectSourceStatus,
    pub version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InspectNativeProjectSourcesResult {
    pub project_id: String,
    /// Native trust and root identity remained valid across this inspection,
    /// including when sources is empty. This never grants content permissions.
    pub root_current: bool,
    pub sources: Vec<NativeProjectSourceVersion>,
}

/// The webview supplies only a native-issued project ID and relative paths.
#[tauri::command]
pub fn inspect_native_project_sources(
    input: InspectNativeProjectSourcesInput,
) -> Result<InspectNativeProjectSourcesResult, String> {
    inspect_sources_using(input, |project_id| {
        let binding = crate::resolve_trusted_root_binding_by_id(project_id).map_err(|_| ())?;
        Ok(SourceRoot {
            original: PathBuf::from(&binding.normalized_root),
            canonical: binding.canonical_root.clone(),
            authority: binding,
        })
    })
}

/// A bounded, unredacted prefix. The caller applies its normal redaction policy.
/// original_lines is zero unless line_count_complete proves an exact count.
/// observed_lines counts only lines represented in content, including a partial
/// final line. original_bytes comes from the same file handle's metadata.
#[derive(Debug)]
pub(crate) struct ScopedPreview {
    pub content: String,
    pub truncated: bool,
    pub original_bytes: u64,
    pub observed_lines: u32,
    pub line_count_complete: bool,
    pub original_lines: u32,
}

/// Read through the final validated Windows handle, never reopen it by name.
/// Callers with an 8192-byte JSON result budget should pass at most 2048 bytes
/// and enforce their final serialized budget again after redaction/metadata.
pub(crate) fn read_scoped_project_file(
    project_id: &str,
    path: &str,
    byte_limit: u32,
    line_limit: u32,
) -> Result<ScopedPreview, String> {
    read_scoped_using(project_id, path, byte_limit, line_limit, |project_id| {
        let binding = crate::resolve_trusted_root_binding_by_id(project_id).map_err(|_| ())?;
        Ok(SourceRoot {
            original: PathBuf::from(&binding.normalized_root),
            canonical: binding.canonical_root.clone(),
            authority: binding,
        })
    })
}

/// A native-only scoped read retaining the same file/root lease used for every
/// subsequent freshness check. The caller supplies the separately approved exact
/// tool path; this function grants no broader read scope.
#[cfg(windows)]
pub(crate) fn read_bound_preview(
    project_id: &str,
    path: &str,
    byte_limit: u32,
    line_limit: u32,
) -> Result<
    (
        ScopedPreview,
        std::sync::Arc<crate::trusted_root_handle::BoundReadFile>,
    ),
    String,
> {
    use crate::trusted_root_handle::ReadRule;
    use std::sync::Arc;
    if !valid_project_id(project_id)
        || !canonical_relative_path(path)
        || byte_limit == 0
        || byte_limit > 16_384
        || line_limit == 0
        || line_limit > 2048
    {
        return Err("invalid_source_request".into());
    }
    if blocked_source_path(path) {
        return Err("source_path_blocked".into());
    }
    let root = crate::resolve_trusted_root_handle_by_id(project_id)
        .map_err(|_| "trust_revoked".to_string())?;
    // All parameter/path checks above are pure. The exact native guard must
    // accept the object before any file contents are read.
    root.check_current()
        .map_err(|_| "trust_revoked".to_string())?;
    let rule = ReadRule::exact_file(path).map_err(|_| "source_path_blocked".to_string())?;
    let reader = root
        .scope_from_verified_host(vec![rule])
        .map_err(|_| "source_path_blocked".to_string())?;
    let file = Arc::new(
        reader
            .open_file(path)
            .map_err(|_| "source_path_blocked".to_string())?,
    );
    let preview = preview_from_bound_file(&file, path, root.identity(), byte_limit, line_limit)?;
    root.check_current()
        .map_err(|_| "trust_revoked".to_string())?;
    let current = crate::resolve_trusted_root_handle_by_id(project_id)
        .map_err(|_| "trust_revoked".to_string())?;
    if !Arc::ptr_eq(&root, &current) {
        return Err("trust_revoked".into());
    }
    Ok((preview, file))
}

/// Re-read only through the retained guard. At most byte_limit + four bytes
/// are fetched, including UTF-8 lookahead; no whole-file allocation or path-based
/// content open occurs here. ReadObservation identities are cross-checked with
/// the actual held native objects, never treated as independent authority.
#[cfg(windows)]
pub(crate) fn preview_from_bound_file(
    file: &crate::trusted_root_handle::BoundReadFile,
    path: &str,
    root_identity: crate::trusted_root_handle::ObjectIdentity,
    byte_limit: u32,
    line_limit: u32,
) -> Result<ScopedPreview, String> {
    if !canonical_relative_path(path)
        || blocked_source_path(path)
        || byte_limit == 0
        || byte_limit > 16_384
        || line_limit == 0
        || line_limit > 2048
    {
        return Err("invalid_source_request".into());
    }
    file.check_current()
        .map_err(|_| "source_changed".to_string())?;
    let original_bytes = file.byte_len().map_err(|_| "source_changed".to_string())?;
    let limit = byte_limit as usize + 4;
    let observation = file
        .read_prefix_bounded(limit)
        .map_err(|_| "source_changed".to_string())?;
    if observation.root_identity != root_identity
        || observation.file_identity != file.identity()
        || observation.relative_path != path
        || observation.bytes.len() as u64 != original_bytes.min(limit as u64)
    {
        return Err("source_changed".into());
    }
    let fetched = observation.bytes.len() as u64;
    let mut cursor = std::io::Cursor::new(observation.bytes);
    let prefix = bounded_utf8_prefix(&mut cursor, byte_limit, line_limit)?;
    // A bounded buffer cannot prove EOF for the remainder of a larger file.
    if !prefix.truncated && fetched < original_bytes {
        return Err("source_changed".into());
    }
    if file.byte_len().map_err(|_| "source_changed".to_string())? != original_bytes {
        return Err("source_changed".into());
    }
    file.check_current()
        .map_err(|_| "source_changed".to_string())?;
    Ok(ScopedPreview {
        content: prefix.content,
        truncated: prefix.truncated,
        original_bytes,
        observed_lines: prefix.observed_lines,
        line_count_complete: prefix.line_count_complete,
        original_lines: prefix.original_lines,
    })
}
fn read_scoped_using<A: PartialEq>(
    project_id: &str,
    path: &str,
    byte_limit: u32,
    line_limit: u32,
    mut resolve: impl FnMut(&str) -> Result<SourceRoot<A>, ()>,
) -> Result<ScopedPreview, String> {
    if !valid_project_id(project_id)
        || !canonical_relative_path(path)
        || byte_limit == 0
        || line_limit == 0
    {
        return Err("invalid_source_request".into());
    }
    if blocked_source_path(path) {
        return Err("source_path_blocked".into());
    }
    let root = resolve(project_id).map_err(|_| "trust_revoked".to_string())?;
    let lease = RootLease::acquire(&root.original, &root.canonical)
        .map_err(|_| "source_path_blocked".to_string())?;
    let result = read_with_lease(&root.canonical, path, byte_limit, line_limit, &lease);
    // Never return content after revocation, root rebinding or a changed ancestor.
    if !resolve(project_id).is_ok_and(|after| after == root) || !lease.verify() {
        return Err("trust_revoked".into());
    }
    result
}

#[cfg(windows)]
fn read_with_lease(
    root: &Path,
    path: &str,
    byte_limit: u32,
    line_limit: u32,
    root_lease: &RootLease,
) -> Result<ScopedPreview, String> {
    let mut parents = Vec::new();
    let mut current = root.to_path_buf();
    let parts: Vec<_> = path.split('/').collect();
    for (index, part) in parts.iter().enumerate() {
        current.push(part);
        if index + 1 < parts.len() {
            let node = metadata_node(&current).map_err(preview_io_reason)?;
            if node.is_link() || !node.metadata.is_dir() {
                return Err("source_path_blocked".into());
            }
            parents.push((current.clone(), node));
            continue;
        }
        // READ_DATA is requested on this first and only final-path open.
        // Validate this handle, then use this exact handle for the bounded read.
        let node = open_windows_node(&current, true).map_err(preview_io_reason)?;
        if node.is_link()
            || !node.metadata.is_file()
            || !final_handle_matches_path(&node, &current)?
            || !root_lease.verify()
            || !verify_nodes(&parents)
        {
            return Err("source_path_blocked".into());
        }
        let mut same_handle = &node._handle;
        let prefix = bounded_utf8_prefix(&mut same_handle, byte_limit, line_limit)?;
        let after = node._handle.metadata().map_err(preview_io_reason)?;
        if node.version() != metadata_version(&after, node.identity)
            || !root_lease.verify()
            || !verify_nodes(&parents)
        {
            return Err("source_changed".into());
        }
        return Ok(ScopedPreview {
            content: prefix.content,
            truncated: prefix.truncated,
            original_bytes: node.metadata.len(),
            observed_lines: prefix.observed_lines,
            line_count_complete: prefix.line_count_complete,
            original_lines: prefix.original_lines,
        });
    }
    Err("invalid_source_request".into())
}

// The metadata probe is portable; content reads fail closed outside Windows
// until equivalent relative-handle, no-follow traversal is implemented.
#[cfg(not(windows))]
fn read_with_lease(
    _: &Path,
    _: &str,
    _: u32,
    _: u32,
    _: &RootLease,
) -> Result<ScopedPreview, String> {
    Err("native_authority_unavailable".into())
}

fn preview_io_reason(error: std::io::Error) -> String {
    if error.kind() == std::io::ErrorKind::NotFound {
        "missing".into()
    } else {
        "read_error".into()
    }
}

#[cfg(windows)]
fn final_handle_matches_path(node: &MetadataNode, expected: &Path) -> Result<bool, String> {
    use std::os::windows::io::AsRawHandle;
    let handle = node._handle.as_raw_handle().cast();
    // SAFETY: this size-only call does not dereference a null output buffer.
    let size = unsafe { GetFinalPathNameByHandleW(handle, std::ptr::null_mut(), 0, 0) };
    if size == 0 || size > 32768 {
        return Err("read_error".into());
    }
    let mut buffer = vec![0u16; size as usize + 1];
    // SAFETY: a live handle and writable UTF-16 output buffer of the given size.
    let written =
        unsafe { GetFinalPathNameByHandleW(handle, buffer.as_mut_ptr(), buffer.len() as u32, 0) };
    if written == 0 || written as usize >= buffer.len() {
        return Err("read_error".into());
    }
    let actual = String::from_utf16(&buffer[..written as usize])
        .map_err(|_| "source_path_blocked".to_string())?;
    // canonical root is already a native final path; aliases such as 8.3 names
    // were rejected syntactically. Case differences do not change Windows scope.
    Ok(actual.replace('/', "\\").to_lowercase()
        == expected.to_string_lossy().replace('/', "\\").to_lowercase())
}

#[derive(Debug)]
struct BoundedPrefix {
    content: String,
    truncated: bool,
    observed_lines: u32,
    line_count_complete: bool,
    original_lines: u32,
}

fn read_one(reader: &mut impl Read) -> Result<Option<u8>, String> {
    let mut byte = [0u8];
    loop {
        match reader.read(&mut byte) {
            Ok(0) => return Ok(None),
            Ok(_) => return Ok(Some(byte[0])),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
            Err(_) => return Err("read_error".into()),
        }
    }
}

/// Allocates at most byte_limit + four bytes, never reads a whole file to count
/// lines, and performs at most byte_limit + four successful one-byte reads.
/// One-byte reads intentionally prevent a buffer from reading past a line limit.
fn bounded_utf8_prefix(
    reader: &mut impl Read,
    byte_limit: u32,
    line_limit: u32,
) -> Result<BoundedPrefix, String> {
    if byte_limit == 0 || line_limit == 0 {
        return Err("invalid_source_request".into());
    }
    let limit = byte_limit.min(16 * 1024) as usize;
    let lines = line_limit.min(2048);
    let mut bytes = Vec::with_capacity(limit);
    let mut newlines = 0;
    let mut eof = false;
    while bytes.len() < limit && newlines < lines {
        match read_one(reader)? {
            None => {
                eof = true;
                break;
            }
            Some(byte) => {
                bytes.push(byte);
                if byte == b'\n' {
                    newlines += 1;
                }
            }
        }
    }
    // A byte bound may fall inside a code point. Validate only its remainder
    // (up to three bytes), while keeping returned content within the byte bound.
    let mut trimmed_utf8 = false;
    match std::str::from_utf8(&bytes) {
        Ok(_) => {}
        Err(error) if error.error_len().is_none() => {
            let valid_end = error.valid_up_to();
            let mut tail = bytes[valid_end..].to_vec();
            loop {
                match std::str::from_utf8(&tail) {
                    Ok(_) => break,
                    Err(error) if error.error_len().is_none() && tail.len() < 4 => {
                        tail.push(read_one(reader)?.ok_or("binary_or_extension_blocked")?);
                    }
                    Err(_) => return Err("binary_or_extension_blocked".into()),
                }
            }
            bytes.truncate(valid_end);
            trimmed_utf8 = true;
        }
        Err(_) => return Err("binary_or_extension_blocked".into()),
    }
    // A single EOF probe distinguishes an exact limit from a truncated prefix.
    // After UTF-8 lookahead, omitted bytes already prove truncation.
    if !eof && !trimmed_utf8 {
        match read_one(reader)? {
            None => eof = true,
            Some(byte) => {
                if byte < 0x20 && !matches!(byte, b'\t' | b'\n' | b'\r') {
                    return Err("binary_or_extension_blocked".into());
                }
                let mut probe = vec![byte];
                loop {
                    match std::str::from_utf8(&probe) {
                        Ok(_) => break,
                        Err(error) if error.error_len().is_none() && probe.len() < 4 => {
                            probe.push(read_one(reader)?.ok_or("binary_or_extension_blocked")?);
                        }
                        Err(_) => return Err("binary_or_extension_blocked".into()),
                    }
                }
            }
        }
    }
    if bytes
        .iter()
        .any(|byte| *byte < 0x20 && !matches!(*byte, b'\t' | b'\n' | b'\r'))
    {
        return Err("binary_or_extension_blocked".into());
    }
    let content = String::from_utf8(bytes).map_err(|_| "binary_or_extension_blocked")?;
    let observed_lines = content.lines().count() as u32;
    let truncated = trimmed_utf8 || !eof;
    let line_count_complete = !truncated;
    Ok(BoundedPrefix {
        content,
        truncated,
        observed_lines,
        line_count_complete,
        original_lines: if line_count_complete {
            observed_lines
        } else {
            0
        },
    })
}

// The authority value is compared before/after but never serialized. This seam
// allows focused filesystem tests without a Tauri build or a fake trust restore.
#[derive(Debug, Clone, PartialEq, Eq)]
struct SourceRoot<A> {
    original: PathBuf,
    canonical: PathBuf,
    authority: A,
}

fn inspect_sources_using<A: PartialEq>(
    input: InspectNativeProjectSourcesInput,
    mut resolve: impl FnMut(&str) -> Result<SourceRoot<A>, ()>,
) -> Result<InspectNativeProjectSourcesResult, String> {
    // Reject malformed requests as a whole: never echo an absolute/home path or
    // a forged project root via either a result entry or an OS error message.
    if !valid_project_id(&input.project_id)
        || input.paths.len() > MAX_SOURCES
        || input
            .paths
            .iter()
            .any(|path| !canonical_relative_path(path))
    {
        return Err("invalid_source_request".into());
    }
    let blocked = || {
        input
            .paths
            .iter()
            .map(|path| source(path, NativeProjectSourceStatus::Blocked, None))
            .collect::<Vec<_>>()
    };
    let root = match resolve(&input.project_id) {
        Ok(root) => root,
        Err(()) => {
            return Ok(InspectNativeProjectSourcesResult {
                project_id: input.project_id,
                root_current: false,
                sources: blocked(),
            });
        }
    };
    // Keep root/ancestor handles alive until after the final authority check.
    let lease = RootLease::acquire(&root.original, &root.canonical);
    let mut sources = match &lease {
        Ok(lease) => input
            .paths
            .iter()
            .map(|path| inspect_source(&root.canonical, path, lease))
            .collect(),
        Err(()) => blocked(),
    };
    let root_unchanged = resolve(&input.project_id).is_ok_and(|after| after == root);
    let root_current = root_unchanged && lease.as_ref().is_ok_and(|lease| lease.verify());
    if !root_current {
        sources = blocked();
    }
    Ok(InspectNativeProjectSourcesResult {
        project_id: input.project_id,
        root_current,
        sources,
    })
}

fn valid_project_id(value: &str) -> bool {
    // Current native trust IDs are root:<hex>. Do not accept roots, URLs or
    // arbitrary caller-controlled identifiers even when no binding exists.
    value.strip_prefix("root:").is_some_and(|hex| {
        !hex.is_empty() && hex.len() <= 16 && hex.bytes().all(|b| b.is_ascii_hexdigit())
    })
}

fn canonical_relative_path(path: &str) -> bool {
    if path.is_empty() || path.len() > MAX_RELATIVE_PATH_BYTES {
        return false;
    }
    path.split('/').all(|part| {
        !part.is_empty()
            && part != "."
            && part != ".."
            && part.len() <= 255
            && part.trim() == part
            && !part.ends_with('.')
            && !part.chars().any(|c| {
                c.is_control() || matches!(c, '\\' | ':' | '<' | '>' | '"' | '|' | '?' | '*' | '~')
            })
            && !dos_device(part)
    })
}

fn dos_device(part: &str) -> bool {
    let lower = part
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_lowercase();
    matches!(
        lower.as_str(),
        "con" | "prn" | "aux" | "nul" | "clock$" | "conin$" | "conout$"
    ) || ["com", "lpt"].iter().any(|prefix| {
        lower.strip_prefix(prefix).is_some_and(|suffix| {
            matches!(
                suffix,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "鹿" | "虏" | "鲁"
            )
        })
    })
}

fn blocked_source_path(path: &str) -> bool {
    path.split('/').any(|part| {
        let lower = part.to_lowercase();
        matches!(
            lower.as_str(),
            ".git"
                | ".hg"
                | ".svn"
                | ".vs"
                | ".idea"
                | "binaries"
                | "intermediate"
                | "saved"
                | "deriveddatacache"
                | "node_modules"
                | "dist"
                | "build"
                | "target"
                | "coverage"
                | "generated"
                | ".cache"
                | ".next"
                | ".nuxt"
                | "__pycache__"
                | ".ssh"
                | ".aws"
                | ".azure"
                | ".gnupg"
                | ".codex"
                | ".env"
                | ".npmrc"
                | ".pypirc"
                | ".netrc"
                | "_netrc"
                | "secret"
                | "secrets"
                | ".secrets"
                | "credentials"
                | "credentials.json"
                | "credentials.ini"
                | "credentials.yml"
                | "credentials.yaml"
                | "secrets.json"
                | "secrets.yml"
                | "secrets.yaml"
                | "id_rsa"
                | "id_ed25519"
                | "id_ecdsa"
        ) || lower.starts_with(".env.")
            || lower.ends_with(".pem")
            || lower.ends_with(".key")
            || lower.ends_with(".p12")
            || lower.ends_with(".pfx")
            || lower.ends_with(".keystore")
            || lower.ends_with(".g.cpp")
            || lower.ends_with(".generated.h")
    })
}

fn source(
    path: &str,
    status: NativeProjectSourceStatus,
    version: Option<String>,
) -> NativeProjectSourceVersion {
    NativeProjectSourceVersion {
        path: path.into(),
        status,
        version,
    }
}

struct MetadataNode {
    metadata: Metadata,
    identity: Option<(u64, u64)>,
    #[cfg(windows)]
    _handle: fs::File,
}

impl MetadataNode {
    fn is_link(&self) -> bool {
        if self.metadata.file_type().is_symlink() {
            return true;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if self.metadata.file_attributes() & 0x400 != 0 {
                return true;
            }
        }
        false
    }

    fn same_object(&self, other: &Self) -> bool {
        !other.is_link()
            && self.identity == other.identity
            && self.metadata.created().ok() == other.metadata.created().ok()
            && self.metadata.is_dir() == other.metadata.is_dir()
            && self.metadata.is_file() == other.metadata.is_file()
    }

    fn version(&self) -> String {
        metadata_version(&self.metadata, self.identity)
    }
}

fn metadata_version(metadata: &Metadata, identity: Option<(u64, u64)>) -> String {
    let mut hash = DefaultHasher::new();
    "native-project-source-metadata-v1".hash(&mut hash);
    metadata.len().hash(&mut hash);
    metadata.created().ok().hash(&mut hash);
    metadata.modified().ok().hash(&mut hash);
    identity.hash(&mut hash);
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes().hash(&mut hash);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        metadata.ctime().hash(&mut hash);
        metadata.ctime_nsec().hash(&mut hash);
    }
    // This digest hides raw attributes/identities, and never hashes contents.
    format!("meta-v1:{:016x}", hash.finish())
}

#[cfg(windows)]
fn metadata_node(path: &Path) -> std::io::Result<MetadataNode> {
    open_windows_node(path, false)
}

#[cfg(windows)]
fn open_windows_node(path: &Path, read_content: bool) -> std::io::Result<MetadataNode> {
    use std::os::windows::fs::OpenOptionsExt;
    use std::os::windows::io::AsRawHandle;
    // Metadata handles request attributes only. The bounded-preview leaf also
    // requests GENERIC_READ; neither mode requests write access. All handles
    // exclude delete sharing. Preview leaves also exclude concurrent writers.
    let handle = fs::OpenOptions::new()
        .access_mode(if read_content {
            0x80000000 | 0x80
        } else {
            0x80
        })
        .share_mode(if read_content { 0x1 } else { 0x1 | 0x2 })
        .custom_flags(0x02000000 | 0x00200000) // BACKUP_SEMANTICS | OPEN_REPARSE_POINT
        .open(path)?;
    let metadata = handle.metadata()?;
    let mut information = std::mem::MaybeUninit::<WindowsFileInformation>::uninit();
    // SAFETY: a live Windows file handle and correctly sized writable ABI struct.
    let ok = unsafe {
        GetFileInformationByHandle(handle.as_raw_handle().cast(), information.as_mut_ptr())
    };
    if ok == 0 {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: success initialized every field of BY_HANDLE_FILE_INFORMATION.
    let information = unsafe { information.assume_init() };
    Ok(MetadataNode {
        metadata,
        identity: Some((
            information.volume_serial as u64,
            ((information.index_high as u64) << 32) | information.index_low as u64,
        )),
        _handle: handle,
    })
}

#[cfg(windows)]
#[repr(C)]
struct WindowsFileTime {
    low: u32,
    high: u32,
}

#[cfg(windows)]
#[repr(C)]
struct WindowsFileInformation {
    attributes: u32,
    creation: WindowsFileTime,
    access: WindowsFileTime,
    write: WindowsFileTime,
    volume_serial: u32,
    size_high: u32,
    size_low: u32,
    links: u32,
    index_high: u32,
    index_low: u32,
}

#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetFinalPathNameByHandleW(
        handle: *mut std::ffi::c_void,
        output: *mut u16,
        size: u32,
        flags: u32,
    ) -> u32;
    fn GetFileInformationByHandle(
        handle: *mut std::ffi::c_void,
        information: *mut WindowsFileInformation,
    ) -> i32;
}

#[cfg(not(windows))]
fn metadata_node(path: &Path) -> std::io::Result<MetadataNode> {
    let metadata = fs::symlink_metadata(path)?;
    #[cfg(unix)]
    let identity = {
        use std::os::unix::fs::MetadataExt;
        Some((metadata.dev(), metadata.ino()))
    };
    #[cfg(not(unix))]
    let identity = None;
    Ok(MetadataNode { metadata, identity })
}

struct RootLease {
    nodes: Vec<(PathBuf, MetadataNode)>,
}

impl RootLease {
    fn acquire(original: &Path, canonical: &Path) -> Result<Self, ()> {
        if !original.is_absolute() || !canonical.is_absolute() {
            return Err(());
        }
        let mut nodes = Vec::new();
        // Check the original trusted spelling as well: canonicalize() alone
        // would conceal a junction/symlink in the original selected root.
        for root in [original, canonical] {
            for path in root.ancestors().collect::<Vec<_>>().into_iter().rev() {
                let node = metadata_node(path).map_err(|_| ())?;
                if node.is_link() || !node.metadata.is_dir() {
                    return Err(());
                }
                nodes.push((path.to_path_buf(), node));
            }
        }
        if fs::canonicalize(original).map_err(|_| ())? != canonical {
            return Err(());
        }
        Ok(Self { nodes })
    }

    fn verify(&self) -> bool {
        verify_nodes(&self.nodes)
    }
}

fn verify_nodes(nodes: &[(PathBuf, MetadataNode)]) -> bool {
    nodes
        .iter()
        .all(|(path, before)| metadata_node(path).is_ok_and(|after| before.same_object(&after)))
}

fn inspect_source(root: &Path, path: &str, root_lease: &RootLease) -> NativeProjectSourceVersion {
    let blocked = || source(path, NativeProjectSourceStatus::Blocked, None);
    if blocked_source_path(path) {
        return blocked();
    }
    let mut nodes = Vec::new();
    let mut current = root.to_path_buf();
    let parts: Vec<_> = path.split('/').collect();
    for (index, part) in parts.iter().enumerate() {
        current.push(part);
        let node = match metadata_node(&current) {
            Ok(node) => node,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                // Missing ancestors are a missing source only if every observed
                // directory still denotes the same safe object.
                if root_lease.verify()
                    && verify_nodes(&nodes)
                    && metadata_node(&current)
                        .is_err_and(|error| error.kind() == std::io::ErrorKind::NotFound)
                {
                    return source(path, NativeProjectSourceStatus::Missing, None);
                }
                return blocked();
            }
            Err(_) => return blocked(),
        };
        let is_leaf = index + 1 == parts.len();
        if node.is_link()
            || (!is_leaf && !node.metadata.is_dir())
            || (is_leaf && !node.metadata.is_file())
        {
            return blocked();
        }
        nodes.push((current.clone(), node));
    }
    if !fs::canonicalize(&current).is_ok_and(|canonical| canonical.starts_with(root))
        || !root_lease.verify()
        || !verify_nodes(&nodes)
    {
        return blocked();
    }
    let before = &nodes.last().expect("nonempty canonical relative path").1;
    let Ok(after) = metadata_node(&current) else {
        return blocked();
    };
    let version = before.version();
    if !before.same_object(&after) || version != after.version() {
        return blocked();
    }
    source(path, NativeProjectSourceStatus::Ready, Some(version))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    struct Fixture(PathBuf);

    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let root = std::env::temp_dir().join(format!(
                "uagent-source-version-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(root.join("Source")).unwrap();
            fs::write(root.join("Source/Main.cpp"), b"initial").unwrap();
            Self(root)
        }

        fn binding(&self) -> SourceRoot<(Option<(u64, u64)>, Option<std::time::SystemTime>)> {
            let node = metadata_node(&self.0).unwrap();
            SourceRoot {
                original: self.0.clone(),
                canonical: fs::canonicalize(&self.0).unwrap(),
                authority: (node.identity, node.metadata.created().ok()),
            }
        }

        fn input(&self, paths: &[&str]) -> InspectNativeProjectSourcesInput {
            InspectNativeProjectSourcesInput {
                project_id: "root:1234abcd".into(),
                paths: paths.iter().map(|path| (*path).into()).collect(),
            }
        }

        fn inspect(&self, paths: &[&str]) -> InspectNativeProjectSourcesResult {
            inspect_sources_using(self.input(paths), |_| Ok(self.binding())).unwrap()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = remove_owned_fixture(&self.0);
        }
    }

    fn remove_owned_fixture(path: &Path) -> std::io::Result<()> {
        let temp = std::env::temp_dir();
        let safe = path.is_absolute()
            && path.parent() == Some(temp.as_path())
            && path
                .file_name()
                .is_some_and(|name| name.to_string_lossy().starts_with("uagent-source-version-"))
            && fs::canonicalize(path)?.starts_with(fs::canonicalize(&temp)?);
        if !safe || metadata_node(path)?.is_link() {
            return Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "fixture_cleanup_target_invalid",
            ));
        }
        fs::remove_dir_all(path)
    }

    #[test]
    fn empty_inspection_reports_native_root_current_even_without_source_entries() {
        let fixture = Fixture::new();
        let valid = fixture.inspect(&[]);
        assert!(valid.root_current);
        assert!(valid.sources.is_empty());
        let json = serde_json::to_value(&valid).unwrap();
        assert_eq!(json["rootCurrent"], true);
        assert!(json.get("root_current").is_none());

        let revoked = inspect_sources_using::<()>(fixture.input(&[]), |_| Err(())).unwrap();
        assert!(!revoked.root_current);
        assert!(revoked.sources.is_empty());

        let mut calls = 0;
        let revoked_after = inspect_sources_using(fixture.input(&[]), |_| {
            calls += 1;
            if calls == 1 {
                Ok(fixture.binding())
            } else {
                Err(())
            }
        })
        .unwrap();
        assert_eq!(calls, 2);
        assert!(!revoked_after.root_current);
        assert!(revoked_after.sources.is_empty());

        let mut calls = 0;
        let replaced = inspect_sources_using(fixture.input(&[]), |_| {
            calls += 1;
            let mut binding = fixture.binding();
            if calls > 1 {
                binding.authority.0 = Some((0, 0));
            }
            Ok(binding)
        })
        .unwrap();
        assert!(!replaced.root_current);
        assert!(replaced.sources.is_empty());

        let invalid = inspect_sources_using(fixture.input(&[]), |_| {
            let mut binding = fixture.binding();
            binding.original = fixture.0.join("NonexistentRoot");
            Ok(binding)
        })
        .unwrap();
        assert!(!invalid.root_current);
        assert!(invalid.sources.is_empty());
    }

    #[test]
    fn metadata_version_is_stable_then_changes_after_write_and_removal() {
        let fixture = Fixture::new();
        let first = fixture.inspect(&["Source/Main.cpp", "Source/Main.cpp"]);
        let second = fixture.inspect(&["Source/Main.cpp"]);
        assert_eq!(first.sources[0].status, NativeProjectSourceStatus::Ready);
        assert_eq!(first.sources[0].version, first.sources[1].version);
        assert_eq!(first.sources[0].version, second.sources[0].version);
        // Change length as well as timestamps, independent of timestamp precision.
        fs::write(fixture.0.join("Source/Main.cpp"), b"changed source length").unwrap();
        let changed = fixture.inspect(&["Source/Main.cpp"]);
        assert_ne!(first.sources[0].version, changed.sources[0].version);
        fs::remove_file(fixture.0.join("Source/Main.cpp")).unwrap();
        let removed = fixture.inspect(&["Source/Main.cpp", "NoParent/Missing.cpp"]);
        assert!(removed.sources.iter().all(|entry| {
            entry.status == NativeProjectSourceStatus::Missing && entry.version.is_none()
        }));
    }

    #[test]
    fn syntax_rejects_escapes_aliases_devices_and_unknown_fields_without_echo() {
        let fixture = Fixture::new();
        for path in [
            "../outside",
            "Source/../Main.cpp",
            "/home/private",
            "C:/private",
            "C:private",
            "\\\\server\\share",
            "Source\\Main.cpp",
            "Source/Main.cpp:ads",
            "Source//Main.cpp",
            "./Source/Main.cpp",
            "Source/.",
            "Source/NUL.cpp",
            "Source/COM1",
            "Source/LPT鹿.txt",
            "Source/CON .cpp",
            "Source/Main.cpp.",
            "Source/Main.cpp ",
            "Source/NODE_M~1/file",
            "Source/\0file",
        ] {
            let result = inspect_sources_using::<()>(fixture.input(&[path]), |_| {
                panic!("malformed path must never resolve native authority")
            });
            assert_eq!(result.unwrap_err(), "invalid_source_request", "{path:?}");
        }
        assert!(serde_json::from_str::<InspectNativeProjectSourcesInput>(
            r#"{"projectId":"root:1","paths":[],"root":"G:/private"}"#
        )
        .is_err());
        assert!(serde_json::from_str::<InspectNativeProjectSourcesInput>(
            r#"{"projectId":"root:1","paths":[],"other":true}"#
        )
        .is_err());
        let mut input = fixture.input(&[]);
        input.paths = vec!["Source/Main.cpp".into(); 65];
        assert!(inspect_sources_using(input, |_| Ok(fixture.binding())).is_err());
        let mut input = fixture.input(&["Source/Main.cpp"]);
        input.project_id = "G:/private".into();
        assert!(inspect_sources_using(input, |_| Ok(fixture.binding())).is_err());
    }

    #[test]
    fn secret_generated_paths_and_directories_are_blocked_even_when_missing() {
        let fixture = Fixture::new();
        let result = fixture.inspect(&[
            ".env",
            ".env.production",
            ".aws/config",
            "Saved/Config/Game.ini",
            "Plugins/Test/Intermediate/Source.cpp",
            "Source/Thing.generated.h",
            "secrets/private.txt",
            "Source/private.key",
            ".git/config",
            "Source",
        ]);
        assert!(result.sources.iter().all(|entry| {
            entry.status == NativeProjectSourceStatus::Blocked && entry.version.is_none()
        }));
    }

    #[test]
    fn binary_asset_metadata_is_allowed_and_response_contains_no_native_root() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("Content")).unwrap();
        fs::write(fixture.0.join("Content/Asset.uasset"), [0u8, 255u8, 128u8]).unwrap();
        let result = fixture.inspect(&["Content/Asset.uasset"]);
        assert_eq!(result.sources[0].status, NativeProjectSourceStatus::Ready);
        let json = serde_json::to_string(&result).unwrap();
        assert!(!json.contains(&fixture.0.to_string_lossy().to_string()));
        assert!(!json.contains("canonical"));
        assert!(!json.contains("initial"));
        assert!(result.sources[0]
            .version
            .as_ref()
            .unwrap()
            .starts_with("meta-v1:"));
    }

    #[test]
    fn revoked_or_rebound_root_invalidates_every_stamp_including_missing_sources() {
        let fixture = Fixture::new();
        let mut calls = 0;
        let result =
            inspect_sources_using(fixture.input(&["Source/Main.cpp", "Missing.cpp"]), |_| {
                calls += 1;
                if calls == 1 {
                    Ok(fixture.binding())
                } else {
                    Err(())
                }
            })
            .unwrap();
        assert_eq!(calls, 2);
        assert!(result.sources.iter().all(|entry| {
            entry.status == NativeProjectSourceStatus::Blocked && entry.version.is_none()
        }));
        let mut calls = 0;
        let result = inspect_sources_using(fixture.input(&["Source/Main.cpp"]), |_| {
            calls += 1;
            let mut binding = fixture.binding();
            if calls > 1 {
                binding.authority.0 = Some((0, 0));
            }
            Ok(binding)
        })
        .unwrap();
        assert_eq!(result.sources[0].status, NativeProjectSourceStatus::Blocked);
    }

    #[test]
    fn root_replaced_at_same_path_is_rejected_by_native_authority_seam() {
        let fixture = Fixture::new();
        let old_binding = fixture.binding();
        let displaced = fixture.0.with_extension("displaced");
        fs::rename(&fixture.0, &displaced).unwrap();
        fs::create_dir_all(fixture.0.join("Source")).unwrap();
        fs::write(fixture.0.join("Source/Main.cpp"), b"replacement").unwrap();
        assert_ne!(old_binding.authority, fixture.binding().authority);
        // Mirrors the production by-ID resolver's object-identity rejection.
        let result = inspect_sources_using(fixture.input(&["Source/Main.cpp"]), |_| {
            if fixture.binding() == old_binding {
                Ok(fixture.binding())
            } else {
                Err(())
            }
        })
        .unwrap();
        assert_eq!(result.sources[0].status, NativeProjectSourceStatus::Blocked);
        remove_owned_fixture(&displaced).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn windows_junction_component_and_root_are_blocked_without_following() {
        use std::os::windows::process::CommandExt;
        let fixture = Fixture::new();
        let outside = Fixture::new();
        let link = fixture.0.join("Escape");
        let status = std::process::Command::new("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(&link)
            .arg(&outside.0)
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(status.status.success(), "junction fixture creation failed");
        let result = fixture.inspect(&["Escape/Source/Main.cpp"]);
        assert_eq!(result.sources[0].status, NativeProjectSourceStatus::Blocked);
        let binding = SourceRoot {
            original: link.clone(),
            canonical: fs::canonicalize(&link).unwrap(),
            authority: (),
        };
        let result = inspect_sources_using(fixture.input(&["Source/Main.cpp"]), |_| {
            Ok(SourceRoot {
                original: binding.original.clone(),
                canonical: binding.canonical.clone(),
                authority: (),
            })
        })
        .unwrap();
        assert_eq!(result.sources[0].status, NativeProjectSourceStatus::Blocked);
        fs::remove_dir(&link).unwrap();
    }

    #[test]
    fn bounded_reader_preserves_chinese_utf8_and_reports_only_observed_lines() {
        let text = "中".repeat(2730);
        for limit in [1, 2, 2048, 2730, 8191] {
            let prefix =
                bounded_utf8_prefix(&mut std::io::Cursor::new(text.as_bytes()), limit, 100)
                    .unwrap();
            assert!(prefix.content.len() <= limit as usize);
            assert!(text.starts_with(&prefix.content));
            assert!(prefix.content.is_char_boundary(prefix.content.len()));
            if limit < text.len() as u32 {
                assert!(prefix.truncated);
                assert!(!prefix.line_count_complete);
                assert_eq!(prefix.original_lines, 0);
            } else {
                assert!(!prefix.truncated);
                assert!(prefix.line_count_complete);
                assert_eq!(prefix.original_lines, 1);
            }
        }
        let mut reader = std::io::Cursor::new(b"a\nb\nc\n");
        let prefix = bounded_utf8_prefix(&mut reader, 1024, 2).unwrap();
        assert_eq!(prefix.content, "a\nb\n");
        assert_eq!(prefix.observed_lines, 2);
        assert!(prefix.truncated);
        assert!(!prefix.line_count_complete);
        assert_eq!(prefix.original_lines, 0);
        let exact = bounded_utf8_prefix(&mut std::io::Cursor::new(b"a\nb\n"), 1024, 2).unwrap();
        assert_eq!(exact.original_lines, 2);
        assert!(exact.line_count_complete);
        assert!(!exact.truncated);
    }

    #[test]
    fn bounded_reader_rejects_null_binary_and_incomplete_utf8() {
        for (bytes, lines) in [(0, 10), (10, 0)] {
            let mut reader = std::io::Cursor::new(b"not read");
            assert_eq!(
                bounded_utf8_prefix(&mut reader, bytes, lines).unwrap_err(),
                "invalid_source_request"
            );
            assert_eq!(reader.position(), 0);
        }
        for bytes in [&b"a\0z"[..], &[0xff][..], &[0xe4, 0xb8][..], &b"a\x01z"[..]] {
            assert_eq!(
                bounded_utf8_prefix(&mut std::io::Cursor::new(bytes), 1024, 10).unwrap_err(),
                "binary_or_extension_blocked"
            );
        }
        assert!(bounded_utf8_prefix(&mut std::io::Cursor::new([0xe4, 0xb8]), 1, 10).is_err());
        for bytes in [&b"a\0"[..], &[b'a', 0xff][..]] {
            assert!(bounded_utf8_prefix(&mut std::io::Cursor::new(bytes), 1, 10).is_err());
        }
    }

    struct CountedReader<R> {
        inner: R,
        bytes: usize,
        largest_request: usize,
    }

    impl<R: Read> Read for CountedReader<R> {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            self.largest_request = self.largest_request.max(buffer.len());
            let read = self.inner.read(buffer)?;
            self.bytes += read;
            Ok(read)
        }
    }

    #[test]
    fn oversized_real_file_is_read_with_a_hard_byte_and_memory_bound() {
        use std::io::Write;
        let fixture = Fixture::new();
        let path = fixture.0.join("Source/Large.cpp");
        {
            let mut file = fs::File::create(&path).unwrap();
            let chunk = [b'x'; 8192];
            for _ in 0..128 {
                file.write_all(&chunk).unwrap();
            }
        }
        assert_eq!(fs::metadata(&path).unwrap().len(), 1024 * 1024);
        for limit in [256, u32::MAX] {
            let mut counted = CountedReader {
                inner: fs::File::open(&path).unwrap(),
                bytes: 0,
                largest_request: 0,
            };
            let prefix = bounded_utf8_prefix(&mut counted, limit, 1).unwrap();
            let cap = limit.clamp(1, 16 * 1024) as usize;
            assert_eq!(prefix.content.len(), cap);
            assert!(prefix.content.capacity() <= cap + 4);
            assert!(counted.bytes <= cap + 4);
            assert_eq!(counted.largest_request, 1);
            assert!(counted.bytes < 1024 * 1024);
            assert!(prefix.truncated);
            assert_eq!(prefix.original_lines, 0);
            assert!(!prefix.line_count_complete);
        }
        let mut counted = CountedReader {
            inner: std::io::Cursor::new(b"x\nprivate bytes after line limit"),
            bytes: 0,
            largest_request: 0,
        };
        let prefix = bounded_utf8_prefix(&mut counted, 16 * 1024, 1).unwrap();
        assert_eq!(prefix.content, "x\n");
        assert_eq!(counted.bytes, 3);
    }

    #[cfg(windows)]
    #[test]
    fn scoped_preview_reads_bounded_metadata_and_rejects_post_read_revocation() {
        let fixture = Fixture::new();
        let path = fixture.0.join("Source/Main.cpp");
        let text = "中".repeat(2730);
        fs::write(&path, text.as_bytes()).unwrap();
        let preview = read_scoped_using("root:1234abcd", "Source/Main.cpp", 2048, 100, |_| {
            Ok(fixture.binding())
        })
        .unwrap();
        assert_eq!(preview.original_bytes, 8190);
        assert_eq!(preview.content.len(), 2046);
        assert_eq!(preview.observed_lines, 1);
        assert!(preview.truncated);
        assert_eq!(preview.original_lines, 0);
        assert!(!preview.line_count_complete);

        let mut calls = 0;
        let error = read_scoped_using("root:1234abcd", "Source/Main.cpp", 2048, 100, |_| {
            calls += 1;
            if calls == 1 {
                Ok(fixture.binding())
            } else {
                Err(())
            }
        })
        .unwrap_err();
        assert_eq!(calls, 2);
        assert_eq!(error, "trust_revoked");
    }

    #[cfg(windows)]
    #[test]
    fn scoped_preview_uses_the_validated_leaf_handle_and_pins_its_object() {
        let fixture = Fixture::new();
        let path = fixture.0.join("Source/Main.cpp");
        let node = open_windows_node(&path, true).unwrap();
        assert!(!node.is_link());
        assert!(final_handle_matches_path(&node, &fs::canonicalize(&path).unwrap()).unwrap());
        // Neither replacement nor a simultaneous writer can change the validated
        // leaf between validation and its actual read.
        assert!(fs::rename(&path, fixture.0.join("Replaced.cpp")).is_err());
        assert!(fs::write(&path, b"replacement").is_err());
        let mut same_handle = &node._handle;
        let preview = bounded_utf8_prefix(&mut same_handle, 1024, 10).unwrap();
        assert_eq!(preview.content, "initial");
        assert!(!preview.truncated);
        assert!(preview.line_count_complete);
        assert_eq!(preview.original_lines, 1);
    }

    #[cfg(windows)]
    #[test]
    fn scoped_preview_rejects_same_project_public_junction_to_private_and_env() {
        use std::os::windows::process::CommandExt;
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.0.join("Source/Public")).unwrap();
        fs::create_dir(fixture.0.join("Private")).unwrap();
        fs::write(
            fixture.0.join("Private/Hidden.ini"),
            b"private-junction-canary",
        )
        .unwrap();
        fs::write(fixture.0.join("Private/.env"), b"private-env-canary").unwrap();
        let link = fixture.0.join("Source").join("Public").join("Alias");
        let output = std::process::Command::new("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(&link)
            .arg(fixture.0.join("Private"))
            .creation_flags(0x08000000)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "same-project junction fixture creation failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        for path in [
            "Source/Public/Alias/Hidden.ini",
            "Source/Public/Alias/.env",
            "Private/.env",
        ] {
            let error =
                read_scoped_using("root:1234abcd", path, 2048, 100, |_| Ok(fixture.binding()))
                    .unwrap_err();
            assert_eq!(error, "source_path_blocked", "{path}");
            assert!(!error.contains("canary"));
        }
        fs::remove_dir(&link).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn unix_symlink_components_and_leaf_are_blocked() {
        use std::os::unix::fs::symlink;
        let fixture = Fixture::new();
        let outside = Fixture::new();
        let link = fixture.0.join("Escape");
        symlink(&outside.0, &link).unwrap();
        symlink(
            outside.0.join("Source/Main.cpp"),
            fixture.0.join("Leaf.cpp"),
        )
        .unwrap();
        let result = fixture.inspect(&["Escape/Source/Main.cpp", "Leaf.cpp"]);
        assert!(result.sources.iter().all(|entry| {
            entry.status == NativeProjectSourceStatus::Blocked && entry.version.is_none()
        }));
        fs::remove_file(link).unwrap();
        fs::remove_file(fixture.0.join("Leaf.cpp")).unwrap();
    }
}
