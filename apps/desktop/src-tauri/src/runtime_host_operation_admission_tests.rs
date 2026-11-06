//! Real isolated SQLite and host ownership; executor is a counter, never UE.
use super::*;
use crate::trusted_root_handle::TrustedRootHandle;
use crate::local_run_store::{RunStore,Project,Session,Origin,NewRun};
use std::sync::atomic::AtomicUsize;
struct Observer(Arc<AtomicBool>);
impl ReadOnlyExecutionObserver for Observer {
    fn observe(&self,_:&NativeExecutionIdentity,_:Instant)->ExecutionObservation {
        if self.0.load(Ordering::SeqCst){ExecutionObservation::Quiescent}else{ExecutionObservation::Unknown}
    }
}
struct Fixture{store:RunStore,store_path:std::path::PathBuf,root:Arc<TrustedRootHandle>,host:RuntimeHostService,_monitor:RuntimeHostMonitor,
    catalog:Arc<PersistentRecoveryCatalog>,owner:OwnerRef,identity:OwnerIdentity,settled:Arc<AtomicBool>}
impl Fixture{
    fn new()->Self{
        let base=std::path::PathBuf::from("E:/Codex/UAgent/.local-dev/temp/ue-operation-admission")
            .join(format!("{}-{}",std::process::id(),random_id().unwrap()));
        let project=base.join("project");std::fs::create_dir_all(&project).unwrap();
        let root=Arc::new(TrustedRootHandle::open_from_host_selection(&project).unwrap());
        let store=RunStore::open(base.join("store")).unwrap();
        store.create_project(&Project{id:"p".into(),root:project.to_string_lossy().into(),label:"synthetic".into(),created_at:1}).unwrap();
        store.create_session(&Session{project_id:"p".into(),id:"s".into(),title:"synthetic".into(),created_at:1,archived:false,parent_id:None,origin:Origin::Native}).unwrap();
        store.start_run("p",&NewRun{id:"r".into(),session_id:"s".into(),goal:"synthetic UE handoff".into(),created_at:1}).unwrap();
        drop(store.open_effect_journal().unwrap());
        let host=RuntimeHostService::new().unwrap();let catalog=Arc::new(PersistentRecoveryCatalog::new());
        host.install_recovery_catalog(catalog.clone()).unwrap();let monitor=host.start_monitor().unwrap();
        let identity=OwnerIdentity{scope_id:"scope".into(),run_id:"r".into(),project_id:"p".into(),root_ref:root.identity().observation_key(),
            conversation_id:"s".into(),provider_id:"native".into(),model_id:"none".into()};
        let owner=host.connect("window",identity.clone()).unwrap().owner;
        Self{store,store_path:base.join("store"),root,host,_monitor:monitor,catalog,owner,identity,settled:Arc::new(AtomicBool::new(false))}
    }
    fn reserve(&self,id:&str)->HostResult<RegisteredExecution>{
        self.host.register_ue_operation_pending("window",NativeOperationInput{owner:self.owner.clone(),job_id:id.into(),step_id:"build".into(),
            queue_timeout_ms:10000,execution_timeout_ms:10000,resources:NativeResourceBinding::from_verified_root(self.root.clone(),
                vec![ResourceClaim{kind:ResourceKind::Ubt,key:"synthetic-engine".into()}])?,observer:Arc::new(Observer(self.settled.clone()))},&self.identity,&self.catalog)
    }
    fn intent(&self,r:&RegisteredExecution,id:&str)->ledger::EffectIntent{
        let a=r.identity();let b=&a.owner;
        ledger::EffectIntent{key:ledger::EffectKey{project_id:"p".into(),operation_id:id.into()},owner:ledger::OperationOwner{
            scope_id:b.scope_id.clone(),run_id:b.run_id.clone(),project_id:b.project_id.clone(),root_ref:b.root_ref.clone(),
            conversation_id:b.conversation_id.clone(),provider_id:b.provider_id.clone(),model_id:b.model_id.clone(),step_id:a.step_id.clone(),
            execution_id:a.execution_id.clone(),host_generation:a.ticket.host_generation.clone()},root_object_id:self.root.identity().observation_key(),
            adapter:ledger::AdapterIdentity{id:"native.ue-build".into(),version:1},idempotency_key:"a".repeat(64),approved_plan_digest:"b".repeat(64),
            plan_summary:"synthetic exact plan".into(),targets:vec![ledger::EffectTarget{kind:ledger::TargetKind::NativeReceipt,locator:id.into(),before_digest:None,after_digest:None}],
            resources:vec![ledger::ResourceClaim{kind:ledger::ResourceKind::Ubt,key:"synthetic-engine".into()}],created_at:2}
    }
}
#[test]
fn one_transaction_one_callback_and_observer_required(){
    let f=Fixture::new();let mut r=f.reserve("one").unwrap();let i=f.intent(&r,"one");let yes=||true;
    let c=ledger::CurrentRun::from_verified_host(&f.root,i.owner.clone(),&yes).unwrap();let j=f.store.open_effect_journal().unwrap();
    j.prepare(&c,&i).unwrap();let mut ticket=j.mark_may_have_been_sent(&c,&i.key,1,3).unwrap();
    assert_eq!(r.begin().unwrap_err(),"runtime_host_operation_transaction_required");
    let calls=AtomicUsize::new(0);
    r.dispatch_ue_once::<()>(&j,&c,&mut ticket,&f.catalog,Instant::now()+Duration::from_secs(2),|_|{calls.fetch_add(1,Ordering::SeqCst);Ok(())}).unwrap();
    assert!(r.dispatch_ue_once::<()>(&j,&c,&mut ticket,&f.catalog,Instant::now()+Duration::from_secs(2),|_|{calls.fetch_add(1,Ordering::SeqCst);Ok(())}).is_err());
    assert_eq!(calls.load(Ordering::SeqCst),1);
    assert_ne!(f.catalog.admission("p",None,&[]),RecoveryAdmission::Ready);
    let host_ticket=r.identity().ticket.clone();assert_eq!(r.finish(true).unwrap().phase,JobPhase::Retained);
    assert_eq!(f.host.reconcile(&host_ticket).unwrap().phase,JobPhase::Retained);
    f.settled.store(true,Ordering::SeqCst);assert_eq!(f.host.reconcile(&host_ticket).unwrap().phase,JobPhase::Finished);
}
#[test]
fn conflicting_pending_reservation_is_rejected(){
    let f=Fixture::new();let r=f.reserve("one").unwrap();assert!(matches!(f.reserve("two"),Err("runtime_host_resource_conflict")));
    r.finish_not_started().unwrap();assert!(f.reserve("two").is_ok());
}
#[test]
fn cancelled_and_disconnected_and_expired_do_not_execute(){
    for mode in 0..3{
        let f=Fixture::new();let mut r=f.reserve("one").unwrap();let i=f.intent(&r,"one");let yes=||true;
        let c=ledger::CurrentRun::from_verified_host(&f.root,i.owner.clone(),&yes).unwrap();let j=f.store.open_effect_journal().unwrap();
        j.prepare(&c,&i).unwrap();let mut ticket=j.mark_may_have_been_sent(&c,&i.key,1,3).unwrap();
        if mode==0{f.host.cancel("window",&r.identity().ticket).unwrap();}
        if mode==1{f.host.disconnect_window("window").unwrap();}
        let deadline=if mode==2{Instant::now()}else{Instant::now()+Duration::from_secs(2)};
        let calls=AtomicUsize::new(0);assert!(r.dispatch_ue_once::<()>(&j,&c,&mut ticket,&f.catalog,deadline,|_|{calls.fetch_add(1,Ordering::SeqCst);Ok(())}).is_err());
        assert_eq!(calls.load(Ordering::SeqCst),0);
    }
}
#[test]
fn different_execution_owner_is_rejected(){
    let f=Fixture::new();let mut r=f.reserve("one").unwrap();let mut i=f.intent(&r,"one");i.owner.execution_id="old-execution".into();let yes=||true;
    let c=ledger::CurrentRun::from_verified_host(&f.root,i.owner.clone(),&yes).unwrap();let j=f.store.open_effect_journal().unwrap();
    j.prepare(&c,&i).unwrap();let mut ticket=j.mark_may_have_been_sent(&c,&i.key,1,3).unwrap();
    assert!(r.dispatch_ue_once::<()>(&j,&c,&mut ticket,&f.catalog,Instant::now()+Duration::from_secs(2),|_|panic!("must not dispatch")).is_err());
}
#[test]
fn other_unresolved_effect_is_not_excluded(){
    let f=Fixture::new();let mut r=f.reserve("one").unwrap();let i=f.intent(&r,"one");let yes=||true;
    let c=ledger::CurrentRun::from_verified_host(&f.root,i.owner.clone(),&yes).unwrap();let j=f.store.open_effect_journal().unwrap();
    let mut other=i.clone();other.key.operation_id="other".into();other.idempotency_key="c".repeat(64);j.prepare(&c,&other).unwrap();
    j.prepare(&c,&i).unwrap();let mut ticket=j.mark_may_have_been_sent(&c,&i.key,1,3).unwrap();
    assert!(r.dispatch_ue_once::<()>(&j,&c,&mut ticket,&f.catalog,Instant::now()+Duration::from_secs(2),|_|panic!("must not dispatch")).is_err());
}
#[test]
fn reopened_journal_cannot_reuse_live_ticket(){
    let f=Fixture::new();let mut r=f.reserve("one").unwrap();let i=f.intent(&r,"one");let yes=||true;
    let c=ledger::CurrentRun::from_verified_host(&f.root,i.owner.clone(),&yes).unwrap();let j=f.store.open_effect_journal().unwrap();
    j.prepare(&c,&i).unwrap();let mut ticket=j.mark_may_have_been_sent(&c,&i.key,1,3).unwrap();drop(j);
    let reopened=f.store.open_effect_journal().unwrap();
    assert!(r.dispatch_ue_once::<()>(&reopened,&c,&mut ticket,&f.catalog,Instant::now()+Duration::from_secs(2),|_|panic!("must not dispatch")).is_err());
}

