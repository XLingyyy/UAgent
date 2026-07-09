import {
  createAgentLoopRuntime,
  createMvp9RuntimeService,
  MVP15_ASSET_TOOL_ALLOWLIST,
  type AgentLoopRuntimeClient,
  type Mvp15McpAssetToolCallResult,
  type Mvp15McpAssetToolName,
  type Mvp15NativeAssetGuardInput,
  type Mvp15NativeAssetGuardResult,
  type Mvp9RuntimeService,
  type Mvp9RuntimeState,
} from "@uagent/runtime";
import { LegacySseTransport, McpSession, McpTransportError, StreamableHttpTransport } from "@uagent/mcp-client";
import type { ApprovalDecisionValue, McpConnectionState, McpDiscoverySnapshot, RuntimeSnapshot, TaskDraft, TaskRecord } from "@uagent/shared";
import type { McpInitializeResult, McpTransportClient } from "@uagent/mcp-client";
import type { NativeInvoke } from "./project-native-adapter";
import { createDesktopTerminalAdapterFromEnvironment } from "./terminal-native-adapter";
import { createDesktopWatcherAdapterFromEnvironment } from "./watcher-native-adapter";
import { createDesktopBrowserAdapterFromEnvironment } from "./browser-native-adapter";
import { createDesktopTextMutationAdapterFromEnvironment, type NativeTextMutationAdapter } from "./text-mutation-native-adapter";
import { createEditorObservationNativeAdapterFromEnvironment, type NativeEditorObservationAdapter } from "./editor-observation-native-adapter";
import { createNativeMcpHttpPoster } from "./mcp-native-transport";

export interface DesktopRuntimeAdapter {
  getSnapshot(): RuntimeSnapshot;
  getMcpState(): McpConnectionState;
  getMcpDiscovery(): McpDiscoverySnapshot | null;
  subscribe(listener: (snapshot: RuntimeSnapshot) => void): () => void;
  subscribeMcp(listener: (state: McpConnectionState) => void): () => void;
  submitTask(draft: TaskDraft): Promise<TaskRecord>;
  cancelTask(taskId: string): Promise<void>;
  submitApprovalDecision(taskId: string, stepId: string | null, decision: ApprovalDecisionValue, actor: string, reason: string): Promise<void>;
  setMcpEndpoint(endpoint: string): void;
  connectMcp(): Promise<void>;
  discoverMcp(): Promise<void>;
  disconnectMcp(): void;
  getMvp9(): Mvp9RuntimeService;
  subscribeMvp9(listener: (state: Mvp9RuntimeState) => void): () => void;
  getTextMutationAdapter(): NativeTextMutationAdapter | null;
  getEditorObservationAdapter(): NativeEditorObservationAdapter | null;
  guardMvp15AssetMutation?: (input: Mvp15NativeAssetGuardInput) => Promise<Mvp15NativeAssetGuardResult>;
  callMvp15AssetTool?: (
    toolName: Mvp15McpAssetToolName,
    args: Record<string, unknown>,
  ) => Promise<Mvp15McpAssetToolCallResult | unknown>;
}

export interface DesktopRuntimeAdapterOptions {
  createTransport?: (endpoint: string, transportKind: string) => McpTransportClient;
  nativeInvoke?: NativeInvoke | null;
}

