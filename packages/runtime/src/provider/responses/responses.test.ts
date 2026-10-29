import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderRuntimeRequest } from "@uagent/shared";
import { createOutboundConsentGate } from "../outbound-consent.js";
import {
  createResponsesSession,
  type ResponsesSessionOptions,
  type ResponsesStreamChunk,
} from "./session.js";
import { parseResponsesResult, responsesBody } from "./protocol.js";

const credential = "synthetic-local-key-123456";
const model = "explicit-test-model";
const mockFetch = () => vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
const request = (patch: Partial<ProviderRuntimeRequest> = {}): ProviderRuntimeRequest => ({
  id: "req_1",
  providerId: "openai-responses",
  modelId: model,
  messages: [
    { role: "developer", content: "Use approved tools." },
    { role: "user", content: "检查中文文件" },
  ],
  ...patch,
});
const tool = {
  name: "read_file",
  description: "Read approved content",
  parameters: { type: "object", properties: { path: { type: "string" } } },
};
const message = (text = "完成") => ({
  type: "message",
  id: "msg_1",
  role: "assistant",
  status: "completed",
  content: [{ type: "output_text", text, annotations: [] }],
});
const functionItem = (id = "fc_1", callId = "call_1", args = '{"path":"文件.txt"}') => ({
  type: "function_call",
  id,
  call_id: callId,
  name: "read_file",
  arguments: args,
  status: "completed",
});
const responseBody = (patch: Record<string, unknown> = {}) => ({
  id: "resp_1",
  model,
  status: "completed",
  created_at: 1_700_000_000,
  output: [message()],
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
  ...patch,
});
const jsonResponse = (patch: Record<string, unknown> = {}) =>
  new Response(JSON.stringify(responseBody(patch)), {
    headers: { "Content-Type": "application/json" },
  });
const created = () => ({
  type: "response.created",
  response: { id: "resp_1", model, status: "in_progress" },
});
const added = (item: Record<string, unknown>, output_index = 0) => ({
  type: "response.output_item.added",
  item,
  output_index,
});
const completed = (patch: Record<string, unknown> = {}) => ({
  type: "response.completed",
  response: responseBody(patch),
});
function sse(events: Record<string, unknown>[], lineEnding = "\n", chunkSize = 999999): Response {
  const text =
    ": synthetic transport fixture" +
    lineEnding +
    lineEnding +
    events
      .map(
        (event) =>
          "event: " +
          event.type +
          lineEnding +
          "data: " +
          JSON.stringify(event) +
          lineEnding +
          lineEnding,
      )
      .join("");
  const encoded = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < encoded.length; i += chunkSize)
          controller.enqueue(encoded.slice(i, i + chunkSize));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream; charset=utf-8" } },
  );
}
function session(fetcher: typeof fetch, options: Partial<ResponsesSessionOptions> = {}) {
  const value = createResponsesSession({ mode: "offline", modelId: model, fetcher, ...options });
  value.setCredential(credential);
  return value;
}
async function collect(iterable: AsyncIterable<ResponsesStreamChunk>) {
  const chunks: ResponsesStreamChunk[] = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}
const tick = () => new Promise<void>((resolve) => queueMicrotask(resolve));
afterEach(() => {
  vi.useRealTimers();
});

