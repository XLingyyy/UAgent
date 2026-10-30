//! Text-only Responses discussion archive in the managed RunStore database.
//!
//! All IDs describe archive ownership, never a readable project path or tool scope.
//! The broker supplies the managed app-profile root, a fresh native run/conversation
//! binding, and messages from the exact approved request. This module neither reads
//! a project nor restores credentials, approvals, provider continuations or an
//! executable coordinator. Reopening history does not reopen an archive for writes.
#![cfg(windows)]

use crate::local_run_store::{
    Checkpoint, CheckpointBatch, NewMessage, NewRun, Origin, Project, Role, RunEvent, RunStatus,
    RunStore, Session,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_MESSAGE_BYTES: usize = 1_048_576;
const MAX_REQUEST_BYTES: usize = 1_048_576;
const MAX_REQUEST_MESSAGES: usize = 2_048;
const MAX_ARCHIVE_MESSAGES: usize = 4_096;
const MAX_ARCHIVE_BYTES: usize = 8_388_608;
const MAX_REQUESTS: usize = 128;
const ARCHIVE_FORMAT: &str = "uagent.responses-chat-archive.v1";
const GOAL: &str = "Discussion";

pub(crate) type Result<T> = std::result::Result<T, StoreError>;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoreError {
    pub kind: String,
    pub message: String,
}
impl StoreError {
    fn new(kind: &str) -> Self {
        Self {
            kind: kind.into(),
            message: match kind {
                "invalid" => "native discussion archive input is invalid",
                "capacity" => "native discussion archive limit exceeded; no data was truncated",
                "conflict" => "native discussion archive ownership, request or revision changed",
                "closed" => "native discussion archive is closed",
                "busy" => "native discussion archive storage is busy",
                _ => "native discussion archive storage failed; no success was recorded",
            }
            .into(),
        }
    }
}
impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.kind, self.message)
    }
}
impl std::error::Error for StoreError {}
impl From<crate::local_run_store::StoreError> for StoreError {
    fn from(error: crate::local_run_store::StoreError) -> Self {
        // Never echo SQL, paths, native request text or transport diagnostics.
        Self::new(&error.kind)
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveAck {
    pub revision: i64,
    pub message_count: usize,
}

/// Unknown usage stays unknown: no synthetic zero counts are written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum UsageStatus {
    Unknown,
    Reported {
        input_tokens: u64,
        output_tokens: u64,
        total_tokens: Option<u64>,
    },
}
impl UsageStatus {
    fn payload(&self, request_id: &str) -> Result<Value> {
        let mut payload = json!({"requestId":request_id,"usageStatus":"unknown"});
        if let Self::Reported {
            input_tokens,
            output_tokens,
            total_tokens,
        } = self
        {
            if *input_tokens > MAX_SAFE_INTEGER
                || *output_tokens > MAX_SAFE_INTEGER
                || total_tokens.is_some_and(|total| total > MAX_SAFE_INTEGER)
            {
                return Err(StoreError::new("invalid"));
            }
            payload["usageStatus"] = json!("reported");
            payload["usage"] = json!({"inputTokens":input_tokens,"outputTokens":output_tokens});
            if let Some(total) = total_tokens {
                payload["usage"]["totalTokens"] = json!(total);
            }
        }
        Ok(payload)
    }
}

#[derive(Clone)]
struct Pending {
    id: String,
    messages: Vec<Value>,
    partial_text: String,
    next_delta: u32,
    last_delta: Option<String>,
}
#[derive(Clone)]
struct Completed {
    id: String,
    assistant: String,
    usage: UsageStatus,
}
#[derive(Clone, Copy, PartialEq, Eq)]
enum RequestStatus {
    Pending,
    Received,
    Completed,
    Failed,
    Cancelled,
}
impl RequestStatus {
    fn text(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Received => "received",
            Self::Completed => "completed",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

/// Data-only, Send-compatible archive handle; each operation opens a short-lived
/// RunStore connection and commits through its existing revision comparison.
/// The broker must serialize calls and dispatch only after begin_request succeeds.
pub(crate) struct ChatArchive {
    root: PathBuf,
    project_namespace: String,
    conversation_id: String,
    run_id: String,
    provider_id: String,
    model_id: String,
    archive_format: &'static str,
    logical_project_id: Option<String>,
    revision: i64,
    message_count: usize,
    message_bytes: usize,
    event_bytes: usize,
    sequence: i64,
    created_at: i64,
    updated_at: i64,
    requests: HashSet<String>,
    pending: Option<Pending>,
    last_request_id: Option<String>,
    last_request_status: Option<RequestStatus>,
    last_completion: Option<Completed>,
    closed: bool,
}

fn id(value: &str, maximum: usize) -> Result<()> {
    if value.trim().is_empty() || value.len() > maximum || value.chars().any(char::is_control) {
        return Err(StoreError::new("invalid"));
    }
    Ok(())
}
fn now() -> Result<i64> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| StoreError::new("invalid"))?
        .as_millis();
    if millis > MAX_SAFE_INTEGER as u128 {
        return Err(StoreError::new("invalid"));
    }
    Ok(millis as i64)
}
fn encoded_bytes(value: &impl Serialize) -> Result<usize> {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .map_err(|_| StoreError::new("invalid"))
}
fn validate_messages(messages: &[Value]) -> Result<()> {
    if messages.is_empty() || messages.len() > MAX_REQUEST_MESSAGES {
        return Err(StoreError::new(if messages.is_empty() {
            "invalid"
        } else {
            "capacity"
        }));
    }
    for value in messages {
        let object = value
            .as_object()
            .ok_or_else(|| StoreError::new("invalid"))?;
        // In particular, reject tool/function calls, names, headers and credential
        // metadata even if their value is null or an empty array. Content is text.
        if object.len() != 2 || !object.contains_key("role") || !object.contains_key("content") {
            return Err(StoreError::new("invalid"));
        }
        if !matches!(
            object["role"].as_str(),
            Some("system" | "developer" | "user" | "assistant")
        ) {
            return Err(StoreError::new("invalid"));
        }
        let content = object["content"]
            .as_str()
            .ok_or_else(|| StoreError::new("invalid"))?;
        if content.len() > MAX_MESSAGE_BYTES {
            return Err(StoreError::new("capacity"));
        }
    }
    if encoded_bytes(&messages)? > MAX_REQUEST_BYTES {
        return Err(StoreError::new("capacity"));
    }
    Ok(())
}
fn context_length(messages: &[Value]) -> usize {
    messages
        .iter()
        .take_while(|message| matches!(message["role"].as_str(), Some("system" | "developer")))
        .count()
}
fn run_status_text(status: RunStatus) -> &'static str {
    match status {
        RunStatus::Created => "created",
        RunStatus::Running => "running",
        RunStatus::Paused => "paused",
        RunStatus::Succeeded => "succeeded",
        RunStatus::Failed => "failed",
        RunStatus::Cancelled => "cancelled",
        RunStatus::NeedsReconciliation => "needsReconciliation",
    }
}

