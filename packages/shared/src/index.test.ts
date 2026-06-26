import { describe, it, expect } from "vitest";
import {
  createEventId,
  createTaskId,
  isTerminalTaskState,
  type ChatMessage,
  type Evidence,
  type EvidenceRecord,
  type PermissionMode,
  type PlanItem,
  type RuntimeClient,
  type RuntimeSnapshot,
  type TaskDraft,
  type TaskEvent,
  type TaskRecord,
  type ToolCall,
  type McpConnectionProfile,
  type McpDiscoverySnapshot,
  type ToolRiskClassification,
  type AgentObservation,
  type AgentPlan,
  type AgentPlanStep,
  type AgentReport,
  type AgentRunState,
} from "./index.js";

describe("@uagent/shared types", () => {
  it("should match ChatMessage shape", () => {
    const msg: ChatMessage = {
      id: "1",
      role: "user",
      content: "hello",
      timestamp: Date.now(),
    };
    expect(msg.role).toBe("user");
  });

  it("should match PlanItem shape", () => {
    const item: PlanItem = {
      id: "1",
      status: "pending",
      title: "test",
      description: "a test item",
      parentId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    expect(item.status).toBe("pending");
  });

  it("should match ToolCall shape", () => {
    const call: ToolCall = {
      id: "1",
      toolName: "test",
      args: {},
      status: "pending",
      startedAt: Date.now(),
      finishedAt: null,
      result: null,
      error: null,
    };
    expect(call.toolName).toBe("test");
  });

  it("should match Evidence shape", () => {
    const ev: Evidence = {
      id: "1",
      type: "log",
      source: "test",
      data: "hello",
      capturedAt: Date.now(),
    };
    expect(ev.type).toBe("log");
  });

  it("defines the MVP1 TaskDraft and TaskRecord contract", () => {
    const draft: TaskDraft = {
      input: "Review Lyra asset loading risks",
      projectId: "lyra",
      permissionMode: "request_approval",
      modelId: "not-configured",
      reasoningEffort: "medium",
      runMode: "local",
      branch: "main",
      contextPercent: 12,
      providerStatus: "not_configured",
      createdAt: 1_000,
    };
    const record: TaskRecord = {
      id: createTaskId(1),
      title: "Review Lyra asset loading risks",
      state: "submitted",
      draft,
      createdAt: 1_000,
      updatedAt: 1_000,
      completedAt: null,
      error: null,
    };

    expect(record.id).toBe("task-0001");
    expect(record.draft.providerStatus).toBe("not_configured");
    expect(isTerminalTaskState(record.state)).toBe(false);
  });

  it("defines the MVP1 TaskEvent, evidence, and runtime snapshot contract", () => {
    const planEvent: TaskEvent<{ steps: string[] }> = {
      id: createEventId("task-0001", 2),
      taskId: "task-0001",
      type: "plan_created",
      title: "Plan created",
      body: "Mock plan ready",
      level: "info",
      createdAt: 1_002,
      payload: { steps: ["Read context", "Summarize risks"] },
    };
    const evidence: EvidenceRecord = {
      id: "evidence-0001",
      taskId: "task-0001",
      kind: "project_summary",
      title: "Project context summary",
      summary: "Mock-only project summary",
      source: "mock-runtime",
      createdAt: 1_005,
    };
    const snapshot: RuntimeSnapshot = {
      status: "running",
      activeTaskId: "task-0001",
      tasksById: {},
      eventsByTaskId: {
        "task-0001": [planEvent],
      },
      lastError: null,
    };

    expect(planEvent.id).toBe("task-0001-event-0002");
    expect(evidence.source).toBe("mock-runtime");
    expect(snapshot.eventsByTaskId["task-0001"][0].type).toBe("plan_created");
  });

  it("defines the shared PermissionMode type used by TaskDraft", () => {
    const auto: PermissionMode = "auto";
    const req: PermissionMode = "request_approval";
    const plan: PermissionMode = "plan_only";
    const draft: TaskDraft = {
      input: "test",
      projectId: null,
      permissionMode: req,
      modelId: "m1",
      reasoningEffort: "medium",
      runMode: "local",
      branch: "main",
      contextPercent: 10,
    };
    expect(draft.permissionMode).toBe("request_approval");
    // verify each valid value is assignable
    const modes: PermissionMode[] = [auto, req, plan];
    expect(modes).toHaveLength(3);
  });

  it("defines a RuntimeClient boundary without exposing runtime internals", async () => {
    const snapshot: RuntimeSnapshot = {
      status: "ready",
      activeTaskId: null,
      tasksById: {},
      eventsByTaskId: {},
      lastError: null,
    };
    const client: RuntimeClient = {
      async submitTask(draft) {
        return {
          id: "task-0001",
          title: draft.input,
          state: "submitted",
          draft,
          createdAt: 1,
          updatedAt: 1,
          completedAt: null,
          error: null,
        };
      },
      async cancelTask() {},
      getSnapshot() {
        return snapshot;
      },
      subscribe() {
        return () => {};
      },
    };

    await expect(
      client.submitTask({
        input: "Mock task",
        projectId: null,
        permissionMode: "request_approval",
        modelId: "not-configured",
        reasoningEffort: "medium",
        runMode: "local",
        branch: "main",
        contextPercent: 12,
      }),
    ).resolves.toMatchObject({ id: "task-0001", title: "Mock task" });
  });

  it("defines the MVP2 MCP read-only shared contract", () => {
    const profile: McpConnectionProfile = {
      id: "local-ue",
      name: "Local Unreal MCP",
      endpoint: "http://127.0.0.1:8765/mcp",
      transport: "streamable-http",
    };
    const risk: ToolRiskClassification = {
      toolName: "resources/read",
      level: "read_only",
      reason: "MCP resource reads are the MVP2 primary read-only path.",
    };
    const discovery: McpDiscoverySnapshot = {
      tools: [{ name: "ue.selection.get", description: "Read current editor selection" }],
      resources: [{ uri: "ue://selection/current", name: "Current selection" }],
      prompts: [{ name: "summarize-selection" }],
      capabilitySummary: {
        tools: 1,
        resources: 1,
        prompts: 1,
        readOnlyTools: 1,
        blockedTools: 0,
      },
      discoveredAt: 2_000,
    };
    const event: TaskEvent = {
      id: createEventId("task-0001", 3),
      taskId: "task-0001",
      type: "mcp_discovery_completed",
      title: "MCP discovery completed",
      createdAt: 2_001,
      payload: { profile, discovery, risk },
    };

    expect(event.type).toBe("mcp_discovery_completed");
    expect(discovery.capabilitySummary.resources).toBe(1);
    expect(risk.level).toBe("read_only");
  });

  it("defines the MVP3 Agent Core shared contract", () => {
    const steps: AgentPlanStep[] = [
      {
        id: "step-analyze",
        kind: "analyze_intent",
        title: "Analyze request",
        status: "pending",
        description: "Classify the user request before selecting a capability.",
      },
      {
        id: "step-read",
        kind: "read_context",
        title: "Read current selection",
        status: "pending",
        description: "Read the current editor selection through MCP read-only context.",
        target: {
          type: "mcp_resource",
          name: "Current selection",
          uri: "ue://selection/current",
        },
        action: {
          type: "read_resource",
          resourceUri: "ue://selection/current",
        },
      },
      {
        id: "step-blocked",
        kind: "policy_review",
        title: "Block write intent",
        status: "blocked",
        description: "Document why a mutating request is not executed in MVP3.",
        action: {
          type: "blocked",
          toolName: "ue.asset.delete",
          reason: "Mutating UE actions are outside MVP3.",
          riskLevel: "blocked",
        },
      },
      {
        id: "step-report",
        kind: "report",
        title: "Report findings",
        status: "pending",
        description: "Create the deterministic Agent report.",
        action: {
          type: "noop_report",
        },
      },
    ];
    const plan: AgentPlan = {
      id: "agent-plan-task-0001",
      taskId: "task-0001",
      goal: "Review current selection",
      state: "planning",
      steps,
      createdAt: 3_000,
      updatedAt: 3_000,
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
      summary: "Read current selection resource.",
      payload: { uri: "ue://selection/current", text: "StaticMeshActor_1" },
      createdAt: 3_001,
    };
    const report: AgentReport = {
      id: "agent-report-task-0001",
      taskId: "task-0001",
      planId: plan.id,
      summary: "read-only completed: current selection reviewed.",
      findings: ["Selection context was read through the guarded MCP path."],
      evidenceRefs: ["evidence-0001"],
      blockedActions: [
        {
          stepId: "step-blocked",
          toolName: "ue.asset.delete",
          reason: "Mutating UE actions are outside MVP3.",
        },
      ],
      nextSteps: ["Review the evidence before requesting any future write action."],
      createdAt: 3_002,
    };
    const runStates: AgentRunState[] = [
      "planning",
      "executing",
      "observing",
      "reviewing",
      "completed",
      "failed",
      "cancelled",
    ];

    expect(plan.steps.map((step) => step.kind)).toEqual([
      "analyze_intent",
      "read_context",
      "policy_review",
      "report",
    ]);
    expect(observation.source).toBe("mcp-readonly");
    expect(report.blockedActions[0].toolName).toBe("ue.asset.delete");
    expect(runStates).toContain("cancelled");
  });
});
