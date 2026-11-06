> **r14 current status:** The effect-reconciliation module is declared and integrated with the native recovery catalog and startup barriers. The unregistered/future-host statements below are historical foundation-stage descriptions. Current recovery does not recreate old authority, blindly resend effects or prove external process completion. See [r14](releases/r14.md).

# T18 persistent effect reconciliation foundation

This is an **unregistered native module**, based on `1ea43939ce57effc07584a17dd55e95905c30a93`. It adds no Tauri command, runtime export, UE permission, Provider call, background service or automatic resume. Production `local_run_store/mod.rs` remains unchanged; [the declaration patch](effect-reconciliation-entrypoints.patch) is only a future integration suggestion.

## Storage and immutable identity

The opt-in child module `local_run_store/effect_reconciliation.rs` reuses the **same RunStore SQLite connection**, rollback guard, Windows `winsqlite3`, foreign keys, quota and `DELETE` / `synchronous=FULL` configuration. It does not duplicate the checkpoint/artifact store or SQLite wrapper. Ordinary RunStore opening does not enable this extension. Explicit initialization installs extension **version 2**: `effect_journal_meta`, `effect_intents`, `effect_journal_events`, `effect_dispatch_gates` and `effect_dispatch_events`. The main `user_version=2` and existing run revisions do not change.

EffectIntent records the project/operation, actual held-root volume/file ID, complete T19 owner plus native execution/step/host generation, adapter ID/version, approved-plan SHA-256, redacted summary, exact read-only targets, canonical resource claims, native-selected idempotency digest and creation time. The operation key is `(projectId, operationId)`; idempotency digests are unique within a project. Existing identities/plans cannot be upserted into a different operation. A run must exist in that project, and preparation rejects terminal runs. File locators are bounded relative slash paths; UE locators are exact `/Game/` packages. Duplicate/case-aliased targets fail closed. Limits: 128 targets, 16 claims and 512 UTF-8 bytes of summary; 128 outstanding volatile preparations per journal. Resource serialization matches T19 exactly (`ue-editor`, `ubt`, `file-write`).

No grant, credential, approval token, live lease, root path to reopen, raw handle or resumable dispatch ticket is persisted. Random gate/query correlations are comparison data, not credentials or approval. DTOs reject extra fields; the native caller must redact descriptors because a schema cannot detect every secret string. Payload checksums detect accidental damage, not an adversary who can rewrite the app database. Storage inherits RunStore's app-data/path threat boundary; this does not turn it into a new held-file database implementation.

SQLite backups include all extension tables. The existing project JSONL exporter enumerates older tables and **omits this extension**; it is not a complete T18 backup/import. No backup restores authority or becomes a second live ledger automatically. History/snapshots have not been wired to the new catalog. The future host must join these records into recovery/admission explicitly.

## Persistent effect state

| State | Meaning |
| --- | --- |
| `prepared` | Intent committed; no dispatch ticket issued yet. Review/abandon; recovered data cannot recreate its ticket. |
| `mayHaveBeenSent` | Committed before any handoff; actual send may or may not have happened. Query, never blind resend. |
| `resultUnknown` | Missing/incomplete/unavailable/unsafe outcome; retain unresolved effects. |
| `verifiedCompleted` | Exact operation-bound, complete and quiescent evidence confirms the effect; skip this operation. |
| `verifiedNotOccurred` | Exact absence plus quiescence, or prepared cancellation before any ticket. A later attempt needs new identity and new approval. |

Each effect transition and its full immutable event commit with record-revision CAS. That CAS alone is **not** a handoff fence: a retained ticket could otherwise enter its callback after an observer had captured absence, without changing the effect revision. Version 2 therefore has a separate persistent dispatch epoch and history, checked before any observer and again before confirmation, including duplicate-confirmation early returns.

## Dispatch and observation share a durable fence

| Dispatch phase | Allowed transition |
| --- | --- |
| `prepared` | Same transaction as the original intent. Ticket issuance may change it to `open`; a query/cancel may permanently close it. |
| `open` | One original ticket may claim it, or query/cancel may permanently close it. SQLite serializes these alternatives. |
| `inCallback` | A claim was committed before entering the synchronous callback. No observer may confirm results or quiescence until settlement is committed. |
| `settled` | The synchronous callback returned and its exact claim settlement committed. Query is allowed; further handoff is impossible. |
| `closed` | No callback may enter. Query is allowed; there is no reopen transition. |

`CurrentRun::from_verified_host` requires a held root and the real host freshness check; it does not approve an operation. `prepare` registers only a newly created intent in a volatile context map. Re-reading an existing row never re-registers its ticket. `mark_may_have_been_sent` commits the effect transition and `prepared -> open` gate together, then returns a nonserializable, one-use ticket tied to that exact CurrentRun and **journal instance**. SQLite errors return no ticket. Wrong-journal/context attempts consume the volatile ticket and cannot redirect it to another connection/database or recreate it after restart.

