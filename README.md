# UAgent

AI Agent Host and Client aligned with UE5.8 official Unreal MCP Server. UAgent provides a local-first desktop workspace for planning, executing, and reviewing AI-assisted workflows — starting with Unreal Engine game development tooling.

## Current Stage: UI Foundation

Building the UAgent desktop shell on Tauri 2 + React + Vite with an AppShell layout (TitleBar, LeftSidebar, Workspace, InspectorPane), dark theme tokens, and animation tokens. Agent Runtime / MCP / LLM / Verifier functionality will be layered in after the UI shell is stable.

## Technology Stack

- **Desktop Shell**: Tauri 2 + React 18 + Vite 5
- **Language**: TypeScript 5.5+ (strict mode)
- **Package Manager**: pnpm 9+ monorepo
- **Linting**: ESLint 9 (flat config) + Prettier
- **Testing**: Vitest + Testing Library

## Quick Start

```bash
pnpm install
pnpm --filter @uagent/desktop web:dev   # Start Vite dev server (browser preview)
pnpm --filter @uagent/desktop dev        # Start Tauri native dev (requires Rust)
pnpm typecheck    # TypeScript checking
pnpm lint         # Static analysis
pnpm test         # Run test suite
```

## Project Structure

```
apps/desktop/
  src-tauri/        Tauri 2 native shell (Rust)
  web/              React + Vite frontend
    src/
      app/          Root App and providers
      shell/        AppShell, TitleBar, MainLayout, GlobalOverlays
      sidebar/      LeftSidebar
      workspace/    Workspace (ConversationViewport + ComposerDock area)
      inspector/    InspectorPane
      components/   Reusable presentational components
      stores/       UI state stores (Zustand layer — placeholder)
      styles/       tokens, theme, animations, globals
      types/        UI type definitions
packages/shared/    Shared types (messages, plans, tools, evidence)
packages/runtime/   Agent state machine and task execution
packages/mcp-client/  MCP server profile and connection types
docs/               Architecture, roadmap, development guide
```

## Native Build Prerequisites

The Tauri 2 native build requires the Rust toolchain (`rustc` / `cargo`) and platform-specific WebView dependencies. The web frontend (`pnpm --filter @uagent/desktop web:build`) builds without Rust.

## Non-Goals (current stage)

- Real Unreal Engine connection or Editor launch
- Real LLM API calls or provider integration
- Cloud deployment, auth, or remote services
- Forking or embedding Codex/Claude Code/Cursor/Aider
- Production-level sandboxing, approval workflow, or promote/rollback

## Documentation

- [Architecture](docs/architecture.md)
- [MVP Roadmap](docs/mvp-roadmap.md)
- [Development Guide](docs/development.md)

## License

Proprietary. All rights reserved.
