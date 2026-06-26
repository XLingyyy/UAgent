import { describe, expect, it } from "vitest";
import type { ProviderRuntimeRequest } from "@uagent/shared";
import {
  FailingProvider,
  MockStreamingProvider,
  MockTextProvider,
  ProviderRegistry,
} from "./mock-provider.js";

const request: ProviderRuntimeRequest = {
  id: "provider-request-0001",
  providerId: "mock-text",
  modelId: "mock-model",
  messages: [{ role: "user", content: "Review current selection" }],
  temperature: 0,
};

describe("mock provider adapters", () => {
  it("returns deterministic text completions", async () => {
    const provider = new MockTextProvider();

    const response = await provider.complete(request);

    expect(response).toEqual({
      id: "mock-text-response-provider-request-0001",
      requestId: "provider-request-0001",
      providerId: "mock-text",
      modelId: "mock-model",
      text: "Mock provider response for: Review current selection",
      finishReason: "stop",
      usage: {
        inputTokens: 3,
        outputTokens: 7,
        totalTokens: 10,
      },
      createdAt: 1_000,
    });
    expect(provider.getCapabilities().isMock).toBe(true);
  });

  it("streams deterministic chunks in order", async () => {
    const provider = new MockStreamingProvider();
    const chunks = [];

    for await (const chunk of provider.stream(request)) {
      chunks.push(chunk);
    }

    expect(chunks.map((chunk) => chunk.delta)).toEqual(["Mock ", "stream ", "response"]);
    expect(chunks.at(-1)?.done).toBe(true);
  });

  it("raises deterministic provider runtime errors", async () => {
    const provider = new FailingProvider();

    await expect(provider.complete(request)).rejects.toMatchObject({
      name: "ProviderRuntimeError",
      providerId: "mock-failing",
      retryable: false,
    });
  });

  it("registers and selects mock adapters without real provider wiring", async () => {
    const registry = new ProviderRegistry();
    registry.register(new MockTextProvider());
    registry.register(new MockStreamingProvider());

    expect(registry.listCapabilities().map((capability) => capability.providerId)).toEqual([
      "mock-text",
      "mock-streaming",
    ]);
    await expect(registry.get("mock-text").complete(request)).resolves.toMatchObject({
      providerId: "mock-text",
    });
    expect(() => registry.get("missing")).toThrow("Provider adapter is not registered: missing");
  });
});
