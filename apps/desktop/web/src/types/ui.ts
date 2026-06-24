/**
 * UAgent UI type definitions
 *
 * Shared types for the desktop UI shell layer.
 */

/** Primary navigation sections in the sidebar. */
export type NavSection = "workspace" | "projects" | "settings";

/** Mock project data shape for the sidebar ProjectSection. */
export interface MockProject {
  name: string;
  engineVersion: string;
  connectionStatus: string;
  path: string;
}

/** Node type identifiers for the project tree. */
export type ProjectTreeNodeType =
  | "Folder"
  | "Map"
  | "Blueprint"
  | "Material"
  | "Asset"
  | "Config"
  | "Project";

/** A single node in the mock project tree. */
export interface ProjectTreeNode {
  id: string;
  name: string;
  type: ProjectTreeNodeType;
  children?: ProjectTreeNode[];
}

/** Mock thread / conversation data shape for the sidebar ThreadSection. */
export interface MockThread {
  id: string;
  title: string;
  type: "Plan" | "Build" | "Review";
  updatedAt: string;
}

/** Inspector pane visibility state. */
export interface InspectorState {
  /** Whether the Inspector pane is currently visible. */
  open: boolean;
}

/** Sidebar local UI state. */
export interface SidebarState {
  /** Currently active primary nav section. */
  activeNav: NavSection;
  /** Currently selected thread id, or null if none. */
  activeThreadId: string | null;
}

/** Theme variants supported by the UI shell. */
export type UATheme = "dark";

/** Global UI shell state consumed by AppShell and child regions. */
export interface UIShellState {
  /** Current theme. */
  theme: UATheme;
  /** Inspector pane state. */
  inspector: InspectorState;
  /** Sidebar navigation and selection state. */
  sidebar: SidebarState;
}

/** Toggle the inspector open/closed. */
export type ToggleInspector = () => void;

/** Set the active primary nav section. */
export type SetActiveNav = (nav: NavSection) => void;

/** Set the active thread by id. */
export type SetActiveThread = (threadId: string) => void;

/** Context value exposed by the UI provider. */
export interface UIContextValue {
  state: UIShellState;
  toggleInspector: ToggleInspector;
  setInspectorOpen: (open: boolean) => void;
  setActiveNav: SetActiveNav;
  setActiveThread: SetActiveThread;
}
