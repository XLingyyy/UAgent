# UAgent Architecture

## MVP15D Companion Trust Chain

### Current Final 15A-15C/D16 Live Acceptance

Final Pre-live Source Closure Rework 7 is historical `PARTIAL / NEEDS_FIX`; no
checkpoint was created. Rework 8 (actual bridge orchestration and exact window
instance ownership) has `Review Verdict: NEEDS_FIX`; no checkpoint was created.
Rework 9 implementation and controlled verification have `Review Verdict:
PASS` and are checkpointed at implementation commit
`aa14363f15d8bdc8eaf392c67cf444496cc8a968`. Authorized exact-manifest TEMP
cleanup removed all 4,601 roots with failures 0 and residual 0; fresh asset
`40/40` and bridge `14/14` regressions left zero matching roots. `External Gate /
TEMP cleanup: PASS`.
Final Live Acceptance Resume Rework 1 has `Review Verdict: PASS` at
implementation commit `de248a7028d21c53c26db7b28930d583566580a6`. Visible N1-N8
controls now enter production adapter semantics; N1/N2 bind real registration
authority and N7/N8 bind actual MCP outcomes. No clean-checkout live gate
advanced.
Final Live Acceptance Resume 2 Rework 3 has `Review Verdict: PASS` at
implementation commit `25d1262528e0976d24f96056975fdb36bc790b77`. The retained
transcript producer, scanner and manifest verifier now share bounded fail-closed
handling for truncated quotes and punctuation tails. Invalid Resume 2 cleanup
is `SATISFIED` after an independent 2026-08-14 zero-residual scan; no live gate
advanced from cleanup alone.
Final Live Acceptance Resume 3 Rework 1 has `Review Verdict: PASS` at
`0b47dd41e92f941f87c45c5694ec75d2cc932771`; Resume 4's source-only UE 5.8
BuildPlugin descriptor verifier repair has `Review Verdict: PASS` at
`a780fc4231b99b39153fb88c9ab460717610b3f3`. Resume 5's source-only official
Automation-report UTF-8 BOM repair has `Review Verdict: PASS` at historical
implementation commit `7916cf74cb205049e1c8967b9217cb8b64df36ca`. Resume 6's
exact-once creation-FILETIME provenance repair has `Review Verdict: PASS` at
historical implementation commit `8b2ba0bf83e70f6ecdddb12202b6cb80732300fa`.
The generic retention transform now hashes and names the validated early-process
FILETIME once; strict report JSON/matrix and loaded-process authority remain
unchanged.
Final Live Acceptance Resume 7 has `Review Verdict: PASS` for its D16.5
source-only stop at implementation commit
`33743bb8327b7ca8bdf5aff6469db46503c01c67`. The checkpoint independently binds
the raw official report and seals a deterministic bridge across the distinct
final-runner and UE581 inventories; no live gate advanced.
Final Live Acceptance Resume 8 Rework 1 has `Review Verdict: PASS` at historical
implementation commit `af483722d08212374f67bfc756fa34b79e195e8c`. Resume 9 has
`Review Verdict: PASS` at historical implementation commit
`51cdf22753ae2f9d90a0e3d5cb03df8495fa7e46`: the task-owned managed UE guardian
now launches with `-NullRHI` while retaining the same isolated DDC, loopback MCP
port, marker and process-identity ownership. The pre-repair 15A/15B lineage is
partial evidence and does not advance a current-source live gate.
Resume 10 has `Review Verdict: PASS` at historical implementation commit
`4b6e2fa35ad999882dd3b50d697ab7cb36a1552e`. Its clean pre-repair run reached
rendered `confirmTrust` and exposed a strict package-manifest cardinality mismatch:
the UE companion omitted `Resources/mvp15d-native-binding-v2.json` from its exact
six-artifact allowlist. Production and its exact-manifest test fixture now accept
that sealed artifact without weakening hash or directory-closure verification.
Resume 11 has `Review Verdict: PASS` at historical implementation commit
`f14dc69543a42d553542b73547c3598fb39947b6`. The manifest consumer now uses an
explicit case-sensitive predicate for every canonical JSON object key, matching
the producer's ordinal ordering; the self-hash contract requires the complete
production manifest to load before exercising its tampered-hash rejection.
Resume 12 has `Review Verdict: PASS` at historical implementation commit
`38cec6f3e11af1e4b991430d3941e71c57d2c45d`. The fixed desktop runtime adapter
is now created and registered once during application bootstrap, after the Tauri
invoke bridge can exist, and `App` idempotently reuses that same instance. This
prevents a dependency-module evaluation from permanently capturing native-null.
Resume 13 has `Review Verdict: PASS` at historical implementation commit
`c60a094e0225d19e10238618abfeb73c299eacf0`. Before an index snapshot exists,
the editor-process config now derives the `.uproject` relative path from the
native-validated project filename; the indexed descriptor remains authoritative
after a scan and the no-project fixture fallback remains `Game.uproject`.
Resume 14 has `Review Verdict: PASS` at current implementation commit
`9d04ef710eff5a8c2aebdf0c92076e8ee477c1f5`. Direct fixed-authority editor
create/attach calls now resolve the opaque trusted-root token immediately before
IPC while UI/product state remains opaque; native canonical object and descriptor
validation stays authoritative. Its `c60a094e...` ExactSix/15A pass and rendered
15B failure predate the repair and remain diagnostic.
The separate Final Source/Tooling Rework 8 checkpoint dated 2026-08-03 remains a
historical `COMPLETE / PASS` record at implementation commit
`98c8b387e1124a519977849d48ab824e4e6bb9c5`. G14 is `IMPLEMENTED`; current source-checkpoint G15 integrity is `COMPLETE`; G16 is
`PARTIAL`. UE 5.8.1 compatibility and overall acceptance remain `PARTIAL`;
D13 / 15A is `DISPATCHED`; D14 / 15B waits on 15A and D15 / 15C waits on 15A/15B; D16 is
`IN_PROGRESS`; Ready remains `NO`.
Current `PASS_REAL_SMOKE` is `NO`.

