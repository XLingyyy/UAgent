import { describe, expect, it } from "vitest";
import {
  attestMvp15DCompanion,
  canonicalizeMvp15DJson,
  computeMvp15DManifestSha256,
  createMvp15DCompanionLiveFingerprint,
  createMvp15DCompanionToolDescriptors,
  createMvp15DToolContract,
  validateMvp15DIdentity,
  validateMvp15DCompanionInput,
  validateMvp15DManifest,
  type Mvp15DCompanionIdentityEvidence,
} from "./mvp15d-companion.js";
import * as Mvp15DCompanionModule from "./mvp15d-companion.js";
import {
  UAGENT_COMPANION_CONTRACT_VERSION,
  UAGENT_COMPANION_COMPATIBLE_CHANGELIST,
  UAGENT_COMPANION_ENGINE_CHANGELIST,
  UAGENT_COMPANION_ENGINE_VERSION,
  UAGENT_COMPANION_IDENTITY_SCHEMA_VERSION,
  UAGENT_COMPANION_MANIFEST_SCHEMA_VERSION,
  UAGENT_COMPANION_MODULE_BUILD_ID,
  UAGENT_COMPANION_PLUGIN_ID,
  UAGENT_COMPANION_PLUGIN_VERSION,
  UAGENT_COMPANION_TOOL_NAMES,
  type UAgentCompanionBuildManifest,
} from "@uagent/shared";

const identityBase = {
  schemaVersion: UAGENT_COMPANION_IDENTITY_SCHEMA_VERSION,
  pluginId: UAGENT_COMPANION_PLUGIN_ID,
  pluginVersion: UAGENT_COMPANION_PLUGIN_VERSION,
  contractVersion: UAGENT_COMPANION_CONTRACT_VERSION,
  sourceCommit: "a".repeat(40),
  engineVersion: UAGENT_COMPANION_ENGINE_VERSION,
  engineChangelist: UAGENT_COMPANION_ENGINE_CHANGELIST,
  compatibleChangelist: UAGENT_COMPANION_COMPATIBLE_CHANGELIST,
  moduleBuildId: UAGENT_COMPANION_MODULE_BUILD_ID,
  sourceTreeSha256: "b".repeat(64),
  buildCommandFingerprint: "c".repeat(64),
  loadedModuleName: "UAgentAssetTools-Win64-Development.dll",
  loadedModuleSha256: "f".repeat(64),
};

function createManifest(): UAgentCompanionBuildManifest {
  const base = {
    schemaVersion: UAGENT_COMPANION_MANIFEST_SCHEMA_VERSION,
    taskGeneration: "final-d13-d16" as const,
    taskId: "TASK-MVP15D-UAGENT-TEST",
    pluginId: UAGENT_COMPANION_PLUGIN_ID,
    pluginVersion: UAGENT_COMPANION_PLUGIN_VERSION,
    contractVersion: UAGENT_COMPANION_CONTRACT_VERSION,
    sourceCommit: "a".repeat(40),
    sourceTreeSha256: "b".repeat(64),
    physicalFixtures: [
      { path: "fixture-a.json", size: 1, sha256: "2".repeat(64), gitObjectSha256: "2".repeat(64) },
      { path: "fixture-b.json", size: 1, sha256: "3".repeat(64), gitObjectSha256: "3".repeat(64) },
    ],
    dirty: false as const,
    engineVersion: UAGENT_COMPANION_ENGINE_VERSION,
    engineChangelist: UAGENT_COMPANION_ENGINE_CHANGELIST,
    compatibleChangelist: UAGENT_COMPANION_COMPATIBLE_CHANGELIST,
    moduleBuildId: UAGENT_COMPANION_MODULE_BUILD_ID,
    targetPlatform: "Win64" as const,
    configuration: "Development" as const,
    compiler: { name: "MSVC" as const, version: "14.44.35207" },
    windowsSdk: { name: "Windows SDK" as const, version: "10.0.26100.0" },
    buildCommandFingerprint: "c".repeat(64),
    buildEvidenceArtifacts: [
      { path: "logs/stdout.log", size: 1, sha256: "4".repeat(64) },
      { path: "metadata/build-command.json", size: 1, sha256: "5".repeat(64) },
      { path: "metadata/build-result.json", size: 1, sha256: "6".repeat(64) },
    ],
    artifacts: [
      { path: "Binaries/Win64/UnrealEditor-UAgentAssetTools.dll", size: 3, sha256: "f".repeat(64) },
      { path: "Binaries/Win64/UnrealEditor.modules", size: 3, sha256: "1".repeat(64) },
      { path: "Resources/mvp15d-native-binding-v2.json", size: 4, sha256: "9".repeat(64) },
      { path: "Resources/uagent-asset-tools.schema.json", size: 2, sha256: "e".repeat(64) },
      { path: "UAgentAssetTools.uplugin", size: 1, sha256: "d".repeat(64) },
    ],
    modules: [{ path: "Binaries/Win64/UnrealEditor-UAgentAssetTools.dll", size: 3, sha256: "f".repeat(64) }],
    toolNames: UAGENT_COMPANION_TOOL_NAMES,
    generatedAt: "2026-07-20T00:00:00.000Z",
    builder: { kind: "local" as const, name: "test" },
  };
  return {
    ...base,
    manifestSelfSha256: computeMvp15DManifestSha256({
      ...base,
      manifestSelfSha256: "",
    }),
  };
}

