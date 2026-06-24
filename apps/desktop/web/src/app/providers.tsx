import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { UIContextValue, UIShellState, UATheme } from "../types/ui";

const DEFAULT_STATE: UIShellState = {
  theme: "dark" as UATheme,
  inspector: {
    open: true,
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
