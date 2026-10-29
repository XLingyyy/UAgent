import type { TaskEvent, ProviderRuntimeErrorCode } from "@uagent/shared";
export interface ProviderTraceSummary {
  requestCount: number;
  streamCount: number;
  streamChunkCount: number;
  failureCount: number;
  cancelledCount: number;
  usageCount: number;
  unknownUsageCount: number;
  errorCodes: ProviderRuntimeErrorCode[];
  /** Exact totals exist only when all completed requests reported usage. */
  totalInputTokens?: number;
  totalOutputTokens?: number;
  reportedInputTokens?: number;
  reportedOutputTokens?: number;
}
export function extractProviderTraceSummary(events: TaskEvent[]): ProviderTraceSummary {
  let requestCount = 0,
    streamCount = 0,
    streamChunkCount = 0,
    failureCount = 0,
    cancelledCount = 0,
    usageCount = 0;
  let input = 0,
    output = 0;
  const errors = new Set<ProviderRuntimeErrorCode>(),
    unknown = new Set<string>();
  for (const event of events) {
    const payload = event.payload as
      | {
          code?: ProviderRuntimeErrorCode;
          requestId?: string;
          usageStatus?: string;
          usage?: { inputTokens: number; outputTokens: number };
        }
      | undefined;
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
      case "provider_request_failed":
        failureCount++;
        if (payload?.code) errors.add(payload.code);
        break;
      case "provider_request_cancelled":
        cancelledCount++;
        break;
      case "provider_request_completed":
        if (payload?.usageStatus === "unknown" || !payload?.usage)
          unknown.add(payload?.requestId ?? event.id);
        break;
      case "provider_usage_recorded":
        if (
          payload?.usage &&
          [payload.usage.inputTokens, payload.usage.outputTokens].every(
            (n) => Number.isSafeInteger(n) && n >= 0,
          )
        ) {
          usageCount++;
          input += payload.usage.inputTokens;
          output += payload.usage.outputTokens;
        }
        break;
    }
  }
  const unknownUsageCount = Math.max(unknown.size, requestCount - usageCount);
  return {
    requestCount,
    streamCount,
    streamChunkCount,
    failureCount,
    cancelledCount,
    usageCount,
    unknownUsageCount,
    errorCodes: [...errors],
    ...(usageCount ? { reportedInputTokens: input, reportedOutputTokens: output } : {}),
    ...(usageCount && !unknownUsageCount
      ? { totalInputTokens: input, totalOutputTokens: output }
      : {}),
  };
}
export function formatProviderTraceSummary(summary: ProviderTraceSummary): string {
  const parts = [summary.requestCount + " requests"];
  if (summary.streamCount) parts.push(summary.streamCount + " streams");
  if (summary.streamChunkCount) parts.push(summary.streamChunkCount + " chunks");
  if (summary.failureCount) parts.push(summary.failureCount + " failures");
  if (summary.cancelledCount) parts.push(summary.cancelledCount + " cancelled");
  if (summary.errorCodes.length) parts.push("errors: " + summary.errorCodes.join(", "));
  if (summary.unknownUsageCount)
    parts.push(summary.unknownUsageCount + " requests: token usage unknown");
  if (summary.usageCount)
    parts.push(
      summary.reportedInputTokens +
        " in / " +
        summary.reportedOutputTokens +
        " out tokens" +
        (summary.unknownUsageCount ? " (reported subtotal)" : ""),
    );
  return parts.join(", ");
}
