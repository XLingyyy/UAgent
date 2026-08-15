use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use crate::{
    resolve_trusted_root_binding, resolve_trusted_root_binding_by_id,
    ue_editor_process::{
        observe_native_loaded_modules_for_asset_mutation, validate_asset_mutation_observation_at,
        validate_native_asset_mutation_observation_for_root, NativeLoadedModuleObservation,
    },
};

const REQUIRED_OPERATION_KINDS: [&str; 5] =
    ["create_folder", "duplicate", "rename", "move", "save"];
const MAX_APPROVAL_TTL_MS: u64 = 60_000;
const TRANSACTION_LEASE_MS: u64 = 15 * 60_000;
const RECOVERY_LEASE_MS: u64 = 20 * 60_000;
const TERMINAL_EVIDENCE_LEASE_MS: u64 = 60_000;
const APPROVAL_TOKEN_BYTES: usize = 32;
const MAX_COMPANION_MANIFEST_BYTES: u64 = 256 * 1024;
const MAX_COMPANION_ARTIFACT_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct Mvp15CompanionAttestationInput {
    pub trusted_root_id: String,
    pub editor_session_id: Option<String>,
    pub attestation_generation: Option<u64>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct Mvp15CompanionApprovalRetractionInput {
    pub attestation_generation: Option<u64>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mvp15CompanionArtifact {
    pub name: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mvp15CompanionAttestationResult {
    pub status: String,
    pub reason: String,
    pub manifest: Option<serde_json::Value>,
    pub installed_modules: Vec<Mvp15CompanionArtifact>,
    pub loaded_modules: Vec<Mvp15CompanionArtifact>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_receipt_id: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mvp15CompanionApprovalRetractionResult {
    pub status: String,
    pub reason: String,
    pub applied: bool,
    pub requested_attestation_generation: Option<u64>,
    pub minimum_attestation_generation: u64,
    pub generation: u64,
    pub revoked_approval_count: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_receipt_id: Option<String>,
}

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_receipt_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct RegisterAssetMutationApprovalInput {
    pub change_set_id: String,
    pub run_id: String,
    pub project_binding_id: String,
    pub trusted_project_root: String,
    pub editor_session_id: String,
    pub mcp_binding: String,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_receipt_id: Option<String>,
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
    pub mcp_binding: String,
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
    /// Opaque, native-derived binding for the exact guarded operation. The
    /// companion may retain it in its ledger, but it reveals neither the
    /// approval token nor a renderer-supplied process identity.
    pub accepted_plan_binding: Option<String>,
    pub native_created_at: Option<u64>,
    pub connection_generation: Option<u64>,
    pub session_generation: Option<u64>,
    pub native_source_identity: Option<String>,
    pub native_manifest_identity: Option<String>,
    pub native_plugin_identity: Option<String>,
    pub native_package_identity: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_receipt_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct RecordAssetMutationOutcomeInput {
    pub registration_id: String,
    pub phase: String,
    pub operation_id: String,
    pub success: bool,
    pub side_effect_observed: bool,
    pub effect_state: String,
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
    pub effect_state: String,
    pub terminal: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_receipt_id: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_receipt_id: Option<String>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub native_receipt_id: Option<String>,
}

#[derive(Debug, Clone)]
struct ApprovalRecord {
    token_hash: String,
    native_created_at: u64,
    change_set_id: String,
    run_id: String,
    project_binding_id: String,
    trusted_root_id: String,
    normalized_root: String,
    canonical_root: PathBuf,
    content_root: PathBuf,
    editor_session_id: String,
    mcp_binding: String,
    process_id: String,
    pid_hash: String,
    aggregate_dry_run_hash: String,
    aggregate_args_hash: String,
    companion_binding: Option<CompanionApprovalBinding>,
    companion_retracted: bool,
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

#[derive(Debug, Clone, PartialEq, Eq)]
struct CompanionApprovalBinding {
    generation: u64,
    attestation_generation: u64,
    fingerprint: String,
    trusted_root_id: String,
    editor_session_id: String,
    process_id: String,
    pid_hash: String,
    process_start_time: u64,
    manifest_sha256: String,
    descriptor_identity: String,
    source_identity: String,
    plugin_identity: String,
    package_identity: String,
}

#[derive(Default)]
struct CompanionApprovalAuthority {
    generation: u64,
    minimum_attestation_generation: u64,
    binding: Option<CompanionApprovalBinding>,
    companion_required: bool,
}

#[derive(Debug, Clone)]
struct TerminalEvidenceLease {
    run_id: String,
    trusted_root_id: String,
    normalized_root: String,
    canonical_root: PathBuf,
    content_root: PathBuf,
    allowed_asset_paths: Vec<String>,
    rollback_replay_guard_sha256: String,
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
    companion_authority: CompanionApprovalAuthority,
}

fn approval_registry() -> &'static Mutex<ApprovalRegistry> {
    static REGISTRY: OnceLock<Mutex<ApprovalRegistry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(ApprovalRegistry::default()))
}

fn record_mvp15d_native_observation<T: Serialize, U: Serialize>(
    api: &str,
    input: &T,
    result: &U,
) -> Option<String> {
    let (Ok(request), Ok(response)) = (serde_json::to_value(input), serde_json::to_value(result))
    else {
        return None;
    };
    crate::mvp15d_runtime_bridge::issue_native_observation_receipt(api, request, response)
}

#[cfg(test)]
pub(crate) fn reset_registry_for_test() {
    *approval_registry()
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = ApprovalRegistry::default();
    *authority_race_injection()
        .lock()
        .unwrap_or_else(|error| error.into_inner()) = None;
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
    let mut result = classify_asset_mutation(input.clone(), false);
    result.native_receipt_id =
        record_mvp15d_native_observation("dry_run_asset_mutation", &input, &result);
    result
}

#[tauri::command]
pub fn register_asset_mutation_approval(
    input: RegisterAssetMutationApprovalInput,
) -> RegisterAssetMutationApprovalResult {
    let mut result = register_asset_mutation_approval_with_gate_at(
        input.clone(),
        current_time_millis(),
        native_asset_mutation_enabled(),
    );
    result.native_receipt_id =
        record_mvp15d_native_observation("register_asset_mutation_approval", &input, &result);
    result
}

pub(crate) fn register_asset_mutation_approval_gate_off_probe(
    input: RegisterAssetMutationApprovalInput,
) -> RegisterAssetMutationApprovalResult {
    register_asset_mutation_approval_with_gate_at(input, current_time_millis(), false)
}

pub(crate) fn approval_ownership_counts() -> (usize, usize) {
    let registry = approval_registry()
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let registrations = registry.records.len();
    let issued_tokens = registry
        .records
        .values()
        .filter(|record| !record.token_hash.is_empty())
        .count();
    (registrations, issued_tokens)
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

/// Retract the native companion binding before a renderer publishes a blocked,
/// stale, disconnected, or replacement companion state.  Existing companion
/// approvals are retained as explicit revoked records. Forward execution remains
/// unavailable, while an exact inverse for an already-observed owned effect keeps
/// its bounded native recovery lease.
#[tauri::command]
pub fn retract_mvp15_companion_approvals(
    input: Mvp15CompanionApprovalRetractionInput,
) -> Mvp15CompanionApprovalRetractionResult {
    let mut result = match retract_companion_approvals(input.attestation_generation) {
        Ok(retraction) => Mvp15CompanionApprovalRetractionResult {
            status: if retraction.applied {
                "retracted".to_string()
            } else {
                "stale".to_string()
            },
            reason: if retraction.applied {
                "companion_approval_retracted".to_string()
            } else {
                "companion_retraction_stale".to_string()
            },
            applied: retraction.applied,
            requested_attestation_generation: retraction.requested_attestation_generation,
            minimum_attestation_generation: retraction.minimum_attestation_generation,
            generation: retraction.generation,
            revoked_approval_count: retraction.revoked_approval_count,
            native_receipt_id: None,
        },
        Err(()) => Mvp15CompanionApprovalRetractionResult {
            status: "blocked".to_string(),
            reason: "native_authority_unavailable".to_string(),
            applied: false,
            requested_attestation_generation: input.attestation_generation,
            minimum_attestation_generation: 0,
            generation: 0,
            revoked_approval_count: 0,
            native_receipt_id: None,
        },
    };
    result.native_receipt_id =
        record_mvp15d_native_observation("retract_mvp15_companion_approvals", &input, &result);
    result
}

struct CompanionApprovalRetraction {
    applied: bool,
    requested_attestation_generation: Option<u64>,
    minimum_attestation_generation: u64,
    generation: u64,
    revoked_approval_count: usize,
}

fn retract_companion_approvals(
    attestation_generation: Option<u64>,
) -> Result<CompanionApprovalRetraction, ()> {
    let mut registry = approval_registry().lock().map_err(|_| ())?;
    if let Some(attestation_generation) = attestation_generation {
        if attestation_generation < registry.companion_authority.minimum_attestation_generation {
            return Ok(CompanionApprovalRetraction {
                applied: false,
                requested_attestation_generation: Some(attestation_generation),
                minimum_attestation_generation: registry
                    .companion_authority
                    .minimum_attestation_generation,
                generation: registry.companion_authority.generation,
                revoked_approval_count: 0,
            });
        }
    }
    let next_generation = registry
        .companion_authority
        .generation
        .checked_add(1)
        .ok_or(())?;
    if let Some(attestation_generation) = attestation_generation {
        registry.companion_authority.minimum_attestation_generation = attestation_generation;
    }
    registry.companion_authority.generation = next_generation;
    registry.companion_authority.binding = None;
    registry.companion_authority.companion_required = true;
    let mut revoked_approval_count = 0;
    for record in registry.records.values_mut() {
        if record.companion_binding.is_some() && !record.companion_retracted {
            record.companion_retracted = true;
            revoked_approval_count += 1;
        }
    }
    Ok(CompanionApprovalRetraction {
        applied: true,
        requested_attestation_generation: attestation_generation,
        minimum_attestation_generation: registry.companion_authority.minimum_attestation_generation,
        generation: registry.companion_authority.generation,
        revoked_approval_count,
    })
}

#[tauri::command]
pub fn execute_asset_mutation(input: AssetMutationGuardInput) -> AssetMutationGuardResult {
    let mut result = if input.phase != "execute" {
        blocked_guard(&input, "phase_mismatch")
    } else {
        authorize_asset_mutation_with_gate_at(
            input.clone(),
            current_time_millis(),
            native_asset_mutation_enabled(),
        )
    };
    result.native_receipt_id =
        record_mvp15d_native_observation("execute_asset_mutation", &input, &result);
    result
}

#[tauri::command]
pub fn rollback_asset_mutation(input: AssetMutationGuardInput) -> AssetMutationGuardResult {
    let mut result = if input.phase != "rollback" {
        blocked_guard(&input, "phase_mismatch")
    } else {
        authorize_asset_mutation_with_gate_at(
            input.clone(),
            current_time_millis(),
            native_asset_mutation_enabled(),
        )
    };
    result.native_receipt_id =
        record_mvp15d_native_observation("rollback_asset_mutation", &input, &result);
    result
}

fn native_asset_mutation_enabled() -> bool {
    std::env::var("UAGENT_ENABLE_ASSET_MUTATION")
        .map(|value| value == "1")
        .unwrap_or(false)
}

/**
 * Native, trusted-root-bound source of companion package evidence.  It accepts no
 * renderer-provided manifest, module path, PID, or hash.  A positive result is
 * possible only after the native observation registry has revalidated one live UE
 * process and the OS module table identifies the exact installed companion DLL.
 */
#[tauri::command]
pub fn attest_mvp15_companion(
    input: Mvp15CompanionAttestationInput,
) -> Mvp15CompanionAttestationResult {
    let mut result = attest_mvp15_companion_inner(input.clone());
    result.native_receipt_id =
        record_mvp15d_native_observation("attest_mvp15_companion", &input, &result);
    result
}

fn attest_mvp15_companion_inner(
    input: Mvp15CompanionAttestationInput,
) -> Mvp15CompanionAttestationResult {
    let Some(attestation_generation) = input.attestation_generation.filter(|value| *value > 0)
    else {
        return finalize_companion_attestation(
            blocked_companion_attestation("companion_generation_required"),
            None,
            None,
        );
    };
    let trusted_root = match resolve_trusted_root_binding_by_id(&input.trusted_root_id) {
        Ok(binding) => binding,
        Err(_) => {
            return finalize_companion_attestation(
                blocked_companion_attestation("trusted_root_required"),
                None,
                Some(attestation_generation),
            )
        }
    };
    let candidate = trusted_root
        .canonical_root
        .join("Plugins")
        .join("UAgentAssetTools");
    let plugin_root = match std::fs::canonicalize(candidate) {
        Ok(path) if path.starts_with(&trusted_root.canonical_root) && path.is_dir() => path,
        _ => {
            return finalize_companion_attestation(
                blocked_companion_attestation("companion_plugin_not_installed"),
                None,
                Some(attestation_generation),
            )
        }
    };
    let Some(editor_session_id) = input
        .editor_session_id
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    else {
        return finalize_companion_attestation(
            blocked_companion_attestation("companion_observation_required"),
            None,
            Some(attestation_generation),
        );
    };
    let native_modules = match observe_native_loaded_modules_for_asset_mutation(
        editor_session_id,
        &trusted_root.root_id,
    ) {
        Ok(modules) => modules,
        Err(reason) => {
            return finalize_companion_attestation(
                blocked_companion_attestation(redact_companion_observation_reason(reason)),
                None,
                Some(attestation_generation),
            )
        }
    };
    let mut result =
        attest_companion_plugin_root_with_loaded_modules(&plugin_root, &native_modules);
    if result.status != "observed" {
        return finalize_companion_attestation(result, None, Some(attestation_generation));
    }
    // Hashing the installed image happens after the first OS module snapshot.
    // Re-enumerate and re-hash the expected loaded modules before publishing so
    // a DLL replacement/unload/reload cannot keep a stale positive result merely
    // because the editor PID itself survived.
    let post_hash_modules = match observe_native_loaded_modules_for_asset_mutation(
        editor_session_id,
        &trusted_root.root_id,
    ) {
        Ok(modules) => modules,
        Err(reason) => {
            return finalize_companion_attestation(
                blocked_companion_attestation(redact_companion_observation_reason(reason)),
                None,
                Some(attestation_generation),
            )
        }
    };
    let post_hash_loaded_modules = match verify_loaded_companion_modules(
        &plugin_root,
        &result.installed_modules,
        &post_hash_modules,
    ) {
        Ok(modules) => modules,
        Err(reason) => {
            return finalize_companion_attestation(
                blocked_companion_attestation(reason),
                None,
                Some(attestation_generation),
            )
        }
    };
    if !same_companion_artifact_identity(&result.loaded_modules, &post_hash_loaded_modules) {
        return finalize_companion_attestation(
            blocked_companion_attestation("loaded_module_identity_changed_after_hash"),
            None,
            Some(attestation_generation),
        );
    }
    result.loaded_modules = post_hash_loaded_modules;
    // Revalidate the same native process identity once more before publishing it
    // or binding future approvals to the companion generation.
    let final_observation = match validate_native_asset_mutation_observation_for_root(
        editor_session_id,
        &trusted_root.root_id,
    ) {
        Ok(binding) => binding,
        Err(reason) => {
            return finalize_companion_attestation(
                blocked_companion_attestation(redact_companion_observation_reason(reason)),
                None,
                Some(attestation_generation),
            )
        }
    };
    let companion_binding = companion_binding_from_attestation(
        &trusted_root.root_id,
        &final_observation,
        &result,
        attestation_generation,
    );
    finalize_companion_attestation(result, companion_binding, Some(attestation_generation))
}

fn same_companion_artifact_identity(
    left: &[Mvp15CompanionArtifact],
    right: &[Mvp15CompanionArtifact],
) -> bool {
    left.len() == right.len()
        && left.iter().zip(right).all(|(left, right)| {
            left.name == right.name && left.size == right.size && left.sha256 == right.sha256
        })
}

fn blocked_companion_attestation(reason: &str) -> Mvp15CompanionAttestationResult {
    Mvp15CompanionAttestationResult {
        status: "blocked".to_string(),
        reason: reason.to_string(),
        manifest: None,
        installed_modules: Vec::new(),
        loaded_modules: Vec::new(),
        native_receipt_id: None,
    }
}

fn finalize_companion_attestation(
    result: Mvp15CompanionAttestationResult,
    binding: Option<CompanionApprovalBinding>,
    attestation_generation: Option<u64>,
) -> Mvp15CompanionAttestationResult {
    if result.status != "observed" {
        let _ = retract_companion_approvals(attestation_generation);
        return result;
    }
    let Some(binding) = binding else {
        let _ = retract_companion_approvals(attestation_generation);
        return blocked_companion_attestation("companion_native_authority_unavailable");
    };
    match activate_companion_approval_binding(binding) {
        Ok(()) => result,
        Err("companion_attestation_stale") => {
            blocked_companion_attestation("companion_attestation_stale")
        }
        Err(_) => {
            let _ = retract_companion_approvals(attestation_generation);
            blocked_companion_attestation("companion_native_authority_unavailable")
        }
    }
}

fn companion_binding_from_attestation(
    trusted_root_id: &str,
    observation: &crate::ue_editor_process::AssetMutationObservationBinding,
    result: &Mvp15CompanionAttestationResult,
    attestation_generation: u64,
) -> Option<CompanionApprovalBinding> {
    let manifest = result.manifest.as_ref()?;
    let manifest_sha256 = manifest.get("manifestSelfSha256")?.as_str()?;
    if !is_lower_hex(manifest_sha256, 64) {
        return None;
    }
    let process_start_time = observation.process_start_time?;
    let descriptor_identity = companion_descriptor_identity(manifest)?;
    let source_identity = companion_source_identity(manifest)?;
    let plugin_identity = companion_plugin_identity(manifest)?;
    let package_identity = companion_package_identity(manifest)?;
    let fingerprint = sha256_bytes(
        format!(
            "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
            trusted_root_id,
            observation.session_id,
            observation.process_id,
            observation.pid_hash,
            process_start_time,
            manifest_sha256,
            descriptor_identity,
            source_identity,
            plugin_identity,
            package_identity,
        )
        .as_bytes(),
    );
    Some(CompanionApprovalBinding {
        generation: 0,
        attestation_generation,
        fingerprint,
        trusted_root_id: trusted_root_id.to_string(),
        editor_session_id: observation.session_id.clone(),
        process_id: observation.process_id.clone(),
        pid_hash: observation.pid_hash.clone(),
        process_start_time,
        manifest_sha256: manifest_sha256.to_string(),
        descriptor_identity,
        source_identity,
        plugin_identity,
        package_identity,
    })
}

fn companion_source_identity(manifest: &serde_json::Value) -> Option<String> {
    let record = manifest.as_object()?;
    let source_commit = record.get("sourceCommit")?.as_str()?;
    let source_tree_sha256 = record.get("sourceTreeSha256")?.as_str()?;
    let build_command_fingerprint = record.get("buildCommandFingerprint")?.as_str()?;
    if !is_lower_hex(source_commit, 40)
        || !is_lower_hex(source_tree_sha256, 64)
        || !is_lower_hex(build_command_fingerprint, 64)
    {
        return None;
    }
    let canonical = serde_json::json!({
        "buildCommandFingerprint": build_command_fingerprint,
        "sourceCommit": source_commit,
        "sourceTreeSha256": source_tree_sha256,
    });
    serde_json::to_vec(&canonical)
        .ok()
        .map(|bytes| sha256_bytes(&bytes))
}

fn manifest_artifact_by_path<'a>(
    manifest: &'a serde_json::Value,
    expected_path: &str,
) -> Option<&'a serde_json::Map<String, serde_json::Value>> {
    manifest
        .get("artifacts")?
        .as_array()?
        .iter()
        .filter_map(serde_json::Value::as_object)
        .find(|artifact| {
            artifact.get("path").and_then(serde_json::Value::as_str) == Some(expected_path)
        })
}

fn companion_plugin_identity(manifest: &serde_json::Value) -> Option<String> {
    let identity = manifest_artifact_by_path(manifest, "UAgentAssetTools.uplugin")?
        .get("sha256")?
        .as_str()?;
    is_lower_hex(identity, 64).then(|| identity.to_string())
}

fn companion_package_identity(manifest: &serde_json::Value) -> Option<String> {
    let canonical = serde_json::json!({
        "artifacts": manifest.get("artifacts")?,
        "modules": manifest.get("modules")?,
    });
    serde_json::to_vec(&canonical)
        .ok()
        .map(|bytes| sha256_bytes(&bytes))
}

/// The native-attested companion manifest already names the exact generated
/// schema and facade inventory.  Keep a separate canonical digest in the
/// approval binding so a later descriptor/manifest substitution cannot be
/// masked by a coincidental session identity match.
fn companion_descriptor_identity(manifest: &serde_json::Value) -> Option<String> {
    let record = manifest.as_object()?;
    let artifact_sha = |path: &str| {
        let value = manifest_artifact_by_path(manifest, path)?
            .get("sha256")?
            .as_str()?;
        is_lower_hex(value, 64).then_some(value)
    };
    let schema_sha256 = artifact_sha("Resources/uagent-asset-tools.schema.json")?;
    let uplugin_sha256 = artifact_sha("UAgentAssetTools.uplugin")?;
    let tool_names = record
        .get("toolNames")?
        .as_array()?
        .iter()
        .map(serde_json::Value::as_str)
        .collect::<Option<Vec<_>>>()?;
    if tool_names.is_empty()
        || tool_names
            .iter()
            .any(|name| name.is_empty() || name.len() > 128)
    {
        return None;
    }
    let canonical = serde_json::json!({
        "schemaSha256": schema_sha256,
        "toolNames": tool_names,
        "upluginSha256": uplugin_sha256,
    });
    serde_json::to_vec(&canonical)
        .ok()
        .map(|bytes| sha256_bytes(&bytes))
}

fn activate_companion_approval_binding(
    mut binding: CompanionApprovalBinding,
) -> Result<(), &'static str> {
    let mut registry = approval_registry()
        .lock()
        .map_err(|_| "native_authority_unavailable")?;
    if binding.attestation_generation <= registry.companion_authority.minimum_attestation_generation
    {
        return Err("companion_attestation_stale");
    }
    registry.companion_authority.generation = registry
        .companion_authority
        .generation
        .checked_add(1)
        .ok_or("native_authority_unavailable")?;
    binding.generation = registry.companion_authority.generation;
    registry.companion_authority.minimum_attestation_generation = binding.attestation_generation;
    registry.companion_authority.companion_required = true;
    for record in registry.records.values_mut() {
        if record.companion_binding.is_some() && !record.companion_retracted {
            record.companion_retracted = true;
        }
    }
    registry.companion_authority.binding = Some(binding);
    Ok(())
}

fn companion_binding_for_registration(
    authority: &CompanionApprovalAuthority,
    trusted_root_id: &str,
    observation: &crate::ue_editor_process::AssetMutationObservationBinding,
) -> Result<Option<CompanionApprovalBinding>, &'static str> {
    let Some(binding) = authority.binding.as_ref() else {
        if authority.companion_required {
            return Err("companion_attestation_required");
        }
        // Legacy direct-native approvals predate the companion route.  They are
        // intentionally unbound; a companion-backed approval always binds when
        // a verified companion generation is current for this observation.
        return Ok(None);
    };
    if binding.trusted_root_id != trusted_root_id
        || binding.editor_session_id != observation.session_id
        || binding.process_id != observation.process_id
        || binding.pid_hash != observation.pid_hash
        || observation.process_start_time != Some(binding.process_start_time)
    {
        return Err("companion_attestation_required");
    }
    Ok(Some(binding.clone()))
}

fn companion_record_has_forward_authority(
    authority: &CompanionApprovalAuthority,
    record: &ApprovalRecord,
) -> bool {
    let Some(record_binding) = record.companion_binding.as_ref() else {
        return !authority.companion_required;
    };
    !record.companion_retracted
        && authority
            .binding
            .as_ref()
            .is_some_and(|current| current == record_binding)
}

fn companion_record_authorizes_phase(
    authority: &CompanionApprovalAuthority,
    record: &ApprovalRecord,
    phase: &str,
) -> bool {
    companion_record_has_forward_authority(authority, record)
        || (phase == "rollback"
            && record.execute_started
            && remaining_rollback_indices(record).next().is_some())
}

#[cfg(test)]
fn attest_companion_plugin_root(plugin_root: &Path) -> Mvp15CompanionAttestationResult {
    // Unit fixtures are deliberately negative-only.  The production command
    // above cannot reach this path: it always requires a live native session.
    attest_companion_plugin_root_with_loaded_modules(plugin_root, &[])
}

fn attest_companion_plugin_root_with_loaded_modules(
    plugin_root: &Path,
    native_modules: &[NativeLoadedModuleObservation],
) -> Mvp15CompanionAttestationResult {
    let manifest_path = plugin_root.join("UAgentAssetTools.build.json");
    let manifest_metadata = match std::fs::symlink_metadata(&manifest_path) {
        Ok(metadata)
            if metadata.file_type().is_file()
                && !metadata.file_type().is_symlink()
                && metadata.len() <= MAX_COMPANION_MANIFEST_BYTES =>
        {
            metadata
        }
        _ => return blocked_companion_attestation("companion_manifest_not_available"),
    };
    let _ = manifest_metadata;
    let manifest_bytes = match std::fs::read(&manifest_path) {
        Ok(bytes) => bytes,
        Err(_) => return blocked_companion_attestation("companion_manifest_read_failed"),
    };
    let manifest: serde_json::Value = match serde_json::from_slice(&manifest_bytes) {
        Ok(value) => value,
        Err(_) => return blocked_companion_attestation("companion_manifest_invalid"),
    };
    let Some(record) = manifest.as_object() else {
        return blocked_companion_attestation("companion_manifest_invalid");
    };
    const MANIFEST_FIELDS: [&str; 26] = [
        "schemaVersion",
        "taskGeneration",
        "taskId",
        "pluginId",
        "pluginVersion",
        "contractVersion",
        "sourceCommit",
        "sourceTreeSha256",
        "physicalFixtures",
        "dirty",
        "engineVersion",
        "engineChangelist",
        "compatibleChangelist",
        "moduleBuildId",
        "targetPlatform",
        "configuration",
        "compiler",
        "windowsSdk",
        "buildCommandFingerprint",
        "buildEvidenceArtifacts",
        "artifacts",
        "modules",
        "toolNames",
        "generatedAt",
        "builder",
        "manifestSelfSha256",
    ];
    let keys = record.keys().map(String::as_str).collect::<BTreeSet<_>>();
    if keys.len() != MANIFEST_FIELDS.len()
        || !MANIFEST_FIELDS.iter().all(|field| keys.contains(field))
    {
        return blocked_companion_attestation("companion_manifest_shape_invalid");
    }
    if let Err(reason) = validate_companion_manifest_metadata(record) {
        return blocked_companion_attestation(reason);
    }
    let Some(package_values) = record
        .get("artifacts")
        .and_then(serde_json::Value::as_array)
    else {
        return blocked_companion_attestation("companion_artifact_invalid");
    };
    let mut package_artifacts = BTreeMap::new();
    for value in package_values {
        let (path, artifact) = match parse_companion_manifest_artifact(Some(value), None) {
            Ok(value) => value,
            Err(reason) => return blocked_companion_attestation(reason),
        };
        if package_artifacts.insert(path.clone(), artifact).is_some() {
            return blocked_companion_attestation("companion_artifact_invalid");
        }
        let expected = package_artifacts.get(&path).expect("inserted artifact");
        if !verify_companion_artifact(plugin_root.join(path.replace('/', "\\")), expected) {
            return blocked_companion_attestation("companion_artifact_hash_mismatch");
        }
    }
    for required in [
        "UAgentAssetTools.uplugin",
        "Resources/mvp15d-native-binding-v2.json",
        "Resources/uagent-asset-tools.schema.json",
        "Binaries/Win64/UnrealEditor.modules",
    ] {
        if !package_artifacts.contains_key(required) {
            return blocked_companion_attestation("companion_artifact_invalid");
        }
    }
    let Some(module_values) = record.get("modules").and_then(serde_json::Value::as_array) else {
        return blocked_companion_attestation("companion_modules_invalid");
    };
    if module_values.is_empty() {
        return blocked_companion_attestation("companion_modules_invalid");
    }
    let mut installed_modules = Vec::with_capacity(module_values.len());
    let mut names = BTreeSet::new();
    let mut previous_name = String::new();
    for value in module_values {
        let (path, artifact) = match parse_companion_manifest_artifact(Some(value), None) {
            Ok((path, artifact))
                if path.starts_with("Binaries/Win64/UnrealEditor-") && path.ends_with(".dll") =>
            {
                (path, artifact)
            }
            Ok(_) => return blocked_companion_attestation("companion_modules_invalid"),
            Err(reason) => return blocked_companion_attestation(reason),
        };
        if path != format!("Binaries/Win64/{}", artifact.name)
            || package_artifacts.get(&path).is_none_or(|package| {
                package.size != artifact.size || package.sha256 != artifact.sha256
            })
        {
            return blocked_companion_attestation("companion_modules_invalid");
        }
        if !previous_name.is_empty() && artifact.name <= previous_name
            || !names.insert(artifact.name.clone())
        {
            return blocked_companion_attestation("companion_modules_invalid");
        }
        previous_name = artifact.name.clone();
        if !verify_companion_artifact(
            plugin_root
                .join("Binaries")
                .join("Win64")
                .join(&artifact.name),
            &artifact,
        ) {
            return blocked_companion_attestation("companion_artifact_hash_mismatch");
        }
        installed_modules.push(artifact);
    }
    if package_artifacts.len() != installed_modules.len() + 4 {
        return blocked_companion_attestation("companion_artifact_invalid");
    }
    let module_index_path = plugin_root.join("Binaries/Win64/UnrealEditor.modules");
    let module_index_json: serde_json::Value = match std::fs::read(&module_index_path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    {
        Some(value) => value,
        None => return blocked_companion_attestation("companion_module_index_invalid"),
    };
    let Some(module_index_record) = module_index_json.as_object() else {
        return blocked_companion_attestation("companion_module_index_invalid");
    };
    let module_index_keys = module_index_record
        .keys()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    let expected_module_index_keys = BTreeSet::from(["BuildId", "Modules"]);
    let Some(module_mappings) = module_index_record
        .get("Modules")
        .and_then(serde_json::Value::as_object)
    else {
        return blocked_companion_attestation("companion_module_index_invalid");
    };
    if module_index_keys != expected_module_index_keys
        || module_index_record
            .get("BuildId")
            .and_then(serde_json::Value::as_str)
            != Some("55116800")
        || module_mappings.len() != names.len()
        || names.iter().any(|file_name| {
            let Some(module_name) = file_name
                .strip_prefix("UnrealEditor-")
                .and_then(|value| value.strip_suffix(".dll"))
            else {
                return true;
            };
            module_mappings
                .get(module_name)
                .and_then(serde_json::Value::as_str)
                != Some(file_name.as_str())
        })
    {
        return blocked_companion_attestation("companion_module_index_invalid");
    }
    let binaries_root = plugin_root.join("Binaries").join("Win64");
    let entries = match std::fs::read_dir(&binaries_root) {
        Ok(entries) => entries,
        Err(_) => return blocked_companion_attestation("companion_package_layout_invalid"),
    };
    let mut actual_names = BTreeSet::new();
    for entry in entries {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => return blocked_companion_attestation("companion_package_layout_invalid"),
        };
        let metadata = match std::fs::symlink_metadata(entry.path()) {
            Ok(metadata)
                if metadata.file_type().is_file() && !metadata.file_type().is_symlink() =>
            {
                metadata
            }
            _ => return blocked_companion_attestation("companion_package_layout_invalid"),
        };
        let _ = metadata;
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            return blocked_companion_attestation("companion_package_layout_invalid");
        };
        actual_names.insert(name);
    }
    let mut expected_package_names = names.clone();
    expected_package_names.insert("UnrealEditor.modules".to_string());
    if actual_names != expected_package_names {
        return blocked_companion_attestation("companion_package_layout_invalid");
    }

    let loaded_modules =
        match verify_loaded_companion_modules(plugin_root, &installed_modules, native_modules) {
            Ok(modules) => modules,
            Err(reason) => return blocked_companion_attestation(reason),
        };
    Mvp15CompanionAttestationResult {
        status: "observed".to_string(),
        reason: "loaded_module_identity_verified".to_string(),
        manifest: Some(manifest),
        installed_modules,
        loaded_modules,
        native_receipt_id: None,
    }
}

