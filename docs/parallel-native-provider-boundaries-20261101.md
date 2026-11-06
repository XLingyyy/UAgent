# Independent implementation boundaries, 2026-11-01

This is an author assignment contract, not a completion claim. Keep all files.
Do not run builds/tests, touch real credentials/databases, call API endpoints,
launch UE, install dependencies, or change the central guard. New test fixtures
must use unique E:/G: paths and preserve files. Central owns lib.rs, App.tsx,
ConfigSettings.tsx, safe-provider-session.ts, runtime/src/index.ts, package exports,
Cargo.toml, test runner and build integration. Authors supply an integration note
with exact symbols/DTOs and required central changes, then central integrates.

## Writer fence and persistent recovery catalog

Author-owned files (repo-relative):

- New apps/desktop/src-tauri/src/storage_write_fence.rs.
- New apps/desktop/src-tauri/src/runtime_host_writer_service.rs.
- apps/desktop/src-tauri/src/local_run_store/sqlite.rs.
- apps/desktop/src-tauri/src/local_run_store/mod.rs.
- apps/desktop/src-tauri/src/local_run_store/effect_reconciliation.rs.
- apps/desktop/src-tauri/src/local_run_store/runtime_host_catalog_reader.rs.
- apps/desktop/src-tauri/src/product_settings_store/mod.rs, only DB ownership/route hooks.
- apps/desktop/src-tauri/src/runtime_host_recovery_catalog.rs.
- apps/desktop/src-tauri/src/runtime_host_service.rs and runtime_host_service_tests.rs,
  only exact current-execution/catalog coordination and corresponding cases.
- New focused writer-fence cases and docs/runtime-host-writer-fence-20261101.md.

Critical discovery: settings and run history share run-store-v2/runs.sqlite3.
ProductSettingsStore loads ../local_run_store/sqlite.rs as another Rust module;
module-local statics therefore do not prove one shared writer epoch. The fence
must cover BOTH wrappers/connections, schema initialization/migrations, T18 rows,
ordinary archive commits, continuation/settings mutations and query methods that
execute write-capable PRAGMAs. Merely wrapping Db::execute is incomplete.

Existing interfaces to retain:

```rust
// runtime_host_recovery_catalog.rs
trait CurrentLedgerFence: Send + Sync {
    fn is_current(&self, stamp: &SnapshotStamp) -> bool;
}
PersistentRecoveryCatalog::with_native_writer_fence(Arc<dyn CurrentLedgerFence>)
catalog.scan_existing_store(&RunStore, &AtomicBool) -> Result<RecoveryCatalogReport, &'static str>
// runtime_host_service.rs
trait RecoveryCatalog: Send + Sync {
    fn admission(&self, project_id: &str, root_object_id: Option<&str>, claims: &[ResourceClaim]) -> RecoveryAdmission;
}
host.register_pending(window, &TicketRef) -> HostResult<RegisteredExecution>
registration.begin(); registration.finish(actual_callback_succeeded);
registration.finish_not_started(); host.reconcile(&TicketRef);
```

The native fence owns original physical DB/writer evidence, retains the original
store instance (SnapshotStamp::matches_store_instance), and invalidates BEFORE
any unsafe write can become visible. is_current/admission are nonblocking and do
no SQLite/path I/O or host reentry. A timestamp/hash/data_version/total_changes,
JSON Boolean, named cooperative mutex alone, or watcher after a write cannot be
promoted to physical exclusive ownership. If an unmanaged writer cannot be
excluded/identified, admission remains Unknown. Db contains a raw SQLite pointer
and is not Send/Sync: keep its open/use/drop on its owning bounded worker; do not
add unsafe Send/Sync to make a Tauri state compile. Central will own one managed
service/monitor and install one catalog through native setup only; no IPC setter.

Deliver an opaque native service with a catalog getter and shutdown handle, plus
an exact startup call taking only native app_profile-resolved app data (not a
stored project root or renderer path). Proposed factory name is
start_owned_runtime_ledger; this is a requested port, not an existing symbol.
Keep startup/recovery uncertainty separate from the current host's registered
execution. A freshly prepared intent owned by that exact nonserializable native
guard must not block itself; arbitrary operation IDs cannot supply an exemption.
Previously discovered unknown barriers cannot disappear after a second empty scan.

Offline acceptance requirements for later centrally guarded execution:

1. Complete pristine scan plus genuine current ownership can admit; no fence,
   missing/legacy/partial schema, cancellation/timeout/busy/corruption stays Unknown.
2. Mutation by either RunStore or ProductSettingsStore invalidates readiness before
   its first write; a second connection/path alias cannot evade the epoch.
3. Physical DB/root replacement, abandonment, owner loss and unsupported external
   writer conditions revoke the fence; repeated empty scans cannot erase blockers.
4. Exact current-operation preparation/dispatch completes without self-deadlock;
   forged/foreign ticket, generation, root and exemption IDs remain denied.
