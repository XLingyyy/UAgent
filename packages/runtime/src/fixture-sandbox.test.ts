import { describe, it, expect } from "vitest";
import { createDefaultSandboxPolicy, type SandboxExecutionRequest } from "@uagent/shared";
import { createFixtureSandboxAdapter } from "./fixture-sandbox.js";

function createRequest(overrides: Partial<SandboxExecutionRequest> = {}): SandboxExecutionRequest {
  const policy = createDefaultSandboxPolicy();
  return {
    id: "req-001",
    taskId: "task-001",
    stepId: "step-001",
    capability: "fixture_read",
    input: overrides.input ?? "default input",
    policy,
    timeoutTicks: policy.timeoutTicks,
    createdAt: 1000,
    ...overrides,
  };
}

describe("fixture-sandbox", () => {
  describe("success mode", () => {
    it("returns evidence summary", () => {
      const adapter = createFixtureSandboxAdapter();
      const request = createRequest({ input: "read file" });
      const result = adapter.execute(request);

      expect(result.mode).toBe("success");
      expect(result.status).toBe("completed");
      expect(result.evidenceSummary).toBeTruthy();
      expect(result.stdoutSummary).toContain("fixture_read");
      expect(result.diffSummary).toContain("fixture_read");
    });
  });

  describe("failure mode", () => {
    it("returns warnings", () => {
      const adapter = createFixtureSandboxAdapter();
      const request = createRequest({ input: "do something #fail" });
      const result = adapter.execute(request);

      expect(result.mode).toBe("failure");
      expect(result.status).toBe("failed");
      expect(result.stderrSummary).toBeTruthy();
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("failed");
    });
  });

  describe("timeout mode", () => {
    it("uses tick counting (timeoutTicks exceeds policy)", () => {
      const adapter = createFixtureSandboxAdapter();
      const request = createRequest({ timeoutTicks: 999 });
      const result = adapter.execute(request);

      expect(result.mode).toBe("timeout");
      expect(result.status).toBe("timed_out");
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("TIMEOUT");
    });

    it("uses tick counting (#timeout in input)", () => {
      const adapter = createFixtureSandboxAdapter();
      const request = createRequest({ input: "run #timeout" });
      const result = adapter.execute(request);

      expect(result.mode).toBe("timeout");
      expect(result.status).toBe("timed_out");
    });
  });

  describe("blocked mode", () => {
    it("returns policy reason", () => {
      const adapter = createFixtureSandboxAdapter();
      const request = createRequest({ capability: "network", input: "fetch data" });
      const result = adapter.execute(request);

      expect(result.mode).toBe("blocked");
      expect(result.status).toBe("blocked");
      expect(result.policyReason).toBeTruthy();
      expect(result.policyReason).toContain("network");
    });
  });

  describe("getResult and resetFixtures", () => {
    it("getResult returns stored result", () => {
      const adapter = createFixtureSandboxAdapter();
      const request = createRequest();
      adapter.execute(request);
      const result = adapter.getResult("req-001");
      expect(result).toBeDefined();
      expect(result!.requestId).toBe("req-001");
    });

    it("getResult returns undefined for unknown request", () => {
      const adapter = createFixtureSandboxAdapter();
      expect(adapter.getResult("unknown")).toBeUndefined();
    });

    it("resetFixtures clears all results", () => {
      const adapter = createFixtureSandboxAdapter();
      adapter.execute(createRequest());
      adapter.resetFixtures();
      expect(adapter.getResult("req-001")).toBeUndefined();
    });
  });
});
