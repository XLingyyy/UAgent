import { describe, expect, it } from "vitest";
import { createSessionHistory, type TaskHistoryFilter } from "./session-history.js";

describe("SessionHistory", () => {
  describe("session summary aggregates counts", () => {
    it("should return zero counts for empty history", () => {
      const engine = createSessionHistory();
      const summary = engine.getSessionSummary();
      expect(summary.taskCount).toBe(0);
      expect(summary.terminalStates).toEqual({});
    });

    it("should aggregate task counts by state", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion("task-001", "completed", "Setup project", "live");
      engine.recordTaskCompletion("task-002", "failed", "Run tests", "live");
      engine.recordTaskCompletion("task-003", "completed", "Deploy", "fixture");
      engine.recordTaskCompletion("task-004", "cancelled", "Cleanup", "live");

      const summary = engine.getSessionSummary();
      expect(summary.taskCount).toBe(4);
      expect(summary.terminalStates.completed).toBe(2);
      expect(summary.terminalStates.failed).toBe(1);
      expect(summary.terminalStates.cancelled).toBe(1);
    });

    it("should track unique provider modes", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion("task-001", "completed", "Task 1", "live");
      engine.recordTaskCompletion("task-002", "completed", "Task 2", "fixture");
      engine.recordTaskCompletion("task-003", "completed", "Task 3", "live");

      const summary = engine.getSessionSummary();
      expect(summary.providerModes.sort()).toEqual(["fixture", "live"]);
    });
  });

  describe("task history returns filtered results", () => {
    it("should return all tasks when no filter is applied", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion("task-001", "completed", "Task 1", "live");
      engine.recordTaskCompletion("task-002", "failed", "Task 2", "fixture");

      const history = engine.getTaskHistory({});
      expect(history).toHaveLength(2);
    });

    it("should filter by taskId", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion("task-001", "completed", "Task 1", "live");
      engine.recordTaskCompletion("task-002", "failed", "Task 2", "fixture");

      const filter: TaskHistoryFilter = { taskId: "task-001" };
      const history = engine.getTaskHistory(filter);
      expect(history).toHaveLength(1);
      expect(history[0].taskId).toBe("task-001");
    });

    it("should filter by terminal state", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion("task-001", "completed", "Task 1", "live");
      engine.recordTaskCompletion("task-002", "failed", "Task 2", "fixture");
      engine.recordTaskCompletion("task-003", "completed", "Task 3", "live");

      const filter: TaskHistoryFilter = { terminalState: "completed" };
      const history = engine.getTaskHistory(filter);
      expect(history).toHaveLength(2);
      expect(history.every((h) => h.state === "completed")).toBe(true);
    });

    it("should filter by provider mode", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion("task-001", "completed", "Task 1", "live");
      engine.recordTaskCompletion("task-002", "completed", "Task 2", "fixture");

      const filter: TaskHistoryFilter = { providerMode: "fixture" };
      const history = engine.getTaskHistory(filter);
      expect(history).toHaveLength(1);
      expect(history[0].providerMode).toBe("fixture");
    });
  });

  describe("replay is deterministic", () => {
    it("should produce identical results on repeated calls", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion("task-001", "completed", "Test task", "live");

      const result1 = engine.replayTask("task-001");
      const result2 = engine.replayTask("task-001");

      expect(JSON.stringify(result1)).toBe(JSON.stringify(result2));
    });

    it("should produce different summaries for different tasks", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion("task-001", "completed", "Task A", "live");
      engine.recordTaskCompletion("task-002", "failed", "Task B", "fixture");

      const summary1 = engine.getReplaySummary("task-001");
      const summary2 = engine.getReplaySummary("task-002");

      expect(summary1.terminalState).toBe("completed");
      expect(summary2.terminalState).toBe("failed");
    });

    it("should return empty summary for unknown task", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion("task-001", "completed", "Task", "live");

      const summary = engine.getReplaySummary("task-999");
      expect(summary.eventCount).toBe(0);
      expect(summary.terminalState).toBeNull();
    });
  });

  describe("secret-like input is redacted in output", () => {
    it("should redact api_key in title from task history", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion(
        "task-001",
        "completed",
        "Using api_key_secret123",
        "live",
      );

      const history = engine.getTaskHistory({});
      expect(history[0].title).not.toContain("api_key_secret123");
      expect(history[0].title).toContain("[REDACTED]");
    });

    it("should set redacted flag in replay summary when secrets are present", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion(
        "task-001",
        "completed",
        "Using api_key_abc123",
        "live",
      );

      const summary = engine.getReplaySummary("task-001");
      expect(summary.redacted).toBe(true);
    });

    it("should not set redacted flag for clean input", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion(
        "task-001",
        "completed",
        "Normal task title",
        "live",
      );

      const summary = engine.getReplaySummary("task-001");
      expect(summary.redacted).toBe(false);
    });
  });
});
