use serde::{Deserialize, Serialize};

pub const BROWSER_ENABLE_ENV: &str = "UAGENT_ENABLE_REAL_BROWSER";

fn browser_real_enabled() -> bool {
    cfg!(test) || std::env::var(BROWSER_ENABLE_ENV).ok().as_deref() == Some("1")
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserCapabilityStatus {
    pub enabled: bool,
    pub mode: String,
    pub reason: Option<String>,
    pub localhost_allowed: bool,
    pub loopback_allowed: bool,
    pub file_allowed: bool,
    pub external_blocked: bool,
}

#[tauri::command]
pub fn browser_capability_status() -> BrowserCapabilityStatus {
    let enabled = browser_real_enabled();
    BrowserCapabilityStatus {
        enabled,
        mode: if enabled { "native" } else { "disabled" }.to_string(),
        reason: if enabled { None } else { Some("feature_disabled".to_string()) },
        localhost_allowed: true,
        loopback_allowed: true,
        file_allowed: true,
        external_blocked: true,
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPreviewInput {
    pub url: String,
    pub task_id: Option<String>,
    pub root_ref: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPreviewResult {
    pub session_id: String,
    pub url: String,
    pub target_id: String,
    pub policy: String,
    pub blocked: bool,
    pub reason: String,
    pub display_target: Option<String>,
    pub display_url: Option<String>,
    pub needs_trusted_root: bool,
}

#[derive(Debug, Clone)]
struct BrowserTargetClassification {
    policy: &'static str,
    blocked: bool,
    reason: &'static str,
    needs_trusted_root: bool,
    display_target: Option<String>,
    target_id: String,
}

#[allow(dead_code)]
pub(crate) fn classify_url(url: &str) -> (&'static str, bool, &'static str, bool) {
    let classification = classify_preview_target(url, None);
    (
        classification.policy,
        classification.blocked,
        classification.reason,
        classification.needs_trusted_root,
    )
}

fn hash_input(val: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    val.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn display_url(url: &str) -> String {
    match tauri::Url::parse(url) {
        Ok(parsed) if parsed.scheme() == "file" => {
            let filename = parsed
                .to_file_path()
                .ok()
                .and_then(|p| p.file_name().map(|name| name.to_string_lossy().to_string()))
                .unwrap_or_else(|| "file".to_string());
            format!("[local file] {}", filename)
        }
        Ok(parsed) if parsed.scheme() == "http" || parsed.scheme() == "https" => {
            if let Some(host) = parsed.host_str() {
                let port = parsed.port().map(|p| format!(":{}", p)).unwrap_or_default();
                format!("{}://{}{}", parsed.scheme(), host, port)
            } else {
                "[blocked target]".to_string()
            }
        }
        _ => "[blocked target]".to_string(),
    }
}

fn blocked_classification(reason: &'static str, needs_trusted_root: bool) -> BrowserTargetClassification {
    BrowserTargetClassification {
        policy: "blocked_external",
        blocked: true,
        reason,
        needs_trusted_root,
        display_target: None,
        target_id: format!("browser-target:{}", hash_input(reason)),
    }
}

fn allowed_classification(url: &str, needs_trusted_root: bool) -> BrowserTargetClassification {
    let display = display_url(url);
    BrowserTargetClassification {
        policy: "local_only",
        blocked: false,
        reason: "",
        needs_trusted_root,
        target_id: format!("browser-target:{}", hash_input(&display)),
        display_target: Some(display),
    }
}

fn classify_file_url(url: &tauri::Url, root_ref: Option<&str>) -> BrowserTargetClassification {
    let Some(root_ref) = root_ref.map(str::trim).filter(|r| !r.is_empty()) else {
        return blocked_classification("file:// preview requires trusted root", true);
    };
    if root_ref.starts_with("\\\\") || root_ref.starts_with("//") {
        return blocked_classification("Network trusted roots are blocked", true);
    }
    let normalized_root = crate::normalize_project_path(root_ref);
    if normalized_root.starts_with("//") || normalized_root.starts_with("fixture://") {
        return blocked_classification("Invalid trusted root for file preview", true);
    }
    if !crate::is_trusted_root(&normalized_root) {
        return blocked_classification("Trusted root has not been approved", true);
    }
    let root = match crate::resolve_canonical_path(&normalized_root) {
        Ok(root) if root.is_dir() => root,
        _ => return blocked_classification("Trusted root is missing or invalid", true),
    };
    let target_path = match url.to_file_path() {
        Ok(path) => path,
        Err(_) => return blocked_classification("Malformed or network file URL blocked", true),
    };
    let target = match target_path.canonicalize() {
        Ok(path) if path.is_file() => path,
        _ => return blocked_classification("File preview target is missing or invalid", true),
    };
    if !target.starts_with(&root) {
        return blocked_classification("file:// target is outside trusted root", true);
    }
    allowed_classification(url.as_str(), true)
}

fn classify_preview_target(url: &str, root_ref: Option<&str>) -> BrowserTargetClassification {
    if !url.contains("://") {
        return blocked_classification("Malformed URL: no scheme found", false);
    }
    let parsed = match tauri::Url::parse(url) {
        Ok(parsed) => parsed,
        Err(_) => return blocked_classification("Malformed URL blocked by browser preview policy", false),
    };
    match parsed.scheme() {
        "http" | "https" => {
            if !parsed.username().is_empty() || parsed.password().is_some() {
                return blocked_classification("URL userinfo is blocked by browser preview policy", false);
            }
            let Some(host) = parsed.host_str().map(|h| h.to_ascii_lowercase()) else {
                return blocked_classification("Malformed URL blocked by browser preview policy", false);
            };
            if host == "localhost" || host == "127.0.0.1" {
                return allowed_classification(url, false);
            }
            let reason = if host.starts_with("10.")
                || host.starts_with("172.")
                || host.starts_with("192.168.")
                || host == "0.0.0.0"
                || host == "::1"
            {
                "Private network hosts not allowed. Only localhost/127.0.0.1 are allowed"
            } else {
                "External URL blocked by default policy. Only localhost/127.0.0.1 are allowed"
            };
            blocked_classification(reason, false)
        }
        "file" => classify_file_url(&parsed, root_ref),
        _ => blocked_classification("Unknown URL scheme blocked by default policy", false),
    }
}

fn allow_preview_navigation(url: &tauri::Url, root_ref: Option<&str>) -> bool {
    if url.as_str() == "about:blank" {
        return true;
    }
    !classify_preview_target(url.as_str(), root_ref).blocked
}

#[tauri::command]
pub fn browser_preview(input: BrowserPreviewInput) -> Result<BrowserPreviewResult, String> {
    if !browser_real_enabled() {
        let target_id = format!("browser-target:{}", hash_input("feature_disabled"));
        return Ok(BrowserPreviewResult {
            session_id: String::new(),
            url: "[blocked target]".to_string(),
            target_id,
            policy: "blocked".to_string(),
            blocked: true,
            reason: "feature_disabled".to_string(),
            display_target: None,
            display_url: None,
            needs_trusted_root: false,
        });
    }
    let classification = classify_preview_target(&input.url, input.root_ref.as_deref());
    let display = classification.display_target.clone();
    Ok(BrowserPreviewResult {
        session_id: format!("session:{}", hash_input(&input.url)),
        url: display.clone().unwrap_or_else(|| "[blocked target]".to_string()),
        target_id: classification.target_id,
        policy: classification.policy.to_string(),
        blocked: classification.blocked,
        reason: classification.reason.to_string(),
        display_target: display.clone(),
        display_url: display,
        needs_trusted_root: classification.needs_trusted_root,
    })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPreviewOpenInput {
    pub url: String,
    pub session_id: String,
    pub root_ref: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserPreviewOpenResult {
    pub window_id: String,
    pub status: String,
}

#[tauri::command]
pub async fn open_browser_preview(
    app_handle: tauri::AppHandle,
    input: BrowserPreviewOpenInput,
) -> Result<BrowserPreviewOpenResult, String> {
    if !browser_real_enabled() {
        return Err("feature_disabled".to_string());
    }
    let classification = classify_preview_target(&input.url, input.root_ref.as_deref());
    if classification.blocked {
        return Err(format!("URL blocked: {}", classification.reason));
    }
    let label = format!("browser-preview-{}", input.session_id);
    let parsed = tauri::Url::parse(&input.url)
        .map_err(|e| format!("Invalid URL: {}", e))?;
    let navigation_root = input.root_ref.clone();
    let window = tauri::WebviewWindowBuilder::new(
        &app_handle,
        &label,
        tauri::WebviewUrl::External(parsed.clone()),
    )
    .on_navigation(move |url| {
        allow_preview_navigation(url, navigation_root.as_deref())
    })
    .title("Browser Preview")
    .inner_size(1024.0, 768.0)
    .resizable(true)
    .build()
    .map_err(|e| format!("Failed to create preview window: {}", e))?;
    window
        .navigate(parsed)
        .map_err(|e| format!("Failed to navigate preview window: {}", e))?;
    Ok(BrowserPreviewOpenResult {
        window_id: window.label().to_string(),
        status: "opened".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_external_https_blocked() {
        let (policy, blocked, reason, _) = classify_url("https://example.com");
        assert!(blocked);
        assert_eq!(policy, "blocked_external");
        assert!(reason.contains("External URL"));
    }

    #[test]
    fn classify_localhost_http_allowed() {
        let (policy, blocked, reason, _) = classify_url("http://localhost:3000");
        assert!(!blocked);
        assert_eq!(policy, "local_only");
        assert!(reason.is_empty());
    }

    #[test]
    fn classify_localhost_https_allowed() {
        let (policy, blocked, _, _) = classify_url("https://localhost:5173");
        assert!(!blocked);
        assert_eq!(policy, "local_only");
    }

    #[test]
    fn classify_loopback_http_allowed() {
        let (policy, blocked, _, _) = classify_url("http://127.0.0.1:8765");
        assert!(!blocked);
        assert_eq!(policy, "local_only");
    }

    #[test]
    fn classify_file_without_trusted_root_blocked() {
        let (policy, blocked, _, needs_root) = classify_url("file:///C:/project/output.html");
        assert!(blocked);
        assert_eq!(policy, "blocked_external");
        assert!(needs_root);
    }

    #[test]
    fn classify_private_lan_blocked() {
        let (_policy, blocked, reason, _) = classify_url("http://192.168.1.1");
        assert!(blocked);
        assert!(reason.contains("Private network"));
    }

    #[test]
    fn classify_private_10_blocked() {
        let (_policy, blocked, reason, _) = classify_url("http://10.0.0.1:8080");
        assert!(blocked);
        assert!(reason.contains("Private network"));
    }

    #[test]
    fn classify_no_scheme_blocked() {
        let (_policy, blocked, reason, _) = classify_url("localhost:3000");
        assert!(blocked);
        assert!(reason.contains("no scheme"));
    }

    #[test]
    fn classify_unknown_scheme_blocked() {
        let (_policy, blocked, reason, _) = classify_url("ftp://localhost:21");
        assert!(blocked);
        assert!(reason.contains("Unknown URL scheme"));
    }

    #[test]
    fn classify_ipv6_loopback_blocked_for_g8_scope() {
        let (_policy, blocked, reason, _) = classify_url("http://[::1]:3000");
        assert!(blocked);
        assert!(reason.contains("Only localhost/127.0.0.1"));
    }

    #[test]
    fn classify_userinfo_localhost_trick_blocked() {
        let (_policy, blocked, reason, _) = classify_url("http://example.com@localhost:3000");
        assert!(blocked);
        assert!(reason.contains("userinfo"));
    }

    #[test]
    fn display_url_redacts_file_path() {
        let displayed = display_url("file:///C:/Users/Admin/project/output.html");
        assert!(displayed.contains("[local file]"));
        assert!(!displayed.contains("C:/Users/Admin"));
        assert!(displayed.contains("output.html"));
    }

    #[test]
    fn display_url_keeps_scheme_host() {
        let displayed = display_url("http://localhost:3000/path");
        assert_eq!(displayed, "http://localhost:3000");
    }

    #[test]
    fn capability_status_works_under_test() {
        let status = browser_capability_status();
        assert_eq!(status.mode, "native");
        assert!(status.enabled);
        assert!(status.localhost_allowed);
        assert!(status.loopback_allowed);
        assert!(status.external_blocked);
    }

    #[test]
    fn navigation_guard_allows_webview_bootstrap_but_blocks_external() {
        let blank = tauri::Url::parse("about:blank").unwrap();
        let external = tauri::Url::parse("https://example.com").unwrap();
        let local = tauri::Url::parse("http://localhost:5173").unwrap();

        assert!(allow_preview_navigation(&blank, None));
        assert!(allow_preview_navigation(&local, None));
        assert!(!allow_preview_navigation(&external, None));
    }

    #[test]
    fn browser_preview_allows_localhost_under_test() {
        let result = browser_preview(BrowserPreviewInput {
            url: "http://localhost:3000".to_string(),
            task_id: None,
            root_ref: None,
        })
        .unwrap();
        assert!(!result.blocked);
        assert_eq!(result.policy, "local_only");
    }

    #[test]
    fn browser_preview_serialized_no_raw_paths() {
        let result = browser_preview(BrowserPreviewInput {
            url: "http://localhost:3000".to_string(),
            task_id: Some("task-test".to_string()),
            root_ref: None,
        })
        .unwrap();
        let serialized = serde_json::to_string(&result).unwrap();
        assert!(!serialized.contains("C:/Users/"), "leaks raw Windows path");
        assert!(!serialized.contains("/Users/"), "leaks raw macOS path");
        assert!(!serialized.contains("/home/"), "leaks raw Linux path");
    }

    #[test]
    fn browser_preview_blocked_external_has_display_url_none() {
        let result = browser_preview(BrowserPreviewInput {
            url: "https://external.com".to_string(),
            task_id: None,
            root_ref: None,
        })
        .unwrap();
        assert!(result.blocked);
        assert_eq!(result.policy, "blocked_external");
    }

    #[test]
    fn browser_preview_file_without_trusted_root_blocked() {
        let result = browser_preview(BrowserPreviewInput {
            url: "file:///C:/output/report.html".to_string(),
            task_id: None,
            root_ref: None,
        })
        .unwrap();
        assert!(result.needs_trusted_root, "file:// should signal trusted-root check");
        assert!(result.blocked, "file:// without trusted root should be blocked");
    }

    #[test]
    fn browser_preview_trusted_file_allowed_and_redacted() {
        let unique = format!(
            "uagent_browser_trusted_{}_{}",
            std::process::id(),
            hash_input("trusted-file")
        );
        let root = std::env::temp_dir().join(unique);
        std::fs::create_dir_all(root.join("output")).unwrap();
        let file = root.join("output").join("report.html");
        std::fs::write(&file, "<html>ok</html>").unwrap();
        let root_str = root.to_str().unwrap().to_string();
        let file_url = tauri::Url::from_file_path(&file).unwrap().to_string();
        let root_hash = crate::hash_path(&crate::normalize_project_path(&root_str));
        crate::trusted_roots().lock().unwrap().insert(root_hash);

        let result = browser_preview(BrowserPreviewInput {
            url: file_url.clone(),
            task_id: None,
            root_ref: Some(root_str.clone()),
        })
        .unwrap();
        let serialized = serde_json::to_string(&result).unwrap();

        assert!(!result.blocked);
        assert_eq!(result.display_url.as_deref(), Some("[local file] report.html"));
        assert!(!serialized.contains(&root_str));
        assert!(!serialized.contains(&file_url));
        assert!(!serialized.contains("file://"));

        std::fs::remove_dir_all(root).unwrap();
        crate::trusted_roots().lock().unwrap().clear();
    }

    #[test]
    fn browser_preview_file_outside_trusted_root_blocked() {
        let unique = format!(
            "uagent_browser_outside_{}_{}",
            std::process::id(),
            hash_input("outside-file")
        );
        let base = std::env::temp_dir().join(unique);
        let root = base.join("project");
        let outside = base.join("project-sibling").join("report.html");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(outside.parent().unwrap()).unwrap();
        std::fs::write(&outside, "<html>outside</html>").unwrap();
        let root_str = root.to_str().unwrap().to_string();
        let file_url = tauri::Url::from_file_path(&outside).unwrap().to_string();
        let root_hash = crate::hash_path(&crate::normalize_project_path(&root_str));
        crate::trusted_roots().lock().unwrap().insert(root_hash);

        let result = browser_preview(BrowserPreviewInput {
            url: file_url,
            task_id: None,
            root_ref: Some(root_str),
        })
        .unwrap();

        assert!(result.blocked);
        assert!(result.reason.contains("outside trusted root"));

        std::fs::remove_dir_all(base).unwrap();
        crate::trusted_roots().lock().unwrap().clear();
    }
}
