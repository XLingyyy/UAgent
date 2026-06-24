import { describe, it, expect } from "vitest";
import { createInitialState, reduceAgentState } from "./index.js";

describe("@uagent/runtime state machine", () => {
  it("should start with idle state", () => {
    const state = createInitialState();
    expect(state.status).toBe("idle");
    expect(state.currentTaskId).toBeNull();
  });

  it("should transition to thinking on START", () => {
    const state = createInitialState();
    const next = reduceAgentState(state, { type: "START", taskId: "task-1" });
    expect(next.status).toBe("thinking");
    expect(next.currentTaskId).toBe("task-1");
    expect(next.startedAt).toBeGreaterThan(0);
  });

  it("should transition to finished on FINISH", () => {
    const state = createInitialState();
    const active = reduceAgentState(state, { type: "START", taskId: "task-1" });
    const finished = reduceAgentState(active, { type: "FINISH" });
    expect(finished.status).toBe("finished");
    expect(finished.finishedAt).toBeGreaterThan(0);
  });

  it("should handle ERROR transition", () => {
    const state = createInitialState();
    const active = reduceAgentState(state, { type: "START", taskId: "task-1" });
    const errored = reduceAgentState(active, { type: "ERROR", error: "test error" });
    expect(errored.status).toBe("error");
  });
});
