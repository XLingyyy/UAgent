//! Focused host protocol with real isolated disk Store/root objects and monitor.
//! No read/share grant, provider credential, network/transport or full-app claim.
use super::*;
use crate::local_run_store::{RunStore,Project,StoreError,Session,Origin,NewRun,RunStatus,Checkpoint,CheckpointBatch};
use crate::local_run_store::native_run_creation::{NativeRunCreation,NativeDocumentIdentity};
use crate::local_run_store::project_memory::{
    MemoryContent,MemoryOrigin,MemoryMutation,MemoryExecution,MemoryDispatchScope,MemoryDispatchSelection,
};
use std::path::PathBuf;

struct Fixture {store:RunStore,root:Arc<TrustedRootHandle>,project_path:PathBuf,
    creation:Arc<NativeRunCreation>,document:Arc<NativeDocumentIdentity>,alive:Arc<AtomicBool>}
impl Drop for Fixture {fn drop(&mut self){self.creation.invalidate_for_owner(&self.alive);}}
fn batch(status:RunStatus,at:i64)->CheckpointBatch {
    CheckpointBatch{status,checkpoint:Checkpoint{next_step_id:None,reason:"synthetic".into(),summary:"synthetic".into(),captured_at:at},
        messages:vec![],steps:vec![],tool_calls:vec![],events:vec![],changesets:vec![],artifacts:vec![]}
}
fn fixture()->Fixture {fixture_with_owner(true)}
fn fixture_with_owner(bind:bool)->Fixture {
    let base=PathBuf::from(r"E:\Codex\UAgent\2026-10-29\tmp\memory-host-admission-tests")
        .join(format!("{}-{}",std::process::id(),std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    let project_path=base.join("project");
    std::fs::create_dir_all(&project_path).unwrap();
    let root=Arc::new(TrustedRootHandle::open_from_host_selection(&project_path).unwrap());
    let store=RunStore::open(base.join("store")).unwrap();
    store.create_project(&Project{id:"p".into(),root:project_path.to_string_lossy().into_owned(),label:"synthetic".into(),created_at:1}).unwrap();
    drop(store.open_effect_journal().unwrap());
    store.create_session(&Session{project_id:"p".into(),id:"s".into(),title:"synthetic".into(),created_at:1,
        archived:false,parent_id:None,origin:Origin::Native}).unwrap();
    let document=NativeDocumentIdentity::new(Arc::new(AtomicBool::new(false)));
    let creation=store.start_run_for_native_document("p",&NewRun{id:"r".into(),session_id:"s".into(),
        goal:"synthetic native running run".into(),created_at:1},document.clone(),"provider","model").unwrap();
    let before=store.run("p","r").unwrap();
    store.commit_checkpoint("p","r",0,&batch(RunStatus::Running,2)).unwrap();
    let after=store.run("p","r").unwrap();
    store.record_original_native_commit(&document,Some(creation.clone()),&before,&after,"provider","model").unwrap();
    let alive=Arc::new(AtomicBool::new(true));
    if bind{creation.bind_native_run(&document,alive.clone(),Instant::now()+Duration::from_secs(10),"provider","model").unwrap();}
    let flag=AtomicBool::new(false);
    let execution=MemoryExecution::new(&flag,Instant::now()+Duration::from_secs(2));
    store.create_project_memory(&execution,"p","m",MemoryContent{
        kind:"decision".into(),body:"exact synthetic decision".into(),source_refs:vec![],
        share_paths:vec![String::new()],priority:"normal".into(),visibility:"project".into(),
        origin:MemoryOrigin{kind:"user".into(),session_id:None,message_id:None},read_at:1,
    }).unwrap();
    store.update_project_memory(&execution,"p","m",1,MemoryMutation::Confirm,2).unwrap();
    Fixture{store,root,project_path,creation,document,alive}
}
fn expected(root:&Arc<TrustedRootHandle>)->OwnerIdentity {
    OwnerIdentity{scope_id:"scope".into(),run_id:"r".into(),project_id:"p".into(),
        root_ref:root.identity().observation_key(),conversation_id:"s".into(),provider_id:"provider".into(),model_id:"model".into()}
}
fn model_owner()->NativeModelOwner<'static> {
    NativeModelOwner{project:"p",run:"r",conversation:"s",provider:"provider",model:"model"}
}
fn owner_and_registration(f:&Fixture)->(RuntimeHostService,RuntimeHostMonitor,Arc<PersistentRecoveryCatalog>,RegisteredExecution) {
    let host=RuntimeHostService::new().unwrap();
    let catalog=Arc::new(PersistentRecoveryCatalog::new());
    host.install_recovery_catalog(catalog.clone()).unwrap();
    let monitor=host.start_monitor().unwrap();
    let identity=expected(&f.root);
    let owner=host.connect("window",identity.clone()).unwrap().owner;
    let registration=host.register_memory_model_pending("window",ModelJobInput{
        owner,job_id:"request".into(),step_id:"model".into(),queue_timeout_ms:10000,execution_timeout_ms:10000,
    },f.root.clone(),&identity,&catalog,f.creation.clone(),f.alive.clone()).unwrap();
    (host,monitor,catalog,registration)
}
fn map_host<T>(value:HostResult<T>)->crate::local_run_store::Result<T> {
    value.map_err(|kind|StoreError{kind:kind.into(),message:"synthetic final host rejection".into()})
}
fn physical<T>(f:&Fixture,catalog:&PersistentRecoveryCatalog,
    work:impl for<'fence> FnOnce(TransactionRecoveryAdmission<'fence>)->crate::local_run_store::Result<T>,
)->crate::local_run_store::Result<T> {
    let flag=AtomicBool::new(false);
    let execution=MemoryExecution::new(&flag,Instant::now()+Duration::from_secs(2));
    let paths=vec![String::new()];
    let scope=MemoryDispatchScope{project_id:"p",read_prefixes:&paths,share_prefixes:&paths,max_context_bytes:24_576};
    let rows=f.store.project_memory_dispatch_snapshot(&execution,&scope,&[MemoryDispatchSelection{id:"m",revision:2}])?;
    f.store.with_verified_project_memory_batch(&execution,&scope,&rows,|memory|{
        f.store.with_owned_memory_recovery_snapshot(&execution,&memory,&f.creation,&f.alive,|snapshot|{
            catalog.with_transaction_admission(snapshot,work)
        })
    })
}
#[test]
fn original_registration_needs_real_physical_callback_and_settles_only_after_return() {
    let f=fixture();
    let (host,_monitor,catalog,mut registration)=owner_and_registration(&f);
    let ticket=registration.identity().ticket.clone();
    let owner=OwnerRef{host_generation:ticket.host_generation.clone(),owner_id:ticket.owner_id.clone()};
    let status=host.status("window",&owner).unwrap();
    assert_eq!(status.pending_executions,1);
    assert_eq!(status.jobs[0].phase,JobPhase::HandoffPending);
    assert_eq!(registration.begin().unwrap_err(),"runtime_host_memory_transaction_required");
    assert_eq!(catalog.admission("p",None,&[]),RecoveryAdmission::Unknown);
    physical(&f,&catalog,|recovery|{
        let mut guard=map_host(registration.lock_memory_admission(&recovery))?;
        map_host(guard.start_at_l(&model_owner(),&f.root))
    }).unwrap();
    registration.check_started_memory_owner(&model_owner(),&f.root).unwrap();
    let finished=registration.finish(true).unwrap();
    assert_eq!(finished.phase,JobPhase::Finished);
    assert_eq!(finished.execution_observation,ExecutionObservation::Quiescent);
    assert_eq!(catalog.admission("p",None,&[]),RecoveryAdmission::Unknown);
}
#[test]
fn cancel_between_validation_reservation_and_l_never_starts_it() {
    let f=fixture();
    let (host,_monitor,catalog,mut registration)=owner_and_registration(&f);
    host.cancel("window",&registration.identity().ticket).unwrap();
    let error=physical(&f,&catalog,|recovery|{
        let mut guard=map_host(registration.lock_memory_admission(&recovery))?;
        map_host(guard.start_at_l(&model_owner(),&f.root))
    }).unwrap_err();
    assert_eq!(error.kind,"nativeRunCreationRequired");
    assert_eq!(registration.finish_not_started().unwrap().phase,JobPhase::Finished);
}
#[test]
fn execution_expiry_is_checked_at_the_same_final_l_without_sleep() {
    let f=fixture();
    let (host,_monitor,catalog,mut registration)=owner_and_registration(&f);
    find_job(&mut host.lock().unwrap(),&registration.identity().ticket).unwrap().execution_deadline=Some(Instant::now());
    let error=physical(&f,&catalog,|recovery|{
        let mut guard=map_host(registration.lock_memory_admission(&recovery))?;
        map_host(guard.start_at_l(&model_owner(),&f.root))
    }).unwrap_err();
    assert_eq!(error.kind,"runtime_host_dispatch_revoked");
    registration.finish_not_started().unwrap();
}
#[test]
fn a_different_catalog_object_cannot_supply_final_admission() {
    let f=fixture();
    let (_host,_monitor,_catalog,mut registration)=owner_and_registration(&f);
    let other=PersistentRecoveryCatalog::new();
    let error=physical(&f,&other,|recovery|{
        let _guard=map_host(registration.lock_memory_admission(&recovery))?;
        Ok(())
    }).unwrap_err();
    assert_eq!(error.kind,"runtime_host_catalog_changed");
    registration.finish_not_started().unwrap();
}
#[test]
fn changing_the_physical_database_is_sticky_and_original_rescan_does_not_repair_it() {
    let a=fixture();
    let b=fixture();
    let catalog=PersistentRecoveryCatalog::new();
    physical(&a,&catalog,|_|Ok(())).unwrap();
    assert!(physical(&b,&catalog,|_|Ok(())).is_err());
    assert!(physical(&a,&catalog,|_|Ok(())).is_err());
    assert_eq!(catalog.report().unwrap().status,"physical_database_changed");
}
#[test]
fn reopening_the_same_root_cannot_substitute_its_original_held_arc() {
    let f=fixture();
    let (_host,_monitor,catalog,mut registration)=owner_and_registration(&f);
    let replacement=Arc::new(TrustedRootHandle::open_from_host_selection(&f.project_path).unwrap());
    assert_eq!(replacement.identity(),f.root.identity());
    let error=physical(&f,&catalog,|recovery|{
        let mut guard=map_host(registration.lock_memory_admission(&recovery))?;
        map_host(guard.start_at_l(&model_owner(),&replacement))
    }).unwrap_err();
    assert_eq!(error.kind,"runtime_host_root_stale");
    registration.finish_not_started().unwrap();
}
#[test]
fn provider_model_owner_mismatch_fails_in_the_final_host_section() {
    let f=fixture();
    let (_host,_monitor,catalog,mut registration)=owner_and_registration(&f);
    let wrong=NativeModelOwner{model:"another-model",..model_owner()};
    let error=physical(&f,&catalog,|recovery|{
        let mut guard=map_host(registration.lock_memory_admission(&recovery))?;
        map_host(guard.start_at_l(&wrong,&f.root))
    }).unwrap_err();
    assert_eq!(error.kind,"runtime_host_owner_revoked");
    registration.finish_not_started().unwrap();
}
// All isolated fixture directories/databases are retained. No deletion.

