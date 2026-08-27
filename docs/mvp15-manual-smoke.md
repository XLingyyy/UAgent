# MVP15 Native Authority Binding Rework Manual Smoke

## Current MVP15D UE 5.8.1 Rework Manual-smoke Boundary

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
Visible settings controls now drive N1-N8 through the production adapter. N1
and the task-owned N2 gate-off child use real registration attempts, while N7
and N8 use actual MCP execute/rollback requests and outcomes. These facts do not
advance the clean-checkout 15A-15C live gates.
Final Live Acceptance Resume 2 Rework 3 has `Review Verdict: PASS` at
implementation commit `25d1262528e0976d24f96056975fdb36bc790b77`. Its source-only
retained-transcript privacy repair is accepted; invalid Resume 2 cleanup is
`SATISFIED` after an independent 2026-08-14 zero-residual scan. Cleanup alone
did not advance a live/manual-smoke gate.
Final Live Acceptance Resume 3 Rework 1 has `Review Verdict: PASS` at
`0b47dd41e92f941f87c45c5694ec75d2cc932771`. Resume 4's source-only UE 5.8
BuildPlugin descriptor verifier repair has `Review Verdict: PASS` at
`a780fc4231b99b39153fb88c9ab460717610b3f3`. Resume 5's source-only official
Automation-report BOM repair has `Review Verdict: PASS` at historical
implementation commit `7916cf74cb205049e1c8967b9217cb8b64df36ca`.
Resume 6's exact-once creation-FILETIME provenance repair has `Review Verdict:
PASS` at historical implementation commit
`8b2ba0bf83e70f6ecdddb12202b6cb80732300fa`. The old live lineage was invalidated
and removed; no manual-smoke gate advanced.
Resume 7 has `Review Verdict: PASS` for its D16.5 source-only raw-report verifier
and sealed two-inventory bridge at implementation commit
`33743bb8327b7ca8bdf5aff6469db46503c01c67`; it did not run manual smoke.
Resume 8 Rework 1 remains accepted at historical implementation commit
`af483722d08212374f67bfc756fa34b79e195e8c`. Resume 9 has `Review Verdict: PASS`
at historical implementation commit `51cdf22753ae2f9d90a0e3d5cb03df8495fa7e46`.
It adds the headless `-NullRHI` switch to the task-owned managed UE guardian.
The pre-repair 15A result and 15B failure are partial evidence and do not satisfy
current-source manual smoke.
Resume 10 has `Review Verdict: PASS` at historical implementation commit
`4b6e2fa35ad999882dd3b50d697ab7cb36a1552e`. Its clean pre-repair run passed the
fixed Automation matrix and reached rendered `confirmTrust`, then exposed the
missing native-binding entry in the exact six-artifact companion allowlist. The
repair compiled. Resume 11 has `Review Verdict: PASS` at historical implementation
commit `f14dc69543a42d553542b73547c3598fb39947b6`; its clean predecessor build exposed
the C++/Node canonical key-order mismatch at the separate exact-six gate. The
case-sensitive C++ repair compiled. Resume 12 has `Review Verdict: PASS` at historical
implementation commit `38cec6f3e11af1e4b991430d3941e71c57d2c45d`; its predecessor
source passed ExactSix and fixed 15A, then rendered 15B exposed a fixed adapter
that had captured native-null before the Tauri bridge became available. The
bootstrap repair passes source verification. Resume 13 has `Review Verdict:
PASS` at historical implementation commit
`c60a094e0225d19e10238618abfeb73c299eacf0`; its clean predecessor source again
passed ExactSix and fixed 15A, then rendered 15B exposed missing
`Game.uproject` before guardian spawn. The accepted pre-index descriptor repair
uses the native-validated `FinalHost.uproject`; current-source manual smoke still
requires a complete restart.
Resume 14 has `Review Verdict: PASS` at historical implementation commit
`9d04ef710eff5a8c2aebdf0c92076e8ee477c1f5`; its clean `c60a094e...` source
passed ExactSix and fixed 15A, then rendered 15B exposed an opaque trusted-root
token at a direct native managed-process boundary. The boundary-local resolver
repair passes source verification, while every retained live artifact predates
the repair and manual smoke still requires a complete restart.
Resume 15's first accepted interim source checkpoint is historical at
`f5b514c7ac78a47c233bfdbae9e3f2d70840a08f`; its clean `9d04ef7...` source
passed ExactSix and fixed 15A, then rendered 15B exposed legal notification 202
empty-body handling and incomplete exact-six descriptor contracts. Both source
repairs pass automated verification. That checkpoint then passed ExactSix and
fixed 15A before rendered 15B exposed managed-provenance, first-connect recovery,
and legal meta-tool identity defects. The second interim checkpoint is historical
at `6fb99447f3158c9f0326c93774fe03c5319762ff`; its three source repairs pass
automated verification. Its clean lineage then exposed order-sensitive equality
for renderer predecessor-window records. Historical third checkpoint
`96e7183f9bb6644bf72191b68277b112c33ccc1d` makes exact key/value comparison
order independent. Its clean run exposed five further live runtime defects;
checkpoint `e20a9921caf77d1ac05c95ff8811acef9c63938a` closes them. Fifth checkpoint
`bb89126d82416f0958050405ff1ab693505614f7` adds a bounded 600-second live-phase
budget. Its clean rendered producer exposed retained process-identity key drift;
sixth checkpoint `39bccbc4a88d925bd3f44ad5c5a44add10a48b39` preserves validated
hashes while binding raw values. That clean lineage passed release, ExactSix and
fixed 15A and completed the rendered 15B producer before the verifier exposed a
stale observation binding after retained session/PID conversion. Seventh
checkpoint `9fc667bceeaf81bcd087cec0f690c76bf067ad9f` recomputes the binding over
final retained authority material. Its clean rendered producer exposed a runner
lookup against filtered phase events. Historical eighth checkpoint
`e50022ddecf0c6a19ceb4d78dc8eb54b5e118f0b` recovers the PID binding from the
descriptor-bound canonical raw-runtime file. Its clean lineage exposed renderer
predecessor-generation drift during concurrent discovery. Historical ninth
checkpoint `3331e220f53f528c7cc98e61efc927428d4eaeca` captured a verified ready
snapshot, but its clean lineage proved that the snapshot still used a later
mutable observation. Current tenth checkpoint
`17c20bb72d9e1a4609ce5be6b3ff7cd8fbf4d800` binds restart to the immutable native
connect-receipt generation. Current-source manual smoke still requires a complete restart.
The separate Final Source/Tooling Rework 8 checkpoint dated 2026-08-03 remains a
historical `COMPLETE / PASS` record at implementation commit
`98c8b387e1124a519977849d48ab824e4e6bb9c5`. G14 is `IMPLEMENTED`; current
source-checkpoint G15 integrity is `COMPLETE`; G16 is `PARTIAL`. D13 / 15A
is `DISPATCHED`; D14 / 15B waits on 15A and
D15 / 15C waits on 15A/15B; D16 is `IN_PROGRESS`; real UE 5.8.1 compatibility
and overall acceptance remain `PARTIAL`; Ready is `NO`.
Current `PASS_REAL_SMOKE` is `NO`.

Final Pre-live Source Closure Rework 1-6 are historical `PARTIAL / NEEDS_FIX`
submissions without checkpoints. Rework 9 controlled tests run actual
predecessor and successor `App` registrations through production
`startMvp15dRuntimeBridge(invoke)` and prove asynchronous parent-ready semantics.
The parent registers exact one-shot completion before captured destroy; a
bounded off-main wait holds no bridge mutex and only then queues the revalidated
same-label successor continuation. Replacement B remains alive, no third window
is built, and acknowledgement/claim/publish/complete stay closed. Hidden real
Webview/Wry coverage reproduces the old `WebviewLabelAlreadyExists("main")`, then
proves manager removal/build count 0, a different-HWND successor, and B
preservation. A future authorized live procedure must repeat those facts and
retain newer MCP identity, N4/N5, second rollback, actual DELETE receipt, private
owned-launch, and Job/port closeout. Record local close separately. The mutation
gate remains default-off.

The pre-live TEMP residue gate is `PASS`. The exact cleanup manifest is 4,601
directories (4,591 asset, 10 bridge), SHA-256
`45b870c32fbf48c20bf1545dbdaf7ac58c036c400b521677fccd22e4dae9d893`.
Explicit authorization and complete safety preflight preceded deletion of 837
files, 4,717 internal directories and all 4,601 roots. Failures/residuals were
zero. Fresh asset `40/40` and bridge `14/14` tests passed and left zero matching
roots. Earlier mtime-only drift remains historically unattributed.

Controlled source and built-child checks do not constitute the current
clean-checkout live acceptance root. No current Tool Search,
installed/load/manifest tuple, live fingerprint, full 15A N1-N8 sequence,
partial/unknown sequence, parent closeout, or manual/live smoke is accepted for
Resume 15. The pre-repair release and all old 15A-15C evidence are stale; the
dispatched dedicated task must rebuild and pass 15A/15B before authorized 15C.

Historical Final Source/Tooling Rework 4 connected the fixed adapters to the
actual release Tauri binary and
rendered product/UI code through native-generated runtime events. Final
Source/Tooling Rework 8 preserves the Rework 7 transitive source coverage and
publisher controls while correcting launch authority:
the sole branded publisher re-observes PID and creation identity, derives every
source/project/manifest/package/install/process/producer/Job fact, and publishes
the exact approved modules through one exclusive atomic writer. The final
verifier rehashes and cross-binds the ledger and bound artifacts. Ancestor
junction/reparse and residue conditions fail closed. The executed
capability-only handshakes prove renderer readiness,
driver binding, process ownership, early identity validation, and clean
closeout while recording zero MCP calls, zero network calls, and zero asset
operations. Persisted cross-binding proves retained consistency only and returns
`productionLaunchAuthorityVerified: false`; only the same parent process that
uses the fixed non-injected launcher and consumes its private receipt may return
owned-launch authority. They do not authorize or execute the full procedure. Live
exact-six registration, dry-run, execute, verify, rollback, replay, and
mutation counts remain zero. Fixture validation enforces the later exact
rendered path `validate -> add -> confirmTrust`, five forward operations, four
inverse operations, zero verify mutation, and replay delta `0 / 0 / 0 / 0 /
0`. Fixture results never claim live origin. Historical Source Checkpoint Rework 7 remains
read-only supporting evidence.

The unsafe predecessor evidence root was invalidated and removed for
`TOKEN_AND_RAW_PATH_EVIDENCE_INVALID`. Full read-only compatibility is assigned
to the newly dispatched clean-checkout task based on current implementation
commit `17c20bb72d9e1a4609ce5be6b3ff7cd8fbf4d800`. Real UE, Tool Search,
and mutation were `SKIPPED_BY_TASK_BOUNDARY` in the source-repair task. The
dispatched live task may enter exact-sandbox 15C mutation only after fresh 15A
and 15B pass.

## Historical Rework 3 Supervisor Boundary - NEEDS_FIX

Rework 3 has four task-owned UE Commandlet probe markers with zero reported
mutation and four UE Automation tests. They are not UAgent product-adapter D0 and
do not authorize this manual product-UI procedure. Ownership, partial-effect,
native revocation, positive loaded-module, and Automation gates remain open.
Rework 4 must pass before a supervisor source checkpoint; D13/15A/15B/15C and
real product mutation remain prohibited.

## Historical Rework 2 Review Note - 2026-07-20

The repeatable procedure targets the independent `UAgentAssetTools` companion
and its exact-six identity/fingerprint. The first source checkpoint, Rework 1,
and Rework 2 failed supervisor review and did not run this procedure. UE 5.8 tooling and the
retained task-owned project are present outside PATH, so D0 is `IN_PROGRESS`,
not `BLOCKED_BY_ENVIRONMENT`; 15A/15B/15C remain blocked on a later accepted
source checkpoint. Rework 2 preserves native `blocked` status but can leave a
previously accepted companion fingerprint published. No positive or negative real mutation ledger is claimed;
real mutation remains forbidden until D0 and the corrected rollback contract pass.

At Rework 2, this was the repeatable product-UI procedure rather than a claim that
the then-current run passed; its acceptance record was `BLOCKED`. The remaining
paragraph preserves that historical evidence context. Rework 3 source controls do
not authorize the product-UI procedure: a clean checkpoint and independently
trusted D0 evidence are still required. C13-C13E established a retained task copy
and task-owned launch/readiness facts; supervisor-accepted C13E1 repaired the
dual-aggregate validator. C14 then implemented the redacted deterministic
product-adapter fingerprint and performed a narrower read-only attempt. Route A
remained exact, but the single initialization request encountered a pre-discovery
transport/environment failure, so it supplied no schema decision or live hash and
every asset/lifecycle action count was zero. C14A only hardens automated reconnect
retraction and blocked-result redaction; it did not launch UE/UAgent, connect live
MCP, or perform mutation. Official active-byte mapping remains
`BLOCKED_BY_MCP_SCHEMA`, while successful product-adapter contract capture and the
R10 product lifecycle remain independently open; the 09Z `PASS_REAL_SMOKE` ledger
is historical only.

## Historical C14 Read-only Discovery Boundary

C14 is not the happy-path mutation lifecycle below. Its authorized boundary was product Connect/Discover plus discovery-only `list_toolsets` and `describe_toolset`. Generic `call_tool` asset dispatch, registration, approval token, dry-run, execute, verify, rollback, replay, mutation, Content input, Save All, and Blueprint compile were prohibited. The actual attempt stopped at initialization and recorded all later counts as zero. A blocked or unavailable live fingerprint must remain blocked; never replace it with fixture or hand-assembled descriptors.

## Historical C14A Automated Hardening Boundary

C14A is getter/adapter hardening, not another live attempt and not the R10 mutation lifecycle. Its automated tests require the first synchronous reconnect success/error notification and invalid-endpoint notification to expose null SHA, byte length, binding, discovery, and facade/tool inventory. Blocked publication may expose allowlisted duplicate names and stable counts only; URL, Windows-path, `token=`, `Bearer`, primitive, non-string, throwing/proxy-like, cyclic, and non-JSON adversarial inputs must never produce an accepted SHA or serialized canary. That historical task ended at the desktop adapter getter and did not define the current MVP15D UI surface; the current working-tree UI changes are recorded below.

## Current MVP15D UI and Runner Checks

- Each formal live phase uses a dedicated repository-owned adapter, fixed
  executable, validated ordered arguments, a native-generated runtime event
  transcript, redacted UE/product events, and a domain-separated
  process/session/generation-bound producer ledger. Arbitrary input, fixture
  origin, caller-authored success, drift, missing terminal events, and closeout
  residue cannot claim owned launch authority. Exported and CLI verification of
  retained files returns only `*_persisted_consistency_verified` and
  `productionLaunchAuthorityVerified: false`.
- Production loaded-module publication additionally requires the in-process
  publisher brand and explicit PID/creation equality. That brand is not
  serialized. Pure builders and injected observation remain fixture-marked;
  structural manifest verification cannot establish launch ownership. The
  private single-use launch receipt exists only in `executeLivePhase()` and no
  public hash, nonce, PID, JSON object, or caller argument can recreate it.
- The source checkpoint must identify the complete transitive production
  boundary and Git watch set. The current identity covers 336 production files
  and 357 watch entries; a new production file or tracked production deletion
  must change the identity.
- Before any module hash, reject a leaf link or a symlink/junction/reparse
  ancestor below the installed root. After each Windows fixture, require its
  exact base directory and marker process count to be zero.
- `AssetMutationPanel` visibly reports Companion status, contract, manifest hash
  prefix, live fingerprint prefix, generation, blocker, and exact-six
  attestation readiness. `ConfigSettings` visibly reports the Companion plugin
  status, plugin/contract, manifest/live-fingerprint prefixes, and
  generation/tool summary. Their changed assertions must remain in the UI test
  ledger.
- Release capability validation binds the real `uagent.exe`, native bridge
  version, renderer readiness, source/task identity, nonce and event hashes,
  Windows Job closeout, and zero side effects. It is not a substitute for this
  later live product-UI smoke.
- The current working-tree TitleBar pre-live source closure uses the capability
  label `MVP15 Sandbox`. It removes transient Rework/Checkpoint/Partial copy and
  does not claim final acceptance. The five coupled TitleBar files were already
  dirty before this task; this task preserves their window-control intent and
  updates only the stage-label assertions needed by D16.
- Each of the five historical Source Checkpoint Rework 7 UE Automation sessions has a unique task marker
  and a complete marker-bound descendant creation/parent/first-observation/exit
  ledger with final residual count zero. A basename-only or final point-in-time
  process scan does not satisfy this check. The retained ledgers record six
  processes per session and final residual zero.

## Preconditions

- Use a disposable, recoverable, or version-controlled UE project. Do not use an irreplaceable project.
- Record redacted Content aggregate, source size/SHA-256, outside-run aggregate, exact run-root absence, and fixed container state.
- Record ownership for UAgent, UE, MCP/listener processes, and relevant local ports without publishing raw paths, PIDs, tokens, endpoints containing credentials, or secrets.
- For a task-owned readiness launch, use only a verified retained/disposable copy and a writable cache inside that copy. Pass both `-ddc=NoZenLocalFallback` and `-LocalDataCachePath=<task-ddc>`, and set `UE-LocalDataCachePath` only for the task UE child. Do not change permanent environment variables or control shared Zen. `PYTHONDONTWRITEBYTECODE=1` is not a pass condition: C13D proved that the embedded runtime ignores it for this cache surface.
- Before launch and after task UE exit, run `node scripts/mvp15-python-cache-surface.mjs --plugins-root <absolute-task-copy-Plugins> --contract scripts/mvp15-python-cache-contract.json --cache-state generated --json`. Require both the exact 163-file business aggregate and the exact 28-file cache aggregate, with zero unclassified entries, link/reparse entries, missing pairs, or header/type violations. This Route A contract accepts only the listed cache paths; it does not authorize arbitrary `.pyc`, arbitrary `__pycache__`, or other Plugins writes.
- Keep readiness observation separate from product smoke: poll lightweight process/module/port/log/immutable-state and contracted cache facts every five seconds; do not run full DDC/business workers while UE is live. On first-ready or failure, immediately close the positively identified task UE, then run full DDC/business aggregates after exit. Fail closed on any business-tree or cache-contract delta and retain unknown/new residue. Do not Connect, Discover, call MCP/native routes, or mutate assets during this readiness-only phase.
- Start a task-owned UAgent process with `UAGENT_ENABLE_ASSET_MUTATION=1`; keep the product UI sandbox gate enabled as an additional restriction.
- Through the product UI, perform `validate -> add -> confirmTrust`; never inject a raw mapping or call the native trust command directly.
- Attach the real UE observation through the product UI and confirm heartbeat ready and process alive.
- Discover exactly, in canonical order: `ue.asset.create_folder`, `ue.asset.duplicate`, `ue.asset.rename`, `ue.asset.move`, `ue.asset.delete`, `ue.asset.save`.
- Verify every tool supplies `inputSchema`, `dryRunSchema`, `rollbackContract`, `affectedAssetsSchema`, and `evidenceQuery`, and record the canonical live fingerprint and plugin build identity described in [the plugin baseline](mvp15-ue-mcp-plugin-baseline.md).
- Complete all required automated verification, including Rust formatting and the five authority scans, before any real mutation.

## Fresh Happy-path Lifecycle

1. Open `Settings -> Config -> MCP read-only runtime`. In `Endpoint`, enter the configured local address (for example `http://127.0.0.1:8000/mcp`); only `localhost` / `127.0.0.1` / `::1` is allowed. Click `Connect`, confirm the status is `connected`, then click `Discover`. Record the discovery counts and confirm the exact six-tool inventory and contract fingerprint in `Tools -> MCP` before opening `Tools -> Assets` for the asset mutation workflow.
2. Choose a fresh run id and record redacted authoritative root/observation/process provenance.
3. Run dry-run once from the product UI. Require five exact dry-run results and `external_bound`; Content digest must not change.
4. Click Approve once. Continue only after one native registration returns one opaque token.
5. Click Execute once. Require five native guard/call/result triplets in order: create run root, duplicate, rename, move, save one asset. Each guard must complete a live authority recheck before its MCP call.
6. Verify source size/SHA-256 unchanged, final target present, old paths absent, and outside-run aggregate unchanged.
7. Wait 65-90 seconds after the original registration while maintaining a genuinely live heartbeat. Do not refresh, obtain another token, or create another registration.
8. Click Rollback once. Require four guard/call/result triplets in strict inverse order: move back, rename back, delete duplicate, remove the exact run root.
9. Final verify: source unchanged; exact run root absent; fixed container absent or ordinary/non-reparse/strictly empty; outside-run aggregate unchanged.
10. Open recorded replay inspection and prove native/MCP/provider/verification/rollback deltas are `0/0/0/0/0`.
11. Stop observation through the UI and prove UE remains running.
12. Close only task-owned UAgent/listener processes and prove pre-existing UE/MCP ownership is unchanged.

