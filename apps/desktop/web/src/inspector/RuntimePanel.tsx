import {
  isTerminalTaskState,
  type AgentPlan,
  type AgentPlanStep,
  type TaskEvent,
} from "@uagent/shared";
import { useOptionalRuntimeActions, useOptionalRuntimeStore } from "../stores/ui-store";
import "./UtilityPlaceholderPanel.css";

function mcpRuntimeLabel(status: string, capabilities: unknown): string {
  if (status === "connected" && capabilities) return "MCP read-only";
  if (status === "connected") return "Connected · discovery required";
  return "Mock only";
}

function payloadRecord(event: TaskEvent): Record<string, unknown> | null {
  return event.payload && typeof event.payload === "object"
    ? (event.payload as Record<string, unknown>)
    : null;
}

function findLastEvent(events: TaskEvent[], type: TaskEvent["type"]): TaskEvent | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index]?.type === type) {
      return events[index] ?? null;
    }
  }
  return null;
}

function extractPlan(events: TaskEvent[]): AgentPlan | null {
  const planEvent = findLastEvent(events, "agent_plan_created");
  const payload = planEvent ? payloadRecord(planEvent) : null;
  return payload?.plan && typeof payload.plan === "object" ? (payload.plan as AgentPlan) : null;
}

function extractCurrentStep(events: TaskEvent[]): AgentPlanStep | null {
  const stepEvent = findLastEvent(events, "agent_step_started");
  const payload = stepEvent ? payloadRecord(stepEvent) : null;
  return payload?.step && typeof payload.step === "object"
    ? (payload.step as AgentPlanStep)
    : null;
}

export function RuntimePanel() {
  const runtime = useOptionalRuntimeStore((state) => state);
  const runtimeActions = useOptionalRuntimeActions();
  const activeTaskId = runtime?.activeTaskId ?? null;
  const activeTask = activeTaskId ? runtime?.tasksById[activeTaskId] : null;
  const events = activeTaskId ? (runtime?.eventsByTaskId[activeTaskId] ?? []) : [];
  const visibleEventCount = events.filter((event) => event.type !== "mcp_fallback_to_mock").length;
  const canCancel = Boolean(activeTaskId && activeTask && runtimeActions && !isTerminalTaskState(activeTask.state));
  const plan = extractPlan(events);
  const currentStep = extractCurrentStep(events);
  const completedSteps = events.filter((event) => event.type === "agent_step_completed").length;
  const observations = events.filter((event) => event.type === "agent_observation_created").length;
  const evidence = events.filter((event) => event.type === "evidence_created").length;
  const blocked = events.filter((event) => event.type === "mcp_tool_blocked").length;

  return (
    <section className="ua-utility-placeholder" aria-label="Runtime panel">
      <div className="ua-utility-placeholder__header">
        <div className="ua-utility-placeholder__title-group">
          <span className="ua-utility-placeholder__eyebrow">
            {mcpRuntimeLabel(runtime?.mcp.status ?? "disconnected", runtime?.mcp.capabilities)}
          </span>
          <h3 className="ua-utility-placeholder__title">Runtime context</h3>
        </div>
        <span className="ua-utility-placeholder__state">{runtime?.status ?? "ready"}</span>
      </div>

      <ul className="ua-utility-placeholder__list">
        <li className="ua-utility-placeholder__item">
          Task: {activeTask?.title ?? "No active runtime task"}
        </li>
        <li className="ua-utility-placeholder__item">
          State: {activeTask?.state ?? "idle"}
        </li>
        <li className="ua-utility-placeholder__item">{visibleEventCount} events</li>
        <li className="ua-utility-placeholder__item">
          Plan: {plan?.goal ?? "No active Agent plan"}
        </li>
        <li className="ua-utility-placeholder__item">
          Current step: {currentStep?.title ?? "None"}
        </li>
        <li className="ua-utility-placeholder__item">Completed steps: {completedSteps}</li>
        <li className="ua-utility-placeholder__item">Observations: {observations}</li>
        <li className="ua-utility-placeholder__item">Evidence: {evidence}</li>
        <li className="ua-utility-placeholder__item">Blocked: {blocked}</li>
        <li className="ua-utility-placeholder__item">
          {runtime?.mockOnlyWarning ?? "Mock runtime / no provider call"}
        </li>
        <li className="ua-utility-placeholder__item">
          MCP: {runtime?.mcp.status ?? "disconnected"}
        </li>
        <li className="ua-utility-placeholder__item">
          Discovery:{" "}
          {runtime?.mcp.capabilities
            ? `${runtime.mcp.capabilities.tools} tools / ${runtime.mcp.capabilities.resources} resources / ${runtime.mcp.capabilities.prompts} prompts`
            : "none"}
        </li>
        {events.slice(-3).map((event) => (
          <li key={event.id} className="ua-utility-placeholder__item">
            {event.title}
          </li>
        ))}
      </ul>

      <button
        className="ua-utility-placeholder__action"
        type="button"
        disabled={!canCancel}
        onClick={() => {
          if (activeTaskId) {
            void runtimeActions?.cancelRuntimeTask(activeTaskId);
          }
        }}
      >
        Cancel mock task
      </button>
    </section>
  );
}
