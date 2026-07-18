# MVP15 Final Verification

Status: automated verification covers native-issued hash-only approval binding/TTL/order/replay, exact run-root policy, strict plugin execute and rollback results with explicit side-effect state, partial failure ownership, safe nested-empty-directory cleanup, external source/target/old-path/run-root evidence, fixed-container absence-or-verified-empty evidence, reverse rollback, UI lifecycle/audit/redaction, recorded replay with zero side-effect calls, and the expanded side-effect scan. Current status is `PASS_REAL_SMOKE candidate / awaiting supervisor review`.

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

The project plugin build and targeted `AI.ModelContextProtocol.ToolsetRegistry` automation are also required when no user Unreal Editor process or DLL lock is present. Automation must exit through `Automation Test Queue Empty`; it is test-only and must not perform a real Content mutation smoke.

## Real UE Smoke

The real UE smoke must be performed in a supervisor-controlled environment with a running UE Editor project. Fixture tests and manifest-only verification do not satisfy it. Use `docs/mvp15-manual-smoke.md` and record one of:

- `PASS_REAL_SMOKE candidate / awaiting supervisor review`: the ledger shows exact dry-run 5, native registration before mutation, exact execute 5, read-only external verification, inverse rollback 4, source unchanged, exact registered run root absent, fixed `/Game/UAgentSandbox` container absent or verified as an ordinary non-reparse directory with zero direct or recursive children, files, and subdirectories, and replay side-effect delta 0. Any fixed-container child, asset, reparse point, or unresolved state fails closed.
- `BLOCKED_BY_MCP_SCHEMA`: discovery lacks one or more exact asset tools, input schemas, dry-run schemas, rollback contracts, affected asset schemas, or evidence queries required by the adapter. Wrapper-only discovery is not PASS unless `describe_toolset` supplies complete exact method contracts for the facade.
- `BLOCKED_BY_ENVIRONMENT`: UE Editor, heartbeat/snapshot, trusted root, or localhost MCP connection is unavailable.

## Required Evidence

- Automated command results and output summaries.
- Side-effect scan summary with 0 blocked findings.
- Real UE smoke candidate ledger with source/hash gates, exact registered run-root absence, and fixed-container absent-or-verified-empty evidence; otherwise an MCP schema blocker inventory or environment blocker.
- Diff review confirming no build artifacts, credentials, private configuration, or production/cloud resources were modified.
