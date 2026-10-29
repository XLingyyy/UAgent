//! T10 existing-source repair boundary. No IPC, provider, shell, scheduler or approval UI.
#![cfg(windows)]
use crate::trusted_root_handle::{
    BoundReadFile, PinnedDirectory, ReadRule, ScopedReader, TrustedRootHandle,
};
use crate::ue_build_repair_io::{self as io, ExclusiveFile, IdentityPin};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
const FILE_LIMIT: usize = 256 * 1024;
const TEXT_BUDGET: usize = 1024 * 1024;
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepairBinding {
    pub host_session_id: String,
    pub project_id: String,
    pub root_object_id: String,
    pub run_id: String,
    pub profile_fingerprint: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepairBuildOwner {
    pub run_id: String,
    pub step_id: String,
    pub fingerprint: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepairDiagnosticRef {
    pub diagnostic_id: String,
    pub build_owner: RepairBuildOwner,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairSourceSnapshot {
    pub path: String,
    pub content: String,
    pub sha256: String,
    pub object_identity: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairSnapshot {
    pub binding: RepairBinding,
    pub diagnostic: RepairDiagnosticRef,
    pub snapshot_id: String,
    pub files: Vec<RepairSourceSnapshot>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepairFilePreview {
    pub path: String,
    pub before: String,
    pub after: String,
    pub before_hash: String,
    pub after_hash: String,
    pub before_object_identity: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepairPreviewInput {
    pub binding: RepairBinding,
    pub diagnostic: RepairDiagnosticRef,
    pub snapshot_id: String,
    pub preview_id: String,
    pub files: Vec<RepairFilePreview>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeRepairPreview {
    pub preview: RepairPreviewInput,
    pub native_plan_digest: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairFileEffect {
    pub path: String,
    pub status: String,
    pub before_hash: String,
    pub before_object_identity: String,
    pub after_hash: Option<String>,
    pub after_object_identity: Option<String>,
    pub reason: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairApplyReceipt {
    pub binding: RepairBinding,
    pub diagnostic: RepairDiagnosticRef,
    pub preview_id: String,
    pub status: String,
    pub reason: String,
    pub effects: Vec<RepairFileEffect>,
    pub recovery_record: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairQueryFile {
    pub path: String,
    pub sha256: String,
    pub object_identity: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairRecoveryQuery {
    pub binding: RepairBinding,
    pub diagnostic: RepairDiagnosticRef,
    pub preview_id: String,
    pub query_id: String,
    pub files: Vec<RepairQueryFile>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairRecoveryBundle {
    pub schema_version: u32,
    pub preview: NativeRepairPreview,
}
/// Store the complete before bundle durably before any source write. Error prevents source writes.
pub trait RepairJournal {
    fn persist_before(&mut self, bundle: &RepairRecoveryBundle) -> Result<String, String>;
}
/// Existing, explicitly host-owned recovery directory; new exclusive records only, no overwrite.
pub struct DirectoryRepairJournal {
    directory: PinnedDirectory,
}
impl DirectoryRepairJournal {
    pub fn from_verified_host_directory(directory: PinnedDirectory) -> Self {
        Self { directory }
    }
}
impl RepairJournal for DirectoryRepairJournal {
    fn persist_before(&mut self, b: &RepairRecoveryBundle) -> Result<String, String> {
        let bytes =
            serde_json::to_vec_pretty(b).map_err(|_| "repair_backup_serialization_failed")?;
        let leaf = format!("repair-{}.before.json", b.preview.native_plan_digest);
        io::create_recovery_record(&self.directory, &leaf, &bytes)?;
        Ok(leaf)
    }
}
/// Never deserialized or accepted from the model. The host UI/approval registry creates this
/// only after reviewing this exact native preview under its existing live resource/run lease.
pub struct NativeRepairGrant {
    binding: RepairBinding,
    digest: String,
    started: Instant,
    ttl: Duration,
    used: bool,
    revoked: Arc<AtomicBool>,
}
impl NativeRepairGrant {
    pub fn from_verified_host_approval(
        p: &NativeRepairPreview,
        ttl_ms: u64,
    ) -> Result<Self, String> {
        if io::hash(
            &serde_json::to_vec(&p.preview).map_err(|_| "repair_plan_serialization_failed")?,
        ) != p.native_plan_digest
        {
            return Err("repair_approval_preview_digest_mismatch".into());
        }
        if !(1..=600_000).contains(&ttl_ms) {
            return Err("repair_invalid_approval_ttl".into());
        }
        Ok(Self {
            binding: p.preview.binding.clone(),
            digest: p.native_plan_digest.clone(),
            started: Instant::now(),
            ttl: Duration::from_millis(ttl_ms),
            used: false,
            revoked: Arc::new(AtomicBool::new(false)),
        })
    }
    pub fn revoke(&self) {
        self.revoked.store(true, Ordering::Release);
    }
    pub fn revocation_handle(&self) -> RepairGrantRevocation {
        RepairGrantRevocation(self.revoked.clone())
    }
    pub fn consumed(&self) -> bool {
        self.used
    }
    fn valid(&self, p: &NativeRepairPreview) -> bool {
        !self.used
            && !self.revoked.load(Ordering::Acquire)
            && self.started.elapsed() < self.ttl
            && self.binding == p.preview.binding
            && self.digest == p.native_plan_digest
    }
}
#[derive(Clone)]
pub struct RepairGrantRevocation(Arc<AtomicBool>);
impl RepairGrantRevocation {
    pub fn revoke(&self) {
        self.0.store(true, Ordering::Release);
    }
}
struct PreparedRecord {
    public: NativeRepairPreview,
    parents: Vec<PinnedDirectory>,
    identity_pins: Vec<Arc<IdentityPin>>,
    used: bool,
    last_receipt: Option<RepairApplyReceipt>,
}
/// After-state read guards for the exact registered applied changeset. Not a build approval.
/// Keep through T09 execution; changed source files deny ordinary writes/replacement while held.
pub struct RepairBuildInputs {
    root: TrustedRootHandle,
    preview_id: String,
    files: Vec<BoundReadFile>,
    sources: Vec<RepairQueryFile>,
}
impl RepairBuildInputs {
    pub fn preview_id(&self) -> &str {
        &self.preview_id
    }
    pub fn expected_sources(&self) -> &[RepairQueryFile] {
        &self.sources
    }
    pub fn check_current(&mut self) -> Result<(), String> {
        self.root.check_current().map_err(|e| e.to_string())?;
        for (file, expected) in self.files.iter_mut().zip(&self.sources) {
            let o = file.read_bounded(FILE_LIMIT).map_err(|e| e.to_string())?;
            if io::hash(&o.bytes) != expected.sha256
                || o.file_identity.observation_key() != expected.object_identity
            {
                return Err("repair_build_after_state_changed".into());
            }
        }
        self.root.check_current().map_err(|e| e.to_string())
    }
}
/// Native-owned current-run object. Caller must hold the global project/build resource lease.
/// Exact allowed paths/read authority and the diagnostic reference come from trusted host state.
pub struct RepairSession {
    root: TrustedRootHandle,
    reader: ScopedReader,
    binding: RepairBinding,
    diagnostic: RepairDiagnosticRef,
    allowed: BTreeSet<String>,
    snapshot: Option<RepairSnapshot>,
    identity_pins: BTreeMap<String, Arc<IdentityPin>>,
    sequence: u64,
    prepared: BTreeMap<String, PreparedRecord>,
    revoked: bool,
}
fn hex(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn opaque(s: &str) -> bool {
    !s.is_empty() && s.len() <= 256 && !s.chars().any(char::is_control)
}
fn source_path(path: &str) -> Result<(), String> {
    ReadRule::exact_file(path).map_err(|e| e.to_string())?;
    if path.contains('\\')
        || !path.starts_with("Source/")
        || path.split('/').any(|p| {
            [
                "Binaries",
                "Intermediate",
                "Saved",
                "Content",
                "Plugins",
                ".git",
            ]
            .iter()
            .any(|b| p.eq_ignore_ascii_case(b))
        })
        || !(path.ends_with(".cpp")
            || path.ends_with(".h")
            || path.ends_with(".hpp")
            || path.ends_with(".Build.cs"))
    {
        return Err("repair_source_scope_or_extension_rejected".into());
    }
    Ok(())
}
impl RepairSession {
    pub fn from_verified_host(
        root: TrustedRootHandle,
        binding: RepairBinding,
        diagnostic: RepairDiagnosticRef,
        allowed_paths: Vec<String>,
    ) -> Result<Self, String> {
        root.check_current().map_err(|e| e.to_string())?;
        if !opaque(&binding.host_session_id)
            || !opaque(&binding.project_id)
            || !opaque(&binding.run_id)
            || binding.root_object_id != root.identity().observation_key()
            || !hex(&binding.profile_fingerprint)
            || !hex(&diagnostic.diagnostic_id)
            || diagnostic.build_owner.run_id != binding.run_id
            || diagnostic.build_owner.fingerprint != binding.profile_fingerprint
            || !opaque(&diagnostic.build_owner.step_id)
        {
            return Err("repair_host_binding_invalid".into());
        }
        if allowed_paths.is_empty() || allowed_paths.len() > 8 {
            return Err("repair_exact_file_scope_required".into());
        }
        let mut allowed = BTreeSet::new();
        let mut folded = BTreeSet::new();
        for p in allowed_paths {
            source_path(&p)?;
            if !folded.insert(p.to_ascii_lowercase()) || !allowed.insert(p) {
                return Err("repair_duplicate_file_scope".into());
            }
        }
        // The public session API only permits the exact host-approved files in `allowed`.
        let reader = root
            .scope_from_verified_host(vec![ReadRule::subtree("Source").map_err(|e| e.to_string())?])
            .map_err(|e| e.to_string())?;
        Ok(Self {
            root,
            reader,
            binding,
            diagnostic,
            allowed,
            snapshot: None,
            identity_pins: BTreeMap::new(),
            sequence: 0,
            prepared: BTreeMap::new(),
            revoked: false,
        })
    }
    pub fn revoke(&mut self) {
        self.revoked = true;
    }
    fn current(&self, host_session: &str) -> Result<(), String> {
        if self.revoked || host_session != self.binding.host_session_id {
            return Err("repair_host_lease_revoked_or_changed".into());
        }
        self.root.check_current().map_err(|e| e.to_string())
    }
    pub fn read_snapshots(&mut self, host_session: &str) -> Result<RepairSnapshot, String> {
        self.current(host_session)?;
        if self.sequence >= 8 {
            return Err("repair_current_run_snapshot_limit".into());
        }
        let mut files = Vec::new();
        let mut new_identity_pins = BTreeMap::new();
        let mut total = 0;
        let mut ids = BTreeSet::new();
        for path in &self.allowed {
            let mut file = self.reader.open_file(path).map_err(|e| e.to_string())?;
            let o = file.read_bounded(FILE_LIMIT).map_err(|e| e.to_string())?;
            let id = o.file_identity.observation_key();
            // The data handle is still live here: pin exactly that object before releasing it.
            let (parent, leaf) = path.rsplit_once('/').ok_or("repair_parent_required")?;
            let directory = self
                .reader
                .pin_directory(parent)
                .map_err(|e| e.to_string())?;
            let pin = Arc::new(IdentityPin::open(&directory, leaf)?);
            if pin.identity != id {
                return Err("repair_snapshot_identity_pin_mismatch".into());
            }
            new_identity_pins.insert(path.clone(), pin);

            if !ids.insert(id.clone()) {
                return Err("repair_aliased_file_objects_rejected".into());
            }
            total += o.bytes.len();
            if total > TEXT_BUDGET {
                return Err("repair_snapshot_budget".into());
            }
            let hash = io::hash(&o.bytes);
            let content =
                String::from_utf8(o.bytes).map_err(|_| "repair_non_utf8_source_rejected")?;
            if content.contains('\0') {
                return Err("repair_binary_source_rejected".into());
            }
            files.push(RepairSourceSnapshot {
                path: path.clone(),
                content,
                sha256: hash,
                object_identity: id,
            });
        }
        self.current(host_session)?;
        self.sequence += 1;
        let id = io::hash(
            &serde_json::to_vec(&(&self.binding, &self.diagnostic, self.sequence, &files))
                .map_err(|_| "repair_snapshot_serialization_failed")?,
        );
        let snapshot = RepairSnapshot {
            binding: self.binding.clone(),
            diagnostic: self.diagnostic.clone(),
            snapshot_id: id,
            files,
        };
        self.identity_pins = new_identity_pins;
        self.snapshot = Some(snapshot.clone());
        Ok(snapshot)
    }
    pub fn prepare_preview(
        &mut self,
        host_session: &str,
        input: RepairPreviewInput,
    ) -> Result<NativeRepairPreview, String> {
        self.current(host_session)?;
        let snapshot = self.snapshot.as_ref().ok_or("repair_snapshot_required")?;
        if input.binding != self.binding
            || input.diagnostic != self.diagnostic
            || input.snapshot_id != snapshot.snapshot_id
            || !hex(&input.preview_id)
            || input.files.is_empty()
            || input.files.len() > 8
            || self.prepared.len() >= 8
            || self.prepared.contains_key(&input.preview_id)
        {
            return Err("repair_preview_binding_invalid".into());
        }
        let mut seen = BTreeSet::new();
        let mut total = 0;
        let mut parents = Vec::new();
        let mut identity_pins = Vec::new();
        for f in &input.files {
            source_path(&f.path)?;
            if !seen.insert(f.path.clone()) || !self.allowed.contains(&f.path) {
                return Err("repair_preview_file_scope_mismatch".into());
            }
            let before = snapshot
                .files
                .iter()
                .find(|s| s.path == f.path)
                .ok_or("repair_unread_file")?;
            if f.before != before.content
                || f.before_hash != before.sha256
                || f.before_object_identity != before.object_identity
                || io::hash(f.after.as_bytes()) != f.after_hash
                || !hex(&f.after_hash)
                || f.after == f.before
                || f.after.len() > FILE_LIMIT
                || f.after.contains('\0')
            {
                return Err("repair_preview_content_or_hash_mismatch".into());
            }
            total += f.before.len() + f.after.len();
            if total > TEXT_BUDGET {
                return Err("repair_preview_text_budget".into());
            }
            let pin = self
                .identity_pins
                .get(&f.path)
                .ok_or("repair_identity_pin_required")?
                .clone();
            pin.check()?;
            if pin.identity != f.before_object_identity {
                return Err("repair_preview_identity_pin_mismatch".into());
            }
            identity_pins.push(pin);
            let parent = f.path.rsplit_once('/').ok_or("repair_parent_required")?.0;
            parents.push(
                self.reader
                    .pin_directory(parent)
                    .map_err(|e| e.to_string())?,
            );
        }
        let digest =
            io::hash(&serde_json::to_vec(&input).map_err(|_| "repair_plan_serialization_failed")?);
        let p = NativeRepairPreview {
            preview: input,
            native_plan_digest: digest,
        };
        self.current(host_session)?;
        self.prepared.insert(
            p.preview.preview_id.clone(),
            PreparedRecord {
                public: p.clone(),
                parents,
                identity_pins,
                used: false,
                last_receipt: None,
            },
        );
        Ok(p)
    }
    fn receipt(p: &NativeRepairPreview, status: &str, reason: &str) -> RepairApplyReceipt {
        RepairApplyReceipt {
            binding: p.preview.binding.clone(),
            diagnostic: p.preview.diagnostic.clone(),
            preview_id: p.preview.preview_id.clone(),
            status: status.into(),
            reason: reason.into(),
            effects: p
                .preview
                .files
                .iter()
                .map(|f| RepairFileEffect {
                    path: f.path.clone(),
                    status: "not_started".into(),
                    before_hash: f.before_hash.clone(),
                    before_object_identity: f.before_object_identity.clone(),
                    after_hash: None,
                    after_object_identity: None,
                    reason: String::new(),
                })
                .collect(),
            recovery_record: None,
        }
    }
    pub fn apply_approved(
        &mut self,
        host_session: &str,
        preview_id: &str,
        grant: &mut NativeRepairGrant,
        journal: &mut impl RepairJournal,
        cancel: &AtomicBool,
    ) -> Result<RepairApplyReceipt, String> {
        self.apply_with_after_item_hook(host_session, preview_id, grant, journal, cancel, |_| {})
    }
    fn apply_with_after_item_hook(
        &mut self,
        host_session: &str,
        preview_id: &str,
        grant: &mut NativeRepairGrant,
        journal: &mut impl RepairJournal,
        cancel: &AtomicBool,
        mut after_item: impl FnMut(usize),
    ) -> Result<RepairApplyReceipt, String> {
        self.current(host_session)?;
        let p = self
            .prepared
            .get(preview_id)
            .ok_or("repair_preview_not_registered")?;
        if p.used || !grant.valid(&p.public) {
            return Err("repair_approval_used_revoked_expired_or_mismatched".into());
        }
        let mut receipt = Self::receipt(&p.public, "not_started", "cancelled_before_apply");
        if cancel.load(Ordering::Acquire) {
            return Ok(receipt);
        }
        let mut opened = Vec::new();
        // Every target is held exclusively and checked against its actual snapshot before ANY source write.
        for (i, f) in p.public.preview.files.iter().enumerate() {
            if p.identity_pins[i].check().is_err()
                || p.identity_pins[i].identity != f.before_object_identity
            {
                receipt.status = "conflict".into();
                receipt.reason = "repair_pinned_source_object_changed".into();
                receipt.effects[i].status = "conflict".into();
                return Ok(receipt);
            }
            let leaf = f.path.rsplit_once('/').unwrap().1;
            let file = ExclusiveFile::open(&p.parents[i], leaf);
            let mut file = match file {
                Ok(v) => v,
                Err(e) => {
                    receipt.status = "conflict".into();
                    receipt.reason = e;
                    receipt.effects[i].status = "conflict".into();
                    return Ok(receipt);
                }
            };
            let current = file.read(FILE_LIMIT);
            if file.identity != f.before_object_identity
                || current.as_ref().map(|b| io::hash(b)).ok().as_deref()
                    != Some(f.before_hash.as_str())
            {
                receipt.status = "conflict".into();
                receipt.reason = "repair_source_changed_since_preview".into();
                receipt.effects[i].status = "conflict".into();
                return Ok(receipt);
            }
            opened.push(file);
        }
        self.current(host_session)?;
        if cancel.load(Ordering::Acquire) {
            return Ok(receipt);
        }
        let p = self.prepared.get_mut(preview_id).unwrap();
        if !grant.valid(&p.public) {
            return Err("repair_approval_changed_at_write_gate".into());
        }
        grant.used = true;
        p.used = true;
        let bundle = RepairRecoveryBundle {
            schema_version: 1,
            preview: p.public.clone(),
        };
        match journal.persist_before(&bundle) {
            Ok(id) if !id.is_empty() => receipt.recovery_record = Some(id),
            _ => {
                receipt.reason = "repair_durable_before_backup_failed".into();
                p.last_receipt = Some(receipt.clone());
                return Ok(receipt);
            }
        }
        receipt.reason = "ok".into();
        for (i, file) in opened.iter_mut().enumerate() {
            if cancel.load(Ordering::Acquire)
                || grant.revoked.load(Ordering::Acquire)
                || grant.started.elapsed() >= grant.ttl
            {
                receipt.reason = "cancelled_or_approval_revoked_after_checkpoint".into();
                break;
            }
            if self.revoked
                || host_session != self.binding.host_session_id
                || self.root.check_current().is_err()
            {
                receipt.status = "unknown".into();
                receipt.reason = "repair_lease_lost_no_further_writes".into();
                break;
            }
            let expected = &p.public.preview.files[i];
            match file.overwrite(expected.after.as_bytes()) {
                Ok(()) => {
                    receipt.effects[i].status = "applied".into();
                    receipt.effects[i].after_hash = Some(expected.after_hash.clone());
                    receipt.effects[i].after_object_identity = Some(file.identity.clone());
                }
                Err(e) => {
                    receipt.effects[i].status = "unknown".into();
                    receipt.effects[i].reason = e;
                    receipt.status = "unknown".into();
                    receipt.reason = "repair_partial_or_unknown_write_query_required".into();
                    break;
                }
            }
            after_item(i + 1);
        }
        if self.root.check_current().is_err() {
            receipt.status = "unknown".into();
            receipt.reason = "repair_final_root_gate_failed".into();
        }
        if receipt.status != "unknown" {
            let count = receipt
                .effects
                .iter()
                .filter(|e| e.status == "applied")
                .count();
            receipt.status = if count == receipt.effects.len() {
                "applied"
            } else if count > 0 {
                "partial"
            } else {
                "not_started"
            }
            .into();
        }
        p.last_receipt = Some(receipt.clone());
        Ok(receipt)
    }
    pub fn hold_applied_inputs_for_build(
        &self,
        host_session: &str,
        preview_id: &str,
    ) -> Result<RepairBuildInputs, String> {
        self.current(host_session)?;
        let p = self
            .prepared
            .get(preview_id)
            .ok_or("repair_unknown_preview")?;
        let receipt = p
            .last_receipt
            .as_ref()
            .ok_or("repair_apply_receipt_required")?;
        if receipt.status != "applied" || receipt.effects.len() != p.public.preview.files.len() {
            return Err("repair_verified_applied_receipt_required_for_build".into());
        }
        let mut files = Vec::new();
        let mut sources = Vec::new();
        for effect in &receipt.effects {
            if effect.status != "applied" {
                return Err("repair_unverified_file_effect".into());
            }
            let sha256 = effect
                .after_hash
                .clone()
                .ok_or("repair_after_hash_missing")?;
            let object_identity = effect
                .after_object_identity
                .clone()
                .ok_or("repair_after_identity_missing")?;
            files.push(
                self.reader
                    .open_file(&effect.path)
                    .map_err(|e| e.to_string())?,
            );
            sources.push(RepairQueryFile {
                path: effect.path.clone(),
                sha256,
                object_identity,
            });
        }
        let mut guard = RepairBuildInputs {
            root: self.root.clone(),
            preview_id: preview_id.into(),
            files,
            sources,
        };
        guard.check_current()?;
        self.current(host_session)?;
        Ok(guard)
    }
    pub fn query_recovery(
        &self,
        host_session: &str,
        preview_id: &str,
    ) -> Result<RepairRecoveryQuery, String> {
        self.current(host_session)?;
        let p = self
            .prepared
            .get(preview_id)
            .ok_or("repair_unknown_preview")?;
        let mut files = Vec::new();
        for f in &p.public.preview.files {
            let mut read = self.reader.open_file(&f.path).map_err(|e| e.to_string())?;
            let o = read.read_bounded(FILE_LIMIT).map_err(|e| e.to_string())?;
            files.push(RepairQueryFile {
                path: f.path.clone(),
                sha256: io::hash(&o.bytes),
                object_identity: o.file_identity.observation_key(),
            });
        }
        self.current(host_session)?;
        let query_id = io::hash(
            &serde_json::to_vec(&(preview_id, &files))
                .map_err(|_| "repair_query_serialization_failed")?,
        );
        Ok(RepairRecoveryQuery {
            binding: self.binding.clone(),
            diagnostic: self.diagnostic.clone(),
            preview_id: preview_id.into(),
            query_id,
            files,
        })
    }
    /// Build a NEW reviewed restore preview only for known applied files still matching our result.
    /// Unknown writes or outside edits require manual reconciliation, never an automatic overwrite.
    pub fn prepare_restore(
        &mut self,
        host_session: &str,
        original_preview_id: &str,
        new_preview_id: String,
    ) -> Result<NativeRepairPreview, String> {
        self.current(host_session)?;
        let original = self
            .prepared
            .get(original_preview_id)
            .ok_or("repair_unknown_preview")?;
        let receipt = original
            .last_receipt
            .as_ref()
            .ok_or("repair_apply_receipt_required")?;
        if receipt.status == "unknown" || receipt.effects.iter().any(|e| e.status == "unknown") {
            return Err("repair_unknown_effect_manual_reconciliation_required".into());
        }
        let entries = original.public.preview.files.clone();
        let effects = receipt.effects.clone();
        let snap = self.read_snapshots(host_session)?;
        let mut files = Vec::new();
        for e in effects.iter().filter(|e| e.status == "applied") {
            let old = entries.iter().find(|f| f.path == e.path).unwrap();
            let now = snap.files.iter().find(|f| f.path == e.path).unwrap();
            if Some(&now.sha256) != e.after_hash.as_ref()
                || Some(&now.object_identity) != e.after_object_identity.as_ref()
            {
                return Err("repair_restore_conflict_external_change".into());
            }
            files.push(RepairFilePreview {
                path: old.path.clone(),
                before: now.content.clone(),
                after: old.before.clone(),
                before_hash: now.sha256.clone(),
                after_hash: old.before_hash.clone(),
                before_object_identity: now.object_identity.clone(),
            });
        }
        if files.is_empty() {
            return Err("repair_no_known_applied_files_to_restore".into());
        }
        self.prepare_preview(
            host_session,
            RepairPreviewInput {
                binding: self.binding.clone(),
                diagnostic: self.diagnostic.clone(),
                snapshot_id: snap.snapshot_id,
                preview_id: new_preview_id,
                files,
            },
        )
    }
}
#[cfg(test)]
#[path = "ue_build_repair_tests.rs"]
mod tests;
