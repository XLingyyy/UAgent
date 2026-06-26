import { describe, expect, it } from "vitest";
import type { McpDiscoverySnapshot, TaskDraft } from "@uagent/shared";
import { createAgentLoopRuntime } from "./agent-loop-runtime.js";

const baseDraft: TaskDraft = {
  input: "Review current selection",
  projectId: null,
  permissionMode: "request_approval",
  modelId: "not-configured",
  reasoningEffort: "medium",
  runMode: "local",
  branch: "main",
  contextPercent: 12,
  providerStatus: "not_configured",
  createdAt: 1_000,
};

const discovery: McpDiscoverySnapshot = {
  tools: [{ name: "ue.selection.get", description: "Read current editor selection" }],
  resources: [{ uri: "ue://selection/current", name: "Current selection" }],
  prompts: [],
  capabilitySummary: {
    tools: 1,
    resources: 1,
    prompts: 0,
    readOnlyTools: 1,
    blockedTools: 0,
  },
  discoveredAt: 1_000,
};

describe("createAgentLoopRuntime", () => {
  it("runs a no-discovery mock fallback Agent flow to completion", async () => {
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mock",
      discovery: null,
      clockStart: 2_000,
    });

    const record = await runtime.submitTask(baseDraft);
    const snapshot = runtime.getSnapshot();
    const events = snapshot.eventsByTaskId[record.id];

    expect(snapshot.tasksById[record.id].state).toBe("completed");
    expect(events.map((event) => event.type)).toEqual([
      "task_submitted",
      "mcp_fallback_to_mock",
      "agent_plan_started",
      "agent_plan_created",
      "agent_step_started",
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
  });

  it("executes discovered MCP resources through readResource", async () => {
    const reads: string[] = [];
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mcp-readonly",
      discovery,
      clockStart: 2_000,
      readResource: async (uri) => {
        reads.push(uri);
        return { uri, text: "StaticMeshActor_1" };
      },
    });

    const record = await runtime.submitTask(baseDraft);
    const events = runtime.getSnapshot().eventsByTaskId[record.id];

    expect(reads).toEqual(["ue://selection/current"]);
    expect(events.map((event) => event.type)).toContain("mcp_read_completed");
    expect(runtime.getSnapshot().tasksById[record.id].state).toBe("completed");
  });

  it("blocks write intent and does not call tools/call", async () => {
    const calls: string[] = [];
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mcp-readonly",
      discovery,
      clockStart: 2_000,
      callTool: async (name) => {
        calls.push(name);
        return { text: "should not happen" };
      },
    });

    const record = await runtime.submitTask({ ...baseDraft, input: "delete current selection" });
    const events = runtime.getSnapshot().eventsByTaskId[record.id];

    expect(calls).toEqual([]);
    expect(events.map((event) => event.type)).toContain("mcp_tool_blocked");
    expect(events.map((event) => event.type)).toContain("agent_report_created");
    expect(runtime.getSnapshot().tasksById[record.id].state).toBe("completed");
  });

  it("fails the task when action execution throws and emits report/review before failure", async () => {
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mock",
      discovery: null,
      clockStart: 2_000,
      mockObserver: async () => {
        throw new Error("mock observer failed");
      },
    });

    const record = await runtime.submitTask({ ...baseDraft, input: "Review selection #fail" });
    const snapshot = runtime.getSnapshot();
    const types = snapshot.eventsByTaskId[record.id].map((event) => event.type);

    expect(types).toContain("agent_step_failed");
    expect(types).toContain("agent_report_created");
    expect(types).toContain("review_created");
    expect(types.at(-1)).toBe("task_failed");
    expect(types.indexOf("agent_report_created")).toBeGreaterThan(types.indexOf("agent_step_failed"));
    expect(types.indexOf("review_created")).toBeGreaterThan(types.indexOf("agent_report_created"));
    expect(types.indexOf("task_failed")).toBeGreaterThan(types.indexOf("review_created"));
    expect(snapshot.tasksById[record.id].state).toBe("failed");
    expect(snapshot.lastError).toContain("mock observer failed");
    const payload = snapshot.eventsByTaskId[record.id].find(
      (e) => e.type === "agent_report_created",
    )?.payload as { report?: { summary: string } } | undefined;
    expect(payload?.report?.summary).toContain("failed:");
  });

  it("updateContext switches runtime mode and preserves existing snapshot", async () => {
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mock",
      discovery: null,
      clockStart: 2_000,
    });

    const record1 = await runtime.submitTask(baseDraft);
    expect(record1.id).toBe("task-0001");
    expect(runtime.getSnapshot().tasksById["task-0001"].state).toBe("completed");

    runtime.updateContext({
      runtimeMode: "mcp-readonly",
      discovery: {
        tools: [{ name: "ue.selection.get", description: "Read current editor selection" }],
        resources: [{ uri: "ue://selection/current", name: "Current selection" }],
        prompts: [],
        capabilitySummary: { tools: 1, resources: 1, prompts: 0, readOnlyTools: 1, blockedTools: 0 },
        discoveredAt: 2_000,
      },
    });

    const record2 = await runtime.submitTask({ ...baseDraft, input: "check selection" });
    expect(record2.id).toBe("task-0002");
    expect(runtime.getSnapshot().tasksById["task-0001"].state).toBe("completed");
    expect(runtime.getSnapshot().tasksById["task-0002"].state).toBe("completed");
    expect(Object.keys(runtime.getSnapshot().tasksById).length).toBe(2);
  });

  it("cancels an in-flight Agent task and stops later steps", async () => {
    let releaseObserver: (value: unknown) => void = () => {};
    const observerGate = new Promise((resolve) => {
      releaseObserver = resolve;
    });
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mock",
      discovery: null,
      clockStart: 2_000,
      mockObserver: async () => observerGate,
    });

    const pending = runtime.submitTask(baseDraft);
    await Promise.resolve();
    const taskId = runtime.getSnapshot().activeTaskId!;
    await runtime.cancelTask(taskId);
    releaseObserver({ text: "late result" });
    await pending;

    const events = runtime.getSnapshot().eventsByTaskId[taskId];
    expect(events.map((event) => event.type)).toContain("task_cancelled");
    expect(events.map((event) => event.type)).not.toContain("task_completed");
    expect(runtime.getSnapshot().tasksById[taskId].state).toBe("cancelled");
  });
});
