//! Local broker/DTO tests. No WebView, remote endpoint, real credential or HTTP.
use super::*;
use crate::product_settings_store::{
    CapabilityDeclarations, Declaration, ProviderConfig, ProviderModel, RequestDefaults,
};
use serde::de::DeserializeOwned;
use serde_json::{json, Value};
use std::path::{Component, Prefix};

struct Fixture {
    root: PathBuf,
    profiles: Vec<(String, String)>,
    provider_ids: Vec<String>,
}
impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("uagent-responses-broker-{}", token().unwrap()));
        assert!(
            matches!(root.components().next(), Some(Component::Prefix(prefix)) if matches!(prefix.kind(), Prefix::Disk(b'E' | b'G') | Prefix::VerbatimDisk(b'E' | b'G')))
        );
        std::fs::create_dir(&root).unwrap();
        Self {
            root,
            profiles: Vec::new(),
            provider_ids: Vec::new(),
        }
    }
    fn config(&mut self) -> ProviderConfig {
        let id = format!("fixture-responses-{}", token().unwrap());
        self.provider_ids.push(id.clone());
        ProviderConfig {
            provider_id: id,
            display_name: "Synthetic Responses configuration".into(),
            base_url: "https://api.openai.com/v1".into(),
            wire_api: WireApi::Responses,
            auth_mode: AuthMode::EnvKey,
            models: vec![ProviderModel {
                id: "fixture-model".into(),
                label: "Synthetic model".into(),
                context_window: 32_768,
                supports_reasoning: false,
                reasoning_efforts: None,
                capability_declarations: CapabilityDeclarations {
                    text: Declaration::Supported,
                    tools: Declaration::Supported,
                    streaming: Declaration::Supported,
                },
                request_defaults: RequestDefaults::default(),
            }],
            default_model: Some("fixture-model".into()),
            default_reasoning_effort: None,
            enabled: true,
        }
    }
    fn save(&self, config: &ProviderConfig) -> ProviderSnapshot {
        let store = ProductSettingsStore::open(&self.root).unwrap();
        store
            .save_provider(
                &store.provider_version(&config.provider_id).unwrap(),
                config,
                &NATIVE_ENDPOINT_POLICY,
            )
            .unwrap()
    }
    fn profile(
        &mut self,
        snapshot: &ProviderSnapshot,
        window: &str,
        expired: bool,
    ) -> Arc<Profile> {
        let id = token().unwrap();
        let profile = Arc::new(Profile {
            id: id.clone(),
            window: window.into(),
            root: self.root.clone(),
            snapshot: snapshot.clone(),
            model_id: "fixture-model".into(),
            endpoint: "https://api.openai.com/v1/responses".into(),
            key: Secret(b"synthetic-broker-fixture-only".to_vec()),
            clock: Arc::new(MonotonicClock::new()),
            expires_at: if expired { 0 } else { PROFILE_TTL },
            alive: AtomicBool::new(true),
        });
        let previous = lock(broker())
            .unwrap()
            .profiles
            .insert(id.clone(), profile.clone());
        assert!(previous.is_none());
        self.profiles.push((id, window.into()));
        profile
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        // Keep other tests' and callers' registries untouched. Fixture files are
        // retained under the isolated E/G TEMP for inspection; no user data read.
        for (id, window) in &self.profiles {
            let _ = close_profile(id, window);
        }
        if let Ok(mut state) = lock(broker()) {
            for id in &self.provider_ids {
                state.updating.remove(id);
            }
        }
    }
}
fn rejects_authority_fields<T: DeserializeOwned>(baseline: Value) {
    assert!(
        serde_json::from_value::<T>(baseline.clone()).is_ok(),
        "{} baseline must match the current DTO",
        std::any::type_name::<T>()
    );
    for (key, value) in [
        ("url", json!("http://127.0.0.1:9/injected")),
        ("endpoint", json!("https://other.invalid/v1/responses")),
        ("window", json!("another-window")),
        (
            "owner",
            json!({"projectId":"another-project","runId":"another-run","projectEpoch":55}),
        ),
        ("approval", json!(true)),
        ("approvalGrant", json!({"approved":true})),
        ("lease", json!({"current":true})),
        ("validated", json!(true)),
    ] {
        let mut injected = baseline.clone();
        injected.as_object_mut().unwrap().insert(key.into(), value);
        assert!(
            serde_json::from_value::<T>(injected).is_err(),
            "{} must reject untrusted field {key}",
            std::any::type_name::<T>(),
        );
    }
}
fn continuation_record() -> Value {
    json!({
        "schemaVersion":1,"wireApi":"responses",
        "owner":{"providerId":"fixture-provider","modelId":"fixture-model","projectId":"fixture-project",
            "projectEpoch":7,"runId":"fixture-run","conversationId":"fixture-conversation"},
        "requestId":"fixture-request","responseId":"resp_fixture","createdAt":1,
        "assistant":{"content":"Synthetic text"},
        "output":[{"id":"msg_fixture","type":"message","role":"assistant",
            "content":[{"type":"output_text","text":"Synthetic text","annotations":[]}]}]
    })
}

