# MVP13 Risk Register

| Risk | Mitigation |
| --- | --- |
| Real UE version compatibility | Native bridge defaults disabled; fixture path validates lifecycle without launching UE. |
| Editor process lifecycle | Session registry records stopped/expired states; real process management is deferred. |
| MCP schema drift | Mutating tools require exact allowlist and input schema before dry-run. |
| Asset mutation pressure | Save/delete/rename/move/compile remain blocked and represented as blocked plans only. |
| Text-backed mutation bypass | MVP13 bridge reuses MVP12 ChangeSet v2 preview/approve/apply/rollback. |
| Approval token replay | Runtime/native editor approvals are one-time and bound to proposal/session/root/kind/args hash/expiry. |
| Replay side effects | Replay summaries use `replayOnly` and `recordedOnlyActions`; no re-execute path is exposed. |
| Raw args/secrets leakage | Runtime redaction tests and side-effect scan categories cover tokens, secrets, and raw paths. |
