import type { McpFixtureScenarioOptions } from "./mcp-fixture-types.js";

export interface NamedMcpFixtureScenario {
  name: string;
  options: McpFixtureScenarioOptions;
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

function initializeResult(capabilities: Record<string, unknown>) {
  return {
    protocolVersion: "2025-06-18",
    serverInfo: { name: "longrun-corpus", version: "1.0.0" },
    capabilities,
  };
}
