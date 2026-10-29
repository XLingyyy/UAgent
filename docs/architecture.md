# UAgent Architecture

## Overview

UAgent is an AI Agent Host and Client for Unreal Engine workflows, aligned with the UE5.8 official Unreal MCP Server. It provides a local-first desktop workspace for planning, executing, and reviewing AI-assisted development tasks.

## High-Level Architecture

```text
┌──────────────────────────────────────────────┐
│            Desktop Shell (Tauri 2)            │
│  ┌──────────────────────────────────────────┐ │
│  │           Web Frontend (React)           │ │
│  │  ┌──────────┐ ┌────────┐ ┌────────────┐  │ │
│  │  │ Sidebar  │ │Workspac│ │ Inspector  │  │ │
│  │  └──────────┘ └────────┘ └────────────┘  │ │
│  └──────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────┐ │
│  │         Native Core (Rust)               │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │  Shared  │ │ Runtime  │ │ MCP      │
    │  Types   │ │ Engine   │ │ Client   │
    └──────────┘ └──────────┘ └──────────┘
```

## Desktop Shell

### `apps/desktop/src-tauri`

Tauri 2 native shell. The Rust entry point creates the application window and hosts the web frontend. The native core provides policy-gated filesystem access, controlled process execution and observation, trusted-root binding, UE Editor attach/status support, and the approval-bound sandbox asset-mutation guard. Runtime-to-native commands and the localhost MCP client/transport are implemented; unsafe or unavailable capabilities remain disabled or fail closed. The window uses a custom title bar (`decorations: false`) so the React `TitleBar` component can render the drag region and custom controls.

Asset-mutation authority resides in native registries rather than renderer declarations. The trusted-root registry stores an authoritative id plus normalized/canonical binding and filesystem-object metadata; registration resolves that record and fails closed on absence, revocation, detectable replacement, or uncertain containment. A crate-private UE observation validator resolves the live session, process, project, root, redacted PID, process start time, and executable binding and performs a real lifecycle check before registration and each forward/rollback MCP call. Lease renewal is one atomic compare-and-commit over complete current session/process snapshots; stopped is sticky and a stale lifecycle result changes neither lease. The desktop runtime binds registration and complete two-stage discovery publication to one MCP session object, endpoint, and generation. A post-guard local rejection records an explicit no-side-effect outcome, while a native-issued registration that never started can only be retired by its matching one-time token. `UAGENT_ENABLE_ASSET_MUTATION=1` is a separate default-off native gate; UI sandbox state may only tighten it.

The desktop publication boundary includes a read-only exact-six fingerprint at the same desktop publication boundary. Raw direct tools and reviewed facade candidates remain separate until a pure canonicalizer validates exact names/order, descriptor schema version, five required contracts, and facade ids when used. Recursive object-key sorting and array preservation produce a SHA-256 only for a complete JSON-safe contract. Publication authority is retracted before notification: creating a new connection generation synchronously clears discovery, facade inventory, MCP binding, SHA, and canonical byte length before endpoint validation, `connecting`/`error`, or any listener callback; stale concurrent connection/discovery completions cannot restore them. The desktop publishes only schema version, hash/byte length, per-tool name/source/hash summaries, allowlisted duplicate names, stable issue flags/counts, and a redacted current-session/discovery-generation binding. Raw unexpected/duplicate names, endpoint, raw session id, path, PID, token, credential, and full schema never enter the publication. Primitive, non-string, throwing/proxy-like, cyclic, and non-JSON inputs fail closed without an accepted hash or uncontrolled error. This adds no mutation entry point and does not change MCP transport or native contracts.

The first execute retains a maximum 60-second one-time token. Its first accepted guard creates absolute 15-minute forward and 20-minute rollback-recovery deadlines that are never extended by heartbeat or retry. Active evidence revalidates root authority and registration-bound paths. The short terminal evidence lease is path-bounded and read-only; it cannot recreate registration, token, operation, or mutation capability. Terminal evidence cannot renew execution authority or extend either deadline.

### `apps/desktop/web`

React 18 + Vite 5 frontend. The UI shell is structured as:

- **AppShell** — composes TitleBar + MainLayout + GlobalOverlays.
- **TitleBar** — custom window title bar with drag region and inspector toggle.
- **MainLayout** — three-column flex layout: LeftSidebar | Workspace | InspectorPane.
- **LeftSidebar** — navigation, project list, static fallback threads, and runtime task threads.
- **Workspace** — central region with ConversationViewport and ComposerDock task submission.
- **InspectorPane** — right-side UtilityDrawer with Review, Diagnostics, Evidence, and Runtime task context.
- **GlobalOverlays** — z-indexed overlay layer for future modals, command palette, and toasts.

Layout behavior:

- Left sidebar has a fixed width.
- Central workspace is flexible.
- Inspector participates in the flex flow on wide screens and becomes an overlay on narrow screens (≤ 899px) so the Composer dock area is never squeezed.
- Inspector open/close transitions use the centralized animation tokens.

### Styling

All visual values are defined as CSS custom properties in `web/src/styles/`:

- `tokens.css` — raw design tokens (colors, radius, spacing, typography, layout dimensions, z-index).
- `theme.css` — semantic tokens mapped to the dark theme (`--ua-bg`, `--ua-text`, `--ua-accent`, etc.).
- `animations.css` — motion tokens (`--ua-ease-standard`, `--ua-dur-fast`, etc.) with `prefers-reduced-motion` support.
- `globals.css` — reset, base element styles, scrollbar styling, and layout utilities.

