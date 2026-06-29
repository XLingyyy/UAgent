# MVP10 Risk Register

## Risk Table

Current checkpoint status: G12 final acceptance verification passed on 2026-06-29 with 0 blocked side-effect scan findings. Remaining notes below describe ongoing maintenance/platform risk, not an active MVP10 acceptance blocker.

| ID | Risk | Probability | Impact | Mitigation | Status |
|----|------|-------------|--------|------------|--------|
| R01 | Arbitrary command execution via terminal | Low | Critical | Strict allowlist (exact match only); denylist blocks dangerous patterns; no-shell wrapper (args array, never shell string); approval token required per execution; feature gate default OFF | Mitigated |
| R02 | Shell injection via command arguments | Low | Critical | No-shell wrapper executes commands directly via `std::process::Command` with args array; no `cmd.exe`, `powershell.exe`, `/bin/sh`, or `/bin/bash` spawning | Mitigated |
| R03 | CWD escape via path traversal in command args | Low | High | Classifier boundary checks reject sibling-prefix cwd escapes; native real execution canonicalizes cwd and rejects paths outside the current project process root; Composer/TerminalPanel pass canonical `rootRef` to native while UI displays only redacted cwd. | Mitigated |
| R04 | Secret leakage in terminal output | Medium | High | Output redaction applied to all stdout/stderr streams; pattern-based secret detection (API keys, tokens, credentials); home path redaction; audit confirms redacted output only | Mitigated |
| R05 | Orphan processes after timeout or cancel | Medium | High | Rust timeout kills the spawned process. Process-group cleanup and UI-driven cancel integration are not fully implemented. | Partially mitigated |
| R06 | Watcher uncontrolled rescan consuming resources | Low | Medium | Watcher is default-off behind `UAGENT_ENABLE_REAL_WATCHER=1`, produces dirty/queued state + diff only; read-diff is user-initiated via explicit "Read Diff" action; native debounce coalesces events by path+kind; max queue size (10,000 events) with overflow/backpressure warning; no auto-rescan or file write/apply in product path | Mitigated |
| R07 | Browser external URL or file path policy bypass | Low | High | URL classifier uses structured host/scheme parsing and allows only `localhost` / `127.0.0.1`; `[::1]`, LAN/private hosts, DNS aliases, hostname/userinfo tricks, malformed URLs, external hosts, and unknown schemes are blocked. `file://` requires an explicit trusted root, canonical root and target comparison, existing local file, and native open revalidation. Native `open_browser_preview` is async, explicitly navigates the created WebviewWindow to the allowed target, and registers an `on_navigation` guard to block redirects/subsequent navigation that do not re-classify as allowed while permitting WebView bootstrap `about:blank`. Runtime adds a native-open timeout so BrowserPanel reaches failed on non-settling native invoke. Audit/session/replay store `targetId` and redacted `displayTarget` only; replay does not invoke native open. | Mitigated |
| R08 | Feature gate bypass via direct Tauri command invocation | Low | Critical | Real terminal and watcher Tauri commands share their capability status gates with the executing start/proposal paths; commands return "feature disabled" when gates are OFF; side-effect scan verifies no bypass paths. `issue_approval_token` is not a public command, and `approve_terminal_proposal` now looks up an existing pending native proposal before issuing a bound token. | Mitigated |
| R17 | Raw watcher root/cwd/home path leakage in audit/session/evidence | Low | High | Watcher lifecycle records store redacted display root and opaque root id only. Runtime sanitizes native adapter session data before state/audit/session recording, and tests serialize watcher state/audit/replay to assert raw `C:/Users`, `/Users`, `/home`, and raw root strings are absent. | Mitigated |
| R13 | Approval token minting bypass via raw Tauri command | Low | Critical | `issue_approval_token` is no longer a public Tauri command. Token issuance is bound to a native proposal registry: proposal creation stores exact allowlisted command + canonical contained cwd + project id + expiry; approval accepts only the proposal id and approval metadata; execute validates token + proposal + command + cwd and consumes both after use. | Mitigated |
| R09 | Provider live default network access | Low | Medium | Provider live remains manual opt-in; no change from MVP4+ behavior; side-effect scan verifies no new live network paths | Mitigated |
| R10 | Approval token replay on session replay | Low | Critical | Approval tokens are one-time and consumed on execution; session replay replays recorded events only; adapters not invoked during replay; token state not serialized to session | Mitigated |
| R11 | Dangerous command variant bypasses allowlist | Medium | High | Allowlist is exact match on normalized command (no flags/args); denylist catches dangerous patterns in args (rm, del, format, >, |, ;, &&, `); mutation detection flags modified known commands | Mitigated |
| R12 | Env variable leakage to subprocess | Medium | Medium | Env sanitization strips sensitive variables (PATH overrides, proxy settings, credential vars) before command execution; allowlist of safe env vars only | Mitigated |
| R14 | UI flow bypass: Composer or TerminalPanel calling Tauri invoke directly | Low | Critical | Registry bypass remains closed: all MVP10 terminal actions go through runtime store actions -> DesktopRuntimeAdapter -> Mvp9RuntimeService.mvp10 -> Mvp10RuntimeService -> RealTerminalService -> native adapter. No React component imports @tauri-apps/api, node:fs, node:path, or child_process. Side-effect scan enforces this boundary. | Mitigated |
| R15 | UI flow bypass: Replayable execution path in session history | Low | Critical | Session replay returns recorded terminal lifecycle state from redacted session/evidence metadata and does not call native proposal, approval, or execution commands. Remaining risk is replay UI fidelity, not native re-execution. | Mitigated |
| R16 | Unredacted cwd or secret in TerminalPanel UI | Low | High | TerminalPanel reads redacted cwd from the runtime proposal; canonical cwd and raw token stay private to the native adapter. Command output is redacted via native redaction before reaching UI/evidence/session. Remaining risk is manual redaction smoke coverage. | Mitigated |

## Out of Scope (Non-Goals)

- UE Editor writes (future MVP)
- Mutating MCP tools (future MVP)
- Arbitrary shell execution (`cmd.exe`, `powershell.exe`, `/bin/sh`, `/bin/bash`)
- External browser automation / navigation
- Real screenshot capture
- Automatic watcher rescan
- Automatic code fixes
- Dependency installation

## Testing Coverage

- Terminal classifier: unit tests for allowlist (exact match, normalized), denylist (dangerous patterns, shell metachars), mutation detection
- Real terminal adapter: targeted Rust tests for proposal registry lookup, missing proposal rejection, non-allowlisted proposal rejection, command/cwd mismatch blocking, wrong proposal id blocking, token use-once, expired proposal/token rejection, and duplicate approval replay blocking
- Approval token: unit tests for lifecycle (issue -> consume -> expire -> reject replay)
- Build loop templates: unit tests for each template (typecheck, lint, test, web:build, cargo test, git status/diff/diff --check)
- Watcher: real FS watcher implemented with Rust unit tests and lib integration tests; native capability status, dirty/queued refresh, diff-error surfacing, audit/session/replay redaction, and WatcherPanel queued-count display are covered by targeted runtime/desktop tests
- Browser preview: URL classification uses structured host/scheme parsing (browser module + lib integration tests for local/blocked/file/LAN/capability paths); capability status (`browser_capability_status`) created; native `browser_preview` and `open_browser_preview` enforce trusted `file://` containment; native `open_browser_preview` creates a Tauri WebviewWindow with `on_navigation` redirect guard and allows bootstrap `about:blank`; web runtime creates `BrowserNativeAdapter` for native classification and preview using camelCase Tauri payloads; UI shows capability status, requested target, classification, blocked reason, preview status, and last error; audit/session/replay store redacted target summaries; replay does not navigate
- G9 UI integration: TerminalPanel shows MVP10 state (proposal id, risk, cwd, expiry, output chunks, exit code, duration, redaction summary); Composer detects terminal intent and shows command suggestion cards (allowlisted/blocked); Settings/Config shows Terminal Execution status section; Mvp10RuntimeService wraps RealTerminalService with audit/session recording
- Side-effect scan: MVP10 categories with 0 blocked findings expected
- Scenario matrix: MVP10 matrix covers 89 runtime scenario tests plus package/UI/native regression tests; final manual smoke matrix documents Browser Launch Preview, redirect guard, and replay no-navigation evidence

## Residual Risk

- Real terminal adapter requires OS-specific testing on Windows, macOS, and Linux; platform-specific edge cases may emerge
- Allowlist/denylist maintenance burden as new commands are added over time
- Timeout values may need tuning per project size (large projects may exceed default timeouts for build/test)
- Side-effect scan review findings are tracked and will be resolved iteratively
- Real watcher native tests pass with `UAGENT_ENABLE_REAL_WATCHER=1`, but Inspector watcher dirty/queued/diff UI still needs OS-level manual confirmation on each supported platform
- Browser native smoke now passes on the current Windows/WebView2 environment, but OS-specific WebView behavior should still be rechecked on macOS/Linux when those platforms are added to the support matrix
- Current automation can operate the main Tauri window through WebView2 CDP. The G12 implementation checkpoint is complete and has passed supervisor workflow review.
