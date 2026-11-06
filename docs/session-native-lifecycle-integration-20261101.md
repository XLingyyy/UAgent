# Session native request lifecycle: S5

The four catalog IPC wrappers now prepare one NativeRequestLifetime before managed-queue admission and move it into the unique queued FnOnce. It retains the original registry cancellation Arc. Dropping a renderer future does not destroy this envelope while the work can still run. Full/disconnected queues, operation expiry/window revocation before entry, Store-open failure and queue drain discard the original closure; that destruction is the native proof that this exact request cannot subsequently execute.

Only the matching PendingNativeWork entry is then marked Finished. Active requests remain pinned and are finished only by their own Permit when the synchronous handler returns/unwinds. Neither unrelated/replacement flags nor standalone accepted pre-cancellations are cleared. There is no renderer clear command, new TTL, or eviction of accepted obligations. A private thread-local native binding is required for a queued request to enter its handler, so a duplicate cannot steal the pending entry.

ManagedStoreWork rejection and Drop explicitly destroy the apply closure before sending the negative reply. Thus a client sees a rejection only after the unentered envelope's terminal transition. Native callback errors before Permit creation are also finished by envelope Drop. The original S4 cancellation flag survives admission and is consumed by the existing CatalogControl; cancellation still bypasses the Store queue.

Source regressions added: five pure registry cases (over-256 rejection recovery, pending binding, active/replacement protection, still-owned pinning, actual envelope Drop/run), two real ManagedStoreWork cases (full queue and receiver-drop drain), and six central IPC/echo/nested legacy-opener checks. None have executed. Existing author manifests are preserved; session_catalog_commands.rs and session_catalog_registry_tests.rs now have central deltas and require current snapshot validation.

Evidence: E:/Codex/UAgent/2026-10-29/evidence/session-native-lifecycle-20261101-r1/static-fix-manifest.json.
