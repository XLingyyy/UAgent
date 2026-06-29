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

    it("should map MVP11 diagnostic and context pack task events", () => {
      const events: TaskEvent[] = [
        makeTaskEvent(1, "diagnostic_started", { payload: { diagnosticKind: "ue_project_metadata", severity: "info" } }),
        makeTaskEvent(2, "diagnostic_completed", { payload: { diagnosticKind: "build_failure_summary", severity: "error" } }),
        makeTaskEvent(3, "diagnostic_failed", { payload: { diagnosticKind: "mcp_warning", severity: "warning" } }),
        makeTaskEvent(4, "context_pack_created", { payload: { diagnosticKind: "context_pack", severity: "info" } }),
      ];

      const auditEvents = buildAuditFromTaskEvents(events);

      expect(auditEvents.map((event) => event.type)).toEqual([
        "diagnostic_started",
        "diagnostic_completed",
        "diagnostic_failed",
        "context_pack_created",
      ]);
      expect(auditEvents[1].payload?.diagnosticKind).toBe("build_failure_summary");
      expect(auditEvents[1].payload?.severity).toBe("error");
    });

    it("should redact api_key from title in audit event", () => {
      const events: TaskEvent[] = [
        makeTaskEvent(1, "task_submitted", {
          title: 'api_key=sk-abcdefghijklmnopqrstuvwxyz123456',
          body: 'api_key=sk-abcdefghijklmnopqrstuvwxyz123456',
        }),
      ];

      const auditEvents = buildAuditFromTaskEvents(events);

      expect(auditEvents[0].title).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
      expect(auditEvents[0].body).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
      expect(auditEvents[0].summary).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
      expect(auditEvents[0].title).toContain('[REDACTED]');
    });

    it("should redact Authorization Bearer token from audit event", () => {
      const events: TaskEvent[] = [
        makeTaskEvent(1, "approval_required", {
          title: 'Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz123456',
        }),
      ];

      const auditEvents = buildAuditFromTaskEvents(events);

      expect(auditEvents[0].title).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
      expect(auditEvents[0].title).toBe('Authorization: Bearer [REDACTED]');
    });

    it("should redact token= from audit event title and body", () => {
      const events: TaskEvent[] = [
        makeTaskEvent(1, "approval_required", {
          title: 'token=abcdef1234567890abcdef1234567890',
          body: 'token=abcdef1234567890abcdef1234567890',
        }),
      ];

      const auditEvents = buildAuditFromTaskEvents(events);

      expect(auditEvents[0].title).not.toContain('abcdef1234567890abcdef1234567890');
      expect(auditEvents[0].body).not.toContain('abcdef1234567890abcdef1234567890');
      expect(auditEvents[0].title).toContain('[REDACTED]');
    });

    it("should recursively redact payload containing all three required secret patterns", () => {
      const events: TaskEvent[] = [
        makeTaskEvent(1, "approval_required", {
          payload: {
            config: {
              apiKey: 'sk-abcdefghijklmnopqrstuvwxyz123456',
              nestedArray: [
                'safe',
                'Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz123456',
              ],
              tokenValue: 'token=abcdef1234567890abcdef1234567890',
            },
          },
        }),
      ];

      const auditEvents = buildAuditFromTaskEvents(events);

      const payload = auditEvents[0].payload as Record<string, unknown>;
      const config = payload.config as Record<string, unknown>;

      expect(config.apiKey as string).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
      expect(config.apiKey as string).toContain('[REDACTED]');

      const nestedArray = config.nestedArray as unknown[];
      expect(nestedArray[0]).toBe('safe');
      expect(nestedArray[1] as string).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
      expect(nestedArray[1] as string).toContain('[REDACTED]');

      expect(config.tokenValue as string).not.toContain('abcdef1234567890abcdef1234567890');
      expect(config.tokenValue as string).toContain('[REDACTED]');
    });
  });

  describe("recordAuditEvent direct write redaction", () => {
    it("should redact all secret patterns from title, body, and summary", () => {
      const engine = createAuditProjection();
      const event = makeAuditEvent(1, "task_submitted", {
        title: 'api_key=sk-abcdefghijklmnopqrstuvwxyz123456',
        body: 'Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz123456',
        summary: 'token=abcdef1234567890abcdef1234567890',
      });

      engine.recordAuditEvent(event);

      const fromQuery = engine.queryAuditEvents({});
      expect(fromQuery).toHaveLength(1);
      expect(fromQuery[0].title).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
      expect(fromQuery[0].body).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
      expect(fromQuery[0].summary).not.toContain('abcdef1234567890abcdef1234567890');
      expect(fromQuery[0].title).toContain('[REDACTED]');
      expect(fromQuery[0].body).toContain('[REDACTED]');
      expect(fromQuery[0].summary).toContain('[REDACTED]');

      const fromProjection = engine.getProjection();
      expect(fromProjection.events[0].title).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
      expect(fromProjection.events[0].body).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
      expect(fromProjection.events[0].summary).not.toContain('abcdef1234567890abcdef1234567890');
    });

    it("should set redacted flag to true after direct write", () => {
      const engine = createAuditProjection();
      const event = makeAuditEvent(1, "task_submitted", { redacted: false });

      engine.recordAuditEvent(event);

      const result = engine.queryAuditEvents({});
      expect(result[0].redacted).toBe(true);
    });

    it("should preserve non-secret metadata fields", () => {
      const engine = createAuditProjection();
      const event = makeAuditEvent(1, "task_submitted", {
        taskId: "task-42",
        sessionId: "session-99",
        actor: { type: "user", id: "user-1", label: "Alice" },
        createdAt: 5_000,
      });

      engine.recordAuditEvent(event);

      const result = engine.queryAuditEvents({});
      expect(result[0].id).toBe(event.id);
      expect(result[0].type).toBe("task_submitted");
      expect(result[0].taskId).toBe("task-42");
      expect(result[0].sessionId).toBe("session-99");
      expect(result[0].actor).toEqual({ type: "user", id: "user-1", label: "Alice" });
      expect(result[0].createdAt).toBe(5_000);
    });

    it("should recursively redact nested payload with all three required secret patterns", () => {
      const engine = createAuditProjection();
      const event = makeAuditEvent(1, "approval_required", {
        payload: {
          credentials: {
            apiKey: 'sk-abcdefghijklmnopqrstuvwxyz123456',
          },
          headers: ['Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz123456'],
          config: {
            token: 'token=abcdef1234567890abcdef1234567890',
          },
        },
      });

      engine.recordAuditEvent(event);

      const fromQuery = engine.queryAuditEvents({});
      const payload = fromQuery[0].payload as Record<string, unknown>;
      const credentials = payload.credentials as Record<string, unknown>;
      const headers = payload.headers as unknown[];
      const config = payload.config as Record<string, unknown>;

      expect(credentials.apiKey as string).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
      expect(credentials.apiKey as string).toContain('[REDACTED]');
      expect(headers[0] as string).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
      expect(headers[0] as string).toContain('[REDACTED]');
      expect(config.token as string).not.toContain('abcdef1234567890abcdef1234567890');
      expect(config.token as string).toContain('[REDACTED]');

      const fromProjection = engine.getProjection();
      const projPayload = fromProjection.events[0].payload as Record<string, unknown>;
      expect((projPayload.credentials as Record<string, unknown>).apiKey as string).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
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
