import {
  type SessionSummary,
  type TaskHistoryEntry,
  type ReplayCursor,
  type ReplaySummary,
} from "@uagent/shared";
import {
  type TaskEvent,
  type TaskState,
  type TaskEventType,
  isTerminalTaskState,
  redactPathForUi,
} from "@uagent/shared";
import { redactString } from "./secrets/redaction.js";

export interface TaskHistoryFilter {
  taskId?: string;
  eventType?: string;
  riskLevel?: string;
  terminalState?: string;
  providerMode?: string;
}

export interface ReplayResult {
  cursor: ReplayCursor;
  summary: ReplaySummary;
  events: TaskEvent[];
}

export interface SessionHistoryEngine {
  recordTaskCompletion(
    taskId: string,
    state: TaskState,
    title: string,
    providerMode: string,
  ): void;
  recordProjectEvent(
    taskId: string,
    eventType: string,
    title: string,
    projectId: string,
  ): void;
  recordCapabilityEvent(
    taskId: string,
    eventType: string,
    title: string,
    capabilityKind: string,
    status: string,
    payload?: unknown,
  ): void;
  getSessionSummary(): SessionSummary;
  getTaskHistory(filter: TaskHistoryFilter): TaskHistoryEntry[];
  replayTask(taskId: string, cursor?: Partial<ReplayCursor>): ReplayResult;
  getReplaySummary(taskId: string): ReplaySummary;
}

interface EventRecord {
  kind: "task" | "project" | "capability";
  taskId: string;
  state?: TaskState;
  eventType?: string;
  title: string;
  providerMode?: string;
  projectId?: string;
  capabilityKind?: string;
  status?: string;
  createdAt: number;
  hasSecrets: boolean;
  payload?: unknown;
}

function redactSessionText(text: string): { text: string; redacted: boolean } {
  const secretRedacted = redactString(text);
  const pathRedacted = secretRedacted
    .replace(/[A-Za-z]:\/Users\/[^/\s]+(?:\/[^\s]+)*/g, (path) => redactPathForUi(path))
    .replace(/\/Users\/[^/\s]+(?:\/[^\s]+)*/g, (path) => redactPathForUi(path))
    .replace(/\/home\/[^/\s]+(?:\/[^\s]+)*/g, (path) => redactPathForUi(path));
  return {
    text: pathRedacted,
    redacted: pathRedacted !== text,
  };
}

function computeReplaySummary(
  records: EventRecord[],
  taskId: string,
  cursor?: Partial<ReplayCursor>,
): ReplaySummary {
  const sessionId = cursor?.sessionId ?? "session-default";
  const matchingRecords = records.filter((r) => r.taskId === taskId);
  const targetRecord = matchingRecords[matchingRecords.length - 1];

  if (!targetRecord) {
    return {
      sessionId,
      taskId,
      eventCount: 0,
      terminalState: null,
      filteredCount: 0,
      redacted: false,
    };
  }

  const hasSecrets = matchingRecords.some((record) => record.hasSecrets);
  const terminalState =
    targetRecord.kind === "task" && targetRecord.state && isTerminalTaskState(targetRecord.state)
      ? targetRecord.state
      : null;

  const filter = cursor?.filter;
  let filteredCount = matchingRecords.length;

  if (filter) {
    filteredCount = matchingRecords.filter((r) => {
      if (filter.taskId && r.taskId !== filter.taskId) return false;
      if (r.kind === "task" && filter.terminalStates.length > 0 && r.state && !filter.terminalStates.includes(r.state))
        return false;
      if (r.kind === "task" && filter.providerModes.length > 0 && r.providerMode && !filter.providerModes.includes(r.providerMode))
        return false;
      return true;
    }).length;
  }

  return {
    sessionId,
    taskId,
    eventCount: matchingRecords.length,
    terminalState,
    filteredCount,
    redacted: hasSecrets,
  };
}

