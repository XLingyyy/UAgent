import { describe, expect, it, vi } from "vitest";
import { McpDiscoveryService } from "./discovery.js";
import type { McpTransport } from "./transport.js";

describe("McpDiscoveryService tool descriptors", () => {
  it("preserves outputSchema exactly across paginated tools/list discovery", async () => {
    const firstOutputSchema = {
      dryRunSchema: { type: "object", properties: { dryRun: { const: true } } },
      rollbackContract: { type: "reverse_operation" },
      affectedAssetsSchema: { type: "array" },
      evidenceQuery: { type: "read_only" },
    };
    const secondOutputSchema = {
      "x-uagent-contract": {
        dryRunSchema: { type: "object" },
        rollbackContract: { type: "reverse_operation" },
        affectedAssetsSchema: { type: "array" },
        evidenceQuery: { type: "read_only" },
      },
    };
    const sendRequest = vi.fn(async (request: Parameters<McpTransport["sendRequest"]>[0]) => {
      const params = request.params as Record<string, unknown> | undefined;
      return {
        jsonrpc: "2.0" as const,
        id: request.id,
        result: typeof params?.cursor === "string"
          ? {
              tools: [{ name: "ue.asset.save", inputSchema: { type: "object" }, outputSchema: secondOutputSchema }],
            }
          : {
              tools: [{ name: "ue.asset.create_folder", inputSchema: { type: "object" }, outputSchema: firstOutputSchema }],
              nextCursor: "page-2",
            },
      };
    });
    const transport: McpTransport = {
      sendRequest,
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };

    const tools = await new McpDiscoveryService({ transport }).listTools();

    expect(tools.map((tool) => tool.name)).toEqual(["ue.asset.create_folder", "ue.asset.save"]);
    expect(tools[0]?.outputSchema).toEqual(firstOutputSchema);
    expect(tools[1]?.outputSchema).toEqual(secondOutputSchema);
    expect(sendRequest).toHaveBeenCalledTimes(2);
  });
});
