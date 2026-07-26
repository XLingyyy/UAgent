# UAgent

AI Agent Host and Client aligned with UE5.8 official Unreal MCP Server. UAgent provides a local-first desktop workspace for planning, executing, and reviewing AI-assisted workflows - starting with Unreal Engine game development tooling.

## Current Stage: MVP15D - UAgent UE Companion Plugin Source Checkpoint Complete

Rework 8 is `NEEDS_FIX` because its current acceptance document recorded a stale
retained build-manifest file SHA-256, while the product code, retained
D0/build/UE evidence, and automated implementation gates passed validation. The
previous task was
`TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-8`. The current
task is
`TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-9`; Rework 9 and
the D0-D12 source checkpoint are `COMPLETE`. Ready for the next MVP stage remains
`NO` because G13/G16 and 15A-15C remain separately gated.

`BLOCKED_BY_EVIDENCE_RETENTION` is closed by retained, in-place validated
Rework 7 evidence. D0 is retained at
`external/mvp15d-rework7-d0-20260726_190100`: four product-adapter sessions,
129 indexed artifacts (130 files including `hashes.json`), zero mutation,
`selectedRoute=direct`, transcript-index SHA-256
`b87e0a8a4d685b0cbddd55c8ea5ed4e944b9feba7aaa9d9176e23e2dfdeb0f99`,
`hashes.json` SHA-256
`d393ce454385b32d07fa1a08ac7b8f39f897052dc3ff68daf785fc60d8077106`,
and route-decision SHA-256
`3fee1961461eefe12b68d45657eb0a73879cc009f004bac09076abae2b8b5ce4`.

The retained build/source/manifest bundle is
`external/mvp15d-rework7-build-20260726_203000`: 60 files total (59
inventory-tracked payload files plus `inventory.json`), bundle SHA-256
`ef86e59c05068f9610050a2afa44bf3237d3fd78e82262cf6d3be6660223420b`,
inventory self-hash
`096e92b42f28eda7c227efde9747c33dd7c3c2f8d1e08988af77588f09b83303`,
and manifest file SHA-256
`236f1da71961fd697e81ad0a6d9f53f82076b71019e74400eed8b95f0d69ac84`.
The retained UE bundle at `external/mvp15d-rework7-ue-20260726_190100`
records five sessions, `48/48` Automation cases, six processes per session,
zero residuals, unchanged empty Content, and capture SHA-256
`8794de55d0bc3444015116918b92e957070e684ac014f7f9551c07762af1cbb8`.

Typecheck, lint, build, two consecutive workspace-test processes, Rust format,
ten fresh default Cargo processes, the serial diagnostic, tooling `23/23`,
build-bundle tooling `10/10`, targeted authority/vector checks, and the
side-effect scan completed with exit 0 at 1,039 files / 0 blocked / 1,655 review
findings. The canonical C++/shared/compiled binding fixture is 4,865 bytes with
SHA-256
`771168ec8b6e7215672a4d839fa675d88f9207876e2c51513b26d6c58da56a1b`.
The first historical supervisor workspace-test attempt exited `134` after
shared 33 passed; its later reruns passed. No source-checkpoint blocker remains.

The verified implementation/content checkpoint is
`b1c4e4a4b567d5018c0d0fa7fa1769a26e70f66e`; it is published with the Rework 9
documentation closeout checkpoint on `main`. This accepts the D0-D12 source
checkpoint only.

Historical Rework 5 supervisor verification passed workspace lint, build, tests,
Rust format, tooling, side-effect scan, and retained-evidence hash checks. Its
ordinary parallel Rust suite failed at 146/147 and reproduced shared-registry
interference. That review also found mutation authority reachable from the
task-only observer while public identity was incompatible, missing native
zero-authority startup/stale-retraction guarantees, mismatched
Rust/TypeScript/C++ binding tuples, a directory create-to-identity adoption
window, and incomplete per-session UE descendant-process closeout.

No final clean 15A package, authorized product-UI mutation lifecycle, or
stage-advance decision exists. Real product mutation and D13, 15A, 15B, and 15C
remain prohibited until separately authorized.

## Historical Stage: MVP15 - Native Authority Binding Rework

