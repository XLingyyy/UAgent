import type { AgentBlockedAction, AgentObservation, AgentPlan, AgentReport } from "@uagent/shared";

export interface CreateAgentReportInput {
  plan: AgentPlan;
  observations: AgentObservation[];
  evidenceRefs: string[];
  blockedActions: AgentBlockedAction[];
  errors: string[];
  createdAt: number;
}

export function createAgentReport(input: CreateAgentReportInput): AgentReport {
  const hasBlocked = input.blockedActions.length > 0;
  const summary = input.errors[0]
    ? `failed: ${input.errors[0]}`
    : hasBlocked
      ? "blocked mutating action: no write action was executed."
      : "read-only completed: Agent loop finished without write actions.";

  return {
    id: `agent-report-${input.plan.taskId}`,
    taskId: input.plan.taskId,
    planId: input.plan.id,
    summary,
    findings: createFindings(input.observations, input.errors),
    evidenceRefs: input.evidenceRefs,
    blockedActions: input.blockedActions,
    nextSteps: hasBlocked
      ? ["Request an explicit future write-capable workflow after MVP3."]
      : ["Review the evidence before requesting any follow-up action."],
    createdAt: input.createdAt,
  };
}

function createFindings(observations: AgentObservation[], errors: string[]): string[] {
  if (errors.length > 0 && observations.length === 0) {
    return ["Agent loop stopped before producing an observation."];
  }
  if (observations.length === 0) {
    return ["No executable read-only observation was required."];
  }
  return observations.map((observation) => observation.summary);
}
