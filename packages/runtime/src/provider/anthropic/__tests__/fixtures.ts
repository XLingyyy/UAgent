import { vi } from "vitest";
import type { ProviderRuntimeRequest } from "@uagent/shared";
import type { AnthropicAssistantBlock } from "../protocol.js";
import {
  createAnthropicSession,
  type AnthropicSessionOptions,
  type AnthropicStreamChunk,
} from "../session.js";
export const credential = "synthetic-local-secret-123456";
export const model = "explicit-claude-fixture";
export const owner = {
  providerId: "anthropic-messages",
  modelId: model,
  projectId: "project_A",
  projectEpoch: 2,
  runId: "run_A",
  conversationId: "conversation_A",
};
export const tool = {
  name: "read_file",
  description: "Read approved content",
  parameters: { type: "object", properties: { path: { type: "string" } } },
};
export const request = (patch: Partial<ProviderRuntimeRequest> = {}): ProviderRuntimeRequest => ({
  id: "request_1",
  providerId: owner.providerId,
  modelId: model,
  maxOutputTokens: 4096,
  messages: [
    { role: "developer", content: "Use approved tools." },
    { role: "user", content: "Read 项目.txt" },
  ],
  tools: [tool],
  ...patch,
});
export const body = (patch: Record<string, unknown> = {}) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model,
  content: [{ type: "text", text: "Hello 世界" }],
  stop_reason: "end_turn",
  stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 7 },
  ...patch,
});
export const json = (patch: Record<string, unknown> = {}) =>
  new Response(JSON.stringify(body(patch)), { headers: { "Content-Type": "application/json" } });
export function fixture(patch: Partial<AnthropicSessionOptions> = {}) {
  const state = {
    current: true,
    context: { projectId: owner.projectId, epoch: owner.projectEpoch, revision: "revision_1" },
  };
  const fetcher = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
  const session = createAnthropicSession({
    wireApi: "anthropic-compatible",
    modelId: model,
    mode: "offline",
    owner: { ...owner },
    isCurrent: () => state.current,
    getProjectContext: () => state.context,
    fetcher,
    ...patch,
  });
  session.setCredential(credential);
  return { session, fetcher, state };
}
export const frame = (data: Record<string, unknown>) =>
  "event: " + data.type + "\ndata: " + JSON.stringify(data) + "\n\n";
export function events(
  content: AnthropicAssistantBlock[] = [{ type: "text", text: "Hello 世界" }],
  patch: {
    reason?: string;
    usage?: Record<string, unknown> | null;
    finalUsage?: Record<string, unknown> | null;
    args?: Map<number, string>;
  } = {},
) {
  const out: Array<Record<string, unknown>> = [
    {
      type: "message_start",
      message: body({
        content: [],
        stop_reason: null,
        usage:
          patch.usage === undefined
            ? {
                input_tokens: 10,
                output_tokens: 1,
                cache_creation_input_tokens: 2,
                cache_read_input_tokens: 3,
              }
            : patch.usage,
      }),
    },
  ];
  content.forEach((block, index) => {
    let start: Record<string, unknown> = block;
    if (block.type === "text") start = { type: "text", text: "" };
    if (block.type === "thinking") start = { type: "thinking", thinking: "", signature: "" };
    if (block.type === "tool_use") start = { ...block, input: {} };
    out.push({ type: "content_block_start", index, content_block: start });
    if (block.type === "text")
      for (const text of [block.text.slice(0, 3), block.text.slice(3)])
        out.push({ type: "content_block_delta", index, delta: { type: "text_delta", text } });
    if (block.type === "thinking") {
      out.push({
        type: "content_block_delta",
        index,
        delta: { type: "thinking_delta", thinking: block.thinking },
      });
      for (const signature of [block.signature])
        out.push({
          type: "content_block_delta",
          index,
          delta: { type: "signature_delta", signature },
        });
    }
    if (block.type === "tool_use") {
      const args = patch.args?.get(index) ?? JSON.stringify(block.input);
      for (const partial_json of [args.slice(0, 4), args.slice(4, 9), args.slice(9)])
        out.push({
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json },
        });
    }
    out.push({ type: "content_block_stop", index });
  });
  out.push({
    type: "message_delta",
    delta: {
      stop_reason:
        patch.reason ?? (content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn"),
      stop_sequence: null,
    },
    usage: patch.finalUsage === undefined ? { output_tokens: 7 } : patch.finalUsage,
  });
  out.push({ type: "message_stop" });
  return out;
}
export function streamResponse(
  data: Array<Record<string, unknown>> = events(),
  byteWidth = 7,
  ending = "\n",
) {
  const wire = data.map(frame).join("").replaceAll("\n", ending),
    wireBytes = new TextEncoder().encode(wire);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < wireBytes.length; i += byteWidth)
          controller.enqueue(wireBytes.slice(i, i + byteWidth));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );
}
export async function collect(session: ReturnType<typeof createAnthropicSession>, req = request()) {
  const chunks: AnthropicStreamChunk[] = [];
  for await (const chunk of session.stream(req)) chunks.push(chunk);
  return chunks;
}
