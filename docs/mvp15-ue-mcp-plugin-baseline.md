# MVP15 UE MCP Plugin Baseline

## Independent UAgent Companion Baseline — MVP15D

Rework 8 is `NEEDS_FIX` because the current acceptance manifest file SHA
conflicted with retained evidence and the other current repository documents,
while code and retained evidence validation passed. Rework 9 and the D0-D12
source checkpoint are `COMPLETE`. Ready for the next MVP stage remains `NO`
because G13/G16 and 15A-15C remain separately gated. Retained D0 supports task
`TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-9`
(previous task
`TASK-MVP15D-UAGENT-UE-COMPANION-PLUGIN-SOURCE-CHECKPOINT-REWORK-8`).
`external/mvp15d-rework7-d0-20260726_190100` selects Direct with 129 indexed
artifacts and mutation zero; transcript-index SHA-256 is
`b87e0a8a4d685b0cbddd55c8ea5ed4e944b9feba7aaa9d9176e23e2dfdeb0f99`.
Retained build `external/mvp15d-rework7-build-20260726_203000` and UE
`external/mvp15d-rework7-ue-20260726_190100` close
`BLOCKED_BY_EVIDENCE_RETENTION`; UE capture SHA-256 is
`8794de55d0bc3444015116918b92e957070e684ac014f7f9551c07762af1cbb8`.
Verified implementation/content checkpoint
`b1c4e4a4b567d5018c0d0fa7fa1769a26e70f66e` is published with the Rework 9
documentation closeout checkpoint.

These implementation results address the Rework 5 observer/native authority,
cross-language binding, create-to-identity ownership, Rust isolation, and
process-closeout findings. No final clean 15A package, installed/loaded package
identity proof, or real product-mutation result exists. D13, 15A, 15B, and 15C
remain prohibited.

The repository working tree carries `integrations/unreal/UAgentAssetTools`,
independent from Epic's plugin and with no Epic signing/vendor claim. Historical
Rework 3 source work added task-only Direct and Toolset probes, inverse and
cleanup hardening, and native module enumeration; its supervisor verdict was
`NEEDS_FIX`. The four historical captures are UE Commandlet Automation markers,
not UAgent product-adapter evidence. They do not make this an accepted plugin
baseline or route decision.

A clean source commit/tree remains required only for later final 15A packaging.

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

C13E defines a separate task-copy integrity surface for readiness and later product smoke. `scripts/mvp15-python-cache-contract.json` names exactly 28 CPython 3.11 timestamp-mode cache/source pairs in four `__pycache__` directories. Supervisor review found two defects in the initial validator; C13E1 now propagates native `lstat`/`realpath` inspection failures as `PATH_INSPECTION_FAILED`, reports `header.valid: false` for every failed header condition, passes 23/23 targeted tests, and revalidates the retained copy read-only without changing cache size/SHA/mtime. Supervisor review accepted the following two-layer rule as the pre/post containment gate at verified implementation commit `12159b9b5eb31829208df5c01c7fc97f157398c2`:

- business layer: exactly `163 / 364,816,387 / 550ca685525243e88f9f549cd4230f698aa13c08e11985555664b31d2f13f383` after excluding only the contracted cache paths;
- cache layer: exactly `28 / 673,559 / b1e57b7aec0d3252cd3466c28a57e6b6111cccf3253d31b7833350cfbcc30339`, with every cache and source regular, non-link, non-reparse, correctly paired, and header-compatible;
- full Plugins layer: exactly `191 / 365,489,946 / 0468b036a24f3a0b761ed61e8dd0b82a7be535fa4282250679ddd70fc5e9889c`, with zero unclassified entries.

This contract is intentionally narrow and does not accept a 29th cache file, a different ABI, a missing or moved source, a changed business/cache file, an unverifiable path, a link/reparse substitution, or any broad Plugins write side effect. A native inspection error is a hard failure, never an unknown-but-safe result. C14 re-ran this gate before and after its read-only attempt: all three aggregates and the 28-entry path/size/SHA/mtime manifest were identical. The contract does not prove the official plugin source/artifact mapping or the product-adapter live six-descriptor fingerprint required below.

## Repository Expectation Fingerprint

Canonicalization for this repository-side expectation uses UTF-8 JSON with object keys sorted lexicographically, no insignificant whitespace, and arrays kept in the order shown below:

