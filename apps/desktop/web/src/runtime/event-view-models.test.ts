import { describe, expect, it } from "vitest";
import type { TaskEvent } from "@uagent/shared";
import {
  extractRuntimeDiagnostics,
  extractRuntimeEvidence,
  extractRuntimeReview,
  mapTaskEventToWorkspaceMessage,
} from "./event-view-models";

function event(type: TaskEvent["type"], level: TaskEvent["level"] = "info"): TaskEvent {
  return {
    id: `event-${type}`,
    taskId: "task-0001",
    type,
    title: type,
    body: `${type} body`,
    level,
    createdAt: 65,
  };
}

describe("MVP3 Agent event view models", () => {
  it("maps Agent plan, step, observation, and report events to user-readable message kinds", () => {
    expect(mapTaskEventToWorkspaceMessage(event("agent_plan_created")).kind).toBe("agent-plan");
    expect(mapTaskEventToWorkspaceMessage(event("agent_step_started")).kind).toBe("tool-event");
    expect(mapTaskEventToWorkspaceMessage(event("agent_observation_created")).label).toBe(
      "Agent observation",
    );
    expect(mapTaskEventToWorkspaceMessage(event("agent_report_created")).kind).toBe(
      "review-summary",
    );
  });

  it("extracts Agent reports, evidence, and diagnostics for inspector panels", () => {
    const events = [
      event("agent_plan_created"),
      event("agent_observation_created"),
      event("agent_report_created"),
      event("agent_step_failed", "error"),
      event("task_cancelled", "warning"),
    ];

    expect(extractRuntimeReview(events).map((item) => item.type)).toEqual([
      "agent_report_created",
    ]);
    expect(extractRuntimeEvidence(events).map((item) => item.type)).toEqual([
      "agent_observation_created",
    ]);
    expect(extractRuntimeDiagnostics(events).map((item) => item.type)).toEqual([
      "agent_step_failed",
      "task_cancelled",
    ]);
  });

  it("bridges provider events into diagnostics and evidence without over-classifying success events", () => {
    const events = [
      event("provider_request_started"),
      event("provider_stream_started"),
      event("provider_stream_delta"),
      event("provider_stream_completed"),
      event("provider_usage_recorded"),
      event("provider_request_completed"),
      event("provider_request_failed", "error"),
      event("provider_request_cancelled", "warning"),
    ];

    expect(extractRuntimeDiagnostics(events).map((item) => item.type)).toEqual([
      "provider_request_failed",
      "provider_request_cancelled",
    ]);
    expect(extractRuntimeEvidence(events).map((item) => item.type)).toEqual([
      "provider_stream_delta",
      "provider_usage_recorded",
    ]);
    expect(mapTaskEventToWorkspaceMessage(event("provider_request_failed")).label).toBe("Provider failed");
    expect(mapTaskEventToWorkspaceMessage(event("provider_usage_recorded")).kind).toBe("tool-event");
  });

  it("extracts terminal_output events as evidence", () => {
    const events = [
      event("terminal_output"),
      event("terminal_completed"),
      event("terminal_proposed"),
    ];
    const evidence = extractRuntimeEvidence(events);
    expect(evidence.map((item) => item.type)).toEqual(["terminal_output"]);
  });

  it("maps task_submitted body through to workspace message without leaking raw secrets", () => {
    const redactedBody = "api_key=[REDACTED] Authorization: Bearer [REDACTED] token=[REDACTED]";
    const taskSubmitted: TaskEvent = {
      id: "event-task-submitted",
      taskId: "task-0001",
      type: "task_submitted",
      title: "User request",
      body: redactedBody,
      level: "info",
      createdAt: 65,
    };
    const message = mapTaskEventToWorkspaceMessage(taskSubmitted);
    expect(message.body).toBe(redactedBody);
    const RAW_SECRETS = [
      "sk-abcdefghijklmnopqrstuvwxyz123456",
      "abcdef1234567890abcdef1234567890",
    ];
    const serialized = JSON.stringify(message);
    for (const secret of RAW_SECRETS) {
      expect(serialized, `raw secret "${secret}" must not appear in workspace message`).not.toContain(secret);
    }
  });
});
