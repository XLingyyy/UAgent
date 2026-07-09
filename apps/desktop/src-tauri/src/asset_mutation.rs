use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetMutationCommandResult {
    pub status: String,
    pub reason: String,
    pub sandbox_only: bool,
    pub would_change: bool,
    pub affected_assets: Vec<String>,
    pub evidence_id: Option<String>,
}

#[tauri::command]
pub fn dry_run_asset_mutation(input: AssetMutationCommandInput) -> AssetMutationCommandResult {
    classify_asset_mutation(input, false)
}

#[tauri::command]
pub fn execute_asset_mutation(input: AssetMutationCommandInput) -> AssetMutationCommandResult {
    classify_asset_mutation(input, true)
}

#[tauri::command]
pub fn rollback_asset_mutation(input: AssetMutationCommandInput) -> AssetMutationCommandResult {
    classify_asset_mutation(input, true)
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
    if input.tool_name.contains("bulk") {
        return blocked("bulk_operation_blocked", affected);
    }
    if input.dry_run_hash.as_deref().unwrap_or("").is_empty() {
        return blocked("dry_run_required", affected);
    }
    if execution_requested && input.approval_token.as_deref().unwrap_or("").is_empty() {
        return blocked("approval_required", affected);
    }
    if execution_requested && input.editor_session_id.as_deref().unwrap_or("").is_empty() {
        return blocked("editor_session_required", affected);
    }
    if execution_requested && input.pid_hash.as_deref().unwrap_or("").is_empty() {
        return blocked("pid_hash_required", affected);
    }
    if execution_requested
        && (input
            .observed_editor_session_id
            .as_deref()
            .unwrap_or("")
            .is_empty()
            || input.observed_pid_hash.as_deref().unwrap_or("").is_empty())
    {
        return blocked("observation_session_required", affected);
    }
    if execution_requested && input.observed_editor_session_id != input.editor_session_id {
        return blocked("observation_session_mismatch", affected);
    }
    if execution_requested && input.observed_pid_hash != input.pid_hash {
        return blocked("observation_pid_mismatch", affected);
    }

    AssetMutationCommandResult {
        status: if execution_requested {
            "accepted_by_native_guard".to_string()
        } else {
            "dry_run_ready".to_string()
        },
        reason: "sandbox_guard_passed".to_string(),
        sandbox_only: true,
        would_change: !execution_requested,
        affected_assets: affected,
        evidence_id: Some("asset-native-evidence:redacted".to_string()),
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn base_input() -> AssetMutationCommandInput {
        AssetMutationCommandInput {
            tool_name: "ue.asset.create_folder".to_string(),
            asset_path: Some("/Game/UAgentSandbox/run-1".to_string()),
            target_asset_path: None,
            dry_run_hash: Some("dry:hash".to_string()),
            approval_token: Some("token:redacted".to_string()),
            editor_session_id: Some("editor-session:1".to_string()),
            pid_hash: Some("pid:hash".to_string()),
            asset_mutation_gate_enabled: Some(true),
            observed_editor_session_id: Some("editor-session:1".to_string()),
            observed_pid_hash: Some("pid:hash".to_string()),
        }
    }

    #[test]
    fn asset_mutation_blocks_non_sandbox_paths() {
        let mut input = base_input();
        input.asset_path = Some("/Game/Hero".to_string());

        let result = classify_asset_mutation(input, false);

        assert_eq!(result.status, "blocked");
        assert_eq!(result.reason, "sandbox_path_required");
        assert_eq!(result.affected_assets, vec!["[non-sandbox-asset]"]);
    }

    #[test]
    fn asset_mutation_requires_dry_run_before_execution() {
        let mut input = base_input();
        input.dry_run_hash = None;

        let result = classify_asset_mutation(input, true);

        assert_eq!(result.status, "blocked");
        assert_eq!(result.reason, "dry_run_required");
    }

    #[test]
    fn asset_mutation_requires_bound_approval_session_and_pid() {
        let mut input = base_input();
        input.approval_token = None;
        assert_eq!(classify_asset_mutation(input, true).reason, "approval_required");

        let mut input = base_input();
        input.editor_session_id = None;
        assert_eq!(classify_asset_mutation(input, true).reason, "editor_session_required");

        let mut input = base_input();
        input.pid_hash = None;
        assert_eq!(classify_asset_mutation(input, true).reason, "pid_hash_required");
    }

    #[test]
    fn asset_mutation_execution_requires_feature_gate_and_live_observation_binding() {
        let mut input = base_input();
        input.asset_mutation_gate_enabled = Some(false);
        assert_eq!(
            classify_asset_mutation(input, true).reason,
            "asset_mutation_gate_disabled"
        );

        let mut input = base_input();
        input.observed_editor_session_id = None;
        assert_eq!(
            classify_asset_mutation(input, true).reason,
            "observation_session_required"
        );

        let mut input = base_input();
        input.observed_editor_session_id = Some("editor-session:other".to_string());
        assert_eq!(
            classify_asset_mutation(input, true).reason,
            "observation_session_mismatch"
        );

        let mut input = base_input();
        input.observed_pid_hash = Some("pid:other".to_string());
        assert_eq!(
            classify_asset_mutation(input, true).reason,
            "observation_pid_mismatch"
        );
    }

    #[test]
    fn asset_mutation_duplicate_allows_read_only_non_sandbox_source_with_sandbox_target() {
        let mut input = base_input();
        input.tool_name = "ue.asset.duplicate".to_string();
        input.asset_path = Some("/Game/Templates/Hero".to_string());
        input.target_asset_path = Some("/Game/UAgentSandbox/run-1/HeroCopy".to_string());

        let result = classify_asset_mutation(input, true);

        assert_eq!(result.status, "accepted_by_native_guard");
        assert_eq!(result.reason, "sandbox_guard_passed");
        assert_eq!(
            result.affected_assets,
            vec![
                "[non-sandbox-source]".to_string(),
                "/Game/UAgentSandbox/run-1/HeroCopy".to_string()
            ]
        );
    }

    #[test]
    fn asset_mutation_duplicate_blocks_non_sandbox_target() {
        let mut input = base_input();
        input.tool_name = "ue.asset.duplicate".to_string();
        input.asset_path = Some("/Game/Templates/Hero".to_string());
        input.target_asset_path = Some("/Game/Characters/HeroCopy".to_string());

        let result = classify_asset_mutation(input, true);

        assert_eq!(result.status, "blocked");
        assert_eq!(result.reason, "sandbox_path_required");
    }

    #[test]
    fn asset_mutation_accepts_exact_sandbox_operation_at_guard_only() {
        let result = classify_asset_mutation(base_input(), true);

        assert_eq!(result.status, "accepted_by_native_guard");
        assert_eq!(result.reason, "sandbox_guard_passed");
        assert!(result.sandbox_only);
        assert!(result.evidence_id.is_some());
    }
}
