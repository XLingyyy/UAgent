# MVP14 Risk Register

| Risk | Mitigation |
| --- | --- |
| Real UE process metadata can expose local paths | Keep raw executable path, command line, canonical root, canonical `.uproject`, and pid in native-private registry only; UI descriptors use display paths and hashes. |
| Launch can become process control | Separate launch gate plus allowlisted args and `Command::new`; no shell string. |
| Stop session can become kill process | `stop_editor_observation_session` only marks UAgent session stopped. |
| MCP mutation can bypass ChangeSet v2 | Schema adapter classifies only; text-backed maps to ChangeSet intent and assets remain blocked. |
| Replay can re-execute native operations | Replay summaries are recorded-only and side-effect scan tracks re-execution markers. |
| UE command metadata does not expose `.uproject` | Discovery intentionally returns no attachable descriptor unless read-only metadata proves the process belongs to the current trusted `.uproject`. |
