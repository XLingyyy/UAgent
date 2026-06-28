# MVP8 Acceptance

## Gate Summary

| Gate | Description | Status |
|------|-------------|--------|
| G0 | Stage docs & baseline | |
| G1 | Shared contracts & policy | |
| G2 | Tauri native FS bridge | |
| G3 | Real Project Scanner | |
| G4 | Safe File Preview | |
| G5 | Desktop bridge & UI | |
| G6 | Approval/Sandbox/Audit/Session | |
| G7 | Scenario matrix & side-effect scan | |
| G8 | Final acceptance & MVP9 handoff | |

## Verification Commands

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

## Red Lines

1. No write command registered in Tauri bridge
2. No raw absolute path or raw secret in UI state, DOM, audit, session replay, evidence, or test snapshots
3. React UI must not directly import @tauri-apps/api, node:fs, node:path, child_process
4. Root validation must reject dangerous root, relative path, network path
5. Symlink escape must be blocked
6. Preview must redact secrets and home paths
7. Trust must precede scan
8. Capability bridge must block write/exec/capture/browser by default
9. Provider live must remain manual opt-in
10. Side-effect scan must report 0 blocked findings
