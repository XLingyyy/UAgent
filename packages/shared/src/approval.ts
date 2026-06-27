import type { ToolRiskLevel } from "./risk.js";

export type ApprovalRequestState =
  | "not_required"
  | "pending"
  | "approved"
  | "denied"
  | "cancelled"
  | "timed_out";

export interface ApprovalRequest {
  id: string;
  taskId: string;
  stepId: string | null;
  riskLevel: ToolRiskLevel;
  title: string;
  summary: string;
  scope: ApprovalScope;
  checks: string[];
  timeoutTicks: number;
  state: ApprovalRequestState;
  createdAt: number;
  resolvedAt: number | null;
}

export interface ApprovalScope {
  assets: string[];
  changedFiles: string[];
  commands: string[];
  targetCapabilities: string[];
}

export type ApprovalDecisionValue = "approved" | "denied" | "cancelled";

export interface ApprovalDecision {
  id: string;
  approvalId: string;
  decision: ApprovalDecisionValue;
  actor: string;
  reason: string;
  ticks: number;
  createdAt: number;
}

export interface ApprovalState {
  pendingRequests: ApprovalRequest[];
  resolvedRequests: ApprovalRequest[];
  decisions: ApprovalDecision[];
  lastDecision: ApprovalDecision | null;
}
