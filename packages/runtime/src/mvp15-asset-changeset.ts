import type {
  AssetApproval,
  AssetChangeSet,
  AssetDryRunResult,
  AssetExecutionResult,
  AssetVerificationCheck,
  AssetManifestEntry,
  AssetMutationOperation,
  AssetMutationOperationKind,
  AssetMutationRisk,
  AssetRollbackPlan,
  AssetVerificationResult,
} from "@uagent/shared";
import { classifyAssetMutationRisk, createSandboxAssetPathPolicy } from "./mvp15-asset-policy.js";
import type { AssetManifestRegistry } from "./mvp15-asset-manifest.js";
import { verifyAssetDeletedOrTrash, verifyAssetExists, verifyAssetMoved, verifySingleAssetSaved, verifySourceAssetUntouched } from "./mvp15-asset-verification.js";

const REDACTED = { redacted: true, replacedPaths: 0, replacedSecrets: 0 };
type MaybePromise<T> = T | Promise<T>;

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
  let counter = 0;

  function store(changeSet: AssetChangeSet): AssetChangeSet {
    changeSets.set(changeSet.id, changeSet);
    return changeSet;
  }

  function blocked(input: AssetMutationDryRunInput, reason: string, risk: AssetMutationRisk): AssetMutationServiceResult & { dryRun: AssetDryRunResult; changeSet: AssetChangeSet } {
    const id = nextId("asset-changeset");
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
      redaction: REDACTED,
      createdAt: now(),
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
        });
      }

      const id = nextId("asset-changeset");
      const dryRunId = nextId("asset-dry-run");
      const rollbackPlan = createRollbackPlan(id, operations);
      const risk = operations.reduce<AssetMutationRisk>((current, op) => {
        const opRisk = classifyAssetMutationRisk(op.kind, null);
        if (opRisk === "high_destructive") return opRisk;
        if (opRisk === "medium_sandbox" && current === "low_sandbox") return opRisk;
        return current;
      }, "low_sandbox");
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
        redaction: REDACTED,
        createdAt: now(),
      };
      const changeSet = store(createChangeSet(input, id, dryRun, operations, risk));
      return { status: "dry_run_completed", reason: null, dryRun, changeSet };
    },
    preview(changeSetId) {
      const current = changeSets.get(changeSetId);
      if (!current) return { status: "blocked", reason: "changeset_required", changeSet: null };
      return { status: "previewed", reason: null, changeSet: store({ ...current, state: "approval_required" }) };
    },
    approve(input) {
      const current = changeSets.get(input.changeSetId);
      if (!current) return { status: "blocked", reason: "changeset_required", changeSet: null, approvalToken: null };
      if (current.state !== "approval_required") return { status: "blocked", reason: "approval_required", changeSet: current, approvalToken: null };
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
        actor: input.actor,
        reason: input.reason,
        issuedAt,
        expiresAt: issuedAt + ttl,
        status: "issued",
        tokenHash: hash(approvalToken),
      };
      tokens.set(approvalToken, { changeSetId: current.id, tokenHash: approval.tokenHash, used: false, expiresAt: approval.expiresAt });
      const changeSet = store({ ...current, state: "approved", approval });
      return { status: "approved", reason: null, changeSet, approvalToken };
    },
    async execute(input) {
      const current = changeSets.get(input.changeSetId);
      if (!current) return { status: "blocked", reason: "changeset_required", changeSet: null };
      const token = tokens.get(input.approvalToken);
      if (!token || token.changeSetId !== input.changeSetId || current.approval?.tokenHash !== token.tokenHash) return { status: "blocked", reason: "forged_token", changeSet: current };
      if (token.used) return { status: "blocked", reason: "replay_token", changeSet: current };
      if (input.editorSessionId !== current.editorSessionId) return { status: "blocked", reason: "session_mismatch", changeSet: current };
      if (input.pidHash !== current.pidHash) return { status: "blocked", reason: "pid_mismatch", changeSet: current };
      if (now() >= token.expiresAt) return { status: "blocked", reason: "expired_token", changeSet: store({ ...current, state: "expired", approval: current.approval ? { ...current.approval, status: "expired" } : null }) };
      const nextOps: AssetMutationOperation[] = [];
      const evidenceIds: string[] = [];
      for (const op of current.operations) {
        const ownership = resolveManifestOwnership(current, op, options.manifest.list());
        if (!ownership.ok) {
          const execution = createExecutionResult(nextId("asset-execution"), current, nextOps, evidenceIds, "blocked", ownership.reason, now());
          const state = evidenceIds.length > 0 ? "rollback_available" : current.state;
          const changeSet = store({ ...current, state, operations: mergeOperations(current.operations, nextOps), evidenceIds: [...current.evidenceIds, ...evidenceIds] });
          return { status: "blocked", reason: ownership.reason, changeSet, execution };
        }
        token.used = true;
        const result = await options.adapter.execute(op, {
          changeSet: current,
          approvalToken: input.approvalToken,
          editorSessionId: input.editorSessionId,
          pidHash: input.pidHash,
          dryRunHash: op.dryRunHash,
        });
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
          return { status: "failed", reason: execution.reason, changeSet, execution };
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
      return { status: "executed", reason: null, changeSet, execution };
    },
    async verify(changeSetId) {
      const current = changeSets.get(changeSetId);
      if (!current) return { status: "blocked", reason: "changeset_required", changeSet: null };
      const verification = options.verification
        ? await options.verification.verify(current, { manifest: options.manifest })
        : options.executionMode === "real"
          ? createBlockedRealVerification(nextId("asset-verification"), current, now())
          : createManifestVerification(nextId("asset-verification"), current, options.manifest, now());
      const nextState = verification.status === "passed" ? "verified" : verification.status === "blocked" ? "rollback_available" : "failed";
      const status = verification.status === "passed" ? "verified" : verification.status;
      const reason = verification.status === "passed" ? null : verification.status === "blocked" ? "real_verification_required" : "verification_failed";
      const changeSet = store({ ...current, state: nextState, verification, evidenceIds: [...new Set([...current.evidenceIds, verification.evidenceId])] });
      return { status, reason, changeSet, verification };
    },
    async rollback(changeSetId) {
      const current = changeSets.get(changeSetId);
      if (!current) return { status: "blocked", reason: "changeset_required", changeSet: null };
      const approvalToken = findApprovalToken(tokens, changeSetId);
      for (const op of [...current.operations].reverse()) {
        const result = await options.adapter.rollback(op, {
          changeSet: current,
          approvalToken,
          editorSessionId: current.editorSessionId,
          pidHash: current.pidHash,
          dryRunHash: op.dryRunHash,
        });
        if (!result.ok) {
          const changeSet = store({ ...current, state: "rollback_available", evidenceIds: [...new Set([...current.evidenceIds, result.evidenceId])] });
          return { status: "failed", reason: result.reason ?? "adapter_rollback_failed", changeSet };
        }
        if (op.manifestEntryId) options.manifest.rollbackState(op.manifestEntryId, `asset-evidence:rollback:${op.id}`);
      }
      return { status: "rolled_back", reason: null, changeSet: store({ ...current, state: "rolled_back" }) };
    },
    get: (changeSetId) => changeSets.get(changeSetId) ?? null,
    list: () => [...changeSets.values()],
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
    state: dryRun.status === "blocked" ? "failed" : "dry_run_completed",
    operations,
    risk,
    approval: null,
    rollbackPlan: dryRun.rollbackPlan,
    verification: null,
    evidenceIds: [`asset-evidence:dry-run:${id}`],
    redaction: REDACTED,
  };
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
    redaction: REDACTED,
    summary: "Verification recorded for sandbox mutation.",
  };
}