#[test]
fn other_connection_cancel_invalidates_the_original_ticket(){
    let f=Fixture::new();let mut r=f.reserve("one").unwrap();let i=f.intent(&r,"one");let yes=||true;
    let c=ledger::CurrentRun::from_verified_host(&f.root,i.owner.clone(),&yes).unwrap();let j=f.store.open_effect_journal().unwrap();
    j.prepare(&c,&i).unwrap();let mut ticket=j.mark_may_have_been_sent(&c,&i.key,1,3).unwrap();
    let other=RunStore::open(&f.store_path).unwrap();let other_j=other.open_effect_journal().unwrap();
    let scope=ledger::RecoveryReadScope::from_verified_host_read(&f.root,i.key.clone(),i.owner.clone(),"reader".into(),&yes).unwrap();
    other_j.request_cancel(&scope,2,4).unwrap();
    assert!(r.dispatch_ue_once::<()>(&j,&c,&mut ticket,&f.catalog,Instant::now()+Duration::from_secs(2),|_|panic!("must not dispatch")).is_err());
}
#[test]
fn failed_claim_commit_never_enters_executor_and_keeps_host_unknown(){
    let f=Fixture::new();let mut r=f.reserve("one").unwrap();let i=f.intent(&r,"one");let yes=||true;
    let c=ledger::CurrentRun::from_verified_host(&f.root,i.owner.clone(),&yes).unwrap();let j=f.store.open_effect_journal().unwrap();
    j.prepare(&c,&i).unwrap();let mut ticket=j.mark_may_have_been_sent(&c,&i.key,1,3).unwrap();
    ledger::runtime_host_catalog_reader::inject_operation_claim_commit_failure(&f.store);
    let calls=AtomicUsize::new(0);
    assert!(r.dispatch_ue_once::<()>(&j,&c,&mut ticket,&f.catalog,Instant::now()+Duration::from_secs(2),|_|{calls.fetch_add(1,Ordering::SeqCst);Ok(())}).is_err());
    assert_eq!(calls.load(Ordering::SeqCst),0);drop(r);
    let snapshot=f.host.status("window",&f.owner).unwrap();
    assert_eq!(snapshot.jobs[0].phase,JobPhase::Retained);
    assert_eq!(snapshot.jobs[0].execution_observation,ExecutionObservation::Unknown);
}
#[test]
fn two_threads_cannot_reserve_the_same_resource(){
    let f=Fixture::new();let barrier=Arc::new(std::sync::Barrier::new(3));let mut workers=vec![];
    for id in ["a","b"]{
        let host=f.host.clone();let owner=f.owner.clone();let root=f.root.clone();let expected=f.identity.clone();let catalog=f.catalog.clone();let sync=barrier.clone();
        workers.push(std::thread::spawn(move||{
            sync.wait();host.register_ue_operation_pending("window",NativeOperationInput{owner,job_id:id.into(),step_id:"build".into(),queue_timeout_ms:10000,execution_timeout_ms:10000,
                resources:NativeResourceBinding::from_verified_root(root,vec![ResourceClaim{kind:ResourceKind::Ubt,key:"synthetic-engine".into()}]).unwrap(),
                observer:Arc::new(Observer(Arc::new(AtomicBool::new(false))))},&expected,&catalog)
        }));
    }
    barrier.wait();let results:Vec<_>=workers.into_iter().map(|w|w.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r|r.is_ok()).count(),1);
    for r in results.into_iter().flatten(){r.finish_not_started().unwrap();}
}

