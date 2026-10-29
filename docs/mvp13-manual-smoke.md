# MVP13 Manual Smoke

| Step | Check |
| --- | --- |
| S1 | Default feature gates off; Editor capability reports disabled. |
| S2 | Fixture attach requires trusted root and `.uproject` inside root. |
| S3 | State-only operation can be proposed, approved, executed, and recorded as evidence. |
| S4 | Mutating MCP tools are blocked by default. |
| S5 | Exact allowlisted MCP tool with schema can produce dry-run result. |
| S6 | Text-backed MCP dry-run bridges to ChangeSet v2 preview/apply/rollback. |
| S7 | Asset-write MCP or editor operation produces blocked asset plan/diagnostic. |
| S8 | Replay summary uses `replayOnly` / `recordedOnlyActions`; it does not re-execute. |
| S9 | `node scripts/side-effect-scan.mjs` has 0 blocked findings. |
| S10 | Optional real UE attach/status/state-only local smoke. Real UE is not required for acceptance. |

Real UE optional constraints:

- Only attach/status/state-only operations are allowed.
- Do not Save All, save assets, delete/rename/move assets, or compile Blueprints.
- Do not use mutating MCP `tools/call` directly.
