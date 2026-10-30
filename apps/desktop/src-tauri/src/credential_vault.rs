//! User-level Windows Credential Manager storage for provider API credentials.
//!
//! This module does not enumerate credentials, authorize a model call, expose a
//! Tauri command, or return stored key bytes to a renderer. A binding must come
//! from native app-profile and current provider configuration, never IPC claims.
//! It holds native no-DELETE directory-chain pins itself. Its target includes
//! the app-data directory's same-handle volume/file identity, provider
//! generation, and exact canonical endpoint. Changing any component creates a
//! separate binding; no credential is migrated implicitly.
//!
//! Replace/delete callers must revoke their workers before waiting on this
//! module. Every sender must use with_current at the final native dispatch gate.
//! A named OS mutex serializes cooperating UAgent processes through the callback.
//! The callback is synchronous on the acquiring thread. It must not wait for a
//! vault mutation on another thread. No cross-process worker termination,
//! physical power-loss durability, or hostile same-user process isolation is
//! claimed here.
//!
//! Keys use unique per-version OS targets. Only the separate non-secret SQLite
//! active reference can make one usable. Revoke is committed before a fallible
//! OS delete/write; cleanup failures stay disabled/pending across restart. A
//! missing key returns an opaque tombstone mutation token after prior writes:
//! save callers must retain status.version even when status.exists is false.
//! If the initial metadata revocation transaction itself fails, no persistent
//! revocation is claimed. The caller must keep workers revoked and report that
//! state as unconfirmed, not show successful deletion or silently retry a send.
#![cfg(windows)]

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    marker::PhantomData,
    path::{Path, PathBuf},
    rc::Rc,
    sync::atomic::{compiler_fence, Ordering},
};

const MAGIC: &[u8; 8] = b"UACRED01";
const HEADER: usize = 8 + 32 + 32 + 2;
const MAX_KEY: usize = 2048;
const MAX_BLOB: usize = 2560;
const MASK: &str = "********";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultError {
    InvalidInput,
    Conflict,
    Unavailable,
    Busy,
    CleanupPending,
}
#[path = "credential_vault/metadata.rs"]
mod metadata;
impl VaultError {
    fn new(kind: &str, _message: &str) -> Self {
        if kind == "busy" {
            Self::Busy
        } else {
            Self::Unavailable
        }
    }
    fn invalid(_message: &str) -> Self {
        Self::InvalidInput
    }
    fn corrupt() -> Self {
        Self::Unavailable
    }
    pub fn kind(self) -> &'static str {
        match self {
            Self::InvalidInput => "credential_input_invalid",
            Self::Conflict => "credential_version_conflict",
            Self::Unavailable => "credential_vault_unavailable",
            Self::Busy => "credential_vault_busy",
            Self::CleanupPending => "credential_cleanup_pending",
        }
    }
}
impl std::fmt::Display for VaultError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.kind())
    }
}
impl std::error::Error for VaultError {}
pub type Result<T> = std::result::Result<T, VaultError>;

fn zero(bytes: &mut [u8]) {
    for byte in bytes {
        unsafe { std::ptr::write_volatile(byte, 0) };
    }
    compiler_fence(Ordering::SeqCst);
}
struct SensitiveBytes(Vec<u8>);
impl Drop for SensitiveBytes {
    fn drop(&mut self) {
        zero(&mut self.0);
    }
}
/// Intentionally neither Debug, Clone, Serialize nor Deserialize.
pub struct Secret(SensitiveBytes);
impl Secret {
    pub fn new(mut value: Vec<u8>) -> Result<Self> {
        if !(8..=MAX_KEY).contains(&value.len())
            || value.iter().any(|byte| !(0x21..=0x7e).contains(byte))
        {
            zero(&mut value);
            return Err(VaultError::InvalidInput);
        }
        Ok(Self(SensitiveBytes(value)))
    }
    /// Native-only borrow. Never serialize or copy this into an IPC response.
    pub fn as_bytes(&self) -> &[u8] {
        &self.0 .0
    }
}

