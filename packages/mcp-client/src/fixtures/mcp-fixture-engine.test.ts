import { describe, expect, it } from "vitest";
import { createJsonRpcNotification, createJsonRpcRequest } from "../json-rpc.js";
import { createMcpFixtureScenario } from "./mcp-fixture-engine.js";

describe("MCP fixture engine", () => {
  it("records JSON-RPC requests and returns scripted success results", async () => {
    const scenario = createMcpFixtureScenario({
      routes: {
        initialize: { result: { protocolVersion: "2025-06-18", serverInfo: { name: "fixture", version: "1.0.0" }, capabilities: {} } },
      },
    });

    const response = await scenario.handleJsonRpc(createJsonRpcRequest("initialize", {}, () => 7));

    expect(response).toEqual({
      jsonrpc: "2.0",
      id: 7,
      result: { protocolVersion: "2025-06-18", serverInfo: { name: "fixture", version: "1.0.0" }, capabilities: {} },
    });
    expect(scenario.requests).toHaveLength(1);
    expect(scenario.requests[0]).toMatchObject({ method: "initialize", id: 7 });
  });

  it("records notifications without producing a response", async () => {
    const scenario = createMcpFixtureScenario();

    const response = await scenario.handleJsonRpc(createJsonRpcNotification("notifications/initialized"));

    expect(response).toBeNull();
    expect(scenario.requests).toHaveLength(1);
    expect(scenario.requests[0]).toMatchObject({ method: "notifications/initialized", notification: true });
  });

  it("returns JSON-RPC errors for scripted error routes", async () => {
    const scenario = createMcpFixtureScenario({
      routes: {
        "resources/read": { error: { code: -32001, message: "resource missing" } },
      },
    });

    await expect(
      scenario.handleJsonRpc(createJsonRpcRequest("resources/read", { uri: "ue://missing" }, () => "r1")),
    ).resolves.toMatchObject({
      jsonrpc: "2.0",
      id: "r1",
      error: { code: -32001, message: "resource missing" },
    });
  });

  it("supports route functions and request params", async () => {
    const scenario = createMcpFixtureScenario({
      routes: {
        "resources/read": ({ request }) => ({
          result: { echoed: request.params },
        }),
      },
    });

    await expect(
      scenario.handleJsonRpc(createJsonRpcRequest("resources/read", { uri: "ue://selection/current" }, () => 3)),
    ).resolves.toMatchObject({
      result: { echoed: { uri: "ue://selection/current" } },
    });
  });

  it("can inject malformed responses", async () => {
    const scenario = createMcpFixtureScenario({
      routes: {
        "tools/list": { malformed: "not-json-rpc" },
      },
    });

    await expect(
      scenario.handleJsonRpc(createJsonRpcRequest("tools/list", {}, () => 2)),
    ).resolves.toBe("not-json-rpc");
  });

  it("can inject timeout failures", async () => {
    const scenario = createMcpFixtureScenario({
      routes: {
        "tools/list": { timeout: true },
      },
    });

    await expect(
      scenario.handleJsonRpc(createJsonRpcRequest("tools/list", {}, () => 2)),
    ).rejects.toThrow("MCP fixture timeout");
  });

  it("falls back to default method results for common discovery methods", async () => {
    const scenario = createMcpFixtureScenario();

    await expect(scenario.handleJsonRpc(createJsonRpcRequest("tools/list", {}, () => 1))).resolves.toMatchObject({
      result: { tools: [] },
    });
    await expect(scenario.handleJsonRpc(createJsonRpcRequest("resources/list", {}, () => 2))).resolves.toMatchObject({
      result: { resources: [] },
    });
    await expect(scenario.handleJsonRpc(createJsonRpcRequest("prompts/list", {}, () => 3))).resolves.toMatchObject({
      result: { prompts: [] },
    });
  });

  it("filters request logs by method", async () => {
    const scenario = createMcpFixtureScenario();

    await scenario.handleJsonRpc(createJsonRpcRequest("resources/read", { uri: "ue://a" }, () => 1));
    await scenario.handleJsonRpc(createJsonRpcRequest("tools/call", { name: "ue.get" }, () => 2));

    expect(scenario.findRequests("resources/read")).toHaveLength(1);
    expect(scenario.findRequests("tools/call")).toHaveLength(1);
    expect(scenario.findRequests("tools/list")).toHaveLength(0);
  });
});
