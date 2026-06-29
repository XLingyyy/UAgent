# MVP11 Final Verification

## Required Commands

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @uagent/shared test
pnpm --filter @uagent/runtime test
pnpm --filter @uagent/mcp-client test
pnpm --filter @uagent/desktop test
pnpm --filter @uagent/desktop web:build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1
node scripts/side-effect-scan.mjs
git diff --check
```

## Current Status

Final command results passed on 2026-06-29 22:37 +08:00 and are recorded in:

- `G:\UAgent\.agent-bus\reports\REPORT-TASK-MVP11-G0-G14-READONLY-DIAGNOSTICS-BUILD-ANALYSIS-20260629-2237.md`

Result summary:

- `pnpm test` - PASS; shared 18 tests, runtime 687 tests, mcp-client 44 tests, desktop 589 tests.
- `pnpm lint` - PASS.
- `pnpm typecheck` - PASS.
- `pnpm --filter @uagent/desktop web:build` - PASS.
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` - PASS.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1` - PASS; 66 Rust tests.
- `node scripts/side-effect-scan.mjs` - PASS; 0 blocked / 271 review.
- `git diff --check` - PASS; LF/CRLF warnings only.

## Targeted Coverage

- `pnpm --filter @uagent/runtime exec vitest run mvp11-scenarios.test.ts` - PASS.
- `pnpm --filter @uagent/runtime exec vitest run ue-diagnostics` - PASS.
- `pnpm --filter @uagent/runtime exec vitest run build-output-parser` - PASS.
- `pnpm --filter @uagent/desktop exec vitest run DiagnosticsPanel` - PASS.
- `pnpm --filter @uagent/desktop exec vitest run ContextPack` - PASS.
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml terminal::tests -- --test-threads=1` - PASS.

Note: exact `pnpm --filter ... test -- <pattern>` script forwarding in this workspace passes the separator through to Vitest and can run the full package suite. The `exec vitest run <pattern>` commands above were used for precise filename filtering.
