# MVP14 Acceptance

## Gate Summary

- G0 docs: README, roadmap, prep, acceptance, risk register, manual smoke, final verification, and handoff documents exist.
- G1 contracts: shared editor observation contracts, evidence kinds, and audit events are represented.
- G2 process policy: trusted root, network root, root escape, missing `.uproject`, shell metacharacter, raw env, executable allowlist, and binding mismatch checks are covered.
- G3 native observer: `ue_editor_process` provides feature-gated observation commands and does not kill or save UE processes/assets.
- G4 session registry: observation sessions bind project/root/project display/process display/status/expiry/heartbeat.
- G5 launch option: launch remains separately gated and argument allowlisted.
- G6 heartbeat/snapshot: runtime/native surfaces emit read-only heartbeat and snapshot summaries.
- G7 service: runtime observation service provides capability, discovery, attach, status, snapshot, stop, and replay summary.
- G8 adapters: MCP schemas classify into read-only, state-only, text-backed ChangeSet intent, blocked asset plan, or blocked unknown.
- G9 state-only hardening: MVP13 proposal/approval/execute path remains intact.
- G10 asset plan UI: mutation panel shows blocked asset plans without approve/apply.
- G11 UI: Editor, Review, Evidence, Settings, and TitleBar expose MVP14 status.
- G12 audit/evidence/replay: redacted kinds and recorded-only summaries are documented.
- G13 scan: side-effect scan includes MVP14 boundary categories.
- G14 scenarios: runtime matrix target is at least 40 scenarios / 160 assertions.
- G15 smoke: fixture smoke is automated; real UE smoke is supervisor-local.
- G16 handoff: delivered/unchanged/open risks are documented.

## Acceptance Boundary

MVP14 acceptance does not imply UE asset writes are enabled. Asset mutation remains blocked by default.
