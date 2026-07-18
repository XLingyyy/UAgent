# MVP15 Risk Register

| Risk | Impact | Status | Mitigation | Mitigation Evidence / Residual |
| --- | --- | --- | --- | --- |
| Non-sandbox asset write | Corrupts user project assets | MITIGATED | Exact sandbox path policy, native guard, trusted-root binding, and exact MCP allowlist fail closed. | 09Z mutated only the registered run root and finished 256/256 canonical; non-sandbox and direct-call counts were zero. |
| Save All or broad package save | Writes unrelated assets | MITIGATED | Classifier and adapters block Save All, arbitrary SavePackage, and broad/bulk operations. | Accepted ledger contains only the five reviewed forward operations and four reviewed inverses. |
| Approval token leakage or forgery | Enables unauthorized or replayed execution | MITIGATED | Native issues a 256-bit token after full validation, stores only its hash, limits TTL, and consumes raw handoff on first execute. | 09Z used one registration; no token appeared in UI evidence and no second registration or replay mutation occurred. |
| Approval expiry before rollback | Prevents safe recovery after a long user verification window | CLOSED | Terminal mutation authority is removed while a bounded, read-only same-registration evidence lease supports final verification. | Rollback began 143,015 ms after registration, crossed the original 60-second TTL, and reached `rolled_back` in 10,785 ms without new authority. |
| Unknown or malformed plugin result treated as success | Records success without exact evidence | MITIGATED | Strict state-specific result keys, path/hash/phase checks, and explicit `sideEffectObserved` fail closed. | Accepted forward and rollback ledgers contain 5/5 and 4/4 strict results with no unknown-result fallback. |
| Replay re-execution | Repeats mutation without consent | CLOSED | Replay returns recorded summaries only; native and runtime reject repeat execution. | Accepted replay delta is native/MCP/provider/verification/rollback `0/0/0/0/0`. |
| Stale manifest or manifest-only verification | Verifies the wrong baseline or mistakes runtime state for persistence | MITIGATED | Revision/hash validation plus external read-only Content evidence is mandatory. | Product reached `verified`; final Content was 256/256 canonical with every mismatch zero and source unchanged. |
| MCP schema drift or facade misbinding | Executes outside the reviewed exact contract | MITIGATED | Complete fixed method/schema/dry-run/rollback/evidence contract is required; incomplete discovery blocks. | 09Z recorded exact 5 forward and 4 rollback facade dispatches; future endpoint drift remains fail-closed. |
| Raw path, identity, or secret leakage | Exposes private environment details or credentials | MITIGATED | Redacted virtual paths and safe evidence identifiers; scan blocks token/path/identity patterns. | Supervisor side-effect scan passed 298 files / 0 blocked / 928 review; accepted UI evidence contained no raw sensitive fields. |
| Partial execute or rollback failure | Leaves assets requiring recovery while UI appears terminal | MITIGATED | Ownership requires an exact observed reversible side effect; completed inverses are not repeated and failures retain rollback state/evidence. | Automated partial-failure coverage passed; 09Z completed all 5 forward and 4 inverse operations. |
| Run-root cleanup escapes or deletes shared content | Deletes another run, shared container, or user data | MITIGATED | Cleanup owns only the exact registered run root and rejects assets, files, reparse points, cross-run targets, or ambiguous containment. | Final exact run root was absent; fixed container remained ordinary, non-reparse, and strictly empty. |
| Provider auto-apply | Writes generated output without explicit consent | MITIGATED | Explicit dry-run and user approval are mandatory; provider live default remains blocked. | Accepted action ledger contains one explicit approval and zero provider auto-apply actions. |
| Native/TypeScript policy mismatch | Divergent guards weaken the boundary | MITIGATED | Paired runtime/native tests plus serial Rust and workspace verification. | Supervisor verification passed Rust 126/126, runtime 786/786, and the complete workspace suite. |
| Real UE environment variance | Behavior differs across engine, project, plugin, or machine versions | ACCEPTED | Repeat the manual smoke for future boundary changes and target environments. | 09Z proves the accepted environment; it cannot eliminate variance in future environments. |
| Existing React warnings, chunk warning, and Rust formatting debt | Adds maintenance noise or obscures future regressions | ACCEPTED | Track separately; do not hide or bulk-fix during this documentation closeout. | Existing `act(...)`, >500 kB chunk, and formatting warnings were non-blocking in final verification. |

## Stage Conclusion

- Acceptance status: `COMPLETE`.
- Real smoke status: `PASS_REAL_SMOKE`.
- Remaining MVP15 acceptance blockers: `None`.
- Ready for next stage: `YES`.

Residual environment variance and known engineering debt remain explicit; final acceptance does not enable any prohibited capability.
