//! Test SOURCE ONLY: run serially under the existing reviewed native test infrastructure.
use super::*;
use std::sync::Mutex;
use crate::runtime_host_recovery_catalog::PersistentRecoveryCatalog;
use crate::runtime_host_service::{RecoveryCatalog,RecoveryAdmission};
use crate::local_run_store::{Project,Session,Origin,NewRun,RunStatus,Checkpoint,CheckpointBatch};
struct HeldOwner { task:Mutex<Option<ManagedStoreWork>>, reject:bool }
impl NativeManagedStoreOwner for HeldOwner {
    fn is_current(&self)->bool{true}
    fn submit(&self,task:ManagedStoreWork)->StoreResult<()>{
        if self.reject {task.reject(unavailable());return Err(unavailable());}
        *self.task.lock().unwrap()=Some(task);Ok(())
    }
    fn close(&self){}
}
// These are the same concrete state primitives passed by ManagedRunStoreState.
// This fixture does not stand in for its install/window/close adapter.
fn queued(reject:bool)->(
    OnceLock<Arc<dyn NativeManagedStoreOwner>>,
    OnceLock<Arc<PersistentRecoveryCatalog>>,
    Arc<AtomicBool>,Arc<HeldOwner>,Arc<PersistentRecoveryCatalog>
){
    let owner_slot:OnceLock<Arc<dyn NativeManagedStoreOwner>>=OnceLock::new();
    let owner=Arc::new(HeldOwner{task:Mutex::new(None),reject});
    assert!(owner_slot.set(owner.clone()).is_ok());
    let catalog=Arc::new(PersistentRecoveryCatalog::new());
    (owner_slot,OnceLock::new(),Arc::new(AtomicBool::new(false)),owner,catalog)
}
fn store()->RunStore{
    let root=std::path::PathBuf::from("E:/Codex/UAgent/2026-10-29/tmp/recovery-startup-scan-tests")
        .join(format!("{}-{}",std::process::id(),std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    let store=RunStore::open(root).unwrap();drop(store.open_effect_journal().unwrap());store
}
#[test]
fn empty_scan_only_becomes_visible_after_original_worker_release_and_never_ready(){
    let (owner_slot,catalog_slot,closed,owner,catalog)=queued(false);schedule_startup_scan(&catalog_slot,&owner_slot,&closed,catalog.clone()).unwrap();
    let mut task=owner.task.lock().unwrap().take().unwrap();
    let apply=task.apply.take().unwrap();let observed=catalog.clone();
    task.apply=Some(Box::new(move |store|{apply(store);assert!(!observed.report().unwrap().scan_complete);}));
    let complete=task.complete.take().unwrap();let observed=catalog.clone();
    task.complete=Some(Box::new(move |released|{
        // Entering a new scope proves the original thread-local scope has dropped.
        let scope=crate::local_run_store::database_owner::OperationScope::enter(
            Arc::new(AtomicBool::new(false)),Instant::now()+Duration::from_secs(1)).unwrap();drop(scope);
        complete(released);assert!(observed.report().unwrap().scan_complete);
    }));
    let scope=crate::local_run_store::database_owner::OperationScope::enter(task.cancelled(),task.deadline()).unwrap();
    task.run(store(),scope);
    assert!(!catalog.report().unwrap().positive_admission_ready);
    assert_eq!(catalog.admission("p",None,&[]),RecoveryAdmission::Unknown);
}
#[test]
fn rejected_submission_is_not_retried_or_ready(){
    let(owner_slot,catalog_slot,closed,owner,catalog)=queued(true);assert!(schedule_startup_scan(&catalog_slot,&owner_slot,&closed,catalog.clone()).is_err());
    assert!(schedule_startup_scan(&catalog_slot,&owner_slot,&closed,catalog.clone()).is_err());assert!(owner.task.lock().unwrap().is_none());
    assert!(!catalog.report().unwrap().scan_complete);
}
#[test]
fn queued_close_prevents_scan_and_success_publication(){
    let(owner_slot,catalog_slot,closed,owner,catalog)=queued(false);schedule_startup_scan(&catalog_slot,&owner_slot,&closed,catalog.clone()).unwrap();
    // Same flag as close(), without closing the process-global Store domain of other tests.
    closed.store(true,Ordering::Release);
    let task=owner.task.lock().unwrap().take().unwrap();
    let scope=crate::local_run_store::database_owner::OperationScope::enter(Arc::new(AtomicBool::new(false)),Instant::now()+Duration::from_secs(1)).unwrap();
    task.run(store(),scope);assert!(!catalog.report().unwrap().scan_complete);
}
#[test]
fn close_after_read_before_completion_cannot_publish_success(){
    let(owner_slot,catalog_slot,closed,owner,catalog)=queued(false);schedule_startup_scan(&catalog_slot,&owner_slot,&closed,catalog.clone()).unwrap();
    let mut task=owner.task.lock().unwrap().take().unwrap();let apply=task.apply.take().unwrap();let closed=closed.clone();
    task.apply=Some(Box::new(move |store|{apply(store);closed.store(true,Ordering::Release);}));
    let scope=crate::local_run_store::database_owner::OperationScope::enter(task.cancelled(),task.deadline()).unwrap();
    task.run(store(),scope);assert!(!catalog.report().unwrap().scan_complete);
    assert!(!catalog.report().unwrap().positive_admission_ready);
}
#[test]
fn expired_scan_cannot_publish_a_snapshot(){
    let catalog=PersistentRecoveryCatalog::new();let store=store();
    assert!(catalog.scan_startup_store(&store,&AtomicBool::new(false),Instant::now()).is_err());
    assert!(!catalog.report().unwrap().scan_complete);
}
#[test]
fn real_legacy_running_barrier_survives_scan_failure(){
    let store=store();store.create_project(&Project{id:"p".into(),root:"synthetic".into(),label:"synthetic".into(),created_at:1}).unwrap();
    store.create_session(&Session{project_id:"p".into(),id:"s".into(),title:"synthetic".into(),created_at:1,archived:false,parent_id:None,origin:Origin::Native}).unwrap();
    store.start_run("p",&NewRun{id:"r".into(),session_id:"s".into(),goal:"synthetic".into(),created_at:1}).unwrap();
    store.commit_checkpoint("p","r",0,&CheckpointBatch{status:RunStatus::Running,
        checkpoint:Checkpoint{next_step_id:None,reason:"synthetic".into(),summary:"synthetic".into(),captured_at:2},
        messages:vec![],steps:vec![],tool_calls:vec![],events:vec![],changesets:vec![],artifacts:vec![]}).unwrap();
    let catalog=PersistentRecoveryCatalog::new();catalog.scan_existing_store(&store,&AtomicBool::new(false)).unwrap();
    assert!(catalog.report().unwrap().legacy_unknown.iter().any(|row|row.run_id=="r"));
    assert!(catalog.scan_startup_store(&store,&AtomicBool::new(true),Instant::now()+Duration::from_secs(1)).is_err());
    assert!(catalog.report().unwrap().legacy_unknown.iter().any(|row|row.run_id=="r"));
    assert_eq!(catalog.admission("p",None,&[]),RecoveryAdmission::Blocked);
}

#[test]
fn final_owner_observation_crossing_deadline_cannot_publish_completion(){
    struct DelayedOwner { deadline:Instant, returned:Arc<AtomicBool> }
    impl NativeManagedStoreOwner for DelayedOwner {
        fn is_current(&self)->bool{
            // Wait for an observed monotonic deadline, not a guessed fixed sleep.
            while Instant::now()<self.deadline{
                std::thread::park_timeout(self.deadline.saturating_duration_since(Instant::now()));
            }
            self.returned.store(true,Ordering::Release);true
        }
        fn submit(&self,_task:ManagedStoreWork)->StoreResult<()>{Err(unavailable())}
        fn close(&self){}
    }
    let store=store();let catalog=PersistentRecoveryCatalog::new();
    let closed=Arc::new(AtomicBool::new(false));catalog.bind_startup_lifetime(closed.clone()).unwrap();
    catalog.scan_existing_store(&store,&AtomicBool::new(false)).unwrap();drop(store);
    // Exercise the SAME production completion helper; worker-release ordering is
    // covered separately. This test-only witness cannot be built in production.
    let released=ReleasedStoreDomain{worker:std::thread::current().id(),_thread:std::marker::PhantomData};
    let returned=Arc::new(AtomicBool::new(false));let deadline=Instant::now()+Duration::from_millis(10);
    let owner:Arc<dyn NativeManagedStoreOwner>=Arc::new(DelayedOwner{deadline,returned:returned.clone()});
    complete_startup_scan(&released,&owner,&catalog,&closed,deadline);
    assert!(returned.load(Ordering::Acquire));assert!(Instant::now()>=deadline);
    let report=catalog.report().unwrap();assert!(!report.scan_complete);
    assert_eq!(report.status,"startup_scan_completion_revoked");
    assert_eq!(catalog.admission("p",None,&[]),RecoveryAdmission::Unknown);
}