#[test]
fn deadline_expiring_after_claim_commit_cannot_enter_executor(){
    let f=Fixture::new();let mut r=f.reserve("one").unwrap();let i=f.intent(&r,"one");
    let deadline=Instant::now()+Duration::from_millis(250);
    let running_checks=std::cell::Cell::new(0);
    let current=||{
        let running=f.host.status("window",&f.owner).unwrap().jobs[0].phase==JobPhase::Running;
        if running {
            running_checks.set(running_checks.get()+1);
            // First check follows admission inside the claim transaction. The next
            // is the existing post-COMMIT eligibility check, before external work.
            if running_checks.get()==2 {
                std::thread::sleep(deadline.saturating_duration_since(Instant::now())+Duration::from_millis(1));
            }
        }
        true
    };
    let c=ledger::CurrentRun::from_verified_host(&f.root,i.owner.clone(),&current).unwrap();let j=f.store.open_effect_journal().unwrap();
    j.prepare(&c,&i).unwrap();let mut ticket=j.mark_may_have_been_sent(&c,&i.key,1,3).unwrap();
    let calls=AtomicUsize::new(0);
    let error=r.dispatch_ue_once::<()>(&j,&c,&mut ticket,&f.catalog,deadline,|_|{calls.fetch_add(1,Ordering::SeqCst);Ok(())}).unwrap_err();
    assert_eq!(running_checks.get(),2);assert_eq!(error.kind,"operationAdmissionRevoked");assert_eq!(calls.load(Ordering::SeqCst),0);
}

#[test]
fn owned_claim_spans_store_release_and_blocks_queries_until_real_return(){
    let f=Fixture::new();let mut r=f.reserve("one").unwrap();let i=f.intent(&r,"one");let yes=||true;
    let c=ledger::CurrentRun::from_verified_host(&f.root,i.owner.clone(),&yes).unwrap();let j=f.store.open_effect_journal().unwrap();
    j.prepare(&c,&i).unwrap();let mut ticket=j.mark_may_have_been_sent(&c,&i.key,1,3).unwrap();
    let handoff=r.claim_ue_once(&j,&c,&mut ticket,&f.catalog,Instant::now()+Duration::from_secs(2)).unwrap();
    drop(j);drop(c);drop(f.store);
    let reopened=RunStore::open(&f.store_path).unwrap();let j=reopened.open_effect_journal().unwrap();
    let scope=ledger::RecoveryReadScope::from_verified_host_read(&f.root,i.key.clone(),i.owner.clone(),"reader".into(),&yes).unwrap();
    assert_eq!(j.dispatch_gate(&scope).unwrap().phase,ledger::DispatchPhase::InCallback);
    r.check_started_ue_operation(&i).unwrap();
    // Controlled executor returns here; no UE process runs in this test.
    j.settle_owned_operation(handoff).unwrap();
    assert_eq!(j.dispatch_gate(&scope).unwrap().phase,ledger::DispatchPhase::Settled);
    f.settled.store(true,Ordering::SeqCst);let host_ticket=r.identity().ticket.clone();r.finish(true).unwrap();
    assert_eq!(f.host.reconcile(&host_ticket).unwrap().phase,JobPhase::Finished);
}
#[test]
fn dropping_owned_claim_never_settles_or_recreates_it(){
    let f=Fixture::new();let mut r=f.reserve("one").unwrap();let i=f.intent(&r,"one");let yes=||true;
    let c=ledger::CurrentRun::from_verified_host(&f.root,i.owner.clone(),&yes).unwrap();let j=f.store.open_effect_journal().unwrap();
    j.prepare(&c,&i).unwrap();let mut ticket=j.mark_may_have_been_sent(&c,&i.key,1,3).unwrap();
    let handoff=r.claim_ue_once(&j,&c,&mut ticket,&f.catalog,Instant::now()+Duration::from_secs(2)).unwrap();drop(handoff);
    let scope=ledger::RecoveryReadScope::from_verified_host_read(&f.root,i.key.clone(),i.owner.clone(),"reader".into(),&yes).unwrap();
    assert_eq!(j.dispatch_gate(&scope).unwrap().phase,ledger::DispatchPhase::InCallback);
    assert!(r.claim_ue_once(&j,&c,&mut ticket,&f.catalog,Instant::now()+Duration::from_secs(2)).is_err());
}

#[test]
fn native_receipt_is_saved_and_partial_or_mismatched_results_cannot_succeed(){
    for mode in 0..3{
        let f=Fixture::new();let mut r=f.reserve("one").unwrap();let i=f.intent(&r,"one");let yes=||true;
        let c=ledger::CurrentRun::from_verified_host(&f.root,i.owner.clone(),&yes).unwrap();let j=f.store.open_effect_journal().unwrap();
        j.prepare(&c,&i).unwrap();let mut ticket=j.mark_may_have_been_sent(&c,&i.key,1,3).unwrap();
        let handoff=r.claim_ue_once(&j,&c,&mut ticket,&f.catalog,Instant::now()+Duration::from_secs(2)).unwrap();let proof=j.settle_owned_operation(handoff).unwrap();
        let result=crate::ue_build_process::UEBuildExecutionResult{owner:crate::ue_build_process::UEBuildOwner{run_id:"r".into(),step_id:"build".into(),fingerprint:if mode==2{"c".repeat(64)}else{i.approved_plan_digest.clone()}},
            status:"succeeded".into(),reason:"synthetic executor receipt".into(),pid:Some(1),exit_code:Some(0),duration_ms:1,
            tree_stopped:mode!=1,stdout:"synthetic output".into(),stderr:String::new(),output_truncated:false,output_complete:true,effects:"possible".into()};
        let saved=crate::ue_build_result::persist_result(&f.store,"p","r",&f.root,&i,&result,Some((&f.catalog,&proof)));
        if mode==2{assert!(saved.is_err());assert_eq!(f.store.run("p","r").unwrap().revision,0);continue;}
        saved.unwrap();
        assert_eq!(f.catalog.report().unwrap().persistent_effect_barriers.len(),if mode==0{0}else{1});
        assert_ne!(f.catalog.admission("p",None,&[]),RecoveryAdmission::Ready);
        assert_eq!(f.store.run("p","r").unwrap().status,if mode==0{crate::local_run_store::RunStatus::Succeeded}else{crate::local_run_store::RunStatus::NeedsReconciliation});
        let bytes=f.store.read_artifact("p","r","native-build-result").unwrap();let value:serde_json::Value=serde_json::from_slice(&bytes).unwrap();assert_eq!(value["stdout"],"synthetic output");
    }
}

