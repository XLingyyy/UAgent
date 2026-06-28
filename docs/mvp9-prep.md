# MVP9 Preparation

## Suggested MVP9 Gates

- **Controlled Terminal Dry-run & Approval-bound Execution**: Real command proposal with explicit user approval before execution. Sandbox-bounded shell execution for build commands and automation scripts.
- **Browser/Screenshot Preview**: Local browser preview of HTML/UE output. Screenshot capture of UE Editor viewport. Both must remain user-initiated, approval-gated, and read-only.
- **Incremental File Watcher**: Watch project root for file changes and emit index update events. No automatic rescan; user-initiated diff-based update.

## Constraints

- All new MVP9 capabilities must pass through Capability Bridge policy gate
- Approval/Sandbox/Audit/Session/Redaction boundaries remain non-negotiable
- Provider live remains manual opt-in with secret management
- No automatic side effects without explicit user action
