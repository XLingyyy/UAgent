//! Controlled SQLite reopen/crash-window fixtures; no real process crash, power loss, UE or API.
use super::*;
use crate::local_run_store::{NewRun, Origin, Project, Session};
use std::{
    cell::{Cell, RefCell},
    fs,
    path::PathBuf,
    sync::atomic::AtomicU64,
};
static NEXT: AtomicU64 = AtomicU64::new(1);
struct Fixture {
    path: PathBuf,
}
impl Fixture {
    fn new() -> Self {
        let parent = PathBuf::from(
            std::env::var_os("UAGENT_EFFECT_TEST_DIR").expect("E/G fixture parent required"),
        );
        assert!(
            parent.is_absolute()
                && matches!(
                    parent.to_string_lossy().as_bytes()[0].to_ascii_uppercase(),
                    b'E' | b'G'
                )
        );
        fs::create_dir_all(&parent).unwrap();
        let path = parent.join(format!(
            "effect-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).unwrap();
        fs::create_dir(path.join("project")).unwrap();
        let f = Self { path };
        let store = f.store();
        setup(&store, "project-a");
        f
    }
    fn store(&self) -> RunStore {
        RunStore::open(self.path.join("store")).unwrap()
    }
    fn root(&self) -> TrustedRootHandle {
        TrustedRootHandle::open_from_host_selection(&self.path.join("project")).unwrap()
    }
}
// Intentionally preserve these uniquely owned small test DBs/logs for review. No recursive deletion.
fn setup(store: &RunStore, project: &str) {
    store
        .create_project(&Project {
            id: project.into(),
            root: format!("G:/Synthetic/{project}"),
            label: project.into(),
            created_at: 1,
        })
        .unwrap();
    store
        .create_session(&Session {
            project_id: project.into(),
            id: "conversation".into(),
            title: "Synthetic".into(),
            created_at: 1,
            archived: false,
            parent_id: None,
            origin: Origin::Native,
        })
        .unwrap();
    store
        .start_run(
            project,
            &NewRun {
                id: "run".into(),
                session_id: "conversation".into(),
                goal: "Synthetic reconciliation".into(),
                created_at: 1,
            },
        )
        .unwrap();
}
fn owner() -> OperationOwner {
    OperationOwner {
        scope_id: "scope-a".into(),
        run_id: "run".into(),
        project_id: "project-a".into(),
        root_ref: "canonical-project-root".into(),
        conversation_id: "conversation".into(),
        provider_id: "fixture".into(),
        model_id: "fixture".into(),
        step_id: "step".into(),
        execution_id: "native-execution-unique".into(),
        host_generation: "host-before-restart".into(),
    }
}
fn intent(root: &TrustedRootHandle) -> EffectIntent {
    EffectIntent {
        key: EffectKey {
            project_id: "project-a".into(),
            operation_id: "operation-a".into(),
        },
        owner: owner(),
        root_object_id: root.identity().observation_key(),
        adapter: AdapterIdentity {
            id: "fixture.exact-effect".into(),
            version: 1,
        },
        idempotency_key: hash(b"host-native-idempotency"),
        approved_plan_digest: hash(b"exact user-reviewed plan"),
        plan_summary: "Synthetic two-file source repair".into(),
        targets: vec![
            EffectTarget {
                kind: TargetKind::File,
                locator: "Source/A.cpp".into(),
                before_digest: Some(hash(b"before-a")),
                after_digest: Some(hash(b"after-a")),
            },
            EffectTarget {
                kind: TargetKind::File,
                locator: "Source/B.cpp".into(),
                before_digest: Some(hash(b"before-b")),
                after_digest: Some(hash(b"after-b")),
            },
        ],
        resources: vec![ResourceClaim {
            kind: ResourceKind::FileWrite,
            key: "root-volume-fileid".into(),
        }],
        created_at: 2,
    }
}
fn scope<'a>(
    root: &'a TrustedRootHandle,
    i: &EffectIntent,
    current: &'a dyn Fn() -> bool,
) -> RecoveryReadScope<'a> {
    RecoveryReadScope::from_verified_host_read(
        root,
        i.key.clone(),
        i.owner.clone(),
        "host-after-restart-fresh-read".into(),
        current,
    )
    .unwrap()
}
fn observation(q: &EffectQuery, outcome: EffectOutcome) -> EffectObservation {
    EffectObservation {
        query_id: q.query_id.clone(),
        key: q.intent.key.clone(),
        owner: q.intent.owner.clone(),
        root_object_id: q.intent.root_object_id.clone(),
        intent_digest: q.intent_digest.clone(),
        idempotency_key: q.intent.idempotency_key.clone(),
        query_scope_digest: q.query_scope_digest.clone(),
        outcome,
        execution: ExecutionObservation::Quiescent,
        coverage: Coverage::Exact,
        attribution: Attribution::OperationBound,
        evidence_digest: Some(hash(b"synthetic exact operation receipt and all targets")),
        reason: UnknownReason::None,
    }
}
struct Observer<F>(F);
impl<
        F: Fn(&EffectQuery, &AtomicBool) -> std::result::Result<EffectObservation, ObserverFailure>,
    > ReadOnlyEffectObserver for Observer<F>
{
    fn adapter_identity(&self) -> AdapterIdentity {
        AdapterIdentity {
            id: "fixture.exact-effect".into(),
            version: 1,
        }
    }
    fn observe(
        &self,
        _: &RecoveryReadScope<'_>,
        q: &EffectQuery,
        c: &AtomicBool,
    ) -> std::result::Result<EffectObservation, ObserverFailure> {
        (self.0)(q, c)
    }
}
fn handoff(j: &EffectJournal<'_>, c: &CurrentRun<'_>, i: &EffectIntent) {
    let mut ticket = j.mark_may_have_been_sent(c, &i.key, 1, 3).unwrap();
    j.dispatch_once(c, &mut ticket, |_| ()).unwrap();
}
fn err<T>(value: Result<T>) -> String {
    value.err().expect("must reject").kind
}

