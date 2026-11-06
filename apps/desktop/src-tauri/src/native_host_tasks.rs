//! Application-owned investigation tasks. Views observe/control existing tasks;
//! only a new native confirmation can create a task's read/share/model authority.
#![cfg(windows)]
use crate::{managed_run_store::{ManagedRunStoreState, NativeStoreTaskGrant},
    native_host_model::TaskModel, native_host_reads::HostedReads,
    native_provider_transport::{Owner, SourceChecker, SourceSnapshot, SourcePhase, SourceCheckFailure, HostedChatTransport},
    runtime_sidecar::{RuntimeSidecar, RuntimeSidecarClient, HostCommand},
    runtime_host_service::{RuntimeHostService, OwnerIdentity, OwnerRef, ModelJobInput},
    runtime_host_recovery_catalog::PersistentRecoveryCatalog,
    local_run_store::native_run_creation::NativeRunCreation,
    trusted_root_handle::TrustedRootHandle};
use serde_json::{json, Value};
use std::{collections::HashMap, sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, AtomicUsize, Ordering}, mpsc},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH}};
use tauri::Manager;
type Result<T> = std::result::Result<T, &'static str>;

#[derive(Default)]
pub(crate) struct HostedTasks { inner: Mutex<Option<Arc<Service>>> }
struct Service {
    sidecar: Mutex<Option<RuntimeSidecar>>,
    client: RuntimeSidecarClient,
    tasks: Mutex<HashMap<String, Arc<Task>>>,
    closing: AtomicBool,
}
struct Task {
    project: String, run: String, conversation: String, scope_id: String,
    goal: String, scope: Value, draft: Value,
    grant: Arc<NativeStoreTaskGrant>, model: Arc<TaskModel>, root: Arc<TrustedRootHandle>,
    reads: Mutex<HostedReads>, checker: Arc<dyn SourceChecker>,
    creation: OnceLock<Arc<NativeRunCreation>>, alive: Arc<AtomicBool>,
    host: RuntimeHostService, owner: OwnerRef, identity: OwnerIdentity, label: String,
    catalog: Arc<PersistentRecoveryCatalog>, model_count: AtomicUsize, tool_count: AtomicUsize,
    active: AtomicUsize, terminal: AtomicBool, expiry_requested: AtomicBool, request_ids: Mutex<std::collections::HashSet<u64>>,
}
impl Task {
    fn current(&self) -> Result<()> {
        if !self.alive.load(Ordering::Acquire) { return Err("host_task_revoked"); }
        self.model.check_current()?;
        self.root.check_current().map_err(|_|"host_task_root_changed")
    }
    fn cancel(&self) { self.model.revoke(); }
    fn release_if_finished(&self) {
        if self.terminal.load(Ordering::Acquire) && self.active.load(Ordering::Acquire)==0 {
            self.alive.store(false,Ordering::Release);
            self.model.revoke();
            if let Ok(mut reads)=self.reads.lock() { reads.release(); }
            if let Some(creation)=self.creation.get() { creation.invalidate_for_owner(&self.alive); }
            let _=self.host.disconnect(&self.label,&self.owner);
        }
    }
}
impl Drop for Task { fn drop(&mut self) {
    self.terminal.store(true,Ordering::Release); self.release_if_finished();
} }
struct TaskChecker { model: Arc<TaskModel>, source: Arc<dyn SourceChecker> }
impl SourceChecker for TaskChecker {
    fn check(&self, snapshot:&SourceSnapshot, phase:SourcePhase)->std::result::Result<SourceSnapshot,SourceCheckFailure> {
        self.model.check_current().map_err(|_|SourceCheckFailure)?;
        self.source.check(snapshot,phase)
    }
}

