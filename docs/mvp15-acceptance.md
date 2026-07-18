# MVP15 Acceptance - Real UE Sandbox Asset Mutation Pilot

## Acceptance Gates

Current implementation status: native approval registration, strict exact-tool execute/rollback results, external read-only verification, inverse rollback, UI lifecycle/audit, replay zero-side-effect coverage, and the expanded side-effect scan are implemented and automated. Status: `PASS_REAL_SMOKE candidate / awaiting supervisor review`.

| Gate | Requirement | Status |
| --- | --- | --- |
| G0 baseline frozen | Base commit and MVP15A blocked posture remain documented; no final-complete claim before real smoke. | Implemented |
| G1 exact asset tool inventory | Six exact tools must expose input schema, dry-run schema, rollback contract, affected assets schema, and evidence query capability. | Implemented |
| G2 wrapper-only blocked | Wrapper-only `list_toolsets` / `describe_toolset` / `call_tool` is not exact ready by itself. | Implemented |
| G3 exact-tool facade | Facade may generate exact descriptors only from complete `describe_toolset` method contracts and pins toolset/method/schema version for internal `call_tool`. | Implemented |
| G4 dry-run result | Dry-run includes `affectedAssets`, `wouldChange`, `rollbackPlan`, `externalEvidenceQueries`, and `dryRunHash` without mutation. | Implemented |
| G5 approval registry / replay blocked | Native validates the complete binding, then issues an unpredictable 256-bit token once, stores only its hash, applies a 60-second maximum TTL, and consumes the JS/raw-token handoff on the first execute attempt; native registration must succeed before Execute becomes available. | Implemented |
| G6 native guard | Native guard binds exact tool, gate, root, observation session/PID, changeSet/run, aggregate hashes, operation order, and execute/rollback phase. | Implemented |
| G7 exact tool execution evidence | Five real operations require strict state-specific structured results with explicit `sideEffectObserved`; unknown, malformed, transport, or pre-mutation blocked results have no ownership and never receive a success audit. | Implemented / supervisor smoke candidate |
| G8 external evidence verification | Real verification uses read-only Content evidence for source SHA-256, target presence, old-path absence, and outside-run manifest stability. | Implemented / supervisor smoke candidate |
| G9 rollback evidence / source untouched | Successfully completed operations, plus a failed exact-tool operation only when its strict result proves an observed reversible side effect, receive manifest ownership and roll back in reverse order; transport/unknown failures never receive ownership; save is `none`; rollback is followed by external source verification, exact registered run-root absence, and fixed-container verification. The fixed `/Game/UAgentSandbox` container may be absent; if present, it must be an ordinary non-reparse directory with zero direct or recursive children, files, and subdirectories. | Implemented / supervisor smoke candidate |
| G10 UI status surfaces | Assets and Changes expose real lifecycle states, safe native registration state, stable reasons, per-operation exact-tool/phase/virtual-path/evidence/result audit, and no raw identity/path/token fields. | Implemented |
| G11 replay no execution | Replay reads recorded summaries only; automated UI coverage asserts zero new native/MCP/provider/verification/rollback calls. | Implemented |
| G12 side-effect scan | Scan covers fake non-empty-token verification, unknown-result fail-open, Save All, bulk, non-sandbox writes, generic wrapper mutation, replay execute/rollback, raw evidence identity/path, provider auto-apply, and manifest-only verification. | Implemented |
| G13 real UE smoke result | Requires a supervisor-controlled UE Editor, trusted root, active observation, localhost MCP, exact inventory, `/Game/Test01` source evidence, execution, verification, and rollback evidence. | `PASS_REAL_SMOKE candidate / awaiting supervisor review` |
| G14 docs finalization | Public docs describe automation, manual smoke, blockers, risks, and handoff without claiming final acceptance. | Implemented |
| G15 exact run root / cleanup | `create_folder` targets exactly `/Game/UAgentSandbox/<run-id>`; every other write is a strict descendant. Cleanup ownership ends at that exact registered run root and removes only its asset-free, non-reparse directory tree; it does not own or delete the fixed global `/Game/UAgentSandbox` container. Canonical cleanup requires the exact run root absent and the fixed container either absent or verified as an ordinary non-reparse directory with zero direct or recursive children, files, and subdirectories; any child, asset, reparse point, or unresolved containment fails closed. | Implemented / supervisor smoke candidate |

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

The automated real-mode harness proves registration-before-MCP ordering, five exact execute calls, read-only external verification, four reverse rollback calls, source preservation, stable blockers, redacted UI audit, and replay with zero side-effect calls. It does not substitute for the supervisor-controlled real UE smoke.
