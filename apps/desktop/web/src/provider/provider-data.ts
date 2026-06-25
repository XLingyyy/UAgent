import type {
  ProviderAuthMode,
  ProviderConfig,
  ProviderModel,
  ProviderReasoningEffort,
  ProviderState,
  ProviderWireApi,
} from "../types/provider";

export const PROVIDER_REASONING_OPTIONS: ProviderReasoningEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
];

export const PROVIDER_WIRE_API_OPTIONS: Array<{ value: ProviderWireApi; label: string }> = [
  { value: "responses", label: "Responses" },
  { value: "chat_completions", label: "Chat Completions" },
  { value: "anthropic", label: "Anthropic" },
  { value: "openai_compatible", label: "OpenAI Compatible" },
];

export const PROVIDER_AUTH_MODE_OPTIONS: Array<{ value: ProviderAuthMode; label: string }> = [
  { value: "env_key", label: "Environment variable" },
  { value: "none", label: "No auth" },
];

function createModel(
  id: string,
  label: string,
  contextWindow: number,
  reasoningEfforts: ProviderReasoningEffort[] = PROVIDER_REASONING_OPTIONS,
): ProviderModel {
  return {
    id,
    label,
    contextWindow,
    supportsReasoning: reasoningEfforts.length > 0,
    reasoningEfforts,
  };
}

const PROVIDER_MODEL_PRESETS: Record<ProviderWireApi, ProviderModel[]> = {
  responses: [
    createModel("openai-gpt-5", "GPT-5 Mock", 200000),
    createModel("openai-gpt-4-1-mini", "GPT-4.1 Mini Mock", 128000, ["low", "medium", "high"]),
  ],
  chat_completions: [
    createModel("gpt-4o-mock", "GPT-4o Mock", 128000, ["low", "medium", "high"]),
    createModel("gpt-4-1-chat-mock", "GPT-4.1 Chat Mock", 128000, ["medium", "high"]),
  ],
  anthropic: [
    createModel("anthropic-claude-sonnet", "Claude Sonnet Mock", 200000),
    createModel("anthropic-claude-haiku", "Claude Haiku Mock", 200000, ["low", "medium"]),
  ],
  openai_compatible: [
    createModel("local-qwen", "Local Qwen Mock", 64000, ["low", "medium", "high"]),
    createModel("local-gpt-oss", "Local GPT-OSS Mock", 128000, ["medium", "high"]),
  ],
};

function cloneModel(model: ProviderModel): ProviderModel {
  return {
    ...model,
    reasoningEfforts: model.reasoningEfforts ? [...model.reasoningEfforts] : undefined,
  };
}

export function cloneProviderConfig(provider: ProviderConfig): ProviderConfig {
  return {
    ...provider,
    models: provider.models.map(cloneModel),
  };
}

export function cloneProviderState(state: ProviderState): ProviderState {
  return {
    ...state,
    providers: state.providers.map(cloneProviderConfig),
  };
}

export function createModelsForWireApi(wireApi: ProviderWireApi): ProviderModel[] {
  return PROVIDER_MODEL_PRESETS[wireApi].map(cloneModel);
}

export const DEFAULT_PROVIDERS: ProviderConfig[] = [
  {
    providerId: "provider-a",
    displayName: "Provider A",
    baseUrl: "https://mock.provider-a.local/v1",
    wireApi: "responses",
    authMode: "env_key",
    envKey: "PROVIDER_A_KEY",
    models: [
      createModel("openai-gpt-5", "GPT-5 Mock", 200000),
      createModel("anthropic-claude-sonnet", "Claude Sonnet Mock", 200000),
    ],
    defaultModel: "openai-gpt-5",
    defaultReasoningEffort: "medium",
    enabled: true,
  },
  {
    providerId: "provider-b",
    displayName: "Provider B",
    baseUrl: "http://127.0.0.1:11434/v1",
    wireApi: "openai_compatible",
    authMode: "none",
    models: [createModel("local-qwen", "Local Qwen Mock", 64000, ["low", "medium", "high"])],
    defaultModel: "local-qwen",
    defaultReasoningEffort: "medium",
    enabled: true,
  },
];

export const DEFAULT_PROVIDER_STATE: ProviderState = {
  providers: DEFAULT_PROVIDERS.map(cloneProviderConfig),
  selectedProviderId: DEFAULT_PROVIDERS[0]?.providerId ?? null,
  defaultProviderId: null,
};

export function createProviderDraft(nextIndex: number): ProviderConfig {
  const models = createModelsForWireApi("openai_compatible");
  return {
    providerId: `local-provider-${nextIndex}`,
    displayName: `Local Provider ${nextIndex}`,
    baseUrl: "http://127.0.0.1:11434/v1",
    wireApi: "openai_compatible",
    authMode: "env_key",
    envKey: `LOCAL_PROVIDER_${nextIndex}_KEY`,
    models,
    defaultModel: models[0]?.id,
    defaultReasoningEffort: models[0]?.reasoningEfforts?.[1] ?? "medium",
    enabled: true,
  };
}

export function getReasoningEffortsForModel(
  models: ProviderModel[],
  modelId: string | undefined,
): ProviderReasoningEffort[] {
  const match = models.find((model) => model.id === modelId);
  if (!match?.supportsReasoning) {
    return [];
  }
  return match.reasoningEfforts ? [...match.reasoningEfforts] : [...PROVIDER_REASONING_OPTIONS];
}

export function formatContextWindow(contextWindow: number): string {
  if (contextWindow >= 1000) {
    const value = contextWindow / 1000;
    return Number.isInteger(value) ? `${value}k` : `${value.toFixed(1)}k`;
  }
  return String(contextWindow);
}