#[test]
fn manual_repair_live_ledger_backup_write_result_and_rebuild_input_pin() {
    use crate::ue_build_repair::*;
    use crate::ue_build_repair_io::hash;
    let f=Fixture::new();let source=f.root.path_hint().join("Source/Game/A.cpp");std::fs::create_dir_all(source.parent().unwrap()).unwrap();std::fs::write(&source,"int a = 1;\n").unwrap();
    let binding=RepairBinding{host_session_id:"manual".into(),project_id:"p".into(),root_object_id:f.root.identity().observation_key(),run_id:"original-failed-run".into(),profile_fingerprint:"f".repeat(64)};
    let diagnostic=RepairDiagnosticRef{diagnostic_id:"e".repeat(64),build_owner:RepairBuildOwner{run_id:binding.run_id.clone(),step_id:"build".into(),fingerprint:binding.profile_fingerprint.clone()}};
    let mut session=RepairSession::from_verified_host(f.root.as_ref().clone(),binding,diagnostic,vec!["Source/Game/A.cpp".into()]).unwrap();let snap=session.read_snapshots("manual").unwrap();let before=&snap.files[0];let after="int a = 2;\n";
    let p=session.prepare_preview("manual",RepairPreviewInput{binding:snap.binding.clone(),diagnostic:snap.diagnostic.clone(),task:snap.task.clone(),snapshot_id:snap.snapshot_id.clone(),preview_id:"d".repeat(64),files:vec![RepairFilePreview{path:before.path.clone(),before:before.content.clone(),after:after.into(),before_hash:before.sha256.clone(),after_hash:hash(after.as_bytes()),before_object_identity:before.object_identity.clone()}]}).unwrap();
    let mut r=f.host.register_ue_operation_pending("window",NativeOperationInput{owner:f.owner.clone(),job_id:"manual".into(),step_id:"repair".into(),queue_timeout_ms:10000,execution_timeout_ms:10000,
        resources:NativeResourceBinding::from_verified_root(f.root.clone(),vec![ResourceClaim{kind:ResourceKind::Ubt,key:"synthetic-engine".into()},ResourceClaim{kind:ResourceKind::FileWrite,key:f.identity.root_ref.clone()}]).unwrap(),observer:Arc::new(Observer(f.settled.clone()))},&f.identity,&f.catalog).unwrap();
    let mut i=f.intent(&r,"manual");i.approved_plan_digest=p.native_plan_digest.clone();i.adapter.id="native.ue-source-repair.v1".into();i.resources.push(ledger::ResourceClaim{kind:ledger::ResourceKind::FileWrite,key:f.identity.root_ref.clone()});i.targets=vec![ledger::EffectTarget{kind:ledger::TargetKind::File,locator:before.path.clone(),before_digest:Some(before.sha256.clone()),after_digest:Some(hash(after.as_bytes()))}];
    let yes=||true;let c=ledger::CurrentRun::from_verified_host(&f.root,i.owner.clone(),&yes).unwrap();let j=f.store.open_effect_journal().unwrap();j.prepare(&c,&i).unwrap();let mut ticket=j.mark_may_have_been_sent(&c,&i.key,1,3).unwrap();let handoff=r.claim_ue_once(&j,&c,&mut ticket,&f.catalog,Instant::now()+Duration::from_secs(5)).unwrap();r.check_started_ue_operation(&i).unwrap();
    let mut backup=crate::ue_build_repair_result::StoreRepairJournal::new(&f.store,&i);let mut grant=NativeRepairGrant::from_verified_host_approval(&p,60000).unwrap();
    let receipt=session.apply_approved("manual",&p.preview.preview_id,&mut grant,&mut backup,&AtomicBool::new(false)).unwrap();assert_eq!(receipt.status,"applied");assert!(backup.checkpoint_written);
    let original:serde_json::Value=serde_json::from_slice(&f.store.read_artifact("p","r","nativeRepairBefore").unwrap()).unwrap();assert_eq!(original["preview"]["preview"]["files"][0]["before"],"int a = 1;\n");
    let persisted_identity:crate::repair_execution_identity::ExecutionIdentity=serde_json::from_value(original["executionIdentity"].clone()).unwrap();
    let database=f.store.repair_execution_database_key().unwrap();
    assert_eq!(persisted_identity.observe(database,"p","r",&i.key.operation_id,&i.digest().unwrap()).unwrap(),crate::repair_execution_identity::ProcessObservation::Running);
    let saved=f.store.read_artifact("p","r","nativeRepairBefore").unwrap();
    assert_eq!(crate::ue_repair_recovery::observe_original_process(&saved,database,&i).unwrap(),crate::repair_execution_identity::ProcessObservation::Running);
    let mut legacy=original.clone();legacy.as_object_mut().unwrap().remove("executionIdentity");
    assert!(crate::ue_repair_recovery::observe_original_process(&serde_json::to_vec(&legacy).unwrap(),database,&i).is_err());
    f.settled.store(true,Ordering::SeqCst);let host_ticket=r.identity().ticket.clone();r.finish(true).unwrap();let proof=j.settle_owned_operation(handoff).unwrap();
    crate::ue_build_repair_result::persist(&f.store,&f.root,&i,&p,&receipt,true,&f.catalog,&proof).unwrap();assert_eq!(f.store.run("p","r").unwrap().status,crate::local_run_store::RunStatus::Succeeded);assert_eq!(f.catalog.report().unwrap().persistent_effect_barriers.len(),0);assert_eq!(f.host.reconcile(&host_ticket).unwrap().phase,JobPhase::Finished);
    let mut guard=session.hold_applied_inputs_for_build("manual",&p.preview.preview_id).unwrap();guard.check_current().unwrap();assert!(std::fs::write(&source,"changed externally").is_err());drop(guard);
    std::fs::write(&source,"changed externally").unwrap();assert!(session.hold_applied_inputs_for_build("manual",&p.preview.preview_id).is_err());
    // No UE process launched: this tests actual source I/O and SQLite/RuntimeHost boundaries.
}

