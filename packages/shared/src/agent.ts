import type { ToolRiskLevel } from "./risk.js";

export type AgentRunState =
  | "planning"
  | "executing"
  | "observing"
  | "reviewing"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentStepStatus =
  | "pending"
  | "running"
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled";

export type AgentStepKind =
  | "analyze_intent"
  | "select_capability"
  | "read_context"
  | "record_evidence"
  | "policy_review"
  | "blocked_action"
  | "report";

export type AgentActionType =
  | "read_resource"
  | "call_readonly_tool"
  | "mock_observation"
  | "blocked"
  | "noop_report";

export type AgentObservationSource = "mock-runtime" | "mcp-readonly" | "policy";

export interface AgentStepTarget {
  type:
    | "user_intent"
    | "mcp_resource"
    | "mcp_tool"
    | "mock_runtime"
    | "policy"
    | "report";
  name?: string;
  uri?: string;
  toolName?: string;
}

export interface AgentStepAction {
  type: AgentActionType;
  resourceUri?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  reason?: string;
  riskLevel?: ToolRiskLevel;
}

export interface AgentPlanStep {
  id: string;
  kind: AgentStepKind;
  title: string;
  description: string;
  status: AgentStepStatus;
  target?: AgentStepTarget;
  action?: AgentStepAction;
  startedAt?: number;
  completedAt?: number;
  error?: string | null;
}

export interface AgentPlan {
  id: string;
  taskId: string;
  goal: string;
  state: AgentRunState;
  steps: AgentPlanStep[];
  createdAt: number;
  updatedAt: number;
  metadata?: {
    planner: "deterministic" | "future-llm";
    runtimeMode: "mock" | "mcp-readonly";
    discoveryRequired?: boolean;
  };
}

export interface AgentObservation {
  id: string;
  taskId: string;
  stepId: string;
  source: AgentObservationSource;
  summary: string;
  payload?: unknown;
  createdAt: number;
}

export interface AgentBlockedAction {
  stepId: string;
  toolName?: string;
  reason: string;
  riskLevel?: ToolRiskLevel;
}

export interface AgentReport {
  id: string;
  taskId: string;
  planId: string;
  summary: string;
  findings: string[];
  evidenceRefs: string[];
  blockedActions: AgentBlockedAction[];
  nextSteps: string[];
  createdAt: number;
}
