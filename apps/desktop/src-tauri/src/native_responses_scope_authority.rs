//! Live read/share authority issued by a native, window-owned confirmation.
//! No archive, renderer boolean, fixture, DTO or metadata stamp issues a grant.
use super::*;
use crate::managed_run_store::NativeStoreWindowGrant;
use crate::trusted_root_handle::ReadRule;

const SCOPE_TTL: u64 = 600_000;
const CONTEXT_BYTES: usize = 24_576;

#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub(crate) struct AuthorizeMemoryScopeInput {
    pub profile_id: String,
    pub project_id: String,
    pub run_id: String,
    pub conversation_id: String,
    pub read_prefixes: Vec<String>,
    pub share_prefixes: Vec<String>,
    pub expires_at: u64,
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub(crate) struct MemoryScopeInput { pub scope_id: String }
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub(crate) struct NativeMemoryScopeReceipt {
    scope_id: String, project_id: String, run_id: String, conversation_id: String,
    read_prefixes: Vec<String>, share_prefixes: Vec<String>,
    max_context_bytes: usize, expires_at: u64,
    production_memory_dispatch_enabled: bool,
}

/// Original native authority. No Clone/Debug/serde or public constructor.
/// Arc identity, current native document and never-reused project registration
/// remain authoritative; the numeric generations are descriptive observations.
struct OriginalRunBinding {
    original: std::sync::Weak<Run>,
    session: NativeSession,
    alive: Arc<AtomicBool>,
    deadline: u64,
    creation:Option<Arc<crate::local_run_store::native_run_creation::NativeRunCreation>>,
}
pub(crate) struct NativeMemoryReadShareGrant {
    profile: Arc<Profile>,
    document: Arc<NativeStoreWindowGrant>,
    project: ProjectRegistration,
    run_id: String,
    conversation_id: String,
    read_prefixes: Vec<String>,
    share_prefixes: Vec<String>,
    deadline: u64,
    wall_ceiling:u64,
    run: OnceLock<OriginalRunBinding>,
    alive: AtomicBool,
}
impl NativeMemoryReadShareGrant {
    pub(crate) fn native_creation_binding(&self)->std::result::Result<(Arc<crate::local_run_store::native_run_creation::NativeRunCreation>,Arc<AtomicBool>),&'static str>{
        let run=self.run.get().ok_or("memory_native_run_required")?;
        let creation=run.creation.clone().ok_or("memory_native_creation_required")?;
        creation.check_original_owner(&run.alive).map_err(|_|"memory_native_creation_revoked")?;
        Ok((creation,run.alive.clone()))
    }
    pub(super) fn profile_id(&self)->&str { &self.profile.id }
    pub(super) fn deadline_ms(&self)->u64 {self.deadline}
    pub(super) fn wall_ceiling(&self)->u64 {self.wall_ceiling}
    pub(super) fn document(&self)->&Arc<NativeStoreWindowGrant> {&self.document}
    pub(super) fn window(&self)->&str { &self.profile.window }
    pub(crate) fn project_id(&self) -> &str { &self.project.project_id }
    pub(crate) fn run_id(&self) -> &str { &self.run_id }
    pub(crate) fn conversation_id(&self) -> &str { &self.conversation_id }
    pub(crate) fn read_prefixes(&self) -> &[String] { &self.read_prefixes }
    pub(crate) fn share_prefixes(&self) -> &[String] { &self.share_prefixes }
    pub(crate) fn max_context_bytes(&self) -> usize { CONTEXT_BYTES }
    pub(crate) fn root_handle(&self) -> &Arc<crate::trusted_root_handle::TrustedRootHandle> { &self.project.root }
    pub(crate) fn project_generation(&self) -> u64 { self.project.generation_number }
    pub(crate) fn root_generation(&self) -> u64 { self.project.generation_number }
    /// Bounded memory/clock checks only. Final transport admission must ALSO
    /// compare this same grant/run/request identity under its NativeSession mutex.
    pub(crate) fn check_liveness(&self) -> std::result::Result<(), &'static str> {
        if !self.alive.load(Ordering::Acquire) || !self.document.is_current()
            || !self.profile.alive.load(Ordering::Acquire)
            || self.profile.clock.now_ms() >= self.deadline
            || self.profile.clock.now_ms() >= self.profile.expires_at
            || self.project.root.is_revoked()
        { return Err("memory_scope_revoked"); }
        Ok(())
    }
    /// Authorization may precede native run registration. It is insufficient
    /// for B's capture/currentness until attach_native_run binds the real run.
    pub(super) fn check_authorization_current(&self) -> std::result::Result<(), &'static str> {
        self.check_liveness()?;
        self.project.check_current().map_err(|_| "memory_root_changed")?;
        let profile = profile_owned(&self.profile.id, &self.profile.window)
            .map_err(|_| "memory_scope_revoked")?;
        if !Arc::ptr_eq(&profile, &self.profile) { return Err("memory_scope_revoked"); }
        {
            let state = lock(broker()).map_err(|_| "memory_scope_unavailable")?;
            if state.updating.contains(&self.profile.snapshot.config.provider_id)
                || !self.project.matches(&state) { return Err("memory_scope_revoked"); }
        }
        let current = provider(&self.profile.root, &self.profile.snapshot.config.provider_id, &self.profile.model_id)
            .map_err(|_| "memory_configuration_changed")?;
        if current.generation != self.profile.snapshot.generation
            || current.revision != self.profile.snapshot.revision
            || fingerprint(&current, &self.profile.model_id).map_err(|_| "memory_configuration_changed")?
                != fingerprint(&self.profile.snapshot, &self.profile.model_id).map_err(|_| "memory_configuration_changed")?
        { return Err("memory_configuration_changed"); }
        self.project.check_current().map_err(|_| "memory_root_changed")?;
        self.check_liveness()
    }
    /// May do registry/filesystem/SQLite work. Never call under final state lock.
    pub(crate) fn check_current(&self) -> std::result::Result<(), &'static str> {
        self.check_authorization_current()?;
        let run=self.run.get().and_then(|binding|binding.original.upgrade()).ok_or("memory_native_run_required")?;
        if run.chat.is_some() || run.scope.owner.run_id!=self.run_id
            || run.scope.owner.conversation_id!=self.conversation_id
            || run.scope.owner.project_id!=self.project_id()
            || !Arc::ptr_eq(&run.profile,&self.profile)
            || !run.memory_scope.as_ref().is_some_and(|scope|std::ptr::eq(scope.as_ref(),self))
        {return Err("memory_native_run_changed");}
        run.current().map_err(|_|"memory_native_run_changed")?;
        self.check_liveness()
    }
    /// Native broker only. The existing fixture-only/live recovery gates must
    /// admit and register a genuine run before this can bind it. No replacement,
    /// archive restoration, DTO constructor or fixture issuer is supplied here.
    pub(super) fn attach_native_run(&self,run:&Arc<Run>)->Result<()> {
        self.check_authorization_current().map_err(failure)?;
        run.current()?;
        let state=lock(broker())?;
        if run.chat.is_some() || !run.alive.load(Ordering::Acquire)
            || run.scope.owner.run_id!=self.run_id || run.scope.owner.project_id!=self.project_id()
            || run.scope.owner.conversation_id!=self.conversation_id
            || !Arc::ptr_eq(&run.profile,&self.profile)
            || !run.memory_scope.as_ref().is_some_and(|scope|std::ptr::eq(scope.as_ref(),self))
            || !self.project.matches(&state)
            || !state.runs.values().any(|existing|Arc::ptr_eq(existing,run))
        {return Err(failure("memory_native_run_changed"));}
        self.run.set(OriginalRunBinding{
            original:Arc::downgrade(run),session:run.session.clone(),alive:run.alive.clone(),deadline:run.deadline,creation:run.native_creation.clone(),
        }).map_err(|_|failure("memory_native_run_already_bound"))
    }
    /// Pure identity/lifetime comparison for the private transport's final lock.
    /// Never queries the broker, filesystem, vault or SQL.
    pub(crate) fn is_bound_to(&self,session:&NativeSession)->bool {
        // No Weak::upgrade or owned Run temporary may be created under the
        // session mutex: dropping its last Arc could run monitor revocation.
        self.run.get().is_some_and(|binding| {
            binding.alive.load(Ordering::Acquire)
                && binding.session.same_instance(session)
                && self.profile.clock.now_ms()<binding.deadline
        })
    }
    pub(crate) fn check_memory_path(&self, path: &str) -> std::result::Result<(), &'static str> {
        self.check_liveness()?;
        if !valid_prefix(path) || (!path.is_empty() && !crate::project_source_versions::memory_source_path_allowed(path))
            || !self.read_prefixes.iter().any(|prefix| within(path,prefix))
            || !self.share_prefixes.iter().any(|prefix| within(path,prefix))
        { return Err("memory_scope_path_denied"); }
        Ok(())
    }
    pub(super) fn revoke(&self) { self.alive.store(false, Ordering::Release); }
}
fn valid_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 256 && !value.chars().any(char::is_control)
}
fn valid_prefix(value: &str) -> bool {
    value.is_empty() || (value.len() <= 1024
        && !value.chars().any(|c| c.is_control() || matches!(c,'\u{202a}'..='\u{202e}'|'\u{2066}'..='\u{2069}'))
        && ReadRule::subtree(value).is_ok())
}
fn prefixes(values: &[String]) -> bool {
    !values.is_empty() && values.len() <= 8
        && values.iter().all(|v| valid_prefix(v))
        && values.iter().enumerate().all(|(i,v)| !values[..i].iter().any(|p| p.to_lowercase()==v.to_lowercase()))
}
fn within(path: &str, prefix: &str) -> bool {
    let path=path.to_lowercase();let prefix=prefix.to_lowercase();
    prefix.is_empty() || path==prefix || path.strip_prefix(&prefix).is_some_and(|tail|tail.starts_with('/'))
}
pub(super) fn wall_now() -> Result<u64> {
    u64::try_from(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|_|failure("native_scope_clock"))?.as_millis()).map_err(|_|failure("native_scope_clock"))
}
fn display(value: &str) -> String {
    value.chars().flat_map(|c| {
        if c.is_control() || matches!(c,'\u{202a}'..='\u{202e}'|'\u{2066}'..='\u{2069}') {
            format!("\\u{{{:x}}}",c as u32).chars().collect::<Vec<_>>()
        } else { vec![c] }
    }).collect()
}
#[link(name="user32")]
extern "system" {
    fn MessageBoxW(window:*mut std::ffi::c_void,text:*const u16,title:*const u16,flags:u32)->i32;
}
fn confirm(window:isize,text:&str) -> Result<()> {
    let text:Vec<u16>=text.encode_utf16().chain(Some(0)).collect();
    let title:Vec<u16>="UAgent - Read and share project scope".encode_utf16().chain(Some(0)).collect();
    // YES/NO, warning icon, default NO. An IPC argument cannot answer this.
    if unsafe{MessageBoxW(window as *mut std::ffi::c_void,text.as_ptr(),title.as_ptr(),0x134)}!=6 {
        return Err(failure("native_scope_confirmation_declined"));
    }
    Ok(())
}
struct PromptReservation(String);
impl PromptReservation {
    fn reserve() -> Result<Self> {
        let id=token()?;let mut state=lock(broker())?;
        if state.scope_prompts.len()>=4{return Err(failure("native_scope_confirmation_busy"));}
        state.scope_prompts.insert(id.clone());Ok(Self(id))
    }
}
impl Drop for PromptReservation {
    fn drop(&mut self){if let Ok(mut state)=lock(broker()){state.scope_prompts.remove(&self.0);}}
}
pub(super) fn authorize(
    window:isize,label:&str,input:AuthorizeMemoryScopeInput,document:Arc<NativeStoreWindowGrant>,
) -> Result<NativeMemoryScopeReceipt> {
    if !valid_id(&input.run_id)||!valid_id(&input.conversation_id)||!valid_id(&input.project_id)
        ||!prefixes(&input.read_prefixes)||!prefixes(&input.share_prefixes) {
        return Err(failure("native_scope_invalid"));
    }
    let profile=profile_owned(&input.profile_id,label)?;
    // This is a genuine live scope issuer, never a fixture substitute. Existing
    // saved-credential discussion and investigation gates stay unchanged.
    if profile.snapshot.config.wire_api!=WireApi::Responses||profile.fixture_root.is_some()||profile.saved_credential.is_some() {
        return Err(failure("native_scope_live_profile_required"));
    }
    let project=capture_project_registration(&input.project_id)?;
    let now=wall_now()?;
    let remaining=input.expires_at.checked_sub(now).filter(|v|*v>0&&*v<=SCOPE_TTL)
        .ok_or_else(||failure("native_scope_expired"))?;
    let deadline=profile.clock.now_ms().checked_add(remaining).ok_or_else(||failure("native_scope_expired"))?
        .min(profile.expires_at);
    let pending=Arc::new(NativeMemoryReadShareGrant {
        profile,document,project,run_id:input.run_id.clone(),conversation_id:input.conversation_id.clone(),
        read_prefixes:input.read_prefixes,share_prefixes:input.share_prefixes,deadline,wall_ceiling:input.expires_at,run:OnceLock::new(),alive:AtomicBool::new(true),
    });
    pending.check_authorization_current().map_err(failure)?;
    let root=display(&pending.project.root.path_hint().to_string_lossy());
    let text=format!("Allow reading and sharing these project paths?\n\nProject: {root}\nProvider: {}\nModel: {}\nRun: {}\n\nRead prefixes (empty means the entire project):\n{}\n\nShare prefixes:\n{}\n\nOnly these read/share paths are authorized. Each request still needs exact-content review. This does not authorize execution.",
        display(&pending.profile.snapshot.config.provider_id),display(&pending.profile.model_id),display(&pending.run_id),
        serde_json::to_string(&pending.read_prefixes).map_err(|_|failure("native_scope_invalid"))?,
        serde_json::to_string(&pending.share_prefixes).map_err(|_|failure("native_scope_invalid"))?);
    if text.len()>24_576||root.len()>4096{return Err(failure("native_scope_display_limit"));}
    let _prompt=PromptReservation::reserve()?;
    confirm(window,&text)?;
    pending.check_authorization_current().map_err(failure)?;
    let id=token()?;
    let effective_expires_at=wall_now()?.saturating_add(pending.deadline.saturating_sub(pending.profile.clock.now_ms()));
    let mut state=lock(broker())?;
    state.memory_scopes.retain(|_,scope|scope.check_liveness().is_ok());
    if state.memory_scopes.len()>=64||!pending.project.matches(&state)
        ||state.updating.contains(&pending.profile.snapshot.config.provider_id)
        ||state.windows.get(label)!=Some(&(pending.profile.window_generation,false)) {
        return Err(failure("native_scope_revoked"));
    }
    pending.check_liveness().map_err(failure)?;
    state.memory_scopes.insert(id.clone(),pending.clone());
    Ok(NativeMemoryScopeReceipt {
        scope_id:id,project_id:pending.project_id().into(),run_id:pending.run_id.clone(),
        conversation_id:pending.conversation_id.clone(),read_prefixes:pending.read_prefixes.clone(),
        share_prefixes:pending.share_prefixes.clone(),max_context_bytes:CONTEXT_BYTES,expires_at:effective_expires_at.min(pending.wall_ceiling),
        production_memory_dispatch_enabled:memory_requests::LIVE_MEMORY_DISPATCH_VALIDATED,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scope_prefixes_are_bounded_and_reject_aliases_and_duplicates() {
        assert!(prefixes(&[String::new(),"Source".into()]));
        for bad in ["../Source","Source/../Private","Source\\Private","Source//Private","/Source","Source/\u{202e}x"] {
            assert!(!valid_prefix(bad),"{bad}");
        }
        assert!(!prefixes(&["Source".into(),"source".into()]));
        assert!(!prefixes(&vec!["Source".into();9]));
    }
    #[test]
    fn both_read_and_share_checks_keep_component_boundaries() {
        assert!(within("Source/Main.cpp","Source"));
        assert!(within("Source/Main.cpp",""));
        assert!(!within("SourcePrivate/Main.cpp","Source"));
        assert!(!within("","Source"));
        assert!(!within("Private/Main.cpp","Source"));
    }
}

// Simulates ONLY the native confirmation boundary in local integration tests.
// It still validates original broker/profile/project/document identities.
#[cfg(test)]
pub(super) fn memory_pipeline_fixture(profile:Arc<Profile>,document:Arc<NativeStoreWindowGrant>,project_id:&str)->Arc<NativeMemoryReadShareGrant> {
    let grant=Arc::new(NativeMemoryReadShareGrant{profile,document,project:capture_project_registration(project_id).unwrap(),
        run_id:"memory-pipeline-run".into(),conversation_id:"memory-pipeline-session".into(),
        read_prefixes:vec![String::new()],share_prefixes:vec![String::new()],deadline:60_000,
        wall_ceiling:wall_now().unwrap()+60_000,run:OnceLock::new(),alive:AtomicBool::new(true)});
    grant.check_authorization_current().unwrap();grant
}
