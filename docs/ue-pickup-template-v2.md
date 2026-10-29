# Fixed pickup Blueprint template v2

See the [unified integration index](ue-build-integration.md#integration-index-t09--t11--t13--t14) for commit order, main-baseline conflicts and mandatory production host boundaries.

The separate `2.1.0-pickup-create-only` contract creates one configurable Blueprint subclass of `/Script/UAgentPickupRuntimeV2.UAgentPickupActorV2`. That native Actor supplies the behavior; this is not a general K2 graph editor. The existing read-only `2.0.0-readonly` manifest continues to advertise no writes, and v1 is unchanged.

The inherited components are a scene root, cube mesh, sphere range indicator and world-space TextRender prompt. Editable defaults are `ItemId:FName`, `PromptText:FText`, `InteractionRadiusCm:float` (integer plan values 50–1000 cm), and `InteractionKey:FKey` (E/F). The local possessed pawn's world-space center distance controls proximity. The configured key collects once, hides the Actor, disables collision and broadcasts `OnCollected`. `bPlayerNearby`, `bCollected` and `CollectionCount` are transient instance state, not an inventory or SaveGame system.

The dependencies are the fixed native parent module, Engine cube and RobotoDistanceField font, one local PlayerController with a possessed Pawn, and normal game input delivery. No Input Mapping Context, Enhanced Input action asset or UMG widget is generated. Missing pawn/controller, assets or invalid configuration produces an explicit runtime error string. Arbitrary parent classes, graph scripts, components, maps and input keys are rejected. Font glyph coverage and layout require rendered validation separately.

## Authorization and scope

Mutation is unavailable by default and unsupported in production projects in this slice. The plugin requires the isolated `UAgentBuildLab` marker (`existingUserProject:false`), an exact approved project file, explicit `UAgentPickupEnableLabWrites` CLI scope and a trusted host approval file at `Saved/UAgentPickupT13/host-approved-plan.json`. The file contains the exact full plan, actual root object identity and distinct preparation/preview/apply permits. It is written by the trusted test harness; discovery, project keys, plan hashes and preview tokens never mint approval. Do not adopt a model-written file as production approval.

The only package root is `/Game/UAgentBuildLab/Pickup_T13`; the exact approved target must be a direct `BP_...` child. The only validation map is `/Game/UAgentBuildLab/Pickup_T13/L_PickupValidation`. The plan binds a stable UUID operationId, targetPackage, expectedDiskState=`absent`, templateId=`actor.pickup.native.v1`, fixed parentClass and the four typed defaults. Unknown fields, nested target folders, object suffixes, traversal, changed plans and identities fail closed. This implementation creates new assets only and refuses existing or dirty target packages.

The native `PickupHostScope` and `PickupHostAuthorization` must come from a verified owned-editor/root lease and explicit exact-plan approval. They cannot be deserialized as authority from model/tool input. The native adapter checks the actual inner tool, compares the entire plan, rejects a model-supplied hostPermit, consumes a distinct permit before each effect, injects it only at transport, binds the reviewed preview and supports revocation. A lost response consumes its permit: query effects before any further action. The host must serialize ownership and revoke stale editor sessions. No IPC command, global router or shared grant is installed by this change.

## Exact tools

- `uagent.v2.pickup.capabilities({})`: separate version/scope/dependency/schema discovery.
- `uagent.v2.pickup.prepare`: explicitly authorized loading of fixed Engine dependencies/native defaults. Loading and potential compilation are effects, never a pure semantic read.
- `uagent.v2.pickup.preview`: constructs and really compiles a transient Blueprint copy, returns typed before/after summaries and a bounded semantic difference. The copy is not saved. Its one-use token is a precondition for apply.
- `uagent.v2.pickup.apply`: creates and compiles the exact approved target and saves only that package. The known validation map is created separately by an explicitly enabled test fixture, not by an advertised scene writer.
- `uagent.v2.pickup.query`: reconciles the one target's persisted receipt/hash and reports individual disk/editor effects without loading an asset. State is for target creation; preparation and transient previews are session-only.

Every non-discovery call binds protocol/contract version, project/session/root identity and full plan. Input schemas are closed and exact. The runtime compares catalog/manifest schemas and validates actual response envelopes plus operation/plan/package effects. It refuses an applied claim without an observed disk file/hash. Cold Blueprint reads remain rejected by the separate semantic-read adapter; explicit test preparation may reload the exact saved target.

## Write boundary and recovery

The plugin holds physical project/output directory handles, denies directory deletion while owned and rejects reparse directories. Final target creation uses `NtCreateFile(FILE_CREATE)` relative to the held approved directory object, with one safe leaf and exclusive access; an externally created target is never overwritten. Effect hashing reads that same directory-relative leaf, rejects reparse/hardlink files and is bounded to 64 MiB. The Windows contract for relative object attributes and create-only disposition is documented by [Microsoft](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntcreatefile).

UE first serializes only the target package to a unique staging file under the Lab's Saved folder. A receipt records intent and expected BLAKE3 bytes before final creation. A partial write/crash yields an unknown effect that must be reconciled; this is not a transactional whole-editor save or automatic rollback. UE staging/loader APIs and receipt files still use paths, so this slice does not claim atomic namespace binding across the entire UE operation. Keep the native root/editor lease and single owner; do not expand this experimental writer into production permission.

No whole-project save, overwrite/update, arbitrary existing Blueprint edit, multiplayer, packaging, 20-object scene batch or rendered UI acceptance is included.

## Local verification and integration

Run `node scripts/test-ue-pickup-template.mjs` and `./scripts/test-ue-pickup-template-native.ps1` under the E/G environment helper. Fixtures for runtime schema checks are sanitized real UE descriptors; synthetic tests do not establish gameplay acceptance.

The guarded editor test module reloads the saved Blueprint under explicit test preparation, checks non-default typed values, creates only the named ordinary map, and observes real PIE enter/leave range, wrong/right input, hidden/collision/count state and duplicate rejection. It injects input using the owning player's mapped device and drives the normal Controller input frame for deterministic Automation. Physical keyboard focus and pixels/glyph layout are outside NullRHI verification. Saved Blueprint/map hashes must remain unchanged through PIE. A resume run verifies existing hashes and loads those same assets without saving or replaying creation.

Runtime/native files remain independent. `ue-pickup-template-v2-entrypoints.patch` suggests module exports only; the integrator owns the actual protected IPC/transport route, resource lease and trusted permit issuance. Plugin/runtime production activation is intentionally absent.

The local UE 5.8.2 / CL 56702186 vertical evidence uses the same persisted `BP_T13PickupCell` and `L_PickupValidation`: creation/real Blueprint compilation/one-package saving are recorded in `Evidence/pickup-v2-session`; completed PIE/Automation behavior is recorded in `Evidence/pickup-v2-behavior-retry4`. The earlier failed input-driver attempts remain classified as failed. The final run checks F/240 cm defaults after disk reload, wrong E versus configured F, collection count/hiding/collision, input-stack recovery, dirty/existing-target rejection, duplicate collection rejection and unchanged asset bytes. Input E also moves the standard DefaultPawn, so the test releases it and clears only its test movement before the independent F assertion. No mutation tool is replayed during behavior retries.

The native apply permit is consumed only after an actual nonempty host-bound preview token matches the request string; null/missing/wrong-type tokens cannot burn it. Effect queries use no-load Blueprint lookup and distinguish `none`, `package_loaded`, `blueprint_not_ready`, `blueprint_loaded_uncompiled`, `dirty_loaded`, `compile_failed` and `compiled_loaded`. A disk receipt may remain applied while the editor asset is unloaded; this is not current editor compilation evidence. Runtime apply success requires `compiled_loaded`; missing/null/failed/uncompiled observations are rejected.
