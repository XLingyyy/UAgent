import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type {
  UIContextValue,
  UIShellState,
  UIInitialState,
  LayoutStoreState,
  ProjectStoreState,
  ThreadStoreState,
  ComposerStoreState,
  SettingsShellState,
  UATheme,
  NavSection,
  SettingsPageId,
} from "../types/ui";
import { DEFAULT_SETTINGS_PAGE } from "../settings/settings-pages";
import {
  cloneProviderConfig,
  cloneProviderState,
  DEFAULT_PROVIDER_STATE,
} from "../provider/provider-data";
import { composerMock, getDefaultModelSelection } from "../composer/composer-data";
import type { ProviderState } from "../types/provider";

const DEFAULT_LAYOUT_STATE: LayoutStoreState = {
  theme: "dark" as UATheme,
  inspector: {
    open: true,
  },
  sidebar: {
    activeNav: "workspace" as NavSection,
  },
};

const DEFAULT_PROJECT_STATE: ProjectStoreState = {
  activeProjectId: "lyra",
};

const DEFAULT_THREAD_STATE: ThreadStoreState = {
  activeThreadId: "thread-1",
};

const DEFAULT_SETTINGS_STATE: SettingsShellState = {
  open: false,
  activePageId: DEFAULT_SETTINGS_PAGE,
};

function cloneComposerState(state: ComposerStoreState): ComposerStoreState {
  return {
    ...state,
    context: { ...state.context },
    statusItems: state.statusItems.map((item) => ({ ...item })),
  };
}

function createDefaultComposerState(providerState: ProviderState): ComposerStoreState {
  const defaultSelection = getDefaultModelSelection(
    providerState.providers,
    providerState.defaultProviderId,
  );

  return {
    input: "",
    permission: composerMock.permission,
    selectedModelId: defaultSelection.modelId,
    reasoningEffort: defaultSelection.reasoningEffort,
    runMode: composerMock.runMode,
    branch: composerMock.branch,
    context: { ...composerMock.context },
    statusItems: composerMock.statusItems.map((item) => ({ ...item })),
  };
}

function createInitialProviderState(initialState?: UIInitialState): ProviderState {
  return {
    ...cloneProviderState(DEFAULT_PROVIDER_STATE),
    ...initialState?.provider,
    providers: initialState?.provider?.providers
      ? initialState.provider.providers.map(cloneProviderConfig)
      : DEFAULT_PROVIDER_STATE.providers.map(cloneProviderConfig),
  };
}

function createInitialState(initialState?: UIInitialState): UIShellState {
  const providerState = createInitialProviderState(initialState);
  const defaultComposerState = createDefaultComposerState(providerState);

  return {
    layout: {
      ...DEFAULT_LAYOUT_STATE,
      ...initialState?.layout,
      inspector: {
        ...DEFAULT_LAYOUT_STATE.inspector,
        ...initialState?.layout?.inspector,
      },
      sidebar: {
        ...DEFAULT_LAYOUT_STATE.sidebar,
        ...initialState?.layout?.sidebar,
      },
    },
    settings: {
      ...DEFAULT_SETTINGS_STATE,
      ...initialState?.settings,
    },
    project: {
      ...DEFAULT_PROJECT_STATE,
      ...initialState?.project,
    },
    thread: {
      ...DEFAULT_THREAD_STATE,
      ...initialState?.thread,
    },
    composer: {
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
    },
    provider: providerState,
  };
}

const UIContext = createContext<UIContextValue | null>(null);

export interface UIProviderProps {
  children: ReactNode;
  initialState?: UIInitialState;
}

