# Provider Adapter Design

## Architecture Overview

UI / ProviderSettings / Composer
-> UIProvider state: provider config + redacted status + secret refs only
-> DesktopRuntimeAdapter
-> ProviderRuntimeBridge
-> ProviderRegistry
-> ProviderAdapter (MockTextProvider / MockStreamingProvider / FailingProvider / FixtureOpenAICompatibleProvider / FixtureAnthropicCompatibleProvider / OpenAICompatibleProvider / AnthropicCompatibleProvider)
-> ProviderHttpTransport / NativeProviderTransport
-> ProviderRuntimeEvent[]
-> TaskEvent[] / AgentTrace / Conversation / Diagnostics / Evidence / RuntimePanel

## Key Boundary Rules

- UI state only stores ProviderConfig, model selection, Base URL, Wire API, auth mode, and secretRef
- ProviderSettings uses a reference-only secret model: live mode edits `secretRef` directly, raw-key-like text is rejected, and fixture test connection reports store-backed state
- No raw API key, Authorization header, or credential value enters UI store, React props, TaskEvent body, AgentTrace row, logs, or test snapshots
- React components never directly call fetch to real Provider
- All tests use fixture provider; live provider requires explicit manual opt-in
- CI / default dev path never triggers live network

## Runtime decisions

- Live provider mode must be disabled by default
- Default tests and CI must use mock/fixture/disabled
- Mock/fixture/live must be distinguishable in types, text, and runtime state
- Provider config cannot save raw API keys
- Real provider HTTP only goes through ProviderHttpTransport
- MVP4 scenario acceptance is a nine-case matrix covering provider-only paths plus `mcp-resource-with-provider-report` and `blocked-tool-with-provider-report`; every result exposes provider events, task events, terminal state, request log, redaction check, and assertion count