fn live_restore_case(mode:u8){
    let source=std::env::var("UAGENT_RESTART_CHILD_SOURCE").as_deref()==Ok("1");
    use crate::ue_build_repair::*;
    use crate::ue_build_repair_io::hash;
    let f=Fixture::new();let paths=vec!["Source/Game/A.cpp".to_string(),"Source/Game/B.cpp".to_string()];
    for path in &paths{let file=f.root.path_hint().join(path);std::fs::create_dir_all(file.parent().unwrap()).unwrap();std::fs::write(file,"int a = 1;\n").unwrap();}
    let binding=RepairBinding{host_session_id:"manual".into(),project_id:"p".into(),root_object_id:f.identity.root_ref.clone(),run_id:if source{"goal-task"}else{"failed-build"}.into(),profile_fingerprint:"f".repeat(64)};
    let diagnostic=RepairDiagnosticRef{diagnostic_id:"e".repeat(64),build_owner:RepairBuildOwner{run_id:binding.run_id.clone(),step_id:"build".into(),fingerprint:binding.profile_fingerprint.clone()}};
    let mut session=if source {
        let task=SourceTaskRef{run_id:binding.run_id.clone(),scope_id:"goal-scope".into(),plan_version:1};
        RepairSession::from_verified_task(f.root.as_ref().clone(),binding,task,paths.clone())
    }else{RepairSession::from_verified_host(f.root.as_ref().clone(),binding,diagnostic,paths.clone())}.unwrap();let snap=session.read_snapshots("manual").unwrap();
    let p=session.prepare_replacements("manual",&snap.snapshot_id,hash(b"partial-original"),paths.iter().map(|p|(p.clone(),"int a = 2;\n".into())).collect()).unwrap();
    let reserve=|id:&str,owner:&OwnerRef,identity:&OwnerIdentity|{
        let mut claims=vec![ResourceClaim{kind:ResourceKind::FileWrite,key:f.identity.root_ref.clone()}];
        if !source {claims.insert(0,ResourceClaim{kind:ResourceKind::Ubt,key:"synthetic-engine".into()});}
        let input=NativeOperationInput{owner:owner.clone(),job_id:id.into(),step_id:"repair".into(),queue_timeout_ms:10000,execution_timeout_ms:10000,
            resources:NativeResourceBinding::from_verified_root(f.root.clone(),claims).unwrap(),observer:Arc::new(Observer(f.settled.clone()))};
        if source {f.host.register_source_operation_pending("window",input,identity,&f.catalog)}
        else {f.host.register_ue_operation_pending("window",input,identity,&f.catalog)}.unwrap()
    };
    let mut r=reserve("original",&f.owner,&f.identity);let mut i=f.intent(&r,"original");i.adapter.id=if source{"native.source-change.v1"}else{"native.ue-source-repair.v1"}.into();i.approved_plan_digest=p.native_plan_digest.clone();if source{i.resources.clear();}i.resources.push(ledger::ResourceClaim{kind:ledger::ResourceKind::FileWrite,key:f.identity.root_ref.clone()});i.targets=p.preview.files.iter().map(|f|ledger::EffectTarget{kind:ledger::TargetKind::File,locator:f.path.clone(),before_digest:Some(f.before_hash.clone()),after_digest:Some(f.after_hash.clone())}).collect();
    let yes=||true;let c=ledger::CurrentRun::from_verified_host(&f.root,i.owner.clone(),&yes).unwrap();let j=f.store.open_effect_journal().unwrap();j.prepare(&c,&i).unwrap();let mut ticket=j.mark_may_have_been_sent(&c,&i.key,1,3).unwrap();
    let handoff=r.claim_ue_once(&j,&c,&mut ticket,&f.catalog,Instant::now()+Duration::from_secs(5)).unwrap();
    let mut backup=crate::ue_build_repair_result::StoreRepairJournal::new(&f.store,&i);let mut grant=NativeRepairGrant::from_verified_host_approval(&p,60000).unwrap();
    let complete=mode==8;
    let receipt=if complete{session.apply_approved("manual",&p.preview.preview_id,&mut grant,&mut backup,&AtomicBool::new(false)).unwrap()}else{session.apply_then_interrupt_for_restore_test("manual",&p.preview.preview_id,&mut grant,&mut backup).unwrap()};
    assert_eq!(receipt.status,if complete{"applied"}else{"partial"});
    if mode==9{
        assert!(backup.checkpoint_written);
        let output=std::env::var("UAGENT_RESTART_CHILD_OUTPUT").unwrap();
        std::fs::write(output,serde_json::to_vec(&serde_json::json!({"root":f.root.path_hint(),"store":f.store_path})).unwrap()).unwrap();
        // Real process exit after one file write, before result persistence or settlement; no destructors run.
        std::process::exit(73);
    }
    let proof=j.settle_owned_operation(handoff).unwrap();f.settled.store(true,Ordering::SeqCst);let original_ticket=r.identity().ticket.clone();r.finish(complete).unwrap();assert_eq!(f.host.reconcile(&original_ticket).unwrap().phase,JobPhase::Finished);
    crate::ue_build_repair_result::persist(&f.store,&f.root,&i,&p,&receipt,true,&f.catalog,&proof).unwrap();
    assert_eq!(f.catalog.report().unwrap().persistent_effect_barriers.len(),if complete{0}else{1});
    if mode==7||complete{
        assert!(j.ended_repair_record("p","r").is_err()); // Original process is still alive.
        let output=std::env::var("UAGENT_RESTART_CHILD_OUTPUT").unwrap();
        std::fs::write(output,serde_json::to_vec(&serde_json::json!({"root":f.root.path_hint(),"store":f.store_path})).unwrap()).unwrap();return;
    }
    if mode==4{std::fs::write(f.root.path_hint().join(&paths[0]),"outside change").unwrap();assert!(session.prepare_restore("manual",&p.preview.preview_id,hash(b"reverse")).is_err());return;}
    let reverse=session.prepare_restore("manual",&p.preview.preview_id,hash(b"reverse")).unwrap();assert_eq!(reverse.preview.files.len(),1);
    let permit=crate::runtime_host_recovery_catalog::SettledRepairRestore::new(proof,i.clone(),&reverse).unwrap();
    if mode==1{let mut other=i.clone();other.key.operation_id="unrelated".into();other.idempotency_key="9".repeat(64);j.prepare(&c,&other).unwrap();}
    f.store.start_run("p",&NewRun{id:"restore-run".into(),session_id:"s".into(),goal:"approved restore".into(),created_at:4}).unwrap();
    let mut identity=f.identity.clone();identity.run_id="restore-run".into();let owner=f.host.connect("window",identity.clone()).unwrap().owner;
    let mut rr=reserve("restore",&owner,&identity);let mut ri=f.intent(&rr,"restore");ri.adapter=i.adapter.clone();ri.resources=i.resources.clone();ri.idempotency_key="8".repeat(64);ri.approved_plan_digest=reverse.native_plan_digest.clone();ri.targets=reverse.preview.files.iter().map(|f|ledger::EffectTarget{kind:ledger::TargetKind::File,locator:f.path.clone(),before_digest:Some(f.before_hash.clone()),after_digest:Some(f.after_hash.clone())}).collect();
    if mode==2{ri.targets[0].after_digest=Some("7".repeat(64));}
    let rc=ledger::CurrentRun::from_verified_host(&f.root,ri.owner.clone(),&yes).unwrap();j.prepare(&rc,&ri).unwrap();let mut rt=j.mark_may_have_been_sent(&rc,&ri.key,1,5).unwrap();
    if mode==3{f.host.cancel("window",&rr.identity().ticket).unwrap();}
    if mode==6{ledger::runtime_host_catalog_reader::inject_operation_claim_commit_failure(&f.store);}
    let claimed=rr.claim_ue_restore_once(&j,&rc,&mut rt,&f.catalog,Instant::now()+Duration::from_secs(5),&permit);
    if [1,2,3,6].contains(&mode){assert!(claimed.is_err());assert_eq!(std::fs::read_to_string(f.root.path_hint().join(&paths[0])).unwrap(),"int a = 2;\n");return;}
    let handoff=claimed.unwrap();assert!(rr.claim_ue_restore_once(&j,&rc,&mut rt,&f.catalog,Instant::now()+Duration::from_secs(5),&permit).is_err());
    rr.check_started_ue_operation(&ri).unwrap();
    if mode==5{std::fs::write(f.root.path_hint().join(&paths[0]),"outside change").unwrap();}
    let mut rb=crate::ue_build_repair_result::StoreRepairJournal::new(&f.store,&ri);let mut rg=NativeRepairGrant::from_verified_host_approval(&reverse,60000).unwrap();
    let restored=session.apply_approved("manual",&reverse.preview.preview_id,&mut rg,&mut rb,&AtomicBool::new(false)).unwrap();
    let proof=j.settle_owned_operation(handoff).unwrap();let t=rr.identity().ticket.clone();rr.finish(restored.status=="applied").unwrap();
    crate::ue_build_repair_result::persist(&f.store,&f.root,&ri,&reverse,&restored,rb.checkpoint_written,&f.catalog,&proof).unwrap();assert_eq!(f.host.reconcile(&t).unwrap().phase,JobPhase::Finished);
    assert_eq!(std::fs::read_to_string(f.root.path_hint().join(&paths[0])).unwrap(),if mode==5{"outside change"}else{"int a = 1;\n"});
    assert_eq!(std::fs::read_to_string(f.root.path_hint().join(&paths[1])).unwrap(),"int a = 1;\n");
    assert_eq!(restored.status,if mode==5{"conflict"}else{"applied"});
    assert_eq!(f.catalog.report().unwrap().persistent_effect_barriers.len(),1);assert_ne!(f.catalog.admission("p",None,&[]),RecoveryAdmission::Ready);
    let saved:serde_json::Value=serde_json::from_slice(&f.store.read_artifact("p","restore-run","nativeRepairResult").unwrap()).unwrap();assert_eq!(saved["status"],restored.status);
    if mode==0{let saved:serde_json::Value=serde_json::from_slice(&f.store.read_artifact("p","restore-run","nativeRepairBefore").unwrap()).unwrap();assert_eq!(saved["preview"]["preview"]["files"][0]["before"],"int a = 2;\n");}
}
#[test] fn live_restore_writes_only_confirmed_reverse_with_new_backup_and_no_global_unlock(){live_restore_case(0);}
#[test] fn live_restore_other_effect_still_blocks(){live_restore_case(1);}
#[test] fn live_restore_changed_targets_fail_admission(){live_restore_case(2);}
#[test] fn live_restore_cancelled_registration_fails(){live_restore_case(3);}
#[test] fn live_restore_external_edit_prevents_preview(){live_restore_case(4);}
#[test] fn live_restore_external_edit_after_preview_is_not_overwritten(){live_restore_case(5);}
#[test] fn live_restore_failed_commit_never_writes(){live_restore_case(6);}

