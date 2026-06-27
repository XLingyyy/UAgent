import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import { getDefaultModelSelection } from "../composer/composer-data";
import { cloneProviderConfig } from "../provider/provider-data";
import type { ProviderConfig, ProviderState } from "../types/provider";
import type {
  ComposerStoreActions,
  ComposerStoreState,
  LayoutStoreActions,
  LayoutStoreState,
  ProjectStoreActions,
  ProjectStoreState,
  ProviderStoreActions,
  SettingsShellState,
  SettingsStoreActions,
  ThreadStoreActions,
  ThreadStoreState,
  UIContextValue,
  UIInitialState,
  UIShellState,
} from "../types/ui";
import {
  createRuntimeStoreState,
  type RuntimeStoreActions,
  type RuntimeStoreState,
} from "../runtime/runtime-store";
import {
  createDesktopRuntimeAdapter,
  type DesktopRuntimeAdapter,
} from "../runtime/desktop-runtime-adapter";
import { createInitialComposerState, createDefaultComposerState } from "./composer-store";
import { createInitialLayoutState } from "./layout-store";
import { createInitialProjectState } from "./project-store";
import { createInitialProviderState } from "./provider-store";
import { createInitialSettingsState, DEFAULT_SETTINGS_STATE } from "./settings-store";
import { createSliceStore, type SliceStore, useSliceStore } from "./store-utils";
import { createInitialThreadState } from "./thread-store";

interface UIStoreBundle {
  layoutStore: SliceStore<LayoutStoreState>;
  settingsStore: SliceStore<SettingsShellState>;
  projectStore: SliceStore<ProjectStoreState>;
  threadStore: SliceStore<ThreadStoreState>;
  composerStore: SliceStore<ComposerStoreState>;
  providerStore: SliceStore<ProviderState>;
  runtimeStore: SliceStore<RuntimeStoreState>;
  layoutActions: LayoutStoreActions;
  settingsActions: SettingsStoreActions;
  projectActions: ProjectStoreActions;
  threadActions: ThreadStoreActions;
  composerActions: ComposerStoreActions;
  providerActions: ProviderStoreActions;
  runtimeActions: RuntimeStoreActions;
}

const UIStoreContext = createContext<UIStoreBundle | null>(null);

