# MVP9 Acceptance

## Gate Summary

| Gate | Description | Status | Owner |
|------|-------------|--------|-------|
| G0 | Preflight baseline | [X] COMPLETE | Implementation Agent |
| G1 | MVP8 carry-over closed | [X] COMPLETE | Implementation Agent |
| G2 | Shared contracts and policy | [X] COMPLETE | Implementation Agent |
| G3 | Terminal proposal-only | [X] COMPLETE | Implementation Agent |
| G4 | Approval-bound terminal execution | [X] FIXTURE_GATED | Implementation Agent |
| G5 | Browser/Screenshot preview | [X] FIXTURE_GATED | Implementation Agent |
| G6 | Incremental watcher | [X] FIXTURE_GATED | Implementation Agent |
| G7 | Runtime/UI integration | [X] COMPLETE | Implementation Agent |
| G8 | Security regression | [X] COMPLETE | Implementation Agent |
| G9 | Acceptance tests and docs | [X] COMPLETE | Implementation Agent |
| G10 | Final handoff | [X] COMPLETE | Implementation Agent |

Note: G4-G6 show FIXTURE_GATED status. Terminal/Browser/Screenshot/Watcher all have:
- Feature-flagged Rust native command skeletons (feature flag default OFF → blocked)
- **Runtime/store-backed state**: Each capability uses Mvp9RuntimeService (TerminalService/BrowserService/ScreenshotService/WatcherService) with audit/session/evidence integration
- **Store-backed UI**: All panels read from runtime store via `useRuntimeStore()` hook and dispatch actions via `useRuntimeActions()`
- Composer auto-proposes terminal commands for build/test/lint intent
- All flows respect approval gating, redaction, and session replay (no adapter calls on replay)
- Terminal execution produces `terminal_output` audit/session events with redacted output summary and inspectable terminal evidence through the runtime evidence projection (via `extractRuntimeEvidence()` / `UtilityEvidencePanel`)
- Screenshot distinguishes `screenshot_requested` (pending) from `screenshot_captured` (completed); replay correctly maps request-only vs approved states
- Watcher provides Apply/Rescan user actions with audit/session events and visible state changes
- Real native execution requires feature flag enablement in a future MVP

