# MVP15 Final Verification

## Current MVP15D Rework 8 Documentation Verification — IN_PROGRESS — 2026-07-26

Previous task
`TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-7` received
`NEEDS_FIX` because repository documentation/report facts were inconsistent,
while code and retained D0/build/UE evidence validation passed.
Current task
`TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-8` is
`IN_PROGRESS`; source-checkpoint acceptance is `BLOCKED`, Ready is `NO`, and
the current blocker is `PENDING_SUPERVISOR_CHECKPOINT`.

`BLOCKED_BY_EVIDENCE_RETENTION` is closed by retained, in-place validated
evidence:

- D0 `external/mvp15d-rework7-d0-20260726_190100`: four sessions, 129 indexed
  artifacts (130 files including `hashes.json`), mutation zero, Direct;
  transcript index
  `b87e0a8a4d685b0cbddd55c8ea5ed4e944b9feba7aaa9d9176e23e2dfdeb0f99`,
  hashes file
  `d393ce454385b32d07fa1a08ac7b8f39f897052dc3ff68daf785fc60d8077106`,
  route decision
  `3fee1961461eefe12b68d45657eb0a73879cc009f004bac09076abae2b8b5ce4`.
- Build `external/mvp15d-rework7-build-20260726_203000`: 60 files total (59
  inventory-tracked payload files plus `inventory.json`); bundle
  `ef86e59c05068f9610050a2afa44bf3237d3fd78e82262cf6d3be6660223420b`;
  inventory self/file
  `096e92b42f28eda7c227efde9747c33dd7c3c2f8d1e08988af77588f09b83303` /
  `e8c05405d6feb9759b13e1856c338c9cdcaf7edee7a9acad6528a57e340c09b4`;
  manifest file/self
  `236f1da71961fd697e81ad0a6d9f53f82076b71019e74400eed8b95f0d69ac84` /
  `def7a4a9a08ec54827721ad6b600e8f6bf20f03dead001e277cc33505c9becc1`;
  source tree/bundle
  `0501df66863e1ca3b09d69ab82363279501e8238fa3ccfec77e80cc059b5cefe` /
  `93b3bb310ef17b18adb85b413360890648a9ab614301cedbf19ba81fb42146f6`;
  Content empty at
  `926acba71ebeb9e598c2c5219019667a8685f0c444f13761ea8ffc37dfe5466d`;
  process/port/marker residual zero. The fresh build used one local action,
  had no low-memory reschedule, and exited 0; incremental rebuild exited 0.
  Windows Job accounting recorded 41 descendants, 29 complete and 12
  short-lived incomplete identities, 40 explicit exit events, one exit event
  closed by `ACTIVE_PROCESS_ZERO`, and zero residual process.
- UE `external/mvp15d-rework7-ue-20260726_190100`: capture
  `8794de55d0bc3444015116918b92e957070e684ac014f7f9551c07762af1cbb8`,
  five sessions, `48/48`, six processes per ledger, residual zero, unchanged
  empty Content, and 15-log aggregate
  `4c846b6a444fda60e0d72dc27db86c6e33e7d3d9cf71fd107f47c4bb63f2841c`.
- Canonical C++/shared/compiled binding fixture: both repository fixture copies
  are 4,865 bytes with SHA-256
  `771168ec8b6e7215672a4d839fa675d88f9207876e2c51513b26d6c58da56a1b`.

Node `v24.14.1`, pnpm `11.9.0`, typecheck, lint, build, two consecutive
workspace tests, Rust format, ten fresh default Cargo runs, serial Cargo,
tooling `23/23`, build-bundle `10/10`, targeted authority/vector checks, and the
side-effect scan exit 0 at 1,039 files / 0 blocked / 1,655 review findings.
Workspace tests record shared 33, MCP 46, runtime 825,
desktop 725 passed / 3 skipped; existing TitleBar `act(...)` and >500 kB chunk
warnings remain non-failing. The historical supervisor first test attempt
exited `134` after shared 33; later reruns passed.

Neither Rework 7 nor documentation-only Rework 8 edited the five
TitleBar-coupled files. Inherited
`AssetMutationPanel` / `ConfigSettings` UI diffs are unrelated. D13, 15A, 15B,
15C, final packaging, product-UI mutation, and stage advance remain unauthorized.

## Historical MVP15D Rework 6 Implementation Verification — NEEDS_FIX — 2026-07-26

Rework 5 is a historical supervisor-rejected attempt with verdict `NEEDS_FIX`.
Rework 6 was reported `IN_PROGRESS`; its later verdict is `NEEDS_FIX` because
the D0 and compiled-project manifest roots below were unavailable at review.

Rework 6 source remediation covers deterministic shared-registry test isolation,
task-only/public/native mutation authority, startup and stale retraction,
renderer reconstruction, one canonical Rust/TypeScript/C++ binding tuple,
atomic directory create/identity ownership, and marker-bound UE descendant
process closeout. The working tree also contains visible Companion
status/contract/hash/fingerprint/generation copy changes in `AssetMutationPanel`
and `ConfigSettings` plus changed UI assertions. These are UI copy/test updates;
they are not TitleBar changes and do not establish acceptance.

Fresh Rework 6 implementation evidence:

| Command / evidence | Exit / result | Exact summary |
| ------------------ | ------------- | ------------- |
| `pnpm typecheck` | 0 | All workspace typechecks completed. |
| `pnpm lint` | 0 | Workspace lint completed. |
| `pnpm build` | 0 | 258 modules; 702.74 kB output with the existing non-failing chunk-size warning. |
| `pnpm test` | 0 | Shared 33, MCP client 46, runtime 825, desktop 725 passed / 3 skipped; existing TitleBar React `act(...)` warnings remain non-failing and out of scope. |
| `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check` | 0 | Rust formatting check completed. |
| Ten independent ordinary default Cargo processes | 0 for every run | Every run completed 154 library tests plus 2 bridge integration tests. |
| Serial Cargo diagnostic | 0 | 154 library tests plus 2 bridge integration tests. |
| `node --test scripts/mvp15d-tooling.test.mjs` | 0 | `14/14`. |
| Four task-specified `node --check` commands | 0 for every command | Product-adapter runner, D0 capture, D0 spike, and UE Automation scripts parsed successfully. |
| `node scripts/side-effect-scan.mjs` | 0 | 1,038 files; 4,521 allowed; 0 blocked; 1,630 review findings. |
| `git diff --check` | 0 | No whitespace errors; line-ending notices only. |
| UE current project compile | 0 | `external/mvp15d-rework6-final-20260726_013626/ue-project-build.log`. |
| UE incremental rebuild | 0 | `external/mvp15d-rework6-final-20260726_013626/ue-project-rebuild.log`. |

