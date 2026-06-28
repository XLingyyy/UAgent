# MVP9 Baseline Freeze

## Freeze Date

2026-06-28

## Frozen Contracts

### Shared Types

- `packages/shared/src/evidence.ts` - `EvidenceKind` extended with `"terminal_output"`; `EvidenceRecord` supports terminal output evidence metadata (outputSummary, totalLines, totalBytes, redactionSummary, exitCode)
- `packages/shared/src/terminal.ts` - TerminalCommandProposal, TerminalExecutionRequest, TerminalExecutionResult, TerminalOutputChunk, TerminalExitState, TerminalCommandClassification, TerminalApprovalState
- `packages/shared/src/browser-preview.ts` - BrowserPreviewRequest, BrowserPreviewSession, ScreenshotCaptureRequest, ScreenshotCaptureResult, ScreenshotMetadata, PreviewArtifact
- `packages/shared/src/project-watcher.ts` - ProjectWatchSession, ProjectChangeEvent, ProjectIndexDiff, ProjectIndexDiffEntry, WatcherPolicy, WatcherEventBatch
- `packages/shared/src/capability.ts` - CapabilityKind extended with `project_watcher`; CapabilityMode extended with `proposal_only`, `approval_bound`, `capture_gated`; CapabilityDecisionStatus extended with `proposal_only`; new decision reasons
- `packages/shared/src/task.ts` - New TaskEventType values for terminal/browser/screenshot/watcher events (25 new event types including `screenshot_requested`, `watcher_applied`, `watcher_rescanned`)
- `packages/shared/src/audit.ts` - New AuditEventType values matching task events (includes `screenshot_requested`, `watcher_applied`, `watcher_rescanned`)

### Runtime Policy

- `packages/runtime/src/mvp9-terminal-policy.ts` - classifyTerminalCommandRisk(), isProposalExecutable(), createAllowlistTerminalPolicy()
- `packages/runtime/src/mvp9-terminal-adapter.ts` - createFixtureTerminalAdapter(), FixtureTerminalAdapter interface
- `packages/runtime/src/mvp9-browser-screenshot.ts` - classifyBrowserUrl(), createFixtureBrowserPreviewAdapter(), createFixtureScreenshotAdapter()
- `packages/runtime/src/mvp9-project-watcher.ts` - createDefaultWatcherPolicy(), isRootAllowedForWatch(), computeProjectIndexDiff(), debounceWatcherEvents(), createFixtureWatcherAdapter()
- `packages/runtime/src/mvp9-scenarios.ts` - 96 scenarios
- `packages/runtime/src/mvp9-scenarios.test.ts` - asserts >= 90 with core ID verification

### Runtime Services (NEW - P0 rework)

- `packages/runtime/src/session-history.ts` - `recordCapabilityEvent()` accepts optional `payload` parameter; `EventRecord` supports optional `payload`; replay includes payload in TaskEvent payload for evidence projection
- `packages/runtime/src/mvp9-terminal-service.ts` - TerminalService: proposal/approval/reject/execute state machine with audit/session integration; emits `terminal_output` event after execution with redacted output summary and inspectable terminal evidence payload
- `packages/runtime/src/mvp9-browser-service.ts` - BrowserService: URL classification, request/session/artifact management with audit/session
- `packages/runtime/src/mvp9-screenshot-service.ts` - ScreenshotService: request/approve/deny/capture state with evidence records; uses `screenshot_requested` for pending, `screenshot_captured` only on approval
- `packages/runtime/src/mvp9-watcher-service.ts` - WatcherService: start/changes/diff/apply/rescan/stop state with audit/session; `applyChanges()` and `rescan()` emit `watcher_applied`/`watcher_rescanned` events
- `packages/runtime/src/mvp9-runtime-service.ts` - Mvp9RuntimeService: unified service combining all four, with audit/session engines

### Runtime Service Integration

