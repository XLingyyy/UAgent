//! Explicit native single-build approval. No renderer command line or project path.
use crate::{managed_run_store::{ManagedRunStoreState,NativeStoreWindowGrant},
    runtime_host_service as host, runtime_host_recovery_catalog::PersistentRecoveryCatalog,
    ue_build_preview_commands::{UEBuildPreviewState,take_for_build},
    ue_build_process::{UEBuildCancellation,UEBuildOwner,UEBuildExecutionResult,execute_ue_build},
    local_run_store::{self as store, effect_reconciliation as effect}, trusted_root_handle::TrustedRootHandle};
use serde::{Deserialize,Serialize};
use std::sync::{Arc,Mutex,atomic::{AtomicBool,Ordering}};
use std::time::{Instant,Duration,SystemTime,UNIX_EPOCH};
use tauri::Manager;

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct BuildInput{project_id:String,prepared_id:String,fingerprint:String}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct CancelInput{project_id:String,prepared_id:String}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct BuildReceipt{schema_version:u32,project_id:String,prepared_id:String,run_id:String,
    result:UEBuildExecutionResult,persisted:bool,host_settled:bool,repair_available:bool,repair_session_id:Option<String>,repair_cycle:crate::ue_repair_cycle::CycleReport}
struct Active{project:String,id:String,document:Arc<NativeStoreWindowGrant>,cancelled:Arc<AtomicBool>,
    process:Mutex<Option<(UEBuildCancellation,UEBuildOwner)>>}
