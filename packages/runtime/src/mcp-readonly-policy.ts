import type { McpToolDescriptor, ToolRiskClassification } from "@uagent/shared";

const BLOCKED_KEYWORDS = [
  "create",
  "update",
  "delete",
  "remove",
  "save",
  "persist",
  "apply",
  "set",
  "rename",
  "import",
  "export",
  "compile",
  "run",
  "launch",
  "spawn",
  "edit",
  "mutate",
  "write",
] as const;

const READ_ONLY_PATTERNS = [
  /(^|[./_-])(get|list|read|inspect|query|describe|summary|summarize|find|search)([./_-]|$)/i,
  /\.(get|list|read|inspect|query)$/i,
];

export function classifyMcpToolRisk(tool: Pick<McpToolDescriptor, "name" | "annotations">): ToolRiskClassification {
  const lowerName = tool.name.toLowerCase();
  const matchedKeyword = BLOCKED_KEYWORDS.find((keyword) => lowerName.includes(keyword));
  if (matchedKeyword) {
    return {
      toolName: tool.name,
      level: "blocked",
      reason: `Tool name contains blocked mutating keyword "${matchedKeyword}".`,
      matchedKeyword,
    };
  }
  if (READ_ONLY_PATTERNS.some((pattern) => pattern.test(tool.name))) {
    return {
      toolName: tool.name,
      level: "read_only",
      reason: "Tool name matches UAgent read-only semantic allowlist.",
    };
  }
  return {
    toolName: tool.name,
    level: "unknown",
    reason: "Unknown MCP tools are blocked by default until explicitly classified.",
  };
}

export function isRiskAllowed(classification: ToolRiskClassification): boolean {
  return classification.level === "read_only";
}
