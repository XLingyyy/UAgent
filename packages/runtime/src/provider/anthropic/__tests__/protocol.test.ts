import { describe, expect, it } from "vitest";
import type { ProviderRuntimeMessage } from "@uagent/shared";
import { MessagesEvents } from "../events.js";
import { parseMessage } from "../protocol.js";
import {
  body,
  collect,
  credential,
  events,
  fixture,
  json,
  model,
  request,
  streamResponse,
  tool,
} from "./fixtures.js";
import type { AnthropicAssistantBlock } from "../protocol.js";

describe("Anthropic Messages native protocol", () => {
  it("serializes system/developer, native tools and an explicit model; reports actual usage", async () => {
    const h = fixture();
    h.fetcher.mockResolvedValue(
      json({
        usage: {
          input_tokens: 10,
          output_tokens: 7,
          cache_creation_input_tokens: 2,
          cache_read_input_tokens: 3,
        },
      }),
    );
    const response = await h.session.complete(request({ temperature: 0.2, toolChoice: "none" }));
    const init = h.fetcher.mock.calls[0]![1]!,
      wire = JSON.parse(init.body as string);
    expect(wire).toMatchObject({
      model,
      max_tokens: 4096,
      stream: false,
      system: [{ type: "text", text: "Use approved tools." }],
      messages: [{ role: "user", content: [{ type: "text", text: "Read 项目.txt" }] }],
      tools: [{ name: tool.name, input_schema: tool.parameters }],
      tool_choice: { type: "none" },
      temperature: 0.2,
    });
    expect(init.headers).toMatchObject({
      "x-api-key": credential,
      "anthropic-version": "2023-06-01",
    });
    expect(init).toMatchObject({ redirect: "error", credentials: "omit", cache: "no-store" });
    expect(response).toMatchObject({
      requestId: "request_1",
      text: "Hello 世界",
      finishReason: "stop",
      usageStatus: "reported",
      usage: { inputTokens: 15, outputTokens: 7, totalTokens: 22 },
    });
    expect(h.session.getStatus().connectivity).toBe("unverified");
  });
  it.each([undefined, {}, { input_tokens: 10 }])(
    "keeps missing/partial usage unknown (%j)",
    async (usage) => {
      const h = fixture();
      h.fetcher.mockResolvedValue(json({ usage }));
      const response = await h.session.complete(request());
      expect(response.usageStatus).toBe("unknown");
      expect(response.usage).toBeUndefined();
    },
  );
  it.each([
    ["end_turn", "stop"],
    ["stop_sequence", "stop"],
    ["max_tokens", "length"],
    ["refusal", "stop"],
    ["model_context_window_exceeded", "length"],
  ])("maps %s without inventing success", async (reason, finish) => {
    const h = fixture();
    h.fetcher.mockResolvedValue(
      json({ stop_reason: reason, stop_sequence: reason === "stop_sequence" ? "STOP" : null }),
    );
    const response = await h.session.completeNative(request());
    expect(response.stopReason).toBe(reason);
    expect(response.finishReason).toBe(finish);
  });
  it.each(["pause_turn", "future_reason"])("rejects unsupported stop reason %s", async (reason) => {
    const h = fixture();
    h.fetcher.mockResolvedValue(json({ stop_reason: reason }));
    await expect(h.session.complete(request())).rejects.toMatchObject({
      code: "malformed_response",
    });
  });
  it("handles byte-split UTF-8, CRLF, pings and cumulative stream usage", async () => {
    const h = fixture();
    const data = events();
    data.splice(2, 0, { type: "ping" }, { type: "future_top_level", optional: "ignored" });
    data.unshift({ type: "future_pre_message_event" });
    data.splice(data.length - 1, 0, {
      type: "message_delta",
      delta: {},
      usage: { output_tokens: 9 },
    });
    h.fetcher.mockResolvedValue(streamResponse(data, 1, "\r\n"));
    const chunks = await collect(h.session);
    expect(chunks.map((c) => c.delta).join("")).toBe("Hello 世界");
    expect(chunks.at(-1)).toMatchObject({
      done: true,
      messageId: "msg_1",
      usageStatus: "reported",
      usage: { inputTokens: 15, outputTokens: 9, totalTokens: 24 },
    });
  });
  it("does not mistake the message_start output placeholder for final usage", async () => {
    const h = fixture();
    h.fetcher.mockResolvedValue(streamResponse(events(undefined, { finalUsage: null })));
    expect((await collect(h.session)).at(-1)).toMatchObject({
      done: true,
      usageStatus: "unknown",
      usage: undefined,
    });
  });
  it("round-trips thinking/signature/redacted blocks and exact tool IDs through three requests", async () => {
    const first: AnthropicAssistantBlock[] = [
      { type: "thinking", thinking: "native thinking\n", signature: "signed_opaque_bytes==" },
      { type: "redacted_thinking", data: "opaque_redacted==" },
      { type: "tool_use", id: "toolu_first", name: "read_file", input: { path: "项目.txt" } },
    ];
    const second: AnthropicAssistantBlock[] = [
      { type: "thinking", thinking: "", signature: "signature_only==" },
      { type: "tool_use", id: "toolu_second", name: "read_file", input: { path: "next.txt" } },
    ];
    const args = ' { "path" : "项目.txt" } ';
    const h = fixture({ thinking: { type: "adaptive" } });
    h.fetcher
      .mockResolvedValueOnce(streamResponse(events(first, { args: new Map([[2, args]]) })))
      .mockResolvedValueOnce(json({ id: "msg_2", content: second, stop_reason: "tool_use" }))
      .mockResolvedValueOnce(json({ id: "msg_3", content: [{ type: "text", text: "Done." }] }));
    const one = (await collect(h.session)).at(-1)!;
    expect(one.toolCalls).toEqual([{ id: "toolu_first", name: "read_file", arguments: args }]);
    const base = request(),
      messages: ProviderRuntimeMessage[] = [
        ...base.messages,
        { role: "assistant", content: "", toolCalls: one.toolCalls },
        { role: "tool", toolCallId: "toolu_first", name: "read_file", content: "approved result" },
      ];
    // Mutating a public native result cannot change the private continuation.
    (one.nativeContent![0] as { signature: string }).signature = "tampered";
    const two = await h.session.completeNative(request({ id: "request_2", messages }));
    expect(two.toolCalls[0]!.id).toBe("toolu_second");
    const wire2 = JSON.parse(h.fetcher.mock.calls[1]![1]!.body as string);
    expect(wire2.messages[1]).toEqual({ role: "assistant", content: first });
    expect(wire2.messages[2]).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_first",
          content: [{ type: "text", text: "approved result" }],
        },
      ],
    });
    expect(wire2.thinking).toEqual({ type: "adaptive" });
    const three = await h.session.complete(
      request({
        id: "request_3",
        messages: [
          ...messages,
          { role: "assistant", content: "", toolCalls: two.toolCalls },
          { role: "tool", toolCallId: "toolu_second", content: "second result" },
        ],
      }),
    );
    expect(three.text).toBe("Done.");
    const wire3 = JSON.parse(h.fetcher.mock.calls[2]![1]!.body as string);
    expect(wire3.messages[3]).toEqual({ role: "assistant", content: second });
    expect(wire3.messages[4].content[0].tool_use_id).toBe("toolu_second");
    expect(h.fetcher).toHaveBeenCalledTimes(3);
  });
  it("groups parallel tool results before user text and rejects missing/duplicate/foreign result IDs", async () => {
    const h = fixture();
    h.fetcher.mockResolvedValue(
      json({
        content: [
          { type: "tool_use", id: "toolu_A", name: "read_file", input: {} },
          { type: "tool_use", id: "toolu_B", name: "read_file", input: {} },
        ],
        stop_reason: "tool_use",
      }),
    );
    const result = await h.session.complete(request()),
      prefix: ProviderRuntimeMessage[] = [
        ...request().messages,
        { role: "assistant", content: "", toolCalls: result.toolCalls },
      ];
    for (const tail of [
      [{ role: "tool", toolCallId: "foreign", content: "result" }],
      [{ role: "tool", toolCallId: "toolu_A", content: "result" }],
      [
        { role: "tool", toolCallId: "toolu_A", content: "result" },
        { role: "tool", toolCallId: "toolu_A", content: "duplicate" },
      ],
    ] as ProviderRuntimeMessage[][])
      await expect(
        h.session.complete(request({ messages: [...prefix, ...tail] })),
      ).rejects.toMatchObject({ code: "malformed_response" });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    h.fetcher.mockResolvedValue(json());
    await h.session.complete(
      request({
        messages: [
          ...prefix,
          { role: "tool", toolCallId: "toolu_B", content: "B" },
          { role: "tool", toolCallId: "toolu_A", content: "A" },
          { role: "user", content: "continue" },
        ],
      }),
    );
    const wire = JSON.parse(h.fetcher.mock.calls[1]![1]!.body as string);
    expect(wire.messages[2].content.map((b: { type: string }) => b.type)).toEqual([
      "tool_result",
      "tool_result",
      "text",
    ]);
  });
  it.each([
    { model: "silently-substituted" },
    { content: [{ type: "server_tool_use", id: "srv_1", name: "web_search", input: {} }] },
    { content: [{ type: "thinking", thinking: "unsigned", signature: "" }] },
    {
      content: [{ type: "tool_use", id: "toolu_1", name: "read_file", input: {} }],
      stop_reason: "max_tokens",
    },
    { usage: { input_tokens: -1, output_tokens: 2 } },
  ])("rejects unsupported or incomplete native output (%j)", async (patch) => {
    const h = fixture();
    h.fetcher.mockResolvedValue(json(patch));
    await expect(h.session.complete(request())).rejects.toMatchObject({
      code: "malformed_response",
    });
  });
  it.each([
    (e: Array<Record<string, unknown>>) => e.slice(0, -1),
    (e: Array<Record<string, unknown>>) => [e[0]!, e[0]!, ...e.slice(1)],
    (e: Array<Record<string, unknown>>) => e.map((x, i) => (i === 1 ? { ...x, index: 4 } : x)),
    (e: Array<Record<string, unknown>>) => e.filter((x) => x.type !== "content_block_stop"),
    (e: Array<Record<string, unknown>>) =>
      e.map((x) =>
        x.type === "content_block_delta"
          ? { ...x, delta: { type: "input_json_delta", partial_json: "{}" } }
          : x,
      ),
    (e: Array<Record<string, unknown>>) => [
      ...e.slice(0, -1),
      { type: "message_delta", delta: {}, usage: { output_tokens: 1 } },
      e.at(-1)!,
    ],
  ])(
    "rejects truncated, duplicate, wrong-index/type or decreasing-usage streams",
    async (mutate) => {
      const h = fixture();
      h.fetcher.mockResolvedValue(streamResponse(mutate(events())));
      await expect(collect(h.session)).rejects.toMatchObject({ code: "malformed_response" });
    },
  );
  it("validates SSE event names and empty tool JSON without conflating block index and tool index", async () => {
    const content: AnthropicAssistantBlock[] = [
      { type: "text", text: "Tool:" },
      { type: "tool_use", id: "toolu_empty", name: "read_file", input: {} },
    ];
    const h = fixture();
    h.fetcher.mockResolvedValue(streamResponse(events(content)));
    const chunks = await collect(h.session);
    expect(chunks.find((c) => c.toolCallDelta)?.toolCallDelta).toMatchObject({
      index: 0,
      id: "toolu_empty",
      argumentsDelta: "{}",
    });
    const parser = new MessagesEvents(request());
    expect(() => parser.accept(events()[0], "different_event")).toThrow();
    expect(() =>
      parseMessage(body({ content: [{ type: "text", text: "ok", citations: [{}] }] }), request()),
    ).toThrow();
  });
  it.each([null, []])(
    "preserves empty citations metadata in complete and streamed native text (%j)",
    async (citations) => {
      const h = fixture(),
        content: AnthropicAssistantBlock[] = [
          { type: "text", text: "plain", citations: citations as null | [] },
        ];
      h.fetcher.mockResolvedValueOnce(json({ content }));
      expect((await h.session.completeNative(request())).content).toEqual(content);
      const data = events(content).map((event) =>
        event.type === "content_block_start"
          ? { ...event, content_block: { ...(event.content_block as object), citations } }
          : event,
      );
      h.fetcher.mockResolvedValueOnce(streamResponse(data));
      const terminal = (await collect(h.session)).at(-1)!;
      expect(terminal.nativeContent).toEqual(content);
      expect(terminal.done).toBe(true);
    },
  );
  it("preserves the latest complete signature_delta value without concatenating opaque signatures", async () => {
    const h = fixture(),
      content: AnthropicAssistantBlock[] = [
        { type: "thinking", thinking: "native", signature: "final_opaque_signature==" },
      ];
    const data = events(content),
      signature = data.findIndex(
        (event) =>
          event.type === "content_block_delta" &&
          (event.delta as { type: string }).type === "signature_delta",
      );
    data.splice(signature, 0, {
      type: "content_block_delta",
      index: 0,
      delta: { type: "signature_delta", signature: "previous_opaque_signature==" },
    });
    h.fetcher.mockResolvedValue(streamResponse(data, 1));
    const terminal = (await collect(h.session)).at(-1)!;
    expect(terminal.nativeContent).toEqual(content);
    expect(terminal.delta).toBe("");
  });
  it("uses an explicit snapshotted native manual thinking budget and rejects invalid budgets before dispatch", async () => {
    const thinking = { type: "enabled" as const, budget_tokens: 1024 },
      h = fixture({ thinking });
    thinking.budget_tokens = 2048;
    h.fetcher.mockResolvedValue(json());
    await h.session.complete(request());
    expect(JSON.parse(h.fetcher.mock.calls[0]![1]!.body as string).thinking).toEqual({
      type: "enabled",
      budget_tokens: 1024,
    });
    for (const budget_tokens of [0, 1023, 4096]) {
      const invalid = fixture({ thinking: { type: "enabled", budget_tokens } });
      await expect(invalid.session.complete(request())).rejects.toMatchObject({
        code: "malformed_response",
      });
      expect(invalid.fetcher).not.toHaveBeenCalled();
    }
  });
});