export function createSessionHistory(clock?: () => number): SessionHistoryEngine {
  const now = clock ?? Date.now;
  const tasks: EventRecord[] = [];

  return {
    recordTaskCompletion(
      taskId: string,
      state: TaskState,
      title: string,
      providerMode: string,
    ): void {
      const redactedTitle = redactSessionText(title);
      tasks.push({
        kind: "task",
        taskId,
        state,
        title: redactedTitle.text,
        providerMode,
        createdAt: now(),
        hasSecrets: redactedTitle.redacted,
      });
    },

    recordProjectEvent(
      taskId: string,
      eventType: string,
      title: string,
      projectId: string,
    ): void {
      const redactedTitle = redactSessionText(title);
      tasks.push({
        kind: "project",
        taskId,
        eventType,
        title: redactedTitle.text,
        projectId,
        createdAt: now(),
        hasSecrets: redactedTitle.redacted,
      });
    },

    recordCapabilityEvent(
      taskId: string,
      eventType: string,
      title: string,
      capabilityKind: string,
      status: string,
      payload?: unknown,
    ): void {
      const redactedTitle = redactSessionText(title);
      tasks.push({
        kind: "capability",
        taskId,
        eventType,
        title: redactedTitle.text,
        capabilityKind,
        status,
        createdAt: now(),
        hasSecrets: redactedTitle.redacted,
        payload,
      });
    },

    getSessionSummary(): SessionSummary {
      const terminalStates: Record<string, number> = {};
      const riskSummary: Record<string, number> = {};
      const providerModes = new Set<string>();
      const approvalCount = 0;
      const changeSetCount = 0;

      for (const task of tasks) {
        if (task.kind !== "task") continue;
        if (task.state) terminalStates[task.state] = (terminalStates[task.state] ?? 0) + 1;
        if (task.providerMode) providerModes.add(task.providerMode);
      }

      const lastActivityAt =
        tasks.length > 0 ? tasks[tasks.length - 1].createdAt : now();
      const createdAt =
        tasks.length > 0 ? tasks[0].createdAt : now();

      return {
        id: "session-default",
        label: "Default Session",
        taskCount: tasks.length,
        terminalStates,
        lastActivityAt,
        riskSummary,
        providerModes: Array.from(providerModes),
        approvalCount,
        changeSetCount,
        createdAt,
        archivedAt: null,
      };
    },

    getTaskHistory(filter: TaskHistoryFilter): TaskHistoryEntry[] {
      return tasks
        .filter((t) => t.kind === "task")
        .filter((t) => {
          if (filter.taskId && t.taskId !== filter.taskId) return false;
          if (filter.terminalState && t.state !== filter.terminalState) return false;
          if (filter.providerMode && t.providerMode !== filter.providerMode) return false;
          return true;
        })
        .map((t) => ({
          taskId: t.taskId,
          title: t.title,
          state: t.state!,
          providerMode: t.providerMode!,
          approvalCount: 0,
          changeSetCount: 0,
          createdAt: t.createdAt,
          completedAt: t.state && isTerminalTaskState(t.state) ? t.createdAt : null,
        }));
    },

    replayTask(taskId: string, cursor?: Partial<ReplayCursor>): ReplayResult {
      const fullCursor: ReplayCursor = {
        sessionId: cursor?.sessionId ?? "session-default",
        taskId,
        fromEventIndex: cursor?.fromEventIndex ?? 0,
        toEventIndex: cursor?.toEventIndex ?? null,
        filter: cursor?.filter ?? null,
      };

      const summary = computeReplaySummary(tasks, taskId, fullCursor);

      const matchingRecords = tasks.filter((r) => r.taskId === taskId);
      const events: TaskEvent[] = matchingRecords.map((r, i) => ({
        id: `replay-${r.taskId}-${i}`,
        taskId: r.taskId,
        type: r.kind === "task"
          ? (r.state === "completed"
              ? "task_completed"
              : r.state === "failed"
                ? "task_failed"
                : r.state === "cancelled"
                  ? "task_cancelled"
                  : "task_submitted") as TaskEventType
          : (r.eventType ?? "task_submitted") as TaskEventType,
        title: r.title,
        createdAt: r.createdAt,
        payload: {
          replayOnly: true,
          ...(r.projectId ? { projectId: r.projectId } : {}),
          ...(r.capabilityKind ? { capabilityKind: r.capabilityKind } : {}),
          ...(r.status ? { status: r.status } : {}),
          ...(r.providerMode ? { providerMode: r.providerMode } : {}),
          ...(r.payload ? { ...(r.payload as Record<string, unknown>) } : {}),
        },
      }));

      return {
        cursor: fullCursor,
        summary,
        events,
      };
    },

    getReplaySummary(taskId: string): ReplaySummary {
      return computeReplaySummary(tasks, taskId);
    },
  };
}
