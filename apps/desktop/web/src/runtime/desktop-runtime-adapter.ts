import {
  createMcpReadOnlyRuntime,
  createMockRuntime,
  createRuntimeRouter,
  type MockRuntimeClient,
  type McpReadOnlyRuntimeClient,
} from "@uagent/runtime";
import { LegacySseTransport, McpSession, McpTransportError, StreamableHttpTransport } from "@uagent/mcp-client";
import type { McpConnectionState, RuntimeClient, RuntimeSnapshot, TaskDraft, TaskRecord } from "@uagent/shared";
import type { McpInitializeResult, McpTransportClient } from "@uagent/mcp-client";
import { DESKTOP_MOCK_RUNTIME_FLUSH_DELAY_MS } from "./runtime-store";

export interface DesktopRuntimeAdapter {
  getSnapshot(): RuntimeSnapshot;
  getMcpState(): McpConnectionState;
  subscribe(listener: (snapshot: RuntimeSnapshot) => void): () => void;
  subscribeMcp(listener: (state: McpConnectionState) => void): () => void;
  submitTask(draft: TaskDraft): Promise<TaskRecord>;
  cancelTask(taskId: string): Promise<void>;
  setMcpEndpoint(endpoint: string): void;
  connectMcp(): Promise<void>;
  discoverMcp(): Promise<void>;
  disconnectMcp(): void;
}

export interface DesktopRuntimeAdapterOptions {
  createTransport?: (endpoint: string, transportKind: string) => McpTransportClient;
}

export function createDesktopRuntimeAdapter(options?: DesktopRuntimeAdapterOptions): DesktopRuntimeAdapter {
  const client: MockRuntimeClient = createMockRuntime({ clockStart: 1_000, autoFlush: false });
  let mcpRuntime: McpReadOnlyRuntimeClient | null = null;
  let currentSession: McpSession | null = null;
  let router: RuntimeClient = createRuntimeRouter({ mockRuntime: client, mcpRuntime: null });
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
  const pendingFlushes = new Map<string, ReturnType<typeof setTimeout>>();
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

  const clearFlush = (taskId: string) => {
    const pending = pendingFlushes.get(taskId);
    if (pending) {
      clearTimeout(pending);
      pendingFlushes.delete(taskId);
    }
  };

  const scheduleCompletion = (taskId: string) => {
    clearFlush(taskId);
    const timer = setTimeout(() => {
      pendingFlushes.delete(taskId);
      void client.flushAll(taskId).then(syncSnapshot);
    }, DESKTOP_MOCK_RUNTIME_FLUSH_DELAY_MS);
    pendingFlushes.set(taskId, timer);
  };

  return {
    getSnapshot: () => router.getSnapshot(),
    getMcpState: () => mcpState,

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
      if (!mcpRuntime) {
        await client.flushNextEvent(record.id);
        await client.flushNextEvent(record.id);
      }
      syncSnapshot();
      if (!mcpRuntime) {
        scheduleCompletion(record.id);
      }
      return record;
    },

    cancelTask: async (taskId) => {
      clearFlush(taskId);
      await router.cancelTask(taskId);
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
        mcpRuntime = null;

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
            const transport = new StreamableHttpTransport({ endpoint, timeoutMs: 5_000 });
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

      mcpState = { ...mcpState, status: "discovering", lastError: null };
      syncMcp();

      try {
        const discovery = await currentSession.discover();

        const session = currentSession!;
        mcpRuntime = createMcpReadOnlyRuntime({
          discovery,
          readResource: async (uri) => session.readResource(uri),
          callTool: async (name, args) => session.callTool(name, args),
          clockStart: 2_000,
        });
        router = createRuntimeRouter({ mockRuntime: client, mcpRuntime });
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
      mcpRuntime?.disconnect();
      mcpRuntime = null;
      router = createRuntimeRouter({ mockRuntime: client, mcpRuntime: null });
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
