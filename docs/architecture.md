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

Tauri 2 native shell. The Rust entry point creates the application window and hosts the web frontend. The native core now provides policy-gated filesystem access, controlled process execution and observation, trusted-root binding, UE Editor attach/status support, and the approval-bound sandbox asset-mutation guard. Runtime-to-native commands and the localhost MCP client/transport are implemented; unsafe or unavailable capabilities remain disabled or fail closed. The window uses a custom title bar (`decorations: false`) so the React `TitleBar` component can render the drag region and custom controls.

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

- **Local-first**: All data stays on the user's machine. No cloud dependency.
- **Type-safe**: TypeScript throughout, with strict mode enabled.
- **Monorepo**: Clear separation of concerns via pnpm workspaces.
- **Extensible**: Provider-agnostic adapter patterns for LLM backends.
- **MCP-native**: Protocol alignment with Unreal MCP Server for UE5.8.
- **Tool-grade UI**: Desktop AI Agent workbench aesthetic — dense, functional, and extensible. No landing-page or marketing styling.
- **Guarded runtime boundary**: The mock runtime remains available for deterministic fallback and tests, while implemented native, MCP, process-observation, and sandbox mutation paths require explicit capability, trust, approval, containment, verification, and replay guards.
