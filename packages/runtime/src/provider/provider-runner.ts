import type {
  ProviderRuntimeEvent,
  ProviderRuntimeRequest,
  ProviderRuntimeResponse,
  ProviderStreamChunk,
  ProviderUsage,
} from "@uagent/shared";
import type { ProviderAdapter } from "./provider-adapter.js";
import { createProviderRuntimeError, normalizeProviderError } from "./provider-error.js";

export interface ProviderExecutionOptions {
  signal?: AbortSignal;
  timeoutTicks?: number;
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
}

export async function runProviderComplete(
  adapter: ProviderAdapter,
  request: ProviderRuntimeRequest,
  options: ProviderExecutionOptions = {},
): Promise<ProviderCompleteResult> {
  const events: ProviderRuntimeEvent[] = [];
  const publish = (...next: ProviderRuntimeEvent[]) => { events.push(...next); next.forEach(event => options.onEvent?.(event)); };
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
    const response = await adapter.complete(request, { signal: options.signal });
    if (options.signal?.aborted) { publish(cancelledEvent(request)); return { response: emptyCancelledResponse(request), events }; }
    publish(usageEvent(request, response.usage));
    publish({ type: "provider_request_completed", requestId: request.id, providerId: request.providerId, response });
    return { response, events };
  } catch (error) {
    publish(options.signal?.aborted ? cancelledEvent(request) : failedEvent(request, adapter.id, error));
    return { response: emptyCancelledResponse(request), events };
  }
}

export async function runProviderStream(
  adapter: ProviderAdapter,
  request: ProviderRuntimeRequest,
  options: ProviderExecutionOptions = {},
): Promise<ProviderStreamResult> {
  const events: ProviderRuntimeEvent[] = [];
  const publish = (...next: ProviderRuntimeEvent[]) => { events.push(...next); next.forEach(event => options.onEvent?.(event)); };
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
    publish(failedEvent(request, adapter.id, { code: "malformed_response", message: "Provider does not support streaming." }));
    return { text: "", chunks: [], events };
  }

  const chunks: ProviderStreamChunk[] = [];
  let text = "";
  let started = false;
  let chunkCount = 0;
  let measuredUsage: ProviderUsage | undefined;
  let finishReason: "stop" | "length" = "stop";

  try {
    for await (const chunk of adapter.stream(request, { signal: options.signal })) {
      if (options.signal?.aborted) {
        publish(cancelledEvent(request));
        return { text, chunks, events };
      }
      if (isChunkBudgetExhausted(chunkCount, options.timeoutTicks)) {
        publish(timeoutFailedEvent(request, adapter.id));
        return { text, chunks, events };
      }
      if (!started) {
        publish({ type: "provider_stream_started", requestId: request.id, providerId: request.providerId });
        started = true;
      }
      if (chunk.usage) measuredUsage = chunk.usage;
      if (chunk.finishReason) finishReason = chunk.finishReason;
      chunks.push(chunk);
      text += chunk.delta;
      chunkCount += 1;
      publish({ type: "provider_stream_delta", requestId: request.id, providerId: request.providerId, chunk });
    }
    if (!started) {
      publish({ type: "provider_stream_started", requestId: request.id, providerId: request.providerId });
    }
    if (options.signal?.aborted) { publish(cancelledEvent(request)); return { text, chunks, events }; }
    const usage = measuredUsage ?? (adapter.getCapabilities().isMock ? usageFromText(request, text) : undefined);
    if (!usage) throw createProviderRuntimeError(adapter.id, "malformed_response", "Measured provider usage is required.");
    publish({ type: "provider_stream_completed", requestId: request.id, providerId: request.providerId, text });
    publish(usageEvent(request, usage));
    publish({
      type: "provider_request_completed",
      requestId: request.id,
      providerId: request.providerId,
      response: {
        id: `${request.providerId}-stream-response-${request.id}`,
        requestId: request.id,
        providerId: request.providerId,
        modelId: request.modelId,
        text,
        finishReason,
        usage,
        createdAt: 1_000,
      },
    });
    return { text, chunks, usage, events };
  } catch (error) {
    publish(options.signal?.aborted ? cancelledEvent(request) : failedEvent(request, adapter.id, error));
    return { text, chunks, events };
  }
}

function startedEvent(request: ProviderRuntimeRequest): ProviderRuntimeEvent {
  return { type: "provider_request_started", requestId: request.id, providerId: request.providerId, modelId: request.modelId };
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
  return { type: "provider_usage_recorded", requestId: request.id, providerId: request.providerId, usage };
}

function emptyCancelledResponse(request: ProviderRuntimeRequest): ProviderRuntimeResponse {
  return {
    id: `${request.providerId}-empty-${request.id}`,
    requestId: request.id,
    providerId: request.providerId,
    modelId: request.modelId,
    text: "",
    finishReason: "error",
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    createdAt: 1_000,
  };
}

function isTimeout(timeoutTicks: number | undefined): boolean {
  return timeoutTicks !== undefined && timeoutTicks <= 0;
}

function isChunkBudgetExhausted(chunkCount: number, timeoutTicks: number | undefined): boolean {
  return timeoutTicks !== undefined && chunkCount >= timeoutTicks;
}

function timeoutFailedEvent(request: ProviderRuntimeRequest, providerId: string): ProviderRuntimeEvent {
  return {
    type: "provider_request_failed",
    requestId: request.id,
    providerId,
    error: createProviderRuntimeError(providerId, "timeout", "Provider request timed out."),
  };
}

function failedEvent(request: ProviderRuntimeRequest, providerId: string, error: unknown): ProviderRuntimeEvent {
  return {
    type: "provider_request_failed",
    requestId: request.id,
    providerId,
    error: normalizeProviderError(error, providerId),
  };
}

function usageFromText(request: ProviderRuntimeRequest, text: string): ProviderUsage {
  const inputTokens = countTokens(request.messages.map((message) => message.content).join(" "));
  const outputTokens = countTokens(text);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}

function countTokens(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}
