use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::{
    resolve_trusted_root_binding, resolve_trusted_root_binding_by_id,
    ue_editor_process::validate_asset_mutation_observation_at,
};

const REQUIRED_OPERATION_KINDS: [&str; 5] =
    ["create_folder", "duplicate", "rename", "move", "save"];
const MAX_APPROVAL_TTL_MS: u64 = 60_000;
const TRANSACTION_LEASE_MS: u64 = 15 * 60_000;
const RECOVERY_LEASE_MS: u64 = 20 * 60_000;
const TERMINAL_EVIDENCE_LEASE_MS: u64 = 60_000;
const APPROVAL_TOKEN_BYTES: usize = 32;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetMutationCommandInput {
    pub tool_name: String,
    pub asset_path: Option<String>,
    pub target_asset_path: Option<String>,
    pub dry_run_hash: Option<String>,
    pub approval_token: Option<String>,
    pub editor_session_id: Option<String>,
    pub pid_hash: Option<String>,
    pub asset_mutation_gate_enabled: Option<bool>,
    pub observed_editor_session_id: Option<String>,
    pub observed_pid_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetMutationCommandResult {
    pub status: String,
    pub reason: String,
    pub sandbox_only: bool,
    pub would_change: bool,
    pub affected_assets: Vec<String>,
    pub evidence_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetMutationApprovalOperation {
    pub operation_id: String,
    pub kind: String,
    pub tool_name: String,
    pub plugin_dry_run_hash: String,
    pub args_hash: String,
    pub source_asset_path: Option<String>,
    pub asset_path: Option<String>,
    pub target_asset_path: Option<String>,
    pub rollback_action: String,
    pub rollback_tool_name: Option<String>,
    pub save_all: bool,
    pub bulk: bool,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct RegisterAssetMutationApprovalInput {
    pub change_set_id: String,
    pub run_id: String,
    pub project_binding_id: String,
    pub trusted_project_root: String,
    pub editor_session_id: String,
    pub aggregate_dry_run_hash: String,
    pub aggregate_args_hash: String,
    pub requested_ttl_ms: u64,
    pub operations: Vec<AssetMutationApprovalOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisterAssetMutationApprovalResult {
    pub status: String,
    pub reason: String,
    pub registration_id: String,
    pub trusted_root_id: String,
    pub operation_count: usize,
    pub approval_token: Option<String>,
    pub issued_at: u64,
    pub expires_at: u64,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct CancelAssetMutationApprovalInput {
    pub registration_id: String,
    pub approval_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelAssetMutationApprovalResult {
    pub status: String,
    pub reason: String,
    pub registration_id: String,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct AssetMutationGuardInput {
    pub registration_id: String,
    pub approval_token: Option<String>,
    pub phase: String,
    pub operation_index: usize,
    pub operation_count: usize,
    pub change_set_id: String,
    pub run_id: String,
    pub project_binding_id: String,
    pub aggregate_dry_run_hash: String,
    pub aggregate_args_hash: String,
    pub operation: AssetMutationApprovalOperation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetMutationGuardResult {
    pub status: String,
    pub reason: String,
    pub registration_id: String,
    pub phase: String,
    pub operation_id: String,
    pub operation_index: usize,
    pub operation_count: usize,
    pub evidence_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordAssetMutationOutcomeInput {
    pub registration_id: String,
    pub phase: String,
    pub operation_id: String,
    pub success: bool,
    #[serde(default)]
    pub side_effect_observed: bool,
    pub rollback_available: bool,
    pub evidence_id: Option<String>,
    pub reason_code: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordAssetMutationOutcomeResult {
    pub status: String,
    pub reason: String,
    pub registration_id: String,
    pub phase: String,
    pub operation_id: String,
    pub rollback_available: bool,
    pub terminal: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct ReadAssetContentEvidenceInput {
    pub registration_id: String,
    pub asset_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetContentEvidenceResult {
    pub status: String,
    pub reason: String,
    pub asset_path: String,
    pub exists: bool,
    pub size: Option<u64>,
    pub sha256: Option<String>,
    pub evidence_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct SnapshotAssetContentManifestInput {
    pub registration_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetContentManifestEntry {
    pub asset_path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetContentManifestResult {
    pub status: String,
    pub reason: String,
    pub entries: Vec<AssetContentManifestEntry>,
    pub aggregate_sha256: Option<String>,
    pub evidence_id: Option<String>,
}

#[derive(Debug, Clone)]
struct ApprovalRecord {
    token_hash: String,
    change_set_id: String,
    run_id: String,
    project_binding_id: String,
    trusted_root_id: String,
    normalized_root: String,
    canonical_root: PathBuf,
    content_root: PathBuf,
    editor_session_id: String,
    process_id: String,
    pid_hash: String,
    aggregate_dry_run_hash: String,
    aggregate_args_hash: String,
    expires_at: u64,
    transaction_deadline: Option<u64>,
    recovery_deadline: Option<u64>,
    operations: Vec<AssetMutationApprovalOperation>,
    token_consumed: bool,
    execute_started: bool,
    execute_halted: bool,
    next_execute: usize,
    successful_execute: Vec<usize>,
    rollback_started: bool,
    rolled_back: Vec<usize>,
    in_flight: Option<(String, usize)>,
}

#[derive(Debug, Clone)]
struct TerminalEvidenceLease {
    run_id: String,
    trusted_root_id: String,
    normalized_root: String,
    canonical_root: PathBuf,
    content_root: PathBuf,
    allowed_asset_paths: Vec<String>,
    expires_at: u64,
}

#[derive(Clone)]
struct EvidenceAccess {
    run_id: String,
    trusted_root_id: String,
    normalized_root: String,
    canonical_root: PathBuf,
    content_root: PathBuf,
    allowed_asset_paths: Vec<String>,
}

#[derive(Default)]
struct ApprovalRegistry {
    records: HashMap<String, ApprovalRecord>,
    terminal_evidence: HashMap<String, TerminalEvidenceLease>,
}

fn approval_registry() -> &'static Mutex<ApprovalRegistry> {
    static REGISTRY: OnceLock<Mutex<ApprovalRegistry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(ApprovalRegistry::default()))
}

#[cfg(test)]
fn authority_race_injection() -> &'static Mutex<Option<String>> {
    static INJECTION: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    INJECTION.get_or_init(|| Mutex::new(None))
}

#[cfg(test)]
fn apply_authority_race_injection() {
    let root_id = authority_race_injection().lock().unwrap().take();
    if let Some(root_id) = root_id {
        crate::trusted_roots().lock().unwrap().remove(&root_id);
    }
}

#[tauri::command]
pub fn dry_run_asset_mutation(input: AssetMutationCommandInput) -> AssetMutationCommandResult {
    classify_asset_mutation(input, false)
}

#[tauri::command]
pub fn register_asset_mutation_approval(
    input: RegisterAssetMutationApprovalInput,
) -> RegisterAssetMutationApprovalResult {
    register_asset_mutation_approval_with_gate_at(
        input,
        current_time_millis(),
        native_asset_mutation_enabled(),
    )
}

#[tauri::command]
pub fn cancel_asset_mutation_approval(
    input: CancelAssetMutationApprovalInput,
) -> CancelAssetMutationApprovalResult {
    cancel_asset_mutation_approval_at(input, current_time_millis())
}

fn cancel_asset_mutation_approval_at(
    input: CancelAssetMutationApprovalInput,
    now: u64,
) -> CancelAssetMutationApprovalResult {
    let mut registry = match approval_registry().lock() {
        Ok(registry) => registry,
        Err(_) => {
            return blocked_cancellation(&input.registration_id, "native_authority_unavailable")
        }
    };
    purge_expired_terminal_evidence(&mut registry, now);
    let Some(record) = registry.records.get(&input.registration_id) else {
        return blocked_cancellation(&input.registration_id, "approval_registration_unknown");
    };
    if input.approval_token.is_empty()
        || sha256_bytes(input.approval_token.as_bytes()) != record.token_hash
    {
        return blocked_cancellation(&input.registration_id, "approval_token_unknown");
    }
    if record.execute_started
        || record.token_consumed
        || record.in_flight.is_some()
        || !record.successful_execute.is_empty()
        || record.next_execute != 0
        || record.rollback_started
        || !record.rolled_back.is_empty()
    {
        return blocked_cancellation(&input.registration_id, "approval_registration_started");
    }
    registry.records.remove(&input.registration_id);
    CancelAssetMutationApprovalResult {
        status: "cancelled".to_string(),
        reason: "approval_registration_cancelled".to_string(),
        registration_id: input.registration_id,
    }
}

#[tauri::command]
pub fn execute_asset_mutation(input: AssetMutationGuardInput) -> AssetMutationGuardResult {
    if input.phase != "execute" {
        return blocked_guard(&input, "phase_mismatch");
    }
    authorize_asset_mutation_with_gate_at(
        input,
        current_time_millis(),
        native_asset_mutation_enabled(),
    )
}

#[tauri::command]
pub fn rollback_asset_mutation(input: AssetMutationGuardInput) -> AssetMutationGuardResult {
    if input.phase != "rollback" {
        return blocked_guard(&input, "phase_mismatch");
    }
    authorize_asset_mutation_with_gate_at(
        input,
        current_time_millis(),
        native_asset_mutation_enabled(),
    )
}

fn native_asset_mutation_enabled() -> bool {
    std::env::var("UAGENT_ENABLE_ASSET_MUTATION")
        .map(|value| value == "1")
        .unwrap_or(false)
}

#[cfg(test)]
fn register_asset_mutation_approval_at(
    input: RegisterAssetMutationApprovalInput,
    now: u64,
) -> RegisterAssetMutationApprovalResult {
    register_asset_mutation_approval_with_gate_at(input, now, true)
}

#[cfg(test)]
fn authorize_asset_mutation_at(
    input: AssetMutationGuardInput,
    now: u64,
) -> AssetMutationGuardResult {
    authorize_asset_mutation_with_gate_at(input, now, true)
}

#[tauri::command]
pub fn record_asset_mutation_outcome(
    input: RecordAssetMutationOutcomeInput,
) -> RecordAssetMutationOutcomeResult {
    record_asset_mutation_outcome_at(input, current_time_millis())
}

fn record_asset_mutation_outcome_at(
    input: RecordAssetMutationOutcomeInput,
    now: u64,
) -> RecordAssetMutationOutcomeResult {
    let mut registry = match approval_registry().lock() {
        Ok(registry) => registry,
        Err(_) => return blocked_outcome(&input, "native_authority_unavailable"),
    };
    purge_expired_terminal_evidence(&mut registry, now);
    let Some(record) = registry.records.get_mut(&input.registration_id) else {
        return blocked_outcome(&input, "approval_registration_unknown");
    };
    let Some((phase, index)) = record.in_flight.clone() else {
        return blocked_outcome(&input, "operation_not_in_flight");
    };
    if phase != input.phase || record.operations[index].operation_id != input.operation_id {
        return blocked_outcome(&input, "operation_outcome_mismatch");
    }
    if input
        .evidence_id
        .as_deref()
        .map(contains_sensitive_evidence)
        .unwrap_or(false)
        || input
            .reason_code
            .as_deref()
            .map(contains_sensitive_evidence)
            .unwrap_or(false)
    {
        return blocked_outcome(&input, "sensitive_outcome_blocked");
    }
    if input.phase == "execute" && !input.success {
        let has_inverse = inverse_operation(&record.operations[index]).is_some();
        let partial_failure_is_owned = input.side_effect_observed
            && input.rollback_available
            && has_inverse
            && input
                .evidence_id
                .as_deref()
                .map(str::trim)
                .is_some_and(|value| !value.is_empty())
            && input
                .reason_code
                .as_deref()
                .map(str::trim)
                .is_some_and(|value| !value.is_empty() && value != "none");
        if input.side_effect_observed != partial_failure_is_owned
            || input.rollback_available != partial_failure_is_owned
        {
            return blocked_outcome(&input, "partial_failure_contract_invalid");
        }
    }
    record.in_flight = None;
    if input.phase == "execute" {
        if input.success || (input.side_effect_observed && input.rollback_available) {
            record.successful_execute.push(index);
        }
        if input.success {
            record.next_execute += 1;
        } else {
            record.execute_halted = true;
        }
    } else if input.phase == "rollback" {
        record.rollback_started = true;
        if input.success {
            record.rolled_back.push(index);
        }
    } else {
        return blocked_outcome(&input, "phase_mismatch");
    }
    let rollback_available = remaining_rollback_indices(record).next().is_some();
    let terminal = input.phase == "rollback" && input.success && !rollback_available;
    let terminal_lease = terminal.then(|| terminal_evidence_lease(record, now));
    let result = RecordAssetMutationOutcomeResult {
        status: "recorded".to_string(),
        reason: if input.success {
            "operation_succeeded"
        } else {
            "operation_failed"
        }
        .to_string(),
        registration_id: input.registration_id.clone(),
        phase: input.phase,
        operation_id: input.operation_id,
        rollback_available,
        terminal,
    };
    if let Some(lease) = terminal_lease {
        registry.records.remove(&input.registration_id);
        registry
            .terminal_evidence
            .insert(input.registration_id.clone(), lease);
    }
    result
}

#[tauri::command]
pub fn read_asset_content_evidence(
    input: ReadAssetContentEvidenceInput,
) -> AssetContentEvidenceResult {
    read_asset_content_evidence_at(input, current_time_millis())
}

fn read_asset_content_evidence_at(
    input: ReadAssetContentEvidenceInput,
    now: u64,
) -> AssetContentEvidenceResult {
    let (access, asset_path) = match evidence_access_and_path_at(&input, now) {
        Ok(value) => value,
        Err(reason) => return blocked_evidence(&input.asset_path, &reason),
    };
    let disk_path = match asset_path_to_uasset(&access.content_root, &asset_path) {
        Ok(path) => path,
        Err(reason) => return blocked_evidence(&asset_path, &reason),
    };
    if !disk_path.exists() {
        return AssetContentEvidenceResult {
            status: "observed".to_string(),
            reason: "asset_absent".to_string(),
            asset_path: asset_path.clone(),
            exists: false,
            size: None,
            sha256: None,
            evidence_id: Some(redacted_evidence_id("absent", &asset_path)),
        };
    }
    let canonical = match std::fs::canonicalize(&disk_path) {
        Ok(path) if path.starts_with(&access.content_root) => path,
        _ => return blocked_evidence(&asset_path, "trusted_root_escape"),
    };
    let metadata = match std::fs::metadata(&canonical) {
        Ok(metadata) if metadata.is_file() => metadata,
        _ => return blocked_evidence(&asset_path, "asset_file_required"),
    };
    let bytes = match std::fs::read(&canonical) {
        Ok(bytes) => bytes,
        Err(_) => return blocked_evidence(&asset_path, "asset_read_failed"),
    };
    let hash = sha256_bytes(&bytes);
    AssetContentEvidenceResult {
        status: "observed".to_string(),
        reason: "asset_present".to_string(),
        asset_path: asset_path.clone(),
        exists: true,
        size: Some(metadata.len()),
        sha256: Some(hash.clone()),
        evidence_id: Some(redacted_evidence_id(&hash, &asset_path)),
    }
}

#[tauri::command]
pub fn snapshot_asset_content_manifest(
    input: SnapshotAssetContentManifestInput,
) -> AssetContentManifestResult {
    snapshot_asset_content_manifest_at(input, current_time_millis())
}

fn snapshot_asset_content_manifest_at(
    input: SnapshotAssetContentManifestInput,
    now: u64,
) -> AssetContentManifestResult {
    let access = match evidence_access_at(&input.registration_id, now) {
        Ok(access) => access,
        Err(reason) => return blocked_manifest(&reason),
    };
    let mut entries = Vec::new();
    if let Err(reason) =
        collect_uasset_manifest(&access.content_root, &access.content_root, &mut entries)
    {
        return blocked_manifest(&reason);
    }
    entries.sort_by(|left, right| left.asset_path.cmp(&right.asset_path));
    let canonical = entries
        .iter()
        .map(|entry| format!("{}|{}|{}\n", entry.asset_path, entry.size, entry.sha256))
        .collect::<String>();
    let aggregate = sha256_bytes(canonical.as_bytes());
    AssetContentManifestResult {
        status: "observed".to_string(),
        reason: "content_manifest_captured".to_string(),
        entries,
        aggregate_sha256: Some(aggregate.clone()),
        evidence_id: Some(format!("asset-content-manifest:{}", &aggregate[..16])),
    }
}

pub fn classify_asset_mutation(
    input: AssetMutationCommandInput,
    execution_requested: bool,
) -> AssetMutationCommandResult {
    let mut affected = Vec::new();
    if let Some(path) = input.asset_path.as_ref() {
        affected.push(redact_asset_path_for_input(path, &input.tool_name, false));
    }
    if let Some(path) = input.target_asset_path.as_ref() {
        affected.push(redact_asset_path_for_input(path, &input.tool_name, true));
    }
    if !is_allowed_tool(&input.tool_name) {
        return blocked("not_allowlisted", affected);
    }
    if input.asset_mutation_gate_enabled != Some(true) {
        return blocked("asset_mutation_gate_disabled", affected);
    }
    if input.tool_name == "ue.asset.duplicate" {
        if input
            .target_asset_path
            .as_deref()
            .map(|path| !is_sandbox_path(path))
            .unwrap_or(true)
        {
            return blocked("sandbox_path_required", affected);
        }
    } else {
        for path in input
            .asset_path
            .iter()
            .chain(input.target_asset_path.iter())
        {
            if !is_sandbox_path(path) {
                return blocked("sandbox_path_required", affected);
            }
        }
    }
    if input.dry_run_hash.as_deref().unwrap_or("").is_empty() {
        return blocked("dry_run_required", affected);
    }
    if execution_requested {
        return blocked(
            if input.approval_token.as_deref().unwrap_or("").is_empty() {
                "approval_required"
            } else {
                "approval_token_unknown"
            },
            affected,
        );
    }
    AssetMutationCommandResult {
        status: "dry_run_ready".to_string(),
        reason: "sandbox_guard_passed".to_string(),
        sandbox_only: true,
        would_change: true,
        affected_assets: affected,
        evidence_id: Some("asset-native-evidence:redacted".to_string()),
    }
}

fn register_asset_mutation_approval_with_gate_at(
    input: RegisterAssetMutationApprovalInput,
    now: u64,
    native_gate_enabled: bool,
) -> RegisterAssetMutationApprovalResult {
    if !native_gate_enabled {
        return blocked_registration("feature_disabled");
    }
    if let Some(reason) = validate_registration(&input, now) {
        return blocked_registration(&reason);
    }
    let trusted_root = match resolve_trusted_root_binding(&input.trusted_project_root) {
        Ok(binding) => binding,
        Err(reason) => return blocked_registration(reason),
    };
    let canonical_root = trusted_root.canonical_root.clone();
    let content_root = match std::fs::canonicalize(canonical_root.join("Content")) {
        Ok(path) if path.is_dir() && path.starts_with(&canonical_root) => path,
        _ => return blocked_registration("trusted_content_root_invalid"),
    };
    let observation = match validate_asset_mutation_observation_at(
        &input.editor_session_id,
        &input.project_binding_id,
        &trusted_root.root_id,
        now,
    ) {
        Ok(binding) => binding,
        Err(reason) => return blocked_registration(reason),
    };
    if observation.canonical_root != canonical_root {
        return blocked_registration("trusted_root_binding_mismatch");
    }
    let approval_token = match issue_approval_token() {
        Ok(token) => token,
        Err(()) => return blocked_registration("approval_token_issuance_failed"),
    };
    let token_hash = sha256_bytes(approval_token.as_bytes());
    let issued_at = now;
    let Some(expires_at) = issued_at.checked_add(input.requested_ttl_ms) else {
        return blocked_registration("approval_ttl_invalid");
    };
    let trusted_root_id = trusted_root.root_id.clone();
    let registration_digest = sha256_bytes(
        format!(
            "{}|{}|{}|{}|{}",
            token_hash, input.change_set_id, input.run_id, input.aggregate_dry_run_hash, expires_at
        )
        .as_bytes(),
    );
    let registration_id = format!("asset-approval:{}", &registration_digest[..24]);
    #[cfg(test)]
    apply_authority_race_injection();
    let mut registry = match approval_registry().lock() {
        Ok(registry) => registry,
        Err(_) => return blocked_registration("native_authority_unavailable"),
    };
    purge_expired_terminal_evidence(&mut registry, now);
    let final_trusted_root = match resolve_trusted_root_binding_by_id(&trusted_root_id) {
        Ok(binding) => binding,
        Err(reason) => return blocked_registration(reason),
    };
    if final_trusted_root.normalized_root != trusted_root.normalized_root
        || final_trusted_root.canonical_root != canonical_root
    {
        return blocked_registration("trusted_root_binding_mismatch");
    }
    let final_content_root =
        match std::fs::canonicalize(final_trusted_root.canonical_root.join("Content")) {
            Ok(path)
                if path.is_dir()
                    && path.starts_with(&final_trusted_root.canonical_root)
                    && path == content_root =>
            {
                path
            }
            _ => return blocked_registration("trust_revoked"),
        };
    let final_observation = match validate_asset_mutation_observation_at(
        &input.editor_session_id,
        &input.project_binding_id,
        &trusted_root_id,
        now,
    ) {
        Ok(binding) => binding,
        Err(reason) => return blocked_registration(reason),
    };
    if final_content_root != content_root
        || final_observation.process_id != observation.process_id
        || final_observation.pid_hash != observation.pid_hash
        || final_observation.canonical_root != canonical_root
    {
        return blocked_registration("native_authority_unavailable");
    }
    if registry
        .records
        .values()
        .any(|record| record.token_hash == token_hash)
    {
        return blocked_registration("approval_token_already_registered");
    }
    if registry.records.contains_key(&registration_id)
        || registry.terminal_evidence.contains_key(&registration_id)
    {
        return blocked_registration("approval_registration_conflict");
    }
    registry.records.insert(
        registration_id.clone(),
        ApprovalRecord {
            token_hash,
            change_set_id: input.change_set_id,
            run_id: input.run_id,
            project_binding_id: input.project_binding_id,
            trusted_root_id: trusted_root_id.clone(),
            normalized_root: trusted_root.normalized_root,
            canonical_root,
            content_root,
            editor_session_id: observation.session_id,
            process_id: observation.process_id,
            pid_hash: observation.pid_hash,
            aggregate_dry_run_hash: input.aggregate_dry_run_hash,
            aggregate_args_hash: input.aggregate_args_hash,
            expires_at,
            transaction_deadline: None,
            recovery_deadline: None,
            operations: input.operations,
            token_consumed: false,
            execute_started: false,
            execute_halted: false,
            next_execute: 0,
            successful_execute: Vec::new(),
            rollback_started: false,
            rolled_back: Vec::new(),
            in_flight: None,
        },
    );
    RegisterAssetMutationApprovalResult {
        status: "registered".to_string(),
        reason: "approval_binding_registered".to_string(),
        registration_id,
        trusted_root_id,
        operation_count: REQUIRED_OPERATION_KINDS.len(),
        approval_token: Some(approval_token),
        issued_at,
        expires_at,
    }
}

fn authorize_asset_mutation_with_gate_at(
    input: AssetMutationGuardInput,
    now: u64,
    native_gate_enabled: bool,
) -> AssetMutationGuardResult {
    if input.phase == "execute" && !native_gate_enabled {
        return blocked_guard(&input, "feature_disabled");
    }
    let snapshot = match approval_registry().lock() {
        Ok(registry) => registry.records.get(&input.registration_id).cloned(),
        Err(_) => return blocked_guard(&input, "native_authority_unavailable"),
    };
    let Some(snapshot) = snapshot else {
        return blocked_guard(&input, "approval_registration_unknown");
    };
    if !native_gate_enabled && input.phase == "rollback" && snapshot.successful_execute.is_empty() {
        return blocked_guard(&input, "feature_disabled");
    }
    if now >= snapshot.expires_at && !snapshot.execute_started {
        if let Ok(mut registry) = approval_registry().lock() {
            registry.records.remove(&input.registration_id);
        }
        return blocked_guard(&input, "approval_expired");
    }
    if input.phase == "execute"
        && snapshot
            .transaction_deadline
            .is_some_and(|deadline| now >= deadline)
    {
        return blocked_guard(&input, "transaction_expired");
    }
    if input.phase == "rollback"
        && snapshot
            .recovery_deadline
            .is_some_and(|deadline| now >= deadline)
    {
        return blocked_guard(&input, "recovery_expired");
    }
    let trusted_root = match resolve_trusted_root_binding_by_id(&snapshot.trusted_root_id) {
        Ok(binding) => binding,
        Err(reason) => return blocked_guard(&input, reason),
    };
    if trusted_root.normalized_root != snapshot.normalized_root
        || trusted_root.canonical_root != snapshot.canonical_root
    {
        return blocked_guard(&input, "trusted_root_binding_mismatch");
    }
    let current_content_root =
        match std::fs::canonicalize(trusted_root.canonical_root.join("Content")) {
            Ok(path)
                if path.is_dir()
                    && path.starts_with(&trusted_root.canonical_root)
                    && path == snapshot.content_root =>
            {
                path
            }
            _ => return blocked_guard(&input, "trust_revoked"),
        };
    let observation = match validate_asset_mutation_observation_at(
        &snapshot.editor_session_id,
        &snapshot.project_binding_id,
        &snapshot.trusted_root_id,
        now,
    ) {
        Ok(binding) => binding,
        Err(reason) => return blocked_guard(&input, reason),
    };
    if observation.process_id != snapshot.process_id
        || observation.pid_hash != snapshot.pid_hash
        || observation.canonical_root != snapshot.canonical_root
    {
        return blocked_guard(&input, "observation_pid_mismatch");
    }
    #[cfg(test)]
    apply_authority_race_injection();
    let mut registry = match approval_registry().lock() {
        Ok(registry) => registry,
        Err(_) => return blocked_guard(&input, "native_authority_unavailable"),
    };
    let Some(record) = registry.records.get_mut(&input.registration_id) else {
        return blocked_guard(&input, "approval_registration_unknown");
    };
    if record.content_root != current_content_root
        || record.process_id != snapshot.process_id
        || record.pid_hash != snapshot.pid_hash
    {
        return blocked_guard(&input, "native_authority_unavailable");
    }
    let final_trusted_root = match resolve_trusted_root_binding_by_id(&record.trusted_root_id) {
        Ok(binding) => binding,
        Err(reason) => return blocked_guard(&input, reason),
    };
    if final_trusted_root.normalized_root != record.normalized_root
        || final_trusted_root.canonical_root != record.canonical_root
    {
        return blocked_guard(&input, "trusted_root_binding_mismatch");
    }
    let final_content_root =
        match std::fs::canonicalize(final_trusted_root.canonical_root.join("Content")) {
            Ok(path)
                if path.is_dir()
                    && path.starts_with(&final_trusted_root.canonical_root)
                    && path == record.content_root =>
            {
                path
            }
            _ => return blocked_guard(&input, "trust_revoked"),
        };
    let final_observation = match validate_asset_mutation_observation_at(
        &record.editor_session_id,
        &record.project_binding_id,
        &record.trusted_root_id,
        now,
    ) {
        Ok(binding) => binding,
        Err(reason) => return blocked_guard(&input, reason),
    };
    if final_content_root != current_content_root
        || final_observation.process_id != record.process_id
        || final_observation.pid_hash != record.pid_hash
        || final_observation.canonical_root != record.canonical_root
    {
        return blocked_guard(&input, "native_authority_unavailable");
    }
    if record.change_set_id != input.change_set_id {
        return blocked_guard(&input, "change_set_mismatch");
    }
    if record.run_id != input.run_id {
        return blocked_guard(&input, "run_id_mismatch");
    }
    if record.project_binding_id != input.project_binding_id {
        return blocked_guard(&input, "project_binding_mismatch");
    }
    if record.aggregate_dry_run_hash != input.aggregate_dry_run_hash {
        return blocked_guard(&input, "aggregate_dry_run_hash_mismatch");
    }
    if record.aggregate_args_hash != input.aggregate_args_hash {
        return blocked_guard(&input, "aggregate_args_hash_mismatch");
    }
    if input.operation_count != record.operations.len()
        || input.operation_index >= input.operation_count
    {
        return blocked_guard(&input, "operation_count_mismatch");
    }
    if record.in_flight.is_some() {
        return blocked_guard(&input, "operation_in_flight");
    }
    if input.phase == "execute" {
        if record.rollback_started {
            return blocked_guard(&input, "execute_after_rollback");
        }
        if record.execute_halted {
            return blocked_guard(&input, "execute_halted");
        }
        if input.operation_index < record.next_execute
            || record.next_execute >= record.operations.len()
        {
            return blocked_guard(&input, "execute_replay");
        }
        if input.operation_index != record.next_execute {
            return blocked_guard(&input, "operation_out_of_order");
        }
        if input.operation != record.operations[input.operation_index] {
            return blocked_guard(&input, "operation_binding_mismatch");
        }
        if !record.execute_started {
            let Some(token) = input.approval_token.as_deref() else {
                return blocked_guard(&input, "approval_token_required");
            };
            if record.token_consumed || sha256_bytes(token.as_bytes()) != record.token_hash {
                return blocked_guard(&input, "approval_token_unknown");
            }
            record.token_consumed = true;
            record.execute_started = true;
            record.transaction_deadline = Some(now.saturating_add(TRANSACTION_LEASE_MS));
            record.recovery_deadline = Some(now.saturating_add(RECOVERY_LEASE_MS));
        } else if input.approval_token.is_some() {
            return blocked_guard(&input, "approval_token_replay");
        }
        record.in_flight = Some(("execute".to_string(), input.operation_index));
    } else if input.phase == "rollback" {
        if input.approval_token.is_some() {
            return blocked_guard(&input, "approval_token_forbidden");
        }
        if !record.execute_started {
            return blocked_guard(&input, "execute_not_started");
        }
        let Some(expected_index) = remaining_rollback_indices(record).next() else {
            return blocked_guard(
                &input,
                if record.rollback_started {
                    "rollback_replay"
                } else {
                    "rollback_not_available"
                },
            );
        };
        if input.operation_index != expected_index {
            return blocked_guard(&input, "rollback_out_of_order");
        }
        let Some(expected_operation) = inverse_operation(&record.operations[expected_index]) else {
            return blocked_guard(&input, "rollback_not_available");
        };
        if input.operation != expected_operation {
            return blocked_guard(&input, "rollback_binding_mismatch");
        }
        record.rollback_started = true;
        record.in_flight = Some(("rollback".to_string(), expected_index));
    } else {
        return blocked_guard(&input, "phase_mismatch");
    }
    AssetMutationGuardResult {
        status: "accepted_by_native_guard".to_string(),
        reason: "registered_binding_matched".to_string(),
        registration_id: input.registration_id.clone(),
        phase: input.phase.clone(),
        operation_id: input.operation.operation_id.clone(),
        operation_index: input.operation_index,
        operation_count: input.operation_count,
        evidence_id: Some(redacted_evidence_id(
            &input.phase,
            &format!("{}:{}", input.registration_id, input.operation.operation_id),
        )),
    }
}

fn validate_registration(input: &RegisterAssetMutationApprovalInput, _now: u64) -> Option<String> {
    for value in [
        &input.change_set_id,
        &input.run_id,
        &input.project_binding_id,
        &input.editor_session_id,
    ] {
        if value.trim().is_empty() {
            return Some("approval_binding_incomplete".to_string());
        }
    }
    if input.requested_ttl_ms == 0 {
        return Some("approval_ttl_invalid".to_string());
    }
    if input.requested_ttl_ms > MAX_APPROVAL_TTL_MS {
        return Some("approval_ttl_exceeded".to_string());
    }
    if !is_lower_hex(&input.aggregate_dry_run_hash, 64)
        || !is_lower_hex(&input.aggregate_args_hash, 64)
    {
        return Some("aggregate_hash_invalid".to_string());
    }
    if input.operations.len() != REQUIRED_OPERATION_KINDS.len() {
        return Some("operation_count_mismatch".to_string());
    }
    for (index, operation) in input.operations.iter().enumerate() {
        if let Some(reason) =
            validate_operation(operation, &input.run_id, REQUIRED_OPERATION_KINDS[index])
        {
            return Some(reason);
        }
    }
    if input.operations[1].target_asset_path != input.operations[2].asset_path
        || input.operations[2].target_asset_path != input.operations[3].asset_path
        || input.operations[3].target_asset_path != input.operations[4].asset_path
    {
        return Some("operation_path_chain_mismatch".to_string());
    }
    None
}

fn validate_operation(
    operation: &AssetMutationApprovalOperation,
    run_id: &str,
    required_kind: &str,
) -> Option<String> {
    if operation.operation_id.trim().is_empty() || operation.kind != required_kind {
        return Some("operation_order_mismatch".to_string());
    }
    if operation.bulk || operation.save_all {
        return Some(
            if operation.bulk {
                "bulk_operation_blocked"
            } else {
                "save_all_blocked"
            }
            .to_string(),
        );
    }
    if !is_lower_hex(&operation.plugin_dry_run_hash, 40) || !is_lower_hex(&operation.args_hash, 64)
    {
        return Some("operation_hash_invalid".to_string());
    }
    let run_root = format!("/Game/UAgentSandbox/{run_id}");
    let sandbox = |path: &Option<String>| {
        path.as_deref()
            .map(|value| is_path_within(value, &run_root))
            .unwrap_or(false)
    };
    match required_kind {
        "create_folder" => {
            if operation.tool_name != "ue.asset.create_folder"
                || operation.asset_path.as_deref() != Some(run_root.as_str())
                || operation.source_asset_path.is_some()
                || operation.target_asset_path.is_some()
                || operation.rollback_action != "cleanup_empty_folder"
                || operation.rollback_tool_name.as_deref() != Some("ue.asset.delete")
            {
                return Some("operation_binding_invalid".to_string());
            }
        }
        "duplicate" => {
            if operation.tool_name != "ue.asset.duplicate"
                || operation
                    .source_asset_path
                    .as_deref()
                    .map(is_canonical_asset_path)
                    != Some(true)
                || operation
                    .source_asset_path
                    .as_deref()
                    .map(|path| is_path_within(path, &run_root))
                    == Some(true)
                || !sandbox(&operation.target_asset_path)
                || operation.asset_path.is_some()
                || operation.rollback_action != "delete_duplicate"
                || operation.rollback_tool_name.as_deref() != Some("ue.asset.delete")
            {
                return Some("operation_binding_invalid".to_string());
            }
        }
        "rename" | "move" => {
            let tool = format!("ue.asset.{required_kind}");
            let rollback = format!("{required_kind}_back");
            if operation.tool_name != tool
                || !sandbox(&operation.asset_path)
                || !sandbox(&operation.target_asset_path)
                || operation.source_asset_path.is_some()
                || operation.rollback_action != rollback
                || operation.rollback_tool_name.as_deref() != Some(tool.as_str())
            {
                return Some("operation_binding_invalid".to_string());
            }
        }
        "save" => {
            if operation.tool_name != "ue.asset.save"
                || !sandbox(&operation.asset_path)
                || operation.source_asset_path.is_some()
                || operation.target_asset_path.is_some()
                || operation.rollback_action != "none"
                || operation.rollback_tool_name.is_some()
            {
                return Some("operation_binding_invalid".to_string());
            }
        }
        _ => return Some("not_allowlisted".to_string()),
    }
    None
}

fn inverse_operation(
    operation: &AssetMutationApprovalOperation,
) -> Option<AssetMutationApprovalOperation> {
    let (kind, tool_name, asset_path, target_asset_path) = match operation.rollback_action.as_str()
    {
        "cleanup_empty_folder" => (
            "cleanup_empty_folder",
            "ue.asset.delete",
            operation.asset_path.clone(),
            None,
        ),
        "delete_duplicate" => (
            "delete_duplicate",
            "ue.asset.delete",
            operation.target_asset_path.clone(),
            None,
        ),
        "rename_back" => (
            "rename_back",
            "ue.asset.rename",
            operation.target_asset_path.clone(),
            operation.asset_path.clone(),
        ),
        "move_back" => (
            "move_back",
            "ue.asset.move",
            operation.target_asset_path.clone(),
            operation.asset_path.clone(),
        ),
        "none" => return None,
        _ => return None,
    };
    Some(AssetMutationApprovalOperation {
        operation_id: operation.operation_id.clone(),
        kind: kind.to_string(),
        tool_name: tool_name.to_string(),
        plugin_dry_run_hash: operation.plugin_dry_run_hash.clone(),
        args_hash: operation.args_hash.clone(),
        source_asset_path: None,
        asset_path,
        target_asset_path,
        rollback_action: "none".to_string(),
        rollback_tool_name: None,
        save_all: false,
        bulk: false,
    })
}

fn remaining_rollback_indices(record: &ApprovalRecord) -> impl Iterator<Item = usize> + '_ {
    record
        .successful_execute
        .iter()
        .rev()
        .copied()
        .filter(|index| inverse_operation(&record.operations[*index]).is_some())
        .filter(|index| !record.rolled_back.contains(index))
}

fn terminal_evidence_lease(record: &ApprovalRecord, now: u64) -> TerminalEvidenceLease {
    let mut allowed_asset_paths = record
        .operations
        .iter()
        .flat_map(|operation| {
            [
                operation.source_asset_path.clone(),
                operation.asset_path.clone(),
                operation.target_asset_path.clone(),
            ]
        })
        .flatten()
        .collect::<Vec<_>>();
    allowed_asset_paths.sort();
    allowed_asset_paths.dedup();
    TerminalEvidenceLease {
        run_id: record.run_id.clone(),
        trusted_root_id: record.trusted_root_id.clone(),
        normalized_root: record.normalized_root.clone(),
        canonical_root: record.canonical_root.clone(),
        content_root: record.content_root.clone(),
        allowed_asset_paths,
        expires_at: now.saturating_add(TERMINAL_EVIDENCE_LEASE_MS),
    }
}

fn purge_expired_terminal_evidence(registry: &mut ApprovalRegistry, now: u64) {
    registry
        .terminal_evidence
        .retain(|_, lease| now < lease.expires_at);
}

fn evidence_access_at(registration_id: &str, now: u64) -> Result<EvidenceAccess, String> {
    let access = {
        let mut registry = approval_registry()
            .lock()
            .map_err(|_| "native_authority_unavailable".to_string())?;
        purge_expired_terminal_evidence(&mut registry, now);
        if let Some(record) = registry.records.get(registration_id) {
            EvidenceAccess {
                run_id: record.run_id.clone(),
                trusted_root_id: record.trusted_root_id.clone(),
                normalized_root: record.normalized_root.clone(),
                canonical_root: record.canonical_root.clone(),
                content_root: record.content_root.clone(),
                allowed_asset_paths: terminal_evidence_lease(record, now).allowed_asset_paths,
            }
        } else {
            let lease = registry
                .terminal_evidence
                .get(registration_id)
                .ok_or_else(|| "approval_registration_unknown".to_string())?;
            EvidenceAccess {
                run_id: lease.run_id.clone(),
                trusted_root_id: lease.trusted_root_id.clone(),
                normalized_root: lease.normalized_root.clone(),
                canonical_root: lease.canonical_root.clone(),
                content_root: lease.content_root.clone(),
                allowed_asset_paths: lease.allowed_asset_paths.clone(),
            }
        }
    };
    let trusted_root =
        resolve_trusted_root_binding_by_id(&access.trusted_root_id).map_err(str::to_string)?;
    if trusted_root.normalized_root != access.normalized_root
        || trusted_root.canonical_root != access.canonical_root
    {
        return Err("trusted_root_binding_mismatch".to_string());
    }
    let content_root = std::fs::canonicalize(trusted_root.canonical_root.join("Content"))
        .map_err(|_| "trust_revoked".to_string())?;
    if !content_root.is_dir()
        || !content_root.starts_with(&trusted_root.canonical_root)
        || content_root != access.content_root
    {
        return Err("trust_revoked".to_string());
    }
    Ok(access)
}

fn evidence_access_and_path_at(
    input: &ReadAssetContentEvidenceInput,
    now: u64,
) -> Result<(EvidenceAccess, String), String> {
    let asset_path = canonicalize_asset_path(&input.asset_path)?;
    let access = evidence_access_at(&input.registration_id, now)?;
    let run_root = format!("/Game/UAgentSandbox/{}", access.run_id);
    let bound = is_path_within(&asset_path, &run_root)
        || access
            .allowed_asset_paths
            .iter()
            .any(|path| path == &asset_path);
    if !bound {
        return Err("asset_path_not_bound".to_string());
    }
    Ok((access, asset_path))
}

fn asset_path_to_uasset(content_root: &Path, asset_path: &str) -> Result<PathBuf, String> {
    let canonical = canonicalize_asset_path(asset_path)?;
    let relative = canonical.trim_start_matches("/Game/");
    let disk_path = content_root
        .join(relative.replace('/', &std::path::MAIN_SEPARATOR.to_string()))
        .with_extension("uasset");
    let mut existing = disk_path.parent();
    while let Some(path) = existing {
        if path.exists() {
            let canonical_parent =
                std::fs::canonicalize(path).map_err(|_| "trusted_root_invalid".to_string())?;
            if !canonical_parent.starts_with(content_root) {
                return Err("trusted_root_escape".to_string());
            }
            break;
        }
        existing = path.parent();
    }
    Ok(disk_path)
}

fn collect_uasset_manifest(
    content_root: &Path,
    directory: &Path,
    entries: &mut Vec<AssetContentManifestEntry>,
) -> Result<(), String> {
    for entry in
        std::fs::read_dir(directory).map_err(|_| "content_manifest_read_failed".to_string())?
    {
        let entry = entry.map_err(|_| "content_manifest_read_failed".to_string())?;
        let file_type = entry
            .file_type()
            .map_err(|_| "content_manifest_read_failed".to_string())?;
        if file_type.is_symlink() {
            return Err("content_symlink_blocked".to_string());
        }
        let path = entry.path();
        if file_type.is_dir() {
            collect_uasset_manifest(content_root, &path, entries)?;
        } else if file_type.is_file()
            && path.extension().and_then(|value| value.to_str()) == Some("uasset")
        {
            let canonical = std::fs::canonicalize(&path)
                .map_err(|_| "content_manifest_read_failed".to_string())?;
            if !canonical.starts_with(content_root) {
                return Err("trusted_root_escape".to_string());
            }
            let relative = canonical
                .strip_prefix(content_root)
                .map_err(|_| "trusted_root_escape".to_string())?
                .with_extension("");
            let relative = relative
                .to_str()
                .ok_or_else(|| "asset_path_encoding_invalid".to_string())?
                .replace('\\', "/");
            let asset_path = canonicalize_asset_path(&format!("/Game/{relative}"))?;
            let bytes = std::fs::read(&canonical).map_err(|_| "asset_read_failed".to_string())?;
            entries.push(AssetContentManifestEntry {
                asset_path,
                size: bytes.len() as u64,
                sha256: sha256_bytes(&bytes),
            });
        }
    }
    Ok(())
}

fn canonicalize_asset_path(path: &str) -> Result<String, String> {
    if !is_canonical_asset_path(path) {
        return Err("asset_path_invalid".to_string());
    }
    Ok(path.to_string())
}

fn is_canonical_asset_path(path: &str) -> bool {
    path.starts_with("/Game/")
        && path.len() > "/Game/".len()
        && !path.ends_with('/')
        && !path.contains('\\')
        && !path.contains("//")
        && !path.contains("..")
        && !path.contains('.')
        && !path.contains(':')
        && !path.contains('\'')
        && !path.contains('"')
        && path
            .trim_start_matches("/Game/")
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

fn is_path_within(path: &str, root: &str) -> bool {
    is_canonical_asset_path(path) && (path == root || path.starts_with(&format!("{root}/")))
}

fn is_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn blocked(reason: &str, affected_assets: Vec<String>) -> AssetMutationCommandResult {
    AssetMutationCommandResult {
        status: "blocked".to_string(),
        reason: reason.to_string(),
        sandbox_only: true,
        would_change: false,
        affected_assets,
        evidence_id: None,
    }
}

fn blocked_registration(reason: &str) -> RegisterAssetMutationApprovalResult {
    RegisterAssetMutationApprovalResult {
        status: "blocked".to_string(),
        reason: reason.to_string(),
        registration_id: String::new(),
        trusted_root_id: String::new(),
        operation_count: 0,
        approval_token: None,
        issued_at: 0,
        expires_at: 0,
    }
}

fn blocked_cancellation(registration_id: &str, reason: &str) -> CancelAssetMutationApprovalResult {
    CancelAssetMutationApprovalResult {
        status: "blocked".to_string(),
        reason: reason.to_string(),
        registration_id: registration_id.to_string(),
    }
}

fn issue_approval_token() -> Result<String, ()> {
    let mut bytes = [0u8; APPROVAL_TOKEN_BYTES];
    getrandom::getrandom(&mut bytes).map_err(|_| ())?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}

fn blocked_guard(input: &AssetMutationGuardInput, reason: &str) -> AssetMutationGuardResult {
    AssetMutationGuardResult {
        status: "blocked".to_string(),
        reason: reason.to_string(),
        registration_id: input.registration_id.clone(),
        phase: input.phase.clone(),
        operation_id: input.operation.operation_id.clone(),
        operation_index: input.operation_index,
        operation_count: input.operation_count,
        evidence_id: None,
    }
}

fn blocked_outcome(
    input: &RecordAssetMutationOutcomeInput,
    reason: &str,
) -> RecordAssetMutationOutcomeResult {
    RecordAssetMutationOutcomeResult {
        status: "blocked".to_string(),
        reason: reason.to_string(),
        registration_id: input.registration_id.clone(),
        phase: input.phase.clone(),
        operation_id: input.operation_id.clone(),
        rollback_available: false,
        terminal: false,
    }
}

fn blocked_evidence(asset_path: &str, reason: &str) -> AssetContentEvidenceResult {
    AssetContentEvidenceResult {
        status: "blocked".to_string(),
        reason: reason.to_string(),
        asset_path: if is_canonical_asset_path(asset_path) {
            asset_path.to_string()
        } else {
            "[invalid-asset-path]".to_string()
        },
        exists: false,
        size: None,
        sha256: None,
        evidence_id: None,
    }
}

fn blocked_manifest(reason: &str) -> AssetContentManifestResult {
    AssetContentManifestResult {
        status: "blocked".to_string(),
        reason: reason.to_string(),
        entries: Vec::new(),
        aggregate_sha256: None,
        evidence_id: None,
    }
}

fn redacted_evidence_id(prefix: &str, value: &str) -> String {
    let digest = sha256_bytes(format!("{prefix}|{value}").as_bytes());
    format!("asset-native-evidence:{}", &digest[..16])
}

fn contains_sensitive_evidence(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    value.contains("\\")
        || value.contains(":\\")
        || lower.contains("approval_token")
        || lower.contains("trusted_project_root")
        || lower.contains("editor_session_id")
        || lower.contains("pid_hash")
}

fn is_allowed_tool(tool_name: &str) -> bool {
    matches!(
        tool_name,
        "ue.asset.create_folder"
            | "ue.asset.duplicate"
            | "ue.asset.rename"
            | "ue.asset.move"
            | "ue.asset.delete"
            | "ue.asset.save"
    )
}

fn is_sandbox_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    !normalized.contains("..")
        && !normalized.contains("//")
        && (normalized.starts_with("/Game/UAgentSandbox/")
            || normalized == "/Game/UAgentSandbox"
            || normalized.starts_with("/Content/UAgentSandbox/")
            || normalized == "/Content/UAgentSandbox")
}

fn redact_asset_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    if is_sandbox_path(&normalized) {
        normalized
    } else if normalized.starts_with("/Game/") || normalized.starts_with("/Content/") {
        "[non-sandbox-asset]".to_string()
    } else {
        "[outside-root]".to_string()
    }
}

fn redact_asset_path_for_input(path: &str, tool_name: &str, is_target: bool) -> String {
    let normalized = path.replace('\\', "/");
    if tool_name == "ue.asset.duplicate" && !is_target && !is_sandbox_path(&normalized) {
        return "[non-sandbox-source]".to_string();
    }
    redact_asset_path(path)
}

fn current_time_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub fn sha256_bytes(bytes: &[u8]) -> String {
    const H0: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut data = bytes.to_vec();
    let bit_len = (data.len() as u64) * 8;
    data.push(0x80);
    while (data.len() + 8) % 64 != 0 {
        data.push(0);
    }
    data.extend_from_slice(&bit_len.to_be_bytes());
    let mut h = H0;
    for chunk in data.chunks(64) {
        let mut w = [0u32; 64];
        for (index, word) in w.iter_mut().take(16).enumerate() {
            let offset = index * 4;
            *word = u32::from_be_bytes([
                chunk[offset],
                chunk[offset + 1],
                chunk[offset + 2],
                chunk[offset + 3],
            ]);
        }
        for index in 16..64 {
            let s0 = w[index - 15].rotate_right(7)
                ^ w[index - 15].rotate_right(18)
                ^ (w[index - 15] >> 3);
            let s1 = w[index - 2].rotate_right(17)
                ^ w[index - 2].rotate_right(19)
                ^ (w[index - 2] >> 10);
            w[index] = w[index - 16]
                .wrapping_add(s0)
                .wrapping_add(w[index - 7])
                .wrapping_add(s1);
        }
        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) =
            (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);
        for index in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ ((!e) & g);
            let temp1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[index])
                .wrapping_add(w[index]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let temp2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(temp1);
            d = c;
            c = b;
            b = a;
            a = temp1.wrapping_add(temp2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }
    h.iter().map(|word| format!("{word:08x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        resolve_trusted_root_binding, trust_native_project_root, trusted_roots,
        ue_editor_process::{
            expire_asset_mutation_observation_fixture, mismatch_asset_mutation_pid_fixture,
            mismatch_asset_mutation_project_fixture, register_asset_mutation_observation_fixture,
            remove_asset_mutation_process_fixture, stop_editor_observation_session,
            EditorObservationSessionIdInput,
        },
        TrustRootInput,
    };
    use std::sync::Arc;

    fn hex(character: char, length: usize) -> String {
        std::iter::repeat(character).take(length).collect()
    }

    fn test_root(label: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("uagent-asset-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("Content")).unwrap();
        std::fs::write(root.join("Game.uproject"), "{}").unwrap();
        root
    }

    fn operation(
        index: usize,
        kind: &str,
        tool_name: &str,
        source: Option<&str>,
        asset: Option<&str>,
        target: Option<&str>,
        rollback_action: &str,
        rollback_tool: Option<&str>,
    ) -> AssetMutationApprovalOperation {
        AssetMutationApprovalOperation {
            operation_id: format!("op-{index}"),
            kind: kind.to_string(),
            tool_name: tool_name.to_string(),
            plugin_dry_run_hash: hex(char::from(b'a' + index as u8), 40),
            args_hash: hex(char::from(b'a' + index as u8), 64),
            source_asset_path: source.map(str::to_string),
            asset_path: asset.map(str::to_string),
            target_asset_path: target.map(str::to_string),
            rollback_action: rollback_action.to_string(),
            rollback_tool_name: rollback_tool.map(str::to_string),
            save_all: false,
            bulk: false,
        }
    }

    fn operations(run_id: &str) -> Vec<AssetMutationApprovalOperation> {
        let root = format!("/Game/UAgentSandbox/{run_id}");
        let duplicate = format!("{root}/Test01Copy");
        let renamed = format!("{root}/Test01Renamed");
        let moved = format!("{root}/Final/Test01Renamed");
        vec![
            operation(
                0,
                "create_folder",
                "ue.asset.create_folder",
                None,
                Some(&root),
                None,
                "cleanup_empty_folder",
                Some("ue.asset.delete"),
            ),
            operation(
                1,
                "duplicate",
                "ue.asset.duplicate",
                Some("/Game/Test01"),
                None,
                Some(&duplicate),
                "delete_duplicate",
                Some("ue.asset.delete"),
            ),
            operation(
                2,
                "rename",
                "ue.asset.rename",
                None,
                Some(&duplicate),
                Some(&renamed),
                "rename_back",
                Some("ue.asset.rename"),
            ),
            operation(
                3,
                "move",
                "ue.asset.move",
                None,
                Some(&renamed),
                Some(&moved),
                "move_back",
                Some("ue.asset.move"),
            ),
            operation(
                4,
                "save",
                "ue.asset.save",
                None,
                Some(&moved),
                None,
                "none",
                None,
            ),
        ]
    }

    fn registration(label: &str, now: u64) -> RegisterAssetMutationApprovalInput {
        let run_id = format!("run-{label}");
        let root = test_root(label);
        let root_ref = root.to_string_lossy().to_string();
        trust_native_project_root(TrustRootInput {
            root_ref: root_ref.clone(),
        })
        .expect("test root trust");
        let trusted_root = resolve_trusted_root_binding(&root_ref).expect("trusted test root");
        let project_binding_id = format!("project-{label}");
        let observation = register_asset_mutation_observation_fixture(
            &trusted_root,
            &project_binding_id,
            label,
            now,
        );
        RegisterAssetMutationApprovalInput {
            change_set_id: format!("change-{label}"),
            run_id: run_id.clone(),
            project_binding_id,
            trusted_project_root: root_ref,
            editor_session_id: observation.session_id,
            aggregate_dry_run_hash: hex('d', 64),
            aggregate_args_hash: hex('e', 64),
            requested_ttl_ms: 1_000,
            operations: operations(&run_id),
        }
    }

    fn step(
        registration: &RegisterAssetMutationApprovalInput,
        registration_id: &str,
        phase: &str,
        index: usize,
        token: Option<&str>,
    ) -> AssetMutationGuardInput {
        let operation = if phase == "execute" {
            registration.operations[index].clone()
        } else {
            inverse_operation(&registration.operations[index]).unwrap()
        };
        AssetMutationGuardInput {
            registration_id: registration_id.to_string(),
            approval_token: token.map(str::to_string),
            phase: phase.to_string(),
            operation_index: index,
            operation_count: registration.operations.len(),
            change_set_id: registration.change_set_id.clone(),
            run_id: registration.run_id.clone(),
            project_binding_id: registration.project_binding_id.clone(),
            aggregate_dry_run_hash: registration.aggregate_dry_run_hash.clone(),
            aggregate_args_hash: registration.aggregate_args_hash.clone(),
            operation,
        }
    }

    fn outcome(
        registration_id: &str,
        phase: &str,
        operation_id: &str,
        success: bool,
    ) -> RecordAssetMutationOutcomeInput {
        RecordAssetMutationOutcomeInput {
            registration_id: registration_id.to_string(),
            phase: phase.to_string(),
            operation_id: operation_id.to_string(),
            success,
            side_effect_observed: false,
            rollback_available: false,
            evidence_id: Some(format!("evidence:{phase}:{operation_id}")),
            reason_code: None,
        }
    }

    thread_local! {
        static REGISTRY_TEST_GUARD: std::cell::RefCell<Option<std::sync::MutexGuard<'static, ()>>> =
            std::cell::RefCell::new(None);
    }

    fn registry_test_mutex() -> &'static Mutex<()> {
        static TEST_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();
        TEST_MUTEX.get_or_init(|| Mutex::new(()))
    }

    fn clear_registry() {
        REGISTRY_TEST_GUARD.with(|slot| {
            let mut guard = slot.borrow_mut();
            if guard.is_none() {
                *guard = Some(
                    registry_test_mutex()
                        .lock()
                        .unwrap_or_else(|error| error.into_inner()),
                );
            }
        });
        let mut registry = approval_registry()
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        registry.records.clear();
        registry.terminal_evidence.clear();
    }

    #[test]
    fn asset_registration_requires_native_root_and_live_observation_authority() {
        clear_registry();
        let now = 50;

        let untrusted = registration("authority-untrusted", now);
        let untrusted_root_id = crate::hash_path(&crate::normalize_project_path(
            &untrusted.trusted_project_root,
        ));
        trusted_roots().lock().unwrap().remove(&untrusted_root_id);
        let blocked = register_asset_mutation_approval_at(untrusted, now);
        assert_eq!(blocked.reason, "untrusted_root");
        assert!(blocked.approval_token.is_none());

        let mut unknown = registration("authority-unknown", now);
        unknown.editor_session_id = "editor-observation:unknown".to_string();
        assert_eq!(
            register_asset_mutation_approval_at(unknown, now).reason,
            "observation_session_unknown"
        );

        let mismatched_pid = registration("authority-pid", now);
        mismatch_asset_mutation_pid_fixture(&mismatched_pid.editor_session_id);
        assert_eq!(
            register_asset_mutation_approval_at(mismatched_pid, now).reason,
            "observation_pid_mismatch"
        );

        let stopped = registration("authority-stopped", now);
        stop_editor_observation_session(EditorObservationSessionIdInput {
            session_id: stopped.editor_session_id.clone(),
        })
        .unwrap();
        assert_eq!(
            register_asset_mutation_approval_at(stopped, now).reason,
            "observation_session_stopped"
        );

        let expired = registration("authority-expired", now);
        expire_asset_mutation_observation_fixture(&expired.editor_session_id, now);
        assert_eq!(
            register_asset_mutation_approval_at(expired, now).reason,
            "observation_session_expired"
        );

        let exited = registration("authority-exited", now);
        remove_asset_mutation_process_fixture(&exited.editor_session_id);
        assert_eq!(
            register_asset_mutation_approval_at(exited, now).reason,
            "process_exited"
        );

        let root_a = registration("authority-root-a", now);
        let root_b = registration("authority-root-b", now);
        let mut mismatched_root = root_a;
        mismatched_root.trusted_project_root = root_b.trusted_project_root;
        assert_eq!(
            register_asset_mutation_approval_at(mismatched_root, now).reason,
            "trusted_root_binding_mismatch"
        );

        let raced = registration("authority-registration-race", now);
        let raced_root_id =
            crate::hash_path(&crate::normalize_project_path(&raced.trusted_project_root));
        *authority_race_injection().lock().unwrap() = Some(raced_root_id);
        let raced_result = register_asset_mutation_approval_at(raced, now);
        assert_eq!(raced_result.reason, "trust_revoked");
        assert!(raced_result.approval_token.is_none());
        assert!(raced_result.registration_id.is_empty());
    }

    #[test]
    fn asset_native_gate_blocks_registration_and_forward_but_allows_owned_rollback() {
        clear_registry();
        let now = 75;
        let disabled = registration("gate-disabled", now);
        let blocked = register_asset_mutation_approval_with_gate_at(disabled, now, false);
        assert_eq!(blocked.reason, "feature_disabled");
        assert!(blocked.approval_token.is_none());
        assert!(blocked.registration_id.is_empty());

        let input = registration("gate-recovery", now);
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let token = registered.approval_token.as_deref().unwrap();
        assert_eq!(
            authorize_asset_mutation_with_gate_at(
                step(
                    &input,
                    &registered.registration_id,
                    "execute",
                    0,
                    Some(token),
                ),
                now + 1,
                false,
            )
            .reason,
            "feature_disabled"
        );
        assert_eq!(
            authorize_asset_mutation_at(
                step(
                    &input,
                    &registered.registration_id,
                    "execute",
                    0,
                    Some(token),
                ),
                now + 1,
            )
            .status,
            "accepted_by_native_guard"
        );
        record_asset_mutation_outcome_at(
            outcome(&registered.registration_id, "execute", "op-0", true),
            now + 2,
        );
        assert_eq!(
            authorize_asset_mutation_with_gate_at(
                step(&input, &registered.registration_id, "rollback", 0, None),
                now + 3,
                false,
            )
            .status,
            "accepted_by_native_guard"
        );
    }

    #[test]
    fn asset_every_guard_rechecks_observation_and_process_liveness() {
        clear_registry();
        let now = 82;

        let stopped = registration("guard-stopped", now);
        let stopped_registration = register_asset_mutation_approval_at(stopped.clone(), now);
        stop_editor_observation_session(EditorObservationSessionIdInput {
            session_id: stopped.editor_session_id.clone(),
        })
        .unwrap();
        assert_eq!(
            authorize_asset_mutation_at(
                step(
                    &stopped,
                    &stopped_registration.registration_id,
                    "execute",
                    0,
                    stopped_registration.approval_token.as_deref(),
                ),
                now + 1,
            )
            .reason,
            "observation_session_stopped"
        );

        let exited = registration("guard-exited", now);
        let exited_registration = register_asset_mutation_approval_at(exited.clone(), now);
        remove_asset_mutation_process_fixture(&exited.editor_session_id);
        assert_eq!(
            authorize_asset_mutation_at(
                step(
                    &exited,
                    &exited_registration.registration_id,
                    "execute",
                    0,
                    exited_registration.approval_token.as_deref(),
                ),
                now + 1,
            )
            .reason,
            "process_exited"
        );

        let changed = registration("guard-project", now);
        let changed_registration = register_asset_mutation_approval_at(changed.clone(), now);
        mismatch_asset_mutation_project_fixture(&changed.editor_session_id);
        assert_eq!(
            authorize_asset_mutation_at(
                step(
                    &changed,
                    &changed_registration.registration_id,
                    "execute",
                    0,
                    changed_registration.approval_token.as_deref(),
                ),
                now + 1,
            )
            .reason,
            "observation_project_mismatch"
        );
    }

    #[test]
    fn asset_transaction_and_recovery_deadlines_are_absolute() {
        clear_registry();
        let now = 90;
        let input = registration("absolute-lease", now);
        let trusted_root = resolve_trusted_root_binding(&input.trusted_project_root).unwrap();
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let token = registered.approval_token.as_deref().unwrap();
        let started_at = now + 1;
        assert_eq!(
            authorize_asset_mutation_at(
                step(
                    &input,
                    &registered.registration_id,
                    "execute",
                    0,
                    Some(token),
                ),
                started_at,
            )
            .status,
            "accepted_by_native_guard"
        );
        record_asset_mutation_outcome_at(
            outcome(&registered.registration_id, "execute", "op-0", true),
            started_at + 1,
        );
        assert_eq!(
            authorize_asset_mutation_at(
                step(&input, &registered.registration_id, "execute", 1, None),
                started_at + TRANSACTION_LEASE_MS,
            )
            .reason,
            "transaction_expired"
        );

        let recovery_at = started_at + TRANSACTION_LEASE_MS + 1;
        register_asset_mutation_observation_fixture(
            &trusted_root,
            &input.project_binding_id,
            "absolute-lease",
            recovery_at,
        );
        assert_eq!(
            authorize_asset_mutation_with_gate_at(
                step(&input, &registered.registration_id, "rollback", 0, None),
                recovery_at,
                false,
            )
            .status,
            "accepted_by_native_guard"
        );
        assert_eq!(
            authorize_asset_mutation_at(
                step(&input, &registered.registration_id, "rollback", 0, None),
                started_at + RECOVERY_LEASE_MS,
            )
            .reason,
            "recovery_expired"
        );
    }

    #[test]
    fn asset_guard_and_evidence_fail_closed_after_trust_revocation() {
        clear_registry();
        let now = 95;
        let input = registration("trust-revoked", now);
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let token = registered.approval_token.as_deref().unwrap();
        trusted_roots()
            .lock()
            .unwrap()
            .remove(&registered.trusted_root_id);
        assert_eq!(
            authorize_asset_mutation_at(
                step(
                    &input,
                    &registered.registration_id,
                    "execute",
                    0,
                    Some(token),
                ),
                now + 1,
            )
            .reason,
            "trust_revoked"
        );
        assert_eq!(
            read_asset_content_evidence_at(
                ReadAssetContentEvidenceInput {
                    registration_id: registered.registration_id,
                    asset_path: "/Game/Test01".to_string(),
                },
                now + 1,
            )
            .reason,
            "trust_revoked"
        );
    }

    #[test]
    fn asset_guard_revalidates_authority_immediately_before_acceptance() {
        clear_registry();
        let now = 97;
        let input = registration("authority-race", now);
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let token = registered.approval_token.as_deref().unwrap();
        *authority_race_injection().lock().unwrap() = Some(registered.trusted_root_id.clone());

        let result = authorize_asset_mutation_at(
            step(
                &input,
                &registered.registration_id,
                "execute",
                0,
                Some(token),
            ),
            now + 1,
        );

        assert_eq!(result.reason, "trust_revoked");
        let registry = approval_registry().lock().unwrap();
        let record = registry.records.get(&registered.registration_id).unwrap();
        assert!(!record.token_consumed);
        assert!(record.in_flight.is_none());
    }

    #[test]
    fn asset_registration_contract_rejects_caller_authority_fields() {
        clear_registry();
        let mut value = serde_json::to_value(registration("caller-authority", 99)).unwrap();
        let object = value.as_object_mut().unwrap();
        object.insert("pidHash".to_string(), serde_json::json!("pid:forged"));
        object.insert(
            "observedEditorSessionId".to_string(),
            serde_json::json!("editor-observation:forged"),
        );
        object.insert(
            "observedPidHash".to_string(),
            serde_json::json!("pid:forged"),
        );
        object.insert(
            "assetMutationGateEnabled".to_string(),
            serde_json::json!(true),
        );
        assert!(serde_json::from_value::<RegisterAssetMutationApprovalInput>(value).is_err());
    }

    #[test]
    fn asset_approval_registry_rejects_forged_expired_and_mismatched_binding() {
        clear_registry();
        let now = 100;
        let input = registration("reject-forged", now);
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        assert_eq!(registered.status, "registered");
        let issued_token = registered.approval_token.as_deref().unwrap();
        assert_eq!(issued_token.len(), APPROVAL_TOKEN_BYTES * 2);
        let stored_hash = approval_registry()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .records
            .get(&registered.registration_id)
            .unwrap()
            .token_hash
            .clone();
        assert_eq!(stored_hash, sha256_bytes(issued_token.as_bytes()));
        assert_ne!(stored_hash, issued_token);

        let forged = authorize_asset_mutation_at(
            step(
                &input,
                &registered.registration_id,
                "execute",
                0,
                Some("token:forged"),
            ),
            now + 1,
        );
        assert_eq!(forged.reason, "approval_token_unknown");

        let mut mismatch = step(
            &input,
            &registered.registration_id,
            "execute",
            0,
            Some(issued_token),
        );
        mismatch.aggregate_args_hash = hex('f', 64);
        assert_eq!(
            authorize_asset_mutation_at(mismatch, now + 1).reason,
            "aggregate_args_hash_mismatch"
        );

        let expired_input = registration("expired", now);
        let expired = register_asset_mutation_approval_at(expired_input.clone(), now);
        let expired_token = expired.approval_token.as_deref().unwrap();
        assert_eq!(
            authorize_asset_mutation_at(
                step(
                    &expired_input,
                    &expired.registration_id,
                    "execute",
                    0,
                    Some(expired_token)
                ),
                now + 1_000
            )
            .reason,
            "approval_expired"
        );
    }

    #[test]
    fn asset_approval_registry_rejects_a_caller_chosen_registration_token() {
        clear_registry();
        let now = 125;
        let mut value = serde_json::to_value(registration("caller-token-red", now)).unwrap();
        value.as_object_mut().unwrap().insert(
            "approvalToken".to_string(),
            serde_json::json!("caller-chosen-token"),
        );

        assert!(serde_json::from_value::<RegisterAssetMutationApprovalInput>(value).is_err());
    }

    #[test]
    fn asset_registration_cancel_is_token_bound_and_only_retires_unstarted_records() {
        let now = 9_250;
        let input = registration("cancel-unstarted", now);
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let token = registered.approval_token.clone().unwrap();

        let wrong = cancel_asset_mutation_approval_at(
            CancelAssetMutationApprovalInput {
                registration_id: registered.registration_id.clone(),
                approval_token: "0".repeat(64),
            },
            now,
        );
        assert_eq!(wrong.status, "blocked");
        assert_eq!(wrong.reason, "approval_token_unknown");
        assert!(approval_registry()
            .lock()
            .unwrap()
            .records
            .contains_key(&registered.registration_id));

        let unknown = cancel_asset_mutation_approval_at(
            CancelAssetMutationApprovalInput {
                registration_id: "asset-registration:unknown".to_string(),
                approval_token: token.clone(),
            },
            now,
        );
        assert_eq!(unknown.reason, "approval_registration_unknown");

        let cancelled = cancel_asset_mutation_approval_at(
            CancelAssetMutationApprovalInput {
                registration_id: registered.registration_id.clone(),
                approval_token: token,
            },
            now,
        );
        assert_eq!(cancelled.status, "cancelled");
        let registry = approval_registry().lock().unwrap();
        assert!(!registry.records.contains_key(&registered.registration_id));
        assert!(!registry
            .terminal_evidence
            .contains_key(&registered.registration_id));
        drop(registry);

        for variant in [
            "token-consumed",
            "execute-started",
            "in-flight",
            "ownership",
        ] {
            let variant_input = registration(&format!("cancel-{variant}"), now);
            let variant_registration = register_asset_mutation_approval_at(variant_input, now);
            let variant_token = variant_registration.approval_token.clone().unwrap();
            {
                let mut registry = approval_registry().lock().unwrap();
                let record = registry
                    .records
                    .get_mut(&variant_registration.registration_id)
                    .unwrap();
                match variant {
                    "token-consumed" => record.token_consumed = true,
                    "execute-started" => record.execute_started = true,
                    "in-flight" => record.in_flight = Some(("execute".to_string(), 0)),
                    "ownership" => record.successful_execute.push(0),
                    _ => unreachable!(),
                }
            }
            let blocked = cancel_asset_mutation_approval_at(
                CancelAssetMutationApprovalInput {
                    registration_id: variant_registration.registration_id.clone(),
                    approval_token: variant_token,
                },
                now,
            );
            assert_eq!(blocked.status, "blocked", "variant={variant}");
            assert_eq!(
                blocked.reason, "approval_registration_started",
                "variant={variant}"
            );
            assert!(approval_registry()
                .lock()
                .unwrap()
                .records
                .contains_key(&variant_registration.registration_id));
        }
    }

    #[test]
    fn asset_approval_registry_rejects_a_ttl_above_the_native_cap() {
        clear_registry();
        let now = 150;
        let mut input = registration("ttl-red", now);
        input.requested_ttl_ms = MAX_APPROVAL_TTL_MS + 1;

        let result = register_asset_mutation_approval_at(input, now);

        assert_eq!(result.status, "blocked");
        assert_eq!(result.reason, "approval_ttl_exceeded");
    }

    #[test]
    fn asset_approval_registry_expires_before_first_execute_and_removes_record() {
        clear_registry();
        let now = 160;
        let input = registration("expires-before-execute", now);
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let token = registered.approval_token.as_deref().unwrap();

        let result = authorize_asset_mutation_at(
            step(
                &input,
                &registered.registration_id,
                "execute",
                0,
                Some(token),
            ),
            registered.expires_at,
        );

        assert_eq!(result.reason, "approval_expired");
        assert!(!approval_registry()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .records
            .contains_key(&registered.registration_id));
    }

    #[test]
    fn asset_approval_registry_continues_ordered_execute_after_token_ttl() {
        clear_registry();
        let now = 165;
        let input = registration("execute-after-expiry", now);
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let token = registered.approval_token.as_deref().unwrap();

        assert_eq!(
            authorize_asset_mutation_at(
                step(
                    &input,
                    &registered.registration_id,
                    "execute",
                    0,
                    Some(token),
                ),
                now + 1,
            )
            .status,
            "accepted_by_native_guard"
        );
        assert_eq!(
            record_asset_mutation_outcome(outcome(
                &registered.registration_id,
                "execute",
                "op-0",
                true,
            ))
            .status,
            "recorded"
        );

        assert_eq!(
            authorize_asset_mutation_at(
                step(
                    &input,
                    &registered.registration_id,
                    "execute",
                    1,
                    Some(token),
                ),
                registered.expires_at + 1,
            )
            .reason,
            "approval_token_replay"
        );
        assert_eq!(
            authorize_asset_mutation_at(
                step(&input, &registered.registration_id, "execute", 1, None,),
                registered.expires_at + 1,
            )
            .status,
            "accepted_by_native_guard"
        );
    }

    #[test]
    fn asset_approval_registry_completes_rollback_after_token_ttl_and_deletes_record() {
        clear_registry();
        let now = 170;
        let input = registration("rollback-after-expiry", now);
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let token = registered.approval_token.as_deref().unwrap();

        for index in 0..input.operations.len() {
            assert_eq!(
                authorize_asset_mutation_at(
                    step(
                        &input,
                        &registered.registration_id,
                        "execute",
                        index,
                        (index == 0).then_some(token),
                    ),
                    now + 1,
                )
                .status,
                "accepted_by_native_guard"
            );
            assert_eq!(
                record_asset_mutation_outcome(outcome(
                    &registered.registration_id,
                    "execute",
                    &format!("op-{index}"),
                    true,
                ))
                .status,
                "recorded"
            );
        }

        assert_eq!(
            authorize_asset_mutation_at(
                step(
                    &input,
                    &registered.registration_id,
                    "rollback",
                    3,
                    Some(token),
                ),
                registered.expires_at + 1,
            )
            .reason,
            "approval_token_forbidden"
        );
        for index in [3usize, 2, 1, 0] {
            assert_eq!(
                authorize_asset_mutation_at(
                    step(&input, &registered.registration_id, "rollback", index, None,),
                    registered.expires_at + 1,
                )
                .status,
                "accepted_by_native_guard"
            );
            let recorded = record_asset_mutation_outcome(outcome(
                &registered.registration_id,
                "rollback",
                &format!("op-{index}"),
                true,
            ));
            assert_eq!(recorded.status, "recorded");
            assert_eq!(recorded.terminal, index == 0);
        }

        for phase in ["rollback", "execute"] {
            assert_eq!(
                authorize_asset_mutation_at(
                    step(&input, &registered.registration_id, phase, 0, None),
                    registered.expires_at + 2,
                )
                .reason,
                "approval_registration_unknown"
            );
        }
    }

    #[test]
    fn asset_approval_registry_preserves_all_guards_after_token_ttl() {
        clear_registry();
        let now = 172;
        let input = registration("guards-after-expiry", now);
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let token = registered.approval_token.as_deref().unwrap();
        assert_eq!(
            authorize_asset_mutation_at(
                step(
                    &input,
                    &registered.registration_id,
                    "execute",
                    0,
                    Some(token),
                ),
                now + 1,
            )
            .status,
            "accepted_by_native_guard"
        );
        assert_eq!(
            record_asset_mutation_outcome(outcome(
                &registered.registration_id,
                "execute",
                "op-0",
                true,
            ))
            .status,
            "recorded"
        );

        let base = step(&input, &registered.registration_id, "execute", 1, None);
        let mut cases: Vec<(AssetMutationGuardInput, &str)> = Vec::new();
        let mut changed = base.clone();
        changed.change_set_id = "changeset-other".to_string();
        cases.push((changed, "change_set_mismatch"));
        let mut changed = base.clone();
        changed.run_id = "run-other".to_string();
        cases.push((changed, "run_id_mismatch"));
        let mut changed = base.clone();
        changed.project_binding_id = "project-other".to_string();
        cases.push((changed, "project_binding_mismatch"));
        let mut changed = base.clone();
        changed.aggregate_dry_run_hash = hex('f', 64);
        cases.push((changed, "aggregate_dry_run_hash_mismatch"));
        let mut changed = base.clone();
        changed.aggregate_args_hash = hex('f', 64);
        cases.push((changed, "aggregate_args_hash_mismatch"));
        let mut changed = base.clone();
        changed.operation_count = input.operations.len() - 1;
        cases.push((changed, "operation_count_mismatch"));
        let mut changed = base.clone();
        changed.operation_index = 2;
        changed.operation = input.operations[2].clone();
        cases.push((changed, "operation_out_of_order"));
        let mut changed = base;
        changed.operation.asset_path = Some(format!("/Game/UAgentSandbox/{}/other", input.run_id));
        cases.push((changed, "operation_binding_mismatch"));

        for (guard, reason) in cases {
            assert_eq!(
                authorize_asset_mutation_at(guard, registered.expires_at + 1).reason,
                reason
            );
        }
    }

    #[test]
    fn asset_approval_registry_rejects_every_exact_binding_mismatch() {
        clear_registry();
        let now = 175;
        let input = registration("binding-matrix", now);
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let token = registered.approval_token.as_deref().unwrap();
        let base = step(
            &input,
            &registered.registration_id,
            "execute",
            0,
            Some(token),
        );

        let mut cases: Vec<(AssetMutationGuardInput, &str)> = Vec::new();
        let mut changed = base.clone();
        changed.change_set_id = "changeset-other".to_string();
        cases.push((changed, "change_set_mismatch"));
        let mut changed = base.clone();
        changed.run_id = "run-other".to_string();
        cases.push((changed, "run_id_mismatch"));
        let mut changed = base.clone();
        changed.project_binding_id = "project-other".to_string();
        cases.push((changed, "project_binding_mismatch"));
        let mut changed = base.clone();
        changed.aggregate_dry_run_hash = hex('f', 64);
        cases.push((changed, "aggregate_dry_run_hash_mismatch"));
        let mut changed = base.clone();
        changed.aggregate_args_hash = hex('f', 64);
        cases.push((changed, "aggregate_args_hash_mismatch"));
        let mut changed = base.clone();
        changed.operation_count = 4;
        cases.push((changed, "operation_count_mismatch"));
        let mut changed = base.clone();
        changed.operation_index = 1;
        changed.operation = input.operations[1].clone();
        cases.push((changed, "operation_out_of_order"));
        let mut changed = base;
        changed.operation.asset_path = Some(format!("/Game/UAgentSandbox/{}/other", input.run_id));
        cases.push((changed, "operation_binding_mismatch"));

        for (guard, reason) in cases {
            assert_eq!(authorize_asset_mutation_at(guard, now + 1).reason, reason);
        }
    }

    #[test]
    fn asset_approval_registry_allows_five_steps_once_and_reverse_rollback_without_save() {
        clear_registry();
        let now = 200;
        let input = registration("lifecycle", now);
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let issued_token = registered.approval_token.clone().unwrap();
        for index in 0..5 {
            let token = (index == 0).then_some(issued_token.as_str());
            let authorized = authorize_asset_mutation_at(
                step(&input, &registered.registration_id, "execute", index, token),
                now + 1,
            );
            assert_eq!(authorized.status, "accepted_by_native_guard");
            let recorded = record_asset_mutation_outcome(outcome(
                &registered.registration_id,
                "execute",
                &format!("op-{index}"),
                true,
            ));
            assert_eq!(recorded.status, "recorded");
        }
        assert_eq!(
            authorize_asset_mutation_at(
                step(
                    &input,
                    &registered.registration_id,
                    "execute",
                    0,
                    Some(&issued_token)
                ),
                now + 2
            )
            .reason,
            "execute_replay"
        );

        for index in [3usize, 2, 1, 0] {
            let authorized = authorize_asset_mutation_at(
                step(&input, &registered.registration_id, "rollback", index, None),
                now + 2,
            );
            assert_eq!(authorized.status, "accepted_by_native_guard");
            let recorded = record_asset_mutation_outcome(outcome(
                &registered.registration_id,
                "rollback",
                &format!("op-{index}"),
                true,
            ));
            assert_eq!(recorded.status, "recorded");
        }
        assert_eq!(
            authorize_asset_mutation_at(
                step(&input, &registered.registration_id, "rollback", 0, None),
                now + 3
            )
            .reason,
            "approval_registration_unknown"
        );
        assert_eq!(
            authorize_asset_mutation_at(
                step(&input, &registered.registration_id, "execute", 0, None),
                now + 3
            )
            .reason,
            "approval_registration_unknown"
        );
    }

    #[test]
    fn asset_approval_registry_halts_partial_execution_and_rolls_back_only_successes() {
        clear_registry();
        let now = 300;
        let input = registration("partial", now);
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let issued_token = registered.approval_token.clone().unwrap();
        assert_eq!(
            authorize_asset_mutation_at(
                step(
                    &input,
                    &registered.registration_id,
                    "execute",
                    1,
                    Some(&issued_token)
                ),
                now + 1
            )
            .reason,
            "operation_out_of_order"
        );
        assert_eq!(
            authorize_asset_mutation_at(
                step(
                    &input,
                    &registered.registration_id,
                    "execute",
                    0,
                    Some(&issued_token)
                ),
                now + 1
            )
            .status,
            "accepted_by_native_guard"
        );
        record_asset_mutation_outcome(outcome(
            &registered.registration_id,
            "execute",
            "op-0",
            true,
        ));
        assert_eq!(
            authorize_asset_mutation_at(
                step(&input, &registered.registration_id, "execute", 1, None),
                now + 1
            )
            .status,
            "accepted_by_native_guard"
        );
        record_asset_mutation_outcome(outcome(
            &registered.registration_id,
            "execute",
            "op-1",
            false,
        ));
        assert_eq!(
            authorize_asset_mutation_at(
                step(&input, &registered.registration_id, "execute", 2, None),
                now + 1
            )
            .reason,
            "execute_halted"
        );
        assert_eq!(
            authorize_asset_mutation_at(
                step(&input, &registered.registration_id, "rollback", 1, None),
                now + 1
            )
            .reason,
            "rollback_out_of_order"
        );
        assert_eq!(
            authorize_asset_mutation_at(
                step(&input, &registered.registration_id, "rollback", 0, None),
                now + 1
            )
            .status,
            "accepted_by_native_guard"
        );
    }

    #[test]
    fn asset_approval_registry_rolls_back_the_failed_step_when_a_side_effect_was_observed() {
        clear_registry();
        let now = 350;
        let input = registration("partial-side-effect", now);
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let issued_token = registered.approval_token.clone().unwrap();
        assert_eq!(
            authorize_asset_mutation_at(
                step(
                    &input,
                    &registered.registration_id,
                    "execute",
                    0,
                    Some(&issued_token)
                ),
                now + 1
            )
            .status,
            "accepted_by_native_guard"
        );
        let invalid_partial = record_asset_mutation_outcome(RecordAssetMutationOutcomeInput {
            registration_id: registered.registration_id.clone(),
            phase: "execute".to_string(),
            operation_id: "op-0".to_string(),
            success: false,
            side_effect_observed: true,
            rollback_available: false,
            evidence_id: Some("evidence:execute:op-0".to_string()),
            reason_code: Some("mutation_failed".to_string()),
        });
        assert_eq!(invalid_partial.status, "blocked");
        assert_eq!(invalid_partial.reason, "partial_failure_contract_invalid");
        let recorded = record_asset_mutation_outcome(RecordAssetMutationOutcomeInput {
            registration_id: registered.registration_id.clone(),
            phase: "execute".to_string(),
            operation_id: "op-0".to_string(),
            success: false,
            side_effect_observed: true,
            rollback_available: true,
            evidence_id: Some("evidence:execute:op-0".to_string()),
            reason_code: Some("mutation_failed".to_string()),
        });
        assert!(recorded.rollback_available);
        assert_eq!(
            authorize_asset_mutation_at(
                step(&input, &registered.registration_id, "rollback", 0, None),
                now + 1
            )
            .status,
            "accepted_by_native_guard"
        );
    }

    #[test]
    fn asset_approval_registry_concurrent_first_step_is_atomic() {
        clear_registry();
        let now = 400;
        let input = Arc::new(registration("concurrent", now));
        let registered = register_asset_mutation_approval_at((*input).clone(), now);
        let issued_token = Arc::new(registered.approval_token.clone().unwrap());
        let mut handles = Vec::new();
        for _ in 0..2 {
            let input = Arc::clone(&input);
            let issued_token = Arc::clone(&issued_token);
            let registration_id = registered.registration_id.clone();
            handles.push(std::thread::spawn(move || {
                authorize_asset_mutation_at(
                    step(
                        &input,
                        &registration_id,
                        "execute",
                        0,
                        Some(issued_token.as_str()),
                    ),
                    now + 1,
                )
            }));
        }
        let results: Vec<_> = handles
            .into_iter()
            .map(|handle| handle.join().unwrap())
            .collect();
        assert_eq!(
            results
                .iter()
                .filter(|result| result.status == "accepted_by_native_guard")
                .count(),
            1
        );
        assert_eq!(
            results
                .iter()
                .filter(|result| result.status == "blocked")
                .count(),
            1
        );
    }

    #[test]
    fn asset_content_evidence_is_byte_safe_bounded_and_redacted() {
        clear_registry();
        let now = 500;
        let input = registration("evidence", now);
        std::fs::write(
            Path::new(&input.trusted_project_root).join("Content/Test01.uasset"),
            [0x00, 0xff, 0x10, 0x80],
        )
        .unwrap();
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let evidence = read_asset_content_evidence(ReadAssetContentEvidenceInput {
            registration_id: registered.registration_id.clone(),
            asset_path: "/Game/Test01".to_string(),
        });
        assert_eq!(evidence.status, "observed");
        assert_eq!(evidence.size, Some(4));
        assert_eq!(
            evidence.sha256.as_deref(),
            Some("a33bb2aed757bc839807d7a9deab0688c3cf06d36e53cb428f2e539c8dc76c5b")
        );

        let blocked = read_asset_content_evidence(ReadAssetContentEvidenceInput {
            registration_id: registered.registration_id.clone(),
            asset_path: "/Game/Secret/Other".to_string(),
        });
        assert_eq!(blocked.reason, "asset_path_not_bound");
        let traversal = read_asset_content_evidence(ReadAssetContentEvidenceInput {
            registration_id: registered.registration_id,
            asset_path: "/Game/../Secret.ini".to_string(),
        });
        assert_eq!(traversal.reason, "asset_path_invalid");

        let serialized = serde_json::to_string(&evidence).unwrap();
        assert!(!serialized.contains(&input.trusted_project_root));
        assert!(!serialized.contains("token:evidence"));
        assert!(!serialized.contains("session-evidence"));
        assert!(!serialized.contains("pid-evidence"));
    }

    #[test]
    fn asset_terminal_rollback_keeps_bounded_read_only_verification_available() {
        clear_registry();
        let now = 550;
        let terminal_at = now + 10_000;
        let input = registration("terminal-evidence", now);
        std::fs::write(
            Path::new(&input.trusted_project_root).join("Content/Test01.uasset"),
            [0x00, 0xff, 0x10, 0x80],
        )
        .unwrap();
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let token = registered.approval_token.as_deref().unwrap();

        for index in 0..input.operations.len() {
            assert_eq!(
                authorize_asset_mutation_at(
                    step(
                        &input,
                        &registered.registration_id,
                        "execute",
                        index,
                        (index == 0).then_some(token),
                    ),
                    now + 1,
                )
                .status,
                "accepted_by_native_guard"
            );
            assert_eq!(
                record_asset_mutation_outcome_at(
                    outcome(
                        &registered.registration_id,
                        "execute",
                        &format!("op-{index}"),
                        true,
                    ),
                    now + 1,
                )
                .status,
                "recorded"
            );
        }

        for index in [3usize, 2, 1, 0] {
            assert_eq!(
                authorize_asset_mutation_at(
                    step(&input, &registered.registration_id, "rollback", index, None),
                    registered.expires_at + 1,
                )
                .status,
                "accepted_by_native_guard"
            );
            let recorded = record_asset_mutation_outcome_at(
                outcome(
                    &registered.registration_id,
                    "rollback",
                    &format!("op-{index}"),
                    true,
                ),
                terminal_at,
            );
            assert_eq!(recorded.status, "recorded");
            assert_eq!(recorded.terminal, index == 0);
        }

        let evidence_input = ReadAssetContentEvidenceInput {
            registration_id: registered.registration_id.clone(),
            asset_path: "/Game/Test01".to_string(),
        };
        let manifest_input = SnapshotAssetContentManifestInput {
            registration_id: registered.registration_id.clone(),
        };
        let evidence = read_asset_content_evidence_at(evidence_input.clone(), terminal_at + 1);
        assert_eq!(evidence.status, "observed");
        assert_eq!(evidence.reason, "asset_present");
        let manifest = snapshot_asset_content_manifest_at(manifest_input.clone(), terminal_at + 1);
        assert_eq!(manifest.status, "observed");

        let registry = approval_registry()
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        assert!(!registry.records.contains_key(&registered.registration_id));
        let lease = registry
            .terminal_evidence
            .get(&registered.registration_id)
            .unwrap();
        assert_eq!(lease.expires_at, terminal_at + TERMINAL_EVIDENCE_LEASE_MS);
        assert_eq!(lease.run_id, input.run_id);
        let serialized = format!("{lease:?}");
        for forbidden in [
            token,
            input.editor_session_id.as_str(),
            input.aggregate_dry_run_hash.as_str(),
            input.aggregate_args_hash.as_str(),
        ] {
            assert!(!serialized.contains(forbidden));
        }
        drop(registry);

        for phase in ["rollback", "execute"] {
            assert_eq!(
                authorize_asset_mutation_at(
                    step(&input, &registered.registration_id, phase, 0, None),
                    registered.expires_at + 2,
                )
                .reason,
                "approval_registration_unknown"
            );
        }
        assert_eq!(
            record_asset_mutation_outcome_at(
                outcome(&registered.registration_id, "rollback", "op-0", true),
                terminal_at + 2,
            )
            .reason,
            "approval_registration_unknown"
        );

        let mut unbound = evidence_input.clone();
        unbound.asset_path = "/Game/Secret/Other".to_string();
        assert_eq!(
            read_asset_content_evidence_at(unbound, terminal_at + 2).reason,
            "asset_path_not_bound"
        );
        let mut traversal = evidence_input.clone();
        traversal.asset_path = "/Game/../Secret.ini".to_string();
        assert_eq!(
            read_asset_content_evidence_at(traversal, terminal_at + 2).reason,
            "asset_path_invalid"
        );

        let outside = Path::new(&input.trusted_project_root).join("Outside");
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("Test01.uasset"), [0x01]).unwrap();
        let escape = Path::new(&input.trusted_project_root)
            .join("Content")
            .join("Escape");
        #[cfg(windows)]
        let junction = std::process::Command::new("cmd")
            .args(["/d", "/c"])
            .arg(format!(
                "mklink /J {} {}",
                escape.display(),
                outside.display()
            ))
            .output()
            .unwrap();
        #[cfg(windows)]
        assert!(
            junction.status.success(),
            "{}{}",
            String::from_utf8_lossy(&junction.stdout),
            String::from_utf8_lossy(&junction.stderr)
        );
        #[cfg(unix)]
        std::os::unix::fs::symlink(&outside, &escape).unwrap();
        {
            let mut registry = approval_registry()
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            registry
                .terminal_evidence
                .get_mut(&registered.registration_id)
                .unwrap()
                .allowed_asset_paths
                .push("/Game/Escape/Test01".to_string());
        }
        let mut escaping = evidence_input.clone();
        escaping.asset_path = "/Game/Escape/Test01".to_string();
        assert_eq!(
            read_asset_content_evidence_at(escaping, terminal_at + 2).reason,
            "trusted_root_escape"
        );
        std::fs::remove_dir(&escape).unwrap();

        let expired_at = terminal_at + TERMINAL_EVIDENCE_LEASE_MS;
        assert_eq!(
            read_asset_content_evidence_at(evidence_input, expired_at).reason,
            "approval_registration_unknown"
        );
        assert_eq!(
            snapshot_asset_content_manifest_at(manifest_input, expired_at).reason,
            "approval_registration_unknown"
        );
        assert!(!approval_registry()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .terminal_evidence
            .contains_key(&registered.registration_id));
    }

    #[test]
    fn asset_registration_rejects_non_sandbox_save_all_bulk_and_path_chain() {
        clear_registry();
        let now = 600;
        let mut input = registration("invalid-save", now);
        input.operations[4].save_all = true;
        assert_eq!(
            register_asset_mutation_approval_at(input, now).reason,
            "save_all_blocked"
        );
        let mut input = registration("invalid-bulk", now);
        input.operations[2].bulk = true;
        assert_eq!(
            register_asset_mutation_approval_at(input, now).reason,
            "bulk_operation_blocked"
        );
        let mut input = registration("invalid-path", now);
        input.operations[3].target_asset_path = Some("/Game/Outside/Asset".to_string());
        assert_eq!(
            register_asset_mutation_approval_at(input, now).reason,
            "operation_binding_invalid"
        );
    }

    #[test]
    fn legacy_execution_guard_never_accepts_an_arbitrary_non_empty_token() {
        let input = AssetMutationCommandInput {
            tool_name: "ue.asset.create_folder".to_string(),
            asset_path: Some("/Game/UAgentSandbox/run-legacy".to_string()),
            target_asset_path: None,
            dry_run_hash: Some("dry:hash".to_string()),
            approval_token: Some("forged-but-non-empty".to_string()),
            editor_session_id: Some("session".to_string()),
            pid_hash: Some("pid".to_string()),
            asset_mutation_gate_enabled: Some(true),
            observed_editor_session_id: Some("session".to_string()),
            observed_pid_hash: Some("pid".to_string()),
        };
        let result = classify_asset_mutation(input, true);
        assert_eq!(result.status, "blocked");
        assert_eq!(result.reason, "approval_token_unknown");
    }
}
