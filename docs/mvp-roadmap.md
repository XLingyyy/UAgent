# UAgent MVP Roadmap

## MVP15D - Final 15A-15C/D16 Live Acceptance

- Final Pre-live Source Closure Rework 7: historical `PARTIAL / NEEDS_FIX`; no
  checkpoint was created.
- Final Pre-live Source Closure Rework 8 (actual bridge orchestration and exact
  window instance ownership): `Review Verdict: NEEDS_FIX`; no checkpoint was
  created.
- Final Pre-live Source Closure Rework 9: implementation and controlled
  verification have `Review Verdict: PASS` at implementation commit
  `aa14363f15d8bdc8eaf392c67cf444496cc8a968`. Authorized exact-manifest TEMP
  cleanup removed all 4,601 roots with zero failures/residuals; fresh asset
  `40/40` and bridge `14/14` regressions left zero matching roots. The TEMP
  cleanup external gate is `PASS`; no live gate advanced.
- Final Live Acceptance Resume Rework 1: source content and controlled
  verification have `Review Verdict: PASS` at implementation commit
  `de248a7028d21c53c26db7b28930d583566580a6`. Rendered N1-N8 controls use the
  production adapter; N1/N2 use real registration authority and N7/N8 bind
  actual MCP outcomes. No clean-checkout 15A-15C gate advanced.
- Final Live Acceptance Resume 2 Rework 3: retained-transcript privacy content
  has `Review Verdict: PASS` at implementation commit
  `25d1262528e0976d24f96056975fdb36bc790b77`. Truncated quoted secrets fail
  closed, punctuation tails remain covered, and parsing is bounded. Invalid
  Resume 2 cleanup is `SATISFIED` after an independent 2026-08-14 zero-residual
  scan; no live gate advanced from cleanup alone.
- Final Live Acceptance Resume 3 Rework 1: live bridge isolation, exact
  guardian/listener ownership and strict real UE restart receipt consumption
  have `Review Verdict: PASS` at `0b47dd41e92f941f87c45c5694ec75d2cc932771`.
- Final Live Acceptance Resume 4: the source-only UE 5.8 `BuildPlugin`
  descriptor verifier repair has `Review Verdict: PASS` at implementation
  commit `a780fc4231b99b39153fb88c9ab460717610b3f3`. Its pre-repair live lineage was
  invalidated and removed; no live gate advanced.
- Final Live Acceptance Resume 5: the source-only official Automation-report
  UTF-8 BOM repair has `Review Verdict: PASS` at implementation commit
  `7916cf74cb205049e1c8967b9217cb8b64df36ca`. The pre-repair run reached a
  successful fixed three-test report, but its entire live lineage was
  invalidated and removed after the repair; no live gate advanced.
- Final Live Acceptance Resume 6: the source-only exact-once creation-FILETIME
  provenance repair and required scanner closeout have `Review Verdict: PASS` at
  implementation commit `8b2ba0bf83e70f6ecdddb12202b6cb80732300fa`.
  Its diagnostic `3 / 3 / 0 / 0` live lineage predates the repair and cannot
  advance 15A.
- Final Live Acceptance Resume 7: the D16.5 source-only raw-report verifier and
  two-inventory bridge have `Review Verdict: PASS` at implementation commit
  `33743bb8327b7ca8bdf5aff6469db46503c01c67`. No live gate advanced.
- Final Live Acceptance Resume 8 Rework 1: exact Windows verbatim local-drive
  normalization has `Review Verdict: PASS` at implementation commit
  `af483722d08212374f67bfc756fa34b79e195e8c`.
- Final Live Acceptance Resume 9: the managed headless UE guardian repair has
  `Review Verdict: PASS` at implementation commit
  `51cdf22753ae2f9d90a0e3d5cb03df8495fa7e46`. Its pre-repair 15A `3 / 3 / 0 /
  0` and 15B failure remain source-invalidated partial evidence; the accepted
  source adds `-NullRHI` and requires a fresh build/15A restart.
