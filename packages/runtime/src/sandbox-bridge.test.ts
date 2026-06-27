import { describe, it, expect } from "vitest";
import {
  type SandboxEvent,
  type TaskEvent,
  type TaskEventType,
  type TaskEventLevel,
} from "@uagent/shared";
import { emitSandboxEvent } from "./sandbox-bridge.js";

function createSandboxEvent(
  overrides: Partial<SandboxEvent> & { type: SandboxEvent["type"] },
): SandboxEvent {
  return {
    id: "evt-001",
    taskId: "task-001",
    requestId: "req-001",
    title: "sandbox event",
    createdAt: 1000,
    ...overrides,
  };
}

function createEmitter() {
  const events: TaskEvent[] = [];
  function emit(
    type: TaskEventType,
    title: string,
    body?: string,
    level?: TaskEventLevel,
    payload?: Record<string, unknown>,
  ): TaskEvent {
    const event: TaskEvent = {
      id: `task-001-${events.length}`,
      taskId: "task-001",
      type,
      title,
      body,
      level,
      createdAt: Date.now(),
      payload,
    };
    events.push(event);
    return event;
  }
  return { events, emit };
}

describe("sandbox-bridge", () => {
  it("sandbox_started maps to correct TaskEvent type", () => {
    const { events, emit } = createEmitter();
    const sandboxEvent = createSandboxEvent({ type: "sandbox_started" });

    emitSandboxEvent("task-001", "step-001", sandboxEvent, emit);

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("sandbox_started");
    expect(events[0].level).toBe("info");
    expect(events[0].payload).toHaveProperty("sandboxRequestId", "req-001");
    expect(events[0].payload).toHaveProperty("stepId", "step-001");
  });

  it("sandbox_completed maps to correct TaskEvent type", () => {
    const { events, emit } = createEmitter();
    const sandboxEvent = createSandboxEvent({ type: "sandbox_completed" });

    emitSandboxEvent("task-001", null, sandboxEvent, emit);

    expect(events[0].type).toBe("sandbox_completed");
    expect(events[0].level).toBe("success");
  });

  it("sandbox_failed maps to correct TaskEvent type", () => {
    const { events, emit } = createEmitter();
    const sandboxEvent = createSandboxEvent({ type: "sandbox_failed" });

    emitSandboxEvent("task-001", null, sandboxEvent, emit);

    expect(events[0].type).toBe("sandbox_failed");
    expect(events[0].level).toBe("error");
  });

  it("sandbox_blocked maps to correct TaskEvent type", () => {
    const { events, emit } = createEmitter();
    const sandboxEvent = createSandboxEvent({ type: "sandbox_blocked" });

    emitSandboxEvent("task-001", null, sandboxEvent, emit);

    expect(events[0].type).toBe("sandbox_blocked");
    expect(events[0].level).toBe("warning");
  });

  it("sandbox_timed_out maps to correct TaskEvent type", () => {
    const { events, emit } = createEmitter();
    const sandboxEvent = createSandboxEvent({ type: "sandbox_timed_out" });

    emitSandboxEvent("task-001", null, sandboxEvent, emit);

    expect(events[0].type).toBe("sandbox_timed_out");
    expect(events[0].level).toBe("warning");
  });

  describe("evidence includes truncated output", () => {
    it("truncates long body in emitted event", () => {
      const { events, emit } = createEmitter();
      const longBody = "x".repeat(5000);
      const sandboxEvent = createSandboxEvent({
        type: "sandbox_completed",
        body: longBody,
      });

      emitSandboxEvent("task-001", null, sandboxEvent, emit);

      expect(events[0].body!.length).toBeLessThan(longBody.length);
      expect(events[0].body).toContain("[redacted: output truncated]");
      expect(events[0].payload).toHaveProperty("evidence", "redacted");
    });

    it("includes short body without truncation", () => {
      const { events, emit } = createEmitter();
      const shortBody = "short output";
      const sandboxEvent = createSandboxEvent({
        type: "sandbox_completed",
        body: shortBody,
      });

      emitSandboxEvent("task-001", null, sandboxEvent, emit);

      expect(events[0].body).toBe(shortBody);
    });

    it("handles undefined body", () => {
      const { events, emit } = createEmitter();
      const sandboxEvent = createSandboxEvent({
        type: "sandbox_started",
        body: undefined,
      });

      emitSandboxEvent("task-001", null, sandboxEvent, emit);

      expect(events[0].body).toBeUndefined();
    });
  });
});
