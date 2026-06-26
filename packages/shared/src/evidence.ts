export type EvidenceKind =
  | "project_summary"
  | "asset_reference"
  | "tool_result"
  | "diagnostic"
  | "artifact_placeholder";

export type EvidenceSource = "mock-runtime" | "mcp-readonly" | "future-mcp" | "future-file-system";

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