#[test]
fn extension_is_opt_in_reuses_database_and_preserves_run_schema() {
    assert_eq!(json(&ResourceKind::UeEditor).unwrap(), "\"ue-editor\"");
    assert_eq!(json(&ResourceKind::Ubt).unwrap(), "\"ubt\"");
    assert_eq!(json(&ResourceKind::FileWrite).unwrap(), "\"file-write\"");
    let f = Fixture::new();
    let store = f.store();
    assert_eq!(store.schema_version().unwrap(), 2);
    assert!(store
        .db
        .query(
            "SELECT name FROM sqlite_master WHERE name='effect_intents'",
            &[]
        )
        .unwrap()
        .is_empty());
    let _journal = store.open_effect_journal().unwrap();
    assert_eq!(store.schema_version().unwrap(), 2);
    assert_eq!(store.run("project-a", "run").unwrap().revision, 0);
    assert_eq!(
        store.db.query("PRAGMA journal_mode", &[]).unwrap()[0][0]
            .text()
            .unwrap(),
        "delete"
    );
    assert_eq!(
        store.db.query("PRAGMA synchronous", &[]).unwrap()[0][0]
            .int()
            .unwrap(),
        2
    );
    store
        .db
        .execute("UPDATE effect_journal_meta SET version=99", &[])
        .unwrap();
    assert_eq!(err(store.open_effect_journal()), "newerSchema");
    assert_eq!(
        store
            .db
            .query("SELECT version FROM effect_journal_meta", &[])
            .unwrap()[0][0]
            .int()
            .unwrap(),
        99
    );
}
#[test]
fn immutable_intent_and_idempotency_survive_reopen_without_authority() {
    let f = Fixture::new();
    let root = f.root();
    let i = intent(&root);
    let yes = || true;
    {
        let store = f.store();
        let j = store.open_effect_journal().unwrap();
        let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
        assert_eq!(j.prepare(&c, &i).unwrap().state, EffectState::Prepared);
        assert_eq!(j.prepare(&c, &i).unwrap().revision, 1);
        let mut other = i.clone();
        other.approved_plan_digest = hash(b"changed-plan");
        assert_eq!(err(j.prepare(&c, &other)), "conflict");
        other = i.clone();
        other.key.operation_id = "operation-b".into();
        assert_eq!(err(j.prepare(&c, &other)), "constraint");
    }
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let s = scope(&root, &i, &yes);
    let saved = j.read(&s).unwrap();
    assert_eq!(saved.intent, i);
    assert_eq!(
        saved.recovery_advice(),
        RecoveryAdvice::ReviewPreparedWithFreshApproval
    );
    assert_eq!(j.events(&s, 0, 100).unwrap().len(), 1);
    let text = json(&saved).unwrap();
    for key in ["approvalToken", "apiKey", "credential", "executionToken"] {
        assert!(!text.contains(key));
    }
}
#[test]
fn durable_pre_send_and_one_use_gate_cover_send_and_result_crash_windows() {
    let f = Fixture::new();
    let root = f.root();
    let i = intent(&root);
    let yes = || true;
    let sends = Cell::new(0);
    {
        let store = f.store();
        let j = store.open_effect_journal().unwrap();
        let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
        j.prepare(&c, &i).unwrap();
        let mut t = j.mark_may_have_been_sent(&c, &i.key, 1, 3).unwrap();
        assert_eq!(
            j.read(&scope(&root, &i, &yes)).unwrap().state,
            EffectState::MayHaveBeenSent
        );
        j.dispatch_once(&c, &mut t, |_| sends.set(sends.get() + 1))
            .unwrap();
        assert_eq!(
            err(j.dispatch_once(&c, &mut t, |_| sends.set(99))),
            "conflict"
        );
    }
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let s = scope(&root, &i, &yes);
    assert!(j.read(&s).unwrap().blocks_conflicting_admission());
    let result = j
        .reconcile(
            &s,
            2,
            4,
            &Observer(|q: &EffectQuery, _: &AtomicBool| {
                Ok(observation(q, EffectOutcome::Completed))
            }),
            &AtomicBool::new(false),
        )
        .unwrap();
    assert_eq!(result.record.state, EffectState::VerifiedCompleted);
    assert_eq!(sends.get(), 1);
    assert_eq!(
        result.execution_observation(&s),
        ExecutionObservation::Quiescent
    );
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    assert_eq!(
        err(j.mark_may_have_been_sent(&c, &i.key, 3, 5)),
        "freshApprovalRequired"
    );
    assert_eq!(j.prepare(&c, &i).unwrap().revision, 3); // Creation replay never recreates a send permit.
}
#[test]
fn crash_after_gate_before_send_remains_unknown_and_never_blindly_replays() {
    let f = Fixture::new();
    let root = f.root();
    let i = intent(&root);
    let yes = || true;
    {
        let store = f.store();
        let j = store.open_effect_journal().unwrap();
        let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
        j.prepare(&c, &i).unwrap();
        let _lost_ticket = j.mark_may_have_been_sent(&c, &i.key, 1, 3).unwrap();
    }
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let s = scope(&root, &i, &yes);
    let result = j
        .reconcile(
            &s,
            2,
            4,
            &Observer(|_: &EffectQuery, _: &AtomicBool| Err(ObserverFailure::Unavailable)),
            &AtomicBool::new(false),
        )
        .unwrap();
    assert_eq!(result.record.state, EffectState::ResultUnknown);
    assert_eq!(result.record.reason, UnknownReason::ObserverUnavailable);
    assert_eq!(
        result.execution_observation(&s),
        ExecutionObservation::Unknown
    );
    assert!(result.record.blocks_conflicting_admission());
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    assert_eq!(
        err(j.mark_may_have_been_sent(&c, &i.key, 3, 5)),
        "freshApprovalRequired"
    );
}
#[test]
fn gate_cannot_be_adopted_by_new_context_even_with_identical_saved_owner() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    let mut t = j.mark_may_have_been_sent(&c, &i.key, 1, 3).unwrap();
    let new_context = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    let called = Cell::new(false);
    assert_eq!(
        err(j.dispatch_once(&new_context, &mut t, |_| called.set(true))),
        "staleOwner"
    );
    assert!(!called.get());
}
#[test]
fn write_failure_before_dispatch_or_after_observation_never_authorizes_success() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    let s = scope(&root, &i, &yes);
    store.db.execute("PRAGMA query_only=ON", &[]).unwrap();
    assert_eq!(err(j.mark_may_have_been_sent(&c, &i.key, 1, 3)), "sqlite");
    assert_eq!(j.read(&s).unwrap().state, EffectState::Prepared);
    store.db.execute("PRAGMA query_only=OFF", &[]).unwrap();
    handoff(&j, &c, &i);

    let observed = Cell::new(0);
    assert_eq!(
        err(j.reconcile(
            &s,
            2,
            4,
            &Observer(|q: &EffectQuery, _: &AtomicBool| {
                observed.set(1);
                store.db.execute("PRAGMA query_only=ON", &[]).unwrap();
                Ok(observation(q, EffectOutcome::Completed))
            }),
            &AtomicBool::new(false)
        )),
        "sqlite"
    );
    assert_eq!(observed.get(), 1);
    assert_eq!(j.read(&s).unwrap().state, EffectState::MayHaveBeenSent);
    assert_eq!(j.events(&s, 0, 100).unwrap().len(), 2);
}
#[test]
fn actual_sqlite_commit_failure_rolls_back_state_and_audit_and_returns_no_gate() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    store
        .db
        .execute("CREATE TABLE commit_parent(id INTEGER PRIMARY KEY)", &[])
        .unwrap();
    store.db.execute("CREATE TABLE commit_child(id INTEGER PRIMARY KEY,parent INTEGER REFERENCES commit_parent(id) DEFERRABLE INITIALLY DEFERRED)",&[]).unwrap();
    store.db.execute("CREATE TRIGGER inject_commit_failure AFTER UPDATE ON effect_intents BEGIN INSERT INTO commit_child(id,parent) VALUES(1,999); END",&[]).unwrap();
    assert_eq!(
        err(j.mark_may_have_been_sent(&c, &i.key, 1, 3)),
        "constraint"
    );
    let s = scope(&root, &i, &yes);
    assert_eq!(j.read(&s).unwrap().state, EffectState::Prepared);
    assert_eq!(j.events(&s, 0, 100).unwrap().len(), 1);
    assert!(store
        .db
        .query("SELECT * FROM commit_child", &[])
        .unwrap()
        .is_empty());
}
#[test]
fn cross_project_root_and_original_execution_owner_queries_are_rejected() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    setup(&store, "project-b");
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    let mut other = i.clone();
    other.key.project_id = "project-b".into();
    other.owner.project_id = "project-b".into();
    let s = scope(&root, &other, &yes);
    assert_eq!(err(j.read(&s)), "notFound");
    fs::create_dir(f.path.join("other-project")).unwrap();
    let other_root =
        TrustedRootHandle::open_from_host_selection(&f.path.join("other-project")).unwrap();
    assert_eq!(err(j.read(&scope(&other_root, &i, &yes))), "staleOwner");
    other = i.clone();
    other.owner.execution_id = "new-native-execution".into();
    assert_eq!(err(j.read(&scope(&root, &other, &yes))), "staleOwner");
    assert!(j.pending("project-b", 100, 0).unwrap().records.is_empty());
}
#[test]
fn revoked_owner_root_and_late_query_results_cannot_confirm_anything() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let active = Cell::new(true);
    let live = || active.get();
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &live).unwrap();
    j.prepare(&c, &i).unwrap();
    let mut t = j.mark_may_have_been_sent(&c, &i.key, 1, 3).unwrap();
    active.set(false);
    assert_eq!(
        err(j.dispatch_once(&c, &mut t, |_| panic!("must not send"))),
        "staleOwner"
    );
    assert_eq!(
        err(RecoveryReadScope::from_verified_host_read(
            &root,
            i.key.clone(),
            i.owner.clone(),
            "fresh-reader".into(),
            &live
        )),
        "staleOwner"
    );
    let s = scope(&root, &i, &yes);
    assert_eq!(
        err(j.reconcile(
            &s,
            2,
            4,
            &Observer(|q: &EffectQuery, _: &AtomicBool| {
                root.revoke();
                Ok(observation(q, EffectOutcome::Completed))
            }),
            &AtomicBool::new(false)
        )),
        "staleOwner"
    );
    let reopened = f.root();
    let fresh = scope(&reopened, &i, &yes);
    assert_eq!(j.read(&fresh).unwrap().state, EffectState::MayHaveBeenSent);
}

