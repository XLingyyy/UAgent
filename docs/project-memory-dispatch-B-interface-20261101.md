# B interface: native memory sources and immutable batch

Status: isolated static implementation only. No module registration, product gate change, build, test, application run, or live project observation is authorized in this worker.

## Central module placement (required)

Load both new files as PRIVATE children of `native_responses_commands`, so only that native broker can construct a batch. Do not register them as public crate-root modules:

```rust
#[path = "native_project_memory_sources.rs"]
mod memory_sources;
#[path = "native_project_memory_dispatch.rs"]
mod memory_dispatch;
pub(crate) use memory_dispatch::{MemoryBatch, MemoryBatchReceipt, BoundMemoryRequest};
```

The central broker must implement its own opaque `pub(crate) struct NativeMemoryReadShareGrant` with private fields and NO Deserialize / renderer constructor / persisted restoration / fixture issuer. Crate visibility of the TYPE permits the transport to compare its original Arc identity; construction and authority mutation stay private in the broker. B deliberately does not implement that authority. Required methods (accessible to its child modules):

```rust
fn project_id(&self) -> &str;
fn project_generation(&self) -> u64;
fn root_generation(&self) -> u64;
fn root_handle(&self) -> &Arc<TrustedRootHandle>;
fn max_context_bytes(&self) -> usize;
fn check_current(&self) -> Result<(), &'static str>;
fn check_memory_path(&self, relative: &str) -> Result<(), &'static str>;
```

`check_current` must check the original live run/window/project/read/share grant, permanent cancellation/deadline, and updating/project/root generation barrier. `check_memory_path` must check BOTH original native read and share grants and the production sensitive-path policy. Empty share path means project-wide scope and must require that exact authority. Neither method may accept a renderer `true`, stamp, checkpoint or DTO as proof. The final NativeSession mutex must compare the SAME grant Arc, SAME root Arc and captured project/root generations against current native state. B's re-observation is outside that mutex and cannot replace the central barrier.

The crate-visible batch `grant()`, `root()`, `project_generation()` and `root_generation()` getters are immutable in-memory identity observations only, provided for that final transport comparison. The central grant methods above may involve native scope/registry work and must never run under the final session mutex.

## A coupling

`MemoryBatch::capture(grant, rows)` is visible only to the central broker. `rows` MUST be the complete, ordered original selection read by A's bounded native store preparation, never renderer rows. There is no filtering, sorting, truncation or auto-refresh in B. A must re-read every row under one existing `with_project_memory_budget(execution, true, ...)` / BEGIN IMMEDIATE, enforce all original validations, then invoke its borrowed `VerifiedMemoryBatch` closure. Central compares `batch.expected_rows()` with that verified slice using `batch.compare_transaction_rows(verified_rows)`. The equality is exact over every ProjectMemory field, not just ID/revision. B's comparison does not itself authorize a send.

A must not construct a transport Permit, call transport, open a database, or return VerifiedMemoryBatch as a durable proof. The unique native transport admission closure remains within A's live transaction. Source re-observation happens before acquiring the NativeSession mutex, retaining guards through L and transport.

## C receipt and wire shape

Receipt is Serialize-only data: schemaVersion=1, batchId, projectId, selected=[{id,revision}], message={role:"user",content}, sectionSha256, maxContextBytes. No run grant or authorization is encoded. Central command wrappers must separately bind the opaque batch ID to the owning original run/window and original request; lookup by a receipt/hash alone is forbidden.

Use `MemoryBatch::id()` for the central native registry key and reject collisions rather than replacing a live entry. The batch's private Arc identity, not that key, is the request/admission identity. An invalid body rejected before attachment can be corrected before review; a successful attachment permanently consumes the batch attachment slot, including abandonment/cancellation. That slot does not consume approval or move send progress; ONLY transport admission at L does those.

`MemoryBatch::bind_responses(&Arc<Self>, Arc<[u8]>)` accepts only Responses `input[2]` = `{type:"message",role:"user",content:[{type:"input_text",text:<exact native canonical content>}]}` after system/developer messages. All JSON object keys at every depth must be unique. Only one native memory marker may occur, in that exact slot. Maximum 30 input items, total serialized input <= the ORIGINAL grant's context byte limit <=24576, entire body <=1048576. Batch attachment is one-shot even if the caller subsequently drops the bound request. The full original wire Arc and body SHA256 are retained; dispatch must not reserialize it.

The existing transport preparation accepts Vec<u8> and makes its own original Arc. Preserve that API if useful: the supplied patch adds `PreparedRequest::body_arc()`. First prepare the request, then call `batch.bind_responses(Arc::clone(prepared.body_arc()))`, attach that exact BoundMemoryRequest to that original PreparedRequest, and only then expose a review/approval receipt. Do not bind an earlier Arc and then pass a copied Vec into prepare. Native approval and the private permit must bind the SAME BoundMemoryRequest instance; the getter alone supplies no fence.

## Central cleanup/admission (not implemented by B)

The transport module alone privately constructs its non-Clone / non-Serde / non-Debug one-shot PendingPermit at L, owning the SAME BoundMemoryRequest, PreparedRequest, approval/lease identities and source guards. L consumes the original approval and marks mayHaveBeenSent. Do not introduce a second B permit constructor.

The owner dedicated channel may deliver that Permit only AFTER COMMIT, memory-budget teardown, autocommit confirmation, RunStore/ConnectionLease/operation-scope drop, quarantine checks, and fresh native cancellation/deadline/domain/grant checks. Every failure, panic, lost receiver or timeout drops the pending Permit; L is never rolled back. The original sender consumes it and calls dispatch with the SAME body Arc. Keep production memory dispatch, fixture restrictions, RuntimeHost recovery and unsupported provider routes closed until the complete native path and guarded acceptance evidence exist.

## Native metadata dependency

B calls `project_source_versions::bound_file_metadata_version(&BoundReadFile)`. Central must add the helper and a SAME held-handle metadata observation method in trusted_root_handle/windows.rs. Reuse the existing private `metadata_version` algorithm unchanged, including its legacy Win32 (volume32, fileIndex64) fields. Retain and check full existing FileId128 separately: DO NOT truncate FileId128 to synthesize legacy FileIndex64, reopen path_hint, or accept renderer stamps. Exact metadata and original-body Arc getter patch is included in B delivery notes.

R2 freshness compatibility correction: file_preview accepts absent freshness or freshness exactly equal to its ORIGINAL version. Capture AND reobserve must validate that version (and any present freshness) against the stamp obtained through the SAME retained file handle. Equality between the two data fields alone provides no evidence. Different/unknown freshness, non-file_preview sources, changed original stamps and revoked guards remain rejected. Preserve the original field unchanged in frozen rows, canonical section and transaction comparison; never remove it or refresh an old source to a new stamp after review.
