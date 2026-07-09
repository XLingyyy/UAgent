# MVP15 Manual Smoke

## Preconditions

- Use a disposable or version-controlled UE project prepared by the supervisor.
- Start Unreal Editor with the project already open.
- Enable only the required local bridge flags for the smoke.
- Confirm the UAgent asset mutation gate is `sandbox-enabled`.
- Connect to the localhost Unreal MCP endpoint and run MCP discovery.
- Confirm the exact MCP asset tools expose input schema, dry-run schema, rollback contract, affected assets schema, and read-only evidence query capability: `ue.asset.create_folder`, `ue.asset.duplicate`, `ue.asset.rename`, `ue.asset.move`, `ue.asset.delete`, and `ue.asset.save`.
- If the endpoint exposes only `list_toolsets`, `describe_toolset`, and `call_tool`, the expected MVP15 result is `BLOCKED_BY_MCP_SCHEMA` unless `describe_toolset` returns complete exact method contracts for all six operations. Do not treat `editor_toolset.toolsets.asset.AssetTools` behind the generic wrapper as MVP15-ready asset mutation by name alone.
- On a real Windows desktop, include a titlebar precheck at `2560x1600` with system scaling `150%`: the `Tools` button must not overlap `UE Editor:*`, `MVP14 In Progress`, or `Native FS OK`, and it must toggle the utility drawer with the existing `Open utility drawer` / `Close utility drawer` accessible label.
- Do not run Save All, bulk asset operations, Blueprint compile, or non-sandbox asset operations.

## Smoke Steps

1. Attach UAgent to the running UE Editor process using the existing MVP14 observation path.
2. Confirm heartbeat is alive and the snapshot matches the open `.uproject`.
3. Open `Settings -> Config -> MCP read-only runtime`.
4. In `Endpoint`, enter the local UE MCP endpoint, for example `http://127.0.0.1:8000/mcp` or the current localhost address displayed by the UE MCP plugin. Only `localhost` / `127.0.0.1` / `::1` endpoints are allowed for this smoke.
5. Click `Connect` and confirm MCP status is `connected`.
6. Click `Discover` and confirm discovery counts refresh.
7. Click `Tools` in the titlebar to open the utility drawer. Confirm the UE tab, MCP tab, and Assets tab can each be selected and display the current observed state without the titlebar status pills blocking the hit target.
8. Return to `Tools -> MCP` and `Tools -> Assets` to check exact tools, input schema, dry-run schema, rollback contract, affected assets schema, and read-only evidence query status.
9. If discovery is wrapper-only or incomplete after `Discover`, record the missing exact tools or incomplete facade contract as `BLOCKED_BY_MCP_SCHEMA` and do not continue mutation execution.
10. Enter a real existing source asset package path in Source asset path, for example `/Game/.../SomeAsset`.
11. Run dry-run. UAgent must create a run-scoped plan under `/Game/UAgentSandbox/<run-id>/`; fixed `ui-run-1` and hardcoded `/Game/Templates/Hero` are not acceptable for real smoke.
12. If the UI reports `blocked_by_mcp_schema`, record the missing tool, missing schema, missing dry-run schema, missing rollback contract, or missing evidence query names shown in the Assets or MCP tab and stop the smoke as `BLOCKED_BY_MCP_SCHEMA`.
13. Confirm the ChangeSet preview lists create folder, duplicate, rename, move, and save-single-asset operations, all sandbox targets under `/Game/UAgentSandbox/<run-id>/`.
14. Approve the ChangeSet and execute it once.
15. Verify real UE/MCP read-only asset state, or read-only `Content/UAgentSandbox/<run-id>` filesystem evidence, for duplicate target existence, rename/move before-after paths, and save-single-asset evidence. Manifest-only verification is not sufficient for real smoke.
16. Roll back the executed sandbox ChangeSet.
17. Verify the current run id has no remaining sandbox asset packages, or only a recorded empty cleanup directory remains.
18. Confirm the original source asset still exists and was not renamed, moved, saved, or deleted.
19. Confirm replay shows recorded summaries only and does not call native, MCP, or provider execution.
20. Stop observation and confirm Unreal Editor remains running.

## Expected Result

- The only successful mutation is under `/Game/UAgentSandbox/**`.
- Every denied operation is blocked before execution.
- Missing exact MCP tools, schemas, rollback contracts, or evidence queries are reported as `BLOCKED_BY_MCP_SCHEMA`, not as a passing dry-run.
- Evidence and audit summaries contain no approval token, raw secret, or raw local project root.
- Replay shows recorded summary only and does not call native or MCP execution.