Ordinary default Cargo fresh-process ledger:

| Run | Exit | Library | Bridge |
| --- | ---- | ------- | ------ |
| 1 | 0 | 154 | 2 |
| 2 | 0 | 154 | 2 |
| 3 | 0 | 154 | 2 |
| 4 | 0 | 154 | 2 |
| 5 | 0 | 154 | 2 |
| 6 | 0 | 154 | 2 |
| 7 | 0 | 154 | 2 |
| 8 | 0 | 154 | 2 |
| 9 | 0 | 154 | 2 |
| 10 | 0 | 154 | 2 |

Fresh D0 evidence:

- raw capture:
  `C:/Users/admin/AppData/Local/Temp/UAgent-MVP15D-Rework6-d0-raw-20260726_025000`;
- independent index:
  `C:/Users/admin/AppData/Local/Temp/UAgent-MVP15D-Rework6-d0-index-20260726_025500`;
- four Direct/Toolset Registry × Tool Search ON/OFF sessions, 129 indexed
  artifacts, mutation count zero, and `selectedRoute=direct`;
- transcript-index SHA-256:
  `866dfc976cbc55bac3b00b2c33657417c1b1fb8d8b464315e91aae0d5a2c0330`;
- `hashes.json` SHA-256:
  `d33b2736954a154f676dcc8026d8ece52d04cbf5125567be001c99ee95a21ab2`.

Fresh UE v4 evidence:

- root: `G:/UAgent/external/mvp15d-rework6-ue-20260726_013626-v4`;
- five sessions and `48/48` named Automation cases;
- five marker-bound descendant-process ledgers, each with final residual count
  zero;
- Content remained unchanged at zero files;
- capture size 97,561 bytes; SHA-256
  `b7cd6449ff6e651a7ca04575b5fca836564f39c49ca32a4971bdefc1576aef18`.

Independent recomputation and targeted ledgers:

- canonical `acceptedPlanBinding`:
  `0ba61fe88d86a20cb8ccf4d4296ef10f68cf7bc896c29513e58569b02ab13698`;
  the byte-identical Rust/TypeScript and UE resource fixture is 4,865 bytes
  with file SHA-256
  `771168ec8b6e7215672a4d839fa675d88f9207876e2c51513b26d6c58da56a1b`;
- the 19-file repository/compiled-project source bundle is byte-identical
  (317,020 bytes) with independently computed bundle SHA-256
  `93b3bb310ef17b18adb85b413360890648a9ab614301cedbf19ba81fb42146f6`;
- the current task-only manifest is 1,848 bytes with file SHA-256
  `a16ac5368ab86f5b8d446ebd8b963611b6bad61ab7b95f66aa71a36f05a364af`
  and canonical self-hash
  `68ca579f03fbe4ae44e8b1a4c33ddc36d029712b66bb5375a56dd5841fe3da69`;
  its all-zero source commit remains an explicit task-only marker, and its
  source-tree SHA-256 is
  `0501df66863e1ca3b09d69ab82363279501e8238fa3ccfec77e80cc059b5cefe`;
- current compile/rebuild logs independently hash to
  `54b89f314bfcc598894879e21e3e0c361ad512b37aeea679f4aa0fca23a0c576`
  and
  `a55a4a63446e37291c2f8f035a92c9b9709b0dc33136756301691a14ffe0b6ab`;
- targeted adapter/native tests record 101 passed / 3 skipped, targeted runtime
  companion/vector tests record 25 passed, store lifecycle records 18 passed,
  targeted Rust vector/retraction/concurrency runs record 2 / 3 / 1 passed, and
  process-ledger/Windows Job tests record 7 passed;
- UE race cases include `RunRootCreateToIdentityRace` and
  `EffectDirectoryCreateToIdentityRace`; all five D0 closeouts record process,
  port, and marker closure, and the final task-marker process-table scan records
  zero residual processes.

These were implementation-Agent results. The later review found the required D0
and compiled-project manifest roots unavailable, so evidence retention, not
solely a pending checkpoint, blocked acceptance.

Binding terminology is fixed: `acceptedPlanBinding` is the canonical material
hash stored inside the vector, while the fixture-file SHA-256 hashes the complete
JSON file bytes. They are different facts and must be recorded separately. The
Rework 5 fixture-file hash below remains historical only and must not be
substituted for the current vector's material binding or file hash.

No D13/15A/15B/15C work, final packaging, product-UI asset mutation, or stage
advance is authorized during this verification.

## Historical MVP15D Rework 5 Supervisor Review — NEEDS_FIX — 2026-07-25

Supervisor verdict: `NEEDS_FIX`. Rework 6 is `IN_PROGRESS`,
source-checkpoint acceptance is `BLOCKED`, Ready for the next stage is `NO`, and
no checkpoint was created or pushed.

