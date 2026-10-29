import type { ProviderConfig } from "../types/provider";
import { DEEPSEEK_MODEL } from "@uagent/runtime";
import { getApplicationProfile } from "../runtime/application-profile";

export function responsesFixtureAvailable(): boolean {
  try {
    const profile = getApplicationProfile();
    return profile.isolated && profile.offlineDemo;
  } catch {
    return false;
  }
}

/** Match the transport actually shipped in this profile. Configuration is not connectivity. */
export function supportsProviderModel(
  provider: ProviderConfig | undefined | null,
  modelId: string | undefined,
): boolean {
  if (
    !provider ||
    !provider.enabled ||
    provider.authMode !== "env_key" ||
    !modelId ||
    !provider.models.some((model) => model.id === modelId)
  )
    return false;
  if (provider.wireApi === "responses")
    return (
      responsesFixtureAvailable() &&
      ["https://api.openai.com/v1", "https://api.openai.com/v1/"].includes(provider.baseUrl)
    );
  if (
    provider.providerId !== "deepseek" ||
    modelId !== DEEPSEEK_MODEL ||
    !["openai_compatible", "chat_completions"].includes(provider.wireApi)
  )
    return false;
  return ["https://api.deepseek.com", "https://api.deepseek.com/"].includes(provider.baseUrl);
}

export interface ProviderSessionIdentity {
  ready: boolean;
  providerId?: string | null;
  modelId?: string | null;
  endpoint?: string | null;
  wireApi?: string | null;
  fixture?: boolean;
}
/** Old controllers without identity fields are compatible only with the single
 * known DeepSeek transport. Responses always requires complete native ownership. */
export function sessionMatchesProviderModel(
  state: ProviderSessionIdentity,
  provider: ProviderConfig | undefined | null,
  modelId: string | undefined,
): boolean {
  if (!state.ready || !supportsProviderModel(provider, modelId) || !provider) return false;
  const identified = ["providerId", "modelId", "endpoint", "wireApi", "fixture"].some(
    (key) => key in state,
  );
  if (!identified) return provider.providerId === "deepseek" && provider.wireApi !== "responses";
  if (state.providerId !== provider.providerId || state.modelId !== modelId) return false;
  if (provider.wireApi === "responses")
    return (
      state.wireApi === "responses" &&
      state.fixture === true &&
      state.endpoint === "https://api.openai.com/v1/responses"
    );
  return (
    ["openai_compatible", "chat_completions"].includes(state.wireApi ?? "") &&
    state.endpoint === "https://api.deepseek.com/chat/completions"
  );
}
export function createSupportedProvider(): ProviderConfig {
  return {
    providerId: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    wireApi: "openai_compatible",
    authMode: "env_key",
    networkMode: "live",
    enabled: true,
    models: [
      {
        id: DEEPSEEK_MODEL,
        label: "DeepSeek Flash",
        contextWindow: 1000000,
        supportsReasoning: false,
      },
    ],
    defaultModel: DEEPSEEK_MODEL,
  };
}
