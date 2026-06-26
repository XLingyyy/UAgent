import { describe, expect, it } from "vitest";
import {
  assertJsonRpcMessage,
  createJsonRpcNotification,
  createJsonRpcRequest,
  isJsonRpcErrorResponse,
  isJsonRpcResponse,
} from "./json-rpc.js";

describe("JSON-RPC core", () => {
  it("creates deterministic JSON-RPC 2.0 requests", () => {
    const request = createJsonRpcRequest("tools/list", { cursor: "a" }, () => 7);

    expect(request).toEqual({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/list",
      params: { cursor: "a" },
    });
  });

  it("creates JSON-RPC notifications without ids", () => {
    expect(createJsonRpcNotification("notifications/initialized")).toEqual({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
  });

  it("recognizes success and error responses", () => {
    expect(isJsonRpcResponse({ jsonrpc: "2.0", id: 1, result: {} })).toBe(true);
    expect(
      isJsonRpcErrorResponse({
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32601, message: "missing" },
      }),
    ).toBe(true);
  });

  it("rejects malformed messages with protocol errors", () => {
    expect(() => assertJsonRpcMessage({ id: 1, method: "tools/list" })).toThrow(
      /Invalid JSON-RPC message/,
    );
  });
});
