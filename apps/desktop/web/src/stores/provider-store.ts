import { FIXTURES_ENABLED } from "../runtime/build-capabilities";
import {
  cloneProviderConfig,
  cloneProviderState,
  DEFAULT_PROVIDER_STATE,
} from "../provider/provider-data";
import type { ProviderState } from "../types/provider";
import type { UIInitialState } from "../types/ui";

export function createInitialProviderState(initialState?: UIInitialState): ProviderState {
  return {
    ...cloneProviderState(FIXTURES_ENABLED ? DEFAULT_PROVIDER_STATE : { providers: [], selectedProviderId: null, defaultProviderId: null, testStatus: "idle" }),
    ...initialState?.provider,
    providers: initialState?.provider?.providers
      ? initialState.provider.providers.map(cloneProviderConfig)
      : FIXTURES_ENABLED ? DEFAULT_PROVIDER_STATE.providers.map(cloneProviderConfig) : [],
  };
}
