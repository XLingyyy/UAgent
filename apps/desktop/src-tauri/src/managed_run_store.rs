//! Native bounded Store worker. All legacy connections share its mandatory SQLite gate.
//! Metadata ownership never grants model/tool execution or recovery admission.
#![cfg(windows)]
use crate::local_run_store::{RunStore, StoreError};
use std::{sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc, OnceLock, Mutex, Weak}, time::{Duration, Instant}};

#[path = "managed_store_startup_core.rs"]
mod startup_core;
pub(crate) use startup_core::{NativeManagedStoreOwner, ManagedStoreWork, ReleasedStoreDomain};
use startup_core::{StoreResult, OPERATION_TIMEOUT, unavailable, expired, current};

#[path = "session_request_scope.rs"]
mod session_requests;
pub(crate) use session_requests::SessionRequestRegistration;

struct CancelOnDrop(Arc<AtomicBool>);
impl Drop for CancelOnDrop { fn drop(&mut self) { self.0.store(true, Ordering::Release); } }

/// Original native document grant, never supplied by the renderer. This
/// liveness check is memory-only; no trait callback or window/registry lookup.
pub(crate) struct NativeStoreWindowGrant {
    grant: Arc<WindowGrant>,
    closed: Arc<AtomicBool>,
}
impl NativeStoreWindowGrant {
    pub(crate) fn register_session_request(&self, project:&str, request:&str, flag:Arc<AtomicBool>) -> StoreResult<SessionRequestRegistration> {
        if !self.is_current() { return Err(unavailable()); }
        let registration=self.grant.session_requests.register(project,request,flag).map_err(|_|unavailable())?;
        if !self.is_current() { return Err(unavailable()); }
        Ok(registration)
    }
    pub(crate) fn cancel_session_request(&self, project:&str, request:&str) -> StoreResult<()> {
        if !self.is_current() { return Err(unavailable()); }
        self.grant.session_requests.cancel(project,request).map_err(|_|unavailable())?;
        if !self.is_current() { return Err(unavailable()); }
        Ok(())
    }
    pub(crate) fn native_document(&self)->&Arc<crate::local_run_store::native_run_creation::NativeDocumentIdentity>{&self.grant.native_document}
    pub(crate) fn same_document(&self,other:&Self)->bool {
        Arc::ptr_eq(&self.grant,&other.grant)&&Arc::ptr_eq(&self.closed,&other.closed)
    }
    pub(crate) fn is_current(&self) -> bool {
        self.grant.current() && !self.closed.load(Ordering::Acquire)
            && crate::local_run_store::database_owner::available()
    }
}

