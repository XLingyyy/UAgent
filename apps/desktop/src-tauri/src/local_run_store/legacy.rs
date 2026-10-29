//! Explicit import of the old checksum-chained workspace.jsonl. Never opens it
//! for writing, never imports configuration, credentials, authority, or run state.
use super::*;
use std::collections::HashSet;

record!(LegacySelection { chat_id: String });
record!(ImportReport { source_sha256: String, source_revision: i64, imported_session_ids: Vec<String>, already_imported_session_ids: Vec<String>, prior_truncation: String });

// Field order matches local_workspace.rs: it is part of the old checksum format.
// Unknown fields fail closed (including approval/execution/credential fields).
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Workspace {
    schema_version: u32,
    theme: String,
    project_roots: Vec<String>,
    selected_project_root: Option<String>,
    deepseek_configured: bool,
    chats: Vec<Chat>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Chat {
    id: String,
    title: String,
    project_label: String,
    created_at: u64,
    archived: bool,
    messages: Vec<LegacyMessage>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyMessage {
    role: String,
    text: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct VersionedWorkspace {
    revision: u64,
    workspace: Workspace,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Entry {
    previous: String,
    data: VersionedWorkspace,
    checksum: String,
}

fn historical_text_safe(text: &str) -> bool {
    let lower = text.to_ascii_lowercase();
    let normalized: String = lower
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    ![
        "sk-",
        "github_pat_",
        "ghp_",
        "bearer ",
        "api_key=",
        "api-key=",
        "password=",
        "secret=",
        "-----begin",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
        && ![
            "apikey",
            "accesstoken",
            "refreshtoken",
            "approvaltoken",
            "executiontoken",
            "authorization",
        ]
        .iter()
        .any(|marker| normalized.contains(marker))
}
impl RunStore {
    /// Import only selected chats into the caller's explicit project binding.
    /// Source bounds/integrity failures reject the whole import; nothing is clipped.
    pub fn import_legacy_jsonl(
        &self,
        project: &str,
        source: impl AsRef<Path>,
        selected: &[LegacySelection],
    ) -> Result<ImportReport> {
        id(project)?;
        if selected.is_empty() {
            return Err(StoreError::invalid(
                "explicit historical chat selection is required",
            ));
        }
        let source = source.as_ref();
        regular_path(source)?;
        let mut file = fs::File::open(source)?;
        const MAX_IMPORT_BYTES: u64 = 32 * 1024 * 1024;
        let length = file.metadata()?.len();
        if length > MAX_IMPORT_BYTES {
            return Err(StoreError::new(
                "capacity",
                "historical import exceeds 32 MiB; source was not truncated or modified",
            ));
        }
        let mut bytes = Vec::new();
        (&mut file)
            .take(MAX_IMPORT_BYTES + 1)
            .read_to_end(&mut bytes)?;
        if bytes.len() as u64 > MAX_IMPORT_BYTES {
            return Err(StoreError::new(
                "capacity",
                "historical import grew beyond its bound",
            ));
        }
        if bytes.is_empty() || bytes.last() != Some(&b'\n') {
            return Err(StoreError::new(
                "legacyIntegrity",
                "historical source is empty or has an incomplete final line",
            ));
        }
        let source_hash = hash(&bytes);
        let text = std::str::from_utf8(&bytes)
            .map_err(|_| StoreError::new("legacyIntegrity", "historical source is not UTF-8"))?;
        let mut previous = "0".repeat(64);
        let mut revision = 0u64;
        let mut latest = None;
        for line in text.lines() {
            let entry: Entry = serde_json::from_str(line).map_err(|_| {
                StoreError::new(
                    "legacyIntegrity",
                    "historical schema is invalid or contains unrecognized fields",
                )
            })?;
            let expected = hash(
                &serde_json::to_vec(&(&previous, &entry.data))
                    .map_err(|_| StoreError::corrupt())?,
            );
            if entry.data.workspace.schema_version != 1
                || entry.data.revision != revision + 1
                || entry.previous != previous
                || entry.checksum != expected
            {
                return Err(StoreError::new(
                    "legacyIntegrity",
                    "historical revision or checksum chain is invalid",
                ));
            }
            previous = entry.checksum;
            revision = entry.data.revision;
            latest = Some(entry.data.workspace);
        }
        let workspace = latest.ok_or_else(StoreError::corrupt)?;
        let revision = i64::try_from(revision).map_err(|_| {
            StoreError::new("legacyIntegrity", "historical revision is out of range")
        })?;
        let mut seen = HashSet::new();
        let mut chats = Vec::new();
        for selection in selected {
            id(&selection.chat_id)?;
            if !seen.insert(&selection.chat_id) {
                return Err(StoreError::invalid(
                    "historical chat selection contains duplicates",
                ));
            }
            let matches: Vec<_> = workspace
                .chats
                .iter()
                .filter(|chat| chat.id == selection.chat_id)
                .collect();
            if matches.len() != 1 {
                return Err(StoreError::invalid(
                    "selected historical chat is absent or ambiguous",
                ));
            }
            let chat = matches[0];
            if !historical_text_safe(&chat.title)
                || chat.messages.iter().any(|m| !historical_text_safe(&m.text))
            {
                return Err(StoreError::new("legacySensitiveText","selected historical text may contain credential or authority data; import refused without modifying its source"));
            }
            if chat.created_at > i64::MAX as u64
                || chat
                    .messages
                    .iter()
                    .any(|m| !["user", "assistant", "tool"].contains(&m.role.as_str()))
            {
                return Err(StoreError::new(
                    "legacyIntegrity",
                    "historical timestamp or role is invalid",
                ));
            }
            chats.push(chat);
        }
        self.db.transaction(|| {
            let mut report=ImportReport { source_sha256:source_hash.clone(),source_revision:revision,imported_session_ids:Vec::new(),already_imported_session_ids:Vec::new(),prior_truncation:"unknownCannotRecover".into() };
            for chat in chats {
                let existing=self.db.query("SELECT session_id FROM legacy_imports WHERE project_id=? AND source_sha256=? AND legacy_chat_id=?", &[project.into(),source_hash.as_str().into(),chat.id.as_str().into()])?;
                if let Some(row)=existing.first() { report.already_imported_session_ids.push(row[0].text()?);continue; }
                let session_id=format!("history-{}",hash(format!("{project}\0{source_hash}\0{}",chat.id).as_bytes()));
                self.insert_session(&Session { project_id:project.into(),id:session_id.clone(),title:chat.title.clone(),created_at:chat.created_at as i64,archived:chat.archived,parent_id:None,origin:Origin::HistoricalTextCopy })?;
                let messages:Vec<_>=chat.messages.iter().enumerate().map(|(index,message)|Ok(NewMessage { id:format!("history-{}",hash(format!("{session_id}\0{index}").as_bytes())),role:Role::parse(&message.role)?,body:message.text.clone(),created_at:chat.created_at as i64 })).collect::<Result<_>>()?;
                self.insert_messages(project,&session_id,&messages,Origin::HistoricalTextCopy)?;
                self.db.execute("INSERT INTO legacy_imports(project_id,source_sha256,legacy_chat_id,session_id,source_revision,prior_truncation) VALUES(?,?,?,?,?,'unknownCannotRecover')", &[project.into(),source_hash.as_str().into(),chat.id.as_str().into(),session_id.as_str().into(),revision.into()])?;
                report.imported_session_ids.push(session_id);
            }
            Ok(report)
        })
    }
}