#[test]
fn request_deadline_never_extends_the_original_run_or_profile_deadline() {
    let _test_guard = crate::reset_shared_registries_for_test();
    let original_run_deadline = 20;
    for now in [0, 1, 10, 18, 19] {
        assert_eq!(
            request_deadline(now, original_run_deadline, 1_000).unwrap(),
            original_run_deadline
        );
    }
    assert_eq!(
        request_deadline(20, original_run_deadline, 1_000).unwrap_err(),
        "native_scope_expired"
    );
    assert_eq!(
        request_deadline(21, original_run_deadline, 1_000).unwrap_err(),
        "native_scope_expired"
    );
    assert_eq!(request_deadline(10, 1_000, 15).unwrap(), 15);
    assert_eq!(
        request_deadline(15, 1_000, 15).unwrap_err(),
        "native_scope_expired"
    );
    assert_eq!(request_deadline(1, 900_000, 1_000_000).unwrap(), 600_001);
    assert_eq!(
        request_deadline(u64::MAX, u64::MAX, u64::MAX).unwrap_err(),
        "native_scope_invalid"
    );
}
#[test]
fn scope_expiry_after_approval_at_final_native_gate_dispatches_nothing_and_cannot_renew() {
    let _test_guard = crate::reset_shared_registries_for_test();
    use crate::native_provider_transport::{
        CredentialBytes, DispatchSignal, FailureCode, RequestView, ResponseBuffer,
        SourceCheckFailure, SourceChecker, SourcePhase, SourceSnapshot, Transport,
        TransportFailure, WriteReceipt, WriteStatus,
    };
    use std::sync::atomic::{AtomicU64, AtomicUsize};
    struct SyntheticClock(AtomicU64);
    impl Clock for SyntheticClock {
        fn now_ms(&self) -> u64 {
            self.0.load(Ordering::Acquire)
        }
    }
    struct SyntheticSource;
    impl SourceChecker for SyntheticSource {
        fn check(
            &self,
            captured: &SourceSnapshot,
            _: SourcePhase,
        ) -> std::result::Result<SourceSnapshot, SourceCheckFailure> {
            Ok(captured.clone())
        }
    }
    struct ExpireAtFinalGate {
        clock: Arc<SyntheticClock>,
        checks: Arc<AtomicUsize>,
        dispatches: Arc<AtomicUsize>,
    }
    impl Transport for ExpireAtFinalGate {
        fn before_dispatch(
            &mut self,
            _: RequestView<'_>,
        ) -> std::result::Result<(), TransportFailure> {
            self.checks.fetch_add(1, Ordering::AcqRel);
            self.clock.0.store(21, Ordering::Release);
            Ok(())
        }
        fn dispatch(
            &mut self,
            _: RequestView<'_>,
            _: CredentialBytes<'_>,
            _: DispatchSignal<'_>,
            _: &mut ResponseBuffer,
        ) -> std::result::Result<WriteReceipt, TransportFailure> {
            self.dispatches.fetch_add(1, Ordering::AcqRel);
            Ok(WriteReceipt {
                write: WriteStatus::Complete,
            })
        }
    }
    let clock = Arc::new(SyntheticClock(AtomicU64::new(10)));
    let session = NativeSession::new(
        Owner {
            project: "fixture-project".into(),
            epoch: 1,
            run: "fixture-run".into(),
            conversation: "fixture-conversation".into(),
            provider: "fixture-provider".into(),
            model: "fixture-model".into(),
        },
        ConfigVersion {
            generation: "fixture-generation".into(),
            revision: 1,
        },
        [1; 32],
        clock.clone(),
    );
    session
        .install_credential(b"synthetic-deadline-fixture-only".to_vec(), 1_000)
        .unwrap();
    let original_run_deadline = 20;
    let deadline = request_deadline(clock.now_ms(), original_run_deadline, 1_000).unwrap();
    let lease = session.capture_lease(deadline).unwrap();
    let request = session
        .prepare(
            &lease,
            "https://api.openai.com/v1",
            br#"{"model":"fixture-model","input":"Synthetic task"}"#.to_vec(),
            &SyntheticSource,
        )
        .unwrap();
    let approval = session.approve(&request, &lease, &SyntheticSource).unwrap();
    let checks = Arc::new(AtomicUsize::new(0));
    let dispatches = Arc::new(AtomicUsize::new(0));
    let mut transport = ExpireAtFinalGate {
        clock: clock.clone(),
        checks: checks.clone(),
        dispatches: dispatches.clone(),
    };
    let outcome = session.dispatch(
        &request,
        &lease,
        &approval,
        &SyntheticSource,
        &mut transport,
    );
    assert_eq!(checks.load(Ordering::Acquire), 1);
    assert_eq!(dispatches.load(Ordering::Acquire), 0);
    assert_eq!(outcome.status, DispatchStatus::NotDispatched);
    assert_eq!(outcome.error, Some(FailureCode::Expired));
    assert!(outcome.response.is_none());
    assert_eq!(clock.now_ms(), 21);
    assert_eq!(
        request_deadline(clock.now_ms(), original_run_deadline, 1_000).unwrap_err(),
        "native_scope_expired"
    );
    session.clear_credential().unwrap();
}

