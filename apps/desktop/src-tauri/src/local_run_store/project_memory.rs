//! Project-local descriptive memory on the existing RunStore connection.
//! The caller MUST supply its managed writer fence; this leaf does not enforce
//! that integration guarantee and never opens a second store.
use super::{decode, id, json, no_authority, sqlite::Value, Result, RunStore, StoreError};
use serde::{Deserialize, Serialize};
#[path="project_memory_dispatch.rs"]
mod dispatch;
pub(crate) use dispatch::{MemoryDispatchScope,MemoryDispatchSelection,VerifiedMemoryBatch};
const MAX_SAFE: i64 = 9_007_199_254_740_991;
const MAX_PAYLOAD: usize = 24_576;

/// Apply inside schema::migrate's existing transaction; do not call from IPC.
pub(super) const V3: &[&str] = &[
    "CREATE TABLE project_memories (project_id TEXT NOT NULL, id TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0), validity TEXT NOT NULL CHECK(validity IN ('pending','valid','stale','retired')), payload TEXT NOT NULL CHECK(length(CAST(payload AS BLOB))<=24576), PRIMARY KEY(project_id,id), FOREIGN KEY(project_id) REFERENCES projects(id))",
    "PRAGMA user_version=3",
];
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct MemorySource {
    pub project_id: String, pub path: String, pub version: String, pub kind: String,
    #[serde(skip_serializing_if="Option::is_none")]
    pub freshness: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct MemoryOrigin { pub kind: String, pub session_id: Option<String>, pub message_id: Option<String> }
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct MemoryConfirmation { pub kind: String, pub confirmed_at: i64 }
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct MemoryContent {
    pub kind: String, pub body: String, pub source_refs: Vec<MemorySource>, pub share_paths: Vec<String>,
    pub priority: String, pub visibility: String, pub origin: MemoryOrigin, pub read_at: i64,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct ProjectMemory {
    pub id: String, pub project_id: String, pub kind: String, pub body: String,
    pub source_refs: Vec<MemorySource>, pub share_paths: Vec<String>, pub priority: String,
    pub visibility: String, pub origin: MemoryOrigin, pub read_at: i64,
    pub validity: String, pub revision: i64, pub confirmation: Option<MemoryConfirmation>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag="type", rename_all="camelCase", deny_unknown_fields)]
pub enum MemoryMutation { Replace { content: MemoryContent }, Confirm, MarkStale, Retire }
#[derive(Debug, Serialize)]
#[serde(rename_all="camelCase")]
pub struct MemoryPage {
    pub schema_version: u32, pub project_id: String, pub after_id: Option<String>, pub limit: usize,
    pub next_after_id: Option<String>, pub memories: Vec<ProjectMemory>,
}
fn invalid() -> StoreError { StoreError::invalid("project memory contract is invalid") }
fn safe_int(value: i64) -> Result<()> { if (0..=MAX_SAFE).contains(&value) { Ok(()) } else { Err(invalid()) } }
fn canonical_path(value: &str) -> bool {
    if value.is_empty() { return true; }
    value.len() <= 1024 && !value.chars().any(|c| c.is_control() || "\\%:<>\"|?*".contains(c))
        && value.split('/').all(|part| {
            let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
            !part.is_empty() && part != "." && part != ".." && !part.ends_with(' ') && !part.ends_with('.')
                && !matches!(stem.as_str(), "CON"|"PRN"|"AUX"|"NUL"|"COM1"|"COM2"|"COM3"|"COM4"|"COM5"|"COM6"|"COM7"|"COM8"|"COM9"|"LPT1"|"LPT2"|"LPT3"|"LPT4"|"LPT5"|"LPT6"|"LPT7"|"LPT8"|"LPT9")
        })
}

/// Borrowed from the original managed worker; never deserialized from renderer data.
#[derive(Clone,Copy)]
pub(crate) struct MemoryExecution<'a> {
    pub(crate) cancelled: &'a std::sync::atomic::AtomicBool,
    pub(crate) deadline: std::time::Instant,
    pub(crate) max_vm_instructions: u64,
}
impl<'a> MemoryExecution<'a> {
    pub(crate) fn new(cancelled:&'a std::sync::atomic::AtomicBool,owner_deadline:std::time::Instant)->Self{
        let deadline=owner_deadline.min(std::time::Instant::now()+std::time::Duration::from_millis(250));
        Self{cancelled,deadline,max_vm_instructions:250_000}
    }
    pub(crate) fn stop_reason(&self)->Option<&'static str>{
        if self.cancelled.load(std::sync::atomic::Ordering::Acquire){Some("projectMemoryCancelled")}
        else if std::time::Instant::now()>=self.deadline{Some("projectMemoryDeadline")}else{None}
    }
    pub(crate) fn check(&self)->Result<()>{
        if let Some(kind)=self.stop_reason(){Err(StoreError::new(kind,"project memory execution was interrupted"))}else{Ok(())}
    }
    #[cfg(test)]
    pub(crate) fn for_test(cancelled:&'a std::sync::atomic::AtomicBool,deadline:std::time::Instant,instructions:u64)->Self{
        Self{cancelled,deadline,max_vm_instructions:instructions}
    }
}

