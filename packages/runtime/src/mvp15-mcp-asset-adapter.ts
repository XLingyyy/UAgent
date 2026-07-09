import type { AssetMutationOperation } from "@uagent/shared";
import type { AssetMutationAdapter, AssetMutationAdapterContext, AssetMutationAdapterResult } from "./mvp15-asset-changeset.js";

export const MVP15_ASSET_TOOL_ALLOWLIST = [
  "ue.asset.create_folder",
  "ue.asset.duplicate",
  "ue.asset.rename",
  "ue.asset.move",
  "ue.asset.delete",
  "ue.asset.save",
] as const;

export type Mvp15McpAssetToolName = (typeof MVP15_ASSET_TOOL_ALLOWLIST)[number];
export type Mvp15McpAssetDecision = "blocked" | "dry_run_required";

export interface Mvp15McpAssetToolInput {
  toolName: string;
  inputSchema: unknown;
  dryRunSchema: unknown;
  args?: Record<string, unknown>;
}

export interface Mvp15McpAssetToolDescriptor {
  name: string;
  inputSchema?: unknown;
  dryRunSchema?: unknown;
  annotations?: Record<string, unknown>;
}

export interface Mvp15McpAssetToolDecision {
  toolName: string;
  allowlisted: boolean;
  decision: Mvp15McpAssetDecision;
  reason: string;
  affectedAssets: string[];
  sandboxOnly: true;
  rollbackPlanRequired: true;
}

export interface Mvp15McpAssetToolInventory {
  status: "ready" | "blocked_by_mcp_schema";
  availableTools: Mvp15McpAssetToolName[];
  missingTools: Mvp15McpAssetToolName[];
  missingSchemas: Mvp15McpAssetToolName[];
  missingDryRunSchemas: Mvp15McpAssetToolName[];
  decisions: Mvp15McpAssetToolDecision[];
}

export interface Mvp15NativeAssetGuardInput {
  toolName: Mvp15McpAssetToolName;
  assetPath?: string | null;
  targetAssetPath?: string | null;
  dryRunHash: string;
  approvalToken: string | null;
  editorSessionId: string;
  pidHash: string;
  assetMutationGateEnabled: boolean;
  observedEditorSessionId: string | null;
  observedPidHash: string | null;
  phase: "execute" | "rollback";
}

export interface Mvp15NativeAssetGuardResult {
  status: "accepted_by_native_guard" | "blocked" | "failed";
  reason: string | null;
  evidenceId?: string | null;
}

export interface Mvp15McpAssetToolCallResult {
  ok?: boolean;
  status?: string | null;
  reason?: string | null;
  evidenceId?: string | null;
}

export interface Mvp15McpAssetMutationAdapterOptions {
  tools: readonly Mvp15McpAssetToolDescriptor[];
  assetMutationGateEnabled: boolean;
  observedEditorSessionId: string | null;
  observedPidHash: string | null;
  nativeGuard: (input: Mvp15NativeAssetGuardInput) => Mvp15NativeAssetGuardResult | Promise<Mvp15NativeAssetGuardResult>;
  callTool: (toolName: Mvp15McpAssetToolName, args: Record<string, unknown>) => Mvp15McpAssetToolCallResult | Promise<Mvp15McpAssetToolCallResult | unknown>;
}

