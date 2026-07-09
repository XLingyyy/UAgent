# MVP15 Final Verification

Status: automated verification covers manifest execution, real-mode adapter failure, exact MCP asset tool inventory, rollback/evidence contract gaps, compliant exact-tool facade mapping, native guard ordering, external-evidence verification, duplicate source handling, UI real-ready/schema-blocked state, and side-effect scan gaps. Final MVP15 acceptance still requires supervisor-local real UE smoke; without UE Editor, trusted root, heartbeat, localhost MCP, and source asset evidence, the real smoke result is `BLOCKED_BY_ENVIRONMENT`, not PASS.

## Automated Verification Matrix

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @uagent/shared test
pnpm --filter @uagent/runtime test
pnpm --filter @uagent/mcp-client test
pnpm --filter @uagent/desktop test
pnpm --filter @uagent/desktop web:build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml asset_mutation -- --test-threads=1
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml ue_editor_process -- --test-threads=1
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1
node scripts/side-effect-scan.mjs
git diff --check
```

## Real UE Smoke

The real UE smoke must be performed in a supervisor-controlled environment with a running UE Editor project. The smoke is not satisfied by fixture-only tests or manifest-only verification. Use `docs/mvp15-manual-smoke.md` and record one of:

- `PASS_REAL_SMOKE`: exact MCP tools or a compliant exact-tool facade executed create folder, duplicate, rename, move, save single asset, real verification, and rollback under `/Game/UAgentSandbox/**`.
- `BLOCKED_BY_MCP_SCHEMA`: discovery lacks one or more exact asset tools, input schemas, dry-run schemas, rollback contracts, affected asset schemas, or evidence queries required by the adapter. Wrapper-only discovery is not PASS unless `describe_toolset` supplies complete exact method contracts for the facade.
- `BLOCKED_BY_ENVIRONMENT`: UE Editor, heartbeat/snapshot, trusted root, or localhost MCP connection is unavailable.

## Required Evidence

- Automated command results and output summaries.
- Side-effect scan summary with 0 blocked findings.
- Real UE smoke result, MCP schema blocker inventory, or environment blocker.
- Diff review confirming no workflow-private files, build artifacts, credentials, or production/cloud resources were modified.
