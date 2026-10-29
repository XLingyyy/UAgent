# MVP10 Manual Smoke Test

## Prerequisites

- `pnpm install` completed
- `pnpm --filter @uagent/desktop dev` running for default-off native status checks
- `UAGENT_ENABLE_REAL_TERMINAL=1 pnpm --filter @uagent/desktop dev` (PowerShell: `$env:UAGENT_ENABLE_REAL_TERMINAL="1"; pnpm --filter @uagent/desktop dev`) for the controlled real terminal happy-path smoke
- `UAGENT_ENABLE_REAL_WATCHER=1 pnpm --filter @uagent/desktop dev` (PowerShell: `$env:UAGENT_ENABLE_REAL_WATCHER="1"; pnpm --filter @uagent/desktop dev`) for the controlled real watcher happy-path smoke
- `UAGENT_ENABLE_REAL_BROWSER=1 pnpm --filter @uagent/desktop dev` (PowerShell: `$env:UAGENT_ENABLE_REAL_BROWSER="1"; pnpm --filter @uagent/desktop dev`) for the controlled real browser preview happy-path smoke
- All feature gates default OFF unless explicitly toggled

## Smoke Steps

### S1: Feature Gate Defaults (All Off)
1. Start the app
2. Open Settings -> Config -> Terminal Execution
3. Verify Terminal Execution section shows disabled native terminal status and the allowlist/root/approval/limit summary
4. Verify Terminal panel shows "Real terminal execution is disabled" with blocked message
5. Verify Watcher panel shows "Real watcher disabled"
6. Verify Browser panel shows "Real browser disabled"

### S2: Enable Terminal Feature Gate
1. In Settings -> Config -> Terminal Execution, verify the execution mode readout
2. Verify Terminal panel shows mode indicator and policy constraints
3. Feature gate `TERMINAL_FEATURE_ENABLED` and `TERMINAL_REAL_ENABLED` default OFF in native code
4. Restart native dev with `UAGENT_ENABLE_REAL_TERMINAL=1`
5. Verify TerminalPanel is enabled from runtime/native capability status, not a hardcoded UI constant

### S3: Allowlisted Command Execution
1. With `TERMINAL_REAL_ENABLED` ON, open Terminal panel
2. Enter `pnpm typecheck` (an allowlisted command)
3. Verify proposal shows command, risk classification, cwd, timeout
4. Click "Approve & Execute"
5. Verify execution completes with stdout, stderr, exit code
6. Verify output is redacted (no raw paths/secrets visible)

### S4: Blocked Command (Not in Allowlist)
1. Enter `node --eval "console.log('hello')"`
2. Verify classifier shows "Blocked" risk badge with reason "Command not in allowlist"
3. Verify "Approve & Execute" button is disabled or absent

### S5: Blocked Dangerous Command (Denylist)
1. Enter `rm -rf /`
2. Verify classifier shows "Blocked" risk badge
3. Verify reason explains the command matches dangerous pattern
4. Enter a command with shell metacharacters (e.g., `pnpm typecheck && echo hijack`)
5. Verify command is blocked due to shell metachar detection

### S6: Approval Token Lifecycle
1. Enter an allowlisted command (e.g., `pnpm typecheck`)
2. Verify approval token is issued (visible in proposal details)
3. Execute the command
4. Verify token is consumed (no longer valid)
5. Attempt to replay the same proposal -> verify rejected with "Token expired/consumed"
6. Close and reopen session -> verify no token replay possible

### S7: Build Loop Command Templates
1. Open Composer
2. Type a message indicating intent to typecheck (e.g., "check types")
3. Verify Composer suggests a command card for `pnpm typecheck`
4. Click the card -> verify Terminal panel opens with proposal pre-filled
5. Repeat for lint, test, web:build, git status, git diff intents

