# UAgent

AI Agent Host and Client aligned with UE5.8 official Unreal MCP Server. UAgent provides a local-first desktop workspace for planning, executing, and reviewing AI-assisted workflows - starting with Unreal Engine game development tooling.

## Current Stage: MVP15D - Final 15A-15C/D16 Live Acceptance

The current accepted production implementation checkpoint is
`8b2ba0bf83e70f6ecdddb12202b6cb80732300fa`. It includes Final Live Acceptance
Resume 3 Rework 1's live-owner/restart repair, Resume 4's BuildPlugin descriptor
verifier repair, Resume 5's official Automation-report UTF-8 BOM repair, and
Resume 6's exact-once creation-FILETIME provenance repair.
Live product and UI children now receive an isolated UE
editor bridge/launch gate and an absolute UE root; capability-only, UE
Automation and N2 children cannot inherit that authority, and asset mutation
remains enabled only for live UI lifecycle. The native bridge starts one
task/phase-owned guardian which owns the exact UE/MCP listener, task-local DDC
and PID/creation-FILETIME identity from pre-Connect readiness through rendered
Disconnect and root-process closeout.

The accepted source checkpoint makes UE restart consume an ordered native
terminate/create/attach/MCP/attestation receipt chain. A successful transition
requires confirmed predecessor exit, a different process and listener identity,
new editor and MCP sessions, newer generations, and installed/loaded module
equality against the canonical package manifest. Raw PID, port, endpoint,
session, FILETIME and local paths remain native-memory facts; retained product
evidence uses hashes and receipt references. This source work does not establish
15A, 15B, 15C, D16, a real smoke, or Stage Ready; those gates still require a
fresh clean-checkout run from the accepted implementation SHA.

Resume 4 reached a real UE 5.8.1 `BuildPlugin` package and exposed the official
descriptor rewrite. The accepted verifier binds source and packaged descriptor
bytes independently, allows only the observed Installed/EngineVersion/default
field transformation, and rejects every other semantic drift. That run's
release, package, manifest and evidence were invalidated and removed after the
source change; no live gate advanced.

Resume 5 then reached install/load and an official UE Automation report whose
fixed three-test matrix passed. UE 5.8.1 writes that `index.json` with a UTF-8
BOM; the accepted producer now removes exactly one leading decoded BOM before
strict JSON parsing while retaining the original bytes for SHA-256. The source
repair again invalidated and removed the pre-repair live lineage, so 15A and all
later live gates remain open.

Resume 6 reached the same official `3 / 3 / 0 / 0` matrix, canonical loaded
module authority, unchanged Content and zero process/port residue, then failed
closed because an already hashed creation FILETIME was retained a second time.
The accepted source now passes the validated raw early-process FILETIME through
the generic retention transform exactly once. The required side-effect scan was
also narrowed for exact negative-case vocabulary and now exits with zero blocked
findings while retaining unsafe-positive self-tests. All Resume 6 live artifacts
predate this repair and remain diagnostic only.

Final Pre-live Source Closure Rework 7 is historical `PARTIAL / NEEDS_FIX`; no
checkpoint was created. Rework 8 (actual bridge orchestration and exact window
instance ownership) has `Review Verdict: NEEDS_FIX`; no checkpoint was created.
Rework 9 implementation and controlled verification have `Review Verdict:
PASS` and are checkpointed at implementation commit
`aa14363f15d8bdc8eaf392c67cf444496cc8a968`. On 2026-08-12, explicitly
authorized exact-manifest cleanup removed all 4,601 historical TEMP fixture
roots with failures 0 and residual 0. Fresh asset `40/40` and bridge `14/14`
regressions passed and left zero matching roots. `External Gate / TEMP cleanup:
PASS`; the historical mtime actor remains unconfirmed.
Final Live Acceptance Resume Rework 1 has `Review Verdict: PASS` for its source
content and controlled verification and is checkpointed at implementation
commit `de248a7028d21c53c26db7b28930d583566580a6`.
It routes visible N1-N8 settings controls through the production desktop
adapter, obtains N1 `untrusted_root` before trust, runs N2 in an exact
task-owned child with native mutation authority disabled, and records N7/N8
through actual MCP execute/rollback calls. No current clean-checkout 15A-15C
evidence is claimed.
Final Live Acceptance Resume 2 Rework 3 has `Review Verdict: PASS` for its
source-only retained-transcript privacy repair and is checkpointed at
`25d1262528e0976d24f96056975fdb36bc790b77`. Unterminated quoted secrets now
fail closed at line/EOF boundaries, bare punctuation tails remain covered, and
the shared producer/scanner/manifest grammar is bounded. The invalid Resume 2
clone/evidence cleanup gate is `SATISFIED`: an independent zero-residual scan on
2026-08-14 found no clone, evidence root, task process or declared-port listener.
No live gate advanced from cleanup alone.
The separate Final Source/Tooling Rework 8 checkpoint dated 2026-08-03 remains a
historical `COMPLETE / PASS` record at implementation commit
`98c8b387e1124a519977849d48ab824e4e6bb9c5`. G14 is `IMPLEMENTED`; current
source-checkpoint G15 integrity is `COMPLETE`; G16 is
`PARTIAL`. D13 / 15A is `DISPATCHED`; D14 / 15B waits on 15A and D15 / 15C
waits on 15A/15B; D16 remains `IN_PROGRESS`; UE 5.8.1 compatibility and overall MVP15
acceptance remain `PARTIAL`; Ready for the next stage is `NO`.
Current `PASS_REAL_SMOKE` is `NO`.

