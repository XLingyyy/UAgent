# MVP12 Prep - Controlled UE Text Repair Loop

Baseline: `8fc2e523 mvp11: add read-only diagnostics and context pack`.

MVP12 builds on MVP11 diagnostics with a controlled text mutation loop:

`diagnostic -> deterministic repair proposal -> ChangeSet v2 -> preview diff -> explicit approval -> native text write -> verification -> rollback -> evidence/audit/session replay`

Safety boundaries:

- Text writes are limited to trusted fixture/temp roots or explicitly trusted project roots.
- Allowed extensions: `.ini`, `.Build.cs`, `.Target.cs`, `.cs`, `.cpp`, `.h`, `.hpp`, `.uproject`, `.uplugin`.
- Binary UE assets and generated/cache directories remain blocked.
- React UI reads runtime store/actions only; native write commands stay behind adapter/runtime boundaries.
- Session replay records summaries only and does not re-run preview/apply/rollback.
- Provider live, mutating MCP, automatic git, package installs, and shell expansion remain out of scope.

Regression check: old ambiguous `execute_terminal_command` remains blocked by side-effect scan; MVP10 real terminal execution remains the only allowed terminal path.
