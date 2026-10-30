//! Window-owned Responses IPC. Credentials/grants live only in this process.
//! Saved runs/configuration are data: every dispatch still needs a fresh profile,
//! a native lease and a single exact-body approval. No command accepts a URL.
#![cfg(windows)]
use crate::native_provider_transport::{
    ApprovalGrant, Clock, ConfigVersion, DispatchStatus, Lease, MonotonicClock, NativeSession,
    Owner, PreparedRequest, SourceAuthority, SourceCheckFailure, SourceChecker, SourcePhase,
    SourceSnapshot, Transport,
};
use crate::native_responses_chat_archive::{ChatArchive, UsageStatus};
use crate::native_responses_chat_fixture::ChatFixtureTransport;
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
    monitor: Option<NativeSourceMonitor>,
    checker: Arc<dyn SourceChecker>,
    chat: Option<Mutex<ChatState>>,
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
        if self.chat.is_none() {
            crate::resolve_trusted_root_binding_by_id(&self.scope.owner.project_id)
                .map_err(|_| failure("native_responses_project_changed"))?;
        }
        Ok(())
    }
    fn revoke(&self) {
        self.alive.store(false, Ordering::Release);
        if let Some(monitor) = &self.monitor {
            monitor.revoke();
        }
        let _ = self.session.revoke_all();
        let _ = self.session.clear_credential();
        if let Some(chat) = &self.chat {
            if let Ok(mut chat) = chat.lock() {
                if let Some(pending) = chat.pending.take() {
                    let _ = chat.archive.fail_request(&pending.logical_id, true);
                }
                let _ = chat.archive.finish_conversation();
            }
        }
    }
}
// Text-only conversations select no filesystem sources. This authority is issued
// by the same native session; revocation still shares its final dispatch mutex.
struct TextOnlyChecker(SourceAuthority);
impl SourceChecker for TextOnlyChecker {
    fn check(
        &self,
        captured: &SourceSnapshot,
        _phase: SourcePhase,
    ) -> std::result::Result<SourceSnapshot, SourceCheckFailure> {
        let current = self.0.snapshot().map_err(|_| SourceCheckFailure)?;
        if current.generation() != captured.generation()
            || current.fingerprint() != captured.fingerprint()
        {
            return Err(SourceCheckFailure);
        }
        Ok(current)
    }
}
struct ChatPending {
    logical_id: String,
    response: Arc<Mutex<ResponseState>>,
}
struct ChatState {
    archive: ChatArchive,
    pending: Option<ChatPending>,
}
fn chat_messages(body: &str) -> Result<Vec<serde_json::Value>> {
    use serde_json::{json, Value};
    let body: Value =
        serde_json::from_str(body).map_err(|_| failure("responses_chat_body_invalid"))?;
    let object = body
        .as_object()
        .ok_or_else(|| failure("responses_chat_body_invalid"))?;
    if object.keys().any(|key| {
        ![
            "model",
            "input",
            "stream",
            "store",
            "include",
            "max_output_tokens",
            "temperature",
            "reasoning",
            "tools",
            "tool_choice",
        ]
        .contains(&key.as_str())
    }) || body.get("store") != Some(&json!(false))
        || body
            .get("tools")
            .is_some_and(|tools| tools.as_array().map_or(true, |tools| !tools.is_empty()))
        || body
            .get("tool_choice")
            .is_some_and(|choice| choice != "none")
    {
        return Err(failure("responses_chat_tools_forbidden"));
    }
    let input = body
        .get("input")
        .and_then(Value::as_array)
        .filter(|v| !v.is_empty() && v.len() <= 128)
        .ok_or_else(|| failure("responses_chat_body_invalid"))?;
    input
        .iter()
        .map(|item| {
            let item = item
                .as_object()
                .ok_or_else(|| failure("responses_chat_body_invalid"))?;
            if item
                .keys()
                .any(|key| !["type", "role", "content"].contains(&key.as_str()))
                || item.get("type").and_then(Value::as_str) != Some("message")
            {
                return Err(failure("responses_chat_tools_forbidden"));
            }
            let role = item
                .get("role")
                .and_then(Value::as_str)
                .filter(|role| ["system", "developer", "user", "assistant"].contains(role))
                .ok_or_else(|| failure("responses_chat_tools_forbidden"))?;
            let content = item
                .get("content")
                .ok_or_else(|| failure("responses_chat_body_invalid"))?;
            let text = if let Some(value) = content.as_str() {
                value.to_owned()
            } else {
                let parts = content
                    .as_array()
                    .ok_or_else(|| failure("responses_chat_body_invalid"))?;
                let mut text = String::new();
                for part in parts {
                    let part = part
                        .as_object()
                        .ok_or_else(|| failure("responses_chat_body_invalid"))?;
                    if part
                        .keys()
                        .any(|key| !["type", "text"].contains(&key.as_str()))
                        || !["input_text", "output_text"]
                            .contains(&part.get("type").and_then(Value::as_str).unwrap_or(""))
                    {
                        return Err(failure("responses_chat_tools_forbidden"));
                    }
                    text.push_str(
                        part.get("text")
                            .and_then(Value::as_str)
                            .ok_or_else(|| failure("responses_chat_body_invalid"))?,
                    );
                }
                text
            };
            Ok(json!({"role":role,"content":text}))
        })
        .collect()
}
fn chat_project_namespace(project: Option<&str>) -> Result<String> {
    if let Some(project) = project {
        if project.is_empty()
            || project.len() > 240
            || project.chars().any(|c| c.is_control() || c.is_whitespace())
        {
            return Err(failure("responses_chat_identity_invalid"));
        }
    }
    Ok(project
        .map(|project| format!("chat:project:{project}"))
        .unwrap_or_else(|| "chat:local".into()))
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
pub(crate) fn has_live_run_for_project(id: &str) -> bool {
    lock(broker())
        .map(|state| {
            state.runs.values().any(|run| {
                run.monitor.is_some()
                    && run.scope.owner.project_id == id
                    && run.alive.load(Ordering::Acquire)
            })
        })
        .unwrap_or(false)
}
pub(crate) fn observe_preview_guarded(
    project: &str,
    path: &str,
    bytes: u32,
    lines: u32,
    preview: &crate::project_source_versions::ScopedPreview,
    guard: Arc<crate::trusted_root_handle::BoundReadFile>,
) -> Result<()> {
    let runs = lock(broker())?
        .runs
        .values()
        .filter(|run| {
            run.monitor.is_some()
                && run.scope.owner.project_id == project
                && run.alive.load(Ordering::Acquire)
        })
        .cloned()
        .collect::<Vec<_>>();
    for run in runs {
        let monitor = run
            .monitor
            .as_ref()
            .ok_or_else(|| failure("native_source_unavailable"))?;
        let evidence = monitor
            .capture_preview_guarded(path, bytes, lines, preview, guard.clone())
            .map_err(|error| {
                run.revoke();
                failure(error)
            })?;
        let mut selected = monitor.selected_sources().map_err(failure)?;
        selected.push(evidence);
        monitor.set_sources(&selected).map_err(|error| {
            run.revoke();
            failure(error)
        })?;
    }
    Ok(())
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
#[cfg(test)]
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
            let monitor = run
                .monitor
                .as_ref()
                .ok_or_else(|| failure("native_source_unavailable"))?;
            let evidence = monitor
                .capture_preview(path, bytes, lines, preview)
                .map_err(failure)?;
            let mut selected = monitor.selected_sources().map_err(failure)?;
            selected.push(evidence);
            monitor.set_sources(&selected).map_err(failure)?;
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
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct PrepareInput {
    pub run_handle: String,
    pub body: String,
    #[serde(default)]
    pub logical_request_id: Option<String>,
}
input!(ChatBindInput {
    profile_id:String,
    project_id:Option<String>,
    conversation_id:String,
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
    model_settings: ModelSettings,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ModelSettings {
    supports_reasoning: bool,
    request_defaults: crate::product_settings_store::RequestDefaults,
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
fn validate_profile_mode(offline_demo: bool, credential: &str) -> Result<()> {
    let fixture_key = credential == "offline-responses-fixture-only";
    if offline_demo != fixture_key {
        return Err(failure("native_responses_credential_mode_mismatch"));
    }
    Ok(())
}
#[tauri::command]
pub(crate) async fn open_native_responses_profile(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    input: OpenInput,
) -> Result<OpenResult> {
    let root = root(&app)?;
    // Mode is native-owned. Normal startup never falls back to a fixture.
    let offline_demo = crate::app_profile::get_application_profile()?.offline_demo;
    validate_profile_mode(offline_demo, &input.credential)?;
    let fixture_root = if offline_demo {
        Some(crate::app_profile::responses_fixture_root()?)
    } else {
        None
    };
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
        let model = snapshot
            .config
            .models
            .iter()
            .find(|m| m.id == input.model_id)
            .ok_or_else(|| failure("native_responses_model_unavailable"))?;
        let model_settings = ModelSettings {
            supports_reasoning: model.supports_reasoning,
            request_defaults: model.request_defaults.clone(),
        };
        let fixture = fixture_root.is_some();
        let id = token()?;
        let profile = Arc::new(Profile {
            id: id.clone(),
            window,
            window_generation,
            root,
            snapshot,
            model_id: input.model_id.clone(),
            endpoint: endpoint.clone(),
            fixture_root,
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
            fixture,
            model_settings,
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
        if profile.fixture_root.is_none() {
            return Err(failure("responses_investigation_fixture_only"));
        }
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
            checker: monitor.checker(),
            monitor: Some(monitor),
            chat: None,
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
fn bind_conversation(
    profile: Arc<Profile>,
    project_id: Option<String>,
    conversation_id: String,
) -> Result<BindResult> {
    if conversation_id.is_empty()
        || conversation_id.len() > 256
        || conversation_id
            .chars()
            .any(|c| c.is_control() || c.is_whitespace())
    {
        return Err(failure("responses_chat_identity_invalid"));
    }
    let namespace = chat_project_namespace(project_id.as_deref())?;
    let existing = {
        let state = lock(broker())?;
        state
            .runs
            .iter()
            .find(|(_, run)| {
                run.chat.is_some()
                    && Arc::ptr_eq(&run.profile, &profile)
                    && run.scope.owner.project_id == namespace
                    && run.scope.owner.conversation_id == conversation_id
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
    let owner = ContinuationOwner {
        project_id: namespace,
        project_epoch: epoch()?,
        run_id: format!("chat-run-{}", token()?),
        conversation_id,
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
    let checker = Arc::new(TextOnlyChecker(session.source_authority()));
    let archive = ChatArchive::start_with_logical_project(
        &profile.root,
        &owner.project_id,
        &owner.conversation_id,
        &owner.run_id,
        &owner.provider_id,
        &owner.model_id,
        project_id.as_deref(),
    )
    .map_err(|_| failure("responses_chat_archive_failed"))?;
    let run = Arc::new(Run {
        profile: profile.clone(),
        scope,
        session,
        monitor: None,
        checker,
        chat: Some(Mutex::new(ChatState {
            archive,
            pending: None,
        })),
        // The conversation shares the memory profile lifetime. Each dispatch
        // still captures its own at-most-ten-minute native request lease.
        deadline: profile.expires_at,
        fixture_sequence: None,
        alive: AtomicBool::new(true),
    });
    run.current()?;
    let id = token()?;
    let mut state = lock(broker())?;
    if state.runs.len() >= MAX_RUNS
        || !profile.alive.load(Ordering::Acquire)
        || state.updating.contains(&owner.provider_id)
        || state.windows.get(&profile.window) != Some(&(profile.window_generation, false))
        || !state
            .profiles
            .get(&profile.id)
            .is_some_and(|current| Arc::ptr_eq(current, &profile))
    {
        drop(state);
        run.revoke();
        return Err(failure("native_responses_session_closed"));
    }
    if let Some((existing, previous)) = state.runs.iter().find(|(_, previous)| {
        previous.chat.is_some()
            && Arc::ptr_eq(&previous.profile, &profile)
            && previous.scope.owner.project_id == owner.project_id
            && previous.scope.owner.conversation_id == owner.conversation_id
    }) {
        let result = BindResult {
            run_handle: existing.clone(),
            owner: previous.scope.owner.clone(),
        };
        drop(state);
        run.revoke();
        return Ok(result);
    }
    let retired: Vec<_> = state
        .runs
        .iter()
        .filter(|(_, previous)| previous.chat.is_some() && Arc::ptr_eq(&previous.profile, &profile))
        .map(|(id, _)| id.clone())
        .collect();
    let retired: Vec<_> = retired
        .into_iter()
        .filter_map(|id| state.runs.remove(&id))
        .collect();
    state.runs.insert(id.clone(), run);
    drop(state);
    for previous in retired {
        previous.revoke();
    }
    Ok(BindResult {
        run_handle: id,
        owner,
    })
}
#[tauri::command]
pub(crate) async fn bind_native_responses_conversation(
    window: tauri::WebviewWindow,
    input: ChatBindInput,
) -> Result<BindResult> {
    let profile = profile_owned(&input.profile_id, window.label())?;
    worker(move || bind_conversation(profile, input.project_id, input.conversation_id)).await
}
fn fail_chat_request(request: &Request, cancelled: bool) {
    if let Some(chat) = &request.run.chat {
        if let Ok(mut chat) = chat.lock() {
            if chat
                .pending
                .as_ref()
                .is_some_and(|pending| Arc::ptr_eq(&pending.response, &request.response))
            {
                let pending = chat.pending.take().expect("checked pending");
                let _ = chat.archive.fail_request(&pending.logical_id, cancelled);
            }
        }
    }
}
fn chat_terminal_response(response: &ResponseState) -> Option<serde_json::Value> {
    let bytes: Vec<u8> = response.chunks.iter().flatten().copied().collect();
    let text = std::str::from_utf8(&bytes).ok()?;
    if response
        .head
        .as_ref()?
        .content_type
        .split(';')
        .next()?
        .trim()
        == "application/json"
    {
        return serde_json::from_str(text).ok();
    }
    let normalized = text.replace("\r\n", "\n");
    let mut terminal = None;
    for event in normalized.split("\n\n") {
        let data = event
            .lines()
            .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
            .collect::<Vec<_>>()
            .join("\n");
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&data) else {
            continue;
        };
        if value.get("type").and_then(|v| v.as_str()) == Some("response.completed") {
            terminal = value.get("response").cloned();
        }
    }
    terminal
}
fn chat_response_matches(response: &ResponseState, record: &ProviderNativeContinuation) -> bool {
    let Some(value) = chat_terminal_response(response) else {
        return false;
    };
    if value.get("id").and_then(|v| v.as_str()) != Some(&record.response_id)
        || value.get("status").and_then(|v| v.as_str()) != Some("completed")
        || value.get("output").and_then(|v| v.as_array()) != Some(&record.output)
    {
        return false;
    }
    let mut text = String::new();
    for item in &record.output {
        match item.get("type").and_then(|v| v.as_str()) {
            Some("reasoning") => {}
            Some("message") => {
                if item.get("role").and_then(|v| v.as_str()) != Some("assistant") {
                    return false;
                }
                let Some(parts) = item.get("content").and_then(|v| v.as_array()) else {
                    return false;
                };
                for part in parts {
                    if part.get("type").and_then(|v| v.as_str()) != Some("output_text") {
                        return false;
                    }
                    let Some(content) = part.get("text").and_then(|v| v.as_str()) else {
                        return false;
                    };
                    text.push_str(content);
                }
            }
            _ => return false,
        }
    }
    text == record.assistant.content
}

fn chat_usage(response: &ResponseState) -> UsageStatus {
    let bytes: Vec<u8> = response.chunks.iter().flatten().copied().collect();
    let Ok(text) = std::str::from_utf8(&bytes) else {
        return UsageStatus::Unknown;
    };
    for line in text.lines().rev() {
        let Some(data) = line.strip_prefix("data: ") else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(data) else {
            continue;
        };
        if value.get("type").and_then(|v| v.as_str()) != Some("response.completed") {
            continue;
        }
        let Some(usage) = value.pointer("/response/usage") else {
            return UsageStatus::Unknown;
        };
        let (Some(input_tokens), Some(output_tokens)) = (
            usage.get("input_tokens").and_then(|v| v.as_u64()),
            usage.get("output_tokens").and_then(|v| v.as_u64()),
        ) else {
            return UsageStatus::Unknown;
        };
        return UsageStatus::Reported {
            input_tokens,
            output_tokens,
            total_tokens: usage.get("total_tokens").and_then(|v| v.as_u64()),
        };
    }
    UsageStatus::Unknown
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
        let chat_body = if run.chat.is_some() {
            Some(chat_messages(&input.body)?)
        } else {
            None
        };
        if let Some(monitor) = &run.monitor {
            let sources = monitor.selected_sources().map_err(failure)?;
            monitor.set_sources(&sources).map_err(failure)?;
        }
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
                run.checker.as_ref(),
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
            run: run.clone(),
            prepared: Arc::new(prepared),
            lease,
            approval: Mutex::new(None),
            started: AtomicBool::new(false),
            response: Arc::new(Mutex::new(ResponseState {
                dispatch_status: "notDispatched".into(),
                ..Default::default()
            })),
        });
        if let Some(messages) = chat_body {
            let logical = input
                .logical_request_id
                .as_deref()
                .filter(|id| !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control))
                .ok_or_else(|| failure("responses_chat_identity_invalid"))?;
            let mut chat = lock(
                run.chat
                    .as_ref()
                    .ok_or_else(|| failure("responses_chat_identity_invalid"))?,
            )?;
            if chat.pending.is_some() {
                return Err(failure("responses_chat_request_busy"));
            }
            chat.archive
                .begin_request(logical, &messages)
                .map_err(|_| failure("responses_chat_archive_failed"))?;
            chat.pending = Some(ChatPending {
                logical_id: logical.to_owned(),
                response: request.response.clone(),
            });
        }
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
                    request.run.checker.as_ref(),
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
                if request.run.chat.is_some() && request.run.profile.fixture_root.is_some() {
                    Box::new(
                        ChatFixtureTransport::with_chunk_sink(chunk_sink).with_head_sink(head_sink),
                    )
                } else if let Some(sequence) = &request.run.fixture_sequence {
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
                request.run.checker.as_ref(),
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
            if outcome.error.is_some() {
                fail_chat_request(&request, false);
            }
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
    fail_chat_request(&request, true);
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
        if let Some(chat) = &run.chat {
            let mut chat = lock(chat)?;
            if input
                .record
                .assistant
                .tool_calls
                .as_ref()
                .is_some_and(|calls| !calls.is_empty())
            {
                return Err(failure("responses_chat_tools_forbidden"));
            }
            let pending = chat
                .pending
                .as_ref()
                .filter(|pending| pending.logical_id == input.record.request_id)
                .ok_or_else(|| failure("responses_chat_request_mismatch"))?;
            let response = lock(&pending.response)?;
            if !response.done
                || response.error.is_some()
                || !response
                    .head
                    .as_ref()
                    .is_some_and(|head| (200..300).contains(&head.status))
                || !run.alive.load(Ordering::Acquire)
                || !chat_response_matches(&response, &input.record)
            {
                return Err(failure("responses_chat_response_unconfirmed"));
            }
            let usage = chat_usage(&response);
            drop(response);
            ProviderContinuationStore::open(&run.profile.root)
                .and_then(|store| store.save(&run.scope, &input.record, &NATIVE_ENDPOINT_POLICY))
                .map_err(|_| failure("native_responses_continuation_save_failed"))?;
            if !run.alive.load(Ordering::Acquire) || !run.profile.alive.load(Ordering::Acquire) {
                return Err(failure("native_responses_session_closed"));
            }
            chat.archive
                .complete_request(
                    &input.record.request_id,
                    &input.record.assistant.content,
                    usage,
                )
                .map_err(|_| failure("responses_chat_archive_failed"))?;
            chat.pending = None;
        } else {
            ProviderContinuationStore::open(&run.profile.root)
                .and_then(|store| store.save(&run.scope, &input.record, &NATIVE_ENDPOINT_POLICY))
                .map_err(|_| failure("native_responses_continuation_save_failed"))?;
        }
        run.current()?;
        Ok(())
    })
    .await
}

#[cfg(test)]
#[path = "native_responses_commands_tests.rs"]
mod tests;
