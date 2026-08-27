# UAgent Development Guide

## MVP15D Final Source and Evidence Tooling Workflow

`integrations/unreal/UAgentAssetTools` targets UE `5.8.1`: engine changelist
`56057345`, compatible changelist `55116800`, and module BuildId `55116800`.
Final Pre-live Source Closure Rework 7 is historical `PARTIAL / NEEDS_FIX`; no
checkpoint was created. Rework 8 (actual bridge orchestration and exact window
instance ownership) has `Review Verdict: NEEDS_FIX`; no checkpoint was created.
Rework 9 implementation and controlled verification have `Review Verdict:
PASS` and are checkpointed at implementation commit
`aa14363f15d8bdc8eaf392c67cf444496cc8a968`. Authorized exact-manifest TEMP
cleanup removed all 4,601 roots with failures 0 and residual 0; fresh asset
`40/40` and bridge `14/14` regressions left zero matching roots. `External Gate /
TEMP cleanup: PASS`.
Final Live Acceptance Resume Rework 1 has `Review Verdict: PASS` for source
content and controlled verification and is checkpointed at implementation
commit `de248a7028d21c53c26db7b28930d583566580a6`.
The rendered settings controls now drive N1-N8 through the production adapter.
N1 performs the real registration attempt before trust, N2 runs the real
registration attempt in an exact task-owned child with the native mutation gate
disabled, and N7/N8 use actual MCP execute/rollback requests and outcomes.
Final Live Acceptance Resume 2 Rework 3 has `Review Verdict: PASS` at
implementation commit `25d1262528e0976d24f96056975fdb36bc790b77`. Retained
BuildPlugin transcripts now use bounded fail-closed secret parsing shared by
producer and manifest verifier. Invalid Resume 2 cleanup is `SATISFIED` after an
independent 2026-08-14 zero-residual scan; no live gate advanced from cleanup
alone.
Final Live Acceptance Resume 3 Rework 1 has `Review Verdict: PASS` at
`0b47dd41e92f941f87c45c5694ec75d2cc932771`; Resume 4's source-only UE 5.8
BuildPlugin descriptor verifier repair has `Review Verdict: PASS` at
`a780fc4231b99b39153fb88c9ab460717610b3f3`. Resume 5's official
Automation-report UTF-8 BOM repair has `Review Verdict: PASS` at historical
implementation commit `7916cf74cb205049e1c8967b9217cb8b64df36ca`. Resume 6's
exact-once creation-FILETIME provenance repair has `Review Verdict: PASS` at
historical implementation commit `8b2ba0bf83e70f6ecdddb12202b6cb80732300fa`.
The required side-effect scan also has exact negative-case exceptions with
unsafe-positive self-tests and currently reports zero blocked findings. Future
engine output changes fail closed until source and tests are updated.
Final Live Acceptance Resume 7 has `Review Verdict: PASS` for its D16.5
source-only verifier and inventory bridge at implementation commit
`33743bb8327b7ca8bdf5aff6469db46503c01c67`; it intentionally produced no live
lineage.
Final Live Acceptance Resume 8 Rework 1 remains accepted at historical
implementation commit `af483722d08212374f67bfc756fa34b79e195e8c`. Resume 9 has
`Review Verdict: PASS` at historical implementation commit
`51cdf22753ae2f9d90a0e3d5cb03df8495fa7e46`; the managed UE guardian now uses
the same `-NullRHI` headless contract as repository Automation and product
adapter launchers. Its pre-repair live output is partial evidence only.
Resume 10 has `Review Verdict: PASS` at historical implementation commit
`4b6e2fa35ad999882dd3b50d697ab7cb36a1552e`. The UE companion's strict package
identity now includes `Resources/mvp15d-native-binding-v2.json` in the exact
allowlist, and the production-manifest test candidate copies the same artifact.
The pre-repair Resume 10 release and live output remain partial evidence only.
Resume 11 has `Review Verdict: PASS` at historical implementation commit
`f14dc69543a42d553542b73547c3598fb39947b6`. Canonical manifest object keys now
sort through explicit case-sensitive `FString::Compare`, and the self-hash
Automation contract first accepts the complete production manifest candidate.
Resume 12 has `Review Verdict: PASS` at historical implementation commit
`38cec6f3e11af1e4b991430d3941e71c57d2c45d`. `main.tsx` initializes the fixed
desktop runtime adapter after dependency-module evaluation and before React
render; `App` uses the same idempotent initializer. The regression imports App
before injecting the Tauri global and then proves native editor capability.
Resume 13 has `Review Verdict: PASS` at historical implementation commit
`c60a094e0225d19e10238618abfeb73c299eacf0`. `getMvp14ProcessConfig()` now uses
the native-validated project name to form `<ProjectName>.uproject` before an
index scan exists, preventing a real trusted project from inheriting the fixture
`Game.uproject` descriptor.
Resume 14 has `Review Verdict: PASS` at historical implementation commit
`9d04ef710eff5a8c2aebdf0c92076e8ee477c1f5`. The fixed runtime adapter now calls
`resolveTrustedNativeRootRef` at every direct managed editor create/attach IPC
boundary, while stored UI and product state retains the opaque root token. Native
trusted-root, canonical-object and `.uproject` validation remains unchanged.
Resume 15's first accepted interim source checkpoint is historical at
`f5b514c7ac78a47c233bfdbae9e3f2d70840a08f`. The Rust runtime bridge accepts
empty MCP response bodies only for valid id-less notifications with HTTP 202,
while id-bearing requests and other statuses remain fail closed. The UE plugin
publishes the complete exact-six descriptor contract and regression-checks every
required member. The second interim source checkpoint is historical at
`6fb99447f3158c9f0326c93774fe03c5319762ff`; it accepts only native or managed
OS-observed module provenance, adds one bounded rendered-connect recovery, and
attests exact-six identity independently of legal MCP meta tools. Its clean run
then exposed order-sensitive equality for renderer predecessor-window records.
The historical third checkpoint `96e7183f9bb6644bf72191b68277b112c33ccc1d`
compares their exact key/value set independently of JSON member order. Checkpoint
`e20a9921caf77d1ac05c95ff8811acef9c63938a` additionally requires exact
successor attach, active process identity, causal ancestry, request-bound session
identity and nested production descriptor contracts. Fifth checkpoint
`bb89126d82416f0958050405ff1ab693505614f7` retains those rules and gives each
owned live phase a bounded 600-second total budget. Sixth checkpoint
`39bccbc4a88d925bd3f44ad5c5a44add10a48b39` additionally preserves only valid
64-character lowercase process-identity SHA-256 fields through retained-event
redaction; raw or malformed values remain domain-bound. Seventh checkpoint
`9fc667bceeaf81bcd087cec0f690c76bf067ad9f` recomputes observation bindings only
after the complete retained session/PID transformation. Historical eighth
checkpoint `e50022ddecf0c6a19ceb4d78dc8eb54b5e118f0b` obtains the runtime PID
binding from
the canonical raw-runtime transcript after verifying its byte descriptor and
task/source/session/runtime context. Its clean lineage exposed mutable discovery
generation drift during renderer predecessor observation. Historical ninth
checkpoint `3331e220f53f528c7cc98e61efc927428d4eaeca` captured a ready snapshot,
while the next clean lineage proved that the snapshot still reflected a later
mutable observation. Current tenth checkpoint
`8c78b172dd7ac03c7d38f0d28cc157611e4a63a7` reads the immutable generation from
the native connect receipt and retains dirty-source fail-closed classification.
Current eleventh checkpoint `f50b836cfd5370f4f01d3bb5e1cf79a42ccd48ed`
validates retraction transitions by reason: same-session generation advance for
refresh/stale completion and a changed session for connection/restart boundaries.
The separate Final Source/Tooling Rework 8 checkpoint dated 2026-08-03 remains a
historical `COMPLETE / PASS` record at implementation commit
`98c8b387e1124a519977849d48ab824e4e6bb9c5`.
`scripts/mvp15d-source-identity.mjs` and `build.rs` bind
the compiled source identity to
`uagent.mvp15d.production-source-boundary.v2`: 336 production files discovered
from 14 approved roots plus 28 exact files, 9 exclusion classes, 126 excluded
entries, and a complete 357-entry production/Git watch set. New production
files and deleted tracked production files cannot leave the identity unchanged;
normal repositories, linked worktrees, symbolic/detached HEAD, loose refs,
packed refs, and same-branch commits are covered. G14 is `IMPLEMENTED`; current
source-checkpoint G15 integrity is `COMPLETE`; G16 is `PARTIAL`. UE 5.8.1
compatibility and overall acceptance
remain `PARTIAL`; D13 / 15A is `DISPATCHED`; D14 / 15B waits on 15A and D15 /
15C waits on 15A/15B; D16 is `IN_PROGRESS`; Ready is `NO`.
Current `PASS_REAL_SMOKE` is `NO`.

