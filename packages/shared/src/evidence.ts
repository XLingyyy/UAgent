export type EvidenceKind =
  | "project_summary"
  | "asset_reference"
  | "tool_result"
  | "diagnostic"
  | "artifact_placeholder"
  | "project_index_summary"
  | "file_preview_summary"
  | "capability_decision"
  | "native_root_validation"
  | "native_scan_summary"
  | "native_preview_summary"
  | "native_policy_block"
  | "terminal_output"
  | "build_run_summary"
  | "mutation_violation"
  | "terminal_real_output"
  | "ue_project_metadata"
  | "ue_project_diagnostic"
  | "build_failure_summary"
  | "context_pack_summary"
  | "editor_session_summary"
  | "editor_operation_summary"
  | "mcp_mutation_summary"
  | "editor_process_observation"
  | "editor_heartbeat"
  | "editor_snapshot"
  | "editor_state_operation"
  | "asset_mutation_plan";

export type EvidenceSource =
  | "mock-runtime"
  | "mcp-readonly"
  | "policy"
  | "future-mcp"
  | "future-file-system"
  | "project-index"
  | "capability-bridge"
  | "diagnostics-engine"
  | "editor-policy"
  | "editor-observation"
  | "mcp-mutation-policy";

export interface EvidenceRecord {
  id: string;
  taskId: string;
  kind: EvidenceKind;
  title: string;
  summary: string;
  source: EvidenceSource;
  createdAt: number;
  payload?: unknown;
}