fn redact_companion_observation_reason(reason: &str) -> &'static str {
    match reason {
        "observation_session_stopped" => "companion_observation_stopped",
        "observation_session_expired" | "native_process_observation_stale" | "stale_generation" => {
            "companion_observation_stale"
        }
        "process_exited" => "companion_process_not_running",
        "native_process_observation_required" => "companion_native_observation_required",
        "platform_unsupported" => "companion_native_observation_unavailable",
        _ => "companion_native_observation_unavailable",
    }
}

fn verify_loaded_companion_modules(
    plugin_root: &Path,
    installed_modules: &[Mvp15CompanionArtifact],
    native_modules: &[NativeLoadedModuleObservation],
) -> Result<Vec<Mvp15CompanionArtifact>, &'static str> {
    let mut loaded_modules = Vec::with_capacity(installed_modules.len());
    for expected in installed_modules {
        let candidates = native_modules
            .iter()
            .filter(|candidate| candidate.basename == expected.name)
            .collect::<Vec<_>>();
        let [candidate] = candidates.as_slice() else {
            return Err(if candidates.is_empty() {
                "loaded_module_not_observed"
            } else {
                "loaded_module_identity_ambiguous"
            });
        };
        let installed_path = plugin_root
            .join("Binaries")
            .join("Win64")
            .join(&expected.name);
        let canonical_installed_path = std::fs::canonicalize(installed_path)
            .map_err(|_| "companion_artifact_hash_mismatch")?;
        if candidate.size != expected.size
            || !companion_paths_equivalent(&candidate.canonical_path, &canonical_installed_path)
        {
            return Err("loaded_module_identity_mismatch");
        }
        let metadata = std::fs::symlink_metadata(&candidate.canonical_path)
            .map_err(|_| "loaded_module_identity_mismatch")?;
        if !metadata.file_type().is_file()
            || metadata.file_type().is_symlink()
            || metadata.len() != expected.size
            || metadata.len() > MAX_COMPANION_ARTIFACT_BYTES
        {
            return Err("loaded_module_identity_mismatch");
        }
        let bytes = std::fs::read(&candidate.canonical_path)
            .map_err(|_| "loaded_module_identity_mismatch")?;
        let sha256 = sha256_bytes(&bytes);
        if sha256 != expected.sha256 {
            return Err("loaded_module_identity_mismatch");
        }
        loaded_modules.push(Mvp15CompanionArtifact {
            name: candidate.basename.clone(),
            size: metadata.len(),
            sha256,
        });
    }
    Ok(loaded_modules)
}