describe("native Responses requests and results", () => {
  it("uses native messages, tools and controls without Chat Completions wrappers or implicit temperature", async () => {
    const fetcher = mockFetch().mockResolvedValue(jsonResponse());
    const value = session(fetcher);
    const req = request({ tools: [tool], maxOutputTokens: 128 });
    const result = await value.adapter.complete(req);
    const [url, init] = fetcher.mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(body).toMatchObject({
      model,
      stream: false,
      store: false,
      max_output_tokens: 128,
      include: ["reasoning.encrypted_content"],
      tools: [{ type: "function", name: "read_file", strict: false }],
    });
    expect(body.input[0]).toEqual({
      type: "message",
      role: "developer",
      content: [{ type: "input_text", text: "Use approved tools." }],
    });
    expect(body).not.toHaveProperty("messages");
    expect(body).not.toHaveProperty("temperature");
    expect(body.tools[0]).not.toHaveProperty("function");
    expect(init).toMatchObject({ redirect: "error", credentials: "omit", cache: "no-store" });
    expect(result).toMatchObject({
      id: "resp_1",
      text: "完成",
      finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    });
  });

  it("round-trips call_id and retained native reasoning after the runtime executes a tool", async () => {
    const native = [
      {
        type: "reasoning",
        id: "rs_1",
        summary: [],
        encrypted_content: "synthetic-encrypted-state",
      },
      functionItem(),
    ];
    const fetcher = mockFetch()
      .mockResolvedValueOnce(jsonResponse({ output: native }))
      .mockResolvedValueOnce(jsonResponse());
    const value = session(fetcher, {
      getProjectContext: () => ({ projectId: "p1", epoch: 1, revision: "r1" }),
    });
    const first = request({
      tools: [tool],
      metadata: { projectId: "p1", projectEpoch: 1, runId: "r1" },
    });
    const result = await value.adapter.complete(first);
    expect(result.toolCalls?.[0].id).toBe("call_1");
    const next = request({
      ...first,
      id: "req_2",
      messages: [
        ...first.messages,
        { role: "assistant", content: result.text, toolCalls: result.toolCalls },
        { role: "tool", content: '{"ok":true}', toolCallId: "call_1" },
      ],
    });
    await value.adapter.complete(next);
    const body = JSON.parse(fetcher.mock.calls[1][1]!.body as string);
    expect(body.input.slice(2, 4)).toEqual(native);
    expect(body.input[4]).toEqual({
      type: "function_call_output",
      call_id: "call_1",
      output: '{"ok":true}',
    });
    expect(JSON.stringify(body)).not.toContain("tool_call_id");
  });

  it("serializes restored generic tool history as native function items", () => {
    const body = responsesBody(
      request({
        messages: [
          { role: "user", content: "Read" },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "call_a", name: "read_file", arguments: "{}" }],
          },
          { role: "tool", toolCallId: "call_a", content: "result" },
        ],
      }),
      false,
    );
    expect(body.input.slice(1)).toEqual([
      { type: "function_call", call_id: "call_a", name: "read_file", arguments: "{}" },
      { type: "function_call_output", call_id: "call_a", output: "result" },
    ]);
  });

  it.each([
    [{ role: "tool", toolCallId: "orphan", content: "result" }],
    [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_a", name: "read_file", arguments: "{}" }],
      },
    ],
    [
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "call_a", name: "read_file", arguments: "[]" }],
      },
    ],
  ])("rejects invalid tool history before transport (%j)", async (...messages) => {
    const fetcher = mockFetch();
    await expect(
      session(fetcher).completeNative(
        request({ messages: messages as ProviderRuntimeRequest["messages"] }),
      ),
    ).rejects.toMatchObject({ code: "malformed_response" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps missing usage unknown in both native and adapter complete results", async () => {
    const fetcher = mockFetch().mockImplementation(async () => jsonResponse({ usage: null }));
    const value = session(fetcher);
    const result = await value.completeNative(request());
    expect(result).toMatchObject({ usageStatus: "unknown", usage: undefined, text: "完成" });
    await expect(value.adapter.complete(request())).resolves.toMatchObject({
      usageStatus: "unknown",
      usage: undefined,
    });
  });

  it.each([
    { input_tokens: 1 },
    { input_tokens: 1, output_tokens: 2, total_tokens: 4 },
    { input_tokens: -1, output_tokens: 2, total_tokens: 1 },
  ])("rejects unreliable usage without estimating (%j)", (usage) => {
    expect(() => parseResponsesResult(responseBody({ usage }), request())).toThrowError();
  });

  it("handles max_output_tokens as length and blocks partial tool execution", () => {
    const incomplete = {
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    };
    expect(parseResponsesResult(responseBody(incomplete), request()).finishReason).toBe("length");
    expect(() =>
      parseResponsesResult(
        responseBody({ ...incomplete, output: [functionItem()] }),
        request({ tools: [tool] }),
      ),
    ).toThrowError();
  });

  it("rejects silent model changes and unsupported native tools", async () => {
    const fetcher = mockFetch().mockResolvedValue(jsonResponse({ model: "another-model" }));
    const value = session(fetcher);
    await expect(value.completeNative(request({ modelId: "another-model" }))).rejects.toMatchObject(
      { code: "provider_unavailable" },
    );
    expect(fetcher).not.toHaveBeenCalled();
    await expect(value.completeNative(request())).rejects.toMatchObject({
      code: "malformed_response",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(() =>
      parseResponsesResult(
        responseBody({ output: [{ id: "web_1", type: "web_search_call" }] }),
        request(),
      ),
    ).toThrowError();
  });
});

describe("approval, credential and transport boundaries", () => {
  it("approves the actual serialized body once, then calls beforeSend, then fetches exactly those bytes", async () => {
    const gate = createOutboundConsentGate(),
      order: string[] = [];
    const fetcher = mockFetch().mockImplementation(async () => {
      order.push("fetch");
      return jsonResponse();
    });
    const value = session(fetcher, {
      mode: "live",
      outboundGate: gate,
      getProjectContext: () => ({ projectId: "p", epoch: 2, revision: "rev" }),
    });
    const req = request({ metadata: { projectId: "p", projectEpoch: 2 } });
    const pending = value.completeNative(req, {
      beforeSend: async () => {
        order.push("hook");
        expect(fetcher).not.toHaveBeenCalled();
      },
    });
    const review = gate.getPending()!;
    expect(review.envelope.body).toBe(value.preview(req, false).body);
    req.messages[1].content = "Mutated after approval";
    gate.approve(review.id);
    order.push("approval");
    await pending;
    expect(order).toEqual(["approval", "hook", "fetch"]);
    expect(fetcher.mock.calls[0][1]!.body).toBe(review.envelope.body);
    const next = value.completeNative(request());
    expect(gate.getPending()?.id).not.toBe(review.id);
    gate.invalidate();
    await expect(next).rejects.toMatchObject({ code: "cancelled" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("cancels after hook changes project revision without sending", async () => {
    const gate = createOutboundConsentGate(),
      fetcher = mockFetch();
    let revision = "old";
    const value = session(fetcher, {
      mode: "live",
      outboundGate: gate,
      getProjectContext: () => ({ projectId: "p", epoch: 1, revision }),
    });
    const pending = value.completeNative(request(), {
      beforeSend: async () => {
        revision = "new";
      },
    });
    gate.approve(gate.getPending()!.id);
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("denied approval and failing hook each prevent transport", async () => {
    const gate = createOutboundConsentGate(),
      fetcher = mockFetch();
    const value = session(fetcher, { outboundGate: gate });
    const denied = value.completeNative(request());
    gate.invalidate();
    await expect(denied).rejects.toMatchObject({ code: "cancelled" });
    const failing = value.completeNative(request(), {
      beforeSend: async () => {
        throw new Error(credential);
      },
    });
    gate.approve(gate.getPending()!.id);
    const error = await failing.catch((error) => error);
    expect(JSON.stringify(error)).not.toContain(credential);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requires explicit offline transport and live review/context", async () => {
    const offline = createResponsesSession({ mode: "offline", modelId: model });
    offline.setCredential(credential);
    await expect(offline.completeNative(request())).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    const fetcher = mockFetch(),
      live = session(fetcher, { mode: "live" });
    await expect(live.completeNative(request())).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps credentials memory-only and forbids credential material in wire input", async () => {
    const fetcher = mockFetch().mockResolvedValue(jsonResponse());
    const value = session(fetcher);
    expect(JSON.stringify(value)).not.toContain(credential);
    expect(JSON.stringify(value.getStatus())).not.toContain(credential);
    await expect(
      value.completeNative(request({ messages: [{ role: "user", content: credential }] })),
    ).rejects.toMatchObject({ code: "auth_missing" });
    expect(fetcher).not.toHaveBeenCalled();
    value.dispose();
    expect(value.hasCredential()).toBe(false);
    expect(() => value.setCredential(credential)).toThrowError();
    expect(value.getStatus()).toMatchObject({
      capabilityVerification: "unverified",
      liveApiValidated: false,
    });
    expect(value.adapter.getCapabilities()).toMatchObject({
      isMock: true,
      supportsPreSendValidation: true,
    });
  });

  it("cancels pending review on AbortSignal and never sends", async () => {
    const gate = createOutboundConsentGate(),
      fetcher = mockFetch(),
      controller = new AbortController();
    const value = session(fetcher, { outboundGate: gate });
    const pending = value.completeNative(request(), { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(gate.getPending()).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("aborts an uncooperative fetch when credentials are cleared and allows a fresh credential later", async () => {
    const fetcher = mockFetch()
      .mockImplementationOnce(() => new Promise(() => undefined))
      .mockResolvedValueOnce(jsonResponse());
    const value = session(fetcher);
    const pending = value.completeNative(request());
    await tick();
    const signal = fetcher.mock.calls[0][1]!.signal!;
    await expect(value.completeNative(request())).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    value.clearCredential();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(signal.aborted).toBe(true);
    value.setCredential(credential);
    await expect(value.completeNative(request())).resolves.toMatchObject({ text: "完成" });
  });

  it("bounds a stalled pre-send hook with timeout and sends nothing", async () => {
    vi.useFakeTimers();
    const fetcher = mockFetch(),
      value = session(fetcher, { timeoutMs: 20 });
    const pending = value.completeNative(request(), {
      beforeSend: () => new Promise(() => undefined),
    });
    const assertion = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(21);
    await assertion;
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [401, "auth_missing"],
    [403, "auth_missing"],
    [429, "rate_limited"],
    [503, "provider_unavailable"],
    [400, "malformed_response"],
  ])("sanitizes HTTP %s and never retries", async (status, code) => {
    const fetcher = mockFetch().mockResolvedValue(
      new Response(credential, { status: status as number }),
    );
    const error = await session(fetcher)
      .completeNative(request())
      .catch((error) => error);
    expect(error).toMatchObject({ code });
    expect(JSON.stringify(error)).not.toContain(credential);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("bounds requests and response bodies without leaking body errors", async () => {
    const fetcher = mockFetch().mockResolvedValue(jsonResponse());
    await expect(
      session(fetcher, { maxRequestBytes: 1 }).completeNative(request()),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      session(fetcher, { maxResponseBytes: 1 }).completeNative(request()),
    ).rejects.toMatchObject({ code: "malformed_response" });
  });
});

describe("native Responses SSE", () => {
  it.each(["\n", "\r\n", "\r"])(
    "handles UTF-8 byte splits and SSE line ending %j",
    async (lineEnding) => {
      const events = [
        created(),
        added({ ...message(), content: [] }),
        {
          type: "response.output_text.delta",
          item_id: "msg_1",
          output_index: 0,
          content_index: 0,
          delta: "完",
        },
        {
          type: "response.output_text.delta",
          item_id: "msg_1",
          output_index: 0,
          content_index: 0,
          delta: "成",
        },
        completed(),
      ];
      const chunks = await collect(
        session(mockFetch().mockResolvedValue(sse(events, lineEnding, 1))).stream(request()),
      );
      expect(chunks.map((chunk) => chunk.delta).join("")).toBe("完成");
      expect(chunks.at(-1)).toMatchObject({
        done: true,
        finishReason: "stop",
        usageStatus: "reported",
        responseId: "resp_1",
      });
    },
  );

  it("maps sparse native output indexes to contiguous runtime tool indexes and preserves exact argument fragments", async () => {
    const first = functionItem("fc_1", "call_1", '{"path":"甲.txt"}'),
      second = functionItem("fc_2", "call_2", '{"path":"乙.txt"}');
    const reasoning = {
      id: "rs_1",
      type: "reasoning",
      summary: [],
      encrypted_content: "synthetic-reasoning",
    };
    const events = [
      created(),
      added(reasoning),
      added({ ...message("检查"), content: [] }, 1),
      {
        type: "response.output_text.delta",
        item_id: "msg_1",
        output_index: 1,
        content_index: 0,
        delta: "检查",
      },
      added({ ...first, arguments: "" }, 2),
      added({ ...second, arguments: "" }, 3),
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_1",
        output_index: 2,
        delta: '{"path":',
      },
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_2",
        output_index: 3,
        delta: '{"path":"乙.txt"}',
      },
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_1",
        output_index: 2,
        delta: '"甲.txt"}',
      },
      {
        type: "response.function_call_arguments.done",
        item_id: "fc_1",
        output_index: 2,
        arguments: first.arguments,
      },
      { type: "response.output_item.done", output_index: 2, item: first },
      completed({ output: [reasoning, message("检查"), first, second] }),
    ];
    const value = session(mockFetch().mockResolvedValue(sse(events)));
    const chunks = await collect(value.stream(request({ tools: [tool] })));
    const deltas = chunks.flatMap((chunk) => (chunk.toolCallDelta ? [chunk.toolCallDelta] : []));
    expect(deltas[0]).toMatchObject({ index: 0, id: "call_1", name: "read_file" });
    expect(deltas[1]).toMatchObject({ index: 1, id: "call_2", name: "read_file" });
    expect(
      deltas
        .filter((delta) => delta.index === 0)
        .map((delta) => delta.argumentsDelta)
        .join(""),
    ).toBe(first.arguments);
    expect(chunks.at(-1)).toMatchObject({
      done: true,
      finishReason: "tool_calls",
      toolCalls: [
        { id: "call_1", arguments: first.arguments },
        { id: "call_2", arguments: second.arguments },
      ],
      nativeOutput: [reasoning, message("检查"), first, second],
    });
    expect(chunks.slice(0, -1).every((chunk) => !chunk.toolCalls)).toBe(true);
  });

  it("fills only missing suffixes from full arguments.done and terminal text", async () => {
    const full = functionItem();
    const events = [
      created(),
      added({ ...full, arguments: "" }),
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_1",
        output_index: 0,
        delta: '{"path":',
      },
      {
        type: "response.function_call_arguments.done",
        item_id: "fc_1",
        output_index: 0,
        arguments: full.arguments,
      },
      completed({ output: [full, message("最后")] }),
    ];
    const chunks = await collect(
      session(mockFetch().mockResolvedValue(sse(events))).stream(request({ tools: [tool] })),
    );
    expect(
      chunks
        .flatMap((chunk) => (chunk.toolCallDelta ? [chunk.toolCallDelta.argumentsDelta] : []))
        .join(""),
    ).toBe(full.arguments);
    expect(chunks.map((chunk) => chunk.delta).join("")).toBe("最后");
  });

  it("accepts multiline SSE data and reports unknown usage on successful terminal output", async () => {
    const data = JSON.stringify(completed({ usage: null })).replace(
      ',"response":',
      ',\ndata: "response":',
    );
    const fetcher = mockFetch().mockResolvedValue(
      new Response("data: " + data + "\n\n", { headers: { "Content-Type": "text/event-stream" } }),
    );
    const chunks = await collect(session(fetcher).stream(request()));
    expect(chunks.at(-1)).toMatchObject({ done: true, usageStatus: "unknown", usage: undefined });
  });

  it.each([
    [created()],
    [created(), { type: "error", code: "server_error", message: credential }],
    [
      created(),
      {
        type: "response.failed",
        response: responseBody({ status: "failed", error: { message: credential } }),
      },
    ],
    [created(), completed({ model: "substituted" })],
    [
      created(),
      added({ ...functionItem(), arguments: "" }),
      {
        type: "response.function_call_arguments.delta",
        item_id: "wrong",
        output_index: 0,
        delta: "{}",
      },
    ],
    [
      created(),
      added({ ...functionItem(), arguments: "" }),
      {
        type: "response.function_call_arguments.delta",
        item_id: "fc_1",
        output_index: 0,
        delta: '{"a":1}',
      },
      completed({ output: [functionItem("fc_1", "call_1", '{"a":2}')] }),
    ],
    [created(), added({ id: "web_1", type: "web_search_call" })],
  ])(
    "rejects malformed, failed or nonterminal SSE without executable calls (%j)",
    async (...events) => {
      const chunks: ResponsesStreamChunk[] = [];
      const error = await (async () => {
        for await (const chunk of session(
          mockFetch().mockResolvedValue(sse(events as Record<string, unknown>[])),
        ).stream(request({ tools: [tool] })))
          chunks.push(chunk);
      })().catch((error) => error);
      expect(error).toMatchObject({ name: "ProviderRuntimeError" });
      expect(JSON.stringify(error)).not.toContain(credential);
      expect(chunks.every((chunk) => !chunk.done && !chunk.toolCalls)).toBe(true);
    },
  );

  it("rejects truncated UTF-8 and incomplete frames", async () => {
    for (const bytes of [new Uint8Array([0xff]), new TextEncoder().encode("data: {")]) {
      const fetcher = mockFetch().mockResolvedValue(
        new Response(bytes, { headers: { "Content-Type": "text/event-stream" } }),
      );
      await expect(collect(session(fetcher).stream(request()))).rejects.toMatchObject({
        code: "malformed_response",
      });
    }
  });

  it("cancels transport when the stream consumer stops early", async () => {
    const fetcher = mockFetch().mockResolvedValue(
      sse([
        created(),
        added({ ...message(), content: [] }),
        {
          type: "response.output_text.delta",
          item_id: "msg_1",
          output_index: 0,
          content_index: 0,
          delta: "partial",
        },
      ]),
    );
    const value = session(fetcher),
      iterator = value.stream(request());
    expect((await iterator.next()).value).toMatchObject({ delta: "partial" });
    await iterator.return(undefined as never);
    expect(fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });
});

describe("Responses completion and credential edge cases", () => {
  it("preserves generic assistant history using the native easy-message string form", () => {
    const body = responsesBody(
      request({
        messages: [
          { role: "assistant", content: "Earlier answer" },
          { role: "user", content: "Continue" },
        ],
      }),
      false,
    );
    expect(body.input[0]).toEqual({
      type: "message",
      role: "assistant",
      content: "Earlier answer",
    });
  });

  it("does not leak a credential across output chunks or attached callback error fields", async () => {
    const events = [
      created(),
      added({ ...message(), content: [] }),
      {
        type: "response.output_text.delta",
        item_id: "msg_1",
        output_index: 0,
        content_index: 0,
        delta: "Before " + credential.slice(0, 10),
      },
      {
        type: "response.output_text.delta",
        item_id: "msg_1",
        output_index: 0,
        content_index: 0,
        delta: credential.slice(10),
      },
      completed({ output: [message("Before " + credential)] }),
    ];
    const chunks: ResponsesStreamChunk[] = [];
    const error = await (async () => {
      for await (const chunk of session(mockFetch().mockResolvedValue(sse(events))).stream(
        request(),
      ))
        chunks.push(chunk);
    })().catch((error) => error);
    expect(JSON.stringify(chunks)).not.toContain(credential);
    expect(error).toMatchObject({ code: "malformed_response" });
    const fetcher = mockFetch();
    const hookError = await session(fetcher)
      .completeNative(request(), {
        beforeSend: async () => {
          throw {
            name: "ProviderRuntimeError",
            code: "cancelled",
            providerId: credential,
            message: credential,
            cause: credential,
          };
        },
      })
      .catch((error) => error);
    expect(JSON.stringify(hookError)).not.toContain(credential);
    expect(hookError).toMatchObject({ providerId: "openai-responses", code: "cancelled" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("cannot produce terminal tool calls after cancellation while its consumer is paused", async () => {
    const full = functionItem();
    const fetcher = mockFetch().mockResolvedValue(
      sse([created(), added({ ...full, arguments: "" }), completed({ output: [full] })]),
    );
    const controller = new AbortController(),
      iterator = session(fetcher).stream(request({ tools: [tool] }), { signal: controller.signal });
    const first = await iterator.next();
    expect(first.value).toMatchObject({ done: false, toolCallDelta: { id: "call_1" } });
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ code: "cancelled" });
  });

  it("accepts native refusal text and length termination with unknown usage", async () => {
    const refusal = { ...message(), content: [{ type: "refusal", refusal: "Cannot comply." }] };
    const events = [
      created(),
      added({ ...refusal, content: [] }),
      {
        type: "response.refusal.delta",
        item_id: "msg_1",
        output_index: 0,
        content_index: 0,
        delta: "Cannot ",
      },
      {
        type: "response.refusal.done",
        item_id: "msg_1",
        output_index: 0,
        content_index: 0,
        refusal: "Cannot comply.",
      },
      {
        type: "response.incomplete",
        response: responseBody({
          status: "incomplete",
          incomplete_details: { reason: "max_output_tokens" },
          output: [refusal],
          usage: null,
        }),
      },
    ];
    const chunks = await collect(
      session(mockFetch().mockResolvedValue(sse(events))).stream(request()),
    );
    expect(chunks.map((chunk) => chunk.delta).join("")).toBe("Cannot comply.");
    expect(chunks.at(-1)).toMatchObject({
      done: true,
      finishReason: "length",
      usageStatus: "unknown",
    });
  });

  it("rejects tool output when tool_choice is none and does not replay native state into another project", async () => {
    const native = [
      { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "project-one-only" },
      functionItem(),
    ];
    const fetcher = mockFetch().mockImplementation(async () => jsonResponse({ output: native }));
    const value = session(fetcher);
    await expect(
      value.completeNative(request({ tools: [tool], toolChoice: "none" })),
    ).rejects.toMatchObject({ code: "malformed_response" });
    const first = request({ tools: [tool], metadata: { projectId: "one" } });
    const result = await value.completeNative(first);
    const next = request({
      tools: [tool],
      metadata: { projectId: "two" },
      messages: [
        ...first.messages,
        { role: "assistant", content: result.text, toolCalls: result.toolCalls },
        { role: "tool", content: "result", toolCallId: "call_1" },
      ],
    });
    expect(value.preview(next).body).not.toContain("project-one-only");
  });
});

describe("persisted native continuation", () => {
  it("rehydrates reasoning and assistant phase into a new session from stored native output", async () => {
    const native = [
      { type: "reasoning", id: "rs_saved", summary: [], encrypted_content: "saved-native-state" },
      { ...message("Read next"), phase: "commentary" },
      functionItem(),
    ];
    const initial = request({ tools: [tool] });
    const fetcher = mockFetch().mockResolvedValue(jsonResponse());
    const restored = session(fetcher, {
      getProjectContext: () => ({ projectId: "p1", epoch: 1, revision: "r1" }),
      replayNativeOutput: (_request, index) =>
        index === 2 ? { projectId: "p1", projectEpoch: 1, output: native } : undefined,
    });
    const req = request({
      tools: [tool],
      messages: [
        ...initial.messages,
        {
          role: "assistant",
          content: "Read next",
          toolCalls: [{ id: "call_1", name: "read_file", arguments: functionItem().arguments }],
        },
        { role: "tool", toolCallId: "call_1", content: "result" },
      ],
    });
    await restored.completeNative(req);
    const body = JSON.parse(fetcher.mock.calls[0][1]!.body as string);
    expect(body.input.slice(2, 5)).toEqual(native);
  });

  it("rejects a stored native turn whose tool identities disagree before review or fetch", async () => {
    const fetcher = mockFetch(),
      gate = createOutboundConsentGate();
    const restored = session(fetcher, {
      outboundGate: gate,
      getProjectContext: () => ({ projectId: "p1", epoch: 1, revision: "r1" }),
      replayNativeOutput: () => ({
        projectId: "p1",
        projectEpoch: 1,
        output: [functionItem("fc_other", "call_other")],
      }),
    });
    const req = request({
      tools: [tool],
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "read_file", arguments: functionItem().arguments }],
        },
        { role: "tool", toolCallId: "call_1", content: "result" },
      ],
    });
    await expect(restored.completeNative(req)).rejects.toMatchObject({
      code: "malformed_response",
    });
    expect(gate.getPending()).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("existing runtime seam", () => {
  it("feeds completed calls and measured usage through the unchanged ProviderAdapter runner", async () => {
    const { runProviderStream } = await import("../provider-runner.js");
    const full = functionItem();
    const value = session(
      mockFetch().mockResolvedValue(
        sse([
          created(),
          added({ ...full, arguments: "" }),
          {
            type: "response.function_call_arguments.delta",
            item_id: "fc_1",
            output_index: 0,
            delta: full.arguments,
          },
          completed({ output: [full] }),
        ]),
      ),
    );
    const result = await runProviderStream(value.adapter, request({ tools: [tool] }));
    expect(result.response).toMatchObject({
      finishReason: "tool_calls",
      toolCalls: [{ id: "call_1", name: "read_file", arguments: full.arguments }],
    });
    expect(
      result.events.filter((event) => event.type === "provider_tool_call_completed"),
    ).toHaveLength(1);
    expect(result.events.filter((event) => event.type === "provider_usage_recorded")).toHaveLength(
      1,
    );
    expect(result.events.some((event) => event.type === "provider_request_failed")).toBe(false);
  });

  it("applies the runner's aggregate argument bound to native complete responses too", () => {
    const args = JSON.stringify({ path: "x".repeat(9000) });
    expect(() =>
      parseResponsesResult(
        responseBody({
          output: [functionItem("fc_1", "call_1", args), functionItem("fc_2", "call_2", args)],
        }),
        request({ tools: [tool] }),
      ),
    ).toThrowError();
  });
});

describe("trusted native continuation scope", () => {
  const native = [
    {
      type: "reasoning",
      id: "rs_private",
      summary: [],
      encrypted_content: "project-A-private-reasoning",
    },
    functionItem(),
  ];
  const continuation = (first: ProviderRuntimeRequest): ProviderRuntimeRequest =>
    request({
      ...first,
      id: "req_next",
      messages: [
        ...first.messages,
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "read_file", arguments: functionItem().arguments }],
        },
        { role: "tool", toolCallId: "call_1", content: "visible result" },
      ],
    });

  it.each(["omitted metadata", "omitted epoch"] as const)(
    "binds cached reasoning to actual context with %s",
    async (mode) => {
      let context = { projectId: "A", epoch: 1, revision: "revision-1" };
      const gate = createOutboundConsentGate();
      const fetcher = mockFetch()
        .mockImplementationOnce(async () => jsonResponse({ output: native }))
        .mockImplementationOnce(async () => jsonResponse());
      const value = session(fetcher, {
        mode: "live",
        outboundGate: gate,
        getProjectContext: () => context,
      });
      const first = request({
        tools: [tool],
        ...(mode === "omitted epoch" ? { metadata: { projectId: "A" } } : {}),
      });
      const pending = value.completeNative(first);
      gate.approve(gate.getPending()!.id);
      await pending;
      const next = continuation(first);
      expect(value.preview(next, false).body).toContain("project-A-private-reasoning");
      context =
        mode === "omitted metadata"
          ? { projectId: "B", epoch: 1, revision: "revision-2" }
          : { projectId: "A", epoch: 2, revision: "revision-2" };
      const continued = value.completeNative(next);
      const review = gate.getPending()!;
      expect(review.envelope.projectId).toBe(context.projectId);
      expect(review.envelope.epoch).toBe(context.epoch);
      expect(review.envelope.body).not.toContain("project-A-private-reasoning");
      gate.approve(review.id);
      await continued;
      expect(fetcher.mock.calls[1][1]!.body).toBe(review.envelope.body);
    },
  );

  it("refuses cached native continuation when the trusted project identity disappears", async () => {
    let projectId: string | null = "A";
    const fetcher = mockFetch().mockResolvedValue(jsonResponse({ output: native }));
    const value = session(fetcher, {
      getProjectContext: () => ({ projectId, epoch: 1, revision: "r1" }),
    });
    const first = request({ tools: [tool] });
    await value.completeNative(first);
    projectId = null;
    await expect(value.completeNative(continuation(first))).rejects.toMatchObject({
      code: "provider_unavailable",
      message: expect.stringContaining("Trusted project identity"),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not use caller metadata as authority for persisted native continuation", async () => {
    const fetcher = mockFetch();
    const replay = vi.fn(() => ({ projectId: "A", projectEpoch: 1, output: native }));
    const value = session(fetcher, { replayNativeOutput: replay });
    const first = request({ tools: [tool], metadata: { projectId: "A", projectEpoch: 1 } });
    await expect(value.completeNative(continuation(first))).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    expect(replay).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    { projectId: "B", projectEpoch: 1 },
    { projectId: "A", projectEpoch: 2 },
  ])("rejects persisted native output from another actual scope (%j)", async (actual) => {
    const fetcher = mockFetch(),
      gate = createOutboundConsentGate();
    const value = session(fetcher, {
      outboundGate: gate,
      getProjectContext: () => ({
        projectId: actual.projectId,
        epoch: actual.projectEpoch,
        revision: "r1",
      }),
      replayNativeOutput: () => ({ projectId: "A", projectEpoch: 1, output: native }),
    });
    await expect(
      value.completeNative(continuation(request({ tools: [tool] }))),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(gate.getPending()).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("all outward response strings and preparation errors", () => {
  it.each(["completeNative", "legacy complete", "stream"] as const)(
    "rejects a response identity containing the credential through %s",
    async (api) => {
      const id = "resp_" + credential;
      const fetcher = mockFetch().mockImplementation(async () =>
        api === "stream"
          ? sse([
              { type: "response.created", response: { id, model, status: "in_progress" } },
              completed({ id }),
            ])
          : jsonResponse({ id }),
      );
      const value = session(fetcher);
      const chunks: ResponsesStreamChunk[] = [];
      const error = await (
        api === "completeNative"
          ? value.completeNative(request())
          : api === "legacy complete"
            ? value.adapter.complete(request())
            : (async () => {
                for await (const chunk of value.stream(request())) chunks.push(chunk);
              })()
      ).catch((error) => error);
      expect(error).toMatchObject({ name: "ProviderRuntimeError", code: "malformed_response" });
      expect(JSON.stringify(error)).not.toContain(credential);
      expect(JSON.stringify(chunks)).not.toContain(credential);
      expect(chunks.every((chunk) => !chunk.done && !chunk.responseId)).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["nested value", "nested property"] as const)(
    "rejects credential echo in a native output %s",
    async (field) => {
      const output = [
        {
          ...message(),
          extra: field === "nested value" ? { deeper: [credential] } : { [credential]: true },
        },
      ];
      const fetcher = mockFetch().mockResolvedValue(jsonResponse({ output }));
      await expect(session(fetcher).completeNative(request())).rejects.toMatchObject({
        code: "malformed_response",
      });
    },
  );

  it.each(["completeNative", "stream", "preview"] as const)(
    "normalizes a credential-bearing restore callback error through %s before review",
    async (api) => {
      const gate = createOutboundConsentGate(),
        fetcher = mockFetch();
      const value = session(fetcher, {
        outboundGate: gate,
        getProjectContext: () => ({ projectId: "A", epoch: 1, revision: "r1" }),
        replayNativeOutput: () => {
          throw new Error("restore callback leaked " + credential);
        },
      });
      const req = request({
        tools: [tool],
        messages: [
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "call_1", name: "read_file", arguments: functionItem().arguments }],
          },
          { role: "tool", toolCallId: "call_1", content: "result" },
        ],
      });
      let error: unknown;
      try {
        if (api === "completeNative") await value.completeNative(req);
        else if (api === "stream") await collect(value.stream(req));
        else value.preview(req);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ name: "ProviderRuntimeError", code: "provider_unavailable" });
      expect(JSON.stringify(error)).not.toContain(credential);
      expect(error).not.toBeInstanceOf(Error);
      expect(gate.getPending()).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("releases session state after preparation fails and sanitizes context callback failures", async () => {
    const fetcher = mockFetch().mockResolvedValue(jsonResponse());
    let failContext = true;
    const value = session(fetcher, {
      getProjectContext: () => {
        if (failContext) throw new Error(credential);
        return { projectId: "A", epoch: 1, revision: "r1" };
      },
    });
    const error = await value.completeNative(request()).catch((error) => error);
    expect(error).toMatchObject({ name: "ProviderRuntimeError", code: "provider_unavailable" });
    expect(JSON.stringify(error)).not.toContain(credential);
    expect(fetcher).not.toHaveBeenCalled();
    failContext = false;
    await expect(value.completeNative(request())).resolves.toMatchObject({ id: "resp_1" });
  });
});

describe("native SSE sequence ordering", () => {
  it.each(["duplicate", "out of order"] as const)(
    "rejects %s sequence_number before terminal calls",
    async (mode) => {
      const full = functionItem(),
        chunks: ResponsesStreamChunk[] = [];
      const events = [
        { ...created(), sequence_number: 0 },
        { ...added({ ...full, arguments: "" }), sequence_number: mode === "duplicate" ? 1 : 2 },
        {
          type: "response.function_call_arguments.delta",
          item_id: "fc_1",
          output_index: 0,
          delta: full.arguments,
          sequence_number: 1,
        },
        { ...completed({ output: [full] }), sequence_number: 3 },
      ];
      const value = session(mockFetch().mockResolvedValue(sse(events)));
      const error = await (async () => {
        for await (const chunk of value.stream(request({ tools: [tool] }))) chunks.push(chunk);
      })().catch((error) => error);
      expect(error).toMatchObject({
        code: "malformed_response",
        message: expect.stringContaining("sequence"),
      });
      expect(chunks.every((chunk) => !chunk.done && !chunk.toolCalls)).toBe(true);
    },
  );
});

describe("trusted scope and credential snapshots during callbacks", () => {
  it("cancels a completed response if the actual project changed while fetch was pending", async () => {
    let projectId = "A";
    const fetcher = mockFetch().mockImplementation(async () => {
      projectId = "B";
      return jsonResponse();
    });
    const value = session(fetcher, {
      getProjectContext: () => ({ projectId, epoch: 1, revision: "r1" }),
    });
    await expect(value.completeNative(request())).rejects.toMatchObject({ code: "cancelled" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refuses terminal chunks after the actual project epoch changes between consumer steps", async () => {
    let epoch = 1;
    const fetcher = mockFetch().mockResolvedValue(
      sse([
        created(),
        added({ ...message(), content: [] }),
        {
          type: "response.output_text.delta",
          item_id: "msg_1",
          output_index: 0,
          content_index: 0,
          delta: "完成",
        },
        completed(),
      ]),
    );
    const value = session(fetcher, {
      getProjectContext: () => ({ projectId: "A", epoch, revision: "r1" }),
    });
    const iterator = value.stream(request());
    expect((await iterator.next()).value).toMatchObject({ done: false });
    epoch = 2;
    await expect(iterator.next()).rejects.toMatchObject({ code: "cancelled" });
  });

  it("cannot expose a credential-bearing derived request/chunk identity", async () => {
    const fetcher = mockFetch();
    await expect(
      session(fetcher).completeNative(request({ id: "req_" + credential })),
    ).rejects.toMatchObject({ code: "auth_missing" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});

it("snapshots the legacy request identity before caller mutation during approval", async () => {
  const gate = createOutboundConsentGate(),
    fetcher = mockFetch().mockResolvedValue(jsonResponse());
  const value = session(fetcher, { outboundGate: gate });
  const req = request(),
    pending = value.adapter.complete(req);
  req.id = "req_" + credential;
  gate.approve(gate.getPending()!.id);
  const result = await pending;
  expect(result.requestId).toBe("req_1");
  expect(JSON.stringify(result)).not.toContain(credential);
});

describe("protocol JSON argument credential semantics", () => {
  const apis = ["completeNative", "legacy complete", "stream"] as const;
  const kinds = ["value", "property"] as const;
  const unicode = (text: string) =>
    text
      .split("")
      .map((character) => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"))
      .join("");
  const encodedArguments = (kind: (typeof kinds)[number], token = credential, nested = false) => {
    const encoded = unicode(token);
    const inner = kind === "value" ? '{"path":"' + encoded + '"}' : '{"' + encoded + '":"safe"}';
    return nested ? '{"outer":[{"deeper":' + inner + "}]}" : inner;
  };
  const history = (args: string): ProviderRuntimeRequest =>
    request({
      tools: [tool],
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call_1", name: "read_file", arguments: args }],
        },
        { role: "tool", toolCallId: "call_1", content: "visible result" },
      ],
    });
  async function output(api: (typeof apis)[number], args: string) {
    const full = functionItem("fc_1", "call_1", args);
    const fetcher = mockFetch().mockImplementation(async () =>
      api === "stream"
        ? sse([
            created(),
            added({ ...full, arguments: "" }),
            {
              type: "response.function_call_arguments.delta",
              item_id: "fc_1",
              output_index: 0,
              delta: args,
            },
            completed({ output: [full] }),
          ])
        : jsonResponse({ output: [full] }),
    );
    const value = session(fetcher),
      chunks: ResponsesStreamChunk[] = [];
    const response =
      api === "completeNative"
        ? value.completeNative(request({ tools: [tool] }))
        : api === "legacy complete"
          ? value.adapter.complete(request({ tools: [tool] }))
          : (async () => {
              for await (const chunk of value.stream(request({ tools: [tool] })))
                chunks.push(chunk);
              return chunks.at(-1)!;
            })();
    return { response, chunks, fetcher };
  }

  it.each(apis.flatMap((api) => kinds.map((kind) => ({ api, kind }))))(
    "refuses Unicode-escaped credential $kind through $api",
    async ({ api, kind }) => {
      const args = encodedArguments(kind);
      expect(args).not.toContain(credential);
      expect(JSON.stringify(JSON.parse(args))).toContain(credential);
      const probe = await output(api, args);
      const error = await probe.response.catch((error) => error);
      expect(error).toMatchObject({ name: "ProviderRuntimeError", code: "malformed_response" });
      expect(JSON.stringify(error)).not.toContain(credential);
      expect(probe.chunks.every((chunk) => !chunk.done && !chunk.toolCalls)).toBe(true);
      expect(
        probe.chunks
          .flatMap((chunk) => (chunk.toolCallDelta ? [chunk.toolCallDelta.argumentsDelta] : []))
          .join(""),
      ).not.toBe(args);
      expect(probe.fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each(apis.flatMap((api) => kinds.map((kind) => ({ api, kind }))))(
    "recurses into decoded arrays/objects for an escaped $kind through $api",
    async ({ api, kind }) => {
      const probe = await output(api, encodedArguments(kind, credential, true));
      await expect(probe.response).rejects.toMatchObject({ code: "malformed_response" });
      expect(probe.chunks.every((chunk) => !chunk.done && !chunk.toolCalls)).toBe(true);
    },
  );

  const literals = [
    "escaped key text",
    "nested JSON string",
    "JSON-looking arguments property",
  ] as const;
  it.each(apis.flatMap((api) => literals.map((kind) => ({ api, kind }))))(
    "keeps $kind literal after one protocol decode through $api",
    async ({ api, kind }) => {
      const args =
        kind === "escaped key text"
          ? JSON.stringify({ outer: [{ [unicode(credential)]: "safe" }] })
          : kind === "nested JSON string"
            ? JSON.stringify({ outer: [{ json: encodedArguments("value") }] })
            : JSON.stringify({ arguments: JSON.stringify({ json: encodedArguments("value") }) });
      expect(args).not.toContain(credential);
      expect(JSON.stringify(JSON.parse(args))).not.toContain(credential);
      const probe = await output(api, args);
      const result = await probe.response;
      expect(result.toolCalls?.[0].arguments).toBe(args);
      if (api === "stream") expect(probe.chunks.at(-1)?.done).toBe(true);
    },
  );

  const entries = ["completeNative", "stream", "preview"] as const;
  it.each(entries.flatMap((api) => kinds.map((kind) => ({ api, kind }))))(
    "blocks an outgoing historical escaped $kind before approval through $api",
    async ({ api, kind }) => {
      const args = encodedArguments(kind),
        req = history(args);
      const fetcher = mockFetch(),
        gate = createOutboundConsentGate(),
        value = session(fetcher, { outboundGate: gate });
      let error: unknown;
      try {
        if (api === "completeNative") await value.completeNative(req);
        else if (api === "stream") await collect(value.stream(req));
        else value.preview(req);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ name: "ProviderRuntimeError", code: "auth_missing" });
      expect(req.messages[0].toolCalls?.[0].arguments).toBe(args);
      expect(gate.getPending()).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it("does not retain a rejected encoded response in the native continuation cache", async () => {
    const args = encodedArguments("value");
    const privateItem = {
      type: "reasoning",
      id: "rs_rejected",
      summary: [],
      encrypted_content: "rejected-native-item",
    };
    const fetcher = mockFetch().mockResolvedValue(
      jsonResponse({ output: [privateItem, functionItem("fc_1", "call_1", args)] }),
    );
    const value = session(fetcher, {
      getProjectContext: () => ({ projectId: "A", epoch: 1, revision: "r1" }),
    });
    const initial = request({ tools: [tool] });
    await expect(value.completeNative(initial)).rejects.toMatchObject({
      code: "malformed_response",
    });
    value.setCredential("different-rotated-synthetic-key");
    const next = request({
      tools: [tool],
      messages: [...initial.messages, ...history(args).messages],
    });
    expect(value.preview(next, false).body).not.toContain("rejected-native-item");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(kinds)("rechecks cached escaped %s when the active credential changes", async (kind) => {
    const futureKey = "future-synthetic-key-987654",
      args = encodedArguments(kind, futureKey);
    const native = [
      {
        type: "reasoning",
        id: "rs_cached",
        summary: [],
        encrypted_content: "retained-native-item",
      },
      functionItem("fc_1", "call_1", args),
    ];
    const fetcher = mockFetch().mockResolvedValue(jsonResponse({ output: native }));
    const value = session(fetcher, {
      getProjectContext: () => ({ projectId: "A", epoch: 1, revision: "r1" }),
    });
    const initial = request({ tools: [tool] });
    await value.completeNative(initial);
    const next = request({
      tools: [tool],
      messages: [...initial.messages, ...history(args).messages],
    });
    expect(value.preview(next, false).body).toContain("retained-native-item");
    value.setCredential(futureKey);
    await expect(value.completeNative(next)).rejects.toMatchObject({ code: "auth_missing" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(kinds)(
    "checks an escaped restored %s in the actual serialized native input",
    async (kind) => {
      const args = encodedArguments(kind),
        fetcher = mockFetch(),
        gate = createOutboundConsentGate();
      const replay = vi.fn((req: ProviderRuntimeRequest, index: number) => {
        req.messages[index].toolCalls![0].arguments = args;
        return { projectId: "A", projectEpoch: 1, output: [functionItem("fc_1", "call_1", args)] };
      });
      const value = session(fetcher, {
        outboundGate: gate,
        getProjectContext: () => ({ projectId: "A", epoch: 1, revision: "r1" }),
        replayNativeOutput: replay,
      });
      const req = history("{}");
      await expect(value.completeNative(req)).rejects.toMatchObject({ code: "auth_missing" });
      expect(replay).toHaveBeenCalledTimes(1);
      expect(req.messages[0].toolCalls?.[0].arguments).toBe("{}");
      expect(gate.getPending()).toBeNull();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each(kinds)(
    "refuses terminal-only encoded %s before emitting final argument deltas",
    async (kind) => {
      const full = functionItem("fc_1", "call_1", encodedArguments(kind));
      const fetcher = mockFetch().mockResolvedValue(
        sse([created(), added({ ...full, arguments: "" }), completed({ output: [full] })]),
      );
      const chunks: ResponsesStreamChunk[] = [];
      const error = await (async () => {
        for await (const chunk of session(fetcher).stream(request({ tools: [tool] })))
          chunks.push(chunk);
      })().catch((error) => error);
      expect(error).toMatchObject({ code: "malformed_response" });
      expect(chunks.every((chunk) => !chunk.done && !chunk.toolCalls)).toBe(true);
      expect(
        chunks
          .flatMap((chunk) => (chunk.toolCallDelta ? [chunk.toolCallDelta.argumentsDelta] : []))
          .join(""),
      ).toBe("");
    },
  );

  it.each(kinds)("rejects a Unicode-escaped %s split inside the escape sequence", async (kind) => {
    const args = encodedArguments(kind),
      split = args.indexOf("\\u") + 4;
    const full = functionItem("fc_1", "call_1", args),
      chunks: ResponsesStreamChunk[] = [];
    const fetcher = mockFetch().mockResolvedValue(
      sse([
        created(),
        added({ ...full, arguments: "" }),
        {
          type: "response.function_call_arguments.delta",
          item_id: "fc_1",
          output_index: 0,
          delta: args.slice(0, split),
        },
        {
          type: "response.function_call_arguments.delta",
          item_id: "fc_1",
          output_index: 0,
          delta: args.slice(split),
        },
        completed({ output: [full] }),
      ]),
    );
    await expect(
      (async () => {
        for await (const chunk of session(fetcher).stream(request({ tools: [tool] })))
          chunks.push(chunk);
      })(),
    ).rejects.toMatchObject({ code: "malformed_response" });
    expect(chunks.every((chunk) => !chunk.done && !chunk.toolCalls)).toBe(true);
    expect(
      chunks
        .flatMap((chunk) => (chunk.toolCallDelta ? [chunk.toolCallDelta.argumentsDelta] : []))
        .join(""),
    ).not.toBe(args);
  });

  it("preserves safe Unicode escapes and exact argument whitespace through native caching and approved outbound replay", async () => {
    const args = ' { "path" : "\\u6587\\u4ef6.txt", "literal" : "\\\\u0061" } ';
    const full = functionItem("fc_1", "call_1", args);
    const fetcher = mockFetch()
      .mockImplementationOnce(async () => jsonResponse({ output: [full] }))
      .mockImplementationOnce(async () => jsonResponse());
    const gate = createOutboundConsentGate();
    const value = session(fetcher, {
      outboundGate: gate,
      getProjectContext: () => ({ projectId: "A", epoch: 1, revision: "r1" }),
    });
    const initial = request({ tools: [tool] }),
      first = value.completeNative(initial);
    gate.approve(gate.getPending()!.id);
    const result = await first;
    expect(result.toolCalls[0].arguments).toBe(args);
    expect(JSON.parse(args)).toEqual({ path: "文件.txt", literal: "\\u0061" });
    const next = request({
      tools: [tool],
      messages: [...initial.messages, ...history(args).messages],
    });
    const pending = value.completeNative(next),
      review = gate.getPending()!;
    const wire = JSON.parse(review.envelope.body);
    expect(
      wire.input.find((item: { type: string }) => item.type === "function_call").arguments,
    ).toBe(args);
    gate.approve(review.id);
    await pending;
    expect(fetcher.mock.calls[1][1]!.body).toBe(review.envelope.body);
  });
});
