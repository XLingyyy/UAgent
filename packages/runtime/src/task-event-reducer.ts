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
    case "agent_plan_started":
    case "agent_plan_created":
    case "plan_created":
      return "planning";
    case "agent_step_started":
    case "agent_step_completed":
    case "tool_started":
    case "tool_completed":
    case "evidence_created":
    case "mcp_connection_started":
    case "mcp_connected":
    case "mcp_discovery_started":
    case "mcp_discovery_completed":
    case "mcp_read_started":
    case "mcp_read_completed":
    case "mcp_fallback_to_mock":
    case "provider_request_started":
    case "provider_stream_started":
    case "provider_stream_delta":
    case "provider_stream_completed":
    case "provider_usage_recorded":
    case "provider_request_completed":
    case "provider_request_failed":
    case "provider_request_cancelled":
    case "sandbox_started":
    case "sandbox_completed":
    case "sandbox_failed":
    case "sandbox_blocked":
    case "sandbox_timed_out":
    case "change_set_created":
    case "change_set_previewed":
    case "change_set_applied":
    case "change_set_promoted":
    case "change_set_rolled_back":
    case "change_set_discarded":
    case "project_root_validated":
    case "project_index_started":
    case "project_index_progress":
    case "project_index_completed":
    case "project_index_failed":
    case "project_index_cancelled":
    case "file_preview_requested":
    case "file_preview_blocked":
    case "file_preview_completed":
    case "capability_requested":
    case "capability_blocked":
    case "capability_completed":
    case "capability_cancelled":
    case "capability_timed_out":
      return "executing";
    case "agent_observation_created":
      return "observing";
    case "mcp_tool_blocked":
      return "reviewing";
    case "mcp_connection_failed":
      return "failed";
    case "mcp_disconnected":
      return "cancelled";
    case "approval_requested":
    case "approval_required":
      return "awaiting_approval";
    case "approval_approved":
      return "executing";
    case "approval_denied":
    case "approval_cancelled":
    case "approval_timed_out":
      return "reviewing";
    case "agent_report_created":
    case "review_created":
      return "reviewing";
    case "task_completed":
      return "completed";
    case "agent_step_failed":
      return "executing";
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
  const state = stateForEvent(event);
  if (
    previousTask &&
    isTerminalTaskState(previousTask.state) &&
    !(isTerminalTaskState(state) && previousTask.state === state)
  ) {
    return snapshot;
  }

  const events = [...(snapshot.eventsByTaskId[event.taskId] ?? []), event];
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
