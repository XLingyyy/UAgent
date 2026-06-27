# MVP4 Provider Implementation Plan

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

## Gates

- G0: Baseline freeze and roadmap sync
- G1: Secret/Network Boundary (secretRef / redaction / transport gate)
- G2: Provider Adapter Fixture Matrix (OpenAI-compatible / Anthropic-compatible fixture adapters)
- G3: AgentLoop Provider Integration (prompt -> request -> provider events -> TaskEvent/Trace)
- G4: UI/Settings Integration (ProviderSettings, streaming UI, diagnostics)
- G5: MVP4 Acceptance (commands, side-effect scan, docs, manual smoke)

## Task List

- MVP4-00: Baseline freeze and roadmap sync (P0, G0)
- MVP4-01: Provider boundary ADR (P0, G1)
- MVP4-02: Shared secret/provider config contracts (P0, G1)
- MVP4-03: SecretStore and redaction utilities (P0, G1)
- MVP4-04: Provider network transport gate (P0, G1)
- MVP4-05: Provider fixture protocol server (P0, G2)
- MVP4-06: OpenAI-compatible adapter, fixture-first (P0, G2)
- MVP4-07: Anthropic-compatible adapter, fixture-first (P0, G2)
- MVP4-08: Provider registry and config validation (P0, G2)
- MVP4-09: Prompt-to-provider request integration (P0, G3)
- MVP4-10: AgentLoop provider mode (P0, G3)
- MVP4-11: ProviderRuntimeEvent to TaskEvent bridge (P0, G3)
- MVP4-12: Streaming cancellation/error/usage mapping (P0, G3)
- MVP4-13: Provider trace replay and diagnostics (P1, G3)
- MVP4-14: ProviderSettings secret-safe UI and test connection (P0, G4)
- MVP4-15: Composer model/provider runtime readiness states (P1, G4)
- MVP4-16: Streaming UI in Conversation/AgentTrace/RuntimePanel (P1, G4)
- MVP4-17: MVP4 scenario matrix and manual smoke suite (P0, G5)
- MVP4-18: Side-effect scan hardening (P0, G5)
- MVP4-19: Docs, acceptance, report templates (P0, G5)
- MVP4-20: Early-finish expansion pack (P1, G5)

## Key Decisions

- Live provider mode must be disabled by default
- Default tests and CI must use mock/fixture/disabled
- Mock/fixture/live must be distinguishable in types, text, and runtime state
- Provider config cannot save raw API keys
- Real provider HTTP only goes through ProviderHttpTransport
- MVP4 scenario acceptance is a nine-case matrix covering provider-only paths plus `mcp-resource-with-provider-report` and `blocked-tool-with-provider-report`; every result exposes provider events, task events, terminal state, request log, redaction check, and assertion count
