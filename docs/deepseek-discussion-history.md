# DeepSeek ordinary discussion history

Windows ordinary DeepSeek chat now records automatically in the existing managed
`run-store-v2` SQLite database. This is separate from the optional 2,000-character
redacted-copy feature. No new tables or production-data migration are introduced.

## Integration contract

- `DeepSeekSessionOptions.ordinaryArchive` is a data-only observer. It receives
  credential-redacted, actually prepared wire messages after this request's Send
  intent/review, before the final source/signal/grant dispatch checks.
- `open_native_discussion_archive` creates a native-generated handle/run under
  `chat:local` or `chat:project:<logicalProjectId>`. The actual native window owns
  it. A path, credential, trust decision, approval or execution scope is never an
  input. Only the shipped DeepSeek provider/model is accepted.
- `mutate_native_discussion_archive` accepts begin, ordered delta, completion and
  failure/cancellation observations. Deltas commit before UI publication.
  Completion commits before the runtime receives its final done chunk.
- `close_native_discussion_archive` and native window lifecycle cleanup close
  records without restoring or authorizing any worker. Window generation changes
  atomically invalidate all previous handles before cleanup.
- The existing RunStore history/snapshot commands and history UI read these
  records. `uagent.deepseek-chat-archive.v1` is archive data, never executable
  coordinator state or independent proof of remote processing/billing.

A native run covers one memory-session conversation segment. Closing credentials,
changing project/model or restarting creates a new run; old records remain
immutable and separately selectable. This does not merge every historical run
into one unbounded transcript. Full retained text is independent of the outbound
context budget.

## Completion and recovery

Full completed replies and received interrupted text are retained without the
manual-copy character truncation. Interrupted text remains display evidence,
including earlier failures followed by a successful retry. It is never converted
into a successful assistant/context message. If Stop or storage delivery failure
races a committed provider completion, the received bytes remain visible but
the final delivery status excludes that request from restored context.

Restoration requires explicit text selection, a matching recorded logical
project namespace and provider/model, a fresh memory credential/session, and a new
ordinary Send intent. It creates a new conversation/run. Existing eight-turn /
12 KiB selection bounds still apply. Attachment-bearing requests, tool results,
failed/cancelled deliveries, native handles, credentials, approvals and project
trust are not restored as context or authority.

The shared archive retains its existing capacity bounds (128 requests, 4,096
messages, 8 MiB retained bodies and 8 MiB events); each observed partial is bounded and
ordered. Capacity, conflict or unavailable storage stops this request instead of
silently truncating or automatically retrying a model call. Existing transport
output bounds and independent tool approval are unchanged.

## Validation boundary

Focused tests use synthetic DeepSeek SSE and real Windows SQLite fixtures.
They cover long Unicode bodies, reopening, ordered partials, cancellation,
storage failure, late Stop, immutable input identity, project/model isolation
and old-window handles. They do not establish real API/TLS connectivity, physical
power-loss recovery, or end-to-end acceptance in a newly packaged native window.
