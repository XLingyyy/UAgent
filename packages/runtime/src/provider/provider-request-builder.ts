import type { ProviderRuntimeRequest } from "@uagent/shared";
import type { PromptEnvelope } from "../prompt/prompt-builder.js";

export interface BuildProviderRuntimeRequestInput {
  envelope: PromptEnvelope;
  taskId: string;
  planId: string;
  traceId?: string;
  idFactory?: () => string;
  temperature?: number;
  maxOutputTokens?: number;
  networkMode?: string;
}

export function buildProviderRuntimeRequest(
  input: BuildProviderRuntimeRequestInput,
): ProviderRuntimeRequest {
  return {
    id: input.idFactory?.() ?? `provider-request-${input.taskId}-${input.planId}`,
    providerId: input.envelope.metadata.providerId,
    modelId: input.envelope.metadata.providerModelId,
    messages: [
      { role: "system", content: input.envelope.system },
      { role: "developer", content: buildDeveloperMessage(input.envelope) },
      { role: "user", content: buildUserMessage(input.envelope) },
    ],
    temperature: input.temperature ?? 0,
    maxOutputTokens: input.maxOutputTokens ?? 1024,
    metadata: {
      taskId: input.taskId,
      planId: input.planId,
      traceId: input.traceId,
      ...(input.networkMode ? { networkMode: input.networkMode } : {}),
    },
  };
}

function buildDeveloperMessage(envelope: PromptEnvelope): string {
  return [
    envelope.developer,
    "",
    "Context:",
    ...envelope.context,
    "",
    "Constraints:",
    ...envelope.constraints,
  ].join("\n");
}

function buildUserMessage(envelope: PromptEnvelope): string {
  return [
    envelope.user,
    "",
    "Tool policy:",
    ...envelope.toolPolicy,
  ].join("\n");
}
