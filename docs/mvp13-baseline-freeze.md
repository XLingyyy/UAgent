# MVP13 Baseline Freeze - Controlled UE Editor / MCP Mutation Pilot

Baseline checkpoint: `eaeb9aa7 mvp12: harden native text mutation approval`.

MVP13 inherits MVP12 rather than replacing it. The following red lines remain frozen:

- Text-backed project writes must use `WorkspaceChangeSetV2`.
- Native text mutation preview/apply/rollback must require trusted roots.
- Native approvals must be registry-issued and bound to change set, operations, before hashes, after hashes, root, expiry, and one-time use.
- Rollback must validate backup/root binding and expected current hashes before restoring.
- UE binary assets (`.uasset`, `.umap`, `.ubulk`, `.uexp`) remain blocked from write paths.
- Replay may display recorded summaries only; it must not re-execute editor operations, MCP mutation dry-runs, ChangeSet apply, or rollback.

Regression guard:

- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml text_mutation -- --test-threads=1`
- `pnpm --filter @uagent/runtime test`
- `node scripts/side-effect-scan.mjs`

The implementation REPORT is the authoritative fresh-output record.
