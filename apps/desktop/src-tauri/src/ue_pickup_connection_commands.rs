//! Owned, short-lived, read-only V2 negotiation. No renderer endpoint or tool payload.
use serde::{Deserialize, Serialize};
use serde_json::{json,Value};
use std::sync::{Arc,atomic::{AtomicBool,Ordering}};
use std::time::Duration;
use crate::managed_run_store::NativeStoreWindowGrant;
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct ConnectInput { project_id:String, root_id:String, editor_session_id:String }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct ConnectionReport {
 schema_version:u32, project_id:String, editor_session_id:String,
 status:&'static str, tools_verified:bool, plugin_lab_enabled:bool,
 mutation_enabled:bool, connection_retained:bool, reason:&'static str,
}
static BUSY:AtomicBool=AtomicBool::new(false);
struct Permit;
impl Drop for Permit {fn drop(&mut self){BUSY.store(false,Ordering::Release);}}
pub(crate) struct Connection {
 input:ConnectInput, document:Arc<NativeStoreWindowGrant>,
 binding:crate::ue_editor_process::AssetMutationObservationBinding, port:u16,
 session:Option<String>, agent:ureq::Agent,
}
impl Connection {
 pub(crate) fn owned(project_id:String,root_id:String,editor_session_id:String,document:Arc<NativeStoreWindowGrant>)->Result<Self,String>{
  let (binding,port)=crate::ue_editor_process::resolve_pickup_discovery_listener(&editor_session_id,&project_id,&root_id)?;
  Ok(Self{input:ConnectInput{project_id,root_id,editor_session_id},document,binding,port,session:None,agent:ureq::AgentBuilder::new().redirects(0).timeout(Duration::from_secs(5)).build()})
 }
 pub(crate) fn manifest(&mut self)->Result<Value,String>{
  let mut manifest=Value::Null;
  crate::ue_pickup_negotiation::negotiate(|id,method,params|{let v=self.exchange(id,method,params)?;if id==3{manifest=v["structuredContent"].clone();}Ok(v)})?;
  Ok(manifest)
 }
 fn current(&self)->Result<(),String>{
  if !self.document.is_current(){return Err("pickup_document_revoked".into());}
  let (binding,port)=crate::ue_editor_process::resolve_pickup_discovery_listener(&self.input.editor_session_id,&self.input.project_id,&self.input.root_id)?;
  if binding!=self.binding||port!=self.port{return Err("pickup_connection_changed".into());} Ok(())
 }
 pub(crate) fn exchange(&mut self,id:u64,method:&str,params:Value)->Result<Value,String>{
  self.current()?;
  let endpoint=format!("http://127.0.0.1:{}/mcp",self.port);
  let mut req=self.agent.post(&endpoint).set("Content-Type","application/json").set("Accept","application/json, text/event-stream").set("MCP-Protocol-Version","2025-06-18");
  if let Some(session)=&self.session{req=req.set("Mcp-Session-Id",session);}
  let body=if id==0 {json!({"jsonrpc":"2.0","method":method})} else {json!({"jsonrpc":"2.0","id":id,"method":method,"params":params})};
  let response=req.send_string(&body.to_string()).map_err(|_|"pickup_transport_failed")?;
  let response=crate::mcp::pickup_discovery_response(response)?;
  self.current()?;
  if let Some(session)=response.session_id {
   if session.is_empty()||session.len()>256||session.chars().any(char::is_control)||self.session.as_ref().is_some_and(|old|old!=&session){return Err("pickup_session_changed".into());}
   self.session=Some(session);
  }
  if id==0{return Ok(Value::Null);}
  if response.body.len()>4*1024*1024{return Err("pickup_response_too_large".into());}
  let sse=response.content_type.as_deref().and_then(|v|v.split(';').next()).is_some_and(|v|v.trim().eq_ignore_ascii_case("text/event-stream"));
  crate::ue_pickup_negotiation::rpc_result(&response.body,sse,id)
 }
 fn negotiate(&mut self)->Result<bool,String>{
  crate::ue_pickup_negotiation::negotiate(|id,method,params|self.exchange(id,method,params))
 }
 pub(crate) fn close(&mut self)->Result<(),String>{
  // Session termination only, never asset deletion. Never contact a replacement listener.
  self.current()?;
  if let Some(session)=self.session.take(){
   let response=self.agent.delete(&format!("http://127.0.0.1:{}/mcp",self.port)).set("Mcp-Session-Id",&session).set("MCP-Protocol-Version","2025-06-18").call();
   match response {Ok(r) if matches!(r.status(),200|202|204)=>{},Err(ureq::Error::Status(404,_))=>{},_=>return Err("pickup_session_close_unconfirmed".into())}
  }
  Ok(())
 }

}
fn connect(input:ConnectInput,document:Arc<NativeStoreWindowGrant>,_permit:Permit)->Result<ConnectionReport,String>{
 if !document.is_current(){return Err("pickup_document_revoked".into());}
 let (binding,port)=crate::ue_editor_process::resolve_pickup_discovery_listener(&input.editor_session_id,&input.project_id,&input.root_id)?;
 let mut connection=Connection{input,document,binding,port,session:None,agent:ureq::AgentBuilder::new().redirects(0).timeout(Duration::from_secs(5)).build()};
 let outcome=connection.negotiate();let closed=connection.close();let enabled=outcome?;closed?;connection.current()?;
 Ok(ConnectionReport{schema_version:1,project_id:connection.input.project_id,editor_session_id:connection.input.editor_session_id,status:"negotiated_readonly",tools_verified:true,plugin_lab_enabled:enabled,mutation_enabled:false,connection_retained:false,reason:"pickup_native_plan_approval_not_integrated"})
}
#[tauri::command]
pub(crate) async fn negotiate_ue_pickup_connection(window:tauri::WebviewWindow,store:tauri::State<'_,crate::managed_run_store::ManagedRunStoreState>,input:ConnectInput)->Result<ConnectionReport,String>{
 for value in [&input.project_id,&input.root_id,&input.editor_session_id]{if value.is_empty()||value.len()>256||value.chars().any(char::is_control){return Err("pickup_identity_invalid".into());}}
 let document=store.capture_window_grant(&window).map_err(|_|"pickup_document_required")?;
 BUSY.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).map_err(|_|"pickup_connection_busy")?;
 let permit=Permit;
 tauri::async_runtime::spawn_blocking(move||connect(input,document,permit)).await.map_err(|_|"pickup_worker_failed".to_string())?
}
