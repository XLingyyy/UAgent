//! Read-only desktop UE build preview. No execution, approval or editor IPC lives here.
//! Integration: declare this and ue_build_profile under cfg(windows), manage
//! one UEBuildPreviewState plus its start_monitor() guard, then register the commands.
#![cfg(windows)]
use crate::trusted_root_handle::{BoundReadFile, ReadRule, TrustedRootHandle};
use crate::ue_build_profile::{prepare_ue_build, PreparedUEBuild, UEBuildPreview, UEBuildProfile};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Component, Path};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const PROFILE_ID: &str = "desktop-fixed-editor-preview-v1";
const PREVIEW_TTL: Duration = Duration::from_secs(120);
const MAX_PREVIEWS: usize = 4;
const FIXED_TIMEOUT_MS: u64 = 600_000;

/// These are configuration data, never a serialized root, grant or executable plan.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PreparePreviewInput {
    pub project_id: String,
    pub engine_root: String,
    pub uproject_relative_path: String,
    pub target: String,
    pub bundled_dotnet_version: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ReleasePreviewInput {
    pub project_id: String,
    pub prepared_id: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewReceipt {
    schema_version: u32,
    prepared_id: String,
    project_id: String,
    prepared_at_ms: u64,
    expires_at_ms: u64,
    status: &'static str,
    execution_enabled: bool,
    verification: &'static str,
    preview: UEBuildPreview,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReleaseReceipt {
    released: bool,
}

// Private, non-deserializable and deliberately without a plan retrieval/execute port.
// Source guards are held during preparation only. A preview is a metadata snapshot;
// retaining it must not prevent ordinary source edits for its whole display lifetime.
struct StoredPreview {
    project_id: String,
    expires: Instant,
    root: Arc<TrustedRootHandle>,
    _prepared: PreparedUEBuild,
    document: Arc<crate::managed_run_store::NativeStoreWindowGrant>,
}
const REVOCATION_POLL: Duration = Duration::from_millis(250);
#[derive(Default)]
struct Registry {
    preparing: AtomicBool,
    monitor_started: AtomicBool,
    monitor_running: AtomicBool,
    closed: AtomicBool,
    wake: Mutex<Option<std::sync::mpsc::SyncSender<()>>>,
    entries: Mutex<HashMap<String, StoredPreview>>,
}
#[derive(Clone, Default)]
pub(crate) struct UEBuildPreviewState {
    inner: Arc<Registry>,
}
/// One managed guard for the whole registry, never one monitor per preview/window.
/// setup: let state = UEBuildPreviewState::default();
/// let monitor = state.start_monitor()?; app.manage(state); app.manage(monitor);
/// At native shutdown call monitor.shutdown() before runtime teardown. Drop is
/// the same fail-closed fallback. A controlled async closer may await wait_closed().
/// This consumes one existing Tauri blocking-runtime worker, starts no process,
/// and must not be replaced with a renderer timer or aborted blocking task.
pub(crate) struct UEBuildPreviewMonitor {
    inner: Arc<Registry>,
    worker: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}
impl UEBuildPreviewState {
    pub(crate) fn ensure_lifecycle_monitor(&self)->Result<(),String>{ensure_monitor(&self.inner)}
    pub(crate) fn start_monitor(&self) -> Result<UEBuildPreviewMonitor, String> {
        if self.inner.closed.load(Ordering::Acquire) {
            return Err("ue_preview_monitor_closed".into());
        }
        self.inner.monitor_started.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "ue_preview_monitor_already_started".to_string())?;
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        match self.inner.wake.lock() {
            Ok(mut wake) => {
                if self.inner.closed.load(Ordering::Acquire) { return Err("ue_preview_monitor_closed".into()); }
                *wake = Some(sender);
            }
            Err(error) => { drop(error.into_inner()); close_registry(&self.inner); return Err("ue_preview_monitor_unavailable".into()); }
        }
        let inner = self.inner.clone();
        let worker = tauri::async_runtime::spawn_blocking(move || monitor_registry(inner, receiver));
        Ok(UEBuildPreviewMonitor { inner: self.inner.clone(), worker: Mutex::new(Some(worker)) })
    }
}
impl UEBuildPreviewMonitor {
    pub(crate) fn shutdown(&self) { close_registry(&self.inner); }
    /// Optional native lifecycle acknowledgement; no IPC calls this method.
    #[allow(dead_code)]
    pub(crate) async fn wait_closed(&self) -> Result<(), String> {
        self.shutdown();
        let worker = self.worker.lock().unwrap_or_else(|error| error.into_inner()).take();
        if let Some(worker) = worker {
            worker.await.map_err(|_| "ue_preview_monitor_worker_unavailable".to_string())?;
        }
        Ok(())
    }
}
impl Drop for UEBuildPreviewMonitor {
    fn drop(&mut self) { self.shutdown(); }
}
fn close_registry(registry: &Registry) {
    // Admission closes before clearing, including a preparation already hashing.
    // The final insertion gate checks closed while holding the entries lock.
    registry.closed.store(true, Ordering::Release);
    registry.monitor_running.store(false, Ordering::Release);
    crate::ue_pickup_launch_commands::shutdown();
    crate::ue_semantic_launch_commands::shutdown();
                crate::ue_scene_commands::shutdown();
    let retired = {
        let mut entries = registry.entries.lock().unwrap_or_else(|error| error.into_inner());
        std::mem::take(&mut *entries)
    };
    // Dropping the only sender wakes recv_timeout immediately, even without UI.
    registry.wake.lock().unwrap_or_else(|error| error.into_inner()).take();
    // Releasing the last root Arc can close native handles. Do that without
    // holding either registry lock, including shutdown and unwind cleanup.
    drop(retired);
}
fn notify_monitor(registry: &Registry) {
    if let Ok(wake) = registry.wake.lock() {
        if let Some(sender) = wake.as_ref() { let _ = sender.try_send(()); }
    }
}
fn ensure_monitor(registry: &Registry) -> Result<(), String> {
    if registry.closed.load(Ordering::Acquire) || !registry.monitor_running.load(Ordering::Acquire) {
        return Err("ue_preview_monitor_unavailable".into());
    }
    Ok(())
}
struct MonitorLifetime(Arc<Registry>);
impl Drop for MonitorLifetime {
    fn drop(&mut self) { close_registry(&self.0); }
}
fn monitor_registry(registry: Arc<Registry>, receiver: std::sync::mpsc::Receiver<()>) {
    let _lifetime = MonitorLifetime(registry.clone());
    if registry.closed.load(Ordering::Acquire) { return; }
    registry.monitor_running.store(true, Ordering::Release);
    loop {
        if registry.closed.load(Ordering::Acquire) { return; }
        crate::ue_pickup_launch_commands::reap_stale();
        crate::ue_semantic_launch_commands::reap_stale();
        crate::ue_scene_commands::reap_stale();
        let (delay, retired) = {
            let mut entries = match registry.entries.lock() {
                Ok(entries) => entries,
                Err(error) => { drop(error.into_inner()); return; }
            };
            let now = Instant::now();
            // Locked checks are only time and the original lease's atomic bit.
            // Re-trust permanently revokes that old lease; no path/drive/file
            // identity lookup, renewed lease or root-registry lookup runs here.
            let keys: Vec<_> = entries.iter()
                .filter(|(_, entry)| entry.expires <= now || entry.root.is_revoked() || !entry.document.is_current())
                .map(|(id, _)| id.clone()).collect();
            let retired: Vec<_> = keys.into_iter().filter_map(|id| entries.remove(&id)).collect();
            let delay = entries.values().map(|entry| entry.expires.saturating_duration_since(now))
                .min().unwrap_or(REVOCATION_POLL).min(REVOCATION_POLL);
            (delay, retired)
        };
        // Native-handle destruction is also outside the entries critical section.
        drop(retired);
        // Bounded one-slot notifications prevent lost earlier-expiry wakeups
        // and request-driven allocation. Quiet registries still reap on time.
        match receiver.recv_timeout(delay) {
            Ok(()) | Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
        }
    }
}
struct PreparationPermit(Arc<Registry>);
impl PreparationPermit {
    fn acquire(registry: &Arc<Registry>) -> Result<Self, String> {
        ensure_monitor(registry)?;
        registry.preparing.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "ue_preview_busy".to_string())?;
        let permit = Self(registry.clone());
        ensure_monitor(registry)?;
        Ok(permit)
    }
}
impl Drop for PreparationPermit {
    fn drop(&mut self) {
        self.0.preparing.store(false, Ordering::Release);
    }
}
fn valid_project_id(id: &str) -> bool {
    id.strip_prefix("root:").is_some_and(|s| !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_hexdigit()))
}
fn valid_prepared_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit())
}
fn safe_text(value: &str, limit: usize) -> bool {
    !value.is_empty() && value.len() <= limit && !value.chars().any(char::is_control)
}
fn profile(input: &PreparePreviewInput) -> Result<UEBuildProfile, String> {
    if !valid_project_id(&input.project_id) {
        return Err("ue_preview_trusted_project_required".into());
    }
    let target = &input.target;
    if target.len() > 128 || !target.ends_with("Editor") ||
        !target.bytes().enumerate().all(|(i, b)| b == b'_' || b.is_ascii_alphabetic() || i > 0 && b.is_ascii_digit()) {
        return Err("ue_preview_invalid_target".into());
    }
    let relative = input.uproject_relative_path.replace('\\', "/");
    if !safe_text(&relative, 2048) || !relative.ends_with(".uproject") ||
        relative.split('/').any(|p| p.is_empty() || p == "." || p == "..") ||
        relative.chars().any(|c| ":\"%!&|<>^*?~".contains(c)) {
        return Err("ue_preview_invalid_uproject".into());
    }
    let engine = input.engine_root.replace('/', "\\");
    let bytes = engine.as_bytes();
    if !safe_text(&engine, 4096) || bytes.len() < 4 || !bytes[0].is_ascii_alphabetic() ||
        bytes[1] != b':' || bytes[2] != b'\\' ||
        engine[3..].split('\\').any(|p| p.is_empty() || p == "." || p == ".." || p.ends_with([' ', '.'])) ||
        engine[3..].chars().any(|c| ":\"%!&|<>^*?~".contains(c)) {
        return Err("ue_preview_invalid_engine_root".into());
    }
    let sdk = &input.bundled_dotnet_version;
    let parts: Vec<_> = sdk.split('.').collect();
    if sdk.len() > 64 || !(2..=4).contains(&parts.len()) ||
        parts.iter().any(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit())) {
        return Err("ue_preview_invalid_dotnet_version".into());
    }
    Ok(UEBuildProfile {
        schema_version: 1,
        profile_id: PROFILE_ID.into(),
        project_id: input.project_id.clone(),
        engine_root: engine,
        uproject_relative_path: relative,
        target: target.clone(),
        platform: "Win64".into(),
        configuration: "Development".into(),
        method: "ubt".into(),
        bundled_dotnet_version: Some(sdk.clone()),
        timeout_ms: FIXED_TIMEOUT_MS,
    })
}
fn target_relative(profile: &UEBuildProfile) -> String {
    let parent = profile.uproject_relative_path.rsplit_once('/').map(|(parent, _)| format!("{parent}/")).unwrap_or_default();
    format!("{parent}Source/{}.Target.cs", profile.target)
}
fn current_root(project_id: &str, held: &Arc<TrustedRootHandle>) -> Result<(), String> {
    held.check_current().map_err(|_| "ue_preview_root_changed".to_string())?;
    let current = crate::resolve_trusted_root_handle_by_id(project_id)
        .map_err(|_| "ue_preview_trusted_project_required".to_string())?;
    // A re-trust of even the same OS object is a new host lease, not a renewal.
    if !Arc::ptr_eq(held, &current) {
        return Err("ue_preview_root_changed".into());
    }
    Ok(())
}
fn check_source(file: &BoundReadFile) -> Result<(), String> {
    file.check_current().map_err(|_| "ue_preview_source_changed_or_busy".into())
}
fn check_engine_path(path: &Path) -> Result<(), String> {
    use std::os::windows::fs::MetadataExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn GetDriveTypeW(root: *const u16) -> u32;
    }
    let drive: Vec<u16> = path.components().take(2)
        .fold(std::path::PathBuf::new(), |mut root, part| { root.push(part.as_os_str()); root })
        .as_os_str().to_string_lossy().encode_utf16().chain(Some(0)).collect();
    if unsafe { GetDriveTypeW(drive.as_ptr()) } != 3 {
        return Err("ue_preview_engine_path_unsupported".into());
    }
    let mut current = std::path::PathBuf::new();
    for component in path.components() {
        current.push(component.as_os_str());
        if matches!(component, Component::Prefix(_)) { continue; }
        let metadata = std::fs::symlink_metadata(&current)
            .map_err(|_| "ue_preview_engine_unavailable".to_string())?;
        // Reject reparse/offline/recall roots. This is a conservative read check,
        // not a host-owned engine execution lease or an atomic namespace guarantee.
        if !metadata.is_dir() || metadata.file_attributes() & (0x400 | 0x1000 | 0x40000 | 0x400000) != 0 {
            return Err("ue_preview_engine_path_unsupported".into());
        }
    }
    Ok(())
}
fn new_id() -> Result<String, String> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|_| "ue_preview_unavailable".to_string())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn prepare(registry: Arc<Registry>, input: PreparePreviewInput, _permit: PreparationPermit, document: Arc<crate::managed_run_store::NativeStoreWindowGrant>) -> Result<PreviewReceipt, String> {
    ensure_monitor(&registry)?;
    if !document.is_current() { return Err("ue_preview_document_revoked".into()); }
    let profile = profile(&input)?;
    let root = crate::resolve_trusted_root_handle_by_id(&profile.project_id)
        .map_err(|_| "ue_preview_trusted_project_required".to_string())?;
    current_root(&profile.project_id, &root)?;
    check_engine_path(Path::new(&profile.engine_root))?;
    let target_relative = target_relative(&profile);
    let reader = root.scope_from_verified_host(vec![
        ReadRule::exact_file(&profile.uproject_relative_path).map_err(|_| "ue_preview_invalid_uproject")?,
        ReadRule::exact_file(&target_relative).map_err(|_| "ue_preview_invalid_target")?,
    ]).map_err(|_| "ue_preview_source_unavailable_or_busy".to_string())?;
    let mut project_file = reader.open_file(&profile.uproject_relative_path)
        .map_err(|_| "ue_preview_source_unavailable_or_busy".to_string())?;
    let mut target_file = reader.open_file(&target_relative)
        .map_err(|_| "ue_preview_source_unavailable_or_busy".to_string())?;
    // Consume bounded bytes through the actual held read scope. Keep both file
    // and ancestor chains pinned while the existing profile hashes the paths.
    project_file.read_bounded(1_048_576).map_err(|_| "ue_preview_source_unavailable_or_too_large")?;
    target_file.read_bounded(1_048_576).map_err(|_| "ue_preview_source_unavailable_or_too_large")?;
    let prepared = prepare_ue_build(&profile, root.path_hint())?;
    current_root(&profile.project_id, &root)?;
    check_source(&project_file)?;
    check_source(&target_file)?;
    check_engine_path(Path::new(&profile.engine_root))?;
    let preview = prepared.preview().clone();
    let prepared_id = new_id()?;
    let expires = Instant::now() + PREVIEW_TTL;
    let now_ms = SystemTime::now().duration_since(UNIX_EPOCH)
        .map_err(|_| "ue_preview_clock_unavailable")?.as_millis();
    let prepared_at_ms = u64::try_from(now_ms).map_err(|_| "ue_preview_clock_unavailable")?;
    let expires_at_ms = prepared_at_ms.checked_add(PREVIEW_TTL.as_millis() as u64)
        .ok_or("ue_preview_clock_unavailable")?;
    // All path/OS identity checks finish before taking the registry mutex.
    current_root(&profile.project_id, &root)?;
    let mut entries = registry.entries.lock().map_err(|_| "ue_preview_unavailable")?;
    ensure_monitor(&registry)?;
    let now = Instant::now();
    if expires <= now { return Err("ue_preview_expired".into()); }
    // The original live root cannot be revived: native re-trust revokes its
    // atomic bit. This in-lock generation/revocation gate performs no I/O.
    if root.is_revoked() || !document.is_current() { return Err("ue_preview_root_changed".into()); }
    let other_live = entries.values().filter(|entry|
        entry.expires > now && !entry.root.is_revoked() && entry.project_id != profile.project_id).count();
    if other_live >= MAX_PREVIEWS || entries.contains_key(&prepared_id) {
        return Err("ue_preview_capacity".into());
    }
    let keys: Vec<_> = entries.iter().filter(|(_, entry)|
        entry.expires <= now || entry.root.is_revoked() || entry.project_id == profile.project_id)
        .map(|(id, _)| id.clone()).collect();
    let retired: Vec<_> = keys.into_iter().filter_map(|id| entries.remove(&id)).collect();
    entries.insert(prepared_id.clone(), StoredPreview {
        project_id: profile.project_id.clone(),
        expires,
        root,
        _prepared: prepared,
        document,
    });
    drop(entries);
    drop(retired);
    notify_monitor(&registry);
    Ok(PreviewReceipt {
        schema_version: 1,
        prepared_id,
        project_id: profile.project_id,
        prepared_at_ms,
        expires_at_ms,
        status: "preview_only",
        execution_enabled: false,
        verification: "not_started",
        preview,
    })
}

