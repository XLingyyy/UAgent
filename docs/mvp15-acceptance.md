# MVP15 Acceptance - Native Authority Binding Rework

Current stage: **MVP15D - Final 15A-15C/D16 Live Acceptance**.

Final Pre-live Source Closure Rework 7 is historical `PARTIAL / NEEDS_FIX`; no
checkpoint was created. Rework 8 (actual bridge orchestration and exact window
instance ownership) has `Review Verdict: NEEDS_FIX`; no checkpoint was created.
Rework 9 implementation and controlled verification have `Review Verdict:
PASS` and are checkpointed at implementation commit
`aa14363f15d8bdc8eaf392c67cf444496cc8a968`. Authorized exact-manifest TEMP
cleanup removed all 4,601 roots with failures 0 and residual 0; fresh asset
`40/40` and bridge `14/14` regressions left zero matching roots. `External Gate /
TEMP cleanup: PASS`; the historical mtime actor remains unconfirmed.
Final Live Acceptance Resume Rework 1 has `Review Verdict: PASS` at
implementation commit `de248a7028d21c53c26db7b28930d583566580a6`. Its rendered
N1-N8 controls route through production semantics: N1/N2 use real registration
authority, and N7/N8 bind actual MCP execute/rollback outcomes. No
clean-checkout 15A-15C gate advanced.
Final Live Acceptance Resume 2 Rework 3 has `Review Verdict: PASS` at
implementation commit `25d1262528e0976d24f96056975fdb36bc790b77`. Its source-only
retained-transcript privacy repair fails closed on truncated quotes, covers
adjacent punctuation tails, and uses a bounded shared scanner. Invalid Resume 2
cleanup is `SATISFIED` after an independent 2026-08-14 zero-residual scan; no
clean-checkout live gate advanced from cleanup alone.
Final Live Acceptance Resume 3 Rework 1 has `Review Verdict: PASS` at
implementation commit `0b47dd41e92f941f87c45c5694ec75d2cc932771` for live bridge,
listener ownership and strict real UE restart source behavior. Resume 4 then
reached a real UE 5.8.1 BuildPlugin package and repaired the descriptor verifier.
That source-only repair has `Review Verdict: PASS` at implementation
commit `a780fc4231b99b39153fb88c9ab460717610b3f3`; its pre-repair lineage was
invalidated and removed. Resume 5 then repaired parsing of the official UE
Automation report's leading UTF-8 BOM at historical implementation commit
`7916cf74cb205049e1c8967b9217cb8b64df36ca`. Resume 6 repaired exact-once
creation-FILETIME retention and the required side-effect scan at historical
implementation commit `8b2ba0bf83e70f6ecdddb12202b6cb80732300fa`.
Both repairs have `Review Verdict: PASS`; their pre-repair live lineages remain
invalidated, so no live gate advanced.
Final Live Acceptance Resume 7 has `Review Verdict: PASS` for the D16.5
source-only raw-report verifier and two-inventory bridge at current implementation
commit `33743bb8327b7ca8bdf5aff6469db46503c01c67`; it produced no live lineage.
The separate Final Source/Tooling Rework 8 checkpoint dated 2026-08-03 remains a
historical `COMPLETE / PASS` record at implementation commit
`98c8b387e1124a519977849d48ab824e4e6bb9c5`. G14 is `IMPLEMENTED`; current
source-checkpoint G15 integrity is `COMPLETE`; G16 is `PARTIAL`.
Real UE 5.8.1 compatibility and overall final acceptance remain `PARTIAL`;
D13 / 15A is `DISPATCHED`; D14 / 15B waits on 15A and D15 / 15C waits on
15A/15B; D16 is
`IN_PROGRESS`; Ready is `NO`.
Current `PASS_REAL_SMOKE` is `NO`.

Final Pre-live Source Closure Rework 1-6 are historical `PARTIAL / NEEDS_FIX`
submissions without checkpoints. The supervisor-reviewed Rework 9 implementation keeps both actual `App`
registrations on production `startMvp15dRuntimeBridge(invoke)` and splits parent
lifecycle ownership across two event-loop phases. The first main-thread task
validates the exact injected predecessor, registers an exact one-shot
`Destroyed` completion, and initiates captured-window destroy without build or
successful acknowledgement. An off-main bounded wait holds no `BridgeState`
mutex; after authoritative removal it queues a second main-thread task that
revalidates handoff/task/phase/private binding and current occupancy. An empty
`main` permits one successor build; replacement B is preserved and produces a
failed parent result. Atomic timeout gates reject late queued/running tasks.

The hidden real Webview/Wry regression reproduces the old same-task collision as
`WebviewLabelAlreadyExists("main")`, observes manager removal with build count 0,
builds a different-HWND successor only afterward, and verifies the replacement
continuation creates no third window. Bridge tests keep acknowledgement, claim,
publish, and complete closed for failure/replacement outcomes. The parent-only
opaque binding remains inside the stable identity hash; acknowledgement v2,
claim v3, window identity v1, product summary v2, N4, N5, second rollback, and
observed DELETE controls remain compatible.

