import type {
  AssetApproval,
  AssetChangeSet,
  AssetDryRunResult,
  AssetExecutionResult,
  AssetExternalBindingStatus,
  AssetVerificationCheck,
  AssetManifestEntry,
  AssetMutationOperation,
  AssetMutationOperationKind,
  AssetMutationOperationProvenance,
  AssetMutationExternalRegistrationBinding,
  AssetMutationRisk,
  AssetExternalVerificationBaseline,
  AssetRollbackPlan,
  AssetVerificationResult,
} from "@uagent/shared";
import { classifyAssetMutationRisk, createSandboxAssetPathPolicy } from "./mvp15-asset-policy.js";
import type { AssetManifestRegistry } from "./mvp15-asset-manifest.js";
import type { AssetMutationExternalVerificationAdapter } from "./mvp15-asset-verification.js";
import { verifyAssetDeletedOrTrash, verifyAssetExists, verifyAssetMoved, verifySingleAssetSaved, verifySourceAssetUntouched } from "./mvp15-asset-verification.js";
import {
  computeAggregateBindingForOperations,
  computeArgsHash,
  createSafeChangeSetId,
  buildExactDryRunPayload,
  buildOperationProvenance,
  unwrapPluginDryRunResult,
  validatePluginDryRunResult,
  type DryRunBindingContext,
  type DryRunBindingInput,
} from "./mvp15-mcp-dry-run-binding.js";

const REDACTED = { redacted: true, replacedPaths: 0, replacedSecrets: 0 };
const SHA1_HEX_RE = /^[0-9a-f]{40}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
type MaybePromise<T> = T | Promise<T>;

