export type ProviderWireApi = "responses" | "chat_completions" | "anthropic" | "openai_compatible";

export type ProviderAuthMode = "env_key" | "none";

export type ProviderReasoningEffort = "low" | "medium" | "high" | "xhigh";

export interface ProviderModel {
  id: string;
  label: string;
  contextWindow: number;
  supportsReasoning: boolean;
  reasoningEfforts?: ProviderReasoningEffort[];
}

export interface ProviderConfig {
  providerId: string;
  displayName: string;
  baseUrl: string;
  wireApi: ProviderWireApi;
  authMode: ProviderAuthMode;
  envKey?: string;
  models: ProviderModel[];
  defaultModel?: string;
  defaultReasoningEffort?: ProviderReasoningEffort;
  enabled: boolean;
}

export interface ProviderState {
  providers: ProviderConfig[];
  selectedProviderId: string | null;
  defaultProviderId: string | null;
}
