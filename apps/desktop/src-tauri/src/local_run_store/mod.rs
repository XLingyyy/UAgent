//! Versioned, native Windows SQLite records. This module performs no model/UE calls
//! and stores no authority to execute. Recovered runs require fresh authorization.
//! The native adapter supplies a trusted app-data directory and project identity.
#![cfg(windows)]
mod schema;
mod sqlite;

pub use legacy::{ImportReport, LegacySelection};
pub use schema::SCHEMA_VERSION;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlite::{Db, Value};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub type Result<T> = std::result::Result<T, StoreError>;
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StoreError {
    pub kind: String,
    pub message: String,
}
impl StoreError {
    fn new(kind: &str, message: &str) -> Self {
        Self {
            kind: kind.into(),
            message: message.into(),
        }
    }
    fn invalid(message: &str) -> Self {
        Self::new("invalid", message)
    }
    fn corrupt() -> Self {
        Self::new("corrupt", "record data is invalid")
    }
}
impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.kind, self.message)
    }
}
impl std::error::Error for StoreError {}
impl From<std::io::Error> for StoreError {
    fn from(_: std::io::Error) -> Self {
        Self::new("io", "local record storage I/O failed")
    }
}

#[derive(Debug, Clone, Copy)]
pub struct StoreOptions {
    pub max_database_bytes: u64,
    pub max_artifact_bytes: u64,
}
impl Default for StoreOptions {
    fn default() -> Self {
        Self {
            max_database_bytes: 512 * 1024 * 1024,
            max_artifact_bytes: 2 * 1024 * 1024 * 1024,
        }
    }
}

