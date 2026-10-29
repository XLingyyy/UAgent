# Native product settings

This is a persistence backend for the existing UI stores. It creates no additional
frontend preference store, browser key, connection controller or network client.
It depends on complete T06 (94fa0cc), reuses run-store-v2/runs.sqlite3 and the native
projects table, and does not modify T06.

## Audited gap and single source of truth

| Existing source | Current behavior | Cutover |
| --- | --- | --- |
| i18n/locale-store.ts | Global zh-CN/en; browser key uagent.locale | Keep this in-memory store; use native persistence |
| layout-store.ts / ui-store.ts | Global dark/light; old workspace captures theme | Keep the existing layout store |
| provider-store.ts / ui-store.ts saveProvider | In-memory configs; edits reset testStatus | Persist a strict safe projection |
| local-workspace-store.ts / local_workspace.rs | Theme, roots, DeepSeek flag and chat copies | Stop using its configuration projection after cutover |
| T06 projects table | Native identity and descriptive root | Reuse it; do not create another project registry |

Language/theme remain global. Model/reasoning choices are keyed by registered native
project ID. No missing B-project preference silently falls back to A's last choice.
Saved roots and active project selection never restore trust or filesystem access.

## Native entrypoints and UI integration

The integrator adds the module export to the owned native entrypoint:

    #[cfg(windows)]
    pub(crate) mod product_settings_store;

Open ProductSettingsStore at the same trusted app-data directory used by T06:
app.path().app_data_dir()?.join("run-store-v2"). The constructor reuses T06's path
validation, SQLite database/version/quota, and project registry. Its separate
product_settings_schema version never changes T06's user_version.

The unchanged T06 SQLite wrapper is included by path. Backup is delegated to RunStore
so settings, run records and artifacts stay together. Existing serde/serde_json/sha2
and pinned getrandom 0.2.17 dependencies suffice; only the standalone test manifest
adds that already-used dependency. Keep each connection in its native blocking worker; the
connection is not shared across threads. Native adapters choose the storage root;
never accept a root path from the webview.

| API | Responsibility |
| --- | --- |
| read_preferences / seed_existing_preferences | Explicit one-time projection of current UI preferences |
| save_preferences / set_locale / set_theme / select_project | Atomic global changes with expected revisions |
| provider_version / provider_revisions | Full concurrency identity; single-ID read includes tombstones, list includes active providers; no endpoint probe |
| save_provider / provider / providers / delete_provider | Native-policy-checked provider configurations |
| project_preferences / save_project_preferences | Project-isolated model/reasoning choice |
| record_native_observation | Native-only historical capability facts |
| schema_version / backup / backup_for_recovery | Version inspection and preservation/recovery |

Cutover sequence:

1. Read native preferences first. If absent, project the current locale-store
   snapshot and layout theme. Register legacy roots as descriptive T06 Project
   records using the native identity mapping; keep them untrusted.
2. Explicitly project current provider configs through the safe fields below and
   save them through the real native policy. Then seed valid selected/default
   provider IDs and active project ID. Seeding refuses to overwrite native data.
3. Once initialized, native preferences are the sole persistence source. Continue
   using the existing locale/layout/provider/composer stores in memory. Configure
   the existing default locale store with storage:null, hydrate through its current
   setLocale method, and persist later changes with set_locale. Do not instantiate
   a second locale store or race browser/native writes. The old uagent.locale value
   may remain inert as migration input.
4. Stop the old workspace's theme/project configuration capture/restore after this
   cutover. Its chat copies remain on the separate T06 historical-import path.
   This module neither reads nor changes the old JSONL file.
5. Restore ProviderState.testStatus as idle. Project saved ProviderConfig into the
   existing provider store with networkMode disabled and secretRef omitted. Keep
   sessions closed and require fresh project trust.

Language switches can stay immediate in memory. Serialize native writes using the
returned revision, reload/merge on conflict, and show persistence errors rather than
resetting defaults. Locale/theme changes update only the preference table; they do
not rewrite provider configurations or project model choices.