Final Pre-live Source Closure Rework 1-6 are historical `PARTIAL / NEEDS_FIX`
submissions without checkpoints. Rework 9 renders two actual `App`
registrations, each calling production `startMvp15dRuntimeBridge(invoke)`. One
persistent Rust `BridgeState` owns driver consumption, restart authority,
acknowledgement, single-use claim, final publication, and completion. The parent
retains the exact injected predecessor and registers its exact-instance one-shot
`Destroyed` listener before captured destroy. The first main task cannot build or
acknowledge success. An off-main worker performs the bounded wait without the
bridge mutex and queues a second main task only after AppManager removal.

The second task revalidates handoff/task/phase/private binding, atomically commits
against timeout cancellation, and checks current `main` occupancy. Empty
occupancy creates one successor; replacement B is preserved and produces a
failed parent acknowledgement, leaving claim/publish/complete closed. The app
prevents last-window exit only while parent lifecycle is pending and exits
explicitly on terminal no-window failure. A hidden real Webview/Wry target
reproduces same-task `WebviewLabelAlreadyExists("main")`, observes manager
removal/build count 0, creates a different-HWND successor from the later
continuation, and injects B between removal and continuation. Raw handles and
bindings do not cross the wire; acknowledgement v2, claim v3, window identity v1,
product summary v2, N4/N5, mutation, strict POST/DELETE, and private owned-launch
controls remain unchanged.

Asset and bridge test roots use RAII teardown. The exact cleanup manifest
contains 4,601 entries (4,591 asset, 10 bridge), SHA-256
`45b870c32fbf48c20bf1545dbdaf7ac58c036c400b521677fccd22e4dae9d893`.
Explicit authorization and complete containment, descendant, reparse/link,
exact-set and live-owner preflight preceded deletion of 837 files, 4,717
internal directories and all 4,601 roots. Failures/residuals were zero. Fresh
asset `40/40` and bridge `14/14` tests passed and left zero matching roots.
Earlier mtime-only drift remains historically unattributed.

