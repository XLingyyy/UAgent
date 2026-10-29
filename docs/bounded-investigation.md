# Bounded project investigation

The desktop's **Investigate project** mode is an explicit read-only task, separate
from ordinary conversation. It requires a currently trusted native project and a
ready index. Read and outbound-sharing scopes are independent. Sharing defaults
to off; every model request still presents its complete actual body for a
single-use confirmation.

## Current capability

| Capability             | Implementation and boundary                                                                                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Structured model tools | DeepSeek account-session chat tool calls, including split SSE arguments and exact call IDs. No real API acceptance run for this change.                                                                                                       |
| Project tools          | List indexed files, find paths in the index, and bounded native text previews. No implicit scan, terminal, write or UE operation. Secret/generated paths are excluded.                                                                        |
| Coordinator            | One task owns model/tool scheduling. Default 3 tools / 4 model requests; approved maximum 30 tools / 31 model requests. Ten-minute scope, at most 2 attempts for identical failures, 8 KiB tool-result and 24 KiB message-context boundaries. |
| Pause / cancel         | Pause finishes the current operation and retains its result without executing it twice. Cancel blocks new work and discards late completion. A lost scope requires fresh authorization.                                                       |
| Conversation           | Incremental text stays in one assistant node; diagnostics are folded. Investigation results are excluded from automatic future conversation history.                                                                                          |
| Other protocols        | OpenAI Responses, additional provider backends, and usage-unknown handling are not implemented by this slice.                                                                                                                                 |
| UE / writes            | No build, Blueprint, scene mutation or repair tools are exposed by this registry.                                                                                                                                                             |

There is no fixed currency limit. Memory-only credentials, exact outbound review,
independent tool permission and existing sandbox boundaries remain in force.

## Integration contracts

- Shared types live in `packages/shared/src/run.ts`. `TaskRunScope` is a
  description; serializing it does not preserve authority.
- `RunScopeAuthority` creates an in-memory lease bound to project, conversation,
  selected provider/model and credential generation. Claims are single-use;
  expiry or ownership changes invalidate use.
- `ToolRegistry` dispatches only registered definitions after validating JSON,
  canonical project-relative paths and current scope. Read permission does not
  authorize uploading a result. Results retain sources, redaction and truncation.
- `RunCoordinator` persists intent before scheduling and results before the next
  model request when a `RunStorePort` is installed. A persistence failure pauses
  scheduling. The port receives a full message snapshot and ordered event deltas;
  native storage adapters must map messages to stable append-only IDs.
- Model/tool output is untrusted data. It cannot expand the approved paths,
  register tools, restore approvals or authorize a subsequent request.
- Recovery from durable records must require fresh credentials and a fresh
  lease. Saved scope descriptions are never executable authorization.

## Focused checks

Run the changed runtime protocol/registry/coordinator/scope tests and
`apps/desktop/web/src/runtime/investigation-flow.test.tsx`. These use synthetic
model/SSE responses; coordinator tests also read isolated temporary files.
Desktop tests exercise the native-adapter interface through a controlled fake
invoke and do not establish Windows filesystem or live-model acceptance.

Set child-process TEMP/TMP and Vite cache directories to the intended development
drive before running. The desktop Vite configuration honors `VITE_CACHE_DIR`.
