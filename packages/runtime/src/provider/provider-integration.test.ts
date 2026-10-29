import { describe, expect, it, vi } from "vitest";
import type {
  ProviderContinuationOwner,
  ProviderContinuationStorePort,
  ProviderNativeContinuation,
  ProviderRuntimeRequest,
  RunStoreCommit,
  TaskDraft,
  TaskEvent,
  TaskRunScope,
} from "@uagent/shared";
import { createProviderRuntimeSession } from "./provider-session.js";
import { createOutboundConsentGate } from "./outbound-consent.js";
import { ProviderRegistry } from "./provider-registry.js";
import { RunCoordinator } from "../run/run-coordinator.js";
import { ToolRegistry } from "../run/tool-registry.js";
import { runProviderComplete, runProviderStream } from "./provider-runner.js";
import { mapProviderRuntimeEvent } from "./provider-event-bridge.js";
import { extractProviderTraceSummary, formatProviderTraceSummary } from "./provider-trace.js";

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const credential = "synthetic-runtime-key-12345";
const model = "explicit-runtime-model";
const endpoint = "https://synthetic.invalid/v1/responses";
const owner: ProviderContinuationOwner = {
  providerId: "responses-test",
  modelId: model,
  projectId: "p1",
  projectEpoch: 7,
  runId: "r1",
  conversationId: "c1",
};
const context = () => ({ projectId: "p1", epoch: 7, revision: "v1" });
const definition = {
  name: "project_read_file",
  description: "Read selected data",
  parameters: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
    additionalProperties: false,
  },
};
const req = (patch: Partial<ProviderRuntimeRequest> = {}): ProviderRuntimeRequest => ({
  id: "request-1",
  providerId: owner.providerId,
  modelId: model,
  messages: [{ role: "user", content: "Read project data" }],
  tools: [definition],
  ...patch,
});
function body(index = 1, path?: string, usage: unknown = null) {
  const output: Array<Record<string, unknown> & { type: string; id: string }> = path
    ? [
        {
          type: "reasoning",
          id: "rs_" + index,
          summary: [],
          encrypted_content: "native-private-" + index,
        },
        {
          type: "function_call",
          id: "fc_" + index,
          call_id: "call_" + index,
          name: "project_read_file",
          arguments: JSON.stringify({ path }),
          status: "completed",
        },
      ]
    : [
        {
          type: "message",
          id: "msg_" + index,
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "Value is 7", annotations: [] }],
          phase: "final_answer",
        },
      ];
  return { id: "resp_" + index, model, status: "completed", created_at: 1700000000, output, usage };
}
const json = (value = body()) =>
  new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
