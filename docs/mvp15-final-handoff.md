# MVP15 Native Authority Binding Rework Handoff

Current stage: **MVP15 - Native Authority Binding Rework**. Acceptance is `BLOCKED`; ready for next stage is `NO`.

## Delivered Historical Baseline

- The historical MVP15C / 09Z product-UI lifecycle `ui-mrpovp9e-1` remains `PASS_REAL_SMOKE` for the former happy path only.
- The narrow write scope remains `/Game/UAgentSandbox/<run-id>/**`; `/Game/Test01` remains read-only.
- Exact six-tool allowlisting, strict result parsing, inverse ownership, read-only evidence, redaction, and recorded-only replay remain required capabilities.

## Delivered C11/11A Implementation

- Native trusted-root resolver and revocation-aware root authority.
- Live observation/process binding at registration and before every execute/rollback MCP call.
- Strict default-off `UAGENT_ENABLE_ASSET_MUTATION=1` native gate.
- Maximum 60-second first-execute token plus absolute 15-minute forward and 20-minute recovery deadlines.
- Authority-revalidated active evidence and path-bounded read-only terminal evidence.
- Post-confirmTrust-only mutation root mapping.
- A01-A21 automated coverage and five structural side-effect scan categories.

Fresh 11A automated evidence includes TypeScript typecheck/lint, shared 32, runtime 789, MCP 46, desktop 671 with 2 existing skips, full workspace tests, web build, exact cargo fmt/check, native 139/139 serial tests, diff check, and the final side-effect scan at 299 files / 3,813 allowed / 0 blocked / 923 review. Deterministic tests cover atomic observation renewal, accepted-guard settlement, token-bound unstarted-registration retirement, prior-ownership rollback recovery, and stale facade-discovery publication.

## Delivered C12-C13E1 Environment Evidence

- C12 reproducibly identified UE `5.8.0` promoted `55116800`, descriptor-reported `Unreal MCP` `1.0`, BuildId, and six project-local module hashes.
- C13 created and preserved a task-owned project copy. C13B proved child-only task-local DDC isolation and task-owned module/listener startup, although cold-cache listener readiness was about `+602.9s`.
- C13C observed the same warm launch readiness at `+33.408s` with one launch, zero retries, five-second light polls, 30-second heavy snapshots, unchanged user UE/shared Zen/source metadata, and zero product/MCP/native/mutation actions.
- C13C did not close cleanly: task Plugins gained 28 generated Python bytecode cache files. The retained copy and evidence were preserved without unauthorized cleanup.
- C13D exactly removed the C13C residue, restored the 163-file Plugins baseline, and used one child-only bytecode-suppressed launch with zero retries and no live heavy worker. Readiness was observed at `+115.030s`; immediate closeout then regenerated the same 28 files, so `PYTHONDONTWRITEBYTECODE=1` did not contain the embedded UE Python runtime. The second-generation residue was preserved and the result is `BLOCKED_BY_ENVIRONMENT` / `BYTECODE_SUPPRESSION_FAILED`.
- C13E produced a narrow dual-aggregate candidate and valid one-launch ledger: exact 163-file business state plus exact 28-file cache state, readiness at `+94.338s`, matching pre/post inventories, clean process/port closeout, and zero product/MCP/native/mutation actions. Supervisor review did not accept its validator because native `realpath` errors fail open and header mismatch results can still claim `valid: true`.
- C13E1 repaired that validator without launching UE or touching the retained cache: native `lstat`/`realpath` errors now produce `PATH_INSPECTION_FAILED` and a nonzero exit, every failed header branch reports `valid: false`, the expanded matrix passes 23/23, and a fresh read-only retained-copy run remains exact at `191 = 163 + 28` with zero size/SHA/mtime change. Supervisor review accepted the result at verified implementation commit `12159b9edd652bd8d8679e28415029ce3917f04d`.

## Pending Acceptance Evidence

- Authoritative official source/artifact mapping for the identified project-local plugin bytes and a product-adapter live exact six-tool fingerprint.
- Fresh product-UI happy-path and negative ledgers.

## Current Blockers

- `BLOCKED_BY_MCP_SCHEMA`: project-local descriptor/module bytes are identified, but their authoritative official source/artifact mapping and the live product-adapter canonical contract fingerprint are not recorded.
- `BLOCKED_BY_NETWORK`: the verified implementation and documentation closeout commits exist locally, but three `origin/main` push attempts failed at the GitHub `schannel` TLS handshake.

## Residual Risks

- Real UE/MCP behavior can vary by engine patch, project, plugin build, and machine.
- A failed real mutation may leave owned residue that only the bounded product recovery path may address.
- Schema or plugin upgrades invalidate the recorded contract fingerprint and require complete rediscovery, tests, and real smoke.

## Still Prohibited

- Non-sandbox writes, Save All, arbitrary SavePackage, broad/bulk mutation, generic wrapper mutation, provider auto-apply, replay execution, automatic git operations, secret/raw-path disclosure, and manual/broad cleanup.
- Killing or taking over user-owned UE/MCP processes.
- Treating UI/caller root, session, PID, or gate values as native authority.
- Starting MVP16 implementation; only research and planning are allowed.

## Progression Decision

C13E1 content is accepted and its local two-step checkpoint is prepared, but the task cannot receive final `PASS` until the GitHub push succeeds and remote divergence is verified. No progression decision is made for MVP15 because the product-UI lifecycle and plugin provenance/fingerprint blockers also remain. MVP16 implementation stays prohibited; only research and planning are allowed until a later supervisor checkpoint closes G13 and G16 and formally re-accepts MVP15.
