# MVP5 Workflow & Safety Plan

## Status

Draft (MVP5)

## Context

UAgent needs to establish institutionalized safety boundaries before any sensitive capability can be unlocked. MVP1-MVP4 establish the local-first desktop workspace, read-only MCP runtime, Agent planning loop, and provider boundary — but all of these operate without approval gates, sandbox execution, ChangeSet management, or audit trails.

MVP5 adds these safety layers while preserving all existing boundaries. The goal is not to enable real write execution, but to build the framework that will govern it later.

## Design Decisions

### 1. Fixture-First Safety

All MVP5 execution paths default to `disabled` or `fixture` mode. No sandbox adapter, approval decision, or ChangeSet operation touches real files, real UE, real network, or real mutating tools. This enables the entire workflow to be tested deterministically in CI.

### 2. Approval as a Runtime Gate

Approval is not a UI-only confirmation dialog. The AgentLoop runtime emits `approval_required` and pauses execution of medium/high-risk actions. The runtime resume is the only path to execution. Deny, cancel, or timeout from the UI must result in no tool/sandbox/ChangeSet side effect.

### 3. Audit as Append-Only Projection

TaskEvent remains the source of truth for task state. AuditEvent is an append-only projection derived from TaskEvent, approval, sandbox, and ChangeSet system events. It never drives task state — only the TaskEvent reducer does.

### 4. Secret Safety by Design

All audit/session/ChangeSet payloads pass through the same redaction utility used by MVP4 provider events. Secret-like content (API keys, tokens, full file paths) never appears in audit event bodies, session summaries, or replay output.

### 5. ChangeSet as Deterministic State Machine

ChangeSet state transitions (planned → previewed → applied → promoted/rolled_back/discarded) are driven by workflow events and are fully deterministic. Rollback references are fixture handles, not real file snapshots.

## Architecture

```text
TaskDraft
  → AgentLoopRuntime
    → RiskClassifier (read_only auto / medium+ require approval)
    → ApprovalGate (pause / resume / deny / cancel / timeout)
    → SandboxAdapter (FixtureSandbox for MVP5)
    → ChangeSetReducer (state machine)
    → TaskEvent stream
  → AuditProjection (append-only from system events)
  → SessionSummary (aggregate by sessionId)
  → UI projections (Composer, task cards, UtilityDrawer, Settings)
```

## Non-Goals

- Real OS sandbox (production-grade sandboxing is post-MVP5)
- Real file/UE write execution
- Provider live mode default
- New state management, router, or design system
- Voice/audio/recording capabilities
