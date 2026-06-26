import { buildAgentRunTrace, replayAgentRunTrace } from "@uagent/runtime";
import type { AgentTraceStatus, TaskEvent, TaskRecord } from "@uagent/shared";

export interface AgentTraceRowViewModel {
  id: string;
  label: string;
  detail: string;
  tone: "default" | "success" | "warning" | "error";
}

export interface AgentTraceStepViewModel {
  id: string;
  title: string;
  state: string;
  detail: string;
}

export interface AgentTraceViewModel {
  empty: boolean;
  status: AgentTraceStatus | "idle";
  goal: string;
  summary: string;
  rows: AgentTraceRowViewModel[];
  steps: AgentTraceStepViewModel[];
  observations: string[];
  evidenceRefs: string[];
  reportSummary: string | null;
  blockedActions: string[];
}

export function createAgentTraceViewModel(
  events: TaskEvent[] = [],
  task?: TaskRecord,
): AgentTraceViewModel {
  if (!task || events.length === 0) {
    return {
      empty: true,
      status: "idle",
      goal: "No active Agent trace",
      summary: "No active Agent trace",
      rows: [],
      steps: [],
      observations: [],
      evidenceRefs: [],
      reportSummary: null,
      blockedActions: [],
    };
  }

  const trace = buildAgentRunTrace(events, task);
  const replay = replayAgentRunTrace(trace);

  return {
    empty: false,
    status: trace.status,
    goal: trace.goal,
    summary: `${replay.eventTypes.length} trace events / ${replay.stepTitles.length} steps`,
    rows: trace.events.map((event) => ({
      id: event.id,
      label: labelForTraceEvent(event.type),
      detail: event.body ?? event.title,
      tone: toneForTraceEvent(event.type),
    })),
    steps: trace.steps.map((step) => ({
      id: step.id,
      title: step.title,
      state: step.status,
      detail: step.targetLabel ?? step.actionType ?? step.kind,
    })),
    observations: trace.observations.map((observation) => observation.summary),
    evidenceRefs: trace.evidenceRefs,
    reportSummary: trace.reportSummary,
    blockedActions: trace.blockedActions.map((action) => action.reason),
  };
}

function labelForTraceEvent(type: string): string {
  const label = type.replace(/_/g, " ");
  return `${label.charAt(0).toUpperCase()}${label.slice(1)}`;
}

function toneForTraceEvent(type: string): AgentTraceRowViewModel["tone"] {
  if (type === "run_failed") return "error";
  if (type === "run_cancelled" || type === "action_selected") return "warning";
  if (type === "run_completed" || type === "report_created") return "success";
  return "default";
}
