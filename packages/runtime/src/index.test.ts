import { describe, it, expect } from "vitest";
import {
  createInitialState,
  createMockRuntime,
  reduceAgentState,
  reduceTaskEvents,
} from "./index.js";
import type { TaskDraft } from "@uagent/shared";

describe("@uagent/runtime state machine", () => {
  it("should start with idle state", () => {
    const state = createInitialState();
    expect(state.status).toBe("idle");
    expect(state.currentTaskId).toBeNull();
  });

  it("should transition to thinking on START", () => {
    const state = createInitialState();
    const next = reduceAgentState(state, { type: "START", taskId: "task-1" });
    expect(next.status).toBe("thinking");
    expect(next.currentTaskId).toBe("task-1");
    expect(next.startedAt).toBeGreaterThan(0);
  });

  it("should transition to finished on FINISH", () => {
    const state = createInitialState();
    const active = reduceAgentState(state, { type: "START", taskId: "task-1" });
    const finished = reduceAgentState(active, { type: "FINISH" });
    expect(finished.status).toBe("finished");
    expect(finished.finishedAt).toBeGreaterThan(0);
  });

  it("should handle ERROR transition", () => {
    const state = createInitialState();
    const active = reduceAgentState(state, { type: "START", taskId: "task-1" });
    const errored = reduceAgentState(active, { type: "ERROR", error: "test error" });
    expect(errored.status).toBe("error");
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
    providerStatus: "not_configured",
    createdAt: 1_000,
  };

  it("emits deterministic MVP1 events for a submitted task", async () => {
    const runtime = createMockRuntime({ clockStart: 1_000 });
    const record = await runtime.submitTask(baseDraft);
    const events = runtime.getSnapshot().eventsByTaskId[record.id];

    expect(record.id).toBe("task-0001");
    expect(events.map((event) => event.type)).toEqual([
      "task_submitted",
      "plan_created",
      "tool_started",
      "tool_completed",
      "evidence_created",
      "review_created",
      "task_completed",
    ]);
    expect(runtime.getSnapshot().tasksById[record.id].state).toBe("completed");
  });

  it("reduces TaskEvent arrays into a RuntimeSnapshot", async () => {
    const runtime = createMockRuntime({ clockStart: 1_000 });
    const record = await runtime.submitTask(baseDraft);
    const events = runtime.getSnapshot().eventsByTaskId[record.id];
    const snapshot = reduceTaskEvents(events);

    expect(snapshot.status).toBe("completed");
    expect(snapshot.activeTaskId).toBe(record.id);
    expect(snapshot.tasksById[record.id].state).toBe("completed");
    expect(snapshot.eventsByTaskId[record.id]).toHaveLength(7);
  });

  it("injects a deterministic task_failed event when input includes #fail", async () => {
    const runtime = createMockRuntime({ clockStart: 1_000 });
    const record = await runtime.submitTask({ ...baseDraft, input: "Review lighting #fail" });
    const snapshot = runtime.getSnapshot();
    const events = snapshot.eventsByTaskId[record.id];

    expect(events.at(-1)?.type).toBe("task_failed");
    expect(snapshot.status).toBe("error");
    expect(snapshot.tasksById[record.id].state).toBe("failed");
    expect(snapshot.lastError).toContain("#fail");
  });

  it("cancels an active delayed task and stops later events", async () => {
    const runtime = createMockRuntime({ clockStart: 1_000, autoFlush: false });
    const record = await runtime.submitTask(baseDraft);
    await runtime.flushNextEvent(record.id);
    await runtime.flushNextEvent(record.id);

    await runtime.cancelTask(record.id);
    await runtime.flushAll(record.id);

    const events = runtime.getSnapshot().eventsByTaskId[record.id];
    expect(events.map((event) => event.type)).toEqual([
      "task_submitted",
      "plan_created",
      "task_cancelled",
    ]);
    expect(runtime.getSnapshot().tasksById[record.id].state).toBe("cancelled");
  });

  it("does not append cancellation after a task is completed", async () => {
    const runtime = createMockRuntime({ clockStart: 1_000 });
    const record = await runtime.submitTask(baseDraft);

    await runtime.cancelTask(record.id);

    const snapshot = runtime.getSnapshot();
    const events = snapshot.eventsByTaskId[record.id];
    expect(events.map((event) => event.type)).toEqual([
      "task_submitted",
      "plan_created",
      "tool_started",
      "tool_completed",
      "evidence_created",
      "review_created",
      "task_completed",
    ]);
    expect(snapshot.tasksById[record.id].state).toBe("completed");
  });

  it("does not let late cancellation events overwrite terminal reducer state", async () => {
    const runtime = createMockRuntime({ clockStart: 1_000 });
    const record = await runtime.submitTask(baseDraft);
    const completedEvents = runtime.getSnapshot().eventsByTaskId[record.id];
    const lateCancelEvent = {
      ...completedEvents.at(-1)!,
      id: `${record.id}-event-late-cancel`,
      type: "task_cancelled" as const,
      title: "Task cancelled",
      body: "Late cancel should not overwrite completion.",
      level: "warning" as const,
      createdAt: 2_000,
    };

    const snapshot = reduceTaskEvents([...completedEvents, lateCancelEvent]);

    expect(snapshot.tasksById[record.id].state).toBe("completed");
    expect(snapshot.status).toBe("completed");
    expect(snapshot.eventsByTaskId[record.id].map((event) => event.type)).toEqual([
      "task_submitted",
      "plan_created",
      "tool_started",
      "tool_completed",
      "evidence_created",
      "review_created",
      "task_completed",
    ]);
  });
});
