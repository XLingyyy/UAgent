# UE integration index and build API

## Current desktop integration

Current source registers native build/repair, managed semantic reads, pickup and scene commands. UE targets **5.8.4 / CL 58902052**, compatible CL / module BuildId **55116800**. Implementation, isolated checks and real desktop acceptance have different scopes; see [r14](releases/r14.md) and [current compatibility](ue584-compatibility.md).

The unreleased 2026-11-06 preview passed two real desktop repair scenarios on the isolated UE 5.8.4 UAgentBuildLab project: C2065 compiler failure and missing HTTP module dependency. Each used a real temporary DeepSeek session, exact outbound review, proposal adoption, native diff/write approval and separately approved rebuild to exit 0. Both requests supplied two approved files; each proposal changed one file. There were two model requests, two writes and two rebuilds, with one of three allowed rebuilds used per chain. See [run IDs and acceptance scope](t22-current-delivery-20261103.md#2026-11-06-构建修复真实桌面验收) and [online suggestion limits](t22-online-repair-suggestion-20261104.md).

A copy of the user's empty Blueprint project Test01 passed both manual-draft and real DeepSeek two-file repair chains. After correcting the temporary key, one model request proposed one-line changes in each of `.cpp` and `.h` (`BasValue` to `BaseValue`, `4O` to `40`), preserving CRLF. Both files were applied in one approved native batch, and the separately approved rebuild succeeded at exit 0 with 1/3 rebuilds used. The displayed estimate was 0.020082 CNY; actual billing is unverified. The original project had no Source and no files in Content; the controlled module was added only to the copy, leaving the original unchanged.

Safe error classification passed 43 focused tests, type checking, Vite and native builds. The diagnostic preview observed an `auth_missing` classification for a server HTTP 401/403 authentication rejection before the corrected-key success. The earlier two generic failures remain untraceable; they are not assigned the same cause.

The three-rebuild limit also passed a separate real desktop run using manual drafts and no model calls. Three separately approved writes and rebuilds reduced the diagnostic count from 4 to 3 to 2 to 1; the final build still exited 6. Storage verification confirmed all three writes and three rebuilds settled with `verifiedCompleted` effects, and the UI stopped after round three with no fourth rebuild. This verifies the limit and stop behavior, not a successful repair or three model-generated proposals.

A live two-file preflight conflict also passed: after the exact preview, an external edit to the second `.h` file left `.cpp` `not_started` and `.h` `conflict`. Run `d4d0ecbe4060e890d32b471bdb3ac920` settled as `verifiedNotOccurred`; byte checks confirmed both the original cpp and the external header edit were preserved. No before-image backup, restore candidate or rebuild was created.

| Slice | Current source and remaining boundary |
| --- | --- |
| T09/T10 build repair | Approved build, diagnosis, precise review and batch repair of 1–8 existing Source files are connected. Online suggestions are reviewed per file and adopted into drafts in one action; local imports retain per-file adoption. Online requests retain the 32 KiB request and 1024 output-token limits; truncated or out-of-scope suggestions are rejected. Each write and rebuild is separately approved. The native chain allows at most three rebuilds and feeds fresh failures into the next round. The two isolated single-file real-model flows and both Test01 manual-draft and model-proposed two-file write/rebuild chains passed. The three-rebuild cap passed separately with manual drafts and a final failed build. Full goal-driven repair, existing game source, runtime behavior, failure recovery and Beta readiness remain unverified. See [current workflow delivery](t22-current-delivery-20261103.md). |
| T11/T12 semantic reads | Ordinary trusted projects have managed read-only startup and exact queries for already-loaded Blueprint structure and direct Asset Registry references. Cold asset preparation and a complete source/Blueprint relation search remain open. Current Codex investigation exposes file tools only. See [managed reader](../apps/desktop/web/src/workspace/ManagedBlueprintReadWorkflow.tsx) and [read tools](../apps/desktop/web/src/runtime/project-read-tools.ts). |
| T13 pickup | Startup, compiled preview and separately approved creation/save are connected for the fixed native-parent template in the isolated UAgentBuildLab only. Ordinary-project writes, product test-map/PIE behavior verification and unknown-effect recovery remain open. See [pickup contract](ue-pickup-template-v2.md). |
| T14 scene batch | Contract 2.4.0 supports a trusted ordinary project, a new map under the fixed scene root and 1–20 reviewed Engine-shape objects, with query, same-run continuation and separate save approval. Its current plugin compiled against 5.8.4; live load/protocol and ordinary-project execution remain unverified. See [current scene contract](ue-scene-batch-v2.md). |
| Recovery | Source repair has limited reapproved restoration from eligible completed records. Native history-event decoding was corrected with 19 focused tests and integrated type checking; completed-write recovery admission was corrected to allow an original operation with no remaining barrier, with nine native tests using real process exit and SQLite. The updated web and native builds exited 0. After reopening the same profile, real desktop write/build history details and attachment entry points were readable; they remain read-only and do not resume execution. Restoration writing still awaits the user's renewed trust in the restored Test01 copy. Scene continuation remains within the current owned run; general cross-process task continuation is incomplete. See [effect reconciliation](effect-reconciliation.md). |

The C++ design demonstration now has bounded current-product acceptance for both code and module-dependency failures. Pickup creation plus visible interaction in a test map, and a 20-object ordinary-project scene with cancellation after seven and continuation without duplicates still require current-product acceptance. Historical UE 5.8.2 Lab results and plugin compilation do not establish those remaining results. Compiler success also does not prove the repaired source meets its functional goal.

The live acceptance also resolved three integration blockers: re-trusting a restored project now restores `nativeSource` and native capability state; outbound review uses a browser-native `<dialog>` above the build modal; and the native build environment retains `ProgramData`, which .NET uses when resolving CommonApplicationData. Omitting it caused UBA initialization to dereference a null directory. UBA remains enabled; no `-NoUBA` argument or global UE configuration change was used.

Local evidence is in `.local-dev/temp/ue-build-repair-acceptance-20261106/live-desktop/compiler-live-cycle-summary.json` and `http-live-cycle-summary.json` in the same directory; these files are not published with the repository. The Test01 chains are recorded locally in `.local-dev/temp/test01-build-repair-acceptance-20261106/live-two-file-summary.json` and `live-model-two-file-summary.json` in the same directory. The model chain ran from initial failure `e2cde551a0e7bf57bfc570167a632e69` through write `7f678c2c31eae3549e78e3e3265349e7` to successful rebuild `45ab510b34dd24286662da650779f06f`. The separate manual three-round limit and preflight conflict results are in `live-round-limit-summary.json` and `live-conflict-summary.json` in the Test01 evidence directory. SQLite and original receipts establish process/write/cycle results; model requests and approval interactions are desktop observations. Localized Chinese diagnostic text remains lossy or unverified; ASCII codes, paths and native process outcomes carry the verified diagnostic evidence.

## Historical module import and activation notes

The following import, activation and Lab records retain their original implementation-stage claims through the bounded-repair subsection. Statements about unregistered commands or Lab-only scene writes describe that stage; use the current table above for product status. The later Build API sections describe the module contract.

The reviewed final UE module tree from `2a60b1b77e0bae30dfc852511e62b40cf603b43e`
is included in this development branch. Code availability does not establish a
production command or an end-to-end desktop workflow. No UE v2 module declaration,
public runtime export, protected IPC handler, tool registration, approval grant,
editor session or production write permission is enabled by this integration.

| Slice | Included reviewed implementation | Contract |
| --- | --- | --- |
| T09 build | `d76ef15` + `2de667d` | Native `ue_build_profile.rs` / `ue_build_process.rs`; runtime `ue-build-profile.ts` / `ue-build-diagnostics.ts`. One bound Windows target, schema 1. |
| T10 repair | `2a60b1b` | Native `ue_build_repair.rs` / `ue_build_repair_io.rs`; runtime `ue-build-repair.ts`. [Protected repair ports](ue-build-repair.md). |
| T11/T12 semantic reads | `9c08865` + `456d0f9` + `5655802` | Native `ue_semantic_read.rs`; runtime `ue-semantic-v2.ts`; companion `UAgentSemanticToolsV2`. [Read contract](ue-semantic-v2.md), `2.0.0-readonly`. |
| T13 pickup | `42042e6` + `6534987` | Native `ue_pickup_template.rs`; runtime `ue-pickup-template-v2.ts`; companion pickup runtime/tools. [Pickup contract](ue-pickup-template-v2.md), `2.1.0-pickup-create-only`. |
| T14 scene batch | `001e8fe` + `bd880f0` | Native `ue_scene_batch.rs`; runtime `ue-scene-batch-v2.ts`; companion scene tools and `Resources/scene-batch-v2-schemas.json`. [Scene contract](ue-scene-batch-v2.md), `2.2.0-scene-batch-current-run`. |

Native paths are under `apps/desktop/src-tauri/src`; runtime paths are under
`packages/runtime/src`. UE modules share `integrations/unreal/UAgentAssetToolsV2`.
Its descriptor remains default-disabled, Win64, `EngineVersion:5.8.0`, with the
engine's `ModelContextProtocol` dependency. Existing isolated acceptance used
UE 5.8.2 / CL 56702186; other engine/platform versions and packaging are unverified.
The two `*Tests` editor modules are gated Lab fixtures. Saved pickup Blueprints
require their native runtime parent; the scene schema resource must accompany
the plugin, and missing/invalid resources fail closed.

### Shared entrypoints and compatibility

The final modules were added without replacing the current desktop/runtime
entrypoints. Existing held-root handles and Responses prefix readers/tests remain
intact; T10 adds only the crate-private checked directory-handle borrow described
in [the repair contract](ue-build-repair.md). A borrowed handle is not an approval.

The `*-entrypoints.patch` files are unapplied declaration/export examples. Future
activation must reconcile current `lib.rs` and runtime `index.ts`, supply protected
IPC/MCP handlers, exact operation grants, global resource ownership and durable
effects. Neither the legacy `UAgentAssetTools` plugin nor its exact-six v1
allowlist grants access to v2 tools. Read discovery cannot authorize writes.

### Build identity

Production-source boundary v3 includes the imported native/runtime modules, the
v2 plugin descriptor, Source and Resources, optional Build/Config roots, and the
exact scene-schema generator. Descriptor-loaded editor test modules remain
hashed inputs. Only the listed standalone test runners, the cfg(test) repair
source and the synthetic discovery fixture receive exact test exclusions;
documentation uses the existing documentation rule. Unclassified tooling still
rejects a build. This inventory coverage does not register or authorize UE tools.

### Required trusted host boundary

These are integration requirements, not capabilities already supplied by importing the modules:

| Boundary | Actual host checks required before dispatch |
| --- | --- |
| Trusted project root | Resolve a native-selected project, retain an open directory handle and bind volume/file ID; revalidate identity/current trust and scoped descendants before preparation, dispatch and reconciliation. Public root IDs, project keys, hashes and canonical path strings are comparison data. The current native registry retains held volume/file-ID roots and Responses reads use those guards. Every future UE operation must resolve that same live authority and bind its own exact scope; importing these independent modules does not perform that host lookup. Root/namespace replacement remains a fail-closed integration concern. |
| Owned editor / lease | Native registry owns PID/process handle, executable/project binding, loopback MCP endpoint and connection, project/instance ID, root identity, run/step and host-session generation. Verify the actual peer before negotiation, serialize transport calls, check the live lease immediately before each effect, and revoke on trust/project/editor/run/session change or expiry. A peer's self-assertion or reconstructed JSON scope cannot renew ownership. |
| Approval | Obtain explicit exact-scope review independently from model input. Atomically reserve and consume unexpired, unrevoked, one-use operation grants; reject replay/duplicate dispatch. Bind target/profile or full immutable plan, source/absence preconditions, root/editor/run/step and capability. Prepare that may load assets is a separate effect; compile/save permissions must be explicit. Preview/query tokens and fingerprints are not approvals. Existing read-only `RunScopeAuthority` and Provider Responses grants are not UE write grants. |
| Resource ownership | A native/global scheduler reserves project + engine build resources and the editor/world/package resources by trusted identity. Keep grant consumption, active-owner registration and dispatch coordinated. Do not build against an editor already owned by another task, dispatch concurrent mutations, or release ownership merely because cancellation was requested. Reconcile actual effects and retained unsaved state before the next owner proceeds. |
| Protected IPC / MCP | The frontend/model supplies only exact closed-schema operation arguments or opaque host handles. Native resolves the trusted registry; it never accepts a serialized `from_verified_*` scope, raw root/PID, `hostPermit` or approval file as authority. Check the actual inner tool of wrapper calls, negotiate exact catalog/manifest schemas and validate actual responses against the original request. Inject private per-purpose permits only after host authorization. Recheck root/lease/revocation at the final dispatch gate. Discovery alone cannot open a session. |
| Evidence / recovery | Persist intent before effects and observed results after effects with operation/item IDs, ownership and raw local transport/process provenance. Reconcile lost responses before retry; cancellation does not undo writes. Only owned transport results may bind preview/query checkpoints. Share logs or semantic data with a Provider only through the existing outbound consent/redaction policy. |

For T09, keep opaque prepared plans and cancellation tokens in the native registry, use the suspended-process resume gate, and require actual exit/tree/output evidence for build success. Held read-only file handles do not pin the entire source tree, engine scripts, dynamically loaded code or ancestor namespace.

For semantic reads, intersect host grants with discovery roots before dispatch. World/selection require the exact saved `expectedWorldPackage`; Blueprint reads require already fully loaded exact objects and reject redirectors. Bind response parsing to the original call and revision. All current observations are non-cacheable with disk coherence unestablished; cold loading requires a distinct authorized preparation contract.

For pickup, use distinct prepare/preview/apply grants. Bind a real nonempty reviewed preview token before consuming apply, query unknown effects without reapplying, and distinguish disk receipt state from actual loaded/compiled Blueprint state. For scene batches, use distinct prepare/execute/cancel/resume/save grants, native serial ownership and a fresh owned query of every item before resume/save. Actor count/tags alone never establish ownership. Current-run weak object/GUID identity cannot be rehydrated after a host/editor restart.

### Activation and evidence limits

T09/T10 and semantic reads are present as unregistered modules awaiting protected desktop/host integration. T13/T14 writers remain **Lab-only and default-disabled**, with hardcoded isolated marker/project/root checks. Their test-host approval files and launch flags apply only to `UAgentBuildLab`, `/Game/UAgentBuildLab/Pickup_T13` and `/Game/UAgentBuildLab/Scene_T14`. Do not copy those files/flags into user projects, rewrite the constants to a broad `/Game` root, issue production permits from model JSON, or use a v1 grant to bypass the gates. Production writer activation needs a separately reviewed general project-bound authority implementation; it is not an integration toggle.

The reusable transport flow is host authorization → exact inner-tool dispatch → actual result validation → owned checkpoint/effect observation. Native constructors enforce local shape/state but rely on the caller to have verified the live OS/root/editor lease; their names do not perform that verification. Current writers stage and exclusively create only specified new packages. They do not overwrite existing maps/assets, save the whole project, provide rollback, or guarantee an atomic whole-editor/filesystem transaction.

Existing real acceptance evidence is local to the sole E-drive isolated Lab, under the isolated Lab's local `Evidence` directory:

| Slice | Existing evidence and practical limit |
| --- | --- |
| T09 | `real-build-validation.json`: actual adapter path, baseline / intentional C2065 / repaired UBT exit codes 0 / 6 / 0. A missing-module failure was not part of that real sequence. |
| T10 | `t10_missing_http_final` / `t10-native-http-repair-final`: actual missing HTTP linker dependency (LNK2019/LNK1120, exit 6), approved Build.cs repair, then the same fixed target exit 0; nine existing asset hashes unchanged. See [repair evidence limits](ue-build-repair.md). |
| Reads | `semantic-v2-session-verified`, `semantic-v2-review-fixed-retry2`, plus `discovery-output-schema-check.json` in the latter: actual structure/world/selection/reference reads and rejection/schema checks. Empty-label observation used the same handler in process; cold/private/redirector assets do not all have matching pre-read byte baselines. |
| Pickup | `pickup-v2-session`, `pickup-v2-behavior-retry4`, `pickup-effect-observation-check`: real saved/compiled/reloaded Blueprint and PIE/Automation behavior of the fixed native-parent template. No arbitrary K2 graph editor, physical keyboard focus or rendered UI acceptance. |
| Scene | `scene-v2-session`: 20-item save and cancel-after-seven → owned query → remaining-thirteen resume/save, per-actor identities/references/transforms, hashes and unchanged older assets. Final failure-report guards received a later incremental compile; those exceptional branches were not live fault-injected. |

These captures do not establish protected main IPC, production user-project writes, packaging, rendered scene quality or cross-process recovery. The T14 dirty-world and equivalent-rotation fixes were reviewed independently. Protected host wiring and end-to-end acceptance remain outstanding; code import does not complete those boundaries.

### Bounded build repair

The separate [T10 repair contract](ue-build-repair.md) adds finite multi-file previews, native exact-source approval/apply/recovery and held after-state input guards for T09. Integrate it after T09 and the Windows held-root module; its entrypoint patch is a declaration/export suggestion only. Main protected IPC, native registry, approval UI, resource scheduling and run-store adapters remain explicit integration work.

## Build API

The build modules prepare and execute one explicit Windows UE C++ target. They do not launch an editor, choose an arbitrary executable, run free-form shell text, apply source changes, or approve their own execution. The runtime host supplies a trusted project-root object and a separate one-use execution authorization. A fingerprint is public plan data; equality with it is not approval.

## Modules and entrypoints

- `packages/runtime/src/ue-build-profile.ts`: JSON contracts, early form validation, and the process-evidence success predicate.
- `packages/runtime/src/ue-build-diagnostics.ts`: incremental, bounded UHT/UBT/MSVC/Clang/linker diagnostics. No filesystem access.
- `apps/desktop/src-tauri/src/ue_build_profile.rs`: canonical path checks, engine/project association, fixed entrypoint resolution, and binding fingerprint.
- `apps/desktop/src-tauri/src/ue_build_process.rs`: blocking execution with an owned Windows Job, bounded output capture, cancellation, timeout, and exit evidence.

`ue-build-entrypoints.patch` retains the original declaration/export sketch. Current desktop registration is in [lib.rs](../apps/desktop/src-tauri/src/lib.rs); [ue_build_execution_commands.rs](../apps/desktop/src-tauri/src/ue_build_execution_commands.rs) supplies the approved build entry. Native code uses the existing serde, serde_json and sha2 dependencies; Windows APIs use direct FFI. The following profile and host requirements still apply to each dispatch.

## Profile

```ts
const profile: UEBuildProfile = {
  schemaVersion: 1,
  profileId: "sandbox-editor",
  projectId: "the-hosts-bound-project-id",
  engineRoot: "C:/UE_5.8",
  uprojectRelativePath: "BuildSandbox.uproject",
  target: "BuildSandboxEditor",
  platform: "Win64",
  configuration: "Development",
  method: "ubt",
  bundledDotnetVersion: "10.0",
  timeoutMs: 600_000,
};
```

`bundledDotnetVersion` selects an exact directory under `Engine/Binaries/ThirdParty/DotNet/<version>/win-x64`. Native preparation requires its `dotnet.exe`, the fixed UBT apphost, DLL and runtime configuration. UBT runs with that DOTNET_ROOT, disabled multilevel lookup and LatestMajor roll-forward. `build_bat` instead uses the fixed `Engine/Build/BatchFiles/Build.bat` through the Windows system `cmd.exe`; its SDK resolution remains owned by the engine script. No PATH lookup chooses the initial executable.

Arguments are exactly target, Win64, configuration, `-Project=<canonical-uproject>`, `-WaitMutex`, `-NoHotReloadFromIDE`, and `-UTF8Output`. Working directory is the bound engine's `Engine/Source`, matching the installed Build.bat contract. There is no extra-arguments or environment-override field. This is a full target build, with no Live Coding success claim.

Preparation rejects traversal, alternate data streams, missing target rules, symlinks/junctions escaping either root, nonnumeric SDK selections, unsupported platform/configuration/method, and timeouts outside 1 second to 2 hours. The target must have a matching `Source/<Target>.Target.cs` beside the selected uproject. Uproject `EngineAssociation` must equal the installed major.minor or major.minor.patch. GUID/blank source-engine associations require a future trusted resolver and currently fail closed. Batch paths containing parentheses are explicitly unsupported; both methods reject shell expansion/control characters. Only Windows x64 is currently supported.

The SHA-256 fingerprint describes the checked profile, canonical paths, command/argv/cwd, timeout, uproject, target rules, engine version and entrypoint bytes. Execution first opens those checked files with read-only handles that deny write/delete sharing on Windows, rechecks the fingerprint while holding the handles, and retains the handles through process completion. A busy file or changed binding stops before launch. The targeted Windows test proves ordinary write, delete and rename attempts fail while those handles are held and succeed after release.

This is **not an atomic filesystem-to-process binding guarantee**. Ancestor directories/reparse-point namespace changes, unlisted dynamically loaded DLLs, build scripts, and source-tree contents are not all pinned by these file handles. Path strings and a fingerprint do not identify a trusted root object. The host must bind the volume/file identity of an open trusted-root handle, detect replacement/revocation, check ChangeSet conflicts and reserve the project/engine resources. Protection against hostile concurrent namespace mutation is not established by this module. Do not expose its raw Rust entrypoints directly as an authorized IPC command.

## Host integration

1. Resolve the existing trusted-root handle in native code, bind its OS object identity (volume/file ID, not merely a canonical string), confirm the handle remains current, and confirm that its project ID matches `profile.projectId`. Do not take a raw project root supplied by the model as authorization. Call `prepare_ue_build(&profile, trusted_root)` on a blocking worker. Keep the opaque `PreparedUEBuild` in a native registry with a short host-defined TTL; return only `prepared.preview().clone()` for review.
2. Persist the execution intent and atomically consume an unexpired, unrevoked, one-use build grant bound to the trusted-root object identity, run/step, profile, fingerprint, capability and permitted write scope. Reject replay and duplicate dispatch, and recheck revocation before the resume gate. Neither a public fingerprint nor an owner supplied by a model is such a grant. Build authorization covers engine/project build logic and writes to build artifacts, caches and engine build tooling as applicable. A read-only scope or a text-write approval alone is insufficient. The native module deliberately does not mint or consume global approval tokens; the existing runtime host owns that policy.
3. Reserve the project and engine build/editor resources by their trusted identities in the global scheduler; coordinate that reservation with one-use grant consumption before dispatch. Use `(runId, stepId, fingerprint)` as the execution owner. Atomically register one `UEBuildCancellation::new(owner.clone())` before dispatching `execute_ue_build(&prepared, owner, &cancel)` to a blocking worker. Reject duplicate owner/step dispatch; keep completed results so retries cannot silently run a second build. Do not reconstitute an executable plan from a JSON preview.
4. Cancellation looks up that exact registry entry and calls `cancel.cancel(&owner)`. Cancellation and ResumeThread share a start-state mutex: a cancellation that wins the gate prevents the suspended process from running; a cancellation ordered after resume is a running-process cancellation with possible effects. The method rejects mismatched run, step or fingerprint. Do not use a PID from the UI as a kill target. Application shutdown should request cancellation, wait for the result/checkpoint, and release the resource; closing the host also closes its kill-on-close Job handles.
5. Persist the process result, local raw stdout/stderr and command evidence in the task's existing storage. Use `parseUEBuildExecutionDiagnostics(result, { ...roots, diagnosticCwd: preparedPreview.cwd })` for a completed native result; it preserves stream tags and native truncation/incomplete-output evidence. For streaming input use `UEBuildDiagnosticParser` with distinct stream tags and propagate any capture truncation to its summary. Parse output locally; sharing raw output with a Provider requires the existing outbound consent checks. Relative diagnostics resolve only against that trusted native cwd (normally Engine/Source); an unknown base does not create a project link. For path navigation, resolve `projectRelativePath` again through the trusted-root reader; log locations are untrusted suggestions.
6. Use `isVerifiedUEBuildSuccess(result)` for this target's build verification. A successful build does not establish PIE behavior, Blueprint compilation, asset correctness, or a repaired functional goal. A repair loop also checks that the result belongs to its current owner and current ChangeSet, and observes its configured attempt limit.

Suggested native call shape after the host has resolved scope and approval:

```rust
let prepared = Arc::new(prepare_ue_build(&profile, &trusted_root)?);
let preview = prepared.preview().clone();
// Return preview for review; retain `prepared` in the host registry.
// Later, consume the host's approved scope for preview.fingerprint:
let owner = UEBuildOwner { run_id, step_id, fingerprint: preview.fingerprint };
let cancellation = UEBuildCancellation::new(owner.clone());
// Register cancellation before spawning this blocking closure.
let result = execute_ue_build(&prepared, owner, &cancellation);
```

Do not hold a registry mutex across execution. Keep the prepared plan and cancellation token alive until the worker finishes. The global host must provide intent persistence, approval consumption, idempotency, resource exclusion, IPC and event forwarding; none of those shared subsystems are modified by these modules.

## Status and process ownership

The child is created suspended, assigned to a private Job with `KILL_ON_JOB_CLOSE`, and only then resumed with the Win32 thread API. Assignment/resume failure prevents execution and fails closed. No breakaway is enabled. After root exit, a maximum 200 ms grace (within the build timeout) allows Job accounting to settle and short-lived descendants to finish naturally. Cancellation/timeout terminates that Job, checks for zero active processes, and retains the actual root exit code when observed. The executor never calls taskkill or terminates an unrelated existing editor.

| Status                | Meaning                                                                                                                                            |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `not_started`         | Invalid owner/approval binding, changed profile/files, spawn failure, unsupported host or ownership setup failure. Normally no PID and no effects. |
| `succeeded`           | Root exit 0, owned tree empty and output completely drained.                                                                                       |
| `failed`              | Root exit nonzero, output read failure, or root exit with live/unknown descendants. Residual owned descendants are terminated.                     |
| `cancelled`           | Cancellation requested before start or while running; `effects` distinguishes those cases.                                                         |
| `timed_out`           | The configured elapsed limit triggered and the owned tree was confirmed stopped.                                                                   |
| `termination_unknown` | The executor could not confirm process-tree shutdown. Preserve the original trigger in `reason`, pause reconciliation and do not auto-retry.       |

`exitCode` is the actual root exit code when observed, including forced termination codes; it is null when unavailable. `treeStopped` is a separate observation, never inferred from a cancellation request. After a process resumes, `effects` remains `possible`: terminating it does not undo intermediate files or project build logic. Startup ownership failure can report a PID for the suspended child; if its stop is unconfirmed the status is `termination_unknown`.

Each stream retains its first 1 MiB while continuously draining the rest. `outputTruncated` means retention was bounded; `outputComplete` means readers reached EOF. Diagnostic parsing retains up to 500 unique issues by default (hard maximum 2,000), caps lines at 64 KiB, counts duplicates, and marks truncation. It maps source/build-rule errors, reflection diagnostics, missing module messages, compiler/linker codes and available symbols to structured fields. Unsupported log formats remain in the local process output; an empty diagnostic list never changes a failing exit into success.

## Module-only checks

In the formal local workspace, first load the locally maintained `scripts/use-project-env.ps1`; that helper is not included in this publication. With the repository's existing dependencies available:

```powershell
node scripts/test-ue-build-runtime.mjs
./scripts/test-ue-build-native.ps1
```

The runtime script selects only the two new test files and bypasses the repository-wide Vitest workspace. The native script builds a small offline crate under `tmp/ue-build-native-check` from these two Rust modules and the existing three dependencies. It does not invoke the Tauri build script or any other native module. Tests construct temporary fake engine metadata and use the Rust test executable and a temporary batch stub as safe subprocess fixtures. They cover binding changes, invalid targets, path/junction escapes, batch argv with space paths, exit codes, bounded capture, cancellation/timeout of owned descendant trees, accounting races and orphan cleanup. The ignored `safe_child_fixture` test is a subprocess entrypoint invoked by the parent tests; it is not a skipped acceptance scenario.

Module checks use synthetic fixtures. The current desktop acceptance above separately covers real C2065 and missing-HTTP failures, model suggestions, approved single-file writes and successful rebuilds on an isolated UE 5.8.4 project. Existing user projects and broader repair behavior remain outside that evidence.
