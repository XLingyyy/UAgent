#[cfg(test)]
use crate::TrustedRootBinding;
use crate::{
    hash_path, is_trusted_root, normalize_project_path, redact_path_for_ui,
    resolve_trusted_root_binding_by_id,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::hash::{Hash, Hasher};
#[cfg(not(test))]
use std::io::Read;
use std::io::{BufRead, BufReader, Write};
use std::net::{SocketAddrV4, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const DEFAULT_OBSERVATION_TTL_MILLIS: u64 = 2 * 60 * 1000;
const MANAGED_CREATE_SCHEMA: &str = "uagent.mvp15d.managed-editor-process-create.v2";
const MANAGED_CREATE_RESULT_SCHEMA: &str = "uagent.mvp15d.managed-editor-process-create-result.v2";
const MANAGED_TERMINATE_SCHEMA: &str = "uagent.mvp15d.managed-editor-process-terminate.v2";
const MANAGED_TERMINATE_RESULT_SCHEMA: &str =
    "uagent.mvp15d.managed-editor-process-terminate-result.v2";
const PHASE_LISTENER_OWNER: &str = "phase_listener_owner";
const NEGATIVE_CASE_FIXTURE: &str = "negative_case_fixture";
const GUARDIAN_ENV: &str = "UAGENT_MVP15D_MANAGED_EDITOR_GUARDIAN";
const GUARDIAN_TEST_LISTENER_ENV: &str = "UAGENT_MVP15D_GUARDIAN_TEST_LISTENER";
const GUARDIAN_TEST_LISTENER_CHILD_ENV: &str = "UAGENT_MVP15D_GUARDIAN_TEST_LISTENER_CHILD";
const GUARDIAN_UE_EXECUTABLE_ENV: &str = "UAGENT_MVP15D_GUARDIAN_UE_EXECUTABLE";
const GUARDIAN_UPROJECT_ENV: &str = "UAGENT_MVP15D_GUARDIAN_UPROJECT";
const GUARDIAN_PORT_ENV: &str = "UAGENT_MVP15D_GUARDIAN_PORT";
const GUARDIAN_MARKER_ENV: &str = "UAGENT_MVP15D_GUARDIAN_MARKER";
const GUARDIAN_TASK_ENV: &str = "UAGENT_MVP15D_GUARDIAN_TASK";
const GUARDIAN_PHASE_ENV: &str = "UAGENT_MVP15D_GUARDIAN_PHASE";
const GUARDIAN_DDC_ENV: &str = "UAGENT_MVP15D_GUARDIAN_DDC";
const GUARDIAN_EVIDENCE_ROOT_ENV: &str = "UAGENT_MVP15D_GUARDIAN_EVIDENCE_ROOT";

fn next_observation_generation() -> u64 {
    static GENERATION: AtomicU64 = AtomicU64::new(0);
    let now = now_millis();
    let previous = GENERATION.fetch_max(now, Ordering::SeqCst);
    if previous >= now {
        GENERATION.fetch_add(1, Ordering::SeqCst) + 1
    } else {
        now
    }
}

fn observation_registry() -> &'static Mutex<HashMap<String, ObservationSessionRecord>> {
    static REGISTRY: std::sync::OnceLock<Mutex<HashMap<String, ObservationSessionRecord>>> =
        std::sync::OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn process_registry() -> &'static Mutex<HashMap<String, DiscoveredProcessRecord>> {
    static REGISTRY: std::sync::OnceLock<Mutex<HashMap<String, DiscoveredProcessRecord>>> =
        std::sync::OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

struct ManagedChildRecord {
    child: Child,
    purpose: String,
    owner_task_id: String,
    owner_phase: String,
    pid: u32,
    process_start_time: u64,
    guardian_pid: u32,
    guardian_process_start_time: u64,
    listener_port: Option<u16>,
    listener_instance_sha256: Option<String>,
    owner_binding_sha256: Option<String>,
}

fn managed_child_registry() -> &'static Mutex<HashMap<String, ManagedChildRecord>> {
    static REGISTRY: std::sync::OnceLock<Mutex<HashMap<String, ManagedChildRecord>>> =
        std::sync::OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn released_managed_process_registry() -> &'static Mutex<HashSet<String>> {
    static REGISTRY: std::sync::OnceLock<Mutex<HashSet<String>>> = std::sync::OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashSet::new()))
}

#[cfg(test)]
pub(crate) fn reset_registries_for_test() {
    for (_, mut managed) in managed_child_registry()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .drain()
    {
        drop(managed.child.stdin.take());
        let _ = managed.child.wait();
    }
    observation_registry()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clear();
    process_registry()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clear();
    released_managed_process_registry()
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clear();
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ObservationSessionRecord {
    session_id: String,
    process_id: String,
    project_id: String,
    root_id: String,
    uproject_display_path: String,
    pid_hash: String,
    process_display_name: String,
    source: String,
    mode: String,
    status: String,
    generation: u64,
    superseded_by_session_id: Option<String>,
    created_at: u64,
    expires_at: u64,
    last_heartbeat_at: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DiscoveredProcessRecord {
    process_id: String,
    pid_hash: String,
    pid: Option<u32>,
    process_start_time: Option<u64>,
    project_id: String,
    root_id: String,
    uproject_display_path: String,
    canonical_root: Option<String>,
    canonical_uproject: Option<String>,
    display_project_hint: String,
    display_executable_hash: String,
    display_name: String,
    process_state: String,
    source: String,
    owner_task_id: Option<String>,
    owner_phase: Option<String>,
    discovered_at: u64,
    expires_at: u64,
}

#[derive(Debug, Clone)]
struct ValidatedEditorConfig {
    public: EditorAttachValidationResult,
    root_id: String,
    uproject_display_path: String,
    canonical_root: Option<String>,
    canonical_uproject: Option<String>,
    fixture: bool,
}

#[derive(Debug, Clone)]
struct NativeProcessCandidate {
    pid: u32,
    start_time: u64,
    executable_name: String,
    executable_path: Option<String>,
    command_line: Vec<String>,
}

#[derive(Debug, Clone)]
struct NativeDiscoveryBuild {
    result: EditorProcessDiscoveryResult,
    records: Vec<DiscoveredProcessRecord>,
}

#[derive(Debug, Clone)]
struct NativeLifecycleCheck {
    alive: bool,
    reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AssetMutationObservationBinding {
    pub session_id: String,
    pub process_id: String,
    pub project_id: String,
    pub root_id: String,
    pub canonical_root: PathBuf,
    pub pid_hash: String,
    // These values are deliberately internal-only.  They are copied from the
    // native process record after its lifecycle identity has been checked, so
    // another native boundary can inspect that exact process without accepting
    // a renderer-supplied PID.
    pub pid: Option<u32>,
    pub process_start_time: Option<u64>,
    pub process_source: String,
    pub observation_generation: u64,
}

#[derive(Debug, Clone)]
pub(crate) struct NativeLoadedModuleObservation {
    // Module paths never leave the native boundary.  The companion attestation
    // code uses them only to compare the loaded image with its installed,
    // canonical artifact before publishing a redacted basename/size/hash.
    pub basename: String,
    pub canonical_path: PathBuf,
    pub size: u64,
}

#[allow(dead_code)]
pub(crate) fn validate_asset_mutation_observation(
    session_id: &str,
    expected_project_id: &str,
    expected_root_id: &str,
) -> Result<AssetMutationObservationBinding, &'static str> {
    validate_asset_mutation_observation_at(
        session_id,
        expected_project_id,
        expected_root_id,
        now_millis(),
    )
}

pub(crate) fn validate_asset_mutation_observation_at(
    session_id: &str,
    expected_project_id: &str,
    expected_root_id: &str,
    now: u64,
) -> Result<AssetMutationObservationBinding, &'static str> {
    validate_asset_mutation_observation_at_with(
        session_id,
        expected_project_id,
        expected_root_id,
        now,
        check_native_record_current,
        || {},
    )
}

fn validate_asset_mutation_observation_at_with<F, H>(
    session_id: &str,
    expected_project_id: &str,
    expected_root_id: &str,
    now: u64,
    lifecycle_check: F,
    before_commit: H,
) -> Result<AssetMutationObservationBinding, &'static str>
where
    F: Fn(&DiscoveredProcessRecord) -> NativeLifecycleCheck,
    H: Fn(),
{
    let session = observation_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable")?
        .get(session_id)
        .cloned()
        .ok_or("observation_session_unknown")?;
    match session.status.as_str() {
        "stopped" => return Err("observation_session_stopped"),
        "expired" => return Err("observation_session_expired"),
        "superseded" => return Err("stale_generation"),
        "attached" => {}
        _ => return Err("native_authority_unavailable"),
    }
    if now >= session.expires_at {
        return Err("observation_session_expired");
    }
    if session.project_id != expected_project_id {
        return Err("observation_project_mismatch");
    }
    if session.root_id != expected_root_id {
        return Err("trusted_root_binding_mismatch");
    }
    let trusted_root = resolve_trusted_root_binding_by_id(expected_root_id)?;
    let process = process_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable")?
        .get(&session.process_id)
        .cloned()
        .ok_or("process_exited")?;
    if process.process_id != session.process_id || process.pid_hash != session.pid_hash {
        return Err("observation_pid_mismatch");
    }
    if process.project_id != session.project_id {
        return Err("observation_project_mismatch");
    }
    if process.root_id != session.root_id {
        return Err("trusted_root_binding_mismatch");
    }
    if process.process_state != "running" {
        return Err("process_exited");
    }
    if now >= process.expires_at {
        return Err("process_exited");
    }
    if let Some(canonical_root) = process.canonical_root.as_deref() {
        if normalize_project_path(canonical_root)
            != normalize_project_path(&trusted_root.canonical_root.to_string_lossy())
        {
            return Err("trusted_root_binding_mismatch");
        }
    }
    if process.source == "native" || process.source == "managed" {
        let check = lifecycle_check(&process);
        if !check.alive {
            return Err(match check.reason.as_str() {
                "process_exited" => "process_exited",
                "project_mismatch" => "observation_project_mismatch",
                _ => "native_authority_unavailable",
            });
        }
    } else if process.source != "fixture" {
        return Err("native_authority_unavailable");
    }

    before_commit();
    commit_observation_renewal(session_id, &session, &process, now)?;
    Ok(AssetMutationObservationBinding {
        session_id: session.session_id,
        process_id: process.process_id,
        project_id: session.project_id,
        root_id: session.root_id,
        canonical_root: trusted_root.canonical_root,
        pid_hash: session.pid_hash,
        pid: process.pid,
        process_start_time: process.process_start_time,
        process_source: process.source,
        observation_generation: session.generation,
    })
}

/// Enumerate modules only after binding the request to a live, native UE
/// observation.  Fixture observations are intentionally rejected: fixtures may
/// exercise negative paths but must never become a source of positive loaded
/// module evidence.
pub(crate) fn observe_native_loaded_modules_for_asset_mutation(
    session_id: &str,
    expected_root_id: &str,
) -> Result<Vec<NativeLoadedModuleObservation>, &'static str> {
    let before = validate_native_asset_mutation_observation_for_root(session_id, expected_root_id)?;
    let pid = before.pid.ok_or("native_process_observation_required")?;
    let modules = enumerate_native_loaded_modules(pid)?;

    // Module enumeration and the later artifact hash are meaningful only while
    // the same positively identified process remains current.  Revalidate the
    // PID/start-time binding before handing the observations to the caller.
    let after = validate_native_asset_mutation_observation_for_root(session_id, expected_root_id)?;
    if before.pid != after.pid
        || before.process_start_time != after.process_start_time
        || before.pid_hash != after.pid_hash
        || before.process_id != after.process_id
    {
        return Err("native_process_observation_stale");
    }
    Ok(modules)
}

pub(crate) fn validate_native_asset_mutation_observation_for_root(
    session_id: &str,
    expected_root_id: &str,
) -> Result<AssetMutationObservationBinding, &'static str> {
    // Derive the expected project binding from the native observation record,
    // rather than accepting an extra renderer-provided project identifier.
    let session = observation_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable")?
        .get(session_id)
        .cloned()
        .ok_or("observation_session_unknown")?;
    if session.root_id != expected_root_id || session.source != "native" {
        return Err("native_process_observation_required");
    }
    let binding =
        validate_asset_mutation_observation(session_id, &session.project_id, expected_root_id)?;
    if binding.process_source != "native"
        || binding.pid.is_none()
        || binding.process_start_time.is_none()
    {
        return Err("native_process_observation_required");
    }
    Ok(binding)
}

fn commit_observation_renewal(
    session_id: &str,
    session_snapshot: &ObservationSessionRecord,
    process_snapshot: &DiscoveredProcessRecord,
    now: u64,
) -> Result<ObservationSessionRecord, &'static str> {
    // Every path that needs both registries uses observation -> process ordering.
    // Holding both guards makes the equality checks and both lease writes one commit.
    let mut sessions = observation_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable")?;
    let mut processes = process_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable")?;

    let current_session = sessions
        .get(session_id)
        .ok_or("observation_session_unknown")?;
    if current_session.status == "stopped" {
        return Err("observation_session_stopped");
    }
    if current_session != session_snapshot || current_session.status != "attached" {
        return Err("native_authority_unavailable");
    }
    let current_process = processes
        .get(&process_snapshot.process_id)
        .ok_or("process_exited")?;
    if current_process != process_snapshot || current_process.process_state != "running" {
        return Err("native_authority_unavailable");
    }

    let renewed_until = now.saturating_add(DEFAULT_OBSERVATION_TTL_MILLIS);
    let current_session = sessions
        .get_mut(session_id)
        .expect("session equality was checked while the registry lock is held");
    current_session.last_heartbeat_at = Some(now);
    current_session.expires_at = renewed_until;
    processes
        .get_mut(&process_snapshot.process_id)
        .expect("process equality was checked while the registry lock is held")
        .expires_at = renewed_until;
    Ok(current_session.clone())
}

#[cfg(test)]
pub(crate) fn register_asset_mutation_observation_fixture(
    trusted_root: &TrustedRootBinding,
    project_id: &str,
    label: &str,
    now: u64,
) -> AssetMutationObservationBinding {
    let process_id = format!("process:asset-fixture:{label}");
    let session_id = format!("editor-observation:asset-fixture:{label}");
    let pid_hash = format!("pid:asset-fixture:{label}");
    process_registry().lock().unwrap().insert(
        process_id.clone(),
        DiscoveredProcessRecord {
            process_id: process_id.clone(),
            pid_hash: pid_hash.clone(),
            pid: None,
            process_start_time: None,
            project_id: project_id.to_string(),
            root_id: trusted_root.root_id.clone(),
            uproject_display_path: "[project-root]/Game.uproject".to_string(),
            canonical_root: Some(normalize_project_path(
                &trusted_root.canonical_root.to_string_lossy(),
            )),
            canonical_uproject: None,
            display_project_hint: "[project-root]/Game.uproject".to_string(),
            display_executable_hash: "exe:asset-fixture".to_string(),
            display_name: "UnrealEditor.exe".to_string(),
            process_state: "running".to_string(),
            source: "fixture".to_string(),
            owner_task_id: None,
            owner_phase: None,
            discovered_at: now,
            expires_at: now.saturating_add(DEFAULT_OBSERVATION_TTL_MILLIS),
        },
    );
    observation_registry().lock().unwrap().insert(
        session_id.clone(),
        ObservationSessionRecord {
            session_id: session_id.clone(),
            process_id,
            project_id: project_id.to_string(),
            root_id: trusted_root.root_id.clone(),
            uproject_display_path: "[project-root]/Game.uproject".to_string(),
            pid_hash,
            process_display_name: "UnrealEditor.exe".to_string(),
            source: "fixture".to_string(),
            mode: "attached".to_string(),
            status: "attached".to_string(),
            generation: next_observation_generation(),
            superseded_by_session_id: None,
            created_at: now,
            expires_at: now.saturating_add(DEFAULT_OBSERVATION_TTL_MILLIS),
            last_heartbeat_at: None,
        },
    );
    validate_asset_mutation_observation_at(&session_id, project_id, &trusted_root.root_id, now)
        .expect("asset mutation observation fixture must pass the production validator")
}

#[cfg(test)]
pub(crate) fn expire_asset_mutation_observation_fixture(session_id: &str, now: u64) {
    if let Some(session) = observation_registry().lock().unwrap().get_mut(session_id) {
        session.expires_at = now;
    }
}

#[cfg(test)]
pub(crate) fn remove_asset_mutation_process_fixture(session_id: &str) {
    let process_id = observation_registry()
        .lock()
        .unwrap()
        .get(session_id)
        .map(|session| session.process_id.clone());
    if let Some(process_id) = process_id {
        process_registry().lock().unwrap().remove(&process_id);
    }
}

#[cfg(test)]
pub(crate) fn mismatch_asset_mutation_pid_fixture(session_id: &str) {
    let process_id = observation_registry()
        .lock()
        .unwrap()
        .get(session_id)
        .map(|session| session.process_id.clone());
    if let Some(process_id) = process_id {
        if let Some(process) = process_registry().lock().unwrap().get_mut(&process_id) {
            process.pid_hash = "pid:asset-fixture:mismatch".to_string();
        }
    }
}

