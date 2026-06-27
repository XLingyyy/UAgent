import type {
  ProviderRuntimeEvent,
  TaskEvent,
  TaskEventLevel,
  TaskEventType,
} from "@uagent/shared";
import { createEventId } from "@uagent/shared";
import { redactErrorMessage } from "../secrets/redaction.js";

export interface ProviderEventMappingResult {
  taskEvents: TaskEvent[];
  diagnostics: TaskEvent[];
  evidence: TaskEvent[];
}

export function mapProviderRuntimeEvent(
  event: ProviderRuntimeEvent,
  taskId: string,
  eventSequence: number,
): ProviderEventMappingResult {
  const taskEvents: TaskEvent[] = [];
  const diagnostics: TaskEvent[] = [];
  const evidence: TaskEvent[] = [];

  const base = createEventId(taskId, eventSequence);

  switch (event.type) {
    case "provider_request_started": {
      const taskEvent = createTaskEvent(base, taskId, eventSequence, "provider_request_started", "Provider request started", `Provider ${event.providerId} request ${event.requestId} started.`, "info", { providerId: event.providerId, modelId: event.modelId });
      taskEvents.push(taskEvent);
      break;
    }

    case "provider_stream_started": {
      const taskEvent = createTaskEvent(base, taskId, eventSequence, "provider_stream_started", "Provider stream started", `Provider ${event.providerId} stream started.`, "info", { providerId: event.providerId, requestId: event.requestId });
      taskEvents.push(taskEvent);
      break;
    }

    case "provider_stream_delta": {
      const taskEvent = createTaskEvent(base, taskId, eventSequence, "provider_stream_delta", "Provider stream delta", event.chunk.delta, "info", { chunk: event.chunk });
      taskEvents.push(taskEvent);
      evidence.push(taskEvent);
      break;
    }

    case "provider_stream_completed": {
      const taskEvent = createTaskEvent(base, taskId, eventSequence, "provider_stream_completed", "Provider stream completed", `Provider ${event.providerId} stream completed.`, "success", { providerId: event.providerId, requestId: event.requestId });
      taskEvents.push(taskEvent);
      break;
    }

    case "provider_request_completed": {
      const taskEvent = createTaskEvent(base, taskId, eventSequence, "provider_request_completed", "Provider request completed", `Provider ${event.providerId} request ${event.requestId} completed.`, "success", { providerId: event.providerId, usage: event.response.usage });
      taskEvents.push(taskEvent);
      break;
    }

    case "provider_request_failed": {
      const message = redactErrorMessage(event.error.message);
      const taskEvent = createTaskEvent(base, taskId, eventSequence, "provider_request_failed", "Provider request failed", message, "error", { providerId: event.providerId, code: event.error.code });
      taskEvents.push(taskEvent);
      diagnostics.push(taskEvent);
      break;
    }

    case "provider_request_cancelled": {
      const taskEvent = createTaskEvent(base, taskId, eventSequence, "provider_request_cancelled", "Provider request cancelled", event.reason, "warning", { providerId: event.providerId, requestId: event.requestId });
      taskEvents.push(taskEvent);
      diagnostics.push(taskEvent);
      break;
    }

    case "provider_usage_recorded": {
      const usageText = `${event.usage.inputTokens} in / ${event.usage.outputTokens} out / ${event.usage.totalTokens} total`;
      const taskEvent = createTaskEvent(base, taskId, eventSequence, "provider_usage_recorded", "Provider usage recorded", usageText, "info", { usage: event.usage });
      taskEvents.push(taskEvent);
      evidence.push(taskEvent);
      break;
    }
  }

  return { taskEvents, diagnostics, evidence };
}

function createTaskEvent(
  id: string,
  taskId: string,
  sequence: number,
  type: TaskEventType,
  title: string,
  body: string,
  level: TaskEventLevel,
  payload?: unknown,
): TaskEvent {
  return {
    id,
    taskId,
    type,
    title,
    body,
    level,
    createdAt: sequence,
    payload,
  };
}
