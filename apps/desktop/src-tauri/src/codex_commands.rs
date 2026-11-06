//! Window-owned official Codex integration; only explicit UI sends start a model turn.
use crate::{managed_run_store::{ManagedRunStoreState,NativeStoreWindowGrant},codex_bridge::{self,View}};
use serde::{Serialize,Deserialize};use std::{path::PathBuf,sync::{Arc,Mutex,OnceLock,atomic::{AtomicBool,Ordering}},collections::HashMap,time::{SystemTime,UNIX_EPOCH}};use tauri::Manager;
struct Active{dispatch:AtomicBool,lane:String,document:Arc<NativeStoreWindowGrant>,project:String,cancel:AtomicBool,view:Mutex<View>}
static APPROVAL:Mutex<()>=Mutex::new(());
static ACTIVE:OnceLock<Mutex<HashMap<String,Arc<Active>>>>=OnceLock::new();
fn registry()->&'static Mutex<HashMap<String,Arc<Active>>>{ACTIVE.get_or_init(||Mutex::new(HashMap::new()))}
fn uid()->Result<String,String>{let mut bytes=[0u8;16];getrandom::getrandom(&mut bytes).map_err(|_|"codex_random")?;Ok(bytes.iter().map(|v|format!("{v:02x}")).collect())}
fn now()->i64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64}
fn default_path()->PathBuf{PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default()).join("Programs/OpenAI/Codex/bin/codex.exe")}
#[derive(Serialize)]#[serde(rename_all="camelCase")]
pub(crate) struct Discovery{executable:String,found:bool,protocol:&'static str}
#[tauri::command]pub(crate) fn discover_codex(window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>)->Result<Discovery,String>{store.capture_window_grant(&window).map_err(|_|"codex_document_required")?;let path=default_path();Ok(Discovery{found:path.is_file(),executable:path.to_string_lossy().into(),protocol:"app-server stdio"})}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct Start{project_id:String,session_id:Option<String>,executable:String,model:String,effort:Option<String>,prompt:String,member:Option<Member>,#[serde(default)] tools:Vec<serde_json::Value>}
#[derive(Clone,Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub(crate) struct Member{run_id:String,member_id:String}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub(crate) struct Selected{project_id:String,request_id:String}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub(crate) struct Project{project_id:String}
#[tauri::command]pub(crate) async fn list_codex_sessions(window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>,input:Project)->Result<Vec<crate::local_run_store::codex_sessions::Link>,String>{crate::resolve_trusted_root_handle_by_id(&input.project_id).map_err(|_|"codex_project_required")?;store.with_store(&window,true,move|db,_,_|db.codex_links(&input.project_id)).await.map_err(|_|"codex_history_unavailable".into())}
#[link(name="user32")]extern "system"{fn MessageBoxW(h:isize,text:*const u16,title:*const u16,flags:u32)->i32;}
#[tauri::command]pub(crate) async fn start_codex_turn(app:tauri::AppHandle,window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>,input:Start)->Result<View,String>{
 let document=store.capture_window_grant(&window).map_err(|_|"codex_document_required")?;let root=crate::resolve_trusted_root_handle_by_id(&input.project_id).map_err(|_|"codex_project_required")?;
 if input.prompt.trim().is_empty()||input.prompt.len()>32000||input.model.is_empty()||input.model.len()>100||!input.model.bytes().all(|b|b.is_ascii_alphanumeric()||b"._-".contains(&b)){return Err("codex_invalid_input".into());}
 if input.tools.len()>3||(!input.tools.is_empty()&&input.member.is_none())||input.tools.iter().any(|v|v["type"]!="function"||!v["description"].is_string()||!v["name"].as_str().is_some_and(codex_bridge::read_tool)||!v["inputSchema"].is_object()||v.to_string().len()>12000){return Err("codex_tool_definition_invalid".into());}
 if input.effort.as_ref().is_some_and(|v|v.is_empty()||v.len()>64||!v.bytes().all(|b|b.is_ascii_alphanumeric()||b"_-".contains(&b))){return Err("codex_effort_invalid".into());}
 let exe=crate::codex_program::resolve(std::path::Path::new(&input.executable))?;
 let lane=if let Some(m)=&input.member{if !["lead","investigator","reviewer","member_3","member_4"].contains(&m.member_id.as_str())||m.run_id.is_empty()||m.run_id.len()>200||!m.run_id.bytes().all(|b|b.is_ascii_alphanumeric()||b"_:-".contains(&b)){return Err("codex_member_scope_invalid".into());}format!("member:{}",m.member_id)}else{"conversation".into()};
 let request=uid()?;let session=input.session_id.clone().unwrap_or(uid()?);let hwnd=window.hwnd().map_err(|_|"codex_window")?.0 as isize;
 let scratch=crate::app_profile::resolve_app_data_dir(&app)?.join("codex-workspaces").join(&session);
 let active=Arc::new(Active{dispatch:AtomicBool::new(input.member.is_none()),lane:lane.clone(),document:document.clone(),project:input.project_id.clone(),cancel:AtomicBool::new(false),view:Mutex::new(View{request_id:request.clone(),session_id:session.clone(),status:"preparing".into(),..View::default()})});
 {let mut registry=registry().lock().map_err(|_|"codex_unavailable")?;
 registry.retain(|_,v|v.document.is_current()&&!(v.document.same_document(&document)&&v.lane==lane&&v.view.lock().map(|s|s.persisted||s.error.is_some()).unwrap_or(false)));
 if registry.values().any(|v|v.document.same_document(&document)&&v.lane==lane){return Err("codex_turn_active".into());}
 if registry.len()>=32{return Err("codex_close_previous_window".into());}registry.insert(request.clone(),active.clone());}

