# MVP14 Risk Register

| Risk | Status | Mitigation |
| --- | --- | --- |
| Real UE process metadata can expose local paths | Open | Use display paths, pid hashes, executable hashes, and redacted summaries only. |
| Launch can become process control | Controlled | Separate launch gate plus allowlisted args and `Command::new`; no shell string. |
| Stop session can become kill process | Controlled | `stop_editor_observation_session` only marks UAgent session stopped. |
| MCP mutation can bypass ChangeSet v2 | Controlled | Schema adapter classifies only; text-backed maps to ChangeSet intent and assets remain blocked. |
| Replay can re-execute native operations | Controlled | Replay summaries are recorded-only and side-effect scan tracks re-execution markers. |
| Real UE environment unavailable in automation | Open | Mark real UE smoke as `SUPERVISOR LOCAL PENDING` until supervisor local run. |
