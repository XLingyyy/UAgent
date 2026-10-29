//! Exact single-process, two-thread/two-connection interleavings; synthetic handoff/observer.
use super::*;
use std::{
    sync::{mpsc, Arc},
    thread,
};
const WAIT: Duration = Duration::from_secs(4);

fn fail_gate_commit(store: &RunStore, phase: &str) {
    assert!(matches!(phase, "closed" | "inCallback" | "settled"));
    store
        .db
        .execute("CREATE TABLE gate_parent(id INTEGER PRIMARY KEY)", &[])
        .unwrap();
    store.db.execute("CREATE TABLE gate_child(id INTEGER PRIMARY KEY,parent INTEGER REFERENCES gate_parent(id) DEFERRABLE INITIALLY DEFERRED)",&[]).unwrap();
    store.db.execute(&format!("CREATE TRIGGER inject_gate_commit_failure AFTER UPDATE ON effect_dispatch_gates WHEN NEW.phase='{phase}' BEGIN INSERT INTO gate_child(id,parent) VALUES(1,999); END"),&[]).unwrap();
}

#[test]
fn absence_snapshot_fences_original_live_ticket_before_other_connection_handoff() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let (ready_tx, ready_rx) = mpsc::channel();
    let (go_tx, go_rx) = mpsc::channel();
    let (done_tx, done_rx) = mpsc::channel();
    let handoffs = Arc::new(AtomicU64::new(0));
    let count = handoffs.clone();
    let path = f.path.clone();
    let worker = thread::spawn(move || {
        let f = Fixture { path };
        let root = f.root();
        let store = f.store();
        let j = store.open_effect_journal().unwrap();
        let i = intent(&root);
        let yes = || true;
        let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
        j.prepare(&c, &i).unwrap();
        let mut ticket = j.mark_may_have_been_sent(&c, &i.key, 1, 3).unwrap();
        ready_tx.send(()).unwrap();
        go_rx.recv_timeout(WAIT).unwrap();
        let result = j.dispatch_once(&c, &mut ticket, |_| {
            count.fetch_add(1, Ordering::SeqCst);
        });
        done_tx.send(result.err().map(|e| e.kind)).unwrap();
    });
    ready_rx.recv_timeout(WAIT).unwrap();
    let s = scope(&root, &i, &yes);
    let rejected = RefCell::new(None);
    let o = Observer(|q: &EffectQuery, _: &AtomicBool| {
        // The caller still holds the original valid context/ticket at this exact snapshot.
        assert_eq!(j.dispatch_gate(&s).unwrap().phase, DispatchPhase::Closed);
        go_tx.send(()).unwrap();
        let decision = done_rx.recv_timeout(WAIT).unwrap();
        assert_eq!(decision, Some("conflict".into()));
        *rejected.borrow_mut() = decision;
        assert_eq!(handoffs.load(Ordering::SeqCst), 0);
        Ok(observation(q, EffectOutcome::NotOccurred))
    });
    let result = j.reconcile(&s, 2, 4, &o, &AtomicBool::new(false)).unwrap();
    worker.join().unwrap();
    assert_eq!(handoffs.load(Ordering::SeqCst), 0);
    assert_eq!(result.record.state, EffectState::VerifiedNotOccurred);
    assert_eq!(
        result.execution_observation(&s),
        ExecutionObservation::Quiescent
    );
    assert!(!result.record.blocks_conflicting_admission());
    fs::write(f.path.join("query-wins.json"), serde_json::to_vec_pretty(&serde_json::json!({
        "connections":2,"threads":2,"syntheticHandoffAndObserver":true,
        "handoffs":handoffs.load(Ordering::SeqCst),"originalTicketError":*rejected.borrow(),
        "state":result.record.state,"blocksAdmission":result.record.blocks_conflicting_admission(),
        "liveExecutionObservation":result.execution_observation(&s),"gate":j.dispatch_gate(&s).unwrap()
    })).unwrap()).unwrap();
    drop(j);
    drop(store);
    let reopened = f.store();
    let j = reopened.open_effect_journal().unwrap();
    assert_eq!(j.dispatch_gate(&s).unwrap().phase, DispatchPhase::Closed);
    assert_eq!(
        j.dispatch_events(&s, -1, 100)
            .unwrap()
            .iter()
            .map(|e| e.gate.phase)
            .collect::<Vec<_>>(),
        vec![
            DispatchPhase::Prepared,
            DispatchPhase::Open,
            DispatchPhase::Closed
        ]
    );
}

