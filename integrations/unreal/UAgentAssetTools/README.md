# UAgentAssetTools

`UAgentAssetTools` is an independent UAgent companion plugin for Unreal Engine
5.8. It does not modify, replace, re-sign, or redeclare Epic's
`ModelContextProtocol` plugin.

The plugin exposes exactly six direct `IModelContextProtocolTool` tools in this
fixed order:

1. `ue.asset.create_folder`
2. `ue.asset.duplicate`
3. `ue.asset.rename`
4. `ue.asset.move`
5. `ue.asset.delete`
6. `ue.asset.save`

All writes are fail-closed unless the target is the exact
`/Game/UAgentSandbox/<run-id>` root or a strict descendant. `/Game/Test01` is a
read-only duplicate source. `delete` is an inverse-only rollback operation;
there is no forward delete API. The plugin never issues Save All, bulk asset
operations, package-wide saves, Blueprint compilation, or level saves.

Every execute and rollback call must carry the native registration, creation
time, connection/session generations, stable accepted-plan binding, original
operation index/count, and redacted source/manifest/plugin/package SHA-256
identities. The C++ ledger binds those plan-wide facts on first execute and
validates phase/index separately for each forward or inverse call.

On Windows, creation of the run root records the volume serial number and
`FILE_ID_128` obtained from a directory handle. Cleanup reopens the leaf,
rejects reparse points, nonempty or replaced directories and identity drift,
then deletes the exact empty directory by handle without recursive traversal.
Other platforms fail closed when equivalent physical identity is unavailable.

The plugin only publishes its UAgent identity extension after a packaged
`UAgentAssetTools.build.json` manifest has been validated. A source checkout
without a build manifest therefore remains unverified by design.

Build and provenance verification are documented in
`docs/mvp15-ue-companion-plugin-build-manifest.md` and are intentionally run
from a clean supervisor-provided source commit before final packaging.