fn companion_paths_equivalent(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

fn validate_companion_manifest_metadata(
    record: &serde_json::Map<String, serde_json::Value>,
) -> Result<(), &'static str> {
    const TOOL_NAMES: [&str; 6] = [
        "ue.asset.create_folder",
        "ue.asset.duplicate",
        "ue.asset.rename",
        "ue.asset.move",
        "ue.asset.delete",
        "ue.asset.save",
    ];
    let valid_identity = manifest_string(record, "schemaVersion")
        == Some("uagent.ue-companion-plugin.build-manifest.v3")
        && manifest_string(record, "taskGeneration") == Some("final-d13-d16")
        && manifest_string(record, "taskId").is_some_and(|value| value.starts_with("TASK-MVP15D-"))
        && manifest_string(record, "pluginId") == Some("UAgentAssetTools")
        && manifest_string(record, "pluginVersion") == Some("0.1.0")
        && manifest_string(record, "contractVersion") == Some("mvp15d.asset-tools.v1")
        && record.get("dirty").and_then(serde_json::Value::as_bool) == Some(false)
        && manifest_string(record, "engineVersion") == Some("5.8.1")
        && record
            .get("engineChangelist")
            .and_then(serde_json::Value::as_u64)
            == Some(56057345)
        && record
            .get("compatibleChangelist")
            .and_then(serde_json::Value::as_u64)
            == Some(55116800)
        && manifest_string(record, "moduleBuildId") == Some("55116800")
        && manifest_string(record, "targetPlatform") == Some("Win64")
        && manifest_string(record, "configuration") == Some("Development")
        && manifest_string(record, "sourceCommit").is_some_and(|value| is_lower_hex(value, 40))
        && manifest_string(record, "sourceTreeSha256").is_some_and(|value| is_lower_hex(value, 64))
        && manifest_string(record, "buildCommandFingerprint")
            .is_some_and(|value| is_lower_hex(value, 64))
        && manifest_string(record, "generatedAt").is_some_and(is_canonical_companion_timestamp);
    if !valid_identity {
        return Err("companion_manifest_identity_invalid");
    }
    let valid_toolchain = |field: &str, expected_name: &str| {
        record
            .get(field)
            .and_then(serde_json::Value::as_object)
            .is_some_and(|value| {
                value.len() == 2
                    && manifest_string(value, "name") == Some(expected_name)
                    && manifest_string(value, "version").is_some_and(is_safe_companion_metadata)
            })
    };
    if !valid_toolchain("compiler", "MSVC") || !valid_toolchain("windowsSdk", "Windows SDK") {
        return Err("companion_manifest_identity_invalid");
    }
    if record
        .get("physicalFixtures")
        .and_then(serde_json::Value::as_array)
        .is_none_or(|value| value.len() != 2)
        || record
            .get("buildEvidenceArtifacts")
            .and_then(serde_json::Value::as_array)
            .is_none_or(|value| value.len() < 3)
    {
        return Err("companion_manifest_artifact_invalid");
    }
    let Some(tool_names) = record
        .get("toolNames")
        .and_then(serde_json::Value::as_array)
    else {
        return Err("companion_manifest_tool_names_invalid");
    };
    if tool_names.len() != TOOL_NAMES.len()
        || tool_names
            .iter()
            .zip(TOOL_NAMES)
            .any(|(value, expected)| value.as_str() != Some(expected))
    {
        return Err("companion_manifest_tool_names_invalid");
    }
    let Some(builder) = record.get("builder").and_then(serde_json::Value::as_object) else {
        return Err("companion_manifest_builder_invalid");
    };
    if builder.len() != 2
        || !builder.contains_key("kind")
        || !builder.contains_key("name")
        || !matches!(manifest_string(builder, "kind"), Some("local" | "ci"))
        || !manifest_string(builder, "name").is_some_and(is_safe_companion_metadata)
    {
        return Err("companion_manifest_builder_invalid");
    }
    let Some(declared_self_hash) = manifest_string(record, "manifestSelfSha256") else {
        return Err("companion_manifest_self_hash_invalid");
    };
    if !is_lower_hex(declared_self_hash, 64) {
        return Err("companion_manifest_self_hash_invalid");
    }
    let Some(computed_self_hash) = companion_manifest_self_hash(record) else {
        return Err("companion_manifest_self_hash_invalid");
    };
    if declared_self_hash != computed_self_hash {
        return Err("companion_manifest_self_hash_mismatch");
    }
    Ok(())
}

fn manifest_string<'a>(
    record: &'a serde_json::Map<String, serde_json::Value>,
    field: &str,
) -> Option<&'a str> {
    record.get(field).and_then(serde_json::Value::as_str)
}

fn companion_manifest_self_hash(
    record: &serde_json::Map<String, serde_json::Value>,
) -> Option<String> {
    let mut without_self_hash = record.clone();
    without_self_hash.remove("manifestSelfSha256")?;
    let mut canonical = String::new();
    if !append_canonical_companion_json(
        &serde_json::Value::Object(without_self_hash),
        &mut canonical,
    ) {
        return None;
    }
    Some(sha256_bytes(canonical.as_bytes()))
}

fn append_canonical_companion_json(value: &serde_json::Value, output: &mut String) -> bool {
    match value {
        serde_json::Value::Null => {
            output.push_str("null");
            true
        }
        serde_json::Value::Bool(value) => {
            output.push_str(if *value { "true" } else { "false" });
            true
        }
        serde_json::Value::Number(value) => {
            let Some(value) = value.as_u64() else {
                return false;
            };
            output.push_str(&value.to_string());
            true
        }
        serde_json::Value::String(value) => match serde_json::to_string(value) {
            Ok(encoded) => {
                output.push_str(&encoded);
                true
            }
            Err(_) => false,
        },
        serde_json::Value::Array(values) => {
            output.push('[');
            for (index, value) in values.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                if !append_canonical_companion_json(value, output) {
                    return false;
                }
            }
            output.push(']');
            true
        }
        serde_json::Value::Object(record) => {
            let mut keys = record.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            output.push('{');
            for (index, key) in keys.iter().enumerate() {
                if index > 0 {
                    output.push(',');
                }
                let Ok(encoded_key) = serde_json::to_string(key) else {
                    return false;
                };
                output.push_str(&encoded_key);
                output.push(':');
                let Some(value) = record.get(*key) else {
                    return false;
                };
                if !append_canonical_companion_json(value, output) {
                    return false;
                }
            }
            output.push('}');
            true
        }
    }
}

fn is_canonical_companion_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 24
        && [4, 7, 10, 13, 16, 19, 23]
            .iter()
            .zip([b'-', b'-', b'T', b':', b':', b'.', b'Z'])
            .all(|(index, expected)| bytes[*index] == expected)
        && bytes
            .iter()
            .enumerate()
            .filter(|(index, _)| ![4, 7, 10, 13, 16, 19, 23].contains(index))
            .all(|(_, byte)| byte.is_ascii_digit())
}

