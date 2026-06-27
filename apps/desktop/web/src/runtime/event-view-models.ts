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
  agent_plan_started: "Agent planning",
  agent_plan_created: "Agent plan",
  agent_step_started: "Agent step",
  agent_step_completed: "Agent step completed",
  agent_observation_created: "Agent observation",
  agent_report_created: "Agent report",
  agent_step_failed: "Agent step failed",
  mcp_connection_started: "MCP connection",
  mcp_connected: "MCP connected",
  mcp_discovery_started: "MCP discovery",
  mcp_discovery_completed: "MCP discovery",
  mcp_read_started: "MCP read",
  mcp_read_completed: "MCP read",
  mcp_tool_blocked: "MCP blocked",
  mcp_connection_failed: "MCP failed",
  mcp_disconnected: "MCP disconnected",
  mcp_fallback_to_mock: "Runtime fallback",
  provider_request_started: "Provider request",
  provider_stream_started: "Provider stream",
  provider_stream_delta: "Provider stream",
  provider_stream_completed: "Provider stream completed",
  provider_request_completed: "Provider completed",
  provider_request_failed: "Provider failed",
  provider_request_cancelled: "Provider cancelled",
  provider_usage_recorded: "Provider usage",
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
  agent_plan_started: "agent-plan",
  agent_plan_created: "agent-plan",
  agent_step_started: "tool-event",
  agent_step_completed: "tool-event",
  agent_observation_created: "tool-event",
  agent_report_created: "review-summary",
  agent_step_failed: "review-summary",
  mcp_connection_started: "tool-event",
  mcp_connected: "tool-event",
  mcp_discovery_started: "tool-event",
  mcp_discovery_completed: "tool-event",
  mcp_read_started: "tool-event",
  mcp_read_completed: "tool-event",
  mcp_tool_blocked: "tool-event",
  mcp_connection_failed: "review-summary",
  mcp_disconnected: "review-summary",
  mcp_fallback_to_mock: "tool-event",
  provider_request_started: "tool-event",
  provider_stream_started: "tool-event",
  provider_stream_delta: "tool-event",
  provider_stream_completed: "tool-event",
  provider_request_completed: "review-summary",
  provider_request_failed: "review-summary",
  provider_request_cancelled: "review-summary",
  provider_usage_recorded: "tool-event",
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
    (event) =>
      event.type === "review_created" ||
      event.type === "agent_report_created" ||
      event.type === "task_completed",
  );
}

export function extractRuntimeDiagnostics(events: TaskEvent[]): TaskEvent[] {
  return events.filter(
    (event) =>
      event.level === "warning" ||
      event.level === "error" ||
      event.type === "task_failed" ||
      event.type === "task_cancelled" ||
      event.type === "agent_step_failed" ||
      event.type === "provider_request_failed" ||
      event.type === "provider_request_cancelled" ||
      event.type === "mcp_tool_blocked" ||
      event.type === "mcp_connection_failed" ||
      event.type === "mcp_disconnected",
  );
}

export function extractProviderStreamText(events: TaskEvent[]): string {
  return events
    .filter((event) => event.type === "provider_stream_delta")
    .map((event) => event.body ?? "")
    .join("");
}

export function extractRuntimeEvidence(events: TaskEvent[]): TaskEvent[] {
  return events.filter(
    (event) =>
      event.type === "evidence_created" ||
      event.type === "agent_observation_created" ||
      event.type === "mcp_read_completed" ||
      event.type === "provider_stream_delta" ||
      event.type === "provider_usage_recorded",
  );
}