export function UIProvider({ children, initialState }: UIProviderProps) {
  const initialUIState = useMemo(() => createInitialState(initialState), [initialState]);
  const [layout, setLayout] = useState<LayoutStoreState>(initialUIState.layout);
  const [settings, setSettings] = useState<SettingsShellState>(initialUIState.settings);
  const [project, setProject] = useState<ProjectStoreState>(initialUIState.project);
  const [thread, setThread] = useState<ThreadStoreState>(initialUIState.thread);
  const [composer, setComposer] = useState<ComposerStoreState>(initialUIState.composer);
  const [provider, setProvider] = useState<ProviderState>(initialUIState.provider);

  const state = useMemo<UIShellState>(
    () => ({
      layout,
      settings,
      project,
      thread,
      composer,
      provider,
    }),
    [composer, layout, project, provider, settings, thread],
  );

  const value = useMemo<UIContextValue>(
    () => ({
      state,
      toggleInspector: () =>
        setLayout((prev) => ({
          ...prev,
          inspector: { open: !prev.inspector.open },
        })),
      setInspectorOpen: (open: boolean) =>
        setLayout((prev) =>
          prev.inspector.open === open
            ? prev
            : {
                ...prev,
                inspector: { open },
              },
        ),
      setActiveNav: (nav: NavSection) =>
        setLayout((prev) =>
          prev.sidebar.activeNav === nav
            ? prev
            : {
                ...prev,
                sidebar: { ...prev.sidebar, activeNav: nav },
              },
        ),
      setActiveThread: (threadId: string) =>
        setThread((prev) =>
          prev.activeThreadId === threadId ? prev : { activeThreadId: threadId },
        ),
      setActiveProject: (projectId: string | null) =>
        setProject((prev) =>
          prev.activeProjectId === projectId ? prev : { activeProjectId: projectId },
        ),
      openSettings: (pageId?: SettingsPageId) =>
        setSettings({
          open: true,
          activePageId: pageId ?? DEFAULT_SETTINGS_PAGE,
        }),
      closeSettings: () =>
        setSettings((prev) => ({
          ...prev,
          open: false,
        })),
      setActiveSettingsPage: (pageId: SettingsPageId) =>
        setSettings((prev) => ({
          ...prev,
          activePageId: pageId,
        })),
      setComposerInput: (input: string) =>
        setComposer((prev) => (prev.input === input ? prev : { ...prev, input })),
      setComposerPermission: (permission) =>
        setComposer((prev) => (prev.permission === permission ? prev : { ...prev, permission })),
      setComposerModel: (selectedModelId) =>
        setComposer((prev) =>
          prev.selectedModelId === selectedModelId ? prev : { ...prev, selectedModelId },
        ),
      setComposerReasoning: (reasoningEffort) =>
        setComposer((prev) =>
          prev.reasoningEffort === reasoningEffort ? prev : { ...prev, reasoningEffort },
        ),
      setSelectedProvider: (providerId: string | null) =>
        setProvider((prev) =>
          prev.selectedProviderId === providerId
            ? prev
            : { ...prev, selectedProviderId: providerId },
        ),
      saveProvider: (nextProviderConfig) =>
        setProvider((prev) => {
          const nextProvider = cloneProviderConfig(nextProviderConfig);
          const existingIndex = prev.providers.findIndex(
            (item) => item.providerId === nextProvider.providerId,
          );
          const providers = [...prev.providers];
          if (existingIndex >= 0) {
            providers.splice(existingIndex, 1, nextProvider);
          } else {
            providers.push(nextProvider);
          }

          return {
            ...prev,
            providers,
            selectedProviderId: nextProvider.providerId,
          };
        }),
      deleteProvider: (providerId: string) =>
        setProvider((prev) => {
          const providers = prev.providers.filter((item) => item.providerId !== providerId);
          const fallbackId = providers[0]?.providerId ?? null;
          return {
            providers,
            selectedProviderId:
              prev.selectedProviderId === providerId ? fallbackId : prev.selectedProviderId,
            defaultProviderId:
              prev.defaultProviderId === providerId ? null : prev.defaultProviderId,
          };
        }),
      setDefaultProvider: (providerId: string | null) =>
        setProvider((prev) =>
          prev.defaultProviderId === providerId ? prev : { ...prev, defaultProviderId: providerId },
        ),
    }),
    [state],
  );

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI(): UIContextValue {
  const ctx = useContext(UIContext);
  if (!ctx) {
    throw new Error("useUI must be used within a UIProvider");
  }
  return ctx;
}