#[test]
fn ordinary_scan_of_pending_fresh_creator_does_not_manufacture_a_legacy_barrier() {
    let f=fixture_with_owner(false);
    let catalog=PersistentRecoveryCatalog::new();
    let report=catalog.scan_existing_store(&f.store,&AtomicBool::new(false)).unwrap();
    assert!(!report.scan_complete);
    assert_eq!(report.status,"native_run_owner_pending");
    assert!(report.legacy_unknown.is_empty());
    f.creation.bind_native_run(&f.document,f.alive.clone(),Instant::now()+Duration::from_secs(10),"provider","model").unwrap();
    physical(&f,&catalog,|proof|{
        assert_eq!(proof.admission("p",None,&[]),RecoveryAdmission::Ready);Ok(())
    }).unwrap();
    assert!(catalog.report().unwrap().legacy_unknown.is_empty());
}
#[test]
fn an_unowned_running_row_stays_sticky_after_a_later_terminal_row() {
    let f=fixture();
    f.store.start_run("p",&NewRun{id:"unowned".into(),session_id:"s".into(),goal:"legacy".into(),created_at:1}).unwrap();
    f.store.commit_checkpoint("p","unowned",0,&batch(RunStatus::Running,2)).unwrap();
    let catalog=PersistentRecoveryCatalog::new();
    physical(&f,&catalog,|proof|{
        assert_eq!(proof.admission("p",None,&[]),RecoveryAdmission::Blocked);Ok(())
    }).unwrap();
    assert!(catalog.report().unwrap().legacy_unknown.iter().any(|row|row.run_id=="unowned"));
    f.store.commit_checkpoint("p","unowned",1,&batch(RunStatus::Succeeded,3)).unwrap();
    physical(&f,&catalog,|proof|{
        assert_eq!(proof.admission("p",None,&[]),RecoveryAdmission::Blocked);Ok(())
    }).unwrap();
}
#[test]
fn equal_owner_flags_from_another_allocation_cannot_substitute_the_original() {
    let f=fixture();
    let flag=AtomicBool::new(false);
    let execution=MemoryExecution::new(&flag,Instant::now()+Duration::from_secs(2));
    let paths=vec![String::new()];
    let scope=MemoryDispatchScope{project_id:"p",read_prefixes:&paths,share_prefixes:&paths,max_context_bytes:24576};
    let rows=f.store.project_memory_dispatch_snapshot(&execution,&scope,&[MemoryDispatchSelection{id:"m",revision:2}]).unwrap();
    let other=Arc::new(AtomicBool::new(true));
    let error=f.store.with_verified_project_memory_batch(&execution,&scope,&rows,|memory|{
        f.store.with_owned_memory_recovery_snapshot(&execution,&memory,&f.creation,&other,|_|Ok(()))
    }).unwrap_err();
    assert_eq!(error.kind,"nativeRunCreationRequired");
}
#[test]
fn ordinary_scan_a_cannot_be_rebound_by_the_first_physical_b_transaction() {
    let a=fixture();let b=fixture();let catalog=PersistentRecoveryCatalog::new();
    catalog.scan_existing_store(&a.store,&AtomicBool::new(false)).unwrap();
    assert!(physical(&b,&catalog,|_|Ok(())).is_err());
    assert_eq!(catalog.report().unwrap().status,"physical_database_changed");
}

