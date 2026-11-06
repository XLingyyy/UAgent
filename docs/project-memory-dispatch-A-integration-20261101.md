# A: whole-selection RunStore dispatch verification

Status: isolated implementation and seven test-source groups only. No build,
test, SQL fixture, application, package install, API, or real project observation
was run in this authoring pass. Production memory dispatch remains closed. A did
not modify module registration, sqlite.rs, project_memory.rs, the owner,
coordinator, transport, or any other author's file. No files or data were deleted.

Read the revised implementation boundary and independent review R1-R6. No
applicable AGENTS.md or .agents instruction/skill file was found in the worktree,
its checked ancestors, or the designated G:/UAgent/.agents directory (empty).

## New files and exact central registration

The new Rust files are `apps/desktop/src-tauri/src/local_run_store/`:

- `project_memory_dispatch.rs`: production core; 256 members, 64 source refs,
  eight read/share prefixes each, native context cap 24576 UTF-8 bytes.
- `project_memory_dispatch_tests.rs`: isolated real RunStore/Windows SQLite tests;
  one file fixture additionally uses a raw SQLite writer outside the cooperative
  gate. It requires central's `UAGENT_MEMORY_TEST_ROOT` on E: or G:, retains the
  fixture, and does not delete data.

Central alone adds the following to `local_run_store/project_memory.rs`:

```rust
#[path = "project_memory_dispatch.rs"] mod dispatch;
pub(crate) use dispatch::{MemoryDispatchScope, MemoryDispatchSelection, VerifiedMemoryBatch};
```

Keep `dispatch` private. These selected re-exports are native crate-only; they are
not IPC/serde DTOs. No change to lib.rs, sqlite.rs, run_store_sqlite.rs or schema
is needed for A itself. The existing real budget and transaction implementations
are reused, including panic rollback, autocommit confirmation, handler restoration
and quarantine behavior.

## Shared API with B and C

```rust
MemoryDispatchSelection { id: &str, revision: i64 }
MemoryDispatchScope {
    project_id: &str,
    read_prefixes: &[String],
    share_prefixes: &[String],
    max_context_bytes: usize,
}

RunStore::project_memory_dispatch_snapshot(
    &self, execution: &MemoryExecution<'_>,
    scope: &MemoryDispatchScope<'_>, selected: &[MemoryDispatchSelection<'_>],
) -> Result<Vec<ProjectMemory>>;

RunStore::with_verified_project_memory_batch<T>(
    &self, execution: &MemoryExecution<'_>,
    scope: &MemoryDispatchScope<'_>, originals: &[ProjectMemory],
    admit: impl for<'transaction> FnOnce(VerifiedMemoryBatch<'transaction>) -> Result<T>,
) -> Result<T>;
```

The scope descriptor MUST borrow the original current native grant's private
project/read/share fields and context limit. It has no authorization constructor
and does not make a renderer scope valid. Central's NativeMemoryReadShareGrant in
B's interface must expose these same native fields to its broker, or provide
native-only borrowed accessors. Do not reconstruct them from IDs/receipt/JSON or
issue a substitute grant in A. A introduces no independent token or batch ID.

