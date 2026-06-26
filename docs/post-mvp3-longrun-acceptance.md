# POST-MVP3 Longrun Acceptance

POST-MVP3-LONGRUN-001 stabilizes the accepted MVP3 Agent Core without starting MVP4 real provider work.

## Completed Scope

- Agent Run Trace shared contract for trace events, step snapshots, run summaries, terminal status, observations, evidence references, report summary, and blocked actions.
- Runtime recorder/replay modules that derive `AgentRunTrace` from `TaskEvent` streams and produce deterministic replay summaries.
- Prompt Builder skeleton that assembles deterministic read-only prompt envelopes from `TaskDraft`, `AgentPlan`, MCP discovery summaries, policy summaries, and mock provider metadata.
- Provider runtime interface types plus runtime mock adapters: text, streaming, failing, and registry.
- Deterministic AgentLoop replay fixtures for mock fallback, MCP resource, read-only tool, blocked write, unknown intent, and failure injection.
- Runtime contract documentation for `TaskEvent`, `AgentRunTrace`, provider runtime, prompt builder, and future `SystemEvent` boundaries.
- UtilityDrawer Agent Trace tab that displays active task trace status, goal, steps, observations, evidence refs, report summary, blocked actions, and trace events from runtime store data only.

## Explicit Non-Scope

- No real OpenAI, Anthropic, or local model HTTP provider implementation.
- No API key, environment variable, Authorization header, secret storage, or credential file reads.
- No UE write path or mutating MCP tool execution.
- No product shell, browser, filesystem, spawn, or exec behavior.
- No Redux, Zustand, new router, or new design system.
- No AppShell, UIProvider, SettingsShell, ProviderSettings, theme token, or motion token rewrite.

## Required Verification

The final implementation report must record exit codes for:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm --filter @uagent/shared test`
- `pnpm --filter @uagent/runtime test`
- `pnpm --filter @uagent/mcp-client test`
- `pnpm --filter @uagent/desktop test`
- `pnpm --filter @uagent/desktop web:build`
- `git diff --check`

## Side-Effect Scan

The final implementation report must explain matches for:

- Provider/API key terms: `provider`, `OpenAI`, `Anthropic`, `apiKey`, `Authorization`, `process.env`, `secret`, `credential`
- MCP method terms: `tools/call`, `resources/read`
- Write/execute terms: `save`, `compile`, `apply`, `write`, `delete`, `run`, `launch`, `mutate`
- Shell/browser/filesystem terms: `shell`, `command`, `spawn`, `exec`, `filesystem`, `browser`
- Network term: `fetch`
- CSS hex colors: `#RRGGBB`

Allowed matches are contracts, docs, tests, mock-only adapters, existing MCP read-only paths, and CSS token files. Any real provider call, credential read, UE write, mutating MCP call, or product shell/browser/filesystem path is a blocker.

## MVP4 Readiness

After this acceptance passes, the recommended next stage is MVP4 Provider Adapter implementation. MVP4 should start with explicit secret handling design, real adapter boundaries, streaming UI semantics, cancellation/error mapping, and provider-specific tests. It must not reuse POST-MVP3 mock providers as real network adapters.
