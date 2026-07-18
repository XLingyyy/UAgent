import type { ContextPackRedactionSummary } from "./ue-diagnostics.js";

export const ASSET_MUTATION_OPERATION_KINDS = [
  "create_folder",
  "duplicate_asset",
  "create_test_asset",
  "rename_asset",
  "move_asset",
  "save_single_asset",
  "delete_sandbox_asset",
] as const;

export type AssetMutationOperationKind = (typeof ASSET_MUTATION_OPERATION_KINDS)[number];

export const ASSET_MUTATION_RISKS = [
  "low_sandbox",
  "medium_sandbox",
  "high_destructive",
  "blocked_non_sandbox",
  "blocked_bulk",
  "blocked_unknown",
] as const;

export type AssetMutationRisk = (typeof ASSET_MUTATION_RISKS)[number];

export type AssetManifestState = "created" | "renamed" | "moved" | "saved" | "deleted" | "rolled_back";

export type AssetRollbackActionKind =
  | "delete_created"
  | "rename_back"
  | "move_back"
  | "restore_from_trash"
  | "none";

export interface AssetManifestEntry {
  id: string;
  projectId: string;
  editorSessionId: string;
  runId: string;
  assetPath: string;
  packagePath: string;
  sourceOperationId: string;
  sourceAssetPath?: string;
  createdAt: number;
  currentState: AssetManifestState;
  rollbackAction: AssetRollbackActionKind;
  evidenceIds: string[];
}

export type AssetDryRunHashSource = "fixture" | "local" | "ue_mcp_exact_tool";
export type AssetDryRunHashAlgorithm = "sha1" | "polynomial32";
export type AssetDryRunSchemaVersion = "mvp15c.dry-run.v1" | "local.v0";
export type AssetExternalBindingStatus = "local_fixture" | "external_pending" | "external_bound" | "blocked";

export interface AssetMutationOperationProvenance {
  exactToolName: string;
  dryRunHash: string;
  dryRunHashSource: AssetDryRunHashSource;
  dryRunHashAlgorithm: AssetDryRunHashAlgorithm;
  dryRunSchemaVersion: AssetDryRunSchemaVersion;
  argsHash: string;
}

export interface AssetMutationOperation {
  id: string;
  kind: AssetMutationOperationKind;
  assetPathBefore: string | null;
  assetPathAfter: string | null;
  sandboxRoot: "/Game/UAgentSandbox";
  manifestEntryId: string | null;
  dryRunHash: string;
  argsHash: string;
  summary: string;
  blockedReason?: string | null;
  /** Per-operation execution result for the Changes audit. Pending also covers operations not reached after an earlier failure. */
  executionStatus?: "pending" | "executed" | "partial_failure" | "failed" | "blocked";
  /** Exact-tool evidence for this operation only; never substitute an aggregate execution evidence id. */
  executionEvidenceId?: string | null;
  /** True only when the exact plugin reported a failed operation with an observed, reversible side effect. */
  partialSideEffectObserved?: boolean;
  /**
   * External dry-run binding provenance. Only present for real-mode operations whose
   * hash was issued by the live UE MCP exact tool. Fixture/local operations leave this
   * null and are never eligible for real approval.
   */
  provenance?: AssetMutationOperationProvenance | null;
}

export type AssetChangeSetState =
  | "draft"
  | "dry_run_completed"
  | "previewed"
  | "approval_required"
  | "approved"
  | "rejected"
  | "expired"
  | "executing"
  | "executed"
  | "verifying"
  | "verified"
  | "failed"
  | "rollback_available"
  | "rolled_back"
  | "discarded";

export interface AssetDryRunResult {
  id: string;
  changeSetId: string;
  status: "dry_run_completed" | "blocked";
  reason: string | null;
  wouldChange: boolean;
  operations: AssetMutationOperation[];
  risk: AssetMutationRisk;
  dryRunHash: string;
  argsHash: string;
  affectedAssets: string[];
  rollbackPlan: AssetRollbackPlan;
  externalEvidenceQueries: AssetExternalEvidenceQuery[];
  redaction: ContextPackRedactionSummary;
  createdAt: number;
  /**
   * Binding state for external (live MCP) dry-run provenance. Fixture/local routes
   * keep `local_fixture`. Real routes start at `external_pending` and only advance to
   * `external_bound` after every operation has a validated plugin-issued hash.
   */
  externalBindingStatus?: AssetExternalBindingStatus;
  externalBindingReason?: string | null;
  /**
   * Stable SHA-256 over the canonical aggregate binding payload. Only present for real
   * mode once the full ordered ChangeSet is bound. Fixture/local ChangeSets keep the
   * legacy deterministic hash in `dryRunHash` and leave this null.
   */
  aggregateDryRunHash?: string | null;
  aggregateArgsHash?: string | null;
}

export type AssetExternalEvidenceQueryKind =
  | "ue_mcp_asset_state"
  | "readonly_content_filesystem";

