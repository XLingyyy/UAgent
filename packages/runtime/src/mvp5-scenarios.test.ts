import { describe, it, expect, beforeAll } from "vitest";
import { runMvp5ScenarioMatrix } from "./mvp5-scenarios.js";

describe("MVP5 Scenario Matrix", () => {
  let matrix: Awaited<ReturnType<typeof runMvp5ScenarioMatrix>>;

  beforeAll(async () => {
    matrix = await runMvp5ScenarioMatrix();
  });

  it("should have at least 25 named scenarios", () => {
    expect(matrix.results.length).toBeGreaterThanOrEqual(25);
  });

  it("should have at least 25 total assertions", () => {
    expect(matrix.totalAssertions).toBeGreaterThanOrEqual(25);
  });

  it("should have 0 failed scenarios", () => {
    const failed = matrix.results.filter((r) => !r.pass);
    if (failed.length > 0) {
      console.error("Failed scenarios:", failed.map((f) => `${f.scenarioName}: ${f.error ?? "assertion failed"}`));
    }
    expect(failed.length).toBe(0);
  });

  it("approval-not-required-readonly should complete without approval", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "approval-not-required-readonly");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
    expect(scenario!.terminalState).toBe("completed");
    expect(scenario!.redactionChecked).toBe(true);
    expect(scenario!.sideEffectChecked).toBe(true);
  });

  it("approval-required-medium-write should require approval", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "approval-required-medium-write");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("approval-approved-fixture should approve and run sandbox", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "approval-approved-fixture");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("approval-denied should not execute sensitive action", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "approval-denied");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("approval-cancelled should not execute", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "approval-cancelled");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("approval-timeout should fail", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "approval-timeout");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("sandbox-blocked-by-policy should not execute real operations", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "sandbox-blocked-by-policy");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("sandbox-success-fixture should produce evidence", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "sandbox-success-fixture");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("sandbox-failure-fixture should fail gracefully", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "sandbox-failure-fixture");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("sandbox-timeout-fixture should timeout", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "sandbox-timeout-fixture");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("change-set-preview should create preview", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "change-set-preview");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("change-set-promote should promote successfully", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "change-set-promote");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("change-set-rollback should roll back", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "change-set-rollback");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("audit-replay-deterministic should produce same results", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "audit-replay-deterministic");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("session-history-filter should support filtering", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "session-history-filter");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("secret-redaction-audit-session should redact secrets from audit events, session history, replay events, and replay summaries", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "secret-redaction-audit-session");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
    expect(scenario!.redactionChecked).toBe(true);
    expect(scenario!.assertionCount).toBeGreaterThanOrEqual(4);
    const auditEvents = scenario!.auditEvents;
    for (const ae of auditEvents) {
      expect(ae.title).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
      expect(ae.body).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
      expect(ae.summary).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
    }
  });

  it("provider-boundary-regression should preserve provider boundary", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "provider-boundary-regression");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("mcp-mutating-tool-still-blocked should block mutating MCP tools", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "mcp-mutating-tool-still-blocked");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("prompt-injection-as-data should flag injection", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "prompt-injection-as-data");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("reduced-motion-a11y should verify accessibility", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "reduced-motion-a11y");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("auto-mode-destructive-blocked should block destructive in auto mode", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "auto-mode-destructive-blocked");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("auto-mode-unknown-blocked should block unknown in auto mode", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "auto-mode-unknown-blocked");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("auto-mode-medium-write-requires-approval should require approval in auto mode", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "auto-mode-medium-write-requires-approval");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("runtime-approval-decision-changes-snapshot should update after decision", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "runtime-approval-decision-changes-snapshot");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("ui-approval-action-calls-runtime-decision should call runtime API", () => {
    const scenario = matrix.results.find((r) => r.scenarioName === "ui-approval-action-calls-runtime-decision");
    expect(scenario).toBeDefined();
    expect(scenario!.pass).toBe(true);
  });

  it("allShouldPass: every scenario should pass", () => {
    expect(matrix.allPassed).toBe(true);
  });
});