Final Pre-live Source Closure Rework 1-6 are historical `PARTIAL / NEEDS_FIX`
submissions without checkpoints. Rework 9 requires each actual predecessor/
successor `App` registration to call production
`startMvp15dRuntimeBridge(invoke)`; tests may provide only the narrow native
transport fixtures needed by that route. Production code uses the adapter
registered by `App` and the persistent Rust bridge; JavaScript does not maintain
successful handoff generation, acknowledgement, claim, or receipt authority.

The parent retains the exact injected predecessor, uses manager lookup only for
native-instance verification, and registers exact one-shot `Destroyed`
completion before captured destroy. Never build the same-label successor in that
task: Tauri 2.11.3 Wry queues destroy and removes the label only during the later
event. The listener only signals; an off-main bounded wait holds no bridge mutex
and submits a fresh main-thread continuation. Both main tasks use atomic
pending/running/committed gates so a timeout can make a queued or pre-commit task
inert. The continuation revalidates handoff/task/phase/private binding and
occupancy before one build. Preserve replacement B and fail closed without a
third window. A random parent-only binding digest enters the stable identity
hash; never serialize raw handles/bindings. Parent acknowledgement v2, claim v3,
window identity v1, product summary v2, N4/N5, mutation, strict MCP POST/DELETE,
and private owned-launch controls remain wire-compatible.