| Command / evidence                                                       | Result                    | Fresh supervisor summary                                                                                                                                                                          |
| ------------------------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm lint`                                                              | PASS                      | Exit 0.                                                                                                                                                                                           |
| `pnpm build`                                                             | PASS                      | 258 modules; existing large-chunk advisory remains non-failing.                                                                                                                                   |
| `pnpm test`                                                              | PASS                      | shared 33, MCP client 46, runtime 822, desktop 720 passed / 3 skipped; existing React `act(...)` warnings remain non-failing.                                                                     |
| `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check` | PASS                      | Exit 0.                                                                                                                                                                                           |
| Ordinary default Rust suite                                              | FAIL                      | Fresh run failed at 146/147 in UE process identity replacement; independent repetition passed once then failed at `asset_mutation.rs:3990`. One shared-registry test lacks the repository guard.  |
| Isolated failing Rust test                                               | PASS, insufficient        | Confirms nondeterministic suite-level shared-state interference.                                                                                                                                  |
| Targeted desktop adapter tests                                           | PASS, insufficient        | 94 passed / 3 skipped; the public-incompatible guard test forwards to native and relies on its mock to block.                                                                                     |
| Targeted store lifecycle                                                 | PASS, insufficient        | The Rust, TypeScript, and C++ tests pair the binding string with different registration/generation/identity facts.                                                                                |
| `node --test scripts/mvp15d-tooling.test.mjs`                            | PASS                      | 6/6.                                                                                                                                                                                              |
| Retained D0 validation                                                   | PASS as retained evidence | Four combinations, 129 artifacts, reported hashes, source bundle, and `selectedRoute=direct` independently match. Adapter changes required by Rework 6 require a fresh run.                       |
| Retained UE validation                                                   | PARTIAL                   | Five sessions, 46/46 recorded cases, log/manifest hashes, and Content restoration match. Per-session CrashReportClient/descendant closeout is absent; C++ and runner changes require a fresh run. |
| `node scripts/side-effect-scan.mjs`                                      | PASS                      | Post-review documentation closeout: 1,037 files / 4,476 allowed / 0 blocked / 1,544 review.                                                                                                       |
| `git diff --check`                                                       | PASS                      | No whitespace errors; line-ending notices only.                                                                                                                                                   |
| Staged/checkpoint/push                                                   | NOT RUN                   | Staged set is empty; branch `main` remained at `fa11bd867020eead897e4a7f82b01934bb034a87`, with initial upstream divergence `0 / 0`.                                                              |

Blocking source findings:

- task-only public `incompatible / companion_live_identity_missing` state stores
  a local attestation binding and can forward new registration/execution to
  native;
- adapter reconstruction can skip native startup retraction, and stale native
  retraction can be reported as successfully applied while authority remains;
- the claimed cross-language binding vector uses different fact tuples in Rust,
  TypeScript, and C++;
- run-root and effect-directory physical identity is acquired after creation, so
  a same-path replacement can be adopted before the handle opens;
- the UE runner records only its root editor child and has no per-session
  descendant-process closeout ledger.

Retained Rework 5 evidence identities:

- D0 `hashes.json` SHA-256
  `d4de398564975fa965146799ae130dcd7084f4d89100005451a625104e714907`;
  transcript index
  `5b5ab91a2ed2551dde97bc0afc3ffea9ab85fd52207d261d5c6b506f6eda7a9e`.
- Supporting UE capture SHA-256
  `52e9d8dabd85c259b2bd8e787b4118e92f02e7bd5f7b2557da69a9e574899fdc`;
  task-only manifest
  `9ef28df58bea41d14d78cf6591eba3c0f9d8da8d5e41a5e7dc49c9fbae1d83f9`.
- Supporting source tree SHA-256
  `26585ddc64e874e72ff0ab46f8f85b3902366fd1324de52dd083b4fa79b30275`;
  plugin/test module SHA-256
  `4d2ad698849e3a5d513a71fa227fd1243bca51eadf8bf7a25a7a921446ae46aa`
  and `c9b01899259e19eadbaa899cc39095aae8a2ae225d1ecce5e1a7f5a206e2e01d`.
- Supporting UE Content aggregate remained
  `926acba71ebeb9e598c2c5219019667a8685f0c444f13761ea8ffc37dfe5466d`.
- `acceptedPlanBinding` field value is
  `0ba61fe88d86a20cb8ccf4d4296ef10f68cf7bc896c29513e58569b02ab13698`;
  the fixture file SHA-256 is
  `9b818a0bf872ca50bb1c14fb103372a35d661416f0a9fca6b383f4bb4c851dbe`.

No final clean 15A package or separately authorized product-UI mutation
lifecycle exists. D13, 15A, 15B, and 15C remain prohibited.

## Historical MVP15D Rework 4 Supervisor Review - 2026-07-24

Supervisor verdict: `NEEDS_FIX`. Source-checkpoint acceptance remains `BLOCKED`,
Ready for the next stage remains `NO`, and Rework 5 is required. D0 is
`IN_PROGRESS`; no real product-adapter route is selected and no product mutation
is authorized. D13, 15A, 15B, and 15C remain prohibited.

Static review found an incompatible cross-phase accepted-plan binding, missing
physical run-root identity, an unawaited native-retraction path on discovery
failure, and nominal UE tests that do not exercise multiple advertised
adversarial behaviors. The required four product-adapter sessions, selected
route, task-owned UE compilation, 44-case/five-session Automation run, and real
connection lifecycle are absent. UE 5.8 tooling is present locally, so this is
an unexecuted verification gate.

| Command / evidence                            | Result    | Fresh summary                                                                                                                                |
| --------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                                   | PASS      | shared 33, MCP client 46, runtime 820, desktop 686 passed / 3 skipped; existing TitleBar React `act(...)` warnings remain non-failing.       |
| `pnpm lint`                                   | PASS      | Workspace lint completed.                                                                                                                    |
| `pnpm build`                                  | PASS      | Desktop build transformed 258 modules; existing chunk-size advisory remains non-failing.                                                     |
| Targeted Rust asset tests                     | PASS      | 30 asset-mutation tests passed.                                                                                                              |
| Default parallel Rust suite                   | FAIL      | Two fresh runs produced 19 and 16 failures from shared registries.                                                                           |
| Serial Rust suite                             | PASS      | 145 tests passed with `--test-threads=1`.                                                                                                    |
| `cargo fmt --check`                           | PASS      | Formatting check completed.                                                                                                                  |
| `node --test scripts/mvp15d-tooling.test.mjs` | PASS      | 4 tests passed.                                                                                                                              |
| Side-effect scan                              | PASS      | 1,033 files / 4,371 allowed / 0 blocked / 1,358 review after documentation closeout.                                                         |
| `git diff --check`                            | PASS      | No whitespace errors; line-ending notices only.                                                                                              |
| Real D0 / UE matrix                           | NOT RUN   | No four-session product bundle, selected route, task-owned Rework 4 project, UE compile, or five-session Automation result exists.           |
| Current/previous task-id scan                 | NEEDS_FIX | D0 spike, UE Automation, and tooling assertion still embed the rejected Rework 4 task id; Rework 5 must update them before evidence capture. |

No Rework 4 source checkpoint was staged, committed, or pushed.

## Historical Rework 3 Supervisor Review - 2026-07-20

Supervisor verdict: `NEEDS_FIX`; no source checkpoint was staged, committed, or
pushed. The four D0 JSON files are UE Commandlet Automation markers, not UAgent
product-adapter captures: they contain no product initialize/discovery transcript,
complete descriptors, product no-op call, reconnect, Editor restart, or stale
publication observation. The four UE Automation tests are materially below R4;
`ExactSix` passes with zero tools when the manifest is absent.

Static review also found incomplete session/native-plan/time/effect ownership,
an exported TypeScript ledger unused by the product service, fire-and-forget
native approval revocation before local listener notification, and unsafe
partial/unknown-effect classification. Positive manifest-backed loaded-module
attestation was not exercised. The dirty pre-checkpoint tree is expected and does
not replace these source requirements.

Independent verification passes shared `33`, MCP client `46`, runtime `818`,
desktop `682 passed / 3 skipped`, native `143`, workspace typecheck, desktop build
`258` modules, cargo fmt/check, tooling `2`, diff check, and side-effect scan
`1,033 files / 4,406 allowed / 0 blocked / 1,321 review`. The retained D0 and
Automation JSON were independently parsed and confirm the reported zero mutation
and four test names, while also confirming the missing evidence above. This
historical review led to Rework 4 source work; D13-15C remain prohibited.

## Historical Rework 3 Implementation Report - 2026-07-20

This superseded section records the implementation report before the supervisor
review above; it is not current acceptance. The source report claimed
task-only Direct and Toolset Registry D0 probes, real raw UE capture scripts,
strict inverse/ownership handling, native loaded-byte observation, and atomic
desktop retraction. A fresh task-owned UE Automation command completed four
named tests, and four independent raw UE D0 captures completed for
Direct/Toolset × Tool Search ON/OFF with zero recorded mutation.

The historical canonical provenance build attempt rejected its worktree with
`SOURCE_TREE_DIRTY`. That correctly rejects a final 15A package from a dirty
tree, but it does not block Rework 4 source remediation. No sealed final
manifest, trusted signed D0 envelope, selected production registration route,
real product-UI smoke, or later D13/15A/15B/15C result is claimed by this
historical report. The current Rework 8-required status is recorded at the top of
this document.

## Historical Rework 3 Reported Command Ledger - 2026-07-20

| Command / evidence                                                                 | Result                               | Fresh summary                                                                                                                                            |
| ---------------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`                                                                   | PASS                                 | All four workspace typechecks completed.                                                                                                                 |
| `pnpm --filter @uagent/shared test`                                                | PASS                                 | 7 files / 33 tests.                                                                                                                                      |
| `pnpm --filter @uagent/mcp-client test`                                            | PASS                                 | 8 files / 46 tests.                                                                                                                                      |
| `pnpm --filter @uagent/runtime test`                                               | PASS                                 | 56 files / 818 tests.                                                                                                                                    |
| `pnpm --filter @uagent/desktop test`                                               | PASS                                 | 41 files / 682 passed / 3 skipped; existing TitleBar `act(...)` warnings are non-failing and outside MVP15D scope.                                       |
| `pnpm --filter @uagent/desktop build`                                              | PASS                                 | 258 modules transformed; Vite retained a non-failing large-chunk advisory.                                                                               |
| `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`           | PASS                                 | Formatting check completed.                                                                                                                              |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`                    | PASS                                 | Native crate compiled.                                                                                                                                   |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1` | PASS                                 | 143 native tests passed serially.                                                                                                                        |
| `node --test scripts/mvp15d-tooling.test.mjs`                                      | PASS                                 | 2 tests; provenance and independent-evidence rejection remain fail closed.                                                                               |
| `git diff --check`                                                                 | PASS                                 | No whitespace errors; only non-failing CRLF normalization notices.                                                                                       |
| `node scripts/side-effect-scan.mjs`                                                | PASS                                 | 1,033 files / 4,406 allowed / 0 blocked / 1,321 review.                                                                                                  |
| Current-source UE `BuildPlugin`                                                    | PASS (compile evidence)              | UE 5.8 compiled both companion modules; this is not a sealed final package result.                                                                       |
| Fresh task-owned UE Automation                                                     | PASS (implementation evidence)       | 4 named `UAgentAssetTools` tests completed; Content was `0` files with identical before/after aggregate.                                                 |
| Raw UE D0 capture matrix                                                           | PARTIAL (historical raw observation) | Four Direct/Toolset × Tool Search ON/OFF no-op captures completed with zero mutation; this was not product-adapter D0 success and no route was selected. |
| Canonical provenance build helper                                                  | EXPECTED REJECTION                   | `SOURCE_TREE_DIRTY`; it wrote no valid final package/manifest.                                                                                           |

