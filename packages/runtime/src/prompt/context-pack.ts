import type { AgentPlan, McpDiscoverySnapshot, TaskDraft } from "@uagent/shared";
import { classifyMcpToolRisk } from "../mcp-readonly-policy.js";

export interface PromptProviderMetadata {
  id: string;
  label: string;
  modelId: string;
}

export function buildContextPack(input: {
  draft: TaskDraft;
  plan: AgentPlan;
  discovery?: McpDiscoverySnapshot | null;
  provider?: PromptProviderMetadata;
}): string[] {
  const discovery = input.discovery;
  const runtimeMode = input.plan.metadata?.runtimeMode ?? "mock";
  const providerLine = input.provider
    ? `Provider: ${input.provider.id} / ${input.provider.modelId}`
    : "Provider: mock-only / not-configured";

  return [
    `Task: ${input.draft.input}`,
    `Plan: ${input.plan.goal}`,
    `Runtime mode: ${runtimeMode}`,
    discovery
      ? `MCP discovery: ${discovery.capabilitySummary.tools} tools / ${discovery.capabilitySummary.resources} resources / ${discovery.capabilitySummary.prompts} prompts`
      : "MCP discovery: unavailable",
    providerLine,
  ];
}

export function buildToolPolicyPack(
  discovery?: McpDiscoverySnapshot | null,
  policySummary: string[] = [],
): string[] {
  const resourceUris = discovery?.resources.map((resource) => resource.uri) ?? [];
  const classifiedTools =
    discovery?.tools.map((tool) => ({
      name: tool.name,
      risk: classifyMcpToolRisk(tool).level,
    })) ?? [];
  const readOnlyToolNames = classifiedTools.filter((tool) => tool.risk === "read_only").map((tool) => tool.name);
  const blockedToolNames = classifiedTools.filter((tool) => tool.risk === "blocked").map((tool) => tool.name);
  const unknownToolNames = classifiedTools.filter((tool) => tool.risk === "unknown").map((tool) => tool.name);

  return [
    ...policySummary,
    `Read-only MCP resources: ${resourceUris.length > 0 ? resourceUris.join(", ") : "none"}`,
    `Read-only MCP tools: ${readOnlyToolNames.length > 0 ? readOnlyToolNames.join(", ") : "none"}`,
    `Blocked MCP tools: ${blockedToolNames.length > 0 ? blockedToolNames.join(", ") : "none"}`,
    `Unknown MCP tools: ${unknownToolNames.length > 0 ? unknownToolNames.join(", ") : "none"}`,
    "Blocked and mutating MCP tools must not execute.",
    "Unknown MCP tools must not execute until explicitly classified.",
  ];
}