impl ChatArchive {
    pub(crate) fn start(
        root: &Path,
        project_namespace: &str,
        conversation_id: &str,
        native_run_id: &str,
        provider_id: &str,
        model_id: &str,
    ) -> Result<Self> {
        Self::start_with_logical_project(
            root,
            project_namespace,
            conversation_id,
            native_run_id,
            provider_id,
            model_id,
            None,
        )
    }

    /// `root` must come from native app-profile resolution, never a path DTO.
    /// `project_namespace` is a broker-owned chat namespace, not the project ID
    /// used for executable project records. Existing runs are always rejected.
    pub(crate) fn start_with_logical_project(
        root: &Path,
        project_namespace: &str,
        conversation_id: &str,
        native_run_id: &str,
        provider_id: &str,
        model_id: &str,
        logical_project_id: Option<&str>,
    ) -> Result<Self> {
        for value in [project_namespace, conversation_id, provider_id, model_id] {
            id(value, 256)?;
        }
        // Leave room for native-generated message/event suffixes in RunStore IDs.
        id(native_run_id, 192)?;
        if let Some(project_id) = logical_project_id {
            id(project_id, 256)?;
        }
        let store = RunStore::open(root)?;
        match store.run(project_namespace, native_run_id) {
            Ok(_) => return Err(StoreError::new("conflict")),
            Err(error) if error.kind == "notFound" => {}
            Err(error) => return Err(error.into()),
        }
        let created_at = now()?;
        let marker = if logical_project_id.is_none() {
            "conversation://local"
        } else {
            "conversation://chat"
        };
        if let Some(project) = store
            .projects()?
            .into_iter()
            .find(|project| project.id == project_namespace)
        {
            // Never overwrite an executable project's path descriptor.
            if project.root != marker || project.label != "Discussion archive" {
                return Err(StoreError::new("conflict"));
            }
        } else {
            store.create_project(&Project {
                id: project_namespace.into(),
                root: marker.into(),
                label: "Discussion archive".into(),
                created_at,
            })?;
        }
        let mut offset = 0;
        let mut found_session = false;
        loop {
            let sessions = store.sessions(project_namespace, true, 500, offset)?;
            if let Some(session) = sessions
                .iter()
                .find(|session| session.id == conversation_id)
            {
                if session.origin != Origin::Native
                    || session.parent_id.is_some()
                    || session.archived
                {
                    return Err(StoreError::new("conflict"));
                }
                found_session = true;
                break;
            }
            if sessions.len() < 500 {
                break;
            }
            offset += 500;
            if offset > 10_000 {
                return Err(StoreError::new("capacity"));
            }
        }
        if !found_session {
            store.create_session(&Session {
                project_id: project_namespace.into(),
                id: conversation_id.into(),
                title: GOAL.into(),
                created_at,
                archived: false,
                parent_id: None,
                origin: Origin::Native,
            })?;
        }
        if let Err(error) = store.start_run(
            project_namespace,
            &NewRun {
                id: native_run_id.into(),
                session_id: conversation_id.into(),
                goal: GOAL.into(),
                created_at,
            },
        ) {
            if store.run(project_namespace, native_run_id).is_ok() {
                return Err(StoreError::new("conflict"));
            }
            return Err(error.into());
        }
        Ok(Self {
            root: root.into(),
            project_namespace: project_namespace.into(),
            conversation_id: conversation_id.into(),
            run_id: native_run_id.into(),
            provider_id: provider_id.into(),
            model_id: model_id.into(),
            archive_format: ARCHIVE_FORMAT,
            logical_project_id: logical_project_id.map(str::to_owned),
            revision: 0,
            message_count: 0,
            message_bytes: 0,
            event_bytes: 0,
            sequence: 0,
            created_at,
            updated_at: created_at,
            requests: HashSet::new(),
            pending: None,
            last_request_id: None,
            last_request_status: None,
            last_completion: None,
            closed: false,
        })
    }

