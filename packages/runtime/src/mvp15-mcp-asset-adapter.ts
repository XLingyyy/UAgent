import type {
  AssetMutationApprovalOperationBinding,
  AssetMutationApprovalRegistrationRequest,
  AssetMutationApprovalRegistrationResult,
  AssetMutationOperation,
  AssetMutationOperationGuardRequest,
  AssetMutationOperationGuardResult,
  AssetMutationOutcomeRequest,
  AssetMutationOutcomeResult,
  AssetMutationPluginExecutionResult,
} from "@uagent/shared";
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
  rollbackContract?: unknown;
  affectedAssetsSchema?: unknown;
  evidenceQuery?: unknown;
  args?: Record<string, unknown>;
}

export interface Mvp15McpAssetToolDescriptorLike {
  name: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  dryRunSchema?: unknown;
  rollbackContract?: unknown;
  affectedAssetsSchema?: unknown;
  evidenceQuery?: unknown;
  annotations?: unknown;
  "x-uagent-contract"?: unknown;
}

export interface Mvp15McpAssetToolDescriptor {
  name: string;
  inputSchema?: unknown;
  outputSchema?: Record<string, unknown>;
  dryRunSchema?: unknown;
  rollbackContract?: unknown;
  affectedAssetsSchema?: unknown;
  evidenceQuery?: unknown;
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
  rollbackContractRequired: true;
  externalEvidenceRequired: true;
}

export interface Mvp15McpAssetToolInventory {
  status: "ready" | "blocked_by_mcp_schema";
  availableTools: Mvp15McpAssetToolName[];
  missingTools: Mvp15McpAssetToolName[];
  missingSchemas: Mvp15McpAssetToolName[];
  missingDryRunSchemas: Mvp15McpAssetToolName[];
  missingRollbackContracts: Mvp15McpAssetToolName[];
  missingEvidenceQueries: Mvp15McpAssetToolName[];
  decisions: Mvp15McpAssetToolDecision[];
}

export type Mvp15NativeAssetGuardInput =
  | ({ command: "register"; phase: "register" } & AssetMutationApprovalRegistrationRequest)
  | {
    command: "cancel_registration";
    phase: "cancel";
    registrationId: string;
    approvalToken: string;
  }
  | ({ command: "guard" } & AssetMutationOperationGuardRequest)
  | ({ command: "record_outcome"; operationIndex: number } & AssetMutationOutcomeRequest);

export type Mvp15NativeAssetGuardResult =
  | AssetMutationApprovalRegistrationResult
  | {
    status: "cancelled" | "blocked" | "failed";
    reason: string | null;
    registrationId?: string | null;
  }
  | AssetMutationOperationGuardResult
  | AssetMutationOutcomeResult;

export interface Mvp15McpAssetToolCallResult {
  ok?: boolean;
  status?: string | null;
  reason?: string | null;
  evidenceId?: string | null;
  structuredContent?: unknown;
}

export interface Mvp15McpAssetMutationAdapterOptions {
  tools: readonly Mvp15McpAssetToolDescriptorLike[];
  /** Renderer-side tightening only. Native independently owns the feature authority gate. */
  assetMutationGateEnabled: boolean;
  /** Captures the desktop-owned MCP session/connection/endpoint identity. */
  captureMcpBinding: () => string | null;
  /** Revalidates the captured desktop-owned identity immediately before an MCP call. */
  isMcpBindingCurrent: (binding: string) => boolean;
  nativeGuard: (input: Mvp15NativeAssetGuardInput) => Mvp15NativeAssetGuardResult | Promise<Mvp15NativeAssetGuardResult>;
  callTool: (toolName: Mvp15McpAssetToolName, args: Record<string, unknown>) => Mvp15McpAssetToolCallResult | Promise<Mvp15McpAssetToolCallResult | unknown>;
}