#[derive(Default)]
pub(crate) struct ManagedRunStoreState {
    owner: OnceLock<Arc<dyn NativeManagedStoreOwner>>,
    startup_catalog: OnceLock<Arc<crate::runtime_host_recovery_catalog::PersistentRecoveryCatalog>>,
    closed: Arc<AtomicBool>,
    windows: Mutex<std::collections::HashMap<String, Arc<WindowGrant>>>,
}
impl ManagedRunStoreState {
    /// Native setup only; a renderer cannot supply, replace, or deserialize this owner.
    pub(crate) fn install(&self, owner: Arc<dyn NativeManagedStoreOwner>) -> StoreResult<()> {
        if self.closed.load(Ordering::Acquire) || !current(&owner) { return Err(unavailable()); }
        self.owner.set(owner).map_err(|_| unavailable())
    }
    pub(crate) fn close(&self) {
        self.closed.store(true, Ordering::Release);
        if let Ok(mut windows) = self.windows.lock() { for (_, grant) in windows.drain() { grant.revoke(); } }
        crate::local_run_store::database_owner::close();
        if let Some(owner) = self.owner.get() { let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| owner.close())); }
    }
    /// Setup-only, once per owner. Uses the original owner/catalog/closed objects.
    pub(crate) fn schedule_startup_scan(&self,
        catalog: Arc<crate::runtime_host_recovery_catalog::PersistentRecoveryCatalog>) -> StoreResult<()> {
        startup_core::schedule_startup_scan(&self.startup_catalog,&self.owner,&self.closed,catalog)
    }
    pub(crate) async fn with_store<T: Send + 'static>(&self, window: &tauri::WebviewWindow, write: bool,
        work: impl FnOnce(&RunStore, &AtomicBool, Instant) -> StoreResult<T> + Send + 'static) -> StoreResult<T> {
        self.with_store_completion(window,write,work,|value,_released|Ok(value)).await
    }
    pub(crate) async fn with_store_for_grant<T:Send+'static>(&self,document:Arc<NativeStoreWindowGrant>,write:bool,
        work:impl FnOnce(&RunStore,&AtomicBool,Instant)->StoreResult<T>+Send+'static) -> StoreResult<T> {
        if !Arc::ptr_eq(&document.closed,&self.closed) || !document.is_current() { return Err(unavailable()); }
        self.with_original_store_completion(document.grant.clone(),write,work,|value,_|Ok(value)).await
    }
    /// Native-only dedicated completion: ordinary CRUD cannot turn its DTO
    /// reply or temporary CancelOnDrop flag into a network send capability.
    pub(crate) async fn with_native_memory_admission(&self,window:&tauri::WebviewWindow,
        work:impl FnOnce(&RunStore,&AtomicBool,Instant)->StoreResult<crate::native_provider_transport::PendingMemoryPermit>
            +Send+'static,
    )->StoreResult<crate::native_provider_transport::ReadyMemoryPermit>{
        self.with_store_completion(window,true,work,|pending,released|{
            pending.finish_owner_release(released).map_err(|error|StoreError{
                kind:error.code().into(),message:"native memory send completion was revoked".into(),
            })
        }).await
    }
    async fn with_store_completion<T:Send+'static,U:Send+'static>(&self,window:&tauri::WebviewWindow,write:bool,
        work:impl FnOnce(&RunStore,&AtomicBool,Instant)->StoreResult<T>+Send+'static,
        after_release:impl FnOnce(T,&ReleasedStoreDomain)->StoreResult<U>+Send+'static,
    )->StoreResult<U> {
        let grant=self.authorize(window)?;
        self.with_original_store_completion(grant,write,work,after_release).await
    }
    /// Uses the captured native document, never a later same-label webview.
    pub(crate) async fn with_native_memory_admission_for_grant(&self,document:Arc<NativeStoreWindowGrant>,
        work:impl FnOnce(&RunStore,&AtomicBool,Instant)->StoreResult<crate::native_provider_transport::PendingMemoryPermit>
            +Send+'static,
    )->StoreResult<crate::native_provider_transport::ReadyMemoryPermit>{
        if !Arc::ptr_eq(&document.closed,&self.closed) || !document.is_current(){return Err(unavailable());}
        self.with_original_store_completion(document.grant.clone(),true,work,|pending,released|{
            pending.finish_owner_release(released).map_err(|error|StoreError{
                kind:error.code().into(),message:"native memory send completion was revoked".into(),
            })
        }).await
    }
    async fn with_original_store_completion<T:Send+'static,U:Send+'static>(&self,grant:Arc<WindowGrant>,write:bool,
        work:impl FnOnce(&RunStore,&AtomicBool,Instant)->StoreResult<T>+Send+'static,
        after_release:impl FnOnce(T,&ReleasedStoreDomain)->StoreResult<U>+Send+'static,
    )->StoreResult<U>{
        if self.closed.load(Ordering::Acquire) || !grant.current(){return Err(unavailable());}
        let owner=self.owner.get().cloned().ok_or_else(unavailable)?;
        if !current(&owner){return Err(unavailable());}
        let deadline = Instant::now() + OPERATION_TIMEOUT;
        let cancelled = Arc::new(AtomicBool::new(false));
        let _cancel_on_drop = CancelOnDrop(cancelled.clone());
        grant.track(&cancelled)?;
        let (reply, receive) = mpsc::sync_channel(1);
        let rejected = reply.clone();
        let check_owner = owner.clone();
        let check_cancelled = cancelled.clone();
        let check_closed = self.closed.clone();
        let check_grant = grant.clone();
        let finish_owner = owner.clone();
        let finish_cancelled = cancelled.clone();
        let finish_closed = self.closed.clone();
        let finish_grant = grant.clone();
        // The result remains private to this task until run() has released the
        // exact connection and OperationScope on their original worker.
        let result_slot = Arc::new(Mutex::new(None::<StoreResult<T>>));
        let apply_result = result_slot.clone();
        let task = ManagedStoreWork { write, deadline, cancelled: cancelled.clone(),
            apply: Some(Box::new(move |store| {
                let result = if !check_grant.current() || check_closed.load(Ordering::Acquire)
                    || check_cancelled.load(Ordering::Acquire) || Instant::now() >= deadline || !current(&check_owner) {
                    Err(unavailable())
                } else { work(store, &check_cancelled, deadline) };
                if result.as_ref().err().is_some_and(|error| error.kind == "projectMemoryRollback") {
                    crate::local_run_store::database_owner::quarantine();
                }
                if let Ok(mut slot) = apply_result.lock() { *slot = Some(result); }
            })),
            complete: Some(Box::new(move |released| {
                let result = result_slot.lock().ok().and_then(|mut slot| slot.take())
                    .unwrap_or_else(|| Err(unavailable()));
                let result = if !finish_grant.current() || finish_closed.load(Ordering::Acquire)
                    || finish_cancelled.load(Ordering::Acquire) || Instant::now() >= deadline || !current(&finish_owner) {
                    Err(expired(write))
                } else { result.and_then(|value|after_release(value,released)) };
                let result=if !finish_grant.current() || finish_closed.load(Ordering::Acquire)
                    || finish_cancelled.load(Ordering::Acquire) || Instant::now()>=deadline || !current(&finish_owner){
                    Err(expired(write))
                }else{result};
                let _ = reply.send(result);
            })),
            reject: Some(Box::new(move |error| { let _ = rejected.send(Err(error)); })),
        };
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| owner.submit(task)))
            .map_err(|_| unavailable())??;
        let wait = deadline.saturating_duration_since(Instant::now());
        let result = tauri::async_runtime::spawn_blocking(move || receive.recv_timeout(wait).map_err(|_| expired(write)))
            .await.map_err(|_| expired(write))??;
        // A reply can wait in the receiver while the async caller is rescheduled.
        if !grant.current() || self.closed.load(Ordering::Acquire) || cancelled.load(Ordering::Acquire)
            || Instant::now() >= deadline || !current(&owner) { return Err(expired(write)); }
        result
    }
}
const QUEUE_CAPACITY:usize=32;
struct NativeStoreOwner{
    closed:Arc<AtomicBool>,alive:Arc<AtomicBool>,
    send:Mutex<Option<mpsc::SyncSender<ManagedStoreWork>>>,
    _root:Arc<crate::local_run_store::database_owner::RootPins>,
}
struct WorkerAlive(Arc<AtomicBool>);
impl Drop for WorkerAlive{fn drop(&mut self){
    if std::thread::panicking(){crate::local_run_store::database_owner::quarantine();}
    self.0.store(false,Ordering::Release);
}}
impl NativeStoreOwner{
    fn start(root:std::path::PathBuf)->StoreResult<Arc<Self>>{
        let root=Arc::new(crate::local_run_store::database_owner::RootPins::acquire(&root)
            .map_err(|kind|StoreError{kind:kind.into(),message:"native store directory could not be pinned".into()})?);
        let (send,receive)=mpsc::sync_channel::<ManagedStoreWork>(QUEUE_CAPACITY);
        let closed=Arc::new(AtomicBool::new(false));
        let alive=Arc::new(AtomicBool::new(true));
        let worker_closed=closed.clone();let worker_alive=alive.clone();let worker_root=root.clone();
        std::thread::Builder::new().name("uagent-local-store".into()).spawn(move||{
            let _alive=WorkerAlive(worker_alive);
            while !worker_closed.load(Ordering::Acquire)&&crate::local_run_store::database_owner::available(){
                let task=match receive.recv_timeout(Duration::from_millis(100)){
                    Ok(task)=>task,Err(mpsc::RecvTimeoutError::Timeout)=>continue,Err(_)=>break,
                };
                if worker_closed.load(Ordering::Acquire)||task.cancelled.load(Ordering::Acquire)||Instant::now()>=task.deadline{
                    task.reject(unavailable());continue;
                }
                let operation=match crate::local_run_store::database_owner::OperationScope::enter(task.cancelled(),task.deadline()){
                    Ok(scope)=>scope,Err(_)=>{task.reject(unavailable());continue;}
                };
                // Never keep a connection while idle: ordinary settings/archive callers
                // use this same mandatory gate, including reentrant same-thread opens.
                match RunStore::open(&worker_root.root){
                    Ok(store)=>task.run(store,operation),
                    Err(error)=>{drop(operation);task.reject(error);}
                }
            }
            while let Ok(task)=receive.try_recv(){task.reject(unavailable());}
        }).map_err(|_|unavailable())?;
        Ok(Arc::new(Self{closed,alive,send:Mutex::new(Some(send)),_root:root}))
    }
}
impl NativeManagedStoreOwner for NativeStoreOwner{
    fn is_current(&self)->bool{!self.closed.load(Ordering::Acquire)&&self.alive.load(Ordering::Acquire)
        &&crate::local_run_store::database_owner::available()}
    fn submit(&self,work:ManagedStoreWork)->StoreResult<()>{
        if !self.is_current(){return Err(unavailable());}
        let send=self.send.lock().map_err(|_|unavailable())?;
        match send.as_ref().ok_or_else(unavailable)?.try_send(work){
            Ok(())=>Ok(()),
            Err(mpsc::TrySendError::Full(work))=>{
                let error=StoreError{kind:"busy".into(),message:"the local store queue is full; request was not submitted".into()};
                work.reject(error.clone());Err(error)
            }
            Err(mpsc::TrySendError::Disconnected(work))=>{work.reject(unavailable());Err(unavailable())}
        }
    }
    fn close(&self){self.closed.store(true,Ordering::Release);if let Ok(mut send)=self.send.lock(){send.take();}}
}

