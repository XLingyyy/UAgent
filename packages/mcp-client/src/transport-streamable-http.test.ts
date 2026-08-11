import { describe, expect, it, vi } from "vitest";
import { createJsonRpcRequest } from "./json-rpc.js";
import { StreamableHttpTransport } from "./transport-streamable-http.js";
import { createMcpFixtureScenario } from "./fixtures/mcp-fixture-engine.js";
import { createStreamableHttpFixtureFetch } from "./fixtures/streamable-http-fixture.js";

describe("Streamable HTTP transport", () => {
  it("posts JSON-RPC to one endpoint with MCP headers and stores session id", async () => {
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Mcp-Session-Id": "session-1",
        },
      });
    });
    const transport = new StreamableHttpTransport({
      endpoint: "http://127.0.0.1:8765/mcp",
      fetch: fetchMock,
      idFactory: () => 1,
    });

    await transport.sendRequest(createJsonRpcRequest("initialize", {}, () => 1));
    await transport.sendRequest(createJsonRpcRequest("tools/list", {}, () => 2));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    expect(firstHeaders.Accept).toContain("application/json");
    expect(firstHeaders.Accept).toContain("text/event-stream");
    expect(secondHeaders["Mcp-Session-Id"]).toBe("session-1");
    expect(secondHeaders["MCP-Protocol-Version"]).toBe("2025-06-18");
  });

  it("parses text/event-stream JSON-RPC message responses", async () => {
    const fetchMock = vi.fn(async (...args: Parameters<typeof fetch>) => {
      void args;
      return new Response('event: message\ndata: {"jsonrpc":"2.0","id":3,"result":{"tools":[]}}\n\n', {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });
    const transport = new StreamableHttpTransport({
      endpoint: "http://localhost:8765/mcp",
      fetch: fetchMock,
    });

    await expect(
      transport.sendRequest(createJsonRpcRequest("tools/list", {}, () => 3)),
    ).resolves.toMatchObject({ result: { tools: [] } });
  });

  it("blocks non-localhost endpoints by default", async () => {
    expect(
      () =>
        new StreamableHttpTransport({
          endpoint: "https://example.com/mcp",
          fetch: vi.fn(),
        }),
    ).toThrow(/Only localhost MCP endpoints/);
  });

  it("uses fixture fetch for initialize session retention and resources/read JSON", async () => {
    const scenario = createMcpFixtureScenario({
      routes: {
        initialize: { result: { protocolVersion: "2025-06-18", serverInfo: { name: "stream-fixture", version: "1.0.0" }, capabilities: { resources: {} } } },
        "resources/read": { result: { contents: [{ type: "text", text: "fixture resource" }] } },
      },
    });
    const transport = new StreamableHttpTransport({
      endpoint: "http://127.0.0.1:8765/mcp",
      fetch: createStreamableHttpFixtureFetch(scenario, { sessionId: "session-fixture" }),
    });

    await transport.sendRequest(createJsonRpcRequest("initialize", {}, () => 1));
    const result = await transport.sendRequest(createJsonRpcRequest("resources/read", { uri: "ue://fixture" }, () => 2));

    expect(result).toMatchObject({ result: { contents: [{ text: "fixture resource" }] } });
    expect(scenario.findRequests("resources/read")).toHaveLength(1);
    expect(scenario.findRequests("resources/read")[0]?.headers?.["Mcp-Session-Id"]).toBe("session-fixture");
  });

  it("uses fixture fetch for resources/read text/event-stream responses", async () => {
    const scenario = createMcpFixtureScenario({
      routes: {
        "resources/read": { result: { contents: [{ type: "text", text: "sse resource" }] } },
      },
    });
    const transport = new StreamableHttpTransport({
      endpoint: "http://localhost:8765/mcp",
      fetch: createStreamableHttpFixtureFetch(scenario, { responseMode: "sse" }),
    });

    await expect(
      transport.sendRequest(createJsonRpcRequest("resources/read", { uri: "ue://fixture" }, () => 3)),
    ).resolves.toMatchObject({ result: { contents: [{ text: "sse resource" }] } });
  });

  it("surfaces malformed fixture SSE with a stable protocol category", async () => {
    const scenario = createMcpFixtureScenario({
      routes: {
        "tools/list": { malformed: "this is not json rpc" },
      },
    });
    const transport = new StreamableHttpTransport({
      endpoint: "http://localhost:8765/mcp",
      fetch: createStreamableHttpFixtureFetch(scenario, { responseMode: "sse" }),
    });

    await expect(transport.sendRequest(createJsonRpcRequest("tools/list", {}, () => 4))).rejects.toMatchObject({
      message: "protocol_response_malformed",
    });
  });

  it("surfaces non-response JSON-RPC messages with the stable protocol category", async () => {
    const transport = new StreamableHttpTransport({
      endpoint: "http://localhost:8765/mcp",
      fetch: async () => new Response(JSON.stringify({ jsonrpc: "2.0", method: "notifications/progress" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    });

    await expect(transport.sendRequest(createJsonRpcRequest("tools/list", {}, () => 5))).rejects.toMatchObject({
      message: "protocol_response_malformed",
    });
  });

  it("terminates an established 2025-06-18 session with DELETE and required headers", async () => {
    const fetchMock = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Mcp-Session-Id": "session-delete-1",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const transport = new StreamableHttpTransport({
      endpoint: "http://127.0.0.1:8765/mcp",
      fetch: fetchMock,
    });

    await transport.sendRequest(createJsonRpcRequest("initialize", {}, () => 1));
    await transport.close();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const close = fetchMock.mock.calls[1]!;
    expect(close[1]?.method).toBe("DELETE");
    expect(close[1]?.body).toBeUndefined();
    expect(close[1]?.headers).toMatchObject({
      Accept: "application/json, text/event-stream",
      "Mcp-Session-Id": "session-delete-1",
      "MCP-Protocol-Version": "2025-06-18",
    });
  });

  it("treats 405 as an explicit unsupported termination response and keeps close idempotent", async () => {
    const fetchMock = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Mcp-Session-Id": "session-delete-405",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 405 }));
    const transport = new StreamableHttpTransport({
      endpoint: "http://127.0.0.1:8765/mcp",
      fetch: fetchMock,
    });

    await transport.sendRequest(createJsonRpcRequest("initialize", {}, () => 1));
    await expect(transport.close()).resolves.toBeUndefined();
    await expect(transport.close()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("closes locally without a DELETE when no session was assigned", async () => {
    const fetchMock = vi.fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>();
    const transport = new StreamableHttpTransport({
      endpoint: "http://127.0.0.1:8765/mcp",
      fetch: fetchMock,
    });

    await transport.close();
    await transport.close();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports non-405 termination failures without restoring the local session", async () => {
    const fetchMock = vi
      .fn<Parameters<typeof fetch>, ReturnType<typeof fetch>>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Mcp-Session-Id": "session-delete-failure",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 500 }));
    const transport = new StreamableHttpTransport({
      endpoint: "http://127.0.0.1:8765/mcp",
      fetch: fetchMock,
    });

    await transport.sendRequest(createJsonRpcRequest("initialize", {}, () => 1));
    await expect(transport.close()).rejects.toMatchObject({ status: 500 });
    await expect(transport.close()).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
