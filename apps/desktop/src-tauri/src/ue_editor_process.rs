#[cfg(test)]
use crate::TrustedRootBinding;
use crate::{
    hash_path, is_trusted_root, normalize_project_path, redact_path_for_ui,
    resolve_trusted_root_binding_by_id,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

const DEFAULT_OBSERVATION_TTL_MILLIS: u64 = 2 * 60 * 1000;

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
    if process.source == "native" {
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
    })
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
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorProcessDiscoveryResult {
    pub status: String,
    pub reason: String,
    pub processes: Vec<EditorProcessDescriptor>,
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
}

#[tauri::command]
pub fn attach_editor_process(
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
    if process.source == "native" {
        let check = check_native_record_current(&process);
        if !check.alive {
            return Ok(blocked_session(
                &input.project_id,
                &input.mode,
                &check.reason,
            ));
        }
    }
    let record = ObservationSessionRecord {
        session_id: format!(
            "editor-observation:{}",
            stable_hash(&format!(
                "{}:{}:{}",
                process.project_id, process.root_id, process.pid_hash
            ))
        ),
        process_id: process.process_id,
        project_id: input.project_id,
        root_id,
        uproject_display_path,
        pid_hash: process.pid_hash,
        process_display_name: sanitize_display(&process.display_name),
        source: process.source,
        mode: input.mode,
        status: "attached".to_string(),
        created_at: now,
        expires_at: now + DEFAULT_OBSERVATION_TTL_MILLIS,
        last_heartbeat_at: None,
    };
    observation_registry()
        .lock()
        .unwrap()
        .insert(record.session_id.clone(), record.clone());
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
#[serde(rename_all = "camelCase")]
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
        Some(process) if process.source == "native" => lifecycle_check(process),
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
        return Ok(blocked_session("", "stopped", "session_not_found"));
    };
    record.status = "stopped".to_string();
    Ok(session_result(record, "local_observation_stopped", false))
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
    match enumerate_native_processes() {
        Ok(candidates) => check_native_record_against_candidates(record, &candidates),
        Err(reason) => NativeLifecycleCheck {
            alive: false,
            reason,
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
        .map(|(pid, process)| NativeProcessCandidate {
            pid: pid.as_u32(),
            start_time: process.start_time(),
            executable_name: process.name().to_string(),
            executable_path: process.exe().map(|path| path.to_string_lossy().to_string()),
            command_line: process.cmd().to_vec(),
        })
        .collect())
}

#[cfg(not(windows))]
fn enumerate_native_processes() -> Result<Vec<NativeProcessCandidate>, String> {
    Err("platform_unsupported".to_string())
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
    }
}

fn session_result(
    record: &ObservationSessionRecord,
    reason: &str,
    replay_only: bool,
) -> EditorObservationSessionResult {
    EditorObservationSessionResult {
        session_id: Some(record.session_id.clone()),
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

    fn reset() {
        trusted_roots().lock().unwrap().clear();
        observation_registry().lock().unwrap().clear();
        process_registry().lock().unwrap().clear();
        trust("fixture://lyra-starter");
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
        reset();
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
    fn ue_editor_process_status_does_not_revive_stop_during_lifecycle_check() {
        reset();
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
        reset();
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
        reset();
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
        reset();
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
        reset();
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
        reset();
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
        reset();
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
        reset();
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
        reset();
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
        reset();
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
        reset();
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
