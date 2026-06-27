import { describe, it, expect } from "vitest";
import { mapProviderRuntimeEvent } from "./provider-event-bridge.js";
import type {
  ProviderRuntimeResponse,
  ProviderRuntimeError,
} from "@uagent/shared";

describe("mapProviderRuntimeEvent", () => {
  it("maps request_started to task event", () => {
    const result = mapProviderRuntimeEvent(
      { type: "provider_request_started", requestId: "req-1", providerId: "test", modelId: "model-1" },
      "task-001",
      1,
    );
    expect(result.taskEvents).toHaveLength(1);
    expect(result.taskEvents[0].type).toBe("provider_request_started");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("maps stream_started to task event", () => {
    const result = mapProviderRuntimeEvent(
      { type: "provider_stream_started", requestId: "req-1", providerId: "test" },
      "task-001",
      2,
    );
    expect(result.taskEvents[0].type).toBe("provider_stream_started");
  });

  it("maps stream_delta to task event and evidence", () => {
    const chunk = { id: "chunk-1", requestId: "req-1", providerId: "test", modelId: "m", index: 0, delta: "Hello", done: false };
    const result = mapProviderRuntimeEvent(
      { type: "provider_stream_delta", requestId: "req-1", providerId: "test", chunk },
      "task-001",
      3,
    );
    expect(result.taskEvents).toHaveLength(1);
    expect(result.evidence).toHaveLength(1);
    expect(result.taskEvents[0].body).toBe("Hello");
  });

  it("maps stream_completed to task event", () => {
    const result = mapProviderRuntimeEvent(
      { type: "provider_stream_completed", requestId: "req-1", providerId: "test", text: "Complete stream" },
      "task-001",
      4,
    );
    expect(result.taskEvents[0].type).toBe("provider_stream_completed");
    expect(result.taskEvents[0].level).toBe("success");
  });

  it("maps request_completed to task event", () => {
    const response: ProviderRuntimeResponse = {
      id: "resp-1", requestId: "req-1", providerId: "test", modelId: "m",
      text: "Response", finishReason: "stop",
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      createdAt: 1000,
    };
    const result = mapProviderRuntimeEvent(
      { type: "provider_request_completed", requestId: "req-1", providerId: "test", response },
      "task-001",
      5,
    );
    expect(result.taskEvents[0].type).toBe("provider_request_completed");
    expect(result.taskEvents[0].level).toBe("success");
  });

  it("maps request_failed to task event and diagnostics", () => {
    const error: ProviderRuntimeError = {
      name: "ProviderRuntimeError", providerId: "test",
      code: "rate_limited", message: "Rate limited.", retryable: true,
    };
    const result = mapProviderRuntimeEvent(
      { type: "provider_request_failed", requestId: "req-1", providerId: "test", error },
      "task-001",
      6,
    );
    expect(result.taskEvents).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.taskEvents[0].level).toBe("error");
  });

  it("maps request_cancelled to task event and diagnostics", () => {
    const result = mapProviderRuntimeEvent(
      { type: "provider_request_cancelled", requestId: "req-1", providerId: "test", reason: "User cancelled." },
      "task-001",
      7,
    );
    expect(result.taskEvents).toHaveLength(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.taskEvents[0].level).toBe("warning");
  });

  it("maps usage_recorded to task event and evidence", () => {
    const usage = { inputTokens: 10, outputTokens: 5, totalTokens: 15 };
    const result = mapProviderRuntimeEvent(
      { type: "provider_usage_recorded", requestId: "req-1", providerId: "test", usage },
      "task-001",
      8,
    );
    expect(result.taskEvents).toHaveLength(1);
    expect(result.evidence).toHaveLength(1);
    expect(result.taskEvents[0].body).toContain("10 in");
  });
});
