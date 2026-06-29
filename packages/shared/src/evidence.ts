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
  | "terminal_real_output";

export type EvidenceSource =
  | "mock-runtime"
  | "mcp-readonly"
  | "policy"
  | "future-mcp"
  | "future-file-system"
  | "project-index"
  | "capability-bridge";

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