Final Pre-live Source Closure Rework 1-6 are historical `PARTIAL / NEEDS_FIX`
submissions without checkpoints. The reviewed Rework 9 implementation preserves Rework 8's two
actual predecessor/successor `App` registrations, each calling production
`startMvp15dRuntimeBridge(invoke)`, and changes the native parent lifecycle. The
first main-thread task validates the exact Tauri-injected predecessor, registers
an exact-instance one-shot `Destroyed` listener, and destroys only that captured
receiver; it cannot build or acknowledge success. An off-main worker waits with
a bound and without holding `BridgeState`, then queues a new main-thread
continuation after AppManager removal. The continuation revalidates the
handoff/task/phase/private binding, checks current `main` occupancy, and builds
one successor only when the label is empty. Atomic dispatch gates prevent timed
out queued or running tasks from later destroying or building. While this
handoff is pending, the app prevents last-window exit; terminal no-window
failures exit explicitly.

A hidden Windows Webview/Wry regression now reproduces the old same-task
collision as the locked stable API's actual
`WebviewLabelAlreadyExists("main")`, observes manager removal with build count 0,
and then creates a same-label successor with a different HWND from the next
main-thread continuation. A second real continuation injects replacement B from
the `RunEvent::WindowEvent(Destroyed)` callback before the exact predecessor
listener; B survives, the third-window build count remains 0, and protocol tests
keep acknowledgement/claim/publish/complete closed. The asynchronous native-App
harness returns the restart response before parent destroy/build/acknowledgement
and uses its lifecycle query as the parent-ready barrier. Acknowledgement v2,
claim v3, window identity v1, product summary v2, N4, N5, second rollback, and
actual MCP DELETE controls remain unchanged.

The TEMP residue gate is closed. The authoritative cleanup manifest contains
4,601 directories (4,591 `uagent-asset-*`, 10
`uagent-mvp15d-bridge-test-*`) at SHA-256
`45b870c32fbf48c20bf1545dbdaf7ac58c036c400b521677fccd22e4dae9d893`.
Before deletion, exact TEMP containment, names, directory type, complete
descendants, reparse/link absence, exact-set equality, and live-owner safety all
passed. The cleanup deleted 837 fixture files, 4,717 internal directories, and
all 4,601 roots; failures and residuals were zero. Post-cleanup asset and bridge
regressions passed and the second rescan remained at zero matching roots. Earlier
94/235 root-only `mtimeNs` observations remain historical and unattributed.

These remain source implementation and controlled-test facts. No current
clean-checkout Tool Search ON/OFF sessions, installed/load/manifest tuple, live
fingerprint, retraction session boundary, full 15A N1-N8 acceptance root,
partial/unknown run, real parent closeout, live UE/MCP run, or real mutation
evidence was produced. The latest source delta invalidates the previous release and
all earlier 15A-15C evidence. The installed release capability gate remains
open; the invalid Resume 2 cleanup gate is closed and a fresh 15A restart is
dispatched from a clean checkout of
`8b2ba0bf83e70f6ecdddb12202b6cb80732300fa`.

