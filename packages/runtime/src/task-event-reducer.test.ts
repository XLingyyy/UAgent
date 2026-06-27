import { describe, expect, it } from "vitest";
import type { AgentPlan, AgentPlanStep, TaskDraft, TaskEvent } from "@uagent/shared";
import { createEventId } from "@uagent/shared";
import { reduceTaskEvents } from "./task-event-reducer.js";

const draft: TaskDraft = {
  input: "Review current selection",
  projectId: null,
  permissionMode: "request_approval",
  modelId: "not-configured",
  reasoningEffort: "medium",
  runMode: "local",
  branch: "main",
  contextPercent: 12,
  providerStatus: "not_configured",
  createdAt: 1_000,
};

const step: AgentPlanStep = {
  id: "step-read",
  kind: "read_context",
  title: "Read current selection",
  description: "Read current selection through a guarded read-only action.",
  status: "pending",
};

const plan: AgentPlan = {
  id: "agent-plan-task-0001",
  taskId: "task-0001",
  goal: "Review current selection",
  state: "planning",
  steps: [step],
  createdAt: 1_002,
  updatedAt: 1_002,
  metadata: {
    planner: "deterministic",
    runtimeMode: "mcp-readonly",
  },
};

function event(sequence: number, type: TaskEvent["type"], payload?: unknown): TaskEvent {
  return {
    id: createEventId("task-0001", sequence),
    taskId: "task-0001",
    type,
    title: type,
    body: type,
    level: type.includes("failed") ? "error" : "info",
    createdAt: 1_000 + sequence,
    payload,
  };
}

describe("MVP3 Agent TaskEvent reducer", () => {
  it("maps normal Agent event flow into planning, executing, observing, reviewing, and completed states", () => {
    const snapshot = reduceTaskEvents([
      event(1, "task_submitted", { draft }),
      event(2, "agent_plan_started", { draft }),
      event(3, "agent_plan_created", { plan }),
      event(4, "agent_step_started", { step }),
      event(5, "agent_observation_created", {
        observation: {
          id: "observation-0001",
          taskId: "task-0001",
          stepId: step.id,
          source: "mcp-readonly",
          summary: "Read current selection.",
          createdAt: 1_005,
        },
      }),
      event(6, "agent_step_completed", { step: { ...step, status: "completed" } }),
      event(7, "agent_report_created", {
        report: {
          id: "agent-report-task-0001",
          taskId: "task-0001",
          planId: plan.id,
          summary: "read-only completed",
          findings: ["Read-only context collected."],
          evidenceRefs: [],
          blockedActions: [],
          nextSteps: [],
          createdAt: 1_007,
        },
      }),
      event(8, "task_completed"),
    ]);

    expect(snapshot.tasksById["task-0001"].state).toBe("completed");
    expect(snapshot.status).toBe("completed");
    expect(snapshot.eventsByTaskId["task-0001"].map((item) => item.type)).toContain(
      "agent_observation_created",
    );
  });

  it("preserves terminal state when a late non-terminal Agent event arrives", () => {
    const snapshot = reduceTaskEvents([
      event(1, "task_submitted", { draft }),
      event(2, "agent_plan_started", { draft }),
      event(3, "task_cancelled"),
      event(4, "agent_step_completed", { step: { ...step, status: "completed" } }),
    ]);

    expect(snapshot.tasksById["task-0001"].state).toBe("cancelled");
    expect(snapshot.status).toBe("ready");
    expect(snapshot.eventsByTaskId["task-0001"].map((item) => item.type)).toEqual([
      "task_submitted",
      "agent_plan_started",
      "task_cancelled",
    ]);
  });

  describe("MVP4 P1 provider event state mapping", () => {
    it("keeps state executing after each provider event type without reverting to submitted", () => {
      const providerEvents: TaskEvent["type"][] = [
        "provider_request_started",
        "provider_stream_started",
        "provider_stream_delta",
        "provider_stream_completed",
        "provider_usage_recorded",
        "provider_request_completed",
        "provider_request_failed",
        "provider_request_cancelled",
      ];
      const events: TaskEvent[] = [
        event(1, "task_submitted", { draft }),
        event(2, "agent_plan_started", { draft }),
      ];
      providerEvents.forEach((type, i) => {
        events.push(event(3 + i, type));
      });
      events.push(event(11, "task_completed"));

      const snapshot = reduceTaskEvents(events);

      expect(snapshot.tasksById["task-0001"].state).toBe("completed");
      expect(snapshot.status).toBe("completed");
      expect(snapshot.tasksById["task-0001"].draft).toBe(draft);
      const types = snapshot.eventsByTaskId["task-0001"].map((e) => e.type);
      expect(types).toEqual([
        "task_submitted",
        "agent_plan_started",
        ...providerEvents,
        "task_completed",
      ]);
    });

    it("provider_request_failed does not set task to failed or clear draft", () => {
      const snapshot = reduceTaskEvents([
        event(1, "task_submitted", { draft }),
        event(2, "agent_plan_started", { draft }),
        event(3, "provider_request_failed"),
      ]);

      expect(snapshot.tasksById["task-0001"].state).toBe("executing");
      expect(snapshot.status).toBe("running");
      expect(snapshot.tasksById["task-0001"].draft).toBe(draft);
      expect(snapshot.lastError).toBeNull();
    });

    it("provider_request_cancelled keeps executing; only explicit task_cancelled transitions to cancelled", () => {
      const snapshot = reduceTaskEvents([
        event(1, "task_submitted", { draft }),
        event(2, "agent_plan_started", { draft }),
        event(3, "provider_request_cancelled"),
        event(4, "task_cancelled"),
      ]);

      expect(snapshot.tasksById["task-0001"].state).toBe("cancelled");
      expect(snapshot.status).toBe("ready");
      const types = snapshot.eventsByTaskId["task-0001"].map((e) => e.type);
      expect(types).toEqual([
        "task_submitted",
        "agent_plan_started",
        "provider_request_cancelled",
        "task_cancelled",
      ]);
    });
  });

  it("maps failed Agent steps to executing state; only task_failed produces terminal failed state", () => {
    const snapshot = reduceTaskEvents([
      event(1, "task_submitted", { draft }),
      event(2, "agent_plan_started", { draft }),
      event(3, "agent_step_started", { step }),
      event(4, "agent_step_failed", { step, error: "mock observer failed" }),
      event(5, "agent_report_created", {
        report: {
          id: "agent-report-task-0001",
          taskId: "task-0001",
          planId: "agent-plan-task-0001",
          summary: "failed: mock observer failed",
          findings: ["Agent loop stopped before producing an observation."],
          evidenceRefs: [],
          blockedActions: [],
          nextSteps: [],
          createdAt: 1_005,
        },
      }),
      event(6, "review_created", { report: {} }),
      event(7, "task_failed", { reason: "mock observer failed" }),
    ]);

    expect(snapshot.tasksById["task-0001"].state).toBe("failed");
    expect(snapshot.lastError).toBe("task_failed");
    expect(snapshot.eventsByTaskId["task-0001"].map((item) => item.type)).toEqual([
      "task_submitted",
      "agent_plan_started",
      "agent_step_started",
      "agent_step_failed",
      "agent_report_created",
      "review_created",
      "task_failed",
    ]);
  });
});
