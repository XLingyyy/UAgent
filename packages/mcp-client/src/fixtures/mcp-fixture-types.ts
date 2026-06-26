import type { JsonRpcId, JsonRpcMessage, JsonRpcRequest, JsonRpcResponse } from "../json-rpc.js";

export interface McpFixtureRequestLogEntry {
  id?: JsonRpcId;
  method: string;
  params?: unknown;
  notification: boolean;
  receivedAt: number;
  headers?: Record<string, string>;
  url?: string;
}

export interface McpFixtureRouteContext {
  request: JsonRpcRequest;
  requests: readonly McpFixtureRequestLogEntry[];
}

export interface McpFixtureRouteResult {
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
  malformed?: unknown;
  timeout?: boolean;
}

export type McpFixtureRouteHandler =
  | McpFixtureRouteResult
  | ((context: McpFixtureRouteContext) => McpFixtureRouteResult);

export interface McpFixtureScenarioOptions {
  routes?: Record<string, McpFixtureRouteHandler>;
  clock?: () => number;
}

export interface McpFixtureScenario {
  readonly requests: readonly McpFixtureRequestLogEntry[];
  handleJsonRpc(message: JsonRpcMessage, metadata?: { headers?: Record<string, string>; url?: string }): Promise<JsonRpcResponse | unknown | null>;
  findRequests(method: string): McpFixtureRequestLogEntry[];
}
