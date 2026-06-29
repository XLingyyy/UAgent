# MVP10 Acceptance

## Gate Summary

| Gate | Description | Status | Evidence Notes | Blocking Issues |
|------|-------------|--------|----------------|-----------------|
| G0 | MVP9 final verification / handoff | COMPLETE | MVP9 final verification doc verified, side-effect scan and baseline pass | None |
| G1 | MVP10 docs / roadmap / branch baseline | COMPLETE | mvp10-prep.md, mvp10-acceptance.md, mvp10-risk-register.md, mvp10-manual-smoke.md created; roadmap updated; README updated | None |
| G2 | Shared contracts and policy | COMPLETE | Approval token types, build loop types, terminal classifier policy contracts added; TaskEventType/EvidenceKind extended | None |
| G3 | Terminal classifier hardening | COMPLETE | No-shell parser implemented (77 tests), 12-entry exact allowlist, denylist with dangerous patterns, env sanitization, mutation detection, shell metachar blocking | None |
| G4 | Native real terminal adapter | COMPLETE | Rust `Command` adapter is feature-gated and enforces exact allowlist, contained canonical cwd, native proposal registry lookup, project id/root binding, proposal expiry, token use-once, timeout/kill, and redacted output. UI receives redacted cwd while the native adapter keeps canonical cwd private for execution. | None |
| G5 | Runtime approval-bound execution | COMPLETE | Runtime MVP10 terminal flow now routes through DesktopRuntimeAdapter -> native Tauri `propose_terminal_command` -> `approve_terminal_proposal` -> `execute_terminal_command_real`. Approval issues a native one-time token, execution consumes it, and session replay uses recorded events without native re-execution. | None |
| G6 | Build/test/lint command templates | COMPLETE | 12 command templates with risk classification, findBuildTemplate, createBuildRun, acceptance checklist (18 tests) | None |
| G7 | Real watcher dirty/diff flow | COMPLETE | Real watcher is default-off and reports native capability through `watcher_capability_status`, using the same `UAGENT_ENABLE_REAL_WATCHER=1` / trusted-root gate as `start_watcher`. Native watcher uses `notify` crate (v6), produces root-relative and redacted display paths, debounces events by path+kind, enforces max queue size (10,000) with overflow/backpressure warning, and provides start/stop/read-diff/get-session Tauri commands. Web runtime refreshes native session state so WatcherPanel shows actual dirty state and queued count before diff read; `Read Diff` drains native events and clears dirty/queue only after native state confirms drain. Audit/session/replay payloads store display root/root id only, never raw root/cwd/home/absolute paths. Native read-diff failures surface as blocked/error state. Replay remains read-only and does not invoke native watchers. | None |
| G8 | Local browser preview | COMPLETE | Browser Launch Preview rework fixed the Windows/Tauri synchronous WebviewWindow creation hang by making `open_browser_preview` async, explicitly navigating the created window to the already-classified target, and adding a runtime timeout so BrowserPanel reaches `failed` instead of staying `active` if native open does not settle. Native smoke with `UAGENT_ENABLE_REAL_BROWSER=1` and WebView2 CDP verified `http://localhost:5173` and `http://127.0.0.1:5173` open real preview targets and BrowserPanel reaches `completed`; trusted in-root `file://` opens with `[local file] report.html` display; outside-root file, external/private/[::1]/userinfo/malformed URLs block before launch; and CDP external navigation to `https://example.com/` returns `net::ERR_ABORTED` while the preview target remains local. Runtime replay returns recorded browser completion without invoking native `openPreview` again. | None |
| G9 | UI/settings integration | COMPLETE | Composer creates MVP10 native terminal proposals for allowlisted build/test/lint/typecheck intent and never executes directly. TerminalPanel shows native proposal id, command, redacted cwd, risk, expiry, status, stdout/stderr chunks, exit code, duration, and redaction summary; approval executes through the native one-time token flow. Settings/Config shows read-only terminal capability status. Audit/session/evidence record native lifecycle metadata and redacted output; replay does not invoke native commands. | None |
| G10 | Security regression | COMPLETE | 2026-06-29 final automated regression passed: typecheck, lint, test, package-filtered tests, desktop web build, side-effect scan, diff check, cargo check, and cargo test all completed successfully after a narrow runtime test lint fix. Latest G12 side-effect scan remains 0 blocked / 137 review findings. Review findings are triaged by category in the section below. All findings are in docs/tests/policy code, runtime service boundaries, or native adapter tests, not direct product UI execution paths. | None |
| G11 | Scenario matrix and manual smoke | COMPLETE | Scenario matrix remains covered by automated tests, including 89 MVP10 scenario tests in runtime after adding native browser timeout/replay coverage. Native UI smoke directly operated the Tauri window through WebView2 CDP: TerminalPanel and WatcherPanel results from the prior native smoke remain accepted; BrowserPanel now completes Launch Preview for localhost/127.0.0.1, blocks required disallowed targets, opens trusted file preview through native invoke with redacted display, and rejects external navigation by guard. Token replay has no exposed UI path and remains covered by automated Rust/runtime replay tests. | None |
| G12 | Final acceptance / MVP11 handoff | COMPLETE | 2026-06-29 G12 checkpoint repeated the required final verification commands successfully, confirmed G7/G8/G9/G10/G11 are complete, reviewed targeted MVP10 diffs and boundary rules, reconciled current status docs, and passed supervisor checkpoint review. | None |

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
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1
```

## Gate Resolution Plan

| Gate | Status | Action |
|------|--------|--------|
| G7 | COMPLETE | Real `notify`-based watcher implemented behind `UAGENT_ENABLE_REAL_WATCHER=1`: capability status, start/stop/read-diff/get-session native commands, debounce, backpressure/overflow limits, redacted/root-relative paths, dirty/queued UI, visible diff errors, and redacted audit/session/replay. |
| G8 | COMPLETE | Browser preview behind `UAGENT_ENABLE_REAL_BROWSER=1` now passes native launch smoke: localhost/127.0.0.1 preview windows navigate and BrowserPanel reaches completed, trusted file preview uses redacted display, outside-root/disallowed targets block before launch, external redirect/navigation is denied by guard, and replay does not navigate. |
| G9 | COMPLETE | Native product path integrated through Composer, TerminalPanel, Settings, audit/session/evidence, and replay. Real execution remains default-off and is enabled locally with `UAGENT_ENABLE_REAL_TERMINAL=1` for native smoke. |

## Final Verification Evidence - 2026-06-29

Automated regression:

| Command | Result | Evidence summary |
|---------|--------|------------------|
| `pnpm typecheck` | PASS | 4 workspace projects typechecked |
| `pnpm lint` | PASS | Initial run found one unused mock parameter in a runtime test; after a narrow test-only fix, ESLint passed |
| `pnpm test` | PASS | shared 15, mcp-client 44, runtime 678, desktop 584 tests passed |
| `pnpm --filter @uagent/shared test` | PASS | 2 files / 15 tests passed |
| `pnpm --filter @uagent/runtime test` | PASS | 47 files / 678 tests passed |
| `pnpm --filter @uagent/mcp-client test` | PASS | 7 files / 44 tests passed |
| `pnpm --filter @uagent/desktop test` | PASS | 31 files / 584 tests passed |
| `pnpm --filter @uagent/desktop web:build` | PASS | Vite build completed, 222 modules transformed |
| `node scripts/side-effect-scan.mjs` | PASS | 226 files scanned, 0 blocked, 137 review |
| `git diff --check` | PASS | No whitespace errors; Git reported LF/CRLF warnings only |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS | Rust dev profile check completed |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1` | PASS | 66 Rust tests passed |

