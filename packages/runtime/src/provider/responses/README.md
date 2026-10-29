# Native OpenAI Responses adapter (T03)

The native protocol implementation was independently reviewed in cumulative
d17f676aa76b37f1cd5e779bb377ee554739b831. Runtime integration is based on
8a28a1fe7178db0f9b5b4886bee85f70735fb8d1. The reviewed parser is reused; common
usage representation, registry, exports and the runtime/store adapter are now
connected. No desktop UI, Rust entry point, dependency or system setting is changed.

## Entry points and outbound boundary

Import createResponsesSession from this directory's index.ts. Configure an
explicit modelId, optional providerId, and mode ("live" or "offline").
Live mode requires an OutboundConsentGate and getProjectContext. Offline mode
requires an explicit synthetic fetcher and never defaults to network.

setCredential stores a locally entered credential in a closure, outside public
config/status/preview/history objects. clearCredential cancels in-flight work;
dispose also ends the session and clears retained native continuation.
There are no automatic retries or model fallbacks. Returned model identity must
equal the selected model identity; explicitly choose a snapshot if the service
resolves aliases to another ID.

session.adapter implements the existing ProviderAdapter. completeNative exposes
native output items and optional measured usage. session.stream yields runtime
chunks plus usageStatus, responseId and nativeOutput on the terminal chunk.

The actual serialized JSON body, endpoint, selected model and project context
are bound to one outbound grant. After review, beforeSend runs, context is
checked again, the grant is consumed, and exactly the approved bytes are fetched.
Redirects, cookies and browser cache are disabled.

## Native continuation

Input uses native message, function_call, function_call_output and reasoning
items. Runtime tool IDs represent call_id; native item IDs remain separate.
Deltas are progress only: executable calls require a valid terminal response.

Complete reasoning items, encrypted content and assistant phase are retained
and replayed for a matching assistant turn. The cache binds to the actual
getProjectContext project ID and epoch, plus the request's optional run ID.
Request metadata only supplies consistency assertions; missing metadata or epoch
cannot weaken the native scope. Trusted context is copied before preparation.
A missing trusted project identity never enables native reuse. Project/epoch
changes during fetch or between stream consumer steps cancel further results.

Persist ResponsesResult.output (or terminal nativeOutput) with each assistant
turn and its original project/epoch/run identity. Restore through
replayNativeOutput(request, assistantIndex, context), whose third argument is a
readonly snapshot of trusted context. Return a ResponsesNativeReplay record:
projectId, projectEpoch, optional runId, and output. Its identity must match the
trusted scope; a raw output array or another project's record is refused.
Native text and function IDs/names/exact arguments must also match the generic
recorded turn before review or transport.

Generic history can be serialized but cannot reconstruct reasoning or phase
fields that a store lost. Persist native items for reasoning-model restoration.
History is never silently evicted: at 128 retained turns or over 8 MiB of retained
history, the next request fails before sending and needs a fresh session using
persisted turns. One final bounded response can cross that threshold.
Run-store persistence is an integration responsibility.

## Runtime integration and unknown usage

Shared complete-response usage is optional and usageStatus distinguishes reported
from unknown. Both native complete and the ProviderAdapter complete return a
successful unknown-usage result when the service omits usage. The common runner
never estimates usage, including offline Responses, and emits usage records only
for reported counts. Failure/cancellation placeholders contain no zero totals.
Reports show unknown counts and label known partial metrics as reported subtotals.

Use exported createProviderRuntimeSession with wireApi:"responses", a fresh
ProviderContinuationOwner, getProjectContext and ProviderContinuationStorePort.
The managed adapter loads validated data under exact provider/model/project/
epoch/run/conversation ownership and saves native output before exposing completed
tool calls. Its synchronous replay hook reuses the reviewed native validator.
The owner comes from the current runtime lease, never from loaded history.
Missing, ambiguous or foreign native continuation fails before network review.
Records cannot open credentials or restore leases/approvals/verification.

Responses registry metadata must match the bound endpoint/protocol/model.
Session credentials need no saved secretRef. Configuration changes require a
replacement session; capabilities remain declarations and unverified status.
The pre-send callback still runs after body approval and before fetch, preserving
source freshness validation. The fixed run lease is checked around that original
callback, in native final context validation and synchronously at the transport
call boundary after the outbound grant is consumed. See docs/responses-runtime-integration.md for desktop
handoff points and persistence limitations.

## Validation

108 synthetic cases cover native JSON input, call/result round trips, persisted
reasoning/phase restoration, sparse output indexes, parallel argument fragments,
UTF-8 byte splits, LF/CRLF/CR and multiline SSE, terminal reconciliation,
refusal/length/error/cancel, exact-body review, beforeSend/project changes,
timeouts, credential clearing/sanitization, request/response/argument bounds,
unknown usage, no retries/model changes, and the unchanged runProviderStream seam.
Review regressions cover missing metadata/epoch, actual project transitions,
wrong-scope restored output, credential-bearing response and derived identities,
nested result strings/keys, normalized restore/preview/context callback errors,
and duplicate/out-of-order SSE sequence_number values.

Every complete public result and stream chunk is checked recursively for
credential echoes, including response IDs and nested property names. Identity
echoes are refused rather than redacted into protocol identifiers. Preparation,
restoration callbacks and preview share the same sanitized error boundary;
untrusted callback errors/causes are never returned verbatim.

The protocol-defined function_call.arguments JSON string is additionally parsed
once and its decoded values and property names are checked recursively, including
nested arrays/objects. This semantic check applies to native/legacy results,
completed stream calls, cache insertion, historical calls, restored native input,
and the final serialized outgoing body. A dangerous terminal response is refused
before its remaining argument deltas are yielded. Complete accumulated argument
JSON is also checked during streaming; partial JSON is never executable.

The original argument text is never rewritten. Ordinary nested strings are not
parsed as JSON again, and URL/base64 or other arbitrary encodings are not decoded.
Tests cover both value/property escape attacks in all three public response APIs,
nested decoded attacks, split escape fragments, terminal-only responses, cache
poison prevention, credential changes, restored/outgoing inputs, safe literal
double escapes, and exact whitespace/Unicode-escape preservation.

Existing G: dependencies are reused through an E: junction. No package was added.
E:-only local validation configs:

- E:\Codex\UAgent\2026-10-29\temp\t03-integration-tsconfig.json
- E:\Codex\UAgent\2026-10-29\temp\t03-integration-vitest.config.mjs

Run tools\use-e-drive.ps1 in the same PowerShell process first.
The scoped TypeScript config keeps strict ES2022 settings and maps @uagent/shared
to the integration worktree's current shared contracts. It checks runtime sources.
ESLint covers changed runtime/shared files and the new integration modules.
Full-repository typecheck is not certified: the fresh worktree lacks installed
workspace package links. No historical credential was read, no real API was
contacted and no paid validation occurred. Actual account access, selected-model
support, live streaming/CORS and billing remain unvalidated.

## Official protocol references

Searched and opened for this implementation:

- [Responses reference](https://developers.openai.com/api/reference/typescript/resources/responses)
- [Function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [Streaming API responses](https://developers.openai.com/api/docs/guides/streaming-responses)
- [Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events)

Function tools explicitly use strict:false to keep the existing runtime's
schema semantics without changing required/optional properties.