fn is_safe_companion_metadata(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric()
                || matches!(character, ' ' | '.' | '(' | ')' | '_' | '-')
        })
}

fn is_safe_mcp_binding(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 512
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, ':' | '.' | '_' | '-')
        })
}

fn parse_companion_manifest_artifact(
    value: Option<&serde_json::Value>,
    expected_path: Option<&str>,
) -> Result<(String, Mvp15CompanionArtifact), &'static str> {
    let Some(record) = value.and_then(serde_json::Value::as_object) else {
        return Err("companion_artifact_invalid");
    };
    if record.len() != 3
        || !["path", "size", "sha256"]
            .iter()
            .all(|key| record.contains_key(*key))
    {
        return Err("companion_artifact_invalid");
    }
    let Some(path) = record.get("path").and_then(serde_json::Value::as_str) else {
        return Err("companion_artifact_invalid");
    };
    let Some(size) = record.get("size").and_then(serde_json::Value::as_u64) else {
        return Err("companion_artifact_invalid");
    };
    let Some(sha256) = record.get("sha256").and_then(serde_json::Value::as_str) else {
        return Err("companion_artifact_invalid");
    };
    let Some(name) = path.rsplit('/').next() else {
        return Err("companion_artifact_invalid");
    };
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path
            .split('/')
            .any(|part| !is_safe_companion_file_name(part))
        || expected_path.is_some_and(|expected| expected != path)
        || !is_lower_hex(sha256, 64)
    {
        return Err("companion_artifact_invalid");
    }
    Ok((
        path.to_string(),
        Mvp15CompanionArtifact {
            name: name.to_string(),
            size,
            sha256: sha256.to_string(),
        },
    ))
}

fn verify_companion_artifact(path: PathBuf, expected: &Mvp15CompanionArtifact) -> bool {
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata)
            if metadata.file_type().is_file()
                && !metadata.file_type().is_symlink()
                && metadata.len() == expected.size
                && metadata.len() <= MAX_COMPANION_ARTIFACT_BYTES =>
        {
            metadata
        }
        _ => return false,
    };
    let _ = metadata;
    match std::fs::read(path) {
        Ok(bytes) => sha256_bytes(&bytes) == expected.sha256,
        Err(_) => false,
    }
}

fn is_safe_companion_file_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && name.len() <= 255
        && name.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-')
        })
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
    let mut result = record_asset_mutation_outcome_at(input.clone(), current_time_millis());
    result.native_receipt_id =
        record_mvp15d_native_observation("record_asset_mutation_outcome", &input, &result);
    result
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
    let has_inverse = inverse_operation(&record.operations[index]).is_some();
    let has_failure_evidence = input
        .evidence_id
        .as_deref()
        .map(str::trim)
        .is_some_and(|value| !value.is_empty())
        && input
            .reason_code
            .as_deref()
            .map(str::trim)
            .is_some_and(|value| !value.is_empty() && value != "none");
    let effect_state_valid = match input.effect_state.as_str() {
        // A successful UE call still requires a post-call observation.  Forward
        // success may retain its stored inverse; a successful inverse is terminal
        // for that individual action and must not claim a new forward inverse.
        "known_effect" => {
            input.success
            && input.side_effect_observed
            // The authoritative inverse availability is recomputed from the
            // stored accepted plan below; callers may not create an inverse by
            // choosing this boolean.
            && (input.phase == "execute" || !input.rollback_available)
        }
        // A failed call may enter bounded recovery only when the exact owned
        // inverse and stable effect evidence exist.  This is the only partial
        // effect shape accepted by native.
        "known_partial" => {
            !input.success
                && input.side_effect_observed
                && input.rollback_available
                && has_inverse
                && has_failure_evidence
        }
        // Complete observation of no effect is distinct from an inconclusive
        // response.  Neither can create an inverse or ownership entry.
        "known_none" => {
            !input.success
                && !input.side_effect_observed
                && !input.rollback_available
                && has_failure_evidence
        }
        // The call crossed the guard but no final state could be observed.  Keep
        // the registration alive for the existing bounded recovery window and
        // never normalize this into a zero-effect outcome.
        "unknown" => {
            !input.success
                && !input.side_effect_observed
                && !input.rollback_available
                && has_failure_evidence
        }
        _ => false,
    };
    if !effect_state_valid {
        return blocked_outcome(&input, "effect_state_contract_invalid");
    }
    record.in_flight = None;
    if input.phase == "execute" {
        if input.success || input.effect_state == "known_partial" {
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
    let terminal_lease =
        terminal.then(|| terminal_evidence_lease(record, &input.registration_id, now));
    let result = RecordAssetMutationOutcomeResult {
        status: "recorded".to_string(),
        reason: if input.success {
            "operation_succeeded"
        } else if input.effect_state == "unknown" {
            "operation_effect_unknown"
        } else {
            "operation_failed"
        }
        .to_string(),
        registration_id: input.registration_id.clone(),
        phase: input.phase,
        operation_id: input.operation_id,
        rollback_available,
        effect_state: input.effect_state,
        terminal,
        native_receipt_id: None,
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
    let mut result = read_asset_content_evidence_at(input.clone(), current_time_millis());
    result.native_receipt_id =
        record_mvp15d_native_observation("read_asset_content_evidence", &input, &result);
    result
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
            native_receipt_id: None,
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
        native_receipt_id: None,
    }
}

#[tauri::command]
pub fn snapshot_asset_content_manifest(
    input: SnapshotAssetContentManifestInput,
) -> AssetContentManifestResult {
    let mut result = snapshot_asset_content_manifest_at(input.clone(), current_time_millis());
    result.native_receipt_id =
        record_mvp15d_native_observation("snapshot_asset_content_manifest", &input, &result);
    result
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
        native_receipt_id: None,
    }
}

