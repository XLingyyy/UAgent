# Provider adapter contract

Provider adapters consume ProviderRuntimeRequest and return ProviderRuntimeResponse
or ProviderStreamChunk through ProviderAdapter. Native protocol implementations
belong in their own provider directory; transport configuration names alone do
not constitute an implementation.

- Preserve ordered messages, exact tool-call IDs/names/JSON arguments and matching
  tool results. Map the provider's native function-call protocol explicitly.
- Review the complete final serialized outbound body with OutboundConsentGate.
  Each approval covers exactly one request. No hidden context, summarization
  request, automatic retry or fallback may be sent.
- ProviderCallOptions.beforeSend is an optional async live-context guard. Run it
  after exact-body approval and immediately before transport, then recheck abort,
  credential lifetime, project ownership and single-use grant validity. It cannot
  change the approved body. A rejection sends nothing.
- Declare supportsPreSendValidation only when this behavior is implemented and
  tested. Live investigation runs fail closed without it. Mock capabilities must
  truthfully identify synthetic transports.
- Forward AbortSignal across review, dispatch and streaming; reject late output
  after cancellation or ownership changes. Credentials stay in memory and never
  enter request/event snapshots, logs, configuration or Git.
- Map text deltas to one incremental assistant response. Keep tool argument deltas
  separate and validate complete JSON before dispatch. Reasoning/diagnostic data
  must not masquerade as ordinary assistant text.
- Preserve measured token usage. The current shared contract requires measured
  input/output/total counts; missing usage fails closed until an explicit unknown
  usage contract is introduced. Do not invent measured values.
- Surface authentication, rate-limit, malformed and incomplete responses honestly.
  Advertised tools/models must match actual implementation capabilities.

An OpenAI Responses implementation must map its native input/output items,
function-call outputs, event stream, terminal/incomplete states and usage; changing
a Chat Completions endpoint is insufficient. Such a new module can be implemented
under packages/runtime/src/provider/responses without editing the coordinator or
desktop UI. Entry exports and product availability are integrated separately.
Offline protocol tests do not establish live-provider acceptance.
