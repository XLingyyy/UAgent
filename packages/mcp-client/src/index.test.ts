import { describe, it, expect } from "vitest";
import type { McpServerProfile, ConnectionSummary } from "./index.js";

describe("@uagent/mcp-client types", () => {
  it("should default UE profile to Streamable HTTP transport", () => {
    const profile: McpServerProfile = {
      id: "ue58",
      name: "Unreal Engine 5.8",
      version: "1.0.0",
      transport: "streamable-http",
      status: "disconnected",
      capabilities: [],
      lastSeen: null,
    };
    expect(profile.name).toBe("Unreal Engine 5.8");
    expect(profile.transport).toBe("streamable-http");
  });

  it("should support legacy HTTP + SSE compat for UE profile", () => {
    const legacy: McpServerProfile = {
      id: "ue58-legacy",
      name: "Unreal Engine 5.8 (legacy)",
      version: "1.0.0",
      transport: "http-sse",
      status: "disconnected",
      capabilities: [],
      lastSeen: null,
    };
    expect(legacy.transport).toBe("http-sse");
  });

  it("should keep stdio only for non-Unreal generic MCP profiles", () => {
    const generic: McpServerProfile<"stdio"> = {
      id: "local-cli",
      name: "Local CLI MCP",
      version: "0.1.0",
      transport: "stdio",
      status: "disconnected",
      capabilities: [],
      lastSeen: null,
    };
    expect(generic.transport).toBe("stdio");
  });

  it("should match ConnectionSummary shape", () => {
    const summary: ConnectionSummary = {
      serverId: "ue58",
      connectedAt: Date.now(),
      disconnectedAt: null,
      toolsDiscovered: 5,
      promptsDiscovered: 0,
      resourcesDiscovered: 2,
      errors: [],
    };
    expect(summary.toolsDiscovered).toBe(5);
  });
});