#[test] fn restart_restore_child_fixture(){if std::env::var_os("UAGENT_RESTART_CHILD_OUTPUT").is_some(){live_restore_case(if std::env::var("UAGENT_RESTART_CHILD_COMPLETE").as_deref()==Ok("1"){8}else{7});}}
#[test] fn restart_restore_real_process_exit_then_one_use_approved_write(){restart_restore_case(false,false);}
#[test] fn restart_restore_completed_write_without_barrier_after_real_process_exit(){restart_restore_case(true,false);}
#[test] fn restart_restore_unsettled_write_child_fixture(){if std::env::var_os("UAGENT_RESTART_CHILD_OUTPUT").is_some(){live_restore_case(9);}}
#[test]
fn restart_restore_exit_before_result_keeps_partial_effect_unsettled_and_blocks_retry(){
    use ledger::runtime_host_catalog_reader::BarrierReason;
    let output=std::path::PathBuf::from("E:/Codex/UAgent/.local-dev/temp/ue-operation-admission").join(format!("unsettled-{}.json",random_id().unwrap()));
    std::fs::create_dir_all(output.parent().unwrap()).unwrap();
    let mut child=std::process::Command::new(std::env::current_exe().unwrap()).args(["restart_restore_unsettled_write_child_fixture","--test-threads=1"]).env("UAGENT_RESTART_CHILD_OUTPUT",&output).spawn().unwrap();
    let deadline=Instant::now()+Duration::from_secs(30);
    loop{
        if let Some(status)=child.try_wait().unwrap(){assert_eq!(status.code(),Some(73));break;}
        if Instant::now()>deadline{let _=child.kill();let _=child.wait();panic!("owned unsettled fixture child timeout");}
        std::thread::sleep(Duration::from_millis(25));
    }
    let data:serde_json::Value=serde_json::from_slice(&std::fs::read(output).unwrap()).unwrap();
    let root=TrustedRootHandle::open_from_host_selection(std::path::Path::new(data["root"].as_str().unwrap())).unwrap();
    let store=RunStore::open(std::path::Path::new(data["store"].as_str().unwrap())).unwrap();
    assert_eq!(std::fs::read_to_string(root.path_hint().join("Source/Game/A.cpp")).unwrap(),"int a = 2;\n");
    assert_eq!(std::fs::read_to_string(root.path_hint().join("Source/Game/B.cpp")).unwrap(),"int a = 1;\n");
    let backup=store.read_artifact("p","r","nativeRepairBefore").unwrap();
    assert!(store.read_artifact("p","r","nativeRepairResult").is_err());
    let no=AtomicBool::new(false);let catalog=PersistentRecoveryCatalog::new();
    let scanned=catalog.scan_existing_store(&store,&no).unwrap();
    assert_eq!(scanned.persistent_effect_barriers.len(),1);
    let barrier=&scanned.persistent_effect_barriers[0];
    assert_eq!(barrier.reason,BarrierReason::HandoffUnsettled);
    assert_eq!(barrier.state,ledger::EffectState::MayHaveBeenSent);
    assert_eq!(barrier.dispatch.phase,ledger::DispatchPhase::InCallback);
    let yes=||true;let key=ledger::EffectKey{project_id:barrier.project_id.clone(),operation_id:barrier.operation_id.clone()};
    let scope=ledger::RecoveryReadScope::from_verified_host_read(&root,key,barrier.owner.clone(),"restart-inspection".into(),&yes).unwrap();
    let journal=store.open_effect_journal().unwrap();let original=journal.read(&scope).unwrap();
    assert_eq!(crate::ue_repair_recovery::observe_original_process(&backup,store.repair_execution_database_key().unwrap(),&original.intent).unwrap(),crate::repair_execution_identity::ProcessObservation::Ended);
    let report=crate::ue_repair_recovery::inspect(&root,"p","r",&backup,None,&no,Instant::now()+Duration::from_secs(10)).unwrap();
    assert!(!report.result_present);assert!(!report.restore_available);assert!(report.restore_candidates.is_empty());
    assert_eq!(report.restore_blocker,"original_execution_settlement_required");
    assert_eq!(report.files.len(),2);
    assert_eq!(report.files[0].state,"matches_after");assert_eq!(report.files[1].state,"matches_before");
    assert!(report.files.iter().all(|file|file.saved_effect=="unrecorded"&&!file.known_applied_match));
    assert!(journal.ended_repair_record("p","r").is_err());
    assert_eq!(original.recovery_advice(),ledger::RecoveryAdvice::QueryOnly);
    let context=ledger::CurrentRun::from_verified_host(&root,original.intent.owner.clone(),&yes).unwrap();
    journal.prepare(&context,&original.intent).unwrap();
    let retry=journal.mark_may_have_been_sent(&context,&original.intent.key,original.revision,4);
    assert_eq!(retry.err().unwrap().kind,"freshApprovalRequired");
    assert_eq!(journal.dispatch_gate(&scope).unwrap().phase,ledger::DispatchPhase::InCallback);
    let rescanned=catalog.scan_existing_store(&store,&no).unwrap();
    assert_eq!(rescanned.persistent_effect_barriers.len(),1);
    assert_eq!(rescanned.persistent_effect_barriers[0].reason,BarrierReason::HandoffUnsettled);
    assert_ne!(catalog.admission("p",Some(&root.identity().observation_key()),&[]),RecoveryAdmission::Ready);
}
fn restart_restore_case(complete:bool,source:bool){
 use crate::ue_build_repair::*;use crate::ue_build_repair_io::hash;
 let output=std::path::PathBuf::from("E:/Codex/UAgent/.local-dev/temp/ue-operation-admission").join(format!("restart-{}.json",random_id().unwrap()));
 std::fs::create_dir_all(output.parent().unwrap()).unwrap();
 let mut child=std::process::Command::new(std::env::current_exe().unwrap()).args(["restart_restore_child_fixture","--test-threads=1"]).env("UAGENT_RESTART_CHILD_OUTPUT",&output).env("UAGENT_RESTART_CHILD_COMPLETE",if complete{"1"}else{"0"}).env("UAGENT_RESTART_CHILD_SOURCE",if source{"1"}else{"0"}).spawn().unwrap();
 let deadline=Instant::now()+Duration::from_secs(30);loop{if let Some(status)=child.try_wait().unwrap(){assert!(status.success());break;}if Instant::now()>deadline{let _=child.kill();let _=child.wait();panic!("owned fixture child timeout");}std::thread::sleep(Duration::from_millis(25));}
 let data:serde_json::Value=serde_json::from_slice(&std::fs::read(output).unwrap()).unwrap();
 let root=Arc::new(TrustedRootHandle::open_from_host_selection(std::path::Path::new(data["root"].as_str().unwrap())).unwrap());
 let store=RunStore::open(std::path::Path::new(data["store"].as_str().unwrap())).unwrap();
 let journal=store.open_effect_journal().unwrap();let ended=journal.ended_repair_record("p","r").unwrap();
  if complete{assert_eq!(ended.state,ledger::EffectState::VerifiedCompleted);}
  let original=ended.intent;
 let backup=store.read_artifact("p","r","nativeRepairBefore").unwrap();let result=store.read_artifact("p","r","nativeRepairResult").unwrap();
 let no=AtomicBool::new(false);let report=crate::ue_repair_recovery::inspect(&root,"p","r",&backup,Some(&result),&no,Instant::now()+Duration::from_secs(10)).unwrap();assert_eq!(report.restore_candidates.len(),if complete{2}else{1});
 let value:serde_json::Value=serde_json::from_slice(&backup).unwrap();let old:RepairPreviewInput=serde_json::from_value(value["preview"]["preview"].clone()).unwrap();let mut binding=old.binding;binding.host_session_id="restart".into();
 let paths=report.restore_candidates.iter().map(|f|f.path.clone()).collect();
 let mut session=match (old.diagnostic,old.task){
    (Some(diagnostic),None)=>RepairSession::from_verified_host(root.as_ref().clone(),binding,diagnostic,paths),
    (None,Some(task))=>RepairSession::from_verified_task(root.as_ref().clone(),binding,task,paths),
    _=>panic!("invalid source origin"),
 }.unwrap();let snap=session.read_snapshots("restart").unwrap();
 let preview=session.prepare_replacements("restart",&snap.snapshot_id,hash(b"restart-reverse"),report.restore_candidates.into_iter().map(|f|(f.path,f.after)).collect()).unwrap();
 store.start_run("p",&NewRun{id:"restart-run".into(),session_id:"s".into(),goal:"explicit synthetic restore".into(),created_at:4}).unwrap();
 let host=RuntimeHostService::new().unwrap();let catalog=Arc::new(PersistentRecoveryCatalog::new());host.install_recovery_catalog(catalog.clone()).unwrap();let monitor=host.start_monitor().unwrap();
 let identity=OwnerIdentity{scope_id:"restart".into(),run_id:"restart-run".into(),project_id:"p".into(),root_ref:root.identity().observation_key(),conversation_id:"s".into(),provider_id:"native".into(),model_id:"none".into()};let owner=host.connect("window",identity.clone()).unwrap().owner;
 drop(journal);
 let f=Fixture{store,store_path:std::path::PathBuf::from(data["store"].as_str().unwrap()),root,host,_monitor:monitor,catalog,owner,identity,settled:Arc::new(AtomicBool::new(false))};
 let claims=if source {vec![ResourceClaim{kind:ResourceKind::FileWrite,key:f.identity.root_ref.clone()}]}
    else{vec![ResourceClaim{kind:ResourceKind::Ubt,key:"synthetic-engine".into()},ResourceClaim{kind:ResourceKind::FileWrite,key:f.identity.root_ref.clone()}]};
  let input=NativeOperationInput{owner:f.owner.clone(),job_id:"restart-write".into(),step_id:"repair".into(),queue_timeout_ms:10000,execution_timeout_ms:10000,
    resources:NativeResourceBinding::from_verified_root(f.root.clone(),claims).unwrap(),observer:Arc::new(Observer(f.settled.clone()))};
  let mut registration=if source{f.host.register_source_operation_pending("window",input,&f.identity,&f.catalog)}
    else{f.host.register_ue_operation_pending("window",input,&f.identity,&f.catalog)}.unwrap();
  let mut next=f.intent(&registration,"restart-write");next.adapter=original.adapter.clone();next.resources=original.resources.clone();next.idempotency_key=hash(format!("restart-restore:{}:{}",original.key.project_id,original.digest().unwrap()).as_bytes());next.approved_plan_digest=preview.native_plan_digest.clone();next.targets=preview.preview.files.iter().map(|f|ledger::EffectTarget{kind:ledger::TargetKind::File,locator:f.path.clone(),before_digest:Some(f.before_hash.clone()),after_digest:Some(f.after_hash.clone())}).collect();
 let yes=||true;let context=ledger::CurrentRun::from_verified_host(&f.root,next.owner.clone(),&yes).unwrap();let j=f.store.open_effect_journal().unwrap();
 assert!(j.prepare_ended_repair_restore(&context,&next,&original.key,&preview,&AtomicBool::new(true),Instant::now()+Duration::from_secs(10)).is_err());
 let permit=j.prepare_ended_repair_restore(&context,&next,&original.key,&preview,&no,Instant::now()+Duration::from_secs(10)).unwrap();
 assert!(j.prepare_ended_repair_restore(&context,&next,&original.key,&preview,&no,Instant::now()+Duration::from_secs(10)).is_err());
 let mut competitor=next.clone();competitor.key.operation_id="competing-restore".into();assert!(j.prepare_ended_repair_restore(&context,&competitor,&original.key,&preview,&no,Instant::now()+Duration::from_secs(10)).is_err());
 let mut ticket=j.mark_may_have_been_sent(&context,&next.key,1,5).unwrap();
  let handoff=registration.claim_ue_restore_once(&j,&context,&mut ticket,&f.catalog,Instant::now()+Duration::from_secs(5),&permit).expect("ended repair with a verified reverse preview must admit one approved restoration");
 let mut grant=NativeRepairGrant::from_verified_host_approval(&preview,10000).unwrap();let mut saved=crate::ue_build_repair_result::StoreRepairJournal::new(&f.store,&next);
 let restored=session.apply_approved("restart",&preview.preview.preview_id,&mut grant,&mut saved,&no).unwrap();assert_eq!(restored.status,"applied");
 f.settled.store(true,Ordering::SeqCst);registration.finish(true).unwrap();let proof=j.settle_owned_operation(handoff).unwrap();crate::ue_build_repair_result::persist(&f.store,&f.root,&next,&preview,&restored,saved.checkpoint_written,&f.catalog,&proof).unwrap();
 assert_eq!(std::fs::read_to_string(f.root.path_hint().join("Source/Game/A.cpp")).unwrap(),"int a = 1;\n");
  assert_eq!(std::fs::read_to_string(f.root.path_hint().join("Source/Game/B.cpp")).unwrap(),"int a = 1;\n");
  assert!(f.store.read_artifact("p","restart-run","nativeRepairResult").is_ok());
  if complete{assert_eq!(f.catalog.report().unwrap().persistent_effect_barriers.len(),0);}else{assert_ne!(f.catalog.admission("p",None,&[]),RecoveryAdmission::Ready);}
}

