# UE MCP Plugin Contract Baseline

## Repository-defined Target

- Unreal Engine current target: UE `5.8.1`; engine changelist `56057345`;
  compatible changelist `55116800`; module BuildId `55116800`.
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

## Live product fingerprint contract

- Publication schema: `uagent.mvp15.live-asset-toolset-fingerprint.v1`.
- Canonical root payload: the publication schema version plus six tool payloads in the exact repository allowlist order.
- Canonical tool payload: `name`, `source`, `toolsetId`, `methodId`, descriptor `schemaVersion`, and the complete `inputSchema`, `dryRunSchema`, `rollbackContract`, `affectedAssetsSchema`, and `evidenceQuery` objects. Direct tools use null facade ids; facade tools require non-empty facade ids and schema version.
- Canonicalization: recursively sort object keys lexicographically, preserve array order and exact scalar values, encode compact JSON as UTF-8, and calculate lowercase SHA-256 plus UTF-8 byte length. Per-tool publication exposes only `name`, `source`, and SHA-256; it never publishes the full schema, endpoint, session id, path, PID, token, or credential.
- Fail-closed rules: missing, duplicate, unexpected, or raw-reordered asset tools; empty identity/schema version; null/array/primitive required contracts; non-finite/unsupported/cyclic/non-JSON objects; primitive, non-string, throwing/proxy-like malformed descriptors; stale session, endpoint, or generation all produce `blocked_by_mcp_schema`, `sha256: null`, and no accepted per-tool summaries.
- Blocked issue redaction: public issues may contain only exact allowlisted duplicate names, stable booleans, and counts for unexpected, unexpected-duplicate, and malformed input. Raw unexpected/duplicate names never enter the result, so discovery-controlled URL, path, endpoint, PID, token, `Bearer`, or credential text cannot be serialized.
- Authority: a successful publication is bound to the current desktop MCP session and discovery generation. A new connection generation retracts discovery, facade inventory, binding, SHA, and canonical byte length before endpoint validation or any synchronous status notification. Disconnect, endpoint change, reconnect, new discovery, concurrent connection completion, or stale discovery success/error completion cannot retain or overwrite authority.

## Isolated-copy Python cache integrity

`scripts/mvp15-python-cache-contract.json` defines exactly 28 CPython 3.11 timestamp-mode cache/source pairs across four cache directories. The validator keeps the business-file and cache surfaces separate, rejects unclassified paths/ABIs, missing pairs, changed business files, links/reparse substitutions, and invalid headers, and treats native path-inspection failure as `PATH_INSPECTION_FAILED` rather than a safe unknown.

Use only an approved disposable copy and a cache inside that copy. Compare pre/post business and contracted-cache identities; this integrity check does not prove official plugin identity or a live six-tool fingerprint. Do not broaden the contract to arbitrary cache writes.

## Live Fingerprint Procedure

1. Use product MCP discovery against the task-owned/local approved endpoint; do not bypass the product adapter.
2. Require exactly the six canonical names in canonical order and all five required contract fields.
3. Feed raw direct discovery and reviewed facade candidates to the product fingerprint boundary; do not pre-sort, drop duplicates, or hand-assemble descriptors.
4. Require `status: ready`, six redacted tool summaries, the current session/generation binding, and a lowercase SHA-256 before recording a live fingerprint.
5. Record only the plugin identity, UE build identifier, schema/fingerprint values, date, and redacted run reference. Do not record local paths, raw process ids, tokens, credential-bearing endpoints, or secrets.
6. Use the same plugin build identifier in the fresh happy-path ledger.

## Upgrade Rule

Any UE or plugin version/build change, binary hash change, source commit change, or live contract fingerprint change invalidates the real baseline. Repeat exact inventory discovery, contract normalization tests, the complete automated matrix, authority negative smokes, and the fresh product-UI real smoke before acceptance can advance.
