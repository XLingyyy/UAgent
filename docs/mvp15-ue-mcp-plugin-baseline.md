# MVP15 UE MCP Plugin Baseline

This document separates repository-defined expectations from facts that must be collected from the real UE/MCP environment. It contains no local absolute path, process id, endpoint credential, token, or secret.

## Repository-defined Target

- Unreal Engine target family: `UE 5.8`; observed real-environment build: UE `5.8.0`, promoted changelist/BuildId `55116800`.
- Integration target: the official Unreal MCP plugin/server route described by the project.
- Exact tool order:
  1. `ue.asset.create_folder`
  2. `ue.asset.duplicate`
  3. `ue.asset.rename`
  4. `ue.asset.move`
  5. `ue.asset.delete`
  6. `ue.asset.save`
- Every descriptor must provide non-empty `inputSchema`, `dryRunSchema`, `rollbackContract`, `affectedAssetsSchema`, and `evidenceQuery` contracts.
- Exact facade metadata, when a reviewed facade is used, must bind `toolsetId`, `methodId`, and `schemaVersion` for every method. Incomplete, duplicate, unexpected, or reordered discovery fails closed.
- Plugin dry-run hash source: `ue_mcp_exact_tool`.
- Plugin dry-run hash algorithm: `sha1`.
- Plugin dry-run schema version: `mvp15c.dry-run.v1`.
- UAgent aggregate binding schema version: `uagent.mvp15.external-dry-run-binding.v1`.

The sources for these repository expectations are `packages/runtime/src/mvp15-mcp-asset-adapter.ts`, `packages/runtime/src/mvp15-exact-tool-facade.ts`, `packages/runtime/src/mvp15-mcp-dry-run-binding.ts`, and `packages/shared/src/asset-mutation.ts`.

## Task-copy Python Cache Integrity Contract

C13E defines a separate task-copy integrity surface for readiness and later product smoke. `scripts/mvp15-python-cache-contract.json` names exactly 28 CPython 3.11 timestamp-mode cache/source pairs in four `__pycache__` directories. Supervisor review found two defects in the initial validator; C13E1 now propagates native `lstat`/`realpath` inspection failures as `PATH_INSPECTION_FAILED`, reports `header.valid: false` for every failed header condition, passes 23/23 targeted tests, and revalidates the retained copy read-only without changing cache size/SHA/mtime. Supervisor review accepted the following two-layer rule as the pre/post containment gate at verified implementation commit `12159b9edd652bd8d8679e28415029ce3917f04d`:

- business layer: exactly `163 / 364,816,387 / 550ca685525243e88f9f549cd4230f698aa13c08e11985555664b31d2f13f383` after excluding only the contracted cache paths;
- cache layer: exactly `28 / 673,559 / b1e57b7aec0d3252cd3466c28a57e6b6111cccf3253d31b7833350cfbcc30339`, with every cache and source regular, non-link, non-reparse, correctly paired, and header-compatible;
- full Plugins layer: exactly `191 / 365,489,946 / 0468b036a24f3a0b761ed61e8dd0b82a7be535fa4282250679ddd70fc5e9889c`, with zero unclassified entries.

This contract is intentionally narrow and does not accept a 29th cache file, a different ABI, a missing or moved source, a changed business/cache file, an unverifiable path, a link/reparse substitution, or any broad Plugins write side effect. A native inspection error is a hard failure, never an unknown-but-safe result. The contract also does not prove the official plugin source/artifact mapping or the product-adapter live six-descriptor fingerprint required below.

## Repository Expectation Fingerprint

Canonicalization for this repository-side expectation uses UTF-8 JSON with object keys sorted lexicographically, no insignificant whitespace, and arrays kept in the order shown below:

```json
{"aggregateBindingSchemaVersion":"uagent.mvp15.external-dry-run-binding.v1","dryRunHashAlgorithm":"sha1","dryRunHashSource":"ue_mcp_exact_tool","dryRunSchemaVersion":"mvp15c.dry-run.v1","requiredContractFields":["inputSchema","dryRunSchema","rollbackContract","affectedAssetsSchema","evidenceQuery"],"tools":["ue.asset.create_folder","ue.asset.duplicate","ue.asset.rename","ue.asset.move","ue.asset.delete","ue.asset.save"]}
```