/// Only describes OS-record usability. This is never a grant to load or send.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CredentialRecovery {
    Missing,
    Corrupt,
    Unavailable,
}
impl From<CredentialRecovery> for VaultError {
    fn from(_: CredentialRecovery) -> Self {
        Self::Unavailable
    }
}
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CredentialStatus {
    pub exists: bool,
    /// Captured mutation token, including a tombstone when exists=false.
    /// Never turn this into permission to open without checking exists.
    pub version: Option<String>,
    pub masked: Option<&'static str>,
    pub cleanup_pending: bool,
    /// A healthy metadata token survives OS-record failure for explicit repair.
    /// exists=false and masked=None for every recovery state.
    pub recovery: Option<CredentialRecovery>,
}
impl CredentialStatus {
    fn absent() -> Self {
        Self {
            exists: false,
            version: None,
            masked: None,
            cleanup_pending: false,
            recovery: None,
        }
    }
    fn present(version: String) -> Self {
        Self {
            exists: true,
            version: Some(version),
            masked: Some(MASK),
            cleanup_pending: false,
            recovery: None,
        }
    }
}
#[derive(Clone)]
pub struct CredentialBinding {
    target: String,
    digest: [u8; 32],
    profile_root: PathBuf,
    profile_identity: [u8; 24],
    _pins: std::sync::Arc<Vec<std::fs::File>>,
}
impl CredentialBinding {
    fn os_target(&self, version: &str) -> Result<String> {
        version_bytes(version)?;
        Ok(format!("{}.{}", self.target, version))
    }
    /// profile_root must be the native app_profile-resolved directory. The
    /// binding itself pins the complete local directory chain and rejects reparse.
    /// The endpoint must already have passed the actual native endpoint policy.
    pub fn new(
        profile_root: &Path,
        provider_id: &str,
        provider_generation: &str,
        canonical_endpoint: &str,
    ) -> Result<Self> {
        fn id(s: &str, min: usize) -> bool {
            (min..=128).contains(&s.len())
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_.:-".contains(&b))
        }
        if !id(provider_id, 1)
            || !id(provider_generation, 8)
            || !matches!(
                canonical_endpoint,
                "https://api.deepseek.com" | "https://api.openai.com/v1"
            )
        {
            return Err(VaultError::InvalidInput);
        }
        // Bind the actual native wire protocol and complete fixed dispatch URL
        // as well as the canonical configuration root. A saved key never grants
        // authority to a different protocol or URL on the same domain.
        let (protocol, dispatch_url) = match canonical_endpoint {
            "https://api.deepseek.com" => (
                "chat_completions",
                "https://api.deepseek.com/chat/completions",
            ),
            "https://api.openai.com/v1" => ("responses", "https://api.openai.com/v1/responses"),
            _ => return Err(VaultError::InvalidInput),
        };
        let pinned = windows::pin_directory_chain(profile_root)?;
        let identity = pinned.identity;
        let mut hash = Sha256::new();
        hash.update(b"uagent.provider-credential.binding.v1");
        for part in [
            identity.as_slice(),
            provider_id.as_bytes(),
            provider_generation.as_bytes(),
            canonical_endpoint.as_bytes(),
            protocol.as_bytes(),
            dispatch_url.as_bytes(),
        ] {
            hash.update((part.len() as u64).to_le_bytes());
            hash.update(part);
        }
        let digest: [u8; 32] = hash.finalize().into();
        Ok(Self {
            target: format!("UAgent.ProviderCredential.v1.{}", hex(&digest)),
            digest,
            profile_root: profile_root.to_path_buf(),
            profile_identity: identity,
            _pins: std::sync::Arc::new(pinned.files),
        })
    }
}
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
fn version_bytes(value: &str) -> Result<[u8; 32]> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
    {
        return Err(VaultError::InvalidInput);
    }
    let mut bytes = [0; 32];
    for (index, pair) in value.as_bytes().chunks_exact(2).enumerate() {
        let text = std::str::from_utf8(pair).map_err(|_| VaultError::InvalidInput)?;
        bytes[index] = u8::from_str_radix(text, 16).map_err(|_| VaultError::InvalidInput)?;
    }
    Ok(bytes)
}
struct Record {
    version: String,
    secret: Secret,
}
fn read_record(
    binding: &CredentialBinding,
    expected_version: &str,
) -> std::result::Result<Record, CredentialRecovery> {
    let Some(bytes) = windows::read(
        &binding
            .os_target(expected_version)
            .map_err(|_| CredentialRecovery::Unavailable)?,
    )?
    else {
        return Err(CredentialRecovery::Missing);
    };
    let b = bytes.0.as_slice();
    if !(HEADER + 8..=HEADER + MAX_KEY).contains(&b.len())
        || b.get(..8) != Some(MAGIC.as_slice())
        || b.get(8..40) != Some(binding.digest.as_slice())
        || hex(&b[40..72]) != expected_version
        || usize::from(u16::from_le_bytes([b[72], b[73]])) != b.len() - HEADER
    {
        return Err(CredentialRecovery::Corrupt);
    }
    let secret = Secret::new(b[HEADER..].to_vec()).map_err(|_| CredentialRecovery::Corrupt)?;
    Ok(Record {
        version: expected_version.into(),
        secret,
    })
}
fn describe(state: &metadata::State) -> CredentialStatus {
    let mut status = state
        .active
        .as_ref()
        .map_or_else(CredentialStatus::absent, |v| {
            CredentialStatus::present(v.clone())
        });
    status.version = state.token.clone(); // May identify a tombstone; never authority to load.
    status.cleanup_pending = !state.cleanup.is_empty();
    status
}
fn require_current(state: &metadata::State, expected: &str) -> Result<()> {
    version_bytes(expected)?;
    if state.active.as_deref() != Some(expected) {
        return Err(VaultError::Conflict);
    }
    Ok(())
}
fn cleanup_state(
    binding: &CredentialBinding,
    db: &metadata::Metadata,
    state: metadata::State,
) -> Result<metadata::State> {
    let mut pending = Vec::new();
    for version in &state.cleanup {
        if state.active.as_deref() == Some(version) {
            return Err(VaultError::Unavailable);
        }
        if windows::delete(&binding.os_target(version)?).is_err() {
            pending.push(version.clone());
        }
    }
    if pending == state.cleanup {
        return Ok(state);
    }
    db.update(&state, state.active.as_deref(), &pending)
}
pub fn status(binding: &CredentialBinding) -> Result<CredentialStatus> {
    let _guard = windows::TargetGuard::acquire(&binding.target)?;
    let db = metadata::Metadata::open(binding)?;
    let state = db.state()?;
    let mut status = describe(&state);
    if let Some(active) = &state.active {
        if let Err(recovery) = read_record(binding, active) {
            // The metadata token stays trustworthy even when its OS record is
            // not usable. Return it for explicit CAS repair, never for Send.
            status.exists = false;
            status.masked = None;
            status.recovery = Some(recovery);
        }
    }
    Ok(status)
}
pub fn save(
    binding: &CredentialBinding,
    expected_version: Option<&str>,
    secret: Secret,
) -> Result<CredentialStatus> {
    if let Some(version) = expected_version {
        version_bytes(version)?;
    }
    let _guard = windows::TargetGuard::acquire(&binding.target)?;
    let db = metadata::Metadata::open(binding)?;
    let previous = db.state()?;
    if previous.token.as_deref() != expected_version {
        return Err(VaultError::Conflict);
    }
    let mut random = [0u8; 32];
    getrandom::getrandom(&mut random).map_err(|_| VaultError::Unavailable)?;
    let version = hex(&random);
    let mut pending = previous.cleanup.clone();
    if let Some(old) = &previous.active {
        pending.push(old.clone());
    }
    pending.push(version.clone());
    // Commit revocation and orphan ownership BEFORE any fallible OS write.
    // A failed new write or a crash cannot make the old reference active again.
    let disabled = db.update(&previous, None, &pending)?;
    let mut blob = SensitiveBytes(Vec::with_capacity(HEADER + secret.as_bytes().len()));
    blob.0.extend_from_slice(MAGIC);
    blob.0.extend_from_slice(&binding.digest);
    blob.0.extend_from_slice(&random);
    blob.0
        .extend_from_slice(&(secret.as_bytes().len() as u16).to_le_bytes());
    blob.0.extend_from_slice(secret.as_bytes());
    windows::write(&binding.os_target(&version)?, &blob.0)?;
    let recorded = read_record(binding, &version)?;
    if recorded.version != version || recorded.secret.as_bytes() != secret.as_bytes() {
        return Err(VaultError::Unavailable);
    }
    let pending: Vec<_> = pending.into_iter().filter(|v| v != &version).collect();
    let active = db.update(&disabled, Some(&version), &pending)?;
    let cleaned = cleanup_state(binding, &db, active)?;
    Ok(describe(&cleaned))
}
pub fn delete(binding: &CredentialBinding, expected_version: &str) -> Result<CredentialStatus> {
    version_bytes(expected_version)?;
    let _guard = windows::TargetGuard::acquire(&binding.target)?;
    let db = metadata::Metadata::open(binding)?;
    let current = db.state()?;
    require_current(&current, expected_version)?;
    let mut pending = current.cleanup.clone();
    pending.push(expected_version.into());
    let disabled = db.update(&current, None, &pending)?;
    let cleaned = cleanup_state(binding, &db, disabled)?;
    if !cleaned.cleanup.is_empty() {
        return Err(VaultError::CleanupPending);
    }
    Ok(describe(&cleaned))
}
/// Retry only already-disabled exact version targets owned by this binding.
/// This cannot delete or deactivate the currently active key.
pub fn cleanup(binding: &CredentialBinding) -> Result<CredentialStatus> {
    let _guard = windows::TargetGuard::acquire(&binding.target)?;
    let db = metadata::Metadata::open(binding)?;
    let cleaned = cleanup_state(binding, &db, db.state()?)?;
    if !cleaned.cleanup.is_empty() {
        return Err(VaultError::CleanupPending);
    }
    Ok(describe(&cleaned))
}
pub fn load(binding: &CredentialBinding, expected_version: &str) -> Result<Secret> {
    version_bytes(expected_version)?;
    let _guard = windows::TargetGuard::acquire(&binding.target)?;
    let state = metadata::Metadata::open(binding)?.state()?;
    require_current(&state, expected_version)?;
    Ok(read_record(binding, expected_version)?.secret)
}
/// Keep the durable active reference and exact OS version current until the
/// synchronous callback returns. Superseded/deleted records cannot invoke it.
pub fn with_current<T>(
    binding: &CredentialBinding,
    expected_version: &str,
    callback: impl FnOnce() -> T,
) -> Result<T> {
    version_bytes(expected_version)?;
    let _guard = windows::TargetGuard::acquire(&binding.target)?;
    let state = metadata::Metadata::open(binding)?.state()?;
    require_current(&state, expected_version)?;
    drop(read_record(binding, expected_version)?);
    Ok(callback())
}
#[cfg(test)]
mod faults {
    use std::cell::Cell;
    thread_local! {
        pub static FAIL_WRITE:Cell<bool>=const{Cell::new(false)};
        pub static FAIL_DELETE:Cell<bool>=const{Cell::new(false)};
        pub static FAIL_READ:Cell<bool>=const{Cell::new(false)};
    }
}

