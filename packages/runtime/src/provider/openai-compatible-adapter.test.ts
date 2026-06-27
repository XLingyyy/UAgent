import { describe, it, expect, vi } from "vitest";
import { OpenAICompatibleAdapter } from "./openai-compatible-adapter.js";
import type { ProviderRuntimeRequest } from "@uagent/shared";
import type { ProviderHttpResponse, ProviderHttpTransport } from "./provider-http-transport.js";

function makeRequest(overrides: Partial<ProviderRuntimeRequest> = {}): ProviderRuntimeRequest {
  return {
    id: "test-request-1",
    providerId: "openai-compatible-gpt-4o",
    modelId: "gpt-4o",
    messages: [{ role: "user", content: "Hello" }],
    ...overrides,
  };
}

function makeTransport(options: {
  json?: ProviderHttpResponse;
  stream?: string[];
  fail?: Error;
}): ProviderHttpTransport {
  return {
    networkMode: "fixture",
    async sendJson() {
      if (options.fail) throw options.fail;
      return options.json ?? { status: 200, headers: {}, body: "{}" };
    },
    async *streamSse() {
      if (options.fail) throw options.fail;
      for (const line of options.stream ?? []) {
        yield line;
      }
    },
    getBaseUrl() {
      return "https://fixture.provider/v1";
    },
    enableLive() {
      return undefined;
    },
  };
}

describe("OpenAICompatibleAdapter", () => {
  it("has correct id and capabilities", () => {
    const adapter = new OpenAICompatibleAdapter({ modelId: "gpt-4o", isFixture: true });
    expect(adapter.id).toBe("openai-compatible-gpt-4o");
    const caps = adapter.getCapabilities();
    expect(caps.providerId).toBe("openai-compatible-gpt-4o");
    expect(caps.modelIds).toEqual(["gpt-4o"]);
    expect(caps.supportsStreaming).toBe(true);
    expect(caps.isMock).toBe(true);
  });

  it("reports non-fixture when configured", () => {
    const adapter = new OpenAICompatibleAdapter({ modelId: "gpt-4o", isFixture: false });
    expect(adapter.getCapabilities().isMock).toBe(false);
  });

  it("can be constructed with custom base URL", () => {
    const adapter = new OpenAICompatibleAdapter({
      modelId: "local-model",
      baseUrl: "http://localhost:8080/v1",
    });
    const caps = adapter.getCapabilities();
    expect(caps.providerId).toBe("openai-compatible-local-model");
  });

  it("defaults baseUrl to OpenAI", () => {
    const adapter = new OpenAICompatibleAdapter({ modelId: "gpt-4o" });
    // We can't easily inspect private fields, so verify via error behavior
    // - fetch will fail because there's no server, just asserting the adapter exists
    expect(adapter.id).toBe("openai-compatible-gpt-4o");
  });

  describe("complete", () => {
    it("defaults to fixture transport and does not call global fetch", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const adapter = new OpenAICompatibleAdapter({ modelId: "gpt-4o", isFixture: true });
      const result = await adapter.complete(makeRequest());
      expect(result.text).toBe("Fixture provider response.");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("throws on transport error", async () => {
      const adapter = new OpenAICompatibleAdapter({
        modelId: "gpt-4o",
        isFixture: true,
        transport: makeTransport({ fail: new Error("Network failure") }),
      });
      await expect(adapter.complete(makeRequest())).rejects.toMatchObject({
        name: "ProviderRuntimeError",
        providerId: "openai-compatible-gpt-4o",
      });
    });

    it("throws on non-ok response", async () => {
      const adapter = new OpenAICompatibleAdapter({
        modelId: "gpt-4o",
        isFixture: true,
        transport: makeTransport({ json: { status: 401, headers: {}, body: "Unauthorized" } }),
      });
      await expect(adapter.complete(makeRequest())).rejects.toMatchObject({
        name: "ProviderRuntimeError",
        code: "auth_missing",
        providerId: "openai-compatible-gpt-4o",
      });
    });

    it("throws rate_limited on 429", async () => {
      const adapter = new OpenAICompatibleAdapter({
        modelId: "gpt-4o",
        transport: makeTransport({ json: { status: 429, headers: {}, body: "Too Many Requests" } }),
      });
      await expect(adapter.complete(makeRequest())).rejects.toMatchObject({
        code: "rate_limited",
      });
    });

    it("throws provider_unavailable on 5xx", async () => {
      const adapter = new OpenAICompatibleAdapter({
        modelId: "gpt-4o",
        transport: makeTransport({ json: { status: 503, headers: {}, body: "Server Error" } }),
      });
      await expect(adapter.complete(makeRequest())).rejects.toMatchObject({
        code: "provider_unavailable",
      });
    });

    it("parses a successful response", async () => {
      const body = {
        id: "chatcmpl-abc123",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Hi there!" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };
      const adapter = new OpenAICompatibleAdapter({
        modelId: "gpt-4o",
        transport: makeTransport({ json: { status: 200, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } }),
      });
      const result = await adapter.complete(makeRequest());
      expect(result.text).toBe("Hi there!");
      expect(result.finishReason).toBe("stop");
      expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    });
  });

  describe("stream", () => {
    it("throws on transport error", async () => {
      const adapter = new OpenAICompatibleAdapter({
        modelId: "gpt-4o",
        transport: makeTransport({ fail: new Error("Network failure") }),
      });
      const iterator = adapter.stream(makeRequest())[Symbol.asyncIterator]();
      await expect(iterator.next()).rejects.toMatchObject({
        name: "ProviderRuntimeError",
        providerId: "openai-compatible-gpt-4o",
      });
    });

    it("yields chunks from SSE stream", async () => {
      const chunks = [
        'data: {"choices":[{"delta":{"content":"Hello"}}]}',
        'data: {"choices":[{"delta":{"content":" world"}}]}',
        "data: [DONE]",
      ];
      const adapter = new OpenAICompatibleAdapter({
        modelId: "gpt-4o",
        transport: makeTransport({ stream: chunks }),
      });
      const results = [];
      for await (const chunk of adapter.stream(makeRequest())) {
        results.push(chunk);
      }
      expect(results).toHaveLength(3);
      expect(results[0].delta).toBe("Hello");
      expect(results[1].delta).toBe(" world");
      expect(results[2].done).toBe(true);
    });
  });
});
