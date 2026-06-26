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
});
