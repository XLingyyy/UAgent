//! Native persistence boundary only. No command executes or restores a saved task.
#![cfg(windows)]

use crate::local_run_store::{
    ActionStatus, CheckpointBatch, NewMessage, NewRun, Origin, Project, RunEvent, RunHistoryEntry,
    RunSnapshot, RunStore, Session, StoreError,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, path::Path};

const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommitInput {
    schema_version: u32,
    project_id: String,
    session_id: String,
    run_id: String,
    goal: String,
    created_at: i64,
    expected_revision: i64,
    expected_message_count: usize,
    batch: CheckpointBatch,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    schema_version: u32,
    project_id: String,
    run_id: String,
    revision: i64,
    message_count: usize,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotInput {
    schema_version: u32,
    project_id: String,
    run_id: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotResult {
    schema_version: u32,
    descriptor: RunHistoryEntry,
    snapshot: RunSnapshot,
    coordinator_state: Option<Value>,
    messages: Vec<NewMessage>,
    events: Vec<RunEvent>,
    completeness: ArchiveCompleteness,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveCompleteness {
    complete: bool,
    loaded_message_count: usize,
    stored_message_count: Option<usize>,
    reason: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoryInput {
    schema_version: u32,
    project_id: Option<String>,
    offset: usize,
    limit: usize,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryResult {
    schema_version: u32,
    runs: Vec<RunHistoryEntry>,
    offset: usize,
    limit: usize,
    has_more: bool,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProviderEnvelope {
    format: String,
    message: ProviderMessage,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProviderMessage {
    role: String,
    content: String,
    name: Option<String>,
    tool_call_id: Option<String>,
    tool_calls: Option<Vec<ProviderCall>>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProviderCall {
    id: String,
    name: String,
    arguments: String,
}
fn error(kind: &str, message: &str) -> StoreError {
    StoreError {
        kind: kind.into(),
        message: message.into(),
    }
}
fn invalid() -> StoreError {
    error("invalid", "native run record contract is invalid")
}
fn record_id(value: &str) -> Result<(), StoreError> {
    if value.is_empty() || value.len() > 256 || value.chars().any(char::is_control) {
        return Err(invalid());
    }
    Ok(())
}
fn integer(value: i64) -> Result<(), StoreError> {
    if !(0..=MAX_SAFE_INTEGER).contains(&value) {
        return Err(invalid());
    }
    Ok(())
}
fn keys(value: &Value, allowed: &[&str]) -> Result<(), StoreError> {
    let map = value.as_object().ok_or_else(invalid)?;
    if map.keys().any(|key| !allowed.contains(&key.as_str())) {
        return Err(invalid());
    }
    Ok(())
}
fn safe_value(value: &Value, depth: usize) -> Result<(), StoreError> {
    if depth > 64 {
        return Err(invalid());
    }
    match value {
        Value::Object(map) => {
            for (key, value) in map {
                let normalized = key
                    .chars()
                    .filter(char::is_ascii_alphanumeric)
                    .flat_map(char::to_lowercase)
                    .collect::<String>();
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
                    "headers",
                    "scope",
                    "scoperef",
                    "rootref",
                    "endpoint",
                    "expiresat",
                ]
                .contains(&normalized.as_str())
                {
                    return Err(error(
                        "invalid",
                        "credential or execution authority cannot be persisted",
                    ));
                }
                safe_value(value, depth + 1)?;
            }
        }
        Value::Array(values) => {
            for value in values {
                safe_value(value, depth + 1)?;
            }
        }
        _ => {}
    }
    Ok(())
}
fn provider_body(body: &str, role: crate::local_run_store::Role) -> Result<(), StoreError> {
    let envelope: ProviderEnvelope = serde_json::from_str(body).map_err(|_| invalid())?;
    if envelope.format != "uagent.provider-message.v1" {
        return Err(invalid());
    }
    let message = envelope.message;
    let mapped = match message.role.as_str() {
        "system" | "developer" => crate::local_run_store::Role::System,
        "user" => crate::local_run_store::Role::User,
        "assistant" => crate::local_run_store::Role::Assistant,
        "tool" => crate::local_run_store::Role::Tool,
        _ => return Err(invalid()),
    };
    if mapped != role {
        return Err(invalid());
    }
    // Content/name are freeform message text, not a transport/configuration object.
    let _ = (&message.content, &message.name);
    if let Some(id) = &message.tool_call_id {
        record_id(id)?;
    }
    if let Some(calls) = &message.tool_calls {
        for call in calls {
            record_id(&call.id)?;
            record_id(&call.name)?;
            let arguments: Value = serde_json::from_str(&call.arguments).map_err(|_| invalid())?;
            safe_value(&arguments, 0)?;
        }
    }
    Ok(())
}
fn source(value: &Value, project: &str) -> Result<(), StoreError> {
    keys(
        value,
        &["projectId", "path", "version", "kind", "freshness"],
    )?;
    if value["projectId"].as_str() != Some(project)
        || !["project_index", "file_preview", "tool", "index_query"]
            .contains(&value["kind"].as_str().ok_or_else(invalid)?)
        || value["path"].as_str().is_none()
        || value["version"]
            .as_str()
            .filter(|value| !value.is_empty())
            .is_none()
    {
        return Err(invalid());
    }
    if let Some(freshness) = value.get("freshness") {
        let freshness = freshness.as_str().ok_or_else(invalid)?;
        if freshness.is_empty() || freshness.encode_utf16().count() > 256 {
            return Err(invalid());
        }
    }
    Ok(())
}
fn result(value: &Value, project: &str) -> Result<(), StoreError> {
    keys(
        value,
        &[
            "callId",
            "toolId",
            "status",
            "effectState",
            "output",
            "sources",
            "truncated",
            "diagnosticCode",
        ],
    )?;
    record_id(value["callId"].as_str().ok_or_else(invalid)?)?;
    record_id(value["toolId"].as_str().ok_or_else(invalid)?)?;
    if !["completed", "blocked", "failed", "cancelled"]
        .contains(&value["status"].as_str().ok_or_else(invalid)?)
        || ![
            "not_started",
            "applied",
            "partial",
            "unknown",
            "compensated",
        ]
        .contains(&value["effectState"].as_str().ok_or_else(invalid)?)
        || value["truncated"].as_bool().is_none()
    {
        return Err(invalid());
    }
    for item in value["sources"].as_array().ok_or_else(invalid)? {
        source(item, project)?;
    }
    Ok(())
}
fn checkpoint(value: &Value, project: &str, run: &str) -> Result<(), StoreError> {
    keys(
        value,
        &[
            "schemaVersion",
            "runId",
            "completedStepIds",
            "unresolvedEffects",
            "contextRefs",
            "nextStepId",
            "reason",
        ],
    )?;
    if value["schemaVersion"] != 1 || value["runId"].as_str() != Some(run) {
        return Err(invalid());
    }
    for item in value["contextRefs"].as_array().ok_or_else(invalid)? {
        source(item, project)?;
    }
    for effect in value["unresolvedEffects"].as_array().ok_or_else(invalid)? {
        keys(effect, &["callId", "toolId", "effectState"])?;
    }
    Ok(())
}
fn plan_integer(value: &Value) -> Result<u64, StoreError> {
    let value = value.as_u64().ok_or_else(invalid)?;
    if value > MAX_SAFE_INTEGER as u64 {
        return Err(invalid());
    }
    Ok(value)
}
fn plan_indexes(
    value: &Value,
    full_count: u64,
    seen: &mut HashSet<u64>,
) -> Result<Vec<usize>, StoreError> {
    let indexes = value.as_array().ok_or_else(invalid)?;
    if indexes.is_empty() {
        return Err(invalid());
    }
    indexes
        .iter()
        .map(|value| {
            let index = plan_integer(value)?;
            if index >= full_count || !seen.insert(index) {
                return Err(invalid());
            }
            Ok(index as usize)
        })
        .collect()
}
fn context_plan(
    value: &Value,
    project: &str,
    run: &str,
    session: &str,
    message_count: usize,
    max_context_bytes: u64,
    scope_description: &Value,
    content_lengths: Option<&[usize]>,
) -> Result<(), StoreError> {
    keys(
        value,
        &[
            "schemaVersion",
            "planId",
            "runId",
            "projectId",
            "conversationId",
            "method",
            "maxBytes",
            "usedBytes",
            "fullRecordMessageCount",
            "scopeDescription",
            "segments",
            "omitted",
        ],
    )?;
    if value["schemaVersion"] != 1
        || value["method"] != "deterministic-selection-v1"
        || value["runId"].as_str() != Some(run)
        || value["projectId"].as_str() != Some(project)
        || value["conversationId"].as_str() != Some(session)
    {
        return Err(invalid());
    }
    record_id(value["planId"].as_str().ok_or_else(invalid)?)?;
    let full_count = plan_integer(&value["fullRecordMessageCount"])?;
    let max_bytes = plan_integer(&value["maxBytes"])?;
    let used_bytes = plan_integer(&value["usedBytes"])?;
    if full_count == 0
        || full_count > message_count as u64
        || max_bytes == 0
        || max_bytes > max_context_bytes
        || used_bytes > max_bytes
    {
        return Err(invalid());
    }
    let description = &value["scopeDescription"];
    keys(description, &["mode", "readPrefixes", "sharePrefixes"])?;
    if description["mode"] != "read_only"
        || description["readPrefixes"] != scope_description["readPrefixes"]
        || description["sharePrefixes"] != scope_description["sharePrefixes"]
    {
        return Err(invalid());
    }
    for name in ["readPrefixes", "sharePrefixes"] {
        if description[name]
            .as_array()
            .ok_or_else(invalid)?
            .iter()
            .any(|prefix| prefix.as_str().is_none())
        {
            return Err(invalid());
        }
    }
    let mut seen = HashSet::new();
    for segment in value["segments"].as_array().ok_or_else(invalid)? {
        keys(
            segment,
            &[
                "category",
                "originalMessageIndexes",
                "selection",
                "sources",
                "excerpts",
            ],
        )?;
        if ![
            "goal",
            "constraints",
            "history",
            "project_fact",
            "tool_result",
        ]
        .contains(&segment["category"].as_str().ok_or_else(invalid)?)
        {
            return Err(invalid());
        }
        let indexes = plan_indexes(&segment["originalMessageIndexes"], full_count, &mut seen)?;
        for item in segment["sources"].as_array().ok_or_else(invalid)? {
            source(item, project)?;
        }
        match segment["selection"].as_str() {
            Some("exact") if segment.get("excerpts").is_none() => {}
            Some("deterministic_excerpt") => {
                let excerpts = segment["excerpts"].as_array().ok_or_else(invalid)?;
                if excerpts.is_empty() {
                    return Err(invalid());
                }
                for range in excerpts {
                    keys(range, &["messageIndex", "start", "end", "unit"])?;
                    let index = plan_integer(&range["messageIndex"])? as usize;
                    let start = plan_integer(&range["start"])?;
                    let end = plan_integer(&range["end"])?;
                    if range["unit"] != "utf16" || !indexes.contains(&index) || start >= end {
                        return Err(invalid());
                    }
                    if let Some(lengths) = content_lengths {
                        if end > *lengths.get(index).ok_or_else(invalid)? as u64 {
                            return Err(invalid());
                        }
                    }
                }
            }
            _ => return Err(invalid()),
        }
    }
    for omitted in value["omitted"].as_array().ok_or_else(invalid)? {
        keys(omitted, &["originalMessageIndexes", "reason"])?;
        if !["budget", "superseded"].contains(&omitted["reason"].as_str().ok_or_else(invalid)?) {
            return Err(invalid());
        }
        plan_indexes(&omitted["originalMessageIndexes"], full_count, &mut seen)?;
    }
    if seen.len() as u64 != full_count {
        return Err(invalid());
    }
    Ok(())
}
fn validate_state_plan(
    input: &CommitInput,
    state: &Value,
    plan: &Value,
    lengths: Option<&[usize]>,
) -> Result<(), StoreError> {
    context_plan(
        plan,
        &input.project_id,
        &input.run_id,
        &input.session_id,
        input
            .expected_message_count
            .checked_add(input.batch.messages.len())
            .ok_or_else(invalid)?,
        plan_integer(&state["limits"]["maxContextBytes"])?,
        &state["scopeDescription"],
        lengths,
    )
}

fn state_event<'a>(input: &'a CommitInput) -> Result<&'a Value, StoreError> {
    let mut states = input
        .batch
        .events
        .iter()
        .filter(|event| event.kind == "coordinator_state_v1");
    let state = states.next().ok_or_else(invalid)?;
    if states.next().is_some()
        || state.id != format!("{}:state:{}", input.run_id, input.expected_revision + 1)
    {
        return Err(invalid());
    }
    let value = &state.data;
    keys(
        value,
        &[
            "format",
            "runId",
            "taskId",
            "projectId",
            "conversationId",
            "goal",
            "planVersion",
            "status",
            "limits",
            "parentRunId",
            "modelRequests",
            "toolCalls",
            "createdAt",
            "updatedAt",
            "finishedAt",
            "stopReason",
            "scopeDescription",
            "messageCount",
            "steps",
            "checkpoint",
            "contextPlan",
            "requiresFreshAuthorization",
        ],
    )?;
    if value["format"] != "uagent.coordinator-state.v1"
        || value["runId"].as_str() != Some(input.run_id.as_str())
        || value["projectId"].as_str() != Some(input.project_id.as_str())
        || value["conversationId"].as_str() != Some(input.session_id.as_str())
        || value["goal"].as_str() != Some(input.goal.as_str())
        || value["createdAt"].as_i64() != Some(input.created_at)
        || value["requiresFreshAuthorization"] != true
        || value["messageCount"].as_u64()
            != Some(
                input
                    .expected_message_count
                    .checked_add(input.batch.messages.len())
                    .ok_or_else(invalid)? as u64,
            )
    {
        return Err(invalid());
    }
    keys(
        &value["scopeDescription"],
        &[
            "mode",
            "readPrefixes",
            "sharePrefixes",
            "toolIds",
            "providerId",
            "modelId",
        ],
    )?;
    if value["scopeDescription"]["mode"] != "read_only" {
        return Err(invalid());
    }
    keys(
        &value["limits"],
        &[
            "maxToolCalls",
            "maxModelRequests",
            "maxDurationMs",
            "maxAttemptsPerFailure",
            "maxToolResultBytes",
            "maxContextBytes",
        ],
    )?;
    for step in value["steps"].as_array().ok_or_else(invalid)? {
        keys(
            step,
            &[
                "stepId",
                "dependencies",
                "inputRefs",
                "preconditions",
                "executor",
                "status",
                "callId",
                "result",
            ],
        )?;
        if let Some(item) = step.get("result") {
            result(item, &input.project_id)?;
        }
    }
    if let Some(item) = value.get("checkpoint") {
        checkpoint(item, &input.project_id, &input.run_id)?;
    }
    if let Some(plan) = value.get("contextPlan") {
        validate_state_plan(input, value, plan, None)?;
    }
    Ok(value)
}
fn validate(input: &CommitInput) -> Result<(), StoreError> {
    if input.schema_version != 1 || input.expected_revision >= MAX_SAFE_INTEGER {
        return Err(invalid());
    }
    record_id(&input.project_id)?;
    record_id(&input.session_id)?;
    record_id(&input.run_id)?;
    integer(input.created_at)?;
    integer(input.expected_revision)?;
    integer(input.batch.checkpoint.captured_at)?;
    if input.batch.checkpoint.captured_at < input.created_at
        || input.expected_message_count > MAX_SAFE_INTEGER as usize
        || !input.batch.changesets.is_empty()
        || !input.batch.artifacts.is_empty()
    {
        return Err(invalid());
    }
    safe_value(
        &serde_json::to_value(&input.batch).map_err(|_| invalid())?,
        0,
    )?;
    let state = state_event(input)?;
    for (index, message) in input.batch.messages.iter().enumerate() {
        if message.id
            != format!(
                "{}:message:{}",
                input.run_id,
                input.expected_message_count + index + 1
            )
        {
            return Err(invalid());
        }
        integer(message.created_at)?;
        provider_body(&message.body, message.role)?;
    }
    let steps = input
        .batch
        .steps
        .iter()
        .map(|step| step.id.as_str())
        .collect::<HashSet<_>>();
    if steps.len() != input.batch.steps.len() {
        return Err(invalid());
    }
    for step in &input.batch.steps {
        if step
            .depends_on
            .iter()
            .any(|id| id == &step.id || !steps.contains(id.as_str()))
        {
            return Err(invalid());
        }
    }
    for call in &input.batch.tool_calls {
        if call.id != format!("{}:tool", call.step_id)
            || !input
                .batch
                .steps
                .iter()
                .any(|step| step.id == call.step_id && step.status == call.status)
        {
            return Err(invalid());
        }
        if let Some(item) = &call.result {
            result(item, &input.project_id)?;
        }
        if matches!(
            call.status,
            ActionStatus::Succeeded | ActionStatus::Failed | ActionStatus::Skipped
        ) && call.result.is_none()
        {
            return Err(invalid());
        }
    }
    for event in &input.batch.events {
        if event.kind == "coordinator_state_v1" {
            continue;
        }
        keys(
            &event.data,
            &[
                "schemaVersion",
                "eventId",
                "runId",
                "sequence",
                "agentId",
                "createdAt",
                "type",
                "stepId",
                "payload",
            ],
        )?;
        if event.data["schemaVersion"] != 1
            || event.data["runId"].as_str() != Some(input.run_id.as_str())
            || event.data["eventId"].as_str() != Some(event.id.as_str())
            || event.data["type"].as_str() != Some(event.kind.as_str())
            || event.data["createdAt"].as_i64() != Some(event.created_at)
        {
            return Err(invalid());
        }
        let payload = &event.data["payload"];
        match event.kind.as_str() {
            "run_created" => keys(payload, &[])?,
            "status_changed" => keys(payload, &["status", "reason", "pauseRequested"])?,
            "model_started" => {
                keys(payload, &["requestId", "contextPlan"])?;
                if let Some(plan) = payload.get("contextPlan") {
                    validate_state_plan(input, state, plan, None)?;
                    if state.get("contextPlan") != Some(plan) {
                        return Err(invalid());
                    }
                }
            }
            "model_text_delta" => keys(payload, &["text"])?,
            "model_completed" => {
                keys(payload, &["requestId", "finishReason", "usage", "usageStatus"])?;
                if let Some(status)=payload.get("usageStatus") {
                    let status=status.as_str().ok_or_else(invalid)?;
                    if !matches!(status,"reported"|"unknown") ||
                        (status=="reported")!=payload.get("usage").is_some() {
                        return Err(invalid());
                    }
                }
            },
            "tool_requested" => {
                keys(payload, &["callId", "name", "arguments"])?;
                let arguments: Value =
                    serde_json::from_str(payload["arguments"].as_str().ok_or_else(invalid)?)
                        .map_err(|_| invalid())?;
                safe_value(&arguments, 0)?;
            }
            "tool_started" => keys(payload, &["callId", "name"])?,
            "tool_completed" | "tool_failed" => {
                keys(payload, &["result"])?;
                result(&payload["result"], &input.project_id)?;
            }
            "checkpoint_created" => {
                keys(payload, &["checkpoint"])?;
                checkpoint(&payload["checkpoint"], &input.project_id, &input.run_id)?;
            }
            _ => return Err(invalid()),
        }
    }
    Ok(())
}
fn find_session(store: &RunStore, project: &str, id: &str) -> Result<Option<Session>, StoreError> {
    let mut offset = 0;
    loop {
        let page = store.sessions(project, true, 500, offset)?;
        if let Some(session) = page.iter().find(|session| session.id == id) {
            return Ok(Some(session.clone()));
        }
        if page.len() < 500 {
            return Ok(None);
        }
        offset += page.len();
    }
}
fn ensure_records(
    store: &RunStore,
    input: &CommitInput,
    canonical_root: &Path,
) -> Result<(), StoreError> {
    let root = canonical_root.to_str().ok_or_else(invalid)?;
    let find_project = || {
        store.projects().map(|projects| {
            projects
                .into_iter()
                .find(|project| project.id == input.project_id)
        })
    };
    let project = match find_project()? {
        Some(project) => project,
        None => {
            let project = Project {
                id: input.project_id.clone(),
                root: root.into(),
                label: canonical_root
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into(),
                created_at: input.created_at,
            };
            if let Err(error) = store.create_project(&project) {
                if error.kind != "constraint" {
                    return Err(error);
                }
            }
            find_project()?.ok_or_else(invalid)?
        }
    };
    if project.root != root {
        return Err(error(
            "projectBindingMismatch",
            "saved metadata does not match the current trusted project",
        ));
    }
    if find_session(store, &input.project_id, &input.session_id)?.is_none() {
        let session = Session {
            project_id: input.project_id.clone(),
            id: input.session_id.clone(),
            title: input.goal.clone(),
            created_at: input.created_at,
            archived: false,
            parent_id: None,
            origin: Origin::Native,
        };
        if let Err(error) = store.create_session(&session) {
            if error.kind != "constraint" {
                return Err(error);
            }
        }
    }
    if find_session(store, &input.project_id, &input.session_id)?
        .ok_or_else(invalid)?
        .origin
        != Origin::Native
    {
        return Err(error(
            "readOnlyHistory",
            "historical text must be branched before creating a run",
        ));
    }
    match store.run(&input.project_id, &input.run_id) {
        Ok(run) => {
            if run.session_id != input.session_id
                || run.goal != input.goal
                || run.created_at != input.created_at
            {
                return Err(invalid());
            }
        }
        Err(error) if error.kind == "notFound" && input.expected_revision == 0 => {
            if let Err(error) = store.start_run(
                &input.project_id,
                &NewRun {
                    id: input.run_id.clone(),
                    session_id: input.session_id.clone(),
                    goal: input.goal.clone(),
                    created_at: input.created_at,
                },
            ) {
                if error.kind != "constraint" {
                    return Err(error);
                }
                let run = store.run(&input.project_id, &input.run_id)?;
                if run.session_id != input.session_id
                    || run.goal != input.goal
                    || run.created_at != input.created_at
                {
                    return Err(invalid());
                }
            }
        }
        Err(error) => return Err(error),
    }
    Ok(())
}
fn validate_plan_records(store: &RunStore, input: &CommitInput) -> Result<(), StoreError> {
    let state = state_event(input)?;
    if state.get("contextPlan").is_none()
        && !input.batch.events.iter().any(|event| {
            event.kind == "model_started" && event.data["payload"].get("contextPlan").is_some()
        })
    {
        return Ok(());
    }
    let mut lengths = vec![None; input.expected_message_count];
    if !lengths.is_empty() {
        let prefix = format!("{}:message:", input.run_id);
        let mut after = 0;
        loop {
            let page = store.messages(&input.project_id, &input.session_id, after, 500)?;
            for message in &page {
                after = message.ordinal;
                if let Some(index) = message
                    .id
                    .strip_prefix(&prefix)
                    .and_then(|suffix| suffix.parse::<usize>().ok())
                {
                    if index > 0 && index <= input.expected_message_count {
                        let envelope: ProviderEnvelope =
                            serde_json::from_str(&message.body).map_err(|_| invalid())?;
                        if envelope.format != "uagent.provider-message.v1"
                            || lengths[index - 1].is_some()
                        {
                            return Err(invalid());
                        }
                        lengths[index - 1] = Some(envelope.message.content.encode_utf16().count());
                    }
                }
            }
            if page.len() < 500 {
                break;
            }
        }
    }
    let mut lengths = lengths
        .into_iter()
        .map(|length| length.ok_or_else(invalid))
        .collect::<Result<Vec<_>, _>>()?;
    for message in &input.batch.messages {
        let envelope: ProviderEnvelope =
            serde_json::from_str(&message.body).map_err(|_| invalid())?;
        lengths.push(envelope.message.content.encode_utf16().count());
    }
    if let Some(plan) = state.get("contextPlan") {
        validate_state_plan(input, state, plan, Some(&lengths))?;
    }
    for event in &input.batch.events {
        if event.kind == "model_started" {
            if let Some(plan) = event.data["payload"].get("contextPlan") {
                validate_state_plan(input, state, plan, Some(&lengths))?;
            }
        }
    }
    Ok(())
}

fn apply_commit(
    store: &RunStore,
    input: &CommitInput,
    canonical_root: &Path,
) -> Result<CommitResult, StoreError> {
    validate(input)?;
    ensure_records(store, input, canonical_root)?;
    let snapshot = store.snapshot(&input.project_id, &input.run_id)?;
    if snapshot.run.revision != input.expected_revision {
        return Err(error(
            "conflict",
            "run revision changed; reconcile saved history before continuing",
        ));
    }
    let previous_count = if input.expected_revision == 0 {
        0
    } else {
        let previous = store
            .checkpoint_batch(&input.project_id, &input.run_id, input.expected_revision)?
            .ok_or_else(invalid)?;
        previous
            .events
            .iter()
            .find(|event| event.kind == "coordinator_state_v1")
            .and_then(|event| event.data["messageCount"].as_u64())
            .ok_or_else(invalid)? as usize
    };
    if previous_count != input.expected_message_count {
        return Err(error("conflict", "saved message prefix changed"));
    }
    validate_plan_records(store, input)?;
    for previous in &snapshot.tool_calls {
        let current = input
            .batch
            .tool_calls
            .iter()
            .find(|call| call.id == previous.id)
            .ok_or_else(invalid)?;
        if previous.result.is_some() && current.result != previous.result {
            return Err(error(
                "invalid",
                "an observed tool result cannot be erased or replaced",
            ));
        }
    }
    let revision = store.commit_checkpoint(
        &input.project_id,
        &input.run_id,
        input.expected_revision,
        &input.batch,
    )?;
    Ok(CommitResult {
        schema_version: 1,
        project_id: input.project_id.clone(),
        run_id: input.run_id.clone(),
        revision,
        message_count: previous_count + input.batch.messages.len(),
    })
}
fn app_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, StoreError> {
    Ok(crate::app_profile::resolve_app_data_dir(app)
        .map_err(|_| error("unavailable", "native app data directory is unavailable"))?
        .join("run-store-v2"))
}
fn trusted_project(project_id: &str) -> Result<crate::TrustedRootBinding, StoreError> {
    crate::resolve_trusted_root_binding_by_id(project_id).map_err(|_| {
        error(
            "untrustedProject",
            "current native trusted project identity is required",
        )
    })
}
fn list_history(store: &RunStore, input: &HistoryInput) -> Result<HistoryResult, StoreError> {
    if input.schema_version != 1
        || input.limit == 0
        || input.limit > 100
        || input.offset > 1_000_000
    {
        return Err(invalid());
    }
    if let Some(project) = &input.project_id {
        record_id(project)?;
    }
    let mut runs = store.history_runs(
        input.project_id.as_deref(),
        None,
        input.limit + 1,
        input.offset,
    )?;
    let has_more = runs.len() > input.limit;
    runs.truncate(input.limit);
    Ok(HistoryResult {
        schema_version: 1,
        runs,
        offset: input.offset,
        limit: input.limit,
        has_more,
    })
}

const MAX_ARCHIVE_MESSAGES: usize = 10_000;
const MAX_ARCHIVE_BODY_BYTES: usize = 16 * 1024 * 1024;
const MAX_ARCHIVE_REVISIONS: i64 = 10_000;
const MAX_ARCHIVE_EVENTS: usize = 10_000;

fn read_archive(store: &RunStore, input: &SnapshotInput) -> Result<SnapshotResult, StoreError> {
    if input.schema_version != 1 {
        return Err(invalid());
    }
    record_id(&input.project_id)?;
    record_id(&input.run_id)?;
    let snapshot = store.snapshot(&input.project_id, &input.run_id)?;
    let mut descriptor = store
        .history_runs(Some(&input.project_id), Some(&input.run_id), 1, 0)?
        .into_iter()
        .next()
        .ok_or_else(|| error("notFound", "run does not exist in this project"))?;
    // Descriptor rows may be newer if another process wrote after the snapshot.
    // The archived conversation and displayed status remain pinned to its revision.
    descriptor.status = snapshot.run.status;
    descriptor.updated_at = snapshot.run.updated_at;
    descriptor.has_unresolved_effects |= snapshot.has_unknown_external_effects
        || snapshot
            .steps
            .iter()
            .any(|step| matches!(step.status, ActionStatus::InFlight | ActionStatus::Unknown))
        || snapshot.changesets.iter().any(|change| {
            matches!(
                change.status,
                ActionStatus::InFlight | ActionStatus::Unknown
            )
        });
    let batch = store.checkpoint_batch(&input.project_id, &input.run_id, snapshot.run.revision)?;
    let coordinator_state = batch.and_then(|batch| {
        batch
            .events
            .into_iter()
            .find(|event| event.kind == "coordinator_state_v1")
            .map(|event| event.data)
    });
    if let Some(state) = &coordinator_state {
        safe_value(state, 0)?;
    }
    let stored_message_count = coordinator_state
        .as_ref()
        .and_then(|state| state["messageCount"].as_u64())
        .and_then(|count| usize::try_from(count).ok());
    let mut messages = Vec::new();
    let mut events = Vec::new();
    let mut body_bytes = 0usize;
    let mut event_bytes = 0usize;
    let mut reason = None;
    'revisions: for revision in 1..=snapshot.run.revision {
        if revision > MAX_ARCHIVE_REVISIONS {
            reason = Some("revisionLimit".into());
            break;
        }
        let Some(batch) = store.checkpoint_batch(&input.project_id, &input.run_id, revision)?
        else {
            reason = Some("missingCheckpoint".into());
            break;
        };
        for message in batch.messages {
            if messages.len() >= MAX_ARCHIVE_MESSAGES
                || body_bytes.saturating_add(message.body.len()) > MAX_ARCHIVE_BODY_BYTES
            {
                reason = Some("displayLimit".into());
                break 'revisions;
            }
            // Bodies belong to this run's immutable batches, never all messages in
            // the session (which could also contain other runs).
            if message.id != format!("{}:message:{}", input.run_id, messages.len() + 1) {
                reason = Some("messageSequenceMismatch".into());
                break 'revisions;
            }
            provider_body(&message.body, message.role)?;
            body_bytes += message.body.len();
            messages.push(message);
        }
        for event in batch.events {
            let bytes = serde_json::to_vec(&event).map_err(|_| invalid())?.len();
            if events.len() >= MAX_ARCHIVE_EVENTS
                || event_bytes.saturating_add(bytes) > MAX_ARCHIVE_BODY_BYTES
            {
                reason = Some("eventDisplayLimit".into());
                break 'revisions;
            }
            safe_value(&event.data, 0)?;
            event_bytes += bytes;
            events.push(event);
        }
    }
    if reason.is_none() && stored_message_count != Some(messages.len()) {
        // A run with no checkpoint genuinely has no saved conversation yet.
        if snapshot.run.revision != 0 {
            reason = Some("messageCountMismatch".into());
        }
    }
    let stored_message_count = if snapshot.run.revision == 0 {
        Some(0)
    } else {
        stored_message_count
    };
    let completeness = ArchiveCompleteness {
        complete: reason.is_none(),
        loaded_message_count: messages.len(),
        stored_message_count,
        reason,
    };
    Ok(SnapshotResult {
        schema_version: 1,
        descriptor,
        snapshot,
        coordinator_state,
        messages,
        events,
        completeness,
    })
}

/// Reads descriptors only from the managed app archive; no project trust is inferred.
#[tauri::command]
pub async fn list_native_run_history(
    app: tauri::AppHandle,
    input: HistoryInput,
) -> Result<HistoryResult, StoreError> {
    if input.schema_version != 1
        || input.limit == 0
        || input.limit > 100
        || input.offset > 1_000_000
    {
        return Err(invalid());
    }
    if let Some(project) = &input.project_id {
        record_id(project)?;
    }
    let root = app_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || list_history(&RunStore::open(root)?, &input))
        .await
        .map_err(|_| error("unavailable", "native record worker did not complete"))?
}
#[tauri::command]
pub async fn commit_native_run_store(
    app: tauri::AppHandle,
    input: CommitInput,
) -> Result<CommitResult, StoreError> {
    validate(&input)?;
    trusted_project(&input.project_id)?;
    let root = app_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let binding = trusted_project(&input.project_id)?;
        // Connection creation, use and destruction remain local to this blocking worker.
        let store = RunStore::open(root)?;
        apply_commit(&store, &input, &binding.canonical_root)
    })
    .await
    .map_err(|_| error("unavailable", "native record worker did not complete"))?
}
#[tauri::command]
pub async fn snapshot_native_run_store(
    app: tauri::AppHandle,
    input: SnapshotInput,
) -> Result<SnapshotResult, StoreError> {
    if input.schema_version != 1 {
        return Err(invalid());
    }
    record_id(&input.project_id)?;
    record_id(&input.run_id)?;
    let root = app_root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        // Reading this app's own archive requires no current project authority.
        // The project/run pair still scopes every database read; the descriptor
        // cannot be used as authority to read the external project filesystem.
        let store = RunStore::open(root)?;
        read_archive(&store, &input)
    })
    .await
    .map_err(|_| error("unavailable", "native record worker did not complete"))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_run_store::Role;
    #[test]
    fn native_run_store_provider_envelope_preserves_developer_and_call_metadata() {
        let body = serde_json::json!({"format":"uagent.provider-message.v1","message":{
            "role":"developer","content":"Exact Unicode \u{4e2d}\0 text","name":"context",
            "toolCallId":"provider-call","toolCalls":[{"id":"provider-call","name":"read","arguments":"{\"path\":\"Source/Test.cpp\"}"}]
        }}).to_string();
        provider_body(&body, Role::System).unwrap();
        assert!(provider_body(&body, Role::User).is_err());
        assert!(body.contains("toolCallId"));
    }
    #[test]
    fn native_run_store_refuses_nested_authority_and_serialized_argument_authority() {
        assert!(safe_value(
            &serde_json::json!({"output":[{"Approval-Token":"synthetic"}]}),
            0
        )
        .is_err());
        assert!(safe_value(
            &serde_json::json!({"scopeDescription":{"mode":"read_only"}}),
            0
        )
        .is_ok());
        let body = serde_json::json!({"format":"uagent.provider-message.v1","message":{
            "role":"assistant","content":"","toolCalls":[{"id":"call","name":"read","arguments":"{\"nested\":{\"api_key\":\"synthetic\"}}"}]
        }}).to_string();
        assert!(provider_body(&body, Role::Assistant).is_err());
    }

    fn plan_fixture() -> Value {
        serde_json::json!({
            "schemaVersion":1,"planId":"run:context:1","runId":"run","projectId":"A","conversationId":"chat",
            "method":"deterministic-selection-v1","maxBytes":1000,"usedBytes":300,"fullRecordMessageCount":4,
            "scopeDescription":{"mode":"read_only","readPrefixes":["Source"],"sharePrefixes":["Source"]},
            "segments":[
                {"category":"constraints","originalMessageIndexes":[0,1],"selection":"exact","sources":[]},
                {"category":"goal","originalMessageIndexes":[2],"selection":"exact","sources":[]},
                {"category":"tool_result","originalMessageIndexes":[3],"selection":"deterministic_excerpt",
                 "sources":[{"projectId":"A","path":"Source/Test.cpp","version":"hash2","kind":"file_preview","freshness":"stamp2"}],
                 "excerpts":[{"messageIndex":3,"start":0,"end":8,"unit":"utf16"}]}
            ],"omitted":[]
        })
    }
    fn check_plan(plan: &Value) -> Result<(), StoreError> {
        context_plan(
            plan,
            "A",
            "run",
            "chat",
            4,
            1000,
            &plan_fixture()["scopeDescription"],
            Some(&[3, 4, 5, 12]),
        )
    }
    #[test]
    fn native_run_store_context_plan_keeps_descriptive_ranges_versions_and_freshness() {
        check_plan(&plan_fixture()).unwrap();
        let mut foreign = plan_fixture();
        foreign["projectId"] = "B".into();
        assert!(check_plan(&foreign).is_err());
        let mut outside = plan_fixture();
        outside["segments"][2]["excerpts"][0]["end"] = 13.into();
        assert!(check_plan(&outside).is_err());
        let mut invalid_index = plan_fixture();
        invalid_index["segments"][2]["originalMessageIndexes"][0] = 4.into();
        assert!(check_plan(&invalid_index).is_err());
        let mut excess = plan_fixture();
        excess["usedBytes"] = 1001.into();
        assert!(check_plan(&excess).is_err());
        let mut invented = plan_fixture();
        invented["endpoint"] = "https://invalid.example".into();
        assert!(check_plan(&invented).is_err());
    }
    #[test]
    fn native_run_store_freshness_is_optional_nonempty_and_bounded_in_utf16() {
        let mut value = plan_fixture()["segments"][2]["sources"][0].clone();
        source(&value, "A").unwrap();
        value["freshness"] = Value::Null;
        assert!(source(&value, "A").is_err());
        value["freshness"] = "".into();
        assert!(source(&value, "A").is_err());
        value["freshness"] = "x".repeat(257).into();
        assert!(source(&value, "A").is_err());
        value["freshness"] = "\u{1f7e2}".repeat(129).into();
        assert!(source(&value, "A").is_err());
        value.as_object_mut().unwrap().remove("freshness");
        source(&value, "A").unwrap();
    }

    struct BridgeFixture(std::path::PathBuf);
    impl BridgeFixture {
        fn new() -> Self {
            use std::sync::atomic::{AtomicU64, Ordering};
            static NEXT: AtomicU64 = AtomicU64::new(0);
            let suffix = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "uagent-run-store-bridge-test-{}-{suffix}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            assert!(root.is_absolute());
            std::fs::create_dir(&root).unwrap();
            std::fs::create_dir(root.join("project")).unwrap();
            Self(root)
        }
        fn store(&self) -> RunStore {
            RunStore::open(self.0.join("store")).unwrap()
        }
        fn project_root(&self) -> std::path::PathBuf {
            std::fs::canonicalize(self.0.join("project")).unwrap()
        }
    }
    impl Drop for BridgeFixture {
        fn drop(&mut self) {
            // Delete only this test's newly-created absolute directory under task TEMP.
            let temporary = std::env::temp_dir();
            if self.0.is_absolute()
                && self.0.parent() == Some(temporary.as_path())
                && self
                    .0
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .starts_with("uagent-run-store-bridge-test-")
            {
                let resolved = std::fs::canonicalize(&self.0).unwrap();
                let temporary = std::fs::canonicalize(temporary).unwrap();
                assert!(resolved.starts_with(&temporary) && resolved != temporary);
                std::fs::remove_dir_all(&self.0).unwrap();
            }
        }
    }
    #[test]
    fn native_run_store_usage_status_keeps_unknown_and_rejects_contradictions() {
        for (payload,valid) in [
            (serde_json::json!({"requestId":"request","usageStatus":"unknown"}),true),
            (serde_json::json!({"requestId":"request","usageStatus":"reported","usage":{"inputTokens":11,"outputTokens":7,"totalTokens":18}}),true),
            (serde_json::json!({"requestId":"request"}),true),
            (serde_json::json!({"requestId":"request","usageStatus":"reported"}),false),
            (serde_json::json!({"requestId":"request","usageStatus":"unknown","usage":{"inputTokens":1}}),false),
            (serde_json::json!({"requestId":"request","usageStatus":"estimated"}),false),
        ] {
            let mut raw=first_commit();
            raw["batch"]["events"].as_array_mut().unwrap().insert(1,serde_json::json!({
                "id":"run:2","kind":"model_completed","createdAt":100,
                "data":{"schemaVersion":1,"eventId":"run:2","runId":"run","sequence":2,
                "agentId":"coordinator","createdAt":100,"type":"model_completed","payload":payload}
            }));
            let input:CommitInput=serde_json::from_value(raw).unwrap();
            assert_eq!(validate(&input).is_ok(),valid);
        }
    }
    fn first_commit() -> Value {
        let goal = "Find exact Unicode \u{4e2d}\u{6587}\0 value";
        let messages = vec![
            serde_json::json!({"role":"system","content":"Safety constraints"}),
            serde_json::json!({"role":"developer","content":"Descriptive Source scope \u{4e2d}\0","name":"context"}),
            serde_json::json!({"role":"user","content":goal}),
            serde_json::json!({"role":"assistant","content":"","toolCalls":[{"id":"provider-call","name":"read","arguments":"{ \"path\": \"Source/Test.cpp\" }"}]}),
        ];
        let records = messages.iter().enumerate().map(|(index, message)| {
            let role = if message["role"] == "developer" { "system" } else { message["role"].as_str().unwrap() };
            serde_json::json!({"id":format!("run:message:{}", index + 1),"role":role,
                "body":serde_json::json!({"format":"uagent.provider-message.v1","message":message}).to_string(),"createdAt":100})
        }).collect::<Vec<_>>();
        let plan = serde_json::json!({
            "schemaVersion":1,"planId":"run:context:1","runId":"run","projectId":"A","conversationId":"chat",
            "method":"deterministic-selection-v1","maxBytes":1000,"usedBytes":300,"fullRecordMessageCount":3,
            "scopeDescription":{"mode":"read_only","readPrefixes":["Source"],"sharePrefixes":["Source"]},
            "segments":[{"category":"constraints","originalMessageIndexes":[0,1],"selection":"exact","sources":[]},
                {"category":"goal","originalMessageIndexes":[2],"selection":"exact","sources":[]}],"omitted":[]
        });
        let state = serde_json::json!({
            "format":"uagent.coordinator-state.v1","runId":"run","taskId":"task","projectId":"A","conversationId":"chat","goal":goal,
            "planVersion":1,"status":"running",
            "limits":{"maxToolCalls":3,"maxModelRequests":4,"maxDurationMs":60000,"maxAttemptsPerFailure":2,"maxToolResultBytes":16384,"maxContextBytes":1000},
            "modelRequests":1,"toolCalls":1,"createdAt":100,"updatedAt":100,
            "scopeDescription":{"mode":"read_only","readPrefixes":["Source"],"sharePrefixes":["Source"],"toolIds":["project.read"],"providerId":"synthetic","modelId":"model"},
            "messageCount":4,"steps":[{"stepId":"run:step:1","dependencies":[],"inputRefs":[],"preconditions":["read_only"],
                "executor":"read","status":"running","callId":"provider-call"}],
            "contextPlan":plan,"requiresFreshAuthorization":true
        });
        serde_json::json!({
            "schemaVersion":1,"projectId":"A","sessionId":"chat","runId":"run","goal":goal,"createdAt":100,"expectedRevision":0,"expectedMessageCount":0,
            "batch":{"status":"running","checkpoint":{"nextStepId":null,"reason":"awaitingResult","summary":"Intent recorded","capturedAt":100},
                "messages":records,"steps":[{"id":"run:step:1","title":"read","status":"inFlight","dependsOn":[]}],
                "toolCalls":[{"id":"run:step:1:tool","stepId":"run:step:1","toolName":"read","arguments":{"path":"Source/Test.cpp"},"result":null,"status":"inFlight"}],
                "events":[{"id":"run:1","kind":"tool_requested","createdAt":100,"data":{"schemaVersion":1,"eventId":"run:1","runId":"run","sequence":1,
                    "agentId":"coordinator","stepId":"run:step:1","createdAt":100,"type":"tool_requested","payload":{"callId":"provider-call","name":"read","arguments":"{\"path\":\"[redacted diagnostic]\"}"}}},
                    {"id":"run:state:1","kind":"coordinator_state_v1","createdAt":100,"data":state}],
                "changesets":[],"artifacts":[]}
        })
    }
    fn observed_commit() -> Value {
        let mut value = first_commit();
        let source = serde_json::json!({"projectId":"A","path":"Source/Test.cpp","version":"hash-current","kind":"file_preview","freshness":"native-stamp-2"});
        let result = serde_json::json!({"callId":"provider-call","toolId":"project.read","status":"completed","effectState":"not_started",
            "output":{"text":"Full observed \u{4e2d}\u{6587}\0\u{1f7e2} body ".repeat(2000)},"sources":[source.clone()],"truncated":false});
        let plan = serde_json::json!({
            "schemaVersion":1,"planId":"run:context:2","runId":"run","projectId":"A","conversationId":"chat",
            "method":"deterministic-selection-v1","maxBytes":1000,"usedBytes":300,"fullRecordMessageCount":5,
            "scopeDescription":{"mode":"read_only","readPrefixes":["Source"],"sharePrefixes":["Source"]},
            "segments":[{"category":"constraints","originalMessageIndexes":[0,1],"selection":"exact","sources":[]},
                {"category":"goal","originalMessageIndexes":[2],"selection":"exact","sources":[]},
                {"category":"tool_result","originalMessageIndexes":[3,4],"selection":"deterministic_excerpt","sources":[source.clone()],
                    "excerpts":[{"messageIndex":4,"start":0,"end":16,"unit":"utf16"}]}],"omitted":[]
        });
        let checkpoint = serde_json::json!({"schemaVersion":1,"runId":"run","completedStepIds":["run:step:1"],"unresolvedEffects":[],
            "contextRefs":[source],"nextStepId":null,"reason":"userPaused"});
        value["expectedRevision"] = 1.into();
        value["expectedMessageCount"] = 4.into();
        value["batch"]["status"] = "paused".into();
        value["batch"]["checkpoint"]["capturedAt"] = 101.into();
        value["batch"]["messages"] = serde_json::json!([{"id":"run:message:5","role":"tool","createdAt":101,
            "body":serde_json::json!({"format":"uagent.provider-message.v1","message":{"role":"tool","toolCallId":"provider-call","name":"read","content":result.to_string()}}).to_string()}]);
        value["batch"]["steps"][0]["status"] = "succeeded".into();
        value["batch"]["steps"][0]["title"] = "project.read".into();
        value["batch"]["toolCalls"][0]["status"] = "succeeded".into();
        value["batch"]["toolCalls"][0]["result"] = result.clone();
        let mut state = value["batch"]["events"][1]["data"].clone();
        state["status"] = "paused".into();
        state["updatedAt"] = 101.into();
        state["messageCount"] = 5.into();
        state["steps"][0]["status"] = "completed".into();
        state["steps"][0]["executor"] = "project.read".into();
        state["steps"][0]["result"] = result.clone();
        state["contextPlan"] = plan.clone();
        state["checkpoint"] = checkpoint.clone();
        value["batch"]["events"] = serde_json::json!([
            {"id":"run:2","kind":"tool_completed","createdAt":101,"data":{"schemaVersion":1,"eventId":"run:2","runId":"run","sequence":2,
                "agentId":"coordinator","stepId":"run:step:1","createdAt":101,"type":"tool_completed","payload":{"result":result}}},
            {"id":"run:3","kind":"model_started","createdAt":101,"data":{"schemaVersion":1,"eventId":"run:3","runId":"run","sequence":3,
                "agentId":"coordinator","createdAt":101,"type":"model_started","payload":{"requestId":"run:model:2","contextPlan":plan}}},
            {"id":"run:4","kind":"checkpoint_created","createdAt":101,"data":{"schemaVersion":1,"eventId":"run:4","runId":"run","sequence":4,
                "agentId":"coordinator","createdAt":101,"type":"checkpoint_created","payload":{"checkpoint":checkpoint}}},
            {"id":"run:state:2","kind":"coordinator_state_v1","createdAt":101,"data":state}
        ]);
        value
    }
    fn input(value: Value) -> CommitInput {
        serde_json::from_value(value).unwrap()
    }
    #[test]
    fn native_run_store_bridge_roundtrip_preserves_archive_plan_freshness_and_unknown_effects() {
        let fixture = BridgeFixture::new();
        let store = fixture.store();
        let first = input(first_commit());
        let ack = apply_commit(&store, &first, &fixture.project_root()).unwrap();
        assert_eq!((ack.revision, ack.message_count), (1, 4));
        drop(store);
        let store = fixture.store();
        let pending = store.snapshot("A", "run").unwrap();
        assert!(pending.requires_fresh_authorization && pending.has_unknown_external_effects);
        assert_eq!(
            pending.tool_calls[0].arguments,
            serde_json::json!({"path":"Source/Test.cpp"})
        );
        assert!(pending.tool_calls[0].result.is_none());
        let original = store.messages("A", "chat", 0, 500).unwrap();
        let developer: Value = serde_json::from_str(&original[1].body).unwrap();
        assert_eq!(developer["message"]["role"], "developer");
        assert_eq!(
            developer["message"]["content"],
            "Descriptive Source scope \u{4e2d}\0"
        );
        let assistant: Value = serde_json::from_str(&original[3].body).unwrap();
        assert_eq!(
            assistant["message"]["toolCalls"][0]["arguments"],
            "{ \"path\": \"Source/Test.cpp\" }"
        );
        let observed = observed_commit();
        let expected_result = observed["batch"]["toolCalls"][0]["result"].clone();
        let expected_plan = observed["batch"]["events"][3]["data"]["contextPlan"].clone();
        let ack = apply_commit(&store, &input(observed), &fixture.project_root()).unwrap();
        assert_eq!((ack.revision, ack.message_count), (2, 5));
        drop(store);
        let store = fixture.store();
        let saved = store.snapshot("A", "run").unwrap();
        assert!(saved.requires_fresh_authorization);
        assert!(!saved.has_unknown_external_effects);
        assert_eq!(saved.tool_calls[0].result, Some(expected_result.clone()));
        let messages = store.messages("A", "chat", 0, 500).unwrap();
        assert_eq!(messages.len(), 5);
        let tool: Value = serde_json::from_str(&messages[4].body).unwrap();
        assert_eq!(tool["message"]["toolCallId"], "provider-call");
        assert_eq!(
            serde_json::from_str::<Value>(tool["message"]["content"].as_str().unwrap()).unwrap(),
            expected_result
        );
        let batch = store.checkpoint_batch("A", "run", 2).unwrap().unwrap();
        let state = &batch
            .events
            .iter()
            .find(|event| event.kind == "coordinator_state_v1")
            .unwrap()
            .data;
        assert_eq!(state["contextPlan"], expected_plan);
        assert_eq!(
            state["checkpoint"]["contextRefs"][0]["freshness"],
            "native-stamp-2"
        );
        assert!(
            tool["message"]["content"].as_str().unwrap().len()
                > state["contextPlan"]["maxBytes"].as_u64().unwrap() as usize
        );
        let historical = store.checkpoint_batch("A", "run", 1).unwrap().unwrap();
        assert!(historical.tool_calls[0].result.is_none());
    }
    #[test]
    fn native_run_store_bridge_rejects_stale_revision_foreign_identity_and_authority() {
        let fixture = BridgeFixture::new();
        let store = fixture.store();
        apply_commit(&store, &input(first_commit()), &fixture.project_root()).unwrap();
        let before = store.snapshot("A", "run").unwrap();
        assert_eq!(
            apply_commit(&store, &input(first_commit()), &fixture.project_root())
                .unwrap_err()
                .kind,
            "conflict"
        );
        let mut foreign = first_commit();
        foreign["projectId"] = "B".into();
        assert!(apply_commit(&store, &input(foreign), &fixture.project_root()).is_err());
        let mut authority = first_commit();
        authority["expectedRevision"] = 1.into();
        authority["expectedMessageCount"] = 4.into();
        authority["batch"]["messages"] = serde_json::json!([]);
        authority["batch"]["events"][1]["id"] = "run:state:2".into();
        authority["batch"]["toolCalls"][0]["arguments"]["nested"] =
            serde_json::json!({"Approval-Token":"synthetic"});
        assert!(apply_commit(&store, &input(authority), &fixture.project_root()).is_err());
        assert_eq!(store.snapshot("A", "run").unwrap(), before);
        assert_eq!(store.messages("A", "chat", 0, 500).unwrap().len(), 4);
        assert_eq!(store.projects().unwrap().len(), 1);
    }
    #[test]
    fn native_run_store_bridge_checks_excerpts_against_actual_archived_utf16_contents() {
        let fixture = BridgeFixture::new();
        let store = fixture.store();
        let mut value = first_commit();
        let plan = &mut value["batch"]["events"][1]["data"]["contextPlan"];
        plan["fullRecordMessageCount"] = 4.into();
        plan["segments"].as_array_mut().unwrap().push(serde_json::json!({
            "category":"tool_result","originalMessageIndexes":[3],"selection":"deterministic_excerpt","sources":[],
            "excerpts":[{"messageIndex":3,"start":0,"end":1,"unit":"utf16"}]
        }));
        assert!(apply_commit(&store, &input(value), &fixture.project_root()).is_err());
        assert_eq!(store.run("A", "run").unwrap().revision, 0);
        assert!(store.messages("A", "chat", 0, 500).unwrap().is_empty());
    }
    #[test]
    fn native_run_store_bridge_requires_current_native_project_authority() {
        let rejected = trusted_project("__unregistered_run_store_bridge_test__").unwrap_err();
        assert_eq!(rejected.kind, "untrustedProject");
    }
    #[test]
    fn native_run_history_catalog_and_exact_archive_survive_restart_without_project_trust() {
        let fixture = BridgeFixture::new();
        let store = fixture.store();
        apply_commit(&store, &input(first_commit()), &fixture.project_root()).unwrap();
        apply_commit(&store, &input(observed_commit()), &fixture.project_root()).unwrap();
        // A second run in the same session must never appear in the first run's bodies.
        store
            .start_run(
                "A",
                &NewRun {
                    id: "other-run".into(),
                    session_id: "chat".into(),
                    goal: "Unrelated run".into(),
                    created_at: 102,
                },
            )
            .unwrap();
        store
            .append_messages(
                "A",
                "chat",
                &[NewMessage {
                    id: "other-run:message:1".into(),
                    role: Role::User,
                    body: "UNRELATED SESSION BODY".into(),
                    created_at: 102,
                }],
            )
            .unwrap();
        drop(store);
        // Archive reads must not inspect or require this external project path.
        std::fs::remove_dir(fixture.project_root()).unwrap();
        let store = fixture.store();
        assert!(trusted_project("A").is_err());
        let page = list_history(
            &store,
            &HistoryInput {
                schema_version: 1,
                project_id: None,
                offset: 0,
                limit: 1,
            },
        )
        .unwrap();
        assert_eq!(page.runs.len(), 1);
        assert!(page.has_more);
        assert_eq!(page.runs[0].project_id, "A");
        assert_eq!(page.runs[0].session_id, "chat");
        assert!(page.runs[0].project_root.contains("project"));
        let saved = read_archive(
            &store,
            &SnapshotInput {
                schema_version: 1,
                project_id: "A".into(),
                run_id: "run".into(),
            },
        )
        .unwrap();
        assert!(saved.completeness.complete);
        assert_eq!(saved.messages.len(), 5);
        assert_eq!(saved.completeness.stored_message_count, Some(5));
        assert_eq!(saved.events.len(), 6);
        assert!(!saved
            .messages
            .iter()
            .any(|message| message.body.contains("UNRELATED SESSION BODY")));
        assert!(saved.snapshot.requires_fresh_authorization);
        assert!(!saved.descriptor.has_unresolved_effects);
        assert_eq!(
            read_archive(
                &store,
                &SnapshotInput {
                    schema_version: 1,
                    project_id: "B".into(),
                    run_id: "run".into()
                }
            )
            .unwrap_err()
            .kind,
            "notFound"
        );
        assert!(list_history(
            &store,
            &HistoryInput {
                schema_version: 1,
                project_id: Some("B".into()),
                offset: 0,
                limit: 30
            }
        )
        .unwrap()
        .runs
        .is_empty());
        assert!(list_history(
            &store,
            &HistoryInput {
                schema_version: 1,
                project_id: None,
                offset: 0,
                limit: 101
            }
        )
        .is_err());
    }
    #[test]
    fn native_run_history_unknown_effects_and_oversized_archive_are_explicit() {
        let fixture = BridgeFixture::new();
        let store = fixture.store();
        let mut commit = first_commit();
        let envelope = serde_json::json!({"format":"uagent.provider-message.v1","message":{"role":"user","content":"x".repeat(MAX_ARCHIVE_BODY_BYTES)}}).to_string();
        commit["batch"]["messages"][2]["body"] = envelope.into();
        apply_commit(&store, &input(commit), &fixture.project_root()).unwrap();
        let saved = read_archive(
            &store,
            &SnapshotInput {
                schema_version: 1,
                project_id: "A".into(),
                run_id: "run".into(),
            },
        )
        .unwrap();
        assert!(saved.descriptor.has_unresolved_effects);
        assert!(!saved.completeness.complete);
        assert_eq!(saved.completeness.reason.as_deref(), Some("displayLimit"));
        assert_eq!(saved.completeness.loaded_message_count, 2);
        assert_eq!(saved.completeness.stored_message_count, Some(4));
    }
    #[test]
    fn native_run_history_accepts_descriptive_index_query_sources_without_file_freshness() {
        let value = serde_json::json!({"projectId":"A","path":"Source","version":"index-revision-2","kind":"index_query"});
        source(&value, "A").unwrap();
        assert!(source(&value, "B").is_err());
    }
}
