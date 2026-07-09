# MVP15 Final Verification

Status: automated rework verification covers manifest execution, real-mode adapter failure, exact MCP asset tool inventory, native guard ordering, external-evidence verification, duplicate source handling, UI real-ready/schema-blocked state, and side-effect scan gaps. Route B is the final MVP15 contract: the current real UE MCP wrapper endpoint may connect and discover successfully, but if it exposes only `list_toolsets`, `describe_toolset`, and `call_tool`, the expected result is `BLOCKED_BY_MCP_SCHEMA`, not real asset mutation PASS.

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

- `PASS_REAL_SMOKE`: exact MCP tools executed create folder, duplicate, rename, move, save single asset, real verification, and rollback under `/Game/UAgentSandbox/**`.
- `BLOCKED_BY_MCP_SCHEMA`: discovery lacks one or more exact asset tools, input schemas, or dry-run schemas required by the adapter. This is the expected result for the current wrapper-only endpoint even when MCP connect/discover succeeds.
- `BLOCKED_BY_ENVIRONMENT`: UE Editor, heartbeat/snapshot, trusted root, or localhost MCP connection is unavailable.

## Required Evidence

- Automated command results and output summaries.
- Side-effect scan summary with 0 blocked findings.
- Real UE smoke result, MCP schema blocker inventory, or environment blocker.
- Diff review confirming no workflow-private files, build artifacts, credentials, or production/cloud resources were modified.
