//! Window-owned Responses IPC. Credentials/grants live only in this process.
//! Saved runs/configuration are data: every dispatch still needs a fresh profile,
//! a native lease and a single exact-body approval. No command accepts a URL.
#![cfg(windows)]
use crate::native_provider_transport::{
    ApprovalGrant, Clock, ConfigVersion, DispatchStatus, Lease, MonotonicClock, NativeSession,
    Owner, PreparedRequest, Transport,
};
use crate::native_responses_fixture::{FixtureResponsesTransport, FixtureSequence};
use crate::native_responses_http::WinHttpResponsesTransport;
use crate::native_responses_sources::NativeSourceMonitor;
use crate::product_settings_store::{AuthMode, ProductSettingsStore, ProviderSnapshot, WireApi};
use crate::provider_continuation_store::{
    ContinuationOwner, ContinuationScope, ProviderContinuationStore, ProviderNativeContinuation,
};
use crate::provider_endpoint_policy::{prepare_responses_endpoint, NATIVE_ENDPOINT_POLICY};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
};
type Result<T> = std::result::Result<T, String>;
const MAX_PROFILES: usize = 4;
const MAX_RUNS: usize = 16;
const MAX_REQUESTS: usize = 8;
const MAX_BUFFER: usize = 4_194_304;
const MAX_CHUNKS: usize = 4096;
const PROFILE_TTL: u64 = 3_600_000;
fn failure(code: &str) -> String {
    code.into()
}
fn lock<T>(value: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>> {
    value
        .lock()
        .map_err(|_| failure("native_responses_unavailable"))
}
fn token() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|_| failure("native_responses_unavailable"))?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn request_deadline(now: u64, run_deadline: u64, profile_deadline: u64) -> Result<u64> {
    let deadline = now
        .checked_add(600_000)
        .ok_or_else(|| failure("native_scope_invalid"))?
        .min(run_deadline)
        .min(profile_deadline);
    if deadline <= now {
        return Err(failure("native_scope_expired"));
    }
    Ok(deadline)
}
fn epoch() -> Result<u64> {
    let mut bytes = [0u8; 8];
    getrandom::getrandom(&mut bytes).map_err(|_| failure("native_responses_unavailable"))?;
    Ok(u64::from_le_bytes(bytes) & 0x1f_ffff_ffff_ffff)
}
struct Secret(Vec<u8>);
impl Drop for Secret {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}
struct Profile {
    id: String,
    window: String,
    window_generation: u64,
    root: PathBuf,
    snapshot: ProviderSnapshot,
    model_id: String,
    endpoint: String,
    fixture_root: Option<PathBuf>,
    key: Secret,
    clock: Arc<MonotonicClock>,
    expires_at: u64,
    alive: AtomicBool,
}
struct Run {
    profile: Arc<Profile>,
    scope: ContinuationScope,
    session: NativeSession,
    monitor: NativeSourceMonitor,
    deadline: u64,
    fixture_sequence: Option<Arc<FixtureSequence>>,
    alive: AtomicBool,
}
impl Run {
    fn current(&self) -> Result<()> {
        if !self.alive.load(Ordering::Acquire)
            || !self.profile.alive.load(Ordering::Acquire)
            || self.profile.clock.now_ms() >= self.profile.expires_at
            || self.profile.clock.now_ms() >= self.deadline
        {
            return Err(failure("native_responses_session_closed"));
        }
        if lock(broker())?
            .updating
            .contains(&self.scope.owner.provider_id)
        {
            return Err(failure("native_responses_configuration_changed"));
        }
        let saved = provider(
            &self.profile.root,
            &self.scope.owner.provider_id,
            &self.scope.owner.model_id,
        )?;
        if saved.generation != self.scope.provider_generation
            || saved.revision != self.scope.provider_revision
            || fingerprint(&saved, &self.scope.owner.model_id)?
                != self.scope.configuration_fingerprint
        {
            self.revoke();
            return Err(failure("native_responses_configuration_changed"));
        }
        crate::resolve_trusted_root_binding_by_id(&self.scope.owner.project_id)
            .map_err(|_| failure("native_responses_project_changed"))?;
        Ok(())
    }
    fn revoke(&self) {
        self.alive.store(false, Ordering::Release);
        self.monitor.revoke();
        let _ = self.session.revoke_all();
        let _ = self.session.clear_credential();
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Head {
    status: u16,
    content_type: String,
}
#[derive(Default)]
struct ResponseState {
    chunks: Vec<Vec<u8>>,
    bytes: usize,
    head: Option<Head>,
    done: bool,
    error: Option<String>,
    dispatch_status: String,
}
struct Request {
    window: String,
    run: Arc<Run>,
    prepared: Arc<PreparedRequest>,
    lease: Lease,
    approval: Mutex<Option<ApprovalGrant>>,
    started: AtomicBool,
    response: Arc<Mutex<ResponseState>>,
}
#[derive(Default)]
struct Broker {
    profiles: HashMap<String, Arc<Profile>>,
    windows: HashMap<String, (u64, bool)>,
    updating: std::collections::HashSet<String>,
    runs: HashMap<String, Arc<Run>>,
    requests: HashMap<String, Arc<Request>>,
}
fn broker() -> &'static Mutex<Broker> {
    static BROKER: OnceLock<Mutex<Broker>> = OnceLock::new();
    BROKER.get_or_init(|| Mutex::new(Broker::default()))
}
fn provider(root: &Path, id: &str, model: &str) -> Result<ProviderSnapshot> {
    let snapshot = ProductSettingsStore::open(root)
        .and_then(|store| store.provider(id, &NATIVE_ENDPOINT_POLICY))
        .map_err(|_| failure("native_responses_configuration_unavailable"))?
        .ok_or_else(|| failure("native_responses_configuration_unavailable"))?;
    if !snapshot.config.enabled
        || snapshot.config.wire_api != WireApi::Responses
        || snapshot.config.auth_mode != AuthMode::EnvKey
        || !snapshot.config.models.iter().any(|entry| entry.id == model)
    {
        return Err(failure("native_responses_configuration_unavailable"));
    }
    prepare_responses_endpoint(&snapshot.config.base_url)
        .map_err(|_| failure("native_responses_endpoint_rejected"))?;
    Ok(snapshot)
}
fn fingerprint(snapshot: &ProviderSnapshot, model: &str) -> Result<String> {
    snapshot
        .models
        .iter()
        .find(|entry| entry.model_id == model)
        .map(|entry| entry.configuration_fingerprint.clone())
        .ok_or_else(|| failure("native_responses_configuration_unavailable"))
}
fn profile_owned(id: &str, window: &str) -> Result<Arc<Profile>> {
    let state = lock(broker())?;
    let found = state
        .profiles
        .get(id)
        .cloned()
        .ok_or_else(|| failure("native_responses_session_closed"))?;
    if state.windows.get(&found.window) != Some(&(found.window_generation, false))
        || found.window != window
        || !found.alive.load(Ordering::Acquire)
        || found.clock.now_ms() >= found.expires_at
    {
        return Err(failure("native_responses_session_closed"));
    }
    Ok(found)
}
fn run_owned(id: &str, window: &str) -> Result<Arc<Run>> {
    let run = lock(broker())?
        .runs
        .get(id)
        .cloned()
        .ok_or_else(|| failure("native_responses_run_unavailable"))?;
    if run.profile.window != window {
        return Err(failure("native_responses_run_unavailable"));
    }
    run.current()?;
    Ok(run)
}
fn request_owned(id: &str, window: &str) -> Result<Arc<Request>> {
    let request = lock(broker())?
        .requests
        .get(id)
        .cloned()
        .ok_or_else(|| failure("native_responses_request_unavailable"))?;
    if request.window != window {
        return Err(failure("native_responses_request_unavailable"));
    }
    Ok(request)
}
fn close_profile(id: &str, window: &str) -> Result<()> {
    let (profile, runs, requests) = {
        let mut state = lock(broker())?;
        if state.profiles.get(id).is_some_and(|p| p.window != window) {
            return Err(failure("native_responses_session_closed"));
        }
        // Publish closure while registration is excluded by this same broker lock.
        // No new run can miss the revoke set by racing the subsequent removal.
        if let Some(profile) = state.profiles.get(id) {
            profile.alive.store(false, Ordering::Release);
        }
        let profile = state.profiles.remove(id);
        let runs = state
            .runs
            .values()
            .filter(|r| r.profile.id == id)
            .cloned()
            .collect::<Vec<_>>();
        let requests = state
            .requests
            .values()
            .filter(|r| r.run.profile.id == id)
            .cloned()
            .collect::<Vec<_>>();
        state.runs.retain(|_, r| r.profile.id != id);
        state.requests.retain(|_, r| r.run.profile.id != id);
        (profile, runs, requests)
    };
    if let Some(profile) = profile {
        profile.alive.store(false, Ordering::Release);
    }
    for request in requests {
        let _ = request.prepared.cancel();
    }
    for run in runs {
        run.revoke();
    }
    Ok(())
}
fn invalidate_window(window: &str, destroyed: bool) {
    let (profiles, runs, requests) = {
        let mut state = match lock(broker()) {
            Ok(state) => state,
            Err(_) => return,
        };
        let version = state.windows.entry(window.into()).or_insert((0, false));
        version.0 = version.0.saturating_add(1);
        version.1 |= destroyed;
        // Window tombstone, generation and complete ownership removal are one
        // transaction. No opener can observe a new generation still marked live.
        let profiles = state
            .profiles
            .values()
            .filter(|p| p.window == window)
            .cloned()
            .collect::<Vec<_>>();
        for profile in &profiles {
            profile.alive.store(false, Ordering::Release);
        }
        let runs = state
            .runs
            .values()
            .filter(|r| r.profile.window == window)
            .cloned()
            .collect::<Vec<_>>();
        let requests = state
            .requests
            .values()
            .filter(|r| r.window == window)
            .cloned()
            .collect::<Vec<_>>();
        state.profiles.retain(|_, p| p.window != window);
        state.runs.retain(|_, r| r.profile.window != window);
        state.requests.retain(|_, r| r.window != window);
        (profiles, runs, requests)
    };
    for request in requests {
        let _ = request.prepared.cancel();
    }
    for run in runs {
        run.revoke();
    }
    drop(profiles);
}
pub(crate) fn revoke_window(window: &str) {
    invalidate_window(window, false);
}
pub(crate) fn register_window(window: &str) {
    invalidate_window(window, true);
    if let Ok(mut state) = lock(broker()) {
        state.windows.entry(window.into()).or_insert((0, true)).1 = false;
    }
}
pub(crate) fn destroy_window(window: &str) {
    invalidate_window(window, true);
}
fn register_profile(state: &mut Broker, profile: Arc<Profile>) -> Result<()> {
    if state.windows.get(&profile.window) != Some(&(profile.window_generation, false))
        || !profile.alive.load(Ordering::Acquire)
    {
        return Err(failure("native_responses_window_unavailable"));
    }
    if state
        .updating
        .contains(&profile.snapshot.config.provider_id)
    {
        return Err(failure("native_responses_configuration_changed"));
    }
    if state.profiles.len() >= MAX_PROFILES {
        return Err(failure("native_responses_profile_limit"));
    }
    if state.profiles.contains_key(&profile.id) {
        return Err(failure("native_responses_profile_conflict"));
    }
    state.profiles.insert(profile.id.clone(), profile);
    Ok(())
}
pub(crate) struct ProviderUpdateGuard(String);
impl Drop for ProviderUpdateGuard {
    fn drop(&mut self) {
        if let Ok(mut state) = lock(broker()) {
            state.updating.remove(&self.0);
        }
    }
}
/// Blocks new native owners for the complete settings mutation, including failure.
pub(crate) fn begin_provider_update(id: &str) -> Result<ProviderUpdateGuard> {
    {
        let mut state = lock(broker())?;
        if !state.updating.insert(id.to_string()) {
            return Err(failure("native_responses_configuration_busy"));
        }
    }
    revoke_provider(id);
    Ok(ProviderUpdateGuard(id.to_string()))
}
pub(crate) fn revoke_provider(id: &str) {
    let owned = match lock(broker()) {
        Ok(state) => state
            .profiles
            .values()
            .filter(|p| p.snapshot.config.provider_id == id)
            .map(|p| (p.id.clone(), p.window.clone()))
            .collect::<Vec<_>>(),
        Err(_) => return,
    };
    for (id, window) in owned {
        let _ = close_profile(&id, &window);
    }
}
pub(crate) fn revoke_project(id: &str) {
    let runs = match lock(broker()) {
        Ok(state) => state
            .runs
            .values()
            .filter(|r| r.scope.owner.project_id == id)
            .cloned()
            .collect::<Vec<_>>(),
        Err(_) => return,
    };
    for run in runs {
        run.revoke();
    }
}
/// The read tool calls this with its actual native prefix, before redaction.
/// It creates freshness evidence, never a new sharing permission.
pub(crate) fn observe_preview(
    project: &str,
    path: &str,
    bytes: u32,
    lines: u32,
    preview: &crate::project_source_versions::ScopedPreview,
) {
    let runs = match lock(broker()) {
        Ok(state) => state
            .runs
            .values()
            .filter(|r| r.scope.owner.project_id == project && r.alive.load(Ordering::Acquire))
            .cloned()
            .collect::<Vec<_>>(),
        Err(_) => return,
    };
    for run in runs {
        let capture = (|| -> Result<()> {
            let evidence = run
                .monitor
                .capture_preview(path, bytes, lines, preview)
                .map_err(failure)?;
            let mut selected = run.monitor.selected_sources().map_err(failure)?;
            selected.push(evidence);
            run.monitor.set_sources(&selected).map_err(failure)?;
            Ok(())
        })();
        if capture.is_err() {
            run.revoke();
        }
    }
}
async fn worker<T: Send + 'static>(work: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|_| failure("native_responses_worker_failed"))?
}
fn root(app: &tauri::AppHandle) -> Result<PathBuf> {
    Ok(crate::app_profile::resolve_app_data_dir(app)?.join("run-store-v2"))
}
macro_rules! input {
    ($name:ident { $($field:ident:$ty:ty),* $(,)? }) => {
        #[derive(Deserialize)]
        #[serde(rename_all="camelCase",deny_unknown_fields)]
        pub(crate) struct $name { $(pub $field:$ty),* }
    };
}
input!(OpenInput {
    provider_id: String,
    model_id: String,
    credential: String
});
input!(ProfileInput { profile_id: String });
input!(BindInput {
    profile_id: String,
    project_id: String,
    run_id: String,
    scope_expires_at: u64
});
input!(PrepareInput {
    run_handle: String,
    body: String
});
input!(RequestInput { request_id: String });
input!(PollInput {
    request_id: String,
    cursor: usize
});
input!(RunInput { run_handle: String });
input!(SaveInput {
    run_handle: String,
    record: ProviderNativeContinuation
});
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenResult {
    profile_id: String,
    provider_id: String,
    model_id: String,
    endpoint: String,
    expires_at: u64,
    fixture: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BindResult {
    run_handle: String,
    owner: ContinuationOwner,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrepareResult {
    request_id: String,
    endpoint: String,
    model_id: String,
    body_sha256: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PollResult {
    cursor: usize,
    next_cursor: usize,
    chunks: Vec<Vec<u8>>,
    head: Option<Head>,
    done: bool,
    error: Option<String>,
    dispatch_status: String,
}
#[tauri::command]
pub(crate) async fn open_native_responses_profile(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    input: OpenInput,
) -> Result<OpenResult> {
    let root = root(&app)?;
    // Production Responses stays unavailable until full native root identity is integrated.
    let fixture_root = crate::app_profile::responses_fixture_root()?;
    if input.credential != "offline-responses-fixture-only" {
        return Err(failure("responses_fixture_credential_required"));
    }
    window
        .inner_size()
        .map_err(|_| failure("native_responses_window_unavailable"))?;
    let window = window.label().to_string();
    let window_generation = {
        let mut state = lock(broker())?;
        let version = state.windows.entry(window.clone()).or_insert((0, false));
        if version.1 {
            return Err(failure("native_responses_window_unavailable"));
        }
        version.0
    };
    worker(move || {
        let snapshot = provider(&root, &input.provider_id, &input.model_id)?;
        let endpoint = prepare_responses_endpoint(&snapshot.config.base_url)
            .map_err(|_| failure("native_responses_endpoint_rejected"))?;
        // Validation uses the same memory-only credential contract as dispatch.
        let clock = Arc::new(MonotonicClock::new());
        let key = Secret(input.credential.into_bytes());
        let temporary = NativeSession::new(
            Owner {
                project: "setup".into(),
                epoch: 0,
                run: "setup".into(),
                conversation: "setup".into(),
                provider: input.provider_id.clone(),
                model: input.model_id.clone(),
            },
            ConfigVersion {
                generation: snapshot.generation.clone(),
                revision: snapshot.revision as u64,
            },
            [0; 32],
            clock.clone(),
        );
        temporary
            .install_credential(key.0.clone(), PROFILE_TTL)
            .map_err(|e| failure(e.code()))?;
        temporary
            .clear_credential()
            .map_err(|e| failure(e.code()))?;
        let id = token()?;
        let profile = Arc::new(Profile {
            id: id.clone(),
            window,
            window_generation,
            root,
            snapshot,
            model_id: input.model_id.clone(),
            endpoint: endpoint.clone(),
            fixture_root: Some(fixture_root),
            key,
            clock,
            expires_at: PROFILE_TTL,
            alive: AtomicBool::new(true),
        });
        let mut state = lock(broker())?;
        if state.windows.get(&profile.window) != Some(&(window_generation, false)) {
            return Err(failure("native_responses_window_unavailable"));
        }
        if state.updating.contains(&input.provider_id) {
            return Err(failure("native_responses_configuration_changed"));
        }
        if state.profiles.len() >= MAX_PROFILES {
            return Err(failure("native_responses_profile_limit"));
        }
        register_profile(&mut state, profile.clone())?;
        let expiry = Arc::downgrade(&profile);
        std::thread::Builder::new()
            .name("responses-expiry".into())
            .spawn(move || loop {
                let Some(profile) = expiry.upgrade() else {
                    return;
                };
                if !profile.alive.load(Ordering::Acquire) {
                    return;
                }
                if profile.clock.now_ms() >= profile.expires_at {
                    let _ = close_profile(&profile.id, &profile.window);
                    return;
                }
                drop(profile);
                std::thread::sleep(std::time::Duration::from_millis(500));
            })
            .map_err(|_| {
                profile.alive.store(false, Ordering::Release);
                state.profiles.remove(&id);
                failure("native_responses_worker_failed")
            })?;
        let wall = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| failure("native_responses_unavailable"))?
            .as_millis() as u64;
        Ok(OpenResult {
            profile_id: id,
            provider_id: input.provider_id,
            model_id: input.model_id,
            endpoint,
            expires_at: wall + PROFILE_TTL,
            fixture: true,
        })
    })
    .await
}
#[tauri::command]
pub(crate) async fn close_native_responses_profile(
    window: tauri::WebviewWindow,
    input: ProfileInput,
) -> Result<()> {
    close_profile(&input.profile_id, window.label())
}
#[tauri::command]
pub(crate) async fn bind_native_responses_run(
    window: tauri::WebviewWindow,
    input: BindInput,
) -> Result<BindResult> {
    let window = window.label().to_string();
    worker(move || {
        let profile = profile_owned(&input.profile_id, &window)?;
        let existing = {
            let state = lock(broker())?;
            state
                .runs
                .iter()
                .find(|(_, run)| {
                    Arc::ptr_eq(&run.profile, &profile)
                        && run.scope.owner.project_id == input.project_id
                        && run.scope.owner.run_id == input.run_id
                })
                .map(|(id, run)| (id.clone(), run.clone()))
        };
        if let Some((id, run)) = existing {
            run.current()?;
            return Ok(BindResult {
                run_handle: id,
                owner: run.scope.owner.clone(),
            });
        }
        let binding = crate::resolve_trusted_root_binding_by_id(&input.project_id)
            .map_err(|_| failure("native_responses_project_changed"))?;
        if let Some(fixture) = &profile.fixture_root {
            if std::fs::canonicalize(fixture).ok().as_ref() != Some(&binding.canonical_root) {
                return Err(failure("responses_fixture_project_required"));
            }
        }
        let store = crate::local_run_store::RunStore::open(&profile.root)
            .map_err(|_| failure("native_responses_run_unavailable"))?;
        let snapshot = store
            .snapshot(&input.project_id, &input.run_id)
            .map_err(|_| failure("native_responses_run_unavailable"))?;
        let project = store
            .projects()
            .map_err(|_| failure("native_responses_project_changed"))?
            .into_iter()
            .find(|p| p.id == input.project_id)
            .ok_or_else(|| failure("native_responses_project_changed"))?;
        if std::fs::canonicalize(&project.root).ok().as_ref() != Some(&binding.canonical_root)
            || snapshot.has_unknown_external_effects
        {
            return Err(failure("native_responses_run_unavailable"));
        }
        let batch = store
            .checkpoint_batch(&input.project_id, &input.run_id, snapshot.run.revision)
            .map_err(|_| failure("native_responses_run_unavailable"))?
            .ok_or_else(|| failure("native_responses_run_unavailable"))?;
        let state = batch
            .events
            .iter()
            .rev()
            .find(|e| e.kind == "coordinator_state_v1")
            .map(|e| &e.data)
            .ok_or_else(|| failure("native_responses_run_unavailable"))?;
        if state.get("runId").and_then(|v| v.as_str()) != Some(&input.run_id)
            || state.get("projectId").and_then(|v| v.as_str()) != Some(&input.project_id)
            || state.get("conversationId").and_then(|v| v.as_str())
                != Some(&snapshot.run.session_id)
            || state
                .pointer("/scopeDescription/providerId")
                .and_then(|v| v.as_str())
                != Some(&profile.snapshot.config.provider_id)
            || state
                .pointer("/scopeDescription/modelId")
                .and_then(|v| v.as_str())
                != Some(&profile.model_id)
        {
            return Err(failure("native_responses_run_identity"));
        }
        let monotonic_before = profile.clock.now_ms();
        let wall = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| failure("native_responses_unavailable"))?
            .as_millis() as u64;
        let duration = state
            .pointer("/limits/maxDurationMs")
            .and_then(|v| v.as_u64())
            .filter(|v| *v > 0 && *v <= PROFILE_TTL)
            .ok_or_else(|| failure("native_scope_invalid"))?;
        let created =
            u64::try_from(snapshot.run.created_at).map_err(|_| failure("native_scope_invalid"))?;
        let wall_deadline = created
            .checked_add(duration)
            .ok_or_else(|| failure("native_scope_invalid"))?
            .min(input.scope_expires_at);
        let remaining = wall_deadline
            .checked_sub(wall)
            .filter(|v| *v > 0 && *v <= PROFILE_TTL)
            .ok_or_else(|| failure("native_scope_expired"))?;
        let deadline = monotonic_before
            .checked_add(remaining)
            .ok_or_else(|| failure("native_scope_invalid"))?
            .min(profile.expires_at);
        let owner = ContinuationOwner {
            project_id: input.project_id,
            project_epoch: epoch()?,
            run_id: input.run_id,
            conversation_id: snapshot.run.session_id,
            provider_id: profile.snapshot.config.provider_id.clone(),
            model_id: profile.model_id.clone(),
        };
        let scope = ContinuationScope {
            owner: owner.clone(),
            provider_generation: profile.snapshot.generation.clone(),
            provider_revision: profile.snapshot.revision,
            configuration_fingerprint: fingerprint(&profile.snapshot, &profile.model_id)?,
        };
        let session = NativeSession::new(
            Owner {
                project: owner.project_id.clone(),
                epoch: owner.project_epoch,
                run: owner.run_id.clone(),
                conversation: owner.conversation_id.clone(),
                provider: owner.provider_id.clone(),
                model: owner.model_id.clone(),
            },
            ConfigVersion {
                generation: scope.provider_generation.clone(),
                revision: scope.provider_revision as u64,
            },
            [0; 32],
            profile.clock.clone(),
        );
        session
            .install_credential(profile.key.0.clone(), profile.expires_at)
            .map_err(|e| failure(e.code()))?;
        let monitor = NativeSourceMonitor::start(&owner.project_id, session.source_authority())
            .map_err(failure)?;
        let evidence = monitor.capture_index().map_err(failure)?;
        monitor.set_sources(&[evidence]).map_err(failure)?;
        let run = Arc::new(Run {
            profile: profile.clone(),
            scope,
            session,
            monitor,
            deadline,
            fixture_sequence: profile
                .fixture_root
                .as_ref()
                .map(|_| Arc::new(FixtureSequence::new())),
            alive: AtomicBool::new(true),
        });
        run.current()?;
        let id = token()?;
        let mut broker = lock(broker())?;
        if broker.runs.len() >= MAX_RUNS {
            return Err(failure("native_responses_run_limit"));
        }
        if !profile.alive.load(Ordering::Acquire)
            || broker.updating.contains(&owner.provider_id)
            || !broker
                .profiles
                .get(&profile.id)
                .is_some_and(|saved| Arc::ptr_eq(saved, &profile))
        {
            run.revoke();
            return Err(failure("native_responses_session_closed"));
        }
        if let Some((id, previous)) = broker.runs.iter().find(|(_, previous)| {
            Arc::ptr_eq(&previous.profile, &profile)
                && previous.scope.owner.project_id == owner.project_id
                && previous.scope.owner.run_id == owner.run_id
        }) {
            let result = BindResult {
                run_handle: id.clone(),
                owner: previous.scope.owner.clone(),
            };
            run.revoke();
            return Ok(result);
        }
        broker.runs.insert(id.clone(), run);
        Ok(BindResult {
            run_handle: id,
            owner,
        })
    })
    .await
}
#[tauri::command]
pub(crate) async fn prepare_native_responses_request(
    window: tauri::WebviewWindow,
    input: PrepareInput,
) -> Result<PrepareResult> {
    let window = window.label().to_string();
    worker(move || {
        let run = run_owned(&input.run_handle, &window)?;
        {
            let broker = lock(broker())?;
            if broker.requests.len() >= MAX_REQUESTS
                || broker.requests.values().any(|r| {
                    Arc::ptr_eq(&r.run, &run) && !lock(&r.response).map(|s| s.done).unwrap_or(false)
                })
            {
                return Err(failure("native_responses_request_busy"));
            }
        }
        let sources = run.monitor.selected_sources().map_err(failure)?;
        run.monitor.set_sources(&sources).map_err(failure)?;
        let expires = request_deadline(
            run.profile.clock.now_ms(),
            run.deadline,
            run.profile.expires_at,
        )?;
        let lease = run
            .session
            .capture_lease(expires)
            .map_err(|e| failure(e.code()))?;
        let prepared = run
            .session
            .prepare(
                &lease,
                &run.profile.snapshot.config.base_url,
                input.body.into_bytes(),
                run.monitor.checker().as_ref(),
            )
            .map_err(|e| failure(e.code()))?;
        run.current()?;
        let binding = prepared.binding();
        let id = token()?;
        let result = PrepareResult {
            request_id: id.clone(),
            endpoint: binding.endpoint.clone(),
            model_id: binding.model.clone(),
            body_sha256: binding
                .body_sha256
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect(),
        };
        let request = Arc::new(Request {
            window,
            run,
            prepared: Arc::new(prepared),
            lease,
            approval: Mutex::new(None),
            started: AtomicBool::new(false),
            response: Arc::new(Mutex::new(ResponseState {
                dispatch_status: "notDispatched".into(),
                ..Default::default()
            })),
        });
        let mut broker = lock(broker())?;
        if broker.requests.len() >= MAX_REQUESTS
            || !broker
                .runs
                .get(&input.run_handle)
                .is_some_and(|saved| Arc::ptr_eq(saved, &request.run))
            || !broker
                .profiles
                .get(&request.run.profile.id)
                .is_some_and(|saved| Arc::ptr_eq(saved, &request.run.profile))
            || !request.run.profile.alive.load(Ordering::Acquire)
            || !request.run.alive.load(Ordering::Acquire)
            || broker
                .updating
                .contains(&request.run.scope.owner.provider_id)
        {
            let _ = request.lease.revoke();
            return Err(failure("native_responses_session_closed"));
        }
        broker.requests.insert(id, request);
        Ok(result)
    })
    .await
}
#[tauri::command]
pub(crate) async fn approve_native_responses_request(
    window: tauri::WebviewWindow,
    input: RequestInput,
) -> Result<()> {
    let window = window.label().to_string();
    worker(move || {
        let request = request_owned(&input.request_id, &window)?;
        request.run.current()?;
        let mut approval = lock(&request.approval)?;
        if approval.is_some() || request.started.load(Ordering::Acquire) {
            return Err(failure("native_approval_consumed"));
        }
        *approval = Some(
            request
                .run
                .session
                .approve(
                    &request.prepared,
                    &request.lease,
                    request.run.monitor.checker().as_ref(),
                )
                .map_err(|e| failure(e.code()))?,
        );
        Ok(())
    })
    .await
}
#[tauri::command]
pub(crate) async fn dispatch_native_responses_request(
    window: tauri::WebviewWindow,
    input: RequestInput,
) -> Result<()> {
    let request = request_owned(&input.request_id, window.label())?;
    request.run.current()?;
    if request.started.swap(true, Ordering::AcqRel) {
        return Err(failure("native_approval_consumed"));
    }
    let grant = lock(&request.approval)?
        .take()
        .ok_or_else(|| failure("native_approval_required"))?;
    // This acknowledgement schedules the worker. It does not claim a request was sent.
    std::thread::Builder::new()
        .name("responses-transport".into())
        .spawn(move || {
            let output = request.response.clone();
            let output_head = output.clone();
            let output_chunk = output.clone();
            let chunk_sink: Arc<dyn Fn(&[u8]) -> std::result::Result<(), ()> + Send + Sync> =
                Arc::new(move |bytes| {
                    let mut state = output_chunk.lock().map_err(|_| ())?;
                    if bytes.len() > 65_536
                        || state.chunks.len() >= MAX_CHUNKS
                        || state
                            .bytes
                            .checked_add(bytes.len())
                            .map_or(true, |size| size > MAX_BUFFER)
                    {
                        return Err(());
                    }
                    state.bytes += bytes.len();
                    state.chunks.push(bytes.to_vec());
                    Ok(())
                });
            let head_sink: Arc<dyn Fn(u16, &str) -> std::result::Result<(), ()> + Send + Sync> =
                Arc::new(move |status, content_type| {
                    let mut state = output_head.lock().map_err(|_| ())?;
                    if state.head.is_some() {
                        return Err(());
                    }
                    state.dispatch_status = "mayHaveBeenSent".into();
                    state.head = Some(Head {
                        status,
                        content_type: content_type.to_string(),
                    });
                    Ok(())
                });
            let mut transport: Box<dyn Transport> =
                if let Some(sequence) = &request.run.fixture_sequence {
                    Box::new(
                        FixtureResponsesTransport::with_chunk_sink(chunk_sink)
                            .with_head_sink(head_sink)
                            .with_sequence(sequence.clone()),
                    )
                } else {
                    Box::new(
                        WinHttpResponsesTransport::with_chunk_sink(chunk_sink)
                            .with_head_sink(head_sink),
                    )
                };
            let outcome = request.run.session.dispatch(
                &request.prepared,
                &request.lease,
                &grant,
                request.run.monitor.checker().as_ref(),
                transport.as_mut(),
            );
            if let Ok(mut state) = output.lock() {
                state.dispatch_status = match outcome.status {
                    DispatchStatus::NotDispatched => "notDispatched",
                    DispatchStatus::MayHaveBeenSent => "mayHaveBeenSent",
                    DispatchStatus::Sent => "sent",
                }
                .into();
                state.error = outcome.error.map(|code| code.code().to_string());
                if state.error.is_some() {
                    state.chunks.clear();
                    state.bytes = 0;
                }
                state.done = true;
            };
        })
        .map_err(|_| failure("native_responses_worker_failed"))?;
    Ok(())
}
#[tauri::command]
pub(crate) async fn poll_native_responses_request(
    window: tauri::WebviewWindow,
    input: PollInput,
) -> Result<PollResult> {
    let request = request_owned(&input.request_id, window.label())?;
    let invalid = request.run.current().err().or_else(|| {
        if request.lease.is_current() {
            None
        } else {
            Some(failure("native_lease_invalid"))
        }
    });
    if let Some(error) = invalid {
        let _ = request.prepared.cancel();
        let status = match request.prepared.status() {
            DispatchStatus::NotDispatched => "notDispatched",
            DispatchStatus::MayHaveBeenSent => "mayHaveBeenSent",
            DispatchStatus::Sent => "sent",
        };
        return Ok(PollResult {
            cursor: input.cursor,
            next_cursor: input.cursor,
            chunks: vec![],
            head: None,
            done: true,
            error: Some(error),
            dispatch_status: status.into(),
        });
    }
    let state = lock(&request.response)?;
    if state.done && state.error.is_some() {
        return Ok(PollResult {
            cursor: input.cursor,
            next_cursor: input.cursor,
            chunks: vec![],
            head: state.head.clone(),
            done: true,
            error: state.error.clone(),
            dispatch_status: state.dispatch_status.clone(),
        });
    }
    if input.cursor > state.chunks.len() {
        return Err(failure("native_responses_cursor_invalid"));
    }
    // A poll has its own bounded IPC payload; a terminal error is returned even
    // when earlier chunks were already delivered. No failed reply becomes success.
    let mut end = input.cursor;
    let mut bytes = 0usize;
    while end < state.chunks.len() && bytes + state.chunks[end].len() <= 262_144 {
        bytes += state.chunks[end].len();
        end += 1;
    }
    Ok(PollResult {
        cursor: input.cursor,
        next_cursor: end,
        chunks: state.chunks[input.cursor..end].to_vec(),
        head: state.head.clone(),
        done: state.done && end == state.chunks.len(),
        error: state.error.clone(),
        dispatch_status: match request.prepared.status() {
            DispatchStatus::NotDispatched => "notDispatched",
            DispatchStatus::MayHaveBeenSent => "mayHaveBeenSent",
            DispatchStatus::Sent => "sent",
        }
        .into(),
    })
}
#[tauri::command]
pub(crate) async fn cancel_native_responses_request(
    window: tauri::WebviewWindow,
    input: RequestInput,
) -> Result<()> {
    let request = request_owned(&input.request_id, window.label())?;
    request.prepared.cancel().map_err(|e| failure(e.code()))?;
    Ok(())
}
#[tauri::command]
pub(crate) async fn release_native_responses_request(
    window: tauri::WebviewWindow,
    input: RequestInput,
) -> Result<()> {
    let request = request_owned(&input.request_id, window.label())?;
    request.prepared.cancel().map_err(|e| failure(e.code()))?;
    lock(broker())?.requests.remove(&input.request_id);
    Ok(())
}
#[tauri::command]
pub(crate) async fn load_native_provider_continuations(
    window: tauri::WebviewWindow,
    input: RunInput,
) -> Result<Vec<ProviderNativeContinuation>> {
    let window = window.label().to_string();
    worker(move || {
        let run = run_owned(&input.run_handle, &window)?;
        let result = ProviderContinuationStore::open(&run.profile.root)
            .and_then(|store| store.load(&run.scope, &NATIVE_ENDPOINT_POLICY))
            .map_err(|_| failure("native_responses_continuation_load_failed"))?;
        run.current()?;
        Ok(result)
    })
    .await
}
#[tauri::command]
pub(crate) async fn save_native_provider_continuation(
    window: tauri::WebviewWindow,
    input: SaveInput,
) -> Result<()> {
    let window = window.label().to_string();
    worker(move || {
        let run = run_owned(&input.run_handle, &window)?;
        ProviderContinuationStore::open(&run.profile.root)
            .and_then(|store| store.save(&run.scope, &input.record, &NATIVE_ENDPOINT_POLICY))
            .map_err(|_| failure("native_responses_continuation_save_failed"))?;
        run.current()?;
        Ok(())
    })
    .await
}

#[cfg(test)]
#[path = "native_responses_commands_tests.rs"]
mod tests;
