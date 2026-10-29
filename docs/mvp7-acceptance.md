# MVP7 Acceptance

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
