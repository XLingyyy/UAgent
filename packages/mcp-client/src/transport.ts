import type {
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./json-rpc.js";

export interface McpTransport {
  sendRequest(request: JsonRpcRequest): Promise<JsonRpcResponse>;
  sendNotification(notification: JsonRpcNotification): Promise<void>;
  close(): Promise<void>;
}

export interface McpTransportOptions {
  endpoint: string;
  allowRemoteEndpoint?: boolean;
  timeoutMs?: number;
}

export function assertLocalMcpEndpoint(endpoint: string, allowRemoteEndpoint = false): void {
  if (allowRemoteEndpoint) {
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch (error) {
    throw new Error("MCP endpoint must be a valid URL.");
  }

  const host = parsed.hostname.toLowerCase();
  const isLocalhost = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (!isLocalhost) {
    throw new Error("Only localhost MCP endpoints are allowed by default.");
  }
}
