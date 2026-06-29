# MVP11 Risk Register

| Risk | Mitigation | Status |
|------|------------|--------|
| Raw terminal output leaks secrets or absolute paths | Build parser stores bounded summaries only and redacts project/home paths, Bearer, token, api_key, Authorization, and sk-like values. | Mitigated |
| UE metadata parsing accidentally executes C# or Unreal tooling | Parser uses text heuristics only over already indexed/previews files. | Mitigated |
| MCP bridge invokes mutating tools | Bridge only reads discovery/resources and emits policy diagnostics for blocked tools. | Mitigated |
| Context Pack gets sent to provider automatically | Context Pack is an in-memory object/evidence summary only. | Mitigated |
| Replay re-executes terminal/native/MCP work | Replay uses recorded session summaries and `replayOnly` payloads. | Mitigated |
| Old native command ambiguity bypasses approval registry | Ambiguous command was renamed fixture-only; real product path remains `execute_terminal_command_real`. | Mitigated |
| Side-effect scan hides real violations | MVP11 categories use narrow allowlists and preserve review findings for docs/tests/policy code. | Mitigated |
