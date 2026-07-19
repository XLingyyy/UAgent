import { createSha256Hash } from "./mvp12-change-set.js";
import {
  MVP15_ASSET_TOOL_ALLOWLIST,
  normalizeMvp15McpAssetToolDescriptor,
  type Mvp15McpAssetToolDescriptor,
  type Mvp15McpAssetToolDescriptorLike,
  type Mvp15McpAssetToolName,
} from "./mvp15-mcp-asset-adapter.js";
import { getMvp15FacadeMetadata } from "./mvp15-exact-tool-facade.js";

export const MVP15_LIVE_ASSET_TOOLSET_FINGERPRINT_SCHEMA_VERSION =
  "uagent.mvp15.live-asset-toolset-fingerprint.v1" as const;

export type Mvp15LiveAssetToolSource = "direct" | "facade";

export interface Mvp15LiveAssetToolFingerprintInput {
  directTools: readonly Mvp15McpAssetToolDescriptorLike[];
  facadeTools?: readonly Mvp15McpAssetToolDescriptorLike[];
}

export interface Mvp15LiveAssetToolFingerprintSummary {
  name: Mvp15McpAssetToolName;
  source: Mvp15LiveAssetToolSource;
  sha256: string;
}

export interface Mvp15LiveAssetToolFingerprintInvalidTool {
  name: Mvp15McpAssetToolName;
  fields: string[];
}

export interface Mvp15LiveAssetToolFingerprintIssues {
  missingTools: Mvp15McpAssetToolName[];
  duplicateTools: Mvp15McpAssetToolName[];
  unexpectedToolCount: number;
  unexpectedDuplicateCount: number;
  malformedToolCount: number;
  reordered: boolean;
  invalidTools: Mvp15LiveAssetToolFingerprintInvalidTool[];
}

export interface Mvp15LiveAssetToolsetFingerprintResult {
  status: "ready" | "blocked_by_mcp_schema";
  schemaVersion: typeof MVP15_LIVE_ASSET_TOOLSET_FINGERPRINT_SCHEMA_VERSION;
  sha256: string | null;
  canonicalByteLength: number | null;
  toolCount: number;
  source: Mvp15LiveAssetToolSource | "mixed" | null;
  tools: Mvp15LiveAssetToolFingerprintSummary[];
  issues: Mvp15LiveAssetToolFingerprintIssues;
}

interface SourcedTool {
  descriptor: Mvp15McpAssetToolDescriptor;
  source: Mvp15LiveAssetToolSource;
}

interface ParsedAssetTools {
  tools: SourcedTool[];
  unexpectedNames: string[];
  malformedToolCount: number;
}

interface ParsedFingerprintInput {
  directTools: readonly unknown[];
  facadeTools: readonly unknown[];
  malformedToolCount: number;
}

interface CanonicalToolPayload {
  affectedAssetsSchema: Record<string, unknown>;
  dryRunSchema: Record<string, unknown>;
  evidenceQuery: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  methodId: string | null;
  name: Mvp15McpAssetToolName;
  rollbackContract: Record<string, unknown>;
  schemaVersion: string;
  source: Mvp15LiveAssetToolSource;
  toolsetId: string | null;
}

export function createMvp15LiveAssetToolsetFingerprint(
  input: Mvp15LiveAssetToolFingerprintInput | readonly Mvp15McpAssetToolDescriptorLike[],
): Mvp15LiveAssetToolsetFingerprintResult {
  try {
    return createFingerprint(input);
  } catch {
    return blockedFingerprint(0, null, emptyIssues(1));
  }
}

