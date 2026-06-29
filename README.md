# UAgent

AI Agent Host and Client aligned with UE5.8 official Unreal MCP Server. UAgent provides a local-first desktop workspace for planning, executing, and reviewing AI-assisted workflows - starting with Unreal Engine game development tooling.

## Current Stage: MVP10 Controlled Real Local Execution & Build Loop (Final Acceptance Complete)

MVP10 moves MVP9's fixture-gated capabilities into controlled real local execution. Current status: **G7-G12 complete after final verification, boundary review, and supervisor checkpoint review**:

1. **Real Terminal Execution** (COMPLETE): Default disabled, allowlisted commands only (typecheck, lint, test, build, git status/diff), approval-bound through a native proposal registry, cwd-contained, output redacted. No-shell wrapper with args array prevents injection. Approval token is bound to a stored proposal + command + cwd (one-time use).
2. **Build Loop** (COMPLETE): Verification command templates (typecheck, lint, test, web:build, cargo test, git status/diff/diff --check) with risk classification and one-time approval tokens.
3. **Terminal Classifier Hardening** (COMPLETE): No-shell parser, exact allowlist + denylist, dangerous pattern detection, env sanitization, mutation detection.
4. **Real Incremental Watcher** (COMPLETE): Default disabled, native `notify` watcher behind `UAGENT_ENABLE_REAL_WATCHER=1`, dirty/queued state, read-diff only, debounce/backpressure limits, redacted/root-relative paths, and no auto-rescan/write behavior.
5. **Local Browser Preview** (COMPLETE): Default disabled behind `UAGENT_ENABLE_REAL_BROWSER=1`; policy allows only localhost/127.0.0.1 and trusted in-root `file://` targets with redacted display. Native WebviewWindow launch now uses an async Tauri command, navigates allowed local/trusted-file targets, blocks external redirects, and BrowserPanel reaches completed or clear failed state.
6. **Final Acceptance** (COMPLETE): `pnpm typecheck`, `pnpm lint`, `pnpm test`, desktop web build, Rust `cargo check`/`cargo test`, side-effect scan, and `git diff --check` pass. Boundary review confirms terminal proposal/approval-token flow, trusted-root-only watcher, local-only browser preview, replay no-side-effect behavior, and redacted audit/session/evidence summaries.

All real capabilities default disabled behind feature gates. Approval/Sandbox/Audit/Session/Redaction boundaries remain non-negotiable. Provider live remains manual opt-in. UE write, mutating MCP, arbitrary shell remain non-goals.

## Technology Stack

- **Desktop Shell**: Tauri 2 + React 18 + Vite 5
- **Language**: TypeScript 5.5+ (strict mode)
- **Package Manager**: pnpm 9+ monorepo
- **Linting**: ESLint 9 (flat config) + Prettier
- **Testing**: Vitest + Testing Library

## Quick Start

```bash
pnpm install
pnpm --filter @uagent/desktop web:dev   # Start Vite dev server (browser preview, fixture fallback)
pnpm --filter @uagent/desktop dev        # Start Tauri native dev (real FS bridge available, requires Rust)
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
- Cloud deployment, auth, or remote services
- Forking or embedding Codex/Claude Code/Cursor/Aider

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
- [MVP6 Acceptance](docs/mvp6-acceptance.md)
- [MVP6 UI Productization Plan](docs/mvp6-ui-productization-plan.md)
- [MVP6 Baseline Freeze](docs/mvp6-baseline-freeze.md)
- [MVP6 Manual Smoke](docs/mvp6-manual-smoke.md)
- [MVP7 Acceptance](docs/mvp7-acceptance.md)
- [MVP7 Baseline Freeze](docs/mvp7-baseline-freeze.md)
- [MVP7 Project Index Plan](docs/mvp7-project-index-plan.md)
- [MVP7 Capability Bridge Plan](docs/mvp7-capability-bridge-plan.md)
- [MVP7 Manual Smoke](docs/mvp7-manual-smoke.md)
- [MVP8 Prep](docs/mvp8-prep.md)
- [MVP8 Baseline Freeze](docs/mvp8-baseline-freeze.md)
- [MVP8 Native FS Bridge Plan](docs/mvp8-native-fs-bridge-plan.md)
- [MVP8 Real Project Scan Plan](docs/mvp8-real-project-scan-plan.md)
- [MVP8 Acceptance](docs/mvp8-acceptance.md)
- [MVP8 Manual Smoke](docs/mvp8-manual-smoke.md)
- [MVP8 Risk Register](docs/mvp8-risk-register.md)
- [MVP9 Prep](docs/mvp9-prep.md)
- [Workflow Safety Plan](docs/workflow-safety-plan.md)
- [Baseline Freeze](docs/mvp5-baseline-freeze.md)
- [Development Guide](docs/development.md)

## License

Proprietary. All rights reserved.
