# MVP12 Acceptance - Controlled UE Text Repair Loop

## Gate Evidence

| Gate | Status | Evidence |
| --- | --- | --- |
| G0 baseline | Implemented | README and roadmap updated; side-effect scan keeps old `execute_terminal_command` blocked. |
| G1 shared contracts | Implemented | `packages/shared/src/mvp12-change-set.ts`, shared tests. |
| G2 policy/diff/redaction | Implemented | `packages/runtime/src/mvp12-change-set.ts`, runtime tests. |
| G3 native bridge | Implemented | `apps/desktop/src-tauri/src/text_mutation.rs`, Rust tests. |
| G4 conflict/stale hash | Implemented | runtime and Rust stale hash tests. |
| G5 repair engine | Implemented | deterministic recipes for plugin/config/target/build/manual/build-locate paths. |
| G6 lifecycle/runtime/store | Implemented | ChangeSet service plus desktop `mvp12` runtime slice/actions. |
| G7 UI integration | Implemented | Changes, Diagnostics, Settings, ProjectTree marker surfaces. |
| G8 verification loop | Implemented | Verification result model and allowlisted command summaries; no automatic run. |
| G9 rollback/recovery | Implemented | backup snapshot and hash-checked rollback in runtime/native tests. |
| G10 side-effect scan | Implemented | 8 MVP12 categories in `scripts/side-effect-scan.mjs`. |
| G11 tests/matrix | Implemented | shared/runtime/desktop/native tests; runtime scenario matrix has 24 scenarios / 96 assertions. |
| G12 manual smoke | Documented | `docs/mvp12-manual-smoke.md`; native UI smoke remains for supervisor local复核. |
| G13-G15 docs/handoff | Implemented | MVP12 prep, acceptance, risk, smoke, baseline, verification, final handoff docs. |

## Approval Safety Rework

- Approval validation rejects malformed windows where `expiresAt <= approvedAt` and genuinely expired approvals where current time is greater than `expiresAt`.
- ChangeSet approvals bind both `beforeHashes` and `afterHashes` per operation, so apply-time replacement of after content/hash is blocked before writing.
- Desktop approval creation uses the native preview-bound operation hashes and keeps approval tokens out of serialized UI state.

## ChangeSet v2 Lifecycle

`draft -> previewed -> approval_required -> approved/rejected -> applying -> applied -> verifying -> verified/failed -> rollback_available -> rolled_back/discarded`

The current implementation records preview, apply, verify, rollback summaries and redacts raw roots, home paths, secrets, and approval tokens from diff/evidence/session-facing payloads.

## Repair Recipes

- `R-BUILD-DEPENDENCY`: targeted `.Build.cs` dependency removal/addition proposal.
- `R-TARGET-MODULE`: targeted `ExtraModuleNames` removal/replacement proposal.
- `R-PLUGIN-DISABLE`: sets matching `.uproject` plugin `Enabled` to `false`.
- `R-CONFIG-REDACT`: replaces sensitive config values.
- `R-DESCRIPTOR-MALFORMED`: manual note only.
- `R-BUILD-ERROR-LOCATE`: affected-file location only.
