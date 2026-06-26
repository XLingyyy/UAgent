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

Status: current

Out of scope for MVP3: real LLM/provider calls, API key reads, UE writes, mutating MCP tools, approval write flow, shell/browser/filesystem product behavior, new state management, new routing, or a new design system.

## MVP4 - LLM Provider

- Provider adapter interface for future OpenAI, Anthropic, and local providers
- Streaming response handling
- Token accounting and cost estimation
- Model selection and fallback

## MVP5 - Workflow & Safety

- Approval workflow for tool execution
- Sandbox execution mode
- Rollback / promote for workspace state
- Audit log and session history

## Non-Goals

- Cloud deployment or SaaS platform
- Real-time collaboration
- Plugin marketplace
- Mobile or web-only client
- Direct fork or embedding of Codex/Claude Code/Cursor/Aider
- Real UE write execution, mutating MCP tools, approval write execution, or LLM/provider API calls during MVP3
