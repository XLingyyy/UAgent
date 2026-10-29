import type { ProviderCallOptions } from "../../provider-adapter.js";
import { describe, expect, it, vi } from "vitest";
import type {
  OutboundConsentGate,
  OutboundEnvelope,
  OutboundGrant,
} from "../../outbound-consent.js";
import { createOutboundConsentGate } from "../../outbound-consent.js";
import {
  body,
  collect,
  credential,
  events,
  fixture,
  frame,
  json,
  model,
  owner,
  request,
  streamResponse,
} from "./fixtures.js";
import type { AnthropicAssistantBlock } from "../protocol.js";

function gate(review: (envelope: OutboundEnvelope) => Promise<OutboundGrant>): OutboundConsentGate {
  return {
    review,
    getPending: () => null,
    subscribe: () => () => undefined,
    approve: () => undefined,
    invalidate: () => undefined,
  };
}
const escaped = () =>
  credential
    .split("")
    .map((c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"))
    .join("");
describe("Anthropic session boundaries", () => {
  it.each(["completeNative", "complete", "stream"] as const)(
    "dispatches %s only after exact-body approval and beforeSend, with a snapshotted request",
    async (path) => {
      const order: string[] = [],
        source = request(),
        seen: OutboundEnvelope[] = [];
      const h = fixture({
        mode: "live",
        outboundGate: gate(async (envelope) => {
          seen.push(envelope);
          order.push("approved");
          call.beforeSend = async () => {
            order.push("mutated hook");
          };
          source.id = "mutated_id";
          source.messages[1]!.content = "changed after review";
          return {
            consume(current) {
              order.push("consumed");
              expect(current).toEqual(envelope);
              return true;
            },
          };
        }),
      });
      h.fetcher.mockImplementation(async (_url, init) => {
        order.push("fetch");
        expect(init!.body).toBe(seen[0]!.body);
        expect(JSON.parse(init!.body as string).messages[0].content[0].text).toBe("Read 项目.txt");
        return path === "stream" ? streamResponse() : json();
      });
      const call = {
        beforeSend: async () => {
          order.push("beforeSend");
        },
      };
      if (path !== "stream")
        expect((await h.session[path](source, call)).requestId).toBe("request_1");
      else {
        const chunks = [];
        for await (const chunk of h.session.stream(source, call)) chunks.push(chunk);
        expect(chunks.at(-1)!.requestId).toBe("request_1");
      }
      expect(order).toEqual(["approved", "beforeSend", "consumed", "fetch"]);
      expect(seen[0]).toMatchObject({
        endpoint: "https://api.anthropic.com/v1/messages",
        projectId: owner.projectId,
        epoch: owner.projectEpoch,
        revision: "revision_1",
        model,
      });
    },
  );
  it.each(
    (["completeNative", "complete", "stream"] as const).flatMap((path) =>
      (["approval", "beforeSend", "consume"] as const).map((timing) => ({ path, timing })),
    ),
  )(
    "keeps $path at zero fetch when its fixed lease expires during $timing",
    async ({ path, timing }) => {
      let current = true;
      const h = fixture({
        mode: "live",
        isCurrent: () => current,
        outboundGate: gate(async () => {
          if (timing === "approval") current = false;
          return {
            consume() {
              if (timing === "consume") current = false;
              return true;
            },
          };
        }),
      });
      h.fetcher.mockResolvedValue(path === "stream" ? streamResponse() : json());
      const call = {
        beforeSend: async () => {
          if (timing === "beforeSend") current = false;
        },
      };
      const send = async () => {
        if (path !== "stream") return h.session[path](request(), call);
        for await (const chunk of h.session.stream(request(), call)) {
          void chunk;
        }
      };
      await expect(send()).rejects.toMatchObject({ code: "cancelled" });
      expect(h.fetcher).not.toHaveBeenCalled();
    },
  );
  it("checks the lease again after reading trusted context, and checks source revision after beforeSend", async () => {
    let current = true,
      reads = 0;
    const h = fixture({
      isCurrent: () => current,
      getProjectContext: () => {
        if (++reads === 1) current = false;
        return { projectId: owner.projectId, epoch: owner.projectEpoch, revision: "revision_1" };
      },
    });
    await expect(h.session.complete(request())).rejects.toMatchObject({ code: "cancelled" });
    expect(h.fetcher).not.toHaveBeenCalled();
    const second = fixture();
    await expect(
      second.session.complete(request(), {
        beforeSend: async () => {
          second.state.context.revision = "revision_2";
        },
      }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(second.fetcher).not.toHaveBeenCalled();
  });
  it("requires a single-use exact-body grant and does not retry a declined/revoked approval", async () => {
    const outbound = createOutboundConsentGate(),
      h = fixture({ mode: "live", outboundGate: outbound });
    const done = h.session.complete(request());
    await vi.waitFor(() => expect(outbound.getPending()).not.toBeNull());
    outbound.invalidate();
    await expect(done).rejects.toMatchObject({ code: "cancelled" });
    expect(h.fetcher).not.toHaveBeenCalled();
    const denied = fixture({
      mode: "live",
      outboundGate: gate(async () => ({ consume: () => false })),
    });
    await expect(denied.session.complete(request())).rejects.toMatchObject({ code: "cancelled" });
    expect(denied.fetcher).not.toHaveBeenCalled();
  });
  it.each([{ projectId: "project_B" }, { projectEpoch: 3 }, { runId: "run_B" }])(
    "cannot derive/override trusted ownership from request metadata (%j)",
    async (metadata) => {
      const h = fixture();
      await expect(h.session.complete(request({ metadata }))).rejects.toMatchObject({
        code: "cancelled",
      });
      expect(h.fetcher).not.toHaveBeenCalled();
    },
  );
  it("does not reuse native thinking across project, epoch, run, conversation or credential sessions", async () => {
    const h = fixture();
    h.fetcher.mockResolvedValue(
      json({
        content: [
          { type: "thinking", thinking: "native", signature: "private_signature" },
          { type: "tool_use", id: "toolu_A", name: "read_file", input: {} },
        ],
        stop_reason: "tool_use",
      }),
    );
    const result = await h.session.complete(request()),
      messages = [
        ...request().messages,
        { role: "assistant" as const, content: "", toolCalls: result.toolCalls },
        { role: "tool" as const, toolCallId: "toolu_A", content: "result" },
      ];
    h.state.context.projectId = "project_B";
    await expect(h.session.complete(request({ messages }))).rejects.toMatchObject({
      code: "cancelled",
    });
    h.state.context.projectId = owner.projectId;
    h.state.context.epoch++;
    await expect(h.session.complete(request({ messages }))).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
    for (const patch of [
      { projectId: "project_B" },
      { projectEpoch: 3 },
      { runId: "run_B" },
      { conversationId: "conversation_B" },
    ]) {
      const other = { ...owner, ...patch },
        fresh = fixture({
          owner: other,
          getProjectContext: () => ({
            projectId: other.projectId,
            epoch: other.projectEpoch,
            revision: "revision_1",
          }),
        });
      await expect(fresh.session.complete(request({ messages }))).rejects.toMatchObject({
        code: "provider_unavailable",
      });
      expect(fresh.fetcher).not.toHaveBeenCalled();
    }
    h.state.context.epoch = owner.projectEpoch;
    h.session.setCredential("another-synthetic-local-secret");
    await expect(h.session.complete(request({ messages }))).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it("fails closed for missing native assistant history rather than inventing or stripping thinking", async () => {
    const h = fixture();
    await expect(
      h.session.complete(
        request({
          messages: [
            { role: "user", content: "old question" },
            { role: "assistant", content: "old answer" },
            { role: "user", content: "continue" },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it.each(["complete", "completeNative", "stream"] as const)(
    "rejects response ID and JSON-semantic credential echo through %s",
    async (path) => {
      for (const location of ["id", "value", "key"] as const) {
        const h = fixture();
        const dangerous: AnthropicAssistantBlock[] = [
          {
            type: "tool_use",
            id: "toolu_A",
            name: "read_file",
            input: location === "key" ? { [credential]: "value" } : { path: credential },
          },
        ];
        if (path === "stream") {
          const input =
            location === "key" ? '{"' + escaped() + '":"value"}' : '{"path":"' + escaped() + '"}';
          let data = events(dangerous, { args: new Map([[0, input]]) });
          if (location === "id")
            data = events().map((x, i) =>
              i === 0
                ? {
                    ...x,
                    message: body({ id: "msg_" + credential, content: [], stop_reason: null }),
                  }
                : x,
            );
          h.fetcher.mockResolvedValue(streamResponse(data, 1));
        } else {
          const payload =
            location === "id"
              ? body({ id: "msg_" + credential })
              : body({ content: dangerous, stop_reason: "tool_use" });
          h.fetcher.mockResolvedValue(
            new Response(JSON.stringify(payload).replaceAll(credential, escaped()), {
              headers: { "Content-Type": "application/json" },
            }),
          );
        }
        const chunks: unknown[] = [];
        let failure: unknown;
        try {
          if (path === "stream") {
            for await (const c of h.session.stream(request())) chunks.push(c);
          } else await h.session[path](request());
        } catch (e) {
          failure = e;
        }
        expect(failure).toMatchObject({ code: "malformed_response" });
        expect(JSON.stringify(failure)).not.toContain(credential);
        expect(JSON.stringify(chunks)).not.toContain(credential);
        expect(chunks.some((c) => (c as { done?: boolean }).done)).toBe(false);
      }
    },
  );
  it("withholds a credential prefix across text deltas and never emits a successful terminal", async () => {
    const h = fixture();
    const data = events([{ type: "text", text: credential }]);
    // Split the secret across native deltas, so no single event contains it.
    const at = data.findIndex((x) => x.type === "content_block_delta");
    data.splice(
      at,
      2,
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "safe " + credential.slice(0, 12) },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: credential.slice(12) },
      },
    );
    h.fetcher.mockResolvedValue(streamResponse(data));
    const chunks = [];
    let error: unknown;
    try {
      for await (const c of h.session.stream(request())) chunks.push(c);
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ code: "malformed_response" });
    expect(chunks.map((c) => c.delta).join("")).not.toContain(credential);
    expect(chunks.some((c) => c.done)).toBe(false);
  });
  it("does not recursively decode JSON-looking strings inside a tool's actual JSON value", async () => {
    const literal = escaped(),
      h = fixture();
    const content: AnthropicAssistantBlock[] = [
      { type: "tool_use", id: "toolu_A", name: "read_file", input: { path: literal } },
    ];
    h.fetcher.mockResolvedValue(streamResponse(events(content)));
    const final = (await collect(h.session)).at(-1)!;
    expect(JSON.parse(final.toolCalls![0]!.arguments).path).toBe(literal);
    expect(JSON.parse(final.toolCalls![0]!.arguments).path).not.toBe(credential);
  });
  it.each(["beforeSend", "context", "network", "errorAccessor"] as const)(
    "normalizes %s callback failures without credential echo or raw cause",
    async (point) => {
      let error: unknown = new Error("private " + credential);
      if (point === "errorAccessor")
        error = new Proxy(
          {},
          {
            getPrototypeOf() {
              throw new Error(credential);
            },
          },
        );
      const h = fixture(
        point === "context"
          ? {
              getProjectContext: () => {
                throw error;
              },
            }
          : {},
      );
      if (point === "network") h.fetcher.mockRejectedValue(error);
      else h.fetcher.mockResolvedValue(json());
      let caught: unknown;
      try {
        await h.session.complete(request(), {
          beforeSend: async () => {
            if (point === "beforeSend" || point === "errorAccessor") throw error;
          },
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toMatchObject({ name: "ProviderRuntimeError" });
      expect(JSON.stringify(caught)).not.toContain(credential);
      expect((caught as { cause?: unknown }).cause).toBeUndefined();
      expect(h.fetcher).toHaveBeenCalledTimes(point === "network" ? 1 : 0);
    },
  );
  it.each([
    [401, "auth_missing"],
    [429, "rate_limited"],
    [529, "provider_unavailable"],
  ] as const)(
    "normalizes HTTP %i without reading/echoing the response body",
    async (status, code) => {
      const h = fixture();
      h.fetcher.mockResolvedValue(new Response(credential, { status }));
      await expect(h.session.complete(request())).rejects.toMatchObject({ code });
      expect(h.fetcher).toHaveBeenCalledTimes(1);
    },
  );
  it("handles native stream error events without fake completion or automatic retry", async () => {
    const h = fixture();
    h.fetcher.mockResolvedValue(
      streamResponse([
        { type: "error", error: { type: "overloaded_error", message: "service overloaded" } },
      ]),
    );
    await expect(collect(h.session)).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(h.fetcher).toHaveBeenCalledTimes(1);
  });
  it("cancels approval, hung transport and readers promptly even when underlying cancel never settles", async () => {
    const h = fixture({ timeoutMs: 10 });
    h.fetcher.mockImplementation(() => new Promise(() => undefined));
    await expect(h.session.complete(request())).rejects.toMatchObject({ code: "timeout" });
    expect(h.session.getStatus().busy).toBe(false);
    const controller = new AbortController(),
      reader = fixture({ timeoutMs: 100 });
    reader.fetcher.mockResolvedValue(
      new Response(new ReadableStream({ cancel: () => new Promise(() => undefined) }), {
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
    const result = (async () => {
      for await (const chunk of reader.session.stream(request(), { signal: controller.signal })) {
        void chunk;
      }
    })();
    setTimeout(() => controller.abort(), 5);
    await expect(result).rejects.toMatchObject({ code: "cancelled" });
    expect(reader.session.getStatus().busy).toBe(false);
    const approvalController = new AbortController(),
      outbound = createOutboundConsentGate(),
      waiting = fixture({ mode: "live", outboundGate: outbound });
    const pending = waiting.session.complete(request(), { signal: approvalController.signal });
    approvalController.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(waiting.fetcher).not.toHaveBeenCalled();
  });
  it("rejects a busy call and revokes an in-flight session without reviving its credential", async () => {
    const h = fixture();
    h.fetcher.mockImplementation(() => new Promise(() => undefined));
    const first = h.session.complete(request());
    await expect(h.session.complete(request())).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    h.session.close();
    await expect(first).rejects.toMatchObject({ code: "cancelled" });
    expect(h.session.getStatus()).toMatchObject({
      hasCredential: false,
      revoked: true,
      busy: false,
    });
    expect(() => h.session.setCredential(credential)).toThrow();
  });
  it.each([
    "http://api.anthropic.com/v1/messages",
    "https://api.anthropic.com.evil.invalid/v1/messages",
    "https://user:pass@api.anthropic.com/v1/messages",
    "https://api.anthropic.com/v1/messages?key=secret",
    "https://api.anthropic.com/v1/messages#fragment",
    "https://api.anthropic.com/v1/complete",
  ])("rejects an endpoint outside the explicit official HTTPS target (%s)", (endpoint) => {
    expect(() => fixture({ endpoint })).toThrow();
  });
  it("rejects credentials in actual outbound tool JSON semantics before approval and never changes model", async () => {
    const h = fixture({
      outboundGate: gate(async () => {
        throw Error("must not review");
      }),
    });
    await expect(
      h.session.complete(request({ messages: [{ role: "user", content: credential }] })),
    ).rejects.toMatchObject({ code: "malformed_response" });
    await expect(
      h.session.complete(
        request({
          messages: [
            ...request().messages,
            {
              role: "assistant",
              content: "",
              toolCalls: [
                { id: "toolu_A", name: "read_file", arguments: '{"path":"' + escaped() + '"}' },
              ],
            },
            { role: "tool", toolCallId: "toolu_A", content: "result" },
          ],
        }),
      ),
    ).rejects.toMatchObject({ code: "malformed_response" });
    await expect(h.session.complete(request({ modelId: "fallback-model" }))).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(h.fetcher).not.toHaveBeenCalled();
  });
  it("enforces body limits and rejects malformed UTF-8/SSE JSON, unsupported media types and partial SSE frames", async () => {
    const small = fixture({ maxRequestBytes: 16 });
    await expect(small.session.complete(request())).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    expect(small.fetcher).not.toHaveBeenCalled();
    const cases = [
      new Response(new Uint8Array([0xff]), { headers: { "Content-Type": "application/json" } }),
      new Response("data: not-json\n\n", { headers: { "Content-Type": "text/event-stream" } }),
      new Response(frame(events()[0]!).trimEnd(), {
        headers: { "Content-Type": "text/event-stream" },
      }),
      new Response("hello", { headers: { "Content-Type": "text/plain" } }),
    ];
    for (const response of cases) {
      const h = fixture();
      h.fetcher.mockResolvedValue(response);
      const send =
        response.headers.get("content-type") === "application/json"
          ? h.session.complete(request())
          : collect(h.session);
      await expect(send).rejects.toMatchObject({ code: "malformed_response" });
    }
    const limited = fixture({ maxResponseBytes: 8 });
    limited.fetcher.mockResolvedValue(json());
    await expect(limited.session.complete(request())).rejects.toMatchObject({
      code: "malformed_response",
    });
  });

  it.each(
    (["completeNative", "complete", "stream"] as const).flatMap((path) =>
      (["signal", "beforeSend"] as const).map((field) => ({ path, field })),
    ),
  )(
    "captures throwing CallOptions.$field inside $path failure boundary and releases busy state",
    async ({ path, field }) => {
      const h = fixture(),
        reads = { signal: 0, beforeSend: 0 },
        busyAtRead: boolean[] = [];
      const call: ProviderCallOptions = {};
      Object.defineProperties(call, {
        signal: {
          get() {
            reads.signal++;
            busyAtRead.push(h.session.getStatus().busy);
            if (field === "signal") throw new Error("getter private " + credential);
            return undefined;
          },
        },
        beforeSend: {
          get() {
            reads.beforeSend++;
            busyAtRead.push(h.session.getStatus().busy);
            throw new Error("getter private " + credential);
          },
        },
      });
      let caught: unknown;
      try {
        if (path === "stream") {
          for await (const chunk of h.session.stream(request(), call)) {
            void chunk;
          }
        } else await h.session[path](request(), call);
      } catch (error) {
        caught = error;
      }
      expect(h.fetcher).not.toHaveBeenCalled();
      expect(h.session.getStatus()).toMatchObject({
        busy: false,
        hasCredential: true,
        revoked: false,
      });
      expect(caught).toMatchObject({ name: "ProviderRuntimeError", code: "provider_unavailable" });
      expect(JSON.stringify(caught)).not.toContain(credential);
      expect((caught as { cause?: unknown }).cause).toBeUndefined();
      expect(reads).toEqual({ signal: 1, beforeSend: field === "signal" ? 0 : 1 });
      expect(busyAtRead.every(Boolean)).toBe(true);
      // Accessor failure cannot leave the same session wedged or poison its next explicit call.
      h.fetcher.mockResolvedValue(json());
      await expect(h.session.completeNative(request())).resolves.toMatchObject({
        text: "Hello 世界",
      });
      expect(h.fetcher).toHaveBeenCalledTimes(1);
      expect(h.session.getStatus().busy).toBe(false);
    },
  );
  it.each(["completeNative", "complete", "stream"] as const)(
    "keeps $path cleanup callbacks from replacing a credential-safe primary error",
    async (path) => {
      const h = fixture(),
        controller = new AbortController();
      Object.defineProperty(controller.signal, "removeEventListener", {
        value: () => {
          throw new Error("detach private " + credential);
        },
      });
      const call = {
        signal: controller.signal,
        beforeSend: async () => {
          throw new Error("hook private " + credential);
        },
      };
      let caught: unknown;
      try {
        if (path === "stream") {
          for await (const chunk of h.session.stream(request(), call)) {
            void chunk;
          }
        } else await h.session[path](request(), call);
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ name: "ProviderRuntimeError", code: "provider_unavailable" });
      expect(JSON.stringify(caught)).not.toContain(credential);
      expect((caught as { cause?: unknown }).cause).toBeUndefined();
      expect(h.fetcher).not.toHaveBeenCalled();
      expect(h.session.getStatus().busy).toBe(false);
      h.fetcher.mockResolvedValue(json());
      await expect(h.session.completeNative(request())).resolves.toMatchObject({
        text: "Hello 世界",
      });
    },
  );
});
