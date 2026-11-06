//! Native task credentials. View grants admit new tasks; running tasks own a
//! separate, bounded session. Neither keys nor native sessions are Host pipe data.
#![cfg(windows)]
use crate::credential_vault::Secret;
use crate::managed_run_store::{NativeStoreTaskGrant, NativeStoreWindowGrant};
use crate::native_provider_transport::{Clock, ConfigVersion, MonotonicClock, NativeSession, Owner};
use crate::product_settings_store::{ProviderSnapshot, ProviderVersion};
use std::{collections::{HashMap, HashSet}, path::{Path, PathBuf}, sync::{Arc, Mutex, OnceLock, Weak,
    atomic::{AtomicBool, Ordering}}};

type Result<T> = std::result::Result<T, &'static str>;
const TTL: u64 = 3_600_000;

struct Profile {
    window: String,
    document: Arc<NativeStoreWindowGrant>,
    root: PathBuf,
    snapshot: ProviderSnapshot,
    model: String,
    clock: Arc<dyn Clock>,
    key: Secret,
}

pub(crate) struct TaskModel {
    profile_id: String,
    window: String,
    root: PathBuf,
    snapshot: ProviderSnapshot,
    owner: Owner,
    task: Arc<NativeStoreTaskGrant>,
    clock: Arc<dyn Clock>,
    deadline: u64,
    alive: AtomicBool,
    session: NativeSession,
}
impl TaskModel {
    pub(crate) fn session(&self) -> &NativeSession { &self.session }
    pub(crate) fn remaining_ms(&self) -> u64 { self.deadline.saturating_sub(self.clock.now_ms()) }
    pub(crate) fn deadline_ms(&self) -> u64 { self.deadline }
    pub(crate) fn check_current(&self) -> Result<()> {
        if !self.alive.load(Ordering::Acquire) || self.remaining_ms() == 0
            || !self.task.accepts(&self.owner.project, &self.owner.run) {
            return Err("host_model_session_closed");
        }
        let current = crate::native_saved_deepseek::saved(&self.root, &self.owner.provider, &self.owner.model)
            .map_err(|_| "host_model_configuration_changed")?;
        if current.version() != self.snapshot.version() {
            self.revoke();
            return Err("host_model_configuration_changed");
        }
        if !self.alive.load(Ordering::Acquire) { return Err("host_model_session_closed"); }
        Ok(())
    }
    pub(crate) fn revoke(&self) {
        self.alive.store(false, Ordering::Release);
        let _ = self.session.revoke_all();
        let _ = self.session.clear_credential();
    }
}
impl Drop for TaskModel { fn drop(&mut self) { self.revoke(); } }

#[derive(Default)]
struct Profiles {
    profiles: HashMap<String, Arc<Profile>>,
    tasks: Vec<Weak<TaskModel>>,
    updating: HashSet<String>,
    closed: bool,
}
fn profiles() -> &'static Mutex<Profiles> {
    static STATE: OnceLock<Mutex<Profiles>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(Profiles::default()))
}
fn lock() -> Result<std::sync::MutexGuard<'static, Profiles>> {
    profiles().lock().map_err(|_| "host_model_unavailable")
}
fn token() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|_| "host_model_unavailable")?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

/// Called by native session setup after the application's live-mode authorization.
/// The document is captured by ManagedRunStoreState, never deserialized from IPC.
pub(crate) fn open(root: &Path, window: &str, document: Arc<NativeStoreWindowGrant>,
    expected: &ProviderVersion, model: &str, credential: Vec<u8>) -> Result<String> {
    let key = Secret::new(credential).map_err(|_| "host_model_credential_invalid")?;
    if !document.is_current() { return Err("host_model_document_revoked"); }
    let snapshot = crate::native_saved_deepseek::saved(root, &expected.provider_id, model)
        .map_err(|_| "host_model_configuration_changed")?;
    if &snapshot.version() != expected { return Err("host_model_configuration_changed"); }
    let id = token()?;
    let mut state = lock()?;
    state.profiles.retain(|_, profile| profile.document.is_current() && profile.clock.now_ms() < TTL);
    if state.closed || state.updating.contains(&expected.provider_id) || !document.is_current()
        || state.profiles.len() >= 8 { return Err("host_model_unavailable"); }
    state.profiles.insert(id.clone(), Arc::new(Profile { window: window.into(), document, root: root.into(),
        snapshot, model: model.into(), clock: Arc::new(MonotonicClock::new()), key }));
    Ok(id)
}