function createFingerprint(input: unknown): Mvp15LiveAssetToolsetFingerprintResult {
  const parsedInput = parseFingerprintInput(input);
  const direct = toAssetNamespaceTools(parsedInput.directTools, "direct");
  const facade = toAssetNamespaceTools(parsedInput.facadeTools, "facade");
  const directNames = direct.tools.map((tool) => tool.descriptor.name as Mvp15McpAssetToolName);
  const facadeNames = facade.tools.map((tool) => tool.descriptor.name as Mvp15McpAssetToolName);
  const duplicateTools = uniqueSortedAssetToolNames([
    ...duplicateValues(directNames),
    ...duplicateValues(facadeNames),
  ]);
  const reordered = isRawOrderInvalid(directNames) || isRawOrderInvalid(facadeNames);
  const missingTools: Mvp15McpAssetToolName[] = [];
  const invalidTools: Mvp15LiveAssetToolFingerprintInvalidTool[] = [];
  const canonicalTools: CanonicalToolPayload[] = [];

  for (const toolName of MVP15_ASSET_TOOL_ALLOWLIST) {
    const directCandidate = direct.tools.find((tool) => tool.descriptor.name === toolName);
    const facadeCandidate = facade.tools.find((tool) => tool.descriptor.name === toolName);
    if (!directCandidate && !facadeCandidate) {
      missingTools.push(toolName);
      continue;
    }
    const directFields = directCandidate ? invalidFields(directCandidate) : [];
    const facadeFields = facadeCandidate ? invalidFields(facadeCandidate) : [];
    const selected =
      directCandidate && directFields.length === 0
        ? directCandidate
        : facadeCandidate && facadeFields.length === 0
          ? facadeCandidate
          : directCandidate ?? facadeCandidate!;
    const selectedFields = selected === directCandidate ? directFields : facadeFields;
    if (selectedFields.length > 0) {
      invalidTools.push({ name: toolName, fields: selectedFields });
      continue;
    }
    canonicalTools.push(toCanonicalTool(selected, toolName));
  }

  const issues: Mvp15LiveAssetToolFingerprintIssues = {
    missingTools,
    duplicateTools,
    unexpectedToolCount: direct.unexpectedNames.length + facade.unexpectedNames.length,
    unexpectedDuplicateCount:
      duplicateOccurrenceCount(direct.unexpectedNames) +
      duplicateOccurrenceCount(facade.unexpectedNames),
    malformedToolCount:
      parsedInput.malformedToolCount + direct.malformedToolCount + facade.malformedToolCount,
    reordered,
    invalidTools,
  };
  const source = summarizeSource(canonicalTools);
  if (
    canonicalTools.length !== MVP15_ASSET_TOOL_ALLOWLIST.length ||
    hasFingerprintIssues(issues)
  ) {
    return blockedFingerprint(canonicalTools.length, source, issues);
  }

  const canonicalToolStrings = canonicalTools.map((tool) => stableJson(tool));
  const invalidCanonicalTools = canonicalTools
    .filter((_tool, index) => canonicalToolStrings[index] === null)
    .map((tool) => ({ name: tool.name, fields: ["canonicalJson"] }));
  if (invalidCanonicalTools.length > 0) {
    return blockedFingerprint(canonicalTools.length, source, {
      ...issues,
      invalidTools: invalidCanonicalTools,
    });
  }

  const payload = {
    schemaVersion: MVP15_LIVE_ASSET_TOOLSET_FINGERPRINT_SCHEMA_VERSION,
    tools: canonicalTools,
  };
  const canonical = stableJson(payload);
  if (canonical === null) {
    return blockedFingerprint(canonicalTools.length, source, {
      ...issues,
      invalidTools: canonicalTools.map((tool) => ({
        name: tool.name,
        fields: ["canonicalJson"],
      })),
    });
  }
  const summaries = canonicalTools.map((tool, index) => {
    const canonicalTool = canonicalToolStrings[index] as string;
    return {
      name: tool.name,
      source: tool.source,
      sha256: createSha256Hash(canonicalTool),
    } satisfies Mvp15LiveAssetToolFingerprintSummary;
  });

  return {
    status: "ready",
    schemaVersion: MVP15_LIVE_ASSET_TOOLSET_FINGERPRINT_SCHEMA_VERSION,
    sha256: createSha256Hash(canonical),
    canonicalByteLength: new TextEncoder().encode(canonical).byteLength,
    toolCount: canonicalTools.length,
    source,
    tools: summaries,
    issues,
  };
}

function parseFingerprintInput(input: unknown): ParsedFingerprintInput {
  if (Array.isArray(input)) {
    return { directTools: input, facadeTools: [], malformedToolCount: 0 };
  }
  if (!input || typeof input !== "object") {
    return { directTools: [], facadeTools: [], malformedToolCount: 1 };
  }

  const structuredInput = input as Record<string, unknown>;
  const directCandidate = structuredInput.directTools;
  const facadeCandidate = structuredInput.facadeTools;
  const directTools = Array.isArray(directCandidate) ? directCandidate : [];
  const facadeTools = Array.isArray(facadeCandidate) ? facadeCandidate : [];
  return {
    directTools,
    facadeTools,
    malformedToolCount:
      (Array.isArray(directCandidate) ? 0 : 1) +
      (facadeCandidate === undefined || Array.isArray(facadeCandidate) ? 0 : 1),
  };
}

function toAssetNamespaceTools(
  rawTools: readonly unknown[],
  source: Mvp15LiveAssetToolSource,
): ParsedAssetTools {
  const tools: SourcedTool[] = [];
  const unexpectedNames: string[] = [];
  let malformedToolCount = 0;

  for (const rawTool of rawTools) {
    if (!rawTool || (typeof rawTool !== "object" && typeof rawTool !== "function")) {
      malformedToolCount += 1;
      continue;
    }
    let name: unknown;
    try {
      name = Reflect.get(rawTool, "name");
    } catch {
      malformedToolCount += 1;
      continue;
    }
    if (typeof name !== "string") {
      malformedToolCount += 1;
      continue;
    }
    if (!name.startsWith("ue.asset.")) continue;
    if (!isExactAssetToolName(name)) {
      unexpectedNames.push(name);
      continue;
    }
    try {
      tools.push({
        descriptor: normalizeMvp15McpAssetToolDescriptor(
          rawTool as Mvp15McpAssetToolDescriptorLike,
        ),
        source,
      });
    } catch {
      malformedToolCount += 1;
    }
  }

  return { tools, unexpectedNames, malformedToolCount };
}

