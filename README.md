# UAgent

AI Agent Host and Client aligned with UE5.8 official Unreal MCP Server. UAgent provides a local-first desktop workspace for planning, executing, and reviewing AI-assisted workflows — starting with Unreal Engine game development tooling.

## Current Stage: MVP5 Workflow & Safety

MVP5 extends the MVP4 provider boundary with an institutionalized safety layer: approval workflow, sandbox execution mode, ChangeSet rollback/promote, audit log, and session history. The core flow (`Composer → TaskDraft → RuntimeClient.submitTask() → AgentLoopRuntime → TaskEvent → RuntimeSnapshot → UI`) remains unchanged. MVP5 adds risk classification, approval gates, fixture sandbox execution, ChangeSet state management, and append-only audit projections.

MVP5 does not default to live provider network, real UE writes, real mutating MCP tools, or product shell/browser/filesystem behavior. All sandbox execution defaults to `disabled` or `fixture` mode. Approval decisions, sandbox results, ChangeSet operations, and audit events are secret-safe, deterministic, and replayable.

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
- [MVP4 Acceptance](docs/mvp4-acceptance.md)
- [MVP5 Acceptance](docs/mvp5-acceptance.md)
- [Workflow Safety Plan](docs/workflow-safety-plan.md)
- [Baseline Freeze](docs/mvp5-baseline-freeze.md)
- [Development Guide](docs/development.md)

## License

Proprietary. All rights reserved.
