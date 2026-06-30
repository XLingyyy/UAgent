use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const DEFAULT_APPROVAL_TTL_MILLIS: u64 = 10 * 60 * 1000;

fn backups() -> &'static Mutex<HashMap<String, TextMutationBackup>> {
    static BACKUPS: std::sync::OnceLock<Mutex<HashMap<String, TextMutationBackup>>> =
        std::sync::OnceLock::new();
    BACKUPS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn change_set_registry() -> &'static Mutex<HashMap<String, NativeChangeSetRecord>> {
    static REGISTRY: std::sync::OnceLock<Mutex<HashMap<String, NativeChangeSetRecord>>> =
        std::sync::OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn approval_registry() -> &'static Mutex<HashMap<String, NativeApprovalRecord>> {
    static APPROVALS: std::sync::OnceLock<Mutex<HashMap<String, NativeApprovalRecord>>> =
        std::sync::OnceLock::new();
    APPROVALS.get_or_init(|| Mutex::new(HashMap::new()))
}

#[derive(Debug, Clone)]
struct TextMutationBackup {
    change_set_id: String,
    canonical_root: String,
    entries: Vec<TextMutationBackupEntry>,
}

#[derive(Debug, Clone)]
struct TextMutationBackupEntry {
    operation_id: String,
    root_relative_path: String,
    before_content: String,
}

#[derive(Debug, Clone)]
struct NativeChangeSetRecord {
    change_set_id: String,
    canonical_root: String,
    operation_ids: Vec<String>,
    before_hashes: HashMap<String, String>,
    after_hashes: HashMap<String, String>,
    expires_at: u64,
    state: String,
    backup_id: Option<String>,
}

