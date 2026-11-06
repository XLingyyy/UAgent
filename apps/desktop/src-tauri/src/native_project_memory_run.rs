//! Dedicated live memory-run registration; all execution still needs physical final admission.
use super::*;
use crate::managed_run_store::{ManagedRunStoreState,NativeStoreWindowGrant};
use tauri::Manager;

#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct MemoryBindInput {
    pub schema_version:u32,pub profile_id:String,pub project_id:String,pub run_id:String,
    pub conversation_id:String,pub memory_scope_id:String,pub scope_expires_at:u64,
}
pub(super) async fn bind(app:tauri::AppHandle,window:tauri::WebviewWindow,input:MemoryBindInput)->Result<BindResult> {
    if input.schema_version!=1{return Err(failure("memory_schema_invalid"));}
    let label=window.label().to_string();
    let managed=app.try_state::<ManagedRunStoreState>().ok_or_else(||failure("native_store_unavailable"))?;
    let document=managed.capture_window_grant(&window).map_err(|_|failure("native_scope_window_unavailable"))?;
    let id=input.memory_scope_id.clone();let project=input.project_id.clone();
    let run_id=input.run_id.clone();let conversation=input.conversation_id.clone();let current_label=label.clone();
    let scope=worker(move||pending_native_memory_scope(&id,&current_label,&project,&run_id,&conversation)).await?;
    if scope.profile_id()!=input.profile_id||!scope.document().same_document(&document) {
        return Err(failure("native_scope_binding_changed"));
    }
    let project=input.project_id.clone();let run_id=input.run_id.clone();
    let (metadata,database)=managed.with_store(&window,true,move|store,cancelled,deadline|{
        if cancelled.load(Ordering::Acquire)||std::time::Instant::now()>=deadline {
            return Err(crate::local_run_store::StoreError{kind:"cancelled".into(),message:"native run lookup cancelled".into()});
        }
        store.ensure_memory_effect_journal()?;
        Ok((store.run(&project,&run_id)?,store.pin_runtime_host_database()?))
    }).await.map_err(|_|failure("native_responses_run_unavailable"))?;
    if metadata.session_id!=input.conversation_id{return Err(failure("native_scope_binding_changed"));}
    worker(move||register(&app,&label,input,scope,document,metadata,database)).await
}
fn register(app:&tauri::AppHandle,label:&str,input:MemoryBindInput,scope:Arc<NativeMemoryReadShareGrant>,
    document:Arc<NativeStoreWindowGrant>,metadata:crate::local_run_store::Run,
    database:Arc<crate::local_run_store::database_owner::NativeDatabasePin>)->Result<BindResult> {
    let profile=profile_owned(&input.profile_id,label)?;
    if profile.snapshot.config.wire_api!=WireApi::Responses||profile.fixture_root.is_some()||profile.saved_credential.is_some()
        ||!scope.document().same_document(&document)||scope.profile_id()!=profile.id
        ||metadata.project_id!=input.project_id||metadata.id!=input.run_id||metadata.session_id!=input.conversation_id {
        return Err(failure("native_scope_live_profile_required"));
    }
    scope.check_authorization_current().map_err(failure)?;
    let creation=crate::local_run_store::native_run_creation::original_native_run_creation(
        &input.project_id,&input.run_id,scope.document().native_document(),&database)
        .map_err(|_|failure("memory_native_creation_required"))?;
    creation.matches_original_row(&database,&metadata).map_err(|_|failure("memory_native_creation_required"))?;
    let project=capture_project_registration(&input.project_id)?;
    if !Arc::ptr_eq(&project.root,scope.root_handle())||project.generation_number!=scope.project_generation() {
        return Err(failure("native_project_changed"));
    }
    {
        let state=lock(broker())?;
        if state.runs.values().any(|run|Arc::ptr_eq(&run.profile,&profile)&&run.scope.owner.run_id==input.run_id) {
            return Err(failure("memory_native_run_already_bound"));
        }
    }
    let now=scope_authority::wall_now()?;
    let remaining=input.scope_expires_at.checked_sub(now).filter(|v|*v>0&&*v<=PROFILE_TTL)
        .ok_or_else(||failure("native_scope_expired"))?;
    let deadline=profile.clock.now_ms().checked_add(remaining).ok_or_else(||failure("native_scope_expired"))?
        .min(scope.deadline_ms()).min(profile.expires_at);
    let owner=ContinuationOwner{project_id:input.project_id,project_epoch:epoch()?,run_id:input.run_id,
        conversation_id:input.conversation_id,provider_id:profile.snapshot.config.provider_id.clone(),model_id:profile.model_id.clone()};
    let continuation=ContinuationScope{owner:owner.clone(),provider_generation:profile.snapshot.generation.clone(),
        provider_revision:profile.snapshot.revision,configuration_fingerprint:fingerprint(&profile.snapshot,&profile.model_id)?};
    let session=NativeSession::new(Owner{project:owner.project_id.clone(),epoch:owner.project_epoch,run:owner.run_id.clone(),
        conversation:owner.conversation_id.clone(),provider:owner.provider_id.clone(),model:owner.model_id.clone()},
        ConfigVersion{generation:continuation.provider_generation.clone(),revision:continuation.provider_revision as u64},
        [0;32],profile.clock.clone());
    session.install_credential(profile.key.0.clone(),profile.expires_at).map_err(|e|failure(e.code()))?;
    let monitor=NativeSourceMonitor::start(&owner.project_id,session.source_authority()).map_err(failure)?;
    let evidence=monitor.capture_index().map_err(failure)?;
    monitor.set_sources(&[evidence]).map_err(failure)?;
    let host=memory_sender::NativeRunHost::connect(app,&input.memory_scope_id,&scope,&owner,creation.clone())?;
    let run=Arc::new(Run{profile:profile.clone(),scope:continuation,session,project_registration:Some(project),
        memory_scope:Some(scope.clone()),native_host:Some(host.clone()),native_creation:Some(creation.clone()),memory_admitted:AtomicBool::new(false),
        checker:monitor.checker(),monitor:Some(monitor),chat:None,deadline,fixture_sequence:None,alive:Arc::new(AtomicBool::new(true))});
    run.current()?;scope.check_authorization_current().map_err(failure)?;
    let handle=token()?;
    {
        let mut state=lock(broker())?;
        if state.runs.len()>=MAX_RUNS||state.windows.get(label)!=Some(&(profile.window_generation,false))
            ||state.updating.contains(&owner.provider_id)||!profile.alive.load(Ordering::Acquire)
            ||!scope.document().is_current()||scope.check_liveness().is_err()
            ||!run.project_registration.as_ref().is_some_and(|project|project.matches(&state))
            ||!state.profiles.get(&profile.id).is_some_and(|saved|Arc::ptr_eq(saved,&profile))
            ||!state.memory_scopes.get(&input.memory_scope_id).is_some_and(|saved|Arc::ptr_eq(saved,&scope))
            ||state.runs.values().any(|old|Arc::ptr_eq(&old.profile,&profile)&&old.scope.owner.run_id==owner.run_id) {
            drop(state);run.revoke();return Err(failure("native_scope_revoked"));
        }
        state.runs.insert(handle.clone(),run.clone());
    }
    let before=std::time::Instant::now();
    let remaining=deadline.saturating_sub(profile.clock.now_ms());
    let owner_deadline=before+std::time::Duration::from_millis(remaining);
    let attached=creation.bind_native_run(scope.document().native_document(),run.alive.clone(),owner_deadline,
        &owner.provider_id,&owner.model_id).map_err(|_|failure("memory_native_creation_revoked"))
        .and_then(|_|scope.attach_native_run(&run))
        .and_then(|_|host.start_heartbeat(scope.clone(),run.alive.clone()));
    if let Err(error)=attached {
        run.revoke();
        let removed={let mut state=lock(broker())?;state.runs.remove(&handle)};
        drop(removed);return Err(error);
    }
    run.current()?;scope.check_current().map_err(failure)?;
    Ok(BindResult{run_handle:handle,owner})
}
