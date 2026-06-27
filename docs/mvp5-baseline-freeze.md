# MVP5 Baseline Freeze

The following items are established by MVP4 and must NOT be broken by MVP5 changes.

## Provider Boundary

- ProviderConfig uses secretRef only — no raw API keys, Authorization headers, or credentials in config objects
- Redacted status preserves secret-safe display
- Disabled / fixture / live opt-in network mode; default and CI must not access real providers
- Fixture-first adapters; no default live HTTP transport

## Runtime Contract

- Composer → TaskDraft → RuntimeClient.submitTask() → AgentLoopRuntime → TaskEvent → RuntimeSnapshot → UI projections remains the only data flow
- TaskEvent append-only, JSON-serializable, replayable
- MVP2/MVP3 read-only MCP boundary: resources/read and policy-approved read-only tools/call only
- No parallel source of truth for task state

## UI Skeleton

- AppShell, UIProvider slice-store architecture, SettingsShell, theme tokens, motion tokens, ComingSoonGate/FeatureGate
- No React component may directly call ProviderAdapter, ProviderHttpTransport, McpSession, StreamableHttpTransport, LegacySseTransport, child_process, fs, or browser automation

## Boundary Invariants

- React components do not invoke real HTTP, child_process, fs write, or browser automation
- No raw secret/API key/Authorization in UI state, TaskEvent, AgentTrace, RuntimeSnapshot, diagnostics, audit, session, artifact, test snapshot, or log
- No default live provider network access
- No real UE write, real mutating MCP tools/call, or product shell/browser/filesystem behavior
