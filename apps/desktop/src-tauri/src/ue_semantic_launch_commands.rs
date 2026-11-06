//! Ordinary-project managed read session. Approval runs in the trusted native window.
use std::{sync::{Arc,Mutex,OnceLock,atomic::{AtomicBool,Ordering}},time::{Instant,Duration}};
use serde::Deserialize;
use serde_json::{json,Value};
use crate::{managed_run_store::NativeStoreWindowGrant,ue_semantic_launch::Prepared};
struct Editor(String);
impl Drop for Editor {fn drop(&mut self){crate::ue_editor_process::stop_semantic_owned_editor(&self.0);}}
struct Record {project:String,operation:String,document:Arc<NativeStoreWindowGrant>,plan:Arc<Prepared>,cancel:Arc<AtomicBool>,expires:Instant,editor:Option<Editor>}
impl Drop for Record {fn drop(&mut self){self.cancel.store(true,Ordering::Release);}}
static ACTIVE:OnceLock<Mutex<Option<Record>>>=OnceLock::new();
fn registry()->&'static Mutex<Option<Record>> {ACTIVE.get_or_init(||Mutex::new(None))}
pub(crate) fn reap_stale(){let retired=if let Ok(mut slot)=registry().try_lock(){if slot.as_ref().is_some_and(|r|!r.document.is_current()||r.plan.root.is_revoked()||Instant::now()>=r.expires){slot.take()}else{None}}else{None};drop(retired);}
pub(crate) fn shutdown(){let retired=registry().lock().ok().and_then(|mut s|s.take());drop(retired);}
struct Attempt {cancel:Arc<AtomicBool>,committed:bool}
impl Drop for Attempt {fn drop(&mut self){if !self.committed{let retired=registry().lock().ok().and_then(|mut s|if s.as_ref().is_some_and(|r|Arc::ptr_eq(&r.cancel,&self.cancel)){s.take()}else{None});drop(retired);}}}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct StartInput {project_id:String,operation_id:String,project_file:String,read_root:String}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct StopInput {project_id:String,operation_id:String}
#[link(name="user32")]
extern "system"{fn MessageBoxW(window:isize,text:*const u16,title:*const u16,flags:u32)->i32;}
#[tauri::command]
pub(crate) async fn start_ue_semantic_editor(window:tauri::WebviewWindow,store:tauri::State<'_,crate::managed_run_store::ManagedRunStoreState>,lifecycle:tauri::State<'_,crate::ue_build_preview_commands::UEBuildPreviewState>,input:StartInput)->Result<Value,String>{
 lifecycle.ensure_lifecycle_monitor()?;let lifecycle=lifecycle.inner().clone();
 if input.operation_id.len()!=36||!input.operation_id.chars().all(|c|c.is_ascii_hexdigit()||c=='-'){return Err("semantic_operation_invalid".into());}
 let document=store.capture_window_grant(&window).map_err(|_|"semantic_document_required")?;
 let root=crate::resolve_trusted_root_handle_by_id(&input.project_id).map_err(|_|"semantic_trusted_root_required")?;
 let plan=Arc::new(Prepared::new(root,input.project_file,input.read_root)?);
 let hwnd=window.hwnd().map_err(|_|"semantic_window_required")?.0 as isize;
 let cancel=Arc::new(AtomicBool::new(false));let expires=Instant::now()+Duration::from_secs(600);
 {let mut slot=registry().lock().map_err(|_|"semantic_registry_unavailable")?;if slot.is_some(){return Err("semantic_editor_already_pending".into());}
 *slot=Some(Record{project:input.project_id.clone(),operation:input.operation_id.clone(),document:document.clone(),plan:plan.clone(),cancel:cancel.clone(),expires,editor:None});}
 let attempt=Attempt{cancel:cancel.clone(),committed:false};
 tauri::async_runtime::spawn_blocking(move||{
  let mut attempt=attempt;
  let checked_plan=plan.clone();let checked_document=document.clone();let checked_cancel=cancel.clone();let checked_project=input.project_id.clone();
  let live:Arc<dyn Fn()->bool+Send+Sync>=Arc::new(move||!checked_cancel.load(Ordering::Acquire)&&checked_document.is_current()&&checked_plan.current()&&Instant::now()<expires&&lifecycle.ensure_lifecycle_monitor().is_ok()&&crate::resolve_trusted_root_handle_by_id(&checked_project).is_ok_and(|r|Arc::ptr_eq(&r,&checked_plan.root)));
  if !live(){return Err("semantic_start_revoked".into());}
  let text=format!("Start a managed UE 5.8.4 editor for read-only Blueprint queries?\nProject: {}\nProject file: {}\nProject SHA256: {}\nRead root: {}\n\nRuns installed editor, project and plugin startup code. Requires the existing V2 semantic plugin. Writes normal editor logs and derived data; does not grant asset loading, compilation, saving or other asset writes. Queries require separate exact-asset approval. The editor has no interactive window and stops when this task/window closes or its 10-minute lease expires. Project descriptor changes are blocked during the session.",plan.root.path_hint().display(),plan.project_file,plan.hash,plan.read_root);
  let text:Vec<u16>=text.encode_utf16().chain(Some(0)).collect();let title:Vec<u16>="UAgent - start read-only editor".encode_utf16().chain(Some(0)).collect();
  if unsafe{MessageBoxW(hwnd,text.as_ptr(),title.as_ptr(),0x4|0x30|0x100)}!=6{return Err("semantic_start_declined".into());}
  if !live(){return Err("semantic_start_revoked".into());}
  let mut random=[0u8;16];getrandom::getrandom(&mut random).map_err(|_|"semantic_random_failed")?;
  let nonce:String=random.iter().map(|b|format!("{b:02x}")).collect();
  let artifacts=std::env::temp_dir().join(format!("UAgentSemantic-{nonce}"));std::fs::create_dir(&artifacts).map_err(|_|"semantic_artifacts_unavailable")?;
  let created=crate::ue_editor_process::start_semantic_owned_editor(&input.project_id,&plan,artifacts,live.clone())?;
  if created.status!="ready"{return Err("semantic_editor_not_ready".into());}
  let process=created.process.ok_or("semantic_process_missing")?;let editor=Editor(process.id.clone());
  if !live(){return Err("semantic_start_revoked".into());}
  let session=crate::ue_editor_process::attach_editor_process(crate::ue_editor_process::EditorAttachInput{project_id:input.project_id.clone(),root_ref:plan.root.path_hint().to_string_lossy().into_owned(),uproject_relative_path:plan.project_file.clone(),process_id:process.id,pid_hash:process.pid_hash,process_display_name:process.display_name,mode:"attached".into()})?;
  if session.status!="attached"||session.session_id.is_none()||session.root_id.is_none(){return Err("semantic_observation_failed".into());}
  // Proves the owned endpoint before publishing. Exact V2 negotiation occurs for each read.
  crate::ue_editor_process::resolve_pickup_discovery_listener(session.session_id.as_deref().unwrap(),&input.project_id,session.root_id.as_deref().unwrap())?;
  let mut slot=registry().lock().map_err(|_|"semantic_registry_unavailable")?;
  if !live()||!slot.as_ref().is_some_and(|r|Arc::ptr_eq(&r.cancel,&cancel)){return Err("semantic_start_revoked".into());}
  slot.as_mut().unwrap().editor=Some(editor);attempt.committed=true;drop(slot);
  Ok(json!({"schemaVersion":1,"projectId":input.project_id,"operationId":input.operation_id,"projectFile":plan.project_file,"readRoot":plan.read_root,"projectSha256":plan.hash,"status":"editor_started","assetWriteEnabled":false,"toolsVerified":false,"session":session}))
 }).await.map_err(|_|"semantic_start_worker_failed".to_string())?
}
#[tauri::command]
pub(crate) async fn stop_ue_semantic_editor(window:tauri::WebviewWindow,store:tauri::State<'_,crate::managed_run_store::ManagedRunStoreState>,input:StopInput)->Result<bool,String>{
 let document=store.capture_window_grant(&window).map_err(|_|"semantic_document_required")?;
 let retired={let mut slot=registry().lock().map_err(|_|"semantic_registry_unavailable")?;
 if slot.as_ref().is_some_and(|r|r.project==input.project_id&&r.operation==input.operation_id&&r.document.same_document(&document)){slot.take()}else{return Ok(false);}};
 // Flag cancellation before waiting for cleanup, including startup while native approval is open.
 if let Some(r)=&retired{r.cancel.store(true,Ordering::Release);}
 tauri::async_runtime::spawn_blocking(move||{drop(retired);true}).await.map_err(|_|"semantic_stop_worker_failed".into())
}
