import type {
  ProviderFinishReason,
  ProviderRuntimeMessage,
  ProviderRuntimeRequest,
  ProviderToolCall,
  ProviderUsage,
} from "@uagent/shared";
import { createProviderRuntimeError } from "../provider-error.js";

export type ResponsesItem = Record<string, unknown> & { type: string };
export interface ResponsesResult {
  id: string;
  text: string;
  modelId: string;
  finishReason: Exclude<ProviderFinishReason, "error">;
  toolCalls: ProviderToolCall[];
  /** Missing/null upstream usage stays unknown. It is never estimated. */
  usage?: ProviderUsage;
  usageStatus: "reported" | "unknown";
  createdAt: number;
  /** Includes reasoning/encrypted items needed to continue a native tool turn. */
  output: ResponsesItem[];
}
export type NativeReplay = (
  message: ProviderRuntimeMessage,
  index: number,
) => ResponsesItem[] | undefined;

export function responsesError(providerId: string, message: string) {
  return createProviderRuntimeError(providerId, "malformed_response", message);
}
export function record(value: unknown, providerId: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw responsesError(providerId, "Invalid Responses protocol object.");
  return value as Record<string, unknown>;
}
export function identifier(value: unknown, providerId: string, limit = 128): string {
  if (typeof value !== "string" || !new RegExp("^[A-Za-z0-9_-]{1," + limit + "}$").test(value))
    throw responsesError(providerId, "Invalid Responses protocol identity.");
  return value;
}
export function argumentsObject(value: unknown, providerId: string): string {
  if (typeof value !== "string") throw responsesError(providerId, "Invalid function arguments.");
  try {
    record(JSON.parse(value), providerId);
  } catch {
    throw responsesError(providerId, "Function arguments must be complete JSON objects.");
  }
  return value;
}

/** Runtime IDs represent call_id, never the unrelated native output item id. */
export function responsesInput(
  request: ProviderRuntimeRequest,
  replay?: NativeReplay,
): ResponsesItem[] {
  const p = request.providerId;
  const pending = new Set<string>(),
    seen = new Set<string>();
  const input: ResponsesItem[] = [];
  if (!request.messages.length || request.messages.length > 256)
    throw responsesError(p, "Invalid conversation size.");
  request.messages.forEach((message, index) => {
    if (
      typeof message.content !== "string" ||
      !["system", "developer", "user", "assistant", "tool"].includes(message.role)
    )
      throw responsesError(p, "Invalid conversation message.");
    if (message.role === "tool") {
      if (
        !message.toolCallId ||
        !pending.delete(message.toolCallId) ||
        message.toolCalls !== undefined
      )
        throw responsesError(p, "Orphan or duplicate function result.");
      input.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: message.content,
      });
      return;
    }
    if (pending.size || message.toolCallId !== undefined)
      throw responsesError(p, "Function results must precede the next message.");
    const calls = message.toolCalls;
    if (calls !== undefined) {
      if (message.role !== "assistant" || !calls.length || calls.length > 8)
        throw responsesError(p, "Invalid historical function calls.");
      for (const call of calls) {
        identifier(call.id, p);
        identifier(call.name, p, 64);
        argumentsObject(call.arguments, p);
        if (seen.has(call.id)) throw responsesError(p, "Duplicate function call identity.");
        seen.add(call.id);
        pending.add(call.id);
      }
    }
    const native = message.role === "assistant" ? replay?.(message, index) : undefined;
    if (native) {
      input.push(...native);
      return;
    }
    if (message.content || !calls)
      input.push({
        type: "message",
        role: message.role,
        content:
          message.role === "assistant"
            ? message.content
            : [{ type: "input_text", text: message.content }],
      });
    for (const call of calls ?? [])
      input.push({
        type: "function_call",
        call_id: call.id,
        name: call.name,
        arguments: call.arguments,
      });
  });
  if (pending.size) throw responsesError(p, "Missing function results.");
  return input;
}