#[test]
fn every_observation_identity_and_query_nonce_is_exactly_bound() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    handoff(&j, &c, &i);
    let s = scope(&root, &i, &yes);
    for field in 0..10 {
        let o = Observer(|q: &EffectQuery, _: &AtomicBool| {
            let mut o = observation(q, EffectOutcome::Completed);
            match field {
                0 => o.query_id = hash(b"stale query"),
                1 => o.key.operation_id = "other-operation".into(),
                2 => o.key.project_id = "project-b".into(),
                3 => o.owner.execution_id = "new owner".into(),
                4 => o.owner.host_generation = "new host".into(),
                5 => o.root_object_id = "other root".into(),
                6 => o.intent_digest = hash(b"wrong plan"),
                7 => o.idempotency_key = hash(b"wrong idempotency"),
                8 => o.query_scope_digest = hash(b"less targets"),
                _ => o.owner.scope_id = "different scope".into(),
            };
            Ok(o)
        });
        assert_eq!(
            err(j.reconcile(&s, 2, 4, &o, &AtomicBool::new(false))),
            "observationMismatch"
        );
        assert_eq!(j.read(&s).unwrap().revision, 2);
    }
    let cached = RefCell::new(None);
    j.reconcile(
        &s,
        2,
        4,
        &Observer(|q: &EffectQuery, _: &AtomicBool| {
            let o = observation(q, EffectOutcome::Completed);
            *cached.borrow_mut() = Some(o.clone());
            Ok(o)
        }),
        &AtomicBool::new(false),
    )
    .unwrap();
    assert_eq!(
        err(j.reconcile(
            &s,
            3,
            5,
            &Observer(|_: &EffectQuery, _: &AtomicBool| Ok(cached
                .borrow()
                .as_ref()
                .unwrap()
                .clone())),
            &AtomicBool::new(false)
        )),
        "observationMismatch"
    );
}
#[test]
fn partial_unowned_or_active_absence_proofs_stay_unknown() {
    for mode in 0..5 {
        let f = Fixture::new();
        let root = f.root();
        let store = f.store();
        let j = store.open_effect_journal().unwrap();
        let i = intent(&root);
        let yes = || true;
        let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
        j.prepare(&c, &i).unwrap();
        handoff(&j, &c, &i);
        let s = scope(&root, &i, &yes);
        let r = j
            .reconcile(
                &s,
                2,
                4,
                &Observer(|q: &EffectQuery, _: &AtomicBool| {
                    let mut o = observation(q, EffectOutcome::NotOccurred);
                    match mode {
                        0 => o.coverage = Coverage::Partial,
                        1 => o.attribution = Attribution::Unproven,
                        2 => o.execution = ExecutionObservation::Active,
                        3 => o.execution = ExecutionObservation::Unknown,
                        _ => o.evidence_digest = None,
                    };
                    Ok(o)
                }),
                &AtomicBool::new(false),
            )
            .unwrap();
        assert_eq!(r.record.state, EffectState::ResultUnknown);
        assert!(r.record.blocks_conflicting_admission());
        if mode == 0 || mode == 1 {
            assert_eq!(r.execution_observation(&s), ExecutionObservation::Unknown);
        }
        if mode == 2 {
            assert_eq!(r.execution_observation(&s), ExecutionObservation::Active);
        }
    }
}
#[test]
fn effect_uncertainty_and_execution_quiescence_are_separate_and_never_rehydrated() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    handoff(&j, &c, &i);
    let s = scope(&root, &i, &yes);
    let mut r = j
        .reconcile(
            &s,
            2,
            4,
            &Observer(|q: &EffectQuery, _: &AtomicBool| {
                let mut o = observation(q, EffectOutcome::Unknown);
                o.reason = UnknownReason::ExternalChange;
                Ok(o)
            }),
            &AtomicBool::new(false),
        )
        .unwrap();
    assert!(r.record.blocks_conflicting_admission());
    assert_eq!(r.execution_observation(&s), ExecutionObservation::Quiescent);
    let new_scope = scope(&root, &i, &yes);
    assert_eq!(
        r.execution_observation(&new_scope),
        ExecutionObservation::Unknown
    );
    r.observed_at = Instant::now() - Duration::from_secs(6);
    assert_eq!(r.execution_observation(&s), ExecutionObservation::Unknown);
    let saved = j.read(&s).unwrap();
    assert_eq!(
        saved.last_observation.as_ref().unwrap().execution,
        ExecutionObservation::Quiescent
    );
    // Stored quiescent JSON has no constructor for ReconciliationResult/live queue release proof.
    assert!(saved.blocks_conflicting_admission());
}
#[test]
fn verified_absence_allows_only_a_new_review_not_automatic_resend() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    handoff(&j, &c, &i);
    let s = scope(&root, &i, &yes);
    let r = j
        .reconcile(
            &s,
            2,
            4,
            &Observer(|q: &EffectQuery, _: &AtomicBool| {
                Ok(observation(q, EffectOutcome::NotOccurred))
            }),
            &AtomicBool::new(false),
        )
        .unwrap();
    assert_eq!(r.record.state, EffectState::VerifiedNotOccurred);
    assert!(!r.record.blocks_conflicting_admission());
    assert_eq!(
        r.record.recovery_advice(),
        RecoveryAdvice::NewAttemptNeedsFreshApproval
    );
    assert_eq!(
        err(j.mark_may_have_been_sent(&c, &i.key, 3, 5)),
        "freshApprovalRequired"
    );
}
#[test]
fn duplicate_confirmation_does_not_duplicate_history_or_flip_a_final_result() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    handoff(&j, &c, &i);
    let s = scope(&root, &i, &yes);
    let good =
        Observer(|q: &EffectQuery, _: &AtomicBool| Ok(observation(q, EffectOutcome::Completed)));
    assert_eq!(
        j.reconcile(&s, 2, 4, &good, &AtomicBool::new(false))
            .unwrap()
            .record
            .revision,
        3
    );
    assert_eq!(
        j.reconcile(&s, 3, 5, &good, &AtomicBool::new(false))
            .unwrap()
            .record
            .revision,
        3
    );
    assert_eq!(j.events(&s, 0, 100).unwrap().len(), 3);
    let r = j
        .reconcile(
            &s,
            3,
            6,
            &Observer(|q: &EffectQuery, _: &AtomicBool| {
                Ok(observation(q, EffectOutcome::NotOccurred))
            }),
            &AtomicBool::new(false),
        )
        .unwrap();
    assert_eq!(r.record.state, EffectState::ResultUnknown);
    assert!(r.record.manual_review_required);
    assert!(r.record.blocks_conflicting_admission());
    let r = j
        .reconcile(&s, 4, 7, &good, &AtomicBool::new(false))
        .unwrap();
    assert!(r.record.manual_review_required);
    assert_eq!(r.record.recovery_advice(), RecoveryAdvice::ManualReview);
}
#[test]
fn impossible_completion_before_dispatch_is_quarantined() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    let s = scope(&root, &i, &yes);
    let r = j
        .reconcile(
            &s,
            1,
            3,
            &Observer(|q: &EffectQuery, _: &AtomicBool| {
                Ok(observation(q, EffectOutcome::Completed))
            }),
            &AtomicBool::new(false),
        )
        .unwrap();
    assert!(r.record.manual_review_required);
    assert!(!r.record.may_have_been_sent);
    assert!(r.record.blocks_conflicting_admission());
}
#[test]
fn cancellation_before_and_after_pre_send_never_undoes_or_resends() {
    for sent in [false, true] {
        let f = Fixture::new();
        let root = f.root();
        let store = f.store();
        let j = store.open_effect_journal().unwrap();
        let i = intent(&root);
        let yes = || true;
        let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
        j.prepare(&c, &i).unwrap();
        let s = scope(&root, &i, &yes);
        let mut ticket = if sent {
            Some(j.mark_may_have_been_sent(&c, &i.key, 1, 3).unwrap())
        } else {
            None
        };
        let r = j.request_cancel(&s, if sent { 2 } else { 1 }, 4).unwrap();
        assert!(r.cancel_requested);
        if sent {
            assert_eq!(r.state, EffectState::ResultUnknown);
            assert!(r.blocks_conflicting_admission());
            assert_eq!(
                err(j.dispatch_once(&c, ticket.as_mut().unwrap(), |_| panic!("must not send"))),
                "conflict"
            );
        } else {
            assert_eq!(r.state, EffectState::VerifiedNotOccurred);
            assert!(!r.blocks_conflicting_admission());
        }
    }
}
#[test]
fn cancelled_queries_and_late_results_are_discarded_without_db_confirmation() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    handoff(&j, &c, &i);
    let s = scope(&root, &i, &yes);
    let stop = AtomicBool::new(true);
    let calls = Cell::new(0);
    let o = Observer(|q: &EffectQuery, cancel: &AtomicBool| {
        calls.set(calls.get() + 1);
        cancel.store(true, Ordering::Release);
        Ok(observation(q, EffectOutcome::Completed))
    });
    assert_eq!(err(j.reconcile(&s, 2, 4, &o, &stop)), "cancelled");
    assert_eq!(calls.get(), 0);
    stop.store(false, Ordering::Release);
    assert_eq!(err(j.reconcile(&s, 2, 4, &o, &stop)), "cancelled");
    assert_eq!(calls.get(), 1);
    assert_eq!(j.read(&s).unwrap().revision, 2);
}
#[test]
fn revision_conflict_during_query_preserves_newer_cancel_and_retains_unknown_work() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    handoff(&j, &c, &i);
    let s = scope(&root, &i, &yes);
    let o = Observer(|q: &EffectQuery, _: &AtomicBool| {
        j.request_cancel(&s, 2, 4).unwrap();
        Ok(observation(q, EffectOutcome::Completed))
    });
    assert_eq!(
        err(j.reconcile(&s, 2, 5, &o, &AtomicBool::new(false))),
        "conflict"
    );
    let saved = j.read(&s).unwrap();
    assert!(saved.cancel_requested);
    assert_eq!(saved.state, EffectState::ResultUnknown);
    assert_eq!(saved.revision, 3);
}
#[test]
fn serialized_plan_is_closed_bounded_and_cannot_store_approval_fields() {
    let f = Fixture::new();
    let root = f.root();
    let i = intent(&root);
    let mut v = serde_json::to_value(&i).unwrap();
    v["approvalToken"] = serde_json::json!("forbidden");
    assert!(serde_json::from_value::<EffectIntent>(v).is_err());
    for mode in 0..7 {
        let mut bad = i.clone();
        match mode {
            0 => bad.targets[0].locator = "../secret".into(),
            1 => bad.targets[0].locator = "Source\\A.cpp".into(),
            2 => bad.targets.push(bad.targets[0].clone()),
            3 => bad.approved_plan_digest = "not-hash".into(),
            4 => bad.targets[0].before_digest = Some("not-hash".into()),
            5 => bad.targets = vec![bad.targets[0].clone(); 129],
            _ => bad.resources.clear(),
        };
        assert!(bad.validate().is_err());
    }
}
#[test]
fn damaged_saved_payload_fails_closed_instead_of_skipping_pending_work() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    store
        .db
        .execute("UPDATE effect_intents SET payload='{}'", &[])
        .unwrap();
    assert_eq!(err(j.read(&scope(&root, &i, &yes))), "corrupt");
    assert_eq!(err(j.pending("project-a", 100, 0)), "corrupt");
}
#[test]
fn paginated_pending_scan_cannot_skip_later_unknown_work_after_an_empty_page() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    j.request_cancel(&scope(&root, &i, &yes), 1, 3).unwrap();
    let mut later = i.clone();
    later.key.operation_id = "operation-z".into();
    later.idempotency_key = hash(b"separate operation");
    later.owner.execution_id = "other-execution".into();
    let c2 = CurrentRun::from_verified_host(&root, later.owner.clone(), &yes).unwrap();
    j.prepare(&c2, &later).unwrap();
    j.mark_may_have_been_sent(&c2, &later.key, 1, 3).unwrap();
    let first = j.pending("project-a", 1, 0).unwrap();
    assert!(first.records.is_empty());
    assert_eq!(first.next_offset, Some(1));
    let second = j
        .pending("project-a", 1, first.next_offset.unwrap())
        .unwrap();
    assert_eq!(second.records[0].intent.key, later.key);
    assert_eq!(second.next_offset, None);
}
#[test]
fn unknown_result_mark_and_unsupported_observer_preserve_original_execution() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    handoff(&j, &c, &i);
    j.mark_result_unknown(&c, &i.key, 2, 4).unwrap();
    let s = scope(&root, &i, &yes);
    let r = j
        .reconcile(
            &s,
            3,
            5,
            &Observer(|_: &EffectQuery, _: &AtomicBool| Err(ObserverFailure::Unsupported)),
            &AtomicBool::new(false),
        )
        .unwrap();
    assert_eq!(r.record.intent.owner, i.owner);
    assert_eq!(r.record.reason, UnknownReason::UnsupportedAdapter);
    assert_eq!(r.execution_observation(&s), ExecutionObservation::Unknown);
}

