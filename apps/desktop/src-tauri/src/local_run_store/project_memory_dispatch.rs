//! Native-only, whole-selection verification on the existing RunStore worker.
//!
//! Central mounts this as a PRIVATE child of `project_memory`; it deliberately
//! uses that parent's bounded record decoder and the real SQLite budget. No
//! opener, IPC command, source observer, transport, or authority is created here.
use super::{canonical_path, id, MemoryExecution, ProjectMemory, Result, RunStore, StoreError};
use std::{collections::BTreeSet, marker::PhantomData, rc::Rc};

const MAX_MEMBERS: usize = 256;
const MAX_SOURCES: usize = 64;
const MAX_PREFIXES: usize = 8;
const MAX_CONTEXT_BYTES: usize = 24_576;

/// Borrowed descriptions of a CURRENT native grant, never renderer authority.
/// Central must obtain every field from the same live native run/root instance.
/// This descriptor does not prove that instance's identity or liveness; the
/// transport's final admission must check those under its own state mutex.
pub(crate) struct MemoryDispatchScope<'a> {
    pub(crate) project_id: &'a str,
    pub(crate) read_prefixes: &'a [String],
    pub(crate) share_prefixes: &'a [String],
    pub(crate) max_context_bytes: usize,
}

/// Data-only selection coordinates for PREPARATION, not a send capability.
pub(crate) struct MemoryDispatchSelection<'a> {
    pub(crate) id: &'a str,
    pub(crate) revision: i64,
}

/// Created only after ALL rows match, while the IMMEDIATE transaction is live.
/// The higher-ranked callback prevents this borrowed proof from being returned;
/// the invariant lifetime and Rc marker also prevent shortening/moving it to a
/// different worker. It is intentionally not Clone, Debug, or serializable.
pub(crate) struct VerifiedMemoryBatch<'transaction> {
    project_id: &'transaction str,
    original_records: &'transaction [ProjectMemory],
    current_records: &'transaction [ProjectMemory],
    execution: MemoryExecution<'transaction>,
    _transaction: PhantomData<&'transaction mut &'transaction ()>,
    _worker: PhantomData<Rc<()>>,
}

impl VerifiedMemoryBatch<'_> {
    pub(crate) fn project_id(&self) -> &str { self.project_id }
    /// These are the SAME borrowed originals supplied by the native batch owner.
    /// Central can compare slice identity with that owner's frozen records.
    pub(crate) fn original_records(&self) -> &[ProjectMemory] { self.original_records }
    pub(crate) fn current_records(&self) -> &[ProjectMemory] { self.current_records }
    /// Call AGAIN inside the final NativeSession mutex, immediately before L.
    /// This is only bounded memory/clock work: no SQL, file, vault, or broker call.
    pub(crate) fn check_execution(&self) -> Result<()> { self.execution.check() }
}

fn invalid_batch() -> StoreError {
    StoreError::new("memoryDispatchInvalid", "the complete project memory selection is invalid")
}
fn stale_batch() -> StoreError {
    StoreError::new("memoryDispatchStale", "project memory changed; prepare and review the complete request again")
}
fn capacity() -> StoreError {
    StoreError::new("projectMemoryCapacity", "the complete project memory selection exceeds its native budget")
}
fn in_prefix(path: &str, prefix: &str) -> bool {
    // Preserve canonical component boundaries. As in the existing runtime path
    // check, Windows case differences do not widen a lexical prefix to a sibling.
    let path = path.to_lowercase();
    let prefix = prefix.to_lowercase();
    prefix.is_empty() || path == prefix || path.strip_prefix(&prefix).is_some_and(|tail| tail.starts_with('/'))
}
impl MemoryDispatchScope<'_> {
    fn validate(&self) -> Result<()> {
        id(self.project_id)?;
        if self.max_context_bytes == 0 || self.max_context_bytes > MAX_CONTEXT_BYTES
            || self.read_prefixes.is_empty() || self.read_prefixes.len() > MAX_PREFIXES
            || self.share_prefixes.is_empty() || self.share_prefixes.len() > MAX_PREFIXES
            || self.read_prefixes.iter().chain(self.share_prefixes).any(|path| !canonical_path(path)) {
            return Err(invalid_batch());
        }
        Ok(())
    }
    fn check_path(&self, path: &str) -> Result<()> {
        if !canonical_path(path)
            || !self.read_prefixes.iter().any(|prefix| in_prefix(path, prefix))
            || !self.share_prefixes.iter().any(|prefix| in_prefix(path, prefix)) {
            return Err(StoreError::new("memoryDispatchScope", "project memory is outside the current native read/share scope"));
        }
        Ok(())
    }
}

fn validate_selection(scope: &MemoryDispatchScope<'_>, selected: &[MemoryDispatchSelection<'_>]) -> Result<()> {
    scope.validate()?;
    if selected.is_empty() || selected.len() > MAX_MEMBERS { return Err(invalid_batch()); }
    let mut ids = BTreeSet::new();
    for member in selected {
        id(member.id)?;
        if !(1..=super::MAX_SAFE).contains(&member.revision) || !ids.insert(member.id) {
            return Err(invalid_batch());
        }
    }
    Ok(())
}

