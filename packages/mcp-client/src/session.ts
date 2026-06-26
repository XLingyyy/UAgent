import type { McpConnectionState, McpServerInfo } from "@uagent/shared";
import { createJsonRpcNotification, createJsonRpcRequest, isJsonRpcErrorResponse, type JsonRpcIdFactory } from "./json-rpc.js";
import { McpProtocolError } from "./errors.js";
import { McpDiscoveryService } from "./discovery.js";
import type { McpTransport } from "./transport.js";

export interface McpSessionOptions {
  transport: McpTransport;
  idFactory?: JsonRpcIdFactory;
  clock?: () => number;
  clientInfo?: McpServerInfo;
  protocolVersion?: string;
}

export interface McpInitializeResult {
  protocolVersion: string;
  serverInfo: McpServerInfo;
  capabilities: Record<string, unknown>;
}

export class McpSession {
  private readonly transport: McpTransport;
  private readonly idFactory?: JsonRpcIdFactory;
  private readonly clock: () => number;
  private readonly clientInfo: McpServerInfo;
  private readonly protocolVersion: string;
  private initialized = false;
  private initializeResult: McpInitializeResult | null = null;

  constructor(options: McpSessionOptions) {
    this.transport = options.transport;
    this.idFactory = options.idFactory;
    this.clock = options.clock ?? Date.now;
    this.clientInfo = options.clientInfo ?? { name: "UAgent", version: "0.0.1" };
    this.protocolVersion = options.protocolVersion ?? "2025-06-18";
  }

  async connect(): Promise<McpInitializeResult> {
    const response = await this.transport.sendRequest(
      createJsonRpcRequest(
        "initialize",
        {
          protocolVersion: this.protocolVersion,
          capabilities: {},
          clientInfo: this.clientInfo,
        },
        this.idFactory,
      ),
    );
    if (isJsonRpcErrorResponse(response)) {
      throw new McpProtocolError(`MCP initialize failed: ${response.error.message}`);
    }
    const result = response.result as McpInitializeResult;
    if (!result.protocolVersion || !result.serverInfo) {
      throw new McpProtocolError("MCP initialize response missing protocolVersion or serverInfo.");
    }
    await this.transport.sendNotification(createJsonRpcNotification("notifications/initialized"));
    this.initialized = true;
    this.initializeResult = result;
    return result;
  }

  async discover() {
    if (!this.initialized) {
      throw new McpProtocolError("MCP discovery cannot run before initialize.");
    }
    return new McpDiscoveryService({
      transport: this.transport,
      idFactory: this.idFactory,
      clock: this.clock,
    }).discover(this.initializeResult?.capabilities);
  }

  getConnectionState(): McpConnectionState {
    return {
      status: this.initialized ? "connected" : "disconnected",
      profile: null,
      protocolVersion: this.initializeResult?.protocolVersion ?? null,
      serverInfo: this.initializeResult?.serverInfo ?? null,
      capabilities: null,
      lastError: null,
      legacyMode: false,
    };
  }

  async readResource(uri: string): Promise<unknown> {
    if (!this.initialized) {
      throw new McpProtocolError("MCP resources/read cannot be called before initialize.");
    }
    const response = await this.transport.sendRequest(
      createJsonRpcRequest("resources/read", { uri }, this.idFactory),
    );
    if (isJsonRpcErrorResponse(response)) {
      throw new McpProtocolError(`MCP resources/read failed: ${response.error.message}`);
    }
    return response.result;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.initialized) {
      throw new McpProtocolError("MCP tools/call cannot be called before initialize.");
    }
    const response = await this.transport.sendRequest(
      createJsonRpcRequest("tools/call", { name, arguments: args }, this.idFactory),
    );
    if (isJsonRpcErrorResponse(response)) {
      throw new McpProtocolError(`MCP tools/call failed: ${response.error.message}`);
    }
    return response.result;
  }

  async disconnect(): Promise<void> {
    this.initialized = false;
    this.initializeResult = null;
    await this.transport.close();
  }
}
