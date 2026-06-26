import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopRuntimeAdapter } from "./desktop-runtime-adapter";
import { DESKTOP_MOCK_RUNTIME_FLUSH_DELAY_MS } from "./runtime-store";
import { LegacySseTransport, McpTransportError, StreamableHttpTransport } from "@uagent/mcp-client";
import type { McpTransportClient } from "@uagent/mcp-client";
import type { TaskDraft } from "@uagent/shared";

vi.mock("@uagent/mcp-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uagent/mcp-client")>();
  return {
    ...actual,
    StreamableHttpTransport: vi.fn(),
    LegacySseTransport: vi.fn(),
  };
});

const baseDraft: TaskDraft = {
  input: "Review Lyra asset loading risks",
  projectId: "lyra",
  permissionMode: "request_approval",
  modelId: "not-configured",
  reasoningEffort: "medium",
  runMode: "local",
  branch: "main",
  contextPercent: 12,
};

const fullDiscoveryFixtures: Record<string, unknown> = {
  initialize: {
    protocolVersion: "2025-06-18",
    serverInfo: { name: "Test MCP Server", version: "1.0.0" },
    capabilities: { tools: {}, resources: {}, prompts: {} },
  },
  "tools/list": {
    tools: [
      { name: "ue.selection.get", description: "Read current editor selection" },
      { name: "ue.asset.delete", description: "Delete an asset" },
      { name: "ue.asset.save", description: "Save an asset" },
    ],
  },
  "resources/list": {
    resources: [{ uri: "ue://selection/current", name: "Current selection", mimeType: "application/json" }],
  },
  "prompts/list": { prompts: [{ name: "summarize-selection", description: "Summarize selected editor objects" }] },
};

