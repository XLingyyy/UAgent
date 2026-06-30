# MVP13 Prep - Controlled UE Editor / MCP Mutation Pilot

MVP13 adds a controlled path for UE Editor sessions, state-only editor operations, MCP mutating tool dry-runs, and text-backed mutation mapping.

MVP13 does not broaden MVP12 text repair. Any mutation that changes project text must bridge into ChangeSet v2. Any mutation that changes Editor state must become an `UEEditorOperationProposal`. Asset writes and Blueprint compile remain blocked.

Implementation layers:

- Shared contracts: `ue-editor.ts` and `mcp-mutation.ts`.
- Runtime policy/services: editor classifier, session registry, operation approval registry, MCP mutation classifier, dry-run mapper, ChangeSet bridge, scenario matrix.
- Native bridge: feature-gated `ue_editor.rs`, default disabled behind `UAGENT_ENABLE_UE_EDITOR_BRIDGE=1`.
- UI: Editor and MCP mutation panels, Changes/Review/Evidence/ProjectTree summaries from runtime state only.
- Security scan: MVP13 categories for UI native boundary, MCP tools/call, asset mutation, editor save, provider live, raw args/secrets, and replay re-execute.

Non-goals:

- Default real UE launch.
- Asset save/delete/rename/move/compile.
- Generic mutating MCP tools/call.
- Provider live default or automatic provider output apply.
- Git commit/push/reset/checkout/clean or CI workflow changes.
