> Current engine target (2026-11-03): UE **5.8.4 / CL 58902052**, compatible CL / module BuildId **55116800**. See [current compatibility and verification limits](ue584-compatibility.md). Any 5.8.1/5.8.2 results below are historical evidence, not validation of the current engine or a current release.

# UE semantic v2 read-only contract

See the [unified integration index](ue-build-integration.md#integration-index-t09--t11--t13--t14) for commit order, main-baseline conflicts and mandatory production host boundaries.

The v2 companion reads live editor metadata through five exact MCP tools. It is independent of the existing `UAgentAssetTools` v1 plugin: the old plugin, its identity constants, exact-six tools and native mutation protection remain unchanged. V2 publishes an empty `writeCapabilities` array. Nothing in this contract grants Blueprint creation, editing, compilation, saving or scene mutation.

## Installed API and compatibility

The implementation was checked against the locally installed ModelContextProtocol source (`IModelContextProtocolModule::AddTool`, refresh/remove lifecycle, structured result overload, and the `call_tool` dispatcher). It uses direct native tools; the wrapper route is admitted only after parsing its actual `tool_name` and `arguments`. Arbitrary toolsets, nested wrappers and names outside the exact read registry are rejected.

The historical 5.8.2 test installation's `Engine/Build/Build.version` is 5.8.2 / CL 56702186. Its startup plugin compatibility check reports 5.8.0 / compatible CL 55116800, while the loaded companion's `FEngineVersion::Current()` returns 5.8.2 / CL 56702186. The new plugin descriptor therefore declares the observed compatible 5.8.0 version; no skip-version-check option or engine modification is used. This is one tested Windows x64 installation, not a claim about every engine binary bearing that directory name.

## Discovery and scope

`uagent.v2.capabilities({})` returns `schemaVersion=uagent.semantic.capabilities.v2`, `protocolVersion=2`, `contractVersion=2.0.0-readonly`, an instance ID, public project key, actual engine version, read roots, four exact read descriptors and no write capabilities. Each descriptor includes its input/output schema and availability. The project key changes with the project path/descriptor; instance IDs change on module registration/refresh. Neither is an authorization credential.

The native host must first match its owned editor endpoint/PID and an open trusted-root OS object identity. It then obtains the user's read grant and intersects it with discovered read roots. `negotiateUESemanticV2` takes that trusted host scope; it must never be populated from model text or a peer's self-assertion alone. A v1-only client fails negotiation instead of silently receiving v2 permissions. Missing/mismatched descriptors, unexpected writes, ambiguous catalogs and unsupported versions fail closed. Input and output schemas are compared on both catalog and manifest against exact per-operation fields, required sets, types, optional fields and numeric bounds; matching field names alone is insufficient. Required-field ordering is immaterial, while duplicate/extra required entries fail.

The plugin also requires explicit process-local launch scope:

```text
-UAgentEnableSemanticReads -UAgentSemanticReadRoot=/Game/ApprovedFolder
```

Without it, read capabilities are unavailable. This extra plugin guard does not replace native authorization. The default MCP server auto-start setting is unchanged; an editor session should be explicitly owned, queued and closed by the existing host. Do not create a persistent service or store a broad read scope globally.

Every query requires `protocolVersion:2`, `expectedProjectKey`, and `expectedInstanceId`. `limit` is optional, defaults to 128, and is bounded to 1–256. World/selection queries require `expectedWorldPackage` for a saved ordinary map inside the host grant. Native policy rejects a broader target before dispatch; the plugin compares the actual current world to that exact package before source hashing or actor traversal and rejects world switches. Blueprint/reference queries also require canonical `/Game/...` package names within the granted roots; object suffixes, traversal and sibling-prefix escapes are rejected. Unknown fields are rejected in native, runtime and plugin policy.

| Exact tool                     | Read result and limits                                                                                                                                                                                                                                                                                             |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `uagent.v2.blueprint.describe` | Normal Blueprint parent/generated class, compile status, declared SCS components, declared variable pin metadata, function graph/signature summaries and event names/GUIDs. Inherited members, map terminal value types, full node/edge graphs, specialized Blueprint editors and default values are not expanded. |
| `uagent.v2.world.describe`     | Current saved ordinary editor-world package and source observation. World Partition, external actors, unsaved/out-of-scope worlds and PIE worlds are rejected.                                                                                                                                                     |
| `uagent.v2.selection.describe` | Selected actors belonging to that ordinary world: object/class path, label, location, scale and rotation. Rotation vector x/y/z means roll/pitch/yaw in degrees.                                                                                                                                                   |
| `uagent.v2.asset.references`   | Asset Registry on-disk package dependencies and referencers, bounded/sorted, with loading/truncation facts. This is not an in-memory or exhaustive whole-project reference search. Check `diskExists`, `assetRegistryLoading` and `truncated` before drawing absence conclusions.                                  |

All successful results use `uagent.semantic.result.v2`, bind project/instance/operation, and report `mutationCount:0`. Blueprint reads use object lookup only and never load, follow redirectors, compile, regenerate or save. They accept only an already fully loaded normal Blueprint with no pending load/postload or Blueprint compilation/regeneration state. Cold assets return `blueprint_not_fully_loaded_requires_authorized_preparation`; loading/reloading an asset (including dependency compilation effects) requires a separate explicitly authorized preparation operation, which this read-only contract does not provide. Actual package/object identity must exactly match the requested package before any semantic traversal. Selection labels use `GetActorLabel(false)` and fall back to the object name without populating an empty label. Dirty state before/after and disk hashes remain visible. `expectedRevision` can reject a changed on-disk Blueprint revision before using its result.

These are editor/registry observation snapshots. Disk hashing does not prove that an already loaded editor object or registry record matches newly changed disk bytes. Current plugin results therefore use `cacheable:false`, `origin=editor_or_asset_registry_observation`, and `diskCoherence=not_established`. Do not automatically reload or discard dirty packages. Re-read after changes and let the host reconcile explicit reload needs. `canReuseUESemanticSnapshot` always returns false for this contract, including when callers forge `cacheable:true` or coherence hints. Future reusable indexes need a separately negotiated coherence contract. The parser rejects changed origin/coherence/cache hints rather than treating them as permission to reuse an observation.

## Integration

- Runtime code: `packages/runtime/src/ue-semantic-v2.ts`; no global router/export is changed. Create calls through the negotiated session and validate returned snapshots with `parseUESemanticSnapshot(session, originalCall, structuredContent)`. The parser reauthorizes that exact direct/wrapped request and binds operation, package, exact Blueprint object path and requested revision; passing only an operation name is no longer supported. World/selection calls must include `expectedWorldPackage`. The parser attaches the native host's root object ID, never one asserted in a peer result.
- Native code: `apps/desktop/src-tauri/src/ue_semantic_read.rs`; no Tauri command is registered. `SemanticReadScope::from_verified_host` is for trusted native context only. `validate_semantic_read` unwraps the exact inner call and produces a read-only plan; it performs no network/file operation and mints no approval.
- The host must keep its root/peer read lease current, serialize all calls to the editor, revoke stale session/scope mappings, apply output limits/outbound consent, and persist provenance. Read results cannot broaden a grant. Existing v1 mutation scopes must never be inferred from v2 discovery or `readOnlyHint` annotations.
- `ue-semantic-v2-entrypoints.patch` suggests module declarations/exports only. IPC authorization and the global runtime integration remain the integrator's responsibility; do not add wildcard MCP permissions.

## Isolated verification

Module checks select only these new files:

```powershell
node scripts/test-ue-semantic-v2.mjs
./scripts/test-ue-semantic-v2-native.ps1
```

Use the task's E/G environment helper first. Vite cache respects `UAGENT_VITE_CACHE_DIR`; Cargo artifacts respect `CARGO_TARGET_DIR` and an E/G Cargo home. Native checks use an isolated offline crate, not the Tauri build.

The companion test module creates a fixture only with an explicit `UAgentSemanticLabFixture` flag, matching `UAgentSemanticLabAllowedProjectFile`, project name `UAgentBuildLab`, and the isolated-lab marker. It creates an Actor Blueprint and one ordinary map/actor for read verification. Fixture writes and its finite graceful-exit flag are not MCP tools or advertised product capabilities. The default editor path does nothing in this test module. A separate `UAgentSemanticLabReview` flag, with the same explicit project authorization, prepares a disk-backed cold Blueprint, an in-scope redirector whose destination is outside the read root, and synchronous empty-label assertions. Test preparation can load/create/compile/save its fixed fixture packages; it is not an advertised read capability. Empty-label setup is restored before normal editor UI ticks so unrelated UI getters cannot contaminate the observation. `review-checks.json` and `final-observations.json` are required alongside process exit: an exit code alone does not establish that fixture preparation succeeded.

Real verification must use an owned endpoint and the actual editor. Preserve initialize/tools-list/structured responses, native route checks, Blueprint/map hashes before and after reads, source/DLL hashes, engine/build versions and editor exit status. A synthetic schema test is not UE acceptance. The local E-drive Lab evidence demonstrates Blueprint structure, ordinary world, selected actor, saved map reference, real wrapper dispatch, stale-revision rejection, no asset-byte changes from reads and editor exit 0. Provider/IPC/PIE and arbitrary user projects are outside that verification.

## Separate limited write contracts

The same companion now contains the [T13 fixed pickup template](ue-pickup-template-v2.md) and [T14 current-run scene batch](ue-scene-batch-v2.md), under independent versioned contracts and default-disabled Lab write authority. The read manifest remains `writeCapabilities:[]`; its native adapter never authorizes those tools. T13 configures a fixed native Actor parent rather than arbitrary K2 graphs. T14 creates exactly twenty static objects in a new ordinary map and resumes only within the current owned run; it does not update arbitrary existing maps or recover authority across processes. See each contract for actual schema, preparation/save effects and acceptance limits; do not use the earlier prospective design as an implemented API.
