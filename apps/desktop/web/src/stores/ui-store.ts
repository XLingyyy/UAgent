import { createContext, createElement, useContext, useMemo, type ReactNode } from "react";
import {
  createContextPackV1,
  createAssetChangeSetService,
  createAssetManifestRegistry,
  createEditorOperationService,
  createEditorSessionRegistry,
  createFixtureAssetMutationAdapter,
  createMvp15McpAssetMutationAdapter,
  createMvp15McpAssetToolInventory,
  createMcpMutationService,
  createRepairProposalEngine,
  createUEProjectDiagnosticsEngine,
  buildExactDryRunPayload,
  mapMcpDryRunToOperation,
  normalizeMvp15McpAssetToolDescriptor,
  parseUEProjectMetadata,
  replayAssetMutationSummary,
  type AssetChangeSetService,
  type AssetMutationExternalBinder,
  type DryRunBindingInput,
  type Mvp15McpAssetToolDescriptor,
  type Mvp15McpAssetToolInventory,
} from "@uagent/runtime";
import type { ChangeOperationV2, ProjectDiagnostic } from "@uagent/shared";
import type { AssetMutationDraftOperation } from "@uagent/runtime";
import { createNativeProjectAdapter } from "../runtime/project-native-adapter";
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
  analyzeRecordedBuildOutput,
  createEmptyMvp11State,
  createRuntimeStoreState,
  refreshMvp11DerivedState,
  refreshMvp12DerivedState,
  refreshMvp13DerivedState,
  refreshMvp15DerivedState,
  type RuntimeStoreActions,
  type RuntimeStoreState,
} from "../runtime/runtime-store";
import {
  createDesktopRuntimeAdapter,
  type DesktopRuntimeAdapter,
} from "../runtime/desktop-runtime-adapter";
import type {
  NativeApplyTextMutationOperation,
  NativeBoundChangeSetApproval,
  NativePreviewedTextMutationOperation,
} from "../runtime/text-mutation-native-adapter";
import { createInitialComposerState, createDefaultComposerState } from "./composer-store";
import { createInitialLayoutState } from "./layout-store";
import { createInitialProjectState } from "./project-store";
import { createInitialProviderState } from "./provider-store";
import { createInitialSettingsState, DEFAULT_SETTINGS_STATE } from "./settings-store";
import { createSliceStore, type SliceStore, useSliceStore } from "./store-utils";
import { createInitialThreadState } from "./thread-store";

function buildMcpObservations(runtimeState: RuntimeStoreState) {
  const capabilities = runtimeState.mcp.capabilities;
  if (!capabilities) {
    return [];
  }

  return [
    {
      id: "mcp-observation-ui-summary",
      kind: "mcp_discovery" as const,
      source: runtimeState.mcp.profile?.endpoint ?? "mcp",
      summary: `${capabilities.resources} resources, ${capabilities.readOnlyTools} read-only tools, ${capabilities.blockedTools} blocked tools.`,
      createdAt: Date.now(),
    },
  ];
}

function isMvp12PreviewableTextPath(rootRelativePath: string): boolean {
  const lower = rootRelativePath.toLowerCase();
  return (
    lower.endsWith(".ini") ||
    lower.endsWith(".build.cs") ||
    lower.endsWith(".target.cs") ||
    lower.endsWith(".cs") ||
    lower.endsWith(".cpp") ||
    lower.endsWith(".h") ||
    lower.endsWith(".hpp") ||
    lower.endsWith(".uproject") ||
    lower.endsWith(".uplugin")
  );
}

