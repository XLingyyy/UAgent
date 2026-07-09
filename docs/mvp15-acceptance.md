# MVP15 Acceptance - Real UE Sandbox Asset Mutation Pilot

## Acceptance Gates

Current implementation status: automated contracts, runtime policy, manifest-bound fixture execution, real-mode MCP asset adapter, exact tool/schema inventory, external-evidence verification hook, rollback failure handling, MCP duplicate source policy, native guard binding tests, UI real-ready/schema-blocked state, and side-effect scan checks are implemented. MVP15 final follows route B: the current real UE MCP wrapper endpoint can be connected/discovered, but wrapper-only discovery (`list_toolsets`, `describe_toolset`, `call_tool`) is accepted only as `BLOCKED_BY_MCP_SCHEMA`, not as real asset mutation PASS.

| Gate | Requirement | Status |
| --- | --- | --- |
| G0 Contracts | Shared asset mutation, evidence, audit, and replay contracts exist and are tested. | Implemented |
| G1 Policy | Runtime policy allows only `/Game/UAgentSandbox/**` and mapped `/Content/UAgentSandbox/**`. | Implemented |
| G2 Dry-run | Dry-run creates a non-executed asset ChangeSet preview. | Implemented |
| G3 Approval | Approval token is one-time, scoped, expiring, and not serialized into ChangeSets or replay. | Implemented |
| G4 Execute | Execution requires an approved sandbox ChangeSet, native guard binding, and exact allowlisted MCP asset tools in real mode. | Implemented / pending supervisor smoke |
| G5 Verify | Fixture verification compares manifest state; real mode requires UE/MCP read-only or read-only filesystem evidence and blocks without it. | Implemented / pending supervisor smoke |
| G6 Rollback | Rollback requires executed state and returns the manifest to the recorded before state. | Implemented |
| G7 MCP Adapter | Only exact dry-run asset tools are accepted; missing tools/schema return `BLOCKED_BY_MCP_SCHEMA`; wrapper `call_tool` and broad mutating calls are blocked. | Implemented |
| G8 Native Guard | Tauri commands reject non-sandbox, Save All, bulk, traversal, and token-leaking requests. | Implemented |
| G9 UI | Inspector Assets, MCP, Changes, Settings, and store actions expose fixture, real-ready, and schema-blocked lifecycle state. | Implemented |
| G10 Replay | Replay produces summary-only results with no native, MCP, or provider execution. | Implemented |
| G11 Side Effects | Side-effect scan covers asset mutation boundaries and reports 0 blocked findings. | Implemented |
| G12 Real UE Smoke | Supervisor-local UE smoke mutates only sandbox assets and verifies rollback when exact asset tools exist. | Current wrapper-only endpoint expected `BLOCKED_BY_MCP_SCHEMA`; exact-tool endpoint still pending real smoke |

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

The code path is designed so fixture tests can validate policy and lifecycle behavior without a UE Editor process, while real mode refuses to treat manifest-only checks as final verification. Final acceptance still depends on a real UE project and MCP server configured by the supervisor, because this repository cannot prove real editor asset persistence in a fixture-only environment.
