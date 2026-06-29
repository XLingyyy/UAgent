import {
  type AuditEventType,
  type AuditActor,
  type AuditEvent,
  type AuditProjection,
} from "@uagent/shared";
import { type TaskEvent } from "@uagent/shared";
import { redactString, recursiveRedactValue } from "./secrets/redaction.js";

export interface AuditEventSummary {
  id: string;
  type: string;
  taskId: string | null;
  projectId: string | null;
  capabilityKind: string | null;
  status: string | null;
  riskLevel: string | null;
  timestamp: number;
}

export interface AuditQuery {
  taskId?: string;
  eventTypes?: AuditEventType[];
  riskLevels?: string[];
  terminalStates?: string[];
  providerModes?: string[];
  fromTick?: number;
  toTick?: number;
  projectId?: string;
  capabilityKind?: string;
  status?: string;
  riskLevel?: string;
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
  project_root_validated: "project_root_validated",
  project_index_started: "project_index_started",
  project_index_completed: "project_index_completed",
  project_index_failed: "project_index_failed",
  project_index_cancelled: "project_index_cancelled",
  file_preview_requested: "file_preview_requested",
  file_preview_blocked: "file_preview_blocked",
  file_preview_completed: "file_preview_completed",
  capability_requested: "capability_requested",
  capability_blocked: "capability_blocked",
  capability_completed: "capability_completed",
  capability_cancelled: "capability_cancelled",
  capability_timed_out: "capability_timed_out",
  terminal_proposed: "terminal_proposed",
  terminal_approved: "terminal_approved",
  terminal_rejected: "terminal_rejected",
  terminal_started: "terminal_started",
  terminal_output: "terminal_output",
  terminal_completed: "terminal_completed",
  terminal_failed: "terminal_failed",
  terminal_cancelled: "terminal_cancelled",
  terminal_blocked: "terminal_blocked",
  browser_preview_created: "browser_preview_created",
  browser_preview_blocked: "browser_preview_blocked",
  browser_preview_completed: "browser_preview_completed",
  screenshot_requested: "screenshot_requested",
  screenshot_captured: "screenshot_captured",
  screenshot_denied: "screenshot_denied",
  screenshot_failed: "screenshot_failed",
  watcher_started: "watcher_started",
  watcher_changed: "watcher_changed",
  watcher_diff_generated: "watcher_diff_generated",
  watcher_applied: "watcher_applied",
  watcher_rescanned: "watcher_rescanned",
  watcher_overflow: "watcher_overflow",
  watcher_stopped: "watcher_stopped",
  watcher_error: "watcher_error",
  diagnostic_started: "diagnostic_started",
  diagnostic_completed: "diagnostic_completed",
  diagnostic_failed: "diagnostic_failed",
  context_pack_created: "context_pack_created",
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
    const diagnosticKind = payload.diagnosticKind as string | undefined;
    const severity = payload.severity as string | undefined;
    const redactedPayload = recursiveRedactValue({
      ...(event.payload ?? {}),
      sourceEventId: event.id,
      sourceEventType: event.type,
      ...(providerMode ? { providerMode } : {}),
    }) as Record<string, unknown>;
    if (diagnosticKind) redactedPayload.diagnosticKind = diagnosticKind;
    if (severity) redactedPayload.severity = severity;
    if (providerMode) redactedPayload.providerMode = providerMode;

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
      payload: redactedPayload,
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

export function extractAuditEventSummary(event: AuditEvent): AuditEventSummary {
  const payload = event.payload as Record<string, unknown> | undefined;
  return {
    id: event.id,
    type: event.type,
    taskId: event.taskId,
    projectId: (payload?.projectId as string | undefined) ?? null,
    capabilityKind: (payload?.capabilityKind as string | undefined) ?? null,
    status: (payload?.status as string | undefined) ?? null,
    riskLevel: (payload?.riskLevel as string | undefined) ?? null,
    timestamp: event.createdAt,
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
        if (filter.projectId) {
          const payloadProjectId = (e.payload as Record<string, unknown> | undefined)
            ?.projectId as string | undefined;
          if (e.taskId !== filter.projectId && payloadProjectId !== filter.projectId) return false;
        }
        if (filter.capabilityKind) {
          const payloadCapKind = (e.payload as Record<string, unknown> | undefined)
            ?.capabilityKind as string | undefined;
          if (payloadCapKind !== filter.capabilityKind) return false;
        }
        if (filter.status) {
          const payloadStatus = (e.payload as Record<string, unknown> | undefined)
            ?.status as string | undefined;
          if (payloadStatus !== filter.status) return false;
        }
        if (filter.riskLevel) {
          const payloadRisk = (e.payload as Record<string, unknown> | undefined)
            ?.riskLevel as string | undefined;
          if (payloadRisk !== filter.riskLevel) return false;
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
