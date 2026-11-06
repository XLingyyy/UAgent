//! Goal-derived source proposals. Model preparation is read-only; a completed task
//! may hand one exact proposal to a separately approved, native source transaction.
use super::*;
use crate::{ue_build_repair::{RepairSession, RepairBinding, SourceTaskRef, NativeRepairPreview, NativeRepairGrant},
    ue_build_repair_io::hash, runtime_host_service as host,
    local_run_store::{self as store, effect_reconciliation as effect}};

pub(super) struct Proposal {
    session: RepairSession,
    preview: NativeRepairPreview,
    expires: Instant,
}
#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct Replacement { path:String, old_text:String, new_text:String }
#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct Arguments { edits:Vec<Replacement> }

pub(super) fn definition()->Value {
    json!({"name":"project_propose_source_change",
        "description":"Prepare one source-change proposal without writing files. First read every file in full. Use one unique, exact oldText substring per file and its newText replacement, preserving surrounding content and line endings. The native host derives the full-file diff. Only existing Source .cpp/.h/.hpp/.Build.cs files are supported. At most 8 files and 4096 total resulting file bytes. No truncated or redacted source. This replaces any earlier proposal. Actual writing requires a separate diff review and native approval after this task finishes. Never claim the proposal was applied or compiled.",
        "parameters":{"type":"object","properties":{"edits":{"type":"array","minItems":1,"maxItems":8,
            "items":{"type":"object","properties":{"path":{"type":"string"},"oldText":{"type":"string","description":"Nonempty exact substring occurring once in the fully read file, including whitespace."},"newText":{"type":"string","description":"Replacement text for that substring only."}},
                "required":["path","oldText","newText"],"additionalProperties":false}}},"required":["edits"],"additionalProperties":false}})
}
pub(super) fn prepare(task:&Arc<Task>,call:&Value)->Result<Value> {
    let args:Arguments=serde_json::from_str(call["arguments"].as_str().ok_or("source_proposal_invalid")?)
        .map_err(|_|"source_proposal_invalid")?;
    if args.edits.is_empty()||args.edits.len()>8
        ||args.edits.iter().map(|r|r.old_text.len()+r.new_text.len()).sum::<usize>()>8192
        ||args.edits.iter().map(|r|r.new_text.len()).sum::<usize>()>4096 {
        return Err("source_proposal_limit");
    }
    let reads=task.reads.lock().map_err(|_|"host_task_unavailable")?;
    if args.edits.iter().any(|edit|!reads.has_complete_source(&edit.path)) {
        return Err("source_proposal_requires_complete_read");
    }
    let binding=RepairBinding{host_session_id:task.scope_id.clone(),project_id:task.project.clone(),
        root_object_id:task.root.identity().observation_key(),run_id:task.run.clone(),
        profile_fingerprint:hash(&serde_json::to_vec(&task.scope).map_err(|_|"source_proposal_invalid")?)};
    let origin=SourceTaskRef{run_id:task.run.clone(),scope_id:task.scope_id.clone(),plan_version:task.plan_version.load(Ordering::Acquire) as u32};
    let mut session=RepairSession::from_verified_task(task.root.as_ref().clone(),binding,origin,
        args.edits.iter().map(|r|r.path.clone()).collect()).map_err(|_|"source_proposal_scope_denied")?;
    let snapshot=session.read_snapshots(&task.scope_id).map_err(|_|"source_proposal_source_changed")?;
    let mut replacements=Vec::new();
    for edit in args.edits {
        let source=snapshot.files.iter().find(|f|f.path==edit.path).ok_or("source_proposal_scope_denied")?;
        if !reads.matches_complete_source(&edit.path,&source.content)? { return Err("source_proposal_requires_complete_read"); }
        replacements.push((edit.path,replace_unique(&source.content,&edit.old_text,&edit.new_text)?));
    }
    if replacements.iter().map(|(_,text)|text.len()).sum::<usize>()>4096 {return Err("source_proposal_limit");}
    let preview=session.prepare_replacements(&task.scope_id,&snapshot.snapshot_id,hash(id()?.as_bytes()),replacements)
        .map_err(|_|"source_proposal_invalid_change")?;
    task.current()?;
    let result=json!({"callId":call["id"],"toolId":"project.propose_source_change","status":"completed","effectState":"not_started",
        "output":{"proposalId":preview.preview.preview_id,"planDigest":preview.native_plan_digest,
            "paths":preview.preview.files.iter().map(|f|&f.path).collect::<Vec<_>>(),"state":"awaiting_separate_review_and_approval","applied":false},
        "sources":[],"truncated":false});
    *task.source_change.lock().map_err(|_|"host_task_unavailable")?=Some(Proposal{session,preview,expires:Instant::now()+Duration::from_secs(600)});
    Ok(result)
}
fn replace_unique(source:&str,old:&str,new:&str)->Result<String> {
    if old.is_empty()||source.find(old).is_none()||source.find(old)!=source.rfind(old) {
        return Err("source_proposal_match_not_unique");
    }
    Ok(source.replacen(old,new,1))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn source_patch_preserves_crlf_and_changes_only_the_unique_match() {
        assert_eq!(replace_unique("header\r\n    return BasValue + 2;\r\nfooter\r\n","BasValue","BaseValue").unwrap(),
            "header\r\n    return BaseValue + 2;\r\nfooter\r\n");
    }
    #[test] fn source_patch_rejects_missing_empty_and_overlapping_matches() {
        for (source,old) in [("text",""),("text","missing"),("same same","same"),("aaa","aa")] {
            assert_eq!(replace_unique(source,old,"new").unwrap_err(),"source_proposal_match_not_unique");
        }
    }
}
#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct Selection { run_id:String }
#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct Approval { run_id:String, digest:String }
fn task_for_view(app:&tauri::AppHandle,window:&tauri::WebviewWindow,run:&str)->std::result::Result<Arc<Task>,String> {
    app.state::<ManagedRunStoreState>().capture_window_grant(window).map_err(|_|"source_change_document_required")?;
    let service=app.state::<HostedTasks>().inner.lock().map_err(|_|"host_task_unavailable")?.clone().ok_or("host_task_not_found")?;
    service.task(run).map_err(str::to_string)
}
#[tauri::command]
pub(crate) fn hosted_source_change(app:tauri::AppHandle,window:tauri::WebviewWindow,input:Selection)->std::result::Result<Value,String> {
    let task=task_for_view(&app,&window,&input.run_id)?;
    let proposal=task.source_change.lock().map_err(|_|"host_task_unavailable")?;
    let receipt=task.source_receipt.lock().map_err(|_|"host_task_unavailable")?;
    Ok(json!({"preview":proposal.as_ref().filter(|p|Instant::now()<p.expires).map(|p|&p.preview),"receipt":*receipt}))
}
fn error(code:&str)->store::StoreError {store::StoreError{kind:code.into(),message:"native source change did not complete this stage".into()}}
fn now()->i64 {SystemTime::now().duration_since(UNIX_EPOCH).map(|v|v.as_millis() as i64).unwrap_or(0)}
struct Observer(Arc<AtomicBool>);
impl host::ReadOnlyExecutionObserver for Observer {
    fn observe(&self,_:&host::NativeExecutionIdentity,_:Instant)->host::ExecutionObservation {
        if self.0.load(Ordering::Acquire){host::ExecutionObservation::Quiescent}else{host::ExecutionObservation::Unknown}
    }
}
struct Disconnect {host:RuntimeHostService,label:String,owner:OwnerRef}
impl Drop for Disconnect {fn drop(&mut self){let _=self.host.disconnect(&self.label,&self.owner);}}
#[tauri::command]
pub(crate) async fn approve_hosted_source_change(app:tauri::AppHandle,window:tauri::WebviewWindow,input:Approval)->std::result::Result<Value,String> {
    let task=task_for_view(&app,&window,&input.run_id)?;
    let state=app.state::<ManagedRunStoreState>();
    let document=state.capture_window_grant(&window).map_err(|_|"source_change_document_required")?;
    let service=app.state::<HostedTasks>().inner.lock().map_err(|_|"host_task_unavailable")?.clone().ok_or("host_task_not_found")?;
    let run=id()?;
    let grant=state.capture_task_grant(&window,&task.project,&run).map_err(|_|"source_change_document_required")?;
    let hwnd=window.hwnd().map_err(|_|"source_change_window_required")?.0 as isize;
    let worker_task=task.clone();
    let consumed=Arc::new(AtomicBool::new(false));let worker_consumed=consumed.clone();
    let result=tauri::async_runtime::spawn_blocking(move||->std::result::Result<Value,String>{
        let snapshot=service.client.request(HostCommand::Snapshot,json!({"runId":task.run}),Duration::from_secs(10))?;
        if snapshot["run"]["status"]!="completed"||snapshot["settled"]!=true
            ||!task.terminal.load(Ordering::Acquire)||task.active.load(Ordering::Acquire)!=0 {return Err("source_change_task_not_completed".into());}
        let mut proposal={
            let mut slot=task.source_change.lock().map_err(|_|"host_task_unavailable")?;
            if !slot.as_ref().is_some_and(|p|p.preview.native_plan_digest==input.digest&&Instant::now()<p.expires) {
                return Err("source_change_preview_changed".into());
            }
            slot.take().ok_or("source_change_preview_changed")?
        };
        worker_consumed.store(true,Ordering::Release);
        task.root.check_current().map_err(|_|"source_change_root_changed")?;
        let current_root=crate::resolve_trusted_root_handle_by_id(&task.project)?;
        if !Arc::ptr_eq(&current_root,&task.root)||!document.is_current(){return Err("source_change_root_changed".into());}
        let preview=proposal.preview.clone();
        let changes=preview.preview.files.iter().map(|f|f.path.as_str()).collect::<Vec<_>>().join("\n");
        let text=format!("Apply this exact goal-derived source proposal once?\nProject: {}\nTask: {}\nPlan: {}\n\nReviewed files:\n{}\n\nBefore-images will be saved before writing. Files must still match the preview. No automatic build, retry or rollback.",task.root.path_hint().display(),task.run,preview.native_plan_digest,changes);
        let text:Vec<u16>=text.encode_utf16().chain(Some(0)).collect();
        let title:Vec<u16>="UAgent - approve source changes".encode_utf16().chain(Some(0)).collect();
        if unsafe{MessageBoxW(hwnd as *mut _,text.as_ptr(),title.as_ptr(),0x134)}!=6{return Err("source_change_declined".into());}
        if !document.is_current()||Instant::now()>=proposal.expires{return Err("source_change_approval_expired".into());}
        let host=app.state::<RuntimeHostService>().inner().clone();let catalog=task.catalog.clone();
        let conversation=id()?;let operation=id()?;let label=format!("host-source:{run}");
        let identity=OwnerIdentity{scope_id:preview.preview.preview_id.clone(),run_id:run.clone(),project_id:task.project.clone(),
            root_ref:task.root.identity().observation_key(),conversation_id:conversation.clone(),provider_id:"native-source-change".into(),model_id:"none".into()};
        let owner=host.connect(&label,identity.clone())?.owner;
        let _disconnect=Disconnect{host:host.clone(),label:label.clone(),owner:owner.clone()};
        let stopped=Arc::new(AtomicBool::new(false));
        let resources=host::NativeResourceBinding::from_verified_root(task.root.clone(),vec![host::ResourceClaim{kind:host::ResourceKind::FileWrite,key:identity.root_ref.clone()}])?;
        let mut registration=host.register_source_operation_pending(&label,host::NativeOperationInput{owner:owner.clone(),job_id:operation.clone(),step_id:"source-change".into(),
            queue_timeout_ms:15000,execution_timeout_ms:15000,resources,observer:Arc::new(Observer(stopped.clone()))},&identity,&catalog)?;
        let ticket=registration.identity().ticket.clone();let native=registration.identity();
        let intent=effect::EffectIntent{key:effect::EffectKey{project_id:task.project.clone(),operation_id:operation.clone()},
            owner:effect::OperationOwner{scope_id:identity.scope_id.clone(),run_id:run.clone(),project_id:task.project.clone(),root_ref:identity.root_ref.clone(),conversation_id:conversation.clone(),
                provider_id:identity.provider_id.clone(),model_id:"none".into(),step_id:"source-change".into(),execution_id:native.execution_id.clone(),host_generation:native.ticket.host_generation.clone()},
            root_object_id:identity.root_ref.clone(),adapter:effect::AdapterIdentity{id:"native.source-change.v1".into(),version:1},idempotency_key:format!("{operation}{operation}"),
            approved_plan_digest:preview.native_plan_digest.clone(),plan_summary:format!("Reviewed source change from task {}",task.run),
            targets:preview.preview.files.iter().map(|f|effect::EffectTarget{kind:effect::TargetKind::File,locator:f.path.clone(),before_digest:Some(f.before_hash.clone()),after_digest:Some(f.after_hash.clone())}).collect(),
            resources:vec![effect::ResourceClaim{kind:effect::ResourceKind::FileWrite,key:identity.root_ref.clone()}],created_at:now()};
        let project=task.project.clone();let output_run=run.clone();let db_run=run.clone();let root=task.root.clone();let host_session=task.scope_id.clone();
        let task_host=host.clone();let task_catalog=catalog.clone();let native_grant=grant.clone();
        let parent=task.conversation.clone();
        let receipt=tauri::async_runtime::block_on(app.state::<ManagedRunStoreState>().with_store_for_task(grant,&project,&run,true,move|db,cancelled,deadline|{
            let current=||native_grant.accepts(&intent.key.project_id,&db_run)&&!cancelled.load(Ordering::Acquire)&&Instant::now()<deadline&&Instant::now()<proposal.expires;
            if !current(){return Err(error("source_change_cancelled"));}
            root.check_current().map_err(|_|error("source_change_root_changed"))?;
            db.create_session(&store::Session{project_id:intent.key.project_id.clone(),id:conversation.clone(),title:"Reviewed source change".into(),created_at:now(),archived:false,parent_id:Some(parent),origin:store::Origin::Native})?;
            db.start_run(&intent.key.project_id,&store::NewRun{id:db_run.clone(),session_id:conversation,goal:intent.plan_summary.clone(),created_at:now()})?;
            let context=effect::CurrentRun::from_verified_host(&root,intent.owner.clone(),&current)?;
            let journal=db.open_effect_journal()?;journal.prepare(&context,&intent)?;
            let mut dispatch=journal.mark_may_have_been_sent(&context,&intent.key,1,now())?;
            let handoff=registration.claim_ue_once(&journal,&context,&mut dispatch,&task_catalog,deadline)?;
            registration.check_started_ue_operation(&intent).map_err(error)?;
            let host_cancel=registration.cancellation();let expires=proposal.expires;
            let approval_store=native_grant.clone();let approval_project=intent.key.project_id.clone();let approval_run=intent.owner.run_id.clone();
            let mut approval=NativeRepairGrant::from_verified_host_approval(&preview,15000).map_err(|_|error("source_change_grant_failed"))?
                .with_liveness(Arc::new(move||approval_store.accepts(&approval_project,&approval_run)&&!host_cancel.load(Ordering::Acquire)&&Instant::now()<deadline&&Instant::now()<expires&&task_host.heartbeat(&label,&owner).is_ok()));
            let mut backup=crate::ue_build_repair_result::StoreRepairJournal::new(db,&intent);
            let receipt=proposal.session.apply_approved(&host_session,&preview.preview.preview_id,&mut approval,&mut backup,cancelled).map_err(|_|error("source_change_result_unknown"))?;
            stopped.store(true,Ordering::Release);let _=registration.finish(receipt.status=="applied");
            let proof=journal.settle_owned_operation(handoff)?;
            crate::ue_build_repair_result::persist(db,&root,&intent,&preview,&receipt,backup.checkpoint_written,&task_catalog,&proof)?;
            serde_json::to_value(receipt).map_err(|_|error("source_change_result_invalid"))
        })).map_err(|_|"source_change_apply_or_persistence_unknown")?;
        let settled=host.reconcile(&ticket).map(|j|j.phase==host::JobPhase::Finished).unwrap_or(false);
        Ok(json!({"receipt":receipt,"historyRunId":output_run,"persisted":true,"hostSettled":settled,"buildValidated":false}))
    }).await.map_err(|_|"source_change_worker_unconfirmed".to_string())?;
    let summary=match &result{Ok(value)=>value.clone(),Err(code)=>json!({"error":code,"retryAvailable":false})};
    if consumed.load(Ordering::Acquire) { *worker_task.source_receipt.lock().map_err(|_|"host_task_unavailable")?=Some(summary); }
    result
}
