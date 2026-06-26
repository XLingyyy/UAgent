import { describe, expect, it, vi } from "vitest";
import { createMockRuntime } from "./mock-runtime.js";
import { createRuntimeRouter } from "./runtime-router.js";
import { createMcpReadOnlyRuntime } from "./mcp-readonly-runtime.js";
import type { McpDiscoverySnapshot } from "@uagent/shared";

const draft = {
  input: "检查当前选择",
  projectId: "lyra",
  permissionMode: "request_approval" as const,
  modelId: "not-configured",
  reasoningEffort: "medium",
  runMode: "local" as const,
  branch: "main",
  contextPercent: 10,
  providerStatus: "not_configured" as const,
};

const discovery: McpDiscoverySnapshot = {
  tools: [{ name: "ue.asset.delete" }, { name: "ue.selection.get" }],
  resources: [{ uri: "ue://selection/current", name: "Current selection" }],
  prompts: [{ name: "summarize" }],
  capabilitySummary: {
    tools: 2,
    resources: 1,
    prompts: 1,
    readOnlyTools: 1,
    blockedTools: 1,
  },
  discoveredAt: 1,
};

describe("RuntimeRouter", () => {
  it("falls back to MockRuntime when MCP is disconnected", async () => {
    const router = createRuntimeRouter({
      mockRuntime: createMockRuntime({ clockStart: 1_000 }),
      mcpRuntime: null,
    });

    const record = await router.submitTask(draft);
    const events = router.getSnapshot().eventsByTaskId[record.id];

    expect(events.some((event) => event.type === "mcp_fallback_to_mock")).toBe(true);
    expect(events.some((event) => event.type === "task_completed")).toBe(true);
  });

  it("routes read-only intent to MCP runtime and emits MCP read events", async () => {
    const mcpRuntime = createMcpReadOnlyRuntime({
      discovery,
      readResource: async () => ({
        uri: "ue://selection/current",
        text: "Actor: BP_Door",
      }),
      clockStart: 2_000,
    });
    const router = createRuntimeRouter({
      mockRuntime: createMockRuntime({ clockStart: 1_000 }),
      mcpRuntime,
    });

    const record = await router.submitTask(draft);
    const events = router.getSnapshot().eventsByTaskId[record.id];

    expect(events.map((event) => event.type)).toContain("mcp_discovery_completed");
    expect(events.map((event) => event.type)).toContain("mcp_read_completed");
    expect(events.at(-1)?.type).toBe("task_completed");
  });

  it("emits blocked tool events without executing blocked calls and terminates with task_completed", async () => {
    let called = false;
    const mcpRuntime = createMcpReadOnlyRuntime({
      discovery,
      callTool: async () => {
        called = true;
        return {};
      },
      clockStart: 2_000,
    });

    const record = await mcpRuntime.submitTask({ ...draft, input: "delete current selection" });
    const snapshot = mcpRuntime.getSnapshot();
    const events = snapshot.eventsByTaskId[record.id];

    expect(called).toBe(false);
    expect(events.map((event) => event.type)).toEqual([
      "task_submitted",
      "mcp_discovery_started",
      "mcp_discovery_completed",
      "mcp_tool_blocked",
      "review_created",
      "task_completed",
    ]);
    expect(snapshot.tasksById[record.id].state).toBe("completed");
  });

  it("emits task_failed for unresolved intent and ends in failed terminal state", async () => {
    const mcpRuntime = createMcpReadOnlyRuntime({
      discovery: {
        ...discovery,
        tools: [],
        resources: [],
      },
      clockStart: 2_000,
    });

    const record = await mcpRuntime.submitTask({ ...draft, input: "unknown command" });
    const snapshot = mcpRuntime.getSnapshot();
    const events = snapshot.eventsByTaskId[record.id];

    expect(events.map((event) => event.type).at(-1)).toBe("task_failed");
    expect(snapshot.tasksById[record.id].state).toBe("failed");
  });

  it("does not execute unknown discovered tools and ends unresolved intent in failed terminal state", async () => {
    const callTool = vi.fn(async () => ({}));
    const mcpRuntime = createMcpReadOnlyRuntime({
      discovery: {
        ...discovery,
        tools: [{ name: "ue.magic", description: "Unknown editor capability" }],
        resources: [],
        capabilitySummary: {
          tools: 1,
          resources: 0,
          prompts: 0,
          readOnlyTools: 0,
          blockedTools: 1,
        },
      },
      callTool,
      clockStart: 2_000,
    });

    const record = await mcpRuntime.submitTask({ ...draft, input: "use magic tool" });
    const snapshot = mcpRuntime.getSnapshot();
    const events = snapshot.eventsByTaskId[record.id];

    expect(callTool).not.toHaveBeenCalled();
    expect(events.map((event) => event.type)).toEqual([
      "task_submitted",
      "mcp_discovery_started",
      "mcp_discovery_completed",
      "task_failed",
    ]);
    expect(snapshot.tasksById[record.id].state).toBe("failed");
  });

  it("routes blocked/resolved task through router and terminates correctly", async () => {
    const mcpRuntime = createMcpReadOnlyRuntime({
      discovery,
      clockStart: 2_000,
    });
    const router = createRuntimeRouter({
      mockRuntime: createMockRuntime({ clockStart: 1_000 }),
      mcpRuntime,
    });

    const record = await router.submitTask({ ...draft, input: "delete current selection" });
    const events = router.getSnapshot().eventsByTaskId[record.id];

    expect(events.map((event) => event.type)).toEqual([
      "task_submitted",
      "mcp_discovery_started",
      "mcp_discovery_completed",
      "mcp_tool_blocked",
      "review_created",
      "task_completed",
    ]);
    expect(router.getSnapshot().status).toBe("completed");
  });
});