- `apps/desktop/web/src/runtime/desktop-runtime-adapter.ts` - DesktopRuntimeAdapter.getMvp9() and subscribeMvp9()
- `apps/desktop/web/src/runtime/runtime-store.ts` - RuntimeStoreState.mvp9, RuntimeStoreActions extended with 22 MVP9 actions (including `applyWatcherChanges`, `rescanWatcher`)
- `apps/desktop/web/src/runtime/event-view-models.ts` - `extractRuntimeEvidence()` includes `terminal_output` as evidence-bearing event; `extractEvidenceItem()` extracts terminal evidence with metadata (output summary, line/byte counts, redaction summary) from replay payload
- `apps/desktop/web/src/inspector/UtilityPlaceholderPanel.tsx` - `UtilityEvidencePanel` displays terminal output evidence from `terminal_output` event payload alongside existing evidence types
- `apps/desktop/web/src/stores/ui-store.ts` - MVP9 store subscription and action wiring

### UI Panels (Desktop React) - Store-Backed

- `apps/desktop/web/src/inspector/TerminalPanel.tsx` - Store-backed via useRuntimeStore/useRuntimeActions, three-stage state machine (idle/proposal/execution+rejected)
- `apps/desktop/web/src/inspector/BrowserPanel.tsx` - Store-backed, URL preview with local/external classification
- `apps/desktop/web/src/inspector/ScreenshotPanel.tsx` - Store-backed, capture request/approve/deny with redacted artifact metadata
- `apps/desktop/web/src/inspector/WatcherPanel.tsx` - Store-backed, start/generate events/compute diff/stop with overflow warning

### Composer Integration

- `apps/desktop/web/src/composer/ComposerDock.tsx` - Terminal intent detection: auto-proposes command on build/test/lint input patterns

### Side-effect Scan Categories

- `mvp9-terminal-exec-boundary` - Blocks child_process/spawn/exec in React UI
- `mvp9-browser-preview-boundary` - Blocks window.open/location.href in React UI
- `mvp9-screenshot-capture-boundary` - Blocks getDisplayMedia/screen.capture in React UI
- `mvp9-watcher-boundary` - Blocks fs.watch/chokidar/FileWatcher in React UI
- `mvp9-raw-output-boundary` - Blocks raw home paths and secrets in output

### Native Skeletons (Tauri Rust)

- `apps/desktop/src-tauri/src/terminal.rs` - propose_terminal_command(), execute_terminal_command(), cancel_terminal_execution() with risk classification and feature flag gating
- `apps/desktop/src-tauri/src/browser.rs` - browser_preview() with URL policy classification and feature flag gating
- `apps/desktop/src-tauri/src/screenshot.rs` - request_screenshot_capture(), approve_screenshot_capture() with approval gating
- `apps/desktop/src-tauri/src/watcher.rs` - start_watcher(), stop_watcher(), read_watcher_diff() with trusted root validation
- All use `pub const *FEATURE_ENABLED: bool = cfg!(test);` — feature-flagged OFF by default

### Documentation

- `docs/mvp8-acceptance.md` - G0-G8 all [X] COMPLETE
- `docs/mvp8-final-handoff.md` - MVP8 baseline freeze and red lines
- `docs/mvp8-manual-smoke.md` - Fixture filter corrected
- `docs/mvp9-prep.md` - MVP9 preparation overview
- `docs/mvp9-preflight.md` - Preflight checklist
- `docs/mvp9-acceptance.md` - G0-G10 gate table and completed task list
- `docs/mvp9-manual-smoke.md` - S1-S10 smoke steps
- `docs/mvp9-risk-register.md` - 9 risks with mitigations
- `docs/mvp9-baseline-freeze.md` - This document
- `README.md` - Current stage: MVP9
- `docs/mvp-roadmap.md` - MVP8 complete, MVP9 current

## Frozen Red Lines

All 15 red lines from `docs/mvp9-acceptance.md` are frozen and must not be violated by future work.

## Next Phase Preparation

MVP10 may begin preparation for:
- UE write preparation with new policy and approval gates
- Broader automation with explicit capability registration
- Real native execution enablement via feature flags (terminal/browser/screenshot/watcher)
- Provider live network opt-in flows
