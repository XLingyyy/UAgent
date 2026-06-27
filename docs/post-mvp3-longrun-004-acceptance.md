# POST-MVP3-LONGRUN-004 Acceptance

## Scope

LONGRUN-004 extends the POST-MVP3 fixture/runtime boundary with executable MCP matrix coverage, provider event projection, and explicit tool policy classification. It remains pre-MVP4: no real provider adapter, provider HTTP request, secret handling, UE write execution, or product shell/browser/filesystem capability is included.

## Desktop Runtime MCP Matrix

The desktop runtime fixture matrix covers:

| Scenario | Expected boundary |
|---|---|
| Streamable `resources/read` success | Sends one `resources/read`, emits MCP read/Agent report events, completes |
| Streamable read-only `tools/call` success | Sends `tools/call` only after discovery and local read-only classification |
| Streamable `resources/read` JSON-RPC error | Emits failure path, does not produce false task success |
| Streamable malformed response | Emits failure path, does not produce false task success |
| Streamable timeout | Emits failure path, does not produce false task success |
| Legacy HTTP+SSE `resources/read` success | Reads through legacy fixture transport and completes |
| Blocked mutating tool | Emits policy block and never sends `tools/call` |
| Unknown tool | Fails unresolved intent and never sends `tools/call` |
| Connected but undiscovered | Uses deterministic mock fallback without `resources/read` |
| Disconnect after discovery | Resets to mock fallback without fixture read/call |
| Non-local endpoint | Denies before any fixture request is sent |
| Request log correctness | Records initialize, initialized notification, tools/resources/prompts list, and execution request order |

## Tool Policy Classification

`buildToolPolicyPack` separates discovered MCP tools into:

- `Read-only MCP tools`
- `Blocked MCP tools`
- `Unknown MCP tools`

Blocked and unknown tools are not mixed into the read-only policy line. The prompt constraints continue to state that blocked, unknown, mutating, shell, browser, filesystem, and UE write actions must not execute.

## Provider Event Bridge

Desktop runtime view models consume existing `TaskEvent` provider events only. React components do not call provider runners or provider adapters.

Agent Trace rows project provider request started, stream started, stream delta, stream completed, usage recorded, completed, failed, and cancelled events with stable labels, details, and tones. Runtime diagnostics include provider failed/cancelled events. Provider stream delta and usage recorded remain consumable as runtime evidence; success, usage, and delta events are not misclassified as diagnostics.

## Scenario Matrix Runner

`createLongrunMcpScenarioCorpus` is paired with an executable matrix runner that evaluates each named fixture scenario in process and returns:

- request log observations, including expected absent requests such as zero `tools/call` for blocked/unknown tools and zero requests for non-local denial
- runtime event observations such as `mcp_read_completed`, `mcp_tool_blocked`, `mcp_connection_failed`, `agent_step_failed`, and task terminal events
- terminal outcome as `completed`, `failed`, `fallback_completed`, or `cancelled`

The runner is deterministic and does not start real services.

## Side-effect Boundary

LONGRUN-004 does not add real provider network calls, API key access, `process.env` reads, Authorization handling, secret/credential handling, mutating MCP execution, UE writes, cloud resources, shell/browser/filesystem product capability, spawn/exec command capability, Redux/Zustand/router/design-system changes, or new dependencies.