For preparation, central converts C's selected id/revision data into the small
borrowed coordinates, calls the snapshot method on the managed worker, and passes
the returned complete ordered rows to B's existing `MemoryBatch::capture(grant,
rows)`. No sorting/filtering/truncation occurs in A. The preparation snapshot
returns descriptive data after its transaction and budget end. B must capture the
actual guards, canonical segment and original grant. Waiting for review must hold
neither RunStore nor SQLite transaction.

For final verification, pass the exact B `batch.expected_rows()` slice as
`originals`. Inside the higher-ranked callback central can use:

```rust
verified.check_execution()?; // repeat AFTER acquiring the final state mutex
// std::ptr::eq(verified.original_records(), batch.expected_rows())
// batch.compare_transaction_rows(verified.current_records())
// private transport admission: native identities/body/approval/lifetimes -> PendingPermit
```

These comments specify the central coupling; they are not a new public admission
API or a boolean send permission. B's compare method returns &'static str errors;
central maps those to its StoreError without including row bodies or paths in the
error. A compares every typed ProjectMemory field itself and also checks native
project binding, unique IDs, revisions, valid/project/user-confirmed eligibility,
fact evidence, complete source/origin metadata and both lexical read/share
scopes. It reuses the parent's real bounded decoder and `validate`, including
payload/column consistency, and checks session/message origins in that same
transaction. Missing/changed members deny the entire batch. Unsupported source
kinds fail closed; the first slice only accepts exact file_preview evidence.

A's sum of original body bytes is a necessary lower bound on context use. B
already measures the actual native canonical segment and serialized Responses
input; central must preserve those checks and the <=1048576-byte full-body cap.
A does not serialize or independently guess B's canonical wire representation.
Path syntax is reused from project_memory; prefix matching keeps component
boundaries and checks every prefix before permitting a root prefix. Sensitive
path and physical root/file checks still belong to the original native grant/B.

## Transaction, lifetime and owner completion

Both methods use exactly one existing
`with_project_memory_budget(execution, true, ...)`. The true branch performs a
real BEGIN IMMEDIATE even though A writes no business rows. All selected rows and
the unique FnOnce admission call are under that one physical transaction and SQL
budget. There is no manual BEGIN, nested budget claim or loop over budgeted
`project_memory()` calls. VerifiedMemoryBatch has private fields/constructor,
invariant borrowed lifetime, no Clone/Debug/serde, and an Rc marker to prevent
cross-thread movement. Its higher-ranked callback cannot return the proof.

The callback must only enter the transport's private final admission. Sources,
provider/config, vault and potentially blocking preflight occur BEFORE this SQL
operation. B retains original live guards throughout the transaction, L and
permit lifetime. Under the final NativeSession mutex, only bounded memory/clock
checks and the existing state transition occur: same native batch/grant/root/
request/raw-body Arc/approval/lease and epochs, live permanent request flag,
deadline, consume once, mark mayHaveBeenSent. Call `verified.check_execution()`
again there; A's earlier check is not a substitute for a lock-delayed check.

The returned generic T MUST be central's PRIVATE non-cloneable PendingPermit.
A only returns it after the existing budget has COMMITed, confirmed autocommit
and restored handlers/limits, followed by fresh execution and original DB-owner
checks. Failure, panic, COMMIT error or post-cleanup cancellation drops T; no
transport is called by A. A successful return STILL borrows RunStore/ConnectionLease.
Central must implement review R3's dedicated completion channel: retain T until
RunStore, connection/gate and OperationScope drop on the original worker; then
check quarantine/owner/domain/grant, operation deadline/cancel and the original
long-lived native request, and only then deliver once to the original sender.
An ordinary `with_store` reply or its CancelOnDrop flag cannot serve this purpose.
L is never undone on cleanup/receiver failure; retain mayHaveBeenSent and never
resurrect approval or automatically retry. Poll/cancel/close do not wait for DB
or vault. No Db/Gate/RunStore may move to the sending thread.

## Minimal unrun acceptance source

Seven test groups cover:

1. Ordered complete snapshots, exact original slice identity, one admission and
   connection reuse.
2. Sixteen full-content/eligibility changes, missing/duplicate/cross-project
   members, and zero callback before the whole selection passes.
3. Scope component/case boundaries, malformed prefix lists, body/native limits,
   unsupported evidence and >64 evidence refs.
4. Cancellation between rows and at final admission; expired deadline.
5. Cancellation AFTER successful SQL/budget cleanup destroys a pending value;
   callback failures remain failures.
6. Real SQL VM interruption spanning the callback, panic cleanup and a real outer
   COMMIT failure discard pending values and preserve a reusable connection.
7. Two real connections/threads: an external writer commits before the transaction
   and invalidates the old batch; after row A/before row B it gets SQLITE_BUSY for
   both members and remains blocked at admission; after cleanup it commits and
   invalidates the next old batch.

The VM test deliberately runs a synthetic SQL probe in the callback to demonstrate
the enclosing budget; production admission must not do SQL under NativeSession's
mutex. The COMMIT probe ends the transaction early to force the real outer COMMIT
failure. It is NOT evidence for disk/authorizer COMMIT errors, permanent rollback
failure, unconfirmed autocommit or quarantine. Those fault scenarios, real native
Permit/transport counts, owner teardown/channel loss, source/root updates, full
native authority and UI lifecycle remain central acceptance requirements under
the approved OS Job guard. No claim of passing tests/builds is made here.

Keep production memory fence, native investigation fixture restrictions,
RuntimeHost recovery and unsupported provider routes CLOSED until central
implements R1/R2/R3/R6, merges B/C, obtains the independently reviewed guarded
evidence, builds the complete candidate and performs real UI lifecycle checks.
