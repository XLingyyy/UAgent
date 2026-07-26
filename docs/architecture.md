# UAgent Architecture

## MVP15D Companion Trust Chain

### Current Rework 9 Status — Source Checkpoint Complete

Rework 8 is `NEEDS_FIX` because the current acceptance manifest file SHA
conflicted with retained evidence and the other current repository documents,
while code and retained evidence validation passed. Rework 9 and the D0-D12
source checkpoint are `COMPLETE`. Ready for the next MVP stage remains `NO`
because G13/G16 and 15A-15C remain separately gated.
Previous/current task IDs are
`TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-8` and
`TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-9`.
`BLOCKED_BY_EVIDENCE_RETENTION` is closed by retained D0
`external/mvp15d-rework7-d0-20260726_190100`, build
`external/mvp15d-rework7-build-20260726_203000`, and UE
`external/mvp15d-rework7-ue-20260726_190100`. D0 records 129 indexed artifacts,
zero mutation, and Direct. UE records five sessions, `48/48`, six processes per
ledger, residual zero, and unchanged empty Content.
Verified implementation/content checkpoint
`b1c4e4a4b567d5018c0d0fa7fa1769a26e70f66e` is published with the Rework 9
documentation closeout checkpoint on `main`.

The Rework 5 supervisor review identified these authority gaps: a task-only
observer could forward a mutation guard while public live identity was
incompatible; adapter reconstruction could inherit native authority; stale
native retraction could be reported as applied; Rust, TypeScript, and C++ paired
one binding string with different fact tuples; and directory ownership began
after creation rather than from the exact created object. The ordinary parallel
Rust suite also reproduced shared-registry interference, and the UE runner lacked
per-session descendant-process closeout.

Rework 7 preserves the Rework 6 fail-closed architecture: task-only observation may only
observe/retract; a reconstructed adapter establishes native zero authority
before publication; stale retraction carries an unapplied result bound to its
requested generation; one complete canonical binding tuple crosses
Rust/TypeScript/C++; directory ownership is acquired atomically with creation;
and every task UE session carries a marker-bound descendant-process
creation/exit/residual ledger. Renderer restart begins with native zero
authority; partial/unknown effects retain only bounded inverse recovery, and
run-root cleanup remains handle-bound and exact-empty. Verification includes ten
fresh ordinary Cargo runs, the retained four-session D0 set, and the five-session
UE matrix. Rework 9 changes documentation only and closes the source checkpoint.
No final 15A package or authorized real product mutation exists. D13, 15A, 15B,
and 15C remain prohibited until separately authorized.

### Historical Rework 3 Supervisor Review Note

`UAgentAssetTools` contains task-only Direct and Toolset probes, inverse-dispatch
and non-recursive cleanup improvements, and native module enumeration. The
historical Rework 3 supervisor verdict was `NEEDS_FIX`: its capture producer is UE Commandlet Automation,
not the UAgent product adapter; its C++ and TypeScript ledgers do not carry the
complete session/native-plan/effect authority; and partial/unknown effects are not
settled safely. Desktop state clears locally before notification, but native
approval revocation is fire-and-forget and may still race an immediate guard.

Rework 4 must connect the actual product path, make revocation completion-ordered,
prove positive loaded-module authority, and run the full UE matrix. No route or
source checkpoint is accepted; D13-15C remain disabled.

### Historical Rework 2 framing

`UAgentAssetTools` is the proposed independent UE 5.8 Editor plugin. Rework 2 is
not an accepted implementation baseline: D0 lacks a Toolset Registry spike and
real product capture; the C++/runtime/native inverse protocol and session-scoped
ownership contract remain inconsistent. Epic's
`ModelContextProtocol` remains responsible for localhost MCP transport and
public tool registration; the companion owns only the exact-six asset contract,
strict `/Game/UAgentSandbox/<run-id>` policy, dry-run/structured results, and
session-scoped ownership inverses. Native UAgent remains the trusted-root,
live-observation, feature-gate, one-shot approval, and external Content
evidence authority. The required design accepts execution only after manifest,
installed/loaded module bytes, descriptor identity, current-generation live
fingerprint, external binding, and native registration all agree. Disconnect,
reconnect, endpoint change, or stale discovery retracts the publication before
notifying UI listeners. Only redacted hash prefixes and stable blocker codes are
displayed. The current candidate implements a trusted-root-only native
`attest_mvp15_companion` bridge and rechecks it at every real dry-run, approval,
execute, verify, and rollback service entry. It validates the installed package
manifest, self-hash, exact artifact bytes, and package layout before publishing
anything to the runtime. Because the desktop process cannot infer a DLL loaded
by a separate UE process, it deliberately returns
`loaded_module_evidence_unavailable` until a future native UE bridge supplies
that fact; production readiness remains blocked rather than trusting a
renderer/test injection. Rework 2 now rejects native `blocked` evidence from
positive attestation but fails to atomically retract an older accepted
fingerprint. Rework 3 must supply loaded-byte authority and correct the
retraction, rollback, and ownership paths before this design is implemented.

