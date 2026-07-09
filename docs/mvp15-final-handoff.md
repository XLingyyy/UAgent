# MVP15 Final Handoff

## Delivered

- Shared asset mutation contracts and test coverage.
- Runtime sandbox policy, manifest registry, exact MCP adapter, compliant exact-tool facade helper, lifecycle service, replay summary, 60+ scenario matrix, and tests.
- Runtime real-mode adapter boundary for exact MCP asset tools, native guard ordering, schema/rollback/evidence inventory, and external-evidence verification blocking.
- Desktop Inspector Assets/MCP tabs, Changes and Settings integration, runtime store actions, exact facade discovery, explicit source asset input, generated run ids, and UI tests.
- Tauri native asset mutation guard commands and focused cargo tests.
- Side-effect scan hardening for MVP15 asset mutation boundaries.
- MVP15 documentation for prep, acceptance, risk, manual smoke, verification, and handoff.

## Pending Supervisor Work

- Run real UE sandbox smoke in a local UE Editor project.
- If the current endpoint exposes only `list_toolsets`, `describe_toolset`, and `call_tool`, record `BLOCKED_BY_MCP_SCHEMA` unless `describe_toolset` exposes complete exact method contracts for all six asset operations.
- When blocked by schema, record missing exact tools, input schemas, dry-run schemas, rollback contracts, and evidence query capabilities shown by UAgent.
- Confirm only `/Game/UAgentSandbox/**` is mutated.
- Confirm rollback returns the sandbox asset to the expected before state.
- Decide final acceptance status after reviewing implementation report and smoke evidence.
- Treat real UE smoke as `BLOCKED_BY_ENVIRONMENT` until that supervisor-local run is completed.

## Handoff Notes

MVP15 intentionally keeps asset mutation narrow. The implementation does not expose the generic `call_tool` wrapper to UI/runtime execution as a ready asset tool. It may use `call_tool` only as a facade-internal implementation detail after `describe_toolset` supplies fixed toolset id, method id, schema version, input schema, dry-run schema, rollback contract, affected asset schema, and evidence query capability. It also does not add generic MCP mutation, Save All, non-sandbox writes, provider auto-apply, replay execution, git automation, dependency installation, or CI workflow changes.
