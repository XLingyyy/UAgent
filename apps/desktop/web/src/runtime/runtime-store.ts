import { createMockRuntime, type MockRuntimeClient } from "@uagent/runtime";
import type { McpConnectionState, RuntimeSnapshot, TaskDraft } from "@uagent/shared";

export interface RuntimeStoreState extends RuntimeSnapshot {
  mockOnlyWarning: string | null;
  mcp: McpConnectionState;
}

export interface RuntimeStoreActions {
  submitComposerTask: (draft: TaskDraft) => Promise<string>;
  cancelRuntimeTask: (taskId: string) => Promise<void>;
  setMcpEndpoint: (endpoint: string) => void;
  connectMcp: () => Promise<void>;
  discoverMcp: () => Promise<void>;
  disconnectMcp: () => void;
}

export const DESKTOP_MOCK_RUNTIME_FLUSH_DELAY_MS = 500;

export function createRuntimeStoreState(snapshot: RuntimeSnapshot): RuntimeStoreState {
  return {
    ...snapshot,
    mockOnlyWarning: null,
    mcp: {
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
    },
  };
}

export function createDesktopMockRuntimeClient(): MockRuntimeClient {
  return createMockRuntime({ clockStart: 1_000, autoFlush: false });
}

export function getRuntimeTaskIds(state: RuntimeStoreState): string[] {
  return Object.keys(state.tasksById).sort(
    (left, right) => state.tasksById[right].updatedAt - state.tasksById[left].updatedAt,
  );
}
