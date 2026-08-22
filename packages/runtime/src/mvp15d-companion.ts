import type {
  UAgentCompanionArtifactHash,
  UAgentCompanionBuildManifest,
  UAgentCompanionIdentity,
  UAgentCompanionManifestArtifact,
  UAgentCompanionStatus,
  UAgentCompanionToolContract,
  UAgentCompanionToolName,
} from "@uagent/shared";
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
} from "@uagent/shared";
import {
  createMvp15LiveAssetToolsetFingerprint,
  type Mvp15LiveAssetToolsetFingerprintResult,
} from "./mvp15-live-asset-toolset-fingerprint.js";
import type {
  Mvp15McpAssetToolDescriptor,
  Mvp15McpAssetToolDescriptorLike,
} from "./mvp15-mcp-asset-adapter.js";
import { createSha256Hash } from "./mvp12-change-set.js";

export const MVP15D_COMPANION_FINGERPRINT_SCHEMA_VERSION =
  "uagent.mvp15d.companion-live-fingerprint.v1" as const;

export type Mvp15DCompanionFingerprintSource = "direct" | "facade";
export type Mvp15DCompanionPhase = "dry_run" | "execute" | "rollback";

export interface Mvp15DCompanionIdentityEvidence extends UAgentCompanionIdentity {
  sourceTreeSha256: string;
  buildCommandFingerprint: string;
  loadedModuleName: string;
  loadedModuleSha256: string;
}

export interface Mvp15DCompanionDescriptorLike extends Mvp15McpAssetToolDescriptorLike {
  "x-uagent-plugin"?: unknown;
  description?: unknown;
}

export interface Mvp15DCompanionFingerprint {
  status: "ready" | "blocked";
  schemaVersion: typeof MVP15D_COMPANION_FINGERPRINT_SCHEMA_VERSION;
  reason: string | null;
  sha256: string | null;
  canonicalByteLength: number | null;
  toolCount: number;
  perToolSummaryCount: number;
  source: Mvp15DCompanionFingerprintSource | null;
  identity: Mvp15DCompanionIdentityEvidence | null;
  discoveryGeneration: number;
  tools: Mvp15LiveAssetToolsetFingerprintResult["tools"];
}

export interface Mvp15DCompanionAttestationInput {
  manifest: unknown | null;
  installedModules: readonly unknown[];
  loadedModules: readonly unknown[];
  directTools: readonly Mvp15DCompanionDescriptorLike[];
  facadeTools?: readonly Mvp15DCompanionDescriptorLike[];
  discoveryGeneration: number;
}

export interface Mvp15DManifestValidation {
  valid: boolean;
  reason: string | null;
  canonicalSha256: string | null;
  manifest: UAgentCompanionBuildManifest | null;
}

export interface Mvp15DInputValidationSuccess {
  ok: true;
  toolName: UAgentCompanionToolName;
  phase: Mvp15DCompanionPhase;
  args: Record<string, unknown>;
}

export interface Mvp15DInputValidationFailure {
  ok: false;
  reason: string;
}

export type Mvp15DInputValidation = Mvp15DInputValidationSuccess | Mvp15DInputValidationFailure;

const HEX40 = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_RUN_ID = /^[A-Za-z0-9_-]+$/;
const SAFE_CHANGE_SET_ID = /^[A-Za-z0-9._:-]+$/;
const SAFE_ARTIFACT_NAME = /^[A-Za-z0-9_.-]+$/;
const SAFE_METADATA = /^[A-Za-z0-9 .()_-]+$/;
const MANIFEST_FIELDS = [
  "schemaVersion", "taskGeneration", "taskId", "pluginId", "pluginVersion", "contractVersion", "sourceCommit", "sourceTreeSha256",
  "physicalFixtures", "dirty", "engineVersion", "engineChangelist", "compatibleChangelist", "moduleBuildId",
  "targetPlatform", "configuration", "compiler", "windowsSdk", "buildCommandFingerprint",
  "buildEvidenceArtifacts", "artifacts", "modules", "toolNames", "generatedAt", "builder", "manifestSelfSha256",
] as const;
const IDENTITY_FIELDS = [
  "schemaVersion", "pluginId", "pluginVersion", "contractVersion", "sourceCommit", "buildManifestSha256",
  "engineVersion", "engineChangelist", "compatibleChangelist", "moduleBuildId",
  "sourceTreeSha256", "buildCommandFingerprint", "loadedModuleName", "loadedModuleSha256",
] as const;
const ARTIFACT_FIELDS = ["name", "size", "sha256"] as const;
const MANIFEST_ARTIFACT_FIELDS = ["path", "size", "sha256"] as const;
const PHYSICAL_FIXTURE_FIELDS = ["path", "size", "sha256", "gitObjectSha256"] as const;
const BUILDER_FIELDS = ["kind", "name"] as const;
const INPUT_COMMON_FIELDS = ["changeSetId", "runId", "operationId", "dryRun", "execute", "rollback"] as const;
const SANDBOX_RUN_ROOT_PATTERN = "^/Game/UAgentSandbox/[A-Za-z0-9_-]+$";
const SANDBOX_DESCENDANT_PATTERN = "^/Game/UAgentSandbox/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)+$";
const SANDBOX_RUN_ROOT_OR_DESCENDANT_PATTERN = "^/Game/UAgentSandbox/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*$";

export function canonicalizeMvp15DJson(value: unknown): string {
  return canonicalize(value, new Set<object>());
}