export function classifyMvp15McpAssetTool(input: Mvp15McpAssetToolInput): Mvp15McpAssetToolDecision {
  const allowlisted = MVP15_ASSET_TOOL_ALLOWLIST.includes(input.toolName as (typeof MVP15_ASSET_TOOL_ALLOWLIST)[number]);
  const affectedAssetArgs = collectAffectedAssetArgs(input.args ?? {});
  const affectedAssets = affectedAssetArgs.map((asset) => asset.path);
  if (!allowlisted) return decision(input, false, "blocked", "not_allowlisted", affectedAssets);
  if (!isObjectRecord(input.inputSchema)) return decision(input, true, "blocked", "schema_required", affectedAssets);
  if (!isObjectRecord(input.dryRunSchema)) return decision(input, true, "blocked", "dry_run_required", affectedAssets);
  if (!isObjectRecord(input.rollbackContract)) return decision(input, true, "blocked", "rollback_contract_required", affectedAssets);
  if (
    !isObjectRecord(input.affectedAssetsSchema) ||
    !isObjectRecord(input.evidenceQuery)
  ) {
    return decision(input, true, "blocked", "external_evidence_required", affectedAssets);
  }
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

export function normalizeMvp15McpAssetToolDescriptor(
  tool: Mvp15McpAssetToolDescriptorLike,
): Mvp15McpAssetToolDescriptor {
  const descriptorContract = asObjectRecord(tool["x-uagent-contract"]);
  const outputSchema = asObjectRecord(tool.outputSchema);
  const outputContract = asObjectRecord(outputSchema?.["x-uagent-contract"]);
  const annotations = asObjectRecord(tool.annotations);
  const annotationContract = asObjectRecord(annotations?.["x-uagent-contract"]);
  const inputSchema = asObjectRecord(tool.inputSchema);
  const inputContract = asObjectRecord(inputSchema?.["x-uagent-contract"]);

  return {
    name: tool.name,
    inputSchema: tool.inputSchema,
    ...(outputSchema ? { outputSchema } : {}),
    dryRunSchema: firstDefined(
      tool.dryRunSchema,
      descriptorContract?.dryRunSchema,
      outputSchema?.dryRunSchema,
      outputContract?.dryRunSchema,
      annotations?.dryRunSchema,
      annotations?.dry_run_schema,
      annotationContract?.dryRunSchema,
      inputContract?.dryRunSchema,
    ),
    rollbackContract: firstDefined(
      tool.rollbackContract,
      descriptorContract?.rollbackContract,
      outputSchema?.rollbackContract,
      outputContract?.rollbackContract,
      annotations?.rollbackContract,
      annotations?.rollback_contract,
      annotationContract?.rollbackContract,
      inputContract?.rollbackContract,
    ),
    affectedAssetsSchema: firstDefined(
      tool.affectedAssetsSchema,
      descriptorContract?.affectedAssetsSchema,
      outputSchema?.affectedAssetsSchema,
      outputContract?.affectedAssetsSchema,
      annotations?.affectedAssetsSchema,
      annotations?.affected_assets_schema,
      annotationContract?.affectedAssetsSchema,
      inputContract?.affectedAssetsSchema,
    ),
    evidenceQuery: firstDefined(
      tool.evidenceQuery,
      descriptorContract?.evidenceQuery,
      outputSchema?.evidenceQuery,
      outputContract?.evidenceQuery,
      annotations?.evidenceQuery,
      annotations?.evidence_query,
      annotations?.externalEvidenceQuery,
      annotationContract?.evidenceQuery,
      inputContract?.evidenceQuery,
    ),
    ...(annotations ? { annotations } : {}),
  };
}

export function createMvp15McpAssetToolInventory(
  tools: readonly Mvp15McpAssetToolDescriptorLike[],
): Mvp15McpAssetToolInventory {
  const byName = new Map(tools.map(normalizeMvp15McpAssetToolDescriptor).map((tool) => [tool.name, tool]));
  const availableTools: Mvp15McpAssetToolName[] = [];
  const missingTools: Mvp15McpAssetToolName[] = [];
  const missingSchemas: Mvp15McpAssetToolName[] = [];
  const missingDryRunSchemas: Mvp15McpAssetToolName[] = [];
  const missingRollbackContracts: Mvp15McpAssetToolName[] = [];
  const missingEvidenceQueries: Mvp15McpAssetToolName[] = [];
  const decisions: Mvp15McpAssetToolDecision[] = [];

  for (const toolName of MVP15_ASSET_TOOL_ALLOWLIST) {
    const tool = byName.get(toolName);
    if (!tool) {
      missingTools.push(toolName);
      decisions.push(decision({ toolName, inputSchema: null, dryRunSchema: null }, true, "blocked", "missing_tool", []));
      continue;
    }
    const { dryRunSchema, rollbackContract, affectedAssetsSchema, evidenceQuery } = tool;
    const toolDecision = classifyMvp15McpAssetTool({
      toolName,
      inputSchema: tool.inputSchema ?? null,
      dryRunSchema,
      rollbackContract,
      affectedAssetsSchema,
      evidenceQuery,
    });
    decisions.push(toolDecision);
    if (!isObjectRecord(tool.inputSchema)) {
      missingSchemas.push(toolName);
      continue;
    }
    if (!isObjectRecord(dryRunSchema)) {
      missingDryRunSchemas.push(toolName);
      continue;
    }
    if (!isObjectRecord(rollbackContract)) {
      missingRollbackContracts.push(toolName);
      continue;
    }
    if (
      !isObjectRecord(affectedAssetsSchema) ||
      !isObjectRecord(evidenceQuery)
    ) {
      missingEvidenceQueries.push(toolName);
      continue;
    }
    availableTools.push(toolName);
  }

  return {
    status: missingTools.length || missingSchemas.length || missingDryRunSchemas.length || missingRollbackContracts.length || missingEvidenceQueries.length ? "blocked_by_mcp_schema" : "ready",
    availableTools,
    missingTools,
    missingSchemas,
    missingDryRunSchemas,
    missingRollbackContracts,
    missingEvidenceQueries,
    decisions,
  };
}

export function createMvp15McpAssetMutationAdapter(
  options: Mvp15McpAssetMutationAdapterOptions,
): AssetMutationAdapter {
  const toolByName = new Map(options.tools.map(normalizeMvp15McpAssetToolDescriptor).map((tool) => [tool.name, tool]));
  const registrations = new Map<string, { registrationId: string; operationCount: number; mcpBinding: string }>();

  async function cancelNativeRegistration(
    changeSetId: string,
    registrationId: string,
    approvalToken: string,
  ): Promise<AssetMutationAdapterResult> {
    let cancelled: Mvp15NativeAssetGuardResult;
    try {
      cancelled = await options.nativeGuard({
        command: "cancel_registration",
        phase: "cancel",
        registrationId,
        approvalToken,
      });
    } catch {
      return blockedResult("native_registration_cancel_failed", changeSetId);
    }
    if (
      cancelled.status !== "cancelled"
      || cancelled.registrationId !== registrationId
    ) {
      return blockedResult(nativeFailureReason("native_registration_cancel_", cancelled.reason), changeSetId);
    }
    registrations.delete(changeSetId);
    return {
      ok: true,
      reason: null,
      evidenceId: `asset-evidence:native-registration-cancelled:${registrationId}`,
    };
  }

  async function settleNoSideEffectFailure(
    registrationId: string,
    phase: "execute" | "rollback",
    operation: AssetMutationOperation,
    operationIndex: number,
    reasonCode: string,
  ): Promise<AssetMutationAdapterResult | null> {
    let outcome: Mvp15NativeAssetGuardResult;
    try {
      outcome = await options.nativeGuard({
        command: "record_outcome",
        operationIndex,
        registrationId,
        phase,
        operationId: operation.id,
        success: false,
        sideEffectObserved: false,
        rollbackAvailable: false,
        evidenceId: `asset-evidence:block:${operation.id}`,
        reasonCode,
      });
    } catch {
      return blockedResult("native_outcome_failed", operation.id);
    }
    if (
      outcome.status !== "recorded"
      || outcome.registrationId !== registrationId
      || outcome.phase !== phase
      || outcome.operationId !== operation.id
    ) {
      return blockedResult("native_outcome_failed", operation.id);
    }
    return null;
  }

  async function prepareExecute(context: AssetMutationAdapterContext): Promise<AssetMutationAdapterResult> {
    const { changeSet } = context;
    const approval = changeSet.approval;
    if (!approval) return blockedResult("approval_required", changeSet.id);
    if (!options.assetMutationGateEnabled) return blockedResult("ui_asset_mutation_gate_disabled", changeSet.id);
    if (!changeSet.aggregateDryRunHash || !changeSet.aggregateArgsHash) {
      return blockedResult("approval_aggregate_required", changeSet.id);
    }
    const mcpBinding = options.captureMcpBinding();
    if (!mcpBinding) return blockedResult("mcp_binding_unavailable", changeSet.id);
    const inventory = createMvp15McpAssetToolInventory(options.tools);
    if (inventory.status !== "ready") return blockedResult("blocked_by_mcp_schema:inventory_not_ready", changeSet.id);
    const operations: AssetMutationApprovalOperationBinding[] = [];
    for (const operation of changeSet.operations) {
      const binding = toNativeApprovalOperation(operation);
      if (!binding) return blockedResult("native_registration_operation_invalid", operation.id);
      operations.push(binding);
    }
    let result: Mvp15NativeAssetGuardResult;
    try {
      result = await options.nativeGuard({
        command: "register",
        phase: "register",
        changeSetId: changeSet.id,
        runId: changeSet.runId,
        projectBindingId: changeSet.projectId,
        trustedRootRef: changeSet.trustedRootId,
        editorSessionId: changeSet.editorSessionId,
        aggregateDryRunHash: changeSet.aggregateDryRunHash,
        aggregateArgsHash: changeSet.aggregateArgsHash,
        requestedTtlMs: approval.expiresAt - approval.issuedAt,
        operations,
      });
    } catch {
      return blockedResult("native_registration_failed", changeSet.id);
    }
    if (
      result.status !== "registered"
      || typeof result.registrationId !== "string"
      || !result.registrationId
      || result.operationCount !== operations.length
      || typeof result.approvalToken !== "string"
      || !/^[0-9a-f]{64}$/.test(result.approvalToken)
      || !Number.isSafeInteger(result.issuedAt)
      || !Number.isSafeInteger(result.expiresAt)
    ) {
      if (
        result.status === "registered"
        && typeof result.registrationId === "string"
        && result.registrationId
        && typeof result.approvalToken === "string"
        && /^[0-9a-f]{64}$/.test(result.approvalToken)
      ) {
        const cancellation = await cancelNativeRegistration(
          changeSet.id,
          result.registrationId,
          result.approvalToken,
        );
        if (!cancellation.ok) return cancellation;
      }
      return blockedResult(nativeFailureReason("native_registration_", result.reason), changeSet.id);
    }
    if (!options.isMcpBindingCurrent(mcpBinding)) {
      const cancellation = await cancelNativeRegistration(
        changeSet.id,
        result.registrationId,
        result.approvalToken,
      );
      return cancellation.ok
        ? blockedResult("mcp_binding_changed", changeSet.id)
        : cancellation;
    }
    registrations.set(changeSet.id, {
      registrationId: result.registrationId,
      operationCount: operations.length,
      mcpBinding,
    });
    return {
      ok: true,
      reason: null,
      evidenceId: `asset-evidence:native-registration:${result.registrationId}`,
      externalRegistration: {
        registrationId: result.registrationId,
      },
      issuedApprovalToken: result.approvalToken,
      issuedAt: result.issuedAt,
      expiresAt: result.expiresAt,
    };
  }

  async function runTool(
    operation: AssetMutationOperation,
    context: AssetMutationAdapterContext,
    rollback = false,
  ): Promise<AssetMutationAdapterResult> {
    const call = rollback ? mapRollbackOperationToToolCall(operation, context) : mapOperationToToolCall(operation, context);
    if (!call.ok) return blockedResult(call.reason, operation.id);
    const tool = toolByName.get(call.toolName);
    if (!tool) return blockedResult(`blocked_by_mcp_schema:missing_tool:${call.toolName}`, operation.id);
    const { dryRunSchema, rollbackContract, affectedAssetsSchema, evidenceQuery } = tool;
    const policy = classifyMvp15McpAssetTool({
      toolName: call.toolName,
      inputSchema: tool.inputSchema ?? null,
      dryRunSchema,
      rollbackContract,
      affectedAssetsSchema,
      evidenceQuery,
      args: call.args,
    });
    if (policy.decision === "blocked") {
      const prefix = ["schema_required", "dry_run_required", "rollback_contract_required", "external_evidence_required"].includes(policy.reason)
        ? "blocked_by_mcp_schema"
        : "mcp_asset_policy_blocked";
      return blockedResult(`${prefix}:${policy.reason}:${call.toolName}`, operation.id);
    }

    const registration = registrations.get(context.changeSet.id);
    const guardOperation = rollback ? toNativeRollbackOperation(operation) : toNativeApprovalOperation(operation);
    if (!registration || !guardOperation) return blockedResult(rollback ? "native_rollback_registration_required" : "native_execute_registration_required", operation.id);
    let guard: Mvp15NativeAssetGuardResult;
    try {
      guard = await options.nativeGuard({
          command: "guard",
          registrationId: registration.registrationId,
          approvalToken: rollback ? null : context.operationIndex === 0 ? context.approvalToken : null,
          phase: rollback ? "rollback" : "execute",
          operationIndex: context.operationIndex,
          operationCount: context.operationCount,
          changeSetId: context.changeSet.id,
          runId: context.changeSet.runId,
          projectBindingId: context.changeSet.projectId,
          aggregateDryRunHash: context.changeSet.aggregateDryRunHash ?? "",
          aggregateArgsHash: context.changeSet.aggregateArgsHash ?? "",
          operation: guardOperation,
        });
    } catch {
      return blockedResult("native_guard_failed", operation.id);
    }
    if (guard.status !== "accepted_by_native_guard") {
      const evidenceId = "evidenceId" in guard ? guard.evidenceId ?? undefined : undefined;
      return blockedResult(nativeFailureReason("native_guard_", guard.reason, "blocked"), operation.id, evidenceId);
    }
    if (
      registration
      && guardOperation
      && (
        guard.registrationId !== registration.registrationId
        || guard.phase !== (rollback ? "rollback" : "execute")
        || guard.operationId !== operation.id
        || guard.operationIndex !== context.operationIndex
        || guard.operationCount !== context.operationCount
      )
    ) {
      const settlement = await settleNoSideEffectFailure(
        registration.registrationId,
        rollback ? "rollback" : "execute",
        operation,
        context.operationIndex,
        "native_guard_result_invalid",
      );
      return settlement ?? blockedResult("native_guard_result_invalid", operation.id);
    }
    if (!options.isMcpBindingCurrent(registration.mcpBinding)) {
      const settlement = await settleNoSideEffectFailure(
        registration.registrationId,
        rollback ? "rollback" : "execute",
        operation,
        context.operationIndex,
        "mcp_binding_changed",
      );
      return settlement ?? blockedResult("mcp_binding_changed", operation.id, guard.evidenceId ?? undefined);
    }

    let raw: unknown;
    try {
      raw = await options.callTool(call.toolName, call.args);
    } catch {
      if (registration && guardOperation) {
        const phase = rollback ? "rollback" : "execute";
        let failedOutcome: Mvp15NativeAssetGuardResult;
        try {
          failedOutcome = await options.nativeGuard({
            command: "record_outcome",
            operationIndex: context.operationIndex,
            registrationId: registration.registrationId,
            phase,
            operationId: operation.id,
            success: false,
            sideEffectObserved: false,
            rollbackAvailable: false,
            evidenceId: `asset-evidence:block:${operation.id}`,
            reasonCode: "mcp_call_failed",
          });
        } catch {
          return blockedResult("native_outcome_failed", operation.id);
        }
        if (
          failedOutcome.status !== "recorded"
          || failedOutcome.registrationId !== registration.registrationId
          || failedOutcome.phase !== phase
          || failedOutcome.operationId !== operation.id
        ) {
          return blockedResult(nativeFailureReason("native_outcome_", failedOutcome.reason), operation.id);
        }
      }
      return blockedResult("mcp_call_failed", operation.id);
    }
    const normalized = validateMvp15PluginExecutionResult(raw, operation, context, call);
    if (registration && guardOperation) {
      const phase = rollback ? "rollback" : "execute";
      let outcome: Mvp15NativeAssetGuardResult;
      try {
        outcome = await options.nativeGuard({
          command: "record_outcome",
          operationIndex: context.operationIndex,
          registrationId: registration.registrationId,
          phase,
          operationId: operation.id,
          success: normalized.ok,
          sideEffectObserved: normalized.sideEffectObserved === true,
          rollbackAvailable: normalized.rollbackAvailable === true,
          evidenceId: normalized.evidenceId,
          reasonCode: normalized.reason,
        });
      } catch {
        return blockedResult("native_outcome_failed", operation.id, normalized.evidenceId);
      }
      if (
        outcome.status !== "recorded"
        || outcome.registrationId !== registration.registrationId
        || outcome.phase !== phase
        || outcome.operationId !== operation.id
      ) {
        return blockedResult(nativeFailureReason("native_outcome_", outcome.reason), operation.id, normalized.evidenceId);
      }
    }
    if (!normalized.ok) return normalized;
    return {
      ok: true,
      reason: null,
      evidenceId: normalized.evidenceId || guard.evidenceId || `asset-evidence:mcp:${operation.id}`,
    };
  }

  return {
    prepareExecute,
    cancelPreparedRegistration: async (context, prepared) => {
      const registrationId = prepared.externalRegistration?.registrationId;
      const approvalToken = prepared.issuedApprovalToken;
      if (!registrationId || !approvalToken) {
        return blockedResult("native_registration_cancel_binding_required", "registration");
      }
      return cancelNativeRegistration(context.changeSet.id, registrationId, approvalToken);
    },
    execute: (operation, context) => runTool(operation, context),
    rollback: (operation, context) => runTool(operation, context, true),
  };
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined);
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return isObjectRecord(value) ? value : null;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function blockedResult(reason: string, operationId: string, evidenceId?: string): AssetMutationAdapterResult {
  return {
    ok: false,
    reason,
    evidenceId: isSafeOpaqueIdentifier(evidenceId) ? evidenceId : `asset-evidence:block:${operationId}`,
    stateOnFailure: "failed",
    sideEffectObserved: false,
    rollbackAvailable: false,
  };
}

function nativeFailureReason(prefix: string, reason: unknown, fallback = "invalid_result"): string {
  return typeof reason === "string" && /^[a-z0-9_:-]+$/.test(reason)
    ? `${prefix}${reason}`
    : `${prefix}${fallback}`;
}

function isSafeOpaqueIdentifier(value: unknown): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && /^[A-Za-z0-9:._-]+$/.test(value);
}