    pub(crate) fn start_deepseek(
        root: &Path,
        namespace: &str,
        conversation: &str,
        run: &str,
        project: Option<&str>,
    ) -> Result<Self> {
        let mut archive = Self::start_with_logical_project(
            root,
            namespace,
            conversation,
            run,
            "deepseek",
            "deepseek-flash",
            project,
        )?;
        archive.archive_format = "uagent.deepseek-chat-archive.v2";
        Ok(archive)
    }

    fn ack(&self) -> ArchiveAck {
        ArchiveAck {
            revision: self.revision,
            message_count: self.message_count,
        }
    }
    fn open_for_write(&self) -> Result<()> {
        if self.closed {
            Err(StoreError::new("closed"))
        } else {
            Ok(())
        }
    }
    fn messages(&self, values: &[Value], timestamp: i64) -> Result<Vec<NewMessage>> {
        if self.message_count.saturating_add(values.len()) > MAX_ARCHIVE_MESSAGES {
            return Err(StoreError::new("capacity"));
        }
        values
            .iter()
            .enumerate()
            .map(|(index, value)| {
                let role = match value["role"].as_str() {
                    Some("system" | "developer") => Role::System,
                    Some("user") => Role::User,
                    Some("assistant") => Role::Assistant,
                    _ => return Err(StoreError::new("invalid")),
                };
                let body = serde_json::to_string(
                    &json!({"format":"uagent.provider-message.v1","message":value}),
                )
                .map_err(|_| StoreError::new("invalid"))?;
                Ok(NewMessage {
                    id: format!("{}:message:{}", self.run_id, self.message_count + index + 1),
                    role,
                    body,
                    created_at: timestamp,
                })
            })
            .collect()
    }

