import { describe, expect, it } from "vitest";
import type { McpDiscoverySnapshot, TaskDraft } from "@uagent/shared";
import { createApprovalGate } from "./approval-gate.js";
import { createAgentLoopRuntime } from "./agent-loop-runtime.js";

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

describe("createAgentLoopRuntime", () => {
  it("runs a no-discovery mock fallback Agent flow to completion", async () => {
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mock",
      discovery: null,
      clockStart: 2_000,
    });

    const record = await runtime.submitTask(baseDraft);
    const snapshot = runtime.getSnapshot();
    const events = snapshot.eventsByTaskId[record.id];

    expect(snapshot.tasksById[record.id].state).toBe("completed");
    expect(events.map((event) => event.type)).toEqual([
      "task_submitted",
      "mcp_fallback_to_mock",
      "agent_plan_started",
      "agent_plan_created",
      "agent_step_started",
      "agent_observation_created",
      "evidence_created",
      "agent_step_completed",
      "agent_step_started",
      "agent_step_completed",
      "agent_step_started",
      "agent_observation_created",
      "evidence_created",
      "agent_step_completed",
      "agent_step_started",
      "agent_step_completed",
      "agent_report_created",
      "review_created",
      "task_completed",
    ]);
  });

  it("executes discovered MCP resources through readResource", async () => {
    const reads: string[] = [];
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mcp-readonly",
      discovery,
      clockStart: 2_000,
      readResource: async (uri) => {
        reads.push(uri);
        return { uri, text: "StaticMeshActor_1" };
      },
    });

    const record = await runtime.submitTask(baseDraft);
    const events = runtime.getSnapshot().eventsByTaskId[record.id];

    expect(reads).toEqual(["ue://selection/current"]);
    expect(events.map((event) => event.type)).toContain("mcp_read_completed");
    expect(runtime.getSnapshot().tasksById[record.id].state).toBe("completed");
  });

  it("blocks write intent and does not call tools/call", async () => {
    const calls: string[] = [];
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mcp-readonly",
      discovery,
      clockStart: 2_000,
      callTool: async (name) => {
        calls.push(name);
        return { text: "should not happen" };
      },
    });

    const record = await runtime.submitTask({ ...baseDraft, input: "delete current selection" });
    const events = runtime.getSnapshot().eventsByTaskId[record.id];

    expect(calls).toEqual([]);
    expect(events.map((event) => event.type)).toContain("mcp_tool_blocked");
    expect(events.map((event) => event.type)).toContain("agent_report_created");
    expect(runtime.getSnapshot().tasksById[record.id].state).toBe("completed");
  });

  it("fails the task when action execution throws and emits report/review before failure", async () => {
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mock",
      discovery: null,
      clockStart: 2_000,
      mockObserver: async () => {
        throw new Error("mock observer failed");
      },
    });

    const record = await runtime.submitTask({ ...baseDraft, input: "Review selection #fail" });
    const snapshot = runtime.getSnapshot();
    const types = snapshot.eventsByTaskId[record.id].map((event) => event.type);

    expect(types).toContain("agent_step_failed");
    expect(types).toContain("agent_report_created");
    expect(types).toContain("review_created");
    expect(types.at(-1)).toBe("task_failed");
    expect(types.indexOf("agent_report_created")).toBeGreaterThan(types.indexOf("agent_step_failed"));
    expect(types.indexOf("review_created")).toBeGreaterThan(types.indexOf("agent_report_created"));
    expect(types.indexOf("task_failed")).toBeGreaterThan(types.indexOf("review_created"));
    expect(snapshot.tasksById[record.id].state).toBe("failed");
    expect(snapshot.lastError).toContain("mock observer failed");
    const payload = snapshot.eventsByTaskId[record.id].find(
      (e) => e.type === "agent_report_created",
    )?.payload as { report?: { summary: string } } | undefined;
    expect(payload?.report?.summary).toContain("failed:");
  });

  it("updateContext switches runtime mode and preserves existing snapshot", async () => {
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mock",
      discovery: null,
      clockStart: 2_000,
    });

    const record1 = await runtime.submitTask(baseDraft);
    expect(record1.id).toBe("task-0001");
    expect(runtime.getSnapshot().tasksById["task-0001"].state).toBe("completed");

    runtime.updateContext({
      runtimeMode: "mcp-readonly",
      discovery: {
        tools: [{ name: "ue.selection.get", description: "Read current editor selection" }],
        resources: [{ uri: "ue://selection/current", name: "Current selection" }],
        prompts: [],
        capabilitySummary: { tools: 1, resources: 1, prompts: 0, readOnlyTools: 1, blockedTools: 0 },
        discoveredAt: 2_000,
      },
    });

    const record2 = await runtime.submitTask({ ...baseDraft, input: "check selection" });
    expect(record2.id).toBe("task-0002");
    expect(runtime.getSnapshot().tasksById["task-0001"].state).toBe("completed");
    expect(runtime.getSnapshot().tasksById["task-0002"].state).toBe("completed");
    expect(Object.keys(runtime.getSnapshot().tasksById).length).toBe(2);
  });

  it("cancels an in-flight Agent task and stops later steps", async () => {
    let releaseObserver: (value: unknown) => void = () => {};
    const observerGate = new Promise((resolve) => {
      releaseObserver = resolve;
    });
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mock",
      discovery: null,
      clockStart: 2_000,
      mockObserver: async () => observerGate,
    });

    const pending = runtime.submitTask(baseDraft);
    await Promise.resolve();
    const taskId = runtime.getSnapshot().activeTaskId!;
    await runtime.cancelTask(taskId);
    releaseObserver({ text: "late result" });
    await pending;

    const events = runtime.getSnapshot().eventsByTaskId[taskId];
    expect(events.map((event) => event.type)).toContain("task_cancelled");
    expect(events.map((event) => event.type)).not.toContain("task_completed");
    expect(runtime.getSnapshot().tasksById[taskId].state).toBe("cancelled");
  });

  it("passes injected resources/read result through observation, evidence, report, and request log", async () => {
    const requestLog: Array<{ method: string; params: unknown }> = [];
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mcp-readonly",
      discovery,
      readResource: async (uri) => {
        requestLog.push({ method: "resources/read", params: { uri } });
        return { contents: [{ type: "text", text: "Fixture selection data" }] };
      },
      callTool: async (name, args) => {
        requestLog.push({ method: "tools/call", params: { name, arguments: args } });
        return { content: [] };
      },
      clockStart: 2_000,
    });

    const record = await runtime.submitTask(baseDraft);
    const events = runtime.getSnapshot().eventsByTaskId[record.id];

    expect(requestLog.filter((entry) => entry.method === "resources/read")).toHaveLength(1);
    expect(requestLog.filter((entry) => entry.method === "tools/call")).toHaveLength(0);
    expect(events.filter((event) => event.type === "agent_observation_created").at(-1)?.body).toContain(
      "Fixture selection data",
    );
    expect(events.map((event) => event.type)).toContain("evidence_created");
    expect(events.map((event) => event.type)).toContain("agent_report_created");
  });

  it("passes read-only tools/call through request log when no resource matches", async () => {
    const requestLog: Array<{ method: string; params: unknown }> = [];
    const toolOnlyDiscovery: McpDiscoverySnapshot = {
      ...discovery,
      resources: [],
      capabilitySummary: { tools: 1, resources: 0, prompts: 0, readOnlyTools: 1, blockedTools: 0 },
    };
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mcp-readonly",
      discovery: toolOnlyDiscovery,
      readResource: async (uri) => {
        requestLog.push({ method: "resources/read", params: { uri } });
        return { contents: [] };
      },
      callTool: async (name, args) => {
        requestLog.push({ method: "tools/call", params: { name, arguments: args } });
        return { content: [{ type: "text", text: "Tool fixture data" }] };
      },
      clockStart: 2_000,
    });

    const record = await runtime.submitTask(baseDraft);

    expect(requestLog.filter((entry) => entry.method === "resources/read")).toHaveLength(0);
    expect(requestLog.filter((entry) => entry.method === "tools/call")).toHaveLength(1);
    expect(requestLog.find((entry) => entry.method === "tools/call")?.params).toEqual({
      name: "ue.selection.get",
      arguments: {},
    });
    expect(runtime.getSnapshot().tasksById[record.id].state).toBe("completed");
  });

  describe("approval decision integration", () => {
    function getStepIdFromApprovalRequired(events: import("@uagent/shared").TaskEvent[]): string | null {
      const ev = events.find((e) => e.type === "approval_required");
      const payload = ev?.payload as Record<string, unknown> | undefined;
      return (payload?.stepId as string) ?? null;
    }

    function makeApprovalDraft(input: string, permissionMode: "request_approval" | "auto" = "request_approval"): TaskDraft {
      return { ...baseDraft, input, permissionMode };
    }

    it("enters awaiting_approval state when a step requires approval", async () => {
      const clock = deterministicClock();
      const gate = createApprovalGate(clock);
      const runtime = createAgentLoopRuntime({
        clock,
        clockStart: 1000,
        approvalGate: gate,
        actionSelector: (step) => {
          if (step.kind === "read_context" || step.kind === "policy_review") {
            return {
              type: "blocked" as const,
              stepId: step.id,
              toolName: "test.medium_write",
              reason: "Medium write blocked action for approval test",
              riskLevel: "medium_write" as const,
            };
          }
          return {
            type: "mock_observation" as const,
            stepId: step.id,
            reason: "Default mock observation",
          };
        },
      });

      const record = await runtime.submitTask(makeApprovalDraft("write test file"));
      const snapshot = runtime.getSnapshot();
      const events = snapshot.eventsByTaskId[record.id];

      expect(snapshot.tasksById[record.id].state).toBe("awaiting_approval");
      expect(events.map((e) => e.type)).toContain("approval_required");
      expect(events.map((e) => e.type)).not.toContain("sandbox_started");
      expect(events.map((e) => e.type)).not.toContain("change_set_created");
    });

    it("approved decision resumes execution through sandbox to completed", async () => {
      const clock = deterministicClock();
      const gate = createApprovalGate(clock);
      const runtime = createAgentLoopRuntime({
        clock,
        clockStart: 1000,
        approvalGate: gate,
        actionSelector: (step) => {
          if (step.kind === "read_context" || step.kind === "policy_review") {
            return {
              type: "blocked" as const,
              stepId: step.id,
              toolName: "test.medium_write",
              reason: "Medium write blocked action for approval test",
              riskLevel: "medium_write" as const,
            };
          }
          return {
            type: "mock_observation" as const,
            stepId: step.id,
            reason: "Default mock observation",
          };
        },
      });

      const record = await runtime.submitTask(makeApprovalDraft("write approved file"));
      const snapshot0 = runtime.getSnapshot();
      expect(snapshot0.tasksById[record.id].state).toBe("awaiting_approval");

      const stepId = getStepIdFromApprovalRequired(snapshot0.eventsByTaskId[record.id]);
      expect(stepId).not.toBeNull();

      await runtime.submitApprovalDecision!(record.id, stepId!, "approved", "test", "Approved for test");
      const snapshot1 = runtime.getSnapshot();
      const events = snapshot1.eventsByTaskId[record.id];

      expect(snapshot1.tasksById[record.id].state).toMatch(/completed|reviewing/);
      expect(events.map((e) => e.type)).toContain("approval_approved");
    });

    it("denied decision terminates without sandbox or change events", async () => {
      const clock = deterministicClock();
      const gate = createApprovalGate(clock);
      const runtime = createAgentLoopRuntime({
        clock,
        clockStart: 1000,
        approvalGate: gate,
        actionSelector: (step) => {
          if (step.kind === "read_context" || step.kind === "policy_review") {
            return {
              type: "blocked" as const,
              stepId: step.id,
              toolName: "test.medium_write",
              reason: "Medium write blocked action for approval test",
              riskLevel: "medium_write" as const,
            };
          }
          return {
            type: "mock_observation" as const,
            stepId: step.id,
            reason: "Default mock observation",
          };
        },
      });

      const record = await runtime.submitTask(makeApprovalDraft("write denied file"));
      const stepId = getStepIdFromApprovalRequired(runtime.getSnapshot().eventsByTaskId[record.id]);
      expect(stepId).not.toBeNull();

      await runtime.submitApprovalDecision!(record.id, stepId!, "denied", "test", "Denied for test");
      const snapshot = runtime.getSnapshot();
      const events = snapshot.eventsByTaskId[record.id];
      const eventTypes = events.map((e) => e.type);

      expect(snapshot.tasksById[record.id].state).toBe("failed");
      expect(eventTypes).toContain("approval_denied");
      expect(eventTypes).not.toContain("sandbox_started");
      expect(eventTypes).not.toContain("change_set_created");
    });

    it("cancelled decision results in terminal cancelled state", async () => {
      const clock = deterministicClock();
      const gate = createApprovalGate(clock);
      const runtime = createAgentLoopRuntime({
        clock,
        clockStart: 1000,
        approvalGate: gate,
        actionSelector: (step) => {
          if (step.kind === "read_context" || step.kind === "policy_review") {
            return {
              type: "blocked" as const,
              stepId: step.id,
              toolName: "test.medium_write",
              reason: "Medium write blocked action for approval test",
              riskLevel: "medium_write" as const,
            };
          }
          return {
            type: "mock_observation" as const,
            stepId: step.id,
            reason: "Default mock observation",
          };
        },
      });

      const record = await runtime.submitTask(makeApprovalDraft("write cancelled file"));
      const stepId = getStepIdFromApprovalRequired(runtime.getSnapshot().eventsByTaskId[record.id]);
      expect(stepId).not.toBeNull();

      await runtime.submitApprovalDecision!(record.id, stepId!, "cancelled", "user", "Cancelled");
      const snapshot = runtime.getSnapshot();
      const events = snapshot.eventsByTaskId[record.id];
      const eventTypes = events.map((e) => e.type);

      expect(snapshot.tasksById[record.id].state).toBe("cancelled");
      expect(eventTypes).toContain("approval_cancelled");
      const cancelCount = eventTypes.filter((t) => t === "task_cancelled").length;
      expect(cancelCount).toBe(1);
    });
  });
});