## Historical MVP15D Source Checkpoint Rework 2 Review — 2026-07-20

Supervisor verdict: `NEEDS_FIX`; no source checkpoint commit was created and no
file was staged or pushed. Rework 2 changed only the renderer native-evidence
normalizer and one test. It correctly preserves native `status:"blocked"` as
blocked, but it did not perform D0, UE/C++ and native fixes, UE Automation,
repository documentation synchronization, or the required full command ledger.

Static review confirms all prior D0, cross-layer inverse, execute-time ownership,
partial-effect, recursive-cleanup, loaded-module, and UE Automation findings remain
open. It also found that blocked/invalid/unavailable/throwing attestation updates
status without retracting `currentMvp15DCompanionFingerprint`; a prior accepted
SHA can remain visible to synchronous listeners and the public getter.

Independent checks pass: targeted desktop adapter `55 passed / 3 skipped`, full
workspace typecheck, diff check, and final post-documentation side-effect scan `308 files / 4,357 allowed /
0 blocked / 1,042 review`. These validate the narrow sub-fix only. D13-15C remain
prohibited, Rework 3 is required, and no supervisor source checkpoint exists.

## Historical MVP15D Source Checkpoint Rework 1 Review — 2026-07-20

Supervisor verdict: `NEEDS_FIX`; no source checkpoint commit was created and no
file was staged or pushed. Rework 1 did not execute D0, did not implement the
Toolset Registry spike route, did not select a production route, and did not
produce loaded-module evidence.