    /// Persist intent before dispatch. `exact_messages` is the complete text-only
    /// message array extracted from the approved request, with no transport data.
    /// Actual selected history/instructions may vary between requests. The full
    /// array is an immutable event; its trailing user block is the current input,
    /// including the typed question and any explicitly selected attachment text.
    pub(crate) fn begin_request(
        &mut self,
        logical_request_id: &str,
        exact_messages: &[Value],
    ) -> Result<ArchiveAck> {
        self.open_for_write()?;
        id(logical_request_id, 512)?;
        validate_messages(exact_messages)?;
        if let Some(pending) = &self.pending {
            return if pending.id == logical_request_id && pending.messages == exact_messages {
                Ok(self.ack())
            } else {
                Err(StoreError::new("conflict"))
            };
        }
        if self.requests.contains(logical_request_id) {
            return Err(StoreError::new("conflict"));
        }
        if self.requests.len() >= MAX_REQUESTS {
            return Err(StoreError::new("capacity"));
        }
        let current_input_at = exact_messages
            .iter()
            .rposition(|message| message["role"] != "user")
            .map_or(0, |index| index + 1);
        let current_input = &exact_messages[current_input_at..];
        if current_input.is_empty() {
            return Err(StoreError::new("invalid"));
        }
        // Approved history can be bounded, excerpted or use different instructions.
        // Never replace archived bodies with that selection. A current typed user
        // may be followed by selected attachments in consecutive user messages.
        let mut appended = if self.requests.is_empty() {
            exact_messages[..context_length(exact_messages)].to_vec()
        } else {
            Vec::new()
        };
        appended.extend_from_slice(current_input);
        let timestamp = now()?.max(self.updated_at);
        let messages = self.messages(&appended, timestamp)?;
        let ack = self.commit(
            messages,
            vec![
                (
                    "model_started",
                    json!({"requestId":logical_request_id,"messages":exact_messages,"contextEligible":current_input.len()==1}),
                ),
                (
                    "status_changed",
                    json!({"status":"running","reason":"discussion request started"}),
                ),
            ],
            RunStatus::Running,
            Some(logical_request_id),
            Some(RequestStatus::Pending),
            self.requests.len() + 1,
            timestamp,
        )?;
        self.requests.insert(logical_request_id.into());
        self.pending = Some(Pending {
            id: logical_request_id.into(),
            messages: exact_messages.to_vec(),
            partial_text: String::new(),
            next_delta: 0,
            last_delta: None,
        });
        self.last_request_id = Some(logical_request_id.into());
        self.last_request_status = Some(RequestStatus::Pending);
        self.last_completion = None;
        Ok(ack)
    }

