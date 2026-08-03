# MVP15 Native Authority Binding Rework Handoff

## Current MVP15D Final Source/Tooling Rework 8 Source Handoff — 2026-08-03 (checkpoint closeout)

Final Source/Tooling Rework 7 is the historical/current predecessor `PARTIAL`;
its supervisor verdict was `NEEDS_FIX`, and no checkpoint was created. Final
Source/Tooling Rework 8 is `COMPLETE` at implementation commit
`98c8b387e1124a519977849d48ab824e4e6bb9c5`; supervisor verdict is `PASS`.
G14 is `IMPLEMENTED`; G15 is `COMPLETE`; G16 is `PARTIAL`.
Real UE 5.8.1 compatibility and overall acceptance remain `PARTIAL`; D13 /
15A remains `BLOCKED`; D14 / 15B and D15 / 15C remain `PLANNED`; D16 remains
`IN_PROGRESS`; Ready is `NO`. The verified release binary truthfully reported a
dirty pre-checkpoint source identity (`sourceDirty: true`) over the 335-file
transitive production boundary. A separate clean-checkout rebuild from the
implementation commit remains required for G16 and D13 / 15A.

The handoff preserves the default-off production Tauri bridge, native-generated
runtime events, one-time nonce and authenticated driver transport, asynchronous
Windows Job process ownership, an early task-owned process identity published
while the process is alive, one branded live publisher path with
explicit PID/creation matching and independently derived facts, a fully bound
path-free loaded-module ledger with one exclusive atomic writer, complete
downstream ledger/artifact cross-binding, actual
release-binary native/product/UI capability handshakes, and official Unreal
Automation report ingestion. The runner and transitive production boundary bind
those events to producer ledgers, hashes, process closeout, deterministic
redaction, and independent verification. The publisher brand is not serialized
or presented as proof held by a later process. Persisted exported/CLI
verification returns `*_persisted_consistency_verified` with
`productionLaunchAuthorityVerified: false`; even a fully coherent hand-authored
chain cannot receive the owned status. Only the same `executeLivePhase()`
invocation that checked absent outputs, launched the fixed producer with the real
non-injected launcher, checked the actual child and retained cross-binding, and
consumed its private single-use `WeakSet` receipt can return
`*_owned_launch_verified` with `productionLaunchAuthorityVerified: true`.
`build.rs` consumes the validated
356-entry Git/source watch set (worktrees, loose/packed refs,
symbolic/detached HEAD), so a same-branch commit, production-file addition, or
tracked production-file deletion deterministically invalidates the identity.

Capability-only handshakes record zero MCP calls, zero network calls, zero asset
operations, and zero residual processes. The real Windows fixture-process,
PID/creation mismatch, intermediate junction/reparse, and fail-closed cleanup
regressions pass with zero current residues. No real UE session, Tool Search,
full product discovery, or mutation lifecycle ran
(`SKIPPED_BY_TASK_BOUNDARY`). The unsafe predecessor evidence root was
invalidated and removed for `TOKEN_AND_RAW_PATH_EVIDENCE_INVALID`; no
replacement live root was created. The next task may use the published Rework 8
implementation commit for a clean-checkout read-only compatibility run.
Real mutation remains prohibited and requires a later separate task.

Identity v2 / manifest v3, engine `5.8.1`, engine CL `56057345`, compatible CL
`55116800`, module BuildId `55116800`, the exact `RunUAT.bat ... -Rocket`
construction, deterministic module index, tracked ICO, actual Tauri MSI/NSIS
bundling, and historical Source Checkpoint Rework 7 validation remain preserved.

## Historical MVP15D Rework 9 Source-checkpoint Handoff — COMPLETE — 2026-07-26

Rework 8 is `NEEDS_FIX` because the current acceptance manifest file SHA
conflicted with retained evidence and the other current repository documents,
while product code and retained evidence validation passed.
Previous task:
`TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-8`. Current task
`TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-9` and the
D0-D12 source checkpoint are `COMPLETE`. Verified implementation/content commit
`b1c4e4a4b567d5018c0d0fa7fa1769a26e70f66e` is published with the Rework 9
documentation closeout checkpoint on `main`.