#[derive(Debug, Clone)]
struct NativeApprovalRecord {
    token: String,
    change_set_id: String,
    canonical_root: String,
    operation_ids: Vec<String>,
    before_hashes: HashMap<String, String>,
    after_hashes: HashMap<String, String>,
    expires_at: u64,
    used: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationCapabilityStatus {
    pub enabled: bool,
    pub mode: String,
    pub reason: String,
    pub approval_required: bool,
    pub allowed_extensions: Vec<String>,
    pub blocked_directories: Vec<String>,
}

#[tauri::command]
pub fn mutation_capability_status() -> MutationCapabilityStatus {
    MutationCapabilityStatus {
        enabled: true,
        mode: "native".to_string(),
        reason: "controlled_text_mutation_native_bridge_available".to_string(),
        approval_required: true,
        allowed_extensions: vec![
            ".ini".to_string(),
            ".Build.cs".to_string(),
            ".Target.cs".to_string(),
            ".cs".to_string(),
            ".cpp".to_string(),
            ".h".to_string(),
            ".hpp".to_string(),
            ".uproject".to_string(),
            ".uplugin".to_string(),
        ],
        blocked_directories: blocked_dirs(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextMutationOperationInput {
    pub operation_id: String,
    pub root_relative_path: String,
    pub before_hash: String,
    pub after_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewWorkspaceChangeInput {
    pub change_set_id: String,
    pub root_ref: String,
    pub operations: Vec<TextMutationOperationInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewedTextMutationOperation {
    pub operation_id: String,
    pub root_relative_path: String,
    pub display_path: String,
    pub before_hash: String,
    pub after_hash: String,
    pub unified_diff: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewWorkspaceChangeResult {
    pub change_set_id: String,
    pub status: String,
    pub reason: String,
    pub operations: Vec<PreviewedTextMutationOperation>,
    pub diff_summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyWorkspaceChangeInput {
    pub change_set_id: String,
    pub approval: BoundTextMutationApproval,
    pub root_ref: String,
    pub operations: Vec<ApplyTextMutationOperationInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveWorkspaceChangeInput {
    pub change_set_id: String,
    pub root_ref: String,
    pub actor: String,
    pub reason: String,
    pub expires_in_millis: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BoundTextMutationApproval {
    pub token: String,
    pub change_set_id: String,
    pub operation_ids: Vec<String>,
    pub before_hashes: HashMap<String, String>,
    pub after_hashes: HashMap<String, String>,
    pub actor: String,
    pub reason: String,
    pub approved_at: u64,
    pub expires_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyTextMutationOperationInput {
    pub operation_id: String,
    pub root_relative_path: String,
    pub before_hash: String,
    pub after_hash: String,
    pub after_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyWorkspaceChangeResult {
    pub change_set_id: String,
    pub status: String,
    pub reason: String,
    pub backup_id: Option<String>,
    pub after_hashes: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveWorkspaceChangeResult {
    pub change_set_id: String,
    pub status: String,
    pub reason: String,
    pub approval: Option<BoundTextMutationApproval>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackWorkspaceChangeInput {
    pub change_set_id: String,
    pub root_ref: String,
    pub backup_id: String,
    pub expected_current_hashes: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RollbackWorkspaceChangeResult {
    pub change_set_id: String,
    pub status: String,
    pub reason: String,
    pub restored_hashes: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSetStatusInput {
    pub change_set_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSetStatusResult {
    pub change_set_id: String,
    pub status: String,
    pub reason: String,
}

#[tauri::command]
pub fn preview_workspace_change(
    input: PreviewWorkspaceChangeInput,
) -> Result<PreviewWorkspaceChangeResult, String> {
    let root = match resolve_trusted_root(&input.root_ref) {
        Ok(root) => root,
        Err(reason) => return Ok(blocked_preview(&input.change_set_id, &reason)),
    };
    let canonical_root = canonical_root_id(&root);
    let mut operations = Vec::new();
    for operation in input.operations {
        let check = classify_target(&root, &operation.root_relative_path);
        if let Err(reason) = check {
            return Ok(blocked_preview(&input.change_set_id, &reason));
        }
        let path = check.unwrap();
        let before = fs::read_to_string(&path).map_err(|_| "read_error".to_string())?;
        let before_hash = sha256_text(&before);
        if before_hash != operation.before_hash {
            return Ok(blocked_preview(&input.change_set_id, "stale_hash"));
        }
        let after_hash = sha256_text(&operation.after_content);
        operations.push(PreviewedTextMutationOperation {
            operation_id: operation.operation_id,
            root_relative_path: operation.root_relative_path.clone(),
            display_path: display_path(&operation.root_relative_path),
            before_hash,
            after_hash,
            unified_diff: render_diff(
                &operation.root_relative_path,
                &before,
                &operation.after_content,
            ),
        });
    }
    record_preview(&input.change_set_id, &canonical_root, &operations);
    Ok(PreviewWorkspaceChangeResult {
        change_set_id: input.change_set_id,
        status: "previewed".to_string(),
        reason: "ok".to_string(),
        diff_summary: format!("{} text operation(s)", operations.len()),
        operations,
    })
}

#[tauri::command]
pub fn approve_workspace_change(
    input: ApproveWorkspaceChangeInput,
) -> Result<ApproveWorkspaceChangeResult, String> {
    let root = match resolve_trusted_root(&input.root_ref) {
        Ok(root) => root,
        Err(reason) => return Ok(blocked_approval(&input.change_set_id, &reason)),
    };
    if input.actor.trim().is_empty() || input.reason.trim().is_empty() {
        return Ok(blocked_approval(
            &input.change_set_id,
            "approval_actor_required",
        ));
    }
    let canonical_root = canonical_root_id(&root);
    let now = current_time_millis();
    let mut registry = change_set_registry().lock().unwrap();
    let Some(record) = registry.get_mut(&input.change_set_id) else {
        return Ok(blocked_approval(&input.change_set_id, "change_set_missing"));
    };
    if record.canonical_root != canonical_root {
        return Ok(blocked_approval(
            &input.change_set_id,
            "approval_root_mismatch",
        ));
    }
    if record.state != "previewed" {
        return Ok(blocked_approval(
            &input.change_set_id,
            "change_set_not_previewed",
        ));
    }
    if now >= record.expires_at {
        record.state = "expired".to_string();
        return Ok(blocked_approval(&input.change_set_id, "approval_expired"));
    }
    let ttl = input
        .expires_in_millis
        .unwrap_or(DEFAULT_APPROVAL_TTL_MILLIS);
    let expires_at = now.saturating_add(ttl).min(record.expires_at);
    let token = native_approval_token(
        &record.change_set_id,
        &record.canonical_root,
        &record.operation_ids,
        now,
    );
    let approval = BoundTextMutationApproval {
        token: token.clone(),
        change_set_id: record.change_set_id.clone(),
        operation_ids: record.operation_ids.clone(),
        before_hashes: record.before_hashes.clone(),
        after_hashes: record.after_hashes.clone(),
        actor: input.actor,
        reason: input.reason,
        approved_at: now,
        expires_at,
    };
    approval_registry().lock().unwrap().insert(
        token,
        NativeApprovalRecord {
            token: approval.token.clone(),
            change_set_id: approval.change_set_id.clone(),
            canonical_root: record.canonical_root.clone(),
            operation_ids: approval.operation_ids.clone(),
            before_hashes: approval.before_hashes.clone(),
            after_hashes: approval.after_hashes.clone(),
            expires_at: approval.expires_at,
            used: false,
        },
    );
    record.state = "approved".to_string();
    Ok(ApproveWorkspaceChangeResult {
        change_set_id: approval.change_set_id.clone(),
        status: "approved".to_string(),
        reason: "ok".to_string(),
        approval: Some(approval),
    })
}

#[tauri::command]
pub fn apply_workspace_change(
    input: ApplyWorkspaceChangeInput,
) -> Result<ApplyWorkspaceChangeResult, String> {
    let root = match resolve_trusted_root(&input.root_ref) {
        Ok(root) => root,
        Err(reason) => return Ok(blocked_apply(&input.change_set_id, &reason)),
    };
    let canonical_root = canonical_root_id(&root);
    if let Some(reason) = validate_native_approval(
        &input.change_set_id,
        &canonical_root,
        &input.operations,
        &input.approval,
    ) {
        return Ok(blocked_apply(&input.change_set_id, &reason));
    }
    let backup_id = format!("backup:{}", input.change_set_id);
    let mut backup = Vec::new();
    let mut after_hashes = HashMap::new();
    for operation in &input.operations {
        let path = classify_target(&root, &operation.root_relative_path)
            .map_err(|reason| format!("blocked: {}", reason))?;
        let current = fs::read_to_string(&path).map_err(|_| "read_error".to_string())?;
        if sha256_text(&current) != operation.before_hash {
            return Ok(blocked_apply(&input.change_set_id, "stale_hash"));
        }
        if sha256_text(&operation.after_content) != operation.after_hash {
            return Ok(blocked_apply(
                &input.change_set_id,
                "approval_hash_mismatch",
            ));
        }
        backup.push(TextMutationBackupEntry {
            operation_id: operation.operation_id.clone(),
            root_relative_path: operation.root_relative_path.clone(),
            before_content: current,
        });
    }
    for operation in &input.operations {
        let path = root.join(&operation.root_relative_path);
        atomic_write_text(&path, &operation.after_content)?;
        after_hashes.insert(
            operation.operation_id.clone(),
            sha256_text(&operation.after_content),
        );
    }
    backups().lock().unwrap().insert(
        backup_id.clone(),
        TextMutationBackup {
            change_set_id: input.change_set_id.clone(),
            canonical_root: canonical_root.clone(),
            entries: backup,
        },
    );
    if let Some(approval) = approval_registry()
        .lock()
        .unwrap()
        .get_mut(&input.approval.token)
    {
        approval.used = true;
    }
    if let Some(record) = change_set_registry()
        .lock()
        .unwrap()
        .get_mut(&input.change_set_id)
    {
        record.state = "applied".to_string();
        record.backup_id = Some(backup_id.clone());
    }
    Ok(ApplyWorkspaceChangeResult {
        change_set_id: input.change_set_id,
        status: "applied".to_string(),
        reason: "ok".to_string(),
        backup_id: Some(backup_id),
        after_hashes,
    })
}

#[tauri::command]
pub fn rollback_workspace_change(
    input: RollbackWorkspaceChangeInput,
) -> Result<RollbackWorkspaceChangeResult, String> {
    let root = match resolve_trusted_root(&input.root_ref) {
        Ok(root) => root,
        Err(reason) => {
            return Ok(RollbackWorkspaceChangeResult {
                change_set_id: input.change_set_id,
                status: "blocked".to_string(),
                reason,
                restored_hashes: HashMap::new(),
            })
        }
    };
    let canonical_root = canonical_root_id(&root);
    let backup = backups()
        .lock()
        .unwrap()
        .get(&input.backup_id)
        .cloned()
        .ok_or_else(|| "backup_missing".to_string())?;
    if backup.change_set_id != input.change_set_id || backup.canonical_root != canonical_root {
        return Ok(RollbackWorkspaceChangeResult {
            change_set_id: input.change_set_id,
            status: "blocked".to_string(),
            reason: "rollback_root_mismatch".to_string(),
            restored_hashes: HashMap::new(),
        });
    }
    let mut restored_hashes = HashMap::new();
    for entry in &backup.entries {
        let path = classify_target(&root, &entry.root_relative_path)
            .map_err(|reason| format!("blocked: {}", reason))?;
        let current = fs::read_to_string(&path).map_err(|_| "read_error".to_string())?;
        let current_hash = sha256_text(&current);
        let expected = input
            .expected_current_hashes
            .get(&entry.operation_id)
            .map(|hash| hash == &current_hash)
            .unwrap_or(false);
        if !expected {
            return Ok(RollbackWorkspaceChangeResult {
                change_set_id: input.change_set_id,
                status: "blocked".to_string(),
                reason: "stale_hash".to_string(),
                restored_hashes,
            });
        }
    }
    for entry in &backup.entries {
        let path = root.join(&entry.root_relative_path);
        atomic_write_text(&path, &entry.before_content)?;
        restored_hashes.insert(
            entry.operation_id.clone(),
            sha256_text(&entry.before_content),
        );
    }
    if let Some(record) = change_set_registry()
        .lock()
        .unwrap()
        .get_mut(&input.change_set_id)
    {
        if record.canonical_root == canonical_root {
            record.state = "rolled_back".to_string();
        }
    }
    Ok(RollbackWorkspaceChangeResult {
        change_set_id: input.change_set_id,
        status: "rolled_back".to_string(),
        reason: "ok".to_string(),
        restored_hashes,
    })
}

#[tauri::command]
pub fn get_change_set_status(input: ChangeSetStatusInput) -> Result<ChangeSetStatusResult, String> {
    if let Some(record) = change_set_registry()
        .lock()
        .unwrap()
        .get(&input.change_set_id)
    {
        return Ok(ChangeSetStatusResult {
            change_set_id: input.change_set_id,
            status: record.state.clone(),
            reason: "native_registry_recorded".to_string(),
        });
    }
    Ok(ChangeSetStatusResult {
        change_set_id: input.change_set_id,
        status: "recorded_only".to_string(),
        reason: "session_replay_never_reapplies_native_text_mutation".to_string(),
    })
}

pub fn sha256_text(text: &str) -> String {
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
    let mut data = text.as_bytes().to_vec();
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
        let mut a = h[0];
        let mut b = h[1];
        let mut c = h[2];
        let mut d = h[3];
        let mut e = h[4];
        let mut f = h[5];
        let mut g = h[6];
        let mut hh = h[7];
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

fn blocked_dirs() -> Vec<String> {
    vec![
        "Binaries".to_string(),
        "Intermediate".to_string(),
        "Saved".to_string(),
        "DerivedDataCache".to_string(),
        ".vs".to_string(),
        "dist".to_string(),
        "build".to_string(),
        "node_modules".to_string(),
    ]
}

fn blocked_preview(change_set_id: &str, reason: &str) -> PreviewWorkspaceChangeResult {
    PreviewWorkspaceChangeResult {
        change_set_id: change_set_id.to_string(),
        status: "blocked".to_string(),
        reason: reason.to_string(),
        operations: vec![],
        diff_summary: "blocked".to_string(),
    }
}

fn blocked_apply(change_set_id: &str, reason: &str) -> ApplyWorkspaceChangeResult {
    ApplyWorkspaceChangeResult {
        change_set_id: change_set_id.to_string(),
        status: "blocked".to_string(),
        reason: reason.to_string(),
        backup_id: None,
        after_hashes: HashMap::new(),
    }
}

fn blocked_approval(change_set_id: &str, reason: &str) -> ApproveWorkspaceChangeResult {
    ApproveWorkspaceChangeResult {
        change_set_id: change_set_id.to_string(),
        status: "blocked".to_string(),
        reason: reason.to_string(),
        approval: None,
    }
}

fn record_preview(
    change_set_id: &str,
    canonical_root: &str,
    operations: &[PreviewedTextMutationOperation],
) {
    change_set_registry().lock().unwrap().insert(
        change_set_id.to_string(),
        NativeChangeSetRecord {
            change_set_id: change_set_id.to_string(),
            canonical_root: canonical_root.to_string(),
            operation_ids: operations
                .iter()
                .map(|operation| operation.operation_id.clone())
                .collect(),
            before_hashes: operations
                .iter()
                .map(|operation| {
                    (
                        operation.operation_id.clone(),
                        operation.before_hash.clone(),
                    )
                })
                .collect(),
            after_hashes: operations
                .iter()
                .map(|operation| (operation.operation_id.clone(), operation.after_hash.clone()))
                .collect(),
            expires_at: current_time_millis() + DEFAULT_APPROVAL_TTL_MILLIS,
            state: "previewed".to_string(),
            backup_id: None,
        },
    );
}

fn validate_native_approval(
    change_set_id: &str,
    canonical_root: &str,
    operations: &[ApplyTextMutationOperationInput],
    approval: &BoundTextMutationApproval,
) -> Option<String> {
    if approval.token.starts_with("approval-token:") {
        return Some("approval_token_unknown".to_string());
    }
    let mut approvals = approval_registry().lock().unwrap();
    let Some(record) = approvals.get_mut(&approval.token) else {
        return Some("approval_token_unknown".to_string());
    };
    if record.used {
        return Some("approval_replay".to_string());
    }
    if record.token != approval.token
        || record.change_set_id != approval.change_set_id
        || record.operation_ids != approval.operation_ids
        || record.before_hashes != approval.before_hashes
        || record.after_hashes != approval.after_hashes
        || record.expires_at != approval.expires_at
    {
        return Some("approval_payload_mismatch".to_string());
    }
    if record.change_set_id != change_set_id || approval.change_set_id != change_set_id {
        return Some("approval_change_set_mismatch".to_string());
    }
    if approval.actor.trim().is_empty() || approval.reason.trim().is_empty() {
        return Some("approval_actor_required".to_string());
    }
    if current_time_millis() >= record.expires_at {
        return Some("approval_expired".to_string());
    }
    if record.canonical_root != canonical_root {
        return Some("approval_root_mismatch".to_string());
    }
    drop(approvals);
    let registry = change_set_registry().lock().unwrap();
    let Some(change_set) = registry.get(change_set_id) else {
        return Some("change_set_missing".to_string());
    };
    if change_set.state != "approved" {
        return Some("change_set_not_approved".to_string());
    }
    if change_set.canonical_root != canonical_root {
        return Some("approval_root_mismatch".to_string());
    }
    let mut expected_operation_ids: Vec<String> = operations
        .iter()
        .map(|operation| operation.operation_id.clone())
        .collect();
    let mut approved_operation_ids = change_set.operation_ids.clone();
    expected_operation_ids.sort();
    approved_operation_ids.sort();
    if expected_operation_ids != approved_operation_ids {
        return Some("approval_operation_mismatch".to_string());
    }
    for operation in operations {
        if change_set
            .before_hashes
            .get(&operation.operation_id)
            .map(|hash| hash != &operation.before_hash)
            .unwrap_or(true)
        {
            return Some("approval_hash_mismatch".to_string());
        }
        if change_set
            .after_hashes
            .get(&operation.operation_id)
            .map(|hash| hash != &operation.after_hash)
            .unwrap_or(true)
        {
            return Some("approval_hash_mismatch".to_string());
        }
    }
    None
}

fn native_approval_token(
    change_set_id: &str,
    canonical_root: &str,
    operation_ids: &[String],
    approved_at: u64,
) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    change_set_id.hash(&mut hasher);
    canonical_root.hash(&mut hasher);
    operation_ids.hash(&mut hasher);
    approved_at.hash(&mut hasher);
    current_time_nanos().hash(&mut hasher);
    format!("native-approval:{:x}", hasher.finish())
}

fn current_time_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn current_time_nanos() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn resolve_trusted_root(root_ref: &str) -> Result<PathBuf, String> {
    let normalized = crate::normalize_project_path(root_ref);
    if !crate::is_trusted_root(&normalized) {
        return Err("untrusted_root".to_string());
    }
    resolve_root(&normalized)
}

fn resolve_root(root_ref: &str) -> Result<PathBuf, String> {
    let normalized = crate::normalize_project_path(root_ref);
    if normalized.starts_with("//") || normalized.starts_with("\\\\") {
        return Err("network_root".to_string());
    }
    let root = PathBuf::from(normalized);
    if !root.is_absolute() {
        return Err("root_escape".to_string());
    }
    let canonical = root
        .canonicalize()
        .map_err(|_| "invalid_root".to_string())?;
    if !canonical.is_dir() {
        return Err("invalid_root".to_string());
    }
    Ok(canonical)
}

fn canonical_root_id(root: &Path) -> String {
    crate::normalize_project_path(&root.to_string_lossy())
}

fn classify_target(root: &Path, root_relative_path: &str) -> Result<PathBuf, String> {
    let normalized = root_relative_path.replace('\\', "/");
    if normalized.starts_with('/') || normalized.starts_with("..") || normalized.contains("../") {
        return Err("root_escape".to_string());
    }
    if blocked_dirs().iter().any(|dir| {
        normalized
            .split('/')
            .any(|part| part.eq_ignore_ascii_case(dir))
    }) {
        return Err("blocked_directory".to_string());
    }
    if [".uasset", ".umap", ".ubulk", ".uexp", ".dll", ".exe"]
        .iter()
        .any(|ext| normalized.to_lowercase().ends_with(ext))
    {
        return Err("blocked_binary".to_string());
    }
    if !is_allowed_text_file(&normalized) {
        return Err("extension_not_allowed".to_string());
    }
    let candidate = root.join(&normalized);
    let parent = candidate
        .parent()
        .ok_or_else(|| "root_escape".to_string())?;
    let canonical_parent = parent
        .canonicalize()
        .map_err(|_| "root_escape".to_string())?;
    if !canonical_parent.starts_with(root) {
        return Err("root_escape".to_string());
    }
    Ok(candidate)
}

fn is_allowed_text_file(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".ini")
        || lower.ends_with(".build.cs")
        || lower.ends_with(".target.cs")
        || lower.ends_with(".cs")
        || lower.ends_with(".cpp")
        || lower.ends_with(".h")
        || lower.ends_with(".hpp")
        || lower.ends_with(".uproject")
        || lower.ends_with(".uplugin")
}

fn display_path(root_relative_path: &str) -> String {
    format!("[project-root]/{}", root_relative_path.replace('\\', "/"))
}

fn render_diff(path: &str, before: &str, after: &str) -> String {
    let mut lines = vec![
        format!("--- a/{}", display_path(path)),
        format!("+++ b/{}", display_path(path)),
        "@@ -1 +1 @@".to_string(),
    ];
    let before_lines: Vec<&str> = before.lines().collect();
    let after_lines: Vec<&str> = after.lines().collect();
    for index in 0..before_lines.len().max(after_lines.len()) {
        let before_line = before_lines.get(index).copied().unwrap_or("");
        let after_line = after_lines.get(index).copied().unwrap_or("");
        if before_line == after_line {
            lines.push(format!(" {}", before_line));
        } else {
            if !before_line.is_empty() {
                lines.push(format!("-{}", redact_line(before_line)));
            }
            if !after_line.is_empty() {
                lines.push(format!("+{}", redact_line(after_line)));
            }
        }
    }
    lines.join("\n")
}

fn redact_line(line: &str) -> String {
    if line.to_lowercase().contains("token")
        || line.to_lowercase().contains("authorization")
        || line.to_lowercase().contains("secret")
        || line.to_lowercase().contains("api_key")
    {
        let key = line.split('=').next().unwrap_or("secret");
        return format!("{}=[REDACTED]", key.trim());
    }
    line.to_string()
}

fn atomic_write_text(path: &Path, content: &str) -> Result<(), String> {
    let temp_path = path.with_extension("uagent-mvp12.tmp");
    {
        let mut file = fs::File::create(&temp_path).map_err(|_| "write_error".to_string())?;
        file.write_all(content.as_bytes())
            .map_err(|_| "write_error".to_string())?;
        file.sync_all().map_err(|_| "write_error".to_string())?;
    }
    fs::rename(&temp_path, path).map_err(|_| "write_error".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_project_root(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "uagent-mvp12-{}-{}",
            name,
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(root.join("Config")).unwrap();
        fs::create_dir_all(root.join("Content")).unwrap();
        fs::write(root.join("Game.uproject"), "{}").unwrap();
        root
    }

    fn trusted_temp_project_root(name: &str) -> std::path::PathBuf {
        let root = temp_project_root(name);
        let normalized = crate::normalize_project_path(&root.to_string_lossy());
        crate::trusted_roots()
            .lock()
            .unwrap()
            .insert(crate::hash_path(&normalized));
        root
    }

    fn reset_native_text_mutation_state() {
        backups().lock().unwrap().clear();
        change_set_registry().lock().unwrap().clear();
        approval_registry().lock().unwrap().clear();
        crate::trusted_roots().lock().unwrap().clear();
    }

    fn approval_for(
        change_set_id: &str,
        operations: &[ApplyTextMutationOperationInput],
    ) -> BoundTextMutationApproval {
        BoundTextMutationApproval {
            token: format!("approval-token:{}", change_set_id),
            change_set_id: change_set_id.to_string(),
            operation_ids: operations
                .iter()
                .map(|operation| operation.operation_id.clone())
                .collect(),
            before_hashes: operations
                .iter()
                .map(|operation| {
                    (
                        operation.operation_id.clone(),
                        operation.before_hash.clone(),
                    )
                })
                .collect(),
            after_hashes: operations
                .iter()
                .map(|operation| (operation.operation_id.clone(), operation.after_hash.clone()))
                .collect(),
            actor: "implementer".to_string(),
            reason: "Fix linked diagnostic".to_string(),
            approved_at: current_time_millis(),
            expires_at: current_time_millis() + 60_000,
        }
    }

    fn native_approval_for(
        change_set_id: &str,
        root: &std::path::Path,
        expires_in_millis: Option<u64>,
    ) -> BoundTextMutationApproval {
        let approval = approve_workspace_change(ApproveWorkspaceChangeInput {
            change_set_id: change_set_id.to_string(),
            root_ref: root.to_string_lossy().to_string(),
            actor: "implementer".to_string(),
            reason: "Fix linked diagnostic".to_string(),
            expires_in_millis,
        })
        .unwrap();
        assert_eq!(approval.status, "approved");
        approval
            .approval
            .expect("approved change set should include a native approval")
    }

    fn apply_ops(
        preview: &PreviewWorkspaceChangeResult,
        after_contents: &[(&str, &str)],
    ) -> Vec<ApplyTextMutationOperationInput> {
        preview
            .operations
            .iter()
            .map(|operation| {
                let after_content = after_contents
                    .iter()
                    .find(|(operation_id, _)| *operation_id == operation.operation_id)
                    .map(|(_, content)| (*content).to_string())
                    .unwrap_or_default();
                ApplyTextMutationOperationInput {
                    operation_id: operation.operation_id.clone(),
                    root_relative_path: operation.root_relative_path.clone(),
                    before_hash: operation.before_hash.clone(),
                    after_hash: operation.after_hash.clone(),
                    after_content,
                }
            })
            .collect()
    }

    #[test]
    fn allowed_ini_apply_and_rollback_restore_before_hash() {
        reset_native_text_mutation_state();
        let root = trusted_temp_project_root("allowed");
        let target = root.join("Config").join("DefaultGame.ini");
        fs::write(&target, "Value=true\n").unwrap();

        let preview = preview_workspace_change(PreviewWorkspaceChangeInput {
            change_set_id: "changeset:allowed".to_string(),
            root_ref: root.to_string_lossy().to_string(),
            operations: vec![TextMutationOperationInput {
                operation_id: "op:1".to_string(),
                root_relative_path: "Config/DefaultGame.ini".to_string(),
                before_hash: sha256_text("Value=true\n"),
                after_content: "Value=false\n".to_string(),
            }],
        })
        .unwrap();
        let operations = apply_ops(&preview, &[("op:1", "Value=false\n")]);
        let approval = native_approval_for(&preview.change_set_id, &root, None);
        let applied = apply_workspace_change(ApplyWorkspaceChangeInput {
            change_set_id: preview.change_set_id.clone(),
            approval,
            root_ref: root.to_string_lossy().to_string(),
            operations,
        })
        .unwrap();
        let rolled_back = rollback_workspace_change(RollbackWorkspaceChangeInput {
            change_set_id: applied.change_set_id.clone(),
            root_ref: root.to_string_lossy().to_string(),
            backup_id: applied.backup_id.unwrap(),
            expected_current_hashes: applied.after_hashes,
        })
        .unwrap();

        assert_eq!(applied.status, "applied");
        assert_eq!(rolled_back.status, "rolled_back");
        assert_eq!(fs::read_to_string(&target).unwrap(), "Value=true\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sha256_text_matches_known_digest() {
        assert_eq!(
            sha256_text("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn untrusted_root_preview_apply_and_rollback_are_blocked_without_writing() {
        reset_native_text_mutation_state();
        let root = temp_project_root("untrusted-root");
        let target = root.join("Config").join("DefaultGame.ini");
        fs::write(&target, "Value=true\n").unwrap();

        let preview = preview_workspace_change(PreviewWorkspaceChangeInput {
            change_set_id: "changeset:untrusted-preview".to_string(),
            root_ref: root.to_string_lossy().to_string(),
            operations: vec![TextMutationOperationInput {
                operation_id: "op:preview".to_string(),
                root_relative_path: "Config/DefaultGame.ini".to_string(),
                before_hash: sha256_text("Value=true\n"),
                after_content: "Value=false\n".to_string(),
            }],
        })
        .unwrap();
        let apply = apply_workspace_change(ApplyWorkspaceChangeInput {
            change_set_id: "changeset:untrusted-apply".to_string(),
            approval: approval_for(
                "changeset:untrusted-apply",
                &[ApplyTextMutationOperationInput {
                    operation_id: "op:apply".to_string(),
                    root_relative_path: "Config/DefaultGame.ini".to_string(),
                    before_hash: sha256_text("Value=true\n"),
                    after_hash: sha256_text("Value=false\n"),
                    after_content: "Value=false\n".to_string(),
                }],
            ),
            root_ref: root.to_string_lossy().to_string(),
            operations: vec![ApplyTextMutationOperationInput {
                operation_id: "op:apply".to_string(),
                root_relative_path: "Config/DefaultGame.ini".to_string(),
                before_hash: sha256_text("Value=true\n"),
                after_hash: sha256_text("Value=false\n"),
                after_content: "Value=false\n".to_string(),
            }],
        })
        .unwrap();
        let rollback = rollback_workspace_change(RollbackWorkspaceChangeInput {
            change_set_id: "changeset:untrusted-rollback".to_string(),
            root_ref: root.to_string_lossy().to_string(),
            backup_id: "backup:missing".to_string(),
            expected_current_hashes: HashMap::new(),
        })
        .unwrap();

        assert_eq!(preview.status, "blocked");
        assert_eq!(preview.reason, "untrusted_root");
        assert_eq!(apply.status, "blocked");
        assert_eq!(apply.reason, "untrusted_root");
        assert_eq!(rollback.status, "blocked");
        assert_eq!(rollback.reason, "untrusted_root");
        assert_eq!(fs::read_to_string(&target).unwrap(), "Value=true\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn trusted_root_happy_path_preview_approve_apply_and_rollback() {
        reset_native_text_mutation_state();
        let root = trusted_temp_project_root("trusted-happy-path");
        let target = root.join("Config").join("DefaultGame.ini");
        fs::write(&target, "Value=true\n").unwrap();

        let preview = preview_workspace_change(PreviewWorkspaceChangeInput {
            change_set_id: "changeset:trusted-happy".to_string(),
            root_ref: root.to_string_lossy().to_string(),
            operations: vec![TextMutationOperationInput {
                operation_id: "op:trusted-happy".to_string(),
                root_relative_path: "Config/DefaultGame.ini".to_string(),
                before_hash: sha256_text("Value=true\n"),
                after_content: "Value=false\n".to_string(),
            }],
        })
        .unwrap();
        let operations = apply_ops(&preview, &[("op:trusted-happy", "Value=false\n")]);
        let approval = native_approval_for(&preview.change_set_id, &root, None);
        let applied = apply_workspace_change(ApplyWorkspaceChangeInput {
            change_set_id: preview.change_set_id.clone(),
            approval,
            root_ref: root.to_string_lossy().to_string(),
            operations,
        })
        .unwrap();
        let rolled_back = rollback_workspace_change(RollbackWorkspaceChangeInput {
            change_set_id: applied.change_set_id.clone(),
            root_ref: root.to_string_lossy().to_string(),
            backup_id: applied
                .backup_id
                .clone()
                .expect("apply should create backup"),
            expected_current_hashes: applied.after_hashes.clone(),
        })
        .unwrap();

        assert_eq!(preview.status, "previewed");
        assert_eq!(applied.status, "applied");
        assert_eq!(rolled_back.status, "rolled_back");
        assert_eq!(fs::read_to_string(&target).unwrap(), "Value=true\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn apply_rejects_forged_replayed_root_mismatched_and_after_hash_mismatched_tokens() {
        reset_native_text_mutation_state();
        let root = trusted_temp_project_root("approval-bindings-a");
        let other_root = trusted_temp_project_root("approval-bindings-b");
        let target = root.join("Config").join("DefaultGame.ini");
        let other_target = other_root.join("Config").join("DefaultGame.ini");
        fs::write(&target, "Value=true\n").unwrap();
        fs::write(&other_target, "Value=true\n").unwrap();

        let preview_change = |change_set_id: &str,
                              operation_id: &str,
                              root_ref: &std::path::Path|
         -> (
            PreviewWorkspaceChangeResult,
            Vec<ApplyTextMutationOperationInput>,
        ) {
            let preview = preview_workspace_change(PreviewWorkspaceChangeInput {
                change_set_id: change_set_id.to_string(),
                root_ref: root_ref.to_string_lossy().to_string(),
                operations: vec![TextMutationOperationInput {
                    operation_id: operation_id.to_string(),
                    root_relative_path: "Config/DefaultGame.ini".to_string(),
                    before_hash: sha256_text("Value=true\n"),
                    after_content: "Value=false\n".to_string(),
                }],
            })
            .unwrap();
            let operations = apply_ops(&preview, &[(operation_id, "Value=false\n")]);
            (preview, operations)
        };

        let (preview, operations) =
            preview_change("changeset:approval-forged", "op:approval-forged", &root);

        let forged = apply_workspace_change(ApplyWorkspaceChangeInput {
            change_set_id: preview.change_set_id.clone(),
            approval: approval_for(&preview.change_set_id, &operations),
            root_ref: root.to_string_lossy().to_string(),
            operations: operations.clone(),
        })
        .unwrap();
        assert_eq!(forged.status, "blocked");
        assert_eq!(forged.reason, "approval_token_unknown");
        assert_eq!(fs::read_to_string(&target).unwrap(), "Value=true\n");

        let (preview, operations) =
            preview_change("changeset:approval-root", "op:approval-root", &root);
        let root_mismatch_approval = native_approval_for(&preview.change_set_id, &root, None);
        let root_mismatch = apply_workspace_change(ApplyWorkspaceChangeInput {
            change_set_id: preview.change_set_id.clone(),
            approval: root_mismatch_approval,
            root_ref: other_root.to_string_lossy().to_string(),
            operations: operations.clone(),
        })
        .unwrap();
        assert_eq!(root_mismatch.status, "blocked");
        assert_eq!(root_mismatch.reason, "approval_root_mismatch");
        assert_eq!(fs::read_to_string(&other_target).unwrap(), "Value=true\n");

        let (preview, operations) =
            preview_change("changeset:approval-after", "op:approval-after", &root);
        let after_mismatch_approval = native_approval_for(&preview.change_set_id, &root, None);
        let mut tampered_operations = operations.clone();
        tampered_operations[0].after_content = "Value=malicious\n".to_string();
        tampered_operations[0].after_hash = sha256_text("Value=malicious\n");
        let after_mismatch = apply_workspace_change(ApplyWorkspaceChangeInput {
            change_set_id: preview.change_set_id.clone(),
            approval: after_mismatch_approval,
            root_ref: root.to_string_lossy().to_string(),
            operations: tampered_operations,
        })
        .unwrap();
        assert_eq!(after_mismatch.status, "blocked");
        assert_eq!(after_mismatch.reason, "approval_hash_mismatch");
        assert_eq!(fs::read_to_string(&target).unwrap(), "Value=true\n");

        let (preview, operations) =
            preview_change("changeset:approval-replay", "op:approval-replay", &root);
        let replay_approval = native_approval_for(&preview.change_set_id, &root, None);
        let first_apply = apply_workspace_change(ApplyWorkspaceChangeInput {
            change_set_id: preview.change_set_id.clone(),
            approval: replay_approval.clone(),
            root_ref: root.to_string_lossy().to_string(),
            operations: operations.clone(),
        })
        .unwrap();
        let replay = apply_workspace_change(ApplyWorkspaceChangeInput {
            change_set_id: preview.change_set_id.clone(),
            approval: replay_approval,
            root_ref: root.to_string_lossy().to_string(),
            operations,
        })
        .unwrap();

        assert_eq!(first_apply.status, "applied");
        assert_eq!(replay.status, "blocked");
        assert_eq!(replay.reason, "approval_replay");
        assert_eq!(fs::read_to_string(&target).unwrap(), "Value=false\n");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(other_root).unwrap();
    }

    #[test]
    fn preview_result_redacts_secret_and_omits_raw_content_fields() {
        reset_native_text_mutation_state();
        let root = trusted_temp_project_root("redacted-preview");
        let target = root.join("Config").join("DefaultGame.ini");
        fs::write(&target, "Authorization=Bearer sk-secret\nValue=true\n").unwrap();

        let preview = preview_workspace_change(PreviewWorkspaceChangeInput {
            change_set_id: "changeset:redacted".to_string(),
            root_ref: root.to_string_lossy().to_string(),
            operations: vec![TextMutationOperationInput {
                operation_id: "op:redacted".to_string(),
                root_relative_path: "Config/DefaultGame.ini".to_string(),
                before_hash: sha256_text("Authorization=Bearer sk-secret\nValue=true\n"),
                after_content: "Authorization=[REDACTED]\nValue=true\n".to_string(),
            }],
        })
        .unwrap();
        let serialized = serde_json::to_string(&preview).unwrap();

        assert_eq!(preview.status, "previewed");
        assert!(
            !serialized.contains("sk-secret"),
            "preview leaks raw secret: {serialized}"
        );
        assert!(
            !serialized.contains("beforeContent") && !serialized.contains("before_content"),
            "preview exposes raw before content field: {serialized}"
        );
        assert!(
            !serialized.contains("afterContent") && !serialized.contains("after_content"),
            "preview exposes raw after content field: {serialized}"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn apply_rejects_wrong_approval_token_without_writing() {
        reset_native_text_mutation_state();
        let root = trusted_temp_project_root("approval-wrong-token");
        let target = root.join("Config").join("DefaultGame.ini");
        fs::write(&target, "Value=true\n").unwrap();

        let preview = preview_workspace_change(PreviewWorkspaceChangeInput {
            change_set_id: "changeset:approval".to_string(),
            root_ref: root.to_string_lossy().to_string(),
            operations: vec![TextMutationOperationInput {
                operation_id: "op:approval".to_string(),
                root_relative_path: "Config/DefaultGame.ini".to_string(),
                before_hash: sha256_text("Value=true\n"),
                after_content: "Value=false\n".to_string(),
            }],
        })
        .unwrap();
        let operations = apply_ops(&preview, &[("op:approval", "Value=false\n")]);
        let mut approval = approval_for(&preview.change_set_id, &operations);
        approval.change_set_id = "changeset:wrong-change-set".to_string();
        approval.token = "approval-token:wrong-change-set".to_string();
        let applied = apply_workspace_change(ApplyWorkspaceChangeInput {
            change_set_id: preview.change_set_id.clone(),
            approval,
            root_ref: root.to_string_lossy().to_string(),
            operations,
        })
        .unwrap();

        assert_eq!(applied.status, "blocked");
        assert_eq!(applied.reason, "approval_token_unknown");
        assert_eq!(fs::read_to_string(&target).unwrap(), "Value=true\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn apply_rejects_genuinely_expired_approval_without_writing() {
        reset_native_text_mutation_state();
        let root = trusted_temp_project_root("approval-expired");
        let target = root.join("Config").join("DefaultGame.ini");
        fs::write(&target, "Value=true\n").unwrap();

        let preview = preview_workspace_change(PreviewWorkspaceChangeInput {
            change_set_id: "changeset:expired".to_string(),
            root_ref: root.to_string_lossy().to_string(),
            operations: vec![TextMutationOperationInput {
                operation_id: "op:expired".to_string(),
                root_relative_path: "Config/DefaultGame.ini".to_string(),
                before_hash: sha256_text("Value=true\n"),
                after_content: "Value=false\n".to_string(),
            }],
        })
        .unwrap();
        let operations = apply_ops(&preview, &[("op:expired", "Value=false\n")]);
        let approval = native_approval_for(&preview.change_set_id, &root, Some(0));
        let applied = apply_workspace_change(ApplyWorkspaceChangeInput {
            change_set_id: preview.change_set_id.clone(),
            approval,
            root_ref: root.to_string_lossy().to_string(),
            operations,
        })
        .unwrap();

        assert_eq!(applied.status, "blocked");
        assert_eq!(applied.reason, "approval_expired");
        assert_eq!(fs::read_to_string(&target).unwrap(), "Value=true\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn apply_rejects_malformed_approval_window_without_writing() {
        reset_native_text_mutation_state();
        let root = trusted_temp_project_root("approval-malformed");
        let target = root.join("Config").join("DefaultGame.ini");
        fs::write(&target, "Value=true\n").unwrap();

        let preview = preview_workspace_change(PreviewWorkspaceChangeInput {
            change_set_id: "changeset:malformed".to_string(),
            root_ref: root.to_string_lossy().to_string(),
            operations: vec![TextMutationOperationInput {
                operation_id: "op:malformed".to_string(),
                root_relative_path: "Config/DefaultGame.ini".to_string(),
                before_hash: sha256_text("Value=true\n"),
                after_content: "Value=false\n".to_string(),
            }],
        })
        .unwrap();
        let operations = apply_ops(&preview, &[("op:malformed", "Value=false\n")]);
        let mut approval = approval_for(&preview.change_set_id, &operations);
        approval.approved_at = 2;
        approval.expires_at = 2;
        let applied = apply_workspace_change(ApplyWorkspaceChangeInput {
            change_set_id: preview.change_set_id.clone(),
            approval,
            root_ref: root.to_string_lossy().to_string(),
            operations,
        })
        .unwrap();

        assert_eq!(applied.status, "blocked");
        assert_eq!(applied.reason, "approval_token_unknown");
        assert_eq!(fs::read_to_string(&target).unwrap(), "Value=true\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn apply_rejects_after_hash_replaced_after_approval_without_writing() {
        reset_native_text_mutation_state();
        let root = trusted_temp_project_root("approval-after-hash");
        let target = root.join("Config").join("DefaultGame.ini");
        fs::write(&target, "Value=true\n").unwrap();

        let preview = preview_workspace_change(PreviewWorkspaceChangeInput {
            change_set_id: "changeset:after-hash".to_string(),
            root_ref: root.to_string_lossy().to_string(),
            operations: vec![TextMutationOperationInput {
                operation_id: "op:after-hash".to_string(),
                root_relative_path: "Config/DefaultGame.ini".to_string(),
                before_hash: sha256_text("Value=true\n"),
                after_content: "Value=false\n".to_string(),
            }],
        })
        .unwrap();
        let mut operations = apply_ops(&preview, &[("op:after-hash", "Value=false\n")]);
        let approval = native_approval_for(&preview.change_set_id, &root, None);
        operations[0].after_content = "Value=malicious\n".to_string();
        operations[0].after_hash = sha256_text("Value=malicious\n");
        let applied = apply_workspace_change(ApplyWorkspaceChangeInput {
            change_set_id: preview.change_set_id.clone(),
            approval,
            root_ref: root.to_string_lossy().to_string(),
            operations,
        })
        .unwrap();

        assert_eq!(applied.status, "blocked");
        assert_eq!(applied.reason, "approval_hash_mismatch");
        assert_eq!(fs::read_to_string(&target).unwrap(), "Value=true\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rollback_blocks_hash_swapped_multi_file_without_writing() {
        reset_native_text_mutation_state();
        let root = trusted_temp_project_root("rollback-swapped");
        let game = root.join("Game.uproject");
        let config = root.join("Config").join("DefaultGame.ini");
        fs::write(&game, "{ \"Enabled\": true }\n").unwrap();
        fs::write(&config, "Value=true\n").unwrap();

        let preview = preview_workspace_change(PreviewWorkspaceChangeInput {
            change_set_id: "changeset:rollback-swapped".to_string(),
            root_ref: root.to_string_lossy().to_string(),
            operations: vec![
                TextMutationOperationInput {
                    operation_id: "op:game".to_string(),
                    root_relative_path: "Game.uproject".to_string(),
                    before_hash: sha256_text("{ \"Enabled\": true }\n"),
                    after_content: "{ \"Enabled\": false }\n".to_string(),
                },
                TextMutationOperationInput {
                    operation_id: "op:config".to_string(),
                    root_relative_path: "Config/DefaultGame.ini".to_string(),
                    before_hash: sha256_text("Value=true\n"),
                    after_content: "Value=false\n".to_string(),
                },
            ],
        })
        .unwrap();
        let operations = apply_ops(
            &preview,
            &[
                ("op:game", "{ \"Enabled\": false }\n"),
                ("op:config", "Value=false\n"),
            ],
        );
        let applied = apply_workspace_change(ApplyWorkspaceChangeInput {
            change_set_id: preview.change_set_id.clone(),
            approval: native_approval_for(&preview.change_set_id, &root, None),
            root_ref: root.to_string_lossy().to_string(),
            operations,
        })
        .unwrap();
        let game_after = applied.after_hashes.get("op:game").unwrap().clone();
        let config_after = applied.after_hashes.get("op:config").unwrap().clone();
        let rolled_back = rollback_workspace_change(RollbackWorkspaceChangeInput {
            change_set_id: applied.change_set_id,
            root_ref: root.to_string_lossy().to_string(),
            backup_id: applied.backup_id.unwrap(),
            expected_current_hashes: HashMap::from([
                ("op:game".to_string(), config_after),
                ("op:config".to_string(), game_after),
            ]),
        })
        .unwrap();

        assert_eq!(rolled_back.status, "blocked");
        assert_eq!(rolled_back.reason, "stale_hash");
        assert_eq!(
            fs::read_to_string(&game).unwrap(),
            "{ \"Enabled\": false }\n"
        );
        assert_eq!(fs::read_to_string(&config).unwrap(), "Value=false\n");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn blocks_binary_outside_root_and_stale_hash() {
        reset_native_text_mutation_state();
        let root = trusted_temp_project_root("blocked");
        fs::write(root.join("Content").join("Hero.uasset"), [0u8, 1, 2]).unwrap();
        fs::write(root.join("Config").join("DefaultGame.ini"), "Value=true\n").unwrap();

        let binary = preview_workspace_change(PreviewWorkspaceChangeInput {
            change_set_id: "changeset:binary".to_string(),
            root_ref: root.to_string_lossy().to_string(),
            operations: vec![TextMutationOperationInput {
                operation_id: "op:binary".to_string(),
                root_relative_path: "Content/Hero.uasset".to_string(),
                before_hash: sha256_text(""),
                after_content: "bad".to_string(),
            }],
        })
        .unwrap();
        let escape = preview_workspace_change(PreviewWorkspaceChangeInput {
            change_set_id: "changeset:escape".to_string(),
            root_ref: root.to_string_lossy().to_string(),
            operations: vec![TextMutationOperationInput {
                operation_id: "op:escape".to_string(),
                root_relative_path: "../Outside.ini".to_string(),
                before_hash: sha256_text(""),
                after_content: "bad".to_string(),
            }],
        })
        .unwrap();
        let stale = preview_workspace_change(PreviewWorkspaceChangeInput {
            change_set_id: "changeset:stale".to_string(),
            root_ref: root.to_string_lossy().to_string(),
            operations: vec![TextMutationOperationInput {
                operation_id: "op:stale".to_string(),
                root_relative_path: "Config/DefaultGame.ini".to_string(),
                before_hash: sha256_text("wrong"),
                after_content: "Value=false\n".to_string(),
            }],
        })
        .unwrap();

        assert_eq!(binary.status, "blocked");
        assert_eq!(binary.reason, "blocked_binary");
        assert_eq!(escape.status, "blocked");
        assert_eq!(escape.reason, "root_escape");
        assert_eq!(stale.status, "blocked");
        assert_eq!(stale.reason, "stale_hash");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replay_status_does_not_apply_or_rollback_again() {
        reset_native_text_mutation_state();
        let root = trusted_temp_project_root("replay");
        fs::write(root.join("Config").join("DefaultGame.ini"), "Value=true\n").unwrap();

        let status = get_change_set_status(ChangeSetStatusInput {
            change_set_id: "changeset:replay-only".to_string(),
        })
        .unwrap();

        assert_eq!(status.status, "recorded_only");
        assert_eq!(
            fs::read_to_string(root.join("Config").join("DefaultGame.ini")).unwrap(),
            "Value=true\n"
        );
        fs::remove_dir_all(root).unwrap();
    }
}
