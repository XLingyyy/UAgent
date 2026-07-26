# MVP15 Acceptance - Native Authority Binding Rework

Current stage: **MVP15D - UAgent UE Companion Plugin Source Checkpoint Complete**.

Previous task
`TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-8` has
supervisor verdict `NEEDS_FIX` because this document recorded a stale retained
build-manifest file SHA-256, while code, retained evidence, and automated
implementation gates passed validation. Current task
`TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-9` and the
D0-D12 source checkpoint are `COMPLETE`. Ready for the next MVP stage remains
`NO` because G13/G16 and 15A-15C remain separately gated.
The retained Rework 7 D0, build, and UE roots close
`BLOCKED_BY_EVIDENCE_RETENTION`. D13, 15A, 15B, and 15C remain prohibited.
Verified implementation/content checkpoint
`b1c4e4a4b567d5018c0d0fa7fa1769a26e70f66e` is published with the Rework 9
documentation closeout checkpoint on `main`.

## MVP15D Current Gate Override

| Gate    | Requirement                                                                                                                     | Status  | Evidence                                                                                                                                                                                      | Open item                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| D0      | Four real product-adapter registration/tool-search combinations, Refresh/reconnect/renderer restart stale retraction, and ADR selection. | COMPLETE | Retained D0 `external/mvp15d-rework7-d0-20260726_190100` validates four combinations, 129 indexed artifacts, zero mutation, and Direct; transcript index `b87e0a8...` and route decision `3fee196...`. | None for source checkpoint. |
| D1-D4   | Independent plugin skeleton, task-only build manifest contract, companion identity, and exact-six registration selected by D0.      | COMPLETE | Retained build/source/manifest bundle `external/mvp15d-rework7-build-20260726_203000` has 60 files total (59 inventory-tracked payload files plus `inventory.json`) and validates byte equality, manifest self-hash, compiled modules, and zero closeout residuals. | Final clean 15A package identity remains later, separately authorized work. |
| D5-D8   | Exact run-root policy, five-operation dry-run, native binding, execution, ownership ledger, and inverse rollback.               | COMPLETE | Rework 7 preserves the canonical tuple, atomic create-to-identity ownership, partial/unknown-effect handling, native retraction, and run-root cleanup; UE records `48/48`, unchanged Content, and zero residuals. | None for source checkpoint. |
| D9-D12  | Provenance/fingerprint/product status UI and automated security scan.                                                           | COMPLETE | Two workspace-test processes pass at shared 33 / MCP 46 / runtime 825 / desktop 725 + 3 skipped; ten default Cargo runs and serial pass at 154+2; tooling is `23/23`, build-bundle `10/10`, side-effect blocked count zero. | Historical supervisor exit `134` is retained as a residual process-stability fact. |
| 15A-15C | Clean build/install/load, product-adapter live fingerprint, and fresh UI lifecycle.                                             | BLOCKED | Not run. D13 and 15A/15B/15C remain prohibited pending separate authorization.                                                                                                                 | Source checkpoint is complete; continue only after separate authorization.                                                     |

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
| G11 side-effect scan                  | All legacy and five authority-bypass categories have zero blocked findings.                                                       | IMPLEMENTED    | Supervisor read-only scan exits 0 at 1,039 files / 4,639 allowed / 0 blocked / 1,655 review findings. | None for source checkpoint. |
| G12 full automated verification       | Typecheck, lint, package/workspace tests, web build, Rust fmt/check/tests, and scan pass.                                         | IMPLEMENTED    | Typecheck/lint/build exit 0; two workspace tests pass at shared 33, MCP 46, runtime 825, desktop 725 passed / 3 skipped. Ordinary and serial Cargo each record 154 library plus 2 bridge tests; combined evidence tooling is `33/33`. | Historical supervisor exit `134` remains recorded as a residual process-stability fact. |

## Current Progression Gates

| Gate                                         | Requirement                                                                                                                        | Current status | Current evidence                                                                                                                                     | Open item                                                                                                                          |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| G13 real UE smoke result                     | Complete a fresh product-UI dry-run, execute, verify, rollback, replay, stop, and ownership lifecycle plus negative smokes.        | BLOCKED        | No current product mutation is authorized.                                                                                                           | The separately authorized product-UI lifecycle remains later work after source checkpoint.                                         |
| G14 documentation consistency                | Public current-state documents agree and preserve historical evidence.                                                             | COMPLETE       | Supervisor review confirms the corrected retained manifest SHA, exact recomputed evidence facts, current-state alignment, stale-state scan, and historical labels. | None. |
| G15 checkpoint integrity                     | Supervisor records content checkpoint, SHA backfill closeout, and push.                                                            | COMPLETE       | Verified implementation commit `b1c4e4a4b567d5018c0d0fa7fa1769a26e70f66e` and the Rework 9 documentation closeout checkpoint are published together on `main`. | None. |
| G16 authority provenance and plugin baseline | Native root/observation/gate provenance is proven and the exact companion build and six-tool contract are reproducibly identified. | PARTIAL        | Rework 7 D0/build/UE evidence covers readiness, renderer reconstruction and retraction, canonical binding, physical identity, and process closeout. | Final clean installed/loaded 15A package identity and product lifecycle remain later-stage work. |

