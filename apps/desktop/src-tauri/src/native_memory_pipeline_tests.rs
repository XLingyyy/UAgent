//! Real preflight/SQLite/release/permit with a synthetic native document and mock transport.
//! No Webview, MessageBox, HTTP, real secret or deletion. Not UI authorization acceptance.
use super::*;
use crate::native_provider_transport as transport;
use crate::local_run_store as db;
use crate::local_run_store::project_memory::*;
use crate::runtime_host_service::{RuntimeHostService,OwnerIdentity,ModelJobInput};
use crate::runtime_host_recovery_catalog::PersistentRecoveryCatalog;
use std::time::{Instant,Duration};
struct Checker;
impl transport::SourceChecker for Checker {
    fn check(&self,s:&transport::SourceSnapshot,_:transport::SourcePhase)->std::result::Result<transport::SourceSnapshot,transport::SourceCheckFailure>{Ok(s.clone())}
}
struct MockTransport { seen:Vec<u8>, calls:usize, store:PathBuf, project:String, source:PathBuf }
impl transport::Transport for MockTransport {
    fn before_dispatch(&mut self,_:transport::RequestView<'_>)->std::result::Result<(),transport::TransportFailure>{Ok(())}
    fn dispatch(&mut self,request:transport::RequestView<'_>,_:transport::CredentialBytes<'_>,signal:transport::DispatchSignal<'_>,_:&mut transport::ResponseBuffer)->std::result::Result<transport::WriteReceipt,transport::TransportFailure>{
        assert!(!signal.is_cancelled());
        assert!(std::fs::OpenOptions::new().write(true).open(&self.source).is_err());
        // Opening on the ORIGINAL sender thread proves worker connection/gate release.
        let store=db::RunStore::open(&self.store).unwrap();
        let flag=AtomicBool::new(false);let execution=MemoryExecution::new(&flag,Instant::now()+Duration::from_secs(2));
        let record=store.project_memory(&execution,&self.project,"memory").unwrap();
        assert_eq!(record.revision,2);
        store.update_project_memory(&execution,&self.project,"memory",2,MemoryMutation::Retire,3).unwrap();
        self.seen=request.body.to_vec();self.calls+=1;
        Ok(transport::WriteReceipt{write:transport::WriteStatus::Complete})
    }
}
fn run_pipeline(cancel:bool) {
    let mut fixture=Fixture::new();
    let config=fixture.config();let snapshot=fixture.save(&config);
    let window=format!("memory-pipeline-{}",token().unwrap());
    let profile=fixture.profile(&snapshot,&window,false);
    let project_dir=fixture.root.join("SyntheticProject");std::fs::create_dir_all(&project_dir).unwrap();
    std::fs::write(project_dir.join("Synthetic.uproject"),b"{\"FileVersion\":3}").unwrap();
    std::fs::create_dir_all(project_dir.join("Source")).unwrap();
    std::fs::write(project_dir.join("Source/Fact.cpp"),b"// synthetic source\n").unwrap();
    let trusted=crate::trust_native_project_root(crate::TrustRootInput{root_ref:project_dir.to_string_lossy().into_owned()}).unwrap();
    let project=trusted.root_id;
    let store_path=fixture.root.join("memory-store");
    let (managed,document)=crate::managed_run_store::memory_pipeline_fixture(store_path.clone());
    let grant=scope_authority::memory_pipeline_fixture(profile.clone(),document.clone(),&project);
    let doc=document.native_document().clone();let pid=project.clone();let provider=config.provider_id.clone();
    let project_text=project_dir.to_string_lossy().into_owned();
    let file=grant.root_handle().scope_from_verified_host(vec![crate::trusted_root_handle::ReadRule::exact_file("Source/Fact.cpp").unwrap()]).unwrap().open_file("Source/Fact.cpp").unwrap();
    let version=crate::project_source_versions::bound_file_metadata_version(&file).unwrap();
    drop(file);
    let fact_source=MemorySource{project_id:project.clone(),path:"Source/Fact.cpp".into(),kind:"file_preview".into(),version:version.clone(),freshness:Some(version)};
    let creation=tauri::async_runtime::block_on(managed.with_store_for_grant(document.clone(),true,move|store,cancelled,deadline|{
        store.create_project(&db::Project{id:pid.clone(),root:project_text,label:"Synthetic memory pipeline".into(),created_at:1})?;
        store.ensure_memory_effect_journal()?;
        store.create_session(&db::Session{project_id:pid.clone(),id:"memory-pipeline-session".into(),title:"synthetic".into(),created_at:1,archived:false,parent_id:None,origin:db::Origin::Native})?;
        let creation=store.start_run_for_native_document(&pid,&db::NewRun{id:"memory-pipeline-run".into(),session_id:"memory-pipeline-session".into(),goal:"synthetic".into(),created_at:1},doc.clone(),&provider,"fixture-model")?;
        let before=store.run(&pid,"memory-pipeline-run")?;
        store.commit_checkpoint(&pid,"memory-pipeline-run",0,&db::CheckpointBatch{status:db::RunStatus::Running,
            checkpoint:db::Checkpoint{next_step_id:None,reason:"synthetic".into(),summary:"synthetic".into(),captured_at:2},messages:vec![],steps:vec![],tool_calls:vec![],events:vec![],changesets:vec![],artifacts:vec![]})?;
        let after=store.run(&pid,"memory-pipeline-run")?;
        store.record_original_native_commit(&doc,Some(creation.clone()),&before,&after,&provider,"fixture-model")?;
        let execution=MemoryExecution::new(cancelled,deadline);
        store.create_project_memory(&execution,&pid,"memory",MemoryContent{kind:"fact".into(),body:"SYNTHETIC APPROVED MEMORY".into(),source_refs:vec![fact_source],share_paths:vec![String::new()],priority:"normal".into(),visibility:"project".into(),origin:MemoryOrigin{kind:"user".into(),session_id:None,message_id:None},read_at:1})?;
        store.update_project_memory(&execution,&pid,"memory",1,MemoryMutation::Confirm,2)?;
        Ok(creation)
    })).unwrap();
    let owner=ContinuationOwner{project_id:project.clone(),project_epoch:1,run_id:"memory-pipeline-run".into(),conversation_id:"memory-pipeline-session".into(),provider_id:config.provider_id.clone(),model_id:"fixture-model".into()};
    let continuation=ContinuationScope{owner:owner.clone(),provider_generation:snapshot.generation.clone(),provider_revision:snapshot.revision,configuration_fingerprint:fingerprint(&snapshot,"fixture-model").unwrap()};
    let session=NativeSession::new(Owner{project:project.clone(),epoch:1,run:owner.run_id.clone(),conversation:owner.conversation_id.clone(),provider:owner.provider_id.clone(),model:owner.model_id.clone()},ConfigVersion{generation:snapshot.generation.clone(),revision:snapshot.revision as u64},[0;32],profile.clock.clone());
    session.install_credential(b"synthetic-only".to_vec(),60_000).unwrap();
    let run=Arc::new(Run{profile,scope:continuation,session:session.clone(),project_registration:Some(capture_project_registration(&project).unwrap()),memory_scope:Some(grant.clone()),native_host:None,native_creation:Some(creation.clone()),memory_admitted:AtomicBool::new(false),monitor:None,checker:Arc::new(Checker),chat:None,deadline:60_000,fixture_sequence:None,alive:Arc::new(AtomicBool::new(true))});
    let handle=token().unwrap();lock(broker()).unwrap().runs.insert(handle.clone(),run.clone());
    creation.bind_native_run(document.native_document(),run.alive.clone(),Instant::now()+Duration::from_secs(60),&owner.provider_id,&owner.model_id).unwrap();
    grant.attach_native_run(&run).unwrap();
    let pid=project.clone();
    let rows=tauri::async_runtime::block_on(managed.with_store_for_grant(document.clone(),false,move|store,cancelled,deadline|{
        let execution=MemoryExecution::new(cancelled,deadline);let paths=vec![String::new()];
        store.project_memory_dispatch_snapshot(&execution,&MemoryDispatchScope{project_id:&pid,read_prefixes:&paths,share_prefixes:&paths,max_context_bytes:24576},&[MemoryDispatchSelection{id:"memory",revision:2}])
    })).unwrap();
    let batch=MemoryBatch::capture(grant.clone(),rows).unwrap();
    let receipt=serde_json::to_value(batch.receipt()).unwrap();
    let body=json!({"model":"fixture-model","store":false,"input":[
        {"type":"message","role":"system","content":[{"type":"input_text","text":"Synthetic system"}]},
        {"type":"message","role":"developer","content":[{"type":"input_text","text":"Synthetic scope"}]},
        {"type":"message","role":"user","content":[{"type":"input_text","text":receipt["message"]["content"]}]}
    ]}).to_string().into_bytes();
    let lease=session.capture_lease(50_000).unwrap();
    let mut request=session.prepare(&lease,"https://api.openai.com/v1",body.clone(),&Checker).unwrap();
    request.attach_memory(batch.bind_responses(request.body_arc().clone()).unwrap()).unwrap();
    let request=Arc::new(request);let approval=session.approve(&request,&lease,&Checker).unwrap();
    let host=RuntimeHostService::new().unwrap();let catalog=Arc::new(PersistentRecoveryCatalog::new());host.install_recovery_catalog(catalog.clone()).unwrap();let monitor=host.start_monitor().unwrap();
    let identity=OwnerIdentity{scope_id:"synthetic-memory-scope".into(),run_id:owner.run_id.clone(),project_id:project.clone(),root_ref:grant.root_handle().identity().observation_key(),conversation_id:owner.conversation_id.clone(),provider_id:owner.provider_id.clone(),model_id:owner.model_id.clone()};
    let host_owner=host.connect(&window,identity.clone()).unwrap().owner;
    let execution=host.register_memory_model_pending(&window,ModelJobInput{owner:host_owner,job_id:"request".into(),step_id:"model".into(),queue_timeout_ms:10000,execution_timeout_ms:10000},grant.root_handle().clone(),&identity,&catalog,creation,run.alive.clone()).unwrap();
    let mut transport=MockTransport{seen:vec![],calls:0,store:store_path,project,source:project_dir.join("Source/Fact.cpp")};
    let (preflight,original_transport)=session.memory_preflight(request.clone(),lease.clone(),approval,execution,&Checker,&mut transport).unwrap();
    let original_session=session.clone();
    let ready=tauri::async_runtime::block_on(managed.with_native_memory_admission_for_grant(document,move|store,cancelled,deadline|{
        let execution=MemoryExecution::new(cancelled,deadline);
        original_session.verify_memory_on_store(preflight,store,&execution,&catalog)
    })).unwrap();
    if cancel {request.cancel().unwrap();}
    let result=ready.send(original_transport);
    if cancel {assert!(result.error.is_some());assert_eq!(transport.calls,0);} else {assert!(result.error.is_none());assert_eq!(transport.calls,1);assert_eq!(transport.seen,body);}
    // Reapproval does not reset request progress or recover the consumed permit.
    assert!(session.approve(&request,&lease,&Checker).is_err());
    run.revoke();lock(broker()).unwrap().runs.remove(&handle);drop(monitor);
    crate::managed_run_store::stop_memory_pipeline_fixture(&managed);
}
#[test] fn native_memory_positive_pipeline_sends_exact_approved_snapshot(){run_pipeline(false);}
#[test] fn native_memory_positive_pipeline_cancellation_after_store_release_sends_nothing(){run_pipeline(true);}
