import type { PlanItem, Evidence, ChatMessage, ToolCall } from "@uagent/shared";
export { createMockRuntime, type MockRuntimeClient, type MockRuntimeOptions } from "./mock-runtime.js";
export { applyTaskEvent, reduceTaskEvents } from "./task-event-reducer.js";

export type AgentStatus = "idle" | "thinking" | "acting" | "waiting" | "finished" | "error";

export interface AgentState {
  status: AgentStatus;
  currentTaskId: string | null;
  plan: PlanItem[];
  evidence: Evidence[];
  history: ChatMessage[];
  toolCalls: ToolCall[];
  startedAt: number | null;
  finishedAt: number | null;
}

export function createInitialState(): AgentState {
  return {
    status: "idle",
    currentTaskId: null,
    plan: [],
    evidence: [],
    history: [],
    toolCalls: [],
    startedAt: null,
    finishedAt: null,
  };
}

export type AgentTransition =
  | { type: "START"; taskId: string }
  | { type: "THINK" }
  | { type: "ACT" }
  | { type: "WAIT" }
  | { type: "FINISH" }
  | { type: "ERROR"; error: string };

export function reduceAgentState(state: AgentState, transition: AgentTransition): AgentState {
  const timestamp = Date.now();
  switch (transition.type) {
    case "START":
      return {
        ...state,
        status: "thinking",
        currentTaskId: transition.taskId,
        startedAt: timestamp,
      };
    case "THINK":
      return { ...state, status: "thinking" };
    case "ACT":
      return { ...state, status: "acting" };
    case "WAIT":
      return { ...state, status: "waiting" };
    case "FINISH":
      return { ...state, status: "finished", finishedAt: timestamp };
    case "ERROR":
      return { ...state, status: "error", finishedAt: timestamp };
    default:
      return state;
  }
}
