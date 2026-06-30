# UAgent MVP Roadmap

## MVP0 - Project Foundation

- TypeScript monorepo baseline with pnpm workspaces
- Shared type definitions for messages, plans, tools, and evidence
- Runtime state machine placeholder
- MCP client type stubs
- Basic quality tooling: ESLint, Prettier, TypeScript, Vitest

Status: complete

## MVP0.5 - UI Shell Foundation

- Tauri 2 + React + Vite desktop shell
- AppShell skeleton: TitleBar, LeftSidebar, Workspace, InspectorPane, GlobalOverlays
- Dark theme token system and animation token system
- Three-column layout with inspector open/close state
- ComposerDock and ConversationViewport placeholders
- UI smoke tests with Testing Library

Status: complete

## MVP1 - Mock Product Shell + Runtime Contract

- Shared contract for `TaskDraft`, `TaskRecord`, `TaskEvent`, `RuntimeSnapshot`, `RuntimeClient`, `EvidenceRecord`, and `ApprovalRequest`
- Deterministic `MockRuntime` in `packages/runtime`
- Composer submit flow: input -> `TaskDraft` -> `RuntimeClient.submitTask()`
- Runtime event stream: `task_submitted`, `plan_created`, `tool_started`, `tool_completed`, `evidence_created`, `review_created`, `task_completed`
- Failure injection with `#fail` and cancellation events for UI regression coverage
- Desktop runtime store adapter inside the existing UIProvider slice-store architecture
- ConversationViewport, UtilityDrawer, and LeftSidebar rendering from the active task events
- Provider/model guardrails: model-not-configured does not block mock flow, and no provider call is made

Status: complete

## MVP2 - MCP Read-only Runtime

- MCP client implementation with Streamable HTTP default and legacy HTTP + SSE compatibility
- Unreal MCP initialize and discovery
- Read-only tool/resource listing
- Read-only task events emitted through the MVP1 Runtime Contract
- `MockRuntime` remains as fallback/demo/test runtime

Status: complete

## MVP3 - Agent Core / Runtime Planning Loop

- Shared Agent contracts for `AgentPlan`, `AgentPlanStep`, `AgentObservation`, and `AgentReport`
- Deterministic planner that converts a `TaskDraft` into an auditable plan without calling an LLM or provider API
- Guarded read-only action selection for MCP `resources/read` and policy-approved read-only `tools/call`
- AgentLoop orchestration for plan -> guarded action -> observe -> evidence -> report
- Mock observation fallback when MCP is disconnected or connected but not discovered
- TaskEvent and RuntimeSnapshot display for plan, steps, observations, evidence, report, failures, blocked actions, and cancellation

Status: complete

## MVP4 - Provider Adapter Implementation / Real Provider Boundary

- Secret-safe Provider config model using secretRef and redacted state (no raw secrets in UI/state/event/trace)
- Disabled / fixture / live opt-in network mode boundary (default and CI do not access real external providers)
- OpenAI-compatible and Anthropic-compatible fixture-first adapter implementations with protocol matrix
- ProviderRuntimeEvent to TaskEvent / AgentTrace / Conversation / Diagnostics / Evidence stable mapping
- AgentLoop provider-assisted mode (default off, provider output never bypasses read-only tool policy)
- ProviderSettings, Composer, Conversation, AgentTrace, RuntimePanel, DiagnosticsPanel secret-safe observability
- MVP4 scenario matrix, manual smoke suite, side-effect scan hardening, and docs/mvp4-acceptance.md

Status: complete

## MVP5 - Workflow & Safety

