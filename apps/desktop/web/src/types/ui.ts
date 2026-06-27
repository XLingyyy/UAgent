import type { ProviderConfig, ProviderState, ProviderTestStatus } from "./provider";
import type { RuntimeStoreActions, RuntimeStoreState } from "../runtime/runtime-store";
import type {
  ComposerContextUsage,
  ComposerModelId,
  ComposerPermission,
  ComposerReasoningEffort,
  ComposerRunMode,
  ComposerStatusItem,
} from "../composer/composer-data";

/**
 * UAgent UI type definitions
 *
 * Shared types for the desktop UI shell layer.
 */

/** Primary navigation sections in the sidebar. */
export type NavSection = "workspace" | "projects" | "settings";

/** MVP6 sidebar content modes. */
export type SidebarViewMode = "project" | "conversation" | "asset-browser";

/** Mock project data shape for the sidebar ProjectSection. */
export interface MockProject {
  id: string;
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
  type: "Plan" | "Build" | "Review" | "Runtime";
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
  /** Current project workspace sidebar mode. */
  viewMode: SidebarViewMode;
  /** Whether the static asset browser disclosure area is expanded. */
  assetBrowserExpanded: boolean;
}

/** Theme variants supported by the UI shell. */
export type UATheme = "dark" | "light";

/** Layout-related shell state. */
export interface LayoutStoreState {
  /** Current theme. */
  theme: UATheme;
  /** Inspector pane state. */
  inspector: InspectorState;
  /** Sidebar navigation and selection state. */
  sidebar: SidebarState;
}

/** Active project selection state. */
export interface ProjectStoreState {
  /** Active project id from the shared mock project list, or null for no project. */
  activeProjectId: string | null;
}

/** Active thread selection state. */
export interface ThreadStoreState {
  /** Currently selected thread id, or null if none. */
  activeThreadId: string | null;
}

/** Composer dock local-only UI state. */
export interface ComposerStoreState {
  input: string;
  attachMenuOpen: boolean;
  permission: ComposerPermission;
  selectedModelId: ComposerModelId;
  reasoningEffort: ComposerReasoningEffort;
  runMode: ComposerRunMode;
  branch: string;
  context: ComposerContextUsage;
  statusItems: ComposerStatusItem[];
}

/** Global UI shell state consumed by AppShell and child regions. */
export interface UIShellState {
  layout: LayoutStoreState;
  /** Settings shell state. */
  settings: SettingsShellState;
  /** Active project selection state. */
  project: ProjectStoreState;
  /** Active thread selection state. */
  thread: ThreadStoreState;
  /** Composer dock state. */
  composer: ComposerStoreState;
  /** Local-only provider configuration state. */
  provider: ProviderState;
  /** Mock runtime task/event state. */
  runtime: RuntimeStoreState;
}

/** Set the active project id (or null for no project). */
export type SetActiveProject = (projectId: string | null) => void;

/** Toggle the inspector open/closed. */
export type ToggleInspector = () => void;

/** Set the active primary nav section. */
export type SetActiveNav = (nav: NavSection) => void;

/** Set the current sidebar content mode. */
export type SetSidebarViewMode = (viewMode: SidebarViewMode) => void;

/** Set the current UI theme. */
export type SetTheme = (theme: UATheme) => void;

/** Set the active thread by id. */
export type SetActiveThread = (threadId: string) => void;

/** Settings page identifiers for the MVP6 page registry. */
export type SettingsPageId =
  | "general"
  | "profile"
  | "appearance"
  | "config"
  | "personalization"
  | "provider";

/** Settings shell local UI state. */
export interface SettingsShellState {
  open: boolean;
  activePageId: SettingsPageId;
}

export type SetComposerInput = (input: string) => void;

export type SetComposerAttachMenuOpen = (open: boolean) => void;

export type SetComposerPermission = (permission: ComposerPermission) => void;

export type SetComposerModel = (modelId: ComposerModelId) => void;

export type SetComposerReasoning = (effort: ComposerReasoningEffort) => void;

export interface LayoutStoreActions {
  toggleInspector: ToggleInspector;
  setInspectorOpen: (open: boolean) => void;
  setActiveNav: SetActiveNav;
  setSidebarViewMode: SetSidebarViewMode;
  setAssetBrowserExpanded: (expanded: boolean) => void;
  setTheme: SetTheme;
}

export interface SettingsStoreActions {
  openSettings: (pageId?: SettingsPageId) => void;
  closeSettings: () => void;
  setActiveSettingsPage: (pageId: SettingsPageId) => void;
}

export interface ProjectStoreActions {
  setActiveProject: SetActiveProject;
}

export interface ThreadStoreActions {
  setActiveThread: SetActiveThread;
}

export interface ComposerStoreActions {
  setComposerInput: SetComposerInput;
  setComposerAttachMenuOpen: SetComposerAttachMenuOpen;
  setComposerPermission: SetComposerPermission;
  setComposerModel: SetComposerModel;
  setComposerReasoning: SetComposerReasoning;
  submitComposerTask: RuntimeStoreActions["submitComposerTask"];
  cancelRuntimeTask: RuntimeStoreActions["cancelRuntimeTask"];
  submitApprovalDecision: RuntimeStoreActions["submitApprovalDecision"];
}

export interface ProviderStoreActions {
  setSelectedProvider: (providerId: string | null) => void;
  saveProvider: (provider: ProviderConfig) => void;
  deleteProvider: (providerId: string) => void;
  setDefaultProvider: (providerId: string | null) => void;
  setProviderTestStatus: (status: ProviderTestStatus) => void;
}

/** Context value exposed by the UI provider. */
export interface UIContextValue
  extends
    LayoutStoreActions,
    SettingsStoreActions,
    ProjectStoreActions,
    ThreadStoreActions,
    ComposerStoreActions,
    ProviderStoreActions,
    RuntimeStoreActions {
  state: UIShellState;
}

/** Partial input shape accepted by UIProvider for test/setup seeding. */
export interface UIInitialState {
  layout?: Omit<Partial<LayoutStoreState>, "inspector" | "sidebar"> & {
    inspector?: Partial<InspectorState>;
    sidebar?: Partial<SidebarState>;
  };
  settings?: Partial<SettingsShellState>;
  project?: Partial<ProjectStoreState>;
  thread?: Partial<ThreadStoreState>;
  composer?: Partial<ComposerStoreState>;
  provider?: Partial<ProviderState>;
  runtime?: Partial<RuntimeStoreState>;
}
