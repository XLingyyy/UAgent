# MVP15 Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Non-sandbox asset write | Corrupts user project assets | Sandbox package/path policy, native guard, exact MCP adapter allowlist, side-effect scan patterns |
| Save All or broad package save | Writes unrelated assets | Explicit operation classifier blocks Save All and broad/bulk operations |
| Approval token leakage | Enables replay or forged execution | Native issues a 256-bit token only after validation, stores only SHA-256, enforces a 60-second maximum TTL, and the desktop/runtime clears the raw value on first execute attempt, registration failure, expiry/reject, terminal cleanup, or a new run; it is never stored in ChangeSets, DOM, evidence, audit, MCP, or replay |
| Arbitrary non-empty token accepted | Bypasses approval provenance and complete binding | Registration rejects unknown caller fields and does not accept a caller token; native binds TTL, ChangeSet/run/root/session/PID/observations/aggregate hashes/order/paths before issuing the secret |
| Unknown plugin result treated as success | Records mutation success without exact evidence | Execute/rollback results use strict allowlisted keys and exact field/path/hash/phase matching; malformed or unknown results fail closed |
| Replay re-execution | Repeats asset mutation without consent | Replay service returns recorded summary only and side-effect scan blocks native/MCP execution in replay paths |
| Stale manifest | Verification or rollback uses wrong baseline | ChangeSet execution validates manifest revision and records before/after state |
| MCP schema drift | Unsafe tool accepted as asset mutation | Adapter uses exact tool names, schema validation, dry-run requirement, and sandbox policy classification |
| Facade wrapper misbinding | Generic wrapper method executes outside the reviewed exact contract | Exact-tool facade requires fixed toolset id, method id, schema version, input schema, dry-run schema, rollback contract, affected asset schema, and evidence query before internal `call_tool` use |
| Manifest-only real verification | Fixture manifest state is mistaken for real UE persistence evidence | Real mode blocks verification without UE/MCP read-only state or read-only `Content/UAgentSandbox` filesystem evidence; side-effect scan flags manifest-only real verification language |
| Raw path or secret leakage | Exposes local project details or credentials | Evidence/audit summaries use sandbox package paths and redacted state; side-effect scan checks raw path/token terms |
| Partial execute or rollback failure | UI reports a terminal state while assets still need recovery | Successfully completed operations become reversible; an exact-tool `partial_failure` receives ownership only when the strict result also proves an observed reversible side effect. Transport/unknown failures receive no ownership; failure retains `rollback_available`, the failed inverse action keeps its evidence for UI audit, and completed rollback actions are not repeated |
| Run-root cleanup escapes or deletes content | Rollback removes another run, the shared sandbox container, or user asset data | Cleanup derives and owns only the exact registered `/Game/UAgentSandbox/<run-id>` root, recursively proves it contains no assets/files, rejects reparse points and containment ambiguity, and removes only that empty run tree; it never broadens ownership to the fixed `/Game/UAgentSandbox` container. Final verification accepts that container only when absent or resolved under the accepted Content root as an ordinary non-reparse directory with zero direct or recursive children, files, and subdirectories; any child or unresolved state fails closed and rollback failures preserve rollback state |
| Rollback replay | Repeats inverse mutations or deletes unowned data | Native rollback phase enforces reverse order and one-time outcome state; repeated rollback blocks before MCP |
| Provider auto-apply | LLM output writes assets without approval | Runtime and UI require explicit dry-run and approval; provider live defaults remain blocked |
| Native bridge mismatch | Rust guard diverges from TypeScript policy | Cargo tests cover native guard decisions; docs require paired TS/Rust verification |
| Real UE environment variance | Fixture tests pass but real editor behavior differs | Final supervisor-local smoke must execute create/verify/rollback against a configured UE project |

Current candidate status: `PASS_REAL_SMOKE candidate / awaiting supervisor review`.