Static contract review also rejects the claimed rollback/ownership completion:
runtime sends inverse rename/move arguments while the plugin compares a hash
recomputed from those arguments with the accepted forward hash; rollback results
publish empty affected paths that runtime validation rejects; native rollback
tool names differ from the actual MCP calls; execute-time target preconditions
and partial-effect observation are incomplete; ledger entries omit the required
session generation; and run-root cleanup uses recursive physical deletion after
checking only registered assets. The native evidence normalizer accepts a
`blocked` result shape instead of requiring `observed`.

Independent gates pass but do not exercise these paths: shared `33`, MCP client
`46`, runtime `814`, desktop `680 passed / 3 skipped`, Rust `140`, tooling `2`,
typecheck, desktop build, cargo fmt, diff check, and side-effect scan `308 files /
4,348 allowed / 0 blocked / 1,040 review`. The UE plugin Automation module still
contains only two tests and was compiled but not run. D13-15C remain prohibited.

## Historical MVP15D Source Checkpoint Review — 2026-07-20

Supervisor verdict: `NEEDS_FIX`; no source checkpoint commit was created.
Independent review confirmed that the UE 5.8 editor, commandlet, RunUAT, and
retained task-owned project copy exist outside PATH, so the report's
`BLOCKED_BY_ENVIRONMENT` classification is invalid and D0 remains
`IN_PROGRESS`. Static review found production attestation/action-gate gaps and
plugin manifest, dry-run-hash, refresh, ownership, rollback-cleanup,
output-schema, build-verifier, and coverage defects. Independent checks at the
rejected source checkpoint passed runtime `811/811`, desktop `680 passed / 3 skipped`, typecheck, `git diff
--check`, and the side-effect scan at `308 / 4,219 allowed / 0 blocked / 1,101
review`; those green commands do not cover or override the review findings.
15A/15B/15C remain unrun. No supervisor-created MVP15D source checkpoint commit
exists, and this rework must not treat an implementation worktree as one.

## Historical Rework 1 Implementation Update (before supervisor review)

This section records what Rework 1 claimed before the supervisor review above;
it is not the current verdict. The candidate source added strict
manifest/self-hash and artifact validation, refresh retraction,
accepted-plan/operation binding, intended ownership/rollback, native
trusted-root attestation, and service-boundary readiness checks. Fresh automated
verification is recorded below and in the implementation report. It does not replace D0:
there is no current hash-indexed four-combination product-adapter transcript
chain, no selected route, no clean supervisor source commit, and no accepted
native loaded-module evidence. The supervisor review above found the cross-layer
rollback, ownership, D0, loaded-module, and UE coverage defects, so these
controls are not accepted as complete. No D13, 15A, 15B, or 15C work is claimed.

## Historical Rework 1 Verification Ledger - 2026-07-20

