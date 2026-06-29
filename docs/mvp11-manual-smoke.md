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

## S1-S12 Results

Rework update: S1/S3 remain supervisor-local native UI steps because this implementation
session did not launch the native desktop app. The same data path is now covered by
automated UI/store tests: active project index + read-only previews -> metadata/project
diagnostics, recorded terminal output -> build diagnostics -> Context Pack v1, and
Project/Asset browser affected-file markers.

| Smoke | Result | Notes |
|-------|--------|-------|
| S1 | SUPERVISOR LOCAL | Implementation environment did not launch the native desktop app; `Mvp11Store.test.tsx`, `Mvp11DiagnosticsPanel.test.tsx`, and `ContextPack.test.tsx` cover the real UI/store data path. |
| S2 | PASS AUTOMATED | `Mvp11DiagnosticsPanel.test.tsx` covers Config status. |
| S3 | SUPERVISOR LOCAL | Fixture path is documented; native register/trust/scan remains a local UI action, while `Mvp11Store.test.tsx` covers active project index + read-only preview analysis. |
| S4 | PASS AUTOMATED | Runtime parser tests cover metadata summaries. |
| S5 | PASS AUTOMATED | Runtime diagnostics tests cover malformed descriptor warnings. |
| S6 | PASS AUTOMATED | Store/action tests cover user-triggered recorded terminal analysis; parser tests cover build output. |
| S7 | PASS AUTOMATED | Build parser tests cover Windows/macOS/Linux home path redaction. |
| S8 | PASS AUTOMATED | DiagnosticsPanel test covers real MVP11 state counts, kind grouping, affected paths, build status, Context Pack status, and redaction. |
| S9 | PASS AUTOMATED | Evidence panel test covers real UE metadata, build failure, and Context Pack summaries from runtime state. |
| S10 | PASS AUTOMATED | Context Pack runtime and desktop tests cover v1 creation, sections, evidence, and redaction. |
| S11 | PASS AUTOMATED | Session-history test covers replay-only diagnostic summaries. |
| S12 | PASS AUTOMATED | `node scripts/side-effect-scan.mjs` passed with 0 blocked findings. |
