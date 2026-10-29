# Responses runtime integration

Base: 8a28a1fe7178db0f9b5b4886bee85f70735fb8d1.
Reviewed protocol layer: d17f676aa76b37f1cd5e779bb377ee554739b831.
Only shared contracts and runtime/provider implementation are integrated here;
desktop UI/IPC/Rust and production SQLite continuation persistence remain owned
by the main integration thread.

## Explicit session construction

Use createProviderRuntimeSession with wireApi:"responses". The runtime factory
implements that native contract and rejects unsupported protocol selection. It
does not fall back to Chat Completions, another model or another endpoint.

    const session = createProviderRuntimeSession({
      wireApi: "responses",
      providerId: configuredProviderId,
      modelId: explicitlySelectedModel,
      endpoint: approvedFullResponsesEndpoint,
      mode: "live",
      owner: freshRunOwner,
      isCurrent: freshRunLease.isCurrent,
      getProjectContext: readCurrentTrustedProjectContext,
      outboundGate,
      continuationStore,
      reasoningEffort: explicitlySelectedEffort,
    });
    session.setCredential(locallyEnteredSessionKey);
    registry.register(session.adapter, {
      wireApi: "responses",
      baseUrl: session.getStatus().endpoint,
      networkMode: "live",
      secretRef: null,
    });

The endpoint is the full Responses target, normally the configured API root plus
/responses. Construct it through the same trusted endpoint policy used for
transport. Do not route a stored configuration to a network transport until the
main session owner explicitly opens it. Registry network mode and capability
flags do not imply credential presence, a paid test, or verified service support.

The fresh owner contains providerId, modelId, projectId, projectEpoch, runId and
conversationId. Project/epoch must match the actual trusted callback. The current
RunScopeLease remains the sole execution owner. Loaded records cannot supply it. The runtime factory requires the current lease's
isCurrent function and checks it around data I/O and delivery.

## Native continuation persistence port

ProviderContinuationStorePort has load(owner, signal) and save(record, signal).
Implement it behind the existing native run store, using a trusted native root.
Records are bounded JSON descriptions: schema version, wire contract, exact owner,
request/response IDs, local capture time, assistant text/calls and complete native
output (including encrypted reasoning/phase). There are no credentials, trust,
approval grants, connected/test states, pending tool dispatches or scheduling data.

A save must acknowledge an immutable complete record. A conflicting overwrite
must fail. Load must return only records for the exact owner; the adapter rechecks
all ownership fields and rejects unknown top-level/owner/assistant fields.
It limits records to 128, each to 1 MiB and loaded batches to 8 MiB. It validates
native replay with the already-reviewed protocol parser and checks the decoded
argument credential boundary again on actual outgoing input.

The adapter withholds completed tool calls until native-output save succeeds.
An uncertain/failing save poisons that adapter for reconciliation, without an
automatic retry. A cancelled save may still have preserved inert data; it never
authorizes tool execution. A new adapter still needs a new in-memory credential
and fresh outbound approval even if every continuation is already in the store.

This port is independent of RunStorePort.commit. The production native adapter
must serialize its own persistence operations and document acknowledgement/
transaction behavior. Orphan continuation data after a coordinator commit failure
must remain inert. A store implementation must not recreate a coordinator or
dispatch saved tool calls while loading records.

Restoration supports fresh provider sessions under the same exact data owner.
The current desktop saved-history flow starts a new run ID. Cross-run/epoch
reasoning transfer is deliberately not inferred: selected native data would need
an explicit reviewed provenance/sharing mapping plus current source validation.
Do not re-label old native records with a new owner to bypass the checks.
Ordinary history without native tool-call data can start a new investigation.

## Unknown usage

ProviderRuntimeResponse.usage is optional. Runtime responses carry usageStatus:
reported or unknown; absence of old adapter status is normalized from actual
usage presence. Contradictory/malformed reported usage fails explicitly.
A stream needs a real terminal chunk; missing usage does not manufacture a
failure, zero counts or a word-count estimate. Cancel/failure placeholders also
contain no usage numbers.

provider_usage_recorded is emitted only for actual provider-reported counts.
provider_request_completed carries usageStatus. The report bridge strips native
continuation output from ordinary task logs and says when usage is unknown.
Trace summaries omit exact totals whenever a request has missing/cancelled/
failed accounting, while preserving labelled reported subtotals. Synthetic mock
stream accounting is explicitly supplied by the fixture, never inferred by the
live runner. Compatible JSON adapters also leave missing usage unknown.

RunCoordinator emits the status in model_completed and no longer forces a
temperature value that a selected Responses model may not accept. beforeSend
still validates selected source references after approval and before network
dispatch. The managed adapter brackets that original hook with checks of its
fixed lease. Native final context reads also include that lease, and a final
synchronous fetch wrapper checks it after grant consumption immediately before
calling the configured transport. No approved body/headers are rewritten.
A lease-only revocation is refused even when project/epoch/revision are unchanged.
No permission scope or retry budget is broadened.

## Main-thread desktop handoff (not edited here)

- safe-provider-session.ts currently wraps only DeepSeek. Add an explicit
  responses branch using this factory and a fresh run owner. Retain the existing
  session close/expiry/project-change invalidation and locally entered key flow.
  Build the per-run adapter when its fresh lease exists; keep any entered key
  inside the existing session-owner closure and never export it to a UI/store.
  Read projectEpoch from that existing trusted context closure, not a saved DTO
  or a guessed default; its present public API only exposes a revision string.
- desktop-runtime-adapter.ts should select the already-open adapter using the
  exact wire API/provider/model/endpoint, then pass it to RunCoordinator. Its
  investigation lease/currentness checks must stay in place. This file was not
  edited; coordinate its provider-selection block before applying a desktop patch.
- Implement the continuation port with native IPC and scoped immutable records.
  Neither native-run-store.ts nor Rust local_run_store/product_settings/lib.rs
  was edited. The existing native-run-store model_completed projection already
  omits absent usage; extend it to preserve usageStatus as well.
- Display missing usage as unknown in event/history/composer report views.
  Do not hydrate verification/connected state from persisted declarations.
- Persisted API roots and DTO wire names must be explicitly mapped to the full
  Responses target and runtime wireApi:"responses". Runtime registry rejects
  endpoint/protocol mismatch and in-place Responses configuration changes.

## Validation scope

Focused synthetic/in-memory tests exercise a three-tool/four-request coordinator
loop, native input/output IDs, encrypted continuation replay, mixed reported/
unknown usage and partial report totals; fresh credential/review after store load;
project/epoch/run/conversation isolation; source changes after approval; pending
fetch/save cancellation and uncertain-store reconciliation; explicit registration
and protocol refusal. Existing directly affected provider tests are also checked. The prior integration run passed 204 cases across 9 files, including 108 native protocol regressions and 18 integration cases. The lease-dispatch correction was then checked with 26 focused integration cases (the existing 18 plus 8 dispatch/order regressions). Its four approval/source timing cases and two final-grant revocation cases all require zero fetch calls. Unchanged provider/parser groups were not rerun for that small correction.

All worktrees, temporary configs and test cache are on E:/G:. Validation configs:

- E:\Codex\UAgent\2026-10-29\temp\t03-integration-tsconfig.json
- E:\Codex\UAgent\2026-10-29\temp\t03-integration-vitest.config.mjs

The strict TypeScript check covers runtime sources against this worktree's shared
contracts; no whole-monorepo test run, real API call, real key, paid validation,
desktop UI acceptance or physical native continuation persistence is claimed.
One stale DeepSeek error-message expectation from the base was aligned with the
unchanged implementation; its reservation-retention assertions remain intact.
