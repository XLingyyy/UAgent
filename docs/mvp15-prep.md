# MVP15 Prep - Real UE Sandbox Asset Mutation Pilot

> Historical preparation document. This file records the scope posture used before MVP15 implementation. MVP15 subsequently completed final acceptance in MVP15C / 09Z; current delivered scope and remaining prohibitions are defined by the acceptance, verification, risk, and handoff documents.

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
- Delete, move, rename, bulk asset operations, or Blueprint compile execution were excluded from the initial preparation posture. Final MVP15 later delivered only the exact approval-bound move/rename steps and inverse cleanup required inside a registered `/Game/UAgentSandbox/<run-id>` lifecycle; broad/bulk operations, arbitrary deletes, and Blueprint compile remain prohibited.
- Generic mutating MCP `tools/call`.
- Provider-output auto-apply or default live provider access.
- Git commit, push, PR, dependency install, or CI workflow edits.
