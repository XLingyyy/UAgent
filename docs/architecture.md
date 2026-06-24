# UAgent Architecture

## Overview

UAgent is an AI Agent Host and Client for Unreal Engine workflows, aligned with the UE5.8 official Unreal MCP Server. It provides a local-first desktop workspace for planning, executing, and reviewing AI-assisted development tasks.

## High-Level Architecture

```text
┌──────────────────────────────────────────────┐
│              Desktop (Electron)               │
│  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Renderer   │  │    Main Process      │  │
│  │  (React SPA) │  │  (Node.js Runtime)   │  │
│  └──────┬───────┘  └──────────┬───────────┘  │
│         │                     │               │
│         └────── Preload ──────┘               │
└──────────────────────────────────────────────┘
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │  Shared  │ │ Runtime  │ │ MCP      │
   │  Types   │ │ Engine   │ │ Client   │
   └──────────┘ └──────────┘ └──────────┘
```

## Package Structure

### `apps/desktop`

Electron desktop application with React-based UI. Provides the main workspace interface with four panels: Chat/Command, Plan, Tool Timeline, and Evidence.

### `packages/shared`

Foundation types shared across all packages: messages, commands, plan items, tool calls, evidence records, and workspace state.

### `packages/runtime`

Agent runtime state machine and execution logic. Manages agent lifecycle, task planning, evidence collection, and tool orchestration.

### `packages/mcp-client`

MCP (Model Context Protocol) client abstraction layer. Type definitions for server profiles, connection management, capability discovery, and transport configuration. Designed to integrate with UE5.8 Unreal MCP Server over Streamable HTTP (default) with legacy HTTP + SSE compatibility. The `UnrealMcpTransport` type covers the UE official HTTP-based transports (`streamable-http`, `http-sse`); the generic `McpTransport` type adds `stdio` for non-Unreal MCP servers only.

## Design Principles

- **Local-first**: All data stays on the user's machine. No cloud dependency.
- **Type-safe**: TypeScript throughout, with strict mode enabled.
- **Monorepo**: Clear separation of concerns via pnpm workspaces.
- **Extensible**: Provider-agnostic adapter patterns for LLM backends.
- **MCP-native**: Protocol alignment with Unreal MCP Server for UE5.8.