Provider writes require a complete ProviderVersion: providerId, generation (nullable
only for an ID never created), revision and exists. Capture it with the displayed
snapshot using ProviderSnapshot.version(); creation starts with provider_version(id).
Pass that same token to save_provider(&version, &config, policy) or
delete_provider(&version). Deletion returns a tombstone; deliberate recreation must
use that tombstone. Keep tokens with each window's edits. On conflict, reload and
reconcile with the user; never fetch a current token and silently retry stale text.

Provider generations are opaque nonsecret concurrency identities. The native
product_provider_versions ledger survives deletion. Every save and deletion advances
its revision; recreation also creates a new 256-bit random generation. Do not prune
or reconstruct this ledger from active profiles. A revision-only write API is
intentionally absent. Project/global preference revision APIs remain unchanged.

## Nonsecret provider configuration and policy

Safe fields match the current types/provider.ts projection:

- providerId, displayName, baseUrl, wireApi, authMode, models, defaultModel,
  defaultReasoningEffort and enabled.
- Model id, label, contextWindow, supportsReasoning and reasoningEfforts.
- Optional capabilityDeclarations (unknown/supported/unsupported for text/tools/
  streaming) and requestDefaults (temperature/maxOutputTokens).

DTOs use camelCase and reject unknown fields. secretRef, API keys, headers,
networkMode, session tokens, approval/execution tokens, trust and connection/test
status are not accepted. Recognizable secret-looking text is rejected, never
redacted or truncated. Base URLs exclude userinfo, query, fragment, backslash and
whitespace. API-version query parameters belong to typed native request handling.
This is a typed nonsecret store, not a general secret detector or credential vault.

Every provider read/save requires a trusted NativeEndpointPolicy implementation.
It must adapt the same endpoint safety/canonicalization policy as the real native
transport, with no second host allowlist and no permissive fallback. The policy
object/result cannot be deserialized from the webview. Its check is local only:
no probe, HTTP request, automatic key lookup or credential transmission. Actual
sending must still recheck the current native policy.

EndpointDecision supplies canonicalBaseUrl, policyRevision and transportSupported.
Unsupported transports can be configured but cannot record verification observations
or become connected. If no native policy adapter is available, return an explicit
policy error. This module supplies no production policy adapter or Tauri commands.

## Declarations, evidence and invalidation

Declarations are configuration, not measured capabilities. record_native_observation
is a trusted Rust-only API; its input is deliberately not Deserialize. Do not expose
a webview command that accepts arbitrary observations. Only the native transport
result handler should construct it.

The fingerprint binds provider ID, persisted generation, configuration revision,
canonical URL, wire API,
auth mode, full model settings and native policy revision. Every provider save resets
evidence, matching existing testStatus behavior. Endpoint/model edits invalidate old
facts. A-to-B-to-A changes reject old in-flight results. Native policy revision changes
invalidate matching on read. The native response handler must capture generation
and fingerprint from the configuration used to send a request. NativeObservation
requires providerGeneration as well as the fingerprint; do not fill either from a
fresh snapshot when a delayed response arrives. Both are checked before any write.
Historical evidence stores and validates its generation too. Deleted/recreated IDs
cannot accept previous observations, even with identical endpoint/model/policy.

Persisted evidence is historical. Snapshots always return connectionVerified=false,
requiresNewSession=true and currentlyVerified=false; project settings return
requiresFreshProjectTrust=true. Current verification, credentials and authority stay
in their existing runtime/session owners. Removed models clear only affected project
choices. Provider deletion clears only its bound selections in one transaction.

## Atomicity, migration and recovery

Profile edits, evidence invalidation and affected project selections commit together.
Cross-table reads also use short coherent transactions so concurrent edits cannot
produce a false corrupt-record error. Policy checks must stay local and must not
reenter the store or perform network operations while the transaction is held.
Complete provider identity tokens reject stale writers across deletion/recreation;
global/project preferences continue to use their own expected revisions. Limits are 256 KiB/record, 64 providers and
128 models/provider. Invalid or oversized records fail without clipping.

Native settings schema is now v3. V1-to-v2 preserves theme/locale and their
revision, then adds profile/project/evidence tables and selections. V2-to-v3 creates
the independent identity ledger, assigns each active provider a new generation,
advances its profile revision, and discards capability evidence without a generation
binding. The entire migration is one transaction; overflow/random/SQLite errors
leave the previous schema intact. Reopen retains the same generation and revision.
Deleted-ID history already removed by v2 cannot be recovered; old revision-only
clients and observations are rejected rather than promoted into a new identity.
Close old native workers and reload window snapshots during upgrade. Concurrent
old binaries writing the same database are unsupported; profile/ledger mismatch
fails closed. T06's schema version (2), projects and records remain intact. Newer schema versions,
malformed JSON and unknown fields fail without resetting or importing authority.