The last verified pre-checkpoint Tauri build embedded
`uagent.mvp15d.source-identity.v2`: base/compiled commit
`d308d80a994079dc22af2b982e70ae416d832e4f`, resolved head ref, honest
`sourceDirty: true`, and SHA-256
`ccf061de9f2583d26b9562a9739255f04b288c84672603424859c04fee686099`
over its complete 335-file
`uagent.mvp15d.production-source-boundary.v2`. The current source-only candidate
adds the independent final-live verifier, so its boundary contains 336
production files discovered from 14 approved roots plus 28 exact files;
9 exact exclusion classes account for 126 excluded entries. Tests, docs,
workflow data, build output, evidence, caches, logs, installers, secrets, and
external roots stay outside it. A new production file is included
automatically, and deletion of a tracked production file marks the identity
dirty. The current candidate's `build.rs` watch set contains 357 entries,
including normal or linked-worktree Git metadata, symbolic or detached HEAD,
loose refs, and packed refs. The historical 2026-08-03 checkpoint closed its
then-current G15 scope, and Rework 9 is checkpointed at
`aa14363f15d8bdc8eaf392c67cf444496cc8a968`. Resume Rework 1 remains recorded at
`de248a7028d21c53c26db7b28930d583566580a6`; the privacy repair is checkpointed
at `25d1262528e0976d24f96056975fdb36bc790b77`, the live-owner repair at
`0b47dd41e92f941f87c45c5694ec75d2cc932771`, and the Resume 4 BuildPlugin
descriptor verifier repair at `a780fc4231b99b39153fb88c9ab460717610b3f3`.
The historical Automation-report BOM repair is checkpointed at
`7916cf74cb205049e1c8967b9217cb8b64df36ca`. The current exact-once UE process
provenance repair is checkpointed at
`8b2ba0bf83e70f6ecdddb12202b6cb80732300fa`; a separate clean-checkout rebuild
from this checkpoint restarts G16 and D13 / 15A.

The loaded-module publisher still has one write-capable production path. It
publishes only after the owned live process is re-observed and the private
task marker, session/generation, PID, creation FILETIME, executable bytes,
project, source identity, manifest, package, installed inventory, producer/
helper/observer/Job facts are independently derived. Raw process/session facts
remain ephemeral; retained ledgers contain only domain-separated SHA-256
bindings. Its private publisher brand is an in-process condition and is not
serialized. The standalone writer CLI is disabled; injected observation and
pure builders remain fixture-marked.

Verification has two explicit levels. Exported verifiers and CLI `verify`
reopen and cross-bind retained files and return a persisted-consistency status
with `productionLaunchAuthorityVerified: false`. A coherent copied or
hand-authored chain can satisfy that consistency level, so it is never described
as owned live-production evidence. Only `executeLivePhase()` can return
`*_owned_launch_verified` with `productionLaunchAuthorityVerified: true`: the
same parent invocation must check absent outputs, select the fixed producer and
arguments, use the real non-injected launcher, validate the actual child result,
consume the events, complete persisted cross-binding, and consume a private
single-use `WeakSet` receipt that is neither exported nor serialized. Public
origin strings, hashes, projected identity bindings, Job/event JSON, booleans,
nonces, and caller objects cannot create that receipt.

The Windows observer rejects leaf links and every symlink/junction/reparse
ancestor below the installed root. Real fixture-process and intermediate
`Binaries`/`Win64` junction regressions pass. Cleanup retains the Job handle,
forces or awaits closeout, retries only for Windows handle release, and fails
when a process or directory remains. Fifteen inherited task fixture directories
plus one transient test residue were removed after exact `%TEMP%` containment,
name, and no-live-owner checks; the final matching process and fixture-directory
counts are zero.

The historical Final Source/Tooling Rework 8 release `uagent.exe` passed all three capability-only
handshakes — native startup, the normal-product renderer, and the rendered
validate/add/trust controls — with zero MCP calls, zero network calls, zero
asset operations, and zero residuals. The probes establish only the runtime
boundary. They do not claim real product discovery, UE execution, Tool Search,
or asset mutation.

UE Automation will continue to come from the official `-ReportExportPath` JSON
report plus exact UAgent task markers and a fixed companion Automation matrix.
Ordinary UE logs remain separate redacted logs and are never treated as pure
JSONL. Full UE execution remains post-checkpoint.

The UE 5.8.1 evidence collector uses a closed allowlist, deterministic
redaction, independent verification, and secret/path rejection. The unsafe
predecessor evidence root was invalidated and removed for
`TOKEN_AND_RAW_PATH_EVIDENCE_INVALID`; no replacement live root was created.
Full compatibility and acceptance are assigned to the newly dispatched
clean-checkout task based on current implementation commit
`8b2ba0bf83e70f6ecdddb12202b6cb80732300fa`.
Real UE, Tool Search, and mutation
were `SKIPPED_BY_TASK_BOUNDARY` in the source-repair task. The dispatched live
task may enter exact-sandbox 15C mutation only after fresh 15A and 15B pass.