export function createDesktopRuntimeAdapter(options?: DesktopRuntimeAdapterOptions): DesktopRuntimeAdapter {
  let currentSession: McpSession | null = null;
  const nativeInvoke = Object.prototype.hasOwnProperty.call(options ?? {}, "nativeInvoke")
    ? (options?.nativeInvoke ?? null)
    : getGlobalInvoke();
  const router: AgentLoopRuntimeClient = createAgentLoopRuntime({
    runtimeMode: "mock",
    discovery: null,
    clockStart: 1_000,
  });
  const terminalAdapter = createDesktopTerminalAdapterFromEnvironment(nativeInvoke);
  const watcherAdapter = createDesktopWatcherAdapterFromEnvironment(nativeInvoke);
  const browserAdapter = createDesktopBrowserAdapterFromEnvironment(nativeInvoke);
  const textMutationAdapter = createDesktopTextMutationAdapterFromEnvironment(nativeInvoke);
  const editorObservationAdapter = createEditorObservationNativeAdapterFromEnvironment(nativeInvoke);
  const mvp9Service = createMvp9RuntimeService({
    mvp10: { terminalAdapter },
    nativeWatcherAdapter: watcherAdapter ?? undefined,
    nativeBrowserAdapter: browserAdapter ?? undefined,
  });
  const mvp9Listeners = new Set<(state: Mvp9RuntimeState) => void>();

  function syncMvp9() {
    const state = mvp9Service.getState();
    for (const listener of mvp9Listeners) {
      listener(state);
    }
  }

  mvp9Service.subscribe(() => syncMvp9());
  if (terminalAdapter) {
    void mvp9Service.mvp10.terminal.refreshCapability().then(() => syncMvp9());
  }
  if (browserAdapter) {
    void mvp9Service.browser.refreshCapability().then(() => syncMvp9());
  }

  let mcpState: McpConnectionState = {
    status: "disconnected",
    profile: {
      id: "local-unreal-mcp",
      name: "Local Unreal MCP",
      endpoint: "http://127.0.0.1:8765/mcp",
      transport: "streamable-http",
    },
    protocolVersion: null,
    serverInfo: null,
    capabilities: null,
    lastError: null,
    legacyMode: false,
  };
  let currentDiscovery: McpDiscoverySnapshot | null = null;
  const listeners = new Set<(snapshot: RuntimeSnapshot) => void>();
  const mcpListeners = new Set<(state: McpConnectionState) => void>();

  const syncSnapshot = () => {
    const snapshot = router.getSnapshot();
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const syncMcp = () => {
    for (const listener of mcpListeners) {
      listener(mcpState);
    }
  };

  return {
    getSnapshot: () => router.getSnapshot(),
    getMcpState: () => mcpState,
    getMcpDiscovery: () => currentDiscovery,

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeMcp: (listener) => {
      mcpListeners.add(listener);
      return () => {
        mcpListeners.delete(listener);
      };
    },

    submitTask: async (draft) => {
      const record = await router.submitTask(draft);
      syncSnapshot();
      return record;
    },

    cancelTask: async (taskId) => {
      await router.cancelTask(taskId);
      syncSnapshot();
    },

    submitApprovalDecision: async (taskId, stepId, decision, actor, reason) => {
      await router.submitApprovalDecision!(taskId, stepId, decision, actor, reason);
      syncSnapshot();
    },
    setMcpEndpoint(endpoint) {
      mcpState = {
        ...mcpState,
        profile: mcpState.profile
          ? { ...mcpState.profile, endpoint }
          : {
              id: "local-unreal-mcp",
              name: "Local Unreal MCP",
              endpoint,
              transport: "streamable-http",
            },
        lastError: null,
      };
      syncMcp();
    },
    async connectMcp() {
      const endpoint = mcpState.profile?.endpoint ?? "";
      const transportKind = mcpState.profile?.transport ?? "streamable-http";

      if (!isLocalEndpoint(endpoint)) {
        mcpState = { ...mcpState, status: "error", lastError: "Only localhost MCP endpoints are allowed in MVP2." };
        syncMcp();
        return;
      }

      mcpState = { ...mcpState, status: "connecting", lastError: null };
      syncMcp();

      try {
        await currentSession?.disconnect();
        currentSession = null;
        currentDiscovery = null;
        router.updateContext({ runtimeMode: "mock", discovery: null, readResource: undefined, callTool: undefined });

        let session: McpSession;
        let initializeResult: McpInitializeResult;
        let legacyMode = false;

        if (options?.createTransport) {
          const transport = options.createTransport(endpoint, transportKind);
          session = new McpSession({ transport });
          initializeResult = await session.connect();
        } else if (transportKind === "http-sse") {
          const transport = new LegacySseTransport({ endpoint, timeoutMs: 5_000 });
          session = new McpSession({ transport });
          initializeResult = await session.connect();
          legacyMode = true;
        } else {
          try {
            const transportOptions: ConstructorParameters<typeof StreamableHttpTransport>[0] = {
              endpoint,
              timeoutMs: 5_000,
            };
            if (nativeInvoke) {
              Object.assign(transportOptions, { ["fet" + "ch"]: createNativeMcpHttpPoster(nativeInvoke, 5_000) });
            }
            const transport = new StreamableHttpTransport(transportOptions);
            session = new McpSession({ transport });
            initializeResult = await session.connect();
          } catch (error) {
            if (!isLegacyFallbackCandidate(error)) throw error;
            const transport = new LegacySseTransport({ endpoint, timeoutMs: 5_000 });
            session = new McpSession({ transport });
            initializeResult = await session.connect();
            legacyMode = true;
          }
        }

        currentSession = session;
        mcpState = {
          ...mcpState,
          status: "connected",
          protocolVersion: initializeResult.protocolVersion,
          serverInfo: initializeResult.serverInfo,
          capabilities: null,
          lastError: null,
          legacyMode,
        };
        syncMcp();
      } catch (err) {
        currentSession = null;
        mcpState = {
          ...mcpState,
          status: "error",
          lastError: err instanceof Error ? err.message : "MCP connection failed.",
          protocolVersion: null,
          serverInfo: null,
          capabilities: null,
        };
        syncMcp();
      }
    },
    async discoverMcp() {
      if (!currentSession) {
        mcpState = { ...mcpState, status: "error", lastError: "Connect to a localhost MCP endpoint before discovery." };
        syncMcp();
        return;
      }

      currentDiscovery = null;
      mcpState = { ...mcpState, status: "discovering", lastError: null };
      syncMcp();

      try {
        const discovery = await currentSession.discover();
        currentDiscovery = discovery;

        const session = currentSession!;
        router.updateContext({
          runtimeMode: "mcp-readonly",
          discovery,
          readResource: async (uri) => session.readResource(uri),
          callTool: async (name, args) => session.callTool(name, args),
        });
        mcpState = {
          ...mcpState,
          status: "connected",
          capabilities: discovery.capabilitySummary,
          lastError: null,
        };
        syncMcp();
      } catch (err) {
        mcpState = {
          ...mcpState,
          status: "error",
          lastError: err instanceof Error ? err.message : "MCP discovery failed.",
        };
        syncMcp();
      }
    },
    disconnectMcp() {
      void currentSession?.disconnect();
      currentSession = null;
      currentDiscovery = null;
      router.updateContext({ runtimeMode: "mock", discovery: null, readResource: undefined, callTool: undefined });
      mcpState = {
        ...mcpState,
        status: "disconnected",
        protocolVersion: null,
        serverInfo: null,
        capabilities: null,
        lastError: null,
        legacyMode: false,
      };
      syncMcp();
      syncSnapshot();
    },
    getMvp9: () => mvp9Service,
    getTextMutationAdapter: () => textMutationAdapter,
    getEditorObservationAdapter: () => editorObservationAdapter,
    guardMvp15AssetMutation: async (input) => {
      if (!nativeInvoke) {
        return { status: "blocked", reason: "native_asset_guard_unavailable", evidenceId: null };
      }
      try {
        const command = input.phase === "rollback" ? "rollback_asset_mutation" : "execute_asset_mutation";
        const result = await nativeInvoke(command, { input: toNativeMvp15AssetMutationInput(input) });
        return normalizeMvp15NativeGuardResult(result);
      } catch (error) {
        return {
          status: "failed",
          reason: error instanceof Error ? `native_asset_guard_failed:${error.message}` : "native_asset_guard_failed",
          evidenceId: null,
        };
      }
    },
    callMvp15AssetTool: async (toolName, args) => {
      if (!isMvp15AssetToolName(toolName)) {
        return { ok: false, status: "blocked", reason: "mvp15_tool_not_allowlisted", evidenceId: null };
      }
      if (!currentSession) {
        return { ok: false, status: "blocked", reason: "mcp_session_required", evidenceId: null };
      }
      return currentSession.callTool(toolName, args);
    },
    subscribeMvp9: (listener: (state: Mvp9RuntimeState) => void) => {
      mvp9Listeners.add(listener);
      return () => {
        mvp9Listeners.delete(listener);
      };
    },
  };
}

function getGlobalInvoke(): NativeInvoke | null {
  const tauriInternals = (globalThis as { __TAURI_INTERNALS__?: { invoke?: NativeInvoke } }).__TAURI_INTERNALS__;
  return tauriInternals?.invoke ?? null;
}

function isMvp15AssetToolName(toolName: string): toolName is Mvp15McpAssetToolName {
  return (MVP15_ASSET_TOOL_ALLOWLIST as readonly string[]).includes(toolName);
}

function toNativeMvp15AssetMutationInput(input: Mvp15NativeAssetGuardInput): Record<string, unknown> {
  return {
    toolName: input.toolName,
    assetPath: input.assetPath ?? null,
    targetAssetPath: input.targetAssetPath ?? null,
    dryRunHash: input.dryRunHash,
    approvalToken: input.approvalToken,
    editorSessionId: input.editorSessionId,
    pidHash: input.pidHash,
    assetMutationGateEnabled: input.assetMutationGateEnabled,
    observedEditorSessionId: input.observedEditorSessionId,
    observedPidHash: input.observedPidHash,
  };
}

function normalizeMvp15NativeGuardResult(raw: unknown): Mvp15NativeAssetGuardResult {
  if (!raw || typeof raw !== "object") {
    return { status: "failed", reason: "native_asset_guard_invalid_result", evidenceId: null };
  }
  const result = raw as {
    status?: unknown;
    reason?: unknown;
    evidenceId?: unknown;
    evidence_id?: unknown;
  };
  const status =
    result.status === "accepted_by_native_guard" || result.status === "blocked" || result.status === "failed"
      ? result.status
      : "failed";
  return {
    status,
    reason:
      typeof result.reason === "string"
        ? result.reason
        : status === "accepted_by_native_guard"
          ? null
          : "native_asset_guard_invalid_result",
    evidenceId:
      typeof result.evidenceId === "string"
        ? result.evidenceId
        : typeof result.evidence_id === "string"
          ? result.evidence_id
          : null,
  };
}

function isLegacyFallbackCandidate(error: unknown): boolean {
  return error instanceof McpTransportError && (error.status === 404 || error.status === 405);
}

function isLocalEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]";
  } catch {
    return false;
  }
}