function sse(value: ReturnType<typeof body>) {
  const events: Record<string, unknown>[] = [
    { type: "response.created", response: { id: value.id, model, status: "in_progress" } },
  ];
  value.output.forEach((item, output_index) => {
    if (item.type === "function_call") {
      events.push({
        type: "response.output_item.added",
        output_index,
        item: { ...item, arguments: "" },
      });
      events.push({
        type: "response.function_call_arguments.delta",
        output_index,
        item_id: item.id,
        delta: item.arguments,
      });
    } else events.push({ type: "response.output_item.added", output_index, item });
  });
  events.push({ type: "response.completed", response: value });
  return new Response(events.map((event) => "data: " + JSON.stringify(event) + "\n\n").join(""), {
    headers: { "Content-Type": "text/event-stream" },
  });
}
function memoryStore() {
  const records: ProviderNativeContinuation[] = [];
  const store: ProviderContinuationStorePort = {
    async load(query) {
      return clone(
        records.filter((record) => JSON.stringify(record.owner) === JSON.stringify(query)),
      );
    },
    async save(record) {
      const previous = records.find((value) => value.responseId === record.responseId);
      if (previous && JSON.stringify(previous) !== JSON.stringify(record))
        throw Error("immutable_record");
      if (!previous) records.push(clone(record));
    },
  };
  return { store, records };
}
const mockFetch = () => vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
function setup(
  fetcher: typeof fetch,
  store = memoryStore().store,
  gate = createOutboundConsentGate(),
) {
  gate.subscribe(() => {
    const pending = gate.getPending();
    if (pending) queueMicrotask(() => gate.approve(pending.id));
  });
  const session = createProviderRuntimeSession({
    wireApi: "responses",
    providerId: owner.providerId,
    modelId: model,
    endpoint,
    mode: "live",
    fetcher,
    outboundGate: gate,
    owner,
    isCurrent: () => true,
    getProjectContext: context,
    continuationStore: store,
  });
  return { session, gate };
}
const limits = {
  maxToolCalls: 3,
  maxModelRequests: 4,
  maxDurationMs: 60000,
  maxAttemptsPerFailure: 2,
  maxToolResultBytes: 8192,
  maxContextBytes: 24576,
};
const scope = (): TaskRunScope => ({
  id: "fresh-scope",
  runId: "r1",
  projectId: "p1",
  conversationId: "c1",
  rootRef: "fresh-native-root",
  providerId: owner.providerId,
  modelId: model,
  endpoint,
  mode: "read_only",
  readPrefixes: [""],
  sharePrefixes: [""],
  toolIds: ["project.read"],
  limits,
  expiresAt: Date.now() + 60000,
});
const draft = (s: TaskRunScope): TaskDraft => ({
  input: "Follow the project references and explain the value.",
  projectId: s.projectId,
  conversationId: s.conversationId,
  providerId: s.providerId,
  modelId: s.modelId,
  taskMode: "investigation",
  investigationScopeId: s.id,
  permissionMode: "request_approval",
  reasoningEffort: "low",
  runMode: "local",
  branch: null,
  contextPercent: null,
});
function tools(reads: string[]) {
  return new ToolRegistry([
    {
      id: "project.read",
      definition,
      validate(args) {
        if (typeof args.path !== "string" || Object.keys(args).length !== 1)
          throw Error("invalid_args");
      },
      paths: (args) => [args.path as string],
      async execute(args) {
        reads.push(args.path as string);
        return {
          status: "completed" as const,
          effectState: "not_started" as const,
          output: { value: args.path === "Source/Value.h" ? 7 : "next" },
          sources: [
            {
              projectId: "p1",
              path: args.path as string,
              version: "synthetic-v1",
              kind: "file_preview" as const,
            },
          ],
          truncated: false,
        };
      },
    },
  ]);
}

