> 2026-11-04 asset workflow source update: Tools → Assets now offers “Duplicate asset and save copy”, with exact dry-run → approval → execution → verification through the existing v1 sandbox chain. Native registration accepts only the exact three-step folder/duplicate/save plan or the legacy five-step plan. Requires the existing native gate, trusted editor observation, verified companion identity and exact MCP dry-run bindings. This does not activate the separate V2 pickup writer. Synthetic checks do not establish current-engine asset execution; no candidate EXE or live UE asset operation was run for this update.

# UE 5.8.4 current compatibility target

As of 2026-11-03, the local `G:/UnrealEngine/UE_5.8/Engine/Build/Build.version` reports **5.8.4 / CL 58902052**, branch `++UE5+Release-5.8`, compatible CL **55116800**. `Engine/Binaries/Win64/UnrealEditor.modules` reports BuildId **55116800**. Read these files from the selected engine; the Launcher cache still naming 5.8.2 is not build identity.

The v1 companion source descriptor, C++ contract, JSON schemas, shared TypeScript identity, Rust manifest validation, build preflight and manifest/ledger validators now require that exact 5.8.4 identity. Old 5.8.1 / 5.8.2 receipts must fail current attestation. Hash, source, package, loaded-module and exact-six permission checks are retained. Updating constants is not a new signed or tested plugin binary.

## V2 and BuildPlugin descriptor policy

V2 retains `EngineVersion: 5.8.0`, Win64, default-disabled and its existing module/dependency configuration. This is the compatibility version, not a claim that the installed patch is 5.8.0. The installed engine's `Version.h` explains that `FEngineVersion::CompatibleWith()` uses patch zero and the compatible changelist; `FEngineVersion::Current()` identifies the actual build. V2 continues publishing the latter. The package validator retains BuildPlugin's exact source-to-package transformation from source 5.8.4 to packaged 5.8.0, without skip-version flags. No UE project conversion or engine installation change is required by this source update.

The installed ModelContextProtocol headers are checked against the existing direct tool registration/removal and result interfaces. The build configuration still names the existing editor/runtime modules; no speculative API substitution or permission expansion is made. Source compatibility inspection is not compilation or load validation.

## Current verification boundary

Current v1 and V2 plugins have successful 5.8.4 compile records below. The later scene contract **2.4.0** also compiled with matching desktop/plugin schemas; its compile and identity record (`2026-10-29/evidence/t14-plugin-240-584-20261105-r1/actual-result.json`; local evidence, not published with the repository) records `livePluginLoaded:false`, `liveProtocolTest:false` and `realEditorRun:false`. Live loading, MCP discovery, Blueprint/scene behavior and real desktop acceptance remain open. Earlier 5.8.1/5.8.2 results do not verify these current paths.

Existing evidence directories and frozen desktop QA candidates (including history-readonly QA r2) remain historical, unchanged artifacts. They must not be relabelled as current 5.8.4 builds. The version-specific `mvp15d-ue581-evidence-inventory*` scripts/schema names describe the historical inventory format and must be used with their matching archived source revision, not as a current build/release command. Their old identity literals are intentional historical labels, not current target settings.

Current product scope is recorded in the [UE integration index](ue-build-integration.md#current-desktop-integration): ordinary-project managed semantic reads and scene creation have scoped native entries; pickup creation remains isolated-Lab-only. Build repair includes a separately approved chain of at most three rebuilds. These source integrations retain their own approval and lifecycle requirements; engine compatibility alone grants no operation authority. The three complete design workflows still need current-engine end-to-end acceptance.

## Fresh v1 compile verification (2026-11-03)

The current v1 UAgentAssetTools plugin (including its descriptor-listed test module) compiled successfully for UnrealEditor Win64 Development against the exact installed 5.8.4 build, in a fresh isolated host. UBT exited 0; source bytes matched before/after and the own Job was independently confirmed absent. Evidence: `../../../evidence/ue584-plugin-compile-20261103-r1/actual-result.json`. This is a compile-only result, not a packaged release attestation, plugin load, Automation execution or v2 compilation. Existing historical results remain unchanged.

## Fresh V2 compile verification (2026-11-03)

The separate UAgentAssetToolsV2 plugin now also compiled successfully against the verified 5.8.4 / CL 58902052 engine: UnrealEditor Win64 Development, 33 actions, exit 0. The unchanged descriptor built four production modules (PickupRuntime, SemanticTools, PickupTools, SceneBatchTools) and two test modules, using ModelContextProtocol. All six DLLs are AMD64; the module manifest BuildId is 55116800. All 20 source files matched both the worktree and isolated snapshot after compilation. No compatibility source fix was needed. The own Job was independently confirmed absent.

Evidence: `../../../evidence/ue584-v2-plugin-compile-20261103-r1/actual-result.json`, with exact artifact hashes in `artifacts.json`. This closes the V2 compile gap only. No editor/plugin load, Automation execution, MCP discovery, Blueprint/scene behavior or packaged-release attestation was performed. The frozen desktop QA candidates remain unchanged.

The compiler emitted two C4191 warnings for existing FARPROC-to-function-pointer casts in PickupToolsV2.cpp:97 and SceneBatchToolsV2.cpp:113. They did not fail the build and were not changed as a speculative compatibility fix.