#[test]
fn prepared_record_cannot_recreate_gate_after_reopen_even_with_copied_owner() {
    let f = Fixture::new();
    let root = f.root();
    let i = intent(&root);
    let yes = || true;
    {
        let store = f.store();
        let j = store.open_effect_journal().unwrap();
        let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
        j.prepare(&c, &i).unwrap();
    }
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    assert_eq!(j.prepare(&c, &i).unwrap().state, EffectState::Prepared);
    assert_eq!(
        err(j.mark_may_have_been_sent(&c, &i.key, 1, 3)),
        "freshApprovalRequired"
    );
    // A newly selected native read context may abandon it, but cannot restore an old grant.
    let r = j.request_cancel(&scope(&root, &i, &yes), 1, 3).unwrap();
    assert_eq!(r.state, EffectState::VerifiedNotOccurred);
}
#[test]
fn overly_slow_read_observer_result_cannot_be_committed_as_fresh() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    handoff(&j, &c, &i);
    let s = scope(&root, &i, &yes);
    let o = Observer(|q: &EffectQuery, _: &AtomicBool| {
        std::thread::sleep(Duration::from_millis(5100));
        Ok(observation(q, EffectOutcome::Completed))
    });
    assert_eq!(
        err(j.reconcile(&s, 2, 4, &o, &AtomicBool::new(false))),
        "observationExpired"
    );
    assert_eq!(j.read(&s).unwrap().revision, 2);
}