The TEMP residue gate is `PASS`. The exact cleanup manifest has 4,601 entries
(4,591 asset, 10 bridge), SHA-256
`45b870c32fbf48c20bf1545dbdaf7ac58c036c400b521677fccd22e4dae9d893`.
The authorized cleanup passed full containment, descendant, reparse/link,
exact-set and live-owner preflight, then deleted 837 files, 4,717 internal
directories and all 4,601 roots. Failures and residuals were zero. Fresh asset
`40/40` and bridge `14/14` tests passed, and their post-test scan remained zero.
Earlier mtime-only observations remain historical; their actor is unconfirmed.

These are source implementation and controlled-test facts. No current
clean-checkout Tool Search, installed/load/manifest tuple, live fingerprint,
retraction boundary, full 15A N1-N8 acceptance root, partial/unknown sequence,
parent closeout, UE Automation, MCP live session, or mutation evidence was
produced. The production delta invalidates the former
release and all prior 15A-15C evidence. No live Gate advance is claimed.

The historical accepted Final Source/Tooling Rework 8 checkpoint dated 2026-08-03 has a strict default-off production Tauri event-file bridge,
actual renderer/native task handshake, asynchronous Job-owned product/UI
orchestration, an official Unreal Automation JSON report source, a live
loaded-module observer with an owned publisher protocol, and a
transitive production source boundary with an exact Git watch set. The
then-fresh release binary passed native/product-renderer/UI-renderer
capability-only handshakes with zero MCP, network, and asset actions. These
are capability facts; real product discovery, UE execution, Tool Search, and
the asset lifecycle did not run (`SKIPPED_BY_TASK_BOUNDARY`).
The unsafe predecessor evidence root was invalidated and removed for
`TOKEN_AND_RAW_PATH_EVIDENCE_INVALID`. Resume 9 has `Review Verdict: PASS` at
historical implementation commit `51cdf22753ae2f9d90a0e3d5cb03df8495fa7e46`
for the task-owned managed UE `-NullRHI` launch repair. Resume 10 also has
`Review Verdict: PASS` at historical implementation commit
`4b6e2fa35ad999882dd3b50d697ab7cb36a1552e` for adding the sealed native-binding
resource to the UE companion's exact six-artifact manifest allowlist and test
fixture. Both pre-repair live lineages remain source-invalidated partial evidence.
Full read-only compatibility is assigned to a new clean-checkout task from the
current checkpoint. Real mutation remains gated until 15A and 15B pass there.
Resume 11 has `Review Verdict: PASS` at historical implementation commit
`f14dc69543a42d553542b73547c3598fb39947b6` for aligning the UE consumer's
canonical object-key ordering with the case-sensitive manifest producer and
adding a positive production self-hash contract. Its predecessor exact-six
failure is source-invalidated partial evidence.
Resume 12 has `Review Verdict: PASS` at historical implementation commit
`38cec6f3e11af1e4b991430d3941e71c57d2c45d` for moving fixed desktop runtime-
adapter construction to the application bootstrap after dependency evaluation.
Its predecessor-source ExactSix `1 / 1 / 0 / 0` and fixed 15A `3 / 3 / 0 / 0`
are source-invalidated diagnostics after the rendered 15B capability repair.
Resume 13 has `Review Verdict: PASS` at historical implementation commit
`c60a094e0225d19e10238618abfeb73c299eacf0`. Its clean `38cec6f...` lineage
passed ExactSix `1 / 1 / 0 / 0` and fixed 15A `3 / 3 / 0 / 0`, then rendered
15B exposed the pre-index fixture `Game.uproject` fallback in a project whose
validated descriptor was `FinalHost.uproject`. The accepted source derives that
descriptor from the native-validated project name; the live lineage predates the
repair and remains diagnostic.
Resume 14 has `Review Verdict: PASS` at historical implementation commit
`9d04ef710eff5a8c2aebdf0c92076e8ee477c1f5`. Its clean `c60a094e...` lineage
passed ExactSix `1 / 1 / 0 / 0` and fixed 15A `3 / 3 / 0 / 0`, then rendered
15B exposed an opaque trusted-root token at a direct native managed-process
boundary. The accepted source resolves that token only for direct native editor
create/attach IPC and preserves native canonical trust validation; the live
lineage predates the repair and remains diagnostic.
Resume 15's first accepted interim source checkpoint is historical at
`f5b514c7ac78a47c233bfdbae9e3f2d70840a08f`. Its clean `9d04ef7...` lineage
passed ExactSix `1 / 1 / 0 / 0` and fixed 15A `3 / 3 / 0 / 0`, then rendered
15B exposed legal notification `HTTP 202` empty-body handling and four missing
exact-six descriptor contract objects. Both source defects are repaired and
fresh automated source verification passes; all predecessor live evidence is
source-invalidated. That checkpoint then passed ExactSix `1 / 1 / 0 / 0` and
fixed 15A `3 / 3 / 0 / 0`; rendered 15B exposed three additional production
defects. The second interim source checkpoint
`6fb99447f3158c9f0326c93774fe03c5319762ff` accepts task-owned OS-observed
`managed` provenance, provides one bounded same-control Connect recovery, and
attests exact-six identity independently from legal MCP meta tools. Its clean
lineage passed ExactSix and fixed 15A, then rendered 15B exposed order-sensitive
comparison of equal predecessor-window records. Historical third checkpoint
`96e7183f9bb6644bf72191b68277b112c33ccc1d` compares their exact keys and values
independently of JSON member order. Its clean run exposed five additional
successor/process/ancestry/session/contract defects. Fourth checkpoint
`e20a9921caf77d1ac05c95ff8811acef9c63938a` closes them. Fifth checkpoint
`bb89126d82416f0958050405ff1ab693505614f7` raises the bounded owned live-phase
budget from 180 to 600 seconds. Its clean chain completed the real rendered 15B
producer and exposed retained-event process-identity key drift. Sixth checkpoint
`39bccbc4a88d925bd3f44ad5c5a44add10a48b39` preserves validated digest fields
while binding raw values. Its clean chain exposed a stale observation binding
after retained session/PID conversion. Seventh checkpoint
`9fc667bceeaf81bcd087cec0f690c76bf067ad9f` recomputes that binding over the final
retained material. Its clean rendered producer exposed a runner lookup against
the filtered phase transcript. Eighth checkpoint
`e50022ddecf0c6a19ceb4d78dc8eb54b5e118f0b` validates the canonical raw-runtime
file and supplies its cross-bound PID binding to execute and persisted verification.
Its clean lineage passed release, ExactSix and fixed 15A before rendered 15B
exposed predecessor-generation drift during concurrent discovery. Ninth checkpoint
`3331e220f53f528c7cc98e61efc927428d4eaeca` captured a verified ready snapshot,
but its clean lineage proved that the snapshot still used a later mutable
observation. Current tenth checkpoint
`8c78b172dd7ac03c7d38f0d28cc157611e4a63a7` binds restart to the immutable native
connect-receipt generation. The same task remains active and all predecessor live
evidence is source-invalidated.

