# MVP2 MCP Read-only Plan

## Scope

MVP2 connects the MVP1 TaskEvent product chain to MCP read-only capability:

Composer input -> TaskDraft -> RuntimeClient.submitTask() -> RuntimeRouter -> MockRuntime fallback or McpReadOnlyRuntime -> TaskEvent stream -> RuntimeSnapshot -> ConversationViewport / LeftSidebar / UtilityDrawer.

## Protocol

- MCP version target: Model Context Protocol 2025-06-18.
- JSON-RPC 2.0 is the protocol envelope.
- Streamable HTTP is the default transport: POST to one endpoint with `Accept: application/json, text/event-stream`.
- Legacy HTTP+SSE exists only as compatibility fallback.
- `Mcp-Session-Id` returned by initialize is retained for later HTTP requests.
- Later requests include `MCP-Protocol-Version`.
- HTTP status, timeout, and malformed JSON are mapped to structured MCP errors.

## Session-level Methods

`McpSession` provides two public JSON-RPC methods for read-only execution:

- `readResource(uri: string): Promise<unknown>` — sends `resources/read` via connected transport; fails before initialize.
- `callTool(name: string, args: Record<string, unknown>): Promise<unknown>` — sends `tools/call` via connected transport; fails before initialize.

Both surface JSON-RPC error responses as `McpProtocolError`. Runtime components never call these directly; they go through `McpReadOnlyRuntime` which wraps policy classification before execution.

## Read-only Policy

- Unknown tools are blocked by default.
- Server annotations are advisory only.
- Tool names containing create/update/delete/remove/save/persist/apply/set/rename/import/export/compile/run/launch/spawn/edit/mutate/write are blocked.
- `resources/read` is the primary read-only path, sent through the real MCP session after discovery.
- `tools/call` must go through runtime read-only policy (`classifyMcpToolRisk`) before execution. Mutating, blocked, unknown, or unresolved tools must never send `tools/call` to the MCP transport.
- `prompts/list` and prompt metadata are display/discovery only; they are not injected into Composer and do not trigger LLM calls.
- Blocked tools emit `mcp_tool_blocked`.

## Lifecycle

A connected-but-not-discovered MCP session must not imply MCP read-only execution is available. The runtime router stays on MockRuntime fallback until `discoverMcp()` installs an `McpReadOnlyRuntime`. UI copy reflects this with "Connected · discovery required" wording until discovery completes.

## Lifecycle Events

See `docs/runtime-contract.md` for the full event sequence table, levels, and terminal states.

## Desktop UX

- Config settings expose a localhost MCP endpoint, connect, discover, and disconnect.
- Runtime and UE drawer panels show connection state, protocol version, server info, discovery counts, and read-only capability summary.
- ConversationViewport maps MCP TaskEvents into the same thread display as MVP1.
- Invalid or non-local endpoints show visible error state and keep MockRuntime fallback usable.

## Non-goals

- No real LLM/provider API calls.
- No UE write tools or approval-driven write flow.
- No shell/browser/filesystem product behavior.
- No global state manager replacement.
