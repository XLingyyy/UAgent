# MVP11 Acceptance

## Capability requirements

| Contract |
| --- |
| Product runtime/UI path uses `execute_terminal_command_real`; old ambiguous native command renamed fixture-only. |
| Shared UE metadata, diagnostics, Context Pack, evidence, audit, task, and replay filter contracts added. |
| Read-only UE metadata parser covers `.uproject`, `.uplugin`, Target.cs, Build.cs, Config INI summaries, malformed descriptors, and redaction. |
| Project diagnostics cover missing module source, missing plugin descriptor, missing target module, suspicious dependency, redacted config key, binary preview block, and permission denied. |
| Build output parser covers common MSVC/MSBuild/Clang/Rust/TypeScript patterns, bounded output summaries, unknown-line tolerance, and path/secret redaction. |
| TerminalPanel exposes user-triggered `Analyze output` for recorded terminal output summaries only. |
| MCP diagnostics bridge collects discovery/resources read-only observations and converts mutating tools to policy diagnostics without invoking them. |
| Context Pack v1 creates six redacted sections from project, diagnostics, build, MCP, terminal, and safety inputs. |
| DiagnosticsPanel, ReviewPanel, Evidence panel, Config settings, and TerminalPanel expose MVP11 summaries without new router/state manager/design system. |
| Audit/session/replay support diagnostic and context pack events; replay payloads are recorded summaries with `replayOnly`. |
| Side-effect scan has MVP11 categories for UI native imports, terminal command ambiguity, diagnostic redaction, and no auto-fix/provider-live risks. |
| Automated tests include shared contracts, parser, diagnostics, build parser, MCP bridge, Context Pack, UI panels, session/audit, and scenario matrix with 100+ assertions. |
| MVP11 docs, README, roadmap, and project status updated. |

## Acceptance Boundaries

- MVP11 is read-only diagnostics and build failure analysis.
- MVP11 does not implement UE writes.
- MVP11 does not add GitHub Actions or CI workflow files.
- MVP12 may plan controlled UE write workflows, but no MVP12 write path is implemented here.
