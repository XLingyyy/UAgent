import type { ToolRiskLevel, PolicyDecision } from "./risk.js";

export type WorkflowEventType =
  | "approval_required"
  | "approval_approved"
  | "approval_denied"
  | "approval_cancelled"
  | "approval_timed_out"
  | "sandbox_started"
  | "sandbox_completed"
  | "sandbox_failed"
  | "sandbox_blocked"
  | "sandbox_timed_out"
  | "change_set_created"
  | "change_set_previewed"
  | "change_set_applied"
  | "change_set_promoted"
  | "change_set_rolled_back"
  | "change_set_discarded"
  | "session_started"
  | "session_resumed"
  | "session_archived"
  | "session_replayed"
  | "audit_event_recorded";

export interface WorkflowEvent {
  id: string;
  type: WorkflowEventType;
  taskId: string;
  title: string;
  body?: string;
  createdAt: number;
  payload?: Record<string, unknown>;
}

export interface WorkflowPolicy {
  riskLevel: ToolRiskLevel;
  defaultDecision: PolicyDecision;
  autoApprove: boolean;
  sandboxRequired: boolean;
}