struct WindowGrant{session_requests:Arc<session_requests::SessionRequestScope>,alive:AtomicBool,pending:Mutex<Vec<Weak<AtomicBool>>>,
    native_document:Arc<crate::local_run_store::native_run_creation::NativeDocumentIdentity>}
impl WindowGrant{
    fn new()->Self{Self::new_owned(Arc::new(AtomicBool::new(false)))}
    fn new_owned(closed:Arc<AtomicBool>)->Self{Self{session_requests:Arc::new(session_requests::SessionRequestScope::default()),alive:AtomicBool::new(true),pending:Mutex::new(Vec::new()),
        native_document:crate::local_run_store::native_run_creation::NativeDocumentIdentity::new(closed)}}
    fn current(&self)->bool{self.alive.load(Ordering::Acquire)&&self.native_document.is_current()}
    fn track(&self,cancelled:&Arc<AtomicBool>)->StoreResult<()>{
        let mut pending=self.pending.lock().map_err(|_|unavailable())?;
        if !self.current(){return Err(unavailable());}
        pending.retain(|value|value.strong_count()>0);
        if pending.len()>=64{return Err(StoreError{kind:"busy".into(),message:"too many pending local store requests for this window".into()});}
        pending.push(Arc::downgrade(cancelled));Ok(())
    }
    fn revoke(&self){
        self.alive.store(false,Ordering::Release);
        self.native_document.revoke();
        self.session_requests.revoke();
        if let Ok(mut pending)=self.pending.lock(){for value in pending.drain(..){if let Some(flag)=value.upgrade(){flag.store(true,Ordering::Release);}}}
    }
}
fn local_document(url:&tauri::Url)->bool{
    if !url.username().is_empty()||url.password().is_some(){return false;}
    let production=matches!(url.scheme(),"http"|"https"|"tauri")
        &&matches!(url.host_str(),Some("tauri.localhost")|Some("localhost"))&&url.port().is_none()
        &&(url.scheme()=="tauri"||url.host_str()==Some("tauri.localhost"));
    let development=cfg!(debug_assertions)&&url.scheme()=="http"&&url.host_str()==Some("localhost")&&url.port()==Some(1420);
    production||development
}
impl ManagedRunStoreState{
    /// Call once from native setup with the process-selected app-data root.
    pub(crate) fn start(root:std::path::PathBuf)->StoreResult<Self>{
        let state=Self::default();state.install(NativeStoreOwner::start(root)?)?;Ok(state)
    }
    /// Started always revokes; only a completed local main document receives a new native grant.
    pub(crate) fn page_loaded(&self,label:&str,url:&tauri::Url,finished:bool){
        self.revoke_window(label);
        if label!="main"||!finished||!local_document(url)||self.closed.load(Ordering::Acquire){return;}
        if let Ok(mut windows)=self.windows.lock(){windows.insert(label.into(),Arc::new(WindowGrant::new_owned(self.closed.clone())));}
    }
    pub(crate) fn revoke_window(&self,label:&str){
        if let Ok(mut windows)=self.windows.lock(){if let Some(grant)=windows.remove(label){grant.revoke();}}
    }
    fn authorize(&self,window:&tauri::WebviewWindow)->StoreResult<Arc<WindowGrant>>{
        if self.closed.load(Ordering::Acquire)||window.label()!="main"||!local_document(&window.url().map_err(|_|unavailable())?){return Err(unavailable());}
        let windows=self.windows.lock().map_err(|_|unavailable())?;
        let grant=windows.get(window.label()).cloned().filter(|value|value.current()).ok_or_else(unavailable)?;
        Ok(grant)
    }
    pub(crate) fn require_window(&self,window:&tauri::WebviewWindow)->StoreResult<()>{self.authorize(window).map(|_|())}
    pub(crate) fn capture_window_grant(&self,window:&tauri::WebviewWindow)->StoreResult<Arc<NativeStoreWindowGrant>>{
        let owner=self.owner.get().cloned().ok_or_else(unavailable)?;
        if !current(&owner){return Err(unavailable());}
        let grant=self.authorize(window)?;
        Ok(Arc::new(NativeStoreWindowGrant{grant,closed:self.closed.clone()}))
    }
}


