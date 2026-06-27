import { describe, it, expect, vi } from "vitest";
import { AnthropicCompatibleAdapter } from "./anthropic-compatible-adapter.js";
import type { ProviderRuntimeRequest } from "@uagent/shared";
import type { ProviderHttpResponse, ProviderHttpTransport } from "./provider-http-transport.js";

function makeRequest(overrides: Partial<ProviderRuntimeRequest> = {}): ProviderRuntimeRequest {
  return {
    id: "test-request-1",
    providerId: "anthropic-compatible-claude-sonnet",
    modelId: "claude-sonnet",
    messages: [{ role: "user", content: "Hello" }],
    ...overrides,
  };
}

function makeTransport(options: {
  json?: ProviderHttpResponse;
  stream?: string[];
}): ProviderHttpTransport {
  return {
    networkMode: "fixture",
    async sendJson() {
      return options.json ?? { status: 200, headers: {}, body: "{}" };
    },
    async *streamSse() {
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

describe("AnthropicCompatibleAdapter", () => {
  it("has correct id and capabilities", () => {
    const adapter = new AnthropicCompatibleAdapter({ modelId: "claude-sonnet", isFixture: true });
    expect(adapter.id).toBe("anthropic-compatible-claude-sonnet");
    const caps = adapter.getCapabilities();
    expect(caps.providerId).toBe("anthropic-compatible-claude-sonnet");
    expect(caps.modelIds).toEqual(["claude-sonnet"]);
    expect(caps.supportsStreaming).toBe(true);
    expect(caps.isMock).toBe(true);
  });

  it("reports non-fixture when configured", () => {
    const adapter = new AnthropicCompatibleAdapter({ modelId: "claude-haiku", isFixture: false });
    expect(adapter.getCapabilities().isMock).toBe(false);
  });

  it("can be constructed with custom base URL and API version", () => {
    const adapter = new AnthropicCompatibleAdapter({
      modelId: "claude-opus",
      baseUrl: "https://custom.anthropic.com/v1",
      apiVersion: "2024-01-01",
    });
    const caps = adapter.getCapabilities();
    expect(caps.providerId).toBe("anthropic-compatible-claude-opus");
  });

  it("defaults to fixture transport and does not call global fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const adapter = new AnthropicCompatibleAdapter({ modelId: "claude-sonnet", isFixture: true });
    const result = await adapter.complete(makeRequest());
    expect(result.text).toBe("Fixture provider response.");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("parses Anthropic complete responses from injected transport", async () => {
    const adapter = new AnthropicCompatibleAdapter({
      modelId: "claude-sonnet",
      transport: makeTransport({
        json: {
          status: 200,
          headers: {},
          body: JSON.stringify({
            id: "msg-1",
            content: [{ type: "text", text: "Hi there!" }],
            usage: { input_tokens: 2, output_tokens: 3 },
          }),
        },
      }),
    });

    const result = await adapter.complete(makeRequest());
    expect(result.text).toBe("Hi there!");
    expect(result.usage).toEqual({ inputTokens: 2, outputTokens: 3, totalTokens: 5 });
  });

  it("yields Anthropic stream chunks from injected transport", async () => {
    const adapter = new AnthropicCompatibleAdapter({
      modelId: "claude-sonnet",
      transport: makeTransport({
        stream: [
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}',
          'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":" world"}}',
          'data: {"type":"message_stop"}',
        ],
      }),
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