/** Redact raw paths, secrets, and home dirs from MCP error messages before they reach binding reasons. */
function redact(message: string): string {
  return message
    .replace(/[A-Za-z]:[\\/]+Users[\\/]+[^\\\s/"'`]+/g, "[user-home]")
    .replace(/\/home\/[^/\s"'`]+/g, "[user-home]")
    .replace(/\/Users\/[^/\s"'`]+/g, "[user-home]")
    .replace(/sk-[A-Za-z0-9][A-Za-z0-9._-]{7,}/g, "[redacted-secret]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "[redacted-bearer]");
}

function exactToolNameForKind(kind: AssetMutationOperationKind): string {
  switch (kind) {
    case "create_folder": return "ue.asset.create_folder";
    case "duplicate_asset": return "ue.asset.duplicate";
    case "rename_asset": return "ue.asset.rename";
    case "move_asset": return "ue.asset.move";
    case "delete_sandbox_asset": return "ue.asset.delete";
    case "save_single_asset": return "ue.asset.save";
    case "create_test_asset": return "ue.asset.create_folder";
    default: return "ue.asset.create_folder";
  }
}

function bindingContextForChangeSet(changeSet: AssetChangeSet): DryRunBindingContext {
  return {
    changeSetId: changeSet.id,
    runId: changeSet.runId,
    projectId: changeSet.projectId,
    trustedRootId: changeSet.trustedRootId,
    editorSessionId: changeSet.editorSessionId,
    pidHash: changeSet.pidHash,
    sandboxRoot: "/Game/UAgentSandbox",
  };
}

export interface AssetMutationDraftOperation {
  kind: AssetMutationOperationKind;
  assetPathBefore?: string | null;
  assetPathAfter?: string | null;
}

export interface AssetMutationDryRunInput {
  projectId: string;
  trustedRootId: string;
  editorSessionId: string;
  pidHash: string;
  runId: string;
  operations: AssetMutationDraftOperation[];
}

export interface AssetMutationApproveInput {
  changeSetId: string;
  actor: string;
  reason: string;
}

export interface AssetMutationExecuteInput {
  changeSetId: string;
  approvalToken: string;
  editorSessionId: string;
  pidHash: string;
}

export interface AssetMutationRegisterApprovalInput {
  changeSetId: string;
  editorSessionId: string;
  pidHash: string;
}

/**
 * External dry-run binder drives the live UE MCP plugin exact dry-run calls. The service
 * never calls MCP directly; it hands each canonical payload to this binder and treats any
 * null/malformed/blocked response as atomic fail-closed. The binder MUST return the raw
 * MCP tool call result (structuredContent-aware) without interpreting success.
 */
export interface AssetMutationExternalBinder {
  call(input: DryRunBindingInput): Promise<unknown>;
}

export interface AssetMutationBindExternalInput {
  changeSetId: string;
  binder: AssetMutationExternalBinder;
}

export interface AssetMutationServiceResult {
  status: string;
  reason: string | null;
  changeSet: AssetChangeSet | null;
  dryRun?: AssetDryRunResult | null;
  approvalToken?: string | null;
  execution?: AssetExecutionResult | null;
  verification?: AssetVerificationResult | null;
}

export interface AssetMutationAdapterContext {
  changeSet: AssetChangeSet;
  approvalToken: string | null;
  editorSessionId: string;
  pidHash: string;
  dryRunHash: string;
  operationIndex: number;
  operationCount: number;
}

export interface AssetMutationAdapterResult {
  ok: boolean;
  reason: string | null;
  evidenceId: string;
  stateOnFailure?: "failed" | "rollback_available";
  sideEffectObserved?: boolean;
  rollbackAvailable?: boolean;
  externalRegistration?: AssetMutationExternalRegistrationBinding;
  issuedApprovalToken?: string;
  issuedAt?: number;
  expiresAt?: number;
}

export interface AssetMutationAdapter {
  prepareExecute?(context: AssetMutationAdapterContext): MaybePromise<AssetMutationAdapterResult>;
  cancelPreparedRegistration?(
    context: AssetMutationAdapterContext,
    prepared: AssetMutationAdapterResult,
  ): MaybePromise<AssetMutationAdapterResult>;
  execute(operation: AssetMutationOperation, context: AssetMutationAdapterContext): MaybePromise<AssetMutationAdapterResult>;
  rollback(operation: AssetMutationOperation, context: AssetMutationAdapterContext): MaybePromise<AssetMutationAdapterResult>;
}

export interface AssetMutationVerificationContext {
  manifest: AssetManifestRegistry;
}

export interface AssetMutationVerificationAdapter {
  verify(changeSet: AssetChangeSet, context: AssetMutationVerificationContext): MaybePromise<AssetVerificationResult>;
}

export interface AssetChangeSetServiceOptions {
  now?: () => number;
  approvalTtlMs?: number;
  executionMode?: "fixture" | "real";
  manifest: AssetManifestRegistry;
  adapter: AssetMutationAdapter;
  verification?: AssetMutationVerificationAdapter;
  externalVerification?: AssetMutationExternalVerificationAdapter;
  /** Desktop-owned current-run check used before publishing a native-issued registration. */
  isCurrentRun?: () => boolean;
}

export interface AssetChangeSetService {
  dryRun(input: AssetMutationDryRunInput): AssetMutationServiceResult & { dryRun: AssetDryRunResult; changeSet: AssetChangeSet };
  bindExternalDryRun(input: AssetMutationBindExternalInput): Promise<AssetMutationServiceResult & { dryRun: AssetDryRunResult | null; changeSet: AssetChangeSet | null }>;
  preview(changeSetId: string): AssetMutationServiceResult;
  approve(input: AssetMutationApproveInput): AssetMutationServiceResult;
  registerApproval(input: AssetMutationRegisterApprovalInput): Promise<AssetMutationServiceResult>;
  execute(input: AssetMutationExecuteInput): Promise<AssetMutationServiceResult>;
  verify(changeSetId: string): Promise<AssetMutationServiceResult>;
  rollback(changeSetId: string): Promise<AssetMutationServiceResult>;
  get(changeSetId: string): AssetChangeSet | null;
  list(): AssetChangeSet[];
}

export function createFixtureAssetMutationAdapter(): AssetMutationAdapter {
  return {
    execute: (operation) => ({ ok: true, reason: null, evidenceId: `asset-evidence:execute:${operation.id}` }),
    rollback: (operation) => ({ ok: true, reason: null, evidenceId: `asset-evidence:rollback:${operation.id}` }),
  };
}

export function createAssetChangeSetService(options: AssetChangeSetServiceOptions): AssetChangeSetService {
  const now = options.now ?? (() => Date.now());
  const ttl = options.approvalTtlMs ?? 60_000;
  const policy = createSandboxAssetPathPolicy();
  const changeSets = new Map<string, AssetChangeSet>();
  const tokens = new Map<string, { changeSetId: string; tokenHash: string; used: boolean; expiresAt: number }>();
  const tamperedChangeSetIds = new Set<string>();
  const externalRegistrations = new Map<string, AssetMutationExternalRegistrationBinding>();
  const externalBaselines = new Map<string, AssetExternalVerificationBaseline>();
  const registrationsInFlight = new Set<string>();
  let counter = 0;
  let tokenGeneration = 0;

  function store(changeSet: AssetChangeSet): AssetChangeSet {
    const authoritative = cloneChangeSet(changeSet);
    changeSets.set(authoritative.id, authoritative);
    return expose(authoritative);
  }

  function expose(changeSet: AssetChangeSet): AssetChangeSet {
    return createMutationTrackedSnapshot(cloneChangeSet(changeSet), () => {
      tamperedChangeSetIds.add(changeSet.id);
    });
  }

  function boundary<T extends AssetMutationServiceResult>(result: T): T {
    const detached = {
      ...result,
      changeSet: result.changeSet ? expose(result.changeSet) : null,
    } as T;
    if (result.dryRun !== undefined) detached.dryRun = result.dryRun ? cloneDryRunResult(result.dryRun) : null;
    if (result.execution !== undefined) detached.execution = result.execution ? cloneExecutionResult(result.execution) : null;
    if (result.verification !== undefined) detached.verification = result.verification ? cloneVerification(result.verification) : null;
    return detached;
  }

  function adapterContext(
    changeSet: AssetChangeSet,
    approvalToken: string | null,
    dryRunHash: string,
    operationIndex = 0,
  ): AssetMutationAdapterContext {
    return {
      changeSet: cloneChangeSet(changeSet),
      approvalToken,
      editorSessionId: changeSet.editorSessionId,
      pidHash: changeSet.pidHash,
      dryRunHash,
      operationIndex,
      operationCount: changeSet.operations.length,
    };
  }

  function bindingContext(input: AssetMutationDryRunInput, changeSetId: string): DryRunBindingContext {
  return {
    changeSetId,
    runId: input.runId,
    projectId: input.projectId,
    trustedRootId: input.trustedRootId,
    editorSessionId: input.editorSessionId,
    pidHash: input.pidHash,
    sandboxRoot: "/Game/UAgentSandbox",
  };
}

function localProvenance(op: AssetMutationOperation): { provenance: AssetMutationOperationProvenance } {
  const exactToolName = exactToolNameForKind(op.kind);
  return {
    provenance: {
      exactToolName,
      dryRunHash: op.dryRunHash,
      dryRunHashSource: "local",
      dryRunHashAlgorithm: "polynomial32",
      dryRunSchemaVersion: "local.v0",
      argsHash: op.argsHash,
    },
  };
}

function blocked(input: AssetMutationDryRunInput, reason: string, risk: AssetMutationRisk): AssetMutationServiceResult & { dryRun: AssetDryRunResult; changeSet: AssetChangeSet } {
    const id = createSafeChangeSetId(`blocked:${reason}:${input.runId}`);
    const dryRunId = nextId("asset-dry-run");
    const rollbackPlan = createRollbackPlan(id, []);
    const dryRun: AssetDryRunResult = {
      id: dryRunId,
      changeSetId: id,
      status: "blocked",
      reason,
      wouldChange: false,
      operations: [],
      risk,
      dryRunHash: hash(`${id}:blocked:${reason}`),
      argsHash: hash(JSON.stringify(input.operations)),
      affectedAssets: [],
      rollbackPlan,
      externalEvidenceQueries: [],
      redaction: { ...REDACTED },
      createdAt: now(),
      externalBindingStatus: "blocked",
      externalBindingReason: reason,
      aggregateDryRunHash: null,
      aggregateArgsHash: null,
    };
    const changeSet = store(createChangeSet(input, id, dryRun, [], risk));
    return { status: "blocked", reason, dryRun, changeSet };
  }

  function nextId(prefix: string): string {
    counter += 1;
    return `${prefix}:${counter}`;
  }

  async function cancelPreparedNativeRegistration(
    current: AssetChangeSet,
    prepared: AssetMutationAdapterResult,
  ): Promise<boolean> {
    if (!options.adapter.cancelPreparedRegistration) return false;
    try {
      const cancelled = await options.adapter.cancelPreparedRegistration(
        adapterContext(current, prepared.issuedApprovalToken ?? null, current.operations[0]?.dryRunHash ?? "", 0),
        prepared,
      );
      return cancelled.ok;
    } catch {
      return false;
    }
  }

  async function prepareNativeRegistration(
    current: AssetChangeSet,
  ): Promise<{ ok: boolean; reason: string | null; changeSet: AssetChangeSet; evidenceIds: string[]; approvalToken: string | null }> {
    if (
      current.nativeApprovalRegistrationStatus === "registered"
      && externalRegistrations.has(current.id)
      && externalBaselines.has(current.id)
    ) {
      return { ok: true, reason: null, changeSet: current, evidenceIds: [], approvalToken: null };
    }
    if (registrationsInFlight.has(current.id)) {
      return { ok: false, reason: "native_registration_in_progress", changeSet: current, evidenceIds: [], approvalToken: null };
    }
    if (!options.adapter.prepareExecute) {
      const reason = "native_registration_required";
      return {
        ok: false,
        reason,
        changeSet: store({
          ...current,
          state: "failed",
          nativeApprovalRegistrationStatus: "blocked",
          nativeApprovalRegistrationReason: reason,
        }),
        evidenceIds: [],
        approvalToken: null,
      };
    }

    registrationsInFlight.add(current.id);
    const registrationGeneration = tokenGeneration;
    try {
      let prepared: AssetMutationAdapterResult;
      try {
        prepared = await options.adapter.prepareExecute(
          adapterContext(current, null, current.operations[0]?.dryRunHash ?? "", 0),
        );
      } catch {
        prepared = { ok: false, reason: "native_registration_failed", evidenceId: `asset-evidence:block:${current.id}`, stateOnFailure: "failed" };
      }
      if (!prepared.ok) {
        const reason = prepared.reason ?? "native_registration_failed";
        const evidenceIds = prepared.evidenceId ? [prepared.evidenceId] : [];
        return {
          ok: false,
          reason,
          changeSet: store({
            ...current,
            state: "failed",
            nativeApprovalRegistrationStatus: "blocked",
            nativeApprovalRegistrationReason: reason,
            evidenceIds: [...new Set([...current.evidenceIds, ...evidenceIds])],
          }),
          evidenceIds,
          approvalToken: null,
        };
      }

      const registration = validateExternalRegistration(prepared.externalRegistration);
      const issuedToken = prepared.issuedApprovalToken;
      const issuedAt = prepared.issuedAt;
      const expiresAt = prepared.expiresAt;
      const issuedTokenIsValid = typeof issuedToken === "string"
        && /^[0-9a-f]{64}$/.test(issuedToken)
        && Number.isSafeInteger(issuedAt)
        && Number.isSafeInteger(expiresAt)
        && (issuedAt ?? -1) >= 0
        && (expiresAt ?? 0) > (issuedAt ?? 0)
        && (expiresAt ?? 0) - (issuedAt ?? 0) <= 60_000;
      if (!registration || !issuedTokenIsValid) {
        const reason = registration ? "external_verification_required" : "external_registration_binding_required";
        const safeReason = !issuedTokenIsValid ? "native_issued_token_invalid" : reason;
        const evidenceIds = prepared.evidenceId ? [prepared.evidenceId] : [];
        return {
          ok: false,
          reason: safeReason,
          changeSet: store({
            ...current,
            state: "failed",
            nativeApprovalRegistrationStatus: "blocked",
            nativeApprovalRegistrationReason: safeReason,
            evidenceIds: [...new Set([...current.evidenceIds, ...evidenceIds])],
          }),
          evidenceIds,
          approvalToken: null,
        };
      }
      if (registrationGeneration !== tokenGeneration || options.isCurrentRun?.() === false) {
        const cancelled = await cancelPreparedNativeRegistration(current, prepared);
        const reason = cancelled ? "native_registration_stale" : "native_registration_cancel_failed";
        return {
          ok: false,
          reason,
          changeSet: store({
            ...current,
            state: "failed",
            nativeApprovalRegistrationStatus: "blocked",
            nativeApprovalRegistrationReason: reason,
          }),
          evidenceIds: [],
          approvalToken: null,
        };
      }
      if (!options.externalVerification) {
        const cancelled = await cancelPreparedNativeRegistration(current, prepared);
        const reason = cancelled ? "external_verification_required" : "native_registration_cancel_failed";
        return {
          ok: false,
          reason,
          changeSet: store({
            ...current,
            state: "failed",
            nativeApprovalRegistrationStatus: "blocked",
            nativeApprovalRegistrationReason: reason,
          }),
          evidenceIds: [],
          approvalToken: null,
        };
      }

      let captured;
      try {
        captured = await options.externalVerification.captureBaseline(cloneChangeSet(current), { ...registration });
      } catch {
        captured = { ok: false, reason: "external_baseline_read_failed", baseline: null };
      }
      if (!captured.ok || !captured.baseline || !isValidExternalBaseline(captured.baseline, current)) {
        const cancelled = await cancelPreparedNativeRegistration(current, prepared);
        const reason = cancelled
          ? captured.reason ?? "external_baseline_required"
          : "native_registration_cancel_failed";
        const evidenceIds = prepared.evidenceId ? [prepared.evidenceId] : [];
        return {
          ok: false,
          reason,
          changeSet: store({
            ...current,
            state: "failed",
            nativeApprovalRegistrationStatus: "blocked",
            nativeApprovalRegistrationReason: reason,
            evidenceIds: [...new Set([...current.evidenceIds, ...evidenceIds])],
          }),
          evidenceIds,
          approvalToken: null,
        };
      }

      if (registrationGeneration !== tokenGeneration || options.isCurrentRun?.() === false) {
        const cancelled = await cancelPreparedNativeRegistration(current, prepared);
        const reason = cancelled ? "native_registration_stale" : "native_registration_cancel_failed";
        return {
          ok: false,
          reason,
          changeSet: store({
            ...current,
            state: "failed",
            nativeApprovalRegistrationStatus: "blocked",
            nativeApprovalRegistrationReason: reason,
          }),
          evidenceIds: [],
          approvalToken: null,
        };
      }

      externalRegistrations.set(current.id, { ...registration });
      externalBaselines.set(current.id, cloneExternalBaseline(captured.baseline));
      const tokenHash = hash(issuedToken!);
      tokens.set(tokenHash, {
        changeSetId: current.id,
        tokenHash,
        used: false,
        expiresAt: expiresAt!,
      });
      const evidenceIds = [
        prepared.evidenceId,
        ...[captured.baseline.source.evidenceId, captured.baseline.contentManifest.evidenceId]
          .filter((value): value is string => Boolean(value)),
      ];
      return {
        ok: true,
        reason: null,
        changeSet: store({
          ...current,
          approval: current.approval ? {
            ...current.approval,
            issuedAt: issuedAt!,
            expiresAt: expiresAt!,
            tokenHash,
          } : null,
          nativeApprovalRegistrationStatus: "registered",
          nativeApprovalRegistrationReason: null,
          evidenceIds: [...new Set([...current.evidenceIds, ...evidenceIds])],
        }),
        evidenceIds,
        approvalToken: issuedToken!,
      };
    } finally {
      registrationsInFlight.delete(current.id);
    }
  }

  return {
    dryRun(input) {
      // A new run invalidates every renderer/runtime-held raw approval immediately.
      tokenGeneration += 1;
      tokens.clear();
      const run = policy.validateRunId(input.runId);
      if (!run.ok) return blocked(input, run.reason, "blocked_unknown");
      if (input.operations.length > 1 && input.operations.every((op) => op.kind === "delete_sandbox_asset")) {
        return blocked(input, "bulk_operation_blocked", "blocked_bulk");
      }

      const operations: AssetMutationOperation[] = [];
      for (const draft of input.operations) {
        const runRoot = `/Game/UAgentSandbox/${input.runId}`;
        const strictRunDescendant = (value: string | null | undefined) =>
          typeof value === "string" && value.startsWith(`${runRoot}/`);
        if (draft.kind === "create_folder" || draft.kind === "create_test_asset") {
          if (draft.assetPathBefore != null || draft.assetPathAfter !== runRoot) {
            return blocked(input, "run_root_contract_invalid", "blocked_non_sandbox");
          }
        } else {
          const writeTargets = draft.kind === "duplicate_asset"
            ? [draft.assetPathAfter]
            : draft.kind === "rename_asset" || draft.kind === "move_asset"
              ? [draft.assetPathBefore, draft.assetPathAfter]
              : [draft.assetPathAfter ?? draft.assetPathBefore];
          if (writeTargets.some((path) => !strictRunDescendant(path))) {
            return blocked(input, "run_root_contract_invalid", "blocked_non_sandbox");
          }
        }
        const paths = [draft.assetPathBefore ?? null, draft.assetPathAfter ?? null].filter((path): path is string => Boolean(path));
        const sandboxPaths = paths.filter((path) => path.startsWith("/Game/UAgentSandbox") || path.startsWith("/Content/UAgentSandbox"));
        for (const path of sandboxPaths) {
          const validation = path.startsWith("/Content/")
            ? policy.validatePackagePath(path)
            : policy.validateAssetPath(path);
          if (!validation.ok) return blocked(input, validation.reason, classifyAssetMutationRisk(draft.kind, validation.reason));
        }
        const targetPath = draft.assetPathAfter ?? draft.assetPathBefore ?? "";
        if ((draft.kind !== "duplicate_asset" || draft.assetPathAfter) && targetPath && !targetPath.startsWith("/Game/UAgentSandbox") && !targetPath.startsWith("/Content/UAgentSandbox")) {
          return blocked(input, "non_sandbox_path", "blocked_non_sandbox");
        }
        const opId = nextId("asset-op");
        operations.push({
          id: opId,
          kind: draft.kind,
          assetPathBefore: draft.assetPathBefore ?? null,
          assetPathAfter: draft.assetPathAfter ?? null,
          sandboxRoot: "/Game/UAgentSandbox",
          manifestEntryId: null,
          dryRunHash: hash(`${opId}:${draft.kind}:dry`),
          argsHash: hash(JSON.stringify(draft)),
          summary: summarizeOperation(draft),
          blockedReason: null,
          executionStatus: "pending",
          executionEvidenceId: null,
          provenance: null,
        });
      }

      const id = createSafeChangeSetId(`${input.runId}:${operations.map((op) => op.kind).join(",")}`);
      const dryRunId = nextId("asset-dry-run");
      const rollbackPlan = createRollbackPlan(id, operations);
      const risk = operations.reduce<AssetMutationRisk>((current, op) => {
        const opRisk = classifyAssetMutationRisk(op.kind, null);
        if (opRisk === "high_destructive") return opRisk;
        if (opRisk === "medium_sandbox" && current === "low_sandbox") return opRisk;
        return current;
      }, "low_sandbox");
      const isReal = options.executionMode === "real";
      const bindingStatus: AssetExternalBindingStatus = isReal ? "external_pending" : "local_fixture";
      // Fixture/local computes a stable aggregate over the local plan so non-real ChangeSets
      // still expose aggregate hashes; real ChangeSets leave these null until bound externally.
      const aggregate = isReal
        ? { aggregateDryRunHash: null, aggregateArgsHash: null }
        : computeAggregateBindingForOperations(
            operations.map((op) => ({ ...op, provenance: localProvenance(op).provenance })) as AssetMutationOperation[],
            bindingContext(input, id),
          );
      const dryRun: AssetDryRunResult = {
        id: dryRunId,
        changeSetId: id,
        status: "dry_run_completed",
        reason: null,
        wouldChange: operations.length > 0,
        operations,
        risk,
        dryRunHash: hash(`${id}:dry:${operations.map((op) => op.dryRunHash).join(":")}`),
        argsHash: hash(JSON.stringify(input.operations)),
        affectedAssets: [...new Set(operations.flatMap((op) => [op.assetPathBefore, op.assetPathAfter].filter((path): path is string => Boolean(path))))],
        rollbackPlan,
        externalEvidenceQueries: createExternalEvidenceQueries(id, operations),
        redaction: { ...REDACTED },
        createdAt: now(),
        externalBindingStatus: bindingStatus,
        externalBindingReason: null,
        aggregateDryRunHash: aggregate.aggregateDryRunHash,
        aggregateArgsHash: aggregate.aggregateArgsHash,
      };
      const changeSet = store(createChangeSet(input, id, dryRun, operations, risk));
      return { status: "dry_run_completed", reason: null, dryRun, changeSet };
    },
    bindExternalDryRun: async ({ changeSetId, binder }) => {
      const current = changeSets.get(changeSetId);
      if (!current) return { status: "blocked", reason: "changeset_required", changeSet: null, dryRun: null };
      if (options.executionMode !== "real") return boundary({ status: "blocked", reason: "external_binding_real_only", dryRun: null, changeSet: current });
      // Real ChangeSets only: reject stale binding completion if the ChangeSet was already bound.
      if (current.externalBindingStatus === "external_bound") return boundary({ status: "blocked", reason: "external_binding_already_bound", dryRun: null, changeSet: current });
      if (current.operations.length === 0) return boundary({ status: "blocked", reason: "external_binding_no_operations", dryRun: null, changeSet: current });

      const ctx = bindingContextForChangeSet(current);
      const bound: AssetMutationOperation[] = [];
      let failure: { reason: string } | null = null;
      for (const op of current.operations) {
        const bindingInput: DryRunBindingInput = {
          operationId: op.id,
          operationKind: op.kind,
          assetPathBefore: op.assetPathBefore,
          assetPathAfter: op.assetPathAfter,
          exactToolName: exactToolNameForKind(op.kind),
          context: ctx,
        };
        const payload = buildExactDryRunPayload(bindingInput);
        let raw: unknown;
        try {
          raw = await binder.call(cloneDryRunBindingInput(bindingInput));
        } catch (error) {
          failure = { reason: error instanceof Error ? `mcp_dry_run_transport_failed:${redact(error.message)}` : "mcp_dry_run_transport_failed" };
          break;
        }
        const unwrapped = unwrapPluginDryRunResult(raw);
        const validated = validatePluginDryRunResult(unwrapped, {
          expectedToolName: payload.toolName,
          expectedOperationKind: op.kind,
          context: ctx,
          operation: op,
        });
        if (!validated.ok) {
          failure = { reason: validated.reason };
          break;
        }
        const argsHash = computeArgsHash(bindingInput);
        const provenance = buildOperationProvenance(validated, argsHash);
        bound.push({ ...op, dryRunHash: provenance.dryRunHash, argsHash, provenance });
      }

      if (failure) {
        const blockedChangeSet = store({
          ...current,
          state: "failed",
          externalBindingStatus: "blocked",
          externalBindingReason: failure.reason,
          aggregateDryRunHash: null,
          aggregateArgsHash: null,
          operations: cloneOperations(current.operations),
        });
        const blockedDryRun = createExternalBindingBlockedDryRun(current, failure.reason, now());
        return boundary({ status: "blocked", reason: failure.reason, dryRun: blockedDryRun, changeSet: blockedChangeSet });
      }

      const aggregate = computeAggregateBindingForOperations(bound, ctx);
      if (!aggregate.complete) {
        const blockedChangeSet = store({
          ...current,
          state: "failed",
          externalBindingStatus: "blocked",
          externalBindingReason: "external_binding_incomplete",
          aggregateDryRunHash: null,
          aggregateArgsHash: null,
          operations: cloneOperations(current.operations),
        });
        return boundary({
          status: "blocked",
          reason: "external_binding_incomplete",
          dryRun: createExternalBindingBlockedDryRun(current, "external_binding_incomplete", now()),
          changeSet: blockedChangeSet,
        });
      }

      const boundDryRun: AssetDryRunResult = {
        id: current.dryRunId,
        changeSetId: current.id,
        status: "dry_run_completed",
        reason: null,
        wouldChange: true,
        operations: bound,
        risk: current.risk,
        dryRunHash: aggregate.aggregateDryRunHash!,
        argsHash: aggregate.aggregateArgsHash!,
        affectedAssets: [...new Set(bound.flatMap((op) => [op.assetPathBefore, op.assetPathAfter].filter((path): path is string => Boolean(path))))],
        rollbackPlan: current.rollbackPlan,
        externalEvidenceQueries: createExternalEvidenceQueries(current.id, bound),
        redaction: { ...REDACTED },
        createdAt: now(),
        externalBindingStatus: "external_bound",
        externalBindingReason: null,
        aggregateDryRunHash: aggregate.aggregateDryRunHash,
        aggregateArgsHash: aggregate.aggregateArgsHash,
      };
      const boundChangeSet = store({
        ...current,
        operations: bound,
        dryRunId: boundDryRun.id,
        aggregateDryRunHash: aggregate.aggregateDryRunHash,
        aggregateArgsHash: aggregate.aggregateArgsHash,
        externalBindingStatus: "external_bound",
        externalBindingReason: null,
      });
      return boundary({ status: "dry_run_completed", reason: null, dryRun: boundDryRun, changeSet: boundChangeSet });
    },
    preview(changeSetId) {
      const current = changeSets.get(changeSetId);
      if (!current) return { status: "blocked", reason: "changeset_required", changeSet: null };
      if (options.executionMode === "real" && current.externalBindingStatus !== "external_bound") {
        return boundary({ status: "blocked", reason: `external_binding_${current.externalBindingStatus ?? "pending"}`, changeSet: current });
      }
      if (options.executionMode === "real") {
        const bindingReason = validateRealExternalBinding(current);
        if (bindingReason) return boundary({ status: "blocked", reason: bindingReason, changeSet: current });
      }
      return boundary({ status: "previewed", reason: null, changeSet: store({ ...current, state: "approval_required" }) });
    },
    approve(input) {
      const current = changeSets.get(input.changeSetId);
      if (!current) return { status: "blocked", reason: "changeset_required", changeSet: null, approvalToken: null };
      if (options.executionMode === "real" && tamperedChangeSetIds.has(input.changeSetId)) {
        return boundary({ status: "blocked", reason: "changeset_snapshot_tampered", changeSet: current, approvalToken: null });
      }
      if (options.executionMode === "real" && current.externalBindingStatus !== "external_bound") {
        return boundary({ status: "blocked", reason: `external_binding_${current.externalBindingStatus ?? "pending"}`, changeSet: current, approvalToken: null });
      }
      if (options.executionMode === "real") {
        const bindingReason = validateRealExternalBinding(current);
        if (bindingReason) return boundary({ status: "blocked", reason: bindingReason, changeSet: current, approvalToken: null });
      }
      if (current.state !== "approval_required") return boundary({ status: "blocked", reason: "approval_required", changeSet: current, approvalToken: null });
      const issuedAt = now();
      const approvalToken = options.executionMode === "real"
        ? null
        : `asset-approval-token:${hash(`${current.id}:${issuedAt}:${input.actor}`)}`;
      const approval: AssetApproval = {
        approvalId: nextId("asset-approval"),
        changeSetId: current.id,
        projectId: current.projectId,
        trustedRootId: current.trustedRootId,
        editorSessionId: current.editorSessionId,
        pidHash: current.pidHash,
        runId: current.runId,
        operationKind: current.operations[0]?.kind ?? "create_folder",
        assetPaths: current.operations.flatMap((op) => [op.assetPathBefore, op.assetPathAfter].filter((path): path is string => Boolean(path))),
        dryRunHash: current.operations[0]?.dryRunHash ?? "",
        argsHash: current.operations[0]?.argsHash ?? "",
        manifestEntryIds: current.operations.flatMap((op) => (op.manifestEntryId ? [op.manifestEntryId] : [])),
        orderedOperationIds: current.operations.map((op) => op.id),
        orderedOperationKinds: current.operations.map((op) => op.kind),
        aggregateDryRunHash: options.executionMode === "real" ? current.aggregateDryRunHash! : current.aggregateDryRunHash ?? null,
        aggregateArgsHash: options.executionMode === "real" ? current.aggregateArgsHash! : current.aggregateArgsHash ?? null,
        externalBindingStatus: current.externalBindingStatus,
        actor: input.actor,
        reason: input.reason,
        issuedAt,
        expiresAt: issuedAt + ttl,
        status: "issued",
        tokenHash: approvalToken ? hash(approvalToken) : "native-issued-pending",
      };
      if (approvalToken) {
        tokens.set(approval.tokenHash, { changeSetId: current.id, tokenHash: approval.tokenHash, used: false, expiresAt: approval.expiresAt });
      }
      const changeSet = store({ ...current, state: "approved", approval });
      return boundary({ status: "approved", reason: null, changeSet, approvalToken });
    },
    async registerApproval(input) {
      const current = changeSets.get(input.changeSetId);
      if (!current) return { status: "blocked", reason: "changeset_required", changeSet: null };
      if (options.executionMode !== "real") {
        return boundary({ status: "not_required", reason: null, changeSet: current });
      }
      if (tamperedChangeSetIds.has(input.changeSetId)) {
        return boundary({ status: "blocked", reason: "changeset_snapshot_tampered", changeSet: current });
      }
      const bindingReason = validateRealExternalBinding(current);
      if (bindingReason) return boundary({ status: "blocked", reason: bindingReason, changeSet: current });
      if (input.editorSessionId !== current.editorSessionId) return boundary({ status: "blocked", reason: "session_mismatch", changeSet: current });
      if (input.pidHash !== current.pidHash) return boundary({ status: "blocked", reason: "pid_mismatch", changeSet: current });
      const approvalReason = validateRealApprovalBinding(current);
      if (approvalReason) return boundary({ status: "blocked", reason: approvalReason, changeSet: current });

      const registration = await prepareNativeRegistration(current);
      return boundary({
        status: registration.ok ? "registered" : "failed",
        reason: registration.reason,
        changeSet: registration.changeSet,
        approvalToken: registration.approvalToken,
      });
    },
    async execute(input) {
      let current = changeSets.get(input.changeSetId);
      if (!current) return { status: "blocked", reason: "changeset_required", changeSet: null };
      const preExecutionEvidenceIds: string[] = [];
      if (options.executionMode === "real") {
        if (tamperedChangeSetIds.has(input.changeSetId)) {
          return boundary({ status: "blocked", reason: "changeset_snapshot_tampered", changeSet: current });
        }
        const bindingReason = validateRealExternalBinding(current);
        if (bindingReason) return boundary({ status: "blocked", reason: bindingReason, changeSet: current });
      }
      const tokenKey = hash(input.approvalToken);
      const token = tokens.get(tokenKey);
      if (!token || token.changeSetId !== input.changeSetId || current.approval?.tokenHash !== token.tokenHash) return boundary({ status: "blocked", reason: "forged_token", changeSet: current });
      if (token.used) return boundary({ status: "blocked", reason: "replay_token", changeSet: current });
      // Consume before any further validation/await: every first execute attempt is terminal for raw-token memory.
      token.used = true;
      tokens.delete(tokenKey);
      if (input.editorSessionId !== current.editorSessionId) return boundary({ status: "blocked", reason: "session_mismatch", changeSet: current });
      if (input.pidHash !== current.pidHash) return boundary({ status: "blocked", reason: "pid_mismatch", changeSet: current });
      if (now() >= token.expiresAt) return boundary({ status: "blocked", reason: "expired_token", changeSet: store({ ...current, state: "expired", approval: current.approval ? { ...current.approval, status: "expired" } : null }) });

      if (options.executionMode === "real") {
        const approvalReason = validateRealApprovalBinding(current);
        if (approvalReason) return boundary({ status: "blocked", reason: approvalReason, changeSet: current });
        // Consume before the first await so concurrent/replayed batches cannot pass the JS boundary.
        const registration = await prepareNativeRegistration(current);
        if (!registration.ok) {
          const execution = createExecutionResult(nextId("asset-execution"), registration.changeSet, [], registration.evidenceIds, "failed", registration.reason ?? "native_registration_failed", now());
          const changeSet = store({
            ...registration.changeSet,
            state: "failed",
            approval: registration.changeSet.approval ? { ...registration.changeSet.approval, status: "used" } : null,
          });
          return boundary({ status: "failed", reason: execution.reason, changeSet, execution });
        }
        current = registration.changeSet;
        preExecutionEvidenceIds.push(...registration.evidenceIds);
      }
      const nextOps: AssetMutationOperation[] = [];
      const evidenceIds: string[] = [...preExecutionEvidenceIds];
      for (const [operationIndex, op] of current.operations.entries()) {
        const ownership = resolveManifestOwnership(current, op, options.manifest.list());
        if (!ownership.ok) {
          nextOps.push({
            ...op,
            executionStatus: "blocked",
            executionEvidenceId: null,
          });
          const execution = createExecutionResult(nextId("asset-execution"), current, nextOps, evidenceIds, "blocked", ownership.reason, now());
          const state = hasRollbackOwnership(nextOps) ? "rollback_available" : "failed";
          const changeSet = store({ ...current, state, operations: mergeOperations(current.operations, nextOps), evidenceIds: [...current.evidenceIds, ...evidenceIds] });
          return boundary({ status: "blocked", reason: ownership.reason, changeSet, execution });
        }
        const approvalToken = options.executionMode === "real" && operationIndex > 0 ? null : input.approvalToken;
        const result = await options.adapter.execute(
          cloneOperation(op),
          adapterContext(current, approvalToken, op.dryRunHash, operationIndex),
        );
        evidenceIds.push(result.evidenceId);
        let manifestEntry: AssetManifestEntry | null = null;
        if (result.ok || result.sideEffectObserved === true) {
          if (op.kind === "create_folder" || op.kind === "create_test_asset") {
            manifestEntry = options.manifest.registerCreated({
              projectId: current.projectId,
              editorSessionId: current.editorSessionId,
              runId: extractRunId(op.assetPathAfter),
              assetPath: op.assetPathAfter!,
              sourceOperationId: op.id,
              evidenceId: result.evidenceId,
            });
          } else if (op.kind === "duplicate_asset") {
            manifestEntry = options.manifest.registerDuplicated({
              projectId: current.projectId,
              editorSessionId: current.editorSessionId,
              runId: extractRunId(op.assetPathAfter),
              assetPath: op.assetPathAfter!,
              sourceAssetPath: op.assetPathBefore ?? undefined,
              sourceOperationId: op.id,
              evidenceId: result.evidenceId,
            });
          } else if (op.kind === "rename_asset" || op.kind === "move_asset" || op.kind === "save_single_asset" || op.kind === "delete_sandbox_asset") {
            const entry = ownership.entry;
            if (entry && op.kind === "rename_asset") manifestEntry = options.manifest.markRenamed(entry.id, op.assetPathAfter!, op.id, result.evidenceId);
            if (entry && op.kind === "move_asset") manifestEntry = options.manifest.markMoved(entry.id, op.assetPathAfter!, op.id, result.evidenceId);
            if (entry && op.kind === "save_single_asset") manifestEntry = options.manifest.markSaved(entry.id, result.evidenceId);
            if (entry && op.kind === "delete_sandbox_asset") manifestEntry = options.manifest.markDeleted(entry.id, result.evidenceId);
          }
        }
        const processedOperation = {
          ...op,
          manifestEntryId: manifestEntry?.id ?? op.manifestEntryId,
          executionStatus: result.ok ? "executed" as const : result.sideEffectObserved === true ? "partial_failure" as const : "failed" as const,
          executionEvidenceId: result.evidenceId,
          partialSideEffectObserved: result.sideEffectObserved === true || undefined,
        };
        if (!result.ok) {
          nextOps.push(processedOperation);
          const execution = createExecutionResult(nextId("asset-execution"), current, nextOps, evidenceIds, "failed", result.reason ?? "adapter_execute_failed", now());
          const failureState = options.executionMode === "real"
            ? hasRollbackOwnership(nextOps) ? "rollback_available" : "failed"
            : result.stateOnFailure ?? "rollback_available";
          const changeSet = store({
            ...current,
            state: failureState,
            operations: mergeOperations(current.operations, nextOps),
            approval: current.approval ? { ...current.approval, status: "used" } : null,
            evidenceIds: [...current.evidenceIds, ...evidenceIds],
          });
          return boundary({ status: "failed", reason: execution.reason, changeSet, execution });
        }
        nextOps.push(processedOperation);
      }
      const execution = createExecutionResult(nextId("asset-execution"), current, nextOps, evidenceIds, "executed", null, now());
      const changeSet = store({ ...current, state: "executed", operations: nextOps, approval: current.approval ? { ...current.approval, status: "used" } : null, evidenceIds: [...current.evidenceIds, ...evidenceIds] });
      return boundary({ status: "executed", reason: null, changeSet, execution });
    },
    async verify(changeSetId) {
      const current = changeSets.get(changeSetId);
      if (!current) return { status: "blocked", reason: "changeset_required", changeSet: null };
      if (options.executionMode === "real") {
        if (current.state !== "executed" && current.state !== "rollback_available") {
          return boundary({ status: "blocked", reason: "external_verification_state_invalid", changeSet: current });
        }
        const registration = externalRegistrations.get(changeSetId);
        const baseline = externalBaselines.get(changeSetId);
        if (!options.externalVerification || !registration || !baseline) {
          const reason = !options.externalVerification ? "external_verification_required" : "external_baseline_required";
          const changeSet = store({ ...current, state: "rollback_available" });
          return boundary({ status: "blocked", reason, changeSet, verification: null });
        }
        let result;
        try {
          result = await options.externalVerification.verify(
            cloneChangeSet(current),
            { ...registration },
            cloneExternalBaseline(baseline),
          );
        } catch {
          result = { ok: false, reason: "external_verification_read_failed", verification: null };
        }
        if (!result.ok || !isValidExternalVerification(result.verification, current)) {
          const reason = result.ok ? "external_verification_result_invalid" : result.reason ?? "external_verification_failed";
          const verification = result.verification ? cloneVerification(result.verification) : null;
          const evidenceIds = verification?.evidenceId ? [...new Set([...current.evidenceIds, verification.evidenceId])] : current.evidenceIds;
          const changeSet = store({ ...current, state: "rollback_available", verification, evidenceIds });
          return boundary({ status: "failed", reason, changeSet, verification });
        }
        const verification = cloneVerification(result.verification)!;
        const changeSet = store({
          ...current,
          state: "verified",
          verification,
          evidenceIds: [...new Set([...current.evidenceIds, verification.evidenceId])],
        });
        return boundary({ status: "verified", reason: null, changeSet, verification });
      }
      const verification = options.verification
        ? await options.verification.verify(cloneChangeSet(current), { manifest: options.manifest })
        : createManifestVerification(nextId("asset-verification"), current, options.manifest, now());
      const nextState = verification.status === "passed" ? "verified" : verification.status === "blocked" ? "rollback_available" : "failed";
      const status = verification.status === "passed" ? "verified" : verification.status;
      const reason = verification.status === "passed" ? null : verification.status === "blocked" ? "real_verification_required" : "verification_failed";
      const changeSet = store({ ...current, state: nextState, verification, evidenceIds: [...new Set([...current.evidenceIds, verification.evidenceId])] });
      return boundary({ status, reason, changeSet, verification });
    },
    async rollback(changeSetId) {
      const current = changeSets.get(changeSetId);
      if (!current) return { status: "blocked", reason: "changeset_required", changeSet: null };
      if (options.executionMode === "real") {
        if (!["executed", "verified", "rollback_available"].includes(current.state)) {
          return boundary({ status: "blocked", reason: "rollback_state_invalid", changeSet: current });
        }
        const registration = externalRegistrations.get(changeSetId);
        const baseline = externalBaselines.get(changeSetId);
        if (!registration || !baseline || !options.externalVerification?.verifyRollback) {
          return boundary({ status: "blocked", reason: "external_rollback_verification_required", changeSet: current });
        }
        const reversible = current.operations
          .map((operation, operationIndex) => ({ operation, operationIndex }))
          .filter(({ operation }) => operation.kind !== "save_single_asset" && Boolean(operation.manifestEntryId));
        if (reversible.length === 0) {
          return boundary({ status: "blocked", reason: "rollback_operations_required", changeSet: current });
        }
        const reversibleIds = new Set(reversible.map(({ operation }) => operation.id));
        let working = store({
          ...current,
          state: "rollback_available",
          rollbackPlan: {
            ...current.rollbackPlan,
            actions: current.rollbackPlan.actions.map((action) => (
              action.action === "none" || !reversibleIds.has(action.operationId)
                ? { ...action, status: "not_applicable" as const, evidenceId: null }
                : { ...action }
            )),
          },
        });
        for (const { operation, operationIndex } of [...reversible].reverse()) {
          const action = working.rollbackPlan.actions.find((candidate) => candidate.operationId === operation.id);
          if (action?.status === "completed") continue;
          if (!action || (action.status !== "pending" && action.status !== "failed")) {
            return boundary({ status: "blocked", reason: "rollback_plan_invalid", changeSet: working });
          }
          const ownership = resolveRollbackManifestOwnership(working, operation, options.manifest);
          if (!ownership.ok) {
            return boundary({ status: "blocked", reason: ownership.reason, changeSet: working });
          }
          let result: AssetMutationAdapterResult;
          try {
            result = await options.adapter.rollback(
              cloneOperation(operation),
              adapterContext(working, null, operation.dryRunHash, operationIndex),
            );
          } catch {
            result = { ok: false, reason: "adapter_rollback_failed", evidenceId: `asset-evidence:block:${operation.id}` };
          }
          const evidenceIds = [...new Set([...working.evidenceIds, result.evidenceId])];
          if (!result.ok) {
            working = store({
              ...working,
              state: "rollback_available",
              rollbackPlan: {
                ...working.rollbackPlan,
                actions: working.rollbackPlan.actions.map((candidate) => candidate.operationId === operation.id
                  ? { ...candidate, status: "failed", evidenceId: result.evidenceId }
                  : { ...candidate }),
              },
              evidenceIds,
            });
            return boundary({ status: "failed", reason: result.reason ?? "adapter_rollback_failed", changeSet: working });
          }
          applyRollbackManifestTransition(options.manifest, ownership.entry, operation, result.evidenceId);
          working = store({
            ...working,
            state: "rollback_available",
            rollbackPlan: {
              ...working.rollbackPlan,
              actions: working.rollbackPlan.actions.map((candidate) => candidate.operationId === operation.id
                ? { ...candidate, status: "completed", evidenceId: result.evidenceId }
                : { ...candidate }),
            },
            evidenceIds,
          });
        }
        let restored;
        try {
          restored = await options.externalVerification.verifyRollback(
            cloneChangeSet(working),
            { ...registration },
            cloneExternalBaseline(baseline),
          );
        } catch {
          restored = { ok: false, reason: "external_rollback_verification_read_failed", verification: null };
        }
        if (!restored.ok || !isValidExternalRollbackVerification(restored.verification, working)) {
          const reason = restored.ok ? "external_rollback_verification_result_invalid" : restored.reason ?? "external_rollback_verification_failed";
          const verification = restored.verification ? cloneVerification(restored.verification) : null;
          const evidenceIds = verification?.evidenceId ? [...new Set([...working.evidenceIds, verification.evidenceId])] : working.evidenceIds;
          working = store({ ...working, state: "rollback_available", verification, evidenceIds });
          return boundary({ status: "failed", reason, changeSet: working, verification });
        }
        const verification = cloneVerification(restored.verification)!;
        working = store({
          ...working,
          state: "rolled_back",
          verification,
          evidenceIds: [...new Set([...working.evidenceIds, verification.evidenceId])],
        });
        return boundary({ status: "rolled_back", reason: null, changeSet: working, verification });
      }
      const approvalToken = findApprovalToken(tokens, changeSetId);
      for (const op of [...current.operations].reverse()) {
        const result = await options.adapter.rollback(cloneOperation(op), adapterContext(current, approvalToken, op.dryRunHash));
        if (!result.ok) {
          const changeSet = store({ ...current, state: "rollback_available", evidenceIds: [...new Set([...current.evidenceIds, result.evidenceId])] });
          return boundary({ status: "failed", reason: result.reason ?? "adapter_rollback_failed", changeSet });
        }
        if (op.manifestEntryId) options.manifest.rollbackState(op.manifestEntryId, `asset-evidence:rollback:${op.id}`);
      }
      return boundary({ status: "rolled_back", reason: null, changeSet: store({ ...current, state: "rolled_back" }) });
    },
    get: (changeSetId) => {
      const changeSet = changeSets.get(changeSetId);
      return changeSet ? expose(changeSet) : null;
    },
    list: () => [...changeSets.values()].map(expose),
  };
}

function createChangeSet(
  input: AssetMutationDryRunInput,
  id: string,
  dryRun: AssetDryRunResult,
  operations: AssetMutationOperation[],
  risk: AssetMutationRisk,
): AssetChangeSet {
  return {
    id,
    projectId: input.projectId,
    trustedRootId: input.trustedRootId,
    editorSessionId: input.editorSessionId,
    pidHash: input.pidHash,
    dryRunId: dryRun.id,
    runId: input.runId,
    state: dryRun.status === "blocked" ? "failed" : "dry_run_completed",
    operations,
    risk,
    approval: null,
    rollbackPlan: dryRun.rollbackPlan,
    verification: null,
    evidenceIds: [`asset-evidence:dry-run:${id}`],
    redaction: { ...REDACTED },
    externalBindingStatus: dryRun.externalBindingStatus ?? "local_fixture",
    externalBindingReason: dryRun.externalBindingReason ?? null,
    aggregateDryRunHash: dryRun.aggregateDryRunHash ?? null,
    aggregateArgsHash: dryRun.aggregateArgsHash ?? null,
    nativeApprovalRegistrationStatus: dryRun.externalBindingStatus === "local_fixture"
      ? "not_required"
      : dryRun.status === "blocked" ? "blocked" : "required",
    nativeApprovalRegistrationReason: dryRun.status === "blocked" ? dryRun.reason : null,
  };
}

export function validateRealExternalBinding(changeSet: AssetChangeSet): string | null {
  if (changeSet.externalBindingStatus !== "external_bound") return "external_binding_not_bound";
  if (changeSet.operations.length === 0) return "external_binding_operations_required";

  for (const operation of changeSet.operations) {
    const provenance = operation.provenance;
    if (!provenance) return "external_binding_provenance_missing";
    if (provenance.exactToolName !== exactToolNameForKind(operation.kind)) return "external_binding_provenance_exact_tool";
    if (operation.dryRunHash !== provenance.dryRunHash) return "external_binding_provenance_dry_run_hash";
    if (operation.argsHash !== provenance.argsHash) return "external_binding_provenance_args_hash";
    if (
      !SHA1_HEX_RE.test(provenance.dryRunHash)
      || provenance.dryRunHashSource !== "ue_mcp_exact_tool"
      || provenance.dryRunHashAlgorithm !== "sha1"
      || provenance.dryRunSchemaVersion !== "mvp15c.dry-run.v1"
    ) {
      return "external_binding_provenance_dry_run_contract";
    }
    if (!SHA256_HEX_RE.test(provenance.argsHash)) return "external_binding_provenance_args_hash_format";
  }

  if (!changeSet.aggregateDryRunHash) return "aggregate_dry_run_hash_required";
  if (!SHA256_HEX_RE.test(changeSet.aggregateDryRunHash)) return "aggregate_dry_run_hash_invalid";
  if (!changeSet.aggregateArgsHash) return "aggregate_args_hash_required";
  if (!SHA256_HEX_RE.test(changeSet.aggregateArgsHash)) return "aggregate_args_hash_invalid";

  const recompute = computeAggregateBindingForOperations(changeSet.operations, bindingContextForChangeSet(changeSet));
  if (!recompute.complete) return "external_binding_incomplete";
  if (recompute.aggregateDryRunHash !== changeSet.aggregateDryRunHash) return "aggregate_dry_run_hash_mismatch";
  if (recompute.aggregateArgsHash !== changeSet.aggregateArgsHash) return "aggregate_args_hash_mismatch";
  return null;
}

function validateRealApprovalBinding(changeSet: AssetChangeSet): string | null {
  const approval = changeSet.approval;
  if (!approval || changeSet.state !== "approved" || approval.status !== "issued") return "approval_required";
  if (
    approval.changeSetId !== changeSet.id
    || approval.projectId !== changeSet.projectId
    || approval.trustedRootId !== changeSet.trustedRootId
    || approval.editorSessionId !== changeSet.editorSessionId
    || approval.pidHash !== changeSet.pidHash
    || approval.runId !== changeSet.runId
  ) {
    return "approval_binding_mismatch";
  }
  if (
    approval.aggregateDryRunHash !== changeSet.aggregateDryRunHash
    || approval.aggregateArgsHash !== changeSet.aggregateArgsHash
  ) {
    return "approval_aggregate_mismatch";
  }
  const operationIds = changeSet.operations.map((operation) => operation.id);
  const operationKinds = changeSet.operations.map((operation) => operation.kind);
  if (!arraysEqual(approval.orderedOperationIds, operationIds) || !arraysEqual(approval.orderedOperationKinds, operationKinds)) {
    return "approval_operation_order_mismatch";
  }
  return null;
}

function arraysEqual<T>(actual: readonly T[] | undefined, expected: readonly T[]): boolean {
  return Boolean(actual) && actual!.length === expected.length && actual!.every((value, index) => value === expected[index]);
}

function createExternalBindingBlockedDryRun(
  changeSet: AssetChangeSet,
  reason: string,
  createdAt: number,
): AssetDryRunResult {
  return {
    id: changeSet.dryRunId,
    changeSetId: changeSet.id,
    status: "blocked",
    reason,
    wouldChange: false,
    operations: [],
    risk: changeSet.risk,
    dryRunHash: "blocked",
    argsHash: "blocked",
    affectedAssets: [],
    rollbackPlan: cloneRollbackPlan(changeSet.rollbackPlan),
    externalEvidenceQueries: [],
    redaction: { ...REDACTED },
    createdAt,
    externalBindingStatus: "blocked",
    externalBindingReason: reason,
    aggregateDryRunHash: null,
    aggregateArgsHash: null,
  };
}

function cloneDryRunBindingInput(input: DryRunBindingInput): DryRunBindingInput {
  return {
    ...input,
    context: { ...input.context },
  };
}

function cloneOperations(operations: AssetMutationOperation[]): AssetMutationOperation[] {
  return operations.map((operation) => ({
    ...operation,
    provenance: operation.provenance ? { ...operation.provenance } : operation.provenance ?? null,
  }));
}

function cloneOperation(operation: AssetMutationOperation): AssetMutationOperation {
  return {
    ...operation,
    provenance: operation.provenance ? { ...operation.provenance } : operation.provenance ?? null,
  };
}

function cloneDryRunResult(dryRun: AssetDryRunResult): AssetDryRunResult {
  return {
    ...dryRun,
    operations: cloneOperations(dryRun.operations),
    affectedAssets: [...dryRun.affectedAssets],
    rollbackPlan: cloneRollbackPlan(dryRun.rollbackPlan),
    externalEvidenceQueries: dryRun.externalEvidenceQueries.map((query) => ({ ...query })),
    redaction: { ...dryRun.redaction },
  };
}

function cloneExecutionResult(execution: AssetExecutionResult): AssetExecutionResult {
  return {
    ...execution,
    affectedAssets: [...execution.affectedAssets],
    manifestEntryIds: [...execution.manifestEntryIds],
    redaction: { ...execution.redaction },
  };
}

function cloneRollbackPlan(plan: AssetRollbackPlan): AssetRollbackPlan {
  return {
    ...plan,
    actions: plan.actions.map((action) => ({ ...action })),
  };
}

function cloneApproval(approval: AssetApproval | null): AssetApproval | null {
  if (!approval) return null;
  return {
    ...approval,
    assetPaths: [...approval.assetPaths],
    manifestEntryIds: [...approval.manifestEntryIds],
    orderedOperationIds: approval.orderedOperationIds ? [...approval.orderedOperationIds] : approval.orderedOperationIds,
    orderedOperationKinds: approval.orderedOperationKinds ? [...approval.orderedOperationKinds] : approval.orderedOperationKinds,
  };
}

function cloneVerification(verification: AssetVerificationResult | null): AssetVerificationResult | null {
  if (!verification) return null;
  return {
    ...verification,
    checks: verification.checks.map((check) => ({ ...check })),
    redaction: { ...verification.redaction },
  };
}

function validateExternalRegistration(
  registration: AssetMutationExternalRegistrationBinding | undefined,
): AssetMutationExternalRegistrationBinding | null {
  if (!registration || !isSafeOpaqueId(registration.registrationId)) return null;
  return { ...registration };
}

function isSafeOpaqueId(value: string): boolean {
  return Boolean(value)
    && value.length <= 256
    && !/[\\/\r\n\t]/.test(value)
    && !/^[A-Za-z]:/.test(value);
}

function cloneExternalBaseline(baseline: AssetExternalVerificationBaseline): AssetExternalVerificationBaseline {
  return {
    source: { ...baseline.source },
    contentManifest: {
      ...baseline.contentManifest,
      entries: baseline.contentManifest.entries.map((entry) => ({ ...entry })),
    },
  };
}

function isValidExternalBaseline(
  baseline: AssetExternalVerificationBaseline,
  changeSet: AssetChangeSet,
): boolean {
  if (!hasOnlyObjectKeys(baseline, ["source", "contentManifest"])) return false;
  const source = baseline.source;
  const manifest = baseline.contentManifest;
  if (!hasOnlyObjectKeys(source, ["status", "reason", "assetPath", "exists", "size", "sha256", "evidenceId"])) return false;
  if (
    source.status !== "observed"
    || source.reason !== "asset_present"
    || source.assetPath !== "/Game/Test01"
    || source.exists !== true
    || !Number.isSafeInteger(source.size)
    || (source.size ?? -1) < 0
    || !isSha256(source.sha256)
    || !isSafeEvidenceId(source.evidenceId)
  ) return false;
  if (!hasOnlyObjectKeys(manifest, ["status", "reason", "entries", "aggregateSha256", "evidenceId"])) return false;
  if (
    manifest.status !== "observed"
    || manifest.reason !== "content_manifest_captured"
    || !isSha256(manifest.aggregateSha256)
    || !isSafeEvidenceId(manifest.evidenceId)
  ) return false;
  let previousPath = "";
  for (const entry of manifest.entries) {
    if (!hasOnlyObjectKeys(entry, ["assetPath", "size", "sha256"])) return false;
    if (
      !isCanonicalGameAssetPath(entry.assetPath)
      || !Number.isSafeInteger(entry.size)
      || entry.size < 0
      || !isSha256(entry.sha256)
      || (previousPath && entry.assetPath <= previousPath)
    ) return false;
    previousPath = entry.assetPath;
  }
  const sourceEntry = manifest.entries.find((entry) => entry.assetPath === source.assetPath);
  if (!sourceEntry || sourceEntry.size !== source.size || sourceEntry.sha256 !== source.sha256) return false;
  const runRoot = `/Game/UAgentSandbox/${changeSet.runId}`;
  return manifest.entries.every((entry) => !isPathWithinGameAsset(entry.assetPath, runRoot))
    && !containsSensitiveExternalValue(baseline);
}

function isValidExternalVerification(
  verification: AssetVerificationResult | null,
  changeSet: AssetChangeSet,
): verification is AssetVerificationResult {
  if (!verification || verification.changeSetId !== changeSet.id || verification.status !== "passed") return false;
  if (!verification.evidenceId.trim() || verification.checks.length === 0) return false;
  if (verification.checks.some((check) => check.status !== "passed" || !isCanonicalGameAssetPath(check.assetPath))) return false;
  const sourcePath = changeSet.operations.find((operation) => operation.kind === "duplicate_asset")?.assetPathBefore;
  const save = changeSet.operations.find((operation) => operation.kind === "save_single_asset");
  const finalTarget = save?.assetPathAfter ?? save?.assetPathBefore;
  const oldPaths = [...new Set(changeSet.operations
    .filter((operation) => operation.kind === "rename_asset" || operation.kind === "move_asset")
    .flatMap((operation) => operation.assetPathBefore ? [operation.assetPathBefore] : []))];
  if (sourcePath !== "/Game/Test01" || !finalTarget) return false;
  const hasCheck = (kind: AssetVerificationResult["checks"][number]["kind"], assetPath: string) =>
    verification.checks.some((check) => check.kind === kind && check.assetPath === assetPath && check.status === "passed");
  return hasCheck("source_asset_untouched", sourcePath)
    && hasCheck("asset_exists", finalTarget)
    && hasCheck("single_asset_saved", finalTarget)
    && oldPaths.every((path) => hasCheck("asset_moved", path))
    && !containsSensitiveExternalValue(verification);
}

function isValidExternalRollbackVerification(
  verification: AssetVerificationResult | null,
  changeSet: AssetChangeSet,
): verification is AssetVerificationResult {
  if (!verification || verification.changeSetId !== changeSet.id || verification.status !== "passed") return false;
  if (!isSafeEvidenceId(verification.evidenceId) || verification.checks.length < 2) return false;
  if (verification.checks.some((check) => check.status !== "passed" || !isCanonicalGameAssetPath(check.assetPath))) return false;
  const runRoot = `/Game/UAgentSandbox/${changeSet.runId}`;
  const sourceRestored = verification.checks.some((check) => check.kind === "source_asset_untouched" && check.assetPath === "/Game/Test01");
  const runEmpty = verification.checks.some((check) => check.kind === "asset_deleted_or_trash" && check.assetPath === runRoot);
  return sourceRestored && runEmpty && !containsSensitiveExternalValue(verification);
}

function isCanonicalGameAssetPath(assetPath: string): boolean {
  return assetPath.startsWith("/Game/")
    && assetPath.length > "/Game/".length
    && !assetPath.includes("\\")
    && !assetPath.includes("//")
    && !assetPath.includes("..")
    && !assetPath.includes(":");
}

function isPathWithinGameAsset(assetPath: string, root: string): boolean {
  return assetPath === root || assetPath.startsWith(`${root}/`);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function isSafeEvidenceId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !containsSensitiveExternalValue(value);
}

function hasOnlyObjectKeys(value: unknown, allowed: readonly string[]): boolean {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value as object).every((key) => allowed.includes(key));
}

function containsSensitiveExternalValue(value: unknown): boolean {
  if (typeof value === "string") {
    return /^[A-Za-z]:[\\/]/.test(value)
      || /^\\\\/.test(value)
      || /^file:/i.test(value)
      || (value.startsWith("/") && !value.startsWith("/Game/"))
      || /approval.?token|trusted.?project.?root|pid.?hash|editor.?session|\bsk-[a-z0-9_-]{8,}/i.test(value);
  }
  if (Array.isArray(value)) return value.some(containsSensitiveExternalValue);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => (
    /approval.?token|trusted.?project.?root|pid.?hash|editor.?session/i.test(key)
    || containsSensitiveExternalValue(nested)
  ));
}

function cloneChangeSet(changeSet: AssetChangeSet): AssetChangeSet {
  return {
    ...changeSet,
    operations: cloneOperations(changeSet.operations),
    approval: cloneApproval(changeSet.approval),
    rollbackPlan: cloneRollbackPlan(changeSet.rollbackPlan),
    verification: cloneVerification(changeSet.verification),
    evidenceIds: [...changeSet.evidenceIds],
    redaction: { ...changeSet.redaction },
  };
}

function createMutationTrackedSnapshot<T extends object>(value: T, onMutation: () => void): T {
  const seen = new WeakMap<object, object>();

  const wrap = (target: object): object => {
    const existing = seen.get(target);
    if (existing) return existing;
    const proxy = new Proxy(target, {
      get(current, property, receiver) {
        const result = Reflect.get(current, property, receiver);
        return result && typeof result === "object" ? wrap(result) : result;
      },
      set(current, property, nextValue) {
        onMutation();
        return Reflect.set(current, property, nextValue);
      },
      deleteProperty(current, property) {
        onMutation();
        return Reflect.deleteProperty(current, property);
      },
    });
    seen.set(target, proxy);
    return proxy;
  };

  return wrap(value) as T;
}

function createExternalEvidenceQueries(
  changeSetId: string,
  operations: AssetMutationOperation[],
): AssetDryRunResult["externalEvidenceQueries"] {
  return operations.flatMap((operation) => {
    const afterPath = operation.assetPathAfter;
    const beforePath = operation.assetPathBefore;
    if (operation.kind === "duplicate_asset" && beforePath && afterPath) {
      return [
        evidenceQuery(changeSetId, operation.id, "target-exists", afterPath, "Read-only UE/MCP or Content/UAgentSandbox evidence must confirm the duplicate target exists."),
        evidenceQuery(changeSetId, operation.id, "source-untouched", beforePath, "Read-only UE/MCP state must confirm the source asset remained untouched."),
      ];
    }
    if ((operation.kind === "rename_asset" || operation.kind === "move_asset") && afterPath) {
      return [evidenceQuery(changeSetId, operation.id, "moved", afterPath, "Read-only UE/MCP or Content/UAgentSandbox evidence must confirm old path absence and new path presence.")];
    }
    if (operation.kind === "save_single_asset" && (afterPath ?? beforePath)) {
      return [evidenceQuery(changeSetId, operation.id, "saved", afterPath ?? beforePath!, "Read-only UE/MCP state must confirm a single sandbox asset save, not Save All.")];
    }
    if (operation.kind === "delete_sandbox_asset" && beforePath) {
      return [evidenceQuery(changeSetId, operation.id, "deleted", beforePath, "Read-only UE/MCP or Content/UAgentSandbox evidence must confirm rollback cleanup or sandbox delete state.")];
    }
    return afterPath ? [evidenceQuery(changeSetId, operation.id, "exists", afterPath, "Read-only UE/MCP or Content/UAgentSandbox evidence must confirm sandbox asset existence.")] : [];
  });
}

function evidenceQuery(
  changeSetId: string,
  operationId: string,
  suffix: string,
  assetPath: string,
  summary: string,
): AssetDryRunResult["externalEvidenceQueries"][number] {
  return {
    id: `asset-evidence-query:${hash(`${changeSetId}:${operationId}:${suffix}:${assetPath}`)}`,
    kind: assetPath.startsWith("/Content/") ? "readonly_content_filesystem" : "ue_mcp_asset_state",
    assetPath,
    readOnly: true,
    required: true,
    summary,
  };
}

function createManifestVerification(
  id: string,
  changeSet: AssetChangeSet,
  manifest: AssetManifestRegistry,
  checkedAt: number,
): AssetVerificationResult {
  const checks = changeSet.operations.flatMap((op): AssetVerificationCheck[] => {
    if ((op.kind === "rename_asset" || op.kind === "move_asset") && op.assetPathBefore && op.assetPathAfter) return [verifyAssetMoved(changeSet, op.assetPathBefore, op.assetPathAfter, manifest)];
    if (op.kind === "save_single_asset" && op.assetPathAfter) return [verifySingleAssetSaved(changeSet, op.assetPathAfter, manifest)];
    if (op.kind === "delete_sandbox_asset" && op.assetPathBefore) return [verifyAssetDeletedOrTrash(changeSet, op.assetPathBefore, manifest)];
    if (op.kind === "duplicate_asset" && op.assetPathBefore && op.assetPathAfter) return [verifyAssetExists(changeSet, op.assetPathAfter, manifest), verifySourceAssetUntouched(changeSet, op.assetPathBefore, manifest)];
    return op.assetPathAfter ? [verifyAssetExists(changeSet, op.assetPathAfter, manifest)] : [];
  });
  return {
    id,
    changeSetId: changeSet.id,
    status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    checkedAt,
    checks,
    evidenceId: `asset-evidence:verify:${changeSet.id}`,
    redaction: { ...REDACTED },
    summary: "Verification recorded for sandbox mutation.",
  };
}

function findApprovalToken(
  tokens: Map<string, { changeSetId: string; tokenHash: string; used: boolean; expiresAt: number }>,
  changeSetId: string,
): string | null {
  for (const [value, token] of tokens) {
    if (token.changeSetId === changeSetId) return value;
  }
  return null;
}

function resolveManifestOwnership(
  changeSet: AssetChangeSet,
  operation: AssetMutationOperation,
  entries: AssetManifestEntry[],
): { ok: true; entry: AssetManifestEntry | null; reason: null } | { ok: false; entry: null; reason: string } {
  if (!["rename_asset", "move_asset", "save_single_asset", "delete_sandbox_asset"].includes(operation.kind)) {
    return { ok: true, entry: null, reason: null };
  }
  const expectedPath = operation.kind === "save_single_asset" ? (operation.assetPathAfter ?? operation.assetPathBefore) : operation.assetPathBefore;
  const entry = operation.manifestEntryId
    ? entries.find((item) => item.id === operation.manifestEntryId) ?? null
    : entries.find((item) => item.assetPath === expectedPath) ?? null;
  if (!entry) return { ok: false, entry: null, reason: "manifest_entry_required" };
  if (entry.projectId !== changeSet.projectId) return { ok: false, entry: null, reason: "manifest_project_mismatch" };
  if (entry.editorSessionId !== changeSet.editorSessionId) return { ok: false, entry: null, reason: "manifest_session_mismatch" };
  if (entry.currentState === "deleted" || entry.currentState === "rolled_back") return { ok: false, entry: null, reason: "manifest_state_mismatch" };
  if (operation.kind === "rename_asset" || operation.kind === "move_asset") {
    if (!operation.assetPathBefore || !operation.assetPathAfter || entry.assetPath !== operation.assetPathBefore) {
      return { ok: false, entry: null, reason: "manifest_path_mismatch" };
    }
  }
  if (operation.kind === "delete_sandbox_asset" && (!operation.assetPathBefore || entry.assetPath !== operation.assetPathBefore)) {
    return { ok: false, entry: null, reason: "manifest_path_mismatch" };
  }
  if (operation.kind === "save_single_asset" && (!expectedPath || entry.assetPath !== expectedPath)) {
    return { ok: false, entry: null, reason: "manifest_path_mismatch" };
  }
  return { ok: true, entry, reason: null };
}

function resolveRollbackManifestOwnership(
  changeSet: AssetChangeSet,
  operation: AssetMutationOperation,
  manifest: AssetManifestRegistry,
): { ok: true; entry: AssetManifestEntry; reason: null } | { ok: false; entry: null; reason: string } {
  if (!operation.manifestEntryId) return { ok: false, entry: null, reason: "rollback_manifest_entry_required" };
  const entry = manifest.get(operation.manifestEntryId);
  if (!entry) return { ok: false, entry: null, reason: "rollback_manifest_entry_required" };
  if (entry.projectId !== changeSet.projectId) return { ok: false, entry: null, reason: "rollback_manifest_project_mismatch" };
  if (entry.editorSessionId !== changeSet.editorSessionId) return { ok: false, entry: null, reason: "rollback_manifest_session_mismatch" };
  if (entry.runId !== changeSet.runId) return { ok: false, entry: null, reason: "rollback_manifest_run_mismatch" };
  if (entry.currentState === "rolled_back") return { ok: false, entry: null, reason: "rollback_manifest_state_mismatch" };
  if (!operation.assetPathAfter || entry.assetPath !== operation.assetPathAfter) {
    return { ok: false, entry: null, reason: "rollback_manifest_path_mismatch" };
  }
  return { ok: true, entry, reason: null };
}

function applyRollbackManifestTransition(
  manifest: AssetManifestRegistry,
  entry: AssetManifestEntry,
  operation: AssetMutationOperation,
  evidenceId: string,
): void {
  if (operation.kind === "move_asset" && operation.assetPathBefore) {
    manifest.markMoved(entry.id, operation.assetPathBefore, operation.id, evidenceId);
    return;
  }
  if (operation.kind === "rename_asset" && operation.assetPathBefore) {
    manifest.markRenamed(entry.id, operation.assetPathBefore, operation.id, evidenceId);
    return;
  }
  manifest.rollbackState(entry.id, evidenceId);
}

function createExecutionResult(
  id: string,
  changeSet: AssetChangeSet,
  operations: AssetMutationOperation[],
  evidenceIds: string[],
  status: AssetExecutionResult["status"],
  reason: string | null,
  executedAt: number,
): AssetExecutionResult {
  return {
    id,
    changeSetId: changeSet.id,
    status,
    reason,
    executedAt,
    affectedAssets: changeSet.operations.flatMap((op) => [op.assetPathBefore, op.assetPathAfter].filter((path): path is string => Boolean(path))),
    manifestEntryIds: operations.flatMap((op) => (op.manifestEntryId ? [op.manifestEntryId] : [])),
    evidenceId: evidenceIds[0] ?? "asset-evidence:execute",
    redaction: { ...REDACTED },
    summary: status === "executed" ? "Executed exact sandbox asset allowlist operations." : "Asset mutation execution did not complete.",
  };
}

function mergeOperations(current: AssetMutationOperation[], processed: AssetMutationOperation[]): AssetMutationOperation[] {
  const processedById = new Map(processed.map((operation) => [operation.id, operation]));
  return current.map((operation) => processedById.get(operation.id) ?? operation);
}

function hasRollbackOwnership(operations: AssetMutationOperation[]): boolean {
  return operations.some((operation) => Boolean(operation.manifestEntryId));
}

function createRollbackPlan(changeSetId: string, operations: AssetMutationOperation[]): AssetRollbackPlan {
  return {
    id: `asset-rollback:${changeSetId}`,
    changeSetId,
    actions: operations.map((operation) => ({
      id: `asset-rollback:${operation.id}`,
      operationId: operation.id,
      action: operation.kind === "rename_asset" ? "rename_back" : operation.kind === "move_asset" ? "move_back" : operation.kind === "delete_sandbox_asset" ? "restore_from_trash" : operation.kind === "save_single_asset" ? "none" : "delete_created",
      assetPath: operation.assetPathAfter ?? operation.assetPathBefore ?? "/Game/UAgentSandbox",
      status: operation.kind === "save_single_asset" ? "not_applicable" : "pending",
      evidenceId: null,
      summary: `Rollback ${operation.kind} within UAgentSandbox only.`,
    })),
    cleanupRequired: operations.some((operation) => operation.kind === "delete_sandbox_asset"),
    summary: "Rollback is bound to manifest-owned sandbox assets only.",
  };
}

function summarizeOperation(operation: AssetMutationDraftOperation): string {
  return `${operation.kind}: ${operation.assetPathBefore ?? "new"} -> ${operation.assetPathAfter ?? "removed"}`;
}

function extractRunId(assetPath: string | null): string {
  return assetPath?.split("/")[3] ?? "run";
}

function hash(value: string): string {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) result = (result * 31 + value.charCodeAt(i)) >>> 0;
  return `hash:${result.toString(16)}`;
}
