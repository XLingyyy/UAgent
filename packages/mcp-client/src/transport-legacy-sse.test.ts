import { describe, expect, it, vi } from "vitest";
import { createJsonRpcRequest } from "./json-rpc.js";
import { LegacySseTransport, parseLegacyEndpointEvent } from "./transport-legacy-sse.js";

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
});
