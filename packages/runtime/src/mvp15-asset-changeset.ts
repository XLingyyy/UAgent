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
  AssetMutationRisk,
  AssetRollbackPlan,
  AssetVerificationResult,
} from "@uagent/shared";
import { classifyAssetMutationRisk, createSandboxAssetPathPolicy } from "./mvp15-asset-policy.js";
import type { AssetManifestRegistry } from "./mvp15-asset-manifest.js";
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
}

export interface AssetMutationAdapterResult {
  ok: boolean;
  reason: string | null;
  evidenceId: string;
  stateOnFailure?: "failed" | "rollback_available";
}

export interface AssetMutationAdapter {
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
}

export interface AssetChangeSetService {
  dryRun(input: AssetMutationDryRunInput): AssetMutationServiceResult & { dryRun: AssetDryRunResult; changeSet: AssetChangeSet };
  bindExternalDryRun(input: AssetMutationBindExternalInput): Promise<AssetMutationServiceResult & { dryRun: AssetDryRunResult | null; changeSet: AssetChangeSet | null }>;
  preview(changeSetId: string): AssetMutationServiceResult;
  approve(input: AssetMutationApproveInput): AssetMutationServiceResult;
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
  let counter = 0;

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

  function adapterContext(changeSet: AssetChangeSet, approvalToken: string | null, dryRunHash: string): AssetMutationAdapterContext {
    return {
      changeSet: cloneChangeSet(changeSet),
      approvalToken,
      editorSessionId: changeSet.editorSessionId,
      pidHash: changeSet.pidHash,
      dryRunHash,
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

  return {
    dryRun(input) {
      const run = policy.validateRunId(input.runId);
      if (!run.ok) return blocked(input, run.reason, "blocked_unknown");
      if (input.operations.length > 1 && input.operations.every((op) => op.kind === "delete_sandbox_asset")) {
        return blocked(input, "bulk_operation_blocked", "blocked_bulk");
      }

      const operations: AssetMutationOperation[] = [];
      for (const draft of input.operations) {
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
      const approvalToken = `asset-approval-token:${hash(`${current.id}:${issuedAt}:${input.actor}`)}`;
      const approval: AssetApproval = {
        approvalId: nextId("asset-approval"),
        changeSetId: current.id,
        projectId: current.projectId,
        trustedRootId: current.trustedRootId,
        editorSessionId: current.editorSessionId,
        pidHash: current.pidHash,
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
        tokenHash: hash(approvalToken),
      };
      tokens.set(approvalToken, { changeSetId: current.id, tokenHash: approval.tokenHash, used: false, expiresAt: approval.expiresAt });
      const changeSet = store({ ...current, state: "approved", approval });
      return boundary({ status: "approved", reason: null, changeSet, approvalToken });
    },
    async execute(input) {
      const current = changeSets.get(input.changeSetId);
      if (!current) return { status: "blocked", reason: "changeset_required", changeSet: null };
      // Real-mode execute is not enabled at this stage. Even when external binding is complete,
      // live mutation execution stays gated off until the plugin execute path lands in a later task.
      if (options.executionMode === "real") {
        return boundary({ status: "blocked", reason: "execute_not_enabled", changeSet: current });
      }
      const token = tokens.get(input.approvalToken);
      if (!token || token.changeSetId !== input.changeSetId || current.approval?.tokenHash !== token.tokenHash) return boundary({ status: "blocked", reason: "forged_token", changeSet: current });
      if (token.used) return boundary({ status: "blocked", reason: "replay_token", changeSet: current });
      if (input.editorSessionId !== current.editorSessionId) return boundary({ status: "blocked", reason: "session_mismatch", changeSet: current });
      if (input.pidHash !== current.pidHash) return boundary({ status: "blocked", reason: "pid_mismatch", changeSet: current });
      if (now() >= token.expiresAt) return boundary({ status: "blocked", reason: "expired_token", changeSet: store({ ...current, state: "expired", approval: current.approval ? { ...current.approval, status: "expired" } : null }) });
      const nextOps: AssetMutationOperation[] = [];
      const evidenceIds: string[] = [];
      for (const op of current.operations) {
        const ownership = resolveManifestOwnership(current, op, options.manifest.list());
        if (!ownership.ok) {
          const execution = createExecutionResult(nextId("asset-execution"), current, nextOps, evidenceIds, "blocked", ownership.reason, now());
          const state = evidenceIds.length > 0 ? "rollback_available" : current.state;
          const changeSet = store({ ...current, state, operations: mergeOperations(current.operations, nextOps), evidenceIds: [...current.evidenceIds, ...evidenceIds] });
          return boundary({ status: "blocked", reason: ownership.reason, changeSet, execution });
        }
        token.used = true;
        const result = await options.adapter.execute(cloneOperation(op), adapterContext(current, input.approvalToken, op.dryRunHash));
        evidenceIds.push(result.evidenceId);
        if (!result.ok) {
          const execution = createExecutionResult(nextId("asset-execution"), current, nextOps, evidenceIds, "failed", result.reason ?? "adapter_execute_failed", now());
          const failureState = result.stateOnFailure ?? "rollback_available";
          const changeSet = store({
            ...current,
            state: failureState,
            operations: mergeOperations(current.operations, nextOps),
            approval: current.approval ? { ...current.approval, status: "used" } : null,
            evidenceIds: [...current.evidenceIds, ...evidenceIds],
          });
          return boundary({ status: "failed", reason: execution.reason, changeSet, execution });
        }
        let manifestEntry: AssetManifestEntry | null = null;
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
        nextOps.push({ ...op, manifestEntryId: manifestEntry?.id ?? op.manifestEntryId });
      }
      const execution = createExecutionResult(nextId("asset-execution"), current, nextOps, evidenceIds, "executed", null, now());
      const changeSet = store({ ...current, state: "executed", operations: nextOps, approval: current.approval ? { ...current.approval, status: "used" } : null, evidenceIds: [...current.evidenceIds, ...evidenceIds] });
      return boundary({ status: "executed", reason: null, changeSet, execution });
    },
    async verify(changeSetId) {
      const current = changeSets.get(changeSetId);
      if (!current) return { status: "blocked", reason: "changeset_required", changeSet: null };
      if (options.executionMode === "real") {
        return boundary({ status: "blocked", reason: "verify_not_enabled", changeSet: current });
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
        return boundary({ status: "blocked", reason: "rollback_not_enabled", changeSet: current });
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

function createRollbackPlan(changeSetId: string, operations: AssetMutationOperation[]): AssetRollbackPlan {
  return {
    id: `asset-rollback:${changeSetId}`,
    changeSetId,
    actions: operations.map((operation) => ({
      id: `asset-rollback:${operation.id}`,
      operationId: operation.id,
      action: operation.kind === "rename_asset" ? "rename_back" : operation.kind === "move_asset" ? "move_back" : operation.kind === "delete_sandbox_asset" ? "restore_from_trash" : "delete_created",
      assetPath: operation.assetPathAfter ?? operation.assetPathBefore ?? "/Game/UAgentSandbox",
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