Before the mutation lifecycle, exercise the six independent product authority
retractions in order: RefreshTools, MCP reconnect, invalid/change endpoint,
renderer restart, task-owned UE restart, and stale concurrent completion. Each
event must retract the old discovery/fingerprint before publishing a newer
generation and must retain an action receipt without raw process, endpoint, or
session identity.

## Required Negative Ledgers

Each negative case uses an independent rendered control and observation/run/registration identity and must prove before/after Content digest equality. N1/N2 are pre-registration failures and therefore require registration, token, MCP mutation, and manifest ownership counts of zero. N3-N8 first complete five real plugin dry-runs for their independent run before native registration. N3-N6 own one bounded registration/token/manifest and perform no MCP mutation. N7/N8 must prove the real MCP execute/rollback side effects used to establish replay semantics, followed by bounded cleanup and a restored Content digest; their counters must match the observed calls.

The rendered partial/unknown matrix is diagnostic-only. It cannot supply or replace any formal N1-N8 receipt.

1. Before `confirmTrust`, attempt registration for the disposable root: require `untrusted_root`.
2. Start a task-owned UAgent with native gate OFF while the UI gate is ON: require `feature_disabled`. Close that task-owned app before starting the gate-ON happy path.
3. Stop the observation, then request a new registration: require `observation_session_stopped` or the documented stable equivalent.
4. Only when a task-owned UE process exists, create an independent registration, close that process, and attempt the next operation: require `process_exited` before MCP. If no task-owned UE exists, record `BLOCKED_BY_ENVIRONMENT`; never stop a user-owned process or fabricate a pass.

