use crate::{hash_path, is_trusted_root, normalize_project_path, redact_path_for_ui};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::path::Path;
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

#[derive(Debug, Clone)]
struct ObservationSessionRecord {
    session_id: String,
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

#[derive(Debug, Clone)]
struct DiscoveredProcessRecord {
    process_id: String,
    pid_hash: String,
    project_id: String,
    root_id: String,
    uproject_display_path: String,
    display_project_hint: String,
    display_executable_hash: String,
    display_name: String,
    process_state: String,
    source: String,
    discovered_at: u64,
    expires_at: u64,
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
        mode: if bridge_enabled() { "native".to_string() } else { "disabled".to_string() },
        reason: if bridge_enabled() { "ue_editor_bridge_feature_enabled".to_string() } else { "feature_disabled".to_string() },
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
pub fn discover_editor_processes(input: EditorProcessConfigInput) -> Result<EditorProcessDiscoveryResult, String> {
    if !bridge_enabled() {
        return Ok(blocked_discovery("feature_disabled"));
    }
    let validation = validate_editor_attach_config(input.clone())?;
    if !validation.ok {
        return Ok(blocked_discovery(&validation.reason));
    }
    if !normalize_project_path(&input.root_ref).starts_with("fixture://") {
        return Ok(degraded_discovery("native_discovery_unavailable"));
    }
    let now = now_millis();
    let root_id = validation.root_id.clone().unwrap_or_else(|| hash_path(&normalize_project_path(&input.root_ref)));
    let uproject_display_path = validation
        .uproject_display_path
        .clone()
        .unwrap_or_else(|| "[project-root]/Game.uproject".to_string());
    let process_id = format!("process:{}", stable_hash(&format!("{}:{}:{}", input.project_id, root_id, uproject_display_path)));
    let pid_hash = format!("pid:{}", stable_hash(&format!("{}:{}", input.project_id, process_id)));
    let source = "fixture".to_string();
    let expires_at = now + DEFAULT_OBSERVATION_TTL_MILLIS;
    let record = DiscoveredProcessRecord {
        process_id,
        pid_hash,
        project_id: input.project_id,
        root_id,
        uproject_display_path: uproject_display_path.clone(),
        display_project_hint: uproject_display_path,
        display_executable_hash: "exe:unreal-editor".to_string(),
        display_name: "UnrealEditor.exe".to_string(),
        process_state: "running".to_string(),
        source,
        discovered_at: now,
        expires_at,
    };
    process_registry().lock().unwrap().insert(record.process_id.clone(), record.clone());
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
pub fn validate_editor_attach_config(input: EditorProcessConfigInput) -> Result<EditorAttachValidationResult, String> {
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
pub fn attach_editor_process(input: EditorAttachInput) -> Result<EditorObservationSessionResult, String> {
    let validation = validate_config(EditorProcessConfigInput {
        project_id: input.project_id.clone(),
        root_ref: input.root_ref.clone(),
        uproject_relative_path: input.uproject_relative_path.clone(),
        editor_executable: None,
        args: None,
    });
    if !validation.ok {
        return Ok(blocked_session(&input.project_id, &input.mode, &validation.reason));
    }
    let now = now_millis();
    let root_id = validation.root_id.unwrap_or_else(|| hash_path(&normalize_project_path(&input.root_ref)));
    let uproject_display_path = validation.uproject_display_path.unwrap_or_else(|| "[project-root]/Game.uproject".to_string());
    let process = {
        let registry = process_registry().lock().unwrap();
        registry.get(&input.process_id).cloned()
    };
    let Some(process) = process else {
        return Ok(blocked_session(&input.project_id, &input.mode, "process_not_found"));
    };
    if now > process.expires_at {
        return Ok(blocked_session(&input.project_id, &input.mode, "process_descriptor_expired"));
    }
    if process.pid_hash != input.pid_hash {
        return Ok(blocked_session(&input.project_id, &input.mode, "pid_hash_mismatch"));
    }
    if process.project_id != input.project_id || process.root_id != root_id || process.uproject_display_path != uproject_display_path {
        return Ok(blocked_session(&input.project_id, &input.mode, "pid_session_root_project_mismatch"));
    }
    if process.process_state != "running" {
        return Ok(blocked_session(&input.project_id, &input.mode, "process_unavailable"));
    }
    let record = ObservationSessionRecord {
        session_id: format!("editor-observation:{}", stable_hash(&format!("{}:{}:{}", process.project_id, process.root_id, process.pid_hash))),
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
    observation_registry().lock().unwrap().insert(record.session_id.clone(), record.clone());
    Ok(session_result(&record, "attached", false))
}

#[tauri::command]
pub fn launch_editor_process(input: EditorProcessConfigInput) -> Result<EditorObservationSessionResult, String> {
    if !launch_enabled() {
        return Ok(blocked_session(&input.project_id, "launched", "launch_feature_disabled"));
    }
    let validation = validate_config(input.clone());
    if !validation.ok {
        return Ok(blocked_session(&input.project_id, "launched", &validation.reason));
    }
    let executable = input.editor_executable.unwrap_or_default();
    let fixture_launch = normalize_project_path(&input.root_ref).starts_with("fixture://");
    if !is_allowlisted_editor_executable(&executable, fixture_launch) {
        return Ok(blocked_session(&input.project_id, "launched", "executable_outside_allowlist"));
    }
    let args = input.args.unwrap_or_default();
    if !args.iter().all(|arg| is_allowlisted_launch_arg(arg)) {
        return Ok(blocked_session(&input.project_id, "launched", "launch_arg_blocked"));
    }
    let mut command = Command::new(executable);
    command.env_clear();
    for arg in &args {
        command.arg(arg);
    }
    Ok(blocked_session(&input.project_id, "launched", "launch_not_executed_in_test_path"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorObservationSessionIdInput {
    pub session_id: String,
}

#[tauri::command]
pub fn read_editor_process_status(input: EditorObservationSessionIdInput) -> Result<EditorObservationSessionResult, String> {
    let mut registry = observation_registry().lock().unwrap();
    let Some(record) = registry.get_mut(&input.session_id) else {
        return Ok(blocked_session("", "unknown", "session_not_found"));
    };
    if now_millis() > record.expires_at && record.status != "stopped" {
        record.status = "expired".to_string();
        return Ok(session_result(record, "session_expired", false));
    }
    if record.source != "fixture" {
        record.status = "degraded".to_string();
        return Ok(session_result(record, "native_process_observation_unavailable", false));
    }
    record.last_heartbeat_at = Some(now_millis());
    Ok(session_result(record, "heartbeat_ok", false))
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
pub fn read_editor_observation_snapshot(input: EditorObservationSessionIdInput) -> Result<EditorObservationSnapshotResult, String> {
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
    if record.source != "fixture" {
        return Ok(EditorObservationSnapshotResult {
            session_id: record.session_id.clone(),
            editor_state: "degraded".to_string(),
            session_state: "degraded".to_string(),
            project_matched: true,
            process_alive: false,
            last_heartbeat_at: record.last_heartbeat_at,
            display_project: record.uproject_display_path.clone(),
            display_process: record.process_display_name.clone(),
            read_only_diagnostics: vec![
                "native_process_observation_unavailable".to_string(),
                "Save All blocked".to_string(),
                "MCP mutation default blocked".to_string(),
            ],
            created_at: now_millis(),
        });
    }
    Ok(EditorObservationSnapshotResult {
        session_id: record.session_id.clone(),
        editor_state: "attached".to_string(),
        session_state: record.status.clone(),
        project_matched: true,
        process_alive: record.status != "expired" && record.status != "stopped",
        last_heartbeat_at: record.last_heartbeat_at,
        display_project: record.uproject_display_path.clone(),
        display_process: record.process_display_name.clone(),
        read_only_diagnostics: vec![
            "process metadata only".to_string(),
            "Save All blocked".to_string(),
            "MCP mutation default blocked".to_string(),
        ],
        created_at: now_millis(),
    })
}

#[tauri::command]
pub fn stop_editor_observation_session(input: EditorObservationSessionIdInput) -> Result<EditorObservationSessionResult, String> {
    let mut registry = observation_registry().lock().unwrap();
    let Some(record) = registry.get_mut(&input.session_id) else {
        return Ok(blocked_session("", "stopped", "session_not_found"));
    };
    record.status = "stopped".to_string();
    Ok(session_result(record, "local_observation_stopped", false))
}

fn validate_config(input: EditorProcessConfigInput) -> EditorAttachValidationResult {
    if !bridge_enabled() {
        return blocked_validation("feature_disabled", &input.root_ref);
    }
    let raw = input.root_ref.trim();
    if raw.starts_with("//") || raw.starts_with("\\\\") {
        return blocked_validation("network_root", raw);
    }
    let normalized = normalize_project_path(&input.root_ref);
    if !is_trusted_root(&normalized) {
        return blocked_validation("untrusted_root", &normalized);
    }
    if input.uproject_relative_path.contains("..")
        || input.uproject_relative_path.starts_with('/')
        || input.uproject_relative_path.starts_with('\\')
    {
        return blocked_validation("root_escape", &normalized);
    }
    if !input.uproject_relative_path.ends_with(".uproject") {
        return blocked_validation("missing_uproject", &normalized);
    }
    if normalized.starts_with("fixture://") {
        if !is_allowed_fixture_root(&normalized) {
            return blocked_validation("untrusted_root", &normalized);
        }
        return EditorAttachValidationResult {
            ok: true,
            reason: "valid".to_string(),
            root_id: Some(hash_path(&normalized)),
            display_root: redact_path_for_ui(&normalized),
            uproject_display_path: Some(format!("[project-root]/{}", normalize_project_path(&input.uproject_relative_path))),
        };
    }
    let root_path = Path::new(&normalized);
    let Ok(canonical_root) = root_path.canonicalize() else {
        return blocked_validation("missing_uproject", &normalized);
    };
    let target = root_path.join(&input.uproject_relative_path);
    let Ok(canonical_target) = target.canonicalize() else {
        return blocked_validation("missing_uproject", &normalized);
    };
    if !canonical_target.starts_with(&canonical_root) {
        return blocked_validation("root_escape", &normalized);
    }
    if !canonical_target.is_file()
        || canonical_target.extension().and_then(|ext| ext.to_str()).map(|ext| ext.eq_ignore_ascii_case("uproject")) != Some(true)
    {
        return blocked_validation("missing_uproject", &normalized);
    }
    EditorAttachValidationResult {
        ok: true,
        reason: "valid".to_string(),
        root_id: Some(hash_path(&normalized)),
        display_root: redact_path_for_ui(&normalized),
        uproject_display_path: Some(format!("[project-root]/{}", normalize_project_path(&input.uproject_relative_path))),
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
    EditorProcessDiscoveryResult { status: "blocked".to_string(), reason: reason.to_string(), processes: Vec::new() }
}

fn degraded_discovery(reason: &str) -> EditorProcessDiscoveryResult {
    EditorProcessDiscoveryResult { status: "degraded".to_string(), reason: reason.to_string(), processes: Vec::new() }
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

fn session_result(record: &ObservationSessionRecord, reason: &str, replay_only: bool) -> EditorObservationSessionResult {
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
    cfg!(test) || std::env::var("UAGENT_ENABLE_UE_EDITOR_BRIDGE").map(|value| value == "1").unwrap_or(false)
}

fn launch_enabled() -> bool {
    std::env::var("UAGENT_ENABLE_UE_EDITOR_LAUNCH").map(|value| value == "1").unwrap_or(false)
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
    path.is_absolute() && path.canonicalize().map(|canonical| canonical.is_file()).unwrap_or(false)
}

fn is_allowed_fixture_root(normalized: &str) -> bool {
    normalized == "fixture://lyra"
        || normalized.starts_with("fixture://lyra/")
        || normalized == "fixture://lyra-starter"
        || normalized.starts_with("fixture://lyra-starter/")
}

fn contains_shell_meta(value: &str) -> bool {
    value.contains('&') || value.contains('|') || value.contains(';') || value.contains('`') || value.contains('>')
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

    fn trust(root: &str) {
        trusted_roots().lock().unwrap().insert(hash_path(&normalize_project_path(root)));
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
        let status = read_editor_process_status(EditorObservationSessionIdInput { session_id: session_id.clone() }).unwrap();
        let snapshot = read_editor_observation_snapshot(EditorObservationSessionIdInput { session_id: session_id.clone() }).unwrap();
        let stopped = stop_editor_observation_session(EditorObservationSessionIdInput { session_id }).unwrap();

        assert_eq!(discovery.status, "ready");
        assert_eq!(attached.status, "attached");
        assert_eq!(status.reason, "heartbeat_ok");
        assert!(snapshot.read_only_diagnostics.contains(&"Save All blocked".to_string()));
        assert_eq!(stopped.reason, "local_observation_stopped");
    }

    #[test]
    fn ue_editor_process_blocks_untrusted_root_escape_network_and_launch_gate() {
        trusted_roots().lock().unwrap().clear();
        assert_eq!(validate_editor_attach_config(config()).unwrap().reason, "untrusted_root");
        trust("fixture://lyra-starter");
        let mut root_escape = config();
        root_escape.uproject_relative_path = "../Game.uproject".to_string();
        assert_eq!(validate_editor_attach_config(root_escape).unwrap().reason, "root_escape");
        let mut network = config();
        network.root_ref = "\\\\server\\project".to_string();
        assert_eq!(validate_editor_attach_config(network).unwrap().reason, "network_root");
        assert_eq!(launch_editor_process(config()).unwrap().reason, "launch_feature_disabled");
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
        assert_eq!(validate_editor_attach_config(input.clone()).unwrap().reason, "valid");

        input.uproject_relative_path = "Missing.uproject".to_string();
        assert_eq!(validate_editor_attach_config(input.clone()).unwrap().reason, "missing_uproject");

        input.uproject_relative_path = "../Game.uproject".to_string();
        assert_eq!(validate_editor_attach_config(input).unwrap().reason, "root_escape");

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn ue_editor_process_real_root_discovery_degrades_without_fake_native_process() {
        reset();
        let (input, root) = real_project_config();

        let discovery = discover_editor_processes(input).unwrap();

        assert_eq!(discovery.status, "degraded");
        assert_eq!(discovery.reason, "native_discovery_unavailable");
        assert!(discovery.processes.is_empty());
        assert!(process_registry().lock().unwrap().is_empty());

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

        let status = read_editor_process_status(EditorObservationSessionIdInput { session_id: session_id.clone() }).unwrap();
        let snapshot = read_editor_observation_snapshot(EditorObservationSessionIdInput { session_id }).unwrap();

        assert_eq!(status.status, "degraded");
        assert_eq!(status.reason, "native_process_observation_unavailable");
        assert_eq!(status.last_heartbeat_at, None);
        assert_eq!(snapshot.editor_state, "degraded");
        assert!(!snapshot.process_alive);
        assert!(snapshot
            .read_only_diagnostics
            .contains(&"native_process_observation_unavailable".to_string()));

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
        assert_eq!(launch_editor_process(bad_args).unwrap().reason, "launch_arg_blocked");

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
