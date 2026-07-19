# MVP15 Acceptance - Native Authority Binding Rework

Current stage: **MVP15 - Native Authority Binding Rework**.

Current acceptance: `BLOCKED`. Ready for next stage: `NO`. The historical MVP15C / 09Z run `ui-mrpovp9e-1` remains `PASS_REAL_SMOKE` for the former happy path, but it does not establish native trusted-root provenance, live observation/process authority, or an independent native feature gate.

## Acceptance Gates

| Gate | Requirement | Current status | Current evidence | Open item |
| --- | --- | --- | --- | --- |
| G0 baseline frozen | Preserve the narrow sandbox scope and reopen public status before implementation. | COMPLETE | Historical implementation and 09Z ledger are retained, while current status is explicitly downgraded and the narrow scope remains frozen. | None. |
| G1 dry-run binding | Bind all five planned forward operations and exact arguments before approval. | PARTIAL | Fresh runtime regression passes 789/789, including stateful MCP-binding drift settlement and recovery. | Fresh real plugin evidence is still required. |
| G2 wrapper-only blocked | Incomplete or wrapper-only discovery must fail closed. | PARTIAL | Existing classifier coverage is retained. | Fresh live fingerprint is missing. |
| G3 sandbox path boundary | Writes remain below the exact registered run root. | PARTIAL | Historical policy and tests plus the complete 11A automated regression exist. | Fresh product-UI real smoke remains required. |
| G4 dry-run result | Produce affected assets, rollback plan, external evidence queries, and hashes without mutation. | PARTIAL | Historical 09Z dry-run evidence exists. | A fresh product-UI dry-run has not been executed. |
| G5 approval registry / replay blocked | Registration resolves authoritative native root and observation facts; token is one-time and replay remains recorded-only. | BLOCKED | Native 24/24 asset tests prove token-bound cancellation only for unstarted/no-ownership records; 11A runtime tests prove stale-run cleanup. | Fresh real authority evidence is required. |
| G6 native guard | Every execute/rollback guard resolves registration-owned authority and rechecks live process/project/root/session/PID before MCP. | BLOCKED | Native UE process 14/14 proves atomic session/process renewal, sticky stop, replacement/removal rejection, and one-deadline success; runtime proves accepted-guard no-side-effect settlement and rollback recovery. | Fresh negative and lifecycle product ledgers remain required. |
| G7 exact tool execution evidence | Five forward results are strict and side-effect-aware. | PARTIAL | Historical 09Z recorded five exact dispatches. | Repeat against the identified plugin build. |
| G8 rollback ownership | Only exact owned effects receive inverse rollback. | PARTIAL | Historical automated and 09Z evidence exists. | Repeat after recovery-lease changes. |
| G9 evidence authority | Active evidence revalidates native root/path authority; terminal evidence remains read-only. | BLOCKED | Historical terminal evidence does not prove revoked-root rejection. | Fresh authority and path tests required. |
| G10 replay zero delta | Replay must not call native, MCP, provider, verify, or rollback paths. | PARTIAL | Historical replay delta is `0/0/0/0/0`. | Repeat in the fresh run. |
| G11 side-effect scan | All legacy and five authority-bypass categories have zero blocked findings. | COMPLETE | Supervisor-inspected C13E1 closeout scan: 300 files, 3,891 allowed, 0 blocked, 925 review; all five authority categories remain at 0 blocked. | None for this checkpoint; rerun after future product changes. |
| G12 full automated verification | Typecheck, lint, package/workspace tests, web build, Rust fmt/check/tests, and scan pass. | COMPLETE | 2026-07-19 supervisor run: typecheck, lint, shared 32, runtime 789, MCP 46, desktop 671 with 2 existing skips, web build, exact crate fmt/check, Rust 139/139 serial tests, diff check, cache validator 23/23, and side-effect scan all pass. | Automated gate is green; this does not replace G13/G16 real-environment evidence. |
| G13 real UE smoke result | Complete a fresh product-UI dry-run, execute, verify, rollback, replay, stop, and ownership lifecycle plus negative smokes. | BLOCKED | C13E reached task-owned readiness at `+94.338s` with launch/retry `1 / 0` and preserved `163` business plus `28` cache files. C13E1 repaired the validator, passed 23/23 targeted tests, and revalidated the retained copy read-only without another UE launch or cache metadata change. | The complete product-UI happy/negative lifecycle is still required. Readiness and validator evidence are not a product smoke. |
| G14 documentation consistency | Public current-state documents agree and preserve historical evidence. | COMPLETE | Supervisor inspected the implementation report, full diff, current-state documents, and stale-status scan; C13E1 is accepted while C13E `NEEDS_FIX` and C13D remain explicitly historical. | None for this checkpoint. |
| G15 checkpoint integrity | Supervisor records content checkpoint, SHA backfill closeout, and push. | BLOCKED | Verified implementation commit `12159b9b5eb31829208df5c01c7fc97f157398c2` and documentation closeout commit `dc118b276794a4141a308aaaa17e8b289e374a55` exist locally, but three HTTPS push attempts failed at the GitHub `schannel` TLS handshake. | Restore GitHub connectivity, push the complete local checkpoint, verify zero local/remote divergence, then replace this blocker with `COMPLETE`. |
| G16 authority provenance and plugin baseline | Native root/observation/gate provenance is proven and the exact official plugin build and six-tool contract are reproducibly identified. | BLOCKED | UE `5.8.0` promoted `55116800`, descriptor-reported `Unreal MCP` `1.0`, BuildId, and six project-local module hashes are recorded. | An authoritative official source/artifact mapping and a product-adapter-published live exact-six descriptor fingerprint remain missing; module hashes alone do not close provenance. |

## Current Verification Posture

- Acceptance: `BLOCKED`.
- Historical 09Z result: `PASS_REAL_SMOKE` for the old happy path only.
- Current real-environment evidence: C13E warm launch readiness was observed at `+94.338s`; exact 163-file business and 28-file cache inventories remained stable through closeout, with no product/MCP/native/mutation action. C13E1 now fails closed on native inspection errors, reports truthful per-header validity, passes 23/23 targeted tests, and reproduces the retained `191 / 163 / 28` result read-only with zero cache metadata change. Supervisor review accepted this containment evidence at verified implementation commit `12159b9b5eb31829208df5c01c7fc97f157398c2`; it is not a product-smoke pass.
- Current schema/provenance evidence: the active project-local bytes and UE build are reproducibly identified, but official source/artifact mapping and the product-adapter live descriptor fingerprint remain `BLOCKED_BY_MCP_SCHEMA`.
- Current checkpoint evidence: content and documentation review passed locally, but `origin/main` has not received the checkpoint because the GitHub TLS handshake failed repeatedly.
- Ready for next stage: `NO`.

Automated tests cannot substitute for the fresh real product-UI lifecycle. C13E1 closes its validator and checkpoint scope only; MVP15 remains `BLOCKED` until G13 and G16 obtain their required evidence and a later supervisor checkpoint records that stage change.
