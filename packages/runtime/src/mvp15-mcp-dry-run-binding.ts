import { createSha256Hash } from "./mvp12-change-set.js";
import type {
  AssetDryRunHashAlgorithm,
  AssetDryRunHashSource,
  AssetDryRunSchemaVersion,
  AssetExternalBindingStatus,
  AssetMutationOperation,
  AssetMutationOperationKind,
  AssetMutationOperationProvenance,
} from "@uagent/shared";

/**
 * Canonical aggregate binding schema version used by UAgent to compute the stable
 * aggregate dry-run and args hashes. G1 puts the explicit literal first so any future
 * change is detectable even when plugin-issued hashes match.
 */
export const UAGENT_EXTERNAL_DRY_RUN_BINDING_SCHEMA_VERSION = "uagent.mvp15.external-dry-run-binding.v1" as const;

/** SAFE_CHANGESET_ID RegExp per the accepted plugin contract `[A-Za-z0-9_-]+`. */
export const SAFE_CHANGESET_ID_RE = /^[A-Za-z0-9_-]+$/;
export const SAFE_RUN_ID_RE = /^[A-Za-z0-9_-]+$/;

/** Exact tool names as exposed by the live UE MCP plugin (the six direct descriptors). */
export const EXACT_ASSET_TOOL_NAMES = {
  create_folder: "ue.asset.create_folder",
  duplicate: "ue.asset.duplicate",
  rename: "ue.asset.rename",
  move: "ue.asset.move",
  delete: "ue.asset.delete",
  save: "ue.asset.save",
} as const;

/** Plugin operation kind string emitted in the structured dry-run result `operation` field. */
export const PLUGIN_OPERATION_KIND = {
  create_folder: "create_folder",
  duplicate_asset: "duplicate",
  create_test_asset: "create_asset",
  rename_asset: "rename",
  move_asset: "move",
  save_single_asset: "save",
  delete_sandbox_asset: "delete",
} as const;

export const PLUGIN_DRY_RUN_HASH_SOURCE: AssetDryRunHashSource = "ue_mcp_exact_tool";
export const PLUGIN_DRY_RUN_HASH_ALGORITHM: AssetDryRunHashAlgorithm = "sha1";
export const PLUGIN_DRY_RUN_SCHEMA_VERSION: AssetDryRunSchemaVersion = "mvp15c.dry-run.v1";

const SHA1_HEX_RE = /^[0-9a-f]{40}$/;
const SANDBOX_ROOT = "/Game/UAgentSandbox";

export interface DryRunBindingContext {
  changeSetId: string;
  runId: string;
  projectId: string;
  trustedRootId: string;
  editorSessionId: string;
  pidHash: string;
  sandboxRoot: typeof SANDBOX_ROOT;
}

export interface DryRunBindingInput {
  operationId: string;
  operationKind: AssetMutationOperationKind;
  assetPathBefore: string | null;
  assetPathAfter: string | null;
  exactToolName: string;
  context: DryRunBindingContext;
}

export interface DryRunBindingRequest {
  toolName: string;
  args: Record<string, unknown>;
}

export interface DryRunBindingFailure {
  ok: false;
  reason: string;
}

export interface DryRunBindingSuccess {
  ok: true;
  provenance: AssetMutationOperationProvenance;
  pluginResult: PluginDryRunResult;
}

export type DryRunBindingResult = DryRunBindingSuccess | DryRunBindingFailure;

/** Canonical structured fields emitted by the live plugin dry-run result. */
export interface PluginDryRunResult {
  blocked: boolean;
  status: string;
  reasonCode?: string;
  message?: string;
  toolName: string;
  operation: string;
  changeSetId: string;
  runId: string;
  sandboxRoot: string;
  wouldChange: boolean;
  wouldModify?: string[];
  wouldRead?: string[];
  affectedAssets?: {
    readOnlySources?: string[];
    sandboxTargets?: string[];
    externalTargets?: string[];
  };
  rollbackPlan?: {
    executionEnabled?: boolean;
    inverseOperation?: string;
    summary?: string;
  };
  externalEvidenceQueries?: Array<{ queryKind?: string; readOnly?: boolean; paths?: string[] }>;
  dryRunHash: string;
  hashAlgorithm: string;
  schemaVersion: string;
  approvalRequired: boolean;
  implementationStatus: "execution_capable";
}