impl MemoryContent {
    fn validate(&self, project_id: &str) -> Result<()> {
        if !["fact","decision","todo"].contains(&self.kind.as_str()) || self.body.trim().is_empty()
            || self.body.len() > 8192 || self.body.contains('\0') || self.source_refs.len() > 8
            || self.share_paths.is_empty() || self.share_paths.len() > 8
            || self.share_paths.iter().any(|path| !canonical_path(path))
            || !["constraint","normal"].contains(&self.priority.as_str())
            || !["private","project"].contains(&self.visibility.as_str())
            || !["user","model","session"].contains(&self.origin.kind.as_str()) { return Err(invalid()); }
        safe_int(self.read_at)?;
        for value in [&self.origin.session_id, &self.origin.message_id].into_iter().flatten() { id(value)?; }
        if self.origin.kind == "session" && (self.origin.session_id.is_none() || self.origin.message_id.is_none()) { return Err(invalid()); }
        for source in &self.source_refs {
            if source.project_id != project_id || !canonical_path(&source.path) || source.version.is_empty()
                || source.version.len() > 512 || !["project_index","index_query","file_preview","tool"].contains(&source.kind.as_str())
                || source.freshness.as_ref().map(|v| v.is_empty() || v.len()>512).unwrap_or(false) { return Err(invalid()); }
        }
        no_authority(&serde_json::to_value(self).map_err(|_| invalid())?)?;
        Ok(())
    }
}
impl ProjectMemory {
    fn from_content(project_id: &str, memory_id: &str, content: MemoryContent) -> Self {
        Self { id: memory_id.into(), project_id: project_id.into(), kind: content.kind, body: content.body,
            source_refs: content.source_refs, share_paths: content.share_paths, priority: content.priority,
            visibility: content.visibility, origin: content.origin, read_at: content.read_at,
            validity: "pending".into(), revision: 1, confirmation: None }
    }
    fn content(&self) -> MemoryContent {
        MemoryContent { kind:self.kind.clone(), body:self.body.clone(), source_refs:self.source_refs.clone(),
            share_paths:self.share_paths.clone(), priority:self.priority.clone(), visibility:self.visibility.clone(),
            origin:self.origin.clone(), read_at:self.read_at }
    }
    fn validate(&self) -> Result<()> {
        id(&self.project_id)?; id(&self.id)?; self.content().validate(&self.project_id)?;
        if !(1..=MAX_SAFE).contains(&self.revision) || !["pending","valid","stale","retired"].contains(&self.validity.as_str()) { return Err(invalid()); }
        if let Some(confirmation) = &self.confirmation {
            if confirmation.kind != "user" { return Err(invalid()); }
            safe_int(confirmation.confirmed_at)?;
        }
        if self.validity == "valid" && (self.confirmation.is_none() || (self.kind=="fact" && self.source_refs.is_empty())) { return Err(invalid()); }
        Ok(())
    }
    fn payload(&self) -> Result<String> {
        self.validate()?;
        let text = json(self)?;
        if text.len()>MAX_PAYLOAD { return Err(StoreError::new("capacity","project memory payload exceeds byte budget")); }
        Ok(text)
    }
}
impl RunStore {
    fn check_memory_origin(&self, project_id: &str, origin: &MemoryOrigin) -> Result<()> {
        if let Some(session_id) = &origin.session_id {
            if self.db.query("SELECT id FROM sessions WHERE project_id=? AND id=?", &[project_id.into(),session_id.as_str().into()])?.is_empty() { return Err(StoreError::new("sourceMissing","origin session is not in this project")); }
            if let Some(message_id) = &origin.message_id {
                if self.db.query("SELECT id FROM messages WHERE project_id=? AND session_id=? AND id=?", &[project_id.into(),session_id.as_str().into(),message_id.as_str().into()])?.is_empty() { return Err(StoreError::new("sourceMissing","origin message is not in this session")); }
            }
        } else if origin.message_id.is_some() { return Err(invalid()); }
        Ok(())
    }
    // Only called inside one active memory budget. Update reuses this helper rather
    // than recursively installing another SQLite handler/transaction.
    fn project_memory_record(&self, project_id:&str,memory_id:&str)->Result<ProjectMemory>{
        id(project_id)?;id(memory_id)?;
        let rows=self.db.query("SELECT CASE WHEN length(CAST(payload AS BLOB))<=24576 THEN payload ELSE NULL END,revision,validity FROM project_memories WHERE project_id=? AND id=?",&[project_id.into(),memory_id.into()])?;
        let row=rows.first().ok_or_else(||StoreError::new("notFound","project memory was not found in this project"))?;
        let record:ProjectMemory=decode(&row[0])?;
        record.validate()?;
        if record.project_id!=project_id||record.id!=memory_id||record.revision!=row[1].int()?||record.validity!=row[2].text()?{return Err(StoreError::corrupt());}
        Ok(record)
    }
    pub(crate) fn project_memory(&self,execution:&MemoryExecution<'_>,project_id:&str,memory_id:&str)->Result<ProjectMemory>{
        self.db.with_project_memory_budget(execution,false,||{
            execution.check()?;
            let record=self.project_memory_record(project_id,memory_id)?;
            execution.check()?;
            Ok(record)
        })
    }
    pub(crate) fn project_memories(&self,execution:&MemoryExecution<'_>,project_id:&str,after_id:Option<&str>,limit:usize)->Result<MemoryPage>{
        self.db.with_project_memory_budget(execution,false,||{
            execution.check()?;id(project_id)?;if let Some(after)=after_id{id(after)?;}
            if limit==0||limit>50{return Err(invalid());}
            // Separate primary-key range queries: no nullable-cursor OR predicate.
            let (sql,params):(&str,Vec<Value>)=if let Some(after)=after_id{
                ("SELECT id,CASE WHEN length(CAST(payload AS BLOB))<=24576 THEN payload ELSE NULL END,revision,validity FROM project_memories WHERE project_id=? AND id>? ORDER BY id LIMIT ?",vec![project_id.into(),after.into(),((limit+1)as i64).into()])
            }else{
                ("SELECT id,CASE WHEN length(CAST(payload AS BLOB))<=24576 THEN payload ELSE NULL END,revision,validity FROM project_memories WHERE project_id=? ORDER BY id LIMIT ?",vec![project_id.into(),((limit+1)as i64).into()])
            };
            let rows=self.db.query(sql,&params)?;
            let has_more=rows.len()>limit;
            let mut memories=Vec::new();
            for row in rows.into_iter().take(limit){
                execution.check()?;
                let record:ProjectMemory=decode(&row[1])?;record.validate()?;
                if record.project_id!=project_id||record.id!=row[0].text()?||record.revision!=row[2].int()?||record.validity!=row[3].text()?{return Err(StoreError::corrupt());}
                memories.push(record);
            }
            execution.check()?;
            Ok(MemoryPage{schema_version:1,project_id:project_id.into(),after_id:after_id.map(str::to_string),limit,next_after_id:if has_more{memories.last().map(|memory|memory.id.clone())}else{None},memories})
        })
    }
    pub(crate) fn create_project_memory(&self,execution:&MemoryExecution<'_>,project_id:&str,memory_id:&str,content:MemoryContent)->Result<ProjectMemory>{
        self.db.with_project_memory_budget(execution,true,||{
            execution.check()?;id(project_id)?;id(memory_id)?;content.validate(project_id)?;
            self.check_memory_origin(project_id,&content.origin)?;
            let record=ProjectMemory::from_content(project_id,memory_id,content);
            let payload=record.payload()?;
            if !self.db.query("SELECT id FROM project_memories WHERE project_id=? AND id=?",&[project_id.into(),memory_id.into()])?.is_empty(){
                return Err(StoreError::new("conflict","project memory ID already exists; no duplicate was created"));
            }
            execution.check()?;
            self.db.execute("INSERT INTO project_memories(project_id,id,revision,validity,payload) VALUES(?,?,1,'pending',?)",&[project_id.into(),memory_id.into(),payload.into()])?;
            execution.check()?;
            Ok(record)
        })
    }
    pub(crate) fn update_project_memory(&self,execution:&MemoryExecution<'_>,project_id:&str,memory_id:&str,expected_revision:i64,mutation:MemoryMutation,now:i64)->Result<ProjectMemory>{
        self.db.with_project_memory_budget(execution,true,||{
            execution.check()?;safe_int(now)?;
            if !(1..MAX_SAFE).contains(&expected_revision){return Err(invalid());}
            let mut current=self.project_memory_record(project_id,memory_id)?;
            if current.revision!=expected_revision{return Err(StoreError::new("conflict","project memory changed; reload before retrying"));}
            if current.validity=="retired"{return Err(StoreError::new("retired","retired memory cannot be reactivated"));}
            match mutation{
                MemoryMutation::Replace{content}=>{
                    content.validate(project_id)?;self.check_memory_origin(project_id,&content.origin)?;
                    current=ProjectMemory::from_content(project_id,memory_id,content);
                }
                MemoryMutation::Confirm=>{
                    if current.kind=="fact"&&current.source_refs.is_empty(){return Err(StoreError::new("missingSource","a fact requires a verifiable source"));}
                    current.validity="valid".into();current.confirmation=Some(MemoryConfirmation{kind:"user".into(),confirmed_at:now});
                }
                MemoryMutation::MarkStale=>{current.validity="stale".into();}
                MemoryMutation::Retire=>{current.validity="retired".into();}
            }
            execution.check()?;current.revision=expected_revision+1;
            let changed=self.db.execute("UPDATE project_memories SET revision=?,validity=?,payload=? WHERE project_id=? AND id=? AND revision=?",&[current.revision.into(),current.validity.as_str().into(),current.payload()?.into(),project_id.into(),memory_id.into(),expected_revision.into()])?;
            if changed!=1{return Err(StoreError::new("conflict","project memory changed; no update was committed"));}
            execution.check()?;
            Ok(current)
        })
    }
}
#[cfg(test)]
#[path="project_memory_tests.rs"]
mod tests;
