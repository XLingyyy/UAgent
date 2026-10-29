# UE Asset Lifecycle Requirements

## Identity and authority

- The official package build starts from immutable clean source and binds production source identity, manifest, package artifacts, installed modules and loaded modules. Extra copies, additional modules, unexpected descriptor transformations or hash drift fail closed.
- Direct registration supplies exactly the six canonical asset tools, in canonical order, with all five complete contracts. Tool Search on/off, refresh, reconnect, endpoint changes, renderer/UE restart and stale completions cannot retain an old accepted discovery or fingerprint.
- Native registries own trusted roots, live editor observations, process creation identity and project/session/generation binding. UI paths or caller-derived identity cannot substitute for these records.
- Before approval, bind all five forward operations and exact arguments to the dry-run result, current plugin/session/root identity, affected assets, rollback plan and external evidence queries. Dry-run must not mutate Content.
- Every forward and inverse MCP call follows a fresh native authority guard. First execute uses a one-time 60-second token; absolute forward/recovery deadlines remain 15/20 minutes without heartbeat or retry extension.

## Execution and recovery

- Writes remain below the exact registered `/Game/UAgentSandbox/<run-id>` root. Forward operations are create folder, duplicate, rename, move and save one asset; `ue.asset.delete` is inverse-only.
- Results are strictly decoded and side-effect-aware. Unknown/malformed results cannot create successful ownership. Only exact owned effects receive inverse rollback, in reverse order.
- Verification proves the source unchanged, intended target/path state, outside-run Content unchanged, and the exact root/container cleanup state. Active evidence rechecks root/path authority; terminal evidence is bounded and read-only.
- Trust revocation, root replacement, gate changes, process exit, stopped observations and binding changes must block the next operation. After owned effects, only explicit same-registration bounded recovery is allowed.
- Replay performs zero native/MCP/provider/verification/rollback work. Partial failure, unknown residue or failed recovery stops the lifecycle and is reported without broad/manual cleanup.

## Runtime and validation tooling

- Native runtime bridge handshakes bind the actual renderer/window instance. A same-label replacement waits for authoritative predecessor destruction, revalidates occupancy and ownership, rejects late continuation, and never destroys an unrelated replacement window.
- Fixed producer adapters own live launch/session/process receipts. Persisted artifact consistency and fixture results cannot establish owned live launch authority. Raw process/session/path/credential data must not enter published evidence.
- Official UE Automation parsing accepts the defined leading UTF-8 BOM while preserving raw-byte hashes, JSON/matrix validation and process provenance. Native binding resources, descriptor transformations and canonical self-hashes remain exact schema-bound inputs.
- Product UI controls must exercise genuine registration, gate-off, expiry, stale authority, execute/rollback and replay outcomes; synthetic success must not replace negative-case or real-side-effect receipts.

The [lifecycle guide](mvp15-manual-smoke.md) specifies repeatable positive, negative, expiry, rollback and replay checks. [The manifest contract](mvp15-ue-companion-plugin-build-manifest.md) and [MCP baseline](mvp15-ue-mcp-plugin-baseline.md) define package/discovery verification. These requirements are not a completed live-run record.