function createMockTransport(fixtures: Record<string, unknown>): McpTransportClient {
  return {
    sendRequest: vi.fn(async (request) => {
      const fixture = fixtures[request.method];
      return {
        jsonrpc: "2.0" as const,
        id: request.id,
        result: fixture ?? null,
      };
    }),
    sendNotification: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

function createAdapterWithTransport(fixtures: Record<string, unknown> = fullDiscoveryFixtures) {
  return createDesktopRuntimeAdapter({
    createTransport: () => createMockTransport(fixtures),
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("DesktopRuntimeAdapter", () => {
  it("submit delivers task_submitted and plan_created synchronously", async () => {
    const adapter = createDesktopRuntimeAdapter();
    const record = await adapter.submitTask(baseDraft);
    const snapshot = adapter.getSnapshot();
    const events = snapshot.eventsByTaskId[record.id];

    expect(record.id).toBe("task-0001");
    expect(events.map((e) => e.type)).toEqual([
      "mcp_fallback_to_mock",
      "task_submitted",
      "plan_created",
    ]);
    expect(snapshot.tasksById[record.id].state).toBe("planning");
  });

  it("delayed flush completes the task", async () => {
    vi.useFakeTimers();
    const adapter = createDesktopRuntimeAdapter();
    const record = await adapter.submitTask(baseDraft);

    await vi.advanceTimersByTimeAsync(DESKTOP_MOCK_RUNTIME_FLUSH_DELAY_MS);

    const snapshot = adapter.getSnapshot();
    expect(snapshot.tasksById[record.id].state).toBe("completed");
    const events = snapshot.eventsByTaskId[record.id];
    expect(events.map((e) => e.type)).toEqual([
      "mcp_fallback_to_mock",
      "task_submitted",
      "plan_created",
      "tool_started",
      "tool_completed",
      "evidence_created",
      "review_created",
      "task_completed",
    ]);
  });

  it("cancel before delayed flush stops at cancelled", async () => {
    vi.useFakeTimers();
    const adapter = createDesktopRuntimeAdapter();
    const record = await adapter.submitTask(baseDraft);

    await adapter.cancelTask(record.id);
    await vi.advanceTimersByTimeAsync(DESKTOP_MOCK_RUNTIME_FLUSH_DELAY_MS);

    const snapshot = adapter.getSnapshot();
    const events = snapshot.eventsByTaskId[record.id];
    expect(events.map((e) => e.type)).toEqual([
      "mcp_fallback_to_mock",
      "task_submitted",
      "plan_created",
      "task_cancelled",
    ]);
    expect(snapshot.tasksById[record.id].state).toBe("cancelled");
  });

  it("cancel after completion does not add late cancellation event", async () => {
    vi.useFakeTimers();
    const adapter = createDesktopRuntimeAdapter();
    const record = await adapter.submitTask(baseDraft);

    await vi.advanceTimersByTimeAsync(DESKTOP_MOCK_RUNTIME_FLUSH_DELAY_MS);
    await adapter.cancelTask(record.id);

    const snapshot = adapter.getSnapshot();
    expect(snapshot.tasksById[record.id].state).toBe("completed");
    const cancelEvents = snapshot.eventsByTaskId[record.id].filter(
      (e) => e.type === "task_cancelled",
    );
    expect(cancelEvents).toHaveLength(0);
  });

  it("subscribe delivers snapshot updates", async () => {
    const adapter = createDesktopRuntimeAdapter();
    const listener = vi.fn();
    adapter.subscribe(listener);

    await adapter.submitTask(baseDraft);

    expect(listener).toHaveBeenCalled();
    const calls = listener.mock.calls.map((call) => call[0] as { status: string });
    const lastCall = calls[calls.length - 1];
    expect(lastCall.status).toBe("running");
  });

  it("handles #fail input and ends in error state", async () => {
    vi.useFakeTimers();
    const adapter = createDesktopRuntimeAdapter();
    const failDraft: TaskDraft = { ...baseDraft, input: "Review lighting #fail" };
    const record = await adapter.submitTask(failDraft);

    await vi.advanceTimersByTimeAsync(DESKTOP_MOCK_RUNTIME_FLUSH_DELAY_MS);

    const snapshot = adapter.getSnapshot();
    expect(snapshot.tasksById[record.id].state).toBe("failed");
    expect(snapshot.lastError).toContain("#fail");
  });

  it("unsubscribe stops receiving updates", async () => {
    const adapter = createDesktopRuntimeAdapter();
    const listener = vi.fn();
    const unsub = adapter.subscribe(listener);
    unsub();

    await adapter.submitTask(baseDraft);

    expect(listener).not.toHaveBeenCalled();
  });

  it("connects via transport/session connect and fills serverInfo/protocolVersion from initialize result", async () => {
    const adapter = createAdapterWithTransport();
    await adapter.connectMcp();

    expect(adapter.getMcpState()).toMatchObject({
      status: "connected",
      protocolVersion: "2025-06-18",
      serverInfo: { name: "Test MCP Server", version: "1.0.0" },
    });
    expect(adapter.getMcpState().capabilities).toBeNull();
  });

  it("discover fills capabilities from session/discovery, not a hardcoded constant", async () => {
    const adapter = createAdapterWithTransport();
    await adapter.connectMcp();
    await adapter.discoverMcp();

    expect(adapter.getMcpState()).toMatchObject({
      status: "connected",
      capabilities: {
        tools: 3,
        resources: 1,
        prompts: 1,
      },
    });
  });

  it("submits read-only query through MCP events after full connect+discover cycle", async () => {
    const adapter = createAdapterWithTransport();
    await adapter.connectMcp();
    await adapter.discoverMcp();

    const record = await adapter.submitTask({ ...baseDraft, input: "检查当前选择" });
    const events = adapter.getSnapshot().eventsByTaskId[record.id].map((event) => event.type);

    expect(events).toContain("mcp_discovery_completed");
    expect(events).toContain("mcp_read_completed");
    expect(events).toContain("evidence_created");
    expect(events).toContain("task_completed");
  });

  it("blocked write intent does not call tool and ends in terminal state", async () => {
    const adapter = createAdapterWithTransport();
    await adapter.connectMcp();
    await adapter.discoverMcp();

    const record = await adapter.submitTask({ ...baseDraft, input: "delete current selection" });
    const snapshot = adapter.getSnapshot();
    const events = snapshot.eventsByTaskId[record.id].map((event) => event.type);

    expect(events).toContain("mcp_tool_blocked");
    expect(events).toContain("review_created");
    expect(events).toContain("task_completed");
    expect(snapshot.tasksById[record.id].state).toBe("completed");
  });

  it("blocked tool path does not send tools/call to MCP transport", async () => {
    const sendRequest = vi.fn(async (request: { method: string }) => {
      const fixture = fullDiscoveryFixtures[request.method];
      return { jsonrpc: "2.0" as const, id: 1, result: fixture ?? null };
    });
    const transport: McpTransportClient = {
      sendRequest,
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const adapter = createDesktopRuntimeAdapter({ createTransport: () => transport });
    await adapter.connectMcp();
    await adapter.discoverMcp();

    sendRequest.mockClear();

    await adapter.submitTask({ ...baseDraft, input: "delete current selection" });

    const toolCallCalls = sendRequest.mock.calls.filter(
      (call: unknown[]) => (call[0] as { method: string }).method === "tools/call",
    );
    expect(toolCallCalls).toHaveLength(0);
  });

  it("unknown discovered tool path does not send tools/call to MCP transport and ends in failed terminal state", async () => {
    const unknownToolFixtures: Record<string, unknown> = {
      initialize: fullDiscoveryFixtures.initialize,
      "tools/list": {
        tools: [{ name: "ue.magic", description: "Unknown editor capability" }],
      },
      "resources/list": { resources: [] },
      "prompts/list": { prompts: [] },
    };
    const sendRequest = vi.fn(async (request: { id: string | number | null; method: string }) => {
      const fixture = unknownToolFixtures[request.method];
      return { jsonrpc: "2.0" as const, id: request.id, result: fixture ?? null };
    });
    const transport: McpTransportClient = {
      sendRequest,
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const adapter = createDesktopRuntimeAdapter({ createTransport: () => transport });
    await adapter.connectMcp();
    await adapter.discoverMcp();

    sendRequest.mockClear();

    const record = await adapter.submitTask({ ...baseDraft, input: "use magic tool" });
    const snapshot = adapter.getSnapshot();
    const events = snapshot.eventsByTaskId[record.id].map((event) => event.type);
    const toolCallCalls = sendRequest.mock.calls.filter(
      (call: unknown[]) => (call[0] as { method: string }).method === "tools/call",
    );

    expect(toolCallCalls).toHaveLength(0);
    expect(events.at(-1)).toBe("task_failed");
    expect(snapshot.tasksById[record.id].state).toBe("failed");
  });

  it("blocks non-localhost endpoints and keeps MockRuntime fallback available", async () => {
    const adapter = createDesktopRuntimeAdapter();
    adapter.setMcpEndpoint("https://example.com/mcp");
    await adapter.connectMcp();

    expect(adapter.getMcpState()).toMatchObject({
      status: "error",
      lastError: "Only localhost MCP endpoints are allowed in MVP2.",
    });

    const record = await adapter.submitTask(baseDraft);
    expect(adapter.getSnapshot().eventsByTaskId[record.id].map((event) => event.type)).toContain(
      "mcp_fallback_to_mock",
    );
  });

  it("disconnects MCP, resets state, and routes later tasks back to MockRuntime fallback", async () => {
    const adapter = createAdapterWithTransport();
    await adapter.connectMcp();
    await adapter.discoverMcp();

    expect(adapter.getMcpState().status).toBe("connected");
    adapter.disconnectMcp();

    expect(adapter.getMcpState()).toMatchObject({
      status: "disconnected",
      protocolVersion: null,
      serverInfo: null,
      capabilities: null,
    });

    const record = await adapter.submitTask(baseDraft);
    expect(adapter.getSnapshot().eventsByTaskId[record.id].map((event) => event.type)).toContain(
      "mcp_fallback_to_mock",
    );
  });

  it("invalid endpoint error keeps MockRuntime task routing intact", async () => {
    const adapter = createDesktopRuntimeAdapter();
    adapter.setMcpEndpoint("not-a-url");
    await adapter.connectMcp();

    expect(adapter.getMcpState().status).toBe("error");
    expect(adapter.getMcpState().lastError).toBeTruthy();

    const record = await adapter.submitTask(baseDraft);
    expect(adapter.getSnapshot().eventsByTaskId[record.id].map((event) => event.type)).toContain(
      "mcp_fallback_to_mock",
    );
  });

  it("connect error from transport/session failure keeps disconnected state", async () => {
    const badTransport = (): McpTransportClient => ({
      sendRequest: vi.fn(async () => ({
        jsonrpc: "2.0" as const,
        id: 1,
        error: { code: -1, message: "Connection refused" },
      })),
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    });

    const adapter = createDesktopRuntimeAdapter({ createTransport: badTransport });
    await adapter.connectMcp();

    expect(adapter.getMcpState().status).toBe("error");
    expect(adapter.getMcpState().lastError).toContain("Connection refused");
  });
});

const initializeFixture = {
  protocolVersion: "2025-06-18",
  serverInfo: { name: "Test MCP Server", version: "1.0.0" },
  capabilities: { tools: {}, resources: {}, prompts: {} },
};

const discoveryFixtures: Record<string, unknown> = {
  initialize: initializeFixture,
  "tools/list": {
    tools: [
      { name: "ue.selection.get", description: "Read current editor selection" },
    ],
  },
  "resources/list": {
    resources: [{ uri: "ue://selection/current", name: "Current selection", mimeType: "application/json" }],
  },
  "prompts/list": { prompts: [{ name: "summarize-selection", description: "Summarize" }] },
};

function mockTransportThatResponds(fixtures: Record<string, unknown>): McpTransportClient {
  return {
    sendRequest: vi.fn(async (request) => {
      const fixture = fixtures[request.method];
      return { jsonrpc: "2.0" as const, id: request.id, result: fixture ?? null };
    }),
    sendNotification: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

type StreamableHttpTransportImplementation = (
  options: ConstructorParameters<typeof StreamableHttpTransport>[0],
) => InstanceType<typeof StreamableHttpTransport>;

type LegacySseTransportImplementation = (
  options: ConstructorParameters<typeof LegacySseTransport>[0],
) => InstanceType<typeof LegacySseTransport>;

function mockStreamableHttpTransport(createTransport: () => McpTransportClient) {
  vi.mocked(StreamableHttpTransport).mockImplementation(
    (() => createTransport() as InstanceType<typeof StreamableHttpTransport>) as StreamableHttpTransportImplementation,
  );
}

function mockLegacySseTransport(createTransport: () => McpTransportClient) {
  vi.mocked(LegacySseTransport).mockImplementation(
    (() => createTransport() as InstanceType<typeof LegacySseTransport>) as LegacySseTransportImplementation,
  );
}

describe("Legacy SSE fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streamable connect success does not try legacy and sets legacyMode=false", async () => {
    mockStreamableHttpTransport(() => mockTransportThatResponds({ initialize: initializeFixture }));

    const adapter = createDesktopRuntimeAdapter();
    await adapter.connectMcp();

    expect(adapter.getMcpState().status).toBe("connected");
    expect(adapter.getMcpState().legacyMode).toBe(false);
    expect(adapter.getMcpState().protocolVersion).toBe("2025-06-18");
    expect(vi.mocked(LegacySseTransport)).not.toHaveBeenCalled();
  });

  it("streamable 404 fallback to legacy SSE sets legacyMode=true", async () => {
    mockStreamableHttpTransport(() => ({
      sendRequest: vi.fn(async () => {
        throw new McpTransportError("MCP HTTP request failed with status 404.", 404);
      }),
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    }));

    mockLegacySseTransport(() => mockTransportThatResponds({ initialize: initializeFixture }));

    const adapter = createDesktopRuntimeAdapter();
    await adapter.connectMcp();

    expect(adapter.getMcpState().status).toBe("connected");
    expect(adapter.getMcpState().legacyMode).toBe(true);
    expect(adapter.getMcpState().protocolVersion).toBe("2025-06-18");
    expect(vi.mocked(StreamableHttpTransport)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(LegacySseTransport)).toHaveBeenCalledTimes(1);
  });

  it("streamable 405 fallback to legacy SSE sets legacyMode=true", async () => {
    mockStreamableHttpTransport(() => ({
      sendRequest: vi.fn(async () => {
        throw new McpTransportError("MCP HTTP request failed with status 405.", 405);
      }),
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    }));

    mockLegacySseTransport(() => mockTransportThatResponds({ initialize: initializeFixture }));

    const adapter = createDesktopRuntimeAdapter();
    await adapter.connectMcp();

    expect(adapter.getMcpState().status).toBe("connected");
    expect(adapter.getMcpState().legacyMode).toBe(true);
  });

  it("non-compat error does not fallback and sets error state", async () => {
    mockStreamableHttpTransport(() => ({
      sendRequest: vi.fn(async () => {
        throw new McpTransportError("MCP HTTP request failed with status 500.", 500);
      }),
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    }));

    const adapter = createDesktopRuntimeAdapter();
    await adapter.connectMcp();

    expect(adapter.getMcpState().status).toBe("error");
    expect(adapter.getMcpState().legacyMode).toBe(false);
    expect(vi.mocked(LegacySseTransport)).not.toHaveBeenCalled();
  });

  it("non-McpTransportError does not fallback and sets error state", async () => {
    mockStreamableHttpTransport(() => ({
      sendRequest: vi.fn(async () => {
        throw new Error("Network error");
      }),
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    }));

    const adapter = createDesktopRuntimeAdapter();
    await adapter.connectMcp();

    expect(adapter.getMcpState().status).toBe("error");
    expect(adapter.getMcpState().lastError).toContain("Network error");
    expect(vi.mocked(LegacySseTransport)).not.toHaveBeenCalled();
  });

  it("after legacy fallback connect, discoverMcp fills capabilities from legacy discovery", async () => {
    mockStreamableHttpTransport(() => ({
      sendRequest: vi.fn(async () => {
        throw new McpTransportError("MCP HTTP request failed with status 404.", 404);
      }),
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    }));

    mockLegacySseTransport(() => mockTransportThatResponds(discoveryFixtures));

    const adapter = createDesktopRuntimeAdapter();
    await adapter.connectMcp();

    expect(adapter.getMcpState().status).toBe("connected");
    expect(adapter.getMcpState().legacyMode).toBe(true);

    await adapter.discoverMcp();

    expect(adapter.getMcpState().status).toBe("connected");
    expect(adapter.getMcpState().capabilities).toEqual({
      tools: 1,
      resources: 1,
      prompts: 1,
      readOnlyTools: 1,
      blockedTools: 0,
    });
  });
});