#[test]
fn temporary_observation_failures_do_not_permanently_quarantine_verified_results() {
    for known in [EffectOutcome::Completed, EffectOutcome::NotOccurred] {
        for failure in [
            ObserverFailure::Unavailable,
            ObserverFailure::Unsupported,
            ObserverFailure::Partial,
        ] {
            let f = Fixture::new();
            let root = f.root();
            let store = f.store();
            let j = store.open_effect_journal().unwrap();
            let i = intent(&root);
            let yes = || true;
            let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
            j.prepare(&c, &i).unwrap();
            handoff(&j, &c, &i);
            let s = scope(&root, &i, &yes);
            let good = Observer(|q: &EffectQuery, _: &AtomicBool| Ok(observation(q, known)));
            j.reconcile(&s, 2, 4, &good, &AtomicBool::new(false))
                .unwrap();
            let uncertain = j
                .reconcile(
                    &s,
                    3,
                    5,
                    &Observer(|_: &EffectQuery, _: &AtomicBool| Err(failure)),
                    &AtomicBool::new(false),
                )
                .unwrap();
            assert_eq!(uncertain.record.state, EffectState::ResultUnknown);
            assert!(!uncertain.record.manual_review_required);
            assert_eq!(uncertain.record.last_verified_outcome, Some(known));
            let recovered = j
                .reconcile(&s, 4, 6, &good, &AtomicBool::new(false))
                .unwrap();
            assert!(!recovered.record.blocks_conflicting_admission());
            assert_eq!(recovered.record.last_verified_outcome, Some(known));
        }
    }
}
#[test]
fn an_unknown_window_cannot_erase_a_previous_opposite_verified_fact() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    handoff(&j, &c, &i);
    let s = scope(&root, &i, &yes);
    j.reconcile(
        &s,
        2,
        4,
        &Observer(|q: &EffectQuery, _: &AtomicBool| Ok(observation(q, EffectOutcome::Completed))),
        &AtomicBool::new(false),
    )
    .unwrap();
    j.reconcile(
        &s,
        3,
        5,
        &Observer(|_: &EffectQuery, _: &AtomicBool| Err(ObserverFailure::Unavailable)),
        &AtomicBool::new(false),
    )
    .unwrap();
    let r = j
        .reconcile(
            &s,
            4,
            6,
            &Observer(|q: &EffectQuery, _: &AtomicBool| {
                Ok(observation(q, EffectOutcome::NotOccurred))
            }),
            &AtomicBool::new(false),
        )
        .unwrap();
    assert!(r.record.manual_review_required);
    assert_eq!(
        r.record.last_verified_outcome,
        Some(EffectOutcome::Completed)
    );
    assert!(r.record.blocks_conflicting_admission());
}

