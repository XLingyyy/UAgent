//! Native persistence behind the existing locale/layout/provider stores.
//! Shares T06's database/project registry, but owns a separate settings schema.
//! No credentials, authorization, live session state, or network operations.
#![cfg(windows)]
mod schema;
// Reuse the shared wrapper; its backup methods are delegated through RunStore.
#[allow(dead_code)]
#[path = "../local_run_store/sqlite.rs"]
mod sqlite;

use crate::local_run_store::RunStore;
pub use schema::SETTINGS_SCHEMA_VERSION;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlite::{Db, Value};
use std::{
    collections::HashSet,
    fs,
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
        Self::new("invalidSettings", message)
    }
    fn corrupt() -> Self {
        Self::new(
            "corruptSettings",
            "settings data is invalid; it was not reset; preserve a backup before recovery",
        )
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
        Self::new("io", "local settings I/O failed; data was not reset")
    }
}
impl From<crate::local_run_store::StoreError> for StoreError {
    fn from(value: crate::local_run_store::StoreError) -> Self {
        Self {
            kind: value.kind,
            message: value.message,
        }
    }
}
macro_rules! record {
    ($name:ident { $($field:ident:$ty:ty),* $(,)? }) => {
        #[derive(Debug,Clone,Serialize,Deserialize,PartialEq)]
        #[serde(rename_all="camelCase",deny_unknown_fields)]
        pub struct $name { $(pub $field:$ty),* }
    }
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum Locale {
    #[serde(rename = "zh-CN")]
    ZhCn,
    #[serde(rename = "en")]
    En,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Dark,
    Light,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum WireApi {
    #[serde(rename = "responses")]
    Responses,
    #[serde(rename = "chat_completions")]
    ChatCompletions,
    #[serde(rename = "anthropic")]
    Anthropic,
    #[serde(rename = "openai_compatible")]
    OpenaiCompatible,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum AuthMode {
    #[serde(rename = "env_key")]
    EnvKey,
    #[serde(rename = "none")]
    None,
}
#[derive(Debug, Clone, Copy, Hash, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ReasoningEffort {
    Low,
    Medium,
    High,
    Xhigh,
}
#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Declaration {
    #[default]
    Unknown,
    Supported,
    Unsupported,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CapabilityDeclarations {
    #[serde(default)]
    pub text: Declaration,
    #[serde(default)]
    pub tools: Declaration,
    #[serde(default)]
    pub streaming: Declaration,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RequestDefaults {
    pub temperature: Option<f64>,
    pub max_output_tokens: Option<u32>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProviderModel {
    pub id: String,
    pub label: String,
    pub context_window: u64,
    pub supports_reasoning: bool,
    pub reasoning_efforts: Option<Vec<ReasoningEffort>>,
    #[serde(default)]
    pub capability_declarations: CapabilityDeclarations,
    #[serde(default)]
    pub request_defaults: RequestDefaults,
}
record!(ProviderConfig {
    provider_id:String, display_name:String, base_url:String, wire_api:WireApi, auth_mode:AuthMode,
    models:Vec<ProviderModel>, default_model:Option<String>, default_reasoning_effort:Option<ReasoningEffort>, enabled:bool
});
record!(UserPreferences {
    theme:Theme, locale:Locale, active_project_id:Option<String>,
    selected_provider_id:Option<String>, default_provider_id:Option<String>
});
impl Default for UserPreferences {
    fn default() -> Self {
        Self {
            theme: Theme::Dark,
            locale: Locale::ZhCn,
            active_project_id: None,
            selected_provider_id: None,
            default_provider_id: None,
        }
    }
}
record!(VersionedPreferences {
    revision: i64,
    preferences: UserPreferences
});
record!(ProjectPreferences {provider_id:Option<String>,model_id:Option<String>,reasoning_effort:Option<ReasoningEffort>});
record!(VersionedProjectPreferences {
    project_id: String,
    revision: i64,
    preferences: ProjectPreferences,
    requires_fresh_project_trust: bool
});
// Complete optimistic-concurrency identity. Retain the token with the edited
// snapshot; fetching a newer token must never silently authorize an old edit.
record!(ProviderVersion {
    provider_id: String,
    generation: Option<String>,
    revision: i64,
    exists: bool
});
pub type ProviderRevision = ProviderVersion;
record!(CapabilityEvidence {
    provider_generation:String, configuration_fingerprint:String, observed_at:i64,
    text_supported:Option<bool>, tools_supported:Option<bool>, streaming_supported:Option<bool>
});
record!(ModelStatus {
    model_id:String, configuration_fingerprint:String, declarations:CapabilityDeclarations,
    historical_evidence:Option<CapabilityEvidence>, currently_verified:bool
});
record!(ProviderSnapshot {
    generation:String, revision:i64, config:ProviderConfig, transport_supported:bool, models:Vec<ModelStatus>,
    connection_verified:bool, requires_new_session:bool
});

impl ProviderSnapshot {
    pub fn version(&self) -> ProviderVersion {
        ProviderVersion {
            provider_id: self.config.provider_id.clone(),
            generation: Some(self.generation.clone()),
            revision: self.revision,
            exists: true,
        }
    }
}

/// Implement only in trusted native code by calling the same policy used by the
/// real transport. This interface is not a serializable webview setting.
pub trait NativeEndpointPolicy {
    fn validate_endpoint(&self, wire_api: WireApi, base_url: &str) -> Result<EndpointDecision>;
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EndpointDecision {
    pub canonical_base_url: String,
    pub policy_revision: String,
    pub transport_supported: bool,
}
/// Native-only input; intentionally not Deserialize and not a Tauri command.
/// The caller supplies observed facts from a real response, never user claims.
#[derive(Debug, Clone)]
pub struct NativeObservation {
    pub provider_id: String,
    pub provider_generation: String,
    pub model_id: String,
    pub configuration_fingerprint: String,
    pub observed_at: i64,
    pub text_supported: Option<bool>,
    pub tools_supported: Option<bool>,
    pub streaming_supported: Option<bool>,
}
pub struct ProductSettingsStore {
    db: Db,
    root: PathBuf,
}
const RECORD_LIMIT: usize = 262_144;
const MAX_PROVIDERS: usize = 64;

fn encode<T: Serialize>(value: &T) -> Result<String> {
    let text = serde_json::to_string(value)
        .map_err(|_| StoreError::invalid("settings cannot be encoded"))?;
    if text.len() > RECORD_LIMIT {
        return Err(StoreError::new(
            "capacity",
            "settings record exceeds 256 KiB; it was not truncated",
        ));
    }
    Ok(text)
}
fn decode<T: DeserializeOwned>(value: &Value) -> Result<T> {
    let text = value.text().map_err(|_| StoreError::corrupt())?;
    if text.len() > RECORD_LIMIT {
        return Err(StoreError::corrupt());
    }
    serde_json::from_str(&text).map_err(|_| StoreError::corrupt())
}
fn safe_text(value: &str, limit: usize, nonempty: bool) -> Result<()> {
    let lower = value.to_ascii_lowercase();
    let sensitive = [
        "sk-",
        "ghp_",
        "github_pat_",
        "bearer ",
        "-----begin",
        "api_key=",
        "api-key=",
        "password=",
        "secret=",
        "execution_token=",
        "approval_token=",
    ]
    .iter()
    .any(|marker| {
        lower
            .match_indices(marker)
            .any(|(offset, _)| offset == 0 || !lower.as_bytes()[offset - 1].is_ascii_alphanumeric())
    });
    if value.len() > limit
        || (nonempty && value.trim().is_empty())
        || value.chars().any(char::is_control)
        || sensitive
    {
        return Err(StoreError::invalid(
            "field is too large, invalid, or resembles credential/authorization data",
        ));
    }
    Ok(())
}
fn id(value: &str) -> Result<()> {
    safe_text(value, 256, true)
}
fn valid_generation(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn new_provider_generation() -> Result<String> {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).map_err(|_| {
        StoreError::new(
            "randomUnavailable",
            "provider generation could not be created; nothing was saved",
        )
    })?;
    Ok(bytes.iter().map(|byte| format!("{byte:02x}")).collect())
}
fn next_revision(revision: i64) -> Result<i64> {
    if revision < 0 {
        return Err(StoreError::invalid("expected revision must be nonnegative"));
    }
    revision
        .checked_add(1)
        .ok_or_else(|| StoreError::new("capacity", "settings revision overflow"))
}
fn base_url_shape(value: &str) -> Result<()> {
    safe_text(value, 4096, true)?;
    let lower = value.to_ascii_lowercase();
    let authority = if lower.starts_with("https://") {
        &value[8..]
    } else if lower.starts_with("http://") {
        &value[7..]
    } else {
        return Err(StoreError::invalid(
            "provider base URL must be HTTP or HTTPS",
        ));
    };
    let authority = authority.split('/').next().unwrap_or("");
    if authority.is_empty()
        || authority.contains('@')
        || value.contains(['?', '#', '\\'])
        || value.chars().any(char::is_whitespace)
    {
        return Err(StoreError::invalid(
            "base URLs cannot contain userinfo, query, fragment, backslashes or whitespace",
        ));
    }
    // Deliberately no host/IP/DNS allowlist here. Native transport policy is mandatory.
    Ok(())
}
fn validate_config(value: &ProviderConfig) -> Result<()> {
    id(&value.provider_id)?;
    safe_text(&value.display_name, 200, true)?;
    base_url_shape(&value.base_url)?;
    if value.models.len() > 128 || (value.enabled && value.models.is_empty()) {
        return Err(StoreError::invalid(
            "enabled providers need models; maximum is 128",
        ));
    }
    let mut ids = HashSet::new();
    for model in &value.models {
        id(&model.id)?;
        safe_text(&model.label, 200, true)?;
        if !ids.insert(&model.id) || model.context_window == 0 || model.context_window > 100_000_000
        {
            return Err(StoreError::invalid(
                "model identity or context window is invalid",
            ));
        }
        if let Some(efforts) = &model.reasoning_efforts {
            let unique: HashSet<_> = efforts.iter().collect();
            if unique.len() != efforts.len() || (!model.supports_reasoning && !efforts.is_empty()) {
                return Err(StoreError::invalid("reasoning declaration is inconsistent"));
            }
        }
        if model
            .request_defaults
            .temperature
            .is_some_and(|v| !v.is_finite() || !(0.0..=2.0).contains(&v))
            || model
                .request_defaults
                .max_output_tokens
                .is_some_and(|v| v == 0 || u64::from(v) > model.context_window)
        {
            return Err(StoreError::invalid("model request defaults are invalid"));
        }
    }
    if let Some(model) = &value.default_model {
        if !value.models.iter().any(|m| &m.id == model) {
            return Err(StoreError::invalid(
                "default model does not belong to provider",
            ));
        }
    }
    if let Some(effort) = value.default_reasoning_effort {
        let model = value
            .default_model
            .as_ref()
            .and_then(|id| value.models.iter().find(|m| &m.id == id))
            .ok_or_else(|| StoreError::invalid("default reasoning requires a default model"))?;
        if !supports_effort(model, effort) {
            return Err(StoreError::invalid(
                "default reasoning is not declared by the model",
            ));
        }
    }
    Ok(())
}
fn supports_effort(model: &ProviderModel, effort: ReasoningEffort) -> bool {
    model.supports_reasoning
        && model
            .reasoning_efforts
            .as_ref()
            .is_some_and(|values| values.contains(&effort))
}
fn checked_config(
    mut value: ProviderConfig,
    policy: &dyn NativeEndpointPolicy,
) -> Result<(ProviderConfig, EndpointDecision)> {
    validate_config(&value)?;
    let decision = policy.validate_endpoint(value.wire_api, &value.base_url)?;
    base_url_shape(&decision.canonical_base_url)?;
    safe_text(&decision.policy_revision, 128, true)?;
    value.base_url = decision.canonical_base_url.clone();
    Ok((value, decision))
}
fn fingerprint(
    config: &ProviderConfig,
    generation: &str,
    revision: i64,
    model: &ProviderModel,
    policy_revision: &str,
) -> Result<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(
            encode(&(
                config.provider_id.as_str(),
                generation,
                revision,
                config.base_url.as_str(),
                config.wire_api,
                config.auth_mode,
                model,
                policy_revision
            ))?
            .as_bytes()
        )
    ))
}

impl ProductSettingsStore {
    // Cross-table reads use the same short SQLite transaction as their reference
    // checks. A concurrent profile deletion cannot look like corrupt preferences.
    pub fn read_preferences(&self) -> Result<Option<VersionedPreferences>> {
        self.db.transaction(|| self.read_preferences_record())
    }
    pub fn provider(
        &self,
        provider: &str,
        policy: &dyn NativeEndpointPolicy,
    ) -> Result<Option<ProviderSnapshot>> {
        self.db
            .transaction(|| self.provider_record(provider, policy))
    }
    pub fn project_preferences(
        &self,
        project: &str,
    ) -> Result<Option<VersionedProjectPreferences>> {
        self.db
            .transaction(|| self.project_preferences_record(project))
    }

    pub fn open(root: impl AsRef<Path>) -> Result<Self> {
        // T06 owns app-data path policy, database format, quota and project registry.
        let anchor = RunStore::open(root.as_ref())?;
        let root = fs::canonicalize(root.as_ref())?;
        use std::path::{Component, Prefix};
        if !matches!(root.components().next(),Some(Component::Prefix(p)) if matches!(p.kind(),Prefix::Disk(_)|Prefix::VerbatimDisk(_)))
        {
            return Err(StoreError::invalid(
                "settings root must remain a local disk path",
            ));
        }
        drop(anchor);
        let db = Db::open(&root.join("runs.sqlite3"))?;
        db.execute("PRAGMA foreign_keys=ON", &[])?;
        db.execute("PRAGMA synchronous=FULL", &[])?;
        db.execute("PRAGMA trusted_schema=OFF", &[])?;
        let page_size = db.query("PRAGMA page_size", &[])?[0][0].int()? as u64;
        let limit = crate::local_run_store::StoreOptions::default().max_database_bytes / page_size;
        db.execute(&format!("PRAGMA max_page_count={limit}"), &[])?;
        schema::migrate(&db)?;
        Ok(Self { db, root })
    }
    pub fn schema_version(&self) -> Result<i64> {
        let rows = self.db.query(
            "SELECT version FROM product_settings_schema WHERE singleton=1",
            &[],
        )?;
        rows.first().ok_or_else(StoreError::corrupt)?[0].int()
    }
    fn require_project(&self, project: &str) -> Result<()> {
        id(project)?;
        if self
            .db
            .query("SELECT id FROM projects WHERE id=?", &[project.into()])?
            .is_empty()
        {
            return Err(StoreError::new(
                "notFound",
                "project is not registered in the native record store",
            ));
        }
        Ok(())
    }
    fn require_provider(&self, provider: &str) -> Result<()> {
        id(provider)?;
        if self
            .db
            .query(
                "SELECT provider_id FROM product_provider_profiles WHERE provider_id=?",
                &[provider.into()],
            )?
            .is_empty()
        {
            return Err(StoreError::new(
                "notFound",
                "provider configuration does not exist",
            ));
        }
        Ok(())
    }
    fn validate_preferences(&self, prefs: &UserPreferences) -> Result<()> {
        if let Some(project) = &prefs.active_project_id {
            self.require_project(project)?;
        }
        if let Some(provider) = &prefs.selected_provider_id {
            self.require_provider(provider)?;
        }
        if let Some(provider) = &prefs.default_provider_id {
            self.require_provider(provider)?;
        }
        Ok(())
    }
    fn read_preferences_record(&self) -> Result<Option<VersionedPreferences>> {
        let rows=self.db.query("SELECT revision,CASE WHEN length(CAST(payload AS BLOB))<=262144 THEN payload ELSE NULL END FROM product_user_preferences WHERE singleton=1",&[])?;
        rows.first()
            .map(|row| {
                let revision = row[0].int()?;
                if revision < 1 {
                    return Err(StoreError::corrupt());
                }
                let preferences: UserPreferences = decode(&row[1])?;
                self.validate_preferences(&preferences)
                    .map_err(|_| StoreError::corrupt())?;
                Ok(VersionedPreferences {
                    revision,
                    preferences,
                })
            })
            .transpose()
    }
    fn put_preferences(
        &self,
        revision: i64,
        prefs: &UserPreferences,
    ) -> Result<VersionedPreferences> {
        self.validate_preferences(prefs)?;
        self.db.execute("INSERT INTO product_user_preferences(singleton,revision,payload) VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",&[revision.into(),encode(prefs)?.into()])?;
        Ok(VersionedPreferences {
            revision,
            preferences: prefs.clone(),
        })
    }
    pub fn save_preferences(
        &self,
        expected_revision: i64,
        prefs: &UserPreferences,
    ) -> Result<VersionedPreferences> {
        let next = next_revision(expected_revision)?;
        self.db.transaction(|| {
            let actual = self
                .read_preferences_record()?
                .map(|v| v.revision)
                .unwrap_or(0);
            if actual != expected_revision {
                return Err(StoreError::new(
                    "conflict",
                    "preferences changed; reload before retrying",
                ));
            }
            self.put_preferences(next, prefs)
        })
    }
    /// One-time projection from the existing stores. Never reads arbitrary browser
    /// keys, old chat text, credentials, authority or session state.
    pub fn seed_existing_preferences(
        &self,
        prefs: &UserPreferences,
    ) -> Result<VersionedPreferences> {
        self.db.transaction(|| {
            if self.read_preferences_record()?.is_some() {
                return Err(StoreError::new(
                    "alreadyInitialized",
                    "native preferences already exist; legacy values cannot overwrite them",
                ));
            }
            self.put_preferences(1, prefs)
        })
    }
    fn mutate_preferences(
        &self,
        expected_revision: i64,
        change: impl FnOnce(&mut UserPreferences),
    ) -> Result<VersionedPreferences> {
        let next = next_revision(expected_revision)?;
        self.db.transaction(|| {
            let mut record = self.read_preferences_record()?.ok_or_else(|| {
                StoreError::new(
                    "notInitialized",
                    "seed the existing preference stores explicitly before updates",
                )
            })?;
            if record.revision != expected_revision {
                return Err(StoreError::new(
                    "conflict",
                    "preferences changed; reload before retrying",
                ));
            }
            change(&mut record.preferences);
            self.put_preferences(next, &record.preferences)
        })
    }
    pub fn set_locale(
        &self,
        expected_revision: i64,
        locale: Locale,
    ) -> Result<VersionedPreferences> {
        self.mutate_preferences(expected_revision, |prefs| prefs.locale = locale)
    }
    pub fn set_theme(&self, expected_revision: i64, theme: Theme) -> Result<VersionedPreferences> {
        self.mutate_preferences(expected_revision, |prefs| prefs.theme = theme)
    }
    pub fn select_project(
        &self,
        expected_revision: i64,
        project: Option<String>,
    ) -> Result<VersionedPreferences> {
        self.mutate_preferences(expected_revision, |prefs| prefs.active_project_id = project)
    }
    /// Includes persistent tombstones; an unknown ID has generation=None/revision=0.
    /// A deleted ID must be deliberately recreated using its returned tombstone.
    pub fn provider_version(&self, provider: &str) -> Result<ProviderVersion> {
        self.db
            .transaction(|| self.provider_version_record(provider))
    }
    fn provider_version_record(&self, provider: &str) -> Result<ProviderVersion> {
        id(provider)?;
        let rows = self.db.query(
            "SELECT generation,revision,present FROM product_provider_versions WHERE provider_id=?",
            &[provider.into()],
        )?;
        let profiles = self.db.query(
            "SELECT revision FROM product_provider_profiles WHERE provider_id=?",
            &[provider.into()],
        )?;
        let Some(row) = rows.first() else {
            if !profiles.is_empty() {
                return Err(StoreError::corrupt());
            }
            return Ok(ProviderVersion {
                provider_id: provider.into(),
                generation: None,
                revision: 0,
                exists: false,
            });
        };
        let generation = row[0].text()?;
        let revision = row[1].int()?;
        let present = row[2].int()?;
        if !valid_generation(&generation) || revision < 1 || !(0..=1).contains(&present) {
            return Err(StoreError::corrupt());
        }
        if present == 1 {
            if profiles.len() != 1 || profiles[0][0].int()? != revision {
                return Err(StoreError::corrupt());
            }
        } else if !profiles.is_empty() {
            return Err(StoreError::corrupt());
        }
        Ok(ProviderVersion {
            provider_id: provider.into(),
            generation: Some(generation),
            revision,
            exists: present == 1,
        })
    }
    fn provider_revisions_record(&self) -> Result<Vec<ProviderRevision>> {
        let rows = self.db.query(
            "SELECT provider_id FROM product_provider_profiles ORDER BY provider_id LIMIT 65",
            &[],
        )?;
        if rows.len() > MAX_PROVIDERS {
            return Err(StoreError::corrupt());
        }
        rows.iter()
            .map(|row| self.provider_version_record(&row[0].text()?))
            .collect()
    }
    pub fn provider_revisions(&self) -> Result<Vec<ProviderRevision>> {
        self.db.transaction(|| self.provider_revisions_record())
    }
    fn raw_provider(&self, provider: &str) -> Result<Option<(i64, ProviderConfig)>> {
        self.provider_version_record(provider)?;
        let rows=self.db.query("SELECT revision,CASE WHEN length(CAST(payload AS BLOB))<=262144 THEN payload ELSE NULL END FROM product_provider_profiles WHERE provider_id=?",&[provider.into()])?;
        rows.first()
            .map(|row| {
                let revision = row[0].int()?;
                if revision < 1 {
                    return Err(StoreError::corrupt());
                }
                let config: ProviderConfig = decode(&row[1])?;
                validate_config(&config).map_err(|_| StoreError::corrupt())?;
                if config.provider_id != provider {
                    return Err(StoreError::corrupt());
                }
                Ok((revision, config))
            })
            .transpose()
    }
    fn provider_record(
        &self,
        provider: &str,
        policy: &dyn NativeEndpointPolicy,
    ) -> Result<Option<ProviderSnapshot>> {
        let version = self.provider_version_record(provider)?;
        self.raw_provider(provider)?.map(|(revision,config)|{
            let generation=version.generation.as_deref().ok_or_else(StoreError::corrupt)?;
            let (config,decision)=checked_config(config,policy)?;
            let mut models=Vec::new();
            for model in &config.models {
                let configuration_fingerprint=fingerprint(&config,generation,revision,model,&decision.policy_revision)?;
                let rows=self.db.query("SELECT configuration_fingerprint,observed_at,CASE WHEN length(CAST(payload AS BLOB))<=262144 THEN payload ELSE NULL END FROM product_capability_evidence WHERE provider_id=? AND model_id=?",&[provider.into(),model.id.as_str().into()])?;
                let evidence=if let Some(row)=rows.first(){
                    if row[0].text()?!=configuration_fingerprint {None}else{
                        let value:CapabilityEvidence=decode(&row[2])?;
                        if value.provider_generation!=generation || value.configuration_fingerprint!=configuration_fingerprint || value.observed_at<0 || value.observed_at!=row[1].int()? {return Err(StoreError::corrupt());}
                        Some(value)
                    }
                }else{None};
                models.push(ModelStatus {model_id:model.id.clone(),configuration_fingerprint,declarations:model.capability_declarations.clone(),historical_evidence:evidence,currently_verified:false});
            }
            Ok(ProviderSnapshot {generation:generation.into(),revision,config,transport_supported:decision.transport_supported,models,connection_verified:false,requires_new_session:true})
        }).transpose()
    }
    pub fn providers(&self, policy: &dyn NativeEndpointPolicy) -> Result<Vec<ProviderSnapshot>> {
        self.db.transaction(|| {
            self.provider_revisions_record()?
                .into_iter()
                .map(|entry| {
                    self.provider_record(&entry.provider_id, policy)?
                        .ok_or_else(|| StoreError::new("conflict", "provider list changed; reload"))
                })
                .collect()
        })
    }
    pub fn save_provider(
        &self,
        expected: &ProviderVersion,
        config: &ProviderConfig,
        policy: &dyn NativeEndpointPolicy,
    ) -> Result<ProviderSnapshot> {
        let next = next_revision(expected.revision)?;
        self.db.transaction(||{
            let (config,_)=checked_config(config.clone(),policy)?;
            let current=self.provider_version_record(&config.provider_id)?;
            if expected!=&current {return Err(StoreError::new("conflict","provider identity or revision changed; reload and reconcile before retrying"));}
            if !current.exists && self.provider_revisions_record()?.len()>=MAX_PROVIDERS {return Err(StoreError::new("capacity","maximum of 64 providers reached"));}
            let generation=if current.exists {
                current.generation.ok_or_else(StoreError::corrupt)?
            } else {new_provider_generation()?};
            self.db.execute("INSERT INTO product_provider_versions(provider_id,generation,revision,present) VALUES(?,?,?,1) ON CONFLICT(provider_id) DO UPDATE SET generation=excluded.generation,revision=excluded.revision,present=1",&[config.provider_id.as_str().into(),generation.as_str().into(),next.into()])?;
            self.db.execute("INSERT INTO product_provider_profiles(provider_id,revision,payload) VALUES(?,?,?) ON CONFLICT(provider_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",&[config.provider_id.as_str().into(),next.into(),encode(&config)?.into()])?;
            // Match existing UI behavior: every explicit provider edit resets tests.
            self.db.execute("DELETE FROM product_capability_evidence WHERE provider_id=?",&[config.provider_id.as_str().into()])?;
            self.reconcile_model_selections(&config)?;
            self.provider_record(&config.provider_id,policy)?.ok_or_else(StoreError::corrupt)
        })
    }
    pub fn record_native_observation(
        &self,
        value: &NativeObservation,
        policy: &dyn NativeEndpointPolicy,
    ) -> Result<CapabilityEvidence> {
        if value.observed_at < 0 {
            return Err(StoreError::invalid("observation time must be nonnegative"));
        }
        self.db.transaction(||{
            let profile=self.provider_record(&value.provider_id,policy)?.ok_or_else(||StoreError::new("notFound","provider does not exist"))?;
            if !profile.transport_supported {return Err(StoreError::new("transportUnavailable","current native transport does not support this configuration"));}
            let model=profile.models.iter().find(|m|m.model_id==value.model_id).ok_or_else(||StoreError::new("notFound","model does not belong to provider"))?;
            if profile.generation!=value.provider_generation || model.configuration_fingerprint!=value.configuration_fingerprint {return Err(StoreError::new("conflict","provider generation, configuration or native policy changed; discard the stale observation"));}
            let evidence=CapabilityEvidence {provider_generation:value.provider_generation.clone(),configuration_fingerprint:value.configuration_fingerprint.clone(),observed_at:value.observed_at,text_supported:value.text_supported,tools_supported:value.tools_supported,streaming_supported:value.streaming_supported};
            self.db.execute("INSERT INTO product_capability_evidence(provider_id,model_id,configuration_fingerprint,observed_at,payload) VALUES(?,?,?,?,?) ON CONFLICT(provider_id,model_id) DO UPDATE SET configuration_fingerprint=excluded.configuration_fingerprint,observed_at=excluded.observed_at,payload=excluded.payload",&[value.provider_id.as_str().into(),value.model_id.as_str().into(),value.configuration_fingerprint.as_str().into(),value.observed_at.into(),encode(&evidence)?.into()])?;
            Ok(evidence)
        })
    }
    fn validate_project_preferences(&self, prefs: &ProjectPreferences) -> Result<()> {
        if let Some(provider) = &prefs.provider_id {
            let (_, config) = self
                .raw_provider(provider)?
                .ok_or_else(|| StoreError::new("notFound", "project provider does not exist"))?;
            if let Some(model) = &prefs.model_id {
                let selected = config
                    .models
                    .iter()
                    .find(|m| &m.id == model)
                    .ok_or_else(|| {
                        StoreError::invalid("project model does not belong to provider")
                    })?;
                if prefs
                    .reasoning_effort
                    .is_some_and(|effort| !supports_effort(selected, effort))
                {
                    return Err(StoreError::invalid(
                        "project reasoning effort is not declared by model",
                    ));
                }
            } else if prefs.reasoning_effort.is_some() {
                return Err(StoreError::invalid("reasoning requires a model selection"));
            }
        } else if prefs.model_id.is_some() || prefs.reasoning_effort.is_some() {
            return Err(StoreError::invalid("model selection requires a provider"));
        }
        Ok(())
    }
    fn project_rows(&self) -> Result<Vec<(String, i64, ProjectPreferences)>> {
        self.db.query("SELECT project_id,revision,CASE WHEN length(CAST(payload AS BLOB))<=262144 THEN payload ELSE NULL END FROM product_project_preferences ORDER BY project_id",&[])?.iter().map(|row|{
            let project=row[0].text()?;let revision=row[1].int()?;
            let prefs=decode(&row[2])?;if revision<1 {return Err(StoreError::corrupt());}
            Ok((project,revision,prefs))
        }).collect()
    }
    fn project_preferences_record(
        &self,
        project: &str,
    ) -> Result<Option<VersionedProjectPreferences>> {
        self.require_project(project)?;
        let rows=self.db.query("SELECT revision,CASE WHEN length(CAST(payload AS BLOB))<=262144 THEN payload ELSE NULL END FROM product_project_preferences WHERE project_id=?",&[project.into()])?;
        rows.first()
            .map(|row| {
                let revision = row[0].int()?;
                if revision < 1 {
                    return Err(StoreError::corrupt());
                }
                let preferences = decode(&row[1])?;
                self.validate_project_preferences(&preferences)
                    .map_err(|_| StoreError::corrupt())?;
                Ok(VersionedProjectPreferences {
                    project_id: project.into(),
                    revision,
                    preferences,
                    requires_fresh_project_trust: true,
                })
            })
            .transpose()
    }
    fn put_project_preferences(
        &self,
        project: &str,
        revision: i64,
        prefs: &ProjectPreferences,
    ) -> Result<VersionedProjectPreferences> {
        self.require_project(project)?;
        self.validate_project_preferences(prefs)?;
        self.db.execute("INSERT INTO product_project_preferences(project_id,revision,payload) VALUES(?,?,?) ON CONFLICT(project_id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload",&[project.into(),revision.into(),encode(prefs)?.into()])?;
        Ok(VersionedProjectPreferences {
            project_id: project.into(),
            revision,
            preferences: prefs.clone(),
            requires_fresh_project_trust: true,
        })
    }
    pub fn save_project_preferences(
        &self,
        project: &str,
        expected_revision: i64,
        prefs: &ProjectPreferences,
    ) -> Result<VersionedProjectPreferences> {
        let next = next_revision(expected_revision)?;
        self.db.transaction(|| {
            let actual = self
                .project_preferences_record(project)?
                .map(|v| v.revision)
                .unwrap_or(0);
            if actual != expected_revision {
                return Err(StoreError::new(
                    "conflict",
                    "project settings changed; reload before retrying",
                ));
            }
            self.put_project_preferences(project, next, prefs)
        })
    }
    fn reconcile_model_selections(&self, config: &ProviderConfig) -> Result<()> {
        for (project, revision, mut prefs) in self.project_rows()? {
            if prefs.provider_id.as_ref() != Some(&config.provider_id) {
                continue;
            }
            let before = prefs.clone();
            if let Some(id) = &prefs.model_id {
                if let Some(model) = config.models.iter().find(|m| &m.id == id) {
                    if prefs
                        .reasoning_effort
                        .is_some_and(|effort| !supports_effort(model, effort))
                    {
                        prefs.reasoning_effort = None;
                    }
                } else {
                    prefs.model_id = None;
                    prefs.reasoning_effort = None;
                }
            }
            if prefs != before {
                self.put_project_preferences(&project, next_revision(revision)?, &prefs)?;
            }
        }
        Ok(())
    }
    pub fn delete_provider(&self, expected: &ProviderVersion) -> Result<ProviderVersion> {
        self.db.transaction(|| {
            let provider = expected.provider_id.as_str();
            let current = self.provider_version_record(provider)?;
            if expected != &current || !current.exists {
                return Err(StoreError::new(
                    "conflict",
                    "provider identity or revision changed",
                ));
            }
            let next = next_revision(current.revision)?;
            if let Some(mut record) = self.read_preferences_record()? {
                let before = record.preferences.clone();
                if record.preferences.selected_provider_id.as_deref() == Some(provider) {
                    record.preferences.selected_provider_id = None;
                }
                if record.preferences.default_provider_id.as_deref() == Some(provider) {
                    record.preferences.default_provider_id = None;
                }
                if record.preferences != before {
                    self.put_preferences(next_revision(record.revision)?, &record.preferences)?;
                }
            }
            for (project, revision, prefs) in self.project_rows()? {
                if prefs.provider_id.as_deref() == Some(provider) {
                    self.put_project_preferences(
                        &project,
                        next_revision(revision)?,
                        &ProjectPreferences {
                            provider_id: None,
                            model_id: None,
                            reasoning_effort: None,
                        },
                    )?;
                }
            }
            self.db.execute(
                "DELETE FROM product_provider_profiles WHERE provider_id=?",
                &[provider.into()],
            )?;
            self.db.execute(
                "UPDATE product_provider_versions SET revision=?,present=0 WHERE provider_id=?",
                &[next.into(), provider.into()],
            )?;
            Ok(ProviderVersion {
                revision: next,
                exists: false,
                ..current
            })
        })
    }
    pub fn backup(&self, destination: impl AsRef<Path>) -> Result<()> {
        backup_for_recovery(&self.root, destination)
    }
}
/// Preserves the shared database even when settings schema/data cannot be opened.
/// Fully corrupt SQLite files need offline preservation; this never resets them.
pub fn backup_for_recovery(root: impl AsRef<Path>, destination: impl AsRef<Path>) -> Result<()> {
    RunStore::open(root)?.backup(destination)?;
    Ok(())
}
#[cfg(test)]
#[path = "../../tests/product_settings_store_tests.rs"]
mod tests;
