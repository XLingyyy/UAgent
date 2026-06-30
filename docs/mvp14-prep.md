# MVP14 Prep

MVP14 advances the MVP13 UE Editor / MCP mutation pilot into safe UE Editor process observation.

## Scope

- UE Editor capability, discovery, attach validation, attach, heartbeat, status, snapshot, and local observation stop.
- Runtime observation service with fixture/native-compatible semantics.
- MCP schema adapters for read-only status/resources, state-only operations, text-backed ChangeSet intent, and blocked asset plans.
- UI summaries for Editor, Review, Evidence, Settings, and TitleBar.

## Safety Baseline

- `UAGENT_ENABLE_UE_EDITOR_BRIDGE=1` is required for native observation.
- `UAGENT_ENABLE_UE_EDITOR_LAUNCH=1` is required for launch.
- Trusted root and `.uproject` binding are required.
- Save All, SavePackage, asset writes, raw args, approval tokens, secrets, and replay re-execution remain blocked.
