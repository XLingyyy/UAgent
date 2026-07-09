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
  | "session_archived"
  | "project_root_validated"
  | "project_index_started"
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
    | "diagnostic_started"
    | "diagnostic_completed"
    | "diagnostic_failed"
    | "context_pack_created"
    | "editor_session_started"
    | "editor_operation_proposed"
    | "editor_operation_approved"
    | "editor_operation_executed"
    | "editor_process_discovered"
    | "editor_attached"
    | "editor_heartbeat"
    | "editor_observation_snapshot"
    | "editor_session_expired"
    | "editor_process_exited"
    | "mcp_mutation_proposed"
    | "mcp_mutation_blocked"
    | "mcp_dry_run_completed"
    | "asset_mutation_dry_run"
    | "asset_changeset_created"
    | "asset_mutation_approved"
    | "asset_mutation_executed"
    | "asset_mutation_verified"
    | "asset_mutation_rolled_back";

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
  editorSessionId?: string | null;
  operationId?: string | null;
  changeSetId?: string | null;
  toolName?: string | null;
  affectedFile?: string | null;
  processState?: string | null;
  affectedAsset?: string | null;
  fromTick: number | null;
  toTick: number | null;
}