export function validateMvp15PluginExecutionResult(
  raw: unknown,
  operation: AssetMutationOperation,
  context: AssetMutationAdapterContext,
  call: Extract<ToolCallPlan, { ok: true }>,
): AssetMutationAdapterResult {
  const structured = extractStrictStructuredContent(raw);
  if (!structured || containsSensitiveExecutionField(structured)) {
    return invalidToolResult(operation.id);
  }
  const result = structured as unknown as AssetMutationPluginExecutionResult;
  const allowedTopLevelKeys = new Set([
    "blocked", "status", "reasonCode", "toolName", "operation", "phase", "changeSetId", "runId",
    "sandboxRoot", "wouldChange", "wouldModify", "wouldRead", "affectedAssets", "rollbackPlan",
    "externalEvidenceQueries", "dryRunHash", "hashAlgorithm", "schemaVersion", "approvalRequired",
    "evidenceId", "sideEffectObserved", "rollbackAvailable", "rollbackStatus", "implementationStatus",
  ]);
  const expectedOperation = pluginOperationForKind(operation.kind);
  const expectedModify = expectedModifiedPaths(operation);
  const expectedRead = operation.kind === "duplicate_asset" && operation.assetPathBefore ? [operation.assetPathBefore] : [];
  const rollback = call.args.rollback === true;
  const rollbackAvailable = rollback ? false : operation.kind !== "save_single_asset";
  const expectedEvidencePaths = [...expectedRead, ...expectedModify];
  const commonChecks = [
    hasOnlyKeys(structured, allowedTopLevelKeys),
    typeof result.blocked === "boolean",
    typeof result.status === "string" && result.status.length > 0,
    typeof result.reasonCode === "string" && result.reasonCode.length > 0,
    result.toolName === call.toolName,
    result.operation === expectedOperation,
    result.phase === (rollback ? "rollback" : "execute"),
    result.changeSetId === context.changeSet.id,
    result.runId === context.changeSet.runId,
    result.sandboxRoot === `/Game/UAgentSandbox/${context.changeSet.runId}`,
    typeof result.sideEffectObserved === "boolean",
    typeof result.wouldChange === "boolean",
    Array.isArray(result.wouldModify),
    Array.isArray(result.wouldRead),
    isObjectRecord(result.affectedAssets),
    hasOnlyKeys(result.affectedAssets, new Set(["readOnlySources", "sandboxTargets", "externalTargets"])),
    isObjectRecord(result.rollbackPlan),
    hasOnlyKeys(result.rollbackPlan, new Set(["strategy", "inverseOperation", "executionEnabled"])),
    typeof result.rollbackPlan?.strategy === "string" && result.rollbackPlan.strategy.length > 0,
    typeof result.rollbackPlan?.executionEnabled === "boolean",
    typeof result.rollbackPlan?.inverseOperation === "string" && result.rollbackPlan.inverseOperation.length > 0,
    Array.isArray(result.externalEvidenceQueries) && result.externalEvidenceQueries.length === 1,
    Array.isArray(result.externalEvidenceQueries) && result.externalEvidenceQueries.every((query) => (
      isObjectRecord(query)
      && hasOnlyKeys(query, new Set(["queryKind", "readOnly", "paths"]))
      && query.readOnly === true
      && query.queryKind === "asset_registry_snapshot"
      && Array.isArray(query.paths)
    )),
    result.dryRunHash === context.dryRunHash && /^[0-9a-f]{40}$/.test(result.dryRunHash),
    result.hashAlgorithm === "sha1",
    result.schemaVersion === "mvp15c.dry-run.v1",
    result.approvalRequired === true,
    typeof result.evidenceId === "string" && result.evidenceId.trim().length > 0,
    typeof result.rollbackAvailable === "boolean",
    typeof result.rollbackStatus === "string" && result.rollbackStatus.length > 0,
    result.implementationStatus === "execution_capable",
  ];
  if (commonChecks.some((passed) => !passed)) return invalidToolResult(operation.id);

  const impactsMatch = stringArraysEqual(result.wouldModify, expectedModify)
    && stringArraysEqual(result.wouldRead, expectedRead)
    && stringArraysEqual(result.affectedAssets.sandboxTargets, expectedModify)
    && stringArraysEqual(result.affectedAssets.readOnlySources, expectedRead)
    && stringArraysEqual(result.affectedAssets.externalTargets, [])
    && result.externalEvidenceQueries.every((query) => stringArraysEqual(query.paths, expectedEvidencePaths));
  const impactsAreEmpty = stringArraysEqual(result.wouldModify, [])
    && stringArraysEqual(result.wouldRead, [])
    && stringArraysEqual(result.affectedAssets.sandboxTargets, [])
    && stringArraysEqual(result.affectedAssets.readOnlySources, [])
    && stringArraysEqual(result.affectedAssets.externalTargets, [])
    && result.externalEvidenceQueries.every((query) => stringArraysEqual(query.paths, []));
  const successShape = result.blocked === false
    && result.status === (rollback ? "rolled_back" : "executed")
    && result.reasonCode === "none"
    && result.sideEffectObserved === true
    && result.wouldChange === true
    && impactsMatch
    && result.rollbackAvailable === rollbackAvailable
    && result.rollbackPlan.executionEnabled === rollbackAvailable
    && result.rollbackStatus === (rollback ? "completed" : rollbackAvailable ? "available" : "none");
  const partialFailureShape = !rollback
    && rollbackAvailable
    && result.blocked === true
    && result.status === "partial_failure"
    && result.reasonCode !== "none"
    && result.sideEffectObserved === true
    && result.wouldChange === true
    && impactsMatch
    && result.rollbackAvailable === true
    && result.rollbackPlan.executionEnabled === true
    && result.rollbackStatus === "available";
  const blockedShape = result.blocked === true
    && result.status === "blocked"
    && result.reasonCode !== "none"
    && result.sideEffectObserved === false
    && result.wouldChange === false
    && impactsAreEmpty
    && result.rollbackAvailable === false
    && result.rollbackPlan.executionEnabled === false
    && (result.rollbackStatus === "not_available" || result.rollbackStatus === "failed");

  if (partialFailureShape) {
    return {
      ok: false,
      reason: `mcp_tool_partial_failure:${result.reasonCode}`,
      evidenceId: result.evidenceId,
      stateOnFailure: "rollback_available",
      sideEffectObserved: true,
      rollbackAvailable: true,
    };
  }
  if (blockedShape) {
    return {
      ok: false,
      reason: `mcp_tool_blocked:${result.reasonCode}`,
      evidenceId: result.evidenceId,
      stateOnFailure: "failed",
      sideEffectObserved: false,
      rollbackAvailable: false,
    };
  }
  if (!successShape) return invalidToolResult(operation.id);
  return {
    ok: true,
    reason: null,
    evidenceId: result.evidenceId,
    sideEffectObserved: true,
    rollbackAvailable,
  };
}

