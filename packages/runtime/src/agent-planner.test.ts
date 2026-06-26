import { describe, expect, it } from "vitest";
import type { McpDiscoverySnapshot, TaskDraft } from "@uagent/shared";
import { DeterministicPlanner } from "./agent-planner.js";

const baseDraft: TaskDraft = {
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

const discovery: McpDiscoverySnapshot = {
  tools: [{ name: "ue.selection.get", description: "Read current editor selection" }],
  resources: [{ uri: "ue://selection/current", name: "Current selection" }],
  prompts: [],
  capabilitySummary: {
    tools: 1,
    resources: 1,
    prompts: 0,
    readOnlyTools: 1,
    blockedTools: 0,
  },
  discoveredAt: 1_000,
};

describe("DeterministicPlanner", () => {
  it("creates a stable read-context plan for current selection intent with discovered MCP", () => {
    const planner = new DeterministicPlanner({ clock: () => 2_000 });

    const plan = planner.createPlan({
      taskId: "task-0001",
      draft: baseDraft,
      runtimeMode: "mcp-readonly",
      discovery,
    });

    expect(plan.id).toBe("agent-plan-task-0001");
    expect(plan.metadata?.planner).toBe("deterministic");
    expect(plan.metadata?.runtimeMode).toBe("mcp-readonly");
    expect(plan.steps.map((step) => step.kind)).toEqual([
      "analyze_intent",
      "select_capability",
      "read_context",
      "record_evidence",
      "report",
    ]);
    expect(plan.steps[2]).toMatchObject({
      target: { type: "mcp_resource", uri: "ue://selection/current" },
      action: { type: "read_resource", resourceUri: "ue://selection/current" },
    });
  });

  it("creates a blocked policy step for mutating write intent", () => {
    const planner = new DeterministicPlanner({ clock: () => 2_000 });

    const plan = planner.createPlan({
      taskId: "task-0002",
      draft: { ...baseDraft, input: "delete current selection" },
      runtimeMode: "mcp-readonly",
      discovery,
    });

    expect(plan.steps.map((step) => step.kind)).toEqual([
      "analyze_intent",
      "policy_review",
      "record_evidence",
      "report",
    ]);
    expect(plan.steps[1]).toMatchObject({
      status: "blocked",
      action: {
        type: "blocked",
        reason: "Mutating intent is outside MVP3 read-only boundaries.",
        riskLevel: "blocked",
      },
    });
  });

  it("creates a mock observation plan when discovery is unavailable", () => {
    const planner = new DeterministicPlanner({ clock: () => 2_000 });

    const plan = planner.createPlan({
      taskId: "task-0003",
      draft: baseDraft,
      runtimeMode: "mock",
      discovery: null,
    });

    expect(plan.metadata).toMatchObject({
      runtimeMode: "mock",
      discoveryRequired: true,
    });
    expect(plan.steps[2]).toMatchObject({
      kind: "read_context",
      target: { type: "mock_runtime" },
      action: { type: "mock_observation" },
    });
  });

  it("creates the same testable structure for the same input", () => {
    const planner = new DeterministicPlanner({ clock: () => 2_000 });
    const input = {
      taskId: "task-0004",
      draft: baseDraft,
      runtimeMode: "mcp-readonly" as const,
      discovery,
    };

    const first = planner.createPlan(input);
    const second = planner.createPlan(input);

    expect(second).toEqual(first);
  });
});
