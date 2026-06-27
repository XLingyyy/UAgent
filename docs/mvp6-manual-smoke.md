# MVP6 Manual Smoke

## Setup

```powershell
pnpm --filter @uagent/desktop web:dev
```

Open the Vite URL printed by the command. The smoke path uses browser preview only and does not require Rust.

## Smoke Checklist

1. Default launch
   - Expected: workspace opens in welcome mode.
   - Expected DOM summary: `[data-workspace-mode="welcome"]`, `aria-label="Composer dock"`, and no `aria-label` containing `voice`, `microphone`, or `record`.

2. TitleBar and Utility Drawer
   - Click `Open utility drawer`.
   - Expected: `[data-utility-pane-state="open"]`, Utility Drawer is visible, button label changes to `Close utility drawer`.
   - Click close.
   - Expected: drawer returns to closed state.

3. LeftSidebar modes
   - Default expected: `[data-sidebar-view="project"]`, current project summary visible.
   - Click `Conversation`.
   - Expected: thread list visible.
   - Click `Asset Browser`.
   - Expected: role `tree` for the active project, static fixture folders `Content`, `Maps`, `Characters`, `Materials`, and `Config`.

4. Composer mock submit
   - Type a prompt in the Composer input.
   - Click `Send mock task`.
   - Expected: workspace switches to `[data-workspace-mode="thread"]`.
   - Expected: `Conversation activity`, Safety/Audit/Changes panels remain available.

5. Attach menu
   - Click `Open attach menu`.
   - Expected: menu entries `File`, `Asset`, `Screenshot`, `Context Pack`.
   - Expected: each item has `aria-disabled="true"` and `aria-describedby` pointing to a `role="tooltip"`.
   - Press Enter/Space on entries.
   - Expected: no file picker, screenshot capture, or asset scan opens.

6. Settings Center
   - Click account menu, then `Open settings`.
   - Expected: full-page SettingsShell opens.
   - Expected pages: General, Profile, Appearance, Config, Personalization, Provider.
   - Click Back to app.
   - Expected: app shell returns without losing utility drawer state.

7. Appearance
   - Open Appearance page.
   - Expected: `Dark` is usable.
   - Expected: `System (staged)` and `Light (staged)` are disabled.

8. Provider and Composer sync
   - Open Provider page.
   - Edit provider defaults, choose a different model and reasoning effort, save provider.
   - Return to app.
   - Expected: Composer model selector immediately reflects the saved default.
   - Expected: raw API key input is not present.

9. Secret safety
   - In Provider edit mode, try entering `sk-live-raw-secret` in `Secret ref`.
   - Click `Test connection (fixture)`.
   - Expected: raw string is not displayed and no live network request is sent.

10. Reduced motion
    - Simulate `prefers-reduced-motion: reduce` in browser dev tools.
    - Open/close Utility Drawer and menus.
    - Expected: no long or layout-shifting animation; transitions use reduced duration.

11. Side-effect scan
    - Run `node scripts/side-effect-scan.mjs`.
    - Expected: 0 blocked findings.

## Evidence Summary

Automated DOM coverage is in `apps/desktop/web/src/mvp6-scenarios.test.tsx`. The scenario test covers the required named MVP6 matrix and can be used as repeatable smoke evidence when screenshots are not collected.
