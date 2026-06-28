use serde::{Deserialize, Serialize};

pub const SCREENSHOT_FEATURE_ENABLED: bool = cfg!(test);

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotCaptureInput {
    pub scope: String,
    pub reason: String,
    pub task_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotCaptureResult {
    pub request_id: String,
    pub status: String,
    pub artifact_id: Option<String>,
    pub blocked: bool,
    pub reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApproveScreenshotInput {
    pub request_id: String,
    pub approved: bool,
}

fn hash_input(val: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    val.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

pub fn request_screenshot_capture_with_feature(
    input: ScreenshotCaptureInput,
    enabled: bool,
) -> Result<ScreenshotCaptureResult, String> {
    if !enabled {
        return Ok(ScreenshotCaptureResult {
            request_id: String::new(),
            status: "blocked".to_string(),
            artifact_id: None,
            blocked: true,
            reason: "feature_disabled".to_string(),
        });
    }
    Ok(ScreenshotCaptureResult {
        request_id: format!("req:{}", hash_input(&input.scope)),
        status: "pending".to_string(),
        artifact_id: None,
        blocked: false,
        reason: "pending_user_approval".to_string(),
    })
}

#[tauri::command]
pub fn request_screenshot_capture(
    input: ScreenshotCaptureInput,
) -> Result<ScreenshotCaptureResult, String> {
    request_screenshot_capture_with_feature(input, SCREENSHOT_FEATURE_ENABLED)
}

pub fn approve_screenshot_with_feature(
    input: ApproveScreenshotInput,
    enabled: bool,
) -> Result<ScreenshotCaptureResult, String> {
    if !enabled {
        return Ok(ScreenshotCaptureResult {
            request_id: String::new(),
            status: "blocked".to_string(),
            artifact_id: None,
            blocked: true,
            reason: "feature_disabled".to_string(),
        });
    }
    if input.approved {
        Ok(ScreenshotCaptureResult {
            request_id: input.request_id.clone(),
            status: "captured".to_string(),
            artifact_id: Some(format!("artifact:screenshot:{}", input.request_id)),
            blocked: false,
            reason: "approved_and_captured".to_string(),
        })
    } else {
        Ok(ScreenshotCaptureResult {
            request_id: input.request_id,
            status: "rejected".to_string(),
            artifact_id: None,
            blocked: false,
            reason: "user_denied".to_string(),
        })
    }
}

#[tauri::command]
pub fn approve_screenshot(
    input: ApproveScreenshotInput,
) -> Result<ScreenshotCaptureResult, String> {
    approve_screenshot_with_feature(input, SCREENSHOT_FEATURE_ENABLED)
}