5. Registration precedes scheduling a worker; unpolled work, cancellation, panic
   and unknown observer retain resources until real callback + original quiescence.
6. Inventory every writable connection entrypoint and show it uses the fence;
   tests use synthetic scratch databases and preserve them. No production DB.

## Anthropic native Messages product bridge

Existing packages/runtime/src/provider/anthropic/{session,protocol,events,sse,
utils,index}.ts already implement a standalone Messages protocol. Reuse them.
The older anthropic-compatible-adapter.ts is a fixture adapter and is not the
production Messages integration. Do not register it as a substitute.

Author-owned files:

- Existing packages/runtime/src/provider/anthropic/*, including focused __tests__,
  only protocol integration changes and a native bridge contract if needed.
- New apps/desktop/web/src/runtime/native-anthropic-session.ts.
- New apps/desktop/web/src/runtime/native-anthropic-provider.ts.
- New apps/desktop/src-tauri/src/native_anthropic_commands.rs.
- New apps/desktop/src-tauri/src/native_saved_anthropic_filter.rs and focused cases.
- apps/desktop/src-tauri/src/native_responses_http.rs, exact Anthropic FixedTarget
  and header mode only; preserve Responses/DeepSeek behavior and do not duplicate
  a second unreviewed WinHTTP implementation.
- apps/desktop/src-tauri/src/native_provider_transport.rs, one exact
  prepare_anthropic_messages path; replace the internal protocol Boolean with an
  exact private variant if necessary. Never add caller-supplied endpoints/headers.
- apps/desktop/src-tauri/src/provider_endpoint_policy.rs, official Anthropic branch.
- apps/desktop/src-tauri/src/provider_credential_commands.rs, binding_at/receipt
  support for existing WireApi::Anthropic, preserving all previous branches.
- New docs/anthropic-native-integration-20261101.md.

No overlap with the writer author's ProductSettingsStore ownership hooks.
WireApi::Anthropic already exists. Do not change product_settings_store schema.
Central will edit product registration, model/settings UI, safe session and exports.

Required existing TS port: ProviderAdapter.complete/stream(request, options),
ProviderCallOptions.signal/beforeSend/outboundSendIntent. The standalone
createAnthropicSession options require an exact ProviderContinuationOwner,
isCurrent and getProjectContext revision, and preserve native thinking/tool blocks.
Do not masquerade Anthropic continuation as ProviderNativeContinuation (currently
wireApi: responses). Use its native in-memory history; any persistence needs an
explicit additional data contract and never restores permission.

Required new native command family: open_saved_native_anthropic_profile,
bind_native_anthropic_run/conversation, prepare/approve/dispatch/poll/cancel/release
native_anthropic_request, close_native_anthropic_profile. Supply exact DTO types in
the author's module; central registers the exact functions. Native code resolves
provider/model/version/credential binding from app_profile and current native
settings. Only opaque profile/run/prepared IDs cross IPC; no Secret, credential
bytes, arbitrary URL/header dictionary, PID or serialized execution guard does.

Saved credentials remain in the EXISTING credential_vault. load/with_current use
an exact provider/config generation, endpoint and credential version. Never put a
real key into createAnthropicSession in the renderer to make the bridge work, and
never create another secret store. Fixture transport receives only synthetic keys.
The endpoint is exactly https://api.anthropic.com/v1/messages; use x-api-key and
pinned anthropic-version 2023-06-01, normal platform TLS and no redirects, cookies,
automatic auth, proxy bypass, automatic retries, fallbacks or endpoint rewrites.
NativeSession currently prepares only Responses/DeepSeek: a completed native
Messages port is a dependency, not an implicit permission from those allowlists.

Dispatch must consume the actual host TicketRef through register_pending before
scheduling, validate its native owner/run/provider/model/window/generation, and
move the unique guard into the real worker. finish occurs after actual callback,
stream and WinHTTP HANDLE_CLOSING settlement, not when a UI Promise resolves.
Thinking and tool-use deltas are data until normal coordinator/tool authorization.
Native filtering must prevent actual credential echoes before IPC, including JSON
escapes, tool JSON property names/values and text split across chunks; a renderer
that never holds the secret cannot provide this guarantee by itself.

Offline acceptance for later centrally guarded execution: JSON and UTF-8/SSE byte
splits; exact tool_use/tool_result ordering and IDs; signed/redacted thinking kept
opaque; terminal/incomplete/refusal/error/cancellation; measured usage preserved
and absent usage marked unknown; exact-body one-shot approval and lease revocation
at every review/dispatch boundary; provider/project/run/conversation separation;
credential replacement/close; synthetic native header/endpoint assertions; no
secret in results/logs/diagnostics; native pending guard settlement and retained
unknown status. No DNS, account, real vault, paid request or UE process is needed.
Live TLS/account/model acceptance remains explicitly unperformed.
