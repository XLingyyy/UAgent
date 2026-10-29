# MVP6 Acceptance

## Scope: UI Productization & Project Workspace Shell

MVP6 productizes the existing Tauri + React desktop UI into a usable project workspace shell. It preserves MVP5 approval, sandbox, ChangeSet, audit, session, provider, and raw-secret redaction boundaries.

## MVP6 Scenario Matrix

The automated MVP6 matrix is implemented in `apps/desktop/web/src/mvp6-scenarios.test.tsx`. The file uses a `scenarios` table where each row has `name`, `assertionCount`, and `run()`. The meta test verifies 30 unique names and 60+ declared behavior assertions, then `it.each(scenarios)` executes every `run()` as its own traceable Vitest case.

1. `mvp6-default-welcome`
2. `mvp6-titlebar-tools-toggle`
3. `mvp6-titlebar-drag-region-safe`
4. `mvp6-left-sidebar-default`
5. `mvp6-left-sidebar-asset-browser`
6. `mvp6-project-tree-keyboard`
7. `mvp6-account-menu-settings-entry`
8. `mvp6-composer-compact-layout`
9. `mvp6-composer-no-voice`
10. `mvp6-model-reasoning-menu`
11. `mvp6-provider-model-sync`
12. `mvp6-attach-menu-disabled`
13. `mvp6-utility-drawer-default-closed`
14. `mvp6-utility-drawer-narrow-overlay`
15. `mvp6-safety-panel-regression`
16. `mvp6-audit-panel-regression`
17. `mvp6-changes-panel-regression`
18. `mvp6-placeholder-tools-disabled`
19. `mvp6-settings-six-pages`
20. `mvp6-general-page`
21. `mvp6-profile-page-readonly`
22. `mvp6-appearance-dark-only`
23. `mvp6-config-localhost-mcp`
24. `mvp6-personalization-staged-memory`
25. `mvp6-provider-secret-safe`
26. `mvp6-coming-soon-tooltip-focus`
27. `mvp6-reduced-motion`
28. `mvp6-no-new-state-management`
29. `mvp6-side-effect-scan`
30. `mvp6-mvp5-redaction-regression`

The file includes 60+ behavior assertions across welcome state, TitleBar, drag-region safety, sidebar modes, project-tree keyboard behavior, account/settings entry, compact Composer, no-voice controls, model reasoning, provider-to-composer store sync, attach menu, Utility Drawer, safety/audit/changes regressions, Settings pages, Provider safety, tooltip a11y, reduced motion, state-management boundaries, side-effect scan coverage, and MVP5 redaction regression.

## Verification Commands

Required commands for final acceptance:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @uagent/shared test
pnpm --filter @uagent/runtime test
pnpm --filter @uagent/mcp-client test
pnpm --filter @uagent/desktop test
pnpm --filter @uagent/desktop web:build
node scripts/side-effect-scan.mjs
git diff --check
```

## Red Lines Preserved

- No default live provider network.
- No raw API key storage in UI state, TaskEvent, RuntimeSnapshot, trace, audit, session, DOM, or snapshots.
- No real UE writes or mutating MCP tool calls.
- No real filesystem/project scan or Asset Registry access.
- No real terminal/browser/filesystem/screenshot product capability.
- No new state-management library, router, or design system.
- Light/System theme controls are staged disabled; only dark is usable.