    /// Persist an observed, already-redacted delta before exposing it to the UI.
    /// It is display evidence only, never a completed assistant/context message.
    pub(crate) fn append_text_delta(
        &mut self,
        request_id: &str,
        index: u32,
        text: &str,
    ) -> Result<ArchiveAck> {
        self.open_for_write()?;
        let pending = self
            .pending
            .as_ref()
            .ok_or_else(|| StoreError::new("conflict"))?;
        if pending.id != request_id {
            return Err(StoreError::new("conflict"));
        }
        if index.checked_add(1) == Some(pending.next_delta)
            && pending.last_delta.as_deref() == Some(text)
        {
            return Ok(self.ack());
        }
        if index != pending.next_delta
            || index >= 4096
            || text.is_empty()
            || text.len() > 65536
            || pending.partial_text.len().saturating_add(text.len()) > MAX_MESSAGE_BYTES
        {
            return Err(StoreError::new("invalid"));
        }
        let timestamp = now()?.max(self.updated_at);
        let ack = self.commit(
            Vec::new(),
            vec![(
                "model_text_delta",
                json!({"requestId":request_id,"index":index,"text":text}),
            )],
            RunStatus::Running,
            Some(request_id),
            Some(RequestStatus::Pending),
            self.requests.len(),
            timestamp,
        )?;
        let pending = self
            .pending
            .as_mut()
            .ok_or_else(|| StoreError::new("conflict"))?;
        pending.partial_text.push_str(text);
        pending.last_delta = Some(text.into());
        pending.next_delta += 1;
        Ok(ack)
    }

    /// Call only after the native request is successful and continuation saving
    /// has succeeded. Empty assistant text is preserved exactly, not fabricated.
    pub(crate) fn complete_request(
        &mut self,
        logical_request_id: &str,
        assistant: &str,
        usage: UsageStatus,
    ) -> Result<ArchiveAck> {
        self.open_for_write()?;
        if self.pending.is_none() {
            return if self.last_completion.as_ref().is_some_and(|completed| {
                completed.id == logical_request_id
                    && completed.assistant == assistant
                    && completed.usage == usage
            }) {
                Ok(self.ack())
            } else {
                Err(StoreError::new("conflict"))
            };
        }
        let pending = self
            .pending
            .as_ref()
            .ok_or_else(|| StoreError::new("conflict"))?;
        if pending.id != logical_request_id {
            return Err(StoreError::new("conflict"));
        }
        if pending.next_delta > 0 && pending.partial_text != assistant {
            return Err(StoreError::new("conflict"));
        }
        if assistant.len() > MAX_MESSAGE_BYTES {
            return Err(StoreError::new("capacity"));
        }
        // Provider output durability is separate from terminal runtime delivery.
        let delivery_status = if self.archive_format == "uagent.deepseek-chat-archive.v2" {
            RequestStatus::Received
        } else {
            RequestStatus::Completed
        };
        let payload = usage.payload(logical_request_id)?;
        let timestamp = now()?.max(self.updated_at);
        let assistant_message = json!({"role":"assistant","content":assistant});
        let messages = self.messages(std::slice::from_ref(&assistant_message), timestamp)?;
        let ack = self.commit(
            messages,
            vec![
                ("model_completed", payload),
                (
                    "status_changed",
                    json!({"status":"paused","reason":"discussion request completed"}),
                ),
            ],
            RunStatus::Paused,
            Some(logical_request_id),
            Some(delivery_status),
            self.requests.len(),
            timestamp,
        )?;
        self.pending = None;
        self.last_request_status = Some(delivery_status);
        self.last_completion = Some(Completed {
            id: logical_request_id.into(),
            assistant: assistant.into(),
            usage,
        });
        Ok(ack)
    }

    /// Data-only receipt, issued only after the runtime task is terminal-completed.
    /// If this transaction fails, received text stays readable but context stays ineligible.
    pub(crate) fn confirm_delivery(&mut self, request_id: &str) -> Result<ArchiveAck> {
        self.open_for_write()?;
        if self.archive_format != "uagent.deepseek-chat-archive.v2"
            || self.pending.is_some()
            || self.last_request_id.as_deref() != Some(request_id)
            || self.last_completion.is_none()
        {
            return Err(StoreError::new("conflict"));
        }
        if self.last_request_status == Some(RequestStatus::Completed) {
            return Ok(self.ack());
        }
        if self.last_request_status != Some(RequestStatus::Received) {
            return Err(StoreError::new("conflict"));
        }
        let timestamp = now()?.max(self.updated_at);
        let ack = self.commit(
            Vec::new(),
            vec![(
                "status_changed",
                json!({"status":"paused","reason":"runtime discussion delivery confirmed"}),
            )],
            RunStatus::Paused,
            Some(request_id),
            Some(RequestStatus::Completed),
            self.requests.len(),
            timestamp,
        )?;
        self.last_request_status = Some(RequestStatus::Completed);
        Ok(ack)
    }

