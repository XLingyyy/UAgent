import { describe, expect, it } from "vitest";
import { createAgentLoopRuntime } from "@uagent/runtime";
import type { TaskDraft, TaskEvent, TaskRecord, TaskState } from "@uagent/shared";
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

  it("projects provider runtime events into UI trace rows", () => {
    const task = createTask("completed");
    const events: TaskEvent[] = [
      event("task_submitted", 1, "User request", "Review current selection"),
      event("provider_request_started", 2, "Provider request started", "mock-streaming / mock-model"),
      event("provider_stream_delta", 3, "Provider stream delta", "chunk 1"),
      event("provider_usage_recorded", 4, "Provider usage recorded", "input 3 / output 2"),
      event("provider_request_completed", 5, "Provider request completed", "Mock response complete"),
      event("task_completed", 6, "Task completed", "Agent loop completed."),
    ];

    const model = createAgentTraceViewModel(events, task);

    expect(model.rows.map((row) => row.label)).toEqual([
      "Run started",
      "Provider request started",
      "Provider stream delta",
      "Provider usage recorded",
      "Provider request completed",
      "Run completed",
    ]);
    expect(model.rows.find((row) => row.label === "Provider request completed")?.tone).toBe("success");
  });

  it("uses stable readable labels, details, and tones for provider stream lifecycle rows", () => {
    const task = createTask("completed");
    const events: TaskEvent[] = [
      event("task_submitted", 1, "User request", "Stream provider response"),
      event("provider_request_started", 2, "Provider request started", "mock-streaming / mock-model"),
      event("provider_stream_started", 3, "Provider stream started", "request provider-request-1"),
      event("provider_stream_delta", 4, "Provider stream delta", "delta: hello"),
      event("provider_stream_completed", 5, "Provider stream completed", "hello world"),
      event("provider_usage_recorded", 6, "Provider usage recorded", "input 3 / output 2 / total 5"),
      event("provider_request_completed", 7, "Provider request completed", "finish: stop"),
      event("task_completed", 8, "Task completed", "Agent loop completed."),
    ];

    const model = createAgentTraceViewModel(events, task);

    expect(model.rows.find((row) => row.label === "Provider stream started")?.detail).toBe("request provider-request-1");
    expect(model.rows.find((row) => row.label === "Provider stream delta")?.detail).toBe("delta: hello");
    expect(model.rows.find((row) => row.label === "Provider stream completed")?.tone).toBe("success");
    expect(model.rows.find((row) => row.label === "Provider usage recorded")?.tone).toBe("default");
    expect(model.rows.find((row) => row.label === "Provider request completed")?.tone).toBe("success");
  });

  it("marks provider failures and cancellations without hiding partial stream rows", () => {
    const task = createTask("failed");
    const events: TaskEvent[] = [
      event("task_submitted", 1, "User request", "Stream provider response"),
      event("provider_request_started", 2, "Provider request started", "mock-streaming / mock-model"),
      event("provider_stream_delta", 3, "Provider stream delta", "partial text"),
      event("provider_request_failed", 4, "Provider request failed", "timeout"),
      event("provider_request_cancelled", 5, "Provider request cancelled", "user cancelled"),
      event("task_failed", 6, "Task failed", "timeout"),
    ];

    const model = createAgentTraceViewModel(events, task);

    expect(model.rows.map((row) => row.label)).toContain("Provider stream delta");
    expect(model.rows.find((row) => row.label === "Provider request failed")?.tone).toBe("error");
    expect(model.rows.find((row) => row.label === "Provider request cancelled")?.tone).toBe("warning");
    expect(model.rows.find((row) => row.label === "Provider stream delta")?.tone).toBe("default");
  });
});

function createTask(state: TaskState): TaskRecord {
  return {
    id: "task-0001",
    title: "Review current selection",
    state,
    draft: { ...draft, input: "Review current selection" },
    createdAt: 1,
    updatedAt: 6,
    completedAt: state === "completed" ? 6 : null,
    error: null,
  };
}

function event(type: TaskEvent["type"], createdAt: number, title: string, body: string): TaskEvent {
  return {
    id: `event-${createdAt}`,
    taskId: "task-0001",
    type,
    title,
    body,
    createdAt,
  };
}
