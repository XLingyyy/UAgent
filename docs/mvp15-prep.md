# MVP15 Prep - Real UE Sandbox Asset Mutation Pilot (Historical)

> MVP15D current note: Final Source/Tooling Rework 7 is the historical/current
> predecessor `PARTIAL`; its supervisor verdict was `NEEDS_FIX`, and no
> checkpoint was created. Final Source/Tooling Rework 8 is `COMPLETE` with
> supervisor `PASS` at implementation commit
> `98c8b387e1124a519977849d48ab824e4e6bb9c5`; current implementation checkpoint
> `7916cf74cb205049e1c8967b9217cb8b64df36ca` preserves G14 `IMPLEMENTED` and
> G15 `COMPLETE`; G16 is `PARTIAL`. Real UE 5.8.1
> compatibility and overall acceptance remain `PARTIAL`; D13 / 15A is
> `DISPATCHED`; D14 / 15B waits on 15A and D15 / 15C waits on 15A/15B; D16 is `IN_PROGRESS`;
> Ready is `NO`. The unsafe predecessor evidence root was
> removed for `TOKEN_AND_RAW_PATH_EVIDENCE_INVALID`. Full read-only
> compatibility follows in a new clean-checkout task based on the current commit.
> Actual release native/product/UI capability handshakes completed with
> zero MCP/network/asset operations. Rework 7 adds sole owned production
> a two-level verification model: persisted cross-binding reports
> `productionLaunchAuthorityVerified: false`, while only the same-process fixed
> producer launch can consume the private receipt and report owned launch
> authority. It preserves the 335-file transitive source boundary with 356
> watches, ancestor-reparse rejection, and fail-closed cleanup;
> these are runtime/source facts, not live compatibility. Real UE, Tool Search,
> and mutation are `SKIPPED_BY_TASK_BOUNDARY`; mutation remains prohibited.

> Historical preparation document. This file records the scope posture used before MVP15 implementation. MVP15C / 09Z later completed the former happy-path lifecycle. Current status, blockers, delivered source tooling, and remaining prohibitions are defined by the acceptance, verification, risk, plugin-baseline, and handoff documents.

## Historical Objective

The preparation objective was to validate the first controlled UE asset mutation path under a sandbox-only boundary. The planned pilot could prepare, execute, verify, and roll back asset changes only under `/Game/UAgentSandbox/**` and mapped `/Content/UAgentSandbox/**`.

## Historical Planned Scope

- Shared contracts for sandbox asset mutation plans, ChangeSets, approval tokens, execution, verification, rollback, evidence, audit, and replay summaries.
- Runtime policy and service for dry-run, approve, execute, verify, rollback, manifest tracking, and replay summary generation.
- Exact MCP adapter allowlist for dry-run-capable sandbox asset operations.
- Tauri native guard commands that reject unsafe asset mutation requests before any native bridge execution.
- Desktop UI for Asset mutation lifecycle state in Inspector, Changes, Settings, and runtime store actions.
- Scenario matrix and side-effect scan hardening for sandbox-only asset mutation boundaries.

## Safety Boundaries

- Allowed asset package prefix: `/Game/UAgentSandbox/`.
- Allowed content path segment: `/Content/UAgentSandbox/`.
- Approval is one-time, bound to ChangeSet id, session id, operation id, asset path, operation kind, and request hash.
- Replay records summaries only and must never re-execute asset operations.
- Evidence and audit payloads must not store raw secrets, approval tokens, provider credentials, or broad local paths.

## Historical Out of Scope at Preparation Time

- Non-sandbox asset writes.
- Save All or project-wide package saves.
- Delete, move, rename, bulk asset operations, or Blueprint compile execution were excluded from the initial preparation posture. A later historical pilot design discussed only exact approval-bound move/rename steps and inverse cleanup inside a registered `/Game/UAgentSandbox/<run-id>` lifecycle; broad/bulk operations, arbitrary deletes, and Blueprint compile remain prohibited. That history does not accept the current MVP15D source checkpoint.
- Generic mutating MCP `tools/call`.
- Provider-output auto-apply or default live provider access.
- Git commit, push, PR, dependency install, or CI workflow edits.