Run the real Windows ordering regression with:

```powershell
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked --test tauri_wry_destroy_ordering -- --nocapture --test-threads=1
```

It uses hidden Webview windows and one `run_return` event loop, then explicitly
destroys the final replacement. `build.rs` supplies
Common-Controls v6 activation only to Windows test executables so the Wry target
can load `TaskDialogIndirect`; production link targets are unchanged.

Rust asset and bridge tests own unique TEMP roots through RAII teardown. Scan all
direct `%TEMP%` children matching `uagent-asset-*` and
`uagent-mvp15d-bridge-test-*` before and after every suite and full Cargo run.
The Rework 7 baseline is 4,601 entries (4,591 asset, 10 bridge), SHA-256
`3064cb894ce916c44fd359ccb149c7d3044731683007686cfa7885792181fc57`.
Supervisor revalidation retained all paths, recorded 141 earlier asset-root mtime
changes, and created the current manifest at SHA-256
`45b870c32fbf48c20bf1545dbdaf7ac58c036c400b521677fccd22e4dae9d893`.
On 2026-08-12, explicit R3 authorization and complete containment, descendant,
reparse/link, exact-set and live-owner preflight preceded exact cleanup. It
deleted 837 files, 4,717 internal directories and all 4,601 roots with failures
0 and residual 0. Fresh asset `40/40` and bridge `14/14` regressions passed and
left zero matching roots. Earlier mtime-only drift remains historically
unattributed. Any future matching root is new residue and fails verification.
`UAGENT_ENABLE_ASSET_MUTATION` remains default-off and is set to `1` only by a
future fixed live UI child.

On Windows, `std::fs::canonicalize` can return a local project root in verbatim
drive form (`\\?\X:\...`). Project-root normalization removes only that exact
local-drive prefix, preserves the ordinary drive/root contract, and stores the
ordinary `X:/...` form before trust binding or later read-only invokes. UNC,
verbatim UNC, forward-slash pseudo namespaces and other device paths retain a
double-separator namespace and remain fail closed; they cannot collapse to a
`/?/X:/...` pseudo-root. Run the focused boundary regressions from the repository
root:

```powershell
pnpm --filter @uagent/shared exec vitest run src/mvp7-policy.test.ts
pnpm --filter @uagent/desktop exec vitest run web/src/runtime/project-native-adapter.test.ts
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --locked verbatim
```

Controlled source and built-child checks exercise the future control flow
without claiming current clean-checkout Tool Search, installed/load/manifest,
fingerprint, retraction, full 15A N1-N8, partial, or closeout evidence. The old
release and all 15A-15C artifacts are invalid. Invoke 15A, live UE/MCP and real
mutation only through the newly dispatched dedicated task from current
implementation commit `f50b836cfd5370f4f01d3bb5e1cf79a42ccd48ed`. The old
installed release may fail only with
`FINAL_LIVE_RUNTIME_NONZERO`; every source-level authority validation must pass.

Both canonical binding fixtures are now fixed to LF with repository
attributes. A clean detached checkout must reproduce 4,865 bytes and SHA-256
`771168ec8b6e7215672a4d839fa675d88f9207876e2c51513b26d6c58da56a1b`
even when local `core.autocrlf=true`.

The build wrapper invokes the caller-supplied `RunUAT.bat` through `cmd.exe`
with shell expansion disabled and the exact ordered arguments:

```text
BuildPlugin
-Plugin=<absolute-clean-plugin>
-Package=<absolute-fresh-package>
-TargetPlatforms=Win64
-Rocket
```

Plan mode uses the same argument builder without reporting build completion.
Live mode requires a task marker and final-generation evidence root, retains
redacted stdout/stderr and optional external UAT-log derivatives, records child
and wrapper exit codes, and deletes partial package output after nonzero UAT.
The retained release Tauri binary was rebuilt for the Final Source/Tooling Rework 7
capability gate. Real UE, Tool Search, and mutation were not run
(`SKIPPED_BY_TASK_BOUNDARY`).

### Historical Source Checkpoint Rework 7 verification helpers