#[test]
fn claimed_callback_blocks_reverse_snapshot_across_connections_reopen_and_cancel() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let (done_tx, done_rx) = mpsc::channel();
    let handoffs = Arc::new(AtomicU64::new(0));
    let count = handoffs.clone();
    let active = Arc::new(AtomicBool::new(true));
    let live = active.clone();
    let path = f.path.clone();
    let worker = thread::spawn(move || {
        let f = Fixture { path };
        let root = f.root();
        let store = f.store();
        let j = store.open_effect_journal().unwrap();
        let i = intent(&root);
        let current = || live.load(Ordering::Acquire);
        let c = CurrentRun::from_verified_host(&root, owner(), &current).unwrap();
        j.prepare(&c, &i).unwrap();
        let mut ticket = j.mark_may_have_been_sent(&c, &i.key, 1, 3).unwrap();
        j.dispatch_once(&c, &mut ticket, |_| {
            entered_tx.send(()).unwrap();
            release_rx.recv_timeout(WAIT).unwrap();
            count.fetch_add(1, Ordering::SeqCst);
        })
        .unwrap();
        done_tx.send(()).unwrap();
    });
    entered_rx.recv_timeout(WAIT).unwrap();
    let s = scope(&root, &i, &yes);
    let called = Cell::new(0);
    let o = Observer(|q: &EffectQuery, _: &AtomicBool| {
        called.set(called.get() + 1);
        Ok(observation(q, EffectOutcome::NotOccurred))
    });
    let first_error = err(j.reconcile(&s, 2, 4, &o, &AtomicBool::new(false)));
    assert_eq!(first_error, "handoffUnsettled");
    assert_eq!(called.get(), 0);
    // Reopening another connection must not turn an outstanding callback into stopped proof.
    let reopened = f.store();
    let other = reopened.open_effect_journal().unwrap();
    let reopened_error = err(other.reconcile(&s, 2, 4, &o, &AtomicBool::new(false)));
    assert_eq!(reopened_error, "handoffUnsettled");
    let gate = other.dispatch_gate(&s).unwrap();
    assert_eq!(gate.phase, DispatchPhase::InCallback);
    let cancelled = other.request_cancel(&s, 2, 4).unwrap();
    assert_eq!(cancelled.state, EffectState::ResultUnknown);
    assert_eq!(other.dispatch_gate(&s).unwrap(), gate);
    assert!(cancelled.blocks_conflicting_admission());
    // Settlement is bookkeeping for the exact claim, not revival of an expired run lease.
    active.store(false, Ordering::Release);
    release_tx.send(()).unwrap();
    done_rx.recv_timeout(WAIT).unwrap();
    worker.join().unwrap();
    assert_eq!(handoffs.load(Ordering::SeqCst), 1);
    assert_eq!(
        other.dispatch_gate(&s).unwrap().phase,
        DispatchPhase::Settled
    );
    let result = other
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
    assert_eq!(result.record.state, EffectState::VerifiedCompleted);
    assert_eq!(
        result.execution_observation(&s),
        ExecutionObservation::Quiescent
    );
    fs::write(f.path.join("dispatch-wins.json"), serde_json::to_vec_pretty(&serde_json::json!({
        "connections":2,"threads":2,"syntheticHandoffAndObserver":true,
        "inCallbackQueryError":first_error,"reopenedInCallbackQueryError":reopened_error,
        "preSettlementObserverCalls":called.get(),"cancelledRecordBlocked":cancelled.blocks_conflicting_admission(),
        "inCallbackGate":gate,"afterReturnGate":other.dispatch_gate(&s).unwrap(),
        "handoffs":handoffs.load(Ordering::SeqCst),"afterSettlementState":result.record.state,
        "afterSettlementExecutionObservation":result.execution_observation(&s)
    })).unwrap()).unwrap();
}

