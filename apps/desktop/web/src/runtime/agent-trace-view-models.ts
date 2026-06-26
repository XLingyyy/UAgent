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
    rows: createRows(events, trace.events),
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

function createRows(
  events: TaskEvent[],
  traceEvents: ReturnType<typeof buildAgentRunTrace>["events"],
): AgentTraceRowViewModel[] {
  const rows = traceEvents.map((event) => ({
    id: event.id,
    label: labelForTraceEvent(event.type),
    detail: event.body ?? event.title,
    tone: toneForTraceEvent(event.type),
  }));
  if (!events.some((event) => event.type.startsWith("provider_"))) {
    return rows;
  }
  return events.flatMap((event) => {
    if (event.type.startsWith("provider_")) {
      return [
        {
          id: `${event.id}-provider-row`,
          label: labelForTraceEvent(event.type),
          detail: event.body ?? event.title,
          tone: toneForProviderEvent(event.type),
        },
      ];
    }
    return rows.filter((row) => row.id.startsWith(`${event.id}-`));
  });
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

function toneForProviderEvent(type: string): AgentTraceRowViewModel["tone"] {
  if (type === "provider_request_failed") return "error";
  if (type === "provider_request_cancelled") return "warning";
  if (type === "provider_request_completed" || type === "provider_usage_recorded") return "success";
  return "default";
}
