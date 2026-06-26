import type {
  AgentBlockedAction,
  AgentObservation,
  AgentReport,
  AgentStepKind,
  AgentStepStatus,
} from "./agent.js";

export type AgentTraceEventType =
  | "run_started"
  | "plan_created"
  | "step_started"
  | "action_selected"
  | "observation_recorded"
  | "evidence_attached"
  | "report_created"
  | "run_completed"
  | "run_failed"
  | "run_cancelled";

export type AgentTraceStatus = "running" | "completed" | "failed" | "cancelled";

export interface AgentTraceEvent {
  id: string;
  type: AgentTraceEventType;
  title: string;
  createdAt: number;
  body?: string;
  stepId?: string;
  planId?: string;
  observationId?: string;
  evidenceId?: string;
  reportId?: string;
  error?: string;
}

export interface AgentTraceStepSnapshot {
  id: string;
  title: string;
  kind: AgentStepKind;
  status: AgentStepStatus;
  startedAt?: number;
  completedAt?: number;
  actionType?: string;
  targetLabel?: string;
  observationIds: string[];
  evidenceIds: string[];
  error?: string | null;
}

export interface AgentTraceSummary {
  taskId: string;
  status: AgentTraceStatus;
  goal: string;
  eventCount: number;
  stepCount: number;
  observationCount: number;
  evidenceCount: number;
  blockedActionCount: number;
  reportSummary: string | null;
  terminalEventType: AgentTraceEventType | null;
  startedAt: number;
  completedAt: number | null;
}

export interface AgentRunTrace {
  id: string;
  taskId: string;
  goal: string;
  status: AgentTraceStatus;
  startedAt: number;
  completedAt: number | null;
  events: AgentTraceEvent[];
  steps: AgentTraceStepSnapshot[];
  observations: AgentObservation[];
  evidenceRefs: string[];
  reportSummary: string | null;
  report?: AgentReport;
  blockedActions: AgentBlockedAction[];
  error?: string | null;
}

const TERMINAL_TRACE_EVENTS: AgentTraceEventType[] = [
  "run_completed",
  "run_failed",
  "run_cancelled",
];

export function createAgentTraceSummary(trace: AgentRunTrace): AgentTraceSummary {
  const terminalEvent =
    [...trace.events].reverse().find((event) => TERMINAL_TRACE_EVENTS.includes(event.type)) ??
    null;

  return {
    taskId: trace.taskId,
    status: trace.status,
    goal: trace.goal,
    eventCount: trace.events.length,
    stepCount: trace.steps.length,
    observationCount: trace.observations.length,
    evidenceCount: trace.evidenceRefs.length,
    blockedActionCount: trace.blockedActions.length,
    reportSummary: trace.reportSummary,
    terminalEventType: terminalEvent?.type ?? null,
    startedAt: trace.startedAt,
    completedAt: trace.completedAt,
  };
}