This historical stage reopened MVP15 for native authority binding acceptance and recorded `BLOCKED` / Ready `NO`. C11/11A delivered the native trusted-root, live observation/process, default-off mutation-gate, and absolute transaction/recovery controls with a green automated ledger. C12 then identified UE `5.8.0` promoted build/changelist `55116800`, descriptor-reported `Unreal MCP` version `1.0`, and six reproducible project-local module hashes. C13 created a retained task copy, and C13B proved that a task-owned UE can use an isolated task-local DDC and reach the exact modules plus a task-owned loopback listener; the cold-cache listener appeared at about `+602.9s`, outside its 600-second gate.

C13C reused that warm DDC and observed all launch-readiness conditions together at `+33.408s`, without connecting to MCP or performing product/native/mutation actions. C13D then proved that child-only `PYTHONDONTWRITEBYTECODE=1` does not suppress the UE embedded runtime's 28 generated cache files. C13E modeled route A as `163` byte-exact business files plus 28 source-mapped `cpython-311` cache paths and produced a clean one-launch ledger at `+94.338s`; supervisor review then found two validator defects. C13E1 repaired and closed those defects: every native path-inspection error fails with `PATH_INSPECTION_FAILED`, `header.valid` reflects the complete header result, the expanded 23-test matrix passes, and the retained `191 = 163 + 28` copy revalidates read-only with zero cache metadata change and no additional UE launch. Supervisor review accepted the repair and recorded verified implementation commit `12159b9b5eb31829208df5c01c7fc97f157398c2`; the remote checkpoint is published and local external artifacts are excluded by commit `af457cad6c870c62b333bfba82df4fb38d83c6b1`.

C14 implemented deterministic `uagent.mvp15.live-asset-toolset-fingerprint.v1` publication in the real desktop adapter. C14A hardens that boundary: a new connection generation atomically retracts old discovery, facade inventory, MCP binding, and fingerprint before any synchronous status notification; blocked publications expose only allowlisted names, stable flags, and counts, never raw unexpected/duplicate names. Primitive, non-string, throwing/proxy-like, malformed, and non-JSON inputs remain fail closed without an accepted SHA-256. The controlled C14 task-owned read-only attempt reached the exact loaded module/listener environment, preserved Route A `191 = 163 + 28`, and made one initialization request before a pre-discovery transport/environment failure. It produced no descriptor/schema evidence and is not a schema rejection; discovery and every registration/token/dry-run/execute/verify/rollback/replay/mutation count stayed zero. Separately, the authoritative active-byte mapping remains `BLOCKED_BY_MCP_SCHEMA`: all six signed Epic sibling binaries differ from the active unsigned project-local set, and no authoritative package manifest or source/build attestation maps those active bytes. Supervisor review accepted the C14/C14A implementation at verified commit `37c29cbc7961218bfd71d1809178359952a75e18`; its documentation closeout is published in the same task checkpoint. The historical 09Z `PASS_REAL_SMOKE` remains former happy-path evidence only. At the C14 checkpoint, product-adapter capture and the product-UI lifecycle were still absent; the current Rework 9 posture is summarized above.

