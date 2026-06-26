export type UnrealMcpTransport = "streamable-http" | "http-sse";

export type McpTransport = "stdio" | UnrealMcpTransport;

export interface McpServerProfile<T extends McpTransport = UnrealMcpTransport> {
  id: string;
  name: string;
  version: string;
  transport: T;
  status: "disconnected" | "connecting" | "connected" | "error";
  capabilities: McpCapability[];
  lastSeen: number | null;
}

export interface McpCapability {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ConnectionSummary {
  serverId: string;
  connectedAt: number;
  disconnectedAt: number | null;
  toolsDiscovered: number;
  promptsDiscovered: number;
  resourcesDiscovered: number;
  errors: string[];
}

export type DiscoveryMode = "manual" | "auto" | "lazy";

export interface DiscoveryConfig {
  mode: DiscoveryMode;
  pollIntervalMs: number;
  autoConnect: boolean;
}

export type {
  JsonRpcError,
  JsonRpcErrorResponse,
  JsonRpcId,
  JsonRpcIdFactory,
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcSuccessResponse,
} from "./json-rpc.js";
export {
  assertJsonRpcMessage,
  createJsonRpcNotification,
  createJsonRpcRequest,
  isJsonRpcErrorResponse,
  isJsonRpcResponse,
} from "./json-rpc.js";
export { McpClientError, McpProtocolError, McpTransportError } from "./errors.js";
export type { McpTransport as McpTransportClient, McpTransportOptions } from "./transport.js";
export { assertLocalMcpEndpoint } from "./transport.js";
export { StreamableHttpTransport, parseFirstSseJsonMessage } from "./transport-streamable-http.js";
export { LegacySseTransport, parseLegacyEndpointEvent } from "./transport-legacy-sse.js";
export { McpDiscoveryService } from "./discovery.js";
export { McpSession, type McpInitializeResult, type McpSessionOptions } from "./session.js";
