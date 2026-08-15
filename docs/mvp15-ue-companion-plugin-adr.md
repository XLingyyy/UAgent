# ADR: UAgentAssetTools Companion Registration Route

- Status: `COMPLETE` — Direct remains selected; UE 5.8.1 Final Source/Tooling
  Rework 8 changes no route
- Date: 2026-08-02
- Scope: MVP15D registration-route decision under final source/tooling rework
- Decision owner: implementation Agent; final acceptance remains with supervisor

## Current Source/Tooling Rework Decision Status

Task
`TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-FINAL-SOURCE-TOOLING-REWORK-8-AUTHORITATIVE-LAUNCH-BOUNDARY-AND-REPORT-CLOSURE`
does not reopen the D0 route decision. Direct remains the selected production
registration route; Toolset Registry remains closed and no fallback is
permitted.

Final Source/Tooling Rework 7 is the historical/current predecessor `PARTIAL`;
its supervisor verdict was `NEEDS_FIX`, and no checkpoint was created. Final
Source/Tooling Rework 8 is `COMPLETE` with supervisor `PASS` at implementation
commit `98c8b387e1124a519977849d48ab824e4e6bb9c5`. Current source checkpoint
`a780fc4231b99b39153fb88c9ab460717610b3f3` preserves the Direct route while
accepting only the official UE 5.8 BuildPlugin descriptor transform. Its release-binary
capability bridge and two-level persisted-consistency / owned-launch authority
reaches the existing normal-product adapter without changing Direct or strict
exact-six retraction; no live registration ran. G14 is `IMPLEMENTED`; G15 is
`COMPLETE`; G16 is
`PARTIAL`; D13 / 15A is `DISPATCHED`; D14 / 15B waits on 15A and D15 / 15C
waits on 15A/15B;
D16 is `IN_PROGRESS`; real UE 5.8.1 compatibility and overall acceptance
remain `PARTIAL`; Ready is `NO`.

## Historical Source Checkpoint Rework 7 D0 Decision Matrix

| Registration route                      | Tool Search | Product session | Independent index | Mutation | Status      |
| --------------------------------------- | ----------- | --------------- | ----------------- | -------- | ----------- |
| Direct `IModelContextProtocolTool`      | ON          | Recorded        | Validated         | 0        | IMPLEMENTED |
| Direct `IModelContextProtocolTool`      | OFF         | Recorded        | Validated         | 0        | IMPLEMENTED |
| `UToolsetDefinition` / Toolset Registry | ON          | Recorded        | Validated         | 0        | IMPLEMENTED |
| `UToolsetDefinition` / Toolset Registry | OFF         | Recorded        | Validated         | 0        | IMPLEMENTED |

The four sessions form one matching accepted-source evidence set and select
Direct. Toolset Registry is an evaluated, closed alternative and is not a
production fallback. `BLOCKED_BY_EVIDENCE_RETENTION` remains closed.

UE 5.8 publishes generic Toolset Registry meta-tools under Tool Search and stock
Toolset tools in eager mode. Those server capabilities are route-neutral. A
Direct-route conflict is the qualified task probe
`UAgentAssetTools.UAgentAssetToolsD0Toolset.Probe`; Direct production registers
only `uagent.d0.probe` for this D0 decision. The Toolset probe remains
task-flag-gated and mutation-incapable. Direct uses the strict four-field empty
input schema; Toolset validation matches UE 5.8's exact zero-parameter
UFUNCTION schema `{ "type": "object" }`.

## Historical Rework 3 Supervisor Interpretation (not a route decision)

The companion has two task-only, mutation-incapable probe implementations.
Four UE Commandlet Automation markers exercised them with Tool Search enabled and
disabled and reported `mutationCount: 0`. They did not originate from the UAgent
desktop product adapter and contain no initialize/discovery descriptor transcript,
product no-op, reconnect, Editor restart, or stale-publication observation.

Historical supervisor verdict: Rework 3 was `NEEDS_FIX`; no route was selected.
The later Rework 4 requirement was to run the actual four product-adapter
combinations through a supervisor-verifiable process and artifact chain. A dirty
pre-checkpoint tree was not a substitute for that evidence, but it was not an R4
blocker either.

## Context

The active project-local Unreal MCP bytes do not have an authoritative Epic
source/build mapping. UAgent therefore uses an independent `UAgentAssetTools`
companion plugin. Epic's `ModelContextProtocol` remains an unmodified
localhost MCP transport and public extension point.

## Historical pre-rework D0 matrix

