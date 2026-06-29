import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopRuntimeAdapter } from "./desktop-runtime-adapter";
import { LegacySseTransport, McpTransportError, StreamableHttpTransport } from "@uagent/mcp-client";
import type { McpTransportClient } from "@uagent/mcp-client";
import type { TaskDraft } from "@uagent/shared";
import type { NativeInvoke } from "./project-native-adapter";

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
  it("submit routes through AgentLoop and emits plan, observation, evidence, and report events", async () => {
    const adapter = createDesktopRuntimeAdapter();
    const record = await adapter.submitTask(baseDraft);
    const snapshot = adapter.getSnapshot();
    const events = snapshot.eventsByTaskId[record.id];

    expect(record.id).toBe("task-0001");
    expect(events.map((e) => e.type)).toEqual([
      "task_submitted",
      "mcp_fallback_to_mock",
      "agent_plan_started",
      "agent_plan_created",
      "agent_step_started",
      "agent_observation_created",
      "evidence_created",
      "agent_step_completed",
      "agent_step_started",
      "agent_step_completed",
      "agent_step_started",
      "agent_observation_created",
      "evidence_created",
      "agent_step_completed",
      "agent_step_started",
      "agent_step_completed",
      "agent_report_created",
      "review_created",
      "task_completed",
    ]);
    expect(snapshot.tasksById[record.id].state).toBe("completed");
  });

  it("completed AgentLoop task does not add late cancellation event", async () => {
    const adapter = createDesktopRuntimeAdapter();
    const record = await adapter.submitTask(baseDraft);

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
    expect(lastCall.status).toBe("completed");
  });

  it("handles #fail input and ends in error state", async () => {
    const adapter = createDesktopRuntimeAdapter();
    const failDraft: TaskDraft = { ...baseDraft, input: "Review lighting #fail" };
    const record = await adapter.submitTask(failDraft);

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

    const record = await adapter.submitTask({ ...baseDraft, input: "check current selection" });
    const events = adapter.getSnapshot().eventsByTaskId[record.id].map((event) => event.type);

    expect(events).toContain("agent_plan_created");
    expect(events).toContain("agent_step_started");
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
    expect(events).toContain("agent_step_failed");
    expect(events).toContain("agent_report_created");
    expect(events).toContain("review_created");
    expect(events.indexOf("agent_report_created")).toBeGreaterThan(events.indexOf("agent_step_failed"));
    expect(events.indexOf("review_created")).toBeGreaterThan(events.indexOf("agent_report_created"));
    expect(events.indexOf("task_failed")).toBeGreaterThan(events.indexOf("review_created"));
    expect(events.at(-1)).toBe("task_failed");
    expect(snapshot.tasksById[record.id].state).toBe("failed");
  });

  it("submitApprovalDecision is exposed and does not throw for valid call shape", async () => {
    const adapter = createDesktopRuntimeAdapter();
    const record = await adapter.submitTask(baseDraft);
    await expect(
      adapter.submitApprovalDecision(record.id, "step-1", "approved", "test", "test"),
    ).resolves.toBeUndefined();
    const snapshot = adapter.getSnapshot();
    expect(snapshot.tasksById[record.id]).toBeDefined();
  });

  it("preserves mock task snapshot through MCP connect+discover cycle", async () => {
    const adapter = createDesktopRuntimeAdapter();
    await adapter.submitTask(baseDraft);

    await adapter.connectMcp();
    await adapter.discoverMcp();

    const snapshot = adapter.getSnapshot();
    expect(snapshot.tasksById["task-0001"]).toBeDefined();
    expect(snapshot.tasksById["task-0001"].state).toBe("completed");
  });

  it("preserves old tasks and increments task id after MCP discover", async () => {
    const adapter = createDesktopRuntimeAdapter();
    const record1 = await adapter.submitTask(baseDraft);

    await adapter.connectMcp();
    await adapter.discoverMcp();

    const record2 = await adapter.submitTask({ ...baseDraft, input: "check current selection" });

    const snapshot = adapter.getSnapshot();
    expect(snapshot.tasksById["task-0001"]).toBeDefined();
    expect(snapshot.tasksById["task-0002"]).toBeDefined();
    expect(Object.keys(snapshot.tasksById).length).toBe(2);
    expect(record1.id).not.toBe(record2.id);
  });

  it("preserves all tasks through disconnect back to mock fallback", async () => {
    const adapter = createDesktopRuntimeAdapter();
    await adapter.submitTask(baseDraft);
    await adapter.connectMcp();
    await adapter.discoverMcp();
    await adapter.submitTask({ ...baseDraft, input: "check current selection" });

    adapter.disconnectMcp();

    const record3 = await adapter.submitTask(baseDraft);

    const snapshot = adapter.getSnapshot();
    expect(snapshot.tasksById["task-0001"]).toBeDefined();
    expect(snapshot.tasksById["task-0002"]).toBeDefined();
    expect(snapshot.tasksById["task-0003"]).toBeDefined();
    expect(Object.keys(snapshot.tasksById).length).toBe(3);
    expect(record3.id).toBe("task-0003");
    expect(
      snapshot.eventsByTaskId["task-0003"].map((e) => e.type),
    ).toContain("mcp_fallback_to_mock");
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

  it("subscribeMvp9 does not double-notify (P1 subscription cleanup)", () => {
    const adapter = createDesktopRuntimeAdapter();
    const listener = vi.fn();
    const unsub = adapter.subscribeMvp9(listener);

    adapter.getMvp9().terminal.propose("pnpm test", "[project-root]", null);
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    listener.mockClear();
    adapter.getMvp9().terminal.propose("pnpm lint", "[project-root]", null);
    expect(listener).not.toHaveBeenCalled();
  });

  it("subscribeMvp9 unsubscribe prevents further listener calls (P1 subscription cleanup)", () => {
    const adapter = createDesktopRuntimeAdapter();
    const listener = vi.fn();
    const unsub = adapter.subscribeMvp9(listener);

    unsub();
    adapter.getMvp9().terminal.propose("pnpm build", "[project-root]", null);
    expect(listener).not.toHaveBeenCalled();
  });

  it("routes MVP10 terminal proposal, approval, and execution through native invoke without exposing raw token or cwd", async () => {
    const calls: Array<{ command: string; payload: unknown }> = [];
    const nativeInvoke = vi.fn(async <T,>(command: string, payload: unknown): Promise<T> => {
      calls.push({ command, payload });
      if (command === "terminal_capability_status") {
        return {
          enabled: true,
          mode: "native",
          reason: null,
          allowlistSummary: "typecheck, lint, test, desktop web build, cargo test, git status/diff",
          trustedRootRequired: true,
          approvalRequired: true,
          timeoutMs: 60_000,
          outputLimitBytes: 1_048_576,
          outputLimitLines: 5_000,
        } as T;
      }
      if (command === "watcher_capability_status") {
        return {
          enabled: false,
          mode: "disabled",
          reason: "feature_disabled",
          trustedRootRequired: true,
          debounceMs: 500,
          maxQueueSize: 10000,
          overflowAction: "warn",
          readDiffOnly: true,
        } as T;
      }
      if (command === "propose_terminal_command") {
        return {
          proposalId: "native-proposal-1",
          command: "pnpm test",
          risk: "allowlisted",
          reason: "command classified as allowlisted",
          requiresApproval: true,
          featureFlag: "terminal",
          canonicalCwd: "G:\\UAgent",
          redactedCwd: "[project-root]",
          expiresAt: 1_700_000_300_000,
          timeoutMs: 60_000,
          outputLimitBytes: 1_048_576,
          outputLimitLines: 5_000,
        } as T;
      }
      if (command === "approve_terminal_proposal") {
        return { token: "raw-native-token:native-proposal-1", status: "approved" } as T;
      }
      if (command === "execute_terminal_command_real") {
        return {
          status: "completed",
          chunks: [
            { index: 0, stream: "stdout", text: "ok\n", truncated: false, timestamp: 1_700_000_000_001 },
          ],
          exitCode: 0,
          durationMs: 25,
          outputSummary: "ok\n",
          outputTruncated: false,
          totalBytes: 3,
          totalLines: 1,
          redactionSummary: { replacedSecrets: 0, replacedPaths: 1 },
        } as T;
      }
      throw new Error(`unexpected native command ${command}`);
    }) as unknown as NativeInvoke;

    const adapter = createDesktopRuntimeAdapter({ nativeInvoke });
    const terminal = adapter.getMvp9().mvp10.terminal;
    await vi.waitFor(() => {
      expect(terminal.getState().capability?.enabled).toBe(true);
    });

    const proposal = await terminal.propose("pnpm test", "G:\\UAgent", "task-native-1", "G:\\UAgent", "lyra");
    const token = await terminal.approve(proposal.id, "user", "approve");
    const state = terminal.getState();

    expect(calls.map((call) => call.command)).toEqual([
      "terminal_capability_status",
      "browser_capability_status",
      "propose_terminal_command",
      "approve_terminal_proposal",
      "execute_terminal_command_real",
    ]);
    const proposeIdx = calls.findIndex((c) => c.command === "propose_terminal_command");
    expect(calls[proposeIdx].payload).toEqual({
      input: { command: "pnpm test", cwd: "G:\\UAgent", projectId: "lyra" },
    });
    const executeIdx = calls.findIndex((c) => c.command === "execute_terminal_command_real");
    expect(calls[executeIdx].payload).toEqual({
      input: {
        command: "pnpm test",
        cwd: "G:\\UAgent",
        approvedToken: "raw-native-token:native-proposal-1",
        timeoutSecs: 60,
      },
    });
    expect(proposal.id).toBe("native-proposal-1");
    expect(proposal.cwd).toBe("[project-root]");
    expect(state.stage).toBe("completed");
    expect(state.executionResult?.exitState?.code).toBe(0);
    expect(state.executionResult?.chunks[0]?.text).toBe("ok\n");
    expect(token?.id).not.toContain("raw-native-token");
    expect(JSON.stringify(state)).not.toContain("raw-native-token");
    expect(JSON.stringify(state)).not.toContain("G:\\UAgent");
  });

  it("reports native terminal disabled from capability status even when native invoke exists", async () => {
    const nativeInvoke = vi.fn(async <T,>(command: string): Promise<T> => {
      if (command === "terminal_capability_status") {
        return {
          enabled: false,
          mode: "disabled",
          reason: "feature_disabled",
          allowlistSummary: "typecheck, lint, test, desktop web build, cargo test, git status/diff",
          trustedRootRequired: true,
          approvalRequired: true,
          timeoutMs: 60_000,
          outputLimitBytes: 1_048_576,
          outputLimitLines: 5_000,
        } as T;
      }
      if (command === "watcher_capability_status") {
        return {
          enabled: false,
          mode: "disabled",
          reason: "feature_disabled",
          trustedRootRequired: true,
          debounceMs: 500,
          maxQueueSize: 10000,
          overflowAction: "warn",
          readDiffOnly: true,
        } as T;
      }
      throw new Error(`unexpected native command ${command}`);
    }) as unknown as NativeInvoke;

    const adapter = createDesktopRuntimeAdapter({ nativeInvoke });
    const terminal = adapter.getMvp9().mvp10.terminal;

    await vi.waitFor(() => {
      expect(terminal.getState().capability).toMatchObject({
        enabled: false,
        mode: "disabled",
        reason: "feature_disabled",
      });
    });
    expect(nativeInvoke).toHaveBeenCalledWith("terminal_capability_status");
  });

  it("reports native watcher disabled from capability status even when native invoke exists", async () => {
    const nativeInvoke = vi.fn(async <T,>(command: string): Promise<T> => {
      if (command === "terminal_capability_status") {
        return {
          enabled: false,
          mode: "disabled",
          reason: "feature_disabled",
          allowlistSummary: "typecheck, lint, test, desktop web build, cargo test, git status/diff",
          trustedRootRequired: true,
          approvalRequired: true,
          timeoutMs: 60_000,
          outputLimitBytes: 1_048_576,
          outputLimitLines: 5_000,
        } as T;
      }
      if (command === "watcher_capability_status") {
        return {
          enabled: false,
          mode: "disabled",
          reason: "feature_disabled",
          trustedRootRequired: true,
          debounceMs: 500,
          maxQueueSize: 10000,
          overflowAction: "warn",
          readDiffOnly: true,
        } as T;
      }
      throw new Error(`unexpected native command ${command}`);
    }) as unknown as NativeInvoke;

    const adapter = createDesktopRuntimeAdapter({ nativeInvoke });
    const watcher = adapter.getMvp9().watcher;
    await watcher.refreshCapability?.();

    expect(watcher.getState().capability).toMatchObject({
      enabled: false,
      mode: "disabled",
      reason: "feature_disabled",
      trustedRootRequired: true,
      readDiffOnly: true,
    });
    expect(nativeInvoke).toHaveBeenCalledWith("watcher_capability_status");
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
