# MVP8 Manual Smoke Test

## Test Steps

1. Start the app with `pnpm --filter @uagent/desktop web:dev`
2. Verify TitleBar shows "MVP8" and "Native read-only" or "Fixture-only" badge
3. Navigate to Settings -> Config
4. Enter "fixture://lyra" as project root and click "Validate project root"
5. Verify "Validation ready: Lyra_Prototype" appears
6. Click "Trust project root"
7. Click "Scan project index"
8. Verify "Index ready" appears
9. Navigate back to workspace sidebar
10. Open Asset Browser tab
11. Verify indexed files appear in tree
12. Filter assets by "front" - verify L_LyraFrontEnd.umap found
13. Click DefaultGame.ini - verify preview shows redacted secrets ([REDACTED])
14. Click a .umap asset - verify preview shows blocked/binary message
15. Open Utility Drawer -> Runtime tab
16. Verify capability dashboard shows Files read-only, Terminal/Browser/Screenshot blocked/fixture
17. Run `node scripts/side-effect-scan.mjs` - verify 0 blocked findings
