import type { PlanItem, Evidence, ChatMessage, ToolCall } from "@uagent/shared";
export { createMockRuntime, type MockRuntimeClient, type MockRuntimeOptions } from "./mock-runtime.js";
export { classifyMcpToolRisk, isRiskAllowed } from "./mcp-readonly-policy.js";
export { createSemanticCapabilityIndex, type McpResolvedIntent, type SemanticCapabilityIndex } from "./mcp-semantic-index.js";
export {
  DeterministicPlanner,
  type DeterministicPlannerOptions,
  type Planner,
  type PlannerInput,
} from "./agent-planner.js";
export {
  selectAction,
  type AgentAction,
  type AgentActionSelectorContext,
} from "./agent-action-selector.js";
export {
  createAgentLoopRuntime,
  type AgentLoopContextUpdate,
  type AgentLoopOptions,
  type AgentLoopRuntimeClient,
} from "./agent-loop-runtime.js";
export {
  createEvidenceFromObservation,
  normalizeObservation,
  summarizePayload,
  type NormalizeObservationInput,
} from "./agent-observation.js";
export {
  createAgentReport,
  type CreateAgentReportInput,
} from "./agent-report.js";
export { buildAgentRunTrace } from "./agent-run-recorder.js";
export { replayAgentRunTrace, type AgentRunReplaySummary } from "./agent-run-replay.js";
export { buildPromptEnvelope, type BuildPromptEnvelopeInput, type PromptEnvelope } from "./prompt/prompt-builder.js";
export { buildContextPack, buildToolPolicyPack, type PromptProviderMetadata } from "./prompt/context-pack.js";
export type { ProviderAdapter } from "./provider/provider-adapter.js";
export {
  buildProviderRuntimeRequest,
  type BuildProviderRuntimeRequestInput,
} from "./provider/provider-request-builder.js";
export {
  createProviderRuntimeError,
  normalizeProviderError,
} from "./provider/provider-error.js";
export {
  runProviderComplete,
  runProviderStream,
  type ProviderCompleteResult,
  type ProviderExecutionOptions,
  type ProviderStreamResult,
} from "./provider/provider-runner.js";
export {
  FailingProvider,
  MockStreamingProvider,
  MockTextProvider,
  ProviderRegistry,
} from "./provider/mock-provider.js";
export { createMcpReadOnlyRuntime, type McpReadOnlyRuntimeClient, type McpReadOnlyRuntimeOptions } from "./mcp-readonly-runtime.js";
export { createRuntimeRouter, type RuntimeRouterOptions } from "./runtime-router.js";
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
