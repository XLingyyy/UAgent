import type {
  LayoutStoreState,
  NavSection,
  SidebarViewMode,
  UATheme,
  UIInitialState,
} from "../types/ui";

export const DEFAULT_LAYOUT_STATE: LayoutStoreState = {
  theme: "dark" as UATheme,
  inspector: {
    open: false,
  },
  sidebar: {
    activeNav: "workspace" as NavSection,
    viewMode: "project" as SidebarViewMode,
    assetBrowserExpanded: true,
  },
};

export function createInitialLayoutState(initialState?: UIInitialState): LayoutStoreState {
  const initialSidebar = {
    ...DEFAULT_LAYOUT_STATE.sidebar,
    ...initialState?.layout?.sidebar,
  };
  if (initialSidebar.activeNav === "projects" && !initialState?.layout?.sidebar?.viewMode) {
    initialSidebar.viewMode = "asset-browser";
  }

  return {
    ...DEFAULT_LAYOUT_STATE,
    ...initialState?.layout,
    inspector: {
      ...DEFAULT_LAYOUT_STATE.inspector,
      ...initialState?.layout?.inspector,
    },
    sidebar: initialSidebar,
  };
}
