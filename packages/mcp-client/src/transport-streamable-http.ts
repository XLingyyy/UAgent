import { McpProtocolError, McpTransportError } from "./errors.js";
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcResponse } from "./json-rpc.js";
import { assertJsonRpcMessage, isJsonRpcResponse } from "./json-rpc.js";
import { assertLocalMcpEndpoint, type McpTransport, type McpTransportOptions } from "./transport.js";

export interface StreamableHttpTransportOptions extends McpTransportOptions {
  fetch?: typeof fetch;
  idFactory?: () => string | number | null;
  protocolVersion?: string;
}

export class StreamableHttpTransport implements McpTransport {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly protocolVersion: string;
  private sessionId: string | null = null;

  constructor(options: StreamableHttpTransportOptions) {
    assertLocalMcpEndpoint(options.endpoint, options.allowRemoteEndpoint);
    this.endpoint = options.endpoint;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.protocolVersion = options.protocolVersion ?? "2025-06-18";
  }

  async sendRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const response = await this.postMessage(request);
    const sessionId = response.headers.get("Mcp-Session-Id");
    if (sessionId) {
      this.sessionId = sessionId;
    }
    const message = await parseJsonRpcHttpResponse(response);
    if (!isJsonRpcResponse(message)) {
      throw new McpProtocolError("MCP HTTP response did not contain a JSON-RPC response.");
    }
    return message;
  }

  async sendNotification(notification: JsonRpcNotification): Promise<void> {
    await this.postMessage(notification);
  }

  async close(): Promise<void> {
    this.sessionId = null;
  }

  private async postMessage(message: JsonRpcRequest | JsonRpcNotification): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": this.protocolVersion,
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }

    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(message),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new McpTransportError(
          `MCP HTTP request failed with status ${response.status}.`,
          response.status,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof McpTransportError) {
        throw error;
      }
      const aborted = error instanceof DOMException && error.name === "AbortError";
      throw new McpTransportError(aborted ? "MCP HTTP request timed out." : "MCP HTTP request failed.", undefined, error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function parseJsonRpcHttpResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get("Content-Type") ?? "";
  const text = await response.text();
  try {
    const message = contentType.includes("text/event-stream")
      ? parseFirstSseJsonMessage(text)
      : JSON.parse(text);
    assertJsonRpcMessage(message);
    return message;
  } catch (error) {
    if (error instanceof McpProtocolError) {
      throw error;
    }
    throw new McpProtocolError("Malformed JSON-RPC HTTP response.", error);
  }
}

export function parseFirstSseJsonMessage(text: string): unknown {
  const blocks = text.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (data) {
      return JSON.parse(data);
    }
  }
  throw new McpProtocolError("SSE response did not include a JSON-RPC message.");
}