- Risk classification and safety policy (ToolRiskLevel: read_only, low_risk, medium_write, high_write, destructive)
- Approval workflow: policy/classifier, runtime approval gate with pause/resume, decision API, UI projection
- Sandbox execution mode: SandboxPolicy, FixtureSandboxAdapter, runtime bridge, evidence mapping, UI projection
- ChangeSet rollback/promote: shared contracts, reducer, fixture promote/rollback adapter, UI cards, audit mapping
- Audit log and session history: AuditEvent projection, SessionSummary, replay/filter, secret redaction regression
- UI integration: Composer readiness, conversation task cards, UtilityDrawer safety/audit/changes tabs, Settings safety controls, FeatureGate a11y
- MVP5 scenario matrix: 20 named scenarios with 20+ assertions, secret redaction, provider boundary regression, MCP mutating blocked regression
- Side-effect and secret scan: repeatable scan script, 0 blocked findings

Status: complete

Out of scope for MVP5: default live provider network access, raw API keys in UI state/events/traces/audit/session, real UE write operations, real mutating MCP tools/call, product shell/browser/filesystem behavior, production-grade OS sandbox, new state management, new routing, or a new design system.

## MVP6 - UI Productization & Project Workspace Shell

- Welcome-first Project Workspace Shell with compact Composer as the default first view
- TitleBar productization with local mode, MCP read-only, provider fixture, and no-network status
- LeftSidebar three-mode shell: Project, Conversation, and static Asset Browser
- Static UE-style asset browser fixture based on in-memory mock project data only
- Staged attach menu for File, Asset, Screenshot, and Context Pack, all disabled with tooltips
- Utility Drawer with Review, Diagnostics, Runtime, Agent Trace, Safety, Audit, and Changes panels retained
- Terminal, Browser, Files, UE, Logs, and Asset Search exposed only as disabled future tools
- Six-page Settings Center: General, Profile, Appearance, Config, Personalization, Provider
- Provider-to-Composer model and reasoning sync with secretRef-only provider configuration
- MVP6 scenario matrix with 30 named scenarios and behavior assertions
- Side-effect scan remains 0-blocked for live network, filesystem, shell/browser, UE write, mutating MCP, and raw-secret boundaries

Status: complete

Out of scope for MVP6: real UE project scanning, real filesystem reads/writes, terminal/browser/filesystem product controls, screenshots, real Asset Registry, default live provider network, raw API key storage, mutating MCP tools, a real light theme, new state management, new routing, or a new design system.

## MVP7 - Real Project Index & Capability Bridge

- Shared contracts for `ProjectProfile`, `ProjectIndexSnapshot`, `AssetIndexEntry`, `SafeFilePreviewResult`, `CapabilityRequest`, `CapabilityDecision`, and capability runtime events.
- Deterministic fixture Project Registry, Project Indexer, Asset Index classifier, Safe File Preview, and Capability Bridge in runtime.
- Path policy helpers for normalization, root containment, ignored dirs, preview allowlist, binary/large-file blocking, and UI path redaction.
- Config Settings Project roots / Project index section with validate, trust, scan, cancel, retry-ready controls.
- Asset Browser can switch from MVP6 fixture fallback to index-backed assets, search/filter current snapshot without rescanning, show asset details, and request safe previews through store actions.
- Utility Drawer Runtime dashboard summarizes Files, Terminal, Browser, and Screenshot capability policy without executing shell/browser/capture/write behavior.
- MVP7 scenario matrix covers 50 named scenarios and 80+ behavior assertions while preserving MVP5/MVP6 regressions.
- Side-effect scan includes project-index and capability-bridge categories with 0 blocked findings expected.

Status: complete

Out of scope for MVP7: real file writes, deletes, renames, mkdir, workspace mutation, true terminal execution, browser automation, screen capture, default live provider network, raw secrets or raw home paths in UI/runtime/audit/session, UE write pipelines, and mutating MCP calls.

## MVP8 - Native Read-Only Filesystem Bridge

