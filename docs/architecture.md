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

Tauri 2 native shell. The Rust entry point creates the application window and hosts the web frontend. Native sidecars, Runtime IPC, and MCP transport will be added in later stages. The window uses a custom title bar (`decorations: false`) so the React `TitleBar` component can render the drag region and custom controls.

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

MCP (Model Context Protocol) client abstraction layer. Type definitions for server profiles, connection management, capability discovery, and transport configuration. Designed to integrate with UE5.8 Unreal MCP Server over Streamable HTTP (default) with legacy HTTP + SSE compatibility. The `UnrealMcpTransport` type covers the UE official HTTP-based transports (`streamable-http`, `http-sse`); the generic `McpTransport` type adds `stdio` for non-Unreal MCP servers only.

## Design Principles

- **Local-first**: All data stays on the user's machine. No cloud dependency.
- **Type-safe**: TypeScript throughout, with strict mode enabled.
- **Monorepo**: Clear separation of concerns via pnpm workspaces.
- **Extensible**: Provider-agnostic adapter patterns for LLM backends.
- **MCP-native**: Protocol alignment with Unreal MCP Server for UE5.8.
- **Tool-grade UI**: Desktop AI Agent workbench aesthetic — dense, functional, and extensible. No landing-page or marketing styling.
- **Mock-first runtime boundary**: MVP1 proves the product task flow without real network, MCP, UE, filesystem, or LLM side effects.
