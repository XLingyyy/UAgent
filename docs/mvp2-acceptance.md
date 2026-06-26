# MVP2 Acceptance

## Product Scenarios

- No MCP server: Composer submit uses MockRuntime fallback and emits `mcp_fallback_to_mock`.
- Localhost MCP endpoint: Connect shows connected state, protocol version, server info, and capability counts.
- Discover shows tools/resources/prompts counts and read-only semantic summary.
- Read-only request such as `检查当前选择` emits MCP discovery/read/evidence/review/completion events.
- UtilityDrawer Runtime / UE / Evidence / Diagnostics all reflect the active runtime task.
- Fixture write-like tools such as delete/save/apply are classified as blocked and do not execute.
- Invalid endpoint shows an error and leaves MockRuntime fallback available.
- Disconnect returns MCP state to disconnected and later tasks still run through fallback.

## Required Commands

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm --filter @uagent/mcp-client test`
- `pnpm --filter @uagent/runtime test`
- `pnpm --filter @uagent/desktop test`
- `pnpm --filter @uagent/desktop web:build`
- `git diff --check`

## Side-effect Scan

Check for:

- Real LLM/provider API calls.
- UE write/save/compile/mutate/run/launch behavior.
- shell/browser/filesystem product behavior.
- React components directly invoking `tools/call`.
- Non-localhost endpoint silent connection.
- Component CSS hard-coded `#RRGGBB` colors outside token files.

## Pass Criteria

MVP2 can pass only if all required commands pass, side-effect scan is clean or justified, MockRuntime fallback remains available, MCP read-only fixture flow works, blocked tools produce visible warning events, and no real write/provider behavior is introduced.