function moduleEvidence(manifest: UAgentCompanionBuildManifest) {
  return manifest.modules.map((module) => ({
    name: module.path.split("/").at(-1)!,
    size: module.size,
    sha256: module.sha256,
  }));
}

function createIdentity(manifest: UAgentCompanionBuildManifest): Mvp15DCompanionIdentityEvidence {
  return {
    ...identityBase,
    buildManifestSha256: manifest.manifestSelfSha256,
    sourceTreeSha256: manifest.sourceTreeSha256,
    buildCommandFingerprint: manifest.buildCommandFingerprint,
    loadedModuleName: manifest.modules[0]!.path.split("/").at(-1)!,
    loadedModuleSha256: manifest.modules[0]!.sha256,
  };
}

describe("MVP15D companion contracts", () => {
  it("canonicalizes object keys while preserving array order", () => {
    expect(canonicalizeMvp15DJson({ b: 2, a: ["x", 1] })).toBe('{"a":["x",1],"b":2}');
  });

  it("attests an installed and loaded exact-six companion", () => {
    const manifest = createManifest();
    const identity = createIdentity(manifest);
    const descriptors = createMvp15DCompanionToolDescriptors(identity);
    const result = attestMvp15DCompanion({
      manifest,
      installedModules: moduleEvidence(manifest),
      loadedModules: moduleEvidence(manifest),
      directTools: descriptors,
      discoveryGeneration: 4,
    });
    expect(result.status.status).toBe("verified");
    expect(result.status.blocker).toBeNull();
    expect(result.status.toolCount).toBe(6);
    expect(result.status.perToolSummaryCount).toBe(6);
    expect(result.fingerprint.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("retracts readiness when the live identity is missing or stale", () => {
    const manifest = createManifest();
    const descriptors = createMvp15DCompanionToolDescriptors(createIdentity(manifest));
    const withoutIdentity = descriptors.map(({ annotations: _annotations, outputSchema, ...tool }) => {
      void _annotations;
      const { ["x-uagent-plugin"]: _identity, ...schemaWithoutIdentity } = outputSchema ?? {};
      void _identity;
      return { ...tool, outputSchema: schemaWithoutIdentity };
    });
    const missing = createMvp15DCompanionLiveFingerprint({ directTools: withoutIdentity, discoveryGeneration: 1 });
    expect(missing.status).toBe("blocked");
    expect(missing.reason).toBe("companion_identity_missing");

    const stale = descriptors.map((tool) => ({
      ...tool,
      "x-uagent-plugin": { ...createIdentity(manifest), buildManifestSha256: "1".repeat(64) },
    }));
    const mismatch = attestMvp15DCompanion({
      manifest,
      installedModules: moduleEvidence(manifest),
      loadedModules: moduleEvidence(manifest),
      directTools: stale,
      discoveryGeneration: 2,
    });
    expect(mismatch.status.status).toBe("incompatible");
    expect(mismatch.status.reason).toBe("companion_live_identity_mismatch");
  });

  it("enforces phase flags and exact sandbox paths", () => {
    const base = {
      changeSetId: "cs-1",
      runId: "run_1",
      operationId: "op-1",
      dryRun: false,
      execute: true,
      rollback: false,
      dryRunHash: "a".repeat(40),
    };
    expect(validateMvp15DCompanionInput("ue.asset.create_folder", "execute", {
      ...base,
      folderPath: "/Game/UAgentSandbox/run_1",
    }).ok).toBe(true);
    expect(validateMvp15DCompanionInput("ue.asset.create_folder", "execute", {
      ...base,
      folderPath: "/Game/UAgentSandbox",
    })).toMatchObject({ ok: false, reason: "run_root_required" });
    expect(validateMvp15DCompanionInput("ue.asset.save", "execute", {
      ...base,
      saveAll: true,
      assetPath: "/Game/UAgentSandbox/run_1/Asset",
    })).toMatchObject({ ok: false, reason: "save_all_forbidden" });
    expect(validateMvp15DCompanionInput("ue.asset.create_folder", "dry_run", {
      changeSetId: "cs-1",
      runId: "run_1",
      operationId: "op-1",
      dryRun: true,
      execute: false,
      rollback: false,
      folderPath: "/Game/UAgentSandbox/run_1",
    }).ok).toBe(true);
    expect(validateMvp15DCompanionInput("ue.asset.create_folder", "dry_run", {
      changeSetId: "cs-1",
      runId: "run_1",
      operationId: "op-1",
      dryRun: true,
      execute: false,
      rollback: false,
      dryRunHash: "a".repeat(40),
      folderPath: "/Game/UAgentSandbox/run_1",
    })).toMatchObject({ ok: false, reason: "dry_run_hash_forbidden" });
    expect(validateMvp15DCompanionInput("ue.asset.delete", "rollback", {
      ...base,
      execute: false,
      rollback: true,
      assetPath: "/Game/UAgentSandbox/run_1",
    }).ok).toBe(true);
  });

  it("does not expose a detached renderer ownership plan or ledger", () => {
    // Mutation ownership is asserted by the native registration + accepted-plan
    // boundary used by the ChangeSet service.  A second in-memory authority must
    // not remain exportable as production API.
    expect(Mvp15DCompanionModule).not.toHaveProperty("createMvp15DForwardPlan");
    expect(Mvp15DCompanionModule).not.toHaveProperty("createMvp15DOwnershipLedger");
  });

  it("rejects tampered, extra, and malformed manifest provenance fields", () => {
    const manifest = createManifest();
    expect(validateMvp15DManifest({ ...manifest, manifestSelfSha256: "0".repeat(64) }).valid).toBe(false);
    expect(validateMvp15DManifest({ ...manifest, unexpected: true })).toMatchObject({
      valid: false,
      reason: "manifest_field_extra",
    });
    expect(validateMvp15DManifest({
      ...manifest,
      artifacts: [{ ...manifest.artifacts[0], unexpected: true }, ...manifest.artifacts.slice(1)],
    })).toMatchObject({ valid: false, reason: "manifest_artifact_invalid" });
    const withoutNativeBinding = {
      ...manifest,
      artifacts: manifest.artifacts.filter(
        ({ path }) => path !== "Resources/mvp15d-native-binding-v2.json",
      ),
      manifestSelfSha256: "",
    };
    expect(validateMvp15DManifest({
      ...withoutNativeBinding,
      manifestSelfSha256: computeMvp15DManifestSha256(withoutNativeBinding),
    })).toMatchObject({ valid: false, reason: "manifest_artifact_invalid" });
  });

  it("rejects strict identity extras and binds descriptor module/source evidence to the manifest", () => {
    const manifest = createManifest();
    const identity = createIdentity(manifest);
    expect(validateMvp15DIdentity(identity)).toBe(true);
    expect(validateMvp15DIdentity({ ...identity, unexpected: true })).toBe(false);
    const descriptors = createMvp15DCompanionToolDescriptors({
      ...identity,
      loadedModuleSha256: "0".repeat(64),
    });
    expect(attestMvp15DCompanion({
      manifest,
      installedModules: moduleEvidence(manifest),
      loadedModules: moduleEvidence(manifest),
      directTools: descriptors,
      discoveryGeneration: 3,
    }).status).toMatchObject({ status: "incompatible", reason: "companion_live_identity_mismatch" });
  });

  it("fails closed without invoking untrusted accessors", () => {
    const throwingArray = new Proxy([], {
      getOwnPropertyDescriptor() {
        throw new Error("untrusted accessor");
      },
    });
    const throwingInput = new Proxy({}, {
      ownKeys() {
        throw new Error("untrusted accessor");
      },
    });
    expect(() => validateMvp15DCompanionInput("ue.asset.save", "execute", throwingInput)).not.toThrow();
    expect(validateMvp15DCompanionInput("ue.asset.save", "execute", throwingInput)).toMatchObject({
      ok: false,
      reason: "input_not_object",
    });
    expect(() => createMvp15DCompanionLiveFingerprint({
      directTools: throwingArray as unknown as [],
      discoveryGeneration: 1,
    })).not.toThrow();
    expect(createMvp15DCompanionLiveFingerprint({
      directTools: throwingArray as unknown as [],
      discoveryGeneration: 1,
    })).toMatchObject({ status: "blocked", reason: "companion_input_invalid" });
  });

  it("declares phase-aware input and nested result schemas", () => {
    const contract = createMvp15DToolContract("ue.asset.delete");
    const inputSchema = contract.inputSchema as {
      required: string[];
      properties: Record<string, { pattern?: string }>;
      allOf: Array<{ oneOf?: unknown[] }>;
    };
    expect(inputSchema.required).not.toContain("dryRunHash");
    expect(inputSchema.allOf[0]?.oneOf).toHaveLength(3);
    expect(inputSchema.properties.assetPath?.pattern).toContain("(?:/[A-Za-z0-9_-]+)*");
    const outputSchema = contract.outputSchema as {
      properties: {
        affectedAssets: { properties: Record<string, unknown>; required: string[] };
        rollbackPlan: { properties: Record<string, unknown>; required: string[] };
        externalEvidenceQueries: { items: { properties: Record<string, unknown>; required: string[] } };
      };
    };
    expect(outputSchema.properties.affectedAssets.required).toEqual(["readOnlySources", "sandboxTargets", "externalTargets"]);
    expect(outputSchema.properties.affectedAssets.properties.sandboxTargets).toBeDefined();
    expect(outputSchema.properties.rollbackPlan.required).toEqual(["strategy", "inverseOperation", "executionEnabled"]);
    expect(outputSchema.properties.rollbackPlan.properties.summary).toBeUndefined();
    expect(outputSchema.properties.externalEvidenceQueries.items.required).toEqual(["queryKind", "readOnly", "paths"]);
  });
});