    /// Records the actual native failure/cancellation; never appends an assistant
    /// message or model_completed event and never changes previous turn bodies.
    pub(crate) fn fail_request(
        &mut self,
        logical_request_id: &str,
        cancelled: bool,
    ) -> Result<ArchiveAck> {
        self.open_for_write()?;
        let status = if cancelled {
            RequestStatus::Cancelled
        } else {
            RequestStatus::Failed
        };
        if self.pending.is_none() {
            return if self.last_request_id.as_deref() == Some(logical_request_id)
                && self.last_request_status == Some(status)
            {
                Ok(self.ack())
            } else {
                Err(StoreError::new("conflict"))
            };
        }
        if self.pending.as_ref().map(|pending| pending.id.as_str()) != Some(logical_request_id) {
            return Err(StoreError::new("conflict"));
        }
        let timestamp = now()?.max(self.updated_at);
        let reason = if cancelled {
            "native discussion request cancelled"
        } else {
            "native discussion request failed"
        };
        let ack = self.commit(
            Vec::new(),
            vec![("status_changed", json!({"status":"paused","reason":reason}))],
            RunStatus::Paused,
            Some(logical_request_id),
            Some(status),
            self.requests.len(),
            timestamp,
        )?;
        self.pending = None;
        self.last_request_status = Some(status);
        self.last_completion = None;
        Ok(ack)
    }

    /// Full provider output can be durable before UI delivery finishes. A Stop or
    /// local delivery failure in that interval preserves bytes but retracts this
    /// request's eligibility for completed-context selection.
    pub(crate) fn fail_delivery(
        &mut self,
        request_id: &str,
        cancelled: bool,
    ) -> Result<ArchiveAck> {
        if self.archive_format != "uagent.deepseek-chat-archive.v2"
            || self.pending.is_some()
            || self.last_request_id.as_deref() != Some(request_id)
            || self.last_completion.is_none()
        {
            return self.fail_request(request_id, cancelled);
        }
        self.open_for_write()?;
        let status = if cancelled {
            RequestStatus::Cancelled
        } else {
            RequestStatus::Failed
        };
        let timestamp = now()?.max(self.updated_at);
        let ack = self.commit(
            Vec::new(),
            vec![(
                "status_changed",
                json!({"status":"paused","reason":"discussion response delivery not completed"}),
            )],
            RunStatus::Paused,
            Some(request_id),
            Some(status),
            self.requests.len(),
            timestamp,
        )?;
        self.last_request_status = Some(status);
        self.last_completion = None;
        Ok(ack)
    }

    /// Finalizes a conversation when the broker closes/revokes its native binding.
    /// A still-pending request is cancelled, never reported as completed.
    pub(crate) fn finish_conversation(&mut self) -> Result<ArchiveAck> {
        if self.closed {
            return Ok(self.ack());
        }
        let (status, last_status) = match self.last_request_status {
            Some(RequestStatus::Completed) if self.pending.is_none() => {
                (RunStatus::Succeeded, Some(RequestStatus::Completed))
            }
            Some(RequestStatus::Failed) if self.pending.is_none() => {
                (RunStatus::Failed, Some(RequestStatus::Failed))
            }
            _ => (
                RunStatus::Cancelled,
                self.last_request_status.map(|_| RequestStatus::Cancelled),
            ),
        };
        let request_id = self.last_request_id.clone();
        let timestamp = now()?.max(self.updated_at);
        let ack = self.commit(
            Vec::new(),
            vec![(
                "status_changed",
                json!({"status":run_status_text(status),
            "reason":"native discussion conversation closed"}),
            )],
            status,
            request_id.as_deref(),
            last_status,
            self.requests.len(),
            timestamp,
        )?;
        self.pending = None;
        self.last_request_status = last_status;
        self.closed = true;
        Ok(ack)
    }

