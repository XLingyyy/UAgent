# MVP11 Manual Smoke

## Fixture

UE-like fixture files are under `packages/runtime/src/fixtures/mvp11-ue-fixture/`:

- `LyraFixture.uproject`
- `Config/DefaultGame.ini`
- `Source/LyraFixture.Target.cs`
- `Source/LyraFixture/LyraFixture.Build.cs`
- `Plugins/ReadOnlyPlugin/ReadOnlyPlugin.uplugin`
- `Content/Hero.uasset`

## Flow

1. Start the app and confirm TitleBar/Settings show the diagnostics stage while MVP10 terminal/watcher/browser gates remain default-off unless explicitly enabled.
2. Open Settings -> Config and confirm Diagnostic Engine is enabled, read-only, Provider live off, and MCP read-only.
3. Register/trust a UE-like root and scan it; confirm ProjectIndex reaches ready.
4. Trigger UE metadata analysis and confirm `.uproject`, `.uplugin`, `Build.cs`, `Target.cs`, and INI summaries are visible.
5. Use a malformed `.uproject` fixture and confirm warning diagnostics without whole-run failure.
6. Run or select existing terminal output evidence, then click `Analyze output`.
7. Confirm BuildDiagnostic display paths use `[project-root]` or `[user-home]`.
8. Open DiagnosticsPanel and confirm UE Project Diagnostics, Build Failure Analysis, and Context Pack groups.
9. Open Evidence panel and confirm UE metadata, build failure, and context pack evidence entries.
10. Create Context Pack v1 from runtime data and confirm all six sections plus redaction summary.
11. Replay the session and confirm it shows recorded diagnostic/context pack summaries only.
12. Run `node scripts/side-effect-scan.mjs` and confirm 0 blocked findings.