#[cfg(test)]
pub(crate) fn mismatch_asset_mutation_project_fixture(session_id: &str) {
    let process_id = observation_registry()
        .lock()
        .unwrap()
        .get(session_id)
        .map(|session| session.process_id.clone());
    if let Some(process_id) = process_id {
        if let Some(process) = process_registry().lock().unwrap().get_mut(&process_id) {
            process.project_id = "project:asset-fixture:mismatch".to_string();
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorObservationCapabilityStatus {
    pub enabled: bool,
    pub mode: String,
    pub reason: String,
    pub trusted_root_required: bool,
    pub launch_enabled: bool,
    pub save_all_blocked: bool,
    pub mutation_execution: String,
}

#[tauri::command]
pub fn editor_observation_capability_status() -> EditorObservationCapabilityStatus {
    EditorObservationCapabilityStatus {
        enabled: bridge_enabled(),
        mode: if bridge_enabled() {
            "native".to_string()
        } else {
            "disabled".to_string()
        },
        reason: if bridge_enabled() {
            "ue_editor_bridge_feature_enabled".to_string()
        } else {
            "feature_disabled".to_string()
        },
        trusted_root_required: true,
        launch_enabled: launch_enabled(),
        save_all_blocked: true,
        mutation_execution: "blocked".to_string(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorProcessConfigInput {
    pub project_id: String,
    pub root_ref: String,
    pub uproject_relative_path: String,
    pub editor_executable: Option<String>,
    pub args: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorProcessDescriptor {
    pub id: String,
    pub pid_hash: String,
    pub display_name: String,
    pub display_executable_hash: String,
    pub display_project_hint: String,
    pub process_state: String,
    pub source: String,
    pub discovered_at: u64,
    pub expires_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub managed_purpose: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_creation_filetime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub listener_instance_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owner_binding_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorProcessDiscoveryResult {
    pub status: String,
    pub reason: String,
    pub processes: Vec<EditorProcessDescriptor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedEditorProcessCreateInput {
    pub schema_version: String,
    pub purpose: String,
    pub task_id: String,
    pub phase: String,
    pub project_id: String,
    pub root_ref: String,
    pub uproject_relative_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedEditorProcessCreateResult {
    pub schema_version: String,
    pub status: String,
    pub reason: String,
    pub purpose: String,
    pub owner_task_id: String,
    pub owner_phase: String,
    pub process: Option<EditorProcessDescriptor>,
    pub process_pid: Option<u32>,
    pub process_creation_filetime: Option<String>,
    pub listener_instance_sha256: Option<String>,
    pub owner_binding_sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_receipt_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedEditorProcessTerminateInput {
    pub schema_version: String,
    pub purpose: String,
    pub task_id: String,
    pub phase: String,
    pub session_id: String,
    pub process_id: String,
    pub pid: u32,
    pub process_creation_filetime: String,
    pub listener_instance_sha256: String,
    pub owner_binding_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", untagged)]
pub enum ManagedEditorProcessTerminateCommandInput {
    Strict(ManagedEditorProcessTerminateInput),
    Legacy(EditorObservationSessionIdInput),
}

impl From<EditorObservationSessionIdInput> for ManagedEditorProcessTerminateCommandInput {
    fn from(value: EditorObservationSessionIdInput) -> Self {
        Self::Legacy(value)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedEditorProcessTerminateResult {
    pub schema_version: String,
    pub status: String,
    pub reason: String,
    pub purpose: String,
    pub owner_task_id: String,
    pub owner_phase: String,
    pub session_id: Option<String>,
    pub process_id: Option<String>,
    pub pid: Option<u32>,
    pub process_creation_filetime: Option<String>,
    pub pid_hash: Option<String>,
    pub observation_generation: Option<u64>,
    pub process_identity_sha256: Option<String>,
    pub listener_instance_sha256: Option<String>,
    pub owner_binding_sha256: Option<String>,
    pub exit_observed: bool,
    pub listener_closed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_receipt_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ManagedListenerAliveInput {
    task_id: String,
    phase: String,
    session_id: String,
    process_id: String,
    pid: u32,
    process_creation_filetime: String,
    listener_instance_sha256: String,
    owner_binding_sha256: String,
    stage: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ManagedEditorProcessReleaseInput {
    pub schema_version: String,
    pub task_id: String,
    pub phase: String,
    pub process_id: String,
    pub pid: u32,
    pub process_creation_filetime: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedEditorProcessReleaseResult {
    pub schema_version: String,
    pub status: String,
    pub reason: String,
    pub owner_task_id: String,
    pub owner_phase: String,
    pub process_id: String,
    pub pid: u32,
    pub process_creation_filetime: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_receipt_id: Option<String>,
}

fn managed_process_release_result(
    input: &ManagedEditorProcessReleaseInput,
    status: &str,
    reason: &str,
) -> ManagedEditorProcessReleaseResult {
    ManagedEditorProcessReleaseResult {
        schema_version: "uagent.mvp15d.managed-editor-process-release-result.v2".to_string(),
        status: status.to_string(),
        reason: reason.to_string(),
        owner_task_id: input.task_id.clone(),
        owner_phase: input.phase.clone(),
        process_id: input.process_id.clone(),
        pid: input.pid,
        process_creation_filetime: input.process_creation_filetime.clone(),
        native_receipt_id: None,
    }
}

fn observed_managed_process_release_result(
    input: &ManagedEditorProcessReleaseInput,
    status: &str,
    reason: &str,
) -> Result<ManagedEditorProcessReleaseResult, String> {
    let mut result = managed_process_release_result(input, status, reason);
    result.native_receipt_id = crate::mvp15d_runtime_bridge::issue_native_observation_receipt(
        "release_managed_editor_process",
        serde_json::to_value(input).map_err(|error| error.to_string())?,
        serde_json::to_value(&result).map_err(|error| error.to_string())?,
    );
    Ok(result)
}

#[tauri::command]
pub fn create_managed_editor_process(
    input: ManagedEditorProcessCreateInput,
) -> Result<ManagedEditorProcessCreateResult, String> {
    if input.schema_version != MANAGED_CREATE_SCHEMA {
        return Ok(blocked_managed_create_result(
            &input,
            "managed_process_create_schema_invalid",
        ));
    }
    crate::mvp15d_runtime_bridge::validate_managed_process_owner(&input.task_id, &input.phase)
        .map_err(str::to_string)?;
    if managed_child_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable".to_string())?
        .values()
        .any(|record| {
            record.owner_task_id == input.task_id
                && record.owner_phase == input.phase
                && record.purpose == input.purpose
        })
    {
        return Ok(blocked_managed_create_result(
            &input,
            "managed_phase_owner_already_exists",
        ));
    }
    if input.purpose == PHASE_LISTENER_OWNER {
        if std::env::var("UAGENT_ENABLE_UE_EDITOR_BRIDGE").as_deref() != Ok("1")
            || !launch_enabled()
            || std::env::var("UAGENT_MVP15D_UE_ROOT")
                .map(|value| value.trim().is_empty())
                .unwrap_or(true)
        {
            return Ok(blocked_managed_create_result(
                &input,
                "managed_phase_owner_gate_disabled",
            ));
        }
        return create_managed_phase_listener_owner(input);
    }
    if input.purpose != NEGATIVE_CASE_FIXTURE || input.phase != "ui-lifecycle" {
        return Ok(blocked_managed_create_result(
            &input,
            "managed_process_purpose_invalid",
        ));
    }
    let executable = std::env::current_exe().map_err(|_| "managed_process_spawn_failed")?;
    let mut command = Command::new(executable);
    command
        .env("UAGENT_MVP15D_MANAGED_EDITOR_FIXTURE", "1")
        .env(
            "UAGENT_MVP15D_MANAGED_PARENT_PID",
            std::process::id().to_string(),
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    create_managed_editor_process_with_command(input, command)
}

fn create_managed_editor_process_with_command(
    input: ManagedEditorProcessCreateInput,
    mut command: Command,
) -> Result<ManagedEditorProcessCreateResult, String> {
    let validation = validate_config_details(EditorProcessConfigInput {
        project_id: input.project_id.clone(),
        root_ref: input.root_ref.clone(),
        uproject_relative_path: input.uproject_relative_path.clone(),
        editor_executable: None,
        args: None,
    })
    .map_err(|result| result.reason)?;
    let request = serde_json::to_value(&input).map_err(|error| error.to_string())?;
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let mut child = command
        .spawn()
        .map_err(|_| "managed_process_spawn_failed".to_string())?;
    let pid = child.id();
    let process_start_time = match observe_process_start_time(pid) {
        Some(value) => value,
        None => {
            drop(child.stdin.take());
            let _ = child.wait();
            return Err("managed_process_identity_unavailable".to_string());
        }
    };
    let now = now_millis();
    let process_id = format!(
        "process:managed:{}",
        stable_hash(&format!(
            "{}:{}:{}:{}:{}",
            input.task_id, input.phase, input.project_id, pid, process_start_time
        ))
    );
    let pid_hash = format!(
        "pid:{}",
        stable_hash(&format!("{}:{}", pid, process_start_time))
    );
    let record = DiscoveredProcessRecord {
        process_id: process_id.clone(),
        pid_hash,
        pid: Some(pid),
        process_start_time: Some(process_start_time),
        project_id: input.project_id,
        root_id: validation.root_id,
        uproject_display_path: validation.uproject_display_path.clone(),
        canonical_root: validation.canonical_root,
        canonical_uproject: validation.canonical_uproject,
        display_project_hint: validation.uproject_display_path,
        display_executable_hash: format!("exe:{}", stable_hash("uagent-managed-editor-fixture")),
        display_name: "UAgentManagedEditorFixture.exe".to_string(),
        process_state: "running".to_string(),
        source: "managed".to_string(),
        owner_task_id: Some(input.task_id.clone()),
        owner_phase: Some(input.phase.clone()),
        discovered_at: now,
        expires_at: now + DEFAULT_OBSERVATION_TTL_MILLIS,
    };
    managed_child_registry().lock().unwrap().insert(
        process_id.clone(),
        ManagedChildRecord {
            child,
            purpose: input.purpose.clone(),
            owner_task_id: input.task_id.clone(),
            owner_phase: input.phase.clone(),
            pid,
            process_start_time,
            guardian_pid: pid,
            guardian_process_start_time: process_start_time,
            listener_port: None,
            listener_instance_sha256: None,
            owner_binding_sha256: None,
        },
    );
    process_registry()
        .lock()
        .unwrap()
        .insert(process_id, record.clone());
    let mut result = ManagedEditorProcessCreateResult {
        schema_version: MANAGED_CREATE_RESULT_SCHEMA.to_string(),
        status: "created".to_string(),
        reason: "task_owned_process_started".to_string(),
        purpose: input.purpose.clone(),
        owner_task_id: input.task_id,
        owner_phase: input.phase,
        process: Some(descriptor_from_record(&record)),
        process_pid: Some(pid),
        process_creation_filetime: Some(process_start_time.to_string()),
        listener_instance_sha256: None,
        owner_binding_sha256: None,
        native_receipt_id: None,
    };
    result.native_receipt_id = crate::mvp15d_runtime_bridge::issue_native_observation_receipt(
        "create_managed_editor_process",
        request,
        serde_json::to_value(&result).map_err(|error| error.to_string())?,
    );
    Ok(result)
}

fn blocked_managed_create_result(
    input: &ManagedEditorProcessCreateInput,
    reason: &str,
) -> ManagedEditorProcessCreateResult {
    ManagedEditorProcessCreateResult {
        schema_version: MANAGED_CREATE_RESULT_SCHEMA.to_string(),
        status: "blocked".to_string(),
        reason: reason.to_string(),
        purpose: input.purpose.clone(),
        owner_task_id: input.task_id.clone(),
        owner_phase: input.phase.clone(),
        process: None,
        process_pid: None,
        process_creation_filetime: None,
        listener_instance_sha256: None,
        owner_binding_sha256: None,
        native_receipt_id: None,
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ManagedGuardianReady {
    schema_version: String,
    pid: u32,
    process_creation_filetime: u64,
    port: u16,
}

fn create_managed_phase_listener_owner(
    input: ManagedEditorProcessCreateInput,
) -> Result<ManagedEditorProcessCreateResult, String> {
    let context =
        crate::mvp15d_runtime_bridge::managed_process_owner_context(&input.task_id, &input.phase)
            .map_err(str::to_string)?;
    let validation = validate_config_details(EditorProcessConfigInput {
        project_id: input.project_id.clone(),
        root_ref: input.root_ref.clone(),
        uproject_relative_path: input.uproject_relative_path.clone(),
        editor_executable: None,
        args: None,
    })
    .map_err(|result| result.reason)?;
    let canonical_uproject = validation
        .canonical_uproject
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| "managed_process_project_identity_unavailable".to_string())?;
    if !canonical_uproject.is_file() || context.port == 0 {
        return Ok(blocked_managed_create_result(
            &input,
            "managed_process_project_identity_unavailable",
        ));
    }
    let test_listener =
        cfg!(test) && std::env::var(GUARDIAN_TEST_LISTENER_ENV).as_deref() == Ok("1");
    let ue_executable = if test_listener {
        std::env::current_exe().map_err(|_| "managed_process_spawn_failed")?
    } else {
        resolve_managed_ue_executable()?
    };
    let evidence_root = std::fs::canonicalize(&context.evidence_root)
        .map_err(|_| "managed_process_evidence_root_invalid".to_string())?;
    let ddc_root = evidence_root.join("managed-ue-ddc").join(&input.phase);
    std::fs::create_dir_all(&ddc_root)
        .map_err(|_| "managed_process_ddc_create_failed".to_string())?;
    let ddc_root = std::fs::canonicalize(&ddc_root)
        .map_err(|_| "managed_process_ddc_create_failed".to_string())?;
    if !ddc_root.starts_with(&evidence_root) {
        return Err("managed_process_ddc_outside_task_root".to_string());
    }

    let mut command = Command::new(
        std::env::current_exe().map_err(|_| "managed_process_spawn_failed".to_string())?,
    );
    command
        .env(GUARDIAN_ENV, "1")
        .env(GUARDIAN_UE_EXECUTABLE_ENV, &ue_executable)
        .env(GUARDIAN_UPROJECT_ENV, &canonical_uproject)
        .env(GUARDIAN_PORT_ENV, context.port.to_string())
        .env(GUARDIAN_MARKER_ENV, &context.marker)
        .env(GUARDIAN_TASK_ENV, &context.task_id)
        .env(GUARDIAN_PHASE_ENV, &context.phase)
        .env(GUARDIAN_DDC_ENV, &ddc_root)
        .env(GUARDIAN_EVIDENCE_ROOT_ENV, &evidence_root)
        .env(
            GUARDIAN_TEST_LISTENER_ENV,
            if test_listener { "1" } else { "0" },
        )
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let request = serde_json::to_value(&input).map_err(|error| error.to_string())?;
    let mut guardian = match command.spawn() {
        Ok(guardian) => guardian,
        Err(_) => {
            let _ = cleanup_task_owned_ddc(&evidence_root, &ddc_root, &input.phase);
            return Err("managed_process_spawn_failed".to_string());
        }
    };
    let guardian_pid = guardian.id();
    let guardian_process_start_time = match observe_process_start_time(guardian_pid) {
        Some(value) => value,
        None => {
            cleanup_guardian_after_create_failure(&mut guardian);
            let _ = cleanup_task_owned_ddc(&evidence_root, &ddc_root, &input.phase);
            return Err("managed_process_guardian_identity_unavailable".to_string());
        }
    };
    let stdout = match guardian.stdout.take() {
        Some(stdout) => stdout,
        None => {
            cleanup_phase_owner_create_failure(
                &mut guardian,
                &evidence_root,
                &ddc_root,
                &input.phase,
            );
            return Err("managed_process_guardian_channel_unavailable".to_string());
        }
    };
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    std::thread::spawn(move || {
        let mut line = String::new();
        let result = BufReader::new(stdout).read_line(&mut line).map(|_| line);
        let _ = sender.send(result);
    });
    let ready = match receiver.recv_timeout(Duration::from_secs(120)) {
        Ok(Ok(ready)) => ready,
        Ok(Err(_)) => {
            cleanup_phase_owner_create_failure(
                &mut guardian,
                &evidence_root,
                &ddc_root,
                &input.phase,
            );
            return Err("managed_process_guardian_channel_unavailable".to_string());
        }
        Err(_) => {
            cleanup_phase_owner_create_failure(
                &mut guardian,
                &evidence_root,
                &ddc_root,
                &input.phase,
            );
            return Err("managed_process_guardian_ready_timeout".to_string());
        }
    };
    let ready: ManagedGuardianReady = match serde_json::from_str(ready.trim()) {
        Ok(ready) => ready,
        Err(_) => {
            cleanup_phase_owner_create_failure(
                &mut guardian,
                &evidence_root,
                &ddc_root,
                &input.phase,
            );
            return Err("managed_process_guardian_ready_invalid".to_string());
        }
    };
    if ready.schema_version != "uagent.mvp15d.managed-editor-guardian-ready.v1"
        || ready.port != context.port
        || observe_process_start_time(ready.pid) != Some(ready.process_creation_filetime)
        || !loopback_port_accepting(ready.port)
        || !listener_owned_by_process(ready.port, ready.pid)
    {
        cleanup_guardian_after_create_failure(&mut guardian);
        let _ = cleanup_task_owned_ddc(&evidence_root, &ddc_root, &input.phase);
        return Err("managed_process_guardian_ready_invalid".to_string());
    }
    let listener_instance_sha256 = sha256_binding(&[
        "managed-listener-v1",
        &context.task_id,
        &context.phase,
        &context.session,
        &context.generation.to_string(),
        &context.marker,
        &ready.pid.to_string(),
        &ready.process_creation_filetime.to_string(),
        &ready.port.to_string(),
    ]);
    let owner_binding_sha256 = sha256_binding(&[
        "managed-owner-v1",
        &context.task_id,
        &context.phase,
        &context.session,
        &context.generation.to_string(),
        &context.runtime_process_identity_sha256,
        &context.nonce_sha256,
        &input.project_id,
        &validation.root_id,
        &listener_instance_sha256,
    ]);
    let process_id = format!(
        "process:managed:{}",
        sha256_binding(&[
            &input.task_id,
            &input.phase,
            &input.project_id,
            &ready.pid.to_string(),
            &ready.process_creation_filetime.to_string(),
            &listener_instance_sha256,
        ])
    );
    let pid_hash = format!(
        "pid:{}",
        sha256_binding(&[
            &validation.root_id,
            &ready.pid.to_string(),
            &ready.process_creation_filetime.to_string(),
        ])
    );
    let now = now_millis();
    let record = DiscoveredProcessRecord {
        process_id: process_id.clone(),
        pid_hash,
        pid: Some(ready.pid),
        process_start_time: Some(ready.process_creation_filetime),
        project_id: input.project_id.clone(),
        root_id: validation.root_id,
        uproject_display_path: validation.uproject_display_path.clone(),
        canonical_root: validation.canonical_root,
        canonical_uproject: validation.canonical_uproject,
        display_project_hint: validation.uproject_display_path,
        display_executable_hash: format!(
            "exe:{}",
            sha256_binding(&[&ue_executable.to_string_lossy()])
        ),
        display_name: "UnrealEditor-Cmd.exe".to_string(),
        process_state: "running".to_string(),
        source: "managed".to_string(),
        owner_task_id: Some(input.task_id.clone()),
        owner_phase: Some(input.phase.clone()),
        discovered_at: now,
        expires_at: now + DEFAULT_OBSERVATION_TTL_MILLIS,
    };
    let mut managed_registry = match managed_child_registry().lock() {
        Ok(registry) => registry,
        Err(_) => {
            cleanup_phase_owner_create_failure(
                &mut guardian,
                &evidence_root,
                &ddc_root,
                &input.phase,
            );
            return Err("native_authority_unavailable".to_string());
        }
    };
    let mut process_registry = match process_registry().lock() {
        Ok(registry) => registry,
        Err(_) => {
            drop(managed_registry);
            cleanup_phase_owner_create_failure(
                &mut guardian,
                &evidence_root,
                &ddc_root,
                &input.phase,
            );
            return Err("native_authority_unavailable".to_string());
        }
    };
    managed_registry.insert(
        process_id.clone(),
        ManagedChildRecord {
            child: guardian,
            purpose: input.purpose.clone(),
            owner_task_id: input.task_id.clone(),
            owner_phase: input.phase.clone(),
            pid: ready.pid,
            process_start_time: ready.process_creation_filetime,
            guardian_pid,
            guardian_process_start_time,
            listener_port: Some(ready.port),
            listener_instance_sha256: Some(listener_instance_sha256.clone()),
            owner_binding_sha256: Some(owner_binding_sha256.clone()),
        },
    );
    process_registry.insert(process_id, record.clone());
    drop(process_registry);
    drop(managed_registry);
    let mut result = ManagedEditorProcessCreateResult {
        schema_version: MANAGED_CREATE_RESULT_SCHEMA.to_string(),
        status: "ready".to_string(),
        reason: "task_owned_listener_accepting".to_string(),
        purpose: input.purpose,
        owner_task_id: input.task_id,
        owner_phase: input.phase,
        process: Some(descriptor_from_record(&record)),
        process_pid: Some(ready.pid),
        process_creation_filetime: Some(ready.process_creation_filetime.to_string()),
        listener_instance_sha256: Some(listener_instance_sha256),
        owner_binding_sha256: Some(owner_binding_sha256),
        native_receipt_id: None,
    };
    result.native_receipt_id = crate::mvp15d_runtime_bridge::issue_native_observation_receipt(
        "create_managed_editor_process",
        request,
        serde_json::to_value(&result).map_err(|error| error.to_string())?,
    );
    Ok(result)
}

fn resolve_managed_ue_executable() -> Result<PathBuf, String> {
    let root = std::env::var_os("UAGENT_MVP15D_UE_ROOT")
        .map(PathBuf::from)
        .ok_or_else(|| "managed_process_ue_root_required".to_string())?;
    let root =
        std::fs::canonicalize(root).map_err(|_| "managed_process_ue_root_invalid".to_string())?;
    let executable = if root.is_file() {
        root
    } else {
        root.join("Engine")
            .join("Binaries")
            .join("Win64")
            .join("UnrealEditor-Cmd.exe")
    };
    let executable = std::fs::canonicalize(executable)
        .map_err(|_| "managed_process_ue_executable_missing".to_string())?;
    if !executable.is_file()
        || executable
            .file_name()
            .and_then(|value| value.to_str())
            .is_none_or(|value| !value.eq_ignore_ascii_case("UnrealEditor-Cmd.exe"))
    {
        return Err("managed_process_ue_executable_invalid".to_string());
    }
    Ok(executable)
}

fn cleanup_guardian_after_create_failure(guardian: &mut Child) {
    drop(guardian.stdin.take());
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        match guardian.try_wait() {
            Ok(Some(_)) => return,
            _ if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            _ => break,
        }
    }
    let _ = guardian.kill();
    let _ = guardian.wait();
}

fn cleanup_phase_owner_create_failure(
    guardian: &mut Child,
    evidence_root: &Path,
    ddc_root: &Path,
    phase: &str,
) {
    cleanup_guardian_after_create_failure(guardian);
    let _ = cleanup_task_owned_ddc(evidence_root, ddc_root, phase);
}

fn cleanup_task_owned_ddc(
    evidence_root: &Path,
    ddc_root: &Path,
    phase: &str,
) -> Result<(), String> {
    if !matches!(phase, "product-capture" | "ui-lifecycle") {
        return Err("managed_process_ddc_identity_invalid".to_string());
    }
    let evidence_root = std::fs::canonicalize(evidence_root)
        .map_err(|_| "managed_process_ddc_identity_invalid".to_string())?;
    let expected = evidence_root.join("managed-ue-ddc").join(phase);
    if ddc_root.exists() {
        let metadata = std::fs::symlink_metadata(ddc_root)
            .map_err(|_| "managed_process_ddc_identity_invalid".to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("managed_process_ddc_identity_invalid".to_string());
        }
        let canonical_ddc = std::fs::canonicalize(ddc_root)
            .map_err(|_| "managed_process_ddc_identity_invalid".to_string())?;
        let canonical_expected = std::fs::canonicalize(&expected)
            .map_err(|_| "managed_process_ddc_identity_invalid".to_string())?;
        if canonical_ddc != canonical_expected || !canonical_ddc.starts_with(&evidence_root) {
            return Err("managed_process_ddc_identity_invalid".to_string());
        }
        std::fs::remove_dir_all(&canonical_ddc)
            .map_err(|_| "managed_process_ddc_cleanup_failed".to_string())?;
    } else if ddc_root != expected {
        return Err("managed_process_ddc_identity_invalid".to_string());
    }
    if ddc_root.exists() {
        return Err("managed_process_ddc_cleanup_failed".to_string());
    }
    let parent = evidence_root.join("managed-ue-ddc");
    match std::fs::remove_dir(&parent) {
        Ok(()) => {}
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::DirectoryNotEmpty
            ) => {}
        Err(_) => return Err("managed_process_ddc_cleanup_failed".to_string()),
    }
    Ok(())
}

struct TaskOwnedDdcCleanup {
    evidence_root: PathBuf,
    ddc_root: PathBuf,
    phase: String,
    active: bool,
}

impl TaskOwnedDdcCleanup {
    fn cleanup(&mut self) -> Result<(), String> {
        cleanup_task_owned_ddc(&self.evidence_root, &self.ddc_root, &self.phase)?;
        self.active = false;
        Ok(())
    }
}

impl Drop for TaskOwnedDdcCleanup {
    fn drop(&mut self) {
        if self.active {
            let _ = cleanup_task_owned_ddc(&self.evidence_root, &self.ddc_root, &self.phase);
        }
    }
}

struct GuardianEditorChild(Child);

impl std::ops::Deref for GuardianEditorChild {
    type Target = Child;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl std::ops::DerefMut for GuardianEditorChild {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

impl Drop for GuardianEditorChild {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
        }
        let _ = self.0.wait();
    }
}

fn run_managed_editor_guardian() -> Result<(), String> {
    let executable = PathBuf::from(
        std::env::var_os(GUARDIAN_UE_EXECUTABLE_ENV)
            .ok_or_else(|| "managed_guardian_environment_invalid".to_string())?,
    );
    let uproject = PathBuf::from(
        std::env::var_os(GUARDIAN_UPROJECT_ENV)
            .ok_or_else(|| "managed_guardian_environment_invalid".to_string())?,
    );
    let port = std::env::var(GUARDIAN_PORT_ENV)
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| "managed_guardian_environment_invalid".to_string())?;
    let marker = std::env::var(GUARDIAN_MARKER_ENV)
        .map_err(|_| "managed_guardian_environment_invalid".to_string())?;
    let task_id = std::env::var(GUARDIAN_TASK_ENV)
        .map_err(|_| "managed_guardian_environment_invalid".to_string())?;
    let phase = std::env::var(GUARDIAN_PHASE_ENV)
        .map_err(|_| "managed_guardian_environment_invalid".to_string())?;
    let ddc = PathBuf::from(
        std::env::var_os(GUARDIAN_DDC_ENV)
            .ok_or_else(|| "managed_guardian_environment_invalid".to_string())?,
    );
    let evidence_root = PathBuf::from(
        std::env::var_os(GUARDIAN_EVIDENCE_ROOT_ENV)
            .ok_or_else(|| "managed_guardian_environment_invalid".to_string())?,
    );
    if marker.is_empty()
        || task_id.is_empty()
        || !matches!(phase.as_str(), "product-capture" | "ui-lifecycle")
        || !uproject.is_file()
        || !ddc.is_dir()
        || !evidence_root.is_dir()
    {
        return Err("managed_guardian_environment_invalid".to_string());
    }
    let evidence_root = std::fs::canonicalize(evidence_root)
        .map_err(|_| "managed_guardian_environment_invalid".to_string())?;
    let ddc = std::fs::canonicalize(ddc)
        .map_err(|_| "managed_guardian_environment_invalid".to_string())?;
    if ddc != evidence_root.join("managed-ue-ddc").join(&phase) || !ddc.starts_with(&evidence_root)
    {
        return Err("managed_guardian_environment_invalid".to_string());
    }
    let mut ddc_cleanup = TaskOwnedDdcCleanup {
        evidence_root,
        ddc_root: ddc.clone(),
        phase: phase.clone(),
        active: true,
    };
    let test_listener = std::env::var(GUARDIAN_TEST_LISTENER_ENV).as_deref() == Ok("1");
    let mut command = if test_listener {
        #[cfg(test)]
        {
            let mut command = Command::new("powershell.exe");
            let script = format!(
                "$listener=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,{port});$listener.Start();while($true){{$client=$listener.AcceptTcpClient();$client.Close()}}"
            );
            command
                .args(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"])
                .arg(script);
            command
        }
        #[cfg(not(test))]
        {
            let mut command = Command::new(
                std::env::current_exe().map_err(|_| "managed_guardian_spawn_failed".to_string())?,
            );
            command
                .env(GUARDIAN_TEST_LISTENER_CHILD_ENV, "1")
                .env(GUARDIAN_PORT_ENV, port.to_string());
            command
        }
    } else {
        let mut command = Command::new(&executable);
        command
            .args(managed_editor_headless_arguments(
                &uproject, &ddc, port, &marker,
            ))
            .env("UE-LocalDataCachePath", &ddc)
            .env("UE-SharedDataCachePath", "None");
        command
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut editor = GuardianEditorChild(
        command
            .spawn()
            .map_err(|_| "managed_guardian_spawn_failed".to_string())?,
    );
    let pid = editor.id();
    let creation = observe_process_start_time(pid)
        .ok_or_else(|| "managed_guardian_process_identity_unavailable".to_string())?;
    let ready_deadline = Instant::now() + Duration::from_secs(120);
    while Instant::now() < ready_deadline {
        if editor
            .try_wait()
            .map_err(|_| "managed_guardian_process_wait_failed".to_string())?
            .is_some()
        {
            return Err("managed_guardian_process_exited_early".to_string());
        }
        if observe_process_start_time(pid) == Some(creation)
            && loopback_port_accepting(port)
            && listener_owned_by_process(port, pid)
        {
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    if !loopback_port_accepting(port) || !listener_owned_by_process(port, pid) {
        let _ = editor.kill();
        let _ = editor.wait();
        return Err("managed_guardian_listener_not_ready".to_string());
    }
    let ready = ManagedGuardianReady {
        schema_version: "uagent.mvp15d.managed-editor-guardian-ready.v1".to_string(),
        pid,
        process_creation_filetime: creation,
        port,
    };
    serde_json::to_writer(std::io::stdout(), &ready)
        .map_err(|_| "managed_guardian_ready_write_failed".to_string())?;
    std::io::stdout()
        .write_all(b"\n")
        .map_err(|_| "managed_guardian_ready_write_failed".to_string())?;
    std::io::stdout()
        .flush()
        .map_err(|_| "managed_guardian_ready_write_failed".to_string())?;
    #[cfg(test)]
    std::thread::sleep(Duration::from_millis(100));
    #[cfg(not(test))]
    {
        let mut lease = Vec::new();
        let _ = std::io::stdin().read_to_end(&mut lease);
    }
    let _ = editor.kill();
    let _ = editor.wait();
    let close_deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < close_deadline {
        if !listener_owned_by_process(port, pid) && !loopback_port_accepting(port) {
            ddc_cleanup.cleanup()?;
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    Err("managed_guardian_closeout_failed".to_string())
}

fn managed_editor_headless_arguments(
    uproject: &Path,
    ddc: &Path,
    port: u16,
    marker: &str,
) -> Vec<OsString> {
    vec![
        uproject.as_os_str().to_os_string(),
        OsString::from("-Unattended"),
        OsString::from("-NoSplash"),
        OsString::from("-NullRHI"),
        OsString::from("-NoSound"),
        OsString::from("-ddc=noshared"),
        OsString::from(format!("-LocalDataCachePath={}", ddc.to_string_lossy())),
        OsString::from("-ModelContextProtocolStartServer"),
        OsString::from(format!("-ModelContextProtocolPort={port}")),
        OsString::from(format!("-UAgentTaskMarker={marker}")),
    ]
}

fn run_guardian_test_listener_child() -> Result<(), String> {
    let port = std::env::var(GUARDIAN_PORT_ENV)
        .ok()
        .and_then(|value| value.parse::<u16>().ok())
        .filter(|value| *value > 0)
        .ok_or_else(|| "managed_guardian_test_port_invalid".to_string())?;
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .map_err(|_| "managed_guardian_test_bind_failed".to_string())?;
    loop {
        let _ = listener.accept();
    }
}

fn sha256_binding(parts: &[&str]) -> String {
    let mut hash = Sha256::new();
    for part in parts {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    format!("{:x}", hash.finalize())
}

fn loopback_port_accepting(port: u16) -> bool {
    TcpStream::connect_timeout(
        &std::net::SocketAddr::V4(SocketAddrV4::new(std::net::Ipv4Addr::LOCALHOST, port)),
        Duration::from_millis(250),
    )
    .is_ok()
}

#[cfg(test)]
pub(crate) fn create_managed_editor_process_fixture(
    input: ManagedEditorProcessCreateInput,
    command: Command,
) -> Result<ManagedEditorProcessCreateResult, String> {
    create_managed_editor_process_with_command(input, command)
}

#[tauri::command]
pub fn release_managed_editor_process(
    input: ManagedEditorProcessReleaseInput,
) -> Result<ManagedEditorProcessReleaseResult, String> {
    if input.schema_version != "uagent.mvp15d.managed-editor-process-release.v2" {
        return observed_managed_process_release_result(
            &input,
            "blocked",
            "managed_process_release_schema_invalid",
        );
    }
    let Some(process_creation_filetime) =
        parse_canonical_process_creation_filetime(&input.process_creation_filetime)
    else {
        return observed_managed_process_release_result(
            &input,
            "blocked",
            "managed_process_creation_filetime_invalid",
        );
    };
    if let Err(reason) =
        crate::mvp15d_runtime_bridge::validate_managed_process_owner(&input.task_id, &input.phase)
    {
        return observed_managed_process_release_result(&input, "blocked", reason);
    }
    if released_managed_process_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable".to_string())?
        .contains(&input.process_id)
    {
        return observed_managed_process_release_result(
            &input,
            "blocked",
            "managed_process_release_replay",
        );
    }

    let process = process_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable".to_string())?
        .get(&input.process_id)
        .cloned();
    let Some(process) = process else {
        return observed_managed_process_release_result(
            &input,
            "blocked",
            "managed_process_unknown",
        );
    };
    if process.source != "managed" {
        return observed_managed_process_release_result(&input, "blocked", "process_not_managed");
    }
    if process.owner_task_id.as_deref() != Some(input.task_id.as_str())
        || process.owner_phase.as_deref() != Some(input.phase.as_str())
    {
        return observed_managed_process_release_result(
            &input,
            "blocked",
            "managed_process_owner_mismatch",
        );
    }
    if process.pid != Some(input.pid)
        || process.process_start_time != Some(process_creation_filetime)
    {
        return observed_managed_process_release_result(
            &input,
            "blocked",
            "managed_process_identity_mismatch",
        );
    }

    let managed = managed_child_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable".to_string())?
        .remove(&input.process_id);
    let Some(mut managed) = managed else {
        return observed_managed_process_release_result(&input, "blocked", "process_not_managed");
    };
    if managed.purpose != NEGATIVE_CASE_FIXTURE
        || managed.owner_task_id != input.task_id
        || managed.owner_phase != input.phase
        || managed.pid != input.pid
        || managed.process_start_time != process_creation_filetime
    {
        let reason = if managed.purpose != NEGATIVE_CASE_FIXTURE {
            "managed_process_strict_termination_required"
        } else {
            "managed_process_identity_mismatch"
        };
        managed_child_registry()
            .lock()
            .map_err(|_| "native_authority_unavailable".to_string())?
            .insert(input.process_id.clone(), managed);
        return observed_managed_process_release_result(&input, "blocked", reason);
    }
    drop(managed.child.stdin.take());
    if managed.child.wait().is_err() {
        managed_child_registry()
            .lock()
            .map_err(|_| "native_authority_unavailable".to_string())?
            .insert(input.process_id.clone(), managed);
        return observed_managed_process_release_result(
            &input,
            "failed",
            "managed_process_release_failed",
        );
    }
    process_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable".to_string())?
        .remove(&input.process_id);
    observation_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable".to_string())?
        .retain(|_, session| session.process_id != input.process_id);
    released_managed_process_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable".to_string())?
        .insert(input.process_id.clone());
    observed_managed_process_release_result(&input, "released", "task_owned_process_released")
}

#[cfg(test)]
pub(crate) fn managed_process_count_for_test() -> usize {
    managed_child_registry().lock().unwrap().len()
}

#[cfg(test)]
pub(crate) fn managed_process_registry_counts_for_test() -> (usize, usize, usize) {
    let active_process_ids = process_registry()
        .lock()
        .unwrap()
        .values()
        .filter(|process| process.source == "managed" && process.process_state == "running")
        .map(|process| process.process_id.clone())
        .collect::<HashSet<_>>();
    (
        managed_child_registry().lock().unwrap().len(),
        active_process_ids.len(),
        observation_registry()
            .lock()
            .unwrap()
            .values()
            .filter(|session| {
                session.source == "managed"
                    && session.status == "attached"
                    && active_process_ids.contains(&session.process_id)
            })
            .count(),
    )
}

#[cfg(test)]
pub(crate) fn mark_managed_process_external_for_test(process_id: &str) {
    let mut registry = process_registry().lock().unwrap();
    let record = registry.get_mut(process_id).unwrap();
    record.source = "native".to_string();
    record.owner_task_id = None;
    record.owner_phase = None;
}

pub fn run_managed_editor_process_fixture_from_environment() -> bool {
    if std::env::var(GUARDIAN_TEST_LISTENER_CHILD_ENV).as_deref() == Ok("1") {
        if let Err(error) = run_guardian_test_listener_child() {
            eprintln!("{error}");
            std::process::exit(2);
        }
        return true;
    }
    if std::env::var(GUARDIAN_ENV).as_deref() == Ok("1") {
        if let Err(error) = run_managed_editor_guardian() {
            eprintln!("{error}");
            std::process::exit(2);
        }
        return true;
    }
    if std::env::var("UAGENT_MVP15D_MANAGED_EDITOR_FIXTURE").as_deref() != Ok("1") {
        return false;
    }
    let mut sink = Vec::new();
    let _ = std::io::Read::read_to_end(&mut std::io::stdin(), &mut sink);
    true
}

#[tauri::command]
pub fn discover_editor_processes(
    input: EditorProcessConfigInput,
) -> Result<EditorProcessDiscoveryResult, String> {
    if !bridge_enabled() {
        return Ok(blocked_discovery("feature_disabled"));
    }
    let validation = match validate_config_details(input.clone()) {
        Ok(validation) => validation,
        Err(validation) => return Ok(blocked_discovery(&validation.reason)),
    };
    let current_owner = crate::mvp15d_runtime_bridge::current_managed_process_owner_identity();
    let managed_phase_owner = {
        let managed = managed_child_registry()
            .lock()
            .map_err(|_| "native_authority_unavailable".to_string())?;
        let processes = process_registry()
            .lock()
            .map_err(|_| "native_authority_unavailable".to_string())?;
        managed
            .iter()
            .filter(|(_, owner)| {
                owner.purpose == PHASE_LISTENER_OWNER
                    && current_owner.as_ref().is_some_and(|(task_id, phase)| {
                        owner.owner_task_id == *task_id && owner.owner_phase == *phase
                    })
            })
            .filter_map(|(process_id, _)| processes.get(process_id))
            .find(|process| {
                process.project_id == input.project_id
                    && process.root_id == validation.root_id
                    && process.uproject_display_path == validation.uproject_display_path
                    && check_managed_record_current(process).alive
            })
            .cloned()
    };
    if let Some(record) = managed_phase_owner {
        return Ok(EditorProcessDiscoveryResult {
            status: "ready".to_string(),
            reason: "task_owned_managed_process_matched".to_string(),
            processes: vec![descriptor_from_record(&record)],
        });
    }
    if !validation.fixture {
        let candidates = match enumerate_native_processes() {
            Ok(candidates) => candidates,
            Err(reason) => return Ok(degraded_discovery(&reason)),
        };
        let built =
            build_native_discovery_from_candidates(&input, &validation, &candidates, now_millis());
        if !built.records.is_empty() {
            let mut registry = process_registry().lock().unwrap();
            for record in &built.records {
                registry.insert(record.process_id.clone(), record.clone());
            }
        }
        return Ok(built.result);
    }
    let now = now_millis();
    let root_id = validation.root_id.clone();
    let uproject_display_path = validation.uproject_display_path.clone();
    let process_id = format!(
        "process:{}",
        stable_hash(&format!(
            "{}:{}:{}",
            input.project_id, root_id, uproject_display_path
        ))
    );
    let pid_hash = format!(
        "pid:{}",
        stable_hash(&format!("{}:{}", input.project_id, process_id))
    );
    let source = "fixture".to_string();
    let expires_at = now + DEFAULT_OBSERVATION_TTL_MILLIS;
    let record = DiscoveredProcessRecord {
        process_id,
        pid_hash,
        pid: None,
        process_start_time: None,
        project_id: input.project_id,
        root_id,
        uproject_display_path: uproject_display_path.clone(),
        canonical_root: None,
        canonical_uproject: None,
        display_project_hint: uproject_display_path,
        display_executable_hash: "exe:unreal-editor".to_string(),
        display_name: "UnrealEditor.exe".to_string(),
        process_state: "running".to_string(),
        source,
        owner_task_id: None,
        owner_phase: None,
        discovered_at: now,
        expires_at,
    };
    process_registry()
        .lock()
        .unwrap()
        .insert(record.process_id.clone(), record.clone());
    Ok(EditorProcessDiscoveryResult {
        status: "ready".to_string(),
        reason: "fixture_or_native_metadata".to_string(),
        processes: vec![descriptor_from_record(&record)],
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorAttachValidationResult {
    pub ok: bool,
    pub reason: String,
    pub root_id: Option<String>,
    pub display_root: String,
    pub uproject_display_path: Option<String>,
}

#[tauri::command]
pub fn validate_editor_attach_config(
    input: EditorProcessConfigInput,
) -> Result<EditorAttachValidationResult, String> {
    Ok(validate_config(input))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorAttachInput {
    pub project_id: String,
    pub root_ref: String,
    pub uproject_relative_path: String,
    pub process_id: String,
    pub pid_hash: String,
    pub process_display_name: String,
    pub mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorObservationSessionResult {
    pub session_id: Option<String>,
    pub process_id: Option<String>,
    pub project_id: String,
    pub root_id: Option<String>,
    pub uproject_display_path: Option<String>,
    pub pid_hash: Option<String>,
    pub process_display_name: Option<String>,
    pub mode: String,
    pub status: String,
    pub reason: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub last_heartbeat_at: Option<u64>,
    pub replay_only: bool,
    pub observation_generation: Option<u64>,
    pub superseded_by_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_receipt_id: Option<String>,
}

#[tauri::command]
pub fn attach_editor_process(
    input: EditorAttachInput,
) -> Result<EditorObservationSessionResult, String> {
    let mut result = attach_editor_process_inner(input.clone())?;
    result.native_receipt_id = crate::mvp15d_runtime_bridge::issue_native_observation_receipt(
        "attach_editor_process",
        serde_json::to_value(&input).map_err(|error| error.to_string())?,
        serde_json::to_value(&result).map_err(|error| error.to_string())?,
    );
    Ok(result)
}

fn attach_editor_process_inner(
    input: EditorAttachInput,
) -> Result<EditorObservationSessionResult, String> {
    let validation = match validate_config_details(EditorProcessConfigInput {
        project_id: input.project_id.clone(),
        root_ref: input.root_ref.clone(),
        uproject_relative_path: input.uproject_relative_path.clone(),
        editor_executable: None,
        args: None,
    }) {
        Ok(validation) => validation,
        Err(validation) => {
            return Ok(blocked_session(
                &input.project_id,
                &input.mode,
                &validation.reason,
            ))
        }
    };
    let now = now_millis();
    let root_id = validation.root_id;
    let uproject_display_path = validation.uproject_display_path;
    let process = {
        let registry = process_registry().lock().unwrap();
        registry.get(&input.process_id).cloned()
    };
    let Some(process) = process else {
        return Ok(blocked_session(
            &input.project_id,
            &input.mode,
            "process_not_found",
        ));
    };
    if now > process.expires_at {
        return Ok(blocked_session(
            &input.project_id,
            &input.mode,
            "process_descriptor_expired",
        ));
    }
    if process.pid_hash != input.pid_hash {
        return Ok(blocked_session(
            &input.project_id,
            &input.mode,
            "pid_hash_mismatch",
        ));
    }
    if process.project_id != input.project_id
        || process.root_id != root_id
        || process.uproject_display_path != uproject_display_path
    {
        return Ok(blocked_session(
            &input.project_id,
            &input.mode,
            "pid_session_root_project_mismatch",
        ));
    }
    if process.process_state != "running" {
        return Ok(blocked_session(
            &input.project_id,
            &input.mode,
            "process_unavailable",
        ));
    }
    if process.source == "native" || process.source == "managed" {
        let check = check_native_record_current(&process);
        if !check.alive {
            return Ok(blocked_session(
                &input.project_id,
                &input.mode,
                &check.reason,
            ));
        }
    }
    let generation = next_observation_generation();
    let session_id = format!(
        "editor-observation:{}",
        stable_hash(&format!(
            "{}:{}:{}:{}",
            process.project_id, process.root_id, process.pid_hash, generation
        ))
    );
    let record = ObservationSessionRecord {
        session_id: session_id.clone(),
        process_id: process.process_id,
        project_id: input.project_id,
        root_id,
        uproject_display_path,
        pid_hash: process.pid_hash,
        process_display_name: sanitize_display(&process.display_name),
        source: process.source,
        mode: input.mode,
        status: "attached".to_string(),
        generation,
        superseded_by_session_id: None,
        created_at: now,
        expires_at: now + DEFAULT_OBSERVATION_TTL_MILLIS,
        last_heartbeat_at: None,
    };
    let mut sessions = observation_registry().lock().unwrap();
    for current in sessions.values_mut() {
        if current.status == "attached"
            && current.process_id == record.process_id
            && current.project_id == record.project_id
            && current.root_id == record.root_id
            && current.generation < record.generation
        {
            current.status = "superseded".to_string();
            current.superseded_by_session_id = Some(session_id.clone());
        }
    }
    sessions.insert(record.session_id.clone(), record.clone());
    Ok(session_result(&record, "attached", false))
}

#[tauri::command]
pub fn launch_editor_process(
    input: EditorProcessConfigInput,
) -> Result<EditorObservationSessionResult, String> {
    if !launch_enabled() {
        return Ok(blocked_session(
            &input.project_id,
            "launched",
            "launch_feature_disabled",
        ));
    }
    let validation = validate_config(input.clone());
    if !validation.ok {
        return Ok(blocked_session(
            &input.project_id,
            "launched",
            &validation.reason,
        ));
    }
    let executable = input.editor_executable.unwrap_or_default();
    let fixture_launch = normalize_project_path(&input.root_ref).starts_with("fixture://");
    if !is_allowlisted_editor_executable(&executable, fixture_launch) {
        return Ok(blocked_session(
            &input.project_id,
            "launched",
            "executable_outside_allowlist",
        ));
    }
    let args = input.args.unwrap_or_default();
    if !args.iter().all(|arg| is_allowlisted_launch_arg(arg)) {
        return Ok(blocked_session(
            &input.project_id,
            "launched",
            "launch_arg_blocked",
        ));
    }
    let mut command = Command::new(executable);
    command.env_clear();
    for arg in &args {
        command.arg(arg);
    }
    Ok(blocked_session(
        &input.project_id,
        "launched",
        "launch_not_executed_in_test_path",
    ))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EditorObservationSessionIdInput {
    pub session_id: String,
}

#[tauri::command]
pub fn read_editor_process_status(
    input: EditorObservationSessionIdInput,
) -> Result<EditorObservationSessionResult, String> {
    read_editor_process_status_at_with(input, now_millis(), check_native_record_current)
}

fn read_editor_process_status_at_with<F>(
    input: EditorObservationSessionIdInput,
    now: u64,
    lifecycle_check: F,
) -> Result<EditorObservationSessionResult, String>
where
    F: Fn(&DiscoveredProcessRecord) -> NativeLifecycleCheck,
{
    let session = {
        let mut registry = observation_registry().lock().unwrap();
        let Some(record) = registry.get_mut(&input.session_id) else {
            return Ok(blocked_session("", "unknown", "session_not_found"));
        };
        if record.status == "stopped" {
            return Ok(session_result(record, "local_observation_stopped", false));
        }
        if record.status == "superseded" {
            return Ok(session_result(record, "stale_generation", false));
        }
        if now >= record.expires_at {
            record.status = "expired".to_string();
            return Ok(session_result(record, "session_expired", false));
        }
        record.clone()
    };
    let process = process_registry()
        .lock()
        .unwrap()
        .get(&session.process_id)
        .cloned();
    let check = match process.as_ref() {
        Some(process) if process.source == "native" || process.source == "managed" => {
            lifecycle_check(process)
        }
        Some(process) if process.source == "fixture" => NativeLifecycleCheck {
            alive: true,
            reason: "heartbeat_ok".to_string(),
        },
        Some(_) => NativeLifecycleCheck {
            alive: false,
            reason: "native_authority_unavailable".to_string(),
        },
        None => NativeLifecycleCheck {
            alive: false,
            reason: "process_unavailable".to_string(),
        },
    };
    if !check.alive {
        return Ok(mark_observation_degraded_if_current(
            &input.session_id,
            &session,
            &check.reason,
        ));
    }
    let Some(process) = process else {
        unreachable!("an alive lifecycle result requires a process snapshot")
    };
    match commit_observation_renewal(&input.session_id, &session, &process, now) {
        Ok(renewed) => Ok(session_result(&renewed, &check.reason, false)),
        Err(reason) => Ok(current_session_result(&input.session_id, reason)),
    }
}

fn mark_observation_degraded_if_current(
    session_id: &str,
    session_snapshot: &ObservationSessionRecord,
    reason: &str,
) -> EditorObservationSessionResult {
    let mut sessions = observation_registry().lock().unwrap();
    let Some(current) = sessions.get_mut(session_id) else {
        return blocked_session("", "unknown", "session_not_found");
    };
    if current.status == "stopped" {
        return session_result(current, "local_observation_stopped", false);
    }
    if current == session_snapshot && current.status == "attached" {
        current.status = "degraded".to_string();
    }
    session_result(current, reason, false)
}

fn current_session_result(session_id: &str, reason: &str) -> EditorObservationSessionResult {
    let sessions = observation_registry().lock().unwrap();
    let Some(current) = sessions.get(session_id) else {
        return blocked_session("", "unknown", "session_not_found");
    };
    if current.status == "stopped" {
        session_result(current, "local_observation_stopped", false)
    } else {
        session_result(current, reason, false)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorObservationSnapshotResult {
    pub session_id: String,
    pub editor_state: String,
    pub session_state: String,
    pub project_matched: bool,
    pub process_alive: bool,
    pub last_heartbeat_at: Option<u64>,
    pub display_project: String,
    pub display_process: String,
    pub read_only_diagnostics: Vec<String>,
    pub created_at: u64,
}

#[tauri::command]
pub fn read_editor_observation_snapshot(
    input: EditorObservationSessionIdInput,
) -> Result<EditorObservationSnapshotResult, String> {
    let session = {
        let registry = observation_registry().lock().unwrap();
        let Some(record) = registry.get(&input.session_id) else {
            return Ok(EditorObservationSnapshotResult {
                session_id: input.session_id,
                editor_state: "degraded".to_string(),
                session_state: "blocked".to_string(),
                project_matched: false,
                process_alive: false,
                last_heartbeat_at: None,
                display_project: "[project-root]/unknown.uproject".to_string(),
                display_process: "unknown".to_string(),
                read_only_diagnostics: vec!["session_not_found".to_string()],
                created_at: now_millis(),
            });
        };
        record.clone()
    };
    if session.source != "fixture" {
        let process = process_registry()
            .lock()
            .unwrap()
            .get(&session.process_id)
            .cloned();
        let check = process
            .as_ref()
            .map(check_native_record_current)
            .unwrap_or_else(|| NativeLifecycleCheck {
                alive: false,
                reason: "process_unavailable".to_string(),
            });
        return Ok(EditorObservationSnapshotResult {
            session_id: session.session_id,
            editor_state: if check.alive {
                "attached".to_string()
            } else {
                "degraded".to_string()
            },
            session_state: if check.reason == "process_exited" {
                "exited".to_string()
            } else if check.alive {
                "active".to_string()
            } else {
                "degraded".to_string()
            },
            project_matched: check.alive,
            process_alive: check.alive,
            last_heartbeat_at: session.last_heartbeat_at,
            display_project: session.uproject_display_path,
            display_process: session.process_display_name,
            read_only_diagnostics: vec![
                check.reason,
                "Save All blocked".to_string(),
                "MCP mutation default blocked".to_string(),
            ],
            created_at: now_millis(),
        });
    }
    Ok(EditorObservationSnapshotResult {
        session_id: session.session_id.clone(),
        editor_state: "attached".to_string(),
        session_state: session.status.clone(),
        project_matched: true,
        process_alive: session.status != "expired" && session.status != "stopped",
        last_heartbeat_at: session.last_heartbeat_at,
        display_project: session.uproject_display_path.clone(),
        display_process: session.process_display_name.clone(),
        read_only_diagnostics: vec![
            "process metadata only".to_string(),
            "Save All blocked".to_string(),
            "MCP mutation default blocked".to_string(),
        ],
        created_at: now_millis(),
    })
}

#[tauri::command]
pub fn stop_editor_observation_session(
    input: EditorObservationSessionIdInput,
) -> Result<EditorObservationSessionResult, String> {
    let mut registry = observation_registry().lock().unwrap();
    let Some(record) = registry.get_mut(&input.session_id) else {
        let mut result = blocked_session("", "stopped", "session_not_found");
        drop(registry);
        result.native_receipt_id = crate::mvp15d_runtime_bridge::issue_native_observation_receipt(
            "stop_editor_observation_session",
            serde_json::to_value(&input).map_err(|error| error.to_string())?,
            serde_json::to_value(&result).map_err(|error| error.to_string())?,
        );
        return Ok(result);
    };
    record.status = "stopped".to_string();
    let mut result = session_result(record, "local_observation_stopped", false);
    drop(registry);
    result.native_receipt_id = crate::mvp15d_runtime_bridge::issue_native_observation_receipt(
        "stop_editor_observation_session",
        serde_json::to_value(&input).map_err(|error| error.to_string())?,
        serde_json::to_value(&result).map_err(|error| error.to_string())?,
    );
    Ok(result)
}

pub(crate) fn observe_managed_listener_alive_through_use(
    request: &serde_json::Value,
) -> Result<serde_json::Value, &'static str> {
    let input: ManagedListenerAliveInput =
        serde_json::from_value(request.clone()).map_err(|_| "managed_listener_request_invalid")?;
    if input.stage != "after_rendered_disconnect" {
        return Err("managed_listener_stage_invalid");
    }
    parse_canonical_process_creation_filetime(&input.process_creation_filetime)
        .ok_or("managed_process_creation_filetime_invalid")?;
    crate::mvp15d_runtime_bridge::validate_managed_process_owner(&input.task_id, &input.phase)
        .map_err(|_| "managed_process_owner_mismatch")?;
    let session = observation_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable")?
        .get(&input.session_id)
        .cloned()
        .ok_or("session_not_found")?;
    if !matches!(session.status.as_str(), "attached" | "stopped")
        || session.process_id != input.process_id
    {
        return Err("managed_process_session_identity_mismatch");
    }
    let process = process_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable")?
        .get(&input.process_id)
        .cloned()
        .ok_or("managed_process_unknown")?;
    let creation = parse_canonical_process_creation_filetime(&input.process_creation_filetime)
        .ok_or("managed_process_creation_filetime_invalid")?;
    if process.source != "managed"
        || process.owner_task_id.as_deref() != Some(input.task_id.as_str())
        || process.owner_phase.as_deref() != Some(input.phase.as_str())
        || process.pid != Some(input.pid)
        || process.process_start_time != Some(creation)
        || process.pid_hash != session.pid_hash
    {
        return Err("managed_process_identity_mismatch");
    }
    let managed = managed_child_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable")?;
    let managed = managed
        .get(&input.process_id)
        .ok_or("managed_process_unknown")?;
    let port = managed
        .listener_port
        .ok_or("managed_listener_unavailable")?;
    if managed.purpose != PHASE_LISTENER_OWNER
        || managed.owner_task_id != input.task_id
        || managed.owner_phase != input.phase
        || managed.pid != input.pid
        || managed.process_start_time != creation
        || managed.listener_instance_sha256.as_deref()
            != Some(input.listener_instance_sha256.as_str())
        || managed.owner_binding_sha256.as_deref() != Some(input.owner_binding_sha256.as_str())
        || observe_process_start_time(managed.guardian_pid)
            != Some(managed.guardian_process_start_time)
        || observe_process_start_time(input.pid) != Some(creation)
        || !listener_owned_by_process(port, input.pid)
        || !loopback_port_accepting(port)
    {
        return Err("managed_listener_not_alive");
    }
    Ok(serde_json::json!({
        "status": "observed",
        "reason": "task_owned_listener_accepting",
        "purpose": PHASE_LISTENER_OWNER,
        "ownerTaskId": input.task_id,
        "ownerPhase": input.phase,
        "sessionId": input.session_id,
        "processId": input.process_id,
        "processPid": input.pid,
        "processCreationFiletime": input.process_creation_filetime,
        "pidHash": process.pid_hash,
        "observationGeneration": session.generation,
        "processIdentitySha256": sha256_binding(&[
            process.process_id.as_str(),
            &input.pid.to_string(),
            input.process_creation_filetime.as_str(),
        ]),
        "listenerInstanceSha256": input.listener_instance_sha256,
        "ownerBindingSha256": input.owner_binding_sha256,
        "stage": input.stage,
        "processAlive": true,
        "listenerAccepting": true,
    }))
}

/// Test/owned-launch lifecycle transition used by the fixed MVP15D driver.
/// Attached external UE processes are never terminated by this command.
#[tauri::command]
pub fn terminate_managed_editor_process(
    input: ManagedEditorProcessTerminateCommandInput,
) -> Result<ManagedEditorProcessTerminateResult, String> {
    match input {
        ManagedEditorProcessTerminateCommandInput::Strict(input) => {
            terminate_phase_listener_owner(input)
        }
        ManagedEditorProcessTerminateCommandInput::Legacy(input) => {
            terminate_negative_case_fixture(input)
        }
    }
}

fn terminate_phase_listener_owner(
    input: ManagedEditorProcessTerminateInput,
) -> Result<ManagedEditorProcessTerminateResult, String> {
    if input.schema_version != MANAGED_TERMINATE_SCHEMA {
        return observed_managed_terminate_result(
            serde_json::to_value(&input).map_err(|error| error.to_string())?,
            managed_terminate_result_from_strict(
                &input,
                "blocked",
                "managed_process_terminate_schema_invalid",
            ),
        );
    }
    if input.purpose != PHASE_LISTENER_OWNER {
        return observed_managed_terminate_result(
            serde_json::to_value(&input).map_err(|error| error.to_string())?,
            managed_terminate_result_from_strict(
                &input,
                "blocked",
                "managed_process_purpose_invalid",
            ),
        );
    }
    let process_creation_filetime =
        match parse_canonical_process_creation_filetime(&input.process_creation_filetime) {
            Some(value) => value,
            None => {
                return observed_managed_terminate_result(
                    serde_json::to_value(&input).map_err(|error| error.to_string())?,
                    managed_terminate_result_from_strict(
                        &input,
                        "blocked",
                        "managed_process_creation_filetime_invalid",
                    ),
                )
            }
        };
    if let Err(reason) =
        crate::mvp15d_runtime_bridge::validate_managed_process_owner(&input.task_id, &input.phase)
    {
        return observed_managed_terminate_result(
            serde_json::to_value(&input).map_err(|error| error.to_string())?,
            managed_terminate_result_from_strict(&input, "blocked", reason),
        );
    }

    let session_snapshot = observation_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable".to_string())?
        .get(&input.session_id)
        .cloned();
    let Some(session_snapshot) = session_snapshot else {
        return observed_managed_terminate_result(
            serde_json::to_value(&input).map_err(|error| error.to_string())?,
            managed_terminate_result_from_strict(&input, "blocked", "session_not_found"),
        );
    };
    if session_snapshot.process_id != input.process_id || session_snapshot.status != "attached" {
        return observed_managed_terminate_result(
            serde_json::to_value(&input).map_err(|error| error.to_string())?,
            managed_terminate_result_from_strict(
                &input,
                "blocked",
                "managed_process_session_identity_mismatch",
            ),
        );
    }
    let process_snapshot = process_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable".to_string())?
        .get(&session_snapshot.process_id)
        .cloned();
    let Some(process_snapshot) = process_snapshot else {
        return observed_managed_terminate_result(
            serde_json::to_value(&input).map_err(|error| error.to_string())?,
            managed_terminate_result_from_strict(&input, "blocked", "managed_process_unknown"),
        );
    };
    if process_snapshot.source != "managed" {
        return observed_managed_terminate_result(
            serde_json::to_value(&input).map_err(|error| error.to_string())?,
            managed_terminate_result_from_strict(&input, "blocked", "process_not_managed"),
        );
    }
    if process_snapshot.owner_task_id.as_deref() != Some(input.task_id.as_str())
        || process_snapshot.owner_phase.as_deref() != Some(input.phase.as_str())
    {
        return observed_managed_terminate_result(
            serde_json::to_value(&input).map_err(|error| error.to_string())?,
            managed_terminate_result_from_strict(
                &input,
                "blocked",
                "managed_process_owner_mismatch",
            ),
        );
    }
    if process_snapshot.pid != Some(input.pid)
        || process_snapshot.process_start_time != Some(process_creation_filetime)
        || process_snapshot.pid_hash != session_snapshot.pid_hash
    {
        return observed_managed_terminate_result(
            serde_json::to_value(&input).map_err(|error| error.to_string())?,
            managed_terminate_result_from_strict(
                &input,
                "blocked",
                "managed_process_identity_mismatch",
            ),
        );
    }

    let managed_matches = managed_child_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable".to_string())?
        .get(&input.process_id)
        .is_some_and(|managed| {
            managed.purpose == PHASE_LISTENER_OWNER
                && managed.owner_task_id == input.task_id
                && managed.owner_phase == input.phase
                && managed.pid == input.pid
                && managed.process_start_time == process_creation_filetime
                && managed.listener_port.is_some()
                && managed.listener_instance_sha256.as_deref()
                    == Some(input.listener_instance_sha256.as_str())
                && managed.owner_binding_sha256.as_deref()
                    == Some(input.owner_binding_sha256.as_str())
                && observe_process_start_time(managed.guardian_pid)
                    == Some(managed.guardian_process_start_time)
        });
    if !managed_matches {
        return observed_managed_terminate_result(
            serde_json::to_value(&input).map_err(|error| error.to_string())?,
            managed_terminate_result_from_strict(
                &input,
                "blocked",
                "managed_process_identity_mismatch",
            ),
        );
    }
    let listener_port = managed_child_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable".to_string())?
        .get(&input.process_id)
        .and_then(|managed| managed.listener_port)
        .ok_or_else(|| "native_authority_unavailable".to_string())?;
    if observe_process_start_time(input.pid) != Some(process_creation_filetime)
        || !listener_owned_by_process(listener_port, input.pid)
        || !loopback_port_accepting(listener_port)
    {
        return observed_managed_terminate_result(
            serde_json::to_value(&input).map_err(|error| error.to_string())?,
            managed_terminate_result_from_strict(&input, "blocked", "managed_process_not_live"),
        );
    }

    let mut managed = managed_child_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable".to_string())?
        .remove(&input.process_id)
        .ok_or_else(|| "native_authority_unavailable".to_string())?;
    drop(managed.child.stdin.take());
    let guardian_exited = wait_for_child_exit(&mut managed.child, Duration::from_secs(45));
    if !guardian_exited {
        let _ = managed.child.kill();
        let _ = managed.child.wait();
    }
    let editor_exited = wait_for_process_identity_exit(
        input.pid,
        process_creation_filetime,
        Duration::from_secs(10),
    );
    let listener_closed =
        wait_for_listener_closed(listener_port, input.pid, Duration::from_secs(5));
    if !(guardian_exited && editor_exited && listener_closed) {
        let mut result = managed_terminate_result_from_strict(
            &input,
            "failed",
            "managed_process_termination_unconfirmed",
        );
        result.exit_observed = editor_exited;
        result.listener_closed = listener_closed;
        return observed_managed_terminate_result(
            serde_json::to_value(&input).map_err(|error| error.to_string())?,
            result,
        );
    }

    process_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable".to_string())?
        .remove(&input.process_id);
    let process_identity_sha256 = sha256_binding(&[
        input.process_id.as_str(),
        &input.pid.to_string(),
        input.process_creation_filetime.as_str(),
    ]);
    let mut result =
        managed_terminate_result_from_strict(&input, "terminated", "task_owned_process_exited");
    result.pid_hash = Some(process_snapshot.pid_hash);
    result.observation_generation = Some(session_snapshot.generation);
    result.process_identity_sha256 = Some(process_identity_sha256);
    result.exit_observed = true;
    result.listener_closed = true;
    observed_managed_terminate_result(
        serde_json::to_value(&input).map_err(|error| error.to_string())?,
        result,
    )
}

fn terminate_negative_case_fixture(
    input: EditorObservationSessionIdInput,
) -> Result<ManagedEditorProcessTerminateResult, String> {
    let request = serde_json::to_value(&input).map_err(|error| error.to_string())?;
    let session = observation_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable".to_string())?
        .get(&input.session_id)
        .cloned();
    let Some(session) = session else {
        return observed_managed_terminate_result(
            request,
            legacy_managed_terminate_result(&input, None, "blocked", "session_not_found"),
        );
    };
    let process = process_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable".to_string())?
        .get(&session.process_id)
        .cloned();
    let Some(process) = process else {
        return observed_managed_terminate_result(
            request,
            legacy_managed_terminate_result(
                &input,
                Some(&session),
                "blocked",
                "managed_process_unknown",
            ),
        );
    };
    if process.source == "managed" {
        let purpose = managed_child_registry()
            .lock()
            .map_err(|_| "native_authority_unavailable".to_string())?
            .get(&process.process_id)
            .map(|record| record.purpose.clone());
        if purpose.as_deref() != Some(NEGATIVE_CASE_FIXTURE) {
            return observed_managed_terminate_result(
                request,
                legacy_managed_terminate_result(
                    &input,
                    Some(&session),
                    "blocked",
                    "managed_process_strict_identity_required",
                ),
            );
        }
        let mut managed = managed_child_registry()
            .lock()
            .map_err(|_| "native_authority_unavailable".to_string())?
            .remove(&process.process_id)
            .ok_or_else(|| "native_authority_unavailable".to_string())?;
        drop(managed.child.stdin.take());
        if !wait_for_child_exit(&mut managed.child, Duration::from_secs(15)) {
            managed_child_registry()
                .lock()
                .map_err(|_| "native_authority_unavailable".to_string())?
                .insert(process.process_id.clone(), managed);
            return observed_managed_terminate_result(
                request,
                legacy_managed_terminate_result(
                    &input,
                    Some(&session),
                    "failed",
                    "managed_process_termination_failed",
                ),
            );
        }
    } else if process.source != "fixture" {
        return observed_managed_terminate_result(
            request,
            legacy_managed_terminate_result(
                &input,
                Some(&session),
                "blocked",
                "process_not_managed",
            ),
        );
    }
    if let Some(process) = process_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable".to_string())?
        .get_mut(&session.process_id)
    {
        process.process_state = "exited".to_string();
        process.expires_at = now_millis();
    }
    observed_managed_terminate_result(
        request,
        legacy_managed_terminate_result(&input, Some(&session), "degraded", "process_exited"),
    )
}

fn parse_canonical_process_creation_filetime(value: &str) -> Option<u64> {
    let parsed = value.parse::<u64>().ok()?;
    (parsed > 0 && parsed.to_string() == value).then_some(parsed)
}

fn managed_terminate_result_from_strict(
    input: &ManagedEditorProcessTerminateInput,
    status: &str,
    reason: &str,
) -> ManagedEditorProcessTerminateResult {
    ManagedEditorProcessTerminateResult {
        schema_version: MANAGED_TERMINATE_RESULT_SCHEMA.to_string(),
        status: status.to_string(),
        reason: reason.to_string(),
        purpose: input.purpose.clone(),
        owner_task_id: input.task_id.clone(),
        owner_phase: input.phase.clone(),
        session_id: Some(input.session_id.clone()),
        process_id: Some(input.process_id.clone()),
        pid: Some(input.pid),
        process_creation_filetime: Some(input.process_creation_filetime.clone()),
        pid_hash: None,
        observation_generation: None,
        process_identity_sha256: None,
        listener_instance_sha256: Some(input.listener_instance_sha256.clone()),
        owner_binding_sha256: Some(input.owner_binding_sha256.clone()),
        exit_observed: false,
        listener_closed: false,
        native_receipt_id: None,
    }
}

fn legacy_managed_terminate_result(
    input: &EditorObservationSessionIdInput,
    session: Option<&ObservationSessionRecord>,
    status: &str,
    reason: &str,
) -> ManagedEditorProcessTerminateResult {
    ManagedEditorProcessTerminateResult {
        schema_version: MANAGED_TERMINATE_RESULT_SCHEMA.to_string(),
        status: status.to_string(),
        reason: reason.to_string(),
        purpose: NEGATIVE_CASE_FIXTURE.to_string(),
        owner_task_id: String::new(),
        owner_phase: String::new(),
        session_id: Some(input.session_id.clone()),
        process_id: session.map(|value| value.process_id.clone()),
        pid: None,
        process_creation_filetime: None,
        pid_hash: session.map(|value| value.pid_hash.clone()),
        observation_generation: session.map(|value| value.generation),
        process_identity_sha256: None,
        listener_instance_sha256: None,
        owner_binding_sha256: None,
        exit_observed: reason == "process_exited",
        listener_closed: false,
        native_receipt_id: None,
    }
}

fn observed_managed_terminate_result(
    request: serde_json::Value,
    mut result: ManagedEditorProcessTerminateResult,
) -> Result<ManagedEditorProcessTerminateResult, String> {
    result.native_receipt_id = crate::mvp15d_runtime_bridge::issue_native_observation_receipt(
        "terminate_managed_editor_process",
        request,
        serde_json::to_value(&result).map_err(|error| error.to_string())?,
    );
    Ok(result)
}

fn wait_for_child_exit(child: &mut Child, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            _ => return false,
        }
    }
}

fn wait_for_process_identity_exit(pid: u32, creation: u64, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if observe_process_start_time(pid) != Some(creation) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn wait_for_listener_closed(port: u16, pid: u32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        if !listener_owned_by_process(port, pid) && !loopback_port_accepting(port) {
            return true;
        }
        if Instant::now() >= deadline {
            return false;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn validate_config(input: EditorProcessConfigInput) -> EditorAttachValidationResult {
    match validate_config_details(input) {
        Ok(details) => details.public,
        Err(validation) => validation,
    }
}

fn validate_config_details(
    input: EditorProcessConfigInput,
) -> Result<ValidatedEditorConfig, EditorAttachValidationResult> {
    if !bridge_enabled() {
        return Err(blocked_validation("feature_disabled", &input.root_ref));
    }
    let raw = input.root_ref.trim();
    if raw.starts_with("//") || raw.starts_with("\\\\") {
        return Err(blocked_validation("network_root", raw));
    }
    let normalized = normalize_project_path(&input.root_ref);
    if !is_trusted_root(&normalized) {
        return Err(blocked_validation("untrusted_root", &normalized));
    }
    if input.uproject_relative_path.contains("..")
        || input.uproject_relative_path.starts_with('/')
        || input.uproject_relative_path.starts_with('\\')
    {
        return Err(blocked_validation("root_escape", &normalized));
    }
    if !input.uproject_relative_path.ends_with(".uproject") {
        return Err(blocked_validation("missing_uproject", &normalized));
    }
    if normalized.starts_with("fixture://") {
        if !is_allowed_fixture_root(&normalized) {
            return Err(blocked_validation("untrusted_root", &normalized));
        }
        let public = EditorAttachValidationResult {
            ok: true,
            reason: "valid".to_string(),
            root_id: Some(hash_path(&normalized)),
            display_root: redact_path_for_ui(&normalized),
            uproject_display_path: Some(format!(
                "[project-root]/{}",
                normalize_project_path(&input.uproject_relative_path)
            )),
        };
        return Ok(ValidatedEditorConfig {
            root_id: public.root_id.clone().unwrap(),
            uproject_display_path: public.uproject_display_path.clone().unwrap(),
            public,
            canonical_root: None,
            canonical_uproject: None,
            fixture: true,
        });
    }
    let root_path = Path::new(&normalized);
    let Ok(canonical_root) = root_path.canonicalize() else {
        return Err(blocked_validation("missing_uproject", &normalized));
    };
    let target = root_path.join(&input.uproject_relative_path);
    let Ok(canonical_target) = target.canonicalize() else {
        return Err(blocked_validation("missing_uproject", &normalized));
    };
    if !canonical_target.starts_with(&canonical_root) {
        return Err(blocked_validation("root_escape", &normalized));
    }
    if !canonical_target.is_file()
        || canonical_target
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.eq_ignore_ascii_case("uproject"))
            != Some(true)
    {
        return Err(blocked_validation("missing_uproject", &normalized));
    }
    let public = EditorAttachValidationResult {
        ok: true,
        reason: "valid".to_string(),
        root_id: Some(hash_path(&normalized)),
        display_root: redact_path_for_ui(&normalized),
        uproject_display_path: Some(format!(
            "[project-root]/{}",
            normalize_project_path(&input.uproject_relative_path)
        )),
    };
    Ok(ValidatedEditorConfig {
        root_id: public.root_id.clone().unwrap(),
        uproject_display_path: public.uproject_display_path.clone().unwrap(),
        public,
        canonical_root: Some(normalize_pathbuf(&canonical_root)),
        canonical_uproject: Some(normalize_pathbuf(&canonical_target)),
        fixture: false,
    })
}

fn build_native_discovery_from_candidates(
    input: &EditorProcessConfigInput,
    validation: &ValidatedEditorConfig,
    candidates: &[NativeProcessCandidate],
    now: u64,
) -> NativeDiscoveryBuild {
    let mut records = Vec::new();
    let mut saw_ue_process = false;
    let Some(canonical_uproject) = validation.canonical_uproject.as_ref() else {
        return NativeDiscoveryBuild {
            result: degraded_discovery("native_discovery_unavailable"),
            records,
        };
    };
    for candidate in candidates {
        let Some(display_name) = allowed_editor_display_name(&candidate.executable_name) else {
            continue;
        };
        saw_ue_process = true;
        if !candidate_matches_uproject(candidate, canonical_uproject) {
            continue;
        }
        let executable_identity = candidate
            .executable_path
            .as_deref()
            .map(normalize_project_path)
            .unwrap_or_else(|| display_name.clone());
        let display_executable_hash = format!("exe:{}", stable_hash(&executable_identity));
        let process_id = format!(
            "process:{}",
            stable_hash(&format!(
                "{}:{}:{}:{}:{}",
                input.project_id,
                validation.root_id,
                canonical_uproject,
                candidate.pid,
                candidate.start_time
            ))
        );
        let pid_hash = format!(
            "pid:{}",
            stable_hash(&format!(
                "{}:{}:{}:{}:{}",
                validation.root_id,
                canonical_uproject,
                candidate.pid,
                candidate.start_time,
                display_executable_hash
            ))
        );
        records.push(DiscoveredProcessRecord {
            process_id,
            pid_hash,
            pid: Some(candidate.pid),
            process_start_time: Some(candidate.start_time),
            project_id: input.project_id.clone(),
            root_id: validation.root_id.clone(),
            uproject_display_path: validation.uproject_display_path.clone(),
            canonical_root: validation.canonical_root.clone(),
            canonical_uproject: validation.canonical_uproject.clone(),
            display_project_hint: validation.uproject_display_path.clone(),
            display_executable_hash,
            display_name,
            process_state: "running".to_string(),
            source: "native".to_string(),
            owner_task_id: None,
            owner_phase: None,
            discovered_at: now,
            expires_at: now + DEFAULT_OBSERVATION_TTL_MILLIS,
        });
    }
    if records.is_empty() {
        let reason = if saw_ue_process {
            "project_mismatch"
        } else {
            "process_not_found"
        };
        return NativeDiscoveryBuild {
            result: degraded_discovery(reason),
            records,
        };
    }
    NativeDiscoveryBuild {
        result: EditorProcessDiscoveryResult {
            status: "ready".to_string(),
            reason: "native_process_matched".to_string(),
            processes: records.iter().map(descriptor_from_record).collect(),
        },
        records,
    }
}

fn check_native_record_current(record: &DiscoveredProcessRecord) -> NativeLifecycleCheck {
    if record.source == "managed" {
        return check_managed_record_current(record);
    }
    match enumerate_native_processes() {
        Ok(candidates) => check_native_record_against_candidates(record, &candidates),
        Err(reason) => NativeLifecycleCheck {
            alive: false,
            reason,
        },
    }
}

#[cfg(windows)]
fn observe_process_start_time(pid: u32) -> Option<u64> {
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle == 0 {
        return None;
    }
    let mut creation = FileTime {
        low_date_time: 0,
        high_date_time: 0,
    };
    let mut exit = creation;
    let mut kernel = creation;
    let mut user = creation;
    let ok = unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) };
    unsafe {
        CloseHandle(handle);
    }
    if ok == 0 {
        None
    } else {
        let value = ((creation.high_date_time as u64) << 32) | creation.low_date_time as u64;
        (value > 0).then_some(value)
    }
}

#[cfg(not(windows))]
fn observe_process_start_time(pid: u32) -> Option<u64> {
    use sysinfo::{Pid, System};
    for _ in 0..50 {
        let mut system = System::new_all();
        system.refresh_all();
        if let Some(process) = system.process(Pid::from_u32(pid)) {
            return Some(process.start_time());
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    None
}

#[cfg(windows)]
fn listener_owned_by_process(port: u16, pid: u32) -> bool {
    const AF_INET: u32 = 2;
    const TCP_TABLE_OWNER_PID_LISTENER: u32 = 3;
    const ERROR_INSUFFICIENT_BUFFER: u32 = 122;
    let mut byte_count = 0_u32;
    let first = unsafe {
        GetExtendedTcpTable(
            std::ptr::null_mut(),
            &mut byte_count,
            0,
            AF_INET,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        )
    };
    if first != ERROR_INSUFFICIENT_BUFFER || byte_count < 4 {
        return false;
    }
    let word_count = (byte_count as usize).div_ceil(std::mem::size_of::<u32>());
    let mut buffer = vec![0_u32; word_count];
    let result = unsafe {
        GetExtendedTcpTable(
            buffer.as_mut_ptr().cast(),
            &mut byte_count,
            0,
            AF_INET,
            TCP_TABLE_OWNER_PID_LISTENER,
            0,
        )
    };
    if result != 0 {
        return false;
    }
    let count = buffer[0] as usize;
    let rows = unsafe {
        std::slice::from_raw_parts(
            buffer.as_ptr().add(1).cast::<MibTcpRowOwnerPid>(),
            count.min((byte_count as usize - 4) / std::mem::size_of::<MibTcpRowOwnerPid>()),
        )
    };
    rows.iter().any(|row| {
        let local_port = u16::from_be((row.local_port & 0xffff) as u16);
        row.owning_pid == pid && local_port == port
    })
}

#[cfg(not(windows))]
fn listener_owned_by_process(port: u16, _pid: u32) -> bool {
    loopback_port_accepting(port)
}

fn check_managed_record_current(record: &DiscoveredProcessRecord) -> NativeLifecycleCheck {
    let (Some(pid), Some(expected_start)) = (record.pid, record.process_start_time) else {
        return NativeLifecycleCheck {
            alive: false,
            reason: "process_unavailable".to_string(),
        };
    };
    match observe_process_start_time(pid) {
        Some(actual_start) if actual_start == expected_start => NativeLifecycleCheck {
            alive: true,
            reason: "heartbeat_ok".to_string(),
        },
        _ => NativeLifecycleCheck {
            alive: false,
            reason: "process_exited".to_string(),
        },
    }
}

fn check_native_record_against_candidates(
    record: &DiscoveredProcessRecord,
    candidates: &[NativeProcessCandidate],
) -> NativeLifecycleCheck {
    let Some(pid) = record.pid else {
        return NativeLifecycleCheck {
            alive: false,
            reason: "process_unavailable".to_string(),
        };
    };
    let Some(candidate) = candidates.iter().find(|candidate| candidate.pid == pid) else {
        return NativeLifecycleCheck {
            alive: false,
            reason: "process_exited".to_string(),
        };
    };
    if record.process_start_time != Some(candidate.start_time) {
        return NativeLifecycleCheck {
            alive: false,
            reason: "process_exited".to_string(),
        };
    }
    if allowed_editor_display_name(&candidate.executable_name).is_none() {
        return NativeLifecycleCheck {
            alive: false,
            reason: "process_unavailable".to_string(),
        };
    }
    let executable_identity = candidate
        .executable_path
        .as_deref()
        .map(normalize_project_path)
        .unwrap_or_else(|| candidate.executable_name.clone());
    if format!("exe:{}", stable_hash(&executable_identity)) != record.display_executable_hash {
        return NativeLifecycleCheck {
            alive: false,
            reason: "process_exited".to_string(),
        };
    }
    let Some(canonical_root) = record.canonical_root.as_ref() else {
        return NativeLifecycleCheck {
            alive: false,
            reason: "native_process_observation_unavailable".to_string(),
        };
    };
    let Some(canonical_uproject) = record.canonical_uproject.as_ref() else {
        return NativeLifecycleCheck {
            alive: false,
            reason: "native_process_observation_unavailable".to_string(),
        };
    };
    if !path_is_inside_root(canonical_root, canonical_uproject) {
        return NativeLifecycleCheck {
            alive: false,
            reason: "project_mismatch".to_string(),
        };
    }
    if !candidate_matches_uproject(candidate, canonical_uproject) {
        return NativeLifecycleCheck {
            alive: false,
            reason: "project_mismatch".to_string(),
        };
    }
    NativeLifecycleCheck {
        alive: true,
        reason: "heartbeat_ok".to_string(),
    }
}

#[cfg(windows)]
fn enumerate_native_processes() -> Result<Vec<NativeProcessCandidate>, String> {
    use sysinfo::System;

    let mut system = System::new_all();
    system.refresh_processes();
    Ok(system
        .processes()
        .iter()
        .filter_map(|(pid, process)| {
            Some(NativeProcessCandidate {
                pid: pid.as_u32(),
                start_time: observe_process_start_time(pid.as_u32())?,
                executable_name: process.name().to_string(),
                executable_path: process.exe().map(|path| path.to_string_lossy().to_string()),
                command_line: process.cmd().to_vec(),
            })
        })
        .collect())
}

#[cfg(not(windows))]
fn enumerate_native_processes() -> Result<Vec<NativeProcessCandidate>, String> {
    Err("platform_unsupported".to_string())
}

#[cfg(windows)]
#[repr(C)]
#[allow(non_snake_case)]
struct ModuleEntry32W {
    dwSize: u32,
    th32ModuleID: u32,
    th32ProcessID: u32,
    GlblcntUsage: u32,
    ProccntUsage: u32,
    modBaseAddr: *mut u8,
    modBaseSize: u32,
    hModule: isize,
    szModule: [u16; 256],
    szExePath: [u16; 260],
}

#[cfg(windows)]
#[repr(C)]
#[derive(Clone, Copy)]
struct FileTime {
    low_date_time: u32,
    high_date_time: u32,
}

#[cfg(windows)]
#[repr(C)]
struct MibTcpRowOwnerPid {
    state: u32,
    local_addr: u32,
    local_port: u32,
    remote_addr: u32,
    remote_port: u32,
    owning_pid: u32,
}

#[cfg(windows)]
const TH32CS_SNAPMODULE: u32 = 0x0000_0008;
#[cfg(windows)]
const TH32CS_SNAPMODULE32: u32 = 0x0000_0010;
#[cfg(windows)]
const ERROR_NO_MORE_FILES: u32 = 18;
#[cfg(windows)]
const INVALID_HANDLE_VALUE: isize = -1;

#[cfg(windows)]
#[link(name = "Kernel32")]
unsafe extern "system" {
    fn OpenProcess(desired_access: u32, inherit_handle: i32, process_id: u32) -> isize;
    fn GetProcessTimes(
        process: isize,
        creation_time: *mut FileTime,
        exit_time: *mut FileTime,
        kernel_time: *mut FileTime,
        user_time: *mut FileTime,
    ) -> i32;
    fn CreateToolhelp32Snapshot(flags: u32, process_id: u32) -> isize;
    fn Module32FirstW(snapshot: isize, entry: *mut ModuleEntry32W) -> i32;
    fn Module32NextW(snapshot: isize, entry: *mut ModuleEntry32W) -> i32;
    fn CloseHandle(handle: isize) -> i32;
    fn GetLastError() -> u32;
}

#[cfg(windows)]
#[link(name = "iphlpapi")]
unsafe extern "system" {
    fn GetExtendedTcpTable(
        table: *mut std::ffi::c_void,
        size: *mut u32,
        order: i32,
        address_family: u32,
        table_class: u32,
        reserved: u32,
    ) -> u32;
}

#[cfg(windows)]
struct ModuleSnapshotHandle(isize);

#[cfg(windows)]
impl Drop for ModuleSnapshotHandle {
    fn drop(&mut self) {
        // The handle has already been checked against INVALID_HANDLE_VALUE.
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

/// Read the OS module table for one already-attested PID.  This function has no
/// renderer inputs and does not publish raw paths; callers must still compare
/// each returned module against a verified installed companion artifact.
#[cfg(windows)]
fn enumerate_native_loaded_modules(
    pid: u32,
) -> Result<Vec<NativeLoadedModuleObservation>, &'static str> {
    use std::os::windows::ffi::OsStringExt;

    let raw_snapshot =
        unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, pid) };
    if raw_snapshot == INVALID_HANDLE_VALUE {
        return Err("native_module_enumeration_unavailable");
    }
    let _snapshot = ModuleSnapshotHandle(raw_snapshot);
    let mut entry: ModuleEntry32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<ModuleEntry32W>() as u32;
    let first = unsafe { Module32FirstW(raw_snapshot, &mut entry) };
    if first == 0 {
        return Err("native_module_enumeration_unavailable");
    }

    let mut modules = Vec::new();
    loop {
        let path_end = entry
            .szExePath
            .iter()
            .position(|value| *value == 0)
            .ok_or("native_module_enumeration_unavailable")?;
        let raw_path = std::ffi::OsString::from_wide(&entry.szExePath[..path_end]);
        let canonical_path = std::fs::canonicalize(PathBuf::from(raw_path))
            .map_err(|_| "native_module_enumeration_unavailable")?;
        let metadata = std::fs::symlink_metadata(&canonical_path)
            .map_err(|_| "native_module_enumeration_unavailable")?;
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            return Err("native_module_enumeration_unavailable");
        }
        let basename = canonical_path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .ok_or("native_module_enumeration_unavailable")?
            .to_string();
        modules.push(NativeLoadedModuleObservation {
            basename,
            canonical_path,
            size: metadata.len(),
        });

        entry = unsafe { std::mem::zeroed() };
        entry.dwSize = std::mem::size_of::<ModuleEntry32W>() as u32;
        if unsafe { Module32NextW(raw_snapshot, &mut entry) } == 0 {
            let error = unsafe { GetLastError() };
            if error == ERROR_NO_MORE_FILES {
                break;
            }
            return Err("native_module_enumeration_unavailable");
        }
    }
    Ok(modules)
}

#[cfg(not(windows))]
fn enumerate_native_loaded_modules(
    _pid: u32,
) -> Result<Vec<NativeLoadedModuleObservation>, &'static str> {
    Err("platform_unsupported")
}

fn allowed_editor_display_name(name: &str) -> Option<String> {
    if name.eq_ignore_ascii_case("UnrealEditor.exe") {
        Some("UnrealEditor.exe".to_string())
    } else if name.eq_ignore_ascii_case("UnrealEditor-Cmd.exe") {
        Some("UnrealEditor-Cmd.exe".to_string())
    } else {
        None
    }
}

fn candidate_matches_uproject(
    candidate: &NativeProcessCandidate,
    canonical_uproject: &str,
) -> bool {
    candidate.command_line.iter().any(|arg| {
        let value = normalize_uproject_arg(arg);
        if !value.to_ascii_lowercase().ends_with(".uproject") {
            return false;
        }
        canonicalize_maybe(&value)
            .map(|candidate_path| paths_equivalent(&candidate_path, canonical_uproject))
            .unwrap_or(false)
    })
}

fn normalize_uproject_arg(arg: &str) -> String {
    let trimmed = arg.trim().trim_matches('"').trim_matches('\'');
    let value = trimmed.strip_prefix("-Project=").unwrap_or(trimmed);
    value.trim_matches('"').trim_matches('\'').to_string()
}

fn canonicalize_maybe(path: &str) -> Option<String> {
    let path = Path::new(path);
    path.canonicalize()
        .ok()
        .map(|path| normalize_pathbuf(&path))
}

fn normalize_pathbuf(path: &PathBuf) -> String {
    normalize_project_path(&path.to_string_lossy())
}

fn paths_equivalent(left: &str, right: &str) -> bool {
    if cfg!(windows) {
        left.eq_ignore_ascii_case(right)
    } else {
        left == right
    }
}

fn path_is_inside_root(root: &str, candidate: &str) -> bool {
    if paths_equivalent(root, candidate) {
        return true;
    }
    let root_with_slash = if root.ends_with('/') {
        root.to_string()
    } else {
        format!("{}/", root)
    };
    if cfg!(windows) {
        candidate
            .to_ascii_lowercase()
            .starts_with(&root_with_slash.to_ascii_lowercase())
    } else {
        candidate.starts_with(&root_with_slash)
    }
}

fn descriptor_from_record(record: &DiscoveredProcessRecord) -> EditorProcessDescriptor {
    let managed = (record.source == "managed")
        .then(|| {
            managed_child_registry()
                .lock()
                .ok()?
                .get(&record.process_id)
                .map(|managed| {
                    (
                        managed.purpose.clone(),
                        managed.listener_instance_sha256.clone(),
                        managed.owner_binding_sha256.clone(),
                    )
                })
        })
        .flatten();
    EditorProcessDescriptor {
        id: record.process_id.clone(),
        pid_hash: record.pid_hash.clone(),
        display_name: record.display_name.clone(),
        display_executable_hash: record.display_executable_hash.clone(),
        display_project_hint: record.display_project_hint.clone(),
        process_state: record.process_state.clone(),
        source: record.source.clone(),
        discovered_at: record.discovered_at,
        expires_at: record.expires_at,
        managed_purpose: managed.as_ref().map(|value| value.0.clone()),
        process_pid: managed.as_ref().map(|_| record.pid).flatten(),
        process_creation_filetime: managed
            .as_ref()
            .and_then(|_| record.process_start_time.map(|value| value.to_string())),
        listener_instance_sha256: managed.as_ref().and_then(|value| value.1.clone()),
        owner_binding_sha256: managed.and_then(|value| value.2),
    }
}

fn blocked_discovery(reason: &str) -> EditorProcessDiscoveryResult {
    EditorProcessDiscoveryResult {
        status: "blocked".to_string(),
        reason: reason.to_string(),
        processes: Vec::new(),
    }
}

fn degraded_discovery(reason: &str) -> EditorProcessDiscoveryResult {
    EditorProcessDiscoveryResult {
        status: "degraded".to_string(),
        reason: reason.to_string(),
        processes: Vec::new(),
    }
}

fn blocked_validation(reason: &str, root_ref: &str) -> EditorAttachValidationResult {
    EditorAttachValidationResult {
        ok: false,
        reason: reason.to_string(),
        root_id: None,
        display_root: redact_path_for_ui(root_ref),
        uproject_display_path: None,
    }
}

fn blocked_session(project_id: &str, mode: &str, reason: &str) -> EditorObservationSessionResult {
    EditorObservationSessionResult {
        session_id: None,
        process_id: None,
        project_id: project_id.to_string(),
        root_id: None,
        uproject_display_path: None,
        pid_hash: None,
        process_display_name: None,
        mode: mode.to_string(),
        status: "blocked".to_string(),
        reason: reason.to_string(),
        created_at: 0,
        expires_at: 0,
        last_heartbeat_at: None,
        replay_only: false,
        observation_generation: None,
        superseded_by_session_id: None,
        native_receipt_id: None,
    }
}

fn session_result(
    record: &ObservationSessionRecord,
    reason: &str,
    replay_only: bool,
) -> EditorObservationSessionResult {
    EditorObservationSessionResult {
        session_id: Some(record.session_id.clone()),
        process_id: Some(record.process_id.clone()),
        project_id: record.project_id.clone(),
        root_id: Some(record.root_id.clone()),
        uproject_display_path: Some(record.uproject_display_path.clone()),
        pid_hash: Some(record.pid_hash.clone()),
        process_display_name: Some(record.process_display_name.clone()),
        mode: record.mode.clone(),
        status: record.status.clone(),
        reason: reason.to_string(),
        created_at: record.created_at,
        expires_at: record.expires_at,
        last_heartbeat_at: record.last_heartbeat_at,
        replay_only,
        observation_generation: Some(record.generation),
        superseded_by_session_id: record.superseded_by_session_id.clone(),
        native_receipt_id: None,
    }
}

fn bridge_enabled() -> bool {
    cfg!(test)
        || std::env::var("UAGENT_ENABLE_UE_EDITOR_BRIDGE")
            .map(|value| value == "1")
            .unwrap_or(false)
}

fn launch_enabled() -> bool {
    std::env::var("UAGENT_ENABLE_UE_EDITOR_LAUNCH")
        .map(|value| value == "1")
        .unwrap_or(false)
}

fn is_allowlisted_launch_arg(arg: &str) -> bool {
    !contains_shell_meta(arg)
        && (arg.ends_with(".uproject")
            || arg.starts_with("-Project=")
            || arg == "-NoSound"
            || arg == "-Unattended=false")
        && !arg.contains("-ExecCmds")
        && !arg.to_lowercase().contains("pythonscript")
        && !arg.to_lowercase().contains("automation")
}

fn is_allowlisted_editor_executable(executable: &str, fixture_launch: bool) -> bool {
    let trimmed = executable.trim();
    if trimmed.is_empty() || contains_shell_meta(trimmed) {
        return false;
    }
    let normalized = trimmed.replace('\\', "/");
    let name = normalized.rsplit('/').next().unwrap_or_default();
    let allowed_name = name == "UnrealEditor.exe" || name == "UnrealEditor-Cmd.exe";
    if !allowed_name {
        return false;
    }
    if fixture_launch {
        return !normalized.contains('/') || normalized.contains("/Engine/Binaries/");
    }
    if !normalized.contains('/') || !normalized.contains("/Engine/Binaries/") {
        return false;
    }
    let path = Path::new(trimmed);
    path.is_absolute()
        && path
            .canonicalize()
            .map(|canonical| canonical.is_file())
            .unwrap_or(false)
}

fn is_allowed_fixture_root(normalized: &str) -> bool {
    normalized == "fixture://lyra"
        || normalized.starts_with("fixture://lyra/")
        || normalized == "fixture://lyra-starter"
        || normalized.starts_with("fixture://lyra-starter/")
}

fn contains_shell_meta(value: &str) -> bool {
    value.contains('&')
        || value.contains('|')
        || value.contains(';')
        || value.contains('`')
        || value.contains('>')
}

fn sanitize_display(value: &str) -> String {
    value.replace(['/', '\\', ':'], "")
}

fn stable_hash(value: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    value.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trusted_roots;
    use std::sync::{Arc, Barrier};
    use std::thread;

    struct EnvironmentRestore(Vec<(&'static str, Option<std::ffi::OsString>)>);

    impl EnvironmentRestore {
        fn set(values: &[(&'static str, String)]) -> Self {
            Self(
                values
                    .iter()
                    .map(|(name, value)| {
                        let previous = std::env::var_os(name);
                        std::env::set_var(name, value);
                        (*name, previous)
                    })
                    .collect(),
            )
        }
    }

    impl Drop for EnvironmentRestore {
        fn drop(&mut self) {
            for (name, previous) in self.0.drain(..) {
                if let Some(previous) = previous {
                    std::env::set_var(name, previous);
                } else {
                    std::env::remove_var(name);
                }
            }
        }
    }

    struct TestDirectory(PathBuf);

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn trust(root: &str) {
        trusted_roots()
            .lock()
            .unwrap()
            .insert(hash_path(&normalize_project_path(root)));
    }

    fn config() -> EditorProcessConfigInput {
        EditorProcessConfigInput {
            project_id: "project:test".to_string(),
            root_ref: "fixture://lyra-starter".to_string(),
            uproject_relative_path: "Game.uproject".to_string(),
            editor_executable: None,
            args: None,
        }
    }

    fn reset() -> std::sync::MutexGuard<'static, ()> {
        let test_guard = crate::reset_shared_registries_for_test();
        trust("fixture://lyra-starter");
        test_guard
    }

    fn attach_fixture() -> (String, String, u64) {
        let discovery = discover_editor_processes(config()).unwrap();
        let process = discovery.processes.first().unwrap().clone();
        let attached = attach_editor_process(EditorAttachInput {
            project_id: "project:test".to_string(),
            root_ref: "fixture://lyra-starter".to_string(),
            uproject_relative_path: "Game.uproject".to_string(),
            process_id: process.id,
            pid_hash: process.pid_hash,
            process_display_name: process.display_name,
            mode: "fixture".to_string(),
        })
        .unwrap();
        (
            attached.session_id.unwrap(),
            attached.root_id.unwrap(),
            attached.created_at,
        )
    }

    fn registered_asset_fixture(label: &str, now: u64) -> (String, String, PathBuf) {
        let root = std::env::temp_dir().join(format!("uagent-f1-{label}-{}", now_millis()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("Game.uproject"), "{}").unwrap();
        let root_ref = root.to_string_lossy().to_string();
        crate::trust_native_project_root(crate::TrustRootInput {
            root_ref: root_ref.clone(),
        })
        .unwrap();
        let trusted_root = crate::resolve_trusted_root_binding(&root_ref).unwrap();
        let observation =
            register_asset_mutation_observation_fixture(&trusted_root, "project:test", label, now);
        (observation.session_id, trusted_root.root_id, root)
    }

    fn real_project_config() -> (EditorProcessConfigInput, std::path::PathBuf) {
        let root = std::env::temp_dir().join(format!("uagent-mvp14-real-{}", now_millis()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("Game.uproject"), "{}").unwrap();
        let root_ref = root.to_string_lossy().to_string();
        trust(&root_ref);
        (
            EditorProcessConfigInput {
                project_id: "project:real".to_string(),
                root_ref,
                uproject_relative_path: "Game.uproject".to_string(),
                editor_executable: None,
                args: None,
            },
            root,
        )
    }

    #[test]
    fn ue_editor_process_discover_attach_status_snapshot_stop_are_read_only() {
        let _test_guard = reset();
        let discovery = discover_editor_processes(config()).unwrap();
        let process = discovery.processes.first().unwrap().clone();
        let attached = attach_editor_process(EditorAttachInput {
            project_id: "project:test".to_string(),
            root_ref: "fixture://lyra-starter".to_string(),
            uproject_relative_path: "Game.uproject".to_string(),
            process_id: process.id,
            pid_hash: process.pid_hash,
            process_display_name: process.display_name,
            mode: "fixture".to_string(),
        })
        .unwrap();
        let session_id = attached.session_id.clone().unwrap();
        let status = read_editor_process_status(EditorObservationSessionIdInput {
            session_id: session_id.clone(),
        })
        .unwrap();
        let snapshot = read_editor_observation_snapshot(EditorObservationSessionIdInput {
            session_id: session_id.clone(),
        })
        .unwrap();
        let stopped =
            stop_editor_observation_session(EditorObservationSessionIdInput { session_id })
                .unwrap();

        assert_eq!(discovery.status, "ready");
        assert_eq!(attached.status, "attached");
        assert_eq!(status.reason, "heartbeat_ok");
        assert!(snapshot
            .read_only_diagnostics
            .contains(&"Save All blocked".to_string()));
        assert_eq!(stopped.reason, "local_observation_stopped");
    }

    #[test]
    fn managed_fixture_termination_transitions_the_existing_observation_to_process_exited() {
        let _guard = reset();
        let (session_id, root_id, root) =
            registered_asset_fixture("managed-termination", now_millis());

        let terminated = terminate_managed_editor_process(
            EditorObservationSessionIdInput {
                session_id: session_id.clone(),
            }
            .into(),
        )
        .unwrap();

        assert_eq!(terminated.status, "degraded");
        assert_eq!(terminated.reason, "process_exited");
        assert_eq!(
            validate_asset_mutation_observation(&session_id, "project:test", &root_id).unwrap_err(),
            "process_exited"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn managed_editor_listener_uses_the_headless_null_rhi_startup_contract() {
        let arguments = managed_editor_headless_arguments(
            Path::new("C:\\Task\\FinalHost.uproject"),
            Path::new("C:\\Task\\DerivedDataCache"),
            49171,
            "task-marker",
        )
        .into_iter()
        .map(|argument| argument.to_string_lossy().into_owned())
        .collect::<Vec<_>>();

        assert_eq!(
            arguments,
            vec![
                "C:\\Task\\FinalHost.uproject",
                "-Unattended",
                "-NoSplash",
                "-NullRHI",
                "-NoSound",
                "-ddc=noshared",
                "-LocalDataCachePath=C:\\Task\\DerivedDataCache",
                "-ModelContextProtocolStartServer",
                "-ModelContextProtocolPort=49171",
                "-UAgentTaskMarker=task-marker",
            ]
        );
    }

    #[test]
    fn task_owned_ddc_cleanup_removes_only_the_exact_phase_directory() {
        let _guard = reset();
        let evidence_root =
            std::env::temp_dir().join(format!("uagent-managed-ddc-cleanup-{}", now_millis()));
        let ddc = evidence_root.join("managed-ue-ddc").join("ui-lifecycle");
        std::fs::create_dir_all(&ddc).unwrap();
        std::fs::write(ddc.join("cache.bin"), b"owned-cache").unwrap();
        let evidence_root = std::fs::canonicalize(&evidence_root).unwrap();
        let ddc = std::fs::canonicalize(&ddc).unwrap();

        cleanup_task_owned_ddc(&evidence_root, &ddc, "ui-lifecycle").unwrap();

        assert!(evidence_root.is_dir());
        assert!(!ddc.exists());
        assert!(!evidence_root.join("managed-ue-ddc").exists());
        std::fs::remove_dir_all(evidence_root).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn managed_guardian_safe_listener_is_live_then_closes_and_removes_ddc() {
        let _guard = reset();
        let evidence_root =
            std::env::temp_dir().join(format!("uagent-managed-guardian-listener-{}", now_millis()));
        let _test_directory = TestDirectory(evidence_root.clone());
        let project = evidence_root.join("FinalHost.uproject");
        let ddc = evidence_root.join("managed-ue-ddc").join("ui-lifecycle");
        std::fs::create_dir_all(&ddc).unwrap();
        std::fs::write(&project, b"{}").unwrap();
        let port_probe = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = port_probe.local_addr().unwrap().port();
        drop(port_probe);
        let executable = std::env::current_exe().unwrap();
        let _environment = EnvironmentRestore::set(&[
            (GUARDIAN_UE_EXECUTABLE_ENV, executable.display().to_string()),
            (GUARDIAN_UPROJECT_ENV, project.display().to_string()),
            (GUARDIAN_PORT_ENV, port.to_string()),
            (GUARDIAN_MARKER_ENV, "test-marker".to_string()),
            (GUARDIAN_TASK_ENV, "TASK-GUARDIAN-TEST".to_string()),
            (GUARDIAN_PHASE_ENV, "ui-lifecycle".to_string()),
            (GUARDIAN_DDC_ENV, ddc.display().to_string()),
            (
                GUARDIAN_EVIDENCE_ROOT_ENV,
                evidence_root.display().to_string(),
            ),
            (GUARDIAN_TEST_LISTENER_ENV, "1".to_string()),
        ]);

        run_managed_editor_guardian().unwrap();

        assert!(!loopback_port_accepting(port));
        assert!(!ddc.exists());
        assert!(!evidence_root.join("managed-ue-ddc").exists());
    }

    #[cfg(windows)]
    #[test]
    fn windows_process_creation_filetime_round_trips_as_an_exact_decimal_string() {
        let _guard = reset();
        let mut child = Command::new("powershell.exe")
            .args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "Start-Sleep -Seconds 30",
            ])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let creation = observe_process_start_time(child.id()).unwrap();
        let encoded = creation.to_string();
        assert!(creation > 9_007_199_254_740_991);
        assert_eq!(
            parse_canonical_process_creation_filetime(&encoded),
            Some(creation)
        );
        assert_eq!(parse_canonical_process_creation_filetime("01"), None);
        let _ = child.kill();
        let _ = child.wait();
    }

    #[test]
    fn newer_attach_atomically_supersedes_the_previous_native_observation_generation() {
        let _guard = reset();
        let discovery = discover_editor_processes(config()).unwrap();
        let process = discovery.processes.first().unwrap().clone();
        let input = EditorAttachInput {
            project_id: "project:test".to_string(),
            root_ref: "fixture://lyra-starter".to_string(),
            uproject_relative_path: "Game.uproject".to_string(),
            process_id: process.id,
            pid_hash: process.pid_hash,
            process_display_name: process.display_name,
            mode: "fixture".to_string(),
        };
        let predecessor = attach_editor_process(input.clone()).unwrap();
        let successor = attach_editor_process(input).unwrap();
        let predecessor_id = predecessor.session_id.unwrap();
        let successor_id = successor.session_id.unwrap();
        let root_id = successor.root_id.unwrap();

        assert_ne!(predecessor_id, successor_id);
        assert!(
            successor.observation_generation.unwrap() > predecessor.observation_generation.unwrap()
        );
        assert_eq!(
            validate_asset_mutation_observation(&predecessor_id, "project:test", &root_id)
                .unwrap_err(),
            "stale_generation"
        );
        assert_eq!(
            read_editor_process_status(EditorObservationSessionIdInput {
                session_id: predecessor_id,
            })
            .unwrap()
            .reason,
            "stale_generation"
        );
        let successor_status = read_editor_process_status(EditorObservationSessionIdInput {
            session_id: successor_id,
        })
        .unwrap();
        assert_eq!(successor_status.status, "attached");
        assert_eq!(successor_status.reason, "heartbeat_ok");
    }

    #[test]
    fn ue_editor_process_status_does_not_revive_stop_during_lifecycle_check() {
        let _test_guard = reset();
        let (session_id, _, created_at) = attach_fixture();
        let process_id = observation_registry()
            .lock()
            .unwrap()
            .get(&session_id)
            .unwrap()
            .process_id
            .clone();
        process_registry()
            .lock()
            .unwrap()
            .get_mut(&process_id)
            .unwrap()
            .source = "native".to_string();
        let before_session = observation_registry()
            .lock()
            .unwrap()
            .get(&session_id)
            .unwrap()
            .clone();
        let before_process = process_registry()
            .lock()
            .unwrap()
            .get(&process_id)
            .unwrap()
            .clone();
        let barrier = Arc::new(Barrier::new(2));
        let worker_barrier = Arc::clone(&barrier);
        let worker_session_id = session_id.clone();

        let worker = thread::spawn(move || {
            read_editor_process_status_at_with(
                EditorObservationSessionIdInput {
                    session_id: worker_session_id,
                },
                created_at + 1,
                move |_| {
                    worker_barrier.wait();
                    worker_barrier.wait();
                    NativeLifecycleCheck {
                        alive: true,
                        reason: "heartbeat_ok".to_string(),
                    }
                },
            )
            .unwrap()
        });

        barrier.wait();
        stop_editor_observation_session(EditorObservationSessionIdInput {
            session_id: session_id.clone(),
        })
        .unwrap();
        barrier.wait();
        let result = worker.join().unwrap();
        let after_session = observation_registry()
            .lock()
            .unwrap()
            .get(&session_id)
            .unwrap()
            .clone();
        let after_process = process_registry()
            .lock()
            .unwrap()
            .get(&process_id)
            .unwrap()
            .clone();

        assert_eq!(result.status, "stopped");
        assert_eq!(result.reason, "local_observation_stopped");
        assert_eq!(after_session.status, "stopped");
        assert_eq!(
            after_session.last_heartbeat_at,
            before_session.last_heartbeat_at
        );
        assert_eq!(after_session.expires_at, before_session.expires_at);
        assert_eq!(after_process.expires_at, before_process.expires_at);
    }

    #[test]
    fn ue_editor_process_validator_process_removal_does_not_partially_renew() {
        let _test_guard = reset();
        let created_at = 100;
        let (session_id, root_id, root) = registered_asset_fixture("process-removal", created_at);
        let before_session = observation_registry()
            .lock()
            .unwrap()
            .get(&session_id)
            .unwrap()
            .clone();
        let process_id = before_session.process_id.clone();
        let process_id_for_hook = process_id.clone();
        let result = validate_asset_mutation_observation_at_with(
            &session_id,
            "project:test",
            &root_id,
            created_at + 1,
            |_| unreachable!("fixture validation does not use a native lifecycle probe"),
            move || {
                process_registry()
                    .lock()
                    .unwrap()
                    .remove(&process_id_for_hook);
            },
        );

        assert_eq!(result, Err("process_exited"));
        assert_eq!(
            observation_registry()
                .lock()
                .unwrap()
                .get(&session_id)
                .unwrap(),
            &before_session
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ue_editor_process_validator_identity_replacement_does_not_renew_either_record() {
        let _test_guard = reset();
        let created_at = 200;
        let (session_id, root_id, root) =
            registered_asset_fixture("identity-replacement", created_at);
        let before_session = observation_registry()
            .lock()
            .unwrap()
            .get(&session_id)
            .unwrap()
            .clone();
        let process_id = before_session.process_id.clone();
        let replacement = Arc::new(Mutex::new(None));
        let replacement_from_hook = Arc::clone(&replacement);
        let process_id_for_hook = process_id.clone();
        let result = validate_asset_mutation_observation_at_with(
            &session_id,
            "project:test",
            &root_id,
            created_at + 1,
            |_| unreachable!("fixture validation does not use a native lifecycle probe"),
            move || {
                let replacement_record = {
                    let mut processes = process_registry().lock().unwrap();
                    let record = processes.get_mut(&process_id_for_hook).unwrap();
                    record.pid = Some(999);
                    record.process_start_time = Some(777);
                    record.pid_hash = "pid:replacement".to_string();
                    record.project_id = "project:replacement".to_string();
                    record.root_id = "root:replacement".to_string();
                    record.display_executable_hash = "exe:replacement".to_string();
                    record.expires_at = created_at + 17;
                    record.clone()
                };
                *replacement_from_hook.lock().unwrap() = Some(replacement_record);
            },
        );
        let replacement = replacement.lock().unwrap().clone().unwrap();

        assert_eq!(result, Err("native_authority_unavailable"));
        assert_eq!(
            observation_registry()
                .lock()
                .unwrap()
                .get(&session_id)
                .unwrap(),
            &before_session
        );
        assert_eq!(
            process_registry().lock().unwrap().get(&process_id).unwrap(),
            &replacement
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ue_editor_process_validator_renews_both_records_to_one_deadline() {
        let _test_guard = reset();
        let created_at = 300;
        let (session_id, root_id, root) = registered_asset_fixture("renew-success", created_at);
        let now = created_at + 1;
        validate_asset_mutation_observation_at(&session_id, "project:test", &root_id, now).unwrap();
        let session = observation_registry()
            .lock()
            .unwrap()
            .get(&session_id)
            .unwrap()
            .clone();
        let process = process_registry()
            .lock()
            .unwrap()
            .get(&session.process_id)
            .unwrap()
            .clone();
        let renewed_until = now + DEFAULT_OBSERVATION_TTL_MILLIS;

        assert_eq!(session.last_heartbeat_at, Some(now));
        assert_eq!(session.expires_at, renewed_until);
        assert_eq!(process.expires_at, renewed_until);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ue_editor_process_blocks_untrusted_root_escape_network_and_launch_gate() {
        let _test_guard = crate::reset_shared_registries_for_test();
        trusted_roots().lock().unwrap().clear();
        assert_eq!(
            validate_editor_attach_config(config()).unwrap().reason,
            "untrusted_root"
        );
        trust("fixture://lyra-starter");
        let mut root_escape = config();
        root_escape.uproject_relative_path = "../Game.uproject".to_string();
        assert_eq!(
            validate_editor_attach_config(root_escape).unwrap().reason,
            "root_escape"
        );
        let mut network = config();
        network.root_ref = "\\\\server\\project".to_string();
        assert_eq!(
            validate_editor_attach_config(network).unwrap().reason,
            "network_root"
        );
        assert_eq!(
            launch_editor_process(config()).unwrap().reason,
            "launch_feature_disabled"
        );
    }

    #[test]
    fn ue_editor_process_rejects_forged_attach_descriptor() {
        let _test_guard = reset();
        let discovery = discover_editor_processes(config()).unwrap();
        let process = discovery.processes.first().unwrap().clone();

        let forged_pid = attach_editor_process(EditorAttachInput {
            project_id: "project:test".to_string(),
            root_ref: "fixture://lyra-starter".to_string(),
            uproject_relative_path: "Game.uproject".to_string(),
            process_id: process.id.clone(),
            pid_hash: "pid:forged".to_string(),
            process_display_name: "ForgedEditor.exe".to_string(),
            mode: "fixture".to_string(),
        })
        .unwrap();
        let unknown_process = attach_editor_process(EditorAttachInput {
            project_id: "project:test".to_string(),
            root_ref: "fixture://lyra-starter".to_string(),
            uproject_relative_path: "Game.uproject".to_string(),
            process_id: "process:unknown".to_string(),
            pid_hash: process.pid_hash,
            process_display_name: process.display_name,
            mode: "fixture".to_string(),
        })
        .unwrap();

        assert_eq!(forged_pid.status, "blocked");
        assert_eq!(forged_pid.reason, "pid_hash_mismatch");
        assert_eq!(unknown_process.status, "blocked");
        assert_eq!(unknown_process.reason, "process_not_found");
    }

    #[test]
    fn ue_editor_process_requires_existing_real_uproject_inside_trusted_root() {
        let _test_guard = crate::reset_shared_registries_for_test();
        trusted_roots().lock().unwrap().clear();
        let root = std::env::temp_dir().join(format!("uagent-mvp14-{}", now_millis()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("Game.uproject"), "{}").unwrap();
        let root_ref = root.to_string_lossy().to_string();
        trust(&root_ref);

        let mut input = EditorProcessConfigInput {
            project_id: "project:real".to_string(),
            root_ref: root_ref.clone(),
            uproject_relative_path: "Game.uproject".to_string(),
            editor_executable: None,
            args: None,
        };
        assert_eq!(
            validate_editor_attach_config(input.clone()).unwrap().reason,
            "valid"
        );

        input.uproject_relative_path = "Missing.uproject".to_string();
        assert_eq!(
            validate_editor_attach_config(input.clone()).unwrap().reason,
            "missing_uproject"
        );

        input.uproject_relative_path = "../Game.uproject".to_string();
        assert_eq!(
            validate_editor_attach_config(input).unwrap().reason,
            "root_escape"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ue_editor_process_real_root_discovery_degrades_without_fake_native_process() {
        let _test_guard = reset();
        let (input, root) = real_project_config();

        let discovery = discover_editor_processes(input).unwrap();

        assert_eq!(discovery.status, "degraded");
        assert!(
            discovery.reason == "native_discovery_unavailable"
                || discovery.reason == "platform_unsupported"
                || discovery.reason == "process_not_found"
                || discovery.reason == "project_mismatch",
            "unexpected discovery reason: {}",
            discovery.reason
        );
        assert!(discovery.processes.is_empty());
        assert!(process_registry().lock().unwrap().is_empty());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ue_editor_process_native_candidate_matching_redacts_raw_paths() {
        let _test_guard = reset();
        let (input, root) = real_project_config();
        let validation =
            validate_config_details(input.clone()).expect("real config should validate");
        let raw_uproject = root.join("Game.uproject").canonicalize().unwrap();
        let raw_executable =
            "C:\\Program Files\\Epic Games\\UE_5.8\\Engine\\Binaries\\Win64\\UnrealEditor.exe";
        let candidates = vec![
            NativeProcessCandidate {
                pid: 42,
                start_time: 100,
                executable_name: "UnrealEditor.exe".to_string(),
                executable_path: Some(raw_executable.to_string()),
                command_line: vec![
                    raw_executable.to_string(),
                    raw_uproject.to_string_lossy().to_string(),
                    "-NoSound".to_string(),
                ],
            },
            NativeProcessCandidate {
                pid: 43,
                start_time: 101,
                executable_name: "NotUnrealEditor.exe".to_string(),
                executable_path: Some("C:\\Tools\\NotUnrealEditor.exe".to_string()),
                command_line: vec![
                    "C:\\Tools\\NotUnrealEditor.exe".to_string(),
                    raw_uproject.to_string_lossy().to_string(),
                ],
            },
        ];

        let built = build_native_discovery_from_candidates(&input, &validation, &candidates, 123);
        let serialized = serde_json::to_string(&built.result).unwrap();

        assert_eq!(built.result.status, "ready");
        assert_eq!(built.result.reason, "native_process_matched");
        assert_eq!(built.records.len(), 1);
        assert_eq!(built.result.processes[0].display_name, "UnrealEditor.exe");
        assert_eq!(built.result.processes[0].source, "native");
        assert_eq!(
            built.result.processes[0].display_project_hint,
            "[project-root]/Game.uproject"
        );
        assert!(!serialized.contains(&raw_uproject.to_string_lossy().to_string()));
        assert!(!serialized.contains("Program Files"));
        assert!(!serialized.contains("command"));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ue_editor_process_native_candidate_project_mismatch_returns_no_descriptor() {
        let _test_guard = reset();
        let (input, root) = real_project_config();
        let validation =
            validate_config_details(input.clone()).expect("real config should validate");
        let other_root = std::env::temp_dir().join(format!("uagent-mvp14-other-{}", now_millis()));
        std::fs::create_dir_all(&other_root).unwrap();
        std::fs::write(other_root.join("Other.uproject"), "{}").unwrap();
        let other_uproject = other_root.join("Other.uproject").canonicalize().unwrap();
        let candidates = vec![NativeProcessCandidate {
            pid: 50,
            start_time: 200,
            executable_name: "UnrealEditor-Cmd.exe".to_string(),
            executable_path: None,
            command_line: vec![
                "UnrealEditor-Cmd.exe".to_string(),
                format!("-Project={}", other_uproject.to_string_lossy()),
            ],
        }];

        let built = build_native_discovery_from_candidates(&input, &validation, &candidates, 456);
        let serialized = serde_json::to_string(&built.result).unwrap();

        assert_eq!(built.result.status, "degraded");
        assert_eq!(built.result.reason, "project_mismatch");
        assert!(built.result.processes.is_empty());
        assert!(built.records.is_empty());
        assert!(!serialized.contains(&other_uproject.to_string_lossy().to_string()));

        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(other_root);
    }

    #[test]
    fn ue_editor_process_native_lifecycle_rechecks_candidate_metadata() {
        let _test_guard = reset();
        let (input, root) = real_project_config();
        let validation =
            validate_config_details(input.clone()).expect("real config should validate");
        let raw_uproject = root.join("Game.uproject").canonicalize().unwrap();
        let candidates = vec![NativeProcessCandidate {
            pid: 77,
            start_time: 300,
            executable_name: "UnrealEditor.exe".to_string(),
            executable_path: None,
            command_line: vec![
                "UnrealEditor.exe".to_string(),
                raw_uproject.to_string_lossy().to_string(),
            ],
        }];
        let built = build_native_discovery_from_candidates(&input, &validation, &candidates, 789);
        let record = built.records.first().expect("matched record");

        let alive = check_native_record_against_candidates(record, &candidates);
        let exited = check_native_record_against_candidates(record, &[]);
        let mismatched = check_native_record_against_candidates(
            record,
            &[NativeProcessCandidate {
                pid: 77,
                start_time: 300,
                executable_name: "UnrealEditor.exe".to_string(),
                executable_path: None,
                command_line: vec![
                    "UnrealEditor.exe".to_string(),
                    "C:\\Other\\Other.uproject".to_string(),
                ],
            }],
        );
        let reused_pid = check_native_record_against_candidates(
            record,
            &[NativeProcessCandidate {
                pid: 77,
                start_time: 301,
                executable_name: "UnrealEditor.exe".to_string(),
                executable_path: None,
                command_line: vec![
                    "UnrealEditor.exe".to_string(),
                    raw_uproject.to_string_lossy().to_string(),
                ],
            }],
        );

        assert!(alive.alive);
        assert_eq!(alive.reason, "heartbeat_ok");
        assert!(!exited.alive);
        assert_eq!(exited.reason, "process_exited");
        assert!(!mismatched.alive);
        assert_eq!(mismatched.reason, "project_mismatch");
        assert!(!reused_pid.alive);
        assert_eq!(reused_pid.reason, "process_exited");

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ue_editor_process_non_fixture_status_and_snapshot_degrade_without_lifecycle_observation() {
        let _test_guard = reset();
        let (input, root) = real_project_config();
        let validation = validate_config(input.clone());
        let root_id = validation.root_id.unwrap();
        let uproject_display_path = validation.uproject_display_path.unwrap();
        let session_id = "editor-observation:real-without-lifecycle".to_string();
        observation_registry().lock().unwrap().insert(
            session_id.clone(),
            ObservationSessionRecord {
                session_id: session_id.clone(),
                process_id: "process:missing-lifecycle".to_string(),
                project_id: input.project_id,
                root_id,
                uproject_display_path,
                pid_hash: "pid:real".to_string(),
                process_display_name: "UnrealEditor.exe".to_string(),
                source: "native".to_string(),
                mode: "attached".to_string(),
                status: "attached".to_string(),
                generation: next_observation_generation(),
                superseded_by_session_id: None,
                created_at: now_millis(),
                expires_at: now_millis() + DEFAULT_OBSERVATION_TTL_MILLIS,
                last_heartbeat_at: None,
            },
        );

        let status = read_editor_process_status(EditorObservationSessionIdInput {
            session_id: session_id.clone(),
        })
        .unwrap();
        let snapshot =
            read_editor_observation_snapshot(EditorObservationSessionIdInput { session_id })
                .unwrap();

        assert_eq!(status.status, "degraded");
        assert_eq!(status.reason, "process_unavailable");
        assert_eq!(status.last_heartbeat_at, None);
        assert_eq!(snapshot.editor_state, "degraded");
        assert!(!snapshot.process_alive);
        assert!(snapshot
            .read_only_diagnostics
            .contains(&"process_unavailable".to_string()));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ue_editor_process_launch_blocks_forged_executable_and_bad_args_before_non_execution() {
        let _test_guard = reset();
        std::env::set_var("UAGENT_ENABLE_UE_EDITOR_LAUNCH", "1");

        let mut forged_executable = config();
        forged_executable.editor_executable = Some("C:/tmp/ForgedEditor.exe".to_string());
        forged_executable.args = Some(vec!["Game.uproject".to_string()]);
        assert_eq!(
            launch_editor_process(forged_executable).unwrap().reason,
            "executable_outside_allowlist",
        );

        let mut bad_args = config();
        bad_args.editor_executable = Some("UnrealEditor.exe".to_string());
        bad_args.args = Some(vec!["-ExecCmds=SaveAll".to_string()]);
        assert_eq!(
            launch_editor_process(bad_args).unwrap().reason,
            "launch_arg_blocked"
        );

        let (mut real_bare_executable, root) = real_project_config();
        real_bare_executable.editor_executable = Some("UnrealEditor.exe".to_string());
        real_bare_executable.args = Some(vec!["Game.uproject".to_string()]);
        assert_eq!(
            launch_editor_process(real_bare_executable).unwrap().reason,
            "executable_outside_allowlist",
        );

        let mut allowed_args = config();
        allowed_args.editor_executable = Some("UnrealEditor.exe".to_string());
        allowed_args.args = Some(vec!["Game.uproject".to_string(), "-NoSound".to_string()]);
        assert_eq!(
            launch_editor_process(allowed_args).unwrap().reason,
            "launch_not_executed_in_test_path",
        );

        std::env::remove_var("UAGENT_ENABLE_UE_EDITOR_LAUNCH");
        let _ = std::fs::remove_dir_all(root);
    }
}
