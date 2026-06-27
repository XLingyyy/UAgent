# MVP7 Acceptance

## Gate Coverage

- G0: stage docs, roadmap, README, baseline freeze, design plans, and MVP6 regression lock.
- G1: shared project, index, path policy, capability, preview, TaskEvent, audit/session/evidence contracts.
- G2: fixture Project Registry, bridge boundary, root validation, ignore rules, scan limits, traversal and symlink guard placeholders, fixture adapter, desktop store actions, cancellation semantics.
- G3: ProjectIndexer, `.uproject` fixture parser coverage, directory normalization, asset classification, snapshot reducer behavior, diagnostics/evidence mapping, determinism guard.
- G4: sidebar index source, Config Settings project roots, root validation/trust/scan UI, scan status, file preview panel, asset details, search/filter, workspace status, MVP6 regression preservation.
- G5: Capability Bridge for Files, Terminal, Browser, Screenshot, Provider live policy gate, decision normalization, cancellation/timeout semantics, diagnostics/logging.
- G6: approval/sandbox/audit/session/redaction integration points and MVP5/MVP6 regression lock.
- G7: Config Settings index policy, trust confirmation, Provider live manual smoke guard, indexed search UX, Utility Drawer capability dashboard, normalized disabled/block copy.
- G8: 50-scenario MVP7 matrix, side-effect scan hardening, a11y/reduced motion/performance docs, final acceptance docs, full verification suite, native smoke boundary, Go/No-Go notes, MVP8 handoff.

## MVP7-00 Through MVP7-89 Response

| Range | Response |
| --- | --- |
| MVP7-00..04 | README and roadmap mark MVP7 current and MVP6 complete; MVP7 docs link baseline, project-index, capability-bridge, manual smoke, acceptance, and MVP8 prep; MVP6 scenario matrix remains intact. |
| MVP7-10..16 | Shared contracts and policies are added under `packages/shared/src`; TaskEvent, AuditEvent, Evidence types include project/capability/preview extensions. |
| MVP7-20..28 | Runtime fixture registry/indexer/preview services support empty default registry, validate/add/trust/remove/list, scan, cancel, root containment, ignore rules, and deterministic fixture adapter actions. MVP7-22 native Tauri command shell: Rust validate_project_root, scan_project_index, and preview_project_file command declarations exist in lib.rs. Runtime fixture services provide equivalent behavior for MVP7. Native bridge validation with real filesystem access is P2 (requires MVP8 real filesystem access + Rust toolchain). |
| MVP7-30..36 | Runtime indexer emits deterministic snapshots, stable directories/files/assets, warnings, ignored/limit reasons, `.uproject` metadata coverage, and snapshot preservation after cancel. |
| MVP7-40..48 | Desktop UI projects slice, Config Settings, Sidebar Asset Browser, file preview, asset details, filter, workspace status strip, and MVP6 regression tests cover workspace integration. |
| MVP7-50..59 | CapabilityBridge normalizes request -> decision -> result for Files, Terminal, Browser, Screenshot, and Provider live with default disabled/fixture/read-only/manual-live policy. |
| MVP7-60..66 | Approval/sandbox/audit/session/redaction integration is represented through contracts, event mapping, diagnostics, scenario matrix, and existing MVP5 safety tests. |
| MVP7-70..76 | Config Settings exposes Project roots/index policy; trust confirmation gates scan; Utility Drawer shows capability dashboard; Provider live remains manual opt-in. |
| MVP7-80..89 | Runtime runMvp7ScenarioMatrix() executes 50 named scenarios with 86+ behavior assertions. Each scenario exercises real services (registry, indexer, previewer, capability bridge, approval gate, session history, audit projection) with individual pass/fail status. The first scenario is mvp7-stage-docs-current; the last is mvp7-manual-smoke-doc-present. Side-effect scan categories are hardened; manual smoke and MVP8 handoff are documented. |

## Scenario Matrix

Runtime `runMvp7ScenarioMatrix()` executes 50 named scenarios with 86+ behavior assertions. Each scenario exercises real services (registry, indexer, previewer, capability bridge, approval gate, session history, audit projection) with individual pass/fail status. The first scenario is `mvp7-stage-docs-current`; the last is `mvp7-manual-smoke-doc-present`.

## Red Lines

- No real UE write.
- No mutating MCP call.
- No default live provider network.
- No real terminal execution.
- No browser automation.
- No screen capture.
- No filesystem write/delete/move/rename/mkdir.
- No raw secret or raw home path in UI/runtime/audit/session outputs.
- No new state management, routing, or design system.
