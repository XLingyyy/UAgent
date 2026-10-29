# MVP9 Acceptance

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

## Capability contracts

### Contracts/Policy/Scenario Harness
- Terminal shared types
- Browser/Screenshot shared types
- Incremental Watcher shared types
- Capability Bridge extended
- TaskEvent/Evidence/Audit/Session extended
- MVP9 safety policy (classifier, allowlist, denylist)
- MVP9 scenario matrix (96 scenarios)

### Controlled Terminal
- Command risk classifier
- Command proposal generator
- Terminal dry-run adapter
- Approval-bound execution gate (policy-based)
- Tauri native terminal skeleton (`apps/desktop/src-tauri/src/terminal.rs`: propose/execute/cancel with risk classification, feature flag `TERMINAL_FEATURE_ENABLED` default OFF → blocked)
- Sandbox-bounded policy (cwd containment, timeout)
- Output stream and truncation policy
- TerminalPanel UI (store-backed via TerminalService/runtime-store/useRuntimeActions)
- Terminal audit/evidence/session projection (recorded via AuditProjectionEngine and SessionHistoryEngine)
- Terminal tests and smoke (store-backed service tests + panel tests)

### Browser/Screenshot Preview
- Browser preview URL/file policy
- BrowserPreviewAdapter fixture
- Tauri browser preview skeleton (`apps/desktop/src-tauri/src/browser.rs`: URL policy classification with `BROWSER_FEATURE_ENABLED` default OFF → blocked)
- BrowserPanel UI (store-backed via BrowserService/runtime-store/useRuntimeActions)
- Screenshot capture policy
- ScreenshotAdapter fixture and native skeleton (`apps/desktop/src-tauri/src/screenshot.rs`: request/approve/deny flow with `SCREENSHOT_FEATURE_ENABLED` default OFF → blocked)
- Screenshot UI and Evidence (store-backed via ScreenshotService with evidence records)
- Browser/Screenshot tests (store-backed service tests + panel tests)

### Incremental Watcher
- Watcher policy and root trust reuse
- Tauri native watcher skeleton (`apps/desktop/src-tauri/src/watcher.rs`: start/stop/read-diff with `WATCHER_FEATURE_ENABLED` default OFF → blocked, trusted root validation)
- ProjectIndexDiff calculator
- Debounce and backpressure
- UI dirty state and user-initiated update (store-backed via WatcherService)
- Watcher cancel/stop and cleanup
- Watcher session/audit/evidence (recorded via AuditProjectionEngine and SessionHistoryEngine)
- Watcher tests (store-backed service tests + panel tests)

### UI/Settings Integration
- Utility Drawer tool grouping upgrade
- Status strip and TitleBar capability summary
- Config Settings MVP9 capability controls
- General Settings terminal defaults
- Composer command proposal entry (intent-based build/test/lint detection)
- MVP9 panel keyboard and tooltip
- Files panel and MVP8 preview linkage

### Runtime/Security Regression
- Runtime adapter routing (Mvp9RuntimeService integrated into DesktopRuntimeAdapter)
- Approval/Sandbox/Audit/Session regression
- Side-effect scan MVP9 categories
- Redaction regression extension
- No background action proof

### Verification coverage
- Shared/runtime unit tests
- Desktop component tests (store-backed panel + service integration tests)
- Rust/native tests (10 new tests)
- MVP9 acceptance document
- MVP9 risk register
- MVP9 manual smoke
- README/Roadmap update
- Native adapters: terminal.rs, browser.rs, screenshot.rs, watcher.rs with feature flags and 10 Rust tests
- Scenario matrix extension from 17 to 96 scenarios with real assertions
- TerminalPanel gated flow: store-backed, proposal/approval/execution/rejected via TerminalService
- BrowserPanel gated flow: store-backed, URL classification via BrowserService
- ScreenshotPanel gated flow: store-backed, request/approve/deny via ScreenshotService
- WatcherPanel gated flow: store-backed, start/generate/compute diff/stop via WatcherService
- Runtime/store integration: Mvp9RuntimeService in DesktopRuntimeAdapter, state in RuntimeStoreState, actions in RuntimeStoreActions
- Composer terminal intent: auto-propose command on build/test/lint input
- Session replay: replayTask returns stored state without adapter calls