`BLOCKED_BY_EVIDENCE_RETENTION` is closed. Retained roots are
`external/mvp15d-rework7-d0-20260726_190100`,
`external/mvp15d-rework7-build-20260726_203000`, and
`external/mvp15d-rework7-ue-20260726_190100`. D0 records 129 indexed artifacts,
zero mutation, Direct, and transcript-index SHA-256
`b87e0a8a4d685b0cbddd55c8ea5ed4e944b9feba7aaa9d9176e23e2dfdeb0f99`.
The build bundle has 60 files total (59 inventory-tracked payload files plus
`inventory.json`); its SHA-256 is
`ef86e59c05068f9610050a2afa44bf3237d3fd78e82262cf6d3be6660223420b`.
UE records five sessions, `48/48`, residual zero, unchanged empty Content, and
capture SHA-256
`8794de55d0bc3444015116918b92e957070e684ac014f7f9551c07762af1cbb8`.

All requested workspace, Rust, tooling, build-bundle, targeted, syntax, and
side-effect gates exit 0. Two consecutive workspace tests record shared 33,
MCP 46, runtime 825, desktop 725 passed / 3 skipped. The historical supervisor
first attempt exited `134`; subsequent runs passed. No source-checkpoint blocker
remains.

No final 15A package, product-UI mutation lifecycle, or stage-advance decision is
claimed. Ready for the next MVP stage remains `NO`; D13, 15A, 15B, and 15C
remain prohibited until separately authorized. The working tree contains
inherited Companion status/contract/hash/fingerprint/generation copy changes in
`AssetMutationPanel` and `ConfigSettings`, with corresponding UI assertions.
Historical Source Checkpoint Rework 7 and documentation-only Source Checkpoint
Rework 8/Rework 9 did not edit those files or
the five TitleBar-coupled files.

## Historical MVP15D Rework 4 Handoff - NEEDS_FIX - 2026-07-24

Rework 4 is rejected as `NEEDS_FIX`; current source-checkpoint acceptance is
`BLOCKED`, Ready for the next stage is `NO`, and Rework 5 is required. No route,
final clean 15A package, installed/loaded identity proof, or real
product-mutation result exists.

Pending supervisor acceptance work is concrete: supply a real product-adapter D0
producer and four sessions, repair the cross-phase accepted-plan binding,
capture physical run-root identity, await revocation on every publication path,
replace nominal Automation cases with executable adversarial coverage, make the
default Rust suite stable, and run the task-owned UE matrix. UE 5.8 tooling is
available; the implementation agent may create a fresh disposable project
without user interaction. D13, 15A, 15B, and 15C remain prohibited.

## Historical Rework 3 Supervisor Handoff - NEEDS_FIX - 2026-07-20

Rework 3 is rejected as `NEEDS_FIX`. Its four captures are UE Commandlet
Automation markers rather than UAgent product-adapter sessions, and its four UE
Automation tests do not cover the required matrix. ExactSix accepts zero tools
without a manifest. Complete ownership/session/native-plan binding, truthful
partial/unknown-effect recovery, completion-ordered native approval retraction,
and positive loaded-module integration remain open.

This is not a final handoff or route selection. A dirty tree is normal before
supervisor review and is not the blocker; Rework 4 must close the source and
evidence gates before a source checkpoint. D13/15A/15B/15C and product asset
mutation remain prohibited.

## Historical Rework 2 Handoff Context - 2026-07-20

### Rework 2 reviewed and rejected

- Independent `UAgentAssetTools` UE 5.8 exact-six plugin source and contract
  schema; Epic MCP sources remain unchanged.
- Runtime/desktop companion types, fingerprint/status surfaces, native installed
  package checks, and action/service readiness checks are present, but Rework 2
  is `NEEDS_FIX`. Its sole local sub-fix preserves native `blocked` status; a
  previously accepted fingerprint is still not atomically retracted. The actual
  plugin/runtime rollback contract is incompatible,
  ownership/precondition/partial-effect handling is incomplete, and native
  loaded-module authority is not implemented.

### Remaining evidence gates

- D0 four-combination product-adapter evidence was not run. UE 5.8 tooling and
  the retained task-owned copy exist outside PATH; the environment probe must
  use the resolved installation rather than report a missing environment.
- Implement an actual product capture path and both D0 spike alternatives, run
  all four read-only combinations, select one registration route, repair the
  C++/runtime/native inverse protocol, and provide real loaded-module evidence.
  No product mutation validation is permitted before those gates.
- 15A clean build/install/load, 15B live fingerprint, and 15C fresh UI lifecycle
  remain pending a corrected Rework 3 supervisor source checkpoint.

