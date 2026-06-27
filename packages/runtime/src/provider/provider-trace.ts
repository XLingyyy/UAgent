import type { TaskEvent, ProviderRuntimeErrorCode } from "@uagent/shared";

export interface ProviderTraceSummary {
  requestCount: number;
  streamCount: number;
  streamChunkCount: number;
  failureCount: number;
  cancelledCount: number;
  usageCount: number;
  errorCodes: ProviderRuntimeErrorCode[];
  totalInputTokens: number;
  totalOutputTokens: number;
}

export function extractProviderTraceSummary(events: TaskEvent[]): ProviderTraceSummary {
  let requestCount = 0;
  let streamCount = 0;
  let streamChunkCount = 0;
  let failureCount = 0;
  let cancelledCount = 0;
  let usageCount = 0;
  const errorCodes = new Set<ProviderRuntimeErrorCode>();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const event of events) {
    switch (event.type) {
      case "provider_request_started":
        requestCount++;
        break;
      case "provider_stream_started":
        streamCount++;
        break;
      case "provider_stream_delta":
        streamChunkCount++;
        break;
      case "provider_request_failed": {
        failureCount++;
        const payload = event.payload as { code?: ProviderRuntimeErrorCode } | undefined;
        if (payload?.code) errorCodes.add(payload.code);
        break;
      }
      case "provider_request_cancelled":
        cancelledCount++;
        break;
      case "provider_usage_recorded": {
        usageCount++;
        const payload = event.payload as { usage?: { inputTokens: number; outputTokens: number } } | undefined;
        if (payload?.usage) {
          totalInputTokens += payload.usage.inputTokens;
          totalOutputTokens += payload.usage.outputTokens;
        }
        break;
      }
    }
  }

  return {
    requestCount,
    streamCount,
    streamChunkCount,
    failureCount,
    cancelledCount,
    usageCount,
    errorCodes: [...errorCodes],
    totalInputTokens,
    totalOutputTokens,
  };
}

export function formatProviderTraceSummary(summary: ProviderTraceSummary): string {
  const parts: string[] = [];
  parts.push(`${summary.requestCount} requests`);
  if (summary.streamCount > 0) parts.push(`${summary.streamCount} streams`);
  if (summary.streamChunkCount > 0) parts.push(`${summary.streamChunkCount} chunks`);
  if (summary.failureCount > 0) parts.push(`${summary.failureCount} failures`);
  if (summary.cancelledCount > 0) parts.push(`${summary.cancelledCount} cancelled`);
  if (summary.errorCodes.length > 0) parts.push(`errors: ${summary.errorCodes.join(", ")}`);
  if (summary.usageCount > 0) {
    parts.push(`${summary.totalInputTokens} in / ${summary.totalOutputTokens} out tokens`);
  }
  return parts.join(", ");
}
