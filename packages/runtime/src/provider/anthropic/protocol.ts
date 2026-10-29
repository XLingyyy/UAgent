import type {
  ProviderFinishReason,
  ProviderRuntimeRequest,
  ProviderRuntimeMessage,
  ProviderToolCall,
  ProviderUsage,
} from "@uagent/shared";
import { argumentsObject, clone, invalid, object, token } from "./utils.js";

export type AnthropicThinking =
  | { type: "disabled" }
  | { type: "adaptive" }
  | { type: "enabled"; budget_tokens: number };
export type AnthropicAssistantBlock =
  | { type: "text"; text: string; citations?: null | [] }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
export type AnthropicStopReason =
  | "end_turn"
  | "stop_sequence"
  | "max_tokens"
  | "tool_use"
  | "refusal"
  | "model_context_window_exceeded";
export interface AnthropicResult {
  id: string;
  requestId: string;
  model: string;
  content: AnthropicAssistantBlock[];
  text: string;
  toolCalls: ProviderToolCall[];
  stopReason: AnthropicStopReason;
  stopSequence: string | null;
  finishReason: Exclude<ProviderFinishReason, "error">;
  usage?: ProviderUsage;
  usageStatus: "reported" | "unknown";
  /** Native counts retained; cumulative output counts are never added together. */
  nativeUsage?: Record<string, unknown>;
}
export function assistantSignature(message: Pick<ProviderRuntimeMessage, "content" | "toolCalls">) {
  return JSON.stringify([
    message.content,
    message.toolCalls?.map((c) => [c.id, c.name, c.arguments]) ?? [],
  ]);
}
export const prefixSignature = (messages: ProviderRuntimeMessage[]) => JSON.stringify(messages);
export function checkBlock(value: unknown): AnthropicAssistantBlock {
  if (!object(value)) return invalid();
  const keys: Record<string, readonly string[]> = {
    text: ["type", "text", "citations"],
    thinking: ["type", "thinking", "signature"],
    redacted_thinking: ["type", "data"],
    tool_use: ["type", "id", "name", "input"],
  };
  if (
    typeof value.type !== "string" ||
    !keys[value.type] ||
    Object.keys(value).some((k) => !keys[value.type as string]!.includes(k))
  )
    return invalid();
  switch (value.type) {
    case "text":
      if (
        typeof value.text !== "string" ||
        (value.citations != null && (!Array.isArray(value.citations) || value.citations.length > 0))
      )
        return invalid();
      break;
    case "thinking":
      if (
        typeof value.thinking !== "string" ||
        typeof value.signature !== "string" ||
        !value.signature
      )
        return invalid();
      break;
    case "redacted_thinking":
      if (typeof value.data !== "string" || !value.data) return invalid();
      break;
    case "tool_use":
      if (!token(value.id) || !token(value.name) || !object(value.input)) return invalid();
      break;
    default:
      return invalid();
  }
  return clone(value) as AnthropicAssistantBlock;
}
export function readUsage(
  raw: unknown,
): Pick<AnthropicResult, "usage" | "usageStatus" | "nativeUsage"> {
  if (raw == null) return { usageStatus: "unknown" };
  if (!object(raw)) return invalid();
  for (const name of [
    "input_tokens",
    "output_tokens",
    "cache_creation_input_tokens",
    "cache_read_input_tokens",
  ])
    if (raw[name] !== undefined && (!Number.isSafeInteger(raw[name]) || (raw[name] as number) < 0))
      return invalid();
  const nativeUsage = clone(raw);
  if (raw.input_tokens === undefined || raw.output_tokens === undefined)
    return { usageStatus: "unknown", nativeUsage };
  const inputTokens =
    (raw.input_tokens as number) +
    ((raw.cache_creation_input_tokens as number | undefined) ?? 0) +
    ((raw.cache_read_input_tokens as number | undefined) ?? 0);
  const outputTokens = raw.output_tokens as number,
    totalTokens = inputTokens + outputTokens;
  if (!Number.isSafeInteger(totalTokens)) return invalid();
  return {
    usageStatus: "reported",
    usage: { inputTokens, outputTokens, totalTokens },
    nativeUsage,
  };
}
export function parseMessage(
  raw: unknown,
  request: ProviderRuntimeRequest,
  rawArguments?: ReadonlyMap<number, string>,
): AnthropicResult {
  if (
    !object(raw) ||
    raw.type !== "message" ||
    raw.role !== "assistant" ||
    !token(raw.id) ||
    raw.model !== request.modelId ||
    !Array.isArray(raw.content)
  )
    return invalid();
  const content = raw.content.map(checkBlock),
    ids = new Set<string>(),
    toolCalls: ProviderToolCall[] = [];
  let text = "";
  content.forEach((block, index) => {
    if (block.type === "text") text += block.text;
    if (block.type !== "tool_use") return;
    if (
      ids.has(block.id) ||
      request.toolChoice === "none" ||
      request.messages.some((m) => m.toolCalls?.some((c) => c.id === block.id)) ||
      !request.tools?.some((t) => t.name === block.name)
    )
      return invalid();
    ids.add(block.id);
    const args = rawArguments?.get(index) ?? JSON.stringify(block.input);
    if (JSON.stringify(argumentsObject(args)) !== JSON.stringify(block.input)) return invalid();
    toolCalls.push({ id: block.id, name: block.name, arguments: args });
  });
  const reason = raw.stop_reason;
  if (
    ![
      "end_turn",
      "stop_sequence",
      "max_tokens",
      "tool_use",
      "refusal",
      "model_context_window_exceeded",
    ].includes(reason as string)
  )
    return invalid();
  // Never execute a tool contained in an interrupted/truncated response.
  if ((reason === "tool_use") !== toolCalls.length > 0) return invalid();
  if (raw.stop_sequence != null && typeof raw.stop_sequence !== "string") return invalid();
  if (reason === "stop_sequence" && typeof raw.stop_sequence !== "string") return invalid();
  return {
    id: raw.id,
    requestId: request.id,
    model: request.modelId,
    content,
    text,
    toolCalls,
    stopReason: reason as AnthropicStopReason,
    stopSequence: (raw.stop_sequence as string | null) ?? null,
    finishReason:
      reason === "tool_use"
        ? "tool_calls"
        : reason === "max_tokens" || reason === "model_context_window_exceeded"
          ? "length"
          : "stop",
    ...readUsage(raw.usage),
  };
}
export function messagesBody(
  request: ProviderRuntimeRequest,
  stream: boolean,
  thinking: AnthropicThinking | undefined,
  replay: (assistant: ProviderRuntimeMessage, index: number) => AnthropicAssistantBlock[],
) {
  if (
    !Array.isArray(request.messages) ||
    !request.messages.length ||
    !Number.isSafeInteger(request.maxOutputTokens) ||
    request.maxOutputTokens! < 1 ||
    request.maxOutputTokens! > 2_147_483_647
  )
    return invalid();
  if (
    request.temperature !== undefined &&
    (!Number.isFinite(request.temperature) ||
      request.temperature < 0 ||
      request.temperature > 1 ||
      (thinking && thinking.type !== "disabled"))
  )
    return invalid();
  if (
    thinking?.type === "enabled" &&
    (!Number.isSafeInteger(thinking.budget_tokens) ||
      thinking.budget_tokens < 1024 ||
      thinking.budget_tokens >= request.maxOutputTokens!)
  )
    return invalid();
  if (thinking && !["enabled", "disabled", "adaptive"].includes(thinking.type)) return invalid();
  const toolNames = new Set<string>();
  const tools = request.tools?.map((tool) => {
    if (
      !token(tool.name) ||
      toolNames.has(tool.name) ||
      typeof tool.description !== "string" ||
      !object(tool.parameters) ||
      tool.parameters.type !== "object"
    )
      return invalid();
    toolNames.add(tool.name);
    return { name: tool.name, description: tool.description, input_schema: clone(tool.parameters) };
  });
  if (request.toolChoice !== undefined && !["auto", "none"].includes(request.toolChoice))
    return invalid();
  const system: Array<{ type: "text"; text: string }> = [];
  const messages: Array<{
    role: "user" | "assistant";
    content: Array<Record<string, unknown> | AnthropicAssistantBlock>;
  }> = [];
  const pending = new Map<string, string>(),
    historicalIds = new Set<string>();
  const appendUser = (block: Record<string, unknown>) => {
    const last = messages.at(-1);
    if (last?.role === "user") last.content.push(block);
    else messages.push({ role: "user", content: [block] });
  };
  request.messages.forEach((message, index) => {
    if (!object(message) || typeof message.content !== "string") return invalid();
    if (message.role === "system" || message.role === "developer") {
      if (messages.length || message.toolCalls?.length || message.toolCallId) return invalid();
      system.push({ type: "text", text: message.content });
      return;
    }
    if (message.role === "tool") {
      if (
        !message.toolCallId ||
        !pending.has(message.toolCallId) ||
        message.toolCalls?.length ||
        (message.name !== undefined && pending.get(message.toolCallId) !== message.name)
      )
        return invalid();
      pending.delete(message.toolCallId);
      appendUser({
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: [{ type: "text", text: message.content }],
      });
      return;
    }
    if (pending.size || message.toolCallId) return invalid();
    if (message.role === "user") {
      if (message.toolCalls?.length) return invalid();
      appendUser({ type: "text", text: message.content });
      return;
    }
    if (message.role !== "assistant" || !messages.length || messages.at(-1)?.role !== "user")
      return invalid();
    // Every previous assistant must have exact native content retained by this owner/session.
    const content = replay(message, index).map(checkBlock);
    for (const block of content)
      if (block.type === "tool_use") {
        if (historicalIds.has(block.id)) return invalid();
        historicalIds.add(block.id);
        pending.set(block.id, block.name);
      }
    messages.push({ role: "assistant", content });
  });
  if (pending.size || !messages.length || messages.at(-1)?.role !== "user") return invalid();
  return {
    model: request.modelId,
    max_tokens: request.maxOutputTokens,
    stream,
    messages,
    ...(system.length ? { system } : {}),
    ...(tools?.length ? { tools, tool_choice: { type: request.toolChoice ?? "auto" } } : {}),
    ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    ...(thinking ? { thinking: clone(thinking) } : {}),
  };
}
