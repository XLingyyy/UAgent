export type PermissionMode = "auto" | "request_approval" | "plan_only";

export type TaskState =
  | "draft"
  | "submitted"
  | "planning"
  | "executing"
  | "awaiting_approval"
  | "observing"
  | "reviewing"
  | "completed"
  | "failed"
  | "cancelled";

export type TaskEventType =
  | "task_submitted"
  | "plan_created"
  | "tool_started"
  | "tool_completed"
  | "approval_requested"
  | "evidence_created"
  | "review_created"
  | "task_completed"
  | "task_failed"
  | "cancel_task_requested"
  | "task_cancelled"
  | "agent_plan_started"
  | "agent_plan_created"
  | "agent_step_started"
  | "agent_step_completed"
  | "agent_observation_created"
  | "agent_report_created"
  | "agent_step_failed"
  | "mcp_connection_started"
  | "mcp_connected"
  | "mcp_discovery_started"
  | "mcp_discovery_completed"
  | "mcp_read_started"
  | "mcp_read_completed"
  | "mcp_tool_blocked"
  | "mcp_connection_failed"
  | "mcp_disconnected"
  | "mcp_fallback_to_mock"
  | "provider_request_started"
  | "provider_stream_started"
  | "provider_stream_delta"
  | "provider_stream_completed"
  | "provider_request_completed"
   | "provider_request_failed"
   | "provider_request_cancelled"
   | "provider_usage_recorded"
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
   | "audit_event_recorded"
   | "project_root_validated"
   | "project_index_started"
   | "project_index_progress"
   | "project_index_completed"
   | "project_index_failed"
   | "project_index_cancelled"
   | "file_preview_requested"
   | "file_preview_blocked"
   | "file_preview_completed"
    | "capability_requested"
    | "capability_blocked"
    | "capability_completed"
    | "capability_cancelled"
    | "capability_timed_out"
    | "terminal_proposed"
    | "terminal_approved"
    | "terminal_rejected"
    | "terminal_started"
    | "terminal_output"
    | "terminal_completed"
    | "terminal_failed"
    | "terminal_cancelled"
    | "terminal_blocked"
    | "browser_preview_created"
    | "browser_preview_blocked"
    | "browser_preview_completed"
    | "screenshot_requested"
    | "screenshot_captured"
    | "screenshot_denied"
    | "screenshot_failed"
    | "watcher_started"
    | "watcher_changed"
    | "watcher_diff_generated"
    | "watcher_applied"
    | "watcher_rescanned"
    | "watcher_overflow"
     | "watcher_stopped"
     | "watcher_error"
     | "terminal_real_started"
     | "terminal_real_chunk"
     | "terminal_real_completed"
     | "mutation_violation"
     | "build_loop_review"
     | "approval_token_issued"
     | "approval_token_used"
     | "approval_token_expired"
     | "approval_token_revoked"
     | "diagnostic_started"
     | "diagnostic_completed"
     | "diagnostic_failed"
     | "context_pack_created";

export type TaskEventLevel = "info" | "success" | "warning" | "error";

export interface TaskDraft {
  input: string;
  projectId: string | null;
  permissionMode: PermissionMode;
  modelId: string;
  reasoningEffort: string;
  runMode: "local" | "sandbox";
  branch: string;
  contextPercent: number;
  providerStatus?: "configured" | "not_configured";
  networkMode?: string;
  createdAt?: number;
}

export interface TaskRecord {
  id: string;
  title: string;
  state: TaskState;
  draft: TaskDraft;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  error: string | null;
}

export interface TaskEvent<TPayload = unknown> {
  id: string;
  taskId: string;
  type: TaskEventType;
  title: string;
  body?: string;
  level?: TaskEventLevel;
  createdAt: number;
  payload?: TPayload;
}

export function createTaskId(sequence: number): string {
  return `task-${sequence.toString().padStart(4, "0")}`;
}

export function createEventId(taskId: string, sequence: number): string {
  return `${taskId}-event-${sequence.toString().padStart(4, "0")}`;
}

export function createEvidenceId(sequence: number): string {
  return `evidence-${sequence.toString().padStart(4, "0")}`;
}

export function isTerminalTaskState(state: TaskState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

export function createTaskTitle(input: string): string {
  const normalized = input.trim().replace(/\s+/g, " ");
  if (!normalized) {
    return "Untitled mock task";
  }
  return normalized.length > 72 ? `${normalized.slice(0, 69)}...` : normalized;
}
