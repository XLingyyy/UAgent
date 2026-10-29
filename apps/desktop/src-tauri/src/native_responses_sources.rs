//! Native-only source evidence for managed Responses dispatch.
//! No DTO here grants file access: capture_preview accepts a prefix already read
//! by the separately approved scoped tool. The broker stores these opaque values.
//! notify is asynchronous; it is not an atomic filesystem snapshot. Re-reading
//! selected bounded prefixes/manifests before every dispatch closes ordinary
//! notification delay, but a filesystem writer is not serialized with HTTP.
#![cfg(windows)]
#![allow(dead_code)]
use crate::native_provider_transport::{
    SourceAuthority, SourceCheckFailure, SourceChecker, SourcePhase, SourceSnapshot,
};
#[cfg(test)]
use crate::project_source_versions::read_scoped_project_file;
use crate::project_source_versions::{preview_from_bound_file, ScopedPreview};
use crate::trusted_root_handle::{BoundReadFile, TrustedRootHandle};
use crate::{resolve_trusted_root_binding_by_id, TrustedRootBinding};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

type Result<T> = std::result::Result<T, &'static str>;
const MAX_EVIDENCE: usize = 64;
const MAX_INDEX_ENTRIES: usize = 8192;
const MAX_INDEX_DEPTH: usize = 32;
const INDEX_TIME_LIMIT: Duration = Duration::from_secs(2);

