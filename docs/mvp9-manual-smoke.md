# MVP9 Manual Smoke Test

## Prerequisites

- `pnpm install` completed
- `pnpm --filter @uagent/desktop web:dev` running

## Smoke Steps

### S1: Welcome State
1. Start the app with `pnpm --filter @uagent/desktop web:dev`
2. Verify TitleBar shows "MVP9 Prep" / "Native FS" badge
3. Verify no console errors in dev tools

### S2: Project Config/Trust/Scan
1. Navigate to Settings -> Config
2. Enter `fixture://lyra` as project root
3. Click "Validate project root"
4. Verify "Validation ready" appears
5. Click "Trust project root"
6. Click "Scan project index"
7. Verify "Index ready" and Asset Browser shows indexed files
8. Click a text file -> verify preview shows redacted content

### S3: Terminal Command Proposal
1. Open Terminal panel in Utility Drawer
2. Type a command (e.g., `pnpm typecheck`) in the command input, or click a quick-action button
3. Verify Terminal panel shows command proposal with risk classification
4. Verify risk level, cwd (`[project-root]`), timeout are displayed
5. Verify "Approve & Execute" button is available (proposal-only)
6. Verify command is NOT executed without approval
7. For unknown/dangerous commands, verify "Approve & Execute" button is disabled

### S4: Reject Command Proposal
1. From Terminal panel, click "Reject" on a pending proposal
2. Verify panel shows "Rejected" status and reason
3. Verify no stdout/stderr was produced
4. Click "Reset" to return to idle state

### S5: Approve Allowlisted Command
1. From Terminal panel, enter an allowlisted command (e.g., `pnpm typecheck`)
2. Click "Approve & Execute"
3. Verify Terminal status changes to "Running..."
4. Verify output chunks appear (stdout/stderr) with exit code
5. Verify redaction summary shows secrets/paths counts
6. Click "Clear" to return to idle state

### S6: Blocked Dangerous Command
1. Type a dangerous command (e.g., `rm -rf /`)
2. Verify classifier shows "Blocked" risk badge
3. Verify "Approve & Execute" button is disabled
4. Verify the reason explains why the command is blocked

### S7: Browser Local Preview
1. Open Browser panel in Utility Drawer
2. Enter a local URL (e.g., `http://localhost:3000`)
3. Verify URL is allowed by policy (local_only)
4. Enter an external URL (e.g., `https://example.com`)
5. Verify URL is blocked by policy (blocked_external)

### S8: Screenshot Request/Capture Semantics
1. Open Screenshot panel or trigger capture from capability bridge
2. Verify approval prompt appears with "pending" status
3. Verify audit shows `screenshot_requested` not `screenshot_captured`
4. Reject the capture -> verify no artifact generated and audit shows denial
5. Re-request capture and approve -> verify artifact exists and audit shows `screenshot_captured`
6. Verify metadata has no raw path/secret
7. Verify replay of request-only shows pending, not completed

### S9: Watcher Start/Change/Diff/Apply/Rescan/Stop
1. Open Files/Watcher panel
2. Start watching a trusted project root
3. Verify watcher status is "active"
4. Generate change events (or simulate file changes)
5. Verify dirty state indicator appears
6. Click "Compute Diff" -> verify diff summary shows added/modified/deleted
7. Click "Apply Changes" -> verify diff state clears, audit/session shows `watcher_applied` event
8. Generate more changes, compute diff, then click "Rescan" -> verify new diff, audit shows `watcher_rescanned` event
9. Stop watcher -> verify no further events and audit shows `watcher_stopped`
10. Verify Audit panel has watcher start/change/diff/apply/rescan/stop events
11. Verify replay shows no watcher adapter calls

### S10: Session Replay
1. Open Session History panel
2. Replay a session that had terminal/browser/screenshot/watcher events
3. Verify replay shows records but does not re-execute anything
4. Verify no new terminal output, browser navigation, or watcher events appear

## Expected Results

- S1-S10 all pass without errors
- Side-effect scan reports 0 blocked findings
- No `console.error` or uncaught exceptions
- All red lines preserved
