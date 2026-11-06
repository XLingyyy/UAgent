//! Product settings IPC. Storage runs on blocking workers and shares T06 projects.
//! Registering metadata never grants project trust or a live provider session.
#![cfg(windows)]
use crate::local_run_store::{Project, RunStore};
use crate::product_settings_store::{
    AuthMode, CapabilityDeclarations, Locale, NativeEndpointPolicy, ProductSettingsStore,
    ProjectPreferences, ProviderConfig, ProviderModel, ProviderSnapshot, ProviderVersion,
    RequestDefaults, Result, StoreError, Theme, UserPreferences, VersionedPreferences,
    VersionedProjectPreferences, WireApi,
};
use crate::provider_endpoint_policy::{NativeEndpointDecision, NATIVE_ENDPOINT_POLICY};
use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf, Prefix};
use std::sync::Mutex;

static COMMAND_LOCK: Mutex<()> = Mutex::new(());

macro_rules! input {
    ($name:ident { $($field:ident: $ty:ty),* $(,)? }) => {
        #[derive(Debug, Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        pub(crate) struct $name { $(pub $field: $ty),* }
    };
}
input!(InitializeInput {
    legacy_locale: Locale
});
input!(SavePreferencesInput {
    expected_revision: i64,
    preferences: UserPreferences
});
input!(SaveProviderInput {
    version: ProviderVersion,
    config: ProviderConfig
});
input!(DeleteProviderInput {
    version: ProviderVersion
});
input!(ProviderVersionInput {
    provider_id: String
});
input!(RegisterProjectInput { root_ref: String });
input!(SaveProjectPreferencesInput {
    project_id: String,
    expected_revision: i64,
    preferences: ProjectPreferences
});
input!(CheckEndpointInput {
    wire_api: WireApi,
    base_url: String
});

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SettingsSnapshot {
    pub preferences: VersionedPreferences,
    pub providers: Vec<ProviderSnapshot>,
    pub projects: Vec<Project>,
    pub project_preferences: Vec<VersionedProjectPreferences>,
}
fn error(kind: &str, message: &str) -> StoreError {
    StoreError {
        kind: kind.into(),
        message: message.into(),
    }
}
fn app_data_root(app: &tauri::AppHandle) -> Result<PathBuf> {
    crate::app_profile::resolve_app_data_dir(app).map_err(|_| {
        error(
            "unavailable",
            "native application data directory is unavailable",
        )
    })
}
async fn worker<T, F>(work: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = COMMAND_LOCK
            .lock()
            .map_err(|_| error("unavailable", "native settings worker is unavailable"))?;
        work()
    })
    .await
    .map_err(|_| error("unavailable", "native settings worker did not complete"))?
}
fn settings_root(app_data: &Path) -> PathBuf {
    app_data.join("run-store-v2")
}
fn snapshot_at(app_data: &Path) -> Result<SettingsSnapshot> {
    let root = settings_root(app_data);
    let store = ProductSettingsStore::open(&root)?;
    let preferences = store.read_preferences()?.ok_or_else(|| {
        error(
            "notInitialized",
            "initialize native preferences before reading settings",
        )
    })?;
    let providers = store.providers(&NATIVE_ENDPOINT_POLICY)?;
    let projects = RunStore::open(&root)?.projects()?;
    let mut project_preferences = Vec::new();
    for project in &projects {
        if let Some(preferences) = store.project_preferences(&project.id)? {
            project_preferences.push(preferences);
        }
    }
    Ok(SettingsSnapshot {
        preferences,
        providers,
        projects,
        project_preferences,
    })
}
fn timestamp() -> Result<i64> {
    let value = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| error("unavailable", "native clock is unavailable"))?
        .as_millis();
    i64::try_from(value).map_err(|_| error("unavailable", "native clock is unavailable"))
}
fn project_descriptor(root_ref: &str, require_existing: bool) -> Result<Project> {
    if root_ref.is_empty() || root_ref.len() > 1024 || root_ref.chars().any(char::is_control) {
        return Err(error("invalidSettings", "project root is invalid"));
    }
    let normalized = crate::normalize_project_path(root_ref);
    let path = Path::new(&normalized);
    if !path.is_absolute()
        || !matches!(path.components().next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)))
        || !path
            .components()
            .any(|part| matches!(part, Component::Normal(_)))
    {
        return Err(error(
            "invalidSettings",
            "project root must be an absolute local directory below a drive root",
        ));
    }
    let canonical = match std::fs::canonicalize(path) {
        Ok(canonical) => {
            if !std::fs::metadata(&canonical)
                .map_err(|_| error("unavailable", "project directory is unavailable"))?
                .is_dir()
                || !matches!(canonical.components().next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_)))
            {
                return Err(error(
                    "invalidSettings",
                    "project root must be a local directory",
                ));
            }
            canonical
        }
        Err(reason) if !require_existing && reason.kind() == std::io::ErrorKind::NotFound => {
            // Preserve an offline legacy descriptor; execution still requires a
            // fresh native trust binding. No directory is created at this root.
            PathBuf::from(format!("\\\\?\\{}", normalized.replace('/', "\\")))
        }
        Err(_) => {
            return Err(error(
                "unavailable",
                "project directory is unavailable; no trust was granted",
            ))
        }
    };
    let root = canonical
        .to_str()
        .ok_or_else(|| error("invalidSettings", "project path cannot be represented"))?
        .to_string();
    let label = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .chars()
        .take(200)
        .collect();
    Ok(Project {
        id: crate::hash_path(&normalized),
        root,
        label,
        created_at: timestamp()?,
    })
}
fn register_descriptor(store: &RunStore, project: Project) -> Result<Project> {
    let find = || -> Result<Option<Project>> {
        Ok(store
            .projects()?
            .into_iter()
            .find(|saved| saved.id == project.id))
    };
    let existing = match find()? {
        Some(existing) => existing,
        None => {
            if let Err(reason) = store.create_project(&project) {
                if reason.kind != "constraint" {
                    return Err(reason.into());
                }
            }
            find()?.ok_or_else(|| error("conflict", "project registration changed; reload"))?
        }
    };
    if existing.root != project.root {
        return Err(error(
            "projectBindingMismatch",
            "registered project identity is bound to a different root",
        ));
    }
    Ok(existing)
}
fn register_at(app_data: &Path, root_ref: &str) -> Result<Project> {
    let project = project_descriptor(root_ref, true)?;
    register_descriptor(&RunStore::open(settings_root(app_data))?, project)
}
fn legacy_deepseek() -> ProviderConfig {
    ProviderConfig {
        provider_id: "deepseek".into(),
        display_name: "DeepSeek Flash".into(),
        base_url: "https://api.deepseek.com".into(),
        wire_api: WireApi::OpenaiCompatible,
        auth_mode: AuthMode::EnvKey,
        models: vec![ProviderModel {
            id: "deepseek-flash".into(),
            label: "DeepSeek Flash".into(),
            context_window: 1_000_000,
            supports_reasoning: false,
            reasoning_efforts: None,
            capability_declarations: CapabilityDeclarations::default(),
            request_defaults: RequestDefaults::default(),
        }],
        default_model: Some("deepseek-flash".into()),
        default_reasoning_effort: None,
        enabled: true,
    }
}
fn initialize_at(app_data: &Path, locale: Locale) -> Result<SettingsSnapshot> {
    initialize_with_projection(app_data, locale, || {
        crate::local_workspace::read_preferences_projection(app_data)
            .map_err(|_| error("legacyPreferencesUnavailable", "legacy workspace preferences are invalid or unavailable; source data was not changed"))
    })
}
fn initialize_with_projection(
    app_data: &Path,
    locale: Locale,
    read_projection: impl FnOnce() -> Result<Option<crate::local_workspace::PreferenceProjection>>,
) -> Result<SettingsSnapshot> {
    let root = settings_root(app_data);
    let store = ProductSettingsStore::open(&root)?;
    if store.read_preferences()?.is_some() {
        return snapshot_at(app_data);
    }
    let mut preferences = UserPreferences {
        locale,
        ..UserPreferences::default()
    };
    if let Some(legacy) = read_projection()? {
        preferences.theme = match legacy.theme.as_str() {
            "dark" => Theme::Dark,
            "light" => Theme::Light,
            _ => {
                return Err(error(
                    "legacyPreferencesUnavailable",
                    "legacy theme is invalid",
                ))
            }
        };
        let descriptors = legacy
            .project_roots
            .iter()
            .map(|root| project_descriptor(root, false))
            .collect::<Result<Vec<_>>>()?;
        let projects = RunStore::open(&root)?;
        for project in descriptors {
            register_descriptor(&projects, project)?;
        }
        preferences.active_project_id = legacy
            .selected_project_root
            .as_ref()
            .map(|root| crate::hash_path(&crate::normalize_project_path(root)));
        if legacy.deepseek_configured {
            let version = store.provider_version("deepseek")?;
            // A deliberate tombstone must never be revived from legacy state.
            if !version.exists && version.generation.is_none() && version.revision == 0 {
                store.save_provider(&version, &legacy_deepseek(), &NATIVE_ENDPOINT_POLICY)?;
            }
            if let Some(provider) = store.provider("deepseek", &NATIVE_ENDPOINT_POLICY)? {
                preferences.selected_provider_id = Some("deepseek".into());
                preferences.default_provider_id = Some("deepseek".into());
                if let (Some(project_id), Some(default_model)) = (
                    preferences.active_project_id.as_deref(),
                    provider.config.default_model.as_deref(),
                ) {
                    if provider.config.enabled
                        && provider
                            .config
                            .models
                            .iter()
                            .any(|model| model.id == default_model)
                        && store.project_preferences(project_id)?.is_none()
                    {
                        store.save_project_preferences(
                            project_id,
                            0,
                            &ProjectPreferences {
                                provider_id: Some(provider.config.provider_id.clone()),
                                model_id: Some(default_model.into()),
                                reasoning_effort: None,
                            },
                        )?;
                    }
                }
            }
        }
    }
    match store.seed_existing_preferences(&preferences) {
        Ok(_) => {}
        Err(reason) if reason.kind == "alreadyInitialized" => {} // Another initializer won; never overwrite it.
        Err(reason) => return Err(reason),
    }
    snapshot_at(app_data)
}