The exact source-level UI contract remains `1 / 5 / 1 / 5 / 4 / 0`, restored
Content, and replay delta `[0,0,0,0,0]`; controlled tests exercise eight fresh
state-driven negative identities and nine ordered partial/unknown operations.
These facts do not
constitute the current clean-checkout live Tool Search, installed/load/manifest,
fingerprint, retraction, full 15A N1-N8, partial, or closeout evidence. The former release and all
prior 15A-15C artifacts are stale; no live gate ran. The old installed binary may
fail only with `FINAL_LIVE_RUNTIME_NONZERO`. Cleanup is closed and an authorized
clean-checkout run from current implementation commit
`9d04ef710eff5a8c2aebdf0c92076e8ee477c1f5` is dispatched for the 15A restart.

The implemented trust-chain source path is:

```text
clean source
  -> exact RunUAT/-Rocket package
  -> manifest
  -> installed/loaded byte equality
  -> live exact companion observation (early process identity)
  -> current-generation exact-six fingerprint
  -> native registration
  -> product-UI lifecycle and rollback
```

`uagent.mvp15d.source-identity.v2` hashes the deterministic
`uagent.mvp15d.production-source-boundary.v2`: 336 files discovered from 14
approved production roots plus 28 exact files, with 9 documented exclusion
classes and 126 excluded entries. It covers the native bridge, bundled renderer
and Settings controls, desktop/runtime/MCP/shared production dependencies,
build and lock configuration, final tooling chain, and companion plugin
source/resources/build inputs. New files below an approved production root are
included automatically; deletion of a tracked production file makes the
identity dirty. The 357-entry watch set includes every production file plus
normal/worktree Git-dir metadata, symbolic/detached HEAD, loose refs, and packed
refs, and `build.rs` consumes it verbatim. `.gitattributes` fixes the two
canonical checkout paths to LF.

`mvp15d-plugin-build.mjs` uses the validated caller-supplied `RunUAT.bat` with
the exact ordered `-Rocket` arguments and retains redacted source transcripts.
`mvp15d-manifest.mjs` is explicitly a structural installed-module verifier; it
does not label structurally valid JSON as production authority.
`mvp15d-final-runner.mjs` performs the separate persisted cross-binding and
dispatches each formal phase to a dedicated repository-owned adapter with a
fixed executable and validated argument vector:
`mvp15d-final-ue-automation-producer.mjs`,
`mvp15d-final-product-capture-producer.mjs`, and
`mvp15d-final-ui-lifecycle-producer.mjs`.
`mvp15d-final-live-verifier.mjs` independently rehashes the exact official
Automation report bytes against the live phase transcript before privacy
cleanup. Bridge creation repeats that raw-byte recomputation before accepting
the retained record. It creates one deterministic bridge record in both the
final-runner and UE581 retained roots before inventory sealing, then verifies
both official inventory schemas, their complete filesystem closure and
self/bundle hashes, plus the shared file, package and source bindings after
each root has been sealed by its own inventory implementation. UE581-local
`metadata/identity.json` is excluded from the shared path set because the
final-runner does not produce it.

The real Tauri binary recognizes only the ordered
`mvp15d-final-runtime-bridge` contract while
`UAGENT_ENABLE_MVP15D_TASK_BRIDGE=1` is present. It validates task, compiled
source commit, direct-child evidence root, loopback endpoint/port,
marker/session/generation, one-time nonce, exclusive event/driver paths, and
the fixed product or UI path before ordinary GUI setup. Capability probe mode
writes and fsyncs the canonical runtime event file without starting the
renderer. Product/UI modes start the actual WebView, publish native readiness,
accept one task-bound driver command, and record only native-generated ordered
observations. Ordinary launches keep the bridge disabled.