backup_for_recovery delegates to T06 without decoding settings, so even a failed
settings migration can be preserved. Keep the failed copy, then open a known-good
complete backup directory with all workers closed; reload all window identity
snapshots after recovery. T06's backup completion marker and artifact integrity
checks apply. A backup of bad data remains bad; copying is not repair. SQLite files
that cannot be opened require offline preservation with the app stopped. There is
no automatic delete/reset/overwrite recovery path here. Recovered profiles are
rechecked by current native policy and cannot restore sessions or project trust.

## Focused verification

    & 'E:\Codex\UAgent\2026-10-29\tools\use-e-drive.ps1' -CargoCache t06
    $env:CARGO_TARGET_DIR = 'E:\Codex\UAgent\2026-10-29\build-cache\product-settings-target'
    cargo test --offline --locked --manifest-path apps/desktop/src-tauri/tests/product_settings_store_tests/Cargo.toml product_settings_store_

The harness compiles unchanged T06 as a dependency and does not run its tests.
The original nine synthetic native tests cover reopen and language preservation, project
isolation, declarations versus evidence, endpoint/model/policy invalidation,
late-result rejection, credential/authority refusal, mandatory native policy,
real schema migration, transaction-abort rollback, stale writers, corruption,
known-good backup recovery and provider deletion. Synthetic policy objects do no
networking. The generation fix adds three real SQLite tests: delete/recreate over
two reopens with old save/delete/observation rejection and zero writes, v2 migration
with legacy evidence invalidation, and migration-overflow rollback. This patch ran
those three, the two combined tests below, and the existing atomic-abort and bound
selection tests (7 passing tests total). Other original tests compiled under strict
Clippy but were not rerun in this slice.

Desktop wiring uses product_settings_commands and provider_endpoint_policy. The
existing UI stores remain the in-memory owners; the native database is their only
settings persistence source after migration. Real Provider/UE behavior, physical
disk-full and forced-kill recovery remain unverified. No historical private session,
actual key, endpoint probe or third-party network request is used.


## Desktop integration boundaries

The main entry initializes native preferences before mounting the application.
Only an absent native record reads old nonsecret workspace preferences and the
old locale key; the old files remain unchanged and the locale key becomes inert.
Provider snapshots restore with idle test status and closed memory-only sessions.
The existing editor captures ProviderVersion when editing begins, preserves a
conflicting draft and never refreshes its token to replay a write. Explicit reload
warns that unsaved edits will be discarded.

Project registration uses the same native identity and canonical root as run
storage. Each registered project owns model/reasoning preferences; a project with
no saved choice does not inherit another project\'s selection. Without a project,
the selected provider\'s configured default model is used. Theme and locale changes
save automatically with acknowledged preference revisions.

Settings reads/writes and actual renderer fetch preflight share the native endpoint
policy. Other valid configurations remain unsupported for execution. No UI command
accepts native observations, connection verification, credentials, trust or backup
restoration. Backup/recovery remains a native module API without a product entry.

## Combined T06/T08 regression

Two additional focused tests use one synthetic SQLite library per case. They cover
both predecessor schema migrations, megabyte Unicode/NUL messages and tool results,
settings/checkpoint interleaving and reopen, genuine parallel run/settings writers,
competing preference revisions, corrupt settings with continued run checkpoints,
and synthetic endpoint-policy rejection with zero SQLite data changes.

Run only this combined slice with the same E-drive environment:

    cargo test --offline --locked --manifest-path apps/desktop/src-tauri/tests/product_settings_store_tests/Cargo.toml product_settings_store_combined_

Integration notes: use the same native data root/project IDs for both stores; keep
run, profile, project-preference and global-preference revision domains separate.
A corrupt settings record must not trigger a reset of the shared database.
Endpoint checks remain mandatory on every profile read/write. This combined check
does not exercise UI/Tauri, real endpoints, credentials, UE, physical disk-full or
forced termination.
