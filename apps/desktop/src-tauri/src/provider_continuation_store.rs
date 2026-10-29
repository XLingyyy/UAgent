//! Immutable Responses-native continuation data in the managed run database.
//! Loading data never grants execution authority, restores credentials or changes a
//! RunStore checkpoint revision. The caller supplies a fresh native-owned scope.
#![cfg(windows)]
// Reusing the wrapper here keeps continuation errors sanitized and independent.
#[allow(dead_code, clippy::duplicate_mod)]
#[path = "local_run_store/sqlite.rs"]
mod sqlite;

use crate::local_run_store::RunStore;
use crate::product_settings_store::{NativeEndpointPolicy, ProductSettingsStore, WireApi};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlite::{Db, Value};
use std::path::{Path, PathBuf};

const MAX_RECORD_BYTES: usize = 1_048_576;
const MAX_BATCH_BYTES: i64 = 8_388_608;
const MAX_RECORDS: i64 = 128;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

pub(crate) type Result<T> = std::result::Result<T, StoreError>;
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoreError {
    pub kind: String,
    pub message: String,
}
impl StoreError {
    fn new(kind: &str, _internal: &str) -> Self {
        Self {
            kind: kind.into(),
            message: match kind {
                "conflict" => "native continuation ownership or immutable data changed",
                "capacity" => "native continuation storage limit exceeded; no data was truncated",
                "notFound" => "native continuation run or provider is unavailable",
                "newerSchema" => "native continuations require a newer application",
                "invalid" => "native continuation data is invalid",
                "busy" => "native continuation storage is busy",
                _ => "native continuation storage failed; data was not reset",
            }
            .into(),
        }
    }
    fn invalid(_message: &str) -> Self {
        Self::new("invalid", "")
    }
    fn corrupt() -> Self {
        Self::new("corrupt", "")
    }
}
impl From<std::io::Error> for StoreError {
    fn from(_: std::io::Error) -> Self {
        Self::new("io", "")
    }
}
impl From<crate::local_run_store::StoreError> for StoreError {
    fn from(error: crate::local_run_store::StoreError) -> Self {
        Self::new(&error.kind, "")
    }
}
impl From<crate::product_settings_store::StoreError> for StoreError {
    fn from(error: crate::product_settings_store::StoreError) -> Self {
        Self::new(&error.kind, "")
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ContinuationOwner {
    pub provider_id: String,
    pub model_id: String,
    pub project_id: String,
    pub project_epoch: u64,
    pub run_id: String,
    pub conversation_id: String,
}
/// This DTO describes data ownership and confers no execution authority.
/// The broker must replace renderer input with its fresh native-owned scope.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ContinuationScope {
    pub owner: ContinuationOwner,
    pub provider_generation: String,
    pub provider_revision: i64,
    pub configuration_fingerprint: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ContinuationToolCall {
    pub id: String,
    pub name: String,
    pub arguments: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ContinuationAssistant {
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ContinuationToolCall>>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProviderNativeContinuation {
    pub schema_version: u32,
    pub wire_api: String,
    pub owner: ContinuationOwner,
    pub request_id: String,
    pub response_id: String,
    pub created_at: u64,
    pub assistant: ContinuationAssistant,
    pub output: Vec<serde_json::Value>,
}

pub(crate) struct ProviderContinuationStore {
    db: Db,
    root: PathBuf,
}
fn text_id(value: &str, maximum: usize) -> Result<()> {
    if value.trim().is_empty() || value.len() > maximum || value.chars().any(char::is_control) {
        return Err(StoreError::invalid(""));
    }
    Ok(())
}
fn sha(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}
fn hex64(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_hexdigit())
}
fn validate_owner(owner: &ContinuationOwner) -> Result<()> {
    for value in [
        &owner.provider_id,
        &owner.model_id,
        &owner.project_id,
        &owner.run_id,
        &owner.conversation_id,
    ] {
        text_id(value, 256)?;
    }
    if owner.project_epoch > MAX_SAFE_INTEGER {
        return Err(StoreError::invalid(""));
    }
    Ok(())
}
fn validate_scope(scope: &ContinuationScope) -> Result<()> {
    validate_owner(&scope.owner)?;
    if scope.provider_revision < 1
        || !hex64(&scope.provider_generation)
        || !hex64(&scope.configuration_fingerprint)
    {
        return Err(StoreError::invalid(""));
    }
    Ok(())
}
fn blocked_key(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    matches!(
        normalized.as_str(),
        "apikey"
            | "authorization"
            | "credential"
            | "credentials"
            | "password"
            | "secret"
            | "secretref"
            | "accesstoken"
            | "refreshtoken"
            | "approval"
            | "approvalgrant"
            | "grant"
            | "lease"
            | "trust"
            | "trusted"
            | "sessionkey"
            | "connected"
            | "validated"
    )
}
fn validate_output(value: &serde_json::Value, depth: usize, nodes: &mut usize) -> Result<()> {
    *nodes = nodes.checked_add(1).ok_or_else(StoreError::corrupt)?;
    if depth > 32 || *nodes > 65_536 {
        return Err(StoreError::invalid(""));
    }
    match value {
        serde_json::Value::Object(object) => {
            for (key, value) in object {
                if key.len() > MAX_RECORD_BYTES {
                    return Err(StoreError::new("capacity", ""));
                }
                if blocked_key(key) {
                    return Err(StoreError::invalid(""));
                }
                validate_output(value, depth + 1, nodes)?;
            }
        }
        serde_json::Value::Array(array) => {
            for value in array {
                validate_output(value, depth + 1, nodes)?;
            }
        }
        serde_json::Value::String(value) if value.len() > MAX_RECORD_BYTES => {
            return Err(StoreError::new("capacity", ""));
        }
        _ => {}
    }
    Ok(())
}
fn encode(record: &ProviderNativeContinuation, scope: &ContinuationScope) -> Result<String> {
    validate_scope(scope)?;
    if record.schema_version != 1
        || record.wire_api != "responses"
        || record.owner != scope.owner
        || record.created_at > MAX_SAFE_INTEGER
    {
        return Err(StoreError::invalid(""));
    }
    if record.assistant.content.len() > MAX_RECORD_BYTES {
        return Err(StoreError::new("capacity", ""));
    }
    text_id(&record.request_id, 512)?;
    if record.response_id.is_empty()
        || record.response_id.len() > 128
        || !record
            .response_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(StoreError::invalid(""));
    }
    if record.output.is_empty() || record.output.len() > 512 {
        return Err(StoreError::invalid(""));
    }
    if let Some(calls) = &record.assistant.tool_calls {
        if calls.len() > 128 {
            return Err(StoreError::invalid(""));
        }
        let mut ids = std::collections::HashSet::new();
        for call in calls {
            text_id(&call.id, 256)?;
            text_id(&call.name, 256)?;
            if !ids.insert(&call.id) || call.arguments.len() > MAX_RECORD_BYTES {
                return Err(StoreError::invalid(""));
            }
        }
    }
    let mut nodes = 0;
    for output in &record.output {
        let object = output.as_object().ok_or_else(|| StoreError::invalid(""))?;
        text_id(
            object
                .get("type")
                .and_then(serde_json::Value::as_str)
                .ok_or_else(|| StoreError::invalid(""))?,
            128,
        )?;
        validate_output(output, 0, &mut nodes)?;
    }
    let text = serde_json::to_string(record).map_err(|_| StoreError::invalid(""))?;
    if text.len() > MAX_RECORD_BYTES {
        return Err(StoreError::new("capacity", ""));
    }
    Ok(text)
}
pub(crate) fn validate_record(
    record: &ProviderNativeContinuation,
    scope: &ContinuationScope,
) -> Result<()> {
    encode(record, scope).map(|_| ())
}
fn scope_values(scope: &ContinuationScope) -> Vec<Value> {
    vec![
        scope.owner.project_id.as_str().into(),
        (scope.owner.project_epoch as i64).into(),
        scope.owner.run_id.as_str().into(),
        scope.owner.conversation_id.as_str().into(),
        scope.owner.provider_id.as_str().into(),
        scope.owner.model_id.as_str().into(),
        scope.provider_generation.as_str().into(),
        scope.provider_revision.into(),
        scope.configuration_fingerprint.as_str().into(),
    ]
}
const SCOPE_WHERE: &str = "project_id=? AND project_epoch=? AND run_id=? AND conversation_id=? AND provider_id=? AND model_id=? AND provider_generation=? AND provider_revision=? AND configuration_fingerprint=?";

impl ProviderContinuationStore {
    pub(crate) fn open(root: impl AsRef<Path>) -> Result<Self> {
        // Reuse existing local-path/reparse/quota/schema checks before opening the same DB.
        drop(RunStore::open(root.as_ref())?);
        drop(ProductSettingsStore::open(root.as_ref())?);
        let root = std::fs::canonicalize(root)?;
        let db = Db::open(&root.join("runs.sqlite3"))?;
        db.execute("PRAGMA foreign_keys=ON", &[])?;
        db.execute("PRAGMA synchronous=FULL", &[])?;
        db.execute("PRAGMA trusted_schema=OFF", &[])?;
        let page_size = db.query("PRAGMA page_size", &[])?[0][0].int()? as u64;
        let pages = crate::local_run_store::StoreOptions::default().max_database_bytes / page_size;
        db.execute(&format!("PRAGMA max_page_count={pages}"), &[])?;
        db.transaction(|| {
            let exists = db.query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='provider_continuation_schema'", &[])?[0][0].int()?;
            if exists == 0 {
                if db.query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='provider_continuations_v1'", &[])?[0][0].int()? != 0 {
                    return Err(StoreError::corrupt());
                }
                db.execute("CREATE TABLE provider_continuation_schema(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL CHECK(version>0))", &[])?;
                db.execute("INSERT INTO provider_continuation_schema VALUES(1,1)", &[])?;
                db.execute("CREATE TABLE provider_continuations_v1(project_id TEXT NOT NULL,project_epoch INTEGER NOT NULL CHECK(project_epoch>=0),run_id TEXT NOT NULL,conversation_id TEXT NOT NULL,provider_id TEXT NOT NULL,model_id TEXT NOT NULL,provider_generation TEXT NOT NULL,provider_revision INTEGER NOT NULL CHECK(provider_revision>0),configuration_fingerprint TEXT NOT NULL,request_id TEXT NOT NULL,response_id TEXT NOT NULL,created_at INTEGER NOT NULL CHECK(created_at>=0),payload TEXT NOT NULL,payload_sha256 TEXT NOT NULL,PRIMARY KEY(project_id,project_epoch,run_id,conversation_id,provider_id,model_id,provider_generation,provider_revision,configuration_fingerprint,request_id),UNIQUE(project_id,project_epoch,run_id,conversation_id,provider_id,model_id,provider_generation,provider_revision,configuration_fingerprint,response_id),FOREIGN KEY(project_id,run_id) REFERENCES runs(project_id,id))", &[])?;
            }
            let rows = db.query("SELECT singleton,version FROM provider_continuation_schema", &[])?;
            if rows.len() != 1 || rows[0][0].int()? != 1 { return Err(StoreError::corrupt()); }
            if rows[0][1].int()? > 1 { return Err(StoreError::new("newerSchema", "")); }
            if rows[0][1].int()? != 1 { return Err(StoreError::corrupt()); }
            Ok(())
        })?;
        Ok(Self { db, root })
    }

    /// Obtains the current native-policy fingerprint, then transactionally rechecks
    /// its generation/revision. A concurrent edit cannot keep this snapshot current.
    fn check_settings(
        &self,
        scope: &ContinuationScope,
        policy: &dyn NativeEndpointPolicy,
    ) -> Result<()> {
        validate_scope(scope)?;
        let settings = ProductSettingsStore::open(&self.root)?;
        let snapshot = settings
            .provider(&scope.owner.provider_id, policy)?
            .ok_or_else(|| StoreError::new("notFound", ""))?;
        let model = snapshot
            .models
            .iter()
            .find(|m| m.model_id == scope.owner.model_id)
            .ok_or_else(|| StoreError::new("notFound", ""))?;
        if snapshot.config.wire_api != WireApi::Responses
            || !snapshot.config.enabled
            || snapshot.generation != scope.provider_generation
            || snapshot.revision != scope.provider_revision
            || model.configuration_fingerprint != scope.configuration_fingerprint
        {
            return Err(StoreError::new("conflict", ""));
        }
        Ok(())
    }
    fn check_scope_transaction(&self, scope: &ContinuationScope) -> Result<()> {
        let run = self.db.query(
            "SELECT session_id FROM runs WHERE project_id=? AND id=?",
            &[
                scope.owner.project_id.as_str().into(),
                scope.owner.run_id.as_str().into(),
            ],
        )?;
        if run.len() != 1 || run[0][0].text()? != scope.owner.conversation_id {
            return Err(StoreError::new("notFound", ""));
        }
        let version = self.db.query(
            "SELECT generation,revision,present FROM product_provider_versions WHERE provider_id=?",
            &[scope.owner.provider_id.as_str().into()],
        )?;
        if version.len() != 1
            || version[0][0].text()? != scope.provider_generation
            || version[0][1].int()? != scope.provider_revision
            || version[0][2].int()? != 1
        {
            return Err(StoreError::new("conflict", ""));
        }
        Ok(())
    }
    pub(crate) fn load(
        &self,
        scope: &ContinuationScope,
        policy: &dyn NativeEndpointPolicy,
    ) -> Result<Vec<ProviderNativeContinuation>> {
        self.check_settings(scope, policy)?;
        self.db.transaction(|| {
            self.check_scope_transaction(scope)?;
            let params = scope_values(scope);
            let totals = self.db.query(&format!("SELECT COUNT(*),COALESCE(SUM(length(CAST(payload AS BLOB))),0),COALESCE(MAX(length(CAST(payload AS BLOB))),0) FROM provider_continuations_v1 WHERE {SCOPE_WHERE}"), &params)?;
            if totals[0][0].int()? > MAX_RECORDS || totals[0][1].int()? > MAX_BATCH_BYTES || totals[0][2].int()? > MAX_RECORD_BYTES as i64 {
                return Err(StoreError::new("capacity", ""));
            }
            let rows = self.db.query(&format!("SELECT request_id,response_id,created_at,payload,payload_sha256 FROM provider_continuations_v1 WHERE {SCOPE_WHERE} ORDER BY created_at,request_id LIMIT 129"), &params)?;
            let mut records = Vec::with_capacity(rows.len());
            for row in rows {
                let text = row[3].text()?;
                if sha(&text) != row[4].text()? { return Err(StoreError::corrupt()); }
                let record: ProviderNativeContinuation = serde_json::from_str(&text).map_err(|_| StoreError::corrupt())?;
                if encode(&record, scope)? != text || record.request_id != row[0].text()? ||
                    record.response_id != row[1].text()? || record.created_at as i64 != row[2].int()? {
                    return Err(StoreError::corrupt());
                }
                records.push(record);
            }
            Ok(records)
        })
    }
    /// Acknowledges a complete immutable record only after COMMIT. Identical retry
    /// is idempotent; conflict/failed COMMIT never dispatches any saved tool.
    pub(crate) fn save(
        &self,
        scope: &ContinuationScope,
        record: &ProviderNativeContinuation,
        policy: &dyn NativeEndpointPolicy,
    ) -> Result<()> {
        let payload = encode(record, scope)?;
        self.check_settings(scope, policy)?;
        self.db.transaction(|| {
            self.check_scope_transaction(scope)?;
            let mut params = scope_values(scope);
            params.push(record.request_id.as_str().into());
            let existing = self.db.query(&format!("SELECT CASE WHEN length(CAST(payload AS BLOB))<={MAX_RECORD_BYTES} THEN payload ELSE NULL END,payload_sha256 FROM provider_continuations_v1 WHERE {SCOPE_WHERE} AND request_id=?"), &params)?;
            if let Some(row) = existing.first() {
                return if row[0].text()? == payload && row[1].text()? == sha(&payload) { Ok(()) }
                    else { Err(StoreError::new("conflict", "")) };
            }
            let totals = self.db.query(&format!("SELECT COUNT(*),COALESCE(SUM(length(CAST(payload AS BLOB))),0) FROM provider_continuations_v1 WHERE {SCOPE_WHERE}"), &scope_values(scope))?;
            if totals[0][0].int()? >= MAX_RECORDS || totals[0][1].int()?.checked_add(payload.len() as i64).filter(|n| *n <= MAX_BATCH_BYTES).is_none() {
                return Err(StoreError::new("capacity", ""));
            }
            let mut params = scope_values(scope);
            params.extend([
                record.request_id.as_str().into(), record.response_id.as_str().into(),
                (record.created_at as i64).into(), payload.as_str().into(), sha(&payload).into()
            ]);
            self.db.execute("INSERT INTO provider_continuations_v1(project_id,project_epoch,run_id,conversation_id,provider_id,model_id,provider_generation,provider_revision,configuration_fingerprint,request_id,response_id,created_at,payload,payload_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", &params)?;
            Ok(())
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::local_run_store::{NewRun, Origin, Project, Session};
    use crate::product_settings_store::{
        AuthMode, CapabilityDeclarations, EndpointDecision, ProviderConfig, ProviderModel,
        RequestDefaults,
    };
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct FixturePolicy;
    impl NativeEndpointPolicy for FixturePolicy {
        fn validate_endpoint(
            &self,
            wire: WireApi,
            base: &str,
        ) -> crate::product_settings_store::Result<EndpointDecision> {
            if wire != WireApi::Responses || base != "https://synthetic.invalid/v1" {
                return Err(crate::product_settings_store::StoreError {
                    kind: "endpointPolicy".into(),
                    message: "fixture rejected".into(),
                });
            }
            Ok(EndpointDecision {
                canonical_base_url: base.into(),
                policy_revision: "fixture-only".into(),
                transport_supported: true,
            })
        }
    }
    struct DenyPolicy;
    impl NativeEndpointPolicy for DenyPolicy {
        fn validate_endpoint(
            &self,
            _: WireApi,
            _: &str,
        ) -> crate::product_settings_store::Result<EndpointDecision> {
            Err(crate::product_settings_store::StoreError {
                kind: "endpointPolicy".into(),
                message: "fixture rejected".into(),
            })
        }
    }
    struct Fixture {
        root: PathBuf,
        scope: ContinuationScope,
    }
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "uagent-continuations-{}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            assert!(
                root.to_string_lossy().starts_with("E:")
                    || root.to_string_lossy().starts_with("G:")
            );
            let runs = RunStore::open(&root).unwrap();
            runs.create_project(&Project {
                id: "project".into(),
                root: root.join("fixture-project").to_string_lossy().into(),
                label: "Synthetic".into(),
                created_at: 1,
            })
            .unwrap();
            runs.create_session(&Session {
                project_id: "project".into(),
                id: "conversation".into(),
                title: "Synthetic".into(),
                created_at: 1,
                archived: false,
                parent_id: None,
                origin: Origin::Native,
            })
            .unwrap();
            runs.start_run(
                "project",
                &NewRun {
                    id: "run".into(),
                    session_id: "conversation".into(),
                    goal: "Fixture".into(),
                    created_at: 1,
                },
            )
            .unwrap();
            drop(runs);
            let settings = ProductSettingsStore::open(&root).unwrap();
            let config = ProviderConfig {
                provider_id: "provider".into(),
                display_name: "Synthetic".into(),
                base_url: "https://synthetic.invalid/v1".into(),
                wire_api: WireApi::Responses,
                auth_mode: AuthMode::EnvKey,
                models: vec![
                    ProviderModel {
                        id: "model".into(),
                        label: "Model".into(),
                        context_window: 128000,
                        supports_reasoning: false,
                        reasoning_efforts: None,
                        capability_declarations: CapabilityDeclarations::default(),
                        request_defaults: RequestDefaults::default(),
                    },
                    ProviderModel {
                        id: "model2".into(),
                        label: "Model2".into(),
                        context_window: 128000,
                        supports_reasoning: false,
                        reasoning_efforts: None,
                        capability_declarations: CapabilityDeclarations::default(),
                        request_defaults: RequestDefaults::default(),
                    },
                ],
                default_model: Some("model".into()),
                default_reasoning_effort: None,
                enabled: true,
            };
            let snapshot = settings
                .save_provider(
                    &settings.provider_version("provider").unwrap(),
                    &config,
                    &FixturePolicy,
                )
                .unwrap();
            Self {
                root,
                scope: ContinuationScope {
                    owner: ContinuationOwner {
                        provider_id: "provider".into(),
                        model_id: "model".into(),
                        project_id: "project".into(),
                        project_epoch: 7,
                        run_id: "run".into(),
                        conversation_id: "conversation".into(),
                    },
                    provider_generation: snapshot.generation,
                    provider_revision: snapshot.revision,
                    configuration_fingerprint: snapshot.models[0].configuration_fingerprint.clone(),
                },
            }
        }
        fn record(&self, id: usize) -> ProviderNativeContinuation {
            ProviderNativeContinuation {
                schema_version: 1,
                wire_api: "responses".into(),
                owner: self.scope.owner.clone(),
                request_id: format!("request-{id}"),
                response_id: format!("resp_{id}"),
                created_at: id as u64,
                assistant: ContinuationAssistant {
                    content: "Unicode Chinese: \u{4e2d}\u{6587}".into(),
                    tool_calls: Some(vec![ContinuationToolCall {
                        id: format!("call_{id}"),
                        name: "project.read_text".into(),
                        arguments: "{\"path\":\"Source/readme.txt\"}".into(),
                    }]),
                },
                output: vec![
                    serde_json::json!({"type":"reasoning","id":format!("reasoning_{id}"),"encrypted_content":"fixture-opaque-encrypted-data","summary":[]}),
                    serde_json::json!({"type":"function_call","id":format!("item_{id}"),"call_id":format!("call_{id}"),"name":"project.read_text","arguments":"{\"path\":\"Source/readme.txt\"}"}),
                ],
            }
        }
    }
    #[test]
    fn sqlite_reopen_preserves_native_data_without_changing_run_revision() {
        let f = Fixture::new();
        let before = RunStore::open(&f.root)
            .unwrap()
            .snapshot("project", "run")
            .unwrap();
        let record = f.record(1);
        let store = ProviderContinuationStore::open(&f.root).unwrap();
        store.save(&f.scope, &record, &FixturePolicy).unwrap();
        drop(store);
        let reopened = ProviderContinuationStore::open(&f.root).unwrap();
        assert_eq!(
            reopened.load(&f.scope, &FixturePolicy).unwrap(),
            vec![record]
        );
        let after = RunStore::open(&f.root)
            .unwrap()
            .snapshot("project", "run")
            .unwrap();
        assert_eq!(before, after);
        assert!(after.requires_fresh_authorization);
        assert!(after.tool_calls.is_empty());
    }
    #[test]
    fn identical_save_is_idempotent_but_conflicting_request_or_response_is_rejected() {
        let f = Fixture::new();
        let store = ProviderContinuationStore::open(&f.root).unwrap();
        let record = f.record(1);
        store.save(&f.scope, &record, &FixturePolicy).unwrap();
        store.save(&f.scope, &record, &FixturePolicy).unwrap();
        let mut conflict = record.clone();
        conflict.assistant.content = "changed".into();
        assert_eq!(
            store
                .save(&f.scope, &conflict, &FixturePolicy)
                .unwrap_err()
                .kind,
            "conflict"
        );
        let mut duplicate_response = record.clone();
        duplicate_response.request_id = "other".into();
        assert!(store
            .save(&f.scope, &duplicate_response, &FixturePolicy)
            .is_err());
        assert_eq!(store.load(&f.scope, &FixturePolicy).unwrap(), vec![record]);
    }
    #[test]
    fn exact_epoch_run_conversation_project_and_model_do_not_cross_load() {
        let f = Fixture::new();
        let store = ProviderContinuationStore::open(&f.root).unwrap();
        store.save(&f.scope, &f.record(1), &FixturePolicy).unwrap();
        let mut epoch = f.scope.clone();
        epoch.owner.project_epoch += 1;
        assert!(store.load(&epoch, &FixturePolicy).unwrap().is_empty());
        let mut run = f.scope.clone();
        run.owner.run_id = "absent".into();
        assert_eq!(
            store.load(&run, &FixturePolicy).unwrap_err().kind,
            "notFound"
        );
        let mut conversation = f.scope.clone();
        conversation.owner.conversation_id = "other".into();
        assert_eq!(
            store.load(&conversation, &FixturePolicy).unwrap_err().kind,
            "notFound"
        );
        let runs = RunStore::open(&f.root).unwrap();
        runs.create_project(&Project {
            id: "other-project".into(),
            root: "E:/synthetic-other".into(),
            label: "Other".into(),
            created_at: 1,
        })
        .unwrap();
        runs.create_session(&Session {
            project_id: "other-project".into(),
            id: "conversation".into(),
            title: "Other".into(),
            created_at: 1,
            archived: false,
            parent_id: None,
            origin: Origin::Native,
        })
        .unwrap();
        runs.start_run(
            "other-project",
            &NewRun {
                id: "run".into(),
                session_id: "conversation".into(),
                goal: "Other".into(),
                created_at: 1,
            },
        )
        .unwrap();
        let mut project = f.scope.clone();
        project.owner.project_id = "other-project".into();
        assert!(store.load(&project, &FixturePolicy).unwrap().is_empty());
        let mut model = f.scope.clone();
        model.owner.model_id = "model2".into();
        model.configuration_fingerprint = ProductSettingsStore::open(&f.root)
            .unwrap()
            .provider("provider", &FixturePolicy)
            .unwrap()
            .unwrap()
            .models[1]
            .configuration_fingerprint
            .clone();
        assert!(store.load(&model, &FixturePolicy).unwrap().is_empty());
    }
    #[test]
    fn provider_edit_and_delete_recreate_reject_stale_scope_without_writing() {
        let f = Fixture::new();
        let store = ProviderContinuationStore::open(&f.root).unwrap();
        store.save(&f.scope, &f.record(1), &FixturePolicy).unwrap();
        let settings = ProductSettingsStore::open(&f.root).unwrap();
        let snapshot = settings
            .provider("provider", &FixturePolicy)
            .unwrap()
            .unwrap();
        let mut config = snapshot.config.clone();
        config.display_name = "Edited".into();
        let next = settings
            .save_provider(&snapshot.version(), &config, &FixturePolicy)
            .unwrap();
        assert_eq!(
            store.load(&f.scope, &FixturePolicy).unwrap_err().kind,
            "conflict"
        );
        assert_eq!(
            store
                .save(&f.scope, &f.record(2), &FixturePolicy)
                .unwrap_err()
                .kind,
            "conflict"
        );
        settings.delete_provider(&next.version()).unwrap();
        let new = settings
            .save_provider(
                &settings.provider_version("provider").unwrap(),
                &config,
                &FixturePolicy,
            )
            .unwrap();
        assert_ne!(f.scope.provider_generation, new.generation);
        assert_eq!(
            store
                .save(&f.scope, &f.record(2), &FixturePolicy)
                .unwrap_err()
                .kind,
            "conflict"
        );
        assert_eq!(
            store
                .db
                .query("SELECT COUNT(*) FROM provider_continuations_v1", &[])
                .unwrap()[0][0]
                .int()
                .unwrap(),
            1
        );
    }
    #[test]
    fn policy_and_transactional_version_checks_fail_closed() {
        let f = Fixture::new();
        let store = ProviderContinuationStore::open(&f.root).unwrap();
        assert!(store.save(&f.scope, &f.record(1), &DenyPolicy).is_err());
        store.check_settings(&f.scope, &FixturePolicy).unwrap();
        let settings = ProductSettingsStore::open(&f.root).unwrap();
        let snapshot = settings
            .provider("provider", &FixturePolicy)
            .unwrap()
            .unwrap();
        let mut config = snapshot.config.clone();
        config.display_name = "Concurrent".into();
        settings
            .save_provider(&snapshot.version(), &config, &FixturePolicy)
            .unwrap();
        assert_eq!(
            store
                .db
                .transaction(|| store.check_scope_transaction(&f.scope))
                .unwrap_err()
                .kind,
            "conflict"
        );
        assert_eq!(
            store
                .db
                .query("SELECT COUNT(*) FROM provider_continuations_v1", &[])
                .unwrap()[0][0]
                .int()
                .unwrap(),
            0
        );
    }
    #[test]
    fn strict_record_schema_and_nested_secret_authority_keys_are_rejected() {
        let f = Fixture::new();
        let mut raw = serde_json::to_value(f.record(1)).unwrap();
        raw["approval"] = serde_json::json!(true);
        assert!(serde_json::from_value::<ProviderNativeContinuation>(raw).is_err());
        let mut raw = serde_json::to_value(f.record(1)).unwrap();
        raw["owner"]["connected"] = serde_json::json!(true);
        assert!(serde_json::from_value::<ProviderNativeContinuation>(raw).is_err());
        for key in [
            "api_key",
            "Authorization",
            "credential",
            "approvalGrant",
            "lease",
            "access_token",
        ] {
            let mut record = f.record(1);
            record.output[0]["nested"] = serde_json::json!({ key: "synthetic-only" });
            assert!(validate_record(&record, &f.scope).is_err(), "{key}");
        }
        let mut wrong = f.record(1);
        wrong.owner.project_epoch += 1;
        assert!(validate_record(&wrong, &f.scope).is_err());
        let mut wrong = f.record(1);
        wrong.response_id = "contains space".into();
        assert!(validate_record(&wrong, &f.scope).is_err());
        let mut wrong = f.record(1);
        wrong.output = vec![serde_json::json!(["not an object"])];
        assert!(validate_record(&wrong, &f.scope).is_err());
    }
    #[test]
    fn per_record_and_owner_count_limits_preserve_existing_data() {
        let f = Fixture::new();
        let store = ProviderContinuationStore::open(&f.root).unwrap();
        let mut large = f.record(999);
        large.assistant.content = "x".repeat(MAX_RECORD_BYTES);
        assert_eq!(
            store
                .save(&f.scope, &large, &FixturePolicy)
                .unwrap_err()
                .kind,
            "capacity"
        );
        for id in 0..128 {
            store.save(&f.scope, &f.record(id), &FixturePolicy).unwrap();
        }
        assert_eq!(
            store
                .save(&f.scope, &f.record(128), &FixturePolicy)
                .unwrap_err()
                .kind,
            "capacity"
        );
        assert_eq!(store.load(&f.scope, &FixturePolicy).unwrap().len(), 128);
    }
    #[test]
    fn aggregate_limit_rejects_next_record_without_partial_write() {
        let f = Fixture::new();
        let store = ProviderContinuationStore::open(&f.root).unwrap();
        for id in 0..9 {
            let mut record = f.record(id);
            record.assistant.content = "x".repeat(900_000);
            store.save(&f.scope, &record, &FixturePolicy).unwrap();
        }
        let mut over = f.record(9);
        over.assistant.content = "x".repeat(900_000);
        assert_eq!(
            store
                .save(&f.scope, &over, &FixturePolicy)
                .unwrap_err()
                .kind,
            "capacity"
        );
        assert_eq!(store.load(&f.scope, &FixturePolicy).unwrap().len(), 9);
    }
    #[test]
    fn persisted_corruption_and_oversized_rows_are_rejected_before_hydration() {
        let f = Fixture::new();
        let store = ProviderContinuationStore::open(&f.root).unwrap();
        store.save(&f.scope, &f.record(1), &FixturePolicy).unwrap();
        store
            .db
            .execute(
                "UPDATE provider_continuations_v1 SET payload_sha256='broken'",
                &[],
            )
            .unwrap();
        assert_eq!(
            store.load(&f.scope, &FixturePolicy).unwrap_err().kind,
            "corrupt"
        );
        store
            .db
            .execute(
                "UPDATE provider_continuations_v1 SET payload=?",
                &["x".repeat(MAX_RECORD_BYTES + 1).into()],
            )
            .unwrap();
        assert_eq!(
            store.load(&f.scope, &FixturePolicy).unwrap_err().kind,
            "capacity"
        );
    }
}
