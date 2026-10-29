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

## Context selection and freshness

Complete run records and the next request are different data sets. Each request
pins the exact goal and safety constraints, selects complete history pairs, and
keeps assistant tool calls with all matching results. Older project facts and
results compete for the remaining UTF-8 byte budget. History has a separate
quarter-budget ceiling (at most 4 KiB); older index facts have a third-budget
ceiling. The latest tool group must fit, otherwise the task pauses.

Selection is deterministic. An oversized selected result may become a clearly
marked excerpt with original message indexes and UTF-16 ranges; source references,
status and truncation remain explicit. No extra model call performs compression.
The original messages remain unchanged in RunStoreCommit.messages.
RunStoreCommit.contextPlan and model_started.contextPlan describe selection;
the native investigation storage adapter preserves this plan separately from the full archive.

Sources bind project ID, kind, relative path and version to descriptive read/share
bounds. Native metadata freshness stamps are checked before preparing a request
and again after approval, before fetch. A rescan invalidates older index revisions.
A changed, missing, revoked or unverifiable source pauses sending. Saved strings
or descriptions cannot recreate a RunScopeLease or authorize recovery.

Windows file previews reject every reparse component, including links to another
directory inside the same project. The same validated, pinned handle performs
bounded byte reads; complete UTF-8 and result-envelope space are preserved.
Unscanned line totals are unknown, with observed lines reported separately.
Metadata stamps detect normal changes but do not prove content integrity against
restored timestamps or eliminate changes after the final check. Non-Windows
content reads fail closed pending an equivalent safe handle implementation.

## Durable investigation records

The desktop installs the native RunStorePort for investigation tasks. Every state
transition persists intent before scheduling and observed results before feedback.
A result retained across a rejected transaction is consumed without re-reading;
an uncertain native acknowledgement instead requires reconciliation. Full records,
selection plans and source freshness are stored together. There is no automatic
credential, approval or scheduling restoration, and SQLite history/recovery UI
remains a separate product step.

## Focused checks

Run the changed runtime protocol/registry/coordinator/scope tests and
`apps/desktop/web/src/runtime/investigation-flow.test.tsx`. These use synthetic
model/SSE responses; coordinator tests also read isolated temporary files.
Desktop tests exercise the native-adapter interface through a controlled fake
invoke and do not establish Windows filesystem or live-model acceptance.

Set child-process TEMP/TMP and Vite cache directories to the intended development
drive before running. The desktop Vite configuration honors `VITE_CACHE_DIR`.
