/**
 * Public, non-sensitive contracts shared by the UAgent renderer/runtime and the
 * UAgentAssetTools Unreal companion.  The companion is deliberately separate
 * from Epic's ModelContextProtocol plugin; these values are an attestation
 * boundary, not a vendor or signing claim.
 */

export const UAGENT_COMPANION_IDENTITY_SCHEMA_VERSION =
  "uagent.ue-companion-plugin.identity.v1" as const;
export const UAGENT_COMPANION_MANIFEST_SCHEMA_VERSION =
  "uagent.ue-companion-plugin.build-manifest.v1" as const;
export const UAGENT_COMPANION_PLUGIN_ID = "UAgentAssetTools" as const;
export const UAGENT_COMPANION_PLUGIN_VERSION = "0.1.0" as const;
export const UAGENT_COMPANION_CONTRACT_VERSION = "mvp15d.asset-tools.v1" as const;
export const UAGENT_COMPANION_UE_VERSION = "5.8.0" as const;
export const UAGENT_COMPANION_UE_BUILD_ID = "55116800" as const;

export const UAGENT_COMPANION_TOOL_NAMES = [
  "ue.asset.create_folder",
  "ue.asset.duplicate",
  "ue.asset.rename",
  "ue.asset.move",
  "ue.asset.delete",
  "ue.asset.save",
] as const;

export type UAgentCompanionToolName = (typeof UAGENT_COMPANION_TOOL_NAMES)[number];

export interface UAgentCompanionIdentity {
  schemaVersion: typeof UAGENT_COMPANION_IDENTITY_SCHEMA_VERSION;
  pluginId: typeof UAGENT_COMPANION_PLUGIN_ID;
  pluginVersion: string;
  contractVersion: string;
  sourceCommit: string;
  buildManifestSha256: string;
  ueBuildId: typeof UAGENT_COMPANION_UE_BUILD_ID;
}

export interface UAgentCompanionArtifactHash {
  name: string;
  size: number;
  sha256: string;
}

export interface UAgentCompanionBuildManifest {
  schemaVersion: typeof UAGENT_COMPANION_MANIFEST_SCHEMA_VERSION;
  pluginId: typeof UAGENT_COMPANION_PLUGIN_ID;
  pluginVersion: string;
  contractVersion: string;
  sourceCommit: string;
  sourceTreeSha256: string;
  dirty: false;
  ueVersion: typeof UAGENT_COMPANION_UE_VERSION;
  ueBuildId: typeof UAGENT_COMPANION_UE_BUILD_ID;
  targetPlatform: "Win64";
  configuration: "Development";
  compiler: string;
  windowsSdk: string;
  buildCommandFingerprint: string;
  uplugin: UAgentCompanionArtifactHash;
  schema: UAgentCompanionArtifactHash;
  moduleIndex: UAgentCompanionArtifactHash;
  modules: UAgentCompanionArtifactHash[];
  toolNames: readonly UAgentCompanionToolName[];
  generatedAt: string;
  builder: {
    kind: "local" | "ci";
    name: string;
  };
  manifestSha256: string;
}

export type UAgentCompanionStatusCode =
  | "not_installed"
  | "installed_unverified"
  | "verified"
  | "incompatible"
  | "update_required";

export type UAgentCompanionBlockerCode =
  | "BLOCKED_BY_PLUGIN_PROVENANCE"
  | "BLOCKED_BY_PLUGIN_IDENTITY"
  | "BLOCKED_BY_MCP_SCHEMA"
  | "BLOCKED_BY_MCP_TRANSPORT"
  | "BLOCKED_BY_ENVIRONMENT"
  | "BLOCKED_BY_EXTERNAL_EVIDENCE"
  | "BLOCKED_BY_SCOPE";

export interface UAgentCompanionStatus {
  status: UAgentCompanionStatusCode;
  blocker: UAgentCompanionBlockerCode | null;
  reason: string;
  pluginVersion: string | null;
  contractVersion: string | null;
  manifestSha256Prefix: string | null;
  liveFingerprintSha256Prefix: string | null;
  currentGeneration: number;
  toolCount: number;
  perToolSummaryCount: number;
  identityAttested: boolean;
  liveFingerprintReady: boolean;
}

export interface UAgentCompanionToolContract {
  schemaVersion: typeof UAGENT_COMPANION_CONTRACT_VERSION;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  dryRunSchema: Record<string, unknown>;
  rollbackContract: Record<string, unknown>;
  affectedAssetsSchema: Record<string, unknown>;
  evidenceQuery: Record<string, unknown>;
}
