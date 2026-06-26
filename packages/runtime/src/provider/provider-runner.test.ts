import { describe, expect, it } from "vitest";
import type { ProviderRuntimeRequest } from "@uagent/shared";
import { MockStreamingProvider, MockTextProvider } from "./mock-provider.js";
import { normalizeProviderError } from "./provider-error.js";
import { runProviderComplete, runProviderStream } from "./provider-runner.js";

const request: ProviderRuntimeRequest = {
  id: "provider-request-1",
  providerId: "mock-streaming",
  modelId: "mock-model",
  messages: [{ role: "user", content: "Summarize selection" }],
  metadata: { taskId: "task-0001", planId: "plan-0001", traceId: "trace-0001" },
};

describe("Provider runner", () => {
  it("maps complete success to started, usage, and completed events", async () => {
    const result = await runProviderComplete(new MockTextProvider(), { ...request, providerId: "mock-text" });

    expect(result.response.text).toContain("Summarize selection");
    expect(result.events.map((event) => event.type)).toEqual([
      "provider_request_started",
      "provider_usage_recorded",
      "provider_request_completed",
    ]);
    expect(result.events[1]).toMatchObject({ usage: result.response.usage });
  });

  it("maps stream chunks to deterministic lifecycle events and aggregate text", async () => {
    const result = await runProviderStream(new MockStreamingProvider({ chunks: ["A", "B", "C"] }), request);

    expect(result.text).toBe("ABC");
    expect(result.events.map((event) => event.type)).toEqual([
      "provider_request_started",
      "provider_stream_started",
      "provider_stream_delta",
      "provider_stream_delta",
      "provider_stream_delta",
      "provider_stream_completed",
      "provider_usage_recorded",
      "provider_request_completed",
    ]);
    expect(result.events.filter((event) => event.type === "provider_stream_delta")).toHaveLength(3);
  });

  it("maps adapter throws to provider_request_failed", async () => {
    const result = await runProviderStream(new MockStreamingProvider({ failAtChunk: 1 }), request);

    expect(result.events.at(-1)).toMatchObject({
      type: "provider_request_failed",
      error: { code: "provider_unavailable", retryable: true },
    });
  });

  it("maps cancellation before stream to provider_request_cancelled", async () => {
    const controller = new AbortController();
    controller.abort("user cancelled");

    const result = await runProviderStream(new MockStreamingProvider({ chunks: ["A"] }), request, {
      signal: controller.signal,
    });

    expect(result.events.map((event) => event.type)).toEqual([
      "provider_request_started",
      "provider_request_cancelled",
    ]);
  });
});

describe("Provider runner timeout semantics", () => {
  it("returns timeout failure for complete with timeoutTicks <= 0", async () => {
    const result = await runProviderComplete(new MockTextProvider(), { ...request, providerId: "mock-text" }, { timeoutTicks: 0 });

    expect(result.response.text).toBe("");
    expect(result.response.finishReason).toBe("error");
    expect(result.events.map((event) => event.type)).toEqual([
      "provider_request_started",
      "provider_request_failed",
    ]);
    expect(result.events[1]).toMatchObject({
      type: "provider_request_failed",
      error: { code: "timeout", retryable: true },
    });
  });

  it("returns timeout failure for negative timeoutTicks in complete mode", async () => {
    const result = await runProviderComplete(new MockTextProvider(), { ...request, providerId: "mock-text" }, { timeoutTicks: -1 });

    expect(result.events.at(-1)).toMatchObject({
      type: "provider_request_failed",
      error: { code: "timeout", retryable: true },
    });
  });

  it("returns timeout failure for stream with timeoutTicks <= 0", async () => {
    const result = await runProviderStream(new MockStreamingProvider({ chunks: ["A", "B", "C"] }), request, { timeoutTicks: 0 });

    expect(result.text).toBe("");
    expect(result.chunks).toEqual([]);
    expect(result.events.map((event) => event.type)).toEqual([
      "provider_request_started",
      "provider_request_failed",
    ]);
    expect(result.events[1]).toMatchObject({
      type: "provider_request_failed",
      error: { code: "timeout", retryable: true },
    });
  });

  it("exhausts chunk budget and returns partial text in stream mode", async () => {
    const result = await runProviderStream(new MockStreamingProvider({ chunks: ["A", "B", "C", "D"] }), request, { timeoutTicks: 2 });

    expect(result.text).toBe("AB");
    expect(result.chunks).toHaveLength(2);
    expect(result.events.filter((e) => e.type === "provider_stream_delta")).toHaveLength(2);
    expect(result.events.at(-1)).toMatchObject({
      type: "provider_request_failed",
      error: { code: "timeout", retryable: true },
    });
    expect(result.events.map((e) => e.type)).not.toContain("provider_request_completed");
    expect(result.events.map((e) => e.type)).not.toContain("provider_stream_completed");
  });

  it("processes all chunks when timeoutTicks exceeds chunk count", async () => {
    const result = await runProviderStream(new MockStreamingProvider({ chunks: ["X", "Y"] }), request, { timeoutTicks: 10 });

    expect(result.text).toBe("XY");
    expect(result.events.at(-1)).toMatchObject({
      type: "provider_request_completed",
    });
  });

  it("behaves normally when timeoutTicks is undefined", async () => {
    const result = await runProviderComplete(new MockTextProvider(), { ...request, providerId: "mock-text" }, {});

    expect(result.response.text).toContain("Summarize selection");
    expect(result.events.map((e) => e.type)).toContain("provider_request_completed");
  });
});

describe("Provider error taxonomy", () => {
  it("normalizes auth_missing as non-retryable", () => {
    expect(normalizeProviderError({ code: "auth_missing", message: "Missing mock credential" }, "mock")).toMatchObject({
      code: "auth_missing",
      retryable: false,
    });
  });

  it("normalizes timeout and rate limits as retryable", () => {
    expect(normalizeProviderError({ code: "timeout", message: "Timed out" }, "mock")).toMatchObject({
      code: "timeout",
      retryable: true,
    });
    expect(normalizeProviderError({ code: "rate_limited", message: "Slow down" }, "mock")).toMatchObject({
      code: "rate_limited",
      retryable: true,
    });
  });
});