export interface ExternalBindingOperation {
  operationId: string;
  kind: AssetMutationOperationKind;
  exactToolName: string;
  assetPathBefore: string | null;
  assetPathAfter: string | null;
  normalizedArgsHash: string;
  pluginDryRunHash: string;
  pluginHashAlgorithm: string;
  pluginSchemaVersion: string;
}

/** Map a UAgent operation to the canonical plugin dry-run payload (dry_run only, no execute/rollback/token). */
export function buildExactDryRunPayload(input: DryRunBindingInput): DryRunBindingRequest {
  const ctx = input.context;
  const common = {
    changeSetId: ctx.changeSetId,
    runId: ctx.runId,
    dryRun: true,
    execute: false,
    rollback: false,
  };
  switch (input.operationKind) {
    case "create_folder":
      return { toolName: EXACT_ASSET_TOOL_NAMES.create_folder, args: { ...common, folderPath: input.assetPathAfter } };
    case "duplicate_asset":
      return {
        toolName: EXACT_ASSET_TOOL_NAMES.duplicate,
        args: { ...common, sourceAssetPath: input.assetPathBefore, targetAssetPath: input.assetPathAfter },
      };
    case "rename_asset":
      return {
        toolName: EXACT_ASSET_TOOL_NAMES.rename,
        args: { ...common, assetPath: input.assetPathBefore, targetAssetPath: input.assetPathAfter },
      };
    case "move_asset":
      return {
        toolName: EXACT_ASSET_TOOL_NAMES.move,
        args: { ...common, assetPath: input.assetPathBefore, targetAssetPath: input.assetPathAfter },
      };
    case "delete_sandbox_asset":
      return { toolName: EXACT_ASSET_TOOL_NAMES.delete, args: { ...common, assetPath: input.assetPathBefore } };
    case "save_single_asset":
      return {
        toolName: EXACT_ASSET_TOOL_NAMES.save,
        args: { ...common, assetPath: input.assetPathAfter ?? input.assetPathBefore, saveAll: false },
      };
    default:
      return { toolName: EXACT_ASSET_TOOL_NAMES.create_folder, args: { ...common, folderPath: input.assetPathAfter } };
  }
}

/**
 * Compute the SHA-256 args hash over the canonical normalized dry-run payload. The plugin
 * args are normalized to a fixed key order so the hash is stable regardless of insertion order.
 * Execute/rollback flags are never part of argsHash; the canonical binding payload only ever
 * reflects the dry-run view of the args.
 */
export function computeArgsHash(input: DryRunBindingInput): string {
  const payload = buildExactDryRunPayload(input);
  const ctx = input.context;
  const canonical = canonicalArgsString(payload, input, ctx);
  return createSha256Hash(canonical);
}

function canonicalArgsString(
  payload: DryRunBindingRequest,
  input: DryRunBindingInput,
  ctx: DryRunBindingContext,
): string {
  const keys = Object.keys(payload.args).sort();
  const parts: string[] = [
    `schemaVersion=${UAGENT_EXTERNAL_DRY_RUN_BINDING_SCHEMA_VERSION}`,
    `changeSetId=${ctx.changeSetId}`,
    `runId=${ctx.runId}`,
    `toolName=${payload.toolName}`,
    `operation=${input.operationKind}`,
  ];
  for (const key of keys) {
    const value = payload.args[key];
    if (value === null || value === undefined) {
      parts.push(`${key}=`);
      continue;
    }
    parts.push(`${key}=${normalizePrimitive(value)}`);
  }
  return parts.join("\n");
}

function normalizePrimitive(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return "";
}

/**
 * Stable aggregate SHA-256 over the canonical binding payload. Fixed key order, no locale,
 * no timestamps, no random values, no approval tokens, no object traversal order.
 */