#[derive(Clone,Default)]
pub(crate) struct UEBuildExecutionState{active:Arc<Mutex<Option<Arc<Active>>>>,repair:Arc<Mutex<Option<repair_commands::Continuation>>>,repair_epoch:Arc<std::sync::atomic::AtomicU64>}
fn error(code:&str)->store::StoreError{store::StoreError{kind:code.into(),message:"native approved build could not complete this stage".into()}}
fn id()->Result<String,String>{let mut b=[0u8;16];getrandom::getrandom(&mut b).map_err(|_|"ue_build_random_unavailable")?;Ok(b.iter().map(|v|format!("{v:02x}")).collect())}
fn now()->i64{SystemTime::now().duration_since(UNIX_EPOCH).map(|v|v.as_millis() as i64).unwrap_or(0)}
fn live(active:&Active)->bool{active.document.is_current()&&!active.cancelled.load(Ordering::SeqCst)}
struct Observer(Arc<AtomicBool>);
impl host::ReadOnlyExecutionObserver for Observer{
    fn observe(&self,_:&host::NativeExecutionIdentity,_:Instant)->host::ExecutionObservation{
        if self.0.load(Ordering::SeqCst){host::ExecutionObservation::Quiescent}else{host::ExecutionObservation::Unknown}
    }
}
#[link(name="user32")]
extern "system"{fn MessageBoxW(window:isize,text:*const u16,title:*const u16,flags:u32)->i32;}
fn confirm(window:isize,preview:&crate::ue_build_profile::UEBuildPreview)->bool{
    let text=format!("Run exactly ONE native build?\nProject: {}\nTarget: {} / Win64 / Development\nProgram: {}\nArguments: {:?}\nWorking directory: {}\nSHA-256: {}\n\nThis executes project build logic and writes build artifacts. No automatic repair or retry. Closing or cancelling requests termination of the owned process tree.",
        preview.project_root,preview.profile.target,preview.program,preview.arguments,preview.cwd,preview.fingerprint);
    let text:Vec<u16>=text.encode_utf16().chain(Some(0)).collect();let title:Vec<u16>="UAgent - approve one build".encode_utf16().chain(Some(0)).collect();
    // YES/NO, warning, default NO. Only this native result approves this exact moved plan.
    unsafe{MessageBoxW(window,text.as_ptr(),title.as_ptr(),0x4|0x30|0x100)==6}
}
#[tauri::command]
pub(crate) fn cancel_approved_ue_build(window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>,
    state:tauri::State<'_,UEBuildExecutionState>,input:CancelInput)->Result<bool,String>{
    let document=store.capture_window_grant(&window).map_err(|_|"ue_build_document_required")?;
    let active=state.active.lock().map_err(|_|"ue_build_unavailable")?.clone().ok_or("ue_build_unknown")?;
    if active.project!=input.project_id||active.id!=input.prepared_id||!active.document.same_document(&document){return Err("ue_build_document_mismatch".into());}
    active.cancelled.store(true,Ordering::SeqCst);
    if let Some((cancel,owner))=&*active.process.lock().map_err(|_|"ue_build_unavailable")?{cancel.cancel(owner)?;}
    Ok(true)
}
#[tauri::command]
pub(crate) async fn approve_and_run_ue_build(app:tauri::AppHandle,window:tauri::WebviewWindow,
    store:tauri::State<'_,ManagedRunStoreState>,previews:tauri::State<'_,UEBuildPreviewState>,
    state:tauri::State<'_,UEBuildExecutionState>,input:BuildInput)->Result<BuildReceipt,String>{
    let document=store.capture_window_grant(&window).map_err(|_|"ue_build_document_required")?;
    let active=Arc::new(Active{project:input.project_id.clone(),id:input.prepared_id.clone(),document:document.clone(),
        cancelled:Arc::new(AtomicBool::new(false)),process:Mutex::new(None)});
    {let mut slot=state.active.lock().map_err(|_|"ue_build_unavailable")?;if slot.is_some(){return Err("ue_build_busy".into());}*slot=Some(active.clone());}
    state.repair.lock().map_err(|_|"ue_repair_unavailable")?.take();
    let result=run(app,window,&store,&previews,input,active.clone()).await;
    // Only actual native completion clears the slot. Dropped async work cannot claim settlement.
    if let Ok(mut slot)=state.active.lock(){if slot.as_ref().is_some_and(|v|Arc::ptr_eq(v,&active)){slot.take();}}
    result
}
async fn run(app:tauri::AppHandle,window:tauri::WebviewWindow,store:&ManagedRunStoreState,previews:&UEBuildPreviewState,
    input:BuildInput,active:Arc<Active>)->Result<BuildReceipt,String>{
    let (root,plan,expires)=take_for_build(previews,&input.project_id,&input.prepared_id,&input.fingerprint,&active.document)?;
    let hwnd=window.hwnd().map_err(|_|"ue_build_window_unavailable")?.0 as isize;
    let approved=active.clone();
    let (root,plan)=tauri::async_runtime::spawn_blocking(move||{
        if !live(&approved)||Instant::now()>=expires{return Err("ue_build_approval_expired".to_string());}
        root.check_current().map_err(|_|"ue_build_root_changed")?;
        let _checked=plan.revalidate_and_hold()?;
        if !confirm(hwnd,plan.preview()){return Err("ue_build_declined".into());}
        if !live(&approved)||Instant::now()>=expires{return Err("ue_build_approval_expired".into());}
        drop(_checked);
        Ok((root,plan))
    }).await.map_err(|_|"ue_build_approval_worker_failed")??;
    execute_approved(app,window,store,input,active,root,plan,None,None).await
}
async fn execute_approved(app:tauri::AppHandle,window:tauri::WebviewWindow,store:&ManagedRunStoreState,
    input:BuildInput,active:Arc<Active>,root:Arc<TrustedRootHandle>,plan:crate::ue_build_profile::PreparedUEBuild,
    after:Option<crate::ue_build_repair::RepairBuildInputs>,cycle:Option<crate::ue_repair_cycle::Cycle>)->Result<BuildReceipt,String>{
    let host=app.state::<host::RuntimeHostService>().inner().clone();
    let catalog=app.state::<Arc<PersistentRecoveryCatalog>>().inner().clone();
    let run_id=id()?;let session_id=id()?;let operation=id()?;
    let mut cycle=cycle.unwrap_or_else(||crate::ue_repair_cycle::Cycle::initial(&run_id));
    let identity=host::OwnerIdentity{scope_id:input.prepared_id.clone(),run_id:run_id.clone(),project_id:input.project_id.clone(),
        root_ref:root.identity().observation_key(),conversation_id:session_id.clone(),provider_id:"native-ue-build".into(),model_id:"none".into()};
    let label=window.label().to_owned();let owner=host.connect(&label,identity.clone()).map_err(str::to_string)?.owner;
    let settled=Arc::new(AtomicBool::new(false));
    let resources=host::NativeResourceBinding::from_verified_root(root.clone(),vec![
        host::ResourceClaim{kind:host::ResourceKind::Ubt,key:format!("engine:{}",plan.preview().profile.engine_root.to_lowercase())},
        host::ResourceClaim{kind:host::ResourceKind::FileWrite,key:root.identity().observation_key()}]).map_err(str::to_string)?;
    let mut registration=host.register_ue_operation_pending(&label,host::NativeOperationInput{owner:owner.clone(),job_id:operation.clone(),step_id:"build".into(),
        queue_timeout_ms:600000,execution_timeout_ms:600000,resources,observer:Arc::new(Observer(settled.clone()))},&identity,&catalog).map_err(str::to_string)?;
    let ticket=registration.identity().ticket.clone();let native=registration.identity().clone();
    let intent=effect::EffectIntent{key:effect::EffectKey{project_id:input.project_id.clone(),operation_id:operation.clone()},
        owner:effect::OperationOwner{scope_id:identity.scope_id.clone(),run_id:run_id.clone(),project_id:input.project_id.clone(),root_ref:identity.root_ref.clone(),
            conversation_id:session_id.clone(),provider_id:identity.provider_id.clone(),model_id:identity.model_id.clone(),step_id:native.step_id.clone(),
            execution_id:native.execution_id.clone(),host_generation:native.ticket.host_generation.clone()},root_object_id:root.identity().observation_key(),
        adapter:effect::AdapterIdentity{id:"native.ue-build.v1".into(),version:1},idempotency_key:format!("{}{}",operation,operation),
        approved_plan_digest:input.fingerprint.clone(),plan_summary:format!("Build {} Win64 Development",plan.preview().profile.target),
        targets:vec![effect::EffectTarget{kind:effect::TargetKind::NativeReceipt,locator:operation.clone(),before_digest:None,after_digest:None}],
        resources:vec![effect::ResourceClaim{kind:effect::ResourceKind::Ubt,key:format!("engine:{}",plan.preview().profile.engine_root.to_lowercase())},
            effect::ResourceClaim{kind:effect::ResourceKind::FileWrite,key:root.identity().observation_key()}],created_at:now()};
    let original_root=root.clone();let original_active=active.clone();let original_intent=intent.clone();let admission_catalog=catalog.clone();
    let project=input.project_id.clone();let run_copy=run_id.clone();let session_copy=session_id.clone();
    // This callback does NO process work: it persists and claims the short handoff,
    // returning the original registration only after the managed owner releases SQL.
    let pending=store.with_store_for_grant(active.document.clone(),true,move|db,cancelled,deadline|{
        if !live(&original_active)||cancelled.load(Ordering::Acquire){return Err(error("ue_build_cancelled"));}
        original_root.check_current().map_err(|_|error("ue_build_root_changed"))?;
        let path=original_root.path_hint().to_string_lossy().into_owned();
        if let Some(existing)=db.projects()?.into_iter().find(|p|p.id==project){
            let saved=std::fs::canonicalize(&existing.root).map_err(|_|error("ue_build_project_changed"))?;
            let selected=std::fs::canonicalize(original_root.path_hint()).map_err(|_|error("ue_build_project_changed"))?;
            if saved!=selected{return Err(error("ue_build_project_changed"));}
        }else{db.create_project(&store::Project{id:project.clone(),root:path,label:"UE build".into(),created_at:now()})?;}
        db.create_session(&store::Session{project_id:project.clone(),id:session_copy.clone(),title:"Approved UE build".into(),created_at:now(),archived:false,parent_id:None,origin:store::Origin::Native})?;
        db.start_run(&project,&store::NewRun{id:run_copy,session_id:session_copy,goal:original_intent.plan_summary.clone(),created_at:now()})?;
        let current=||live(&original_active)&&!cancelled.load(Ordering::Acquire)&&Instant::now()<deadline;
        let context=effect::CurrentRun::from_verified_host(&original_root,original_intent.owner.clone(),&current)?;
        let journal=db.open_effect_journal()?;journal.prepare(&context,&original_intent)?;
        let mut dispatch=journal.mark_may_have_been_sent(&context,&original_intent.key,1,now())?;
        let handoff=registration.claim_ue_once(&journal,&context,&mut dispatch,&admission_catalog,deadline)?;
        Ok((registration,handoff))
    }).await.map_err(|_|"ue_build_admission_or_storage_failed")?;
    let (pending,handoff)=pending;
    let active_process=active.clone();let process_root=root.clone();let worker_host=host.clone();let worker_owner=owner.clone();let worker_label=label.clone();
    let process_owner=UEBuildOwner{run_id:run_id.clone(),step_id:"build".into(),fingerprint:input.fingerprint.clone()};
    let host_cancel=pending.cancellation();
    let cancel=UEBuildCancellation::with_liveness(process_owner.clone(),Arc::new(move||{
        live(&active_process)&&!process_root.is_revoked()&&!host_cancel.load(Ordering::SeqCst)
            &&worker_host.heartbeat(&worker_label,&worker_owner).is_ok()
    }));
    *active.process.lock().map_err(|_|"ue_build_unavailable")?=Some((cancel.clone(),process_owner.clone()));
    let check_intent=intent.clone();let process_active=active.clone();
    let (result,plan)=tauri::async_runtime::spawn_blocking(move||{
        let registration=pending;
        let mut after=after;
        if after.as_mut().is_some_and(|guard|guard.check_current().is_err()){let _=cancel.cancel(&process_owner);}
        // Original plan is rehashed and pinned inside execute_ue_build; no JSON plan is used.
        if !live(&process_active)||registration.check_started_ue_operation(&check_intent).is_err(){let _=cancel.cancel(&process_owner);}
        let result=execute_ue_build(&plan,process_owner,&cancel);
        settled.store(result.tree_stopped,Ordering::SeqCst);
        let succeeded=result.status=="succeeded"&&result.exit_code==Some(0)&&result.tree_stopped&&result.output_complete;
        let _=registration.finish(succeeded);
        (result,plan)
    }).await.map_err(|_|"ue_build_worker_unsettled")?;
    let host_settled=host.reconcile(&ticket).map(|j|j.phase==host::JobPhase::Finished).unwrap_or(false);
    let _=host.disconnect(&label,&owner);
    let mut repair_cycle=cycle.observe(&run_id,crate::ue_repair_cycle::Observation{status:&result.status,exit_code:result.exit_code,tree_stopped:result.tree_stopped,complete:result.output_complete,truncated:result.output_truncated,stdout:&result.stdout,stderr:&result.stderr,current_settled:host_settled&&live(&active)});
    let persisted=store.complete_native_ue_build(NativeBuildCompletion{
        handoff,root:root.clone(),intent:intent.clone(),result:result.clone(),cycle:repair_cycle.clone(),catalog
    }).await.is_ok();
    if !persisted||!live(&active) {repair_cycle.status="unconfirmed".into();}
    let repair_available=persisted&&repair_cycle.status=="awaiting_review";
    let mut repair_session_id=None;
    if repair_available {
        let continuation=repair_commands::Continuation::from_build(
            input.project_id.clone(),input.prepared_id.clone(),active.document.clone(),root,plan,&result,cycle,active.cancelled.clone())?;
        repair_session_id=Some(continuation.session_id.clone());
        repair_commands::retain(app.state::<UEBuildExecutionState>().inner(),continuation);
    }
    Ok(BuildReceipt{schema_version:1,project_id:input.project_id,prepared_id:input.prepared_id,run_id,result,persisted,host_settled,repair_available,repair_session_id,repair_cycle})
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn renderer_cannot_supply_shell_arguments_or_path(){
        let base=serde_json::json!({"projectId":"root:abc","preparedId":"a".repeat(32),"fingerprint":"b".repeat(64)});
        for key in ["arguments","projectRoot","program","approved"]{
            let mut value=base.clone();value[key]=serde_json::json!("untrusted");assert!(serde_json::from_value::<BuildInput>(value).is_err());
        }
        assert!(serde_json::from_value::<BuildInput>(base).is_ok());
    }
}

/// Only this native executor completion constructs this move-only value. No IPC
/// accepts it and no expired document or saved receipt can reconstruct its claim.
pub(crate) struct NativeBuildCompletion {
    handoff:effect::OwnedOperationHandoff,root:Arc<TrustedRootHandle>,intent:effect::EffectIntent,result:UEBuildExecutionResult,cycle:crate::ue_repair_cycle::CycleReport,catalog:Arc<PersistentRecoveryCatalog>,
}
impl NativeBuildCompletion {
    pub(crate) fn persist(self,db:&store::RunStore)->store::Result<()> {
        let proof=db.open_effect_journal()?.settle_owned_operation(self.handoff)?;
        crate::ue_build_result::persist_result_with_cycle(db,&self.intent.key.project_id,&self.intent.owner.run_id,&self.root,&self.intent,&self.result,Some((&self.catalog,&proof)),Some(&self.cycle))
    }
}

#[path="ue_build_repair_commands.rs"]
pub(crate) mod repair_commands;



