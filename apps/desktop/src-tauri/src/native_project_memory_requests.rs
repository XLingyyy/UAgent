//! Strict C memory DTOs on the existing native Responses records, no transport.
use super::*;
use crate::managed_run_store::ManagedRunStoreState;
use crate::local_run_store::project_memory::{MemoryExecution,MemoryDispatchScope,MemoryDispatchSelection};
use tauri::Manager;

// Actual preflight/SQLite/Store-release/one-shot permit validated with synthetic
// documents and mock transport (t07-positive-memory-pipeline-20261105-r1).
// Existing live-profile, read/share and per-request approval gates remain required.
pub(super) const LIVE_MEMORY_DISPATCH_VALIDATED:bool=true;
const MAX_MEMORY_BATCHES:usize=8;

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct MemorySelectedInput {pub id:String,pub revision:i64}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct MemorySelectionInput {
    pub schema_version:u32,pub run_handle:String,pub selected:Vec<MemorySelectedInput>,
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct MemoryPrepareInput {
    pub schema_version:u32,pub run_handle:String,pub body:String,pub memory_batch_id:String,
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct MemoryActionInput {
    pub schema_version:u32,pub run_handle:String,pub request_id:String,
    pub memory_batch_id:String,pub body_sha256:String,
}
fn required_nullable<'de,D:serde::Deserializer<'de>>(d:D)->std::result::Result<Option<String>,D::Error> {
    Option::<String>::deserialize(d)
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct MemoryCancelInput {
    pub schema_version:u32,pub run_handle:String,
    #[serde(deserialize_with="required_nullable")]
    pub batch_id:Option<String>,
    #[serde(deserialize_with="required_nullable")]
    pub request_id:Option<String>,
}
#[derive(Deserialize)]
#[serde(untagged)]
pub(crate) enum PrepareCommandInput {Memory(MemoryPrepareInput),Legacy(PrepareInput)}
#[derive(Deserialize)]
#[serde(untagged)]
pub(crate) enum ActionCommandInput {Memory(MemoryActionInput),Legacy(RequestInput)}
#[derive(Serialize)]
#[serde(untagged)]
pub(crate) enum PrepareCommandReply {Memory(MemoryPreparedReply),Legacy(PrepareResult)}
#[derive(Serialize)]
#[serde(untagged)]
pub(crate) enum ActionCommandReply {Memory(MemoryActionReply),Legacy(())}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct MemoryOwner {
    run_handle:String,run_id:String,project_id:String,project_epoch:u64,provider_id:String,model_id:String,
}
fn owner(handle:&str,run:&Run)->MemoryOwner {
    let value=&run.scope.owner;
    MemoryOwner{run_handle:handle.into(),run_id:value.run_id.clone(),project_id:value.project_id.clone(),
        project_epoch:value.project_epoch,provider_id:value.provider_id.clone(),model_id:value.model_id.clone()}
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct MemorySelectionReply {schema_version:u32,owner:MemoryOwner,expires_at:u64,batch:MemoryBatchReceipt}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct MemoryPreparedReply {
    schema_version:u32,owner:MemoryOwner,expires_at:u64,batch_id:String,
    request_id:String,endpoint:String,body:String,body_sha256:String,
}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct MemoryActionReply {
    schema_version:u32,owner:MemoryOwner,batch_id:Option<String>,request_id:Option<String>,
    action:&'static str,dispatch_status:&'static str,terminal:bool,reason:Option<&'static str>,
}
pub(super) struct MemoryBatchRecord {
    run:Arc<Run>,batch:Arc<MemoryBatch>,deadline:u64,expires_at:u64,preparing:AtomicBool,
}
fn hex(bytes:&[u8])->String {bytes.iter().map(|b|format!("{b:02x}")).collect()}
fn schema(value:u32)->Result<()> {if value==1{Ok(())}else{Err(failure("memory_schema_invalid"))}}
fn valid_id(value:&str)->bool {!value.is_empty()&&value.len()<=256&&!value.chars().any(char::is_control)}
fn expiry(run:&Run,deadline:u64,ceiling:u64)->Result<u64> {
    let remaining=deadline.checked_sub(run.profile.clock.now_ms()).filter(|v|*v>0).ok_or_else(||failure("native_scope_expired"))?;
    let wall=scope_authority::wall_now()?.checked_add(remaining).ok_or_else(||failure("native_scope_expired"))?;
    Ok(wall.min(ceiling))
}
fn registered(state:&Broker,handle:&str,run:&Arc<Run>)->bool {
    state.runs.get(handle).is_some_and(|saved|Arc::ptr_eq(saved,run))
        &&state.profiles.get(&run.profile.id).is_some_and(|saved|Arc::ptr_eq(saved,&run.profile))
        &&state.windows.get(&run.profile.window)==Some(&(run.profile.window_generation,false))
        &&!state.updating.contains(&run.scope.owner.provider_id)
        &&run.alive.load(Ordering::Acquire)&&run.profile.alive.load(Ordering::Acquire)
        &&run.profile.clock.now_ms()<run.deadline&&run.profile.clock.now_ms()<run.profile.expires_at
        &&run.project_registration.as_ref().is_some_and(|project|project.matches(state))
        &&run.memory_scope.as_ref().is_some_and(|scope|scope.check_liveness().is_ok())
}
struct SelectionReservation {handle:String,identity:Arc<()>}
impl SelectionReservation {
    fn take(handle:&str,run:&Arc<Run>)->Result<Self> {
        let mut state=lock(broker())?;
        if !registered(&state,handle,run)||state.memory_preparing.contains_key(handle)
            ||state.memory_batches.len()>=MAX_MEMORY_BATCHES
            ||state.memory_batches.values().any(|record|Arc::ptr_eq(&record.run,run))
            ||state.requests.values().any(|request|Arc::ptr_eq(&request.run,run)) {
            return Err(failure("native_responses_request_busy"));
        }
        let identity=Arc::new(());
        state.memory_preparing.insert(handle.into(),identity.clone());
        Ok(Self{handle:handle.into(),identity})
    }
    fn current(&self,state:&Broker)->bool {
        state.memory_preparing.get(&self.handle).is_some_and(|saved|Arc::ptr_eq(saved,&self.identity))
    }
}
impl Drop for SelectionReservation {
    fn drop(&mut self) {
        if let Ok(mut state)=lock(broker()) {
            if self.current(&state){state.memory_preparing.remove(&self.handle);}
        }
    }
}
pub(super) async fn select(window:tauri::WebviewWindow,input:MemorySelectionInput)->Result<MemorySelectionReply> {
    schema(input.schema_version)?;
    if input.selected.is_empty()||input.selected.len()>256
        ||input.selected.iter().any(|v|!valid_id(&v.id)||v.revision<1||v.revision>9_007_199_254_740_991) {
        return Err(failure("memory_selection_invalid"));
    }
    let handle=input.run_handle.clone();let label=window.label().to_string();
    let (run,scope,reservation)=worker(move||{
        let run=run_owned(&handle,&label)?;
        if run.chat.is_some()||run.native_host.is_none(){return Err(failure("memory_native_run_required"));}
        let scope=run.memory_scope.clone().ok_or_else(||failure("native_scope_revoked"))?;
        scope.check_current().map_err(failure)?;
        let reservation=SelectionReservation::take(&handle,&run)?;
        Ok((run,scope,reservation))
    }).await?;
    let store=window.app_handle().try_state::<ManagedRunStoreState>().ok_or_else(||failure("native_store_unavailable"))?;
    let selected=input.selected;let original_scope=scope.clone();
    let rows=store.with_store(&window,false,move|store,cancelled,deadline|{
        let execution=MemoryExecution::new(cancelled,deadline);
        let scope=MemoryDispatchScope{project_id:original_scope.project_id(),
            read_prefixes:original_scope.read_prefixes(),share_prefixes:original_scope.share_prefixes(),
            max_context_bytes:original_scope.max_context_bytes()};
        let selected:Vec<_>=selected.iter().map(|v|MemoryDispatchSelection{id:&v.id,revision:v.revision}).collect();
        store.project_memory_dispatch_snapshot(&execution,&scope,&selected)
    }).await.map_err(|_|failure("memory_selection_unavailable"))?;
    worker(move||{
        run.current()?;
        let batch=MemoryBatch::capture(scope.clone(),rows).map_err(failure)?;
        let deadline=run.deadline.min(scope.deadline_ms()).min(run.profile.expires_at);
        let expires_at=expiry(&run,deadline,scope.wall_ceiling())?;
        let result=MemorySelectionReply{schema_version:1,owner:owner(&input.run_handle,&run),
            expires_at,batch:batch.receipt()};
        let record=Arc::new(MemoryBatchRecord{run:run.clone(),batch:batch.clone(),deadline,expires_at,preparing:AtomicBool::new(false)});
        let mut state=lock(broker())?;
        if !reservation.current(&state)||!registered(&state,&input.run_handle,&run)
            ||state.memory_batches.len()>=MAX_MEMORY_BATCHES {
            return Err(failure("native_scope_revoked"));
        }
        state.memory_batches.insert(batch.id().into(),record);
        drop(state);drop(reservation);
        Ok(result)
    }).await
}
pub(super) async fn prepare(window:tauri::WebviewWindow,input:MemoryPrepareInput)->Result<MemoryPreparedReply> {
    schema(input.schema_version)?;
    if input.body.is_empty()||input.body.len()>1_048_576{return Err(failure("memory_body_invalid"));}
    let label=window.label().to_string();
    worker(move||{
        let run=run_owned(&input.run_handle,&label)?;
        let record={
            let state=lock(broker())?;
            let record=state.memory_batches.get(&input.memory_batch_id).cloned().ok_or_else(||failure("memory_batch_stale"))?;
            if !Arc::ptr_eq(&record.run,&run)||!registered(&state,&input.run_handle,&run)
                ||run.profile.clock.now_ms()>=record.deadline||state.requests.len()>=MAX_REQUESTS
                ||state.requests.values().any(|request|Arc::ptr_eq(&request.run,&run))
                ||record.preparing.swap(true,Ordering::AcqRel) {
                return Err(failure("memory_batch_replayed"));
            }
            record
        };
        record.batch.reobserve_sources().map_err(failure)?;
        let deadline=request_deadline(run.profile.clock.now_ms(),run.deadline,run.profile.expires_at)?.min(record.deadline);
        let lease=run.session.capture_lease(deadline).map_err(|e|failure(e.code()))?;
        let mut prepared=run.session.prepare(&lease,&run.profile.snapshot.config.base_url,input.body.into_bytes(),run.checker.as_ref())
            .map_err(|e|failure(e.code()))?;
        let bound=record.batch.bind_responses(prepared.body_arc().clone()).map_err(failure)?;
        prepared.attach_memory(bound).map_err(|e|failure(e.code()))?;
        run.current()?;
        let id=token()?;
        let result=MemoryPreparedReply{schema_version:1,owner:owner(&input.run_handle,&run),
            expires_at:expiry(&run,deadline,record.expires_at)?,batch_id:record.batch.id().into(),request_id:id.clone(),
            endpoint:prepared.binding().endpoint.clone(),body:String::from_utf8(prepared.body_arc().to_vec()).map_err(|_|failure("memory_body_invalid"))?,
            body_sha256:hex(&prepared.binding().body_sha256)};
        let request=Arc::new(Request{window:label,run:run.clone(),prepared:Arc::new(prepared),lease,
            approval:Mutex::new(None),started:AtomicBool::new(false),response:Arc::new(Mutex::new(ResponseState{
                dispatch_status:"notDispatched".into(),..Default::default()
            }))});
        let mut state=lock(broker())?;
        if !registered(&state,&input.run_handle,&run)||state.requests.len()>=MAX_REQUESTS
            ||state.requests.values().any(|request|Arc::ptr_eq(&request.run,&run))
            ||!state.memory_batches.get(&input.memory_batch_id).is_some_and(|saved|Arc::ptr_eq(saved,&record)) {
            drop(state);let _=request.lease.revoke();return Err(failure("native_scope_revoked"));
        }
        state.requests.insert(id,request);Ok(result)
    }).await
}
pub(super) fn action_request(window:&str,input:&MemoryActionInput)->Result<Arc<Request>> {
    schema(input.schema_version)?;
    let run=run_owned(&input.run_handle,window)?;
    let request=request_owned(&input.request_id,window)?;
    let binding=request.prepared.memory_binding().ok_or_else(||failure("memory_request_required"))?;
    if !Arc::ptr_eq(&request.run,&run)||binding.batch().id()!=input.memory_batch_id
        ||hex(&request.prepared.binding().body_sha256)!=input.body_sha256
        ||!run.memory_scope.as_ref().is_some_and(|scope|Arc::ptr_eq(scope,binding.batch().grant())) {
        return Err(failure("memory_request_binding_changed"));
    }
    Ok(request)
}
pub(super) fn action_reply(input:&MemoryActionInput,request:&Arc<Request>,action:&'static str)->MemoryActionReply {
    MemoryActionReply{schema_version:1,owner:owner(&input.run_handle,&request.run),
        batch_id:Some(input.memory_batch_id.clone()),request_id:Some(input.request_id.clone()),
        action,dispatch_status:if action=="scheduled"{"mayHaveBeenSent"}else{"notDispatched"},
        terminal:false,reason:None}
}
pub(super) fn cancel(window:&str,input:MemoryCancelInput)->Result<MemoryActionReply> {
    schema(input.schema_version)?;
    let (run,requests,batches)={
        let mut state=lock(broker())?;
        let run=state.runs.get(&input.run_handle).cloned().ok_or_else(||failure("native_responses_run_unavailable"))?;
        if run.profile.window!=window||run.memory_scope.is_none(){return Err(failure("memory_native_run_required"));}
        if input.batch_id.as_ref().and_then(|id|state.memory_batches.get(id)).is_some_and(|record|!Arc::ptr_eq(&record.run,&run))
            ||input.request_id.as_ref().and_then(|id|state.requests.get(id)).is_some_and(|request|!Arc::ptr_eq(&request.run,&run)) {
            return Err(failure("memory_request_binding_changed"));
        }
        // Permanent original-run tombstone BEFORE replying. This does no SQL/vault work.
        run.alive.store(false,Ordering::Release);
        if let Some(scope)=&run.memory_scope{scope.revoke();}
        state.memory_preparing.remove(&input.run_handle);
        let requests=state.requests.values().filter(|r|Arc::ptr_eq(&r.run,&run)).cloned().collect::<Vec<_>>();
        let ids=state.memory_batches.iter().filter(|(_,b)|Arc::ptr_eq(&b.run,&run)).map(|(id,_)|id.clone()).collect::<Vec<_>>();
        let batches=ids.into_iter().filter_map(|id|state.memory_batches.remove(&id)).collect::<Vec<_>>();
        (run,requests,batches)
    };
    run.session.revoke_all().map_err(|e|failure(e.code()))?;
    if let Some(host)=&run.native_host{host.revoke();}
    for request in &requests{request.prepared.cancel().map_err(|e|failure(e.code()))?;}
    let exact_sent=input.request_id.as_ref().and_then(|id|requests.iter().find(|r|{
        let state=lock(broker()).ok();
        state.as_ref().is_some_and(|s|s.requests.get(id).is_some_and(|current|Arc::ptr_eq(current,r)))
    })).is_some_and(|r|r.prepared.status()==DispatchStatus::Sent);
    let any_l=run.memory_admitted.load(Ordering::Acquire)||requests.iter().any(|r|r.prepared.status()!=DispatchStatus::NotDispatched);
    let status=if exact_sent{"sent"}else if any_l{"mayHaveBeenSent"}else{"notDispatched"};
    let result=MemoryActionReply{schema_version:1,owner:owner(&input.run_handle,&run),batch_id:input.batch_id,
        request_id:input.request_id,action:"cancelled",dispatch_status:status,terminal:true,reason:Some("cancelled")};
    drop(batches);Ok(result)
}
pub(super) fn purge_for_run(run:&Run) {
    let removed={
        let Ok(mut state)=lock(broker()) else{return;};
        let ids=state.memory_batches.iter().filter(|(_,b)|std::ptr::eq(b.run.as_ref(),run)).map(|(id,_)|id.clone()).collect::<Vec<_>>();
        ids.into_iter().filter_map(|id|state.memory_batches.remove(&id)).collect::<Vec<_>>()
    };
    drop(removed);
}
pub(super) fn release(request_id:&str,request:&Arc<Request>)->Result<()> {
    request.prepared.cancel().map_err(|e|failure(e.code()))?;
    if request.prepared.status()!=DispatchStatus::NotDispatched{request.run.memory_admitted.store(true,Ordering::Release);}
    let (record,original)={
        let mut state=lock(broker())?;
        if !state.requests.get(request_id).is_some_and(|current|Arc::ptr_eq(current,request)){
            return Err(failure("native_responses_request_unavailable"));
        }
        let batch_id=request.prepared.memory_binding().ok_or_else(||failure("memory_request_required"))?.batch().id();
        let record=state.memory_batches.remove(batch_id);
        let original=state.requests.remove(request_id);
        (record,original)
    };
    drop(record);drop(original);Ok(())
}