export interface AssetExternalEvidenceQuery {
  id: string;
  kind: AssetExternalEvidenceQueryKind;
  assetPath: string;
  readOnly: true;
  required: true;
  summary: string;
}

export type AssetApprovalStatus = "issued" | "used" | "expired" | "rejected" | "invalid";

export interface AssetApproval {
  approvalId: string;
  changeSetId: string;
  projectId: string;
  trustedRootId: string;
  editorSessionId: string;
  pidHash: string;
  runId: string;
  /** Legacy singular summary retained for compatibility; real approval MUST verify orderedOperationIds/kinds instead. */
  operationKind: AssetMutationOperationKind;
  assetPaths: string[];
  /** Legacy singular dry-run hash; real approval MUST verify aggregateDryRunHash instead. */
  dryRunHash: string;
  /** Legacy singular args hash; real approval MUST verify aggregateArgsHash instead. */
  argsHash: string;
  manifestEntryIds: string[];
  /** Full ordered operation ids bound by this approval. Empty for fixture/local approval kept for compatibility. */
  orderedOperationIds?: string[];
  /** Full ordered operation kinds bound by this approval (parallel to orderedOperationIds). */
  orderedOperationKinds?: AssetMutationOperationKind[];
  /** Stable SHA-256 over the canonical aggregate binding payload (real mode only). */
  aggregateDryRunHash?: string | null;
  /** Stable SHA-256 over canonical per-operation args (real mode only). */
  aggregateArgsHash?: string | null;
  /** External binding status at approval time; real approval requires external_bound. */
  externalBindingStatus?: AssetExternalBindingStatus;
  actor: string;
  reason: string;
  issuedAt: number;
  expiresAt: number;
  status: AssetApprovalStatus;
  tokenHash: string;
}

export interface AssetExecutionResult {
  id: string;
  changeSetId: string;
  status: "executed" | "blocked" | "failed";
  reason: string | null;
  executedAt: number;
  affectedAssets: string[];
  manifestEntryIds: string[];
  evidenceId: string;
  redaction: ContextPackRedactionSummary;
  summary: string;
}

export interface AssetRollbackPlan {
  id: string;
  changeSetId: string;
  actions: AssetRollbackAction[];
  cleanupRequired: boolean;
  summary: string;
}

export interface AssetRollbackAction {
  id: string;
  operationId: string;
  action: AssetRollbackActionKind;
  assetPath: string;
  status: "pending" | "completed" | "failed" | "not_applicable";
  evidenceId: string | null;
  summary: string;
}

export interface AssetVerificationCheck {
  id: string;
  kind:
    | "asset_exists"
    | "asset_moved"
    | "asset_deleted_or_trash"
    | "single_asset_saved"
    | "source_asset_untouched";
  status: "passed" | "failed" | "blocked";
  assetPath: string;
  summary: string;
}

export interface AssetVerificationResult {
  id: string;
  changeSetId: string;
  status: "passed" | "failed" | "blocked";
  checkedAt: number;
  checks: AssetVerificationCheck[];
  evidenceId: string;
  redaction: ContextPackRedactionSummary;
  summary: string;
}

export type AssetMutationAuditEventType =
  | "asset_mutation_dry_run"
  | "asset_changeset_created"
  | "asset_mutation_approved"
  | "asset_mutation_executed"
  | "asset_mutation_verified"
  | "asset_mutation_rolled_back";

export interface AssetMutationEvidencePayload {
  changeSetId: string;
  eventType: AssetMutationAuditEventType;
  summary: string;
  affectedAssets: string[];
  manifestEntryIds: string[];
  verification: AssetVerificationResult | null;
  redaction: ContextPackRedactionSummary;
  replayOnly: boolean;
}

export interface AssetChangeSet {
  id: string;
  projectId: string;
  trustedRootId: string;
  editorSessionId: string;
  pidHash: string;
  dryRunId: string;
  runId: string;
  state: AssetChangeSetState;
  operations: AssetMutationOperation[];
  risk: AssetMutationRisk;
  approval: AssetApproval | null;
  rollbackPlan: AssetRollbackPlan;
  verification: AssetVerificationResult | null;
  evidenceIds: string[];
  redaction: ContextPackRedactionSummary;
  /** External binding status for real-mode ChangeSets; fixture/local stays local_fixture. */
  externalBindingStatus?: AssetExternalBindingStatus;
  externalBindingReason?: string | null;
  aggregateDryRunHash?: string | null;
  aggregateArgsHash?: string | null;
  /** Safe UI-visible state only. Native registration identifiers remain private runtime state. */
  nativeApprovalRegistrationStatus?: "not_required" | "required" | "registered" | "blocked";
  nativeApprovalRegistrationReason?: string | null;
}

