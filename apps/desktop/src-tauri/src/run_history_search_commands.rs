//! Read-only search in this app's managed archive. Search results confer no project authority.
#![cfg(windows)]

use crate::local_run_store::{Message, Origin, Role, RunStore, StoreError};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const MAX_QUERY_BYTES: usize = 2048;
const MAX_PREVIEW_CHARS: usize = 480;
// One search worker per app process; reject overlap instead of queueing whole-message reads.
static SEARCH_IN_FLIGHT: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistorySearchInput {
    schema_version: u32,
    project_id: String,
    query: String,
    offset: usize,
    limit: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistorySearchResult {
    schema_version: u32,
    project_id: String,
    query: String,
    offset: usize,
    limit: usize,
    has_more: bool,
    messages: Vec<HistorySearchMessage>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistorySearchMessage {
    project_id: String,
    session_id: String,
    message_id: String,
    ordinal: i64,
    role: Role,
    created_at: i64,
    origin: Origin,
    preview: String,
    preview_truncated: bool,
    body_sha256: String,
    // A candidate is checked against the actual immutable archive before navigation.
    archive_candidate: Option<ArchiveCandidate>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveCandidate {
    run_id: String,
    revision: i64,
}
fn error(kind: &str, message: &str) -> StoreError {
    StoreError { kind: kind.into(), message: message.into() }
}
fn invalid() -> StoreError {
    error("invalid", "native history search contract is invalid")
}
fn valid_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
}
fn validate(input: &HistorySearchInput) -> Result<(), StoreError> {
    if input.schema_version != 1
        || !valid_id(&input.project_id)
        || input.query.trim().is_empty()
        || input.query.len() > MAX_QUERY_BYTES
        || input.query.chars().count() > 512
        || input.query.contains('\0')
        || input.limit == 0
        || input.limit > 50
        || input.offset > 1_000_000
    {
        return Err(invalid());
    }
    Ok(())
}
fn preview(body: &str, query: &str) -> (String, bool) {
    // ASCII folding matches RunStore's SQLite lower(). Non-ASCII remains literal.
    let matched_byte = body.to_ascii_lowercase().find(&query.to_ascii_lowercase()).unwrap_or(0);
    let matched_char = body[..matched_byte].chars().count();
    let start = matched_char.saturating_sub(100);
    let value: String = body.chars().skip(start).take(MAX_PREVIEW_CHARS).collect();
    let truncated = start > 0 || body.chars().count() > value.chars().count();
    (value, truncated)
}
fn archive_candidate(store: &RunStore, message: &Message) -> Result<Option<ArchiveCandidate>, StoreError> {
    if message.origin != Origin::Native {
        return Ok(None);
    }
    // Native commits use run:message:N. Never infer a run from a session ID.
    let Some((run_id, sequence)) = message.id.rsplit_once(":message:") else {
        return Ok(None);
    };
    let Ok(sequence_number) = sequence.parse::<u64>() else {
        return Ok(None);
    };
    if !valid_id(run_id) || sequence_number == 0 || sequence_number.to_string() != sequence {
        return Ok(None);
    }
    let Some(revision) = store.history_search_run_revision(&message.project_id, run_id, &message.session_id)? else {
        return Ok(None);
    };
    if !(1..=MAX_SAFE_INTEGER).contains(&revision) { return Ok(None); }
    Ok(Some(ArchiveCandidate { run_id: run_id.into(), revision }))
}
fn search_history(store: &RunStore, input: &HistorySearchInput) -> Result<HistorySearchResult, StoreError> {
    validate(input)?;
    // The cursor checks bytes before copying each body and budgets SQLite VM work/time.
    // It returns no partial page on overflow, interruption or projection failure.
    let mut messages = Vec::with_capacity(input.limit);
    let mut has_more = false;
    store.visit_history_search_messages(&input.project_id, &input.query, input.limit + 1, input.offset, |row| {
        if messages.len() == input.limit { has_more = true; return Ok(()); }
        if row.project_id != input.project_id || !valid_id(&row.session_id) || !valid_id(&row.id)
            || !(1..=MAX_SAFE_INTEGER).contains(&row.ordinal)
            || !(0..=MAX_SAFE_INTEGER).contains(&row.created_at)
        {
            return Err(error("corrupt", "saved search message identity is invalid"));
        }
        let candidate = archive_candidate(store, row)?;
        let (preview, preview_truncated) = preview(&row.body, &input.query);
        messages.push(HistorySearchMessage {
            body_sha256: format!("{:x}", Sha256::digest(row.body.as_bytes())),
            project_id: row.project_id.clone(),
            session_id: row.session_id.clone(),
            message_id: row.id.clone(),
            ordinal: row.ordinal,
            role: row.role,
            created_at: row.created_at,
            origin: row.origin,
            preview,
            preview_truncated,
            archive_candidate: candidate,
        });
        Ok(())
    })?;
    Ok(HistorySearchResult {
        schema_version: 1,
        project_id: input.project_id.clone(),
        query: input.query.clone(),
        offset: input.offset,
        limit: input.limit,
        has_more,
        messages,
    })
}

#[tauri::command]
pub async fn search_native_run_history(
    app: tauri::AppHandle,
    input: HistorySearchInput,
) -> Result<HistorySearchResult, StoreError> {
    validate(&input)?;
    let root = crate::app_profile::resolve_app_data_dir(&app)
        .map_err(|_| error("unavailable", "native app data directory is unavailable"))?
        .join("run-store-v2");
    tauri::async_runtime::spawn_blocking(move || {
        let _search = SEARCH_IN_FLIGHT.try_lock()
            .map_err(|_| error("busy", "native history search is already in progress"))?;
        search_history(&RunStore::open(root)?, &input)
    })
        .await
        .map_err(|_| error("unavailable", "native history search worker did not complete"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_and_unbounded_queries() {
        let mut input = HistorySearchInput {
            schema_version: 1, project_id: "project".into(), query: "needle".into(), offset: 0, limit: 30,
        };
        assert!(validate(&input).is_ok());
        input.query = "  ".into();
        assert!(validate(&input).is_err());
        input.query = "中".repeat(513);
        assert!(validate(&input).is_err());
        input.query = "needle".into();
        input.limit = 51;
        assert!(validate(&input).is_err());
    }

    #[test]
    fn snippet_is_bounded_and_keeps_unicode_boundaries() {
        let body = format!("{}needle{}", "中🟢".repeat(400), "尾".repeat(400));
        let (value, truncated) = preview(&body, "NEEDLE");
        assert!(value.contains("needle"));
        assert!(value.chars().count() <= MAX_PREVIEW_CHARS);
        assert!(truncated);
    }

    #[test]
    fn sqlite_search_pages_literal_text_and_keeps_session_and_run_distinct() {
        use crate::local_run_store::{Checkpoint, CheckpointBatch, NewMessage, NewRun, Project, RunStatus, Session};
        use std::path::{Component, PathBuf, Prefix};
        struct Fixture { base: PathBuf, root: PathBuf }
        impl Drop for Fixture {
            fn drop(&mut self) {
                if self.root.parent() == Some(self.base.as_path())
                    && self.root.file_name().unwrap().to_string_lossy().starts_with("uagent-history-search-")
                {
                    let _ = std::fs::remove_dir_all(&self.root);
                }
            }
        }
        // The integrator supplies a disposable E:/G: evidence directory. Never default to C: or app data.
        let base = std::fs::canonicalize(std::env::var_os("UAGENT_HISTORY_SEARCH_TEST_ROOT")
            .expect("set UAGENT_HISTORY_SEARCH_TEST_ROOT to an existing disposable E:/G: directory")).unwrap();
        assert!(matches!(base.components().next(), Some(Component::Prefix(prefix))
            if matches!(prefix.kind(), Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) if matches!(drive.to_ascii_uppercase(), b'E' | b'G'))));
        let root = base.join(format!("uagent-history-search-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&root).unwrap();
        let fixture = Fixture { base, root };
        let store = RunStore::open(fixture.root.join("store")).unwrap();
        for project in ["A", "B"] {
            store.create_project(&Project { id: project.into(), root: format!("G:/Synthetic/{project}"), label: project.into(), created_at: 1 }).unwrap();
            for session in ["different-session", "other-session"] {
                store.create_session(&Session { project_id: project.into(), id: session.into(), title: session.into(), created_at: 1, archived: false, parent_id: None, origin: Origin::Native }).unwrap();
            }
        }
        store.start_run("A", &NewRun { id: "actual-run".into(), session_id: "different-session".into(), goal: "Synthetic search".into(), created_at: 1 }).unwrap();
        let body = serde_json::json!({ "format": "uagent.provider-message.v1", "message": { "role": "user", "content": "100% needle_ 'quoted' 中" } }).to_string();
        store.commit_checkpoint("A", "actual-run", 0, &CheckpointBatch {
            status: RunStatus::Paused,
            checkpoint: Checkpoint { next_step_id: None, reason: "synthetic".into(), summary: "synthetic".into(), captured_at: 2 },
            messages: vec![NewMessage { id: "actual-run:message:1".into(), role: Role::User, body: body.clone(), created_at: 2 }],
            steps: vec![], tool_calls: vec![], events: vec![], changesets: vec![], artifacts: vec![],
        }).unwrap();
        let other = NewMessage { id: "actual-run:message:2".into(), role: Role::User, body: "100% other".into(), created_at: 3 };
        store.append_messages("A", "other-session", &[other.clone()]).unwrap();
        store.append_messages("B", "different-session", &[other]).unwrap();
        let mut input = HistorySearchInput { schema_version: 1, project_id: "A".into(), query: "%".into(), offset: 0, limit: 1 };
        let first = search_history(&store, &input).unwrap();
        assert_eq!(first.messages.len(), 1);
        assert!(first.has_more);
        assert_eq!(first.messages[0].session_id, "different-session");
        let candidate = first.messages[0].archive_candidate.as_ref().unwrap();
        assert_eq!(candidate.run_id, "actual-run");
        assert_eq!(candidate.revision, 1);
        assert_eq!(first.messages[0].body_sha256, format!("{:x}", Sha256::digest(body.as_bytes())));
        input.offset = 1;
        let second = search_history(&store, &input).unwrap();
        assert_eq!(second.messages.len(), 1);
        assert!(!second.has_more);
        assert_eq!(second.messages[0].session_id, "other-session");
        assert!(second.messages[0].archive_candidate.is_none());
        input.offset = 0;
        input.query = "NEEDLE_ 'quoted' 中".into();
        let literal = search_history(&store, &input).unwrap();
        assert_eq!(literal.messages.len(), 1);
        assert!(!literal.has_more);
        // Even an oversized lookahead row fails the entire page; no partial page/hasMore result.
        store.append_messages("A", "different-session", &[NewMessage {
            id: "oversized-search-message".into(), role: Role::User,
            body: format!("needle{}", "x".repeat(64 * 1024)), created_at: 4,
        }]).unwrap();
        input.query = "needle".into();
        assert_eq!(search_history(&store, &input).unwrap_err().kind, "searchCapacity");
    }
}
