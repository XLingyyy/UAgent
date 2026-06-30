import type { ContextPackRedactionSummary } from "./ue-diagnostics.js";

export const UE_EDITOR_OPERATION_RISKS = [
  "read_only",
  "state_only",
  "text_backed_change",
  "medium_editor_state",
  "high_asset_risk",
  "blocked_asset_write",
  "blocked_unknown",
] as const;

export type UEEditorOperationRisk = (typeof UE_EDITOR_OPERATION_RISKS)[number];

export type UEEditorSessionMode = "fixture" | "attached" | "launched";
export type UEEditorSessionStatus = "disabled" | "blocked" | "attaching" | "attached" | "launching" | "launched" | "stopped" | "expired";

export interface UEEditorCapabilityStatus {
  enabled: boolean;
  mode: "disabled" | "fixture" | "native";
  reason: string;
  trustedRootRequired: true;
  mutationExecution: "blocked" | "state_only";
}

export interface UEEditorSession {
  sessionId: string;
  projectId: string;
  rootId: string;
  uprojectDisplayPath: string;
  mode: UEEditorSessionMode;
  status: UEEditorSessionStatus;
  createdAt: number;
  expiresAt: number;
  replayOnly: boolean;
}

export type UEEditorOperationKind =
  | "status"
  | "open_asset"
  | "focus_content_browser"
  | "select_asset"
  | "run_read_only_validation"
  | "refresh_diagnostics"
  | "open_local_preview"
  | "patch_text_file"
  | "save_asset"
  | "delete_asset"
  | "rename_asset"
  | "move_asset"
  | "compile_blueprint"
  | string;

export type UEEditorOperationProposalStatus = "proposed" | "approval_required" | "approved" | "executed" | "cancelled" | "blocked" | "expired";

export interface UEEditorOperationProposal {
  proposalId: string;
  sessionId: string;
  projectId: string;
  rootId: string;
  operationKind: UEEditorOperationKind;
  argsHash: string;
  risk: UEEditorOperationRisk;
  status: UEEditorOperationProposalStatus;
  summary: string;
  redaction: ContextPackRedactionSummary;
  createdAt: number;
  expiresAt: number;
}

export interface UEEditorOperationApproval {
  token: string;
  proposalId: string;
  sessionId: string;
  projectId: string;
  rootId: string;
  operationKind: UEEditorOperationKind;
  argsHash: string;
  actor: string;
  reason: string;
  approvedAt: number;
  expiresAt: number;
}

export interface UEEditorOperationResult {
  proposalId: string;
  status: "executed" | "blocked" | "cancelled";
  outputSummary: string;
  durationMs: number;
  redaction: ContextPackRedactionSummary;
  evidenceId: string | null;
  executedAt: number;
  replayOnly: boolean;
  reason?: string;
}
