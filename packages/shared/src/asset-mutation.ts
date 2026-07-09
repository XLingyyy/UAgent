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
  operationKind: AssetMutationOperationKind;
  assetPaths: string[];
  dryRunHash: string;
  argsHash: string;
  manifestEntryIds: string[];
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
  state: AssetChangeSetState;
  operations: AssetMutationOperation[];
  risk: AssetMutationRisk;
  approval: AssetApproval | null;
  rollbackPlan: AssetRollbackPlan;
  verification: AssetVerificationResult | null;
  evidenceIds: string[];
  redaction: ContextPackRedactionSummary;
}