- Final Live Acceptance Resume 10: the exact six-artifact companion package
  allowlist repair has `Review Verdict: PASS` at implementation commit
  `4b6e2fa35ad999882dd3b50d697ab7cb36a1552e`. The pre-repair clean run passed
  the fixed Automation matrix and reached rendered `confirmTrust`, then rejected
  its own sealed native-binding resource. The repair and matching test fixture
  compiled through official UE 5.8.1 BuildPlugin; no patched live gate advanced.
- Final Live Acceptance Resume 11: the case-sensitive canonical manifest key
  ordering repair has `Review Verdict: PASS` at implementation commit
  `f14dc69543a42d553542b73547c3598fb39947b6`. Its clean predecessor lineage
  reached the exact-six prerequisite and exposed `manifest_self_hash_mismatch`;
  the source and positive self-hash regression compile through official UE 5.8.1
  BuildPlugin, while patched live gates remain unrun.
- Final Live Acceptance Resume 12: the late-Tauri fixed-adapter bootstrap repair
  has `Review Verdict: PASS` at implementation commit
  `38cec6f3e11af1e4b991430d3941e71c57d2c45d`. Its predecessor-source ExactSix
  and fixed 15A passed, then rendered 15B exposed native-enabled/UI-disabled
  capability divergence. The source repair and complete web/workspace matrices
  pass; post-repair live gates remain unrun.
- Final Live Acceptance Resume 13: the clean `38cec6f...` lineage passed ExactSix
  `1 / 1 / 0 / 0` and fixed 15A `3 / 3 / 0 / 0`, then rendered 15B failed closed
  because the pre-index editor config requested fixture `Game.uproject` instead
  of the validated `FinalHost.uproject`. The descriptor derivation repair has
  `Review Verdict: PASS` at historical implementation commit
  `c60a094e0225d19e10238618abfeb73c299eacf0`; post-repair live gates remain open.
- Final Live Acceptance Resume 14: the clean `c60a094e...` lineage passed
  ExactSix `1 / 1 / 0 / 0` and fixed 15A `3 / 3 / 0 / 0`, then rendered 15B
  failed closed because a direct managed-process boundary sent the UI's opaque
  trusted-root token to native validation. Boundary-local resolution and its
  full direct create/attach regression have `Review Verdict: PASS` at historical
  implementation commit `9d04ef710eff5a8c2aebdf0c92076e8ee477c1f5`.
- Final Live Acceptance Resume 15 first interim checkpoint: the clean `9d04ef7...` lineage passed
  ExactSix `1 / 1 / 0 / 0` and fixed 15A `3 / 3 / 0 / 0`, then rendered 15B
  exposed legal notification `HTTP 202` empty-body handling and incomplete
  exact-six descriptor contracts. Both source repairs have an interim
  `Review Verdict: PASS` at historical implementation commit
  `f5b514c7ac78a47c233bfdbae9e3f2d70840a08f`.
- Final Live Acceptance Resume 15 second interim checkpoint: the clean
  `f5b514c...` lineage passed ExactSix `1 / 1 / 0 / 0` and fixed 15A `3 / 3 / 0
  / 0`, then rendered 15B exposed managed observation-source rejection, a
  first-connect error requiring bounded recovery, and exact-six identity
  aggregation across legal MCP meta tools. All three repairs have `Review
  Verdict: PASS` at historical implementation commit
  `6fb99447f3158c9f0326c93774fe03c5319762ff`.
- Final Live Acceptance Resume 15 third interim checkpoint: clean `6fb9944...`
  passed ExactSix `1 / 1 / 0 / 0` and fixed 15A `3 / 3 / 0 / 0`, then rendered
  15B exposed order-sensitive comparison of equal renderer predecessor-window
  records. The repair has `Review Verdict: PASS` at historical implementation
  commit `96e7183f9bb6644bf72191b68277b112c33ccc1d`.
