//! The SAME existing Responses sender, with a private original native host handoff.
use super::*;
use tauri::Manager;
use crate::runtime_host_service::{RuntimeHostService,OwnerIdentity,OwnerRef,ModelJobInput,RegisteredExecution};
use crate::runtime_host_recovery_catalog::PersistentRecoveryCatalog;
use crate::managed_run_store::{ManagedRunStoreState,NativeStoreWindowGrant};
use crate::trusted_root_handle::TrustedRootHandle;
use std::{sync::mpsc,time::Duration};

pub(super) struct NativeRunHost {
    host:RuntimeHostService, owner:OwnerRef, expected:OwnerIdentity, window:String,
    root:Arc<TrustedRootHandle>, document:Arc<NativeStoreWindowGrant>,
    catalog:Arc<PersistentRecoveryCatalog>, stop:Mutex<Option<mpsc::SyncSender<()>>>,
    alive:AtomicBool,
    run_alive:OnceLock<Arc<AtomicBool>>,
    creation:Arc<crate::local_run_store::native_run_creation::NativeRunCreation>,
}
impl NativeRunHost {
    pub(super) fn connect(app:&tauri::AppHandle,scope_id:&str,scope:&Arc<NativeMemoryReadShareGrant>,
        owner:&ContinuationOwner,creation:Arc<crate::local_run_store::native_run_creation::NativeRunCreation>)->Result<Arc<Self>> {
        scope.check_authorization_current().map_err(failure)?;
        let host=app.try_state::<RuntimeHostService>().ok_or_else(||failure("native_host_unavailable"))?.inner().clone();
        let catalog=app.try_state::<Arc<PersistentRecoveryCatalog>>().ok_or_else(||failure("native_host_unavailable"))?.inner().clone();
        let expected=OwnerIdentity {scope_id:scope_id.into(),run_id:owner.run_id.clone(),project_id:owner.project_id.clone(),
            root_ref:scope.root_handle().identity().observation_key(),conversation_id:owner.conversation_id.clone(),
            provider_id:owner.provider_id.clone(),model_id:owner.model_id.clone()};
        let connected=host.connect(scope.window(),expected.clone()).map_err(failure)?;
        Ok(Arc::new(Self {host,owner:connected.owner,expected,window:scope.window().into(),root:scope.root_handle().clone(),
            document:scope.document().clone(),catalog,stop:Mutex::new(None),alive:AtomicBool::new(true),run_alive:OnceLock::new(),creation}))
    }
    pub(super) fn start_heartbeat(self:&Arc<Self>,scope:Arc<NativeMemoryReadShareGrant>,run_alive:Arc<AtomicBool>)->Result<()> {
        self.creation.check_original_owner(&run_alive).map_err(|_|failure("memory_native_creation_revoked"))?;
        self.run_alive.set(run_alive.clone()).map_err(|_|failure("native_host_already_started"))?;
        let (send,receive)=mpsc::sync_channel(1);
        let mut stop=lock(&self.stop)?;
        if stop.is_some(){return Err(failure("native_host_already_started"));}
        *stop=Some(send);
        let weak=Arc::downgrade(self);
        std::thread::Builder::new().name("memory-run-owner".into()).stack_size(256*1024).spawn(move||{
            loop {
                if !matches!(receive.recv_timeout(Duration::from_secs(1)),Err(mpsc::RecvTimeoutError::Timeout)){break;}
                let Some(host)=weak.upgrade() else {break;};
                if !run_alive.load(Ordering::Acquire)||!host.alive.load(Ordering::Acquire)
                    ||scope.check_liveness().is_err() {host.revoke();break;}
                // No SQL/root lookup and no extension of the read/share deadline.
                if host.host.heartbeat(scope.window(),&host.owner).is_err(){host.revoke();break;}
            }
        }).map_err(|_|{self.alive.store(false,Ordering::Release);failure("native_host_worker_unavailable")})?;
        Ok(())
    }
    pub(super) fn revoke(&self) {
        self.alive.store(false,Ordering::Release);
        if let Some(alive)=self.run_alive.get(){self.creation.invalidate_for_owner(alive);}
        if let Ok(mut stop)=self.stop.lock(){if let Some(send)=stop.take(){let _=send.try_send(());}}
        let _=self.host.disconnect(&self.window,&self.owner);
    }
    fn register(&self,request_id:&str,run:&Run)->Result<RegisteredExecution> {
        if !self.alive.load(Ordering::Acquire)||!self.document.is_current(){return Err(failure("native_host_revoked"));}
        let remaining=run.deadline.saturating_sub(run.profile.clock.now_ms()).min(600_000);
        if remaining==0{return Err(failure("native_scope_expired"));}
        self.host.register_memory_model_pending(&run.profile.window,ModelJobInput{
            owner:self.owner.clone(),job_id:request_id.into(),step_id:"native-responses".into(),
            queue_timeout_ms:remaining,execution_timeout_ms:remaining,
        },self.root.clone(),&self.expected,&self.catalog,self.creation.clone(),run.alive.clone()).map_err(failure)
    }
}
impl Drop for NativeRunHost {fn drop(&mut self){self.revoke();}}