function createUIStateBundle(
  initialState?: UIInitialState,
  runtimeClient: DesktopRuntimeAdapter = createDesktopRuntimeAdapter(),
): UIStoreBundle {
  const providerState = createInitialProviderState(initialState);
  const layoutStore = createSliceStore(createInitialLayoutState(initialState));
  const settingsStore = createSliceStore(createInitialSettingsState(initialState));
  const projectStore = createSliceStore(createInitialProjectState(initialState));
  const threadStore = createSliceStore(createInitialThreadState(initialState));
  const composerStore = createSliceStore(createInitialComposerState(initialState, providerState));
  const providerStore = createSliceStore(providerState);
  const runtimeStore = createSliceStore({
    ...createRuntimeStoreState(runtimeClient.getSnapshot()),
    ...initialState?.runtime,
  });

  runtimeClient.subscribe((snapshot) => {
    runtimeStore.setState((previousState) => ({
      ...previousState,
      ...snapshot,
      mockOnlyWarning:
        previousState.mcp.status === "connected"
          ? "MCP read-only runtime / no provider call"
          : "Mock runtime / no provider call",
    }));
  });
  runtimeClient.subscribeMcp((mcp) => {
    runtimeStore.setState((previousState) => ({
      ...previousState,
      mcp,
      mockOnlyWarning:
        mcp.status === "connected"
          ? "MCP read-only runtime / no provider call"
          : "Mock runtime / no provider call",
    }));
  });

  const syncComposerSelection = (
    previousProviderState: ProviderState,
    nextProviderState: ProviderState,
  ) => {
    const previousDefault = getDefaultModelSelection(
      previousProviderState.providers,
      previousProviderState.defaultProviderId,
    );
    const nextDefault = getDefaultModelSelection(
      nextProviderState.providers,
      nextProviderState.defaultProviderId,
    );
    const defaultChanged =
      previousProviderState.defaultProviderId !== nextProviderState.defaultProviderId ||
      previousDefault.modelId !== nextDefault.modelId ||
      previousDefault.reasoningEffort !== nextDefault.reasoningEffort;

    composerStore.setState((previousComposerState) => {
      const currentModelExists =
        previousComposerState.selectedModelId === "not-configured" ||
        nextProviderState.providers.some(
          (provider) =>
            provider.enabled &&
            provider.models.some((model) => model.id === previousComposerState.selectedModelId),
        );
      const shouldSyncDefault =
        defaultChanged ||
        !currentModelExists ||
        (previousComposerState.selectedModelId === "not-configured" &&
          nextDefault.modelId !== "not-configured");

      if (!shouldSyncDefault) {
        return previousComposerState;
      }

      if (
        previousComposerState.selectedModelId === nextDefault.modelId &&
        previousComposerState.reasoningEffort === nextDefault.reasoningEffort
      ) {
        return previousComposerState;
      }

      return {
        ...previousComposerState,
        selectedModelId: nextDefault.modelId,
        reasoningEffort: nextDefault.reasoningEffort,
      };
    });
  };

  const layoutActions: LayoutStoreActions = {
    toggleInspector: () =>
      layoutStore.setState((previousState) => ({
        ...previousState,
        inspector: { open: !previousState.inspector.open },
      })),
    setInspectorOpen: (open) =>
      layoutStore.setState((previousState) =>
        previousState.inspector.open === open
          ? previousState
          : {
              ...previousState,
              inspector: { open },
            },
      ),
    setActiveNav: (nav) =>
      layoutStore.setState((previousState) =>
        previousState.sidebar.activeNav === nav
          ? previousState
          : {
              ...previousState,
              sidebar: { ...previousState.sidebar, activeNav: nav },
            },
      ),
    setTheme: (theme) =>
      layoutStore.setState((previousState) =>
        previousState.theme === theme ? previousState : { ...previousState, theme },
      ),
  };

  const settingsActions: SettingsStoreActions = {
    openSettings: (pageId) =>
      settingsStore.setState({
        open: true,
        activePageId: pageId ?? DEFAULT_SETTINGS_STATE.activePageId,
      }),
    closeSettings: () =>
      settingsStore.setState((previousState) => ({
        ...previousState,
        open: false,
      })),
    setActiveSettingsPage: (pageId) =>
      settingsStore.setState((previousState) =>
        previousState.activePageId === pageId
          ? previousState
          : {
              ...previousState,
              activePageId: pageId,
            },
      ),
  };

  const projectActions: ProjectStoreActions = {
    setActiveProject: (projectId) =>
      projectStore.setState((previousState) =>
        previousState.activeProjectId === projectId
          ? previousState
          : { activeProjectId: projectId },
      ),
  };

  const threadActions: ThreadStoreActions = {
    setActiveThread: (threadId) =>
      threadStore.setState((previousState) =>
        previousState.activeThreadId === threadId ? previousState : { activeThreadId: threadId },
      ),
  };

  const composerActions: ComposerStoreActions = {
    setComposerInput: (input) =>
      composerStore.setState((previousState) =>
        previousState.input === input ? previousState : { ...previousState, input },
      ),
    setComposerPermission: (permission) =>
      composerStore.setState((previousState) =>
        previousState.permission === permission ? previousState : { ...previousState, permission },
      ),
    setComposerModel: (selectedModelId) =>
      composerStore.setState((previousState) =>
        previousState.selectedModelId === selectedModelId
          ? previousState
          : { ...previousState, selectedModelId },
      ),
    setComposerReasoning: (reasoningEffort) =>
      composerStore.setState((previousState) =>
        previousState.reasoningEffort === reasoningEffort
          ? previousState
          : { ...previousState, reasoningEffort },
      ),
    submitComposerTask: async (draft) => {
      composerStore.setState((previousState) => ({ ...previousState, input: "" }));
      const record = await runtimeClient.submitTask(draft);
      threadStore.setState({ activeThreadId: record.id });
      layoutStore.setState((previousState) => ({
        ...previousState,
        sidebar: { ...previousState.sidebar, activeNav: "workspace" },
      }));
      return record.id;
    },
    cancelRuntimeTask: async (taskId) => {
      await runtimeClient.cancelTask(taskId);
    },
    submitApprovalDecision: async (taskId, stepId, decision, actor, reason) => {
      await runtimeClient.submitApprovalDecision(taskId, stepId, decision, actor, reason);
    },
  };

  const runtimeActions: RuntimeStoreActions = {
    submitComposerTask: composerActions.submitComposerTask,
    cancelRuntimeTask: composerActions.cancelRuntimeTask,
    submitApprovalDecision: async (taskId, stepId, decision, actor, reason) => {
      await runtimeClient.submitApprovalDecision(taskId, stepId, decision, actor, reason);
    },
    setMcpEndpoint: (endpoint) => {
      runtimeClient.setMcpEndpoint(endpoint);
    },
    connectMcp: async () => {
      await runtimeClient.connectMcp();
    },
    discoverMcp: async () => {
      await runtimeClient.discoverMcp();
    },
    disconnectMcp: () => {
      runtimeClient.disconnectMcp();
    },
  };

  const providerActions: ProviderStoreActions = {
    setSelectedProvider: (providerId) =>
      providerStore.setState((previousState) =>
        previousState.selectedProviderId === providerId
          ? previousState
          : { ...previousState, selectedProviderId: providerId, testStatus: "idle" },
      ),
    saveProvider: (nextProviderConfig: ProviderConfig) => {
      const previousProviderState = providerStore.getState();
      const nextProvider = cloneProviderConfig(nextProviderConfig);
      const existingIndex = previousProviderState.providers.findIndex(
        (provider) => provider.providerId === nextProvider.providerId,
      );
      const providers = [...previousProviderState.providers];

      if (existingIndex >= 0) {
        providers.splice(existingIndex, 1, nextProvider);
      } else {
        providers.push(nextProvider);
      }

      const nextProviderState: ProviderState = {
        ...previousProviderState,
        providers,
        selectedProviderId: nextProvider.providerId,
        testStatus: "idle",
      };

      providerStore.setState(nextProviderState);
      syncComposerSelection(previousProviderState, nextProviderState);
    },
    deleteProvider: (providerId) => {
      const previousProviderState = providerStore.getState();
      const providers = previousProviderState.providers.filter(
        (provider) => provider.providerId !== providerId,
      );
      const fallbackId = providers[0]?.providerId ?? null;
      const nextProviderState: ProviderState = {
        ...previousProviderState,
        providers,
        selectedProviderId:
          previousProviderState.selectedProviderId === providerId
            ? fallbackId
            : previousProviderState.selectedProviderId,
        defaultProviderId:
          previousProviderState.defaultProviderId === providerId
            ? null
            : previousProviderState.defaultProviderId,
        testStatus: "idle",
      };

      providerStore.setState(nextProviderState);
      syncComposerSelection(previousProviderState, nextProviderState);
    },
    setDefaultProvider: (providerId) => {
      const previousProviderState = providerStore.getState();
      if (previousProviderState.defaultProviderId === providerId) {
        return;
      }

      const nextProviderState: ProviderState = {
        ...previousProviderState,
        defaultProviderId: providerId,
      };

      providerStore.setState(nextProviderState);
      syncComposerSelection(previousProviderState, nextProviderState);
    },
    setProviderTestStatus: (status) =>
      providerStore.setState((previousState) =>
        previousState.testStatus === status ? previousState : { ...previousState, testStatus: status },
      ),
  };

  return {
    layoutStore,
    settingsStore,
    projectStore,
    threadStore,
    composerStore,
    providerStore,
    runtimeStore,
    layoutActions,
    settingsActions,
    projectActions,
    threadActions,
    composerActions,
    providerActions,
    runtimeActions,
  };
}