- Final Live Acceptance Resume 15 fourth interim checkpoint: the clean
  `96e7183...` lineage passed ExactSix and fixed 15A, then formal rendered 15B
  exposed five successor/process/ancestry/session/contract defects. Their four-file
  repair has `Review Verdict: PASS` at predecessor implementation commit
  `e20a9921caf77d1ac05c95ff8811acef9c63938a`. A fifth interim checkpoint at
  `bb89126d82416f0958050405ff1ab693505614f7` extends the bounded owned live-phase
  budget to 600 seconds. Its clean chain completed the rendered 15B producer and
  exposed retained-event process-identity key drift. A sixth interim checkpoint
  at `39bccbc4a88d925bd3f44ad5c5a44add10a48b39` preserves validated hashes and
  continues binding raw values. Its clean chain exposed a stale observation
  binding after retained session/PID conversion; seventh interim checkpoint
  `9fc667bceeaf81bcd087cec0f690c76bf067ad9f` recomputes the binding over the final
  retained material. Its clean rendered producer exposed a runner lookup against
  filtered phase events. Eighth interim checkpoint
  `e50022ddecf0c6a19ceb4d78dc8eb54b5e118f0b` validates the canonical raw-runtime
  file and recovers its cross-bound PID binding. Its clean lineage passed release,
  ExactSix and fixed 15A before rendered 15B exposed predecessor-generation drift.
  Ninth interim checkpoint `3331e220f53f528c7cc98e61efc927428d4eaeca`
  captured a verified ready snapshot; its clean lineage proved that snapshot still
  used a later mutable observation. Current tenth checkpoint
  `8c78b172dd7ac03c7d38f0d28cc157611e4a63a7` binds restart to the immutable
  native connect-receipt generation. Current eleventh checkpoint
  `f50b836cfd5370f4f01d3bb5e1cf79a42ccd48ed` accepts same-session advancing
  `stale_completion` while retaining fail-closed session replacement for the
  connection and restart boundaries. The same task remains active.
- The distinct Final Source/Tooling Rework 8 checkpoint dated 2026-08-03 is a
  historical `COMPLETE / PASS` record at implementation commit
  `98c8b387e1124a519977849d48ab824e4e6bb9c5`.
- G14 documentation consistency: `IMPLEMENTED` after the current evidence and
  stale-state reconciliation.
- G15 checkpoint integrity: `COMPLETE`; current implementation commit
  `f50b836cfd5370f4f01d3bb5e1cf79a42ccd48ed` is recorded by this documentation
  closeout. Earlier accepted repairs retain their historical scopes.
- G16 authority provenance and plugin baseline: `PARTIAL`.
- UE identity: `5.8.1` / engine CL `56057345` / compatible CL `55116800` /
  module BuildId `55116800`.
- Desktop bundling: `IMPLEMENTED`; icon preflight, MSI, and NSIS passed.
- Real UE 5.8.1 compatibility: `PARTIAL`; the Rework 2 read-only attempt is
  historical and the full clean-commit matrix remains deferred.
- D13 / 15A live execution: `DISPATCHED` from a fresh clean checkout of
  `f50b836cfd5370f4f01d3bb5e1cf79a42ccd48ed`.
- D14 / 15B: `WAITING_ON_15A`; not run.
- D15 / 15C: `WAITING_ON_15A_15B`; no asset mutation was attempted.
- D16: `IN_PROGRESS`.
- Overall MVP15 final acceptance: `PARTIAL`.
- Ready for the next MVP stage: `NO`.
- Current `PASS_REAL_SMOKE`: `NO`.

- Final Pre-live Source Closure Rework 1-4: historical `PARTIAL`, supervisor
  `NEEDS_FIX`, no checkpoint.
- Rework 5: historical `PARTIAL / NEEDS_FIX`; no checkpoint.
- 2026-08-08 Rework 6: historical `PARTIAL / NEEDS_FIX`; no checkpoint.
- 2026-08-08 Final Pre-live Source Closure Rework 7: historical
  `PARTIAL / NEEDS_FIX`; no checkpoint.
