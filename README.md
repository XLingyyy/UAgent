# UAgent

AI Agent Host and Client aligned with UE5.8 official Unreal MCP Server. UAgent provides a local-first desktop workspace for planning, executing, and reviewing AI-assisted workflows - starting with Unreal Engine game development tooling.

## Current Stage: MVP12 Controlled UE Text Repair Loop (Implemented)

MVP11 final acceptance is complete. MVP12 adds an approval-gated text repair loop for UE-like project files while preserving MVP10/MVP11 approval, feature-gate, redaction, and replay boundaries. Current MVP12 implementation includes:

1. **ChangeSet v2 Contracts**: Repair proposals, operation kinds, lifecycle states, risk levels, apply/rollback requests, verification results, and redacted evidence payloads.
2. **Text Mutation Policy**: Allowed UE text extensions, generated-dir/binary/root-escape/stale-hash blocking, unified diff rendering, and content redaction.
3. **Deterministic Repair Engine**: Recipes for Build.cs dependencies, Target.cs modules, plugin disabling, config redaction, malformed descriptors, and build-error location.
4. **Native Text Mutation Bridge**: Tauri preview/apply/rollback/status commands with backup snapshots and hash-checked rollback.
5. **Desktop UI / Store**: Changes, Diagnostics, Settings, Evidence, and ProjectTree surfaces show proposals, approval state, verification, rollback availability, and file markers.
6. **Scenario Matrix / Side-effect Scan / Docs**: MVP12 scenario matrix, UE-like fixture, manual smoke docs, and side-effect scan categories for mutation boundaries.

Controlled text writes remain approval-gated and limited to trusted fixture/temp roots or explicitly trusted project roots. Binary UE assets, generated directories, arbitrary shell expansion, mutating MCP, provider live defaults, automatic git operations, replay re-apply, and raw secret/path leakage remain blocked.

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
- [MVP11 Acceptance](docs/mvp11-acceptance.md)
- [MVP11 Manual Smoke](docs/mvp11-manual-smoke.md)
- [MVP11 Final Handoff](docs/mvp11-final-handoff.md)
- [MVP12 Prep](docs/mvp12-prep.md)
- [MVP12 Acceptance](docs/mvp12-acceptance.md)
- [MVP12 Manual Smoke](docs/mvp12-manual-smoke.md)
- [MVP12 Risk Register](docs/mvp12-risk-register.md)
- [MVP12 Final Verification](docs/mvp12-final-verification.md)
- [MVP12 Final Handoff](docs/mvp12-final-handoff.md)
- [Baseline Freeze](docs/mvp5-baseline-freeze.md)
- [Development Guide](docs/development.md)

## License

Proprietary. All rights reserved.
