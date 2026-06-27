import { describe, expect, it } from "vitest";
import type {
  AuditActor,
  AuditEvent,
  AuditEventType,
  TaskEvent,
  TaskEventType,
} from "@uagent/shared";
import {
  createAuditProjection,
  buildAuditFromTaskEvents,
} from "./audit-projection.js";

function makeTaskEvent(
  seq: number,
  type: TaskEventType,
  overrides?: Partial<TaskEvent>,
): TaskEvent {
  return {
    id: `task-event-${seq}`,
    taskId: "task-0001",
    type,
    title: type,
    body: type,
    createdAt: 1_000 + seq,
    ...overrides,
  } as TaskEvent;
}

function makeAuditEvent(
  seq: number,
  type: AuditEventType,
  overrides?: Partial<AuditEvent>,
): AuditEvent {
  return {
    id: `audit-${seq}`,
    type,
    taskId: "task-0001",
    sessionId: null,
    actor: { type: "system", id: "test", label: "Test" },
    title: type,
    body: "",
    summary: type,
    redacted: false,
    createdAt: 1_000 + seq,
    ...overrides,
  } as AuditEvent;
}

describe("AuditProjection", () => {
  describe("append-only behavior", () => {
    it("should record and retrieve audit events", () => {
      const engine = createAuditProjection();
      const event = makeAuditEvent(1, "task_submitted");

      engine.recordAuditEvent(event);

      const projection = engine.getProjection();
      expect(projection.totalCount).toBe(1);
      expect(projection.events).toHaveLength(1);
      expect(projection.events[0].id).toBe(event.id);
    });

    it("should not allow modification of recorded events through the returned array", () => {
      const engine = createAuditProjection();
      const event = makeAuditEvent(1, "task_submitted");
      engine.recordAuditEvent(event);

      const projection1 = engine.getProjection();
      projection1.events.push(makeAuditEvent(2, "task_completed"));

      const projection2 = engine.getProjection();
      expect(projection2.totalCount).toBe(1);
      expect(projection2.events).toHaveLength(1);
    });

    it("should clear all events", () => {
      const engine = createAuditProjection();
      engine.recordAuditEvent(makeAuditEvent(1, "task_submitted"));
      engine.recordAuditEvent(makeAuditEvent(2, "task_completed"));

      engine.clear();

      const projection = engine.getProjection();
      expect(projection.totalCount).toBe(0);
      expect(projection.events).toHaveLength(0);
    });
  });

  describe("buildAuditFromTaskEvents", () => {
    it("should produce events with redacted flag set to true", () => {
      const events: TaskEvent[] = [
        makeTaskEvent(1, "task_submitted"),
        makeTaskEvent(2, "task_completed"),
      ];

      const auditEvents = buildAuditFromTaskEvents(events);

      for (const ae of auditEvents) {
        expect(ae.redacted).toBe(true);
      }
    });

    it("should skip task event types that have no audit equivalent", () => {
      const events: TaskEvent[] = [
        makeTaskEvent(1, "agent_plan_started"),
        makeTaskEvent(2, "agent_step_completed"),
      ];

      const auditEvents = buildAuditFromTaskEvents(events);
      expect(auditEvents).toHaveLength(0);
    });

    it("should preserve provider mode in the audit event payload", () => {
      const events: TaskEvent[] = [
        makeTaskEvent(1, "provider_request_started", {
          payload: { providerMode: "fixture" },
        }),
        makeTaskEvent(2, "provider_request_completed", {
          payload: { providerMode: "live" },
        }),
        makeTaskEvent(3, "task_completed"),
      ];

      const auditEvents = buildAuditFromTaskEvents(events);

      expect(auditEvents[0].payload?.providerMode).toBe("fixture");
      expect(auditEvents[1].payload?.providerMode).toBe("live");
      expect(auditEvents[2].payload?.providerMode).toBeUndefined();
    });

    it("should assign sessionId and actor when provided", () => {
      const events: TaskEvent[] = [makeTaskEvent(1, "task_submitted")];
      const actor: AuditActor = {
        type: "user",
        id: "user-1",
        label: "Alice",
      };

      const auditEvents = buildAuditFromTaskEvents(events, "session-001", actor);

      expect(auditEvents[0].sessionId).toBe("session-001");
      expect(auditEvents[0].actor).toBe(actor);
    });

    it("should use default actor when none provided", () => {
      const events: TaskEvent[] = [makeTaskEvent(1, "task_submitted")];

      const auditEvents = buildAuditFromTaskEvents(events);

      expect(auditEvents[0].actor.type).toBe("system");
      expect(auditEvents[0].actor.id).toBe("task-event-reducer");
    });

    it("should include source event metadata in payload", () => {
      const sourceEvent = makeTaskEvent(1, "task_submitted");
      const auditEvents = buildAuditFromTaskEvents([sourceEvent]);

      expect(auditEvents[0].payload?.sourceEventId).toBe(sourceEvent.id);
      expect(auditEvents[0].payload?.sourceEventType).toBe(sourceEvent.type);
    });
  });

  describe("query filters", () => {
    it("should filter by taskId", () => {
      const engine = createAuditProjection();
      engine.recordAuditEvent(makeAuditEvent(1, "task_submitted", { taskId: "task-0001" }));
      engine.recordAuditEvent(makeAuditEvent(2, "task_completed", { taskId: "task-0002" }));
      engine.recordAuditEvent(makeAuditEvent(3, "task_failed", { taskId: "task-0001" }));

      const results = engine.queryAuditEvents({ taskId: "task-0001" });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.taskId === "task-0001")).toBe(true);
    });

    it("should filter by event types", () => {
      const engine = createAuditProjection();
      engine.recordAuditEvent(makeAuditEvent(1, "task_submitted"));
      engine.recordAuditEvent(makeAuditEvent(2, "task_completed"));
      engine.recordAuditEvent(makeAuditEvent(3, "approval_required"));

      const results = engine.queryAuditEvents({
        eventTypes: ["task_submitted", "approval_required"],
      });
      expect(results).toHaveLength(2);
      expect(results.map((e) => e.type).sort()).toEqual([
        "approval_required",
        "task_submitted",
      ]);
    });

    it("should filter by time range", () => {
      const engine = createAuditProjection();
      engine.recordAuditEvent(makeAuditEvent(1, "task_submitted", { createdAt: 1_000 }));
      engine.recordAuditEvent(makeAuditEvent(2, "task_completed", { createdAt: 2_000 }));
      engine.recordAuditEvent(makeAuditEvent(3, "task_failed", { createdAt: 3_000 }));

      const results = engine.queryAuditEvents({ fromTick: 1_500, toTick: 2_500 });
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("task_completed");
    });

    it("should return all events when no filter is applied", () => {
      const engine = createAuditProjection();
      engine.recordAuditEvent(makeAuditEvent(1, "task_submitted"));
      engine.recordAuditEvent(makeAuditEvent(2, "task_completed"));

      const results = engine.queryAuditEvents({});
      expect(results).toHaveLength(2);
    });
  });
});
