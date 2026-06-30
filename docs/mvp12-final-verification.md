# MVP12 Final Verification

Implementation agents must record fresh command output in the REPORT for:

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

This document is a checklist. The authoritative result is the implementation REPORT and supervisor review.

Approval rework verification must include expired approval rejection and after-hash binding coverage in runtime, desktop, and native tests.
