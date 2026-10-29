//! Private Responses transport preparation core. No HTTP/TLS implementation or IPC.
//! Memory-only credentials and source generations are NEW native facilities here;
//! they are not connected to renderer credentials, T08 saves or a real source watcher.
//! A caller must provide both a real SourceChecker and a Transport before sending.
#![cfg(windows)]
#![allow(dead_code)]
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::sync::{
    atomic::{AtomicBool, AtomicU8, Ordering},
    Arc, Mutex,
};

const MAX_REQUEST_BYTES: usize = 1_048_576;
const MAX_RESPONSE_BYTES: usize = 4_194_304;
const MAX_CHUNK_BYTES: usize = 65_536;
const MAX_RAW_CHUNKS: usize = 4096;
const MAX_CREDENTIAL_BYTES: usize = 16_384;
const MAX_CREDENTIAL_TTL_MS: u64 = 3_600_000;
const MAX_LEASE_TTL_MS: u64 = 600_000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Owner {
    pub project: String,
    pub epoch: u64,
    pub run: String,
    pub conversation: String,
    pub provider: String,
    pub model: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ConfigVersion {
    pub generation: String,
    pub revision: u64,
}
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) enum FailureCode {
    Unavailable,
    InvalidCredential,
    InvalidLifetime,
    MissingCredential,
    InvalidLease,
    Expired,
    IdentityChanged,
    SourceChanged,
    SourceUnavailable,
    EndpointRejected,
    InvalidBody,
    ApprovalMismatch,
    GrantConsumed,
    Cancelled,
    TransportFailed,
    ResponseLimit,
}
impl FailureCode {
    pub(crate) fn code(self) -> &'static str {
        match self {
            Self::Unavailable => "native_transport_unavailable",
            Self::InvalidCredential => "native_credential_invalid",
            Self::InvalidLifetime => "native_lifetime_invalid",
            Self::MissingCredential => "native_credential_missing",
            Self::InvalidLease => "native_lease_invalid",
            Self::Expired => "native_lease_expired",
            Self::IdentityChanged => "native_identity_changed",
            Self::SourceChanged => "native_source_changed",
            Self::SourceUnavailable => "native_source_unavailable",
            Self::EndpointRejected => "native_endpoint_rejected",
            Self::InvalidBody => "native_body_invalid",
            Self::ApprovalMismatch => "native_approval_mismatch",
            Self::GrantConsumed => "native_grant_consumed",
            Self::Cancelled => "native_request_cancelled",
            Self::TransportFailed => "native_transport_failed",
            Self::ResponseLimit => "native_response_limit",
        }
    }
}
type Result<T> = std::result::Result<T, FailureCode>;

/// Trusted native monotonic time only; implementations must not block or call out.
pub(crate) trait Clock: Send + Sync {
    fn now_ms(&self) -> u64;
}
pub(crate) struct MonotonicClock(std::time::Instant);
impl MonotonicClock {
    pub(crate) fn new() -> Self {
        Self(std::time::Instant::now())
    }
}
impl Clock for MonotonicClock {
    fn now_ms(&self) -> u64 {
        self.0.elapsed().as_millis().try_into().unwrap_or(u64::MAX)
    }
}

// No Debug/Serialize/Deserialize. Filling on drop is best effort, not a secure
// erasure guarantee; no key material is written to disk or error strings.
struct Secret(Vec<u8>);
impl Drop for Secret {
    fn drop(&mut self) {
        self.0.fill(0);
    }
}
struct CredentialIdentity {
    generation: u64,
}
#[derive(Clone)]
pub(crate) struct CredentialHandle(Arc<CredentialIdentity>);
struct CredentialRecord {
    handle: CredentialHandle,
    secret: Secret,
    expires_at: u64,
}

/// A native source authority identity + generation, never a renderer assertion.
#[derive(Clone)]
pub(crate) struct SourceSnapshot {
    authority: Arc<()>,
    generation: u64,
    fingerprint: [u8; 32],
}
impl SourceSnapshot {
    pub(crate) fn generation(&self) -> u64 {
        self.generation
    }
    pub(crate) fn fingerprint(&self) -> [u8; 32] {
        self.fingerprint
    }
    fn same_as(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.authority, &other.authority)
            && self.generation == other.generation
            && self.fingerprint == other.fingerprint
    }
}
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) enum SourcePhase {
    Prepare,
    Approval,
    BeforeDispatch,
}
pub(crate) struct SourceCheckFailure;
/// Required on EVERY phase. Potential I/O/waits run outside the session lock.
/// Production must compare the actual captured source snapshot and publish every
/// change through SourceAuthority. There is intentionally no permissive default.
pub(crate) trait SourceChecker: Send + Sync {
    fn check(
        &self,
        captured: &SourceSnapshot,
        phase: SourcePhase,
    ) -> std::result::Result<SourceSnapshot, SourceCheckFailure>;
}

