use crate::{hash_path, is_trusted_root, normalize_project_path, redact_path_for_ui};
use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher as NotifyWatcher};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const WATCHER_ENABLE_ENV: &str = "UAGENT_ENABLE_REAL_WATCHER";
pub const MAX_QUEUE_SIZE: usize = 10_000;
pub const DEBOUNCE_MS: u64 = 500;

static NEXT_SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);

fn next_session_id() -> String {
    let n = NEXT_SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("watcher:session:{}", n)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherStartInput {
    pub project_id: String,
    pub root_ref: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherStartResult {
    pub session_id: String,
    pub root_id: String,
    pub status: String,
    pub display_root: String,
    pub blocked: bool,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherStopInput {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherStopResult {
    pub session_id: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherReadDiffInput {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherReadDiffResult {
    pub session_id: String,
    pub entries: Vec<WatcherDiffEntry>,
    pub summary: WatcherDiffSummary,
    pub overflowed: bool,
    pub queued_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherDiffEntry {
    pub kind: String,
    pub root_relative_path: String,
    pub display_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherDiffSummary {
    pub added: u32,
    pub modified: u32,
    pub deleted: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherSessionInfo {
    pub session_id: String,
    pub root_id: String,
    pub project_id: String,
    pub display_root: String,
    pub status: String,
    pub started_at: u64,
    pub stopped_at: Option<u64>,
    pub overflowed: bool,
    pub queued_count: u32,
    pub dirty: bool,
}

#[derive(Clone)]
struct RawChangeEvent {
    kind: String,
    root_relative_path: String,
    display_path: String,
    timestamp: Instant,
}

struct WatcherSessionData {
    project_id: String,
    root_id: String,
    display_root: String,
    status: String,
    started_at: u64,
    stopped_at: Option<u64>,
    events: Vec<RawChangeEvent>,
    overflowed: bool,
}

fn watcher_registry() -> &'static Mutex<HashMap<String, WatcherEntry>> {
    static REGISTRY: std::sync::OnceLock<Mutex<HashMap<String, WatcherEntry>>> =
        std::sync::OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

struct WatcherEntry {
    data: Arc<Mutex<WatcherSessionData>>,
    _watcher: RecommendedWatcher,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatcherCapabilityStatus {
    pub enabled: bool,
    pub mode: String,
    pub reason: Option<String>,
    pub trusted_root_required: bool,
    pub debounce_ms: u64,
    pub max_queue_size: u32,
    pub overflow_action: String,
    pub read_diff_only: bool,
}

pub fn watcher_real_enabled() -> bool {
    cfg!(test) || std::env::var(WATCHER_ENABLE_ENV).ok().as_deref() == Some("1")
}

#[tauri::command]
pub fn watcher_capability_status() -> WatcherCapabilityStatus {
    let enabled = watcher_real_enabled();
    WatcherCapabilityStatus {
        enabled,
        mode: if enabled { "native" } else { "disabled" }.to_string(),
        reason: if enabled {
            None
        } else {
            Some("feature_disabled".to_string())
        },
        trusted_root_required: true,
        debounce_ms: DEBOUNCE_MS,
        max_queue_size: MAX_QUEUE_SIZE as u32,
        overflow_action: "warn".to_string(),
        read_diff_only: true,
    }
}

fn make_root_relative(absolute: &Path, root: &Path) -> String {
    absolute
        .strip_prefix(root)
        .unwrap_or(absolute)
        .to_string_lossy()
        .replace('\\', "/")
}

fn make_display_path(root_relative: &str) -> String {
    format!("[project-root]/{}", root_relative)
}

fn redacted_blocked_start(normalized: &str, reason: String) -> WatcherStartResult {
    WatcherStartResult {
        session_id: String::new(),
        root_id: hash_path(normalized),
        status: "blocked".to_string(),
        display_root: redact_path_for_ui(normalized),
        blocked: true,
        reason: reason.replace(normalized, "[project-root]"),
    }
}

fn map_event_kind(kind: &EventKind) -> &'static str {
    match kind {
        EventKind::Create(_) => "added",
        EventKind::Modify(_) => "modified",
        EventKind::Remove(_) => "deleted",
        _ => "modified",
    }
}

fn is_ignored_path(
    path: &Path,
    ignored_dirs: &[&str],
    ignored_patterns: &[&str],
) -> bool {
    let path_str = path.to_string_lossy().replace('\\', "/");
    for dir in ignored_dirs {
        if path_str.contains(&format!("/{}/", dir)) || path_str.ends_with(&format!("/{}", dir)) {
            return true;
        }
    }
    for pattern in ignored_patterns {
        if pattern.starts_with("*.") {
            let ext = &pattern[1..];
            if path_str.ends_with(ext) {
                return true;
            }
        }
    }
    false
}

fn debounce_events(events: &[RawChangeEvent]) -> Vec<RawChangeEvent> {
    let mut map: HashMap<String, RawChangeEvent> = HashMap::new();
    for event in events {
        let key = format!("{}:{}", event.kind, event.root_relative_path);
        map.insert(key, event.clone());
    }
    let mut result: Vec<RawChangeEvent> = map.into_values().collect();
    result.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
    result
}

#[tauri::command]
pub fn start_watcher(input: WatcherStartInput) -> Result<WatcherStartResult, String> {
    let normalized = normalize_project_path(&input.root_ref);
    if !is_trusted_root(&normalized) {
        return Ok(redacted_blocked_start(&normalized, "untrusted_root".to_string()));
    }
    if !watcher_real_enabled() {
        return Ok(redacted_blocked_start(&normalized, "feature_disabled".to_string()));
    }

    let root_path = Path::new(&normalized);
    if !root_path.exists() || !root_path.is_dir() {
        return Ok(redacted_blocked_start(&normalized, "root_not_found".to_string()));
    }

    let session_id = next_session_id();
    let root_id = hash_path(&normalized);
    let display_root = redact_path_for_ui(&normalized);

    let data = Arc::new(Mutex::new(WatcherSessionData {
        project_id: input.project_id.clone(),
        root_id: root_id.clone(),
        display_root: display_root.clone(),
        status: "watching".to_string(),
        started_at: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64,
        stopped_at: None,
        events: Vec::new(),
        overflowed: false,
    }));

    let root_clone = root_path.to_path_buf();
    let data_clone = data.clone();
    let ignored_dirs: Vec<&str> = vec![
        ".git", "node_modules", "dist", "build", "Binaries", "Intermediate",
        "Saved", "DerivedDataCache", ".vs", "coverage", ".agent-bus",
    ];
    let ignored_patterns: Vec<&str> = vec!["*.log", "*.tmp", "*.swp", "*.lock"];

    let mut watcher = match RecommendedWatcher::new(
        move |event_res: Result<Event, notify::Error>| {
            if let Ok(event) = event_res {
                let now = Instant::now();
                for path in &event.paths {
                    if is_ignored_path(path, &ignored_dirs, &ignored_patterns) {
                        continue;
                    }
                    let root_relative = make_root_relative(path, &root_clone);
                    if root_relative.is_empty() {
                        continue;
                    }
                    let display_path = make_display_path(&root_relative);
                    let kind = map_event_kind(&event.kind);
                    if let Ok(mut d) = data_clone.lock() {
                        d.events.push(RawChangeEvent {
                            kind: kind.to_string(),
                            root_relative_path: root_relative,
                            display_path,
                            timestamp: now,
                        });
                        if d.events.len() > MAX_QUEUE_SIZE {
                            d.overflowed = true;
                        }
                    }
                }
            }
        },
        Config::default().with_poll_interval(Duration::from_millis(DEBOUNCE_MS)),
    ) {
        Ok(w) => w,
        Err(e) => {
            return Ok(redacted_blocked_start(
                &normalized,
                format!("watcher_init_failed:{}", e),
            ));
        }
    };

    if let Err(e) = watcher.watch(root_path, RecursiveMode::Recursive) {
        return Ok(redacted_blocked_start(
            &normalized,
            format!("watch_failed:{}", e),
        ));
    }

    let mut registry = watcher_registry().lock().map_err(|e| e.to_string())?;
    registry.insert(
        session_id.clone(),
        WatcherEntry {
            data,
            _watcher: watcher,
        },
    );

    Ok(WatcherStartResult {
        session_id: session_id.clone(),
        root_id,
        status: "watching".to_string(),
        display_root,
        blocked: false,
        reason: "started".to_string(),
    })
}

#[tauri::command]
pub fn stop_watcher(input: WatcherStopInput) -> Result<WatcherStopResult, String> {
    let mut registry = watcher_registry().lock().map_err(|e| e.to_string())?;
    if let Some(entry) = registry.remove(&input.session_id) {
        if let Ok(mut d) = entry.data.lock() {
            d.status = "stopped".to_string();
            d.stopped_at = Some(
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis() as u64,
            );
        }
    }
    Ok(WatcherStopResult {
        session_id: input.session_id,
        status: "stopped".to_string(),
    })
}

#[tauri::command]
pub fn read_watcher_diff(input: WatcherReadDiffInput) -> Result<WatcherReadDiffResult, String> {
    let registry = watcher_registry().lock().map_err(|e| e.to_string())?;
    let entry = registry.get(&input.session_id).ok_or_else(|| {
        format!("session not found: {}", input.session_id)
    })?;

    let mut d = entry.data.lock().map_err(|e| e.to_string())?;
    let raw_events: Vec<RawChangeEvent> = d.events.drain(..).collect();
    let overflowed = d.overflowed;
    d.overflowed = false;

    let debounced = debounce_events(&raw_events);

    let mut added = 0u32;
    let mut modified = 0u32;
    let mut deleted = 0u32;

    let entries: Vec<WatcherDiffEntry> = debounced
        .iter()
        .map(|e| {
            match e.kind.as_str() {
                "added" => added += 1,
                "modified" => modified += 1,
                "deleted" => deleted += 1,
                _ => {}
            }
            WatcherDiffEntry {
                kind: e.kind.clone(),
                root_relative_path: e.root_relative_path.clone(),
                display_path: e.display_path.clone(),
            }
        })
        .collect();

    Ok(WatcherReadDiffResult {
        session_id: input.session_id,
        entries,
        summary: WatcherDiffSummary {
            added,
            modified,
            deleted,
        },
        overflowed,
        queued_count: raw_events.len() as u32,
    })
}

#[tauri::command]
pub fn get_watcher_session(input: WatcherStopInput) -> Result<Option<WatcherSessionInfo>, String> {
    let registry = watcher_registry().lock().map_err(|e| e.to_string())?;
    Ok(registry.get(&input.session_id).map(|entry| {
        let d = entry.data.lock().unwrap();
        WatcherSessionInfo {
            session_id: input.session_id.clone(),
            root_id: d.root_id.clone(),
            project_id: d.project_id.clone(),
            display_root: d.display_root.clone(),
            status: d.status.clone(),
            started_at: d.started_at,
            stopped_at: d.stopped_at,
            overflowed: d.overflowed,
            queued_count: d.events.len() as u32,
            dirty: !d.events.is_empty(),
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{hash_path, trusted_roots};

    #[test]
    fn test_untrusted_root_blocked() {
        let result = start_watcher(WatcherStartInput {
            project_id: "proj1".to_string(),
            root_ref: "C:/Untrusted".to_string(),
        })
        .unwrap();
        assert!(result.blocked);
        assert_eq!(result.reason, "untrusted_root");
    }

    #[test]
    fn test_watcher_capability_status_reports_gate_and_limits() {
        let status = watcher_capability_status();

        assert_eq!(status.trusted_root_required, true);
        assert_eq!(status.debounce_ms, DEBOUNCE_MS);
        assert_eq!(status.max_queue_size, MAX_QUEUE_SIZE as u32);
        assert_eq!(status.overflow_action, "warn");
        assert_eq!(status.read_diff_only, true);
        assert_eq!(status.enabled, watcher_real_enabled());
        if status.enabled {
            assert_eq!(status.mode, "native");
            assert_eq!(status.reason, None);
        } else {
            assert_eq!(status.mode, "disabled");
            assert_eq!(status.reason.as_deref(), Some("feature_disabled"));
        }
    }

    #[test]
    fn test_root_not_found_blocked() {
        trusted_roots()
            .lock()
            .unwrap()
            .insert(hash_path(&normalize_project_path("C:/Nonexistent")));

        let result = start_watcher(WatcherStartInput {
            project_id: "proj1".to_string(),
            root_ref: "C:/Nonexistent".to_string(),
        })
        .unwrap();

        trusted_roots().lock().unwrap().clear();
        assert!(result.blocked);
        assert_eq!(result.reason, "root_not_found");
    }

    #[test]
    fn test_stop_nonexistent_session() {
        let result = stop_watcher(WatcherStopInput {
            session_id: "nonexistent".to_string(),
        })
        .unwrap();
        assert_eq!(result.status, "stopped");
    }

    #[test]
    fn test_read_diff_nonexistent_session() {
        let result = read_watcher_diff(WatcherReadDiffInput {
            session_id: "nonexistent".to_string(),
        });
        assert!(result.is_err());
    }

    #[test]
    fn test_debounce_events_dedup() {
        let now = Instant::now();
        let events = vec![
            RawChangeEvent {
                kind: "modified".to_string(),
                root_relative_path: "file.txt".to_string(),
                display_path: "[project-root]/file.txt".to_string(),
                timestamp: now,
            },
            RawChangeEvent {
                kind: "modified".to_string(),
                root_relative_path: "file.txt".to_string(),
                display_path: "[project-root]/file.txt".to_string(),
                timestamp: now + Duration::from_millis(100),
            },
            RawChangeEvent {
                kind: "added".to_string(),
                root_relative_path: "new.txt".to_string(),
                display_path: "[project-root]/new.txt".to_string(),
                timestamp: now + Duration::from_millis(200),
            },
        ];
        let debounced = debounce_events(&events);
        assert_eq!(debounced.len(), 2);
    }

    #[test]
    fn test_map_event_kind() {
        assert_eq!(map_event_kind(&EventKind::Create(notify::event::CreateKind::File)), "added");
        assert_eq!(map_event_kind(&EventKind::Modify(notify::event::ModifyKind::Data(
            notify::event::DataChange::Any,
        ))), "modified");
        assert_eq!(map_event_kind(&EventKind::Remove(notify::event::RemoveKind::File)), "deleted");
    }

    #[test]
    fn test_is_ignored_path_detects_git() {
        assert!(is_ignored_path(
            Path::new("/repo/.git/config"),
            &[".git", "node_modules"],
            &["*.log"],
        ));
    }

    #[test]
    fn test_is_ignored_path_detects_log() {
        assert!(is_ignored_path(
            Path::new("/repo/logs/app.log"),
            &[".git"],
            &["*.log"],
        ));
    }

    #[test]
    fn test_is_ignored_path_non_ignored() {
        assert!(!is_ignored_path(
            Path::new("/repo/src/main.rs"),
            &[".git", "node_modules"],
            &["*.log"],
        ));
    }

    #[test]
    fn test_watcher_real_start_stop_and_diff_on_temp_dir() {
        let unique = format!(
            "uagent-watcher-{}",
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

        let start = start_watcher(WatcherStartInput {
            project_id: "proj-watch-1".to_string(),
            root_ref: root_str.clone(),
        })
        .unwrap();
        assert!(!start.blocked, "start should not be blocked: {:?}", start.reason);
        assert_eq!(start.status, "watching");
        assert!(!start.display_root.contains(&normalized));

        // Create a file to trigger a change event
        std::fs::write(root.join("test_file.txt"), b"hello").unwrap();
        std::thread::sleep(Duration::from_millis(200));

        let read_result = read_watcher_diff(WatcherReadDiffInput {
            session_id: start.session_id.clone(),
        })
        .unwrap();
        assert_eq!(read_result.session_id, start.session_id);
        assert!(
            read_result.entries.len() >= 1 || read_result.queued_count > 0,
            "should have at least one change entry"
        );
        for entry in &read_result.entries {
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

        let stop = stop_watcher(WatcherStopInput {
            session_id: start.session_id.clone(),
        })
        .unwrap();
        assert_eq!(stop.status, "stopped");

        std::fs::remove_dir_all(&root).unwrap();
        trusted_roots().lock().unwrap().clear();
    }

    #[test]
    fn test_get_watcher_session_info() {
        let unique = format!(
            "uagent-watch-info-{}",
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

        let start = start_watcher(WatcherStartInput {
            project_id: "proj-info-1".to_string(),
            root_ref: root_str.clone(),
        })
        .unwrap();
        assert!(!start.blocked);

        let info = get_watcher_session(WatcherStopInput {
            session_id: start.session_id.clone(),
        })
        .unwrap();
        assert!(info.is_some());
        let info = info.unwrap();
        assert_eq!(info.status, "watching");
        assert_eq!(info.project_id, "proj-info-1");
        assert!(!info.dirty);

        std::fs::write(root.join("info_test.txt"), b"info test").unwrap();
        std::thread::sleep(Duration::from_millis(200));

        let info2 = get_watcher_session(WatcherStopInput {
            session_id: start.session_id.clone(),
        })
        .unwrap()
        .unwrap();
        assert!(info2.dirty || info2.queued_count > 0);

        stop_watcher(WatcherStopInput {
            session_id: start.session_id,
        })
        .unwrap();

        std::fs::remove_dir_all(&root).unwrap();
        trusted_roots().lock().unwrap().clear();
    }
}