 let confirm_active=active.clone();let confirm_exe=exe.clone();let prompt=input.prompt.clone();let model=input.model.clone();let effort=input.effort.clone();let project=input.project_id.clone();let tool_names=serde_json::to_string(&input.tools).map_err(|_|"codex_invalid_tools")?;
 let pin=tauri::async_runtime::spawn_blocking(move||{let _approval=APPROVAL.lock().map_err(|_|"codex_approval_unavailable")?;use std::io::Read;let (mut pin,program_root)=crate::codex_program::pin(&confirm_exe)?;let mut digest=sha2::Sha256::new();let mut chunk=[0u8;65536];use sha2::Digest;loop{let n=pin.read(&mut chunk).map_err(|_|"codex_executable_unavailable")?;if n==0{break;}digest.update(&chunk[..n]);}let hash=format!("{:x}",digest.finalize());
 let message=format!("Start official Codex using its existing ChatGPT login?\nExecutable: {}\nSHA256: {}\nArchive project: {}\nModel: {}\nReasoning effort: {}\nService tier: default (no fast tier requested)\nRead tools: {}\n\nSend this exact text:\n{}\n\nCodex account quota applies; UAgent has no price estimate. No project source is automatically attached. Starts in an app-owned workspace with read-only sandbox and no sandbox network; Codex's configured tools may read permitted files. Only listed UAgent read tools are available; each tool result requires separate exact-content approval. Other permission/tool requests are rejected by UAgent. Codex manages its own authentication and thread storage. Cancel interrupts this turn only.",confirm_exe.display(),hash,project,model,effort.as_deref().unwrap_or("server default"),tool_names,prompt);let msg:Vec<u16>=message.encode_utf16().chain(Some(0)).collect();let title:Vec<u16>="UAgent - approve Codex turn".encode_utf16().chain(Some(0)).collect();if confirm_active.cancel.load(Ordering::Acquire)||!confirm_active.document.is_current()||unsafe{MessageBoxW(hwnd,msg.as_ptr(),title.as_ptr(),0x4|0x30|0x100)}!=6||confirm_active.cancel.load(Ordering::Acquire)||!confirm_active.document.is_current(){return Err("codex_declined");}Ok((pin,program_root))}).await.map_err(|_|"codex_confirmation_failed").and_then(|v|v);
 let pin=match pin{Ok(pin)=>pin,Err(e)=>{registry().lock().map_err(|_|"codex_unavailable")?.remove(&request);return Err(e.into());}};
 let p=input.project_id.clone();let s=session.clone();let q=request.clone();let text=input.prompt.clone();let resume=input.session_id.is_some();let member=input.member.clone();let selected_model=input.model.clone();let selected_effort=input.effort.clone();
 let saved=store.with_store_for_grant(document.clone(),true,move|db,_,_|{let prior=db.codex_begin_scoped(&p,&s,&q,&text,now(),resume,member.as_ref().map(|m|(m.run_id.as_str(),m.member_id.as_str())))?;db.codex_record_selection(&p,&s,&q,&selected_model,selected_effort.as_deref(),now())?;Ok(prior)}).await;
 let previous=match saved{Ok(v)=>v,Err(_)=>{registry().lock().map_err(|_|"codex_unavailable")?.remove(&request);return Err("codex_store_unavailable_or_previous_uncertain".into());}};
 let initial=active.view.lock().map_err(|_|"codex_unavailable")?.clone();
 tauri::async_runtime::spawn(async move{
 let worker=active.clone();let remember_app=app.clone();let remember_document=document.clone();let rp=input.project_id.clone();let rs=session.clone();let rq=request.clone();
 let result=tauri::async_runtime::spawn_blocking(move||{let (_pin,program_root)=pin;
 let wait_until=std::time::Instant::now()+std::time::Duration::from_secs(30);
 while !worker.dispatch.load(Ordering::Acquire){if worker.cancel.load(Ordering::Acquire)||!worker.document.is_current()||std::time::Instant::now()>=wait_until{return Err("codex_dispatch_not_authorized".into());}std::thread::sleep(std::time::Duration::from_millis(25));}
 program_root.check_current().map_err(|_|"codex_program_changed")?;std::fs::create_dir_all(&scratch).map_err(|_|"codex_workspace_unavailable")?;
 codex_bridge::run(&exe,&scratch,&input.model,&input.prompt,previous.as_deref(),&worker.cancel,||worker.document.is_current()&&!root.is_revoked(),&worker.view,move|thread|{let thread=thread.to_string();let p=rp.clone();let s=rs.clone();let q=rq.clone();tauri::async_runtime::block_on(remember_app.state::<ManagedRunStoreState>().with_store_for_grant(remember_document.clone(),true,move|db,_,_|db.codex_remember(&p,&s,&q,&thread))).map_err(|_|"codex_thread_link_not_saved".into())},&input.tools,input.effort.as_deref())}).await.map_err(|_|"codex_worker_failed".to_string()).and_then(|r|r);
 let known=result.is_ok();let snapshot={let mut v=active.view.lock().unwrap();if let Err(e)=result{v.status="uncertain".into();v.error=Some(e);}v.clone()};let p=input.project_id;let s=session;let q=request;let status=snapshot.status;let text=snapshot.text;
 let saved=app.state::<ManagedRunStoreState>().with_store_for_grant(document,true,move|db,_,_|db.codex_finish(&p,&s,&q,&text,known,&status,now())).await.is_ok();let mut v=active.view.lock().unwrap();v.persisted=saved;if !saved{v.error=Some("codex_result_persistence_uncertain".into());}
 });Ok(initial)
}
fn own(window:&tauri::WebviewWindow,store:&ManagedRunStoreState,input:&Selected)->Result<Arc<Active>,String>{let doc=store.capture_window_grant(window).map_err(|_|"codex_document_required")?;let value=registry().lock().map_err(|_|"codex_unavailable")?.get(&input.request_id).cloned().ok_or("codex_request_missing")?;if value.project!=input.project_id||!value.document.same_document(&doc){return Err("codex_request_owner_mismatch".into());}Ok(value)}
#[tauri::command]pub(crate) fn poll_codex_turn(window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>,input:Selected)->Result<View,String>{let active=own(&window,&store,&input)?;let result=active.view.lock().map_err(|_|"codex_unavailable")?.clone();Ok(result)}
#[tauri::command]pub(crate) fn cancel_codex_turn(window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>,input:Selected)->Result<(),String>{own(&window,&store,&input)?.cancel.store(true,Ordering::Release);Ok(())}