```json
{
  "aggregateBindingSchemaVersion": "uagent.mvp15.external-dry-run-binding.v1",
  "dryRunHashAlgorithm": "sha1",
  "dryRunHashSource": "ue_mcp_exact_tool",
  "dryRunSchemaVersion": "mvp15c.dry-run.v1",
  "requiredContractFields": [
    "inputSchema",
    "dryRunSchema",
    "rollbackContract",
    "affectedAssetsSchema",
    "evidenceQuery"
  ],
  "tools": [
    "ue.asset.create_folder",
    "ue.asset.duplicate",
    "ue.asset.rename",
    "ue.asset.move",
    "ue.asset.delete",
    "ue.asset.save"
  ]
}
```

SHA-256: `42703e1fdd8d6198f6b72ba3dfdb8d3e4c2246ed604ac317ab1b76e1ca43e9cb`.

This hash fingerprints UAgent's expected inventory and version literals only. It is not the required live discovery fingerprint and does not identify a plugin binary.

## Observed Real Plugin Identity and Remaining Gaps

C12-C13E established and preserved the following real-environment byte identity without publishing local paths, PIDs, or endpoints:

- UE `5.8.0`, promoted build/changelist and `.modules` BuildId `55116800`.
- Active project-local descriptor: friendly name `Unreal MCP`, descriptor-reported version `1.0`, vendor string `Epic Games, Inc.`, descriptor SHA-256 `74420534edcd6baafcb48e0af919d53b84891bdade7b97869b0ef485c3ea1518`.
- Six task/user-loaded project-local module hashes:

| Module                                             | SHA-256                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `UnrealEditor-ModelContextProtocol.dll`            | `ee4ca6e01b82f2a4c83f09f92de5281181e9ac51fb0322ab25364f26f078ce16` |
| `UnrealEditor-ModelContextProtocolEditor.dll`      | `957dee36ef9701f4a52f5c416ed741535ba84948ede7c8ba8fc40322279e7c40` |
| `UnrealEditor-ModelContextProtocolEditorTests.dll` | `df8a4476438b39b57fbb5dc0f49b9a668fcddc02c24c2fba835b0717419cda0b` |
| `UnrealEditor-ModelContextProtocolEngine.dll`      | `814e15ba551c8e1450d1152695273de85959101fb9b173fd633ef1bce91489a1` |
| `UnrealEditor-ModelContextProtocolEngineTests.dll` | `e8de89e8762372964add2832677d065783d8952868e4f35b0e3deddb18d630ac` |
| `UnrealEditor-ModelContextProtocolTests.dll`       | `ad832127dd48b7ce2341de4ad6ccbafdb02c2afcf77462cb9ca4f41e3993900a` |

These hashes reproducibly identify the active project-local bytes, but the descriptor vendor/version strings and matching BuildId do not prove an official source commit or authoritative official artifact mapping. C14 Authenticode inspection found that all six active modules are unsigned. A separate sibling set is validly signed by Epic Games, Inc., uses the same UE build family, and has six different SHA-256 values. That proves the sibling set's publisher identity, not a mapping from the active bytes to an official package or source build. No package manifest, official source revision, repository revision, or build attestation was present to bridge that gap.

### Historical C14 authoritative mapping matrix

| Evidence                             | Observed fact                                                              | Authority decision                                             |
| ------------------------------------ | -------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Active descriptor/version/BuildId    | Stable descriptor SHA, version `1.0`, and build `55116800`                 | Identity only; insufficient provenance                         |
| Active six module hashes             | Reproduces the loaded project-local bytes; Authenticode status is unsigned | Stable identity only; insufficient provenance                  |
| Signed sibling six modules           | Valid Epic Games, Inc. code-signing chain and matching engine build family | Authoritative for the sibling bytes only                       |
| Active-to-sibling comparison         | Every module hash differs                                                  | Explicitly does not map active bytes to the signed sibling set |
| Official package/source/build record | Not found in the inspected material                                        | Required mapping remains missing                               |

The mapping can close only if an official package manifest names the exact active hashes, the exact active binaries carry a valid Epic signature, or an official source revision plus build attestation reproducibly maps to those exact hashes.

