# MVP9 Risk Register

## Risk Table

| ID | Risk | Probability | Impact | Mitigation | Status |
|----|------|-------------|--------|------------|--------|
| R01 | Terminal command execution bypasses approval gate | Low | Critical | Three-phase flow (propose -> approve -> execute); classifier blocks dangerous commands; approval token required; audit trail | Mitigated |
| R02 | Terminal output contains raw secrets or home paths | Medium | High | Output redaction applied to stdout/stderr; test fixtures inject secrets to verify redaction | Mitigated |
| R03 | Browser preview navigates to external/malicious URL | Low | High | Default policy blocks all external URLs; local-only patterns required; user must approve external URLs | Mitigated |
| R04 | Screenshot capture triggered without user consent | Low | High | Capture requires explicit user approval; no background capture; permission prompt mandatory | Mitigated |
| R05 | File watcher consumes excessive resources | Medium | Low | Debounce window (500ms default); max queue size; overflow warning; stop/cancel available | Mitigated |
| R06 | File watcher auto-triggers rescan or side effects | Low | Critical | Watcher produces dirty state + diff only; apply/rescan is user-initiated; audit trail for all actions | Mitigated |
| R07 | Session replay re-executes terminal/browser/screenshot/watcher | Low | Critical | Replay only replays recorded events; adapters not invoked during replay | Mitigated |
| R08 | React UI directly invokes native commands | Low | High | Side-effect scan blocks direct terminal/browser/screenshot/watcher native calls; adapter/store layer required | Mitigated |
| R09 | Raw absolute paths leak into watcher diff or terminal output | Medium | High | All paths are root-relative/redacted; displayPath prefix `[project-root]/`; side-effect scan checks raw paths | Mitigated |

## Testing Coverage

- Terminal policy: unit tests for classifier (allowlisted, dangerous, shell metachar, root escape)
- Browser policy: unit tests for URL classification (local vs external)
- Screenshot: unit tests for request/approve/deny flow and feature flag guard
- Watcher: unit tests for start/stop, change events, diff computation, root rejection
- Scenario matrix: 96 MVP9 scenarios covering all capabilities
- Side-effect scan: 5 new MVP9 categories with 0 blocked findings
- Terminal cwd redaction: tests prove `/repo`, `C:/Users/`, `/Users/`, `/home/` absent from evidence
- Screenshot metadata: tests prove no raw path or secret leakage
- Rust tests: 18 native skeleton tests passing serially

## Residual Risk

- Native terminal/browser/screenshot/watcher skeletons are feature-flagged and default-off; real OS API execution requires explicit feature flag enablement and additional testing in a future MVP
- Composer terminal intent integration is complete (build/test/lint pattern detection); remaining UI refinement is future work
- Side-effect scan review findings (non-blocking) are tracked and will be resolved iteratively
