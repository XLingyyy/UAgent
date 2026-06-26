import { McpProtocolError, McpTransportError } from "./errors.js";
import type { JsonRpcNotification, JsonRpcRequest, JsonRpcResponse } from "./json-rpc.js";
import { assertJsonRpcMessage, isJsonRpcResponse } from "./json-rpc.js";
import { assertLocalMcpEndpoint, type McpTransport, type McpTransportOptions } from "./transport.js";

export interface LegacySseTransportOptions extends McpTransportOptions {
  fetch?: typeof fetch;
}

export class LegacySseTransport implements McpTransport {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private postEndpoint: string | null = null;

  constructor(options: LegacySseTransportOptions) {
    assertLocalMcpEndpoint(options.endpoint, options.allowRemoteEndpoint);
    this.endpoint = options.endpoint;
    this.fetchImpl = options.fetch ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async sendRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    const response = await this.postMessage(request);
    const text = await response.text();
    try {
      const message = JSON.parse(text);
      assertJsonRpcMessage(message);
      if (!isJsonRpcResponse(message)) {
        throw new McpProtocolError("Legacy MCP POST did not return a JSON-RPC response.");
      }
      return message;
    } catch (error) {
      if (error instanceof McpProtocolError) {
        throw error;
      }
      throw new McpProtocolError("Malformed legacy MCP JSON response.", error);
    }
  }

  async sendNotification(notification: JsonRpcNotification): Promise<void> {
    await this.postMessage(notification);
  }

  async close(): Promise<void> {
    this.postEndpoint = null;
  }

  private async ensurePostEndpoint(): Promise<string> {
    if (this.postEndpoint) {
      return this.postEndpoint;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "GET",
        headers: { Accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new McpTransportError(`Legacy SSE connect failed with status ${response.status}.`, response.status);
      }
      const endpoint = parseLegacyEndpointEvent(await response.text());
      this.postEndpoint = new URL(endpoint, this.endpoint).toString();
      return this.postEndpoint;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async postMessage(message: JsonRpcRequest | JsonRpcNotification): Promise<Response> {
    const endpoint = await this.ensurePostEndpoint();
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "MCP-Protocol-Version": "2025-06-18",
      },
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      throw new McpTransportError(`Legacy MCP POST failed with status ${response.status}.`, response.status);
    }
    return response;
  }
}

export function parseLegacyEndpointEvent(text: string): string {
  const blocks = text.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const lines = block.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = lines.find((line) => line.startsWith("data:"))?.slice(5).trim();
    if (event === "endpoint" && data) {
      return data;
    }
  }
  throw new McpProtocolError("Legacy SSE stream did not include an endpoint event.");
}
