import type { McpDiscoverySnapshot, McpResourceDescriptor, McpToolDescriptor } from "@uagent/shared";
import { classifyMcpToolRisk } from "./mcp-readonly-policy.js";

export type McpResolvedIntent =
  | { kind: "resource"; uri: string; title: string }
  | { kind: "tool"; name: string; title: string }
  | { kind: "blocked_tool"; name: string; title: string; reason: string }
  | { kind: "unresolved"; title: string; reason: string };

export interface SemanticCapabilityIndex {
  resolveIntent(input: string): McpResolvedIntent;
  getSummary(): string[];
}

export function createSemanticCapabilityIndex(discovery: McpDiscoverySnapshot): SemanticCapabilityIndex {
  const resources = discovery.resources;
  const tools = discovery.tools;
  return {
    resolveIntent(input: string): McpResolvedIntent {
      const normalized = input.toLowerCase();
      if (/(delete|save|apply|write|compile|run|launch)/i.test(input)) {
        const blocked = tools.find((tool) => classifyMcpToolRisk(tool).level !== "read_only");
        if (blocked) {
          return {
            kind: "blocked_tool",
            name: blocked.name,
            title: blocked.description ?? blocked.name,
            reason: classifyMcpToolRisk(blocked).reason,
          };
        }
      }
      if (isCurrentSelectionIntent(normalized)) {
        const resource = findResource(resources, ["selection", "current"]);
        if (resource) {
          return { kind: "resource", uri: resource.uri, title: resource.name ?? "Current selection" };
        }
        const tool = findTool(tools, ["selection", "get"]);
        if (tool) {
          const risk = classifyMcpToolRisk(tool);
          return risk.level === "read_only"
            ? { kind: "tool", name: tool.name, title: tool.description ?? tool.name }
            : { kind: "blocked_tool", name: tool.name, title: tool.name, reason: risk.reason };
        }
      }
      const resource = resources[0];
      if (resource) {
        return { kind: "resource", uri: resource.uri, title: resource.name ?? resource.uri };
      }
      return {
        kind: "unresolved",
        title: "No read-only MCP capability",
        reason: "No matching read-only resource or allowed tool was discovered.",
      };
    },
    getSummary(): string[] {
      return [
        `${discovery.capabilitySummary.resources} resources`,
        `${discovery.capabilitySummary.readOnlyTools} read-only tools`,
        `${discovery.capabilitySummary.blockedTools} blocked tools`,
      ];
    },
  };
}

function isCurrentSelectionIntent(input: string): boolean {
  return input.includes("selection") || input.includes("当前选择") || input.includes("current selection");
}

function findResource(resources: McpResourceDescriptor[], terms: string[]): McpResourceDescriptor | null {
  return resources.find((resource) => terms.every((term) => resource.uri.toLowerCase().includes(term))) ?? null;
}

function findTool(tools: McpToolDescriptor[], terms: string[]): McpToolDescriptor | null {
  return tools.find((tool) => terms.every((term) => tool.name.toLowerCase().includes(term))) ?? null;
}
