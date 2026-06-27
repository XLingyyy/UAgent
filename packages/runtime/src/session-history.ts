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
} from "@uagent/shared";

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
  getSessionSummary(): SessionSummary;
  getTaskHistory(filter: TaskHistoryFilter): TaskHistoryEntry[];
  replayTask(taskId: string, cursor?: Partial<ReplayCursor>): ReplayResult;
  getReplaySummary(taskId: string): ReplaySummary;
}

interface TaskRecord {
  taskId: string;
  state: TaskState;
  title: string;
  providerMode: string;
  createdAt: number;
}

const SECRET_PATTERNS = [
  /api_key[=:_\s]*['"]?\w+['"]?/gi,
  /secret[=:_\s]*['"]?\w+['"]?/gi,
  /password[=:_\s]*['"]?\w+['"]?/gi,
  /token[=:_\s]*['"]?\w+['"]?/gi,
  /key[=:_\s]*['"]?\w+['"]?/gi,
];

function containsSecret(input: string): boolean {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(input)) return true;
  }
  return false;
}

function redactSecrets(input: string): string {
  let redacted = input;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match) => {
      const sepIndex = Math.max(
        match.indexOf("="),
        match.indexOf(":"),
        match.indexOf("_"),
      );
      if (sepIndex === -1) return "[REDACTED]";
      return match.slice(0, sepIndex + 1) + "[REDACTED]";
    });
  }
  return redacted;
}

function computeReplaySummary(
  records: TaskRecord[],
  taskId: string,
  cursor?: Partial<ReplayCursor>,
): ReplaySummary {
  const sessionId = cursor?.sessionId ?? "session-default";
  const taskRecords = records.filter((r) => r.taskId === taskId);
  const targetRecord = taskRecords[taskRecords.length - 1];

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

  const hasSecrets = containsSecret(targetRecord.title);
  const terminalState = isTerminalTaskState(targetRecord.state)
    ? targetRecord.state
    : null;

  const filter = cursor?.filter;
  let filteredCount = taskRecords.length;

  if (filter) {
    filteredCount = taskRecords.filter((r) => {
      if (filter.taskId && r.taskId !== filter.taskId) return false;
      if (filter.terminalStates.length > 0 && !filter.terminalStates.includes(r.state))
        return false;
      if (filter.providerModes.length > 0 && !filter.providerModes.includes(r.providerMode))
        return false;
      return true;
    }).length;
  }

  return {
    sessionId,
    taskId,
    eventCount: taskRecords.length,
    terminalState,
    filteredCount,
    redacted: hasSecrets,
  };
}

export function createSessionHistory(): SessionHistoryEngine {
  const tasks: TaskRecord[] = [];

  return {
    recordTaskCompletion(
      taskId: string,
      state: TaskState,
      title: string,
      providerMode: string,
    ): void {
      tasks.push({
        taskId,
        state,
        title,
        providerMode,
        createdAt: Date.now(),
      });
    },

    getSessionSummary(): SessionSummary {
      const terminalStates: Record<string, number> = {};
      const riskSummary: Record<string, number> = {};
      const providerModes = new Set<string>();
      const approvalCount = 0;
      const changeSetCount = 0;

      for (const task of tasks) {
        terminalStates[task.state] = (terminalStates[task.state] ?? 0) + 1;
        providerModes.add(task.providerMode);
      }

      const lastActivityAt =
        tasks.length > 0 ? tasks[tasks.length - 1].createdAt : Date.now();
      const createdAt =
        tasks.length > 0 ? tasks[0].createdAt : Date.now();

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
        .filter((t) => {
          if (filter.taskId && t.taskId !== filter.taskId) return false;
          if (filter.terminalState && t.state !== filter.terminalState) return false;
          if (filter.providerMode && t.providerMode !== filter.providerMode) return false;
          return true;
        })
        .map((t) => ({
          taskId: t.taskId,
          title: redactSecrets(t.title),
          state: t.state,
          providerMode: t.providerMode,
          approvalCount: 0,
          changeSetCount: 0,
          createdAt: t.createdAt,
          completedAt: isTerminalTaskState(t.state) ? t.createdAt : null,
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
        type: (r.state === "completed"
          ? "task_completed"
          : r.state === "failed"
            ? "task_failed"
            : r.state === "cancelled"
              ? "task_cancelled"
              : "task_submitted") as TaskEventType,
        title: r.title,
        createdAt: r.createdAt,
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
