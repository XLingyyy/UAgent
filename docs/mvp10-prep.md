# MVP10 Prep

MVP10 moves MVP9's fixture-gated capabilities into controlled real local execution. Current status: **partial implementation**.

1. **Real Terminal Execution** (COMPLETE): Default disabled, allowlisted commands only (typecheck, lint, test, build, git status/diff), approval-bound, cwd-contained, output redacted. No-shell wrapper with args array to prevent injection.
2. **Build Loop** (COMPLETE): Verification command templates (typecheck, lint, test, web:build, cargo test, git status/diff/diff --check) with risk classification and one-time approval tokens.
3. **Terminal Classifier Hardening** (COMPLETE): No-shell parser, exact allowlist + denylist with dangerous pattern detection, env sanitization, mutation detection, shell metachar blocking.
4. **Native Real Terminal Adapter** (COMPLETE): Rust `Command` with timeout, cancel, redaction, feature-gated behind `TERMINAL_REAL_ENABLED`. Approval token is bound to specific command + cwd (not raw token minting).
5. **Real Incremental Watcher** (COMPLETE): Real `notify`-based FS watcher with start/stop/read-diff/get-session Tauri commands, debounce, backpressure (10K max queue), overflow detection, redacted display paths, trusted root enforcement. Web native adapter routes through Tauri invoke. WatcherPanel shows active/blocked/stopped/idle states with redacted root, dirty indicator, diff summary, and overflow warning. No auto-rescan or file write/apply in product path.
6. **Local Browser Preview** (BLOCKED): Native skeleton with URL classifier (localhost/127.0.0.1/file:// only), feature gate. Real browser iframe/preview requires separate implementation task.
7. **Runtime Integration** (PARTIAL): Terminal policy, build templates, approval token lifecycle exist. Full runtime/store/audit integration pending.
8. **UI Integration** (PARTIAL): TerminalPanel with proposal/approval UI exists via runtime store. Composer command suggestions and Settings feature gate toggles not wired.

All real capabilities default disabled behind feature gates. Approval/Sandbox/Audit/Session/Redaction boundaries remain non-negotiable. Provider live remains manual opt-in.

## Key Contracts

- `packages/shared/src/terminal-policy.ts` - Terminal execution policy, build run summary, mutation proof contracts
- `packages/runtime/src/mvp10-build-templates.ts` - BuildCommandTemplate and command template catalog
- `packages/shared/src/approval-token.ts` - ApprovalToken, TokenLifecycle, TokenState

## Key Files

- `packages/runtime/src/mvp10-terminal-policy.ts` - Hardened allowlist/denylist classifier
- `packages/runtime/src/mvp10-build-templates.ts` - Build command templates
- `packages/runtime/src/mvp10-approval-token.ts` - Approval token lifecycle
- `packages/runtime/src/mvp10-terminal-service.ts` - Runtime proposal/approval service
- `apps/desktop/src-tauri/src/terminal.rs` - Native terminal skeleton and real terminal adapter entrypoint

## Non-Goals

- UE Editor writes
- Mutating MCP tools
- Default live provider network
- Arbitrary shell execution (`cmd.exe`, `powershell.exe`, `/bin/sh`, `/bin/bash`)
- External browser automation / navigation
- Real screenshot capture
- Automatic watcher rescan
- Automatic code fixes
- Dependency installation

## Verification

```powershell
pnpm typecheck
pnpm lint
pnpm test
node scripts/side-effect-scan.mjs
git diff --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1
```
