# Project memory approved snapshot

## Current r14 scope

Local project-memory storage and review are integrated: users can create, read, revise, confirm and retire facts, decisions and todos with source/version and validity information. Responses is archived. Neither the current Codex nor DeepSeek path provides the completed memory-sharing flow described below; Codex investigation does not automatically inject project memory. See [current provider scope](desktop-provider-and-conversation.md) and [r14](releases/r14.md).

## Historical Responses integration on 2026-11-05

The following records the earlier approved-snapshot implementation and its validation. At that stage, source memory dispatch was enabled for the temporary-credential Responses investigation path after synthetic native handoff validation. Saved credentials, fixture profiles, ordinary chat and other provider adapters were excluded. Read/share authorization and full per-request outbound approval were required. Desktop binaries had not been rebuilt for that change. These statements do not enable a current provider route.

The existing native batch owns copied complete records and one canonical memory section. The prepared request owns the original immutable full body (`Arc<[u8]>`); its approval binds the body hash, endpoint, model, owner, config, credential and lease. The sender must transmit that same body, never reconstruct it from the current database. The final shared transport boundary now verifies its original body binding again.

The linearization point is final native admission (L), not the earlier UI click. Before L, the complete selected records must still match under the real `BEGIN IMMEDIATE` transaction; edits, privacy changes, retirement and source changes fail the old request. Source files remain pinned by the original deny-write handles. The project/read/share scope, session, owner, deadline and cancellation checks are not replaced by snapshot semantics.

After L, edits to descriptive memory rows apply to future requests. They do not rewrite this already admitted immutable request. To stop the in-flight request, use Stop/session revocation; bytes already transmitted cannot be recalled. The outbound review displays this distinction. Database transactions still finish and the original Store domain is released before transport; no network call is moved under SQLite locks.

The previously demonstrated second-connection write after COMMIT is therefore not by itself a byte-consistency failure. It would be incompatible with a different promise that every database row must remain current throughout transport; this snapshot contract makes no such promise. This does not replace recovery/operation admission, authorize writes or enable providers.

Historical evidence: `2026-10-29/evidence/t07-approved-snapshot-20261105-r1` and `2026-10-29/evidence/t07-positive-memory-pipeline-20261105-r1`. The latter exercised actual MemoryPreflight, original native run creation, document lifecycle grant, ManagedRunStore SQLite worker, RuntimeHost admission, Store release and ReadyMemoryPermit.send with synthetic data and mock transport. It checked exact approved bytes, source deny-write guards, later memory retirement, one-shot consumption and cancellation after release. In that path, new stores initialize a completely absent effect journal during authorized memory-run binding; partial journals are rejected, existing journals are never repaired or migrated.

The Webview/OS prompt issuance boundary and generic source checker were test substitutes. That validation did not exercise actual Tauri GUI authorization, AppHandle routing, HTTP transport or desktop UI. No real model request or project data was sent. Snapshot/transport concurrency coverage was separate from the native positive pipeline checks; neither establishes a current Codex/DeepSeek memory-sharing flow.