#[tauri::command]
pub(crate) async fn initialize_product_settings(
    app: tauri::AppHandle,
    input: InitializeInput,
) -> Result<SettingsSnapshot> {
    worker(move || initialize_at(&app_data_root(&app)?, input.legacy_locale)).await
}
#[tauri::command]
pub(crate) async fn read_product_settings(app: tauri::AppHandle) -> Result<SettingsSnapshot> {
    worker(move || snapshot_at(&app_data_root(&app)?)).await
}
#[tauri::command]
pub(crate) async fn save_product_preferences(
    app: tauri::AppHandle,
    input: SavePreferencesInput,
) -> Result<VersionedPreferences> {
    worker(move || {
        ProductSettingsStore::open(settings_root(&app_data_root(&app)?))?
            .save_preferences(input.expected_revision, &input.preferences)
    })
    .await
}
pub(crate) fn active_api(config:&crate::product_settings_store::ProviderConfig)->bool {
 config.provider_id=="deepseek" && matches!(config.wire_api,crate::product_settings_store::WireApi::ChatCompletions|crate::product_settings_store::WireApi::OpenaiCompatible) && ["https://api.deepseek.com","https://api.deepseek.com/"].contains(&config.base_url.as_str()) && config.auth_mode==crate::product_settings_store::AuthMode::EnvKey
}
#[tauri::command]
pub(crate) async fn save_product_provider(
    app: tauri::AppHandle,
    input: SaveProviderInput,
) -> Result<ProviderSnapshot> {
    worker(move || {
        if !active_api(&input.config){return Err(error("providerArchived","Only DeepSeek API configuration is active; archived records are retained"));}

        let _deepseek_update=crate::native_saved_deepseek::begin_provider_update(&input.config.provider_id).map_err(|_|error("unavailable","native provider revocation is unavailable"))?;
        let _provider_update=crate::native_responses_commands::begin_provider_update(&input.config.provider_id)
            .map_err(|_| error("unavailable","native provider session invalidation failed"))?;
        ProductSettingsStore::open(settings_root(&app_data_root(&app)?))?.save_provider(
            &input.version,
            &input.config,
            &NATIVE_ENDPOINT_POLICY,
        )
    })
    .await
}
#[tauri::command]
pub(crate) async fn delete_product_provider(
    app: tauri::AppHandle,
    input: DeleteProviderInput,
) -> Result<ProviderVersion> {
    worker(move || {
        let _deepseek_update=crate::native_saved_deepseek::begin_provider_update(&input.version.provider_id).map_err(|_|error("unavailable","native provider revocation is unavailable"))?;
        let _provider_update=crate::native_responses_commands::begin_provider_update(&input.version.provider_id)
            .map_err(|_| error("unavailable","native provider session invalidation failed"))?;
        ProductSettingsStore::open(settings_root(&app_data_root(&app)?))?
            .delete_provider(&input.version)
    })
    .await
}
#[tauri::command]
pub(crate) async fn get_product_provider_version(
    app: tauri::AppHandle,
    input: ProviderVersionInput,
) -> Result<ProviderVersion> {
    worker(move || {
        ProductSettingsStore::open(settings_root(&app_data_root(&app)?))?
            .provider_version(&input.provider_id)
    })
    .await
}
#[tauri::command]
pub(crate) async fn register_product_project(
    app: tauri::AppHandle,
    input: RegisterProjectInput,
) -> Result<Project> {
    worker(move || register_at(&app_data_root(&app)?, &input.root_ref)).await
}
#[tauri::command]
pub(crate) async fn save_product_project_preferences(
    app: tauri::AppHandle,
    input: SaveProjectPreferencesInput,
) -> Result<VersionedProjectPreferences> {
    worker(move || {
        ProductSettingsStore::open(settings_root(&app_data_root(&app)?))?.save_project_preferences(
            &input.project_id,
            input.expected_revision,
            &input.preferences,
        )
    })
    .await
}
#[tauri::command]
pub(crate) async fn check_native_provider_endpoint(
    input: CheckEndpointInput,
) -> Result<NativeEndpointDecision> {
    worker(move || {
        NATIVE_ENDPOINT_POLICY
            .validate_endpoint(input.wire_api, &input.base_url)
            .map(Into::into)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};
    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "uagent-settings-commands-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        assert!(
            matches!(root.components().next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(b'E' | b'G') | Prefix::VerbatimDisk(b'E' | b'G')))
        );
        std::fs::create_dir(&root).unwrap();
        root
    }
    fn legacy_fixture(base: &Path, project: &Path) -> Vec<u8> {
        let root_ref = project.to_str().unwrap();
        let data: crate::local_workspace::VersionedWorkspace = serde_json::from_value(serde_json::json!({
            "revision": 1, "workspace": {"schemaVersion":1,"theme":"light","projectRoots":[root_ref],"selectedProjectRoot":root_ref,"deepseekConfigured":true,
            "chats":[{"id":"synthetic-chat","title":"Not migrated","projectLabel":"Synthetic","createdAt":1,"archived":false,"messages":[{"role":"user","text":"Synthetic chat remains only in legacy source"}]}]}
        })).unwrap();
        let previous = "0".repeat(64);
        let checksum = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&(&previous, &data)).unwrap())
        );
        let mut bytes = serde_json::to_vec(
            &serde_json::json!({"previous":previous,"data":data,"checksum":checksum}),
        )
        .unwrap();
        bytes.push(b'\n');
        std::fs::create_dir(base.join("workspace-v1")).unwrap();
        std::fs::write(base.join("workspace-v1/workspace.jsonl"), &bytes).unwrap();
        bytes
    }
    #[test]
    fn migration_seeds_only_missing_active_project_model_from_the_valid_provider_default() {
        for mode in ["new", "existing", "missingDefault", "existingProject"] {
            let base = fixture();
            let active_root = base.join("ActiveProject");
            let other_root = base.join("OtherProject");
            std::fs::create_dir(&active_root).unwrap();
            std::fs::create_dir(&other_root).unwrap();
            let active = register_at(&base, active_root.to_str().unwrap()).unwrap();
            let other = register_at(&base, other_root.to_str().unwrap()).unwrap();
            let original = legacy_fixture(&base, &active_root);
            let store = ProductSettingsStore::open(settings_root(&base)).unwrap();
            if mode != "new" {
                let mut config = legacy_deepseek();
                let mut alternative = config.models[0].clone();
                alternative.id = "existing-default".into();
                alternative.label = "Existing default".into();
                config.models.push(alternative);
                config.default_model = if mode == "missingDefault" {
                    None
                } else {
                    Some("existing-default".into())
                };
                store
                    .save_provider(
                        &store.provider_version("deepseek").unwrap(),
                        &config,
                        &NATIVE_ENDPOINT_POLICY,
                    )
                    .unwrap();
                if mode == "existingProject" {
                    store
                        .save_project_preferences(
                            &active.id,
                            0,
                            &ProjectPreferences {
                                provider_id: Some("deepseek".into()),
                                model_id: Some("deepseek-flash".into()),
                                reasoning_effort: None,
                            },
                        )
                        .unwrap();
                }
            }
            let snapshot = initialize_at(&base, Locale::En).unwrap();
            let active_preferences = store.project_preferences(&active.id).unwrap();
            if mode == "missingDefault" {
                assert!(active_preferences.is_none());
                assert!(snapshot.project_preferences.is_empty());
            } else {
                let saved = active_preferences.unwrap();
                assert_eq!(saved.revision, 1);
                assert_eq!(saved.preferences.provider_id.as_deref(), Some("deepseek"));
                assert_eq!(
                    saved.preferences.model_id.as_deref(),
                    Some(if mode == "existing" {
                        "existing-default"
                    } else {
                        "deepseek-flash"
                    })
                );
                assert_eq!(snapshot.project_preferences, vec![saved.clone()]);
                let repeated = initialize_with_projection(&base, Locale::ZhCn, || {
                    panic!("initialized settings must skip legacy projection")
                })
                .unwrap();
                assert_eq!(repeated.project_preferences, vec![saved]);
            }
            assert!(store.project_preferences(&other.id).unwrap().is_none());
            assert!(!snapshot.providers[0].connection_verified);
            assert_eq!(
                std::fs::read(base.join("workspace-v1/workspace.jsonl")).unwrap(),
                original
            );
        }
    }
    #[test]
    fn commands_dtos_reject_credentials_network_mode_and_forged_verification() {
        let config = serde_json::to_value(legacy_deepseek()).unwrap();
        let version = serde_json::json!({"providerId":"deepseek","generation":null,"revision":0,"exists":false});
        let valid = serde_json::json!({"version":version,"config":config});
        assert!(serde_json::from_value::<SaveProviderInput>(valid.clone()).is_ok());
        for field in [
            "secret",
            "apiKey",
            "networkMode",
            "verification",
            "connectionVerified",
            "transportSupported",
        ] {
            let mut input = valid.clone();
            input["config"][field] = "synthetic".into();
            assert!(
                serde_json::from_value::<SaveProviderInput>(input).is_err(),
                "{field}"
            );
        }
        let mut input = valid.clone();
        input["version"]["verified"] = true.into();
        assert!(serde_json::from_value::<SaveProviderInput>(input).is_err());
        assert!(serde_json::from_value::<InitializeInput>(
            serde_json::json!({"legacyLocale":"en","theme":"light"})
        )
        .is_err());
        assert!(serde_json::from_value::<InitializeInput>(
            serde_json::json!({"legacyLocale":"fr"})
        )
        .is_err());
        assert!(serde_json::from_value::<CheckEndpointInput>(serde_json::json!({"wireApi":"chat_completions","baseUrl":"https://api.deepseek.com","allow":true})).is_err());
        assert!(serde_json::from_value::<RegisterProjectInput>(
            serde_json::json!({"rootRef":"G:/Synthetic","trusted":true})
        )
        .is_err());
        assert!(serde_json::from_value::<SaveProjectPreferencesInput>(serde_json::json!({"projectId":"p","expectedRevision":0,"preferences":{"providerId":null,"modelId":null,"reasoningEffort":null,"trusted":true}})).is_err());
    }
    #[test]
    fn migration_projects_nonsecret_preferences_and_preserves_original_jsonl() {
        let base = fixture();
        let project = base.join("SyntheticProject");
        std::fs::create_dir(&project).unwrap();
        let bytes = legacy_fixture(&base, &project);
        let snapshot = initialize_at(&base, Locale::En).unwrap();
        assert_eq!(snapshot.preferences.preferences.theme, Theme::Light);
        assert_eq!(snapshot.preferences.preferences.locale, Locale::En);
        let project_id =
            crate::hash_path(&crate::normalize_project_path(project.to_str().unwrap()));
        assert_eq!(
            snapshot
                .preferences
                .preferences
                .active_project_id
                .as_deref(),
            Some(project_id.as_str())
        );
        assert_eq!(snapshot.projects[0].id, project_id);
        assert_eq!(
            snapshot.projects[0].root,
            std::fs::canonicalize(&project).unwrap().to_str().unwrap()
        );
        assert_eq!(snapshot.providers[0].config.provider_id, "deepseek");
        assert!(!snapshot.providers[0].connection_verified);
        assert!(snapshot.providers[0].transport_supported);
        let json = serde_json::to_string(&snapshot).unwrap();
        assert!(
            !json.contains("Not migrated")
                && !json.contains("networkMode")
                && !json.contains("apiKey")
        );
        assert_eq!(
            std::fs::read(base.join("workspace-v1/workspace.jsonl")).unwrap(),
            bytes
        );
        // Existing native state must neither inspect legacy bytes nor apply a new locale.
        std::fs::write(
            base.join("workspace-v1/workspace.jsonl"),
            "invalid legacy fixture after migration",
        )
        .unwrap();
        let existing = initialize_with_projection(&base, Locale::ZhCn, || {
            panic!("must not read legacy once initialized")
        })
        .unwrap();
        assert_eq!(existing.preferences, snapshot.preferences);
    }
    #[test]
    fn migration_preserves_offline_project_descriptor_without_creating_project_files() {
        let base = fixture();
        let missing = base.join("OfflineProject");
        legacy_fixture(&base, &missing);
        let snapshot = initialize_at(&base, Locale::ZhCn).unwrap();
        assert_eq!(snapshot.projects.len(), 1);
        assert!(!missing.exists());
        assert_eq!(
            snapshot.projects[0].id,
            crate::hash_path(&crate::normalize_project_path(missing.to_str().unwrap()))
        );
        assert!(register_at(&base, missing.to_str().unwrap()).is_err());
    }
    #[test]
    fn provider_versions_are_not_refreshed_and_tombstones_are_not_replayed() {
        let base = fixture();
        initialize_at(&base, Locale::En).unwrap();
        let store = ProductSettingsStore::open(settings_root(&base)).unwrap();
        let initial = store.provider_version("deepseek").unwrap();
        let created = store
            .save_provider(&initial, &legacy_deepseek(), &NATIVE_ENDPOINT_POLICY)
            .unwrap();
        assert_eq!(
            store
                .save_provider(&initial, &legacy_deepseek(), &NATIVE_ENDPOINT_POLICY)
                .unwrap_err()
                .kind,
            "conflict"
        );
        let tombstone = store.delete_provider(&created.version()).unwrap();
        assert!(!tombstone.exists);
        assert_eq!(
            store
                .save_provider(
                    &created.version(),
                    &legacy_deepseek(),
                    &NATIVE_ENDPOINT_POLICY
                )
                .unwrap_err()
                .kind,
            "conflict"
        );
        assert_eq!(
            store.delete_provider(&created.version()).unwrap_err().kind,
            "conflict"
        );
        let recreated = store
            .save_provider(&tombstone, &legacy_deepseek(), &NATIVE_ENDPOINT_POLICY)
            .unwrap();
        assert_ne!(created.generation, recreated.generation);
        assert!(!recreated.connection_verified);
    }
    #[test]
    fn read_and_write_use_the_same_nondefault_native_endpoint_policy() {
        let base = fixture();
        initialize_at(&base, Locale::En).unwrap();
        let store = ProductSettingsStore::open(settings_root(&base)).unwrap();
        let version = store.provider_version("deepseek").unwrap();
        let mut config = legacy_deepseek();
        config.base_url = "https://configured.invalid/v1".into();
        assert!(
            !store
                .save_provider(&version, &config, &NATIVE_ENDPOINT_POLICY)
                .unwrap()
                .transport_supported
        );
        assert!(!snapshot_at(&base).unwrap().providers[0].transport_supported);
        config.base_url = "http://remote.invalid".into();
        let version = store.provider_version("deepseek").unwrap();
        assert_eq!(
            store
                .save_provider(&version, &config, &NATIVE_ENDPOINT_POLICY)
                .unwrap_err()
                .kind,
            "endpointPolicy"
        );
        assert_eq!(store.provider_version("deepseek").unwrap(), version);
    }
    #[test]
    fn register_uses_native_identity_and_rejects_rebinding_without_granting_trust() {
        let base = fixture();
        let root = base.join("project");
        std::fs::create_dir(&root).unwrap();
        let registered = register_at(&base, root.to_str().unwrap()).unwrap();
        assert_eq!(
            registered.id,
            crate::hash_path(&crate::normalize_project_path(root.to_str().unwrap()))
        );
        assert_eq!(
            register_at(&base, root.to_str().unwrap()).unwrap(),
            registered
        );
        let mut conflicting = registered.clone();
        conflicting.root.push_str("-different");
        assert_eq!(
            register_descriptor(&RunStore::open(settings_root(&base)).unwrap(), conflicting)
                .unwrap_err()
                .kind,
            "projectBindingMismatch"
        );
    }
    #[test]
    fn stale_preferences_are_rejected_and_legacy_does_not_revive_deleted_provider() {
        let base = fixture();
        let root = base.join("project");
        std::fs::create_dir(&root).unwrap();
        legacy_fixture(&base, &root);
        let store = ProductSettingsStore::open(settings_root(&base)).unwrap();
        let config = legacy_deepseek();
        let initial = store.provider_version("deepseek").unwrap();
        let created = store
            .save_provider(&initial, &config, &NATIVE_ENDPOINT_POLICY)
            .unwrap();
        let tombstone = store.delete_provider(&created.version()).unwrap();
        let snapshot = initialize_at(&base, Locale::En).unwrap();
        assert!(snapshot.providers.is_empty());
        assert!(snapshot
            .preferences
            .preferences
            .selected_provider_id
            .is_none());
        assert_eq!(store.provider_version("deepseek").unwrap(), tombstone);
        let mut changed = snapshot.preferences.preferences.clone();
        changed.theme = Theme::Dark;
        store
            .save_preferences(snapshot.preferences.revision, &changed)
            .unwrap();
        assert_eq!(
            store
                .save_preferences(
                    snapshot.preferences.revision,
                    &snapshot.preferences.preferences
                )
                .unwrap_err()
                .kind,
            "conflict"
        );
    }
}
