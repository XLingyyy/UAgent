# Standalone Anthropic Messages adapter (T21)

This module implements the native Messages JSON/SSE contract behind the existing
ProviderAdapter. It is intentionally not registered in the production provider
registry, desktop UI, or native transport. Protocol fixtures are synthetic;
**no Anthropic account, model, endpoint connectivity, TLS connection, paid API,
or desktop/Tauri acceptance has been performed.** Capability booleans describe
implemented wire handling. Connectivity remains unverified.

## Integration contract

Import createAnthropicSession from this directory's index.ts. Supply explicit
wireApi: "anthropic-compatible", modelId, and a fresh ProviderContinuationOwner
(provider/model/project/epoch/run/conversation). Pass isCurrent from the actual
live run lease and getProjectContext from trusted current state, including the
source revision. Request metadata can narrow these bindings; it cannot authorize
or replace them. A new run/conversation requires a new session.

Enter the credential with setCredential from local session memory. It is sent in
x-api-key and is never persisted. Credential replacement clears native history;
close aborts work, removes credentials/history and permanently revokes this
session. No history/settings record can reopen it.

Live mode requires an OutboundConsentGate. Each call snapshots and serializes
the entire real body (including native thinking and tool results), obtains
one exact-body grant, runs the caller's original beforeSend source-validation
hook, validates the source revision and consumes the grant. A final synchronous
lease/context check occurs after consumption immediately before fetcher. An
approval grants one request only. No automatic retry, protocol/model fallback,
or implicit model selection occurs. Use an exact model ID: a different returned
model is rejected, including an unrecognized alias resolution.

The main integration must provide a native HTTP transport for the exact official
HTTPS endpoint https://api.anthropic.com/v1/messages, with normal platform TLS
certificate and hostname verification, redirects refused, credentials/caching
omitted, and no request/header/error logging. The existing Responses native
allowlist must not be treated as Anthropic authorization. This module does not
change that allowlist, weaken TLS, add a proxy, or add a browser-CORS bypass.
Its version header is deliberately pinned to 2023-06-01; migrating API versions
is a separate explicit protocol decision.

## Messages, tools, thinking, and usage

- Leading system/developer messages become top-level system text blocks. User
  content stays in user messages. Ordinary later user text follows tool_result
  blocks, never precedes them within a result turn.
- Assistant tool_use IDs and tool_result.tool_use_id round-trip exactly. Parallel
  results must each match one pending call, immediately following its assistant
  turn. Missing, duplicate, reused or foreign IDs and unsupported tool names fail.
  Tools use the documented name alphabet and object input_schema.
- SSE processes message_start, content_block_start/delta/stop, message_delta,
  message_stop, ping, and error. UTF-8 byte splits, CR/LF/CRLF, comments and
  multiline data fields are framed without an OpenAI [DONE] sentinel. Unknown
  top-level events are ignored but cannot signal successful completion; unknown
  content block/delta kinds fail closed. Empty/null text citations metadata is retained; populated citations are unsupported.
- Text streams incrementally. input_json_delta fragments accumulate as exact
  argument text; complete JSON is parsed and checked before a tool delta is
  published. A completed block is not permission to run a tool: consumers must
  wait for a successful terminal chunk and apply normal tool authorization.
- thinking/thinking_delta/signature_delta and redacted_thinking are preserved as
  native blocks. Signature deltas replace the opaque signature value, following the official SDK; they are not concatenated. Thinking and signatures never become common text deltas. Empty
  thinking with a nonempty signature is valid. The adapter does not decrypt,
  rewrite, summarize, or claim to cryptographically verify opaque signatures.
- All prior assistant turns must match exact visible content/tool arguments and
  the full preceding message prefix retained privately by this same session.
  Native blocks are cloned on storage and output. Project/run/epoch/conversation
  ownership is fixed; absent native history fails rather than reconstructing or
  stripping thinking. There is no persistence/recovery API in this module.
  Shared nativeContinuation is currently Responses-specific and is not reused
  with a false protocol tag.
- Optional thinking is explicit native disabled/adaptive/manual-enabled config.
  No generic effort-to-budget mapping or model-support assertion is made.
  Manual budget mode is legacy and unsupported by some models. A rejected
  configuration never triggers a fallback.
- Recognized stop reasons retain their native value. end_turn, stop_sequence and
  refusal map to stop; max_tokens/model_context_window_exceeded map to length;
  tool_use maps to tool_calls. Tool blocks in interrupted/truncated responses are
  rejected. pause_turn/server-tool continuation and unknown reasons are unsupported.
- Final usage is reported only with actual input and final output counts.
  Input counts include reported cache creation/read counts; cumulative SSE output
  updates replace earlier counts. Missing usage or a missing final output count
  remains unknown, with no zero placeholder, estimate, refund or price claim.

Credential-echo checks cover complete public results, IDs, native blocks, errors,
cached/replayed data, decoded tool JSON values **and property names**. Only the
protocol-required JSON layers are decoded; JSON-looking nested strings are not
recursively guessed. A credential prefix spanning text deltas is withheld.
Callback/transport failures expose fixed normalized errors without raw causes.

Unsupported here: images/documents, citations, server-hosted tools, prompt-cache
configuration, forced tool choice, beta extensions, Bedrock/Vertex, arbitrary
compatibility endpoints, and restored external assistant history. These are not
advertised as verified capabilities.

## Validation and sources

Focused synthetic tests cover JSON/SSE, three-step native tool continuation,
parallel result matching, signed/redacted thinking, unknown/cumulative usage,
exact approved bytes, all approval/hook/consume lease-revocation timings,
project/run/epoch/conversation separation, cancellation and JSON-semantic echoes.
No new dependencies are required. Test helpers contain only synthetic credentials.

Protocol references checked on 2026-10-29:

- [Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Streaming events and cumulative usage](https://platform.claude.com/docs/en/build-with-claude/streaming)
- [Tool-result ordering](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)
- [Thinking/tool workflows and unchanged assistant blocks](https://platform.claude.com/docs/en/build-with-claude/thinking-tool-workflows)
- [Thinking blocks and signatures](https://platform.claude.com/docs/en/build-with-claude/thinking)
- [Legacy manual thinking](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
- [Usage cache-token breakdown](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [API versions](https://platform.claude.com/docs/en/api/versioning)

- [Official SDK message accumulator and block types](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/lib/MessageStream.ts)
