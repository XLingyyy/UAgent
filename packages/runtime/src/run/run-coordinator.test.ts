import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type {
  ProviderRuntimeRequest,
  ProviderRuntimeResponse,
  RunStorePort,
  TaskDraft,
  TaskRunScope,
} from "@uagent/shared";
import type { ProviderAdapter } from "../provider/provider-adapter.js";
import { RunCoordinator } from "./run-coordinator.js";
import { ToolRegistry } from "./tool-registry.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    const absolute = resolve(root);
    if (
      dirname(absolute) !== resolve(tmpdir()) ||
      !absolute.startsWith(join(resolve(tmpdir()), "uagent-run-read-"))
    )
      throw Error("unsafe fixture cleanup");
    rmSync(absolute, { recursive: true });
  }
});
const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
function scope(overrides: Partial<TaskRunScope> = {}): TaskRunScope {
  return {
    id: "scope-1",
    runId: "run-1",
    projectId: "p1",
    conversationId: "c1",
    rootRef: "opaque-root",
    providerId: "synthetic",
    modelId: "model",
    endpoint: "https://invalid.example",
    mode: "read_only",
    readPrefixes: [""],
    sharePrefixes: [""],
    toolIds: ["project.read"],
    expiresAt: Date.now() + 60000,
    limits: {
      maxToolCalls: 3,
      maxModelRequests: 4,
      maxDurationMs: 60000,
      maxAttemptsPerFailure: 2,
      maxToolResultBytes: 8192,
      maxContextBytes: 24576,
    },
    ...overrides,
  };
}
function draft(s: TaskRunScope): TaskDraft {
  return {
    input: "Follow the project references and explain the value.",
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
function answer(
  request: ProviderRuntimeRequest,
  text: string,
  call?: { id: string; name: string; arguments: string },
): ProviderRuntimeResponse {
  return {
    id: "response-" + request.id,
    requestId: request.id,
    providerId: request.providerId,
    modelId: request.modelId,
    text,
    finishReason: call ? "tool_calls" : "stop",
    usage,
    createdAt: Date.now(),
    ...(call ? { toolCalls: [call] } : {}),
  };
}
function adapter(
  fn: (r: ProviderRuntimeRequest) => Promise<ProviderRuntimeResponse>,
): ProviderAdapter {
  return {
    id: "synthetic",
    getCapabilities: () => ({
      providerId: "synthetic",
      modelIds: ["model"],
      supportsTools: true,
      supportsStreaming: false,
      isMock: true,
    }),
    complete: fn,
  };
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "uagent-run-read-"));
  roots.push(root);
  mkdirSync(join(root, "Source"));
  writeFileSync(join(root, "manifest.json"), '{"next":"Source/Main.cpp"}');
  writeFileSync(join(root, "Source/Main.cpp"), '{"next":"Source/Value.h"}');
  writeFileSync(join(root, "Source/Value.h"), '{"value":7}');
  const reads: string[] = [];
  const registry = new ToolRegistry([
    {
      id: "project.read",
      definition: {
        name: "project_read_file",
        description: "Read scoped text",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
          additionalProperties: false,
        },
      },
      validate: (args) => {
        if (Object.keys(args).length !== 1 || typeof args.path !== "string") throw Error("schema");
      },
      paths: (args) => [args.path as string],
      execute: async (args, context) => {
        reads.push(args.path as string);
        const text = readFileSync(join(root, args.path as string), "utf8");
        return {
          status: "completed",
          effectState: "not_started",
          output: { text },
          sources: [
            {
              projectId: context.projectId,
              path: args.path as string,
              version: createHash("sha256").update(text).digest("hex"),
              kind: "file_preview",
            },
          ],
          truncated: false,
        };
      },
    },
  ]);
  return { root, reads, registry };
}