1. **Asset Mutation Contracts**: Sandbox asset paths, operation kinds, dry-run plans, ChangeSet approvals, verification, rollback, evidence, audit, and replay summaries.
2. **Sandbox Policy**: Blocks non-sandbox paths, path traversal, Save All, unsafe delete/move/rename/bulk operations, broad mutating MCP calls, stale manifests, provider auto-apply, raw secrets, and replay re-execution.
3. **Runtime Asset Service**: Deterministic dry-run, ephemeral native-issued approval token handoff, execute, verify, rollback, manifest, replay summary, and scenario matrix support.
4. **Native Guard Rework**: Native commands are bound to authoritative trusted-root and live observation registries, a strict `UAGENT_ENABLE_ASSET_MUTATION=1` gate, a 60-second one-time token, and absolute 15-minute forward / 20-minute recovery deadlines. Automated C11 coverage is present; C12-C13E1 add accepted real build, module, task-copy, DDC, process, listener, and fail-closed dual-layer Plugins containment evidence, while provenance and fresh product-UI acceptance remain blocked.
5. **MCP Schema Adapters**: Exact allowlist for dry-run, execute, and rollback-capable sandbox asset tools with strict state-specific structured results, required `sideEffectObserved`, read-only evidence queries, and a redacted session/generation-bound exact-six fingerprint publication; generic wrapper mutation remains blocked.
6. **Desktop UI / Store**: Inspector Assets and Changes surfaces expose `executed`, `verified`, `rollback_available`, `rolled_back`, stable blocked reasons, redacted operation audit, and recorded replay summaries. The working tree also contains inherited visible Companion status/contract/hash/fingerprint/generation copy in `AssetMutationPanel` and `ConfigSettings`, with matching UI assertions; Rework 7 and documentation-only Rework 8/Rework 9 did not edit those files or the five TitleBar-coupled files, and the inherited changes do not establish acceptance.
7. **Scenario Matrix / Side-effect Scan / Docs**: Security checks also cover native trust, observation provenance, native gate authority, transaction liveness, and pre-trust root mapping regressions.

Controlled text writes remain approval-gated and limited to trusted fixture/temp roots or explicitly trusted project roots. Non-sandbox UE assets, Save All, bulk asset operations, arbitrary shell expansion, provider live defaults, automatic git operations, replay re-execute, and raw secret/path leakage remain blocked.

Real UE execution remains limited to `/Game/UAgentSandbox/**`; the accepted `/Game/Test01` source stays read-only.

## Technology Stack

- **Desktop Shell**: Tauri 2 + React 18 + Vite 5
- **Language**: TypeScript 5.5+ (strict mode)
- **Package Manager**: pnpm 9+ monorepo
- **Linting**: ESLint 9 (flat config) + Prettier
- **Testing**: Vitest + Testing Library

## Quick Start

```bash
pnpm install
pnpm --filter @uagent/desktop web:dev   # Start Vite dev server (browser preview, fixture fallback)
pnpm --filter @uagent/desktop dev        # Start Tauri native dev (real FS bridge available, requires Rust)
pnpm typecheck    # TypeScript checking
pnpm lint         # Static analysis
pnpm test         # Run test suite
```

## Project Structure

```
apps/desktop/
  src-tauri/        Tauri 2 native shell (Rust)
  web/              React + Vite frontend
    src/
      app/          Root App and providers
      shell/        AppShell, TitleBar, MainLayout, GlobalOverlays
      sidebar/      LeftSidebar
      workspace/    Workspace (ConversationViewport + ComposerDock area)
      inspector/    InspectorPane
      components/   Reusable presentational components
      runtime/      Desktop mock runtime adapter and event view models
      stores/       UI state stores (custom slice store)
      styles/       tokens, theme, animations, globals
      types/        UI type definitions
packages/shared/    Shared types plus MVP1 Task/Runtime/Event contract
packages/runtime/   Deterministic MockRuntime and TaskEvent reducer
packages/mcp-client/  MCP JSON-RPC, Streamable HTTP, legacy SSE, session, and discovery client
docs/               Architecture, roadmap, development guide
```

## Native Build Prerequisites

The Tauri 2 native build requires the Rust toolchain (`rustc` / `cargo`) and platform-specific WebView dependencies. The web frontend (`pnpm --filter @uagent/desktop web:build`) builds without Rust.

## Non-Goals (current stage)

- Default live provider network access (must be opt-in)
- Non-sandbox Unreal Engine writes or uncontrolled/automatic Editor launch
- Broad mutating MCP tool calls
- Uncontrolled or arbitrary shell, browser, or filesystem behavior outside the existing approval, trust, containment, and read-only boundaries
- Save All, broad/bulk asset mutation, provider auto-apply, replay execution, automatic git operations, or secret/raw-path disclosure
- Cloud deployment, auth, or remote services
- Forking or embedding Codex/Claude Code/Cursor/Aider

## Documentation

