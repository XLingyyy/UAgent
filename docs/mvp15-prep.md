# MVP15 Prep - Real UE Sandbox Asset Mutation Pilot (Historical)

> MVP15D current note: Rework 8 is `NEEDS_FIX` because the current acceptance
> manifest file SHA conflicted with retained evidence and the other current
> repository documents while code and retained evidence validation passed.
> Rework 9 and the D0-D12 source checkpoint are `COMPLETE`. Ready for the next
> MVP stage remains `NO` because G13/G16 and 15A-15C remain separately gated.
> `BLOCKED_BY_EVIDENCE_RETENTION` is closed by
> retained D0/build/UE roots below `external/mvp15d-rework7-*`; D0 records
> 129 indexed artifacts and zero mutation, while UE records five sessions,
> `48/48`, residual zero, and unchanged empty Content. No final
> 15A package or real product mutation is authorized. D13, 15A, 15B, and 15C
> remain prohibited.
> Previous/current task IDs are
> `TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-8` and
> `TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-9`.
> Verified implementation/content checkpoint
> `b1c4e4a4b567d5018c0d0fa7fa1769a26e70f66e` is published with the Rework 9
> documentation closeout checkpoint.

> Historical preparation document. This file records the scope posture used before MVP15 implementation. MVP15C / 09Z later completed the former happy-path lifecycle, but the MVP15D source-checkpoint rework is now current. Current status, blockers, delivered scope, and remaining prohibitions are defined by the acceptance, verification, risk, plugin-baseline, and handoff documents.

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
