import { describe, expect, it } from "vitest";
import {
  createMcpFixtureScenario,
  createStreamableHttpFixtureFetch,
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
});