The tracked multi-size ICO and actual Tauri MSI/NSIS packaging remain accepted
implementation facts. Identity v2 / manifest v3 independently preserve engine
`5.8.1`, engine changelist `56057345`, compatible changelist `55116800`, and
module BuildId `55116800`; exact `RunUAT.bat ... -Rocket` construction and the
deterministic module index remain in place. Historical Source Checkpoint Rework 7 / UE 5.8.0
validation retains its original meaning and does not satisfy the current live
gates.

Historical Source Checkpoint Rework 7 D0/build/UE evidence still validates in place. It preserves
the selected Direct route and closes the Toolset Registry alternative for the
accepted D0-D12 source checkpoint, but it does not substitute for final
15A-15C evidence.

## Historical Stage: MVP15 - Native Authority Binding Rework

This historical stage reopened MVP15 for native authority binding acceptance and recorded `BLOCKED` / Ready `NO`. C11/11A delivered the native trusted-root, live observation/process, default-off mutation-gate, and absolute transaction/recovery controls with a green automated ledger. C12 then identified UE `5.8.0` promoted build/changelist `55116800`, descriptor-reported `Unreal MCP` version `1.0`, and six reproducible project-local module hashes. C13 created a retained task copy, and C13B proved that a task-owned UE can use an isolated task-local DDC and reach the exact modules plus a task-owned loopback listener; the cold-cache listener appeared at about `+602.9s`, outside its 600-second gate.

C13C reused that warm DDC and observed all launch-readiness conditions together at `+33.408s`, without connecting to MCP or performing product/native/mutation actions. C13D then proved that child-only `PYTHONDONTWRITEBYTECODE=1` does not suppress the UE embedded runtime's 28 generated cache files. C13E modeled route A as `163` byte-exact business files plus 28 source-mapped `cpython-311` cache paths and produced a clean one-launch ledger at `+94.338s`; supervisor review then found two validator defects. C13E1 repaired and closed those defects: every native path-inspection error fails with `PATH_INSPECTION_FAILED`, `header.valid` reflects the complete header result, the expanded 23-test matrix passes, and the retained `191 = 163 + 28` copy revalidates read-only with zero cache metadata change and no additional UE launch. Supervisor review accepted the repair and recorded verified implementation commit `12159b9b5eb31829208df5c01c7fc97f157398c2`; the remote checkpoint is published and local external artifacts are excluded by commit `af457cad6c870c62b333bfba82df4fb38d83c6b1`.

C14 implemented deterministic `uagent.mvp15.live-asset-toolset-fingerprint.v1` publication in the real desktop adapter. C14A hardens that boundary: a new connection generation atomically retracts old discovery, facade inventory, MCP binding, and fingerprint before any synchronous status notification; blocked publications expose only allowlisted names, stable flags, and counts, never raw unexpected/duplicate names. Primitive, non-string, throwing/proxy-like, malformed, and non-JSON inputs remain fail closed without an accepted SHA-256. The controlled C14 task-owned read-only attempt reached the exact loaded module/listener environment, preserved Route A `191 = 163 + 28`, and made one initialization request before a pre-discovery transport/environment failure. It produced no descriptor/schema evidence and is not a schema rejection; discovery and every registration/token/dry-run/execute/verify/rollback/replay/mutation count stayed zero. Separately, the authoritative active-byte mapping remains `BLOCKED_BY_MCP_SCHEMA`: all six signed Epic sibling binaries differ from the active unsigned project-local set, and no authoritative package manifest or source/build attestation maps those active bytes. Supervisor review accepted the C14/C14A implementation at verified commit `37c29cbc7961218bfd71d1809178359952a75e18`; its documentation closeout is published in the same task checkpoint. The historical 09Z `PASS_REAL_SMOKE` remains former happy-path evidence only. At the C14 checkpoint, product-adapter capture and the product-UI lifecycle were still absent; current status is summarized above.

