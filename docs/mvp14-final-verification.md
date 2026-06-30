# MVP14 Final Verification

Automated verification must record the required task commands in the implementation report.

Real UE supervisor-local smoke: `SUPERVISOR LOCAL PENDING`.

MVP14 real process observation rework:

- Fixture roots (`fixture://lyra`, `fixture://lyra-starter`) may still return fixture `UnrealEditor.exe` descriptors and fixture heartbeat for deterministic tests.
- Trusted real roots with an existing `.uproject` do not synthesize `source: native` / `processState: running`; until real OS process enumeration is implemented, discovery returns `status: degraded`, `reason: native_discovery_unavailable`, and `processes: []`.
- Non-fixture observation sessions without real lifecycle observation return `status: degraded`, `reason: native_process_observation_unavailable`; snapshots report `editorState: degraded`, `processAlive: false`, and include the same diagnostic.
- Real launch policy rejects bare `UnrealEditor.exe`; only fixture/test launch may use the bare executable path before returning the non-execution result.

The automated fixture path covers:

- feature gate disabled behavior;
- trusted root and `.uproject` binding;
- process discovery, attach, heartbeat, snapshot, stop;
- state-only proposal/approval/execute replay blocking;
- MCP schema classification and blocked asset plans;
- replay recorded-only summaries.
