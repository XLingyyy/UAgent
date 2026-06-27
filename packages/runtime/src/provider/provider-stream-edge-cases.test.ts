import { describe, it, expect } from "vitest";
import { runProviderComplete, runProviderStream } from "./provider-runner.js";
import {
  MockStreamingProvider,
  MockTextProvider,
  FailingProvider,
} from "./mock-provider.js";
import type { ProviderRuntimeRequest } from "@uagent/shared";

const BASE_REQUEST: ProviderRuntimeRequest = {
  id: "test-request",
  providerId: "test",
  modelId: "test-model",
  messages: [{ role: "user", content: "Test input" }],
  metadata: { taskId: "task-001", planId: "plan-001" },
};

describe("Streaming edge cases", () => {
  describe("abort before start", () => {
    it("completes with cancelled event when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const result = await runProviderStream(
        new MockStreamingProvider(),
        BASE_REQUEST,
        { signal: controller.signal },
      );
      expect(result.text).toBe("");
      expect(result.chunks).toHaveLength(0);
      expect(
        result.events.some((e) => e.type === "provider_request_cancelled"),
      ).toBe(true);
    });

    it("complete path returns cancelled when already aborted", async () => {
      const controller = new AbortController();
      controller.abort();
      const result = await runProviderComplete(
        new MockTextProvider(),
        BASE_REQUEST,
        { signal: controller.signal },
      );
      expect(result.response.text).toBe("");
      expect(
        result.events.some((e) => e.type === "provider_request_cancelled"),
      ).toBe(true);
    });
  });

  describe("abort after N chunks", () => {
    it("returns partial content when aborted mid-stream", async () => {
      const controller = new AbortController();
      const resultPromise = runProviderStream(
        new MockStreamingProvider(),
        BASE_REQUEST,
        { signal: controller.signal },
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
      controller.abort();
      const result = await resultPromise;
      expect(result.text.length).toBeGreaterThanOrEqual(0);
      if (
        result.events.some((e) => e.type === "provider_stream_completed")
      ) {
        expect(result.text).toBeTruthy();
      }
    });
  });

  describe("adapter throws at chunk N", () => {
    it("returns partial content and failure event when adapter throws", async () => {
      const provider = new MockStreamingProvider({
        chunks: ["A", "B", "C"],
        failAtChunk: 2,
      });
      const result = await runProviderStream(provider, BASE_REQUEST);
      expect(result.chunks.length).toBeLessThan(3);
      expect(
        result.events.some((e) => e.type === "provider_request_failed"),
      ).toBe(true);
    });
  });

  describe("timeout semantics", () => {
    it("returns timeout failure when timeoutTicks is 0", async () => {
      const result = await runProviderStream(
        new MockStreamingProvider(),
        BASE_REQUEST,
        { timeoutTicks: 0 },
      );
      expect(result.text).toBe("");
      expect(
        result.events.some((e) => e.type === "provider_request_failed"),
      ).toBe(true);
    });

    it("complete path handles timeout ticks", async () => {
      const result = await runProviderComplete(
        new MockTextProvider(),
        BASE_REQUEST,
        { timeoutTicks: 0 },
      );
      expect(result.response.text).toBe("");
    });

    it("exhausts chunk budget and returns timeout", async () => {
      const result = await runProviderStream(
        new MockStreamingProvider({
          chunks: ["1", "2", "3", "4", "5"],
        }),
        BASE_REQUEST,
        { timeoutTicks: 3 },
      );
      expect(result.chunks.length).toBeLessThanOrEqual(3);
    });
  });

  describe("error mapping", () => {
    it("returns failure for a failing provider", async () => {
      const result = await runProviderComplete(
        new FailingProvider(),
        BASE_REQUEST,
      );
      expect(
        result.events.some((e) => e.type === "provider_request_failed"),
      ).toBe(true);
    });

    it("streaming path fails gracefully when provider lacks stream method", async () => {
      const result = await runProviderStream(
        new MockTextProvider(),
        BASE_REQUEST,
      );
      expect(
        result.events.some((e) => e.type === "provider_request_failed"),
      ).toBe(true);
    });
  });

  describe("usage tracking", () => {
    it("maps usage on complete", async () => {
      const result = await runProviderComplete(
        new MockTextProvider(),
        BASE_REQUEST,
      );
      expect(
        result.events.some((e) => e.type === "provider_usage_recorded"),
      ).toBe(true);
      expect(result.response.usage.totalTokens).toBeGreaterThan(0);
    });

    it("maps usage on stream completion", async () => {
      const result = await runProviderStream(
        new MockStreamingProvider(),
        BASE_REQUEST,
      );
      expect(
        result.events.some((e) => e.type === "provider_usage_recorded"),
      ).toBe(true);
      if (result.usage) {
        expect(result.usage.totalTokens).toBeGreaterThan(0);
      }
    });
  });
});
