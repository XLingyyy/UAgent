# UAgent

AI Agent Host and Client aligned with UE5.8 official Unreal MCP Server. UAgent provides a local-first desktop workspace for planning, executing, and reviewing AI-assisted workflows — starting with Unreal Engine game development tooling.

## Current Stage: MVP4 Provider Adapter Implementation / Real Provider Boundary

The MVP2 read-only MCP runtime remains the transport baseline. Composer input still creates a `TaskDraft` and submits through `RuntimeClient.submitTask()`, but MVP3 routes that draft through a deterministic Agent Core loop: plan, select a guarded read-only action, observe, record evidence, report, and expose every state transition through `TaskEvent` and `RuntimeSnapshot`.

MVP3 supports shared Agent plan/step/observation/report contracts, deterministic planning without an LLM, guarded read-only MCP action selection, mock fallback observations when MCP is unavailable or undiscovered, structured evidence, final Agent reports, and UI display for plan progress and diagnostics. It does not perform real UE writes, real LLM/provider API calls, shell/browser/filesystem product behavior, approval-driven write actions, or provider requests.

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
packages/mcp-client/  MCP JSON-RPC, Streamable HTTP, legacy SSE, session, and discovery client
docs/               Architecture, roadmap, development guide
```

## Native Build Prerequisites

The Tauri 2 native build requires the Rust toolchain (`rustc` / `cargo`) and platform-specific WebView dependencies. The web frontend (`pnpm --filter @uagent/desktop web:build`) builds without Rust.

## Non-Goals (current stage)

- Default live provider network access (must be opt-in)
- Real Unreal Engine writes or Editor launch
- Mutating MCP tool calls
- Shell/browser/filesystem product behavior
- Approval write flow
- Cloud deployment, auth, or remote services
- Forking or embedding Codex/Claude Code/Cursor/Aider
- Production-level sandboxing, approval workflow, or promote/rollback

## Documentation

- [Architecture](docs/architecture.md)
- [MVP Roadmap](docs/mvp-roadmap.md)
- [Runtime Contract](docs/runtime-contract.md)
- [MVP1 Acceptance](docs/mvp1-acceptance.md)
- [MCP Read-only Plan](docs/mcp-readonly-plan.md)
- [MVP2 Acceptance](docs/mvp2-acceptance.md)
- [Agent Core Plan](docs/agent-core-plan.md)
- [MVP3 Acceptance](docs/mvp3-acceptance.md)
- [Development Guide](docs/development.md)

## License

Proprietary. All rights reserved.
