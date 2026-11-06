# UAgent Product Roadmap

UAgent combines a desktop conversation workspace with policy-controlled Unreal Engine tooling. This roadmap reflects the r14 source reviewed on 2026-11-05 (America/Phoenix). See [README](../README.md), the [current T01–T24 status](next-phase-current-status-20261030.md), and [r14 acceptance](releases/r14.md) for implementation and verification boundaries.

| Area | Implementation boundary |
| --- | --- |
| Desktop | Tauri/React workspace, task composer, project sidebar, optional tool drawer, settings, Chinese/English localization, and incremental conversation rendering. |
| Provider | DeepSeek API and official Codex app-server are active. Responses and Anthropic implementations are archived. Saved DeepSeek credentials use Windows Credential Manager; their native session supports discussion only. |
| Runtime and collaboration | Bounded read-only investigation, pause/resume/cancel, shared budgets, independent members and synthesis are connected. Ordinary Codex conversation and two-member investigation passed real r14 acceptance; dynamic delegation and mixed-provider combinations still need real acceptance. |
| History and memory | SQLite records, session search/rename/archive/branch/continue, and local fact/decision/todo management are connected. Current active providers do not have the approved project-memory dispatch formerly attached to Responses. |
| Projects and UE reads | Trusted-root file/index tools, loaded Blueprint structure and direct asset-reference queries are connected. Codex investigation currently exposes only list/find/read file tools. |
| Build repair | Approved fixed-target builds, diagnostics, up to eight existing Source files, exact diffs and approved writes/rebuilds are connected. Online suggestions cover one file; multiple-file proposals can be imported locally. The native chain allows up to three approved rebuilds. Current-source real UE/model/desktop acceptance remains open. |
| Blueprint and scenes | The pickup creation/compile/save workflow remains limited to the isolated Lab. Scene contract 2.4.0 supports 1–20 reviewed Engine-shape objects in a new map in an ordinary trusted project, with same-run query/resume/save. The plugin has compiled on UE 5.8.4; current load and behavior acceptance remain open. |
| Host and recovery | An application-level Rust host and shared resource queue are connected. Eligible settled source repairs have a newly approved inverse-restore path after restart. The independent TypeScript sidecar, general task continuation and UE object recovery across restart remain incomplete. |

## Remaining product work

- General execution tasks, editable plans, step skipping, mid-task requirements and the optional task-scoped continuous authorization mode from the design.
- Source-linked long-history summaries, project memory in active model tasks, richer source/Blueprint relationship queries, and user-facing capacity/backup/export controls.
- The three original UE workflows on the current desktop/engine: both build-error repair cases, an interactive Blueprint in a supported project, and 20 scene objects with interruption after seven and verified continuation.
- Independent runtime hosting, UI resubscription, general restart continuation, cross-process resource exclusion and current external-effect verification.
- Real dynamic/mixed-model collaboration acceptance and comparison with a single agent; remaining real API error, usage and long-session checks.
- Native pointer drag/double-click and Windows Snap verification on supported systems.
- First-use flow completion, distributable Windows installers, declared signing status, manual upgrade/data-migration checks and Beta acceptance on a clean Windows environment.

The original Responses/Anthropic milestones are a recorded route difference, not completed active-provider deliverables. Current capabilities retain explicit outbound review, native operation approvals, trusted-root containment and separation of saved history from new execution authority. Existing module tests and historical Lab runs cover their recorded versions and scopes; the remaining real acceptance work is listed above.
