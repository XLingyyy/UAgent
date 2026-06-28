use serde::{Deserialize, Serialize};

pub const BROWSER_FEATURE_ENABLED: bool = cfg!(test);

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPreviewInput {
    pub url: String,
    pub task_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPreviewResult {
    pub session_id: String,
    pub url: String,
    pub policy: String,
    pub blocked: bool,
    pub reason: String,
}

pub(crate) fn classify_url(url: &str) -> (&'static str, bool, &'static str) {
    if url.starts_with("http://localhost")
        || url.starts_with("http://127.0.0.1")
        || url.starts_with("file://")
    {
        ("local_only", false, "")
    } else {
        (
            "blocked_external",
            true,
            "External URL blocked by default policy",
        )
    }
}

fn hash_input(val: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    val.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

#[tauri::command]
pub fn browser_preview(input: BrowserPreviewInput) -> Result<BrowserPreviewResult, String> {
    if !BROWSER_FEATURE_ENABLED {
        return Ok(BrowserPreviewResult {
            session_id: String::new(),
            url: input.url.clone(),
            policy: "blocked".to_string(),
            blocked: true,
            reason: "feature_disabled".to_string(),
        });
    }
    let (policy, blocked, reason) = classify_url(&input.url);
    Ok(BrowserPreviewResult {
        session_id: format!("session:{}", hash_input(&input.url)),
        url: input.url,
        policy: policy.to_string(),
        blocked,
        reason: reason.to_string(),
    })
}