No final acceptance or `Ready YES` is claimed. Fixture and historical 09Z
evidence do not substitute for the required live evidence.

Historical baseline stage: **MVP15 - Native Authority Binding Rework**. The
historical Rework 9 D0-D12 source checkpoint remains `COMPLETE`;
Ready for the next MVP stage remains `NO` because G13/G16 and 15A-15C remain
gated.

## Delivered Historical Baseline

- The historical MVP15C / 09Z product-UI lifecycle `ui-mrpovp9e-1` remains `PASS_REAL_SMOKE` for the former happy path only.
- The narrow write scope remains `/Game/UAgentSandbox/<run-id>/**`; `/Game/Test01` remains read-only.
- Exact six-tool allowlisting, strict result parsing, inverse ownership, read-only evidence, redaction, and recorded-only replay remain required capabilities.

## Historical C11/11A Implementation

- Native trusted-root resolver and revocation-aware root authority.
- Live observation/process binding at registration and before every execute/rollback MCP call.
- Strict default-off `UAGENT_ENABLE_ASSET_MUTATION=1` native gate.
- Maximum 60-second first-execute token plus absolute 15-minute forward and 20-minute recovery deadlines.
- Authority-revalidated active evidence and path-bounded read-only terminal evidence.
- Post-confirmTrust-only mutation root mapping.
- A01-A21 automated coverage and five structural side-effect scan categories.

Historical 11A automated evidence includes TypeScript typecheck/lint, shared 32, runtime 789, MCP 46, desktop 671 with 2 existing skips, full workspace tests, web build, exact cargo fmt/check, native 139/139 serial tests, diff check, and the final side-effect scan at 299 files / 3,813 allowed / 0 blocked / 923 review. Deterministic tests cover atomic observation renewal, accepted-guard settlement, token-bound unstarted-registration retirement, prior-ownership rollback recovery, and stale facade-discovery publication.

## Historical C14/C14A Fingerprint Implementation

- Deterministic `uagent.mvp15.live-asset-toolset-fingerprint.v1` canonicalization for direct and facade exact-six descriptors, with recursive object-key sorting, array preservation, UTF-8 SHA-256, and no accepted hash on any invalid input.
- Fail-closed coverage for missing, allowlisted duplicate, unexpected/duplicate count, reordered, empty-identity, invalid contract, unsupported/non-JSON, mixed precedence, primitive/non-string/throwing proxy-like input, and every required field/identity change. Blocked publication never echoes raw unexpected names or URL/path/token/credential canaries.
- Desktop publication is bound to the current MCP session and discovery generation. C14A atomically retracts discovery, facade inventory, binding, hash, and canonical byte length before the first reconnect/invalid-endpoint status notification; concurrent/stale completion cannot restore them.
- Historical TypeScript gates: targeted runtime `92/92`, desktop adapter/UI store `71` passed with 3 opt-in live skips, shared `5/5`; full shared `33`, MCP `46`, runtime `805`, desktop `679` passed with 3 skips; typecheck, sequential lint, web build, diff check, and final side-effect scan 301 files / 3,906 allowed / 0 blocked / 926 review pass. Rust is `SKIPPED_NOT_APPLICABLE` because no Rust file changed.
- No UI/store mutation control was added, and no MCP transport, native contract, package, dependency, or build configuration changed.

## Delivered C12-C13E1 Environment Evidence

