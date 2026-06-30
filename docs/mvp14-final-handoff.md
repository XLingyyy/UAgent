# MVP14 Final Handoff

## Delivered

- Shared MVP14 editor observation contracts, including native lifecycle fallback reasons and `exited` snapshot state.
- Runtime editor process policy, observation service, MCP schema adapters, and scenario matrix.
- Native `ue_editor_process` observation commands with feature gates and no save/kill behavior.
- Minimal real Windows process discovery for `UnrealEditor.exe` and `UnrealEditor-Cmd.exe` using read-only process metadata.
- Native-private binding of discovered descriptors to project id, trusted root id, canonical root, canonical `.uproject`, pid, and process identity metadata.
- Attach/status/snapshot rechecks that require the current process metadata to still match the same `.uproject` before reporting `heartbeat_ok` or `attached`.
- Desktop Editor, Review, Evidence, Settings, and TitleBar MVP14 status surfaces.
- MVP14 documentation set and supervisor-local real UE smoke PASS.

## Real Discovery Scope

The implemented native discovery path:

- Runs only when `UAGENT_ENABLE_UE_EDITOR_BRIDGE=1` and the root is trusted.
- Requires the configured `.uproject` to exist under the canonical trusted root.
- Enumerates local processes with a read-only API and accepts only `UnrealEditor.exe` or `UnrealEditor-Cmd.exe`.
- Matches candidates by command metadata that resolves to the same canonical `.uproject`.
- Returns only redacted/hash descriptor fields to the UI.

Unsupported or degraded cases:

- Non-Windows platforms return a degraded platform/native-discovery reason rather than fake running.
- UE processes that do not expose readable `.uproject` command metadata are not attachable.
- UE processes for a different project return no descriptor.
- If a previously discovered native process exits, changes identity, or no longer matches the same `.uproject`, status/snapshot report not alive or degraded state.

## Unchanged

- MVP12 ChangeSet v2 remains the only text write path.
- MVP13 state-only editor operation approval lifecycle remains the state-only execution boundary.
- Asset mutation remains blocked by default.
- Replay remains recorded-summary-only and does not re-run discovery, attach, status, or snapshot.
- Stop observation only stops the local UAgent observation session; it does not kill or close Unreal Editor.

## Open Risks

- Some local UE launch styles may not expose the `.uproject` argument in readable process metadata; those sessions intentionally remain non-attachable until a safe equivalent metadata source is added.
- MVP15 asset mutation approval design remains reserved and must stay blocked by default until explicitly designed and reviewed.
