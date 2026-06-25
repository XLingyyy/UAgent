import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type {
  UIContextValue,
  UIShellState,
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

const DEFAULT_STATE: UIShellState = {
  theme: "dark" as UATheme,
  inspector: {
    open: true,
  },
  sidebar: {
    activeNav: "workspace" as NavSection,
    activeThreadId: "thread-1",
  },
  activeProjectId: "lyra",
  settings: {
    open: false,
    activePageId: DEFAULT_SETTINGS_PAGE,
  },
  provider: cloneProviderState(DEFAULT_PROVIDER_STATE),
};

const UIContext = createContext<UIContextValue | null>(null);

export interface UIProviderProps {
  children: ReactNode;
  initialState?: Partial<UIShellState>;
}

function createInitialState(initialState?: Partial<UIShellState>): UIShellState {
  return {
    ...DEFAULT_STATE,
    ...initialState,
    inspector: {
      ...DEFAULT_STATE.inspector,
      ...initialState?.inspector,
    },
    sidebar: {
      ...DEFAULT_STATE.sidebar,
      ...initialState?.sidebar,
    },
    settings: {
      ...DEFAULT_STATE.settings,
      ...initialState?.settings,
    },
    provider: {
      ...cloneProviderState(DEFAULT_PROVIDER_STATE),
      ...initialState?.provider,
      providers: initialState?.provider?.providers
        ? initialState.provider.providers.map(cloneProviderConfig)
        : DEFAULT_PROVIDER_STATE.providers.map(cloneProviderConfig),
    },
  };
}

export function UIProvider({ children, initialState }: UIProviderProps) {
  const [state, setState] = useState<UIShellState>(() => createInitialState(initialState));

  const value = useMemo<UIContextValue>(
    () => ({
      state,
      toggleInspector: () =>
        setState((prev) => ({
          ...prev,
          inspector: { open: !prev.inspector.open },
        })),
      setInspectorOpen: (open: boolean) =>
        setState((prev) => ({
          ...prev,
          inspector: { open },
        })),
      setActiveNav: (nav: NavSection) =>
        setState((prev) => ({
          ...prev,
          sidebar: { ...prev.sidebar, activeNav: nav },
        })),
      setActiveThread: (threadId: string) =>
        setState((prev) => ({
          ...prev,
          sidebar: { ...prev.sidebar, activeThreadId: threadId },
        })),
      setActiveProject: (projectId: string | null) =>
        setState((prev) => ({
          ...prev,
          activeProjectId: projectId,
        })),
      openSettings: (pageId?: SettingsPageId) =>
        setState((prev) => ({
          ...prev,
          settings: {
            open: true,
            activePageId: pageId ?? DEFAULT_SETTINGS_PAGE,
          },
        })),
      closeSettings: () =>
        setState((prev) => ({
          ...prev,
          settings: { ...prev.settings, open: false },
        })),
      setActiveSettingsPage: (pageId: SettingsPageId) =>
        setState((prev) => ({
          ...prev,
          settings: { ...prev.settings, activePageId: pageId },
        })),
      setSelectedProvider: (providerId: string | null) =>
        setState((prev) => ({
          ...prev,
          provider: { ...prev.provider, selectedProviderId: providerId },
        })),
      saveProvider: (provider) =>
        setState((prev) => {
          const nextProvider = cloneProviderConfig(provider);
          const existingIndex = prev.provider.providers.findIndex(
            (item) => item.providerId === nextProvider.providerId,
          );
          const providers = [...prev.provider.providers];
          if (existingIndex >= 0) {
            providers.splice(existingIndex, 1, nextProvider);
          } else {
            providers.push(nextProvider);
          }
          return {
            ...prev,
            provider: {
              ...prev.provider,
              providers,
              selectedProviderId: nextProvider.providerId,
            },
          };
        }),
      deleteProvider: (providerId: string) =>
        setState((prev) => {
          const providers = prev.provider.providers.filter(
            (item) => item.providerId !== providerId,
          );
          const fallbackId = providers[0]?.providerId ?? null;
          return {
            ...prev,
            provider: {
              providers,
              selectedProviderId:
                prev.provider.selectedProviderId === providerId
                  ? fallbackId
                  : prev.provider.selectedProviderId,
              defaultProviderId:
                prev.provider.defaultProviderId === providerId
                  ? null
                  : prev.provider.defaultProviderId,
            },
          };
        }),
      setDefaultProvider: (providerId: string | null) =>
        setState((prev) => ({
          ...prev,
          provider: {
            ...prev.provider,
            defaultProviderId: providerId,
          },
        })),
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
