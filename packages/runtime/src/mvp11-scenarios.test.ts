import { describe, expect, it } from "vitest";
import { runMvp11ScenarioMatrix } from "./index.js";

describe("MVP11 scenario matrix", () => {
  it("covers shared contracts, parsers, diagnostics, MCP, UI store, replay, and redaction", () => {
    const result = runMvp11ScenarioMatrix();

    expect(result.totalAssertions).toBeGreaterThanOrEqual(100);
    expect(result.scenarios.length).toBeGreaterThanOrEqual(25);
    expect(result.scenarios.every((scenario) => scenario.pass)).toBe(true);
    expect(result.scenarios.map((scenario) => scenario.name)).toContain("mvp11-replay-no-side-effects");
    expect(result.scenarios.find((scenario) => scenario.name === "mvp11-replay-no-side-effects")?.summary).toContain(
      "replayed",
    );
    expect(result.scenarios.find((scenario) => scenario.name === "mvp11-mcp-readonly")?.summary).toContain(
      "mutating calls: 0",
    );
    expect(result.scenarios.find((scenario) => scenario.name === "mvp11-provider-live-off")?.summary).toContain(
      "provider calls: 0",
    );
    expect(JSON.stringify(result)).not.toContain("C:/Users/");
    expect(JSON.stringify(result)).not.toContain("/Users/");
    expect(JSON.stringify(result)).not.toContain("/home/");
    expect(JSON.stringify(result)).not.toContain("sk-");
  });
});
