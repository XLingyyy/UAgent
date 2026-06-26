# UAgent

AI Agent Host and Client aligned with UE5.8 official Unreal MCP Server. UAgent provides a local-first desktop workspace for planning, executing, and reviewing AI-assisted workflows — starting with Unreal Engine game development tooling.

## Current Stage: MVP1 Mock Product Shell + Runtime Contract

The visual UI foundation is complete. The current product slice turns the shell into an interactive mock task console: Composer input creates a `TaskDraft`, submits it to a deterministic `MockRuntime`, stores `TaskEvent` snapshots, and renders the same task context in ConversationViewport, the left thread list, and the right utility drawer.

MVP1 remains mock-only. It does not connect to Unreal Editor, call MCP tools, call LLM/provider APIs, or perform real project filesystem work.

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
      runtime/      Desktop mock runtime adapter and event view models
      stores/       UI state stores (custom slice store)
      styles/       tokens, theme, animations, globals
      types/        UI type definitions
packages/shared/    Shared types plus MVP1 Task/Runtime/Event contract
packages/runtime/   Deterministic MockRuntime and TaskEvent reducer
packages/mcp-client/  MCP server profile and connection types
docs/               Architecture, roadmap, development guide
```

## Native Build Prerequisites

The Tauri 2 native build requires the Rust toolchain (`rustc` / `cargo`) and platform-specific WebView dependencies. The web frontend (`pnpm --filter @uagent/desktop web:build`) builds without Rust.

## Non-Goals (current stage)

- Real Unreal Engine connection or Editor launch
- Real MCP tool calls
- Real LLM API calls or provider integration
- Cloud deployment, auth, or remote services
- Forking or embedding Codex/Claude Code/Cursor/Aider
- Production-level sandboxing, approval workflow, or promote/rollback

## Documentation

- [Architecture](docs/architecture.md)
- [MVP Roadmap](docs/mvp-roadmap.md)
- [Runtime Contract](docs/runtime-contract.md)
- [MVP1 Acceptance](docs/mvp1-acceptance.md)
- [Development Guide](docs/development.md)

## License

Proprietary. All rights reserved.
