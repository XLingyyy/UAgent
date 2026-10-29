# Managed native Responses transport

The Windows implementation is split into a protocol adapter, a native request
broker and a fixed-target WinHTTP engine. Configuration and declared capability
do not establish connectivity. The desktop selector exposes Responses only in an explicitly isolated offline
demo profile, labelled as a local synthetic fixture. Ordinary mode remains
blocked while production transport acceptance remains incomplete. Opening a
fixture session never establishes a real model connection.

## Request boundary

The only production target is `https://api.openai.com/v1/responses`, derived by
native policy from the explicit API root. The renderer cannot supply a target
URL to the broker. WinHTTP retains certificate, hostname and chain validation;
the engine disables redirects, automatic authentication, cookies and proxy
discovery. No external TLS handshake is covered by the local fixture tests.

A locally entered credential opens a window-owned, memory-only profile for at
most one hour. The broker rereads the native provider generation, revision,
model and configuration fingerprint. A run binds to a registered project and
an existing native coordinator record, then receives a native data epoch.
A saved record never restores a credential, lease or approval.

The run deadline is fixed to the earliest of the actual approved scope expiry,
the recorded run start plus its duration limit, and the profile expiry.
Each request has a shorter lease bounded by that original deadline; another
request or adapter cannot renew it. A repeated bind under the same live profile
returns the original owner and deadline.

The exact UTF-8 body is retained with its SHA-256, endpoint, model, owner,
configuration and source snapshot. The desktop bridge prepares that body before
displaying the existing outbound review, verifies the hash and binds the user's
single-use approval. The native dispatch gate checks the same lease, grant,
credential, owner, configuration, cancellation and source authority immediately
before dispatch. Native settings updates block new owners for the whole mutation
and revoke existing sessions; window lifecycle events also invalidate pending
profile registration.

## Source and reply handling

A native watcher and pinned Windows handles own source evidence. Index evidence
exists even for empty query results. The broker captures a conservative index
baseline when the run binds; actual scoped native file previews add immutable
evidence before redaction. Source checks reread the selected bounded prefixes
and metadata manifest. Old evidence is never silently refreshed.

The manifest is bounded to 8,192 entries, depth 32 and two seconds. Oversized,
ambiguous, unavailable or changed sources stop the request. Notifications are
asynchronous, so this is not an atomic filesystem-write/network transaction.
Trust revocation and project changes must revoke the native owner before their
UI state is published.

Replies use bounded incremental IPC polling: at most 4 MiB, 4,096 chunks and
64 KiB per chunk. Terminal failures remain failures after partial text.
`notDispatched`, `mayHaveBeenSent` and `sent` describe client transmission;
`sent` does not prove server processing or known billing. No automatic network
retry or model fallback occurs. Raw native error details are not exposed.

## Persistence and desktop integration

Native continuation records use an independent immutable table in the managed
run database. They do not advance coordinator revisions or replay tools while
loading. Data is bound to provider/model/project/epoch/run/conversation plus
the native provider version and fingerprint. A new owner is not an excuse to
re-label old reasoning data. See [continuation storage](provider-continuation-store.md).

The desktop `createNativeResponsesProfile` bridge owns the temporary protocol
credential, implements only native IPC transport, and creates an adapter from the
actual fresh run lease. It has no browser-fetch fallback. The runtime
investigation adapter factory is the integration point after scope resolution.
Missing usage stays `unknown`; reported usage is kept separately and a
contradictory accounting record is rejected before persistence.

The native trust registry retains live host-selected root handles with full
volume/FileID observations. Project IDs remain lookup data. Replacing trust first
revokes the same Responses authority, then retires the previous root generation.
Responses file previews use exact-file guards and bounded reads from those same
handles, retaining guards through the dispatch source checks. Busy or unsupported
objects fail closed. Conservative sharing can block writes/renames: independent
write workflows must revoke and release all relevant guards before obtaining new
observations. This integration does not make every namespace operation atomic.

The existing session/composer controls now select the exact open profile and
wait for native revocation acknowledgement before publishing project/model changes.
A fixed local fixture performs list/find/read through the normal native tools;
only its model responses are synthesized. A real-window three-tool/cancel/restart
acceptance remains required. Ordinary projectless chat and
cross-run native-reasoning migration are not enabled by these APIs.
