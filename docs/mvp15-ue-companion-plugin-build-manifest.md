# UAgentAssetTools Build Manifest Contract

A valid package is built from immutable clean source with the official UE toolchain. Planned artifacts, fixture summaries, or source snapshots cannot stand in for a package manifest or installed/loaded identity.

## Required manifest

`UAgentAssetTools.build.json` must validate against
`integrations/unreal/UAgentAssetTools/Resources/uagent-companion-build-manifest.schema.json`
and contain:

- plugin id/version and independent `mvp15d.asset-tools.v1` contract version;
- 40-lower-hex `sourceCommit`, 64-lower-hex `sourceTreeSha256`, and literal
  `dirty: false`;
- engine `5.8.1`, engine changelist `56057345`, compatible changelist
  `55116800`, module BuildId `55116800`, Win64 Development configuration, and
  non-sensitive compiler/Windows SDK/build-command fingerprint;
- `UAgentAssetTools.uplugin`, contract schema, and every packaged module's
  basename, byte size, and SHA-256;
- ordered exact-six tool names, generated timestamp, non-sensitive builder
  identity, and `manifestSelfSha256`.

Official UE 5.8 `BuildPlugin` rewrites the packaged descriptor, so descriptor
verification is semantic rather than byte equality. The source descriptor must
bind the exact toolchain engine version, declare `Installed: false`, and retain
false defaults for `EnabledByDefault`, `ExplicitlyLoaded`,
`IsExperimentalVersion`, and `SupportsContentBrowser`. The packaged descriptor
must differ only by changing `Installed` to `true`, normalizing
`EngineVersion` to `<major>.<minor>.0`, and omitting those four false defaults.
Every other key, value, and array position remains exact. The build ledger binds
the source descriptor bytes, while the manifest binds the rewritten packaged
descriptor bytes; any additional drift fails with
`PACKAGE_DESCRIPTOR_TRANSFORM_INVALID`.

The self-hash rule is canonical UTF-8 JSON with lexicographically sorted object
keys, preserved array order, no insignificant whitespace, and the
`manifestSelfSha256` property omitted while hashing. The final hash is not hashed
again. Paths, binaries, PDBs, logs, credentials, and machine-local absolute
paths do not belong in the manifest. Repository documentation must not embed machine-local diagnostics or credentials.

## Reproducible package build

1. Start from an immutable clean implementation commit and record its source
   identity before building.
2. Create a fresh no-hardlink clone with deterministic physical bytes and prove
   both Git cleanliness and fixed fixture hashes.
3. Run the exact official UE 5.8 command through the wrapper:

   ```text
   RunUAT.bat BuildPlugin -Plugin=<clean-source>/integrations/unreal/UAgentAssetTools/UAgentAssetTools.uplugin -Package=<task-owned-package> -TargetPlatforms=Win64 -Rocket
   ```

4. Generate the manifest only after a complete sealed build; supply the retained
   `build-command.json` and `build-result.json` so the helper recomputes real
   compiler/SDK/UE/module facts and both manifest self/file hashes.
5. Run `scripts/mvp15d-manifest.mjs verify` against the real package
   root so it rehashes every declared artifact, rejects extra/unlisted modules,
   and compare installed and loaded
   module basenames, sizes, and hashes with the manifest inside a new
   task-owned disposable UE project. A duplicate companion copy or an extra
   module fails closed.
6. Only after package verification may the real desktop adapter publish a live
   identity/fingerprint. Any later asset lifecycle needs its own explicit approval
   and the current session/root/process binding.

## Failure mapping

- source/dirty/manifest/module mismatch: `BLOCKED_BY_PLUGIN_PROVENANCE`;
- live descriptor identity mismatch: `BLOCKED_BY_PLUGIN_IDENTITY`;
- incomplete exact-six contract: `BLOCKED_BY_MCP_SCHEMA`;
- initialize/discovery failure: `BLOCKED_BY_MCP_TRANSPORT`;
- UE/native/session/root/gate failure: `BLOCKED_BY_ENVIRONMENT`.
