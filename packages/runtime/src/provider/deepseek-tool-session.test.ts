import { describe, expect, it, vi } from "vitest";
import type { ProviderRuntimeRequest } from "@uagent/shared";
import { createDeepSeekAccountSession, DEEPSEEK_MODEL } from "./deepseek-session.js";
import { createOutboundConsentGate } from "./outbound-consent.js";
const credential = "synthetic-tool-session";
const callId = "call_identifier_that_stays_exact_01234567890123456789";
const usage = { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 };
const wire = (events: unknown[]) =>
  new Response(
    events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
function tools(args = ['{"path":"Source/', 'Main.cpp"}']) {
  return wire([
    {
      model: DEEPSEEK_MODEL,
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: callId,
                type: "function",
                function: { name: "project_read_file", arguments: args[0] },
              },
            ],
          },
        },
      ],
    },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: args[1] } }] } }] },
    { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    { choices: [], usage },
  ]);
}
function request(): ProviderRuntimeRequest {
  return {
    id: "request-1",
    providerId: "deepseek",
    modelId: DEEPSEEK_MODEL,
    messages: [{ role: "user", content: "Read approved text." }],
    tools: [
      {
        name: "project_read_file",
        description: "Read scoped text",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
          required: ["path"],
          additionalProperties: false,
        },
      },
    ],
    metadata: { purpose: "investigation", runId: "run-1", scopeRef: "scope-1", projectId: "p1" },
  };
}
function setup(fetcher: typeof fetch = vi.fn(async () => tools())) {
  const gate = createOutboundConsentGate(),
    session = createDeepSeekAccountSession({
      mode: "offline",
      expiresAt: Date.now() + 60000,
      fetcher,
      outboundGate: gate,
      getProjectContext: () => ({ projectId: "p1", epoch: 1, revision: "c1" }),
    });
  session.setCredential(credential);
  return { gate, session, fetcher: vi.mocked(fetcher) };
}
async function pending(gate: ReturnType<typeof createOutboundConsentGate>) {
  await vi.waitFor(() => expect(gate.getPending()).not.toBeNull());
  return gate.getPending()!;
}
describe("DeepSeek structured tools with single-request approval; synthetic SSE only", () => {
  it("preserves split arguments and long IDs and reviews each actual tool-result request", async () => {
    let count = 0;
    const fetcher = vi.fn(async () =>
      ++count === 1
        ? tools()
        : wire([
            { choices: [{ delta: { content: "Value 7." } }] },
            { choices: [{ delta: {}, finish_reason: "stop" }] },
            { choices: [], usage },
          ]),
    );
    const { gate, session } = setup(fetcher);
    const firstPending = session.adapter.complete(request());
    const review = await pending(gate);
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.parse(review.envelope.body).tools[0].function.name).toBe("project_read_file");
    gate.approve(review.id);
    const first = await firstPending;
    expect(first.finishReason).toBe("tool_calls");
    expect(first.toolCalls).toEqual([
      { id: callId, name: "project_read_file", arguments: '{"path":"Source/Main.cpp"}' },
    ]);
    const next: ProviderRuntimeRequest = {
      ...request(),
      id: "request-2",
      messages: [
        ...request().messages,
        { role: "assistant", content: first.text, toolCalls: first.toolCalls },
        { role: "tool", toolCallId: callId, content: '{"value":7}' },
      ],
    };
    const secondPending = session.adapter.complete(next),
      second = await pending(gate);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const body = JSON.parse(second.envelope.body);
    expect(body.messages.at(-2).tool_calls[0].id).toBe(callId);
    expect(body.messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: callId,
      content: '{"value":7}',
    });
    expect(second.envelope.body).not.toContain(credential);
    gate.approve(second.id);
    expect((await secondPending).text).toBe("Value 7.");
    expect(fetcher).toHaveBeenCalledTimes(2);
    session.clearCredential();
  });
  it("rejects tools in discussion mode before transport", async () => {
    const { session, fetcher } = setup(),
      r = request();
    delete r.metadata;
    await expect(session.adapter.complete(r)).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects orphan tool results before transport", async () => {
    const { session, fetcher } = setup();
    await expect(
      session.adapter.complete({
        ...request(),
        messages: [{ role: "tool", toolCallId: callId, content: "unbound" }],
      }),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("never accepts incomplete JSON as a finished call", async () => {
    const { session, gate } = setup(vi.fn(async () => tools(['{"path":', '"Source/Main.cpp"']))),
      promise = session.adapter.complete(request());
    gate.approve((await pending(gate)).id);
    await expect(promise).rejects.toMatchObject({ code: "malformed_response" });
    expect(session.hasCredential()).toBe(false);
  });
  it("rejects duplicate IDs across stream indices", async () => {
    const { session, gate } = setup(
        vi.fn(async () =>
          wire([
            {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: callId,
                        type: "function",
                        function: { name: "project_read_file", arguments: "{}" },
                      },
                      {
                        index: 1,
                        id: callId,
                        type: "function",
                        function: { name: "project_read_file", arguments: "{}" },
                      },
                    ],
                  },
                },
              ],
            },
            { choices: [{ delta: {}, finish_reason: "tool_calls" }], usage },
          ]),
        ),
      ),
      promise = session.adapter.complete(request());
    gate.approve((await pending(gate)).id);
    await expect(promise).rejects.toMatchObject({ code: "malformed_response" });
  });
  it("cancelled review sends nothing and cannot reuse the old grant", async () => {
    const { session, gate, fetcher } = setup(),
      controller = new AbortController(),
      promise = session.adapter.complete(request(), { signal: controller.signal });
    const review = await pending(gate);
    controller.abort();
    gate.approve(review.id);
    await expect(promise).rejects.toMatchObject({ code: "cancelled" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(gate.getPending()).toBeNull();
  });
  it("blocks split credential echoes without leaking them through deltas", async () => {
    const { session, gate } = setup(
        vi.fn(async () => tools(['{"path":"synthetic-tool-', 'session"}'])),
      ),
      chunks: unknown[] = [];
    const promise = (async () => {
      for await (const chunk of session.adapter.stream!(request())) chunks.push(chunk);
    })();
    gate.approve((await pending(gate)).id);
    await expect(promise).rejects.toMatchObject({ code: "malformed_response" });
    expect(JSON.stringify(chunks)).not.toContain(credential);
  });
  it("maps rate limits without automatic retry", async () => {
    const { session, gate, fetcher } = setup(
        vi.fn(async () => new Response("untrusted", { status: 429 })),
      ),
      promise = session.adapter.complete(request());
    gate.approve((await pending(gate)).id);
    await expect(promise).rejects.toMatchObject({ code: "rate_limited" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
