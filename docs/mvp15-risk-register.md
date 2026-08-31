# MVP15 Native Authority Binding Rework Risk Register

## Current MVP15D Final Risk Posture — 2026-08-31

Final Live Acceptance Resume 15 is complete at implementation commit
`2293cdf063b9ed914d125792f2aa62a2546696c5`. All D13-D16 gates passed,
`PASS_REAL_SMOKE` and Stage Ready are `YES`, and there are no open blocking
MVP15D risks. Retained non-blocking observations are the existing Rust `ureq`
upgrade warning, fail-closed behavior if future callers overlap native MCP
requests across connection generations, and the need to rebuild the deliberately
deleted release executable before repeating post-cleanup aggregate tests.

## Historical Pre-closeout MVP15D UE 5.8.1 Compatibility Risks

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
implementation commit `de248a7028d21c53c26db7b28930d583566580a6`. Rendered N1-N8
now bind production registration, task-owned gate-off child and actual MCP
outcomes; fresh live evidence remains open.
Final Live Acceptance Resume 2 Rework 3 has `Review Verdict: PASS` at
implementation commit `25d1262528e0976d24f96056975fdb36bc790b77`. Truncated-secret,
punctuation-tail and bounded-scanner risks are mitigated in retained build
transcripts. Invalid Resume 2 cleanup is `SATISFIED` after an independent
2026-08-14 zero-residual scan.
Final Live Acceptance Resume 3 Rework 1 has `Review Verdict: PASS` at source
implementation commit `0b47dd41e92f941f87c45c5694ec75d2cc932771`.
It isolates the live UE bridge/launch gate, owns the exact
UE/MCP listener through a task/phase guardian, observes the same owner after
Disconnect, and requires a different PID/creation/listener identity plus fresh
MCP and manifest-backed attestation for UE restart. Controlled tests pass; no
current clean-checkout live acceptance or real UE compatibility claim is made.
Final Live Acceptance Resume 4 has `Review Verdict: PASS` for its source-only UE
5.8 BuildPlugin descriptor verifier repair at implementation commit
`a780fc4231b99b39153fb88c9ab460717610b3f3`. The verifier permits only the exact
official Installed/EngineVersion/default-field transformation and rejects all
other semantic drift. The pre-repair lineage was invalidated and removed.
Final Live Acceptance Resume 5 has `Review Verdict: PASS` for its source-only
official Automation-report UTF-8 BOM repair at historical implementation commit
`7916cf74cb205049e1c8967b9217cb8b64df36ca`. Resume 6 has `Review Verdict: PASS`
for exact-once creation-FILETIME provenance and required scanner closeout at
historical implementation commit `8b2ba0bf83e70f6ecdddb12202b6cb80732300fa`.
The pre-repair lineage was invalidated and removed.
Resume 7 has `Review Verdict: PASS` for the D16.5 source-only raw-report verifier
and two-inventory bridge at implementation commit
`33743bb8327b7ca8bdf5aff6469db46503c01c67`; no live gate advanced.
Resume 8 Rework 1 remains accepted at historical implementation commit
`af483722d08212374f67bfc756fa34b79e195e8c`. Resume 9 has `Review Verdict: PASS`
at historical implementation commit `51cdf22753ae2f9d90a0e3d5cb03df8495fa7e46`.
The managed UE guardian now includes `-NullRHI`; retained real diagnostics prove
bounded listener startup and read-only Automation, while the pre-repair 15A/15B
lineage remains partial and source-invalidated.
Resume 10 has `Review Verdict: PASS` at historical implementation commit
`4b6e2fa35ad999882dd3b50d697ab7cb36a1552e`. It closes the confirmed exact-
manifest cardinality defect by adding the sealed native-binding resource to the
UE companion allowlist and its test candidate. Its pre-repair clean lineage is
partial and source-invalidated; no patched live gate advanced.
Resume 11 has `Review Verdict: PASS` at historical implementation commit
`f14dc69543a42d553542b73547c3598fb39947b6`. It closes the confirmed manifest
self-hash defect by matching the Node producer's case-sensitive canonical key
ordering and making the production manifest a positive fixture. Its clean
pre-repair lineage is partial and source-invalidated; no patched live gate advanced.
Resume 12 has `Review Verdict: PASS` at historical implementation commit
`38cec6f3e11af1e4b991430d3941e71c57d2c45d`. It closes the confirmed rendered
capability divergence by creating the single fixed desktop adapter during app
bootstrap after dependency evaluation. Its pre-repair ExactSix/15A pass and 15B
failure are source-invalidated; no patched live gate advanced.
Resume 13 has `Review Verdict: PASS` at historical implementation commit
`c60a094e0225d19e10238618abfeb73c299eacf0`. Its clean predecessor passed
ExactSix and fixed 15A, then rendered 15B failed closed because the pre-index
process config requested missing fixture `Game.uproject`. The accepted repair
derives the actual descriptor from native validation; no patched live gate advanced.
Resume 14 has `Review Verdict: PASS` at historical implementation commit
`9d04ef710eff5a8c2aebdf0c92076e8ee477c1f5`. Its clean `c60a094e...` predecessor
passed ExactSix and fixed 15A, then rendered 15B exposed an opaque trusted-root
token at the direct managed-process boundary. Direct native editor create/attach
calls now resolve the trusted mapping locally while native canonical trust remains
authoritative; no patched live gate advanced.
Resume 15's first accepted interim source checkpoint is historical at
`f5b514c7ac78a47c233bfdbae9e3f2d70840a08f`. Its clean `9d04ef7...`
predecessor passed ExactSix and fixed 15A, then rendered 15B exposed legal
notification 202 empty-body handling and incomplete exact-six descriptor
contracts. Both source defects are repaired and verified. That checkpoint then
passed ExactSix and fixed 15A before rendered 15B exposed managed observation,
first-connect recovery and legal meta-tool identity defects. The second interim
source checkpoint `6fb99447f3158c9f0326c93774fe03c5319762ff` repairs all three.
Its clean lineage then exposed order-sensitive equality for renderer predecessor-
window records. Historical third checkpoint
`96e7183f9bb6644bf72191b68277b112c33ccc1d` compares exact keys and values
independently of member order. Its clean run exposed five live runtime defects;
checkpoint `e20a9921caf77d1ac05c95ff8811acef9c63938a` closes them. Fifth checkpoint
`bb89126d82416f0958050405ff1ab693505614f7` extends the bounded live-phase timeout
to 600 seconds. Its clean producer exposed retained process-identity key drift;
sixth checkpoint `39bccbc4a88d925bd3f44ad5c5a44add10a48b39` preserves validated
digest fields and binds raw values. That clean lineage passed release, ExactSix
and fixed 15A and completed the rendered 15B producer before the verifier exposed
a stale observation binding after retained session/PID conversion. Seventh
checkpoint `9fc667bceeaf81bcd087cec0f690c76bf067ad9f` recomputes the binding over
final retained authority material. Its clean rendered producer exposed a runner
lookup against filtered phase events. Historical eighth checkpoint
`e50022ddecf0c6a19ceb4d78dc8eb54b5e118f0b` recovers the fully cross-bound PID
identity from the canonical raw-runtime file. Its clean lineage exposed renderer
predecessor-generation drift during concurrent discovery. Historical ninth checkpoint
`3331e220f53f528c7cc98e61efc927428d4eaeca` captured a verified ready snapshot,
but its clean lineage proved that the snapshot still used a later mutable
observation. Current tenth checkpoint
`8c78b172dd7ac03c7d38f0d28cc157611e4a63a7` binds restart to the immutable native
connect-receipt generation. Eleventh checkpoint
`f50b8361fc0dd2fd1543cb7a30161c8d5d3ebe02` repairs the later same-session
`stale_completion` validation. Current twelfth checkpoint
`4f0247ab8ac67bc55d50d2ae89b92077199cab2e` repairs persisted authority
lifetime, N2 child WebView/path cleanup and the 15C companion contract. No
current-source live gate has advanced.
The separate Final Source/Tooling Rework 8 checkpoint dated 2026-08-03 remains a
historical `COMPLETE / PASS` record at implementation commit
`98c8b387e1124a519977849d48ab824e4e6bb9c5`. G14 is `IMPLEMENTED`; current
source-checkpoint G15 integrity is `COMPLETE`; G16 is `PARTIAL`. Real UE 5.8.1 compatibility and overall
acceptance remain `PARTIAL`; D13 / 15A is `DISPATCHED`; D14 / 15B waits on 15A
and D15 / 15C waits on 15A/15B; D16 is `IN_PROGRESS`; Ready is `NO`.
Historical pre-final `PASS_REAL_SMOKE` at this boundary was `NO`; the accepted
current-source result is `YES`.

