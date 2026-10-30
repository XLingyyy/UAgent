//! Saved-credential DeepSeek ordinary-chat broker. No vault secret is IPC data.
//! Only native app-data/configuration selects the binding and official target.
#![cfg(windows)]
use crate::credential_vault::{self, CredentialBinding, Secret};
use crate::native_deepseek_http::{contains_secret, SafeSse, WinHttpDeepSeekTransport};
use crate::native_provider_transport::{
    ApprovalGrant, Clock, ConfigVersion, CredentialBytes, DispatchSignal, DispatchStatus, Lease,
    MonotonicClock, NativeSession, Owner, PreparedRequest, RequestView, ResponseBuffer,
    SourceAuthority, SourceCheckFailure, SourceChecker, SourcePhase, SourceSnapshot, Transport,
    TransportFailure, WriteReceipt, WriteStatus,
};
use crate::product_settings_store::{
    AuthMode, ProductSettingsStore, ProviderSnapshot, ProviderVersion, WireApi,
};
use crate::provider_endpoint_policy::{prepare_deepseek_endpoint, NATIVE_ENDPOINT_POLICY};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
type Result<T> = std::result::Result<T, String>;
const TTL: u64 = 3_600_000;
const REQUEST_TTL: u64 = 120_000;
const MODEL: &str = "deepseek-flash";
fn error(code: &str) -> String {
    code.into()
}
fn lock<T>(m: &Mutex<T>) -> Result<std::sync::MutexGuard<'_, T>> {
    m.lock().map_err(|_| error("saved_deepseek_unavailable"))
}
fn token() -> Result<String> {
    let mut b = [0u8; 32];
    getrandom::getrandom(&mut b).map_err(|_| error("saved_deepseek_unavailable"))?;
    Ok(b.iter().map(|x| format!("{x:02x}")).collect())
}
fn valid_id(v: &str) -> bool {
    !v.is_empty() && v.len() <= 256 && !v.chars().any(char::is_control)
}
fn wall() -> Result<u64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| error("saved_deepseek_unavailable"))?
        .as_millis() as u64)
}
fn saved(root: &Path, id: &str, model: &str) -> Result<ProviderSnapshot> {
    let s = ProductSettingsStore::open(&root.join("run-store-v2"))
        .and_then(|x| x.provider(id, &NATIVE_ENDPOINT_POLICY))
        .map_err(|_| error("saved_deepseek_configuration_unavailable"))?
        .ok_or_else(|| error("saved_deepseek_configuration_unavailable"))?;
    if !s.config.enabled
        || s.config.auth_mode != AuthMode::EnvKey
        || !matches!(
            s.config.wire_api,
            WireApi::ChatCompletions | WireApi::OpenaiCompatible
        )
        || model != MODEL
        || !s.config.models.iter().any(|m| m.id == model)
    {
        return Err(error("saved_deepseek_configuration_unavailable"));
    }
    prepare_deepseek_endpoint(&s.config.base_url)
        .map_err(|_| error("saved_deepseek_endpoint_rejected"))?;
    Ok(s)
}
struct Profile {
    id: String,
    window: String,
    window_generation: u64,
    root: PathBuf,
    snapshot: ProviderSnapshot,
    model: String,
    binding: CredentialBinding,
    vault_version: String,
    key: Secret,
    clock: Arc<MonotonicClock>,
    fixture: bool,
    alive: AtomicBool,
}
impl Profile {
    fn current(&self) -> Result<()> {
        if !self.alive.load(Ordering::Acquire) || self.clock.now_ms() >= TTL {
            return Err(error("saved_deepseek_session_closed"));
        }
        {
            let b = lock(broker())?;
            if b.windows.get(&self.window) != Some(&(self.window_generation, false))
                || b.updating.contains(&self.snapshot.config.provider_id)
            {
                return Err(error("saved_deepseek_session_closed"));
            }
        }
        let current = saved(&self.root, &self.snapshot.config.provider_id, &self.model)?;
        if current.generation != self.snapshot.generation
            || current.revision != self.snapshot.revision
            || current.config.base_url != self.snapshot.config.base_url
        {
            return Err(error("saved_deepseek_configuration_changed"));
        }
        Ok(())
    }
}
struct TextOnly {
    authority: SourceAuthority,
    profile: Arc<Profile>,
}
impl SourceChecker for TextOnly {
    fn check(
        &self,
        captured: &SourceSnapshot,
        _: SourcePhase,
    ) -> std::result::Result<SourceSnapshot, SourceCheckFailure> {
        self.profile.current().map_err(|_| SourceCheckFailure)?;
        let s = self.authority.snapshot().map_err(|_| SourceCheckFailure)?;
        if s.generation() != captured.generation() || s.fingerprint() != captured.fingerprint() {
            return Err(SourceCheckFailure);
        }
        Ok(s)
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Head {
    status: u16,
    content_type: String,
}
#[derive(Default)]
struct Output {
    chunks: Vec<Vec<u8>>,
    bytes: usize,
    head: Option<Head>,
    done: bool,
    error: Option<String>,
}
struct Request {
    window: String,
    profile: Arc<Profile>,
    session: NativeSession,
    lease: Lease,
    prepared: Arc<PreparedRequest>,
    checker: Arc<TextOnly>,
    approval: Mutex<Option<ApprovalGrant>>,
    started: AtomicBool,
    output: Arc<Mutex<Output>>,
}
#[derive(Default)]
struct Broker {
    windows: HashMap<String, (u64, bool)>,
    updating: HashSet<String>,
    profiles: HashMap<String, Arc<Profile>>,
    requests: HashMap<String, Arc<Request>>,
}
fn broker() -> &'static Mutex<Broker> {
    static B: OnceLock<Mutex<Broker>> = OnceLock::new();
    B.get_or_init(|| Mutex::new(Broker::default()))
}
fn profile_owned(id: &str, window: &str) -> Result<Arc<Profile>> {
    let p = lock(broker())?
        .profiles
        .get(id)
        .cloned()
        .ok_or_else(|| error("saved_deepseek_session_closed"))?;
    if p.window != window {
        return Err(error("saved_deepseek_session_closed"));
    }
    p.current()?;
    Ok(p)
}
fn request_owned(id: &str, window: &str) -> Result<Arc<Request>> {
    let r = lock(broker())?
        .requests
        .get(id)
        .cloned()
        .ok_or_else(|| error("saved_deepseek_request_unavailable"))?;
    if r.window != window {
        return Err(error("saved_deepseek_request_unavailable"));
    }
    Ok(r)
}
fn revoke_request(r: &Request) {
    let _ = r.prepared.cancel();
    let _ = r.session.revoke_all();
    let _ = r.session.clear_credential();
}
fn close_profile(id: &str, window: &str) -> Result<()> {
    let mut b = lock(broker())?;
    if b.profiles.get(id).is_some_and(|p| p.window != window) {
        return Err(error("saved_deepseek_session_closed"));
    }
    if let Some(p) = b.profiles.remove(id) {
        p.alive.store(false, Ordering::Release);
    }
    for r in b.requests.values().filter(|r| r.profile.id == id) {
        revoke_request(r);
    }
    // Keep terminal request handles until explicit release so cancellation never
    // loses the only authoritative dispatch status for an already scheduled worker.
    Ok(())
}
fn invalidate_window(window: &str, destroyed: bool) {
    if let Ok(mut b) = lock(broker()) {
        let w = b.windows.entry(window.into()).or_insert((0, false));
        w.0 = w.0.saturating_add(1);
        w.1 |= destroyed;
        for p in b.profiles.values().filter(|p| p.window == window) {
            p.alive.store(false, Ordering::Release);
        }
        for r in b.requests.values().filter(|r| r.window == window) {
            revoke_request(r);
        }
        b.profiles.retain(|_, p| p.window != window);
        b.requests.retain(|_, r| r.window != window);
    }
}
pub(crate) fn register_window(window: &str) {
    invalidate_window(window, true);
    if let Ok(mut b) = lock(broker()) {
        b.windows.entry(window.into()).or_insert((0, true)).1 = false;
    }
}
pub(crate) fn revoke_window(window: &str) {
    invalidate_window(window, false);
}
pub(crate) fn destroy_window(window: &str) {
    invalidate_window(window, true);
}
pub(crate) fn revoke_provider(id: &str) {
    if let Ok(mut b) = lock(broker()) {
        for p in b
            .profiles
            .values()
            .filter(|p| p.snapshot.config.provider_id == id)
        {
            p.alive.store(false, Ordering::Release);
        }
        for r in b
            .requests
            .values()
            .filter(|r| r.profile.snapshot.config.provider_id == id)
        {
            revoke_request(r);
        }
        b.profiles
            .retain(|_, p| p.snapshot.config.provider_id != id);
    }
}
pub(crate) struct ProviderUpdateGuard(String);
impl Drop for ProviderUpdateGuard {
    fn drop(&mut self) {
        if let Ok(mut b) = lock(broker()) {
            b.updating.remove(&self.0);
        }
    }
}
pub(crate) fn begin_provider_update(id: &str) -> Result<ProviderUpdateGuard> {
    {
        let mut b = lock(broker())?;
        if !b.updating.insert(id.into()) {
            return Err(error("saved_deepseek_configuration_busy"));
        }
    }
    revoke_provider(id);
    Ok(ProviderUpdateGuard(id.into()))
}
/// No credential lock is acquired here: poll/cancel must remain usable while a
/// worker holds the vault-version dispatch fence.
fn current_request(r: &Request) -> Result<()> {
    r.profile.current()?;
    if !r.lease.is_current() {
        return Err(error("saved_deepseek_session_closed"));
    }
    Ok(())
}
fn status(r: &Request) -> String {
    match r.prepared.status() {
        DispatchStatus::NotDispatched => "notDispatched",
        DispatchStatus::MayHaveBeenSent => "mayHaveBeenSent",
        DispatchStatus::Sent => "sent",
    }
    .into()
}
fn validate_body(body: &str, key: &[u8]) -> Result<()> {
    if body.is_empty() || body.len() > 32768 {
        return Err(error("saved_deepseek_body_invalid"));
    }
    let value: Value =
        serde_json::from_str(body).map_err(|_| error("saved_deepseek_body_invalid"))?;
    if contains_secret(&value, key, 0) {
        return Err(error("saved_deepseek_secret_rejected"));
    }
    if value.as_object().map_or(true, |map| {
        map.keys().any(|key| {
            ![
                "model",
                "messages",
                "stream",
                "max_tokens",
                "stream_options",
                "thinking",
                "temperature",
                "tools",
                "tool_choice",
            ]
            .contains(&key.as_str())
        })
    }) || !value
        .get("max_tokens")
        .and_then(Value::as_u64)
        .is_some_and(|n| (1..=1024).contains(&n))
        || value
            .get("stream_options")
            .and_then(|v| v.get("include_usage"))
            != Some(&Value::Bool(true))
        || value
            .get("thinking")
            .and_then(|v| v.get("type"))
            .and_then(Value::as_str)
            != Some("disabled")
        || value.get("temperature").and_then(Value::as_f64) != Some(0.0)
    {
        return Err(error("saved_deepseek_body_invalid"));
    }
    if value.get("model").and_then(Value::as_str) != Some(MODEL)
        || value.get("stream") != Some(&Value::Bool(true))
        || value
            .get("tools")
            .is_some_and(|t| t.as_array().map_or(true, |a| !a.is_empty()))
        || value.get("tool_choice").is_some_and(|v| v != "none")
    {
        return Err(error("saved_deepseek_tools_forbidden"));
    }
    let messages = value
        .get("messages")
        .and_then(Value::as_array)
        .filter(|v| !v.is_empty() && v.len() <= 32)
        .ok_or_else(|| error("saved_deepseek_body_invalid"))?;
    for m in messages {
        if !matches!(
            m.get("role").and_then(Value::as_str),
            Some("user" | "assistant" | "system" | "developer")
        ) || m.as_object().map_or(true, |map| {
            map.keys()
                .any(|key| !["role", "content"].contains(&key.as_str()))
        }) || !m.get("content").is_some_and(Value::is_string)
            || m.get("tool_calls").is_some()
            || m.get("tool_call_id").is_some()
        {
            return Err(error("saved_deepseek_tools_forbidden"));
        }
    }
    Ok(())
}
macro_rules! input{($name:ident{$($field:ident:$ty:ty),*$(,)?})=>{#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub(crate) struct $name{$(pub $field:$ty),*}};}
input!(OpenInput {
    provider_id: String,
    model_id: String,
    expected_vault_version: String,
    expected_provider_version: ProviderVersion
});
input!(ProfileInput { profile_id: String });
input!(PrepareInput{profile_id:String,project_id:Option<String>,conversation_id:String,body:String});
input!(RequestInput { request_id: String });
input!(PollInput {
    request_id: String,
    cursor: usize
});
input!(TextInput {
    profile_id: String,
    text: String
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
    vault_version: String,
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
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CancelResult {
    dispatch_status: String,
    done: bool,
}
async fn worker<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|_| error("saved_deepseek_unavailable"))?
}

#[tauri::command]
pub(crate) async fn open_saved_deepseek_profile(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    input: OpenInput,
) -> Result<OpenResult> {
    let root = crate::app_profile::resolve_app_data_dir(&app)
        .map_err(|_| error("saved_deepseek_unavailable"))?;
    let fixture = crate::app_profile::get_application_profile()?.offline_demo;
    window
        .inner_size()
        .map_err(|_| error("saved_deepseek_window_unavailable"))?;
    let window = window.label().to_string();
    let generation = lock(broker())?
        .windows
        .get(&window)
        .filter(|(_, dead)| !dead)
        .map(|x| x.0)
        .ok_or_else(|| error("saved_deepseek_window_unavailable"))?;
    worker(move || {
        let snapshot = saved(&root, &input.provider_id, &input.model_id)?;
        if snapshot.version() != input.expected_provider_version {
            return Err(error("saved_deepseek_configuration_changed"));
        }
        let binding = CredentialBinding::new(
            &root,
            &input.provider_id,
            &snapshot.generation,
            &snapshot.config.base_url,
        )
        .map_err(|_| error("saved_deepseek_binding_invalid"))?;
        let key = credential_vault::load(&binding, &input.expected_vault_version)
            .map_err(|_| error("saved_deepseek_credential_changed"))?;
        if saved(&root, &input.provider_id, &input.model_id)?.version()
            != input.expected_provider_version
        {
            return Err(error("saved_deepseek_configuration_changed"));
        }
        let clock = Arc::new(MonotonicClock::new());
        let id = token()?;
        let p = Arc::new(Profile {
            id: id.clone(),
            window: window.clone(),
            window_generation: generation,
            root,
            snapshot,
            model: input.model_id.clone(),
            binding,
            vault_version: input.expected_vault_version.clone(),
            key,
            clock,
            fixture,
            alive: AtomicBool::new(true),
        });
        let mut b = lock(broker())?;
        if b.windows.get(&window) != Some(&(generation, false))
            || b.updating.contains(&input.provider_id)
        {
            return Err(error("saved_deepseek_session_closed"));
        }
        if b.profiles.len() >= 4 {
            return Err(error("saved_deepseek_profile_limit"));
        }
        b.profiles.insert(id.clone(), p.clone());
        let expiry = Arc::downgrade(&p);
        std::thread::Builder::new()
            .name("saved-deepseek-expiry".into())
            .spawn(move || loop {
                let Some(profile) = expiry.upgrade() else {
                    return;
                };
                if !profile.alive.load(Ordering::Acquire) {
                    return;
                }
                if profile.clock.now_ms() >= TTL {
                    let _ = close_profile(&profile.id, &profile.window);
                    return;
                }
                drop(profile);
                std::thread::sleep(Duration::from_millis(500));
            })
            .map_err(|_| {
                p.alive.store(false, Ordering::Release);
                b.profiles.remove(&id);
                error("saved_deepseek_worker_failed")
            })?;
        Ok(OpenResult {
            profile_id: id,
            provider_id: input.provider_id,
            model_id: input.model_id,
            endpoint: "https://api.deepseek.com/chat/completions".into(),
            expires_at: wall()? + TTL,
            fixture,
            vault_version: input.expected_vault_version,
        })
    })
    .await
}
#[tauri::command]
pub(crate) async fn validate_saved_deepseek_text(
    window: tauri::WebviewWindow,
    input: TextInput,
) -> Result<()> {
    let window = window.label().to_string();
    worker(move || {
        let p = profile_owned(&input.profile_id, &window)?;
        if input.text.len() > 131072 {
            return Err(error("saved_deepseek_body_invalid"));
        }
        if contains_secret(&Value::String(input.text.clone()), p.key.as_bytes(), 0) {
            return Err(error("saved_deepseek_secret_rejected"));
        }
        if let Ok(value) = serde_json::from_str::<Value>(&input.text) {
            if contains_secret(&value, p.key.as_bytes(), 0) {
                return Err(error("saved_deepseek_secret_rejected"));
            }
        }
        Ok(())
    })
    .await
}
#[tauri::command]
pub(crate) async fn prepare_saved_deepseek_request(
    window: tauri::WebviewWindow,
    input: PrepareInput,
) -> Result<PrepareResult> {
    let window = window.label().to_string();
    worker(move || {
        if !valid_id(&input.conversation_id)
            || input.project_id.as_deref().is_some_and(|v| !valid_id(v))
        {
            return Err(error("saved_deepseek_owner_invalid"));
        }
        let p = profile_owned(&input.profile_id, &window)?;
        validate_body(&input.body, p.key.as_bytes())?;
        {
            let b = lock(broker())?;
            if b.requests.len() >= 8
                || b.requests.values().any(|r| {
                    r.profile.id == p.id && !lock(&r.output).map(|o| o.done).unwrap_or(false)
                })
            {
                return Err(error("saved_deepseek_request_busy"));
            }
        }
        let id = token()?;
        let session = NativeSession::new(
            Owner {
                project: input.project_id.unwrap_or_else(|| "chat:local".into()),
                epoch: p.window_generation,
                run: id.clone(),
                conversation: input.conversation_id,
                provider: p.snapshot.config.provider_id.clone(),
                model: p.model.clone(),
            },
            ConfigVersion {
                generation: p.snapshot.generation.clone(),
                revision: p.snapshot.revision as u64,
            },
            [0; 32],
            p.clock.clone(),
        );
        session
            .install_credential(p.key.as_bytes().to_vec(), TTL)
            .map_err(|e| error(e.code()))?;
        let lease = session
            .capture_lease(p.clock.now_ms().saturating_add(REQUEST_TTL).min(TTL))
            .map_err(|e| error(e.code()))?;
        let checker = Arc::new(TextOnly {
            authority: session.source_authority(),
            profile: p.clone(),
        });
        let prepared = session
            .prepare_chat_completions(
                &lease,
                &p.snapshot.config.base_url,
                input.body.into_bytes(),
                checker.as_ref(),
            )
            .map_err(|e| error(e.code()))?;
        let result = PrepareResult {
            request_id: id.clone(),
            endpoint: prepared.binding().endpoint.clone(),
            model_id: prepared.binding().model.clone(),
            body_sha256: prepared
                .binding()
                .body_sha256
                .iter()
                .map(|x| format!("{x:02x}"))
                .collect(),
        };
        let r = Arc::new(Request {
            window: window.clone(),
            profile: p.clone(),
            session,
            lease,
            prepared: Arc::new(prepared),
            checker,
            approval: Mutex::new(None),
            started: AtomicBool::new(false),
            output: Arc::new(Mutex::new(Output::default())),
        });
        let mut b = lock(broker())?;
        if b.windows.get(&window) != Some(&(p.window_generation, false))
            || b.updating.contains(&p.snapshot.config.provider_id)
            || !p.alive.load(Ordering::Acquire)
            || !b
                .profiles
                .get(&p.id)
                .is_some_and(|stored| Arc::ptr_eq(stored, &p))
        {
            revoke_request(&r);
            return Err(error("saved_deepseek_session_closed"));
        }
        if b.requests.len() >= 8
            || b.requests.values().any(|old| {
                old.profile.id == p.id && !lock(&old.output).map(|o| o.done).unwrap_or(false)
            })
        {
            revoke_request(&r);
            return Err(error("saved_deepseek_request_busy"));
        }
        b.requests.insert(id, r);
        Ok(result)
    })
    .await
}
#[tauri::command]
pub(crate) async fn approve_saved_deepseek_request(
    window: tauri::WebviewWindow,
    input: RequestInput,
) -> Result<()> {
    let window = window.label().to_string();
    worker(move || {
        let r = request_owned(&input.request_id, &window)?;
        current_request(&r)?;
        let mut grant = lock(&r.approval)?;
        if grant.is_some() || r.started.load(Ordering::Acquire) {
            return Err(error("saved_deepseek_approval_consumed"));
        }
        *grant = Some(
            r.session
                .approve(&r.prepared, &r.lease, r.checker.as_ref())
                .map_err(|e| error(e.code()))?,
        );
        Ok(())
    })
    .await
}
fn finish_request(r: &Request, error: Option<String>) {
    if let Ok(mut output) = lock(&r.output) {
        output.error = error;
        if output.error.is_some() {
            output.chunks.clear();
            output.bytes = 0;
        }
        output.done = true;
    }
}
#[tauri::command]
pub(crate) async fn dispatch_saved_deepseek_request(
    window: tauri::WebviewWindow,
    input: RequestInput,
) -> Result<()> {
    let r = request_owned(&input.request_id, window.label())?;
    current_request(&r)?;
    let mut approval = lock(&r.approval)?;
    let grant = approval
        .take()
        .ok_or_else(|| error("saved_deepseek_approval_required"))?;
    if r.started.swap(true, Ordering::AcqRel) {
        return Err(error("saved_deepseek_approval_consumed"));
    }
    drop(approval);
    let failed = r.clone();
    std::thread::Builder::new()
        .name("saved-deepseek-transport".into())
        .spawn(move || {
            let filter = match SafeSse::new(r.profile.key.as_bytes().to_vec()) {
                Ok(f) => Arc::new(Mutex::new(f)),
                Err(_) => {
                    finish_request(&r, Some(error("saved_deepseek_response_rejected")));
                    return;
                }
            };
            let filtered = filter.clone();
            let output = r.output.clone();
            let active = r.clone();
            let chunks: crate::native_responses_http::ChunkSink = Arc::new(move |bytes| {
                if current_request(&active).is_err() {
                    return Err(());
                }
                let safe = filtered.lock().map_err(|_| ())?.push(bytes)?;
                let mut out = output.lock().map_err(|_| ())?;
                for bytes in safe {
                    if out.chunks.len() >= 4096
                        || out
                            .bytes
                            .checked_add(bytes.len())
                            .map_or(true, |n| n > 1_048_576)
                    {
                        return Err(());
                    }
                    out.bytes += bytes.len();
                    out.chunks.push(bytes);
                }
                Ok(())
            });
            let output = r.output.clone();
            let active = r.clone();
            let head: crate::native_responses_http::HeadSink = Arc::new(move |status, mime| {
                if current_request(&active).is_err() {
                    return Err(());
                }
                if status != 200 && !(400..=599).contains(&status) {
                    return Err(());
                }
                if !matches!(mime, "text/event-stream" | "application/json") {
                    return Err(());
                }
                let mut out = output.lock().map_err(|_| ())?;
                if out.head.is_some() {
                    return Err(());
                }
                out.head = Some(Head {
                    status,
                    content_type: mime.into(),
                });
                Ok(())
            });
            let mut transport: Box<dyn Transport> = if r.profile.fixture {
                Box::new(LocalFixture { chunks, head })
            } else {
                Box::new(WinHttpDeepSeekTransport::with_sinks(chunks, head))
            };
            // The OS credential mutex encloses the core's complete preflight/final native
            // lease gate and all transport effects. A version failure leaves progress zero.
            let outcome = credential_vault::with_current(
                &r.profile.binding,
                &r.profile.vault_version,
                || {
                    r.session.dispatch(
                        &r.prepared,
                        &r.lease,
                        &grant,
                        r.checker.as_ref(),
                        transport.as_mut(),
                    )
                },
            );
            let failure = match outcome {
                Err(_) => Some(error("saved_deepseek_credential_changed")),
                Ok(outcome) => {
                    if let Some(code) = outcome.error {
                        Some(error(code.code()))
                    } else if filter
                        .lock()
                        .map_err(|_| ())
                        .and_then(|f| f.finish())
                        .is_err()
                    {
                        Some(error("saved_deepseek_response_rejected"))
                    } else {
                        None
                    }
                }
            };
            finish_request(&r, failure);
        })
        .map_err(|_| {
            finish_request(&failed, Some(error("saved_deepseek_worker_failed")));
            error("saved_deepseek_worker_failed")
        })?;
    Ok(())
}
#[tauri::command]
pub(crate) async fn poll_saved_deepseek_request(
    window: tauri::WebviewWindow,
    input: PollInput,
) -> Result<PollResult> {
    let r = request_owned(&input.request_id, window.label())?;
    if let Err(failure) = current_request(&r) {
        let _ = r.prepared.cancel();
        return Ok(PollResult {
            cursor: input.cursor,
            next_cursor: input.cursor,
            chunks: vec![],
            head: None,
            done: true,
            error: Some(failure),
            dispatch_status: status(&r),
        });
    }
    let out = lock(&r.output)?;
    if out.done && out.error.is_some() {
        return Ok(PollResult {
            cursor: input.cursor,
            next_cursor: input.cursor,
            chunks: vec![],
            head: out.head.clone(),
            done: true,
            error: out.error.clone(),
            dispatch_status: status(&r),
        });
    }
    if input.cursor > out.chunks.len() {
        return Err(error("saved_deepseek_cursor_invalid"));
    }
    let mut end = input.cursor;
    let mut bytes = 0;
    while end < out.chunks.len() && bytes + out.chunks[end].len() <= 262144 {
        bytes += out.chunks[end].len();
        end += 1;
    }
    Ok(PollResult {
        cursor: input.cursor,
        next_cursor: end,
        chunks: out.chunks[input.cursor..end].to_vec(),
        head: out.head.clone(),
        done: out.done && end == out.chunks.len(),
        error: out.error.clone(),
        dispatch_status: status(&r),
    })
}
#[tauri::command]
pub(crate) async fn cancel_saved_deepseek_request(
    window: tauri::WebviewWindow,
    input: RequestInput,
) -> Result<CancelResult> {
    let r = request_owned(&input.request_id, window.label())?;
    revoke_request(&r);
    let done = lock(&r.output)?.done || r.prepared.status() == DispatchStatus::NotDispatched;
    Ok(CancelResult {
        dispatch_status: status(&r),
        done,
    })
}
#[tauri::command]
pub(crate) async fn release_saved_deepseek_request(
    window: tauri::WebviewWindow,
    input: RequestInput,
) -> Result<()> {
    let r = request_owned(&input.request_id, window.label())?;
    revoke_request(&r);
    lock(broker())?.requests.remove(&input.request_id);
    Ok(())
}
#[tauri::command]
pub(crate) async fn close_saved_deepseek_profile(
    window: tauri::WebviewWindow,
    input: ProfileInput,
) -> Result<()> {
    close_profile(&input.profile_id, window.label())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn body() -> String {
        json!({"model":MODEL,"messages":[{"role":"user","content":"ordinary synthetic goal"}],"stream":true,"max_tokens":100,"stream_options":{"include_usage":true},"thinking":{"type":"disabled"},"temperature":0}).to_string()
    }
    const KEY: &[u8] = b"unique-native-fixture-only-key";
    #[test]
    fn ordinary_body_is_data_not_tool_authority() {
        validate_body(&body(), KEY).unwrap();
        for value in [
            json!({"model":MODEL,"messages":[{"role":"tool","content":"x"}],"stream":true}),
            json!({"model":MODEL,"messages":[{"role":"user","content":"x"}],"stream":true,"tools":[{"type":"function"}]}),
            json!({"model":MODEL,"messages":[{"role":"assistant","content":"x","tool_calls":[]}],"stream":true}),
            json!({"model":"other","messages":[{"role":"user","content":"x"}],"stream":true}),
        ] {
            assert!(validate_body(&value.to_string(), KEY).is_err());
        }
    }
    #[test]
    fn original_or_json_escaped_credential_never_enters_managed_body() {
        let key = std::str::from_utf8(KEY).unwrap();
        assert_eq!(
            validate_body(&body().replace("ordinary synthetic goal", key), KEY).unwrap_err(),
            "saved_deepseek_secret_rejected"
        );
        let encoded = KEY
            .iter()
            .map(|b| format!("\\u{b:04x}"))
            .collect::<String>();
        assert_eq!(
            validate_body(&body().replace("ordinary synthetic goal", &encoded), KEY).unwrap_err(),
            "saved_deepseek_secret_rejected"
        );
    }
    struct Same;
    impl SourceChecker for Same {
        fn check(
            &self,
            s: &SourceSnapshot,
            _: SourcePhase,
        ) -> std::result::Result<SourceSnapshot, SourceCheckFailure> {
            Ok(s.clone())
        }
    }
    struct NeverNetwork {
        before_revoke: Option<NativeSession>,
        calls: usize,
        seen: Vec<u8>,
    }
    impl Transport for NeverNetwork {
        fn before_dispatch(
            &mut self,
            _: RequestView<'_>,
        ) -> std::result::Result<(), TransportFailure> {
            if let Some(s) = &self.before_revoke {
                let _ = s.revoke_all();
            }
            Ok(())
        }
        fn dispatch(
            &mut self,
            r: RequestView<'_>,
            k: CredentialBytes<'_>,
            _: DispatchSignal<'_>,
            response: &mut ResponseBuffer,
        ) -> std::result::Result<WriteReceipt, TransportFailure> {
            self.calls += 1;
            self.seen = r.body.to_vec();
            assert_eq!(k.bytes(), KEY);
            assert_eq!(r.endpoint, "https://api.deepseek.com/chat/completions");
            response.push(b"synthetic").unwrap();
            Ok(WriteReceipt {
                write: WriteStatus::Complete,
            })
        }
    }
    fn session() -> NativeSession {
        let s = NativeSession::new(
            Owner {
                project: "project-A".into(),
                epoch: 3,
                run: "run-A".into(),
                conversation: "conversation-A".into(),
                provider: "saved-deepseek".into(),
                model: MODEL.into(),
            },
            ConfigVersion {
                generation: "generation-A".into(),
                revision: 4,
            },
            [0; 32],
            Arc::new(MonotonicClock::new()),
        );
        s.install_credential(KEY.to_vec(), TTL).unwrap();
        s
    }
    #[test]
    fn prepared_exact_body_and_fixed_target_use_existing_native_final_gate() {
        let s = session();
        let lease = s.capture_lease(REQUEST_TTL).unwrap();
        let raw = body();
        let request = s
            .prepare_chat_completions(
                &lease,
                "https://api.deepseek.com",
                raw.as_bytes().to_vec(),
                &Same,
            )
            .unwrap();
        let grant = s.approve(&request, &lease, &Same).unwrap();
        let mut transport = NeverNetwork {
            before_revoke: None,
            calls: 0,
            seen: vec![],
        };
        let result = s.dispatch(&request, &lease, &grant, &Same, &mut transport);
        assert_eq!(result.status, DispatchStatus::Sent);
        assert!(result.error.is_none());
        assert_eq!(transport.calls, 1);
        assert_eq!(transport.seen, raw.as_bytes());
        assert!(s
            .dispatch(&request, &lease, &grant, &Same, &mut transport)
            .error
            .is_some());
        assert_eq!(transport.calls, 1);
    }
    #[test]
    fn revocation_during_preflight_never_reaches_transport() {
        let s = session();
        let lease = s.capture_lease(REQUEST_TTL).unwrap();
        let request = s
            .prepare_chat_completions(
                &lease,
                "https://api.deepseek.com",
                body().into_bytes(),
                &Same,
            )
            .unwrap();
        let grant = s.approve(&request, &lease, &Same).unwrap();
        let mut transport = NeverNetwork {
            before_revoke: Some(s.clone()),
            calls: 0,
            seen: vec![],
        };
        let result = s.dispatch(&request, &lease, &grant, &Same, &mut transport);
        assert_eq!(result.status, DispatchStatus::NotDispatched);
        assert!(result.error.is_some());
        assert_eq!(transport.calls, 0);
    }
    #[test]
    fn cancelling_approved_request_seals_the_unsent_gate() {
        let s = session();
        let lease = s.capture_lease(REQUEST_TTL).unwrap();
        let request = s
            .prepare_chat_completions(
                &lease,
                "https://api.deepseek.com",
                body().into_bytes(),
                &Same,
            )
            .unwrap();
        let grant = s.approve(&request, &lease, &Same).unwrap();
        request.cancel().unwrap();
        let mut transport = NeverNetwork {
            before_revoke: None,
            calls: 0,
            seen: vec![],
        };
        let result = s.dispatch(&request, &lease, &grant, &Same, &mut transport);
        assert_eq!(result.status, DispatchStatus::NotDispatched);
        assert_eq!(transport.calls, 0);
    }
    #[test]
    fn official_endpoint_and_model_identity_cannot_be_substituted() {
        let s = session();
        let lease = s.capture_lease(REQUEST_TTL).unwrap();
        for endpoint in [
            "http://api.deepseek.com",
            "https://api.deepseek.com.evil.invalid",
            "https://api.deepseek.com/v1",
            "https://api.deepseek.com?x=1",
            "https://api.openai.com/v1",
        ] {
            assert!(s
                .prepare_chat_completions(&lease, endpoint, body().into_bytes(), &Same)
                .is_err());
        }
        assert!(s
            .prepare_chat_completions(
                &lease,
                "https://api.deepseek.com",
                body().replace(MODEL, "other-model").into_bytes(),
                &Same
            )
            .is_err());
    }
}

struct LocalFixture {
    chunks: crate::native_responses_http::ChunkSink,
    head: crate::native_responses_http::HeadSink,
}
impl Transport for LocalFixture {
    fn before_dispatch(&mut self, r: RequestView<'_>) -> std::result::Result<(), TransportFailure> {
        if r.endpoint != "https://api.deepseek.com/chat/completions" {
            return Err(TransportFailure::new(
                WriteStatus::MayHaveWritten,
                "fixed_target_rejected".into(),
            ));
        }
        Ok(())
    }
    fn dispatch(
        &mut self,
        r: RequestView<'_>,
        _: CredentialBytes<'_>,
        signal: DispatchSignal<'_>,
        response: &mut ResponseBuffer,
    ) -> std::result::Result<WriteReceipt, TransportFailure> {
        let fail = || {
            TransportFailure::new(
                WriteStatus::Complete,
                "local_synthetic_stream_stopped".into(),
            )
        };
        if signal.is_cancelled() {
            return Err(fail());
        }
        (self.head)(200, "text/event-stream").map_err(|_| fail())?;
        let value: Value = serde_json::from_slice(r.body).map_err(|_| fail())?;
        let messages = value["messages"].as_array().ok_or_else(fail)?;
        let goal = messages
            .iter()
            .rev()
            .find(|m| m["role"] == "user")
            .and_then(|m| m["content"].as_str())
            .unwrap_or("");
        let count = messages.iter().filter(|m| m["role"] == "assistant").count();
        let text = if goal.starts_with("Local history: produce a long example.") {
            format!("Local synthetic saved-credential demo / no API.\nLong history begins.\n{}\nLong history ends.",(1..=100).map(|i|format!("History row {i:03}: deterministic local text; no real API request.")).collect::<Vec<_>>().join("\n"))
        } else {
            format!("Local synthetic saved-credential demo / no API.\nCompleted assistant messages received: {count}\n{}\n{}",goal.chars().take(160).collect::<String>(),"This response validates saved credential reuse without making a network request. ".repeat(8))
        };
        let points: Vec<char> = text.chars().collect();
        for chars in points.chunks(32) {
            if signal.is_cancelled() {
                return Err(fail());
            }
            let frame = format!(
                "data: {}\n\n",
                json!({"model":MODEL,"choices":[{"delta":{"content":chars.iter().collect::<String>()},"finish_reason":null}]})
            );
            response.push(frame.as_bytes()).map_err(|_| fail())?;
            (self.chunks)(frame.as_bytes()).map_err(|_| fail())?;
            std::thread::sleep(Duration::from_millis(30));
        }
        let end = format!(
            "data: {}\n\ndata: [DONE]\n\n",
            json!({"model":MODEL,"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":10,"total_tokens":20}})
        );
        response.push(end.as_bytes()).map_err(|_| fail())?;
        (self.chunks)(end.as_bytes()).map_err(|_| fail())?;
        if signal.is_cancelled() {
            return Err(fail());
        }
        Ok(WriteReceipt {
            write: WriteStatus::Complete,
        })
    }
}