export function computeAggregateBindingHash(operations: ExternalBindingOperation[], ctx: DryRunBindingContext): {
  aggregateDryRunHash: string;
  aggregateArgsHash: string;
} {
  const lines: string[] = [
    `schemaVersion=${UAGENT_EXTERNAL_DRY_RUN_BINDING_SCHEMA_VERSION}`,
    `changeSetId=${ctx.changeSetId}`,
    `projectId=${ctx.projectId}`,
    `trustedRootId=${ctx.trustedRootId}`,
    `editorSessionId=${ctx.editorSessionId}`,
    `pidHash=${ctx.pidHash}`,
    `runId=${ctx.runId}`,
  ];
  const argsLines: string[] = [...lines];
  for (const op of operations) {
    lines.push(
      [
        `operationId=${op.operationId}`,
        `kind=${op.kind}`,
        `exactToolName=${op.exactToolName}`,
        `assetPathBefore=${op.assetPathBefore ?? ""}`,
        `assetPathAfter=${op.assetPathAfter ?? ""}`,
        `normalizedArgsHash=${op.normalizedArgsHash}`,
        `pluginDryRunHash=${op.pluginDryRunHash}`,
        `pluginHashAlgorithm=${op.pluginHashAlgorithm}`,
        `pluginSchemaVersion=${op.pluginSchemaVersion}`,
      ].join("\n"),
    );
    argsLines.push(
      [
        `operationId=${op.operationId}`,
        `kind=${op.kind}`,
        `normalizedArgsHash=${op.normalizedArgsHash}`,
      ].join("\n"),
    );
  }
  return {
    aggregateDryRunHash: createSha256Hash(lines.join("\n")),
    aggregateArgsHash: createSha256Hash(argsLines.join("\n")),
  };
}

/**
 * Unwrap MCP tool call result: prefer `structuredContent`, then JSON-parsed text content. Unknown
 * object is NOT treated as success; returns null when the shape does not carry structured data.
 */
export function unwrapPluginDryRunResult(raw: unknown): PluginDryRunResult | null {
  const structured = extractStructuredContent(raw);
  if (!isObject(structured)) return null;
  return structured as unknown as PluginDryRunResult;
}

function extractStructuredContent(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (isObject(record.structuredContent)) return record.structuredContent;
  if (isObject(record.result) && isObject((record.result as Record<string, unknown>).structuredContent)) {
    return (record.result as Record<string, unknown>).structuredContent;
  }
  if (Array.isArray(record.content)) {
    const text = record.content
      .map((item) => (isObject(item) && typeof (item as Record<string, unknown>).text === "string" ? (item as Record<string, unknown>).text as string : null))
      .find((value): value is string => typeof value === "string" && value.trim().length > 0);
    if (text) {
      try {
        const parsed = JSON.parse(text);
        if (isObject(parsed)) return parsed;
      } catch {
        return null;
      }
    }
  }
  if (isObject(raw)) return raw;
  return null;
}

export interface DryRunValidationContext {
  expectedToolName: string;
  expectedOperationKind: AssetMutationOperationKind;
  context: DryRunBindingContext;
  /**
   * The path-bearing operation used to derive the exact impact arrays. Callers may instead
   * provide both explicit expected arrays when validating a pre-normalized operation payload.
   */
  operation?: Pick<AssetMutationOperation, "kind" | "assetPathBefore" | "assetPathAfter">;
  expectedSandboxTargets?: string[];
  expectedReadOnlySources?: string[];
}

/**
 * Strict, fail-closed validation of the plugin dry-run structured result. Every required field
 * must be present and match; any missing/mismatch/blocked/error short-circuits to a binding failure.
 */
