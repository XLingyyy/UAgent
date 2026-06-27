# MVP7 Manual Smoke

> Note: Native Tauri commands (`validate_project_root`, `scan_project_index`, `preview_project_file`) are declared in `lib.rs` but require Rust toolchain for verification. All validation, scan, and preview behavior is available through the fixture runtime services tested in the scenario matrix.

Use `fixture://lyra` for deterministic local smoke. Do not capture screenshots containing real local paths or secrets.

## Web Smoke

1. Run `pnpm --filter @uagent/desktop web:dev`.
2. Confirm the default workspace still opens in welcome mode and no project scan starts automatically.
3. Confirm the title bar shows MVP7 plus read-only project index status.
4. Open Settings -> Config.
5. Enter `fixture://lyra` in Project root reference.
6. Click Validate project root. Expected: `Validation ready: Lyra_Prototype`.
7. Try empty, relative, root/system, or missing fixture roots. Expected: blocked reason such as `empty_path`, `relative_path`, `dangerous_root`, or `missing_uproject`.
8. Click Trust project root, then Scan project index. Expected: `Index ready`.
9. Return to the app and open Asset Browser. Expected: indexed asset browser appears with Lyra fixture assets.
10. Filter `front`. Expected: `L_LyraFrontEnd.umap` remains visible and no scan is triggered.
11. Preview `Config/DefaultGame.ini`. Expected: content is text, redacted, and includes a redaction summary.
12. Preview a binary `.uasset` or traversal path fixture. Expected: blocked reason and audit trail entry.
13. Open Utility Drawer -> Runtime. Expected: Files, Terminal, Browser, and Screenshot capability cards show read-only, fixture, or blocked states.
14. Provider live remains manual opt-in only. Missing `secretRef` or missing confirmation blocks.
15. Enter text containing API keys, Authorization headers, tokens, or home paths. Expected: RuntimeSnapshot, TaskEvent, Audit, Session, and DOM do not show raw secret/path.
16. Simulate `prefers-reduced-motion`. Expected: scan status, drawer, menus, and tooltip motion reduce to short transitions.
17. Run `node scripts/side-effect-scan.mjs`. Expected: 0 blocked findings.

## Fixture Names

- Root: `fixture://lyra`
- Project: `Lyra_Prototype`
- Safe text preview: `Config/DefaultGame.ini`
- Binary blocked fixture: `Content/Characters/Hero.uasset`
- Traversal blocked fixture: `../Secrets/token.txt`