/** Canonical operation binding registered with the native one-shot approval registry. */
export interface AssetMutationApprovalOperationBinding {
  operationId: string;
  kind: "create_folder" | "duplicate" | "rename" | "move" | "save" | "cleanup_empty_folder" | "delete_duplicate" | "rename_back" | "move_back";
  toolName: string;
  pluginDryRunHash: string;
  argsHash: string;
  sourceAssetPath?: string | null;
  assetPath?: string | null;
  targetAssetPath?: string | null;
  rollbackAction: "cleanup_empty_folder" | "delete_duplicate" | "rename_back" | "move_back" | "none";
  rollbackToolName?: string | null;
  saveAll: false;
  bulk: false;
}

/** Safe runtime-side registration request. Native issues the one-shot token after validating this binding. */
export interface AssetMutationApprovalRegistrationRequest {
  changeSetId: string;
  runId: string;
  projectBindingId: string;
  trustedRootRef: string;
  editorSessionId: string;
  pidHash: string;
  observedEditorSessionId: string;
  observedPidHash: string;
  aggregateDryRunHash: string;
  aggregateArgsHash: string;
  requestedTtlMs: number;
  assetMutationGateEnabled: boolean;
  operations: AssetMutationApprovalOperationBinding[];
}

export interface AssetMutationApprovalRegistrationResult {
  status: "registered" | "blocked" | "failed";
  reason: string | null;
  registrationId?: string | null;
  trustedRootId?: string | null;
  operationCount?: number;
  /** Returned once by native and retained only in short-lived runtime/renderer memory. */
  approvalToken?: string | null;
  issuedAt?: number;
  expiresAt?: number;
}

export interface AssetMutationOperationGuardRequest {
  registrationId: string;
  approvalToken?: string | null;
  phase: "execute" | "rollback";
  operationIndex: number;
  operationCount: number;
  changeSetId: string;
  runId: string;
  projectBindingId: string;
  trustedRootId: string;
  editorSessionId: string;
  pidHash: string;
  observedEditorSessionId: string;
  observedPidHash: string;
  aggregateDryRunHash: string;
  aggregateArgsHash: string;
  assetMutationGateEnabled: boolean;
  operation: AssetMutationApprovalOperationBinding;
}

export interface AssetMutationOperationGuardResult {
  status: "accepted_by_native_guard" | "blocked" | "failed";
  reason: string | null;
  registrationId?: string | null;
  phase?: "execute" | "rollback" | null;
  operationId?: string | null;
  operationIndex?: number;
  operationCount?: number;
  evidenceId?: string | null;
}

export interface AssetMutationOutcomeRequest {
  registrationId: string;
  phase: "execute" | "rollback";
  operationId: string;
  success: boolean;
  sideEffectObserved: boolean;
  rollbackAvailable: boolean;
  evidenceId?: string | null;
  reasonCode?: string | null;
}

export interface AssetMutationOutcomeResult {
  status: "recorded" | "blocked" | "failed";
  reason: string | null;
  registrationId?: string | null;
  phase?: "execute" | "rollback" | null;
  operationId?: string | null;
  rollbackAvailable?: boolean;
  terminal?: boolean;
}

/** Strict structured result emitted by an execution-capable exact UE asset tool. */
export interface AssetMutationPluginExecutionResult {
  blocked: boolean;
  status: string;
  reasonCode: string;
  toolName: string;
  operation: string;
  phase: "execute" | "rollback";
  changeSetId: string;
  runId: string;
  sandboxRoot: string;
  sideEffectObserved: boolean;
  wouldChange: boolean;
  wouldModify: string[];
  wouldRead: string[];
  affectedAssets: {
    readOnlySources: string[];
    sandboxTargets: string[];
    externalTargets: string[];
  };
  rollbackPlan: {
    strategy: string;
    executionEnabled: boolean;
    inverseOperation: string;
    summary?: string;
  };
  externalEvidenceQueries: Array<{ queryKind: string; readOnly: true; paths: string[] }>;
  dryRunHash: string;
  hashAlgorithm: "sha1";
  schemaVersion: "mvp15c.dry-run.v1";
  approvalRequired: true;
  evidenceId: string;
  rollbackAvailable: boolean;
  rollbackStatus: string;
  implementationStatus: "execution_capable";
}

/** Safe native registration binding retained only in runtime memory for read-only evidence calls. */
export interface AssetMutationExternalRegistrationBinding {
  registrationId: string;
  projectBindingId: string;
  trustedRootId: string;
}

export interface AssetContentEvidenceRequest extends AssetMutationExternalRegistrationBinding {
  assetPath: string;
}

export interface AssetContentEvidenceObservation {
  status: "observed" | "blocked" | "failed";
  reason: string;
  assetPath: string;
  exists: boolean;
  size: number | null;
  sha256: string | null;
  evidenceId: string | null;
}

export interface AssetContentManifestEntry {
  assetPath: string;
  size: number;
  sha256: string;
}

export interface AssetContentManifestObservation {
  status: "observed" | "blocked" | "failed";
  reason: string;
  entries: AssetContentManifestEntry[];
  aggregateSha256: string | null;
  evidenceId: string | null;
}

export interface AssetExternalVerificationBaseline {
  source: AssetContentEvidenceObservation;
  contentManifest: AssetContentManifestObservation;
}
