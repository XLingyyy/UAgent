# MVP15 Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Non-sandbox asset write | Corrupts user project assets | Sandbox package/path policy, native guard, exact MCP adapter allowlist, side-effect scan patterns |
| Save All or broad package save | Writes unrelated assets | Explicit operation classifier blocks Save All and broad/bulk operations |
| Approval token leakage | Enables replay or forged execution | Tokens are one-time runtime values and are not stored in ChangeSets, evidence, audit, UI summaries, or replay |
| Replay re-execution | Repeats asset mutation without consent | Replay service returns recorded summary only and side-effect scan blocks native/MCP execution in replay paths |
| Stale manifest | Verification or rollback uses wrong baseline | ChangeSet execution validates manifest revision and records before/after state |
| MCP schema drift | Unsafe tool accepted as asset mutation | Adapter uses exact tool names, schema validation, dry-run requirement, and sandbox policy classification |
| Facade wrapper misbinding | Generic wrapper method executes outside the reviewed exact contract | Exact-tool facade requires fixed toolset id, method id, schema version, input schema, dry-run schema, rollback contract, affected asset schema, and evidence query before internal `call_tool` use |
| Manifest-only real verification | Fixture manifest state is mistaken for real UE persistence evidence | Real mode blocks verification without UE/MCP read-only state or read-only `Content/UAgentSandbox` filesystem evidence; side-effect scan flags manifest-only real verification language |
| Raw path or secret leakage | Exposes local project details or credentials | Evidence/audit summaries use sandbox package paths and redacted state; side-effect scan checks raw path/token terms |
| Provider auto-apply | LLM output writes assets without approval | Runtime and UI require explicit dry-run and approval; provider live defaults remain blocked |
| Native bridge mismatch | Rust guard diverges from TypeScript policy | Cargo tests cover native guard decisions; docs require paired TS/Rust verification |
| Real UE environment variance | Fixture tests pass but real editor behavior differs | Final supervisor-local smoke must execute create/verify/rollback against a configured UE project |