## Overview

UAgent is an AI Agent Host and Client for Unreal Engine workflows, aligned with the UE5.8 official Unreal MCP Server. It provides a local-first desktop workspace for planning, executing, and reviewing AI-assisted development tasks.

## High-Level Architecture

```text
┌──────────────────────────────────────────────┐
│            Desktop Shell (Tauri 2)            │
│  ┌──────────────────────────────────────────┐ │
│  │           Web Frontend (React)           │ │
│  │  ┌──────────┐ ┌────────┐ ┌────────────┐  │ │
│  │  │ Sidebar  │ │Workspac│ │ Inspector  │  │ │
│  │  └──────────┘ └────────┘ └────────────┘  │ │
│  └──────────────────────────────────────────┘ │
│  ┌──────────────────────────────────────────┐ │
│  │         Native Core (Rust)               │ │
│  └──────────────────────────────────────────┘ │
└──────────────────────────────────────────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
    ┌──────────┐ ┌──────────┐ ┌──────────┐
    │  Shared  │ │ Runtime  │ │ MCP      │
    │  Types   │ │ Engine   │ │ Client   │
    └──────────┘ └──────────┘ └──────────┘
```

## Desktop Shell

### `apps/desktop/src-tauri`

Tauri 2 native shell. The Rust entry point creates the application window and hosts the web frontend. The native core provides policy-gated filesystem access, controlled process execution and observation, trusted-root binding, UE Editor attach/status support, and the approval-bound sandbox asset-mutation guard. Runtime-to-native commands and the localhost MCP client/transport are implemented; unsafe or unavailable capabilities remain disabled or fail closed. The window uses a custom title bar (`decorations: false`) so the React `TitleBar` component can render the drag region and custom controls.

Historical MVP15C-11/11A authority work moved asset-mutation authority into native registries rather than renderer declarations. The trusted-root registry stores an authoritative id plus normalized/canonical binding and filesystem-object metadata; registration resolves that record and fails closed on absence, revocation, detectable replacement, or uncertain containment. A crate-private UE observation validator resolves the live session, process, project, root, redacted PID, process start time, and executable binding and performs a real lifecycle check before registration and each forward/rollback MCP call. Lease renewal is one atomic compare-and-commit over complete current session/process snapshots; stopped is sticky and a stale lifecycle result changes neither lease. The desktop runtime binds registration and complete two-stage discovery publication to one MCP session object, endpoint, and generation. A post-guard local rejection records an explicit no-side-effect outcome, while a native-issued registration that never started can only be retired by its matching one-time token. `UAGENT_ENABLE_ASSET_MUTATION=1` is a separate default-off native gate; UI sandbox state may only tighten it.

Historical C14 adds a read-only exact-six fingerprint at the same desktop publication boundary. Raw direct tools and reviewed facade candidates remain separate until a pure canonicalizer validates exact names/order, descriptor schema version, five required contracts, and facade ids when used. Recursive object-key sorting and array preservation produce a SHA-256 only for a complete JSON-safe contract. C14A makes the publication authority retract-before-notify: creating a new connection generation synchronously clears discovery, facade inventory, MCP binding, SHA, and canonical byte length before endpoint validation, `connecting`/`error`, or any listener callback; stale concurrent connection/discovery completions cannot restore them. The desktop publishes only schema version, hash/byte length, per-tool name/source/hash summaries, allowlisted duplicate names, stable issue flags/counts, and a redacted current-session/discovery-generation binding. Raw unexpected/duplicate names, endpoint, raw session id, path, PID, token, credential, and full schema never enter the publication. Primitive, non-string, throwing/proxy-like, cyclic, and non-JSON inputs fail closed without an accepted hash or uncontrolled error. This adds no mutation entry point and does not change MCP transport or native contracts.

The first execute retains a maximum 60-second one-time token. Its first accepted guard creates absolute 15-minute forward and 20-minute rollback-recovery deadlines that are never extended by heartbeat or retry. Active evidence revalidates root authority and registration-bound paths. The short terminal evidence lease is path-bounded and read-only; it cannot recreate registration, token, operation, or mutation capability. The automated authority ledger is recorded; these contracts remain in acceptance rework until a clean fresh product-UI lifecycle and provenance ledger is recorded.

