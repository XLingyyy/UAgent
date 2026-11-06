//! Pure managed-store command handlers. The central native owner supplies &RunStore while
//! holding its writer lease; these handlers never open app data or create another writer.
#![cfg(windows)]
use crate::local_run_store::{session_catalog::{control::CatalogControl, CatalogSession}, Message, RunStore, StoreError};
pub use crate::local_run_store::session_catalog::SessionPatch;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::{Arc, Mutex, OnceLock, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ListInput { #[serde(default)] pub title_query:String, pub schema_version: u32, pub project_id: String, pub request_id: String, pub include_archived: bool, pub offset: usize, pub limit: usize }
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateInput { pub schema_version: u32, pub project_id: String, pub request_id: String, pub session_id: String, pub patch: SessionPatch }
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BranchInput { pub schema_version: u32, pub project_id: String, pub request_id: String, pub session_id: String, pub through_ordinal: i64, pub new_session_id: String, pub title: String }
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReadInput { pub schema_version: u32, pub project_id: String, pub request_id: String, pub session_id: String, pub through_ordinal: i64 }
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CancelInput { pub schema_version: u32, pub project_id: String, pub request_id: String }
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListResult { pub title_query:String, pub schema_version: u32, pub project_id: String, pub request_id: String, pub include_archived: bool, pub offset: usize, pub limit: usize, pub has_more: bool, pub sessions: Vec<CatalogSession> }
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationResult { pub schema_version: u32, pub project_id: String, pub request_id: String, pub session: CatalogSession, pub requires_fresh_authorization: bool }
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadResult { pub schema_version: u32, pub project_id: String, pub request_id: String, pub session: CatalogSession, pub through_ordinal: i64, pub prefix_message_count: usize, pub messages: Vec<Message>, pub requires_fresh_authorization: bool }
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CancelResult { pub schema_version: u32, pub project_id: String, pub request_id: String, pub cancellation_requested: bool }
fn invalid() -> StoreError { StoreError { kind: "invalid".into(), message: "native session catalog contract is invalid".into() } }
fn valid_id(value: &str) -> bool { !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control) }
fn identity(schema: u32, project: &str, session: Option<&str>) -> Result<(), StoreError> {
    if schema != 1 || !valid_id(project) || session.is_some_and(|id| !valid_id(id)) { return Err(invalid()); }
    Ok(())
}
pub fn list(store: &RunStore, input: &ListInput) -> Result<ListResult, StoreError> {
    identity(input.schema_version, &input.project_id, None)?;
    if input.limit == 0 || input.limit > 50 || input.offset > 1_000_000 { return Err(invalid()); }
    let permit = Permit::begin(&input.project_id, &input.request_id)?;
    store.session_catalog_controlled(&permit.control, false, || {
        if !store.session_catalog_project_exists(&input.project_id)? { return Err(StoreError { kind: "notFound".into(), message: "saved project does not exist".into() }); }
        let mut sessions = store.session_catalog_page_matching(&input.project_id, input.include_archived, input.offset, input.limit + 1, &input.title_query)?;
        let has_more = sessions.len() > input.limit;
        sessions.truncate(input.limit);
        Ok(ListResult { title_query:input.title_query.clone(), schema_version: 1, project_id: input.project_id.clone(), request_id: input.request_id.clone(), include_archived: input.include_archived, offset: input.offset, limit: input.limit, has_more, sessions })
    })
}
pub fn update(store: &RunStore, input: &UpdateInput) -> Result<MutationResult, StoreError> {
    identity(input.schema_version, &input.project_id, Some(&input.session_id))?;
    let permit = Permit::begin(&input.project_id, &input.request_id)?;
    store.session_catalog_controlled(&permit.control, true, || {
        let session = store.session_catalog_update(&input.project_id, &input.session_id, &input.patch)?;
        Ok(MutationResult { schema_version: 1, project_id: input.project_id.clone(), request_id: input.request_id.clone(), session, requires_fresh_authorization: true })
    })
}
pub fn branch(store: &RunStore, input: &BranchInput, now: i64) -> Result<MutationResult, StoreError> {
    identity(input.schema_version, &input.project_id, Some(&input.session_id))?;
    if !valid_id(&input.new_session_id) { return Err(invalid()); }
    let permit = Permit::begin(&input.project_id, &input.request_id)?;
    store.session_catalog_controlled(&permit.control, true, || {
        let session = store.session_catalog_branch(&input.project_id, &input.session_id, input.through_ordinal, &input.new_session_id, &input.title, now)?;
        Ok(MutationResult { schema_version: 1, project_id: input.project_id.clone(), request_id: input.request_id.clone(), session, requires_fresh_authorization: true })
    })
}
pub fn read(store: &RunStore, input: &ReadInput) -> Result<ReadResult, StoreError> {
    identity(input.schema_version, &input.project_id, Some(&input.session_id))?;
    let permit = Permit::begin(&input.project_id, &input.request_id)?;
    store.session_catalog_controlled(&permit.control, true, || {
        let (session, prefix_message_count, messages) = store.session_catalog_read_prefix(&input.project_id, &input.session_id, input.through_ordinal)?;
        Ok(ReadResult { schema_version: 1, project_id: input.project_id.clone(), request_id: input.request_id.clone(), session, through_ordinal: input.through_ordinal, prefix_message_count, messages, requires_fresh_authorization: true })
    })
}

#[derive(Clone, Copy, PartialEq)]
enum Phase { CancelRequested, PendingNativeWork, Active, Finished }
struct Entry { cancelled: Arc<AtomicBool>, phase: Phase, updated: Instant }
type RequestKey = (String, String);
fn registry() -> &'static Mutex<HashMap<RequestKey, Entry>> {
    static VALUE: OnceLock<Mutex<HashMap<RequestKey, Entry>>> = OnceLock::new();
    VALUE.get_or_init(|| Mutex::new(HashMap::new()))
}
fn make_room(entries: &mut HashMap<RequestKey, Entry>, key: &RequestKey) -> Result<(), StoreError> {
    make_room_at(entries, key, Instant::now())
}
fn make_room_at(entries: &mut HashMap<RequestKey, Entry>, key: &RequestKey, now: Instant) -> Result<(), StoreError> {
    // An accepted pre-dispatch cancellation is a promise to the queued request. It
    // has no safe TTL until that same request is observed and rejected/completed.
    // Only Finished entries may expire or be recycled under capacity pressure.
    entries.retain(|_, value| value.phase != Phase::Finished || now.saturating_duration_since(value.updated) < Duration::from_secs(600));
    if !entries.contains_key(key) && entries.len() >= 256 {
        let oldest = entries.iter().filter(|(_, value)| value.phase == Phase::Finished).min_by_key(|(_, value)| value.updated).map(|(key, _)| key.clone());
        if let Some(oldest) = oldest { entries.remove(&oldest); }
        else { return Err(StoreError { kind: "busy".into(), message: "session catalog registry contains 256 active or accepted cancellation records; the new request or cancellation was not accepted".into() }); }
    }
    Ok(())
}
fn begin_entry(entries: &mut HashMap<RequestKey, Entry>, key: RequestKey) -> Result<Arc<AtomicBool>, StoreError> {
    make_room(entries, &key)?;
    if entries.get(&key).is_some_and(|entry| entry.phase != Phase::CancelRequested &&
        !(entry.phase == Phase::PendingNativeWork && native_binding_matches(&key, &entry.cancelled))) {
        return Err(StoreError { kind: "requestAlreadyUsed".into(), message: "native session request ID was already used".into() });
    }
    let cancelled = entries.get(&key).map(|entry| entry.cancelled.clone()).unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
    entries.insert(key, Entry { cancelled: cancelled.clone(), phase: Phase::Active, updated: Instant::now() });
    Ok(cancelled)
}
fn cancel_entry(entries: &mut HashMap<RequestKey, Entry>, key: RequestKey) -> Result<bool, StoreError> {
    // Capacity rejection happens before an Ack or state insertion. Existing keys
    // remain cancellable even when every slot is pinned by live obligations.
    make_room(entries, &key)?;
    let entry = entries.entry(key).or_insert_with(|| Entry { cancelled: Arc::new(AtomicBool::new(true)), phase: Phase::CancelRequested, updated: Instant::now() });
    let accepted = entry.phase != Phase::Finished;
    if accepted { entry.cancelled.store(true, Ordering::Release); entry.updated = Instant::now(); }
    Ok(accepted)
}
fn finish_entry(entries: &mut HashMap<RequestKey, Entry>, key: &RequestKey, cancelled: &Arc<AtomicBool>) {
    if let Some(entry) = entries.get_mut(key) {
        if entry.phase == Phase::Active && Arc::ptr_eq(&entry.cancelled, cancelled) { entry.phase = Phase::Finished; entry.updated = Instant::now(); }
    }
}
// A native envelope lives INSIDE the queued FnOnce. Its destruction proves that
// this exact closure cannot later enter a handler. It is not renderer authority.
thread_local! {
    static NATIVE_REQUEST: std::cell::RefCell<Option<(RequestKey, Arc<AtomicBool>)>> = const { std::cell::RefCell::new(None) };
}
fn native_binding_matches(key: &RequestKey, cancelled: &Arc<AtomicBool>) -> bool {
    NATIVE_REQUEST.with(|slot| slot.borrow().as_ref().is_some_and(|(bound, flag)| bound == key && Arc::ptr_eq(flag, cancelled)))
}
struct NativeRequestBinding(std::marker::PhantomData<std::rc::Rc<()>>);
impl NativeRequestBinding {
    fn enter(key: &RequestKey, flag: &Arc<AtomicBool>) -> Result<Self, StoreError> {
        NATIVE_REQUEST.with(|slot| {
            let mut current = slot.borrow_mut();
            if current.is_some() { return Err(StoreError { kind: "busy".into(), message: "nested native session request dispatch is unavailable".into() }); }
            *current = Some((key.clone(), flag.clone())); Ok(Self(std::marker::PhantomData))
        })
    }
}
impl Drop for NativeRequestBinding { fn drop(&mut self) { NATIVE_REQUEST.with(|slot| { slot.replace(None); }); } }
fn prepare_native_entry(entries: &mut HashMap<RequestKey, Entry>, key: RequestKey) -> Result<Arc<AtomicBool>, StoreError> {
    make_room(entries, &key)?;
    if entries.get(&key).is_some_and(|entry| entry.phase != Phase::CancelRequested) {
        return Err(StoreError { kind: "requestAlreadyUsed".into(), message: "native session request already has an owner".into() });
    }
    let cancelled = entries.get(&key).map(|entry| entry.cancelled.clone()).unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
    entries.insert(key, Entry { cancelled: cancelled.clone(), phase: Phase::PendingNativeWork, updated: Instant::now() });
    Ok(cancelled)
}
fn finish_unentered_native_entry(entries: &mut HashMap<RequestKey, Entry>, key: &RequestKey, flag: &Arc<AtomicBool>) {
    if let Some(entry) = entries.get_mut(key) {
        // Active work is finished ONLY by its own Permit after the synchronous handler
        // returns/unwinds. Never clear an active or unrelated cancellation obligation.
        if entry.phase == Phase::PendingNativeWork && Arc::ptr_eq(&entry.cancelled, flag) {
            entry.phase = Phase::Finished; entry.updated = Instant::now();
        }
    }
}
/// Create before managed-queue admission; move into the queued closure, never into
/// a renderer future's cancellation guard. Not Clone and never serialized.
pub(crate) struct NativeRequestLifetime { key: RequestKey, cancelled: Arc<AtomicBool>, registration:Option<crate::managed_run_store::SessionRequestRegistration> }
impl NativeRequestLifetime {
    fn prepare_unbound(schema: u32, project: &str, request: &str) -> Result<Self, StoreError> {
        identity(schema, project, None)?;
        if !valid_id(request) { return Err(invalid()); }
        let key = (project.into(), request.into());
        let cancelled = {
            let mut entries = registry().lock().map_err(|_| invalid())?;
            prepare_native_entry(&mut entries, key.clone())?
        };
        Ok(Self { key, cancelled, registration:None })
    }
    #[cfg(test)]
    pub(crate) fn prepare(schema:u32,project:&str,request:&str)->Result<Self,StoreError> { Self::prepare_unbound(schema,project,request) }
    pub(crate) fn prepare_for_grant(schema:u32,project:&str,request:&str,grant:&crate::managed_run_store::NativeStoreWindowGrant)->Result<Self,StoreError> {
        if !grant.is_current() { return Err(invalid()); }
        let mut lifetime=Self::prepare_unbound(schema,project,request)?;
        lifetime.registration=Some(grant.register_session_request(project,request,lifetime.cancelled.clone())?);
        Ok(lifetime)
    }
    pub(crate) fn run<T>(self, handler: impl FnOnce() -> Result<T, StoreError>) -> Result<T, StoreError> {
        if self.registration.as_ref().is_some_and(|scope| !scope.is_current()) { return Err(invalid()); }
        let _binding = NativeRequestBinding::enter(&self.key, &self.cancelled)?;
        handler()
    }
}
impl Drop for NativeRequestLifetime {
    fn drop(&mut self) {
        if let Ok(mut entries) = registry().lock() { finish_unentered_native_entry(&mut entries, &self.key, &self.cancelled); }
    }
}