#[test]
fn completed_or_other_journal_cancelled_preparations_do_not_leak_volatile_capacity() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let yes = || true;
    for index in 0..130 {
        let mut i = intent(&root);
        i.key.operation_id = format!("operation-{index}");
        i.idempotency_key = hash(format!("idempotency-{index}").as_bytes());
        i.owner.execution_id = format!("native-{index}");
        let c = CurrentRun::from_verified_host(&root, i.owner.clone(), &yes).unwrap();
        j.prepare(&c, &i).unwrap();
        let s = scope(&root, &i, &yes);
        if index % 3 == 0 {
            let other = store.open_effect_journal().unwrap();
            other.request_cancel(&s, 1, 3).unwrap();
        } else if index % 3 == 2 {
            let other = store.open_effect_journal().unwrap();
            let cancelled = AtomicBool::new(false);
            assert_eq!(
                err(other.reconcile(
                    &s,
                    1,
                    3,
                    &Observer(|q: &EffectQuery, c: &AtomicBool| {
                        c.store(true, Ordering::Release);
                        Ok(observation(q, EffectOutcome::NotOccurred))
                    }),
                    &cancelled
                )),
                "cancelled"
            );
        } else {
            j.reconcile(
                &s,
                1,
                3,
                &Observer(|q: &EffectQuery, _: &AtomicBool| {
                    Ok(observation(q, EffectOutcome::NotOccurred))
                }),
                &AtomicBool::new(false),
            )
            .unwrap();
        }
    }
    let mut fresh = intent(&root);
    fresh.key.operation_id = "final-live-preparation".into();
    fresh.idempotency_key = hash(b"still room after 130 closed records");
    let c = CurrentRun::from_verified_host(&root, fresh.owner.clone(), &yes).unwrap();
    j.prepare(&c, &fresh).unwrap();
    j.mark_may_have_been_sent(&c, &fresh.key, 1, 3).unwrap();
}

