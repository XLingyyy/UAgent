# MVP15 Final Handoff

## Delivered

- Shared asset mutation contracts and test coverage.
- Runtime sandbox policy, strict exact MCP execute/rollback adapter, external verification, inverse rollback, recorded replay summary, scenario matrix, and tests.
- Native-issued 256-bit one-time approval registration with hash-only storage, maximum TTL, aggregate hash/order/path/run/session/PID/root/phase binding, strict outcome recording, partial-execution ownership, and replay rejection.
- Desktop Assets and Changes lifecycle surfaces, exact run-root creation, first-attempt raw-token cleanup, `/Game/Test01` read-only baseline, stable blockers, safe per-operation audit, and replay zero-side-effect UI coverage.
- Exact registered run-root cleanup that handles nested empty directories and fails closed on assets, cross-run targets, containment ambiguity, files, and reparse points.
- Native asset mutation registry/guard commands and focused native tests.
- Side-effect scan hardening for fake token checks, unknown-result fail-open, broad or non-sandbox mutation, replay side effects, and raw evidence identity/path leakage.
- MVP15 documentation for prep, acceptance, risk, manual smoke, verification, and handoff.

## Pending Supervisor Work

- Run real UE sandbox smoke in a local UE Editor project.
- If the current endpoint exposes only `list_toolsets`, `describe_toolset`, and `call_tool`, record `BLOCKED_BY_MCP_SCHEMA` unless `describe_toolset` exposes complete exact method contracts for all six asset operations.
- When blocked by schema, record missing exact tools, input schemas, dry-run schemas, rollback contracts, and evidence query capabilities shown by UAgent.
- Confirm only `/Game/UAgentSandbox/**` is mutated.
- Confirm rollback removes run-owned packages and `/Game/Test01` size/SHA-256 remains unchanged.
- Confirm the live ledger records dry-run 5, execute 5, rollback 4, replay side-effect delta 0, and all forbidden totals as zero.
- Decide final acceptance status after reviewing the implementation and smoke evidence.
- Treat real UE smoke as `BLOCKED_BY_ENVIRONMENT` until that supervisor-local run is completed.

## Handoff Notes

MVP15 intentionally keeps asset mutation narrow. The implementation does not expose the generic `call_tool` wrapper to UI/runtime execution as a ready asset tool. It may use `call_tool` only as a facade-internal implementation detail after `describe_toolset` supplies fixed toolset id, method id, schema version, input schema, dry-run schema, rollback contract, affected asset schema, and evidence query capability. It also does not add generic MCP mutation, Save All, non-sandbox writes, provider auto-apply, replay execution, git automation, dependency installation, or CI workflow changes.

Handoff status: `PASS_REAL_SMOKE candidate / awaiting supervisor review`.
