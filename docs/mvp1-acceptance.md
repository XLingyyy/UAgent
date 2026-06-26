# MVP1 Acceptance

MVP1 is accepted when UAgent behaves like an interactive mock product shell while preserving the no-side-effect boundary.

## Product Acceptance

- From welcome mode, non-empty Composer input enables Send.
- Sending creates a mock task, clears the input, switches Workspace to thread mode, and selects the runtime thread.
- ConversationViewport renders the active task request, plan, tool events, evidence event, review summary, and terminal state.
- LeftSidebar shows runtime threads alongside static fallback threads.
- UtilityDrawer shows the same active task in Review, Diagnostics, Evidence, and Runtime views.
- Model not configured does not block the mock flow and must show `Mock runtime / no provider call`.
- Static mock fallback conversations still render when a non-runtime thread is selected.
- `#fail` input produces a visible failed task state.
- Cancellation is supported by `RuntimeClient.cancelTask()` and the runtime reducer.

## Required Commands

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @uagent/runtime test
pnpm --filter @uagent/desktop test
pnpm --filter @uagent/desktop web:build
```

## No-Side-Effect Scan

Scan code for real network, provider, MCP, Unreal, filesystem, browser, shell, or tool execution paths. Allowed hits must be tests, documentation, disabled labels, mock copy, or existing non-product configuration.