pub(crate) fn snapshot_task_project_content_manifest(
    project_root: &std::path::Path,
) -> Result<AssetContentManifestResult, String> {
    let canonical_root = std::fs::canonicalize(project_root)
        .map_err(|_| "project_content_root_invalid".to_string())?;
    let content_root = std::fs::canonicalize(canonical_root.join("Content"))
        .map_err(|_| "project_content_root_invalid".to_string())?;
    if !content_root.is_dir() || !content_root.starts_with(&canonical_root) {
        return Err("project_content_root_invalid".to_string());
    }
    let mut entries = Vec::new();
    collect_uasset_manifest(&content_root, &content_root, &mut entries)?;
    entries.sort_by(|left, right| left.asset_path.cmp(&right.asset_path));
    let canonical = entries
        .iter()
        .map(|entry| format!("{}|{}|{}\n", entry.asset_path, entry.size, entry.sha256))
        .collect::<String>();
    let aggregate = sha256_bytes(canonical.as_bytes());
    Ok(AssetContentManifestResult {
        status: "observed".to_string(),
        reason: "task_project_content_manifest_captured".to_string(),
        entries,
        aggregate_sha256: Some(aggregate.clone()),
        evidence_id: Some(format!(
            "task-project-content-manifest:{}",
            &aggregate[..16]
        )),
        native_receipt_id: None,
    })
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
        native_receipt_id: None,
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
            "{}|{}|{}|{}|{}|{}",
            token_hash,
            input.change_set_id,
            input.run_id,
            input.mcp_binding,
            input.aggregate_dry_run_hash,
            expires_at
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
    let companion_binding = match companion_binding_for_registration(
        &registry.companion_authority,
        &trusted_root_id,
        &final_observation,
    ) {
        Ok(binding) => binding,
        Err(reason) => return blocked_registration(reason),
    };
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
            native_created_at: issued_at,
            change_set_id: input.change_set_id,
            run_id: input.run_id,
            project_binding_id: input.project_binding_id,
            trusted_root_id: trusted_root_id.clone(),
            normalized_root: trusted_root.normalized_root,
            canonical_root,
            content_root,
            editor_session_id: observation.session_id,
            mcp_binding: input.mcp_binding,
            process_id: observation.process_id,
            pid_hash: observation.pid_hash,
            aggregate_dry_run_hash: input.aggregate_dry_run_hash,
            aggregate_args_hash: input.aggregate_args_hash,
            companion_binding,
            companion_retracted: false,
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
        native_receipt_id: None,
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
        Ok(mut registry) => {
            purge_expired_terminal_evidence(&mut registry, now);
            let Some(record) = registry.records.get(&input.registration_id) else {
                if input.phase == "rollback"
                    && registry
                        .terminal_evidence
                        .get(&input.registration_id)
                        .is_some_and(|lease| {
                            lease.rollback_replay_guard_sha256 == guard_input_sha256(&input)
                        })
                {
                    return blocked_guard(&input, "rollback_replay");
                }
                return blocked_guard(&input, "approval_registration_unknown");
            };
            if !companion_record_authorizes_phase(
                &registry.companion_authority,
                record,
                &input.phase,
            ) {
                return blocked_guard(&input, "companion_attestation_retracted");
            }
            Some(record.clone())
        }
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
    let companion_current = registry
        .records
        .get(&input.registration_id)
        .is_some_and(|record| {
            companion_record_authorizes_phase(&registry.companion_authority, record, &input.phase)
        });
    if !companion_current {
        return blocked_guard(&input, "companion_attestation_retracted");
    }
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
    if record.mcp_binding != input.mcp_binding {
        return blocked_guard(&input, "mcp_binding_mismatch");
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
        accepted_plan_binding: Some(native_accepted_plan_binding(&input.registration_id, record)),
        native_created_at: Some(record.native_created_at),
        connection_generation: record
            .companion_binding
            .as_ref()
            .map(|binding| binding.generation),
        session_generation: record
            .companion_binding
            .as_ref()
            .map(|binding| binding.attestation_generation),
        native_source_identity: record
            .companion_binding
            .as_ref()
            .map(|binding| binding.source_identity.clone()),
        native_manifest_identity: record
            .companion_binding
            .as_ref()
            .map(|binding| binding.manifest_sha256.clone()),
        native_plugin_identity: record
            .companion_binding
            .as_ref()
            .map(|binding| binding.plugin_identity.clone()),
        native_package_identity: record
            .companion_binding
            .as_ref()
            .map(|binding| binding.package_identity.clone()),
        native_receipt_id: None,
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
struct NativeAcceptedPlanBindingMaterial {
    contract: String,
    registration_id: String,
    change_set_id: String,
    run_id: String,
    project_binding_id: String,
    mcp_binding: String,
    aggregate_dry_run_hash: String,
    aggregate_args_hash: String,
    operations: Vec<AssetMutationApprovalOperation>,
    companion: Option<NativeAcceptedPlanCompanionMaterial>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
struct NativeAcceptedPlanCompanionMaterial {
    connection_generation: u64,
    session_generation: u64,
    fingerprint: String,
    source_identity: String,
    manifest_identity: String,
    plugin_identity: String,
    package_identity: String,
}

fn native_accepted_plan_binding_material(
    registration_id: &str,
    record: &ApprovalRecord,
) -> NativeAcceptedPlanBindingMaterial {
    let companion =
        record
            .companion_binding
            .as_ref()
            .map(|binding| NativeAcceptedPlanCompanionMaterial {
                connection_generation: binding.generation,
                session_generation: binding.attestation_generation,
                fingerprint: binding.fingerprint.clone(),
                source_identity: binding.source_identity.clone(),
                manifest_identity: binding.manifest_sha256.clone(),
                plugin_identity: binding.plugin_identity.clone(),
                package_identity: binding.package_identity.clone(),
            });
    NativeAcceptedPlanBindingMaterial {
        contract: "mvp15d-native-accepted-plan-v2".to_string(),
        registration_id: registration_id.to_string(),
        change_set_id: record.change_set_id.clone(),
        run_id: record.run_id.clone(),
        project_binding_id: record.project_binding_id.clone(),
        mcp_binding: record.mcp_binding.clone(),
        aggregate_dry_run_hash: record.aggregate_dry_run_hash.clone(),
        aggregate_args_hash: record.aggregate_args_hash.clone(),
        operations: record.operations.clone(),
        companion,
    }
}

fn hash_native_accepted_plan_binding_material(
    material: &NativeAcceptedPlanBindingMaterial,
) -> String {
    let serialized =
        serde_json::to_vec(material).expect("accepted native plan material must serialize");
    sha256_bytes(&serialized)
}

fn native_accepted_plan_binding(registration_id: &str, record: &ApprovalRecord) -> String {
    hash_native_accepted_plan_binding_material(&native_accepted_plan_binding_material(
        registration_id,
        record,
    ))
}

fn validate_registration(input: &RegisterAssetMutationApprovalInput, _now: u64) -> Option<String> {
    for value in [
        &input.change_set_id,
        &input.run_id,
        &input.project_binding_id,
        &input.editor_session_id,
        &input.mcp_binding,
    ] {
        if value.trim().is_empty() {
            return Some("approval_binding_incomplete".to_string());
        }
    }
    if !is_safe_mcp_binding(&input.mcp_binding) {
        return Some("mcp_binding_invalid".to_string());
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

fn guard_input_sha256(input: &AssetMutationGuardInput) -> String {
    sha256_bytes(&serde_json::to_vec(input).expect("native guard input must serialize"))
}

fn terminal_evidence_lease(
    record: &ApprovalRecord,
    registration_id: &str,
    now: u64,
) -> TerminalEvidenceLease {
    let allowed_asset_paths = record_allowed_asset_paths(record);
    let operation_index = *record
        .rolled_back
        .last()
        .expect("terminal rollback must record its final operation");
    let rollback_replay_guard_sha256 = guard_input_sha256(&AssetMutationGuardInput {
        registration_id: registration_id.to_string(),
        approval_token: None,
        phase: "rollback".to_string(),
        operation_index,
        operation_count: record.operations.len(),
        change_set_id: record.change_set_id.clone(),
        run_id: record.run_id.clone(),
        project_binding_id: record.project_binding_id.clone(),
        mcp_binding: record.mcp_binding.clone(),
        aggregate_dry_run_hash: record.aggregate_dry_run_hash.clone(),
        aggregate_args_hash: record.aggregate_args_hash.clone(),
        operation: inverse_operation(&record.operations[operation_index])
            .expect("terminal rollback operation must have an inverse"),
    });
    TerminalEvidenceLease {
        run_id: record.run_id.clone(),
        trusted_root_id: record.trusted_root_id.clone(),
        normalized_root: record.normalized_root.clone(),
        canonical_root: record.canonical_root.clone(),
        content_root: record.content_root.clone(),
        allowed_asset_paths,
        rollback_replay_guard_sha256,
        expires_at: now.saturating_add(TERMINAL_EVIDENCE_LEASE_MS),
    }
}

fn record_allowed_asset_paths(record: &ApprovalRecord) -> Vec<String> {
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
    allowed_asset_paths
}

fn purge_expired_terminal_evidence(registry: &mut ApprovalRegistry, now: u64) {
    let expired = registry
        .terminal_evidence
        .iter()
        .filter_map(|(registration_id, lease)| {
            (now >= lease.expires_at).then_some(registration_id.clone())
        })
        .collect::<Vec<_>>();
    for registration_id in expired {
        registry.terminal_evidence.remove(&registration_id);
    }
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
                allowed_asset_paths: record_allowed_asset_paths(record),
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
        native_receipt_id: None,
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
        native_receipt_id: None,
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
        accepted_plan_binding: None,
        native_created_at: None,
        connection_generation: None,
        session_generation: None,
        native_source_identity: None,
        native_manifest_identity: None,
        native_plugin_identity: None,
        native_package_identity: None,
        native_receipt_id: None,
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
        effect_state: input.effect_state.clone(),
        terminal: false,
        native_receipt_id: None,
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
        native_receipt_id: None,
    }
}

fn blocked_manifest(reason: &str) -> AssetContentManifestResult {
    AssetContentManifestResult {
        status: "blocked".to_string(),
        reason: reason.to_string(),
        entries: Vec::new(),
        aggregate_sha256: None,
        evidence_id: None,
        native_receipt_id: None,
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

    #[derive(Debug, Deserialize)]
    #[serde(rename_all = "camelCase")]
    #[serde(deny_unknown_fields)]
    struct NativeBindingTestVector {
        schema_version: String,
        binding_material: NativeAcceptedPlanBindingMaterial,
        native_guard_facts: NativeBindingGuardFacts,
    }

    #[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    #[serde(deny_unknown_fields)]
    struct NativeBindingGuardFacts {
        accepted_plan_binding: String,
        native_registration_id: String,
        native_phase: String,
        native_operation_index: usize,
        native_operation_count: usize,
        native_created_at: u64,
        connection_generation: u64,
        session_generation: u64,
        native_source_identity: String,
        native_manifest_identity: String,
        native_plugin_identity: String,
        native_package_identity: String,
    }

    fn hex(character: char, length: usize) -> String {
        std::iter::repeat(character).take(length).collect()
    }

    fn drift_lower_hex(value: &str) -> String {
        let replacement = if value.starts_with('a') { "b" } else { "a" };
        format!("{replacement}{}", &value[1..])
    }

    struct TestRoot {
        path: PathBuf,
    }

    impl TestRoot {
        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl std::ops::Deref for TestRoot {
        type Target = Path;

        fn deref(&self) -> &Self::Target {
            &self.path
        }
    }

    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    fn test_roots() -> &'static Mutex<Vec<TestRoot>> {
        static ROOTS: std::sync::OnceLock<Mutex<Vec<TestRoot>>> = std::sync::OnceLock::new();
        ROOTS.get_or_init(|| Mutex::new(Vec::new()))
    }

    fn test_root(label: &str) -> TestRoot {
        static NEXT_ROOT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let suffix = NEXT_ROOT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let created_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "uagent-asset-{label}-{}-{created_at}-{suffix}",
            std::process::id()
        ));
        std::fs::create_dir_all(root.join("Content")).unwrap();
        std::fs::write(root.join("Game.uproject"), "{}").unwrap();
        TestRoot { path: root }
    }

    fn managed_observation_child_command() -> std::process::Command {
        #[cfg(windows)]
        {
            let mut command = std::process::Command::new("powershell.exe");
            command.args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[Console]::In.ReadToEnd() | Out-Null",
            ]);
            command
        }
        #[cfg(not(windows))]
        {
            let mut command = std::process::Command::new("sh");
            command.args(["-c", "cat >/dev/null"]);
            command
        }
    }

    fn companion_artifact(path: &str, bytes: &[u8]) -> serde_json::Value {
        serde_json::json!({
            "path": path,
            "size": bytes.len(),
            "sha256": sha256_bytes(bytes),
        })
    }

    fn write_companion_manifest(root: &Path, manifest: &mut serde_json::Value) {
        let record = manifest.as_object_mut().unwrap();
        let self_hash = companion_manifest_self_hash(record).unwrap();
        record.insert(
            "manifestSelfSha256".to_string(),
            serde_json::Value::String(self_hash),
        );
        std::fs::write(
            root.join("UAgentAssetTools.build.json"),
            serde_json::to_vec(manifest).unwrap(),
        )
        .unwrap();
    }

    fn companion_package_root(label: &str) -> (TestRoot, serde_json::Value) {
        static NEXT_ROOT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let suffix = NEXT_ROOT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "uagent-companion-{label}-{}-{suffix}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("Resources")).unwrap();
        std::fs::create_dir_all(root.join("Binaries").join("Win64")).unwrap();
        let uplugin = b"plugin descriptor";
        let native_binding = b"native binding";
        let schema = b"contract schema";
        let module = b"companion module";
        let module_index = br#"{"BuildId":"55116800","Modules":{"UAgentAssetTools":"UnrealEditor-UAgentAssetTools.dll"}}"#;
        std::fs::write(root.join("UAgentAssetTools.uplugin"), uplugin).unwrap();
        std::fs::write(
            root.join("Resources/mvp15d-native-binding-v2.json"),
            native_binding,
        )
        .unwrap();
        std::fs::write(
            root.join("Resources/uagent-asset-tools.schema.json"),
            schema,
        )
        .unwrap();
        std::fs::write(
            root.join("Binaries/Win64/UnrealEditor-UAgentAssetTools.dll"),
            module,
        )
        .unwrap();
        std::fs::write(
            root.join("Binaries/Win64/UnrealEditor.modules"),
            module_index,
        )
        .unwrap();
        let mut manifest = serde_json::json!({
            "schemaVersion": "uagent.ue-companion-plugin.build-manifest.v3",
            "taskGeneration": "final-d13-d16",
            "taskId": "TASK-MVP15D-UAGENT-NATIVE-TEST",
            "pluginId": "UAgentAssetTools",
            "pluginVersion": "0.1.0",
            "contractVersion": "mvp15d.asset-tools.v1",
            "sourceCommit": hex('a', 40),
            "sourceTreeSha256": hex('b', 64),
            "physicalFixtures": [
                {
                    "path": "fixture-a.json",
                    "size": 1,
                    "sha256": hex('1', 64),
                    "gitObjectSha256": hex('1', 64)
                },
                {
                    "path": "fixture-b.json",
                    "size": 1,
                    "sha256": hex('2', 64),
                    "gitObjectSha256": hex('2', 64)
                }
            ],
            "dirty": false,
            "engineVersion": "5.8.1",
            "engineChangelist": 56057345,
            "compatibleChangelist": 55116800,
            "moduleBuildId": "55116800",
            "targetPlatform": "Win64",
            "configuration": "Development",
            "compiler": { "name": "MSVC", "version": "14.44.35207" },
            "windowsSdk": { "name": "Windows SDK", "version": "10.0.26100.0" },
            "buildCommandFingerprint": hex('c', 64),
            "buildEvidenceArtifacts": [
                companion_artifact("logs/stdout.log", b"log"),
                companion_artifact("metadata/build-command.json", b"command"),
                companion_artifact("metadata/build-result.json", b"result")
            ],
            "artifacts": [
                companion_artifact("Binaries/Win64/UnrealEditor-UAgentAssetTools.dll", module),
                companion_artifact("Binaries/Win64/UnrealEditor.modules", module_index),
                companion_artifact("Resources/mvp15d-native-binding-v2.json", native_binding),
                companion_artifact("Resources/uagent-asset-tools.schema.json", schema),
                companion_artifact("UAgentAssetTools.uplugin", uplugin)
            ],
            "modules": [companion_artifact("Binaries/Win64/UnrealEditor-UAgentAssetTools.dll", module)],
            "toolNames": [
                "ue.asset.create_folder",
                "ue.asset.duplicate",
                "ue.asset.rename",
                "ue.asset.move",
                "ue.asset.delete",
                "ue.asset.save"
            ],
            "generatedAt": "2026-07-20T00:00:00.000Z",
            "builder": { "kind": "local", "name": "native-test" },
            "manifestSelfSha256": ""
        });
        write_companion_manifest(&root, &mut manifest);
        (TestRoot { path: root }, manifest)
    }

    #[test]
    fn companion_attestation_rejects_manifest_and_package_tampering_before_readiness() {
        let _test_guard = clear_registry();
        let (root, mut manifest) = companion_package_root("attestation");
        let observed = attest_companion_plugin_root(&root);
        assert_eq!(observed.status, "blocked");
        assert_eq!(observed.reason, "loaded_module_not_observed");
        assert!(observed.installed_modules.is_empty());
        assert!(observed.manifest.is_none());

        manifest
            .as_object_mut()
            .unwrap()
            .insert("unexpected".to_string(), serde_json::Value::Bool(true));
        std::fs::write(
            root.join("UAgentAssetTools.build.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        assert_eq!(
            attest_companion_plugin_root(&root).reason,
            "companion_manifest_shape_invalid"
        );

        let (root, mut manifest) = companion_package_root("dirty");
        manifest
            .as_object_mut()
            .unwrap()
            .insert("dirty".to_string(), serde_json::Value::Bool(true));
        write_companion_manifest(&root, &mut manifest);
        assert_eq!(
            attest_companion_plugin_root(&root).reason,
            "companion_manifest_identity_invalid"
        );

        let (root, mut manifest) = companion_package_root("self-hash");
        manifest.as_object_mut().unwrap().insert(
            "manifestSelfSha256".to_string(),
            serde_json::Value::String(hex('0', 64)),
        );
        std::fs::write(
            root.join("UAgentAssetTools.build.json"),
            serde_json::to_vec(&manifest).unwrap(),
        )
        .unwrap();
        assert_eq!(
            attest_companion_plugin_root(&root).reason,
            "companion_manifest_self_hash_mismatch"
        );

        let (root, _) = companion_package_root("artifact");
        std::fs::write(
            root.join("Binaries/Win64/UnrealEditor-UAgentAssetTools.dll"),
            b"changed companion module",
        )
        .unwrap();
        assert_eq!(
            attest_companion_plugin_root(&root).reason,
            "companion_artifact_hash_mismatch"
        );

        let (root, _) = companion_package_root("extra");
        std::fs::write(
            root.join("Binaries/Win64/UnrealEditor-UAgentAssetTools.pdb"),
            b"debug",
        )
        .unwrap();
        assert_eq!(
            attest_companion_plugin_root(&root).reason,
            "companion_package_layout_invalid"
        );
    }

    #[test]
    fn companion_post_hash_module_identity_requires_exact_membership_and_hashes() {
        let _test_guard = clear_registry();
        let before = vec![Mvp15CompanionArtifact {
            name: "UnrealEditor-UAgentAssetTools.dll".to_string(),
            size: 17,
            sha256: hex('a', 64),
        }];
        assert!(same_companion_artifact_identity(&before, &before));
        assert!(!same_companion_artifact_identity(
            &before,
            &[Mvp15CompanionArtifact {
                name: "UnrealEditor-UAgentAssetTools.dll".to_string(),
                size: 17,
                sha256: hex('b', 64),
            }],
        ));
        assert!(!same_companion_artifact_identity(&before, &[]));
    }

    #[test]
    fn companion_native_module_bridge_rejects_fixture_observations() {
        let _test_guard = clear_registry();
        let input = registration("companion-fixture", 44);
        let trusted_root = resolve_trusted_root_binding(&input.trusted_project_root).unwrap();
        assert_eq!(
            validate_native_asset_mutation_observation_for_root(
                &input.editor_session_id,
                &trusted_root.root_id,
            )
            .unwrap_err(),
            "native_process_observation_required"
        );
    }

    #[test]
    fn companion_binding_fingerprints_descriptor_manifest_and_process_start() {
        let _test_guard = clear_registry();
        let (root, manifest) = companion_package_root("binding-fingerprint");
        let observation = crate::ue_editor_process::AssetMutationObservationBinding {
            session_id: "session:binding".to_string(),
            process_id: "process:binding".to_string(),
            project_id: "project:binding".to_string(),
            root_id: "root:binding".to_string(),
            canonical_root: root.path().to_path_buf(),
            pid_hash: "pid:binding".to_string(),
            pid: Some(77),
            process_start_time: Some(170),
            process_source: "native".to_string(),
            observation_generation: 1,
        };
        let result = Mvp15CompanionAttestationResult {
            status: "observed".to_string(),
            reason: "loaded_module_identity_verified".to_string(),
            manifest: Some(manifest.clone()),
            installed_modules: Vec::new(),
            loaded_modules: Vec::new(),
            native_receipt_id: None,
        };
        let binding = companion_binding_from_attestation("root:binding", &observation, &result, 4)
            .expect("verified native observation and manifest should bind");
        assert_eq!(binding.process_start_time, 170);
        assert!(is_lower_hex(&binding.manifest_sha256, 64));
        assert!(is_lower_hex(&binding.descriptor_identity, 64));
        assert!(is_lower_hex(&binding.source_identity, 64));
        assert!(is_lower_hex(&binding.plugin_identity, 64));
        assert!(is_lower_hex(&binding.package_identity, 64));

        let mut changed_manifest = manifest;
        changed_manifest["toolNames"][0] =
            serde_json::Value::String("ue.asset.changed".to_string());
        let changed_result = Mvp15CompanionAttestationResult {
            manifest: Some(changed_manifest),
            ..result.clone()
        };
        let changed_descriptor =
            companion_binding_from_attestation("root:binding", &observation, &changed_result, 4)
                .expect("descriptor identity calculation should remain deterministic");
        assert_ne!(
            binding.descriptor_identity,
            changed_descriptor.descriptor_identity
        );

        let restarted_observation = crate::ue_editor_process::AssetMutationObservationBinding {
            process_start_time: Some(171),
            ..observation
        };
        let restarted =
            companion_binding_from_attestation("root:binding", &restarted_observation, &result, 4)
                .expect("restarted process identity should bind independently");
        assert_ne!(binding.fingerprint, restarted.fingerprint);
    }

    #[test]
    fn companion_blocked_transition_revokes_bound_approval_before_any_guard_can_accept_it() {
        let _test_guard = clear_registry();
        let now = 45;
        let input = registration("companion-retraction", now);
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let binding = CompanionApprovalBinding {
            generation: 7,
            attestation_generation: 7,
            fingerprint: hex('f', 64),
            trusted_root_id: registered.trusted_root_id.clone(),
            editor_session_id: input.editor_session_id.clone(),
            process_id: "process:asset-fixture:companion-retraction".to_string(),
            pid_hash: "pid:asset-fixture:companion-retraction".to_string(),
            process_start_time: 45,
            manifest_sha256: hex('a', 64),
            descriptor_identity: hex('b', 64),
            source_identity: hex('c', 64),
            plugin_identity: hex('d', 64),
            package_identity: hex('e', 64),
        };
        {
            let mut registry = approval_registry().lock().unwrap();
            registry.companion_authority.generation = binding.generation;
            registry.companion_authority.minimum_attestation_generation =
                binding.attestation_generation;
            registry.companion_authority.binding = Some(binding.clone());
            registry.companion_authority.companion_required = true;
            registry
                .records
                .get_mut(&registered.registration_id)
                .unwrap()
                .companion_binding = Some(binding);
        }

        let blocked = finalize_companion_attestation(
            blocked_companion_attestation("companion_observation_stale"),
            None,
            Some(7),
        );
        assert_eq!(blocked.status, "blocked");
        assert_eq!(blocked.reason, "companion_observation_stale");
        let registry = approval_registry().lock().unwrap();
        assert_eq!(registry.companion_authority.generation, 8);
        assert_eq!(
            registry.companion_authority.minimum_attestation_generation,
            7
        );
        assert!(registry.companion_authority.binding.is_none());
        assert!(
            registry
                .records
                .get(&registered.registration_id)
                .unwrap()
                .companion_retracted
        );
        drop(registry);
        assert_eq!(
            authorize_asset_mutation_at(
                step(
                    &input,
                    &registered.registration_id,
                    "execute",
                    0,
                    registered.approval_token.as_deref(),
                ),
                now + 1,
            )
            .reason,
            "companion_attestation_retracted"
        );
        assert_eq!(
            authorize_asset_mutation_at(
                step(&input, &registered.registration_id, "rollback", 0, None,),
                now + 1,
            )
            .reason,
            "companion_attestation_retracted"
        );
    }

    #[test]
    fn stale_companion_attestation_cannot_replace_a_newer_native_binding() {
        let _test_guard = clear_registry();
        let current = CompanionApprovalBinding {
            generation: 9,
            attestation_generation: 9,
            fingerprint: hex('a', 64),
            trusted_root_id: "root:current".to_string(),
            editor_session_id: "session:current".to_string(),
            process_id: "process:current".to_string(),
            pid_hash: "pid:current".to_string(),
            process_start_time: 90,
            manifest_sha256: hex('c', 64),
            descriptor_identity: hex('d', 64),
            source_identity: hex('e', 64),
            plugin_identity: hex('f', 64),
            package_identity: hex('1', 64),
        };
        {
            let mut registry = approval_registry().lock().unwrap();
            registry.companion_authority.generation = current.generation;
            registry.companion_authority.minimum_attestation_generation =
                current.attestation_generation;
            registry.companion_authority.binding = Some(current.clone());
        }
        let stale = CompanionApprovalBinding {
            generation: 0,
            attestation_generation: 8,
            fingerprint: hex('b', 64),
            trusted_root_id: "root:stale".to_string(),
            editor_session_id: "session:stale".to_string(),
            process_id: "process:stale".to_string(),
            pid_hash: "pid:stale".to_string(),
            process_start_time: 80,
            manifest_sha256: hex('e', 64),
            descriptor_identity: hex('f', 64),
            source_identity: hex('1', 64),
            plugin_identity: hex('2', 64),
            package_identity: hex('3', 64),
        };
        assert_eq!(
            activate_companion_approval_binding(stale),
            Err("companion_attestation_stale")
        );
        let registry = approval_registry().lock().unwrap();
        assert_eq!(
            registry.companion_authority.binding.as_ref(),
            Some(&current)
        );
        assert_eq!(registry.companion_authority.generation, 9);
        assert_eq!(
            registry.companion_authority.minimum_attestation_generation,
            9
        );
    }

    #[test]
    fn stale_companion_retraction_is_explicit_and_preserves_newer_native_authority() {
        let _test_guard = clear_registry();
        let current = CompanionApprovalBinding {
            generation: 12,
            attestation_generation: 19,
            fingerprint: hex('a', 64),
            trusted_root_id: "root:current-retraction".to_string(),
            editor_session_id: "session:current-retraction".to_string(),
            process_id: "process:current-retraction".to_string(),
            pid_hash: "pid:current-retraction".to_string(),
            process_start_time: 190,
            manifest_sha256: hex('b', 64),
            descriptor_identity: hex('c', 64),
            source_identity: hex('d', 64),
            plugin_identity: hex('e', 64),
            package_identity: hex('f', 64),
        };
        {
            let mut registry = approval_registry().lock().unwrap();
            registry.companion_authority.generation = current.generation;
            registry.companion_authority.minimum_attestation_generation =
                current.attestation_generation;
            registry.companion_authority.binding = Some(current.clone());
        }

        let stale = retract_mvp15_companion_approvals(Mvp15CompanionApprovalRetractionInput {
            attestation_generation: Some(18),
        });
        assert_eq!(stale.status, "stale");
        assert_eq!(stale.reason, "companion_retraction_stale");
        assert!(!stale.applied);
        assert_eq!(stale.requested_attestation_generation, Some(18));
        assert_eq!(stale.minimum_attestation_generation, 19);
        assert_eq!(stale.generation, 12);
        assert_eq!(stale.revoked_approval_count, 0);
        assert_eq!(
            approval_registry()
                .lock()
                .unwrap()
                .companion_authority
                .binding
                .as_ref(),
            Some(&current)
        );

        let applied = retract_mvp15_companion_approvals(Mvp15CompanionApprovalRetractionInput {
            attestation_generation: Some(19),
        });
        assert_eq!(applied.status, "retracted");
        assert!(applied.applied);
        assert_eq!(applied.requested_attestation_generation, Some(19));
        assert_eq!(applied.minimum_attestation_generation, 19);
        assert_eq!(applied.generation, 13);
        assert!(approval_registry()
            .lock()
            .unwrap()
            .companion_authority
            .binding
            .is_none());
    }

    #[test]
    fn unconditional_companion_retraction_establishes_zero_authority_without_lowering_the_floor() {
        let _test_guard = clear_registry();
        let current = CompanionApprovalBinding {
            generation: 12,
            attestation_generation: 19,
            fingerprint: hex('a', 64),
            trusted_root_id: "root:baseline".to_string(),
            editor_session_id: "session:baseline".to_string(),
            process_id: "process:baseline".to_string(),
            pid_hash: "pid:baseline".to_string(),
            process_start_time: 190,
            manifest_sha256: hex('b', 64),
            descriptor_identity: hex('c', 64),
            source_identity: hex('d', 64),
            plugin_identity: hex('e', 64),
            package_identity: hex('f', 64),
        };
        {
            let mut registry = approval_registry().lock().unwrap();
            registry.companion_authority.generation = current.generation;
            registry.companion_authority.minimum_attestation_generation =
                current.attestation_generation;
            registry.companion_authority.binding = Some(current.clone());
            registry.companion_authority.companion_required = true;
        }

        let baseline = retract_mvp15_companion_approvals(Mvp15CompanionApprovalRetractionInput {
            attestation_generation: None,
        });
        assert_eq!(baseline.status, "retracted");
        assert_eq!(baseline.reason, "companion_approval_retracted");
        assert!(baseline.applied);
        assert_eq!(baseline.requested_attestation_generation, None);
        assert_eq!(baseline.minimum_attestation_generation, 19);
        assert_eq!(baseline.generation, 13);
        let registry = approval_registry().lock().unwrap();
        assert!(registry.companion_authority.binding.is_none());
        assert!(registry.companion_authority.companion_required);
        assert_eq!(
            registry.companion_authority.minimum_attestation_generation,
            19
        );
        drop(registry);

        let mut same_generation = current.clone();
        same_generation.generation = 0;
        assert_eq!(
            activate_companion_approval_binding(same_generation),
            Err("companion_attestation_stale")
        );
        let mut newer = current;
        newer.generation = 0;
        newer.attestation_generation = 20;
        assert_eq!(activate_companion_approval_binding(newer), Ok(()));
        let registry = approval_registry().lock().unwrap();
        assert_eq!(
            registry.companion_authority.minimum_attestation_generation,
            20
        );
        assert_eq!(registry.companion_authority.generation, 14);
    }

    #[test]
    fn companion_retraction_blocks_registration_and_execute_but_keeps_exact_owned_rollback() {
        let _test_guard = clear_registry();
        let now = 198;
        let input = registration("retraction-recovery", now);
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        bind_registration_to_companion(&registered.registration_id, 17, 29);
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
            record_asset_mutation_outcome_at(
                outcome(&registered.registration_id, "execute", "op-0", true),
                now + 2,
            )
            .status,
            "recorded"
        );

        let retracted = retract_mvp15_companion_approvals(Mvp15CompanionApprovalRetractionInput {
            attestation_generation: None,
        });
        assert!(retracted.applied);
        assert_eq!(retracted.revoked_approval_count, 1);
        assert_eq!(
            authorize_asset_mutation_at(
                step(&input, &registered.registration_id, "execute", 1, None,),
                now + 3,
            )
            .reason,
            "companion_attestation_retracted"
        );

        let new_registration = registration("retraction-new-registration", now + 3);
        assert_eq!(
            register_asset_mutation_approval_at(new_registration, now + 3).reason,
            "companion_attestation_required"
        );
        assert_eq!(
            authorize_asset_mutation_at(
                step(&input, &registered.registration_id, "rollback", 1, None,),
                now + 4,
            )
            .reason,
            "rollback_out_of_order"
        );
        let mut wrong_inverse = step(&input, &registered.registration_id, "rollback", 0, None);
        wrong_inverse.operation.asset_path =
            Some(format!("/Game/UAgentSandbox/{}/foreign", input.run_id));
        assert_eq!(
            authorize_asset_mutation_at(wrong_inverse, now + 4).reason,
            "rollback_binding_mismatch"
        );
        assert_eq!(
            authorize_asset_mutation_at(
                step(&input, &registered.registration_id, "rollback", 0, None,),
                now + 4,
            )
            .status,
            "accepted_by_native_guard"
        );
        assert_eq!(
            record_asset_mutation_outcome_at(
                outcome(&registered.registration_id, "rollback", "op-0", true),
                now + 5,
            )
            .status,
            "recorded"
        );
        assert!(!approval_registry()
            .lock()
            .unwrap()
            .records
            .contains_key(&registered.registration_id));
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
        let root_ref = root.path().to_string_lossy().to_string();
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
        let registration = RegisterAssetMutationApprovalInput {
            change_set_id: format!("change-{label}"),
            run_id: run_id.clone(),
            project_binding_id,
            trusted_project_root: root_ref,
            editor_session_id: observation.session_id,
            mcp_binding: "mcp-binding:fixture-1".to_string(),
            aggregate_dry_run_hash: hex('d', 64),
            aggregate_args_hash: hex('e', 64),
            requested_ttl_ms: 1_000,
            operations: operations(&run_id),
        };
        test_roots().lock().unwrap().push(root);
        registration
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
            mcp_binding: registration.mcp_binding.clone(),
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
            side_effect_observed: success,
            effect_state: if success {
                "known_effect".to_string()
            } else {
                "known_none".to_string()
            },
            rollback_available: false,
            evidence_id: Some(format!("evidence:{phase}:{operation_id}")),
            reason_code: (!success).then(|| "operation_failed".to_string()),
        }
    }

    struct TestScope {
        _registry_guard: std::sync::MutexGuard<'static, ()>,
    }

    impl Drop for TestScope {
        fn drop(&mut self) {
            test_roots()
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .clear();
        }
    }

    fn clear_registry() -> TestScope {
        let registry_guard = crate::reset_shared_registries_for_test();
        test_roots()
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
        TestScope {
            _registry_guard: registry_guard,
        }
    }

    fn remap_registration_for_binding_contract(from: &str, to: &str) {
        let mut registry = approval_registry().lock().unwrap();
        let record = registry
            .records
            .remove(from)
            .expect("registered fixture must exist before deterministic remap");
        assert!(registry.records.insert(to.to_string(), record).is_none());
    }

    fn bind_registration_to_companion(
        registration_id: &str,
        connection_generation: u64,
        session_generation: u64,
    ) -> CompanionApprovalBinding {
        bind_registration_to_companion_material(
            registration_id,
            &NativeAcceptedPlanCompanionMaterial {
                connection_generation,
                session_generation,
                fingerprint: hex('1', 64),
                source_identity: hex('4', 64),
                manifest_identity: hex('2', 64),
                plugin_identity: hex('5', 64),
                package_identity: hex('6', 64),
            },
        )
    }

    fn bind_registration_to_companion_material(
        registration_id: &str,
        companion: &NativeAcceptedPlanCompanionMaterial,
    ) -> CompanionApprovalBinding {
        let mut registry = approval_registry().lock().unwrap();
        let record = registry
            .records
            .get(registration_id)
            .expect("registered fixture must exist")
            .clone();
        let binding = CompanionApprovalBinding {
            generation: companion.connection_generation,
            attestation_generation: companion.session_generation,
            fingerprint: companion.fingerprint.clone(),
            trusted_root_id: record.trusted_root_id,
            editor_session_id: record.editor_session_id,
            process_id: record.process_id,
            pid_hash: record.pid_hash,
            process_start_time: 1_234_567,
            manifest_sha256: companion.manifest_identity.clone(),
            descriptor_identity: hex('3', 64),
            source_identity: companion.source_identity.clone(),
            plugin_identity: companion.plugin_identity.clone(),
            package_identity: companion.package_identity.clone(),
        };
        registry.companion_authority.generation = binding.generation;
        registry.companion_authority.minimum_attestation_generation =
            binding.attestation_generation;
        registry.companion_authority.binding = Some(binding.clone());
        registry.companion_authority.companion_required = true;
        registry
            .records
            .get_mut(registration_id)
            .expect("registered fixture must remain present")
            .companion_binding = Some(binding.clone());
        binding
    }

    fn native_binding_test_vector() -> NativeBindingTestVector {
        serde_json::from_str(include_str!(
            "../../../../packages/shared/test-fixtures/mvp15d-native-binding-v2.json"
        ))
        .expect("canonical native binding test vector must parse")
    }

    fn registration_from_binding_material(
        material: &NativeAcceptedPlanBindingMaterial,
        now: u64,
    ) -> RegisterAssetMutationApprovalInput {
        let mut input = registration("native-binding-contract", now);
        input.change_set_id = material.change_set_id.clone();
        input.run_id = material.run_id.clone();
        input.project_binding_id = material.project_binding_id.clone();
        input.mcp_binding = material.mcp_binding.clone();
        input.aggregate_dry_run_hash = material.aggregate_dry_run_hash.clone();
        input.aggregate_args_hash = material.aggregate_args_hash.clone();
        input.operations = material.operations.clone();
        input
    }

    fn guard_facts(result: &AssetMutationGuardResult) -> Option<NativeBindingGuardFacts> {
        Some(NativeBindingGuardFacts {
            accepted_plan_binding: result.accepted_plan_binding.clone()?,
            native_registration_id: result.registration_id.clone(),
            native_phase: result.phase.clone(),
            native_operation_index: result.operation_index,
            native_operation_count: result.operation_count,
            native_created_at: result.native_created_at?,
            connection_generation: result.connection_generation?,
            session_generation: result.session_generation?,
            native_source_identity: result.native_source_identity.clone()?,
            native_manifest_identity: result.native_manifest_identity.clone()?,
            native_plugin_identity: result.native_plugin_identity.clone()?,
            native_package_identity: result.native_package_identity.clone()?,
        })
    }

    #[test]
    fn asset_registration_requires_native_root_and_live_observation_authority() {
        let _test_guard = clear_registry();
        let now = 50;

        let untrusted = registration("authority-untrusted", now);
        let untrusted_root_id = crate::hash_path(&crate::normalize_project_path(
            &untrusted.trusted_project_root,
        ));
        trusted_roots().lock().unwrap().remove(&untrusted_root_id);
        let blocked = register_asset_mutation_approval_at(untrusted, now);
        assert_eq!(blocked.reason, "untrusted_root");
        assert!(blocked.approval_token.is_none());
        assert!(blocked.registration_id.is_empty());
        assert_eq!(approval_ownership_counts(), (0, 0));

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
    fn production_attach_replacement_makes_the_registered_predecessor_guard_stale() {
        let _test_guard = clear_registry();
        let now = current_time_millis();
        let mut registration = registration("native-generation-replacement", now);
        let create_input = crate::ue_editor_process::ManagedEditorProcessCreateInput {
            schema_version: "uagent.mvp15d.managed-editor-process-create.v2".to_string(),
            purpose: "negative_case_fixture".to_string(),
            task_id: "TASK-MVP15D-NATIVE-GENERATION-TEST".to_string(),
            phase: "ui-lifecycle".to_string(),
            project_id: registration.project_binding_id.clone(),
            root_ref: registration.trusted_project_root.clone(),
            uproject_relative_path: "Game.uproject".to_string(),
        };
        let process = crate::ue_editor_process::create_managed_editor_process_fixture(
            create_input.clone(),
            managed_observation_child_command(),
        )
        .unwrap()
        .process
        .unwrap();
        let attach_input = crate::ue_editor_process::EditorAttachInput {
            project_id: create_input.project_id,
            root_ref: create_input.root_ref,
            uproject_relative_path: create_input.uproject_relative_path,
            process_id: process.id,
            pid_hash: process.pid_hash,
            process_display_name: process.display_name,
            mode: "managed".to_string(),
        };
        let predecessor =
            crate::ue_editor_process::attach_editor_process(attach_input.clone()).unwrap();
        registration.editor_session_id = predecessor.session_id.clone().unwrap();
        let registered = register_asset_mutation_approval_at(registration.clone(), now);
        assert_eq!(registered.status, "registered");
        let successor = crate::ue_editor_process::attach_editor_process(attach_input).unwrap();
        assert!(
            successor.observation_generation.unwrap() > predecessor.observation_generation.unwrap()
        );
        let guarded = authorize_asset_mutation_at(
            step(
                &registration,
                &registered.registration_id,
                "execute",
                0,
                registered.approval_token.as_deref(),
            ),
            now,
        );
        assert_eq!(
            (guarded.status.as_str(), guarded.reason.as_str()),
            ("blocked", "stale_generation")
        );
        crate::ue_editor_process::reset_registries_for_test();
    }

    #[test]
    fn asset_native_gate_blocks_registration_and_forward_but_allows_owned_rollback() {
        let _test_guard = clear_registry();
        let now = 75;
        let disabled = registration("gate-disabled", now);
        let blocked = register_asset_mutation_approval_gate_off_probe(disabled);
        assert_eq!(blocked.reason, "feature_disabled");
        assert!(blocked.approval_token.is_none());
        assert!(blocked.registration_id.is_empty());
        assert_eq!(approval_ownership_counts(), (0, 0));

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
        let _test_guard = clear_registry();
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
        let _test_guard = clear_registry();
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
        let _test_guard = clear_registry();
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
        let _test_guard = clear_registry();
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
        let _test_guard = clear_registry();
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
        let _test_guard = clear_registry();
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
        let _test_guard = clear_registry();
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
        let _test_guard = clear_registry();
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
        let _test_guard = clear_registry();
        let now = 150;
        let mut input = registration("ttl-red", now);
        input.requested_ttl_ms = MAX_APPROVAL_TTL_MS + 1;

        let result = register_asset_mutation_approval_at(input, now);

        assert_eq!(result.status, "blocked");
        assert_eq!(result.reason, "approval_ttl_exceeded");
    }

    #[test]
    fn asset_approval_registry_expires_before_first_execute_and_removes_record() {
        let _test_guard = clear_registry();
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
        let _test_guard = clear_registry();
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
        let _test_guard = clear_registry();
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

        for (phase, expected_reason) in [
            ("rollback", "rollback_replay"),
            ("execute", "approval_registration_unknown"),
        ] {
            assert_eq!(
                authorize_asset_mutation_at(
                    step(&input, &registered.registration_id, phase, 0, None),
                    registered.expires_at + 2,
                )
                .reason,
                expected_reason
            );
        }
    }

    #[test]
    fn asset_approval_registry_preserves_all_guards_after_token_ttl() {
        let _test_guard = clear_registry();
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
        changed.mcp_binding = "mcp-binding:other".to_string();
        cases.push((changed, "mcp_binding_mismatch"));
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
        let _test_guard = clear_registry();
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
        changed.mcp_binding = "mcp-binding:other".to_string();
        cases.push((changed, "mcp_binding_mismatch"));
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
    fn native_accepted_plan_binding_has_literal_stable_execute_and_rollback_contract() {
        let _test_guard = clear_registry();
        let now = 190;
        let vector = native_binding_test_vector();
        assert_eq!(
            vector.schema_version,
            "uagent.mvp15d.native-binding-test-vector.v2"
        );
        let expected_binding = vector.native_guard_facts.accepted_plan_binding.as_str();
        assert_eq!(
            hash_native_accepted_plan_binding_material(&vector.binding_material),
            expected_binding
        );

        let input = registration_from_binding_material(&vector.binding_material, now);
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let token = registered.approval_token.as_deref().unwrap();
        let registration_id = vector.binding_material.registration_id.as_str();
        remap_registration_for_binding_contract(&registered.registration_id, registration_id);
        let companion = vector
            .binding_material
            .companion
            .as_ref()
            .expect("canonical vector must bind companion provenance");
        bind_registration_to_companion_material(registration_id, companion);
        let actual_material = {
            let registry = approval_registry().lock().unwrap();
            native_accepted_plan_binding_material(
                registration_id,
                registry.records.get(registration_id).unwrap(),
            )
        };
        assert_eq!(actual_material, vector.binding_material);

        for index in 0..input.operations.len() {
            let authorized = authorize_asset_mutation_at(
                step(
                    &input,
                    registration_id,
                    "execute",
                    index,
                    (index == 0).then_some(token),
                ),
                now + 1,
            );
            assert_eq!(authorized.status, "accepted_by_native_guard");
            assert_eq!(
                authorized.accepted_plan_binding.as_deref(),
                Some(expected_binding)
            );
            if index == 0 {
                assert_eq!(
                    guard_facts(&authorized).as_ref(),
                    Some(&vector.native_guard_facts)
                );
            }
            assert_eq!(
                record_asset_mutation_outcome(outcome(
                    registration_id,
                    "execute",
                    &input.operations[index].operation_id,
                    true,
                ))
                .status,
                "recorded"
            );
        }

        for index in [3usize, 2, 1, 0] {
            let authorized = authorize_asset_mutation_at(
                step(&input, registration_id, "rollback", index, None),
                now + 2,
            );
            assert_eq!(authorized.status, "accepted_by_native_guard");
            assert_eq!(
                authorized.accepted_plan_binding.as_deref(),
                Some(expected_binding)
            );
            assert_eq!(
                record_asset_mutation_outcome(outcome(
                    registration_id,
                    "rollback",
                    &input.operations[index].operation_id,
                    true,
                ))
                .status,
                "recorded"
            );
        }
    }

    #[test]
    fn canonical_native_binding_material_rejects_every_independent_bound_fact_drift() {
        let _test_guard = clear_registry();
        let vector = native_binding_test_vector();
        let material = vector.binding_material;
        let expected = vector.native_guard_facts.accepted_plan_binding;
        assert_eq!(
            hash_native_accepted_plan_binding_material(&material),
            expected
        );

        macro_rules! reject_material {
            ($label:expr, |$candidate:ident| $body:block) => {{
                let mut $candidate = material.clone();
                $body
                assert_ne!(
                    hash_native_accepted_plan_binding_material(&$candidate),
                    expected,
                    "{} drift must not retain the canonical binding",
                    $label
                );
            }};
        }

        reject_material!("contract", |candidate| {
            candidate.contract = "mvp15d-native-accepted-plan-v3".to_string();
        });
        reject_material!("registrationId", |candidate| {
            candidate.registration_id =
                "asset-approval:deterministic-native-plan-drift".to_string();
        });
        reject_material!("changeSetId", |candidate| {
            candidate.change_set_id.push_str("-drift");
        });
        reject_material!("runId", |candidate| {
            candidate.run_id.push_str("-drift");
        });
        reject_material!("projectBindingId", |candidate| {
            candidate.project_binding_id.push_str("-drift");
        });
        reject_material!("mcpBinding", |candidate| {
            candidate.mcp_binding.push_str("-drift");
        });
        reject_material!("aggregateDryRunHash", |candidate| {
            candidate.aggregate_dry_run_hash = drift_lower_hex(&candidate.aggregate_dry_run_hash);
        });
        reject_material!("aggregateArgsHash", |candidate| {
            candidate.aggregate_args_hash = drift_lower_hex(&candidate.aggregate_args_hash);
        });
        reject_material!("operations.count", |candidate| {
            candidate.operations.pop();
        });
        reject_material!("operations.order", |candidate| {
            candidate.operations.swap(0, 1);
        });

        for index in 0..material.operations.len() {
            reject_material!(format!("operations[{index}].operationId"), |candidate| {
                candidate.operations[index].operation_id.push_str("-drift");
            });
            reject_material!(format!("operations[{index}].kind"), |candidate| {
                candidate.operations[index].kind = if candidate.operations[index].kind == "move" {
                    "rename".to_string()
                } else {
                    "move".to_string()
                };
            });
            reject_material!(format!("operations[{index}].toolName"), |candidate| {
                candidate.operations[index].tool_name =
                    if candidate.operations[index].tool_name == "ue.asset.move" {
                        "ue.asset.rename".to_string()
                    } else {
                        "ue.asset.move".to_string()
                    };
            });
            reject_material!(
                format!("operations[{index}].pluginDryRunHash"),
                |candidate| {
                    candidate.operations[index].plugin_dry_run_hash =
                        drift_lower_hex(&candidate.operations[index].plugin_dry_run_hash);
                }
            );
            reject_material!(format!("operations[{index}].argsHash"), |candidate| {
                candidate.operations[index].args_hash =
                    drift_lower_hex(&candidate.operations[index].args_hash);
            });
            reject_material!(
                format!("operations[{index}].sourceAssetPath"),
                |candidate| {
                    candidate.operations[index].source_asset_path =
                        Some("/Game/CanonicalDrift/Source".to_string());
                }
            );
            reject_material!(format!("operations[{index}].assetPath"), |candidate| {
                candidate.operations[index].asset_path =
                    Some("/Game/UAgentSandbox/CanonicalDrift/Asset".to_string());
            });
            reject_material!(
                format!("operations[{index}].targetAssetPath"),
                |candidate| {
                    candidate.operations[index].target_asset_path =
                        Some("/Game/UAgentSandbox/CanonicalDrift/Target".to_string());
                }
            );
            reject_material!(format!("operations[{index}].rollbackAction"), |candidate| {
                candidate.operations[index].rollback_action =
                    if candidate.operations[index].rollback_action == "move_back" {
                        "rename_back".to_string()
                    } else {
                        "move_back".to_string()
                    };
            });
            reject_material!(
                format!("operations[{index}].rollbackToolName"),
                |candidate| {
                    candidate.operations[index].rollback_tool_name =
                        if candidate.operations[index].rollback_tool_name.as_deref()
                            == Some("ue.asset.move")
                        {
                            Some("ue.asset.rename".to_string())
                        } else {
                            Some("ue.asset.move".to_string())
                        };
                }
            );
            reject_material!(format!("operations[{index}].saveAll"), |candidate| {
                candidate.operations[index].save_all = !candidate.operations[index].save_all;
            });
            reject_material!(format!("operations[{index}].bulk"), |candidate| {
                candidate.operations[index].bulk = !candidate.operations[index].bulk;
            });
        }

        reject_material!("companion.presence", |candidate| {
            candidate.companion = None;
        });
        reject_material!("companion.connectionGeneration", |candidate| {
            candidate.companion.as_mut().unwrap().connection_generation += 1;
        });
        reject_material!("companion.sessionGeneration", |candidate| {
            candidate.companion.as_mut().unwrap().session_generation += 1;
        });
        reject_material!("companion.fingerprint", |candidate| {
            let companion = candidate.companion.as_mut().unwrap();
            companion.fingerprint = drift_lower_hex(&companion.fingerprint);
        });
        reject_material!("companion.sourceIdentity", |candidate| {
            let companion = candidate.companion.as_mut().unwrap();
            companion.source_identity = drift_lower_hex(&companion.source_identity);
        });
        reject_material!("companion.manifestIdentity", |candidate| {
            let companion = candidate.companion.as_mut().unwrap();
            companion.manifest_identity = drift_lower_hex(&companion.manifest_identity);
        });
        reject_material!("companion.pluginIdentity", |candidate| {
            let companion = candidate.companion.as_mut().unwrap();
            companion.plugin_identity = drift_lower_hex(&companion.plugin_identity);
        });
        reject_material!("companion.packageIdentity", |candidate| {
            let companion = candidate.companion.as_mut().unwrap();
            companion.package_identity = drift_lower_hex(&companion.package_identity);
        });
    }

    #[test]
    fn canonical_native_guard_fact_tuple_rejects_every_independent_drift() {
        let _test_guard = clear_registry();
        let expected = native_binding_test_vector().native_guard_facts;

        macro_rules! reject_guard_facts {
            ($label:expr, |$candidate:ident| $body:block) => {{
                let mut $candidate = expected.clone();
                $body
                assert_ne!(
                    $candidate, expected,
                    "{} drift must not match the canonical native guard tuple",
                    $label
                );
            }};
        }

        reject_guard_facts!("acceptedPlanBinding", |candidate| {
            candidate.accepted_plan_binding = drift_lower_hex(&candidate.accepted_plan_binding);
        });
        reject_guard_facts!("nativeRegistrationId", |candidate| {
            candidate.native_registration_id.push_str("-drift");
        });
        reject_guard_facts!("nativePhase", |candidate| {
            candidate.native_phase = "rollback".to_string();
        });
        reject_guard_facts!("nativeOperationIndex", |candidate| {
            candidate.native_operation_index += 1;
        });
        reject_guard_facts!("nativeOperationCount", |candidate| {
            candidate.native_operation_count += 1;
        });
        reject_guard_facts!("nativeCreatedAt", |candidate| {
            candidate.native_created_at += 1;
        });
        reject_guard_facts!("connectionGeneration", |candidate| {
            candidate.connection_generation += 1;
        });
        reject_guard_facts!("sessionGeneration", |candidate| {
            candidate.session_generation += 1;
        });
        reject_guard_facts!("nativeSourceIdentity", |candidate| {
            candidate.native_source_identity = drift_lower_hex(&candidate.native_source_identity);
        });
        reject_guard_facts!("nativeManifestIdentity", |candidate| {
            candidate.native_manifest_identity =
                drift_lower_hex(&candidate.native_manifest_identity);
        });
        reject_guard_facts!("nativePluginIdentity", |candidate| {
            candidate.native_plugin_identity = drift_lower_hex(&candidate.native_plugin_identity);
        });
        reject_guard_facts!("nativePackageIdentity", |candidate| {
            candidate.native_package_identity = drift_lower_hex(&candidate.native_package_identity);
        });
    }

    #[test]
    fn native_guard_rejects_wrong_binding_context_replay_and_stale_authority() {
        let _test_guard = clear_registry();
        let now = 195;
        let input = registration("native-binding-negative", now);
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let token = registered.approval_token.as_deref().unwrap();
        let registration_id = "asset-approval:deterministic-native-negative";
        remap_registration_for_binding_contract(&registered.registration_id, registration_id);
        let binding = bind_registration_to_companion(registration_id, 31, 47);
        let base = step(&input, registration_id, "execute", 0, Some(token));

        let mut wrong_phase = base.clone();
        wrong_phase.phase = "invalid".to_string();
        assert_eq!(
            authorize_asset_mutation_at(wrong_phase, now + 1).reason,
            "phase_mismatch"
        );

        let mut wrong_index = base.clone();
        wrong_index.operation_index = 1;
        wrong_index.operation = input.operations[1].clone();
        assert_eq!(
            authorize_asset_mutation_at(wrong_index, now + 1).reason,
            "operation_out_of_order"
        );

        let mut wrong_registration = base.clone();
        wrong_registration.registration_id = "asset-approval:unknown".to_string();
        assert_eq!(
            authorize_asset_mutation_at(wrong_registration, now + 1).reason,
            "approval_registration_unknown"
        );

        {
            let mut registry = approval_registry().lock().unwrap();
            registry
                .records
                .get_mut(registration_id)
                .unwrap()
                .editor_session_id = "editor-observation:unknown".to_string();
        }
        assert_eq!(
            authorize_asset_mutation_at(base.clone(), now + 1).reason,
            "observation_session_unknown"
        );
        approval_registry()
            .lock()
            .unwrap()
            .records
            .get_mut(registration_id)
            .unwrap()
            .editor_session_id = binding.editor_session_id.clone();

        {
            let mut registry = approval_registry().lock().unwrap();
            registry
                .companion_authority
                .binding
                .as_mut()
                .unwrap()
                .manifest_sha256 = hex('9', 64);
        }
        assert_eq!(
            authorize_asset_mutation_at(base.clone(), now + 1).reason,
            "companion_attestation_retracted"
        );
        approval_registry()
            .lock()
            .unwrap()
            .companion_authority
            .binding = Some(binding.clone());

        {
            let mut registry = approval_registry().lock().unwrap();
            registry
                .companion_authority
                .binding
                .as_mut()
                .unwrap()
                .generation += 1;
        }
        assert_eq!(
            authorize_asset_mutation_at(base.clone(), now + 1).reason,
            "companion_attestation_retracted"
        );
        approval_registry()
            .lock()
            .unwrap()
            .companion_authority
            .binding = Some(binding.clone());

        {
            let mut registry = approval_registry().lock().unwrap();
            registry
                .companion_authority
                .binding
                .as_mut()
                .unwrap()
                .attestation_generation += 1;
        }
        assert_eq!(
            authorize_asset_mutation_at(base.clone(), now + 1).reason,
            "companion_attestation_retracted"
        );
        approval_registry()
            .lock()
            .unwrap()
            .companion_authority
            .binding = Some(binding.clone());

        let accepted = authorize_asset_mutation_at(base.clone(), now + 1);
        assert_eq!(accepted.status, "accepted_by_native_guard");
        assert_eq!(
            authorize_asset_mutation_at(base, now + 1).reason,
            "operation_in_flight"
        );
        assert_eq!(
            record_asset_mutation_outcome(outcome(registration_id, "execute", "op-0", true,))
                .status,
            "recorded"
        );
        assert_eq!(
            authorize_asset_mutation_at(
                step(&input, registration_id, "execute", 0, None),
                now + 1,
            )
            .reason,
            "execute_replay"
        );
        approval_registry()
            .lock()
            .unwrap()
            .records
            .get_mut(registration_id)
            .unwrap()
            .companion_retracted = true;
        assert_eq!(
            authorize_asset_mutation_at(
                step(&input, registration_id, "execute", 1, None),
                now + 1,
            )
            .reason,
            "companion_attestation_retracted"
        );
    }

    #[test]
    fn asset_approval_registry_allows_five_steps_once_and_reverse_rollback_without_save() {
        let _test_guard = clear_registry();
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
            assert!(authorized
                .accepted_plan_binding
                .as_deref()
                .is_some_and(|value| value.len() == 64
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())));
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
            "rollback_replay"
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
    fn second_rollback_requires_execute_and_recorded_outcomes_and_blocked_guard_cannot_succeed() {
        let _test_guard = clear_registry();
        let now = 250;
        let input = registration("second-rollback-chain", now);
        let registered = register_asset_mutation_approval_at(input.clone(), now);
        let token = registered.approval_token.clone().unwrap();
        let execute = authorize_asset_mutation_at(
            step(
                &input,
                &registered.registration_id,
                "execute",
                0,
                Some(&token),
            ),
            now + 1,
        );
        assert_eq!(execute.status, "accepted_by_native_guard");
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
        let rollback = authorize_asset_mutation_at(
            step(&input, &registered.registration_id, "rollback", 0, None),
            now + 2,
        );
        assert_eq!(rollback.status, "accepted_by_native_guard");
        assert_eq!(
            record_asset_mutation_outcome(outcome(
                &registered.registration_id,
                "rollback",
                "op-0",
                true,
            ))
            .status,
            "recorded"
        );
        let replay = authorize_asset_mutation_at(
            step(&input, &registered.registration_id, "rollback", 0, None),
            now + 3,
        );
        assert_eq!(
            (replay.status.as_str(), replay.reason.as_str()),
            ("blocked", "rollback_replay")
        );

        let blocked_input = registration("blocked-outcome", now);
        let blocked_registration = register_asset_mutation_approval_at(blocked_input.clone(), now);
        let blocked = authorize_asset_mutation_at(
            step(
                &blocked_input,
                &blocked_registration.registration_id,
                "rollback",
                0,
                None,
            ),
            now + 1,
        );
        assert_eq!(blocked.reason, "execute_not_started");
        let forged = record_asset_mutation_outcome(outcome(
            &blocked_registration.registration_id,
            "rollback",
            "op-0",
            true,
        ));
        assert_eq!(
            (forged.status.as_str(), forged.reason.as_str()),
            ("blocked", "operation_not_in_flight")
        );
    }

    #[test]
    fn asset_approval_registry_halts_partial_execution_and_rolls_back_only_successes() {
        let _test_guard = clear_registry();
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
        let first_execute = authorize_asset_mutation_at(
            step(
                &input,
                &registered.registration_id,
                "execute",
                0,
                Some(&issued_token),
            ),
            now + 1,
        );
        assert_eq!(first_execute.status, "accepted_by_native_guard");
        record_asset_mutation_outcome(outcome(
            &registered.registration_id,
            "execute",
            "op-0",
            true,
        ));
        let failed_execute = authorize_asset_mutation_at(
            step(&input, &registered.registration_id, "execute", 1, None),
            now + 1,
        );
        assert_eq!(failed_execute.status, "accepted_by_native_guard");
        assert_eq!(
            failed_execute.accepted_plan_binding,
            first_execute.accepted_plan_binding
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
        let recovery = authorize_asset_mutation_at(
            step(&input, &registered.registration_id, "rollback", 0, None),
            now + 1,
        );
        assert_eq!(recovery.status, "accepted_by_native_guard");
        assert_eq!(
            recovery.accepted_plan_binding,
            first_execute.accepted_plan_binding
        );
    }

    #[test]
    fn asset_approval_registry_rolls_back_the_failed_step_when_a_side_effect_was_observed() {
        let _test_guard = clear_registry();
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
            effect_state: "known_partial".to_string(),
            rollback_available: false,
            evidence_id: Some("evidence:execute:op-0".to_string()),
            reason_code: Some("mutation_failed".to_string()),
        });
        assert_eq!(invalid_partial.status, "blocked");
        assert_eq!(invalid_partial.reason, "effect_state_contract_invalid");
        let recorded = record_asset_mutation_outcome(RecordAssetMutationOutcomeInput {
            registration_id: registered.registration_id.clone(),
            phase: "execute".to_string(),
            operation_id: "op-0".to_string(),
            success: false,
            side_effect_observed: true,
            effect_state: "known_partial".to_string(),
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
        let _test_guard = clear_registry();
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
        let _test_guard = clear_registry();
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
        let _test_guard = clear_registry();
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

        for (phase, expected_reason) in [
            ("rollback", "rollback_replay"),
            ("execute", "approval_registration_unknown"),
        ] {
            assert_eq!(
                authorize_asset_mutation_at(
                    step(&input, &registered.registration_id, phase, 0, None),
                    registered.expires_at + 2,
                )
                .reason,
                expected_reason
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
        let _test_guard = clear_registry();
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
        let _test_guard = clear_registry();
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

    #[test]
    fn every_asset_mutation_test_declares_the_shared_registry_guard() {
        let _test_guard = clear_registry();
        let test_attribute = ["#[", "test]"].concat();
        let source = include_str!("asset_mutation.rs");
        for test in source.split(&test_attribute).skip(1) {
            let signature_end = test
                .find('{')
                .expect("every test declaration must have a function body");
            let signature = &test[..signature_end];
            let name = signature
                .split_whitespace()
                .skip_while(|part| *part != "fn")
                .nth(1)
                .and_then(|part| part.split('(').next())
                .unwrap_or("unknown_test");
            let first_statement = test[signature_end + 1..]
                .split(';')
                .next()
                .unwrap_or_default()
                .trim();
            assert_eq!(
                first_statement, "let _test_guard = clear_registry()",
                "{name} must acquire the repository shared-registry test guard before setup"
            );
        }
    }
}
