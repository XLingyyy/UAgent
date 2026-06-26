import type { JsonRpcRequest, JsonRpcResponse } from "../json-rpc.js";
import type {
  McpFixtureRequestLogEntry,
  McpFixtureRouteHandler,
  McpFixtureRouteResult,
  McpFixtureScenario,
  McpFixtureScenarioOptions,
} from "./mcp-fixture-types.js";

const DEFAULT_INITIALIZE_RESULT = {
  protocolVersion: "2025-06-18",
  serverInfo: { name: "uagent-fixture", version: "1.0.0" },
  capabilities: { tools: {}, resources: {}, prompts: {} },
};

export function createMcpFixtureScenario(options: McpFixtureScenarioOptions = {}): McpFixtureScenario {
  const requests: McpFixtureRequestLogEntry[] = [];
  const clock = options.clock ?? (() => requests.length + 1);
  const routes = options.routes ?? {};

  return {
    get requests() {
      return requests;
    },
    async handleJsonRpc(message, metadata) {
      if (!("method" in message)) {
        throw new Error("MCP fixture only handles JSON-RPC requests and notifications.");
      }

      const notification = !("id" in message);
      requests.push({
        id: "id" in message ? message.id : undefined,
        method: message.method,
        params: message.params,
        notification,
        receivedAt: clock(),
        headers: metadata?.headers,
        url: metadata?.url,
      });

      if (notification) {
        return null;
      }

      const request = message as JsonRpcRequest;
      const route = resolveRoute(routes[request.method], request, requests);
      if (route.timeout) {
        throw new Error("MCP fixture timeout");
      }
      if ("malformed" in route) {
        return route.malformed;
      }
      if (route.error) {
        return {
          jsonrpc: "2.0",
          id: request.id,
          error: route.error,
        };
      }
      return {
        jsonrpc: "2.0",
        id: request.id,
        result: route.result,
      } satisfies JsonRpcResponse;
    },
    findRequests(method) {
      return requests.filter((request) => request.method === method);
    },
  };
}

function resolveRoute(
  handler: McpFixtureRouteHandler | undefined,
  request: JsonRpcRequest,
  requests: readonly McpFixtureRequestLogEntry[],
): McpFixtureRouteResult {
  if (typeof handler === "function") {
    return handler({ request, requests });
  }
  if (handler) {
    return handler;
  }
  return { result: defaultResultFor(request.method) };
}

function defaultResultFor(method: string): unknown {
  switch (method) {
    case "initialize":
      return DEFAULT_INITIALIZE_RESULT;
    case "tools/list":
      return { tools: [] };
    case "resources/list":
      return { resources: [] };
    case "prompts/list":
      return { prompts: [] };
    case "resources/read":
      return { contents: [] };
    case "tools/call":
      return { content: [] };
    default:
      return {};
  }
}