- 2026-08-09 Final Pre-live Source Closure Rework 8 remains `NEEDS_FIX`; Rework 9
  is the reviewed implementation. Two actual `App` registrations each enter production
  `startMvp15dRuntimeBridge(invoke)`: the predecessor consumes the native driver
  and requests restart, while the successor reads pending configuration,
  activates its distinct adapter, claims once, publishes, and completes. The
  parent now registers exact one-shot completion before destroying only the
  captured Tauri-injected predecessor. An off-main bounded wait holds no bridge
  mutex and queues the successor build from a later main-thread continuation
  after authoritative `Destroyed`/manager removal. The continuation revalidates
  identity and occupancy; atomic timeout gates suppress late destroy/build.
  Hidden real Webview/Wry coverage reproduces the old same-task collision as
  `WebviewLabelAlreadyExists("main")`, proves pre-removal build count 0 and a
  different-HWND successor, and injects replacement B before continuation; B is
  preserved and no third window is built. The asynchronous two-App harness
  returns the request before parent-ready and then observes ordered
  destroy/build/acknowledgement. A parent-only opaque instance digest remains in
  the stable identity hash without changing acknowledgement v2, claim v3,
  window identity v1, or product summary v2 wire schemas. The Rework 7
  cleanup manifest is 4,601 entries (4,591 asset, 10 bridge), SHA-256
  `45b870c32fbf48c20bf1545dbdaf7ac58c036c400b521677fccd22e4dae9d893`.
  On 2026-08-12, explicit R3 authorization and complete containment,
  reparse/link, exact-set and live-owner preflight preceded exact deletion.
  Cleanup removed 837 files, 4,717 internal directories and all 4,601 roots;
  failures/residuals were zero. Asset `40/40` and bridge `14/14` regressions
  passed and left zero matching roots. Earlier mtime-only drift remains
  unattributed historical evidence; no live Gate advanced, and Rework 9 is checkpointed at
  `aa14363f15d8bdc8eaf392c67cf444496cc8a968`.

Rework 7 preserved the sole publisher, transitive source boundary, observer,
reparse rejection, and cleanup controls, but its standalone verifier accepted a
coherent fully hand-authored evidence chain. Rework 8 separates retained-file
consistency from launch ownership. Exported verifiers and CLI `verify` return
`*_persisted_consistency_verified` with
`productionLaunchAuthorityVerified: false`; coordinated public JSON and hashes
may prove consistency but cannot prove who launched the producer. Only the
same-process `executeLivePhase()` path can return `*_owned_launch_verified`
after fixed non-injected launch, actual child termination/event checks, full
cross-binding, and consumption of an unexported single-use object-identity
receipt. The publisher's earlier in-process brand is not claimed to survive
serialization.

The source identity now uses a deterministic production boundary: 336 files
discovered from 14 roots plus 28 exact files, 9 exclusion classes, 126 excluded
entries, and a 357-entry source/Git watch set. It covers transitive native,
renderer, Settings, runtime/MCP/shared, build/lock/config, final tooling, and
companion plugin inputs. New production files are included automatically and
tracked production deletion makes the identity dirty. Normal repositories,
worktrees, symbolic/detached HEAD, loose/packed refs, and same-branch commits
are regression-covered.

Real Windows fixture observation, PID/creation mismatch, intermediate
`Binaries`/`Win64` junction rejection, and fail-closed cleanup regressions pass.
Fifteen inherited fixture directories plus one transient residue were removed
after exact target and no-live-owner checks; final matching process and temp
counts are zero.