#[test]
fn explicit_external_drift_is_not_erased_by_simultaneous_active_or_partial_observation() {
    for partial in [false, true] {
        let f = Fixture::new();
        let root = f.root();
        let store = f.store();
        let j = store.open_effect_journal().unwrap();
        let i = intent(&root);
        let yes = || true;
        let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
        j.prepare(&c, &i).unwrap();
        handoff(&j, &c, &i);
        let s = scope(&root, &i, &yes);
        let r = j
            .reconcile(
                &s,
                2,
                4,
                &Observer(|q: &EffectQuery, _: &AtomicBool| {
                    let mut o = observation(q, EffectOutcome::Unknown);
                    o.reason = UnknownReason::ExternalChange;
                    if partial {
                        o.coverage = Coverage::Partial;
                    } else {
                        o.execution = ExecutionObservation::Active;
                    }
                    Ok(o)
                }),
                &AtomicBool::new(false),
            )
            .unwrap();
        assert!(r.record.manual_review_required);
        assert_eq!(r.record.reason, UnknownReason::ExternalChange);
        assert_ne!(r.execution_observation(&s), ExecutionObservation::Quiescent);
        let r = j
            .reconcile(
                &s,
                3,
                5,
                &Observer(|q: &EffectQuery, _: &AtomicBool| {
                    Ok(observation(q, EffectOutcome::Completed))
                }),
                &AtomicBool::new(false),
            )
            .unwrap();
        assert!(r.record.manual_review_required);
    }
}

#[path = "effect_dispatch_fence_tests.rs"]
mod dispatch_fence;
