# MVP3 Acceptance

MVP3 is accepted when UAgent routes Composer input through a deterministic Agent Core loop and surfaces the full plan, observation, evidence, report, and terminal state through the existing runtime event chain.

## Product Scenarios

- No MCP fallback: submitting `Review Lyra asset loading risks` without MCP produces an Agent plan, mock observation, evidence, report, and `task_completed`.
- Connected but not discovered: submitting after connect but before discovery keeps discovery-required UI wording and uses mock fallback; it must not imply MCP read-only readiness.
- MCP read-only resource: after connect and discovery, `检查当前选择` or `current selection` produces a read-context step, sends `resources/read`, and emits observation, evidence, report, and completion.
- Read-only tool fallback: when no matching resource exists but a read-only tool such as `ue.selection.get` is discovered, local policy must classify it as `read_only` before `tools/call`.
- Blocked write intent: `delete current selection` or `save asset` does not send `tools/call`; it emits blocked policy evidence and a blocked report without UE write behavior.
- Unknown intent or unknown tool: unresolved work does not call `tools/call`; it follows the documented failed or no-op terminal flow.
- Cancel: cancelling an active Agent task stops later steps and ends in `task_cancelled`.
- Failure injection: input containing `#fail` or a throwing mock observer emits `agent_step_failed` and `task_failed` with diagnostics.

## Required Commands

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

## Side-effect Scan

The final report must include scans for:

- `provider`, `OpenAI`, `Anthropic`, `apiKey`, `Authorization`
- `tools/call`
- `resources/read`
- `save`, `compile`, `apply`, `write`, `delete`, `run`, `launch`, `mutate`
- `shell`, `command`, `spawn`, `exec`, `filesystem`, `browser`
- `fetch`
- `#RRGGBB`

Allowed findings must be explained. Provider matches may only be settings metadata, docs, or tests. MCP method matches may only be the MCP client/session, desktop adapter binding, runtime read-only policy path, docs, or tests. CSS hex colors may only live in token files or intentional tests/docs.

## Pass Criteria

- AgentLoop is the Composer submit path.
- Normal tasks display plan, steps, observations, evidence, report, and completion state.
- MCP read-only tasks use only `resources/read` or locally policy-gated read-only `tools/call`.
- Blocked, unknown, and mutating actions do not reach `tools/call`.
- React components consume runtime store events/snapshots and do not call MCP sessions directly.
- No real LLM/provider request, API key read, UE write, shell/browser/filesystem product path, approval write flow, new state framework, new router, or new design system is introduced.
- Required commands pass or failures are fully recorded with root cause and rework recommendation.
