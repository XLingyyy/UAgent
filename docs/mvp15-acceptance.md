# MVP15 Acceptance - Real UE Sandbox Asset Mutation Pilot

## Acceptance Gates

Current implementation status: automated contracts, runtime policy, manifest-bound fixture execution, real-mode MCP asset adapter, exact tool/schema/rollback/evidence inventory, compliant exact-tool facade support, external-evidence verification blocking, rollback failure handling, MCP duplicate source policy, native guard binding tests, UI real-ready/schema-blocked state, 60+ scenario matrix coverage, and side-effect scan checks are implemented. MVP15 final remains pending until supervisor-local real UE smoke records `PASS_REAL_SMOKE`.

| Gate | Requirement | Status |
| --- | --- | --- |
| G0 baseline frozen | Base commit and MVP15A blocked posture remain documented; no final-complete claim before real smoke. | Implemented |
| G1 exact asset tool inventory | Six exact tools must expose input schema, dry-run schema, rollback contract, affected assets schema, and evidence query capability. | Implemented |
| G2 wrapper-only blocked | Wrapper-only `list_toolsets` / `describe_toolset` / `call_tool` is not exact ready by itself. | Implemented |
| G3 exact-tool facade | Facade may generate exact descriptors only from complete `describe_toolset` method contracts and pins toolset/method/schema version for internal `call_tool`. | Implemented |
| G4 dry-run result | Dry-run includes `affectedAssets`, `wouldChange`, `rollbackPlan`, `externalEvidenceQueries`, and `dryRunHash` without mutation. | Implemented |
| G5 approval registry / replay blocked | Approval is scoped, one-time, expiring, dry-run-hash bound, and replay summary-only. | Implemented |
| G6 native guard | Native guard validates exact tool, gate, observation session, pid hash, dry-run hash, approval, phase, and sandbox paths. | Implemented |
| G7 exact tool execution evidence | Real execution path is allowlisted exact tools or compliant facade only, with redacted evidence ids. | Implemented / pending supervisor smoke |
| G8 external evidence verification | Real verification blocks without UE/MCP read-only state or read-only Content evidence; manifest-only is fixture/local only. | Implemented / pending supervisor smoke |
| G9 rollback evidence / source untouched | Rollback uses reverse exact operations or exact rollback path; duplicate source remains read-only and verified untouched. | Implemented / pending supervisor smoke |
| G10 UI status surfaces | Assets/MCP/Changes/Settings expose ready, schema-blocked, dry-run, approved, executed, verified, rollback states, run id, source, missing schemas, and redacted evidence. | Implemented |
| G11 replay no execution | Replay never calls native, MCP, apply, rollback, or provider. | Implemented |
| G12 side-effect scan | Scan covers broad wrapper bypass, generic `call_tool`, Save All, bulk ops, non-sandbox writes, raw token/path/command leakage, replay execution, provider auto-apply, and manifest-only real verification. | Implemented |
| G13 real UE smoke result | Requires local UE Editor, trusted root, heartbeat, localhost MCP, exact inventory/facade, external verification, rollback, and source untouched evidence. | Pending supervisor-local environment; report as `BLOCKED_BY_ENVIRONMENT` when unavailable |
| G14 docs finalization | Public docs describe automation, manual smoke, blockers, risks, and handoff without claiming final acceptance. | Implemented |

## Required Verification

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- Package-level Vitest suites for shared, runtime, mcp-client, and desktop.
- Desktop web build.
- Tauri cargo check and focused/native test suites.
- `node scripts/side-effect-scan.mjs`
- `git diff --check`
- Supervisor-local real UE sandbox smoke.

## Acceptance Notes

The code path is designed so fixture tests can validate policy and lifecycle behavior without a UE Editor process, while real mode refuses to treat manifest-only checks as final verification. A wrapper-only endpoint is acceptable only as `BLOCKED_BY_MCP_SCHEMA` unless `describe_toolset` provides complete exact method contracts for the facade. Final acceptance still depends on a real UE project and MCP server configured by the supervisor.
