//! Exact same-owner-thread, multi-connection interleavings; synthetic handoff/observer.
use super::*;

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
    let f=Fixture::new();let root=f.root();let store=f.store();let j=store.open_effect_journal().unwrap();
    let second=f.store();let sender=second.open_effect_journal().unwrap();let i=intent(&root);let yes=||true;
    let c=CurrentRun::from_verified_host(&root,owner(),&yes).unwrap();
    sender.prepare(&c,&i).unwrap();let ticket=RefCell::new(sender.mark_may_have_been_sent(&c,&i.key,1,3).unwrap());
    let s=scope(&root,&i,&yes);let handoffs=Cell::new(0);let rejected=RefCell::new(None);
    let o=Observer(|q:&EffectQuery,_:&AtomicBool|{
        assert_eq!(j.dispatch_gate(&s).unwrap().phase,DispatchPhase::Closed);
        let result=sender.dispatch_once(&c,&mut ticket.borrow_mut(),|_|handoffs.set(handoffs.get()+1));
        let decision=result.err().map(|e|e.kind);assert_eq!(decision,Some("conflict".into()));
        *rejected.borrow_mut()=decision;assert_eq!(handoffs.get(),0);
        Ok(observation(q,EffectOutcome::NotOccurred))
    });
    let result=j.reconcile(&s,2,4,&o,&AtomicBool::new(false)).unwrap();
    assert_eq!(result.record.state,EffectState::VerifiedNotOccurred);
    assert_eq!(result.execution_observation(&s),ExecutionObservation::Quiescent);
    assert!(!result.record.blocks_conflicting_admission());
    fs::write(f.path.join("query-wins.json"),serde_json::to_vec_pretty(&serde_json::json!({
        "connections":2,"threads":1,"interleaving":"observer reenters second connection on original owning thread",
        "syntheticHandoffAndObserver":true,"handoffs":handoffs.get(),"originalTicketError":*rejected.borrow(),
        "state":result.record.state,"gate":j.dispatch_gate(&s).unwrap()
    })).unwrap()).unwrap();
    drop(sender);drop(second);drop(j);drop(store);
    let reopened=f.store();let j=reopened.open_effect_journal().unwrap();
    assert_eq!(j.dispatch_gate(&s).unwrap().phase,DispatchPhase::Closed);
    assert_eq!(j.dispatch_events(&s,-1,100).unwrap().iter().map(|e|e.gate.phase).collect::<Vec<_>>(),
        vec![DispatchPhase::Prepared,DispatchPhase::Open,DispatchPhase::Closed]);
}

#[test]
fn claimed_callback_blocks_reverse_snapshot_across_connections_reopen_and_cancel() {
    let f=Fixture::new();let root=f.root();let store=f.store();let j=store.open_effect_journal().unwrap();
    let i=intent(&root);let yes=||true;let active=AtomicBool::new(true);let current=||active.load(Ordering::Acquire);
    let c=CurrentRun::from_verified_host(&root,owner(),&current).unwrap();
    j.prepare(&c,&i).unwrap();let mut ticket=j.mark_may_have_been_sent(&c,&i.key,1,3).unwrap();
    let s=scope(&root,&i,&yes);let called=Cell::new(0);let handoffs=Cell::new(0);
    let o=Observer(|q:&EffectQuery,_:&AtomicBool|{called.set(called.get()+1);Ok(observation(q,EffectOutcome::NotOccurred))});
    j.dispatch_once(&c,&mut ticket,|_|{
        // All cooperating connections belong to this one native owner thread.
        // Reentrant handoff gives the exact InCallback observation window without
        // waiting for a second thread that cannot acquire the lifetime Store gate.
        let second=f.store();let other=second.open_effect_journal().unwrap();
        assert_eq!(err(other.reconcile(&s,2,4,&o,&AtomicBool::new(false))),"handoffUnsettled");
        let reopened=f.store();let again=reopened.open_effect_journal().unwrap();
        assert_eq!(err(again.reconcile(&s,2,4,&o,&AtomicBool::new(false))),"handoffUnsettled");
        assert_eq!(called.get(),0);let gate=again.dispatch_gate(&s).unwrap();assert_eq!(gate.phase,DispatchPhase::InCallback);
        let cancelled=again.request_cancel(&s,2,4).unwrap();assert_eq!(cancelled.state,EffectState::ResultUnknown);
        assert_eq!(again.dispatch_gate(&s).unwrap(),gate);assert!(cancelled.blocks_conflicting_admission());
        active.store(false,Ordering::Release);handoffs.set(handoffs.get()+1);
    }).unwrap();
    assert_eq!(handoffs.get(),1);assert_eq!(j.dispatch_gate(&s).unwrap().phase,DispatchPhase::Settled);
    let result=j.reconcile(&s,3,5,&Observer(|q:&EffectQuery,_:&AtomicBool|Ok(observation(q,EffectOutcome::Completed))),&AtomicBool::new(false)).unwrap();
    assert_eq!(result.record.state,EffectState::VerifiedCompleted);
    assert_eq!(result.execution_observation(&s),ExecutionObservation::Quiescent);
    fs::write(f.path.join("dispatch-wins.json"),serde_json::to_vec_pretty(&serde_json::json!({
        "connections":3,"threads":1,"interleaving":"claim callback reenters original owner thread",
        "syntheticHandoffAndObserver":true,"preSettlementObserverCalls":called.get(),"handoffs":handoffs.get(),
        "afterSettlementState":result.record.state,"afterReturnGate":j.dispatch_gate(&s).unwrap()
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
