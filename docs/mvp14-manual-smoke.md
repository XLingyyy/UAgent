# MVP14 Manual Smoke

## Fixture Smoke

1. Feature off returns blocked capability/status.
2. Feature on fixture discovers an editor process descriptor with `pidHash` and no raw executable path.
3. Attach fixture process under trusted root and matching `.uproject`.
4. Read heartbeat and snapshot; snapshot shows read-only diagnostics and Save All blocked.
5. Stop observation session; confirm no UE process kill behavior is triggered.
6. State-only operation follows proposal -> approval -> execute and second execute is blocked by token/proposal lifecycle.
7. MCP dry-run maps text-backed changes to ChangeSet v2 intent and asset-risk tools to blocked asset plans.
8. Replay shows recorded summaries only and does not call native, MCP, ChangeSet apply, or rollback paths.

## Real UE Supervisor-Local Smoke

Status: `SUPERVISOR LOCAL PENDING`

Required local steps:

1. Select a trusted UE project root containing a `.uproject`.
2. Start UE Editor manually.
3. Enable `UAGENT_ENABLE_UE_EDITOR_BRIDGE=1`.
4. Discover and attach the running editor process.
5. Read status and snapshot.
6. Confirm no asset save, Save All, process kill, mutating MCP apply, or replay re-execution occurs.
