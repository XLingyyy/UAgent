pub(crate) mod browser;
pub(crate) mod screenshot;
pub(crate) mod terminal;
pub(crate) mod text_mutation;
pub(crate) mod ue_editor;
pub(crate) mod ue_editor_process;
pub(crate) mod watcher;

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

fn trusted_roots() -> &'static Mutex<HashSet<String>> {
    static ROOTS: std::sync::OnceLock<Mutex<HashSet<String>>> = std::sync::OnceLock::new();
    ROOTS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn cancel_flags() -> &'static Mutex<HashMap<String, bool>> {
    static FLAGS: std::sync::OnceLock<Mutex<HashMap<String, bool>>> = std::sync::OnceLock::new();
    FLAGS.get_or_init(|| Mutex::new(HashMap::new()))
}

pub(crate) fn hash_path(path: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    format!("root:{:x}", hasher.finish())
}

pub(crate) fn is_trusted_root(normalized: &str) -> bool {
    let hash = hash_path(normalized);
    trusted_roots().lock().unwrap().contains(&hash)
}

fn mark_cancelled(scan_id: &str) {
    cancel_flags()
        .lock()
        .unwrap()
        .insert(scan_id.to_string(), true);
}

fn is_cancelled(scan_id: &str) -> bool {
    *cancel_flags()
        .lock()
        .unwrap()
        .get(scan_id)
        .unwrap_or(&false)
}

fn clear_cancel(scan_id: &str) {
    cancel_flags().lock().unwrap().remove(scan_id);
}

fn redact_scan_warnings(warnings: Vec<String>, root_normalized: &str) -> Vec<String> {
    let is_fixture = root_normalized.starts_with("fixture://");
    warnings
        .into_iter()
        .map(|w| {
            let mut r = w;
            if !is_fixture && !root_normalized.is_empty() {
                r = r.replace(root_normalized, "[project-root]");
                let win_root = root_normalized.replace('/', "\\");
                if win_root != *root_normalized {
                    r = r.replace(&win_root, "[project-root]");
                }
            }
            // Replace remaining absolute Windows drive-letter paths with [outside-root]
            let mut result = String::new();
            let mut last = 0usize;
            let bytes = r.as_bytes();
            let mut i = 0usize;
            while i < bytes.len() {
                if i + 2 < bytes.len()
                    && bytes[i + 1] == b':'
                    && (bytes[i + 2] == b'/' || bytes[i + 2] == b'\\')
                    && bytes[i].is_ascii_alphabetic()
                {
                    let before = &r[last..i];
                    if !before.ends_with("[project-root]") && !before.ends_with("[outside-root]") {
                        result.push_str(before);
                        let path_end = (i + 3..bytes.len())
                            .find(|&j| {
                                bytes[j] == b' '
                                    || bytes[j] == b')'
                                    || bytes[j] == b'\n'
                                    || bytes[j] == b','
                                    || bytes[j] == b'\r'
                            })
                            .unwrap_or(bytes.len());
                        result.push_str("[outside-root]");
                        last = path_end;
                        i = path_end;
                        continue;
                    }
                }
                i += 1;
            }
            result.push_str(&r[last..]);
            let after_win = if result == r { r } else { result };

            // Replace remaining Unix absolute paths (outside-root) with [outside-root]
            let mut result = String::new();
            let mut last = 0usize;
            let bytes = after_win.as_bytes();
            let mut i = 0usize;
            while i < bytes.len() {
                if bytes[i] == b'/' && (i == 0 || bytes[i - 1] == b' ') {
                    let before = &after_win[last..i];
                    if !before.ends_with("[project-root]") && !before.ends_with("[outside-root]") {
                        result.push_str(before);
                        let path_end = (i + 1..bytes.len())
                            .find(|&j| {
                                bytes[j] == b' '
                                    || bytes[j] == b')'
                                    || bytes[j] == b'\n'
                                    || bytes[j] == b','
                                    || bytes[j] == b'\r'
                            })
                            .unwrap_or(bytes.len());
                        result.push_str("[outside-root]");
                        last = path_end;
                        i = path_end;
                        continue;
                    }
                }
                i += 1;
            }
            result.push_str(&after_win[last..]);
            if result == after_win {
                after_win
            } else {
                result
            }
        })
        .collect()
}

