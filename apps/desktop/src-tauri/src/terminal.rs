use serde::{Deserialize, Serialize};

pub const TERMINAL_FEATURE_ENABLED: bool = cfg!(test);

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProposeCommandInput {
    pub command: String,
    pub cwd: String,
    pub project_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalProposeCommandResult {
    pub proposal_id: String,
    pub command: String,
    pub risk: String,
    pub reason: String,
    pub requires_approval: bool,
    pub feature_flag: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExecuteCommandInput {
    pub proposal_id: String,
    pub approved_token: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExecuteCommandResult {
    pub status: String,
    pub output_summary: String,
    pub redacted: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCancelCommandInput {
    pub execution_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCancelCommandResult {
    pub status: String,
}

pub(crate) fn classify_command(command: &str) -> (&'static str, bool) {
    let base = command.split_whitespace().next().unwrap_or("");
    let dangerous = ["rm", "sudo", "del", "format"];
    let allowed = ["pnpm", "npm", "node", "tsc", "eslint", "cargo", "git", "dir"];

    if dangerous.contains(&base) {
        ("dangerous", true)
    } else if allowed.contains(&base) {
        ("allowlisted", false)
    } else {
        ("unknown", true)
    }
}

fn hash_input(val: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    val.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn redact_output(output: &str) -> String {
    let mut r = output.to_string();
    for pattern in &["Bearer ", "sk-", "Authorization"] {
        if r.contains(pattern) {
            r = r.replace(pattern, "[REDACTED]");
        }
    }
    r
}

#[tauri::command]
pub fn propose_terminal_command(
    input: TerminalProposeCommandInput,
) -> Result<TerminalProposeCommandResult, String> {
    if !TERMINAL_FEATURE_ENABLED {
        return Ok(TerminalProposeCommandResult {
            proposal_id: String::new(),
            command: input.command.clone(),
            risk: "blocked".to_string(),
            reason: "feature_disabled".to_string(),
            requires_approval: false,
            feature_flag: "terminal".to_string(),
        });
    }
    let (risk, requires_approval) = classify_command(&input.command);
    let proposal_id = format!("proposal:{}", hash_input(&input.command));
    let reason = format!("command classified as {}", risk);
    Ok(TerminalProposeCommandResult {
        proposal_id,
        command: input.command,
        risk: risk.to_string(),
        reason,
        requires_approval,
        feature_flag: "terminal".to_string(),
    })
}

#[tauri::command]
pub fn execute_terminal_command(
    input: TerminalExecuteCommandInput,
) -> Result<TerminalExecuteCommandResult, String> {
    if input.approved_token.is_empty() {
        return Err("rejected: missing approval token".to_string());
    }
    if !TERMINAL_FEATURE_ENABLED {
        return Err("blocked: feature_disabled".to_string());
    }
    Ok(TerminalExecuteCommandResult {
        status: "executed".to_string(),
        output_summary: redact_output("[fixture] Command executed successfully"),
        redacted: false,
    })
}

#[tauri::command]
pub fn cancel_terminal_execution(
    input: TerminalCancelCommandInput,
) -> Result<TerminalCancelCommandResult, String> {
    Ok(TerminalCancelCommandResult {
        status: format!("cancelled:{}", input.execution_id),
    })
}