## Lease and Authority Checks

- First execute after 60 seconds without a prior accepted execute: `approval_expired`.
- Forward after the absolute 15-minute cap: `transaction_expired`.
- From 15 to 20 minutes, an already-owned side effect permits only explicit same-registration recovery rollback.
- Rollback after the absolute 20-minute cap: `recovery_expired` with no MCP call.
- Trust revocation/root replacement blocks guard and active evidence.
- Unbound evidence path returns `asset_path_not_bound`.
- Gate OFF after an owned side effect blocks forward work but may permit only the bounded explicit recovery rollback.

## Ledger Result Rules

- Record `PASS_REAL_SMOKE` only when the complete current-source happy path, all required negative ledgers, final residue checks, plugin identity, and ownership checks pass.
- Record `BLOCKED_BY_MCP_SCHEMA` for missing/incomplete exact discovery or an unreproducible plugin identity.
- Record `BLOCKED_BY_ENVIRONMENT` for missing disposable target, task-owned process, required ownership facts, or other genuine environment prerequisites.
- On unknown residue or failed bounded recovery, stop. Do not use direct native/MCP calls or manual/broad cleanup.

## Historical 09Z Result

- Historical result: `PASS_REAL_SMOKE`.
- Historical run: `ui-mrpovp9e-1`.
- Scope: former happy path only; not accepted as C11 authority or fresh smoke evidence.
- Historical Source Checkpoint Rework 7 and documentation-only Rework 8/Rework 9
  did not edit the five TitleBar-coupled files. The current task inherited those
  dirty files and evolves only their stage label/assertions to `MVP15 Sandbox`;
  the underlying window-control changes remain inherited workspace state.