function canonicalize(value: unknown, seen: Set<object>): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non_json_number");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw new Error("non_json_value");
  if (seen.has(value)) throw new Error("cyclic_json");
  seen.add(value);
  try {
    const array = toPlainArray(value);
    if (array) return `[${array.map((item) => canonicalize(item, seen)).join(",")}]`;
    const record = toPlainRecord(value);
    if (!record) throw new Error("non_json_object");
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalize(record[key], seen)}`).join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

export function computeMvp15DManifestSha256(manifest: Omit<UAgentCompanionBuildManifest, "manifestSelfSha256"> | UAgentCompanionBuildManifest): string {
  const record = toPlainRecord(manifest);
  if (!record) throw new Error("manifest_not_plain_object");
  const withoutSelfHash: Record<string, unknown> = { ...record };
  delete withoutSelfHash.manifestSelfSha256;
  return createSha256Hash(canonicalizeMvp15DJson(withoutSelfHash));
}

export function validateMvp15DIdentity(value: unknown): value is Mvp15DCompanionIdentityEvidence {
  return parseMvp15DIdentity(value) !== null;
}

export function extractMvp15DIdentity(value: unknown): Mvp15DCompanionIdentityEvidence | null {
  const descriptor = toPlainRecord(value);
  if (!descriptor) return null;
  const annotations = toPlainRecord(descriptor.annotations);
  const outputSchema = toPlainRecord(descriptor.outputSchema);
  const contract = toPlainRecord(descriptor["x-uagent-contract"]);
  const candidates: unknown[] = [
    descriptor["x-uagent-plugin"],
    annotations?.["x-uagent-plugin"],
    outputSchema?.["x-uagent-plugin"],
    contract?.["x-uagent-plugin"],
  ];
  for (const candidate of candidates) {
    const identity = parseMvp15DIdentity(candidate);
    if (identity) return identity;
  }
  return null;
}

export function validateMvp15DManifest(value: unknown): Mvp15DManifestValidation {
  const record = toPlainRecord(value);
  if (!record) return invalidManifest("manifest_missing");
  if (!hasAllFields(record, MANIFEST_FIELDS)) return invalidManifest("manifest_field_missing");
  if (!hasOnlyFields(record, MANIFEST_FIELDS)) return invalidManifest("manifest_field_extra");
  if (record.schemaVersion !== UAGENT_COMPANION_MANIFEST_SCHEMA_VERSION
    || record.pluginId !== UAGENT_COMPANION_PLUGIN_ID
    || record.pluginVersion !== UAGENT_COMPANION_PLUGIN_VERSION
    || record.contractVersion !== UAGENT_COMPANION_CONTRACT_VERSION
    || record.taskGeneration !== "final-d13-d16"
    || typeof record.taskId !== "string"
    || !/^TASK-MVP15D-[A-Z0-9-]+$/.test(record.taskId)
    || record.dirty !== false
    || record.engineVersion !== UAGENT_COMPANION_ENGINE_VERSION
    || record.engineChangelist !== UAGENT_COMPANION_ENGINE_CHANGELIST
    || record.compatibleChangelist !== UAGENT_COMPANION_COMPATIBLE_CHANGELIST
    || record.moduleBuildId !== UAGENT_COMPANION_MODULE_BUILD_ID
    || record.targetPlatform !== "Win64"
    || record.configuration !== "Development") {
    return invalidManifest("manifest_identity_mismatch");
  }
  if (typeof record.sourceCommit !== "string" || !HEX40.test(record.sourceCommit)
    || typeof record.sourceTreeSha256 !== "string" || !HEX64.test(record.sourceTreeSha256)
    || typeof record.buildCommandFingerprint !== "string" || !HEX64.test(record.buildCommandFingerprint)
    || typeof record.generatedAt !== "string" || !isCanonicalTimestamp(record.generatedAt)) {
    return invalidManifest("manifest_hash_or_toolchain_invalid");
  }
  const compiler = parseToolchain(record.compiler, "MSVC");
  const windowsSdk = parseToolchain(record.windowsSdk, "Windows SDK");
  const physicalFixtures = toPlainArray(record.physicalFixtures)?.map(parsePhysicalFixture) ?? null;
  const buildEvidenceArtifacts =
    toPlainArray(record.buildEvidenceArtifacts)?.map(parseManifestArtifact) ?? null;
  const artifacts = toPlainArray(record.artifacts)?.map(parseManifestArtifact) ?? null;
  const modules = toPlainArray(record.modules)?.map(parseManifestArtifact) ?? null;
  const toolNames = toPlainArray(record.toolNames);
  const builder = toPlainRecord(record.builder);
  if (!compiler || !windowsSdk
    || !physicalFixtures || physicalFixtures.length !== 2 || physicalFixtures.some((item) => item === null)
    || !buildEvidenceArtifacts || buildEvidenceArtifacts.length < 3 || buildEvidenceArtifacts.some((item) => item === null)
    || !artifacts || artifacts.length < 5 || artifacts.some((item) => item === null)
    || !modules || modules.length === 0 || modules.some((module) => module === null)
    || !hasCanonicalManifestPaths(artifacts as UAgentCompanionManifestArtifact[])
    || !hasCanonicalManifestPaths(modules as UAgentCompanionManifestArtifact[])
    || !(artifacts as UAgentCompanionManifestArtifact[]).some(({ path }) => path === "UAgentAssetTools.uplugin")
    || !(artifacts as UAgentCompanionManifestArtifact[]).some(({ path }) => path === "Resources/uagent-asset-tools.schema.json")
    || !(artifacts as UAgentCompanionManifestArtifact[]).some(({ path }) => path === "Resources/mvp15d-native-binding-v2.json")
    || !(artifacts as UAgentCompanionManifestArtifact[]).some(({ path }) => path === "Binaries/Win64/UnrealEditor.modules")
    || !(modules as UAgentCompanionManifestArtifact[]).every(({ path }) => /^Binaries\/Win64\/UnrealEditor-[A-Za-z0-9_.-]+\.dll$/.test(path))
    || !isExactToolNames(toolNames)
    || !builder || !hasAllFields(builder, BUILDER_FIELDS) || !hasOnlyFields(builder, BUILDER_FIELDS)
    || !["local", "ci"].includes(builder.kind as string)
    || typeof builder.name !== "string"
    || !SAFE_METADATA.test(builder.name)
    || typeof record.manifestSelfSha256 !== "string" || !HEX64.test(record.manifestSelfSha256)) {
    return invalidManifest("manifest_artifact_invalid");
  }
  const manifest: UAgentCompanionBuildManifest = {
    schemaVersion: UAGENT_COMPANION_MANIFEST_SCHEMA_VERSION,
    taskGeneration: "final-d13-d16",
    taskId: record.taskId,
    pluginId: UAGENT_COMPANION_PLUGIN_ID,
    pluginVersion: UAGENT_COMPANION_PLUGIN_VERSION,
    contractVersion: UAGENT_COMPANION_CONTRACT_VERSION,
    sourceCommit: record.sourceCommit,
    sourceTreeSha256: record.sourceTreeSha256,
    physicalFixtures: physicalFixtures as UAgentCompanionBuildManifest["physicalFixtures"],
    dirty: false,
    engineVersion: UAGENT_COMPANION_ENGINE_VERSION,
    engineChangelist: UAGENT_COMPANION_ENGINE_CHANGELIST,
    compatibleChangelist: UAGENT_COMPANION_COMPATIBLE_CHANGELIST,
    moduleBuildId: UAGENT_COMPANION_MODULE_BUILD_ID,
    targetPlatform: "Win64",
    configuration: "Development",
    compiler,
    windowsSdk,
    buildCommandFingerprint: record.buildCommandFingerprint,
    buildEvidenceArtifacts: buildEvidenceArtifacts as UAgentCompanionManifestArtifact[],
    artifacts: artifacts as UAgentCompanionManifestArtifact[],
    modules: modules as UAgentCompanionManifestArtifact[],
    toolNames: toolNames as UAgentCompanionToolName[],
    generatedAt: record.generatedAt,
    builder: { kind: builder.kind as "local" | "ci", name: builder.name },
    manifestSelfSha256: record.manifestSelfSha256,
  };
  let canonicalSha256: string;
  try {
    canonicalSha256 = computeMvp15DManifestSha256(manifest);
  } catch {
    return invalidManifest("manifest_canonicalization_invalid");
  }
  if (canonicalSha256 !== manifest.manifestSelfSha256) return invalidManifest("manifest_self_hash_mismatch", canonicalSha256);
  return { valid: true, reason: null, canonicalSha256, manifest };
}

function invalidManifest(reason: string, canonicalSha256: string | null = null): Mvp15DManifestValidation {
  return { valid: false, reason, canonicalSha256, manifest: null };
}

export function createMvp15DCompanionStatus(overrides: Partial<UAgentCompanionStatus> = {}): UAgentCompanionStatus {
  return {
    status: "not_installed",
    blocker: null,
    reason: "companion_not_attested",
    pluginVersion: null,
    contractVersion: null,
    manifestSha256Prefix: null,
    liveFingerprintSha256Prefix: null,
    currentGeneration: 0,
    toolCount: 0,
    perToolSummaryCount: 0,
    identityAttested: false,
    liveFingerprintReady: false,
    ...overrides,
  };
}

export function createMvp15DCompanionLiveFingerprint(input: {
  directTools: readonly Mvp15DCompanionDescriptorLike[];
  facadeTools?: readonly Mvp15DCompanionDescriptorLike[];
  discoveryGeneration: number;
}): Mvp15DCompanionFingerprint {
  const normalized = normalizeLiveFingerprintInput(input);
  const emptyBase = () => createMvp15LiveAssetToolsetFingerprint({ directTools: [] });
  if (!normalized.valid) {
    return blockedCompanionFingerprint(normalized.discoveryGeneration, emptyBase(), "companion_input_invalid");
  }
  try {
    const directIdentity = identityForToolSet(companionToolDescriptors(normalized.directTools));
    const facadeIdentity = identityForToolSet(companionToolDescriptors(normalized.facadeTools));
    const source: Mvp15DCompanionFingerprintSource | null = directIdentity ? "direct" : facadeIdentity ? "facade" : null;
    const selectedTools = source === "direct"
      ? normalized.directTools
      : source === "facade"
        ? normalized.facadeTools
        : normalized.directTools;
    const base = createMvp15LiveAssetToolsetFingerprint(
      source === "facade"
        ? { directTools: [], facadeTools: selectedTools }
        : { directTools: selectedTools },
    );
    const identity = source === "direct" ? directIdentity : facadeIdentity;
    if (!identity) return blockedCompanionFingerprint(normalized.discoveryGeneration, base, "companion_identity_missing");
    if (identity === "mismatch") {
      return blockedCompanionFingerprint(normalized.discoveryGeneration, base, "companion_identity_mismatch");
    }
    if (base.status !== "ready" || !base.sha256 || !base.canonicalByteLength) {
      return blockedCompanionFingerprint(normalized.discoveryGeneration, base, "companion_contract_incomplete");
    }
    const canonical = canonicalizeMvp15DJson({
      schemaVersion: MVP15D_COMPANION_FINGERPRINT_SCHEMA_VERSION,
      source,
      identity,
      toolset: base,
    });
    return {
      status: "ready",
      schemaVersion: MVP15D_COMPANION_FINGERPRINT_SCHEMA_VERSION,
      reason: null,
      sha256: createSha256Hash(canonical),
      canonicalByteLength: new TextEncoder().encode(canonical).length,
      toolCount: base.toolCount,
      perToolSummaryCount: base.tools.length,
      source,
      identity,
      discoveryGeneration: normalized.discoveryGeneration,
      tools: base.tools,
    };
  } catch {
    return blockedCompanionFingerprint(normalized.discoveryGeneration, emptyBase(), "companion_fingerprint_invalid");
  }
}

function blockedCompanionFingerprint(
  generation: number,
  base: Mvp15LiveAssetToolsetFingerprintResult,
  reason: string,
): Mvp15DCompanionFingerprint {
  return {
    status: "blocked",
    schemaVersion: MVP15D_COMPANION_FINGERPRINT_SCHEMA_VERSION,
    reason,
    sha256: null,
    canonicalByteLength: null,
    toolCount: base.toolCount,
    perToolSummaryCount: base.tools.length,
    source: null,
    identity: null,
    discoveryGeneration: generation,
    tools: base.tools,
  };
}

function identityForToolSet(tools: readonly Mvp15DCompanionDescriptorLike[]): Mvp15DCompanionIdentityEvidence | "mismatch" | null {
  if (tools.length === 0) return null;
  const identities = tools.map(extractMvp15DIdentity);
  if (identities.some((identity) => identity === null)) return null;
  const first = identities[0]!;
  return identities.every((identity) => identityEqual(first, identity!)) ? first : "mismatch";
}

function companionToolDescriptors(
  tools: readonly Mvp15DCompanionDescriptorLike[],
): Mvp15DCompanionDescriptorLike[] {
  return tools.filter((tool) => {
    const descriptor = toPlainRecord(tool);
    return descriptor !== null && isCompanionToolName(descriptor.name);
  });
}

function identityEqual(left: Mvp15DCompanionIdentityEvidence, right: Mvp15DCompanionIdentityEvidence): boolean {
  try {
    return canonicalizeMvp15DJson(left) === canonicalizeMvp15DJson(right);
  } catch {
    return false;
  }
}

export function attestMvp15DCompanion(input: Mvp15DCompanionAttestationInput): {
  status: UAgentCompanionStatus;
  fingerprint: Mvp15DCompanionFingerprint;
} {
  const normalized = normalizeCompanionAttestationInput(input);
  const manifestValidation = validateMvp15DManifest(normalized.manifest);
  const fingerprint = createMvp15DCompanionLiveFingerprint({
    directTools: normalized.directTools,
    facadeTools: normalized.facadeTools,
    discoveryGeneration: normalized.discoveryGeneration,
  });
  if (normalized.manifest === null) {
    return {
      fingerprint,
      status: createMvp15DCompanionStatus({
        reason: "companion_manifest_not_available",
        blocker: "BLOCKED_BY_PLUGIN_PROVENANCE",
        currentGeneration: normalized.discoveryGeneration,
        toolCount: fingerprint.toolCount,
        perToolSummaryCount: fingerprint.perToolSummaryCount,
        liveFingerprintSha256Prefix: prefix(fingerprint.sha256),
      }),
    };
  }
  if (!manifestValidation.valid || !manifestValidation.manifest) {
    return {
      fingerprint,
      status: createMvp15DCompanionStatus({
        status: "installed_unverified",
        reason: manifestValidation.reason ?? "companion_manifest_invalid",
        blocker: "BLOCKED_BY_PLUGIN_PROVENANCE",
        currentGeneration: normalized.discoveryGeneration,
        toolCount: fingerprint.toolCount,
        perToolSummaryCount: fingerprint.perToolSummaryCount,
      }),
    };
  }
  const manifest = manifestValidation.manifest;
  if (!normalized.valid) {
    return {
      fingerprint,
      status: createMvp15DCompanionStatus({
        status: "installed_unverified",
        reason: "companion_attestation_input_invalid",
        blocker: "BLOCKED_BY_MCP_SCHEMA",
        pluginVersion: manifest.pluginVersion,
        contractVersion: manifest.contractVersion,
        manifestSha256Prefix: prefix(manifest.manifestSelfSha256),
        currentGeneration: normalized.discoveryGeneration,
        toolCount: fingerprint.toolCount,
        perToolSummaryCount: fingerprint.perToolSummaryCount,
      }),
    };
  }
  const installed = compareModuleSet(manifest.modules, normalized.installedModules);
  const loaded = compareModuleSet(manifest.modules, normalized.loadedModules);
  if (!installed || !loaded) {
    return {
      fingerprint,
      status: createMvp15DCompanionStatus({
        status: "incompatible",
        reason: "companion_module_hash_mismatch",
        blocker: "BLOCKED_BY_PLUGIN_PROVENANCE",
        pluginVersion: manifest.pluginVersion,
        contractVersion: manifest.contractVersion,
        manifestSha256Prefix: prefix(manifest.manifestSelfSha256),
        currentGeneration: normalized.discoveryGeneration,
        toolCount: fingerprint.toolCount,
        perToolSummaryCount: fingerprint.perToolSummaryCount,
        liveFingerprintSha256Prefix: prefix(fingerprint.sha256),
      }),
    };
  }
  if (fingerprint.reason === "companion_identity_missing") {
    return {
      fingerprint,
      status: createMvp15DCompanionStatus({
        status: "incompatible",
        reason: "companion_live_identity_missing",
        blocker: "BLOCKED_BY_PLUGIN_IDENTITY",
        pluginVersion: manifest.pluginVersion,
        contractVersion: manifest.contractVersion,
        manifestSha256Prefix: prefix(manifest.manifestSelfSha256),
        currentGeneration: normalized.discoveryGeneration,
        toolCount: fingerprint.toolCount,
        perToolSummaryCount: fingerprint.perToolSummaryCount,
      }),
    };
  }
  if (fingerprint.reason === "companion_identity_mismatch" || (fingerprint.identity && !identityMatchesManifest(fingerprint.identity, manifest))) {
    return {
      fingerprint,
      status: createMvp15DCompanionStatus({
        status: "incompatible",
        reason: "companion_live_identity_mismatch",
        blocker: "BLOCKED_BY_PLUGIN_IDENTITY",
        pluginVersion: manifest.pluginVersion,
        contractVersion: manifest.contractVersion,
        manifestSha256Prefix: prefix(manifest.manifestSelfSha256),
        currentGeneration: normalized.discoveryGeneration,
        toolCount: fingerprint.toolCount,
        perToolSummaryCount: fingerprint.perToolSummaryCount,
        liveFingerprintSha256Prefix: prefix(fingerprint.sha256),
      }),
    };
  }
  if (fingerprint.status !== "ready") {
    return {
      fingerprint,
      status: createMvp15DCompanionStatus({
        status: "installed_unverified",
        reason: fingerprint.reason ?? "companion_fingerprint_blocked",
        blocker: "BLOCKED_BY_MCP_SCHEMA",
        pluginVersion: manifest.pluginVersion,
        contractVersion: manifest.contractVersion,
        manifestSha256Prefix: prefix(manifest.manifestSelfSha256),
        currentGeneration: normalized.discoveryGeneration,
        toolCount: fingerprint.toolCount,
        perToolSummaryCount: fingerprint.perToolSummaryCount,
      }),
    };
  }
  return {
    fingerprint,
    status: createMvp15DCompanionStatus({
      status: "verified",
      reason: "companion_verified_current_generation",
      blocker: null,
      pluginVersion: manifest.pluginVersion,
      contractVersion: manifest.contractVersion,
      manifestSha256Prefix: prefix(manifest.manifestSelfSha256),
      liveFingerprintSha256Prefix: prefix(fingerprint.sha256),
      currentGeneration: normalized.discoveryGeneration,
      toolCount: fingerprint.toolCount,
      perToolSummaryCount: fingerprint.perToolSummaryCount,
      identityAttested: true,
      liveFingerprintReady: true,
    }),
  };
}

function identityMatchesManifest(identity: Mvp15DCompanionIdentityEvidence, manifest: UAgentCompanionBuildManifest): boolean {
  return identity.pluginId === manifest.pluginId
    && identity.pluginVersion === manifest.pluginVersion
    && identity.contractVersion === manifest.contractVersion
    && identity.sourceCommit === manifest.sourceCommit
    && identity.buildManifestSha256 === manifest.manifestSelfSha256
    && identity.engineVersion === manifest.engineVersion
    && identity.engineChangelist === manifest.engineChangelist
    && identity.compatibleChangelist === manifest.compatibleChangelist
    && identity.moduleBuildId === manifest.moduleBuildId
    && identity.sourceTreeSha256 === manifest.sourceTreeSha256
    && identity.buildCommandFingerprint === manifest.buildCommandFingerprint
    && manifest.modules.some((module) => module.path.endsWith(`/${identity.loadedModuleName}`) && module.sha256 === identity.loadedModuleSha256);
}

function compareModuleSet(expected: readonly UAgentCompanionManifestArtifact[], actual: readonly unknown[]): boolean {
  const observedValues = toPlainArray(actual);
  if (!observedValues || expected.length !== observedValues.length) return false;
  const actualByName = new Map<string, UAgentCompanionArtifactHash>();
  for (const value of observedValues) {
    const artifact = parseArtifact(value);
    if (!artifact || actualByName.has(artifact.name)) return false;
    actualByName.set(artifact.name, artifact);
  }
  return expected.every((module) => {
    const observed = actualByName.get(module.path.split("/").at(-1) ?? "");
    return observed?.size === module.size && observed.sha256 === module.sha256;
  });
}

function prefix(value: string | null): string | null {
  return value && HEX64.test(value) ? value.slice(0, 12) : null;
}

export function validateMvp15DCompanionInput(
  toolName: UAgentCompanionToolName,
  phase: Mvp15DCompanionPhase,
  rawArgs: unknown,
): Mvp15DInputValidation {
  if (!isCompanionToolName(toolName)) return { ok: false, reason: "tool_name_invalid" };
  if (!isCompanionPhase(phase)) return { ok: false, reason: "phase_invalid" };
  const args = toPlainRecord(rawArgs);
  if (!args) return { ok: false, reason: "input_not_object" };
  const expected = new Set<string>(INPUT_COMMON_FIELDS);
  const required = new Set<string>(INPUT_COMMON_FIELDS);
  if (phase !== "dry_run") {
    expected.add("dryRunHash");
    required.add("dryRunHash");
  } else if (hasOwnField(args, "dryRunHash")) {
    return { ok: false, reason: "dry_run_hash_forbidden" };
  }
  if (toolName === "ue.asset.create_folder") {
    expected.add("folderPath");
    required.add("folderPath");
  }
  if (toolName === "ue.asset.duplicate") {
    expected.add("sourceAssetPath");
    expected.add("targetAssetPath");
    required.add("sourceAssetPath");
    required.add("targetAssetPath");
  }
  if (toolName === "ue.asset.rename" || toolName === "ue.asset.move") {
    expected.add("assetPath");
    expected.add("targetAssetPath");
    required.add("assetPath");
    required.add("targetAssetPath");
  }
  if (toolName === "ue.asset.delete" || toolName === "ue.asset.save") {
    expected.add("assetPath");
    required.add("assetPath");
  }
  if (toolName === "ue.asset.save") {
    expected.add("saveAll");
    required.add("saveAll");
  }
  if (Object.keys(args).some((key) => !expected.has(key))) return { ok: false, reason: "unknown_input_field" };
  if ([...required].some((field) => !hasOwnField(args, field))) return { ok: false, reason: "input_field_missing" };
  if (!isSafeChangeSetId(args.changeSetId) || !isSafeRunId(args.runId) || !isSafeRunId(args.operationId)) return { ok: false, reason: "unsafe_identity" };
  if (![args.dryRun, args.execute, args.rollback].every((value) => typeof value === "boolean")) {
    return { ok: false, reason: "phase_flags_must_be_boolean" };
  }
  const activeFlags = [args.dryRun, args.execute, args.rollback].filter(Boolean).length;
  if (activeFlags !== 1 || (phase === "dry_run" && args.dryRun !== true)
    || (phase === "execute" && args.execute !== true)
    || (phase === "rollback" && args.rollback !== true)) {
    return { ok: false, reason: "phase_flags_conflict" };
  }
  if (phase !== "dry_run" && (typeof args.dryRunHash !== "string" || !HEX40.test(args.dryRunHash))) {
    return { ok: false, reason: "accepted_dry_run_hash_required" };
  }
  if (toolName === "ue.asset.delete" && phase === "execute") return { ok: false, reason: "forward_delete_forbidden" };
  if (toolName === "ue.asset.save" && args.saveAll !== false) return { ok: false, reason: "save_all_forbidden" };
  const runRoot = `/Game/UAgentSandbox/${args.runId}`;
  const paths = pathArguments(toolName, args);
  if (!paths) return { ok: false, reason: "asset_path_type_invalid" };
  if (paths.some((path) => !isCanonicalGamePath(path))) return { ok: false, reason: "non_canonical_asset_path" };
  if (toolName === "ue.asset.create_folder") {
    if (args.folderPath !== runRoot) return { ok: false, reason: "run_root_required" };
  } else if (toolName === "ue.asset.duplicate") {
    if (args.sourceAssetPath !== "/Game/Test01"
      || typeof args.targetAssetPath !== "string"
      || !isStrictDescendant(args.targetAssetPath, runRoot)) {
      return { ok: false, reason: "duplicate_source_or_target_blocked" };
    }
  } else if (!(toolName === "ue.asset.delete" && phase === "rollback" && args.assetPath === runRoot)
    && paths.some((path) => !isStrictDescendant(path, runRoot))) {
    return { ok: false, reason: "sandbox_descendant_required" };
  }
  if (toolName === "ue.asset.delete" && phase === "rollback"
    && (typeof args.assetPath !== "string" || (args.assetPath !== runRoot && !isStrictDescendant(args.assetPath, runRoot)))) {
    return { ok: false, reason: "rollback_target_blocked" };
  }
  return { ok: true, toolName, phase, args: { ...args } };
}

function pathArguments(toolName: UAgentCompanionToolName, args: Record<string, unknown>): string[] | null {
  if (toolName === "ue.asset.create_folder") return typeof args.folderPath === "string" ? [args.folderPath] : null;
  if (toolName === "ue.asset.duplicate") {
    return typeof args.sourceAssetPath === "string" && typeof args.targetAssetPath === "string"
      ? [args.sourceAssetPath, args.targetAssetPath]
      : null;
  }
  if (toolName === "ue.asset.rename" || toolName === "ue.asset.move") {
    return typeof args.assetPath === "string" && typeof args.targetAssetPath === "string"
      ? [args.assetPath, args.targetAssetPath]
      : null;
  }
  return typeof args.assetPath === "string" ? [args.assetPath] : null;
}

export function createMvp15DCompanionToolDescriptors(identity: Mvp15DCompanionIdentityEvidence): Mvp15McpAssetToolDescriptor[] {
  return UAGENT_COMPANION_TOOL_NAMES.map((name) => {
    const contract = createMvp15DToolContract(name);
    return {
      name,
      schemaVersion: UAGENT_COMPANION_CONTRACT_VERSION,
      inputSchema: contract.inputSchema,
      outputSchema: {
        ...contract.outputSchema,
        ["x-uagent-plugin"]: identity,
      },
      dryRunSchema: contract.dryRunSchema,
      rollbackContract: contract.rollbackContract,
      affectedAssetsSchema: contract.affectedAssetsSchema,
      evidenceQuery: contract.evidenceQuery,
      annotations: {
        "x-uagent-plugin": identity,
        schemaVersion: UAGENT_COMPANION_CONTRACT_VERSION,
      },
    };
  });
}

export function createMvp15DToolContract(toolName: UAgentCompanionToolName): UAgentCompanionToolContract {
  const specificProperties: Record<string, unknown> = {};
  const required: string[] = [...INPUT_COMMON_FIELDS];
  const hashSchema = { type: "string", pattern: "^[0-9a-f]{40}$" };
  const phaseVariants: Record<string, unknown>[] = [
    {
      properties: { dryRun: { const: true }, execute: { const: false }, rollback: { const: false } },
      required: [...INPUT_COMMON_FIELDS],
      not: { required: ["dryRunHash"] },
    },
    {
      properties: { dryRun: { const: false }, execute: { const: true }, rollback: { const: false } },
      required: [...INPUT_COMMON_FIELDS, "dryRunHash"],
    },
    {
      properties: { dryRun: { const: false }, execute: { const: false }, rollback: { const: true } },
      required: [...INPUT_COMMON_FIELDS, "dryRunHash"],
    },
  ];
  const additionalInputRules: Record<string, unknown>[] = [];
  if (toolName === "ue.asset.create_folder") {
    specificProperties.folderPath = { type: "string", pattern: SANDBOX_RUN_ROOT_PATTERN };
    required.push("folderPath");
  } else if (toolName === "ue.asset.duplicate") {
    specificProperties.sourceAssetPath = { const: "/Game/Test01" };
    specificProperties.targetAssetPath = { type: "string", pattern: SANDBOX_DESCENDANT_PATTERN };
    required.push("sourceAssetPath", "targetAssetPath");
  } else {
    specificProperties.assetPath = {
      type: "string",
      pattern: toolName === "ue.asset.delete"
        ? SANDBOX_RUN_ROOT_OR_DESCENDANT_PATTERN
        : SANDBOX_DESCENDANT_PATTERN,
    };
    required.push("assetPath");
    if (toolName === "ue.asset.rename" || toolName === "ue.asset.move") {
      specificProperties.targetAssetPath = { type: "string", pattern: SANDBOX_DESCENDANT_PATTERN };
      required.push("targetAssetPath");
    }
    if (toolName === "ue.asset.save") {
      specificProperties.saveAll = { const: false };
      required.push("saveAll");
    }
  }
  if (toolName === "ue.asset.delete") {
    additionalInputRules.push(
      {
        not: {
          properties: { execute: { const: true } },
          required: ["execute"],
        },
      },
      {
        if: {
          properties: { rollback: { const: true } },
          required: ["rollback"],
        },
        then: {
          properties: {
            assetPath: { type: "string", pattern: SANDBOX_RUN_ROOT_OR_DESCENDANT_PATTERN },
          },
        },
        else: {
          properties: {
            assetPath: { type: "string", pattern: SANDBOX_DESCENDANT_PATTERN },
          },
        },
      },
    );
  }
  const inputSchema: Record<string, unknown> = {
    type: "object",
    additionalProperties: false,
    properties: {
      changeSetId: { type: "string", pattern: "^[A-Za-z0-9._:-]+$" },
      runId: { type: "string", pattern: "^[A-Za-z0-9_-]+$" },
      operationId: { type: "string", pattern: "^[A-Za-z0-9_-]+$" },
      dryRun: { type: "boolean" },
      execute: { type: "boolean" },
      rollback: { type: "boolean" },
      dryRunHash: hashSchema,
      ...specificProperties,
    },
    required,
    allOf: [{ oneOf: phaseVariants }, ...additionalInputRules],
  };
  return {
    schemaVersion: UAGENT_COMPANION_CONTRACT_VERSION,
    inputSchema,
    outputSchema: createMvp15DOutputSchema(),
    dryRunSchema: createMvp15DDryRunResultSchema(),
    rollbackContract: {
      type: "object",
      additionalProperties: false,
      properties: {
        strategy: { const: "ledger_inverse" },
        inverseOperation: { type: "string" },
        executionEnabled: { type: "boolean" },
      },
      required: ["strategy", "inverseOperation", "executionEnabled"],
    },
    affectedAssetsSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        readOnlySources: { type: "array", items: { type: "string" } },
        sandboxTargets: { type: "array", items: { type: "string", pattern: SANDBOX_RUN_ROOT_OR_DESCENDANT_PATTERN } },
        externalTargets: { const: [] },
      },
      required: ["readOnlySources", "sandboxTargets", "externalTargets"],
    },
    evidenceQuery: {
      type: "object",
      additionalProperties: false,
      properties: {
        queryKind: { const: "asset_registry_snapshot" },
        readOnly: { const: true },
        paths: { type: "array", items: { type: "string" } },
      },
      required: ["queryKind", "readOnly", "paths"],
    },
  };
}

function createMvp15DOutputSchema(): Record<string, unknown> {
  const { properties, required } = createMvp15DResultSchemaShape();
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
  };
}

function createMvp15DDryRunResultSchema(): Record<string, unknown> {
  const { properties, required } = createMvp15DResultSchemaShape();
  return {
    type: "object",
    additionalProperties: false,
    properties,
    required,
    allOf: [{
      if: { required: ["phase"] },
      then: { properties: { phase: { const: "dry_run" } }, required: ["phase"] },
    }],
  };
}

function createMvp15DResultSchemaShape(): { properties: Record<string, unknown>; required: string[] } {
  const stringArray = { type: "array", items: { type: "string" } };
  return {
    properties: {
      blocked: { type: "boolean" },
      status: { type: "string" },
      reasonCode: { type: "string" },
      toolName: { type: "string", enum: [...UAGENT_COMPANION_TOOL_NAMES] },
      operation: { type: "string" },
      phase: { enum: ["dry_run", "execute", "rollback"] },
      changeSetId: { type: "string", pattern: "^[A-Za-z0-9._:-]+$" },
      runId: { type: "string", pattern: "^[A-Za-z0-9_-]+$" },
      operationId: { type: "string", pattern: "^[A-Za-z0-9_-]+$" },
      sandboxRoot: { type: "string", pattern: SANDBOX_RUN_ROOT_OR_DESCENDANT_PATTERN },
      wouldChange: { type: "boolean" },
      wouldRead: stringArray,
      wouldModify: stringArray,
      affectedAssets: {
        type: "object",
        additionalProperties: false,
        properties: {
          readOnlySources: stringArray,
          sandboxTargets: stringArray,
          externalTargets: { const: [] },
        },
        required: ["readOnlySources", "sandboxTargets", "externalTargets"],
      },
      rollbackPlan: {
        type: "object",
        additionalProperties: false,
        properties: {
          strategy: { const: "ledger_inverse" },
          inverseOperation: { type: "string" },
          executionEnabled: { type: "boolean" },
        },
        required: ["strategy", "inverseOperation", "executionEnabled"],
      },
      externalEvidenceQueries: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            queryKind: { type: "string" },
            readOnly: { const: true },
            paths: stringArray,
          },
          required: ["queryKind", "readOnly", "paths"],
        },
      },
      dryRunHash: { type: "string", pattern: "^[0-9a-f]{40}$" },
      hashAlgorithm: { const: "sha1" },
      schemaVersion: { const: "mvp15c.dry-run.v1" },
      approvalRequired: { const: true },
      sideEffectObserved: { type: "boolean" },
      effectState: { enum: ["known_none", "known_effect", "known_partial", "unknown"] },
      rollbackAvailable: { type: "boolean" },
      rollbackStatus: { type: "string" },
      implementationStatus: { const: "execution_capable" },
      evidenceId: { type: "string" },
    },
    required: [
      "blocked", "status", "reasonCode", "toolName", "operation", "phase", "changeSetId", "runId", "operationId", "sandboxRoot",
      "wouldChange", "wouldRead", "wouldModify", "affectedAssets", "rollbackPlan", "externalEvidenceQueries",
      "dryRunHash", "hashAlgorithm", "schemaVersion", "approvalRequired", "sideEffectObserved", "effectState", "rollbackAvailable",
      "rollbackStatus", "implementationStatus", "evidenceId",
    ],
  };
}

function isSafeRunId(value: unknown): value is string {
  return typeof value === "string" && SAFE_RUN_ID.test(value);
}

function isSafeChangeSetId(value: unknown): value is string {
  return typeof value === "string" && SAFE_CHANGE_SET_ID.test(value);
}

function isCanonicalGamePath(value: string): boolean {
  return /^\/Game\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(value)
    && !value.includes("..")
    && !value.includes("\\")
    && !value.includes("//");
}

function isStrictDescendant(value: string, root: string): boolean {
  return value.startsWith(`${root}/`) && value.length > root.length + 1;
}

function parseMvp15DIdentity(value: unknown): Mvp15DCompanionIdentityEvidence | null {
  const record = toPlainRecord(value);
  if (!record || !hasAllFields(record, IDENTITY_FIELDS) || !hasOnlyFields(record, IDENTITY_FIELDS)) return null;
  if (record.schemaVersion !== UAGENT_COMPANION_IDENTITY_SCHEMA_VERSION
    || record.pluginId !== UAGENT_COMPANION_PLUGIN_ID
    || record.pluginVersion !== UAGENT_COMPANION_PLUGIN_VERSION
    || record.contractVersion !== UAGENT_COMPANION_CONTRACT_VERSION
    || record.engineVersion !== UAGENT_COMPANION_ENGINE_VERSION
    || record.engineChangelist !== UAGENT_COMPANION_ENGINE_CHANGELIST
    || record.compatibleChangelist !== UAGENT_COMPANION_COMPATIBLE_CHANGELIST
    || record.moduleBuildId !== UAGENT_COMPANION_MODULE_BUILD_ID
    || typeof record.sourceCommit !== "string"
    || !HEX40.test(record.sourceCommit)
    || typeof record.buildManifestSha256 !== "string"
    || !HEX64.test(record.buildManifestSha256)
    || typeof record.sourceTreeSha256 !== "string"
    || !HEX64.test(record.sourceTreeSha256)
    || typeof record.buildCommandFingerprint !== "string"
    || !HEX64.test(record.buildCommandFingerprint)
    || typeof record.loadedModuleName !== "string"
    || !SAFE_ARTIFACT_NAME.test(record.loadedModuleName)
    || typeof record.loadedModuleSha256 !== "string"
    || !HEX64.test(record.loadedModuleSha256)) {
    return null;
  }
  return {
    schemaVersion: UAGENT_COMPANION_IDENTITY_SCHEMA_VERSION,
    pluginId: UAGENT_COMPANION_PLUGIN_ID,
    pluginVersion: UAGENT_COMPANION_PLUGIN_VERSION,
    contractVersion: UAGENT_COMPANION_CONTRACT_VERSION,
    sourceCommit: record.sourceCommit,
    buildManifestSha256: record.buildManifestSha256,
    engineVersion: UAGENT_COMPANION_ENGINE_VERSION,
    engineChangelist: UAGENT_COMPANION_ENGINE_CHANGELIST,
    compatibleChangelist: UAGENT_COMPANION_COMPATIBLE_CHANGELIST,
    moduleBuildId: UAGENT_COMPANION_MODULE_BUILD_ID,
    sourceTreeSha256: record.sourceTreeSha256,
    buildCommandFingerprint: record.buildCommandFingerprint,
    loadedModuleName: record.loadedModuleName,
    loadedModuleSha256: record.loadedModuleSha256,
  };
}

function parseArtifact(value: unknown): UAgentCompanionArtifactHash | null {
  const record = toPlainRecord(value);
  if (!record || !hasAllFields(record, ARTIFACT_FIELDS) || !hasOnlyFields(record, ARTIFACT_FIELDS)) return null;
  if (typeof record.name !== "string" || record.name.length === 0 || !SAFE_ARTIFACT_NAME.test(record.name)
    || typeof record.size !== "number" || !Number.isSafeInteger(record.size) || record.size < 0
    || typeof record.sha256 !== "string" || !HEX64.test(record.sha256)) {
    return null;
  }
  return { name: record.name, size: record.size, sha256: record.sha256 };
}

function parseManifestArtifact(value: unknown): UAgentCompanionManifestArtifact | null {
  const record = toPlainRecord(value);
  if (
    !record ||
    !hasAllFields(record, MANIFEST_ARTIFACT_FIELDS) ||
    !hasOnlyFields(record, MANIFEST_ARTIFACT_FIELDS) ||
    typeof record.path !== "string" ||
    !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(record.path) ||
    typeof record.size !== "number" ||
    !Number.isSafeInteger(record.size) ||
    record.size < 0 ||
    typeof record.sha256 !== "string" ||
    !HEX64.test(record.sha256)
  ) {
    return null;
  }
  return { path: record.path, size: record.size, sha256: record.sha256 };
}

function parsePhysicalFixture(
  value: unknown,
): (UAgentCompanionManifestArtifact & { gitObjectSha256: string }) | null {
  const record = toPlainRecord(value);
  if (
    !record ||
    !hasAllFields(record, PHYSICAL_FIXTURE_FIELDS) ||
    !hasOnlyFields(record, PHYSICAL_FIXTURE_FIELDS)
  ) {
    return null;
  }
  const artifact = parseManifestArtifact({
    path: record.path,
    size: record.size,
    sha256: record.sha256,
  });
  if (!artifact || typeof record.gitObjectSha256 !== "string" || !HEX64.test(record.gitObjectSha256)) {
    return null;
  }
  return { ...artifact, gitObjectSha256: record.gitObjectSha256 };
}

function parseToolchain<const TName extends string>(
  value: unknown,
  expectedName: TName,
): { name: TName; version: string } | null {
  const record = toPlainRecord(value);
  if (
    !record ||
    !hasAllFields(record, ["name", "version"]) ||
    !hasOnlyFields(record, ["name", "version"]) ||
    record.name !== expectedName ||
    typeof record.version !== "string" ||
    !/^\d+(?:\.\d+){1,3}$/.test(record.version)
  ) {
    return null;
  }
  return { name: expectedName, version: record.version };
}

function hasCanonicalManifestPaths(artifacts: readonly UAgentCompanionManifestArtifact[]): boolean {
  const paths = new Set<string>();
  return artifacts.every((artifact) => {
    const key = artifact.path.toLowerCase();
    return !paths.has(key) && (paths.add(key), true);
  });
}

function isExactToolNames(value: unknown): value is readonly UAgentCompanionToolName[] {
  const names = toPlainArray(value);
  return names !== null
    && names.length === UAGENT_COMPANION_TOOL_NAMES.length
    && names.every((name, index) => name === UAGENT_COMPANION_TOOL_NAMES[index]);
}

function isCompanionToolName(value: unknown): value is UAgentCompanionToolName {
  return typeof value === "string" && (UAGENT_COMPANION_TOOL_NAMES as readonly string[]).includes(value);
}

function isCompanionPhase(value: unknown): value is Mvp15DCompanionPhase {
  return value === "dry_run" || value === "execute" || value === "rollback";
}

function isCanonicalTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString() === value;
}

function normalizeLiveFingerprintInput(input: unknown): {
  directTools: Mvp15DCompanionDescriptorLike[];
  facadeTools: Mvp15DCompanionDescriptorLike[];
  discoveryGeneration: number;
  valid: boolean;
} {
  const record = toPlainRecord(input);
  if (!record) return { directTools: [], facadeTools: [], discoveryGeneration: 0, valid: false };
  const directTools = toPlainArray(record.directTools);
  const facadeTools = hasOwnField(record, "facadeTools") ? toPlainArray(record.facadeTools) : [];
  const discoveryGeneration = record.discoveryGeneration;
  if (!directTools || !facadeTools || typeof discoveryGeneration !== "number"
    || !Number.isSafeInteger(discoveryGeneration) || discoveryGeneration < 0) {
    return { directTools: [], facadeTools: [], discoveryGeneration: 0, valid: false };
  }
  return {
    directTools: directTools as Mvp15DCompanionDescriptorLike[],
    facadeTools: facadeTools as Mvp15DCompanionDescriptorLike[],
    discoveryGeneration,
    valid: true,
  };
}

function normalizeCompanionAttestationInput(input: unknown): {
  manifest: unknown | null;
  installedModules: unknown[];
  loadedModules: unknown[];
  directTools: Mvp15DCompanionDescriptorLike[];
  facadeTools: Mvp15DCompanionDescriptorLike[];
  discoveryGeneration: number;
  valid: boolean;
} {
  const record = toPlainRecord(input);
  if (!record) {
    return {
      manifest: null,
      installedModules: [],
      loadedModules: [],
      directTools: [],
      facadeTools: [],
      discoveryGeneration: 0,
      valid: false,
    };
  }
  const live = normalizeLiveFingerprintInput(record);
  const installedModules = toPlainArray(record.installedModules);
  const loadedModules = toPlainArray(record.loadedModules);
  return {
    manifest: hasOwnField(record, "manifest") ? record.manifest : undefined,
    installedModules: installedModules ?? [],
    loadedModules: loadedModules ?? [],
    directTools: live.directTools,
    facadeTools: live.facadeTools,
    discoveryGeneration: live.discoveryGeneration,
    valid: live.valid && installedModules !== null && loadedModules !== null,
  };
}

function hasAllFields(record: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => hasOwnField(record, field));
}

function hasOnlyFields(record: Record<string, unknown>, fields: readonly string[]): boolean {
  const allowed = new Set(fields);
  return Object.keys(record).every((field) => allowed.has(field));
}

function hasOwnField(record: Record<string, unknown>, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, field);
}

function toPlainRecord(value: unknown): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const keys = Reflect.ownKeys(value);
    const output = Object.create(null) as Record<string, unknown>;
    for (const key of keys) {
      if (typeof key !== "string") return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      Object.defineProperty(output, key, {
        value: descriptor.value,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return output;
  } catch {
    return null;
  }
}

function toPlainArray(value: unknown): unknown[] | null {
  try {
    if (!Array.isArray(value)) return null;
    const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
    if (!lengthDescriptor || !("value" in lengthDescriptor)
      || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) return null;
    const length = lengthDescriptor.value;
    for (const key of Reflect.ownKeys(value)) {
      if (key === "length") continue;
      if (typeof key !== "string") return null;
      const index = Number(key);
      if (!Number.isSafeInteger(index) || index < 0 || index >= length || String(index) !== key) return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
    }
    const output: unknown[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
      output.push(descriptor.value);
    }
    return output;
  } catch {
    return null;
  }
}
