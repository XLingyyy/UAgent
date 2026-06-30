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

## 2026-06-30 Supplemental Native Trusted Root Registry PASS Summary

Task: `TASK-MVP12-REWORK-NATIVE-TRUSTED-ROOT-REGISTRY`

Summary:

- Native `preview_workspace_change`, `approve_workspace_change`, `apply_workspace_change`, and `rollback_workspace_change` now require an explicitly trusted root before preview/apply/rollback/approval can proceed.
- Native preview records a registry entry with canonical root, operation ids, before hashes, after hashes, expiry, lifecycle state, and rollback backup binding.
- Native approval is issued only by `approve_workspace_change` for a registry `previewed` change set. Apply rejects forged `approval-token:*`, replayed, expired, root-mismatched, operation/hash-mismatched, and after-hash-substituted approvals.
- Rollback validates trusted root, backup root binding, and per-operation expected current hashes before restoring, and marks the registry state `rolled_back` after success.

Fresh evidence from the implementation run:

- `pnpm typecheck` - PASS
- `pnpm lint` - PASS
- `pnpm --filter @uagent/desktop test` - PASS, 596 tests
- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` - PASS
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml text_mutation -- --test-threads=1` - PASS, 13 text mutation tests
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1` - PASS, 79 tests
- `node scripts/side-effect-scan.mjs` - PASS, 0 blocked / 363 review findings
- `git diff --check` - PASS, LF/CRLF warnings only
