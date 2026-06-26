import { describe, expect, it, vi } from "vitest";
import type { McpTransport } from "./transport.js";
import { McpSession } from "./session.js";

function createTransport(results: Record<string, unknown>): McpTransport {
  return {
    sendRequest: vi.fn(async (request) => ({
      jsonrpc: "2.0" as const,
      id: request.id,
      result: results[request.method],
    })),
    sendNotification: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

describe("MCP session lifecycle and discovery", () => {
  it("initializes, sends initialized notification, and discovers tools/resources/prompts", async () => {
    const transport = createTransport({
      initialize: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "fixture", version: "1.0.0" },
        capabilities: { tools: {}, resources: {}, prompts: {} },
      },
      "tools/list": { tools: [{ name: "ue.selection.get" }] },
      "resources/list": { resources: [{ uri: "ue://selection/current" }] },
      "prompts/list": { prompts: [{ name: "summarize" }] },
    });
    const session = new McpSession({ transport, idFactory: () => 1, clock: () => 10 });

    const connected = await session.connect();
    const discovery = await session.discover();

    expect(connected.serverInfo.name).toBe("fixture");
    expect(transport.sendNotification).toHaveBeenCalledWith({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(discovery.capabilitySummary).toMatchObject({
      tools: 1,
      resources: 1,
      prompts: 1,
    });
  });

  it("skips tools/list when tools capability is absent", async () => {
    const transport = createTransport({
      initialize: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "no-tools", version: "1.0.0" },
        capabilities: { resources: {}, prompts: {} },
      },
      "resources/list": { resources: [{ uri: "ue://selection/current" }] },
      "prompts/list": { prompts: [{ name: "summarize" }] },
    });
    const session = new McpSession({ transport, idFactory: () => 1, clock: () => 10 });

    await session.connect();
    const discovery = await session.discover();

    expect(discovery.capabilitySummary).toMatchObject({ tools: 0, resources: 1, prompts: 1 });
    const allMethods = (
      transport.sendRequest as ReturnType<typeof vi.fn>
    ).mock.calls.map((call: unknown[]) => (call[0] as { method: string }).method);
    expect(allMethods).not.toContain("tools/list");
    expect(allMethods).toContain("resources/list");
    expect(allMethods).toContain("prompts/list");
  });

  it("skips resources/list when resources capability is absent", async () => {
    const transport = createTransport({
      initialize: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "no-resources", version: "1.0.0" },
        capabilities: { tools: {}, prompts: {} },
      },
      "tools/list": { tools: [{ name: "ue.selection.get" }] },
      "prompts/list": { prompts: [{ name: "summarize" }] },
    });
    const session = new McpSession({ transport, idFactory: () => 1, clock: () => 10 });

    await session.connect();
    const discovery = await session.discover();

    expect(discovery.capabilitySummary).toMatchObject({ tools: 1, resources: 0, prompts: 1 });
    const allMethods2 = (
      transport.sendRequest as ReturnType<typeof vi.fn>
    ).mock.calls.map((call: unknown[]) => (call[0] as { method: string }).method);
    expect(allMethods2).not.toContain("resources/list");
  });

  it("skips prompts/list when prompts capability is absent", async () => {
    const transport = createTransport({
      initialize: {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "no-prompts", version: "1.0.0" },
        capabilities: { tools: {}, resources: {} },
      },
      "tools/list": { tools: [{ name: "ue.selection.get" }] },
      "resources/list": { resources: [{ uri: "ue://selection/current" }] },
    });
    const session = new McpSession({ transport, idFactory: () => 1, clock: () => 10 });

    await session.connect();
    const discovery = await session.discover();

    expect(discovery.capabilitySummary).toMatchObject({ tools: 1, resources: 1, prompts: 0 });
    const allMethods3 = (
      transport.sendRequest as ReturnType<typeof vi.fn>
    ).mock.calls.map((call: unknown[]) => (call[0] as { method: string }).method);
    expect(allMethods3).not.toContain("prompts/list");
  });

  it("supports pagination when server returns nextCursor", async () => {
    const sendRequest = vi.fn();
    sendRequest.mockImplementation(async (request: { method: string; params?: { cursor?: string } }) => {
      if (request.method === "initialize") {
        return {
          jsonrpc: "2.0" as const,
          id: 1,
          result: {
            protocolVersion: "2025-06-18",
            serverInfo: { name: "pagination-test", version: "1.0.0" },
            capabilities: { tools: {}, resources: {} },
          },
        };
      }
      if (request.method === "tools/list") {
        const cursor = request.params?.cursor;
        if (!cursor) {
          return { jsonrpc: "2.0" as const, id: 1, result: { tools: [{ name: "tool-a" }], nextCursor: "page2" } };
        }
        return { jsonrpc: "2.0" as const, id: 1, result: { tools: [{ name: "tool-b" }] } };
      }
      return { jsonrpc: "2.0" as const, id: 1, result: { resources: [], prompts: [] } };
    });
    const transport: McpTransport = {
      sendRequest,
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const session = new McpSession({
      transport,
      idFactory: () => 1,
      clock: () => 10,
    });

    await session.connect();
    const discovery = await session.discover();

    expect(discovery.capabilitySummary.tools).toBe(2);
    expect(discovery.tools).toHaveLength(2);
  });
});
