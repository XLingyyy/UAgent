import { describe, it, expect } from "vitest";
import { extractProviderTraceSummary, formatProviderTraceSummary } from "./provider-trace.js";
import type { TaskEvent } from "@uagent/shared";

const BASE_EVENT = {
  id: "event-1",
  taskId: "task-001",
  title: "test",
  body: "test",
  createdAt: 1,
};

describe("extractProviderTraceSummary", () => {
  it("returns empty summary for no events", () => {
    const summary = extractProviderTraceSummary([]);
    expect(summary.requestCount).toBe(0);
    expect(summary.failureCount).toBe(0);
  });

  it("counts request started events", () => {
    const events: TaskEvent[] = [
      { ...BASE_EVENT, id: "e1", type: "provider_request_started", title: "start" },
      { ...BASE_EVENT, id: "e2", type: "provider_request_started", title: "start" },
    ];
    expect(extractProviderTraceSummary(events).requestCount).toBe(2);
  });

  it("counts stream chunks", () => {
    const events: TaskEvent[] = [
      { ...BASE_EVENT, id: "e1", type: "provider_stream_delta", title: "delta" },
      { ...BASE_EVENT, id: "e2", type: "provider_stream_delta", title: "delta" },
      { ...BASE_EVENT, id: "e3", type: "provider_stream_delta", title: "delta" },
    ];
    expect(extractProviderTraceSummary(events).streamChunkCount).toBe(3);
  });

  it("counts failures with error codes", () => {
    const events: TaskEvent[] = [
      { ...BASE_EVENT, id: "e1", type: "provider_request_failed", title: "fail", payload: { code: "rate_limited" as const } },
      { ...BASE_EVENT, id: "e2", type: "provider_request_failed", title: "fail", payload: { code: "timeout" as const } },
    ];
    const summary = extractProviderTraceSummary(events);
    expect(summary.failureCount).toBe(2);
    expect(summary.errorCodes).toContain("rate_limited");
    expect(summary.errorCodes).toContain("timeout");
  });

  it("counts cancellations", () => {
    const events: TaskEvent[] = [
      { ...BASE_EVENT, id: "e1", type: "provider_request_cancelled", title: "cancel", payload: { reason: "test" } },
    ];
    expect(extractProviderTraceSummary(events).cancelledCount).toBe(1);
  });

  it("accumulates usage tokens", () => {
    const events: TaskEvent[] = [
      { ...BASE_EVENT, id: "e1", type: "provider_usage_recorded", title: "usage", payload: { usage: { inputTokens: 10, outputTokens: 5 } } },
      { ...BASE_EVENT, id: "e2", type: "provider_usage_recorded", title: "usage", payload: { usage: { inputTokens: 20, outputTokens: 15 } } },
    ];
    const summary = extractProviderTraceSummary(events);
    expect(summary.usageCount).toBe(2);
    expect(summary.totalInputTokens).toBe(30);
    expect(summary.totalOutputTokens).toBe(20);
  });
});

describe("formatProviderTraceSummary", () => {
  it("formats empty summary", () => {
    const summary = extractProviderTraceSummary([]);
    expect(formatProviderTraceSummary(summary)).toBe("0 requests");
  });

  it("formats full summary", () => {
    const summary = extractProviderTraceSummary([
      { ...BASE_EVENT, id: "e1", type: "provider_request_started", title: "start" },
      { ...BASE_EVENT, id: "e2", type: "provider_stream_started", title: "stream" },
      { ...BASE_EVENT, id: "e3", type: "provider_stream_delta", title: "delta" },
      { ...BASE_EVENT, id: "e4", type: "provider_request_failed", title: "fail", payload: { code: "timeout" } },
    ]);
    const formatted = formatProviderTraceSummary(summary);
    expect(formatted).toContain("1 requests");
    expect(formatted).toContain("1 streams");
    expect(formatted).toContain("1 chunks");
    expect(formatted).toContain("1 failures");
  });
});