`mvp15d-final-live-producer-helper.mjs` launches rendered phases
asynchronously and uses the repository Windows Job runner to own the full
process tree, observe readiness, deliver the authenticated driver file, enforce
timeouts, and verify active-process-zero closeout. The Job runner publishes an
early task-owned process identity after creation and before closeout. The sole
write-capable production publisher re-observes the live PID, explicitly binds
PID and creation FILETIME, independently derives executable/source/project/
manifest/package/install and fixed producer/helper/observer/Job facts, then
creates an in-process branded publisher capability. That capability is not
serialized and is not evidence that a later verifier owns the launch.
Injected observation and pure builders remain fixture-marked structural paths;
the standalone writer CLI is disabled. The observer enumerates the real Windows
module list, reduces only the exact companion set by canonical installed-root
and manifest identity, rejects shadow/extra/missing/leaf-link/ancestor-reparse/
escape/exit/PID-reuse cases, and publishes a path-free ledger through exclusive
temp-write, fsync, and rename.

Exported verifiers and CLI `verify` rehash the ledger and cross-bind its
relative path/size/SHA, task/marker/session/generation, source, early process and
executable, project, manifest, package/install inventories, exact sorted
modules, producer/helper/observer/Job identities, zero Job residues, and
terminal event/report. This retained-file level returns
`*_persisted_consistency_verified` and
`productionLaunchAuthorityVerified: false`; a coherent hand-authored chain can
satisfy it. Only `executeLivePhase()` can return `*_owned_launch_verified` with
launch authority true after the same parent checks absent outputs, invokes the
fixed producer through the real non-injected launcher, validates the actual
child/result/events, completes persisted cross-binding, and consumes an
unexported single-use `WeakSet` receipt. Public hashes, origin strings, PIDs,
FILETIMEs, Job/event JSON, nonces, flags, or caller objects cannot mint the
receipt. Replaced or internally inconsistent facts still fail closed. The
guarantee is deterministic task-workflow provenance within the owned run; it
does not claim resistance to an administrator who can replace the repository
and every local artifact.
The normal product bridge imports and invokes `createDesktopRuntimeAdapter`;
capability-only mode binds that implementation without Connect or network
activity. Live product mode uses its existing Connect -> Initialize ->
Discover -> Normalize -> Fingerprint methods. The UI bridge drives the
rendered validate -> add -> confirmTrust controls. The source checkpoint ran
only capability handshakes and the real Windows fixture-process observer
regression.

UE results use Unreal Automation's separate `-ReportExportPath` JSON report
plus exact task/source/session/generation markers and the fixed
`UAgentAssetTools.Contracts`, `.ReadOnly`, and `.Closeout` companion tests.
The producer derives the exact expected/passed/failed/skipped counts, hashes
the real Content tree before and after execution, and binds package, manifest,
installed modules, loaded modules, executable, and process identity before it
emits a terminal event. Ordinary stdout/stderr remains log input for
deterministic redaction and never serves as the structured result transport.

The UE 5.8.1 evidence inventory is directory-closed and allowlist-based. It
rejects unknown entries, raw secrets and local paths, links/reparse points, path
escapes, and inventory drift, and independently verifies deterministic
redaction. The unsafe predecessor evidence root was invalidated and removed for
`TOKEN_AND_RAW_PATH_EVIDENCE_INVALID`.

For final D16, the live final-runner root and the UE581 closed retained bundle
are distinct evidence products with incompatible name/closure contracts. Each is
verified by its own tool and joined only through deterministic source/package/
artifact hashes. The raw official Automation `index.json` must be rehashed against
the emitted `automation_report_binding.reportSha256` before privacy cleanup; a
copied or hand-authored bridge has no acceptance authority.

Current identity is engine `5.8.1`, engine CL `56057345`, compatible CL
`55116800`, module BuildId `55116800`. Identity v2, manifest v3, deterministic
module-index creation, exact `RunUAT.bat ... -Rocket`, the tracked ICO, and
Tauri MSI/NSIS remain preserved. The real release binary capability probes
made zero MCP calls, zero network calls, and zero asset operations. No real UE
session, live product discovery, Tool Search, or mutation ran; those operations
are `SKIPPED_BY_TASK_BOUNDARY`.
Full read-only compatibility is assigned to the newly dispatched clean-checkout
task based on current implementation commit
`9d04ef710eff5a8c2aebdf0c92076e8ee477c1f5`.

Historical Source Checkpoint Rework 7 D0/build/UE evidence remains valid and Direct remains the
selected route. It is source-checkpoint evidence only and cannot be substituted
for final 15A-15C.

