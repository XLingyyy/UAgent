# MVP8 Prep

MVP8 can consider real terminal execution, browser automation, screenshot capture, and UE read/write preparation only after the MVP7 bridge is reviewed as mature.

## Required Gates Before Real Capabilities

- Explicit opt-in per capability and per project root.
- Approval decision before adapter execution.
- Sandbox policy that blocks write/exec/capture/browser-control by default.
- Audit and session replay that never re-executes real adapters.
- Redaction for raw secrets, Authorization headers, tokens, and raw home paths.
- Rollback or no-mutation proof for any future workspace write.
- Scenario matrix for each real capability.
- Side-effect scan category for every new adapter.

## Candidate Backlog

- Terminal exec: command allowlist, dry-run preview, timeout, cancellation, stdout/stderr redaction.
- Browser automation: URL allowlist, fixture replay, no default external navigation, deterministic block events.
- Screenshot capture: permission prompt, capture scope, metadata redaction, no background capture.
- UE write pipeline: read-only discovery first, then isolated mutation plans with approval, sandbox, audit, and rollback.
