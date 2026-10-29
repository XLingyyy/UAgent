import type { ProviderRuntimeMessage } from "./provider-runtime.js";

/** Persisted values are descriptions, never reusable credential or approval tokens. */
export type RunStatus =
  | "queued"
  | "planning"
  | "running"
  | "waiting_approval"
  | "paused"
  | "verifying"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "reconciling";
export type RunEffectState = "not_started" | "applied" | "partial" | "unknown" | "compensated";
export type RunJsonValue =
  | null
  | boolean
  | number
  | string
  | RunJsonValue[]
  | { [key: string]: RunJsonValue };

export interface TaskRunLimits {
  maxToolCalls: number;
  maxModelRequests: number;
  maxDurationMs: number;
  maxAttemptsPerFailure: number;
  maxToolResultBytes: number;
  maxContextBytes: number;
}

export interface TaskRunScope {
  id: string;
  runId: string;
  projectId: string;
  conversationId: string;
  rootRef: string;
  providerId: string;
  modelId: string;
  endpoint: string;
  mode: "read_only";
  /** Canonical project-relative directory prefixes; "" explicitly means the whole project. */
  readPrefixes: string[];
  sharePrefixes: string[];
  toolIds: string[];
  limits: TaskRunLimits;
  expiresAt: number;
}

export interface RunSourceRef {
  projectId: string;
  path: string;
  version: string;
  kind: "project_index" | "file_preview" | "tool";
  /** Native metadata freshness stamp; descriptive, never authorization. */
  freshness?: string;
}

export interface RunToolCall {
  callId: string;
  toolId: string;
  name: string;
  arguments: string;
  scopeRef: string;
  attempt: number;
  effectState: RunEffectState;
}

export interface RunToolResult {
  callId: string;
  toolId: string;
  status: "completed" | "blocked" | "failed" | "cancelled";
  effectState: RunEffectState;
  output: RunJsonValue;
  sources: RunSourceRef[];
  truncated: boolean;
  diagnosticCode?: string;
}

export interface RunStep {
  stepId: string;
  dependencies: string[];
  inputRefs: string[];
  preconditions: string[];
  executor: string;
  status: "pending" | "running" | "completed" | "blocked" | "failed" | "cancelled";
  callId?: string;
  result?: RunToolResult;
}

export interface TaskRun {
  schemaVersion: 1;
  runId: string;
  taskId: string;
  projectId: string;
  conversationId: string;
  goal: string;
  planVersion: number;
  parentRunId?: string;
  status: RunStatus;
  limits: TaskRunLimits;
  scope: TaskRunScope;
  steps: RunStep[];
  modelRequests: number;
  toolCalls: number;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  stopReason?: string;
}

export interface RunEvent {
  schemaVersion: 1;
  eventId: string;
  runId: string;
  sequence: number;
  agentId: string;
  stepId?: string;
  createdAt: number;
  type:
    | "run_created"
    | "status_changed"
    | "model_started"
    | "model_text_delta"
    | "model_completed"
    | "tool_requested"
    | "tool_started"
    | "tool_completed"
    | "tool_failed"
    | "checkpoint_created";
  /** JSON-serializable event data; transport headers and credentials are prohibited. */
  payload?: unknown;
}

export interface RunCheckpoint {
  schemaVersion: 1;
  runId: string;
  completedStepIds: string[];
  unresolvedEffects: Array<{ callId: string; toolId: string; effectState: RunEffectState }>;
  contextRefs: RunSourceRef[];
  nextStepId: string | null;
  reason: string;
}

/** One local transaction for state, ordered events, messages and checkpoint. */
export interface RunStoreCommit {
  contextPlan?: RunContextPlan;
  run: TaskRun;
  events: RunEvent[];
  messages: ProviderRuntimeMessage[];
  checkpoint?: RunCheckpoint;
}

export interface RunContextSegment {
  category: "goal" | "constraints" | "history" | "project_fact" | "tool_result";
  originalMessageIndexes: number[];
  selection: "exact" | "deterministic_excerpt";
  sources: RunSourceRef[];
  excerpts?: Array<{ messageIndex: number; start: number; end: number; unit: "utf16" }>;
}
export interface RunContextPlan {
  schemaVersion: 1;
  planId: string;
  runId: string;
  projectId: string;
  conversationId: string;
  method: "deterministic-selection-v1";
  maxBytes: number;
  usedBytes: number;
  fullRecordMessageCount: number;
  scopeDescription: { mode: "read_only"; readPrefixes: string[]; sharePrefixes: string[] };
  segments: RunContextSegment[];
  omitted: Array<{ originalMessageIndexes: number[]; reason: "budget" | "superseded" }>;
}

export interface RunStorePort {
  commit(update: RunStoreCommit): Promise<void>;
}