- Shared contracts for `NativeProjectRoot`, `NativeRootTrustRecord`, `NativeRootRef`, `NativeRootKind`, and `ReadOnlyFilesystemPolicy`.
- Tauri 2 native Rust commands for `validate_native_project_root`, `trust_native_project_root`, `scan_native_project_index`, `cancel_native_project_scan`, and `preview_native_project_file`.
- `NativeProjectAdapter` bridge layer with fixture fallback in non-Tauri environments.
- Real project scanner with deterministic breadth-first traversal, policy-constrained limits, file classification, and error handling.
- Safe file preview with extension allowlist, binary detection, line/byte limits, and secret/home-path redaction.
- Path redaction, root containment, symlink escape blocking, and dangerous root rejection at the bridge boundary.
- Scan progress events streamed through the runtime event contract.
- Capability Bridge Files mode extended with `native_read_only`; all write/exec/capture/browser capabilities remain blocked by default.
- MVP8 scenario matrix and side-effect scan with 0 blocked findings expected.

Status: complete

Out of scope for MVP8: real filesystem writes/deletes/renames/moves, terminal execution beyond proposals, browser automation, screenshot capture, UE Editor launch, default live provider network, automatic file watchers, incremental rescan, raw absolute path or raw secret leakage into UI/DOM/audit/tests.

## MVP9 - Controlled Terminal, Browser/Screenshot Preview & Incremental Watching

- **Controlled Terminal Dry-run & Approval-bound Execution**: Real command proposal with explicit user approval before execution. Sandbox-bounded shell execution for build commands and automation scripts.
- **Browser/Screenshot Preview**: Local browser preview of HTML/UE output. Screenshot capture of UE Editor viewport. Both user-initiated, approval-gated, and read-only.
- **Incremental File Watcher**: Watch project root for file changes and emit index update events. No automatic rescan; user-initiated diff-based update.
- All new MVP9 capabilities pass through Capability Bridge policy gate.
- Approval/Sandbox/Audit/Session/Redaction boundaries remain non-negotiable.
- Provider live remains manual opt-in with secret management.
- No automatic side effects without explicit user action.
- Shared contracts: TerminalCommandProposal, BrowserPreviewSession, ProjectWatchSession, ProjectIndexDiff
- Terminal policy: command risk classifier, allowlist/denylist, proposal generation, fixture dry-run adapter
- Browser/Screenshot policy: local-only URL policy, blocked external URLs, fixture adapters
- Watcher policy: trusted root reuse, debounce, diff computation, overflow detection
- Capability Bridge extended with terminal_exec, browser_preview, screenshot_capture, project_watcher
- TaskEvent/AuditEvent/Session extended with MVP9 event types
- Side-effect scan extended with 5 MVP9 categories: terminal-exec, browser-preview, screenshot-capture, watcher, raw-output boundaries
- MVP9 scenario matrix: 17 scenarios covering terminal, browser, screenshot, watcher, capability defaults

Status: complete

## MVP10 - Controlled Real Local Execution & Build Loop (Final Acceptance Complete)

- **Real Terminal Execution** (COMPLETE): Default disabled, allowlisted commands only, approval-bound, cwd-contained, output redacted, no-shell wrapper.
- **Build Loop** (COMPLETE): 12 verification command templates with risk classification and one-time approval tokens.
- **Approval Token System** (COMPLETE): One-time tokens issued only from stored native proposals and bound to proposal + command + cwd; prevents replay and unauthorized execution.
- **Terminal Classifier Hardening** (COMPLETE): No-shell parser, exact allowlist, denylist with dangerous pattern detection, env sanitization, mutation detection.
- **Native Real Terminal Adapter** (COMPLETE): Rust Command with timeout, cancel, redaction, feature-gated. Uses native proposal registry approval (not raw token minting).
- **Real Incremental Watcher** (COMPLETE): Native `notify` watcher behind `UAGENT_ENABLE_REAL_WATCHER=1`, dirty/queued state, read-diff only, debounce/backpressure limits, redacted/root-relative paths, and no auto-rescan/write behavior.
- **Local Browser Preview** (COMPLETE): Native classifier/open path behind `UAGENT_ENABLE_REAL_BROWSER=1`, localhost/127.0.0.1 policy, trusted-root `file://` containment, redirect guard, redacted target summaries, active project root propagation, async Tauri WebviewWindow launch, runtime timeout fallback, and replay no-navigation coverage.
- **Runtime Integration** (COMPLETE): Approval token lifecycle, terminal policy, build templates, watcher state/diff, browser preview service, redacted audit/session/evidence, and replay no-execution/no-navigation paths are wired.
- **UI Integration** (COMPLETE): TerminalPanel proposal/approval UI, Composer command suggestions, Settings gate status, WatcherPanel dirty/diff controls, BrowserPanel policy/status controls, and runtime store bridges are wired.
- **Final Acceptance** (COMPLETE): G7/G8/G9/G10/G11 are accepted complete, final verification commands pass, side-effect scan remains 0 blocked / 137 review, and boundary review confirms no terminal, watcher, browser, replay, or redaction rule was weakened.