pub(super) struct MemorySender {
    app:tauri::AppHandle, execution:Option<RegisteredExecution>,
    document:Arc<NativeStoreWindowGrant>, catalog:Arc<PersistentRecoveryCatalog>,
}
impl Drop for MemorySender {
    fn drop(&mut self) {
        // This context never reached private preflight/L if the original thread
        // could not be scheduled or returned before handing it to preflight.
        if let Some(execution)=self.execution.take(){let _=execution.finish_not_started();}
    }
}
pub(super) fn reserve(app:&tauri::AppHandle,request_id:&str,request:&Arc<Request>)->Result<Option<MemorySender>> {
    let Some(binding)=request.prepared.memory_binding() else {return Ok(None);};
    if !super::memory_requests::LIVE_MEMORY_DISPATCH_VALIDATED{return Err(failure("memory_dispatch_fence_required"));}
    let run=&request.run;
    if run.profile.saved_credential.is_some()||run.profile.fixture_root.is_some(){return Err(failure("native_scope_live_profile_required"));}
    let scope=run.memory_scope.as_ref().ok_or_else(||failure("native_scope_revoked"))?;
    if !Arc::ptr_eq(scope,binding.batch().grant()) {return Err(failure("memory_scope_binding_changed"));}
    scope.check_current().map_err(failure)?;
    let host=run.native_host.as_ref().ok_or_else(||failure("native_host_unavailable"))?;
    let execution=host.register(request_id,run)?;
    Ok(Some(MemorySender {app:app.clone(),execution:Some(execution),document:scope.document().clone(),catalog:host.catalog.clone()}))
}
pub(super) fn execute(mut sender:MemorySender,request:&Arc<Request>,approval:ApprovalGrant,
    transport:&mut dyn Transport)->DispatchOutcome {
    let failed=|code|DispatchOutcome{status:request.prepared.status(),error:Some(code),response:None};
    let Some(store)=sender.app.try_state::<ManagedRunStoreState>() else {return failed(FailureCode::Unavailable);};
    let Some(execution)=sender.execution.take() else {return failed(FailureCode::Unavailable);};
    let (preflight,original_transport)=match request.run.session.memory_preflight(request.prepared.clone(),
        request.lease.clone(),approval,execution,request.run.checker.as_ref(),transport) {
        Ok(value)=>value,Err(code)=>return failed(code),
    };
    let session=request.run.session.clone();
    let catalog=sender.catalog.clone();
    let original_document=sender.document.clone();
    // The thread-affine transport stays on this ORIGINAL std sender thread.
    // Only Send preflight data crosses into the existing bounded Store worker.
    let ready=tauri::async_runtime::block_on(store.with_native_memory_admission_for_grant(original_document,
        move|store,cancelled,deadline|{
            let execution=crate::local_run_store::project_memory::MemoryExecution::new(cancelled,deadline);
            session.verify_memory_on_store(preflight,store,&execution,&catalog)
        }));
    match ready {Ok(ready)=>ready.send(original_transport),Err(_)=>failed(FailureCode::Unavailable)}
}