describe("explicit Responses runtime integration", () => {
  it("runs a real-contract three-tool loop with unknown usage, native replay and approved pre-send freshness", async () => {
    const persistence = memoryStore(),
      requests: Array<Record<string, unknown>> = [],
      paths = ["manifest.json", "Source/Main.cpp", "Source/Value.h"];
    const fetcher = mockFetch().mockImplementation(async (_url, init) => {
      const request = JSON.parse(init!.body as string);
      requests.push(request);
      const index = requests.length;
      expect(request.model).toBe(model);
      expect(request.messages).toBeUndefined();
      if (index > 1)
        expect(JSON.stringify(request.input)).toContain("native-private-" + (index - 1));
      return sse(
        body(
          index,
          paths[index - 1],
          index === 3 ? { input_tokens: 10, output_tokens: 5, total_tokens: 15 } : null,
        ),
      );
    });
    const { session } = setup(fetcher, persistence.store);
    session.setCredential(credential);
    const reads: string[] = [],
      commits: RunStoreCommit[] = [],
      events: TaskEvent[] = [];
    const validate = vi.fn(async () => true),
      s = scope();
    const coordinator = new RunCoordinator({
      adapter: session.adapter,
      registry: tools(reads),
      lease: { scope: s, isCurrent: () => true },
      contextSources: { validate },
      store: {
        async commit(update) {
          commits.push(clone(update));
        },
      },
      onProviderEvent(event) {
        events.push(...mapProviderRuntimeEvent(event, "t1", events.length + 1).taskEvents);
      },
    });
    const result = await coordinator.start("t1", draft(s));
    expect(result.run.status).toBe("completed");
    expect(reads).toEqual(paths);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(validate.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(persistence.records).toHaveLength(4);
    expect(
      persistence.records.every((record) => JSON.stringify(record.owner) === JSON.stringify(owner)),
    ).toBe(true);
    expect(JSON.stringify(persistence.records)).not.toContain(credential);
    expect(session.getStatus()).toMatchObject({
      capabilityVerification: "unverified",
      liveApiValidated: false,
    });
    const summary = extractProviderTraceSummary(events);
    expect(summary).toMatchObject({
      requestCount: 4,
      usageCount: 1,
      unknownUsageCount: 3,
      reportedInputTokens: 10,
      reportedOutputTokens: 5,
    });
    expect(summary.totalInputTokens).toBeUndefined();
    expect(formatProviderTraceSummary(summary)).toContain("token usage unknown");
    expect(formatProviderTraceSummary(summary)).toContain("reported subtotal");
    expect(JSON.stringify(events)).not.toContain("native-private");
    const completed = commits
      .flatMap((commit) => commit.events)
      .filter((event) => event.type === "model_completed");
    expect(
      completed.map((event) => (event.payload as { usageStatus: string }).usageStatus),
    ).toEqual(["unknown", "unknown", "reported", "unknown"]);
  });

  it("supports unknown complete usage without a fabricated usage event or zero response", async () => {
    const fetcher = mockFetch().mockResolvedValue(json()),
      { session } = setup(fetcher);
    session.setCredential(credential);
    const result = await runProviderComplete(session.adapter, req());
    expect(result.response).toMatchObject({ text: "Value is 7", usageStatus: "unknown" });
    expect(result.response.usage).toBeUndefined();
    expect(result.events.some((event) => event.type === "provider_usage_recorded")).toBe(false);
    expect(result.events.at(-1)?.type).toBe("provider_request_completed");
    const mapped = result.events.flatMap(
      (event, index) => mapProviderRuntimeEvent(event, "t1", index).taskEvents,
    );
    expect(formatProviderTraceSummary(extractProviderTraceSummary(mapped))).toContain(
      "token usage unknown",
    );
  });

  it("restores native data through the store under a fresh credential and review without replaying tools", async () => {
    const persistence = memoryStore(),
      firstFetcher = mockFetch().mockResolvedValue(json(body(1, "manifest.json")));
    const first = setup(firstFetcher, persistence.store);
    first.session.setCredential(credential);
    const initial = req(),
      response = await first.session.adapter.complete(initial);
    first.session.dispose();
    const fetcher = mockFetch().mockResolvedValue(json(body(2))),
      { session, gate } = setup(fetcher, persistence.store);
    const next = req({
      id: "request-2",
      messages: [
        { role: "user", content: "New selected constraints" },
        { role: "assistant", content: response.text, toolCalls: response.toolCalls },
        { role: "tool", toolCallId: "call_1", content: "Previously completed data, not authority" },
      ],
    });
    await expect(session.adapter.complete(next)).rejects.toMatchObject({ code: "auth_missing" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(session.hasCredential()).toBe(false);
    session.setCredential("fresh-runtime-credential-67890");
    const result = await session.adapter.complete(next);
    expect(result.text).toBe("Value is 7");
    expect(JSON.parse(fetcher.mock.calls[0][1]!.body as string).input).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "reasoning", encrypted_content: "native-private-1" }),
        expect.objectContaining({ type: "function_call", call_id: "call_1" }),
        expect.objectContaining({ type: "function_call_output", call_id: "call_1" }),
      ]),
    );
    expect(gate.getPending()).toBeNull();
    expect(result.nativeContinuation?.owner).toEqual(owner);
  });

  it.each(["projectId", "projectEpoch", "runId", "conversationId"] as const)(
    "rejects stored ownership mismatch in %s before review",
    async (field) => {
      const persistence = memoryStore(),
        first = setup(
          mockFetch().mockResolvedValue(json(body(1, "manifest.json"))),
          persistence.store,
        );
      first.session.setCredential(credential);
      await first.session.adapter.complete(req());
      const foreign = clone(persistence.records[0]!);
      if (field === "projectEpoch") foreign.owner.projectEpoch++;
      else foreign.owner[field] = "foreign";
      const fetcher = mockFetch(),
        badStore: ProviderContinuationStorePort = {
          async load() {
            return [foreign];
          },
          async save() {
            throw Error("unexpected_save");
          },
        };
      const { session, gate } = setup(fetcher, badStore);
      session.setCredential(credential);
      await expect(session.adapter.complete(req())).rejects.toMatchObject({
        code: "provider_unavailable",
      });
      expect(fetcher).not.toHaveBeenCalled();
      expect(gate.getPending()).toBeNull();
    },
  );

  it("requires native history rather than silently dropping reasoning after a store restore", async () => {
    const fetcher = mockFetch(),
      { session } = setup(fetcher);
    session.setCredential(credential);
    await expect(
      session.adapter.complete(
        req({
          messages: [
            {
              role: "assistant",
              content: "",
              toolCalls: [{ id: "old_call", name: "project_read_file", arguments: "{}" }],
            },
            { role: "tool", toolCallId: "old_call", content: "history" },
          ],
        }),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining("continuation is missing") });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("cancels a pending fetch without saving or completing a tool call", async () => {
    const fetcher = mockFetch().mockImplementation(() => new Promise(() => undefined));
    const persistence = memoryStore(),
      { session } = setup(fetcher, persistence.store);
    session.setCredential(credential);
    const controller = new AbortController();
    const pending = runProviderStream(session.adapter, req(), { signal: controller.signal });
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    controller.abort();
    const result = await pending;
    expect(persistence.records).toHaveLength(0);
    expect(result.events.at(-1)?.type).toBe("provider_request_cancelled");
    expect(result.events.some((event) => event.type === "provider_tool_call_completed")).toBe(
      false,
    );
  });

  it("withholds executable results and requires reconciliation after an uncertain store acknowledgement", async () => {
    const save = vi.fn<
      Parameters<ProviderContinuationStorePort["save"]>,
      ReturnType<ProviderContinuationStorePort["save"]>
    >(() => new Promise(() => undefined));
    const store: ProviderContinuationStorePort = {
      async load() {
        return [];
      },
      save,
    };
    const fetcher = mockFetch().mockResolvedValue(json(body(1, "manifest.json"))),
      { session } = setup(fetcher, store);
    session.setCredential(credential);
    const controller = new AbortController(),
      pending = session.adapter.complete(req(), { signal: controller.signal });
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(session.getStatus().requiresStoreReconciliation).toBe(true);
    await expect(session.adapter.complete(req())).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("revalidates sources after approval and before the second outbound fetch", async () => {
    let stale = false,
      reviews = 0;
    const gate = createOutboundConsentGate();
    gate.subscribe(() => {
      const pending = gate.getPending();
      if (pending && ++reviews === 2) stale = true;
    });
    const fetcher = mockFetch().mockImplementation(async () => sse(body(1, "manifest.json")));
    const { session } = setup(fetcher, memoryStore().store, gate);
    session.setCredential(credential);
    const s = scope(),
      reads: string[] = [];
    const coordinator = new RunCoordinator({
      adapter: session.adapter,
      registry: tools(reads),
      lease: { scope: s, isCurrent: () => true },
      contextSources: {
        async validate() {
          return !stale;
        },
      },
    });
    const result = await coordinator.start("t1", draft(s));
    expect(result.run).toMatchObject({ status: "paused", stopReason: "context_stale" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(reads).toEqual(["manifest.json"]);
  });

  it("registers explicit Responses sessions without persisted secret references and requires replacement on edits", () => {
    const { session } = setup(mockFetch()),
      registry = new ProviderRegistry();
    expect(
      registry.register(session.adapter, {
        wireApi: "responses",
        baseUrl: endpoint,
        networkMode: "live",
        secretRef: null,
      }).valid,
    ).toBe(true);
    expect(registry.getConfig(owner.providerId).wireApi).toBe("responses");
    expect(registry.updateConfig(owner.providerId, { defaultModel: "other" }).valid).toBe(false);
    expect(registry.updateConfig(owner.providerId, { displayName: "Renamed" }).valid).toBe(true);
    expect(
      new ProviderRegistry().register(session.adapter, { wireApi: "openai-compatible" }).valid,
    ).toBe(false);
    expect(
      new ProviderRegistry().register(session.adapter, { secretRef: "never-store-a-reference" })
        .valid,
    ).toBe(false);
  });

  it("refuses unsupported protocol selection without opening or fetching", () => {
    expect(() => createProviderRuntimeSession({ wireApi: "openai-compatible" } as never)).toThrow(
      "unsupported_runtime_provider_protocol",
    );
  });
});

describe("runtime report and persistence failure boundaries", () => {
  it("never calls a partial known subtotal an exact total after a cancellation", async () => {
    const fetcher = mockFetch().mockResolvedValue(
      json(body(1, undefined, { input_tokens: 10, output_tokens: 5, total_tokens: 15 })),
    );
    const { session } = setup(fetcher);
    session.setCredential(credential);
    const measured = await runProviderComplete(session.adapter, req());
    const controller = new AbortController();
    controller.abort();
    const cancelled = await runProviderComplete(session.adapter, req({ id: "cancelled-request" }), {
      signal: controller.signal,
    });
    expect(cancelled.response.usage).toBeUndefined();
    expect(cancelled.response.usageStatus).toBe("unknown");
    const events = [...measured.events, ...cancelled.events].flatMap(
      (event, index) => mapProviderRuntimeEvent(event, "t1", index).taskEvents,
    );
    const summary = extractProviderTraceSummary(events);
    expect(summary).toMatchObject({ usageCount: 1, unknownUsageCount: 1, reportedInputTokens: 10 });
    expect(summary.totalInputTokens).toBeUndefined();
    expect(formatProviderTraceSummary(summary)).toContain("reported subtotal");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not deliver a tool result if a store save throws credential-bearing data", async () => {
    const store: ProviderContinuationStorePort = {
      async load() {
        return [];
      },
      async save() {
        throw {
          name: "ProviderRuntimeError",
          code: "network_error",
          message: credential,
          cause: credential,
        };
      },
    };
    const { session } = setup(mockFetch().mockResolvedValue(json(body(1, "manifest.json"))), store);
    session.setCredential(credential);
    const error = await session.adapter.complete(req()).catch((error) => error);
    expect(error).toMatchObject({ code: "provider_unavailable" });
    expect(JSON.stringify(error)).not.toContain(credential);
    expect(session.getStatus().requiresStoreReconciliation).toBe(true);
  });

  it("refuses persisted authority fields rather than opening a session from them", async () => {
    const persistence = memoryStore(),
      first = setup(mockFetch().mockResolvedValue(json()), persistence.store);
    first.session.setCredential(credential);
    await first.session.adapter.complete(req());
    const record = { ...persistence.records[0]!, authorization: { approved: true } };
    const store: ProviderContinuationStorePort = {
      async load() {
        return [record];
      },
      async save() {
        throw Error("unexpected_save");
      },
    };
    const fetcher = mockFetch(),
      { session } = setup(fetcher, store);
    session.setCredential(credential);
    await expect(session.adapter.complete(req())).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(session.getStatus().liveApiValidated).toBe(false);
  });

  it("does not allow an entered credential to become persisted ownership metadata", () => {
    const session = createProviderRuntimeSession({
      wireApi: "responses",
      providerId: owner.providerId,
      modelId: model,
      endpoint,
      mode: "offline",
      fetcher: mockFetch(),
      owner: { ...owner, conversationId: credential },
      isCurrent: () => true,
      getProjectContext: context,
      continuationStore: memoryStore().store,
    });
    expect(() => session.setCredential(credential)).toThrow("credential_matches_runtime_identity");
    expect(session.hasCredential()).toBe(false);
  });
});

it("does not turn matching persisted ownership and a fresh credential into a current run lease", async () => {
  const load = vi.fn<
    Parameters<ProviderContinuationStorePort["load"]>,
    ReturnType<ProviderContinuationStorePort["load"]>
  >(async () => []);
  const fetcher = mockFetch(),
    store: ProviderContinuationStorePort = {
      load,
      async save() {
        throw Error("unexpected_save");
      },
    };
  const session = createProviderRuntimeSession({
    wireApi: "responses",
    providerId: owner.providerId,
    modelId: model,
    endpoint,
    mode: "offline",
    fetcher,
    owner,
    isCurrent: () => false,
    getProjectContext: context,
    continuationStore: store,
  });
  session.setCredential(credential);
  await expect(session.adapter.complete(req())).rejects.toMatchObject({ code: "cancelled" });
  expect(load).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});

describe("fresh lease at the actual Responses dispatch boundary", () => {
  const apis = ["complete", "stream"] as const;
  const moments = ["approval", "beforeSend"] as const;
  it.each(apis.flatMap((api) => moments.map((moment) => ({ api, moment }))))(
    "sends zero requests when the lease expires during $moment in $api",
    async ({ api, moment }) => {
      let current = true;
      const fetcher = mockFetch().mockResolvedValue(api === "complete" ? json() : sse(body()));
      const persistence = memoryStore(),
        gate = createOutboundConsentGate();
      const session = createProviderRuntimeSession({
        wireApi: "responses",
        providerId: owner.providerId,
        modelId: model,
        endpoint,
        mode: "live",
        fetcher,
        owner,
        isCurrent: () => current,
        getProjectContext: context,
        outboundGate: gate,
        continuationStore: persistence.store,
      });
      session.setCredential(credential);
      const sourceCheck = vi.fn(async () => {
        current = false;
      });
      const call = moment === "beforeSend" ? { beforeSend: sourceCheck } : {};
      const chunks: unknown[] = [];
      const pending =
        api === "complete"
          ? session.adapter.complete(req(), call)
          : (async () => {
              for await (const chunk of session.adapter.stream!(req(), call)) chunks.push(chunk);
            })();
      const rejected = expect(pending).rejects.toMatchObject({ code: "cancelled" });
      await vi.waitFor(() => expect(gate.getPending()).not.toBeNull());
      const review = gate.getPending()!;
      if (moment === "approval") current = false;
      gate.approve(review.id);
      await rejected;
      expect(context()).toEqual({ projectId: "p1", epoch: 7, revision: "v1" });
      expect(fetcher).not.toHaveBeenCalled();
      expect(persistence.records).toHaveLength(0);
      expect(chunks).toHaveLength(0);
      expect(sourceCheck).toHaveBeenCalledTimes(moment === "beforeSend" ? 1 : 0);
      expect(session.getStatus().requiresStoreReconciliation).toBe(false);
    },
  );

  it.each(apis)(
    "retains source validation and approved bytes in the normal %s order",
    async (api) => {
      const trace: string[] = [],
        gate = createOutboundConsentGate();
      let sourceCompleted = false,
        leaseChecksAfterSource = 0;
      const persistence = memoryStore();
      const store: ProviderContinuationStorePort = {
        async load(query, signal) {
          trace.push("load");
          return persistence.store.load(query, signal);
        },
        async save(record, signal) {
          trace.push("save");
          return persistence.store.save(record, signal);
        },
      };
      gate.subscribe(() => {
        if (gate.getPending()) trace.push("review");
      });
      const fetcher = mockFetch().mockImplementation(async () => {
        trace.push("fetch");
        expect(sourceCompleted).toBe(true);
        expect(leaseChecksAfterSource).toBeGreaterThan(0);
        return api === "complete" ? json() : sse(body());
      });
      const session = createProviderRuntimeSession({
        wireApi: "responses",
        providerId: owner.providerId,
        modelId: model,
        endpoint,
        mode: "live",
        fetcher,
        owner,
        isCurrent: () => {
          if (sourceCompleted) leaseChecksAfterSource++;
          return true;
        },
        getProjectContext: context,
        outboundGate: gate,
        continuationStore: store,
      });
      session.setCredential(credential);
      const sourceCheck = vi.fn(async () => {
        trace.push("source");
        sourceCompleted = true;
      });
      const pending =
        api === "complete"
          ? session.adapter.complete(req(), { beforeSend: sourceCheck })
          : (async () => {
              for await (const chunk of session.adapter.stream!(req(), { beforeSend: sourceCheck }))
                void chunk;
            })();
      await vi.waitFor(() => expect(gate.getPending()).not.toBeNull());
      const review = gate.getPending()!;
      expect(trace).toEqual(["load", "review"]);
      gate.approve(review.id);
      await pending;
      trace.push("delivery");
      expect(trace).toEqual(["load", "review", "source", "fetch", "save", "delivery"]);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][1]!.body).toBe(review.envelope.body);
      expect(sourceCheck).toHaveBeenCalledTimes(1);
      expect(persistence.records).toHaveLength(1);
    },
  );

  it.each(apis)(
    "still refuses %s if the lease changes during final grant consumption",
    async (api) => {
      let current = true,
        consumed = false;
      const baseGate = createOutboundConsentGate();
      const gate = {
        ...baseGate,
        async review(...args: Parameters<typeof baseGate.review>) {
          const grant = await baseGate.review(...args);
          return {
            consume(envelope: Parameters<typeof grant.consume>[0]) {
              consumed = grant.consume(envelope);
              current = false;
              return consumed;
            },
          };
        },
      };
      const persistence = memoryStore(),
        fetcher = mockFetch();
      const session = createProviderRuntimeSession({
        wireApi: "responses",
        providerId: owner.providerId,
        modelId: model,
        endpoint,
        mode: "live",
        fetcher,
        owner,
        isCurrent: () => current,
        getProjectContext: context,
        outboundGate: gate,
        continuationStore: persistence.store,
      });
      session.setCredential(credential);
      const sourceCheck = vi.fn(async () => undefined);
      const pending =
        api === "complete"
          ? session.adapter.complete(req(), { beforeSend: sourceCheck })
          : (async () => {
              for await (const chunk of session.adapter.stream!(req(), { beforeSend: sourceCheck }))
                void chunk;
            })();
      const rejected = expect(pending).rejects.toMatchObject({ code: "cancelled" });
      await vi.waitFor(() => expect(gate.getPending()).not.toBeNull());
      gate.approve(gate.getPending()!.id);
      await rejected;
      expect(consumed).toBe(true);
      expect(sourceCheck).toHaveBeenCalledTimes(1);
      expect(fetcher).not.toHaveBeenCalled();
      expect(persistence.records).toHaveLength(0);
    },
  );
});
