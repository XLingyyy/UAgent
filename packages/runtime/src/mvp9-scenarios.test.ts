import { describe, it, expect } from "vitest";
import { runMvp9ScenarioMatrix } from "./mvp9-scenarios.js";

describe("MVP9 Scenario Matrix", () => {
  it("should pass at least 90 scenarios with zero failures", () => {
    const result = runMvp9ScenarioMatrix();
    expect(result.total).toBeGreaterThanOrEqual(90);
    expect(result.failed).toBe(0);
    expect(result.passed).toBeGreaterThanOrEqual(90);
  });

  it("should include all required core scenario IDs", () => {
    const result = runMvp9ScenarioMatrix();
    const ids = result.scenarios.map((s) => s.id);
    const coreIds = [
      "terminal-proposal-allowlisted",
      "terminal-proposal-dangerous-blocked",
      "terminal-unknown-command",
      "terminal-approval-execute",
      "terminal-approval-reject",
      "terminal-output-truncation",
      "terminal-output-redaction",
      "browser-local-allowed",
      "browser-external-blocked",
      "screenshot-deny",
      "screenshot-approve-capture",
      "watcher-root-reject",
      "watcher-change-diff",
      "watcher-overflow-warn",
      "no-auto-watcher-rescan",
      "session-replay-no-execute",
    ];
    for (const id of coreIds) {
      expect(ids).toContain(id);
    }
  });

  it("should return all scenario results with correct structure", () => {
    const result = runMvp9ScenarioMatrix();
    for (const s of result.scenarios) {
      expect(s.id).toBeTruthy();
      expect(typeof s.id).toBe("string");
      expect(s.name).toBeTruthy();
      expect(typeof s.pass).toBe("boolean");
      expect(s.detail).toBeTruthy();
    }
  });
});
