# MVP4 Acceptance Criteria

## Provider Config / Secret Boundary

- [ ] Provider config only references secretRef and displays redacted status, no raw secret
- [ ] All provider types are secret-safe (no apiKey/Authorization fields)
- [ ] SecretStore interface with InMemorySecretStore implementation
- [ ] Redaction utility covers common secret patterns

## Network Transport Gate

- [ ] ProviderHttpTransport with disabled/fixture/live modes
- [ ] Default mode is disabled
- [ ] Fixture mode provides testable transport
- [ ] Live mode requires explicit opt-in only
- [ ] No network request without secret and opt-in

## Provider Adapter Fixture Matrix

- [ ] Provider fixture engine covers OpenAI-compatible and Anthropic-compatible wire APIs
- [ ] OpenAI-compatible adapter with complete/stream/error/usage mapping
- [ ] Anthropic-compatible adapter with complete/stream/error/usage mapping
- [ ] All tests use fixture transport, no real network
- [ ] ProviderRegistry validates config, networkMode, secretRef, wireApi mismatch

## AgentLoop Provider Integration

- [ ] PromptEnvelope to ProviderRuntimeRequest integration
- [ ] AgentLoop provider mode (default disabled)
- [ ] ProviderRuntimeEvent to TaskEvent/AgentTrace/Diagnostics/Evidence mapping
- [ ] Streaming cancellation/error/usage semantics
- [ ] Provider trace replay and diagnostics

## UI / Settings Integration

- [ ] ProviderSettings secret-safe with Wire API, Network mode, Secret ref, Base URL
- [ ] ProviderSettings live mode edits a secret reference name only; raw-key-like input is rejected and never saved to provider config
- [ ] Test connection uses component/store state (`idle | success | failure`) and fixture behavior; it does not use `alert()` or live network
- [ ] No raw key in provider store config, persisted DOM value, task event, trace, snapshot, or failure text
- [ ] Composer shows provider readiness states
- [ ] Streaming UI in Conversation/AgentTrace/RuntimePanel

## MVP4 Scenario Matrix

- [ ] At least 20 scenario assertions
- [ ] Coverage: disabled, fixture complete, fixture stream, partial failure, cancelled, auth missing, rate limited, MCP + provider, blocked tool + provider
- [ ] `runProviderScenarioMatrix()` returns nine named scenarios: `disabled-provider`, `fixture-complete`, `fixture-stream`, `stream-partial-failure`, `cancelled`, `auth-missing`, `rate-limited`, `mcp-resource-with-provider-report`, and `blocked-tool-with-provider-report`
- [ ] Each matrix scenario exposes `providerEvents`, `taskEvents`, `terminalState`, `requestLog`, `redactionChecked`, and assertion count
- [ ] `mcp-resource-with-provider-report` asserts provider event mapping, one `resources/read`, MCP read event, Agent report, completed terminal state, and no raw secret-like payload
- [ ] `blocked-tool-with-provider-report` asserts provider event mapping, `mcp_tool_blocked`, zero `tools/call`, Agent report, completed terminal state, and no raw secret-like payload

## Side-effect Scan

- [ ] Repeatable scan script or command
- [ ] Allowed vs blocked findings distinguishable
- [ ] No live provider access in CI/default path

## Verification

- [ ] pnpm typecheck passes
- [ ] pnpm lint passes
- [ ] pnpm test passes
- [ ] pnpm --filter @uagent/shared test passes
- [ ] pnpm --filter @uagent/runtime test passes
- [ ] pnpm --filter @uagent/mcp-client test passes
- [ ] pnpm --filter @uagent/desktop test passes
- [ ] pnpm --filter @uagent/desktop web:build passes
- [ ] git diff --check passes