- C12 reproducibly identified UE `5.8.0` promoted `55116800`, descriptor-reported `Unreal MCP` `1.0`, BuildId, and six project-local module hashes.
- C13 created and preserved a task-owned project copy. C13B proved child-only task-local DDC isolation and task-owned module/listener startup, although cold-cache listener readiness was about `+602.9s`.
- C13C observed the same warm launch readiness at `+33.408s` with one launch, zero retries, five-second light polls, 30-second heavy snapshots, unchanged user UE/shared Zen/source metadata, and zero product/MCP/native/mutation actions.
- C13C did not close cleanly: task Plugins gained 28 generated Python bytecode cache files. The retained copy and evidence were preserved without unauthorized cleanup.
- C13D exactly removed the C13C residue, restored the 163-file Plugins baseline, and used one child-only bytecode-suppressed launch with zero retries and no live heavy worker. Readiness was observed at `+115.030s`; immediate closeout then regenerated the same 28 files, so `PYTHONDONTWRITEBYTECODE=1` did not contain the embedded UE Python runtime. The second-generation residue was preserved and the result is `BLOCKED_BY_ENVIRONMENT` / `BYTECODE_SUPPRESSION_FAILED`.
- C13E produced a narrow dual-aggregate candidate and valid one-launch ledger: exact 163-file business state plus exact 28-file cache state, readiness at `+94.338s`, matching pre/post inventories, clean process/port closeout, and zero product/MCP/native/mutation actions. Supervisor review did not accept its validator because native `realpath` errors fail open and header mismatch results can still claim `valid: true`.
- C13E1 repaired that validator without launching UE or touching the retained cache: native `lstat`/`realpath` errors now produce `PATH_INSPECTION_FAILED` and a nonzero exit, every failed header branch reports `valid: false`, the expanded matrix passes 23/23, and a fresh read-only retained-copy run remains exact at `191 = 163 + 28` with zero size/SHA/mtime change. Supervisor review accepted the result at verified implementation commit `12159b9b5eb31829208df5c01c7fc97f157398c2`.

## C14 Controlled Read-only Result

- Route A remained exact before and after at `191 = 163 business + 28 cache`, including an identical 28-entry path/size/SHA/mtime manifest and clean task-process/listener closeout.
- The product adapter sent one initialization request, then encountered a pre-discovery transport/environment failure. That is not a schema rejection and produced no descriptor/schema decision. Every discovery-tool, generic asset wrapper, exact asset, registration, token, dry-run, execute, verify, rollback, replay, and mutation count remained zero. No fixture was substituted and no live SHA was accepted.
- Active project-local modules are unsigned. The observed validly Epic-signed sibling modules all have different hashes, and no authoritative manifest or source/build attestation maps the active bytes.
- The authoritative active-byte mapping remains `BLOCKED_BY_MCP_SCHEMA`; this is separate from the live transport/environment failure and is not a product-smoke result. C14A performed no UE/live/mutation action.

## Current Remaining Evidence

- A sealed final package and live manifest/install/load equality from a clean
  checkout of implementation commit `98c8b387e1124a519977849d48ab824e4e6bb9c5`.
- Fresh current-task UE Automation output, exact-six product-adapter capture,
  and rendered product-UI happy/negative/replay/cleanup evidence.
- A retained final inventory produced and verified from those live source
  artifacts.

## Current Later-stage Gates

- D13 / 15A remains `BLOCKED` pending a compliant clean-checkout live
  build/install/load verification.
- D14 / 15B and D15 / 15C remain `PLANNED`; the hard gate prevented execution.
- D16 remains `IN_PROGRESS`; G14 is `IMPLEMENTED`, G15 is `COMPLETE`, and
  G16 is `PARTIAL`.

## Residual Risks

- Real UE/MCP behavior can vary by engine patch, project, plugin build, and machine.
- A failed real mutation may leave owned residue that only the bounded product recovery path may address.
- Schema or plugin upgrades invalidate the recorded contract fingerprint and require complete rediscovery, tests, and real smoke.

## Still Prohibited

- Non-sandbox writes, Save All, arbitrary SavePackage, broad/bulk mutation, generic wrapper mutation, provider auto-apply, replay execution, automatic git operations, secret/raw-path disclosure, and manual/broad cleanup.
- Killing or taking over user-owned UE/MCP processes.
- Treating UI/caller root, session, PID, or gate values as native authority.
- Starting MVP16 implementation; only research and planning are allowed.

## Progression

The D0-D12 `b1c4e4a...` / Rework 9 checkpoint remains valid historical
evidence. Final Source/Tooling Rework 7 is the historical/current predecessor
`PARTIAL` with supervisor verdict `NEEDS_FIX`, and no checkpoint was created.
Final Source/Tooling Rework 8 is `COMPLETE` with supervisor `PASS` at
implementation commit `98c8b387e1124a519977849d48ab824e4e6bb9c5`; G14 is
`IMPLEMENTED`, G15 is `COMPLETE`, and G16 is `PARTIAL`.
D13 / 15A remains `BLOCKED`; D14 / 15B and D15 / 15C remain `PLANNED`; D16
remains `IN_PROGRESS`; real UE 5.8.1 compatibility and overall acceptance
remain `PARTIAL`; Ready remains `NO`. A new clean-checkout read-only
compatibility run is the next permitted task. No next-stage or
mutation work is authorized.