Two D16 evidence-execution gates remain open for the dispatched clean run. The
final-runner root and UE581 retained bundle enforce different root names and
closures, so they must be separate products with deterministic hash cross-links.
The raw official Automation `index.json` is not a phase-summary `sourceArtifact`;
its exact bytes must be independently hashed against
`automation_report_binding.reportSha256` before privacy cleanup.
`mvp15d-final-live-verifier.mjs` now produces and revalidates both retained
records, rejects missing, unequal, ambiguous or cross-contract roots, and binds
the bridge records into both inventories. No fresh live record exists yet;
missing or hand-authored bridging evidence still blocks 15A/D16 acceptance.

Final Pre-live Source Closure Rework 1-6 are historical `PARTIAL / NEEDS_FIX`
submissions without checkpoints. The supervisor-reviewed Rework 9 implementation makes both actual `App`
registrations enter production `startMvp15dRuntimeBridge(invoke)`, retains the
exact injected predecessor, and moves same-label build to a bounded continuation
after authoritative `Destroyed`/manager removal. No bridge mutex spans the wait
or window APIs; atomic gates suppress timeout-late destroy/build. Replacement B
remains alive, no third window is built, and acknowledgement/claim/publish/
complete fail closed. The opaque private binding and public wire schemas remain
unchanged. N4, N5, second rollback, and observed MCP DELETE semantics remain
retained. The former release and all 15A-15C evidence are invalid. No live action
ran; the stale installed binary may fail only with `FINAL_LIVE_RUNTIME_NONZERO`.

