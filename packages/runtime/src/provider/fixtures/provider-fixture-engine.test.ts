import { describe, it, expect } from "vitest";
import { createProviderFixtureScenario } from "./provider-fixture-engine.js";

describe("ProviderFixtureScenario", () => {
  it("creates a scenario with correct metadata", () => {
    const scenario = createProviderFixtureScenario(
      { wireApi: "openai-compatible", name: "success", description: "Normal completion" },
      () => ({ status: 200, body: { id: "test" } }),
    );
    expect(scenario.name).toBe("success");
    expect(scenario.wireApi).toBe("openai-compatible");
    expect(scenario.description).toBe("Normal completion");
  });

  it("handler returns expected response", () => {
    const scenario = createProviderFixtureScenario(
      { wireApi: "openai-compatible", name: "rate-limit", description: "Rate limited" },
      () => ({ status: 429, body: { error: { message: "Rate limited", type: "rate_limit_error" } } }),
    );
    const response = scenario.handleRequest({ path: "/v1/chat/completions", method: "POST", headers: {} });
    expect(response.status).toBe(429);
    expect(response.body).toEqual({ error: { message: "Rate limited", type: "rate_limit_error" } });
  });

  it("handler can return stream chunks", () => {
    const scenario = createProviderFixtureScenario(
      { wireApi: "anthropic-compatible", name: "stream", description: "Streaming response" },
      () => ({
        status: 200,
        streamChunks: [
          { id: "msg_1", object: "message", type: "content_block_delta", content_block: { type: "text", text: "Hello" } },
        ],
      }),
    );
    const response = scenario.handleRequest({ path: "/v1/messages", method: "POST", headers: {} });
    expect(response.streamChunks).toHaveLength(1);
    expect(response.streamChunks![0].content_block?.text).toBe("Hello");
  });
});
