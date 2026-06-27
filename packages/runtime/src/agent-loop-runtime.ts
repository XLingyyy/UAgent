import {
  createEmptyRuntimeSnapshot,
  createEventId,
  createTaskId,
  createTaskTitle,
  isTerminalTaskState,
  type AgentObservation,
  type AgentPlanStep,
  type McpDiscoverySnapshot,
  type RuntimeClient,
  type RuntimeSnapshot,
  type TaskDraft,
  type TaskEvent,
  type TaskEventLevel,
  type TaskEventType,
  type TaskRecord,
} from "@uagent/shared";
import { selectAction, type AgentAction, type AgentActionSelectorContext } from "./agent-action-selector.js";
import { createEvidenceFromObservation, normalizeObservation, summarizePayload } from "./agent-observation.js";
import { DeterministicPlanner, type Planner } from "./agent-planner.js";
import { createAgentReport } from "./agent-report.js";
import { applyTaskEvent } from "./task-event-reducer.js";
import { ProviderRuntimeBridge } from "./provider/provider-runtime-bridge.js";
import { mapProviderRuntimeEvent } from "./provider/provider-event-bridge.js";
import type { ProviderAdapter } from "./provider/provider-adapter.js";

export interface AgentLoopOptions {
  planner?: Planner;
  actionSelector?: (step: AgentPlanStep, context: AgentActionSelectorContext) => AgentAction;
  runtimeMode?: "mock" | "mcp-readonly";
  discovery?: McpDiscoverySnapshot | null;
  readResource?: (uri: string) => Promise<unknown>;
  callTool?: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  mockObserver?: (step: AgentPlanStep, draft: TaskDraft) => Promise<unknown>;
  providerAdapter?: ProviderAdapter;
  providerEnabled?: boolean;
  clock?: () => number;
  clockStart?: number;
}

export interface AgentLoopContextUpdate {
  runtimeMode?: "mock" | "mcp-readonly";
  discovery?: McpDiscoverySnapshot | null;
  readResource?: ((uri: string) => Promise<unknown>) | undefined;
  callTool?: ((name: string, args: Record<string, unknown>) => Promise<unknown>) | undefined;
  mockObserver?: ((step: AgentPlanStep, draft: TaskDraft) => Promise<unknown>) | undefined;
  providerAdapter?: ProviderAdapter | undefined;
  providerEnabled?: boolean;
}

export interface AgentLoopRuntimeClient extends RuntimeClient {
  updateContext(update: AgentLoopContextUpdate): void;
}

const DEFAULT_CLOCK_START = 1_000;

