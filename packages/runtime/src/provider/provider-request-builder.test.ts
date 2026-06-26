import { describe, expect, it } from "vitest";
import type { AgentPlan, TaskDraft } from "@uagent/shared";
import type { PromptEnvelope } from "../prompt/prompt-builder.js";
import { buildProviderRuntimeRequest } from "./provider-request-builder.js";

const draft: TaskDraft = {
  input: "检查当前选择",
  projectId: "lyra",
  permissionMode: "request_approval",
  modelId: "not-configured",
  reasoningEffort: "medium",
  runMode: "local",
  branch: "main",
  contextPercent: 12,
};

const plan: AgentPlan = {
  id: "agent-plan-task-0001",
  taskId: "task-0001",
  goal: "检查当前选择",
  state: "planning",
  steps: [],
  createdAt: 1_000,
  updatedAt: 1_000,
  metadata: { planner: "deterministic", runtimeMode: "mcp-readonly" },
};

const envelope: PromptEnvelope = {
  system: "system boundary",
  developer: "developer boundary",
  context: ["context line 1", "context line 2"],
  user: draft.input,
  constraints: ["no real provider", "no secrets"],
  toolPolicy: ["resources/read only"],
  metadata: {
    modelId: draft.modelId,
    reasoningEffort: draft.reasoningEffort,
    providerId: "mock-streaming",
    providerModelId: "mock-model",
  },
};

describe("buildProviderRuntimeRequest", () => {
  it("maps PromptEnvelope into deterministic provider messages and metadata", () => {
    const request = buildProviderRuntimeRequest({
      envelope,
      taskId: "task-0001",
      planId: plan.id,
      traceId: "trace-0001",
      idFactory: () => "provider-request-fixed",
    });

    expect(request).toMatchObject({
      id: "provider-request-fixed",
      providerId: "mock-streaming",
      modelId: "mock-model",
      temperature: 0,
      maxOutputTokens: 1024,
      metadata: { taskId: "task-0001", planId: plan.id, traceId: "trace-0001" },
    });
    expect(request.messages.map((message) => message.role)).toEqual(["system", "developer", "user"]);
    expect(request.messages[2].content).toContain("检查当前选择");
    expect(request.messages[2].content).toContain("resources/read only");
  });

  it("uses stable default ids when no idFactory is supplied", () => {
    const request = buildProviderRuntimeRequest({
      envelope,
      taskId: "task-0002",
      planId: "agent-plan-task-0002",
    });

    expect(request.id).toBe("provider-request-task-0002-agent-plan-task-0002");
    expect(request.metadata?.traceId).toBeUndefined();
  });
});
