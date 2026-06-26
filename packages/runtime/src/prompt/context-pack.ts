import type { AgentPlan, McpDiscoverySnapshot, TaskDraft } from "@uagent/shared";

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
  const toolNames = discovery?.tools.map((tool) => tool.name) ?? [];

  return [
    ...policySummary,
    `Read-only MCP resources: ${resourceUris.length > 0 ? resourceUris.join(", ") : "none"}`,
    `Read-only MCP tools: ${toolNames.length > 0 ? toolNames.join(", ") : "none"}`,
  ];
}