| Risk                                                  | Risk disposition | Mitigation / evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------------------------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product-adapter D0 restart/stale authority            | MITIGATED        | Retained historical Source Checkpoint Rework 7 D0 `external/mvp15d-rework7-d0-20260726_190100` records four sessions, 129 indexed artifacts, zero mutation, reconstruction/startup/stale-retraction coverage, and Direct.                                                                                                                                                                                                                                                                                                     |
| Task-only observer grants forward native reachability | MITIGATED        | Historical Source Checkpoint Rework 7 preserves the public/native fail-closed source and retained D0 records mutation zero.                                                                                                                                                                                                                                                                                                                                                                                                   |
| Final wrapper command identity                        | MITIGATED        | Rework source invokes validated caller-supplied `RunUAT.bat` through the exact ordered `-Rocket` argument builder; plan/live fixtures fingerprint the actual launcher and arguments.                                                                                                                                                                                                                                                                                                                                          |
| Clean-checkout physical byte identity                 | MITIGATED        | Two path-specific LF attributes and a fresh no-hardlink `core.autocrlf=true` checkout test preserve 4,865 bytes / `771168ec...` with clean Git status.                                                                                                                                                                                                                                                                                                                                                                        |
| Build commit-memory capacity                          | MITIGATED        | Historical Rework 2 UE 5.8.1 RunUAT BuildPlugin completed 16/16 actions with exit 0; Rework 3 did not repeat the live build.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Final package provenance / loaded identity            | OPEN             | Resume 15 repeatedly passed clean ExactSix and fixed 15A before rendered 15B/15C exposed source defects. The authority, child-isolation and cross-layer contract defects are repaired through current checkpoint `4f0247ab...`; installed == loaded == fresh current-source manifest remains unproved after that source change.                                                        |
| Desktop bundle icon                                   | MITIGATED        | Tracked nonblank ICO has 16/24/32/48/64/128/256 entries; icon preflight and actual MSI/NSIS bundling pass.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Caller-authored final evidence                        | OPEN             | Rework 9 source tests run both actual App instances through the production orchestrator and reject legacy/missing/wrong/cross-window/task/phase/handoff identity, reordered/replayed receipts, fake/same successors, same-label replacement, and raw-summary drift. The native harness now returns restart before parent-ready; real Wry coverage supplies destroy/removal ordering. `Review Verdict: PASS`; implementation commit `aa14363f15d8bdc8eaf392c67cf444496cc8a968` exists, while fresh live evidence remains open. |
| Transitive source dependency drift                    | MITIGATED        | Source identity v2 hashes a deterministic 336-file production boundary discovered from 14 roots plus 28 exact files, with 9 exclusion classes and 357 source/Git watches. Representative native/renderer/CSS/package/config/lock/plugin/tooling changes, new production files, tracked deletion, worktrees, refs, and same-branch commits are regression-covered.                                                                                                                                                             |
| Ancestor junction/reparse escape                      | MITIGATED        | Every path component below the trusted installed root is checked before hashing. Real intermediate `Binaries` and `Win64` junction regressions fail closed.                                                                                                                                                                                                                                                                                                                                                                   |
| Windows fixture cleanup residue                       | CLOSED           | The exact 4,601-entry manifest SHA-256 is `45b870c32fbf48c20bf1545dbdaf7ac58c036c400b521677fccd22e4dae9d893`. Explicitly authorized cleanup passed full safety preflight, deleted 837 files, 4,717 internal directories and all 4,601 roots, and reported failures/residuals 0. Fresh asset `40/40` and bridge `14/14` regressions left zero matching roots. Earlier mtime-only drift remains historically unattributed.                                                                                                      |
| Invalid Resume 2 clone/evidence residue               | CLOSED           | The authorized cleanup removed the exact invalid clone/evidence root. Independent rescan found clone 0, evidence root 0, root candidates 0, task processes 0 and declared-port listeners 0.                                                                                                                                                                                                                                                                                                                                   |
| Cross-language accepted-plan binding                  | MITIGATED        | Canonical TypeScript/Rust checks pass 3/2; the retained source bundle is byte-equal at `93b3bb310ef17b18adb85b413360890648a9ab614301cedbf19ba81fb42146f6`.                                                                                                                                                                                                                                                                                                                                                                    |
| Physical directory ownership at creation              | MITIGATED        | Atomic create/identity race coverage is retained; UE completes `48/48` with unchanged Content.                                                                                                                                                                                                                                                                                                                                                                                                                                |
| UE adversarial/process closeout evidence              | MITIGATED        | Retained historical Source Checkpoint Rework 7 UE root `external/mvp15d-rework7-ue-20260726_190100` records five sessions, six processes each, residual zero, and capture `8794de55d0bc3444015116918b92e957070e684ac014f7f9551c07762af1cbb8`.                                                                                                                                                                                                                                                                                 |
| Evidence retention / review verifiability             | MITIGATED        | Durable D0/build/UE roots validate in place; build inventory self-hash is `096e92b42f28eda7c227efde9747c33dd7c3c2f8d1e08988af77588f09b83303`. `BLOCKED_BY_EVIDENCE_RETENTION` is closed.                                                                                                                                                                                                                                                                                                                                      |
| Workspace-test process stability                      | MITIGATED        | Historical supervisor attempt exited `134`; two consecutive historical Source Checkpoint Rework 7 full-workspace processes exit 0 with identical counts.                                                                                                                                                                                                                                                                                                                                                                      |
| Default Rust test isolation                           | MITIGATED        | Two consecutive fresh Cargo processes each pass 176 library tests, 2 native invoke bridge tests, and the real hidden Wry integration target.                                                                                                                                                                                                                                                                                                                                                                                  |
| Final-task runner and inventory coverage              | MITIGATED        | `mvp15d-final-runner.mjs` dispatches fixed UE Automation, normal-product, and rendered-UI adapters, binds native event transcripts, and verifies producer ledgers. The inventory is file/directory allowlisted, redacted, secret/path gated, and independently verified.                                                                                                                                                                                                                                                      |
| Production runtime bridge reachability                | OPEN             | Resume 8 exposed and closed exact Windows verbatim local-drive normalization at `af483722...`. Resume 9 then completed pre-repair Automation `3/3/0/0`, reached rendered `confirmTrust`, and exposed a managed guardian launch without `-NullRHI`; listener readiness failed within 120 seconds. The accepted `51cdf227...` source aligns that task-owned child with the headless launch contract, and retained real diagnostics prove listener startup plus `UAgentAssetTools.ReadOnly`. A rebuilt current-source 15A/15B remains required. |
| Live observation after process exit                   | MITIGATED        | The accepted source observes the exact PID/creation/listener owner after rendered Disconnect, keeps guardian ownership until root exit, and takes port closeout evidence only after the owned Job reaches zero. Guardian TCP/process/DDC tests and the real headless diagnostic pass; a fresh final UE phase remains required.                                                                                                                                                                                                 |
| Raw path / secret leakage in the loaded ledger        | MITIGATED        | The ledger binds every R5.2 identity fact, serializes only sorted approved relative module facts, and a raw absolute path anywhere in the ledger is rejected before any write.                                                                                                                                                                                                                                                                                                                                                |
| Full live runtime semantics                           | OPEN             | Resume 9 established official UE Automation `3 / 3 / 0 / 0`, unchanged Content, canonical package/install/load identity and zero mutation/residue on the pre-repair release. Product capture reached actual rendered `confirmTrust` and stopped before observation discovery because the guardian listener was not ready; discovery, exact-six, retractions and UI mutation remain open. The source repair invalidates that release for current acceptance.                                                    |
| Final live phase evidence and session orchestration   | OPEN             | Rework 1 and Resume 2 Rework 3 remain accepted checkpoints. Resume 3 Rework 1 source repair passed review at `0b47dd41e92f941f87c45c5694ec75d2cc932771`, closing the missing live UE gates, listener ownership and real process replacement defects. A complete fresh clean-checkout restart from 15A remains required.                                                                                                                                                                                                       |
| Unsafe predecessor compatibility evidence             | MITIGATED        | The predecessor root was invalidated and removed for `TOKEN_AND_RAW_PATH_EVIDENCE_INVALID`; no replacement live root was created.                                                                                                                                                                                                                                                                                                                                                                                             |
| UE 5.8.1 exact-six/product compatibility              | OPEN             | Source adapters are implemented, while the full clean-commit live matrix remains unrun. Historical Rework 2 partial observations cannot establish current compatibility.                                                                                                                                                                                                                                                                                                                                                      |
| Real product mutation or later-stage evidence         | DEFERRED         | Pre-repair 15A passed read-only with mutation count zero. 15B failed closed before observation discovery, 15C was not entered, and the guardian source repair invalidates the earlier live lineage.                                                                                                                                                                                                                                                                                                                            |

