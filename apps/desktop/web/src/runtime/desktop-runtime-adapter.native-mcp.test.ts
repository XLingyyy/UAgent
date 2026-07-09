import { describe, expect, it, vi } from "vitest";
import { createDesktopRuntimeAdapter } from "./desktop-runtime-adapter";
import type { NativeInvoke } from "./project-native-adapter";

type NativeMcpCall = {
  endpoint: string;
  body: string;
  protocolVersion?: string;
  sessionId?: string | null;
  timeoutMs?: number;
};

describe("DesktopRuntimeAdapter native MCP bridge", () => {
  it("connects and discovers through native MCP HTTP while preserving the session id", async () => {
    const calls: NativeMcpCall[] = [];
    const nativeInvokeMock = vi.fn(async (command: string, payload?: unknown): Promise<unknown> => {
      if (command === "terminal_capability_status") {
        return { enabled: false, mode: "disabled", reason: "test_disabled" };
      }
      if (command === "browser_capability_status") {
        return { enabled: false, mode: "disabled", reason: "test_disabled" };
      }
      expect(command).toBe("mcp_streamable_http_request");
      const input = (payload as { input: NativeMcpCall }).input;
      calls.push(input);
      const request = JSON.parse(input.body) as { id?: string | number | null; method: string };

      if (request.method === "initialize") {
        return {
          status: 200,
          contentType: "application/json",
          sessionId: "native-session-1",
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              protocolVersion: "2025-06-18",
              serverInfo: { name: "UE MCP", version: "5.8" },
              capabilities: { tools: {}, resources: {}, prompts: {} },
            },
          }),
        };
      }

      expect(input.sessionId).toBe("native-session-1");
      if (request.method === "notifications/initialized") {
        return { status: 202, contentType: "application/json", sessionId: null, body: "" };
      }
      if (request.method === "tools/list") {
        return {
          status: 200,
          contentType: "application/json",
          sessionId: null,
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: request.id,
            result: { tools: [{ name: "list_toolsets", description: "List UE toolsets" }] },
          }),
        };
      }
      if (request.method === "resources/list") {
        return {
          status: 200,
          contentType: "application/json",
          sessionId: null,
          body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { resources: [] } }),
        };
      }
      if (request.method === "prompts/list") {
        return {
          status: 200,
          contentType: "application/json",
          sessionId: null,
          body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result: { prompts: [] } }),
        };
      }

      throw new Error(`Unexpected MCP method: ${request.method}`);
    });
    const nativeInvoke: NativeInvoke = <T = unknown>(command: string, payload?: unknown) =>
      nativeInvokeMock(command, payload) as Promise<T>;

    const adapter = createDesktopRuntimeAdapter({ nativeInvoke });
    adapter.setMcpEndpoint("http://127.0.0.1:8000/mcp");

    await adapter.connectMcp();
    await adapter.discoverMcp();

    expect(adapter.getMcpState()).toMatchObject({
      status: "connected",
      protocolVersion: "2025-06-18",
      serverInfo: { name: "UE MCP", version: "5.8" },
      capabilities: {
        tools: 1,
        resources: 0,
        prompts: 0,
      },
    });
    expect(calls.map((call) => JSON.parse(call.body).method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
      "resources/list",
      "prompts/list",
    ]);
    expect(calls[0]).toMatchObject({
      endpoint: "http://127.0.0.1:8000/mcp",
      protocolVersion: "2025-06-18",
      sessionId: null,
      timeoutMs: 5000,
    });
    expect(calls.slice(1).every((call) => call.sessionId === "native-session-1")).toBe(true);
  });

  it("rejects non-local endpoints before calling the native MCP bridge", async () => {
    const nativeInvokeMock = vi.fn(async (command: string, _payload?: unknown): Promise<unknown> => {
      if (command === "terminal_capability_status" || command === "browser_capability_status") {
        return { enabled: false, mode: "disabled", reason: "test_disabled" };
      }
      throw new Error("native bridge should not be called");
    });
    const nativeInvoke: NativeInvoke = <T = unknown>(command: string, payload?: unknown) =>
      nativeInvokeMock(command, payload) as Promise<T>;
    const adapter = createDesktopRuntimeAdapter({ nativeInvoke });
    adapter.setMcpEndpoint("https://example.com/mcp");

    await adapter.connectMcp();

    expect(adapter.getMcpState()).toMatchObject({
      status: "error",
      lastError: "Only localhost MCP endpoints are allowed in MVP2.",
    });
    expect(nativeInvokeMock.mock.calls.some(([command]) => command === "mcp_streamable_http_request")).toBe(false);
  });
});
