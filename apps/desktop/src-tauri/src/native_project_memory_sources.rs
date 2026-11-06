//! Private child of native_responses_commands. Native source guards, not a grant issuer.
//! No serde input, database, content reads, watcher-as-proof, transport or fixture authority.
#![cfg(windows)]

use super::NativeMemoryReadShareGrant;
use crate::local_run_store::project_memory::{MemorySource, ProjectMemory};
use crate::project_source_versions::bound_file_metadata_version;
use crate::trusted_root_handle::{BoundReadFile, ObjectIdentity, ReadRule, TrustedRootHandle};
use std::sync::Arc;

pub(super) const MAX_MEMORY_EVIDENCE: usize = 64;
type Result<T> = std::result::Result<T, &'static str>;

// A metadata stamp is only an observation. Keep the original non-serializable
// read/share grant and root/file Arcs for the entire prepared-request lifetime.
struct GuardedSource {
    original: MemorySource,
    file: Arc<BoundReadFile>,
    identity: ObjectIdentity,
}

pub(super) struct NativeMemorySources {
    grant: Arc<NativeMemoryReadShareGrant>,
    root: Arc<TrustedRootHandle>,
    root_identity: ObjectIdentity,
    project_generation: u64,
    root_generation: u64,
    sources: Vec<GuardedSource>,
}

impl NativeMemorySources {
    pub(super) fn capture(
        grant: Arc<NativeMemoryReadShareGrant>,
        rows: &[ProjectMemory],
    ) -> Result<Self> {
        grant.check_current()?;
        let count = rows.iter().try_fold(0usize, |n, row| {
            n.checked_add(row.source_refs.len()).ok_or("memory_source_limit")
        })?;
        if count > MAX_MEMORY_EVIDENCE {
            return Err("memory_source_limit");
        }
        // Validate the WHOLE selection before any file open. Index/tool/unknown
        // sources and unknown freshness semantics fail closed in this slice.
        // UI file_preview freshness is an alias of the ORIGINAL version, not a
        // new proof. The same held handle must validate that version below.
        for row in rows {
            if row.project_id != grant.project_id() {
                return Err("memory_project_changed");
            }
            for path in &row.share_paths {
                grant.check_memory_path(path)?;
            }
            for source in &row.source_refs {
                validate_source_reference(source, grant.project_id())?;
                grant.check_memory_path(&source.path)?;
            }
        }
        let root = Arc::clone(grant.root_handle());
        root.check_current().map_err(|_| "memory_root_changed")?;
        let root_identity = root.identity();
        let project_generation = grant.project_generation();
        let root_generation = grant.root_generation();
        let mut sources = Vec::with_capacity(count);
        for row in rows {
            for source in &row.source_refs {
                grant.check_current()?;
                let rule = ReadRule::exact_file(&source.path)
                    .map_err(|_| "memory_source_path_invalid")?;
                // Host-issued read/share permission was checked above. ReadRule
                // is an exact-file restriction, never newly minted authority.
                let reader = root.scope_from_verified_host(vec![rule])
                    .map_err(|_| "memory_source_unavailable")?;
                let file = Arc::new(reader.open_file(&source.path)
                    .map_err(|_| "memory_source_unavailable")?);
                verify_bound_source(source, &file)?;
                let identity = file.identity();
                sources.push(GuardedSource { original: source.clone(), file, identity });
            }
        }
        let captured = Self {
            grant, root, root_identity, project_generation, root_generation, sources,
        };
        captured.reobserve()?;
        Ok(captured)
    }

    /// Potential filesystem/registry work. NEVER call under NativeSession's
    /// final state mutex. The native project barrier must also participate in L.
    pub(super) fn reobserve(&self) -> Result<()> {
        self.grant.check_current()?;
        self.root.check_current().map_err(|_| "memory_root_changed")?;
        if !Arc::ptr_eq(&self.root, self.grant.root_handle())
            || self.root.identity() != self.root_identity
            || self.grant.project_generation() != self.project_generation
            || self.grant.root_generation() != self.root_generation
        {
            return Err("memory_root_changed");
        }
        for source in &self.sources {
            self.grant.check_current()?;
            validate_source_reference(&source.original, self.grant.project_id())?;
            self.grant.check_memory_path(&source.original.path)?;
            source.file.check_current().map_err(|_| "memory_source_changed")?;
            if source.file.identity() != source.identity {
                return Err("memory_source_changed");
            }
            verify_bound_source(&source.original, &source.file)?;
        }
        self.root.check_current().map_err(|_| "memory_root_changed")?;
        self.grant.check_current()
    }

    /// Opaque identity and immutable captured generations ONLY. These accessors
    /// do no I/O and are inputs to the central NativeSession final comparison.
    pub(super) fn grant(&self) -> &Arc<NativeMemoryReadShareGrant> { &self.grant }
    pub(super) fn root(&self) -> &Arc<TrustedRootHandle> { &self.root }
    pub(super) fn project_generation(&self) -> u64 { self.project_generation }
    pub(super) fn root_generation(&self) -> u64 { self.root_generation }
}

// Shape checks only: not an evidence constructor or authority. Preserve the
// exact original MemorySource, including freshness, in both guards and rows.
fn validate_source_reference(source: &MemorySource, project: &str) -> Result<()> {
    if source.project_id != project || source.kind != "file_preview"
        || !exact_file_path(&source.path) || source.version.is_empty()
        || source.version.len() > 512
        || source.freshness.as_ref().is_some_and(|freshness| freshness != &source.version)
    {
        return Err("memory_source_unsupported");
    }
    Ok(())
}

// The only observed stamp comes from the SAME original held file handle.
// Neither equality between renderer fields nor a caller-provided stamp can
// replace this observation. Capture and reobserve use this exact same check.
fn verify_bound_source(source: &MemorySource, file: &BoundReadFile) -> Result<()> {
    let observed = bound_file_metadata_version(file).map_err(|_| "memory_source_unavailable")?;
    if observed != source.version
        || source.freshness.as_ref().is_some_and(|freshness| freshness != &observed)
    {
        return Err("memory_source_changed");
    }
    Ok(())
}

fn exact_file_path(value: &str) -> bool {
    !value.is_empty() && value.len() <= 1024
        && !value.chars().any(|c| c.is_control() || "\\%:<>\"|?*~".contains(c))
        && value.split('/').all(|part| {
            !part.is_empty() && part != "." && part != ".."
                && !part.ends_with([' ', '.'])
        })
}

#[cfg(test)]
#[path = "native_project_memory_sources_tests.rs"]
mod tests;
