//! Explicitly scoped source-batch repair, rooted in the actual native failed build. No model or arbitrary execution.
use super::*;
use crate::{ue_build_profile::PreparedUEBuild,ue_build_repair::*,ue_build_repair_io::hash};

pub(super) struct Continuation {
    cycle:crate::ue_repair_cycle::Cycle,build_cancelled:Arc<AtomicBool>,
    project:String, prepared:String, run:String, document:Arc<NativeStoreWindowGrant>, root:Arc<TrustedRootHandle>,
    plan:Option<PreparedUEBuild>, restart:Option<effect::EffectIntent>, pub(super) session_id:String, diagnostic:Option<String>, expires:Instant,
    settlement:Option<(effect::SettledOperationProof,effect::EffectIntent)>, restore:Option<crate::runtime_host_recovery_catalog::SettledRepairRestore>, restoring:bool,
    session:Option<RepairSession>, snapshot:Option<RepairSnapshot>, preview:Option<NativeRepairPreview>, applied:bool,
}
impl Continuation {
    pub(super) fn from_build(project:String,prepared:String,document:Arc<NativeStoreWindowGrant>,root:Arc<TrustedRootHandle>,plan:PreparedUEBuild,result:&UEBuildExecutionResult,cycle:crate::ue_repair_cycle::Cycle,build_cancelled:Arc<AtomicBool>)->Result<Self,String>{
        Ok(Self{cycle,build_cancelled,project,prepared,run:result.owner.run_id.clone(),document,root,plan:Some(plan),restart:None,session_id:id()?,
            diagnostic:Some(hash(&serde_json::to_vec(result).map_err(|_|"ue_repair_result_encoding")?)),expires:Instant::now()+Duration::from_secs(600),
            settlement:None,restore:None,restoring:false,session:None,snapshot:None,preview:None,applied:false})
    }
    fn current(&self)->bool{!self.build_cancelled.load(Ordering::SeqCst)&&self.document.is_current()&&!self.root.is_revoked()&&Instant::now()<self.expires}
}
pub(super) fn retain(state:&UEBuildExecutionState,c:Continuation){
    if !c.current(){return;}
    let key=c.session_id.clone();
    if let Ok(mut slot)=state.repair.lock(){*slot=Some(c);}else{return;}
    let epoch=state.repair_epoch.fetch_add(1,Ordering::SeqCst)+1;
    let state=state.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_secs(1));
            if state.repair_epoch.load(Ordering::SeqCst)!=epoch{return;}
            let Ok(mut slot)=state.repair.lock() else{return;};
            let Some(c)=slot.as_ref() else{return;};
            if c.session_id!=key{return;}
            if !c.current(){slot.take();return;}
        }
    });
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct Selection {project_id:String,prepared_id:String,run_id:String}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct OpenInput {selection:Selection,#[serde(default)] path:Option<String>,#[serde(default)] paths:Option<Vec<String>>}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct PrepareInput {selection:Selection,session_id:String,snapshot_id:String,#[serde(default)] after:Option<String>,#[serde(default)] files:Option<Vec<ReplacementInput>>}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct ReplacementInput {path:String,after:String}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct ApprovalInput {selection:Selection,session_id:String,digest:String}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct SnapshotReceipt {session_id:String,snapshot:RepairSnapshot}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct ApplyReceipt {receipt:RepairApplyReceipt,persisted:bool,host_settled:bool,history_run_id:String,restore_available:bool,restoration:bool}
fn begin(window:&tauri::WebviewWindow,store:&ManagedRunStoreState,state:&UEBuildExecutionState,s:&Selection)->Result<(Continuation,Arc<Active>),String>{
    let document=store.capture_window_grant(window).map_err(|_|"ue_repair_document_required")?;
    let mut active=state.active.lock().map_err(|_|"ue_repair_unavailable")?;
    if active.is_some(){return Err("ue_build_busy".into());}
    let mut slot=state.repair.lock().map_err(|_|"ue_repair_unavailable")?;
    let c=slot.as_ref().ok_or("ue_repair_failed_build_required")?;
    if !c.current()||!c.document.same_document(&document)||c.project!=s.project_id||c.prepared!=s.prepared_id||c.run!=s.run_id{
        return Err("ue_repair_scope_changed".into());
    }
    let a=Arc::new(Active{project:c.project.clone(),id:c.prepared.clone(),document,cancelled:Arc::new(AtomicBool::new(false)),process:Mutex::new(None)});
    *active=Some(a.clone());Ok((slot.take().unwrap(),a))
}
fn finish(state:&UEBuildExecutionState,active:&Arc<Active>,c:Option<Continuation>){
    // A cancelled original write remains consumed. Only its persisted, settled partial
    // continuation can survive for a NEW restore approval; no old grant is revived.
    if live(active)||c.as_ref().is_some_and(|c|c.settlement.is_some()&&c.current()){
        if let Some(c)=c{retain(state,c);}
    }
    if let Ok(mut slot)=state.active.lock(){if slot.as_ref().is_some_and(|v|Arc::ptr_eq(v,active)){slot.take();}}
}
fn ask(hwnd:isize,text:&str)->bool{
    let text:Vec<u16>=text.encode_utf16().chain(Some(0)).collect();
    let title:Vec<u16>="UAgent - approve exact source operation".encode_utf16().chain(Some(0)).collect();
    unsafe{MessageBoxW(hwnd,text.as_ptr(),title.as_ptr(),0x4|0x30|0x100)==6}
}
#[tauri::command]
pub(crate) async fn open_ue_build_repair(window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>,state:tauri::State<'_,UEBuildExecutionState>,input:OpenInput)->Result<SnapshotReceipt,String>{
    let hwnd=window.hwnd().map_err(|_|"ue_repair_window_unavailable")?.0 as isize;
    let (mut c,active)=begin(&window,&store,&state,&input.selection)?;let a=active.clone();
    let result=tauri::async_runtime::spawn_blocking(move||->Result<_,String>{
        if c.session.is_some(){return Err("ue_repair_scope_already_selected".into());}
        let binding=RepairBinding{host_session_id:c.session_id.clone(),project_id:c.project.clone(),root_object_id:c.root.identity().observation_key(),run_id:c.run.clone(),profile_fingerprint:c.plan.as_ref().ok_or("ue_repair_build_plan_required")?.preview().fingerprint.clone()};
        let diagnostic=RepairDiagnosticRef{diagnostic_id:c.diagnostic.clone().ok_or("ue_repair_build_origin_required")?,build_owner:RepairBuildOwner{run_id:c.run.clone(),step_id:"build".into(),fingerprint:binding.profile_fingerprint.clone()}};
        let paths=match (input.path,input.paths){(Some(path),None)=>vec![path],(None,Some(paths))=>paths,_=>return Err("ue_repair_exact_paths_required".into())};
        let mut session=RepairSession::from_verified_host(c.root.as_ref().clone(),binding,diagnostic,paths.clone())?;
        if !live(&a)||!c.current(){return Err("ue_repair_scope_changed".into());}
        if !ask(hwnd,&format!("Read these existing source files for repair?\nProject: {}\nFailed run: {}\nFiles:\n{}\nNo write or build is approved by this dialog.",c.root.path_hint().display(),c.run,paths.join("\n"))){return Err("ue_repair_declined".into());}
        let _configuration=c.plan.as_ref().map(|plan|plan.revalidate_and_hold()).transpose()?;
        if !live(&a)||!c.current(){return Err("ue_repair_scope_changed".into());}
        let snapshot=session.read_snapshots(&c.session_id)?;
        c.snapshot=Some(snapshot.clone());c.session=Some(session);
        Ok((SnapshotReceipt{session_id:c.session_id.clone(),snapshot},c))
    }).await.map_err(|_|"ue_repair_worker_failed".to_string()).and_then(|v|v);
    match result{Ok((receipt,c))=>{finish(&state,&active,Some(c));Ok(receipt)},Err(e)=>{finish(&state,&active,None);Err(e)}}
}
#[tauri::command]
pub(crate) async fn prepare_ue_build_repair(window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>,state:tauri::State<'_,UEBuildExecutionState>,input:PrepareInput)->Result<NativeRepairPreview,String>{
    let (mut c,active)=begin(&window,&store,&state,&input.selection)?;let a=active.clone();
    let result=tauri::async_runtime::spawn_blocking(move||->Result<_,String>{
        if input.session_id!=c.session_id||c.applied||!live(&a)||!c.current(){return Err("ue_repair_scope_changed".into());}
        let s=c.snapshot.as_ref().ok_or("ue_repair_snapshot_required")?;
        if s.snapshot_id!=input.snapshot_id{return Err("ue_repair_snapshot_changed".into());}
        let replacements=match(input.after,input.files){
            (Some(after),None) if s.files.len()==1=>vec![(s.files[0].path.clone(),after)],
            (None,Some(files))=>files.into_iter().map(|f|(f.path,f.after)).collect(),
            _=>return Err("ue_repair_exact_replacements_required".into())
        };
        let preview=c.session.as_mut().ok_or("ue_repair_session_required")?.prepare_replacements(&c.session_id,&input.snapshot_id,hash(id()?.as_bytes()),replacements)?;
        c.preview=Some(preview.clone());Ok((preview,c))
    }).await.map_err(|_|"ue_repair_worker_failed".to_string()).and_then(|v|v);
    match result{Ok((p,c))=>{finish(&state,&active,Some(c));Ok(p)},Err(e)=>{finish(&state,&active,None);Err(e)}}
}
#[tauri::command]
pub(crate) async fn approve_and_apply_ue_build_repair(app:tauri::AppHandle,window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>,state:tauri::State<'_,UEBuildExecutionState>,input:ApprovalInput)->Result<ApplyReceipt,String>{
    let hwnd=window.hwnd().map_err(|_|"ue_repair_window_unavailable")?.0 as isize;
    let (c,active)=begin(&window,&store,&state,&input.selection)?;
    let result=apply(app,window,&store,c,active.clone(),input,hwnd).await;
    match result{Ok((r,c))=>{let keep=if !c.restoring&&r.host_settled&&(c.applied||r.restore_available){Some(c)}else{None};finish(&state,&active,keep);Ok(r)},Err(e)=>{finish(&state,&active,None);Err(e)}}
}
async fn apply(app:tauri::AppHandle,window:tauri::WebviewWindow,store:&ManagedRunStoreState,c:Continuation,active:Arc<Active>,input:ApprovalInput,hwnd:isize)->Result<(ApplyReceipt,Continuation),String>{
    let a=active.clone();
    let (mut c,p)=tauri::async_runtime::spawn_blocking(move||->Result<_,String>{
        let p=c.preview.as_ref().ok_or("ue_repair_preview_required")?;
        if input.session_id!=c.session_id||input.digest!=p.native_plan_digest||c.applied||!c.current()||!live(&a){return Err("ue_repair_preview_changed".into());}
        let targets=p.preview.files.iter().map(|f|f.path.clone()).collect::<Vec<_>>().join("\n\n");
        if !ask(hwnd,&format!("{} this exact reviewed source batch?\nProject: {}\nFiles:\n{}\nPlan SHA-256: {}\n\nAll before-images are backed up before any write. A partial failure stops the batch; no automatic rollback or build. Declining consumes this repair session.",if c.restoring{"Restore"}else{"Write"},c.root.path_hint().display(),targets,p.native_plan_digest)){return Err("ue_repair_declined".into());}
        if !c.current()||!live(&a){return Err("ue_repair_scope_changed".into());}
        c.plan.as_ref().map(|plan|plan.revalidate_and_hold()).transpose()?;
        let p=p.clone();Ok((c,p))
    }).await.map_err(|_|"ue_repair_worker_failed")??;
    let host=app.state::<host::RuntimeHostService>().inner().clone();let catalog=app.state::<Arc<PersistentRecoveryCatalog>>().inner().clone();
    let run=id()?;let history_run_id=run.clone();let conversation=id()?;let operation=id()?;let label=window.label().to_owned();
    let identity=host::OwnerIdentity{scope_id:c.session_id.clone(),run_id:run.clone(),project_id:c.project.clone(),root_ref:c.root.identity().observation_key(),conversation_id:conversation.clone(),provider_id:if p.preview.task.is_some(){"native-source-change"}else{"native-ue-repair"}.into(),model_id:"none".into()};
    let owner=host.connect(&label,identity.clone()).map_err(str::to_string)?.owner;
    let stopped=Arc::new(AtomicBool::new(false));
    let source_only=p.preview.task.is_some();
    let effect_resources=if let Some(original)=&c.restart {original.resources.clone()}else{
        vec![effect::ResourceClaim{kind:effect::ResourceKind::Ubt,key:format!("engine:{}",c.plan.as_ref().ok_or("ue_repair_build_plan_required")?.preview().profile.engine_root.to_lowercase())},effect::ResourceClaim{kind:effect::ResourceKind::FileWrite,key:identity.root_ref.clone()}]
    };
    let claims=effect_resources.iter().map(|r|host::ResourceClaim{kind:match r.kind{effect::ResourceKind::Ubt=>host::ResourceKind::Ubt,effect::ResourceKind::FileWrite=>host::ResourceKind::FileWrite,effect::ResourceKind::UeEditor=>host::ResourceKind::UeEditor},key:r.key.clone()}).collect();
    let resources=host::NativeResourceBinding::from_verified_root(c.root.clone(),claims).map_err(str::to_string)?;
    let operation_input=host::NativeOperationInput{owner:owner.clone(),job_id:operation.clone(),step_id:"repair".into(),queue_timeout_ms:15000,execution_timeout_ms:15000,resources,observer:Arc::new(Observer(stopped.clone()))};
    let mut registration=if source_only {host.register_source_operation_pending(&label,operation_input,&identity,&catalog)}else{host.register_ue_operation_pending(&label,operation_input,&identity,&catalog)}.map_err(str::to_string)?;
    let ticket=registration.identity().ticket.clone();let native=registration.identity();
    let intent=effect::EffectIntent{key:effect::EffectKey{project_id:c.project.clone(),operation_id:operation.clone()},owner:effect::OperationOwner{scope_id:identity.scope_id.clone(),run_id:run.clone(),project_id:c.project.clone(),root_ref:identity.root_ref.clone(),conversation_id:conversation.clone(),provider_id:identity.provider_id.clone(),model_id:"none".into(),step_id:"repair".into(),execution_id:native.execution_id.clone(),host_generation:native.ticket.host_generation.clone()},root_object_id:identity.root_ref.clone(),adapter:c.restart.as_ref().map(|i|i.adapter.clone()).unwrap_or(effect::AdapterIdentity{id:"native.ue-source-repair.v1".into(),version:1}),idempotency_key:if let Some(original)=&c.restart{hash(format!("restart-restore:{}:{}",original.key.project_id,original.digest().map_err(|_|"ue_restore_intent_invalid")?).as_bytes())}else{format!("{operation}{operation}")},approved_plan_digest:p.native_plan_digest.clone(),plan_summary:if c.restoring{format!("Approved source restoration of run {}",c.run)}else{format!("Approved source-batch repair of failed build {}",c.run)},targets:p.preview.files.iter().map(|f|effect::EffectTarget{kind:effect::TargetKind::File,locator:f.path.clone(),before_digest:Some(f.before_hash.clone()),after_digest:Some(f.after_hash.clone())}).collect(),resources:effect_resources,created_at:now()};
    let a=active.clone();let task_host=host.clone();let task_owner=owner.clone();let task_label=label.clone();let task_catalog=catalog.clone();
    let completed=store.with_store_for_grant(active.document.clone(),true,move|db,cancelled,deadline|{
        let root=c.root.clone();let current=||live(&a)&&c.current()&&!cancelled.load(Ordering::Acquire)&&Instant::now()<deadline;
        if !current(){return Err(error("ue_repair_cancelled"));}
        let _configuration=c.plan.as_ref().map(|plan|plan.revalidate_and_hold()).transpose().map_err(|_|error("ue_repair_configuration_changed"))?;
        db.create_session(&store::Session{project_id:c.project.clone(),id:conversation.clone(),title:"Approved source repair".into(),created_at:now(),archived:false,parent_id:None,origin:store::Origin::Native})?;
        db.start_run(&c.project,&store::NewRun{id:run.clone(),session_id:conversation,goal:intent.plan_summary.clone(),created_at:now()})?;
        let context=effect::CurrentRun::from_verified_host(&root,intent.owner.clone(),&current)?;
        let journal=db.open_effect_journal()?;
        let restart_restore=if let Some(original)=&c.restart {Some(journal.prepare_ended_repair_restore(&context,&intent,&original.key,&p,cancelled,deadline)?)}else{journal.prepare(&context,&intent)?;None};
        let mut dispatch=journal.mark_may_have_been_sent(&context,&intent.key,1,now())?;
        let handoff=if let Some(restore)=restart_restore.as_ref().or(c.restore.as_ref()){
            registration.claim_ue_restore_once(&journal,&context,&mut dispatch,&task_catalog,deadline,restore)?
        }else{registration.claim_ue_once(&journal,&context,&mut dispatch,&task_catalog,deadline)?};
        registration.check_started_ue_operation(&intent).map_err(error)?;
        let host_cancel=registration.cancellation();let grant_active=a.clone();let expiry=c.expires;
        let mut grant=NativeRepairGrant::from_verified_host_approval(&p,15000).map_err(|_|error("ue_repair_grant_failed"))?.with_liveness(Arc::new(move||live(&grant_active)&&Instant::now()<deadline&&Instant::now()<expiry&&!host_cancel.load(Ordering::SeqCst)&&task_host.heartbeat(&task_label,&task_owner).is_ok()));
        let mut backup=crate::ue_build_repair_result::StoreRepairJournal::new(db,&intent);
        let receipt=c.session.as_mut().ok_or_else(||error("ue_repair_session_required"))?.apply_approved(&c.session_id,&p.preview.preview_id,&mut grant,&mut backup,cancelled).map_err(|_|error("ue_repair_apply_unknown"))?;
        stopped.store(true,Ordering::SeqCst);let _=registration.finish(receipt.status=="applied");
        let proof=journal.settle_owned_operation(handoff)?;
        crate::ue_build_repair_result::persist(db,&root,&intent,&p,&receipt,backup.checkpoint_written,&task_catalog,&proof)?;
        c.applied=!c.restoring&&receipt.status=="applied";
        if !c.restoring&&receipt.status=="partial"&&receipt.recovery_record.is_some()
            &&receipt.effects.iter().any(|e|e.status=="applied")
            &&receipt.effects.iter().all(|e|["applied","not_started","conflict"].contains(&e.status.as_str())) {
            c.settlement=Some((proof,intent));
        }
        Ok((receipt,c))
    }).await;
    let settled=host.reconcile(&ticket).map(|j|j.phase==host::JobPhase::Finished).unwrap_or(false);let _=host.disconnect(&label,&owner);
    let (receipt,c)=completed.map_err(|_|"ue_repair_apply_or_persistence_unknown")?;
    Ok((ApplyReceipt{receipt,persisted:true,host_settled:settled,history_run_id,restore_available:settled&&c.settlement.is_some(),restoration:c.restoring},c))
}
/// Only the still-live original partial callback can authorize a reverse transaction.
#[tauri::command]
pub(crate) async fn prepare_ue_build_restore(window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>,state:tauri::State<'_,UEBuildExecutionState>,input:ApprovalInput)->Result<NativeRepairPreview,String>{
    let (mut c,active)=begin(&window,&store,&state,&input.selection)?;let a=active.clone();
    let result=tauri::async_runtime::spawn_blocking(move||->Result<_,String>{
        let original=c.preview.as_ref().ok_or("ue_repair_preview_required")?;
        if input.session_id!=c.session_id||input.digest!=original.native_plan_digest||c.applied||c.restoring||!c.current()||!live(&a){return Err("ue_restore_scope_changed".into());}
        let original_id=original.preview.preview_id.clone();
        let (proof,intent)=c.settlement.take().ok_or("ue_restore_original_settlement_required")?;
        let _configuration=c.plan.as_ref().map(|plan|plan.revalidate_and_hold()).transpose()?;
        let preview=c.session.as_mut().ok_or("ue_repair_session_required")?.prepare_restore(&c.session_id,&original_id,hash(id()?.as_bytes()))?;
        let restore=crate::runtime_host_recovery_catalog::SettledRepairRestore::new(proof,intent,&preview)?;
        if !c.current()||!live(&a){return Err("ue_restore_scope_changed".into());}
        c.restore=Some(restore);c.restoring=true;c.preview=Some(preview.clone());Ok((preview,c))
    }).await.map_err(|_|"ue_repair_worker_failed".to_string()).and_then(|v|v);
    match result{Ok((p,c))=>{finish(&state,&active,Some(c));Ok(p)},Err(e)=>{finish(&state,&active,None);Err(e)}}
}
#[tauri::command]
pub(crate) async fn approve_and_rebuild_ue_build_repair(app:tauri::AppHandle,window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>,state:tauri::State<'_,UEBuildExecutionState>,input:ApprovalInput)->Result<BuildReceipt,String>{
    let hwnd=window.hwnd().map_err(|_|"ue_repair_window_unavailable")?.0 as isize;
    let (c,active)=begin(&window,&store,&state,&input.selection)?;let a=active.clone();
    let prepared=tauri::async_runtime::spawn_blocking(move||->Result<_,String>{
        let p=c.preview.as_ref().ok_or("ue_repair_preview_required")?;
        if input.session_id!=c.session_id||input.digest!=p.native_plan_digest||!c.applied||!c.current()||!live(&a){return Err("ue_repair_verified_apply_required".into());}
        let mut after=c.session.as_ref().ok_or("ue_repair_session_required")?.hold_applied_inputs_for_build(&c.session_id,&p.preview.preview_id)?;
        let _configuration=c.plan.as_ref().map(|plan|plan.revalidate_and_hold()).transpose()?;
        if !confirm(hwnd,c.plan.as_ref().ok_or("ue_repair_build_plan_required")?.preview()){return Err("ue_build_declined".into());}
        if !c.current()||!live(&a){return Err("ue_repair_scope_changed".into());}
        after.check_current()?;drop(_configuration);
        Ok((c,after))
    }).await.map_err(|_|"ue_repair_worker_failed".to_string()).and_then(|v|v);
    let result=match prepared {Ok((c,after))=>{
        let build=BuildInput{project_id:c.project,prepared_id:c.prepared,fingerprint:c.plan.as_ref().ok_or("ue_repair_build_plan_required")?.preview().fingerprint.clone()};
        match c.cycle.next(){Ok(cycle)=>execute_approved(app,window,&store,build,active.clone(),c.root,c.plan.ok_or("ue_repair_build_plan_required")?,Some(after),Some(cycle)).await,Err(e)=>Err(e)}
    },Err(e)=>Err(e)};
    finish(&state,&active,None);result
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct ReleaseInput {selection:Selection,session_id:String}
#[tauri::command]
pub(crate) fn release_ue_build_repair(window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>,state:tauri::State<'_,UEBuildExecutionState>,input:ReleaseInput)->Result<bool,String>{
    let document=store.capture_window_grant(&window).map_err(|_|"ue_repair_document_required")?;
    let _active=state.active.lock().map_err(|_|"ue_repair_unavailable")?;
    let mut slot=state.repair.lock().map_err(|_|"ue_repair_unavailable")?;
    let Some(c)=slot.as_ref() else{return Ok(false);};
    if !c.document.same_document(&document)||c.project!=input.selection.project_id||c.prepared!=input.selection.prepared_id||c.run!=input.selection.run_id||c.session_id!=input.session_id{return Err("ue_repair_scope_changed".into());}
    slot.take();Ok(true)
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct HistoricalRestoreInput {project_id:String,run_id:String,backup_sha256:String}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct HistoricalRestorePreview {selection:serde_json::Value,session_id:String,preview:NativeRepairPreview}
/// Re-trusted project + current document; only builds a reverse preview. Never writes source.
#[tauri::command]
pub(crate) async fn prepare_historical_ue_restore(window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>,state:tauri::State<'_,UEBuildExecutionState>,input:HistoricalRestoreInput)->Result<HistoricalRestorePreview,String>{
 let document=store.capture_window_grant(&window).map_err(|_|"ue_restore_document_required")?;
 let root=crate::resolve_trusted_root_handle_by_id(&input.project_id).map_err(|_|"ue_restore_retrust_required")?;
 let session_id=id()?;let prepared=id()?;let project=input.project_id.clone();let run=input.run_id.clone();
 let active=Arc::new(Active{project:project.clone(),id:prepared.clone(),document:document.clone(),cancelled:Arc::new(AtomicBool::new(false)),process:Mutex::new(None)});
 {let mut slot=state.active.lock().map_err(|_|"ue_restore_unavailable")?;if slot.is_some(){return Err("ue_build_busy".into());}*slot=Some(active.clone());}
 let a=active.clone();let sid=session_id.clone();let pid=prepared.clone();
 let result=store.with_store_for_grant(document.clone(),false,move|db,cancelled,deadline|{
  if !live(&a){return Err(error("ue_restore_cancelled"));}
  let original=db.open_effect_journal()?.ended_repair_record(&input.project_id,&input.run_id)?.intent;
  let backup=db.read_artifact_bounded(&input.project_id,&input.run_id,"nativeRepairBefore",2*1024*1024)?;
  if hash(&backup)!=input.backup_sha256{return Err(error("ue_restore_backup_changed"));}
  let result=db.read_artifact_bounded(&input.project_id,&input.run_id,"nativeRepairResult",2*1024*1024)?;
  let report=crate::ue_repair_recovery::inspect(&root,&input.project_id,&input.run_id,&backup,Some(&result),cancelled,deadline).map_err(|_|error("ue_restore_inspection_failed"))?;
  if report.restore_candidates.is_empty(){return Err(error("ue_restore_no_known_applied_files"));}
  let value:serde_json::Value=serde_json::from_slice(&backup).map_err(|_|error("ue_restore_backup_invalid"))?;
  let old:RepairPreviewInput=serde_json::from_value(value["preview"]["preview"].clone()).map_err(|_|error("ue_restore_backup_invalid"))?;
  let mut binding=old.binding;binding.host_session_id=sid.clone();
  let paths=report.restore_candidates.iter().map(|f|f.path.clone()).collect();
  let mut session=match (original.adapter.id.as_str(),old.diagnostic.clone(),old.task){
   ("native.ue-source-repair.v1",Some(diagnostic),None)=>RepairSession::from_verified_host(root.as_ref().clone(),binding,diagnostic,paths),
   ("native.source-change.v1",None,Some(task))=>RepairSession::from_verified_task(root.as_ref().clone(),binding,task,paths),
   _=>return Err(error("ue_restore_origin_invalid")),
  }.map_err(|_|error("ue_restore_scope_invalid"))?;
  let snapshot=session.read_snapshots(&sid).map_err(|_|error("ue_restore_read_failed"))?;
  let preview=session.prepare_replacements(&sid,&snapshot.snapshot_id,hash(id().map_err(|_|error("ue_restore_id"))?.as_bytes()),report.restore_candidates.into_iter().map(|f|(f.path,f.after)).collect()).map_err(|_|error("ue_restore_preview_changed"))?;
  if !live(&a){return Err(error("ue_restore_cancelled"));}
  let c=Continuation{cycle:crate::ue_repair_cycle::Cycle::initial(&input.run_id),build_cancelled:Arc::new(AtomicBool::new(false)),project:input.project_id,prepared:pid,run:input.run_id,document,root,plan:None,restart:Some(original),session_id:sid,diagnostic:old.diagnostic.map(|d|d.diagnostic_id),expires:Instant::now()+Duration::from_secs(600),settlement:None,restore:None,restoring:true,session:Some(session),snapshot:Some(snapshot),preview:Some(preview.clone()),applied:false};
  Ok((preview,c))
 }).await.map_err(|_|"ue_restore_unavailable".to_string());
 match result {Ok((preview,c))=>{finish(&state,&active,Some(c));Ok(HistoricalRestorePreview{selection:serde_json::json!({"projectId":project,"preparedId":prepared,"runId":run}),session_id,preview})},Err(e)=>{finish(&state,&active,None);Err(e)}}
}