function invalidToolResult(operationId: string): AssetMutationAdapterResult {
  return {
    ok: false,
    reason: "mcp_tool_result_invalid",
    evidenceId: `asset-evidence:block:${operationId}`,
    stateOnFailure: "failed",
    sideEffectObserved: false,
    rollbackAvailable: false,
  };
}

function extractStrictStructuredContent(raw: unknown): Record<string, unknown> | null {
  if (!isObjectRecord(raw)) return null;
  if (isObjectRecord(raw.structuredContent)) return raw.structuredContent;
  if (isObjectRecord(raw.result) && isObjectRecord(raw.result.structuredContent)) return raw.result.structuredContent;
  return null;
}

function containsSensitiveExecutionField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSensitiveExecutionField);
  if (typeof value === "string") {
    return /^[a-zA-Z]:[\\/]/.test(value)
      || /^\\\\/.test(value)
      || /^file:/i.test(value)
      || (value.startsWith("/") && !value.startsWith("/Game/"))
      || /(?:^|[^a-z0-9])sk-[a-z0-9_-]{8,}/i.test(value)
      || /(?:approval|access|auth|secret)?[-_:]?token|session.?id|pid.?hash/i.test(value);
  }
  if (!isObjectRecord(value)) return false;
  return Object.entries(value).some(([key, nested]) => (
    /approval.?token|trusted.?project.?root|raw.?root|session.?id|pid.?hash|command.?line|secret/i.test(key)
    || containsSensitiveExecutionField(nested)
  ));
}

