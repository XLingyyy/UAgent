use crate::{hash_path, is_trusted_root, normalize_project_path, redact_path_for_ui};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;

const DEFAULT_SESSION_TTL_MILLIS: u64 = 2 * 60 * 1000;
const DEFAULT_OPERATION_TTL_MILLIS: u64 = 60 * 1000;

fn session_registry() -> &'static Mutex<HashMap<String, NativeEditorSessionRecord>> {
    static REGISTRY: std::sync::OnceLock<Mutex<HashMap<String, NativeEditorSessionRecord>>> =
        std::sync::OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn proposal_registry() -> &'static Mutex<HashMap<String, NativeEditorOperationRecord>> {
    static REGISTRY: std::sync::OnceLock<Mutex<HashMap<String, NativeEditorOperationRecord>>> =
        std::sync::OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn approval_registry() -> &'static Mutex<HashMap<String, NativeEditorApprovalRecord>> {
    static REGISTRY: std::sync::OnceLock<Mutex<HashMap<String, NativeEditorApprovalRecord>>> =
        std::sync::OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone)]
struct NativeEditorSessionRecord {
    session_id: String,
    project_id: String,
    root_id: String,
    uproject_display_path: String,
    mode: String,
    status: String,
    created_at: u64,
    expires_at: u64,
}

#[derive(Debug, Clone)]
struct NativeEditorOperationRecord {
    proposal_id: String,
    session_id: String,
    root_id: String,
    operation_kind: String,
    args_hash: String,
    status: String,
    expires_at: u64,
}

