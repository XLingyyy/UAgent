# MVP13 Final Verification

Implementation agents must record fresh output in the REPORT for:

```powershell
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter @uagent/shared test
pnpm --filter @uagent/runtime test
pnpm --filter @uagent/mcp-client test
pnpm --filter @uagent/desktop test
pnpm --filter @uagent/desktop web:build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml -- --test-threads=1
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml ue_editor -- --test-threads=1
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml text_mutation -- --test-threads=1
node scripts/side-effect-scan.mjs
git diff --check
```

Targeted implementation evidence already covered:

- Shared MVP13 contracts: `pnpm --filter @uagent/shared exec vitest run src/mvp13-contracts.test.ts`.
- Runtime MVP13 services/scenarios/bridge: `pnpm --filter @uagent/runtime exec vitest run src/mvp13-runtime.test.ts`.
- Desktop MVP13 store/UI: `pnpm --filter @uagent/desktop exec vitest run web/src/stores/Mvp13Store.test.tsx`.
- Native UE bridge: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml ue_editor -- --test-threads=1`.

The REPORT and supervisor review are authoritative for the final PASS / NEEDS_FIX / BLOCKED decision.
