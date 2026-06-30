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

Status for the 2026-06-30 supervisor-local smoke: `PASS`

Observed result: a trusted native project root with a running `UnrealEditor.exe` completed discovery, attach, heartbeat, snapshot, and stop observation. Stop observation did not close the real UE Editor window.

Required local reproduction steps:

1. Open a real Unreal Editor project whose `.uproject` is inside a UAgent trusted root.
2. Confirm the editor was launched in a way that exposes the `.uproject` path in read-only process command metadata, either as a direct `.uproject` argument or a `-Project=` argument.
3. Start the native desktop app with `UAGENT_ENABLE_UE_EDITOR_BRIDGE=1`.
4. Trust the project root in UAgent if it is not already trusted.
5. Run editor process discovery.
6. Confirm discovery returns `status: ready`, `reason: native_process_matched`, and one or more descriptors with only `pidHash`, `displayName`, `displayExecutableHash`, `displayProjectHint`, `processState`, `source`, `discoveredAt`, and `expiresAt`.
7. Attach to the returned descriptor.
8. Read status and confirm `reason: heartbeat_ok` with `processAlive: true`.
9. Read snapshot and confirm `editorState: attached`, `projectMatched: true`, and `processAlive: true`.
10. Stop observation and confirm the UE Editor window remains open.
11. Confirm no Save All, UE asset save/delete/rename/move/compile, process kill, mutating MCP `tools/call`, or replay re-execution occurred.

Expected blocked/degraded outcomes:

- No UE process: discovery returns degraded with no descriptors.
- UE process for another project: discovery returns no descriptors and does not reveal raw process metadata.
- Command metadata unreadable or missing the `.uproject`: discovery remains degraded rather than attachable.
- Process exits after attach: status/snapshot report not alive or degraded/exited state.
