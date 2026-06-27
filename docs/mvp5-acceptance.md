# MVP5 Acceptance

## Stage: Workflow & Safety

Approval, Sandbox, ChangeSet Rollback/Promote, Audit Log, Session History, UI Integration, Scenario Matrix, Security Scan.

## Gate Status

| Gate | Status |
|------|--------|
| G0 - Stage sync, docs & baseline freeze | [X] COMPLETE |
| G1 - Shared Workflow & Safety Contracts | [X] COMPLETE |
| G2 - Approval Workflow | [X] COMPLETE |
| G3 - Sandbox Execution Mode | [X] COMPLETE |
| G4 - ChangeSet, Rollback & Promote | [X] COMPLETE |
| G5 - Audit Log & Session History | [X] COMPLETE |
| G6 - UI / Settings / UtilityDrawer Integration | [X] COMPLETE (contracts + event projections) |
| G7 - Scenario Matrix, Tests & Verification | [X] COMPLETE |
| G8 - Security Regression & Final Acceptance | [X] COMPLETE |

## G0 Checklist

- [X] MVP5-00: README shows MVP5 current, roadmap marks MVP4 complete
- [X] MVP5-01: docs/mvp5-acceptance.md exists with full acceptance checklist
- [X] MVP5-02: Workflow Safety ADR/plan exists
- [X] MVP5-03: Baseline freeze documented

## G1 Checklist

- [X] MVP5-10: Shared approval/risk contracts (ToolRiskLevel, WorkflowCapability, SafetyPolicy)
- [X] MVP5-11: Approval contracts (ApprovalRequest, ApprovalDecision, ApprovalState)
- [X] MVP5-12: Sandbox contracts (SandboxPolicy, SandboxExecutionRequest, SandboxExecutionResult, SandboxEvent)
- [X] MVP5-13: ChangeSet contracts (WorkspaceChangeSet, ChangeSetState, ChangeOperation)
- [X] MVP5-14: Audit/session contracts (AuditEvent, AuditEventType, AuditActor, AuditProjection, SessionSummary, TaskHistoryEntry, ReplayCursor)

## G2 Checklist

- [X] MVP5-20: Approval policy/classifier (read_only auto-pass, medium_write/high_write require approval, destructive block)
- [X] MVP5-21: Runtime approval gate and pause/resume
- [X] MVP5-22: Approval decision API and reducer tests
- [X] MVP5-23: Approval UI projection (event types in event-view-models)
- [X] MVP5-24: Approval audit/session mapping (audit-projection.ts + session-history.ts)

## G3 Checklist

- [X] MVP5-30: SandboxPolicy (capability allow/block, cwdRef, envPolicy, networkPolicy, outputLimit, timeoutTicks)
- [X] MVP5-31: FixtureSandboxAdapter (deterministic success/failure/timeout/blocked)
- [X] MVP5-32: Sandbox runtime bridge and event mapping
- [X] MVP5-33: Sandbox evidence mapping (truncated output, redacted)
- [X] MVP5-34: Sandbox UI projection (event types in event-view-models)

## G4 Checklist

- [X] MVP5-40: ChangeSet contracts and reducer
- [X] MVP5-41: Fixture promote/rollback adapter
- [X] MVP5-42: ChangeSet UI card (event types in event-view-models)
- [X] MVP5-43: ChangeSet audit/session mapping (audit-projection.ts + session-history.ts)

## G5 Checklist

- [X] MVP5-50: Audit projection (task, provider, MCP, approval, sandbox, ChangeSet, session)
- [X] MVP5-51: Session summary and task history
- [X] MVP5-52: Replay and filters (by taskId, eventType, riskLevel, terminalState, providerMode)
- [X] MVP5-53: Secret redaction regression (secret-like input does not leak in audit/session)

## G6 Checklist

- [X] MVP5-60: Composer readiness (status row shows approval/fixture readiness)
- [X] MVP5-61: Conversation/task cards (workflow event labels and kinds in event-view-models)
- [X] MVP5-62: UtilityDrawer safety/audit/changes tabs (visible Safety, Audit, Changes tabs)
- [X] MVP5-63: Settings safety controls (Config page shows approval, sandbox, audit/session controls)
- [X] MVP5-64: ComingSoonGate/FeatureGate a11y (existing, event view models updated)

## G7 Checklist

- [X] MVP5-70: MVP5 scenario matrix with 20 named scenarios, 24 test assertions
- [X] MVP5-71: Test layering (shared types tested, runtime unit tests, scenario matrix, UI regression)

## G8 Checklist

- [X] MVP5-80: Side-effect and secret scan (repeatable, 0 blocked findings)
- [X] MVP5-81: Final acceptance report written

## Verification Commands

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @uagent/shared test
pnpm --filter @uagent/runtime test
pnpm --filter @uagent/mcp-client test
pnpm --filter @uagent/desktop test
pnpm --filter @uagent/desktop web:build
git diff --check
```

## Red Lines (Veto Conditions)

- Default or CI path issues real provider network request
- Raw API key/Authorization/secret-like text enters UI state, TaskEvent, trace, diagnostics, audit, session, artifact or test snapshot
- Real UE write, mutating MCP tools/call, shell/browser/filesystem product behavior default-enabled
- React components directly call provider/MCP/shell/fs/browser
- New state management, router, or design system introduced
- Wall-clock timer/sleep used for critical test paths
- Approved scope diverges from user-approved scope
- Deny/cancel/timeout still executes sensitive action
- Rollback/promote lacks audit or replay
- Missing test output claimed as complete
