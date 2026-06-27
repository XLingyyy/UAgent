# MVP6 UI Productization Plan

## Goal

Turn the existing MVP5 desktop UI into a coherent Project Workspace Shell without adding real UE, filesystem, shell/browser, mutating MCP, or default live provider behavior.

## Architecture

- Keep Tauri 2 + React 18 + Vite 5.
- Keep the existing `UIProvider` slice-store architecture.
- Extend existing layout, sidebar, composer, provider, and settings slices only.
- Keep runtime side effects behind `RuntimeClient`; React product components do not call provider, MCP, shell, browser, filesystem, or UE APIs directly.
- Keep all project and asset data in static in-memory fixtures.

## UI Structure

- `TitleBar`: brand, workspace breadcrumb, drag region, connection summary, Utility Drawer toggle, MVP6 badge.
- `LeftSidebar`: Project, Conversation, and Asset Browser modes. Asset Browser uses `mockProjectTree` only.
- `Workspace`: welcome-first layout when no active thread exists, conversation viewport after task/thread activation.
- `ComposerDock`: compact layout with staged attach menu, permission selector, input, context ring, model/reasoning selector, send button, and project/status chips.
- `InspectorPane`: Utility Drawer with Review, Diagnostics, Runtime, Agent Trace, Safety, Audit, Changes. Future tools are disabled with tooltips.
- `SettingsShell`: full-page six-section settings center: General, Profile, Appearance, Config, Personalization, Provider.

## State Changes

- `layout.sidebar.viewMode`: `project`, `conversation`, `asset-browser`.
- `layout.sidebar.assetBrowserExpanded`: reserved for static asset browser disclosure.
- `composer.attachMenuOpen`: local attach menu visibility.

No Zustand, Redux, router, or new design system is introduced.

## Provider and Composer Loop

- Composer model options derive from enabled provider models.
- Provider default changes resync Composer model and reasoning values.
- Provider config stores `secretRef` only. Raw secret-like input is rejected from the UI and fixture test path.
- `not-configured` provider status does not block mock runtime submit.

## Safety Boundaries

- Default provider network stays disabled/fixture.
- Runtime submit remains mock/fixture.
- Safety, audit, and changes panels continue to use MVP5 runtime projections.
- Future tools are visible but disabled, with `aria-disabled`, tooltip text, and Enter/Space blocking.

## Testing Strategy

- Keep focused unit/component tests for existing modules.
- Add `mvp6-scenarios.test.tsx` with 30 named scenarios and behavior assertions.
- Keep MVP5 runtime and desktop redaction regression tests.
- Extend side-effect scan expectations for MVP6 UI red lines.

## Known Limits

- No real project scanning.
- No real Asset Registry.
- No terminal/browser/filesystem/screenshot capability.
- No real light theme.
- No live provider by default.
- No mutating MCP or UE write path.