/// Only metadata preparation runs on the blocking pool. The atomic permit rejects
/// concurrent requests before queuing a second worker; it is not a build-resource grant.
#[tauri::command]
pub(crate) async fn prepare_ue_build_preview(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, crate::managed_run_store::ManagedRunStoreState>,
    state: tauri::State<'_, UEBuildPreviewState>,
    input: PreparePreviewInput,
) -> Result<PreviewReceipt, String> {
    profile(&input)?;
    let document=store.capture_window_grant(&window).map_err(|_|"ue_preview_document_required")?;
    let inner = state.inner.clone();
    let permit = PreparationPermit::acquire(&inner)?;
    tauri::async_runtime::spawn_blocking(move || prepare(inner, input, permit, document))
        .await.map_err(|_| "ue_preview_worker_unavailable".to_string())?
}
#[tauri::command]
pub(crate) fn release_ue_build_preview(
    window: tauri::WebviewWindow,
    store: tauri::State<'_, crate::managed_run_store::ManagedRunStoreState>,
    state: tauri::State<'_, UEBuildPreviewState>,
    input: ReleasePreviewInput,
) -> Result<ReleaseReceipt, String> {
    if !valid_project_id(&input.project_id) || !valid_prepared_id(&input.prepared_id) {
        return Err("ue_preview_invalid_input".into());
    }
    let document=store.capture_window_grant(&window).map_err(|_|"ue_preview_document_required")?;
    let mut entries = state.inner.entries.lock().map_err(|_| "ue_preview_unavailable")?;
    let now = Instant::now();
    let matches = entries.get(&input.prepared_id).is_some_and(|item|
        item.expires > now && item.project_id == input.project_id && item.document.same_document(&document));
    let keys: Vec<_> = entries.iter().filter(|(id, entry)|
        entry.expires <= now || matches && id.as_str() == input.prepared_id.as_str())
        .map(|(id, _)| id.clone()).collect();
    let retired: Vec<_> = keys.into_iter().filter_map(|id| entries.remove(&id)).collect();
    drop(entries);
    drop(retired);
    notify_monitor(&state.inner);
    Ok(ReleaseReceipt { released: matches })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn input() -> PreparePreviewInput {
        PreparePreviewInput {
            project_id: "root:a123".into(), engine_root: "G:/UE_5.8".into(),
            uproject_relative_path: "Nested/Game.uproject".into(), target: "GameEditor".into(),
            bundled_dotnet_version: "10.0.100".into(),
        }
    }
    #[test]
    fn request_cannot_supply_root_identity_or_execution_fields() {
        let mut value = serde_json::json!({"projectId":"root:a123","engineRoot":"G:/UE_5.8",
            "uprojectRelativePath":"Game.uproject","target":"GameEditor","bundledDotnetVersion":"10.0"});
        for (name, extra) in [("rootRef", serde_json::json!("G:/Other")), ("rootIdentity", serde_json::json!({})),
            ("execute", serde_json::json!(true)), ("arguments", serde_json::json!(["-Clean"]))] {
            value[name] = extra;
            assert!(serde_json::from_value::<PreparePreviewInput>(value.clone()).is_err());
            value.as_object_mut().unwrap().remove(name);
        }
    }
    #[test]
    fn profile_is_fixed_and_nested_target_stays_beside_uproject() {
        let p = profile(&input()).unwrap();
        assert_eq!((p.platform.as_str(), p.configuration.as_str(), p.method.as_str()), ("Win64", "Development", "ubt"));
        assert_eq!(p.timeout_ms, FIXED_TIMEOUT_MS);
        assert_eq!(target_relative(&p), "Nested/Source/GameEditor.Target.cs");
    }
    #[test]
    fn rejects_non_editor_target_traversal_and_unc_engine() {
        let mut i = input(); i.target = "Game".into(); assert!(profile(&i).is_err());
        i = input(); i.uproject_relative_path = "../Game.uproject".into(); assert!(profile(&i).is_err());
        i = input(); i.engine_root = "\\\\server\\engine".into(); assert!(profile(&i).is_err());
        i = input(); i.engine_root = "G:/Engine/../Other".into(); assert!(profile(&i).is_err());
    }
    #[test]
    fn preparation_permit_requires_monitor_and_rejects_concurrency() {
        let registry = Arc::new(Registry::default());
        assert!(PreparationPermit::acquire(&registry).is_err());
        // Pure admission-state unit test; this creates no root/preview/worker.
        registry.monitor_running.store(true, Ordering::Release);
        let first = PreparationPermit::acquire(&registry).unwrap();
        assert!(PreparationPermit::acquire(&registry).is_err());
        drop(first);
        assert!(PreparationPermit::acquire(&registry).is_ok());
        close_registry(&registry);
        assert!(PreparationPermit::acquire(&registry).is_err());
    }
    #[test]
    fn native_shutdown_is_idempotent_and_closes_admission() {
        let registry = Arc::new(Registry::default());
        registry.monitor_running.store(true, Ordering::Release);
        let monitor = UEBuildPreviewMonitor { inner: registry.clone(), worker: Mutex::new(None) };
        monitor.shutdown(); monitor.shutdown();
        assert!(registry.closed.load(Ordering::Acquire));
        assert!(!registry.monitor_running.load(Ordering::Acquire));
        assert!(PreparationPermit::acquire(&registry).is_err());
    }
}

/// Native-only move: consuming a preview burns its ID even when approval is declined.
/// No renderer JSON can reconstruct the private executable plan.
pub(crate) fn take_for_build(state:&UEBuildPreviewState,project:&str,id:&str,fingerprint:&str,
    document:&Arc<crate::managed_run_store::NativeStoreWindowGrant>,
)->Result<(Arc<TrustedRootHandle>,PreparedUEBuild,Instant),String>{
    if !valid_project_id(project)||!valid_prepared_id(id){return Err("ue_build_invalid_request".into());}
    let mut entries=state.inner.entries.lock().map_err(|_|"ue_preview_unavailable")?;
    let entry=entries.get(id).ok_or("ue_preview_expired")?;
    if entry.project_id!=project||!entry.document.same_document(document)||!document.is_current(){return Err("ue_build_document_mismatch".into());}
    let entry=entries.remove(id).ok_or("ue_preview_expired")?;drop(entries);
    if entry.expires<=Instant::now()||entry.root.is_revoked()||entry._prepared.preview().fingerprint!=fingerprint{
        return Err("ue_build_preview_changed".into());
    }
    current_root(project,&entry.root)?;
    Ok((entry.root,entry._prepared,entry.expires))
}
