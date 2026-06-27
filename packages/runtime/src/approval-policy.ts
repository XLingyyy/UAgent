import { type ToolRiskLevel, type PolicyDecision, type PermissionMode } from "@uagent/shared";

const READ_ONLY_PREFIXES = [
  "get", "list", "read", "search", "find", "query",
  "inspect", "describe", "check", "peek", "view",
];

const DESTRUCTIVE_KEYWORDS = [
  "delete", "remove", "destroy", "purge", "wipe", "truncate", "drop",
  "format", "reset", "clear",
];

const WRITE_KEYWORDS = [
  "create", "update", "edit", "modify", "set", "write", "save",
  "patch", "insert", "add", "put", "post",
];

const HIGH_WRITE_KEYWORDS = [
  "deploy", "publish", "release", "execute", "run", "launch",
  "apply", "commit", "push", "merge", "promote", "rollout",
];

export function assessToolRiskLevel(toolName: string, keywords?: string[]): ToolRiskLevel {
  const lowerName = toolName.toLowerCase();

  if (keywords) {
    const hasDestructive = keywords.some((k) =>
      DESTRUCTIVE_KEYWORDS.includes(k.toLowerCase()),
    );
    if (hasDestructive) {
      return "destructive";
    }

    const hasHighWrite = keywords.some((k) =>
      HIGH_WRITE_KEYWORDS.includes(k.toLowerCase()),
    );
    if (hasHighWrite) {
      return "high_write";
    }
  }

  if (READ_ONLY_PREFIXES.some((p) => lowerName.startsWith(p))) {
    return "read_only";
  }

  if (keywords) {
    const hasWrite = keywords.some((k) =>
      WRITE_KEYWORDS.includes(k.toLowerCase()),
    );
    if (hasWrite) {
      return "medium_write";
    }
  }

  if (WRITE_KEYWORDS.some((w) => lowerName.includes(w))) {
    return "medium_write";
  }
  if (HIGH_WRITE_KEYWORDS.some((w) => lowerName.includes(w))) {
    return "high_write";
  }
  if (DESTRUCTIVE_KEYWORDS.some((w) => lowerName.includes(w))) {
    return "destructive";
  }

  return "low_risk";
}

const RISK_DECISION_DEFAULTS: Record<ToolRiskLevel, PolicyDecision> = {
  read_only: "allow",
  low_risk: "allow",
  medium_write: "require_approval",
  high_write: "require_approval",
  destructive: "block",
  blocked: "block",
  unknown: "block",
};

export function evaluateApprovalPolicy(
  riskLevel: ToolRiskLevel,
  permissionMode: PermissionMode,
  policyOverrides?: Record<string, PolicyDecision>,
): PolicyDecision {
  if (permissionMode === "auto") {
    if (riskLevel === "destructive" || riskLevel === "blocked" || riskLevel === "unknown") {
      return "block";
    }
    if (riskLevel === "medium_write" || riskLevel === "high_write") {
      return "require_approval";
    }
    return "allow";
  }

  if (permissionMode === "plan_only") {
    return "block";
  }

  if (policyOverrides && riskLevel in policyOverrides) {
    return policyOverrides[riskLevel];
  }

  return RISK_DECISION_DEFAULTS[riskLevel] ?? "block";
}
