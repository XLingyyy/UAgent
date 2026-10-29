# ADR: UAgentAssetTools Companion Registration

## Decision

Use the independent `UAgentAssetTools` companion and direct `IModelContextProtocolTool` registration. Epic's `ModelContextProtocol` remains the unmodified localhost MCP transport and public extension point. Toolset Registry and generic wrapper calls are not implicit fallbacks.

The active plugin's identity must be established by its actual build, manifest, installed modules, loaded modules, and current discovery. A planned descriptor or source snapshot cannot substitute for a verified package or live fingerprint.

## Identity and safety consequences

- Required invariant: the plugin publishes `x-uagent-plugin` only after strict
  manifest/self-hash/artifact validation; no production mutation is authorized
  before current package, discovery and loaded-module identity checks pass.
- Required invariant: runtime accepts only an attested exact-six descriptor set
  from the canonical allowlist. A missing,
  duplicate, unexpected, reordered, malformed, stale, or identity-mismatched
  set retracts readiness.
- `ue.asset.delete` is inverse-only. The forward dry-run has five operations:
  create folder, duplicate, rename, move, and save.
- Native UAgent still owns trusted root, live UE observation, feature gate,
  one-shot approval, operation guards, and external Content evidence.
- The companion never performs Save All, bulk operations, Blueprint/level
  compilation or save, non-sandbox writes, or replay re-execution.

For packaging and discovery requirements, see [the build manifest contract](mvp15-ue-companion-plugin-build-manifest.md) and [the MCP baseline](mvp15-ue-mcp-plugin-baseline.md).