export function classifyMvp15McpAssetTool(input: Mvp15McpAssetToolInput): Mvp15McpAssetToolDecision {
  const allowlisted = MVP15_ASSET_TOOL_ALLOWLIST.includes(input.toolName as (typeof MVP15_ASSET_TOOL_ALLOWLIST)[number]);
  const affectedAssetArgs = collectAffectedAssetArgs(input.args ?? {});
  const affectedAssets = affectedAssetArgs.map((asset) => asset.path);
  if (!allowlisted) return decision(input, false, "blocked", "not_allowlisted", affectedAssets);
  if (!input.inputSchema || typeof input.inputSchema !== "object") return decision(input, true, "blocked", "schema_required", affectedAssets);
  if (!input.dryRunSchema || typeof input.dryRunSchema !== "object") return decision(input, true, "blocked", "dry_run_required", affectedAssets);
  const hasUnsafeAsset = affectedAssetArgs.some((asset) => {
    if (isSandboxAssetPath(asset.path)) return false;
    return input.toolName !== "ue.asset.duplicate" || !isDuplicateSourceArg(asset.key);
  });
  const duplicateTargetArgs = affectedAssetArgs.filter((asset) => input.toolName === "ue.asset.duplicate" && isDuplicateTargetArg(asset.key));
  const duplicateTargetCandidates = duplicateTargetArgs.length > 0 ? duplicateTargetArgs : affectedAssetArgs.filter((asset) => isSandboxAssetPath(asset.path));
  const hasSandboxDuplicateTarget = duplicateTargetCandidates.length > 0 && duplicateTargetCandidates.every((asset) => isSandboxAssetPath(asset.path));
  if (hasUnsafeAsset || (input.toolName === "ue.asset.duplicate" && !hasSandboxDuplicateTarget)) {
    return decision(input, true, "blocked", "sandbox_path_required", affectedAssets);
  }
  return decision(input, true, "dry_run_required", "exact_asset_allowlist", affectedAssets);
}

export function createMvp15McpAssetToolInventory(
  tools: readonly Mvp15McpAssetToolDescriptor[],
): Mvp15McpAssetToolInventory {
  const byName = new Map(tools.map((tool) => [tool.name, tool]));
  const availableTools: Mvp15McpAssetToolName[] = [];
  const missingTools: Mvp15McpAssetToolName[] = [];
  const missingSchemas: Mvp15McpAssetToolName[] = [];
  const missingDryRunSchemas: Mvp15McpAssetToolName[] = [];
  const decisions: Mvp15McpAssetToolDecision[] = [];

  for (const toolName of MVP15_ASSET_TOOL_ALLOWLIST) {
    const tool = byName.get(toolName);
    if (!tool) {
      missingTools.push(toolName);
      decisions.push(decision({ toolName, inputSchema: null, dryRunSchema: null }, true, "blocked", "missing_tool", []));
      continue;
    }
    const dryRunSchema = getDryRunSchema(tool);
    const toolDecision = classifyMvp15McpAssetTool({
      toolName,
      inputSchema: tool.inputSchema ?? null,
      dryRunSchema,
    });
    decisions.push(toolDecision);
    if (!tool.inputSchema || typeof tool.inputSchema !== "object") {
      missingSchemas.push(toolName);
      continue;
    }
    if (!dryRunSchema || typeof dryRunSchema !== "object") {
      missingDryRunSchemas.push(toolName);
      continue;
    }
    availableTools.push(toolName);
  }

  return {
    status: missingTools.length || missingSchemas.length || missingDryRunSchemas.length ? "blocked_by_mcp_schema" : "ready",
    availableTools,
    missingTools,
    missingSchemas,
    missingDryRunSchemas,
    decisions,
  };
}