function useUIStoreBundle(): UIStoreBundle {
  const context = useContext(UIStoreContext);
  if (!context) {
    throw new Error("UI store hooks must be used within a UIProvider");
  }
  return context;
}

export interface UIProviderProps {
  children: ReactNode;
  initialState?: UIInitialState;
  runtimeClient?: DesktopRuntimeAdapter;
}

export function UIProvider({ children, initialState, runtimeClient }: UIProviderProps) {
  const storeBundle = useMemo(
    () => createUIStateBundle(initialState, runtimeClient),
    [initialState, runtimeClient],
  );
  return createElement(UIStoreContext.Provider, { value: storeBundle }, children);
}

export function useLayoutStore<TSelected>(
  selector: (state: LayoutStoreState) => TSelected,
): TSelected {
  const { layoutStore } = useUIStoreBundle();
  return useSliceStore(layoutStore, selector);
}

export function useSettingsStore<TSelected>(
  selector: (state: SettingsShellState) => TSelected,
): TSelected {
  const { settingsStore } = useUIStoreBundle();
  return useSliceStore(settingsStore, selector);
}

export function useProjectStore<TSelected>(
  selector: (state: ProjectStoreState) => TSelected,
): TSelected {
  const { projectStore } = useUIStoreBundle();
  return useSliceStore(projectStore, selector);
}

