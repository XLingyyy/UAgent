import { describe, expect, it, vi } from "vitest";
import type {
  ProviderRuntimeRequest,
  RunStoreCommit,
  TaskDraft,
  TaskRunScope,
} from "@uagent/shared";
import { createAgentLoopRuntime, type AgentLoopRuntimeClient } from "./agent-loop-runtime.js";
import type { ProviderAdapter } from "./provider/provider-adapter.js";
import type { RunScopeLease } from "./run/run-coordinator.js";
import { ToolRegistry } from "./run/tool-registry.js";

function scope(index = 1): TaskRunScope {
  return {
    id: `scope-${index}`,
    runId: `run-${index}`,
    projectId: "project-native",
    conversationId: `conversation-${index}`,
    rootRef: "opaque-root",
    providerId: "fixture",
    modelId: `model-${index}`,
    endpoint: "https://fixture.invalid/v1/responses",
    mode: "read_only",
    readPrefixes: ["Source"],
    sharePrefixes: ["Source"],
    toolIds: ["fixture.read"],
    expiresAt: Date.now() + 60_000,
    limits: {
      maxToolCalls: 3,
      maxModelRequests: 4,
      maxDurationMs: 60_000,
      maxAttemptsPerFailure: 2,
      maxToolResultBytes: 8192,
      maxContextBytes: 24576,
    },
  };
}
function draft(s: TaskRunScope): TaskDraft {
  return {
    input: "Explain the selected scope.",
    projectId: s.projectId,
    conversationId: s.conversationId,
    taskMode: "investigation",
    investigationScopeId: s.id,
    providerId: s.providerId,
    modelId: s.modelId,
    permissionMode: "request_approval",
    reasoningEffort: "low",
    runMode: "local",
    branch: null,
    contextPercent: null,
  };
}
function registry() {
  return new ToolRegistry([
    {
      id: "fixture.read",
      definition: {
        name: "fixture_read",
        description: "Synthetic read",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
      validate: () => {},
      paths: () => [],
      execute: async () => ({
        status: "completed" as const,
        effectState: "not_started" as const,
        output: "unused",
        sources: [],
        truncated: false,
      }),
    },
  ]);
}
function answer(request: ProviderRuntimeRequest) {
  const hasRead = request.messages.some((message) => message.role === "tool");
  return {
    id: "answer-" + request.id,
    requestId: request.id,
    providerId: request.providerId,
    modelId: request.modelId,
    text: hasRead ? "Synthetic scoped answer." : "",
    finishReason: hasRead ? ("stop" as const) : ("tool_calls" as const),
    ...(!hasRead
      ? { toolCalls: [{ id: request.id + ":read", name: "fixture_read", arguments: "{}" }] }
      : {}),
    usageStatus: "unknown" as const,
    createdAt: Date.now(),
  };
}
function adapter(
  s: TaskRunScope,
  complete = vi.fn(async (request: ProviderRuntimeRequest) => answer(request)),
): ProviderAdapter {
  return {
    id: s.providerId,
    getCapabilities: () => ({
      providerId: s.providerId,
      modelIds: [s.modelId],
      supportsStreaming: false,
      supportsTools: true,
      isMock: true,
    }),
    complete,
  };
}

describe("investigation per-run adapter factory", () => {
  it("constructs after scope resolution with the exact fresh lease and preserves each model/run/conversation", async () => {
    const scopes = [scope(1), scope(2)];
    const leases = scopes.map((s) => ({ scope: s, isCurrent: () => true }));
    const seen: Array<{ lease: RunScopeLease; draft: TaskDraft }> = [];
    const requests: ProviderRuntimeRequest[] = [];
    const order: string[] = [];
    const commits: RunStoreCommit[] = [];
    const fallback = vi.fn(async (request: ProviderRuntimeRequest) => answer(request));
    const createAdapter = vi.fn((lease: RunScopeLease, currentDraft: TaskDraft) => {
      order.push("factory:" + lease.scope.runId);
      seen.push({ lease, draft: currentDraft });
      return adapter(
        lease.scope,
        vi.fn(async (request: ProviderRuntimeRequest) => {
          requests.push(request);
          return answer(request);
        }),
      );
    });
    const runtime = createAgentLoopRuntime({
      providerAdapter: adapter(scopes[0], fallback),
      providerEnabled: true,
      investigation: {
        registry: registry(),
        resolveScope: (id) => {
          const lease = leases.find((current) => current.scope.id === id)!;
          order.push("resolve:" + lease.scope.runId);
          return lease;
        },
        createAdapter,
        store: {
          commit: async (commit) => {
            commits.push(commit);
          },
        },
      },
    });
    for (const s of scopes) expect((await runtime.submitTask(draft(s))).state).toBe("completed");
    expect(order).toEqual(["resolve:run-1", "factory:run-1", "resolve:run-2", "factory:run-2"]);
    expect(createAdapter).toHaveBeenCalledTimes(2);
    expect(fallback).not.toHaveBeenCalled();
    for (let index = 0; index < scopes.length; index++) {
      const s = scopes[index];
      expect(seen[index].lease).toBe(leases[index]);
      expect(seen[index].draft).toMatchObject({
        modelId: s.modelId,
        conversationId: s.conversationId,
        projectId: s.projectId,
      });
      const ownedRequests = requests.filter((request) => request.metadata?.runId === s.runId);
      expect(ownedRequests).toHaveLength(2);
      for (const request of ownedRequests)
        expect(request).toMatchObject({
          modelId: s.modelId,
          providerId: s.providerId,
          metadata: { runId: s.runId, scopeRef: s.id, projectId: s.projectId },
        });
      expect(commits.filter((commit) => commit.run.runId === s.runId).at(-1)?.run).toMatchObject({
        runId: s.runId,
        conversationId: s.conversationId,
        status: "completed",
      });
    }
  });

  it.each([
    "missing",
    "revoked",
    "expired",
    "wrong-scope",
    "wrong-project",
    "wrong-conversation",
    "wrong-provider",
    "wrong-model",
    "invalid-limits",
  ] as const)("does not construct an adapter for %s scope", async (reason) => {
    const s = scope(),
      currentDraft = draft(s);
    let current = true;
    if (reason === "revoked") current = false;
    if (reason === "expired") s.expiresAt = Date.now() - 1;
    if (reason === "wrong-scope") s.id = "unapproved";
    if (reason === "wrong-project") s.projectId = "other-project";
    if (reason === "wrong-conversation") s.conversationId = "other-conversation";
    if (reason === "wrong-provider") s.providerId = "other-provider";
    if (reason === "wrong-model") s.modelId = "other-model";
    if (reason === "invalid-limits") s.limits.maxToolCalls = 31;
    const createAdapter = vi.fn(() => adapter(s));
    const runtime = createAgentLoopRuntime({
      providerEnabled: true,
      investigation: {
        registry: registry(),
        resolveScope: () => (reason === "missing" ? null : { scope: s, isCurrent: () => current }),
        createAdapter,
      },
    });
    const record = await runtime.submitTask(currentDraft);
    expect(record.state).toBe("failed");
    expect(createAdapter).not.toHaveBeenCalled();
    expect(runtime.getTaskRun(record.id)).toBeNull();
    expect(
      runtime
        .getSnapshot()
        .eventsByTaskId[record.id].some((event) => event.type === "task_completed"),
    ).toBe(false);
  });

  it.each([false, undefined])(
    "keeps explicit provider enablement when enabled=%s",
    async (providerEnabled) => {
      const s = scope(),
        createAdapter = vi.fn(() => adapter(s));
      const runtime = createAgentLoopRuntime({
        providerEnabled,
        investigation: {
          registry: registry(),
          resolveScope: () => ({ scope: s, isCurrent: () => true }),
          createAdapter,
        },
      });
      expect((await runtime.submitTask(draft(s))).state).toBe("failed");
      expect(createAdapter).not.toHaveBeenCalled();
    },
  );

  it("uses the factory without requiring a dummy default adapter", async () => {
    const s = scope(),
      createAdapter = vi.fn(() => adapter(s));
    const runtime = createAgentLoopRuntime({
      providerEnabled: true,
      investigation: {
        registry: registry(),
        resolveScope: () => ({ scope: s, isCurrent: () => true }),
        createAdapter,
      },
    });
    expect((await runtime.submitTask(draft(s))).state).toBe("completed");
    expect(createAdapter).toHaveBeenCalledTimes(1);
  });

  it("factory failure fails the task with a static error and never falls back", async () => {
    const s = scope(),
      fallback = vi.fn(async (request: ProviderRuntimeRequest) => answer(request));
    const runtime = createAgentLoopRuntime({
      providerAdapter: adapter(s, fallback),
      providerEnabled: true,
      investigation: {
        registry: registry(),
        resolveScope: () => ({ scope: s, isCurrent: () => true }),
        createAdapter: () => {
          throw Error("fixture private diagnostic must not leak");
        },
      },
    });
    const record = await runtime.submitTask(draft(s)),
      events = runtime.getSnapshot().eventsByTaskId[record.id];
    expect(record.state).toBe("failed");
    expect(fallback).not.toHaveBeenCalled();
    expect(events.find((event) => event.type === "task_failed")?.body).toBe(
      "run_adapter_unavailable",
    );
    expect(JSON.stringify(runtime.getSnapshot())).not.toContain("private diagnostic");
    expect(events.some((event) => event.type === "task_completed")).toBe(false);
    expect(runtime.getTaskRun(record.id)).toBeNull();
  });

  it("scope resolver failure fails explicitly without running the factory", async () => {
    const s = scope(),
      createAdapter = vi.fn(() => adapter(s));
    const runtime = createAgentLoopRuntime({
      providerEnabled: true,
      investigation: {
        registry: registry(),
        resolveScope: () => {
          throw Error("fixture resolver failure");
        },
        createAdapter,
      },
    });
    const record = await runtime.submitTask(draft(s));
    expect(record.state).toBe("failed");
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("preserves cancellation during adapter construction", async () => {
    const s = scope(),
      complete = vi.fn(async (request: ProviderRuntimeRequest) => answer(request));
    const runtime: AgentLoopRuntimeClient = createAgentLoopRuntime({
      providerEnabled: true,
      investigation: {
        registry: registry(),
        resolveScope: () => ({ scope: s, isCurrent: () => true }),
        createAdapter: () => {
          void runtime.cancelTask(runtime.getSnapshot().activeTaskId!);
          return adapter(s, complete);
        },
      },
    });
    const record = await runtime.submitTask(draft(s));
    expect(record.state).toBe("cancelled");
    expect(complete).not.toHaveBeenCalled();
    expect(runtime.getTaskRun(record.id)).toBeNull();
    expect(
      runtime
        .getSnapshot()
        .eventsByTaskId[record.id].some((event) => event.type === "task_completed"),
    ).toBe(false);
  });

  it("rechecks the same lease after factory construction before model execution", async () => {
    const s = scope(),
      complete = vi.fn(async (request: ProviderRuntimeRequest) => answer(request));
    let current = true;
    const lease = { scope: s, isCurrent: () => current };
    const runtime = createAgentLoopRuntime({
      providerEnabled: true,
      investigation: {
        registry: registry(),
        resolveScope: () => lease,
        createAdapter: (fresh) => {
          expect(fresh).toBe(lease);
          current = false;
          return adapter(s, complete);
        },
      },
    });
    expect((await runtime.submitTask(draft(s))).state).toBe("failed");
    expect(complete).not.toHaveBeenCalled();
  });

  it("keeps the existing default adapter path when no factory is configured", async () => {
    const s = scope(),
      complete = vi.fn(async (request: ProviderRuntimeRequest) => answer(request));
    const runtime = createAgentLoopRuntime({
      providerAdapter: adapter(s, complete),
      providerEnabled: true,
      investigation: {
        registry: registry(),
        resolveScope: () => ({ scope: s, isCurrent: () => true }),
      },
    });
    const record = await runtime.submitTask(draft(s));
    expect(record.state).toBe("completed");
    expect(complete).toHaveBeenCalledTimes(2);
    expect(runtime.getTaskRun(record.id)?.runId).toBe(s.runId);
  });
});
