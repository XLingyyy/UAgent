# MVP13 Acceptance - Controlled UE Editor / MCP Mutation Pilot

## Capability requirements

| Contract |
| --- |
| `docs/architecture.md`; MVP12 runtime/native tests retained. |
| `packages/shared/src/ue-editor.ts`, `packages/shared/src/mcp-mutation.ts`, shared contract tests. |
| `packages/runtime/src/mvp13-editor-policy.ts`, `packages/runtime/src/mvp13-mcp-mutation-policy.ts`. |
| `apps/desktop/src-tauri/src/ue_editor.rs`; feature gate disabled by default. |
| Runtime registry and native registry bind session/project/root/expiry. |
| Runtime/native proposal, approval, execute, cancel, replay-token rejection. |
| Default blocked, exact allowlist plus schema/dry-run required. |
| State-only maps to editor proposal; text-backed maps to ChangeSet v2; asset risk maps to blocked plan. |
| `createMvp13TextBackedChangeSetBridge` reuses MVP12 apply/rollback. |
| `select_asset`/open/focus/validation/diagnostics state-only path; asset writes blocked. |
| `EditorPanel`, `McpMutationPanel`, Changes/Review/ProjectTree MVP13 summaries. |
| Shared event/evidence/session types extended; replay-only summaries recorded. |
| MVP13 categories added; latest run: 0 blocked / 474 review. |
| Runtime matrix: 32 scenarios / 128 assertions; desktop and native tests added. |

## Scenario Matrix

- Runtime MVP13 matrix: 32 named scenarios.
- Assertion count: 128.
- Covered paths: disabled gate, trusted root, session replay summary, read-only/state-only editor allowlist, text-backed ChangeSet mapping, asset write blocks, proposal/approval/execute/replay rejection, MCP default block, allowlisted dry-run, schema required, dry-run mapping.

## Compatibility

- Public shared types were extended with additive MVP13 contracts and event/evidence/session union members.
- Native commands were added, not substituted for MVP12 text mutation commands.
- Runtime `mvp12` ChangeSet service gained an external proposal preview helper for MVP13 bridge reuse.
- No new dependencies or CI workflow files were added.