function hasOnlyKeys(value: unknown, allowed: ReadonlySet<string>): boolean {
  return isObjectRecord(value) && Object.keys(value).every((key) => allowed.has(key));
}

function stringArraysEqual(actual: unknown, expected: string[]): boolean {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => typeof value === "string" && value === expected[index]);
}

function expectedModifiedPaths(operation: AssetMutationOperation): string[] {
  if (operation.kind === "rename_asset" || operation.kind === "move_asset") {
    return operation.assetPathBefore && operation.assetPathAfter ? [operation.assetPathBefore, operation.assetPathAfter] : [];
  }
  if (operation.kind === "delete_sandbox_asset") return operation.assetPathBefore ? [operation.assetPathBefore] : [];
  const path = operation.assetPathAfter ?? operation.assetPathBefore;
  return path ? [path] : [];
}

function pluginOperationForKind(kind: AssetMutationOperation["kind"]): string {
  if (kind === "duplicate_asset") return "duplicate";
  if (kind === "rename_asset") return "rename";
  if (kind === "move_asset") return "move";
  if (kind === "save_single_asset") return "save";
  if (kind === "delete_sandbox_asset") return "delete";
  return "create_folder";
}

function toNativeApprovalOperation(operation: AssetMutationOperation): AssetMutationApprovalOperationBinding | null {
  const provenance = operation.provenance;
  if (!provenance || provenance.exactToolName !== exactToolForOperation(operation.kind)) return null;
  const common = {
    operationId: operation.id,
    pluginDryRunHash: provenance.dryRunHash,
    argsHash: provenance.argsHash,
    saveAll: false as const,
    bulk: false as const,
  };
  if (operation.kind === "create_folder" && operation.assetPathAfter) {
    return { ...common, kind: "create_folder", toolName: "ue.asset.create_folder", assetPath: operation.assetPathAfter, rollbackAction: "cleanup_empty_folder", rollbackToolName: "ue.asset.delete" };
  }
  if (operation.kind === "duplicate_asset" && operation.assetPathBefore && operation.assetPathAfter) {
    return { ...common, kind: "duplicate", toolName: "ue.asset.duplicate", sourceAssetPath: operation.assetPathBefore, targetAssetPath: operation.assetPathAfter, rollbackAction: "delete_duplicate", rollbackToolName: "ue.asset.delete" };
  }
  if (operation.kind === "rename_asset" && operation.assetPathBefore && operation.assetPathAfter) {
    return { ...common, kind: "rename", toolName: "ue.asset.rename", assetPath: operation.assetPathBefore, targetAssetPath: operation.assetPathAfter, rollbackAction: "rename_back", rollbackToolName: "ue.asset.rename" };
  }
  if (operation.kind === "move_asset" && operation.assetPathBefore && operation.assetPathAfter) {
    return { ...common, kind: "move", toolName: "ue.asset.move", assetPath: operation.assetPathBefore, targetAssetPath: operation.assetPathAfter, rollbackAction: "move_back", rollbackToolName: "ue.asset.move" };
  }
  if (operation.kind === "save_single_asset" && (operation.assetPathAfter ?? operation.assetPathBefore)) {
    return { ...common, kind: "save", toolName: "ue.asset.save", assetPath: operation.assetPathAfter ?? operation.assetPathBefore, rollbackAction: "none" };
  }
  return null;
}

