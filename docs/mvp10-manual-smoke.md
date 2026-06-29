# MVP10 Manual Smoke Test

## Current Status - 2026-06-29 20:43 +08:00

Latest status after G12 final acceptance checkpoint:

- G7 real watcher: COMPLETE
- G8 local browser preview: COMPLETE
- G9 real terminal UI/settings/composer flow: COMPLETE
- G10 security regression: COMPLETE
- G11 native UI manual smoke: COMPLETE
- G12 final acceptance checkpoint: COMPLETE after supervisor workflow review

Historical execution records below are preserved as written; earlier PARTIAL/BLOCKED rows describe the state at the time of those smoke runs, not the current MVP10 status.

## Prerequisites

- `pnpm install` completed
- `pnpm --filter @uagent/desktop dev` running for default-off native status checks
- `UAGENT_ENABLE_REAL_TERMINAL=1 pnpm --filter @uagent/desktop dev` (PowerShell: `$env:UAGENT_ENABLE_REAL_TERMINAL="1"; pnpm --filter @uagent/desktop dev`) for the controlled real terminal happy-path smoke
- `UAGENT_ENABLE_REAL_WATCHER=1 pnpm --filter @uagent/desktop dev` (PowerShell: `$env:UAGENT_ENABLE_REAL_WATCHER="1"; pnpm --filter @uagent/desktop dev`) for the controlled real watcher happy-path smoke
- `UAGENT_ENABLE_REAL_BROWSER=1 pnpm --filter @uagent/desktop dev` (PowerShell: `$env:UAGENT_ENABLE_REAL_BROWSER="1"; pnpm --filter @uagent/desktop dev`) for the controlled real browser preview happy-path smoke
- All feature gates default OFF unless explicitly toggled

## Smoke Steps

### S0: Preflight Baseline
1. Verify MVP9 acceptance gates all show COMPLETE
2. Run `pnpm typecheck && pnpm lint && pnpm test`
3. Verify all existing tests pass before any MVP10 changes
4. Run `git status` to confirm clean baseline

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

### S14: Full Regression
1. Verify all existing MVP5-MVP9 behaviors still work:
   - Project scan and file preview
   - Session history and replay (non-execution)
   - Audit log with all event types
   - Side-effect scan reports 0 blocked findings
2. Verify no console errors in dev tools
3. Run `pnpm typecheck && pnpm lint && pnpm test` and confirm all pass
4. Run `node scripts/side-effect-scan.mjs` and verify 0 blocked findings

## Execution Record - 2026-06-29 Browser Launch Rework Smoke

Environment notes:

- Native dev was started from `G:\UAgent` with `UAGENT_ENABLE_REAL_BROWSER=1` and WebView2 remote debugging on port 9222.
- A local static server was started on `http://127.0.0.1:5173` and exercised through both `http://localhost:5173` and `http://127.0.0.1:5173`.
- BrowserPanel was operated inside the native Tauri window through WebView2 CDP.
- A temporary trusted project root under `%TEMP%` with `Smoke.uproject` and `Saved/Automation/report.html` was created for trusted-file native smoke and removed after the run.

Root cause fixed:

- `open_browser_preview` used synchronous Tauri `WebviewWindowBuilder::new(...).build()` from a command. Tauri documents this as a Windows/WebView2 deadlock risk. The command could create an initial CDP-visible `about:blank` target while the invoke promise never resolved, leaving BrowserPanel permanently `active`.
- The fix makes `open_browser_preview` an async command, explicitly calls `window.navigate()` to the already policy-approved URL after window creation, and adds a runtime native-open timeout so the UI reaches `failed` with `Native preview launch timed out` if native invoke does not settle.

### Browser Rework Result Matrix

