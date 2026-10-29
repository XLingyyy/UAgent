# Native run records

`apps/desktop/src-tauri/src/local_run_store` is a Windows native SQLite module,
independent of Tauri commands, the Provider, UE, and shared TypeScript contracts.
It uses the existing `serde`, `serde_json`, and `sha2` dependencies and Windows'
`winsqlite3.dll` (SQLite 3.31 or newer, checked on open); no global dependency changes are needed. The current target
validated here is Windows x64 with the MSVC toolchain.

## Integration

Apply this export in the integrator-owned `apps/desktop/src-tauri/src/lib.rs`:

```diff
+#[cfg(windows)]
+pub(crate) mod local_run_store;
```

On Windows, native command adapters open
`app.path().app_data_dir()?.join("run-store-v2")` with `RunStore::open`. Keep
`workspace-v1/workspace.jsonl` separate and read-only. Do not import it silently.
The module is deliberately not a Tauri command surface: adapters must bind
`project_id` to the native trusted project identity and check the current task
scope. A record's saved root is descriptive metadata, never a grant to access it.
Never accept a storage-root path from the webview. Opening and using a store
inside a blocking worker avoids blocking the UI; the connection is owned by that
worker and is not shared across threads. Separate connections coordinate through
SQLite and run revisions. Use the same `StoreOptions` for all connections.

Use coordinator-assigned stable IDs and nonnegative millisecond timestamps.
Initialize a project with `create_project(&Project)`, then a native session with
`create_session(&Session)`. IDs are unique within a project; a run belongs to one
session. `start_run(project_id, &NewRun)` creates revision 0.

The coordinator writes each durable transition with:

```rust,ignore
let revision = store.commit_checkpoint(
    project_id,
    run_id,
    expected_revision,
    &CheckpointBatch {
        status: RunStatus::Paused,
        checkpoint: Checkpoint {
            next_step_id: Some("next-step".into()),
            reason: "awaitingFreshAuthorization".into(),
            summary: "Previous tool result is fully recorded".into(),
            captured_at: now_ms,
        },
        messages,
        steps,
        tool_calls,
        events,
        changesets,
        artifacts,
    },
)?;
```

The transaction includes messages, current step/tool/changeset states, append-only
events, artifact references, the run revision/status, and an immutable copy of
the **complete batch**. Later result updates cannot erase prior observations.
`checkpoint_batch(project, run, revision)` reads that historical batch.
Tool-call identity, tool name, step ID, and arguments are immutable; a new attempt
needs a new call ID. Results/status can update at a new run revision. Event IDs
are immutable and their per-run sequence is assigned in the transaction.
Each batch contains new messages/events/artifact references and the step/tool/
changeset updates for that transition; do not resend already attached references.
Stale writers receive `conflict` and must reload. A terminal run cannot be edited;
continuation starts a new run. Messages cannot be overwritten.

Before scheduling an external operation, commit its intent and `inFlight` state.
After observing the operation's actual outcome, commit its result and next state.
A SQLite transaction cannot cover an external UE operation. `snapshot()` is a
coherent read of one revision; it always reports `requiresFreshAuthorization=true`
and flags `inFlight`/`unknown` calls as `hasUnknownExternalEffects`. Reading a
snapshot never executes anything or changes the saved status. On process restart,
the coordinator must display incomplete tasks as paused or awaiting reconciliation,
obtain fresh task authorization, and check unknown external effects before retrying
any write. A saved status or historical conversation is never approval.

All DTOs serialize with camelCase and reject unknown fields. Structured tool
arguments/results and event data reject credential/authority keys such as
`apiKey`, `authorization`, `approvalToken`, and `executionToken` (including
nested variants with punctuation/case differences). Adapters must exclude actual
credentials before calling the store. Freeform native message text is preserved
exactly; the store is not a general secret detector or encrypted vault.

## Public operations

| API | Purpose |
| --- | --- |
| `open`, `open_with_options`, `schema_version` | Open/migrate a trusted app-data directory |
| `create_project`, `projects` | Stable project records |
| `create_session`, `sessions`, `update_session` | Native conversations, rename, archive |
| `append_messages`, `messages`, `search_messages` | Full body records; ordinal pagination and literal search |
| `branch_session` | Copy a chosen message prefix to a new native conversation; preserve message origin |
| `start_run`, `run`, `runs` | Task identity, state and revision |
| `commit_checkpoint`, `checkpoint_batch`, `snapshot`, `events` | Transactional transitions, immutable history and recovery display |
| `put_artifact`, `read_artifact` | Project-scoped immutable bytes, SHA-256 integrity and reference-based reads |
| `usage`, `backup`, `export_project_jsonl` | Capacity inspection, complete backups and project-only text export |
| `import_legacy_jsonl`, `import_provenance` | Explicit historical-copy import and truncation provenance |

Page limits are 1–500 records. Message/event cursors are ordinals/sequences;
session/run/search lists accept an offset. Bodies are not clipped to page limits.
Search is a literal, case-insensitive substring scan using SQLite's built-in
`lower` (ASCII case folding, exact UTF-8 matching otherwise), not semantic search.

## Schema, durability, artifacts and capacity

Schema v1 contains projects, sessions, messages and runs. Transactional v1→v2
migration adds steps, tool calls, events, immutable checkpoints, changesets,
artifact blobs/references and historical import provenance. Reopening is
idempotent. Newer database versions are rejected without migration.
Composite foreign keys enforce project/run/session relationships.