| Command                                                                            | Result                        | Fresh summary                                                                                                                                                      |
| ---------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm typecheck`                                                                   | PASS                          | All four workspace typechecks completed.                                                                                                                           |
| `pnpm --filter @uagent/shared test`                                                | PASS                          | 7 files / 33 tests.                                                                                                                                                |
| `pnpm --filter @uagent/runtime test`                                               | PASS                          | 56 files / 814 tests, including companion identity and rollback-binding coverage.                                                                                  |
| `pnpm --filter @uagent/mcp test`                                                   | Not runnable as named         | Exit 0 with `No projects matched the filters`; the workspace package is named `@uagent/mcp-client`.                                                                |
| `pnpm --filter @uagent/mcp-client test`                                            | PASS                          | Supplementary correct-package check: 8 files / 46 tests.                                                                                                           |
| `pnpm --filter @uagent/desktop test`                                               | PASS                          | 41 files / 680 passed / 3 skipped. Existing React `act(...)` warnings remain non-failing.                                                                          |
| `pnpm --filter @uagent/desktop build`                                              | PASS                          | 258 modules transformed. Vite retained its non-failing chunk-size advisory.                                                                                        |
| `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml -- --check`           | PASS                          | Rust formatting check completed.                                                                                                                                   |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`                    | PASS                          | Native crate compiled successfully.                                                                                                                                |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1` | PASS                          | 140 native tests passed.                                                                                                                                           |
| `node --test scripts/mvp15d-tooling.test.mjs`                                      | PASS                          | 2 tests; validates clean-provenance/artifact rejection and the D0 bundle requirement.                                                                              |
| UE 5.8 `RunUAT.bat BuildPlugin` on isolated `source-8`                             | PASS                          | `BUILD SUCCESSFUL`; both plugin modules compiled and the sealed package contains 2 DLLs, 0 PDBs, 0 source files, and 0 intermediate files. No Editor was launched. |
| `node scripts/mvp15d-d0-spike.mjs`                                                 | Expected evidence rejection   | `D0_PRODUCT_RUN_EVIDENCE_REQUIRED`, `mutationCount: 0`; no product adapter was launched or mutated.                                                                |
| `node scripts/mvp15d-manifest.mjs create ...`                                      | Expected provenance rejection | `SOURCE_TREE_DIRTY`; no clean supervisor checkpoint is available to create a manifest.                                                                             |
| `git diff --check`                                                                 | PASS                          | No whitespace errors; Windows LF/CRLF notices only.                                                                                                                |
| `node scripts/side-effect-scan.mjs`                                                | PASS                          | 308 files / 4,348 allowed / 0 blocked / 1,040 review findings.                                                                                                     |

## Historical 09Z Record

The MVP15C / 09Z run `ui-mrpovp9e-1` remains a historical `PASS_REAL_SMOKE` record. It demonstrated the former product-UI happy path: five forward operations, four inverse operations, terminal read-only evidence, unchanged source evidence, exact run-root cleanup, and replay delta `0/0/0/0/0`.

That record does not prove rejection of an untrusted-but-existing root, forged session/PID facts, a caller-enabled native gate, a stopped/exited process after registration, revoked trust, or expired 15/20-minute transaction/recovery deadlines. It must not be reused as fresh C11 evidence.

## C11/11A Authority Controls

- Approval registration must resolve the root id and canonical root from the native trusted-root registry rather than canonicalizing caller input and minting another identity.
- Registration and every mutation guard must resolve a live native observation/process record.
- `UAGENT_ENABLE_ASSET_MUTATION=1` is the independent default-off native capability gate; UI state only tightens it.
- The one-time first-execute token remains bounded to 60 seconds, with an absolute 15-minute forward transaction and 20-minute rollback recovery cap.
- Active evidence must revalidate authoritative root/path binding; terminal evidence remains read-only and cannot restore mutation authority.
- Mutation-resolvable root mappings may be published only after `confirmTrust` succeeds.
- A registration is bound to the desktop-owned MCP session object, endpoint identity, and discovery generation. A changed binding after an accepted guard records one explicit no-side-effect failure before returning with MCP count zero; prior ownership remains recovery-only. Unpublished native registrations are retired only by the matching one-time token.
- Observation/session and process leases renew at one atomic commit point only after the lifecycle snapshot is still current; stopped is sticky, and removal/replacement never partially renews either record.
- Discovery and facade inventory publish only after both asynchronous stages still match the same session object, endpoint, and discovery generation.

## Historical Automated Ledger - 2026-07-18

| Command                                                                                              | Result | Fresh summary                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `git status --short` / `git diff --name-only` / `git diff --stat`                                    | PASS   | Task changes plus the pre-existing untracked `external/`; workflow/private files remain excluded.                                                                            |
| `git diff --check`                                                                                   | PASS   | No whitespace errors; Windows LF/CRLF notices only.                                                                                                                          |
| `pnpm typecheck`                                                                                     | PASS   | All four workspaces.                                                                                                                                                         |
| `pnpm lint`                                                                                          | PASS   | ESLint completed with no errors.                                                                                                                                             |
| `pnpm --filter @uagent/shared test`                                                                  | PASS   | 7 files / 32 tests.                                                                                                                                                          |
| `pnpm --filter @uagent/runtime test`                                                                 | PASS   | 54 files / 789 tests, including A08 settlement, prior-ownership recovery, token-bound registration cleanup, and stale-run retirement.                                        |
| `pnpm --filter @uagent/mcp-client test`                                                              | PASS   | 8 files / 46 tests.                                                                                                                                                          |
| `pnpm --filter @uagent/desktop test`                                                                 | PASS   | 41 files / 671 tests passed; 2 existing live/preflight tests skipped; four deferred facade-discovery race cases pass; existing React `act(...)` warnings remain non-failing. |
| `pnpm test`                                                                                          | PASS   | Shared 32, MCP 46, runtime 789, desktop 671; 2 existing desktop skips.                                                                                                       |
| `pnpm --filter @uagent/desktop web:build`                                                            | PASS   | 255 modules transformed; existing chunk-size advisory only.                                                                                                                  |
| `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check`                                | PASS   | 11A applied only rustfmt layout to the four explicitly authorized debt files and formatted task-touched Rust sources.                                                        |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`                                      | PASS   | Native crate compiles.                                                                                                                                                       |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml asset_mutation -- --test-threads=1`    | PASS   | 24/24.                                                                                                                                                                       |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml ue_editor_process -- --test-threads=1` | PASS   | 14/14.                                                                                                                                                                       |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1`                   | PASS   | 139/139, serial.                                                                                                                                                             |
| `node scripts/side-effect-scan.mjs`                                                                  | PASS   | Final documentation-synchronized 11A run: 299 files / 3,813 allowed / 0 blocked / 923 review; five authority categories each report 0 blocked.                               |

The first desktop run exposed two stale documentation assertions after the C11 rewrite. The still-valid sandbox sentence and MCP connection/discovery sequence were restored in the public docs, after which both the desktop suite and full workspace suite passed. No test was weakened to hide the mismatch.

The native hardening also detects ordinary same-path root replacement and PID reuse by binding platform object/process metadata. Without a new Windows API dependency, directory creation time is the available best-effort Windows identity rather than a volume/file id; preserved or privileged timestamp replacement and extremely fast same-resolution PID reuse remain explicit open risks. Authority is revalidated a second time immediately before native acceptance, but no userspace check can eliminate a process exit after the check and before the external call.

The five authority scan ids are `mvp15-native-trust-authority-boundary`, `mvp15-observation-authority-boundary`, `mvp15-native-gate-boundary`, `mvp15-transaction-liveness-boundary`, and `mvp15-pretrust-root-ref-boundary`.

## C13E1 Supervisor Closeout Ledger - 2026-07-19

- Verified implementation commit: `12159b9b5eb31829208df5c01c7fc97f157398c2`.
- `node --test scripts/mvp15-python-cache-surface.test.mjs`: `PASS`, 23/23.
- Retained-copy validator in the approved read-only host context: `PASS`, `ok:true`, `classificationComplete:true`, exact full/business/cache `191 / 163 / 28`, zero errors/unclassified, and all 28 headers valid. Pre/post cache path/size/SHA/mtime values were identical. The restricted sandbox run correctly failed closed with `PATH_INSPECTION_FAILED` rather than classifying an uninspectable ancestor as safe.
- `pnpm typecheck`, sequential `pnpm lint`, `pnpm test`, `pnpm --filter @uagent/desktop web:build`, `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check`, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1`: `PASS`. Workspace summary remains shared 32, MCP 46, runtime 789, desktop 671 passed with 2 existing skips, and Rust 139/139.
- `node scripts/side-effect-scan.mjs`: `PASS`, final documentation-synchronized result 300 files / 3,896 allowed / 0 blocked / 925 review.
- `git diff --check`: `PASS`, with Windows LF/CRLF notices only. Full diff and current-state documents were inspected; `external/`, `.agent-bus/**`, private supervisor material, evidence, logs, and build output were excluded from the checkpoint.
- Side effects during C13E1 repair/review: no UE, UAgent product, Zen, MCP, native, registration/token, mutation, or product-UI action was launched or invoked.
- Checkpoint recovery: 13 initial HTTPS attempts failed at the GitHub TLS handshake. A later manual push accidentally included one external-only commit containing local plugin/build material; supervisor review detected it before acceptance. The branch was restored to the exact pre-incident parent while preserving local files, `external/` was added to `.gitignore`, and `origin/main` was corrected with an exact lease. `git ls-tree` confirms `external/`, `.agent-bus/`, and supervisor-private paths are absent from the corrected tip.

## Historical C14/C14A Implementation and Read-only Ledger - 2026-07-19