```bash
# D0: produce four real product-adapter sessions in a fresh task-owned project/output.
node scripts/mvp15d-product-adapter-runner.mjs --project <task-project.uproject> --output <fresh-temp-UAgent-MVP15D-Rework7-directory> --native-bridge <native-bridge>
# D0: optionally re-index already-produced, redacted DesktopRuntimeAdapter transcripts.
node scripts/mvp15d-d0-capture.mjs --session-root <desktop-boundary-snapshot> --output <fresh-external-mvp15d-rework7-d0-directory>
# D0: independently validate the resulting hash-indexed task root (no signer/key argument).
node scripts/mvp15d-d0-spike.mjs --task-root <task-root>
# Rework 7: retain the task-only build/source/manifest review bundle.
node scripts/mvp15d-build-bundle.mjs validate --task-root <fresh-external-mvp15d-rework7-build-directory> --repository <repository>
# Rework 7: run the full task-owned UE matrix across five isolated sessions.
node scripts/mvp15d-ue-automation.mjs --project <task-project> --output <fresh-external-mvp15d-rework7-ue-directory>
```

### Final-generation helpers

```bash
node scripts/mvp15d-plugin-build.mjs --mode plan --source <clean-detached-source> --package <fresh-package> --runuat <RunUAT.bat> --ue-root <UE-root> --task-id <task-id>
node scripts/mvp15d-plugin-build.mjs --mode live --source <clean-detached-source> --package <fresh-package> --runuat <RunUAT.bat> --ue-root <UE-root> --task-id <task-id> --evidence-root <final-root> --task-marker <marker>
node scripts/mvp15d-manifest.mjs create --source <clean-detached-source> --package-root <sealed-package> --runuat <RunUAT.bat> --ue-root <UE-root> --build-ledger <build-command.json> --build-result <build-result.json>
node scripts/mvp15d-manifest.mjs verify --source <clean-detached-source> --package-root <sealed-package> --runuat <RunUAT.bat> --ue-root <UE-root> --build-ledger <build-command.json> --build-result <build-result.json>
node scripts/mvp15d-final-runner.mjs <preflight|build-plan|build|manifest-create|manifest-verify|project-create|package-install|ue-automation|product-capture|ui-lifecycle|inventory-create|inventory-verify|closeout> <explicit inputs>
node scripts/mvp15d-final-live-verifier.mjs <automation-report-create|automation-report-verify> --repository <repository> --evidence-root <final-root> --task-id <task-id> --source-commit <source-commit>
node scripts/mvp15d-final-live-verifier.mjs <inventory-bridge-create|inventory-bridge-verify> --repository <repository> --evidence-root <final-root> --ue581-root <ue581-root> --task-id <task-id> --source-commit <source-commit>
node scripts/mvp15d-ue581-evidence-inventory.mjs <create|verify> <explicit inputs>
node scripts/mvp15d-icon-validate.mjs
```

The final-runner evidence root and `mvp15d-ue581-compat-*` retained bundle are
separate contracts. Run each inventory command only on its matching root and
record deterministic hash cross-links. After official UE closeout, run
`automation-report-create` and `automation-report-verify` while the exact raw
`captures/ue-automation-report/index.json` still exists. Run
`inventory-bridge-create` after both retained products contain their complete
shared evidence, while the raw report is still present in the final root, and
before either inventory is sealed. Bridge creation recomputes the raw-report
binding instead of trusting a copied or hand-authored retained record. After
allowed privacy cleanup, run each product's own create/verify commands, then
run `inventory-bridge-verify`; it requires both official inventory schemas,
full filesystem closure, valid inventory self/bundle hashes, and the same
bridge record hash-bound in both inventories. The UE581 closed contract
requires both retained verification records. `metadata/identity.json` remains
UE581-local because the final-runner does not produce it.

The runner-owned live adapters are
`scripts/mvp15d-final-ue-automation-producer.mjs`,
`scripts/mvp15d-final-product-capture-producer.mjs`, and
`scripts/mvp15d-final-ui-lifecycle-producer.mjs`. Invoke them through
`mvp15d-final-runner.mjs`; callers cannot replace their executable or supply a
pre-authored live summary. Shared process/event/ledger mechanics live in
`scripts/mvp15d-final-live-producer-helper.mjs`; it is not a caller-selectable
fourth producer. The loaded-module observer's standalone write-capable CLI is
disabled.

Product and UI adapters use an asynchronous child lifecycle. On Windows, the
helper starts the real runtime through
`scripts/mvp15d-windows-job-process-runner.ps1`, observes the task-owned
runtime event file for signed readiness, atomically creates one authenticated
driver command, and waits for active-process-zero closeout. The Tauri bridge is
default-off and accepts only the fixed ordered
`mvp15d-final-runtime-bridge` argument contract plus
`UAGENT_ENABLE_MVP15D_TASK_BRIDGE=1`.

