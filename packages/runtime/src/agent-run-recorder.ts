import type {
  AgentBlockedAction,
  AgentObservation,
  AgentPlan,
  AgentPlanStep,
  AgentReport,
  AgentRunTrace,
  AgentTraceEvent,
  AgentTraceStepSnapshot,
  AgentTraceStatus,
  TaskEvent,
  TaskRecord,
} from "@uagent/shared";

interface PayloadRecord {
  [key: string]: unknown;
}

export function buildAgentRunTrace(events: TaskEvent[], task?: TaskRecord): AgentRunTrace {
  const taskId = task?.id ?? events[0]?.taskId ?? "task-unknown";
  const sortedEvents = [...events].sort((left, right) => left.createdAt - right.createdAt);
  const plan = extractLatestPayload<AgentPlan>(sortedEvents, "agent_plan_created", "plan");
  const report = extractLatestPayload<AgentReport>(sortedEvents, "agent_report_created", "report");
  const observations = extractPayloads<AgentObservation>(
    sortedEvents,
    "agent_observation_created",
    "observation",
  );
  const evidenceRefs = extractEvidenceRefs(sortedEvents);
  const blockedActions = report?.blockedActions ?? extractBlockedActions(sortedEvents);
  const steps = buildStepSnapshots(plan?.steps ?? [], sortedEvents, observations, evidenceRefs);
  const status = deriveTraceStatus(sortedEvents, task);
  const traceEvents = buildTraceEvents(sortedEvents);

  return {
    id: `agent-run-trace-${taskId}`,
    taskId,
    goal: plan?.goal ?? task?.draft.input ?? "Unknown Agent run",
    status,
    startedAt: sortedEvents[0]?.createdAt ?? task?.createdAt ?? 0,
    completedAt: task?.completedAt ?? terminalTraceTime(traceEvents),
    events: traceEvents,
    steps,
    observations,
    evidenceRefs,
    reportSummary: report?.summary ?? null,
    report: report ?? undefined,
    blockedActions,
    error: task?.error ?? extractError(sortedEvents),
  };
}

function deriveTraceStatus(events: TaskEvent[], task?: TaskRecord): AgentTraceStatus {
  if (task) {
    if (task.state === "failed") return "failed";
    if (task.state === "cancelled") return "cancelled";
    if (task.state === "completed") return "completed";
    return "running";
  }

  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === "task_failed") return "failed";
    if (events[i].type === "task_cancelled") return "cancelled";
    if (events[i].type === "task_completed") return "completed";
  }

  return "running";
}

function payloadRecord(event: TaskEvent): PayloadRecord | null {
  return event.payload && typeof event.payload === "object"
    ? (event.payload as PayloadRecord)
    : null;
}

function extractLatestPayload<T>(events: TaskEvent[], eventType: TaskEvent["type"], key: string): T | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== eventType) continue;
    const payload = payloadRecord(event);
    const value = payload?.[key];
    if (value && typeof value === "object") {
      return value as T;
    }
  }
  return null;
}

function extractPayloads<T>(events: TaskEvent[], eventType: TaskEvent["type"], key: string): T[] {
  return events.flatMap((event) => {
    if (event.type !== eventType) return [];
    const payload = payloadRecord(event);
    const value = payload?.[key];
    return value && typeof value === "object" ? [value as T] : [];
  });
}

function extractEvidenceRefs(events: TaskEvent[]): string[] {
  return events.flatMap((event) => {
    if (event.type !== "evidence_created") return [];
    const payload = payloadRecord(event);
    const evidence = payload?.evidence as { id?: unknown } | undefined;
    return typeof evidence?.id === "string" ? [evidence.id] : [];
  });
}

function extractBlockedActions(events: TaskEvent[]): AgentBlockedAction[] {
  return events.flatMap((event) => {
    if (event.type !== "mcp_tool_blocked") return [];
    const payload = payloadRecord(event);
    const stepId = typeof payload?.stepId === "string" ? payload.stepId : "unknown-step";
    return [
      {
        stepId,
        toolName: typeof payload?.toolName === "string" ? payload.toolName : undefined,
        reason: event.body ?? event.title,
        riskLevel:
          payload?.riskLevel === "read_only" ||
          payload?.riskLevel === "blocked" ||
          payload?.riskLevel === "unknown"
            ? payload.riskLevel
            : undefined,
      },
    ];
  });
}

