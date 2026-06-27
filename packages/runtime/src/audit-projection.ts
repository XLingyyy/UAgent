import {
  type AuditEventType,
  type AuditActor,
  type AuditEvent,
  type AuditProjection,
} from "@uagent/shared";
import { type TaskEvent } from "@uagent/shared";
import { redactString, recursiveRedactValue } from "./secrets/redaction.js";

export interface AuditQuery {
  taskId?: string;
  eventTypes?: AuditEventType[];
  riskLevels?: string[];
  terminalStates?: string[];
  providerModes?: string[];
  fromTick?: number;
  toTick?: number;
}

export interface AuditProjectionEngine {
  recordAuditEvent(event: AuditEvent): void;
  queryAuditEvents(filter: AuditQuery): AuditEvent[];
  getProjection(): AuditProjection;
  clear(): void;
}

const TASK_TO_AUDIT_MAP: Partial<Record<string, AuditEventType>> = {
  task_submitted: "task_submitted",
  task_completed: "task_completed",
  task_failed: "task_failed",
  task_cancelled: "task_cancelled",
  provider_request_started: "provider_request_started",
  provider_request_completed: "provider_request_completed",
  provider_request_failed: "provider_request_failed",
  provider_request_cancelled: "provider_request_cancelled",
  mcp_tool_blocked: "mcp_tool_blocked",
  mcp_connection_failed: "mcp_connection_failed",
  approval_required: "approval_required",
  approval_approved: "approval_approved",
  approval_denied: "approval_denied",
  approval_cancelled: "approval_cancelled",
  approval_timed_out: "approval_timed_out",
  sandbox_started: "sandbox_started",
  sandbox_completed: "sandbox_completed",
  sandbox_failed: "sandbox_failed",
  sandbox_blocked: "sandbox_blocked",
  sandbox_timed_out: "sandbox_timed_out",
  change_set_created: "change_set_created",
  change_set_previewed: "change_set_previewed",
  change_set_applied: "change_set_applied",
  change_set_promoted: "change_set_promoted",
  change_set_rolled_back: "change_set_rolled_back",
  change_set_discarded: "change_set_discarded",
  session_started: "session_started",
  session_archived: "session_archived",
};

let _eventCounter = 0;

function nextAuditId(): string {
  _eventCounter++;
  return `audit-${String(_eventCounter).padStart(6, "0")}`;
}

export function buildAuditFromTaskEvents(
  taskEvents: TaskEvent[],
  sessionId?: string,
  actor?: AuditActor,
): AuditEvent[] {
  const defaultActor: AuditActor = actor ?? {
    type: "system",
    id: "task-event-reducer",
    label: "Task Event Reducer",
  };

  const auditEvents: AuditEvent[] = [];

  for (const event of taskEvents) {
    const auditType = TASK_TO_AUDIT_MAP[event.type];
    if (!auditType) continue;

    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const providerMode = payload.providerMode as string | undefined;

    const auditEvent: AuditEvent = {
      id: nextAuditId(),
      type: auditType,
      taskId: event.taskId,
      sessionId: sessionId ?? null,
      actor: defaultActor,
      title: redactString(event.title),
      body: redactString(event.body ?? ""),
      summary: redactString(event.title),
      redacted: true,
      createdAt: event.createdAt,
      payload: recursiveRedactValue({
        ...(event.payload ?? {}),
        sourceEventId: event.id,
        sourceEventType: event.type,
        ...(providerMode ? { providerMode } : {}),
      }) as Record<string, unknown>,
    };

    auditEvents.push(auditEvent);
  }

  return auditEvents;
}

function redactAuditEvent(event: AuditEvent): AuditEvent {
  return {
    ...event,
    title: redactString(event.title),
    body: redactString(event.body),
    summary: redactString(event.summary),
    redacted: true,
    payload:
      event.payload !== undefined
        ? (recursiveRedactValue(event.payload) as Record<string, unknown>)
        : undefined,
  };
}

export function createAuditProjection(): AuditProjectionEngine {
  const events: AuditEvent[] = [];

  return {
    recordAuditEvent(event: AuditEvent): void {
      events.push(redactAuditEvent(event));
    },

    queryAuditEvents(filter: AuditQuery): AuditEvent[] {
      return events.filter((e) => {
        if (filter.taskId && e.taskId !== filter.taskId) return false;
        if (filter.eventTypes && !filter.eventTypes.includes(e.type)) return false;
        if (filter.fromTick !== undefined && e.createdAt < filter.fromTick) return false;
        if (filter.toTick !== undefined && e.createdAt > filter.toTick) return false;
        if (filter.riskLevels && filter.riskLevels.length > 0) {
          const payloadRisk = (e.payload as Record<string, unknown> | undefined)
            ?.riskLevel as string | undefined;
          if (!payloadRisk || !filter.riskLevels.includes(payloadRisk)) return false;
        }
        if (filter.terminalStates && filter.terminalStates.length > 0) {
          const payloadState = (e.payload as Record<string, unknown> | undefined)
            ?.terminalState as string | undefined;
          if (!payloadState || !filter.terminalStates.includes(payloadState)) return false;
        }
        if (filter.providerModes && filter.providerModes.length > 0) {
          const payloadMode = (e.payload as Record<string, unknown> | undefined)
            ?.providerMode as string | undefined;
          if (!payloadMode || !filter.providerModes.includes(payloadMode)) return false;
        }
        return true;
      });
    },

    getProjection(): AuditProjection {
      return {
        events: [...events],
        totalCount: events.length,
        filterSummary: null,
      };
    },

    clear(): void {
      events.length = 0;
    },
  };
}
