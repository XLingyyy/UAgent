import { describe, expect, it, vi } from "vitest";
import { createJsonRpcRequest } from "./json-rpc.js";
import { LegacySseTransport, parseLegacyEndpointEvent } from "./transport-legacy-sse.js";
import { createMcpFixtureScenario } from "./fixtures/mcp-fixture-engine.js";
import { createLegacySseFixtureFetch } from "./fixtures/legacy-sse-fixture.js";

describe("Legacy HTTP+SSE transport", () => {
  it("uses endpoint events from SSE as the POST target", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = input.toString();
      if (url.endsWith("/sse")) {
        return new Response("event: endpoint\ndata: /message?sessionId=abc\n\n", {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { prompts: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    const transport = new LegacySseTransport({
      endpoint: "http://127.0.0.1:8765/sse",
      fetch: fetchMock,
    });

    await transport.sendRequest(createJsonRpcRequest("prompts/list", {}, () => 1));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe("http://127.0.0.1:8765/message?sessionId=abc");
  });

  it("parses endpoint SSE events", () => {
    expect(parseLegacyEndpointEvent("event: endpoint\ndata: /message\n\n")).toBe("/message");
  });

  it("uses fixture SSE endpoint and POST handler for initialize and resources/read", async () => {
    const scenario = createMcpFixtureScenario({
      routes: {
        initialize: { result: { protocolVersion: "2025-06-18", serverInfo: { name: "legacy-fixture", version: "1.0.0" }, capabilities: { resources: {} } } },
        "resources/read": { result: { contents: [{ type: "text", text: "legacy resource" }] } },
      },
    });
    const transport = new LegacySseTransport({
      endpoint: "http://127.0.0.1:8765/sse",
      fetch: createLegacySseFixtureFetch(scenario, { endpointPath: "/message?sessionId=legacy" }),
    });

    await transport.sendRequest(createJsonRpcRequest("initialize", {}, () => 1));
    const result = await transport.sendRequest(createJsonRpcRequest("resources/read", { uri: "ue://fixture" }, () => 2));

    expect(result).toMatchObject({ result: { contents: [{ text: "legacy resource" }] } });
    expect(scenario.findRequests("resources/read")[0]?.url).toBe("http://127.0.0.1:8765/message?sessionId=legacy");
  });

  it("surfaces bad legacy endpoint events", async () => {
    const scenario = createMcpFixtureScenario();
    const transport = new LegacySseTransport({
      endpoint: "http://127.0.0.1:8765/sse",
      fetch: createLegacySseFixtureFetch(scenario, { badEndpointEvent: true }),
    });

    await expect(transport.sendRequest(createJsonRpcRequest("initialize", {}, () => 1))).rejects.toThrow(
      "Legacy SSE stream did not include an endpoint event.",
    );
  });
});