#[test]
fn callback_unwind_or_settlement_failure_remains_unsettled_after_reopen() {
    for mode in 0..3 {
        let f = Fixture::new();
        let root = f.root();
        let store = f.store();
        let j = store.open_effect_journal().unwrap();
        let i = intent(&root);
        let yes = || true;
        let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
        j.prepare(&c, &i).unwrap();
        let mut ticket = j.mark_may_have_been_sent(&c, &i.key, 1, 3).unwrap();
        let calls = Cell::new(0);
        if mode == 2 {
            fail_gate_commit(&store, "settled");
        }
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            j.dispatch_once(&c, &mut ticket, |_| {
                calls.set(calls.get() + 1);
                if mode == 0 {
                    panic!("synthetic callback unwind after possible handoff");
                }
                if mode == 1 {
                    store.db.execute("PRAGMA query_only=ON", &[]).unwrap();
                }
            })
        }));
        if mode == 0 {
            assert!(result.is_err());
        } else {
            assert_eq!(err(result.unwrap()), "handoffUnsettled");
        }
        assert_eq!(calls.get(), 1);
        drop(j);
        drop(store);
        let store = f.store();
        let j = store.open_effect_journal().unwrap();
        let s = scope(&root, &i, &yes);
        let observed = Cell::new(false);
        assert_eq!(
            j.dispatch_gate(&s).unwrap().phase,
            DispatchPhase::InCallback
        );
        assert_eq!(
            err(j.reconcile(
                &s,
                2,
                4,
                &Observer(|q: &EffectQuery, _: &AtomicBool| {
                    observed.set(true);
                    Ok(observation(q, EffectOutcome::NotOccurred))
                }),
                &AtomicBool::new(false)
            )),
            "handoffUnsettled"
        );
        assert!(!observed.get());
        assert!(j.read(&s).unwrap().blocks_conflicting_admission());
        assert_eq!(
            err(j.dispatch_once(&c, &mut ticket, |_| calls.set(99))),
            "conflict"
        );
        assert_eq!(calls.get(), 1);
    }
}

#[test]
fn failed_query_fence_commit_never_calls_observer_or_invalidates_rollback_state() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    let mut ticket = j.mark_may_have_been_sent(&c, &i.key, 1, 3).unwrap();
    let s = scope(&root, &i, &yes);
    fail_gate_commit(&store, "closed");
    let observations = Cell::new(0);
    assert_eq!(
        err(j.reconcile(
            &s,
            2,
            4,
            &Observer(|q: &EffectQuery, _: &AtomicBool| {
                observations.set(1);
                Ok(observation(q, EffectOutcome::NotOccurred))
            }),
            &AtomicBool::new(false)
        )),
        "constraint"
    );
    assert_eq!(observations.get(), 0);
    assert_eq!(j.dispatch_gate(&s).unwrap().phase, DispatchPhase::Open);
    assert!(j.read(&s).unwrap().blocks_conflicting_admission());
    // No quiescent proof escaped; an original ticket may still legitimately win afterward.
    let calls = Cell::new(0);
    j.dispatch_once(&c, &mut ticket, |_| calls.set(1)).unwrap();
    assert_eq!(calls.get(), 1);
    assert_eq!(j.dispatch_gate(&s).unwrap().phase, DispatchPhase::Settled);
}

#[test]
fn failed_handoff_claim_commit_never_invokes_callback() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    let mut ticket = j.mark_may_have_been_sent(&c, &i.key, 1, 3).unwrap();
    let s = scope(&root, &i, &yes);
    fail_gate_commit(&store, "inCallback");
    let calls = Cell::new(0);
    assert_eq!(
        err(j.dispatch_once(&c, &mut ticket, |_| calls.set(1))),
        "constraint"
    );
    assert_eq!(calls.get(), 0);
    assert_eq!(j.dispatch_gate(&s).unwrap().phase, DispatchPhase::Open);
    let result = j
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
    assert_eq!(result.record.state, EffectState::VerifiedNotOccurred);
    assert_eq!(calls.get(), 0);
}

#[test]
fn cancelled_or_failed_query_keeps_its_durable_ticket_fence_after_reopen() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    let mut ticket = j.mark_may_have_been_sent(&c, &i.key, 1, 3).unwrap();
    let s = scope(&root, &i, &yes);
    let stop = AtomicBool::new(false);
    assert_eq!(
        err(j.reconcile(
            &s,
            2,
            4,
            &Observer(|q: &EffectQuery, cancel: &AtomicBool| {
                cancel.store(true, Ordering::Release);
                Ok(observation(q, EffectOutcome::NotOccurred))
            }),
            &stop
        )),
        "cancelled"
    );
    assert_eq!(j.read(&s).unwrap().revision, 2);
    let reopened = f.store();
    let other = reopened.open_effect_journal().unwrap();
    assert_eq!(
        other.dispatch_gate(&s).unwrap().phase,
        DispatchPhase::Closed
    );
    let calls = Cell::new(0);
    assert_eq!(
        err(j.dispatch_once(&c, &mut ticket, |_| calls.set(1))),
        "conflict"
    );
    assert_eq!(calls.get(), 0);
}