For UE Automation, the sole production loaded-module publisher consumes the
Job runner's private early identity and re-observes the live process. It
explicitly requires PID and creation FILETIME equality and independently
derives source, project, manifest, package, install, executable, producer,
helper, observer, and Job facts before it can create the in-process publisher
brand. Raw marker/session/process identity is deleted after validation; the
published ledger retains domain-separated SHA-256 bindings and uses exclusive
atomic write/fsync/rename. Pure builders and injected observation always remain
fixture-marked. The brand is not serialized.
Exported `verifyUeProductionArtifactConsistency()` / `verifyPhaseSummary()`,
public `validate*` callers, and CLI `verify` rehash and cross-bind every
artifact, exact module record, terminal event, and zero-residue Job closeout,
then return `*_persisted_consistency_verified` with
`productionLaunchAuthorityVerified: false`. A coherent hand-authored chain may
satisfy this retained-file level. Only `executeLivePhase()` uses the fixed
non-injected launcher and consumes the unexported single-use `WeakSet` receipt
before returning `*_owned_launch_verified` with launch authority true.
`mvp15d-manifest.mjs verify` likewise reports structural installed/loaded
verification only.

Module paths are checked component-by-component below the trusted installed
root before hashing. Leaf links plus intermediate symlink, junction, mount,
and reparse components fail closed. Windows integration cleanup must retain the
Job handle before assertions, await or force closeout in `finally`, use bounded
handle-release retries, and fail when its exact fixture directory or matching
marker process remains.

The historical Rework 8 release capability probe and rendered capability modes used a fresh
one-time nonce and exclusive event file. They prove the actual binary,
renderer, normal `createDesktopRuntimeAdapter` binding, and rendered driver
exist while recording zero MCP calls, zero network calls, and zero asset
operations. These commands are test-owned and clean their nonce, driver,
runtime event file, and process tree after verification.

UE live execution uses `-ReportExportPath` and the fixed
`UAgentAssetTools.Contracts+UAgentAssetTools.ReadOnly+UAgentAssetTools.Closeout`
matrix. The parser consumes only the official JSON report plus explicit UAgent
task markers. UE stdout/stderr is ordinary log data and is retained only after
deterministic redaction. A successful result also requires exact
expected/passed/failed/skipped derivation, unchanged real Content-tree hashes,
package/installed/loaded module equality, manifest/source identity, and the
Automation process/executable binding.

Manifest create/verify recomputes detached-clean Git identity, canonical
physical bytes, exact command evidence, toolchain identity, all shipped
artifacts, and separate manifest self/file hashes. Installed verification
requires exactly one project copy and independently hashes loaded modules.
Structural loaded-module verification is insufficient for final acceptance.
Each formal live phase is dispatched to its repository-owned producer adapter,
which uses a fixed executable and validated arguments with shell expansion
disabled. Final summaries require deterministically redacted source artifacts
and domain-separated process/session/generation bindings produced through the
fixed producer ledger. Arbitrary live `--input`, fixture origin, caller-authored success,
mixed ownership/generation, hash drift, missing terminal events, and closeout
residue are rejected.

Inventory creation accepts only the documented file/directory allowlist,
including required empty directories. It rejects unknown entries, unexpected
generated trees, links/reparse points, case collisions, escapes, raw secrets,
raw local paths, PID/creation FILETIME/session identifiers, and
credential-bearing endpoints. Required redaction stores only the derivative,
deterministic ledger, binding hashes, and raw-source size/hash facts; the raw
source is not retained. Verification independently recomputes the semantic
summary in a new Node process and rejects semantic, manifest/package/module, or
inventory/hash drift.

The D0 spike must remain real product-adapter evidence and report zero mutation
actions; supporting UE Automation cannot replace it. Resolve the fixed UE 5.8
installation explicitly for the Automation runner; it is not required to be on
PATH. The build/manifest helpers derive the clean commit/tree
from Git, invoke RunUAT without a shell, reject non-DLL/debug/source package
residue, and rehash the manifest artifacts.
A dirty working tree is never a valid final manifest source. 15A/15B/15C are
not part of this source checkpoint. After
a supervisor-created and pushed source commit, a new task may run the full
read-only UE 5.8.1 compatibility matrix in a documented task-owned disposable
project. Real mutation remains prohibited until a later separate task. Keep
Epic/user-owned projects, shared Zen, credentials, binaries, logs, and local
absolute paths out of the repository.

The historical Source Checkpoint Rework 7 UE runner must give each of its five sessions a unique task marker
and validate a complete marker-bound descendant process ledger, including
creation/parent identity, first observation, exit, and final residual count.
Basename-only ownership or a final point-in-time process scan is insufficient.
The fresh project must remain below `%TEMP%\UAgent-MVP15D-Rework7-*`, and local
evidence must remain below the ignored `external/mvp15d-rework7-*` boundary.

## Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Git

### Native Build (optional)

To run the Tauri 2 native desktop build (`pnpm --filter @uagent/desktop dev` or `tauri build`), you also need:

- Rust toolchain (`rustc` / `cargo`) — install via https://rustup.rs
- Platform-specific WebView runtime (WebView2 on Windows, WebKit on macOS/Linux)

The web frontend builds and runs without Rust.

## Getting Started

```bash
# Clone and install
git clone <repo-url> uagent
cd uagent
pnpm install

# Start web dev server (browser preview, no Rust needed)
pnpm --filter @uagent/desktop web:dev

# Start Tauri native dev (requires Rust)
pnpm --filter @uagent/desktop dev

# Run all checks
pnpm typecheck
pnpm lint
pnpm test
```

## Development Commands

| Command                                         | Description                                   |
| ----------------------------------------------- | --------------------------------------------- |
| `pnpm --filter @uagent/desktop web:dev`         | Start Vite dev server on port 1420            |
| `pnpm --filter @uagent/desktop web:build`       | Build web frontend to `apps/desktop/web/dist` |
| `pnpm --filter @uagent/desktop dev`             | Start Tauri native dev (requires Rust)        |
| `pnpm --filter @uagent/desktop tauri --version` | Verify Tauri CLI is installed                 |
| `pnpm typecheck`                                | TypeScript type checking across all packages  |
| `pnpm lint`                                     | ESLint static analysis                        |
| `pnpm lint:fix`                                 | Auto-fix lint issues                          |
| `pnpm format`                                   | Format code with Prettier                     |
| `pnpm format:check`                             | Check code formatting                         |
| `pnpm test`                                     | Run all tests with Vitest                     |

## Project Structure

```text
uagent/
├── apps/
│   └── desktop/                  # Tauri 2 + React + Vite desktop app
│       ├── src-tauri/            # Tauri native shell (Rust)
│       │   ├── src/              # Rust entry points
│       │   ├── capabilities/     # Tauri permission capabilities
│       │   ├── Cargo.toml        # Rust manifest
│       │   └── tauri.conf.json   # Tauri configuration
│       ├── web/                  # React + Vite frontend
│       │   ├── src/
│       │   │   ├── app/          # Root App and UI providers
│       │   │   ├── shell/        # AppShell, TitleBar, MainLayout, GlobalOverlays
│       │   │   ├── sidebar/      # LeftSidebar
│       │   │   ├── workspace/    # Workspace (viewport + composer dock)
│       │   │   ├── inspector/    # InspectorPane
│       │   │   ├── components/   # Reusable presentational components
│       │   │   ├── stores/       # UI state stores (placeholder)
│       │   │   ├── styles/       # tokens, theme, animations, globals
│       │   │   └── types/        # UI type definitions
│       │   ├── index.html
│       │   ├── vite.config.ts
│       │   └── tsconfig.json
│       ├── vitest.config.ts
│       └── package.json
├── packages/
│   ├── shared/                   # Shared types and utilities
│   ├── runtime/                  # Agent runtime engine
│   └── mcp-client/               # MCP client abstraction
├── docs/
│   ├── architecture.md
│   ├── mvp-roadmap.md
│   └── development.md
├── package.json                  # Root workspace config
├── pnpm-workspace.yaml
├── tsconfig.json                 # Base TypeScript config
└── eslint.config.mjs             # Flat ESLint config
```

## Technology Stack

- **Runtime**: Node.js >= 20
- **Language**: TypeScript 5.5+
- **Desktop**: Tauri 2 + React 18 + Vite 5
- **Package Manager**: pnpm 9+
- **Linting**: ESLint 9 (flat config) + Prettier
- **Testing**: Vitest + Testing Library

## UI Styling

All visual tokens are centralized in `apps/desktop/web/src/styles/`:

- **`tokens.css`** — raw design values (colors, radius, spacing, typography, layout dimensions).
- **`theme.css`** — semantic tokens (`--ua-bg`, `--ua-text`, `--ua-accent`, etc.) mapped to the dark theme.
- **`animations.css`** — motion tokens with `prefers-reduced-motion` support.
- **`globals.css`** — reset and base element styles.

Components should only reference semantic tokens from `theme.css`, not raw values from `tokens.css`.

## Adding a New Package

1. Create directory under `packages/` or `apps/`
2. Add `package.json` with `@uagent/*` name and workspace dependencies
3. Add `tsconfig.json` extending `../../tsconfig.json`
4. Run `pnpm install` from root to link the workspace

## Code Style

- 2-space indentation
- Double quotes for strings
- Trailing commas
- Max 100 characters per line
- Strict TypeScript mode
- No unused locals or parameters

## Testing

Each package contains its own test suite using Vitest:

```bash
# Run all tests
pnpm test

# Run tests for a specific package
pnpm --filter @uagent/desktop test

# Watch mode
pnpm --filter @uagent/desktop test:watch
```

