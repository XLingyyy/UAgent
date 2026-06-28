# MVP9 Preflight Baseline Verification

## Results

| Command | Status | Notes |
|---------|--------|-------|
| `pnpm typecheck` | PASS | See [final verification](mvp9-final-verification.md) |
| `pnpm lint` | PASS | See [final verification](mvp9-final-verification.md) |
| `pnpm test` | PASS | See [final verification](mvp9-final-verification.md) |
| `pnpm --filter @uagent/shared test` | PASS | See [final verification](mvp9-final-verification.md) |
| `pnpm --filter @uagent/runtime test` | PASS | See [final verification](mvp9-final-verification.md) |
| `pnpm --filter @uagent/mcp-client test` | PASS | See [final verification](mvp9-final-verification.md) |
| `pnpm --filter @uagent/desktop test` | PASS | See [final verification](mvp9-final-verification.md) |
| `pnpm --filter @uagent/desktop web:build` | PASS | See [final verification](mvp9-final-verification.md) |
| `node scripts/side-effect-scan.mjs` | PASS | See [final verification](mvp9-final-verification.md) |
| `git diff --check` | PASS | See [final verification](mvp9-final-verification.md) |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS | See [final verification](mvp9-final-verification.md) |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1` | PASS | See [final verification](mvp9-final-verification.md) |

All verification commands pass. See [docs/mvp9-final-verification.md](mvp9-final-verification.md) for detailed results.

## Baseline Assumptions

- MVP8 baseline is complete and accepted
- Side-effect scan script has been extended with MVP9 categories
- All shared/runtime/src files compile with strict TypeScript
- No existing tests are broken by MVP9 additions
- All native features remain feature-flagged and blocked by default
- Terminal fixture cwd uses `[project-root]`, not raw paths
