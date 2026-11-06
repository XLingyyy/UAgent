import { describe, expect, it } from "vitest";
import type { ProviderRuntimeRequest, ProviderRuntimeResponse, TaskDraft, TaskRunScope } from "@uagent/shared";
import { RunHost } from "./run-host.js";
import { ToolRegistry } from "./tool-registry.js";
import type { RunCoordinatorOptions } from "./run-coordinator.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function setup() {
  const entered = deferred<ProviderRuntimeRequest>();
  const response = deferred<ProviderRuntimeResponse>();
  const scope: TaskRunScope = {
    id: "scope", runId: "run", projectId: "project", conversationId: "chat", rootRef: "root",
    providerId: "synthetic", modelId: "test", endpoint: "https://invalid.example", mode: "read_only",
    readPrefixes: [""], sharePrefixes: [""], toolIds: ["read"], expiresAt: Date.now() + 60000,
    limits: { maxToolCalls: 3, maxModelRequests: 4, maxDurationMs: 60000,
      maxAttemptsPerFailure: 2, maxToolResultBytes: 8192, maxContextBytes: 24576 },
  };
  const draft: TaskDraft = { input: "Read the value", taskMode: "investigation", projectId: scope.projectId,
    conversationId: scope.conversationId, providerId: scope.providerId, modelId: scope.modelId,
    investigationScopeId: scope.id, permissionMode: "request_approval", reasoningEffort: "low",
    runMode: "local", branch: null, contextPercent: null };
  let current = true;
  let reads = 0;
  const commits: string[] = [];
  const reply = (request: ProviderRuntimeRequest, tools = false): ProviderRuntimeResponse => ({
    id: request.id + ":reply", requestId: request.id, providerId: scope.providerId, modelId: scope.modelId,
    text: tools ? "" : "Value is 7", finishReason: tools ? "tool_calls" : "stop", createdAt: Date.now(),
    ...(tools ? { toolCalls: [{ id: "call", name: "read", arguments: "{}" }] } : {}),
  });
  const options: RunCoordinatorOptions = {
    lease: { scope, isCurrent: () => current },
    adapter: {
      id: scope.providerId,
      getCapabilities: () => ({ providerId: scope.providerId, modelIds: [scope.modelId], supportsTools: true,
        supportsStreaming: false, isMock: true }),
      complete: async request => {
        if (request.messages.some(message => message.role === "tool")) return reply(request);
        entered.resolve(request);
        return response.promise;
      },
    },
    registry: new ToolRegistry([{
      id: "read", definition: { name: "read", description: "Read test value", parameters: { type: "object" } },
      validate: () => {}, paths: () => [], execute: async () => {
        reads++;
        return { status: "completed", effectState: "not_started", output: { value: 7 }, sources: [], truncated: false };
      },
    }]),
    store: { commit: async commit => { commits.push(commit.run.status); } },
  };
  return { options, draft, entered, response, reply, commits, reads: () => reads, revoke: () => { current = false; } };
}

describe("coordinator host lifecycle", () => {
  it("continues after a view detaches and gives a new view the latest immutable snapshot", async () => {
    const f = setup(), host = new RunHost();
    const pending = host.start("task", f.draft, f.options);
    const request = await f.entered.promise;
    let deliveries = 0;
    const detach = host.subscribe("run", snapshot => { deliveries++; snapshot.run.goal = "changed by view"; });
    expect(deliveries).toBe(1);
    const revision = host.getSnapshot("run")!.revision;
    detach();
    f.response.resolve(f.reply(request, true));
    expect((await pending).run.status).toBe("completed");
    expect(f.reads()).toBe(1);
    expect(deliveries).toBe(1);
    const snapshot = host.getSnapshot("run")!;
    expect(snapshot.revision).toBeGreaterThan(revision);
    expect(snapshot.run.goal).toBe(f.draft.input);
    expect(snapshot.settled).toBe(true);
    let reattached = "";
    host.subscribe("run", next => { reattached = next.text; });
    expect(reattached).toBe("Value is 7");
  });

  it("does not let an observer exception abort a tool or persistence", async () => {
    const f = setup(), host = new RunHost();
    const pending = host.start("task", f.draft, f.options);
    const request = await f.entered.promise;
    host.subscribe("run", () => { throw Error("view was destroyed"); });
    f.response.resolve(f.reply(request, true));
    expect((await pending).run.status).toBe("completed");
    expect(f.commits.at(-1)).toBe("completed");
  });

  it("pauses before dispatch on shutdown, persists the checkpoint and rejects new work", async () => {
    const f = setup(), host = new RunHost();
    const pending = host.start("task", f.draft, f.options);
    const request = await f.entered.promise;
    const closing = host.close();
    f.response.resolve(f.reply(request, true));
    expect((await pending).run.status).toBe("paused");
    await closing;
    expect(f.reads()).toBe(0);
    expect(f.commits.at(-1)).toBe("paused");
    expect(() => host.resume("run")).toThrow("run_host_closed");
    expect(() => host.start("another", f.draft, f.options)).toThrow("run_host_closed");
  });

  it("cannot renew revoked execution authority by reattaching or resuming", async () => {
    const f = setup(), host = new RunHost();
    const pending = host.start("task", f.draft, f.options);
    const request = await f.entered.promise;
    f.revoke();
    host.subscribe("run", () => {});
    f.response.resolve(f.reply(request, true));
    expect((await pending).run.stopReason).toBe("scope_expired");
    expect((await host.resume("run")).run.stopReason).toBe("scope_expired");
    expect(f.reads()).toBe(0);
  });

  it("resumes a paused call once and rejects concurrent resume or duplicate starts", async () => {
    const f = setup(), host = new RunHost();
    const pending = host.start("task", f.draft, f.options);
    const request = await f.entered.promise;
    expect(() => host.start("task", f.draft, f.options)).toThrow("run_already_started");
    expect(() => host.resume("run")).toThrow("run_still_running");
    host.pause("run");
    f.response.resolve(f.reply(request, true));
    expect((await pending).run.status).toBe("paused");
    expect((await host.resume("run")).run.status).toBe("completed");
    expect(f.reads()).toBe(1);
  });

  it("waits for paused-run cancellation persistence when shutdown races it", async () => {
    const f = setup(), host = new RunHost();
    const saving = deferred<void>(), saved = deferred<void>();
    const commit = f.options.store!.commit;
    f.options.store!.commit = async update => {
      if (update.run.status === "cancelled") { saving.resolve(); await saved.promise; }
      await commit(update);
    };
    const pending = host.start("task", f.draft, f.options);
    const request = await f.entered.promise;
    host.pause("run");
    f.response.resolve(f.reply(request, true));
    await pending;
    const cancelling = host.cancel("run");
    await saving.promise;
    const closing = host.close();
    expect(host.getSnapshot("run")!.settled).toBe(false);
    saved.resolve();
    await cancelling;
    expect((await closing).checkpointed).toBe(true);
    expect(host.getSnapshot("run")!.run.status).toBe("cancelled");
    expect(f.commits.at(-1)).toBe("cancelled");
  });
});
