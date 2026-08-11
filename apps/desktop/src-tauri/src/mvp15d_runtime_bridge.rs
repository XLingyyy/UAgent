use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

pub const BRIDGE_VERSION: &str = "uagent.mvp15d.runtime-bridge.v5";
pub const EVENT_SCHEMA: &str = "uagent.mvp15d.final.runtime-event.v2";
pub const DRIVER_SCHEMA: &str = "uagent.mvp15d.final.driver-command.v1";
const TASK_GENERATION: &str = "final-d13-d16";
const SUBCOMMAND: &str = "mvp15d-final-runtime-bridge";
const ENABLE_ENV: &str = "UAGENT_ENABLE_MVP15D_TASK_BRIDGE";
const PRODUCT_PATH: &str = "validate,add,confirmTrust,observationDiscover,observationAttach,observationReady,Connect,Initialize,Discover,Normalize,Fingerprint,disconnect";
const UI_PATH: &str = "validate,add,confirmTrust,observationDiscover,observationAttach,observationReady,mcpConnect,mcpInitialize,mcpDiscover,mcpNormalize,mcpFingerprint,dryRun,approve,register,execute,verify,crossTtl,rollback,finalVerify,replay,observationStop,mcpDisconnect";
const CAPABILITY_PATH: &str = "capability";
const COMPILED_SOURCE_COMMIT: &str = env!("UAGENT_SOURCE_COMMIT");
const COMPILED_SOURCE_TREE_SHA256: &str = env!("UAGENT_SOURCE_TREE_SHA256");
const COMPILED_SOURCE_DIRTY_TEXT: &str = env!("UAGENT_SOURCE_DIRTY");
const COMPILED_SOURCE_HEAD_REF: &str = env!("UAGENT_SOURCE_HEAD_REF");

/// The compiled binary's working-tree dirty state (from the build script).
/// `build.rs` emits exactly `"true"` or `"false"`.
fn compiled_source_dirty() -> bool {
    COMPILED_SOURCE_DIRTY_TEXT == "true"
}
const ARGUMENT_KEYS: [&str; 16] = [
    "--phase",
    "--mode",
    "--task-generation",
    "--task-id",
    "--source-commit",
    "--repository",
    "--evidence-root",
    "--marker",
    "--session",
    "--generation",
    "--endpoint",
    "--port",
    "--nonce-file",
    "--event-file",
    "--driver-file",
    "--rendered-product-path",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BridgePhase {
    CapabilityProbe,
    ProductCapture,
    UiLifecycle,
}

impl BridgePhase {
    fn parse(value: &str) -> Result<Self, BridgeError> {
        match value {
            "capability-probe" => Ok(Self::CapabilityProbe),
            "product-capture" => Ok(Self::ProductCapture),
            "ui-lifecycle" => Ok(Self::UiLifecycle),
            _ => Err(BridgeError::new("MVP15D_BRIDGE_PHASE_INVALID")),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::CapabilityProbe => "capability-probe",
            Self::ProductCapture => "product-capture",
            Self::UiLifecycle => "ui-lifecycle",
        }
    }

    fn expected_path(self) -> &'static str {
        match self {
            Self::CapabilityProbe => CAPABILITY_PATH,
            Self::ProductCapture => PRODUCT_PATH,
            Self::UiLifecycle => UI_PATH,
        }
    }

    fn rendered(self) -> bool {
        !matches!(self, Self::CapabilityProbe)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BridgeMode {
    CapabilityOnly,
    Live,
}

impl BridgeMode {
    fn parse(value: &str) -> Result<Self, BridgeError> {
        match value {
            "capability-only" => Ok(Self::CapabilityOnly),
            "live" => Ok(Self::Live),
            _ => Err(BridgeError::new("MVP15D_BRIDGE_MODE_INVALID")),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::CapabilityOnly => "capability-only",
            Self::Live => "live",
        }
    }
}

#[derive(Debug)]
pub struct BridgeError {
    code: &'static str,
}

impl BridgeError {
    fn new(code: &'static str) -> Self {
        Self { code }
    }

    pub fn code(&self) -> &'static str {
        self.code
    }
}

#[derive(Debug, Clone)]
struct ParsedArguments {
    phase: BridgePhase,
    mode: BridgeMode,
    task_id: String,
    source_commit: String,
    repository: PathBuf,
    evidence_root: PathBuf,
    marker: String,
    session: String,
    generation: u64,
    endpoint: String,
    port: u16,
    nonce_file: PathBuf,
    event_file: PathBuf,
    driver_file: PathBuf,
    rendered_product_path: String,
}

#[derive(Debug, Clone)]
pub struct BridgeIdentity {
    phase: BridgePhase,
    mode: BridgeMode,
    task_id: String,
    source_commit: String,
    source_tree_sha256: String,
    source_dirty: bool,
    source_head_ref: String,
    marker: String,
    session: String,
    generation: u64,
    endpoint: String,
    port: u16,
    evidence_root: PathBuf,
    event_file: PathBuf,
    driver_file: PathBuf,
    rendered_product_path: String,
    nonce_sha256: String,
    executable_basename: String,
    executable_sha256: String,
    pid: u32,
}

#[derive(Debug)]
pub enum Startup {
    Ordinary,
    CapabilityCompleted,
    Rendered(BridgeState),
}

#[derive(Debug)]
pub struct BridgeState {
    identity: BridgeIdentity,
    file: File,
    next_step: usize,
    driver_claimed: bool,
    structured_evidence_published: bool,
    completed: bool,
    last_native_transition_sequence: u64,
    renderer_handoff: Option<RendererRestartHandoff>,
    renderer_publish_authority: bool,
}

#[derive(Debug, Clone)]
struct RendererRestartHandoff {
    handoff_id: String,
    predecessor_window_instance_binding_sha256: Option<String>,
    predecessor_renderer: Value,
    predecessor_mcp_session_id: String,
    predecessor_mcp_generation: u64,
    segment: Value,
    request_receipt_id: String,
    request_receipt_request: Value,
    parent_acknowledgement: Option<RendererParentLifecycleAcknowledgement>,
    claimed: bool,
}

#[derive(Debug, Clone)]
struct RendererParentLifecycleAcknowledgement {
    status: String,
    predecessor_window: RendererPredecessorWindowIdentity,
    receipt_id: String,
    receipt_request: Value,
    receipt_sequence: u64,
    receipt_response: Value,
    consumed: bool,
}

const OBSERVATION_RECEIPT_SCHEMA: &str = "uagent.mvp15d.native-observation-receipt.v2";
const MCP_OBSERVATION_INTENT_SCHEMA: &str = "uagent.mvp15d.mcp-observation-intent.v1";
const MVP15D_TOOL_NAMES: [&str; 6] = [
    "ue.asset.create_folder",
    "ue.asset.duplicate",
    "ue.asset.rename",
    "ue.asset.move",
    "ue.asset.delete",
    "ue.asset.save",
];
const MVP15D_RETRACTION_REASONS: [&str; 6] = [
    "disconnect",
    "endpoint_change",
    "failure",
    "newer_generation",
    "attestation_invalidation",
    "renderer_restart",
];
pub(crate) const RENDERER_PREDECESSOR_WINDOW_LABEL: &str = "main";

#[derive(Debug, Clone)]
struct ObservationReceiptContext {
    task_id: String,
    phase: BridgePhase,
    session: String,
    generation: u64,
    runtime_pid: u32,
    runtime_process_identity_sha256: String,
    nonce_sha256: String,
}

#[derive(Debug, Clone)]
struct ObservationReceiptRecord {
    context: ObservationReceiptContext,
    sequence: u64,
    api: String,
    request: Value,
    response: Value,
    claimed: bool,
    consumed: bool,
}

#[derive(Debug, Default)]
struct ObservationReceiptLedger {
    context: Option<ObservationReceiptContext>,
    sequence: u64,
    records: HashMap<String, ObservationReceiptRecord>,
}

fn observation_receipt_ledger() -> &'static Mutex<ObservationReceiptLedger> {
    static LEDGER: std::sync::OnceLock<Mutex<ObservationReceiptLedger>> =
        std::sync::OnceLock::new();
    LEDGER.get_or_init(|| Mutex::new(ObservationReceiptLedger::default()))
}

fn activate_observation_receipt_ledger(identity: &BridgeIdentity) -> Result<(), BridgeError> {
    let mut ledger = observation_receipt_ledger()
        .lock()
        .map_err(|_| BridgeError::new("MVP15D_BRIDGE_RECEIPT_LEDGER_UNAVAILABLE"))?;
    ledger.context = (identity.mode == BridgeMode::Live && identity.phase.rendered()).then(|| {
        ObservationReceiptContext {
            task_id: identity.task_id.clone(),
            phase: identity.phase,
            session: identity.session.clone(),
            generation: identity.generation,
            runtime_pid: identity.pid,
            runtime_process_identity_sha256: sha256_bytes(
                canonical_json(&json!({
                    "pid": identity.pid,
                    "executableBasename": identity.executable_basename,
                    "executableSha256": identity.executable_sha256,
                }))
                .as_bytes(),
            ),
            nonce_sha256: identity.nonce_sha256.clone(),
        }
    });
    ledger.sequence = 0;
    ledger.records.clear();
    Ok(())
}

fn receipt_response_basis(response: &Value, receipt_id: Option<&str>) -> Value {
    let mut basis = response.clone();
    if let Some(object) = basis.as_object_mut() {
        for key in ["evidenceId", "observationReceiptId", "receiptId"] {
            if object.get(key).and_then(Value::as_str) == receipt_id {
                object.remove(key);
            }
        }
    }
    basis
}

fn next_observation_receipt_id(
    context: &ObservationReceiptContext,
    sequence: u64,
    api: &str,
    request: &Value,
    response: &Value,
) -> String {
    let digest = sha256_bytes(
        canonical_json(&json!({
            "schemaVersion": OBSERVATION_RECEIPT_SCHEMA,
            "taskId": context.task_id,
            "phase": context.phase.as_str(),
            "session": context.session,
            "generation": context.generation,
            "runtimePid": context.runtime_pid,
            "runtimeProcessIdentitySha256": context.runtime_process_identity_sha256,
            "nonceSha256": context.nonce_sha256,
            "sequence": sequence,
            "api": api,
            "request": request,
            "response": response,
        }))
        .as_bytes(),
    );
    format!("mvp15d-observation-receipt:{digest}")
}

/// Append-only, read-only evidence hook used by existing native commands while
/// the private fixed-driver bridge is active. It never changes guard policy or
/// command results; callers attach the opaque ID to the already-produced result.
pub(crate) fn issue_native_observation_receipt(
    api: &str,
    request: Value,
    response: Value,
) -> Option<String> {
    let mut ledger = observation_receipt_ledger().lock().ok()?;
    let context = ledger.context.clone()?;
    ledger.sequence = ledger.sequence.checked_add(1)?;
    let sequence = ledger.sequence;
    let response = receipt_response_basis(&response, None);
    let receipt_id = next_observation_receipt_id(&context, sequence, api, &request, &response);
    ledger.records.insert(
        receipt_id.clone(),
        ObservationReceiptRecord {
            context,
            sequence,
            api: api.to_string(),
            request,
            response,
            // Native commands return this opaque ID as part of the result, so the
            // record is already released to the fixed renderer.  The publisher
            // still consumes it exactly once below.
            claimed: true,
            consumed: false,
        },
    );
    Some(receipt_id)
}

fn issue_renderer_parent_lifecycle_receipt(
    request: Value,
    response: Value,
) -> Option<(String, u64, Value)> {
    let mut ledger = observation_receipt_ledger().lock().ok()?;
    let context = ledger.context.clone()?;
    ledger.sequence = ledger.sequence.checked_add(1)?;
    let sequence = ledger.sequence;
    let mut response = receipt_response_basis(&response, None);
    response
        .as_object_mut()?
        .insert("sequence".to_string(), Value::from(sequence));
    let api = "renderer_parent_lifecycle_acknowledgement";
    let receipt_id = next_observation_receipt_id(&context, sequence, api, &request, &response);
    ledger.records.insert(
        receipt_id.clone(),
        ObservationReceiptRecord {
            context,
            sequence,
            api: api.to_string(),
            request,
            response: response.clone(),
            claimed: true,
            consumed: false,
        },
    );
    Some((receipt_id, sequence, response))
}

pub(crate) fn validate_managed_process_owner(
    task_id: &str,
    phase: &str,
) -> Result<(), &'static str> {
    let ledger = observation_receipt_ledger()
        .lock()
        .map_err(|_| "native_authority_unavailable")?;
    let context = ledger
        .context
        .as_ref()
        .ok_or("managed_process_context_required")?;
    if context.task_id != task_id || context.phase.as_str() != phase || phase != "ui-lifecycle" {
        return Err("managed_process_owner_mismatch");
    }
    Ok(())
}

fn validate_mcp_observation_intent(
    intent: &crate::mcp::McpObservationIntent,
) -> Result<ObservationReceiptContext, BridgeError> {
    let ledger = observation_receipt_ledger()
        .lock()
        .map_err(|_| BridgeError::new("MVP15D_BRIDGE_RECEIPT_LEDGER_UNAVAILABLE"))?;
    let context = ledger
        .context
        .clone()
        .ok_or_else(|| BridgeError::new("MVP15D_MCP_OBSERVATION_CONTEXT_INVALID"))?;
    if intent.schema_version != MCP_OBSERVATION_INTENT_SCHEMA
        || intent.task_id != context.task_id
        || intent.phase != context.phase.as_str()
        || intent.phase_session_id != context.session
        || intent.phase_generation != context.generation
        || intent.connection_generation == 0
        || !matches!(intent.tool_search_mode.as_str(), "on" | "off" | "ui")
    {
        return Err(BridgeError::new("MVP15D_MCP_OBSERVATION_CONTEXT_INVALID"));
    }
    Ok(context)
}

fn parse_mcp_json_body(body: &str) -> Result<Value, BridgeError> {
    if let Ok(value) = serde_json::from_str::<Value>(body) {
        return value
            .is_object()
            .then_some(value)
            .ok_or_else(|| BridgeError::new("MVP15D_MCP_OBSERVATION_BODY_INVALID"));
    }
    for line in body.lines() {
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        if let Ok(value) = serde_json::from_str::<Value>(data.trim()) {
            if value.is_object() {
                return Ok(value);
            }
        }
    }
    Err(BridgeError::new("MVP15D_MCP_OBSERVATION_BODY_INVALID"))
}

fn native_mcp_request_basis(input: &crate::mcp::McpHttpRequestInput) -> Result<Value, BridgeError> {
    let intent = input
        .observation
        .as_ref()
        .ok_or_else(|| BridgeError::new("MVP15D_MCP_OBSERVATION_CONTEXT_INVALID"))?;
    validate_mcp_observation_intent(intent)?;
    let (http_method, body) = match input.method {
        crate::mcp::McpHttpMethod::Post => ("POST", parse_mcp_json_body(&input.body)?),
        crate::mcp::McpHttpMethod::Delete if input.body.is_empty() => ("DELETE", Value::Null),
        crate::mcp::McpHttpMethod::Delete => {
            return Err(BridgeError::new("MVP15D_MCP_OBSERVATION_BODY_INVALID"))
        }
    };
    Ok(json!({
        "schemaVersion": "uagent.mvp15d.native-mcp-request.v2",
        "httpMethod": http_method,
        "endpoint": input.endpoint,
        "body": body,
        "protocolVersion": input.protocol_version.as_deref().unwrap_or("2025-06-18"),
        "sessionId": input.session_id,
        "timeoutMs": input.timeout_ms.unwrap_or(5_000).clamp(500, 30_000),
        "intent": intent,
    }))
}

fn native_mcp_response_basis(
    input: &crate::mcp::McpHttpRequestInput,
    result: &crate::mcp::McpHttpRequestResult,
) -> Result<Value, BridgeError> {
    if result.method != input.method {
        return Err(BridgeError::new("MVP15D_MCP_OBSERVATION_REQUEST_INVALID"));
    }
    if input.method == crate::mcp::McpHttpMethod::Delete {
        let status = if (200..300).contains(&result.status) {
            "accepted"
        } else if result.status == 405 {
            "unsupported"
        } else {
            "failed"
        };
        return Ok(json!({
            "status": status,
            "httpStatus": result.status,
            "body": result.body,
            "contentType": result.content_type,
            "mcpSessionId": input.session_id,
            "responseSessionId": result.session_id,
            "responseProtocolVersion": result.protocol_version,
            "runtimePid": std::process::id(),
        }));
    }
    let parsed_body = parse_mcp_json_body(&result.body)?;
    Ok(json!({
        "status": result.status,
        "body": result.body,
        "parsedBody": parsed_body,
        "contentType": result.content_type,
        "sessionId": result.session_id,
        "responseProtocolVersion": result.protocol_version,
        "runtimePid": std::process::id(),
    }))
}

fn mcp_request_method_and_name(request: &Value) -> Result<(&str, Option<&str>), BridgeError> {
    let http_method = string_field(
        request,
        "httpMethod",
        "MVP15D_MCP_OBSERVATION_REQUEST_INVALID",
    )?;
    if http_method == "DELETE" {
        return Ok(("DELETE", None));
    }
    if http_method != "POST" {
        return Err(BridgeError::new("MVP15D_MCP_OBSERVATION_REQUEST_INVALID"));
    }
    let body = object_field(request, "body", "MVP15D_MCP_OBSERVATION_REQUEST_INVALID")?;
    let method = string_field(body, "method", "MVP15D_MCP_OBSERVATION_REQUEST_INVALID")?;
    let name = body
        .as_object()
        .and_then(|record| record.get("params"))
        .and_then(Value::as_object)
        .and_then(|params| params.get("name"))
        .and_then(Value::as_str);
    Ok((method, name))
}

pub(crate) fn attach_native_mcp_transport_observation(
    input: &crate::mcp::McpHttpRequestInput,
    result: &mut crate::mcp::McpHttpRequestResult,
) -> Result<(), String> {
    if input.observation.is_none() {
        return Ok(());
    }
    let request = native_mcp_request_basis(input).map_err(|error| error.code().to_string())?;
    let response =
        native_mcp_response_basis(input, result).map_err(|error| error.code().to_string())?;
    let (method, name) =
        mcp_request_method_and_name(&request).map_err(|error| error.code().to_string())?;
    let apis: &[&str] = match (method, name) {
        ("DELETE", _) => &["mcp_disconnect"],
        ("initialize", _) => &["mcp_configure_tool_search", "mcp_connect", "mcp_initialize"],
        ("tools/list", _) => &["mcp_discover", "mcp_normalize", "mcp_fingerprint"],
        ("tools/call", Some("list_toolsets" | "describe_toolset" | "call_tool")) => {
            &["mcp_tool_search_call"]
        }
        ("tools/call", Some(_)) => &["mcp_asset_tool_call"],
        _ => &["mcp_auxiliary_transport"],
    };
    let mut receipts = HashMap::new();
    for api in apis {
        let receipt_id = issue_native_observation_receipt(api, request.clone(), response.clone())
            .ok_or_else(|| "MVP15D_BRIDGE_RECEIPT_LEDGER_UNAVAILABLE".to_string())?;
        receipts.insert((*api).to_string(), receipt_id);
    }
    result.observation_request = Some(request);
    result.observation_receipts = Some(receipts);
    Ok(())
}

pub(crate) fn record_native_mcp_transport_failure(
    input: &crate::mcp::McpHttpRequestInput,
    error: &str,
) {
    if input.observation.is_none() {
        return;
    }
    let Ok(request) = native_mcp_request_basis(input) else {
        return;
    };
    let api = if input.method == crate::mcp::McpHttpMethod::Delete {
        "mcp_disconnect"
    } else {
        "mcp_transport_failure"
    };
    let response = if input.method == crate::mcp::McpHttpMethod::Delete {
        json!({
            "status": "failed",
            "httpStatus": Value::Null,
            "mcpSessionId": input.session_id,
            "reason": error,
            "runtimePid": std::process::id(),
        })
    } else {
        json!({
            "status": "failed",
            "reason": error,
            "runtimePid": std::process::id(),
        })
    };
    let _ = issue_native_observation_receipt(api, request, response);
}

fn consume_observation_receipt(
    identity: &BridgeIdentity,
    receipt_id: &str,
    expected_api: &str,
    request: &Value,
    code: &'static str,
) -> Result<ObservationReceiptRecord, BridgeError> {
    let mut ledger = observation_receipt_ledger()
        .lock()
        .map_err(|_| BridgeError::new("MVP15D_BRIDGE_RECEIPT_LEDGER_UNAVAILABLE"))?;
    let record = ledger
        .records
        .get_mut(receipt_id)
        .ok_or_else(|| BridgeError::new(code))?;
    if !record.claimed
        || record.consumed
        || record.api != expected_api
        || record.context.task_id != identity.task_id
        || record.context.phase != identity.phase
        || record.context.session != identity.session
        || record.context.generation != identity.generation
        || record.context.runtime_pid != identity.pid
        || record.request != *request
    {
        return Err(BridgeError::new(code));
    }
    record.consumed = true;
    Ok(record.clone())
}

fn inspect_observation_receipt(
    identity: &BridgeIdentity,
    input: &RawObservedCallInput,
    api: &str,
    code: &'static str,
) -> Result<ObservationReceiptRecord, BridgeError> {
    let ledger = observation_receipt_ledger()
        .lock()
        .map_err(|_| BridgeError::new(code))?;
    let record = ledger
        .records
        .get(&input.receipt_id)
        .cloned()
        .ok_or_else(|| BridgeError::new(code))?;
    if record.api != api
        || record.request != input.request
        || record.consumed
        || !record.claimed
        || record.context.task_id != identity.task_id
        || record.context.phase != identity.phase
        || record.context.session != identity.session
        || record.context.generation != identity.generation
    {
        return Err(BridgeError::new(code));
    }
    Ok(record)
}