## Current Source-checkpoint Posture

- Previous Rework 8 task: `NEEDS_FIX` because its current acceptance manifest
  file SHA conflicted with retained evidence and other current documents.
- Current Rework 9 task and source-checkpoint acceptance: `COMPLETE`. Ready for
  the next MVP stage remains `NO` because G13/G16 and 15A-15C remain gated.
- Durable D0: `external/mvp15d-rework7-d0-20260726_190100`, four sessions, 129
  indexed artifacts, 130 files including `hashes.json`, mutation zero, Direct;
  transcript index
  `b87e0a8a4d685b0cbddd55c8ea5ed4e944b9feba7aaa9d9176e23e2dfdeb0f99`,
  hashes file
  `d393ce454385b32d07fa1a08ac7b8f39f897052dc3ff68daf785fc60d8077106`.
- Durable build: `external/mvp15d-rework7-build-20260726_203000`, 60 files total
  (59 inventory-tracked payload files plus `inventory.json`),
  bundle `ef86e59c05068f9610050a2afa44bf3237d3fd78e82262cf6d3be6660223420b`,
  manifest file
  `236f1da71961fd697e81ad0a6d9f53f82076b71019e74400eed8b95f0d69ac84`,
  source bundle
  `93b3bb310ef17b18adb85b413360890648a9ab614301cedbf19ba81fb42146f6`,
  and process/port/marker residual zero.
- Durable UE: `external/mvp15d-rework7-ue-20260726_190100`, five sessions,
  `48/48`, six processes per ledger, residual zero, unchanged empty Content,
  capture `8794de55d0bc3444015116918b92e957070e684ac014f7f9551c07762af1cbb8`.
- Canonical C++/shared/compiled binding fixture: 4,865 bytes, SHA-256
  `771168ec8b6e7215672a4d839fa675d88f9207876e2c51513b26d6c58da56a1b`.
- Historical Rework 4 supervisor verdict: `NEEDS_FIX`.
- Historical Rework 3 supervisor verdict: `NEEDS_FIX`.
- Historical 09Z result: `PASS_REAL_SMOKE` for the old happy path only.
- Rework 5 and Rework 6 evidence remain historical context only; neither is
  substituted for the retained Rework 7 ledgers.
- `BLOCKED_BY_EVIDENCE_RETENTION` is closed. No source-checkpoint blocker
  remains.
- Verified implementation/content checkpoint
  `b1c4e4a4b567d5018c0d0fa7fa1769a26e70f66e` is published with the Rework 9
  documentation closeout checkpoint.
- UI scope: `AssetMutationPanel` and `ConfigSettings` contain inherited visible
  Companion copy/test changes. Rework 7 and documentation-only Rework 8/Rework 9
  did not edit those files or the five TitleBar-coupled files.
- Historical real-environment evidence: C14 preserved exact `191 / 163 / 28` full/business/cache aggregates and the identical 28-entry path/size/SHA/mtime manifest before and after its task-owned UE run. Exact modules and the task-owned listener were observed; task-bound processes and listener ownership returned to zero. The product adapter sent one initialization request, then encountered a pre-discovery transport/environment failure. It produced no descriptor/schema decision. All asset and lifecycle action counts are zero; this is not a product-smoke pass. C14A did not start UE/UAgent or connect to live MCP.
- Current known schema/provenance facts: the active project-local bytes and UE build remain reproducibly identified. Signed Epic sibling binaries do not match those active hashes; the missing authoritative mapping remains `BLOCKED_BY_MCP_SCHEMA`. The historical C14A publication implementation does not establish a live descriptor set, accepted SHA, or per-tool summary.
- Historical predecessor checkpoint: supervisor review accepted C14/C14A verified implementation commit `37c29cbc7961218bfd71d1809178359952a75e18`; its SHA-backfill documentation closeout is published in that historical task checkpoint. It is not current MVP15D checkpoint evidence. Local workflow, private material, and `external/**` remain excluded.
- Ready for next stage: `NO`.
- A dirty implementation worktree is not the current blocker. A clean source commit/tree
  is required only for later final 15A packaging; D13, 15A, 15B, and 15C remain
  prohibited.

Automated tests and task-owned D0/UE evidence do not substitute for the
separately authorized product-UI lifecycle. The D0-D12 source checkpoint is
accepted; MVP15 is not ready for the next stage until later G13/G16 evidence and
a supervisor checkpoint record that change.
