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

Status: complete

Out of scope for MVP5: default live provider network access, raw API keys in UI state/events/traces/audit/session, real UE write operations, real mutating MCP tools/call, product shell/browser/filesystem behavior, production-grade OS sandbox, new state management, new routing, or a new design system.

## MVP6 - UI Productization & Project Workspace Shell

- Welcome-first Project Workspace Shell with compact Composer as the default first view
- TitleBar productization with local mode, MCP read-only, provider fixture, and no-network status
- LeftSidebar three-mode shell: Project, Conversation, and static Asset Browser
- Static UE-style asset browser fixture based on in-memory mock project data only
- Staged attach menu for File, Asset, Screenshot, and Context Pack, all disabled with tooltips
- Utility Drawer with Review, Diagnostics, Runtime, Agent Trace, Safety, Audit, and Changes panels retained
- Terminal, Browser, Files, UE, Logs, and Asset Search exposed only as disabled future tools
- Six-page Settings Center: General, Profile, Appearance, Config, Personalization, Provider
- Provider-to-Composer model and reasoning sync with secretRef-only provider configuration
- MVP6 scenario matrix with 30 named scenarios and behavior assertions
- Side-effect scan remains 0-blocked for live network, filesystem, shell/browser, UE write, mutating MCP, and raw-secret boundaries

Status: complete

Out of scope for MVP6: real UE project scanning, real filesystem reads/writes, terminal/browser/filesystem product controls, screenshots, real Asset Registry, default live provider network, raw API key storage, mutating MCP tools, a real light theme, new state management, new routing, or a new design system.

## MVP7 - Real Project Index & Capability Bridge

- Shared contracts for `ProjectProfile`, `ProjectIndexSnapshot`, `AssetIndexEntry`, `SafeFilePreviewResult`, `CapabilityRequest`, `CapabilityDecision`, and capability runtime events.
- Deterministic fixture Project Registry, Project Indexer, Asset Index classifier, Safe File Preview, and Capability Bridge in runtime.
- Path policy helpers for normalization, root containment, ignored dirs, preview allowlist, binary/large-file blocking, and UI path redaction.
- Config Settings Project roots / Project index section with validate, trust, scan, cancel, retry-ready controls.
- Asset Browser can switch from MVP6 fixture fallback to index-backed assets, search/filter current snapshot without rescanning, show asset details, and request safe previews through store actions.
- Utility Drawer Runtime dashboard summarizes Files, Terminal, Browser, and Screenshot capability policy without executing shell/browser/capture/write behavior.
- MVP7 scenario matrix covers 50 named scenarios and 80+ behavior assertions while preserving MVP5/MVP6 regressions.
- Side-effect scan includes project-index and capability-bridge categories with 0 blocked findings expected.

Status: current

Out of scope for MVP7: real file writes, deletes, renames, mkdir, workspace mutation, true terminal execution, browser automation, screen capture, default live provider network, raw secrets or raw home paths in UI/runtime/audit/session, UE write pipelines, and mutating MCP calls.

## Non-Goals

- Cloud deployment or SaaS platform
- Real-time collaboration
- Plugin marketplace
- Mobile or web-only client
- Direct fork or embedding of Codex/Claude Code/Cursor/Aider
- Real UE write execution, mutating MCP tools, approval write execution, or LLM/provider API calls during MVP3
- Default live provider network access or raw API keys in UI state/events/traces during MVP4
- Real project scans, terminal/browser/filesystem controls, screenshots, or UE writes during MVP6