## Verification Commands

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @uagent/shared test
pnpm --filter @uagent/runtime test
pnpm --filter @uagent/mcp-client test
pnpm --filter @uagent/desktop test
pnpm --filter @uagent/desktop web:build
node scripts/side-effect-scan.mjs
git diff --check
```

## Red Lines

1. No write command registered in Tauri bridge (native or otherwise)
2. No raw absolute path or raw secret in UI state, DOM, audit, session replay, evidence, or test snapshots
3. React UI must not directly import @tauri-apps/api, node:fs, node:path, child_process
4. Root validation must reject dangerous root, relative path, network path
5. Symlink escape must be blocked
6. Preview must redact secrets and home paths
7. Trust must precede scan
8. Capability bridge must block write/exec/capture/browser by default
9. Provider live must remain manual opt-in
10. Side-effect scan must report 0 blocked findings
11. Terminal must progress proposal -> approval -> execution (three audit stages)
12. Browser/Screenshot must be user-initiated, no background capture
13. Watcher must only produce dirty state and diff; no auto rescan or side effects
14. React UI must not directly call native invoke for terminal/browser/screenshot/watcher
15. Watcher must not silently discard overflow events without warning

## Completed Tasks

### MVP9-00 Baseline & MVP8 Carry-over
- MVP9-00-01 [DONE] Branch creation deferred to supervisor (Git authority)
- MVP9-00-02 [DONE] TitleBar badge updated to MVP9 Prep
- MVP9-00-03 [DONE] MVP8 manual smoke fixture filter corrected
- MVP9-00-04 [DONE] MVP8 acceptance gate status updated
- MVP9-00-05 [DONE] MVP8 final handoff document created
- MVP9-00-06 [DONE] Preflight baseline verification

### MVP9-01 Contracts/Policy/Scenario Harness
- MVP9-01-01 [DONE] Terminal shared types
- MVP9-01-02 [DONE] Browser/Screenshot shared types
- MVP9-01-03 [DONE] Incremental Watcher shared types
- MVP9-01-04 [DONE] Capability Bridge extended
- MVP9-01-05 [DONE] TaskEvent/Evidence/Audit/Session extended
- MVP9-01-06 [DONE] MVP9 safety policy (classifier, allowlist, denylist)
- MVP9-01-07 [DONE] MVP9 scenario matrix (96 scenarios)

### MVP9-02 Controlled Terminal
- MVP9-02-01 [DONE] Command risk classifier
- MVP9-02-02 [DONE] Command proposal generator
- MVP9-02-03 [DONE] Terminal dry-run adapter
- MVP9-02-04 [DONE] Approval-bound execution gate (policy-based)
- MVP9-02-05 [DONE] Tauri native terminal skeleton (`apps/desktop/src-tauri/src/terminal.rs`: propose/execute/cancel with risk classification, feature flag `TERMINAL_FEATURE_ENABLED` default OFF → blocked)
- MVP9-02-06 [DONE] Sandbox-bounded policy (cwd containment, timeout)
- MVP9-02-07 [DONE] Output stream and truncation policy
- MVP9-02-08 [DONE] TerminalPanel UI (store-backed via TerminalService/runtime-store/useRuntimeActions)
- MVP9-02-09 [DONE] Terminal audit/evidence/session projection (recorded via AuditProjectionEngine and SessionHistoryEngine)
- MVP9-02-10 [DONE] Terminal tests and smoke (store-backed service tests + panel tests)

### MVP9-03 Browser/Screenshot Preview
- MVP9-03-01 [DONE] Browser preview URL/file policy
- MVP9-03-02 [DONE] BrowserPreviewAdapter fixture
- MVP9-03-03 [DONE] Tauri browser preview skeleton (`apps/desktop/src-tauri/src/browser.rs`: URL policy classification with `BROWSER_FEATURE_ENABLED` default OFF → blocked)
- MVP9-03-04 [DONE] BrowserPanel UI (store-backed via BrowserService/runtime-store/useRuntimeActions)
- MVP9-03-05 [DONE] Screenshot capture policy
- MVP9-03-06 [DONE] ScreenshotAdapter fixture and native skeleton (`apps/desktop/src-tauri/src/screenshot.rs`: request/approve/deny flow with `SCREENSHOT_FEATURE_ENABLED` default OFF → blocked)
- MVP9-03-07 [DONE] Screenshot UI and Evidence (store-backed via ScreenshotService with evidence records)
- MVP9-03-08 [DONE] Browser/Screenshot tests (store-backed service tests + panel tests)

### MVP9-04 Incremental Watcher
- MVP9-04-01 [DONE] Watcher policy and root trust reuse
- MVP9-04-02 [DONE] Tauri native watcher skeleton (`apps/desktop/src-tauri/src/watcher.rs`: start/stop/read-diff with `WATCHER_FEATURE_ENABLED` default OFF → blocked, trusted root validation)
- MVP9-04-03 [DONE] ProjectIndexDiff calculator
- MVP9-04-04 [DONE] Debounce and backpressure
- MVP9-04-05 [DONE] UI dirty state and user-initiated update (store-backed via WatcherService)
- MVP9-04-06 [DONE] Watcher cancel/stop and cleanup
- MVP9-04-07 [DONE] Watcher session/audit/evidence (recorded via AuditProjectionEngine and SessionHistoryEngine)
- MVP9-04-08 [DONE] Watcher tests (store-backed service tests + panel tests)

### MVP9-05 UI/Settings Integration
- MVP9-05-01 [DONE] Utility Drawer tool grouping upgrade
- MVP9-05-02 [DONE] Status strip and TitleBar capability summary
- MVP9-05-03 [DONE] Config Settings MVP9 capability controls
- MVP9-05-04 [DONE] General Settings terminal defaults
- MVP9-05-05 [DONE] Composer command proposal entry (intent-based build/test/lint detection)
- MVP9-05-06 [DONE] MVP9 panel keyboard and tooltip
- MVP9-05-07 [DONE] Files panel and MVP8 preview linkage

### MVP9-06 Runtime/Security Regression
- MVP9-06-01 [DONE] Runtime adapter routing (Mvp9RuntimeService integrated into DesktopRuntimeAdapter)
- MVP9-06-02 [DONE] Approval/Sandbox/Audit/Session regression
- MVP9-06-03 [DONE] Side-effect scan MVP9 categories
- MVP9-06-04 [DONE] Redaction regression extension
- MVP9-06-05 [DONE] No background action proof

### MVP9-07 Testing/Docs/Release
- MVP9-07-01 [DONE] Shared/runtime unit tests
- MVP9-07-02 [DONE] Desktop component tests (store-backed panel + service integration tests)
- MVP9-07-03 [DONE] Rust/native tests (10 new tests)
- MVP9-07-04 [DONE] MVP9 acceptance document
- MVP9-07-05 [DONE] MVP9 risk register
- MVP9-07-06 [DONE] MVP9 manual smoke
- MVP9-07-07 [DONE] README/Roadmap update
- MVP9-07-08 [DONE] MVP9 baseline freeze
- MVP9-07-09 [DONE] Native skeletons rework: terminal.rs, browser.rs, screenshot.rs, watcher.rs with feature flags and 10 Rust tests
- MVP9-07-10 [DONE] Scenario matrix extension from 17 to 96 scenarios with real assertions
- MVP9-07-11 [DONE] TerminalPanel gated flow: store-backed, proposal/approval/execution/rejected via TerminalService
- MVP9-07-12 [DONE] BrowserPanel gated flow: store-backed, URL classification via BrowserService
- MVP9-07-13 [DONE] ScreenshotPanel gated flow: store-backed, request/approve/deny via ScreenshotService
- MVP9-07-14 [DONE] WatcherPanel gated flow: store-backed, start/generate/compute diff/stop via WatcherService
- MVP9-07-15 [DONE] Runtime/store integration: Mvp9RuntimeService in DesktopRuntimeAdapter, state in RuntimeStoreState, actions in RuntimeStoreActions
- MVP9-07-16 [DONE] Composer terminal intent: auto-propose command on build/test/lint input
- MVP9-07-17 [DONE] Session replay: replayTask returns stored state without adapter calls
