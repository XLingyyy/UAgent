import { describe, expect, it, vi } from "vitest";
import { createJsonRpcRequest } from "./json-rpc.js";
import { StreamableHttpTransport } from "./transport-streamable-http.js";

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
});