#[test]
fn old_unfenced_schema_is_rejected_without_migration_or_data_loss() {
    let f = Fixture::new();
    let store = f.store();
    store.db.execute("CREATE TABLE effect_journal_meta(singleton INTEGER PRIMARY KEY,version INTEGER NOT NULL)",&[]).unwrap();
    store
        .db
        .execute("INSERT INTO effect_journal_meta VALUES(1,1)", &[])
        .unwrap();
    store
        .db
        .execute("CREATE TABLE legacy_marker(payload TEXT NOT NULL)", &[])
        .unwrap();
    store
        .db
        .execute(
            "INSERT INTO legacy_marker VALUES('preserve original v1 data')",
            &[],
        )
        .unwrap();
    assert_eq!(err(store.open_effect_journal()), "unfencedLegacySchema");
    assert_eq!(
        store
            .db
            .query("SELECT version FROM effect_journal_meta", &[])
            .unwrap()[0][0]
            .int()
            .unwrap(),
        1
    );
    assert_eq!(
        store
            .db
            .query("SELECT payload FROM legacy_marker", &[])
            .unwrap()[0][0]
            .text()
            .unwrap(),
        "preserve original v1 data"
    );
    assert!(store
        .db
        .query(
            "SELECT name FROM sqlite_master WHERE name='effect_dispatch_gates'",
            &[]
        )
        .unwrap()
        .is_empty());
}

#[test]
fn missing_or_mismatched_gate_is_corrupt_not_an_empty_recovery_barrier() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    let mut orphan = j.prepare(&c, &i).unwrap();
    orphan.intent.key.operation_id = "operation-without-gate".into();
    orphan.intent.idempotency_key = hash(b"missing gate unique");
    orphan.intent_digest = orphan.intent.digest().unwrap();
    let text = json(&orphan).unwrap();
    store.db.execute("INSERT INTO effect_intents(project_id,operation_id,run_id,idempotency_key,intent_digest,revision,payload,payload_sha256) VALUES(?,?,?,?,?,?,?,?)",&[orphan.intent.key.project_id.as_str().into(),orphan.intent.key.operation_id.as_str().into(),orphan.intent.owner.run_id.as_str().into(),orphan.intent.idempotency_key.as_str().into(),orphan.intent_digest.as_str().into(),1_i64.into(),text.as_str().into(),hash(text.as_bytes()).into()]).unwrap();
    assert_eq!(err(j.read(&scope(&root, &orphan.intent, &yes))), "corrupt");
    assert_eq!(err(j.pending("project-a", 100, 0)), "corrupt");
    store
        .db
        .execute(
            "UPDATE effect_dispatch_gates SET intent_digest=?",
            &[hash(b"wrong intent").into()],
        )
        .unwrap();
    assert_eq!(err(j.read(&scope(&root, &i, &yes))), "corrupt");
}

#[test]
fn ticket_cannot_be_redirected_to_a_different_journal_instance() {
    let f = Fixture::new();
    let root = f.root();
    let store = f.store();
    let j = store.open_effect_journal().unwrap();
    let i = intent(&root);
    let yes = || true;
    let c = CurrentRun::from_verified_host(&root, owner(), &yes).unwrap();
    j.prepare(&c, &i).unwrap();
    let mut ticket = j.mark_may_have_been_sent(&c, &i.key, 1, 3).unwrap();
    let other = store.open_effect_journal().unwrap();
    let calls = Cell::new(0);
    assert_eq!(
        err(other.dispatch_once(&c, &mut ticket, |_| calls.set(1))),
        "staleOwner"
    );
    assert_eq!(calls.get(), 0);
    assert_eq!(
        err(j.dispatch_once(&c, &mut ticket, |_| calls.set(1))),
        "conflict"
    );
    assert_eq!(calls.get(), 0);
}