export function responsesBody(
  request: ProviderRuntimeRequest,
  stream: boolean,
  replay?: NativeReplay,
  reasoningEffort?: string,
) {
  const fail = (message: string) => responsesError(request.providerId, message);
  // A cached session supplies a default only; each approved request owns its selection.
  const effort = request.reasoningEffort === undefined ? reasoningEffort : request.reasoningEffort;
  if (effort !== undefined && !["none", "minimal", "low", "medium", "high", "xhigh"].includes(effort))
    throw fail("Unsupported reasoning effort.");
  if (
    request.toolChoice !== undefined &&
    request.toolChoice !== "auto" &&
    request.toolChoice !== "none"
  )
    throw fail("Unsupported tool choice.");
  if (
    request.maxOutputTokens !== undefined &&
    (!Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens < 1)
  )
    throw fail("Invalid output token limit.");
  if (
    request.temperature !== undefined &&
    (!Number.isFinite(request.temperature) || request.temperature < 0 || request.temperature > 2)
  )
    throw fail("Invalid temperature.");
  const names = new Set<string>();
  if ((request.tools?.length ?? 0) > 8) throw fail("Too many function definitions.");
  const tools = request.tools?.map((tool) => {
    identifier(tool.name, request.providerId, 64);
    if (
      names.has(tool.name) ||
      typeof tool.description !== "string" ||
      tool.description.length > 8192 ||
      record(tool.parameters, request.providerId).type !== "object"
    )
      throw fail("Invalid function definition.");
    names.add(tool.name);
    return {
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      strict: false,
    };
  });
  return {
    model: request.modelId,
    input: responsesInput(request, replay),
    stream,
    store: false,
    include: ["reasoning.encrypted_content"],
    ...(request.maxOutputTokens === undefined
      ? {}
      : { max_output_tokens: request.maxOutputTokens }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(tools?.length ? { tools, tool_choice: request.toolChoice ?? "auto" } : {}),
    ...(effort === undefined ? {} : { reasoning: { effort } }),
  };
}

export function parseResponsesResult(
  value: unknown,
  request: ProviderRuntimeRequest,
): ResponsesResult {
  const p = request.providerId,
    body = record(value, p);
  const fail = (message: string) => responsesError(p, message);
  const id = identifier(body.id, p);
  if (body.model !== request.modelId)
    throw fail("Responses model differs from the explicitly selected model.");
  if (body.status === "cancelled")
    throw createProviderRuntimeError(p, "cancelled", "Responses request was cancelled.");
  if (body.error != null || body.status === "failed")
    throw createProviderRuntimeError(
      p,
      "provider_unavailable",
      "Responses generation failed. No automatic retry was sent.",
    );
  let finishReason: ResponsesResult["finishReason"];
  if (body.status === "completed") finishReason = "stop";
  else if (
    body.status === "incomplete" &&
    record(body.incomplete_details, p).reason === "max_output_tokens"
  )
    finishReason = "length";
  else throw fail("Responses did not finish successfully.");
  if (!Array.isArray(body.output) || body.output.length > 256)
    throw fail("Invalid Responses output items.");
  const output: ResponsesItem[] = [],
    calls: ProviderToolCall[] = [],
    ids = new Set<string>(),
    callIds = new Set<string>();
  let text = "",
    argumentBytes = 0;
  for (const value of body.output) {
    const item = record(value, p);
    const itemId = identifier(item.id, p);
    if (ids.has(itemId)) throw fail("Duplicate Responses output item.");
    ids.add(itemId);
    if (item.type === "function_call") {
      if (finishReason === "length" || (item.status !== undefined && item.status !== "completed"))
        throw fail("Incomplete functions must never execute.");
      const call = {
        id: identifier(item.call_id, p),
        name: identifier(item.name, p, 64),
        arguments: argumentsObject(item.arguments, p),
      };
      if (
        callIds.has(call.id) ||
        request.toolChoice === "none" ||
        !request.tools?.some((tool) => tool.name === call.name) ||
        calls.length >= 8
      )
        throw fail("Unadvertised or duplicate Responses function call.");
      argumentBytes += new TextEncoder().encode(call.arguments).length;
      if (argumentBytes > 16_384) throw fail("Responses function arguments exceed the byte limit.");
      callIds.add(call.id);
      calls.push(call);
    } else if (item.type === "message") {
      if (item.role !== "assistant" || !Array.isArray(item.content))
        throw fail("Invalid Responses message output.");
      for (const value of item.content) {
        const part = record(value, p);
        const valueText =
          part.type === "output_text"
            ? part.text
            : part.type === "refusal"
              ? part.refusal
              : undefined;
        if (typeof valueText !== "string") throw fail("Unsupported Responses message content.");
        text += valueText;
      }
    } else if (item.type !== "reasoning")
      throw fail("Unsupported Responses output item; no native tool was enabled.");
    output.push(item as ResponsesItem);
  }
  const usageValue = body.usage;
  let usage: ProviderUsage | undefined;
  if (usageValue != null) {
    const raw = record(usageValue, p);
    const values = [raw.input_tokens, raw.output_tokens, raw.total_tokens];
    if (
      !values.every(
        (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
      ) ||
      (raw.input_tokens as number) + (raw.output_tokens as number) !== raw.total_tokens
    )
      throw fail("Invalid measured Responses usage.");
    usage = {
      inputTokens: raw.input_tokens as number,
      outputTokens: raw.output_tokens as number,
      totalTokens: raw.total_tokens as number,
    };
  }
  if (
    typeof body.created_at !== "number" ||
    !Number.isFinite(body.created_at) ||
    body.created_at < 0
  )
    throw fail("Invalid Responses creation time.");
  if (calls.length) finishReason = "tool_calls";
  return {
    id,
    text,
    modelId: request.modelId,
    finishReason,
    toolCalls: calls,
    usage,
    usageStatus: usage ? "reported" : "unknown",
    createdAt: body.created_at * 1000,
    output,
  };
}

/** Rehydrated native output must describe exactly the assistant turn it replaces. */
export function validateNativeReplay(
  output: ResponsesItem[],
  message: ProviderRuntimeMessage,
  request: ProviderRuntimeRequest,
): ResponsesItem[] {
  const expected = message.toolCalls ?? [];
  const result = parseResponsesResult(
    {
      id: "replay_validation",
      model: request.modelId,
      status: "completed",
      created_at: 0,
      usage: null,
      output,
    },
    {
      ...request,
      toolChoice: "auto",
      tools: expected.map((call) => ({
        name: call.name,
        description: "",
        parameters: { type: "object" },
      })),
    },
  );
  const calls = (values: ProviderToolCall[]) =>
    JSON.stringify(values.map((call) => [call.id, call.name, call.arguments]));
  if (result.text !== message.content || calls(result.toolCalls) !== calls(expected))
    throw responsesError(
      request.providerId,
      "Native continuation does not match its recorded assistant turn.",
    );
  return result.output;
}
