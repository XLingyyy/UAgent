# UAgent

AI Agent Host and Client aligned with UE5.8 official Unreal MCP Server. UAgent provides a local-first desktop workspace for planning, executing, and reviewing AI-assisted workflows - starting with Unreal Engine game development tooling.

## Current Stage: MVP15B Exact MCP Asset Tools Real Smoke (Implemented / Environment-Smoke Pending)

MVP15B extends the MVP14 safe editor observation path into a blocked-by-default real UE sandbox asset mutation pilot. It introduces a narrow dry-run / approve / execute / verify / rollback loop for sandbox-only asset work while preserving MVP12 ChangeSet v2, MVP13 approval binding, MVP14 process observation, trusted roots, redaction, and replay boundaries.

Current MVP15B code includes shared contracts, runtime policy, exact MCP asset adapters, a compliant exact-tool facade path for fully described wrapper toolsets, a Tauri native guard, desktop inspector surfaces, 60+ scenario coverage, and side-effect scan hardening. Real UE execution remains limited to `/Game/UAgentSandbox/**` and mapped `/Content/UAgentSandbox/**`; final acceptance still requires supervisor-local real UE smoke in a configured UE Editor environment.

1. **Asset Mutation Contracts**: Sandbox asset paths, operation kinds, dry-run plans, ChangeSet approvals, verification, rollback, evidence, audit, and replay summaries.
2. **Sandbox Policy**: Blocks non-sandbox paths, path traversal, Save All, unsafe delete/move/rename/bulk operations, broad mutating MCP calls, stale manifests, provider auto-apply, raw secrets, and replay re-execution.
3. **Runtime Asset Service**: Deterministic dry-run, approval token, execute, verify, rollback, manifest, replay summary, and scenario matrix support.
4. **Native Guard**: Feature-gated Tauri commands validate sandbox-only asset mutation requests before any native execution bridge can run.
5. **MCP Schema Adapters**: Exact allowlist for dry-run-capable sandbox asset tools with rollback contracts and read-only evidence queries; generic wrapper mutation paths remain blocked unless a compliant exact-tool facade pins toolset id, method id, schema version, `dryRunHash`, and `changeSetId`.
6. **Desktop UI / Store**: Inspector Assets tab, Changes panel, Settings gate, evidence, and runtime store actions expose asset ChangeSet lifecycle state.
7. **Scenario Matrix / Side-effect Scan / Docs**: MVP15 matrix covers at least 60 scenarios / 240 assertions; side-effect scan covers sandbox boundaries, broad mutating calls, Save All, replay, raw paths, token leakage, provider auto-apply, and manifest-only real verification.

Controlled text writes remain approval-gated and limited to trusted fixture/temp roots or explicitly trusted project roots. Non-sandbox UE assets, Save All, bulk asset operations, arbitrary shell expansion, provider live defaults, automatic git operations, replay re-execute, and raw secret/path leakage remain blocked.

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
- Non-sandbox Unreal Engine writes or Editor launch
- Broad mutating MCP tool calls
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
- [MVP13 Prep](docs/mvp13-prep.md)
- [MVP13 Acceptance](docs/mvp13-acceptance.md)
- [MVP13 Manual Smoke](docs/mvp13-manual-smoke.md)
- [MVP13 Risk Register](docs/mvp13-risk-register.md)
- [MVP13 Final Verification](docs/mvp13-final-verification.md)
- [MVP13 Final Handoff](docs/mvp13-final-handoff.md)
- [MVP15 Prep](docs/mvp15-prep.md)
- [MVP15 Acceptance](docs/mvp15-acceptance.md)
- [MVP15 Manual Smoke](docs/mvp15-manual-smoke.md)
- [MVP15 Risk Register](docs/mvp15-risk-register.md)
- [MVP15 Final Verification](docs/mvp15-final-verification.md)
- [MVP15 Final Handoff](docs/mvp15-final-handoff.md)
- [Baseline Freeze](docs/mvp5-baseline-freeze.md)
- [Development Guide](docs/development.md)

## License

Proprietary. All rights reserved.
