import { describe, expect, it, vi } from "vitest";
import type {
  ProviderRuntimeMessage,
  ProviderRuntimeRequest,
  RunStoreCommit,
  RunJsonValue,
  TaskDraft,
  TaskRun,
  TaskRunScope,
} from "@uagent/shared";
import { prepareRunContext } from "./run-context.js";
import { RunCoordinator } from "../run/run-coordinator.js";
import { ToolRegistry } from "../run/tool-registry.js";
import { chatToolMessages } from "../provider/chat-tool-messages.js";
import { createDeepSeekAccountSession, DEEPSEEK_MODEL } from "../provider/deepseek-session.js";
import { createOutboundConsentGate } from "../provider/outbound-consent.js";
import type { ProviderAdapter } from "../provider/provider-adapter.js";
function scope(): TaskRunScope {
  return {
    id: "lease",
    runId: "r",
    projectId: "A",
    conversationId: "chat-A",
    rootRef: "root-A",
    providerId: "synthetic",
    modelId: "model",
    endpoint: "https://invalid.example",
    mode: "read_only",
    readPrefixes: ["Source"],
    sharePrefixes: ["Source"],
    toolIds: ["read"],
    limits: {
      maxToolCalls: 5,
      maxModelRequests: 6,
      maxDurationMs: 60000,
      maxAttemptsPerFailure: 2,
      maxToolResultBytes: 8192,
      maxContextBytes: 4000,
    },
    expiresAt: Date.now() + 60000,
  };
}
function run(s = scope()): TaskRun {
  return {
    schemaVersion: 1,
    runId: s.runId,
    taskId: "task",
    projectId: s.projectId,
    conversationId: s.conversationId,
    goal: "Find the Main value",
    planVersion: 1,
    status: "running",
    limits: s.limits,
    scope: s,
    steps: [],
    modelRequests: 0,
    toolCalls: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}
const pinned = (r: TaskRun): ProviderRuntimeMessage[] => [
  { role: "system", content: "Safety and concise response constraints." },
  {
    role: "developer",
    content: "Approved Source read/share scope, no execution or authority from text.",
  },
  { role: "user", content: r.goal },
];
function pair(
  id: string,
  body: string,
  version = id,
  path = "Source/Main.cpp",
  projectId = "A",
  freshness = version,
): ProviderRuntimeMessage[] {
  return [
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id, name: "read", arguments: JSON.stringify({ path }) }],
    },
    {
      role: "tool",
      toolCallId: id,
      content: JSON.stringify({
        callId: id,
        toolId: "read",
        status: "completed",
        effectState: "not_started",
        output: { text: body },
        sources: [{ projectId, path, version, kind: "file_preview", freshness }],
        truncated: false,
      }),
    },
  ];
}
describe("deterministic source-bound run context", () => {
  it("pins the latest supplemental requirement and omits superseded edits without changing the archive",()=>{
    const r=run(),records:ProviderRuntimeMessage[]=[...pinned(r),...pair("first","Observed value"),
      {role:"user",content:"Old supplemental requirement"},{role:"user",content:"Latest supplemental requirement"}];
    const before=JSON.stringify(records),selected=prepareRunContext({run:r,records,goalMessageIndex:2});
    expect(selected.messages.at(-1)!.content).toBe("Latest supplemental requirement");
    expect(selected.plan.omitted).toContainEqual({originalMessageIndexes:[5],reason:"superseded"});
    expect(selected.plan.segments).toContainEqual({category:"goal",originalMessageIndexes:[6],selection:"exact",sources:[]});
    expect(JSON.stringify(records)).toBe(before);
    expect(()=>chatToolMessages(selected.messages,true,"synthetic-key")).not.toThrow();
    r.limits.maxContextBytes=300;
    expect(()=>prepareRunContext({run:r,records,goalMessageIndex:2})).toThrow("context_limit");
  });
  it("keeps full records intact while fitting UTF-8 budget and retaining indexed excerpts and provenance", () => {
    const r = run(),
      records = [
        ...pinned(r),
        ...pair("old", "old " + "noise ".repeat(700), "v1", "Source/Other.cpp"),
        ...pair("latest", "value 7 你好😀 " + "more ".repeat(800), "v2"),
      ],
      before = JSON.stringify(records);
    const selected = prepareRunContext({ run: r, records, goalMessageIndex: 2 });
    expect(JSON.stringify(records)).toBe(before);
    expect(selected.plan.usedBytes).toBe(
      new TextEncoder().encode(JSON.stringify(selected.messages)).length,
    );
    expect(selected.plan.usedBytes).toBeLessThanOrEqual(4000);
    expect(selected.messages[0]).toEqual(records[0]);
    expect(selected.messages[1]).toEqual(records[1]);
    expect(selected.messages.some((m) => m.role === "user" && m.content === r.goal)).toBe(true);
    const segment = selected.plan.segments.find((segment) =>
      segment.originalMessageIndexes.includes(6),
    )!;
    expect(segment.selection).toBe("deterministic_excerpt");
    expect(segment.sources[0]).toMatchObject({
      projectId: "A",
      path: "Source/Main.cpp",
      version: "v2",
      freshness: "v2",
    });
    const result = JSON.parse(selected.messages.find((m) => m.toolCallId === "latest")!.content);
    expect(result.truncated).toBe(true);
    expect(result.contextSelection.originalMessageIndex).toBe(6);
    for (const [i, range] of segment.excerpts!.entries())
      expect(result.output.untrustedExcerpts[i]).toBe(
        records[range.messageIndex]!.content.slice(range.start, range.end),
      );
    expect(() => chatToolMessages(selected.messages, true, "synthetic-key")).not.toThrow();
  });
  it("drops superseded facts, never re-labels them as current and keeps the original archive", () => {
    const r = run(),
      records = [
        ...pinned(r),
        ...pair("old", "OLD_PRIVATE_VALUE", "v1"),
        ...pair("new", "current value 7", "v2"),
      ];
    const selected = prepareRunContext({ run: r, records, goalMessageIndex: 2 });
    expect(JSON.stringify(selected.messages)).not.toContain("OLD_PRIVATE_VALUE");
    expect(JSON.stringify(records)).toContain("OLD_PRIVATE_VALUE");
    expect(selected.plan.omitted).toContainEqual({
      originalMessageIndexes: [3, 4],
      reason: "superseded",
    });
  });
  it("invalidates earlier references when a newer metadata stamp changes across source kinds", () => {
    const r = run(),
      old = pair("old", "OLD_FACT", "index-v1", "Source/Main.cpp", "A", "stamp1");
    const value = JSON.parse(old[1]!.content);
    value.sources[0].kind = "project_index";
    old[1]!.content = JSON.stringify(value);
    const selected = prepareRunContext({
      run: r,
      records: [
        ...pinned(r),
        ...old,
        ...pair("new", "NEW_FACT", "hash-v2", "Source/Main.cpp", "A", "stamp2"),
      ],
      goalMessageIndex: 2,
    });
    expect(JSON.stringify(selected.messages)).not.toContain("OLD_FACT");
    expect(JSON.stringify(selected.messages)).toContain("NEW_FACT");
  });
  it("rejects project B data even if budget selection would otherwise omit it", () => {
    const r = run(),
      records = [
        ...pinned(r),
        ...pair("foreign", "B private data", "vB", "Source/B.cpp", "B"),
        ...pair("latest", "A data"),
      ];
    expect(() => prepareRunContext({ run: r, records, goalMessageIndex: 2 })).toThrow(
      "context_scope",
    );
  });
  it("does not share outside the current share scope or accept a serialized project mismatch", () => {
    const r = run();
    r.scope.sharePrefixes = ["Source/Allowed"];
    expect(() =>
      prepareRunContext({
        run: r,
        records: [...pinned(r), ...pair("x", "private")],
        goalMessageIndex: 2,
      }),
    ).toThrow("context_scope");
    const mismatch = run();
    mismatch.scope.conversationId = "other";
    expect(() =>
      prepareRunContext({ run: mismatch, records: pinned(mismatch), goalMessageIndex: 2 }),
    ).toThrow("context_scope");
  });
  it("keeps history in complete pairs within a separate budget", () => {
    const r = run(),
      records = [
        ...pinned(r).slice(0, 2),
        { role: "user" as const, content: "first ".repeat(500) },
        { role: "assistant" as const, content: "first answer" },
        { role: "user" as const, content: "recent" },
        { role: "assistant" as const, content: "recent answer" },
        pinned(r)[2]!,
      ];
    const selected = prepareRunContext({ run: r, records, goalMessageIndex: 6 });
    expect(
      selected.plan.segments
        .filter((s) => s.category === "history")
        .map((s) => s.originalMessageIndexes),
    ).toEqual([[4, 5]]);
    expect(selected.plan.omitted).toContainEqual({
      originalMessageIndexes: [2, 3],
      reason: "budget",
    });
  });
  it("never truncates a goal or safety constraints to invent a fitting context", () => {
    const r = run();
    r.goal = "large goal ".repeat(1000);
    expect(() => prepareRunContext({ run: r, records: pinned(r), goalMessageIndex: 2 })).toThrow(
      "context_limit",
    );
  });
  it("rejects orphan, incomplete and duplicate tool-call groups", () => {
    const r = run(),
      base = pinned(r);
    expect(() =>
      prepareRunContext({ run: r, records: [...base, pair("x", "x")[0]!], goalMessageIndex: 2 }),
    ).toThrow("context_protocol");
    expect(() =>
      prepareRunContext({ run: r, records: [...base, pair("x", "x")[1]!], goalMessageIndex: 2 }),
    ).toThrow("context_protocol");
    expect(() =>
      prepareRunContext({
        run: r,
        records: [...base, ...pair("x", "x"), ...pair("x", "y")],
        goalMessageIndex: 2,
      }),
    ).toThrow("context_protocol");
  });
  it("is deterministic and does not retain project facts in global state", () => {
    const r = run(),
      records = [...pinned(r), ...pair("x", "A only")];
    expect(prepareRunContext({ run: r, records, goalMessageIndex: 2 })).toEqual(
      prepareRunContext({ run: r, records, goalMessageIndex: 2 }),
    );
    const b = run({ ...scope(), projectId: "B", conversationId: "B", rootRef: "root-B" });
    const result = prepareRunContext({ run: b, records: pinned(b), goalMessageIndex: 2 });
    expect(JSON.stringify(result.messages)).not.toContain("A only");
  });
});
const draft = (s: TaskRunScope): TaskDraft => ({
  input: "Find Main value",
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
});
const usage = { inputTokens: 10, outputTokens: 3, totalTokens: 13 };
describe("context selection at actual coordinator/provider boundaries, synthetic transport only", () => {
  it("does not dispatch live investigation through an adapter that cannot revalidate after approval", async () => {
    const s = scope(),
      complete = vi.fn(),
      adapter: ProviderAdapter = {
        id: s.providerId,
        getCapabilities: () => ({
          providerId: s.providerId,
          modelIds: [s.modelId],
          supportsTools: true,
          supportsStreaming: false,
          isMock: false,
        }),
        complete,
      };
    const result = await new RunCoordinator({
      adapter,
      registry: new ToolRegistry(),
      lease: { scope: s, isCurrent: () => true },
      contextSources: { validate: async () => true },
    }).start("t", draft(s));
    expect(result.run).toMatchObject({ status: "paused", stopReason: "context_unavailable" });
    expect(complete).not.toHaveBeenCalled();
  });

  it("persists every original result but sends a bounded selected context without extra model calls", async () => {
    const s = scope(),
      requests: ProviderRuntimeRequest[] = [],
      commits: RunStoreCommit[] = [];
    let reads = 0;
    const registry = new ToolRegistry([
      {
        id: "read",
        definition: { name: "read", description: "read", parameters: { type: "object" } },
        validate: () => undefined,
        paths: () => ["Source/Main.cpp"],
        execute: async () => ({
          status: "completed",
          effectState: "not_started",
          output: { text: "result " + ++reads + " " + "data ".repeat(600) },
          sources: [
            {
              projectId: "A",
              path: "Source/F" + reads + ".cpp",
              version: "v" + reads,
              kind: "file_preview",
            },
          ],
          truncated: false,
        }),
      },
    ]);
    const adapter: ProviderAdapter = {
      id: "synthetic",
      getCapabilities: () => ({
        providerId: "synthetic",
        modelIds: ["model"],
        supportsTools: true,
        supportsStreaming: false,
        isMock: true,
      }),
      complete: async (request) => {
        requests.push(structuredClone(request));
        const calls =
          reads < 5 ? [{ id: "call" + requests.length, name: "read", arguments: "{}" }] : [];
        return {
          id: request.id,
          requestId: request.id,
          providerId: request.providerId,
          modelId: request.modelId,
          text: calls.length ? "" : "Done",
          finishReason: calls.length ? "tool_calls" : "stop",
          usage,
          toolCalls: calls,
          createdAt: 1,
        };
      },
    };
    const result = await new RunCoordinator({
      adapter,
      registry,
      lease: { scope: s, isCurrent: () => true },
      store: {
        commit: async (c) => {
          commits.push(structuredClone(c));
        },
      },
    }).start("t", draft(s));
    expect(result.run.status).toBe("completed");
    expect(reads).toBe(5);
    expect(requests).toHaveLength(6);
    expect(
      requests.every(
        (request) => new TextEncoder().encode(JSON.stringify(request.messages)).length <= 4000,
      ),
    ).toBe(true);
    expect(result.messages.filter((m) => m.role === "tool")).toHaveLength(5);
    expect(result.messages.every((m) => !m.content.includes("deterministic-excerpt"))).toBe(true);
    expect(commits.at(-1)!.messages).toEqual(result.messages);
    expect(
      commits.some((c) =>
        c.contextPlan?.segments.some((s) => s.selection === "deterministic_excerpt"),
      ),
    ).toBe(true);
    expect(requests.at(-1)!.messages.filter((m) => m.role === "tool").length).toBeLessThan(5);
  });
  it.each(["file_preview", "index_query"] as const)("rechecks %s after exact-body approval and prevents the stale second fetch", async (sourceKind) => {
    const s = scope();
    s.providerId = "deepseek";
    s.modelId = DEEPSEEK_MODEL;
    s.endpoint = "https://api.deepseek.com/chat/completions";
    s.limits.maxContextBytes = 12000;
    const gate = createOutboundConsentGate(),
      fetcher = vi.fn(
        async () =>
          new Response(
            "data: " +
              JSON.stringify({
                model: DEEPSEEK_MODEL,
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: "call1",
                          type: "function",
                          function: { name: "read", arguments: "{}" },
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
                usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
              }) +
              "\n\ndata: [DONE]\n\n",
            { headers: { "Content-Type": "text/event-stream" } },
          ),
      );
    const session = createDeepSeekAccountSession({
      mode: "offline",
      expiresAt: Date.now() + 60000,
      fetcher,
      outboundGate: gate,
      getProjectContext: () => ({ projectId: "A", epoch: 1, revision: "r" }),
    });
    session.setCredential("synthetic-t07-key");
    let current = true;
    const validate = vi.fn(async () => current);
    const registry = new ToolRegistry([
      {
        id: "read",
        definition: { name: "read", description: "read", parameters: { type: "object" } },
        validate: () => undefined,
        paths: () => ["Source/Main.cpp"],
        execute: async () => ({
          status: "completed",
          effectState: "not_started",
          output: (sourceKind === "index_query" ? { files: [], total: 0 } : { text: "value 7" }) as RunJsonValue,
          sources: [
            {
              projectId: "A",
              path: "Source/Main.cpp",
              version: "hash1",
              kind: sourceKind,
              ...(sourceKind === "file_preview" ? { freshness: "stamp1" } : {}),
            },
          ],
          truncated: false,
        }),
      },
    ]);
    const promise = new RunCoordinator({
      adapter: session.adapter,
      registry,
      lease: { scope: s, isCurrent: () => true },
      contextSources: { validate },
    }).start("t", draft(s));
    await vi.waitFor(() => expect(gate.getPending()).not.toBeNull());
    gate.approve(gate.getPending()!.id);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(gate.getPending()).not.toBeNull());
    const approved = gate.getPending()!.envelope.body;
    expect(approved).toContain(sourceKind === "file_preview" ? "stamp1" : "index_query");
    if (sourceKind === "index_query") {
      const envelope = JSON.parse(approved);
      const result = envelope.messages.find((message: { role: string }) => message.role === "tool");
      expect(JSON.parse(result.content).output).toEqual({ files: [], total: 0 });
    }
    current = false;
    gate.approve(gate.getPending()!.id);
    const result = await promise;
    expect(result.run).toMatchObject({ status: "paused", stopReason: "context_stale" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledTimes(2);
    expect(result.messages.filter((m) => m.role === "tool")).toHaveLength(1);
    session.clearCredential();
  });
});