Additional smoke evidence:

| Area | Result | Evidence summary |
|------|--------|------------------|
| `UAGENT_ENABLE_REAL_TERMINAL=1` targeted native test | PASS | Allowlisted real terminal execution test passed and token replay remained covered by the full Rust suite |
| `UAGENT_ENABLE_REAL_WATCHER=1` targeted native tests | PASS | 13 watcher native tests passed, including real diff and start/stop temp-dir flow |
| `UAGENT_ENABLE_REAL_BROWSER=1` targeted native tests | PASS | 27 browser policy tests passed, including localhost/127.0.0.1 allow, trusted file redaction, outside-root file block, external/LAN/[::1]/userinfo/malformed URL blocking |
| Vite `http://localhost:5173` / `http://127.0.0.1:5173` web load | PASS | Playwright loaded both URLs and reported 0 console errors |
| Tauri native dev default-off and gate-on startup | PASS | `pnpm --filter @uagent/desktop dev` launched `uagent.exe` and WebView2 in both default-off and gate-on runs |
| Interactive Tauri native manual smoke | PASS | WebView2 CDP operated the native Tauri window. TerminalPanel and WatcherPanel manual UI paths passed in prior smoke. BrowserPanel policy UI passed, and Browser Launch Preview rework now opens/navigates localhost/127.0.0.1 native preview targets, completes BrowserPanel state, blocks external navigation by guard, and preserves replay no-navigation through automated runtime coverage. |