#[test]
fn cancelled_owner_can_persist_stopping_rows_without_renewing_send_authority() {
    let f=fixture();
    f.creation.invalidate_for_owner(&f.alive);
    assert!(!f.alive.load(Ordering::Acquire));
    for (revision,status) in [(1,RunStatus::Paused),(2,RunStatus::Cancelled)] {
        let before=f.store.run("p","r").unwrap();
        f.store.commit_checkpoint("p","r",revision,&batch(status,revision+2)).unwrap();
        let after=f.store.run("p","r").unwrap();
        f.store.record_original_native_commit(&f.document,None,&before,&after,"provider","model").unwrap();
        assert!(f.creation.check_original_owner(&f.alive).is_err());
        assert!(f.creation.bind_native_run(&f.document,Arc::new(AtomicBool::new(true)),
            Instant::now()+Duration::from_secs(10),"provider","model").is_err());
    }
    let pin=f.store.pin_runtime_host_database().unwrap();
    assert!(crate::local_run_store::native_run_creation::original_native_run_creation("p","r",&f.document,&pin).is_err());
    assert_eq!(f.store.run("p","r").unwrap().status,RunStatus::Cancelled);
}
#[test]
fn another_native_live_creator_is_never_exempted_by_this_requests_snapshot() {
    for revoke_after_scan in [false,true] {
        let f=fixture();
        let other=f.store.start_run_for_native_document("p",&NewRun{id:"other".into(),session_id:"s".into(),
            goal:"other native run".into(),created_at:1},f.document.clone(),"provider","model").unwrap();
        let before=f.store.run("p","other").unwrap();
        f.store.commit_checkpoint("p","other",0,&batch(RunStatus::Running,2)).unwrap();
        let after=f.store.run("p","other").unwrap();
        f.store.record_original_native_commit(&f.document,Some(other.clone()),&before,&after,"provider","model").unwrap();
        let other_alive=Arc::new(AtomicBool::new(true));
        other.bind_native_run(&f.document,other_alive.clone(),Instant::now()+Duration::from_secs(10),"provider","model").unwrap();
        let (_host,_monitor,catalog,mut registration)=owner_and_registration(&f);
        let error=physical(&f,&catalog,|proof|{
            assert_eq!(proof.admission("p",None,&[]),RecoveryAdmission::Unknown);
            if revoke_after_scan{other.invalidate_for_owner(&other_alive);}
            let mut guard=map_host(registration.lock_memory_admission(&proof))?;
            map_host(guard.start_at_l(&model_owner(),&f.root))
        }).unwrap_err();
        assert_eq!(error.kind,"runtime_host_recovery_blocked");
        assert!(catalog.report().unwrap().legacy_unknown.is_empty());
        registration.finish_not_started().unwrap();
        other.invalidate_for_owner(&other_alive);
        physical(&f,&catalog,|proof|{
            assert_eq!(proof.admission("p",None,&[]),RecoveryAdmission::Blocked);Ok(())
        }).unwrap();
        assert!(catalog.report().unwrap().legacy_unknown.iter().any(|row|row.run_id=="other"));
    }
}