export function useThreadStore<TSelected>(
  selector: (state: ThreadStoreState) => TSelected,
): TSelected {
  const { threadStore } = useUIStoreBundle();
  return useSliceStore(threadStore, selector);
}

export function useComposerStore<TSelected>(
  selector: (state: ComposerStoreState) => TSelected,
): TSelected {
  const { composerStore } = useUIStoreBundle();
  return useSliceStore(composerStore, selector);
}

export function useProviderStore<TSelected>(
  selector: (state: ProviderState) => TSelected,
): TSelected {
  const { providerStore } = useUIStoreBundle();
  return useSliceStore(providerStore, selector);
}

export function useRuntimeStore<TSelected>(
  selector: (state: RuntimeStoreState) => TSelected,
): TSelected {
  const { runtimeStore } = useUIStoreBundle();
  return useSliceStore(runtimeStore, selector);
}

export function useOptionalRuntimeStore<TSelected>(
  selector: (state: RuntimeStoreState) => TSelected,
): TSelected | null {
  const context = useContext(UIStoreContext);
  if (!context) {
    return null;
  }

  return useSliceStore(context.runtimeStore, selector);
}

export function useLayoutActions(): LayoutStoreActions {
  return useUIStoreBundle().layoutActions;
}

export function useSettingsActions(): SettingsStoreActions {
  return useUIStoreBundle().settingsActions;
}

export function useProjectActions(): ProjectStoreActions {
  return useUIStoreBundle().projectActions;
}

export function useThreadActions(): ThreadStoreActions {
  return useUIStoreBundle().threadActions;
}

export function useComposerActions(): ComposerStoreActions {
  return useUIStoreBundle().composerActions;
}

export function useProviderActions(): ProviderStoreActions {
  return useUIStoreBundle().providerActions;
}

export function useRuntimeActions(): RuntimeStoreActions {
  return useUIStoreBundle().runtimeActions;
}

export function useOptionalRuntimeActions(): RuntimeStoreActions | null {
  const context = useContext(UIStoreContext);
  return context?.runtimeActions ?? null;
}

export function useUI(): UIContextValue {
  const layout = useLayoutStore((state) => state);
  const settings = useSettingsStore((state) => state);
  const project = useProjectStore((state) => state);
  const thread = useThreadStore((state) => state);
  const composer = useComposerStore((state) => state);
  const provider = useProviderStore((state) => state);
  const runtime = useRuntimeStore((state) => state);
  const layoutActions = useLayoutActions();
  const settingsActions = useSettingsActions();
  const projectActions = useProjectActions();
  const threadActions = useThreadActions();
  const composerActions = useComposerActions();
  const providerActions = useProviderActions();
  const runtimeActions = useRuntimeActions();

  return useMemo<UIContextValue>(
    () => ({
      state: {
        layout,
        settings,
        project,
        thread,
        composer,
        provider,
        runtime,
      } satisfies UIShellState,
      ...layoutActions,
      ...settingsActions,
      ...projectActions,
      ...threadActions,
      ...composerActions,
      ...providerActions,
      ...runtimeActions,
    }),
    [
      composer,
      composerActions,
      layout,
      layoutActions,
      project,
      projectActions,
      provider,
      providerActions,
      runtime,
      runtimeActions,
      settings,
      settingsActions,
      thread,
      threadActions,
    ],
  );
}

export { createDefaultComposerState };