| Path | Result | Evidence |
|------|--------|----------|
| `http://localhost:5173` Launch Preview | PASS | BrowserPanel showed `Requested:http://localhost:5173`, `Classification:local_only`, `Preview status:completed`, and a redacted native artifact label. CDP targets included `http://localhost:5173/`, not a stuck `about:blank`. |
| `http://127.0.0.1:5173` Launch Preview | PASS | BrowserPanel showed `Requested:http://127.0.0.1:5173`, `Classification:local_only`, `Preview status:completed`. CDP targets included `http://127.0.0.1:5173/`. |
| Trusted in-root `file://` | PASS | Native invoke trusted the temp root, `browser_preview` returned `displayUrl:"[local file] report.html"` with `blocked:false`, and `open_browser_preview` opened a preview target titled `Trusted File Smoke`. The preview result did not expose the raw file URL. |
| Outside-root `file://` | PASS | BrowserPanel blocked before launch with `file:// preview requires trusted root`; Launch Preview was not visible. Native Rust tests also cover explicit outside-approved-root rejection. |
| External/private/[::1]/userinfo/malformed | PASS | BrowserPanel blocked all tested targets before launch and did not show Launch Preview. Reasons included external URL, private network host, userinfo blocked, and malformed/no-scheme. |
| External redirect/navigation guard | PASS | CDP `Page.navigate` from the allowed preview target to `https://example.com/` returned `net::ERR_ABORTED`; the target remained on `http://127.0.0.1:5173/`. |
| Browser replay no-navigation | PASS | Runtime test covers native browser replay after completion without a second `openPreview` call; replay returns recorded completed state with no session/artifact reopening. |
| Token replay UI path | N/A | No exposed BrowserPanel token replay path. Terminal token replay remains covered by automated Rust/runtime tests. |

Final gate status from this rework:

- G8: COMPLETE
- G10: COMPLETE
- G11: COMPLETE
- G12: BLOCKED (supervisor final acceptance still required; this task does not mark G12 complete or unblocked)

## Execution Record - 2026-06-29 Final Smoke/Regression

Environment notes:

- Automated regression commands were run from the project root on Windows.
- Vite was started on port 5173 for browser URL checks; Playwright loaded both `http://localhost:5173` and `http://127.0.0.1:5173` with 0 console errors.
- Tauri native dev was started once with default gates and once with `UAGENT_ENABLE_REAL_TERMINAL=1`, `UAGENT_ENABLE_REAL_WATCHER=1`, and `UAGENT_ENABLE_REAL_BROWSER=1`; both runs launched the native app and WebView2.
- Current automation could start native Tauri dev but could not reliably operate or inspect the native WebviewWindow. Native-only UI steps that require clicking approval buttons, opening preview windows, checking redirect guard behavior, or replaying sessions in the desktop window are marked NOT-RUN with that limitation.
- Additional targeted native tests were run with each real gate enabled to cover core native policy behavior.

### Result Matrix

| Smoke | Result | Evidence |
|-------|--------|----------|
| S0 Preflight Baseline | PASS | MVP9 gates remain documented COMPLETE in acceptance; `pnpm typecheck`, `pnpm lint`, and `pnpm test` passed after one narrow test lint fix; `git diff --check` passed with LF/CRLF warnings only. Baseline was not clean because this workspace already contains in-progress MVP10 changes from prior tasks. |
| S1 Feature Gate Defaults | PARTIAL | Web UI Settings -> Config showed Terminal Execution disabled/fixture mode and trusted root not configured; Terminal panel showed "Real terminal execution is disabled"; Browser panel showed capability disabled. Watcher default-off UI was not separately operated in native Tauri. |
| S2 Enable Terminal Feature Gate | PARTIAL | Gate-on native dev launched with `UAGENT_ENABLE_REAL_TERMINAL=1`; targeted native terminal real-execution test passed. TerminalPanel enabled state inside the native window was not directly inspected. |
| S3 Allowlisted Command Execution | PARTIAL | `UAGENT_ENABLE_REAL_TERMINAL=1` targeted Rust test `issued_token_allows_one_allowlisted_real_execution` passed. UI proposal approval flow for `pnpm typecheck` was NOT-RUN in the native window. |
| S4 Blocked Command (Not in Allowlist) | PARTIAL | Full Rust suite covered non-allowlisted blocking; UI blocked badge/button state for `node --eval ...` was NOT-RUN in the native window. |
| S5 Blocked Dangerous Command (Denylist) | PARTIAL | Full Rust/runtime suites covered dangerous command and shell metachar blocking; UI checks for `rm -rf /` and command chaining were NOT-RUN in the native window. |
| S6 Approval Token Lifecycle | PARTIAL | Full Rust suite passed token binding, one-time use, expiry, wrong proposal, duplicate approval, and replay rejection tests. UI replay attempt was NOT-RUN in the native window. |
| S7 Build Loop Command Templates | PARTIAL | `pnpm --filter @uagent/runtime test` passed build template tests; Composer UI command-card flow was not manually clicked for every intent in native Tauri. |
| S8 Real Watcher Dirty/Diff Flow | PARTIAL | `UAGENT_ENABLE_REAL_WATCHER=1` targeted native watcher tests passed 13 tests, including real diff and start/stop temp-dir flow. Inspector watcher UI dirty/queued/diff/overflow flow was NOT-RUN in the native window. |
| S9 Local Browser Preview | PARTIAL | `UAGENT_ENABLE_REAL_BROWSER=1` targeted native browser tests passed 27 tests covering localhost/127.0.0.1 allow, trusted file redaction, outside-root file block, external/LAN/[::1]/userinfo/malformed URL blocking. Playwright loaded `http://localhost:5173` and `http://127.0.0.1:5173` in a real browser. Native Tauri preview window open, trusted output file open, outside-root block before navigation, external redirect guard, and replay no-navigation were NOT-RUN in the native window. |
| S10 Session Replay Safety | PARTIAL | Automated runtime/Rust tests cover replay as recorded events without native re-execution/navigation. Manual Session History replay in native UI was NOT-RUN. |
| S11 Timeout and Cancel | PARTIAL | Rust full suite covers timeout/kill behavior; native UI countdown/cancel operation was NOT-RUN. |
| S12 Output Redaction | PARTIAL | Automated runtime/Rust tests cover redacted terminal output and browser/watcher path redaction; web UI did not show raw local file targets. Manual terminal output inspection from native execution was NOT-RUN. |
| S13 Feature Gate Isolation | PARTIAL | Web/default-off UI showed disabled terminal/browser states. Targeted native tests with gates enabled passed. Manual toggling OFF/ON and direct native UI failure messages were NOT-RUN. |
| S14 Full Regression | PASS | Required automated regression passed; side-effect scan returned 0 blocked / 134 review; Playwright console check returned 0 errors for the 5173 web page. |

