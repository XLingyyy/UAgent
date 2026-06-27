import { composerMock, getDefaultModelSelection } from "../composer/composer-data";
import type { ProviderState } from "../types/provider";
import type { ComposerStoreState, UIInitialState } from "../types/ui";

export function cloneComposerState(state: ComposerStoreState): ComposerStoreState {
  return {
    ...state,
    context: { ...state.context },
    statusItems: state.statusItems.map((item) => ({ ...item })),
  };
}

export function createDefaultComposerState(providerState: ProviderState): ComposerStoreState {
  const defaultSelection = getDefaultModelSelection(
    providerState.providers,
    providerState.defaultProviderId,
  );

  return {
    input: "",
    attachMenuOpen: false,
    permission: composerMock.permission,
    selectedModelId: defaultSelection.modelId,
    reasoningEffort: defaultSelection.reasoningEffort,
    runMode: composerMock.runMode,
    branch: composerMock.branch,
    context: { ...composerMock.context },
    statusItems: composerMock.statusItems.map((item) => ({ ...item })),
  };
}

export function createInitialComposerState(
  initialState: UIInitialState | undefined,
  providerState: ProviderState,
): ComposerStoreState {
  const defaultComposerState = createDefaultComposerState(providerState);

  return {
    ...cloneComposerState(defaultComposerState),
    ...initialState?.composer,
    context: initialState?.composer?.context
      ? { ...initialState.composer.context }
      : defaultComposerState.context,
    statusItems: initialState?.composer?.statusItems
      ? initialState.composer.statusItems.map((item) => ({ ...item }))
      : defaultComposerState.statusItems.map((item) => ({ ...item })),
    selectedModelId:
      initialState?.composer?.selectedModelId ?? defaultComposerState.selectedModelId,
    reasoningEffort:
      initialState?.composer?.reasoningEffort ?? defaultComposerState.reasoningEffort,
  };
}