describe("bounded run coordinator using synthetic models and actual isolated filesystem reads", () => {
  it("follows three causally dependent reads and feeds exact call IDs/results back to the model", async () => {
    const f = fixture(),
      requests: ProviderRuntimeRequest[] = [],
      s = scope(),
      commits: unknown[] = [];
    const provider = adapter(async (request) => {
      requests.push(structuredClone(request));
      const last = request.messages[request.messages.length - 1]!;
      if (last.role === "user")
        return answer(request, "", {
          id: "call_identifier_preserved_00000000000001",
          name: "project_read_file",
          arguments: '{"path":"manifest.json"}',
        });
      const result = JSON.parse(last.content);
      const data = JSON.parse(result.output.text);
      if (data.next)
        return answer(request, "", {
          id: "call_identifier_preserved_0000000000000" + requests.length,
          name: "project_read_file",
          arguments: JSON.stringify({ path: data.next }),
        });
      return answer(request, "The value is " + data.value + ". Source: Source/Value.h.");
    });
    const run = new RunCoordinator({
      adapter: provider,
      registry: f.registry,
      lease: { scope: s, isCurrent: () => true },
      store: {
        commit: async (update) => {
          commits.push(update);
        },
      },
    });
    const result = await run.start("task-1", draft(s));
    expect(result.run.status).toBe("completed");
    expect(f.reads).toEqual(["manifest.json", "Source/Main.cpp", "Source/Value.h"]);
    expect(requests).toHaveLength(4);
    expect(result.text).toContain("value is 7");
    expect(result.run.steps.every((step) => step.status === "completed")).toBe(true);
    expect(requests[1]!.messages.slice(-2).map((m) => m.role)).toEqual(["assistant", "tool"]);
    expect(requests[1]!.messages.at(-1)!.toolCallId).toBe(
      "call_identifier_preserved_00000000000001",
    );
    expect(JSON.parse(requests[1]!.messages.at(-1)!.content).sources[0].version).toMatch(
      /^[a-f0-9]{64}$/,
    );
    const eventSequences = commits.flatMap((x) =>
      (x as { events: { sequence: number }[] }).events.map((e) => e.sequence),
    );
    expect(eventSequences).toEqual([...new Set(eventSequences)].sort((a, b) => a - b));
  });
  it("pauses at the tool limit without a fourth read or a false completed state", async () => {
    const f = fixture(),
      s = scope();
    s.limits.maxToolCalls = 2;
    const complete = vi.fn(
      async (r: ProviderRuntimeRequest): Promise<ProviderRuntimeResponse> =>
        answer(r, "", {
          id: "call_" + complete.mock.calls.length,
          name: "project_read_file",
          arguments: '{"path":"manifest.json"}',
        }),
    );
    const result = await new RunCoordinator({
      adapter: adapter(complete),
      registry: f.registry,
      lease: { scope: s, isCurrent: () => true },
    }).start("task-1", draft(s));
    expect(result.run).toMatchObject({ status: "paused", stopReason: "tool_limit", toolCalls: 2 });
    expect(f.reads).toHaveLength(2);
    expect(complete).toHaveBeenCalledTimes(3);
    expect(result.checkpoint?.completedStepIds).toHaveLength(2);
  });
  it("does not share a read result outside the separate sharing scope", async () => {
    const f = fixture(),
      s = scope({ sharePrefixes: [] });
    const complete = vi.fn(
      async (r: ProviderRuntimeRequest): Promise<ProviderRuntimeResponse> =>
        answer(r, "", {
          id: "call_1",
          name: "project_read_file",
          arguments: '{"path":"manifest.json"}',
        }),
    );
    const result = await new RunCoordinator({
      adapter: adapter(complete),
      registry: f.registry,
      lease: { scope: s, isCurrent: () => true },
    }).start("task-1", draft(s));
    expect(result.run).toMatchObject({ status: "paused", stopReason: "sharing_scope" });
    expect(f.reads).toHaveLength(1);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.messages.filter((m) => m.role === "tool")).toHaveLength(0);
  });
  it("cancel during an already-started read discards the late result and prevents further scheduling", async () => {
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>((r) => {
        started = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    const s = scope(),
      calls = vi.fn(async () => {
        started();
        await gate;
        return {
          status: "completed" as const,
          effectState: "not_started" as const,
          output: { text: "late" },
          sources: [],
          truncated: false,
        };
      });
    const registry = new ToolRegistry([
      {
        id: "project.read",
        definition: { name: "read", description: "read", parameters: { type: "object" } },
        validate: () => undefined,
        paths: () => [],
        execute: calls,
      },
    ]);
    const complete = vi.fn(
      async (r: ProviderRuntimeRequest): Promise<ProviderRuntimeResponse> =>
        answer(r, "", { id: "call_1", name: "read", arguments: "{}" }),
    );
    const run = new RunCoordinator({
      adapter: adapter(complete),
      registry,
      lease: { scope: s, isCurrent: () => true },
    });
    const pending = run.start("task-1", draft(s));
    await waiting;
    run.cancel();
    release();
    const result = await pending;
    expect(result.run.status).toBe("cancelled");
    expect(result.run.steps.some((step) => step.status === "completed")).toBe(false);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(result.messages.some((m) => m.role === "tool")).toBe(false);
  });
  it("pause at a read boundary resumes from its actual result without executing it twice", async () => {
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>((r) => {
        started = r;
      }),
      gate = new Promise<void>((r) => {
        release = r;
      });
    const s = scope(),
      read = vi.fn(async () => {
        started();
        await gate;
        return {
          status: "completed" as const,
          effectState: "not_started" as const,
          output: { text: "read once" },
          sources: [],
          truncated: false,
        };
      });
    const registry = new ToolRegistry([
      {
        id: "project.read",
        definition: { name: "read", description: "read", parameters: { type: "object" } },
        validate: () => undefined,
        paths: () => [],
        execute: read,
      },
    ]);
    const complete = vi.fn(
      async (r: ProviderRuntimeRequest): Promise<ProviderRuntimeResponse> =>
        complete.mock.calls.length === 1
          ? answer(r, "", { id: "call_1", name: "read", arguments: "{}" })
          : answer(r, "Read finished."),
    );
    const run = new RunCoordinator({
      adapter: adapter(complete),
      registry,
      lease: { scope: s, isCurrent: () => true },
    });
    const pending = run.start("task-1", draft(s));
    await waiting;
    run.requestPause();
    release();
    const paused = await pending;
    expect(paused.run.status).toBe("paused");
    expect(paused.run.steps[0]!.status).toBe("completed");
    const resumed = await run.resume();
    expect(resumed.run.status).toBe("completed");
    expect(read).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledTimes(2);
  });
  it("revokes stale leases after a model await before any tool starts", async () => {
    const f = fixture(),
      s = scope();
    let current = true;
    const complete = vi.fn(async (r: ProviderRuntimeRequest): Promise<ProviderRuntimeResponse> => {
      current = false;
      return answer(r, "", {
        id: "call_1",
        name: "project_read_file",
        arguments: '{"path":"manifest.json"}',
      });
    });
    const result = await new RunCoordinator({
      adapter: adapter(complete),
      registry: f.registry,
      lease: { scope: s, isCurrent: () => current },
    }).start("task-1", draft(s));
    expect(result.run).toMatchObject({ status: "paused", stopReason: "scope_expired" });
    expect(f.reads).toHaveLength(0);
  });
  it("persists tool intent before execution and pauses on transaction failure", async () => {
    const f = fixture(),
      s = scope();
    const complete = vi.fn(
      async (r: ProviderRuntimeRequest): Promise<ProviderRuntimeResponse> =>
        answer(r, "", {
          id: "call_1",
          name: "project_read_file",
          arguments: '{"path":"manifest.json"}',
        }),
    );
    const store: RunStorePort = {
      commit: async (update) => {
        if (update.events.some((e) => e.type === "tool_started"))
          throw Error("synthetic storage failure");
      },
    };
    const result = await new RunCoordinator({
      adapter: adapter(complete),
      registry: f.registry,
      lease: { scope: s, isCurrent: () => true },
      store,
    }).start("task-1", draft(s));
    expect(result.run).toMatchObject({ status: "paused", stopReason: "persistence_failed" });
    expect(f.reads).toHaveLength(0);
  });
  it("rejects a mismatched project and scope before any model request", async () => {
    const f = fixture(),
      s = scope(),
      complete = vi.fn();
    await expect(
      new RunCoordinator({
        adapter: adapter(complete),
        registry: f.registry,
        lease: { scope: s, isCurrent: () => true },
      }).start("task-1", { ...draft(s), projectId: "p2" }),
    ).rejects.toThrow("run_scope_mismatch");
    expect(complete).not.toHaveBeenCalled();
    expect(f.reads).toHaveLength(0);
  });
});
