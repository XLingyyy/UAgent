//! Native-only, read-only Windows object leases. No approval, IPC, UI or global registry.
//! Paths/identity observations are never authority; retain the opaque live objects.
use std::fmt;
use std::path::Path;

pub const MAX_READ_BYTES: usize = 16 * 1024 * 1024;
const MAX_COMPONENTS: usize = 128;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RootError {
    pub code: &'static str,
    pub os_code: Option<u32>,
}
impl RootError {
    fn new(code: &'static str) -> Self {
        Self {
            code,
            os_code: None,
        }
    }
}
impl fmt::Display for RootError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.code)?;
        if let Some(code) = self.os_code {
            write!(f, " (OS {code})")?;
        }
        Ok(())
    }
}
impl std::error::Error for RootError {}
pub type Result<T> = std::result::Result<T, RootError>;

/// An observation only. Keeping an old ID cannot resurrect a dropped/revoked lease.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ObjectIdentity {
    volume_serial_number: u64,
    file_id: [u8; 16],
}
impl ObjectIdentity {
    pub fn volume_serial_number(&self) -> u64 {
        self.volume_serial_number
    }
    pub fn file_id(&self) -> [u8; 16] {
        self.file_id
    }
    pub fn observation_key(&self) -> String {
        let id = self
            .file_id
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        format!(
            "windows-fileid128:v1:{:016x}:{id}",
            self.volume_serial_number
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum NodeKind {
    Directory,
    File,
}

/// Data observed through one already-held file. The full 128-bit object
/// identity is retained separately from the legacy identity used by meta-v1.
/// Neither observation nor a metadata digest grants permission to open a path.
#[cfg(windows)]
pub(crate) struct BoundFileMetadata {
    identity: ObjectIdentity,
    legacy_identity: (u64, u64),
    metadata: std::fs::Metadata,
}
#[cfg(windows)]
impl BoundFileMetadata {
    pub(crate) fn identity(&self) -> ObjectIdentity { self.identity }
    pub(crate) fn legacy_identity(&self) -> (u64, u64) { self.legacy_identity }
    pub(crate) fn metadata(&self) -> &std::fs::Metadata { &self.metadata }
}

/// Host-selected relative scope. The subsequent scope constructor pins its actual anchor object.
#[derive(Clone, Debug)]
pub struct ReadRule {
    components: Vec<String>,
    kind: NodeKind,
}
impl ReadRule {
    pub fn exact_file(relative: &str) -> Result<Self> {
        Ok(Self {
            components: relative_components(relative)?,
            kind: NodeKind::File,
        })
    }
    pub fn subtree(relative: &str) -> Result<Self> {
        Ok(Self {
            components: relative_components(relative)?,
            kind: NodeKind::Directory,
        })
    }
}

#[derive(Debug)]
pub struct ReadObservation {
    pub root_identity: ObjectIdentity,
    pub file_identity: ObjectIdentity,
    pub relative_path: String,
    pub bytes: Vec<u8>,
}

fn component(name: &str) -> Result<String> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.ends_with([' ', '.'])
        || name
            .chars()
            .any(|c| c.is_control() || "<>:\"/\\|?*~".contains(c))
        || name.encode_utf16().count() > 255
    {
        return Err(RootError::new("invalid_path_component"));
    }
    let stem = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&stem.as_str())
        || ["COM", "LPT"].iter().any(|p| {
            stem.strip_prefix(p).is_some_and(|s| {
                ["1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"].contains(&s)
            })
        })
    {
        return Err(RootError::new("reserved_path_component"));
    }
    Ok(name.to_owned())
}
fn relative_components(relative: &str) -> Result<Vec<String>> {
    let normalized = relative.replace('/', "\\");
    let parts = normalized
        .split('\\')
        .map(component)
        .collect::<Result<Vec<_>>>()?;
    if parts.is_empty() || parts.len() > MAX_COMPONENTS {
        return Err(RootError::new("relative_path_depth"));
    }
    Ok(parts)
}
fn absolute_components(path: &Path) -> Result<(String, Vec<String>)> {
    let s = path
        .to_str()
        .ok_or_else(|| RootError::new("path_not_unicode"))?
        .replace('/', "\\");
    let b = s.as_bytes();
    if b.len() < 4 || !b[0].is_ascii_alphabetic() || b[1] != b':' || b[2] != b'\\' {
        return Err(RootError::new("local_absolute_project_path_required"));
    }
    // No UNC, verbatim/device namespace, drive-relative or volume-wide roots.
    let drive = format!("{}:\\", (b[0] as char).to_ascii_uppercase());
    Ok((drive, relative_components(&s[3..])?))
}

#[cfg(windows)]
#[path = "trusted_root_handle/windows.rs"]
mod windows;
#[cfg(windows)]
pub use windows::{BoundReadFile, PinnedDirectory, ScopedReader, TrustedRootHandle};

#[cfg(not(windows))]
mod unsupported {
    use super::*;
    #[derive(Debug)]
    pub struct TrustedRootHandle;
    #[derive(Debug)]
    pub struct ScopedReader;
    #[derive(Debug)]
    pub struct BoundReadFile;
    #[derive(Debug)]
    pub struct PinnedDirectory;
    impl TrustedRootHandle {
        pub fn open_from_host_selection(_: &Path) -> Result<Self> {
            Err(RootError::new("windows_trusted_root_unavailable"))
        }
        pub fn scope_from_verified_host(&self, _: Vec<ReadRule>) -> Result<ScopedReader> {
            Err(RootError::new("windows_trusted_root_unavailable"))
        }
    }
}
#[cfg(not(windows))]
pub use unsupported::{BoundReadFile, PinnedDirectory, ScopedReader, TrustedRootHandle};

#[cfg(all(test, windows))]
#[path = "trusted_root_handle/tests.rs"]
mod tests;