impl HostedTasks {
    fn service(&self, app:&tauri::AppHandle) -> Result<Arc<Service>> {
        let mut inner=self.inner.lock().map_err(|_|"host_task_unavailable")?;
        if let Some(service)=inner.as_ref() {return Ok(service.clone());}
        let (send,events)=mpsc::sync_channel(64);
        let sidecar=RuntimeSidecar::start_bundled(app,send)?;
        let service=Arc::new(Service {client:sidecar.client(),sidecar:Mutex::new(Some(sidecar)),
            tasks:Mutex::new(HashMap::new()),closing:AtomicBool::new(false)});
        let weak=Arc::downgrade(&service); let app=app.clone();
        std::thread::Builder::new().name("host-task-broker".into()).spawn(move || {
            while let Ok(event)=events.recv_timeout(Duration::from_secs(1)).or_else(|error|match error {
                mpsc::RecvTimeoutError::Timeout=>Ok(Value::Null),other=>Err(other),
            }) {
                let Some(service)=weak.upgrade() else {break;};
                if event.is_null() {
                    if let Ok(tasks)=service.tasks.lock() {for task in tasks.values() {
                        if !task.terminal.load(Ordering::Acquire) {
                            if task.model.remaining_ms()==0 && !task.expiry_requested.swap(true,Ordering::AcqRel) {
                                task.cancel();
                                let task=task.clone();let client=service.client.clone();
                                let _=std::thread::Builder::new().name("host-task-expiry".into()).spawn(move||{
                                    if client.request(HostCommand::Cancel,json!({"runId":task.run}),Duration::from_secs(15)).is_ok(){
                                        task.terminal.store(true,Ordering::Release);task.release_if_finished();
                                    }
                                });
                            }
                            // This only keeps the original owner observable; it cannot renew a task deadline.
                            let _=task.host.heartbeat(&task.label,&task.owner);
                        }
                    }}
                    continue;
                }
                service.event(&app,event);
            }
            if let Some(service)=weak.upgrade() {if let Ok(tasks)=service.tasks.lock(){for task in tasks.values(){
                task.cancel();task.terminal.store(true,Ordering::Release);task.release_if_finished();
            }}}
        }).map_err(|_|"host_task_worker_unavailable")?;
        *inner=Some(service.clone()); Ok(service)
    }
    pub(crate) fn shutdown(&self) {
        let service=self.inner.lock().ok().and_then(|mut inner|inner.take());
        if let Some(service)=service {
            service.closing.store(true,Ordering::Release);
            if let Ok(tasks)=service.tasks.lock(){for task in tasks.values(){task.cancel();}}
            // Store and broker remain alive while the child records the interruption.
            let _=service.client.request(HostCommand::Shutdown,json!({}),Duration::from_secs(25));
            if let Ok(mut owner)=service.sidecar.lock(){owner.take();}
        }
    }
}
impl Service {
    fn task(&self, run:&str)->Result<Arc<Task>> {
        self.tasks.lock().map_err(|_|"host_task_unavailable")?.get(run).cloned().ok_or("host_task_not_found")
    }
    fn event(self:&Arc<Self>,app:&tauri::AppHandle,event:Value) {
        let Some(run)=event["runId"].as_str() else {return;};
        let Ok(task)=self.task(run) else {return;};
        match event["kind"].as_str() {
            Some("broker_cancel")=>task.cancel(),
            Some("settled"|"run_error")=>{
                if event["snapshot"]["run"]["status"]!="paused" {
                    task.terminal.store(true,Ordering::Release);task.release_if_finished();
                }
            },
            Some("broker_request")=>{
                let Some(id)=event["id"].as_u64() else {return;};
                // One coordinator issues operations sequentially. Cancellation can race a final store commit.
                let accepted=task.request_ids.lock().map(|mut ids|ids.len()<2&&ids.insert(id)).unwrap_or(false);
                if !accepted {let _=self.client.broker_reply(id,false,json!("host_task_busy"));return;}
                task.active.fetch_add(1,Ordering::AcqRel);
                let app=app.clone();let client=self.client.clone();let worker_task=task.clone();
                let spawned=std::thread::Builder::new().name("host-task-operation".into()).spawn(move || {
                    let result=broker(&app,&worker_task,event["method"].as_str().unwrap_or(""),event["input"].clone());
                    let (ok,value)=match result {Ok(value)=>(true,value),Err(code)=>(false,json!(code))};
                    let _=client.broker_reply(id,ok,value);
                    if let Ok(mut ids)=worker_task.request_ids.lock(){ids.remove(&id);}
                    worker_task.active.fetch_sub(1,Ordering::AcqRel);worker_task.release_if_finished();
                });
                if spawned.is_err() {
                    if let Ok(mut ids)=task.request_ids.lock(){ids.remove(&id);}
                    task.active.fetch_sub(1,Ordering::AcqRel);
                    let _=self.client.broker_reply(id,false,json!("host_task_worker_unavailable"));
                }
            },_=>{},
        }
    }
}
fn broker(app:&tauri::AppHandle,task:&Arc<Task>,method:&str,input:Value)->Result<Value> {
    let state=app.state::<ManagedRunStoreState>();
    match method {
        "store.commit"=>{
            if input["sessionId"]!=task.conversation {return Err("host_task_store_binding");}
            let value=tauri::async_runtime::block_on(crate::run_store_commands::commit_hosted_run_store(&state,task.grant.clone(),
                serde_json::from_value(input).map_err(|_|"host_task_store_invalid")?)).map_err(|_|"host_task_store_failed")?;
            if task.creation.get().is_none() {
                let document=task.grant.native_document().clone();let project=task.project.clone();let run=task.run.clone();
                let creation=tauri::async_runtime::block_on(state.with_store_for_task(task.grant.clone(),&task.project,&task.run,true,move|store,_,_|{
                    store.ensure_memory_effect_journal()?;
                    let row=store.run(&project,&run)?;let database=store.pin_runtime_host_database()?;
                    let creation=crate::local_run_store::native_run_creation::original_native_run_creation(&project,&run,&document,&database)?;
                    creation.matches_original_row(&database,&row)?;Ok(creation)
                })).map_err(|_|"host_task_native_creation_required")?;
                creation.bind_native_run(task.grant.native_document(),task.alive.clone(),Instant::now()+Duration::from_millis(task.model.remaining_ms()),
                    &task.identity.provider_id,&task.identity.model_id).map_err(|_|"host_task_native_creation_required")?;
                task.creation.set(creation).map_err(|_|"host_task_already_bound")?;
            }
            serde_json::to_value(value).map_err(|_|"host_task_store_invalid")
        },
        "store.snapshot"=>{
            let value=tauri::async_runtime::block_on(crate::run_store_commands::snapshot_hosted_run_store(&state,task.grant.clone(),
                serde_json::from_value(input).map_err(|_|"host_task_store_invalid")?)).map_err(|_|"host_task_store_failed")?;
            serde_json::to_value(value).map_err(|_|"host_task_store_invalid")
        },
        "context.validate"=>{task.current()?;Ok(json!(task.reads.lock().map_err(|_|"host_task_unavailable")?.validate_sources(&input)?))},
        "tool.execute"=>{
            let result=(||{
                task.current()?;
                if task.tool_count.fetch_add(1,Ordering::AcqRel)>=8 {return Err("host_task_tool_limit");}
                task.reads.lock().map_err(|_|"host_task_unavailable")?.execute(&input,8192)
            })();
            // Every tool exposed here is read-only. Record a denied/failed read as
            // such, so history does not retain a falsely in-flight write effect.
            Ok(match result {Ok(value)=>value,Err(code)=>json!({"callId":input["id"],"toolId":"project.read_file",
                "status":if code=="host_read_unavailable"{"failed"}else{"blocked"},"effectState":"not_started",
                "output":null,"sources":[],"truncated":false,"diagnosticCode":code})})
        },
        "provider.complete"=>send_model(app,task,input),
        _=>Err("host_task_method_denied"),
    }
}
fn send_model(app:&tauri::AppHandle,task:&Arc<Task>,input:Value)->Result<Value> {
    task.current()?;
    let request=&input["request"];
    if request["providerId"]!=task.identity.provider_id || request["modelId"]!=task.identity.model_id
        || request["metadata"]["runId"]!=task.run || request["metadata"]["scopeRef"]!=task.scope_id
        || task.model_count.fetch_add(1,Ordering::AcqRel)>=4 {return Err("host_task_model_binding");}
    let request_id=request["id"].as_str().filter(|id|!id.is_empty()&&id.len()<=128).ok_or("host_task_model_binding")?;
    let body=input["body"].as_str().ok_or("host_task_model_body")?.as_bytes().to_vec();
    let session=task.model.session();let remaining=task.model.remaining_ms();
    let lease=session.capture_lease(task.model.deadline_ms()).map_err(|e|e.code())?;
    let prepared=Arc::new(session.prepare_chat_completions(&lease,"https://api.deepseek.com",body,task.checker.as_ref()).map_err(|e|e.code())?);
    let approval=session.approve(&prepared,&lease,task.checker.as_ref()).map_err(|e|e.code())?;
    let creation=task.creation.get().ok_or("host_task_native_creation_required")?.clone();
    let execution=task.host.register_memory_model_pending(&task.label,ModelJobInput{owner:task.owner.clone(),job_id:request_id.into(),
        step_id:"host-investigation-model".into(),queue_timeout_ms:remaining,execution_timeout_ms:remaining},task.root.clone(),
        &task.identity,&task.catalog,creation.clone(),task.alive.clone())?;
    let mut transport=HostedChatTransport::new(vec![json!({"type":"function","function":crate::native_host_reads::definition()})]);
    let (preflight,original_transport)=session.task_preflight(prepared,lease,approval,execution,task.root.clone(),creation,task.alive.clone(),task.checker.clone(),&mut transport).map_err(|e|e.code())?;
    let original=session.clone();let catalog=task.catalog.clone();let state=app.state::<ManagedRunStoreState>();
    let ready=tauri::async_runtime::block_on(state.with_native_task_admission(task.grant.clone(),&task.project,&task.run,move|store,cancelled,deadline|{
        original.verify_task_on_store(preflight,store,&crate::local_run_store::project_memory::MemoryExecution::new(cancelled,deadline),&catalog)
    })).map_err(|_|"host_task_model_admission_failed")?;
    let result=ready.send(original_transport);
    if let Some(error)=result.error {return Err(error.code());}
    let mut reply:Value=serde_json::from_slice(result.response.ok_or("host_task_model_reply_missing")?.bytes()).map_err(|_|"host_task_model_reply_invalid")?;
    reply["requestId"]=json!(request_id);reply["providerId"]=json!(task.identity.provider_id);reply["modelId"]=json!(task.identity.model_id);
    reply["createdAt"]=json!(SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"host_task_clock")?.as_millis() as u64);
    Ok(reply)
}

