import type { AgentPlan, McpDiscoverySnapshot, TaskDraft } from "@uagent/shared";
import {
  buildContextPack,
  buildToolPolicyPack,
  type PromptProviderMetadata,
} from "./context-pack.js";
import {
  UAGENT_AGENT_CORE_DEVELOPER_PROMPT,
  UAGENT_AGENT_CORE_SYSTEM_PROMPT,
} from "./system-prompt.js";

export interface PromptEnvelope {
  system: string;
  developer: string;
  context: string[];
  user: string;
  constraints: string[];
  toolPolicy: string[];
  metadata: {
    modelId: string;
    reasoningEffort: string;
    providerId: string;
    providerModelId: string;
  };
}

export interface BuildPromptEnvelopeInput {
  draft: TaskDraft;
  plan: AgentPlan;
  discovery?: McpDiscoverySnapshot | null;
  provider?: PromptProviderMetadata;
  policySummary?: string[];
}

export function buildPromptEnvelope(input: BuildPromptEnvelopeInput): PromptEnvelope {
  const provider = input.provider ?? {
    id: "mock-only",
    label: "Mock-only provider placeholder",
    modelId: "not-configured",
  };

  return {
    system: UAGENT_AGENT_CORE_SYSTEM_PROMPT,
    developer: UAGENT_AGENT_CORE_DEVELOPER_PROMPT,
    context: buildContextPack({
      draft: input.draft,
      plan: input.plan,
      discovery: input.discovery ?? null,
      provider,
    }),
    user: input.draft.input,
    constraints: [
      "MVP3 allows MCP resources/read and locally classified read-only tools/call only.",
      "Blocked, unknown, mutating, shell, browser, filesystem, and UE write actions must not execute.",
      "Provider output is mock-only in POST-MVP3; no API keys, environment variables, or HTTP calls are read or sent.",
    ],
    toolPolicy: buildToolPolicyPack(input.discovery ?? null, input.policySummary),
    metadata: {
      modelId: input.draft.modelId,
      reasoningEffort: input.draft.reasoningEffort,
      providerId: provider.id,
      providerModelId: provider.modelId,
    },
  };
}