| Registration route                      | Tool Search | tools/list / discovery                      | no-op call | Refresh / reconnect / restart | Status        |
| --------------------------------------- | ----------- | ------------------------------------------- | ---------- | ----------------------------- | ------------- |
| Direct `IModelContextProtocolTool`      | ON          | NOT RUN — resolved UE 5.8 path was not used | NOT RUN    | NOT RUN                       | `IN_PROGRESS` |
| Direct `IModelContextProtocolTool`      | OFF         | NOT RUN — resolved UE 5.8 path was not used | NOT RUN    | NOT RUN                       | `IN_PROGRESS` |
| `UToolsetDefinition` / Toolset Registry | ON          | NOT RUN — resolved UE 5.8 path was not used | NOT RUN    | NOT RUN                       | `IN_PROGRESS` |
| `UToolsetDefinition` / Toolset Registry | OFF         | NOT RUN — resolved UE 5.8 path was not used | NOT RUN    | NOT RUN                       | `IN_PROGRESS` |

## Historical Rework 2 expected D0 evidence matrix

| Registration route                      | Tool Search | tools/list / discovery                                                 | no-op call | Refresh / reconnect / restart | Status        |
| --------------------------------------- | ----------- | ---------------------------------------------------------------------- | ---------- | ----------------------------- | ------------- |
| Direct `IModelContextProtocolTool`      | ON          | NOT RUN — no independently verifiable product-adapter transcript chain | NOT RUN    | NOT RUN                       | `IN_PROGRESS` |
| Direct `IModelContextProtocolTool`      | OFF         | NOT RUN — no independently verifiable product-adapter transcript chain | NOT RUN    | NOT RUN                       | `IN_PROGRESS` |
| `UToolsetDefinition` / Toolset Registry | ON          | NOT RUN — no independently verifiable product-adapter transcript chain | NOT RUN    | NOT RUN                       | `IN_PROGRESS` |
| `UToolsetDefinition` / Toolset Registry | OFF         | NOT RUN — no independently verifiable product-adapter transcript chain | NOT RUN    | NOT RUN                       | `IN_PROGRESS` |

### Historical Rework 2 interpretation

The historical Rework 4 source validator is `scripts/mvp15d-d0-spike.mjs`. It
validates a complete hash-indexed task-process/artifact/transcript chain
emitted from the desktop/native connection-session-discovery boundary. It has
no same-run signer or implementation-owned signing-key requirement. The paired
`scripts/mvp15d-d0-capture.mjs` only indexes already-produced redacted product
transcripts; it neither launches UE nor presents supporting UE Automation as D0
evidence. Missing or incomplete combinations fail closed and no helper performs
asset mutation. No live D0 evidence, schema decision, fingerprint, or mutation
pass is claimed by this checkpoint.
The historical environment-blocker claim was rejected during supervisor review:
the fixed UE tools exist, but those tools are reserved for the separate
supporting R4 Automation runner rather than the D0 evidence producer.

Rework 1 supplied only a verifier and test-generated envelopes; Rework 2 changed
only renderer blocked-result normalization. Neither added a product-adapter
capture producer, and an implementation-created signature was not independent
product evidence. The historical Rework 3 probe routes remain supporting-only;
the historical Rework 4 attempt was required to capture the actual product
lifecycle before this matrix could pass.

## Historical Rework 3 Source Candidate (not a decision)

The reworked source registers task-only Direct and Toolset probes, but this is
not a D0 route decision. Historical UE Automation source coverage may exercise
their registration and refresh behavior, but cannot prove the UAgent desktop
product lifecycle. Direct and Toolset Registry remain D0 alternatives until a
current four-session, hash-indexed product-adapter chain proves complete
lifecycle, identity binding, and zero mutation. A clean source commit/tree is
not a D0 prerequisite during R4; it is required later for final 15A packaging.
Only then may this ADR select one production route and close the other.

## Identity and safety consequences

- Required invariant: the plugin publishes `x-uagent-plugin` only after strict
  manifest/self-hash/artifact validation. The reworked source enforces this;
  no production mutation is authorized until D0 and loaded-module evidence pass.
- Required invariant: runtime accepts only an attested exact-six descriptor set
  selected by D0. A missing,
  duplicate, unexpected, reordered, malformed, stale, or identity-mismatched
  set retracts readiness.
- `ue.asset.delete` is inverse-only. The forward dry-run has five operations:
  create folder, duplicate, rename, move, and save.
- Native UAgent still owns trusted root, live UE observation, feature gate,
  one-shot approval, operation guards, and external Content evidence.
- The companion never performs Save All, bulk operations, Blueprint/level
  compilation or save, non-sandbox writes, or replay re-execution.

## Fallback closure

D0 selects Direct for the production registration route. Toolset Registry is
not an implicit or automatic fallback, and no generic wrapper is permitted. The
historical Rework 2 15A attempt failed independently of this route decision.
The next permitted work is a separate clean-checkout read-only compatibility
task based on the Rework 8 implementation commit; it is required before
package execution resumes. Real mutation remains prohibited.