Historical Final Source/Tooling Rework 4 supplied the production Tauri event-file bridge, real renderer/native
handshake, asynchronous Windows Job-owned product/UI orchestration, and an
official Unreal Automation report parser with exact UAgent task markers. The
then-fresh release `uagent.exe` passed capability-only probes for native,
normal-product renderer, and rendered UI boundaries with zero MCP, network,
and asset operations and zero process/file residue. Capability evidence is
kept distinct from live compatibility evidence; no real UE session or
mutation ran.

The compatibility inventory now enforces a closed file/directory allowlist,
deterministic redaction, independent verification, and secret/path rejection.
The unsafe predecessor evidence root was invalidated and removed for
`TOKEN_AND_RAW_PATH_EVIDENCE_INVALID`; no replacement live root exists.

Direct remains the selected D0 registration route; Toolset Registry remains a
closed alternative and is not a production fallback. Retained historical Source Checkpoint Rework 7
D0/build/UE validators continue to pass read-only, but those historical bundles
cannot satisfy final 15A-15C.

The invalid Resume 2 cleanup gate is closed. A new clean-checkout 5.8.1 task is
dispatched from current implementation commit
`f50b836cfd5370f4f01d3bb5e1cf79a42ccd48ed`, covering
both Tool Search modes, exact-six/product
retractions, response framing, clean inventory, and the real loaded-module
observer. Only a later separately authorized task may consider real 15C
mutation.

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

## Historical Baseline — MVP15 Native Authority Binding Rework

- **Sandbox Asset Contracts**: Adds asset mutation dry-run plans, sandbox asset paths, asset ChangeSet lifecycle, approval token binding, verification, rollback, evidence, audit, and replay-only summaries.
- **Sandbox Path Policy**: Allows `create_folder` only at the exact `/Game/UAgentSandbox/<run-id>` root and all later writes only at strict descendants, with mapped `/Content/UAgentSandbox/**` disk paths. Blocks the global root, cross-run/root-prefix confusion, traversal, non-sandbox assets, generated/cache paths, project-wide saves, and broad/bulk asset operations.
- **Exact MCP Asset Adapters**: Permits only schema-checked sandbox dry-run asset operations with rollback contracts and read-only evidence query capability. Generic mutating `tools/call`, unknown tool names, missing dry-run support, incomplete wrapper contracts, raw absolute paths, and provider auto-apply are blocked.
- **Exact-tool Facade**: Wrapper-only endpoints may be adapted only when `describe_toolset` supplies fixed exact method ids, schema versions, input schemas, dry-run schemas, rollback contracts, affected asset schemas, and evidence queries for all six asset operations.
- **Runtime Asset Mutation Service**: Provides deterministic dry-run, preview, approve/register, exact-tool execute, external verify, inverse rollback, manifest, and recorded replay summary behavior; the native-issued raw token is held only until the first execute attempt and never enters ChangeSets, UI/audit, MCP, or replay.
- **Native Asset Mutation Guard Rework**: Resolve trusted roots and UE observation/process facts from native registries, require `UAGENT_ENABLE_ASSET_MUTATION=1`, recheck liveness before every MCP mutation call, retain a maximum 60-second first-execute token, and enforce absolute 15-minute forward / 20-minute recovery deadlines.
- **Partial Failure / Cleanup Contract**: Only an exact `partial_failure` with `sideEffectObserved:true`, rollback availability, evidence, and a registered inverse receives ownership. Cleanup removes only handle-bound, exact-empty registered leaves in reverse ownership order and fails closed on assets, foreign identity, nonempty/enumeration failure, cross-run targets, escapes, or reparse points.
- **Desktop UI Integration**: Inspector Assets and Changes surfaces expose `executed`, `verified`, `rollback_available`, `rolled_back`, stable blocked reasons, redacted per-operation audit, and recorded-only replay with zero runtime side effects. The working tree contains inherited visible Companion status/contract/hash/fingerprint/generation copy in `AssetMutationPanel` and `ConfigSettings` plus matching assertions. Rework 7 did not edit those files or the five TitleBar-coupled files; the inherited copy is not acceptance evidence.
- **Scenario Matrix**: Runtime matrix covers at least 60 scenarios / 240 assertions across allowed paths, denied paths, stale manifest, approval expiry, execution, verification, rollback, replay, exact inventory, facade, and MCP adapter boundaries.
- **Security Regression**: Side-effect scan covers non-empty-token fake verification, unknown-result fail-open, sandbox-only writes, non-sandbox asset paths, Save All, bulk operations, generic wrapper mutation, replay execute/rollback, raw evidence path/identity leakage, provider live defaults, manifest-only real verification, native trust/observation/gate authority, transaction liveness, and pre-trust root references.
- **Reproducible Plugin Baseline**: Repository expectations and missing live identity fields are tracked in [MVP15 UE MCP Plugin Baseline](mvp15-ue-mcp-plugin-baseline.md); an unidentified running plugin is not sufficient acceptance evidence.