Connections use `foreign_keys=ON`, `synchronous=FULL`, 5-second busy timeout and
rollback (`DELETE`) journaling. Windows controls its bundled SQLite version:
the verification host supplies 3.43.2. SQLite's documented
[WAL-reset race](https://sqlite.org/wal.html#walreset) affects unpatched versions,
so production code does not enable WAL. Enabling WAL in a future revision requires
a validated patched runtime and local-filesystem/concurrency checks. The online
[backup API](https://sqlite.org/backup.html) works with either journal mode.

The default logical database quota is 512 MiB (`max_page_count`), and the artifact
directory quota is 2 GiB. `usage()` also reports physical database, WAL and rollback
journal sizes. Journal/temporary disk usage can exceed the logical database limit.
Capacity failures reject the complete transaction; they never shorten text.
The native adapter should show `capacity` with the backup/export/settings actions.
No automatic retention or deletion is enabled in this first module.

Large logs, screenshots and file contents should use `put_artifact(project, bytes)`;
attach the returned SHA-256 through an `ArtifactRef` in the checkpoint batch.
The caller chooses when to use an artifact; the store never silently replaces or
truncates a message. Project identity participates in blob storage and foreign keys,
so knowing another project's digest does not grant read or attachment access.
Artifact reference insertion verifies staged bytes. Paths derive from digests,
not tool-supplied filenames; reads verify size/hash. Existing reparse points in
storage paths are refused. The app-data directory must remain under native ownership.

Staging uses a separate transaction before the run transition. If the process exits
between staging and attachment, an unreferenced file can remain and is still counted
against capacity. No missing/unreferenced file is treated as a successful tool result.
A crash during a file write can leave a partial blob; integrity checks refuse it.
Automatic orphan collection/repair is intentionally absent. Backup includes every
blob registered in its database snapshot and verifies all of them.

`backup(new_absolute_directory)` refuses an existing destination. It copies the
committed SQLite snapshot with the online backup API, then copies and verifies its
immutable blob set. Only `backup.complete.json` marks success; a failure may leave
an incomplete destination for inspection. Restoring means opening a **complete**
backup directory with `RunStore::open`, with fresh runtime authorization as above.
`export_project_jsonl(project, new_absolute_file)` exports one project's records,
full bodies and artifact references, ending with `exportComplete:true`. It does not
include binary artifact bytes; use backup for a complete restorable copy. Partial
exports have no completion footer. Export/import never overwrite an existing file.

Backup and export validate their destination **before creating anything**. Both
require a local drive path outside the managed run-store directory. Existing
parents are canonicalized and must still have an absolute Disk/VerbatimDisk
prefix before any missing tail is created. A drive-looking input that resolves
to UNC/device space is rejected before containment comparison. The source store
root uses the same existing-parent check before directory creation and is checked
again after canonicalization. Nonexistent tail components are retained, and
containment uses Windows ordinal case-insensitive component comparison. Dot/parent segments and verbatim disk paths resolve to the
same creation path; a sibling such as `store-backup` is allowed. UNC/device paths,
alternate-data-stream names and ambiguous trailing-dot/space names are refused.
This prevents backup directories or exports from contaminating the source artifact
directory or consuming source storage space. Missing external parent directories
are not created automatically.

## Historical JSONL import

Pass the read-only `workspace.jsonl`, an explicit target project ID, and selected
`LegacySelection { chat_id }` entries. Import validates every checksum/revision in
the original chain and reads the latest snapshot. It rejects incomplete final lines,
unknown schema/fields, recognizable credential/authority text, ambiguous selections,
and sources over 32 MiB. Failure is explicit, with no clipping or source modification.

Only selected titles, timestamps, archive flags, roles and message text are copied.
Old theme, project-root selections, connection flags, configuration, credentials,
approvals, execution tokens and run state are not copied. The source fingerprint
and revision provide idempotency per project/chat/source. The original file is never
opened for writing. Labels are never used to infer the target project.

Imported sessions/messages carry `historicalTextCopy`. Import provenance always
states `priorTruncation:"unknownCannotRecover"`: the original 60-message/8192-byte
limits may already have removed text, and that text **cannot be reconstructed**.
The UI must show this fact, not label a historical copy as a complete run. These
sessions cannot be renamed, appended to or started as runs; use `branch_session`
to continue in a new native session, with a new run and fresh authorization.

## Focused verification

Run only this module, without the Tauri build or a Provider/UE connection:

```powershell
$env:CARGO_TARGET_DIR = Join-Path $env:TEMP 'uagent-local-run-store-target'
cargo test --offline --locked --manifest-path apps/desktop/src-tauri/tests/local_run_store_tests/Cargo.toml
```

The harness compiles the production module directly with the existing dependency
set. Synthetic fixtures cover multi-megabyte Unicode/NUL messages and full tool,
event and diff bodies after reopen; actual v1→v2 migration/reopen idempotency;
cross-project record/search/artifact isolation; late constraint/disk-quota failure
rollback; stale and parallel writers; immutable checkpoint/tool identity history;
historical checksum/read-only/idempotent import and authority refusal; artifact
capacity/integrity; complete online backup (including a controlled single-connection
WAL fixture); and project-only export. This is native SQLite validation, not a real
Provider, UE, Tauri UI or cross-restart runtime acceptance test.
The quota test triggers SQLite's configured page limit, not a physically full
disk. Reopen tests do not force-kill a process. The fresh-authorization flag is a
storage contract; enforcement has not been connected to Tauri command adapters.

Path-prefix tests classify supplied input/canonical path strings only. No shared
folder or mapped network drive was configured. Real mapped-drive, 8.3 and SUBST
behavior has not been exercised.