`dispatch_once` now accepts only `FnOnce(&EffectIntent) -> ()` and returns `Result<()>`. A returned, unpolled Future is a compile error. It takes `BEGIN IMMEDIATE`, checks record/plan/ticket plus gate epoch, and commits `open -> inCallback` before the callback can run. If a query won first, this claim fails before handoff. If the claim won first, every connection sees an unsettled callback and must reject confirmation without calling its observer. The callback still needs the real exact-plan approval and resource lease at the protected executor boundary.

The callback must perform its actual synchronous handoff before returning, or register **all** scheduled/running native work under the exact original execution owner before returning. The external observer must cover that owned pending work as well as running work. A future protected adapter that cannot establish this boundary must stay disabled and return unknown; this foundation installs no production adapter that could assert it. Unit return types prevent a direct Future-return mistake; they do not prove arbitrary native code cannot bypass the protocol or launch untracked detached work.

After a normal callback return, `finish_handoff` commits `inCallback -> settled` using only the immutable intent and original claim nonce/epoch. It does not require the old effect revision, uncancelled status or a still-live execution lease: cleanup bookkeeping cannot revive those permissions, and cancellation/lease expiry must not prevent recording an actual return. If eligibility failed before entry, the exact claim may instead close without invoking the callback. No transaction holds the SQLite write lock over external work.

A panic/abort, missing settlement, database write failure or failed settlement COMMIT leaves `inCallback` unresolved. Even an observer reporting NotOccurred/Quiescent cannot override it. There is no public force-settle or claim-reconstruction API, and no timer, cancellation or connection reopen infers return. Reopened uncertainty requires a separately reviewed managed-host proof/adoption design; this slice stays blocked/manual. It does not silently unlock after a crash.

Before calling an observer, `fence_query` takes `BEGIN IMMEDIATE`, rechecks the exact owner/revision and irrevocably closes `prepared/open` with its epoch/history in the same transaction. `inCallback` returns `handoffUnsettled` and invokes no observer. `closed/settled` provides the captured fence. A fence COMMIT failure produces no observation or quiescent proof. A successful fence remains closed even if observation later fails, is cancelled or expires. Volatile entries are removed after fence success; pruning also checks the gate, not only the effect row.

The external read runs outside the transaction. Confirmation then rechecks the same closed/settled fence and record CAS in another `BEGIN IMMEDIATE` transaction. Thus both orders are covered: query-first prevents the original ticket from handing off; claim-first prevents a pre-return absence snapshot from being accepted. Concurrent cancel/result updates still defeat stale record CAS. `request_cancel` closes only `prepared/open` in its transaction; an `inCallback` claim/epoch is untouched and remains unresolved until actual settlement. App-data cancellation does not terminate a process or undo files.

## Fresh read-only effect proof

The host first obtains **new** selection, same physical held-root identity, exact read permission and current query generation, then constructs a nonserializable RecoveryReadScope for one original operation/full owner. Persisted strings cannot select a project, reopen trust or authorize a run. Wrong project/root/owner or revoked/expired scope fails closed. A new reader may inspect an old host generation; observations still bind that exact original execution, not a new owner.

ReadOnlyEffectObserver has only adapter identity and read observation. The journal requires the original adapter/version, creates a fresh query correlation and binds the response to query ID, project/operation, full original owner, root, immutable intent/plan, idempotency and target-scope digest. Wrong/stale responses are rejected. This is a **trusted native adapter**, never a model callback or a generic acceptance of peer-asserted success. It must read only the original targets/receipt. No hidden load/compile/save, resend, termination, trust extension or credential renewal belongs in it.

Proof reports completed/not-occurred/unknown, exact/partial coverage, operation-bound/unproven attribution, execution quiescent/active/unknown and an evidence digest. Hash equality, absent/recycled PID, Actor counts/tags, endpoint silence or cancellation alone cannot establish ownership/absence. Partial/unowned/active/unknown observations cannot confirm positive final results. Explicit external-change evidence needs a digest and stays manual even alongside active/partial execution. A `closed` no-handoff gate plus an asserted completion is impossible under this protocol and is quarantined.

Freshness is checked from query start before recording/committing; live proof expires five seconds after that same start. Late/cancelled results are discarded. Synchronous COMMIT/flush or a blocked native adapter cannot be preempted by this deadline: an expired returned proof yields unknown. The future host must use bounded I/O on its existing worker, propagate cancellation and retain unresolved resources; this module starts no service/worker itself.

Repeated identical facts do not duplicate effect revision/history, but still validate the gate. `lastVerifiedOutcome` survives temporary unavailable/partial/unsupported observations, allowing a later consistent fresh proof to confirm again. Opposite verified facts, impossible completion or explicit drift enter sticky manual review; an unknown interval cannot wash out an older confirmed fact. No later observer silently clears that quarantine.

## Existing effect adapters and T19

No production observer is installed here. Reuse existing capabilities within their actual boundaries:

- **T10:** archive the exact preview/receipt and backup reference with existing artifact/journal storage. Reopen only newly authorized exact-file reads and compare actual object IDs/hashes with that plan/receipt. Current RepairSession queries depend on an in-memory prepared plan; deserializing it cannot restore handles/approvals. Unknown partial writes or outside edits require new, separately approved recovery changesets.
- **T09:** query the exact owned native execution including pending work and process tree. Saved exit code/logs or a missing PID do not prove quiescence. If reliable ownership is gone after restart, return unknown. Build scripts may have effects beyond listed outputs.
- **T13/T14:** stable operation/effect query, package/map identity/hash/reference proof only where implemented. Current-run Actor weak references/GUID attribution/resume tokens are not made restart-safe. Missing attribution stays unknown; no auto-load, editor undo, binary rollback or package save is added.

`pending(project,limit,offset)` is a bounded app-data catalog. An empty page may still have `nextOffset`: follow every cursor and scan all relevant saved projects before admitting a shared root/engine resource. Corrupt/unavailable pages are not an empty catalog. A missing/mismatched dispatch gate fails these reads closed. The future host must install unresolved-effect startup barriers before new conflicting work and serialize its catalog/admission; no new global lock is implemented here.

T19 remains one shared queue in one process. Local callback settlement, external execution quiescence and effect completion are distinct. ReconciliationResult exposes only a short-lived observation for the same fresh read scope/original owner, constructed after gate/record validation; stored observation JSON cannot recreate it. Map it only through the original captured T19 ticket, never release by public ID or relabel it to a newer owner. T19 still checks its own callback settlement. Unknown/active retains locks. Exact quiescent execution may release its T19 lane while effects remain unknown; the separate T18 recovery barrier still blocks conflicting recovery writes.

## Connection/version and manual recovery boundary

The fence is enforced through SQLite transactions in the **same physical database**, not a JavaScript mutex or record CAS alone. Cooperating v2 connections, including the original ticket holder, must use this protocol. Tickets stay with their issuing journal; backup copies/different databases are not another live execution authority. No project/engine OS lock, protection from arbitrary native code bypass, global multi-database exclusion or all-filesystem namespace atomicity is claimed. The tests establish one process with two real SQLite connections on two threads; separate-process/real killed-host/power-loss behavior has not been experimentally verified.

Unfenced extension v1 data cannot establish that an old callback cannot still enter. Version 2 therefore returns `unfencedLegacySchema` for v1 **without migrating, deleting or adopting its records**. Future versions are also rejected. New v2 databases exclude old v1 initializers through the same version check. Do not run an already-loaded old implementation against an adopted live ledger or call copied old confirmation data safe; resolving those old executions requires a separate managed-host migration/recovery design. The production extension remains unregistered, so there is no automatic user-data upgrade.

For unknown, in-callback or quarantined work, show the original plan/targets, gate/effect history, backup/log references and missing proof. Permit fresh scoped reads where allowed; do not offer mark-done, force-unlock, resend or restored-old-approval buttons. If attribution or callback settlement cannot be established, leave the project blocked until independent ownership can be proven. Any later mutation/build requires current authority, new exact approval, a new operation/idempotency identity and existing T10/UE checks. Human acknowledgement alone does not prove an execution stopped.

Before enabling in main: opt into the declaration and initialization; implement safe v1 handling, startup barriers/history and backup/export policy; resolve fresh roots/read scopes; install only protected synchronous handoff adapters with complete original-owner registration and bounded effect observers; bridge T19 and new recovery approvals. IPC/tool registration and production writers stay disabled until separately reviewed. No persistent credentials or production access change is introduced.

## Local evidence

Run `scripts/test-effect-reconciliation-native.ps1` after the E/G environment helper. It compiles a scratch copy of RunStore with the child declaration, using cached dependencies and Windows SQLite; production declaration remains absent. Latest focused validation: **37 native tests passed**, 35 unchanged tests filtered, plus an **expected E0308 compile rejection** for returning an unpolled Future. No full-project regression.

The new fence cases exercise the exact original and reverse two-thread/two-connection interleavings, cancelled queries, owner expiry during callback, reopen, missing gates/v1 refusal, callback unwind, write failure and real deferred-FK COMMIT failures at fence/claim/settlement. Actual `query-wins.json` and `dispatch-wins.json` results are retained in the unique fixture directories alongside their SQLite files. Existing cases cover drop/reopen windows, exact owner/scope binding, duplicates, cross-project isolation, corruption, temporary observer failure, outside drift and capacity cleanup. Tests/negative compile logs and `validation-dispatch-fence-v2.json` live under E-worktree `tmp/effect-reconciliation-native-check`.

Observers/handoffs are deterministic synthetic fixtures. No real UE/API, new service, permanent data deletion or production recovery is exercised. Rust unwind/drop/reopen is not real power loss or a killed host. This is a verified foundation and race fix, not completed cross-process resource locking, cross-restart binary asset recovery or production recovery acceptance.
