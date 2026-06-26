import { describe, expect, it } from "vitest";
import { createAgentLoopRuntime } from "@uagent/runtime";
import type { TaskDraft } from "@uagent/shared";
import { createAgentTraceViewModel } from "./agent-trace-view-models";

const draft: TaskDraft = {
  input: "delete current selection",
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

describe("createAgentTraceViewModel", () => {
  it("projects task events into UI trace rows", async () => {
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mock",
      discovery: null,
      clockStart: 2_000,
    });
    const record = await runtime.submitTask(draft);
    const snapshot = runtime.getSnapshot();
    const model = createAgentTraceViewModel(snapshot.eventsByTaskId[record.id], snapshot.tasksById[record.id]);

    expect(model.status).toBe("completed");
    expect(model.goal).toBe("delete current selection");
    expect(model.rows.map((row) => row.label)).toContain("Run completed");
    expect(model.steps.map((step) => step.title)).toContain("Block mutating intent");
    expect(model.blockedActions).toHaveLength(1);
    expect(model.empty).toBe(false);
  });

  it("returns an empty state without task events", () => {
    const model = createAgentTraceViewModel([], undefined);

    expect(model.empty).toBe(true);
    expect(model.status).toBe("idle");
    expect(model.rows).toEqual([]);
  });
});
