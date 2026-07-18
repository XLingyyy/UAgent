import { createJsonRpcRequest, StreamableHttpTransport } from "@uagent/mcp-client";
import { describe, expect, it } from "vitest";
import { createNativeMcpHttpPoster } from "./mcp-native-transport";
import type { NativeInvoke } from "./project-native-adapter";

type NativeMcpCall = {
  endpoint: string;
  body: string;
  protocolVersion?: string;
  sessionId?: string | null;
  timeoutMs?: number;
};

function asNativeInvoke(mock: (command: string, payload?: unknown) => Promise<unknown>): NativeInvoke {
  return <T = unknown>(command: string, payload?: unknown) => mock(command, payload) as Promise<T>;
}

describe("native MCP HTTP poster", () => {
  it("returns a terminal SSE result after an empty initial frame", async () => {
    const calls: NativeMcpCall[] = [];
    const invoke = asNativeInvoke(async (command, payload) => {
      expect(command).toBe("mcp_streamable_http_request");
      const input = (payload as { input: NativeMcpCall }).input;
      calls.push(input);
      const request = JSON.parse(input.body) as { id: number };
      return {
        status: 200,
        contentType: "text/event-stream",
        sessionId: "safe-session",
        body: `: keepalive\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { dryRun: true } })}\n\n`,
      };
    });
    const transport = new StreamableHttpTransport({
      endpoint: "http://127.0.0.1:8000/mcp",
      fetch: createNativeMcpHttpPoster(invoke, 5_000),
    });

    await expect(transport.sendRequest(createJsonRpcRequest("tools/call", {}, () => 7))).resolves.toMatchObject({
      result: { dryRun: true },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      endpoint: "http://127.0.0.1:8000/mcp",
      protocolVersion: "2025-06-18",
      sessionId: null,
      timeoutMs: 5_000,
    });
  });

  it.each([
    ["native_request_failed", "native_request_failed"],
    ["native_response_read_failed", "native_response_read_failed"],
    ["mcp_http_request_failed:unsafe-details", "native_request_failed"],
    ["mcp_http_response_read_failed:unsafe-details", "native_response_read_failed"],
  ])(
    "preserves the safe native category %s through the MCP client",
    async (nativeError, expectedReason) => {
      const invoke = asNativeInvoke(async () => Promise.reject(new Error(nativeError)));
      const transport = new StreamableHttpTransport({
        endpoint: "http://127.0.0.1:8000/mcp",
        fetch: createNativeMcpHttpPoster(invoke, 5_000),
      });

      await expect(transport.sendRequest(createJsonRpcRequest("tools/call", {}, () => 8))).rejects.toMatchObject({
        message: expectedReason,
      });
    },
  );

  it("retains discovery session state before one exact structured tools/call", async () => {
    const calls: NativeMcpCall[] = [];
    const invoke = asNativeInvoke(async (command, payload) => {
      expect(command).toBe("mcp_streamable_http_request");
      const input = (payload as { input: NativeMcpCall }).input;
      calls.push(input);
      const request = JSON.parse(input.body) as { id: number; method: string };
      if (request.method === "initialize") {
        return {
          status: 200,
          contentType: "application/json",
          sessionId: "safe-session",
          body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { protocolVersion: "2025-06-18" } }),
        };
      }
      if (request.method === "tools/list") {
        return {
          status: 200,
          contentType: "application/json",
          sessionId: null,
          body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { tools: [] } }),
        };
      }
      return {
        status: 200,
        contentType: "text/event-stream",
        sessionId: null,
        body: `data: ${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { status: "dry_run", dryRun: true } })}\n\n`,
      };
    });
    const transport = new StreamableHttpTransport({
      endpoint: "http://127.0.0.1:8000/mcp",
      fetch: createNativeMcpHttpPoster(invoke, 5_000),
    });

    await transport.sendRequest(createJsonRpcRequest("initialize", {}, () => 1));
    await transport.sendRequest(createJsonRpcRequest("tools/list", {}, () => 2));
    await expect(transport.sendRequest(createJsonRpcRequest("tools/call", {}, () => 3))).resolves.toMatchObject({
      result: { status: "dry_run", dryRun: true },
    });

    expect(calls.map((call) => JSON.parse(call.body).method)).toEqual(["initialize", "tools/list", "tools/call"]);
    expect(calls.slice(1).every((call) => call.sessionId === "safe-session")).toBe(true);
  });
});