### Browser G8 Detail

| Required Browser Path | Result | Evidence |
|-----------------------|--------|----------|
| `http://localhost:5173` allowed and previewed | PARTIAL | Native policy test allows localhost; Playwright loaded the URL. Native preview window operation was NOT-RUN. |
| `http://127.0.0.1:5173` allowed and previewed | PARTIAL | Native policy test allows loopback; Playwright loaded the URL. Native preview window operation was NOT-RUN. |
| Trusted output file under active project/output root allowed and redacted | PARTIAL | Native browser tests passed trusted file allow/redacted display. Native UI active-project file preview was NOT-RUN. |
| `file://` outside trusted root blocked before navigation | PARTIAL | Native browser tests passed outside-root file blocking. Native UI pre-navigation confirmation was NOT-RUN. |
| External, LAN/private, `[::1]`, userinfo, malformed URLs blocked | PARTIAL | Native browser tests passed these blocked classifications. Native UI entry checks were NOT-RUN. |
| Redirect/navigation to external URL blocked by native guard | NOT-RUN | Code path is covered by native implementation structure, but platform WebviewWindow behavior was not directly operated/observed in this run. |
| Session replay shows recorded preview state only and does not navigate | PARTIAL | Runtime tests cover replay no-navigation behavior; manual native replay was NOT-RUN. |

## Execution Record - 2026-06-29 Native UI Manual Smoke

Environment notes:

- Native launch matrix was run on Windows from `G:\UAgent`.
- Individual gate launches succeeded and were cleaned up for:
  - `pnpm --filter @uagent/desktop dev`
  - `$env:UAGENT_ENABLE_REAL_TERMINAL="1"; pnpm --filter @uagent/desktop dev`
  - `$env:UAGENT_ENABLE_REAL_WATCHER="1"; pnpm --filter @uagent/desktop dev`
  - `$env:UAGENT_ENABLE_REAL_BROWSER="1"; pnpm --filter @uagent/desktop dev`
- Combined smoke used `UAGENT_ENABLE_REAL_TERMINAL=1`, `UAGENT_ENABLE_REAL_WATCHER=1`, `UAGENT_ENABLE_REAL_BROWSER=1`, and WebView2 CDP args for DOM inspection.
- A temporary trusted smoke project under the Tauri containment root was created with `Smoke.uproject`, `trusted-preview.html`, and `watcher-probe.md`; it was removed after smoke.
- A temporary localhost server on `http://localhost:5173` was started for browser checks and stopped after smoke.

Fixes made during smoke:

- Native project trust now registers opaque root refs for runtime adapters without serializing raw roots into UI state.
- Browser native adapter now sends camelCase Tauri payload fields (`rootRef`, `taskId`, `sessionId`) so trusted roots reach Rust commands.
- Browser navigation guard now allows WebView bootstrap `about:blank` while still blocking external navigation.

### Native UI Result Matrix