    fn commit(
        &mut self,
        messages: Vec<NewMessage>,
        payloads: Vec<(&str, Value)>,
        status: RunStatus,
        request_id: Option<&str>,
        request_status: Option<RequestStatus>,
        request_count: usize,
        timestamp: i64,
    ) -> Result<ArchiveAck> {
        let added_message_bytes = messages.iter().try_fold(0usize, |sum, message| {
            sum.checked_add(message.body.len())
                .ok_or_else(|| StoreError::new("capacity"))
        })?;
        let next_message_bytes = self
            .message_bytes
            .checked_add(added_message_bytes)
            .ok_or_else(|| StoreError::new("capacity"))?;
        if next_message_bytes > MAX_ARCHIVE_BYTES {
            return Err(StoreError::new("capacity"));
        }
        let mut sequence = self.sequence;
        let mut events = Vec::new();
        for (kind, payload) in payloads {
            sequence += 1;
            let event_id = format!("{}:event:{}", self.run_id, sequence);
            events.push(RunEvent { id:event_id.clone(), kind:kind.into(), created_at:timestamp,
                data:json!({"schemaVersion":1,"eventId":event_id,"runId":self.run_id,"type":kind,
                    "sequence":sequence,"createdAt":timestamp,"agentId":"coordinator","payload":payload}) });
        }
        let revision = self
            .revision
            .checked_add(1)
            .ok_or_else(|| StoreError::new("capacity"))?;
        events.push(RunEvent { id:format!("{}:state:{}", self.run_id, revision), kind:"coordinator_state_v1".into(),
            created_at:timestamp, data:json!({"format":"uagent.coordinator-state.v1","archiveFormat":self.archive_format,
                "archiveOnly":true,"taskMode":"discussion","projectId":self.project_namespace,"runId":self.run_id,
                "conversationId":self.conversation_id,"logicalProjectId":self.logical_project_id,
                "providerId":self.provider_id,"modelId":self.model_id,"goal":GOAL,"status":run_status_text(status),
                "createdAt":self.created_at,"updatedAt":timestamp,"messageCount":self.message_count+messages.len(),
                "modelRequests":request_count,"toolCalls":0,"steps":[],"requiresFreshAuthorization":true,
                "lastRequestId":request_id,"lastRequestStatus":request_status.map(RequestStatus::text)}) });
        sequence += 1; // State events occupy a real native SQLite event sequence too.
        let added_event_bytes = events.iter().try_fold(0usize, |sum, event| {
            sum.checked_add(encoded_bytes(event)?)
                .ok_or_else(|| StoreError::new("capacity"))
        })?;
        let next_event_bytes = self
            .event_bytes
            .checked_add(added_event_bytes)
            .ok_or_else(|| StoreError::new("capacity"))?;
        if next_event_bytes > MAX_ARCHIVE_BYTES {
            return Err(StoreError::new("capacity"));
        }
        let message_count = self.message_count + messages.len();
        let batch = CheckpointBatch {
            status,
            checkpoint: Checkpoint {
                next_step_id: None,
                reason: "discussionArchive".into(),
                summary: "Discussion archive only; fresh native authorization is required".into(),
                captured_at: timestamp,
            },
            messages,
            events,
            steps: Vec::new(),
            tool_calls: Vec::new(),
            changesets: Vec::new(),
            artifacts: Vec::new(),
        };
        let store = RunStore::open(&self.root)?;
        let revision = store.commit_checkpoint(
            &self.project_namespace,
            &self.run_id,
            self.revision,
            &batch,
        )?;
        // No in-memory acknowledgement or transcript changes before SQLite COMMIT.
        self.revision = revision;
        self.message_count = message_count;
        self.message_bytes = next_message_bytes;
        self.event_bytes = next_event_bytes;
        self.sequence = sequence;
        self.updated_at = timestamp;
        Ok(self.ack())
    }
}

#[cfg(test)]
#[path = "native_responses_chat_archive/tests.rs"]
mod tests;
