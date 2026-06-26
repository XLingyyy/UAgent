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

## Read-only Policy

- Unknown tools are blocked by default.
- Server annotations are advisory only.
- Tool names containing create/update/delete/remove/save/persist/apply/set/rename/import/export/compile/run/launch/spawn/edit/mutate/write are blocked.
- `resources/list` and `resources/read` are the primary path.
- `tools/call` must go through runtime read-only policy before execution.
- `prompts/list` and prompt metadata are display/discovery only; they are not injected into Composer and do not trigger LLM calls.
- Blocked tools emit `mcp_tool_blocked`.

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