#[tauri::command]pub(crate) fn dispatch_codex_turn(window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>,input:Selected)->Result<(),String>{let a=own(&window,&store,&input)?;if a.cancel.load(Ordering::Acquire)||a.view.lock().map_err(|_|"codex_unavailable")?.status!="preparing"{return Err("codex_dispatch_stale".into());}a.dispatch.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire).map_err(|_|"codex_dispatch_consumed")?;Ok(())}

#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct ToolResultInput{project_id:String,request_id:String,call_id:String,text:String}
#[tauri::command]pub(crate) async fn approve_codex_tool_result(window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>,input:ToolResultInput)->Result<(),String>{
 let a=own(&window,&store,&Selected{project_id:input.project_id.clone(),request_id:input.request_id.clone()})?;
 if input.text.len()>16000||input.text.contains('\0'){return Err("codex_tool_result_too_large".into());}
 let pending={let v=a.view.lock().map_err(|_|"codex_unavailable")?;if v.error.is_some()||v.persisted||v.tool_reply.is_some(){return Err("codex_tool_stale".into());}v.pending_tool.clone().filter(|t|t.call_id==input.call_id).ok_or("codex_tool_stale")?};
 let hwnd=window.hwnd().map_err(|_|"codex_window")?.0 as isize;
 tauri::async_runtime::spawn_blocking(move||{
 let _approval=APPROVAL.lock().map_err(|_|"codex_approval_unavailable")?;
 if a.cancel.load(Ordering::Acquire)||!a.document.is_current(){return Err("codex_tool_cancelled");}
 let message=format!("Send this exact project tool result to official Codex?\nProject: {}\nTool: {}\nCall: {}\nArguments: {}\n\n{}\n\nCodex account quota applies; cost is unknown. This is project content sent to Codex, not a local-only display.",input.project_id,pending.name,pending.call_id,pending.arguments,input.text);
 let msg:Vec<u16>=message.encode_utf16().chain(Some(0)).collect();let title:Vec<u16>="UAgent - approve project content to Codex".encode_utf16().chain(Some(0)).collect();
 if unsafe{MessageBoxW(hwnd,msg.as_ptr(),title.as_ptr(),0x4|0x30|0x100)}!=6{a.cancel.store(true,Ordering::Release);return Err("codex_tool_declined");}
 let mut v=a.view.lock().map_err(|_|"codex_unavailable")?;
 if a.cancel.load(Ordering::Acquire)||!a.document.is_current()||v.error.is_some()||v.persisted||v.tool_reply.is_some()||v.pending_tool.as_ref().map(|t|t.call_id.as_str())!=Some(input.call_id.as_str()){return Err("codex_tool_stale");}
 let success=serde_json::from_str::<serde_json::Value>(&input.text).map(|value|value["status"]=="completed").unwrap_or(false);
 v.tool_reply=Some(serde_json::json!({"contentItems":[{"type":"inputText","text":input.text}],"success":success}));Ok(())
 }).await.map_err(|_|"codex_confirmation_failed".to_string())?.map_err(str::to_string)
}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct ToolDispatch{project_id:String,request_id:String,call_id:String}
#[tauri::command]pub(crate) fn dispatch_codex_tool_result(window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>,input:ToolDispatch)->Result<(),String>{
 let a=own(&window,&store,&Selected{project_id:input.project_id,request_id:input.request_id})?;let mut v=a.view.lock().map_err(|_|"codex_unavailable")?;
 if a.cancel.load(Ordering::Acquire)||!a.document.is_current()||v.error.is_some()||v.persisted||v.tool_reply.is_none()||v.tool_released||v.pending_tool.as_ref().map(|t|t.call_id.as_str())!=Some(input.call_id.as_str()){return Err("codex_tool_stale".into());}
 v.tool_released=true;Ok(())
}