| Area | Result | Evidence |
|------|--------|----------|
| Launch matrix | PASS | All required launch commands created a visible `UAgent` native window; each run was stopped with no UAgent app process left. |
| Settings trusted root setup | PASS | Config page validated and trusted the temporary `.uproject` root; Terminal Execution showed `Enabled · native`, trusted root configured, approval required, one-time token. |
| TerminalPanel allowlisted execution | PASS | `git status` proposal showed pending approval, proposal id, allowlisted risk, redacted cwd `[project-root]/.uagent-smoke-project`, 5m expiry, 60s timeout, and output limits. `Approve & Execute` completed through native token flow with exit code 0, duration 117ms, stdout chunks, and redaction summary. |
| TerminalPanel blocked non-allowlisted command | PASS | `node --eval "console.log('hello')"` rejected in UI with `command_not_allowlisted`; no approval/execute button path remained. |
| TerminalPanel blocked metachar command | PASS with note | `pnpm typecheck && echo hijack` and `git status && echo hijack` were rejected in UI with `command_not_allowlisted`; shell execution did not run. UI did not surface a dedicated `shell_metachar` reason for these full-command variants. |
| Token replay UI path | NOT-RUN | TerminalPanel does not expose a user path to replay a consumed native token. Automated Rust tests cover consumed/expired/wrong-proposal rejection. |
| WatcherPanel dirty/diff | PASS | Files tab showed enabled native watcher policy. Start Watching entered Active. Editing `watcher-probe.md` changed UI to Dirty / Queued changes: 1. Read Diff returned `modified:[project-root]/watcher-probe.md`, then Not dirty / Queued changes: 0. Stop Watching entered Stopped with `user_stopped`. |
| Watcher overflow | NOT-RUN | Overflow/backpressure was not practically triggered during manual smoke. Queue limit and overflow policy remained visible. |
| BrowserPanel localhost preview request | PASS | `http://localhost:5173` and `http://127.0.0.1:5173` classified as `local_only` and entered active preview state. |
| BrowserPanel trusted file request | PASS | Trusted file URL under the temporary root classified as `local_only`, displayed `[local file] trusted-preview.html`, and entered active preview state without exposing raw `file://`. |
| BrowserPanel outside-root file block | PASS | `file:///G:/UAgent/README.md` displayed `[local file] README.md` and blocked with `file:// target is outside trusted root`. |
| BrowserPanel external/private/malformed blocks | PASS | `https://example.com`, `http://192.168.1.1`, `http://[::1]:5173`, `http://example.com@localhost:5173`, and `not a url` all showed blocked UI with clear policy reasons. |
| BrowserPanel Launch Preview / native WebviewWindow | FAIL | Clicking `Launch Preview` for `http://localhost:5173` created a native preview target visible to CDP only as `about:blank`; BrowserPanel stayed `active` and did not record completed/failed artifact state within 6s. |
| Browser redirect guard | NOT-RUN | Not run because native preview window launch did not reach the requested localhost page. |
| Session replay no re-execution/no-navigation | PARTIAL | Runtime/automated coverage remains in place. Manual replay in the native window was not completed in this run because Browser Launch Preview remained blocked and no dedicated token replay path is exposed. |

Final gate status from this run:

- G8: PARTIAL
- G10: COMPLETE
- G11: PARTIAL
- G12: BLOCKED

### Command Evidence Summary

| Command | Result |
|---------|--------|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS after narrow test-only lint fix |
| `pnpm test` | PASS |
| `pnpm --filter @uagent/shared test` | PASS |
| `pnpm --filter @uagent/runtime test` | PASS |
| `pnpm --filter @uagent/mcp-client test` | PASS |
| `pnpm --filter @uagent/desktop test` | PASS |
| `pnpm --filter @uagent/desktop web:build` | PASS |
| `node scripts/side-effect-scan.mjs` | PASS, 0 blocked / 134 review |
| `git diff --check` | PASS, LF/CRLF warnings only |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1` | PASS, 66 tests |
| `UAGENT_ENABLE_REAL_TERMINAL=1 cargo test ... terminal::tests::issued_token_allows_one_allowlisted_real_execution` | PASS |
| `UAGENT_ENABLE_REAL_WATCHER=1 cargo test ... watcher` | PASS, 13 tests |
| `UAGENT_ENABLE_REAL_BROWSER=1 cargo test ... browser` | PASS, 27 tests |

## Expected Results

- S0-S14 all pass without errors
- No console.error or uncaught exceptions
- All red lines preserved
- Feature gates correctly disable/enable real capabilities
- Approval tokens prevent replay and unauthorized execution
- Output redaction prevents secret and path leakage
- No orphan processes remain after timeout/cancel