| Required fact                                                    | Current value                                                                                                        | Consequence                                                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Exact UE version/build                                           | UE `5.8.0`, promoted `55116800`                                                                                      | Known environment fact; not a product-smoke pass                                         |
| Active descriptor/module binary identity                         | Descriptor and six module SHA-256 values recorded above                                                              | Active bytes are reproducible                                                            |
| Official source commit or authoritative artifact mapping         | Missing; signed sibling bytes do not hash-match the active unsigned bytes                                            | `BLOCKED_BY_MCP_SCHEMA`                                                                  |
| Fresh-smoke plugin build binding                                 | Missing                                                                                                              | Final clean installed/loaded identity remains a later 15A gate                           |
| Canonical product-adapter live six-descriptor fingerprint        | Rework 7 retained D0 records four independently indexed sessions, zero mutation, and Direct; final 15B installed-build binding has not run | PARTIAL |
| Per-tool schema/contract version or stable per-field fingerprint | Rework 7 D0 and five-session `48/48` UE matrix exercise the exact-six contract; the Rework 9 source checkpoint is complete | IMPLEMENTED for the source checkpoint; final installed-build identity remains later work |

A statement that a plugin is running locally, a descriptor vendor string, or module hashes alone are not official provenance. Acceptance still requires the authoritative mapping plus the fresh live contract fingerprint.

## Historical C14 Product Fingerprint Contract

- Publication schema: `uagent.mvp15.live-asset-toolset-fingerprint.v1`.
- Canonical root payload: the publication schema version plus six tool payloads in the exact repository allowlist order.
- Canonical tool payload: `name`, `source`, `toolsetId`, `methodId`, descriptor `schemaVersion`, and the complete `inputSchema`, `dryRunSchema`, `rollbackContract`, `affectedAssetsSchema`, and `evidenceQuery` objects. Direct tools use null facade ids; facade tools require non-empty facade ids and schema version.
- Canonicalization: recursively sort object keys lexicographically, preserve array order and exact scalar values, encode compact JSON as UTF-8, and calculate lowercase SHA-256 plus UTF-8 byte length. Per-tool publication exposes only `name`, `source`, and SHA-256; it never publishes the full schema, endpoint, session id, path, PID, token, or credential.
- Fail-closed rules: missing, duplicate, unexpected, or raw-reordered asset tools; empty identity/schema version; null/array/primitive required contracts; non-finite/unsupported/cyclic/non-JSON objects; primitive, non-string, throwing/proxy-like malformed descriptors; stale session, endpoint, or generation all produce `blocked_by_mcp_schema`, `sha256: null`, and no accepted per-tool summaries.
- Blocked issue redaction: public issues may contain only exact allowlisted duplicate names, stable booleans, and counts for unexpected, unexpected-duplicate, and malformed input. Raw unexpected/duplicate names never enter the result, so discovery-controlled URL, path, endpoint, PID, token, `Bearer`, or credential text cannot be serialized.
- Authority: a successful publication is bound to the current desktop MCP session and discovery generation. A new connection generation retracts discovery, facade inventory, binding, SHA, and canonical byte length before endpoint validation or any synchronous status notification. Disconnect, endpoint change, reconnect, new discovery, concurrent connection completion, or stale discovery success/error completion cannot retain or overwrite authority.

The C14 task-owned attempt observed the expected loaded module/listener environment but the product adapter's single initialization request encountered a pre-discovery transport/environment failure. `list_toolsets`, `describe_toolset`, generic `call_tool`, registration, token, dry-run, execute, verify, rollback, replay, and mutation counts were all zero. It produced no descriptor/schema decision or live fingerprint evidence; the fail-closed getter remained without an accepted SHA or per-tool summary. No fixture descriptor was substituted. C14A did not rerun live discovery or launch UE/UAgent.

## Live Fingerprint Procedure

1. Use product MCP discovery against the task-owned/local approved endpoint; do not bypass the product adapter.
2. Require exactly the six canonical names in canonical order and all five required contract fields.
3. Feed raw direct discovery and reviewed facade candidates to the product fingerprint boundary; do not pre-sort, drop duplicates, or hand-assemble descriptors.
4. Require `status: ready`, six redacted tool summaries, the current session/generation binding, and a lowercase SHA-256 before recording a live fingerprint.
5. Record only the plugin identity, UE build identifier, schema/fingerprint values, date, and redacted run reference. Do not record local paths, raw process ids, tokens, credential-bearing endpoints, or secrets.
6. Use the same plugin build identifier in the fresh happy-path ledger.

## Upgrade Rule

Any UE or plugin version/build change, binary hash change, source commit change, or live contract fingerprint change invalidates the real baseline. Repeat exact inventory discovery, contract normalization tests, the complete automated matrix, authority negative smokes, and the fresh product-UI real smoke before acceptance can advance.
