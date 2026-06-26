# MVP3 Agent Core Plan

MVP3 builds the deterministic Agent Core / Runtime Planning Loop on top of the accepted MVP2 read-only MCP runtime. The goal is to prove UAgent can plan, act through guarded read-only capabilities, observe, record evidence, and report without crossing into provider, UE write, approval, shell, browser, or filesystem product behavior.

## Loop

```text
Composer input
  -> TaskDraft
  -> deterministic planner
  -> AgentPlan
  -> guarded action selection
  -> read-only MCP action or mock/policy observation
  -> AgentObservation
  -> EvidenceRecord
  -> AgentReport
  -> TaskEvent / RuntimeSnapshot
  -> UI display
```

## Components

- Shared contract: `@uagent/shared` defines `AgentPlan`, `AgentPlanStep`, `AgentObservation`, `AgentReport`, and Agent runtime state types.
- Deterministic planner: `@uagent/runtime` converts `TaskDraft` into stable plan steps. It does not call MCP or providers.
- Action selector: maps plan steps to `read_resource`, `call_readonly_tool`, `mock_observation`, `blocked`, or `noop_report` decisions. Resources are preferred over tools. Tools must pass local read-only policy.
- AgentLoop runtime: implements `RuntimeClient`, emits TaskEvents, handles cancellation, blocked actions, failures, and final reports.
- Observation and evidence collector: normalizes MCP read results, mock outputs, and policy blocks into summaries and evidence payloads.
- Report generator: creates deterministic summaries, findings, evidence references, blocked actions, and next steps.
- Trace recorder/replay: derives `AgentRunTrace` from the task event stream for audit, deterministic tests, replay fixtures, and UI display. It does not replace `TaskEvent` or `RuntimeSnapshot`.
- Prompt builder: assembles deterministic POST-MVP3 prompt envelopes for future provider work. It is text assembly only and does not call any provider.
- Provider-ready mock bridge: defines provider runtime request/response/stream/error/capability contracts plus deterministic mock providers. It prepares MVP4 adapter boundaries without implementing real provider integration.
- Desktop adapter: routes Composer submissions through AgentLoop while preserving MCP connect/discover/disconnect, localhost guard, legacy SSE fallback, thread selection, and MockRuntime fallback behavior.
- UI: consumes only `TaskEvent` and `RuntimeSnapshot` from the runtime store to display plan, current step, observations, evidence, reports, and diagnostics.

## Runtime Modes

- No MCP: AgentLoop uses mock observation and emits fallback events.
- Connected but not discovered: UI must keep discovery-required wording; AgentLoop uses mock fallback and must not imply MCP read-only readiness.
- Discovered MCP resource: read context steps may call `resources/read`.
- Discovered read-only tool: only policy-approved read-only tools may reach `tools/call`.
- Mutating or unknown tool: runtime emits blocked/failure semantics and must not call `tools/call`.

## POST-MVP3 Stabilization Scope

POST-MVP3 stabilizes the Agent Core so future provider work has traceable contracts:

- `TaskEvent` remains the runtime state source of truth.
- `AgentRunTrace` is a replay/audit projection derived from events.
- Prompt envelopes are deterministic inputs for mock provider tests.
- Provider adapters are mock-only and cannot read credentials or call provider HTTP APIs.
- MCP reads remain limited to `resources/read` and locally classified read-only `tools/call`.

MVP4 should begin only after this layer passes typecheck, lint, tests, build, replay fixtures, and side-effect scans.

## Boundaries

MVP3 must not:

- Call real LLM/provider APIs or read API keys.
- Add OpenAI, Anthropic, or local model SDK/HTTP implementations.
- Perform UE writes or mutating MCP tool calls.
- Implement approval write flow.
- Add shell, browser, or filesystem product behavior.
- Add a new state-management framework, routing system, or design system.
- Let React components call MCP sessions, `resources/read`, or `tools/call` directly.
- Claim MVP4/MVP5 provider, sandbox, approval, rollback, or write capabilities are complete.