Persisted verification reopens schemas, bytes, hashes, process/artifact facts,
events, and summaries. It returns `*_persisted_consistency_verified` and
`productionLaunchAuthorityVerified: false`; a coherent hand-authored chain may
reach this level. Owned launch authority is a same-process result only:
`executeLivePhase()` must use the fixed producer and real non-injected launcher,
check the actual child and full retained cross-binding, then consume an
unexported single-use `WeakSet` receipt before returning
`*_owned_launch_verified` with `productionLaunchAuthorityVerified: true`.
No serialized field or caller argument can substitute for that receipt.

## MVP15D Current Gate Override

| Gate                               | Requirement                                                                                                                              | Status             | Evidence                                                                                                                                                                                                                                                                                                                   | Open item                                                                                     |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| D0                                 | Four real product-adapter registration/tool-search combinations, Refresh/reconnect/renderer restart stale retraction, and ADR selection. | COMPLETE           | Retained D0 `external/mvp15d-rework7-d0-20260726_190100` validates four combinations, 129 indexed artifacts, zero mutation, and Direct; transcript index `b87e0a8...` and route decision `3fee196...`.                                                                                                                     | None for source checkpoint.                                                                   |
| D1-D4                              | Independent plugin skeleton, task-only build manifest contract, companion identity, and exact-six registration selected by D0.           | COMPLETE           | Retained build/source/manifest bundle `external/mvp15d-rework7-build-20260726_203000` has 60 files total (59 inventory-tracked payload files plus `inventory.json`) and validates byte equality, manifest self-hash, compiled modules, and zero closeout residuals.                                                        | Final clean 15A package identity remains later, separately authorized work.                   |
| D5-D8                              | Exact run-root policy, five-operation dry-run, native binding, execution, ownership ledger, and inverse rollback.                        | COMPLETE           | Rework 7 preserves the canonical tuple, atomic create-to-identity ownership, partial/unknown-effect handling, native retraction, and run-root cleanup; UE records `48/48`, unchanged Content, and zero residuals.                                                                                                          | None for source checkpoint.                                                                   |
| D9-D12                             | Provenance/fingerprint/product status UI and automated security scan.                                                                    | COMPLETE           | Two workspace-test processes pass at shared 33 / MCP 46 / runtime 825 / desktop 725 + 3 skipped; ten default Cargo runs and serial pass at 154+2; tooling is `23/23`, build-bundle `10/10`, side-effect blocked count zero.                                                                                                | Historical supervisor exit `134` is retained as a residual process-stability fact.            |
| Historical source/tooling Rework 2 | Producer-authenticity, valid Tauri icon/bundle, independent UE 5.8.1 identity, read-only compatibility attempt.                          | PARTIAL            | The supervisor verdict was `NEEDS_FIX`. Icon preflight plus MSI/NSIS passed; the companion compiled and loaded; MCP Tool Search on returned three meta-tools. The attempt stopped before exact-six and retained evidence that was later invalidated.                                                                       | Rework 3 replaces its source and evidence weaknesses; the old run is history only.            |
| Source/tooling Rework 3            | Fixed adapter wrappers, fixture/live separation, strict evidence allowlist/redaction, and unsafe-root cleanup.                           | PARTIAL            | The supervisor verdict was `NEEDS_FIX`: production Tauri/renderer/UE sources did not implement the declared runtime-event protocol and positive tests substituted synthetic callbacks.                                                                                                                                     | Superseded by Rework 4.                                                                       |
| Source/tooling Rework 4            | Production runtime bridge, UE structured report source, asynchronous orchestration, and real-binary capability handshakes.               | PARTIAL            | Historical supervisor verdict `NEEDS_FIX`; capability probes established native/product/UI reachability only.                                                                                                                                                                                                              | Superseded by later source/tooling reworks.                                                   |
| Source/tooling Rework 5            | Checkpoint attestation and UE ledger closeout.                                                                                           | PARTIAL            | Historical supervisor verdict `NEEDS_FIX`; observer timing, path privacy, and source closure remained open.                                                                                                                                                                                                                | Superseded by later source/tooling reworks.                                                   |
| Source/tooling Rework 6            | Live process identity, exact companion observation, bound path-free atomic ledger, and initial source closure.                           | PARTIAL            | Historical supervisor verdict `NEEDS_FIX`; no checkpoint was created. Caller-manufactured production origin, an observer CLI authority bypass, incomplete transitive source coverage, ancestor reparse acceptance, and fail-open cleanup remained.                                                                         | Closed at source level by Final Source/Tooling Rework 7.                                      |
| Source/tooling Rework 7            | Publisher provenance, downstream cross-binding, transitive source closure, ancestor-reparse rejection, and cleanup closure.              | PARTIAL            | Supervisor `NEEDS_FIX`; no checkpoint. The source/observer/cleanup facts remain accepted, while its persisted verifier accepted a coherent hand-authored full chain and therefore did not establish same-process launch ownership.                                                                                         | Closed at source level by Rework 8.                                                           |
| Source/tooling Rework 8            | Separate persisted consistency from same-process fixed-producer launch authority and close the report contract.                          | COMPLETE           | Exported/CLI verification returns explicit persisted consistency with `productionLaunchAuthorityVerified: false`; only `executeLivePhase()` can consume the private single-use receipt and return owned-launch status. Implementation commit `98c8b387e1124a519977849d48ab824e4e6bb9c5` is checkpointed.                   | Proceed with a separate clean-checkout read-only compatibility task.                          |
| Pre-live Source Closure Rework 1-4 | Close final production-source authority gaps before live execution.                                                                      | PARTIAL            | Each supervisor verdict was `NEEDS_FIX`; no checkpoint exists. Rework 4 still depended on a renderer callback, external N4 semantics, mock N5 generation, incomplete second rollback, and connect-only disconnect evidence.                                                                                                | Historical; superseded by Rework 5.                                                           |
| Pre-live Source Closure Rework 5   | Parent renderer successor, native N4/N5 parity, complete second rollback, and actual MCP DELETE receipt.                                 | PARTIAL            | Historical supervisor verdict `NEEDS_FIX`; parent outcomes, actual App integration, managed failure cleanup, and TEMP residue closure remained open. No checkpoint exists.                                                                                                                                                 | Superseded by Rework 6 source candidate.                                                      |
| Pre-live Source Closure Rework 6   | Parent acknowledgement, actual App integration, managed failure cleanup, and test-residue prevention.                                    | PARTIAL            | Historical supervisor verdict `NEEDS_FIX`; no checkpoint. Its 253-entry manifest is a historical subset of the current inventory.                                                                                                                                                                                          | Superseded by Rework 7 source candidate.                                                      |
| Pre-live Source Closure Rework 7   | Production-native App handoff, parent-owned predecessor window binding, and complete TEMP inventory.                                     | PARTIAL            | Historical supervisor verdict `NEEDS_FIX`; no checkpoint. The production orchestrator was bypassed in the two-App happy path and the delayed parent lifecycle could mistake a same-label replacement for the invoking predecessor. The 4,601-entry manifest remains authoritative.                                         | Superseded by Rework 8 and the supervisor-reviewed Rework 9 implementation.                   |
| Pre-live Source Closure Rework 8   | Actual predecessor/successor production bridge orchestration and exact injected predecessor-window ownership.                            | PARTIAL            | `Review Verdict: NEEDS_FIX`. Its same-task destroy/build model did not wait for authoritative `Destroyed`/manager removal.                                                                                                                                                                                                 | Superseded by the supervisor-reviewed Rework 9 implementation; no Rework 8 checkpoint.        |
| Pre-live Source Closure Rework 9   | Exact one-shot destroy completion, post-`Destroyed` successor continuation, timeout gate, and real Wry replacement ordering.             | COMPLETE           | `Review Verdict: PASS`; implementation commit `aa14363f15d8bdc8eaf392c67cf444496cc8a968`. Hidden Webview/Wry coverage proves queued collision, manager removal/build count 0, different-HWND successor, and replacement B preservation. Authorized exact-manifest cleanup removed all 4,601 TEMP roots with zero residual. | Later clean-checkout/live evidence remains open.                                              |
| Live Acceptance Resume Rework 1    | Bind visible N1-N8 controls to production registration, gate-off child, MCP outcome, and verifier semantics.                             | COMPLETE           | `Review Verdict: PASS`; implementation commit `de248a7028d21c53c26db7b28930d583566580a6`. Focused/full source suites and a production-built N2 child smoke pass.                                                                                                                                                           | Historical accepted source scope.                                                             |
| Live Acceptance Resume 2 Rework 3  | Fail closed on truncated retained secrets, cover punctuation tails, and keep producer/verifier scanning bounded and coherent.            | COMPLETE           | `Review Verdict: PASS`; implementation commit `25d1262528e0976d24f96056975fdb36bc790b77`. Source/tooling regressions pass; no live gate advanced.                                                                                                                                                                          | Historical accepted privacy scope; cleanup is closed.                                         |
| Live Acceptance Resume 3 Rework 1  | Isolate live bridge authority, own the exact UE/MCP listener, and consume strict real UE restart receipts.                               | COMPLETE           | `Review Verdict: PASS`; implementation commit `0b47dd41e92f941f87c45c5694ec75d2cc932771`. Focused/full source suites and guardian/restart regressions pass.                                                                                                                                                                | Historical accepted source scope included by the current checkpoint.                          |
| Live Acceptance Resume 4           | Accept the exact UE 5.8 BuildPlugin descriptor rewrite while rejecting every other semantic drift.                                       | COMPLETE           | `Review Verdict: PASS`; implementation commit `a780fc4231b99b39153fb88c9ab460717610b3f3`. The old package lineage was invalidated and removed.                                                                                                                                                                             | Superseded by the accepted Resume 5 checkpoint.                                               |
| Live Acceptance Resume 5           | Accept the official UE Automation report's single leading UTF-8 BOM without weakening JSON, matrix or raw-byte evidence checks.          | COMPLETE           | `Review Verdict: PASS`; implementation commit `7916cf74cb205049e1c8967b9217cb8b64df36ca`. The old release/package/live lineage was invalidated and removed.                                                                                                                                                                | Superseded by the accepted Resume 6 checkpoint.                                               |
| Live Acceptance Resume 6           | Retain canonical UE process provenance with the creation FILETIME binding exactly once and close required scanner false positives.       | COMPLETE           | `Review Verdict: PASS`; implementation commit `8b2ba0bf83e70f6ecdddb12202b6cb80732300fa`. The diagnostic live lineage predates the repair and is invalid for acceptance.                                                                                                                                                   | Historical accepted source scope included by the current checkpoint.                          |
| Live Acceptance Resume 7           | Independently bind the raw official report and bridge the sealed final-runner/UE581 inventory products.                                  | COMPLETE           | `Review Verdict: PASS`; implementation commit `33743bb8327b7ca8bdf5aff6469db46503c01c67`. Source/tooling and synthetic fail-closed verification passed; no live gate advanced.                                                                                                                                             | Restart 15A from this exact clean source checkpoint.                                          |
| Live Acceptance Resume 8 Rework 1  | Normalize exact Windows verbatim local-drive roots consistently across shared adapter and native trust/read-only consumers.               | COMPLETE           | `Review Verdict: PASS`; implementation commit `af483722d08212374f67bfc756fa34b79e195e8c`. Shared/adapter/Rust and full source verification passed; no current-source live gate advanced.                                                                                                                                    | Restart 15A from this exact clean source checkpoint.                                          |
| Live Acceptance Resume 9           | Align the task-owned managed UE guardian with the headless `-NullRHI` launch contract after the first rendered 15B attempt.                | COMPLETE           | `Review Verdict: PASS`; implementation commit `51cdf22753ae2f9d90a0e3d5cb03df8495fa7e46`. Retained real diagnostics prove listener startup and `UAgentAssetTools.ReadOnly`; the pre-repair live lineage cannot advance final authority.                                                                                           | Restart build and 15A from this exact clean source checkpoint.                                |
| Live Acceptance Resume 10          | Accept the sealed native-binding resource as the sixth exact companion package artifact without weakening identity verification.         | COMPLETE           | `Review Verdict: PASS`; implementation commit `4b6e2fa35ad999882dd3b50d697ab7cb36a1552e`. Production and its exact-manifest test fixture now include `Resources/mvp15d-native-binding-v2.json`; official UE 5.8.1 BuildPlugin compiles both modules.                                                           | Restart build and 15A from this exact clean source checkpoint.                                |
| Live Acceptance Resume 11          | Match the manifest producer's case-sensitive canonical JSON key order and retain strict self-hash rejection.                             | COMPLETE           | `Review Verdict: PASS`; implementation commit `f14dc69543a42d553542b73547c3598fb39947b6`. The explicit predicate and positive production-manifest assertion compile in both UE modules; the predecessor exact-six report records the causal hash mismatch.                                                           | Restart exact-six and fixed 15A from this clean source checkpoint.                            |
| Live Acceptance Resume 12          | Initialize the single fixed desktop runtime adapter after the Tauri bridge can be available and preserve actual-App registry ownership. | COMPLETE           | `Review Verdict: PASS`; implementation commit `38cec6f3e11af1e4b991430d3941e71c57d2c45d`. Late-Tauri injection, actual-App restart, ordinary disabled startup and full workspace verification pass; predecessor live evidence is source-invalidated.                                                  | Restart exact-six and fixed 15A from this clean source checkpoint.                            |
| Live Acceptance Resume 13          | Use the validated real project descriptor before an index scan and preserve the fixture fallback only when no active project exists.    | COMPLETE           | `Review Verdict: PASS`; implementation commit `c60a094e0225d19e10238618abfeb73c299eacf0`. Rendered no-index regression passes with `FinalHost.uproject`; predecessor ExactSix/15A passes and 15B failure remain source-invalidated diagnostics.                                                                           | Restart exact-six and fixed 15A from this clean source checkpoint.                            |
| Live Acceptance Resume 14          | Resolve opaque trusted-root bindings at every direct managed editor create/attach native boundary while preserving opaque UI state.     | COMPLETE           | `Review Verdict: PASS`; implementation commit `9d04ef710eff5a8c2aebdf0c92076e8ee477c1f5`. Focused/full workspace, typecheck, lint, build and source-identity verification pass; the `c60a094e...` ExactSix/15A and rendered 15B failure are source-invalidated diagnostics.                              | Restart exact-six and fixed 15A from this clean source checkpoint.                            |
| Live Acceptance Resume 15          | Close the rendered MCP and exact-six contract defects discovered across the same live task.                                               | IN_PROGRESS        | Tenth interim source checkpoint `Review Verdict: PASS`; current implementation commit `8c78b172dd7ac03c7d38f0d28cc157611e4a63a7`. Final tooling `32/32`, full tooling `114/114`, source identity `20/20`, workspace `1685`, Rust `198/198`, lint, typecheck and build pass; every `3331e220...` live artifact is source-invalidated. | Continue the same task with a fresh full live chain from this checkpoint.                     |
| D13 / 15A                          | Clean build/install/load and authoritative manifest identity.                                                                            | DISPATCHED         | The clean `3331e220...` lineage passed this gate, then became source-invalidated by the tenth repair. Current implementation commit `8c78b172dd7ac03c7d38f0d28cc157611e4a63a7` exists and the clean restart is dispatched.                                                                                       | Use that commit with final build/manifest tooling and verify installed == loaded == manifest. |
| D14 / 15B                          | Current-generation product-adapter exact-six live fingerprint.                                                                           | WAITING_ON_15A     | The `3331e220...` producer completed, but final validation rejected its predecessor generation; the repair is source-verified and requires a new accepted-source 15A lineage.                                                                                                                                              | Run only after a new final 15A package passes.                                                |
| D15 / 15C                          | Fresh rendered product-UI lifecycle, negatives, replay, and cleanup.                                                                     | WAITING_ON_15A_15B | Not run; mutation count remains zero.                                                                                                                                                                                                                                                                                      | Run only after 15A and 15B pass.                                                              |
| D16                                | Repository documentation and final delivery.                                                                                             | IN_PROGRESS        | Historical states, accepted source checkpoints through the Resume 15 interim source checkpoint, cleanup closure and deferred live work are synchronized.                                                                                                                                                         | Fresh 15A-15C live evidence and final closeout remain outstanding.                            |

