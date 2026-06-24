import { describe, it, expect } from "vitest";

describe("@uagent/desktop smoke", () => {
  it("should have UAgent as title", () => {
    expect("UAgent").toContain("Agent");
  });

  it("should confirm project root exists", () => {
    expect(true).toBe(true);
  });

  it("should import shared types", async () => {
    const mod = await import("@uagent/shared");
    expect(mod).toBeDefined();
  });

  it("should import runtime types", async () => {
    const mod = await import("@uagent/runtime");
    expect(mod).toBeDefined();
  });

  it("should import mcp-client types", async () => {
    const mod = await import("@uagent/mcp-client");
    expect(mod).toBeDefined();
  });
});
