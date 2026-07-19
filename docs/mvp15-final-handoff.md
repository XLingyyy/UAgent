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

## Delivered C14/C14A Fingerprint Implementation

- Deterministic `uagent.mvp15.live-asset-toolset-fingerprint.v1` canonicalization for direct and facade exact-six descriptors, with recursive object-key sorting, array preservation, UTF-8 SHA-256, and no accepted hash on any invalid input.
- Fail-closed coverage for missing, allowlisted duplicate, unexpected/duplicate count, reordered, empty-identity, invalid contract, unsupported/non-JSON, mixed precedence, primitive/non-string/throwing proxy-like input, and every required field/identity change. Blocked publication never echoes raw unexpected names or URL/path/token/credential canaries.
- Desktop publication is bound to the current MCP session and discovery generation. C14A atomically retracts discovery, facade inventory, binding, hash, and canonical byte length before the first reconnect/invalid-endpoint status notification; concurrent/stale completion cannot restore them.
- Fresh TypeScript gates: targeted runtime `92/92`, desktop adapter/UI store `71` passed with 3 opt-in live skips, shared `5/5`; full shared `33`, MCP `46`, runtime `805`, desktop `679` passed with 3 skips; typecheck, sequential lint, web build, diff check, and final side-effect scan 301 files / 3,906 allowed / 0 blocked / 926 review pass. Rust is `SKIPPED_NOT_APPLICABLE` because no Rust file changed.
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

## Pending Acceptance Evidence

- Authoritative official source/artifact mapping for the identified project-local plugin bytes and a successful product-adapter live exact six-tool fingerprint.
- Fresh product-UI happy-path and negative ledgers.

## Current Blockers

- `BLOCKED_BY_MCP_SCHEMA`: project-local descriptor/module bytes are identified and canonical publication is implemented, but authoritative official active-byte mapping is absent.
- Live capture gap: the C14 attempt ended in a pre-discovery transport/environment failure, not a schema rejection, and left no accepted product-adapter fingerprint.
- Product lifecycle gap: the fresh product-UI happy/negative R10 lifecycle has not run.

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

C13E1 content and repository checkpoint remain the prior accepted/published checkpoint. The current C14A implementation, documentation, and report await supervisor review/checkpoint; the implementation Agent did not stage, commit, push, claim review completion, or decide progression. MVP15 remains blocked by the product-UI lifecycle and plugin provenance/live-fingerprint gaps. MVP16 implementation stays prohibited until a later supervisor checkpoint closes G13 and G16 and formally re-accepts MVP15.