#[derive(Debug, Clone)]
struct NativeEditorApprovalRecord {
    token: String,
    session_id: String,
    root_id: String,
    operation_kind: String,
    args_hash: String,
    expires_at: u64,
    used: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorCapabilityStatus {
    pub enabled: bool,
    pub mode: String,
    pub reason: String,
    pub trusted_root_required: bool,
    pub mutation_execution: String,
}

#[tauri::command]
pub fn editor_capability_status() -> EditorCapabilityStatus {
    editor_capability_status_with_feature(feature_enabled())
}

pub fn editor_capability_status_with_feature(enabled: bool) -> EditorCapabilityStatus {
    EditorCapabilityStatus {
        enabled,
        mode: if enabled { "native".to_string() } else { "disabled".to_string() },
        reason: if enabled {
            "ue_editor_bridge_feature_enabled".to_string()
        } else {
            "feature_disabled".to_string()
        },
        trusted_root_required: true,
        mutation_execution: if enabled { "state_only".to_string() } else { "blocked".to_string() },
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorConfigInput {
    pub project_id: String,
    pub root_ref: String,
    pub uproject_relative_path: String,
    pub editor_executable: Option<String>,
    pub args: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorConfigValidationResult {
    pub ok: bool,
    pub reason: String,
    pub root_id: Option<String>,
    pub display_root: String,
    pub uproject_display_path: Option<String>,
}

#[tauri::command]
pub fn validate_editor_config(input: EditorConfigInput) -> Result<EditorConfigValidationResult, String> {
    Ok(validate_editor_config_with_feature(input, feature_enabled()))
}

pub fn validate_editor_config_with_feature(
    input: EditorConfigInput,
    enabled: bool,
) -> EditorConfigValidationResult {
    if !enabled {
        return blocked_config("feature_disabled", &input.root_ref);
    }
    match resolve_editor_project(&input.root_ref, &input.uproject_relative_path) {
        Ok(project) => EditorConfigValidationResult {
            ok: true,
            reason: "valid".to_string(),
            root_id: Some(project.root_id),
            display_root: project.display_root,
            uproject_display_path: Some(project.uproject_display_path),
        },
        Err(reason) => blocked_config(&reason, &input.root_ref),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSessionResult {
    pub session_id: Option<String>,
    pub project_id: String,
    pub root_id: Option<String>,
    pub status: String,
    pub reason: String,
    pub uproject_display_path: Option<String>,
    pub mode: String,
    pub created_at: u64,
    pub expires_at: u64,
    pub replay_only: bool,
}

#[tauri::command]
pub fn attach_editor_session(input: EditorConfigInput) -> Result<EditorSessionResult, String> {
    Ok(start_session(input, "attached", feature_enabled()))
}

#[tauri::command]
pub fn launch_editor_session(input: EditorConfigInput) -> Result<EditorSessionResult, String> {
    if feature_enabled() {
        if let Some(executable) = &input.editor_executable {
            if !executable.trim().is_empty() {
                let mut command = Command::new(executable);
                for arg in input.args.clone().unwrap_or_default() {
                    command.arg(arg);
                }
            }
        }
    }
    Ok(start_session(input, "launched", feature_enabled()))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSessionIdInput {
    pub session_id: String,
}

#[tauri::command]
pub fn stop_editor_session(input: EditorSessionIdInput) -> Result<EditorSessionResult, String> {
    let mut registry = session_registry().lock().unwrap();
    let Some(record) = registry.get_mut(&input.session_id) else {
        return Ok(blocked_session("session_not_found", None, None, "stopped"));
    };
    record.status = "stopped".to_string();
    Ok(session_result(record, false))
}

#[tauri::command]
pub fn get_editor_session_status(input: EditorSessionIdInput) -> Result<EditorSessionResult, String> {
    let mut registry = session_registry().lock().unwrap();
    let Some(record) = registry.get_mut(&input.session_id) else {
        return Ok(blocked_session("session_not_found", None, None, "unknown"));
    };
    if now_millis() > record.expires_at && record.status != "stopped" {
        record.status = "expired".to_string();
    }
    Ok(session_result(record, false))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorOperationInput {
    pub session_id: String,
    pub operation_kind: String,
    pub args_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorOperationProposalResult {
    pub proposal_id: Option<String>,
    pub session_id: String,
    pub status: String,
    pub reason: String,
    pub risk: String,
    pub args_hash: Option<String>,
    pub expires_at: u64,
}

#[tauri::command]
pub fn propose_editor_operation(input: EditorOperationInput) -> Result<EditorOperationProposalResult, String> {
    let mut sessions = session_registry().lock().unwrap();
    let Some(session) = sessions.get_mut(&input.session_id) else {
        return Ok(blocked_proposal(&input.session_id, "session_not_found"));
    };
    if now_millis() > session.expires_at || session.status == "stopped" {
        session.status = "expired".to_string();
        return Ok(blocked_proposal(&input.session_id, "session_expired"));
    }
    let (risk, reason) = classify_operation(&input.operation_kind);
    if risk.starts_with("blocked") || risk == "text_backed_change" {
        return Ok(EditorOperationProposalResult {
            proposal_id: None,
            session_id: input.session_id,
            status: "blocked".to_string(),
            reason,
            risk,
            args_hash: None,
            expires_at: 0,
        });
    }
    let args_hash = stable_hash(&input.args_json);
    let proposal_id = format!("editor-operation:{}", stable_hash(&format!("{}:{}:{}", input.session_id, input.operation_kind, args_hash)));
    let expires_at = now_millis() + DEFAULT_OPERATION_TTL_MILLIS;
    proposal_registry().lock().unwrap().insert(
        proposal_id.clone(),
        NativeEditorOperationRecord {
            proposal_id: proposal_id.clone(),
            session_id: session.session_id.clone(),
            root_id: session.root_id.clone(),
            operation_kind: input.operation_kind,
            args_hash: args_hash.clone(),
            status: "approval_required".to_string(),
            expires_at,
        },
    );
    Ok(EditorOperationProposalResult {
        proposal_id: Some(proposal_id),
        session_id: session.session_id.clone(),
        status: "approval_required".to_string(),
        reason: "approval_required".to_string(),
        risk,
        args_hash: Some(args_hash),
        expires_at,
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorOperationApprovalInput {
    pub proposal_id: String,
    pub actor: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundEditorOperationApproval {
    pub token: String,
    pub proposal_id: String,
    pub session_id: String,
    pub root_id: String,
    pub operation_kind: String,
    pub args_hash: String,
    pub actor: String,
    pub reason: String,
    pub approved_at: u64,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorOperationApprovalResult {
    pub proposal_id: String,
    pub status: String,
    pub reason: String,
    pub approval: Option<BoundEditorOperationApproval>,
}

#[tauri::command]
pub fn approve_editor_operation(input: EditorOperationApprovalInput) -> Result<EditorOperationApprovalResult, String> {
    let mut proposals = proposal_registry().lock().unwrap();
    let Some(proposal) = proposals.get_mut(&input.proposal_id) else {
        return Ok(blocked_approval(&input.proposal_id, "proposal_not_found"));
    };
    if input.actor.trim().is_empty() || input.reason.trim().is_empty() {
        return Ok(blocked_approval(&input.proposal_id, "approval_actor_required"));
    }
    if now_millis() > proposal.expires_at {
        proposal.status = "expired".to_string();
        return Ok(blocked_approval(&input.proposal_id, "proposal_expired"));
    }
    if proposal.status != "approval_required" && proposal.status != "proposed" {
        return Ok(blocked_approval(&input.proposal_id, "proposal_not_approvable"));
    }
    let approved_at = now_millis();
    let token = format!("editor-approval-token:{}", stable_hash(&format!("{}:{}:{}", proposal.proposal_id, proposal.session_id, proposal.args_hash)));
    let approval = BoundEditorOperationApproval {
        token: token.clone(),
        proposal_id: proposal.proposal_id.clone(),
        session_id: proposal.session_id.clone(),
        root_id: proposal.root_id.clone(),
        operation_kind: proposal.operation_kind.clone(),
        args_hash: proposal.args_hash.clone(),
        actor: input.actor,
        reason: input.reason,
        approved_at,
        expires_at: proposal.expires_at,
    };
    approval_registry().lock().unwrap().insert(
        proposal.proposal_id.clone(),
        NativeEditorApprovalRecord {
            token,
            session_id: proposal.session_id.clone(),
            root_id: proposal.root_id.clone(),
            operation_kind: proposal.operation_kind.clone(),
            args_hash: proposal.args_hash.clone(),
            expires_at: proposal.expires_at,
            used: false,
        },
    );
    proposal.status = "approved".to_string();
    Ok(EditorOperationApprovalResult {
        proposal_id: approval.proposal_id.clone(),
        status: "approved".to_string(),
        reason: "approved".to_string(),
        approval: Some(approval),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteEditorOperationInput {
    pub proposal_id: String,
    pub approval: BoundEditorOperationApproval,
    pub operation_kind: String,
    pub args_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteEditorOperationResult {
    pub proposal_id: String,
    pub status: String,
    pub reason: String,
    pub output_summary: String,
    pub duration_ms: u64,
    pub evidence_id: Option<String>,
    pub replay_only: bool,
}

#[tauri::command]
pub fn execute_editor_operation(input: ExecuteEditorOperationInput) -> Result<ExecuteEditorOperationResult, String> {
    let mut proposals = proposal_registry().lock().unwrap();
    let Some(proposal) = proposals.get_mut(&input.proposal_id) else {
        return Ok(blocked_execute(&input.proposal_id, "proposal_not_found"));
    };
    if now_millis() > proposal.expires_at {
        proposal.status = "expired".to_string();
        return Ok(blocked_execute(&input.proposal_id, "proposal_expired"));
    }
    if proposal.status != "approved" {
        return Ok(blocked_execute(&input.proposal_id, "proposal_not_executable"));
    }
    let mut approvals = approval_registry().lock().unwrap();
    let Some(approval) = approvals.get_mut(&input.proposal_id) else {
        return Ok(blocked_execute(&input.proposal_id, "approval_required"));
    };
    if input.approval.proposal_id != input.proposal_id
        || input.approval.session_id != approval.session_id
        || input.approval.root_id != approval.root_id
        || input.approval.operation_kind != approval.operation_kind
        || input.approval.args_hash != approval.args_hash
        || input.approval.expires_at != approval.expires_at
        || proposal.session_id != approval.session_id
        || proposal.root_id != approval.root_id
        || proposal.operation_kind != approval.operation_kind
        || proposal.args_hash != approval.args_hash
        || proposal.expires_at != approval.expires_at
    {
        return Ok(blocked_execute(&input.proposal_id, "approval_binding_mismatch"));
    }
    if approval.token != input.approval.token {
        return Ok(blocked_execute(&input.proposal_id, "forged_token"));
    }
    if approval.used {
        return Ok(blocked_execute(&input.proposal_id, "approval_replay"));
    }
    if now_millis() > approval.expires_at {
        return Ok(blocked_execute(&input.proposal_id, "approval_expired"));
    }
    if approval.operation_kind != input.operation_kind || approval.args_hash != stable_hash(&input.args_json) {
        return Ok(blocked_execute(&input.proposal_id, "operation_or_args_mismatch"));
    }
    let sessions = session_registry().lock().unwrap();
    let Some(session) = sessions.get(&approval.session_id) else {
        return Ok(blocked_execute(&input.proposal_id, "session_not_found"));
    };
    if session.root_id != approval.root_id {
        return Ok(blocked_execute(&input.proposal_id, "session_or_root_mismatch"));
    }
    if now_millis() > session.expires_at || session.status == "stopped" || session.status == "expired" {
        return Ok(blocked_execute(&input.proposal_id, "session_expired"));
    }
    approval.used = true;
    proposal.status = "executed".to_string();
    Ok(ExecuteEditorOperationResult {
        proposal_id: input.proposal_id.clone(),
        status: "executed".to_string(),
        reason: "executed_state_only".to_string(),
        output_summary: format!("Executed {} without saving UE assets.", input.operation_kind),
        duration_ms: 1,
        evidence_id: Some(format!("evidence:{}", input.proposal_id)),
        replay_only: false,
    })
}

#[tauri::command]
pub fn cancel_editor_operation(input: EditorOperationApprovalInput) -> Result<EditorOperationApprovalResult, String> {
    let mut proposals = proposal_registry().lock().unwrap();
    let Some(proposal) = proposals.get_mut(&input.proposal_id) else {
        return Ok(blocked_approval(&input.proposal_id, "proposal_not_found"));
    };
    proposal.status = "cancelled".to_string();
    if let Some(approval) = approval_registry().lock().unwrap().get_mut(&input.proposal_id) {
        approval.used = true;
    }
    Ok(EditorOperationApprovalResult {
        proposal_id: input.proposal_id,
        status: "cancelled".to_string(),
        reason: "cancelled".to_string(),
        approval: None,
    })
}

fn start_session(input: EditorConfigInput, mode: &str, enabled: bool) -> EditorSessionResult {
    let validation = validate_editor_config_with_feature(input.clone(), enabled);
    if !validation.ok {
        return blocked_session(&validation.reason, None, None, mode);
    }
    let normalized = normalize_project_path(&input.root_ref);
    let root_id = validation.root_id.unwrap_or_else(|| hash_path(&normalized));
    let now = now_millis();
    let session_id = format!("editor-session:{}", stable_hash(&format!("{}:{}:{}", input.project_id, root_id, now)));
    let record = NativeEditorSessionRecord {
        session_id: session_id.clone(),
        project_id: input.project_id,
        root_id: root_id.clone(),
        uproject_display_path: validation.uproject_display_path.unwrap_or_else(|| "[project-root]/Game.uproject".to_string()),
        mode: mode.to_string(),
        status: if mode == "launched" { "launched".to_string() } else { "attached".to_string() },
        created_at: now,
        expires_at: now + DEFAULT_SESSION_TTL_MILLIS,
    };
    session_registry().lock().unwrap().insert(session_id, record.clone());
    session_result(&record, false)
}

struct EditorProject {
    root_id: String,
    display_root: String,
    uproject_display_path: String,
}

fn resolve_editor_project(root_ref: &str, uproject_relative_path: &str) -> Result<EditorProject, String> {
    let raw = root_ref.trim();
    if raw.starts_with("//") || raw.starts_with("\\\\") {
        return Err("network_root".to_string());
    }
    let normalized = normalize_project_path(root_ref);
    if normalized.is_empty() {
        return Err("empty_root".to_string());
    }
    if !is_trusted_root(&normalized) {
        return Err("untrusted_root".to_string());
    }
    if uproject_relative_path.contains("..") || uproject_relative_path.starts_with('/') || uproject_relative_path.starts_with('\\') {
        return Err("root_escape".to_string());
    }
    if !uproject_relative_path.ends_with(".uproject") {
        return Err("missing_uproject".to_string());
    }
    if normalized.starts_with("fixture://") {
        return Ok(EditorProject {
            root_id: hash_path(&normalized),
            display_root: redact_path_for_ui(&normalized),
            uproject_display_path: format!("[project-root]/{}", normalize_project_path(uproject_relative_path)),
        });
    }
    let root = canonicalize(&normalized)?;
    let candidate = root.join(uproject_relative_path);
    let canonical_candidate = canonicalize_path(&candidate)?;
    if !canonical_candidate.starts_with(&root) {
        return Err("root_escape".to_string());
    }
    if !canonical_candidate.is_file() {
        return Err("missing_uproject".to_string());
    }
    Ok(EditorProject {
        root_id: hash_path(&normalized),
        display_root: redact_path_for_ui(root.to_str().unwrap_or(&normalized)),
        uproject_display_path: format!("[project-root]/{}", normalize_project_path(uproject_relative_path)),
    })
}

fn classify_operation(operation_kind: &str) -> (String, String) {
    let read_only: HashSet<&str> = ["status", "run_read_only_validation", "refresh_diagnostics"].into_iter().collect();
    let state_only: HashSet<&str> = ["open_asset", "focus_content_browser", "select_asset", "open_local_preview"].into_iter().collect();
    let asset_write: HashSet<&str> = ["save_asset", "delete_asset", "rename_asset", "move_asset", "compile_blueprint"].into_iter().collect();
    if read_only.contains(operation_kind) {
        return ("read_only".to_string(), "read_only_allowlisted".to_string());
    }
    if state_only.contains(operation_kind) {
        return ("state_only".to_string(), "state_only_allowlisted".to_string());
    }
    if operation_kind == "patch_text_file" {
        return ("text_backed_change".to_string(), "changeset_v2_required".to_string());
    }
    if asset_write.contains(operation_kind) {
        return ("blocked_asset_write".to_string(), "asset_mutation_blocked".to_string());
    }
    ("blocked_unknown".to_string(), "unknown_operation".to_string())
}

fn feature_enabled() -> bool {
    std::env::var("UAGENT_ENABLE_UE_EDITOR_BRIDGE").map(|value| value == "1").unwrap_or(false)
}

fn blocked_config(reason: &str, root_ref: &str) -> EditorConfigValidationResult {
    EditorConfigValidationResult {
        ok: false,
        reason: reason.to_string(),
        root_id: None,
        display_root: redact_path_for_ui(root_ref),
        uproject_display_path: None,
    }
}

fn blocked_session(reason: &str, session_id: Option<String>, root_id: Option<String>, mode: &str) -> EditorSessionResult {
    EditorSessionResult {
        session_id,
        project_id: String::new(),
        root_id,
        status: "blocked".to_string(),
        reason: reason.to_string(),
        uproject_display_path: None,
        mode: mode.to_string(),
        created_at: 0,
        expires_at: 0,
        replay_only: false,
    }
}

fn session_result(record: &NativeEditorSessionRecord, replay_only: bool) -> EditorSessionResult {
    EditorSessionResult {
        session_id: Some(record.session_id.clone()),
        project_id: record.project_id.clone(),
        root_id: Some(record.root_id.clone()),
        status: record.status.clone(),
        reason: record.status.clone(),
        uproject_display_path: Some(record.uproject_display_path.clone()),
        mode: record.mode.clone(),
        created_at: record.created_at,
        expires_at: record.expires_at,
        replay_only,
    }
}

fn blocked_proposal(session_id: &str, reason: &str) -> EditorOperationProposalResult {
    EditorOperationProposalResult {
        proposal_id: None,
        session_id: session_id.to_string(),
        status: "blocked".to_string(),
        reason: reason.to_string(),
        risk: "blocked_unknown".to_string(),
        args_hash: None,
        expires_at: 0,
    }
}

fn blocked_approval(proposal_id: &str, reason: &str) -> EditorOperationApprovalResult {
    EditorOperationApprovalResult {
        proposal_id: proposal_id.to_string(),
        status: "blocked".to_string(),
        reason: reason.to_string(),
        approval: None,
    }
}

fn blocked_execute(proposal_id: &str, reason: &str) -> ExecuteEditorOperationResult {
    ExecuteEditorOperationResult {
        proposal_id: proposal_id.to_string(),
        status: "blocked".to_string(),
        reason: reason.to_string(),
        output_summary: reason.to_string(),
        duration_ms: 0,
        evidence_id: None,
        replay_only: false,
    }
}

fn canonicalize(root: &str) -> Result<PathBuf, String> {
    canonicalize_path(Path::new(root))
}

fn canonicalize_path(path: &Path) -> Result<PathBuf, String> {
    path.canonicalize().map_err(|_| "missing_uproject".to_string())
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
    use std::fs;

    fn trust(root: &str) {
        let normalized = normalize_project_path(root);
        trusted_roots().lock().unwrap().insert(hash_path(&normalized));
    }

    fn input(root_ref: &str, uproject: &str) -> EditorConfigInput {
        EditorConfigInput {
            project_id: "project:test".to_string(),
            root_ref: root_ref.to_string(),
            uproject_relative_path: uproject.to_string(),
            editor_executable: None,
            args: None,
        }
    }

    fn reset_editor_state() {
        trusted_roots().lock().unwrap().clear();
        session_registry().lock().unwrap().clear();
        proposal_registry().lock().unwrap().clear();
        approval_registry().lock().unwrap().clear();
        trust("fixture://lyra-starter");
    }

    fn approved_state_only_operation() -> (String, BoundEditorOperationApproval) {
        let session = start_session(input("fixture://lyra-starter", "Game.uproject"), "attached", true);
        let proposal = propose_editor_operation(EditorOperationInput {
            session_id: session.session_id.unwrap(),
            operation_kind: "select_asset".to_string(),
            args_json: "{\"asset\":\"/Game/Hero\"}".to_string(),
        })
        .unwrap();
        let proposal_id = proposal.proposal_id.unwrap();
        let approval = approve_editor_operation(EditorOperationApprovalInput {
            proposal_id: proposal_id.clone(),
            actor: "tester".to_string(),
            reason: "fixture selection".to_string(),
        })
        .unwrap()
        .approval
        .unwrap();
        (proposal_id, approval)
    }

    #[test]
    fn ue_editor_feature_disabled_by_default() {
        let status = editor_capability_status_with_feature(false);
        assert!(!status.enabled);
        assert_eq!(status.reason, "feature_disabled");
    }

    #[test]
    fn ue_editor_requires_trusted_root() {
        trusted_roots().lock().unwrap().clear();
        let result = validate_editor_config_with_feature(input("fixture://lyra-starter", "Game.uproject"), true);
        assert!(!result.ok);
        assert_eq!(result.reason, "untrusted_root");
    }

    #[test]
    fn ue_editor_blocks_root_escape_network_and_missing_uproject() {
        trusted_roots().lock().unwrap().clear();
        trust("fixture://lyra-starter");
        assert_eq!(
            validate_editor_config_with_feature(input("fixture://lyra-starter", "../Game.uproject"), true).reason,
            "root_escape"
        );
        assert_eq!(
            validate_editor_config_with_feature(input("//server/project", "Game.uproject"), true).reason,
            "network_root"
        );
        assert_eq!(
            validate_editor_config_with_feature(input("fixture://lyra-starter", "Game.txt"), true).reason,
            "missing_uproject"
        );
    }

    #[test]
    fn ue_editor_session_lifecycle_and_state_only_execution() {
        trusted_roots().lock().unwrap().clear();
        session_registry().lock().unwrap().clear();
        proposal_registry().lock().unwrap().clear();
        approval_registry().lock().unwrap().clear();
        trust("fixture://lyra-starter");

        let session = start_session(input("fixture://lyra-starter", "Game.uproject"), "attached", true);
        assert_eq!(session.status, "attached");
        let session_id = session.session_id.clone().unwrap();
        let proposal = propose_editor_operation(EditorOperationInput {
            session_id: session_id.clone(),
            operation_kind: "select_asset".to_string(),
            args_json: "{\"asset\":\"/Game/Hero\"}".to_string(),
        })
        .unwrap();
        assert_eq!(proposal.status, "approval_required");
        let approval = approve_editor_operation(EditorOperationApprovalInput {
            proposal_id: proposal.proposal_id.clone().unwrap(),
            actor: "tester".to_string(),
            reason: "fixture selection".to_string(),
        })
        .unwrap()
        .approval
        .unwrap();
        let executed = execute_editor_operation(ExecuteEditorOperationInput {
            proposal_id: proposal.proposal_id.clone().unwrap(),
            approval: approval.clone(),
            operation_kind: "select_asset".to_string(),
            args_json: "{\"asset\":\"/Game/Hero\"}".to_string(),
        })
        .unwrap();
        let replay = execute_editor_operation(ExecuteEditorOperationInput {
            proposal_id: proposal.proposal_id.unwrap(),
            approval,
            operation_kind: "select_asset".to_string(),
            args_json: "{\"asset\":\"/Game/Hero\"}".to_string(),
        })
        .unwrap();
        assert_eq!(executed.status, "executed");
        assert_eq!(replay.reason, "proposal_not_executable");
        assert_eq!(stop_editor_session(EditorSessionIdInput { session_id }).unwrap().status, "stopped");
    }

    #[test]
    fn ue_editor_blocks_reapprove_after_execute_and_second_execute() {
        reset_editor_state();
        let (proposal_id, approval) = approved_state_only_operation();
        let executed = execute_editor_operation(ExecuteEditorOperationInput {
            proposal_id: proposal_id.clone(),
            approval: approval.clone(),
            operation_kind: "select_asset".to_string(),
            args_json: "{\"asset\":\"/Game/Hero\"}".to_string(),
        })
        .unwrap();
        let reapprove = approve_editor_operation(EditorOperationApprovalInput {
            proposal_id: proposal_id.clone(),
            actor: "tester".to_string(),
            reason: "second approval".to_string(),
        })
        .unwrap();
        let second_execute = execute_editor_operation(ExecuteEditorOperationInput {
            proposal_id,
            approval,
            operation_kind: "select_asset".to_string(),
            args_json: "{\"asset\":\"/Game/Hero\"}".to_string(),
        })
        .unwrap();

        assert_eq!(executed.status, "executed");
        assert_eq!(reapprove.status, "blocked");
        assert_eq!(reapprove.reason, "proposal_not_approvable");
        assert_eq!(second_execute.status, "blocked");
        assert_eq!(second_execute.reason, "proposal_not_executable");
    }

    #[test]
    fn ue_editor_cancel_blocks_later_approve_and_execute() {
        reset_editor_state();
        let (proposal_id, approval) = approved_state_only_operation();
        let cancelled = cancel_editor_operation(EditorOperationApprovalInput {
            proposal_id: proposal_id.clone(),
            actor: "tester".to_string(),
            reason: "cancel fixture".to_string(),
        })
        .unwrap();
        let execute = execute_editor_operation(ExecuteEditorOperationInput {
            proposal_id,
            approval,
            operation_kind: "select_asset".to_string(),
            args_json: "{\"asset\":\"/Game/Hero\"}".to_string(),
        })
        .unwrap();

        assert_eq!(cancelled.status, "cancelled");
        assert_eq!(execute.status, "blocked");
        assert_eq!(execute.reason, "proposal_not_executable");

        reset_editor_state();
        let session = start_session(input("fixture://lyra-starter", "Game.uproject"), "attached", true);
        let proposal = propose_editor_operation(EditorOperationInput {
            session_id: session.session_id.unwrap(),
            operation_kind: "select_asset".to_string(),
            args_json: "{\"asset\":\"/Game/Hero\"}".to_string(),
        })
        .unwrap();
        let proposal_id = proposal.proposal_id.unwrap();
        cancel_editor_operation(EditorOperationApprovalInput {
            proposal_id: proposal_id.clone(),
            actor: "tester".to_string(),
            reason: "cancel before approval".to_string(),
        })
        .unwrap();
        let approval = approve_editor_operation(EditorOperationApprovalInput {
            proposal_id,
            actor: "tester".to_string(),
            reason: "after cancel".to_string(),
        })
        .unwrap();
        assert_eq!(approval.status, "blocked");
        assert_eq!(approval.reason, "proposal_not_approvable");
    }

    #[test]
    fn ue_editor_blocks_forged_token_args_mismatch_and_expired_or_mismatched_session() {
        reset_editor_state();
        let (proposal_id, mut approval) = approved_state_only_operation();
        approval.token = "forged".to_string();
        let forged = execute_editor_operation(ExecuteEditorOperationInput {
            proposal_id: proposal_id.clone(),
            approval: approval.clone(),
            operation_kind: "select_asset".to_string(),
            args_json: "{\"asset\":\"/Game/Hero\"}".to_string(),
        })
        .unwrap();
        assert_eq!(forged.reason, "forged_token");

        let (_, approval) = approved_state_only_operation();
        let args_mismatch = execute_editor_operation(ExecuteEditorOperationInput {
            proposal_id: approval.proposal_id.clone(),
            approval: approval.clone(),
            operation_kind: "select_asset".to_string(),
            args_json: "{\"asset\":\"/Game/Villain\"}".to_string(),
        })
        .unwrap();
        assert_eq!(args_mismatch.reason, "operation_or_args_mismatch");

        let (_, approval) = approved_state_only_operation();
        session_registry()
            .lock()
            .unwrap()
            .get_mut(&approval.session_id)
            .unwrap()
            .root_id = "root:forged".to_string();
        let root_mismatch = execute_editor_operation(ExecuteEditorOperationInput {
            proposal_id: approval.proposal_id.clone(),
            approval: approval.clone(),
            operation_kind: "select_asset".to_string(),
            args_json: "{\"asset\":\"/Game/Hero\"}".to_string(),
        })
        .unwrap();
        assert_eq!(root_mismatch.reason, "session_or_root_mismatch");

        let (_, approval) = approved_state_only_operation();
        session_registry()
            .lock()
            .unwrap()
            .get_mut(&approval.session_id)
            .unwrap()
            .expires_at = 0;
        let expired = execute_editor_operation(ExecuteEditorOperationInput {
            proposal_id: approval.proposal_id.clone(),
            approval,
            operation_kind: "select_asset".to_string(),
            args_json: "{\"asset\":\"/Game/Hero\"}".to_string(),
        })
        .unwrap();
        assert_eq!(expired.reason, "session_expired");
    }

    #[test]
    fn ue_editor_blocks_asset_write_operations() {
        trusted_roots().lock().unwrap().clear();
        session_registry().lock().unwrap().clear();
        trust("fixture://lyra-starter");
        let session = start_session(input("fixture://lyra-starter", "Game.uproject"), "attached", true);
        let proposal = propose_editor_operation(EditorOperationInput {
            session_id: session.session_id.unwrap(),
            operation_kind: "save_asset".to_string(),
            args_json: "{}".to_string(),
        })
        .unwrap();
        assert_eq!(proposal.status, "blocked");
        assert_eq!(proposal.reason, "asset_mutation_blocked");
    }

    #[test]
    fn ue_editor_validates_real_project_inside_trusted_root() {
        trusted_roots().lock().unwrap().clear();
        let unique = format!(
            "uagent-editor-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("Game.uproject"), "{}").unwrap();
        let root_str = root.to_str().unwrap();
        trust(root_str);
        let result = validate_editor_config_with_feature(input(root_str, "Game.uproject"), true);
        assert!(result.ok, "real project should validate: {}", result.reason);
        assert_eq!(
            validate_editor_config_with_feature(input(root_str, "../Game.uproject"), true).reason,
            "root_escape"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
