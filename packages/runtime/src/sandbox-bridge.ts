import {
  type SandboxEvent,
  type TaskEvent,
  type TaskEventType,
  type TaskEventLevel,
} from "@uagent/shared";

const MAX_EVIDENCE_LENGTH = 4096;

function truncateOutput(text: string, maxLength: number = MAX_EVIDENCE_LENGTH): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + "\n... [redacted: output truncated]";
}

function mapSandboxTypeToTaskType(
  sandboxType: SandboxEvent["type"],
): TaskEventType {
  switch (sandboxType) {
    case "sandbox_started":
      return "sandbox_started";
    case "sandbox_completed":
      return "sandbox_completed";
    case "sandbox_failed":
      return "sandbox_failed";
    case "sandbox_blocked":
      return "sandbox_blocked";
    case "sandbox_timed_out":
      return "sandbox_timed_out";
    default:
      return "sandbox_failed";
  }
}

function sandboxLevel(taskType: TaskEventType): TaskEventLevel {
  switch (taskType) {
    case "sandbox_started":
      return "info";
    case "sandbox_completed":
      return "success";
    case "sandbox_failed":
      return "error";
    case "sandbox_blocked":
      return "warning";
    case "sandbox_timed_out":
      return "warning";
    default:
      return "info";
  }
}

export function emitSandboxEvent(
  _taskId: string,
  stepId: string | null,
  sandboxEvent: SandboxEvent,
  emit: (
    type: TaskEventType,
    title: string,
    body?: string,
    level?: TaskEventLevel,
    payload?: Record<string, unknown>,
  ) => TaskEvent,
): TaskEvent {
  const taskType = mapSandboxTypeToTaskType(sandboxEvent.type);
  const level = sandboxLevel(taskType);

  const payload: Record<string, unknown> = {
    sandboxRequestId: sandboxEvent.requestId,
  };
  if (stepId !== null) {
    payload.stepId = stepId;
  }

  let body = sandboxEvent.body;
  if (body !== undefined) {
    body = truncateOutput(body);
    payload.evidence = "redacted";
  }

  return emit(taskType, sandboxEvent.title, body, level, payload);
}
