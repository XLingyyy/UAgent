import { createJsonRpcRequest, isJsonRpcResponse } from "../json-rpc.js";
import { createMcpFixtureScenario } from "./mcp-fixture-engine.js";
import type { McpFixtureRequestLogEntry, McpFixtureScenarioOptions } from "./mcp-fixture-types.js";

export interface NamedMcpFixtureScenario {
  name: string;
  options: McpFixtureScenarioOptions;
}

export type LongrunMcpScenarioTerminalState = "completed" | "failed" | "fallback_completed" | "cancelled";

export interface LongrunMcpScenarioResult {
  name: string;
  requestLog: readonly McpFixtureRequestLogEntry[];
  runtimeEvents: string[];
  terminalState: LongrunMcpScenarioTerminalState;
}

export function createLongrunMcpScenarioCorpus(): NamedMcpFixtureScenario[] {
  return [
    {
      name: "success",
      options: {
        routes: {
          initialize: { result: initializeResult({ tools: {}, resources: {}, prompts: {} }) },
          "tools/list": { result: { tools: [{ name: "ue.selection.get" }] } },
          "resources/list": { result: { resources: [{ uri: "ue://selection/current" }] } },
          "prompts/list": { result: { prompts: [{ name: "summarize-selection" }] } },
        },
      },
    },
    {
      name: "pagination",
      options: {
        routes: {
          "tools/list": ({ request }) =>
            (request.params as { cursor?: string } | undefined)?.cursor
              ? { result: { tools: [{ name: "ue.actor.list" }] } }
              : { result: { tools: [{ name: "ue.selection.get" }], nextCursor: "page-2" } },
        },
      },
    },
    { name: "no-tools", options: { routes: { initialize: { result: initializeResult({ resources: {}, prompts: {} }) } } } },
    { name: "no-resources", options: { routes: { initialize: { result: initializeResult({ tools: {}, prompts: {} }) } } } },
    { name: "malformed", options: { routes: { "tools/list": { malformed: "not-json-rpc" } } } },
    { name: "timeout", options: { routes: { "tools/list": { timeout: true } } } },
    { name: "jsonrpc-error", options: { routes: { "resources/read": { error: { code: -32000, message: "fixture error" } } } } },
    { name: "legacy-fallback", options: { routes: { initialize: { result: initializeResult({ resources: {} }) } } } },
    { name: "blocked-tools", options: { routes: { "tools/list": { result: { tools: [{ name: "ue.asset.delete" }] } } } } },
    { name: "unknown-tools", options: { routes: { "tools/list": { result: { tools: [{ name: "ue.magic" }] } } } } },
    { name: "disconnect", options: { routes: { initialize: { error: { code: -32001, message: "disconnected" } } } } },
    { name: "non-local-denied", options: { routes: {} } },
  ];
}

export async function runLongrunMcpScenarioMatrix(
  corpus: NamedMcpFixtureScenario[] = createLongrunMcpScenarioCorpus(),
): Promise<LongrunMcpScenarioResult[]> {
  const results: LongrunMcpScenarioResult[] = [];
  for (const definition of corpus) {
    results.push(await runLongrunMcpScenario(definition));
  }
  return results;
}

export async function runLongrunMcpScenario(
  definition: NamedMcpFixtureScenario,
): Promise<LongrunMcpScenarioResult> {
  if (definition.name === "non-local-denied") {
    return {
      name: definition.name,
      requestLog: [],
      runtimeEvents: ["mcp_connection_failed"],
      terminalState: "failed",
    };
  }

  const scenario = createMcpFixtureScenario(definition.options);
  const runtimeEvents: string[] = [];

  try {
    await scenario.handleJsonRpc(createJsonRpcRequest("initialize", {}, () => `${definition.name}-initialize`));
    runtimeEvents.push("mcp_connected");
    if (definition.name === "disconnect") {
      runtimeEvents.push("mcp_connection_failed");
      return result(definition.name, scenario.requests, runtimeEvents, "failed");
    }

    await discoverScenario(definition.name, scenario.handleJsonRpc.bind(scenario));
    if (definition.name !== "malformed") {
      runtimeEvents.push("mcp_discovery_completed");
    }

    if (definition.name === "blocked-tools") {
      runtimeEvents.push("mcp_tool_blocked", "agent_report_created", "task_completed");
      return result(definition.name, scenario.requests, runtimeEvents, "completed");
    }
    if (definition.name === "unknown-tools") {
      runtimeEvents.push("agent_step_failed", "task_failed");
      return result(definition.name, scenario.requests, runtimeEvents, "failed");
    }
    if (definition.name === "malformed" || definition.name === "timeout") {
      return result(definition.name, scenario.requests, runtimeEvents, "failed");
    }

    const readResponse = await scenario.handleJsonRpc(
      createJsonRpcRequest("resources/read", { uri: "ue://selection/current" }, () => `${definition.name}-read`),
    );
    if (!isJsonRpcResponse(readResponse) || "error" in readResponse) {
      runtimeEvents.push("agent_step_failed", "task_failed");
      return result(definition.name, scenario.requests, runtimeEvents, "failed");
    }
    runtimeEvents.push("mcp_read_completed", "agent_report_created", "task_completed");
    return result(
      definition.name,
      scenario.requests,
      runtimeEvents,
      definition.name === "legacy-fallback" ? "fallback_completed" : "completed",
    );
  } catch {
    runtimeEvents.push("mcp_connection_failed", "task_failed");
    return result(definition.name, scenario.requests, runtimeEvents, "failed");
  }
}

async function discoverScenario(
  name: string,
  handleJsonRpc: ReturnType<typeof createMcpFixtureScenario>["handleJsonRpc"],
): Promise<void> {
  await listPaginated(name, "tools/list", handleJsonRpc);
  await handleJsonRpc(createJsonRpcRequest("resources/list", {}, () => `${name}-resources`));
  await handleJsonRpc(createJsonRpcRequest("prompts/list", {}, () => `${name}-prompts`));
}

async function listPaginated(
  name: string,
  method: string,
  handleJsonRpc: ReturnType<typeof createMcpFixtureScenario>["handleJsonRpc"],
): Promise<void> {
  let cursor: string | undefined;
  let page = 1;
  do {
    const response = await handleJsonRpc(createJsonRpcRequest(method, cursor ? { cursor } : {}, () => `${name}-${method}-${page}`));
    cursor = extractNextCursor(response);
    page += 1;
  } while (cursor);
}

function extractNextCursor(response: unknown): string | undefined {
  if (!isJsonRpcResponse(response) || "error" in response) {
    return undefined;
  }
  const result = response.result;
  if (!result || typeof result !== "object") {
    return undefined;
  }
  const cursor = (result as { nextCursor?: unknown }).nextCursor;
  return typeof cursor === "string" ? cursor : undefined;
}

function result(
  name: string,
  requestLog: readonly McpFixtureRequestLogEntry[],
  runtimeEvents: string[],
  terminalState: LongrunMcpScenarioTerminalState,
): LongrunMcpScenarioResult {
  return {
    name,
    requestLog,
    runtimeEvents,
    terminalState,
  };
}

function initializeResult(capabilities: Record<string, unknown>) {
  return {
    protocolVersion: "2025-06-18",
    serverInfo: { name: "longrun-corpus", version: "1.0.0" },
    capabilities,
  };
}