#[derive(Default)]
struct BatchBounds { sources: usize, body_bytes: usize }
impl BatchBounds {
    fn include(&mut self, scope: &MemoryDispatchScope<'_>, record: &ProjectMemory) -> Result<()> {
        record.validate()?;
        if record.project_id != scope.project_id || record.visibility != "project"
            || record.validity != "valid"
            || !record.confirmation.as_ref().is_some_and(|confirmation| confirmation.kind == "user") {
            return Err(invalid_batch());
        }
        self.sources = self.sources.checked_add(record.source_refs.len()).ok_or_else(capacity)?;
        self.body_bytes = self.body_bytes.checked_add(record.body.len()).ok_or_else(capacity)?;
        if self.sources > MAX_SOURCES || self.body_bytes > scope.max_context_bytes { return Err(capacity()); }
        // Body bytes are a necessary lower bound, not the canonical segment or
        // complete request budget. B/central MUST also measure their actual frozen
        // UTF-8 segment/context and wire body; this leaf never serializes the wire.
        for path in &record.share_paths { scope.check_path(path)?; }
        for source in &record.source_refs {
            if source.project_id != scope.project_id { return Err(invalid_batch()); }
            if source.kind != "file_preview" || source.path.is_empty() {
                return Err(StoreError::new("memoryDispatchSourceUnsupported", "this native dispatch slice requires exact file-preview sources"));
            }
            scope.check_path(&source.path)?;
        }
        Ok(())
    }
}

impl RunStore {
    // Called only beneath ONE with_project_memory_budget(..., true, ...).
    // Do not replace project_memory_record with the public per-row budgeted API.
    fn read_dispatch_records(&self, execution: &MemoryExecution<'_>, scope: &MemoryDispatchScope<'_>,
        selected: &[MemoryDispatchSelection<'_>]) -> Result<Vec<ProjectMemory>> {
        execution.check()?;
        validate_selection(scope, selected)?;
        let mut bounds = BatchBounds::default();
        let mut records = Vec::with_capacity(selected.len());
        for member in selected {
            execution.check()?;
            let record = self.project_memory_record(scope.project_id, member.id).map_err(|error| {
                if error.kind == "notFound" { stale_batch() } else { error }
            })?;
            if record.revision != member.revision { return Err(stale_batch()); }
            bounds.include(scope, &record)?;
            self.check_memory_origin(scope.project_id, &record.origin)?;
            records.push(record);
            #[cfg(test)]
            tests::after_row_read(records.len() - 1);
            execution.check()?;
        }
        Ok(records)
    }

    /// PREPARATION only: one bounded IMMEDIATE transaction reads the entire
    /// ordered selection. Returned records are descriptive, never a send proof.
    /// The native batch owner freezes them/guards/body BEFORE review, with no SQL
    /// connection held while waiting for the user.
    pub(crate) fn project_memory_dispatch_snapshot(&self, execution: &MemoryExecution<'_>,
        scope: &MemoryDispatchScope<'_>, selected: &[MemoryDispatchSelection<'_>]) -> Result<Vec<ProjectMemory>> {
        let records = self.db.with_project_memory_budget(execution, true, || {
            self.read_dispatch_records(execution, scope, selected)
        })?;
        #[cfg(test)]
        tests::after_transaction_cleanup();
        // The shared budget's success branch has no fresh execution.check().
        // Preserve failures with `?`, then check success after COMMIT/autocommit
        // confirmation and handler/budget restoration on the original worker.
        execution.check()?;
        self.db.check_owner()?;
        Ok(records)
    }

    /// DISPATCH verification: all current rows, their full typed contents and
    /// source/origin/confirmation metadata must match the frozen native originals.
    /// `admit` runs exactly once only after every member passes, under the SAME
    /// real IMMEDIATE transaction. It must invoke the transport's PRIVATE final
    /// admission only, checking native instance/epochs/approval/body and this
    /// execution again within its state mutex. No source/SQL/vault/registry/network
    /// work, arbitrary callbacks, or side-effecting drops belong in that mutex.
    ///
    /// T MUST be central's non-cloneable native PendingPermit, not a dispatched
    /// result. This method confirms transaction cleanup, but STILL borrows the
    /// worker's RunStore/ConnectionLease. Central MUST retain T until that worker
    /// drops RunStore/lease/operation scope and checks owner/grant/request lifetime
    /// again, then deliver it once to the ORIGINAL sending thread. Ordinary CRUD
    /// with_store replies are NOT that completion barrier (review R3).
    pub(crate) fn with_verified_project_memory_batch<T>(&self, execution: &MemoryExecution<'_>,
        scope: &MemoryDispatchScope<'_>, originals: &[ProjectMemory],
        admit: impl for<'transaction> FnOnce(VerifiedMemoryBatch<'transaction>) -> Result<T>) -> Result<T> {
        let pending = self.db.with_project_memory_budget(execution, true, || {
            execution.check()?;
            scope.validate()?;
            if originals.is_empty() || originals.len() > MAX_MEMBERS { return Err(invalid_batch()); }
            let mut original_bounds = BatchBounds::default();
            for original in originals {
                execution.check()?;
                original_bounds.include(scope, original)?;
            }
            let selected: Vec<_> = originals.iter().map(|record| MemoryDispatchSelection {
                id: record.id.as_str(), revision: record.revision,
            }).collect();
            let current = self.read_dispatch_records(execution, scope, &selected)?;
            if current.as_slice() != originals { return Err(stale_batch()); }
            execution.check()?;
            let pending = admit(VerifiedMemoryBatch {
                project_id: scope.project_id, original_records: originals,
                current_records: &current, execution: *execution,
                _transaction: PhantomData, _worker: PhantomData,
            })?;
            execution.check()?;
            Ok(pending)
        })?;
        #[cfg(test)]
        tests::after_transaction_cleanup();
        execution.check()?;
        self.db.check_owner()?;
        Ok(pending)
    }
}

#[cfg(test)]
#[path = "project_memory_dispatch_tests.rs"]
mod tests;