fn consume_allowed_observation_receipt(
    identity: &BridgeIdentity,
    receipt_id: &str,
    request: &Value,
    allowed_apis: &[&str],
    code: &'static str,
) -> Result<ObservationReceiptRecord, BridgeError> {
    let api = observation_receipt_ledger()
        .lock()
        .map_err(|_| BridgeError::new("MVP15D_BRIDGE_RECEIPT_LEDGER_UNAVAILABLE"))?
        .records
        .get(receipt_id)
        .map(|record| record.api.clone())
        .ok_or_else(|| BridgeError::new(code))?;
    if !allowed_apis.contains(&api.as_str()) {
        return Err(BridgeError::new(code));
    }
    consume_observation_receipt(identity, receipt_id, &api, request, code)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererBridgeConfiguration {
    pub enabled: bool,
    pub bridge_version: &'static str,
    pub phase: String,
    pub mode: String,
    pub task_id: String,
    pub session: String,
    pub generation: u64,
    pub endpoint: Option<String>,
    pub project_root: Option<String>,
    pub rendered_product_path: String,
    pub driver_poll_milliseconds: u32,
    pub observation_timeout_milliseconds: u32,
    pub approval_ttl_wait_milliseconds: u32,
    pub receipt_ledger_enabled: bool,
    pub renderer_handoff_pending: bool,
    pub renderer_handoff_id: Option<String>,
    pub renderer_parent_lifecycle_status: Option<String>,
    pub renderer_parent_lifecycle_failure: Option<String>,
    pub renderer_handoff_predecessor_mcp_generation: Option<u64>,
    pub renderer_handoff_predecessor_window_identity_sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RendererRestartRequestInput {
    pub schema_version: String,
    pub task_id: String,
    pub phase: String,
    pub renderer_before: RawObservedCallInput,
    pub predecessor_mcp_session_id: String,
    pub predecessor_mcp_generation: u64,
    pub segment: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererRestartRequestResult {
    pub schema_version: String,
    pub handoff_id: String,
    pub request_receipt_id: String,
    pub task_id: String,
    pub phase: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RendererParentLifecycleActionOutcome {
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RendererPredecessorWindowIdentity {
    pub schema_version: String,
    pub status: String,
    pub window_label: String,
    pub task_id: String,
    pub phase: String,
    pub handoff_id: String,
    pub stable_identity_sha256: String,
}

impl RendererParentLifecycleActionOutcome {
    pub fn succeeded() -> Self {
        Self {
            status: "succeeded".to_string(),
            reason: None,
        }
    }

    pub fn failed(reason: &'static str) -> Self {
        Self {
            status: "failed".to_string(),
            reason: Some(reason.to_string()),
        }
    }

    pub fn not_attempted(reason: &'static str) -> Self {
        Self {
            status: "not_attempted".to_string(),
            reason: Some(reason.to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RendererParentLifecycleAcknowledgementInput {
    pub schema_version: String,
    pub handoff_id: String,
    pub task_id: String,
    pub phase: String,
    pub predecessor_window: RendererPredecessorWindowIdentity,
    pub destroy_outcome: RendererParentLifecycleActionOutcome,
    pub successor_creation_outcome: RendererParentLifecycleActionOutcome,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererParentLifecycleAcknowledgementResult {
    pub schema_version: String,
    pub status: String,
    pub failure_reason: Option<String>,
    pub handoff_id: String,
    pub receipt_id: String,
    pub receipt_request: Value,
    pub receipt_sequence: u64,
    pub parent_runtime: Value,
    pub predecessor_renderer: Value,
    pub predecessor_window: RendererPredecessorWindowIdentity,
    pub destroy_outcome: RendererParentLifecycleActionOutcome,
    pub successor_creation_outcome: RendererParentLifecycleActionOutcome,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RendererRestartClaimInput {
    pub schema_version: String,
    pub handoff_id: String,
    pub task_id: String,
    pub phase: String,
    pub predecessor_window_identity_sha256: String,
    pub renderer_after: RawObservedCallInput,
    pub successor_mcp_session_id: String,
    pub successor_mcp_generation: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererRestartClaimResult {
    pub schema_version: String,
    pub handoff_id: String,
    pub claim_receipt_id: String,
    pub request_receipt_id: String,
    pub request_receipt_request: Value,
    pub parent_acknowledgement_receipt_id: String,
    pub parent_acknowledgement_receipt_request: Value,
    pub parent_acknowledgement_receipt_sequence: u64,
    pub claim_receipt_request: Value,
    pub segment: Value,
    pub predecessor_window: RendererPredecessorWindowIdentity,
    pub predecessor_renderer: Value,
    pub successor_renderer: Value,
    pub predecessor_mcp_session_id: String,
    pub successor_mcp_session_id: String,
    pub predecessor_mcp_generation: u64,
    pub successor_mcp_generation: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct DriverCommand {
    schema_version: String,
    task_id: String,
    phase: String,
    session: String,
    generation: u64,
    nonce_sha256: String,
    command: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RendererStepInput {
    pub step: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererStepResult {
    pub accepted: bool,
    pub next_step: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductToolDescriptor {
    name: String,
    schema_version: String,
    input_schema: Value,
    dry_run_schema: Value,
    rollback_contract: Value,
    affected_assets_schema: Value,
    evidence_query: Value,
    source: String,
    method_id: Option<String>,
    toolset_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductMutationCalls {
    dry_run: u64,
    execute: u64,
    rollback: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RawObservedCallInput {
    receipt_id: String,
    request: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ObserveNativeStateInput {
    schema_version: String,
    kind: String,
    request: Value,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ObserveNativeStateResult {
    schema_version: &'static str,
    receipt_id: String,
    request: Value,
    observation: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductDiscoveryInput {
    mode: String,
    config_call: RawObservedCallInput,
    renderer_instance_call: RawObservedCallInput,
    connect_call: RawObservedCallInput,
    initialize_call: RawObservedCallInput,
    discover_call: RawObservedCallInput,
    normalize_call: RawObservedCallInput,
    fingerprint_call: RawObservedCallInput,
    native_attestation: RawObservedCallInput,
    mutation_counter_call: RawObservedCallInput,
    tool_search_calls: Vec<RawObservedCallInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductRetractionInput {
    reason: String,
    ready_discovery: ProductDiscoveryInput,
    renderer_instance_call: RawObservedCallInput,
    transition_call: RawObservedCallInput,
    native_retraction: RawObservedCallInput,
    renderer_handoff: Option<RendererHandoffEvidenceInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RendererHandoffEvidenceInput {
    request_call: RawObservedCallInput,
    parent_acknowledgement_call: RawObservedCallInput,
    claim_call: RawObservedCallInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProductStoreEvidenceInput {
    schema_version: String,
    status: String,
    reason: Option<String>,
    discoveries: Vec<ProductDiscoveryInput>,
    retractions: Vec<ProductRetractionInput>,
    mutation_before: ProductMutationCalls,
    mutation_after: ProductMutationCalls,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OperationLedgerInput {
    dry_run_actions: u64,
    dry_run_calls: u64,
    native_registrations: u64,
    native_execute_guards: u64,
    execute_calls: u64,
    verify_mutations: u64,
    native_rollback_guards: u64,
    rollback_calls: u64,
    registration_id: Option<String>,
    change_set_id: Option<String>,
    run_id: Option<String>,
    content_observation_count: u64,
    baseline_content_sha256: Option<String>,
    latest_content_sha256: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FinalVerificationInput {
    status: String,
    restored: bool,
    baseline_sha256: Option<String>,
    observed_sha256: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReplayInspectionInput {
    recorded_representation: Value,
    recorded_representation_receipt: RawObservedCallInput,
    counter_names: Vec<String>,
    counters_before: Vec<u64>,
    counters_after: Vec<u64>,
    counter_read_before: RawObservedCallInput,
    counter_read_after: RawObservedCallInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LifecycleOperationInput {
    direction: String,
    action: String,
    operation_id: String,
    registration_id: String,
    run_id: String,
    native_call: RawObservedCallInput,
    mcp_call: RawObservedCallInput,
    side_effect_count: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContentManifestInput {
    stage: String,
    registration_id: String,
    run_id: String,
    receipt_id: String,
    request: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NegativeCaseInput {
    case_id: String,
    session_id: String,
    native_session_id: String,
    run_id: String,
    registration_id: String,
    guard_api: String,
    session_begin: RawObservedCallInput,
    registration_call: RawObservedCallInput,
    guard_call: RawObservedCallInput,
    content_before: ContentManifestInput,
    content_after: ContentManifestInput,
    counters_before: Vec<u64>,
    counters_after: Vec<u64>,
    counter_read_before: RawObservedCallInput,
    counter_read_after: RawObservedCallInput,
    observation_stop: RawObservedCallInput,
    mcp_disconnect: RawObservedCallInput,
    setup_calls: Vec<RawObservedCallInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PartialOperationInput {
    direction: String,
    action: String,
    api: String,
    receipt_id: String,
    request: Value,
    setup_calls: Vec<RawObservedCallInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PartialUnknownInput {
    session_id: String,
    native_session_id: String,
    run_id: String,
    registration_id: String,
    session_begin: RawObservedCallInput,
    registration_call: RawObservedCallInput,
    operation_results: Vec<PartialOperationInput>,
    content_before: ContentManifestInput,
    content_after: ContentManifestInput,
    counters_before: Vec<u64>,
    counters_after: Vec<u64>,
    counter_read_before: RawObservedCallInput,
    counter_read_after: RawObservedCallInput,
    observation_stop: RawObservedCallInput,
    mcp_disconnect: RawObservedCallInput,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UiStoreEvidenceInput {
    schema_version: String,
    status: String,
    reason: Option<String>,
    ledger: OperationLedgerInput,
    change_set_state: Option<String>,
    forward_actions: Vec<String>,
    inverse_actions: Vec<String>,
    final_verification: FinalVerificationInput,
    operations: Vec<LifecycleOperationInput>,
    content_manifests: Vec<ContentManifestInput>,
    negative_cases: Vec<NegativeCaseInput>,
    partial_unknown: PartialUnknownInput,
    replay_inspection: ReplayInspectionInput,
}

fn os_to_string(value: OsString) -> Result<String, BridgeError> {
    value
        .into_string()
        .map_err(|_| BridgeError::new("MVP15D_BRIDGE_ARGUMENT_ENCODING_INVALID"))
}

fn parse_arguments(values: Vec<OsString>) -> Result<Option<ParsedArguments>, BridgeError> {
    if values.is_empty() {
        return Ok(None);
    }
    let values = values
        .into_iter()
        .map(os_to_string)
        .collect::<Result<Vec<_>, _>>()?;
    if values[0] != SUBCOMMAND {
        return Ok(None);
    }
    if values.len() != 1 + ARGUMENT_KEYS.len() * 2 {
        return Err(BridgeError::new("MVP15D_BRIDGE_ARGUMENT_VECTOR_INVALID"));
    }
    let mut parsed = Vec::with_capacity(ARGUMENT_KEYS.len());
    for (index, expected) in ARGUMENT_KEYS.iter().enumerate() {
        let key = &values[1 + index * 2];
        let value = &values[2 + index * 2];
        if key != expected || value.is_empty() || value.starts_with("--") {
            return Err(BridgeError::new("MVP15D_BRIDGE_ARGUMENT_VECTOR_INVALID"));
        }
        parsed.push(value.clone());
    }

    let phase = BridgePhase::parse(&parsed[0])?;
    let mode = BridgeMode::parse(&parsed[1])?;
    if phase == BridgePhase::CapabilityProbe && mode != BridgeMode::CapabilityOnly {
        return Err(BridgeError::new("MVP15D_BRIDGE_MODE_INVALID"));
    }
    if parsed[2] != TASK_GENERATION {
        return Err(BridgeError::new("MVP15D_BRIDGE_TASK_GENERATION_INVALID"));
    }
    if !is_task_id(&parsed[3]) {
        return Err(BridgeError::new("MVP15D_BRIDGE_TASK_ID_INVALID"));
    }
    if !is_lower_hex(&parsed[4], 40) {
        return Err(BridgeError::new("MVP15D_BRIDGE_SOURCE_COMMIT_INVALID"));
    }
    if parsed[4] != COMPILED_SOURCE_COMMIT {
        return Err(BridgeError::new("MVP15D_BRIDGE_SOURCE_COMMIT_MISMATCH"));
    }
    if !is_binding_token(&parsed[7], 24, 160) || !is_binding_token(&parsed[8], 16, 160) {
        return Err(BridgeError::new("MVP15D_BRIDGE_BINDING_INVALID"));
    }
    let generation = parsed[9]
        .parse::<u64>()
        .ok()
        .filter(|value| *value > 0)
        .ok_or_else(|| BridgeError::new("MVP15D_BRIDGE_GENERATION_INVALID"))?;
    let port = parsed[11]
        .parse::<u16>()
        .ok()
        .filter(|value| *value >= 1024)
        .ok_or_else(|| BridgeError::new("MVP15D_BRIDGE_PORT_INVALID"))?;
    if parsed[10] != format!("http://127.0.0.1:{port}/mcp") {
        return Err(BridgeError::new("MVP15D_BRIDGE_ENDPOINT_INVALID"));
    }
    if parsed[15] != phase.expected_path() {
        return Err(BridgeError::new("MVP15D_BRIDGE_RENDERED_PATH_INVALID"));
    }

    Ok(Some(ParsedArguments {
        phase,
        mode,
        task_id: parsed[3].clone(),
        source_commit: parsed[4].clone(),
        repository: PathBuf::from(&parsed[5]),
        evidence_root: PathBuf::from(&parsed[6]),
        marker: parsed[7].clone(),
        session: parsed[8].clone(),
        generation,
        endpoint: parsed[10].clone(),
        port,
        nonce_file: PathBuf::from(&parsed[12]),
        event_file: PathBuf::from(&parsed[13]),
        driver_file: PathBuf::from(&parsed[14]),
        rendered_product_path: parsed[15].clone(),
    }))
}

fn is_task_id(value: &str) -> bool {
    let suffix = value.strip_prefix("TASK-MVP15D-");
    suffix.is_some_and(|suffix| {
        !suffix.is_empty()
            && suffix
                .bytes()
                .all(|value| value.is_ascii_uppercase() || value.is_ascii_digit() || value == b'-')
    })
}

fn is_lower_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|value| value.is_ascii_digit() || (b'a'..=b'f').contains(&value))
}

fn is_binding_token(value: &str, minimum: usize, maximum: usize) -> bool {
    (minimum..=maximum).contains(&value.len())
        && value.bytes().all(|value| {
            value.is_ascii_alphanumeric() || matches!(value, b'.' | b'_' | b':' | b'-')
        })
}

fn canonical_directory(path: &Path, code: &'static str) -> Result<PathBuf, BridgeError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| BridgeError::new(code))?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(BridgeError::new(code));
    }
    fs::canonicalize(path).map_err(|_| BridgeError::new(code))
}

fn simple_root_name(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let Some(rest) = name.strip_prefix("mvp15d-final-d13-d16-") else {
        return false;
    };
    if rest.len() < 15 {
        return false;
    }
    let timestamp = &rest[..15];
    timestamp.as_bytes()[8] == b'_'
        && timestamp
            .bytes()
            .enumerate()
            .all(|(index, value)| index == 8 || value.is_ascii_digit())
        && rest[15..]
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'-')
}

fn validate_child_path(
    evidence_root: &Path,
    path: &Path,
    must_exist: bool,
    code: &'static str,
) -> Result<PathBuf, BridgeError> {
    if !path.is_absolute()
        || path
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(BridgeError::new(code));
    }
    let parent = path.parent().ok_or_else(|| BridgeError::new(code))?;
    let canonical_parent = canonical_directory(parent, code)?;
    if !canonical_parent.starts_with(evidence_root) || canonical_parent == evidence_root {
        return Err(BridgeError::new(code));
    }
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty() && !value.contains(['/', '\\']))
        .ok_or_else(|| BridgeError::new(code))?;
    let resolved = canonical_parent.join(name);
    if must_exist {
        let metadata = fs::symlink_metadata(&resolved).map_err(|_| BridgeError::new(code))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(BridgeError::new(code));
        }
    } else if fs::symlink_metadata(&resolved).is_ok() {
        return Err(BridgeError::new(code));
    }
    Ok(resolved)
}

fn sha256_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn canonical_json(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(value) => value.to_string(),
        Value::Number(value) => value.to_string(),
        Value::String(value) => serde_json::to_string(value).expect("string serialization"),
        Value::Array(values) => format!(
            "[{}]",
            values
                .iter()
                .map(canonical_json)
                .collect::<Vec<_>>()
                .join(",")
        ),
        Value::Object(values) => {
            let mut keys = values.keys().collect::<Vec<_>>();
            keys.sort_unstable();
            format!(
                "{{{}}}",
                keys.iter()
                    .map(|key| format!(
                        "{}:{}",
                        serde_json::to_string(key).expect("key serialization"),
                        canonical_json(&values[*key])
                    ))
                    .collect::<Vec<_>>()
                    .join(",")
            )
        }
    }
}

fn sha256_file(path: &Path) -> Result<String, BridgeError> {
    let mut file =
        File::open(path).map_err(|_| BridgeError::new("MVP15D_BRIDGE_EXECUTABLE_INVALID"))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| BridgeError::new("MVP15D_BRIDGE_EXECUTABLE_INVALID"))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn consume_nonce(path: &Path) -> Result<String, BridgeError> {
    let bytes = fs::read(path).map_err(|_| BridgeError::new("MVP15D_BRIDGE_NONCE_INVALID"))?;
    let text = std::str::from_utf8(&bytes)
        .ok()
        .map(str::trim)
        .filter(|value| is_lower_hex(value, 64))
        .ok_or_else(|| BridgeError::new("MVP15D_BRIDGE_NONCE_INVALID"))?;
    let consumed = path.with_extension(format!("consumed-{}", std::process::id()));
    if consumed.exists() {
        return Err(BridgeError::new("MVP15D_BRIDGE_NONCE_REUSED"));
    }
    fs::rename(path, &consumed)
        .map_err(|_| BridgeError::new("MVP15D_BRIDGE_NONCE_CONSUME_FAILED"))?;
    let digest = sha256_bytes(text.as_bytes());
    fs::remove_file(&consumed)
        .map_err(|_| BridgeError::new("MVP15D_BRIDGE_NONCE_CLEANUP_FAILED"))?;
    Ok(digest)
}

fn validate_arguments(args: ParsedArguments) -> Result<BridgeIdentity, BridgeError> {
    if std::env::var_os(ENABLE_ENV).as_deref() != Some(std::ffi::OsStr::new("1")) {
        return Err(BridgeError::new("MVP15D_BRIDGE_DEFAULT_OFF"));
    }
    let repository = canonical_directory(&args.repository, "MVP15D_BRIDGE_REPOSITORY_INVALID")?;
    let external = canonical_directory(
        &repository.join("external"),
        "MVP15D_BRIDGE_EXTERNAL_ROOT_INVALID",
    )?;
    let evidence_root =
        canonical_directory(&args.evidence_root, "MVP15D_BRIDGE_EVIDENCE_ROOT_INVALID")?;
    if evidence_root.parent() != Some(external.as_path())
        || !simple_root_name(&evidence_root)
        || evidence_root == external
    {
        return Err(BridgeError::new("MVP15D_BRIDGE_EVIDENCE_ROOT_INVALID"));
    }
    let nonce_file = validate_child_path(
        &evidence_root,
        &args.nonce_file,
        true,
        "MVP15D_BRIDGE_NONCE_INVALID",
    )?;
    let event_file = validate_child_path(
        &evidence_root,
        &args.event_file,
        false,
        "MVP15D_BRIDGE_EVENT_FILE_INVALID",
    )?;
    let driver_file = validate_child_path(
        &evidence_root,
        &args.driver_file,
        false,
        "MVP15D_BRIDGE_DRIVER_FILE_INVALID",
    )?;
    let nonce_sha256 = consume_nonce(&nonce_file)?;
    let executable = std::env::current_exe()
        .and_then(fs::canonicalize)
        .map_err(|_| BridgeError::new("MVP15D_BRIDGE_EXECUTABLE_INVALID"))?;
    let executable_basename = executable
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| BridgeError::new("MVP15D_BRIDGE_EXECUTABLE_INVALID"))?
        .to_string();
    let executable_sha256 = sha256_file(&executable)?;

    Ok(BridgeIdentity {
        phase: args.phase,
        mode: args.mode,
        task_id: args.task_id,
        source_commit: args.source_commit,
        source_tree_sha256: COMPILED_SOURCE_TREE_SHA256.to_string(),
        source_dirty: compiled_source_dirty(),
        source_head_ref: COMPILED_SOURCE_HEAD_REF.to_string(),
        marker: args.marker,
        session: args.session,
        generation: args.generation,
        endpoint: args.endpoint,
        port: args.port,
        evidence_root,
        event_file,
        driver_file,
        rendered_product_path: args.rendered_product_path,
        nonce_sha256,
        executable_basename,
        executable_sha256,
        pid: std::process::id(),
    })
}

fn create_event_file(path: &Path) -> Result<File, BridgeError> {
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| BridgeError::new("MVP15D_BRIDGE_EVENT_FILE_CREATE_FAILED"))
}

fn append_event(
    file: &mut File,
    identity: &BridgeIdentity,
    event_type: &str,
    data: Value,
) -> Result<(), BridgeError> {
    let event = json!({
        "schemaVersion": EVENT_SCHEMA,
        "phase": identity.phase.as_str(),
        "type": event_type,
        "data": data,
    });
    serde_json::to_writer(&mut *file, &event)
        .map_err(|_| BridgeError::new("MVP15D_BRIDGE_EVENT_WRITE_FAILED"))?;
    file.write_all(b"\n")
        .map_err(|_| BridgeError::new("MVP15D_BRIDGE_EVENT_WRITE_FAILED"))?;
    file.flush()
        .and_then(|_| file.sync_data())
        .map_err(|_| BridgeError::new("MVP15D_BRIDGE_EVENT_SYNC_FAILED"))
}

fn identity_data(identity: &BridgeIdentity) -> Value {
    json!({
        "taskId": identity.task_id,
        "sourceCommit": identity.source_commit,
        "sourceTreeSha256": identity.source_tree_sha256,
        "sourceDirty": identity.source_dirty,
        "sourceHeadRef": identity.source_head_ref,
        "marker": identity.marker,
        "session": identity.session,
        "generation": identity.generation,
        "endpointSha256": sha256_bytes(identity.endpoint.as_bytes()),
        "port": identity.port,
        "nonceSha256": identity.nonce_sha256,
        "process": {
            "pid": identity.pid,
            "executableBasename": identity.executable_basename,
            "executableSha256": identity.executable_sha256,
        },
        "bridgeVersion": BRIDGE_VERSION,
    })
}

fn write_opening_events(state: &mut BridgeState) -> Result<(), BridgeError> {
    append_event(
        &mut state.file,
        &state.identity,
        "evidence_origin",
        json!({ "origin": "production_runtime", "fixtureUsed": false }),
    )?;
    append_event(
        &mut state.file,
        &state.identity,
        "runtime_process_identity",
        identity_data(&state.identity),
    )?;
    if state.identity.phase.rendered() {
        append_event(
            &mut state.file,
            &state.identity,
            "bridge_readiness",
            json!({
                "rendererRequired": true,
                "driverRequired": true,
                "mode": state.identity.mode.as_str(),
                "operations": state.identity.rendered_product_path.split(',').collect::<Vec<_>>(),
            }),
        )?;
    }
    Ok(())
}

fn runtime_closeout_data(identity: &BridgeIdentity) -> Value {
    json!({
        "authorityLevel": "runtime_observed",
        "rendererCompleted": true,
        "driverCommandConsumed": !identity.driver_file.exists(),
    })
}

fn complete_capability_probe(mut state: BridgeState) -> Result<(), BridgeError> {
    append_event(
        &mut state.file,
        &state.identity,
        "capability_handshake",
        json!({
            "bridgeVersion": BRIDGE_VERSION,
            "mode": "capability-only",
            "rendererStarted": false,
            "mcpCalls": 0,
            "networkCalls": 0,
            "assetOperations": 0,
        }),
    )?;
    append_event(
        &mut state.file,
        &state.identity,
        "closeout",
        runtime_closeout_data(&state.identity),
    )?;
    state
        .file
        .sync_all()
        .map_err(|_| BridgeError::new("MVP15D_BRIDGE_EVENT_SYNC_FAILED"))
}

fn object_field<'a>(
    value: &'a Value,
    key: &str,
    code: &'static str,
) -> Result<&'a Value, BridgeError> {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .ok_or_else(|| BridgeError::new(code))
}

fn string_field<'a>(
    value: &'a Value,
    key: &str,
    code: &'static str,
) -> Result<&'a str, BridgeError> {
    object_field(value, key, code)?
        .as_str()
        .filter(|field| !field.is_empty())
        .ok_or_else(|| BridgeError::new(code))
}

fn u64_field(value: &Value, key: &str, code: &'static str) -> Result<u64, BridgeError> {
    object_field(value, key, code)?
        .as_u64()
        .ok_or_else(|| BridgeError::new(code))
}

fn call_receipt(
    identity: &BridgeIdentity,
    input: &RawObservedCallInput,
    api: &str,
    expected_status: &str,
    code: &'static str,
) -> Result<Value, BridgeError> {
    if !input.request.is_object() || input.receipt_id.is_empty() {
        return Err(BridgeError::new(code));
    }
    let record =
        consume_observation_receipt(identity, &input.receipt_id, api, &input.request, code)?;
    let payload = receipt_response_payload(&record);
    let status = string_field(payload, "status", code)?;
    let reason = string_field(payload, "reason", code)?;
    let evidence_id = string_field(payload, "evidenceId", code)?;
    if status != expected_status || evidence_id.len() < 8 {
        return Err(BridgeError::new(code));
    }
    Ok(json!({
        "api": api,
        "receiptId": input.receipt_id,
        "receiptSequence": record.sequence,
        "requestSha256": sha256_bytes(canonical_json(&input.request).as_bytes()),
        "responseSha256": sha256_bytes(canonical_json(&record.response).as_bytes()),
        "status": status,
        "reason": reason,
        "evidenceId": evidence_id,
    }))
}

fn native_retraction_receipt(
    identity: &BridgeIdentity,
    input: &RawObservedCallInput,
    code: &'static str,
) -> Result<Value, BridgeError> {
    if !input.request.is_object() || input.receipt_id.is_empty() {
        return Err(BridgeError::new(code));
    }
    let record = consume_observation_receipt(
        identity,
        &input.receipt_id,
        "retract_mvp15_companion_approvals",
        &input.request,
        code,
    )?;
    let applied = object_field(&record.response, "applied", code)?
        .as_bool()
        .ok_or_else(|| BridgeError::new(code))?;
    let revoked = u64_field(&record.response, "revokedApprovalCount", code)?;
    let generation = u64_field(&record.response, "generation", code)?;
    if !applied {
        return Err(BridgeError::new(code));
    }
    Ok(json!({
        "api": "retract_mvp15_companion_approvals",
        "receiptId": input.receipt_id,
        "receiptSequence": record.sequence,
        "requestSha256": sha256_bytes(canonical_json(&input.request).as_bytes()),
        "responseSha256": sha256_bytes(canonical_json(&record.response).as_bytes()),
        "applied": applied,
        "revokedApprovalCount": revoked,
        "generation": generation,
    }))
}

fn authority_bound(mut data: serde_json::Map<String, Value>, level: &str) -> Value {
    let binding = sha256_bytes(canonical_json(&Value::Object(data.clone())).as_bytes());
    data.insert(
        "authorityLevel".to_string(),
        Value::String(level.to_string()),
    );
    data.insert(
        "observationBindingSha256".to_string(),
        Value::String(binding),
    );
    Value::Object(data)
}

fn manifest_observation_data(
    identity: &BridgeIdentity,
    input: &ContentManifestInput,
    code: &'static str,
) -> Result<Value, BridgeError> {
    if !input.request.is_object() || input.receipt_id.is_empty() {
        return Err(BridgeError::new(code));
    }
    let record = consume_observation_receipt(
        identity,
        &input.receipt_id,
        "snapshot_asset_content_manifest",
        &input.request,
        code,
    )?;
    if string_field(&record.response, "status", code)? != "observed" {
        return Err(BridgeError::new(code));
    }
    let evidence_id = string_field(&record.response, "evidenceId", code)?;
    let sha256 = string_field(&record.response, "aggregateSha256", code)?;
    let entries = object_field(&record.response, "entries", code)?
        .as_array()
        .ok_or_else(|| BridgeError::new(code))?;
    let run_root = format!("/Game/UAgentSandbox/{}", input.run_id);
    let run_root_present = entries.iter().any(|entry| {
        entry
            .get("assetPath")
            .and_then(Value::as_str)
            .is_some_and(|path| path == run_root || path.starts_with(&format!("{run_root}/")))
    });
    if evidence_id.len() < 8 || !is_lower_hex(sha256, 64) {
        return Err(BridgeError::new(code));
    }
    Ok(json!({
        "authorityLevel": "native_observed",
        "receiptId": input.receipt_id,
        "receiptSequence": record.sequence,
        "stage": input.stage,
        "registrationId": input.registration_id,
        "runId": input.run_id,
        "evidenceId": evidence_id,
        "sha256": sha256,
        "runRootPresent": run_root_present,
    }))
}

fn stopped_and_disconnected(
    identity: &BridgeIdentity,
    observation_stop: &RawObservedCallInput,
    mcp_disconnect: &RawObservedCallInput,
    expected_session_id: &str,
    expected_mcp_session_id: &str,
    code: &'static str,
) -> Result<Value, BridgeError> {
    let stop = consume_observation_receipt(
        identity,
        &observation_stop.receipt_id,
        "stop_editor_observation_session",
        &observation_stop.request,
        code,
    )?;
    let disconnect = consume_observation_receipt(
        identity,
        &mcp_disconnect.receipt_id,
        "mcp_disconnect",
        &mcp_disconnect.request,
        code,
    )?;
    let termination_status = string_field(&disconnect.response, "status", code)?;
    let http_status = u64_field(&disconnect.response, "httpStatus", code)?;
    if string_field(&stop.response, "status", code)? != "stopped"
        || string_field(&stop.response, "sessionId", code)? != expected_session_id
        || !matches!(termination_status, "accepted" | "unsupported")
        || (termination_status == "accepted" && !(200..300).contains(&http_status))
        || (termination_status == "unsupported" && http_status != 405)
        || string_field(&disconnect.response, "mcpSessionId", code)? != expected_mcp_session_id
    {
        return Err(BridgeError::new(code));
    }
    Ok(json!({
        "observationStopReceiptId": observation_stop.receipt_id,
        "observationStopReceiptSequence": stop.sequence,
        "mcpDisconnectReceiptId": mcp_disconnect.receipt_id,
        "mcpDisconnectReceiptSequence": disconnect.sequence,
        "mcpTerminationStatus": termination_status,
        "mcpTerminationHttpStatus": http_status,
        "serverDisconnected": termination_status == "accepted",
    }))
}

fn consume_counter_receipt(
    identity: &BridgeIdentity,
    input: &RawObservedCallInput,
    expected_values: &[u64],
    code: &'static str,
) -> Result<Value, BridgeError> {
    const COUNTER_NAMES: [&str; 5] = ["native", "mcp", "provider", "verify", "rollback"];
    let receipt = consume_observation_receipt(
        identity,
        &input.receipt_id,
        "mutation_counter_read",
        &input.request,
        code,
    )?;
    let names = object_field(&receipt.response, "counterNames", code)?
        .as_array()
        .ok_or_else(|| BridgeError::new(code))?;
    let values = object_field(&receipt.response, "values", code)?
        .as_array()
        .ok_or_else(|| BridgeError::new(code))?;
    if names.len() != COUNTER_NAMES.len()
        || names
            .iter()
            .zip(COUNTER_NAMES)
            .any(|(observed, expected)| observed.as_str() != Some(expected))
        || values.len() != expected_values.len()
        || values
            .iter()
            .zip(expected_values)
            .any(|(observed, expected)| observed.as_u64() != Some(*expected))
    {
        return Err(BridgeError::new(code));
    }
    Ok(json!({
        "receiptId": input.receipt_id,
        "receiptSequence": receipt.sequence,
        "counterNames": names,
        "values": values,
    }))
}

fn consume_session_registration_receipts(
    identity: &BridgeIdentity,
    session_begin: &RawObservedCallInput,
    registration_call: &RawObservedCallInput,
    expected_session_id: &str,
    expected_run_id: &str,
    expected_registration_id: &str,
    code: &'static str,
) -> Result<Value, BridgeError> {
    let session = consume_observation_receipt(
        identity,
        &session_begin.receipt_id,
        "attach_editor_process",
        &session_begin.request,
        code,
    )?;
    let registration = consume_observation_receipt(
        identity,
        &registration_call.receipt_id,
        "register_asset_mutation_approval",
        &registration_call.request,
        code,
    )?;
    if string_field(&session.response, "status", code)? != "attached"
        || string_field(&session.response, "sessionId", code)? != expected_session_id
        || string_field(&registration.response, "status", code)? != "registered"
        || string_field(&registration.response, "registrationId", code)? != expected_registration_id
        || string_field(&registration_call.request, "editorSessionId", code)? != expected_session_id
        || string_field(&registration_call.request, "runId", code)? != expected_run_id
    {
        return Err(BridgeError::new(code));
    }
    Ok(json!({
        "sessionBegin": { "id": session_begin.receipt_id, "sequence": session.sequence },
        "registration": { "id": registration_call.receipt_id, "sequence": registration.sequence },
    }))
}

fn publish_ui_authority_events(
    file: &mut File,
    identity: &BridgeIdentity,
    input: &UiStoreEvidenceInput,
) -> Result<(), BridgeError> {
    const CODE: &str = "MVP15D_BRIDGE_UI_EVIDENCE_INVALID";
    const FORWARD: [&str; 5] = [
        "create_run_root",
        "duplicate_test01",
        "rename_duplicate",
        "move_duplicate",
        "save_one_package",
    ];
    const INVERSE: [&str; 4] = [
        "move_back",
        "rename_back",
        "delete_duplicate",
        "cleanup_empty_folder",
    ];
    let ledger = &input.ledger;
    let baseline = ledger.baseline_content_sha256.as_deref();
    if input.change_set_state.as_deref() != Some("rolled_back")
        || input.forward_actions != FORWARD
        || input.inverse_actions != INVERSE
        || ledger.dry_run_actions != 1
        || ledger.dry_run_calls != 5
        || ledger.native_registrations != 1
        || ledger.native_execute_guards != 5
        || ledger.execute_calls != 5
        || ledger.verify_mutations != 0
        || ledger.native_rollback_guards != 4
        || ledger.rollback_calls != 4
        || ledger.content_observation_count != 4
        || ledger.registration_id.as_deref().is_none_or(str::is_empty)
        || ledger.change_set_id.as_deref().is_none_or(str::is_empty)
        || ledger.run_id.as_deref().is_none_or(str::is_empty)
        || baseline.is_none_or(|value| !is_lower_hex(value, 64))
        || ledger.latest_content_sha256.as_deref() != baseline
        || input.final_verification.status != "passed"
        || !input.final_verification.restored
        || input.final_verification.baseline_sha256.as_deref() != baseline
        || input.final_verification.observed_sha256.as_deref() != baseline
        || input.operations.len() != FORWARD.len() + INVERSE.len()
        || input.content_manifests.len() != 2
        || input.negative_cases.len() != 8
        || input.partial_unknown.operation_results.len() != 9
    {
        return Err(BridgeError::new(CODE));
    }

    let mut operation_ids = Vec::new();
    let mut call_evidence_ids = Vec::new();
    for (index, operation) in input.operations.iter().enumerate() {
        let (direction, action) = if index < FORWARD.len() {
            ("forward", FORWARD[index])
        } else {
            ("inverse", INVERSE[index - FORWARD.len()])
        };
        if operation.direction != direction
            || operation.action != action
            || operation.operation_id.len() < 8
            || operation_ids.contains(&operation.operation_id)
            || operation.registration_id.as_str() != ledger.registration_id.as_deref().unwrap_or("")
            || operation.run_id.as_str() != ledger.run_id.as_deref().unwrap_or("")
            || operation.side_effect_count != 1
        {
            return Err(BridgeError::new(CODE));
        }
        operation_ids.push(operation.operation_id.clone());
        let native_call = call_receipt(
            identity,
            &operation.native_call,
            if direction == "forward" {
                "execute_asset_mutation"
            } else {
                "rollback_asset_mutation"
            },
            "accepted_by_native_guard",
            CODE,
        )?;
        let mcp_call = call_receipt(
            identity,
            &operation.mcp_call,
            "mcp_asset_tool_call",
            "succeeded",
            CODE,
        )?;
        for evidence_id in [&native_call["evidenceId"], &mcp_call["evidenceId"]] {
            let value = evidence_id.as_str().ok_or_else(|| BridgeError::new(CODE))?;
            if call_evidence_ids.iter().any(|observed| observed == value) {
                return Err(BridgeError::new(CODE));
            }
            call_evidence_ids.push(value.to_string());
        }
        append_event(
            file,
            identity,
            "lifecycle_operation_observation",
            json!({
                "authorityLevel": "runtime_observed",
                "direction": direction,
                "action": action,
                "operationId": operation.operation_id,
                "registrationId": operation.registration_id,
                "runId": operation.run_id,
                "nativeCall": native_call,
                "mcpCall": mcp_call,
                "sideEffectCount": operation.side_effect_count,
            }),
        )?;
    }

    let manifests = input
        .content_manifests
        .iter()
        .map(|record| manifest_observation_data(identity, record, CODE))
        .collect::<Result<Vec<_>, _>>()?;
    if manifests[0]["stage"].as_str() != Some("before")
        || manifests[1]["stage"].as_str() != Some("after")
        || manifests[0]["sha256"] != manifests[1]["sha256"]
        || manifests[0]["sha256"].as_str() != baseline
        || manifests[0]["evidenceId"] == manifests[1]["evidenceId"]
        || manifests
            .iter()
            .any(|record| record["runRootPresent"].as_bool() != Some(false))
    {
        return Err(BridgeError::new(CODE));
    }
    for record in &manifests {
        append_event(
            file,
            identity,
            "content_manifest_observation",
            record.clone(),
        )?;
    }

    let mut negative_identities = Vec::new();
    for (index, record) in input.negative_cases.iter().enumerate() {
        let case_id = format!("N{}", index + 1);
        let expected_api = if matches!(case_id.as_str(), "N2" | "N6") {
            "dry_run_asset_mutation"
        } else if case_id == "N8" {
            "rollback_asset_mutation"
        } else {
            "execute_asset_mutation"
        };
        let identities = [
            record.session_id.as_str(),
            record.native_session_id.as_str(),
            record.run_id.as_str(),
            record.registration_id.as_str(),
        ];
        if record.case_id != case_id
            || record.guard_api != expected_api
            || identities.iter().any(|value| value.len() < 8)
            || identities
                .iter()
                .any(|value| negative_identities.contains(&value.to_string()))
            || record.counters_before.len() != 5
            || record.counters_after.len() != 5
            || record.content_before.stage != "before"
            || record.content_after.stage != "after"
            || record.content_before.registration_id != record.registration_id
            || record.content_after.registration_id != record.registration_id
            || record.content_before.run_id != record.run_id
            || record.content_after.run_id != record.run_id
        {
            return Err(BridgeError::new(CODE));
        }
        negative_identities.extend(identities.iter().map(|value| value.to_string()));
        let identity_receipts = consume_session_registration_receipts(
            identity,
            &record.session_begin,
            &record.registration_call,
            &record.session_id,
            &record.run_id,
            &record.registration_id,
            CODE,
        )?;
        let counter_before = consume_counter_receipt(
            identity,
            &record.counter_read_before,
            &record.counters_before,
            CODE,
        )?;
        let counter_after = consume_counter_receipt(
            identity,
            &record.counter_read_after,
            &record.counters_after,
            CODE,
        )?;
        let closeout_receipts = stopped_and_disconnected(
            identity,
            &record.observation_stop,
            &record.mcp_disconnect,
            &record.session_id,
            &record.native_session_id,
            CODE,
        )?;
        let mut setup_receipts = Vec::with_capacity(record.setup_calls.len());
        let mut setup_responses_valid = true;
        for setup in &record.setup_calls {
            let receipt = consume_allowed_observation_receipt(
                identity,
                &setup.receipt_id,
                &setup.request,
                &[
                    "retract_mvp15_companion_approvals",
                    "stop_editor_observation_session",
                    "create_managed_editor_process",
                    "terminate_managed_editor_process",
                    "attach_editor_process",
                    "execute_asset_mutation",
                    "rollback_asset_mutation",
                    "record_asset_mutation_outcome",
                ],
                CODE,
            )?;
            let payload = receipt_response_payload(&receipt);
            let status = payload
                .get("status")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let reason = payload
                .get("reason")
                .and_then(Value::as_str)
                .unwrap_or_default();
            setup_responses_valid &= match receipt.api.as_str() {
                "create_managed_editor_process" => {
                    status == "created"
                        && reason == "task_owned_process_started"
                        && payload.get("ownerTaskId").and_then(Value::as_str)
                            == Some(identity.task_id.as_str())
                        && payload.get("ownerPhase").and_then(Value::as_str)
                            == Some(identity.phase.as_str())
                }
                "terminate_managed_editor_process" => {
                    status == "degraded"
                        && reason == "process_exited"
                        && payload.get("sessionId").and_then(Value::as_str)
                            == Some(record.session_id.as_str())
                }
                "attach_editor_process" => {
                    status == "attached"
                        && payload
                            .get("sessionId")
                            .and_then(Value::as_str)
                            .is_some_and(|value| value != record.session_id)
                        && payload
                            .get("observationGeneration")
                            .and_then(Value::as_u64)
                            .is_some_and(|value| value > 0)
                }
                "execute_asset_mutation" => {
                    status == "accepted_by_native_guard"
                        && payload.get("registrationId").and_then(Value::as_str)
                            == Some(record.registration_id.as_str())
                        && payload.get("phase").and_then(Value::as_str) == Some("execute")
                }
                "rollback_asset_mutation" => {
                    status == "accepted_by_native_guard"
                        && payload.get("registrationId").and_then(Value::as_str)
                            == Some(record.registration_id.as_str())
                        && payload.get("phase").and_then(Value::as_str) == Some("rollback")
                }
                "record_asset_mutation_outcome" => {
                    status == "recorded"
                        && payload.get("registrationId").and_then(Value::as_str)
                            == Some(record.registration_id.as_str())
                        && matches!(
                            payload.get("phase").and_then(Value::as_str),
                            Some("execute" | "rollback")
                        )
                }
                "stop_editor_observation_session" => {
                    status == "stopped"
                        && payload.get("sessionId").and_then(Value::as_str)
                            == Some(record.session_id.as_str())
                }
                "retract_mvp15_companion_approvals" => status == "retracted",
                _ => false,
            };
            setup_receipts.push(json!({
                "api": receipt.api,
                "id": setup.receipt_id,
                "sequence": receipt.sequence,
                "responseSha256": sha256_bytes(canonical_json(&receipt.response).as_bytes()),
                "status": payload.get("status"),
                "reason": payload.get("reason"),
                "sessionId": payload.get("sessionId"),
                "registrationId": payload.get("registrationId"),
                "phase": payload.get("phase"),
                "operationId": payload.get("operationId"),
                "processId": payload.get("processId").or_else(|| payload.pointer("/process/id")),
                "ownerTaskId": payload.get("ownerTaskId"),
                "ownerPhase": payload.get("ownerPhase"),
                "observationGeneration": payload.get("observationGeneration"),
            }));
        }
        let guard_call = call_receipt(identity, &record.guard_call, expected_api, "blocked", CODE)?;
        let reason = guard_call["reason"].as_str().unwrap_or_default();
        let setup_apis = setup_receipts
            .iter()
            .filter_map(|receipt| receipt["api"].as_str())
            .collect::<Vec<_>>();
        let setup_valid = match case_id.as_str() {
            "N1" => setup_apis == ["retract_mvp15_companion_approvals"],
            "N2" => setup_apis.is_empty(),
            "N3" => setup_apis == ["stop_editor_observation_session"],
            "N4" => {
                setup_apis
                    == [
                        "create_managed_editor_process",
                        "terminate_managed_editor_process",
                    ]
            }
            "N5" => setup_apis == ["attach_editor_process"],
            "N6" => setup_apis.is_empty(),
            "N7" => setup_apis == ["execute_asset_mutation", "record_asset_mutation_outcome"],
            "N8" => {
                setup_apis
                    == [
                        "execute_asset_mutation",
                        "record_asset_mutation_outcome",
                        "rollback_asset_mutation",
                        "record_asset_mutation_outcome",
                    ]
            }
            _ => false,
        };
        let setup_sequence_valid = setup_receipts.windows(2).all(|pair| {
            pair[0]["sequence"].as_u64().unwrap_or(u64::MAX)
                < pair[1]["sequence"].as_u64().unwrap_or(0)
        });
        let reason_valid = match case_id.as_str() {
            "N1" => reason == "companion_attestation_retracted",
            "N2" => reason == "asset_mutation_gate_disabled",
            "N3" => reason == "observation_session_stopped",
            "N4" => reason == "process_exited",
            "N5" => reason == "stale_generation",
            "N6" => reason == "sandbox_path_required",
            "N7" => reason == "execute_replay",
            "N8" => reason == "rollback_replay",
            _ => false,
        };
        let counter_delta_valid = match case_id.as_str() {
            "N7" => {
                record.counters_after[0] == record.counters_before[0] + 1
                    && record.counters_after[1..] == record.counters_before[1..]
            }
            "N8" => {
                record.counters_after[0] == record.counters_before[0] + 2
                    && record.counters_after[1..] == record.counters_before[1..]
            }
            _ => record.counters_after == record.counters_before,
        };
        if !setup_valid
            || !setup_responses_valid
            || !setup_sequence_valid
            || !reason_valid
            || !counter_delta_valid
        {
            return Err(BridgeError::new(CODE));
        }
        let before = manifest_observation_data(identity, &record.content_before, CODE)?;
        let after = manifest_observation_data(identity, &record.content_after, CODE)?;
        if before["sha256"] != after["sha256"] || before["evidenceId"] == after["evidenceId"] {
            return Err(BridgeError::new(CODE));
        }
        append_event(
            file,
            identity,
            "negative_case_observation",
            json!({
                "authorityLevel": "runtime_observed",
                "caseId": record.case_id,
                "sessionId": record.session_id,
                "nativeSessionId": record.native_session_id,
                "runId": record.run_id,
                "registrationId": record.registration_id,
                "identityReceipts": identity_receipts,
                "setupReceipts": setup_receipts,
                "guardCall": guard_call,
                "contentBefore": {
                    "evidenceId": before["evidenceId"],
                    "sha256": before["sha256"],
                    "receiptId": before["receiptId"],
                    "receiptSequence": before["receiptSequence"],
                },
                "contentAfter": {
                    "evidenceId": after["evidenceId"],
                    "sha256": after["sha256"],
                    "receiptId": after["receiptId"],
                    "receiptSequence": after["receiptSequence"],
                },
                "countersBefore": record.counters_before,
                "countersAfter": record.counters_after,
                "counterReadBefore": counter_before,
                "counterReadAfter": counter_after,
                "observationStopped": true,
                "localMcpClosed": true,
                "serverMcpTerminated": closeout_receipts["serverDisconnected"],
                "mcpDisconnected": closeout_receipts["serverDisconnected"],
                "closeoutReceipts": closeout_receipts,
            }),
        )?;
    }

    const PARTIAL_ACTIONS: [(&str, &str); 9] = [
        ("forward", "create_run_root"),
        ("forward", "duplicate_test01"),
        ("forward", "rename_duplicate"),
        ("forward", "move_duplicate"),
        ("inverse", "rename_back"),
        ("inverse", "delete_duplicate"),
        ("inverse", "cleanup_empty_folder"),
        ("control", "cross_ttl"),
        ("control", "second_rollback"),
    ];
    let partial = &input.partial_unknown;
    if [
        partial.session_id.as_str(),
        partial.native_session_id.as_str(),
        partial.run_id.as_str(),
        partial.registration_id.as_str(),
    ]
    .iter()
    .any(|value| value.len() < 8)
        || partial.counters_before.len() != 5
        || partial.counters_after.len() != 5
        || partial
            .counters_after
            .iter()
            .zip(&partial.counters_before)
            .any(|(after, before)| after < before)
        || !partial
            .counters_after
            .iter()
            .zip(&partial.counters_before)
            .any(|(after, before)| after > before)
        || partial.content_before.stage != "before"
        || partial.content_after.stage != "after"
    {
        return Err(BridgeError::new(CODE));
    }
    let partial_counter_before = consume_counter_receipt(
        identity,
        &partial.counter_read_before,
        &partial.counters_before,
        CODE,
    )?;
    let partial_identity_receipts = consume_session_registration_receipts(
        identity,
        &partial.session_begin,
        &partial.registration_call,
        &partial.session_id,
        &partial.run_id,
        &partial.registration_id,
        CODE,
    )?;
    let partial_counter_after = consume_counter_receipt(
        identity,
        &partial.counter_read_after,
        &partial.counters_after,
        CODE,
    )?;
    let partial_closeout_receipts = stopped_and_disconnected(
        identity,
        &partial.observation_stop,
        &partial.mcp_disconnect,
        &partial.session_id,
        &partial.native_session_id,
        CODE,
    )?;
    let mut partial_results = Vec::with_capacity(PARTIAL_ACTIONS.len());
    for (index, operation) in partial.operation_results.iter().enumerate() {
        let (direction, action) = PARTIAL_ACTIONS[index];
        let mut setup_receipts = Vec::with_capacity(operation.setup_calls.len());
        for setup in &operation.setup_calls {
            let setup_record = consume_allowed_observation_receipt(
                identity,
                &setup.receipt_id,
                &setup.request,
                &[
                    "attach_editor_process",
                    "register_asset_mutation_approval",
                    "execute_asset_mutation",
                    "rollback_asset_mutation",
                    "record_asset_mutation_outcome",
                ],
                CODE,
            )?;
            let setup_payload = receipt_response_payload(&setup_record);
            setup_receipts.push(json!({
                "api": setup_record.api,
                "id": setup.receipt_id,
                "sequence": setup_record.sequence,
                "status": setup_payload.get("status"),
                "reason": setup_payload.get("reason"),
                "sessionId": setup_payload.get("sessionId"),
                "registrationId": setup_payload.get("registrationId"),
                "phase": setup_payload.get("phase"),
                "operationId": setup_payload.get("operationId"),
                "requestSessionId": setup.request.get("editorSessionId"),
                "requestRegistrationId": setup.request.get("registrationId"),
            }));
        }
        let receipt = consume_observation_receipt(
            identity,
            &operation.receipt_id,
            &operation.api,
            &operation.request,
            CODE,
        )?;
        let payload = receipt_response_payload(&receipt);
        let status = string_field(payload, "status", CODE)?;
        let effect_state = payload
            .as_object()
            .and_then(|value| value.get("effectState"))
            .and_then(Value::as_str)
            .or_else(|| (status == "blocked").then_some("known_none"))
            .ok_or_else(|| BridgeError::new(CODE))?;
        let reason = string_field(payload, "reason", CODE)?;
        let result_valid = match action {
            "create_run_root"
            | "duplicate_test01"
            | "rename_duplicate"
            | "rename_back"
            | "delete_duplicate"
            | "cleanup_empty_folder" => {
                status == "succeeded" && effect_state == "known_effect" && reason == "none"
            }
            "move_duplicate" => {
                status == "failed" && effect_state == "unknown" && reason == "effect_unknown"
            }
            "cross_ttl" => {
                if setup_receipts.len() != 2 {
                    false
                } else {
                    let attached_session =
                        setup_receipts[0]["sessionId"].as_str().unwrap_or_default();
                    let registered_session = setup_receipts[1]["requestSessionId"]
                        .as_str()
                        .unwrap_or_default();
                    status == "blocked"
                        && effect_state == "known_none"
                        && reason == "approval_expired"
                        && setup_receipts
                            .iter()
                            .filter_map(|receipt| receipt["api"].as_str())
                            .eq(["attach_editor_process", "register_asset_mutation_approval"])
                        && setup_receipts[0]["status"] == "attached"
                        && setup_receipts[1]["status"] == "registered"
                        && !attached_session.is_empty()
                        && attached_session == registered_session
                }
            }
            "second_rollback" => {
                if setup_receipts.len() != 6 {
                    false
                } else {
                    let attached_session =
                        setup_receipts[0]["sessionId"].as_str().unwrap_or_default();
                    let registered_session = setup_receipts[1]["requestSessionId"]
                        .as_str()
                        .unwrap_or_default();
                    let fresh_registration = setup_receipts[1]["registrationId"]
                        .as_str()
                        .unwrap_or_default();
                    let execute_operation = setup_receipts[2]["operationId"]
                        .as_str()
                        .unwrap_or_default();
                    let execute_outcome_operation = setup_receipts[3]["operationId"]
                        .as_str()
                        .unwrap_or_default();
                    let rollback_operation = setup_receipts[4]["operationId"]
                        .as_str()
                        .unwrap_or_default();
                    let rollback_outcome_operation = setup_receipts[5]["operationId"]
                        .as_str()
                        .unwrap_or_default();
                    status == "blocked"
                        && effect_state == "known_none"
                        && reason == "rollback_replay"
                        && setup_receipts
                            .iter()
                            .filter_map(|receipt| receipt["api"].as_str())
                            .eq([
                                "attach_editor_process",
                                "register_asset_mutation_approval",
                                "execute_asset_mutation",
                                "record_asset_mutation_outcome",
                                "rollback_asset_mutation",
                                "record_asset_mutation_outcome",
                            ])
                        && setup_receipts[0]["status"] == "attached"
                        && setup_receipts[1]["status"] == "registered"
                        && setup_receipts[2]["status"] == "accepted_by_native_guard"
                        && setup_receipts[2]["phase"] == "execute"
                        && setup_receipts[3]["status"] == "recorded"
                        && setup_receipts[3]["phase"] == "execute"
                        && setup_receipts[4]["status"] == "accepted_by_native_guard"
                        && setup_receipts[4]["phase"] == "rollback"
                        && setup_receipts[5]["status"] == "recorded"
                        && setup_receipts[5]["phase"] == "rollback"
                        && !attached_session.is_empty()
                        && attached_session == registered_session
                        && !fresh_registration.is_empty()
                        && setup_receipts[2..].iter().all(|entry| {
                            entry["registrationId"].as_str() == Some(fresh_registration)
                                && entry["requestRegistrationId"].as_str()
                                    == Some(fresh_registration)
                        })
                        && payload.get("registrationId").and_then(Value::as_str)
                            == Some(fresh_registration)
                        && operation
                            .request
                            .get("registrationId")
                            .and_then(Value::as_str)
                            == Some(fresh_registration)
                        && !execute_operation.is_empty()
                        && execute_operation == execute_outcome_operation
                        && !rollback_operation.is_empty()
                        && rollback_operation == rollback_outcome_operation
                }
            }
            _ => false,
        };
        if operation.direction != direction
            || operation.action != action
            || operation.api.is_empty()
            || !operation.request.is_object()
            || !result_valid
        {
            return Err(BridgeError::new(CODE));
        }
        let evidence_id = string_field(payload, "evidenceId", CODE)?;
        if evidence_id.len() < 8 {
            return Err(BridgeError::new(CODE));
        }
        partial_results.push(json!({
            "sequence": index + 1,
            "direction": direction,
            "action": action,
            "api": operation.api,
            "receiptId": operation.receipt_id,
            "receiptSequence": receipt.sequence,
            "requestSha256": sha256_bytes(canonical_json(&operation.request).as_bytes()),
            "responseSha256": sha256_bytes(canonical_json(&receipt.response).as_bytes()),
            "status": status,
            "effectState": effect_state,
            "reason": reason,
            "evidenceId": evidence_id,
            "setupReceipts": setup_receipts,
        }));
    }
    let partial_before = manifest_observation_data(identity, &partial.content_before, CODE)?;
    let partial_after = manifest_observation_data(identity, &partial.content_after, CODE)?;
    if partial_before["sha256"] != partial_after["sha256"]
        || partial_before["evidenceId"] == partial_after["evidenceId"]
    {
        return Err(BridgeError::new(CODE));
    }
    append_event(
        file,
        identity,
        "partial_unknown_observation",
        json!({
            "authorityLevel": "runtime_observed",
            "sessionId": partial.session_id,
            "nativeSessionId": partial.native_session_id,
            "runId": partial.run_id,
            "registrationId": partial.registration_id,
            "identityReceipts": partial_identity_receipts,
            "operationResults": partial_results,
            "contentBefore": {
                "evidenceId": partial_before["evidenceId"],
                "sha256": partial_before["sha256"],
                "receiptId": partial_before["receiptId"],
                "receiptSequence": partial_before["receiptSequence"],
            },
            "contentAfter": {
                "evidenceId": partial_after["evidenceId"],
                "sha256": partial_after["sha256"],
                "receiptId": partial_after["receiptId"],
                "receiptSequence": partial_after["receiptSequence"],
            },
            "countersBefore": partial.counters_before,
            "countersAfter": partial.counters_after,
            "counterReadBefore": partial_counter_before,
            "counterReadAfter": partial_counter_after,
            "observationStopped": true,
            "localMcpClosed": true,
            "serverMcpTerminated": partial_closeout_receipts["serverDisconnected"],
            "mcpDisconnected": partial_closeout_receipts["serverDisconnected"],
            "closeoutReceipts": partial_closeout_receipts,
        }),
    )?;

    let replay = &input.replay_inspection;
    let replay_receipt = consume_observation_receipt(
        identity,
        &replay.recorded_representation_receipt.receipt_id,
        "recorded_replay_read",
        &replay.recorded_representation_receipt.request,
        CODE,
    )?;
    if object_field(&replay_receipt.response, "recordedRepresentation", CODE)?
        != &replay.recorded_representation
    {
        return Err(BridgeError::new(CODE));
    }
    let replay_counter_before = consume_counter_receipt(
        identity,
        &replay.counter_read_before,
        &replay.counters_before,
        CODE,
    )?;
    let replay_counter_after = consume_counter_receipt(
        identity,
        &replay.counter_read_after,
        &replay.counters_after,
        CODE,
    )?;
    let recorded_event_count = u64_field(&replay.recorded_representation, "eventCount", CODE)?;
    let recorded_actions =
        object_field(&replay.recorded_representation, "recordedOnlyActions", CODE)?
            .as_array()
            .ok_or_else(|| BridgeError::new(CODE))?;
    let expected_replay_actions = [
        "dry-run", "preview", "approval", "execute", "verify", "rollback",
    ];
    if recorded_event_count == 0
        || recorded_actions.len() != expected_replay_actions.len()
        || recorded_actions
            .iter()
            .zip(expected_replay_actions)
            .any(|(observed, expected)| observed.as_str() != Some(expected))
        || replay.counter_names != ["native", "mcp", "provider", "verify", "rollback"]
        || replay.counters_before.len() != 5
        || replay.counters_before != replay.counters_after
    {
        return Err(BridgeError::new(CODE));
    }
    append_event(
        file,
        identity,
        "replay_inspection_observation",
        json!({
            "authorityLevel": "runtime_observed",
            "recordedRepresentationSha256": sha256_bytes(canonical_json(&replay.recorded_representation).as_bytes()),
            "recordedRepresentationReceiptId": replay.recorded_representation_receipt.receipt_id,
            "recordedRepresentationReceiptSequence": replay_receipt.sequence,
            "recordedEventCount": recorded_event_count,
            "recordedActions": recorded_actions,
            "counterNames": replay.counter_names,
            "countersBefore": replay.counters_before,
            "countersAfter": replay.counters_after,
            "counterReadBefore": replay_counter_before,
            "counterReadAfter": replay_counter_after,
            "sideEffectDelta": [0, 0, 0, 0, 0],
        }),
    )?;
    append_event(
        file,
        identity,
        "negative_matrix",
        json!({
            "authorityLevel": "derived_only",
            "caseCount": input.negative_cases.len(),
            "passedCount": input.negative_cases.len(),
            "rawObservationCount": input.negative_cases.len(),
        }),
    )?;
    append_event(
        file,
        identity,
        "partial_unknown_effect",
        json!({
            "authorityLevel": "derived_only",
            "covered": true,
            "rawOperationCount": partial_results.len(),
        }),
    )?;
    append_event(
        file,
        identity,
        "run_root_state",
        json!({
            "authorityLevel": "derived_only",
            "removed": true,
            "contentEvidenceId": manifests[1]["evidenceId"],
        }),
    )?;
    append_event(
        file,
        identity,
        "ownership_state",
        json!({
            "authorityLevel": "derived_only",
            "parentCloseoutRequired": true,
        }),
    )
}

pub fn prepare_from_environment() -> Result<Startup, BridgeError> {
    let raw = std::env::args_os().skip(1).collect::<Vec<_>>();
    let Some(parsed) = parse_arguments(raw)? else {
        return Ok(Startup::Ordinary);
    };
    let identity = validate_arguments(parsed)?;
    activate_observation_receipt_ledger(&identity)?;
    let file = create_event_file(&identity.event_file)?;
    let mut state = BridgeState {
        identity,
        file,
        next_step: 0,
        driver_claimed: false,
        structured_evidence_published: false,
        completed: false,
        last_native_transition_sequence: 0,
        renderer_handoff: None,
        renderer_publish_authority: true,
    };
    write_opening_events(&mut state)?;
    if state.identity.phase == BridgePhase::CapabilityProbe {
        complete_capability_probe(state)?;
        Ok(Startup::CapabilityCompleted)
    } else {
        Ok(Startup::Rendered(state))
    }
}

fn steps(identity: &BridgeIdentity) -> &'static [&'static str] {
    match (identity.phase, identity.mode) {
        (BridgePhase::ProductCapture, BridgeMode::CapabilityOnly) => &[
            "renderer_ready",
            "native_bridge_bound",
            "normal_product_path_bound",
            "capability_confirmed",
        ],
        (BridgePhase::UiLifecycle, BridgeMode::CapabilityOnly) => &[
            "renderer_ready",
            "native_bridge_bound",
            "rendered_driver_bound",
            "capability_confirmed",
        ],
        (BridgePhase::ProductCapture, BridgeMode::Live) => &[
            "renderer_ready",
            "native_bridge_bound",
            "validate",
            "add",
            "confirmTrust",
            "observationDiscover",
            "observationAttach",
            "observationReady",
            "connect",
            "initialize",
            "discover",
            "normalize",
            "fingerprint",
            "disconnect",
        ],
        (BridgePhase::UiLifecycle, BridgeMode::Live) => &[
            "renderer_ready",
            "native_bridge_bound",
            "validate",
            "add",
            "confirmTrust",
            "observationDiscover",
            "observationAttach",
            "observationReady",
            "mcpConnect",
            "mcpInitialize",
            "mcpDiscover",
            "mcpNormalize",
            "mcpFingerprint",
            "dryRun",
            "approve",
            "register",
            "execute",
            "verify",
            "crossTtl",
            "rollback",
            "finalVerify",
            "replay",
            "observationStop",
            "mcpDisconnect",
        ],
        (BridgePhase::CapabilityProbe, _) => &[],
    }
}

#[cfg(windows)]
fn observe_renderer_process() -> Result<Value, BridgeError> {
    use sysinfo::System;

    let mut system = System::new_all();
    system.refresh_processes();
    let runtime_pid = std::process::id();
    let mut candidates = Vec::new();
    for (pid, process) in system.processes() {
        let is_renderer = process.cmd().iter().any(|argument| {
            argument == "--type=renderer" || argument.starts_with("--type=renderer")
        });
        if !is_renderer {
            continue;
        }
        let mut ancestor = process.parent();
        let mut owned = false;
        for _ in 0..4 {
            let Some(parent_pid) = ancestor else {
                break;
            };
            if parent_pid.as_u32() == runtime_pid {
                owned = true;
                break;
            }
            ancestor = system
                .process(parent_pid)
                .and_then(|parent| parent.parent());
        }
        if owned {
            candidates.push((
                pid.as_u32(),
                process.start_time(),
                process.name().to_string(),
            ));
        }
    }
    if candidates.len() != 1 {
        return Err(BridgeError::new(
            "MVP15D_RENDERER_PROCESS_OBSERVATION_INVALID",
        ));
    }
    let (pid, start_time, executable_basename) = candidates.remove(0);
    let process_identity = json!({
        "pid": pid,
        "startTime": start_time,
        "executableBasename": executable_basename,
        "runtimePid": runtime_pid,
    });
    let process_identity_sha256 = sha256_bytes(canonical_json(&process_identity).as_bytes());
    Ok(json!({
        "status": "begun",
        "rendererInstanceId": format!("renderer-process:{process_identity_sha256}"),
        "processIdentitySha256": process_identity_sha256,
        "process": process_identity,
    }))
}

#[cfg(not(windows))]
fn observe_renderer_process() -> Result<Value, BridgeError> {
    Err(BridgeError::new(
        "MVP15D_RENDERER_PROCESS_OBSERVATION_INVALID",
    ))
}

fn receipt_response_payload(record: &ObservationReceiptRecord) -> &Value {
    record
        .response
        .as_object()
        .and_then(|response| response.get("body"))
        .and_then(Value::as_object)
        .and_then(|body| body.get("result"))
        .unwrap_or(&record.response)
}

fn native_mutation_counters(records: &[ObservationReceiptRecord]) -> [u64; 5] {
    let mut counters = [0_u64; 5];
    for record in records {
        let payload = receipt_response_payload(record);
        let status = payload
            .as_object()
            .and_then(|value| value.get("status"))
            .and_then(Value::as_str);
        let effect = payload
            .as_object()
            .and_then(|value| value.get("effectState"))
            .and_then(Value::as_str);
        let side_effect = payload
            .as_object()
            .and_then(|value| value.get("sideEffectObserved"))
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || (status == Some("succeeded") && effect == Some("known_effect"))
            || (record.api == "record_asset_mutation_outcome"
                && status == Some("recorded")
                && record
                    .request
                    .get("sideEffectObserved")
                    .and_then(Value::as_bool)
                    == Some(true)
                && record.request.get("effectState").and_then(Value::as_str)
                    == Some("known_effect"));
        if !side_effect {
            continue;
        }
        match record.api.as_str() {
            "record_asset_mutation_outcome" => counters[0] += 1,
            "mcp_asset_tool_call" => {
                counters[1] += 1;
                let action = record
                    .request
                    .as_object()
                    .and_then(|value| value.get("body"))
                    .and_then(Value::as_object)
                    .and_then(|value| value.get("params"))
                    .and_then(Value::as_object)
                    .and_then(|value| value.get("name"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if action.contains("rollback") {
                    counters[4] += 1;
                }
            }
            _ => {}
        }
    }
    counters
}

fn record_request_generation(record: &ObservationReceiptRecord) -> Option<u64> {
    record
        .request
        .as_object()
        .and_then(|request| request.get("intent"))
        .and_then(Value::as_object)
        .and_then(|intent| intent.get("connectionGeneration"))
        .and_then(Value::as_u64)
}

fn record_request_endpoint(record: &ObservationReceiptRecord) -> Option<&str> {
    record
        .request
        .as_object()
        .and_then(|request| request.get("endpoint"))
        .and_then(Value::as_str)
}

fn record_response_session(record: &ObservationReceiptRecord) -> Option<&str> {
    record
        .response
        .as_object()
        .and_then(|response| response.get("sessionId"))
        .and_then(Value::as_str)
}

fn transport_jsonrpc_result<'a>(
    record: &'a ObservationReceiptRecord,
    code: &'static str,
) -> Result<&'a Value, BridgeError> {
    let body = object_field(&record.response, "parsedBody", code)?;
    object_field(body, "result", code)
}

fn product_descriptor_from_value(
    value: &Value,
    source: &str,
    inherited_toolset_id: Option<&str>,
) -> Option<ProductToolDescriptor> {
    let record = value.as_object()?;
    let first_string = |keys: &[&str]| {
        keys.iter()
            .find_map(|key| record.get(*key).and_then(Value::as_str))
    };
    let name = first_string(&["exactToolName", "exact_tool_name", "toolName", "name"])?;
    if !MVP15D_TOOL_NAMES.contains(&name) {
        return None;
    }
    let contract = record
        .get("outputSchema")
        .or_else(|| record.get("output_schema"))
        .and_then(Value::as_object)
        .unwrap_or(record);
    let contract_object = |keys: &[&str]| {
        keys.iter()
            .find_map(|key| record.get(*key).filter(|value| value.is_object()).cloned())
            .or_else(|| {
                keys.iter().find_map(|key| {
                    contract
                        .get(*key)
                        .filter(|value| value.is_object())
                        .cloned()
                })
            })
    };
    let input_schema = record
        .get("inputSchema")
        .or_else(|| record.get("input_schema"))
        .filter(|value| value.is_object())
        .cloned()?;
    Some(ProductToolDescriptor {
        name: name.to_string(),
        schema_version: ["schemaVersion", "schema_version", "version"]
            .iter()
            .find_map(|key| record.get(*key).and_then(Value::as_str))
            .or_else(|| {
                ["schemaVersion", "schema_version", "version"]
                    .iter()
                    .find_map(|key| contract.get(*key).and_then(Value::as_str))
            })?
            .to_string(),
        input_schema,
        dry_run_schema: contract_object(&["dryRunSchema", "dry_run_schema"])?,
        rollback_contract: contract_object(&["rollbackContract", "rollback_contract"])?,
        affected_assets_schema: contract_object(&[
            "affectedAssetsSchema",
            "affected_assets_schema",
        ])?,
        evidence_query: contract_object(&[
            "evidenceQuery",
            "evidence_query",
            "externalEvidenceQuery",
        ])?,
        source: record
            .get("source")
            .and_then(Value::as_str)
            .filter(|value| matches!(*value, "direct" | "facade"))
            .unwrap_or(source)
            .to_string(),
        method_id: first_string(&["methodId", "method_id", "id"]).map(ToString::to_string),
        toolset_id: first_string(&["toolsetId", "toolset_id"])
            .or(inherited_toolset_id)
            .map(ToString::to_string),
    })
}

fn collect_product_descriptors(
    value: &Value,
    source: &str,
    inherited_toolset_id: Option<&str>,
    output: &mut Vec<ProductToolDescriptor>,
) {
    if let Some(descriptor) = product_descriptor_from_value(value, source, inherited_toolset_id) {
        output.push(descriptor);
        return;
    }
    match value {
        Value::Array(values) => {
            for value in values {
                collect_product_descriptors(value, source, inherited_toolset_id, output);
            }
        }
        Value::Object(values) => {
            let toolset_id = values
                .get("toolsetId")
                .or_else(|| values.get("toolset_id"))
                .or_else(|| values.get("id"))
                .and_then(Value::as_str)
                .or(inherited_toolset_id);
            for value in values.values() {
                collect_product_descriptors(value, source, toolset_id, output);
            }
        }
        Value::String(encoded) => {
            if let Ok(decoded) = serde_json::from_str::<Value>(encoded) {
                collect_product_descriptors(&decoded, source, inherited_toolset_id, output);
            }
        }
        _ => {}
    }
}

struct ValidatedProductDiscovery {
    event: Value,
    fingerprint: String,
    contract_fingerprint: String,
    mcp_session_id: String,
    renderer_instance_id: String,
    process_identity_sha256: String,
    generation: u64,
    state_receipt_id: String,
}

fn validate_product_discovery(
    identity: &BridgeIdentity,
    discovery: &ProductDiscoveryInput,
) -> Result<ValidatedProductDiscovery, BridgeError> {
    const CODE: &str = "MVP15D_BRIDGE_PRODUCT_EVIDENCE_INVALID";
    let tool_search_enabled = match discovery.mode.as_str() {
        "on" => true,
        "off" => false,
        _ => return Err(BridgeError::new(CODE)),
    };
    let config = consume_observation_receipt(
        identity,
        &discovery.config_call.receipt_id,
        "mcp_configure_tool_search",
        &discovery.config_call.request,
        CODE,
    )?;
    let renderer_instance = consume_observation_receipt(
        identity,
        &discovery.renderer_instance_call.receipt_id,
        "renderer_instance_begin",
        &discovery.renderer_instance_call.request,
        CODE,
    )?;
    let connect = consume_observation_receipt(
        identity,
        &discovery.connect_call.receipt_id,
        "mcp_connect",
        &discovery.connect_call.request,
        CODE,
    )?;
    let initialize = consume_observation_receipt(
        identity,
        &discovery.initialize_call.receipt_id,
        "mcp_initialize",
        &discovery.initialize_call.request,
        CODE,
    )?;
    let discover = consume_observation_receipt(
        identity,
        &discovery.discover_call.receipt_id,
        "mcp_discover",
        &discovery.discover_call.request,
        CODE,
    )?;
    let normalize = consume_observation_receipt(
        identity,
        &discovery.normalize_call.receipt_id,
        "mcp_normalize",
        &discovery.normalize_call.request,
        CODE,
    )?;
    let fingerprint_receipt = consume_observation_receipt(
        identity,
        &discovery.fingerprint_call.receipt_id,
        "mcp_fingerprint",
        &discovery.fingerprint_call.request,
        CODE,
    )?;
    let attestation = consume_observation_receipt(
        identity,
        &discovery.native_attestation.receipt_id,
        "attest_mvp15_companion",
        &discovery.native_attestation.request,
        CODE,
    )?;
    let mutation_counter = consume_observation_receipt(
        identity,
        &discovery.mutation_counter_call.receipt_id,
        "mutation_counter_read",
        &discovery.mutation_counter_call.request,
        CODE,
    )?;
    let intent = object_field(&config.request, "intent", CODE)?;
    if string_field(intent, "toolSearchMode", CODE)? != discovery.mode
        || [
            &config,
            &connect,
            &initialize,
            &discover,
            &normalize,
            &fingerprint_receipt,
        ]
        .iter()
        .any(|record| record_request_endpoint(record) != Some(identity.endpoint.as_str()))
        || transport_jsonrpc_result(&initialize, CODE)?
            .get("protocolVersion")
            .is_none()
        || config.request != connect.request
        || connect.request != initialize.request
        || discover.request != normalize.request
        || normalize.request != fingerprint_receipt.request
        || string_field(&renderer_instance.response, "status", CODE)? != "begun"
        || string_field(&attestation.response, "status", CODE)? != "observed"
    {
        return Err(BridgeError::new(CODE));
    }
    let mcp_session_id = record_response_session(&connect)
        .filter(|value| value.len() >= 8)
        .ok_or_else(|| BridgeError::new(CODE))?
        .to_string();
    let generation = record_request_generation(&connect)
        .filter(|value| *value > 0)
        .ok_or_else(|| BridgeError::new(CODE))?;
    let renderer_instance_id =
        string_field(&renderer_instance.response, "rendererInstanceId", CODE)?.to_string();
    let process_identity_sha256 =
        string_field(&renderer_instance.response, "processIdentitySha256", CODE)?.to_string();
    if !is_lower_hex(&process_identity_sha256, 64) {
        return Err(BridgeError::new(CODE));
    }
    let counter_values = object_field(&mutation_counter.response, "values", CODE)?
        .as_array()
        .ok_or_else(|| BridgeError::new(CODE))?;
    if counter_values.len() != 5 || counter_values.iter().any(|value| value.as_u64() != Some(0)) {
        return Err(BridgeError::new(CODE));
    }

    let mut tool_search_receipts = Vec::new();
    let mut descriptor_sources =
        vec![(transport_jsonrpc_result(&discover, CODE)?.clone(), "direct")];
    let mut previous_sequence = 0;
    for call in &discovery.tool_search_calls {
        let record = consume_observation_receipt(
            identity,
            &call.receipt_id,
            "mcp_tool_search_call",
            &call.request,
            CODE,
        )?;
        if record.sequence <= previous_sequence {
            return Err(BridgeError::new(CODE));
        }
        previous_sequence = record.sequence;
        let body = object_field(&record.request, "body", CODE)?;
        if string_field(body, "method", CODE)? != "tools/call" {
            return Err(BridgeError::new(CODE));
        }
        if record_request_endpoint(&record) != Some(identity.endpoint.as_str()) {
            return Err(BridgeError::new(CODE));
        }
        let params = object_field(body, "params", CODE)?;
        let name = string_field(params, "name", CODE)?;
        if (tool_search_receipts.is_empty() && name != "list_toolsets")
            || (!tool_search_receipts.is_empty() && name != "describe_toolset")
        {
            return Err(BridgeError::new(CODE));
        }
        descriptor_sources.push((transport_jsonrpc_result(&record, CODE)?.clone(), "facade"));
        tool_search_receipts
            .push(json!({ "id": call.receipt_id, "sequence": record.sequence, "name": name }));
    }
    if tool_search_enabled != !tool_search_receipts.is_empty() {
        return Err(BridgeError::new(CODE));
    }
    let mut descriptors = Vec::new();
    for (source, source_kind) in descriptor_sources {
        collect_product_descriptors(&source, source_kind, None, &mut descriptors);
    }
    let mut canonical_descriptors = Vec::with_capacity(MVP15D_TOOL_NAMES.len());
    for name in MVP15D_TOOL_NAMES {
        let matches = descriptors
            .iter()
            .filter(|descriptor| descriptor.name == name)
            .collect::<Vec<_>>();
        if matches.len() != 1 {
            return Err(BridgeError::new(CODE));
        }
        canonical_descriptors.push(matches[0].clone());
    }
    let descriptors_value =
        serde_json::to_value(&canonical_descriptors).map_err(|_| BridgeError::new(CODE))?;
    let contract_descriptors = descriptors_value
        .as_array()
        .ok_or_else(|| BridgeError::new(CODE))?
        .iter()
        .map(|descriptor| {
            let mut descriptor = descriptor
                .as_object()
                .cloned()
                .ok_or_else(|| BridgeError::new(CODE))?;
            descriptor.remove("source");
            descriptor.remove("methodId");
            descriptor.remove("toolsetId");
            Ok(Value::Object(descriptor))
        })
        .collect::<Result<Vec<_>, BridgeError>>()?;
    let fingerprint = sha256_bytes(
        canonical_json(&json!({
            "schemaVersion": "uagent.mvp15.live-asset-toolset-fingerprint.v1",
            "tools": descriptors_value,
        }))
        .as_bytes(),
    );
    let contract_fingerprint = sha256_bytes(
        canonical_json(&json!({
            "schemaVersion": "uagent.mvp15.live-asset-toolset-contract.v1",
            "tools": contract_descriptors,
        }))
        .as_bytes(),
    );
    let event = authority_bound(
        json!({
            "mode": discovery.mode,
            "configInputSha256": sha256_bytes(canonical_json(&config.request).as_bytes()),
            "configOutputSha256": sha256_bytes(canonical_json(intent).as_bytes()),
            "mcpSessionId": mcp_session_id,
            "rendererInstanceId": renderer_instance_id,
            "processIdentitySha256": process_identity_sha256,
            "runtimePid": identity.pid,
            "generation": generation,
            "descriptors": canonical_descriptors,
            "fingerprintSha256": fingerprint,
            "mutationCount": 0,
            "wireCalls": tool_search_receipts,
            "receiptProvenance": {
                "config": { "id": discovery.config_call.receipt_id, "sequence": config.sequence },
                "rendererInstance": { "id": discovery.renderer_instance_call.receipt_id, "sequence": renderer_instance.sequence },
                "connect": { "id": discovery.connect_call.receipt_id, "sequence": connect.sequence },
                "initialize": { "id": discovery.initialize_call.receipt_id, "sequence": initialize.sequence },
                "discover": { "id": discovery.discover_call.receipt_id, "sequence": discover.sequence },
                "normalize": { "id": discovery.normalize_call.receipt_id, "sequence": normalize.sequence },
                "fingerprint": { "id": discovery.fingerprint_call.receipt_id, "sequence": fingerprint_receipt.sequence },
                "attestation": { "id": discovery.native_attestation.receipt_id, "sequence": attestation.sequence },
                "mutationCounter": { "id": discovery.mutation_counter_call.receipt_id, "sequence": mutation_counter.sequence },
            },
        })
        .as_object()
        .expect("product discovery event")
        .clone(),
        "runtime_observed",
    );
    Ok(ValidatedProductDiscovery {
        event,
        fingerprint,
        contract_fingerprint,
        mcp_session_id,
        renderer_instance_id,
        process_identity_sha256,
        generation,
        state_receipt_id: discovery.fingerprint_call.receipt_id.clone(),
    })
}

impl BridgeState {
    fn parent_runtime(&self) -> Value {
        json!({
            "pid": self.identity.pid,
            "executableBasename": self.identity.executable_basename,
            "executableSha256": self.identity.executable_sha256,
            "sourceCommit": self.identity.source_commit,
            "processIdentitySha256": sha256_bytes(canonical_json(&json!({
                "pid": self.identity.pid,
                "executableBasename": self.identity.executable_basename,
                "executableSha256": self.identity.executable_sha256,
                "sourceCommit": self.identity.source_commit,
            })).as_bytes()),
        })
    }

    pub(crate) fn predecessor_window_identity(
        &self,
        handoff_id: &str,
        status: &str,
        window_label: &str,
    ) -> Result<RendererPredecessorWindowIdentity, BridgeError> {
        const CODE: &str = "MVP15D_RENDERER_PARENT_LIFECYCLE_INVALID";
        let handoff = self
            .renderer_handoff
            .as_ref()
            .filter(|handoff| {
                !handoff.claimed
                    && handoff.handoff_id == handoff_id
                    && handoff
                        .predecessor_window_instance_binding_sha256
                        .as_deref()
                        .is_some_and(is_sha256)
            })
            .ok_or_else(|| BridgeError::new(CODE))?;
        if !matches!(
            status,
            "observed" | "missing" | "mismatch" | "dispatch_unavailable"
        ) || window_label.is_empty()
        {
            return Err(BridgeError::new(CODE));
        }
        let parent_runtime = self.parent_runtime();
        let stable_identity_sha256 = sha256_bytes(
            canonical_json(&json!({
                "schemaVersion": "uagent.mvp15d.predecessor-window-identity.v1",
                "status": status,
                "windowLabel": window_label,
                "taskId": self.identity.task_id,
                "phase": self.identity.phase.as_str(),
                "handoffId": handoff.handoff_id,
                "parentWindowInstanceBindingSha256": handoff.predecessor_window_instance_binding_sha256,
                "predecessorProcessIdentitySha256": handoff.predecessor_renderer["processIdentitySha256"],
                "parentProcessIdentitySha256": parent_runtime["processIdentitySha256"],
            }))
            .as_bytes(),
        );
        Ok(RendererPredecessorWindowIdentity {
            schema_version: "uagent.mvp15d.predecessor-window-identity.v1".to_string(),
            status: status.to_string(),
            window_label: window_label.to_string(),
            task_id: self.identity.task_id.clone(),
            phase: self.identity.phase.as_str().to_string(),
            handoff_id: handoff.handoff_id.clone(),
            stable_identity_sha256,
        })
    }

    pub(crate) fn validate_parent_lifecycle_request(
        &self,
        handoff_id: &str,
        task_id: &str,
        phase: &str,
    ) -> Result<(), BridgeError> {
        self.renderer_handoff
            .as_ref()
            .filter(|handoff| {
                !handoff.claimed
                    && handoff.parent_acknowledgement.is_none()
                    && handoff.handoff_id == handoff_id
                    && task_id == self.identity.task_id
                    && phase == self.identity.phase.as_str()
            })
            .map(|_| ())
            .ok_or_else(|| BridgeError::new("MVP15D_RENDERER_PARENT_LIFECYCLE_INVALID"))
    }

    pub(crate) fn renderer_parent_lifecycle_pending(&self) -> bool {
        self.renderer_handoff
            .as_ref()
            .is_some_and(|handoff| !handoff.claimed && handoff.parent_acknowledgement.is_none())
    }

    pub(crate) fn bind_predecessor_window_instance(
        &mut self,
        handoff_id: &str,
        instance_binding_sha256: &str,
    ) -> Result<(), BridgeError> {
        const CODE: &str = "MVP15D_RENDERER_PARENT_LIFECYCLE_INVALID";
        if !is_sha256(instance_binding_sha256) {
            return Err(BridgeError::new(CODE));
        }
        let handoff = self
            .renderer_handoff
            .as_mut()
            .filter(|handoff| !handoff.claimed && handoff.handoff_id == handoff_id)
            .ok_or_else(|| BridgeError::new(CODE))?;
        match handoff
            .predecessor_window_instance_binding_sha256
            .as_deref()
        {
            None => {
                handoff.predecessor_window_instance_binding_sha256 =
                    Some(instance_binding_sha256.to_string());
                Ok(())
            }
            Some(current) if current == instance_binding_sha256 => Ok(()),
            Some(_) => Err(BridgeError::new(CODE)),
        }
    }

    pub fn request_renderer_restart(
        &mut self,
        input: RendererRestartRequestInput,
    ) -> Result<RendererRestartRequestResult, BridgeError> {
        const CODE: &str = "MVP15D_RENDERER_HANDOFF_REQUEST_INVALID";
        if self.identity.mode != BridgeMode::Live
            || self.identity.phase != BridgePhase::ProductCapture
            || !self.driver_claimed
            || self.structured_evidence_published
            || !self.renderer_publish_authority
            || self.renderer_handoff.is_some()
            || input.schema_version != "uagent.mvp15d.renderer-restart-request.v2"
            || input.task_id != self.identity.task_id
            || input.phase != self.identity.phase.as_str()
            || input.predecessor_mcp_session_id.len() < 8
            || input.predecessor_mcp_generation == 0
            || !input.segment.is_object()
            || input
                .segment
                .get("discoveries")
                .and_then(Value::as_array)
                .map(Vec::len)
                != Some(2)
            || input
                .segment
                .get("retractions")
                .and_then(Value::as_array)
                .map(Vec::len)
                != Some(5)
            || !input
                .segment
                .get("mutationBefore")
                .is_some_and(Value::is_object)
            || !input
                .segment
                .get("readyDiscovery")
                .is_some_and(Value::is_object)
        {
            return Err(BridgeError::new(CODE));
        }
        let renderer = inspect_observation_receipt(
            &self.identity,
            &input.renderer_before,
            "renderer_instance_begin",
            CODE,
        )?;
        let predecessor_renderer = renderer.response.clone();
        if string_field(&predecessor_renderer, "status", CODE)? != "begun"
            || string_field(&predecessor_renderer, "rendererInstanceId", CODE)?.len() < 16
            || string_field(&predecessor_renderer, "processIdentitySha256", CODE)?.len() != 64
            || predecessor_renderer
                .get("process")
                .and_then(Value::as_object)
                .is_none()
        {
            return Err(BridgeError::new(CODE));
        }
        let handoff_id = format!(
            "renderer-handoff:{}",
            sha256_bytes(
                canonical_json(&json!({
                    "taskId": self.identity.task_id,
                    "phase": self.identity.phase.as_str(),
                    "renderer": predecessor_renderer,
                    "mcpSessionId": input.predecessor_mcp_session_id,
                    "mcpGeneration": input.predecessor_mcp_generation,
                    "requestedAt": std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis() as u64,
                }))
                .as_bytes(),
            )
        );
        let request_receipt_request =
            serde_json::to_value(&input).map_err(|_| BridgeError::new(CODE))?;
        self.renderer_handoff = Some(RendererRestartHandoff {
            handoff_id: handoff_id.clone(),
            predecessor_window_instance_binding_sha256: None,
            predecessor_renderer,
            predecessor_mcp_session_id: input.predecessor_mcp_session_id.clone(),
            predecessor_mcp_generation: input.predecessor_mcp_generation,
            segment: input.segment.clone(),
            request_receipt_id: String::new(),
            request_receipt_request: request_receipt_request.clone(),
            parent_acknowledgement: None,
            claimed: false,
        });
        self.renderer_publish_authority = false;
        let request_receipt_id = issue_native_observation_receipt(
            "renderer_restart_request",
            request_receipt_request,
            json!({
                "status": "restart_requested",
                "handoffId": handoff_id,
                "predecessorRenderer": self.renderer_handoff.as_ref().unwrap().predecessor_renderer.clone(),
            }),
        )
        .ok_or_else(|| BridgeError::new(CODE))?;
        self.renderer_handoff.as_mut().unwrap().request_receipt_id = request_receipt_id.clone();
        Ok(RendererRestartRequestResult {
            schema_version: "uagent.mvp15d.renderer-restart-response.v2".to_string(),
            handoff_id,
            request_receipt_id,
            task_id: self.identity.task_id.clone(),
            phase: self.identity.phase.as_str().to_string(),
        })
    }

    pub fn acknowledge_renderer_parent_lifecycle(
        &mut self,
        input: RendererParentLifecycleAcknowledgementInput,
    ) -> Result<RendererParentLifecycleAcknowledgementResult, BridgeError> {
        const CODE: &str = "MVP15D_RENDERER_PARENT_LIFECYCLE_INVALID";
        let handoff = self
            .renderer_handoff
            .as_ref()
            .filter(|handoff| {
                !handoff.claimed
                    && handoff.parent_acknowledgement.is_none()
                    && handoff.handoff_id == input.handoff_id
            })
            .cloned()
            .ok_or_else(|| BridgeError::new(CODE))?;
        if self.identity.mode != BridgeMode::Live
            || self.identity.phase != BridgePhase::ProductCapture
            || self.renderer_publish_authority
            || input.schema_version != "uagent.mvp15d.renderer-parent-lifecycle-acknowledgement.v2"
            || input.task_id != self.identity.task_id
            || input.phase != self.identity.phase.as_str()
        {
            return Err(BridgeError::new(CODE));
        }
        let expected_window = self.predecessor_window_identity(
            &input.handoff_id,
            &input.predecessor_window.status,
            &input.predecessor_window.window_label,
        )?;
        if input.predecessor_window != expected_window
            || input.predecessor_window.window_label.is_empty()
            || input.predecessor_window.window_label.contains('/')
            || input.predecessor_window.window_label.contains('\\')
            || (input.predecessor_window.status == "observed"
                && input.predecessor_window.window_label != RENDERER_PREDECESSOR_WINDOW_LABEL)
        {
            return Err(BridgeError::new(CODE));
        }

        let valid_destroy_outcome = match input.destroy_outcome.status.as_str() {
            "succeeded" => input.destroy_outcome.reason.is_none(),
            "failed" => input
                .destroy_outcome
                .reason
                .as_deref()
                .is_some_and(|reason| {
                    matches!(
                        reason,
                        "predecessor_window_missing"
                            | "predecessor_window_identity_mismatch"
                            | "predecessor_destroy_failed"
                    )
                }),
            "not_attempted" => {
                input.destroy_outcome.reason.as_deref()
                    == Some("parent_main_thread_dispatch_failed")
            }
            _ => false,
        };
        let valid_successor_outcome = match input.successor_creation_outcome.status.as_str() {
            "succeeded" => input.successor_creation_outcome.reason.is_none(),
            "failed" => {
                input.successor_creation_outcome.reason.as_deref() == Some("successor_build_failed")
            }
            "not_attempted" => {
                input.successor_creation_outcome.reason.as_deref()
                    == Some("successor_creation_not_attempted")
            }
            _ => false,
        };
        if !valid_destroy_outcome || !valid_successor_outcome {
            return Err(BridgeError::new(CODE));
        }
        let window_outcomes_valid = match input.predecessor_window.status.as_str() {
            "observed" => true,
            "missing" => {
                input.destroy_outcome.status == "failed"
                    && input.destroy_outcome.reason.as_deref() == Some("predecessor_window_missing")
                    && input.successor_creation_outcome.status == "not_attempted"
            }
            "mismatch" => {
                input.destroy_outcome.status == "failed"
                    && input.destroy_outcome.reason.as_deref()
                        == Some("predecessor_window_identity_mismatch")
                    && input.successor_creation_outcome.status == "not_attempted"
            }
            "dispatch_unavailable" => {
                input.destroy_outcome.status == "not_attempted"
                    && input.destroy_outcome.reason.as_deref()
                        == Some("parent_main_thread_dispatch_failed")
                    && input.successor_creation_outcome.status == "not_attempted"
            }
            _ => false,
        };
        if !window_outcomes_valid {
            return Err(BridgeError::new(CODE));
        }
        let (status, failure_reason) = match (
            input.destroy_outcome.status.as_str(),
            input.successor_creation_outcome.status.as_str(),
        ) {
            ("succeeded", "succeeded") => ("acknowledged", None),
            ("failed", "not_attempted") | ("not_attempted", "not_attempted") => {
                ("failed", input.destroy_outcome.reason.clone())
            }
            ("succeeded", "failed") => ("failed", input.successor_creation_outcome.reason.clone()),
            _ => return Err(BridgeError::new(CODE)),
        };
        let parent_runtime = self.parent_runtime();
        let receipt_request = serde_json::to_value(&input).map_err(|_| BridgeError::new(CODE))?;
        let response = json!({
            "schemaVersion": "uagent.mvp15d.renderer-parent-lifecycle-acknowledgement.v2",
            "status": status,
            "failureReason": failure_reason,
            "handoffId": handoff.handoff_id,
            "taskId": self.identity.task_id,
            "phase": self.identity.phase.as_str(),
            "predecessorRenderer": handoff.predecessor_renderer,
            "predecessorWindow": input.predecessor_window,
            "destroyOutcome": input.destroy_outcome,
            "successorCreationOutcome": input.successor_creation_outcome,
            "parentRuntime": parent_runtime,
        });
        let (receipt_id, receipt_sequence, receipt_response) =
            issue_renderer_parent_lifecycle_receipt(receipt_request.clone(), response)
                .ok_or_else(|| BridgeError::new(CODE))?;
        self.renderer_handoff
            .as_mut()
            .expect("validated renderer handoff")
            .parent_acknowledgement = Some(RendererParentLifecycleAcknowledgement {
            status: status.to_string(),
            predecessor_window: input.predecessor_window.clone(),
            receipt_id: receipt_id.clone(),
            receipt_request: receipt_request.clone(),
            receipt_sequence,
            receipt_response,
            consumed: false,
        });
        Ok(RendererParentLifecycleAcknowledgementResult {
            schema_version: "uagent.mvp15d.renderer-parent-lifecycle-acknowledgement-result.v2"
                .to_string(),
            status: status.to_string(),
            failure_reason,
            handoff_id: handoff.handoff_id,
            receipt_id,
            receipt_request,
            receipt_sequence,
            parent_runtime,
            predecessor_renderer: handoff.predecessor_renderer,
            predecessor_window: input.predecessor_window,
            destroy_outcome: input.destroy_outcome,
            successor_creation_outcome: input.successor_creation_outcome,
        })
    }

    pub fn claim_renderer_restart(
        &mut self,
        input: RendererRestartClaimInput,
    ) -> Result<RendererRestartClaimResult, BridgeError> {
        const CODE: &str = "MVP15D_RENDERER_HANDOFF_CLAIM_INVALID";
        if self.identity.mode != BridgeMode::Live
            || self.identity.phase != BridgePhase::ProductCapture
            || self.renderer_publish_authority
            || input.schema_version != "uagent.mvp15d.renderer-restart-claim.v3"
            || input.task_id != self.identity.task_id
            || input.phase != self.identity.phase.as_str()
        {
            return Err(BridgeError::new(CODE));
        }
        let handoff = self
            .renderer_handoff
            .as_ref()
            .filter(|handoff| !handoff.claimed && handoff.handoff_id == input.handoff_id)
            .cloned()
            .ok_or_else(|| BridgeError::new(CODE))?;
        let parent_acknowledgement = handoff
            .parent_acknowledgement
            .as_ref()
            .filter(|acknowledgement| {
                acknowledgement.status == "acknowledged" && !acknowledgement.consumed
            })
            .cloned()
            .ok_or_else(|| BridgeError::new(CODE))?;
        if parent_acknowledgement.predecessor_window.status != "observed"
            || parent_acknowledgement.predecessor_window.window_label
                != RENDERER_PREDECESSOR_WINDOW_LABEL
            || input.predecessor_window_identity_sha256
                != parent_acknowledgement
                    .predecessor_window
                    .stable_identity_sha256
        {
            return Err(BridgeError::new(CODE));
        }
        let renderer = inspect_observation_receipt(
            &self.identity,
            &input.renderer_after,
            "renderer_instance_begin",
            CODE,
        )?;
        let successor_renderer = renderer.response.clone();
        let predecessor_process = handoff
            .predecessor_renderer
            .get("process")
            .and_then(Value::as_object)
            .ok_or_else(|| BridgeError::new(CODE))?;
        let successor_process = successor_renderer
            .get("process")
            .and_then(Value::as_object)
            .ok_or_else(|| BridgeError::new(CODE))?;
        if successor_renderer.get("status").and_then(Value::as_str) != Some("begun")
            || successor_renderer.get("processIdentitySha256")
                == handoff.predecessor_renderer.get("processIdentitySha256")
            || successor_process.get("pid") == predecessor_process.get("pid")
            || successor_process.get("startTime") == predecessor_process.get("startTime")
            || input.successor_mcp_session_id.len() < 8
            || input.successor_mcp_session_id == handoff.predecessor_mcp_session_id
            || input.successor_mcp_generation <= handoff.predecessor_mcp_generation
        {
            return Err(BridgeError::new(CODE));
        }
        let claim_receipt_request =
            serde_json::to_value(&input).map_err(|_| BridgeError::new(CODE))?;
        let claim_receipt_id = issue_native_observation_receipt(
            "renderer_restart_successor",
            claim_receipt_request.clone(),
            json!({
                "status": "successor_claimed",
                "handoffId": handoff.handoff_id.clone(),
                "predecessorRenderer": handoff.predecessor_renderer.clone(),
                "successorRenderer": successor_renderer.clone(),
                "predecessorMcpSessionId": handoff.predecessor_mcp_session_id.clone(),
                "successorMcpSessionId": input.successor_mcp_session_id.clone(),
                "predecessorMcpGeneration": handoff.predecessor_mcp_generation,
                "successorMcpGeneration": input.successor_mcp_generation,
                "parentLifecycleAcknowledgementReceiptId": parent_acknowledgement.receipt_id,
                "parentLifecycleAcknowledgementSequence": parent_acknowledgement.receipt_sequence,
                "predecessorWindow": parent_acknowledgement.predecessor_window,
            }),
        )
        .ok_or_else(|| BridgeError::new(CODE))?;
        let current = self.renderer_handoff.as_mut().unwrap();
        current.claimed = true;
        current
            .parent_acknowledgement
            .as_mut()
            .expect("validated parent acknowledgement")
            .consumed = true;
        self.renderer_publish_authority = true;
        Ok(RendererRestartClaimResult {
            schema_version: "uagent.mvp15d.renderer-restart-claim-result.v3".to_string(),
            handoff_id: handoff.handoff_id,
            claim_receipt_id,
            request_receipt_id: handoff.request_receipt_id,
            request_receipt_request: handoff.request_receipt_request,
            parent_acknowledgement_receipt_id: parent_acknowledgement.receipt_id,
            parent_acknowledgement_receipt_request: parent_acknowledgement.receipt_request,
            parent_acknowledgement_receipt_sequence: parent_acknowledgement.receipt_sequence,
            claim_receipt_request,
            segment: handoff.segment,
            predecessor_window: parent_acknowledgement.predecessor_window,
            predecessor_renderer: handoff.predecessor_renderer,
            successor_renderer,
            predecessor_mcp_session_id: handoff.predecessor_mcp_session_id,
            successor_mcp_session_id: input.successor_mcp_session_id,
            predecessor_mcp_generation: handoff.predecessor_mcp_generation,
            successor_mcp_generation: input.successor_mcp_generation,
        })
    }

    pub fn renderer_configuration(&self) -> RendererBridgeConfiguration {
        let project_root = if self.identity.mode == BridgeMode::Live {
            Some(
                self.identity
                    .evidence_root
                    .join("project")
                    .join("FinalHost")
                    .to_string_lossy()
                    .to_string(),
            )
        } else {
            None
        };
        RendererBridgeConfiguration {
            enabled: true,
            bridge_version: BRIDGE_VERSION,
            phase: self.identity.phase.as_str().to_string(),
            mode: self.identity.mode.as_str().to_string(),
            task_id: self.identity.task_id.clone(),
            session: self.identity.session.clone(),
            generation: self.identity.generation,
            endpoint: (self.identity.mode == BridgeMode::Live)
                .then(|| self.identity.endpoint.clone()),
            project_root,
            rendered_product_path: self.identity.rendered_product_path.clone(),
            driver_poll_milliseconds: 50,
            observation_timeout_milliseconds: 30_000,
            approval_ttl_wait_milliseconds: 70_000,
            receipt_ledger_enabled: self.identity.mode == BridgeMode::Live
                && self.identity.phase.rendered(),
            renderer_handoff_pending: self.renderer_handoff.as_ref().is_some_and(|handoff| {
                !handoff.claimed
                    && handoff
                        .parent_acknowledgement
                        .as_ref()
                        .is_some_and(|acknowledgement| acknowledgement.status == "acknowledged")
            }),
            renderer_handoff_id: self
                .renderer_handoff
                .as_ref()
                .filter(|handoff| !handoff.claimed)
                .map(|handoff| handoff.handoff_id.clone()),
            renderer_parent_lifecycle_status: self.renderer_handoff.as_ref().and_then(|handoff| {
                (!handoff.claimed).then(|| {
                    handoff
                        .parent_acknowledgement
                        .as_ref()
                        .map(|acknowledgement| acknowledgement.status.clone())
                        .unwrap_or_else(|| "pending".to_string())
                })
            }),
            renderer_parent_lifecycle_failure: self.renderer_handoff.as_ref().and_then(|handoff| {
                handoff
                    .parent_acknowledgement
                    .as_ref()
                    .and_then(|acknowledgement| {
                        (acknowledgement.status == "failed").then(|| {
                            acknowledgement
                                .receipt_response
                                .get("failureReason")
                                .and_then(Value::as_str)
                                .unwrap_or("parent_lifecycle_failed")
                                .to_string()
                        })
                    })
            }),
            renderer_handoff_predecessor_mcp_generation: self
                .renderer_handoff
                .as_ref()
                .filter(|handoff| !handoff.claimed)
                .map(|handoff| handoff.predecessor_mcp_generation),
            renderer_handoff_predecessor_window_identity_sha256: self
                .renderer_handoff
                .as_ref()
                .filter(|handoff| !handoff.claimed)
                .and_then(|handoff| handoff.parent_acknowledgement.as_ref())
                .filter(|acknowledgement| acknowledgement.status == "acknowledged")
                .map(|acknowledgement| {
                    acknowledgement
                        .predecessor_window
                        .stable_identity_sha256
                        .clone()
                }),
        }
    }

    pub fn observe_native_state(
        &mut self,
        input: ObserveNativeStateInput,
    ) -> Result<ObserveNativeStateResult, BridgeError> {
        let successor_renderer_observation = !self.renderer_publish_authority
            && input.kind == "renderer_process"
            && self
                .renderer_handoff
                .as_ref()
                .is_some_and(|handoff| !handoff.claimed);
        if self.identity.mode != BridgeMode::Live
            || !self.identity.phase.rendered()
            || !self.driver_claimed
            || self.structured_evidence_published
            || input.schema_version != "uagent.mvp15d.native-state-observation.v1"
            || !input.request.is_object()
            || (!self.renderer_publish_authority && !successor_renderer_observation)
        {
            return Err(BridgeError::new("MVP15D_BRIDGE_NATIVE_STATE_INVALID"));
        }
        let records = observation_receipt_ledger()
            .lock()
            .map_err(|_| BridgeError::new("MVP15D_BRIDGE_RECEIPT_LEDGER_UNAVAILABLE"))?
            .records
            .iter()
            .map(|(id, record)| (id.clone(), record.clone()))
            .collect::<Vec<_>>();
        let (api, observation) = match input.kind.as_str() {
            "renderer_process" => ("renderer_instance_begin", observe_renderer_process()?),
            "mutation_counters" => {
                let records = records
                    .iter()
                    .map(|(_, record)| record.clone())
                    .collect::<Vec<_>>();
                let values = native_mutation_counters(&records);
                (
                    "mutation_counter_read",
                    json!({
                        "counterNames": ["native", "mcp", "provider", "verify", "rollback"],
                        "values": values,
                    }),
                )
            }
            "recorded_replay" => {
                let has_registration = records
                    .iter()
                    .any(|(_, record)| record.api == "register_asset_mutation_approval");
                let has_execute = records
                    .iter()
                    .any(|(_, record)| record.api == "execute_asset_mutation");
                let has_rollback = records
                    .iter()
                    .any(|(_, record)| record.api == "rollback_asset_mutation");
                let has_transport = records
                    .iter()
                    .any(|(_, record)| record.api == "mcp_asset_tool_call");
                if !(has_registration && has_execute && has_rollback && has_transport) {
                    return Err(BridgeError::new("MVP15D_RECORDED_REPLAY_STATE_INVALID"));
                }
                let event_count = records
                    .iter()
                    .filter(|(_, record)| {
                        matches!(
                            record.api.as_str(),
                            "register_asset_mutation_approval"
                                | "execute_asset_mutation"
                                | "rollback_asset_mutation"
                                | "record_asset_mutation_outcome"
                                | "mcp_asset_tool_call"
                        )
                    })
                    .count();
                (
                    "recorded_replay_read",
                    json!({
                        "status": "recorded",
                        "recordedRepresentation": {
                            "eventCount": event_count,
                            "recordedOnlyActions": ["dry-run", "preview", "approval", "execute", "verify", "rollback"],
                        },
                    }),
                )
            }
            "mcp_disconnect" => {
                return Err(BridgeError::new(
                    "MVP15D_MCP_DISCONNECT_TRANSPORT_RECEIPT_REQUIRED",
                ))
            }
            "mcp_retraction_transition" => {
                let reason =
                    string_field(&input.request, "reason", "MVP15D_RETRACTION_STATE_INVALID")?;
                if !matches!(
                    reason,
                    "disconnect"
                        | "endpoint_change"
                        | "failure"
                        | "newer_generation"
                        | "attestation_invalidation"
                        | "renderer_restart"
                ) {
                    return Err(BridgeError::new("MVP15D_RETRACTION_STATE_INVALID"));
                }
                let state_before_id = string_field(
                    &input.request,
                    "stateBeforeReceiptId",
                    "MVP15D_RETRACTION_STATE_INVALID",
                )?;
                let ready = records
                    .iter()
                    .find(|(id, record)| {
                        id == state_before_id
                            && record.api == "mcp_fingerprint"
                            && record.sequence > self.last_native_transition_sequence
                    })
                    .ok_or_else(|| BridgeError::new("MVP15D_RETRACTION_READY_STATE_REQUIRED"))?;
                let ready_generation = record_request_generation(&ready.1)
                    .ok_or_else(|| BridgeError::new("MVP15D_RETRACTION_READY_STATE_REQUIRED"))?;
                let ready_endpoint = record_request_endpoint(&ready.1)
                    .ok_or_else(|| BridgeError::new("MVP15D_RETRACTION_READY_STATE_REQUIRED"))?;
                let ready_attestation = records
                    .iter()
                    .filter(|(_, record)| {
                        record.api == "attest_mvp15_companion"
                            && record.sequence > ready.1.sequence
                            && record
                                .response
                                .as_object()
                                .and_then(|response| response.get("status"))
                                .and_then(Value::as_str)
                                == Some("observed")
                    })
                    .min_by_key(|(_, record)| record.sequence)
                    .ok_or_else(|| BridgeError::new("MVP15D_RETRACTION_READY_STATE_REQUIRED"))?;
                let action_records = records
                    .iter()
                    .filter(|(_, record)| record.sequence > ready_attestation.1.sequence)
                    .collect::<Vec<_>>();
                let action_valid = match reason {
                    "disconnect" => action_records
                        .iter()
                        .any(|(_, record)| record.api == "mcp_disconnect"),
                    "endpoint_change" => action_records.iter().any(|(_, record)| {
                        matches!(record.api.as_str(), "mcp_connect" | "mcp_transport_failure")
                            && record_request_endpoint(record)
                                .is_some_and(|value| value != ready_endpoint)
                    }),
                    "failure" => action_records
                        .iter()
                        .any(|(_, record)| record.api == "mcp_transport_failure"),
                    "newer_generation" => action_records.iter().any(|(_, record)| {
                        record.api == "mcp_fingerprint"
                            && record_request_generation(record)
                                .is_some_and(|generation| generation > ready_generation)
                    }),
                    "attestation_invalidation" => action_records
                        .iter()
                        .any(|(_, record)| record.api == "retract_mvp15_companion_approvals"),
                    "renderer_restart" => {
                        let renderer_processes = action_records
                            .iter()
                            .filter(|(_, record)| record.api == "renderer_instance_begin")
                            .collect::<Vec<_>>();
                        renderer_processes.len() >= 2
                            && renderer_processes
                                .first()
                                .map(|(_, record)| &record.response)
                                != renderer_processes
                                    .last()
                                    .map(|(_, record)| &record.response)
                            && action_records.iter().any(|(_, record)| {
                                record.api == "mcp_connect"
                                    && record_request_generation(record)
                                        .is_some_and(|generation| generation > ready_generation)
                            })
                            && action_records
                                .iter()
                                .any(|(_, record)| record.api == "renderer_restart_request")
                            && action_records
                                .iter()
                                .any(|(_, record)| record.api == "renderer_restart_successor")
                    }
                    _ => false,
                };
                if !action_valid {
                    return Err(BridgeError::new("MVP15D_RETRACTION_ACTION_INVALID"));
                }
                let native_retraction = action_records
                    .iter()
                    .filter(|(_, record)| record.api == "retract_mvp15_companion_approvals")
                    .max_by_key(|(_, record)| record.sequence)
                    .ok_or_else(|| BridgeError::new("MVP15D_RETRACTION_NATIVE_STATE_INVALID"))?;
                let latest_connection_or_discovery = action_records
                    .iter()
                    .filter(|(_, record)| {
                        matches!(record.api.as_str(), "mcp_connect" | "mcp_fingerprint")
                    })
                    .max_by_key(|(_, record)| record.sequence);
                let session_after = latest_connection_or_discovery
                    .and_then(|(_, record)| record_response_session(record))
                    .unwrap_or_default();
                let generation_after = action_records
                    .iter()
                    .filter_map(|(_, record)| record_request_generation(record))
                    .max()
                    .unwrap_or(ready_generation);
                self.last_native_transition_sequence = native_retraction.1.sequence;
                (
                    "mcp_retraction_transition",
                    json!({
                        "status": "retracted",
                        "reason": reason,
                        "readyReceiptId": state_before_id,
                        "readyReceiptSequence": ready.1.sequence,
                        "readyAttestationReceiptId": ready_attestation.0,
                        "readyAttestationReceiptSequence": ready_attestation.1.sequence,
                        "sessionIdAfter": session_after,
                        "generationAfter": generation_after,
                        "stateBeforeReceiptId": state_before_id,
                        "stateAfterReceiptId": native_retraction.0,
                        "actionReceipts": action_records.iter().map(|(id, record)| json!({
                            "api": record.api,
                            "id": id,
                            "sequence": record.sequence,
                        })).collect::<Vec<_>>(),
                    }),
                )
            }
            _ => return Err(BridgeError::new("MVP15D_BRIDGE_NATIVE_STATE_INVALID")),
        };
        let request = input.request;
        let receipt_id =
            issue_native_observation_receipt(api, request.clone(), observation.clone())
                .ok_or_else(|| BridgeError::new("MVP15D_BRIDGE_RECEIPT_LEDGER_UNAVAILABLE"))?;
        Ok(ObserveNativeStateResult {
            schema_version: "uagent.mvp15d.native-state-observation.v1",
            receipt_id,
            request,
            observation,
        })
    }

    pub fn claim_driver_command(&mut self) -> Result<Option<String>, BridgeError> {
        if self.driver_claimed || !self.identity.driver_file.exists() {
            return Ok(None);
        }
        let metadata = fs::symlink_metadata(&self.identity.driver_file)
            .map_err(|_| BridgeError::new("MVP15D_BRIDGE_DRIVER_FILE_INVALID"))?;
        if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.len() > 4096 {
            return Err(BridgeError::new("MVP15D_BRIDGE_DRIVER_FILE_INVALID"));
        }
        let bytes = fs::read(&self.identity.driver_file)
            .map_err(|_| BridgeError::new("MVP15D_BRIDGE_DRIVER_FILE_INVALID"))?;
        let command: DriverCommand = serde_json::from_slice(&bytes)
            .map_err(|_| BridgeError::new("MVP15D_BRIDGE_DRIVER_COMMAND_INVALID"))?;
        let expected = if self.identity.mode == BridgeMode::CapabilityOnly {
            "capability-handshake"
        } else {
            match self.identity.phase {
                BridgePhase::ProductCapture => "run-product-capture",
                BridgePhase::UiLifecycle => "run-ui-lifecycle",
                BridgePhase::CapabilityProbe => "",
            }
        };
        if command.schema_version != DRIVER_SCHEMA
            || command.task_id != self.identity.task_id
            || command.phase != self.identity.phase.as_str()
            || command.session != self.identity.session
            || command.generation != self.identity.generation
            || command.nonce_sha256 != self.identity.nonce_sha256
            || command.command != expected
        {
            return Err(BridgeError::new("MVP15D_BRIDGE_DRIVER_COMMAND_INVALID"));
        }
        fs::remove_file(&self.identity.driver_file)
            .map_err(|_| BridgeError::new("MVP15D_BRIDGE_DRIVER_CLEANUP_FAILED"))?;
        self.driver_claimed = true;
        Ok(Some(command.command))
    }

    pub fn record_renderer_step(
        &mut self,
        input: RendererStepInput,
    ) -> Result<RendererStepResult, BridgeError> {
        if self.completed || !self.driver_claimed {
            return Err(BridgeError::new("MVP15D_BRIDGE_RENDERER_SEQUENCE_INVALID"));
        }
        let expected_steps = steps(&self.identity);
        let expected = expected_steps
            .get(self.next_step)
            .ok_or_else(|| BridgeError::new("MVP15D_BRIDGE_RENDERER_SEQUENCE_INVALID"))?;
        if input.step != *expected {
            return Err(BridgeError::new("MVP15D_BRIDGE_RENDERER_SEQUENCE_INVALID"));
        }
        append_event(
            &mut self.file,
            &self.identity,
            "renderer_observation",
            json!({
                "step": input.step,
                "sequence": self.next_step + 1,
                "renderer": "actual_webview",
            }),
        )?;
        self.next_step += 1;
        Ok(RendererStepResult {
            accepted: true,
            next_step: expected_steps
                .get(self.next_step)
                .map(|value| value.to_string()),
        })
    }

    pub fn publish_product_evidence(
        &mut self,
        input: ProductStoreEvidenceInput,
    ) -> Result<(), BridgeError> {
        if self.identity.phase != BridgePhase::ProductCapture
            || self.identity.mode != BridgeMode::Live
            || self.structured_evidence_published
            || !self.renderer_publish_authority
            || self.next_step != steps(&self.identity).len()
            || input.schema_version != "uagent.mvp15d.product-store-evidence.v4"
            || input.status != "ready"
            || input.reason.is_some()
            || input.discoveries.len() != 2
            || input.retractions.len() != MVP15D_RETRACTION_REASONS.len()
            || input.mutation_before.dry_run != 0
            || input.mutation_before.execute != 0
            || input.mutation_before.rollback != 0
            || canonical_json(
                &serde_json::to_value(&input.mutation_before)
                    .map_err(|_| BridgeError::new("MVP15D_BRIDGE_PRODUCT_EVIDENCE_INVALID"))?,
            ) != canonical_json(
                &serde_json::to_value(&input.mutation_after)
                    .map_err(|_| BridgeError::new("MVP15D_BRIDGE_PRODUCT_EVIDENCE_INVALID"))?,
            )
        {
            return Err(BridgeError::new("MVP15D_BRIDGE_PRODUCT_EVIDENCE_INVALID"));
        }

        append_event(
            &mut self.file,
            &self.identity,
            "capture_origin",
            json!({
                "authorityLevel": "runtime_observed",
                "origin": "real_product_adapter",
                "fixtureUsed": false,
                "manualDescriptorInjection": false,
                "directMcpBypass": false,
            }),
        )?;
        for step in [
            "Connect",
            "Initialize",
            "Discover",
            "Normalize",
            "Fingerprint",
        ] {
            append_event(
                &mut self.file,
                &self.identity,
                "product_step",
                json!({ "step": step }),
            )?;
        }
        let discoveries = input
            .discoveries
            .iter()
            .map(|discovery| validate_product_discovery(&self.identity, discovery))
            .collect::<Result<Vec<_>, _>>()?;
        if input.discoveries[0].mode != "on"
            || input.discoveries[1].mode != "off"
            || discoveries[0].mcp_session_id == discoveries[1].mcp_session_id
            || discoveries[0].generation == discoveries[1].generation
            || discoveries[0].contract_fingerprint != discoveries[1].contract_fingerprint
        {
            return Err(BridgeError::new("MVP15D_BRIDGE_PRODUCT_EVIDENCE_INVALID"));
        }
        for discovery in &discoveries {
            append_event(
                &mut self.file,
                &self.identity,
                "product_discovery_observation",
                discovery.event.clone(),
            )?;
        }
        let mut ready_sessions = Vec::new();
        let mut ready_generations = Vec::new();
        for (index, retraction) in input.retractions.iter().enumerate() {
            const CODE: &str = "MVP15D_BRIDGE_PRODUCT_EVIDENCE_INVALID";
            if retraction.reason != MVP15D_RETRACTION_REASONS[index] {
                return Err(BridgeError::new(CODE));
            }
            let ready = validate_product_discovery(&self.identity, &retraction.ready_discovery)?;
            if retraction.ready_discovery.mode != "off"
                || ready.fingerprint != discoveries[1].fingerprint
                || ready_sessions.contains(&ready.mcp_session_id)
                || ready_generations.contains(&ready.generation)
            {
                return Err(BridgeError::new(CODE));
            }
            ready_sessions.push(ready.mcp_session_id.clone());
            ready_generations.push(ready.generation);
            let transition = consume_observation_receipt(
                &self.identity,
                &retraction.transition_call.receipt_id,
                "mcp_retraction_transition",
                &retraction.transition_call.request,
                CODE,
            )?;
            let next_renderer = consume_observation_receipt(
                &self.identity,
                &retraction.renderer_instance_call.receipt_id,
                "renderer_instance_begin",
                &retraction.renderer_instance_call.request,
                CODE,
            )?;
            let native_retraction =
                native_retraction_receipt(&self.identity, &retraction.native_retraction, CODE)?;
            let handoff_data = if retraction.reason == "renderer_restart" {
                let evidence = retraction
                    .renderer_handoff
                    .as_ref()
                    .ok_or_else(|| BridgeError::new(CODE))?;
                let request = consume_observation_receipt(
                    &self.identity,
                    &evidence.request_call.receipt_id,
                    "renderer_restart_request",
                    &evidence.request_call.request,
                    CODE,
                )?;
                let parent_acknowledgement = consume_observation_receipt(
                    &self.identity,
                    &evidence.parent_acknowledgement_call.receipt_id,
                    "renderer_parent_lifecycle_acknowledgement",
                    &evidence.parent_acknowledgement_call.request,
                    CODE,
                )?;
                let claim = consume_observation_receipt(
                    &self.identity,
                    &evidence.claim_call.receipt_id,
                    "renderer_restart_successor",
                    &evidence.claim_call.request,
                    CODE,
                )?;
                let request_handoff = string_field(&request.response, "handoffId", CODE)?;
                let acknowledgement_handoff =
                    string_field(&parent_acknowledgement.response, "handoffId", CODE)?;
                let claim_handoff = string_field(&claim.response, "handoffId", CODE)?;
                let predecessor_renderer =
                    object_field(&claim.response, "predecessorRenderer", CODE)?;
                let successor_renderer = object_field(&claim.response, "successorRenderer", CODE)?;
                let predecessor_window =
                    object_field(&parent_acknowledgement.response, "predecessorWindow", CODE)?;
                let claimed_predecessor_window =
                    object_field(&claim.response, "predecessorWindow", CODE)?;
                let predecessor_window_sha256 =
                    string_field(predecessor_window, "stableIdentitySha256", CODE)?;
                if string_field(&request.response, "status", CODE)? != "restart_requested"
                    || string_field(&parent_acknowledgement.response, "status", CODE)?
                        != "acknowledged"
                    || string_field(&claim.response, "status", CODE)? != "successor_claimed"
                    || request_handoff != acknowledgement_handoff
                    || request_handoff != claim_handoff
                    || predecessor_window != claimed_predecessor_window
                    || string_field(predecessor_window, "schemaVersion", CODE)?
                        != "uagent.mvp15d.predecessor-window-identity.v1"
                    || string_field(predecessor_window, "status", CODE)? != "observed"
                    || string_field(predecessor_window, "windowLabel", CODE)?
                        != RENDERER_PREDECESSOR_WINDOW_LABEL
                    || string_field(predecessor_window, "taskId", CODE)? != self.identity.task_id
                    || string_field(predecessor_window, "phase", CODE)?
                        != self.identity.phase.as_str()
                    || string_field(predecessor_window, "handoffId", CODE)? != request_handoff
                    || predecessor_window_sha256.len() != 64
                    || claim
                        .request
                        .get("predecessorWindowIdentitySha256")
                        .and_then(Value::as_str)
                        != Some(predecessor_window_sha256)
                    || claim
                        .response
                        .get("parentLifecycleAcknowledgementReceiptId")
                        .and_then(Value::as_str)
                        != Some(evidence.parent_acknowledgement_call.receipt_id.as_str())
                    || claim
                        .response
                        .get("parentLifecycleAcknowledgementSequence")
                        .and_then(Value::as_u64)
                        != Some(parent_acknowledgement.sequence)
                    || parent_acknowledgement
                        .response
                        .get("sequence")
                        .and_then(Value::as_u64)
                        != Some(parent_acknowledgement.sequence)
                    || request.sequence >= parent_acknowledgement.sequence
                    || parent_acknowledgement.sequence >= claim.sequence
                    || predecessor_renderer.get("processIdentitySha256")
                        == successor_renderer.get("processIdentitySha256")
                    || successor_renderer.get("processIdentitySha256")
                        != next_renderer.response.get("processIdentitySha256")
                {
                    return Err(BridgeError::new(CODE));
                }
                json!({
                    "handoffId": request_handoff,
                    "requestReceipt": { "id": evidence.request_call.receipt_id, "sequence": request.sequence },
                    "parentAcknowledgementReceipt": {
                        "id": evidence.parent_acknowledgement_call.receipt_id,
                        "sequence": parent_acknowledgement.sequence,
                    },
                    "claimReceipt": { "id": evidence.claim_call.receipt_id, "sequence": claim.sequence },
                    "parentRuntime": parent_acknowledgement.response["parentRuntime"],
                    "destroyOutcome": parent_acknowledgement.response["destroyOutcome"],
                    "successorCreationOutcome": parent_acknowledgement.response["successorCreationOutcome"],
                    "predecessorWindow": predecessor_window,
                    "predecessorRenderer": predecessor_renderer,
                    "successorRenderer": successor_renderer,
                    "predecessorMcpSessionId": claim.response["predecessorMcpSessionId"],
                    "successorMcpSessionId": claim.response["successorMcpSessionId"],
                    "predecessorMcpGeneration": claim.response["predecessorMcpGeneration"],
                    "successorMcpGeneration": claim.response["successorMcpGeneration"],
                })
            } else {
                if retraction.renderer_handoff.is_some() {
                    return Err(BridgeError::new(CODE));
                }
                Value::Null
            };
            let session_id_after = object_field(&transition.response, "sessionIdAfter", CODE)?
                .as_str()
                .ok_or_else(|| BridgeError::new(CODE))?;
            let renderer_after = string_field(&next_renderer.response, "rendererInstanceId", CODE)?;
            let process_after =
                string_field(&next_renderer.response, "processIdentitySha256", CODE)?;
            let generation_after = u64_field(&transition.response, "generationAfter", CODE)?;
            let state_before = string_field(&transition.response, "stateBeforeReceiptId", CODE)?;
            let state_after = string_field(&transition.response, "stateAfterReceiptId", CODE)?;
            if string_field(&transition.response, "reason", CODE)? != retraction.reason
                || string_field(&next_renderer.response, "status", CODE)? != "begun"
                || generation_after < ready.generation
                || state_before != ready.state_receipt_id
                || state_after != retraction.native_retraction.receipt_id
            {
                return Err(BridgeError::new(CODE));
            }
            let session_after_value = if session_id_after.is_empty() {
                Value::Null
            } else {
                Value::String(session_id_after.to_string())
            };
            let data = json!({
                "reason": retraction.reason,
                "sessionIdBefore": ready.mcp_session_id,
                "sessionIdAfter": session_after_value,
                "rendererInstanceIdBefore": ready.renderer_instance_id,
                "rendererInstanceIdAfter": renderer_after,
                "processIdentitySha256Before": ready.process_identity_sha256,
                "processIdentitySha256After": process_after,
                "generationBefore": ready.generation,
                "generationAfter": generation_after,
                "fingerprintSha256": ready.fingerprint,
                "count": MVP15D_TOOL_NAMES.len(),
                "stateBeforeReceiptId": state_before,
                "stateAfterReceiptId": state_after,
                "readyStateReceipt": {
                    "id": state_before,
                    "sequence": transition.response["readyReceiptSequence"],
                },
                "readyAttestationReceipt": {
                    "id": transition.response["readyAttestationReceiptId"],
                    "sequence": transition.response["readyAttestationReceiptSequence"],
                },
                "actionReceipts": transition.response["actionReceipts"],
                "transitionReceipt": { "id": retraction.transition_call.receipt_id, "sequence": transition.sequence },
                "rendererInstanceReceipt": { "id": retraction.renderer_instance_call.receipt_id, "sequence": next_renderer.sequence },
                "nativeRetraction": native_retraction,
                "rendererHandoff": handoff_data,
            });
            if retraction.reason == "renderer_restart"
                && (session_id_after.is_empty()
                    || data["sessionIdBefore"] == data["sessionIdAfter"]
                    || data["processIdentitySha256Before"] == data["processIdentitySha256After"])
            {
                return Err(BridgeError::new(CODE));
            }
            append_event(
                &mut self.file,
                &self.identity,
                "retraction_observation",
                authority_bound(
                    data.as_object()
                        .expect("retraction observation object")
                        .clone(),
                    "runtime_observed",
                ),
            )?;
        }
        append_event(
            &mut self.file,
            &self.identity,
            "mutation_counter_observation",
            json!({
                "authorityLevel": "runtime_observed",
                "before": input.mutation_before,
                "after": input.mutation_after,
            }),
        )?;
        self.structured_evidence_published = true;
        Ok(())
    }

    pub fn publish_ui_evidence(&mut self, input: UiStoreEvidenceInput) -> Result<(), BridgeError> {
        if self.identity.phase != BridgePhase::UiLifecycle
            || self.identity.mode != BridgeMode::Live
            || self.structured_evidence_published
            || self.next_step != steps(&self.identity).len()
            || input.schema_version != "uagent.mvp15d.ui-store-evidence.v4"
            || input.status != "ready"
            || input.reason.is_some()
        {
            return Err(BridgeError::new("MVP15D_BRIDGE_UI_EVIDENCE_INVALID"));
        }
        append_event(
            &mut self.file,
            &self.identity,
            "capture_origin",
            json!({
                "authorityLevel": "runtime_observed",
                "origin": "rendered_product_ui",
                "fixtureUsed": false,
            }),
        )?;
        for step in UI_PATH.split(',') {
            append_event(
                &mut self.file,
                &self.identity,
                "rendered_step",
                json!({ "step": step }),
            )?;
        }
        publish_ui_authority_events(&mut self.file, &self.identity, &input)?;
        self.structured_evidence_published = true;
        Ok(())
    }

    pub fn complete(&mut self) -> Result<(), BridgeError> {
        if self.completed
            || !self.driver_claimed
            || self.next_step != steps(&self.identity).len()
            || self.identity.driver_file.exists()
            || (self.identity.mode == BridgeMode::Live && !self.structured_evidence_published)
        {
            return Err(BridgeError::new("MVP15D_BRIDGE_RENDERER_SEQUENCE_INVALID"));
        }
        append_event(
            &mut self.file,
            &self.identity,
            "capability_handshake",
            json!({
                "bridgeVersion": BRIDGE_VERSION,
                "mode": self.identity.mode.as_str(),
                "rendererStarted": true,
                "normalProductPathBound": self.identity.phase == BridgePhase::ProductCapture,
                "renderedDriverBound": self.identity.phase == BridgePhase::UiLifecycle,
                "mcpCalls": if self.identity.mode == BridgeMode::CapabilityOnly { json!(0) } else { Value::Null },
                "networkCalls": if self.identity.mode == BridgeMode::CapabilityOnly { json!(0) } else { Value::Null },
                "assetOperations": if self.identity.mode == BridgeMode::CapabilityOnly { json!(0) } else { Value::Null },
            }),
        )?;
        append_event(
            &mut self.file,
            &self.identity,
            "closeout",
            runtime_closeout_data(&self.identity),
        )?;
        self.file
            .sync_all()
            .map_err(|_| BridgeError::new("MVP15D_BRIDGE_EVENT_SYNC_FAILED"))?;
        self.completed = true;
        Ok(())
    }
}

pub fn disabled_configuration() -> RendererBridgeConfiguration {
    RendererBridgeConfiguration {
        enabled: false,
        bridge_version: BRIDGE_VERSION,
        phase: "disabled".to_string(),
        mode: "disabled".to_string(),
        task_id: String::new(),
        session: String::new(),
        generation: 0,
        endpoint: None,
        project_root: None,
        rendered_product_path: String::new(),
        driver_poll_milliseconds: 0,
        observation_timeout_milliseconds: 0,
        approval_ttl_wait_milliseconds: 0,
        receipt_ledger_enabled: false,
        renderer_handoff_pending: false,
        renderer_handoff_id: None,
        renderer_parent_lifecycle_status: None,
        renderer_parent_lifecycle_failure: None,
        renderer_handoff_predecessor_mcp_generation: None,
        renderer_handoff_predecessor_window_identity_sha256: None,
    }
}

pub type ManagedBridgeState = Mutex<Option<BridgeState>>;

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;
    use std::ops::Deref;

    static LEDGER_TEST_LOCK: Mutex<()> = Mutex::new(());

    struct TestRoot(PathBuf);

    impl Deref for TestRoot {
        type Target = Path;

        fn deref(&self) -> &Self::Target {
            &self.0
        }
    }

    impl Drop for TestRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn rendered_state(phase: BridgePhase) -> (TestRoot, BridgeState) {
        let unique = format!(
            "uagent-mvp15d-bridge-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        );
        let root = TestRoot(std::env::temp_dir().join(unique));
        let content = root.join("project").join("FinalHost").join("Content");
        fs::create_dir_all(&content).unwrap();
        fs::write(content.join("Stable.uasset"), b"stable-content").unwrap();
        let event_file = root.join("events.jsonl");
        let driver_file = root.join("driver.json");
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&event_file)
            .unwrap();
        let identity = BridgeIdentity {
            phase,
            mode: BridgeMode::Live,
            task_id: "TASK-MVP15D-UAGENT-RUNTIME-BRIDGE".to_string(),
            source_commit: COMPILED_SOURCE_COMMIT.to_string(),
            source_tree_sha256: COMPILED_SOURCE_TREE_SHA256.to_string(),
            source_dirty: compiled_source_dirty(),
            source_head_ref: COMPILED_SOURCE_HEAD_REF.to_string(),
            marker: "uagent-mvp15d-runtime-bridge-marker-test".to_string(),
            session: "uagent-runtime-bridge-session-test".to_string(),
            generation: 1,
            endpoint: "http://127.0.0.1:18765/mcp".to_string(),
            port: 18765,
            evidence_root: root.to_path_buf(),
            event_file,
            driver_file,
            rendered_product_path: phase.expected_path().to_string(),
            nonce_sha256: "a".repeat(64),
            executable_basename: "uagent.exe".to_string(),
            executable_sha256: "b".repeat(64),
            pid: std::process::id(),
        };
        (
            root,
            BridgeState {
                identity,
                file,
                next_step: 0,
                driver_claimed: true,
                structured_evidence_published: false,
                completed: false,
                last_native_transition_sequence: 0,
                renderer_handoff: None,
                renderer_publish_authority: true,
            },
        )
    }

    fn managed_child_command() -> std::process::Command {
        #[cfg(windows)]
        {
            let mut command = std::process::Command::new("powershell.exe");
            command.args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[Console]::In.ReadToEnd() | Out-Null",
            ]);
            command
        }
        #[cfg(not(windows))]
        {
            let mut command = std::process::Command::new("sh");
            command.args(["-c", "cat >/dev/null"]);
            command
        }
    }

    fn renderer_child() -> std::process::Child {
        use std::process::Stdio;
        #[cfg(windows)]
        let mut command = {
            let mut command = std::process::Command::new("powershell.exe");
            command.args([
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                "[Console]::In.ReadToEnd() | Out-Null",
                "--type=renderer",
            ]);
            command
        };
        #[cfg(not(windows))]
        let mut command = {
            let mut command = std::process::Command::new("sh");
            command.args(["-c", "cat >/dev/null", "--type=renderer"]);
            command
        };
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap()
    }

    fn close_child(mut child: std::process::Child) {
        drop(child.stdin.take());
        child.wait().unwrap();
    }

    #[test]
    fn mvp15d_native_app_harness_server() {
        use std::io::{BufRead, Write};

        if std::env::var("UAGENT_MVP15D_NATIVE_APP_HARNESS").as_deref() != Ok("1") {
            return;
        }

        const PREFIX: &str = "UAGENT_MVP15D_NATIVE_APP_HARNESS:";
        fn emit(prefix: &str, id: u64, result: Result<Value, String>) {
            let payload = match result {
                Ok(result) => json!({ "id": id, "ok": true, "result": result }),
                Err(error) => json!({ "id": id, "ok": false, "error": error }),
            };
            println!("{prefix}{}", serde_json::to_string(&payload).unwrap());
            std::io::stdout().flush().unwrap();
        }

        let (_root, mut state) = rendered_state(BridgePhase::ProductCapture);
        state.identity.task_id = "TASK-MVP15D-APP-WIRING".to_string();
        state.identity.session = "app-wiring-session-0001".to_string();
        state.identity.generation = 41;
        state.driver_claimed = false;
        fs::write(
            &state.identity.driver_file,
            serde_json::to_vec(&json!({
                "schemaVersion": DRIVER_SCHEMA,
                "taskId": state.identity.task_id.clone(),
                "phase": state.identity.phase.as_str(),
                "session": state.identity.session.clone(),
                "generation": state.identity.generation,
                "nonceSha256": state.identity.nonce_sha256.clone(),
                "command": "run-product-capture",
            }))
            .unwrap(),
        )
        .unwrap();
        activate_observation_receipt_ledger(&state.identity).unwrap();

        let predecessor_child = std::rc::Rc::new(std::cell::RefCell::new(Some(renderer_child())));
        let successor_child = std::rc::Rc::new(std::cell::RefCell::new(None));
        let lifecycle = std::rc::Rc::new(std::cell::RefCell::new(Vec::<String>::new()));
        std::thread::sleep(std::time::Duration::from_millis(100));
        println!("{PREFIX}{}", json!({ "ready": true }));
        std::io::stdout().flush().unwrap();

        for line in std::io::stdin().lock().lines() {
            let line = line.unwrap();
            let envelope: Value = match serde_json::from_str(&line) {
                Ok(value) => value,
                Err(_) => continue,
            };
            let id = envelope.get("id").and_then(Value::as_u64).unwrap_or(0);
            let command = envelope
                .get("command")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let input = envelope.get("input").cloned().unwrap_or_else(|| json!({}));
            let mut response_emitted = false;
            let result = match command {
                "mvp15d_bridge_configuration" => {
                    let mut configuration = state.renderer_configuration();
                    configuration.driver_poll_milliseconds = 1;
                    configuration.observation_timeout_milliseconds = 5_000;
                    serde_json::to_value(configuration)
                        .map_err(|_| "MVP15D_NATIVE_APP_HARNESS_SERIALIZATION_FAILED".to_string())
                }
                "mvp15d_bridge_take_driver_command" => state
                    .claim_driver_command()
                    .map_err(|error| error.code().to_string())
                    .and_then(|value| {
                        serde_json::to_value(value).map_err(|_| {
                            "MVP15D_NATIVE_APP_HARNESS_SERIALIZATION_FAILED".to_string()
                        })
                    }),
                "mvp15d_bridge_record_renderer_step" => {
                    serde_json::from_value::<RendererStepInput>(input)
                        .map_err(|_| "MVP15D_BRIDGE_RENDERER_SEQUENCE_INVALID".to_string())
                        .and_then(|input| {
                            state
                                .record_renderer_step(input)
                                .map_err(|error| error.code().to_string())
                        })
                        .and_then(|value| {
                            serde_json::to_value(value).map_err(|_| {
                                "MVP15D_NATIVE_APP_HARNESS_SERIALIZATION_FAILED".to_string()
                            })
                        })
                }
                "mvp15d_bridge_observe_native_state" => serde_json::from_value::<
                    ObserveNativeStateInput,
                >(input)
                .map_err(|_| "MVP15D_BRIDGE_NATIVE_STATE_INVALID".to_string())
                .and_then(|input| {
                    state
                        .observe_native_state(input)
                        .map_err(|error| error.code().to_string())
                })
                .and_then(|value| {
                    serde_json::to_value(value)
                        .map_err(|_| "MVP15D_NATIVE_APP_HARNESS_SERIALIZATION_FAILED".to_string())
                }),
                "mvp15d_bridge_request_renderer_restart" => serde_json::from_value::<
                    RendererRestartRequestInput,
                >(input)
                .map_err(|_| "MVP15D_RENDERER_HANDOFF_REQUEST_INVALID".to_string())
                .and_then(|input| {
                    state
                        .request_renderer_restart(input)
                        .map_err(|error| error.code().to_string())
                })
                .and_then(|requested| {
                    lifecycle
                        .borrow_mut()
                        .push("predecessor:request".to_string());
                    let response = serde_json::to_value(&requested).map_err(|_| {
                        "MVP15D_NATIVE_APP_HARNESS_SERIALIZATION_FAILED".to_string()
                    })?;
                    emit(PREFIX, id, Ok(response));
                    response_emitted = true;
                    lifecycle
                        .borrow_mut()
                        .push("predecessor:request:returned".to_string());
                    let predecessor_for_destroy = predecessor_child.clone();
                    let successor_for_build = successor_child.clone();
                    let destroy_lifecycle = lifecycle.clone();
                    let build_lifecycle = lifecycle.clone();
                    let predecessor_start_time = state
                        .renderer_handoff
                        .as_ref()
                        .and_then(|handoff| handoff.predecessor_renderer.get("process"))
                        .and_then(|process| process.get("startTime"))
                        .and_then(Value::as_u64)
                        .ok_or_else(|| {
                            "MVP15D_NATIVE_APP_HARNESS_RENDERER_IDENTITY_INVALID".to_string()
                        })?;
                    crate::coordinate_mvp15d_renderer_parent_lifecycle(
                        &mut state,
                        crate::parent_lifecycle_input(
                            &requested,
                            RENDERER_PREDECESSOR_WINDOW_LABEL,
                        ),
                        || Ok((RENDERER_PREDECESSOR_WINDOW_LABEL.to_string(), true)),
                        move || {
                            let child = predecessor_for_destroy
                                .borrow_mut()
                                .take()
                                .ok_or("predecessor_window_missing")?;
                            close_child(child);
                            destroy_lifecycle
                                .borrow_mut()
                                .push("parent:destroy:completed".to_string());
                            Ok(())
                        },
                        move || {
                            let deadline =
                                std::time::Instant::now() + std::time::Duration::from_secs(2);
                            while std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs()
                                <= predecessor_start_time
                            {
                                if std::time::Instant::now() >= deadline {
                                    return Err("successor_build_failed");
                                }
                                std::thread::yield_now();
                            }
                            *successor_for_build.borrow_mut() = Some(renderer_child());
                            build_lifecycle
                                .borrow_mut()
                                .push("parent:build:succeeded".to_string());
                            Ok(())
                        },
                    )?;
                    lifecycle
                        .borrow_mut()
                        .push("parent:acknowledged".to_string());
                    Ok(Value::Null)
                }),
                "mvp15d_bridge_claim_renderer_restart" => serde_json::from_value::<
                    RendererRestartClaimInput,
                >(input)
                .map_err(|_| "MVP15D_RENDERER_HANDOFF_CLAIM_INVALID".to_string())
                .and_then(|input| {
                    state
                        .claim_renderer_restart(input)
                        .map_err(|error| error.code().to_string())
                })
                .and_then(|value| {
                    lifecycle.borrow_mut().push("successor:claim".to_string());
                    serde_json::to_value(value)
                        .map_err(|_| "MVP15D_NATIVE_APP_HARNESS_SERIALIZATION_FAILED".to_string())
                }),
                "record_native_fixture_observation" => {
                    let api = input.get("api").and_then(Value::as_str).unwrap_or_default();
                    if !matches!(
                        api,
                        "attest_mvp15_companion" | "retract_mvp15_companion_approvals"
                    ) {
                        Err("MVP15D_NATIVE_APP_HARNESS_API_REJECTED".to_string())
                    } else {
                        let request = input.get("request").cloned().unwrap_or(Value::Null);
                        let response = input.get("response").cloned().unwrap_or(Value::Null);
                        issue_native_observation_receipt(api, request, response)
                            .map(Value::String)
                            .ok_or_else(|| "MVP15D_BRIDGE_RECEIPT_LEDGER_UNAVAILABLE".to_string())
                    }
                }
                "attach_mcp_transport_observation" => {
                    let request = input.get("request").cloned().unwrap_or(Value::Null);
                    let response = input.get("response").cloned().unwrap_or(Value::Null);
                    serde_json::from_value::<crate::mcp::McpHttpRequestInput>(request)
                        .map_err(|_| "MVP15D_MCP_OBSERVATION_REQUEST_INVALID".to_string())
                        .and_then(|request| {
                            serde_json::from_value::<crate::mcp::McpHttpRequestResult>(response)
                                .map_err(|_| "MVP15D_MCP_OBSERVATION_RESPONSE_INVALID".to_string())
                                .map(|response| (request, response))
                        })
                        .and_then(|(request, mut response)| {
                            attach_native_mcp_transport_observation(&request, &mut response)?;
                            serde_json::to_value(response).map_err(|_| {
                                "MVP15D_NATIVE_APP_HARNESS_SERIALIZATION_FAILED".to_string()
                            })
                        })
                }
                "record_mcp_transport_failure" => {
                    serde_json::from_value::<crate::mcp::McpHttpRequestInput>(input)
                        .map_err(|_| "MVP15D_MCP_OBSERVATION_REQUEST_INVALID".to_string())
                        .map(|request| {
                            record_native_mcp_transport_failure(&request, "native_request_failed");
                            Value::Null
                        })
                }
                "mvp15d_bridge_publish_product_evidence" => {
                    serde_json::from_value::<ProductStoreEvidenceInput>(input)
                        .map_err(|_| "MVP15D_BRIDGE_PRODUCT_EVIDENCE_INVALID".to_string())
                        .and_then(|input| {
                            state
                                .publish_product_evidence(input)
                                .map_err(|error| error.code().to_string())
                        })
                        .map(|()| {
                            lifecycle.borrow_mut().push("successor:publish".to_string());
                            Value::Null
                        })
                }
                "mvp15d_bridge_complete" => state
                    .complete()
                    .map_err(|error| error.code().to_string())
                    .map(|()| {
                        lifecycle
                            .borrow_mut()
                            .push("successor:complete".to_string());
                        Value::Null
                    }),
                "lifecycle" => Ok(json!(lifecycle.borrow().clone())),
                "shutdown" => {
                    if let Some(child) = predecessor_child.borrow_mut().take() {
                        close_child(child);
                    }
                    if let Some(child) = successor_child.borrow_mut().take() {
                        close_child(child);
                    }
                    emit(PREFIX, id, Ok(Value::Null));
                    break;
                }
                _ => Err("MVP15D_NATIVE_APP_HARNESS_COMMAND_REJECTED".to_string()),
            };
            if !response_emitted {
                emit(PREFIX, id, result);
            }
        }
    }

    #[test]
    fn renderer_handoff_observes_two_real_children_and_is_single_use() {
        let _ledger_guard = LEDGER_TEST_LOCK.lock().unwrap();
        let (_root, mut state) = rendered_state(BridgePhase::ProductCapture);
        activate_observation_receipt_ledger(&state.identity).unwrap();
        let predecessor_child = std::rc::Rc::new(std::cell::RefCell::new(Some(renderer_child())));
        let successor_child = std::rc::Rc::new(std::cell::RefCell::new(None));
        std::thread::sleep(std::time::Duration::from_millis(100));
        let predecessor = state
            .observe_native_state(ObserveNativeStateInput {
                schema_version: "uagent.mvp15d.native-state-observation.v1".to_string(),
                kind: "renderer_process".to_string(),
                request: json!({ "stage": "predecessor" }),
            })
            .unwrap();
        let request_input = RendererRestartRequestInput {
            schema_version: "uagent.mvp15d.renderer-restart-request.v2".to_string(),
            task_id: state.identity.task_id.clone(),
            phase: state.identity.phase.as_str().to_string(),
            renderer_before: RawObservedCallInput {
                receipt_id: predecessor.receipt_id.clone(),
                request: predecessor.request.clone(),
            },
            predecessor_mcp_session_id: "mcp-session-predecessor".to_string(),
            predecessor_mcp_generation: 10,
            segment: json!({
                "discoveries": [{}, {}],
                "retractions": [{}, {}, {}, {}, {}],
                "mutationBefore": {},
                "readyDiscovery": {},
            }),
        };
        let requested = state.request_renderer_restart(request_input).unwrap();
        state
            .bind_predecessor_window_instance(&requested.handoff_id, &"c".repeat(64))
            .unwrap();
        let observed_window = state
            .predecessor_window_identity(
                &requested.handoff_id,
                "observed",
                RENDERER_PREDECESSOR_WINDOW_LABEL,
            )
            .unwrap();
        let missing_window = json!({
            "schemaVersion": "uagent.mvp15d.renderer-parent-lifecycle-acknowledgement.v2",
            "handoffId": requested.handoff_id,
            "taskId": state.identity.task_id,
            "phase": state.identity.phase.as_str(),
            "destroyOutcome": { "status": "succeeded", "reason": null },
            "successorCreationOutcome": { "status": "succeeded", "reason": null }
        });
        assert!(
            serde_json::from_value::<RendererParentLifecycleAcknowledgementInput>(missing_window)
                .is_err()
        );
        let mut legacy_acknowledgement = RendererParentLifecycleAcknowledgementInput {
            schema_version: "uagent.mvp15d.renderer-parent-lifecycle-acknowledgement.v1"
                .to_string(),
            handoff_id: requested.handoff_id.clone(),
            task_id: state.identity.task_id.clone(),
            phase: state.identity.phase.as_str().to_string(),
            predecessor_window: observed_window.clone(),
            destroy_outcome: RendererParentLifecycleActionOutcome::succeeded(),
            successor_creation_outcome: RendererParentLifecycleActionOutcome::succeeded(),
        };
        assert_eq!(
            state
                .acknowledge_renderer_parent_lifecycle(legacy_acknowledgement.clone())
                .unwrap_err()
                .code(),
            "MVP15D_RENDERER_PARENT_LIFECYCLE_INVALID"
        );
        legacy_acknowledgement.schema_version =
            "uagent.mvp15d.renderer-parent-lifecycle-acknowledgement.v2".to_string();
        legacy_acknowledgement
            .predecessor_window
            .stable_identity_sha256 = "f".repeat(64);
        assert_eq!(
            state
                .acknowledge_renderer_parent_lifecycle(legacy_acknowledgement)
                .unwrap_err()
                .code(),
            "MVP15D_RENDERER_PARENT_LIFECYCLE_INVALID"
        );
        let wrong_observed_window = state
            .predecessor_window_identity(&requested.handoff_id, "observed", "secondary")
            .unwrap();
        assert_eq!(
            state
                .acknowledge_renderer_parent_lifecycle(
                    RendererParentLifecycleAcknowledgementInput {
                        schema_version:
                            "uagent.mvp15d.renderer-parent-lifecycle-acknowledgement.v2"
                                .to_string(),
                        handoff_id: requested.handoff_id.clone(),
                        task_id: state.identity.task_id.clone(),
                        phase: state.identity.phase.as_str().to_string(),
                        predecessor_window: wrong_observed_window,
                        destroy_outcome:
                            RendererParentLifecycleActionOutcome::succeeded(),
                        successor_creation_outcome:
                            RendererParentLifecycleActionOutcome::succeeded(),
                    },
                )
                .unwrap_err()
                .code(),
            "MVP15D_RENDERER_PARENT_LIFECYCLE_INVALID"
        );
        let predecessor_for_destroy = predecessor_child.clone();
        let successor_for_build = successor_child.clone();
        let acknowledgement = crate::coordinate_mvp15d_renderer_parent_lifecycle(
            &mut state,
            crate::parent_lifecycle_input(&requested, RENDERER_PREDECESSOR_WINDOW_LABEL),
            || Ok((RENDERER_PREDECESSOR_WINDOW_LABEL.to_string(), true)),
            move || {
                let child = predecessor_for_destroy
                    .borrow_mut()
                    .take()
                    .ok_or("predecessor_window_missing")?;
                close_child(child);
                Ok(())
            },
            move || {
                // sysinfo exposes process start time at one-second resolution on Windows.
                std::thread::sleep(std::time::Duration::from_millis(1_100));
                *successor_for_build.borrow_mut() = Some(renderer_child());
                Ok(())
            },
        )
        .unwrap();
        assert_eq!(acknowledgement.status, "acknowledged");
        assert!(acknowledgement.receipt_sequence > 0);
        assert_eq!(
            acknowledgement.predecessor_renderer["process"]["pid"],
            predecessor.observation["process"]["pid"]
        );
        assert_eq!(acknowledgement.predecessor_window.status, "observed");
        assert_eq!(
            acknowledgement.predecessor_window.window_label,
            RENDERER_PREDECESSOR_WINDOW_LABEL
        );
        let predecessor_window_identity_sha256 = acknowledgement
            .predecessor_window
            .stable_identity_sha256
            .clone();
        let same_process = state.claim_renderer_restart(RendererRestartClaimInput {
            schema_version: "uagent.mvp15d.renderer-restart-claim.v3".to_string(),
            handoff_id: requested.handoff_id.clone(),
            task_id: state.identity.task_id.clone(),
            phase: state.identity.phase.as_str().to_string(),
            predecessor_window_identity_sha256: predecessor_window_identity_sha256.clone(),
            renderer_after: RawObservedCallInput {
                receipt_id: predecessor.receipt_id,
                request: predecessor.request,
            },
            successor_mcp_session_id: "mcp-session-successor".to_string(),
            successor_mcp_generation: 11,
        });
        assert_eq!(
            same_process.unwrap_err().code(),
            "MVP15D_RENDERER_HANDOFF_CLAIM_INVALID"
        );
        std::thread::sleep(std::time::Duration::from_millis(100));
        let successor = state
            .observe_native_state(ObserveNativeStateInput {
                schema_version: "uagent.mvp15d.native-state-observation.v1".to_string(),
                kind: "renderer_process".to_string(),
                request: json!({ "stage": "successor" }),
            })
            .unwrap();
        let fake_successor = state.claim_renderer_restart(RendererRestartClaimInput {
            schema_version: "uagent.mvp15d.renderer-restart-claim.v3".to_string(),
            handoff_id: requested.handoff_id.clone(),
            task_id: state.identity.task_id.clone(),
            phase: state.identity.phase.as_str().to_string(),
            predecessor_window_identity_sha256: predecessor_window_identity_sha256.clone(),
            renderer_after: RawObservedCallInput {
                receipt_id: format!("mvp15d-observation-receipt:{}", "f".repeat(64)),
                request: successor.request.clone(),
            },
            successor_mcp_session_id: "mcp-session-successor".to_string(),
            successor_mcp_generation: 11,
        });
        assert_eq!(
            fake_successor.unwrap_err().code(),
            "MVP15D_RENDERER_HANDOFF_CLAIM_INVALID"
        );
        let cross_context = state.claim_renderer_restart(RendererRestartClaimInput {
            schema_version: "uagent.mvp15d.renderer-restart-claim.v3".to_string(),
            handoff_id: requested.handoff_id.clone(),
            task_id: "TASK-CROSS-CONTEXT".to_string(),
            phase: state.identity.phase.as_str().to_string(),
            predecessor_window_identity_sha256: predecessor_window_identity_sha256.clone(),
            renderer_after: RawObservedCallInput {
                receipt_id: successor.receipt_id.clone(),
                request: successor.request.clone(),
            },
            successor_mcp_session_id: "mcp-session-successor".to_string(),
            successor_mcp_generation: 11,
        });
        assert_eq!(
            cross_context.unwrap_err().code(),
            "MVP15D_RENDERER_HANDOFF_CLAIM_INVALID"
        );
        let legacy_claim = state.claim_renderer_restart(RendererRestartClaimInput {
            schema_version: "uagent.mvp15d.renderer-restart-claim.v2".to_string(),
            handoff_id: requested.handoff_id.clone(),
            task_id: state.identity.task_id.clone(),
            phase: state.identity.phase.as_str().to_string(),
            predecessor_window_identity_sha256: predecessor_window_identity_sha256.clone(),
            renderer_after: RawObservedCallInput {
                receipt_id: successor.receipt_id.clone(),
                request: successor.request.clone(),
            },
            successor_mcp_session_id: "mcp-session-successor".to_string(),
            successor_mcp_generation: 11,
        });
        assert_eq!(
            legacy_claim.unwrap_err().code(),
            "MVP15D_RENDERER_HANDOFF_CLAIM_INVALID"
        );
        let wrong_window = state.claim_renderer_restart(RendererRestartClaimInput {
            schema_version: "uagent.mvp15d.renderer-restart-claim.v3".to_string(),
            handoff_id: requested.handoff_id.clone(),
            task_id: state.identity.task_id.clone(),
            phase: state.identity.phase.as_str().to_string(),
            predecessor_window_identity_sha256: "f".repeat(64),
            renderer_after: RawObservedCallInput {
                receipt_id: successor.receipt_id.clone(),
                request: successor.request.clone(),
            },
            successor_mcp_session_id: "mcp-session-successor".to_string(),
            successor_mcp_generation: 11,
        });
        assert_eq!(
            wrong_window.unwrap_err().code(),
            "MVP15D_RENDERER_HANDOFF_CLAIM_INVALID"
        );
        let claimed = state
            .claim_renderer_restart(RendererRestartClaimInput {
                schema_version: "uagent.mvp15d.renderer-restart-claim.v3".to_string(),
                handoff_id: requested.handoff_id.clone(),
                task_id: state.identity.task_id.clone(),
                phase: state.identity.phase.as_str().to_string(),
                predecessor_window_identity_sha256: predecessor_window_identity_sha256.clone(),
                renderer_after: RawObservedCallInput {
                    receipt_id: successor.receipt_id,
                    request: successor.request,
                },
                successor_mcp_session_id: "mcp-session-successor".to_string(),
                successor_mcp_generation: 11,
            })
            .unwrap();
        assert_ne!(
            claimed.predecessor_renderer["process"]["pid"],
            claimed.successor_renderer["process"]["pid"]
        );
        assert_ne!(
            claimed.predecessor_renderer["process"]["startTime"],
            claimed.successor_renderer["process"]["startTime"]
        );
        let replay = state.claim_renderer_restart(RendererRestartClaimInput {
            schema_version: "uagent.mvp15d.renderer-restart-claim.v3".to_string(),
            handoff_id: requested.handoff_id,
            task_id: state.identity.task_id.clone(),
            phase: state.identity.phase.as_str().to_string(),
            predecessor_window_identity_sha256,
            renderer_after: RawObservedCallInput {
                receipt_id: "mvp15d-observation-receipt:replay".to_string(),
                request: json!({}),
            },
            successor_mcp_session_id: "mcp-session-third".to_string(),
            successor_mcp_generation: 12,
        });
        assert_eq!(
            replay.unwrap_err().code(),
            "MVP15D_RENDERER_HANDOFF_CLAIM_INVALID"
        );
        close_child(successor_child.borrow_mut().take().unwrap());
        drop(state);
    }

    #[test]
    fn renderer_parent_lifecycle_failures_and_missing_acknowledgement_fail_closed() {
        let _ledger_guard = LEDGER_TEST_LOCK.lock().unwrap();
        for failure in [
            "missing_acknowledgement",
            "window_missing",
            "window_mismatch",
            "destroy_failure",
            "build_failure",
            "cross_context",
        ] {
            let (_root, mut state) = rendered_state(BridgePhase::ProductCapture);
            activate_observation_receipt_ledger(&state.identity).unwrap();
            let predecessor_child = renderer_child();
            std::thread::sleep(std::time::Duration::from_millis(100));
            let predecessor = state
                .observe_native_state(ObserveNativeStateInput {
                    schema_version: "uagent.mvp15d.native-state-observation.v1".to_string(),
                    kind: "renderer_process".to_string(),
                    request: json!({ "stage": failure }),
                })
                .unwrap();
            let requested = state
                .request_renderer_restart(RendererRestartRequestInput {
                    schema_version: "uagent.mvp15d.renderer-restart-request.v2".to_string(),
                    task_id: state.identity.task_id.clone(),
                    phase: state.identity.phase.as_str().to_string(),
                    renderer_before: RawObservedCallInput {
                        receipt_id: predecessor.receipt_id.clone(),
                        request: predecessor.request.clone(),
                    },
                    predecessor_mcp_session_id: "mcp-session-predecessor".to_string(),
                    predecessor_mcp_generation: 20,
                    segment: json!({
                        "discoveries": [{}, {}],
                        "retractions": [{}, {}, {}, {}, {}],
                        "mutationBefore": {},
                        "readyDiscovery": {},
                    }),
                })
                .unwrap();
            match failure {
                "missing_acknowledgement" => {}
                "window_missing" => {
                    let acknowledgement = crate::coordinate_mvp15d_renderer_parent_lifecycle(
                        &mut state,
                        crate::parent_lifecycle_input(
                            &requested,
                            RENDERER_PREDECESSOR_WINDOW_LABEL,
                        ),
                        || Err("predecessor_window_missing"),
                        || Ok(()),
                        || Ok(()),
                    )
                    .unwrap();
                    assert_eq!(acknowledgement.status, "failed");
                    assert_eq!(acknowledgement.predecessor_window.status, "missing");
                    assert_eq!(
                        acknowledgement.failure_reason.as_deref(),
                        Some("predecessor_window_missing")
                    );
                }
                "window_mismatch" => {
                    let acknowledgement = crate::coordinate_mvp15d_renderer_parent_lifecycle(
                        &mut state,
                        crate::parent_lifecycle_input(
                            &requested,
                            RENDERER_PREDECESSOR_WINDOW_LABEL,
                        ),
                        || Ok(("secondary".to_string(), true)),
                        || Ok(()),
                        || Ok(()),
                    )
                    .unwrap();
                    assert_eq!(acknowledgement.status, "failed");
                    assert_eq!(acknowledgement.predecessor_window.status, "mismatch");
                    assert_eq!(
                        acknowledgement.failure_reason.as_deref(),
                        Some("predecessor_window_identity_mismatch")
                    );
                }
                "destroy_failure" => {
                    let build_called = std::cell::Cell::new(false);
                    let acknowledgement = crate::coordinate_mvp15d_renderer_parent_lifecycle(
                        &mut state,
                        crate::parent_lifecycle_input(
                            &requested,
                            RENDERER_PREDECESSOR_WINDOW_LABEL,
                        ),
                        || Ok((RENDERER_PREDECESSOR_WINDOW_LABEL.to_string(), true)),
                        || Err("predecessor_destroy_failed"),
                        || {
                            build_called.set(true);
                            Ok(())
                        },
                    )
                    .unwrap();
                    assert_eq!(acknowledgement.status, "failed");
                    assert_eq!(
                        acknowledgement.failure_reason.as_deref(),
                        Some("predecessor_destroy_failed")
                    );
                    assert!(!build_called.get());
                }
                "build_failure" => {
                    let acknowledgement = crate::coordinate_mvp15d_renderer_parent_lifecycle(
                        &mut state,
                        crate::parent_lifecycle_input(
                            &requested,
                            RENDERER_PREDECESSOR_WINDOW_LABEL,
                        ),
                        || Ok((RENDERER_PREDECESSOR_WINDOW_LABEL.to_string(), true)),
                        || Ok(()),
                        || Err("successor_build_failed"),
                    )
                    .unwrap();
                    assert_eq!(acknowledgement.status, "failed");
                    assert_eq!(
                        acknowledgement.failure_reason.as_deref(),
                        Some("successor_build_failed")
                    );
                }
                "cross_context" => {
                    let mut input = crate::parent_lifecycle_input(
                        &requested,
                        RENDERER_PREDECESSOR_WINDOW_LABEL,
                    );
                    input.task_id = "TASK-CROSS-CONTEXT".to_string();
                    assert_eq!(
                        crate::coordinate_mvp15d_renderer_parent_lifecycle(
                            &mut state,
                            input,
                            || Ok((RENDERER_PREDECESSOR_WINDOW_LABEL.to_string(), true)),
                            || Ok(()),
                            || Ok(()),
                        )
                        .unwrap_err(),
                        "MVP15D_RENDERER_PARENT_LIFECYCLE_INVALID"
                    );
                }
                _ => unreachable!(),
            }
            assert_eq!(
                state
                    .claim_renderer_restart(RendererRestartClaimInput {
                        schema_version: "uagent.mvp15d.renderer-restart-claim.v3".to_string(),
                        handoff_id: requested.handoff_id.clone(),
                        task_id: state.identity.task_id.clone(),
                        phase: state.identity.phase.as_str().to_string(),
                        predecessor_window_identity_sha256: "0".repeat(64),
                        renderer_after: RawObservedCallInput {
                            receipt_id: predecessor.receipt_id.clone(),
                            request: predecessor.request.clone(),
                        },
                        successor_mcp_session_id: "mcp-session-successor".to_string(),
                        successor_mcp_generation: 21,
                    })
                    .unwrap_err()
                    .code(),
                "MVP15D_RENDERER_HANDOFF_CLAIM_INVALID"
            );
            assert!(!state.renderer_publish_authority);
            assert_eq!(
                state
                    .publish_product_evidence(ProductStoreEvidenceInput {
                        schema_version: "uagent.mvp15d.product-store-evidence.v4".to_string(),
                        status: "ready".to_string(),
                        reason: None,
                        discoveries: Vec::new(),
                        retractions: Vec::new(),
                        mutation_before: ProductMutationCalls {
                            dry_run: 0,
                            execute: 0,
                            rollback: 0,
                        },
                        mutation_after: ProductMutationCalls {
                            dry_run: 0,
                            execute: 0,
                            rollback: 0,
                        },
                    })
                    .unwrap_err()
                    .code(),
                "MVP15D_BRIDGE_PRODUCT_EVIDENCE_INVALID"
            );
            assert!(state.complete().is_err());
            let configuration = state.renderer_configuration();
            assert!(!configuration.renderer_handoff_pending);
            assert_eq!(
                configuration.renderer_handoff_id.as_deref(),
                Some(requested.handoff_id.as_str())
            );
            close_child(predecessor_child);
        }
    }

    #[test]
    fn same_label_replacement_preserves_replacement_and_fails_closed() {
        let _ledger_guard = LEDGER_TEST_LOCK.lock().unwrap();
        let first_binding = crate::new_predecessor_window_instance_binding().unwrap();
        let second_binding = crate::new_predecessor_window_instance_binding().unwrap();
        assert!(is_sha256(&first_binding));
        assert!(is_sha256(&second_binding));
        assert_ne!(first_binding, second_binding);
        let (_root, mut state) = rendered_state(BridgePhase::ProductCapture);
        activate_observation_receipt_ledger(&state.identity).unwrap();
        let predecessor_child = renderer_child();
        std::thread::sleep(std::time::Duration::from_millis(100));
        let predecessor = state
            .observe_native_state(ObserveNativeStateInput {
                schema_version: "uagent.mvp15d.native-state-observation.v1".to_string(),
                kind: "renderer_process".to_string(),
                request: json!({ "stage": "same-label-replacement" }),
            })
            .unwrap();
        let requested = state
            .request_renderer_restart(RendererRestartRequestInput {
                schema_version: "uagent.mvp15d.renderer-restart-request.v2".to_string(),
                task_id: state.identity.task_id.clone(),
                phase: state.identity.phase.as_str().to_string(),
                renderer_before: RawObservedCallInput {
                    receipt_id: predecessor.receipt_id.clone(),
                    request: predecessor.request.clone(),
                },
                predecessor_mcp_session_id: "mcp-session-predecessor".to_string(),
                predecessor_mcp_generation: 30,
                segment: json!({
                    "discoveries": [{}, {}],
                    "retractions": [{}, {}, {}, {}, {}],
                    "mutationBefore": {},
                    "readyDiscovery": {},
                }),
            })
            .unwrap();

        let manager_window_instance = std::cell::Cell::new(Some(2_u64));
        let captured_destroy_called = std::cell::Cell::new(false);
        let successor_build_called = std::cell::Cell::new(false);
        let acknowledgement = crate::coordinate_mvp15d_renderer_parent_lifecycle(
            &mut state,
            crate::parent_lifecycle_input_with_binding(
                &requested,
                RENDERER_PREDECESSOR_WINDOW_LABEL,
                first_binding,
            ),
            || {
                Ok((
                    RENDERER_PREDECESSOR_WINDOW_LABEL.to_string(),
                    manager_window_instance.get() == Some(1),
                ))
            },
            || {
                captured_destroy_called.set(true);
                Ok(())
            },
            || {
                successor_build_called.set(true);
                Ok(())
            },
        )
        .unwrap();

        assert_eq!(acknowledgement.status, "failed");
        assert_eq!(acknowledgement.predecessor_window.status, "mismatch");
        assert_eq!(
            acknowledgement.failure_reason.as_deref(),
            Some("predecessor_window_identity_mismatch")
        );
        assert!(!captured_destroy_called.get());
        assert!(!successor_build_called.get());
        assert_eq!(manager_window_instance.get(), Some(2));
        assert_eq!(
            state
                .bind_predecessor_window_instance(&requested.handoff_id, &second_binding)
                .unwrap_err()
                .code(),
            "MVP15D_RENDERER_PARENT_LIFECYCLE_INVALID"
        );
        assert_eq!(
            state
                .claim_renderer_restart(RendererRestartClaimInput {
                    schema_version: "uagent.mvp15d.renderer-restart-claim.v3".to_string(),
                    handoff_id: requested.handoff_id,
                    task_id: state.identity.task_id.clone(),
                    phase: state.identity.phase.as_str().to_string(),
                    predecessor_window_identity_sha256: acknowledgement
                        .predecessor_window
                        .stable_identity_sha256,
                    renderer_after: RawObservedCallInput {
                        receipt_id: predecessor.receipt_id,
                        request: predecessor.request,
                    },
                    successor_mcp_session_id: "mcp-session-successor".to_string(),
                    successor_mcp_generation: 31,
                })
                .unwrap_err()
                .code(),
            "MVP15D_RENDERER_HANDOFF_CLAIM_INVALID"
        );
        assert_eq!(
            state
                .publish_product_evidence(ProductStoreEvidenceInput {
                    schema_version: "uagent.mvp15d.product-store-evidence.v4".to_string(),
                    status: "ready".to_string(),
                    reason: None,
                    discoveries: Vec::new(),
                    retractions: Vec::new(),
                    mutation_before: ProductMutationCalls {
                        dry_run: 0,
                        execute: 0,
                        rollback: 0,
                    },
                    mutation_after: ProductMutationCalls {
                        dry_run: 0,
                        execute: 0,
                        rollback: 0,
                    },
                })
                .unwrap_err()
                .code(),
            "MVP15D_BRIDGE_PRODUCT_EVIDENCE_INVALID"
        );
        assert!(!state.renderer_publish_authority);
        assert!(state.complete().is_err());
        close_child(predecessor_child);
    }

    #[test]
    fn task_owned_managed_process_uses_a_real_child_and_external_termination_fails_closed() {
        let _ledger_guard = LEDGER_TEST_LOCK.lock().unwrap();
        let _registry_guard = crate::reset_shared_registries_for_test();
        let (root, state) = rendered_state(BridgePhase::UiLifecycle);
        activate_observation_receipt_ledger(&state.identity).unwrap();
        let project_root = root.join("project").join("FinalHost");
        fs::write(project_root.join("FinalHost.uproject"), b"{}").unwrap();
        crate::trust_native_project_root(crate::TrustRootInput {
            root_ref: project_root.to_string_lossy().to_string(),
        })
        .unwrap();
        let create_input = crate::ue_editor_process::ManagedEditorProcessCreateInput {
            task_id: state.identity.task_id.clone(),
            phase: state.identity.phase.as_str().to_string(),
            project_id: "project:mvp15d-managed".to_string(),
            root_ref: project_root.to_string_lossy().to_string(),
            uproject_relative_path: "FinalHost.uproject".to_string(),
        };
        let created = crate::ue_editor_process::create_managed_editor_process_fixture(
            create_input.clone(),
            managed_child_command(),
        )
        .unwrap();
        let process = created.process.unwrap();
        assert_eq!(process.source, "managed");
        assert_eq!(
            crate::ue_editor_process::managed_process_count_for_test(),
            1
        );
        let attached = crate::ue_editor_process::attach_editor_process(
            crate::ue_editor_process::EditorAttachInput {
                project_id: create_input.project_id.clone(),
                root_ref: create_input.root_ref.clone(),
                uproject_relative_path: create_input.uproject_relative_path.clone(),
                process_id: process.id.clone(),
                pid_hash: process.pid_hash.clone(),
                process_display_name: process.display_name.clone(),
                mode: "managed".to_string(),
            },
        )
        .unwrap();
        let session_id = attached.session_id.unwrap();
        let root_id = attached.root_id.unwrap();
        let managed_validation = crate::ue_editor_process::validate_asset_mutation_observation(
            &session_id,
            &create_input.project_id,
            &root_id,
        );
        assert!(
            managed_validation.is_ok(),
            "managed observation failed: {managed_validation:?}"
        );
        let terminated = crate::ue_editor_process::terminate_managed_editor_process(
            crate::ue_editor_process::EditorObservationSessionIdInput {
                session_id: session_id.clone(),
            },
        )
        .unwrap();
        assert_eq!(
            (terminated.status.as_str(), terminated.reason.as_str()),
            ("degraded", "process_exited")
        );
        assert_eq!(
            crate::ue_editor_process::managed_process_count_for_test(),
            0
        );
        assert_eq!(
            crate::ue_editor_process::validate_asset_mutation_observation(
                &session_id,
                &create_input.project_id,
                &root_id,
            )
            .unwrap_err(),
            "process_exited"
        );

        let releasable = crate::ue_editor_process::create_managed_editor_process_fixture(
            create_input.clone(),
            managed_child_command(),
        )
        .unwrap();
        let releasable_process = releasable.process.clone().unwrap();
        let release_input = crate::ue_editor_process::ManagedEditorProcessReleaseInput {
            schema_version: "uagent.mvp15d.managed-editor-process-release.v1".to_string(),
            task_id: create_input.task_id.clone(),
            phase: create_input.phase.clone(),
            process_id: releasable_process.id.clone(),
            pid: releasable.process_pid.unwrap(),
            process_start_time: releasable.process_start_time.unwrap(),
        };
        let mut mismatched = release_input.clone();
        mismatched.process_start_time += 1;
        assert_eq!(
            crate::ue_editor_process::release_managed_editor_process(mismatched)
                .unwrap()
                .reason,
            "managed_process_identity_mismatch"
        );
        let mut cross_task = release_input.clone();
        cross_task.task_id = "TASK-CROSS-CONTEXT".to_string();
        assert_eq!(
            crate::ue_editor_process::release_managed_editor_process(cross_task)
                .unwrap()
                .reason,
            "managed_process_owner_mismatch"
        );
        assert_eq!(
            crate::ue_editor_process::managed_process_registry_counts_for_test(),
            (1, 1, 0)
        );
        let released =
            crate::ue_editor_process::release_managed_editor_process(release_input.clone())
                .unwrap();
        assert_eq!(
            (released.status.as_str(), released.reason.as_str()),
            ("released", "task_owned_process_released")
        );
        assert_eq!(
            crate::ue_editor_process::managed_process_registry_counts_for_test(),
            (0, 0, 0)
        );
        assert_eq!(
            crate::ue_editor_process::release_managed_editor_process(release_input)
                .unwrap()
                .reason,
            "managed_process_release_replay"
        );
        let unknown = crate::ue_editor_process::ManagedEditorProcessReleaseInput {
            schema_version: "uagent.mvp15d.managed-editor-process-release.v1".to_string(),
            task_id: create_input.task_id.clone(),
            phase: create_input.phase.clone(),
            process_id: "process:managed:unknown".to_string(),
            pid: 1,
            process_start_time: 1,
        };
        assert_eq!(
            crate::ue_editor_process::release_managed_editor_process(unknown)
                .unwrap()
                .reason,
            "managed_process_unknown"
        );

        let external_created = crate::ue_editor_process::create_managed_editor_process_fixture(
            create_input.clone(),
            managed_child_command(),
        )
        .unwrap();
        let external = external_created.process.clone().unwrap();
        let external_session = crate::ue_editor_process::attach_editor_process(
            crate::ue_editor_process::EditorAttachInput {
                project_id: create_input.project_id,
                root_ref: create_input.root_ref,
                uproject_relative_path: create_input.uproject_relative_path,
                process_id: external.id.clone(),
                pid_hash: external.pid_hash,
                process_display_name: external.display_name,
                mode: "attached".to_string(),
            },
        )
        .unwrap()
        .session_id
        .unwrap();
        crate::ue_editor_process::mark_managed_process_external_for_test(&external.id);
        let external_release = crate::ue_editor_process::release_managed_editor_process(
            crate::ue_editor_process::ManagedEditorProcessReleaseInput {
                schema_version: "uagent.mvp15d.managed-editor-process-release.v1".to_string(),
                task_id: create_input.task_id.clone(),
                phase: create_input.phase.clone(),
                process_id: external.id.clone(),
                pid: external_created.process_pid.unwrap(),
                process_start_time: external_created.process_start_time.unwrap(),
            },
        )
        .unwrap();
        assert_eq!(
            (
                external_release.status.as_str(),
                external_release.reason.as_str()
            ),
            ("blocked", "process_not_managed")
        );
        let blocked = crate::ue_editor_process::terminate_managed_editor_process(
            crate::ue_editor_process::EditorObservationSessionIdInput {
                session_id: external_session,
            },
        )
        .unwrap();
        assert_eq!(
            (blocked.status.as_str(), blocked.reason.as_str()),
            ("blocked", "process_not_managed")
        );
        assert_eq!(
            crate::ue_editor_process::managed_process_count_for_test(),
            1
        );
        crate::ue_editor_process::reset_registries_for_test();
        assert_eq!(
            crate::ue_editor_process::managed_process_count_for_test(),
            0
        );
    }

    fn arguments() -> Vec<OsString> {
        [
            SUBCOMMAND,
            "--phase",
            "capability-probe",
            "--mode",
            "capability-only",
            "--task-generation",
            TASK_GENERATION,
            "--task-id",
            "TASK-MVP15D-UAGENT-RUNTIME-BRIDGE",
            "--source-commit",
            COMPILED_SOURCE_COMMIT,
            "--repository",
            "C:\\repo",
            "--evidence-root",
            "C:\\repo\\external\\mvp15d-final-d13-d16-20260731_120000",
            "--marker",
            "uagent-mvp15d-runtime-bridge-marker-0001",
            "--session",
            "uagent-runtime-bridge-session-0001",
            "--generation",
            "1",
            "--endpoint",
            "http://127.0.0.1:18765/mcp",
            "--port",
            "18765",
            "--nonce-file",
            "C:\\repo\\external\\mvp15d-final-d13-d16-20260731_120000\\metadata\\nonce.txt",
            "--event-file",
            "C:\\repo\\external\\mvp15d-final-d13-d16-20260731_120000\\transcripts\\events.jsonl",
            "--driver-file",
            "C:\\repo\\external\\mvp15d-final-d13-d16-20260731_120000\\metadata\\driver.json",
            "--rendered-product-path",
            CAPABILITY_PATH,
        ]
        .into_iter()
        .map(OsString::from)
        .collect()
    }

    #[test]
    fn ordinary_arguments_do_not_activate_the_bridge() {
        assert!(parse_arguments(Vec::new()).unwrap().is_none());
        assert!(parse_arguments(vec![OsString::from("--help")])
            .unwrap()
            .is_none());
    }

    #[test]
    fn renderer_steps_alone_cannot_complete_live_evidence() {
        let (_root, mut state) = rendered_state(BridgePhase::ProductCapture);
        state.next_step = steps(&state.identity).len();
        assert_eq!(
            state.complete().unwrap_err().code(),
            "MVP15D_BRIDGE_RENDERER_SEQUENCE_INVALID"
        );
        drop(state);
    }

    #[test]
    fn native_receipts_are_context_bound_single_use_and_unknown_receipts_fail_closed() {
        let _ledger_guard = LEDGER_TEST_LOCK.lock().unwrap();
        let (_root, state) = rendered_state(BridgePhase::UiLifecycle);
        activate_observation_receipt_ledger(&state.identity).unwrap();
        let request = json!({ "registrationId": "registration-actual-0001", "operationIndex": 1 });
        let receipt_id = issue_native_observation_receipt(
            "execute_asset_mutation",
            request.clone(),
            json!({
                "status": "blocked",
                "reason": "stale_generation",
                "evidenceId": "native-evidence-actual-0001",
            }),
        )
        .unwrap();
        let raw = RawObservedCallInput {
            receipt_id: receipt_id.clone(),
            request,
        };
        let receipt = call_receipt(
            &state.identity,
            &raw,
            "execute_asset_mutation",
            "blocked",
            "MVP15D_BRIDGE_UI_EVIDENCE_INVALID",
        )
        .unwrap();
        assert_eq!(receipt["reason"], "stale_generation");
        assert_eq!(
            receipt["requestSha256"],
            sha256_bytes(canonical_json(&raw.request).as_bytes())
        );
        assert_eq!(
            call_receipt(
                &state.identity,
                &raw,
                "execute_asset_mutation",
                "blocked",
                "MVP15D_BRIDGE_UI_EVIDENCE_INVALID",
            )
            .unwrap_err()
            .code(),
            "MVP15D_BRIDGE_UI_EVIDENCE_INVALID"
        );

        let second_receipt_id = issue_native_observation_receipt(
            "execute_asset_mutation",
            raw.request.clone(),
            json!({
                "status": "blocked",
                "reason": "stale_generation",
                "evidenceId": "native-evidence-actual-0002",
            }),
        )
        .unwrap();
        let second_raw = RawObservedCallInput {
            receipt_id: second_receipt_id,
            request: raw.request.clone(),
        };
        let mut wrong_context = state.identity.clone();
        wrong_context.generation += 1;
        assert_eq!(
            call_receipt(
                &wrong_context,
                &second_raw,
                "execute_asset_mutation",
                "blocked",
                "MVP15D_BRIDGE_UI_EVIDENCE_INVALID",
            )
            .unwrap_err()
            .code(),
            "MVP15D_BRIDGE_UI_EVIDENCE_INVALID"
        );
        let unknown = RawObservedCallInput {
            receipt_id: "mvp15d-observation-receipt:unknown".to_string(),
            request: raw.request.clone(),
        };
        assert_eq!(
            call_receipt(
                &state.identity,
                &unknown,
                "execute_asset_mutation",
                "blocked",
                "MVP15D_BRIDGE_UI_EVIDENCE_INVALID",
            )
            .unwrap_err()
            .code(),
            "MVP15D_BRIDGE_UI_EVIDENCE_INVALID"
        );

        let closeout = runtime_closeout_data(&state.identity);
        assert_eq!(closeout["authorityLevel"], "runtime_observed");
        assert!(closeout.get("processResidualCount").is_none());
        assert!(closeout.get("portResidualCount").is_none());
        drop(state);
    }

    #[test]
    fn native_mcp_boundary_owns_response_facts_and_rejects_renderer_substitution() {
        let _ledger_guard = LEDGER_TEST_LOCK.lock().unwrap();
        let (_root, state) = rendered_state(BridgePhase::ProductCapture);
        activate_observation_receipt_ledger(&state.identity).unwrap();
        let mut result = crate::mcp::McpHttpRequestResult {
            method: crate::mcp::McpHttpMethod::Post,
            status: 200,
            body: json!({
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "protocolVersion": "2025-06-18",
                    "serverInfo": { "name": "native-loopback", "version": "1" },
                    "capabilities": { "tools": {} }
                }
            })
            .to_string(),
            content_type: Some("application/json".to_string()),
            session_id: Some("native-session-actual-0001".to_string()),
            protocol_version: Some("2025-06-18".to_string()),
            observation_request: None,
            observation_receipts: None,
        };
        let input = crate::mcp::McpHttpRequestInput {
            endpoint: state.identity.endpoint.clone(),
            method: crate::mcp::McpHttpMethod::Post,
            body: json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {} })
                .to_string(),
            protocol_version: Some("2025-06-18".to_string()),
            session_id: None,
            timeout_ms: Some(5_000),
            observation: Some(crate::mcp::McpObservationIntent {
                schema_version: MCP_OBSERVATION_INTENT_SCHEMA.to_string(),
                task_id: state.identity.task_id.clone(),
                phase: state.identity.phase.as_str().to_string(),
                phase_session_id: state.identity.session.clone(),
                phase_generation: state.identity.generation,
                connection_generation: 17,
                tool_search_mode: "off".to_string(),
            }),
        };
        attach_native_mcp_transport_observation(&input, &mut result).unwrap();
        let request = result.observation_request.clone().unwrap();
        let receipts = result.observation_receipts.clone().unwrap();
        assert_eq!(
            receipts.keys().cloned().collect::<BTreeSet<_>>(),
            [
                "mcp_configure_tool_search".to_string(),
                "mcp_connect".to_string(),
                "mcp_initialize".to_string(),
            ]
            .into_iter()
            .collect()
        );
        result.status = 201;
        result.body = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": { "protocolVersion": "renderer-authored" }
        })
        .to_string();
        let connect = consume_observation_receipt(
            &state.identity,
            receipts.get("mcp_connect").unwrap(),
            "mcp_connect",
            &request,
            "MVP15D_TEST_INVALID",
        )
        .unwrap();
        assert_eq!(connect.response["status"], 200);
        assert_eq!(
            connect.response["parsedBody"]["result"]["protocolVersion"],
            "2025-06-18"
        );
        assert!(connect.response["body"]
            .as_str()
            .is_some_and(|body| body.contains("native-loopback")));
        assert!(connect.context.runtime_process_identity_sha256.len() == 64);
        let forged = RawObservedCallInput {
            receipt_id: format!("mvp15d-observation-receipt:{}", "f".repeat(64)),
            request,
        };
        assert_eq!(
            call_receipt(
                &state.identity,
                &forged,
                "mcp_connect",
                "connected",
                "MVP15D_TEST_INVALID",
            )
            .unwrap_err()
            .code(),
            "MVP15D_TEST_INVALID"
        );
        drop(state);
    }

    #[test]
    fn native_descriptor_normalization_accepts_direct_and_toolset_wire_shapes() {
        let contract = json!({
            "schemaVersion": "mvp15d.asset-tools.v1",
            "dryRunSchema": { "type": "object" },
            "rollbackContract": { "type": "reverse_operation" },
            "affectedAssetsSchema": { "type": "array" },
            "evidenceQuery": { "type": "read_only" }
        });
        let direct = json!({
            "name": MVP15D_TOOL_NAMES[0],
            "inputSchema": { "type": "object" },
            "outputSchema": contract,
        });
        let facade = json!({
            "toolset": {
                "toolsetId": "UAgentAssetTools",
                "methods": [{
                    "exactToolName": MVP15D_TOOL_NAMES[0],
                    "methodId": "create-folder",
                    "schemaVersion": "mvp15d.asset-tools.v1",
                    "inputSchema": { "type": "object" },
                    "dryRunSchema": { "type": "object" },
                    "rollbackContract": { "type": "reverse_operation" },
                    "affectedAssetsSchema": { "type": "array" },
                    "evidenceQuery": { "type": "read_only" }
                }]
            }
        });
        let mut direct_descriptors = Vec::new();
        collect_product_descriptors(&direct, "direct", None, &mut direct_descriptors);
        let mut facade_descriptors = Vec::new();
        collect_product_descriptors(&facade, "facade", None, &mut facade_descriptors);
        assert_eq!(direct_descriptors.len(), 1);
        assert_eq!(direct_descriptors[0].source, "direct");
        assert_eq!(facade_descriptors.len(), 1);
        assert_eq!(facade_descriptors[0].source, "facade");
        assert_eq!(
            facade_descriptors[0].toolset_id.as_deref(),
            Some("UAgentAssetTools")
        );
    }

    #[test]
    fn strict_arguments_reject_unknown_duplicate_and_reordered_flags() {
        let parsed = parse_arguments(arguments()).unwrap().unwrap();
        assert_eq!(parsed.phase, BridgePhase::CapabilityProbe);
        let mut unknown = arguments();
        unknown[1] = OsString::from("--unknown");
        assert_eq!(
            parse_arguments(unknown).unwrap_err().code(),
            "MVP15D_BRIDGE_ARGUMENT_VECTOR_INVALID"
        );
        let mut duplicate = arguments();
        duplicate[3] = OsString::from("--phase");
        assert_eq!(
            parse_arguments(duplicate).unwrap_err().code(),
            "MVP15D_BRIDGE_ARGUMENT_VECTOR_INVALID"
        );
        let mut reordered = arguments();
        reordered.swap(1, 3);
        reordered.swap(2, 4);
        assert_eq!(
            parse_arguments(reordered).unwrap_err().code(),
            "MVP15D_BRIDGE_ARGUMENT_VECTOR_INVALID"
        );
    }

    #[test]
    fn endpoint_phase_and_rendered_path_are_exact() {
        let mut endpoint = arguments();
        endpoint[22] = OsString::from("http://localhost:18765/mcp");
        assert_eq!(
            parse_arguments(endpoint).unwrap_err().code(),
            "MVP15D_BRIDGE_ENDPOINT_INVALID"
        );
        let mut path = arguments();
        path[32] = OsString::from(PRODUCT_PATH);
        assert_eq!(
            parse_arguments(path).unwrap_err().code(),
            "MVP15D_BRIDGE_RENDERED_PATH_INVALID"
        );
        let mut mode = arguments();
        mode[4] = OsString::from("live");
        assert_eq!(
            parse_arguments(mode).unwrap_err().code(),
            "MVP15D_BRIDGE_MODE_INVALID"
        );
    }

    #[test]
    fn event_records_never_serialize_local_paths_or_nonce_values() {
        let serialized = serde_json::to_string(&identity_data(&BridgeIdentity {
            phase: BridgePhase::CapabilityProbe,
            mode: BridgeMode::CapabilityOnly,
            task_id: "TASK-MVP15D-UAGENT-RUNTIME-BRIDGE".to_string(),
            source_commit: COMPILED_SOURCE_COMMIT.to_string(),
            source_tree_sha256: COMPILED_SOURCE_TREE_SHA256.to_string(),
            source_dirty: compiled_source_dirty(),
            source_head_ref: COMPILED_SOURCE_HEAD_REF.to_string(),
            marker: "uagent-mvp15d-runtime-bridge-marker-0001".to_string(),
            session: "uagent-runtime-bridge-session-0001".to_string(),
            generation: 1,
            endpoint: "http://127.0.0.1:18765/mcp".to_string(),
            port: 18765,
            evidence_root: PathBuf::from("C:\\Users\\secret\\repo\\external\\root"),
            event_file: PathBuf::from("C:\\Users\\secret\\events.jsonl"),
            driver_file: PathBuf::from("C:\\Users\\secret\\driver.json"),
            rendered_product_path: CAPABILITY_PATH.to_string(),
            nonce_sha256: "a".repeat(64),
            executable_basename: "uagent.exe".to_string(),
            executable_sha256: "b".repeat(64),
            pid: 42,
        }))
        .unwrap();
        assert!(!serialized.contains("C:\\\\Users"));
        assert!(!serialized.contains("http://127.0.0.1"));
        assert!(!serialized.contains("secret"));
        assert!(serialized.contains("\"nonceSha256\""));
    }

    #[test]
    fn ue_automation_reporter_contract_and_command_are_bound_in_native_test() {
        let header = include_str!(
            "../../../../integrations/unreal/UAgentAssetTools/Source/UAgentAssetTools/Public/UAgentAssetToolsContract.h"
        );
        let automation_tests = include_str!(
            "../../../../integrations/unreal/UAgentAssetTools/Source/UAgentAssetToolsTests/Private/UAgentAssetToolsTests.cpp"
        );
        let producer = include_str!("../../../../scripts/mvp15d-final-live-producer-helper.mjs");
        for marker in [
            "uagent.mvp15d.ue-automation-report.v1",
            "-UAgentTaskId=",
            "-UAgentTaskGeneration=",
            "-UAgentSourceCommit=",
            "-UAgentTaskMarker=",
            "-UAgentSession=",
            "-UAgentGeneration=",
        ] {
            assert!(
                header.contains(marker),
                "missing UE reporter marker: {marker}"
            );
            assert!(
                producer.contains(marker),
                "producer command drift: {marker}"
            );
        }
        for test_name in [
            "UAgentAssetTools.Contracts",
            "UAgentAssetTools.ReadOnly",
            "UAgentAssetTools.Closeout",
        ] {
            assert!(
                automation_tests.contains(test_name),
                "missing compiled Automation contract: {test_name}"
            );
            assert!(
                producer.contains(test_name),
                "producer matrix drift: {test_name}"
            );
        }
        assert!(producer.contains("-ReportExportPath="));
        assert!(producer.contains("parseOfficialAutomationReport"));
        assert!(!producer.contains("--structured-events"));
    }
}
