# UAgent MVP Roadmap

## MVP0 - Project Foundation

- TypeScript monorepo baseline with pnpm workspaces
- Shared type definitions for messages, plans, tools, and evidence
- Runtime state machine placeholder
- MCP client type stubs
- Basic quality tooling: ESLint, Prettier, TypeScript, Vitest

Status: complete

## MVP0.5 - UI Shell Foundation

- Tauri 2 + React + Vite desktop shell
- AppShell skeleton: TitleBar, LeftSidebar, Workspace, InspectorPane, GlobalOverlays
- Dark theme token system and animation token system
- Three-column layout with inspector open/close state
- ComposerDock and ConversationViewport placeholders
- UI smoke tests with Testing Library

Status: complete

## MVP1 - Mock Product Shell + Runtime Contract

- Shared contract for `TaskDraft`, `TaskRecord`, `TaskEvent`, `RuntimeSnapshot`, `RuntimeClient`, `EvidenceRecord`, and `ApprovalRequest`
- Deterministic `MockRuntime` in `packages/runtime`
- Composer submit flow: input -> `TaskDraft` -> `RuntimeClient.submitTask()`
- Runtime event stream: `task_submitted`, `plan_created`, `tool_started`, `tool_completed`, `evidence_created`, `review_created`, `task_completed`
- Failure injection with `#fail` and cancellation events for UI regression coverage
- Desktop runtime store adapter inside the existing UIProvider slice-store architecture
- ConversationViewport, UtilityDrawer, and LeftSidebar rendering from the active task events
- Provider/model guardrails: model-not-configured does not block mock flow, and no provider call is made

Status: complete

## MVP2 - MCP Read-only Runtime

- MCP client implementation with Streamable HTTP default and legacy HTTP + SSE compatibility
- Unreal MCP initialize and discovery
- Read-only tool/resource listing
- Read-only task events emitted through the MVP1 Runtime Contract
- `MockRuntime` remains as fallback/demo/test runtime

Status: complete

## MVP3 - Agent Core / Runtime Planning Loop

- Shared Agent contracts for `AgentPlan`, `AgentPlanStep`, `AgentObservation`, and `AgentReport`
- Deterministic planner that converts a `TaskDraft` into an auditable plan without calling an LLM or provider API
- Guarded read-only action selection for MCP `resources/read` and policy-approved read-only `tools/call`
- AgentLoop orchestration for plan -> guarded action -> observe -> evidence -> report
- Mock observation fallback when MCP is disconnected or connected but not discovered
- TaskEvent and RuntimeSnapshot display for plan, steps, observations, evidence, report, failures, blocked actions, and cancellation

Status: complete

## MVP4 - Provider Adapter Implementation / Real Provider Boundary

- Secret-safe Provider config model using secretRef and redacted state (no raw secrets in UI/state/event/trace)
- Disabled / fixture / live opt-in network mode boundary (default and CI do not access real external providers)
- OpenAI-compatible and Anthropic-compatible fixture-first adapter implementations with protocol matrix
- ProviderRuntimeEvent to TaskEvent / AgentTrace / Conversation / Diagnostics / Evidence stable mapping
- AgentLoop provider-assisted mode (default off, provider output never bypasses read-only tool policy)
- ProviderSettings, Composer, Conversation, AgentTrace, RuntimePanel, DiagnosticsPanel secret-safe observability
- MVP4 scenario matrix, manual smoke suite, side-effect scan hardening, and docs/mvp4-acceptance.md

Status: complete

## MVP5 - Workflow & Safety

- Risk classification and safety policy (ToolRiskLevel: read_only, low_risk, medium_write, high_write, destructive)
- Approval workflow: policy/classifier, runtime approval gate with pause/resume, decision API, UI projection
- Sandbox execution mode: SandboxPolicy, FixtureSandboxAdapter, runtime bridge, evidence mapping, UI projection
- ChangeSet rollback/promote: shared contracts, reducer, fixture promote/rollback adapter, UI cards, audit mapping
- Audit log and session history: AuditEvent projection, SessionSummary, replay/filter, secret redaction regression
- UI integration: Composer readiness, conversation task cards, UtilityDrawer safety/audit/changes tabs, Settings safety controls, FeatureGate a11y
- MVP5 scenario matrix: 20 named scenarios with 20+ assertions, secret redaction, provider boundary regression, MCP mutating blocked regression
- Side-effect and secret scan: repeatable scan script, 0 blocked findings

Status: current

Out of scope for MVP5: default live provider network access, raw API keys in UI state/events/traces/audit/session, real UE write operations, real mutating MCP tools/call, product shell/browser/filesystem behavior, production-grade OS sandbox, new state management, new routing, or a new design system.

## Non-Goals

- Cloud deployment or SaaS platform
- Real-time collaboration
- Plugin marketplace
- Mobile or web-only client
- Direct fork or embedding of Codex/Claude Code/Cursor/Aider
- Real UE write execution, mutating MCP tools, approval write execution, or LLM/provider API calls during MVP3
- Default live provider network access or raw API keys in UI state/events/traces during MVP4
