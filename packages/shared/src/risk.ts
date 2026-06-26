export type ToolRiskLevel = "read_only" | "blocked" | "unknown";

export interface ToolRiskClassification {
  toolName: string;
  level: ToolRiskLevel;
  reason: string;
  matchedKeyword?: string;
}