// Only these external_ledger_* cases are selected by the focused runner.
use crate::local_run_store::external_sqlite_writer_tests::with_raw_writer;
fn external_database(f:&Fixture)->PathBuf {f.project_path.parent().unwrap().join("store/runs.sqlite3")}
const EXTERNAL_RUNNING:&str="INSERT INTO runs(project_id,id,session_id,goal,status,created_at,updated_at) VALUES('p','external','s','synthetic external writer','running',1,1)";
fn final_l(f:&Fixture,catalog:&PersistentRecoveryCatalog,registration:&mut RegisteredExecution)->crate::local_run_store::Result<()> {
    physical(f,catalog,|proof|{
        let mut guard=map_host(registration.lock_memory_admission(&proof))?;
        map_host(guard.start_at_l(&model_owner(),&f.root))
    })
}
// Produce valid durable rows through the real journal API, then let the raw
// second connection import those bytes. No copied digest/transition algorithm.
fn uncertain_effect_donor()->Fixture {
    use crate::local_run_store::effect_reconciliation as journal;
    let f=fixture();
    let owner=journal::OperationOwner{scope_id:"synthetic-effect".into(),run_id:"r".into(),project_id:"p".into(),
        root_ref:f.root.identity().observation_key(),conversation_id:"s".into(),provider_id:"provider".into(),model_id:"model".into(),
        step_id:"effect".into(),execution_id:"synthetic-execution".into(),host_generation:"synthetic-generation".into()};
    let intent=journal::EffectIntent{key:journal::EffectKey{project_id:"p".into(),operation_id:"external-effect".into()},owner:owner.clone(),
        root_object_id:f.root.identity().observation_key(),adapter:journal::AdapterIdentity{id:"synthetic.effect".into(),version:1},
        idempotency_key:"a".repeat(64),approved_plan_digest:"b".repeat(64),plan_summary:"synthetic only".into(),
        targets:vec![journal::EffectTarget{kind:journal::TargetKind::File,locator:"Source/a.txt".into(),before_digest:Some("c".repeat(64)),after_digest:Some("d".repeat(64))}],
        resources:vec![journal::ResourceClaim{kind:journal::ResourceKind::FileWrite,key:"synthetic-file".into()}],created_at:2};
    {
        let current=||true;
        let context=journal::CurrentRun::from_verified_host(&f.root,owner,&current).unwrap();
        let journal=f.store.open_effect_journal().unwrap();
        journal.prepare(&context,&intent).unwrap();
        drop(journal.mark_may_have_been_sent(&context,&intent.key,1,3).unwrap());
    }
    f
}
fn attach_donor(f:&Fixture)->String {
    format!("ATTACH DATABASE '{}' AS donor",external_database(f).to_string_lossy().replace('\'',"''"))
}
fn import_effect()->String {
    let mut sql=String::from("BEGIN IMMEDIATE;");
    for table in ["effect_intents","effect_dispatch_gates","effect_journal_events","effect_dispatch_events"] {
        sql.push_str(&format!("INSERT INTO main.{table} SELECT * FROM donor.{table};"));
    }
    sql.push_str("COMMIT;");sql
}
#[test]
fn external_ledger_before_transaction_blocks_real_final_l() {
    for durable in [false,true] {
        let f=fixture();let donor=uncertain_effect_donor();
        let (_host,_monitor,catalog,mut registration)=owner_and_registration(&f);
        with_raw_writer(external_database(&f),|writer|{
            assert_eq!(writer.execute("PRAGMA foreign_keys=ON".into()),0);
            assert_eq!(writer.execute(attach_donor(&donor)),0);
            assert_eq!(writer.execute(if durable{import_effect()}else{EXTERNAL_RUNNING.into()}),0);
            assert_eq!(final_l(&f,&catalog,&mut registration).unwrap_err().kind,"runtime_host_recovery_blocked");
            assert!(registration.check_started_memory_owner(&model_owner(),&f.root).is_err());
            let report=catalog.report().unwrap();
            if durable {assert!(report.persistent_effect_barriers.iter().any(|r|r.operation_id=="external-effect"));}
            else {assert!(report.legacy_unknown.iter().any(|r|r.run_id=="external"));}
        });
        registration.finish_not_started().unwrap();
    }
}
#[test]
fn external_ledger_writer_is_busy_between_complete_snapshot_and_final_l() {
    let f=fixture();let donor=uncertain_effect_donor();
    let (_host,_monitor,catalog,mut registration)=owner_and_registration(&f);
    with_raw_writer(external_database(&f),|writer|{
        assert_eq!(writer.execute(attach_donor(&donor)),0);
        physical(&f,&catalog,|proof|{
            assert_eq!(proof.admission("p",None,&[]),RecoveryAdmission::Ready);
            assert_eq!(writer.execute(EXTERNAL_RUNNING.into()),5);
            assert_eq!(writer.execute(import_effect()),5);
            let mut guard=map_host(registration.lock_memory_admission(&proof))?;
            map_host(guard.start_at_l(&model_owner(),&f.root))?;
            // Still inside the original SQLite transaction even after L.
            assert_eq!(writer.execute(EXTERNAL_RUNNING.into()),5);
            Ok(())
        }).unwrap();
        registration.check_started_memory_owner(&model_owner(),&f.root).unwrap();
        assert!(catalog.report().unwrap().legacy_unknown.is_empty());
        assert!(catalog.report().unwrap().persistent_effect_barriers.is_empty());
    });
    registration.finish(true).unwrap();
}
#[test]
fn external_ledger_after_release_is_seen_by_next_l_and_remains_sticky() {
    let f=fixture();
    let (host,_monitor,catalog,mut first)=owner_and_registration(&f);
    let owner=OwnerRef{host_generation:first.identity().ticket.host_generation.clone(),owner_id:first.identity().ticket.owner_id.clone()};
    final_l(&f,&catalog,&mut first).unwrap();
    first.finish(true).unwrap();
    with_raw_writer(external_database(&f),|writer|{
        assert_eq!(writer.execute(EXTERNAL_RUNNING.into()),0);
        let mut next=host.register_memory_model_pending("window",ModelJobInput{owner,job_id:"next-request".into(),step_id:"model".into(),queue_timeout_ms:10000,execution_timeout_ms:10000},
            f.root.clone(),&expected(&f.root),&catalog,f.creation.clone(),f.alive.clone()).unwrap();
        assert_eq!(final_l(&f,&catalog,&mut next).unwrap_err().kind,"runtime_host_recovery_blocked");
        assert!(next.check_started_memory_owner(&model_owner(),&f.root).is_err());
        // Updating the external row cannot erase already observed uncertainty.
        assert_eq!(writer.execute("UPDATE runs SET status='succeeded',revision=revision+1 WHERE project_id='p' AND id='external'".into()),0);
        assert_eq!(final_l(&f,&catalog,&mut next).unwrap_err().kind,"runtime_host_recovery_blocked");
        assert!(catalog.report().unwrap().legacy_unknown.iter().any(|r|r.run_id=="external"));
        assert_eq!(catalog.admission("p",None,&[]),RecoveryAdmission::Blocked);
        next.finish_not_started().unwrap();
    });
}
#[test]
fn external_ledger_current_owner_does_not_exempt_other_native_or_external_rows() {
    let f=fixture();
    let other=f.store.start_run_for_native_document("p",&NewRun{id:"other".into(),session_id:"s".into(),goal:"other native".into(),created_at:1},
        f.document.clone(),"provider","model").unwrap();
    let before=f.store.run("p","other").unwrap();
    f.store.commit_checkpoint("p","other",0,&batch(RunStatus::Running,2)).unwrap();
    let after=f.store.run("p","other").unwrap();
    f.store.record_original_native_commit(&f.document,Some(other.clone()),&before,&after,"provider","model").unwrap();
    let alive=Arc::new(AtomicBool::new(true));
    other.bind_native_run(&f.document,alive.clone(),Instant::now()+Duration::from_secs(10),"provider","model").unwrap();
    let (_host,_monitor,catalog,mut registration)=owner_and_registration(&f);
    assert_eq!(final_l(&f,&catalog,&mut registration).unwrap_err().kind,"runtime_host_recovery_blocked");
    assert_eq!(catalog.report().unwrap().status,"native_run_owner_pending");
    with_raw_writer(external_database(&f),|writer|{
        assert_eq!(writer.execute(EXTERNAL_RUNNING.into()),0);
        assert_eq!(final_l(&f,&catalog,&mut registration).unwrap_err().kind,"runtime_host_recovery_blocked");
        other.invalidate_for_owner(&alive);
        assert_eq!(final_l(&f,&catalog,&mut registration).unwrap_err().kind,"runtime_host_recovery_blocked");
        let report=catalog.report().unwrap();
        for id in ["other","external"] {assert!(report.legacy_unknown.iter().any(|r|r.run_id==id));}
        assert!(!report.legacy_unknown.iter().any(|r|r.run_id=="r"));
    });
    assert!(registration.check_started_memory_owner(&model_owner(),&f.root).is_err());
    registration.finish_not_started().unwrap();
}