function createBlockedRealVerification(
  id: string,
  changeSet: AssetChangeSet,
  checkedAt: number,
): AssetVerificationResult {
  const checks = changeSet.operations.flatMap((op): AssetVerificationCheck[] => {
    const path = op.assetPathAfter ?? op.assetPathBefore ?? "/Game/UAgentSandbox";
    if (op.kind === "save_single_asset") {
      return [{
        id: `verify:blocked:saved:${hash(path)}`,
        kind: "single_asset_saved" as const,
        status: "blocked" as const,
        assetPath: path,
        summary: "Real single-asset save verification requires UE/MCP read-only state or read-only Content/UAgentSandbox evidence.",
      }];
    }
    if (op.kind === "duplicate_asset" && op.assetPathBefore && op.assetPathAfter) {
      return [
        {
          id: `verify:blocked:exists:${hash(op.assetPathAfter)}`,
          kind: "asset_exists" as const,
          status: "blocked" as const,
          assetPath: op.assetPathAfter,
          summary: "Real duplicate verification requires UE/MCP read-only state or read-only Content/UAgentSandbox evidence.",
        },
        {
          id: `verify:blocked:source:${hash(op.assetPathBefore)}`,
          kind: "source_asset_untouched" as const,
          status: "blocked" as const,
          assetPath: op.assetPathBefore,
          summary: "Source asset untouched verification requires a real read-only asset state check.",
        },
      ];
    }
    if (op.kind === "rename_asset" || op.kind === "move_asset") {
      return [{
        id: `verify:blocked:moved:${hash(path)}`,
        kind: "asset_moved" as const,
        status: "blocked" as const,
        assetPath: path,
        summary: "Real before/after path verification requires UE/MCP read-only state or read-only Content/UAgentSandbox evidence.",
      }];
    }
    if (op.kind === "delete_sandbox_asset") {
      return [{
        id: `verify:blocked:deleted:${hash(path)}`,
        kind: "asset_deleted_or_trash" as const,
        status: "blocked" as const,
        assetPath: path,
        summary: "Real rollback/delete verification requires UE/MCP read-only state or read-only Content/UAgentSandbox evidence.",
      }];
    }
    return [{
      id: `verify:blocked:exists:${hash(path)}`,
      kind: "asset_exists" as const,
      status: "blocked" as const,
      assetPath: path,
      summary: "Real asset existence verification requires UE/MCP read-only state or read-only Content/UAgentSandbox evidence.",
    }];
  });
  return {
    id,
    changeSetId: changeSet.id,
    status: "blocked",
    checkedAt,
    checks,
    evidenceId: `asset-evidence:verify-blocked:${changeSet.id}`,
    redaction: REDACTED,
    summary: "Real verification blocked because no external UE/MCP or read-only filesystem evidence source is configured.",
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
    redaction: REDACTED,
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
