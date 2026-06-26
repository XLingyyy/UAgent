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
- Desktop adapter: routes Composer submissions through AgentLoop while preserving MCP connect/discover/disconnect, localhost guard, legacy SSE fallback, thread selection, and MockRuntime fallback behavior.
- UI: consumes only `TaskEvent` and `RuntimeSnapshot` from the runtime store to display plan, current step, observations, evidence, reports, and diagnostics.

## Runtime Modes

- No MCP: AgentLoop uses mock observation and emits fallback events.
- Connected but not discovered: UI must keep discovery-required wording; AgentLoop uses mock fallback and must not imply MCP read-only readiness.
- Discovered MCP resource: read context steps may call `resources/read`.
- Discovered read-only tool: only policy-approved read-only tools may reach `tools/call`.
- Mutating or unknown tool: runtime emits blocked/failure semantics and must not call `tools/call`.

## Boundaries

MVP3 must not:

- Call real LLM/provider APIs or read API keys.
- Perform UE writes or mutating MCP tool calls.
- Implement approval write flow.
- Add shell, browser, or filesystem product behavior.
- Add a new state-management framework, routing system, or design system.
- Let React components call MCP sessions, `resources/read`, or `tools/call` directly.
- Claim MVP4/MVP5 provider, sandbox, approval, rollback, or write capabilities are complete.
