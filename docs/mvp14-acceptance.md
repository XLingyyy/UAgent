# MVP14 Acceptance

## Capability requirements

| Contract |
| --- |
| Shared editor observation contracts include discovery descriptors, heartbeat, snapshots, evidence kinds, and audit events. |
| Trusted root, network root, root escape, missing `.uproject`, shell metacharacter, raw env, executable allowlist, and binding mismatch checks are covered. |
| `ue_editor_process` provides feature-gated discovery, attach, status, snapshot, stop, and launch-policy commands without save or kill behavior. |
| Observation sessions bind project/root/project display/process display/status/expiry/heartbeat and native process registry identity. |
| Launch remains separately gated and argument allowlisted; real bare executable launch remains blocked. |
| Runtime/native surfaces emit read-only heartbeat and snapshot summaries; native status rechecks process lifecycle before `heartbeat_ok`. |
| Runtime observation service provides capability, discovery, attach, status, snapshot, stop, and replay summary. |
| MCP schemas classify into read-only, state-only, text-backed ChangeSet intent, blocked asset plan, or blocked unknown. |
| MVP13 proposal/approval/execute path remains intact and bound to an active observation session. |
| Mutation panel shows blocked asset plans without approve/apply. |
| Editor, Review, Evidence, Settings, and TitleBar expose MVP14 status and do not display raw native paths. |
| Redacted kinds and recorded-only summaries are documented; replay does not invoke native operations. |
| Side-effect scan includes MVP14 kill/save/mutating-MCP/replay/raw-arg boundaries. |
| Runtime matrix target remains at least 40 scenarios / 160 assertions. |

## Acceptance Boundary

MVP14 acceptance does not imply UE asset writes are enabled. Asset mutation, Save All, process termination, broad mutating MCP `tools/call`, and replay re-execution remain blocked.
