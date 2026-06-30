# MVP14 Risk Register

| Risk | Status | Mitigation |
| --- | --- | --- |
| Real UE process metadata can expose local paths | Controlled | Keep raw executable path, command line, canonical root, canonical `.uproject`, and pid in native-private registry only; UI descriptors use display paths and hashes. |
| Launch can become process control | Controlled | Separate launch gate plus allowlisted args and `Command::new`; no shell string. |
| Stop session can become kill process | Controlled | `stop_editor_observation_session` only marks UAgent session stopped. |
| MCP mutation can bypass ChangeSet v2 | Controlled | Schema adapter classifies only; text-backed maps to ChangeSet intent and assets remain blocked. |
| Replay can re-execute native operations | Controlled | Replay summaries are recorded-only and side-effect scan tracks re-execution markers. |
| Real UE environment unavailable in automation | Open | Current real UE smoke is `BLOCKED_BY_ENVIRONMENT`; supervisor/user must open a trusted-root real `.uproject` in UE Editor and rerun the manual smoke. |
| UE command metadata does not expose `.uproject` | Open | Discovery intentionally returns no attachable descriptor unless read-only metadata proves the process belongs to the current trusted `.uproject`. |
