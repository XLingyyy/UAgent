import { describe, expect, it } from "vitest";
import type { AgentPlanStep, McpDiscoverySnapshot } from "@uagent/shared";
import { selectAction } from "./agent-action-selector.js";

const discovery: McpDiscoverySnapshot = {
  tools: [
    { name: "ue.selection.get", description: "Read current editor selection" },
    { name: "ue.asset.delete", description: "Delete an asset" },
    { name: "ue.selection.inspect", description: "Inspect selection" },
    { name: "ue.mystery.execute", description: "Unknown capability" },
  ],
  resources: [{ uri: "ue://selection/current", name: "Current selection" }],
  prompts: [],
  capabilitySummary: {
    tools: 4,
    resources: 1,
    prompts: 0,
    readOnlyTools: 2,
    blockedTools: 1,
  },
  discoveredAt: 1_000,
};

function step(action: AgentPlanStep["action"], target?: AgentPlanStep["target"]): AgentPlanStep {
  return {
    id: "step-read",
    kind: "read_context",
    title: "Read context",
    description: "Select a safe read-only action.",
    status: "pending",
    target,
    action,
  };
}

describe("selectAction", () => {
  it("prefers matching resources over tools", () => {
    const action = selectAction(
      step(
        { type: "call_readonly_tool", toolName: "ue.selection.get" },
        { type: "mcp_resource", uri: "ue://selection/current" },
      ),
      { discovery },
    );

    expect(action).toEqual({
      type: "read_resource",
      stepId: "step-read",
      resourceUri: "ue://selection/current",
      title: "Current selection",
    });
  });

  it("allows only locally classified read-only tools", () => {
    const action = selectAction(step({ type: "call_readonly_tool", toolName: "ue.selection.get" }), {
      discovery: { ...discovery, resources: [] },
    });

    expect(action).toMatchObject({
      type: "call_readonly_tool",
      stepId: "step-read",
      toolName: "ue.selection.get",
      args: {},
    });
  });

  it("blocks mutating tools instead of returning a tool call action", () => {
    const action = selectAction(step({ type: "call_readonly_tool", toolName: "ue.asset.delete" }), {
      discovery: { ...discovery, resources: [] },
    });

    expect(action).toMatchObject({
      type: "blocked",
      stepId: "step-read",
      toolName: "ue.asset.delete",
      riskLevel: "blocked",
    });
  });

  it("blocks unknown tools instead of upgrading them to read-only", () => {
    const action = selectAction(step({ type: "call_readonly_tool", toolName: "ue.mystery.execute" }), {
      discovery: { ...discovery, resources: [] },
    });

    expect(action).toMatchObject({
      type: "blocked",
      stepId: "step-read",
      toolName: "ue.mystery.execute",
      riskLevel: "unknown",
    });
  });

  it("returns mock observation when discovery is unavailable", () => {
    const action = selectAction(step({ type: "read_resource", resourceUri: "ue://selection/current" }), {
      discovery: null,
    });

    expect(action).toEqual({
      type: "mock_observation",
      stepId: "step-read",
      reason: "MCP discovery is unavailable; using deterministic mock observation.",
    });
  });
});
