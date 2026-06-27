import { describe, expect, it } from "vitest";
import {
  createLegacySseFixtureFetch,
  createMcpFixtureScenario,
  createStreamableHttpFixtureFetch,
  LegacySseTransport,
  StreamableHttpTransport,
} from "@uagent/mcp-client";
import type { TaskDraft } from "@uagent/shared";
import { createDesktopRuntimeAdapter } from "./desktop-runtime-adapter";

const baseDraft: TaskDraft = {
  input: "check current selection",
  projectId: "lyra",
  permissionMode: "request_approval",
  modelId: "not-configured",
  reasoningEffort: "medium",
  runMode: "local",
  branch: "main",
  contextPercent: 12,
};

describe("DesktopRuntimeAdapter MCP fixture integration", () => {
  it("uses mock fallback when connected but not discovered", async () => {
    const scenario = createMcpFixtureScenario({
      routes: {
        initialize: { result: { protocolVersion: "2025-06-18", serverInfo: { name: "fixture", version: "1.0.0" }, capabilities: { resources: {} } } },
      },
    });
    const adapter = createDesktopRuntimeAdapter({
      createTransport: (endpoint) =>
        new StreamableHttpTransport({
          endpoint,
          fetch: createStreamableHttpFixtureFetch(scenario),
        }),
    });

    await adapter.connectMcp();
    const record = await adapter.submitTask(baseDraft);

    expect(adapter.getMcpState().status).toBe("connected");
    expect(adapter.getMcpState().capabilities).toBeNull();
    expect(adapter.getSnapshot().eventsByTaskId[record.id].map((event) => event.type)).toContain(
      "mcp_fallback_to_mock",
    );
    expect(scenario.findRequests("resources/read")).toHaveLength(0);
  });

  it("passes fixture resources/read result into Agent observation and report", async () => {
    const scenario = createMcpFixtureScenario({
      routes: {
        initialize: { result: { protocolVersion: "2025-06-18", serverInfo: { name: "fixture", version: "1.0.0" }, capabilities: { resources: {}, tools: {}, prompts: {} } } },
        "resources/list": { result: { resources: [{ uri: "ue://selection/current", name: "Current selection" }] } },
        "tools/list": { result: { tools: [] } },
        "prompts/list": { result: { prompts: [] } },
        "resources/read": { result: { contents: [{ type: "text", text: "Fixture StaticMeshActor" }] } },
      },
    });
    const adapter = createDesktopRuntimeAdapter({
      createTransport: (endpoint) =>
        new StreamableHttpTransport({
          endpoint,
          fetch: createStreamableHttpFixtureFetch(scenario, { sessionId: "desktop-session" }),
        }),
    });

    await adapter.connectMcp();
    await adapter.discoverMcp();
    const record = await adapter.submitTask(baseDraft);
    const events = adapter.getSnapshot().eventsByTaskId[record.id];
    const observation = events.find((event) => event.type === "agent_observation_created");

    expect(scenario.findRequests("resources/read")).toHaveLength(1);
    expect(scenario.findRequests("resources/read")[0]?.headers?.["Mcp-Session-Id"]).toBe("desktop-session");
    expect(observation?.body).toContain("Fixture StaticMeshActor");
    expect(events.map((event) => event.type)).toContain("agent_report_created");
    expect(adapter.getSnapshot().tasksById[record.id].state).toBe("completed");
  });

  it("sends tools/call only for streamable fixture-discovered read-only tools", async () => {
    const scenario = createMcpFixtureScenario({
      routes: {
        initialize: { result: { protocolVersion: "2025-06-18", serverInfo: { name: "fixture", version: "1.0.0" }, capabilities: { tools: {}, resources: {}, prompts: {} } } },
        "resources/list": { result: { resources: [] } },
        "tools/list": { result: { tools: [{ name: "ue.selection.get", description: "Read current selection" }] } },
        "prompts/list": { result: { prompts: [] } },
        "tools/call": { result: { content: [{ type: "text", text: "Tool fixture selection" }] } },
      },
    });
    const adapter = createAdapterWithStreamableScenario(scenario);

    await adapter.connectMcp();
    await adapter.discoverMcp();
    const record = await adapter.submitTask(baseDraft);
    const events = adapter.getSnapshot().eventsByTaskId[record.id];

    expect(scenario.findRequests("resources/read")).toHaveLength(0);
    expect(scenario.findRequests("tools/call")).toHaveLength(1);
    expect(scenario.findRequests("tools/call")[0]?.params).toEqual({ name: "ue.selection.get", arguments: {} });
    expect(events.map((event) => event.type)).toContain("mcp_read_completed");
    expect(events.find((event) => event.type === "agent_observation_created")?.body).toContain("Tool fixture selection");
    expect(adapter.getSnapshot().tasksById[record.id].state).toBe("completed");
  });

  it.each([
    ["json-rpc error", { error: { code: -32000, message: "fixture read failed" } }],
    ["malformed response", { malformed: "not-json-rpc" }],
    ["timeout", { timeout: true }],
  ] as const)("fails streamable resources/read %s without a false success terminal state", async (_name, route) => {
    const scenario = createMcpFixtureScenario({
      routes: {
        initialize: { result: { protocolVersion: "2025-06-18", serverInfo: { name: "fixture", version: "1.0.0" }, capabilities: { resources: {}, tools: {}, prompts: {} } } },
        "resources/list": { result: { resources: [{ uri: "ue://selection/current", name: "Current selection" }] } },
        "tools/list": { result: { tools: [] } },
        "prompts/list": { result: { prompts: [] } },
        "resources/read": route,
      },
    });
    const adapter = createAdapterWithStreamableScenario(scenario);

    await adapter.connectMcp();
    await adapter.discoverMcp();
    const record = await adapter.submitTask(baseDraft);
    const eventTypes = adapter.getSnapshot().eventsByTaskId[record.id].map((event) => event.type);

    expect(scenario.findRequests("resources/read")).toHaveLength(1);
    expect(eventTypes).toContain("agent_step_failed");
    expect(eventTypes).not.toContain("task_completed");
    expect(adapter.getSnapshot().tasksById[record.id].state).toBe("failed");
  });

  it("passes legacy HTTP+SSE fixture resources/read result into Agent observation and marks legacy mode", async () => {
    const scenario = createMcpFixtureScenario({
      routes: {
        initialize: { result: { protocolVersion: "2025-06-18", serverInfo: { name: "legacy-fixture", version: "1.0.0" }, capabilities: { resources: {}, tools: {}, prompts: {} } } },
        "resources/list": { result: { resources: [{ uri: "ue://selection/current", name: "Current selection" }] } },
        "tools/list": { result: { tools: [] } },
        "prompts/list": { result: { prompts: [] } },
        "resources/read": { result: { contents: [{ type: "text", text: "Legacy fixture selection" }] } },
      },
    });
    const adapter = createDesktopRuntimeAdapter({
      createTransport: (endpoint) =>
        new LegacySseTransport({
          endpoint,
          fetch: createLegacySseFixtureFetch(scenario),
        }),
    });

    await adapter.connectMcp();
    await adapter.discoverMcp();
    const record = await adapter.submitTask(baseDraft);
    const events = adapter.getSnapshot().eventsByTaskId[record.id];

    expect(scenario.findRequests("resources/read")).toHaveLength(1);
    expect(events.find((event) => event.type === "agent_observation_created")?.body).toContain("Legacy fixture selection");
    expect(events.map((event) => event.type)).toContain("agent_report_created");
    expect(adapter.getSnapshot().tasksById[record.id].state).toBe("completed");
  });

  it("does not send tools/call for blocked fixture-discovered mutating tools", async () => {
    const scenario = createMcpFixtureScenario({
      routes: {
        initialize: { result: { protocolVersion: "2025-06-18", serverInfo: { name: "fixture", version: "1.0.0" }, capabilities: { tools: {}, resources: {}, prompts: {} } } },
        "resources/list": { result: { resources: [] } },
        "tools/list": { result: { tools: [{ name: "ue.asset.delete", description: "Delete asset" }] } },
        "prompts/list": { result: { prompts: [] } },
      },
    });
    const adapter = createDesktopRuntimeAdapter({
      createTransport: (endpoint) =>
        new StreamableHttpTransport({
          endpoint,
          fetch: createStreamableHttpFixtureFetch(scenario),
        }),
    });

    await adapter.connectMcp();
    await adapter.discoverMcp();
    const record = await adapter.submitTask({ ...baseDraft, input: "delete current selection" });
    const events = adapter.getSnapshot().eventsByTaskId[record.id].map((event) => event.type);

    expect(scenario.findRequests("tools/call")).toHaveLength(0);
    expect(events).toContain("mcp_tool_blocked");
    expect(adapter.getSnapshot().tasksById[record.id].state).toBe("completed");
  });

  it("does not send tools/call for unknown fixture-discovered tools and fails unresolved intent", async () => {
    const scenario = createMcpFixtureScenario({
      routes: {
        initialize: { result: { protocolVersion: "2025-06-18", serverInfo: { name: "fixture", version: "1.0.0" }, capabilities: { tools: {}, resources: {}, prompts: {} } } },
        "resources/list": { result: { resources: [] } },
        "tools/list": { result: { tools: [{ name: "ue.magic.optimize", description: "Unknown tool" }] } },
        "prompts/list": { result: { prompts: [] } },
      },
    });
    const adapter = createAdapterWithStreamableScenario(scenario);

    await adapter.connectMcp();
    await adapter.discoverMcp();
    const record = await adapter.submitTask({ ...baseDraft, input: "optimize lighting blueprint" });
    const events = adapter.getSnapshot().eventsByTaskId[record.id].map((event) => event.type);

    expect(scenario.findRequests("tools/call")).toHaveLength(0);
    expect(events).toContain("agent_step_failed");
    expect(events).not.toContain("mcp_read_completed");
    expect(adapter.getSnapshot().tasksById[record.id].state).toBe("failed");
  });

  it("falls back to mock after disconnect without sending fixture resources/read", async () => {
    const scenario = createMcpFixtureScenario({
      routes: {
        initialize: { result: { protocolVersion: "2025-06-18", serverInfo: { name: "fixture", version: "1.0.0" }, capabilities: { resources: {}, tools: {}, prompts: {} } } },
        "resources/list": { result: { resources: [{ uri: "ue://selection/current", name: "Current selection" }] } },
        "tools/list": { result: { tools: [] } },
        "prompts/list": { result: { prompts: [] } },
      },
    });
    const adapter = createAdapterWithStreamableScenario(scenario);

    await adapter.connectMcp();
    await adapter.discoverMcp();
    adapter.disconnectMcp();
    const record = await adapter.submitTask(baseDraft);
    const events = adapter.getSnapshot().eventsByTaskId[record.id].map((event) => event.type);

    expect(adapter.getMcpState().status).toBe("disconnected");
    expect(scenario.findRequests("resources/read")).toHaveLength(0);
    expect(events).toContain("mcp_fallback_to_mock");
    expect(adapter.getSnapshot().tasksById[record.id].state).toBe("completed");
  });

  it("denies non-local endpoints before any fixture request is sent", async () => {
    const scenario = createMcpFixtureScenario();
    const adapter = createAdapterWithStreamableScenario(scenario);

    adapter.setMcpEndpoint("https://example.com/mcp");
    await adapter.connectMcp();

    expect(adapter.getMcpState().status).toBe("error");
    expect(adapter.getMcpState().lastError).toContain("Only localhost MCP endpoints are allowed");
    expect(scenario.requests).toHaveLength(0);
  });

  it("records prompt, resource, and tool discovery requests before task execution", async () => {
    const scenario = createMcpFixtureScenario({
      routes: {
        initialize: { result: { protocolVersion: "2025-06-18", serverInfo: { name: "fixture", version: "1.0.0" }, capabilities: { resources: {}, tools: {}, prompts: {} } } },
        "resources/list": { result: { resources: [{ uri: "ue://selection/current", name: "Current selection" }] } },
        "tools/list": { result: { tools: [{ name: "ue.selection.get" }] } },
        "prompts/list": { result: { prompts: [{ name: "summarize-selection" }] } },
        "resources/read": { result: { contents: [{ type: "text", text: "Prompt log fixture" }] } },
      },
    });
    const adapter = createAdapterWithStreamableScenario(scenario);

    await adapter.connectMcp();
    await adapter.discoverMcp();
    const record = await adapter.submitTask(baseDraft);

    expect(scenario.requests.map((request) => request.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "resources/list",
      "prompts/list",
      "resources/read",
    ]);
    expect(scenario.findRequests("notifications/initialized")[0]?.notification).toBe(true);
    expect(scenario.findRequests("prompts/list")).toHaveLength(1);
    expect(scenario.findRequests("resources/list")).toHaveLength(1);
    expect(scenario.findRequests("tools/list")).toHaveLength(1);
    expect(adapter.getSnapshot().tasksById[record.id].state).toBe("completed");
  });
});

function createAdapterWithStreamableScenario(scenario: ReturnType<typeof createMcpFixtureScenario>) {
  return createDesktopRuntimeAdapter({
    createTransport: (endpoint) =>
      new StreamableHttpTransport({
        endpoint,
        fetch: createStreamableHttpFixtureFetch(scenario),
      }),
  });
}
