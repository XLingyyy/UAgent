import { describe, expect, it, vi } from "vitest";
import type {
  ProviderRuntimeRequest,
  ProviderRuntimeResponse,
  RunContextPlan,
  RunEvent,
  RunStoreCommit,
  RunToolResult,
  TaskDraft,
  TaskRun,
} from "@uagent/shared";
import { RunCoordinator, ToolRegistry, type ProviderAdapter } from "@uagent/runtime";
import { createNativeRunStore, type NativeRunCommitInput } from "./native-run-store";

function run(): TaskRun {
  const limits = {
    maxToolCalls: 3,
    maxModelRequests: 4,
    maxDurationMs: 60000,
    maxAttemptsPerFailure: 2,
    maxToolResultBytes: 8192,
    maxContextBytes: 24576,
  };
  return {
    schemaVersion: 1,
    runId: "run-1",
    taskId: "task-1",
    projectId: "root:native-1",
    conversationId: "conversation-1",
    goal: "Read the project",
    planVersion: 1,
    status: "running",
    limits,
    steps: [],
    modelRequests: 0,
    toolCalls: 0,
    createdAt: 100,
    updatedAt: 100,
    scope: {
      id: "scope-ephemeral",
      runId: "run-1",
      projectId: "root:native-1",
      conversationId: "conversation-1",
      rootRef: "ts-root-ref",
      providerId: "synthetic",
      modelId: "model",
      endpoint: "https://invalid.example/v1",
      mode: "read_only",
      readPrefixes: [""],
      sharePrefixes: [""],
      toolIds: ["project.read"],
      limits,
      expiresAt: 60100,
    },
  };
}
function event(
  sequence: number,
  type: RunEvent["type"],
  payload?: unknown,
  stepId?: string,
): RunEvent {
  return {
    schemaVersion: 1,
    eventId: "run-1:" + sequence,
    runId: "run-1",
    sequence,
    agentId: "coordinator",
    createdAt: 100 + sequence,
    type,
    ...(payload === undefined ? {} : { payload }),
    ...(stepId === undefined ? {} : { stepId }),
  };
}
function update(value: TaskRun = run()): RunStoreCommit {
  return {
    run: value,
    events: [event(1, "run_created", { scopeRef: "scope-ephemeral" })],
    messages: [
      { role: "developer", content: "Exact \u4e2d\u6587\u0000 text", name: "context" },
      { role: "user", content: value.goal },
    ],
  };
}
function nativeRecorder() {
  const inputs: NativeRunCommitInput[] = [];
  const revisions = new Map<string, number>();
  const invoke = vi.fn(async (command: string, args: { input: unknown }) => {
    expect(command).toBe("commit_native_run_store");
    const input = args.input as NativeRunCommitInput;
    expect(input.expectedRevision).toBe(revisions.get(input.runId) ?? 0);
    inputs.push(JSON.parse(JSON.stringify(input)));
    revisions.set(input.runId, input.expectedRevision + 1);
    return {
      schemaVersion: 1,
      projectId: input.projectId,
      runId: input.runId,
      revision: input.expectedRevision + 1,
      messageCount: input.expectedMessageCount + input.batch.messages.length,
    };
  });
  return { inputs, invoke, store: createNativeRunStore(invoke) };
}
function requested(): RunStoreCommit {
  const value = update();
  value.run.steps = [
    {
      stepId: "run-1:step:1",
      dependencies: [],
      inputRefs: [],
      preconditions: ["scope_current", "read_only"],
      executor: "read",
      status: "running",
      callId: "provider-call",
    },
  ];
  value.run.toolCalls = 1;
  value.messages.push({
    role: "assistant",
    content: "",
    toolCalls: [{ id: "provider-call", name: "read", arguments: '{ "path": "Source/Test.cpp" }' }],
  });
  value.events.push(
    event(
      2,
      "tool_requested",
      {
        callId: "provider-call",
        name: "read",
        arguments: '{ "path": "[redacted diagnostic path]" }',
        scopeRef: "scope-ephemeral",
      },
      "run-1:step:1",
    ),
  );
  return value;
}

