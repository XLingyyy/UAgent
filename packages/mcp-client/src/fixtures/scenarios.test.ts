import { describe, expect, it } from "vitest";
import { createMcpFixtureScenario } from "./mcp-fixture-engine.js";
import {
  createLongrunMcpScenarioCorpus,
  runLongrunMcpScenario,
  runLongrunMcpScenarioMatrix,
} from "./scenarios.js";
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

  it("runs every LONGRUN scenario as an executable matrix with request log, runtime events, and terminal outcome", async () => {
    const results = await runLongrunMcpScenarioMatrix();

    expect(results.map((result) => result.name)).toEqual(createLongrunMcpScenarioCorpus().map((scenario) => scenario.name));
    for (const result of results) {
      if (result.name === "non-local-denied") {
        expect(result.requestLog).toEqual([]);
      } else {
        expect(result.requestLog.length).toBeGreaterThan(0);
      }
      expect(result.runtimeEvents.length).toBeGreaterThan(0);
      expect(["completed", "failed", "fallback_completed", "cancelled"]).toContain(result.terminalState);
    }
    expect(results.find((result) => result.name === "success")?.requestLog.map((entry) => entry.method)).toContain("resources/read");
    expect(results.find((result) => result.name === "pagination")?.requestLog.map((entry) => entry.method)).toEqual(
      expect.arrayContaining(["initialize", "tools/list", "resources/list", "prompts/list"]),
    );
    expect(results.find((result) => result.name === "pagination")?.requestLog.filter((entry) => entry.method === "tools/list")).toHaveLength(2);
    expect(results.find((result) => result.name === "blocked-tools")?.requestLog.filter((entry) => entry.method === "tools/call")).toEqual([]);
    expect(results.find((result) => result.name === "unknown-tools")?.requestLog.filter((entry) => entry.method === "tools/call")).toEqual([]);
    expect(results.find((result) => result.name === "malformed")?.terminalState).toBe("failed");
    expect(results.find((result) => result.name === "timeout")?.runtimeEvents).toContain("mcp_connection_failed");
    expect(results.find((result) => result.name === "legacy-fallback")?.terminalState).toBe("fallback_completed");
    expect(results.find((result) => result.name === "non-local-denied")?.requestLog).toEqual([]);
  });

  it("asserts explicit jsonrpc-error, malformed, and timeout failure semantics", async () => {
    const results = await runLongrunMcpScenarioMatrix();

    const byName = (name: string) => results.find((r) => r.name === name)!;

    const jsonrpcError = byName("jsonrpc-error");
    expect(jsonrpcError.requestLog.map((e) => e.method)).toContain("resources/read");
    expect(jsonrpcError.terminalState).toBe("failed");
    expect(jsonrpcError.runtimeEvents).toEqual(expect.arrayContaining(["agent_step_failed", "task_failed"]));
    expect(jsonrpcError.runtimeEvents).not.toContain("mcp_read_completed");
    expect(jsonrpcError.runtimeEvents).not.toContain("task_completed");

    const malformed = byName("malformed");
    expect(malformed.terminalState).toBe("failed");
    expect(malformed.runtimeEvents).not.toContain("mcp_read_completed");
    expect(malformed.runtimeEvents).not.toContain("task_completed");
    expect(malformed.runtimeEvents).not.toContain("mcp_discovery_completed");

    const timeout = byName("timeout");
    expect(timeout.terminalState).toBe("failed");
    expect(timeout.runtimeEvents).not.toContain("mcp_read_completed");
    expect(timeout.runtimeEvents).not.toContain("task_completed");

    expect(byName("blocked-tools").requestLog.filter((e) => e.method === "tools/call")).toEqual([]);
    expect(byName("unknown-tools").requestLog.filter((e) => e.method === "tools/call")).toEqual([]);
  });

  it("fails when resources/read returns a malformed non-JSON-RPC response", async () => {
    const result = await runLongrunMcpScenario({
      name: "malformed-read",
      options: {
        routes: {
          "resources/read": { malformed: "not-json-rpc" },
        },
      },
    });

    expect(result.requestLog.map((e) => e.method)).toContain("resources/read");
    expect(result.terminalState).toBe("failed");
    expect(result.runtimeEvents).toContain("agent_step_failed");
    expect(result.runtimeEvents).toContain("task_failed");
    expect(result.runtimeEvents).not.toContain("mcp_read_completed");
    expect(result.runtimeEvents).not.toContain("task_completed");
  });
});
