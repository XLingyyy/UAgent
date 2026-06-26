import type { TaskEvent } from "@uagent/shared";
import type { WorkspaceMessage, WorkspaceMessageKind } from "../workspace/workspace-data";

const EVENT_LABELS: Record<TaskEvent["type"], string> = {
  task_submitted: "User request",
  plan_created: "Agent plan",
  tool_started: "Tool event",
  tool_completed: "Tool completed",
  approval_requested: "Approval request",
  evidence_created: "Evidence created",
  review_created: "Review summary",
  task_completed: "Task completed",
  task_failed: "Task failed",
  cancel_task_requested: "Cancel requested",
  task_cancelled: "Task cancelled",
};

const EVENT_KIND: Record<TaskEvent["type"], WorkspaceMessageKind> = {
  task_submitted: "user-request",
  plan_created: "agent-plan",
  tool_started: "tool-event",
  tool_completed: "tool-event",
  approval_requested: "tool-event",
  evidence_created: "tool-event",
  review_created: "review-summary",
  task_completed: "review-summary",
  task_failed: "review-summary",
  cancel_task_requested: "tool-event",
  task_cancelled: "review-summary",
};

function formatTimestamp(createdAt: number): string {
  const minutes = Math.floor(createdAt / 60)
    .toString()
    .padStart(2, "0");
  const seconds = (createdAt % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function mapTaskEventToWorkspaceMessage(event: TaskEvent): WorkspaceMessage {
  return {
    id: event.id,
    kind: EVENT_KIND[event.type],
    label: EVENT_LABELS[event.type],
    title: event.title,
    body: event.body ?? "",
    meta: `Runtime event: ${event.type}`,
    timestamp: formatTimestamp(event.createdAt),
  };
}

export function extractRuntimeReview(events: TaskEvent[]): TaskEvent[] {
  return events.filter(
    (event) => event.type === "review_created" || event.type === "task_completed",
  );
}

export function extractRuntimeDiagnostics(events: TaskEvent[]): TaskEvent[] {
  return events.filter(
    (event) =>
      event.level === "warning" ||
      event.level === "error" ||
      event.type === "task_failed" ||
      event.type === "task_cancelled",
  );
}

export function extractRuntimeEvidence(events: TaskEvent[]): TaskEvent[] {
  return events.filter((event) => event.type === "evidence_created");
}