## Historical Supporting Gate Evidence

The following C11-C14A records are retained as historical supporting evidence.
They do not replace the new D0-D12 source-checkpoint matrix, current manifest
and companion attestation checks, or the fresh verification required by this
rework.

| Gate                                  | Requirement                                                                                                                       | Current status | Current evidence                                                                                                                                                                                                                                                                                                                                                             | Open item                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| G0 baseline frozen                    | Preserve the narrow sandbox scope and reopen public status before implementation.                                                 | COMPLETE       | Historical implementation and 09Z ledger are retained, while current status is explicitly downgraded and the narrow scope remains frozen.                                                                                                                                                                                                                                    | None.                                                                                          |
| G1 dry-run binding                    | Bind all five planned forward operations and exact arguments before approval.                                                     | PARTIAL        | Fresh runtime regression passes 789/789, including stateful MCP-binding drift settlement and recovery.                                                                                                                                                                                                                                                                       | Fresh real plugin evidence is still required.                                                  |
| G2 wrapper-only blocked               | Incomplete or wrapper-only discovery must fail closed.                                                                            | IMPLEMENTED    | C14A tests cover direct/facade exact-six, mixed precedence, every required field, missing/allowlisted-duplicate/unexpected/reordered inputs, invalid/non-JSON and primitive/proxy-like descriptors, reconnect success/error synchronous observers, invalid endpoints, and stale completions. Blocked results publish no SHA-256 and expose no raw unexpected/duplicate name. | A successful real discovery capture is still required for G16.                                 |
| G3 sandbox path boundary              | Writes remain below the exact registered run root.                                                                                | PARTIAL        | Historical policy and tests plus the complete 11A automated regression exist.                                                                                                                                                                                                                                                                                                | Fresh product-UI real smoke remains required.                                                  |
| G4 dry-run result                     | Produce affected assets, rollback plan, external evidence queries, and hashes without mutation.                                   | PARTIAL        | Historical 09Z dry-run evidence exists.                                                                                                                                                                                                                                                                                                                                      | A fresh product-UI dry-run has not been executed.                                              |
| G5 approval registry / replay blocked | Registration resolves authoritative native root and observation facts; token is one-time and replay remains recorded-only.        | BLOCKED        | Native 24/24 asset tests prove token-bound cancellation only for unstarted/no-ownership records; 11A runtime tests prove stale-run cleanup.                                                                                                                                                                                                                                  | Fresh real authority evidence is required.                                                     |
| G6 native guard                       | Every execute/rollback guard resolves registration-owned authority and rechecks live process/project/root/session/PID before MCP. | BLOCKED        | Native UE process 14/14 proves atomic session/process renewal, sticky stop, replacement/removal rejection, and one-deadline success; runtime proves accepted-guard no-side-effect settlement and rollback recovery.                                                                                                                                                          | Fresh negative and lifecycle product ledgers remain required.                                  |
| G7 exact tool execution evidence      | Five forward results are strict and side-effect-aware.                                                                            | PARTIAL        | Historical 09Z recorded five exact dispatches. C14 intentionally performed read-only Connect/Discover only and made no asset call.                                                                                                                                                                                                                                           | Repeat the complete lifecycle only after G16 discovery/provenance prerequisites are satisfied. |
| G8 rollback ownership                 | Only exact owned effects receive inverse rollback.                                                                                | PARTIAL        | Historical automated and 09Z evidence exists.                                                                                                                                                                                                                                                                                                                                | Repeat after recovery-lease changes.                                                           |
| G9 evidence authority                 | Active evidence revalidates native root/path authority; terminal evidence remains read-only.                                      | BLOCKED        | Historical terminal evidence does not prove revoked-root rejection.                                                                                                                                                                                                                                                                                                          | Fresh authority and path tests required.                                                       |
| G10 replay zero delta                 | Replay must not call native, MCP, provider, verify, or rollback paths.                                                            | PARTIAL        | Historical replay delta is `0/0/0/0/0`.                                                                                                                                                                                                                                                                                                                                      | Repeat in the fresh run.                                                                       |
| G11 side-effect scan                  | All legacy and five authority-bypass categories have zero blocked findings.                                                       | IMPLEMENTED    | Fresh read-only scan exits 0 at 1,544 files / 5,074 allowed / 0 blocked / 1,824 review findings.                                                                                                                                                                                                                                                                             | None for source checkpoint.                                                                    |
| G12 full automated verification       | Typecheck, lint, package/workspace tests, web build, Rust fmt/check/tests, and scan pass.                                         | IMPLEMENTED    | Rework 9 verification: typecheck/lint/build exit 0; shared 33, MCP 51, runtime 825, desktop 757 passed / 3 skipped; Node tooling/inventory 65, asset mutation 40, and UE process 16 passed. Two consecutive full Cargo runs each record 176 library, 2 native bridge, and 1 real Wry integration test; the focused Wry target also passes.                                   | Real UE tests remain excluded by the task boundary.                                            |

