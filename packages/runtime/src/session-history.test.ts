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
    const SECRET_API_KEY = 'sk-abcdefghijklmnopqrstuvwxyz123456';
    const SECRET_BEARER = 'sk-abcdefghijklmnopqrstuvwxyz123456';
    const SECRET_TOKEN = 'abcdef1234567890abcdef1234567890';

    it("should redact api_key from task history", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion(
        "task-001",
        "completed",
        `api_key=${SECRET_API_KEY}`,
        "live",
      );

      const history = engine.getTaskHistory({});
      expect(history[0].title).not.toContain(SECRET_API_KEY);
      expect(history[0].title).toContain("[REDACTED]");
    });

    it("should redact Authorization Bearer from task history", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion(
        "task-001",
        "completed",
        `Authorization: Bearer ${SECRET_BEARER}`,
        "live",
      );

      const history = engine.getTaskHistory({});
      expect(history[0].title).not.toContain(SECRET_BEARER);
      expect(history[0].title).toContain("[REDACTED]");
    });

    it("should redact token from task history", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion(
        "task-001",
        "completed",
        `token=${SECRET_TOKEN}`,
        "live",
      );

      const history = engine.getTaskHistory({});
      expect(history[0].title).not.toContain(SECRET_TOKEN);
      expect(history[0].title).toContain("[REDACTED]");
    });

    it("should set redacted flag in replay summary when secrets are present", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion(
        "task-001",
        "completed",
        `api_key=${SECRET_API_KEY}`,
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

    it("should redact secrets in replay events", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion(
        "task-001",
        "completed",
        `api_key=${SECRET_API_KEY}`,
        "live",
      );

      const replay = engine.replayTask("task-001");
      for (const event of replay.events) {
        expect(event.title).not.toContain(SECRET_API_KEY);
      }
    });

    it("should redact secrets in replay summary", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion(
        "task-001",
        "completed",
        `token=${SECRET_TOKEN}`,
        "live",
      );

      const summary = engine.getReplaySummary("task-001");
      expect(summary.redacted).toBe(true);
    });

    it("should not leak raw secrets in session summary", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion(
        "task-001",
        "completed",
        `api_key=${SECRET_API_KEY}`,
        "live",
      );
      engine.recordTaskCompletion(
        "task-002",
        "failed",
        `token=${SECRET_TOKEN}`,
        "live",
      );

      const sessionSummary = engine.getSessionSummary();
      expect(String(sessionSummary.taskCount)).toBe("2");
      expect(sessionSummary.label).not.toContain(SECRET_API_KEY);
      expect(String(sessionSummary.terminalStates.completed)).toBe("1");
    });

    it("should handle all three required secret patterns in getTaskHistory", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion("t1", "completed", `api_key=${SECRET_API_KEY}`, "live");
      engine.recordTaskCompletion("t2", "completed", `Authorization: Bearer ${SECRET_BEARER}`, "live");
      engine.recordTaskCompletion("t3", "completed", `token=${SECRET_TOKEN}`, "live");

      const history = engine.getTaskHistory({});
      expect(history.length).toBe(3);
      for (const entry of history) {
        expect(entry.title).not.toContain(SECRET_API_KEY);
        expect(entry.title).not.toContain(SECRET_BEARER);
        expect(entry.title).not.toContain(SECRET_TOKEN);
        expect(entry.title).toContain("[REDACTED]");
      }
    });

    it("should handle all three required secret patterns in replay events", () => {
      const engine = createSessionHistory();
      engine.recordTaskCompletion("t1", "completed", `api_key=${SECRET_API_KEY}`, "live");
      engine.recordTaskCompletion("t2", "failed", `Authorization: Bearer ${SECRET_BEARER}`, "live");
      engine.recordTaskCompletion("t3", "cancelled", `token=${SECRET_TOKEN}`, "live");

      const replay1 = engine.replayTask("t1");
      const replay2 = engine.replayTask("t2");
      const replay3 = engine.replayTask("t3");

      for (const event of [...replay1.events, ...replay2.events, ...replay3.events]) {
        expect(event.title).not.toContain(SECRET_API_KEY);
        expect(event.title).not.toContain(SECRET_BEARER);
        expect(event.title).not.toContain(SECRET_TOKEN);
      }
    });
  });
});
