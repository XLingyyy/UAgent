import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesktopRuntimeAdapter } from "./desktop-runtime-adapter";
import { DESKTOP_MOCK_RUNTIME_FLUSH_DELAY_MS } from "./runtime-store";
import type { TaskDraft } from "@uagent/shared";

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
    expect(events.map((e) => e.type)).toEqual(["task_submitted", "plan_created"]);
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
});
