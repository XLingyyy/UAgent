# MVP11 Prep

## Goal

MVP11 adds UE read-only diagnostics and build failure analysis on top of the accepted MVP10 local execution boundaries.

## Scope

- UE-like metadata parsing from indexed and previewed project files only.
- Project diagnostics from `ProjectIndexSnapshot`, redacted file previews, and metadata summaries.
- Build output parsing from recorded terminal output text only.
- MCP read-only observations from discovery and `resources/read`; mutating `tools/call` remains blocked.
- Context Pack v1 as an in-memory redacted summary.
- UI surfacing through existing panels, settings, runtime store, and slice-store patterns.

## Red Lines

- No UE writes, moves, deletes, renames, fixes, UBT execution, or UE Editor launch.
- No mutating MCP `tools/call`.
- No provider live call by default and no automatic Context Pack upload.
- No terminal allowlist expansion beyond MVP10.
- No GitHub Actions or CI workflow files.
- No automatic git operations.

## Implementation Notes

- Shared contracts live in `packages/shared/src/ue-diagnostics.ts`.
- Runtime implementation lives in `packages/runtime/src/ue-diagnostics.ts`.
- UI additions reuse `DiagnosticsPanel`, `ReviewPanel`, `UtilityEvidencePanel`, `ConfigSettings`, `TerminalPanel`, and existing runtime store slices.
- The old ambiguous native terminal command is renamed to `execute_terminal_command_fixture`; the product real path remains `execute_terminal_command_real`.