function invalidFields(tool: SourcedTool): string[] {
  const fields: string[] = [];
  const facade = getMvp15FacadeMetadata(tool.descriptor);
  const schemaVersion =
    tool.source === "facade" ? facade?.schemaVersion : tool.descriptor.schemaVersion;
  if (typeof schemaVersion !== "string" || !schemaVersion.trim()) {
    fields.push("schemaVersion");
  }
  for (const field of [
    "inputSchema",
    "dryRunSchema",
    "rollbackContract",
    "affectedAssetsSchema",
    "evidenceQuery",
  ] as const) {
    if (!isObjectRecord(tool.descriptor[field])) fields.push(field);
  }
  if (tool.source === "facade" && !facade) fields.push("facadeIdentity");
  return uniqueSorted(fields);
}

function toCanonicalTool(
  tool: SourcedTool,
  name: Mvp15McpAssetToolName,
): CanonicalToolPayload {
  const facade = getMvp15FacadeMetadata(tool.descriptor);
  return {
    affectedAssetsSchema: tool.descriptor.affectedAssetsSchema as Record<string, unknown>,
    dryRunSchema: tool.descriptor.dryRunSchema as Record<string, unknown>,
    evidenceQuery: tool.descriptor.evidenceQuery as Record<string, unknown>,
    inputSchema: tool.descriptor.inputSchema as Record<string, unknown>,
    methodId: facade?.methodId ?? null,
    name,
    rollbackContract: tool.descriptor.rollbackContract as Record<string, unknown>,
    schemaVersion: ((tool.source === "facade" ? facade?.schemaVersion : tool.descriptor.schemaVersion) as string).trim(),
    source: tool.source,
    toolsetId: facade?.toolsetId ?? null,
  };
}

function blockedFingerprint(
  toolCount: number,
  source: Mvp15LiveAssetToolSource | "mixed" | null,
  issues: Mvp15LiveAssetToolFingerprintIssues,
): Mvp15LiveAssetToolsetFingerprintResult {
  return {
    status: "blocked_by_mcp_schema",
    schemaVersion: MVP15_LIVE_ASSET_TOOLSET_FINGERPRINT_SCHEMA_VERSION,
    sha256: null,
    canonicalByteLength: null,
    toolCount,
    source,
    tools: [],
    issues,
  };
}

function hasFingerprintIssues(issues: Mvp15LiveAssetToolFingerprintIssues): boolean {
  return (
    issues.missingTools.length > 0 ||
    issues.duplicateTools.length > 0 ||
    issues.unexpectedToolCount > 0 ||
    issues.unexpectedDuplicateCount > 0 ||
    issues.malformedToolCount > 0 ||
    issues.reordered ||
    issues.invalidTools.length > 0
  );
}

function summarizeSource(
  tools: readonly CanonicalToolPayload[],
): Mvp15LiveAssetToolSource | "mixed" | null {
  const sources = new Set(tools.map((tool) => tool.source));
  if (sources.size === 0) return null;
  if (sources.size > 1) return "mixed";
  return tools[0].source;
}

function isRawOrderInvalid(names: readonly Mvp15McpAssetToolName[]): boolean {
  let previous = -1;
  for (const name of names) {
    const index = MVP15_ASSET_TOOL_ALLOWLIST.indexOf(name);
    if (index < previous) return true;
    previous = index;
  }
  return false;
}

function isExactAssetToolName(value: string): value is Mvp15McpAssetToolName {
  return (MVP15_ASSET_TOOL_ALLOWLIST as readonly string[]).includes(value);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function duplicateValues<T extends string>(values: readonly T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function uniqueSortedAssetToolNames(
  values: readonly Mvp15McpAssetToolName[],
): Mvp15McpAssetToolName[] {
  return [...new Set(values)].sort();
}

function duplicateOccurrenceCount(values: readonly string[]): number {
  return values.length - new Set(values).size;
}

function emptyIssues(malformedToolCount = 0): Mvp15LiveAssetToolFingerprintIssues {
  return {
    missingTools: [...MVP15_ASSET_TOOL_ALLOWLIST],
    duplicateTools: [],
    unexpectedToolCount: 0,
    unexpectedDuplicateCount: 0,
    malformedToolCount,
    reordered: false,
    invalidTools: [],
  };
}

function stableJson(value: unknown): string | null {
  try {
    const seen = new Set<object>();
    return JSON.stringify(toCanonicalValue(value, seen));
  } catch {
    return null;
  }
}

function toCanonicalValue(value: unknown, seen: Set<object>): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non_finite_number");
    return value;
  }
  if (typeof value !== "object") throw new Error("unsupported_json_value");
  if (seen.has(value)) throw new Error("cyclic_json_value");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => toCanonicalValue(entry, seen));
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("non_json_object");
    }
    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      output[key] = toCanonicalValue(record[key], seen);
    }
    return output;
  } finally {
    seen.delete(value);
  }
}