mod windows {
    use super::*;
    use std::{
        ffi::c_void,
        fs::OpenOptions,
        os::windows::{fs::OpenOptionsExt, io::AsRawHandle},
        ptr,
    };

    type Handle = *mut c_void;
    #[repr(C)]
    struct FileIdInfo {
        volume: u64,
        id: [u8; 16],
    }
    #[repr(C)]
    struct FileTime {
        low: u32,
        high: u32,
    }
    #[repr(C)]
    struct Credential {
        flags: u32,
        kind: u32,
        target: *mut u16,
        comment: *mut u16,
        last_written: FileTime,
        blob_size: u32,
        blob: *mut u8,
        persist: u32,
        attribute_count: u32,
        attributes: *mut c_void,
        alias: *mut u16,
        username: *mut u16,
    }
    #[link(name = "advapi32")]
    extern "system" {
        fn CredReadW(target: *const u16, kind: u32, flags: u32, value: *mut *mut Credential)
            -> i32;
        fn CredWriteW(value: *const Credential, flags: u32) -> i32;
        fn CredDeleteW(target: *const u16, kind: u32, flags: u32) -> i32;
        fn CredFree(value: *mut c_void);
        fn OpenProcessToken(process: Handle, access: u32, token: *mut Handle) -> i32;
        fn GetTokenInformation(
            token: Handle,
            class: u32,
            information: *mut c_void,
            size: u32,
            returned: *mut u32,
        ) -> i32;
        fn IsValidSid(sid: *const c_void) -> i32;
        fn GetLengthSid(sid: *const c_void) -> u32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetLastError() -> u32;
        fn GetCurrentProcess() -> Handle;
        fn CloseHandle(handle: isize) -> i32;
        fn GetFileInformationByHandleEx(
            handle: Handle,
            class: u32,
            value: *mut c_void,
            size: u32,
        ) -> i32;
        fn CreateMutexW(attributes: *const c_void, owned: i32, name: *const u16) -> Handle;
        fn WaitForSingleObject(handle: isize, milliseconds: u32) -> u32;
        fn ReleaseMutex(handle: Handle) -> i32;
    }
    struct OwnedHandle(Handle);
    impl Drop for OwnedHandle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0 as isize);
            }
        }
    }
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }
    pub(super) struct PinnedRoot {
        pub identity: [u8; 24],
        pub files: Vec<std::fs::File>,
    }
    pub(super) fn pin_directory_chain(path: &Path) -> Result<PinnedRoot> {
        use std::os::windows::fs::MetadataExt;
        use std::path::{Component, Prefix};
        let mut components = path.components();
        let prefix = match components.next() {
            Some(Component::Prefix(p))
                if matches!(p.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)) =>
            {
                p
            }
            _ => return Err(VaultError::InvalidInput),
        };
        if !matches!(components.next(), Some(Component::RootDir)) {
            return Err(VaultError::InvalidInput);
        }
        let mut current = std::path::PathBuf::from(prefix.as_os_str());
        current.push(std::path::MAIN_SEPARATOR.to_string());
        let open = |p: &Path| -> Result<std::fs::File> {
            let file = OpenOptions::new()
                // FILE_LIST_DIRECTORY participates in Windows share checks;
                // FILE_READ_ATTRIBUTES alone does not reliably deny rename.
                .access_mode(0x81)
                .share_mode(3)
                .custom_flags(0x0220_0000)
                .open(p)
                .map_err(|_| VaultError::Unavailable)?;
            let info = file.metadata().map_err(|_| VaultError::Unavailable)?;
            if !info.is_dir() || info.file_attributes() & 0x400 != 0 {
                return Err(VaultError::InvalidInput);
            }
            Ok(file)
        };
        let mut files = vec![open(&current)?];
        for component in components {
            let Component::Normal(part) = component else {
                return Err(VaultError::InvalidInput);
            };
            let text = part.to_str().ok_or(VaultError::InvalidInput)?;
            if text.is_empty()
                || text.ends_with(['.', ' '])
                || text.contains(':')
                || text.chars().any(char::is_control)
            {
                return Err(VaultError::InvalidInput);
            }
            current.push(part);
            files.push(open(&current)?);
        }
        if files.len() < 2 {
            return Err(VaultError::InvalidInput);
        }
        // The identity comes from the same final handle retained in the chain.
        let identity = file_identity(files.last().ok_or(VaultError::Unavailable)?)?;
        Ok(PinnedRoot { identity, files })
    }
    pub(super) fn directory_identity(path: &Path) -> Result<[u8; 24]> {
        let file = OpenOptions::new()
            .access_mode(0x80)
            .share_mode(7)
            .custom_flags(0x0220_0000)
            .open(path)
            .map_err(|_| VaultError::Unavailable)?;
        file_identity(&file)
    }
    fn file_identity(file: &std::fs::File) -> Result<[u8; 24]> {
        let mut info = FileIdInfo {
            volume: 0,
            id: [0; 16],
        };
        if unsafe {
            GetFileInformationByHandleEx(
                file.as_raw_handle(),
                18,
                (&mut info as *mut FileIdInfo).cast(),
                std::mem::size_of::<FileIdInfo>() as u32,
            )
        } == 0
        {
            return Err(VaultError::Unavailable);
        }
        let mut bytes = [0; 24];
        bytes[..8].copy_from_slice(&info.volume.to_le_bytes());
        bytes[8..].copy_from_slice(&info.id);
        Ok(bytes)
    }
    struct ReadCredential(*mut Credential);
    impl Drop for ReadCredential {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    let c = &mut *self.0;
                    if !c.blob.is_null() && c.blob_size <= MAX_BLOB as u32 {
                        zero(std::slice::from_raw_parts_mut(c.blob, c.blob_size as usize));
                    }
                    CredFree(self.0.cast());
                }
            }
        }
    }
    pub(super) fn read(
        target: &str,
    ) -> std::result::Result<Option<SensitiveBytes>, CredentialRecovery> {
        #[cfg(test)]
        if super::faults::FAIL_READ.with(|v| v.replace(false)) {
            return Err(CredentialRecovery::Unavailable);
        }
        let target = wide(target);
        let mut raw = ptr::null_mut();
        if unsafe { CredReadW(target.as_ptr(), 1, 0, &mut raw) } == 0 {
            return if unsafe { GetLastError() } == 1168 {
                Ok(None)
            } else {
                Err(CredentialRecovery::Unavailable)
            };
        }
        let guard = ReadCredential(raw);
        if guard.0.is_null() {
            return Err(CredentialRecovery::Corrupt);
        }
        let c = unsafe { &*guard.0 };
        if c.kind != 1
            || c.persist != 2
            || c.blob_size as usize > MAX_BLOB
            || (c.blob.is_null() && c.blob_size != 0)
        {
            return Err(CredentialRecovery::Corrupt);
        }
        let bytes = if c.blob_size == 0 {
            Vec::new()
        } else {
            unsafe { std::slice::from_raw_parts(c.blob, c.blob_size as usize) }.to_vec()
        };
        Ok(Some(SensitiveBytes(bytes)))
    }
    pub(super) fn write(target: &str, blob: &[u8]) -> Result<()> {
        #[cfg(test)]
        if super::faults::FAIL_WRITE.with(|v| v.replace(false)) {
            return Err(VaultError::Unavailable);
        }
        if blob.len() > MAX_BLOB {
            return Err(VaultError::InvalidInput);
        }
        let mut target = wide(target);
        let mut username = wide("UAgent provider API credential");
        let c = Credential {
            flags: 0,
            kind: 1,
            target: target.as_mut_ptr(),
            comment: ptr::null_mut(),
            last_written: FileTime { low: 0, high: 0 },
            blob_size: blob.len() as u32,
            blob: blob.as_ptr().cast_mut(),
            persist: 2,
            attribute_count: 0,
            attributes: ptr::null_mut(),
            alias: ptr::null_mut(),
            username: username.as_mut_ptr(),
        };
        if unsafe { CredWriteW(&c, 0) } == 0 {
            return Err(VaultError::Unavailable);
        }
        Ok(())
    }
    pub(super) fn delete(target: &str) -> Result<()> {
        #[cfg(test)]
        if super::faults::FAIL_DELETE.with(|v| v.replace(false)) {
            return Err(VaultError::Unavailable);
        }
        let target = wide(target);
        if unsafe { CredDeleteW(target.as_ptr(), 1, 0) } == 0 && unsafe { GetLastError() } != 1168 {
            return Err(VaultError::Unavailable);
        }
        Ok(())
    }
    fn user_identity() -> Result<[u8; 32]> {
        let mut token = ptr::null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), 8, &mut token) } == 0 {
            return Err(VaultError::Unavailable);
        }
        let token = OwnedHandle(token);
        let mut required = 0;
        unsafe {
            GetTokenInformation(token.0, 1, ptr::null_mut(), 0, &mut required);
        }
        if !(std::mem::size_of::<usize>() as u32..=4096).contains(&required) {
            return Err(VaultError::Unavailable);
        }
        // usize backing provides alignment for TOKEN_USER's pointer.
        let mut buffer = vec![0usize; (required as usize).div_ceil(std::mem::size_of::<usize>())];
        if unsafe {
            GetTokenInformation(
                token.0,
                1,
                buffer.as_mut_ptr().cast(),
                (buffer.len() * std::mem::size_of::<usize>()) as u32,
                &mut required,
            )
        } == 0
        {
            return Err(VaultError::Unavailable);
        }
        let sid = buffer[0] as *const c_void;
        let start = buffer.as_ptr() as usize;
        let end = start + buffer.len() * std::mem::size_of::<usize>();
        if (sid as usize) < start
            || !matches!((sid as usize).checked_add(8), Some(n) if n <= end)
            || unsafe { IsValidSid(sid) } == 0
        {
            return Err(VaultError::Unavailable);
        }
        let len = unsafe { GetLengthSid(sid) } as usize;
        if len == 0 || !matches!((sid as usize).checked_add(len), Some(n) if n <= end) {
            return Err(VaultError::Unavailable);
        }
        Ok(Sha256::digest(unsafe { std::slice::from_raw_parts(sid.cast::<u8>(), len) }).into())
    }
    pub(super) struct TargetGuard {
        handle: OwnedHandle,
        _same_thread: PhantomData<Rc<()>>,
    }
    impl TargetGuard {
        pub(super) fn acquire(target: &str) -> Result<Self> {
            let mut hash = Sha256::new();
            hash.update(user_identity()?);
            hash.update(target.as_bytes());
            let name = wide(&format!(
                "Global\\UAgent.CredentialVault.v1.{}",
                hex(&hash.finalize())
            ));
            let raw = unsafe { CreateMutexW(ptr::null(), 0, name.as_ptr()) };
            if raw.is_null() {
                return Err(VaultError::Unavailable);
            }
            let handle = OwnedHandle(raw);
            match unsafe { WaitForSingleObject(handle.0 as isize, 5000) } {
                0 => Ok(Self {
                    handle,
                    _same_thread: PhantomData,
                }),
                0x80 => {
                    // We acquired an abandoned lock, but this operation cannot
                    // claim the interrupted mutation's result. Release and fail.
                    unsafe {
                        ReleaseMutex(handle.0);
                    }
                    Err(VaultError::Unavailable)
                }
                0x102 => Err(VaultError::Busy),
                _ => Err(VaultError::Unavailable),
            }
        }
    }
    impl Drop for TargetGuard {
        fn drop(&mut self) {
            unsafe {
                ReleaseMutex(self.handle.0);
            }
        }
    }
}

#[cfg(test)]
#[path = "credential_vault/tests.rs"]
mod tests;