The desktop app includes UI shell smoke tests using Testing Library (`@testing-library/react`) with a jsdom environment.

### MVP15 Source-checkpoint Verification

Run the source-checkpoint checks from the repository root when changing the sandbox asset mutation pilot or its authority boundary. These commands do not replace D0 product-adapter evidence and do not authorize D13/15A/15B/15C:

```bash
git status --short
git diff --name-only
git diff --stat
git diff --check
pnpm typecheck
pnpm lint
pnpm build
pnpm --filter @uagent/shared test
pnpm --filter @uagent/runtime test
pnpm --filter @uagent/mcp-client test
pnpm --filter @uagent/desktop test
pnpm test
pnpm --filter @uagent/desktop web:build
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml asset_mutation -- --test-threads=1
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml ue_editor_process -- --test-threads=1
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1
node --test scripts/mvp15d-tooling.test.mjs scripts/mvp15d-build-bundle.test.mjs scripts/mvp15d-final-tooling.test.mjs
node --test scripts/mvp15d-ue581-evidence-inventory.test.mjs
node scripts/mvp15d-icon-validate.mjs
node --check scripts/mvp15d-product-adapter-runner.mjs
node --check scripts/mvp15d-d0-capture.mjs
node --check scripts/mvp15d-d0-spike.mjs
node --check scripts/mvp15d-ue-automation.mjs
node scripts/side-effect-scan.mjs
```

Run the ordinary default Cargo command in ten consecutive fresh processes and
record each exit plus library/integration counts. Do not set
`RUST_TEST_THREADS=1`, retry away a failure, or replace the default gate with the
serial diagnostic.

The side-effect scan includes five C11 structural categories for native trust, observation authority, the native gate, transaction liveness, and pre-trust root mapping. Its Rust checks target only the production authority files; legacy TS/JS keyword categories do not broadly scan Rust implementation text.

The ordinary default `cargo test` invocation is the acceptance gate. Serial
`--test-threads=1` runs remain useful targeted diagnostics but do not replace the
default gate. Observation races use explicit hooks/barriers and isolated
registries; MCP facade races use deferred promises. Any local rejection after an
accepted native guard must settle the no-side-effect outcome before returning,
and any stale unpublished registration must verify token-bound native
cancellation rather than relying on TTL cleanup.

The current working tree contains inherited visible Companion
status/contract/hash/fingerprint/generation copy in `AssetMutationPanel` and
`ConfigSettings`; run their changed UI assertions and report them as UI
copy/test updates. Rework 7 did not edit those files or the five separate
TitleBar-coupled files.

### Historical MVP15C Task-owned UE Readiness-only Check

A readiness-only check is an environment containment step, not product acceptance. Use a verified disposable or retained task copy, keep its configured task listener isolated, and place the writable DDC inside that copy. Set `UE-LocalDataCachePath` only in the task UE child environment and pass both `-ddc=NoZenLocalFallback` and `-LocalDataCachePath=<task-ddc>` through an argument-list API with `shell=false`. Do not alter permanent environment variables, shared Zen, the source project, or copied Config/Content/Plugins/Binaries. C13D proved that `PYTHONDONTWRITEBYTECODE=1` does not suppress this embedded-runtime cache surface, so it must not be treated as a cleanliness assertion or pass condition.

For the retained task copy, validate the exact generated-cache state before launch and after process exit:

```powershell
node scripts/mvp15-python-cache-surface.mjs --plugins-root <absolute-task-copy-Plugins> --contract scripts/mvp15-python-cache-contract.json --cache-state generated --json
```

The validator must report the contracted full, business, and cache aggregates with zero errors and zero unclassified paths. Only the 28 literal cache/source pairs and four literal cache directories in the contract are accepted. A 29th cache, changed ABI/header, missing or moved source, changed business/cache bytes, duplicate/case-colliding contract path, or link/reparse substitution fails closed. Never replace this with a broad `.pyc` or `__pycache__` ignore.

Use a monotonic 600-second deadline with lightweight process/module/port/log/immutable-state and contracted-cache polls every five seconds. Do not run full DDC/business aggregate workers while UE is live. Record the first simultaneous readiness time before evidence serialization, immediately close only positively identified task processes on first-ready or failure, and run the full validator and DDC/business aggregates after process exit. Independently recheck process/port/user UE/shared Zen/source/task state; any access error, unclassified cache, or business/cache contract change must fail closed and remain preserved. Do not start UAgent, Connect/Discover, call MCP/native routes, register approvals/tokens, or mutate assets in this phase.

