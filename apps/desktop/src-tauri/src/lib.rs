use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectRootValidationInput {
    pub root_ref: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectRootValidationResult {
    pub ok: bool,
    pub reason: String,
    pub display_root: String,
    pub project_name: Option<String>,
    pub engine_label: String,
    pub engine_association: Option<String>,
    pub engine_source: String,
}

#[tauri::command]
fn validate_project_root(input: ProjectRootValidationInput) -> ProjectRootValidationResult {
    let normalized = normalize_project_path(&input.root_ref);
    if normalized.is_empty() {
        return blocked_result("empty_path", &normalized);
    }
    if is_dangerous_root(&normalized) {
        return blocked_result("dangerous_root", &normalized);
    }
    if normalized.starts_with("//") {
        return blocked_result("network_path", &normalized);
    }
    if !normalized.starts_with("fixture://") && !is_absolute_path(&normalized) {
        return blocked_result("relative_path", &normalized);
    }
    if !contains_fixture_uproject(&normalized) {
        return blocked_result("missing_uproject", &normalized);
    }
    ProjectRootValidationResult {
        ok: true,
        reason: "valid".to_string(),
        display_root: redact_path_for_ui(&normalized),
        project_name: Some("Lyra_Prototype".to_string()),
        engine_label: "UE 5.8".to_string(),
        engine_association: Some("5.8".to_string()),
        engine_source: "fixture".to_string(),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanProjectIndexInput {
    pub project_id: String,
    pub root_ref: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ScanProjectIndexResult {
    pub id: String,
    pub project_id: String,
    pub status: String,
    pub directory_count: u32,
    pub file_count: u32,
    pub asset_count: u32,
    pub ignored_count: u32,
    pub warnings: Vec<String>,
    pub scanned_at: u64,
}

#[tauri::command]
fn scan_project_index(input: ScanProjectIndexInput) -> Result<ScanProjectIndexResult, String> {
    if input.project_id.is_empty() {
        return Err("Unknown project".to_string());
    }
    if !input.root_ref.starts_with("fixture://") {
        return Err("Project root must be a fixture root in MVP7 fixture mode".to_string());
    }
    Ok(ScanProjectIndexResult {
        id: format!("index:{}:fixture", input.project_id),
        project_id: input.project_id,
        status: "ready".to_string(),
        directory_count: 5,
        file_count: 7,
        asset_count: 6,
        ignored_count: 1,
        warnings: vec![
            "node_cap limit reached after fixture scan budget".to_string(),
            "symlink_escape fixture blocked before file read".to_string(),
            "malformed_uproject warning ignored; ready snapshot kept stable".to_string(),
        ],
        scanned_at: 7004,
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PreviewProjectFileInput {
    pub project_id: String,
    pub root_ref: String,
    pub root_relative_path: String,
    pub byte_limit: u32,
    pub line_limit: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PreviewProjectFileResult {
    pub status: String,
    pub reason: String,
    pub content: String,
    pub truncated: bool,
    pub original_bytes: u32,
    pub original_lines: u32,
    pub replaced_secrets: u32,
    pub replaced_paths: u32,
}

#[tauri::command]
fn preview_project_file(input: PreviewProjectFileInput) -> Result<PreviewProjectFileResult, String> {
    if input.project_id.is_empty() {
        return Ok(blocked_preview("unknown_project"));
    }
    let normalized_root = normalize_project_path(&input.root_ref);
    if normalized_root.is_empty()
        || is_dangerous_root(&normalized_root)
        || normalized_root.starts_with("//")
        || !contains_fixture_uproject(&normalized_root)
    {
        return Ok(blocked_preview("invalid_root"));
    }
    if input.root_relative_path.contains("..") {
        return Ok(blocked_preview("root_escape"));
    }
    let is_traversal = input.root_relative_path.starts_with('/')
        || input.root_relative_path.starts_with("\\");
    if is_traversal {
        return Ok(blocked_preview("root_escape"));
    }
    let normalized_candidate = normalize_project_path(&format!(
        "{}/{}",
        normalized_root, input.root_relative_path
    ));
    if !is_inside_project_root(&normalized_root, &normalized_candidate) {
        return Ok(blocked_preview("root_escape"));
    }
    let fixture_content = get_fixture_content(&input.root_relative_path);
    match fixture_content {
        Some(fc) => {
            if !is_text_extension(&input.root_relative_path) {
                return Ok(blocked_preview("binary_or_extension_blocked"));
            }
            let lines: Vec<&str> = fc.content.lines().collect();
            let line_limit = input.line_limit as usize;
            let byte_limit = input.byte_limit as usize;
            let sliced_lines: Vec<&str> = lines.iter().take(line_limit).copied().collect();
            let sliced = sliced_lines.join("\n");
            let truncated_slice: String = sliced.chars().take(byte_limit).collect();
            let redacted = redact_preview_content(&truncated_slice);
            let truncated = truncated_slice.len() < fc.content.len() || lines.len() > line_limit;
            Ok(PreviewProjectFileResult {
                status: if truncated { "truncated".to_string() } else { "ready".to_string() },
                reason: if truncated { "line_or_byte_limit".to_string() } else { "allowed_text_preview".to_string() },
                content: redacted.content,
                truncated,
                original_bytes: fc.bytes,
                original_lines: lines.len() as u32,
                replaced_secrets: redacted.secrets,
                replaced_paths: redacted.paths,
            })
        }
        None => Ok(PreviewProjectFileResult {
            status: "missing".to_string(),
            reason: "missing".to_string(),
            content: String::new(),
            truncated: false,
            original_bytes: 0,
            original_lines: 0,
            replaced_secrets: 0,
            replaced_paths: 0,
        }),
    }
}

fn blocked_result(reason: &str, normalized: &str) -> ProjectRootValidationResult {
    ProjectRootValidationResult {
        ok: false,
        reason: reason.to_string(),
        display_root: redact_path_for_ui(normalized),
        project_name: None,
        engine_label: "Unknown".to_string(),
        engine_association: None,
        engine_source: "unknown".to_string(),
    }
}

fn blocked_preview(reason: &str) -> PreviewProjectFileResult {
    PreviewProjectFileResult {
        status: "blocked".to_string(),
        reason: reason.to_string(),
        content: String::new(),
        truncated: false,
        original_bytes: 0,
        original_lines: 0,
        replaced_secrets: 0,
        replaced_paths: 0,
    }
}

fn normalize_project_path(path: &str) -> String {
    let raw = path.trim().replace('\\', "/");
    if raw.starts_with("fixture://") {
        return raw.trim_end_matches('/').to_string();
    }
    let trimmed: Vec<&str> = raw.split('/').filter(|s| !s.is_empty()).collect();
    if trimmed.is_empty() {
        return String::new();
    }
    let drive = if trimmed[0].len() == 2 && trimmed[0].as_bytes()[1] == b':' {
        Some(trimmed[0])
    } else {
        None
    };
    let mut segments: Vec<&str> = Vec::new();
    let start = if drive.is_some() { 1 } else { 0 };
    for segment in &trimmed[start..] {
        if *segment == "." {
            continue;
        }
        if *segment == ".." {
            segments.pop();
        } else {
            segments.push(*segment);
        }
    }
    if let Some(d) = drive {
        if segments.is_empty() {
            format!("{}/", d)
        } else {
            format!("{}/{}", d, segments.join("/"))
        }
    } else {
        segments.join("/")
    }
}

fn is_dangerous_root(normalized: &str) -> bool {
    normalized == "/"
        || normalized == "."
        || normalized == ".."
        || (normalized.len() >= 2
            && normalized.as_bytes()[1] == b':'
            && normalized.len() <= 3)
}

fn is_absolute_path(normalized: &str) -> bool {
    normalized.starts_with('/')
        || (normalized.len() >= 2 && normalized.as_bytes()[1] == b':')
}

fn is_inside_project_root(root: &str, candidate: &str) -> bool {
    if root.starts_with("fixture://") {
        return candidate == root || candidate.starts_with(&format!("{}/", root));
    }
    let root_with_slash = if root.ends_with('/') {
        root.to_string()
    } else {
        format!("{}/", root)
    };
    candidate == root || candidate.starts_with(&root_with_slash)
}

fn contains_fixture_uproject(normalized: &str) -> bool {
    normalized.starts_with("fixture://")
        && (normalized == "fixture://lyra" || normalized.starts_with("fixture://lyra/"))
}

fn redact_path_for_ui(path: &str) -> String {
    let norm = normalize_project_path(path);
    if norm.starts_with("fixture://") {
        return norm.replacen("fixture://", "[fixture-root]/", 1);
    }
    norm
}

struct FixtureFile {
    content: String,
    bytes: u32,
}

fn get_fixture_content(path: &str) -> Option<FixtureFile> {
    let mut fixtures = HashMap::new();
    fixtures.insert(
        "Config/DefaultGame.ini",
        FixtureFile {
            content: "ProjectName=Lyra_Prototype\nAuthorization=Bearer [REDACTED]\nHome=[user-home]/Lyra\n".to_string(),
            bytes: 85,
        },
    );
    fixtures.insert(
        "Source/LyraGame/LyraCharacter.cpp",
        FixtureFile {
            content: "void ALyraCharacter::BeginPlay() {}\n".to_string(),
            bytes: 38,
        },
    );
    fixtures.get(path).map(|f| FixtureFile {
        content: f.content.clone(),
        bytes: f.bytes,
    })
}

fn is_text_extension(path: &str) -> bool {
    let lower = path.to_lowercase();
    lower.ends_with(".uproject")
        || lower.ends_with(".ini")
        || lower.ends_with(".cpp")
        || lower.ends_with(".h")
        || lower.ends_with(".hpp")
        || lower.ends_with(".cs")
        || lower.ends_with(".json")
        || lower.ends_with(".txt")
        || lower.ends_with(".md")
}

struct RedactedContent {
    content: String,
    secrets: u32,
    paths: u32,
}

fn redact_preview_content(content: &str) -> RedactedContent {
    let mut result = content.to_string();
    let mut secrets = 0u32;
    if result.contains("Bearer ") || result.contains("sk-") || result.contains("token=") {
        secrets += 1;
        result = result
            .replace("Bearer ", "Bearer [REDACTED]")
            .replace("sk-", "[REDACTED]");
    }
    if result.contains("Authorization") || result.contains("api_key") {
        secrets += 1;
    }
    let mut paths = 0u32;
    if result.contains("C:/Users/") || result.contains("/Users/") || result.contains("/home/") {
        paths += 1;
        result = result
            .replace("C:/Users/", "[user-home]/")
            .replace("/Users/", "[user-home]/")
            .replace("/home/", "[user-home]/");
    }
    RedactedContent {
        content: result,
        secrets,
        paths,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| Ok(()))
        .invoke_handler(tauri::generate_handler![
            validate_project_root,
            scan_project_index,
            preview_project_file,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
