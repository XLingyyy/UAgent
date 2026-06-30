# MVP13 Acceptance - Controlled UE Editor / MCP Mutation Pilot

## Gate Evidence

| Gate | Status | Evidence |
| --- | --- | --- |
| G0 baseline lock | COMPLETE | `docs/mvp13-baseline-freeze.md`; MVP12 runtime/native tests retained. |
| G1 shared contracts | COMPLETE | `packages/shared/src/ue-editor.ts`, `packages/shared/src/mcp-mutation.ts`, shared contract tests. |
| G2 policy classifier | COMPLETE | `packages/runtime/src/mvp13-editor-policy.ts`, `packages/runtime/src/mvp13-mcp-mutation-policy.ts`. |
| G3 native bridge skeleton | COMPLETE | `apps/desktop/src-tauri/src/ue_editor.rs`; feature gate disabled by default. |
| G4 session registry | COMPLETE | Runtime registry and native registry bind session/project/root/expiry. |
| G5 operation approval registry | COMPLETE | Runtime/native proposal, approval, execute, cancel, replay-token rejection. |
| G6 MCP mutation allowlist pilot | COMPLETE | Default blocked, exact allowlist plus schema/dry-run required. |
| G7 dry-run mapping | COMPLETE | State-only maps to editor proposal; text-backed maps to ChangeSet v2; asset risk maps to blocked plan. |
| G8 ChangeSet bridge | COMPLETE | `createMvp13TextBackedChangeSetBridge` reuses MVP12 apply/rollback. |
| G9 state-only execution pilot | COMPLETE | `select_asset`/open/focus/validation/diagnostics state-only path; asset writes blocked. |
| G10 UI integration | COMPLETE | `EditorPanel`, `McpMutationPanel`, Changes/Review/ProjectTree MVP13 summaries. |
| G11 audit/evidence/replay | COMPLETE | Shared event/evidence/session types extended; replay-only summaries recorded. |
| G12 side-effect scan | COMPLETE | MVP13 categories added; latest run: 0 blocked / 474 review. |
| G13 scenarios/tests | COMPLETE | Runtime matrix: 32 scenarios / 128 assertions; desktop and native tests added. |
| G14 smoke docs | COMPLETE | `docs/mvp13-manual-smoke.md`. |
| G15 docs/handoff | COMPLETE | Acceptance, risk register, final verification, final handoff docs. |

## Scenario Matrix

- Runtime MVP13 matrix: 32 named scenarios.
- Assertion count: 128.
- Covered paths: disabled gate, trusted root, session replay summary, read-only/state-only editor allowlist, text-backed ChangeSet mapping, asset write blocks, proposal/approval/execute/replay rejection, MCP default block, allowlisted dry-run, schema required, dry-run mapping.

## Compatibility

- Public shared types were extended with additive MVP13 contracts and event/evidence/session union members.
- Native commands were added, not substituted for MVP12 text mutation commands.
- Runtime `mvp12` ChangeSet service gained an external proposal preview helper for MVP13 bridge reuse.
- No new dependencies or CI workflow files were added.