C13C reused a warm task-local DDC and observed readiness at `+33.408s`, then generated 28 Python bytecode cache files. C13D exactly removed that residue, restored the 163-file Plugins baseline, and observed readiness at `+115.030s` with one child-only `PYTHONDONTWRITEBYTECODE=1` launch and zero retries; the embedded UE runtime regenerated the same 28 files. C13E retained that surface and produced exact 163-business/28-cache inventories through one `+94.338s` launch, with clean process/port closeout. C13E1 repairs the validator without another UE launch: any `lstat` or native `realpath` inspection error produces stable `PATH_INSPECTION_FAILED` output and a nonzero exit, while short/magic/flags/kind/source-metadata header failures all produce `header.valid: false`. The expanded 23-test matrix and fresh retained-copy read-only run pass, with the 28 cache path/size/SHA/mtime values unchanged.

### Historical MVP15C Live Descriptor Fingerprint

Use `createMvp15LiveAssetToolsetFingerprint` only with raw direct discovery plus reviewed facade candidates. Do not sort, deduplicate, discard unexpected `ue.asset.*` names, or manufacture missing fields before this boundary. The function requires the exact allowlist order, a non-empty descriptor schema version, object-valued `inputSchema`, `dryRunSchema`, `rollbackContract`, `affectedAssetsSchema`, and `evidenceQuery`, plus non-empty facade `toolsetId`/`methodId`/`schemaVersion` when facade fallback is selected. It recursively sorts plain JSON object keys, preserves array order, rejects unsupported/non-finite/cyclic/non-JSON values and primitive/non-string/throwing proxy-like descriptors, and returns no SHA for every incomplete, duplicate, unexpected, reordered, malformed, or invalid input.

Run the fingerprint test together with `mvp15-runtime.test.ts`, the desktop adapter/UI-store tests, and the shared MCP contract test. Desktop tests must cover successful and failed stale facade completion after disconnect, endpoint change, reconnect, and newer discovery, plus the first synchronous reconnect success/error observer and invalid-endpoint observer. The published object may contain only redacted summaries, allowlisted duplicate names, stable flags/counts, and a current session/generation marker; raw unexpected/duplicate names, full schemas, endpoints, paths, PIDs, tokens, and credentials stay internal. Adversarial serialization tests must include URL, Windows-path, `token=`, and `Bearer` canaries and assert the complete blocked publication contains none of them.

`connectMcp()` owns publication invalidation. At the start of every new connection generation, retract discovery, facade inventory, MCP binding, accepted hash, and canonical byte length before endpoint validation, state assignment, or `syncMcp()`. Do not defer this to a listener, microtask, promise continuation, or getter filter; the first synchronous subscriber callback is the regression boundary.

For live validation, first pass the Route A validator and record the 28-entry path/size/SHA/mtime manifest. Start only a task-owned UE and use the product adapter for Connect/Discover; permit only discovery-required `list_toolsets` and `describe_toolset`, never generic asset `call_tool`. Repeat Route A and ownership checks after normal task-process closeout. C14's controlled attempt issued one initialization request and then encountered a pre-discovery transport/environment failure; it produced no descriptor/schema decision, and all later discovery/asset/lifecycle call counts were zero. Do not report that result as schema rejection or product mutation smoke, and do not replace it with fixture descriptors. C14A did not rerun this live procedure.

Real UE sandbox smoke requires a supervisor-local disposable project and explicit process ownership. Start the task-owned UAgent native app from a dedicated PowerShell session with the strict native gate set only for that process:

```powershell
$env:UAGENT_ENABLE_ASSET_MUTATION = "1"
pnpm --filter @uagent/desktop tauri:dev
```

Unset or omit the variable for the required gate-OFF negative smoke. Values other than the exact string `1` are OFF. UI sandbox state remains an additional restriction and cannot enable a native-OFF process. Do not place project paths, process ids, tokens, credential-bearing endpoints, or other local facts in repository documents.

The smoke must use product UI `validate -> add -> confirmTrust`, attach a live observation, mutate only `/Game/UAgentSandbox/<run-id>/**`, verify external Content evidence, cross the original token TTL without crossing the transaction cap, exercise inverse rollback, and confirm replay delta zero and non-sandbox stability. Follow `docs/mvp15-manual-smoke.md` and record the plugin identity/fingerprint required by `docs/mvp15-ue-mcp-plugin-baseline.md`.

The 2026-07-18 MVP15C / 09Z `PASS_REAL_SMOKE` result is historical happy-path evidence, not current authority verification. Rework 8 is `NEEDS_FIX` because its then-current acceptance manifest file SHA conflicted with retained evidence and the other repository documents; Rework 9 and the D0-D12 source checkpoint are `COMPLETE` historical facts. The active UE/build/module bytes are known, while authoritative official mapping, the final clean 15A identity, and the separately authorized product-UI lifecycle remain later gates. Never convert a readiness-only, pre-discovery transport failure, skipped, unavailable, blocked, or supervisor-rejected run into a schema rejection or product-smoke pass.
