import type { LayoutStoreState, NavSection, UATheme, UIInitialState } from "../types/ui";

export const DEFAULT_LAYOUT_STATE: LayoutStoreState = {
  theme: "dark" as UATheme,
  inspector: {
    open: false,
  },
  sidebar: {
    activeNav: "workspace" as NavSection,
  },
};

export function createInitialLayoutState(initialState?: UIInitialState): LayoutStoreState {
  return {
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
  };
}
