use crate::{is_trusted_root, normalize_project_path, redact_path_for_ui};
use serde::{Deserialize, Serialize};

pub const WATCHER_FEATURE_ENABLED: bool = cfg!(test);

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherStartInput {
    pub project_id: String,
    pub root_ref: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherStartResult {
    pub session_id: String,
    pub status: String,
    pub display_root: String,
    pub blocked: bool,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherStopInput {
    pub session_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherStopResult {
    pub session_id: String,
    pub status: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherReadDiffInput {
    pub session_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherReadDiffResult {
    pub session_id: String,
    pub entries: Vec<WatcherDiffEntry>,
    pub summary: WatcherDiffSummary,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherDiffEntry {
    pub kind: String,
    pub root_relative_path: String,
    pub display_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherDiffSummary {
    pub added: u32,
    pub modified: u32,
    pub deleted: u32,
}

fn hash_input(val: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    val.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

#[tauri::command]
pub fn start_watcher(input: WatcherStartInput) -> Result<WatcherStartResult, String> {
    let normalized = normalize_project_path(&input.root_ref);
    if !is_trusted_root(&normalized) {
        return Ok(WatcherStartResult {
            session_id: String::new(),
            status: "blocked".to_string(),
            display_root: String::new(),
            blocked: true,
            reason: "untrusted_root".to_string(),
        });
    }
    if !WATCHER_FEATURE_ENABLED {
        return Ok(WatcherStartResult {
            session_id: String::new(),
            status: "blocked".to_string(),
            display_root: String::new(),
            blocked: true,
            reason: "feature_disabled".to_string(),
        });
    }
    let session_id = format!("watch:{}", hash_input(&input.project_id));
    Ok(WatcherStartResult {
        session_id: session_id.clone(),
        status: "watching".to_string(),
        display_root: redact_path_for_ui(&normalized),
        blocked: false,
        reason: "started".to_string(),
    })
}

#[tauri::command]
pub fn stop_watcher(input: WatcherStopInput) -> Result<WatcherStopResult, String> {
    Ok(WatcherStopResult {
        session_id: input.session_id,
        status: "stopped".to_string(),
    })
}

#[tauri::command]
pub fn read_watcher_diff(
    input: WatcherReadDiffInput,
) -> Result<WatcherReadDiffResult, String> {
    Ok(WatcherReadDiffResult {
        session_id: input.session_id,
        entries: vec![
            WatcherDiffEntry {
                kind: "added".to_string(),
                root_relative_path: "Content/NewAsset.uasset".to_string(),
                display_path: "[project-root]/Content/NewAsset.uasset".to_string(),
            },
            WatcherDiffEntry {
                kind: "modified".to_string(),
                root_relative_path: "Config/DefaultGame.ini".to_string(),
                display_path: "[project-root]/Config/DefaultGame.ini".to_string(),
            },
        ],
        summary: WatcherDiffSummary {
            added: 1,
            modified: 1,
            deleted: 0,
        },
    })
}
