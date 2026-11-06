//! Synthetic in-memory protocol cases. No real worker, UE, provider, DB or monitor thread.
use super::*;
struct Catalog(AtomicBool);
impl RecoveryCatalog for Catalog {
    fn admission(&self, _: &str, _: Option<&str>, _: &[ResourceClaim]) -> RecoveryAdmission {
        if self.0.load(Ordering::SeqCst) { RecoveryAdmission::Ready } else { RecoveryAdmission::Unknown }
    }
}
struct Root;
impl HeldResource for Root {
    fn is_current(&self) -> bool { true }
    fn is_revoked(&self) -> bool { false }
}
struct Observer(std::sync::atomic::AtomicUsize);
impl ReadOnlyExecutionObserver for Observer {
    fn observe(&self, owner: &NativeExecutionIdentity, _: Instant) -> ExecutionObservation {
        assert!(!owner.execution_id.is_empty());
        match self.0.load(Ordering::SeqCst) { 0 => ExecutionObservation::Unknown, 1 => ExecutionObservation::Active, _ => ExecutionObservation::Quiescent }
    }
}
fn host() -> RuntimeHostService {
    let host = RuntimeHostService::new().unwrap();
    // Test-only deterministic maintenance; no thread is launched in these cases.
    host.lock().unwrap().monitor_active = true;
    host.install_recovery_catalog(Arc::new(Catalog(AtomicBool::new(true)))).unwrap();
    host
}
fn identity(run: &str, project: &str) -> OwnerIdentity {
    OwnerIdentity { scope_id: format!("scope-{run}"), run_id: run.into(), project_id: project.into(), root_ref: format!("root-{project}"),
        conversation_id: "conversation".into(), provider_id: "provider".into(), model_id: "model".into() }
}
fn connect(host: &RuntimeHostService, window: &str, run: &str, project: &str) -> OwnerRef {
    host.connect(window, identity(run, project)).unwrap().owner
}
fn model(host: &RuntimeHostService, window: &str, owner: &OwnerRef, id: &str) -> JobSnapshot {
    host.enqueue_model(window, ModelJobInput { owner: owner.clone(), job_id: id.into(), step_id: "step".into(), queue_timeout_ms: 10000, execution_timeout_ms: 10000 }).unwrap()
}
fn operation(host: &RuntimeHostService, owner: &OwnerRef, id: &str, root: &str, key: &str, observer: Arc<Observer>) -> JobSnapshot {
    host.enqueue_operation("window", NativeOperationInput { owner: owner.clone(), job_id: id.into(), step_id: "step".into(),
        queue_timeout_ms: 10000, execution_timeout_ms: 10000,
        resources: NativeResourceBinding { root_object_id: root.into(), held: Some(Arc::new(Root)), claims: vec![ResourceClaim { kind: ResourceKind::Ubt, key: key.into() }] }, observer }).unwrap()
}
#[test]
fn startup_is_blocked_without_monitor_and_complete_catalog() {
    let host = RuntimeHostService::new().unwrap();
    let owner = connect(&host, "window", "run", "project");
    assert_eq!(model(&host, "window", &owner, "a").reason, Some("monitor_unavailable"));
    host.lock().unwrap().monitor_active = true;
    let snapshot = host.status("window", &owner).unwrap();
    assert_eq!(snapshot.jobs[0].phase, JobPhase::Queued);
    assert_eq!(snapshot.jobs[0].reason, Some("recovery_pending"));
}
#[test]
fn native_window_binding_and_host_generation_are_enforced() {
    let host = host();
    let owner = connect(&host, "window-a", "run", "project");
    assert_eq!(host.status("window-b", &owner).unwrap_err(), "runtime_host_owner_mismatch");
    let other = RuntimeHostService::new().unwrap();
    assert_eq!(other.status("window-a", &owner).unwrap_err(), "runtime_host_generation_changed");
}
#[test]
fn one_native_model_limit_is_shared_across_windows_and_service_clones() {
    let host = host();
    let a = connect(&host, "window-a", "a", "project");
    let b = connect(&host, "window-b", "b", "project");
    let first = model(&host, "window-a", &a, "one");
    model(&host, "window-a", &a, "two");
    model(&host.clone(), "window-b", &b, "three");
    assert_eq!(model(&host, "window-b", &b, "four").phase, JobPhase::Queued);
    let mut worker = host.register_pending("window-a", &first.ticket).unwrap();
    worker.begin().unwrap();
    worker.finish(true).unwrap();
    assert_eq!(host.status("window-b", &b).unwrap().jobs[1].phase, JobPhase::Admitted);
}
#[test]
fn dropped_unpolled_native_registration_remains_unknown() {
    let host = host();
    let owner = connect(&host, "window", "a", "project");
    let job = model(&host, "window", &owner, "one");
    drop(host.register_pending("window", &job.ticket).unwrap());
    let state = host.reconcile(&job.ticket).unwrap();
    assert_eq!(state.phase, JobPhase::Retained);
    assert!(state.holds_resources && !state.callback_settled);
    assert_eq!(state.execution_observation, ExecutionObservation::Unknown);
}
#[test]
fn pending_registration_is_visible_before_worker_begins() {
    let host = host();
    let owner = connect(&host, "window", "a", "project");
    let job = model(&host, "window", &owner, "one");
    let registration = host.register_pending("window", &job.ticket).unwrap();
    let snapshot = host.status("window", &owner).unwrap();
    assert_eq!(snapshot.jobs[0].phase, JobPhase::HandoffPending);
    assert!(!snapshot.jobs[0].callback_settled);
    registration.finish_not_started().unwrap();
}
#[test]
fn cancellation_before_native_begin_can_only_release_the_original_unstarted_guard() {
    let host = host();
    let owner = connect(&host, "window", "a", "project");
    let job = model(&host, "window", &owner, "one");
    let mut registration = host.register_pending("window", &job.ticket).unwrap();
    assert!(host.cancel("window", &job.ticket).unwrap().holds_resources);
    assert_eq!(registration.begin().unwrap_err(), "runtime_host_dispatch_revoked");
    assert_eq!(registration.begin().unwrap_err(), "runtime_host_dispatch_already_claimed");
    assert_eq!(host.status("window", &owner).unwrap().jobs[0].phase, JobPhase::Finished);
}
#[test]
fn disconnect_revokes_dispatch_but_retains_unsettled_native_work() {
    let host = host();
    let a = connect(&host, "window-a", "a", "project");
    let b = connect(&host, "window-b", "b", "project");
    let first = model(&host, "window-a", &a, "one");
    let mut worker = host.register_pending("window-a", &first.ticket).unwrap();
    worker.begin().unwrap();
    host.disconnect_window("window-a").unwrap();
    assert!(worker.cancellation().load(Ordering::SeqCst));
    assert!(host.status("window-a", &a).unwrap().jobs[0].holds_resources);
    assert_eq!(host.heartbeat("window-a", &a).unwrap_err(), "runtime_host_owner_revoked");
    model(&host, "window-b", &b, "two");
    model(&host, "window-b", &b, "three");
    assert_eq!(model(&host, "window-b", &b, "four").phase, JobPhase::Queued);
    worker.finish(false).unwrap();
    assert_eq!(host.status("window-b", &b).unwrap().jobs[2].phase, JobPhase::Admitted);
}
#[test]
fn external_callback_return_and_active_or_unknown_observation_do_not_release_physical_root() {
    let host = host();
    let a = connect(&host, "window", "a", "project-a");
    let b = connect(&host, "window", "b", "project-b");
    let observer = Arc::new(Observer(std::sync::atomic::AtomicUsize::new(0)));
    let first = operation(&host, &a, "one", "physical-root", "engine-a", observer.clone());
    let second = operation(&host, &b, "two", "physical-root", "engine-b", observer.clone());
    assert_eq!(second.phase, JobPhase::Queued);
    let mut worker = host.register_pending("window", &first.ticket).unwrap();
    worker.begin().unwrap();
    assert_eq!(worker.finish(true).unwrap().phase, JobPhase::Retained);
    assert!(host.reconcile(&first.ticket).unwrap().holds_resources);
    observer.0.store(1, Ordering::SeqCst);
    assert!(host.reconcile(&first.ticket).unwrap().holds_resources);
    observer.0.store(2, Ordering::SeqCst);
    assert!(!host.reconcile(&first.ticket).unwrap().holds_resources);
    assert_eq!(host.status("window", &b).unwrap().jobs[0].phase, JobPhase::Admitted);
}
#[test]
fn native_observer_cannot_settle_a_lost_callback() {
    let host = host();
    let owner = connect(&host, "window", "a", "project");
    let observer = Arc::new(Observer(std::sync::atomic::AtomicUsize::new(2)));
    let job = operation(&host, &owner, "one", "physical-root", "engine", observer);
    let mut worker = host.register_pending("window", &job.ticket).unwrap();
    worker.begin().unwrap();
    drop(worker);
    let state = host.reconcile(&job.ticket).unwrap();
    assert!(state.holds_resources && !state.callback_settled);
    assert_eq!(state.execution_observation, ExecutionObservation::Unknown);
}
#[test]
fn native_deadlines_revoke_pending_work_without_inventing_stopped_proof() {
    let host = host();
    let owner = connect(&host, "window", "a", "project");
    let job = model(&host, "window", &owner, "one");
    let registration = host.register_pending("window", &job.ticket).unwrap();
    host.lock().unwrap().jobs[0].execution_deadline = Some(Instant::now() - Duration::from_millis(1));
    let state = host.status("window", &owner).unwrap();
    assert_eq!(state.jobs[0].reason, Some("execution_timed_out"));
    assert!(state.jobs[0].holds_resources);
    registration.finish_not_started().unwrap();
}
#[test]
fn recovery_barrier_is_rechecked_before_both_handoff_and_actual_dispatch() {
    let host = RuntimeHostService::new().unwrap();
    host.lock().unwrap().monitor_active = true;
    let catalog = Arc::new(Catalog(AtomicBool::new(true)));
    host.install_recovery_catalog(catalog.clone()).unwrap();
    let owner = connect(&host, "window", "a", "project");
    let first = model(&host, "window", &owner, "one");
    catalog.0.store(false, Ordering::SeqCst);
    assert!(matches!(host.register_pending("window", &first.ticket), Err("runtime_host_recovery_blocked")));
    catalog.0.store(true, Ordering::SeqCst);
    let mut registration = host.register_pending("window", &first.ticket).unwrap();
    catalog.0.store(false, Ordering::SeqCst);
    assert_eq!(registration.begin().unwrap_err(), "runtime_host_dispatch_revoked");
    assert!(!host.status("window", &owner).unwrap().jobs[0].holds_resources);
}
#[test]
fn untrusted_dtos_cannot_smuggle_observation_or_dispatch_fields() {
    assert!(serde_json::from_str::<OwnerRef>(r#"{"hostGeneration":"g","ownerId":"o","quiescent":true}"#).is_err());
    assert!(serde_json::from_str::<ModelJobInput>(r#"{"owner":{"hostGeneration":"g","ownerId":"o"},"jobId":"j","stepId":"s","queueTimeoutMs":1,"executionTimeoutMs":1,"resources":[]}"#).is_err());
}


#[test]
fn slow_root_io_does_not_hold_admission_mutex_and_expiry_is_rechecked_after_io() {
    struct SlowRoot {
        armed: AtomicBool,
        entered: std::sync::mpsc::SyncSender<()>,
        release: Mutex<std::sync::mpsc::Receiver<()>>,
    }
    impl HeldResource for SlowRoot {
        fn is_revoked(&self) -> bool { false }
        fn is_current(&self) -> bool {
            if !self.armed.load(Ordering::SeqCst) { return true; }
            let _ = self.entered.try_send(());
            self.release.lock().unwrap().recv_timeout(Duration::from_secs(2)).is_ok()
        }
    }
    let host = host();
    let owner = connect(&host, "window", "a", "project");
    let (entered, entered_rx) = std::sync::mpsc::sync_channel(1);
    let (release, release_rx) = std::sync::mpsc::sync_channel(1);
    let root = Arc::new(SlowRoot { armed: AtomicBool::new(false), entered, release: Mutex::new(release_rx) });
    let job = host.enqueue_operation("window", NativeOperationInput { owner: owner.clone(), job_id: "slow".into(), step_id: "step".into(),
        queue_timeout_ms: 10000, execution_timeout_ms: 10000,
        resources: NativeResourceBinding { root_object_id: "physical-root".into(), held: Some(root.clone()), claims: vec![ResourceClaim { kind: ResourceKind::Ubt, key: "engine".into() }] },
        observer: Arc::new(Observer(std::sync::atomic::AtomicUsize::new(0))) }).unwrap();
    let mut registration = host.register_pending("window", &job.ticket).unwrap();
    root.armed.store(true, Ordering::SeqCst);
    let worker = std::thread::spawn(move || registration.begin());
    entered_rx.recv_timeout(Duration::from_secs(1)).unwrap();
    let other_host = host.clone(); let other_owner = owner.clone(); let ticket = job.ticket.clone();
    let (checked, checked_rx) = std::sync::mpsc::sync_channel(1);
    let checker = std::thread::spawn(move || {
        other_host.heartbeat("window", &other_owner).unwrap();
        let mut inner = other_host.lock().unwrap();
        find_job(&mut inner, &ticket).unwrap().execution_deadline = Some(Instant::now() - Duration::from_millis(1));
        checked.send(()).unwrap();
    });
    let mutex_available = checked_rx.recv_timeout(Duration::from_secs(1)).is_ok();
    // Release even on assertion failure, keeping this regression bounded.
    let _ = release.try_send(());
    checker.join().unwrap();
    assert!(mutex_available, "heartbeat and deadline update waited on root filesystem I/O");
    assert_eq!(worker.join().unwrap(), Err("runtime_host_dispatch_revoked"));
    assert_eq!(host.status("window", &owner).unwrap().jobs[0].phase, JobPhase::Finished);
}

#[test]
fn revocation_after_path_check_is_rejected_by_final_original_pin_check() {
    struct RevocableRoot {
        armed: AtomicBool,
        path_checked: AtomicBool,
        revoked: AtomicBool,
    }
    impl HeldResource for RevocableRoot {
        fn is_current(&self) -> bool {
            let current = !self.revoked.load(Ordering::Acquire);
            if self.armed.load(Ordering::Acquire) { self.path_checked.store(true, Ordering::Release); }
            current
        }
        fn is_revoked(&self) -> bool { self.revoked.load(Ordering::Acquire) }
    }
    struct RevokingCatalog(Arc<RevocableRoot>);
    impl RecoveryCatalog for RevokingCatalog {
        fn admission(&self, _: &str, _: Option<&str>, _: &[ResourceClaim]) -> RecoveryAdmission {
            // Deterministically revoke AFTER the lock-free path check returned true,
            // during the final admission check under the host mutex.
            if self.0.path_checked.load(Ordering::Acquire) { self.0.revoked.store(true, Ordering::Release); }
            RecoveryAdmission::Ready
        }
    }
    let root = Arc::new(RevocableRoot {
        armed: AtomicBool::new(false), path_checked: AtomicBool::new(false), revoked: AtomicBool::new(false),
    });
    let host = RuntimeHostService::new().unwrap();
    host.lock().unwrap().monitor_active = true;
    host.install_recovery_catalog(Arc::new(RevokingCatalog(root.clone()))).unwrap();
    let owner = connect(&host, "window", "run", "project");
    let job = host.enqueue_operation("window", NativeOperationInput {
        owner: owner.clone(), job_id: "revoked-pin".into(), step_id: "step".into(),
        queue_timeout_ms: 10000, execution_timeout_ms: 10000,
        resources: NativeResourceBinding { root_object_id: "original-root".into(), held: Some(root.clone()),
            claims: vec![ResourceClaim { kind: ResourceKind::Ubt, key: "engine".into() }] },
        observer: Arc::new(Observer(std::sync::atomic::AtomicUsize::new(0))),
    }).unwrap();
    let mut registration = host.register_pending("window", &job.ticket).unwrap();
    root.armed.store(true, Ordering::Release);
    assert_eq!(registration.begin(), Err("runtime_host_dispatch_revoked"));
    assert!(root.revoked.load(Ordering::Acquire));
    let state = host.status("window", &owner).unwrap();
    assert_eq!(state.jobs[0].phase, JobPhase::Finished);
    assert!(state.jobs[0].callback_settled);
    assert!(!state.jobs[0].holds_resources);
}