export function validatePluginDryRunResult(
  result: PluginDryRunResult | null,
  ctx: DryRunValidationContext,
): DryRunBindingSuccess | DryRunBindingFailure {
  if (!result) return { ok: false, reason: "mcp_dry_run_transport_failed" };
  if (result.blocked === true) {
    return { ok: false, reason: `mcp_dry_run_blocked:${result.reasonCode ?? "unknown"}` };
  }
  if (result.blocked !== false) return { ok: false, reason: "mcp_dry_run_contract_mismatch:blocked" };
  const expectedOp = PLUGIN_OPERATION_KIND[ctx.expectedOperationKind] ?? null;
  const explicitExpectedPaths = Array.isArray(ctx.expectedSandboxTargets) && Array.isArray(ctx.expectedReadOnlySources);
  if (!ctx.operation && !explicitExpectedPaths) {
    return { ok: false, reason: "mcp_dry_run_contract_mismatch:expected_paths" };
  }
  if (ctx.operation && !hasRequiredImpactPaths(ctx.operation)) {
    return { ok: false, reason: "mcp_dry_run_contract_mismatch:expected_paths" };
  }
  const expectedTargets = ctx.expectedSandboxTargets ?? expectedSandboxTargets(ctx.operation!);
  const expectedSources = ctx.expectedReadOnlySources ?? expectedReadOnlySources(ctx.operation!);

  const checks: Array<[boolean, string]> = [
    [result.status === "dry_run_completed", "status"],
    [result.toolName === ctx.expectedToolName, "toolName"],
    [expectedOp !== null && result.operation === expectedOp, "operation"],
    [result.changeSetId === ctx.context.changeSetId, "changeSetId"],
    [result.runId === ctx.context.runId, "runId"],
    [result.sandboxRoot === `${SANDBOX_ROOT}/${ctx.context.runId}`, "sandboxRoot"],
    [result.wouldChange === true, "wouldChange"],
    [arraysExactlyEqual(result.wouldModify, expectedTargets), "wouldModify"],
    [arraysExactlyEqual(result.wouldRead, expectedSources), "wouldRead"],
    [isObject(result.affectedAssets), "affectedAssets"],
    [arraysExactlyEqual(result.affectedAssets?.sandboxTargets, expectedTargets), "affectedAssets.sandboxTargets"],
    [arraysExactlyEqual(result.affectedAssets?.readOnlySources, expectedSources), "affectedAssets.readOnlySources"],
    [arraysExactlyEqual(result.affectedAssets?.externalTargets, []), "affectedAssets.externalTargets"],
    [result.rollbackPlan?.executionEnabled === false, "rollbackPlan.executionEnabled"],
    [Array.isArray(result.externalEvidenceQueries) && result.externalEvidenceQueries.length > 0, "externalEvidenceQueries"],
    [Array.isArray(result.externalEvidenceQueries) && result.externalEvidenceQueries.every((q) => q.readOnly === true), "externalEvidenceQueries.readOnly"],
    [typeof result.dryRunHash === "string" && SHA1_HEX_RE.test(result.dryRunHash), "dryRunHash"],
    [result.hashAlgorithm === "sha1", "hashAlgorithm"],
    [result.schemaVersion === "mvp15c.dry-run.v1", "schemaVersion"],
    [result.approvalRequired === true, "approvalRequired"],
    [result.implementationStatus === "execution_capable", "implementationStatus"],
  ];
  for (const [passed, field] of checks) {
    if (!passed) return { ok: false, reason: `mcp_dry_run_contract_mismatch:${field}` };
  }

  return {
    ok: true,
    provenance: {
      exactToolName: ctx.expectedToolName,
      dryRunHash: result.dryRunHash,
      dryRunHashSource: PLUGIN_DRY_RUN_HASH_SOURCE,
      dryRunHashAlgorithm: PLUGIN_DRY_RUN_HASH_ALGORITHM,
      dryRunSchemaVersion: PLUGIN_DRY_RUN_SCHEMA_VERSION,
      argsHash: "", // set by caller using computeArgsHash
    },
    pluginResult: result,
  };
}

/** Wait/read sandbox target paths a binding operation expects to be modified. */
export function expectedSandboxTargets(op: { assetPathBefore: string | null; assetPathAfter: string | null; kind: AssetMutationOperationKind }): string[] {
  switch (op.kind) {
    case "rename_asset":
    case "move_asset":
      return op.assetPathBefore && op.assetPathAfter ? [op.assetPathBefore, op.assetPathAfter] : [];
    case "delete_sandbox_asset":
      return op.assetPathBefore ? [op.assetPathBefore] : [];
    case "create_folder":
    case "duplicate_asset":
    case "create_test_asset":
      return op.assetPathAfter ? [op.assetPathAfter] : [];
    case "save_single_asset": {
      const assetPath = op.assetPathAfter ?? op.assetPathBefore;
      return assetPath ? [assetPath] : [];
    }
    default:
      return [];
  }
}

/** Read-only sources: only the duplicate source asset, otherwise empty. */
export function expectedReadOnlySources(op: { assetPathBefore: string | null; assetPathAfter: string | null; kind: AssetMutationOperationKind }): string[] {
  if (op.kind === "duplicate_asset" && op.assetPathBefore) return [op.assetPathBefore];
  return [];
}