#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn replacing_a_document_revokes_only_its_pending_flags_and_cannot_regrant_it(){
        let old=WindowGrant::new();let flag=Arc::new(AtomicBool::new(false));
        old.track(&flag).unwrap();old.revoke();
        let fresh=WindowGrant::new();let fresh_flag=Arc::new(AtomicBool::new(false));fresh.track(&fresh_flag).unwrap();
        assert!(!old.current());assert!(flag.load(Ordering::Acquire));
        assert!(old.track(&Arc::new(AtomicBool::new(false))).is_err());
        assert!(fresh.current());assert!(!fresh_flag.load(Ordering::Acquire));
    }
    #[test]
    fn pending_admission_is_bounded_and_expired_weak_records_do_not_consume_capacity(){
        let grant=WindowGrant::new();let flags:Vec<_>=(0..64).map(|_|Arc::new(AtomicBool::new(false))).collect();
        for flag in &flags{grant.track(flag).unwrap();}
        assert_eq!(grant.track(&Arc::new(AtomicBool::new(false))).unwrap_err().kind,"busy");
        drop(flags);
        assert!(grant.track(&Arc::new(AtomicBool::new(false))).is_ok());
    }
    #[test]
    fn document_authority_excludes_remote_files_credentials_and_unexpected_ports(){
        for value in ["https://example.invalid/","file:///E:/index.html","http://tauri.localhost:9999/","http://user@tauri.localhost/"]{
            assert!(!local_document(&tauri::Url::parse(value).unwrap()),"{value}");
        }
        assert!(local_document(&tauri::Url::parse("http://tauri.localhost/index.html").unwrap()));
        assert!(local_document(&tauri::Url::parse("tauri://localhost/index.html").unwrap()));
    }
}


