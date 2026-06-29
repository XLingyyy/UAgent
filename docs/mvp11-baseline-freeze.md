# MVP11 Baseline Freeze

## Implemented Baseline

- Shared contracts: `packages/shared/src/ue-diagnostics.ts`
- Runtime diagnostics: `packages/runtime/src/ue-diagnostics.ts`
- Audit/session replay wiring: `packages/runtime/src/audit-projection.ts`, `packages/runtime/src/session-history.ts`
- UI integration: Diagnostics, Review, Evidence, Config, and Terminal panels
- Native cleanup: fixture-only `execute_terminal_command_fixture`; real execution remains `execute_terminal_command_real`
- Side-effect scan: MVP11 categories added
- Fixture: `packages/runtime/src/fixtures/mvp11-ue-fixture/`

## Frozen Boundaries

- Read-only diagnostics only.
- Context Pack v1 remains local/in-memory unless an existing redacted evidence/session summary stores it.
- Replay is summary-only and cannot re-read files, invoke MCP, restart watcher/browser, or execute terminal commands.
- Provider live remains off by default.
- No GitHub Actions or workflow files are part of MVP11.