function toNativeRollbackOperation(operation: AssetMutationOperation): AssetMutationApprovalOperationBinding | null {
  const provenance = operation.provenance;
  if (!provenance || provenance.exactToolName !== exactToolForOperation(operation.kind)) return null;
  const common = {
    operationId: operation.id,
    pluginDryRunHash: provenance.dryRunHash,
    argsHash: provenance.argsHash,
    rollbackAction: "none" as const,
    saveAll: false as const,
    bulk: false as const,
  };
  if (operation.kind === "create_folder" && operation.assetPathAfter) {
    return { ...common, kind: "cleanup_empty_folder", toolName: "ue.asset.delete", assetPath: operation.assetPathAfter };
  }
  if (operation.kind === "duplicate_asset" && operation.assetPathAfter) {
    return { ...common, kind: "delete_duplicate", toolName: "ue.asset.delete", assetPath: operation.assetPathAfter };
  }
  if (operation.kind === "rename_asset" && operation.assetPathBefore && operation.assetPathAfter) {
    return { ...common, kind: "rename_back", toolName: "ue.asset.rename", assetPath: operation.assetPathAfter, targetAssetPath: operation.assetPathBefore };
  }
  if (operation.kind === "move_asset" && operation.assetPathBefore && operation.assetPathAfter) {
    return { ...common, kind: "move_back", toolName: "ue.asset.move", assetPath: operation.assetPathAfter, targetAssetPath: operation.assetPathBefore };
  }
  return null;
}

function exactToolForOperation(kind: AssetMutationOperation["kind"]): string {
  if (kind === "duplicate_asset") return "ue.asset.duplicate";
  if (kind === "rename_asset") return "ue.asset.rename";
  if (kind === "move_asset") return "ue.asset.move";
  if (kind === "save_single_asset") return "ue.asset.save";
  if (kind === "delete_sandbox_asset") return "ue.asset.delete";
  return "ue.asset.create_folder";
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
  const common = {
    changeSetId: context.changeSet.id,
    runId: context.changeSet.runId,
    dryRun: false,
    execute: true,
    rollback: false,
    dryRunHash: context.dryRunHash,
  };
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
  const common = {
    changeSetId: context.changeSet.id,
    runId: context.changeSet.runId,
    dryRun: false,
    execute: false,
    rollback: true,
    dryRunHash: context.dryRunHash,
  };
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
    rollbackContractRequired: true,
    externalEvidenceRequired: true,
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
