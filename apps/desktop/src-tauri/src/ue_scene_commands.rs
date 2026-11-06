//! Native exact-plan approval. Writing a startup grant is not an asset creation result.
use serde::{Deserialize,Serialize};
use std::sync::{Arc,Mutex,OnceLock};
use crate::managed_run_store::NativeStoreWindowGrant;
use crate::ue_scene_launch::{PreparedSceneLaunch,validate_directories,write_approved_launch};
use crate::ue_scene_batch::SceneBatchPlan;
struct SceneEditor {process_id:String,session:crate::ue_editor_process::EditorObservationSessionResult,_approval_pin:crate::ue_build_repair_io::IdentityPin}
impl Drop for SceneEditor{fn drop(&mut self){crate::ue_editor_process::stop_scene_owned_editor(&self.process_id);}}
struct Record { execution:Option<crate::ue_scene_execution::Execution>, editor:Option<SceneEditor>,project_id:String,launch:PreparedSceneLaunch, document:Arc<NativeStoreWindowGrant> }
struct Starting{project_id:String,operation_id:String,document:Arc<NativeStoreWindowGrant>,cancelled:Arc<std::sync::atomic::AtomicBool>}
static STARTING:OnceLock<Mutex<Option<Starting>>>=OnceLock::new();
struct StartGuard(Arc<std::sync::atomic::AtomicBool>);
impl Drop for StartGuard{fn drop(&mut self){if let Some(registry)=STARTING.get(){if let Ok(mut value)=registry.lock(){if value.as_ref().is_some_and(|s|Arc::ptr_eq(&s.cancelled,&self.0)){value.take();}}}}}
static WRITING:std::sync::atomic::AtomicBool=std::sync::atomic::AtomicBool::new(false);
struct Writing;
impl Drop for Writing{fn drop(&mut self){WRITING.store(false,std::sync::atomic::Ordering::Release);}}
static PENDING:OnceLock<Mutex<Option<Record>>>=OnceLock::new();
/// Reuses the existing native UE preview lifecycle monitor; no filesystem operations.
pub(crate) fn reap_stale(){
 let retired=if let Some(registry)=PENDING.get(){if let Ok(mut slot)=registry.try_lock(){
  if slot.as_ref().is_some_and(|v|!v.document.is_current()||v.launch.root.is_revoked()||v.launch.expires<=std::time::Instant::now()){slot.take()}else{None}
 }else{None}}else{None};drop(retired);
}
pub(crate) fn shutdown(){if let Some(registry)=STARTING.get(){if let Ok(active)=registry.lock(){if let Some(active)=active.as_ref(){active.cancelled.store(true,std::sync::atomic::Ordering::Release);}}}if let Some(registry)=PENDING.get(){if let Ok(mut slot)=registry.lock(){let retired=slot.take();drop(slot);drop(retired);}}}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct LaunchPlanInput { project_id:String, project_file:String, plan:SceneBatchPlan }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct LaunchPlanReceipt {schema_version:u32,project_id:String,operation_id:String,status:&'static str,approval_file_created:bool,editor_started:bool,asset_created:bool}
#[link(name="user32")]
extern "system" {fn MessageBoxW(window:isize,text:*const u16,title:*const u16,flags:u32)->i32;}
fn confirm(hwnd:isize,root:&str,project:&crate::ue_semantic_launch::Prepared,plan:&SceneBatchPlan)->bool{
 let message=format!("Approve writing a NEW map in this selected project?\nProject: {root}\nDescriptor: {}\nDescriptor SHA256: {}\n{}\n\nCreates Saved/UAgentSceneT14/host-approved-plans.json only if absent. The reviewed 1–20 static objects in ONE new ordinary map. No existing map overwrite. Editor startup, world preparation/execution, resume and save still require their own native confirmations. This step does not start an editor or create a map.",project.project_file,project.hash,serde_json::to_string_pretty(plan).unwrap());
 let message:Vec<u16>=message.encode_utf16().chain(Some(0)).collect();let title:Vec<u16>="UAgent - approve scene startup plan".encode_utf16().chain(Some(0)).collect();
 unsafe{MessageBoxW(hwnd,message.as_ptr(),title.as_ptr(),0x4|0x30|0x100)==6}
}
#[tauri::command]
pub(crate) async fn approve_ue_scene_launch_plan(window:tauri::WebviewWindow,store:tauri::State<'_,crate::managed_run_store::ManagedRunStoreState>,lifecycle:tauri::State<'_,crate::ue_build_preview_commands::UEBuildPreviewState>,input:LaunchPlanInput)->Result<LaunchPlanReceipt,String>{
 lifecycle.ensure_lifecycle_monitor()?;
 let lifecycle=lifecycle.inner().clone();
 input.plan.validate()?;
 let document=store.capture_window_grant(&window).map_err(|_|"scene_document_required")?;
 let root=crate::resolve_trusted_root_handle_by_id(&input.project_id).map_err(|_|"scene_trusted_root_required")?;
 WRITING.compare_exchange(false,true,std::sync::atomic::Ordering::AcqRel,std::sync::atomic::Ordering::Acquire).map_err(|_|"scene_plan_busy")?;
 let writing=Writing;
 let hwnd=window.hwnd().map_err(|_|"scene_window_required")?.0 as isize;
 tauri::async_runtime::spawn_blocking(move||{
  let _writing=writing;
  {let mut pending=PENDING.get_or_init(||Mutex::new(None)).lock().map_err(|_|"scene_plan_unavailable")?;
  if pending.as_ref().is_some_and(|v|!v.document.is_current()||v.launch.root.is_revoked()||v.launch.expires<=std::time::Instant::now()){pending.take();}
  if pending.as_ref().is_some_and(|v|v.document.is_current()&&v.launch.expires>std::time::Instant::now()){return Err("scene_plan_already_pending".into());}}
  if !document.is_current(){return Err("scene_document_revoked".into());}
  let project=Arc::new(crate::ue_semantic_launch::Prepared::new(root.clone(),input.project_file,crate::ue_scene_batch::ROOT.into())?);validate_directories(&root)?;let path=root.path_hint().to_string_lossy().to_string();
  if !confirm(hwnd,&path,&project,&input.plan){return Err("scene_approval_declined".into());}
  let launch=write_approved_launch(project,input.plan,||document.is_current()&&lifecycle.ensure_lifecycle_monitor().is_ok())?;
  let operation_id=launch.plan.operation_id.clone();
  // No registry lock is held across native confirmation or filesystem work.
  let mut pending=PENDING.get().unwrap().lock().map_err(|_|"scene_plan_unavailable")?;
  if !document.is_current()||lifecycle.ensure_lifecycle_monitor().is_err(){return Err("scene_approval_written_context_closed_no_execution".into());}
  *pending=Some(Record{project_id:input.project_id.clone(),launch,document,editor:None,execution:None});drop(pending);
  Ok(LaunchPlanReceipt{schema_version:1,project_id:input.project_id,operation_id,status:"startup_plan_written",approval_file_created:true,editor_started:false,asset_created:false})
 }).await.map_err(|_|"scene_approval_worker_failed".to_string())?
}

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct StartInput{project_id:String,operation_id:String}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct StartReceipt{schema_version:u32,project_id:String,operation_id:String,status:&'static str,asset_created:bool,session:crate::ue_editor_process::EditorObservationSessionResult}
#[tauri::command]
pub(crate) async fn start_approved_ue_scene_editor(window:tauri::WebviewWindow,store:tauri::State<'_,crate::managed_run_store::ManagedRunStoreState>,lifecycle:tauri::State<'_,crate::ue_build_preview_commands::UEBuildPreviewState>,input:StartInput)->Result<StartReceipt,String>{
 lifecycle.ensure_lifecycle_monitor()?;let lifecycle=lifecycle.inner().clone();
 let document=store.capture_window_grant(&window).map_err(|_|"scene_document_required")?;
 let hwnd=window.hwnd().map_err(|_|"scene_window_required")?.0 as isize;
 WRITING.compare_exchange(false,true,std::sync::atomic::Ordering::AcqRel,std::sync::atomic::Ordering::Acquire).map_err(|_|"scene_plan_busy")?;let writing=Writing;
 let cancelled=Arc::new(std::sync::atomic::AtomicBool::new(false));
 *STARTING.get_or_init(||Mutex::new(None)).lock().map_err(|_|"scene_start_unavailable")?=Some(Starting{project_id:input.project_id.clone(),operation_id:input.operation_id.clone(),document:document.clone(),cancelled:cancelled.clone()});
 let start_guard=StartGuard(cancelled.clone());
 tauri::async_runtime::spawn_blocking(move||{
  let _writing=writing;let _start_guard=start_guard;
  let mut record={let mut slot=PENDING.get_or_init(||Mutex::new(None)).lock().map_err(|_|"scene_plan_unavailable")?;
   let current=slot.as_ref().ok_or("scene_plan_missing")?;
   if current.project_id!=input.project_id||current.launch.plan.operation_id!=input.operation_id||!current.document.same_document(&document)||current.editor.is_some(){return Err("scene_plan_binding_mismatch".into());}
   slot.take().unwrap()
  };
  let root=record.launch.root.clone();let expires=record.launch.expires;let live_document=record.document.clone();let live_lifecycle=lifecycle.clone();
  let live:Arc<dyn Fn()->bool+Send+Sync>=Arc::new(move||!cancelled.load(std::sync::atomic::Ordering::Acquire)&&live_document.is_current()&&!root.is_revoked()&&root.check_current().is_ok()&&std::time::Instant::now()<expires&&live_lifecycle.ensure_lifecycle_monitor().is_ok());
  if !live(){return Err("scene_start_revoked".into());}
  let text=format!("Start the configured UE 5.8.4 editor for this explicitly approved new-map task?\nProject: {}\nTarget: {}\nOperation: {}\n\nThis executes editor, project and plugin startup code and writes project logs/cache/DerivedData artifacts. Scene preparation, object execution and saving require separate approvals. Unsaved scene changes are lost when this editor stops. The owned editor stops when this document closes or the plan expires.",record.launch.root.path_hint().display(),record.launch.plan.target_map,record.launch.plan.operation_id);
  let text:Vec<u16>=text.encode_utf16().chain(Some(0)).collect();let title:Vec<u16>="UAgent - start scene editor".encode_utf16().chain(Some(0)).collect();
  if unsafe{MessageBoxW(hwnd,text.as_ptr(),title.as_ptr(),0x4|0x30|0x100)}!=6{
   let mut slot=PENDING.get().unwrap().lock().map_err(|_|"scene_plan_unavailable")?;
   if live(){*slot=Some(record);}return Err("scene_start_declined".into());
  }
  if !live(){return Err("scene_start_revoked".into());}
  let pin=record.launch.pin_approved_file()?;
  let result=crate::ue_editor_process::start_scene_owned_editor(&input.project_id,&record.launch,live.clone())?;
  if result.status!="ready"{return Err("scene_editor_not_ready".into());}
  let process=result.process.ok_or("scene_process_missing")?;
  let attached=crate::ue_editor_process::attach_editor_process(crate::ue_editor_process::EditorAttachInput{project_id:input.project_id.clone(),root_ref:record.launch.root.path_hint().to_string_lossy().into_owned(),uproject_relative_path:record.launch.project.project_file.clone(),process_id:process.id.clone(),pid_hash:process.pid_hash,process_display_name:process.display_name,mode:"attached".into()});
  let session=match attached{Ok(s) if s.status=="attached"=>s,_=>{crate::ue_editor_process::stop_scene_owned_editor(&process.id);return Err("scene_observation_failed".into());}};
  record.editor=Some(SceneEditor{process_id:process.id,session:session.clone(),_approval_pin:pin});
  if !live(){return Err("scene_start_revoked".into());}
  let mut slot=PENDING.get().unwrap().lock().map_err(|_|"scene_plan_unavailable")?;
  if !live(){return Err("scene_start_revoked".into());}
  *slot=Some(record);drop(slot);
  Ok(StartReceipt{schema_version:1,project_id:input.project_id,operation_id:input.operation_id,status:"editor_started",asset_created:false,session})
 }).await.map_err(|_|"scene_start_worker_failed".to_string())?
}

#[tauri::command]
pub(crate) async fn stop_approved_ue_scene_editor(window:tauri::WebviewWindow,store:tauri::State<'_,crate::managed_run_store::ManagedRunStoreState>,input:StartInput)->Result<bool,String>{
 let document=store.capture_window_grant(&window).map_err(|_|"scene_document_required")?;
 let cancelling=if let Some(registry)=STARTING.get(){let active=registry.lock().map_err(|_|"scene_start_unavailable")?;
  if let Some(active)=active.as_ref().filter(|v|v.project_id==input.project_id&&v.operation_id==input.operation_id&&v.document.same_document(&document)){active.cancelled.store(true,std::sync::atomic::Ordering::Release);true}else{false}
 }else{false};
 let retired={let mut slot=PENDING.get_or_init(||Mutex::new(None)).lock().map_err(|_|"scene_plan_unavailable")?;
  if slot.as_ref().is_some_and(|v|v.project_id==input.project_id&&v.launch.plan.operation_id==input.operation_id&&v.document.same_document(&document)){slot.take()}else{return Ok(cancelling);}
 };
 tauri::async_runtime::spawn_blocking(move||{drop(retired);true}).await.map_err(|_|"scene_stop_worker_failed".into())
}


#[derive(Deserialize)]
#[serde(rename_all="snake_case")]
pub(crate) enum Stage{Prepare,Execute,Cancel,Query,Resume,Save}
impl Stage{fn name(&self)->&'static str{match self{Self::Prepare=>"prepare",Self::Execute=>"execute",Self::Cancel=>"cancel",Self::Query=>"query",Self::Resume=>"resume",Self::Save=>"save"}}}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct StepInput{project_id:String,operation_id:String,stage:Stage}
#[tauri::command]
pub(crate) async fn scene_batch_step(window:tauri::WebviewWindow,store:tauri::State<'_,crate::managed_run_store::ManagedRunStoreState>,lifecycle:tauri::State<'_,crate::ue_build_preview_commands::UEBuildPreviewState>,input:StepInput)->Result<serde_json::Value,String>{
 lifecycle.ensure_lifecycle_monitor()?;let lifecycle=lifecycle.inner().clone();
 let document=store.capture_window_grant(&window).map_err(|_|"scene_document_required")?;
 let hwnd=window.hwnd().map_err(|_|"scene_window_required")?.0 as isize;
 WRITING.compare_exchange(false,true,std::sync::atomic::Ordering::AcqRel,std::sync::atomic::Ordering::Acquire).map_err(|_|"scene_busy")?;let writing=Writing;
 let cancelled=Arc::new(std::sync::atomic::AtomicBool::new(false));
 *STARTING.get_or_init(||Mutex::new(None)).lock().map_err(|_|"scene_unavailable")?=Some(Starting{project_id:input.project_id.clone(),operation_id:input.operation_id.clone(),document:document.clone(),cancelled:cancelled.clone()});let guard=StartGuard(cancelled.clone());
 tauri::async_runtime::spawn_blocking(move||{
  let _writing=writing;let _guard=guard;
  let mut record={let mut slot=PENDING.get_or_init(||Mutex::new(None)).lock().map_err(|_|"scene_unavailable")?;let r=slot.as_ref().ok_or("scene_plan_required")?;
   if r.project_id!=input.project_id||r.launch.plan.operation_id!=input.operation_id||!r.document.same_document(&document)||r.editor.is_none(){return Err("scene_scope_mismatch".into());}slot.take().unwrap()};
  let root=record.launch.root.clone();let expires=record.launch.expires;
  let live=||document.is_current()&&!cancelled.load(std::sync::atomic::Ordering::Acquire)&&!root.is_revoked()&&root.check_current().is_ok()&&std::time::Instant::now()<expires&&lifecycle.ensure_lifecycle_monitor().is_ok();
  let stage=input.stage.name();
  let outcome=(||->Result<serde_json::Value,String>{
   if !live(){return Err("scene_revoked".into());}validate_directories(&root)?;if !record.launch.project.current(){return Err("scene_project_identity_changed".into());}record.editor.as_ref().unwrap()._approval_pin.check()?;
   if stage!="query"{
    let effect=match stage{"prepare"=>"Loads fixed Engine resources and creates a NEW unsaved ordinary world. Refuses dirty/unsupported current worlds.","execute"=>"Places the exact reviewed objects, one at a time. Does not save the map.","cancel"=>"Stops future placements. Already placed objects remain; cancellation is NOT rollback.","resume"=>"Continues only verified not-started objects in this same editor/run after a fresh query.",_=>"Saves ONLY the reviewed new map after all planned actual objects are verified. Never overwrites an existing map."};
    let message=format!("Approve scene {stage}?\nProject: {}\n{}\n\n{effect}\nReceipts are retained in Saved/UAgentSceneT14. No automatic replay after uncertainty.",root.path_hint().display(),serde_json::to_string_pretty(&record.launch.plan).map_err(|_|"scene_plan_encoding")?);
    let text:Vec<u16>=message.encode_utf16().chain(Some(0)).collect();let title:Vec<u16>="UAgent - scene operation".encode_utf16().chain(Some(0)).collect();if unsafe{MessageBoxW(hwnd,text.as_ptr(),title.as_ptr(),0x4|0x30|0x100)}!=6{return Err("scene_approval_declined".into());}
   }
   if !live(){return Err("scene_revoked".into());}
   let editor=&record.editor.as_ref().unwrap().session;
   let mut connection=crate::ue_pickup_connection_commands::Connection::owned(input.project_id.clone(),editor.root_id.clone().ok_or("scene_root_missing")?,editor.session_id.clone().ok_or("scene_session_missing")?,document.clone())?;
   let result=(||->Result<serde_json::Value,String>{
    let m=crate::ue_scene_execution::negotiate(|id,method,args|{if !live(){return Err("scene_revoked".into());}connection.exchange(id,method,args)})?;
    if record.execution.is_none(){record.execution=Some(crate::ue_scene_execution::Execution::new(&m,record.launch.root_object_id.clone(),record.launch.run_id.clone(),record.launch.plan.clone(),record.launch.permits.clone())?);}
    let execution=record.execution.as_mut().unwrap();execution.check(&m)?;
    execution.step(stage,|call|{if !live(){return Err("scene_revoked".into());}let response=connection.exchange(10,"tools/call",call)?;if !live(){return Err("scene_result_requires_inspection".into());}Ok(response)})
   })();let closed=connection.close();let data=result?;closed?;if !live(){return Err("scene_result_requires_inspection".into());}
   let receipt=serde_json::json!({"schemaVersion":1,"projectId":input.project_id,"operationId":input.operation_id,"runId":record.launch.run_id,"stage":stage,"status":"observed","data":data});
   let bytes=serde_json::to_vec(&receipt).map_err(|_|"scene_receipt_encoding")?;
   let reader=root.scope_from_verified_host(vec![crate::trusted_root_handle::ReadRule::subtree("Saved/UAgentSceneT14").map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
   let directory=reader.pin_directory("Saved/UAgentSceneT14").map_err(|e|e.to_string())?;
   let mut nonce=[0u8;16];getrandom::getrandom(&mut nonce).map_err(|_|"scene_receipt_random_failed")?;
   let name=format!("receipt-{}.json",nonce.iter().map(|b|format!("{b:02x}")).collect::<String>());
   crate::ue_build_repair_io::create_recovery_record(&directory,&name,&bytes).map_err(|_|"scene_receipt_not_persisted_query_before_retry")?;
   if !live(){return Err("scene_result_requires_inspection".into());}
   Ok(serde_json::json!({"receipt":receipt,"persisted":true,"receiptFile":format!("Saved/UAgentSceneT14/{name}")}))
  })();
  let mut slot=PENDING.get().unwrap().lock().map_err(|_|"scene_unavailable")?;
  if live(){*slot=Some(record);}else{drop(slot);drop(record);return Err("scene_result_requires_inspection".into());}outcome
 }).await.map_err(|_|"scene_worker_failed".to_string())?
}