#[test]
fn source_only_operation_uses_durable_handoff_and_excludes_concurrent_builds() {
    let f=Fixture::new();
    let resources=NativeResourceBinding::from_verified_root(f.root.clone(),vec![ResourceClaim{kind:ResourceKind::FileWrite,key:f.identity.root_ref.clone()}]).unwrap();
    let mut registration=f.host.register_source_operation_pending("window",NativeOperationInput{owner:f.owner.clone(),job_id:"source".into(),step_id:"source-change".into(),
        queue_timeout_ms:10000,execution_timeout_ms:10000,resources,observer:Arc::new(Observer(f.settled.clone()))},&f.identity,&f.catalog).unwrap();
    assert!(matches!(f.reserve("concurrent-build"),Err("runtime_host_resource_conflict")));
    let mut intent=f.intent(&registration,"source");intent.adapter.id="native.source-change.v1".into();
    intent.resources=vec![ledger::ResourceClaim{kind:ledger::ResourceKind::FileWrite,key:f.identity.root_ref.clone()}];
    let yes=||true;let context=ledger::CurrentRun::from_verified_host(&f.root,intent.owner.clone(),&yes).unwrap();
    let journal=f.store.open_effect_journal().unwrap();journal.prepare(&context,&intent).unwrap();
    let mut ticket=journal.mark_may_have_been_sent(&context,&intent.key,1,3).unwrap();
    assert_eq!(registration.begin().unwrap_err(),"runtime_host_operation_transaction_required");
    let handoff=registration.claim_ue_once(&journal,&context,&mut ticket,&f.catalog,Instant::now()+Duration::from_secs(2)).unwrap();
    registration.check_started_ue_operation(&intent).unwrap();
    f.settled.store(true,Ordering::Release);registration.finish(true).unwrap();
    journal.settle_owned_operation(handoff).unwrap();
}

#[test] fn restart_restore_goal_source_completed_after_real_process_exit(){restart_restore_case(true,true);}
#[test] fn restart_restore_goal_source_partial_after_real_process_exit(){restart_restore_case(false,true);}
