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
}