Status: complete

Out of scope for MVP10: UE Editor writes, mutating MCP tools, default live provider network, arbitrary shell execution, external browser automation, real screenshot capture, automatic watcher rescan, automatic code fixes, dependency installation.

## MVP11 - UE Read-only Diagnostics & Build Failure Analysis

- **UE Metadata Parser**: Parses `.uproject`, `.uplugin`, `Target.cs`, `Build.cs`, and Config INI summaries from indexed/read-only previews only.
- **Project Diagnostics**: Reports missing module source, missing plugin descriptor, target missing module, suspicious dependencies, redacted config keys, binary preview blocks, and permission denied as diagnostics.
- **Build Failure Analysis**: Parses recorded terminal output summaries for UBT/MSBuild/MSVC/Clang/TypeScript/Rust/Vite/ESLint-like errors without re-running commands or storing raw stdout.
- **MCP Read-only Diagnostics**: Converts discovery and `resources/read` observations into diagnostic context while mutating tools remain policy-blocked.
- **Context Pack v1**: Produces local redacted sections for project overview, diagnostics summary, build failures, important files, MCP observations, and safety boundaries.
- **UI Integration**: DiagnosticsPanel, ReviewPanel, Evidence panel, Config settings, and TerminalPanel expose MVP11 summaries through existing UIProvider/slice-store patterns.
- **Audit/Session/Replay**: Diagnostic/context pack events are recorded as redacted summaries; replay does not re-read native files, access MCP, restart watcher/browser, or re-execute terminal commands.
- **Security Regression**: Side-effect scan includes MVP11 diagnostics, redaction, terminal-entry, native UI import, and no auto-fix/provider-live categories.

Status: implemented

Out of scope for MVP11: UE writes, automatic fixes, mutating MCP `tools/call`, provider live defaults, arbitrary shell expansion, automatic git operations, GitHub Actions/CI workflow files. MVP12 may plan controlled UE write workflows, but MVP11 does not implement them.

## MVP12 - Controlled UE Text Repair Loop

- **ChangeSet v2 Contracts**: Adds repair proposal, text mutation policy, operation kinds, lifecycle states, apply/rollback requests, verification results, and redacted evidence payload contracts.
- **Policy / Diff / Redaction**: Classifies allowed UE text targets, blocks binaries/generated dirs/root escapes/stale hashes, renders unified/display diffs, and redacts raw roots, home paths, secrets, and approval tokens.
- **Deterministic Repair Engine**: Generates deterministic proposals for Build.cs dependencies, Target.cs missing modules, missing plugin disabling, config redaction, malformed descriptors, and build-error location notes.
- **Native Text Mutation Bridge**: Tauri commands preview/apply/rollback/status controlled text mutations with backup snapshots, atomic write, and hash-checked rollback.
- **Runtime / Store / UI**: Desktop runtime state, ChangesPanel, DiagnosticsPanel, Settings, Evidence, and ProjectTree markers expose proposal, approval, apply, verification, rollback, and file marker state.
- **Verification and Rollback**: Verification is user-triggered and allowlist-only; failed verification suggests rollback but does not auto-rollback.
- **Security Regression**: Side-effect scan includes MVP12 text mutation, binary write, root containment, replay, git/install, provider live, MCP mutation, and redaction boundaries.
- **Scenario Matrix and Smoke Docs**: Runtime matrix covers 24 scenarios / 96 assertions; manual smoke S1-S15 is documented, with native app steps left for supervisor local复核.