- Implementation: C14 added pure canonical exact-six fingerprinting, descriptor schema-version normalization, direct/facade candidate preservation, redacted desktop publication, session/endpoint/generation authority, and stale success/error protection. C14A moves complete discovery/facade/binding/fingerprint retraction ahead of endpoint validation and every connection-status notification, closes stale concurrent connection completion, and replaces raw unexpected/duplicate issue strings with allowlisted duplicate names plus stable counts. Primitive, non-string, throwing/proxy-like malformed descriptors and non-JSON objects fail closed without throwing or accepting a SHA. No MCP transport, native, approval, package, dependency, build, UI/store mutation, or mutation contract changed.
- Targeted tests: runtime fingerprint plus MVP15 runtime `92/92`; desktop adapter plus MVP15 UI store `71` passed with 3 default-skipped opt-in live cases; shared MCP contract `5/5`.
- Adversarial matrix: reconnect success/error first synchronous observer, invalid endpoint after an accepted publication, stale completion, allowlisted duplicate, unexpected duplicate count, URL/Windows-path/`token=`/`Bearer` canaries, primitive/non-string/throwing proxy-like descriptors, revoked top-level proxy, cyclic input, and non-JSON object. Blocked publication serialization contains none of the canaries.
- Full automated verification: `pnpm typecheck`, `pnpm test`, desktop web build, sequential `pnpm lint`, diff check, and side-effect scan passed. Workspace tests: shared `33`, MCP `46`, runtime `805`, desktop `679` passed with 3 skips. Final documentation-synchronized scan: 301 files / 3,906 allowed / 0 blocked / 926 review. Rust commands are `SKIPPED_NOT_APPLICABLE` because no Rust file changed.
- Live launch: the first restricted-context task launch exited before readiness; one host-context retry observed the exact task-loaded module set and task-owned listener. The observer did not establish a canonical simultaneous first-ready timestamp, so no such claim is made.
- Product adapter: the historical C14 attempt sent one `initialize` request, then encountered a pre-discovery transport/environment failure. `list_toolsets`, `describe_toolset`, generic `call_tool`, exact asset calls, registration, token, dry-run, execute, verify, rollback, replay, and mutation were all `0`. No descriptor/schema decision or live fingerprint evidence exists; the fail-closed getter retained `sha256: null`, zero accepted tools, and no raw schema publication. C14A did not launch UE/UAgent, connect live MCP, or perform any mutation-family action.
- Mapping audit: active modules reproduce the C12 hashes but are unsigned. A valid Epic-signed sibling set was observed; all six hashes differ, so it does not map the active bytes. No official package manifest, source revision, repository revision, or build attestation closed the mapping.
- Closeout: pre/post Route A validator returned exact full/business/cache `191 / 163 / 28`, empty errors/unclassified, and 28 valid headers. The identical 28-entry manifest proves path/size/SHA/mtime stability. Task-bound UE/UAgent/CrashReportClient/listener ownership returned to zero; source/task protected aggregates remained exact.
- Remaining evidence: authoritative mapping is `BLOCKED_BY_MCP_SCHEMA`; a successful product-adapter live exact-six capture and fresh product-UI lifecycle remain absent. The C14/C14A implementation checkpoint is supervisor-accepted; this does not change G13/G16 or overall readiness.

## Historical C14A Supervisor Closeout - 2026-07-20

- Verified implementation commit: `37c29cbc7961218bfd71d1809178359952a75e18`.
- Independent targeted verification: runtime fingerprint plus MVP15 runtime `92/92`; shared contracts `5/5`; desktop adapter plus MVP15 store from the required `apps/desktop` working directory `71 passed / 3 skipped`.
- One broader desktop targeted command was first invoked from the repository root and returned three `ENOENT` failures because `Mvp15Store.test.tsx` intentionally resolves fixture/source paths relative to the desktop package working directory. The same files passed from the documented package cwd, and the full workspace desktop suite passed `679 / 3 skipped`; this was a command-context failure, not a product or assertion failure.
- Independent full verification: `pnpm typecheck`, `pnpm test`, desktop web build, sequential `pnpm lint`, `git diff --check`, and side-effect scan all pass. Workspace totals are shared `33`, MCP `46`, runtime `805`, and desktop `679 passed / 3 skipped`; final scan is 301 files / 3,906 allowed / 0 blocked / 926 review.
- Boundary review: reconnect retracts old discovery/facade/binding/fingerprint before synchronous notification; blocked issues publish only allowlisted names and stable counts; adversarial raw names and malformed/proxy inputs accept no SHA and leak no canary. `external/**`, `.agent-bus/**`, private supervisor material, evidence, logs, env files, and build output are excluded.
- Real-environment classification remains unchanged: C14 stopped at a pre-discovery transport/environment failure with no schema decision; authoritative active-byte mapping independently remains `BLOCKED_BY_MCP_SCHEMA`; C14A performed no UE/live/mutation action.

## C12-C13E Real-environment Readiness Ledger

