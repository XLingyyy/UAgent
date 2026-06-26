import { describe, expect, it } from "vitest";
import type { AgentObservation, AgentPlan } from "@uagent/shared";
import { createAgentReport } from "./agent-report.js";

const plan: AgentPlan = {
  id: "agent-plan-task-0001",
  taskId: "task-0001",
  goal: "Review current selection",
  state: "planning",
  steps: [
    {
      id: "step-read",
      kind: "read_context",
      title: "Read current selection",
      description: "Read current selection.",
      status: "completed",
    },
  ],
  createdAt: 1_000,
  updatedAt: 1_000,
  metadata: {
    planner: "deterministic",
    runtimeMode: "mcp-readonly",
  },
};

const observation: AgentObservation = {
  id: "observation-0001",
  taskId: "task-0001",
  stepId: "step-read",
  source: "mcp-readonly",
  summary: "StaticMeshActor_1",
  payload: { text: "StaticMeshActor_1" },
  createdAt: 1_001,
};

describe("createAgentReport", () => {
  it("creates a deterministic read-only completion report", () => {
    const report = createAgentReport({
      plan,
      observations: [observation],
      evidenceRefs: ["evidence-0001"],
      blockedActions: [],
      errors: [],
      createdAt: 2_000,
    });

    expect(report).toEqual({
      id: "agent-report-task-0001",
      taskId: "task-0001",
      planId: "agent-plan-task-0001",
      summary: "read-only completed: Agent loop finished without write actions.",
      findings: ["StaticMeshActor_1"],
      evidenceRefs: ["evidence-0001"],
      blockedActions: [],
      nextSteps: ["Review the evidence before requesting any follow-up action."],
      createdAt: 2_000,
    });
  });

  it("explains blocked mutating actions without claiming execution", () => {
    const report = createAgentReport({
      plan,
      observations: [],
      evidenceRefs: ["evidence-0002"],
      blockedActions: [
        {
          stepId: "step-blocked",
          toolName: "ue.asset.delete",
          reason: "Mutating intent is outside MVP3 read-only boundaries.",
          riskLevel: "blocked",
        },
      ],
      errors: [],
      createdAt: 2_000,
    });

    expect(report.summary).toBe("blocked mutating action: no write action was executed.");
    expect(report.blockedActions[0].toolName).toBe("ue.asset.delete");
    expect(report.nextSteps[0]).toContain("future write-capable workflow");
    expect(report.summary).not.toMatch(/saved|compiled|fixed|deleted/i);
  });

  it("creates failed reports with the failure reason", () => {
    const report = createAgentReport({
      plan,
      observations: [],
      evidenceRefs: [],
      blockedActions: [],
      errors: ["mock observer failed"],
      createdAt: 2_000,
    });

    expect(report.summary).toBe("failed: mock observer failed");
    expect(report.findings).toEqual(["Agent loop stopped before producing an observation."]);
  });
});