## Current Progression Gates

| Gate                                         | Requirement                                                                                                                        | Current status | Current evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Open item                                                    |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| G13 real UE smoke result                     | Complete a fresh product-UI dry-run, execute, verify, rollback, replay, stop, and ownership lifecycle plus negative smokes.        | WAITING_ON_15A_15B | Current-source 15A remains open after the Resume 15 repair; its predecessor 15B failed and mutation count is zero.                                                                                                                                                                                                                                                                                                                                                                                        | Complete current-source 15A and 15B first, then use a fresh isolated UI run. |
| G14 documentation consistency                | Public current-state documents agree and preserve historical evidence.                                                             | IMPLEMENTED    | Final Pre-live Source Closure Rework 7 is historical; Rework 8 retains `Review Verdict: NEEDS_FIX`; Rework 9, Live Acceptance Resumes 9-14, and Resume 15 checkpoints through the tenth have `Review Verdict: PASS`; the exact-manifest TEMP cleanup gate is `PASS`. Historical mtime attribution remains unclaimed.                                                                 | Preserve this state in later tasks.                          |
| G15 checkpoint integrity                     | Supervisor records content checkpoint and SHA backfill closeout.                                                                   | COMPLETE       | Current implementation commit `8c78b172dd7ac03c7d38f0d28cc157611e4a63a7` is recorded by this documentation closeout. Historical commits `3331e220f53f528c7cc98e61efc927428d4eaeca`, `e50022ddecf0c6a19ceb4d78dc8eb54b5e118f0b`, `9fc667bceeaf81bcd087cec0f690c76bf067ad9f`, `39bccbc4a88d925bd3f44ad5c5a44add10a48b39`, `bb89126d82416f0958050405ff1ab693505614f7`, `e20a9921caf77d1ac05c95ff8811acef9c63938a`, `96e7183f9bb6644bf72191b68277b112c33ccc1d`, `6fb99447f3158c9f0326c93774fe03c5319762ff`, `f5b514c7ac78a47c233bfdbae9e3f2d70840a08f`, `9d04ef710eff5a8c2aebdf0c92076e8ee477c1f5`, `c60a094e0225d19e10238618abfeb73c299eacf0`, `38cec6f3e11af1e4b991430d3941e71c57d2c45d`, `f14dc69543a42d553542b73547c3598fb39947b6`, `4b6e2fa35ad999882dd3b50d697ab7cb80732300fa`, `51cdf22753ae2f9d90a0e3d5cb03df8495fa7e46`, `af483722d08212374f67bfc756fa34b79e195e8c`, `33743bb8327b7ca8bdf5aff6469db46503c01c67`, `8b2ba0bf83e70f6ecdddb12202b6cb80732300fa`, `7916cf74cb205049e1c8967b9217cb8b64df36ca`, `a780fc4231b99b39153fb88c9ab460717610b3f3`, `25d1262528e0976d24f96056975fdb36bc790b77`, `de248a7028d21c53c26db7b28930d583566580a6`, `aa14363f15d8bdc8eaf392c67cf444496cc8a968`, `98c8b387e1124a519977849d48ab824e4e6bb9c5`, and `b1c4e4a...` retain their separate scopes. | Push is tracked on the workflow status axis.                 |
| G16 authority provenance and plugin baseline | Native root/observation/gate provenance is proven and the exact companion build and six-tool contract are reproducibly identified. | PARTIAL        | Same-process launch ownership is separated from retained consistency and regression-covered; current clean installed/loaded/exact-six live evidence does not yet exist.                                                                                                                                                                                                                                                                                                                                    | Run the full read-only matrix from the new clean checkpoint. |

