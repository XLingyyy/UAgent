# MVP6 Baseline Freeze

## Frozen Baseline

MVP6 must preserve the MVP5 safety and runtime boundaries while productizing the UI.

Frozen objects:

- Monorepo shape with `apps/desktop`, `packages/shared`, `packages/runtime`, and `packages/mcp-client`.
- Tauri 2 + React 18 + Vite 5 desktop route.
- `AppShell`, `TitleBar`, `MainLayout`, `LeftSidebar`, `Workspace`, `InspectorPane`, and `GlobalOverlays` ownership.
- `UIProvider` slice-store structure.
- Provider config model using `secretRef`, redacted state, and disabled/fixture/live opt-in network mode.
- MVP5 approval, sandbox, ChangeSet, audit, session, and redaction tests.
- `tokens.css`, `theme.css`, `animations.css`, and reduced-motion safeguards.
- Mock-first and fixture-first runtime defaults.

## Current MVP6 File Areas

- `apps/desktop/web/src/shell/*`
- `apps/desktop/web/src/sidebar/*`
- `apps/desktop/web/src/workspace/*`
- `apps/desktop/web/src/composer/*`
- `apps/desktop/web/src/inspector/*`
- `apps/desktop/web/src/settings/*`
- `apps/desktop/web/src/stores/*`
- `apps/desktop/web/src/components/ComingSoonGate.*`
- `apps/desktop/web/src/mvp6-scenarios.test.tsx`
- `scripts/side-effect-scan.mjs`
- `README.md`
- `docs/mvp-roadmap.md`
- `docs/mvp6-acceptance.md`
- `docs/mvp6-ui-productization-plan.md`
- `docs/mvp6-manual-smoke.md`

## Allowed Change Scope

- Incremental UI state fields in existing slices.
- Productized layout, labels, disabled future controls, and a11y attributes.
- Static fixture UI for project and asset browsing.
- Tests directly covering MVP6 UI behavior and MVP5 safety regressions.
- Documentation describing MVP6 scope, acceptance, smoke, and red lines.
- Side-effect scan rules that block React product components from direct provider/MCP/shell/fs/browser/UE side effects.

## Forbidden Rewrite Scope

- Replacing the UI state architecture.
- Introducing a router or new design system.
- Rewriting runtime, shared, or MCP packages for UI productization.
- Enabling live provider network by default.
- Reading real project files or UE asset registries.
- Exposing real terminal, browser, filesystem, screenshot, or UE write controls.
- Storing raw API keys or secret-like values in UI state, task events, runtime snapshots, traces, audit, session, DOM, or test snapshots.

## Baseline Verification

Use the required MVP6 verification commands from `docs/mvp6-acceptance.md`. A clean acceptance run requires 0 blocked side-effect scan findings.
