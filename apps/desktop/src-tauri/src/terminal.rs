use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

fn terminal_feature_enabled() -> bool {
    cfg!(test) || std::env::var("UAGENT_ENABLE_REAL_TERMINAL").ok().as_deref() == Some("1")
}

fn terminal_real_enabled() -> bool {
    cfg!(test) || std::env::var("UAGENT_ENABLE_REAL_TERMINAL").ok().as_deref() == Some("1")
}

pub const MAX_TTL_SECS: u64 = 300;
const DEFAULT_TIMEOUT_MS: u64 = 60_000;
const OUTPUT_LIMIT_BYTES: u64 = 1_048_576;
const OUTPUT_LIMIT_LINES: u32 = 5_000;
const ALLOWLIST_SUMMARY: &str =
    "typecheck, lint, test, desktop web build, cargo test, git status/diff";

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
    pub canonical_cwd: Option<String>,
    pub redacted_cwd: String,
    pub expires_at: Option<u64>,
    pub timeout_ms: u64,
    pub output_limit_bytes: u64,
    pub output_limit_lines: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCapabilityStatus {
    pub enabled: bool,
    pub mode: String,
    pub reason: Option<String>,
    pub allowlist_summary: String,
    pub trusted_root_required: bool,
    pub approval_required: bool,
    pub timeout_ms: u64,
    pub output_limit_bytes: u64,
    pub output_limit_lines: u32,
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveTerminalProposalInput {
    pub proposal_id: String,
    pub actor: String,
    pub reason: Option<String>,
    pub ttl_secs: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveTerminalProposalResult {
    pub token: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRealExecuteInput {
    pub command: String,
    pub cwd: String,
    pub approved_token: String,
    pub timeout_secs: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalChunk {
    pub index: u32,
    pub stream: String,
    pub text: String,
    pub truncated: bool,
    pub timestamp: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRealExecuteResult {
    pub status: String,
    pub chunks: Vec<TerminalChunk>,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    pub output_summary: String,
    pub output_truncated: bool,
    pub total_bytes: u64,
    pub total_lines: u32,
    pub redaction_summary: RedactionSummary,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RedactionSummary {
    pub replaced_secrets: u32,
    pub replaced_paths: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalTokenValidateInput {
    pub token_id: String,
    pub proposal_id: String,
}

const MVP10_REAL_ALLOWLIST: &[&str] = &[
    "pnpm typecheck",
    "pnpm lint",
    "pnpm test",
    "pnpm --filter @uagent/shared test",
    "pnpm --filter @uagent/runtime test",
    "pnpm --filter @uagent/mcp-client test",
    "pnpm --filter @uagent/desktop test",
    "pnpm --filter @uagent/desktop web:build",
    "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml",
    "git status",
    "git diff",
    "git diff --check",
];

#[tauri::command]
pub fn terminal_capability_status() -> TerminalCapabilityStatus {
    let enabled = terminal_real_enabled();
    TerminalCapabilityStatus {
        enabled,
        mode: if enabled { "native" } else { "disabled" }.to_string(),
        reason: if enabled {
            None
        } else {
            Some("feature_disabled".to_string())
        },
        allowlist_summary: ALLOWLIST_SUMMARY.to_string(),
        trusted_root_required: true,
        approval_required: true,
        timeout_ms: DEFAULT_TIMEOUT_MS,
        output_limit_bytes: OUTPUT_LIMIT_BYTES,
        output_limit_lines: OUTPUT_LIMIT_LINES,
    }
}

pub(crate) fn classify_command(command: &str) -> (&'static str, bool) {
    let base = command.split_whitespace().next().unwrap_or("");
    let dangerous = ["rm", "sudo", "del", "format"];
    let allowed = [
        "pnpm", "npm", "node", "tsc", "eslint", "cargo", "git", "dir",
    ];

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

fn unique_id(prefix: &str, seed: &str) -> String {
    static NEXT_ID: AtomicU64 = AtomicU64::new(1);
    let seq = NEXT_ID.fetch_add(1, Ordering::SeqCst);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!(
        "{}-{}-{}",
        prefix,
        seq,
        hash_input(&format!("{}:{}:{}", seed, seq, now))
    )
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
    if !terminal_feature_enabled() {
        return Ok(TerminalProposeCommandResult {
            proposal_id: String::new(),
            command: input.command.clone(),
            risk: "blocked".to_string(),
            reason: "feature_disabled".to_string(),
            requires_approval: false,
            feature_flag: "terminal".to_string(),
            canonical_cwd: None,
            redacted_cwd: "[project-root]".to_string(),
            expires_at: None,
            timeout_ms: DEFAULT_TIMEOUT_MS,
            output_limit_bytes: OUTPUT_LIMIT_BYTES,
            output_limit_lines: OUTPUT_LIMIT_LINES,
        });
    }
    let (risk, requires_approval) = classify_command(&input.command);
    if !is_real_command_allowlisted(&input.command) {
        return Ok(TerminalProposeCommandResult {
            proposal_id: String::new(),
            command: input.command,
            risk: "blocked".to_string(),
            reason: "command_not_allowlisted".to_string(),
            requires_approval: false,
            feature_flag: "terminal".to_string(),
            canonical_cwd: None,
            redacted_cwd: "[project-root]".to_string(),
            expires_at: None,
            timeout_ms: DEFAULT_TIMEOUT_MS,
            output_limit_bytes: OUTPUT_LIMIT_BYTES,
            output_limit_lines: OUTPUT_LIMIT_LINES,
        });
    }
    let contained_cwd = canonical_contained_cwd(&input.cwd)?;
    let canonical_cwd = contained_cwd.to_string_lossy().to_string();
    let proposal_id = unique_id(
        "terminal-proposal",
        &format!("{}:{}", input.command, canonical_cwd),
    );
    let now = std::time::SystemTime::now();
    let expires_at = now + std::time::Duration::from_secs(MAX_TTL_SECS);
    let proposal = StoredTerminalProposal {
        proposal_id: proposal_id.clone(),
        command: input.command.clone(),
        cwd: canonical_cwd.clone(),
        project_id: input.project_id.clone(),
        status: TerminalProposalStatus::Proposed,
        created_at: now,
        expires_at,
    };
    terminal_proposals()
        .lock()
        .unwrap()
        .insert(proposal_id.clone(), proposal);
    let reason = format!("command classified as {}", risk);
    Ok(TerminalProposeCommandResult {
        proposal_id,
        command: input.command,
        risk: risk.to_string(),
        reason,
        requires_approval,
        feature_flag: "terminal".to_string(),
        canonical_cwd: Some(canonical_cwd),
        redacted_cwd: redact_cwd_for_ui(&contained_cwd),
        expires_at: Some(system_time_ms(expires_at)),
        timeout_ms: DEFAULT_TIMEOUT_MS,
        output_limit_bytes: OUTPUT_LIMIT_BYTES,
        output_limit_lines: OUTPUT_LIMIT_LINES,
    })
}

#[tauri::command]
pub fn execute_terminal_command(
    input: TerminalExecuteCommandInput,
) -> Result<TerminalExecuteCommandResult, String> {
    if input.approved_token.is_empty() {
        return Err("rejected: missing approval token".to_string());
    }
    if !terminal_feature_enabled() {
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

fn split_command(command: &str) -> (String, Vec<String>) {
    let parts: Vec<&str> = command.trim().split_whitespace().collect();
    if parts.is_empty() {
        return (String::new(), vec![]);
    }
    (
        parts[0].to_string(),
        parts[1..].iter().map(|s| s.to_string()).collect(),
    )
}

fn is_real_command_allowlisted(command: &str) -> bool {
    MVP10_REAL_ALLOWLIST.contains(&command.trim())
}

fn canonical_contained_cwd(cwd: &str) -> Result<std::path::PathBuf, String> {
    let project_root = std::env::current_dir()
        .map_err(|e| format!("cwd_error: {}", e))?
        .canonicalize()
        .map_err(|e| format!("cwd_error: {}", e))?;
    let requested = std::path::Path::new(cwd)
        .canonicalize()
        .map_err(|e| format!("cwd_error: {}", e))?;
    if requested == project_root || requested.starts_with(&project_root) {
        Ok(requested)
    } else {
        Err("rejected: cwd_escape".to_string())
    }
}

fn redact_cwd_for_ui(canonical_cwd: &std::path::Path) -> String {
    let project_root = match std::env::current_dir().and_then(|path| path.canonicalize()) {
        Ok(path) => path,
        Err(_) => return "[project-root]".to_string(),
    };
    if canonical_cwd == project_root {
        return "[project-root]".to_string();
    }
    if let Ok(relative) = canonical_cwd.strip_prefix(&project_root) {
        let rel = relative.to_string_lossy().replace('\\', "/");
        if rel.is_empty() {
            "[project-root]".to_string()
        } else {
            format!("[project-root]/{}", rel)
        }
    } else {
        "[project-root]".to_string()
    }
}

fn system_time_ms(time: std::time::SystemTime) -> u64 {
    time.duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn sanitized_process_env() -> Vec<(String, String)> {
    let sensitive_keys = [
        "SECRET",
        "KEY",
        "TOKEN",
        "AUTH",
        "PASSWORD",
        "CREDENTIAL",
        "API_KEY",
    ];
    std::env::vars()
        .filter(|(key, value)| {
            let upper = key.to_uppercase();
            let sensitive_key = sensitive_keys.iter().any(|pattern| upper.contains(pattern));
            let sensitive_value = value.starts_with("sk-")
                || value.starts_with("Bearer ")
                || value.starts_with("token=");
            !sensitive_key && !sensitive_value
        })
        .collect()
}

fn redact_terminal_output(output: &str) -> (String, u32, u32) {
    let mut result = output.to_string();
    let mut secrets = 0u32;
    let mut paths = 0u32;
    if result.contains("Bearer ") {
        secrets += 1;
        result = result.replace("Bearer ", "Bearer [REDACTED]");
    }
    if result.contains("sk-") {
        secrets += result.matches("sk-").count() as u32;
        result = result.replace("sk-", "[REDACTED]");
    }
    if result.contains("token=") {
        secrets += result.matches("token=").count() as u32;
        result = result.replace("token=", "token=[REDACTED]");
    }
    if result.contains("C:/Users/") || result.contains("/Users/") || result.contains("/home/") {
        paths += 1;
        result = result
            .replace("C:/Users/", "[user-home]/")
            .replace("/Users/", "[user-home]/")
            .replace("/home/", "[user-home]/");
    }
    if result.contains("C:\\Users\\") {
        paths += 1;
        result = result.replace("C:\\Users\\", "[user-home]\\");
    }
    (result, secrets, paths)
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum TerminalProposalStatus {
    Proposed,
    Approved,
    Rejected,
    Expired,
    Consumed,
}

#[allow(dead_code)]
struct StoredTerminalProposal {
    proposal_id: String,
    command: String,
    cwd: String,
    project_id: String,
    status: TerminalProposalStatus,
    created_at: std::time::SystemTime,
    expires_at: std::time::SystemTime,
}

fn terminal_proposals() -> &'static Mutex<HashMap<String, StoredTerminalProposal>> {
    static PROPOSALS: std::sync::OnceLock<Mutex<HashMap<String, StoredTerminalProposal>>> =
        std::sync::OnceLock::new();
    PROPOSALS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[allow(dead_code)]
struct StoredApprovalToken {
    proposal_id: String,
    command: String,
    cwd: String,
    task_id: Option<String>,
    actor: String,
    used: bool,
    expires_at: std::time::SystemTime,
}

fn approval_tokens() -> &'static Mutex<HashMap<String, StoredApprovalToken>> {
    static TOKENS: std::sync::OnceLock<Mutex<HashMap<String, StoredApprovalToken>>> =
        std::sync::OnceLock::new();
    TOKENS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn validate_approval_token_for_execution(
    token_id: &str,
    proposal_id: &str,
    command: &str,
    canonical_cwd: &str,
) -> Result<String, String> {
    let tokens = approval_tokens().lock().unwrap();
    let token = tokens.get(token_id).ok_or("token_not_found".to_string())?;
    if token.proposal_id != proposal_id {
        return Err("token_proposal_mismatch".to_string());
    }
    if token.command != command {
        return Err("token_command_mismatch".to_string());
    }
    if token.cwd != canonical_cwd {
        return Err("token_cwd_mismatch".to_string());
    }
    if token.used {
        return Err("token_already_used".to_string());
    }
    if token.expires_at < std::time::SystemTime::now() {
        return Err("token_expired".to_string());
    }
    drop(tokens);

    let mut proposals = terminal_proposals().lock().unwrap();
    let proposal = proposals
        .get_mut(proposal_id)
        .ok_or("proposal_not_found".to_string())?;
    if proposal.expires_at < std::time::SystemTime::now() {
        proposal.status = TerminalProposalStatus::Expired;
        return Err("proposal_expired".to_string());
    }
    if proposal.status != TerminalProposalStatus::Approved {
        return Err(format!("proposal_not_executable:{:?}", proposal.status));
    }
    if proposal.command != command {
        return Err("proposal_command_mismatch".to_string());
    }
    if proposal.cwd != canonical_cwd {
        return Err("proposal_cwd_mismatch".to_string());
    }
    Ok("valid".to_string())
}

fn use_approval_token(input: &ApprovalTokenValidateInput) -> Result<String, String> {
    let mut tokens = approval_tokens().lock().unwrap();
    let token = tokens
        .get_mut(&input.token_id)
        .ok_or("token_not_found".to_string())?;
    if token.proposal_id != input.proposal_id {
        return Err("token_proposal_mismatch".to_string());
    }
    if token.used {
        return Err("token_already_used".to_string());
    }
    if token.expires_at < std::time::SystemTime::now() {
        return Err("token_expired".to_string());
    }
    token.used = true;
    drop(tokens);

    let mut proposals = terminal_proposals().lock().unwrap();
    let proposal = proposals
        .get_mut(&input.proposal_id)
        .ok_or("proposal_not_found".to_string())?;
    proposal.status = TerminalProposalStatus::Consumed;
    Ok("used".to_string())
}

// Internal token issuance (not a Tauri command - must go through approve_terminal_proposal)
fn issue_approval_token_internal(
    proposal_id: &str,
    command: &str,
    cwd: &str,
    task_id: Option<String>,
    actor: &str,
    ttl_secs: u64,
) -> String {
    let token_id = unique_id("approval-token", proposal_id);
    let expires_at =
        std::time::SystemTime::now() + std::time::Duration::from_secs(ttl_secs.min(MAX_TTL_SECS));
    let mut tokens = approval_tokens().lock().unwrap();
    tokens.insert(
        token_id.clone(),
        StoredApprovalToken {
            proposal_id: proposal_id.to_string(),
            command: command.to_string(),
            cwd: cwd.to_string(),
            task_id,
            actor: actor.to_string(),
            used: false,
            expires_at,
        },
    );
    format!("{}:{}", token_id, proposal_id)
}

#[tauri::command]
pub fn approve_terminal_proposal(
    input: ApproveTerminalProposalInput,
) -> Result<ApproveTerminalProposalResult, String> {
    if !terminal_real_enabled() {
        return Err("blocked: feature_disabled".to_string());
    }
    if input.proposal_id.is_empty() {
        return Err("rejected: empty_proposal_id".to_string());
    }
    let mut proposals = terminal_proposals().lock().unwrap();
    let proposal = proposals
        .get_mut(&input.proposal_id)
        .ok_or("rejected: proposal_not_found".to_string())?;
    if proposal.expires_at < std::time::SystemTime::now() {
        proposal.status = TerminalProposalStatus::Expired;
        return Err("rejected: proposal_expired".to_string());
    }
    if proposal.status != TerminalProposalStatus::Proposed {
        return Err(format!(
            "rejected: proposal_not_pending:{:?}",
            proposal.status
        ));
    }
    if !is_real_command_allowlisted(&proposal.command) {
        proposal.status = TerminalProposalStatus::Rejected;
        return Err("rejected: command_not_allowlisted".to_string());
    }
    let _contained = canonical_contained_cwd(&proposal.cwd)?;
    let command = proposal.command.clone();
    let cwd = proposal.cwd.clone();
    let project_id = proposal.project_id.clone();
    proposal.status = TerminalProposalStatus::Approved;
    drop(proposals);

    let token = issue_approval_token_internal(
        &input.proposal_id,
        &command,
        &cwd,
        Some(project_id),
        &input.actor,
        input.ttl_secs,
    );
    Ok(ApproveTerminalProposalResult {
        token,
        status: "approved".to_string(),
    })
}

#[tauri::command]
pub fn execute_terminal_command_real(
    input: TerminalRealExecuteInput,
) -> Result<TerminalRealExecuteResult, String> {
    if !terminal_real_enabled() {
        return Err("blocked: feature_disabled".to_string());
    }
    let token_parts: Vec<&str> = input.approved_token.splitn(2, ':').collect();
    if token_parts.len() != 2 {
        return Err("rejected: invalid_token_format".to_string());
    }
    let token_id = token_parts[0];
    let proposal_id = token_parts[1];
    if !is_real_command_allowlisted(&input.command) {
        return Err("rejected: command_not_allowlisted".to_string());
    }
    let contained_cwd = canonical_contained_cwd(&input.cwd)?;
    let canonical_cwd = contained_cwd.to_string_lossy().to_string();
    validate_approval_token_for_execution(token_id, proposal_id, &input.command, &canonical_cwd)?;

    let (base, args) = split_command(&input.command);
    if base.is_empty() {
        return Err("rejected: empty_command".to_string());
    }

    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(input.timeout_secs.min(300));

    let mut child = std::process::Command::new(&base)
        .args(&args)
        .current_dir(contained_cwd)
        .env_clear()
        .envs(sanitized_process_env())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn_error: {}", e))?;
    use_approval_token(&ApprovalTokenValidateInput {
        token_id: token_id.to_string(),
        proposal_id: proposal_id.to_string(),
    })?;

    let stdout_handle = child.stdout.take();
    let stderr_handle = child.stderr.take();

    let start_wait = std::time::Instant::now();
    let mut status = String::from("completed");
    let mut exit_code: Option<i32> = None;

    loop {
        match child.try_wait() {
            Ok(Some(exit)) => {
                exit_code = exit.code();
                break;
            }
            Ok(None) => {
                if start_wait.elapsed() > timeout {
                    child.kill().ok();
                    status = String::from("timed_out");
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(_) => {
                status = String::from("failed");
                break;
            }
        }
    }

    let duration_ms = start.elapsed().as_millis() as u64;

    let stdout_text = match stdout_handle {
        Some(mut handle) => {
            let mut buf = String::new();
            use std::io::Read;
            handle.read_to_string(&mut buf).ok();
            buf
        }
        None => String::new(),
    };

    let stderr_text = match stderr_handle {
        Some(mut handle) => {
            let mut buf = String::new();
            use std::io::Read;
            handle.read_to_string(&mut buf).ok();
            buf
        }
        None => String::new(),
    };

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let stdout_redacted = redact_terminal_output(&stdout_text);
    let stderr_redacted = redact_terminal_output(&stderr_text);

    let total_secrets = stdout_redacted.1 + stderr_redacted.1;
    let total_paths = stdout_redacted.2 + stderr_redacted.2;

    let max_chunks = 100u32;
    let max_total_lines = 5000u32;
    let max_total_bytes: u64 = 1024 * 1024;

    let mut total_bytes: u64 = 0;
    let mut total_lines: u32 = 0;
    let mut output_truncated = false;
    let mut all_chunks = Vec::new();

    for (i, line) in stdout_redacted.0.lines().enumerate() {
        if i as u32 >= max_chunks
            || total_lines >= max_total_lines
            || total_bytes >= max_total_bytes
        {
            output_truncated = true;
            break;
        }
        let line_with_newline = format!("{}\n", line);
        total_bytes += line_with_newline.len() as u64;
        total_lines += 1;
        all_chunks.push(TerminalChunk {
            index: i as u32,
            stream: "stdout".to_string(),
            text: line_with_newline,
            truncated: false,
            timestamp,
        });
    }

    for (i, line) in stderr_redacted.0.lines().enumerate() {
        if (i + all_chunks.len()) as u32 >= max_chunks
            || total_lines >= max_total_lines
            || total_bytes >= max_total_bytes
        {
            output_truncated = true;
            break;
        }
        let line_with_newline = format!("{}\n", line);
        total_bytes += line_with_newline.len() as u64;
        total_lines += 1;
        all_chunks.push(TerminalChunk {
            index: all_chunks.len() as u32,
            stream: "stderr".to_string(),
            text: line_with_newline,
            truncated: false,
            timestamp,
        });
    }

    let output_summary = if all_chunks.is_empty() {
        if status == "completed" {
            "[exit 0] (no output)".to_string()
        } else {
            format!("[exit {:?}] (no output)", exit_code)
        }
    } else {
        let combined: String = all_chunks.iter().map(|c| c.text.clone()).collect();
        if combined.len() > 500 {
            format!("{}...", &combined[..500])
        } else {
            combined
        }
    };

    Ok(TerminalRealExecuteResult {
        status,
        chunks: all_chunks,
        exit_code,
        duration_ms,
        output_summary,
        output_truncated,
        total_bytes,
        total_lines,
        redaction_summary: RedactionSummary {
            replaced_secrets: total_secrets,
            replaced_paths: total_paths,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reset_terminal_state() {
        terminal_proposals().lock().unwrap().clear();
        approval_tokens().lock().unwrap().clear();
    }

    #[test]
    fn terminal_capability_status_reports_gate_and_limits() {
        let status = terminal_capability_status();

        assert!(status.enabled);
        assert_eq!(status.mode, "native");
        assert_eq!(status.reason, None);
        assert!(status.allowlist_summary.contains("git status/diff"));
        assert!(status.trusted_root_required);
        assert!(status.approval_required);
        assert_eq!(status.timeout_ms, 60_000);
        assert_eq!(status.output_limit_bytes, 1_048_576);
        assert_eq!(status.output_limit_lines, 5_000);
    }

    fn test_propose(command: &str, cwd: &str) -> String {
        let result = propose_terminal_command(TerminalProposeCommandInput {
            command: command.to_string(),
            cwd: cwd.to_string(),
            project_id: "test-project".to_string(),
        })
        .unwrap();
        assert!(!result.proposal_id.is_empty());
        result.proposal_id
    }

    fn test_approve(proposal_id: &str, command: &str, cwd: &str) -> String {
        reset_terminal_state();
        let proposal_id = if proposal_id.is_empty() {
            test_propose(command, cwd)
        } else {
            let created = test_propose(command, cwd);
            assert_ne!(created, proposal_id);
            created
        };
        let result = approve_terminal_proposal(ApproveTerminalProposalInput {
            proposal_id: proposal_id.to_string(),
            actor: "test".to_string(),
            reason: Some("test approval".to_string()),
            ttl_secs: 60,
        })
        .unwrap();
        result.token
    }

    #[test]
    fn approval_token_binds_command_and_cwd() {
        let token = test_approve("", "git status", ".");

        // Wrong command should fail
        let wrong_cmd = execute_terminal_command_real(TerminalRealExecuteInput {
            command: "git diff".to_string(),
            cwd: ".".to_string(),
            approved_token: token.clone(),
            timeout_secs: 30,
        });
        assert!(wrong_cmd.is_err());
        assert!(wrong_cmd.unwrap_err().contains("token_command_mismatch"));

        // Wrong cwd should fail
        let wrong_cwd = execute_terminal_command_real(TerminalRealExecuteInput {
            command: "git status".to_string(),
            cwd: "src".to_string(),
            approved_token: token.clone(),
            timeout_secs: 30,
        });
        assert!(wrong_cwd.is_err());
        let wrong_cwd_err = wrong_cwd.unwrap_err();
        assert!(
            wrong_cwd_err.contains("token_cwd_mismatch"),
            "expected token_cwd_mismatch, got {}",
            wrong_cwd_err
        );
    }

    #[test]
    fn approve_terminal_proposal_rejects_non_allowlisted_command() {
        reset_terminal_state();
        let result = propose_terminal_command(TerminalProposeCommandInput {
            command: "pnpm --version".to_string(),
            cwd: ".".to_string(),
            project_id: "test-project".to_string(),
        })
        .unwrap();

        assert_eq!(result.risk, "blocked");
        assert_eq!(result.reason, "command_not_allowlisted");
        assert!(result.proposal_id.is_empty());
    }

    #[test]
    fn approve_terminal_proposal_rejects_empty_proposal() {
        let result = approve_terminal_proposal(ApproveTerminalProposalInput {
            proposal_id: "".to_string(),
            actor: "test".to_string(),
            reason: None,
            ttl_secs: 60,
        });
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty_proposal_id"));
    }

    #[test]
    fn approve_terminal_proposal_rejects_missing_native_proposal() {
        let result = approve_terminal_proposal(ApproveTerminalProposalInput {
            proposal_id: "caller-supplied-only".to_string(),
            actor: "test".to_string(),
            reason: Some("test approval".to_string()),
            ttl_secs: 60,
        });

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("proposal_not_found"));
    }

    #[test]
    fn issued_token_allows_one_allowlisted_real_execution() {
        let token = test_approve("", "git status", ".");
        let result = execute_terminal_command_real(TerminalRealExecuteInput {
            command: "git status".to_string(),
            cwd: ".".to_string(),
            approved_token: token.clone(),
            timeout_secs: 30,
        })
        .unwrap();

        assert_eq!(result.status, "completed");

        let reused = execute_terminal_command_real(TerminalRealExecuteInput {
            command: "git status".to_string(),
            cwd: ".".to_string(),
            approved_token: token,
            timeout_secs: 30,
        });
        assert!(reused.is_err());
        assert!(reused.unwrap_err().contains("token_already_used"));
    }

    #[test]
    fn real_execution_blocks_non_allowlisted_command_before_spawn() {
        // Token is issued for a known allowlisted command
        let token = test_approve("", "git status", ".");
        // Execution then tries a non-allowlisted command, first caught by token command mismatch
        let wrong_cmd = execute_terminal_command_real(TerminalRealExecuteInput {
            command: "pnpm --version".to_string(),
            cwd: ".".to_string(),
            approved_token: token.clone(),
            timeout_secs: 30,
        });
        assert!(wrong_cmd.is_err());
        assert!(wrong_cmd.unwrap_err().contains("command_not_allowlisted"));

        // Also test that a token issued for a allowlisted cmd + wrong cwd is caught
        let wrong_cwd = execute_terminal_command_real(TerminalRealExecuteInput {
            command: "git status".to_string(),
            cwd: "src".to_string(),
            approved_token: token,
            timeout_secs: 30,
        });
        assert!(wrong_cwd.is_err());
        assert!(wrong_cwd.unwrap_err().contains("token_cwd_mismatch"));
    }

    #[test]
    fn execute_rejects_wrong_proposal_id_via_token() {
        // Token issued for proposal-1, but we pass a different proposal_id embedded in token
        let token = test_approve("", "git status", ".");
        // Manually craft token with wrong proposal id
        let bad_token = format!("{}:wrong-proposal", token.split(':').next().unwrap());
        let result = execute_terminal_command_real(TerminalRealExecuteInput {
            command: "git status".to_string(),
            cwd: ".".to_string(),
            approved_token: bad_token,
            timeout_secs: 30,
        });
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("token_proposal_mismatch"));
    }

    #[test]
    fn duplicate_approval_is_rejected_without_reissuing_token() {
        reset_terminal_state();
        let proposal_id = test_propose("git status", ".");
        let first = approve_terminal_proposal(ApproveTerminalProposalInput {
            proposal_id: proposal_id.clone(),
            actor: "test".to_string(),
            reason: Some("first approval".to_string()),
            ttl_secs: 60,
        })
        .unwrap();

        let second = approve_terminal_proposal(ApproveTerminalProposalInput {
            proposal_id,
            actor: "test".to_string(),
            reason: Some("replay approval".to_string()),
            ttl_secs: 60,
        });

        assert!(second.is_err());
        assert!(second.unwrap_err().contains("proposal_not_pending"));
        assert_eq!(approval_tokens().lock().unwrap().len(), 1);
        assert!(!first.token.is_empty());
    }

    #[test]
    fn expired_proposal_cannot_be_approved() {
        reset_terminal_state();
        let proposal_id = test_propose("git status", ".");
        {
            let mut proposals = terminal_proposals().lock().unwrap();
            let proposal = proposals.get_mut(&proposal_id).unwrap();
            proposal.expires_at = std::time::SystemTime::now() - std::time::Duration::from_secs(1);
        }

        let result = approve_terminal_proposal(ApproveTerminalProposalInput {
            proposal_id,
            actor: "test".to_string(),
            reason: Some("late approval".to_string()),
            ttl_secs: 60,
        });

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("proposal_expired"));
    }

    #[test]
    fn expired_token_cannot_execute() {
        reset_terminal_state();
        let proposal_id = test_propose("git status", ".");
        let token = approve_terminal_proposal(ApproveTerminalProposalInput {
            proposal_id,
            actor: "test".to_string(),
            reason: Some("short ttl".to_string()),
            ttl_secs: 0,
        })
        .unwrap()
        .token;

        let result = execute_terminal_command_real(TerminalRealExecuteInput {
            command: "git status".to_string(),
            cwd: ".".to_string(),
            approved_token: token,
            timeout_secs: 30,
        });

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("token_expired"));
    }
}
