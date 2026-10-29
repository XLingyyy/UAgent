# UE Asset Lifecycle Verification

This guide specifies repeatable checks and does not grant permission to call a live provider, modify a project, or stop an unowned process.

## Preconditions

- Use a disposable, recoverable, or version-controlled UE project. Do not use an irreplaceable project.
- Record redacted Content aggregate, source size/SHA-256, outside-run aggregate, exact run-root absence, and fixed container state.
- Record ownership for UAgent, UE, MCP/listener processes, and relevant local ports without publishing raw paths, PIDs, tokens, endpoints containing credentials, or secrets.
- For a task-owned readiness launch, use only a verified retained/disposable copy and a writable cache inside that copy. Pass both `-ddc=NoZenLocalFallback` and `-LocalDataCachePath=<task-ddc>`, and set `UE-LocalDataCachePath` only for the task UE child. Do not change permanent environment variables or control shared Zen. `PYTHONDONTWRITEBYTECODE=1` is not a pass condition: The embedded runtime does not reliably honor it for this cache surface.
- Before launch and after task UE exit, run `node scripts/mvp15-python-cache-surface.mjs --plugins-root <absolute-task-copy-Plugins> --contract scripts/mvp15-python-cache-contract.json --cache-state generated --json`. Require both the exact 163-file business aggregate and the exact 28-file cache aggregate, with zero unclassified entries, link/reparse entries, missing pairs, or header/type violations. This Route A contract accepts only the listed cache paths; it does not authorize arbitrary `.pyc`, arbitrary `__pycache__`, or other Plugins writes.
- Keep readiness observation separate from product smoke: poll lightweight process/module/port/log/immutable-state and contracted cache facts every five seconds; do not run full DDC/business workers while UE is live. On first-ready or failure, immediately close the positively identified task UE, then run full DDC/business aggregates after exit. Fail closed on any business-tree or cache-contract delta and retain unknown/new residue. Do not Connect, Discover, call MCP/native routes, or mutate assets during this readiness-only phase.
- Start a task-owned UAgent process with `UAGENT_ENABLE_ASSET_MUTATION=1`; keep the product UI sandbox gate enabled as an additional restriction.
- Through the product UI, perform `validate -> add -> confirmTrust`; never inject a raw mapping or call the native trust command directly.
- Attach the real UE observation through the product UI and confirm heartbeat ready and process alive.
- Discover exactly, in canonical order: `ue.asset.create_folder`, `ue.asset.duplicate`, `ue.asset.rename`, `ue.asset.move`, `ue.asset.delete`, `ue.asset.save`.
- Verify every tool supplies `inputSchema`, `dryRunSchema`, `rollbackContract`, `affectedAssetsSchema`, and `evidenceQuery`, and record the canonical live fingerprint and plugin build identity described in [the plugin baseline](mvp15-ue-mcp-plugin-baseline.md).
- Complete all required automated verification, including Rust formatting and the five authority scans, before any real mutation.

## Fresh Happy-path Lifecycle

1. Open `Settings -> Config -> MCP read-only runtime`. In `Endpoint`, enter the configured local address (for example `http://127.0.0.1:8000/mcp`); only `localhost` / `127.0.0.1` / `::1` is allowed. Click `Connect`, confirm the status is `connected`, then click `Discover`. Record the discovery counts and confirm the exact six-tool inventory and contract fingerprint in `Tools -> MCP` before opening `Tools -> Assets` for the asset mutation workflow.
2. Choose a fresh run id and record redacted authoritative root/observation/process provenance.
3. Run dry-run once from the product UI. Require five exact dry-run results and `external_bound`; Content digest must not change.
4. Click Approve once. Continue only after one native registration returns one opaque token.
5. Click Execute once. Require five native guard/call/result triplets in order: create run root, duplicate, rename, move, save one asset. Each guard must complete a live authority recheck before its MCP call.
6. Verify source size/SHA-256 unchanged, final target present, old paths absent, and outside-run aggregate unchanged.
7. Wait 65-90 seconds after the original registration while maintaining a genuinely live heartbeat. Do not refresh, obtain another token, or create another registration.
8. Click Rollback once. Require four guard/call/result triplets in strict inverse order: move back, rename back, delete duplicate, remove the exact run root.
9. Final verify: source unchanged; exact run root absent; fixed container absent or ordinary/non-reparse/strictly empty; outside-run aggregate unchanged.
10. Open recorded replay inspection and prove native/MCP/provider/verification/rollback deltas are `0/0/0/0/0`.
11. Stop observation through the UI and prove UE remains running.
12. Close only task-owned UAgent/listener processes and prove pre-existing UE/MCP ownership is unchanged.

Before the mutation lifecycle, exercise the six independent product authority
retractions in order: RefreshTools, MCP reconnect, invalid/change endpoint,
renderer restart, task-owned UE restart, and stale concurrent completion. Each
event must retract the old discovery/fingerprint before publishing a newer
generation and must retain an action receipt without raw process, endpoint, or
session identity.

## Required Negative Ledgers

Each negative case uses an independent rendered control and observation/run/registration identity and must prove before/after Content digest equality. N1/N2 are pre-registration failures and therefore require registration, token, MCP mutation, and manifest ownership counts of zero. N3-N8 first complete five real plugin dry-runs for their independent run before native registration. N3-N6 own one bounded registration/token/manifest and perform no MCP mutation. N7/N8 must prove the real MCP execute/rollback side effects used to establish replay semantics, followed by bounded cleanup and a restored Content digest; their counters must match the observed calls.

The rendered partial/unknown matrix is diagnostic-only. It cannot supply or replace any formal N1-N8 receipt.

1. Before `confirmTrust`, attempt registration for the disposable root: require `untrusted_root`.
2. Start a task-owned UAgent with native gate OFF while the UI gate is ON: require `feature_disabled`. Close that task-owned app before starting the gate-ON happy path.
3. Stop the observation, then request a new registration: require `observation_session_stopped` or the documented stable equivalent.
4. Only when a task-owned UE process exists, create an independent registration, close that process, and attempt the next operation: require `process_exited` before MCP. If no task-owned UE exists, record `BLOCKED_BY_ENVIRONMENT`; never stop a user-owned process or fabricate a pass.

## Lease and Authority Checks

- First execute after 60 seconds without a prior accepted execute: `approval_expired`.
- Forward after the absolute 15-minute cap: `transaction_expired`.
- From 15 to 20 minutes, an already-owned side effect permits only explicit same-registration recovery rollback.
- Rollback after the absolute 20-minute cap: `recovery_expired` with no MCP call.
- Trust revocation/root replacement blocks guard and active evidence.
- Unbound evidence path returns `asset_path_not_bound`.
- Gate OFF after an owned side effect blocks forward work but may permit only the bounded explicit recovery rollback.

## Ledger Result Rules

- Record `PASS_REAL_SMOKE` only when the complete current-source happy path, all required negative ledgers, final residue checks, plugin identity, and ownership checks pass.
- Record `BLOCKED_BY_MCP_SCHEMA` for missing/incomplete exact discovery or an unreproducible plugin identity.
- Record `BLOCKED_BY_ENVIRONMENT` for missing disposable target, task-owned process, required ownership facts, or other genuine environment prerequisites.
- On unknown residue or failed bounded recovery, stop. Do not use direct native/MCP calls or manual/broad cleanup.
