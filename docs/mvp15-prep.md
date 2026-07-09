# MVP15 Prep - Real UE Sandbox Asset Mutation Pilot

## Objective

MVP15 validates the first controlled UE asset mutation path under a sandbox-only boundary. The pilot may prepare, execute, verify, and roll back asset changes only under `/Game/UAgentSandbox/**` and mapped `/Content/UAgentSandbox/**`.

## Scope

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

## Out of Scope

- Non-sandbox asset writes.
- Save All or project-wide package saves.
- Delete, move, rename, bulk asset operations, or Blueprint compile execution.
- Generic mutating MCP `tools/call`.
- Provider-output auto-apply or default live provider access.
- Git commit, push, PR, dependency install, or CI workflow edits.
