import { describe, expect, it } from "vitest";
import { classifyMcpToolRisk } from "./mcp-readonly-policy.js";
import { createSemanticCapabilityIndex } from "./mcp-semantic-index.js";

describe("MCP read-only risk policy", () => {
  it("blocks write-like tools by name even when annotations claim read-only", () => {
    expect(
      classifyMcpToolRisk({
        name: "ue.asset.delete",
        annotations: { readOnlyHint: true },
      }),
    ).toMatchObject({
      level: "blocked",
      matchedKeyword: "delete",
    });
  });

  it("blocks unknown tools by default", () => {
    expect(classifyMcpToolRisk({ name: "ue.magic" })).toMatchObject({ level: "unknown" });
  });

  it("allows explicit semantic read-only tools", () => {
    expect(classifyMcpToolRisk({ name: "ue.selection.get" })).toMatchObject({
      level: "read_only",
    });
  });
});

describe("MCP semantic capability index", () => {
  it("maps current selection requests to read-only resources before tools", () => {
    const index = createSemanticCapabilityIndex({
      tools: [{ name: "ue.selection.get" }],
      resources: [{ uri: "ue://selection/current", name: "Current selection" }],
      prompts: [],
      capabilitySummary: {
        tools: 1,
        resources: 1,
        prompts: 0,
        readOnlyTools: 1,
        blockedTools: 0,
      },
      discoveredAt: 1,
    });

    expect(index.resolveIntent("检查当前选择")).toMatchObject({
      kind: "resource",
      uri: "ue://selection/current",
    });
  });
});
