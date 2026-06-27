# MVP6 Acceptance

## Stage: UI Productization & Project Workspace Shell

MVP6 productizes the existing Tauri + React desktop UI into a usable project workspace shell. It preserves MVP5 approval, sandbox, ChangeSet, audit, session, provider, and raw-secret redaction boundaries.

## Gate Status

| Gate | Status |
|------|--------|
| G0 - Stage switch and baseline freeze | [X] COMPLETE |
| G1 - UI state and staged entry foundations | [X] COMPLETE |
| G2 - TitleBar and tool drawer entry | [X] COMPLETE |
| G3 - LeftSidebar project, conversation, asset modes | [X] COMPLETE |
| G4 - Welcome workspace and compact Composer | [X] COMPLETE |
| G5 - Utility Drawer productization | [X] COMPLETE |
| G6 - Settings Center six-page information architecture | [X] COMPLETE |
| G7 - Provider-Composer loop and safety regression | [X] COMPLETE |
| G8 - A11y, motion, visual, docs, and scan acceptance | [X] COMPLETE |

## Task Card Status

| Task | Gate | Status | Primary files | Verification |
|------|------|--------|---------------|--------------|
| MVP6-00 | G0 | [X] COMPLETE | `README.md`, `docs/mvp-roadmap.md`, this file, `docs/mvp6-ui-productization-plan.md` | docs review, typecheck, lint, test |
| MVP6-01 | G0 | [X] COMPLETE | `docs/mvp6-baseline-freeze.md` | docs review |
| MVP6-02 | G0 | [X] COMPLETE | this file | scenario matrix and report format documented |
| MVP6-10 | G1 | [X] COMPLETE | `apps/desktop/web/src/types/ui.ts`, `stores/*` | `ui-store.test.tsx`, `mvp6-scenarios.test.tsx` |
| MVP6-11 | G1 | [X] COMPLETE | `components/ComingSoonGate.tsx` | `ComingSoonGate.test.tsx`, MVP6 scenario tooltip test |
| MVP6-12 | G1 | [X] COMPLETE | `styles/*`, component CSS | lint, build, reduced-motion docs |
| MVP6-20 | G2 | [X] COMPLETE | `shell/TitleBar.tsx` | `TitleBar.test.tsx`, MVP6 scenario test |
| MVP6-21 | G2 | [X] COMPLETE | `shell/TitleBar.tsx`, runtime store reads only | MVP6 scenario no-network status assertions |
| MVP6-30 | G3 | [X] COMPLETE | `sidebar/LeftSidebar.tsx` | `LeftSidebar.test.tsx`, MVP6 scenario test |
| MVP6-31 | G3 | [X] COMPLETE | `sidebar/project-tree-data.ts`, `ProjectTree.tsx` | `ProjectTree.test.tsx`, MVP6 scenario test |
| MVP6-32 | G3 | [X] COMPLETE | `ProjectTree.tsx`, tests | `ProjectTree.test.tsx` |
| MVP6-33 | G3 | [X] COMPLETE | `SidebarFooter.tsx` | `SidebarFooter.test.tsx`, AppShell settings tests |
| MVP6-40 | G4 | [X] COMPLETE | `workspace/Workspace.tsx`, `WelcomeHero.tsx`, `ComposerDock.tsx` | `Workspace.test.tsx`, MVP6 scenario test |
| MVP6-41 | G4 | [X] COMPLETE | `composer/ComposerDock.tsx` | `ComposerDock.test.tsx`, no voice tests |
| MVP6-42 | G4 | [X] COMPLETE | `composer/ModelSelector.tsx`, provider store sync | `ModelSelector.test.tsx`, `ProviderSettings.test.tsx` |
| MVP6-43 | G4 | [X] COMPLETE | `composer/ProjectSelector.tsx`, project store sync | `ProjectSelector.test.tsx`, `AppShell.test.tsx` |
| MVP6-44 | G4 | [X] COMPLETE | `composer/ComposerDock.tsx`, `ComingSoonGate.tsx` | MVP6 attach menu scenario |
| MVP6-50 | G5 | [X] COMPLETE | `shell/MainLayout.tsx`, `inspector/InspectorPane.tsx` | `MainLayout.test.tsx`, `InspectorPane.test.tsx` |
| MVP6-51 | G5 | [X] COMPLETE | `inspector/*` | `InspectorPane.test.tsx` |
| MVP6-52 | G5 | [X] COMPLETE | `inspector/inspector-data.ts`, `InspectorPane.tsx` | future tool disabled scenario |
| MVP6-60 | G6 | [X] COMPLETE | `settings/SettingsShell.tsx`, `settings-pages.ts` | `SettingsShell.test.tsx` |
| MVP6-61 | G6 | [X] COMPLETE | `settings/pages/GeneralSettings.tsx` | `SettingsShell.test.tsx` |
| MVP6-62 | G6 | [X] COMPLETE | `settings/pages/ProfileSettings.tsx` | `SettingsShell.test.tsx` |
| MVP6-63 | G6 | [X] COMPLETE | `settings/pages/AppearanceSettings.tsx` | dark-only staged light assertions |
| MVP6-64 | G6 | [X] COMPLETE | `settings/pages/ConfigSettings.tsx` | `SettingsShell.test.tsx` |
| MVP6-65 | G6 | [X] COMPLETE | `settings/pages/PersonalizationSettings.tsx` | `SettingsShell.test.tsx` |
| MVP6-66 | G6 | [X] COMPLETE | `settings/pages/ProviderSettings.tsx` | `ProviderSettings.test.tsx` |
| MVP6-70 | G7 | [X] COMPLETE | provider store, composer model selector | provider-composer sync tests |
| MVP6-71 | G7 | [X] COMPLETE | runtime UI projections, safety/audit/changes panels | runtime and desktop tests |
| MVP6-72 | G7 | [X] COMPLETE | project store, sidebar, composer project chip | `AppShell.test.tsx`, MVP6 scenario test |
| MVP6-80 | G8 | [X] COMPLETE | `mvp6-scenarios.test.tsx` | 30 named scenarios, 60+ behavior assertions |
| MVP6-81 | G8 | [X] COMPLETE | CSS motion tokens and drawer layout | build, CSS review, manual smoke |
| MVP6-82 | G8 | [X] COMPLETE | tabs, menus, tree, tooltips, staged controls | Testing Library a11y assertions |
| MVP6-83 | G8 | [X] COMPLETE | `scripts/side-effect-scan.mjs`, redaction tests | side-effect scan, runtime/desktop tests |
| MVP6-84 | G8 | [X] COMPLETE | `docs/mvp6-manual-smoke.md` | manual smoke checklist |
| MVP6-85 | G8 | [X] COMPLETE | README, roadmap, acceptance docs | full verification suite |

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

## MVP7 Suggested Scope

MVP7 should handle real project scanning, filesystem access, terminal/browser/screenshot capability, UE asset index, and live provider transport as separate tasks with deeper sandbox and approval controls.