/// Only a freshly approved native task receives its own session. Reloaded views
/// cannot reuse the opening document, or recover this capability from a record.
pub(crate) fn capture(id: &str, window: &str, document: &NativeStoreWindowGrant,
    task: Arc<NativeStoreTaskGrant>, owner: Owner, duration_ms: u64) -> Result<Arc<TaskModel>> {
    if duration_ms == 0 || duration_ms > 600_000 || !task.accepts(&owner.project, &owner.run)
        || !task.belongs_to_document_app(document) {
        return Err("host_model_task_invalid");
    }
    let profile = lock()?.profiles.get(id).cloned().ok_or("host_model_session_closed")?;
    if profile.window != window || !profile.document.same_document(document) || !document.is_current()
        || profile.clock.now_ms() >= TTL || profile.snapshot.config.provider_id != owner.provider
        || profile.model != owner.model { return Err("host_model_session_closed"); }
    let current = crate::native_saved_deepseek::saved(&profile.root, &owner.provider, &owner.model)
        .map_err(|_| "host_model_configuration_changed")?;
    if current.version() != profile.snapshot.version() { return Err("host_model_configuration_changed"); }
    let session = NativeSession::new(owner.clone(), ConfigVersion { generation: current.generation.clone(),
        revision: current.revision as u64 }, [0;32], profile.clock.clone());
    let now = profile.clock.now_ms();
    let deadline = now.saturating_add(duration_ms).min(TTL);
    session.install_credential(profile.key.as_bytes().to_vec(), deadline)
        .map_err(|_| "host_model_credential_invalid")?;
    let model = Arc::new(TaskModel { profile_id: id.into(), window: window.into(), root: profile.root.clone(), snapshot: current,
        owner, task, clock: profile.clock.clone(), deadline,
        alive: AtomicBool::new(true), session });
    let mut state = lock()?;
    if state.closed || state.updating.contains(&model.owner.provider) || !document.is_current()
        || !state.profiles.get(id).is_some_and(|original| Arc::ptr_eq(original, &profile)) {
        return Err("host_model_session_closed");
    }
    state.tasks.retain(|task| task.strong_count() > 0);
    if state.tasks.len() >= 32 { return Err("host_model_task_limit"); }
    state.tasks.push(Arc::downgrade(&model));
    Ok(model)
}

pub(crate) fn close_profile(id: &str, window: &str) -> Result<()> {
    let tasks = {
        let mut state = lock()?;
        if state.profiles.get(id).is_some_and(|p| p.window != window) { return Err("host_model_session_closed"); }
        if state.tasks.iter().filter_map(Weak::upgrade).any(|task| task.profile_id == id && task.window != window) {
            return Err("host_model_session_closed");
        }
        state.profiles.remove(id);
        state.tasks.iter().filter_map(Weak::upgrade).filter(|task| task.profile_id == id).collect::<Vec<_>>()
    };
    for task in tasks { task.revoke(); }
    Ok(())
}

pub(crate) fn revoke_project(project: &str) {
    let tasks = lock().map(|state| state.tasks.iter().filter_map(Weak::upgrade)
        .filter(|task| task.owner.project == project).collect::<Vec<_>>()).unwrap_or_default();
    for task in tasks { task.revoke(); }
}

pub(crate) struct ProviderUpdateGuard(String);
impl Drop for ProviderUpdateGuard {
    fn drop(&mut self) { if let Ok(mut state) = lock() { state.updating.remove(&self.0); } }
}
pub(crate) fn begin_provider_update(provider: &str) -> Result<ProviderUpdateGuard> {
    let tasks = {
        let mut state = lock()?;
        if !state.updating.insert(provider.into()) { return Err("host_model_configuration_busy"); }
        state.profiles.retain(|_, profile| profile.snapshot.config.provider_id != provider);
        state.tasks.iter().filter_map(Weak::upgrade).filter(|task| task.owner.provider == provider).collect::<Vec<_>>()
    };
    for task in tasks { task.revoke(); }
    Ok(ProviderUpdateGuard(provider.into()))
}
pub(crate) fn close_all() {
    let tasks = lock().map(|mut state| {
        state.closed = true;
        state.profiles.clear();
        state.tasks.drain(..).filter_map(|task| task.upgrade()).collect::<Vec<_>>()
    }).unwrap_or_default();
    for task in tasks { task.revoke(); }
}

/// Navigation releases opening credentials. Existing task sessions retain only
/// their original deadline and are stopped by task cancellation or app exit.
pub(crate) fn release_window(window: &str) {
    if let Ok(mut state) = lock() { state.profiles.retain(|_, profile| profile.window != window); }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct OpenInput {
    provider_id: String,
    model_id: String,
    expected_provider_version: ProviderVersion,
    credential: String,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenReply {
    profile_id: String,
    provider_id: String,
    model_id: String,
}
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProfileInput { profile_id: String }

#[tauri::command]
pub(crate) async fn open_host_model_profile(app: tauri::AppHandle, window: tauri::WebviewWindow,
    input: OpenInput) -> std::result::Result<OpenReply, String> {
    use tauri::Manager;
    if crate::app_profile::get_application_profile()?.offline_demo
        || input.provider_id != input.expected_provider_version.provider_id {
        return Err("host_model_live_configuration_required".into());
    }
    let document = app.state::<crate::managed_run_store::ManagedRunStoreState>()
        .capture_window_grant(&window).map_err(|_| "host_model_document_revoked".to_string())?;
    let root = crate::app_profile::resolve_app_data_dir(&app)?;
    let label = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        let profile_id = open(&root, &label, document, &input.expected_provider_version,
            &input.model_id, input.credential.into_bytes()).map_err(str::to_string)?;
        Ok(OpenReply { profile_id, provider_id: input.provider_id, model_id: input.model_id })
    }).await.map_err(|_| "host_model_setup_unconfirmed".to_string())?
}

#[tauri::command]
pub(crate) async fn close_host_model_profile(app: tauri::AppHandle, window: tauri::WebviewWindow,
    input: ProfileInput) -> std::result::Result<(), String> {
    use tauri::Manager;
    app.state::<crate::managed_run_store::ManagedRunStoreState>()
        .capture_window_grant(&window).map_err(|_| "host_model_document_revoked".to_string())?;
    close_profile(&input.profile_id, window.label()).map_err(str::to_string)
}

#[cfg(test)]
#[path = "native_host_model_tests.rs"]
mod tests;
