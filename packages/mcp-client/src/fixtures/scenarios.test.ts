import { describe, expect, it } from "vitest";
import { createMcpFixtureScenario } from "./mcp-fixture-engine.js";
import { createLongrunMcpScenarioCorpus } from "./scenarios.js";
import { createJsonRpcRequest } from "../json-rpc.js";

describe("LONGRUN MCP fixture scenario corpus", () => {
  it("provides at least twelve named reusable scenarios", () => {
    const corpus = createLongrunMcpScenarioCorpus();

    expect(corpus.map((scenario) => scenario.name)).toEqual([
      "success",
      "pagination",
      "no-tools",
      "no-resources",
      "malformed",
      "timeout",
      "jsonrpc-error",
      "legacy-fallback",
      "blocked-tools",
      "unknown-tools",
      "disconnect",
      "non-local-denied",
    ]);
  });

  it("allows every scenario to instantiate a fixture engine", async () => {
    for (const definition of createLongrunMcpScenarioCorpus()) {
      const scenario = createMcpFixtureScenario(definition.options);
      if (definition.name === "timeout") {
        await expect(scenario.handleJsonRpc(createJsonRpcRequest("tools/list", {}, () => definition.name))).rejects.toThrow(
          "MCP fixture timeout",
        );
      } else {
        await scenario.handleJsonRpc(createJsonRpcRequest("initialize", {}, () => definition.name)).catch(() => null);
      }
      expect(scenario.requests.length).toBeGreaterThanOrEqual(1);
    }
  });
});
