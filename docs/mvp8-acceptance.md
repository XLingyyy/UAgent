# MVP8 Acceptance

## Capability requirements

| Description |
| --- |
| Stage docs & baseline |
| Shared contracts & policy |
| Tauri native FS bridge |
| Real Project Scanner |
| Safe File Preview |
| Desktop bridge & UI |
| Approval/Sandbox/Audit/Session |
| Scenario matrix & side-effect scan |

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