struct State {
    invalid: bool,
    revision: u64,
    next_lease: u64,
    credential_generation: u64,
    owner: Owner,
    config: ConfigVersion,
    credential: Option<CredentialRecord>,
    source: SourceSnapshot,
}
impl State {
    fn bump(&mut self) -> Result<()> {
        match self.revision.checked_add(1) {
            Some(next) => {
                self.revision = next;
                Ok(())
            }
            None => {
                self.invalid = true;
                Err(FailureCode::Unavailable)
            }
        }
    }
}
struct Shared {
    state: Mutex<State>,
    clock: Arc<dyn Clock>,
}
#[derive(Clone)]
pub(crate) struct NativeSession {
    shared: Arc<Shared>,
}
#[derive(Clone)]
pub(crate) struct SourceAuthority {
    shared: Arc<Shared>,
}
impl SourceAuthority {
    /// The real watcher/checker must call this on any source change, even when a
    /// later scan returns identical bytes. This shares the FINAL dispatch lock.
    pub(crate) fn advance(&self, fingerprint: [u8; 32]) -> Result<()> {
        let mut state = self
            .shared
            .state
            .lock()
            .map_err(|_| FailureCode::Unavailable)?;
        state.bump()?;
        state.source.generation = state.source.generation.checked_add(1).ok_or_else(|| {
            state.invalid = true;
            FailureCode::Unavailable
        })?;
        state.source.fingerprint = fingerprint;
        Ok(())
    }
    pub(crate) fn snapshot(&self) -> Result<SourceSnapshot> {
        let state = self
            .shared
            .state
            .lock()
            .map_err(|_| FailureCode::Unavailable)?;
        if state.invalid {
            return Err(FailureCode::Unavailable);
        }
        Ok(state.source.clone())
    }
}
struct LeaseToken {
    shared: Arc<Shared>,
    id: u64,
    revision: u64,
    expires_at: u64,
    owner: Owner,
    config: ConfigVersion,
    credential: CredentialHandle,
    source: SourceSnapshot,
    revoked: AtomicBool,
}
#[derive(Clone)]
pub(crate) struct Lease(Arc<LeaseToken>);
impl Lease {
    /// Currentness of this exact native lease; never creates or refreshes authority.
    pub(crate) fn is_current(&self) -> bool {
        let session = NativeSession {
            shared: self.0.shared.clone(),
        };
        let current = match session.shared.state.lock() {
            Ok(state) => session.validate(&state, self).is_ok(),
            Err(_) => false,
        };
        current
    }
    pub(crate) fn revoke(&self) -> Result<()> {
        let _guard = self
            .0
            .shared
            .state
            .lock()
            .map_err(|_| FailureCode::Unavailable)?;
        self.0.revoked.store(true, Ordering::Release);
        Ok(())
    }
}
impl NativeSession {
    /// source_fingerprint is supplied by a future REAL native source authority;
    /// constructing this object alone does not validate source or allow sending.
    pub(crate) fn new(
        owner: Owner,
        config: ConfigVersion,
        source_fingerprint: [u8; 32],
        clock: Arc<dyn Clock>,
    ) -> Self {
        Self {
            shared: Arc::new(Shared {
                state: Mutex::new(State {
                    invalid: false,
                    revision: 1,
                    next_lease: 0,
                    credential_generation: 0,
                    owner,
                    config,
                    credential: None,
                    source: SourceSnapshot {
                        authority: Arc::new(()),
                        generation: 1,
                        fingerprint: source_fingerprint,
                    },
                }),
                clock,
            }),
        }
    }
    pub(crate) fn source_authority(&self) -> SourceAuthority {
        SourceAuthority {
            shared: self.shared.clone(),
        }
    }
    pub(crate) fn install_credential(
        &self,
        bytes: Vec<u8>,
        expires_at: u64,
    ) -> Result<CredentialHandle> {
        let secret = Secret(bytes);
        if secret.0.is_empty()
            || secret.0.len() > MAX_CREDENTIAL_BYTES
            || secret.0.iter().any(|b| !(0x21..=0x7e).contains(b))
        {
            return Err(FailureCode::InvalidCredential);
        }
        let mut state = self
            .shared
            .state
            .lock()
            .map_err(|_| FailureCode::Unavailable)?;
        let now = self.shared.clock.now_ms();
        if expires_at.saturating_sub(now) > MAX_CREDENTIAL_TTL_MS {
            return Err(FailureCode::InvalidLifetime);
        }
        if expires_at <= now {
            return Err(FailureCode::Expired);
        }
        state.bump()?;
        let generation = state.credential_generation.checked_add(1).ok_or_else(|| {
            state.invalid = true;
            FailureCode::Unavailable
        })?;
        state.credential_generation = generation;
        let handle = CredentialHandle(Arc::new(CredentialIdentity { generation }));
        state.credential = Some(CredentialRecord {
            handle: handle.clone(),
            secret,
            expires_at,
        });
        Ok(handle)
    }
    pub(crate) fn clear_credential(&self) -> Result<()> {
        let mut state = self
            .shared
            .state
            .lock()
            .map_err(|_| FailureCode::Unavailable)?;
        state.bump()?;
        state.credential = None;
        Ok(())
    }
    pub(crate) fn revoke_all(&self) -> Result<()> {
        self.shared
            .state
            .lock()
            .map_err(|_| FailureCode::Unavailable)?
            .bump()
    }
    pub(crate) fn replace_owner(&self, owner: Owner) -> Result<()> {
        let mut state = self
            .shared
            .state
            .lock()
            .map_err(|_| FailureCode::Unavailable)?;
        state.bump()?;
        state.owner = owner;
        Ok(())
    }
    pub(crate) fn replace_config(&self, config: ConfigVersion) -> Result<()> {
        let mut state = self
            .shared
            .state
            .lock()
            .map_err(|_| FailureCode::Unavailable)?;
        state.bump()?;
        state.config = config;
        Ok(())
    }
    pub(crate) fn capture_lease(&self, expires_at: u64) -> Result<Lease> {
        let mut state = self
            .shared
            .state
            .lock()
            .map_err(|_| FailureCode::Unavailable)?;
        if state.invalid {
            return Err(FailureCode::Unavailable);
        }
        let now = self.shared.clock.now_ms();
        if expires_at.saturating_sub(now) > MAX_LEASE_TTL_MS {
            return Err(FailureCode::InvalidLifetime);
        }
        let credential = state
            .credential
            .as_ref()
            .ok_or(FailureCode::MissingCredential)?;
        let expires_at = expires_at.min(credential.expires_at);
        if expires_at <= now {
            return Err(FailureCode::Expired);
        }
        let credential = credential.handle.clone();
        state.next_lease = state.next_lease.checked_add(1).ok_or_else(|| {
            state.invalid = true;
            FailureCode::Unavailable
        })?;
        Ok(Lease(Arc::new(LeaseToken {
            shared: self.shared.clone(),
            id: state.next_lease,
            revision: state.revision,
            expires_at,
            owner: state.owner.clone(),
            config: state.config.clone(),
            credential,
            source: state.source.clone(),
            revoked: AtomicBool::new(false),
        })))
    }
    fn validate(&self, state: &State, lease: &Lease) -> Result<()> {
        if !Arc::ptr_eq(&self.shared, &lease.0.shared) || lease.0.revoked.load(Ordering::Acquire) {
            return Err(FailureCode::InvalidLease);
        }
        if state.invalid {
            return Err(FailureCode::Unavailable);
        }
        if self.shared.clock.now_ms() >= lease.0.expires_at {
            return Err(FailureCode::Expired);
        }
        if !state.source.same_as(&lease.0.source) {
            return Err(FailureCode::SourceChanged);
        }
        let credential = state
            .credential
            .as_ref()
            .ok_or(FailureCode::MissingCredential)?;
        if self.shared.clock.now_ms() >= credential.expires_at {
            return Err(FailureCode::Expired);
        }
        if state.revision != lease.0.revision
            || state.owner != lease.0.owner
            || state.config != lease.0.config
            || !Arc::ptr_eq(&credential.handle.0, &lease.0.credential.0)
        {
            return Err(FailureCode::IdentityChanged);
        }
        Ok(())
    }
    fn check_source(
        &self,
        lease: &Lease,
        checker: &dyn SourceChecker,
        phase: SourcePhase,
    ) -> Result<()> {
        {
            let state = self
                .shared
                .state
                .lock()
                .map_err(|_| FailureCode::Unavailable)?;
            self.validate(&state, lease)?;
        }
        // No session lock spans the callback: it may block, cancel or revoke.
        let observed = checker
            .check(&lease.0.source, phase)
            .map_err(|_| FailureCode::SourceUnavailable)?;
        if !observed.same_as(&lease.0.source) {
            return Err(FailureCode::SourceChanged);
        }
        let state = self
            .shared
            .state
            .lock()
            .map_err(|_| FailureCode::Unavailable)?;
        self.validate(&state, lease)
    }
    pub(crate) fn prepare(
        &self,
        lease: &Lease,
        base_url: &str,
        body: Vec<u8>,
        checker: &dyn SourceChecker,
    ) -> Result<PreparedRequest> {
        self.check_source(lease, checker, SourcePhase::Prepare)?;
        let endpoint = crate::provider_endpoint_policy::prepare_responses_endpoint(base_url)
            .map_err(|_| FailureCode::EndpointRejected)?;
        if body.is_empty() || body.len() > MAX_REQUEST_BYTES || std::str::from_utf8(&body).is_err()
        {
            return Err(FailureCode::InvalidBody);
        }
        // Inspect only model identity. Never reconstruct or reserialize the body.
        // serde rejects duplicate model fields instead of silently picking one.
        #[derive(Deserialize)]
        struct BodyModel {
            model: String,
        }
        let model: BodyModel =
            serde_json::from_slice(&body).map_err(|_| FailureCode::InvalidBody)?;
        if model.model != lease.0.owner.model {
            return Err(FailureCode::InvalidBody);
        }
        let binding = ApprovalBinding {
            body_sha256: Sha256::digest(&body).into(),
            endpoint,
            model: model.model,
            owner: lease.0.owner.clone(),
            config: lease.0.config.clone(),
            credential_generation: lease.0.credential.0.generation,
            lease_id: lease.0.id,
            source_generation: lease.0.source.generation,
            source_fingerprint: lease.0.source.fingerprint,
        };
        let prepared = PreparedRequest {
            lease: lease.clone(),
            identity: Arc::new(()),
            body: body.into(),
            binding,
            cancelled: AtomicBool::new(false),
            progress: AtomicU8::new(0),
        };
        let state = self
            .shared
            .state
            .lock()
            .map_err(|_| FailureCode::Unavailable)?;
        self.validate(&state, lease)?;
        Ok(prepared)
    }
    pub(crate) fn approve(
        &self,
        request: &PreparedRequest,
        lease: &Lease,
        checker: &dyn SourceChecker,
    ) -> Result<ApprovalGrant> {
        request.matches_lease(lease)?;
        request.verify_body()?;
        self.check_source(lease, checker, SourcePhase::Approval)?;
        let state = self
            .shared
            .state
            .lock()
            .map_err(|_| FailureCode::Unavailable)?;
        self.validate(&state, lease)?;
        if request.cancelled.load(Ordering::Acquire) {
            return Err(FailureCode::Cancelled);
        }
        if request.progress.load(Ordering::Acquire) != 0 {
            return Err(FailureCode::GrantConsumed);
        }
        Ok(ApprovalGrant {
            request: request.identity.clone(),
            lease: lease.clone(),
            binding: request.binding.clone(),
            consumed: AtomicBool::new(false),
        })
    }
    pub(crate) fn dispatch(
        &self,
        request: &PreparedRequest,
        lease: &Lease,
        approval: &ApprovalGrant,
        checker: &dyn SourceChecker,
        transport: &mut dyn Transport,
    ) -> DispatchOutcome {
        let preflight = (|| -> Result<()> {
            request.matches_lease(lease)?;
            request.verify_body()?;
            self.check_source(lease, checker, SourcePhase::BeforeDispatch)?;
            // Mandatory engine preflight may wait; it MUST NOT write a request.
            transport
                .before_dispatch(request.view())
                .map_err(|_| FailureCode::TransportFailed)?;
            Ok(())
        })();
        if let Err(code) = preflight {
            return request.failed(code);
        }
        let credential = {
            let state = match self.shared.state.lock() {
                Ok(state) => state,
                Err(_) => return request.failed(FailureCode::Unavailable),
            };
            // FINAL gate: memory-only checks under the SAME lock as revoke,
            // source generation advancement, owner/config updates and key clear.
            if let Err(code) = self.validate(&state, lease) {
                return request.failed(code);
            }
            if request.cancelled.load(Ordering::Acquire) {
                return request.failed(FailureCode::Cancelled);
            }
            if !Arc::ptr_eq(&request.identity, &approval.request)
                || !Arc::ptr_eq(&lease.0, &approval.lease.0)
                || approval.binding != request.binding
            {
                return request.failed(FailureCode::ApprovalMismatch);
            }
            if approval.consumed.load(Ordering::Acquire)
                || request.progress.load(Ordering::Acquire) != 0
            {
                return request.failed(FailureCode::GrantConsumed);
            }
            let credential = Secret(
                state
                    .credential
                    .as_ref()
                    .expect("validated credential")
                    .secret
                    .0
                    .clone(),
            );
            approval.consumed.store(true, Ordering::Release);
            // This is the dispatch linearization point. Revocation/cancellation
            // after it can no longer prove zero transmission, even if an engine
            // subsequently reports an error before confirming any write.
            request.progress.store(1, Ordering::Release);
            credential
        };
        let mut response = ResponseBuffer::new();
        let dispatched = transport.dispatch(
            request.view(),
            CredentialBytes(&credential.0),
            DispatchSignal { request },
            &mut response,
        );
        let (write, error) = match dispatched {
            Ok(receipt) => (receipt.write, None),
            Err(failure) => {
                // Keep detail internal; no formatting/logging/UI propagation.
                let _internal_detail = failure.detail;
                (failure.write, Some(FailureCode::TransportFailed))
            }
        };
        if write == WriteStatus::Complete {
            request.progress.store(2, Ordering::Release);
        }
        // A revoked/expired source, credential or owner cannot release stale
        // reply bytes. Dispatch status records writing independently of validity.
        let validity_error = self
            .shared
            .state
            .lock()
            .map_err(|_| FailureCode::Unavailable)
            .and_then(|state| self.validate(&state, lease))
            .err();
        let error = if response.exceeded {
            Some(FailureCode::ResponseLimit)
        } else if request.cancelled.load(Ordering::Acquire) {
            Some(FailureCode::Cancelled)
        } else {
            validity_error.or(error)
        };
        DispatchOutcome {
            status: request.status(),
            error,
            response: if error.is_none() {
                Some(RawResponse(response.bytes))
            } else {
                None
            },
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ApprovalBinding {
    pub body_sha256: [u8; 32],
    pub endpoint: String,
    pub model: String,
    pub owner: Owner,
    pub config: ConfigVersion,
    pub credential_generation: u64,
    pub lease_id: u64,
    pub source_generation: u64,
    pub source_fingerprint: [u8; 32],
}
// Neither approval nor lease/key authority is serializable/deserializable.
pub(crate) struct ApprovalGrant {
    request: Arc<()>,
    lease: Lease,
    binding: ApprovalBinding,
    consumed: AtomicBool,
}
pub(crate) struct PreparedRequest {
    lease: Lease,
    identity: Arc<()>,
    body: Arc<[u8]>,
    binding: ApprovalBinding,
    cancelled: AtomicBool,
    progress: AtomicU8,
}
impl PreparedRequest {
    pub(crate) fn binding(&self) -> &ApprovalBinding {
        &self.binding
    }
    pub(crate) fn cancel(&self) -> Result<()> {
        let _guard = self
            .lease
            .0
            .shared
            .state
            .lock()
            .map_err(|_| FailureCode::Unavailable)?;
        self.cancelled.store(true, Ordering::Release);
        Ok(())
    }
    fn matches_lease(&self, lease: &Lease) -> Result<()> {
        if !Arc::ptr_eq(&self.lease.0, &lease.0) {
            return Err(FailureCode::InvalidLease);
        }
        Ok(())
    }
    fn verify_body(&self) -> Result<()> {
        let digest: [u8; 32] = Sha256::digest(&self.body).into();
        if digest != self.binding.body_sha256 {
            return Err(FailureCode::ApprovalMismatch);
        }
        Ok(())
    }
    fn view(&self) -> RequestView<'_> {
        RequestView {
            endpoint: &self.binding.endpoint,
            model: &self.binding.model,
            owner: &self.binding.owner,
            body: &self.body,
        }
    }
    pub(crate) fn status(&self) -> DispatchStatus {
        match self.progress.load(Ordering::Acquire) {
            0 => DispatchStatus::NotDispatched,
            2 => DispatchStatus::Sent,
            _ => DispatchStatus::MayHaveBeenSent,
        }
    }
    fn failed(&self, error: FailureCode) -> DispatchOutcome {
        DispatchOutcome {
            status: self.status(),
            error: Some(error),
            response: None,
        }
    }
}
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) enum DispatchStatus {
    /// The final gate has not permitted dispatch; Transport::dispatch was not called.
    NotDispatched,
    /// Final gate permitted dispatch; complete request writing is not confirmed.
    MayHaveBeenSent,
    /// Engine confirms the whole request was written. Server processing is UNKNOWN.
    Sent,
}
pub(crate) struct DispatchOutcome {
    pub status: DispatchStatus,
    pub error: Option<FailureCode>,
    pub response: Option<RawResponse>,
}
pub(crate) struct RawResponse(Vec<u8>);
impl RawResponse {
    pub(crate) fn bytes(&self) -> &[u8] {
        &self.0
    }
}
#[derive(Copy, Clone)]
pub(crate) struct RequestView<'a> {
    pub endpoint: &'a str,
    pub model: &'a str,
    pub owner: &'a Owner,
    pub body: &'a [u8],
}
pub(crate) struct CredentialBytes<'a>(&'a [u8]);
impl CredentialBytes<'_> {
    pub(crate) fn bytes(&self) -> &[u8] {
        self.0
    }
}
pub(crate) struct DispatchSignal<'a> {
    request: &'a PreparedRequest,
}
impl DispatchSignal<'_> {
    pub(crate) fn is_cancelled(&self) -> bool {
        if self.request.cancelled.load(Ordering::Acquire) {
            return true;
        }
        let session = NativeSession {
            shared: self.request.lease.0.shared.clone(),
        };
        let invalid = match session.shared.state.lock() {
            Ok(state) => session.validate(&state, &self.request.lease).is_err(),
            Err(_) => true,
        };
        invalid
    }
}
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub(crate) enum WriteStatus {
    MayHaveWritten,
    Complete,
}
pub(crate) struct WriteReceipt {
    pub write: WriteStatus,
}
pub(crate) struct TransportFailure {
    write: WriteStatus,
    detail: String,
}
impl TransportFailure {
    pub(crate) fn new(write: WriteStatus, detail: String) -> Self {
        Self { write, detail }
    }
}
/// No default engine exists. before_dispatch must perform NO network writes;
/// dispatch owns all irreversible I/O and must report whether writing completed.
pub(crate) trait Transport {
    fn before_dispatch(
        &mut self,
        request: RequestView<'_>,
    ) -> std::result::Result<(), TransportFailure>;
    fn dispatch(
        &mut self,
        request: RequestView<'_>,
        credential: CredentialBytes<'_>,
        signal: DispatchSignal<'_>,
        response: &mut ResponseBuffer,
    ) -> std::result::Result<WriteReceipt, TransportFailure>;
}
pub(crate) struct ResponseBuffer {
    bytes: Vec<u8>,
    exceeded: bool,
    chunks: usize,
}
impl ResponseBuffer {
    fn new() -> Self {
        Self {
            bytes: Vec::new(),
            exceeded: false,
            chunks: 0,
        }
    }
    pub(crate) fn push(&mut self, chunk: &[u8]) -> Result<()> {
        // Count every raw chunk, including empty chunks. Sticky failure survives
        // engines that swallow a push error and later return a successful receipt.
        self.chunks = match self.chunks.checked_add(1) {
            Some(count) if count <= MAX_RAW_CHUNKS => count,
            _ => {
                self.exceeded = true;
                return Err(FailureCode::ResponseLimit);
            }
        };
        if self.exceeded
            || chunk.len() > MAX_CHUNK_BYTES
            || self
                .bytes
                .len()
                .checked_add(chunk.len())
                .map_or(true, |size| size > MAX_RESPONSE_BYTES)
        {
            self.exceeded = true;
            return Err(FailureCode::ResponseLimit);
        }
        self.bytes.extend_from_slice(chunk);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{atomic::AtomicU64, mpsc};
    const FIXTURE_KEY: &[u8] = b"synthetic-fixture-native-key-ONLY";
    struct SyntheticClock(AtomicU64);
    impl Clock for SyntheticClock {
        fn now_ms(&self) -> u64 {
            self.0.load(Ordering::SeqCst)
        }
    }
    struct SyntheticSourceChecker;
    impl SourceChecker for SyntheticSourceChecker {
        fn check(
            &self,
            captured: &SourceSnapshot,
            _: SourcePhase,
        ) -> std::result::Result<SourceSnapshot, SourceCheckFailure> {
            Ok(captured.clone())
        }
    }
    struct CallbackChecker<F>(F);
    impl<F> SourceChecker for CallbackChecker<F>
    where
        F: Fn(
                &SourceSnapshot,
                SourcePhase,
            ) -> std::result::Result<SourceSnapshot, SourceCheckFailure>
            + Send
            + Sync,
    {
        fn check(
            &self,
            captured: &SourceSnapshot,
            phase: SourcePhase,
        ) -> std::result::Result<SourceSnapshot, SourceCheckFailure> {
            self.0(captured, phase)
        }
    }
    fn owner() -> Owner {
        Owner {
            project: "synthetic-fixed-project".into(),
            epoch: 1,
            run: "synthetic-run".into(),
            conversation: "synthetic-conversation".into(),
            provider: "synthetic-openai".into(),
            model: "synthetic-model".into(),
        }
    }
    fn config() -> ConfigVersion {
        ConfigVersion {
            generation: "synthetic-config-generation".into(),
            revision: 1,
        }
    }
    fn setup() -> (NativeSession, Arc<SyntheticClock>, Lease) {
        let clock = Arc::new(SyntheticClock(AtomicU64::new(100)));
        let session = NativeSession::new(owner(), config(), [7; 32], clock.clone());
        session
            .install_credential(FIXTURE_KEY.to_vec(), 1000)
            .unwrap();
        let lease = session.capture_lease(500).unwrap();
        (session, clock, lease)
    }
    fn body() -> Vec<u8> {
        "{ \"model\":\"synthetic-model\", \"input\":\"合成 UTF8\" }\n"
            .as_bytes()
            .to_vec()
    }
    fn prepared(session: &NativeSession, lease: &Lease) -> PreparedRequest {
        session
            .prepare(
                lease,
                "https://api.openai.com/v1",
                body(),
                &SyntheticSourceChecker,
            )
            .unwrap()
    }
    struct SyntheticTransport<'a> {
        calls: usize,
        before: Option<Box<dyn FnMut() + 'a>>,
        during: Option<Box<dyn FnMut() + 'a>>,
        write: WriteStatus,
        fail_with_credential: bool,
        chunks: Vec<Vec<u8>>,
        swallow_limit: bool,
        seen_body: Vec<u8>,
        seen_endpoint: String,
        signal_before: bool,
        signal_after: bool,
    }
    impl SyntheticTransport<'_> {
        fn new() -> Self {
            Self {
                calls: 0,
                before: None,
                during: None,
                write: WriteStatus::Complete,
                fail_with_credential: false,
                chunks: vec![b"synthetic raw \xff\x00 bytes".to_vec()],
                swallow_limit: false,
                seen_body: Vec::new(),
                seen_endpoint: String::new(),
                signal_before: false,
                signal_after: false,
            }
        }
    }
    impl Transport for SyntheticTransport<'_> {
        fn before_dispatch(
            &mut self,
            _: RequestView<'_>,
        ) -> std::result::Result<(), TransportFailure> {
            if let Some(hook) = self.before.as_mut() {
                hook();
            }
            Ok(())
        }
        fn dispatch(
            &mut self,
            request: RequestView<'_>,
            credential: CredentialBytes<'_>,
            signal: DispatchSignal<'_>,
            response: &mut ResponseBuffer,
        ) -> std::result::Result<WriteReceipt, TransportFailure> {
            self.calls += 1;
            self.seen_body = request.body.to_vec();
            self.seen_endpoint = request.endpoint.into();
            self.signal_before = signal.is_cancelled();
            if let Some(hook) = self.during.as_mut() {
                hook();
            }
            self.signal_after = signal.is_cancelled();
            if self.fail_with_credential {
                return Err(TransportFailure::new(
                    self.write,
                    format!(
                        "synthetic internal Authorization: {}",
                        String::from_utf8_lossy(credential.bytes())
                    ),
                ));
            }
            for chunk in &self.chunks {
                if response.push(chunk).is_err() && !self.swallow_limit {
                    return Err(TransportFailure::new(
                        self.write,
                        "synthetic response limit".into(),
                    ));
                }
            }
            Ok(WriteReceipt { write: self.write })
        }
    }
    fn assert_zero(outcome: DispatchOutcome, transport: &SyntheticTransport<'_>) {
        assert_eq!(outcome.status, DispatchStatus::NotDispatched);
        assert!(outcome.error.is_some());
        assert!(outcome.response.is_none());
        assert_eq!(transport.calls, 0);
    }
    #[test]
    fn synthetic_dispatch_preserves_original_utf8_body_and_raw_response_bytes() {
        let (session, _, lease) = setup();
        let request = prepared(&session, &lease);
        let grant = session
            .approve(&request, &lease, &SyntheticSourceChecker)
            .unwrap();
        let mut engine = SyntheticTransport::new();
        let expected = engine.chunks.concat();
        let result = session.dispatch(
            &request,
            &lease,
            &grant,
            &SyntheticSourceChecker,
            &mut engine,
        );
        assert_eq!(engine.calls, 1);
        assert_eq!(engine.seen_body, body());
        assert_eq!(engine.seen_endpoint, "https://api.openai.com/v1/responses");
        assert_eq!(
            request.binding().body_sha256,
            <[u8; 32]>::from(Sha256::digest(body()))
        );
        assert_eq!(result.status, DispatchStatus::Sent);
        assert!(result.error.is_none());
        assert_eq!(result.response.unwrap().bytes(), expected);
        assert!(!engine.signal_before && !engine.signal_after);
    }
    #[test]
    fn missing_credentials_and_lifetime_limits_fail_closed() {
        let clock = Arc::new(SyntheticClock(AtomicU64::new(100)));
        let session = NativeSession::new(owner(), config(), [7; 32], clock.clone());
        assert_eq!(
            session.capture_lease(500).err().unwrap(),
            FailureCode::MissingCredential
        );
        assert_eq!(
            session
                .install_credential(FIXTURE_KEY.to_vec(), 100)
                .err()
                .unwrap(),
            FailureCode::Expired
        );
        assert_eq!(
            session
                .install_credential(FIXTURE_KEY.to_vec(), 101 + MAX_CREDENTIAL_TTL_MS)
                .err()
                .unwrap(),
            FailureCode::InvalidLifetime
        );
        session
            .install_credential(FIXTURE_KEY.to_vec(), 100 + MAX_CREDENTIAL_TTL_MS)
            .unwrap();
        assert_eq!(
            session.capture_lease(101 + MAX_LEASE_TTL_MS).err().unwrap(),
            FailureCode::InvalidLifetime
        );
        assert!(session.capture_lease(100 + MAX_LEASE_TTL_MS).is_ok());
        assert_eq!(
            session
                .install_credential(b"synthetic\r\nheader".to_vec(), 200)
                .err()
                .unwrap(),
            FailureCode::InvalidCredential
        );
    }
    #[test]
    fn revocation_or_expiry_while_approval_waits_never_dispatches() {
        for expire in [false, true] {
            let (session, clock, lease) = setup();
            let request = prepared(&session, &lease);
            let (entered_tx, entered_rx) = mpsc::channel();
            let (resume_tx, resume_rx) = mpsc::channel();
            let resume_rx = Mutex::new(resume_rx);
            let checker = CallbackChecker(|captured: &SourceSnapshot, phase| {
                if phase == SourcePhase::Approval {
                    entered_tx.send(()).unwrap();
                    resume_rx
                        .lock()
                        .unwrap()
                        .recv_timeout(std::time::Duration::from_secs(3))
                        .unwrap();
                }
                Ok(captured.clone())
            });
            std::thread::scope(|scope| {
                let approval = scope.spawn(|| session.approve(&request, &lease, &checker));
                entered_rx
                    .recv_timeout(std::time::Duration::from_secs(3))
                    .unwrap();
                if expire {
                    clock.0.store(1001, Ordering::SeqCst);
                } else {
                    lease.revoke().unwrap();
                }
                resume_tx.send(()).unwrap();
                assert!(approval.join().unwrap().is_err());
            });
            assert_eq!(request.status(), DispatchStatus::NotDispatched);
        }
    }
    #[test]
    fn revocation_or_expiry_after_approval_never_dispatches() {
        for expire in [false, true] {
            let (session, clock, lease) = setup();
            let request = prepared(&session, &lease);
            let grant = session
                .approve(&request, &lease, &SyntheticSourceChecker)
                .unwrap();
            if expire {
                clock.0.store(1001, Ordering::SeqCst);
            } else {
                lease.revoke().unwrap();
            }
            let mut engine = SyntheticTransport::new();
            assert_zero(
                session.dispatch(
                    &request,
                    &lease,
                    &grant,
                    &SyntheticSourceChecker,
                    &mut engine,
                ),
                &engine,
            );
        }
    }
    #[test]
    fn blocking_source_callback_does_not_block_revocation_or_expiry() {
        for expire in [false, true] {
            let (session, clock, lease) = setup();
            let request = prepared(&session, &lease);
            let grant = session
                .approve(&request, &lease, &SyntheticSourceChecker)
                .unwrap();
            let (entered_tx, entered_rx) = mpsc::channel();
            let (resume_tx, resume_rx) = mpsc::channel();
            let resume_rx = Mutex::new(resume_rx);
            let checker = CallbackChecker(|captured: &SourceSnapshot, phase| {
                if phase == SourcePhase::BeforeDispatch {
                    entered_tx.send(()).unwrap();
                    resume_rx
                        .lock()
                        .unwrap()
                        .recv_timeout(std::time::Duration::from_secs(3))
                        .unwrap();
                }
                Ok(captured.clone())
            });
            std::thread::scope(|scope| {
                let dispatch = scope.spawn(|| {
                    let mut engine = SyntheticTransport::new();
                    let outcome = session.dispatch(&request, &lease, &grant, &checker, &mut engine);
                    assert_zero(outcome, &engine);
                });
                entered_rx
                    .recv_timeout(std::time::Duration::from_secs(3))
                    .unwrap();
                if expire {
                    clock.0.store(1001, Ordering::SeqCst);
                } else {
                    lease.revoke().unwrap();
                }
                resume_tx.send(()).unwrap();
                dispatch.join().unwrap();
            });
        }
    }
    #[test]
    fn final_gate_rechecks_fixed_lease_and_source_after_engine_before_dispatch_wait() {
        for mode in ["revoke", "expire", "source", "cancel"] {
            let (session, clock, lease) = setup();
            let request = prepared(&session, &lease);
            let grant = session
                .approve(&request, &lease, &SyntheticSourceChecker)
                .unwrap();
            let mut engine = SyntheticTransport::new();
            engine.before = Some(Box::new(|| match mode {
                "revoke" => lease.revoke().unwrap(),
                "expire" => clock.0.store(1001, Ordering::SeqCst),
                "source" => session.source_authority().advance([8; 32]).unwrap(),
                _ => request.cancel().unwrap(),
            }));
            assert_zero(
                session.dispatch(
                    &request,
                    &lease,
                    &grant,
                    &SyntheticSourceChecker,
                    &mut engine,
                ),
                &engine,
            );
        }
    }
    #[test]
    fn old_lease_cannot_be_replaced_by_new_lease_for_the_same_project() {
        let (session, _, old) = setup();
        let request = prepared(&session, &old);
        let grant = session
            .approve(&request, &old, &SyntheticSourceChecker)
            .unwrap();
        session.revoke_all().unwrap();
        let fresh = session.capture_lease(500).unwrap();
        assert_eq!(old.0.owner.project, fresh.0.owner.project);
        assert_eq!(
            session
                .approve(&request, &fresh, &SyntheticSourceChecker)
                .err()
                .unwrap(),
            FailureCode::InvalidLease
        );
        let mut engine = SyntheticTransport::new();
        assert_zero(
            session.dispatch(
                &request,
                &fresh,
                &grant,
                &SyntheticSourceChecker,
                &mut engine,
            ),
            &engine,
        );
    }
    #[test]
    fn single_use_grant_and_request_identity_prevent_replay() {
        let (session, _, lease) = setup();
        let request = prepared(&session, &lease);
        let other = prepared(&session, &lease);
        let grant = session
            .approve(&request, &lease, &SyntheticSourceChecker)
            .unwrap();
        let mut engine = SyntheticTransport::new();
        assert_zero(
            session.dispatch(&other, &lease, &grant, &SyntheticSourceChecker, &mut engine),
            &engine,
        );
        assert!(session
            .dispatch(
                &request,
                &lease,
                &grant,
                &SyntheticSourceChecker,
                &mut engine
            )
            .error
            .is_none());
        let replay = session.dispatch(
            &request,
            &lease,
            &grant,
            &SyntheticSourceChecker,
            &mut engine,
        );
        assert_eq!(replay.error, Some(FailureCode::GrantConsumed));
        assert_eq!(engine.calls, 1);
    }
    #[test]
    fn approval_binds_exact_body_model_endpoint_owner_and_configuration() {
        for field in ["body", "model", "endpoint", "owner", "config"] {
            let (session, _, lease) = setup();
            let mut request = prepared(&session, &lease);
            let grant = session
                .approve(&request, &lease, &SyntheticSourceChecker)
                .unwrap();
            match field {
                "body" => {
                    let mut changed = body();
                    changed.push(b' ');
                    request.body = changed.into();
                }
                "model" => request.binding.model.push_str("-changed"),
                "endpoint" => request.binding.endpoint.push_str("/changed"),
                "owner" => request.binding.owner.run.push_str("-changed"),
                _ => request.binding.config.revision += 1,
            }
            let mut engine = SyntheticTransport::new();
            assert_zero(
                session.dispatch(
                    &request,
                    &lease,
                    &grant,
                    &SyntheticSourceChecker,
                    &mut engine,
                ),
                &engine,
            );
        }
    }
    #[test]
    fn owner_configuration_and_credential_generation_changes_invalidate_old_grants() {
        for field in [
            "epoch",
            "run",
            "conversation",
            "provider",
            "model",
            "config",
            "credential",
            "clear",
        ] {
            let (session, _, lease) = setup();
            let request = prepared(&session, &lease);
            let grant = session
                .approve(&request, &lease, &SyntheticSourceChecker)
                .unwrap();
            let mut changed = owner();
            match field {
                "epoch" => {
                    changed.epoch += 1;
                    session.replace_owner(changed).unwrap();
                }
                "run" => {
                    changed.run.push('2');
                    session.replace_owner(changed).unwrap();
                }
                "conversation" => {
                    changed.conversation.push('2');
                    session.replace_owner(changed).unwrap();
                }
                "provider" => {
                    changed.provider.push('2');
                    session.replace_owner(changed).unwrap();
                }
                "model" => {
                    changed.model.push('2');
                    session.replace_owner(changed).unwrap();
                }
                "config" => {
                    let mut value = config();
                    value.revision += 1;
                    session.replace_config(value).unwrap();
                }
                "credential" => {
                    session
                        .install_credential(FIXTURE_KEY.to_vec(), 1000)
                        .unwrap();
                }
                _ => session.clear_credential().unwrap(),
            }
            let mut engine = SyntheticTransport::new();
            assert_zero(
                session.dispatch(
                    &request,
                    &lease,
                    &grant,
                    &SyntheticSourceChecker,
                    &mut engine,
                ),
                &engine,
            );
        }
    }
    #[test]
    fn source_failure_and_new_source_snapshot_never_refresh_a_prepared_request() {
        let (session, _, lease) = setup();
        let denied = CallbackChecker(|_: &SourceSnapshot, _| Err(SourceCheckFailure));
        assert_eq!(
            session
                .prepare(&lease, "https://api.openai.com/v1", body(), &denied)
                .err()
                .unwrap(),
            FailureCode::SourceUnavailable
        );
        let request = prepared(&session, &lease);
        let checker = CallbackChecker(|_: &SourceSnapshot, _| {
            session.source_authority().advance([7; 32]).unwrap();
            Ok(session.source_authority().snapshot().unwrap())
        });
        assert_eq!(
            session.approve(&request, &lease, &checker).err().unwrap(),
            FailureCode::SourceChanged
        );
    }
    #[test]
    fn in_flight_invalidation_sets_signal_and_discards_stale_reply_without_unsending() {
        for mode in [
            "source",
            "clear",
            "credential",
            "owner",
            "config",
            "revokeAll",
            "revokeLease",
            "expire",
        ] {
            for write in [WriteStatus::MayHaveWritten, WriteStatus::Complete] {
                let (session, clock, lease) = setup();
                let request = prepared(&session, &lease);
                let grant = session
                    .approve(&request, &lease, &SyntheticSourceChecker)
                    .unwrap();
                let mut engine = SyntheticTransport::new();
                engine.write = write;
                engine.during = Some(Box::new(|| match mode {
                    "source" => session.source_authority().advance([8; 32]).unwrap(),
                    "clear" => session.clear_credential().unwrap(),
                    "credential" => {
                        session
                            .install_credential(FIXTURE_KEY.to_vec(), 1000)
                            .unwrap();
                    }
                    "owner" => {
                        let mut value = owner();
                        value.epoch += 1;
                        session.replace_owner(value).unwrap();
                    }
                    "config" => {
                        let mut value = config();
                        value.revision += 1;
                        session.replace_config(value).unwrap();
                    }
                    "revokeAll" => session.revoke_all().unwrap(),
                    "revokeLease" => lease.revoke().unwrap(),
                    _ => clock.0.store(1001, Ordering::SeqCst),
                }));
                let outcome = session.dispatch(
                    &request,
                    &lease,
                    &grant,
                    &SyntheticSourceChecker,
                    &mut engine,
                );
                assert_eq!(engine.calls, 1);
                assert!(!engine.signal_before && engine.signal_after);
                assert!(outcome.error.is_some());
                assert!(outcome.response.is_none());
                assert_eq!(
                    outcome.status,
                    if write == WriteStatus::Complete {
                        DispatchStatus::Sent
                    } else {
                        DispatchStatus::MayHaveBeenSent
                    }
                );
            }
        }
    }
    #[test]
    fn cancellation_before_and_after_dispatch_have_distinct_send_statuses() {
        let (session, _, lease) = setup();
        let request = prepared(&session, &lease);
        let grant = session
            .approve(&request, &lease, &SyntheticSourceChecker)
            .unwrap();
        request.cancel().unwrap();
        let mut engine = SyntheticTransport::new();
        assert_zero(
            session.dispatch(
                &request,
                &lease,
                &grant,
                &SyntheticSourceChecker,
                &mut engine,
            ),
            &engine,
        );
        let request = prepared(&session, &lease);
        let grant = session
            .approve(&request, &lease, &SyntheticSourceChecker)
            .unwrap();
        let mut engine = SyntheticTransport::new();
        engine.write = WriteStatus::MayHaveWritten;
        engine.during = Some(Box::new(|| request.cancel().unwrap()));
        let outcome = session.dispatch(
            &request,
            &lease,
            &grant,
            &SyntheticSourceChecker,
            &mut engine,
        );
        assert_eq!(outcome.status, DispatchStatus::MayHaveBeenSent);
        assert_eq!(outcome.error, Some(FailureCode::Cancelled));
        assert!(outcome.response.is_none());
    }
    #[test]
    fn transport_error_details_containing_fixture_credentials_are_never_returned() {
        for write in [WriteStatus::MayHaveWritten, WriteStatus::Complete] {
            let (session, _, lease) = setup();
            let request = prepared(&session, &lease);
            let grant = session
                .approve(&request, &lease, &SyntheticSourceChecker)
                .unwrap();
            let mut engine = SyntheticTransport::new();
            engine.fail_with_credential = true;
            engine.write = write;
            let outcome = session.dispatch(
                &request,
                &lease,
                &grant,
                &SyntheticSourceChecker,
                &mut engine,
            );
            assert_eq!(outcome.error.unwrap().code(), "native_transport_failed");
            assert!(outcome.response.is_none());
            assert_eq!(
                outcome.status,
                if write == WriteStatus::Complete {
                    DispatchStatus::Sent
                } else {
                    DispatchStatus::MayHaveBeenSent
                }
            );
        }
    }
    #[test]
    fn request_size_utf8_and_duplicate_or_mismatched_model_are_rejected() {
        let (session, _, lease) = setup();
        for invalid in [
            vec![b' '; MAX_REQUEST_BYTES + 1],
            vec![0xff],
            br#"{"model":"other"}"#.to_vec(),
            br#"{"model":"other","model":"synthetic-model"}"#.to_vec(),
        ] {
            assert_eq!(
                session
                    .prepare(
                        &lease,
                        "https://api.openai.com/v1",
                        invalid,
                        &SyntheticSourceChecker
                    )
                    .err()
                    .unwrap(),
                FailureCode::InvalidBody
            );
        }
        assert_eq!(
            session
                .prepare(
                    &lease,
                    "https://configured.invalid/v1",
                    body(),
                    &SyntheticSourceChecker
                )
                .err()
                .unwrap(),
            FailureCode::EndpointRejected
        );
    }
    #[test]
    fn response_total_chunk_size_and_chunk_count_limits_are_sticky_even_if_engine_ignores_errors() {
        for chunks in [
            vec![vec![0; MAX_CHUNK_BYTES + 1]],
            vec![vec![0; MAX_CHUNK_BYTES]; MAX_RESPONSE_BYTES / MAX_CHUNK_BYTES + 1],
            vec![Vec::new(); MAX_RAW_CHUNKS + 1],
            vec![vec![0]; MAX_RAW_CHUNKS + 1],
        ] {
            let (session, _, lease) = setup();
            let request = prepared(&session, &lease);
            let grant = session
                .approve(&request, &lease, &SyntheticSourceChecker)
                .unwrap();
            let mut engine = SyntheticTransport::new();
            engine.chunks = chunks;
            engine.swallow_limit = true;
            let outcome = session.dispatch(
                &request,
                &lease,
                &grant,
                &SyntheticSourceChecker,
                &mut engine,
            );
            assert_eq!(outcome.error, Some(FailureCode::ResponseLimit));
            assert!(outcome.response.is_none());
            assert_eq!(outcome.status, DispatchStatus::Sent);
        }
    }
}