- C12 identified UE `5.8.0` promoted build/changelist `55116800`, descriptor-reported `Unreal MCP` `1.0`, BuildId `55116800`, and six project-local module SHA-256 values. It did not establish official source/artifact provenance or a product-adapter live descriptor inventory.
- C13 created and preserved a task copy. Its first task-owned UE observation stopped before listener readiness, so product discovery and mutation were not entered.
- C13A established the DDC/Zen blocker and the need for a task-local writable cache; its first diagnostic launch also caused a historical shared-Zen incident, after which the user normally reopened UE before later work.
- C13B used one launch and zero retries with child-only task-local DDC overrides. The cold cache produced module loads at about `+596.8s` and port 18080 startup at about `+602.9s`, outside the 600-second gate. User UE/shared Zen/source/task business state closed cleanly.
- C13C reused the preserved warm DDC with five-second lightweight polling and a dedicated 30-second heavy snapshot worker. One launch and zero retries reached simultaneous exact-six module, task-owned loopback 18080, task-local DDC graph, non-empty cache, and immutable user/shared/source/task metadata readiness at `+33.408s`. Observer transient skips were zero.
- C13C closeout removed all task-owned processes and port ownership while user UE, shared Zen, and source aggregates remained unchanged. However, the task Plugins aggregate changed from `163 / 364,816,387` to `191 / 365,489,946` because UE generated 28 `__pycache__/*.pyc` files under the copied EditorToolset plugin. The files were preserved rather than cleaned because Plugins modification/cleanup was outside the task boundary.
- C13D D0 independently fixed the C13C inventory at 28 regular non-link/non-reparse files / 673,559 bytes and proved that virtually excluding them restored the exact `163 / 364,816,387 / 550ca685...` Plugins baseline. D1 used one Python process to revalidate each literal path, file identity, size, hash, and containment before `Path.unlink()`, then non-recursively removed four verified-empty `__pycache__` directories. Post-clean Config/Content/Plugins/Binaries and source/user/shared state matched exactly.
- C13D runner validation used in-memory `compile(source, filename, "exec")`: `PASS`. The runner had one `Popen(args=list, shell=False)` call, no live heavy worker, five-second light polls, task-local DDC binding, and child-only `PYTHONDONTWRITEBYTECODE=1` while the parent override remained absent.
- C13D executed `python -B -X utf8 <c13d_runner.py>` once with retry zero. Simultaneous exact-six modules, task-owned loopback 18080, DDC markers/non-empty cache, immutable user/shared/source/task metadata, and bytecode count zero were first observed at `+115.030s`: `PASS` for readiness.
- D3 immediately posted normal close to the positively identified task UE, then used bounded terminate after 30 seconds; kill was not needed. Task UE/UAgent/CrashReportClient became zero, port 18080 became free, and user UE/shared Zen/source plus task Config/Content/Binaries remained exact: `PASS`. Post-exit Plugins and bytecode cleanliness were `FAIL`: 28 files / 673,559 bytes regenerated at `03:19:03.901-03:19:04.232 UTC`, restoring the blocked `191 / 365,489,946 / 0468b036...` aggregate. The residue was retained and no retry or second cleanup occurred.
- C13D zero-action scan: UAgent launch, product UI, Connect/Discover, MCP/native request, registration/token, dry-run/execute/verify/rollback/replay/mutation, and UE Content input are all `0`: `PASS`. Typecheck, lint, test, and build are `SKIPPED_NOT_APPLICABLE` because C13D prohibited code/test/build changes.
- C13E added `scripts/mvp15-python-cache-contract.json` plus a read-only validator and 17-test synthetic matrix. The retained-copy command reported full `191 / 365,489,946 / 0468b036...`, business `163 / 364,816,387 / 550ca685...`, cache `28 / 673,559 / b1e57b7a...`, and exact D0/D3 cache size/SHA. Those inventory facts are retained, but supervisor review found that failed native `realpath` inspection is swallowed as safe and header error paths still return `valid: true`; the validator acceptance result is `NEEDS_FIX`.
- C13E executed one task-owned UE launch with retry zero and no live heavy worker. Readiness was first simultaneous at `+94.338s`; user UE/shared Zen/source/task metadata stayed stable. Normal close was followed by bounded terminate after 30 seconds, kill was not needed, and task UE/UAgent/CrashReportClient plus port 18080 were zero. The task-local DDC changed only as expected for the launch. UAgent/product UI/Connect/Discover/MCP/native/registration/token/dry-run/execute/verify/rollback/replay/mutation actions and UE Content input were all zero.
- C13E mechanical targeted commands passed: Node syntax checks, 17/17 existing cache-surface tests, retained-copy validator, workspace lint, and the side-effect scan at 300 files / 3,883 allowed / 0 blocked / 925 review. Code review failed because the test matrix omitted native-realpath-error and invalid-header `valid` semantics; C13E1 was issued to add those negative cases. Product TypeScript/Rust tests and builds remained `SKIPPED_NOT_APPLICABLE` for that standalone validator change.
- C13E1 syntax checks and the expanded Node matrix pass 23/23. Direct negative cases prove injected production native-realpath `AccessDenied` yields `ok:false`, `PATH_INSPECTION_FAILED`, and nonzero runner exit without a safe classification; magic, reserved/hash flags/kind, and isolated source-size metadata mismatches each yield `ok:false`, `header.valid:false`, and nonzero CLI exit. The valid fixture keeps all 28 `header.valid:true`.
- The fresh C13E1 retained-copy command initially returned the expected `PATH_INSPECTION_FAILED` inside the restricted execution sandbox because native `realpath` of a restricted ancestor was denied. The identical read-only command was rerun in the approved host context and passed with `ok:true`, `classificationComplete:true`, exact full/business/cache `191 / 163 / 28`, and empty errors/unclassified. The 28-entry path/size/SHA/mtime comparison was identical before and after. UE/UAgent/Zen/product/MCP/native/mutation launches or actions were all zero.
- Across C12-C13E there is still no current product UI action, Connect/Discover, MCP endpoint request, direct native request, registration/token, dry-run, execute, verify, rollback, replay, or asset mutation evidence. Launch readiness is not a product smoke.

## Pending Product-UI Ledger

The later separately authorized product-UI ledger must record a redacted
implementation baseline, the plugin identity from
[the plugin baseline](mvp15-ue-mcp-plugin-baseline.md), UE version, live contract
fingerprint, authoritative root/observation provenance, native gate state, five
forward guards/calls/results, four inverse guards/calls/results, source and
Content evidence, cross-token-TTL rollback, replay five-channel delta, and
process ownership. It is not part of the Rework 7 source-checkpoint evidence.

Separate negative ledgers must record:

- pre-confirmTrust registration rejection with token/MCP/Content delta zero;
- native gate OFF with UI gate ON rejection and token/MCP/Content delta zero;
- stopped observation registration rejection and token/MCP/Content delta zero;
- task-owned process exit rejection before MCP, or an honest `BLOCKED_BY_ENVIRONMENT` result when no task-owned UE process exists.

## Current Progression

This is not final MVP15 acceptance. The C14/C14A fingerprint
authority/redaction implementation is historical predecessor evidence at
verified commit `37c29cbc7961218bfd71d1809178359952a75e18`; its controlled
request did not reach discovery and provided no schema evidence. Independently,
the mapping audit could not connect the active unsigned bytes to the different
signed sibling set. Rework 7 retained D0/build/UE and command ledgers address the
authority, binding, creation-identity, Rust-isolation, process-ledger, and
implementation findings as validated evidence. Rework 8 corrects the
documentation/report facts only. No fresh product-UI mutation
lifecycle, authoritative official plugin mapping, or final installed-build live
descriptor fingerprint exists. Rework 7 is `NEEDS_FIX`; Rework 8 is `IN_PROGRESS`;
source-checkpoint acceptance is `BLOCKED` on
`PENDING_SUPERVISOR_CHECKPOINT`, and Ready for next stage remains `NO`.
