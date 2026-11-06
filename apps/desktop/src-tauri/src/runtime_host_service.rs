//! T17/T19 native, application-scoped admission and original-owner registry.
//! No process launch, restored approval, persistent access or force-release API.
//! Install exactly one managed instance. This is not an independent sidecar.
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex, MutexGuard};
use std::time::{Duration, Instant};

#[cfg(windows)]
#[path = "runtime_host_operation_admission.rs"]
mod operation_admission;

const OWNER_TTL: Duration = Duration::from_secs(15);
const FINISHED_TTL: Duration = Duration::from_secs(300);
const OBSERVATION_TTL: Duration = Duration::from_secs(1);
const MAX_OWNERS: usize = 128;
const MAX_JOBS: usize = 256;
#[cfg(windows)]
#[path = "runtime_host_memory_admission.rs"]
mod memory_admission;
#[cfg(windows)]
pub(crate) use memory_admission::{MemoryHostAdmission, NativeModelOwner};

pub const HOST_PROTOCOL: &str = "uagent.runtime-host.v1";
pub type HostResult<T> = Result<T, &'static str>;

#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OwnerIdentity {
    pub scope_id: String,
    pub run_id: String,
    pub project_id: String,
    pub root_ref: String,
    pub conversation_id: String,
    pub provider_id: String,
    pub model_id: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OwnerRef {
    pub host_generation: String,
    pub owner_id: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TicketRef {
    pub host_generation: String,
    pub owner_id: String,
    pub ticket_id: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResourceKind { UeEditor, Ubt, FileWrite }
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceClaim { pub kind: ResourceKind, pub key: String }
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobKind { Model, Operation }
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum JobPhase { Queued, Admitted, HandoffPending, Running, Retained, Finished }
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ExecutionObservation { Quiescent, Active, Unknown }
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecoveryAdmission { Ready, Blocked, Unknown }

/// Native-owned, preloaded T18 catalog. Must be nonblocking and never reenter this host.
/// Ready requires a complete scan of every relevant project/page and dispatch fence.
/// A corrupt, unavailable, partial or legacy catalog must return Unknown, never Ready.
pub trait RecoveryCatalog: Send + Sync {
    fn admission(&self, project_id: &str, root_object_id: Option<&str>, claims: &[ResourceClaim]) -> RecoveryAdmission;
}
/// Original native adapter only. This is not implemented by renderer/model DTOs.
/// Observe pending work and the complete owned execution, not PID existence alone.
/// Implement bounded read-only I/O; no termination, dispatch, load/save or privilege renewal.
pub trait ReadOnlyExecutionObserver: Send + Sync {
    fn observe(&self, owner: &NativeExecutionIdentity, deadline: Instant) -> ExecutionObservation;
}
/// A descriptor for correlation with T18; serialization never reconstructs the live guard.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeExecutionIdentity {
    pub ticket: TicketRef,
    pub owner: OwnerIdentity,
    pub execution_id: String,
    pub step_id: String,
}

trait HeldResource: Send + Sync {
    fn is_current(&self) -> bool;
    /// In-memory, permanent revocation of this exact pin; never perform path I/O here.
    fn is_revoked(&self) -> bool;
}
#[cfg(windows)]
impl HeldResource for crate::trusted_root_handle::TrustedRootHandle {
    fn is_current(&self) -> bool { self.check_current().is_ok() }
    fn is_revoked(&self) -> bool {
        crate::trusted_root_handle::TrustedRootHandle::is_revoked(self)
    }
}
/// Not deserializable. The physical root stays held until this job can release its lane.
/// Additional keys must be selected/canonicalized by the native adapter (e.g. engine ID).
pub struct NativeResourceBinding {
    root_object_id: String,
    held: Option<Arc<dyn HeldResource>>,
    claims: Vec<ResourceClaim>,
}
impl NativeResourceBinding {
    fn is_current(&self) -> bool { self.held.as_ref().is_some_and(|held| held.is_current()) }
    #[cfg(windows)]
    pub fn from_verified_root(
        root: Arc<crate::trusted_root_handle::TrustedRootHandle>, claims: Vec<ResourceClaim>,
    ) -> HostResult<Self> {
        root.check_current().map_err(|_| "runtime_host_root_stale")?;
        if claims.is_empty() || claims.len() > 16 { return Err("runtime_host_invalid_claims"); }
        let mut keys = std::collections::HashSet::new();
        for claim in &claims {
            valid_id(&claim.key)?;
            // Same physical resource cannot be aliased through a different resource kind.
            if !keys.insert(claim.key.clone()) { return Err("runtime_host_invalid_claims"); }
        }
        Ok(Self { root_object_id: root.identity().observation_key(), held: Some(root), claims })
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ModelJobInput {
    pub owner: OwnerRef,
    pub job_id: String,
    pub step_id: String,
    pub queue_timeout_ms: u64,
    pub execution_timeout_ms: u64,
}
/// Native operation submission; never accept this from a generic invoke payload.
pub struct NativeOperationInput {
    pub owner: OwnerRef,
    pub job_id: String,
    pub step_id: String,
    pub queue_timeout_ms: u64,
    pub execution_timeout_ms: u64,
    pub resources: NativeResourceBinding,
    pub observer: Arc<dyn ReadOnlyExecutionObserver>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobSnapshot {
    pub ticket: TicketRef,
    pub job_id: String,
    pub step_id: String,
    pub execution_id: String,
    pub kind: JobKind,
    pub phase: JobPhase,
    pub reason: Option<&'static str>,
    pub holds_resources: bool,
    pub callback_settled: bool,
    pub execution_observation: ExecutionObservation,
    pub cancel_requested: bool,
    pub root_object_id: Option<String>,
    pub resources: Vec<ResourceClaim>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnerSnapshot {
    pub protocol: &'static str,
    pub owner: OwnerRef,
    pub identity: OwnerIdentity,
    pub connected: bool,
    pub owner_lease_ms: u64,
    pub recovery_catalog_installed: bool,
    pub monitor_active: bool,
    pub model_concurrency: usize,
    pub pending_executions: usize,
    pub unknown_executions: usize,
    pub jobs: Vec<JobSnapshot>,
}
struct Owner {
    window: String,
    identity: OwnerIdentity,
    connected: bool,
    expires: Instant,
}
struct Job {
    ticket: TicketRef,
    job_id: String,
    step_id: String,
    execution_id: String,
    project_id: String,
    kind: JobKind,
    phase: JobPhase,
    reason: Option<&'static str>,
    queued_deadline: Instant,
    execution_duration: Duration,
    execution_deadline: Option<Instant>,
    finished_at: Option<Instant>,
    resources: Option<NativeResourceBinding>,
    observer: Option<Arc<dyn ReadOnlyExecutionObserver>>,
    observation: ExecutionObservation,
    observing: bool,
    callback_settled: bool,
    began: bool,
    requires_memory_transaction: bool,
    requires_operation_transaction: bool,
    native_creation:Option<Arc<crate::local_run_store::native_run_creation::NativeRunCreation>>,
    cancel: Arc<AtomicBool>,
}
impl Job {
    fn holds(&self) -> bool { !matches!(self.phase, JobPhase::Queued | JobPhase::Finished) }
    fn claims(&self) -> &[ResourceClaim] { self.resources.as_ref().map_or(&[], |r| r.claims.as_slice()) }
    fn root(&self) -> Option<&str> { self.resources.as_ref().map(|r| r.root_object_id.as_str()) }
    fn snapshot(&self) -> JobSnapshot {
        JobSnapshot {
            ticket: self.ticket.clone(), job_id: self.job_id.clone(), step_id: self.step_id.clone(),
            execution_id: self.execution_id.clone(), kind: self.kind, phase: self.phase, reason: self.reason,
            holds_resources: self.holds(), callback_settled: self.callback_settled,
            execution_observation: self.observation, cancel_requested: self.cancel.load(Ordering::SeqCst),
            root_object_id: self.root().map(str::to_owned), resources: self.claims().to_vec(),
        }
    }
    fn stop(&mut self, reason: &'static str, now: Instant) {
        if self.phase == JobPhase::Finished { return; }
        self.cancel.store(true, Ordering::SeqCst);
        if let Some(creation)=&self.native_creation{creation.invalidate();}
        self.reason = Some(reason);
        if matches!(self.phase, JobPhase::Queued | JobPhase::Admitted) {
            // No native dispatch guard has been issued in either state.
            self.callback_settled = true;
            self.observation = ExecutionObservation::Quiescent;
            self.finish(now);
        } else {
            self.phase = JobPhase::Retained;
            self.observation = ExecutionObservation::Unknown;
        }
    }
    fn finish(&mut self, now: Instant) {
        self.phase = JobPhase::Finished;
        self.finished_at = Some(now);
        // Preserve metadata but release this queue's physical root hold once quiet is proven.
        if let Some(binding) = self.resources.as_mut() { binding.held = None; }
    }
}
struct Inner {
    owners: HashMap<String, Owner>,
    jobs: VecDeque<Job>,
    catalog: Option<Arc<dyn RecoveryCatalog>>,
    closed: bool,
    monitor_active: bool,
}
#[derive(Clone)]
pub struct RuntimeHostService {
    generation: Arc<str>,
    inner: Arc<Mutex<Inner>>,
}
impl RuntimeHostService {
    pub fn new() -> HostResult<Self> {
        Ok(Self {
            generation: Arc::from(random_id()?),
            inner: Arc::new(Mutex::new(Inner { owners: HashMap::new(), jobs: VecDeque::new(), catalog: None, closed: false, monitor_active: false })),
        })
    }
    fn lock(&self) -> HostResult<MutexGuard<'_, Inner>> {
        self.inner.lock().map_err(|_| "runtime_host_unavailable")
    }
    /// One small native watchdog per managed host; no monitor starts during construction.
    /// Keep the returned handle in Tauri managed state for the full application lifetime.
    pub fn start_monitor(&self) -> HostResult<RuntimeHostMonitor> {
        {
            let mut inner = self.lock()?;
            if inner.monitor_active || inner.closed { return Err("runtime_host_monitor_already_fixed"); }
            inner.monitor_active = true;
        }
        let (stop, receiver) = std::sync::mpsc::sync_channel(1);
        let host = self.clone();
        let spawned = std::thread::Builder::new().name("runtime-host-owner-watch".into())
            .stack_size(256 * 1024).spawn(move || {
                loop {
                    match receiver.recv_timeout(Duration::from_millis(250)) {
                        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                            if let Ok(mut inner) = host.lock() {
                                if inner.closed { inner.monitor_active = false; break; }
                                refresh(&mut inner, Instant::now());
                            } else { break; }
                        }
                        _ => { let _ = host.close(); break; }
                    }
                }
            });
        if spawned.is_err() {
            self.lock()?.monitor_active = false;
            return Err("runtime_host_monitor_unavailable");
        }
        Ok(RuntimeHostMonitor { stop, host: self.clone() })
    }
    /// One-time native installation after a full T18 startup scan; no IPC setter exists.
    /// Keep catalog barriers live for unresolved effects even after execution quiesces.
    pub fn install_recovery_catalog(&self, catalog: Arc<dyn RecoveryCatalog>) -> HostResult<()> {
        let mut inner = self.lock()?;
        if inner.catalog.is_some() || inner.closed { return Err("runtime_host_catalog_already_fixed"); }
        inner.catalog = Some(catalog);
        refresh(&mut inner, Instant::now());
        Ok(())
    }
    pub fn connect(&self, window: &str, identity: OwnerIdentity) -> HostResult<OwnerSnapshot> {
        valid_id(window)?;
        for value in [&identity.scope_id, &identity.run_id, &identity.project_id, &identity.root_ref,
            &identity.conversation_id, &identity.provider_id, &identity.model_id] { valid_id(value)?; }
        let mut inner = self.lock()?;
        let now = Instant::now();
        refresh(&mut inner, now);
        prune(&mut inner, now);
        if inner.closed { return Err("runtime_host_closed"); }
        if inner.owners.len() >= MAX_OWNERS { return Err("runtime_host_capacity"); }
        let owner_id = random_id()?;
        // Window label comes from Tauri, not the payload. Random IDs are correlations, not permissions.
        inner.owners.insert(owner_id.clone(), Owner { window: window.into(), identity,
            connected: true, expires: now + OWNER_TTL });
        self.owner_snapshot(&inner, &owner_id)
    }
    pub fn heartbeat(&self, window: &str, owner: &OwnerRef) -> HostResult<OwnerSnapshot> {
        let mut inner = self.lock()?;
        let now = Instant::now();
        refresh(&mut inner, now);
        self.check_owner(&inner, window, owner, true)?;
        inner.owners.get_mut(&owner.owner_id).ok_or("runtime_host_owner_unknown")?.expires = now + OWNER_TTL;
        self.owner_snapshot(&inner, &owner.owner_id)
    }
    pub fn status(&self, window: &str, owner: &OwnerRef) -> HostResult<OwnerSnapshot> {
        let mut inner = self.lock()?;
        refresh(&mut inner, Instant::now());
        self.check_owner(&inner, window, owner, false)?;
        self.owner_snapshot(&inner, &owner.owner_id)
    }
    pub fn disconnect(&self, window: &str, owner: &OwnerRef) -> HostResult<OwnerSnapshot> {
        let mut inner = self.lock()?;
        self.check_owner(&inner, window, owner, false)?;
        revoke(&mut inner, &owner.owner_id, "owner_disconnected", Instant::now());
        refresh(&mut inner, Instant::now());
        self.owner_snapshot(&inner, &owner.owner_id)
    }
    /// Call on actual native window destruction, renderer replacement and app exit.
    pub fn disconnect_window(&self, window: &str) -> HostResult<()> {
        let mut inner = self.lock()?;
        let owners: Vec<_> = inner.owners.iter().filter(|(_, o)| o.window == window).map(|(id, _)| id.clone()).collect();
        let now = Instant::now();
        for id in owners { revoke(&mut inner, &id, "window_disconnected", now); }
        refresh(&mut inner, now);
        Ok(())
    }
    /// Native root-revocation hook. The caller already owns the real root lease; this
    /// metadata-only notification cannot open a path, grant access or force-clear work.
    pub fn invalidate_root(&self, root_object_id: &str) -> HostResult<()> {
        let mut inner = self.lock()?;
        let now = Instant::now();
        for job in inner.jobs.iter_mut().filter(|job| job.root() == Some(root_object_id)) {
            job.stop("root_revoked", now);
        }
        refresh(&mut inner, now);
        Ok(())
    }
    pub fn close(&self) -> HostResult<()> {
        let mut inner = self.lock()?;
        inner.closed = true;
        inner.monitor_active = false;
        let ids: Vec<_> = inner.owners.keys().cloned().collect();
        let now = Instant::now();
        for id in ids { revoke(&mut inner, &id, "host_closed", now); }
        Ok(())
    }
    pub fn enqueue_model(&self, window: &str, input: ModelJobInput) -> HostResult<JobSnapshot> {
        self.enqueue(window, input, JobKind::Model, None, None)
    }
    pub fn enqueue_operation(&self, window: &str, input: NativeOperationInput) -> HostResult<JobSnapshot> {
        let model = ModelJobInput { owner: input.owner, job_id: input.job_id, step_id: input.step_id,
            queue_timeout_ms: input.queue_timeout_ms, execution_timeout_ms: input.execution_timeout_ms };
        self.enqueue(window, model, JobKind::Operation, Some(input.resources), Some(input.observer))
    }
    fn enqueue(&self, window: &str, input: ModelJobInput, kind: JobKind,
        resources: Option<NativeResourceBinding>, observer: Option<Arc<dyn ReadOnlyExecutionObserver>>) -> HostResult<JobSnapshot> {
        valid_id(&input.job_id)?;
        valid_id(&input.step_id)?;
        if !(1..=3_600_000).contains(&input.queue_timeout_ms) || !(1..=3_600_000).contains(&input.execution_timeout_ms) {
            return Err("runtime_host_invalid_timeout");
        }
        // Root I/O runs before taking the global admission lock. Retain the exact binding.
        if resources.as_ref().is_some_and(|r| !r.is_current()) { return Err("runtime_host_root_stale"); }
        let mut inner = self.lock()?;
        let now = Instant::now();
        refresh(&mut inner, now);
        prune(&mut inner, now);
        self.check_owner(&inner, window, &input.owner, true)?;
        if inner.closed { return Err("runtime_host_closed"); }
        if inner.jobs.len() >= MAX_JOBS { return Err("runtime_host_capacity"); }
        if inner.jobs.iter().any(|j| j.ticket.owner_id == input.owner.owner_id && j.job_id == input.job_id) {
            return Err("runtime_host_duplicate_job");
        }
        let project_id = inner.owners[&input.owner.owner_id].identity.project_id.clone();
        let ticket = TicketRef { host_generation: self.generation.to_string(), owner_id: input.owner.owner_id, ticket_id: random_id()? };
        let ticket_id = ticket.ticket_id.clone();
        inner.jobs.push_back(Job { ticket, job_id: input.job_id, step_id: input.step_id, execution_id: random_id()?,
            project_id, kind, phase: JobPhase::Queued, reason: None, queued_deadline: now + Duration::from_millis(input.queue_timeout_ms),
            execution_duration: Duration::from_millis(input.execution_timeout_ms), execution_deadline: None, finished_at: None,
            resources, observer, observation: ExecutionObservation::Unknown, observing: false,
            callback_settled: true, began: false, requires_memory_transaction:false, requires_operation_transaction:false, native_creation:None, cancel: Arc::new(AtomicBool::new(false)) });
        refresh(&mut inner, now);
        Ok(inner.jobs.iter().find(|j| j.ticket.ticket_id == ticket_id).ok_or("runtime_host_job_unknown")?.snapshot())
    }
    pub fn cancel(&self, window: &str, ticket: &TicketRef) -> HostResult<JobSnapshot> {
        let mut inner = self.lock()?;
        self.check_ticket_owner(&inner, window, ticket, false)?;
        let now = Instant::now();
        let snapshot = {
            let job = find_job(&mut inner, ticket)?;
            job.stop("cancelled", now);
            job.snapshot()
        };
        refresh(&mut inner, now);
        Ok(snapshot)
    }
    /// MUST happen before scheduling a Future, thread, channel item or external handoff.
    /// The returned guard must move into the real worker; dropping it preserves unknown.
    /// Call only after the actual sender's scope/root/exact-plan/approval checks.
    pub fn register_pending(&self, window: &str, ticket: &TicketRef) -> HostResult<RegisteredExecution> {
        let mut inner = self.lock()?;
        refresh(&mut inner, Instant::now());
        self.check_ticket_owner(&inner, window, ticket, true)?;
        if !dispatch_admission_ready(&inner, ticket)? { return Err("runtime_host_recovery_blocked"); }
        let owner = inner.owners.get(&ticket.owner_id).ok_or("runtime_host_owner_unknown")?.identity.clone();
        let job = find_job(&mut inner, ticket)?;
        if job.phase != JobPhase::Admitted { return Err("runtime_host_not_admitted"); }
        job.phase = JobPhase::HandoffPending;
        job.callback_settled = false;
        job.observation = ExecutionObservation::Unknown;
        Ok(RegisteredExecution { host: self.clone(), identity: NativeExecutionIdentity {
            ticket: ticket.clone(), owner, execution_id: job.execution_id.clone(), step_id: job.step_id.clone(),
        }, cancel: job.cancel.clone(), closed: false })
    }
    /// Native worker only, bounded observation outside the admission lock. No webview proof input.
    /// The caller must schedule this on its existing bounded worker, not on the UI thread.
    pub fn reconcile(&self, ticket: &TicketRef) -> HostResult<JobSnapshot> {
        let (observer, identity) = {
            let mut inner = self.lock()?;
            refresh(&mut inner, Instant::now());
            if ticket.host_generation != self.generation.as_ref() { return Err("runtime_host_generation_changed"); }
            let owner = inner.owners.get(&ticket.owner_id).ok_or("runtime_host_owner_unknown")?.identity.clone();
            let job = find_job(&mut inner, ticket)?;
            if job.phase == JobPhase::Finished || !job.callback_settled || !job.began || job.observing {
                return Ok(job.snapshot());
            }
            let Some(observer) = job.observer.clone() else { return Ok(job.snapshot()); };
            job.observing = true;
            (observer, NativeExecutionIdentity { ticket: ticket.clone(), owner,
                execution_id: job.execution_id.clone(), step_id: job.step_id.clone() })
        };
        let started = Instant::now();
        // An adapter panic never poisons the admission lock or becomes stopped proof.
        let observed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| observer.observe(&identity, started + OBSERVATION_TTL)))
            .unwrap_or(ExecutionObservation::Unknown);
        let mut inner = self.lock()?;
        let now = Instant::now();
        let job = find_job(&mut inner, ticket)?;
        job.observing = false;
        job.observation = if now.duration_since(started) <= OBSERVATION_TTL { observed } else { ExecutionObservation::Unknown };
        if job.callback_settled && job.observation == ExecutionObservation::Quiescent {
            job.finish(now);
        } else { job.phase = JobPhase::Retained; }
        let snapshot = job.snapshot();
        refresh(&mut inner, now);
        Ok(snapshot)
    }
    fn check_owner(&self, inner: &Inner, window: &str, owner: &OwnerRef, current: bool) -> HostResult<()> {
        if owner.host_generation != self.generation.as_ref() { return Err("runtime_host_generation_changed"); }
        let state = inner.owners.get(&owner.owner_id).ok_or("runtime_host_owner_unknown")?;
        if state.window != window { return Err("runtime_host_owner_mismatch"); }
        if current && (!state.connected || state.expires <= Instant::now()) { return Err("runtime_host_owner_revoked"); }
        Ok(())
    }
    fn check_ticket_owner(&self, inner: &Inner, window: &str, ticket: &TicketRef, current: bool) -> HostResult<()> {
        self.check_owner(inner, window, &OwnerRef { host_generation: ticket.host_generation.clone(), owner_id: ticket.owner_id.clone() }, current)
    }
    fn owner_snapshot(&self, inner: &Inner, id: &str) -> HostResult<OwnerSnapshot> {
        let owner = inner.owners.get(id).ok_or("runtime_host_owner_unknown")?;
        Ok(OwnerSnapshot { protocol: HOST_PROTOCOL,
            owner: OwnerRef { host_generation: self.generation.to_string(), owner_id: id.into() },
            identity: owner.identity.clone(), connected: owner.connected, owner_lease_ms: OWNER_TTL.as_millis() as u64,
            recovery_catalog_installed: inner.catalog.is_some(), monitor_active: inner.monitor_active, model_concurrency: 3,
            pending_executions: inner.jobs.iter().filter(|j| j.holds() && !j.callback_settled && !j.began).count(),
            unknown_executions: inner.jobs.iter().filter(|j| j.phase == JobPhase::Retained && j.observation == ExecutionObservation::Unknown).count(),
            jobs: inner.jobs.iter().filter(|j| j.ticket.owner_id == id).map(Job::snapshot).collect() })
    }
}
/// Dropping this application-lifetime handle closes admission and requests cancellation.
/// It does not kill workers, clear unknown work or claim those workers have stopped.
pub struct RuntimeHostMonitor {
    stop: std::sync::mpsc::SyncSender<()>,
    host: RuntimeHostService,
}
impl Drop for RuntimeHostMonitor {
    fn drop(&mut self) { let _ = self.host.close(); let _ = self.stop.try_send(()); }
}
/// Nonserializable, non-cloneable native work registration, not an approval or resume token.
#[must_use = "move registration into the actual native worker; dropping retains unknown"]
pub struct RegisteredExecution {
    host: RuntimeHostService,
    identity: NativeExecutionIdentity,
    cancel: Arc<AtomicBool>,
    closed: bool,
}
impl RegisteredExecution {
    pub fn identity(&self) -> &NativeExecutionIdentity { &self.identity }
    pub fn cancellation(&self) -> Arc<AtomicBool> { self.cancel.clone() }
    /// Run on the worker immediately before actual dispatch, after the sender's final checks.
    pub fn begin(&mut self) -> HostResult<()> {
        let held_root = {
            let mut inner = self.host.lock()?;
            refresh(&mut inner, Instant::now());
            let job = find_job(&mut inner, &self.identity.ticket)?;
            if self.closed || job.began { return Err("runtime_host_dispatch_already_claimed"); }
            if job.requires_memory_transaction { return Err("runtime_host_memory_transaction_required"); }
            if job.requires_operation_transaction { return Err("runtime_host_operation_transaction_required"); }
            // Pending reservation and exact original native root pin survive the I/O window.
            match job.resources.as_ref() {
                None => None,
                Some(binding) => Some(binding.held.clone().ok_or("runtime_host_root_pin_missing")?),
            }
        };
        // May touch a slow disk. Heartbeat, cancellation and monitor keep their mutex access.
        let root_current = held_root.as_ref().map_or(true, |root| root.is_current());
        let mut inner = self.host.lock()?;
        // Never use the timestamp from before root I/O or metadata admission checks.
        refresh(&mut inner, Instant::now());
        let recovery_ready = dispatch_admission_ready(&inner, &self.identity.ticket)?;
        let now = Instant::now();
        let owner_current = inner.owners.get(&self.identity.ticket.owner_id).is_some_and(|o| o.connected && o.expires > now);
        let job = find_job(&mut inner, &self.identity.ticket)?;
        if self.closed || job.began { return Err("runtime_host_dispatch_already_claimed"); }
        let execution_current = job.execution_deadline.is_some_and(|deadline| deadline > now);
        // The lock-free path result can become stale while reacquiring this mutex or
        // checking admission. Recheck the SAME pin's permanent flag without filesystem I/O.
        let root_revoked = held_root.as_ref().is_some_and(|root| root.is_revoked());
        if !owner_current || !execution_current || !recovery_ready || !root_current || root_revoked || job.cancel.load(Ordering::SeqCst) {
            // This exact exclusive registration never began; no old guard can start later.
            job.callback_settled = true;
            job.observation = ExecutionObservation::Quiescent;
            job.reason.get_or_insert("revoked_before_dispatch");
            job.finish(now);
            self.closed = true;
            refresh(&mut inner, now);
            return Err("runtime_host_dispatch_revoked");
        }
        if job.phase != JobPhase::HandoffPending { return Err("runtime_host_invalid_dispatch_phase"); }
        job.began = true;
        job.phase = JobPhase::Running;
        Ok(())
    }
    /// Call only after the owned native callback/transport actually returns and all its
    /// locally scheduled work is settled. External operation lanes still need the observer.
    pub fn finish(mut self, succeeded: bool) -> HostResult<JobSnapshot> {
        let mut inner = self.host.lock()?;
        let now = Instant::now();
        refresh(&mut inner, now);
        let job = find_job(&mut inner, &self.identity.ticket)?;
        if self.closed || !job.began { return Err("runtime_host_callback_not_started"); }
        job.callback_settled = true;
        if job.reason.is_none() { job.reason = Some(if succeeded { "completed" } else { "failed" }); }
        if job.observer.is_none() {
            // Model slot covers the complete owned native transport, never remote server compute.
            job.observation = ExecutionObservation::Quiescent;
            job.finish(now);
        } else {
            job.observation = ExecutionObservation::Unknown;
            job.phase = JobPhase::Retained;
        }
        self.closed = true;
        let snapshot = job.snapshot();
        refresh(&mut inner, now);
        Ok(snapshot)
    }
    /// Native proof that this exclusive pending registration was never dispatched.
    pub fn finish_not_started(mut self) -> HostResult<JobSnapshot> {
        let mut inner = self.host.lock()?;
        let now = Instant::now();
        let job = find_job(&mut inner, &self.identity.ticket)?;
        if self.closed || job.began { return Err("runtime_host_dispatch_already_claimed"); }
        job.cancel.store(true, Ordering::SeqCst);
        job.callback_settled = true;
        job.observation = ExecutionObservation::Quiescent;
        job.reason.get_or_insert("not_started");
        job.finish(now);
        self.closed = true;
        let snapshot = job.snapshot();
        refresh(&mut inner, now);
        Ok(snapshot)
    }
}
impl Drop for RegisteredExecution {
    fn drop(&mut self) {
        if !self.closed {
            if let Ok(mut inner) = self.host.lock() {
                if let Ok(job) = find_job(&mut inner, &self.identity.ticket) {
                    // Drop/panic/lost Future does not prove the real callback returned.
                    job.stop("native_callback_unsettled", Instant::now());
                }
            }
        }
    }
}
fn valid_id(value: &str) -> HostResult<()> {
    if value.is_empty() || value.len() > 512 || value.trim() != value || value.chars().any(|c| c.is_control()) {
        Err("runtime_host_invalid_id")
    } else { Ok(()) }
}
fn random_id() -> HostResult<String> {
    let mut bytes = [0u8; 16];
    getrandom::getrandom(&mut bytes).map_err(|_| "runtime_host_random_unavailable")?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}
fn find_job<'a>(inner: &'a mut Inner, ticket: &TicketRef) -> HostResult<&'a mut Job> {
    inner.jobs.iter_mut().find(|j| &j.ticket == ticket).ok_or("runtime_host_job_unknown")
}
fn dispatch_admission_ready(inner: &Inner, ticket: &TicketRef) -> HostResult<bool> {
    let job = inner.jobs.iter().find(|j| &j.ticket == ticket).ok_or("runtime_host_job_unknown")?;
    Ok(!inner.closed && inner.monitor_active && inner.catalog.as_ref().is_some_and(|catalog|
        catalog.admission(&job.project_id, job.root(), job.claims()) == RecoveryAdmission::Ready))
}
fn revoke(inner: &mut Inner, id: &str, reason: &'static str, now: Instant) {
    if let Some(owner) = inner.owners.get_mut(id) { owner.connected = false; }
    for job in inner.jobs.iter_mut().filter(|j| j.ticket.owner_id == id) { job.stop(reason, now); }
}
fn conflicts(a: &Job, b: &Job) -> bool {
    if a.claims().is_empty() || b.claims().is_empty() { return false; }
    a.project_id == b.project_id || a.root() == b.root() || a.claims().iter().any(|x| b.claims().iter().any(|y| x.key == y.key))
}
fn refresh(inner: &mut Inner, now: Instant) {
    let expired: Vec<_> = inner.owners.iter().filter(|(_, o)| o.connected && o.expires <= now).map(|(id, _)| id.clone()).collect();
    for id in expired { revoke(inner, &id, "owner_expired", now); }
    for job in &mut inner.jobs {
        if job.phase == JobPhase::Queued && now >= job.queued_deadline { job.stop("queue_timed_out", now); }
        else if job.phase != JobPhase::Finished && job.execution_deadline.is_some_and(|d| now >= d) {
            job.stop("execution_timed_out", now);
        }
    }
    if inner.closed || !inner.monitor_active {
        for job in inner.jobs.iter_mut().filter(|j| j.phase == JobPhase::Queued) { job.reason = Some("monitor_unavailable"); }
        return;
    }
    for index in 0..inner.jobs.len() {
        if inner.jobs[index].phase != JobPhase::Queued { continue; }
        let job = &inner.jobs[index];
        let admission = inner.catalog.as_ref().map(|c| c.admission(&job.project_id, job.root(), job.claims()));
        if admission != Some(RecoveryAdmission::Ready) {
            inner.jobs[index].reason = Some(match admission { None => "recovery_pending", Some(RecoveryAdmission::Blocked) => "recovery_blocked", _ => "recovery_unknown" });
            continue;
        }

        let model_full = job.kind == JobKind::Model && inner.jobs.iter().filter(|j| j.kind == JobKind::Model && j.holds()).count() >= 3;
        let blocked = inner.jobs.iter().enumerate().any(|(other, candidate)| other != index &&
            ((candidate.holds() && conflicts(job, candidate)) || (other < index && candidate.phase == JobPhase::Queued && conflicts(job, candidate))));
        if !model_full && !blocked {
            let job = &mut inner.jobs[index];
            job.phase = JobPhase::Admitted;
            job.reason = None;
            // Includes the delay between admission, scheduling and actual dispatch.
            job.execution_deadline = Some(now + job.execution_duration);
        } else {
            inner.jobs[index].reason = Some(if model_full { "model_capacity" } else { "resource_conflict" });
        }
    }
}
fn prune(inner: &mut Inner, now: Instant) {
    inner.jobs.retain(|j| !j.finished_at.is_some_and(|at| now.saturating_duration_since(at) >= FINISHED_TTL));
    let retained_owners: std::collections::HashSet<_> = inner.jobs.iter().map(|j| j.ticket.owner_id.clone()).collect();
    inner.owners.retain(|id, owner| owner.connected || retained_owners.contains(id));
}

#[cfg(test)]
#[path = "runtime_host_service_tests.rs"]
mod tests;








