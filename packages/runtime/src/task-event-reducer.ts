import {
  createEmptyRuntimeSnapshot,
  createTaskTitle,
  isTerminalTaskState,
  type RuntimeSnapshot,
  type RuntimeStatus,
  type TaskDraft,
  type TaskEvent,
  type TaskRecord,
  type TaskState,
} from "@uagent/shared";

interface SubmittedPayload {
  draft: TaskDraft;
}

function stateForEvent(event: TaskEvent): TaskState {
  switch (event.type) {
    case "task_submitted":
      return "submitted";
    case "plan_created":
      return "planning";
    case "tool_started":
    case "tool_completed":
    case "evidence_created":
      return "executing";
    case "approval_requested":
      return "awaiting_approval";
    case "review_created":
      return "reviewing";
    case "task_completed":
      return "completed";
    case "task_failed":
      return "failed";
    case "cancel_task_requested":
    case "task_cancelled":
      return "cancelled";
    default:
      return "submitted";
  }
}

function statusForState(state: TaskState): RuntimeStatus {
  switch (state) {
    case "completed":
      return "completed";
    case "failed":
      return "error";
    case "awaiting_approval":
      return "waiting_for_approval";
    case "submitted":
    case "planning":
    case "executing":
    case "observing":
    case "reviewing":
      return "running";
    case "cancelled":
    case "draft":
      return "ready";
    default:
      return "ready";
  }
}

export function applyTaskEvent(snapshot: RuntimeSnapshot, event: TaskEvent): RuntimeSnapshot {
  const previousTask = snapshot.tasksById[event.taskId];
  if (
    previousTask &&
    isTerminalTaskState(previousTask.state) &&
    (event.type === "cancel_task_requested" || event.type === "task_cancelled")
  ) {
    return snapshot;
  }

  const events = [...(snapshot.eventsByTaskId[event.taskId] ?? []), event];
  const state = stateForEvent(event);
  const submittedPayload = event.payload as SubmittedPayload | undefined;
  const draft = previousTask?.draft ?? submittedPayload?.draft;

  if (!draft) {
    return {
      ...snapshot,
      activeTaskId: event.taskId,
      eventsByTaskId: {
        ...snapshot.eventsByTaskId,
        [event.taskId]: events,
      },
      lastError: event.type === "task_failed" ? (event.body ?? event.title) : snapshot.lastError,
      status: statusForState(state),
    };
  }

  const task: TaskRecord = {
    id: event.taskId,
    title: previousTask?.title ?? createTaskTitle(draft.input),
    state,
    draft,
    createdAt: previousTask?.createdAt ?? event.createdAt,
    updatedAt: event.createdAt,
    completedAt:
      state === "completed" || state === "failed" || state === "cancelled"
        ? event.createdAt
        : null,
    error: state === "failed" ? (event.body ?? event.title) : null,
  };

  return {
    status: statusForState(state),
    activeTaskId: event.taskId,
    tasksById: {
      ...snapshot.tasksById,
      [event.taskId]: task,
    },
    eventsByTaskId: {
      ...snapshot.eventsByTaskId,
      [event.taskId]: events,
    },
    lastError: state === "failed" ? (event.body ?? event.title) : snapshot.lastError,
  };
}

export function reduceTaskEvents(events: TaskEvent[]): RuntimeSnapshot {
  return events.reduce(applyTaskEvent, createEmptyRuntimeSnapshot());
}
