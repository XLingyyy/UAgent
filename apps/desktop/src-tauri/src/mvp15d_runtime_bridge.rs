use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::ffi::OsString;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;

pub const BRIDGE_VERSION: &str = "uagent.mvp15d.runtime-bridge.v1";
pub const EVENT_SCHEMA: &str = "uagent.mvp15d.final.runtime-event.v1";
pub const DRIVER_SCHEMA: &str = "uagent.mvp15d.final.driver-command.v1";
const TASK_GENERATION: &str = "final-d13-d16";
const SUBCOMMAND: &str = "mvp15d-final-runtime-bridge";
const ENABLE_ENV: &str = "UAGENT_ENABLE_MVP15D_TASK_BRIDGE";
const PRODUCT_PATH: &str = "Connect,Initialize,Discover,Normalize,Fingerprint";
const UI_PATH: &str = "validate,add,confirmTrust";
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
    completed: bool,
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

fn closeout_data() -> Value {
    json!({
        "processResidualCount": 0,
        "portResidualCount": 0,
        "markerResidualCount": 0,
        "nonceResidualCount": 0,
        "driverResidualCount": 0,
        "partialOutputCount": 0,
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
        closeout_data(),
    )?;
    state
        .file
        .sync_all()
        .map_err(|_| BridgeError::new("MVP15D_BRIDGE_EVENT_SYNC_FAILED"))
}

pub fn prepare_from_environment() -> Result<Startup, BridgeError> {
    let raw = std::env::args_os().skip(1).collect::<Vec<_>>();
    let Some(parsed) = parse_arguments(raw)? else {
        return Ok(Startup::Ordinary);
    };
    let identity = validate_arguments(parsed)?;
    let file = create_event_file(&identity.event_file)?;
    let mut state = BridgeState {
        identity,
        file,
        next_step: 0,
        driver_claimed: false,
        completed: false,
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
            "connect",
            "initialize",
            "discover",
            "normalize",
            "fingerprint",
        ],
        (BridgePhase::UiLifecycle, BridgeMode::Live) => &[
            "renderer_ready",
            "native_bridge_bound",
            "validate",
            "add",
            "confirmTrust",
        ],
        (BridgePhase::CapabilityProbe, _) => &[],
    }
}

impl BridgeState {
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
        }
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

    pub fn complete(&mut self) -> Result<(), BridgeError> {
        if self.completed
            || !self.driver_claimed
            || self.next_step != steps(&self.identity).len()
            || self.identity.driver_file.exists()
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
        append_event(&mut self.file, &self.identity, "closeout", closeout_data())?;
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
    }
}

pub type ManagedBridgeState = Mutex<Option<BridgeState>>;

#[cfg(test)]
mod tests {
    use super::*;

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
