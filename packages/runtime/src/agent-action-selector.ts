import type {
  AgentPlanStep,
  McpDiscoverySnapshot,
  McpResourceDescriptor,
  McpToolDescriptor,
  ToolRiskLevel,
} from "@uagent/shared";
import { classifyMcpToolRisk } from "./mcp-readonly-policy.js";

export type AgentAction =
  | {
      type: "read_resource";
      stepId: string;
      resourceUri: string;
      title: string;
    }
  | {
      type: "call_readonly_tool";
      stepId: string;
      toolName: string;
      args: Record<string, unknown>;
      title: string;
    }
  | {
      type: "mock_observation";
      stepId: string;
      reason: string;
    }
  | {
      type: "blocked";
      stepId: string;
      toolName?: string;
      reason: string;
      riskLevel: ToolRiskLevel;
    }
  | {
      type: "noop_report";
      stepId: string;
      reason: string;
    };

export interface AgentActionSelectorContext {
  discovery: McpDiscoverySnapshot | null;
}

export function selectAction(step: AgentPlanStep, context: AgentActionSelectorContext): AgentAction {
  if (step.action?.type === "noop_report" || step.kind === "report") {
    return {
      type: "noop_report",
      stepId: step.id,
      reason: "Report steps are generated from accumulated observations.",
    };
  }

  if (step.action?.type === "blocked") {
    return {
      type: "blocked",
      stepId: step.id,
      toolName: step.action.toolName,
      reason: step.action.reason ?? "Action is blocked by MVP3 policy.",
      riskLevel: step.action.riskLevel ?? "blocked",
    };
  }

  if (!context.discovery) {
    return {
      type: "mock_observation",
      stepId: step.id,
      reason: "MCP discovery is unavailable; using deterministic mock observation.",
    };
  }

  const resource = resolveResource(step, context.discovery.resources);
  if (resource) {
    return {
      type: "read_resource",
      stepId: step.id,
      resourceUri: resource.uri,
      title: resource.name ?? resource.uri,
    };
  }

  if (step.action?.type === "mock_observation") {
    return {
      type: "mock_observation",
      stepId: step.id,
      reason: step.action.reason ?? "Planner selected deterministic mock observation.",
    };
  }

  const toolName = step.action?.toolName ?? step.target?.toolName;
  if (toolName) {
    return resolveTool(step.id, toolName, step.action?.args ?? {}, context.discovery.tools);
  }

  return {
    type: "mock_observation",
    stepId: step.id,
    reason: "No MCP resource or read-only tool target was selected.",
  };
}

function resolveResource(
  step: AgentPlanStep,
  resources: McpResourceDescriptor[],
): McpResourceDescriptor | null {
  const uri = step.action?.resourceUri ?? step.target?.uri;
  if (!uri) {
    return null;
  }
  return resources.find((resource) => resource.uri === uri) ?? null;
}

function resolveTool(
  stepId: string,
  toolName: string,
  args: Record<string, unknown>,
  tools: McpToolDescriptor[],
): AgentAction {
  const tool = tools.find((candidate) => candidate.name === toolName);
  if (!tool) {
    return {
      type: "blocked",
      stepId,
      toolName,
      reason: "Tool was not present in MCP discovery.",
      riskLevel: "unknown",
    };
  }

  const risk = classifyMcpToolRisk(tool);
  if (risk.level !== "read_only") {
    return {
      type: "blocked",
      stepId,
      toolName,
      reason: risk.reason,
      riskLevel: risk.level,
    };
  }

  return {
    type: "call_readonly_tool",
    stepId,
    toolName,
    args,
    title: tool.description ?? tool.name,
  };
}
