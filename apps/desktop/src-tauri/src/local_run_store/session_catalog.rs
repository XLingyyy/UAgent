//! Session catalog projections over the existing RunStore connection. No new database or schema.
//! Include with `pub(crate) mod session_catalog;` in local_run_store/mod.rs.
use super::{hash, id, message_rows, sqlite::Value, Message, Origin, Result, RunStore, Session, StoreError};
use serde::{Deserialize, Serialize};
#[path = "session_catalog_control.rs"]
pub(crate) mod control;
use control::CatalogControl;

pub const MAX_BRANCH_MESSAGES: i64 = 512;
pub const MAX_BRANCH_BODY_BYTES: i64 = 1024 * 1024;
pub const MAX_BRANCH_MESSAGE_BYTES: i64 = 256 * 1024;
pub const MAX_TITLE_BYTES: usize = 1024;
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const MAX_CATALOG_MESSAGE_COUNT: i64 = 10_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum SessionPatch {
    Rename { title: String, #[serde(rename = "expectedTitle")] expected_title: String },
    SetArchived { archived: bool, #[serde(rename = "expectedArchived")] expected_archived: bool },
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSession {
    #[serde(flatten)]
    pub session: Session,
    pub message_count: i64,
    pub last_ordinal: i64,
    /// Descriptive navigation identity only; absent on a new branch until it has a run.
    pub latest_run_id: Option<String>,
}

pub fn validate_title(title: &str) -> Result<()> {
    if title.trim().is_empty() || title.len() > MAX_TITLE_BYTES || title.chars().any(char::is_control) {
        return Err(StoreError::invalid("session title must be 1..1024 bytes without control characters"));
    }
    Ok(())
}
fn optional_text(value: &Value) -> Result<Option<String>> {
    match value { Value::Null => Ok(None), value => Ok(Some(value.text()?)) }
}
fn row(project: &str, data: Vec<Value>) -> Result<CatalogSession> {
    let title = data[1].text().map_err(|_| StoreError::new("catalogCapacity", "saved session title exceeds catalog budget"))?;
    let created_at = data[2].int()?;
    let message_count = data[6].int()?;
    let last_ordinal = data[7].int()?;
    if message_count > MAX_CATALOG_MESSAGE_COUNT { return Err(StoreError::new("catalogCapacity", "session has more than 10000 messages; catalog counting was stopped at its metadata budget")); }
    if !(0..=MAX_SAFE_INTEGER).contains(&created_at) || !(0..=MAX_SAFE_INTEGER).contains(&message_count)
        || !(0..=MAX_SAFE_INTEGER).contains(&last_ordinal) { return Err(StoreError::corrupt()); }
    Ok(CatalogSession {
        session: Session { project_id: project.into(), id: data[0].text()?, title, created_at,
            archived: data[3].int()? != 0, parent_id: optional_text(&data[4])?, origin: Origin::parse(&data[5].text()?)? },
        message_count, last_ordinal, latest_run_id: optional_text(&data[8])?,
    })
}
// No message body is materialized by this projection. A malformed/oversized title fails closed.
const COLUMNS: &str = "s.id,CASE WHEN length(CAST(s.title AS BLOB))<=1024 THEN s.title ELSE NULL END,
    s.created_at,s.archived,s.parent_id,s.origin,
    (SELECT COUNT(*) FROM (SELECT 1 FROM messages m WHERE m.project_id=s.project_id AND m.session_id=s.id LIMIT 10001)),
    COALESCE((SELECT MAX(ordinal) FROM messages m WHERE m.project_id=s.project_id AND m.session_id=s.id),0),
    (SELECT id FROM runs r WHERE r.project_id=s.project_id AND r.session_id=s.id ORDER BY r.updated_at DESC,r.id DESC LIMIT 1)";

impl RunStore {
    pub(crate) fn session_catalog_controlled<T>(&self, control: &CatalogControl, write_transaction: bool, work: impl FnOnce() -> Result<T>) -> Result<T> {
        self.db.with_session_catalog_budget(control, write_transaction, work)
    }
    pub(crate) fn session_catalog_page(&self, project: &str, include_archived: bool, offset: usize, limit: usize) -> Result<Vec<CatalogSession>> {
        self.session_catalog_page_matching(project, include_archived, offset, limit, "")
    }
    pub(crate) fn session_catalog_page_matching(&self, project:&str, include_archived:bool, offset:usize, limit:usize, title_query:&str)->Result<Vec<CatalogSession>> {
        id(project)?;
        if limit == 0 || limit > 51 || offset > 1_000_000 || title_query.len()>MAX_TITLE_BYTES || title_query.chars().any(char::is_control) { return Err(StoreError::invalid("session catalog page or title query is invalid")); }
        // Bound literal substring, not LIKE syntax. SQLite lower() folds ASCII only.
        let sql = format!("SELECT {COLUMNS} FROM sessions s WHERE s.project_id=? AND (?=1 OR s.archived=0) AND (?='' OR instr(lower(s.title),lower(?))>0) ORDER BY s.created_at DESC,s.id DESC LIMIT ? OFFSET ?");
        self.db.query(&sql, &[project.into(), (include_archived as i64).into(), title_query.into(), title_query.into(), (limit as i64).into(), (offset as i64).into()])?
            .into_iter().map(|data| row(project, data)).collect()
    }
    pub(crate) fn session_catalog_entry(&self, project: &str, session: &str) -> Result<CatalogSession> {
        id(project)?; id(session)?;
        let sql = format!("SELECT {COLUMNS} FROM sessions s WHERE s.project_id=? AND s.id=?");
        let mut rows = self.db.query(&sql, &[project.into(), session.into()])?;
        if rows.len() != 1 { return Err(StoreError::new("notFound", "session does not exist in this project")); }
        row(project, rows.remove(0))
    }
    pub(crate) fn session_catalog_project_exists(&self, project: &str) -> Result<bool> {
        id(project)?;
        Ok(!self.db.query("SELECT 1 FROM projects WHERE id=?", &[project.into()])?.is_empty())
    }
    // Called by the command handler under session_catalog_controlled(write_transaction=true).
    pub(crate) fn session_catalog_update(&self, project: &str, session: &str, patch: &SessionPatch) -> Result<CatalogSession> {
        id(project)?; id(session)?;
        let changed = match patch {
            SessionPatch::Rename { title, expected_title } => {
                validate_title(title)?;
                if expected_title.len() > MAX_TITLE_BYTES { return Err(StoreError::invalid("expected session title exceeds the byte budget")); }
                self.db.execute("UPDATE sessions SET title=? WHERE project_id=? AND id=? AND origin='native' AND title=?", &[title.as_str().into(),project.into(),session.into(),expected_title.as_str().into()])?
            }
            SessionPatch::SetArchived { archived, expected_archived } => self.db.execute("UPDATE sessions SET archived=? WHERE project_id=? AND id=? AND origin='native' AND archived=?", &[(*archived as i64).into(),project.into(),session.into(),(*expected_archived as i64).into()])?,
        };
        if changed != 1 {
            let saved = self.db.query("SELECT origin FROM sessions WHERE project_id=? AND id=?", &[project.into(),session.into()])?;
            if saved.is_empty() { return Err(StoreError::new("notFound", "session does not exist in this project")); }
            if saved[0][0].text()? != "native" { return Err(StoreError::new("readOnlyHistory", "historical text copies cannot be changed in place")); }
            return Err(StoreError::new("conflict", "session field changed since it was displayed; refresh before editing"));
        }
        self.session_catalog_entry(project, session)
    }
    fn session_catalog_prefix_budget(&self, project: &str, source: &str, through: i64) -> Result<usize> {
        self.db.check_session_catalog_budget()?;
        if !(0..=MAX_SAFE_INTEGER).contains(&through) { return Err(StoreError::invalid("session prefix ordinal is invalid")); }
        if self.db.query("SELECT 1 FROM sessions WHERE project_id=? AND id=?", &[project.into(),source.into()])?.is_empty() { return Err(StoreError::new("notFound", "session does not exist in this project")); }
        // The indexed scan materializes at most 513 integer metadata rows, never all messages.
        let metadata = self.db.query("SELECT ordinal,length(CAST(body AS BLOB)) FROM messages WHERE project_id=? AND session_id=? AND ordinal<=? ORDER BY ordinal LIMIT 513", &[project.into(), source.into(), through.into()])?;
        let mut bytes = 0i64;
        let mut last = 0;
        for (index, data) in metadata.iter().enumerate() {
            self.db.check_session_catalog_budget()?;
            let length = data[1].int()?;
            if length < 0 { return Err(StoreError::corrupt()); }
            bytes = bytes.checked_add(length).ok_or_else(StoreError::corrupt)?;
            if index >= MAX_BRANCH_MESSAGES as usize || length > MAX_BRANCH_MESSAGE_BYTES || bytes > MAX_BRANCH_BODY_BYTES {
                return Err(StoreError::new("branchCapacity", "session prefix exceeds 512 messages, 1 MiB total, or 256 KiB per message; no partial text is returned"));
            }
            last = data[0].int()?;
        }
        if last != through { return Err(StoreError::invalid("session prefix ordinal does not exist")); }
        Ok(metadata.len())
    }
    /// Complete bounded text for the owner's fresh task preparation, never execution state.
    pub(crate) fn session_catalog_read_prefix(&self, project: &str, session: &str, through: i64) -> Result<(CatalogSession, usize, Vec<Message>)> {
        id(project)?; id(session)?;
        let prefix_count = self.session_catalog_prefix_budget(project, session, through)?;
        let messages = message_rows(project, self.db.query("SELECT session_id,id,ordinal,role,body,created_at,origin FROM messages WHERE project_id=? AND session_id=? AND ordinal<=? ORDER BY ordinal LIMIT 513", &[project.into(), session.into(), through.into()])?)?;
        if messages.len() != prefix_count { return Err(StoreError::corrupt()); }
        Ok((self.session_catalog_entry(project, session)?, prefix_count, messages))
    }
    /// Extends the existing branch policy with a byte/count preflight INSIDE the same write
    /// transaction. Reuses this RunStore, insert_session and the existing branch ID/provenance
    /// convention. No checkpoints, runs, artifacts, approvals or execution state are copied.
    pub(crate) fn session_catalog_branch(&self, project: &str, source: &str, through: i64, new_id: &str, title: &str, created_at: i64) -> Result<CatalogSession> {
        id(project)?; id(source)?; id(new_id)?; validate_title(title)?;
        if !(0..=MAX_SAFE_INTEGER).contains(&through) || !(0..=MAX_SAFE_INTEGER).contains(&created_at) || source == new_id {
            return Err(StoreError::invalid("session branch identity or prefix is invalid"));
        }
        // The command's controlled write transaction spans this entire function.
        let prefix_count = self.session_catalog_prefix_budget(project, source, through)?;
        if !self.db.query("SELECT 1 FROM sessions WHERE project_id=? AND id=?", &[project.into(), new_id.into()])?.is_empty() {
            return Err(StoreError::new("alreadyExists", "branch ID already exists; no second copy was made"));
        }
        self.insert_session(&Session { project_id: project.into(), id: new_id.into(), title: title.into(), created_at, archived: false, parent_id: Some(source.into()), origin: Origin::Native })?;
        // Preflight and copy share BEGIN IMMEDIATE: another writer cannot expand this prefix
        // between the metadata check and this bounded SELECT. Bodies remain byte-for-byte.
        let messages = self.db.query("SELECT id,ordinal,role,body,created_at,origin FROM messages WHERE project_id=? AND session_id=? AND ordinal<=? ORDER BY ordinal LIMIT 513", &[project.into(), source.into(), through.into()])?;
        if messages.len() != prefix_count { return Err(StoreError::corrupt()); }
        for message in messages {
            self.db.check_session_catalog_budget()?;
            let message_id = format!("branch-{}", hash(format!("{project}\0{new_id}\0{}", message[0].text()?).as_bytes()));
            self.db.execute("INSERT INTO messages(project_id,session_id,id,ordinal,role,body,created_at,origin) VALUES(?,?,?,?,?,?,?,?)", &[project.into(),new_id.into(),message_id.into(),message[1].clone(),message[2].clone(),message[3].clone(),message[4].clone(),message[5].clone()])?;
        }
        self.session_catalog_entry(project, new_id)
    }
}

#[cfg(test)]
#[path = "../session_catalog_commands_tests.rs"]
mod tests;