function hasRequiredImpactPaths(op: { assetPathBefore: string | null; assetPathAfter: string | null; kind: AssetMutationOperationKind }): boolean {
  switch (op.kind) {
    case "rename_asset":
    case "move_asset":
    case "duplicate_asset":
      return Boolean(op.assetPathBefore && op.assetPathAfter);
    case "delete_sandbox_asset":
      return Boolean(op.assetPathBefore);
    case "create_folder":
    case "create_test_asset":
      return Boolean(op.assetPathAfter);
    case "save_single_asset":
      return Boolean(op.assetPathAfter ?? op.assetPathBefore);
    default:
      return false;
  }
}

/** Generate a safe ChangeSet Id matching the plugin `^[A-Za-z0-9_-]+$` contract. */
export function createSafeChangeSetId(seed: string): string {
  const sanitized = seed.replace(/[^A-Za-z0-9_-]/g, "-");
  const digest = createSha256Hash(seed).slice(0, 12);
  const base = `asset-changeset-${sanitized || "dry"}-${digest}`;
  if (SAFE_CHANGESET_ID_RE.test(base)) return base;
  // Fallback: deterministic and unconditionally safe.
  return `asset-changeset-${digest}`;
}

export function assertSafeChangeSetId(id: string): boolean {
  return SAFE_CHANGESET_ID_RE.test(id);
}

export function assertSafeRunId(id: string): boolean {
  return SAFE_RUN_ID_RE.test(id);
}

/** Map a validated binding result onto an operation provenance, filling the argsHash. */
export function buildOperationProvenance(
  binding: DryRunBindingSuccess,
  argsHash: string,
): AssetMutationOperationProvenance {
  return {
    exactToolName: binding.provenance.exactToolName,
    dryRunHash: binding.provenance.dryRunHash,
    dryRunHashSource: PLUGIN_DRY_RUN_HASH_SOURCE,
    dryRunHashAlgorithm: PLUGIN_DRY_RUN_HASH_ALGORITHM,
    dryRunSchemaVersion: PLUGIN_DRY_RUN_SCHEMA_VERSION,
    argsHash,
  };
}

/** Convert a runtime ChangeSet operation list into the canonical aggregate binding operation form. */
export function toAggregateBindingOperation(op: AssetMutationOperation): ExternalBindingOperation | null {
  if (!op.provenance) return null;
  return {
    operationId: op.id,
    kind: op.kind,
    exactToolName: op.provenance.exactToolName,
    assetPathBefore: op.assetPathBefore,
    assetPathAfter: op.assetPathAfter,
    normalizedArgsHash: op.provenance.argsHash,
    pluginDryRunHash: op.provenance.dryRunHash,
    pluginHashAlgorithm: op.provenance.dryRunHashAlgorithm,
    pluginSchemaVersion: op.provenance.dryRunSchemaVersion,
  };
}

export function computeAggregateBindingForOperations(
  ops: AssetMutationOperation[],
  ctx: DryRunBindingContext,
): { aggregateDryRunHash: string; aggregateArgsHash: string; complete: boolean } {
  const bindingOps: ExternalBindingOperation[] = [];
  let complete = true;
  for (const op of ops) {
    const binding = toAggregateBindingOperation(op);
    if (!binding) {
      complete = false;
      continue;
    }
    bindingOps.push(binding);
  }
  const hashes = computeAggregateBindingHash(bindingOps, ctx);
  return { ...hashes, complete };
}

/**
 * Stale-async guard marker. Callers compute this per active request; a late response whose
 * active-token no longer matches the current active ChangeSet must be discarded.
 */
export function computeActiveRequestToken(changeSetId: string, runId: string, generation: number): string {
  return createSha256Hash(`active-binding:${changeSetId}:${runId}:${generation}`);
}

/** Binding state machine helper: whether a ChangeSet is eligible for real approval. */
export function isExternalBindingApprovable(status: AssetExternalBindingStatus | undefined): boolean {
  return status === "external_bound";
}

let _currentGeneration = 0;

/** Monotonic generation counter to guard against stale async dry-run responses overwriting newer requests. */
export function nextBindingGeneration(): number {
  _currentGeneration += 1;
  return _currentGeneration;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function arraysExactlyEqual(value: unknown, expected: string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((item, index) => typeof item === "string" && item === expected[index]);
}
