# Saved provider credentials

Windows ordinary chat supports an explicit user-saved API key. The renderer
never reads that saved key back: it receives a fixed mask and metadata only.
Native DeepSeek Chat Completions and official OpenAI Responses inject the key
inside the existing constrained HTTPS transports. Saving, selecting a model and
opening a native owner make no model request; an explicit Send is still required.

## Binding and mutation

The OS credential target binds native app-data directory identity, provider
generation, canonical protocol/complete endpoint and a random credential version.
Model membership and the captured ProviderVersion are checked by the native
opener; a deleted/recreated provider or changed endpoint cannot inherit a key.
The current supported destinations remain the official DeepSeek and OpenAI roots.

Only nonsecret active-reference/version/tombstone/cleanup metadata is stored in
a separate SQLite file. A replacement first disables the previous version,
writes a unique OS credential and activates it through CAS. Deletion disables
the active reference before OS cleanup. A failed cleanup stays visibly disabled;
a tombstone mutation token prevents an old absent-state Save from replaying.
No existing memory key, environment key, old chat key or production database is
silently migrated. New key input is bounded to 8–2048 printable ASCII bytes.

A missing, corrupt or unreadable OS record stays unavailable for sending. Healthy
metadata still supplies its captured CAS token for an explicit replacement or
removal; a metadata failure supplies no repair token. Status refresh never resets
records or authorizes a request. Configuration/version conflicts require another
user review, and cleanup failures remain visible.

All corresponding native owners are revoked before mutation. A per-target OS
mutex and active-version check span the final synchronous dispatch gate; polling
and cancellation do not acquire that mutex. Stop closes the current request and
owner while preserving the saved key for a later explicit Send. Config/model,
project, conversation and in-flight opening snapshots remain independently
checked; saved metadata is never a tool permission or reusable Send intent.

## Content and lifecycle

Actual-key JSON/Unicode and split-stream echo checks run natively before public
chunks or archive content. Native DeepSeek uses an opaque parser marker in the
renderer; that marker is never an Authorization credential. Saved Responses
keeps the existing snapshot-ID, safe HTTP-status and unknown-usage behavior.
The saved-key path currently supports ordinary conversations without tools.
Separate tool approvals are retained; this is not a new tool-execution backend.

Credential Manager protects keys for the Windows user. This does not promise
isolation from malicious programs already running as that same user, perfect
memory erasure, cross-process worker termination, or physical power-loss proof.
SQLite/OS vault operations are not a single transaction; failures remain explicit.
No raw credential is returned in diagnostics, source identity, history or exports.

Focused validation uses uniquely owned synthetic OS entries and isolated app
data; cleanup deletes only those test entries. Real API acceptance of this new
credential feature remains a user step. The user's previously reported DeepSeek
acceptance applies to the preceding conversation build, not this feature.