struct Permit { key: RequestKey, control: CatalogControl }
impl Permit {
    fn begin(project: &str, request: &str) -> Result<Self, StoreError> {
        if !valid_id(request) { return Err(invalid()); }
        let key = (project.into(), request.into());
        let mut entries = registry().lock().map_err(|_| invalid())?;
        let cancelled = begin_entry(&mut entries, key.clone())?;
        Ok(Self { key, control: CatalogControl::new(cancelled) })
    }
}
impl Drop for Permit {
    fn drop(&mut self) {
        if let Ok(mut entries) = registry().lock() {
            finish_entry(&mut entries, &self.key, &self.control.cancelled);
        }
    }
}
/// Register this command outside the serialized Store queue so it can interrupt its worker.
/// A cancellation received before its request starts is remembered in a bounded registry.
#[cfg(test)]
pub fn cancel(input: &CancelInput) -> Result<CancelResult, StoreError> {
    identity(input.schema_version, &input.project_id, None)?;
    if !valid_id(&input.request_id) { return Err(invalid()); }
    let key = (input.project_id.clone(), input.request_id.clone());
    let mut entries = registry().lock().map_err(|_| invalid())?;
    let cancellation_requested = cancel_entry(&mut entries, key)?;
    Ok(CancelResult { schema_version: 1, project_id: input.project_id.clone(), request_id: input.request_id.clone(), cancellation_requested })
}

#[cfg(test)]
#[path = "session_catalog_registry_tests.rs"]
mod registry_tests;

/// Production cancellation never creates a pre-cancel entry or searches another document.
pub(crate) fn cancel_for_grant(input:&CancelInput,grant:&crate::managed_run_store::NativeStoreWindowGrant)->Result<CancelResult,StoreError> {
    identity(input.schema_version,&input.project_id,None)?;
    if !valid_id(&input.request_id) { return Err(invalid()); }
    grant.cancel_session_request(&input.project_id,&input.request_id)?;
    Ok(CancelResult{schema_version:1,project_id:input.project_id.clone(),request_id:input.request_id.clone(),cancellation_requested:true})
}
