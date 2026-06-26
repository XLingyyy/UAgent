# POST-MVP3-LONGRUN-002+003 Acceptance

## Provider Runner Timeout Semantics

`ProviderExecutionOptions.timeoutTicks` is a deterministic chunk-budget counter.

### Behavior

| `timeoutTicks` value | Complete mode | Stream mode |
|---|---|---|
| `undefined` | Normal execution | Normal execution |
| `<= 0` | Immediate `provider_request_failed` with `code: "timeout"`, `retryable: true` | Immediate `provider_request_failed` with `code: "timeout"`, `retryable: true` |
| `> 0` | Not enforced (passes through to adapter) | Chunk budget: after `timeoutTicks` chunks are yielded, produces `provider_request_failed` with `code: "timeout"`, `retryable: true`, and returns accumulated partial text/chunks |

### Acceptance Tests

- `runProviderComplete(..., { timeoutTicks: 0 })` returns timeout failure, no `provider_request_completed`
- `runProviderStream(..., { timeoutTicks: 0 })` returns timeout failure, no `completed` event
- `runProviderStream(..., { timeoutTicks: 2 })` with 4 chunks yields partial text "AB" and timeout failure
- `runProviderStream(..., { timeoutTicks: 10 })` with 2 chunks completes normally
- All timeout errors use `ProviderRuntimeErrorCode` `"timeout"` with `retryable: true`
- All timeout behavior is deterministic (no wall-clock dependency)

## ProviderRegistry Duplicate Guardrail

`ProviderRegistry.register()` throws on duplicate `adapter.id`.

### Behavior

| Operation | Result |
|---|---|
| `register(new MockTextProvider())` | Succeeds |
| Second `register(new MockTextProvider())` | Throws `Provider adapter is already registered: mock-text` |
| `get("missing")` | Throws `Provider adapter is not registered: missing` |
| `listCapabilities()` | Returns only successfully registered providers |

### Acceptance Tests

- First registration succeeds
- Duplicate registration throws clear error
- `get("missing")` still throws
- `listCapabilities()` only returns registered providers after failed duplicate
