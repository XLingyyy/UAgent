# ADR-0002: Provider Runtime Boundary

## Status

Accepted (MVP4)

## Context

UAgent needs to support real LLM providers (OpenAI-compatible, Anthropic-compatible) while maintaining the existing safety guarantees from MVP1-MVP3: no default network access, no secret leakage, no mutating MCP tool execution, no shell/browser/filesystem product capability.

The existing POST-MVP3 codebase has mock providers (MockTextProvider, MockStreamingProvider, FailingProvider) and a ProviderRegistry but no real HTTP transport, no secret management, and no live provider execution path.

## Decision

### 1. Provider Modes

Three network modes are defined:

- **disabled** (default): No provider network request can be made. Instant deterministic failure.
- **fixture**: Provider requests go through a fixture transport that returns scripted responses. No real network access. Used for all automated tests and CI.
- **live**: Provider requests go through real HTTP transport. Requires explicit user opt-in AND a configured secret.

Mock/fixture/live must be distinguishable at the type level, in UI text, and in runtime state. They must not be conflated.

### 2. Secret Safety

- No ProviderConfig type field may store a raw API key, Authorization header, Bearer token, or credential value.
- Provider config references secrets by `secretRef` (a string identifier).
- `SecretStore` interface handles `put`, `get`, `delete`, `listRefs`, `has`.
- MVP4 uses InMemorySecretStore; interface supports future OS keychain integration.
- All secret values must pass through redaction before entering logs, events, traces, snapshots, error messages, or diagnostics.
- React components, UI stores, TaskEvent bodies, AgentTrace rows, RuntimeSnapshot payloads, and test snapshots must never contain raw secret text.

### 3. Network Transport Gate

- All provider HTTP requests go through `ProviderHttpTransport`.
- The transport checks `networkMode` before every request.
- Default `networkMode` is `"disabled"`.
- Live transport requires explicit opt-in via `ProviderHttpTransport.enableLive()`.
- `ProviderHttpTransport` handles: JSON body serialization, SSE stream parsing, abort signals, timeout, header construction, and Authorization header injection (from SecretStore, not from config).

### 4. Component Responsibility

```
React Components / UIProvider state
  -> ProviderConfig (redacted, secretRef only, no raw secret)
  -> DesktopRuntimeAdapter
    -> ProviderRuntimeBridge
      -> ProviderRegistry
        -> ProviderAdapter (complete/stream/getCapabilities)
          -> ProviderHttpTransport (network gate)

Adapter responsibility:
- OpenAICompatibleAdapter: maps OpenAI wire protocol to/from ProviderRuntimeRequest/Response/StreamChunk
- AnthropicCompatibleAdapter: maps Anthropic wire protocol to/from ProviderRuntimeRequest/Response/StreamChunk

Transport responsibility:
- ProviderHttpTransport: fetch/SSE/abort/header/secret/redaction

Strict prohibition:
- React components must never directly call fetch, ProviderHttpTransport, ProviderAdapter, MCP session, or MCP transport.
- Runtime code must never import React or access the DOM.
```

### 5. ProviderRuntimeEvent Responsibility

ProviderRuntimeEvent is the only cross-boundary representation of provider activity:

- `provider_request_started` / `provider_stream_started` / `provider_stream_delta` / `provider_stream_completed` / `provider_request_completed` / `provider_request_failed` / `provider_request_cancelled` / `provider_usage_recorded`
- These map to TaskEvent, AgentTrace, Conversation, Diagnostics, and Evidence.
- Event payloads must be redacted of any secret content.
- Stream deltas are text-only; no metadata.

### 6. AgentLoop Provider Integration

- AgentLoop supports a `provider` option (default undefined / disabled).
- When enabled, AgentLoop can send a prompt to the provider and incorporate the response into plan annotations or report wording.
- Provider output must never directly create or execute tool calls.
- Provider failure is either fail-fast or deterministic fallback; no mutating fallback.

### 7. Config Validation

ProviderRegistry validates at registration time:
- providerId uniqueness
- wireApi matches available adapter
- baseUrl is a valid URL (when networkMode is not disabled)
- secretRef is provided when networkMode is live
- model list is non-empty

## Consequences

Positive:
- Clear security boundary: no accidental network access or secret leakage
- All tests run in fixture mode, no real API keys needed
- Future OS keychain integration is straightforward through SecretStore interface
- Provider modes are explicit and auditable

Negative:
- Live provider requires explicit opt-in steps (setting networkMode, configuring secretRef, enabling transport)
- Extra indirection through ProviderRuntimeBridge and ProviderHttpTransport

## Related

- ADR-0001: MVP2 MCP Read-only Runtime (implicit)
- docs/mvp4-provider-plan.md
- docs/runtime-contract.md
