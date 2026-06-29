import { describe, expect, it } from "vitest";
import { parseBuildOutputToDiagnostics } from "./index.js";

describe("MVP11 build-output-parser", () => {
  it("summarizes compiler output without storing raw output or secrets", () => {
    const summary = parseBuildOutputToDiagnostics({
      output: [
        "C:/Users/Alice/Lyra/Source/Foo.cpp(12,4): error C2065: undeclared identifier",
        "Source/Bar.cpp(20): warning C4996: deprecated API",
        "Authorization: Bearer sk-runtime-secret token=abc123",
      ].join("\n"),
      projectRoot: "C:/Users/Alice/Lyra",
      createdAt: 12_000,
    });

    expect(summary.errorCount).toBe(1);
    expect(summary.warningCount).toBe(1);
    expect(summary.rawOutputStored).toBe(false);
    expect(summary.diagnostics[0]?.displayPath).toBe("[project-root]/Source/Foo.cpp");
    expect(JSON.stringify(summary)).not.toContain("C:/Users/Alice");
    expect(JSON.stringify(summary)).not.toContain("sk-runtime-secret");
  });
});