### S8: Real Watcher Dirty/Diff Flow
1. Start native dev with `UAGENT_ENABLE_REAL_WATCHER=1`
2. Open Inspector -> File Watcher panel and verify capability shows enabled/native, trusted root required, debounce 500ms, queue limit 10,000, overflow warn, read-diff only
3. Verify a trusted project root is active
4. Click "Start Watching" -> verify watcher status is "active" and shows only a redacted root/root id
5. Modify a file in the project root (for example, edit a non-generated source file)
6. Verify queued count becomes greater than 0 and "Not dirty" updates to "Dirty" after debounce/session refresh
7. Click "Read Diff" -> verify diff summary shows root-relative entries and redacted display paths only
8. Verify dirty returns to "Not dirty" and queued count returns to 0 after native diff events are drained
9. Click "Read Diff" again -> verify diff is empty
10. Verify overflow/backpressure status is visible for large queued changes
11. Stop watcher -> verify no further events, session state is "stopped"

### S9: Local Browser Preview
1. Start native dev with `UAGENT_ENABLE_REAL_BROWSER=1`
2. Open Inspector -> Browser panel and verify capability shows enabled/native with localhost/127.0.0.1/trusted output file allowed, external blocked
3. Enter `http://localhost:5173` (Vite dev server URL)
4. Verify URL is allowed and preview loads (native Tauri WebviewWindow)
5. Enter `http://127.0.0.1:5173`
6. Verify URL is allowed and preview loads
7. Create or choose a real output HTML file under the active trusted project/output root
8. Enter that file's `file://` URL
9. Verify the file is allowed only when the trusted root is passed to native classification/open, and the UI displays `[local file] <filename>` without raw absolute path
10. Enter a `file://` URL outside the trusted project/output root
11. Verify it is blocked before native navigation with an outside-root/trusted-root reason
12. Enter `https://example.com`
13. Verify URL is blocked by policy (external URL denied)
14. Enter a LAN/private host such as `http://192.168.1.10`, an IPv6 loopback URL `http://[::1]:5173`, a userinfo trick such as `http://example.com@localhost:5173`, and a malformed URL
15. Verify all are blocked and no preview window opens
16. Trigger or simulate a localhost page redirect/navigation to `https://example.com`
17. Verify native navigation is denied by the redirect guard; if platform behavior cannot be confirmed, keep G8 PARTIAL/BLOCKED
18. Verify audit/session/replay events show only `targetId` and redacted `displayTarget`, never raw `file://`, raw cwd/home, or absolute paths

### S10: Session Replay Safety
1. Execute a terminal command with approval
2. Open Session History panel
3. Replay the session that had real terminal execution
4. Verify replay shows execution events but does NOT re-execute the command
5. Verify no new terminal output, watcher events, or browser navigation appear

### S11: Timeout and Cancel
1. Enter an allowlisted long-running verification command such as `pnpm test`
2. Verify timeout countdown is displayed (default timeout)
3. In a controlled test build, lower the timeout and verify the process is killed on timeout
4. Enter another allowlisted command such as `git status`
5. Click "Cancel" during execution
6. Verify process is terminated and status shows "Cancelled"

### S12: Output Redaction
1. Execute an allowlisted command such as `git status`
2. Verify the Terminal panel output displays only redacted/relative project-safe content
3. Verify audit/session events contain only redacted output summaries
4. Confirm simulated secret/path redaction remains covered by native/runtime automated tests rather than ad-hoc shell commands

### S13: Feature Gate Isolation
1. Toggle `TERMINAL_REAL_ENABLED` OFF
2. Verify terminal execution fails with "Feature disabled" message
3. Restart without `UAGENT_ENABLE_REAL_WATCHER=1`
4. Verify watcher start fails with "Feature disabled" message
5. Toggle `BROWSER_REAL_ENABLED` OFF
6. Verify browser preview fails with "Feature disabled" message
7. Toggle all gates back to ON
8. Verify all capabilities function again

## Expected Results

- S0-S14 all pass without errors
- No console.error or uncaught exceptions
- All red lines preserved
- Feature gates correctly disable/enable real capabilities
- Approval tokens prevent replay and unauthorized execution
- Output redaction prevents secret and path leakage
- No orphan processes remain after timeout/cancel
