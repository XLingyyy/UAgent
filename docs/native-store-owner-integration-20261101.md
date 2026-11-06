# Native Store owner integration, 2026-11-01

The native setup now installs a concrete bounded Store worker for the process-selected app-data `run-store-v2` directory. Session and project-memory CRUD use this worker. This is a source integration safe point; no new dynamic success or EXE is claimed.

All copies of `local_run_store/sqlite.rs` acquire `local_run_store::database_owner::ConnectionLease` before opening SQLite and keep it until SQLite is closed on the same thread. This includes the RunStore, product settings, provider continuations, and the independent credential-reference metadata database. The Windows session-wide named mutex is reentrant for same-thread nested settings/continuation opens, has a 5-second acquisition budget and 25-ms cancellation checks. File and ancestor handles deny DELETE sharing and reject reparse objects; multiple-hardlink database objects are rejected. The raw SQLite pointer and thread-owned gate are not Send. No unsafe Send implementation was added.

The worker admits at most 32 queued requests, waits at most 15 seconds for an operation reply, and opens/drops its connection on its own worker for each operation. It does not hold an idle SQLite connection or gate and block ordinary settings or chat archival. A native DB file pin and ancestor directory pins remain alive across idle periods, so the physical runs.sqlite3 object cannot be replaced between operations. Current-generation native window grants are never renderer data: page start, close request, destruction and application exit revoke pending flags. The core denies expired SQL and COMMIT; ROLLBACK and same-thread handle closure remain permitted. A mutation whose result becomes uncertain returns outcomeUnknown and requires a fresh read. An unconfirmed memory rollback, any caught worker panic, or failed handle ownership close quarantines the connection domain. Panic handling happens before reply and before the original worker drops the borrowed Store; the queue then drains as rejected and the worker exits. It never opens a replacement connection to guess whether a rollback succeeded.

## Existing entry coverage

| Entry | Database and behavior | Mandatory ownership |
| --- | --- | --- |
| product_settings_commands | initialize/read preferences, project descriptors/preferences, provider CRUD | ProductSettingsStore and nested RunStore connections use shared gate |
| run_store_commands / run_history_search_commands | archive history, snapshots, checkpoint journal search | RunStore shared gate; existing search execution budget remains |
| native_responses_chat_archive / native_discussion_archive_commands | ordinary Responses and DeepSeek conversation archival | RunStore shared gate; existing native archive/window brokers retained |
| native_responses_commands | persisted provider selection, run creation, Responses continuation | settings/RunStore/ProviderContinuationStore copies share gate |
| native_saved_deepseek / provider_credential_commands | saved provider metadata and credential binding selection | settings use shared gate; vault's existing native target mutex retained |
| credential_vault/metadata | credential references only, never secret bytes | sqlite.rs same mandatory gate; original credential directory/file pins retained |
| local_run_store backup/import/export/artifact APIs | SQLite backup, JSONL provenance and bounded local artifact files | live connection lease; lifecycle checks added before filesystem entry/backup completion |
| new session list/update/branch/read | same physical RunStore, bounded leaf transactions | one bounded native worker; cancel command bypasses queue |
| new memory list/get/create/update | same physical RunStore, schema v3, CAS revisions | same worker and actual cancel/deadline; SQL budget lease shared with history/catalog/recovery scan |

`all-database-openers.json` records actual source call sites. No user database or key was opened to generate it.

## Compile integration repair

Previously the core sqlite.rs included RunStore-only extensions. Other database modules include the core through #[path], so their copies would also try to define RunStore-specific implementations with incompatible error/value types. `run_store_sqlite.rs` now includes the unchanged common wrapper definitions plus only the RunStore extensions. Other stores continue including the common wrapper directly. The memory author's r3 patch was semantically merged: four command closures forward their actual worker flag/deadline, the three other SQL budget guards take the common connection budget lease, and RunCoordinator adopts the final baseContext/contextPlan and revalidates its sources.

## Validation entry points and boundaries

1. Protected fresh frontend build with the reviewed r4 caller, source/artifact binding and hard memory caps.
2. Only after an eligible frontend proof, protected serial native build using the reviewed fixed native profile.
3. Required local validation: nested settings/continuation gate, cancellation while waiting for a connection, ordinary chat archival plus metadata CRUD sharing the gate, queue saturation, page generation replacement, rollback quarantine, schema-v3 reopen/CAS and all four scoped SQL guards rejecting nested installation. Session S4 has 36 author tests and memory r3 has 49 author tests; these numbers describe source, not passed tests.
4. Use only new E: isolated synthetic fixtures. Do not invoke paid providers, read real credentials or start the default user profile for validation. No file deletion is authorized.

Local CRUD ownership is not a positive RuntimeHost recovery admission fence. A cooperative mutex does not exclude arbitrary external SQLite writers; SQLite owns physical transaction locking. The existing RuntimeHost catalog stays Unknown until its separate physical recovery protocol exists. Project-memory model injection remains disabled in production and the real-transport guard remains: the final batch/revision/source/approved immutable body seal is a separate unfinished requirement. Ordinary conversation keeps the original no-memory context path and existing fresh native execution authorization.