## Package Structure

### `packages/shared`

Foundation types shared across all packages: messages, commands, plan items, tool calls, evidence records, workspace state, and the MVP1 Runtime Contract. `TaskDraft`, `TaskRecord`, `TaskEvent`, `RuntimeSnapshot`, `RuntimeClient`, `EvidenceRecord`, and `ApprovalRequest` are defined here so runtime and desktop UI consume the same protocol.

### `packages/runtime`

Agent runtime state machine plus the deterministic MVP1 `MockRuntime`. The mock runtime accepts `TaskDraft`, emits ordered `TaskEvent` records, supports `#fail` failure injection, supports cancellation, and reduces events into `RuntimeSnapshot`. It does not import React or desktop UI code.

### `packages/mcp-client`

MCP (Model Context Protocol) client abstraction layer. MVP2 implements JSON-RPC 2.0 message helpers, structured protocol/transport errors, Streamable HTTP transport, legacy HTTP+SSE fallback transport, session lifecycle (`initialize` -> `notifications/initialized`), discovery (`tools/list`, `resources/list`, `prompts/list`), and read-only execution methods (`readResource`, `callTool`). The UE product path uses localhost HTTP transports only; `stdio` remains a generic non-UE type boundary. Above this transport, the runtime applies read-only routing by default and exposes only exact, schema-checked, explicitly approved mutation operations for the registered `/Game/UAgentSandbox/<run-id>` lifecycle. Generic wrapper mutation, non-sandbox writes, and replay execution remain blocked.

### Runtime Router

`packages/runtime` owns `RuntimeRouter`, `McpReadOnlyRuntime`, read-only risk policy, and semantic capability indexing. Desktop UI submits `TaskDraft` through the same `RuntimeClient` surface. The router sends read-only MCP intent to `McpReadOnlyRuntime` only when connected; otherwise it emits `mcp_fallback_to_mock` and uses `MockRuntime`.

React components do not construct JSON-RPC requests or call `tools/call` directly. UI consumes `RuntimeSnapshot`, `TaskEvent`, MCP connection state, and desktop view models.

## Design Principles

- **Local-first**: Local state stays on the user's machine; provider requests leave the machine only after explicit review of the actual request.
- **Type-safe**: TypeScript throughout, with strict mode enabled.
- **Monorepo**: Clear separation of concerns via pnpm workspaces.
- **Extensible**: Provider-agnostic adapter patterns for LLM backends.
- **MCP-native**: Protocol alignment with Unreal MCP Server for UE5.8.
- **Tool-grade UI**: Desktop AI Agent workbench aesthetic — dense, functional, and extensible. No landing-page or marketing styling.
- **Guarded runtime boundary**: The mock runtime remains available for deterministic fallback and tests, while implemented native, MCP, process-observation, and sandbox mutation paths require explicit capability, trust, approval, containment, verification, and replay guards.

## Runtime and safety invariants

- `Composer -> TaskDraft -> RuntimeClient.submitTask() -> AgentLoopRuntime -> TaskEvent -> RuntimeSnapshot -> UI` is the task-state flow. Events are append-only, JSON-serializable, and replayable; audit and traces are projections rather than competing sources of truth.
- React surfaces consume store state/actions. Native filesystem/process access, MCP calls, and provider transport remain behind their adapters and policy checks.
- Provider configuration holds secret references rather than raw keys. Live transport is explicit; fixtures and ordinary tests never require real credentials or provider access. Session credentials, exact outbound review, context isolation, and current transport availability are described in [desktop provider and conversations](desktop-provider-and-conversation.md).
- Secrets and raw approval tokens must not enter serialized UI state, events, snapshots, audit, replay, diagnostics, saved summaries, or logs. File previews, diffs, and command output apply the shared secret/path redaction policy.
- Project scanning and previews require explicit trusted-root containment, extension/binary and size limits, cancellation, and redacted summaries. Native root IDs bind canonical paths and filesystem identity; path strings alone do not establish trust.
- Text-backed writes use `WorkspaceChangeSetV2`, preview-bound native approvals, exact operation/before/after hashes, expiry, and one-time use. Rollback verifies backup/root binding and expected current hashes. Binary UE assets are blocked from the text-write path.
- Terminal execution requires a native proposal, exact command/arguments/cwd binding, one-time approval, no-shell allowlisting, environment restrictions, timeout/cancel handling, and bounded redacted output. Browser navigation, screenshot capture, watchers, and UE observation retain independent capability/trust/consent gates.
- Context Pack v1 is local/in-memory unless the user explicitly saves or shares a redacted summary. Replay reads recorded summaries only: it never re-reads a project, invokes MCP, navigates a browser, captures a screen, restarts a watcher, executes a command, applies a change, or rolls back.
- UE observation is read-only and stopping observation never kills the editor. Asset execution is a separate default-off native capability with exact plugin provenance, live process/session/root binding, explicit one-shot approval, and `/Game/UAgentSandbox/<run-id>` containment. Unknown, expired, replaced, revoked, or mismatched authority fails closed.

The [companion registration decision](mvp15-ue-companion-plugin-adr.md), [build manifest contract](mvp15-ue-companion-plugin-build-manifest.md), and [MCP contract baseline](mvp15-ue-mcp-plugin-baseline.md) define the UE-specific identity and tool boundaries. These are implementation contracts, not a claim that current-source live UE acceptance has run.
