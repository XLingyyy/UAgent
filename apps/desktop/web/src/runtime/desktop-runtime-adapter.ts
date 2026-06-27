import {
  createAgentLoopRuntime,
  type AgentLoopRuntimeClient,
} from "@uagent/runtime";
import { LegacySseTransport, McpSession, McpTransportError, StreamableHttpTransport } from "@uagent/mcp-client";
import type { ApprovalDecisionValue, McpConnectionState, RuntimeSnapshot, TaskDraft, TaskRecord } from "@uagent/shared";
import type { McpInitializeResult, McpTransportClient } from "@uagent/mcp-client";

export interface DesktopRuntimeAdapter {
  getSnapshot(): RuntimeSnapshot;
  getMcpState(): McpConnectionState;
  subscribe(listener: (snapshot: RuntimeSnapshot) => void): () => void;
  subscribeMcp(listener: (state: McpConnectionState) => void): () => void;
  submitTask(draft: TaskDraft): Promise<TaskRecord>;
  cancelTask(taskId: string): Promise<void>;
  submitApprovalDecision(taskId: string, stepId: string | null, decision: ApprovalDecisionValue, actor: string, reason: string): Promise<void>;
  setMcpEndpoint(endpoint: string): void;
  connectMcp(): Promise<void>;
  discoverMcp(): Promise<void>;
  disconnectMcp(): void;
}

export interface DesktopRuntimeAdapterOptions {
  createTransport?: (endpoint: string, transportKind: string) => McpTransportClient;
}

export function createDesktopRuntimeAdapter(options?: DesktopRuntimeAdapterOptions): DesktopRuntimeAdapter {
  let currentSession: McpSession | null = null;
  const router: AgentLoopRuntimeClient = createAgentLoopRuntime({
    runtimeMode: "mock",
    discovery: null,
    clockStart: 1_000,
  });
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