describe("native run-store production boundary", () => {
  it("persists absent usage as unknown without invented zero counts", async () => {
    const fixture = nativeRecorder(),
      value = update();
    value.events.push(
      event(2, "model_completed", {
        requestId: "request-1",
        finishReason: "stop",
        usageStatus: "unknown",
      }),
    );
    await fixture.store.commit(value);
    const completed = fixture.inputs[0]!.batch.events.find(
      (item) => item.kind === "model_completed",
    );
    expect(completed?.data).toMatchObject({
      type: "model_completed",
      payload: { requestId: "request-1", usageStatus: "unknown" },
    });
    expect((completed!.data as { payload: Record<string, unknown> }).payload).not.toHaveProperty(
      "usage",
    );
  });
  it("preserves provider-reported usage and normalizes legacy usage status", async () => {
    const fixture = nativeRecorder(),
      value = update();
    const usage = { inputTokens: 11, outputTokens: 7, totalTokens: 18 };
    value.events.push(event(2, "model_completed", { requestId: "request-1", usage }));
    await fixture.store.commit(value);
    const saved = JSON.stringify(fixture.inputs[0]!.batch.events);
    expect(saved).toContain('"usageStatus":"reported"');
    expect(saved).toContain('"inputTokens":11');
    expect(saved).toContain('"totalTokens":18');
  });
  it("refuses contradictory accounting before any native commit", async () => {
    for (const payload of [
      { usageStatus: "reported" },
      { usageStatus: "unknown", usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      { usageStatus: "estimated" },
    ]) {
      const fixture = nativeRecorder(),
        value = update();
      value.events.push(event(2, "model_completed", { requestId: "request-1", ...payload }));
      await expect(fixture.store.commit(value)).rejects.toThrow("usage_status");
      expect(fixture.invoke).not.toHaveBeenCalled();
    }
  });
  it("commits only a strict message suffix with stable IDs and exact provider envelopes", async () => {
    const fixture = nativeRecorder(),
      first = requested();
    await fixture.store.commit(first);
    const second = JSON.parse(JSON.stringify(first)) as RunStoreCommit;
    second.events = [event(3, "model_started", { requestId: "model-2" })];
    second.messages.push({
      role: "tool",
      content: "Result \u4e2d\u6587\u0000",
      toolCallId: "provider-call",
      name: "read",
    });
    await fixture.store.commit(second);
    expect(
      fixture.inputs.map((input) => [
        input.expectedRevision,
        input.expectedMessageCount,
        input.batch.messages.length,
      ]),
    ).toEqual([
      [0, 0, 3],
      [1, 3, 1],
    ]);
    expect(fixture.inputs[0]!.batch.messages[0]!.role).toBe("system");
    expect(JSON.parse(fixture.inputs[0]!.batch.messages[0]!.body)).toEqual({
      format: "uagent.provider-message.v1",
      message: first.messages[0],
    });
    expect(JSON.parse(fixture.inputs[0]!.batch.messages[2]!.body).message.toolCalls).toEqual(
      first.messages[2]!.toolCalls,
    );
    expect(JSON.parse(fixture.inputs[1]!.batch.messages[0]!.body).message).toEqual(
      second.messages[3],
    );
    expect(fixture.inputs[1]!.batch.messages[0]!.id).toBe("run-1:message:4");
  });
  it("rejects a rewritten or shortened prefix and requires reconciliation without another invoke", async () => {
    for (const shorten of [false, true]) {
      const fixture = nativeRecorder(),
        first = update();
      await fixture.store.commit(first);
      const next = JSON.parse(JSON.stringify(first)) as RunStoreCommit;
      next.events = [];
      if (shorten) next.messages.pop();
      else next.messages[0]!.content = "rewritten";
      await expect(fixture.store.commit(next)).rejects.toThrow("message_prefix_changed");
      await expect(fixture.store.commit(first)).rejects.toThrow("reconciliation_required");
      expect(fixture.invoke).toHaveBeenCalledTimes(1);
    }
  });
  it("retains tool intent identity while recording the observed tool result and full state", async () => {
    const fixture = nativeRecorder(),
      first = requested();
    await fixture.store.commit(first);
    const second = JSON.parse(JSON.stringify(first)) as RunStoreCommit;
    const result = {
      callId: "provider-call",
      toolId: "project.read",
      status: "completed" as const,
      effectState: "not_started" as const,
      output: { text: "Exact \u4e2d\u6587\u0000 body" },
      sources: [
        {
          projectId: "root:native-1",
          path: "Source/Test.cpp",
          version: "digest",
          kind: "file_preview" as const,
        },
      ],
      truncated: false,
    };
    Object.assign(second.run.steps[0]!, { executor: "project.read", status: "completed", result });
    second.events = [event(3, "tool_completed", { result }, "run-1:step:1")];
    await fixture.store.commit(second);
    expect(fixture.inputs[1]!.batch.toolCalls[0]).toMatchObject({
      id: "run-1:step:1:tool",
      stepId: "run-1:step:1",
      toolName: "read",
      arguments: { path: "Source/Test.cpp" },
      result,
      status: "succeeded",
    });
    const state = fixture.inputs[1]!.batch.events.find(
      (item) => item.kind === "coordinator_state_v1",
    )!.data;
    expect(state).toMatchObject({
      steps: [{ executor: "project.read", result }],
      messageCount: 3,
      requiresFreshAuthorization: true,
    });
  });
  it("keeps an unobserved cancelled call unknown and never fabricates an outcome", async () => {
    const fixture = nativeRecorder(),
      first = requested();
    await fixture.store.commit(first);
    first.run.status = "cancelled";
    first.run.steps[0]!.status = "cancelled";
    first.events = [];
    await fixture.store.commit(first);
    expect(fixture.inputs[1]!.batch.toolCalls[0]).toMatchObject({
      result: null,
      status: "unknown",
    });
    expect(fixture.inputs[1]!.batch.status).toBe("cancelled");
  });
  it("persists descriptive scope only and discards unknown transport/configuration fields", async () => {
    const fixture = nativeRecorder(),
      first = update();
    Object.assign(first.run, {
      credentials: { apiKey: "never-persist-credential" },
      approvalToken: "never-persist-approval",
    });
    Object.assign(first.messages[0]!, { headers: { Authorization: "never-persist-header" } });
    await fixture.store.commit(first);
    const serialized = JSON.stringify(fixture.inputs[0]);
    for (const forbidden of [
      "scope-ephemeral",
      "ts-root-ref",
      "https://invalid.example",
      "expiresAt",
      "never-persist",
    ])
      expect(serialized).not.toContain(forbidden);
    expect(serialized).toContain("scopeDescription");
    expect(serialized).toContain("requiresFreshAuthorization");
  });
  it("rejects nested authority in both structured output and serialized tool arguments", async () => {
    const fixture = nativeRecorder(),
      first = requested();
    first.messages[2]!.toolCalls![0]!.arguments = '{"nested":{"Approval-Token":"synthetic"}}';
    await expect(fixture.store.commit(first)).rejects.toThrow("unsafe_tool_arguments");
    expect(fixture.invoke).not.toHaveBeenCalled();
    const another = nativeRecorder(),
      pending = requested();
    await another.store.commit(pending);
    const result = {
      callId: "provider-call",
      toolId: "project.read",
      status: "completed" as const,
      effectState: "not_started" as const,
      output: { nested: [{ api_key: "synthetic" }] },
      sources: [],
      truncated: false,
    };
    Object.assign(pending.run.steps[0]!, { status: "completed", result });
    pending.events = [event(3, "tool_completed", { result }, "run-1:step:1")];
    await expect(another.store.commit(pending)).rejects.toThrow("credential_or_authority");
    expect(another.invoke).toHaveBeenCalledTimes(1);
  });
  it("fails closed after a lost, rejected or mismatched acknowledgement", async () => {
    for (const mode of ["lost", "wrong-revision", "wrong-project", "wrong-count"]) {
      const invoke = vi.fn(async (_command: string, args: { input: unknown }) => {
        const input = args.input as NativeRunCommitInput;
        if (mode === "lost") throw Error("acknowledgement lost after possible durable commit");
        return {
          schemaVersion: 1,
          projectId: mode === "wrong-project" ? "another" : input.projectId,
          runId: input.runId,
          revision: mode === "wrong-revision" ? 2 : 1,
          messageCount: mode === "wrong-count" ? 999 : input.batch.messages.length,
        };
      });
      const store = createNativeRunStore(invoke);
      await expect(store.commit(update())).rejects.toThrow();
      await expect(store.commit(update())).rejects.toThrow("reconciliation_required");
      expect(invoke).toHaveBeenCalledTimes(1);
    }
  });
  it("serializes concurrent commits against the acknowledged cursor", async () => {
    const fixture = nativeRecorder(),
      first = update(),
      second = update();
    second.events = [event(2, "model_started", { requestId: "request-2" })];
    second.messages.push({ role: "assistant", content: "additional" });
    await Promise.all([fixture.store.commit(first), fixture.store.commit(second)]);
    expect(fixture.inputs.map((input) => input.expectedRevision)).toEqual([0, 1]);
    expect(fixture.inputs[1]!.batch.messages).toHaveLength(1);
  });
  it("rejects event gaps and scope mismatches before invoking native storage", async () => {
    const fixture = nativeRecorder(),
      first = update();
    first.events = [event(2, "model_started", { requestId: "gap" })];
    await expect(fixture.store.commit(first)).rejects.toThrow("event_order");
    const another = nativeRecorder(),
      mismatch = update();
    mismatch.run.scope.projectId = "other";
    await expect(another.store.commit(mismatch)).rejects.toThrow("scope_mismatch");
    expect(fixture.invoke).not.toHaveBeenCalled();
    expect(another.invoke).not.toHaveBeenCalled();
  });
  it("stops the actual coordinator before a tool when native intent persistence fails", async () => {
    const value = run(),
      execute = vi.fn(async () => ({
        status: "completed" as const,
        effectState: "not_started" as const,
        output: { text: "read" },
        sources: [],
        truncated: false,
      }));
    const registry = new ToolRegistry(
      [
        {
          id: "project.read",
          definition: {
            name: "read",
            description: "Synthetic read",
            parameters: { type: "object" },
          },
          validate: () => undefined,
          paths: () => [],
          execute,
        },
      ],
      { now: () => 100 },
    );
    const complete = vi.fn(
      async (request: ProviderRuntimeRequest): Promise<ProviderRuntimeResponse> => ({
        id: "response",
        requestId: request.id,
        providerId: "synthetic",
        modelId: "model",
        text: "",
        finishReason: "tool_calls",
        toolCalls: [{ id: "provider-call", name: "read", arguments: "{}" }],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        createdAt: 100,
      }),
    );
    const provider: ProviderAdapter = {
      id: "synthetic",
      getCapabilities: () => ({
        providerId: "synthetic",
        modelIds: ["model"],
        supportsTools: true,
        supportsStreaming: false,
        isMock: true,
      }),
      complete,
    };
    const fixture = nativeRecorder();
    const invoke = vi.fn(async (command: string, args: { input: unknown }) => {
      if (
        (args.input as NativeRunCommitInput).batch.toolCalls.some(
          (call) => call.status === "inFlight",
        )
      )
        throw Error("synthetic capacity failure");
      return fixture.invoke(command, args);
    });
    const coordinator = new RunCoordinator({
      adapter: provider,
      registry,
      lease: { scope: value.scope, isCurrent: () => true },
      now: () => 100,
      store: createNativeRunStore(invoke),
    });
    const draft: TaskDraft = {
      input: value.goal,
      projectId: value.projectId,
      conversationId: value.conversationId,
      providerId: "synthetic",
      modelId: "model",
      taskMode: "investigation",
      investigationScopeId: value.scope.id,
      permissionMode: "request_approval",
      reasoningEffort: "low",
      runMode: "local",
      branch: null,
      contextPercent: null,
    };
    const outcome = await coordinator.start("task-1", draft);
    expect(outcome.run).toMatchObject({ status: "paused", stopReason: "persistence_failed" });
    expect(execute).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(3); // Initial state, model intent, failed tool intent. Catch-path is poisoned.
  });
});

function plannedCommit(): RunStoreCommit {
  const value = requested();
  const result: RunToolResult = {
    callId: "provider-call",
    toolId: "project.read",
    status: "completed",
    effectState: "not_started",
    output: { text: "Original archive \u4e2d\u6587\u0000 ".repeat(500) },
    sources: [
      {
        projectId: value.run.projectId,
        path: "Source/Test.cpp",
        version: "sha256-current",
        kind: "file_preview",
        freshness: "native-stamp-2",
      },
    ],
    truncated: false,
  };
  Object.assign(value.run.steps[0]!, { executor: "project.read", status: "completed", result });
  value.messages.push({
    role: "tool",
    toolCallId: "provider-call",
    content: JSON.stringify(result),
  });
  value.contextPlan = {
    schemaVersion: 1,
    planId: "run-1:context:2",
    runId: value.run.runId,
    projectId: value.run.projectId,
    conversationId: value.run.conversationId,
    method: "deterministic-selection-v1",
    maxBytes: value.run.limits.maxContextBytes,
    usedBytes: 1600,
    fullRecordMessageCount: value.messages.length,
    scopeDescription: { mode: "read_only", readPrefixes: [""], sharePrefixes: [""] },
    segments: [
      { category: "constraints", originalMessageIndexes: [0], selection: "exact", sources: [] },
      { category: "goal", originalMessageIndexes: [1], selection: "exact", sources: [] },
      {
        category: "tool_result",
        originalMessageIndexes: [2, 3],
        selection: "deterministic_excerpt",
        sources: JSON.parse(JSON.stringify(result.sources)),
        excerpts: [{ messageIndex: 3, start: 5, end: 36, unit: "utf16" }],
      },
    ],
    omitted: [],
  };
  value.checkpoint = {
    schemaVersion: 1,
    runId: value.run.runId,
    completedStepIds: ["run-1:step:1"],
    unresolvedEffects: [],
    contextRefs: result.sources,
    nextStepId: null,
    reason: "descriptiveBoundary",
  };
  value.events.push(
    event(3, "tool_completed", { result }, "run-1:step:1"),
    event(4, "model_started", { requestId: "run-1:model:2", contextPlan: value.contextPlan }),
  );
  return value;
}

describe("context-plan and freshness persistence boundary", () => {
  it("preserves the actual plan and freshness separately from the complete original archive", async () => {
    const fixture = nativeRecorder(),
      value = plannedCommit(),
      before = JSON.parse(JSON.stringify(value)) as RunStoreCommit;
    await fixture.store.commit(value);
    const input = fixture.inputs[0]!;
    const state = input.batch.events.find((item) => item.kind === "coordinator_state_v1")!.data;
    const model = input.batch.events.find((item) => item.kind === "model_started")!.data;
    expect(state).toMatchObject({
      contextPlan: value.contextPlan,
      requiresFreshAuthorization: true,
    });
    expect(model).toMatchObject({ payload: { contextPlan: value.contextPlan } });
    expect(input.batch.toolCalls[0]!.result).toMatchObject({
      sources: value.run.steps[0]!.result!.sources,
    });
    expect(input.batch.messages.map((message) => JSON.parse(message.body).message)).toEqual(
      value.messages,
    );
    expect(value.messages[3]!.content.length).toBeGreaterThan(value.contextPlan!.usedBytes);
    expect(value).toEqual(before);
    expect(JSON.stringify(input)).not.toContain("scope-ephemeral");
    const next = JSON.parse(JSON.stringify(value)) as RunStoreCommit;
    next.events = [event(5, "status_changed", { status: "completed" })];
    next.run.status = "completed";
    next.messages.push({ role: "assistant", content: "Final answer" });
    await fixture.store.commit(next);
    expect(fixture.inputs[1]!.batch.messages).toHaveLength(1);
    expect(fixture.inputs[1]!.batch.events.at(-1)!.data).toMatchObject({
      contextPlan: value.contextPlan,
      messageCount: 5,
    });
  });
  it("rejects malformed, foreign, unbounded or invented context plans before native persistence", async () => {
    const mutations: Array<(plan: RunContextPlan) => void> = [
      (plan) => {
        plan.runId = "another-run";
      },
      (plan) => {
        plan.projectId = "another-project";
      },
      (plan) => {
        plan.conversationId = "another-conversation";
      },
      (plan) => {
        Object.assign(plan, { executionToken: "synthetic" });
      },
      (plan) => {
        plan.method = "invented-method" as RunContextPlan["method"];
      },
      (plan) => {
        plan.fullRecordMessageCount = 999;
      },
      (plan) => {
        plan.usedBytes = plan.maxBytes + 1;
      },
      (plan) => {
        plan.maxBytes = 999999;
      },
      (plan) => {
        plan.scopeDescription.readPrefixes = ["Other"];
      },
      (plan) => {
        plan.segments[0]!.originalMessageIndexes = [999];
      },
      (plan) => {
        plan.segments[0]!.originalMessageIndexes = [-1];
      },
      (plan) => {
        plan.segments[0]!.originalMessageIndexes = [1];
      },
      (plan) => {
        plan.segments.pop();
      },
      (plan) => {
        plan.segments[2]!.excerpts![0]!.end = 999999;
      },
      (plan) => {
        plan.segments[2]!.excerpts![0]!.messageIndex = 0;
      },
      (plan) => {
        plan.segments[2]!.excerpts![0]!.start = 36;
      },
      (plan) => {
        plan.segments[2]!.sources[0]!.projectId = "another-project";
      },
      (plan) => {
        plan.segments[2]!.sources[0]!.freshness = "";
      },
      (plan) => {
        Object.assign(plan.segments[2]!.sources[0]!, { scopeRef: "must-not-persist" });
      },
    ];
    for (const mutate of mutations) {
      const fixture = nativeRecorder(),
        value = plannedCommit();
      mutate(value.contextPlan!);
      await expect(fixture.store.commit(value)).rejects.toThrow();
      await expect(fixture.store.commit(plannedCommit())).rejects.toThrow(
        "reconciliation_required",
      );
      expect(fixture.invoke).not.toHaveBeenCalled();
    }
    const fixture = nativeRecorder(),
      mismatch = plannedCommit();
    const different = JSON.parse(JSON.stringify(mismatch.contextPlan)) as RunContextPlan;
    different.usedBytes--;
    (mismatch.events.at(-1)!.payload as { contextPlan: RunContextPlan }).contextPlan = different;
    await expect(fixture.store.commit(mismatch)).rejects.toThrow("context_plan_mismatch");
    expect(fixture.invoke).not.toHaveBeenCalled();
  });
  it("retains optional freshness exactly and rejects null, empty or overlength stamps", async () => {
    for (const invalid of [null, "", "x".repeat(257), "\ud83d\udfe2".repeat(129)]) {
      const fixture = nativeRecorder(),
        value = plannedCommit();
      value.run.steps[0]!.result!.sources[0]!.freshness = invalid as unknown as string;
      await expect(fixture.store.commit(value)).rejects.toThrow("source_freshness");
      expect(fixture.invoke).not.toHaveBeenCalled();
    }
    const fixture = nativeRecorder(),
      value = plannedCommit();
    delete value.run.steps[0]!.result!.sources[0]!.freshness;
    delete value.contextPlan!.segments[2]!.sources[0]!.freshness;
    await fixture.store.commit(value);
    expect(fixture.inputs[0]!.batch.toolCalls[0]!.result).toMatchObject({
      sources: [{ version: "sha256-current" }],
    });
    expect(JSON.stringify(fixture.inputs[0]!.batch.toolCalls[0]!.result)).not.toContain(
      "freshness",
    );
  });
  it("never resubmits a plan or archive after a possibly durable commit loses its acknowledgement", async () => {
    let persisted: NativeRunCommitInput | undefined;
    const invoke = vi.fn(async (_command: string, args: { input: unknown }) => {
      persisted = args.input as NativeRunCommitInput;
      throw Error("lost acknowledgement after possible durable commit");
    });
    const store = createNativeRunStore(invoke),
      value = plannedCommit();
    await expect(store.commit(value)).rejects.toThrow("lost acknowledgement");
    expect(persisted!.batch.events.at(-1)!.data).toMatchObject({ contextPlan: value.contextPlan });
    value.events = [];
    value.messages.push({ role: "assistant", content: "must not be appended" });
    await expect(store.commit(value)).rejects.toThrow("reconciliation_required");
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
