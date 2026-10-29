# Native provider continuations

Responses continuations are immutable data records in the managed
`run-store-v2/runs.sqlite3` database. They use their own schema and
`provider_continuations_v1` table; saving one never calls
`RunStore::commit_checkpoint` or changes its revision.

## Native integration

`ProviderContinuationStore::open(root)` accepts the application's trusted
managed store root. `load(scope, policy)` and `save(scope, record, policy)`
require the actual native endpoint policy. There is no default allow policy.

The broker must build `ContinuationScope` from a fresh native-owned session.
The serializable scope DTO is data, not a capability. Do not trust a scope
received from the renderer or recreate authorization from an archived record.
It binds all of:

- Project ID and project epoch.
- Run ID and its existing conversation/session ID.
- Provider ID, model ID, provider generation and revision.
- Model configuration fingerprint under the current native endpoint policy.

The store checks the current native provider/model snapshot, then checks its
generation and revision again inside the same SQLite transaction as the read
or write. A provider edit, deletion or recreation invalidates an older scope.
The run must exist under the exact project and conversation. Its execution
status is not assumed to be running.

The native broker should call `validate_record(record, scope)` before storage.
Strict DTO decoding rejects unknown record, owner, assistant and tool-call
fields. Nested native output rejects known credential/authorization/approval
field names. This is an additional structural boundary; it does not replace
the protocol parser or the credential-aware echo checks on actual provider
data and outgoing input. Opaque encrypted provider content remains opaque.

## Acknowledgement and limits

A save acknowledges only after SQLite COMMIT. An identical repeated save is
idempotent; changed data for the same request ID, or a response ID reused by
another request, is rejected. There is no automatic retry, dispatch or
execution of saved tool calls. A cancelled or uncertain IPC acknowledgement
may have preserved inert data; the runtime must reconcile it and obtain new
credentials, a fresh run lease and a new exact outbound approval.

Records are limited to 1 MiB of JSON each, 128 records and 8 MiB per exact
owner/configuration scope. The store bounds output depth/node counts,
checks stored payload sizes before reading them, and rejects corruption
rather than silently truncating or clearing records.

Full managed-database SQLite backup includes these tables. The older
project-only export format does not include native continuations and must
not be represented as a complete Responses replay export. Opening any
backup does not restore current trust, credentials, verification or approvals.

The focused tests are in `provider_continuation_store::tests` and exercise
Windows system SQLite. They do not contact a model endpoint.