Historical status before the MVP15D source-checkpoint rework was `BLOCKED`. The 09Z `PASS_REAL_SMOKE` ledger is historical happy-path evidence only. C11/11A native authority implementation and the complete automated regression passed. C12 identified UE `5.8.0` promoted build `55116800` and six project-local module hashes; C13 retained a task copy; C13B proved isolated task-local DDC and task-owned module/listener startup, although cold-cache port readiness occurred at about `+602.9s`; C13C reached warm readiness at `+33.408s` but left 28 Python bytecode files; C13D proved child-only suppression ineffective. C13E produced a stable `191 = 163 business + 28 cache` one-launch ledger at `+94.338s`, and C13E1 repaired the two supervisor-identified validator defects and was supervisor-accepted. C14 added a deterministic exact-six product-adapter fingerprint; C14A retracts all prior discovery/facade/binding/fingerprint authority before the first reconnect notification and redacts blocked issues to allowlisted names, stable flags, and counts, with adversarial malformed-input coverage. The controlled C14 task-owned Connect/Discover attempt issued one initialization request and then encountered a pre-discovery transport/environment failure, so it produced no schema decision or live fingerprint and all discovery/mutation-family counts remained zero. Separately, the signed Epic sibling modules do not hash-match the active unsigned project-local modules, and no authoritative manifest or source/build attestation maps the active bytes; that mapping gap remains `BLOCKED_BY_MCP_SCHEMA`. Supervisor review accepted the historical C14/C14A implementation at verified commit `37c29cbc7961218bfd71d1809178359952a75e18` and published its documentation closeout. Those facts do not accept the MVP15D source checkpoint. Current source-checkpoint status, D0 route evidence, and next-stage prohibition are defined by the MVP15D section at the top of this roadmap.

Goals:

- Demonstrate a narrow real UE asset mutation pilot that cannot write outside `/Game/UAgentSandbox/**`.
- Preserve MVP12 text ChangeSet, MVP13 editor approval, and MVP14 observation boundaries.
- Require explicit user approval before execution and keep replay strictly summary-only.
- Provide rollback and verification records for every executed sandbox asset ChangeSet.

Non-goals:

- Non-sandbox asset writes, Save All, SavePackage on arbitrary packages, broad/bulk asset operations, Blueprint compile execution, generic MCP mutation, provider-output auto-apply, default live provider access, automatic git operations, dependency installation, and CI workflow changes. The historical pilot design discussed exact approval-bound move/rename and rollback cleanup under a registered run root; it does not accept the current MVP15D source checkpoint or authorize D13/15A/15B/15C work.

## Non-Goals

- Cloud deployment or SaaS platform
- Real-time collaboration
- Plugin marketplace
- Mobile or web-only client
- Direct fork or embedding of Codex/Claude Code/Cursor/Aider
- Real UE write execution, mutating MCP tools, approval write execution, or LLM/provider API calls during MVP3
- Default live provider network access or raw API keys in UI state/events/traces during MVP4
- Real project scans, terminal/browser/filesystem controls, screenshots, or UE writes during MVP6
