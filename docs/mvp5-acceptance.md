# MVP5 Acceptance

## Scope: Workflow & Safety

Approval, Sandbox, ChangeSet Rollback/Promote, Audit Log, Session History, UI Integration, Scenario Matrix, Security Scan.

## Required checks

- Shared approval/risk contracts (ToolRiskLevel, WorkflowCapability, SafetyPolicy)
- Approval contracts (ApprovalRequest, ApprovalDecision, ApprovalState)
- Sandbox contracts (SandboxPolicy, SandboxExecutionRequest, SandboxExecutionResult, SandboxEvent)
- ChangeSet contracts (WorkspaceChangeSet, ChangeSetState, ChangeOperation)
- Audit/session contracts (AuditEvent, AuditEventType, AuditActor, AuditProjection, SessionSummary, TaskHistoryEntry, ReplayCursor)

## Contract checks

- Approval policy/classifier (read_only auto-pass, medium_write/high_write require approval, destructive block)
- Runtime approval gate and pause/resume
- Approval decision API and reducer tests
- Approval UI projection (event types in event-view-models)
- Approval audit/session mapping (audit-projection.ts + session-history.ts)

## Contract checks

- SandboxPolicy (capability allow/block, cwdRef, envPolicy, networkPolicy, outputLimit, timeoutTicks)
- FixtureSandboxAdapter (deterministic success/failure/timeout/blocked)
- Sandbox runtime bridge and event mapping
- Sandbox evidence mapping (truncated output, redacted)
- Sandbox UI projection (event types in event-view-models)

## Contract checks

- ChangeSet contracts and reducer
- Fixture promote/rollback adapter
- ChangeSet UI card (event types in event-view-models)
- ChangeSet audit/session mapping (audit-projection.ts + session-history.ts)

## Contract checks

- Audit projection (task, provider, MCP, approval, sandbox, ChangeSet, session)
- Session summary and task history
- Replay and filters (by taskId, eventType, riskLevel, terminalState, providerMode)
- Secret redaction regression (secret-like input does not leak in audit/session)

## Contract checks

- Composer readiness (status row shows approval/fixture readiness)
- Conversation/task cards (workflow event labels and kinds in event-view-models)
- UtilityDrawer safety/audit/changes tabs (visible Safety, Audit, Changes tabs)
- Settings safety controls (Config page shows approval, sandbox, audit/session controls)
- ComingSoonGate/FeatureGate a11y (existing, event view models updated)

## Contract checks

- MVP5 scenario matrix with 20 named scenarios, 24 test assertions
- Test layering (shared types tested, runtime unit tests, scenario matrix, UI regression)

## Contract checks

- Side-effect and secret scan (repeatable, 0 blocked findings)

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
