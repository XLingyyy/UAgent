import { describe, expect, it } from "vitest";
import type { McpDiscoverySnapshot, TaskDraft } from "@uagent/shared";
import { createAgentLoopRuntime } from "./agent-loop-runtime.js";
import { buildAgentRunTrace } from "./agent-run-recorder.js";
import { replayAgentRunTrace } from "./agent-run-replay.js";

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

describe("Agent run recorder and replay", () => {
  it("builds a deterministic trace summary from a completed mock fallback run", async () => {
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mock",
      discovery: null,
      clockStart: 2_000,
    });

    const record = await runtime.submitTask(baseDraft);
    const snapshot = runtime.getSnapshot();
    const trace = buildAgentRunTrace(snapshot.eventsByTaskId[record.id], snapshot.tasksById[record.id]);
    const replay = replayAgentRunTrace(trace);

    expect(trace.status).toBe("completed");
    expect(trace.goal).toBe("Review current selection");
    expect(trace.steps.map((step) => step.title)).toContain("Create mock observation");
    expect(trace.observations).toHaveLength(1);
    expect(trace.evidenceRefs).toEqual(["evidence-0001"]);
    expect(replay.eventTypes.at(0)).toBe("run_started");
    expect(replay.terminalEventType).toBe("run_completed");
    expect(replay.reportSummary).toContain("completed:");
  });

  it("records blocked actions without treating the run as failed", async () => {
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mcp-readonly",
      discovery,
      clockStart: 2_000,
    });

    const record = await runtime.submitTask({ ...baseDraft, input: "delete current selection" });
    const snapshot = runtime.getSnapshot();
    const trace = buildAgentRunTrace(snapshot.eventsByTaskId[record.id], snapshot.tasksById[record.id]);

    expect(trace.status).toBe("completed");
    expect(trace.blockedActions).toEqual([
      expect.objectContaining({
        stepId: "task-0001-agent-step-02-policy",
        reason: "Mutating intent is outside MVP3 read-only boundaries.",
        riskLevel: "blocked",
      }),
    ]);
    expect(replayAgentRunTrace(trace).blockedActionCount).toBe(1);
  });

  it("records failed runs with report context and does not throw on error events", async () => {
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
    const trace = buildAgentRunTrace(snapshot.eventsByTaskId[record.id], snapshot.tasksById[record.id]);
    const replay = replayAgentRunTrace(trace);

    expect(trace.status).toBe("failed");
    expect(trace.error).toBe("mock observer failed");
    expect(trace.reportSummary).toContain("failed:");
    expect(replay.terminalEventType).toBe("run_failed");
  });

  it("records cancelled runs when cancellation wins the terminal state", async () => {
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

    const snapshot = runtime.getSnapshot();
    const trace = buildAgentRunTrace(snapshot.eventsByTaskId[taskId], snapshot.tasksById[taskId]);

    expect(trace.status).toBe("cancelled");
    expect(trace.events.map((event) => event.type)).toContain("run_cancelled");
    expect(replayAgentRunTrace(trace).terminalEventType).toBe("run_cancelled");
  });

  it("infers failed status from raw task_failed events without TaskRecord", async () => {
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
    const trace = buildAgentRunTrace(snapshot.eventsByTaskId[record.id]);
    const replay = replayAgentRunTrace(trace);

    expect(trace.status).toBe("failed");
    expect(trace.error).toBe("mock observer failed");
    expect(replay.terminalEventType).toBe("run_failed");
    expect(trace.events.some((e) => e.type === "run_failed")).toBe(true);
  });

  it("infers cancelled status from raw task_cancelled events without TaskRecord", async () => {
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

    const snapshot = runtime.getSnapshot();
    const trace = buildAgentRunTrace(snapshot.eventsByTaskId[taskId]);
    const replay = replayAgentRunTrace(trace);

    expect(trace.status).toBe("cancelled");
    expect(replay.terminalEventType).toBe("run_cancelled");
    expect(trace.events.some((e) => e.type === "run_cancelled")).toBe(true);
  });

  it("infers completed status from raw task_completed events without TaskRecord", async () => {
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mock",
      discovery: null,
      clockStart: 2_000,
    });

    const record = await runtime.submitTask(baseDraft);
    const snapshot = runtime.getSnapshot();
    const trace = buildAgentRunTrace(snapshot.eventsByTaskId[record.id]);
    const replay = replayAgentRunTrace(trace);

    expect(trace.status).toBe("completed");
    expect(replay.terminalEventType).toBe("run_completed");
    expect(trace.events.some((e) => e.type === "run_completed")).toBe(true);
  });

  it("does not return completed for non-terminal raw events without TaskRecord", async () => {
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

    const snapshot = runtime.getSnapshot();
    const trace = buildAgentRunTrace(snapshot.eventsByTaskId[taskId]);

    expect(trace.status).not.toBe("completed");
    expect(trace.status).toBe("running");
    expect(trace.events.some((e) => e.type === "run_completed" || e.type === "run_failed" || e.type === "run_cancelled")).toBe(false);

    // Cleanup: cancel to avoid hang
    await runtime.cancelTask(taskId);
    releaseObserver({ text: "cleanup" });
    await pending.catch(() => {});
  });
});
