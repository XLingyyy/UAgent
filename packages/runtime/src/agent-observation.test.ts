import { describe, expect, it } from "vitest";
import type { AgentPlanStep } from "@uagent/shared";
import { createEvidenceFromObservation, normalizeObservation } from "./agent-observation.js";

const step: AgentPlanStep = {
  id: "step-read",
  kind: "read_context",
  title: "Read current selection",
  description: "Read current selection through MCP.",
  status: "pending",
};

describe("Agent observation collector", () => {
  it("normalizes MCP resource payloads into bounded summaries", () => {
    const observation = normalizeObservation({
      taskId: "task-0001",
      step,
      source: "mcp-readonly",
      result: {
        uri: "ue://selection/current",
        mimeType: "text/plain",
        text: "StaticMeshActor_1",
        raw: { count: 1 },
      },
      createdAt: 2_000,
      sequence: 1,
    });

    expect(observation).toMatchObject({
      id: "observation-0001",
      source: "mcp-readonly",
      summary: "StaticMeshActor_1",
      payload: {
        uri: "ue://selection/current",
        mimeType: "text/plain",
        text: "StaticMeshActor_1",
        raw: { count: 1 },
      },
    });
  });

  it("normalizes policy blocks without claiming execution", () => {
    const observation = normalizeObservation({
      taskId: "task-0001",
      step,
      source: "policy",
      result: {
        toolName: "ue.asset.delete",
        riskLevel: "blocked",
        reason: "Mutating intent is outside MVP3.",
      },
      createdAt: 2_000,
      sequence: 2,
    });

    expect(observation.summary).toContain("Mutating intent is outside MVP3.");
    expect(observation.payload).toMatchObject({
      toolName: "ue.asset.delete",
      riskLevel: "blocked",
    });
  });

  it("creates evidence records from observations", () => {
    const observation = normalizeObservation({
      taskId: "task-0001",
      step,
      source: "mock-runtime",
      result: { text: "Mock observation for UI regression." },
      createdAt: 2_000,
      sequence: 3,
    });

    const evidence = createEvidenceFromObservation(observation, 4);

    expect(evidence).toEqual({
      id: "evidence-0004",
      taskId: "task-0001",
      kind: "tool_result",
      title: "Agent observation evidence",
      summary: "Mock observation for UI regression.",
      source: "mock-runtime",
      createdAt: 2_000,
      payload: {
        observationId: "observation-0003",
        stepId: "step-read",
        payload: { text: "Mock observation for UI regression." },
      },
    });
  });

  it("truncates long summaries", () => {
    const observation = normalizeObservation({
      taskId: "task-0001",
      step,
      source: "mcp-readonly",
      result: { text: "x".repeat(400) },
      createdAt: 2_000,
      sequence: 5,
    });

    expect(observation.summary).toHaveLength(240);
  });
});