export function createMvp15McpAssetMutationAdapter(
  options: Mvp15McpAssetMutationAdapterOptions,
): AssetMutationAdapter {
  const toolByName = new Map(options.tools.map((tool) => [tool.name, tool]));

  async function runTool(
    operation: AssetMutationOperation,
    context: AssetMutationAdapterContext,
    rollback = false,
  ): Promise<AssetMutationAdapterResult> {
    const call = rollback ? mapRollbackOperationToToolCall(operation, context) : mapOperationToToolCall(operation, context);
    if (!call.ok) return blockedResult(call.reason, operation.id);
    const tool = toolByName.get(call.toolName);
    if (!tool) return blockedResult(`blocked_by_mcp_schema:missing_tool:${call.toolName}`, operation.id);
    const dryRunSchema = getDryRunSchema(tool);
    const policy = classifyMvp15McpAssetTool({
      toolName: call.toolName,
      inputSchema: tool.inputSchema ?? null,
      dryRunSchema,
      args: call.args,
    });
    if (policy.decision === "blocked") {
      const prefix = policy.reason === "schema_required" || policy.reason === "dry_run_required" ? "blocked_by_mcp_schema" : "mcp_asset_policy_blocked";
      return blockedResult(`${prefix}:${policy.reason}:${call.toolName}`, operation.id);
    }

    const guard = await options.nativeGuard({
      toolName: call.toolName,
      assetPath: call.assetPath,
      targetAssetPath: call.targetAssetPath,
      dryRunHash: context.dryRunHash,
      approvalToken: context.approvalToken,
      editorSessionId: context.editorSessionId,
      pidHash: context.pidHash,
      assetMutationGateEnabled: options.assetMutationGateEnabled,
      observedEditorSessionId: options.observedEditorSessionId,
      observedPidHash: options.observedPidHash,
      phase: rollback ? "rollback" : "execute",
    });
    if (guard.status !== "accepted_by_native_guard") {
      return blockedResult(`native_guard_${guard.reason ?? "blocked"}`, operation.id, guard.evidenceId ?? undefined);
    }

    try {
      const raw = await options.callTool(call.toolName, call.args);
      const normalized = normalizeToolResult(raw, operation.id);
      if (!normalized.ok) return normalized;
      return {
        ok: true,
        reason: null,
        evidenceId: normalized.evidenceId || guard.evidenceId || `asset-evidence:mcp:${operation.id}`,
      };
    } catch (error) {
      return blockedResult(error instanceof Error ? `mcp_call_failed:${error.message}` : "mcp_call_failed", operation.id);
    }
  }

  return {
    execute: (operation, context) => runTool(operation, context),
    rollback: (operation, context) => runTool(operation, context, true),
  };
}

function getDryRunSchema(tool: Mvp15McpAssetToolDescriptor): unknown {
  if (tool.dryRunSchema) return tool.dryRunSchema;
  const annotationSchema = tool.annotations?.dryRunSchema ?? tool.annotations?.dry_run_schema;
  if (annotationSchema) return annotationSchema;
  if (tool.annotations?.dryRunSupported === true || tool.annotations?.supportsDryRun === true) return tool.inputSchema;
  return null;
}

function blockedResult(reason: string, operationId: string, evidenceId?: string): AssetMutationAdapterResult {
  return {
    ok: false,
    reason,
    evidenceId: evidenceId ?? `asset-evidence:block:${operationId}`,
    stateOnFailure: reason.startsWith("blocked_by_mcp_schema:") || reason.startsWith("native_guard_") ? "failed" : undefined,
  };
}

function normalizeToolResult(raw: unknown, operationId: string): AssetMutationAdapterResult {
  if (!raw || typeof raw !== "object") {
    return { ok: true, reason: null, evidenceId: `asset-evidence:mcp:${operationId}` };
  }
  const result = raw as Mvp15McpAssetToolCallResult;
  const status = typeof result.status === "string" ? result.status : null;
  const ok = result.ok !== false && status !== "blocked" && status !== "failed" && status !== "error";
  return {
    ok,
    reason: ok ? null : result.reason ?? status ?? "mcp_tool_failed",
    evidenceId: result.evidenceId ?? `asset-evidence:mcp:${operationId}`,
    stateOnFailure: ok ? undefined : "rollback_available",
  };
}

type ToolCallPlan =
  | {
      ok: true;
      toolName: Mvp15McpAssetToolName;
      args: Record<string, unknown>;
      assetPath: string | null;
      targetAssetPath: string | null;
    }
  | { ok: false; reason: string };

function mapOperationToToolCall(operation: AssetMutationOperation, context: AssetMutationAdapterContext): ToolCallPlan {
  const common = { changeSetId: context.changeSet.id, dryRunHash: context.dryRunHash, execute: true };
  if (operation.kind === "create_folder") {
    return planned("ue.asset.create_folder", { ...common, folderPath: operation.assetPathAfter }, operation.assetPathAfter, null);
  }
  if (operation.kind === "duplicate_asset") {
    return planned("ue.asset.duplicate", { ...common, sourceAssetPath: operation.assetPathBefore, targetAssetPath: operation.assetPathAfter }, operation.assetPathBefore, operation.assetPathAfter);
  }
  if (operation.kind === "rename_asset") {
    return planned("ue.asset.rename", { ...common, assetPath: operation.assetPathBefore, targetAssetPath: operation.assetPathAfter }, operation.assetPathBefore, operation.assetPathAfter);
  }
  if (operation.kind === "move_asset") {
    return planned("ue.asset.move", { ...common, assetPath: operation.assetPathBefore, targetAssetPath: operation.assetPathAfter }, operation.assetPathBefore, operation.assetPathAfter);
  }
  if (operation.kind === "save_single_asset") {
    return planned("ue.asset.save", { ...common, assetPath: operation.assetPathAfter ?? operation.assetPathBefore, saveAll: false }, operation.assetPathAfter ?? operation.assetPathBefore, null);
  }
  if (operation.kind === "delete_sandbox_asset") {
    return planned("ue.asset.delete", { ...common, assetPath: operation.assetPathBefore }, operation.assetPathBefore, null);
  }
  return { ok: false, reason: `mcp_asset_policy_blocked:unsupported_operation:${operation.kind}` };
}