### Historical Rework 5-9 Source-checkpoint Record

The Rework 5 supervisor review identified these authority gaps: a task-only
observer could forward a mutation guard while public live identity was
incompatible; adapter reconstruction could inherit native authority; stale
native retraction could be reported as applied; Rust, TypeScript, and C++ paired
one binding string with different fact tuples; and directory ownership began
after creation rather than from the exact created object. The ordinary parallel
Rust suite also reproduced shared-registry interference, and the UE runner lacked
per-session descendant-process closeout.

Rework 7 preserves the Rework 6 fail-closed architecture: task-only observation may only
observe/retract; a reconstructed adapter establishes native zero authority
before publication; stale retraction carries an unapplied result bound to its
requested generation; one complete canonical binding tuple crosses
Rust/TypeScript/C++; directory ownership is acquired atomically with creation;
and every task UE session carries a marker-bound descendant-process
creation/exit/residual ledger. Renderer restart begins with native zero
authority; partial/unknown effects retain only bounded inverse recovery, and
run-root cleanup remains handle-bound and exact-empty. Verification includes ten
fresh ordinary Cargo runs, the retained four-session D0 set, and the five-session
UE matrix. Rework 9 changes documentation only and closes the source checkpoint.
No final 15A package or authorized real product mutation exists. D13, 15A, 15B,
and 15C remain prohibited until separately authorized.

### Historical Rework 3 Supervisor Review Note

`UAgentAssetTools` contains task-only Direct and Toolset probes, inverse-dispatch
and non-recursive cleanup improvements, and native module enumeration. The
historical Rework 3 supervisor verdict was `NEEDS_FIX`: its capture producer is UE Commandlet Automation,
not the UAgent product adapter; its C++ and TypeScript ledgers do not carry the
complete session/native-plan/effect authority; and partial/unknown effects are not
settled safely. Desktop state clears locally before notification, but native
approval revocation is fire-and-forget and may still race an immediate guard.

Rework 4 must connect the actual product path, make revocation completion-ordered,
prove positive loaded-module authority, and run the full UE matrix. No route or
source checkpoint is accepted; D13-15C remain disabled.

### Historical Rework 2 framing

`UAgentAssetTools` is the proposed independent UE 5.8 Editor plugin. Rework 2 is
not an accepted implementation baseline: D0 lacks a Toolset Registry spike and
real product capture; the C++/runtime/native inverse protocol and session-scoped
ownership contract remain inconsistent. Epic's
`ModelContextProtocol` remains responsible for localhost MCP transport and
public tool registration; the companion owns only the exact-six asset contract,
strict `/Game/UAgentSandbox/<run-id>` policy, dry-run/structured results, and
session-scoped ownership inverses. Native UAgent remains the trusted-root,
live-observation, feature-gate, one-shot approval, and external Content
evidence authority. The required design accepts execution only after manifest,
installed/loaded module bytes, descriptor identity, current-generation live
fingerprint, external binding, and native registration all agree. Disconnect,
reconnect, endpoint change, or stale discovery retracts the publication before
notifying UI listeners. Only redacted hash prefixes and stable blocker codes are
displayed. The current candidate implements a trusted-root-only native
`attest_mvp15_companion` bridge and rechecks it at every real dry-run, approval,
execute, verify, and rollback service entry. It validates the installed package
manifest, self-hash, exact artifact bytes, and package layout before publishing
anything to the runtime. Because the desktop process cannot infer a DLL loaded
by a separate UE process, it deliberately returns
`loaded_module_evidence_unavailable` until a future native UE bridge supplies
that fact; production readiness remains blocked rather than trusting a
renderer/test injection. Rework 2 now rejects native `blocked` evidence from
positive attestation but fails to atomically retract an older accepted
fingerprint. Rework 3 must supply loaded-byte authority and correct the
retraction, rollback, and ownership paths before this design is implemented.

## Overview

UAgent is an AI Agent Host and Client for Unreal Engine workflows, aligned with the UE5.8 official Unreal MCP Server. It provides a local-first desktop workspace for planning, executing, and reviewing AI-assisted development tasks.