macro_rules! record {
    ($name:ident { $($field:ident : $ty:ty),* $(,)? }) => {
        #[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        pub struct $name { $(pub $field: $ty),* }
    }
}
mod legacy;
macro_rules! string_enum {
    ($name:ident { $($variant:ident => $text:literal),* $(,)? }) => {
        #[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
        pub enum $name { $(#[serde(rename = $text)] $variant),* }
        impl $name {
            fn as_str(self) -> &'static str { match self { $(Self::$variant => $text),* } }
            fn parse(text: &str) -> Result<Self> { match text { $($text => Ok(Self::$variant)),*, _ => Err(StoreError::corrupt()) } }
        }
    }
}
string_enum!(Role { System => "system", User => "user", Assistant => "assistant", Tool => "tool" });
string_enum!(Origin { Native => "native", HistoricalTextCopy => "historicalTextCopy" });
string_enum!(RunStatus { Created => "created", Running => "running", Paused => "paused", Succeeded => "succeeded", Failed => "failed", Cancelled => "cancelled", NeedsReconciliation => "needsReconciliation" });
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ActionStatus {
    Prepared,
    InFlight,
    Succeeded,
    Failed,
    Unknown,
    Skipped,
}

record!(Project {
    id: String,
    root: String,
    label: String,
    created_at: i64
});
record!(Session { project_id: String, id: String, title: String, created_at: i64, archived: bool, parent_id: Option<String>, origin: Origin });
record!(NewMessage {
    id: String,
    role: Role,
    body: String,
    created_at: i64
});
record!(Message {
    project_id: String,
    session_id: String,
    id: String,
    ordinal: i64,
    role: Role,
    body: String,
    created_at: i64,
    origin: Origin
});
record!(NewRun {
    id: String,
    session_id: String,
    goal: String,
    created_at: i64
});
record!(Run {
    project_id: String,
    id: String,
    session_id: String,
    goal: String,
    status: RunStatus,
    revision: i64,
    created_at: i64,
    updated_at: i64
});
// Descriptive catalog data from this app's archive, never project authority.
record!(RunHistoryEntry {
    project_id: String,
    project_label: String,
    project_root: String,
    session_id: String,
    session_title: String,
    run_id: String,
    goal: String,
    status: RunStatus,
    updated_at: i64,
    has_unresolved_effects: bool
});
record!(Step { id: String, title: String, status: ActionStatus, depends_on: Vec<String> });
record!(ToolCall { id: String, step_id: String, tool_name: String, arguments: serde_json::Value, result: Option<serde_json::Value>, status: ActionStatus });
record!(RunEvent {
    id: String,
    kind: String,
    created_at: i64,
    data: serde_json::Value
});
record!(StoredEvent {
    sequence: i64,
    event: RunEvent
});
record!(Checkpoint { next_step_id: Option<String>, reason: String, summary: String, captured_at: i64 });
record!(ChangeSet { id: String, status: ActionStatus, target_paths: Vec<String>, summary: String, diff: String });
record!(ArtifactRef {
    id: String,
    sha256: String,
    media_type: String,
    label: String
});
record!(ArtifactBlob {
    sha256: String,
    bytes: u64
});
record!(CheckpointBatch { status: RunStatus, checkpoint: Checkpoint, messages: Vec<NewMessage>, steps: Vec<Step>, tool_calls: Vec<ToolCall>, events: Vec<RunEvent>, changesets: Vec<ChangeSet>, artifacts: Vec<ArtifactRef> });
record!(RunSnapshot { run: Run, checkpoint: Option<Checkpoint>, steps: Vec<Step>, tool_calls: Vec<ToolCall>, changesets: Vec<ChangeSet>, artifacts: Vec<ArtifactRef>, requires_fresh_authorization: bool, has_unknown_external_effects: bool });
record!(StorageUsage {
    database_bytes: u64,
    wal_bytes: u64,
    journal_bytes: u64,
    artifact_bytes: u64,
    max_database_bytes: u64,
    max_artifact_bytes: u64
});
record!(ImportProvenance {
    session_id: String,
    source_sha256: String,
    source_revision: i64,
    prior_truncation: String
});

pub struct RunStore {
    db: Db,
    root: PathBuf,
    options: StoreOptions,
}

fn id(value: &str) -> Result<()> {
    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        Err(StoreError::invalid(
            "record ID must be 1..256 bytes without control characters",
        ))
    } else {
        Ok(())
    }
}
fn timestamp(value: i64) -> Result<()> {
    if value < 0 {
        Err(StoreError::invalid("timestamp must be nonnegative"))
    } else {
        Ok(())
    }
}
fn json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|_| StoreError::invalid("record is not serializable"))
}
fn decode<T: DeserializeOwned>(value: &Value) -> Result<T> {
    serde_json::from_str(&value.text()?).map_err(|_| StoreError::corrupt())
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn no_authority(value: &serde_json::Value) -> Result<()> {
    match value {
        serde_json::Value::Object(map) => {
            for (key, child) in map {
                let normalized: String = key
                    .chars()
                    .filter(|c| c.is_ascii_alphanumeric())
                    .flat_map(char::to_lowercase)
                    .collect();
                if [
                    "apikey",
                    "authorization",
                    "approval",
                    "approvaltoken",
                    "executiontoken",
                    "accesstoken",
                    "refreshtoken",
                    "password",
                    "secret",
                    "credential",
                    "credentials",
                ]
                .contains(&normalized.as_str())
                {
                    return Err(StoreError::invalid(
                        "credential or authorization fields cannot be persisted",
                    ));
                }
                no_authority(child)?;
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                no_authority(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn regular_path(path: &Path) -> Result<()> {
    use std::os::windows::fs::MetadataExt;
    // Refuse reparse points at every existing component, including parent junctions.
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(meta) if meta.file_attributes() & 0x400 != 0 => {
                return Err(StoreError::invalid(
                    "storage paths cannot traverse reparse points",
                ))
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

fn local_disk_prefix(path: &Path) -> Result<u8> {
    use std::path::{Component, Prefix};
    if path.is_absolute() {
        if let Some(Component::Prefix(prefix)) = path.components().next() {
            if let Prefix::Disk(drive) | Prefix::VerbatimDisk(drive) = prefix.kind() {
                return Ok(drive);
            }
        }
    }
    Err(StoreError::invalid(
        "path must resolve to an absolute local drive path; UNC and device aliases are unsupported",
    ))
}

/// Check the canonical existing parent before creating any missing tail. A caller
/// drive letter may resolve to UNC (for example a mapped network drive).
fn resolve_local_disk_path(path: &Path) -> Result<PathBuf> {
    use std::ffi::OsString;
    local_disk_prefix(path)?;
    regular_path(path)?;
    let mut ancestor = path;
    let mut tail: Vec<OsString> = Vec::new();
    loop {
        match fs::symlink_metadata(ancestor) {
            Ok(meta) => {
                if !tail.is_empty() && !meta.is_dir() {
                    return Err(StoreError::invalid("destination parent is not a directory"));
                }
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                tail.push(
                    ancestor
                        .file_name()
                        .ok_or_else(|| StoreError::invalid("destination has no existing parent"))?
                        .into(),
                );
                ancestor = ancestor
                    .parent()
                    .ok_or_else(|| StoreError::invalid("destination has no existing parent"))?;
            }
            Err(error) => return Err(error.into()),
        }
    }
    let mut resolved = fs::canonicalize(ancestor)?;
    local_disk_prefix(&resolved)?;
    for name in tail.into_iter().rev() {
        resolved.push(name);
    }
    Ok(resolved)
}

fn windows_component_eq(left: &std::ffi::OsStr, right: &std::ffi::OsStr) -> Result<bool> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn CompareStringOrdinal(
            left: *const u16,
            left_len: i32,
            right: *const u16,
            right_len: i32,
            ignore_case: i32,
        ) -> i32;
    }
    let left: Vec<_> = left.encode_wide().collect();
    let right: Vec<_> = right.encode_wide().collect();
    let left_len = i32::try_from(left.len())
        .map_err(|_| StoreError::invalid("destination component is too long"))?;
    let right_len = i32::try_from(right.len())
        .map_err(|_| StoreError::invalid("destination component is too long"))?;
    // Windows ordinal comparison handles case aliases without lossy Unicode conversion.
    match unsafe { CompareStringOrdinal(left.as_ptr(), left_len, right.as_ptr(), right_len, 1) } {
        2 => Ok(true),
        1 | 3 => Ok(false),
        _ => Err(StoreError::invalid("destination path comparison failed")),
    }
}

/// Resolve all existing parent components before considering a nonexistent tail.
/// The returned path is also the path used for creation: validation and creation
/// cannot disagree about `..`, drive casing, short names, or verbatim disk aliases.
fn external_destination(path: &Path, managed_root: &Path) -> Result<PathBuf> {
    use std::{os::windows::ffi::OsStrExt, path::Component};
    local_disk_prefix(managed_root)?;
    let drive = local_disk_prefix(path)?;
    let mut normalized = PathBuf::from(format!("{}:\\", char::from(drive).to_ascii_uppercase()));
    for component in path.components().skip(1) {
        match component {
            Component::RootDir | Component::CurDir => {}
            Component::ParentDir => {
                normalized.pop();
            }
            Component::Normal(name) => {
                let units: Vec<_> = name.encode_wide().collect();
                // Refuse Win32 name trimming and alternate-data-stream aliases rather
                // than validating one spelling and writing through another spelling.
                if matches!(units.last(), Some(32 | 46))
                    || units.iter().any(|unit| *unit == 0 || *unit == 58)
                {
                    return Err(StoreError::invalid(
                        "destination contains an ambiguous Windows filename",
                    ));
                }
                normalized.push(name);
            }
            Component::Prefix(_) => {
                return Err(StoreError::invalid(
                    "destination contains an unexpected path prefix",
                ))
            }
        }
    }
    let resolved = resolve_local_disk_path(&normalized)?;
    // Compare complete components (not a string prefix: `store-backup` is external).
    let mut destination_components = resolved.components();
    let mut within_root = true;
    for root_component in managed_root.components() {
        match destination_components.next() {
            Some(component)
                if windows_component_eq(component.as_os_str(), root_component.as_os_str())? => {}
            _ => {
                within_root = false;
                break;
            }
        }
    }
    if within_root {
        return Err(StoreError::invalid(
            "backup and export destinations must be outside the managed run-store directory",
        ));
    }
    regular_path(&resolved)?;
    Ok(resolved)
}

impl RunStore {
    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        Self::open_with_options(root, StoreOptions::default())
    }
    pub fn open_with_options(root: impl AsRef<Path>, options: StoreOptions) -> Result<Self> {
        let root = root.as_ref();
        local_disk_prefix(root)?;
        if options.max_database_bytes < 128 * 1024
            || options.max_database_bytes > i64::MAX as u64
            || options.max_artifact_bytes > i64::MAX as u64
        {
            return Err(StoreError::invalid("storage quota is out of range"));
        }
        let root = resolve_local_disk_path(root)?;
        fs::create_dir_all(&root)?;
        let root = fs::canonicalize(&root)?;
        local_disk_prefix(&root)?;
        for name in [
            "runs.sqlite3",
            "runs.sqlite3-journal",
            "runs.sqlite3-wal",
            "runs.sqlite3-shm",
            "artifacts",
        ] {
            regular_path(&root.join(name))?;
        }
        fs::create_dir_all(root.join("artifacts"))?;
        let db = Db::open(&root.join("runs.sqlite3"))?;
        // Reject unsupported versions before changing journal configuration.
        if db.query("PRAGMA user_version", &[])?[0][0].int()? > SCHEMA_VERSION {
            return Err(StoreError::new(
                "newerSchema",
                "database requires a newer UAgent; it was not migrated",
            ));
        }
        db.execute("PRAGMA foreign_keys=ON", &[])?;
        // Windows supplies the SQLite version (3.43.2 on the verification host).
        // Rollback journaling avoids the WAL-reset race on unpatched OS versions:
        // https://sqlite.org/wal.html#walreset . Do not silently enable WAL here.
        let mode = db.query("PRAGMA journal_mode=DELETE", &[])?;
        if !mode[0][0].text()?.eq_ignore_ascii_case("delete") {
            return Err(StoreError::new(
                "sqlite",
                "rollback journal mode is unavailable",
            ));
        }
        db.execute("PRAGMA synchronous=FULL", &[])?;
        db.execute("PRAGMA trusted_schema=OFF", &[])?;
        let page_size = db.query("PRAGMA page_size", &[])?[0][0].int()? as u64;
        let page_count = db.query("PRAGMA page_count", &[])?[0][0].int()? as u64;
        let pages = options.max_database_bytes / page_size;
        if page_count > pages {
            return Err(StoreError::new(
                "capacity",
                "existing database exceeds configured quota",
            ));
        }
        db.execute(&format!("PRAGMA max_page_count={pages}"), &[])?;
        schema::migrate(&db)?;
        Ok(Self { db, root, options })
    }
    pub fn schema_version(&self) -> Result<i64> {
        self.db.query("PRAGMA user_version", &[])?[0][0].int()
    }
    pub fn create_project(&self, project: &Project) -> Result<()> {
        id(&project.id)?;
        timestamp(project.created_at)?;
        if project.root.is_empty() {
            return Err(StoreError::invalid("project root is required"));
        }
        self.db.execute(
            "INSERT INTO projects(id,root,label,created_at) VALUES(?,?,?,?)",
            &[
                project.id.as_str().into(),
                project.root.as_str().into(),
                project.label.as_str().into(),
                project.created_at.into(),
            ],
        )?;
        Ok(())
    }
    pub fn projects(&self) -> Result<Vec<Project>> {
        self.db
            .query(
                "SELECT id,root,label,created_at FROM projects ORDER BY id",
                &[],
            )?
            .into_iter()
            .map(|r| {
                Ok(Project {
                    id: r[0].text()?,
                    root: r[1].text()?,
                    label: r[2].text()?,
                    created_at: r[3].int()?,
                })
            })
            .collect()
    }
    pub fn create_session(&self, session: &Session) -> Result<()> {
        if session.origin != Origin::Native {
            return Err(StoreError::invalid(
                "historical sessions can only be created by the importer",
            ));
        }
        self.insert_session(session)
    }
    fn insert_session(&self, session: &Session) -> Result<()> {
        id(&session.project_id)?;
        id(&session.id)?;
        timestamp(session.created_at)?;
        if let Some(parent) = &session.parent_id {
            id(parent)?;
        }
        self.db.execute("INSERT INTO sessions(project_id,id,title,created_at,archived,parent_id,origin) VALUES(?,?,?,?,?,?,?)", &[session.project_id.as_str().into(),session.id.as_str().into(),session.title.as_str().into(),session.created_at.into(),(session.archived as i64).into(),session.parent_id.as_ref().map(|s| s.as_str().into()).unwrap_or(Value::Null),session.origin.as_str().into()])?;
        Ok(())
    }
    pub fn sessions(
        &self,
        project: &str,
        include_archived: bool,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<Session>> {
        let (limit, offset) = page(limit, offset)?;
        self.db.query("SELECT id,title,created_at,archived,parent_id,origin FROM sessions WHERE project_id=? AND (?=1 OR archived=0) ORDER BY created_at,id LIMIT ? OFFSET ?", &[project.into(),(include_archived as i64).into(),limit.into(),offset.into()])?.into_iter().map(|r| Ok(Session { project_id:project.into(), id:r[0].text()?,title:r[1].text()?,created_at:r[2].int()?,archived:r[3].int()? != 0,parent_id:match &r[4] { Value::Null=>None,v=>Some(v.text()?) },origin:Origin::parse(&r[5].text()?)? })).collect()
    }
    pub fn update_session(
        &self,
        project: &str,
        session: &str,
        title: &str,
        archived: bool,
    ) -> Result<()> {
        if self.db.execute("UPDATE sessions SET title=?,archived=? WHERE project_id=? AND id=? AND origin='native'", &[title.into(),(archived as i64).into(),project.into(),session.into()])? != 1 { return Err(StoreError::new("notFoundOrReadOnly", "session is absent or is a historical text copy")); }
        Ok(())
    }
    fn writable_session(&self, project: &str, session: &str) -> Result<()> {
        let rows = self.db.query(
            "SELECT origin FROM sessions WHERE project_id=? AND id=?",
            &[project.into(), session.into()],
        )?;
        if rows.is_empty() {
            return Err(StoreError::new(
                "notFound",
                "session does not exist in this project",
            ));
        }
        if rows[0][0].text()? != "native" {
            return Err(StoreError::new(
                "readOnlyHistory",
                "branch this historical text copy into a new native session to continue",
            ));
        }
        Ok(())
    }
    pub fn append_messages(
        &self,
        project: &str,
        session: &str,
        messages: &[NewMessage],
    ) -> Result<()> {
        self.db.transaction(|| {
            self.writable_session(project, session)?;
            self.insert_messages(project, session, messages, Origin::Native)
        })
    }
    fn insert_messages(
        &self,
        project: &str,
        session: &str,
        messages: &[NewMessage],
        origin: Origin,
    ) -> Result<()> {
        let mut ordinal = self.db.query(
            "SELECT COALESCE(MAX(ordinal),0) FROM messages WHERE project_id=? AND session_id=?",
            &[project.into(), session.into()],
        )?[0][0]
            .int()?;
        for message in messages {
            id(&message.id)?;
            timestamp(message.created_at)?;
            ordinal = ordinal
                .checked_add(1)
                .ok_or_else(|| StoreError::new("capacity", "message ordinal overflow"))?;
            self.db.execute("INSERT INTO messages(project_id,session_id,id,ordinal,role,body,created_at,origin) VALUES(?,?,?,?,?,?,?,?)", &[project.into(),session.into(),message.id.as_str().into(),ordinal.into(),message.role.as_str().into(),message.body.as_str().into(),message.created_at.into(),origin.as_str().into()])?;
        }
        Ok(())
    }
    pub fn messages(
        &self,
        project: &str,
        session: &str,
        after_ordinal: i64,
        limit: usize,
    ) -> Result<Vec<Message>> {
        let (limit, _) = page(limit, 0)?;
        message_rows(project, self.db.query("SELECT session_id,id,ordinal,role,body,created_at,origin FROM messages WHERE project_id=? AND session_id=? AND ordinal>? ORDER BY ordinal LIMIT ?", &[project.into(),session.into(),after_ordinal.into(),limit.into()])?)
    }
    pub fn search_messages(
        &self,
        project: &str,
        text: &str,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<Message>> {
        let (limit, offset) = page(limit, offset)?;
        // instr is literal matching: %, _, and quotes are data, not query syntax.
        message_rows(project, self.db.query("SELECT session_id,id,ordinal,role,body,created_at,origin FROM messages WHERE project_id=? AND instr(lower(body),lower(?))>0 ORDER BY created_at,session_id,ordinal LIMIT ? OFFSET ?", &[project.into(),text.into(),limit.into(),offset.into()])?)
    }
    pub fn branch_session(
        &self,
        project: &str,
        source_session: &str,
        through_ordinal: i64,
        new_id: &str,
        title: &str,
        created_at: i64,
    ) -> Result<()> {
        id(new_id)?;
        timestamp(created_at)?;
        self.db.transaction(|| {
            let source = self.db.query("SELECT id FROM sessions WHERE project_id=? AND id=?", &[project.into(),source_session.into()])?;
            if source.is_empty() { return Err(StoreError::new("notFound", "branch source does not exist in this project")); }
            self.insert_session(&Session { project_id:project.into(),id:new_id.into(),title:title.into(),created_at,archived:false,parent_id:Some(source_session.into()),origin:Origin::Native })?;
            let rows = self.db.query("SELECT id,ordinal,role,body,created_at,origin FROM messages WHERE project_id=? AND session_id=? AND ordinal<=? ORDER BY ordinal", &[project.into(),source_session.into(),through_ordinal.into()])?;
            for row in rows {
                let message_id = format!("branch-{}", hash(format!("{project}\0{new_id}\0{}",row[0].text()?).as_bytes()));
                self.db.execute("INSERT INTO messages(project_id,session_id,id,ordinal,role,body,created_at,origin) VALUES(?,?,?,?,?,?,?,?)", &[project.into(),new_id.into(),message_id.into(),row[1].clone(),row[2].clone(),row[3].clone(),row[4].clone(),row[5].clone()])?;
            }
            Ok(())
        })
    }
    pub fn start_run(&self, project: &str, run: &NewRun) -> Result<()> {
        id(&run.id)?;
        timestamp(run.created_at)?;
        self.db.transaction(|| {
            self.writable_session(project, &run.session_id)?;
            self.db.execute("INSERT INTO runs(project_id,id,session_id,goal,status,created_at,updated_at) VALUES(?,?,?,?,'created',?,?)", &[project.into(),run.id.as_str().into(),run.session_id.as_str().into(),run.goal.as_str().into(),run.created_at.into(),run.created_at.into()])?;
            Ok(())
        })
    }
    pub fn run(&self, project: &str, run: &str) -> Result<Run> {
        let rows = self.db.query("SELECT id,session_id,goal,status,revision,created_at,updated_at FROM runs WHERE project_id=? AND id=?", &[project.into(),run.into()])?;
        let row = rows
            .first()
            .ok_or_else(|| StoreError::new("notFound", "run does not exist in this project"))?;
        run_row(project, row)
    }
    pub fn runs(
        &self,
        project: &str,
        session: &str,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<Run>> {
        let (limit, offset) = page(limit, offset)?;
        self.db.query("SELECT id,session_id,goal,status,revision,created_at,updated_at FROM runs WHERE project_id=? AND session_id=? ORDER BY created_at,id LIMIT ? OFFSET ?", &[project.into(),session.into(),limit.into(),offset.into()])?.iter().map(|r| run_row(project,r)).collect()
    }
    /// A bounded, read-only catalog across the app's own saved projects. Root strings
    /// are returned verbatim as descriptors; this query never opens a project path.
    pub fn history_runs(
        &self,
        project: Option<&str>,
        run: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<RunHistoryEntry>> {
        if let Some(project) = project { id(project)?; }
        if let Some(run) = run { id(run)?; }
        if limit == 0 || limit > 101 || offset > 1_000_000 {
            return Err(StoreError::invalid("history page is out of range"));
        }
        let filter = project.map(Value::from).unwrap_or(Value::Null);
        let run_filter = run.map(Value::from).unwrap_or(Value::Null);
        self.db.query(
            "SELECT p.id,p.label,p.root,s.id,s.title,r.id,r.goal,r.status,r.updated_at,
             (r.status='needsReconciliation' OR
              EXISTS(SELECT 1 FROM tool_calls t WHERE t.project_id=r.project_id AND t.run_id=r.id AND json_extract(t.payload,'$.status') IN ('inFlight','unknown')) OR
              EXISTS(SELECT 1 FROM steps t WHERE t.project_id=r.project_id AND t.run_id=r.id AND json_extract(t.payload,'$.status') IN ('inFlight','unknown')) OR
              EXISTS(SELECT 1 FROM changesets t WHERE t.project_id=r.project_id AND t.run_id=r.id AND json_extract(t.payload,'$.status') IN ('inFlight','unknown')))
             FROM runs r JOIN projects p ON p.id=r.project_id
             JOIN sessions s ON s.project_id=r.project_id AND s.id=r.session_id
             WHERE (? IS NULL OR r.project_id=?) AND (? IS NULL OR r.id=?)
             ORDER BY r.updated_at DESC,r.project_id,r.id LIMIT ? OFFSET ?",
            &[filter.clone(), filter, run_filter.clone(), run_filter, (limit as i64).into(), (offset as i64).into()],
        )?.into_iter().map(|row| Ok(RunHistoryEntry {
            project_id: row[0].text()?, project_label: row[1].text()?, project_root: row[2].text()?,
            session_id: row[3].text()?, session_title: row[4].text()?, run_id: row[5].text()?,
            goal: row[6].text()?, status: RunStatus::parse(&row[7].text()?)?, updated_at: row[8].int()?,
            has_unresolved_effects: row[9].int()? != 0,
        })).collect()
    }
    /// The run revision, messages, results, events, artifacts and checkpoint commit
    /// together. Write intent BEFORE external execution; persist observed result AFTER.
    /// A database transaction cannot make an external UE operation atomic.
    pub fn commit_checkpoint(
        &self,
        project: &str,
        run_id: &str,
        expected_revision: i64,
        batch: &CheckpointBatch,
    ) -> Result<i64> {
        timestamp(batch.checkpoint.captured_at)?;
        if expected_revision < 0 {
            return Err(StoreError::invalid("revision must be nonnegative"));
        }
        let next = expected_revision
            .checked_add(1)
            .ok_or_else(|| StoreError::new("capacity", "run revision overflow"))?;
        self.db.transaction(|| {
            let run = self.run(project, run_id)?;
            if run.revision != expected_revision { return Err(StoreError::new("conflict", "run revision changed; reload before writing")); }
            if matches!(run.status,RunStatus::Succeeded|RunStatus::Failed|RunStatus::Cancelled) { return Err(StoreError::new("terminalRun", "create a new run to continue a terminal task")); }
            if batch.checkpoint.captured_at < run.updated_at { return Err(StoreError::invalid("checkpoint time precedes the current run")); }
            self.insert_messages(project, &run.session_id, &batch.messages, Origin::Native)?;
            for step in &batch.steps {
                id(&step.id)?;
                for dep in &step.depends_on { id(dep)?; if dep == &step.id { return Err(StoreError::invalid("step cannot depend on itself")); } }
                self.upsert_payload("steps",project,run_id,&step.id,&json(step)?)?;
            }
            for call in &batch.tool_calls {
                id(&call.id)?; id(&call.step_id)?; id(&call.tool_name)?;
                no_authority(&call.arguments)?;
                if let Some(result) = &call.result { no_authority(result)?; }
                let existing = self.db.query("SELECT payload FROM tool_calls WHERE project_id=? AND run_id=? AND id=?", &[project.into(),run_id.into(),call.id.as_str().into()])?;
                if let Some(row) = existing.first() {
                    let original: ToolCall = decode(&row[0])?;
                    if original.step_id != call.step_id || original.tool_name != call.tool_name || original.arguments != call.arguments {
                        return Err(StoreError::invalid("tool-call identity and arguments are immutable; retries need a new call ID"));
                    }
                }
                self.db.execute("INSERT INTO tool_calls(project_id,run_id,id,step_id,payload) VALUES(?,?,?,?,?) ON CONFLICT(project_id,run_id,id) DO UPDATE SET payload=excluded.payload WHERE tool_calls.step_id=excluded.step_id", &[project.into(),run_id.into(),call.id.as_str().into(),call.step_id.as_str().into(),json(call)?.into()])?;
                // A tool-call ID cannot be reassigned to another step.
                if self.db.query("SELECT step_id FROM tool_calls WHERE project_id=? AND run_id=? AND id=?", &[project.into(),run_id.into(),call.id.as_str().into()])?[0][0].text()? != call.step_id { return Err(StoreError::invalid("tool-call step identity cannot change")); }
            }
            let mut sequence = self.db.query("SELECT COALESCE(MAX(sequence),0) FROM events WHERE project_id=? AND run_id=?", &[project.into(),run_id.into()])?[0][0].int()?;
            for event in &batch.events {
                id(&event.id)?; id(&event.kind)?; timestamp(event.created_at)?; no_authority(&event.data)?;
                sequence = sequence.checked_add(1).ok_or_else(|| StoreError::new("capacity", "event sequence overflow"))?;
                self.db.execute("INSERT INTO events(project_id,run_id,id,sequence,payload) VALUES(?,?,?,?,?)", &[project.into(),run_id.into(),event.id.as_str().into(),sequence.into(),json(event)?.into()])?;
            }
            for change in &batch.changesets { id(&change.id)?; self.upsert_payload("changesets",project,run_id,&change.id,&json(change)?)?; }
            for artifact in &batch.artifacts {
                id(&artifact.id)?;
                if !valid_hash(&artifact.sha256) { return Err(StoreError::invalid("invalid artifact digest")); }
                let blobs = self.db.query("SELECT bytes FROM artifact_blobs WHERE project_id=? AND sha256=?", &[project.into(),artifact.sha256.as_str().into()])?;
                let row = blobs.first().ok_or_else(||StoreError::new("constraint","artifact must be staged in this project before attaching"))?;
                verify_blob(&self.blob_path(project,&artifact.sha256)?, &artifact.sha256, row[0].int()? as u64)?;
                self.db.execute("INSERT INTO artifact_refs(project_id,run_id,id,sha256,payload) VALUES(?,?,?,?,?)", &[project.into(),run_id.into(),artifact.id.as_str().into(),artifact.sha256.as_str().into(),json(artifact)?.into()])?;
            }
            // Preserve the complete immutable batch as well as the normalized view.
            // Later step/result updates cannot erase earlier observations.
            self.db.execute("INSERT INTO checkpoints(project_id,run_id,revision,payload) VALUES(?,?,?,?)", &[project.into(),run_id.into(),next.into(),json(batch)?.into()])?;
            if self.db.execute("UPDATE runs SET revision=?,status=?,updated_at=? WHERE project_id=? AND id=? AND revision=?", &[next.into(),batch.status.as_str().into(),batch.checkpoint.captured_at.into(),project.into(),run_id.into(),expected_revision.into()])? != 1 { return Err(StoreError::new("conflict", "run revision changed")); }
            Ok(next)
        })
    }
    fn upsert_payload(
        &self,
        table: &str,
        project: &str,
        run: &str,
        id: &str,
        payload: &str,
    ) -> Result<()> {
        // `table` is only ever a static name at the two internal call sites.
        debug_assert!(["steps", "changesets"].contains(&table));
        self.db.execute(&format!("INSERT INTO {table}(project_id,run_id,id,payload) VALUES(?,?,?,?) ON CONFLICT(project_id,run_id,id) DO UPDATE SET payload=excluded.payload"), &[project.into(),run.into(),id.into(),payload.into()])?;
        Ok(())
    }
    fn payloads<T: DeserializeOwned>(
        &self,
        table: &str,
        project: &str,
        run: &str,
    ) -> Result<Vec<T>> {
        debug_assert!(["steps", "tool_calls", "changesets", "artifact_refs"].contains(&table));
        self.db
            .query(
                &format!("SELECT payload FROM {table} WHERE project_id=? AND run_id=? ORDER BY id"),
                &[project.into(), run.into()],
            )?
            .iter()
            .map(|r| decode(&r[0]))
            .collect()
    }
    pub fn events(
        &self,
        project: &str,
        run: &str,
        after_sequence: i64,
        limit: usize,
    ) -> Result<Vec<StoredEvent>> {
        let (limit, _) = page(limit, 0)?;
        self.db.query("SELECT sequence,payload FROM events WHERE project_id=? AND run_id=? AND sequence>? ORDER BY sequence LIMIT ?", &[project.into(),run.into(),after_sequence.into(),limit.into()])?.iter().map(|r| Ok(StoredEvent { sequence:r[0].int()?,event:decode(&r[1])? })).collect()
    }
    pub fn checkpoint_batch(
        &self,
        project: &str,
        run: &str,
        revision: i64,
    ) -> Result<Option<CheckpointBatch>> {
        let rows = self.db.query(
            "SELECT payload FROM checkpoints WHERE project_id=? AND run_id=? AND revision=?",
            &[project.into(), run.into(), revision.into()],
        )?;
        rows.first().map(|row| decode(&row[0])).transpose()
    }
    pub fn snapshot(&self, project: &str, run: &str) -> Result<RunSnapshot> {
        // A read transaction gives one coherent revision, even with other writers.
        self.db.execute("BEGIN", &[])?;
        let result = (|| {
            let record = self.run(project, run)?;
            let rows = self.db.query(
                "SELECT payload FROM checkpoints WHERE project_id=? AND run_id=? AND revision=?",
                &[project.into(), run.into(), record.revision.into()],
            )?;
            let calls: Vec<ToolCall> = self.payloads("tool_calls", project, run)?;
            let unknown = calls
                .iter()
                .any(|c| matches!(c.status, ActionStatus::InFlight | ActionStatus::Unknown));
            Ok(RunSnapshot {
                run: record,
                checkpoint: rows
                    .first()
                    .map(|r| decode::<CheckpointBatch>(&r[0]).map(|b| b.checkpoint))
                    .transpose()?,
                steps: self.payloads("steps", project, run)?,
                tool_calls: calls,
                changesets: self.payloads("changesets", project, run)?,
                artifacts: self.payloads("artifact_refs", project, run)?,
                requires_fresh_authorization: true,
                has_unknown_external_effects: unknown,
            })
        })();
        let ended = self.db.execute("ROLLBACK", &[]);
        match result {
            Ok(value) => {
                ended?;
                Ok(value)
            }
            Err(error) => Err(error),
        }
    }
    fn blob_path(&self, project: &str, digest: &str) -> Result<PathBuf> {
        if !valid_hash(digest) {
            return Err(StoreError::invalid("invalid artifact digest"));
        }
        let path = self
            .root
            .join("artifacts")
            .join(format!("{}-{digest}.bin", hash(project.as_bytes())));
        regular_path(&path)?;
        Ok(path)
    }
    /// Stage immutable bytes, then attach the returned digest in commit_checkpoint.
    /// A crash may leave an unreferenced file; it is counted, never mistaken for a result.
    pub fn put_artifact(&self, project: &str, bytes: &[u8]) -> Result<ArtifactBlob> {
        id(project)?;
        let digest = hash(bytes);
        let length = u64::try_from(bytes.len())
            .map_err(|_| StoreError::new("capacity", "artifact is too large"))?;
        self.db.transaction(|| {
            if self.db.query("SELECT id FROM projects WHERE id=?", &[project.into()])?.is_empty() { return Err(StoreError::new("notFound","artifact project does not exist")); }
            let path = self.blob_path(project,&digest)?;
            if path.exists() {
                verify_blob(&path,&digest,length)?;
            } else {
                if self.artifact_bytes()?.checked_add(length).filter(|n| *n <= self.options.max_artifact_bytes).is_none() { return Err(StoreError::new("capacity","artifact quota reached; bytes were not truncated")); }
                let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&path)?;
                if let Err(error) = file.write_all(bytes).and_then(|_|file.sync_all()) {
                    drop(file);
                    // The path is derived solely from two validated SHA-256 digests.
                    let _ = fs::remove_file(&path);
                    return Err(error.into());
                }
            }
            self.db.execute("INSERT INTO artifact_blobs(project_id,sha256,bytes) VALUES(?,?,?) ON CONFLICT(project_id,sha256) DO NOTHING", &[project.into(),digest.as_str().into(),(length as i64).into()])?;
            Ok(ArtifactBlob { sha256:digest.clone(),bytes:length })
        })
    }
    pub fn read_artifact(&self, project: &str, run: &str, reference_id: &str) -> Result<Vec<u8>> {
        let rows = self.db.query("SELECT r.sha256,b.bytes FROM artifact_refs r JOIN artifact_blobs b ON b.project_id=r.project_id AND b.sha256=r.sha256 WHERE r.project_id=? AND r.run_id=? AND r.id=?", &[project.into(),run.into(),reference_id.into()])?;
        let row = rows.first().ok_or_else(|| {
            StoreError::new(
                "notFound",
                "artifact reference does not exist in this project and run",
            )
        })?;
        let digest = row[0].text()?;
        let length = row[1].int()? as u64;
        let path = self.blob_path(project, &digest)?;
        let bytes = fs::read(path)?;
        if bytes.len() as u64 != length || hash(&bytes) != digest {
            return Err(StoreError::new(
                "corruptArtifact",
                "artifact size or digest changed",
            ));
        }
        Ok(bytes)
    }
    fn artifact_bytes(&self) -> Result<u64> {
        let mut bytes = 0u64;
        regular_path(&self.root.join("artifacts"))?;
        for entry in fs::read_dir(self.root.join("artifacts"))? {
            let entry = entry?;
            regular_path(&entry.path())?;
            let meta = entry.metadata()?;
            if !meta.is_file() {
                return Err(StoreError::invalid(
                    "unexpected directory in artifact storage",
                ));
            }
            bytes = bytes
                .checked_add(meta.len())
                .ok_or_else(|| StoreError::new("capacity", "artifact size overflow"))?;
        }
        Ok(bytes)
    }
    pub fn usage(&self) -> Result<StorageUsage> {
        Ok(StorageUsage {
            database_bytes: fs::metadata(self.root.join("runs.sqlite3"))?.len(),
            wal_bytes: file_len_or_zero(&self.root.join("runs.sqlite3-wal"))?,
            journal_bytes: file_len_or_zero(&self.root.join("runs.sqlite3-journal"))?,
            artifact_bytes: self.artifact_bytes()?,
            max_database_bytes: self.options.max_database_bytes,
            max_artifact_bytes: self.options.max_artifact_bytes,
        })
    }
    /// Online SQLite backup includes committed WAL content. Immutable blobs are
    /// verified against the backed-up DB. Destination must not already exist.
    /// Only a directory with backup.complete.json is a complete backup.
    pub fn backup(&self, destination: impl AsRef<Path>) -> Result<()> {
        let destination = external_destination(destination.as_ref(), &self.root)?;
        fs::create_dir(&destination)?;
        fs::create_dir(destination.join("artifacts"))?;
        let target = Db::open(&destination.join("runs.sqlite3"))?;
        self.db.backup_to(&target)?;
        for row in target.query(
            "SELECT project_id,sha256,bytes FROM artifact_blobs ORDER BY project_id,sha256",
            &[],
        )? {
            let project = row[0].text()?;
            let digest = row[1].text()?;
            let length = row[2].int()? as u64;
            let source = self.blob_path(&project, &digest)?;
            verify_blob(&source, &digest, length)?;
            let filename = source.file_name().ok_or_else(StoreError::corrupt)?;
            let target_path = destination.join("artifacts").join(filename);
            fs::copy(&source, &target_path)?;
            fs::OpenOptions::new()
                .write(true)
                .open(&target_path)?
                .sync_all()?;
            verify_blob(&target_path, &digest, length)?;
        }
        drop(target);
        fs::OpenOptions::new()
            .write(true)
            .open(destination.join("runs.sqlite3"))?
            .sync_all()?;
        let mut complete = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(destination.join("backup.complete.json"))?;
        complete.write_all(json(&serde_json::json!({"schemaVersion":SCHEMA_VERSION,"format":"uagentRunStoreBackup","includesExecutionAuthority":false}))?.as_bytes())?;
        complete.sync_all()?;
        Ok(())
    }
    /// Read-only project export. Raw credentials/approvals are not part of the schema.
    /// Writes to a new file and returns errors rather than shortening record bodies.
    pub fn export_project_jsonl(&self, project: &str, destination: impl AsRef<Path>) -> Result<()> {
        let path = external_destination(destination.as_ref(), &self.root)?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(path)?;
        self.db.execute("BEGIN", &[])?;
        let result = (|| {
            if self
                .db
                .query("SELECT id FROM projects WHERE id=?", &[project.into()])?
                .is_empty()
            {
                return Err(StoreError::new("notFound", "export project does not exist"));
            }
            write_json_line(
                &mut file,
                &serde_json::json!({"format":"uagentProjectRecords","schemaVersion":SCHEMA_VERSION,"projectId":project,"includesExecutionAuthority":false}),
            )?;
            let tables: &[(&str,&str)] = &[
                ("projects","id,root,label,created_at"),
                ("sessions","project_id,id,title,created_at,archived,parent_id,origin"),
                ("messages","project_id,session_id,id,ordinal,role,body,created_at,origin"),
                ("runs","project_id,id,session_id,goal,status,revision,created_at,updated_at"),
                ("steps","project_id,run_id,id,payload"),
                ("tool_calls","project_id,run_id,id,step_id,payload"),
                ("events","project_id,run_id,id,sequence,payload"),
                ("checkpoints","project_id,run_id,revision,payload"),
                ("changesets","project_id,run_id,id,payload"),
                ("artifact_blobs","project_id,sha256,bytes"),
                ("artifact_refs","project_id,run_id,id,sha256,payload"),
                ("legacy_imports","project_id,source_sha256,legacy_chat_id,session_id,source_revision,prior_truncation"),
            ];
            for (table, columns) in tables {
                let project_column = if *table == "projects" {
                    "id"
                } else {
                    "project_id"
                };
                let mut offset = 0i64;
                loop {
                    let rows = self.db.query(&format!("SELECT {columns} FROM {table} WHERE {project_column}=? ORDER BY rowid LIMIT 100 OFFSET ?"), &[project.into(),offset.into()])?;
                    if rows.is_empty() {
                        break;
                    }
                    offset += rows.len() as i64;
                    for row in rows {
                        let mut record = serde_json::Map::new();
                        for (column, value) in columns.split(',').zip(row) {
                            record.insert(
                                column.into(),
                                match value {
                                    Value::Text(v) => serde_json::Value::String(v),
                                    Value::Int(v) => v.into(),
                                    Value::Null => serde_json::Value::Null,
                                },
                            );
                        }
                        write_json_line(
                            &mut file,
                            &serde_json::json!({"table":table,"record":record}),
                        )?;
                    }
                }
            }
            write_json_line(
                &mut file,
                &serde_json::json!({"exportComplete":true,"artifactBytesIncluded":false}),
            )?;
            file.sync_all()?;
            Ok(())
        })();
        let ended = self.db.execute("ROLLBACK", &[]);
        match result {
            Ok(()) => {
                ended?;
                Ok(())
            }
            Err(error) => Err(error),
        }
    }
    pub fn import_provenance(
        &self,
        project: &str,
        session: &str,
    ) -> Result<Option<ImportProvenance>> {
        let rows = self.db.query("SELECT session_id,source_sha256,source_revision,prior_truncation FROM legacy_imports WHERE project_id=? AND session_id=?", &[project.into(),session.into()])?;
        rows.first()
            .map(|r| {
                Ok(ImportProvenance {
                    session_id: r[0].text()?,
                    source_sha256: r[1].text()?,
                    source_revision: r[2].int()?,
                    prior_truncation: r[3].text()?,
                })
            })
            .transpose()
    }
}

fn file_len_or_zero(path: &Path) -> Result<u64> {
    match fs::metadata(path) {
        Ok(meta) => Ok(meta.len()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(error.into()),
    }
}
fn verify_blob(path: &Path, digest: &str, bytes: u64) -> Result<()> {
    regular_path(path)?;
    let file = fs::File::open(path)?;
    if file.metadata()?.len() != bytes {
        return Err(StoreError::new("corruptArtifact", "artifact size changed"));
    }
    let mut reader = std::io::BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    if format!("{:x}", hasher.finalize()) != digest {
        return Err(StoreError::new(
            "corruptArtifact",
            "artifact digest changed",
        ));
    }
    Ok(())
}
fn write_json_line(file: &mut fs::File, value: &serde_json::Value) -> Result<()> {
    file.write_all(json(value)?.as_bytes())?;
    file.write_all(b"\n")?;
    Ok(())
}

fn page(limit: usize, offset: usize) -> Result<(i64, i64)> {
    if limit == 0 || limit > 500 {
        return Err(StoreError::invalid(
            "page limit must be 1..500; record bodies are never truncated",
        ));
    }
    Ok((
        limit as i64,
        i64::try_from(offset).map_err(|_| StoreError::invalid("offset is out of range"))?,
    ))
}
fn run_row(project: &str, r: &[Value]) -> Result<Run> {
    Ok(Run {
        project_id: project.into(),
        id: r[0].text()?,
        session_id: r[1].text()?,
        goal: r[2].text()?,
        status: RunStatus::parse(&r[3].text()?)?,
        revision: r[4].int()?,
        created_at: r[5].int()?,
        updated_at: r[6].int()?,
    })
}
fn message_rows(project: &str, rows: Vec<Vec<Value>>) -> Result<Vec<Message>> {
    rows.iter()
        .map(|r| {
            Ok(Message {
                project_id: project.into(),
                session_id: r[0].text()?,
                id: r[1].text()?,
                ordinal: r[2].int()?,
                role: Role::parse(&r[3].text()?)?,
                body: r[4].text()?,
                created_at: r[5].int()?,
                origin: Origin::parse(&r[6].text()?)?,
            })
        })
        .collect()
}

#[cfg(test)]
#[path = "../../tests/local_run_store_tests.rs"]
mod tests;