export function createAgentLoopRuntime(options: AgentLoopOptions = {}): AgentLoopRuntimeClient {
  let taskSequence = 0;
  let eventSequence = 0;
  let evidenceSequence = 0;
  let observationSequence = 0;
  let clock = options.clockStart ?? DEFAULT_CLOCK_START;
  let snapshot = createEmptyRuntimeSnapshot();
  const listeners = new Set<(nextSnapshot: RuntimeSnapshot) => void>();
  const planner = options.planner ?? new DeterministicPlanner({ clock: nextTime });
  const chooseAction = options.actionSelector ?? selectAction;
  let providerBridge: ProviderRuntimeBridge | null = null;
  if (options.providerAdapter) {
    providerBridge = new ProviderRuntimeBridge({
      adapter: options.providerAdapter,
      enabled: options.providerEnabled ?? false,
    });
  }

  function nextTime(): number {
    if (options.clock) {
      return options.clock();
    }
    const time = clock;
    clock += 1;
    return time;
  }

  function notify(): void {
    for (const listener of listeners) {
      listener(snapshot);
    }
  }

  function emit(
    taskId: string,
    type: TaskEventType,
    title: string,
    body: string,
    level: TaskEventLevel = "info",
    payload?: unknown,
  ): TaskEvent {
    eventSequence += 1;
    const event: TaskEvent = {
      id: createEventId(taskId, eventSequence),
      taskId,
      type,
      title,
      body,
      level,
      createdAt: nextTime(),
      payload,
    };
    snapshot = applyTaskEvent(snapshot, event);
    notify();
    return event;
  }

  function isStopped(taskId: string): boolean {
    const task = snapshot.tasksById[taskId];
    return Boolean(task && isTerminalTaskState(task.state));
  }

  async function executeAction(
    taskId: string,
    draft: TaskDraft,
    step: AgentPlanStep,
    action: AgentAction,
  ): Promise<{ observation: AgentObservation; evidence: ReturnType<typeof createEvidenceFromObservation>; blocked?: AgentAction }> {
    if (action.type === "read_resource") {
      emit(taskId, "mcp_read_started", "MCP read started", action.title, "info", {
        stepId: step.id,
        resourceUri: action.resourceUri,
      });
      const result =
        (await options.readResource?.(action.resourceUri)) ?? {
          uri: action.resourceUri,
          text: "No MCP resource reader configured; deterministic placeholder observation.",
        };
      emit(taskId, "mcp_read_completed", "MCP read completed", summarizeResult(result), "success", {
        stepId: step.id,
        result,
      });
      return createObservationBundle(taskId, step, "mcp-readonly", result);
    }

    if (action.type === "call_readonly_tool") {
      emit(taskId, "mcp_read_started", "MCP read started", action.title, "info", {
        stepId: step.id,
        toolName: action.toolName,
      });
      const result =
        (await options.callTool?.(action.toolName, action.args)) ?? {
          toolName: action.toolName,
          text: "No MCP tool runner configured; deterministic placeholder observation.",
        };
      emit(taskId, "mcp_read_completed", "MCP read completed", summarizeResult(result), "success", {
        stepId: step.id,
        result,
      });
      return createObservationBundle(taskId, step, "mcp-readonly", result);
    }

    if (action.type === "blocked") {
      if (action.riskLevel === "unknown") {
        throw new Error(action.reason);
      }
      emit(taskId, "mcp_tool_blocked", "MCP tool blocked", action.reason, "warning", {
        stepId: step.id,
        toolName: action.toolName,
        riskLevel: action.riskLevel,
      });
      return {
        ...(createObservationBundle(taskId, step, "policy", {
          toolName: action.toolName,
          riskLevel: action.riskLevel,
          reason: action.reason,
        })),
        blocked: action,
      };
    }

    const result =
      action.type === "mock_observation"
        ? await (options.mockObserver?.(step, draft) ?? createDefaultMockObservation(step, draft, action.reason))
        : { text: action.reason };
    return createObservationBundle(taskId, step, "mock-runtime", result);
  }

  function createObservationBundle(taskId: string, step: AgentPlanStep, source: AgentObservation["source"], payload: unknown) {
    observationSequence += 1;
    evidenceSequence += 1;
    const createdAt = nextTime();
    const observation = normalizeObservation({
      taskId,
      step,
      source,
      createdAt,
      result: payload,
      sequence: observationSequence,
    });
    const evidence = createEvidenceFromObservation(observation, evidenceSequence);
    return { observation, evidence };
  }

  return {
    async submitTask(draft: TaskDraft): Promise<TaskRecord> {
      taskSequence += 1;
      eventSequence = 0;
      observationSequence = 0;
      evidenceSequence = 0;
      const taskId = createTaskId(taskSequence);
      const createdAt = draft.createdAt ?? nextTime();
      const normalizedDraft = { ...draft, createdAt };
      const record: TaskRecord = {
        id: taskId,
        title: createTaskTitle(draft.input),
        state: "submitted",
        draft: normalizedDraft,
        createdAt,
        updatedAt: createdAt,
        completedAt: null,
        error: null,
      };
      snapshot = {
        ...snapshot,
        status: "running",
        activeTaskId: taskId,
        tasksById: {
          ...snapshot.tasksById,
          [taskId]: record,
        },
      };
      notify();

      const discovery = options.discovery ?? null;
      const runtimeMode = options.runtimeMode ?? (discovery ? "mcp-readonly" : "mock");
      emit(taskId, "task_submitted", "User request", normalizedDraft.input, "info", { draft: normalizedDraft });
      if (!discovery) {
        emit(
          taskId,
          "mcp_fallback_to_mock",
          "Runtime fallback",
          "MCP discovery is unavailable; AgentLoop is using deterministic mock observation.",
          "warning",
        );
      }
      emit(taskId, "agent_plan_started", "Agent planning started", "Creating deterministic Agent plan.", "info", {
        draft: normalizedDraft,
      });
      const plan = planner.createPlan({
        taskId,
        draft: normalizedDraft,
        runtimeMode,
        discovery,
      });
      emit(taskId, "agent_plan_created", "Agent plan created", plan.goal, "success", { plan });

      if (providerBridge?.isEnabled()) {
        emit(taskId, "provider_request_started", "Provider request", "Provider-assisted planning started.", "info");
        try {
          const providerResult = await providerBridge.execute(
            {
              system: "You are an AI assistant integrated into a development agent loop.",
              developer: "Analyze the plan, user request, and provide concise analysis.",
              context: [`Plan goal: ${plan.goal}`, `Plan steps: ${plan.steps.map((s) => s.title).join(", ")}`],
              constraints: ["Only provide analysis. Do not execute tools or suggest actions."],
              toolPolicy: ["Read-only analysis only."],
              user: draft.input,
              metadata: { providerId: options.providerAdapter?.id ?? "provider", providerModelId: "provider-model" },
            },
            normalizedDraft,
            taskId,
            plan.id,
          );
          for (const pEvent of providerResult.events) {
            eventSequence += 1;
            const mapping = mapProviderRuntimeEvent(pEvent, taskId, eventSequence);
            for (const taskEvent of mapping.taskEvents) {
              snapshot = applyTaskEvent(snapshot, taskEvent);
              notify();
            }
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          emit(taskId, "provider_request_failed", "Provider request failed", message, "error", { error: message });
        }
      }

      const evidenceRefs: string[] = [];
      const blockedActions: AgentAction[] = [];
      const observations: AgentObservation[] = [];
      const errors: string[] = [];

      for (const step of plan.steps) {
        if (isStopped(taskId)) {
          return snapshot.tasksById[taskId] ?? record;
        }
        if (step.kind === "report") {
          continue;
        }
        emit(taskId, "agent_step_started", step.title, step.description, "info", { step });
        if (isExecutableStep(step)) {
          try {
            const action = chooseAction(step, { discovery });
            const bundle = await executeAction(taskId, normalizedDraft, step, action);
            if (isStopped(taskId)) {
              return snapshot.tasksById[taskId] ?? record;
            }
            emit(
              taskId,
              "agent_observation_created",
              "Agent observation created",
              bundle.observation.summary,
              bundle.observation.source === "policy" ? "warning" : "success",
              { observation: bundle.observation, evidence: bundle.evidence },
            );
            emit(taskId, "evidence_created", "Evidence created", bundle.evidence.summary, "success", {
              evidence: bundle.evidence,
            });
            observations.push(bundle.observation);
            evidenceRefs.push(bundle.evidence.id);
            if (bundle.blocked) {
              blockedActions.push(bundle.blocked);
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            errors.push(message);
            emit(taskId, "agent_step_failed", "Agent step failed", message, "error", { step, error: message });
            const report = createAgentReport({
              plan,
              observations,
              evidenceRefs,
              blockedActions: blockedActions.map((a) => ({
                stepId: a.stepId,
                toolName: a.type === "blocked" ? a.toolName : undefined,
                reason: a.type === "blocked" ? a.reason : "Action blocked by policy.",
                riskLevel: a.type === "blocked" ? a.riskLevel : undefined,
              })),
              errors,
              createdAt: nextTime(),
            });
            emit(taskId, "agent_report_created", "Agent report created", report.summary, "error", { report });
            emit(taskId, "review_created", "Review summary", report.summary, "info", { report });
            emit(taskId, "task_failed", "Task failed", message, "error", { reason: message, report });
            return snapshot.tasksById[taskId] ?? record;
          }
        }
        emit(taskId, "agent_step_completed", step.title, "Agent step completed.", "success", {
          step: { ...step, status: step.status === "blocked" ? "blocked" : "completed" },
        });
      }

      if (isStopped(taskId)) {
        return snapshot.tasksById[taskId] ?? record;
      }
      const report = createAgentReport({
        plan,
        observations,
        evidenceRefs,
        blockedActions: blockedActions.map((action) => ({
          stepId: action.stepId,
          toolName: action.type === "blocked" ? action.toolName : undefined,
          reason: action.type === "blocked" ? action.reason : "Action blocked by policy.",
          riskLevel: action.type === "blocked" ? action.riskLevel : undefined,
        })),
        errors,
        createdAt: nextTime(),
      });
      emit(taskId, "agent_report_created", "Agent report created", report.summary, "success", { report });
      emit(taskId, "review_created", "Review summary", report.summary, "info", { report });
      emit(taskId, "task_completed", "Task completed", "Agent loop completed.", "success", { report });
      return snapshot.tasksById[taskId] ?? record;
    },
    async cancelTask(taskId: string): Promise<void> {
      const task = snapshot.tasksById[taskId];
      if (!task || isTerminalTaskState(task.state)) {
        return;
      }
      emit(taskId, "task_cancelled", "Task cancelled", "Agent task cancellation requested.", "warning");
    },
    updateContext(update: AgentLoopContextUpdate): void {
      Object.assign(options, update);
      if (update.providerAdapter !== undefined) {
        if (update.providerAdapter) {
          providerBridge = new ProviderRuntimeBridge({
            adapter: update.providerAdapter,
            enabled: options.providerEnabled ?? false,
          });
        } else {
          providerBridge = null;
        }
      }
      if (update.providerEnabled !== undefined && providerBridge) {
        if (update.providerEnabled) {
          providerBridge.enable();
        } else {
          providerBridge.disable();
        }
      }
    },
    getSnapshot() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

function isExecutableStep(step: AgentPlanStep): boolean {
  return step.kind === "read_context" || step.kind === "policy_review" || step.kind === "blocked_action";
}

async function createDefaultMockObservation(
  _step: AgentPlanStep,
  draft: TaskDraft,
  reason: string,
): Promise<unknown> {
  if (draft.input.includes("#fail")) {
    throw new Error("Mock failure injected by #fail.");
  }
  return {
    text: `Mock observation for "${draft.input}".`,
    reason,
  };
}

function summarizeResult(result: unknown): string {
  return summarizePayload(result);
}