Final gate status from this run:

- G8: COMPLETE
- G10: COMPLETE
- G11: COMPLETE
- G12: COMPLETE

## G12 Final Acceptance Checkpoint - 2026-06-29 20:43 +08:00

Current gate status:

- G7: COMPLETE
- G8: COMPLETE
- G9: COMPLETE
- G10: COMPLETE
- G11: COMPLETE
- G12: COMPLETE

Fresh verification:

| Command | Result | Evidence summary |
|---------|--------|------------------|
| `pnpm typecheck` | PASS | 4 workspace projects typechecked |
| `pnpm lint` | PASS | ESLint completed with no findings |
| `pnpm test` | PASS | shared 15, mcp-client 44, runtime 678, desktop 584 tests passed |
| `pnpm --filter @uagent/desktop web:build` | PASS | Vite build completed, 222 modules transformed |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS | Rust dev profile check completed |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1` | PASS | 66 Rust tests passed |
| `node scripts/side-effect-scan.mjs` | PASS | 226 files scanned, 0 blocked, 137 review |
| `git diff --check` | PASS | No whitespace errors; Git reported LF/CRLF warnings only |

Boundary review:

- Terminal execution remains proposal + native approval-token registry + one-time token execution. UI displays token status only, not raw token values, and Composer/TerminalPanel do not execute directly.
- Watcher remains feature-gated, trusted-root-only, read-diff-only, and exposes dirty/queued state without auto-rescan, command execution, or file writes.
- Browser preview remains feature-gated and limited to localhost, 127.0.0.1, and trusted in-root `file://` targets; external/private/LAN/[::1]/userinfo/malformed targets remain blocked and native navigation guard remains active.
- Session replay records terminal/watcher/browser state from session events and stored snapshots without re-executing terminal commands, reopening watcher sessions, or navigating browser preview.
- Audit/session/evidence payloads use redacted cwd/display root/display target/output summaries rather than raw cwd/home paths, raw file URLs, secrets, or raw terminal output.

## Side-effect Scan Review Findings (137 total, 0 blocked)

The side-effect scan reports 137 review findings. These are patterns that may appear concerning but are not in blocked UI/runtime zones. Grouped triage:

| Category | Count | Explanation |
|----------|-------|-------------|
| MCP Tool Calls | 2 | Found in docs and runtime test code referencing MCP tool/resource methods |
| UE Write / Mutating | 14 | Found in docs mentioning save/compile/apply, and in policy code defining block rules |
| React Direct Provider Access | 25 | Found in test files and runtime adapter code; not in product UI components |
| MVP7 Capability Bridge Boundary | 2 | Found in mvp10-scenarios.ts testing command classifier blocking |
| MVP9 Raw Output Boundary | 1 | Found in mvp10-scenarios.ts testing env sanitization |
| MVP8 Real Scan Boundary | 2 | Found in mvp10-scenarios.ts testing denylist blocking |
| MVP10 Real Terminal Exec Boundary | 9 | Found in runtime policy, native adapter, and service code defining allowed command patterns |
| MVP10 Approval Token Boundary | 56 | Found in runtime approval token service, native proposal-registry tests, UI/native adapter tests, scenario test files, and current acceptance/status documentation |
| MVP10 Build Loop Boundary | 26 | Found in build templates and scenario test files |

All review findings are in docs, tests, policy code, or runtime services — not in product UI code. No allowWhen rules were widened to suppress real UI side effects.

## Gate Resolution Plan

1. No write command registered in Tauri bridge (native or otherwise)
2. No raw absolute path or raw secret in UI state, DOM, audit, session replay, evidence, or test snapshots
3. React UI must not directly import `@tauri-apps/api`, `node:fs`, `node:path`, `child_process`
4. All real capabilities default disabled behind feature gates
5. Terminal execution must use no-shell wrapper (args array, never shell string)
6. Allowlist must be exact match; denylist must block dangerous patterns
7. Approval tokens are one-time; no re-execution on session replay
8. Real terminal adapter must enforce timeout/kill/cleanup to prevent orphan processes
9. Output redaction must apply to all real terminal stdout/stderr
10. Watcher must not auto-rescan or trigger side effects
11. Browser preview must block all external URLs by default and allow `file://` only inside a canonical approved trusted root
12. Side-effect scan must report 0 blocked findings before final PASS
13. Provider live must remain manual opt-in
14. UE write, mutating MCP, arbitrary shell remain non-goals