const RAW_SECRETS = [
  "sk-abcdefghijklmnopqrstuvwxyz123456",
  "abcdef1234567890abcdef1234567890",
];

const SECRET_INPUT = [
  "api_key=sk-abcdefghijklmnopqrstuvwxyz123456",
  "Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz123456",
  "token=abcdef1234567890abcdef1234567890",
].join(" ");

function expectNoRawSecrets(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of RAW_SECRETS) {
    expect(serialized, `raw secret "${secret}" must not appear in persisted state`).not.toContain(secret);
  }
}

describe("runtime draft redaction", () => {
  it("writes redacted task title, draft input, event bodies, and payloads to snapshot and events", async () => {
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mock",
      discovery: null,
      clockStart: 2_000,
    });
    const draft: TaskDraft = { ...baseDraft, input: SECRET_INPUT };
    const record = await runtime.submitTask(draft);
    const snapshot = runtime.getSnapshot();
    const events = snapshot.eventsByTaskId[record.id];

    expect(snapshot.tasksById[record.id].state).toBe("completed");

    expectNoRawSecrets(snapshot.tasksById[record.id].title);
    expectNoRawSecrets(snapshot.tasksById[record.id].draft.input);

    const taskSubmitted = events.find((e) => e.type === "task_submitted")!;
    expectNoRawSecrets(taskSubmitted.body);
    expectNoRawSecrets((taskSubmitted.payload as { draft: TaskDraft }).draft.input);

    const planStarted = events.find((e) => e.type === "agent_plan_started")!;
    expectNoRawSecrets((planStarted.payload as { draft: TaskDraft }).draft.input);

    expectNoRawSecrets(events);
    expectNoRawSecrets(snapshot);
  });
});

function deterministicClock(): () => number {
  let tick = 1;
  return () => {
    const t = tick;
    tick += 1;
    return t;
  };
}
