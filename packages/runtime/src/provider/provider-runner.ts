import { ToolCallAccumulator } from "./tool-call-stream.js";
import type {
  ProviderRuntimeEvent,
  ProviderRuntimeRequest,
  ProviderRuntimeResponse,
  ProviderStreamChunk,
  ProviderUsage,
  ProviderUsageStatus,
  ProviderToolCall,
  ProviderFinishReason,
  ProviderNativeContinuation,
} from "@uagent/shared";
import type { ProviderAdapter } from "./provider-adapter.js";
import { createProviderRuntimeError, normalizeProviderError } from "./provider-error.js";

export interface ProviderExecutionOptions {
  signal?: AbortSignal;
  timeoutTicks?: number;
  beforeSend?: () => Promise<void>;
  onEvent?: (event: ProviderRuntimeEvent) => void;
}
export interface ProviderCompleteResult {
  response: ProviderRuntimeResponse;
  events: ProviderRuntimeEvent[];
}
export interface ProviderStreamResult {
  text: string;
  chunks: ProviderStreamChunk[];
  events: ProviderRuntimeEvent[];
  usage?: ProviderUsage;
  usageStatus?: ProviderUsageStatus;
  response?: ProviderRuntimeResponse;
}
function checkedUsage(
  providerId: string,
  usage: ProviderUsage | undefined,
  status?: ProviderUsageStatus,
) {
  if (status !== undefined && !new Set<string>(["reported", "unknown"]).has(status))
    throw createProviderRuntimeError(
      providerId,
      "malformed_response",
      "Unknown provider usage status.",
    );
  if ((status === "reported" && !usage) || (status === "unknown" && usage))
    throw createProviderRuntimeError(
      providerId,
      "malformed_response",
      "Provider usage status contradicts its measured usage.",
    );
  if (
    usage &&
    (![usage.inputTokens, usage.outputTokens, usage.totalTokens].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) ||
      usage.inputTokens + usage.outputTokens !== usage.totalTokens)
  )
    throw createProviderRuntimeError(
      providerId,
      "malformed_response",
      "Invalid reported provider usage.",
    );
  return { usage, usageStatus: usage ? ("reported" as const) : ("unknown" as const) };
}
export async function runProviderComplete(
  adapter: ProviderAdapter,
  request: ProviderRuntimeRequest,
  options: ProviderExecutionOptions = {},
): Promise<ProviderCompleteResult> {
  const events: ProviderRuntimeEvent[] = [];
  const publish = (event: ProviderRuntimeEvent) => {
    events.push(event);
    options.onEvent?.(event);
  };
  publish(startedEvent(request));
  if (isTimeout(options.timeoutTicks)) {
    publish(timeoutFailedEvent(request, adapter.id));
    return { response: emptyCancelledResponse(request), events };
  }
  if (options.signal?.aborted) {
    publish(cancelledEvent(request));
    return { response: emptyCancelledResponse(request), events };
  }
  try {
    const raw = await adapter.complete(request, {
      signal: options.signal,
      beforeSend: options.beforeSend,
    });
    if (options.signal?.aborted) {
      publish(cancelledEvent(request));
      return { response: emptyCancelledResponse(request), events };
    }
    const response = { ...raw, ...checkedUsage(adapter.id, raw.usage, raw.usageStatus) };
    validateToolResponse(request, response.toolCalls ?? [], response.finishReason);
    for (const call of response.toolCalls ?? [])
      publish({
        type: "provider_tool_call_completed",
        requestId: request.id,
        providerId: request.providerId,
        call,
      });
    if (response.usage) publish(usageEvent(request, response.usage));
    publish({
      type: "provider_request_completed",
      requestId: request.id,
      providerId: request.providerId,
      response,
    });
    return { response, events };
  } catch (error) {
    publish(
      options.signal?.aborted ? cancelledEvent(request) : failedEvent(request, adapter.id, error),
    );
    return { response: emptyCancelledResponse(request), events };
  }
}
export async function runProviderStream(
  adapter: ProviderAdapter,
  request: ProviderRuntimeRequest,
  options: ProviderExecutionOptions = {},
): Promise<ProviderStreamResult> {
  const events: ProviderRuntimeEvent[] = [];
  const publish = (event: ProviderRuntimeEvent) => {
    events.push(event);
    options.onEvent?.(event);
  };
  publish(startedEvent(request));
  if (isTimeout(options.timeoutTicks)) {
    publish(timeoutFailedEvent(request, adapter.id));
    return { text: "", chunks: [], events };
  }
  if (options.signal?.aborted) {
    publish(cancelledEvent(request));
    return { text: "", chunks: [], events };
  }
  if (!adapter.stream) {
    publish(
      failedEvent(request, adapter.id, {
        code: "malformed_response",
        message: "Provider does not support streaming.",
      }),
    );
    return { text: "", chunks: [], events };
  }
  const chunks: ProviderStreamChunk[] = [];
  let text = "",
    started = false,
    done = false,
    chunkCount = 0;
  let measuredUsage: ProviderUsage | undefined, usageStatus: ProviderUsageStatus | undefined;
  let finishReason: ProviderFinishReason = "stop",
    nativeContinuation: ProviderNativeContinuation | undefined;
  const toolCalls = new ToolCallAccumulator();
  try {
    for await (const chunk of adapter.stream(request, {
      signal: options.signal,
      beforeSend: options.beforeSend,
    })) {
      if (options.signal?.aborted) {
        publish(cancelledEvent(request));
        return { text, chunks, events };
      }
      if (isChunkBudgetExhausted(chunkCount, options.timeoutTicks)) {
        publish(timeoutFailedEvent(request, adapter.id));
        return { text, chunks, events };
      }
      if (done)
        throw createProviderRuntimeError(
          adapter.id,
          "malformed_response",
          "Provider emitted data after its terminal chunk.",
        );
      if (!started) {
        publish({
          type: "provider_stream_started",
          requestId: request.id,
          providerId: request.providerId,
        });
        started = true;
      }
      if (chunk.toolCallDelta) {
        const delta = chunk.toolCallDelta,
          added = toolCalls.push(delta);
        if (added.started)
          publish({
            type: "provider_tool_call_started",
            requestId: request.id,
            providerId: request.providerId,
            index: delta.index,
            callId: added.call.id,
            name: added.call.name,
          });
        if (delta.argumentsDelta)
          publish({
            type: "provider_tool_call_arguments_delta",
            requestId: request.id,
            providerId: request.providerId,
            index: delta.index,
            callId: added.call.id,
            delta: delta.argumentsDelta,
          });
      }
      if (chunk.usage) measuredUsage = chunk.usage;
      if (chunk.usageStatus) usageStatus = chunk.usageStatus;
      if (chunk.finishReason) finishReason = chunk.finishReason;
      if (chunk.nativeContinuation) {
        if (!chunk.done)
          throw createProviderRuntimeError(
            adapter.id,
            "malformed_response",
            "Native continuation requires a terminal result.",
          );
        nativeContinuation = chunk.nativeContinuation;
      }
      done = chunk.done;
      chunks.push(chunk);
      text += chunk.delta;
      chunkCount++;
      publish({
        type: "provider_stream_delta",
        requestId: request.id,
        providerId: request.providerId,
        chunk,
      });
    }
    if (options.signal?.aborted) {
      publish(cancelledEvent(request));
      return { text, chunks, events };
    }
    if (!done)
      throw createProviderRuntimeError(
        adapter.id,
        "malformed_response",
        "Provider stream ended without a terminal result.",
      );
    const measured = checkedUsage(adapter.id, measuredUsage, usageStatus);
    const completedCalls = toolCalls.finish(finishReason);
    validateToolResponse(request, completedCalls, finishReason);
    for (const call of completedCalls)
      publish({
        type: "provider_tool_call_completed",
        requestId: request.id,
        providerId: request.providerId,
        call,
      });
    publish({
      type: "provider_stream_completed",
      requestId: request.id,
      providerId: request.providerId,
      text,
    });
    if (measured.usage) publish(usageEvent(request, measured.usage));
    const response: ProviderRuntimeResponse = {
      id: nativeContinuation?.responseId ?? request.providerId + "-stream-response-" + request.id,
      requestId: request.id,
      providerId: request.providerId,
      modelId: request.modelId,
      text,
      finishReason,
      ...measured,
      createdAt: nativeContinuation?.createdAt ?? Date.now(),
      ...(nativeContinuation ? { nativeContinuation } : {}),
      ...(completedCalls.length ? { toolCalls: completedCalls } : {}),
    };
    publish({
      type: "provider_request_completed",
      requestId: request.id,
      providerId: request.providerId,
      response,
    });
    return { text, chunks, ...measured, events, response };
  } catch (error) {
    publish(
      options.signal?.aborted ? cancelledEvent(request) : failedEvent(request, adapter.id, error),
    );
    return { text, chunks, events };
  }
}
function validateToolResponse(
  request: ProviderRuntimeRequest,
  calls: ProviderToolCall[],
  reason: ProviderFinishReason,
) {
  if ((reason === "tool_calls") !== calls.length > 0)
    throw createProviderRuntimeError(
      request.providerId,
      "malformed_response",
      "Tool completion reason does not match calls.",
    );
  const allowed = new Set(request.tools?.map((tool) => tool.name) ?? []),
    ids = new Set<string>();
  for (const call of calls) {
    if (!allowed.has(call.name) || ids.has(call.id))
      throw createProviderRuntimeError(
        request.providerId,
        "malformed_response",
        "Unadvertised or duplicate tool call.",
      );
    ids.add(call.id);
  }
}
function startedEvent(request: ProviderRuntimeRequest): ProviderRuntimeEvent {
  return {
    type: "provider_request_started",
    requestId: request.id,
    providerId: request.providerId,
    modelId: request.modelId,
  };
}
function cancelledEvent(request: ProviderRuntimeRequest): ProviderRuntimeEvent {
  return {
    type: "provider_request_cancelled",
    requestId: request.id,
    providerId: request.providerId,
    reason: "Provider request cancellation requested.",
  };
}
function usageEvent(request: ProviderRuntimeRequest, usage: ProviderUsage): ProviderRuntimeEvent {
  return {
    type: "provider_usage_recorded",
    requestId: request.id,
    providerId: request.providerId,
    usage,
  };
}
function emptyCancelledResponse(request: ProviderRuntimeRequest): ProviderRuntimeResponse {
  return {
    id: request.providerId + "-empty-" + request.id,
    requestId: request.id,
    providerId: request.providerId,
    modelId: request.modelId,
    text: "",
    finishReason: "error",
    usageStatus: "unknown",
    createdAt: Date.now(),
  };
}
const isTimeout = (ticks?: number) => ticks !== undefined && ticks <= 0;
const isChunkBudgetExhausted = (count: number, ticks?: number) =>
  ticks !== undefined && count >= ticks;
function timeoutFailedEvent(
  request: ProviderRuntimeRequest,
  providerId: string,
): ProviderRuntimeEvent {
  return {
    type: "provider_request_failed",
    requestId: request.id,
    providerId: request.providerId,
    error: createProviderRuntimeError(providerId, "timeout", "Provider request timed out."),
  };
}
function failedEvent(
  request: ProviderRuntimeRequest,
  providerId: string,
  error: unknown,
): ProviderRuntimeEvent {
  return {
    type: "provider_request_failed",
    requestId: request.id,
    providerId: request.providerId,
    error: normalizeProviderError(error, providerId),
  };
}