### `apps/desktop/web`

React 18 + Vite 5 frontend. The UI shell is structured as:

- **AppShell** — composes TitleBar + MainLayout + GlobalOverlays.
- **TitleBar** — custom window title bar with drag region and inspector toggle.
- **MainLayout** — three-column flex layout: LeftSidebar | Workspace | InspectorPane.
- **LeftSidebar** — navigation, project list, static fallback threads, and runtime task threads.
- **Workspace** — central region with ConversationViewport and ComposerDock task submission.
- **InspectorPane** — right-side UtilityDrawer with Review, Diagnostics, Evidence, and Runtime task context.
- **GlobalOverlays** — z-indexed overlay layer for future modals, command palette, and toasts.

Layout behavior:

- Left sidebar has a fixed width.
- Central workspace is flexible.
- Inspector participates in the flex flow on wide screens and becomes an overlay on narrow screens (≤ 899px) so the Composer dock area is never squeezed.
- Inspector open/close transitions use the centralized animation tokens.

### Styling

All visual values are defined as CSS custom properties in `web/src/styles/`:

- `tokens.css` — raw design tokens (colors, radius, spacing, typography, layout dimensions, z-index).
- `theme.css` — semantic tokens mapped to the dark theme (`--ua-bg`, `--ua-text`, `--ua-accent`, etc.).
- `animations.css` — motion tokens (`--ua-ease-standard`, `--ua-dur-fast`, etc.) with `prefers-reduced-motion` support.
- `globals.css` — reset, base element styles, scrollbar styling, and layout utilities.

## Package Structure

### `packages/shared`

Foundation types shared across all packages: messages, commands, plan items, tool calls, evidence records, workspace state, and the MVP1 Runtime Contract. `TaskDraft`, `TaskRecord`, `TaskEvent`, `RuntimeSnapshot`, `RuntimeClient`, `EvidenceRecord`, and `ApprovalRequest` are defined here so runtime and desktop UI consume the same protocol.

### `packages/runtime`

Agent runtime state machine plus the deterministic MVP1 `MockRuntime`. The mock runtime accepts `TaskDraft`, emits ordered `TaskEvent` records, supports `#fail` failure injection, supports cancellation, and reduces events into `RuntimeSnapshot`. It does not import React or desktop UI code.

### `packages/mcp-client`

MCP (Model Context Protocol) client abstraction layer. MVP2 implements JSON-RPC 2.0 message helpers, structured protocol/transport errors, Streamable HTTP transport, legacy HTTP+SSE fallback transport, session lifecycle (`initialize` -> `notifications/initialized`), discovery (`tools/list`, `resources/list`, `prompts/list`), and read-only execution methods (`readResource`, `callTool`). The UE product path uses localhost HTTP transports only; `stdio` remains a generic non-UE type boundary. Above this transport, the runtime applies read-only routing by default and exposes only exact, schema-checked, explicitly approved mutation operations for the registered `/Game/UAgentSandbox/<run-id>` lifecycle. Generic wrapper mutation, non-sandbox writes, and replay execution remain blocked.

### Runtime Router

`packages/runtime` owns `RuntimeRouter`, `McpReadOnlyRuntime`, read-only risk policy, and semantic capability indexing. Desktop UI submits `TaskDraft` through the same `RuntimeClient` surface. The router sends read-only MCP intent to `McpReadOnlyRuntime` only when connected; otherwise it emits `mcp_fallback_to_mock` and uses `MockRuntime`.

React components do not construct JSON-RPC requests or call `tools/call` directly. UI consumes `RuntimeSnapshot`, `TaskEvent`, MCP connection state, and desktop view models.

## Design Principles

- **Local-first**: All data stays on the user's machine. No cloud dependency.
- **Type-safe**: TypeScript throughout, with strict mode enabled.
- **Monorepo**: Clear separation of concerns via pnpm workspaces.
- **Extensible**: Provider-agnostic adapter patterns for LLM backends.
- **MCP-native**: Protocol alignment with Unreal MCP Server for UE5.8.
- **Tool-grade UI**: Desktop AI Agent workbench aesthetic — dense, functional, and extensible. No landing-page or marketing styling.
- **Guarded runtime boundary**: The mock runtime remains available for deterministic fallback and tests, while implemented native, MCP, process-observation, and sandbox mutation paths require explicit capability, trust, approval, containment, verification, and replay guards.