The historical Final Source/Tooling Rework 8 is checkpointed at implementation commit
`98c8b387e1124a519977849d48ab824e4e6bb9c5`. Cleanup is closed and live
acceptance is dispatched as a separate clean-checkout task based on current
implementation commit `4f0247ab8ac67bc55d50d2ae89b92077199cab2e`, with a manifest-backed
build and a new strict evidence root. Exact-sandbox 15C mutation remains gated
until fresh 15A and 15B pass inside that authorized task.

## Historical Rework 3 Source Checkpoint Risks — 2026-07-20

| Risk                                             | Historical risk disposition | Mitigation / evidence                                                                                                                                                           |
| ------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Companion manifest/source/module provenance      | OPEN                        | Source checks and native module enumeration exist, but no positive manifest-backed native attestation was exercised and no final clean package exists.                          |
| Live exact-six schema/identity drift             | OPEN                        | Four UE Commandlet probe markers exist, but no real UAgent product-adapter descriptors or selected production route exist; ExactSix passes zero tools without a manifest.       |
| Generic wrapper or unattested exact-name mapping | OPEN                        | Narrow probe code exists, but the real product discovery/descriptor/route matrix has not run.                                                                                   |
| Inverse rollback contract mismatch               | OPEN                        | Forward/inverse dispatch improved, but the actual ledger lacks complete session/native-plan bindings and the required UE adversarial matrix did not execute.                    |
| Ownership / partial-effect loss                  | OPEN                        | C++ and TypeScript ledgers lack the full D8 field set; the TypeScript helper is not integrated; partial/unknown outcomes can be recorded as no-effect or left without recovery. |
| Non-sandbox / Save All / bulk writes             | OPEN                        | Cleanup is non-recursive, but physical identity/replacement adversarial proof is absent. No real product mutation occurred.                                                     |
| Stale identity / replay / privacy                | OPEN                        | Local fingerprint clearing precedes notification, but native approval revocation is fire-and-forget and can race an immediate listener-triggered guard.                         |

