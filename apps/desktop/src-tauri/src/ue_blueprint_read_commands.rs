//! Exact-package native approval; no renderer endpoint, peer identity or tool name.
use serde::Deserialize;
use serde_json::{json,Value};
use std::sync::atomic::{AtomicBool,Ordering};
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct Input {project_id:String,root_id:String,editor_session_id:String,package_name:String}
static BUSY:AtomicBool=AtomicBool::new(false);
struct Permit;impl Drop for Permit{fn drop(&mut self){BUSY.store(false,Ordering::Release);}}
#[link(name="user32")]
extern "system"{fn MessageBoxW(window:isize,text:*const u16,title:*const u16,flags:u32)->i32;}
#[tauri::command]
pub(crate) async fn read_ue_blueprint_structure(window:tauri::WebviewWindow,store:tauri::State<'_,crate::managed_run_store::ManagedRunStoreState>,input:Input)->Result<Value,String>{query(window,store,input,false).await}
#[tauri::command]
pub(crate) async fn read_ue_asset_references(window:tauri::WebviewWindow,store:tauri::State<'_,crate::managed_run_store::ManagedRunStoreState>,input:Input)->Result<Value,String>{query(window,store,input,true).await}
async fn query(window:tauri::WebviewWindow,store:tauri::State<'_,crate::managed_run_store::ManagedRunStoreState>,input:Input,references:bool)->Result<Value,String>{
 if !crate::ue_blueprint_read::target(&input.package_name)||[&input.project_id,&input.root_id,&input.editor_session_id].iter().any(|s|s.is_empty()||s.len()>256||s.chars().any(char::is_control)){return Err("semantic_invalid_intent".into());}
 let document=store.capture_window_grant(&window).map_err(|_|"semantic_document_required")?;
 let hwnd=window.hwnd().map_err(|_|"semantic_window_required")?.0 as isize;
 BUSY.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).map_err(|_|"semantic_read_busy")?;let permit=Permit;
 tauri::async_runtime::spawn_blocking(move||{
  let _permit=permit;
  let root=crate::resolve_trusted_root_handle_by_id(&input.project_id).map_err(|_|"semantic_trusted_root_required")?;
  root.check_current().map_err(|_|"semantic_root_changed")?;
  let identity=root.pickup_legacy_identity().map_err(|_|"semantic_root_identity_failed")?;
  let binding=crate::ue_editor_process::resolve_pickup_discovery_listener(&input.editor_session_id,&input.project_id,&input.root_id)?.0;
  let mut connection=crate::ue_pickup_connection_commands::Connection::owned(input.project_id.clone(),input.root_id.clone(),input.editor_session_id.clone(),document.clone())?;
  let live=||->Result<(),String>{if !document.is_current(){return Err("semantic_document_revoked".into());}root.check_current().map_err(|_|"semantic_root_changed".to_string())?;
   let current=crate::resolve_trusted_root_handle_by_id(&input.project_id).map_err(|_|"semantic_root_changed")?;
   if !std::sync::Arc::ptr_eq(&root,&current)||crate::ue_editor_process::resolve_pickup_discovery_listener(&input.editor_session_id,&input.project_id,&input.root_id)?.0!=binding{return Err("semantic_editor_changed".into());}Ok(())};
  live()?;
  let message=if references {format!("Read Asset Registry references for ONE package?\nProject: {}\nPackage: {}\nEditor session: {}\n\nReturns direct package dependency and referencer names, up to 128 each, possibly outside the selected read root. Does not read related asset contents or load, compile, save or scan assets. Registry may still be loading or stale; empty results do not prove absence. No model request is authorized.",root.path_hint().display(),input.package_name,input.editor_session_id)}else{format!("Read this ONE loaded Blueprint structure?\nProject: {}\nBlueprint: {}\nEditor session: {}\n\nReturns declared components, variables, functions and events (up to 128 each). No asset loading, compiling or saving. This is an editor observation, not a coherent disk snapshot. No model request is authorized by this approval.",root.path_hint().display(),input.package_name,input.editor_session_id)};
  let message:Vec<u16>=message.encode_utf16().chain(Some(0)).collect();let title:Vec<u16>="UAgent - read Blueprint".encode_utf16().chain(Some(0)).collect();
  if unsafe{MessageBoxW(hwnd,message.as_ptr(),title.as_ptr(),0x4|0x30|0x100)}!=6{return Err("semantic_read_declined".into());}
  live()?;
  let send=|id,method:&str,args|{live()?;let result=connection.exchange(id,method,args)?;live()?;Ok(result)};
  let outcome=if references{crate::ue_blueprint_read::read_references(&identity,&input.package_name,send)}else{crate::ue_blueprint_read::read(&identity,&input.package_name,send)};
  let closed=connection.close();let result=outcome?;closed?;live()?;
  Ok(json!({"schemaVersion":1,"projectId":input.project_id,"rootId":input.root_id,"editorSessionId":input.editor_session_id,"packageName":input.package_name,"rootObjectId":identity,"observationGeneration":binding.observation_generation,"status":"observed","cacheable":false,"result":result}))
 }).await.map_err(|_|"semantic_read_worker_failed".to_string())?
}