function buildStepSnapshots(
  planSteps: AgentPlanStep[],
  events: TaskEvent[],
  observations: AgentObservation[],
  evidenceRefs: string[],
): AgentTraceStepSnapshot[] {
  return planSteps.map((step) => {
    const started = events.find((event) => event.type === "agent_step_started" && payloadStepId(event) === step.id);
    const completed = [...events]
      .reverse()
      .find((event) => event.type === "agent_step_completed" && payloadStepId(event) === step.id);
    const failed = [...events]
      .reverse()
      .find((event) => event.type === "agent_step_failed" && payloadStepId(event) === step.id);
    const stepObservations = observations.filter((observation) => observation.stepId === step.id);

    return {
      id: step.id,
      title: step.title,
      kind: step.kind,
      status: failed
        ? "failed"
        : completed
          ? step.status === "blocked"
            ? "blocked"
            : "completed"
          : started
            ? "running"
            : step.status,
      startedAt: started?.createdAt,
      completedAt: completed?.createdAt ?? failed?.createdAt,
      actionType: step.action?.type,
      targetLabel: step.target?.name ?? step.target?.uri ?? step.target?.toolName,
      observationIds: stepObservations.map((observation) => observation.id),
      evidenceIds: stepObservations.length > 0 ? evidenceRefs : [],
      error: failed?.body ?? step.error ?? null,
    };
  });
}

function payloadStepId(event: TaskEvent): string | undefined {
  const payload = payloadRecord(event);
  const step = payload?.step as { id?: unknown } | undefined;
  return typeof step?.id === "string"
    ? step.id
    : typeof payload?.stepId === "string"
      ? payload.stepId
      : undefined;
}

function buildTraceEvents(events: TaskEvent[]): AgentTraceEvent[] {
  const traceEvents = events.flatMap(toTraceEvent);
  if (!traceEvents.some((event) => event.type === "run_started") && events[0]) {
    traceEvents.unshift({
      id: `${events[0].id}-trace-start`,
      type: "run_started",
      title: "Run started",
      createdAt: events[0].createdAt,
      body: events[0].body,
    });
  }
  return traceEvents;
}

function toTraceEvent(event: TaskEvent): AgentTraceEvent[] {
  const payload = payloadRecord(event);
  const base = {
    id: `${event.id}-trace`,
    title: event.title,
    createdAt: event.createdAt,
    body: event.body,
  };

  switch (event.type) {
    case "task_submitted":
      return [{ ...base, type: "run_started" }];
    case "agent_plan_created":
      return [{ ...base, type: "plan_created", planId: extractId(payload?.plan) }];
    case "agent_step_started":
      return [{ ...base, type: "step_started", stepId: payloadStepId(event) }];
    case "mcp_read_started":
    case "mcp_tool_blocked":
      return [{ ...base, type: "action_selected", stepId: payloadStepId(event) }];
    case "agent_observation_created":
      return [
        {
          ...base,
          type: "observation_recorded",
          stepId: extractNestedString(payload?.observation, "stepId"),
          observationId: extractId(payload?.observation),
        },
      ];
    case "evidence_created":
      return [{ ...base, type: "evidence_attached", evidenceId: extractId(payload?.evidence) }];
    case "agent_report_created":
      return [{ ...base, type: "report_created", reportId: extractId(payload?.report) }];
    case "task_completed":
      return [{ ...base, type: "run_completed" }];
    case "task_failed":
      return [{ ...base, type: "run_failed", error: event.body ?? event.title }];
    case "task_cancelled":
      return [{ ...base, type: "run_cancelled" }];
    default:
      return [];
  }
}

function extractId(value: unknown): string | undefined {
  return extractNestedString(value, "id");
}

function extractNestedString(value: unknown, key: string): string | undefined {
  return value && typeof value === "object" && typeof (value as PayloadRecord)[key] === "string"
    ? ((value as PayloadRecord)[key] as string)
    : undefined;
}

function terminalTraceTime(events: AgentTraceEvent[]): number | null {
  const terminal = [...events]
    .reverse()
    .find((event) => event.type === "run_completed" || event.type === "run_failed" || event.type === "run_cancelled");
  return terminal?.createdAt ?? null;
}

function extractError(events: TaskEvent[]): string | null {
  const failed = [...events].reverse().find((event) => event.type === "task_failed");
  return failed?.body ?? null;
}
