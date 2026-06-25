import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type {
  UIContextValue,
  UIShellState,
  UATheme,
  NavSection,
  SettingsPageId,
} from "../types/ui";
import { DEFAULT_SETTINGS_PAGE } from "../settings/settings-pages";

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
};

const UIContext = createContext<UIContextValue | null>(null);

export interface UIProviderProps {
  children: ReactNode;
  initialState?: Partial<UIShellState>;
}

export function UIProvider({ children, initialState }: UIProviderProps) {
  const [state, setState] = useState<UIShellState>({
    ...DEFAULT_STATE,
    ...initialState,
    inspector: {
      ...DEFAULT_STATE.inspector,
      ...initialState?.inspector,
    },
  });

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
