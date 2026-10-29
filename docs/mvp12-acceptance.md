# MVP12 Acceptance - Controlled UE Text Repair Loop

## Capability requirements

| Contract |
| --- |
| README and roadmap updated; side-effect scan keeps old `execute_terminal_command` blocked. |
| `packages/shared/src/mvp12-change-set.ts`, shared tests. |
| `packages/runtime/src/mvp12-change-set.ts`, runtime tests. |
| `apps/desktop/src-tauri/src/text_mutation.rs`, Rust tests. |
| runtime and Rust stale hash tests. |
| deterministic recipes for plugin/config/target/build/manual/build-locate paths. |
| ChangeSet service plus desktop `mvp12` runtime slice/actions. |
| Changes, Diagnostics, Settings, ProjectTree marker surfaces. |
| Verification result model and allowlisted command summaries; no automatic run. |
| backup snapshot and hash-checked rollback in runtime/native tests. |
| 8 MVP12 categories in `scripts/side-effect-scan.mjs`. |
| shared/runtime/desktop/native tests; runtime scenario matrix has 24 scenarios / 96 assertions. |

## Approval safety

- Approval validation rejects malformed windows where `expiresAt <= approvedAt` and genuinely expired approvals where current time is greater than `expiresAt`.
- ChangeSet approvals bind both `beforeHashes` and `afterHashes` per operation, so apply-time replacement of after content/hash is blocked before writing.

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