#[cfg(test)]
mod request_lifecycle_tests{
    use super::*;
    use crate::session_catalog_commands::{self as catalog,CancelInput,NativeRequestLifetime};
    fn pending_work(request:&str,observed:Arc<AtomicBool>)->ManagedStoreWork{
        let project="synthetic-managed-request-lifecycle";
        let envelope=NativeRequestLifetime::prepare(1,project,request).unwrap();
        let cancel=CancelInput{schema_version:1,project_id:project.into(),request_id:request.into()};
        assert!(catalog::cancel(&cancel).unwrap().cancellation_requested);
        ManagedStoreWork{write:false,deadline:Instant::now()+Duration::from_secs(1),cancelled:Arc::new(AtomicBool::new(false)),
            apply:Some(Box::new(move |_|{let _owned=envelope;panic!("rejected request must not run");})),
            complete:None,
            reject:Some(Box::new(move |_|{
                // The unique executable closure must be gone before a negative reply.
                assert!(!catalog::cancel(&cancel).unwrap().cancellation_requested);
                observed.store(true,Ordering::Release);
            }))}
    }
    #[test]
    fn full_queue_rejection_finishes_the_exact_unentered_request_before_reply(){
        let observed=Arc::new(AtomicBool::new(false));let work=pending_work("queue-full",observed.clone());
        let (send,_receive)=mpsc::sync_channel(0);
        match send.try_send(work){
            Err(mpsc::TrySendError::Full(work))=>work.reject(StoreError{kind:"busy".into(),message:"synthetic full queue".into()}),
            _=>panic!("zero-capacity queue unexpectedly admitted work"),
        }
        assert!(observed.load(Ordering::Acquire));
    }
    #[test]
    fn queue_drain_or_receiver_disconnect_destroys_unentered_work_before_reply(){
        let observed=Arc::new(AtomicBool::new(false));let work=pending_work("receiver-drop",observed.clone());
        let (send,receive)=mpsc::sync_channel(1);
        assert!(send.try_send(work).is_ok());
        drop(receive);
        assert!(observed.load(Ordering::Acquire));
    }
}


