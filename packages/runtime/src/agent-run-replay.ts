import { createAgentTraceSummary, type AgentRunTrace, type AgentTraceEventType } from "@uagent/shared";

export interface AgentRunReplaySummary {
  taskId: string;
  status: AgentRunTrace["status"];
  goal: string;
  eventTypes: AgentTraceEventType[];
  stepTitles: string[];
  observationCount: number;
  evidenceCount: number;
  blockedActionCount: number;
  reportSummary: string | null;
  terminalEventType: AgentTraceEventType | null;
}

export function replayAgentRunTrace(trace: AgentRunTrace): AgentRunReplaySummary {
  const summary = createAgentTraceSummary(trace);

  return {
    taskId: summary.taskId,
    status: summary.status,
    goal: summary.goal,
    eventTypes: trace.events.map((event) => event.type),
    stepTitles: trace.steps.map((step) => step.title),
    observationCount: summary.observationCount,
    evidenceCount: summary.evidenceCount,
    blockedActionCount: summary.blockedActionCount,
    reportSummary: summary.reportSummary,
    terminalEventType: summary.terminalEventType,
  };
}