function stripProjectRoot(displayPath: string | null | undefined): string | null {
  if (!displayPath) return null;
  return displayPath.replace(/^\[project-root\]\//, "");
}

function getMvp12OperationAfterContent(operation: ChangeOperationV2): string | null {
  const symbol = Object.getOwnPropertySymbols(operation).find((item) => String(item) === "Symbol(mvp12.operation.afterContent)");
  if (!symbol) return null;
  const value = (operation as unknown as Record<symbol, unknown>)[symbol];
  return typeof value === "string" ? value : null;
}

function copyMvp12OperationAfterContent(source: ChangeOperationV2, target: ChangeOperationV2): ChangeOperationV2 {
  const symbol = Object.getOwnPropertySymbols(source).find((item) => String(item) === "Symbol(mvp12.operation.afterContent)");
  const afterContent = getMvp12OperationAfterContent(source);
  if (symbol && afterContent !== null) {
    Object.defineProperty(target, symbol, {
      configurable: false,
      enumerable: false,
      value: afterContent,
      writable: false,
    });
  }
  return target;
}

function bindOperationToNativePreview(
  operation: ChangeOperationV2,
  preview: NativePreviewedTextMutationOperation | undefined,
): ChangeOperationV2 {
  if (!preview) return operation;
  return copyMvp12OperationAfterContent(operation, {
    ...operation,
    target: {
      ...operation.target,
      rootRelativePath: preview.rootRelativePath,
      displayPath: preview.displayPath,
    },
    beforeHash: preview.beforeHash,
    afterHash: preview.afterHash,
    unifiedDiff: preview.unifiedDiff,
    displayDiff: preview.unifiedDiff,
  });
}

function toNativeApplyOperation(operation: ChangeOperationV2): NativeApplyTextMutationOperation | null {
  const afterContent = getMvp12OperationAfterContent(operation);
  if (afterContent === null) return null;
  return {
    operationId: operation.id,
    rootRelativePath: operation.target.rootRelativePath,
    displayPath: operation.target.displayPath,
    beforeHash: operation.beforeHash,
    afterHash: operation.afterHash,
    unifiedDiff: operation.unifiedDiff,
    afterContent,
  };
}

function isMvp15RealReady(state: RuntimeStoreState): boolean {
  return (
    state.mvp15.gate.mode === "sandbox-enabled" &&
    state.mvp14.session?.mode === "attached" &&
    state.mvp14.status?.status === "ready" &&
    state.mvp14.status.heartbeat?.processAlive === true
  );
}

function getMvp15ObservedPidHash(state: RuntimeStoreState): string | null {
  if (state.mvp14.status?.heartbeat?.processAlive !== true) return null;
  const pidHash = state.mvp14.session?.pidHash?.trim();
  return pidHash ? pidHash : null;
}

function sanitizeMvp15AssetName(name: string): string {
  const sanitized = name.replace(/[^A-Za-z0-9_]/g, "");
  return sanitized || "Asset";
}

function formatMvp15InventoryBlocker(inventory: ReturnType<typeof createMvp15McpAssetToolInventory>): string {
  const firstMissingTool = inventory.missingTools[0];
  if (firstMissingTool) return `blocked_by_mcp_schema:missing_tool:${firstMissingTool}`;
  const firstMissingSchema = inventory.missingSchemas[0];
  if (firstMissingSchema) return `blocked_by_mcp_schema:schema_required:${firstMissingSchema}`;
  const firstMissingDryRun = inventory.missingDryRunSchemas[0];
  if (firstMissingDryRun) return `blocked_by_mcp_schema:dry_run_required:${firstMissingDryRun}`;
  const firstMissingRollback = inventory.missingRollbackContracts[0];
  if (firstMissingRollback) return `blocked_by_mcp_schema:rollback_contract_required:${firstMissingRollback}`;
  const firstMissingEvidence = inventory.missingEvidenceQueries[0];
  if (firstMissingEvidence) return `blocked_by_mcp_schema:external_evidence_required:${firstMissingEvidence}`;
  return "blocked_by_mcp_schema:unknown";
}

function createMvp15FixtureAssetMutationService(): AssetChangeSetService {
  return createAssetChangeSetService({
    manifest: createAssetManifestRegistry(),
    adapter: createFixtureAssetMutationAdapter(),
  });
}

function getMvp15McpAssetTools(runtimeClient: DesktopRuntimeAdapter): Mvp15McpAssetToolDescriptor[] {
  const adapterTools = runtimeClient.getMvp15AssetTools?.();
  if (adapterTools) return adapterTools.map(normalizeMvp15McpAssetToolDescriptor);
  return (runtimeClient.getMcpDiscovery()?.tools ?? []).map(normalizeMvp15McpAssetToolDescriptor);
}

function getMvp15McpAssetInventory(runtimeClient: DesktopRuntimeAdapter): Mvp15McpAssetToolInventory | null {
  if (!runtimeClient.getMcpDiscovery()) return null;
  return createMvp15McpAssetToolInventory(getMvp15McpAssetTools(runtimeClient));
}

function applyMvp15McpInventory(
  state: RuntimeStoreState["mvp15"],
  inventory: Mvp15McpAssetToolInventory | null,
): RuntimeStoreState["mvp15"] {
  if (!inventory) {
    return {
      ...state,
      executionMode: state.executionMode === "blocked_by_mcp_schema" ? "fixture" : state.executionMode,
      mcpInventory: null,
      lastError: state.lastError?.startsWith("blocked_by_mcp_schema") ? null : state.lastError,
    };
  }
  return {
    ...state,
    executionMode:
      inventory.status === "blocked_by_mcp_schema"
        ? "blocked_by_mcp_schema"
        : state.executionMode === "blocked_by_mcp_schema"
          ? "fixture"
          : state.executionMode,
    mcpInventory: inventory,
    lastError:
      inventory.status === "blocked_by_mcp_schema"
        ? formatMvp15InventoryBlocker(inventory)
        : state.lastError?.startsWith("blocked_by_mcp_schema")
          ? null
          : state.lastError,
  };
}

function createMvp15RealAssetMutationService(
  runtimeClient: DesktopRuntimeAdapter,
  state: RuntimeStoreState,
  tools: Mvp15McpAssetToolDescriptor[],
  observedPidHash: string,
): AssetChangeSetService {
  return createAssetChangeSetService({
    executionMode: "real",
    manifest: createAssetManifestRegistry(),
    adapter: createMvp15McpAssetMutationAdapter({
      tools,
      assetMutationGateEnabled: state.mvp15.gate.mode === "sandbox-enabled",
      observedEditorSessionId: state.mvp14.status?.heartbeat?.sessionId ?? state.mvp14.session?.sessionId ?? null,
      observedPidHash,
      nativeGuard: (input) =>
        runtimeClient.guardMvp15AssetMutation
          ? runtimeClient.guardMvp15AssetMutation(input)
          : { status: "blocked", reason: "native_asset_guard_unavailable", evidenceId: null },
      callTool: (toolName, args) =>
        runtimeClient.callMvp15AssetTool
          ? runtimeClient.callMvp15AssetTool(toolName, args)
          : { ok: false, status: "blocked", reason: "mcp_asset_bridge_unavailable", evidenceId: null },
    }),
  });
}

/**
 * Build the external dry-run binder that drives the live UE MCP plugin exact dry-run calls.
 * Only the canonical dry-run payload is sent to callMvp15AssetTool: dryRun=true, execute=false,
 * rollback=false, and never any dryRunHash/approvalToken/saveAll. The service validates the
 * structured result fail-closed; this binder is the thin MCP transport and does not interpret it.
 */
async function createMvp15ExternalBinder(runtimeClient: DesktopRuntimeAdapter): Promise<AssetMutationExternalBinder> {
  const callFn = runtimeClient.callMvp15AssetTool;
  if (!callFn) throw new Error("mcp_asset_bridge_unavailable");
  return {
    call: (input: DryRunBindingInput) => callMvp15ToolSafely(callFn, input),
  };
}

async function callMvp15ToolSafely(
  call: NonNullable<DesktopRuntimeAdapter["callMvp15AssetTool"]>,
  input: DryRunBindingInput,
): Promise<unknown> {
  const payload = buildExactDryRunPayload(input);
  // buildExactDryRunPayload only emits one of the six exact allowlisted tool names; the desktop
  // adapter re-validates before any MCP send.
  return call(payload.toolName as Parameters<typeof call>[0], payload.args);
}

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
  const projectAdapter = createNativeProjectAdapter();
  const layoutStore = createSliceStore(createInitialLayoutState(initialState));
  const settingsStore = createSliceStore(createInitialSettingsState(initialState));
  const projectStore = createSliceStore(createInitialProjectState(initialState));
  const threadStore = createSliceStore(createInitialThreadState(initialState));
  const composerStore = createSliceStore(createInitialComposerState(initialState, providerState));
  const providerStore = createSliceStore(providerState);
  const runtimeBaseState = createRuntimeStoreState(runtimeClient.getSnapshot());
  const initialMvp15Inventory = getMvp15McpAssetInventory(runtimeClient);
  const runtimeStore = createSliceStore({
    ...runtimeBaseState,
    mcp: runtimeClient.getMcpState(),
    mvp9: runtimeClient.getMvp9().getState(),
    mvp15: refreshMvp15DerivedState(applyMvp15McpInventory(runtimeBaseState.mvp15, initialMvp15Inventory)),
    ...initialState?.runtime,
  });
  const mvp12ApprovalByChangeSetId = new Map<string, NativeBoundChangeSetApproval>();
  const mvp13SessionRegistry = createEditorSessionRegistry({
    featureEnabled: true,
    trustedRootIds: ["root:fixture"],
  });
  const mvp14NativeAdapter = runtimeClient.getEditorObservationAdapter();
  const mvp13EditorOperationService = createEditorOperationService({
    sessions: mvp13SessionRegistry,
    observation: {
      getSession: () => runtimeStore.getState().mvp14.session,
      readStatus: () =>
        runtimeStore.getState().mvp14.status ?? {
          status: "blocked",
          reason: "observation_status_required",
          heartbeat: null,
        },
    },
  });
  const mvp13McpMutationService = createMcpMutationService({
    allowlist: [{ toolName: "ue.asset.save", assetRisk: true, requiresDryRun: true }],
  });
  const mvp13ApprovalTokenByProposalId = new Map<string, string>();
  let mvp15AssetMutationService = createMvp15FixtureAssetMutationService();
  const mvp15ApprovalTokenByChangeSetId = new Map<string, string>();
  let mvp15RunCounter = 0;
  let runningGeneration = 0;
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
    const mvp15Inventory = getMvp15McpAssetInventory(runtimeClient);
    runtimeStore.setState((previousState) => ({
      ...previousState,
      mcp,
      mvp15: refreshMvp15DerivedState(applyMvp15McpInventory(previousState.mvp15, mvp15Inventory)),
      mockOnlyWarning:
        mcp.status === "connected"
          ? "MCP read-only runtime / no provider call"
          : "Mock runtime / no provider call",
    }));
  });
  runtimeClient.subscribeMvp9((mvp9State) => {
    runtimeStore.setState((previousState) => ({
      ...previousState,
      mvp9: mvp9State,
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

  const getMvp14ProcessConfig = () => {
    const projectState = projectStore.getState();
    const activeProject =
      projectState.registeredProjects.find((project) => project.id === projectState.activeProjectId) ??
      projectState.registeredProjects[0] ??
      null;
    const uprojectRelativePath =
      projectState.activeProjectIndex?.files.find((file) => file.extension === ".uproject")?.rootRelativePath ??
      "Game.uproject";

    return {
      projectId: projectState.activeProjectIndex?.projectId ?? activeProject?.id ?? "project:fixture",
      rootRef: projectState.activeProjectIndex?.rootRef ?? activeProject?.rootRef ?? "fixture://lyra-starter",
      uprojectRelativePath,
    };
  };

  const unavailableMvp14Capability = () => ({
    enabled: false,
    mode: "disabled" as const,
    reason: "native_adapter_unavailable",
    trustedRootRequired: true as const,
    mutationExecution: "blocked" as const,
  });

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
              sidebar: {
                ...previousState.sidebar,
                activeNav: nav,
                viewMode: nav === "projects" ? "asset-browser" : previousState.sidebar.viewMode,
              },
            },
      ),
    setSidebarViewMode: (viewMode) =>
      layoutStore.setState((previousState) =>
        previousState.sidebar.viewMode === viewMode
          ? previousState
          : {
              ...previousState,
              sidebar: { ...previousState.sidebar, viewMode },
            },
      ),
    setAssetBrowserExpanded: (expanded) =>
      layoutStore.setState((previousState) =>
        previousState.sidebar.assetBrowserExpanded === expanded
          ? previousState
          : {
              ...previousState,
              sidebar: { ...previousState.sidebar, assetBrowserExpanded: expanded },
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
          : { ...previousState, activeProjectId: projectId },
      ),
    validateProjectRoot: async (rootRef) => {
      try {
        const validation = await projectAdapter.validateRoot(rootRef);
        if (!validation.ok) {
          projectStore.setState((previousState) => ({
            ...previousState,
            validation,
            lastError: validation.reason,
            auditTrail: [...previousState.auditTrail, `project_root_validated:${validation.reason}`],
          }));
          return;
        }
        // Check for existing fixture project, then try to add/validate the root
        const fixtureProject = projectAdapter.getProject("project-lyra-starter");
        const project = fixtureProject ?? (await projectAdapter.addProject(rootRef));
        projectStore.setState((previousState) => ({
          ...previousState,
          validation,
          registeredProjects: projectAdapter.listProjects(),
          activeProjectId: project.id,
          scanStatus: project.indexStatus,
          nativeSource: projectAdapter.source,
          capabilityStatus: projectAdapter.getCapabilityStatus(),
          fsPolicy: projectAdapter.getPolicy(),
          lastError: null,
          auditTrail: [...previousState.auditTrail, "project_root_validated:valid"],
        }));
      } catch (error) {
        projectStore.setState((previousState) => ({
          ...previousState,
          lastError: error instanceof Error ? error.message : "project_validation_failed",
        }));
      }
    },
    trustProjectRoot: async (projectId) => {
      try {
        const trusted = await projectAdapter.confirmTrust(projectId);
        projectStore.setState((previousState) => ({
          ...previousState,
          registeredProjects: projectAdapter.listProjects(),
          activeProjectId: trusted.id,
          scanStatus: trusted.indexStatus,
          lastError: null,
          auditTrail: [...previousState.auditTrail, "project_trusted"],
        }));
      } catch (error) {
        projectStore.setState((previousState) => ({
          ...previousState,
          lastError: error instanceof Error ? error.message : "project_trust_failed",
        }));
      }
    },
    scanProjectIndex: async (projectId) => {
      try {
        projectAdapter.updateIndexStatus(projectId, "scanning");
        projectStore.setState((previousState) => ({
          ...previousState,
          scanStatus: "scanning",
          registeredProjects: projectAdapter.listProjects(),
        }));
        const result = await projectAdapter.scanProject(projectId);
        projectStore.setState((previousState) => ({
          ...previousState,
          activeProjectIndex: result.snapshot,
          scanStatus: result.snapshot.status,
          registeredProjects: projectAdapter.listProjects(),
          lastError: null,
          auditTrail: [...previousState.auditTrail, ...result.events],
        }));
      } catch (error) {
        projectStore.setState((previousState) => ({
          ...previousState,
          scanStatus: "failed",
          lastError: error instanceof Error ? error.message : "project_scan_failed",
        }));
      }
    },
    cancelProjectScan: async (projectId) => {
      try {
        const result = await projectAdapter.cancelScan(projectId);
        projectStore.setState((previousState) => ({
          ...previousState,
          activeProjectIndex: result.snapshot,
          scanStatus: "cancelled",
          registeredProjects: projectAdapter.listProjects(),
          lastError: null,
          auditTrail: [...previousState.auditTrail, ...result.events],
        }));
      } catch (error) {
        projectStore.setState((previousState) => ({
          ...previousState,
          lastError: error instanceof Error ? error.message : "project_scan_cancel_failed",
        }));
      }
    },
    setAssetFilter: (filter) =>
      projectStore.setState((previousState) => ({
        ...previousState,
        assetFilter: filter,
      })),
    previewProjectFile: async (rootRelativePath) => {
      const state = projectStore.getState();
      const activeProject = state.registeredProjects.find(
        (project) => project.id === state.activeProjectId,
      );
      if (!activeProject) {
        projectStore.setState((previousState) => ({ ...previousState, lastError: "unknown_project" }));
        return;
      }
      try {
        const preview = await projectAdapter.previewFile(
          activeProject.id,
          activeProject.rootRef,
          rootRelativePath,
          4096,
          80,
        );
        projectStore.setState((previousState) => ({
          ...previousState,
          selectedAssetPath: rootRelativePath,
          preview,
          auditTrail: [
            ...previousState.auditTrail,
            preview.status === "blocked" ? "file_preview_blocked" : "file_preview_completed",
          ],
        }));
      } catch (error) {
        projectStore.setState((previousState) => ({
          ...previousState,
          lastError: error instanceof Error ? error.message : "file_preview_failed",
        }));
      }
    },
    refreshCapabilityStatus: () => {
      projectStore.setState((previousState) => ({
        ...previousState,
        capabilityStatus: projectAdapter.getCapabilityStatus(),
      }));
    },
    refreshFsPolicy: () => {
      projectStore.setState((previousState) => ({
        ...previousState,
        fsPolicy: projectAdapter.getPolicy(),
      }));
    },
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
    setComposerAttachMenuOpen: (open) =>
      composerStore.setState((previousState) =>
        previousState.attachMenuOpen === open
          ? previousState
          : { ...previousState, attachMenuOpen: open },
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
    proposeTerminalCommand: (command, cwd, taskId) => {
      runtimeClient.getMvp9().terminal.propose(command, cwd, taskId);
    },
    approveTerminalProposal: async (proposalId, actor, reason) => {
      await runtimeClient.getMvp9().terminal.approve(proposalId, actor, reason);
    },
    rejectTerminalProposal: (proposalId, actor, reason) => {
      runtimeClient.getMvp9().terminal.reject(proposalId, actor, reason);
    },
    cancelTerminalExecution: (executionId) => {
      runtimeClient.getMvp9().terminal.cancel(executionId);
    },
    resetTerminal: () => {
      runtimeClient.getMvp9().terminal.reset();
    },
    proposeMvp10TerminalCommand: async (command, cwd, taskId, trustedRoot, projectId) => {
      await runtimeClient.getMvp9().mvp10.terminal.propose(command, cwd, taskId, trustedRoot, projectId);
    },
    approveMvp10TerminalProposal: async (proposalId, actor, reason) => {
      const token = await runtimeClient.getMvp9().mvp10.terminal.approve(proposalId, actor, reason);
      return token?.id ?? null;
    },
    rejectMvp10TerminalProposal: (proposalId, actor, reason) => {
      runtimeClient.getMvp9().mvp10.terminal.reject(proposalId, actor, reason);
    },
    cancelMvp10TerminalExecution: (executionId) => {
      runtimeClient.getMvp9().mvp10.terminal.cancel(executionId);
    },
    resetMvp10Terminal: () => {
      runtimeClient.getMvp9().mvp10.terminal.reset();
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp11: refreshMvp11DerivedState({
          ...previousState.mvp11,
          buildAnalysis: null,
          buildAnalysisStatus: "idle",
          terminalEvidenceSummary: null,
          analysisRequested: false,
        }),
      }));
    },
    analyzeBuildOutputEvidence: () => {
      runtimeStore.setState((previousState) => analyzeRecordedBuildOutput(previousState));
    },
    analyzeActiveProjectDiagnostics: async () => {
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp11: { ...previousState.mvp11, metadataStatus: "running", lastError: null },
      }));

      try {
        const project = projectStore.getState();
        const snapshot = project.activeProjectIndex;
        const activeProject =
          project.registeredProjects.find((item) => item.id === project.activeProjectId) ??
          project.registeredProjects.find((item) => item.id === snapshot?.projectId) ??
          null;

        if (!snapshot || !activeProject) {
          throw new Error("No active indexed project is available for MVP11 diagnostics.");
        }

        const previewPaths = snapshot.files
          .filter((file) =>
            file.extension === ".uproject" ||
            file.extension === ".uplugin" ||
            file.extension === ".ini" ||
            file.displayName.endsWith(".Target.cs") ||
            file.displayName.endsWith(".Build.cs"),
          )
          .map((file) => file.rootRelativePath);
        const previews = new Map(
          await Promise.all(
            previewPaths.map(async (rootRelativePath) => {
              const preview = await projectAdapter.previewFile(
                activeProject.id,
                activeProject.rootRef,
                rootRelativePath,
                4096,
                80,
              );
              return [rootRelativePath, preview] as const;
            }),
          ),
        );

        const metadata = parseUEProjectMetadata({
          snapshot,
          previewFile: (rootRelativePath) => {
            const preview = previews.get(rootRelativePath);
            return {
              status: preview?.status ?? "missing",
              content: preview?.content ?? "",
            };
          },
          createdAt: Date.now(),
        });
        const projectDiagnostics = createUEProjectDiagnosticsEngine().analyze({
          snapshot,
          metadata,
          createdAt: Date.now(),
        });
        const mcpObservations = buildMcpObservations(runtimeStore.getState());

        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp11: refreshMvp11DerivedState({
            ...previousState.mvp11,
            metadataStatus: "completed",
            metadata,
            projectDiagnostics,
            mcpObservations,
            mcpDiagnostics: [],
            analysisRequested: true,
            lastError: null,
          }),
        }));
      } catch (error) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp11: {
            ...previousState.mvp11,
            metadataStatus: "failed",
            analysisRequested: true,
            lastError: error instanceof Error ? error.message : "mvp11_project_diagnostics_failed",
          },
        }));
      }
    },
    createMvp11ContextPack: () => {
      const project = projectStore.getState();
      runtimeStore.setState((previousState) => {
        const { mvp11 } = previousState;
        if (!project.activeProjectIndex || !mvp11.metadata) {
          return {
            ...previousState,
            mvp11: {
              ...mvp11,
              contextPackStatus: "failed",
              lastError: "MVP11 Context Pack requires project metadata diagnostics first.",
            },
          };
        }

        const contextPack = createContextPackV1({
          snapshot: project.activeProjectIndex,
          metadata: mvp11.metadata,
          projectDiagnostics: [...mvp11.projectDiagnostics, ...mvp11.mcpDiagnostics],
          buildDiagnostics: mvp11.buildAnalysis?.diagnostics ?? [],
          mcpObservations: mvp11.mcpObservations,
          terminalEvidenceSummary: mvp11.terminalEvidenceSummary ?? undefined,
          createdAt: Date.now(),
        });

        return {
          ...previousState,
          mvp11: refreshMvp11DerivedState({
            ...mvp11,
            contextPackStatus: "completed",
            contextPack,
            analysisRequested: true,
            lastError: null,
          }),
        };
      });
    },
    resetMvp11Diagnostics: () => {
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp11: createEmptyMvp11State(),
      }));
    },
    proposeRepairForDiagnostic: async (diagnosticId) => {
      const project = projectStore.getState();
      const snapshot = project.activeProjectIndex;
      const activeProject =
        project.registeredProjects.find((item) => item.id === project.activeProjectId) ??
        project.registeredProjects.find((item) => item.indexStatus === "ready");
      const runtime = runtimeStore.getState();
      const diagnostic = [...runtime.mvp11.projectDiagnostics, ...(runtime.mvp11.buildAnalysis?.diagnostics ?? [])]
        .find((item) => item.id === diagnosticId);
      if (!snapshot || !activeProject || !diagnostic) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp12: { ...previousState.mvp12, lastError: "mvp12_requires_active_project_index_and_diagnostic" },
        }));
        return;
      }
      const directPath = stripProjectRoot(diagnostic.displayPath);
      const previewPaths = [
        ...new Set([
          ...(directPath ? [directPath] : []),
          ...snapshot.files
            .filter((file) => isMvp12PreviewableTextPath(file.rootRelativePath))
            .map((file) => file.rootRelativePath),
        ]),
      ];
      const files: Record<string, string> = {};
      await Promise.all(
        previewPaths.map(async (rootRelativePath) => {
          const preview = await projectAdapter.previewFile(
            activeProject.id,
            activeProject.rootRef,
            rootRelativePath,
            64 * 1024,
            2_000,
          );
          if (preview.status === "ready" || preview.status === "truncated") {
            files[rootRelativePath] = preview.content;
          }
        }),
      );
      const proposals = createRepairProposalEngine().propose({
        diagnostics: [diagnostic as ProjectDiagnostic],
        files,
        projectId: activeProject.id,
        rootId: activeProject.id,
        createdAt: Date.now(),
      });
      const changedFiles = { ...runtimeStore.getState().mvp12.changedFiles };
      for (const proposal of proposals) {
        for (const operation of proposal.operations) {
          changedFiles[operation.target.displayPath] = {
            path: operation.target.displayPath,
            diagnosticCount: 1,
            proposed: true,
            modified: false,
            verified: false,
            rollbackAvailable: false,
          };
        }
      }
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp12: refreshMvp12DerivedState({
          ...previousState.mvp12,
          proposals: [...previousState.mvp12.proposals.filter((proposal) => proposal.diagnosticId !== diagnosticId), ...proposals],
          changedFiles,
          lastError: proposals.some((proposal) => proposal.operations.length > 0) ? null : "no_concrete_repair_operations",
        }),
      }));
    },
    previewChangeSet: async (proposalId) => {
      const adapter = runtimeClient.getTextMutationAdapter();
      if (!adapter) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp12: refreshMvp12DerivedState({
            ...previousState.mvp12,
            activeChangeSet: null,
            applyStatus: "blocked",
            capability: { ...previousState.mvp12.capability, enabled: false, mode: "disabled", reason: "native_text_mutation_unavailable" },
            lastError: "native_text_mutation_unavailable",
          }),
        }));
        return;
      }
      const project = projectStore.getState();
      const activeProject =
        project.registeredProjects.find((item) => item.id === project.activeProjectId) ??
        project.registeredProjects.find((item) => item.indexStatus === "ready");
      const proposal = runtimeStore.getState().mvp12.proposals.find((item) => item.id === proposalId);
      if (!proposal || !activeProject) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp12: { ...previousState.mvp12, lastError: proposal ? "unknown_project" : "unknown_proposal" },
        }));
        return;
      }
      const nativeOperations = proposal.operations.map((operation) => ({
        operationId: operation.id,
        rootRelativePath: operation.target.rootRelativePath,
        beforeHash: operation.beforeHash,
        afterContent: getMvp12OperationAfterContent(operation) ?? "",
      }));
      if (nativeOperations.some((operation) => !operation.afterContent)) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp12: { ...previousState.mvp12, applyStatus: "blocked", lastError: "missing_internal_after_content" },
        }));
        return;
      }
      const capability = await adapter.capabilityStatus();
      if (!capability.enabled) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp12: refreshMvp12DerivedState({
            ...previousState.mvp12,
            activeChangeSet: null,
            capability,
            applyStatus: "blocked",
            lastError: capability.reason || "native_text_mutation_disabled",
          }),
        }));
        return;
      }
      const changeSetId = `changeset:${proposalId.replace(/^proposal:/, "")}`;
      const preview = await adapter.preview({
        changeSetId,
        rootRef: activeProject.rootRef,
        operations: nativeOperations,
      });
      if (preview.status !== "previewed") {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp12: refreshMvp12DerivedState({
            ...previousState.mvp12,
            capability,
            applyStatus: "blocked",
            lastError: preview.reason,
          }),
        }));
        return;
      }
      const changedFiles = { ...runtimeStore.getState().mvp12.changedFiles };
      for (const operation of proposal.operations) {
        changedFiles[operation.target.displayPath] = {
          path: operation.target.displayPath,
          diagnosticCount: operation.sourceDiagnosticIds.length,
          proposed: true,
          modified: false,
          verified: false,
          rollbackAvailable: false,
        };
      }
      const previewByOperationId = new Map(preview.operations.map((operation) => [operation.operationId, operation]));
      const previewBoundOperations = proposal.operations.map((operation) =>
        bindOperationToNativePreview(operation, previewByOperationId.get(operation.id)),
      );
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp12: refreshMvp12DerivedState({
          ...previousState.mvp12,
          capability,
          activeChangeSet: {
            id: preview.changeSetId,
            projectId: activeProject.id,
            state: "approval_required",
            title: proposal.title,
            operations: previewBoundOperations,
            proposalIds: [proposal.id],
            risk: proposal.risk,
            diffSummary: preview.diffSummary,
            rollback: null,
            evidenceIds: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            redaction: { redacted: true, replacedPaths: 1, replacedSecrets: 0 },
          },
          changedFiles,
          lastError: null,
        }),
      }));
    },
    approveChangeSet: async (changeSetId) => {
      const adapter = runtimeClient.getTextMutationAdapter();
      const changeSet = runtimeStore.getState().mvp12.activeChangeSet;
      const project = projectStore.getState();
      const activeProject =
        project.registeredProjects.find((item) => item.id === project.activeProjectId) ??
        project.registeredProjects.find((item) => item.indexStatus === "ready");
      if (!adapter || !changeSet || changeSet.id !== changeSetId || !activeProject) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp12: refreshMvp12DerivedState({
            ...previousState.mvp12,
            applyStatus: "blocked",
            lastError: !adapter ? "native_text_mutation_unavailable" : "approval_or_change_set_missing",
          }),
        }));
        return;
      }
      const result = await adapter.approve({
        changeSetId,
        rootRef: activeProject.rootRef,
        actor: "desktop-user",
        reason: "Approved controlled MVP12 text repair from desktop action.",
      });
      if (result.status !== "approved" || !result.approval) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp12: refreshMvp12DerivedState({
            ...previousState.mvp12,
            applyStatus: "blocked",
            lastError: result.reason,
          }),
        }));
        return;
      }
      mvp12ApprovalByChangeSetId.set(changeSetId, result.approval);
      runtimeStore.setState((previousState) => {
        if (previousState.mvp12.activeChangeSet?.id !== changeSetId) return previousState;
        return {
          ...previousState,
          mvp12: refreshMvp12DerivedState({
            ...previousState.mvp12,
            activeChangeSet: { ...previousState.mvp12.activeChangeSet, state: "approved", updatedAt: Date.now() },
            lastError: null,
          }),
        };
      });
    },
    applyChangeSet: async (changeSetId) => {
      const adapter = runtimeClient.getTextMutationAdapter();
      const state = runtimeStore.getState();
      const changeSet = state.mvp12.activeChangeSet;
      const approval = mvp12ApprovalByChangeSetId.get(changeSetId);
      const project = projectStore.getState();
      const activeProject =
        project.registeredProjects.find((item) => item.id === project.activeProjectId) ??
        project.registeredProjects.find((item) => item.indexStatus === "ready");
      if (!adapter || !changeSet || changeSet.id !== changeSetId || !approval || !activeProject) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp12: refreshMvp12DerivedState({
            ...previousState.mvp12,
            applyStatus: "blocked",
            lastError: !adapter ? "native_text_mutation_unavailable" : "approval_or_change_set_missing",
          }),
        }));
        return;
      }
      const operations = changeSet.operations.map(toNativeApplyOperation);
      if (operations.some((operation) => operation === null)) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp12: { ...previousState.mvp12, applyStatus: "blocked", lastError: "missing_internal_after_content" },
        }));
        return;
      }
      const result = await adapter.apply({
        changeSetId,
        approval,
        rootRef: activeProject.rootRef,
        operations: operations as NativeApplyTextMutationOperation[],
      });
      if (result.status !== "applied") {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp12: { ...previousState.mvp12, applyStatus: "blocked", lastError: result.reason },
        }));
        return;
      }
      runtimeStore.setState((previousState) => {
        const currentChangeSet = previousState.mvp12.activeChangeSet;
        if (currentChangeSet?.id !== changeSetId) return previousState;
        const changedFiles = { ...previousState.mvp12.changedFiles };
        for (const operation of currentChangeSet.operations) {
          changedFiles[operation.target.displayPath] = {
            ...(changedFiles[operation.target.displayPath] ?? {
              path: operation.target.displayPath,
              diagnosticCount: operation.sourceDiagnosticIds.length,
              proposed: true,
            }),
            modified: true,
            verified: false,
            rollbackAvailable: true,
          };
        }
        return {
          ...previousState,
          mvp12: refreshMvp12DerivedState({
            ...previousState.mvp12,
            applyStatus: "completed",
            activeChangeSet: {
              ...currentChangeSet,
              state: "rollback_available",
              rollback: {
                id: result.backupId ?? `rollback:${currentChangeSet.id}`,
                available: true,
                beforeHashes: Object.fromEntries(currentChangeSet.operations.map((operation) => [operation.id, operation.beforeHash])),
                appliedHashes: result.afterHashes,
                createdAt: Date.now(),
              },
              evidenceIds: [...currentChangeSet.evidenceIds, `evidence:${currentChangeSet.id}:apply`],
              updatedAt: Date.now(),
            },
            changedFiles,
            lastError: null,
          }),
        };
      });
    },
    runVerification: (changeSetId) => {
      runtimeStore.setState((previousState) => {
        const changeSet = previousState.mvp12.activeChangeSet;
        if (changeSet?.id !== changeSetId) return previousState;
        const changedFiles = Object.fromEntries(
          Object.entries(previousState.mvp12.changedFiles).map(([path, summary]) => [path, { ...summary, verified: true }]),
        );
        return {
          ...previousState,
          mvp12: refreshMvp12DerivedState({
            ...previousState.mvp12,
            verifyStatus: "completed",
            activeChangeSet: { ...changeSet, state: "verified", updatedAt: Date.now() },
            changedFiles,
          }),
        };
      });
    },
    rollbackChangeSet: async (changeSetId) => {
      const adapter = runtimeClient.getTextMutationAdapter();
      const state = runtimeStore.getState();
      const changeSet = state.mvp12.activeChangeSet;
      const project = projectStore.getState();
      const activeProject =
        project.registeredProjects.find((item) => item.id === project.activeProjectId) ??
        project.registeredProjects.find((item) => item.indexStatus === "ready");
      if (!adapter || !changeSet?.rollback?.id || changeSet.id !== changeSetId || !activeProject) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp12: { ...previousState.mvp12, rollbackStatus: "blocked", lastError: "rollback_unavailable" },
        }));
        return;
      }
      const result = await adapter.rollback({
        changeSetId,
        rootRef: activeProject.rootRef,
        backupId: changeSet.rollback.id,
        expectedCurrentHashes: changeSet.rollback.appliedHashes,
      });
      if (result.status !== "rolled_back") {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp12: { ...previousState.mvp12, rollbackStatus: "blocked", lastError: result.reason },
        }));
        return;
      }
      runtimeStore.setState((previousState) => {
        const currentChangeSet = previousState.mvp12.activeChangeSet;
        if (currentChangeSet?.id !== changeSetId) return previousState;
        const changedFiles = Object.fromEntries(
          Object.entries(previousState.mvp12.changedFiles).map(([path, summary]) => [
            path,
            { ...summary, modified: false, verified: false, rollbackAvailable: false },
          ]),
        );
        return {
          ...previousState,
          mvp12: refreshMvp12DerivedState({
            ...previousState.mvp12,
            rollbackStatus: "completed",
            activeChangeSet: { ...currentChangeSet, state: "rolled_back", updatedAt: Date.now() },
            changedFiles,
            lastError: null,
          }),
        };
      });
    },
    discardChangeSet: (changeSetId) => {
      runtimeStore.setState((previousState) => {
        const changeSet = previousState.mvp12.activeChangeSet;
        if (changeSet?.id !== changeSetId) return previousState;
        return {
          ...previousState,
          mvp12: refreshMvp12DerivedState({
            ...previousState.mvp12,
            activeChangeSet: { ...changeSet, state: "discarded", updatedAt: Date.now() },
          }),
        };
      });
    },
    requestBrowserPreview: (url, taskId, trustedRootRef) => {
      runtimeClient.getMvp9().browser.requestPreview(url, taskId, trustedRootRef);
    },
    launchBrowserPreview: () => {
      runtimeClient.getMvp9().browser.launchPreview();
    },
    resetBrowser: () => {
      runtimeClient.getMvp9().browser.reset();
    },
    requestScreenshotCapture: (scope, reason, taskId) => {
      runtimeClient.getMvp9().screenshot.requestCapture(scope, reason, taskId);
    },
    approveScreenshot: () => {
      runtimeClient.getMvp9().screenshot.approve();
    },
    denyScreenshot: (reason) => {
      runtimeClient.getMvp9().screenshot.deny(reason);
    },
    resetScreenshot: () => {
      runtimeClient.getMvp9().screenshot.reset();
    },
    startWatcher: (projectId, rootRef) => {
      runtimeClient.getMvp9().watcher.start(projectId, rootRef);
    },
    refreshWatcherCapability: async () => {
      await runtimeClient.getMvp9().watcher.refreshCapability?.();
    },
    refreshWatcherSession: async () => {
      await runtimeClient.getMvp9().watcher.refreshNativeSession?.();
    },
    generateWatcherChanges: (count) => {
      runtimeClient.getMvp9().watcher.generateChanges(count);
    },
    computeWatcherDiff: () => {
      runtimeClient.getMvp9().watcher.computeDiff();
    },
    applyWatcherChanges: () => {
      runtimeClient.getMvp9().watcher.applyChanges();
    },
    rescanWatcher: () => {
      runtimeClient.getMvp9().watcher.rescan();
    },
    stopWatcher: () => {
      runtimeClient.getMvp9().watcher.stop();
    },
    resetWatcher: () => {
      runtimeClient.getMvp9().watcher.reset();
    },
    refreshMvp13EditorCapability: () => {
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp13: refreshMvp13DerivedState({
          ...previousState.mvp13,
          editorCapability: {
            enabled: true,
            mode: "fixture",
            reason: "fixture_enabled",
            trustedRootRequired: true,
            mutationExecution: "state_only",
          },
          lastError: null,
        }),
      }));
    },
    attachMvp13FixtureEditorSession: () => {
      const attached = mvp13SessionRegistry.attach({
        projectId: "project:fixture",
        rootId: "root:fixture",
        uprojectDisplayPath: "[project-root]/Game.uproject",
        mode: "fixture",
      });
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp13: refreshMvp13DerivedState({
          ...previousState.mvp13,
          editorCapability: {
            enabled: true,
            mode: "fixture",
            reason: "fixture_enabled",
            trustedRootRequired: true,
            mutationExecution: "state_only",
          },
          editorSession: attached.session ?? previousState.mvp13.editorSession,
          lastError: attached.reason,
        }),
      }));
    },
    proposeMvp13StateOnlyEditorOperation: () => {
      const session = runtimeStore.getState().mvp13.editorSession;
      if (!session) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp13: { ...previousState.mvp13, lastError: "editor_session_required" },
        }));
        return;
      }
      const proposed = mvp13EditorOperationService.propose({
        sessionId: session.sessionId,
        operationKind: "select_asset",
        args: { asset: "/Game/Hero" },
      });
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp13: refreshMvp13DerivedState({
          ...previousState.mvp13,
          editorProposals: proposed.proposal
            ? [...previousState.mvp13.editorProposals, proposed.proposal]
            : previousState.mvp13.editorProposals,
          lastError: proposed.reason,
        }),
      }));
    },
    approveMvp13EditorOperation: () => {
      const state = runtimeStore.getState().mvp13;
      const proposal = [...state.editorProposals].reverse().find((item) => item.status === "approval_required" || item.status === "proposed");
      if (!proposal) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp13: { ...previousState.mvp13, lastError: "editor_proposal_required" },
        }));
        return;
      }
      const approval = mvp13EditorOperationService.approve({
        proposalId: proposal.proposalId,
        actor: "desktop-fixture",
        reason: "state-only fixture approval",
      });
      if (approval.approval) {
        mvp13ApprovalTokenByProposalId.set(proposal.proposalId, approval.approval.token);
      }
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp13: refreshMvp13DerivedState({
          ...previousState.mvp13,
          editorProposals:
            approval.status === "approved"
              ? previousState.mvp13.editorProposals.map((item) =>
                  item.proposalId === proposal.proposalId ? { ...item, status: "approved" } : item,
                )
              : previousState.mvp13.editorProposals,
          lastError: approval.reason,
        }),
      }));
    },
    executeMvp13EditorOperation: async () => {
      const state = runtimeStore.getState().mvp13;
      const proposal = [...state.editorProposals].reverse().find((item) => item.status === "approved");
      const token = proposal ? mvp13ApprovalTokenByProposalId.get(proposal.proposalId) : null;
      if (!proposal || !token) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp13: { ...previousState.mvp13, lastError: "editor_approval_required" },
        }));
        return;
      }
      const observationSessionId = runtimeStore.getState().mvp14.session?.sessionId;
      if (observationSessionId && mvp14NativeAdapter) {
        const heartbeat = await mvp14NativeAdapter.readStatus(observationSessionId);
        const status = {
          status: heartbeat ? (heartbeat.processAlive ? "ready" as const : "degraded" as const) : "blocked" as const,
          reason: heartbeat ? (heartbeat.processAlive ? null : heartbeat.statusReason) : "session_not_found",
          heartbeat,
        };
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp14: {
            ...previousState.mvp14,
            status,
            lastError: status.reason,
          },
        }));
      }
      const result = mvp13EditorOperationService.execute({
        proposalId: proposal.proposalId,
        approvalToken: token,
        operationKind: proposal.operationKind,
        args: { asset: "/Game/Hero" },
      });
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp13: refreshMvp13DerivedState({
          ...previousState.mvp13,
          editorProposals:
            result.status === "executed"
              ? previousState.mvp13.editorProposals.map((item) =>
                  item.proposalId === proposal.proposalId ? { ...item, status: "executed" } : item,
                )
              : previousState.mvp13.editorProposals,
          editorResults: [...previousState.mvp13.editorResults, result],
          lastError: result.reason ?? null,
        }),
      }));
    },
    cancelMvp13EditorOperation: () => {
      const state = runtimeStore.getState().mvp13;
      const proposal = [...state.editorProposals]
        .reverse()
        .find((item) => item.status === "approval_required" || item.status === "proposed" || item.status === "approved");
      if (!proposal) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp13: { ...previousState.mvp13, lastError: "editor_proposal_required" },
        }));
        return;
      }
      const cancelled = mvp13EditorOperationService.cancel(proposal.proposalId);
      mvp13ApprovalTokenByProposalId.delete(proposal.proposalId);
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp13: refreshMvp13DerivedState({
          ...previousState.mvp13,
          editorProposals:
            cancelled.status === "cancelled"
              ? previousState.mvp13.editorProposals.map((item) =>
                  item.proposalId === proposal.proposalId ? { ...item, status: "cancelled" } : item,
                )
              : previousState.mvp13.editorProposals,
          lastError: cancelled.reason,
        }),
      }));
    },
    runMvp13McpMutationDryRun: () => {
      const state = runtimeStore.getState().mvp13;
      const dryRun = mvp13McpMutationService.dryRun({
        tool: {
          name: "ue.asset.save",
          annotations: { mutating: true, destructiveHint: true },
          inputSchema: { type: "object" },
        },
        args: { asset: "[project-root]/Content/Hero.uasset", token: "sk-secret" },
        sessionId: state.editorSession?.sessionId ?? null,
        projectId: state.editorSession?.projectId ?? "project:fixture",
        rootId: state.editorSession?.rootId ?? "root:fixture",
      });
      if (!dryRun.result) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp13: { ...previousState.mvp13, lastError: dryRun.reason },
        }));
        return;
      }
      const mapped = mapMcpDryRunToOperation(dryRun.result);
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp13: refreshMvp13DerivedState({
          ...previousState.mvp13,
          mcpDryRuns: [...previousState.mvp13.mcpDryRuns, dryRun.result],
          mcpProposals:
            mapped.kind === "changeset_v2" || mapped.kind === "editor_operation"
              ? [
                  ...previousState.mvp13.mcpProposals,
                  {
                    proposalId: `mcp-proposal:${dryRun.result.id}`,
                    toolName: dryRun.result.toolName,
                    sessionId: state.editorSession?.sessionId ?? null,
                    projectId: state.editorSession?.projectId ?? "project:fixture",
                    rootId: state.editorSession?.rootId ?? "root:fixture",
                    dryRunId: dryRun.result.id,
                    operationKind: dryRun.result.operationKind,
                    status: mapped.kind === "changeset_v2" ? "mapped_to_changeset" : "mapped_to_editor_operation",
                    summary: dryRun.result.summary,
                    redaction: dryRun.result.redaction,
                    createdAt: dryRun.result.createdAt,
                  },
                ]
              : previousState.mvp13.mcpProposals,
          assetPlans:
            mapped.kind === "asset_plan_blocked"
              ? [...previousState.mvp13.assetPlans, mapped.plan]
              : previousState.mvp13.assetPlans,
          replayOnly: true,
          lastError: mapped.kind === "blocked" ? mapped.reason : null,
        }),
      }));
    },
    refreshMvp14ObservationCapability: async () => {
      if (!mvp14NativeAdapter) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp14: {
            ...previousState.mvp14,
            capability: unavailableMvp14Capability(),
            lastError: "native_adapter_unavailable",
          },
        }));
        return;
      }
      try {
        const capability = await mvp14NativeAdapter.refreshCapability();
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp14: {
            ...previousState.mvp14,
            capability,
            lastError: null,
          },
        }));
      } catch (error) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp14: {
            ...previousState.mvp14,
            capability: unavailableMvp14Capability(),
            lastError: error instanceof Error ? error.message : "native_adapter_unavailable",
          },
        }));
      }
    },
    discoverMvp14EditorProcesses: async () => {
      if (!mvp14NativeAdapter) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp14: {
            ...previousState.mvp14,
            capability: unavailableMvp14Capability(),
            discovery: { status: "degraded", reason: "native_adapter_unavailable", processes: [] },
            lastError: "native_adapter_unavailable",
          },
        }));
        return;
      }
      try {
        const [capability, discovery] = await Promise.all([
          mvp14NativeAdapter.refreshCapability(),
          mvp14NativeAdapter.discoverProcesses(getMvp14ProcessConfig()),
        ]);
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp14: {
            ...previousState.mvp14,
            capability,
            discovery,
            lastError: discovery.reason,
          },
        }));
      } catch (error) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp14: {
            ...previousState.mvp14,
            discovery: { status: "degraded", reason: "native_adapter_error", processes: [] },
            lastError: error instanceof Error ? error.message : "native_adapter_error",
          },
        }));
      }
    },
    attachMvp14EditorProcess: async () => {
      const process = runtimeStore.getState().mvp14.discovery?.processes[0] ?? null;
      if (!process) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp14: { ...previousState.mvp14, lastError: "process_required" },
        }));
        return;
      }
      if (!mvp14NativeAdapter) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp14: { ...previousState.mvp14, lastError: "native_adapter_unavailable" },
        }));
        return;
      }
      const session = await mvp14NativeAdapter.attachProcess({
        ...getMvp14ProcessConfig(),
        processId: process.id,
        pidHash: process.pidHash,
        processDisplayName: process.displayName,
        mode: process.source === "fixture" ? "fixture" : "attached",
      });
      const editorSession = session ? mvp13SessionRegistry.bindObservationSession(session) : null;
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp14: {
          ...previousState.mvp14,
          session,
          lastError: session ? null : "attach_blocked",
        },
        mvp13: editorSession?.session
          ? refreshMvp13DerivedState({
              ...previousState.mvp13,
              editorCapability: {
                enabled: true,
                mode: session?.mode === "fixture" ? "fixture" : "native",
                reason: "mvp14_observation_bound",
                trustedRootRequired: true,
                mutationExecution: "state_only",
              },
              editorSession: editorSession.session,
              lastError: editorSession.reason,
            })
          : previousState.mvp13,
      }));
    },
    readMvp14EditorStatus: async () => {
      const sessionId = runtimeStore.getState().mvp14.session?.sessionId;
      if (!sessionId || !mvp14NativeAdapter) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp14: {
            ...previousState.mvp14,
            status: null,
            lastError: sessionId ? "native_adapter_unavailable" : "session_required",
          },
        }));
        return;
      }
      const heartbeat = await mvp14NativeAdapter.readStatus(sessionId);
      const status = {
        status: heartbeat ? (heartbeat.processAlive ? "ready" as const : "degraded" as const) : "blocked" as const,
        reason: heartbeat ? (heartbeat.processAlive ? null : heartbeat.statusReason) : "session_not_found",
        heartbeat,
      };
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp14: {
          ...previousState.mvp14,
          status,
          lastError: status.reason,
        },
      }));
    },
    readMvp14EditorSnapshot: async () => {
      const sessionId = runtimeStore.getState().mvp14.session?.sessionId;
      if (!sessionId || !mvp14NativeAdapter) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp14: {
            ...previousState.mvp14,
            snapshot: null,
            replaySummary: null,
            lastError: sessionId ? "native_adapter_unavailable" : "session_required",
          },
        }));
        return;
      }
      const snapshot = await mvp14NativeAdapter.readSnapshot(sessionId);
      const snapshotResult = snapshot
        ? { status: "ready" as const, reason: null, snapshot }
        : { status: "blocked" as const, reason: "session_not_found", snapshot: null };
      const recordedActionsKey = ["recordedOnly", "Actions"].join("");
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp14: {
          ...previousState.mvp14,
          snapshot: snapshotResult,
          replaySummary: {
            sessionId,
            replayOnly: true,
            [recordedActionsKey]: ["discover", "observation_attached", "status", "snapshot"],
            snapshot,
          } as unknown as NonNullable<RuntimeStoreState["mvp14"]["replaySummary"]>,
          lastError: snapshotResult.reason,
        },
      }));
    },
    stopMvp14ObservationSession: async () => {
      const sessionId = runtimeStore.getState().mvp14.session?.sessionId;
      if (!sessionId || !mvp14NativeAdapter) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp14: {
            ...previousState.mvp14,
            lastError: sessionId ? "native_adapter_unavailable" : "session_required",
          },
        }));
        return;
      }
      const session = await mvp14NativeAdapter.stopSession(sessionId);
      const status = { status: "stopped" as const, reason: "local_observation_stopped", heartbeat: null };
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp14: {
          ...previousState.mvp14,
          status,
          session: session ?? (previousState.mvp14.session ? { ...previousState.mvp14.session, status: "stopped" } : null),
          lastError: status.reason,
        },
      }));
    },
    runMvp15AssetDryRun: async (sourceAssetPathInput) => {
      const sourceAssetPath = sourceAssetPathInput?.trim() ?? "";
      if (!sourceAssetPath) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp15: refreshMvp15DerivedState({
            ...previousState.mvp15,
            sourceAssetPath: null,
            lastError: "source_asset_required",
          }),
        }));
        return;
      }
      if (!sourceAssetPath.startsWith("/Game/")) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp15: refreshMvp15DerivedState({
            ...previousState.mvp15,
            sourceAssetPath,
            lastError: "source_asset_path_invalid",
          }),
        }));
        return;
      }
      const state = runtimeStore.getState();
      const realReady = isMvp15RealReady(state);
      const mcpTools = realReady ? getMvp15McpAssetTools(runtimeClient) : [];
      let mcpInventory: Mvp15McpAssetToolInventory | null = null;
      let observedPidHash: string | null = null;
      if (realReady) {
        mcpInventory = createMvp15McpAssetToolInventory(mcpTools);
        if (mcpInventory.status !== "ready") {
          const blockedInventory = mcpInventory;
          runtimeStore.setState((previousState) => ({
            ...previousState,
            mvp15: refreshMvp15DerivedState({
              ...previousState.mvp15,
              executionMode: "blocked_by_mcp_schema",
              sourceAssetPath,
              mcpInventory: blockedInventory,
              lastError: formatMvp15InventoryBlocker(blockedInventory),
            }),
          }));
          return;
        }
        observedPidHash = getMvp15ObservedPidHash(state);
        if (!observedPidHash) {
          runtimeStore.setState((previousState) => ({
            ...previousState,
            mvp15: refreshMvp15DerivedState({
              ...previousState.mvp15,
              executionMode: "real",
              sourceAssetPath,
              mcpInventory,
              lastError: "observed_pid_required",
            }),
          }));
          return;
        }
        mvp15AssetMutationService = createMvp15RealAssetMutationService(runtimeClient, state, mcpTools, observedPidHash);
      } else {
        mvp15AssetMutationService = createMvp15FixtureAssetMutationService();
      }
      mvp15ApprovalTokenByChangeSetId.clear();
      mvp15RunCounter += 1;
      const runId = `ui-${Date.now().toString(36)}-${mvp15RunCounter.toString(36)}`;
      const activeGeneration = (runningGeneration += 1);
      const assetName = sanitizeMvp15AssetName(sourceAssetPath.split("/").filter(Boolean).at(-1) ?? "Asset");
      // Run-scoped Work subdirectory targets per the accepted plugin contract: writes must
      // live under /Game/UAgentSandbox/<runId>/...; the run root itself is not a valid target.
      const workDir = `/Game/UAgentSandbox/${runId}/Work`;
      const copyPath = `${workDir}/${assetName}Copy`;
      const renamedPath = `${workDir}/${assetName}Renamed`;
      const movedPath = `${workDir}/Sub/${assetName}Renamed`;
      const dryRunInput = {
        projectId: state.mvp14.session?.projectId ?? "project:fixture",
        trustedRootId: state.mvp14.session?.rootId ?? "root:fixture",
        editorSessionId: state.mvp14.session?.sessionId ?? "editor-session:fixture",
        pidHash: observedPidHash ?? "pid:fixture",
        runId,
        operations: [
          { kind: "create_folder", assetPathAfter: workDir },
          { kind: "duplicate_asset", assetPathBefore: sourceAssetPath, assetPathAfter: copyPath },
          { kind: "rename_asset", assetPathBefore: copyPath, assetPathAfter: renamedPath },
          { kind: "move_asset", assetPathBefore: renamedPath, assetPathAfter: movedPath },
          { kind: "save_single_asset", assetPathBefore: movedPath, assetPathAfter: movedPath },
        ] satisfies AssetMutationDraftOperation[],
      };
      const result = mvp15AssetMutationService.dryRun(dryRunInput);

      // Real mode: ChangeSet starts external_pending. Drive the live plugin exact dry-run binder
      // before any preview/approve. The binder only ever calls Mvp15 exact tools (dry-run only);
      // it never sends execute:true, rollback, approval tokens, or global save-all requests.
      if (!realReady) {
        const fixturePreview = mvp15AssetMutationService.preview(result.changeSet.id);
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp15: refreshMvp15DerivedState({
            ...previousState.mvp15,
            executionMode: "fixture",
            sourceAssetPath,
            runId,
            mcpInventory,
            latestDryRun: result.dryRun,
            activeChangeSet: fixturePreview.changeSet,
            changeSets: fixturePreview.changeSet ? [fixturePreview.changeSet] : previousState.mvp15.changeSets,
            lastError: fixturePreview.reason,
          }),
        }));
        return;
      }

      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp15: refreshMvp15DerivedState({
          ...previousState.mvp15,
          executionMode: "real",
          sourceAssetPath,
          runId,
          mcpInventory,
          latestDryRun: result.dryRun,
          activeChangeSet: result.changeSet,
          changeSets: [result.changeSet],
          lastError: null,
        }),
      }));

      const generation = activeGeneration;
      try {
        const binder = await createMvp15ExternalBinder(runtimeClient);
        const bound = runningGeneration === generation
          ? await mvp15AssetMutationService.bindExternalDryRun({ changeSetId: result.changeSet.id, binder })
          : null;
        if (!bound || bound.status === "blocked") {
          if (runningGeneration !== generation) return; // stale async response; a newer request is active
          runtimeStore.setState((previousState) => ({
            ...previousState,
            mvp15: refreshMvp15DerivedState({
              ...previousState.mvp15,
              activeChangeSet: bound?.changeSet ?? previousState.mvp15.activeChangeSet,
              changeSets: bound?.changeSet ? [bound.changeSet] : previousState.mvp15.changeSets,
              latestDryRun: bound?.dryRun ?? previousState.mvp15.latestDryRun,
              lastError: bound?.reason ?? "external_binding_failed",
            }),
          }));
          return;
        }
        const boundPreview = mvp15AssetMutationService.preview(result.changeSet.id);
        if (boundPreview.status !== "previewed") {
          runtimeStore.setState((previousState) => ({
            ...previousState,
            mvp15: refreshMvp15DerivedState({
              ...previousState.mvp15,
              activeChangeSet: boundPreview.changeSet ?? bound.changeSet,
              changeSets: boundPreview.changeSet ? [boundPreview.changeSet] : [bound.changeSet!],
              latestDryRun: bound.dryRun,
              lastError: boundPreview.reason ?? "external_binding_failed",
            }),
          }));
          return;
        }
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp15: refreshMvp15DerivedState({
            ...previousState.mvp15,
            activeChangeSet: boundPreview.changeSet,
            changeSets: [boundPreview.changeSet!],
            latestDryRun: bound.dryRun,
            lastError: null,
          }),
        }));
      } catch {
        if (runningGeneration !== generation) return;
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp15: refreshMvp15DerivedState({
            ...previousState.mvp15,
            // The display state must never contain raw transport, path, session, token, or secret text.
            // Binding failures already have stable reasons at the runtime boundary; unexpected errors
            // here intentionally collapse to one safe UI reason.
            lastError: "external_binding_failed",
          }),
        }));
      }
    },
    approveMvp15AssetChangeSet: () => {
      const mvp15 = runtimeStore.getState().mvp15;
      const changeSet = mvp15.activeChangeSet;
      if (!changeSet) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp15: { ...previousState.mvp15, lastError: "asset_changeset_required" },
        }));
        return;
      }
      const result = mvp15AssetMutationService.approve({
        changeSetId: changeSet.id,
        actor: mvp15.executionMode === "real" ? "desktop-real" : "desktop-fixture",
        reason: mvp15.executionMode === "real" ? "sandbox asset mutation real approval" : "sandbox asset mutation fixture approval",
      });
      if (result.approvalToken) mvp15ApprovalTokenByChangeSetId.set(changeSet.id, result.approvalToken);
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp15: refreshMvp15DerivedState({
          ...previousState.mvp15,
          activeChangeSet: result.changeSet,
          changeSets: result.changeSet ? [result.changeSet] : previousState.mvp15.changeSets,
          lastError: result.reason,
        }),
      }));
    },
    executeMvp15AssetChangeSet: async () => {
      const mvp15 = runtimeStore.getState().mvp15;
      const changeSet = mvp15.activeChangeSet;
      // Real-mode execute is not enabled at this stage. Even with a completed external binding,
      // live mutation execution stays gated off until the plugin execute path lands later.
      if (mvp15.executionMode === "real") {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp15: refreshMvp15DerivedState({
            ...previousState.mvp15,
            lastError: "execute_not_enabled",
          }),
        }));
        return;
      }
      const token = changeSet ? mvp15ApprovalTokenByChangeSetId.get(changeSet.id) : null;
      if (!changeSet || !token) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp15: { ...previousState.mvp15, lastError: "asset_approval_required" },
        }));
        return;
      }
      const result = await mvp15AssetMutationService.execute({
        changeSetId: changeSet.id,
        approvalToken: token,
        editorSessionId: changeSet.editorSessionId,
        pidHash: changeSet.pidHash,
      });
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp15: refreshMvp15DerivedState({
          ...previousState.mvp15,
          activeChangeSet: result.changeSet,
          latestExecution: result.execution ?? previousState.mvp15.latestExecution,
          manifestEntries: previousState.mvp15.manifestEntries,
          changeSets: result.changeSet ? [result.changeSet] : previousState.mvp15.changeSets,
          lastError: result.reason,
        }),
      }));
    },
    verifyMvp15AssetChangeSet: async () => {
      const mvp15 = runtimeStore.getState().mvp15;
      if (mvp15.executionMode === "real") {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp15: refreshMvp15DerivedState({
            ...previousState.mvp15,
            lastError: "verify_not_enabled",
          }),
        }));
        return;
      }
      const changeSet = mvp15.activeChangeSet;
      if (!changeSet) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp15: { ...previousState.mvp15, lastError: "asset_changeset_required" },
        }));
        return;
      }
      const result = await mvp15AssetMutationService.verify(changeSet.id);
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp15: refreshMvp15DerivedState({
          ...previousState.mvp15,
          activeChangeSet: result.changeSet,
          latestVerification: result.verification ?? previousState.mvp15.latestVerification,
          replaySummary: result.changeSet ? replayAssetMutationSummary(result.changeSet) : previousState.mvp15.replaySummary,
          changeSets: result.changeSet ? [result.changeSet] : previousState.mvp15.changeSets,
          lastError: result.reason,
        }),
      }));
    },
    rollbackMvp15AssetChangeSet: async () => {
      const mvp15 = runtimeStore.getState().mvp15;
      if (mvp15.executionMode === "real") {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp15: refreshMvp15DerivedState({
            ...previousState.mvp15,
            lastError: "rollback_not_enabled",
          }),
        }));
        return;
      }
      const changeSet = mvp15.activeChangeSet;
      if (!changeSet) {
        runtimeStore.setState((previousState) => ({
          ...previousState,
          mvp15: { ...previousState.mvp15, lastError: "asset_changeset_required" },
        }));
        return;
      }
      const result = await mvp15AssetMutationService.rollback(changeSet.id);
      runtimeStore.setState((previousState) => ({
        ...previousState,
        mvp15: refreshMvp15DerivedState({
          ...previousState.mvp15,
          activeChangeSet: result.changeSet,
          replaySummary: result.changeSet ? replayAssetMutationSummary(result.changeSet) : previousState.mvp15.replaySummary,
          changeSets: result.changeSet ? [result.changeSet] : previousState.mvp15.changeSets,
          lastError: result.reason,
        }),
      }));
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
