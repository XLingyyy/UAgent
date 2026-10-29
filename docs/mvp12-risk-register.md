# MVP12 Risk Register

| Risk | Mitigation | Residual Risk |
| --- | --- | --- |
| Binary UE asset mutation | extension blocklist and side-effect scan category | Asset-level workflows remain MVP13+. |
| Secret/path leakage in diffs | runtime/native redaction and side-effect scan | Manual review should inspect REPORT and diff snippets. |
| Stale base overwrite | before/current hash checks before apply and rollback | Concurrent external edits are blocked, not merged. |
| Replay side effects | replay summary API is recorded-only | Replay UI should remain display-only. |
| Overbroad deterministic edits | recipes operate on narrow patterns only | Complex C++/C# repairs are manual note / locate-only. |
| Expired approval reuse | runtime/native validation checks current time against approval expiry | System clock skew can still cause conservative blocking. |
| Apply-time after-content substitution | approval binds per-operation after hashes from preview/apply request | Preview must be regenerated when desired after content changes. |
