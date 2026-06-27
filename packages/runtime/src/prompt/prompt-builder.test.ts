import { describe, expect, it } from "vitest";
import type { AgentPlan, McpDiscoverySnapshot, TaskDraft } from "@uagent/shared";
import { buildPromptEnvelope } from "./prompt-builder.js";

const draft: TaskDraft = {
  input: "检查当前选择",
  projectId: null,
  permissionMode: "request_approval",
  modelId: "mock-provider",
  reasoningEffort: "medium",
  runMode: "local",
  branch: "main",
  contextPercent: 12,
  providerStatus: "not_configured",
  createdAt: 1_000,
};

const plan: AgentPlan = {
  id: "agent-plan-task-0001",
  taskId: "task-0001",
  goal: "检查当前选择",
  state: "planning",
  createdAt: 1_001,
  updatedAt: 1_001,
  steps: [],
  metadata: {
    planner: "deterministic",
    runtimeMode: "mcp-readonly",
  },
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
  discoveredAt: 1_002,
};

describe("buildPromptEnvelope", () => {
  it("assembles a deterministic read-only prompt envelope", () => {
    const envelope = buildPromptEnvelope({
      draft,
      plan,
      discovery,
      provider: {
        id: "mock-text",
        label: "Mock text provider",
        modelId: "mock-model",
      },
      policySummary: ["resources/read is allowed after MCP discovery."],
    });

    expect(envelope).toEqual({
      system: expect.stringContaining("UAgent Agent Core"),
      developer: expect.stringContaining("Do not call real providers"),
      context: [
        "Task: 检查当前选择",
        "Plan: 检查当前选择",
        "Runtime mode: mcp-readonly",
        "MCP discovery: 1 tools / 1 resources / 0 prompts",
        "Provider: mock-text / mock-model",
      ],
      user: "检查当前选择",
      constraints: [
        "MVP3 allows MCP resources/read and locally classified read-only tools/call only.",
        "Blocked, unknown, mutating, shell, browser, filesystem, and UE write actions must not execute.",
        "Provider output is mock-only in POST-MVP3; no API keys, environment variables, or HTTP calls are read or sent.",
      ],
      toolPolicy: [
        "resources/read is allowed after MCP discovery.",
        "Read-only MCP resources: ue://selection/current",
        "Read-only MCP tools: ue.selection.get",
        "Blocked MCP tools: none",
        "Unknown MCP tools: none",
        "Blocked and mutating MCP tools must not execute.",
        "Unknown MCP tools must not execute until explicitly classified.",
      ],
      metadata: {
        modelId: "mock-provider",
        reasoningEffort: "medium",
        providerId: "mock-text",
        providerModelId: "mock-model",
      },
    });
  });

  it("keeps mutating user intent in text while preserving the no-write policy", () => {
    const envelope = buildPromptEnvelope({
      draft: { ...draft, input: "delete current selection" },
      plan: { ...plan, goal: "delete current selection" },
      discovery,
    });

    expect(envelope.user).toBe("delete current selection");
    expect(envelope.constraints.join("\n")).toContain("UE write actions must not execute");
    expect(envelope.toolPolicy.join("\n")).toContain("Read-only MCP tools: ue.selection.get");
  });

  it("classifies read-only, blocked, and unknown discovered tools into separate policy groups", () => {
    const mixedDiscovery: McpDiscoverySnapshot = {
      tools: [
        { name: "ue.selection.get", description: "Read current editor selection" },
        { name: "ue.asset.delete", description: "Delete an asset" },
        { name: "ue.magic.optimize", description: "Unclassified capability" },
      ],
      resources: [{ uri: "ue://selection/current", name: "Current selection" }],
      prompts: [],
      capabilitySummary: {
        tools: 3,
        resources: 1,
        prompts: 0,
        readOnlyTools: 1,
        blockedTools: 1,
      },
      discoveredAt: 1_002,
    };

    const envelope = buildPromptEnvelope({
      draft,
      plan,
      discovery: mixedDiscovery,
    });
    const policyText = envelope.toolPolicy.join("\n");

    expect(envelope.toolPolicy).toContain("Read-only MCP tools: ue.selection.get");
    expect(envelope.toolPolicy).toContain("Blocked MCP tools: ue.asset.delete");
    expect(envelope.toolPolicy).toContain("Unknown MCP tools: ue.magic.optimize");
    expect(policyText).toContain("Blocked and mutating MCP tools must not execute.");
    expect(policyText).toContain("Unknown MCP tools must not execute until explicitly classified.");
    expect(policyText).not.toContain("Read-only MCP tools: ue.selection.get, ue.asset.delete");
    expect(policyText).not.toContain("Read-only MCP tools: ue.selection.get, ue.magic.optimize");
  });
});