#[derive(Clone)]
enum Observation {
    #[cfg(test)]
    Preview {
        path: String,
        bytes: u32,
        lines: u32,
    },
    GuardedPreview {
        path: String,
        bytes: u32,
        lines: u32,
        file: Arc<BoundReadFile>,
    },
    Index,
}
/// Non-serializable evidence issued only after a real native observation.
#[derive(Clone)]
pub(crate) struct SourceEvidence {
    monitor: Arc<()>,
    revision: u64,
    observation: Observation,
    digest: [u8; 32],
}
struct WatchedState {
    authority: SourceAuthority,
    identity: Arc<()>,
    revision: AtomicU64,
    active: AtomicBool,
    failed: AtomicBool,
}
impl WatchedState {
    fn invalidate(&self, terminal: bool) {
        if terminal {
            self.failed.store(true, Ordering::Release);
        }
        let revision = self
            .revision
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |v| v.checked_add(1));
        match revision {
            Ok(old) => {
                let mut hash = Sha256::new();
                hash.update(b"native-source-invalidation-v1");
                hash.update(old.to_le_bytes());
                hash.update([terminal as u8]);
                if self.authority.advance(hash.finalize().into()).is_err() {
                    self.failed.store(true, Ordering::Release);
                }
            }
            Err(_) => {
                self.failed.store(true, Ordering::Release);
                let _ = self.authority.advance([0; 32]);
            }
        }
    }
    fn revision(&self) -> Result<u64> {
        if !self.active.load(Ordering::Acquire) || self.failed.load(Ordering::Acquire) {
            return Err("native_source_unavailable");
        }
        Ok(self.revision.load(Ordering::Acquire))
    }
}
pub(crate) struct NativeSourceChecker {
    binding: TrustedRootBinding,
    held_root: Arc<TrustedRootHandle>,
    guard: RootGuard,
    shared: Arc<WatchedState>,
    selected: Mutex<Vec<SourceEvidence>>,
}
pub(crate) struct NativeSourceMonitor {
    checker: Arc<NativeSourceChecker>,
    watcher: Option<RecommendedWatcher>,
}
impl NativeSourceMonitor {
    pub(crate) fn start(project_id: &str, authority: SourceAuthority) -> Result<Self> {
        let binding = resolve_trusted_root_binding_by_id(project_id)
            .map_err(|_| "native_source_root_invalid")?;
        if binding.normalized_root.starts_with("fixture:") {
            return Err("native_source_root_invalid");
        }
        let held_root = crate::resolve_trusted_root_handle_by_id(project_id)
            .map_err(|_| "native_source_root_invalid")?;
        held_root
            .check_current()
            .map_err(|_| "native_source_root_invalid")?;
        let guard = RootGuard::acquire(&binding)?;
        let shared = Arc::new(WatchedState {
            authority,
            identity: Arc::new(()),
            revision: AtomicU64::new(1),
            active: AtomicBool::new(true),
            failed: AtomicBool::new(false),
        });
        let events = shared.clone();
        let mut watcher =
            notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
                match result {
                    // Reads/access do not change source facts and must not invalidate
                    // our own bounded checks. Every other event (including Other) does.
                    Ok(event) if matches!(event.kind, EventKind::Access(_)) => {}
                    Ok(_) => events.invalidate(false),
                    Err(_) => events.invalidate(true),
                }
            })
            .map_err(|_| "native_source_watcher_unavailable")?;
        watcher
            .watch(&binding.canonical_root, RecursiveMode::Recursive)
            .map_err(|_| "native_source_watcher_unavailable")?;
        let checker = Arc::new(NativeSourceChecker {
            binding,
            held_root,
            guard,
            shared,
            selected: Mutex::new(Vec::new()),
        });
        checker.verify_root()?;
        // Starting a new monitor always invalidates any previously captured lease.
        checker.shared.invalidate(false);
        let monitor = Self {
            checker,
            watcher: Some(watcher),
        };
        monitor.set_sources(&[])?;
        Ok(monitor)
    }
    pub(crate) fn checker(&self) -> Arc<NativeSourceChecker> {
        self.checker.clone()
    }
    /// Index evidence is independent of returned matches. Even a zero-result
    /// query must capture this native metadata manifest and store its evidence.
    pub(crate) fn capture_index(&self) -> Result<SourceEvidence> {
        self.checker.capture(Observation::Index, None)
    }
    /// Called only with the exact native prefix returned by the separately
    /// approved scoped-read operation, before its result is exposed to the model.
    /// Re-reading verifies the original result has not gone stale; it never
    /// blesses a renderer-supplied digest/path as original native evidence.
    #[cfg(test)]
    pub(crate) fn capture_preview(
        &self,
        path: &str,
        byte_limit: u32,
        line_limit: u32,
        actual: &ScopedPreview,
    ) -> Result<SourceEvidence> {
        if byte_limit == 0 || byte_limit > 16_384 || line_limit == 0 || line_limit > 2048 {
            return Err("native_source_request_invalid");
        }
        self.checker.capture(
            Observation::Preview {
                path: path.into(),
                bytes: byte_limit,
                lines: line_limit,
            },
            Some(preview_digest(actual)),
        )
    }
    /// Production evidence retains the exact live file guard returned by the
    /// separately approved native tool, through every check and final dispatch.
    pub(crate) fn capture_preview_guarded(
        &self,
        path: &str,
        byte_limit: u32,
        line_limit: u32,
        actual: &ScopedPreview,
        file: Arc<BoundReadFile>,
    ) -> Result<SourceEvidence> {
        if byte_limit == 0 || byte_limit > 16_384 || line_limit == 0 || line_limit > 2048 {
            return Err("native_source_request_invalid");
        }
        self.checker.capture(
            Observation::GuardedPreview {
                path: path.into(),
                bytes: byte_limit,
                lines: line_limit,
                file,
            },
            Some(preview_digest(actual)),
        )
    }
    /// Selected evidence remains immutable. A new revision requires a new native
    /// observation; this method never refreshes an old evidence token.
    pub(crate) fn set_sources(&self, sources: &[SourceEvidence]) -> Result<SourceSnapshot> {
        if sources.len() > MAX_EVIDENCE {
            return Err("native_source_limit");
        }
        let revision = self.checker.shared.revision()?;
        self.checker.verify_root()?;
        for evidence in sources {
            if !Arc::ptr_eq(&evidence.monitor, &self.checker.shared.identity)
                || evidence.revision != revision
                || self.checker.observe(&evidence.observation)? != evidence.digest
            {
                return Err("native_source_changed");
            }
        }
        self.checker.assert_revision(revision)?;
        let fingerprint = selected_digest(revision, sources);
        let mut selected = self
            .checker
            .selected
            .lock()
            .map_err(|_| "native_source_unavailable")?;
        // Publish the native selection before allowing callers to capture a lease.
        self.checker
            .shared
            .authority
            .advance(fingerprint)
            .map_err(|_| "native_source_unavailable")?;
        *selected = sources.to_vec();
        let snapshot = self
            .checker
            .shared
            .authority
            .snapshot()
            .map_err(|_| "native_source_unavailable")?;
        self.checker.assert_revision(revision)?;
        if snapshot.fingerprint() != fingerprint {
            return Err("native_source_changed");
        }
        Ok(snapshot)
    }
    /// Verify the original evidence without refreshing its revision or digest.
    /// For index tools: capture_index BEFORE the native query, execute the
    /// query, then verify_evidence BEFORE publishing even an empty result.
    pub(crate) fn verify_evidence(&self, evidence: &SourceEvidence) -> Result<()> {
        let revision = self.checker.shared.revision()?;
        self.checker.verify_root()?;
        if !Arc::ptr_eq(&evidence.monitor, &self.checker.shared.identity)
            || evidence.revision != revision
            || self.checker.observe(&evidence.observation)? != evidence.digest
        {
            return Err("native_source_changed");
        }
        self.checker.assert_revision(revision)
    }
    pub(crate) fn selected_sources(&self) -> Result<Vec<SourceEvidence>> {
        Ok(self
            .checker
            .selected
            .lock()
            .map_err(|_| "native_source_unavailable")?
            .clone())
    }
    pub(crate) fn current_snapshot(&self) -> Result<SourceSnapshot> {
        self.checker.shared.revision()?;
        self.checker.verify_root()?;
        self.checker
            .shared
            .authority
            .snapshot()
            .map_err(|_| "native_source_unavailable")
    }
    pub(crate) fn revoke(&self) {
        // Revoke under the same SourceAuthority/final-dispatch mutex BEFORE
        // releasing this monitor's file guards. External evidence owners must
        // likewise discard their own clones when the broker revokes the run.
        self.checker.shared.invalidate(true);
        self.checker.shared.active.store(false, Ordering::Release);
        if let Ok(mut selected) = self.checker.selected.lock() {
            selected.clear();
        }
    }
}
impl Drop for NativeSourceMonitor {
    fn drop(&mut self) {
        self.revoke();
        // Dropping notify joins/releases its owned native watcher, no process.
        self.watcher.take();
    }
}
impl NativeSourceChecker {
    fn verify_root(&self) -> Result<()> {
        self.shared.revision()?;
        self.held_root
            .check_current()
            .map_err(|_| "native_source_root_invalid")?;
        let current = crate::resolve_trusted_root_handle_by_id(&self.binding.root_id)
            .map_err(|_| "native_source_root_invalid")?;
        if !Arc::ptr_eq(&current, &self.held_root)
            || !self.guard.verify()
            || resolve_trusted_root_binding_by_id(&self.binding.root_id)
                .map_err(|_| "native_source_root_invalid")?
                != self.binding
        {
            return Err("native_source_root_invalid");
        }
        Ok(())
    }
    fn assert_revision(&self, revision: u64) -> Result<()> {
        if self.shared.revision()? != revision {
            return Err("native_source_changed");
        }
        self.verify_root()
    }
    fn observe(&self, observation: &Observation) -> Result<[u8; 32]> {
        match observation {
            #[cfg(test)]
            Observation::Preview { path, bytes, lines } => {
                let prefix = read_scoped_project_file(&self.binding.root_id, path, *bytes, *lines)
                    .map_err(|_| "native_source_changed")?;
                Ok(preview_digest(&prefix))
            }
            Observation::GuardedPreview {
                path,
                bytes,
                lines,
                file,
            } => {
                let prefix =
                    preview_from_bound_file(file, path, self.held_root.identity(), *bytes, *lines)
                        .map_err(|_| "native_source_changed")?;
                Ok(preview_digest(&prefix))
            }
            Observation::Index => index_digest(&self.binding.canonical_root),
        }
    }
    fn capture(
        &self,
        observation: Observation,
        expected: Option<[u8; 32]>,
    ) -> Result<SourceEvidence> {
        let revision = self.shared.revision()?;
        self.verify_root()?;
        let digest = self.observe(&observation)?;
        if expected.is_some_and(|expected| expected != digest) {
            return Err("native_source_changed");
        }
        self.assert_revision(revision)?;
        Ok(SourceEvidence {
            monitor: self.shared.identity.clone(),
            revision,
            observation,
            digest,
        })
    }
}
impl SourceChecker for NativeSourceChecker {
    fn check(
        &self,
        captured: &SourceSnapshot,
        _: SourcePhase,
    ) -> std::result::Result<SourceSnapshot, SourceCheckFailure> {
        let checked = (|| -> Result<SourceSnapshot> {
            let revision = self.shared.revision()?;
            self.verify_root()?;
            let sources = self
                .selected
                .lock()
                .map_err(|_| "native_source_unavailable")?
                .clone();
            let fingerprint = selected_digest(revision, &sources);
            if captured.fingerprint() != fingerprint {
                return Err("native_source_changed");
            }
            for source in sources {
                if !Arc::ptr_eq(&source.monitor, &self.shared.identity)
                    || source.revision != revision
                    || self.observe(&source.observation)? != source.digest
                {
                    return Err("native_source_changed");
                }
            }
            self.assert_revision(revision)?;
            let current = self
                .shared
                .authority
                .snapshot()
                .map_err(|_| "native_source_unavailable")?;
            if current.generation() != captured.generation()
                || current.fingerprint() != captured.fingerprint()
            {
                return Err("native_source_changed");
            }
            Ok(current)
        })();
        // Source failures invalidate the underlying session as well, including
        // any in-flight dispatch; they cannot be repaired by replacing a token.
        checked.map_err(|_| {
            self.shared.invalidate(true);
            SourceCheckFailure
        })
    }
}
fn preview_digest(value: &ScopedPreview) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"native-scoped-preview-v1");
    hash.update((value.content.len() as u64).to_le_bytes());
    hash.update(value.content.as_bytes());
    hash.update(value.original_bytes.to_le_bytes());
    hash.update(value.original_lines.to_le_bytes());
    hash.update(value.observed_lines.to_le_bytes());
    hash.update([value.truncated as u8, value.line_count_complete as u8]);
    hash.finalize().into()
}
fn selected_digest(revision: u64, sources: &[SourceEvidence]) -> [u8; 32] {
    let mut hash = Sha256::new();
    hash.update(b"native-selected-source-evidence-v1");
    hash.update(revision.to_le_bytes());
    for evidence in sources {
        match &evidence.observation {
            Observation::Index => hash.update(b"index"),
            Observation::GuardedPreview {
                path,
                bytes,
                lines,
                file,
            } => {
                hash.update(b"guarded-preview");
                hash.update((path.len() as u64).to_le_bytes());
                hash.update(path.as_bytes());
                hash.update(bytes.to_le_bytes());
                hash.update(lines.to_le_bytes());
                hash.update(file.identity().observation_key().as_bytes());
            }
            #[cfg(test)]
            Observation::Preview { path, bytes, lines } => {
                hash.update(b"preview");
                hash.update((path.len() as u64).to_le_bytes());
                hash.update(path.as_bytes());
                hash.update(bytes.to_le_bytes());
                hash.update(lines.to_le_bytes());
            }
        }
        hash.update(evidence.digest);
    }
    hash.finalize().into()
}

