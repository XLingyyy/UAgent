# MVP15 Final Verification

## Current State

- Public stage: `MVP15 - Native Authority Binding Rework`.
- Acceptance: `BLOCKED`.
- Current fresh product-UI mutation smoke: not run.
- Current environment result: C13E produced valid one-launch readiness evidence at `+94.338s`, exact pre/post business/cache inventories, and clean process/port closeout. C13E1 then repaired the supervisor-identified validator defects without another UE launch: native inspection errors now fail with `PATH_INSPECTION_FAILED`, all invalid header branches report `header.valid: false`, the expanded matrix passes 23/23, and the retained copy revalidates read-only at exact `191 / 163 / 28` with zero cache size/SHA/mtime change. Supervisor review accepted this containment result at verified implementation commit `12159b9edd652bd8d8679e28415029ce3917f04d`; it is readiness evidence, not a product-smoke pass.
- Current MCP result: `BLOCKED_BY_MCP_SCHEMA` until the identified project-local bytes have an authoritative official source/artifact mapping and product-adapter discovery publishes a stable live exact-six descriptor fingerprint.
- Ready for next stage: `NO`.

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

## Fresh Automated Ledger - 2026-07-18

| Command | Result | Fresh summary |
| --- | --- | --- |
| `git status --short` / `git diff --name-only` / `git diff --stat` | PASS | Task changes plus the pre-existing untracked `external/`; workflow/private files remain excluded. |
| `git diff --check` | PASS | No whitespace errors; Windows LF/CRLF notices only. |
| `pnpm typecheck` | PASS | All four workspaces. |
| `pnpm lint` | PASS | ESLint completed with no errors. |
| `pnpm --filter @uagent/shared test` | PASS | 7 files / 32 tests. |
| `pnpm --filter @uagent/runtime test` | PASS | 54 files / 789 tests, including A08 settlement, prior-ownership recovery, token-bound registration cleanup, and stale-run retirement. |
| `pnpm --filter @uagent/mcp-client test` | PASS | 8 files / 46 tests. |
| `pnpm --filter @uagent/desktop test` | PASS | 41 files / 671 tests passed; 2 existing live/preflight tests skipped; four deferred facade-discovery race cases pass; existing React `act(...)` warnings remain non-failing. |
| `pnpm test` | PASS | Shared 32, MCP 46, runtime 789, desktop 671; 2 existing desktop skips. |
| `pnpm --filter @uagent/desktop web:build` | PASS | 255 modules transformed; existing chunk-size advisory only. |
| `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check` | PASS | 11A applied only rustfmt layout to the four explicitly authorized debt files and formatted task-touched Rust sources. |
| `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml` | PASS | Native crate compiles. |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml asset_mutation -- --test-threads=1` | PASS | 24/24. |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml ue_editor_process -- --test-threads=1` | PASS | 14/14. |
| `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1` | PASS | 139/139, serial. |
| `node scripts/side-effect-scan.mjs` | PASS | Final documentation-synchronized 11A run: 299 files / 3,813 allowed / 0 blocked / 923 review; five authority categories each report 0 blocked. |

The first desktop run exposed two stale documentation assertions after the C11 rewrite. The still-valid sandbox sentence and MCP connection/discovery sequence were restored in the public docs, after which both the desktop suite and full workspace suite passed. No test was weakened to hide the mismatch.

The native hardening also detects ordinary same-path root replacement and PID reuse by binding platform object/process metadata. Without a new Windows API dependency, directory creation time is the available best-effort Windows identity rather than a volume/file id; preserved or privileged timestamp replacement and extremely fast same-resolution PID reuse remain explicit open risks. Authority is revalidated a second time immediately before native acceptance, but no userspace check can eliminate a process exit after the check and before the external call.

The five authority scan ids are `mvp15-native-trust-authority-boundary`, `mvp15-observation-authority-boundary`, `mvp15-native-gate-boundary`, `mvp15-transaction-liveness-boundary`, and `mvp15-pretrust-root-ref-boundary`.

## C13E1 Supervisor Closeout Ledger - 2026-07-19

- Verified implementation commit: `12159b9edd652bd8d8679e28415029ce3917f04d`.
- `node --test scripts/mvp15-python-cache-surface.test.mjs`: `PASS`, 23/23.
- Retained-copy validator in the approved read-only host context: `PASS`, `ok:true`, `classificationComplete:true`, exact full/business/cache `191 / 163 / 28`, zero errors/unclassified, and all 28 headers valid. Pre/post cache path/size/SHA/mtime values were identical. The restricted sandbox run correctly failed closed with `PATH_INSPECTION_FAILED` rather than classifying an uninspectable ancestor as safe.
- `pnpm typecheck`, sequential `pnpm lint`, `pnpm test`, `pnpm --filter @uagent/desktop web:build`, `cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check`, `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`, and `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1`: `PASS`. Workspace summary remains shared 32, MCP 46, runtime 789, desktop 671 passed with 2 existing skips, and Rust 139/139.
- `node scripts/side-effect-scan.mjs`: `PASS`, 300 files / 3,891 allowed / 0 blocked / 925 review.
- `git diff --check`: `PASS`, with Windows LF/CRLF notices only. Full diff and current-state documents were inspected; `external/`, `.agent-bus/**`, private supervisor material, evidence, logs, and build output were excluded from the checkpoint.
- Side effects during C13E1 repair/review: no UE, UAgent product, Zen, MCP, native, registration/token, mutation, or product-UI action was launched or invoked.

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
- The fresh C13E1 retained-copy command initially returned the expected `PATH_INSPECTION_FAILED` inside the restricted execution sandbox because native `realpath` of the `C:\Users\admin` ancestor was denied. The identical read-only command was rerun in the approved host context and passed with `ok:true`, `classificationComplete:true`, exact full/business/cache `191 / 163 / 28`, and empty errors/unclassified. The 28-entry path/size/SHA/mtime comparison was identical before and after. UE/UAgent/Zen/product/MCP/native/mutation launches or actions were all zero.
- Across C12-C13E there is still no current product UI action, Connect/Discover, MCP endpoint request, direct native request, registration/token, dry-run, execute, verify, rollback, replay, or asset mutation evidence. Launch readiness is not a product smoke.

## Pending Product-UI Ledger

The fresh ledger must record a redacted implementation baseline, the plugin identity from [the plugin baseline](mvp15-ue-mcp-plugin-baseline.md), UE version, live contract fingerprint, authoritative root/observation provenance, native gate state, five forward guards/calls/results, four inverse guards/calls/results, source and Content evidence, cross-token-TTL rollback, replay five-channel delta, and process ownership.

Separate negative ledgers must record:

- pre-confirmTrust registration rejection with token/MCP/Content delta zero;
- native gate OFF with UI gate ON rejection and token/MCP/Content delta zero;
- stopped observation registration rejection and token/MCP/Content delta zero;
- task-owned process exit rejection before MCP, or an honest `BLOCKED_BY_ENVIRONMENT` result when no task-owned UE process exists.

## Current Progression

This is not final MVP15 acceptance. The 11A code and automated gates pass, and C12-C13E1 establish progressively stronger real build, module, task-copy, DDC, process, listener, and exact fail-closed dual-aggregate inventory facts. C13E1 is supervisor-accepted and checkpointed, but no fresh product-UI mutation lifecycle, authoritative official plugin mapping, or live descriptor fingerprint exists. Acceptance remains `BLOCKED` and ready for next stage `NO`.
