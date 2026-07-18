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
10. Enter the accepted read-only source asset package path `/Game/Test01`.
11. Run dry-run. The first operation must be `ue.asset.create_folder` for exactly `/Game/UAgentSandbox/<run-id>`. Later duplicate, rename, move, and save targets must stay below `/Game/UAgentSandbox/<run-id>/Work/**`.
12. If the UI reports `blocked_by_mcp_schema`, record the missing tool, missing schema, missing dry-run schema, missing rollback contract, or missing evidence query names shown in the Assets or MCP tab and stop the smoke as `BLOCKED_BY_MCP_SCHEMA`.
13. Confirm the binding advances from `external_pending` to `external_bound`, the aggregate dry-run prefix is shown, and the preview lists the ordered five operations. Approval remains disabled while binding is pending or blocked.
14. Approve once. Wait for the native response and confirm the UI advances from `Native registration: required` to `Native registration: registered`. Execute may become available only while the ChangeSet is `approved`, binding is `external_bound`, observation is active, and this registration status is `registered`; it must not claim registration succeeded before native has validated the binding and issued the short-lived one-time token. The registration request must not contain a caller-chosen token.
15. Execute once. Confirm no second registration occurs and the already registered approval precedes exactly five exact calls in order: create folder, duplicate, rename, move, save single asset. The raw token is consumed before this first attempt and is never sent to MCP or shown in UI/audit/replay, whether the attempt succeeds or is blocked.
16. Verify. Read-only Content evidence must prove `/Game/Test01` retains its baseline size and SHA-256, the final sandbox target exists and is saved, the rename/move old paths are absent, and entries outside the run root did not change. Manifest-only runtime state is not sufficient.
17. Roll back once. Confirm reverse operations are move back, rename back, delete duplicate, then clean up only the exact registered run root. Save has no inverse operation and must not create a fifth rollback mutation.
18. Verify rollback. The exact registered `/Game/UAgentSandbox/<run-id>` root and its now-empty nested directories must be gone, no asset packages may remain there, and `/Game/Test01` must still match the original size and SHA-256. The fixed global `/Game/UAgentSandbox` container is outside run-owned cleanup: it may be absent, or it may remain only when resolved under the accepted Content root as an ordinary non-reparse directory with zero direct or recursive children, files, and subdirectories. Any container child, asset, reparse point, cross-run target, unresolved path, or uncertain containment must fail closed rather than be reported as a passing rollback.
19. Open the recorded replay summary and note native/MCP/provider/verification/rollback call counts before and after. Every delta must be zero.
20. Attempt no second execute or rollback during the accepted smoke. Dedicated automated replay tests must show the repeat request is blocked before native/MCP mutation.
21. Confirm Assets and Changes show phase, exact tool, virtual `/Game` path, safe evidence id, and result without raw args, token, project root, MCP session id, PID, or absolute disk path.
22. Stop observation and confirm Unreal Editor remains running.

## Live Ledger

- Preflight/discovery: record endpoint class and exact inventory without secrets.
- Dry-run: 5 exact calls; `dryRun:true`, `execute:false`, `rollback:false`.
- Registration/execute: 1 native registration before 5 execute guards and 5 exact execute calls.
- Verify: read-only evidence calls only; 0 mutation calls.
- Rollback: 4 rollback guards and 4 exact inverse calls in reverse order.
- Replay inspection: 0 new native, MCP, provider, verify, or rollback calls.
- Forbidden totals: 0 Save All, 0 bulk, 0 generic wrapper mutation, 0 non-sandbox write, 0 provider auto-apply, and 0 raw token/path leakage.

## Expected Result

- The only successful mutation is under `/Game/UAgentSandbox/**`.
- Every denied operation is blocked before execution.
- Missing exact MCP tools, schemas, rollback contracts, or evidence queries are reported as `BLOCKED_BY_MCP_SCHEMA`, not as a passing dry-run.
- Evidence and audit summaries contain no approval token, raw secret, or raw local project root.
- Replay shows recorded summary only and does not call native or MCP execution.
- Candidate status after collecting the complete ledger: `PASS_REAL_SMOKE candidate / awaiting supervisor review`.
