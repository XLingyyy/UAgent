# MVP15 Acceptance - Real UE Sandbox Asset Mutation Pilot

Current stage: **MVP15 - Real UE Sandbox Asset Mutation Pilot (Final Acceptance Complete)**.

Final result: `COMPLETE`. The accepted MVP15C / 09Z run `ui-mrpovp9e-1` produced `PASS_REAL_SMOKE`; remaining MVP15 acceptance blockers are `None`, and progression to the next as-yet-unnamed stage is approved.

## Acceptance Gates

| Gate | Requirement | Status | Evidence | Open Item |
| --- | --- | --- | --- | --- |
| G0 baseline frozen | Preserve the reviewed safety baseline and do not claim completion before real smoke. | COMPLETE | Verified implementation commit `6b7f231e9bdd1e6391f4514af9f77c4556872a5a` is on `origin/main`; the 09Z real product-UI smoke is accepted. | None |
| G1 exact asset tool inventory | Six exact tools expose input, dry-run, rollback, affected-assets, and evidence-query contracts. | COMPLETE | Exact inventory and schema readiness were proven before the accepted five-step dry-run and recorded in `docs/mvp15-manual-smoke.md`. | None |
| G2 wrapper-only blocked | Wrapper-only discovery is not treated as exact-ready. | COMPLETE | Runtime and MCP adapter tests keep incomplete wrapper discovery fail closed; the accepted run used the complete exact facade contract. | None |
| G3 exact-tool facade | Bind fixed toolset, method, and schema versions before internal wrapper dispatch. | COMPLETE | Accepted forward and rollback ledgers contain 5 and 4 exact facade dispatches respectively, with no extra or generic mutation dispatch. | None |
| G4 dry-run result | Produce affected assets, rollback plan, external evidence queries, and hash without mutation. | COMPLETE | 09Z performed exactly one five-operation dry-run; Content remained 256/256 canonical after dry-run. | None |
| G5 approval registry / replay blocked | Native issues and consumes one short-lived unpredictable token bound to the full plan. | COMPLETE | One approve/registration preceded execute; no second registration or token exposure occurred, and replay deltas were all zero. | None |
| G6 native guard | Bind tool, root, observation identity, run, hashes, order, and phase. | COMPLETE | Forward ledger contains 5/5 guards and strict results; rollback ledger contains 4/4, all in the required order. | None |
| G7 exact tool execution evidence | Five real operations return strict, side-effect-aware structured results. | COMPLETE | 09Z recorded exactly 5 guards, 5 strict results, and 5 exact facade dispatches; execute began 12,883 ms after registration. | None |
| G8 external evidence verification | Verify source, target, old paths, and outside-run stability with read-only Content evidence. | COMPLETE | Product reached `verified`; final Content was 256/256 canonical with every mismatch count zero and the source unchanged. | None |
| G9 rollback evidence / source untouched | Roll owned operations back in reverse order and externally verify restoration. | COMPLETE | Rollback recorded 4 guards, 4 strict results, and 4 dispatches in move, rename, duplicate cleanup, create-folder/run-root cleanup order. | None |
| G10 UI status surfaces | Expose lifecycle, registration, blocker, and redacted audit states without raw identity or secrets. | COMPLETE | The accepted product-UI run reached `rolled_back`; raw token, session, PID, credential, and absolute-path patterns were absent from the UI evidence. | None |
| G11 replay no execution | Replay reads recorded summaries and performs no native, MCP, provider, verification, or rollback action. | COMPLETE | Accepted replay delta was native/MCP/provider/verification/rollback `0/0/0/0/0`. | None |
| G12 side-effect scan | Detect prohibited mutation, replay, provider, and raw-evidence paths. | COMPLETE | Supervisor verification: `node scripts/side-effect-scan.mjs` scanned 298 files with 0 blocked and 928 review findings. | None |
| G13 real UE smoke result | Complete one supervisor-controlled product-UI dry-run, execute, verify, rollback, replay inspection, and close lifecycle. | COMPLETE | Fresh run `ui-mrpovp9e-1` is accepted as `PASS_REAL_SMOKE`, with each lifecycle action exactly once and every prohibited path count zero. | None |
| G14 docs finalization | Public documentation records the accepted outcome, evidence, blockers, risks, and handoff consistently. | COMPLETE | README, roadmap, verification, handoff, risk, smoke, prep, architecture, development, and the TitleBar stage badge are aligned in documentation closeout content commit `3fb53fe15980c0a1269865938bf9ee30467cc4a9`; final verification records the fresh closeout gates. | None |
| G15 exact run root / cleanup | Own and remove only the exact registered run root; verify the shared container absent or strictly safe-empty. | COMPLETE | Final exact run root was absent; fixed `Content/UAgentSandbox` was ordinary, non-reparse, and strictly empty. | None |

## Verification Summary

- Verified implementation commit: `6b7f231e9bdd1e6391f4514af9f77c4556872a5a` on `origin/main`.
- Supervisor verification: serial Rust 126/126; runtime 786/786; complete workspace tests shared 32, runtime 786, MCP client 46, desktop 662 passed / 2 skipped; typecheck, lint, desktop web build, cached diff check, and side-effect scan passed.
- Real lifecycle: exactly one Dry-run, Approve/registration, Execute, Verify, Rollback, replay inspection, and Close.
- Timing: registration to Execute 12,883 ms; registration to Rollback 143,015 ms; Rollback click to `rolled_back` 10,785 ms.

## Acceptance Notes

Automated tests do not substitute for a real UE product-UI smoke. That smoke was performed in 09Z and accepted on 2026-07-18. Future changes that affect this boundary must repeat the relevant automated checks and real smoke; the final MVP15 result itself is `COMPLETE`, not a candidate.

The accepted pilot remains intentionally narrow. `COMPLETE` does not enable non-sandbox UE writes, Save All, broad/bulk mutation, generic MCP mutation, provider auto-apply, replay execution, automatic git operations, or raw secret/path disclosure.
