# MVP8 Final Handoff

## Baseline State

MVP8 implementation is complete and accepted. The following capabilities are production-ready:

- Tauri 2 native Rust commands for read-only project filesystem operations
- Real project scanner with deterministic BFS traversal and policy-constrained limits
- Safe file preview with extension allowlist, binary detection, line/byte limits, and secret/home-path redaction
- Path redaction, root containment, symlink escape blocking, dangerous root rejection
- NativeProjectAdapter bridge layer with fixture fallback in non-Tauri environments
- Capability Bridge Files mode extended with `native_read_only`
- All write/exec/capture/browser capabilities remain blocked by default
- MVP8 scenario matrix: 72 scenarios, all pass
- Side-effect scan: 0 blocked findings

## Inviolable Red Lines for MVP9

The following red lines remain in effect and must not be violated by any MVP9 work:

1. No write command registered in Tauri bridge (native or otherwise)
2. No raw absolute path or raw secret in UI state, DOM, audit, session replay, evidence, or test snapshots
3. React UI must not directly import @tauri-apps/api, node:fs, node:path, child_process
4. Root validation must reject dangerous root, relative path, network path
5. Symlink escape must be blocked
6. Preview must redact secrets and home paths
7. Trust must precede scan
8. Capability bridge must block write/exec/capture/browser by default
9. Provider live must remain manual opt-in
10. Side-effect scan must report 0 blocked findings

## MVP9 Entry Requirements

- [X] All MVP8 acceptance gates (G0-G8) marked COMPLETE
- [X] Side-effect scan passes with 0 blocked findings
- [X] All verification commands pass (typecheck, lint, test, build)
- [X] MVP8 manual smoke steps documented and verifiable
- [X] No uncommitted changes to .agent-bus/, 监工文档/, or secret/config files

## Non-Blocking Items Carried Into MVP9

The following are acknowledged as non-blocking and may be addressed during MVP9 as time permits:

- Several MVP8 scenario rows remain document-style assertions and can be hardened later
- `docs/mvp8-acceptance.md` gate table was updated during MVP9 handoff

## Ready for MVP9

MVP9 may proceed with Terminal (proposal-only before execution), Browser/Screenshot Preview (user-initiated only), and Incremental Watcher (dirty state + diff only, no auto rescan). All new capabilities must pass through Capability Bridge policy gate.