SHA-256: `42703e1fdd8d6198f6b72ba3dfdb8d3e4c2246ed604ac317ab1b76e1ca43e9cb`.

This hash fingerprints UAgent's expected inventory and version literals only. It is not the required live discovery fingerprint and does not identify a plugin binary.

## Observed Real Plugin Identity and Remaining Gaps

C12-C13E established and preserved the following real-environment byte identity without publishing local paths, PIDs, or endpoints:

- UE `5.8.0`, promoted build/changelist and `.modules` BuildId `55116800`.
- Active project-local descriptor: friendly name `Unreal MCP`, descriptor-reported version `1.0`, vendor string `Epic Games, Inc.`, descriptor SHA-256 `74420534edcd6baafcb48e0af919d53b84891bdade7b97869b0ef485c3ea1518`.
- Six task/user-loaded project-local module hashes:

| Module | SHA-256 |
| --- | --- |
| `UnrealEditor-ModelContextProtocol.dll` | `ee4ca6e01b82f2a4c83f09f92de5281181e9ac51fb0322ab25364f26f078ce16` |
| `UnrealEditor-ModelContextProtocolEditor.dll` | `957dee36ef9701f4a52f5c416ed741535ba84948ede7c8ba8fc40322279e7c40` |
| `UnrealEditor-ModelContextProtocolEditorTests.dll` | `df8a4476438b39b57fbb5dc0f49b9a668fcddc02c24c2fba835b0717419cda0b` |
| `UnrealEditor-ModelContextProtocolEngine.dll` | `814e15ba551c8e1450d1152695273de85959101fb9b173fd633ef1bce91489a1` |
| `UnrealEditor-ModelContextProtocolEngineTests.dll` | `e8de89e8762372964add2832677d065783d8952868e4f35b0e3deddb18d630ac` |
| `UnrealEditor-ModelContextProtocolTests.dll` | `ad832127dd48b7ce2341de4ad6ccbafdb02c2afcf77462cb9ca4f41e3993900a` |

These hashes reproducibly identify the active project-local bytes, but the descriptor vendor/version strings and matching BuildId do not prove an official source commit or authoritative official artifact mapping. They also do not bind a fresh product-UI smoke to a product-adapter-published contract.

| Required fact | Current value | Consequence |
| --- | --- | --- |
| Exact UE version/build | UE `5.8.0`, promoted `55116800` | Known environment fact; not a product-smoke pass |
| Active descriptor/module binary identity | Descriptor and six module SHA-256 values recorded above | Active bytes are reproducible |
| Official source commit or authoritative artifact mapping | Missing | `BLOCKED_BY_MCP_SCHEMA` |
| Fresh-smoke plugin build binding | Missing | Fresh product smoke cannot be accepted |
| Canonical product-adapter live six-descriptor fingerprint | Missing | `BLOCKED_BY_MCP_SCHEMA` |
| Per-tool schema/contract version or stable per-field fingerprint | Missing | Schema compatibility is not reproducible |

A statement that a plugin is running locally, a descriptor vendor string, or module hashes alone are not official provenance. Acceptance still requires the authoritative mapping plus the fresh live contract fingerprint.

## Live Fingerprint Procedure

1. Use product MCP discovery against the task-owned/local approved endpoint; do not bypass the product adapter.
2. Require exactly the six canonical names in canonical order and all five required contract fields.
3. Canonicalize each complete descriptor with deterministic key ordering while preserving array order and exact scalar values.
4. Hash the UTF-8 canonical descriptor array with SHA-256.
5. Record only the plugin identity, UE build identifier, schema/fingerprint values, date, and redacted run reference. Do not record local paths, raw process ids, tokens, credential-bearing endpoints, or secrets.
6. Use the same plugin build identifier in the fresh happy-path ledger.

## Upgrade Rule

Any UE or plugin version/build change, binary hash change, source commit change, or live contract fingerprint change invalidates the real baseline. Repeat exact inventory discovery, contract normalization tests, the complete automated matrix, authority negative smokes, and the fresh product-UI real smoke before acceptance can advance.