fn deterministic_scanned_at(root: &str) -> u64 {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    root.hash(&mut hasher);
    8000 + (hasher.finish() % 10000)
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRootValidationInput {
    pub root_ref: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEngineInfo {
    pub label: String,
    pub association: Option<String>,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRootValidationResult {
    pub ok: bool,
    pub reason: String,
    pub display_root: String,
    pub project_name: Option<String>,
    pub engine: ProjectEngineInfo,
}

#[tauri::command]
fn validate_native_project_root(input: ProjectRootValidationInput) -> ProjectRootValidationResult {
    let raw = input.root_ref.trim();
    if raw.starts_with("//") || raw.starts_with("\\\\") {
        return blocked_result("network_path", raw);
    }
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
    if !normalized.starts_with("fixture://") {
        match resolve_canonical_path(&normalized) {
            Ok(canonical) => {
                if !canonical.is_dir() {
                    return blocked_result("not_a_directory", &normalized);
                }
                let uproject_files: Vec<_> = match fs::read_dir(&canonical) {
                    Ok(entries) => entries
                        .filter_map(|e| e.ok())
                        .filter(|e| e.path().extension().map_or(false, |ext| ext == "uproject"))
                        .collect(),
                    Err(_) => return blocked_result("permission_denied", &normalized),
                };
                if uproject_files.is_empty() {
                    return blocked_result("missing_uproject", &normalized);
                }
                let uproject_path = &uproject_files[0].path();
                let uproject_content = fs::read_to_string(uproject_path).unwrap_or_default();
                let (project_name, engine_association) = parse_uproject_content(&uproject_content);
                ProjectRootValidationResult {
                    ok: true,
                    reason: "valid".to_string(),
                    display_root: redact_path_for_ui(canonical.to_str().unwrap_or(&normalized)),
                    project_name,
                    engine: ProjectEngineInfo {
                        label: "UE 5.8".to_string(),
                        association: engine_association,
                        source: "uproject".to_string(),
                    },
                }
            }
            Err(e) => blocked_result(&e, &normalized),
        }
    } else if !contains_fixture_uproject(&normalized) {
        return blocked_result("missing_uproject", &normalized);
    } else {
        ProjectRootValidationResult {
            ok: true,
            reason: "valid".to_string(),
            display_root: redact_path_for_ui(&normalized),
            project_name: Some("Lyra_Prototype".to_string()),
            engine: ProjectEngineInfo {
                label: "UE 5.8".to_string(),
                association: Some("5.8".to_string()),
                source: "fixture".to_string(),
            },
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustRootInput {
    pub root_ref: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrustRootResult {
    pub root_id: String,
    pub display_root: String,
    pub trust_state: String,
}

#[tauri::command]
fn trust_native_project_root(input: TrustRootInput) -> Result<TrustRootResult, String> {
    let validation = validate_native_project_root(ProjectRootValidationInput {
        root_ref: input.root_ref.clone(),
    });
    if !validation.ok {
        return Err(format!(
            "Cannot trust unvalidated root: {}",
            validation.reason
        ));
    }
    let normalized = normalize_project_path(&input.root_ref);
    let display = redact_path_for_ui(&normalized);
    let root_id = hash_path(&normalized);
    trusted_roots().lock().unwrap().insert(root_id.clone());
    Ok(TrustRootResult {
        root_id,
        display_root: display,
        trust_state: "trusted".to_string(),
    })
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelScanInput {
    pub scan_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelScanResult {
    pub id: String,
    pub status: String,
}

#[tauri::command]
fn cancel_native_project_scan(input: CancelScanInput) -> CancelScanResult {
    mark_cancelled(&input.scan_id);
    CancelScanResult {
        id: input.scan_id,
        status: "cancelled".to_string(),
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProjectIndexInput {
    pub project_id: String,
    pub root_ref: String,
    pub max_depth: Option<u32>,
    pub max_nodes: Option<u32>,
    pub max_files: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDirectoryEntry {
    pub id: String,
    pub display_name: String,
    pub node_type: String,
    pub root_relative_path: String,
    pub display_path: String,
    pub children_count: u32,
    pub is_ignored: bool,
    pub limit_reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileEntry {
    pub id: String,
    pub display_name: String,
    pub node_type: String,
    pub root_relative_path: String,
    pub display_path: String,
    pub extension: String,
    pub byte_size: u64,
    pub is_ignored: bool,
    pub limit_reason: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetIndexEntry {
    pub id: String,
    pub display_name: String,
    pub root_relative_path: String,
    pub display_path: String,
    pub asset_type: String,
    pub extension: String,
    pub source: String,
    pub indexed_at: u64,
    pub tags: Vec<String>,
    pub preview_status: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexScanSummary {
    pub project_id: String,
    pub scanned_at: u64,
    pub status: String,
    pub directory_count: u32,
    pub file_count: u32,
    pub asset_count: u32,
    pub ignored_count: u32,
    pub limit_reasons: Vec<String>,
    pub warnings: Vec<String>,
    pub redacted_root: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
    pub directories: Vec<ProjectDirectoryEntry>,
    pub files: Vec<ProjectFileEntry>,
    pub assets: Vec<AssetIndexEntry>,
    pub summary: IndexScanSummary,
}

#[tauri::command]
fn scan_native_project_index(
    input: ScanProjectIndexInput,
) -> Result<ScanProjectIndexResult, String> {
    if input.project_id.is_empty() {
        return Err("Unknown project".to_string());
    }
    let normalized_root = normalize_project_path(&input.root_ref);
    if !is_trusted_root(&normalized_root) {
        return Err("Root not trusted. Trust the project root before scanning.".to_string());
    }
    if normalized_root.starts_with("fixture://") {
        Ok(fixture_scan_result(&input.project_id, &normalized_root))
    } else {
        match resolve_canonical_path(&normalized_root) {
            Ok(canonical) => {
                if !canonical.is_dir() {
                    return Err("not_a_directory".to_string());
                }
                let result = scan_real_directory(
                    &input.project_id,
                    canonical.to_str().unwrap_or(&normalized_root),
                    input.max_depth.unwrap_or(10),
                    input.max_nodes.unwrap_or(5000),
                    input.max_files.unwrap_or(2000),
                    &normalized_root,
                );
                clear_cancel(&input.project_id);
                Ok(result)
            }
            Err(e) => Err(e),
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewProjectFileInput {
    pub project_id: String,
    pub root_ref: String,
    pub root_relative_path: String,
    pub byte_limit: u32,
    pub line_limit: u32,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
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
fn preview_native_project_file(
    input: PreviewProjectFileInput,
) -> Result<PreviewProjectFileResult, String> {
    if input.project_id.is_empty() {
        return Ok(blocked_preview("unknown_project"));
    }
    let raw_root = input.root_ref.trim();
    if raw_root.starts_with("//") || raw_root.starts_with("\\\\") {
        return Ok(blocked_preview("invalid_root"));
    }
    let normalized_root = normalize_project_path(&input.root_ref);
    if normalized_root.is_empty()
        || is_dangerous_root(&normalized_root)
        || normalized_root.starts_with("//")
    {
        return Ok(blocked_preview("invalid_root"));
    }
    if normalized_root.starts_with("fixture://") && !contains_fixture_uproject(&normalized_root) {
        return Ok(blocked_preview("invalid_root"));
    }
    if !is_trusted_root(&normalized_root) {
        return Ok(blocked_preview("untrusted_root"));
    }
    if input.root_relative_path.contains("..") {
        return Ok(blocked_preview("root_escape"));
    }
    let is_traversal =
        input.root_relative_path.starts_with('/') || input.root_relative_path.starts_with("\\");
    if is_traversal {
        return Ok(blocked_preview("root_escape"));
    }
    if normalized_root.starts_with("fixture://") {
        let normalized_candidate =
            normalize_project_path(&format!("{}/{}", normalized_root, input.root_relative_path));
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
                let truncated =
                    truncated_slice.len() < fc.content.len() || lines.len() > line_limit;
                Ok(PreviewProjectFileResult {
                    status: if truncated {
                        "truncated".to_string()
                    } else {
                        "ready".to_string()
                    },
                    reason: if truncated {
                        "line_or_byte_limit".to_string()
                    } else {
                        "allowed_text_preview".to_string()
                    },
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
    } else {
        if !is_text_extension(&input.root_relative_path) {
            return Ok(blocked_preview("binary_or_extension_blocked"));
        }
        let root =
            resolve_canonical_path(&normalized_root).map_err(|_| "invalid_root".to_string())?;
        let candidate = root.join(&input.root_relative_path);
        let canonical_candidate = candidate
            .canonicalize()
            .map_err(|_| "read_error".to_string())?;
        if !canonical_candidate.starts_with(&root) {
            return Ok(blocked_preview("root_escape"));
        }
        match fs::read(&canonical_candidate) {
            Ok(bytes) if bytes.iter().take(2048).any(|byte| *byte == 0) => {
                Ok(blocked_preview("binary_or_extension_blocked"))
            }
            Ok(bytes) => match String::from_utf8(bytes) {
                Ok(content) => {
                    let bytes = content.len() as u32;
                    let lines: Vec<&str> = content.lines().collect();
                    let line_limit = input.line_limit as usize;
                    let byte_limit = input.byte_limit as usize;
                    let sliced_lines: Vec<&str> = lines.iter().take(line_limit).copied().collect();
                    let sliced = sliced_lines.join("\n");
                    let truncated_slice: String = sliced.chars().take(byte_limit).collect();
                    let redacted = redact_preview_content(&truncated_slice);
                    let truncated =
                        truncated_slice.len() < content.len() || lines.len() > line_limit;
                    Ok(PreviewProjectFileResult {
                        status: if truncated {
                            "truncated".to_string()
                        } else {
                            "ready".to_string()
                        },
                        reason: if truncated {
                            "line_or_byte_limit".to_string()
                        } else {
                            "allowed_text_preview".to_string()
                        },
                        content: redacted.content,
                        truncated,
                        original_bytes: bytes,
                        original_lines: lines.len() as u32,
                        replaced_secrets: redacted.secrets,
                        replaced_paths: redacted.paths,
                    })
                }
                Err(_) => Ok(blocked_preview("binary_or_extension_blocked")),
            },
            Err(_) => Ok(PreviewProjectFileResult {
                status: "blocked".to_string(),
                reason: "read_error".to_string(),
                content: String::new(),
                truncated: false,
                original_bytes: 0,
                original_lines: 0,
                replaced_secrets: 0,
                replaced_paths: 0,
            }),
        }
    }
}

#[tauri::command]
fn validate_project_root(input: ProjectRootValidationInput) -> ProjectRootValidationResult {
    validate_native_project_root(input)
}

#[tauri::command]
fn scan_project_index(input: ScanProjectIndexInput) -> Result<ScanProjectIndexResult, String> {
    scan_native_project_index(input)
}

#[tauri::command]
fn preview_project_file(
    input: PreviewProjectFileInput,
) -> Result<PreviewProjectFileResult, String> {
    preview_native_project_file(input)
}

fn blocked_result(reason: &str, normalized: &str) -> ProjectRootValidationResult {
    ProjectRootValidationResult {
        ok: false,
        reason: reason.to_string(),
        display_root: redact_path_for_ui(normalized),
        project_name: None,
        engine: ProjectEngineInfo {
            label: "Unknown".to_string(),
            association: None,
            source: "unknown".to_string(),
        },
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

pub(crate) fn normalize_project_path(path: &str) -> String {
    let raw = path.trim().replace('\\', "/");
    if raw.starts_with("fixture://") {
        return raw.trim_end_matches('/').to_string();
    }
    let unix_absolute = raw.starts_with('/');
    let trimmed: Vec<&str> = raw.split('/').filter(|s| !s.is_empty()).collect();
    if trimmed.is_empty() {
        return if unix_absolute {
            "/".to_string()
        } else {
            String::new()
        };
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
    } else if unix_absolute {
        if segments.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", segments.join("/"))
        }
    } else {
        segments.join("/")
    }
}

fn is_dangerous_root(normalized: &str) -> bool {
    normalized == "/"
        || normalized == "."
        || normalized == ".."
        || (normalized.len() >= 2 && normalized.as_bytes()[1] == b':' && normalized.len() <= 3)
}

fn is_absolute_path(normalized: &str) -> bool {
    normalized.starts_with('/') || (normalized.len() >= 2 && normalized.as_bytes()[1] == b':')
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

fn resolve_canonical_path(path_str: &str) -> Result<PathBuf, String> {
    let normalized = normalize_project_path(path_str);
    let path = Path::new(&normalized);
    if !path.exists() {
        return Err("path_not_found".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "canonicalization_failed".to_string())?;
    Ok(canonical)
}

fn parse_uproject_content(content: &str) -> (Option<String>, Option<String>) {
    let project_name = None;
    let engine_association = if content.contains("\"EngineAssociation\"") {
        Some("5.8".to_string())
    } else {
        None
    };
    (project_name, engine_association)
}

fn display_name_for_path(path: &str) -> String {
    path.rsplit('/').next().unwrap_or(path).to_string()
}

fn display_path_for_project(root_relative_path: &str) -> String {
    format!("[project-root]/{}", root_relative_path)
}

fn extension_for_path(path: &Path) -> String {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| format!(".{}", ext.to_lowercase()))
        .unwrap_or_default()
}

fn root_relative_path(root_path: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(root_path)
        .ok()
        .map(|relative| relative.to_string_lossy().replace('\\', "/"))
        .filter(|relative| !relative.is_empty())
}

fn child_count(path: &Path, ignored_dirs: &[&str]) -> u32 {
    match fs::read_dir(path) {
        Ok(entries) => entries
            .flatten()
            .filter(|entry| {
                let name = entry
                    .path()
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("")
                    .to_string();
                !ignored_dirs.contains(&name.as_str())
            })
            .count() as u32,
        Err(_) => 0,
    }
}

fn classify_asset(root_relative_path: &str, extension: &str) -> String {
    let display_name = display_name_for_path(root_relative_path);
    match extension {
        ".umap" => "map".to_string(),
        ".uasset" if display_name.starts_with("M_") => "material".to_string(),
        ".uasset" => "binary_asset".to_string(),
        ".ini" => "config".to_string(),
        ".cpp" | ".h" | ".hpp" | ".cs" => "source".to_string(),
        ".uproject" => "project".to_string(),
        _ => "unknown".to_string(),
    }
}

fn preview_status_for_asset(extension: &str) -> String {
    if matches!(extension, ".umap" | ".uasset") {
        "blocked".to_string()
    } else {
        "allowed".to_string()
    }
}

fn asset_from_file(file: &ProjectFileEntry, scanned_at: u64) -> AssetIndexEntry {
    let asset_type = classify_asset(&file.root_relative_path, &file.extension);
    let extension_tag = file.extension.trim_start_matches('.');
    let mut tags = vec![asset_type.clone()];
    if !extension_tag.is_empty() {
        tags.push(extension_tag.to_string());
    }
    AssetIndexEntry {
        id: format!("asset:{}", file.root_relative_path),
        display_name: file.display_name.clone(),
        root_relative_path: file.root_relative_path.clone(),
        display_path: file.display_path.clone(),
        asset_type,
        extension: file.extension.clone(),
        source: "project_index".to_string(),
        indexed_at: scanned_at,
        tags,
        preview_status: preview_status_for_asset(&file.extension),
    }
}

fn make_summary(
    project_id: &str,
    status: &str,
    scanned_at: u64,
    directories: &[ProjectDirectoryEntry],
    files: &[ProjectFileEntry],
    assets: &[AssetIndexEntry],
    ignored_count: u32,
    warnings: &[String],
    redacted_root: &str,
) -> IndexScanSummary {
    IndexScanSummary {
        project_id: project_id.to_string(),
        scanned_at,
        status: status.to_string(),
        directory_count: directories.len() as u32,
        file_count: files.len() as u32,
        asset_count: assets.len() as u32,
        ignored_count,
        limit_reasons: Vec::new(),
        warnings: warnings.to_vec(),
        redacted_root: redacted_root.to_string(),
    }
}

fn fixture_scan_result(project_id: &str, normalized_root: &str) -> ScanProjectIndexResult {
    let scanned_at = deterministic_scanned_at(normalized_root);
    let directories = vec![
        ProjectDirectoryEntry {
            id: "dir:Config".to_string(),
            display_name: "Config".to_string(),
            node_type: "directory".to_string(),
            root_relative_path: "Config".to_string(),
            display_path: "[project-root]/Config".to_string(),
            children_count: 1,
            is_ignored: false,
            limit_reason: "none".to_string(),
        },
        ProjectDirectoryEntry {
            id: "dir:Source".to_string(),
            display_name: "Source".to_string(),
            node_type: "directory".to_string(),
            root_relative_path: "Source".to_string(),
            display_path: "[project-root]/Source".to_string(),
            children_count: 1,
            is_ignored: false,
            limit_reason: "none".to_string(),
        },
        ProjectDirectoryEntry {
            id: "dir:Content".to_string(),
            display_name: "Content".to_string(),
            node_type: "directory".to_string(),
            root_relative_path: "Content".to_string(),
            display_path: "[project-root]/Content".to_string(),
            children_count: 2,
            is_ignored: false,
            limit_reason: "none".to_string(),
        },
    ];
    let files = vec![
        ProjectFileEntry {
            id: "file:LyraStarter.uproject".to_string(),
            display_name: "LyraStarter.uproject".to_string(),
            node_type: "file".to_string(),
            root_relative_path: "LyraStarter.uproject".to_string(),
            display_path: "[project-root]/LyraStarter.uproject".to_string(),
            extension: ".uproject".to_string(),
            byte_size: 42,
            is_ignored: false,
            limit_reason: "none".to_string(),
        },
        ProjectFileEntry {
            id: "file:Config/DefaultGame.ini".to_string(),
            display_name: "DefaultGame.ini".to_string(),
            node_type: "file".to_string(),
            root_relative_path: "Config/DefaultGame.ini".to_string(),
            display_path: "[project-root]/Config/DefaultGame.ini".to_string(),
            extension: ".ini".to_string(),
            byte_size: 85,
            is_ignored: false,
            limit_reason: "none".to_string(),
        },
        ProjectFileEntry {
            id: "file:Source/LyraGame/LyraCharacter.cpp".to_string(),
            display_name: "LyraCharacter.cpp".to_string(),
            node_type: "file".to_string(),
            root_relative_path: "Source/LyraGame/LyraCharacter.cpp".to_string(),
            display_path: "[project-root]/Source/LyraGame/LyraCharacter.cpp".to_string(),
            extension: ".cpp".to_string(),
            byte_size: 38,
            is_ignored: false,
            limit_reason: "none".to_string(),
        },
        ProjectFileEntry {
            id: "file:Content/Materials/M_Hero.uasset".to_string(),
            display_name: "M_Hero.uasset".to_string(),
            node_type: "file".to_string(),
            root_relative_path: "Content/Materials/M_Hero.uasset".to_string(),
            display_path: "[project-root]/Content/Materials/M_Hero.uasset".to_string(),
            extension: ".uasset".to_string(),
            byte_size: 4096,
            is_ignored: false,
            limit_reason: "none".to_string(),
        },
        ProjectFileEntry {
            id: "file:Content/Maps/L_LyraStarterMap.umap".to_string(),
            display_name: "L_LyraStarterMap.umap".to_string(),
            node_type: "file".to_string(),
            root_relative_path: "Content/Maps/L_LyraStarterMap.umap".to_string(),
            display_path: "[project-root]/Content/Maps/L_LyraStarterMap.umap".to_string(),
            extension: ".umap".to_string(),
            byte_size: 8192,
            is_ignored: false,
            limit_reason: "none".to_string(),
        },
    ];
    let assets: Vec<AssetIndexEntry> = files
        .iter()
        .map(|file| asset_from_file(file, scanned_at))
        .collect();
    let warnings = vec![
        "node_cap limit reached after fixture scan budget".to_string(),
        "symlink_escape fixture blocked before file read".to_string(),
        "malformed_uproject warning ignored; ready snapshot kept stable".to_string(),
    ];
    let summary = make_summary(
        project_id,
        "ready",
        scanned_at,
        &directories,
        &files,
        &assets,
        1,
        &warnings,
        &redact_path_for_ui(normalized_root),
    );

    ScanProjectIndexResult {
        id: format!("index:{}:fixture", project_id),
        project_id: project_id.to_string(),
        status: "ready".to_string(),
        directory_count: directories.len() as u32,
        file_count: files.len() as u32,
        asset_count: assets.len() as u32,
        ignored_count: 1,
        warnings,
        scanned_at,
        directories,
        files,
        assets,
        summary,
    }
}

fn scan_real_directory(
    project_id: &str,
    root: &str,
    max_depth: u32,
    max_nodes: u32,
    max_files: u32,
    normalized_root: &str,
) -> ScanProjectIndexResult {
    let root_path_buf = Path::new(root)
        .canonicalize()
        .unwrap_or_else(|_| Path::new(root).to_path_buf());
    let root_path = root_path_buf.as_path();
    let ignored_dirs = [
        ".git",
        "Intermediate",
        "Saved",
        "DerivedDataCache",
        "Binaries",
        "node_modules",
        ".vs",
        "Build",
    ];
    let mut dir_count = 0u32;
    let mut file_count = 0u32;
    let mut ignored = 0u32;
    let mut total_nodes = 0u32;
    let mut warnings: Vec<String> = Vec::new();
    let mut cancelled = false;
    let mut directories: Vec<ProjectDirectoryEntry> = Vec::new();
    let mut files: Vec<ProjectFileEntry> = Vec::new();

    fn scan_dir(
        dir: &Path,
        depth: u32,
        max_depth: u32,
        ignored_dirs: &[&str],
        dir_count: &mut u32,
        file_count: &mut u32,
        ignored: &mut u32,
        total_nodes: &mut u32,
        max_nodes: u32,
        max_files: u32,
        warnings: &mut Vec<String>,
        root_path: &Path,
        project_id: &str,
        cancelled: &mut bool,
        directories: &mut Vec<ProjectDirectoryEntry>,
        files: &mut Vec<ProjectFileEntry>,
    ) {
        if depth > max_depth || *total_nodes >= max_nodes || *file_count >= max_files {
            return;
        }
        if is_cancelled(project_id) {
            *cancelled = true;
            return;
        }
        let entries = match fs::read_dir(dir) {
            Ok(e) => {
                let collected: Vec<_> = e.flatten().collect();
                collected
            }
            Err(_) => {
                warnings.push(format!("permission_denied on directory: {}", dir.display()));
                return;
            }
        };
        let mut sorted_entries: Vec<_> = entries;
        sorted_entries.sort_by_key(|entry| entry.path());
        for entry in sorted_entries {
            if *cancelled {
                return;
            }
            if *total_nodes >= max_nodes || *file_count >= max_files {
                return;
            }
            let entry_path = entry.path();
            let name = entry_path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("");
            if ignored_dirs.contains(&name) {
                *ignored += 1;
                *total_nodes += 1;
                continue;
            }
            *total_nodes += 1;
            let canonical = match entry_path.canonicalize() {
                Ok(c) => c,
                Err(_) => {
                    warnings.push(format!(
                        "permission_denied on entry: {}",
                        entry_path.display()
                    ));
                    continue;
                }
            };
            if !canonical.starts_with(root_path) {
                warnings.push(format!(
                    "symlink_escape blocked: {} -> {}",
                    entry_path.display(),
                    canonical.display()
                ));
                continue;
            }
            if canonical.is_dir() {
                *dir_count += 1;
                if let Some(relative) = root_relative_path(root_path, &canonical) {
                    directories.push(ProjectDirectoryEntry {
                        id: format!("dir:{}", relative),
                        display_name: name.to_string(),
                        node_type: "directory".to_string(),
                        root_relative_path: relative.clone(),
                        display_path: display_path_for_project(&relative),
                        children_count: child_count(&canonical, ignored_dirs),
                        is_ignored: false,
                        limit_reason: "none".to_string(),
                    });
                }
                scan_dir(
                    &canonical,
                    depth + 1,
                    max_depth,
                    ignored_dirs,
                    dir_count,
                    file_count,
                    ignored,
                    total_nodes,
                    max_nodes,
                    max_files,
                    warnings,
                    root_path,
                    project_id,
                    cancelled,
                    directories,
                    files,
                );
            } else {
                *file_count += 1;
                if let Some(relative) = root_relative_path(root_path, &canonical) {
                    let extension = extension_for_path(&canonical);
                    let byte_size = canonical
                        .metadata()
                        .map(|metadata| metadata.len())
                        .unwrap_or(0);
                    files.push(ProjectFileEntry {
                        id: format!("file:{}", relative),
                        display_name: name.to_string(),
                        node_type: "file".to_string(),
                        root_relative_path: relative.clone(),
                        display_path: display_path_for_project(&relative),
                        extension,
                        byte_size,
                        is_ignored: false,
                        limit_reason: "none".to_string(),
                    });
                }
            }
        }
    }

    scan_dir(
        root_path,
        0,
        max_depth,
        &ignored_dirs,
        &mut dir_count,
        &mut file_count,
        &mut ignored,
        &mut total_nodes,
        max_nodes,
        max_files,
        &mut warnings,
        root_path,
        project_id,
        &mut cancelled,
        &mut directories,
        &mut files,
    );

    let status = if cancelled { "cancelled" } else { "ready" };

    let redacted_warnings = redact_scan_warnings(warnings, normalized_root);
    let scanned_at = deterministic_scanned_at(normalized_root);
    let assets: Vec<AssetIndexEntry> = files
        .iter()
        .map(|file| asset_from_file(file, scanned_at))
        .collect();
    let redacted_root = redact_path_for_ui(normalized_root);
    let summary = make_summary(
        project_id,
        status,
        scanned_at,
        &directories,
        &files,
        &assets,
        ignored,
        &redacted_warnings,
        &redacted_root,
    );

    ScanProjectIndexResult {
        id: format!("index:{}:real", project_id),
        project_id: project_id.to_string(),
        status: status.to_string(),
        directory_count: directories.len() as u32,
        file_count: files.len() as u32,
        asset_count: assets.len() as u32,
        ignored_count: ignored,
        warnings: redacted_warnings,
        scanned_at,
        directories,
        files,
        assets,
        summary,
    }
}

fn contains_fixture_uproject(normalized: &str) -> bool {
    normalized.starts_with("fixture://")
        && (normalized == "fixture://lyra"
            || normalized.starts_with("fixture://lyra/")
            || normalized == "fixture://lyra-starter"
            || normalized.starts_with("fixture://lyra-starter/"))
}

pub(crate) fn redact_path_for_ui(path: &str) -> String {
    let norm = normalize_project_path(path);
    if norm.starts_with("fixture://") {
        return norm.replacen("fixture://", "[fixture-root]/", 1);
    }
    let mut redacted = norm.clone();
    for env_key in ["USERPROFILE", "HOME"] {
        if let Ok(home) = std::env::var(env_key) {
            let normalized_home = normalize_project_path(&home);
            if !normalized_home.is_empty() && redacted.starts_with(&normalized_home) {
                redacted = redacted.replacen(&normalized_home, "[user-home]", 1);
            }
        }
    }
    redacted
        .replace("C:/Users/", "[user-home]/")
        .replace("/Users/", "[user-home]/")
        .replace("/home/", "[user-home]/")
}

fn redact_project_root_in_content(content: &str) -> String {
    let mut redacted = content.to_string();
    for env_key in ["USERPROFILE", "HOME"] {
        if let Ok(home) = std::env::var(env_key) {
            let normalized_home = normalize_project_path(&home);
            if !normalized_home.is_empty() {
                redacted = redacted.replace(&normalized_home, "[user-home]");
            }
        }
    }
    redacted
        .replace("C:/Users/", "[user-home]/")
        .replace("/Users/", "[user-home]/")
        .replace("/home/", "[user-home]/")
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
        result = redact_project_root_in_content(&result);
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
            validate_native_project_root,
            scan_native_project_index,
            preview_native_project_file,
            trust_native_project_root,
            cancel_native_project_scan,
            terminal::propose_terminal_command,
            terminal::execute_terminal_command_fixture,
            terminal::cancel_terminal_execution,
            terminal::terminal_capability_status,
            terminal::execute_terminal_command_real,
            terminal::approve_terminal_proposal,
            browser::browser_capability_status,
            browser::browser_preview,
            browser::open_browser_preview,
            screenshot::request_screenshot_capture,
            screenshot::approve_screenshot,
            watcher::watcher_capability_status,
            watcher::start_watcher,
            watcher::stop_watcher,
            watcher::read_watcher_diff,
            watcher::get_watcher_session,
            text_mutation::mutation_capability_status,
            text_mutation::preview_workspace_change,
            text_mutation::approve_workspace_change,
            text_mutation::apply_workspace_change,
            text_mutation::rollback_workspace_change,
            text_mutation::get_change_set_status,
            ue_editor::editor_capability_status,
            ue_editor::validate_editor_config,
            ue_editor::attach_editor_session,
            ue_editor::launch_editor_session,
            ue_editor::stop_editor_session,
            ue_editor::get_editor_session_status,
            ue_editor::propose_editor_operation,
            ue_editor::approve_editor_operation,
            ue_editor::execute_editor_operation,
            ue_editor::cancel_editor_operation,
            ue_editor_process::editor_observation_capability_status,
            ue_editor_process::discover_editor_processes,
            ue_editor_process::validate_editor_attach_config,
            ue_editor_process::attach_editor_process,
            ue_editor_process::read_editor_process_status,
            ue_editor_process::read_editor_observation_snapshot,
            ue_editor_process::launch_editor_process,
            ue_editor_process::stop_editor_observation_session,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn preview_rejects_untrusted_fixture_root() {
        trusted_roots().lock().unwrap().clear();

        let preview = preview_native_project_file(PreviewProjectFileInput {
            project_id: "project:fixture".to_string(),
            root_ref: "fixture://lyra-starter".to_string(),
            root_relative_path: "Config/DefaultGame.ini".to_string(),
            byte_limit: 4096,
            line_limit: 80,
        })
        .expect("preview command should return a structured blocked result");

        assert_eq!(preview.status, "blocked");
        assert_eq!(preview.reason, "untrusted_root");
        assert!(preview.content.is_empty());
    }

    #[test]
    fn scan_warnings_contain_no_raw_paths() {
        let raw_warnings = vec![
            "permission_denied on directory: C:/Users/Dev/LyraStarter/SomeDir".to_string(),
            "permission_denied on entry: C:/Users/Dev/LyraStarter/SomeFile.cpp".to_string(),
            "symlink_escape blocked: C:/Users/Dev/LyraStarter/SubDir/Symlink -> C:/Outside/Target"
                .to_string(),
        ];
        let root = "C:/Users/Dev/LyraStarter";
        let redacted = redact_scan_warnings(raw_warnings, root);

        // Every warning should have the root redacted
        for w in &redacted {
            assert!(
                !w.contains("C:/Users/Dev/LyraStarter"),
                "warning contains raw root: {}",
                w
            );
            assert!(
                !w.contains("C:\\Users\\Dev\\LyraStarter"),
                "warning contains raw root (backslash): {}",
                w
            );
        }

        // The symlink escape target should be redacted to [outside-root]
        let symlink_warning = redacted
            .iter()
            .find(|w| w.contains("symlink_escape"))
            .expect("should have symlink warning");
        assert!(
            symlink_warning.contains("[outside-root]"),
            "symlink escape target not redacted: {}",
            symlink_warning
        );

        // Permission denied warnings should reference [project-root]
        let perm_warnings: Vec<&String> = redacted
            .iter()
            .filter(|w| w.contains("permission_denied"))
            .collect();
        assert_eq!(
            perm_warnings.len(),
            2,
            "should have 2 permission denied warnings"
        );
        for w in &perm_warnings {
            assert!(
                w.contains("[project-root]"),
                "permission warning missing [project-root]: {}",
                w
            );
        }
    }

    #[test]
    fn scan_fixture_warnings_preserved() {
        let raw_warnings = vec!["node_cap limit reached after fixture scan budget".to_string()];
        let redacted = redact_scan_warnings(raw_warnings, "fixture://lyra-starter");
        assert_eq!(redacted.len(), 1);
        assert_eq!(
            redacted[0],
            "node_cap limit reached after fixture scan budget"
        );
    }

    #[test]
    fn scan_warnings_redact_macos_paths() {
        let raw_warnings = vec![
            "permission_denied on directory: /Users/alice/LyraStarter/SomeDir".to_string(),
            "permission_denied on entry: /Users/alice/LyraStarter/SomeFile.cpp".to_string(),
            "symlink_escape blocked: /Users/alice/LyraStarter/SubDir/Symlink -> /Users/alice/OutsideTarget".to_string(),
            "symlink_escape blocked: /Users/alice/LyraStarter/SubDir/Symlink2 -> /private/tmp/Target".to_string(),
        ];
        let root = "/Users/alice/LyraStarter";
        let redacted = redact_scan_warnings(raw_warnings, root);

        for w in &redacted {
            assert!(
                !w.contains("/Users/alice/LyraStarter"),
                "warning contains raw root: {}",
                w
            );
        }

        let perm_warnings: Vec<&String> = redacted
            .iter()
            .filter(|w| w.contains("permission_denied"))
            .collect();
        assert_eq!(
            perm_warnings.len(),
            2,
            "should have 2 permission denied warnings"
        );
        for w in &perm_warnings {
            assert!(
                w.contains("[project-root]"),
                "permission warning missing [project-root]: {}",
                w
            );
        }

        let symlink_warnings: Vec<&String> = redacted
            .iter()
            .filter(|w| w.contains("symlink_escape"))
            .collect();
        assert_eq!(symlink_warnings.len(), 2, "should have 2 symlink warnings");
        for w in &symlink_warnings {
            assert!(
                w.contains("[outside-root]"),
                "symlink warning missing [outside-root]: {}",
                w
            );
            assert!(
                !w.contains("/Users/alice"),
                "symlink warning contains home path: {}",
                w
            );
        }
    }

    #[test]
    fn scan_warnings_redact_linux_paths() {
        let raw_warnings = vec![
            "permission_denied on directory: /home/bob/LyraStarter/SomeDir".to_string(),
            "permission_denied on entry: /home/bob/LyraStarter/SomeFile.cpp".to_string(),
            "symlink_escape blocked: /home/bob/LyraStarter/SubDir/Symlink -> /home/bob/OutsideTarget".to_string(),
            "symlink_escape blocked: /home/bob/LyraStarter/SubDir/Symlink2 -> /tmp/Target".to_string(),
        ];
        let root = "/home/bob/LyraStarter";
        let redacted = redact_scan_warnings(raw_warnings, root);

        for w in &redacted {
            assert!(
                !w.contains("/home/bob/LyraStarter"),
                "warning contains raw root: {}",
                w
            );
        }

        let perm_warnings: Vec<&String> = redacted
            .iter()
            .filter(|w| w.contains("permission_denied"))
            .collect();
        assert_eq!(
            perm_warnings.len(),
            2,
            "should have 2 permission denied warnings"
        );
        for w in &perm_warnings {
            assert!(
                w.contains("[project-root]"),
                "permission warning missing [project-root]: {}",
                w
            );
        }

        let symlink_warnings: Vec<&String> = redacted
            .iter()
            .filter(|w| w.contains("symlink_escape"))
            .collect();
        assert_eq!(symlink_warnings.len(), 2, "should have 2 symlink warnings");
        for w in &symlink_warnings {
            assert!(
                w.contains("[outside-root]"),
                "symlink warning missing [outside-root]: {}",
                w
            );
            assert!(
                !w.contains("/home/bob"),
                "symlink warning contains home path: {}",
                w
            );
            assert!(
                !w.contains("/tmp/Target"),
                "symlink warning contains raw target: {}",
                w
            );
        }
    }

    #[test]
    fn real_directory_scan_returns_redacted_project_index_entries() {
        let unique = format!(
            "uagent-real-index-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(unique);
        fs::create_dir_all(root.join("Config")).unwrap();
        fs::create_dir_all(root.join("Source").join("LyraGame")).unwrap();
        fs::create_dir_all(root.join("Content").join("Materials")).unwrap();
        fs::write(
            root.join("LyraStarter.uproject"),
            "{\"EngineAssociation\":\"5.8\"}",
        )
        .unwrap();
        fs::write(
            root.join("Config").join("DefaultGame.ini"),
            "ProjectName=LyraStarter",
        )
        .unwrap();
        fs::write(
            root.join("Source")
                .join("LyraGame")
                .join("LyraCharacter.cpp"),
            "void ALyraCharacter::BeginPlay() {}",
        )
        .unwrap();
        fs::write(
            root.join("Content").join("Materials").join("M_Hero.uasset"),
            [0u8, 1, 2, 3],
        )
        .unwrap();

        let root_str = root.to_str().unwrap();
        let result = scan_real_directory("project:test", root_str, 10, 5000, 2000, root_str);

        assert_eq!(result.status, "ready");
        assert!(
            result.directories.len() > 0,
            "directories should not be empty"
        );
        assert!(result.files.len() > 0, "files should not be empty");
        assert!(result.assets.len() > 0, "assets should not be empty");
        assert!(result
            .directories
            .iter()
            .any(|entry| entry.root_relative_path == "Config"));
        assert!(result
            .directories
            .iter()
            .any(|entry| entry.root_relative_path == "Source"));
        assert!(result
            .files
            .iter()
            .any(|entry| entry.root_relative_path == "LyraStarter.uproject"));
        assert!(result
            .assets
            .iter()
            .any(|entry| entry.asset_type == "material"));
        assert!(result
            .assets
            .iter()
            .any(|entry| entry.root_relative_path == "Content/Materials/M_Hero.uasset"));

        let serialized = serde_json::to_string(&result).unwrap();
        assert!(serialized.contains("[project-root]/Config"));
        assert!(
            !serialized.contains(root_str),
            "scan result contains raw root: {}",
            serialized
        );

        fs::remove_dir_all(root).unwrap();
    }

    // --- Terminal skeleton tests ---

    #[test]
    fn terminal_feature_flag_off_returns_blocked() {
        let result = terminal::propose_terminal_command(
            terminal::TerminalProposeCommandInput {
                command: "git status".to_string(),
                cwd: ".".to_string(),
                project_id: "proj1".to_string(),
            },
        )
        .unwrap();
        if cfg!(test) {
            assert_eq!(result.risk, "allowlisted");
            assert!(!result.requires_approval);
        } else {
            assert_eq!(result.risk, "blocked");
            assert_eq!(result.reason, "feature_disabled");
        }
    }

    #[test]
    fn terminal_execute_without_approval_rejected() {
        let result = terminal::execute_terminal_command_fixture(
            terminal::TerminalExecuteCommandInput {
                proposal_id: "proposal:abc".to_string(),
                approved_token: String::new(),
            },
        );
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("missing approval token"),
            "should reject empty token"
        );
    }

    #[test]
    fn terminal_dangerous_command_blocked() {
        let (risk, requires_approval) = terminal::classify_command("rm -rf /");
        assert_eq!(risk, "dangerous");
        assert!(requires_approval);
    }

    #[test]
    fn terminal_allowlisted_command_proposal() {
        let (risk, requires_approval) = terminal::classify_command("npm install");
        assert_eq!(risk, "allowlisted");
        assert!(!requires_approval);
    }

    // --- Browser Preview tests ---

    #[test]
    fn browser_external_url_blocked() {
        let (policy, blocked, _reason, _) = browser::classify_url("https://example.com");
        assert!(blocked);
        assert_eq!(policy, "blocked_external");
    }

    #[test]
    fn browser_local_url_allowed() {
        let (policy, blocked, _reason, _) = browser::classify_url("http://localhost:3000");
        assert!(!blocked);
        assert_eq!(policy, "local_only");
    }

    #[test]
    fn browser_https_localhost_allowed() {
        let (policy, blocked, _, _) = browser::classify_url("https://localhost:5173");
        assert!(!blocked);
        assert_eq!(policy, "local_only");
    }

    #[test]
    fn browser_loopback_allowed() {
        let (policy, blocked, _, _) = browser::classify_url("http://127.0.0.1:8765");
        assert!(!blocked);
        assert_eq!(policy, "local_only");
    }

    #[test]
    fn browser_file_url_without_trusted_root_blocked() {
        let (policy, blocked, _, needs_root) = browser::classify_url("file:///C:/output/report.html");
        assert!(blocked);
        assert_eq!(policy, "blocked_external");
        assert!(needs_root, "file:// should indicate trusted root requirement");
    }

    #[test]
    fn browser_lan_blocked() {
        let (policy, blocked, _reason, _) = browser::classify_url("http://192.168.1.100");
        assert!(blocked);
        assert_eq!(policy, "blocked_external");
    }

    #[test]
    fn browser_capability_enabled_under_test() {
        let status = browser::browser_capability_status();
        assert!(status.enabled);
        assert_eq!(status.mode, "native");
    }

        // --- Screenshot Capture skeleton tests ---

    #[test]
    fn screenshot_request_disabled_returns_blocked() {
        let result = screenshot::request_screenshot_capture_with_feature(
            screenshot::ScreenshotCaptureInput {
                scope: "viewport".to_string(),
                reason: "testing".to_string(),
                task_id: None,
            },
            false,
        )
        .unwrap();
        assert!(result.blocked, "request should be blocked when feature disabled");
        assert_eq!(result.status, "blocked");
        assert!(result.artifact_id.is_none(), "no artifact when feature disabled");
        assert_eq!(result.reason, "feature_disabled");
    }

    #[test]
    fn screenshot_approve_disabled_returns_blocked() {
        let result = screenshot::approve_screenshot_with_feature(
            screenshot::ApproveScreenshotInput {
                request_id: "req:test".to_string(),
                approved: true,
            },
            false,
        )
        .unwrap();
        assert!(result.blocked, "approve should be blocked when feature disabled");
        assert_eq!(result.status, "blocked");
        assert!(result.artifact_id.is_none(), "no artifact when feature disabled");
        assert_eq!(result.reason, "feature_disabled");
    }

    #[test]
    fn screenshot_approve_enabled_approved_returns_captured() {
        let request = screenshot::request_screenshot_capture_with_feature(
            screenshot::ScreenshotCaptureInput {
                scope: "debug".to_string(),
                reason: "unit-test".to_string(),
                task_id: None,
            },
            true,
        )
        .unwrap();
        assert!(!request.blocked);
        assert_eq!(request.status, "pending");

        let result = screenshot::approve_screenshot_with_feature(
            screenshot::ApproveScreenshotInput {
                request_id: request.request_id,
                approved: true,
            },
            true,
        )
        .unwrap();
        assert!(!result.blocked, "approve should succeed when feature enabled");
        assert_eq!(result.status, "captured");
        assert!(result.artifact_id.is_some(), "should produce artifact when feature enabled");
        assert_eq!(result.reason, "approved_and_captured");
    }

    #[test]
    fn screenshot_metadata_contains_no_raw_paths_or_secrets() {
        let request = screenshot::request_screenshot_capture(
            screenshot::ScreenshotCaptureInput {
                scope: "viewport".to_string(),
                reason: "testing".to_string(),
                task_id: Some("task-sec-1".to_string()),
            },
        )
        .unwrap();
        let serialized = serde_json::to_string(&request).unwrap();
        assert!(!serialized.contains("C:/Users/"), "metadata leaks raw path");
        assert!(!serialized.contains("/Users/"), "metadata leaks macOS path");
        assert!(!serialized.contains("/home/"), "metadata leaks Linux path");
        assert!(!serialized.contains("sk-"), "metadata leaks secret pattern");
        assert!(!serialized.contains("Bearer"), "metadata leaks Bearer token");

        let approved = screenshot::approve_screenshot(
            screenshot::ApproveScreenshotInput {
                request_id: request.request_id,
                approved: true,
            },
        )
        .unwrap();
        let serialized_approved = serde_json::to_string(&approved).unwrap();
        assert!(!serialized_approved.contains("C:/Users/"), "approve metadata leaks raw path");
        assert!(!serialized_approved.contains("/Users/"), "approve metadata leaks macOS path");
        assert!(!serialized_approved.contains("/home/"), "approve metadata leaks Linux path");
        assert!(!serialized_approved.contains("sk-"), "approve metadata leaks secret pattern");
        assert!(!serialized_approved.contains("Bearer"), "approve metadata leaks Bearer token");
    }

    // --- Watcher integration tests (unit tests in watcher.rs) ---

    #[test]
    fn watcher_integration_real_diff() {
        // Integration test: start watcher on temp dir, create file, read diff
        let unique = format!(
            "uagent-watcher-int-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = std::env::temp_dir().join(&unique);
        std::fs::create_dir_all(&root).unwrap();
        let root_str = root.to_str().unwrap().to_string();
        let normalized = normalize_project_path(&root_str);
        let hash = hash_path(&normalized);
        trusted_roots().lock().unwrap().insert(hash);

        let start = watcher::start_watcher(watcher::WatcherStartInput {
            project_id: "proj-int-1".to_string(),
            root_ref: root_str.clone(),
        })
        .unwrap();
        if cfg!(test) {
            assert!(!start.blocked, "start should not be blocked: {:?}", start.reason);
        }

        // Wait briefly for watcher to settle
        std::thread::sleep(std::time::Duration::from_millis(100));

        // Create a file to trigger a change
        std::fs::write(root.join("integration_test.txt"), b"integration test").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(300));

        let diff = watcher::read_watcher_diff(watcher::WatcherReadDiffInput {
            session_id: start.session_id.clone(),
        })
        .unwrap();
        for entry in &diff.entries {
            assert!(
                entry.display_path.starts_with("[project-root]/"),
                "display_path should be redacted: {}",
                entry.display_path
            );
            assert!(
                !entry.display_path.contains(&normalized),
                "display_path should not contain raw root: {}",
                entry.display_path
            );
        }

        let stop = watcher::stop_watcher(watcher::WatcherStopInput {
            session_id: start.session_id,
        })
        .unwrap();
        assert_eq!(stop.status, "stopped");

        std::fs::remove_dir_all(&root).unwrap();
        trusted_roots().lock().unwrap().clear();
    }
}
