import { describe, it, expect } from "vitest";
import {
  runDisabledProviderScenario,
  runFixtureCompleteScenario,
  runFixtureStreamScenario,
  runStreamPartialFailureScenario,
  runCancelledScenario,
  runAuthMissingScenario,
  runRateLimitedScenario,
  runProviderScenarioMatrix,
  runMcpResourceWithProviderReportScenario,
  runBlockedToolWithProviderReportScenario,
} from "./mvp4-scenarios.js";

describe("MVP4 scenarios", () => {
  describe("disabled-provider", () => {
    it("validates disabled network mode", () => {
      const result = runDisabledProviderScenario();
      expect(result.name).toBe("disabled-provider");
      expect(result.pass).toBe(true);
      expect(result.assertions).toBeGreaterThan(0);
    });
  });

  describe("fixture-complete", () => {
    it("completes with text and usage", async () => {
      const result = await runFixtureCompleteScenario();
      expect(result.pass).toBe(true);
      expect(result.assertions).toBeGreaterThanOrEqual(4);
    });
  });

  describe("fixture-stream", () => {
    it("streams chunks with events", async () => {
      const result = await runFixtureStreamScenario();
      expect(result.pass).toBe(true);
      expect(result.assertions).toBeGreaterThanOrEqual(5);
    });
  });

  describe("stream-partial-failure", () => {
    it("preserves partial chunks on failure", async () => {
      const result = await runStreamPartialFailureScenario();
      expect(result.pass).toBe(true);
      expect(result.assertions).toBeGreaterThanOrEqual(4);
    });
  });

  describe("cancelled", () => {
    it("returns cancelled when aborted before start", async () => {
      const result = await runCancelledScenario();
      expect(result.pass).toBe(true);
      expect(result.assertions).toBeGreaterThanOrEqual(2);
    });
  });

  describe("auth-missing", () => {
    it("has correct error code", () => {
      const result = runAuthMissingScenario();
      expect(result.pass).toBe(true);
    });
  });

  describe("rate-limited", () => {
    it("has correct error code and retryable flag", () => {
      const result = runRateLimitedScenario();
      expect(result.pass).toBe(true);
    });
  });

  describe("scenario-matrix", () => {
    it("runs all nine scenarios and passes with structured assertions", async () => {
      const matrix = await runProviderScenarioMatrix();
      const names = matrix.results.map((result) => result.name);

      expect(names).toEqual([
        "disabled-provider",
        "fixture-complete",
        "fixture-stream",
        "stream-partial-failure",
        "cancelled",
        "auth-missing",
        "rate-limited",
        "mcp-resource-with-provider-report",
        "blocked-tool-with-provider-report",
      ]);
      expect(matrix.allPassed).toBe(true);
      expect(matrix.totalAssertions).toBeGreaterThanOrEqual(20);
      for (const result of matrix.results) {
        expect(result.providerEvents).toBeDefined();
        expect(result.taskEvents).toBeDefined();
        expect(result.terminalState).toBeDefined();
        expect(result.requestLog).toBeDefined();
        expect(result.redactionChecked).toBe(true);
        expect(result.assertions).toBeGreaterThan(0);
      }
    });
  });

  describe("mcp-resource-with-provider-report", () => {
    it("runs provider-assisted MCP resource read to completed report without secrets", async () => {
      const result = await runMcpResourceWithProviderReportScenario();

      expect(result.pass).toBe(true);
      expect(result.providerEvents.map((event) => event.type)).toContain("provider_request_completed");
      expect(result.taskEvents.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          "provider_request_started",
          "provider_request_completed",
          "mcp_read_completed",
          "agent_report_created",
          "task_completed",
        ]),
      );
      expect(result.terminalState).toBe("completed");
      expect(result.requestLog.filter((entry) => entry.method === "resources/read")).toHaveLength(1);
      expect(JSON.stringify(result.taskEvents)).not.toContain("sk-live-raw-secret");
      expect(JSON.stringify(result.providerEvents)).not.toContain("sk-live-raw-secret");
      expect(result.redactionChecked).toBe(true);
    });
  });

  describe("blocked-tool-with-provider-report", () => {
    it("runs provider-assisted blocked write intent without tools/call or secrets", async () => {
      const result = await runBlockedToolWithProviderReportScenario();

      expect(result.pass).toBe(true);
      expect(result.providerEvents.map((event) => event.type)).toContain("provider_request_completed");
      expect(result.taskEvents.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          "provider_request_started",
          "provider_request_completed",
          "mcp_tool_blocked",
          "agent_report_created",
          "task_completed",
        ]),
      );
      expect(result.terminalState).toBe("completed");
      expect(result.requestLog.filter((entry) => entry.method === "tools/call")).toHaveLength(0);
      expect(JSON.stringify(result.taskEvents)).not.toContain("sk-live-raw-secret");
      expect(JSON.stringify(result.providerEvents)).not.toContain("sk-live-raw-secret");
      expect(result.redactionChecked).toBe(true);
    });
  });
});