#[cfg(test)]
mod completion_release_tests {
    use super::*;
    #[test]
    fn real_worker_releases_connection_and_scope_before_delivering_completion() {
        let root = std::path::PathBuf::from(r"E:\Codex\UAgent\2026-10-29\tmp\managed-owner-release-tests")
            .join(format!("{}-{}",std::process::id(),std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let owner = NativeStoreOwner::start(root.clone()).unwrap();
        let (start, begin) = mpsc::sync_channel(1);
        let (opened, observed) = mpsc::sync_channel(1);
        let observer = std::thread::spawn(move || {
            begin.recv_timeout(Duration::from_secs(5)).unwrap();
            // This is another thread, so it cannot reenter the worker's OS mutex.
            let result = RunStore::open(&root);
            opened.send(result.is_ok()).unwrap();
        });
        let (reply, receive) = mpsc::sync_channel(1);
        let failed = reply.clone();
        owner.submit(ManagedStoreWork {
            write:false,deadline:Instant::now()+Duration::from_secs(10),
            cancelled:Arc::new(AtomicBool::new(false)),
            apply:Some(Box::new(|store|{store.projects().unwrap();})),
            complete:Some(Box::new(move |released| {
                released.check_current().unwrap();
                let scope=crate::local_run_store::database_owner::OperationScope::enter(
                    Arc::new(AtomicBool::new(false)),Instant::now()+Duration::from_secs(2)).unwrap();
                drop(scope);
                start.send(()).unwrap();
                // Pause this same worker in completion. The observer must open
                // before completion returns, rather than after the next loop.
                let released = observed.recv_timeout(Duration::from_secs(3)).unwrap_or(false);
                reply.send(released).unwrap();
            })),
            reject:Some(Box::new(move |_|{let _=failed.send(false);})),
        }).unwrap();
        assert!(receive.recv_timeout(Duration::from_secs(10)).unwrap());
        owner.close();
        observer.join().unwrap();
        // Retain the isolated fixture; no file deletion.
    }
}


impl ManagedRunStoreState {
    /// Terminal native receipt only. The nonserializable claim binds the original
    /// physical DB/project/run/effect; a revoked document cannot start new work here.
    pub(crate) async fn complete_native_ue_build(&self,completion:crate::ue_build_execution_commands::NativeBuildCompletion)->StoreResult<()>{
        let owner=self.owner.get().cloned().filter(|o|current(o)).ok_or_else(unavailable)?;
        if self.closed.load(Ordering::Acquire){return Err(unavailable());}
        let deadline=Instant::now()+OPERATION_TIMEOUT;let cancelled=self.closed.clone();
        let (reply,receive)=mpsc::sync_channel(1);let rejected=reply.clone();
        let result=Arc::new(Mutex::new(None));let apply_result=result.clone();let finish_owner=owner.clone();let finish_closed=self.closed.clone();
        let task=ManagedStoreWork{write:true,deadline,cancelled,
            apply:Some(Box::new(move|store|{let value=completion.persist(store);if let Ok(mut slot)=apply_result.lock(){*slot=Some(value);}})),
            complete:Some(Box::new(move|released|{
                let value=if released.check_current().is_err()||!current(&finish_owner)||finish_closed.load(Ordering::Acquire)||Instant::now()>=deadline{Err(expired(true))}
                    else{result.lock().ok().and_then(|mut s|s.take()).unwrap_or_else(||Err(unavailable()))};
                let _=reply.send(value);
            })),reject:Some(Box::new(move|error|{let _=rejected.send(Err(error));}))};
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(||owner.submit(task))).map_err(|_|unavailable())??;
        tauri::async_runtime::spawn_blocking(move||receive.recv_timeout(deadline.saturating_duration_since(Instant::now())).map_err(|_|expired(true)))
            .await.map_err(|_|expired(true))??
    }
}

#[cfg(test)]
mod memory_document_integration_tests {
    use super::*;
    use crate::local_run_store::Project;
    fn fixture() -> (ManagedRunStoreState, Arc<NativeStoreWindowGrant>) {
        let base=std::path::PathBuf::from(std::env::var_os("UAGENT_MEMORY_INTEGRATION_ROOT").expect("explicit synthetic fixture root"));
        assert!(base.is_absolute() && base.to_string_lossy().replace('\\',"/").starts_with("E:/"));
        let root=base.join(format!("{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let state=ManagedRunStoreState::default();
        let owner=NativeStoreOwner::start(root).unwrap();
        assert!(state.owner.set(owner).is_ok());
        // Actual document lifecycle type, but NOT a real Webview authorization.
        let document=Arc::new(NativeStoreWindowGrant{grant:Arc::new(WindowGrant::new()),closed:state.closed.clone()});
        (state,document)
    }
    #[test]
    fn memory_document_integration_real_sqlite_returns_only_for_current_document() {
        let (state,document)=fixture();
        let work=state.with_store_for_grant(document.clone(),true,|store,_,_| {
            store.create_project(&Project{id:"synthetic-memory".into(),root:"E:/synthetic-only".into(),label:"synthetic".into(),created_at:1})?;
            Ok(store.projects()?.len())
        });
        assert_eq!(tauri::async_runtime::block_on(work).unwrap(),1);
        let revoking=document.clone();
        let result=tauri::async_runtime::block_on(state.with_store_for_grant(document.clone(),false,move|store,_,_| {
            let rows=store.projects()?;
            revoking.grant.revoke();
            Ok(rows.len())
        }));
        assert!(result.is_err());
        assert!(!document.is_current());
        // Close this fixture worker, not the entire process storage domain.
        state.owner.get().unwrap().close();
    }
    #[test]
    fn memory_document_integration_native_permit_rejects_foreign_or_revoked_document() {
        let (state,document)=fixture();
        let foreign=Arc::new(NativeStoreWindowGrant{grant:Arc::new(WindowGrant::new()),closed:Arc::new(AtomicBool::new(false))});
        let entered=Arc::new(AtomicBool::new(false));
        for candidate in [foreign, {document.grant.revoke();document}] {
            let flag=entered.clone();
            let result=tauri::async_runtime::block_on(state.with_native_memory_admission_for_grant(candidate,move|_,_,_| {
                flag.store(true,Ordering::Release);
                Err(unavailable())
            }));
            assert!(result.is_err());
        }
        assert!(!entered.load(Ordering::Acquire));
        // Close this fixture worker, not the entire process storage domain.
        state.owner.get().unwrap().close();
    }
}

// Test-only adapter at the native document boundary. Never reachable from IPC.
#[cfg(test)]
pub(crate) fn memory_pipeline_fixture(root:std::path::PathBuf)->(ManagedRunStoreState,Arc<NativeStoreWindowGrant>) {
    let state=ManagedRunStoreState::start(root).unwrap();
    let document=Arc::new(NativeStoreWindowGrant{grant:Arc::new(WindowGrant::new_owned(state.closed.clone())),closed:state.closed.clone()});
    (state,document)
}
#[cfg(test)]
pub(crate) fn stop_memory_pipeline_fixture(state:&ManagedRunStoreState) {
    if let Some(owner)=state.owner.get(){owner.close();}
}