1. **Asset Mutation Contracts**: Sandbox asset paths, operation kinds, dry-run plans, ChangeSet approvals, verification, rollback, evidence, audit, and replay summaries.
2. **Sandbox Policy**: Blocks non-sandbox paths, path traversal, Save All, unsafe delete/move/rename/bulk operations, broad mutating MCP calls, stale manifests, provider auto-apply, raw secrets, and replay re-execution.
3. **Runtime Asset Service**: Deterministic dry-run, ephemeral native-issued approval token handoff, execute, verify, rollback, manifest, replay summary, and scenario matrix support.
4. **Native Guard Rework**: Native commands are bound to authoritative trusted-root and live observation registries, a strict `UAGENT_ENABLE_ASSET_MUTATION=1` gate, a 60-second one-time token, and absolute 15-minute forward / 20-minute recovery deadlines. Automated C11 coverage is present; C12-C13E1 add accepted real build, module, task-copy, DDC, process, listener, and fail-closed dual-layer Plugins containment evidence, while provenance and fresh product-UI acceptance remain blocked.
5. **MCP Schema Adapters**: Exact allowlist for dry-run, execute, and rollback-capable sandbox asset tools with strict state-specific structured results, required `sideEffectObserved`, read-only evidence queries, and a redacted session/generation-bound exact-six fingerprint publication; generic wrapper mutation remains blocked.
6. **Desktop UI / Store**: Inspector Assets and Changes surfaces expose `executed`, `verified`, `rollback_available`, `rolled_back`, stable blocked reasons, redacted operation audit, and recorded replay summaries. The working tree also contains inherited visible Companion status/contract/hash/fingerprint/generation copy in `AssetMutationPanel` and `ConfigSettings`, with matching UI assertions; historical Source Checkpoint Rework 7 and documentation-only Source Checkpoint Rework 8/Rework 9 did not edit those files or the five TitleBar-coupled files, and the inherited changes do not establish acceptance.
7. **Scenario Matrix / Side-effect Scan / Docs**: Security checks also cover native trust, observation provenance, native gate authority, transaction liveness, and pre-trust root mapping regressions.

Controlled text writes remain approval-gated and limited to trusted fixture/temp roots or explicitly trusted project roots. Non-sandbox UE assets, Save All, bulk asset operations, arbitrary shell expansion, provider live defaults, automatic git operations, replay re-execute, and raw secret/path leakage remain blocked.

Real UE execution remains limited to `/Game/UAgentSandbox/**`; the accepted `/Game/Test01` source stays read-only.

## Technology Stack

- **Desktop Shell**: Tauri 2 + React 18 + Vite 5
- **Language**: TypeScript 5.5+ (strict mode)
- **Package Manager**: pnpm 9+ monorepo
- **Linting**: ESLint 9 (flat config) + Prettier
- **Testing**: Vitest + Testing Library

## Quick Start

```bash
pnpm install
pnpm --filter @uagent/desktop web:dev   # Start Vite dev server (browser preview, fixture fallback)
pnpm --filter @uagent/desktop dev        # Start Tauri native dev (real FS bridge available, requires Rust)
pnpm typecheck    # TypeScript checking
pnpm lint         # Static analysis
pnpm test         # Run test suite
```

## Project Structure

```
apps/desktop/
  src-tauri/        Tauri 2 native shell (Rust)
  web/              React + Vite frontend
    src/
      app/          Root App and providers
      shell/        AppShell, TitleBar, MainLayout, GlobalOverlays
      sidebar/      LeftSidebar
      workspace/    Workspace (ConversationViewport + ComposerDock area)
      inspector/    InspectorPane
      components/   Reusable presentational components
      runtime/      Desktop mock runtime adapter and event view models
      stores/       UI state stores (custom slice store)
      styles/       tokens, theme, animations, globals
      types/        UI type definitions
packages/shared/    Shared types plus MVP1 Task/Runtime/Event contract
packages/runtime/   Deterministic MockRuntime and TaskEvent reducer
packages/mcp-client/  MCP JSON-RPC, Streamable HTTP, legacy SSE, session, and discovery client
docs/               Architecture, roadmap, development guide
```

## Native Build Prerequisites

The Tauri 2 native build requires the Rust toolchain (`rustc` / `cargo`) and platform-specific WebView dependencies. The web frontend (`pnpm --filter @uagent/desktop web:build`) builds without Rust.

## Non-Goals (current stage)

- Default live provider network access (must be opt-in)
- Non-sandbox Unreal Engine writes or uncontrolled/automatic Editor launch
- Broad mutating MCP tool calls
- Uncontrolled or arbitrary shell, browser, or filesystem behavior outside the existing approval, trust, containment, and read-only boundaries
- Save All, broad/bulk asset mutation, provider auto-apply, replay execution, automatic git operations, or secret/raw-path disclosure
- Cloud deployment, auth, or remote services
- Forking or embedding Codex/Claude Code/Cursor/Aider