- [Architecture](docs/architecture.md)
- [MVP Roadmap](docs/mvp-roadmap.md)
- [Runtime Contract](docs/runtime-contract.md)
- [MVP1 Acceptance](docs/mvp1-acceptance.md)
- [MCP Read-only Plan](docs/mcp-readonly-plan.md)
- [MVP2 Acceptance](docs/mvp2-acceptance.md)
- [Agent Core Plan](docs/agent-core-plan.md)
- [MVP3 Acceptance](docs/mvp3-acceptance.md)
- [MVP4 Acceptance](docs/mvp4-acceptance.md)
- [MVP5 Acceptance](docs/mvp5-acceptance.md)
- [MVP6 Acceptance](docs/mvp6-acceptance.md)
- [MVP6 UI Productization Plan](docs/mvp6-ui-productization-plan.md)
- [MVP6 Baseline Freeze](docs/mvp6-baseline-freeze.md)
- [MVP6 Manual Smoke](docs/mvp6-manual-smoke.md)
- [MVP7 Acceptance](docs/mvp7-acceptance.md)
- [MVP7 Baseline Freeze](docs/mvp7-baseline-freeze.md)
- [MVP7 Project Index Plan](docs/mvp7-project-index-plan.md)
- [MVP7 Capability Bridge Plan](docs/mvp7-capability-bridge-plan.md)
- [MVP7 Manual Smoke](docs/mvp7-manual-smoke.md)
- [MVP8 Prep](docs/mvp8-prep.md)
- [MVP8 Baseline Freeze](docs/mvp8-baseline-freeze.md)
- [MVP8 Native FS Bridge Plan](docs/mvp8-native-fs-bridge-plan.md)
- [MVP8 Real Project Scan Plan](docs/mvp8-real-project-scan-plan.md)
- [MVP8 Acceptance](docs/mvp8-acceptance.md)
- [MVP8 Manual Smoke](docs/mvp8-manual-smoke.md)
- [MVP8 Risk Register](docs/mvp8-risk-register.md)
- [MVP9 Prep](docs/mvp9-prep.md)
- [Workflow Safety Plan](docs/workflow-safety-plan.md)
- [MVP11 Acceptance](docs/mvp11-acceptance.md)
- [MVP11 Manual Smoke](docs/mvp11-manual-smoke.md)
- [MVP11 Final Handoff](docs/mvp11-final-handoff.md)
- [MVP12 Prep](docs/mvp12-prep.md)
- [MVP12 Acceptance](docs/mvp12-acceptance.md)
- [MVP12 Manual Smoke](docs/mvp12-manual-smoke.md)
- [MVP12 Risk Register](docs/mvp12-risk-register.md)
- [MVP12 Final Verification](docs/mvp12-final-verification.md)
- [MVP12 Final Handoff](docs/mvp12-final-handoff.md)
- [MVP13 Prep](docs/mvp13-prep.md)
- [MVP13 Acceptance](docs/mvp13-acceptance.md)
- [MVP13 Manual Smoke](docs/mvp13-manual-smoke.md)
- [MVP13 Risk Register](docs/mvp13-risk-register.md)
- [MVP13 Final Verification](docs/mvp13-final-verification.md)
- [MVP13 Final Handoff](docs/mvp13-final-handoff.md)
- [MVP15 Prep (historical)](docs/mvp15-prep.md)
- [MVP15 Acceptance](docs/mvp15-acceptance.md)
- [MVP15 Manual Smoke](docs/mvp15-manual-smoke.md)
- [MVP15 Risk Register](docs/mvp15-risk-register.md)
- [MVP15 UE MCP Plugin Baseline](docs/mvp15-ue-mcp-plugin-baseline.md)
- [MVP15 Companion Registration ADR](docs/mvp15-ue-companion-plugin-adr.md)
- [MVP15 Companion Build Manifest Contract](docs/mvp15-ue-companion-plugin-build-manifest.md)
- [MVP15 Python Cache Contract](scripts/mvp15-python-cache-contract.json) and [read-only validator](scripts/mvp15-python-cache-surface.mjs)
- [MVP15 Final Verification](docs/mvp15-final-verification.md)
- [MVP15 Final Handoff](docs/mvp15-final-handoff.md)
- [Baseline Freeze](docs/mvp5-baseline-freeze.md)
- [Development Guide](docs/development.md)

## License

Proprietary. All rights reserved.