Status: implemented

Out of scope for MVP12: binary UE asset writes, generated/cache directory writes, mutating MCP, provider live defaults, automatic LLM repair, arbitrary shell expansion, automatic git operations, dependency installs, replay re-apply, and GitHub Actions/CI workflow changes.

## MVP13 - Controlled UE Editor / MCP Mutation Pilot

- **Editor Session Contracts**: UE Editor capability, session, state, operation proposal/result/risk, and replay-only summary contracts.
- **Operation Policy**: Editor operations classify as read-only, state-only, text-backed ChangeSet, blocked asset write, or blocked unknown.
- **Native UE Bridge Skeleton**: Tauri commands for capability, config validation, attach/launch/stop/status, propose/approve/execute/cancel; disabled by default behind `UAGENT_ENABLE_UE_EDITOR_BRIDGE=1`.
- **Operation Approval Registry**: Proposal/session/root/kind/args-hash/expiry-bound one-time approvals for state-only editor execution.
- **MCP Mutation Pilot**: Mutating MCP tools default blocked; exact allowlist with schema and dry-run required before proposal.
- **Dry-run Mapping**: State-only dry-runs map to editor operation proposals, text-backed dry-runs map to ChangeSet v2, and asset-risk dry-runs map to blocked asset plans.
- **UI Integration**: Editor and MCP mutation panels plus Changes/Review/ProjectTree runtime summaries expose disabled, blocked, approval-required, executed, and replay-only states.
- **Security Regression**: Side-effect scan includes MVP13 UI native editor, MCP tools/call, asset mutation, editor save, provider live, raw args/secrets, and replay re-execute boundaries.
- **Scenario Matrix**: Runtime matrix covers 32 scenarios / 128 assertions.

Status: implemented

Out of scope for MVP13: default real UE launch, Save All, asset save/delete/rename/move/compile, generic mutating MCP `tools/call`, provider live defaults, automatic provider-output apply, automatic git operations, dependency installs, and CI workflow changes.

## MVP14 - Real UE Attach / Status / Safe Editor Observation

- Real UE attach/status smoke hardening across supported local UE versions.
- Process lifecycle observation and cancellation without project save side effects.
- Narrow Unreal MCP schema adapters for selected dry-run-capable tools.
- Asset mutation planning UX that remains blocked until a later explicit write approval design.

Status: implemented; minimal real Windows process discovery is implemented and supervisor-local real UE smoke passed.

Goals:

- Discover, attach, and observe UE Editor process metadata under `UAGENT_ENABLE_UE_EDITOR_BRIDGE=1` and trusted root binding.
- Keep real launch behind `UAGENT_ENABLE_UE_EDITOR_LAUNCH=1` with allowlisted arguments and no shell string execution.
- Record heartbeat, snapshot, evidence, audit, and replay summaries without raw paths, raw args, approval tokens, secrets, or native re-execution during replay.
- Keep state-only editor operations on the MVP13 proposal/approval/execute path.

Non-goals:

- UE asset writes, Save All, SavePackage, binary asset mutation, or Blueprint compile execution.
- Broad mutating MCP `tools/call`.
- Provider live defaults, automatic provider-output apply, automatic git operations, dependency installs, or CI workflow changes.

MVP15 reserved direction:

- Blocked-by-default asset mutation approval design and Blueprint compile planning, with explicit policy, evidence, rollback, and supervisor-local smoke requirements before any write execution.

## Non-Goals

- Cloud deployment or SaaS platform
- Real-time collaboration
- Plugin marketplace
- Mobile or web-only client
- Direct fork or embedding of Codex/Claude Code/Cursor/Aider
- Real UE write execution, mutating MCP tools, approval write execution, or LLM/provider API calls during MVP3
- Default live provider network access or raw API keys in UI state/events/traces during MVP4
- Real project scans, terminal/browser/filesystem controls, screenshots, or UE writes during MVP6