The historical supervisor verdict for Rework 3 was `NEEDS_FIX`. These historical
findings informed later Rework 4-6 work; they do not describe the validated
historical Source Checkpoint Rework 7 evidence or current Source/Tooling Rework 1.

## Historical Native-authority Risk Baseline

The following C11-C14A rows preserve prior implementation evidence and risk
analysis. Their historical `MITIGATED` labels do not override the current
MVP15D source-checkpoint risks above or supply current D0-D12 evidence.

| Risk                                                       | Impact                                                                                                                                                                         | Historical risk disposition | Required control                                                                                                                                                                                                                                    | Current evidence / open item                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forged or caller-derived trusted root                      | Mutation registers against an existing but untrusted project                                                                                                                   | OPEN                        | Resolve native trusted-root registry identity and revalidate canonical containment/revocation                                                                                                                                                       | Fresh native adversarial tests pass; fresh real evidence remains required.                                                                                                                                                                                                                                                                                                      |
| Forged/stale observation or process binding                | Mutation continues after session stop, expiry, PID mismatch, project switch, or process exit                                                                                   | OPEN                        | Resolve native observation/process registry and perform live lifecycle recheck before every MCP mutation call                                                                                                                                       | Native 14/14 covers the authority and lifecycle boundary; negative product smoke remains required.                                                                                                                                                                                                                                                                              |
| Observation stop/renew lost update                         | A successful lifecycle check revives a concurrently stopped session or renews the session after process removal/replacement                                                    | MITIGATED                   | 11A uses one fixed-lock-order CAS commit over complete session/process snapshots; stopped is sticky and both leases receive one shared deadline or neither changes                                                                                  | Deterministic stop, remove, identity-replacement, and success interleavings pass without wall-clock sleeps. Fresh product evidence remains required.                                                                                                                                                                                                                            |
| Caller-controlled asset-mutation gate                      | Renderer/UI enables native write capability                                                                                                                                    | OPEN                        | Strict default-off `UAGENT_ENABLE_ASSET_MUTATION=1`; caller state may only tighten                                                                                                                                                                  | Gate-OFF automated tests pass; product evidence is not recorded.                                                                                                                                                                                                                                                                                                                |
| Unbounded stale transaction/recovery                       | Old registration retains forward or rollback authority indefinitely                                                                                                            | OPEN                        | 60-second first-execute token, absolute 15-minute forward cap, absolute 20-minute recovery cap                                                                                                                                                      | Deterministic 60-second/15-minute/20-minute tests pass; cross-TTL fresh smoke remains required.                                                                                                                                                                                                                                                                                 |
| Unidentified plugin build or schema drift                  | Real execution uses an unreproducible or changed contract                                                                                                                      | OPEN                        | Record an authoritative official source/artifact mapping for the identified descriptor/module bytes plus the canonical product-adapter six-tool contract fingerprint                                                                                | C14A hardens the fail-closed fingerprint. The historical C14 initialization encountered a pre-discovery transport/environment failure and yielded no schema decision. Separately, the active modules are unsigned and do not hash-match a validly Epic-signed sibling set; no authoritative manifest/source/build mapping exists (`BLOCKED_BY_MCP_SCHEMA`).                     |
| Pre-trust root mapping                                     | Mutation bridge resolves an add/validate root before user trust confirmation                                                                                                   | OPEN                        | Publish mutation-resolvable mapping only after successful `confirmTrust`                                                                                                                                                                            | A20 desktop tests and the structural scan pass; fresh negative UI smoke remains required.                                                                                                                                                                                                                                                                                       |
| MCP binding changes after registration                     | A native-accepted guard could be redirected or leave `in_flight` stranded, permanently blocking recovery                                                                       | MITIGATED                   | Recheck the desktop-owned binding after native guard; record exactly one no-side-effect failure before returning; retain prior ownership and permit only inverse recovery. Token-bound cancel retires unpublished, unstarted registrations          | Runtime 789 proves MCP zero, outcome exact one, in-flight cleared, failed-step ownership zero, prior ownership recoverable, binding-drift cancel exact one, and stale-run cleanup. Fresh product evidence remains required.                                                                                                                                                     |
| Stale facade/fingerprint publication                       | An observer sees an old accepted SHA/binding during reconnect, or an old connection/discovery completion overwrites a disconnect, endpoint change, reconnect, or newer attempt | MITIGATED                   | At new connection generation, retract discovery, facade inventory, binding, hash, and canonical byte length before endpoint validation or any status notification; publish only after all awaits match one session object, endpoint, and generation | C14A synchronous observers see null authority on the first reconnect success/error notification and invalid-endpoint notification. The eight stale discovery success/error cases plus the connection-generation guard pass.                                                                                                                                                     |
| Blocked fingerprint leaks discovery-controlled strings     | Unexpected/duplicate names carry paths, endpoints, PIDs, tokens, or credentials into public state                                                                              | MITIGATED                   | Public issues expose only allowlisted duplicate names, stable flags, and counts; raw unexpected/duplicate names never enter the result; malformed runtime input fails closed                                                                        | C14A serializes URL, Windows-path, `token=`, and `Bearer` canaries through unit and desktop publication tests and proves none appear. Non-string, primitive, throwing/proxy-like, revoked-proxy, cyclic, and non-JSON inputs accept no SHA and throw no uncontrolled error.                                                                                                     |
| Evidence after trust/root/path change                      | Evidence reads outside the registration-owned authority                                                                                                                        | OPEN                        | Revalidate root registry, canonical Content containment, and bound paths on every active evidence request                                                                                                                                           | Revocation/path/terminal-evidence automated regressions pass; real evidence remains required.                                                                                                                                                                                                                                                                                   |
| Platform identity precision                                | A same-path replacement or PID reuse may be mistaken for the task-owned object/process if ownership is derived from path, basename, or coarse timestamps                       | MITIGATED                   | Acquire the Windows directory handle and file identity atomically with creation, retain handle-targeted empty-leaf cleanup, and bind UE descendants to per-session task markers and creation/parent identity                                        | Rework 7 retains create-window race coverage; five UE ledgers record six processes each and residual zero.                                                                                                                                                                                                                                                                      |
| Non-sandbox asset write                                    | User project assets are corrupted                                                                                                                                              | MITIGATED                   | Exact run-root path policy, native authority, and exact allowlist fail closed                                                                                                                                                                       | Fresh 11A automated regression passes; product-UI real smoke remains pending.                                                                                                                                                                                                                                                                                                   |
| Save All or broad package save                             | Unrelated packages are written                                                                                                                                                 | MITIGATED                   | Block Save All, arbitrary SavePackage, and broad/bulk operations                                                                                                                                                                                    | Fresh side-effect scan passes; product-UI smoke remains pending.                                                                                                                                                                                                                                                                                                                |
| Unknown or malformed plugin result treated as success      | Ownership is fabricated or rollback becomes unsafe                                                                                                                             | MITIGATED                   | Strict state contract and explicit side-effect evidence                                                                                                                                                                                             | Automated strict-result coverage passes; identified-build product execution remains pending.                                                                                                                                                                                                                                                                                    |
| Replay re-execution                                        | Mutation repeats without consent                                                                                                                                               | MITIGATED                   | Recorded-only replay and terminal authority removal                                                                                                                                                                                                 | Historical replay delta is `0/0/0/0/0`; a fresh product delta remains pending.                                                                                                                                                                                                                                                                                                  |
| Task-owned UE writes outside declared cache/evidence roots | A readiness-only launch changes copied business trees and invalidates containment                                                                                              | MITIGATED                   | Freeze the 163-file business aggregate, govern only 28 exact source-mapped `cpython-311` cache paths, reject every unknown ABI/path/source/link/reparse or unclassified file, and require truthful machine-readable header results                  | C13E preserved exact `191 = 163 + 28` through one launch. Supervisor-accepted C13E1 makes native inspection errors fail closed, makes every failed header branch report `valid: false`, passes 23/23 targeted tests, and reproduces the retained inventory read-only with zero cache size/SHA/mtime change. Fresh product evidence remains required; this risk is not `CLOSED`. |
| Failed recovery leaves residue                             | Sandbox assets remain after a partial failure                                                                                                                                  | OPEN                        | Only bounded same-registration recovery rollback; no broad/manual cleanup                                                                                                                                                                           | Real failure residue must stop the run and be reported honestly.                                                                                                                                                                                                                                                                                                                |

