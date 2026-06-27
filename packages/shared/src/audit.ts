export type AuditEventType =
  | "task_submitted"
  | "task_completed"
  | "task_failed"
  | "task_cancelled"
  | "provider_request_started"
  | "provider_request_completed"
  | "provider_request_failed"
  | "provider_request_cancelled"
  | "mcp_tool_blocked"
  | "mcp_connection_failed"
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
  | "session_archived";

export interface AuditActor {
  type: "user" | "system" | "policy" | "fixture";
  id: string;
  label: string;
}

export interface AuditEvent {
  id: string;
  type: AuditEventType;
  taskId: string | null;
  sessionId: string | null;
  actor: AuditActor;
  title: string;
  body: string;
  summary: string;
  redacted: boolean;
  createdAt: number;
  payload?: Record<string, unknown>;
}

export interface AuditProjection {
  events: AuditEvent[];
  totalCount: number;
  filterSummary: AuditFilterSummary | null;
}

export interface AuditFilterSummary {
  taskId: string | null;
  eventTypes: AuditEventType[];
  riskLevels: string[];
  terminalStates: string[];
  providerModes: string[];
  fromTick: number | null;
  toTick: number | null;
}
