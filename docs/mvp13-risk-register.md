# MVP13 Risk Register

| Risk | Status | Mitigation |
| --- | --- | --- |
| Real UE version compatibility | Open | Native bridge defaults disabled; fixture path validates lifecycle without launching UE. |
| Editor process lifecycle | Open | Session registry records stopped/expired states; real process management is deferred. |
| MCP schema drift | Open | Mutating tools require exact allowlist and input schema before dry-run. |
| Asset mutation pressure | Accepted blocked risk | Save/delete/rename/move/compile remain blocked and represented as blocked plans only. |
| Text-backed mutation bypass | Mitigated | MVP13 bridge reuses MVP12 ChangeSet v2 preview/approve/apply/rollback. |
| Approval token replay | Mitigated | Runtime/native editor approvals are one-time and bound to proposal/session/root/kind/args hash/expiry. |
| Replay side effects | Mitigated | Replay summaries use `replayOnly` and `recordedOnlyActions`; no re-execute path is exposed. |
| Raw args/secrets leakage | Mitigated | Runtime redaction tests and side-effect scan categories cover tokens, secrets, and raw paths. |
