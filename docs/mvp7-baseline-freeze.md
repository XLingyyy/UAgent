# MVP7 Baseline Freeze

MVP7 extends the accepted MVP6 shell without replacing the app structure, slice-store architecture, styling system, provider boundary, or MVP5 safety model.

## Known Deferrals

- **MVP7-22 (P2):** Native Tauri command shell for `validate_project_root`, `scan_project_index`, and `preview_project_file` — Rust declarations exist in `lib.rs` but require Rust/cargo toolchain for compilation and verification. Equivalent behavior is provided by runtime fixture services for MVP7. Native bridge validation with real filesystem access is deferred to MVP8.

## Session Replay

Session replay is extended to support project/capability events with a deterministic clock. Replay serialization includes: project root validation, trust decisions, scan start/complete/cancel, file preview open/close, capability request/decision/result, and audit events emitted during the session. The deterministic clock ensures replay produces identical sequences across runs.

## Audit Projection

The audit projection is extended with project/capability filtering. Consumers may query audit events by project root, capability type, decision outcome, or time range. Project events (validate, trust, scan, preview) and capability events (request, gate, execute, cancel) are independently filterable through the projection API.

## Allowed Scope

- Add shared Project Index, Safe Preview, and Capability Bridge contracts.
- Add pure path policy helpers that do not depend on React, Tauri, Node `fs`, or browser APIs.
- Add deterministic runtime fixture services for Project Registry, Project Indexer, Asset Index, Safe File Preview, and Capability Bridge.
- Extend the existing UIProvider project slice and existing sidebar/settings/inspector/workspace surfaces.
- Update MVP7 docs, tests, and side-effect scan categories.

## Frozen Scope

- Do not rewrite `AppShell`, `TitleBar`, `MainLayout`, `LeftSidebar`, `Workspace`, `InspectorPane`, or `GlobalOverlays` ownership.
- Do not replace the custom slice-store with another state manager.
- Do not remove or weaken MVP5 approval, sandbox, audit, session, ChangeSet, provider, or redaction tests.
- Do not remove or weaken the MVP6 scenario matrix.
- Do not add a new router, design system, or shell architecture.

## Native Bridge Boundary

MVP7 may define native bridge interfaces for `validateRoot`, `scanRoot`, and `previewFile`, but the product default remains fixture/read-only. A native adapter must be explicit, root allowlisted, path-contained, audit-emitting, redacted, cancelable, and unable to write, delete, rename, move, create directories, execute commands, open browsers, capture screens, or mutate Unreal state.

## React Side-Effect Rule

React components consume store state and actions only. Components must not directly import or call `fs`, `path`, `child_process`, Tauri commands, MCP sessions, provider live fetch, `window.open`, `location.href`, file pickers, or screen capture APIs.