#[test]
fn strict_ipc_dtos_reject_url_owner_window_lease_and_approval_injection() {
    let _test_guard = crate::reset_shared_registries_for_test();
    rejects_authority_fields::<OpenInput>(
        json!({"providerId":"fixture","modelId":"fixture-model","credential":"synthetic-local-only"}),
    );
    rejects_authority_fields::<ProfileInput>(json!({"profileId":"fixture"}));
    rejects_authority_fields::<BindInput>(
        json!({"profileId":"fixture","projectId":"fixture-project","runId":"fixture-run","scopeExpiresAt":9000}),
    );
    rejects_authority_fields::<PrepareInput>(
        json!({"runHandle":"fixture","body":"{\"model\":\"fixture-model\"}"}),
    );
    rejects_authority_fields::<RequestInput>(json!({"requestId":"fixture"}));
    rejects_authority_fields::<PollInput>(json!({"requestId":"fixture","cursor":0}));
    rejects_authority_fields::<RunInput>(json!({"runHandle":"fixture"}));
    rejects_authority_fields::<SaveInput>(
        json!({"runHandle":"fixture","record":continuation_record()}),
    );
    let mut record = continuation_record();
    record
        .as_object_mut()
        .unwrap()
        .insert("approvalGrant".into(), json!({"approved":true}));
    assert!(
        serde_json::from_value::<SaveInput>(json!({"runHandle":"fixture","record":record}))
            .is_err()
    );
    let mut record = continuation_record();
    record["owner"]
        .as_object_mut()
        .unwrap()
        .insert("lease".into(), json!({"current":true}));
    assert!(
        serde_json::from_value::<SaveInput>(json!({"runHandle":"fixture","record":record}))
            .is_err()
    );
    let mut bind = json!({"profileId":"fixture","projectId":"fixture-project","runId":"fixture-run","scopeExpiresAt":9000});
    let mut missing_expiry = bind.clone();
    missing_expiry
        .as_object_mut()
        .unwrap()
        .remove("scopeExpiresAt");
    assert!(serde_json::from_value::<BindInput>(missing_expiry).is_err());
    bind["projectEpoch"] = json!(55);
    assert!(serde_json::from_value::<BindInput>(bind).is_err());
}
#[test]
fn profile_lookup_enforces_current_window_alive_and_expiry() {
    let _test_guard = crate::reset_shared_registries_for_test();
    let mut fixture = Fixture::new();
    let config = fixture.config();
    let snapshot = fixture.save(&config);
    let valid = fixture.profile(&snapshot, "fixture-window-a", false);
    let expired = fixture.profile(&snapshot, "fixture-window-a", true);
    let closed = fixture.profile(&snapshot, "fixture-window-a", false);
    closed.alive.store(false, Ordering::Release);
    assert!(Arc::ptr_eq(
        &profile_owned(&valid.id, "fixture-window-a").unwrap(),
        &valid
    ));
    assert_eq!(
        profile_owned(&valid.id, "fixture-window-b").err().unwrap(),
        "native_responses_session_closed"
    );
    assert_eq!(
        profile_owned(&expired.id, "fixture-window-a")
            .err()
            .unwrap(),
        "native_responses_session_closed"
    );
    assert_eq!(
        profile_owned(&closed.id, "fixture-window-a").err().unwrap(),
        "native_responses_session_closed"
    );
    assert_eq!(
        profile_owned("missing-fixture-profile", "fixture-window-a")
            .err()
            .unwrap(),
        "native_responses_session_closed"
    );
}
#[test]
fn wrong_window_cannot_close_or_remove_another_profile_and_correct_close_revokes_held_arc() {
    let _test_guard = crate::reset_shared_registries_for_test();
    let mut fixture = Fixture::new();
    let config = fixture.config();
    let snapshot = fixture.save(&config);
    let profile = fixture.profile(&snapshot, "fixture-window-a", false);
    let held_before_close = profile_owned(&profile.id, "fixture-window-a").unwrap();
    assert_eq!(
        close_profile(&profile.id, "fixture-window-b").unwrap_err(),
        "native_responses_session_closed"
    );
    assert!(Arc::ptr_eq(
        &profile_owned(&profile.id, "fixture-window-a").unwrap(),
        &profile
    ));
    assert!(held_before_close.alive.load(Ordering::Acquire));
    close_profile(&profile.id, "fixture-window-a").unwrap();
    assert!(!held_before_close.alive.load(Ordering::Acquire));
    assert!(!lock(broker()).unwrap().profiles.contains_key(&profile.id));
    assert!(profile_owned(&profile.id, "fixture-window-a").is_err());
    close_profile(&profile.id, "fixture-window-a").unwrap();
}
#[test]
fn provider_update_guard_blocks_only_target_and_revokes_all_of_its_profiles() {
    let _test_guard = crate::reset_shared_registries_for_test();
    let mut fixture = Fixture::new();
    let target = fixture.config();
    let other = fixture.config();
    let target_snapshot = fixture.save(&target);
    let other_snapshot = fixture.save(&other);
    let target_a = fixture.profile(&target_snapshot, "fixture-window-a", false);
    let target_b = fixture.profile(&target_snapshot, "fixture-window-b", false);
    let unrelated = fixture.profile(&other_snapshot, "fixture-window-a", false);
    let update = begin_provider_update(&target.provider_id).unwrap();
    assert!(lock(broker())
        .unwrap()
        .updating
        .contains(&target.provider_id));
    assert_eq!(
        begin_provider_update(&target.provider_id).err().unwrap(),
        "native_responses_configuration_busy"
    );
    assert!(!target_a.alive.load(Ordering::Acquire));
    assert!(!target_b.alive.load(Ordering::Acquire));
    assert!(profile_owned(&target_a.id, "fixture-window-a").is_err());
    assert!(profile_owned(&target_b.id, "fixture-window-b").is_err());
    assert!(Arc::ptr_eq(
        &profile_owned(&unrelated.id, "fixture-window-a").unwrap(),
        &unrelated
    ));
    drop(update);
    assert!(!lock(broker())
        .unwrap()
        .updating
        .contains(&target.provider_id));
    assert!(unrelated.alive.load(Ordering::Acquire));
}
#[test]
fn independent_provider_updates_remain_blocked_until_their_own_guard_drops() {
    let _test_guard = crate::reset_shared_registries_for_test();
    let mut fixture = Fixture::new();
    let first = fixture.config();
    let second = fixture.config();
    let first_guard = begin_provider_update(&first.provider_id).unwrap();
    let second_guard = begin_provider_update(&second.provider_id).unwrap();
    drop(first_guard);
    {
        let state = lock(broker()).unwrap();
        assert!(!state.updating.contains(&first.provider_id));
        assert!(state.updating.contains(&second.provider_id));
    }
    drop(second_guard);
    assert!(!lock(broker())
        .unwrap()
        .updating
        .contains(&second.provider_id));
}
#[test]
fn real_settings_reopen_preserves_explicit_responses_model_fingerprint_without_connection_proof() {
    let _test_guard = crate::reset_shared_registries_for_test();
    let mut fixture = Fixture::new();
    let mut config = fixture.config();
    let mut second_model = config.models[0].clone();
    second_model.id = "fixture-alternative-model".into();
    config.models.push(second_model);
    let saved = fixture.save(&config);
    let loaded = provider(&fixture.root, &config.provider_id, "fixture-model").unwrap();
    let reopened = provider(&fixture.root, &config.provider_id, "fixture-model").unwrap();
    assert_eq!(saved, loaded);
    assert_eq!(loaded, reopened);
    assert_eq!(loaded.config.wire_api, WireApi::Responses);
    assert_eq!(loaded.config.base_url, "https://api.openai.com/v1");
    assert_eq!(
        prepare_responses_endpoint(&loaded.config.base_url).unwrap(),
        "https://api.openai.com/v1/responses"
    );
    assert!(!loaded.connection_verified);
    assert!(loaded.requires_new_session);
    assert!(loaded
        .models
        .iter()
        .all(|model| !model.currently_verified && model.historical_evidence.is_none()));
    let selected = fingerprint(&loaded, "fixture-model").unwrap();
    assert_eq!(selected.len(), 64);
    assert!(selected.bytes().all(|byte| byte.is_ascii_hexdigit()));
    assert_eq!(selected, fingerprint(&reopened, "fixture-model").unwrap());
    assert_ne!(
        selected,
        fingerprint(&loaded, "fixture-alternative-model").unwrap()
    );
    assert!(fingerprint(&loaded, "missing-model").is_err());
    assert!(provider(&fixture.root, &config.provider_id, "missing-model").is_err());
    assert!(provider(&fixture.root, "missing-provider", "fixture-model").is_err());
    // Serialized settings contain no session credential or approval record.
    let document = serde_json::to_value(&loaded).unwrap();
    assert_eq!(document["connectionVerified"], json!(false));
    assert!(document.get("credential").is_none());
    assert!(document.get("approval").is_none());
}
#[test]
fn provider_resolution_refuses_disabled_wrong_protocol_auth_and_nontransport_endpoint() {
    let _test_guard = crate::reset_shared_registries_for_test();
    let mut fixture = Fixture::new();
    let mut config = fixture.config();
    fixture.save(&config);
    config.enabled = false;
    fixture.save(&config);
    assert_eq!(
        provider(&fixture.root, &config.provider_id, "fixture-model").unwrap_err(),
        "native_responses_configuration_unavailable"
    );
    config.enabled = true;
    config.auth_mode = AuthMode::None;
    fixture.save(&config);
    assert_eq!(
        provider(&fixture.root, &config.provider_id, "fixture-model").unwrap_err(),
        "native_responses_configuration_unavailable"
    );
    config.auth_mode = AuthMode::EnvKey;
    config.wire_api = WireApi::ChatCompletions;
    fixture.save(&config);
    assert_eq!(
        provider(&fixture.root, &config.provider_id, "fixture-model").unwrap_err(),
        "native_responses_configuration_unavailable"
    );
    config.wire_api = WireApi::Responses;
    config.base_url = "https://api.openai.com".into();
    let snapshot = fixture.save(&config);
    assert!(!snapshot.connection_verified);
    assert_eq!(
        provider(&fixture.root, &config.provider_id, "fixture-model").unwrap_err(),
        "native_responses_endpoint_rejected"
    );
}