## Historical Pre-closeout Conclusion

D13 / 15A is `DISPATCHED` from `4f0247ab8ac67bc55d50d2ae89b92077199cab2e`. Final Pre-live Source Closure Rework 7 is historical
`PARTIAL / NEEDS_FIX` with no checkpoint; Rework 8 retains
`Review Verdict: NEEDS_FIX` for deterministic Tauri destroy/build ordering.
Rework 9 is the historical accepted base at
`aa14363f15d8bdc8eaf392c67cf444496cc8a968`. Final Live Acceptance Resume
Rework 1 has `Review Verdict: PASS`, fresh focused/full verification and a
production-built N2 child smoke at implementation commit
`de248a7028d21c53c26db7b28930d583566580a6`. Current Resume 2 Rework 3 privacy
repair has `Review Verdict: PASS` at implementation commit
`25d1262528e0976d24f96056975fdb36bc790b77`; Resume 3 Rework 1 remains accepted
at `0b47dd41e92f941f87c45c5694ec75d2cc932771`, Resume 4 descriptor verification
is accepted at `a780fc4231b99b39153fb88c9ab460717610b3f3`, Resume 5
Automation-report BOM handling is accepted at
`7916cf74cb205049e1c8967b9217cb8b64df36ca`, and Resume 6 provenance
handling is accepted at `8b2ba0bf83e70f6ecdddb12202b6cb80732300fa`. The resumed
scan's historical mtime drift actor remains unconfirmed; authorized exact-manifest
cleanup removed all 4,601 roots with zero residual and closed that external gate.
Resume 7's verifier and inventory bridge are accepted at historical implementation
commit `33743bb8327b7ca8bdf5aff6469db46503c01c67`.
The separate
2026-08-03 Final Source/Tooling Rework 8
is a historical `COMPLETE / PASS` checkpoint. G14 is `IMPLEMENTED`, current
source-checkpoint G15 integrity is `COMPLETE`, and G16 is `PARTIAL`. The historical D0-D12
checkpoint and historical Source Checkpoint Rework 7 evidence remain valid prerequisites, while no clean
current live exact-six fingerprint exists. D14 / 15B waits on 15A, D15 / 15C
waits on 15A/15B, D16 is `IN_PROGRESS`, real UE 5.8.1 compatibility and overall
acceptance remain `PARTIAL`, and Ready remains `NO`.