#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct StartInput { profile_id:String, project_id:String, conversation_id:String, goal:String,
    read_prefixes:Vec<String>, share_prefixes:Vec<String> }
fn id()->Result<String> { let mut bytes=[0u8;16];getrandom::getrandom(&mut bytes).map_err(|_|"host_task_unavailable")?;
    Ok(bytes.iter().map(|byte|format!("{byte:02x}")).collect()) }
fn valid_id(value:&str)->bool { !value.is_empty()&&value.len()<=128&&value.bytes().all(|c|c.is_ascii_alphanumeric()||matches!(c,b'-'|b'_')) }
fn validate_start(input:&StartInput)->Result<()> {
    let native_project=input.project_id.strip_prefix("root:").is_some_and(|hex|!hex.is_empty()&&hex.len()<=16&&hex.bytes().all(|c|c.is_ascii_hexdigit()));
    if !native_project||!valid_id(&input.conversation_id)||input.goal.trim().is_empty()||input.goal.len()>4096
        ||input.goal.chars().any(|c|c=='\0'||matches!(c,'\u{202a}'..='\u{202e}'|'\u{2066}'..='\u{2069}'))
        ||!crate::native_host_reads::valid_prefixes(&input.read_prefixes)||!crate::native_host_reads::valid_prefixes(&input.share_prefixes) {
        return Err("host_task_input_invalid");
    } Ok(())
}
#[link(name="user32")]
extern "system" {fn MessageBoxW(window:*mut std::ffi::c_void,text:*const u16,title:*const u16,flags:u32)->i32;}
fn confirm(window:isize,input:&StartInput)->Result<()> {
    let paths=|values:&[String]|values.iter().map(|v|if v.is_empty(){"(whole project)"}else{v.as_str()}).collect::<Vec<_>>().join(", ");
    let text=format!("Project: {}\nGoal: {}\n\nRead: {}\nShare with DeepSeek: {}\n\nRead-only file investigation. Up to 4 model requests, 8 file reads, 2 minutes.\nThe task continues while this view reloads. Cancel or exit the app to stop.\n\nStart this task?",
        input.project_id,input.goal.chars().take(240).collect::<String>(),paths(&input.read_prefixes),paths(&input.share_prefixes));
    let text:Vec<u16>=text.encode_utf16().chain(Some(0)).collect();let title:Vec<u16>="UAgent - Background investigation".encode_utf16().chain(Some(0)).collect();
    if unsafe{MessageBoxW(window as *mut _,text.as_ptr(),title.as_ptr(),0x134)}!=6 {return Err("host_task_confirmation_declined");} Ok(())
}
#[tauri::command]
pub(crate) async fn start_hosted_task(app:tauri::AppHandle,window:tauri::WebviewWindow,input:StartInput)->std::result::Result<Value,String> {
    validate_start(&input).map_err(str::to_string)?;
    if crate::app_profile::get_application_profile()?.offline_demo {return Err("host_task_live_mode_required".into());}
    let state=app.state::<ManagedRunStoreState>();let document=state.capture_window_grant(&window).map_err(|_|"host_task_document_revoked")?;
    let root=crate::resolve_trusted_root_handle_by_id(&input.project_id)?;
    let run=format!("run-{}",id()?);let scope_id=format!("scope-{}",id()?);
    let grant=state.capture_task_grant(&window,&input.project_id,&run).map_err(|_|"host_task_document_revoked")?;
    let label=window.label().to_owned();let hwnd=window.hwnd().map_err(|_|"host_task_window_unavailable")?.0 as isize;
    tauri::async_runtime::spawn_blocking(move||->Result<Value>{
        confirm(hwnd,&input)?;
        if !document.is_current(){return Err("host_task_document_revoked");}
        root.check_current().map_err(|_|"host_task_root_changed")?;
        let service=app.state::<HostedTasks>().service(&app)?;
        if service.closing.load(Ordering::Acquire)||service.tasks.lock().map_err(|_|"host_task_unavailable")?.len()>=32 {return Err("host_task_capacity");}
        let owner=Owner{project:input.project_id.clone(),epoch:1,run:run.clone(),conversation:input.conversation_id.clone(),provider:"deepseek".into(),model:"deepseek-flash".into()};
        let model=crate::native_host_model::capture(&input.profile_id,&label,&document,grant.clone(),owner,120_000)?;
        let reads=HostedReads::start(input.project_id.clone(),root.clone(),input.read_prefixes.clone(),input.share_prefixes.clone(),model.session())?;
        let checker=Arc::new(TaskChecker{model:model.clone(),source:reads.checker()});
        let host=app.state::<RuntimeHostService>().inner().clone();
        let identity=OwnerIdentity{scope_id:scope_id.clone(),project_id:input.project_id.clone(),run_id:run.clone(),conversation_id:input.conversation_id.clone(),
            root_ref:root.identity().observation_key(),provider_id:"deepseek".into(),model_id:"deepseek-flash".into()};
        let native_label=format!("host-task:{run}");let owner=host.connect(&native_label,identity.clone())?.owner;
        let now=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_|"host_task_clock")?.as_millis() as u64;
        let scope=json!({"id":scope_id,"runId":run,"projectId":input.project_id,"conversationId":input.conversation_id,"rootRef":identity.root_ref,
            "providerId":"deepseek","modelId":"deepseek-flash","endpoint":"https://api.deepseek.com","mode":"read_only",
            "readPrefixes":input.read_prefixes,"sharePrefixes":input.share_prefixes,"toolIds":["project.read_file"],
            "limits":{"maxToolCalls":8,"maxModelRequests":4,"maxDurationMs":120000,"maxAttemptsPerFailure":1,"maxToolResultBytes":8192,"maxContextBytes":24000},"expiresAt":now+model.remaining_ms()});
        let draft=json!({"taskMode":"investigation","investigationScopeId":scope_id,"conversationId":input.conversation_id,"input":input.goal,"projectId":input.project_id,
            "permissionMode":"request_approval","providerId":"deepseek","modelId":"deepseek-flash","reasoningEffort":"none","runMode":"local","branch":null,"contextPercent":null,"createdAt":now});
        let task=Arc::new(Task{project:input.project_id,run:run.clone(),conversation:input.conversation_id,scope_id,goal:input.goal,scope:scope.clone(),draft:draft.clone(),
            grant,model,root,reads:Mutex::new(reads),checker,creation:OnceLock::new(),alive:Arc::new(AtomicBool::new(true)),host,owner,identity,label:native_label,
            catalog:app.state::<Arc<PersistentRecoveryCatalog>>().inner().clone(),model_count:AtomicUsize::new(0),tool_count:AtomicUsize::new(0),
            active:AtomicUsize::new(0),terminal:AtomicBool::new(false),expiry_requested:AtomicBool::new(false),request_ids:Mutex::new(std::collections::HashSet::new())});
        service.tasks.lock().map_err(|_|"host_task_unavailable")?.insert(run.clone(),task.clone());
        let result=service.client.request(HostCommand::Start,json!({"taskId":run,"draft":draft,"scope":scope,"tools":[crate::native_host_reads::definition()]}),Duration::from_secs(10));
        if result.is_err(){task.cancel();task.terminal.store(true,Ordering::Release);task.release_if_finished();}
        result
    }).await.map_err(|_|"host_task_start_unconfirmed".to_string())?.map_err(str::to_string)
}
#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct ControlInput {run_id:String,action:String}
#[tauri::command]
pub(crate) async fn control_hosted_task(app:tauri::AppHandle,window:tauri::WebviewWindow,input:ControlInput)->std::result::Result<Value,String> {
    app.state::<ManagedRunStoreState>().capture_window_grant(&window).map_err(|_|"host_task_document_revoked")?;
    let service=app.state::<HostedTasks>().inner.lock().map_err(|_|"host_task_unavailable")?.clone().ok_or("host_task_not_found")?;
    let task=service.task(&input.run_id)?;
    let command=match input.action.as_str(){"snapshot"=>HostCommand::Snapshot,"pause"=>HostCommand::Pause,"cancel"=>{task.cancel();HostCommand::Cancel},
        "resume"=>{task.current()?;HostCommand::Resume},_=>return Err("host_task_action_invalid".into())};
    tauri::async_runtime::spawn_blocking(move||{
        let result=service.client.request(command,json!({"runId":input.run_id}),Duration::from_secs(15));
        if input.action=="cancel"&&result.is_ok(){task.terminal.store(true,Ordering::Release);task.release_if_finished();}
        result
    })
        .await.map_err(|_|"host_task_control_unconfirmed".to_string())?.map_err(str::to_string)
}
#[tauri::command]
pub(crate) fn list_hosted_tasks(app:tauri::AppHandle,window:tauri::WebviewWindow)->std::result::Result<Value,String> {
    app.state::<ManagedRunStoreState>().capture_window_grant(&window).map_err(|_|"host_task_document_revoked")?;
    let service=app.state::<HostedTasks>().inner.lock().map_err(|_|"host_task_unavailable")?.clone();
    let Some(service)=service else{return Ok(json!([]));};
    let tasks=service.tasks.lock().map_err(|_|"host_task_unavailable")?;
    Ok(json!(tasks.values().map(|task|json!({"runId":task.run,"projectId":task.project,"goal":task.goal,"scope":task.scope,"draft":task.draft,
        "terminal":task.terminal.load(Ordering::Acquire)})).collect::<Vec<_>>()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn hosted_task_accepts_native_root_ids_and_rejects_path_aliases() {
        let mut input=StartInput{profile_id:"opaque".into(),project_id:"root:a1b2".into(),conversation_id:"conversation-1".into(),
            goal:"Read Source/Main.cpp".into(),read_prefixes:vec!["Source".into()],share_prefixes:vec!["Source".into()]};
        validate_start(&input).unwrap();
        input.project_id="E:/project".into();assert!(validate_start(&input).is_err());
        input.project_id="root:a1b2".into();input.share_prefixes=vec!["Source/../Config".into()];assert!(validate_start(&input).is_err());
    }
}
