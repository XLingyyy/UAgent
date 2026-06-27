export type ToolRiskLevel = "read_only" | "low_risk" | "medium_write" | "high_write" | "destructive" | "blocked" | "unknown";

export interface ToolRiskClassification {
  toolName: string;
  level: ToolRiskLevel;
  reason: string;
  matchedKeyword?: string;
}

export type PolicyDecision = "allow" | "require_approval" | "block";

export interface SafetyPolicy {
  defaultDecision: PolicyDecision;
  overrides: Record<string, PolicyDecision>;
}

export interface RiskAssessment {
  riskLevel: ToolRiskLevel;
  policyDecision: PolicyDecision;
  reason: string;
}

export type WorkflowCapability =
  | "read_resource"
  | "read_tool"
  | "fixture_sandbox"
  | "fixture_write"
  | "live_sandbox"
  | "live_write"
  | "destructive";