function mapRollbackOperationToToolCall(operation: AssetMutationOperation, context: AssetMutationAdapterContext): ToolCallPlan {
  const common = { changeSetId: context.changeSet.id, dryRunHash: context.dryRunHash, rollback: true };
  if (operation.kind === "create_folder" || operation.kind === "duplicate_asset" || operation.kind === "create_test_asset") {
    return planned("ue.asset.delete", { ...common, assetPath: operation.assetPathAfter }, operation.assetPathAfter, null);
  }
  if (operation.kind === "rename_asset") {
    return planned("ue.asset.rename", { ...common, assetPath: operation.assetPathAfter, targetAssetPath: operation.assetPathBefore }, operation.assetPathAfter, operation.assetPathBefore);
  }
  if (operation.kind === "move_asset") {
    return planned("ue.asset.move", { ...common, assetPath: operation.assetPathAfter, targetAssetPath: operation.assetPathBefore }, operation.assetPathAfter, operation.assetPathBefore);
  }
  if (operation.kind === "save_single_asset") {
    return {
      ok: true,
      toolName: "ue.asset.save",
      args: { ...common, assetPath: operation.assetPathAfter ?? operation.assetPathBefore, saveAll: false },
      assetPath: operation.assetPathAfter ?? operation.assetPathBefore,
      targetAssetPath: null,
    };
  }
  return { ok: false, reason: `mcp_asset_policy_blocked:rollback_unsupported:${operation.kind}` };
}

function planned(
  toolName: Mvp15McpAssetToolName,
  args: Record<string, unknown>,
  assetPath: string | null | undefined,
  targetAssetPath: string | null | undefined,
): ToolCallPlan {
  if (Object.values(args).some((value) => value === null || value === undefined || value === "")) {
    return { ok: false, reason: `mcp_asset_policy_blocked:missing_tool_argument:${toolName}` };
  }
  return {
    ok: true,
    toolName,
    args,
    assetPath: assetPath ?? null,
    targetAssetPath: targetAssetPath ?? null,
  };
}

function decision(
  input: Mvp15McpAssetToolInput,
  allowlisted: boolean,
  decisionValue: Mvp15McpAssetDecision,
  reason: string,
  affectedAssets: string[],
): Mvp15McpAssetToolDecision {
  return {
    toolName: input.toolName,
    allowlisted,
    decision: decisionValue,
    reason,
    affectedAssets,
    sandboxOnly: true,
    rollbackPlanRequired: true,
  };
}

function collectAffectedAssetArgs(args: Record<string, unknown>): Array<{ key: string; path: string }> {
  return Object.entries(args)
    .filter(([key, value]) => /asset|path|target|destination/i.test(key) && typeof value === "string")
    .map(([key, value]) => ({ key, path: String(value).replace(/\\/g, "/") }));
}

function isSandboxAssetPath(assetPath: string): boolean {
  return assetPath.startsWith("/Game/UAgentSandbox/") || assetPath === "/Game/UAgentSandbox" || assetPath.startsWith("/Content/UAgentSandbox/") || assetPath === "/Content/UAgentSandbox";
}

function isDuplicateSourceArg(key: string): boolean {
  return /source|src|from|before/i.test(key);
}

function isDuplicateTargetArg(key: string): boolean {
  return /target|destination|dest|to|after/i.test(key);
}
