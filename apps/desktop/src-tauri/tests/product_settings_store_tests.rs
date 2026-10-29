use super::*;
use crate::local_run_store::{Project, RunStore};
use std::sync::atomic::{AtomicU64, Ordering};
static NEXT: AtomicU64 = AtomicU64::new(1);
struct Fixture {
    root: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!(
            "uagent-product-settings-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        Self { root }
    }
    fn data(&self) -> PathBuf {
        self.root.join("data")
    }
    fn setup(&self) -> ProductSettingsStore {
        let records = RunStore::open(self.data()).unwrap();
        for project in ["A", "B"] {
            records
                .create_project(&Project {
                    id: project.into(),
                    root: format!("G:/Synthetic/{project}"),
                    label: format!("Synthetic {project}"),
                    created_at: 1,
                })
                .unwrap();
        }
        drop(records);
        ProductSettingsStore::open(self.data()).unwrap()
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        if self.root.parent() == Some(std::env::temp_dir().as_path())
            && self
                .root
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("uagent-product-settings-")
        {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}
struct SyntheticNativePolicy {
    revision: &'static str,
    deny: bool,
    supported: bool,
    calls: std::cell::Cell<usize>,
}
impl SyntheticNativePolicy {
    fn allowed() -> Self {
        Self {
            revision: "synthetic-policy-1",
            deny: false,
            supported: true,
            calls: std::cell::Cell::new(0),
        }
    }
}
impl NativeEndpointPolicy for SyntheticNativePolicy {
    fn validate_endpoint(&self, _: WireApi, url: &str) -> Result<EndpointDecision> {
        self.calls.set(self.calls.get() + 1);
        if self.deny
            || ![
                "https://synthetic.invalid/v1",
                "https://synthetic.invalid/v1/",
                "https://other.synthetic.invalid/v1",
            ]
            .contains(&url)
        {
            return Err(StoreError::new(
                "endpointPolicy",
                "synthetic native policy rejected endpoint",
            ));
        }
        Ok(EndpointDecision {
            canonical_base_url: url.trim_end_matches('/').into(),
            policy_revision: self.revision.into(),
            transport_supported: self.supported,
        })
    }
}
fn config(id: &str) -> ProviderConfig {
    ProviderConfig {
        provider_id: id.into(),
        display_name: "Synthetic provider".into(),
        base_url: "https://synthetic.invalid/v1/".into(),
        wire_api: WireApi::OpenaiCompatible,
        auth_mode: AuthMode::EnvKey,
        models: vec![
            ProviderModel {
                id: "model-a".into(),
                label: "Synthetic model A".into(),
                context_window: 128000,
                supports_reasoning: true,
                reasoning_efforts: Some(vec![ReasoningEffort::Low, ReasoningEffort::High]),
                capability_declarations: CapabilityDeclarations {
                    text: Declaration::Supported,
                    tools: Declaration::Supported,
                    streaming: Declaration::Unknown,
                },
                request_defaults: RequestDefaults {
                    temperature: Some(0.2),
                    max_output_tokens: Some(2048),
                },
            },
            ProviderModel {
                id: "task-model".into(),
                label: "Synthetic task model".into(),
                context_window: 64000,
                supports_reasoning: false,
                reasoning_efforts: None,
                capability_declarations: CapabilityDeclarations::default(),
                request_defaults: RequestDefaults::default(),
            },
        ],
        default_model: Some("model-a".into()),
        default_reasoning_effort: Some(ReasoningEffort::High),
        enabled: true,
    }
}
fn preferences() -> UserPreferences {
    UserPreferences {
        theme: Theme::Light,
        locale: Locale::En,
        active_project_id: Some("A".into()),
        selected_provider_id: Some("provider".into()),
        default_provider_id: Some("provider".into()),
    }
}
fn project(provider: &str, model: &str) -> ProjectPreferences {
    ProjectPreferences {
        provider_id: Some(provider.into()),
        model_id: Some(model.into()),
        reasoning_effort: if model == "model-a" {
            Some(ReasoningEffort::High)
        } else {
            None
        },
    }
}
// Only for the pre-generation tests, which never recreate an ID. Deliberately
// vary the numeric revision to preserve their original revision-conflict cases.
// Lifecycle tests must pass captured full tokens directly to the production API.
fn save_provider_at(
    store: &ProductSettingsStore,
    revision: i64,
    config: &ProviderConfig,
    policy: &dyn NativeEndpointPolicy,
) -> Result<ProviderSnapshot> {
    let mut expected = store.provider_version(&config.provider_id)?;
    expected.revision = revision;
    store.save_provider(&expected, config, policy)
}
fn observation(snapshot: &ProviderSnapshot) -> NativeObservation {
    NativeObservation {
        provider_id: snapshot.config.provider_id.clone(),
        provider_generation: snapshot.generation.clone(),
        model_id: snapshot.models[0].model_id.clone(),
        configuration_fingerprint: snapshot.models[0].configuration_fingerprint.clone(),
        observed_at: 10,
        text_supported: Some(true),
        tools_supported: Some(true),
        streaming_supported: Some(false),
    }
}

#[test]
fn product_settings_store_round_trip_locale_changes_preserve_profiles_and_project_choices() {
    let fixture = Fixture::new();
    let store = fixture.setup();
    let policy = SyntheticNativePolicy::allowed();
    assert!(store.read_preferences().unwrap().is_none());
    let saved = save_provider_at(&store, 0, &config("provider"), &policy).unwrap();
    assert_eq!(saved.config.base_url, "https://synthetic.invalid/v1");
    store.seed_existing_preferences(&preferences()).unwrap();
    store
        .save_project_preferences("A", 0, &project("provider", "model-a"))
        .unwrap();
    let checks = policy.calls.get();
    store.set_locale(1, Locale::ZhCn).unwrap();
    store.set_theme(2, Theme::Dark).unwrap();
    assert_eq!(
        policy.calls.get(),
        checks,
        "language/theme changes must not initiate endpoint checks or probes"
    );
    assert_eq!(
        store.provider("provider", &policy).unwrap().unwrap().config,
        saved.config
    );
    assert_eq!(store.provider_revisions().unwrap()[0].revision, 1);
    assert_eq!(
        store
            .project_preferences("A")
            .unwrap()
            .unwrap()
            .preferences
            .model_id
            .as_deref(),
        Some("model-a")
    );
    assert_eq!(
        store
            .seed_existing_preferences(&UserPreferences::default())
            .unwrap_err()
            .kind,
        "alreadyInitialized"
    );
    drop(store);
    let reopened = ProductSettingsStore::open(fixture.data()).unwrap();
    let prefs = reopened.read_preferences().unwrap().unwrap();
    assert_eq!(prefs.revision, 3);
    assert_eq!(prefs.preferences.locale, Locale::ZhCn);
    assert_eq!(prefs.preferences.theme, Theme::Dark);
    assert_eq!(prefs.preferences.active_project_id.as_deref(), Some("A"));
    let profile = reopened.provider("provider", &policy).unwrap().unwrap();
    assert!(!profile.connection_verified);
    assert!(profile.requires_new_session);
    assert!(profile.models.iter().all(|m| !m.currently_verified));
    assert_eq!(profile.models[0].declarations.tools, Declaration::Supported);
    assert!(profile.models[0].historical_evidence.is_none());
    assert!(
        reopened
            .project_preferences("A")
            .unwrap()
            .unwrap()
            .requires_fresh_project_trust
    );
}

#[test]
fn product_settings_store_project_selection_is_isolated_and_requires_registered_identity() {
    let fixture = Fixture::new();
    let store = fixture.setup();
    let policy = SyntheticNativePolicy::allowed();
    save_provider_at(&store, 0, &config("provider"), &policy).unwrap();
    store.seed_existing_preferences(&preferences()).unwrap();
    store
        .save_project_preferences("A", 0, &project("provider", "model-a"))
        .unwrap();
    store
        .save_project_preferences("B", 0, &project("provider", "task-model"))
        .unwrap();
    store.select_project(1, Some("B".into())).unwrap();
    assert_eq!(
        store
            .project_preferences("A")
            .unwrap()
            .unwrap()
            .preferences
            .model_id
            .as_deref(),
        Some("model-a")
    );
    assert_eq!(
        store
            .project_preferences("B")
            .unwrap()
            .unwrap()
            .preferences
            .model_id
            .as_deref(),
        Some("task-model")
    );
    assert_eq!(
        store.project_preferences("Unknown").unwrap_err().kind,
        "notFound"
    );
    assert_eq!(
        store
            .save_project_preferences("Unknown", 0, &project("provider", "model-a"))
            .unwrap_err()
            .kind,
        "notFound"
    );
    assert!(store
        .save_project_preferences("A", 1, &project("provider", "not-in-provider"))
        .is_err());
    assert_eq!(
        store
            .select_project(2, Some("Unknown".into()))
            .unwrap_err()
            .kind,
        "notFound"
    );
    assert_eq!(
        store
            .read_preferences()
            .unwrap()
            .unwrap()
            .preferences
            .active_project_id
            .as_deref(),
        Some("B")
    );
    assert_eq!(store.project_preferences("A").unwrap().unwrap().revision, 1);
}

#[test]
fn product_settings_store_capability_history_invalidates_on_endpoint_model_epoch_and_policy_changes(
) {
    let fixture = Fixture::new();
    let store = fixture.setup();
    let policy = SyntheticNativePolicy::allowed();
    let initial = save_provider_at(&store, 0, &config("provider"), &policy).unwrap();
    store
        .save_project_preferences("A", 0, &project("provider", "model-a"))
        .unwrap();
    store
        .save_project_preferences("B", 0, &project("provider", "task-model"))
        .unwrap();
    let old = observation(&initial);
    store.record_native_observation(&old, &policy).unwrap();
    let cached = store.provider("provider", &policy).unwrap().unwrap();
    assert!(cached.models[0].historical_evidence.is_some());
    assert!(!cached.connection_verified);
    assert!(!cached.models[0].currently_verified);
    let mut edited = initial.config.clone();
    edited.base_url = "https://other.synthetic.invalid/v1".into();
    let changed = save_provider_at(&store, 1, &edited, &policy).unwrap();
    assert!(changed.models[0].historical_evidence.is_none());
    assert_eq!(
        store
            .record_native_observation(&old, &policy)
            .unwrap_err()
            .kind,
        "conflict"
    );
    edited.base_url = "https://synthetic.invalid/v1".into();
    let back = save_provider_at(&store, 2, &edited, &policy).unwrap();
    assert_ne!(
        back.models[0].configuration_fingerprint, initial.models[0].configuration_fingerprint,
        "A-to-B-to-A must not accept an old in-flight result"
    );
    assert_eq!(
        store
            .record_native_observation(&old, &policy)
            .unwrap_err()
            .kind,
        "conflict"
    );
    store
        .record_native_observation(&observation(&back), &policy)
        .unwrap();
    edited.models[0].id = "model-c".into();
    edited.default_model = Some("model-c".into());
    let model_changed = save_provider_at(&store, 3, &edited, &policy).unwrap();
    assert!(model_changed
        .models
        .iter()
        .all(|m| m.historical_evidence.is_none()));
    let a = store.project_preferences("A").unwrap().unwrap();
    assert!(a.preferences.model_id.is_none());
    assert_eq!(a.revision, 2);
    assert_eq!(
        store
            .project_preferences("B")
            .unwrap()
            .unwrap()
            .preferences
            .model_id
            .as_deref(),
        Some("task-model")
    );
    store
        .record_native_observation(&observation(&model_changed), &policy)
        .unwrap();
    let new_policy = SyntheticNativePolicy {
        revision: "synthetic-policy-2",
        ..SyntheticNativePolicy::allowed()
    };
    let rechecked = store.provider("provider", &new_policy).unwrap().unwrap();
    assert!(rechecked.models[0].historical_evidence.is_none());
    assert_eq!(
        store
            .record_native_observation(&observation(&model_changed), &new_policy)
            .unwrap_err()
            .kind,
        "conflict"
    );
}

#[test]
fn product_settings_store_rejects_sensitive_fields_and_obeys_native_policy_on_save_and_read() {
    let fixture = Fixture::new();
    let store = fixture.setup();
    let policy = SyntheticNativePolicy::allowed();
    for key in [
        "apiKey",
        "sessionToken",
        "approvalToken",
        "secretRef",
        "networkMode",
        "connectionVerified",
    ] {
        let mut value = serde_json::to_value(config("provider")).unwrap();
        value[key] = serde_json::json!("synthetic-never-real");
        assert!(
            serde_json::from_value::<ProviderConfig>(value).is_err(),
            "{key}"
        );
    }
    let mut nested = serde_json::to_value(config("provider")).unwrap();
    nested["models"][0]["executionToken"] = serde_json::json!("synthetic");
    assert!(serde_json::from_value::<ProviderConfig>(nested).is_err());
    let deny = SyntheticNativePolicy {
        deny: true,
        ..SyntheticNativePolicy::allowed()
    };
    assert_eq!(
        save_provider_at(&store, 0, &config("provider"), &deny)
            .unwrap_err()
            .kind,
        "endpointPolicy"
    );
    assert!(store.provider_revisions().unwrap().is_empty());
    for url in [
        "https://name:synthetic-value@synthetic.invalid/v1",
        "https://synthetic.invalid/v1?api_key=synthetic-value",
        "https://synthetic.invalid/v1#synthetic",
    ] {
        let mut bad = config("provider");
        bad.base_url = url.into();
        let error = save_provider_at(&store, 0, &bad, &policy).unwrap_err();
        assert_eq!(error.kind, "invalidSettings");
        assert!(!error.message.contains("synthetic-value"));
    }
    let mut bad = config("provider");
    bad.display_name = "sk-synthetic-never-real".into();
    assert_eq!(
        save_provider_at(&store, 0, &bad, &policy).unwrap_err().kind,
        "invalidSettings"
    );
    let saved = save_provider_at(&store, 0, &config("provider"), &policy).unwrap();
    assert_eq!(saved.config.models[1].id, "task-model");
    assert_eq!(
        store.provider("provider", &deny).unwrap_err().kind,
        "endpointPolicy"
    );
    assert_eq!(
        store.provider_revisions().unwrap()[0].revision,
        1,
        "policy rejection must not erase saved settings"
    );
    let unsupported = SyntheticNativePolicy {
        supported: false,
        ..SyntheticNativePolicy::allowed()
    };
    let info = store.provider("provider", &unsupported).unwrap().unwrap();
    assert!(!info.transport_supported);
    assert!(!info.connection_verified);
    assert_eq!(
        store
            .record_native_observation(&observation(&info), &unsupported)
            .unwrap_err()
            .kind,
        "transportUnavailable"
    );
}

#[test]
fn product_settings_store_v1_migration_is_real_idempotent_and_preserves_t06_schema() {
    let fixture = Fixture::new();
    let records = RunStore::open(fixture.data()).unwrap();
    records
        .create_project(&Project {
            id: "A".into(),
            root: "G:/Synthetic/A".into(),
            label: "Synthetic".into(),
            created_at: 1,
        })
        .unwrap();
    drop(records);
    let db = Db::open(&fixture.data().join("runs.sqlite3")).unwrap();
    db.transaction(|| {
        for sql in schema::V1 {
            db.execute(sql, &[])?;
        }
        db.execute(
            "INSERT INTO product_user_preferences VALUES(1,7,?)",
            &[encode(&schema::V1Preferences {
                theme: Theme::Light,
                locale: Locale::En,
            })?
            .into()],
        )?;
        Ok(())
    })
    .unwrap();
    drop(db);
    for _ in 0..3 {
        let store = ProductSettingsStore::open(fixture.data()).unwrap();
        assert_eq!(store.schema_version().unwrap(), 3);
        let prefs = store.read_preferences().unwrap().unwrap();
        assert_eq!(prefs.revision, 7);
        assert_eq!(prefs.preferences.locale, Locale::En);
        assert_eq!(prefs.preferences.theme, Theme::Light);
        assert!(prefs.preferences.selected_provider_id.is_none());
    }
    let records = RunStore::open(fixture.data()).unwrap();
    assert_eq!(records.schema_version().unwrap(), 2);
    assert_eq!(records.projects().unwrap().len(), 1);
}

#[test]
fn product_settings_store_atomic_failure_rolls_back_provider_and_evidence_and_rejects_stale_writers(
) {
    let fixture = Fixture::new();
    let store = fixture.setup();
    let policy = SyntheticNativePolicy::allowed();
    let original = save_provider_at(&store, 0, &config("provider"), &policy).unwrap();
    store.seed_existing_preferences(&preferences()).unwrap();
    store
        .save_project_preferences("A", 0, &project("provider", "model-a"))
        .unwrap();
    store
        .record_native_observation(&observation(&original), &policy)
        .unwrap();
    store.db.execute("CREATE TRIGGER synthetic_settings_abort BEFORE DELETE ON product_capability_evidence BEGIN SELECT RAISE(ABORT,'synthetic settings transaction failure'); END",&[]).unwrap();
    let mut changed = original.config.clone();
    changed.base_url = "https://other.synthetic.invalid/v1".into();
    assert_eq!(
        save_provider_at(&store, 1, &changed, &policy)
            .unwrap_err()
            .kind,
        "constraint"
    );
    let reloaded = store.provider("provider", &policy).unwrap().unwrap();
    assert_eq!(reloaded.revision, 1);
    assert_eq!(reloaded.config, original.config);
    assert!(reloaded.models[0].historical_evidence.is_some());
    assert_eq!(store.project_preferences("A").unwrap().unwrap().revision, 1);
    assert_eq!(store.read_preferences().unwrap().unwrap().revision, 1);
    store
        .db
        .execute("DROP TRIGGER synthetic_settings_abort", &[])
        .unwrap();
    let other = ProductSettingsStore::open(fixture.data()).unwrap();
    save_provider_at(&store, 1, &changed, &policy).unwrap();
    assert_eq!(
        save_provider_at(&other, 1, &original.config, &policy)
            .unwrap_err()
            .kind,
        "conflict"
    );
    store.set_locale(1, Locale::ZhCn).unwrap();
    assert_eq!(
        other.set_theme(1, Theme::Dark).unwrap_err().kind,
        "conflict"
    );
}

#[test]
fn product_settings_store_corrupt_data_is_not_reset_and_known_good_backup_restores_preferences() {
    let fixture = Fixture::new();
    let store = fixture.setup();
    let policy = SyntheticNativePolicy::allowed();
    save_provider_at(&store, 0, &config("provider"), &policy).unwrap();
    store.seed_existing_preferences(&preferences()).unwrap();
    let good = fixture.root.join("known-good");
    store.backup(&good).unwrap();
    store
        .db
        .execute(
            "UPDATE product_user_preferences SET payload='{' WHERE singleton=1",
            &[],
        )
        .unwrap();
    assert_eq!(
        store.read_preferences().unwrap_err().kind,
        "corruptSettings"
    );
    assert_eq!(
        store
            .db
            .query("SELECT payload FROM product_user_preferences", &[])
            .unwrap()[0][0]
            .text()
            .unwrap(),
        "{"
    );
    let bad = fixture.root.join("preserved-bad-data");
    store.backup(&bad).unwrap();
    let bad_copy = ProductSettingsStore::open(&bad).unwrap();
    assert_eq!(
        bad_copy.read_preferences().unwrap_err().kind,
        "corruptSettings"
    );
    let restored = ProductSettingsStore::open(&good).unwrap();
    assert_eq!(
        restored.read_preferences().unwrap().unwrap().preferences,
        preferences()
    );
    assert!(
        !restored
            .provider("provider", &policy)
            .unwrap()
            .unwrap()
            .connection_verified
    );
    store
        .db
        .execute("UPDATE product_settings_schema SET version=999", &[])
        .unwrap();
    assert_eq!(
        ProductSettingsStore::open(fixture.data())
            .err()
            .unwrap()
            .kind,
        "newerSettingsSchema"
    );
    let future = fixture.root.join("preserved-future-schema");
    backup_for_recovery(fixture.data(), &future).unwrap();
    assert_eq!(
        store
            .db
            .query("SELECT version FROM product_settings_schema", &[])
            .unwrap()[0][0]
            .int()
            .unwrap(),
        999
    );
}

#[test]
fn product_settings_store_bad_v1_payload_aborts_migration_without_partial_tables_or_reset() {
    let fixture = Fixture::new();
    drop(RunStore::open(fixture.data()).unwrap());
    let db = Db::open(&fixture.data().join("runs.sqlite3")).unwrap();
    db.transaction(|| {
        for sql in schema::V1 {
            db.execute(sql, &[])?;
        }
        db.execute(
            "INSERT INTO product_user_preferences VALUES(1,1,?)",
            &[r#"{"theme":"dark","locale":"en","approvalToken":"synthetic-never-real"}"#.into()],
        )?;
        Ok(())
    })
    .unwrap();
    drop(db);
    assert_eq!(
        ProductSettingsStore::open(fixture.data())
            .err()
            .unwrap()
            .kind,
        "corruptSettings"
    );
    let db = Db::open(&fixture.data().join("runs.sqlite3")).unwrap();
    assert_eq!(
        db.query("SELECT version FROM product_settings_schema", &[])
            .unwrap()[0][0]
            .int()
            .unwrap(),
        1
    );
    assert_eq!(
        db.query(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='product_provider_profiles'",
            &[]
        )
        .unwrap()[0][0]
            .int()
            .unwrap(),
        0
    );
    assert!(db
        .query("SELECT payload FROM product_user_preferences", &[])
        .unwrap()[0][0]
        .text()
        .unwrap()
        .contains("approvalToken"));
}

#[test]
fn product_settings_store_delete_provider_updates_only_its_bound_selections() {
    let fixture = Fixture::new();
    let store = fixture.setup();
    let policy = SyntheticNativePolicy::allowed();
    save_provider_at(&store, 0, &config("provider"), &policy).unwrap();
    save_provider_at(&store, 0, &config("other"), &policy).unwrap();
    let mut prefs = preferences();
    prefs.default_provider_id = Some("other".into());
    store.seed_existing_preferences(&prefs).unwrap();
    store
        .save_project_preferences("A", 0, &project("provider", "model-a"))
        .unwrap();
    store
        .save_project_preferences("B", 0, &project("other", "model-a"))
        .unwrap();
    store
        .delete_provider(&store.provider_version("provider").unwrap())
        .unwrap();
    let prefs = store.read_preferences().unwrap().unwrap().preferences;
    assert_eq!(prefs.locale, Locale::En);
    assert_eq!(prefs.theme, Theme::Light);
    assert!(prefs.selected_provider_id.is_none());
    assert_eq!(prefs.default_provider_id.as_deref(), Some("other"));
    assert!(store
        .project_preferences("A")
        .unwrap()
        .unwrap()
        .preferences
        .provider_id
        .is_none());
    assert_eq!(
        store
            .project_preferences("B")
            .unwrap()
            .unwrap()
            .preferences
            .provider_id
            .as_deref(),
        Some("other")
    );
    assert_eq!(store.provider_revisions().unwrap().len(), 1);
}

// Frozen predecessor schema fixture. Production T06/T08 migrators perform the upgrades.
fn combined_v1_library(fixture: &Fixture, long: &str) {
    fs::create_dir(fixture.data()).unwrap();
    let db = Db::open(&fixture.data().join("runs.sqlite3")).unwrap();
    let ddl=[
        "CREATE TABLE projects(id TEXT PRIMARY KEY,root TEXT NOT NULL,label TEXT NOT NULL,created_at INTEGER NOT NULL CHECK(created_at>=0))",
        "CREATE TABLE sessions(project_id TEXT NOT NULL,id TEXT NOT NULL,title TEXT NOT NULL,created_at INTEGER NOT NULL CHECK(created_at>=0),archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),parent_id TEXT,origin TEXT NOT NULL CHECK(origin IN ('native','historicalTextCopy')),PRIMARY KEY(project_id,id),FOREIGN KEY(project_id) REFERENCES projects(id),FOREIGN KEY(project_id,parent_id) REFERENCES sessions(project_id,id))",
        "CREATE TABLE messages(project_id TEXT NOT NULL,session_id TEXT NOT NULL,id TEXT NOT NULL,ordinal INTEGER NOT NULL CHECK(ordinal>0),role TEXT NOT NULL CHECK(role IN ('system','user','assistant','tool')),body TEXT NOT NULL,created_at INTEGER NOT NULL CHECK(created_at>=0),origin TEXT NOT NULL CHECK(origin IN ('native','historicalTextCopy')),PRIMARY KEY(project_id,id),UNIQUE(project_id,session_id,ordinal),FOREIGN KEY(project_id,session_id) REFERENCES sessions(project_id,id))",
        "CREATE TABLE runs(project_id TEXT NOT NULL,id TEXT NOT NULL,session_id TEXT NOT NULL,goal TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('created','running','paused','succeeded','failed','cancelled','needsReconciliation')),revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),created_at INTEGER NOT NULL CHECK(created_at>=0),updated_at INTEGER NOT NULL CHECK(updated_at>=0),PRIMARY KEY(project_id,id),FOREIGN KEY(project_id,session_id) REFERENCES sessions(project_id,id))",
        "CREATE INDEX messages_session_order ON messages(project_id,session_id,ordinal)",
        "CREATE INDEX sessions_project_time ON sessions(project_id,created_at,id)",
        "PRAGMA user_version=1",
    ];
    db.transaction(|| {
        for sql in ddl {db.execute(sql,&[])?;}
        for sql in schema::V1 {db.execute(sql,&[])?;}
        db.execute("INSERT INTO projects VALUES('A','G:/Synthetic/A','Synthetic A',1)",&[])?;
        db.execute("INSERT INTO projects VALUES('B','G:/Synthetic/B','Synthetic B',1)",&[])?;
        db.execute("INSERT INTO sessions VALUES('A','session','Synthetic combined',1,0,NULL,'native')",&[])?;
        db.execute("INSERT INTO runs VALUES('A','run','session','Synthetic combined regression','created',0,1,1)",&[])?;
        db.execute("INSERT INTO messages VALUES('A','session','v1-long',1,'user',?,1,'native')",&[long.into()])?;
        db.execute("INSERT INTO product_user_preferences VALUES(1,1,?)",&[encode(&schema::V1Preferences {theme:Theme::Light,locale:Locale::En})?.into()])?;
        Ok(())
    }).unwrap();
}
fn combined_batch(id: &str, body: String, at: i64) -> crate::local_run_store::CheckpointBatch {
    use crate::local_run_store as runs;
    runs::CheckpointBatch {
        status: runs::RunStatus::Paused,
        checkpoint: runs::Checkpoint {
            next_step_id: None,
            reason: "syntheticCombinedCheckpoint".into(),
            summary: "Synthetic cross-store regression".into(),
            captured_at: at,
        },
        messages: vec![runs::NewMessage {
            id: id.into(),
            role: runs::Role::Assistant,
            body,
            created_at: at,
        }],
        steps: vec![],
        tool_calls: vec![],
        events: vec![runs::RunEvent {
            id: format!("event-{id}"),
            kind: "syntheticCombined".into(),
            created_at: at,
            data: serde_json::json!({"observed":true}),
        }],
        changesets: vec![],
        artifacts: vec![],
    }
}
#[test]
fn product_settings_store_combined_migration_interleaving_corruption_and_policy_rejection() {
    use crate::local_run_store as runs;
    let fixture = Fixture::new();
    let long = "合成联合记录🙂\0完整正文\n".repeat(60000);
    assert!(long.len() > 1_000_000);
    combined_v1_library(&fixture, &long);
    let records = RunStore::open(fixture.data()).unwrap();
    let settings = ProductSettingsStore::open(fixture.data()).unwrap();
    let policy = SyntheticNativePolicy::allowed();
    assert_eq!(records.schema_version().unwrap(), 2);
    assert_eq!(settings.schema_version().unwrap(), 3);
    assert_eq!(
        records.messages("A", "session", 0, 10).unwrap()[0].body,
        long
    );
    let profile = save_provider_at(&settings, 0, &config("provider"), &policy).unwrap();
    settings
        .record_native_observation(&observation(&profile), &policy)
        .unwrap();
    settings.save_preferences(1, &preferences()).unwrap();
    settings
        .save_project_preferences("A", 0, &project("provider", "model-a"))
        .unwrap();

    let mut first = combined_batch("checkpoint-one", long.clone(), 2);
    first.steps.push(runs::Step {
        id: "step".into(),
        title: "Synthetic observation".into(),
        status: runs::ActionStatus::Succeeded,
        depends_on: vec![],
    });
    first.tool_calls.push(runs::ToolCall {
        id: "call".into(),
        step_id: "step".into(),
        tool_name: "synthetic.read".into(),
        arguments: serde_json::json!({"path":"Source/Synthetic.cpp"}),
        result: Some(serde_json::json!({"content":long})),
        status: runs::ActionStatus::Succeeded,
    });
    records.commit_checkpoint("A", "run", 0, &first).unwrap();
    settings.set_locale(2, Locale::ZhCn).unwrap();
    let mut changed = profile.config.clone();
    changed.base_url = "https://other.synthetic.invalid/v1".into();
    save_provider_at(&settings, 1, &changed, &policy).unwrap();
    assert!(settings
        .provider("provider", &policy)
        .unwrap()
        .unwrap()
        .models[0]
        .historical_evidence
        .is_none());
    settings.select_project(3, Some("B".into())).unwrap();
    let second = combined_batch("checkpoint-two", long.clone(), 3);
    records.commit_checkpoint("A", "run", 1, &second).unwrap();
    settings.set_theme(4, Theme::Dark).unwrap();
    drop(settings);
    drop(records);

    // Reopen in the opposite order to exercise both constructors on the shared DB.
    let settings = ProductSettingsStore::open(fixture.data()).unwrap();
    let records = RunStore::open(fixture.data()).unwrap();
    let prefs = settings.read_preferences().unwrap().unwrap();
    assert_eq!(prefs.revision, 5);
    assert_eq!(prefs.preferences.locale, Locale::ZhCn);
    assert_eq!(prefs.preferences.theme, Theme::Dark);
    assert_eq!(prefs.preferences.active_project_id.as_deref(), Some("B"));
    assert_eq!(
        settings
            .project_preferences("A")
            .unwrap()
            .unwrap()
            .preferences
            .model_id
            .as_deref(),
        Some("model-a")
    );
    assert!(settings.project_preferences("B").unwrap().is_none());
    let messages = records.messages("A", "session", 0, 10).unwrap();
    assert_eq!(messages.len(), 3);
    assert!(messages.iter().all(|message| message.body == long));
    assert_eq!(
        records.checkpoint_batch("A", "run", 1).unwrap(),
        Some(first)
    );
    assert_eq!(
        records.checkpoint_batch("A", "run", 2).unwrap(),
        Some(second)
    );

    settings
        .db
        .execute(
            "UPDATE product_user_preferences SET payload='{' WHERE singleton=1",
            &[],
        )
        .unwrap();
    assert_eq!(
        settings.read_preferences().unwrap_err().kind,
        "corruptSettings"
    );
    let recovery = combined_batch(
        "after-bad-settings",
        "Run checkpoint remains writable".into(),
        4,
    );
    records.commit_checkpoint("A", "run", 2, &recovery).unwrap();
    let before_snapshot = records.snapshot("A", "run").unwrap();
    let before_changes = settings.db.query("SELECT total_changes()", &[]).unwrap()[0][0]
        .int()
        .unwrap();
    let before_profile = settings.raw_provider("provider").unwrap();
    let deny = SyntheticNativePolicy {
        deny: true,
        ..SyntheticNativePolicy::allowed()
    };
    changed.display_name = "Synthetic refused edit".into();
    assert_eq!(
        save_provider_at(&settings, 2, &changed, &deny)
            .unwrap_err()
            .kind,
        "endpointPolicy"
    );
    assert_eq!(
        settings.provider("provider", &deny).unwrap_err().kind,
        "endpointPolicy"
    );
    assert_eq!(
        settings.db.query("SELECT total_changes()", &[]).unwrap()[0][0]
            .int()
            .unwrap(),
        before_changes,
        "policy rejection must not even attempt a settings data write"
    );
    assert_eq!(settings.raw_provider("provider").unwrap(), before_profile);
    assert_eq!(records.snapshot("A", "run").unwrap(), before_snapshot);
    assert_eq!(
        settings
            .db
            .query("SELECT payload FROM product_user_preferences", &[])
            .unwrap()[0][0]
            .text()
            .unwrap(),
        "{"
    );
    drop(settings);
    drop(records);
    let records = RunStore::open(fixture.data()).unwrap();
    assert_eq!(records.run("A", "run").unwrap().revision, 3);
    assert_eq!(records.messages("A", "session", 0, 10).unwrap().len(), 4);
    assert_eq!(records.events("A", "run", 0, 10).unwrap().len(), 3);
    assert_eq!(
        records.checkpoint_batch("A", "run", 3).unwrap(),
        Some(recovery)
    );
}

#[test]
fn product_settings_store_combined_parallel_run_settings_and_competing_preference_revisions() {
    use crate::local_run_store as runs;
    let fixture = Fixture::new();
    let settings = fixture.setup();
    let policy = SyntheticNativePolicy::allowed();
    save_provider_at(&settings, 0, &config("provider"), &policy).unwrap();
    settings.seed_existing_preferences(&preferences()).unwrap();
    settings
        .save_project_preferences("A", 0, &project("provider", "model-a"))
        .unwrap();
    let records = RunStore::open(fixture.data()).unwrap();
    records
        .create_session(&runs::Session {
            project_id: "A".into(),
            id: "session".into(),
            title: "Synthetic parallel".into(),
            created_at: 1,
            archived: false,
            parent_id: None,
            origin: runs::Origin::Native,
        })
        .unwrap();
    records
        .start_run(
            "A",
            &runs::NewRun {
                id: "run".into(),
                session_id: "session".into(),
                goal: "Synthetic mixed writer".into(),
                created_at: 1,
            },
        )
        .unwrap();
    let long = "Parallel synthetic record 🙂\n".repeat(10000);
    let gate = std::sync::Arc::new(std::sync::Barrier::new(2));
    let run_root = fixture.data();
    let run_gate = gate.clone();
    let run_body = long.clone();
    let run_writer = std::thread::spawn(move || {
        let opened = RunStore::open(run_root);
        run_gate.wait();
        opened?.commit_checkpoint("A", "run", 0, &combined_batch("parallel-run", run_body, 2))
    });
    let settings_root = fixture.data();
    let settings_gate = gate.clone();
    let settings_writer = std::thread::spawn(move || {
        let opened = ProductSettingsStore::open(settings_root);
        settings_gate.wait();
        opened?.set_locale(1, Locale::ZhCn)
    });
    let run_result = run_writer.join().unwrap();
    let settings_result = settings_writer.join().unwrap();
    assert_eq!(run_result.unwrap(), 1);
    assert_eq!(settings_result.unwrap().revision, 2);
    assert_eq!(
        records.messages("A", "session", 0, 10).unwrap()[0].body,
        long
    );
    assert_eq!(records.run("A", "run").unwrap().revision, 1);
    assert_eq!(settings.read_preferences().unwrap().unwrap().revision, 2);

    let gate = std::sync::Arc::new(std::sync::Barrier::new(2));
    let mut writers = Vec::new();
    for index in 0..2 {
        let root = fixture.data();
        let gate = gate.clone();
        writers.push(std::thread::spawn(move || {
            let opened = ProductSettingsStore::open(root);
            gate.wait();
            let store = opened?;
            if index == 0 {
                store.set_theme(2, Theme::Dark)
            } else {
                store.set_locale(2, Locale::En)
            }
        }));
    }
    let outcomes: Vec<_> = writers
        .into_iter()
        .map(|writer| writer.join().unwrap())
        .collect();
    assert_eq!(outcomes.iter().filter(|result| result.is_ok()).count(), 1);
    assert_eq!(
        outcomes
            .iter()
            .filter_map(|result| result.as_ref().err())
            .next()
            .unwrap()
            .kind,
        "conflict"
    );
    let prefs = settings.read_preferences().unwrap().unwrap();
    assert_eq!(prefs.revision, 3);
    assert_eq!(
        prefs.preferences.selected_provider_id.as_deref(),
        Some("provider")
    );
    assert_eq!(prefs.preferences.active_project_id.as_deref(), Some("A"));
    assert_eq!(records.run("A", "run").unwrap().revision, 1);
    assert_eq!(
        records
            .checkpoint_batch("A", "run", 1)
            .unwrap()
            .unwrap()
            .messages[0]
            .body,
        long
    );
    assert_eq!(
        settings.project_preferences("A").unwrap().unwrap().revision,
        1
    );
    assert_eq!(settings.provider_revisions().unwrap()[0].revision, 1);
}

fn sqlite_changes(store: &ProductSettingsStore) -> i64 {
    store.db.query("SELECT total_changes()", &[]).unwrap()[0][0]
        .int()
        .unwrap()
}
fn generation_v2_library(fixture: &Fixture, revision: i64) {
    let records = RunStore::open(fixture.data()).unwrap();
    records
        .create_project(&Project {
            id: "A".into(),
            root: "G:/Synthetic/A".into(),
            label: "Synthetic A".into(),
            created_at: 1,
        })
        .unwrap();
    drop(records);
    let db = Db::open(&fixture.data().join("runs.sqlite3")).unwrap();
    db.transaction(||{
        for sql in schema::V1 {db.execute(sql,&[])?;}
        for sql in schema::V2 {db.execute(sql,&[])?;}
        db.execute("UPDATE product_settings_schema SET version=2",&[])?;
        db.execute("INSERT INTO product_provider_profiles VALUES('provider',?,?)",
            &[revision.into(),encode(&config("provider"))?.into()])?;
        db.execute("INSERT INTO product_user_preferences VALUES(1,11,?)",
            &[encode(&preferences())?.into()])?;
        db.execute("INSERT INTO product_project_preferences VALUES('A',4,?)",
            &[encode(&project("provider","model-a"))?.into()])?;
        let legacy=serde_json::json!({
            "configurationFingerprint":"synthetic-legacy-v2",
            "observedAt":10,"textSupported":true,"toolsSupported":true,"streamingSupported":false
        });
        db.execute("INSERT INTO product_capability_evidence VALUES('provider','model-a','synthetic-legacy-v2',10,?)",
            &[encode(&legacy)?.into()])?;
        Ok(())
    }).unwrap();
}

#[test]
fn product_settings_store_provider_generation_delete_recreate_reopen_rejects_old_writes_and_observations(
) {
    let fixture = Fixture::new();
    let store = fixture.setup();
    let policy = SyntheticNativePolicy::allowed();
    let never_created = store.provider_version("provider").unwrap();
    assert_eq!(never_created.generation, None);
    assert_eq!(never_created.revision, 0);
    assert!(!never_created.exists);
    let first = store
        .save_provider(&never_created, &config("provider"), &policy)
        .unwrap();
    let old_version = first.version();
    let delayed_observation = observation(&first);
    store
        .record_native_observation(&delayed_observation, &policy)
        .unwrap();
    let tombstone = store.delete_provider(&old_version).unwrap();
    assert_eq!(tombstone.revision, 2);
    assert!(!tombstone.exists);
    assert_eq!(tombstone.generation, Some(first.generation.clone()));
    assert!(store.provider("provider", &policy).unwrap().is_none());
    assert!(store.provider_revisions().unwrap().is_empty());
    drop(store);

    let store = ProductSettingsStore::open(fixture.data()).unwrap();
    assert_eq!(store.provider_version("provider").unwrap(), tombstone);
    let changes = sqlite_changes(&store);
    assert_eq!(
        store
            .save_provider(&never_created, &first.config, &policy)
            .unwrap_err()
            .kind,
        "conflict"
    );
    assert_eq!(
        sqlite_changes(&store),
        changes,
        "an old creation intent cannot resurrect a deleted ID"
    );
    let second = store
        .save_provider(&tombstone, &first.config, &policy)
        .unwrap();
    assert_eq!(
        second.config, first.config,
        "same endpoint/model/settings must still have a new identity"
    );
    assert_eq!(second.revision, 3);
    assert_ne!(second.generation, first.generation);
    assert_ne!(
        second.models[0].configuration_fingerprint,
        first.models[0].configuration_fingerprint
    );
    assert!(second.models[0].historical_evidence.is_none());
    store
        .record_native_observation(&observation(&second), &policy)
        .unwrap();
    drop(store);

    let store = ProductSettingsStore::open(fixture.data()).unwrap();
    let before = store.provider("provider", &policy).unwrap().unwrap();
    assert_eq!(
        before.version(),
        second.version(),
        "identity must survive native store reopen"
    );
    let evidence = before.models[0].historical_evidence.as_ref().unwrap();
    assert_eq!(evidence.provider_generation, second.generation);
    let changes = sqlite_changes(&store);
    let mut old_edit = first.config.clone();
    old_edit.display_name = "An old window edit".into();
    assert_eq!(
        store
            .save_provider(&old_version, &old_edit, &policy)
            .unwrap_err()
            .kind,
        "conflict"
    );
    assert_eq!(
        store.delete_provider(&old_version).unwrap_err().kind,
        "conflict"
    );
    assert_eq!(
        store
            .record_native_observation(&delayed_observation, &policy)
            .unwrap_err()
            .kind,
        "conflict"
    );
    assert_eq!(
        store
            .save_provider(&tombstone, &first.config, &policy)
            .unwrap_err()
            .kind,
        "conflict"
    );
    let old_generation_current_revision = ProviderVersion {
        generation: Some(first.generation.clone()),
        ..before.version()
    };
    assert_eq!(
        store
            .save_provider(&old_generation_current_revision, &old_edit, &policy)
            .unwrap_err()
            .kind,
        "conflict"
    );
    assert_eq!(
        store
            .delete_provider(&old_generation_current_revision)
            .unwrap_err()
            .kind,
        "conflict"
    );
    let mut wrong_generation = observation(&before);
    wrong_generation.provider_generation = first.generation.clone();
    assert_eq!(
        store
            .record_native_observation(&wrong_generation, &policy)
            .unwrap_err()
            .kind,
        "conflict"
    );
    let mut wrong_fingerprint = observation(&before);
    wrong_fingerprint.configuration_fingerprint = first.models[0].configuration_fingerprint.clone();
    assert_eq!(
        store
            .record_native_observation(&wrong_fingerprint, &policy)
            .unwrap_err()
            .kind,
        "conflict"
    );
    assert_eq!(
        sqlite_changes(&store),
        changes,
        "every stale attempt must reject before any SQL write"
    );
    assert_eq!(
        store.provider("provider", &policy).unwrap().unwrap(),
        before
    );
    assert_eq!(
        store.provider_version("provider").unwrap(),
        before.version()
    );

    let current = store
        .save_provider(&before.version(), &before.config, &policy)
        .unwrap();
    assert_eq!(current.revision, 4);
    assert_eq!(current.generation, second.generation);
    assert!(current.models[0].historical_evidence.is_none());
    store
        .record_native_observation(&observation(&current), &policy)
        .unwrap();
    let deleted_again = store.delete_provider(&current.version()).unwrap();
    assert_eq!(deleted_again.revision, 5);
    drop(store);
    let store = ProductSettingsStore::open(fixture.data()).unwrap();
    assert_eq!(store.provider_version("provider").unwrap(), deleted_again);
    let third = store
        .save_provider(&deleted_again, &first.config, &policy)
        .unwrap();
    assert_eq!(third.revision, 6);
    assert_ne!(third.generation, current.generation);
    assert!(!third.connection_verified);
}

#[test]
fn product_settings_store_provider_generation_v2_migration_preserves_choices_and_invalidates_legacy_identity(
) {
    let fixture = Fixture::new();
    generation_v2_library(&fixture, 7);
    let policy = SyntheticNativePolicy::allowed();
    let store = ProductSettingsStore::open(fixture.data()).unwrap();
    assert_eq!(store.schema_version().unwrap(), 3);
    let migrated = store.provider("provider", &policy).unwrap().unwrap();
    assert!(valid_generation(&migrated.generation));
    assert_eq!(migrated.revision, 8);
    assert!(migrated
        .models
        .iter()
        .all(|m| m.historical_evidence.is_none()));
    let prefs = store.read_preferences().unwrap().unwrap();
    assert_eq!(prefs.revision, 11);
    assert_eq!(prefs.preferences, preferences());
    let choice = store.project_preferences("A").unwrap().unwrap();
    assert_eq!(choice.revision, 4);
    assert_eq!(choice.preferences, project("provider", "model-a"));
    assert_eq!(
        store
            .db
            .query("SELECT COUNT(*) FROM product_capability_evidence", &[])
            .unwrap()[0][0]
            .int()
            .unwrap(),
        0
    );
    assert!(
        serde_json::from_value::<ProviderVersion>(serde_json::json!({
            "providerId":"provider","revision":7
        }))
        .is_err(),
        "revision-only callers must not be upgraded into current identities"
    );
    let legacy_version = ProviderVersion {
        provider_id: "provider".into(),
        generation: None,
        revision: 7,
        exists: true,
    };
    let changes = sqlite_changes(&store);
    assert_eq!(
        store
            .save_provider(&legacy_version, &migrated.config, &policy)
            .unwrap_err()
            .kind,
        "conflict"
    );
    assert_eq!(
        store.delete_provider(&legacy_version).unwrap_err().kind,
        "conflict"
    );
    let mut legacy_observation = observation(&migrated);
    legacy_observation.provider_generation.clear();
    assert_eq!(
        store
            .record_native_observation(&legacy_observation, &policy)
            .unwrap_err()
            .kind,
        "conflict"
    );
    assert_eq!(sqlite_changes(&store), changes);
    store
        .record_native_observation(&observation(&migrated), &policy)
        .unwrap();
    drop(store);
    let reopened = ProductSettingsStore::open(fixture.data()).unwrap();
    let after = reopened.provider("provider", &policy).unwrap().unwrap();
    assert_eq!(after.version(), migrated.version());
    assert!(after.models[0].historical_evidence.is_some());
    let records = RunStore::open(fixture.data()).unwrap();
    assert_eq!(records.schema_version().unwrap(), 2);
    assert_eq!(records.projects().unwrap().len(), 1);
}

#[test]
fn product_settings_store_provider_generation_v2_overflow_rolls_back_migration() {
    let fixture = Fixture::new();
    generation_v2_library(&fixture, i64::MAX);
    assert_eq!(
        ProductSettingsStore::open(fixture.data())
            .err()
            .unwrap()
            .kind,
        "capacity"
    );
    let db = Db::open(&fixture.data().join("runs.sqlite3")).unwrap();
    assert_eq!(
        db.query("SELECT version FROM product_settings_schema", &[])
            .unwrap()[0][0]
            .int()
            .unwrap(),
        2
    );
    assert_eq!(
        db.query("SELECT revision FROM product_provider_profiles", &[])
            .unwrap()[0][0]
            .int()
            .unwrap(),
        i64::MAX
    );
    assert_eq!(
        db.query(
            "SELECT COUNT(*) FROM sqlite_master WHERE name='product_provider_versions'",
            &[]
        )
        .unwrap()[0][0]
            .int()
            .unwrap(),
        0
    );
    assert_eq!(
        db.query("SELECT COUNT(*) FROM product_capability_evidence", &[])
            .unwrap()[0][0]
            .int()
            .unwrap(),
        1
    );
    drop(db);
    let records = RunStore::open(fixture.data()).unwrap();
    assert_eq!(records.schema_version().unwrap(), 2);
    assert_eq!(records.projects().unwrap().len(), 1);
}
