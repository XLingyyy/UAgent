# MVP9 Prep

MVP9 adds three controlled real capabilities on top of the MVP8 native read-only filesystem bridge:

1. **Controlled Terminal**: Proposal-only -> approval-bound execution. Command risk classifier, allowlist/denylist, fixture dry-run adapter, Tauri native skeleton (feature-flagged).
2. **Browser/Screenshot Preview**: Local-only URL policy, blocked external URLs by default, user-initiated browser preview and screenshot capture, fixture adapters, feature-flagged native skeletons.
3. **Incremental Watcher**: Trusted root watcher with debounce and overflow handling, diff computation, no auto-rescan, user-initiated apply.

MVP9 preserves all MVP5-MVP8 red lines:
- Approval/Sandbox/Audit/Session/Redaction boundaries remain non-negotiable
- Provider live remains manual opt-in
- No raw paths or secrets in UI/DOM/audit/session/evidence
- React UI must not directly invoke native commands
- Watcher must not auto-rescan or trigger side effects
- Terminal must progress through proposal -> approval -> execution

## Key Contracts

- `packages/shared/src/terminal.ts` - TerminalCommandProposal, TerminalExecutionRequest, TerminalExecutionResult
- `packages/shared/src/browser-preview.ts` - BrowserPreviewSession, ScreenshotCaptureRequest/Result, PreviewArtifact
- `packages/shared/src/project-watcher.ts` - ProjectWatchSession, ProjectChangeEvent, ProjectIndexDiff, WatcherPolicy

## Key Files

- `packages/runtime/src/mvp9-terminal-policy.ts` - Command risk classifier
- `packages/runtime/src/mvp9-terminal-adapter.ts` - Fixture terminal adapter
- `packages/runtime/src/mvp9-browser-screenshot.ts` - Browser/screenshot fixture adapters
- `packages/runtime/src/mvp9-project-watcher.ts` - Watcher adapter and policy
- `packages/runtime/src/mvp9-scenarios.ts` - 17 scenario matrix

## Verification

```powershell
pnpm typecheck
pnpm lint
pnpm test
node scripts/side-effect-scan.mjs
git diff --check
```