## Documentation

- [Architecture](docs/architecture.md)
- [MVP Roadmap](docs/mvp-roadmap.md)
- [Runtime Contract](docs/runtime-contract.md)
- [MVP1 Acceptance](docs/mvp1-acceptance.md)
- [MCP Read-only Plan](docs/mcp-readonly-plan.md)
- [MVP2 Acceptance](docs/mvp2-acceptance.md)
- [Agent Core Plan](docs/agent-core-plan.md)
- [MVP3 Acceptance](docs/mvp3-acceptance.md)
- [MVP4 Acceptance](docs/mvp4-acceptance.md)
- [MVP5 Acceptance](docs/mvp5-acceptance.md)
- [MVP6 Acceptance](docs/mvp6-acceptance.md)
- [MVP6 UI Productization Plan](docs/mvp6-ui-productization-plan.md)
- [MVP6 Baseline Freeze](docs/mvp6-baseline-freeze.md)
- [MVP6 Manual Smoke](docs/mvp6-manual-smoke.md)
- [MVP7 Acceptance](docs/mvp7-acceptance.md)
- [MVP7 Baseline Freeze](docs/mvp7-baseline-freeze.md)
- [MVP7 Project Index Plan](docs/mvp7-project-index-plan.md)
- [MVP7 Capability Bridge Plan](docs/mvp7-capability-bridge-plan.md)
- [MVP7 Manual Smoke](docs/mvp7-manual-smoke.md)
- [MVP8 Prep](docs/mvp8-prep.md)
- [MVP8 Baseline Freeze](docs/mvp8-baseline-freeze.md)
- [MVP8 Native FS Bridge Plan](docs/mvp8-native-fs-bridge-plan.md)
- [MVP8 Real Project Scan Plan](docs/mvp8-real-project-scan-plan.md)
- [MVP8 Acceptance](docs/mvp8-acceptance.md)
- [MVP8 Manual Smoke](docs/mvp8-manual-smoke.md)
- [MVP8 Risk Register](docs/mvp8-risk-register.md)
- [MVP9 Prep](docs/mvp9-prep.md)
- [Workflow Safety Plan](docs/workflow-safety-plan.md)
- [MVP11 Acceptance](docs/mvp11-acceptance.md)
- [MVP11 Manual Smoke](docs/mvp11-manual-smoke.md)
- [MVP11 Final Handoff](docs/mvp11-final-handoff.md)
- [MVP12 Prep](docs/mvp12-prep.md)
- [MVP12 Acceptance](docs/mvp12-acceptance.md)
- [MVP12 Manual Smoke](docs/mvp12-manual-smoke.md)
- [MVP12 Risk Register](docs/mvp12-risk-register.md)
- [MVP12 Final Verification](docs/mvp12-final-verification.md)
- [MVP12 Final Handoff](docs/mvp12-final-handoff.md)
- [MVP13 Prep](docs/mvp13-prep.md)
- [MVP13 Acceptance](docs/mvp13-acceptance.md)
- [MVP13 Manual Smoke](docs/mvp13-manual-smoke.md)
- [MVP13 Risk Register](docs/mvp13-risk-register.md)
- [MVP13 Final Verification](docs/mvp13-final-verification.md)
- [MVP13 Final Handoff](docs/mvp13-final-handoff.md)
- [MVP15 Prep (historical)](docs/mvp15-prep.md)
- [MVP15 Acceptance](docs/mvp15-acceptance.md)
- [MVP15 Manual Smoke](docs/mvp15-manual-smoke.md)
- [MVP15 Risk Register](docs/mvp15-risk-register.md)
- [MVP15 UE MCP Plugin Baseline](docs/mvp15-ue-mcp-plugin-baseline.md)
- [MVP15 Companion Registration ADR](docs/mvp15-ue-companion-plugin-adr.md)
- [MVP15 Companion Build Manifest Contract](docs/mvp15-ue-companion-plugin-build-manifest.md)
- [MVP15 Python Cache Contract](scripts/mvp15-python-cache-contract.json) and [read-only validator](scripts/mvp15-python-cache-surface.mjs)
- [MVP15 Final Verification](docs/mvp15-final-verification.md)
- [MVP15 Final Handoff](docs/mvp15-final-handoff.md)
- [Baseline Freeze](docs/mvp5-baseline-freeze.md)
- [Development Guide](docs/development.md)

## License

Proprietary. All rights reserved.
