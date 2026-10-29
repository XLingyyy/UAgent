export type ProviderNetworkMode = "disabled" | "fixture" | "live";

export type ProviderWireApi = "responses" | "chat_completions" | "anthropic" | "openai_compatible";

export type ProviderAuthMode = "env_key" | "none";

export type ProviderReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type ProviderTestStatus = "idle" | "success" | "failure";

export interface ProviderModel {
  id: string;
  label: string;
  contextWindow: number;
  supportsReasoning: boolean;
  reasoningEfforts?: ProviderReasoningEffort[];
  capabilityDeclarations?: {text:"unknown"|"supported"|"unsupported";tools:"unknown"|"supported"|"unsupported";streaming:"unknown"|"supported"|"unsupported"};
  requestDefaults?: {temperature:number|null;maxOutputTokens:number|null};
}

export interface ProviderConfig {
  providerId: string;
  displayName: string;
  baseUrl: string;
  wireApi: ProviderWireApi;
  authMode: ProviderAuthMode;
  secretRef?: string;
  models: ProviderModel[];
  defaultModel?: string;
  defaultReasoningEffort?: ProviderReasoningEffort;
  enabled: boolean;
  networkMode?: ProviderNetworkMode;
}

export interface ProviderVersion {providerId:string;generation:string|null;revision:number;exists:boolean}

export interface ProviderState {
  providerVersions?: Record<string,ProviderVersion>;
  providers: ProviderConfig[];
  selectedProviderId: string | null;
  defaultProviderId: string | null;
  testStatus: ProviderTestStatus;
}
