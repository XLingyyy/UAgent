import {
  cloneProviderConfig,
  cloneProviderState,
  DEFAULT_PROVIDER_STATE,
} from "../provider/provider-data";
import type { ProviderState } from "../types/provider";
import type { UIInitialState } from "../types/ui";

export function createInitialProviderState(initialState?: UIInitialState): ProviderState {
  return {
    ...cloneProviderState(DEFAULT_PROVIDER_STATE),
    ...initialState?.provider,
    providers: initialState?.provider?.providers
      ? initialState.provider.providers.map(cloneProviderConfig)
      : DEFAULT_PROVIDER_STATE.providers.map(cloneProviderConfig),
  };
}