#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub(crate) struct CatalogInput{executable:String}
static CATALOG:Mutex<()>=Mutex::new(());
#[tauri::command]pub(crate) async fn list_codex_models(app:tauri::AppHandle,window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>,input:CatalogInput)->Result<Vec<codex_bridge::CatalogModel>,String>{
 let doc=store.capture_window_grant(&window).map_err(|_|"codex_document_required")?;let exe=crate::codex_program::resolve(std::path::Path::new(&input.executable))?;
 let hwnd=window.hwnd().map_err(|_|"codex_window")?.0 as isize;
 let cwd=crate::app_profile::resolve_app_data_dir(&app)?.join("codex-workspaces/catalog");
 tauri::async_runtime::spawn_blocking(move||{let _serial=CATALOG.lock().map_err(|_|"codex_catalog_unavailable")?;if !doc.is_current(){return Err("codex_document_closed".into());}let (mut pin,program_root)=crate::codex_program::pin(&exe)?;
 {use std::io::Read;use sha2::Digest;let mut digest=sha2::Sha256::new();let mut chunk=[0u8;65536];loop{let n=pin.read(&mut chunk).map_err(|_|"codex_executable_unavailable")?;if n==0{break;}digest.update(&chunk[..n]);}let _approval=APPROVAL.lock().map_err(|_|"codex_approval_unavailable")?;
 let message=format!("Start this Codex app-server to read its model catalog?\nExecutable: {}\nSHA256: {:x}\n\nUAgent will initialize and request model/list only. No model turn or project content will be sent. Codex manages its own local configuration.",exe.display(),digest.finalize());let msg:Vec<u16>=message.encode_utf16().chain(Some(0)).collect();let title:Vec<u16>="UAgent - Codex model catalog".encode_utf16().chain(Some(0)).collect();if !doc.is_current()||unsafe{MessageBoxW(hwnd,msg.as_ptr(),title.as_ptr(),0x4|0x30|0x100)}!=6||!doc.is_current(){return Err("codex_catalog_declined".into());}}
 std::fs::create_dir_all(&cwd).map_err(|_|"codex_workspace_unavailable")?;program_root.check_current().map_err(|_|"codex_program_changed")?;codex_bridge::list_models(&exe,&cwd,||doc.is_current())}).await.map_err(|_|"codex_catalog_failed".to_string())?
}
#[derive(Deserialize)]#[serde(rename_all="camelCase",deny_unknown_fields)]pub(crate) struct PreferenceInput{project_id:String,slot:String,selection:Option<crate::local_run_store::codex_sessions::ModelPreference>}
fn preference_scope(i:&PreferenceInput)->Result<(),String>{if !["conversation","lead","investigator","reviewer","member_3","member_4"].contains(&i.slot.as_str()){return Err("codex_preference_slot".into());}crate::resolve_trusted_root_handle_by_id(&i.project_id).map_err(|_|"codex_project_required")?;Ok(())}
#[tauri::command]pub(crate) async fn read_codex_model_preference(window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>,input:PreferenceInput)->Result<Option<crate::local_run_store::codex_sessions::ModelPreference>,String>{preference_scope(&input)?;store.with_store(&window,true,move|db,_,_|db.codex_model_preference(&input.project_id,&input.slot)).await.map_err(|_|"codex_preferences_unavailable".into())}
#[tauri::command]pub(crate) async fn save_codex_model_preference(window:tauri::WebviewWindow,store:tauri::State<'_,ManagedRunStoreState>,input:PreferenceInput)->Result<(),String>{preference_scope(&input)?;let value=input.selection.ok_or("codex_preference_missing")?;if value.executable.len()>2000||!PathBuf::from(&value.executable).is_absolute()||value.model.is_empty()||value.model.len()>100||value.effort.is_empty()||value.effort.len()>64{return Err("codex_preference_invalid".into());}store.with_store(&window,true,move|db,_,_|db.save_codex_model_preference(&input.project_id,&input.slot,&value)).await.map_err(|_|"codex_preferences_unavailable".into())}