## High-Level Architecture

```text
┌──────────────────────────────────────────────┐
│            Desktop Shell (Tauri 2)            │
│  ┌──────────────────────────────────────────┐ │
│  │           Web Frontend (React)           │ │
│  │  ┌──────────┐ ┌────────┐ ┌────────────┐  │ │
│  │  │ Sidebar  │ │Workspac│ │ Inspector  │  │ │
│  │  └──────────┘ └────────┘ └────────────┘  │ │
│  └──────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────┐ │
│  │         Native Core (Rust)               │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │  Shared  │ │ Runtime  │ │ MCP      │
    │  Types   │ │ Engine   │ │ Client   │
    └──────────┘ └──────────┘ └──────────┘
```

## Desktop Shell

### `apps/desktop/src-tauri`

Tauri 2 native shell. The Rust entry point creates the application window and hosts the web frontend. The native core provides policy-gated filesystem access, controlled process execution and observation, trusted-root binding, UE Editor attach/status support, and the approval-bound sandbox asset-mutation guard. Runtime-to-native commands and the localhost MCP client/transport are implemented; unsafe or unavailable capabilities remain disabled or fail closed. The window uses a custom title bar (`decorations: false`) so the React `TitleBar` component can render the drag region and custom controls.

Historical MVP15C-11/11A authority work moved asset-mutation authority into native registries rather than renderer declarations. The trusted-root registry stores an authoritative id plus normalized/canonical binding and filesystem-object metadata; registration resolves that record and fails closed on absence, revocation, detectable replacement, or uncertain containment. A crate-private UE observation validator resolves the live session, process, project, root, redacted PID, process start time, and executable binding and performs a real lifecycle check before registration and each forward/rollback MCP call. Lease renewal is one atomic compare-and-commit over complete current session/process snapshots; stopped is sticky and a stale lifecycle result changes neither lease. The desktop runtime binds registration and complete two-stage discovery publication to one MCP session object, endpoint, and generation. A post-guard local rejection records an explicit no-side-effect outcome, while a native-issued registration that never started can only be retired by its matching one-time token. `UAGENT_ENABLE_ASSET_MUTATION=1` is a separate default-off native gate; UI sandbox state may only tighten it.

Historical C14 adds a read-only exact-six fingerprint at the same desktop publication boundary. Raw direct tools and reviewed facade candidates remain separate until a pure canonicalizer validates exact names/order, descriptor schema version, five required contracts, and facade ids when used. Recursive object-key sorting and array preservation produce a SHA-256 only for a complete JSON-safe contract. C14A makes the publication authority retract-before-notify: creating a new connection generation synchronously clears discovery, facade inventory, MCP binding, SHA, and canonical byte length before endpoint validation, `connecting`/`error`, or any listener callback; stale concurrent connection/discovery completions cannot restore them. The desktop publishes only schema version, hash/byte length, per-tool name/source/hash summaries, allowlisted duplicate names, stable issue flags/counts, and a redacted current-session/discovery-generation binding. Raw unexpected/duplicate names, endpoint, raw session id, path, PID, token, credential, and full schema never enter the publication. Primitive, non-string, throwing/proxy-like, cyclic, and non-JSON inputs fail closed without an accepted hash or uncontrolled error. This adds no mutation entry point and does not change MCP transport or native contracts.

The first execute retains a maximum 60-second one-time token. Its first accepted guard creates absolute 15-minute forward and 20-minute rollback-recovery deadlines that are never extended by heartbeat or retry. Active evidence revalidates root authority and registration-bound paths. The short terminal evidence lease is path-bounded and read-only; it cannot recreate registration, token, operation, or mutation capability. The automated authority ledger is recorded; these contracts remain in acceptance rework until a clean fresh product-UI lifecycle and provenance ledger is recorded.

### `apps/desktop/web`

React 18 + Vite 5 frontend. The UI shell is structured as:

- **AppShell** — composes TitleBar + MainLayout + GlobalOverlays.
- **TitleBar** — custom window title bar with drag region and inspector toggle.
- **MainLayout** — three-column flex layout: LeftSidebar | Workspace | InspectorPane.
- **LeftSidebar** — navigation, project list, static fallback threads, and runtime task threads.
- **Workspace** — central region with ConversationViewport and ComposerDock task submission.
- **InspectorPane** — right-side UtilityDrawer with Review, Diagnostics, Evidence, and Runtime task context.
- **GlobalOverlays** — z-indexed overlay layer for future modals, command palette, and toasts.

Layout behavior:

- Left sidebar has a fixed width.
- Central workspace is flexible.
- Inspector participates in the flex flow on wide screens and becomes an overlay on narrow screens (≤ 899px) so the Composer dock area is never squeezed.
- Inspector open/close transitions use the centralized animation tokens.

### Styling

All visual values are defined as CSS custom properties in `web/src/styles/`:

- `tokens.css` — raw design tokens (colors, radius, spacing, typography, layout dimensions, z-index).
- `theme.css` — semantic tokens mapped to the dark theme (`--ua-bg`, `--ua-text`, `--ua-accent`, etc.).
- `animations.css` — motion tokens (`--ua-ease-standard`, `--ua-dur-fast`, etc.) with `prefers-reduced-motion` support.
- `globals.css` — reset, base element styles, scrollbar styling, and layout utilities.

## Package Structure

### `packages/shared`

Foundation types shared across all packages: messages, commands, plan items, tool calls, evidence records, workspace state, and the MVP1 Runtime Contract. `TaskDraft`, `TaskRecord`, `TaskEvent`, `RuntimeSnapshot`, `RuntimeClient`, `EvidenceRecord`, and `ApprovalRequest` are defined here so runtime and desktop UI consume the same protocol.

### `packages/runtime`

Agent runtime state machine plus the deterministic MVP1 `MockRuntime`. The mock runtime accepts `TaskDraft`, emits ordered `TaskEvent` records, supports `#fail` failure injection, supports cancellation, and reduces events into `RuntimeSnapshot`. It does not import React or desktop UI code.

### `packages/mcp-client`

MCP (Model Context Protocol) client abstraction layer. MVP2 implements JSON-RPC 2.0 message helpers, structured protocol/transport errors, Streamable HTTP transport, legacy HTTP+SSE fallback transport, session lifecycle (`initialize` -> `notifications/initialized`), discovery (`tools/list`, `resources/list`, `prompts/list`), and read-only execution methods (`readResource`, `callTool`). The UE product path uses localhost HTTP transports only; `stdio` remains a generic non-UE type boundary. Above this transport, the runtime applies read-only routing by default and exposes only exact, schema-checked, explicitly approved mutation operations for the registered `/Game/UAgentSandbox/<run-id>` lifecycle. Generic wrapper mutation, non-sandbox writes, and replay execution remain blocked.

### Runtime Router

`packages/runtime` owns `RuntimeRouter`, `McpReadOnlyRuntime`, read-only risk policy, and semantic capability indexing. Desktop UI submits `TaskDraft` through the same `RuntimeClient` surface. The router sends read-only MCP intent to `McpReadOnlyRuntime` only when connected; otherwise it emits `mcp_fallback_to_mock` and uses `MockRuntime`.

React components do not construct JSON-RPC requests or call `tools/call` directly. UI consumes `RuntimeSnapshot`, `TaskEvent`, MCP connection state, and desktop view models.

## Design Principles

- **Local-first**: All data stays on the user's machine. No cloud dependency.
- **Type-safe**: TypeScript throughout, with strict mode enabled.
- **Monorepo**: Clear separation of concerns via pnpm workspaces.
- **Extensible**: Provider-agnostic adapter patterns for LLM backends.
- **MCP-native**: Protocol alignment with Unreal MCP Server for UE5.8.
- **Tool-grade UI**: Desktop AI Agent workbench aesthetic — dense, functional, and extensible. No landing-page or marketing styling.
- **Guarded runtime boundary**: The mock runtime remains available for deterministic fallback and tests, while implemented native, MCP, process-observation, and sandbox mutation paths require explicit capability, trust, approval, containment, verification, and replay guards.
