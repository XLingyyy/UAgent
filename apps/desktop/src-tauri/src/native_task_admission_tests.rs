//! Real SQLite worker/recovery admission and mock transport; no network or real key.
use super::*;
use crate::local_run_store as db;
use crate::runtime_host_service::{RuntimeHostService, OwnerIdentity, ModelJobInput};
use std::{path::PathBuf, time::{Duration, Instant}};

struct Checker;
impl SourceChecker for Checker {
    fn check(&self, snapshot:&SourceSnapshot, _:SourcePhase)->std::result::Result<SourceSnapshot,SourceCheckFailure> {
        Ok(snapshot.clone())
    }
}
struct MockTransport { calls:usize, seen:Vec<u8>, store:PathBuf }
impl Transport for MockTransport {
    fn before_dispatch(&mut self,_:RequestView<'_>)->std::result::Result<(),TransportFailure>{Ok(())}
    fn dispatch(&mut self,request:RequestView<'_>,_:CredentialBytes<'_>,signal:DispatchSignal<'_>,_:&mut ResponseBuffer)
        ->std::result::Result<WriteReceipt,TransportFailure> {
        assert!(!signal.is_cancelled());
        // A separate connection on the original sender proves the worker released its gate.
        let store=db::RunStore::open(&self.store).unwrap();
        assert_eq!(store.run("p","r").unwrap().revision,1);
        self.calls+=1;self.seen=request.body.to_vec();
        Ok(WriteReceipt{write:WriteStatus::Complete})
    }
}
enum AfterRelease { Send, Cancel, ChangeSource }
fn pipeline(after_release:AfterRelease) {
    let base=PathBuf::from(env!("CARGO_MANIFEST_DIR")).ancestors().nth(3).unwrap()
        .join(".local-dev/temp/task-admission-tests")
        .join(format!("{}-{}",std::process::id(),std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
    let project=base.join("project");std::fs::create_dir_all(&project).unwrap();
    let root=Arc::new(TrustedRootHandle::open_from_host_selection(&project).unwrap());
    let store_path=base.join("store");
    let (managed,task)=crate::managed_run_store::task_pipeline_fixture(store_path.clone(),"p","r");
    let document=task.native_document().clone();
    let creation=tauri::async_runtime::block_on(managed.with_store_for_task(task.clone(),"p","r",true,move|store,_,_|{
        store.create_project(&db::Project{id:"p".into(),root:project.to_string_lossy().into_owned(),label:"synthetic".into(),created_at:1})?;
        store.ensure_memory_effect_journal()?;
        store.create_session(&db::Session{project_id:"p".into(),id:"s".into(),title:"synthetic".into(),created_at:1,
            archived:false,parent_id:None,origin:db::Origin::Native})?;
        let creation=store.start_run_for_native_document("p",&db::NewRun{id:"r".into(),session_id:"s".into(),goal:"synthetic".into(),created_at:1},document.clone(),"deepseek","deepseek-flash")?;
        let before=store.run("p","r")?;
        store.commit_checkpoint("p","r",0,&db::CheckpointBatch{status:db::RunStatus::Running,
            checkpoint:db::Checkpoint{next_step_id:None,reason:"synthetic".into(),summary:"synthetic".into(),captured_at:2},
            messages:vec![],steps:vec![],tool_calls:vec![],events:vec![],changesets:vec![],artifacts:vec![]})?;
        let after=store.run("p","r")?;
        store.record_original_native_commit(&document,Some(creation.clone()),&before,&after,"deepseek","deepseek-flash")?;
        Ok(creation)
    })).unwrap();
    let alive=Arc::new(AtomicBool::new(true));
    creation.bind_native_run(task.native_document(),alive.clone(),Instant::now()+Duration::from_secs(60),"deepseek","deepseek-flash").unwrap();
    let session=NativeSession::new(Owner{project:"p".into(),epoch:1,run:"r".into(),conversation:"s".into(),provider:"deepseek".into(),model:"deepseek-flash".into()},
        ConfigVersion{generation:"synthetic".into(),revision:1},[0;32],Arc::new(MonotonicClock::new()));
    session.install_credential(b"synthetic-only".to_vec(),60_000).unwrap();
    let body=br#"{"model":"deepseek-flash","stream":false,"messages":[{"role":"user","content":"synthetic task"}]}"#.to_vec();
    let lease=session.capture_lease(50_000).unwrap();
    let request=Arc::new(session.prepare_chat_completions(&lease,"https://api.deepseek.com",body.clone(),&Checker).unwrap());
    let approval=session.approve(&request,&lease,&Checker).unwrap();
    let host=RuntimeHostService::new().unwrap();let catalog=Arc::new(PersistentRecoveryCatalog::new());
    host.install_recovery_catalog(catalog.clone()).unwrap();let monitor=host.start_monitor().unwrap();
    let identity=OwnerIdentity{scope_id:"synthetic-task".into(),project_id:"p".into(),run_id:"r".into(),conversation_id:"s".into(),
        root_ref:root.identity().observation_key(),provider_id:"deepseek".into(),model_id:"deepseek-flash".into()};
    let owner=host.connect("native-task",identity.clone()).unwrap().owner;
    let execution=host.register_memory_model_pending("native-task",ModelJobInput{owner,job_id:"request".into(),step_id:"model".into(),
        queue_timeout_ms:10000,execution_timeout_ms:10000},root.clone(),&identity,&catalog,creation.clone(),alive.clone()).unwrap();
    let mut transport=MockTransport{calls:0,seen:vec![],store:store_path};
    let (preflight,original_transport)=session.task_preflight(request.clone(),lease.clone(),approval,execution,root,
        creation.clone(),alive.clone(),Arc::new(Checker),&mut transport).unwrap();
    let original_session=session.clone();
    let ready=tauri::async_runtime::block_on(managed.with_native_task_admission(task.clone(),"p","r",move|store,cancelled,deadline|{
        original_session.verify_task_on_store(preflight,store,&MemoryExecution::new(cancelled,deadline),&catalog)
    })).unwrap();
    match after_release {
        AfterRelease::Cancel=>request.cancel().unwrap(),
        AfterRelease::ChangeSource=>session.source_authority().advance([1;32]).unwrap(),
        AfterRelease::Send=>{},
    }
    let result=ready.send(original_transport);
    if matches!(after_release,AfterRelease::Send) {
        assert_eq!(result.error,None);assert_eq!(transport.calls,1);assert_eq!(transport.seen,body);
    } else {assert!(result.error.is_some());assert_eq!(transport.calls,0);}
    assert!(session.approve(&request,&lease,&Checker).is_err());
    creation.invalidate_for_owner(&alive);drop(monitor);
    crate::managed_run_store::stop_memory_pipeline_fixture(&managed);
}
#[test] fn task_pipeline_sends_exact_body_after_worker_release(){pipeline(AfterRelease::Send);}
#[test] fn task_pipeline_cancel_after_release_sends_nothing(){pipeline(AfterRelease::Cancel);}
#[test] fn task_pipeline_changed_source_after_release_sends_nothing(){pipeline(AfterRelease::ChangeSource);}