// Directory and ancestor handles exclude delete sharing. Reparse points are
// opened as objects and rejected, never followed. No file contents are read here.
struct Node {
    file: File,
    identity: (u32, u64),
    path: PathBuf,
}
impl Node {
    fn open(path: &Path) -> Result<Self> {
        let file = fs::OpenOptions::new()
            .access_mode(0x80)
            .share_mode(0x1 | 0x2)
            .custom_flags(0x02000000 | 0x00200000)
            .open(path)
            .map_err(|_| "native_source_path_blocked")?;
        let metadata = file.metadata().map_err(|_| "native_source_path_blocked")?;
        if metadata.file_attributes() & 0x400 != 0 || !metadata.is_dir() {
            return Err("native_source_path_blocked");
        }
        let mut information = std::mem::MaybeUninit::<FileInformation>::uninit();
        let ok = unsafe {
            GetFileInformationByHandle(file.as_raw_handle().cast(), information.as_mut_ptr())
        };
        if ok == 0 {
            return Err("native_source_path_blocked");
        }
        let information = unsafe { information.assume_init() };
        Ok(Self {
            file,
            identity: (
                information.volume_serial,
                ((information.index_high as u64) << 32) | information.index_low as u64,
            ),
            path: path.to_path_buf(),
        })
    }
    fn verify(&self) -> bool {
        Self::open(&self.path).is_ok_and(|node| node.identity == self.identity)
    }
}
struct RootGuard {
    nodes: Vec<Node>,
}
impl RootGuard {
    fn acquire(binding: &TrustedRootBinding) -> Result<Self> {
        let mut nodes = Vec::new();
        for path in [
            Path::new(&binding.normalized_root),
            binding.canonical_root.as_path(),
        ] {
            // Reject mapped UNC/device aliases after canonicalization too.
            if !path.is_absolute()
                || !matches!(path.components().next(), Some(std::path::Component::Prefix(prefix))
                    if matches!(prefix.kind(), std::path::Prefix::Disk(_) | std::path::Prefix::VerbatimDisk(_)))
            {
                return Err("native_source_root_invalid");
            }
            for ancestor in path.ancestors().collect::<Vec<_>>().into_iter().rev() {
                nodes.push(Node::open(ancestor)?);
            }
        }
        let guard = Self { nodes };
        if !guard.verify() {
            return Err("native_source_root_invalid");
        }
        Ok(guard)
    }
    fn verify(&self) -> bool {
        self.nodes.iter().all(Node::verify)
    }
}
#[repr(C)]
struct FileTime {
    low: u32,
    high: u32,
}
#[repr(C)]
struct FileInformation {
    attributes: u32,
    creation: FileTime,
    access: FileTime,
    write: FileTime,
    volume_serial: u32,
    size_high: u32,
    size_low: u32,
    links: u32,
    index_high: u32,
    index_low: u32,
}
#[link(name = "kernel32")]
extern "system" {
    fn GetFileInformationByHandle(
        handle: *mut std::ffi::c_void,
        information: *mut FileInformation,
    ) -> i32;
}
fn private_or_generated(name: &str) -> bool {
    let lower = name.to_lowercase();
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
        || [
            ".pem",
            ".key",
            ".p12",
            ".pfx",
            ".keystore",
            ".g.cpp",
            ".generated.h",
        ]
        .iter()
        .any(|suffix| lower.ends_with(suffix))
}
fn index_digest(root: &Path) -> Result<[u8; 32]> {
    let started = Instant::now();
    let mut count = 0usize;
    let mut hash = Sha256::new();
    hash.update(b"native-bounded-index-manifest-v1");
    fn walk(
        root: &Path,
        current: &Path,
        depth: usize,
        count: &mut usize,
        started: Instant,
        hash: &mut Sha256,
    ) -> Result<()> {
        if depth > MAX_INDEX_DEPTH || started.elapsed() > INDEX_TIME_LIMIT {
            return Err("native_source_limit");
        }
        let held = Node::open(current)?;
        let mut entries = Vec::new();
        for entry in fs::read_dir(current).map_err(|_| "native_source_unavailable")? {
            *count += 1;
            if *count > MAX_INDEX_ENTRIES || started.elapsed() > INDEX_TIME_LIMIT {
                return Err("native_source_limit");
            }
            let entry = entry.map_err(|_| "native_source_unavailable")?;
            let name = entry
                .file_name()
                .into_string()
                .map_err(|_| "native_source_path_blocked")?;
            if private_or_generated(&name) {
                continue;
            }
            entries.push((name, entry.path()));
        }
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        for (_, path) in entries {
            let file = fs::OpenOptions::new()
                .access_mode(0x80)
                .share_mode(0x1 | 0x2)
                .custom_flags(0x02000000 | 0x00200000)
                .open(&path)
                .map_err(|_| "native_source_index_open_failed")?;
            let metadata = file
                .metadata()
                .map_err(|_| "native_source_index_metadata_failed")?;
            if metadata.file_attributes() & 0x400 != 0 {
                return Err("native_source_path_blocked");
            }
            let relative = path
                .strip_prefix(root)
                .map_err(|_| "native_source_path_blocked")?
                .to_string_lossy();
            hash.update((relative.len() as u64).to_le_bytes());
            hash.update(relative.as_bytes());
            hash.update([metadata.is_dir() as u8]);
            hash.update(metadata.len().to_le_bytes());
            hash.update(metadata.creation_time().to_le_bytes());
            hash.update(metadata.last_write_time().to_le_bytes());
            if metadata.is_dir() {
                walk(root, &path, depth + 1, count, started, hash)?;
            }
        }
        if !held.verify() {
            return Err("native_source_changed");
        }
        Ok(())
    }
    walk(root, root, 0, &mut count, started, &mut hash)?;
    Ok(hash.finalize().into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::native_provider_transport::{
        ConfigVersion, CredentialBytes, DispatchSignal, DispatchStatus, MonotonicClock,
        NativeSession, Owner, RequestView, ResponseBuffer, Transport, TransportFailure,
        WriteReceipt, WriteStatus,
    };
    use std::sync::atomic::AtomicUsize;

    struct Fixture {
        path: PathBuf,
        project: String,
    }
    impl Fixture {
        fn new() -> Self {
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let path = std::env::temp_dir().join(format!(
                "uagent-responses-sources-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir_all(path.join("Source")).unwrap();
            fs::write(path.join("Source/Main.cpp"), "int main() { return 1; }\n").unwrap();
            fs::write(path.join("Lab.uproject"), "{}").unwrap();
            // Finish the newly created directory's initial metadata observation
            // before arming the watcher, as an already-scanned project does.
            // No captured evidence or native lease is refreshed here.
            index_digest(&path).unwrap();
            let result = crate::trust_native_project_root(crate::TrustRootInput {
                root_ref: path.to_string_lossy().into_owned(),
            })
            .unwrap();
            Self {
                path,
                project: result.root_id,
            }
        }
        fn session(&self) -> NativeSession {
            let session = NativeSession::new(
                Owner {
                    project: self.project.clone(),
                    epoch: 1,
                    run: "fixture-run".into(),
                    conversation: "fixture-chat".into(),
                    provider: "fixture-provider".into(),
                    model: "fixture-model".into(),
                },
                ConfigVersion {
                    generation: "fixture-generation".into(),
                    revision: 1,
                },
                [0; 32],
                Arc::new(MonotonicClock::new()),
            );
            session
                .install_credential(b"synthetic-source-fixture-key-ONLY".to_vec(), 60_000)
                .unwrap();
            session
        }
        fn monitor(&self, session: &NativeSession) -> NativeSourceMonitor {
            NativeSourceMonitor::start(&self.project, session.source_authority()).unwrap()
        }
        fn preview(&self) -> ScopedPreview {
            read_scoped_project_file(&self.project, "Source/Main.cpp", 128, 8).unwrap()
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            crate::trusted_roots().lock().unwrap().remove(&self.project);
            // Only this unique, locally constructed fixture directly under TEMP.
            // Leave files if identity/containment is not provable.
            if self.path.parent() == Some(std::env::temp_dir().as_path())
                && self.path.file_name().is_some_and(|name| {
                    name.to_string_lossy()
                        .starts_with("uagent-responses-sources-")
                })
                && fs::symlink_metadata(&self.path).is_ok_and(|m| m.file_attributes() & 0x400 == 0)
                && fs::canonicalize(&self.path).is_ok_and(|p| {
                    fs::canonicalize(std::env::temp_dir()).is_ok_and(|t| p.starts_with(t))
                })
            {
                let _ = fs::remove_dir_all(&self.path);
            }
        }
    }
    struct Sink(Arc<AtomicUsize>);
    impl Transport for Sink {
        fn before_dispatch(
            &mut self,
            _: RequestView<'_>,
        ) -> std::result::Result<(), TransportFailure> {
            Ok(())
        }
        fn dispatch(
            &mut self,
            _: RequestView<'_>,
            _: CredentialBytes<'_>,
            _: DispatchSignal<'_>,
            _: &mut ResponseBuffer,
        ) -> std::result::Result<WriteReceipt, TransportFailure> {
            self.0.fetch_add(1, Ordering::Relaxed);
            Ok(WriteReceipt {
                write: WriteStatus::Complete,
            })
        }
    }
    #[test]
    fn guarded_large_unicode_preview_is_bounded_and_preserves_original_size() {
        use crate::project_source_versions::read_bound_preview;
        let fixture = Fixture::new();
        let content = "\u{7532}\u{4e59}\u{4e19}".repeat(120_000);
        fs::write(fixture.path.join("Source/Main.cpp"), content.as_bytes()).unwrap();
        let (preview, file) =
            read_bound_preview(&fixture.project, "Source/Main.cpp", 7, 8).unwrap();
        let legacy = read_scoped_project_file(&fixture.project, "Source/Main.cpp", 7, 8).unwrap();
        assert_eq!(
            (
                &preview.content,
                preview.truncated,
                preview.original_bytes,
                preview.observed_lines,
                preview.line_count_complete,
                preview.original_lines
            ),
            (
                &legacy.content,
                legacy.truncated,
                legacy.original_bytes,
                legacy.observed_lines,
                legacy.line_count_complete,
                legacy.original_lines
            )
        );

        assert_eq!(preview.content, "\u{7532}\u{4e59}");
        assert_eq!(preview.original_bytes, content.len() as u64);
        assert!(preview.truncated);
        assert!(!preview.line_count_complete);
        assert_eq!(preview.original_lines, 0);
        assert_eq!(file.read_prefix_bounded(11).unwrap().bytes.len(), 11);
        assert_eq!(file.byte_len().unwrap(), content.len() as u64);
        assert!(read_bound_preview(&fixture.project, "../escape.cpp", 7, 8).is_err());
        assert!(read_bound_preview(&fixture.project, ".env", 7, 8).is_err());
    }
    #[test]
    fn guarded_evidence_holds_exact_file_until_revoke_and_rejects_foreign_guards() {
        use crate::project_source_versions::read_bound_preview;
        let fixture = Fixture::new();
        let other = Fixture::new();
        let session = fixture.session();
        let monitor = fixture.monitor(&session);
        let (actual, file) =
            read_bound_preview(&fixture.project, "Source/Main.cpp", 128, 8).unwrap();
        let (foreign, foreign_file) =
            read_bound_preview(&other.project, "Source/Main.cpp", 128, 8).unwrap();
        assert!(monitor
            .capture_preview_guarded("Source/Main.cpp", 128, 8, &foreign, foreign_file)
            .is_err());
        assert!(monitor
            .capture_preview_guarded("Source/Other.cpp", 128, 8, &actual, file.clone())
            .is_err());
        let evidence = monitor
            .capture_preview_guarded("Source/Main.cpp", 128, 8, &actual, file.clone())
            .unwrap();
        let snapshot = monitor.set_sources(&[evidence]).unwrap();
        drop(file);
        for phase in [
            SourcePhase::Prepare,
            SourcePhase::Approval,
            SourcePhase::BeforeDispatch,
        ] {
            assert!(monitor.checker().check(&snapshot, phase).is_ok());
        }
        let write_error =
            fs::write(fixture.path.join("Source/Main.cpp"), "blocked replacement").unwrap_err();
        assert_eq!(
            write_error.raw_os_error(),
            Some(32),
            "held file must keep write sharing denied"
        );
        monitor.revoke();
        assert!(monitor.selected_sources().unwrap().is_empty());
        fs::write(
            fixture.path.join("Source/Main.cpp"),
            "write after guard release",
        )
        .unwrap();
    }
    #[test]
    fn guarded_same_path_retrust_rejects_old_registry_arc_and_never_dispatches() {
        use crate::project_source_versions::read_bound_preview;
        let fixture = Fixture::new();
        let session = fixture.session();
        let monitor = fixture.monitor(&session);
        let old_root = crate::resolve_trusted_root_handle_by_id(&fixture.project).unwrap();
        let (actual, file) =
            read_bound_preview(&fixture.project, "Source/Main.cpp", 128, 8).unwrap();
        let evidence = monitor
            .capture_preview_guarded("Source/Main.cpp", 128, 8, &actual, file)
            .unwrap();
        monitor.set_sources(&[evidence]).unwrap();
        let checker = monitor.checker();
        let lease = session.capture_lease(60_000).unwrap();
        let request = session
            .prepare(
                &lease,
                "https://api.openai.com/v1",
                br#"{"model":"fixture-model"}"#.to_vec(),
                checker.as_ref(),
            )
            .unwrap();
        let grant = session.approve(&request, &lease, checker.as_ref()).unwrap();
        crate::trust_native_project_root(crate::TrustRootInput {
            root_ref: fixture.path.to_string_lossy().into_owned(),
        })
        .unwrap();
        let new_root = crate::resolve_trusted_root_handle_by_id(&fixture.project).unwrap();
        assert!(!Arc::ptr_eq(&old_root, &new_root));
        let count = Arc::new(AtomicUsize::new(0));
        let mut sink = Sink(count.clone());
        let outcome = session.dispatch(&request, &lease, &grant, checker.as_ref(), &mut sink);
        assert_eq!(outcome.status, DispatchStatus::NotDispatched);
        assert!(outcome.error.is_some());
        assert_eq!(count.load(Ordering::Relaxed), 0);
    }
    #[test]
    fn stable_native_preview_checks_all_phases_and_allows_synthetic_dispatch() {
        let fixture = Fixture::new();
        let session = fixture.session();
        let monitor = fixture.monitor(&session);
        let actual = fixture.preview();
        let evidence = monitor
            .capture_preview("Source/Main.cpp", 128, 8, &actual)
            .unwrap();
        let snapshot = monitor.set_sources(&[evidence]).unwrap();
        let checker = monitor.checker();
        for phase in [
            SourcePhase::Prepare,
            SourcePhase::Approval,
            SourcePhase::BeforeDispatch,
        ] {
            assert!(checker.check(&snapshot, phase).is_ok());
        }
        let lease = session.capture_lease(60_000).unwrap();
        let request = session
            .prepare(
                &lease,
                "https://api.openai.com/v1",
                br#"{"model":"fixture-model","input":"synthetic"}"#.to_vec(),
                checker.as_ref(),
            )
            .unwrap();
        let grant = session.approve(&request, &lease, checker.as_ref()).unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let mut sink = Sink(count.clone());
        let outcome = session.dispatch(&request, &lease, &grant, checker.as_ref(), &mut sink);
        assert!(outcome.error.is_none());
        assert_eq!(outcome.status, DispatchStatus::Sent);
        assert_eq!(count.load(Ordering::Relaxed), 1);
    }
    #[test]
    fn preview_capture_rejects_changed_original_and_sensitive_paths() {
        let fixture = Fixture::new();
        let session = fixture.session();
        let monitor = fixture.monitor(&session);
        let mut original = fixture.preview();
        original.content.push_str("not actually read");
        assert!(monitor
            .capture_preview("Source/Main.cpp", 128, 8, &original)
            .is_err());
        fs::write(fixture.path.join(".env"), "SYNTHETIC_SECRET=never_read").unwrap();
        assert!(monitor
            .capture_preview(".env", 128, 8, &fixture.preview())
            .is_err());
        assert!(monitor
            .capture_preview("../escape.cpp", 128, 8, &fixture.preview())
            .is_err());
    }
    #[test]
    fn zero_match_index_has_independent_evidence_and_new_file_prevents_dispatch() {
        let fixture = Fixture::new();
        let session = fixture.session();
        let monitor = fixture.monitor(&session);
        let evidence = monitor.capture_index().unwrap();
        // The query returned no matches, but this evidence is still selected.
        monitor.set_sources(&[evidence]).unwrap();
        let checker = monitor.checker();
        let lease = session.capture_lease(60_000).unwrap();
        let request = session
            .prepare(
                &lease,
                "https://api.openai.com/v1",
                br#"{"model":"fixture-model"}"#.to_vec(),
                checker.as_ref(),
            )
            .unwrap();
        let grant = session.approve(&request, &lease, checker.as_ref()).unwrap();
        fs::write(fixture.path.join("Source/PreviouslyMissing.cpp"), "target").unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let mut sink = Sink(count.clone());
        let outcome = session.dispatch(&request, &lease, &grant, checker.as_ref(), &mut sink);
        assert!(outcome.error.is_some());
        assert_eq!(outcome.status, DispatchStatus::NotDispatched);
        assert_eq!(count.load(Ordering::Relaxed), 0);
    }
    #[test]
    fn real_notify_change_invalidates_pending_review_with_no_selected_files() {
        let fixture = Fixture::new();
        let session = fixture.session();
        let monitor = fixture.monitor(&session);
        let checker = monitor.checker();
        let snapshot = monitor.current_snapshot().unwrap();
        let lease = session.capture_lease(60_000).unwrap();
        let request = session
            .prepare(
                &lease,
                "https://api.openai.com/v1",
                br#"{"model":"fixture-model"}"#.to_vec(),
                checker.as_ref(),
            )
            .unwrap();
        fs::write(fixture.path.join("Source/Other.cpp"), "modified").unwrap();
        let until = Instant::now() + Duration::from_secs(5);
        while monitor
            .current_snapshot()
            .is_ok_and(|s| s.generation() == snapshot.generation())
            && Instant::now() < until
        {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            monitor.current_snapshot().unwrap().generation() > snapshot.generation(),
            "real notify event not delivered"
        );
        assert!(session.approve(&request, &lease, checker.as_ref()).is_err());
    }
    #[test]
    fn evidence_is_bound_to_one_monitor_and_cannot_refresh_after_revision_change() {
        let fixture = Fixture::new();
        let first_session = fixture.session();
        let first = fixture.monitor(&first_session);
        let old = first
            .capture_preview("Source/Main.cpp", 128, 8, &fixture.preview())
            .unwrap();
        assert!(first.verify_evidence(&old).is_ok());
        let second_session = fixture.session();
        let second = fixture.monitor(&second_session);
        assert!(second.set_sources(&[old.clone()]).is_err());
        assert!(second.verify_evidence(&old).is_err());
        first.checker.shared.invalidate(false);
        assert!(first.verify_evidence(&old).is_err());
        assert!(first.set_sources(&[old]).is_err());
    }
    #[test]
    fn revoked_trust_and_dropped_monitor_fail_closed() {
        let fixture = Fixture::new();
        let session = fixture.session();
        let monitor = fixture.monitor(&session);
        let checker = monitor.checker();
        let snapshot = monitor.current_snapshot().unwrap();
        crate::trusted_roots()
            .lock()
            .unwrap()
            .remove(&fixture.project);
        assert!(checker
            .check(&snapshot, SourcePhase::BeforeDispatch)
            .is_err());
        drop(monitor);
        assert!(checker
            .check(&snapshot, SourcePhase::BeforeDispatch)
            .is_err());
        assert!(NativeSourceMonitor::start(&fixture.project, session.source_authority()).is_err());
    }
    #[test]
    fn native_watch_error_is_terminal_and_does_not_grant_a_new_snapshot() {
        let fixture = Fixture::new();
        let session = fixture.session();
        let monitor = fixture.monitor(&session);
        monitor.checker.shared.invalidate(true);
        assert!(monitor.capture_index().is_err());
        assert!(monitor.current_snapshot().is_err());
        assert!(monitor.set_sources(&[]).is_err());
    }
    #[test]
    fn real_windows_junction_is_never_followed_by_preview_or_index_capture() {
        let fixture = Fixture::new();
        let destination = Fixture::new();
        let alias = fixture.path.join("Alias");
        let status = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&alias)
            .arg(&destination.path)
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "junction fixture creation unavailable without changing privileges"
        );
        // Junction creation on local NTFS needs no symlink privilege.
        let session = fixture.session();
        let monitor = fixture.monitor(&session);
        assert!(monitor
            .capture_preview("Alias/Source/Main.cpp", 128, 8, &destination.preview())
            .is_err());
        assert!(monitor.capture_index().is_err());
        drop(monitor);
        // remove_dir removes this reparse point only; never recurse into destination.
        assert!(fs::symlink_metadata(&alias).unwrap().file_attributes() & 0x400 != 0);
        fs::remove_dir(&alias).unwrap();
        assert_eq!(
            fs::read_to_string(destination.path.join("Source/Main.cpp")).unwrap(),
            "int main() { return 1; }\n"
        );
    }
}
