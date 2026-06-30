# MVP14 Acceptance

## Gate Summary

| Gate | Status | Evidence | Open item |
| --- | --- | --- | --- |
| G0 docs | COMPLETE | README, roadmap, acceptance, risk register, manual smoke, final verification, and handoff documents exist. | None |
| G1 contracts | COMPLETE | Shared editor observation contracts include discovery descriptors, heartbeat, snapshots, evidence kinds, and audit events. | None |
| G2 process policy | COMPLETE | Trusted root, network root, root escape, missing `.uproject`, shell metacharacter, raw env, executable allowlist, and binding mismatch checks are covered. | None |
| G3 native observer | COMPLETE | `ue_editor_process` provides feature-gated discovery, attach, status, snapshot, stop, and launch-policy commands without save or kill behavior. | None |
| G4 session registry | COMPLETE | Observation sessions bind project/root/project display/process display/status/expiry/heartbeat and native process registry identity. | None |
| G5 launch option | COMPLETE | Launch remains separately gated and argument allowlisted; real bare executable launch remains blocked. | None |
| G6 heartbeat/snapshot | COMPLETE | Runtime/native surfaces emit read-only heartbeat and snapshot summaries; native status rechecks process lifecycle before `heartbeat_ok`. | None |
| G7 service | COMPLETE | Runtime observation service provides capability, discovery, attach, status, snapshot, stop, and replay summary. | None |
| G8 adapters | COMPLETE | MCP schemas classify into read-only, state-only, text-backed ChangeSet intent, blocked asset plan, or blocked unknown. | None |
| G9 state-only hardening | COMPLETE | MVP13 proposal/approval/execute path remains intact and bound to an active observation session. | None |
| G10 asset plan UI | COMPLETE | Mutation panel shows blocked asset plans without approve/apply. | None |
| G11 UI | COMPLETE | Editor, Review, Evidence, Settings, and TitleBar expose MVP14 status and do not display raw native paths. | None |
| G12 audit/evidence/replay | COMPLETE | Redacted kinds and recorded-only summaries are documented; replay does not invoke native operations. | None |
| G13 scan | COMPLETE | Side-effect scan includes MVP14 kill/save/mutating-MCP/replay/raw-arg boundaries. | None |
| G14 scenarios | COMPLETE | Runtime matrix target remains at least 40 scenarios / 160 assertions. | None |
| G15 real smoke | COMPLETE | Supervisor-local real UE smoke passed: discovery found `UnrealEditor.exe / running`, attach succeeded, heartbeat reported `heartbeat_ok / alive true`, snapshot reported attached project state, and stop observation left UE Editor open. | None |
| G16 handoff | COMPLETE | Handoff documents delivered behavior, unsupported cases, safety boundaries, and final smoke result. | None |

## Current Acceptance Position

MVP14 code and automated coverage implement the minimal real Windows discovery path and preserve the read-only observation boundary. Final acceptance is `COMPLETE` after supervisor-local real UE smoke passed.

## Acceptance Boundary

MVP14 acceptance does not imply UE asset writes are enabled. Asset mutation, Save All, process termination, broad mutating MCP `tools/call`, and replay re-execution remain blocked.