## Current UE 5.8.1 Rework and Final D13-D16 Posture

- Final Source/Tooling Rework 3 supervisor verdict: `NEEDS_FIX` (historical).
- Final Source/Tooling Rework 6 supervisor verdict: `NEEDS_FIX`; historical
  `PARTIAL`; no checkpoint was created.
- Final Source/Tooling Rework 7: `PARTIAL`; supervisor `NEEDS_FIX`; no
  checkpoint.
- Completed task:
  `TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-FINAL-SOURCE-TOOLING-REWORK-8-AUTHORITATIVE-LAUNCH-BOUNDARY-AND-REPORT-CLOSURE`;
  `COMPLETE`; supervisor `PASS`; implementation commit
  `98c8b387e1124a519977849d48ab824e4e6bb9c5`.
- G14: `IMPLEMENTED`; current source-checkpoint G15 integrity: `COMPLETE`;
  G16: `PARTIAL`.
- Desktop Tauri icon validation and MSI/NSIS bundling: `IMPLEMENTED`.
- UE 5.8.1 compatibility: `PARTIAL`; the Rework 2 attempt is historical and
  cannot satisfy the current clean-commit matrix.
- D13 / 15A: `DISPATCHED` from `8c78b172dd7ac03c7d38f0d28cc157611e4a63a7`.
- D14 / 15B: `WAITING_ON_15A`; D15 / 15C: `WAITING_ON_15A_15B`.
- D16: `IN_PROGRESS`.
- Overall final acceptance: `PARTIAL`; Ready: `NO`.
- The old `b1c4e4a...` / Rework 9 checkpoint is historical D0-D12 evidence,
  not current G15 completion.
- The unsafe predecessor evidence root is invalid and removed for
  `TOKEN_AND_RAW_PATH_EVIDENCE_INVALID`; no replacement live root was created.
- Real fresh release binary capability-only probes passed for native,
  normal-product renderer, and rendered UI with zero MCP/network/asset
  operations and clean process/event/nonce/driver closeout, while the Job
  runner published and the producer validated the early live process identity.
  They are not live compatibility evidence.
- The loaded-module ledger production path now requires one owned branded live
  authority, PID plus creation identity, independently derived facts, complete
  downstream cross-binding, ancestor-reparse rejection, and fail-closed cleanup.
- The source identity covers the transitive 336-file production boundary and
  complete 357-entry source/Git watch set.
- Clean manifest create/verify, exact-six live fingerprint, Tool Search off,
  product retractions, UI mutation, and replay were not run.
- Read-only retained historical Source Checkpoint Rework 7 D0/build/UE validators pass and preserve Direct,
  `48/48`, and zero historical residual. They are not final evidence.
- Recovery continues in the newly dispatched clean-checkout compatibility task
  based on current implementation commit
  `8c78b172dd7ac03c7d38f0d28cc157611e4a63a7`. Real mutation remains gated until
  15A and 15B pass inside the authorized task.
