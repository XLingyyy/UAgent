import {
  createEmptyRuntimeSnapshot,
  createEventId,
  createTaskId,
  createTaskTitle,
  createDefaultSandboxPolicy,
  isTerminalTaskState,
  type AgentObservation,
  type AgentObservationSource,
  type AgentPlan,
  type AgentPlanStep,
  type ApprovalDecisionValue,
  type ApprovalScope,
  type McpDiscoverySnapshot,
  type RuntimeClient,
  type RuntimeSnapshot,
  type SandboxExecutionRequest,
  type SandboxPolicy,
  type TaskDraft,
  type TaskEvent,
  type TaskEventLevel,
  type TaskEventType,
  type TaskRecord,
  type ToolRiskLevel,
} from "@uagent/shared";
import { selectAction, type AgentAction, type AgentActionSelectorContext } from "./agent-action-selector.js";
import { createEvidenceFromObservation, normalizeObservation, summarizePayload } from "./agent-observation.js";
import { DeterministicPlanner, type Planner } from "./agent-planner.js";
import { createAgentReport } from "./agent-report.js";
import { applyTaskEvent } from "./task-event-reducer.js";
import { createApprovalGate, type ApprovalGate } from "./approval-gate.js";
import { evaluateApprovalPolicy } from "./approval-policy.js";
import { createFixtureSandboxAdapter, type FixtureSandboxAdapter } from "./fixture-sandbox.js";
import { createFixtureChangeSetAdapter, type FixtureChangeSetAdapter } from "./fixture-changeset.js";
import { buildAuditFromTaskEvents, createAuditProjection, type AuditProjectionEngine } from "./audit-projection.js";
import { createSessionHistory, type SessionHistoryEngine } from "./session-history.js";
import { ProviderRuntimeBridge } from "./provider/provider-runtime-bridge.js";
import { mapProviderRuntimeEvent } from "./provider/provider-event-bridge.js";
import type { ProviderAdapter } from "./provider/provider-adapter.js";
import { redactString } from "./secrets/redaction.js";

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
  approvalGate?: ApprovalGate;
  sandboxAdapter?: FixtureSandboxAdapter;
  changeSetAdapter?: FixtureChangeSetAdapter;
  auditEngine?: AuditProjectionEngine;
  sessionEngine?: SessionHistoryEngine;
  sandboxPolicy?: SandboxPolicy;
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

interface PendingStepContinuation {
  taskId: string;
  stepIndex: number;
  steps: AgentPlanStep[];
  draft: TaskDraft;
  normalizedDraft: TaskDraft;
  plan: AgentPlan;
  evidenceRefs: string[];
  blockedActions: AgentAction[];
  observations: AgentObservation[];
  errors: string[];
  stepId: string;
  riskLevel: ToolRiskLevel;
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
  const approvalGate = options.approvalGate ?? createApprovalGate(nextTime);
  const sandboxAdapter = options.sandboxAdapter ?? createFixtureSandboxAdapter();
  const changeSetAdapter = options.changeSetAdapter ?? createFixtureChangeSetAdapter();
  const auditEngine = options.auditEngine ?? createAuditProjection();
  const sessionEngine = options.sessionEngine ?? createSessionHistory();
  const sandboxPolicy = options.sandboxPolicy ?? createDefaultSandboxPolicy();
  const pendingContinuations = new Map<string, PendingStepContinuation>();
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

  function emitAuditFromTaskEvent(taskEvent: TaskEvent): void {
    const auditEvents = buildAuditFromTaskEvents([taskEvent], "session-default");
    for (const ae of auditEvents) {
      auditEngine.recordAuditEvent(ae);
    }
  }

  function notify(): void {
    for (const listener of listeners) {
      listener(snapshot);
    }
  }

  function sweepApprovalTimeouts(): void {
    for (const [key, cont] of pendingContinuations) {
      const { taskId, stepId } = cont;
      if (approvalGate.hasPendingRequest(taskId)) continue;
      const decision = approvalGate.getDecision(taskId, stepId);
      if (decision === null) {
        const timedOut = approvalGate.getPendingRequests().length === 0 &&
          !approvalGate.hasPendingRequest(taskId);
        if (timedOut) {
          pendingContinuations.delete(key);
          emit(taskId, "approval_timed_out", "Approval timed out", "Approval request expired", "warning", { stepId });
          finishTaskWithFailure(taskId, cont.plan, cont.observations, cont.evidenceRefs, cont.blockedActions, ["Approval timed out"], cont.draft);
        }
      }
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
    sweepApprovalTimeouts();
    emitAuditFromTaskEvent(event);
    notify();
    return event;
  }

  function isStopped(taskId: string): boolean {
    const task = snapshot.tasksById[taskId];
    return Boolean(task && isTerminalTaskState(task.state));
  }

  async function runSandboxForStep(
    taskId: string,
    stepId: string,
    capability: string,
    input: string,
  ): Promise<import("./fixture-sandbox.js").FixtureSandboxResult> {
    emit(taskId, "sandbox_started", "Sandbox started", `Running sandbox for ${capability}`, "info", { stepId, capability });
    const request: SandboxExecutionRequest = {
      id: `sb-${taskId}-${stepId}`,
      taskId,
      stepId,
      capability,
      input,
      policy: sandboxPolicy,
      timeoutTicks: sandboxPolicy.timeoutTicks,
      createdAt: nextTime(),
    };
    const result = sandboxAdapter.execute(request);
    const sandboxType = result.status === "completed" ? "sandbox_completed"
      : result.status === "failed" ? "sandbox_failed"
      : result.status === "blocked" ? "sandbox_blocked"
      : result.status === "timed_out" ? "sandbox_timed_out"
      : "sandbox_failed";
    emit(
      taskId,
      sandboxType as TaskEventType,
      `Sandbox ${result.status}`,
      result.evidenceSummary || result.stderrSummary || result.policyReason || "Sandbox execution completed",
      sandboxType === "sandbox_completed" ? "success" : "warning",
      { stepId, capability, sandboxResultId: result.id },
    );
    return result;
  }

  async function continueAfterApproval(cont: PendingStepContinuation): Promise<void> {
    const { taskId, stepIndex, steps, draft, normalizedDraft, plan, evidenceRefs, blockedActions, observations, errors, stepId, riskLevel } = cont;
    if (isStopped(taskId)) return;
    const step = steps[stepIndex];
    const action = chooseAction(step, { discovery: options.discovery ?? null });
    const capability = action.type === "read_resource" ? "read_resource"
      : action.type === "call_readonly_tool" ? "read_tool"
      : action.type === "blocked" ? "policy"
      : "fixture_write";

    emit(taskId, "sandbox_started", "Sandbox started", `Running sandbox for ${action.type}`, "info", { stepId, capability });
    const sandboxResult = await runSandboxForStep(taskId, stepId, capability, draft.input);
    if (sandboxResult.status !== "completed") {
      errors.push(`Sandbox ${sandboxResult.status}: ${sandboxResult.stderrSummary || sandboxResult.policyReason || "unknown"}`);
      emit(taskId, "agent_step_failed", "Agent step failed", errors[errors.length - 1], "error", { step, error: errors[errors.length - 1] });
      const report = createAgentReport({
        plan, observations, evidenceRefs,
        blockedActions: mapBlockedActions(blockedActions), errors, createdAt: nextTime(),
      });
      emit(taskId, "agent_report_created", "Agent report created", report.summary, "error", { report });
      emit(taskId, "review_created", "Review summary", report.summary, "info", { report });
      emit(taskId, "task_failed", "Task failed", errors[errors.length - 1], "error", { reason: errors[errors.length - 1], report });
      sessionEngine.recordTaskCompletion(taskId, "failed", draft.input, options.providerEnabled ? "provider" : "fixture");
      return;
    }

    const evidenceBundle = createObservationAndEvidence(taskId, step, "mcp-readonly" as AgentObservationSource, sandboxResult);
    observations.push(evidenceBundle.observation);
    evidenceRefs.push(evidenceBundle.evidence.id);
    emit(taskId, "agent_observation_created", "Agent observation created", evidenceBundle.observation.summary, "success", { observation: evidenceBundle.observation, evidence: evidenceBundle.evidence });
    emit(taskId, "evidence_created", "Evidence created", evidenceBundle.evidence.summary, "success", { evidence: evidenceBundle.evidence });

    if (sandboxResult.diffSummary) {
      emit(taskId, "change_set_created", "Change set created", sandboxResult.diffSummary, "info", {
        stepId, capability, sandboxResultId: sandboxResult.id, diffSummary: sandboxResult.diffSummary,
      });
      const changeSetId = `cs-${taskId}-${stepId}`;
      const changeSetScope = { assets: sandboxResult.artifactRefs, files: [], commands: [], riskLevel, sandboxResultRef: sandboxResult.id };
      const changeSet = changeSetAdapter.preview({
        id: changeSetId, taskId, state: "planned" as const, scope: changeSetScope,
        operations: [{ id: `op-${changeSetId}`, type: "update" as const, target: capability, description: sandboxResult.diffSummary, oldValue: null, newValue: null, riskLevel }],
        diffSummary: sandboxResult.diffSummary, evidenceRefs: [evidenceBundle.evidence.id], rollbackRef: null, createdAt: nextTime(), updatedAt: nextTime(),
      });
      if (changeSet.success) {
        emit(taskId, "change_set_previewed", "Change set previewed", changeSet.changeSet.diffSummary, "info", { changeSetId });
      }
    }

    emit(taskId, "agent_step_completed", step.title, "Agent step completed with sandbox.", "success", { step: { ...step, status: "completed" } });
    await processRemainingSteps(taskId, stepIndex + 1, steps, draft, normalizedDraft, plan, evidenceRefs, blockedActions, observations, errors);
  }

  async function processRemainingSteps(
    taskId: string,
    startIndex: number,
    steps: AgentPlanStep[],
    draft: TaskDraft,
    normalizedDraft: TaskDraft,
    plan: AgentPlan,
    evidenceRefs: string[],
    blockedActions: AgentAction[],
    observations: AgentObservation[],
    errors: string[],
  ): Promise<void> {
    for (let i = startIndex; i < steps.length; i++) {
      if (isStopped(taskId)) return;
      const step = steps[i];
      if (step.kind === "report") continue;
      emit(taskId, "agent_step_started", step.title, step.description, "info", { step });

      if (isExecutableStep(step)) {
        try {
          const action = chooseAction(step, { discovery: options.discovery ?? null });
          const riskLevel = getActionRiskLevel(action);
          const permissionMode = draft.permissionMode;
          const decision = evaluateApprovalPolicy(riskLevel, permissionMode);

          if (decision === "block") {
            const reason = getActionReason(action);
            if (riskLevel === "unknown") {
              throw new Error(reason);
            }
            emit(taskId, "mcp_tool_blocked", "MCP tool blocked", reason, "warning", {
              stepId: step.id, toolName: action.type === "blocked" ? action.toolName : undefined, riskLevel,
            });
            blockedActions.push(action);
            emit(taskId, "agent_observation_created", "Agent observation created", `Blocked: ${reason}`, "warning", { observation: { summary: `Blocked: ${reason}` } });
            emit(taskId, "agent_step_completed", step.title, "Agent step completed (blocked).", "warning", { step: { ...step, status: "blocked" } });
            continue;
          }

          if (decision === "require_approval") {
            const scope = buildScopeForAction(action);
            const approvalReq = approvalGate.requestApproval({
              taskId, stepId: step.id, riskLevel,
              title: `Approval required: ${getActionTitle(action) || step.title}`,
              summary: `Risk level: ${riskLevel}. ${getActionReason(action) || step.description}`,
              scope, checks: ["Sandbox policy check", "Risk assessment"],
              timeoutTicks: 100,
            });
            emit(taskId, "approval_required", "Approval required", approvalReq.summary, "warning", {
              approvalId: approvalReq.id, stepId: step.id, riskLevel, scope,
            });
            pendingContinuations.set(`${taskId}:${step.id}`, {
              taskId, stepIndex: i, steps, draft, normalizedDraft, plan, evidenceRefs: [...evidenceRefs],
              blockedActions: [...blockedActions], observations: [...observations], errors: [...errors],
              stepId: step.id, riskLevel,
            });
            return;
          }

          if (action.type === "read_resource" || action.type === "call_readonly_tool" || action.type === "mock_observation" || action.type === "noop_report") {
            const bundle = await executeAction(taskId, draft, step, action);
            if (isStopped(taskId)) return;
            emitObservationAndEvidence(taskId, bundle);
            observations.push(bundle.observation);
            evidenceRefs.push(bundle.evidence.id);
            if (bundle.blocked) blockedActions.push(bundle.blocked);
          } else if (permissionMode !== "plan_only") {
            const sandboxResult = await runSandboxForStep(taskId, step.id, "fixture_write", draft.input);
            if (sandboxResult.status !== "completed") {
              errors.push(`Sandbox ${sandboxResult.status}: ${sandboxResult.stderrSummary || sandboxResult.policyReason || "unknown"}`);
              emit(taskId, "agent_step_failed", "Agent step failed", errors[errors.length - 1], "error", { step, error: errors[errors.length - 1] });
              await finishTaskWithFailure(taskId, plan, observations, evidenceRefs, blockedActions, errors, draft);
              return;
            }
            const evidenceBundle = createObservationAndEvidence(taskId, step, "mcp-readonly" as AgentObservationSource, sandboxResult);
            observations.push(evidenceBundle.observation);
            evidenceRefs.push(evidenceBundle.evidence.id);
            emitObservationAndEvidence(taskId, evidenceBundle);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(message);
          emit(taskId, "agent_step_failed", "Agent step failed", message, "error", { step, error: message });
          await finishTaskWithFailure(taskId, plan, observations, evidenceRefs, blockedActions, errors, draft);
          return;
        }
      }
      emit(taskId, "agent_step_completed", step.title, "Agent step completed.", "success", {
        step: { ...step, status: step.status === "blocked" ? "blocked" : "completed" },
      });
    }
    await finishTaskSuccess(taskId, plan, observations, evidenceRefs, blockedActions, errors, draft);
  }

  function createObservationAndEvidence(
    taskId: string, step: AgentPlanStep, source: AgentObservation["source"], payload: unknown,
  ): { observation: AgentObservation; evidence: ReturnType<typeof createEvidenceFromObservation> } {
    observationSequence += 1;
    evidenceSequence += 1;
    const createdAt = nextTime();
    const observation = normalizeObservation({ taskId, step, source, createdAt, result: payload, sequence: observationSequence });
    const evidence = createEvidenceFromObservation(observation, evidenceSequence);
    return { observation, evidence };
  }

  function emitObservationAndEvidence(
    taskId: string, bundle: { observation: AgentObservation; evidence: ReturnType<typeof createEvidenceFromObservation>; blocked?: AgentAction },
  ): void {
    emit(taskId, "agent_observation_created", "Agent observation created", bundle.observation.summary,
      bundle.observation.source === "policy" ? "warning" : "success", { observation: bundle.observation, evidence: bundle.evidence });
    emit(taskId, "evidence_created", "Evidence created", bundle.evidence.summary, "success", { evidence: bundle.evidence });
  }

  function mapBlockedActions(actions: AgentAction[]): import("@uagent/shared").AgentBlockedAction[] {
    return actions.map((a) => ({
      stepId: getActionStepId(a),
      toolName: a.type === "blocked" ? a.toolName : undefined,
      reason: getActionReason(a),
      riskLevel: a.type === "blocked" ? a.riskLevel : undefined,
    }));
  }

  async function finishTaskWithFailure(
    taskId: string, plan: AgentPlan,
    observations: AgentObservation[], evidenceRefs: string[], blockedActions: AgentAction[], errors: string[], draft: TaskDraft,
  ): Promise<void> {
    const report = createAgentReport({
      plan, observations, evidenceRefs,
      blockedActions: mapBlockedActions(blockedActions), errors, createdAt: nextTime(),
    });
    emit(taskId, "agent_report_created", "Agent report created", report.summary, "error", { report });
    emit(taskId, "review_created", "Review summary", report.summary, "info", { report });
    emit(taskId, "task_failed", "Task failed", errors[errors.length - 1] || "Task failed", "error", { reason: errors[errors.length - 1] || "Task failed", report });
    sessionEngine.recordTaskCompletion(taskId, "failed", draft.input, options.providerEnabled ? "provider" : "fixture");
  }

  async function finishTaskSuccess(
    taskId: string, plan: AgentPlan,
    observations: AgentObservation[], evidenceRefs: string[], blockedActions: AgentAction[], errors: string[], draft: TaskDraft,
  ): Promise<void> {
    if (isStopped(taskId)) return;
    const report = createAgentReport({
      plan, observations, evidenceRefs,
      blockedActions: mapBlockedActions(blockedActions), errors, createdAt: nextTime(),
    });
    emit(taskId, "agent_report_created", "Agent report created", report.summary, "success", { report });
    emit(taskId, "review_created", "Review summary", report.summary, "info", { report });
    emit(taskId, "task_completed", "Task completed", "Agent loop completed.", "success", { report });
    sessionEngine.recordTaskCompletion(taskId, "completed", draft.input, options.providerEnabled ? "provider" : "fixture");
  }

  function getActionTitle(action: AgentAction): string {
    if (action.type === "read_resource" || action.type === "call_readonly_tool") return action.title;
    return action.type === "blocked" ? action.reason : action.reason;
  }

  function getActionReason(action: AgentAction): string {
    if (action.type === "blocked" || action.type === "mock_observation" || action.type === "noop_report") return action.reason;
    if (action.type === "read_resource") return `Read resource: ${action.resourceUri}`;
    if (action.type === "call_readonly_tool") return `Call tool: ${action.toolName}`;
    return "";
  }

  function getActionStepId(action: AgentAction): string {
    return action.stepId;
  }

  function buildScopeForAction(action: AgentAction): ApprovalScope {
    return {
      assets: [],
      changedFiles: [],
      commands: [],
      targetCapabilities: action.type === "read_resource" ? ["read_resource"]
        : action.type === "call_readonly_tool" ? [action.toolName]
        : action.type === "blocked" ? ["policy"]
        : ["fixture_write"],
    };
  }

  function getActionRiskLevel(action: AgentAction): ToolRiskLevel {
    if (action.type === "blocked") return action.riskLevel;
    if (action.type === "read_resource" || action.type === "call_readonly_tool") return "read_only";
    if (action.type === "mock_observation" || action.type === "noop_report") return "low_risk";
    return "medium_write";
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
      const redactedDraft = { ...normalizedDraft, input: redactString(normalizedDraft.input) };
      const record: TaskRecord = {
        id: taskId,
        title: createTaskTitle(redactedDraft.input),
        state: "submitted",
        draft: redactedDraft,
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
      emit(taskId, "task_submitted", "User request", redactedDraft.input, "info", { draft: redactedDraft });
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
        draft: redactedDraft,
      });
      const plan = planner.createPlan({
        taskId,
        draft: redactedDraft,
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

      await processRemainingSteps(taskId, 0, plan.steps, redactedDraft, redactedDraft, plan, evidenceRefs, blockedActions, observations, errors);

      return snapshot.tasksById[taskId] ?? record;
    },
    async cancelTask(taskId: string): Promise<void> {
      const task = snapshot.tasksById[taskId];
      if (!task || isTerminalTaskState(task.state)) {
        return;
      }
      pendingContinuations.delete(taskId);
      emit(taskId, "task_cancelled", "Task cancelled", "Agent task cancellation requested.", "warning");
      sessionEngine.recordTaskCompletion(taskId, "cancelled", task.title, options.providerEnabled ? "provider" : "fixture");
    },
    async submitApprovalDecision(taskId: string, stepId: string | null, decision: ApprovalDecisionValue, actor: string, reason: string): Promise<void> {
      const contKey = `${taskId}:${stepId}`;
      const cont = pendingContinuations.get(contKey);
      if (!cont) return;

      if (decision === "approved") {
        approvalGate.submitDecision({ taskId, stepId, decision, actor, reason, ticks: nextTime() });
        emit(taskId, "approval_approved", "Approval approved", reason || "Approved by user", "success", { stepId, actor });
        pendingContinuations.delete(contKey);
        await continueAfterApproval(cont);
      } else if (decision === "denied") {
        approvalGate.submitDecision({ taskId, stepId, decision, actor, reason, ticks: nextTime() });
        emit(taskId, "approval_denied", "Approval denied", reason || "Denied by user", "warning", { stepId, actor });
        pendingContinuations.delete(contKey);
        const { draft, plan, evidenceRefs, blockedActions, observations, errors } = cont;
        errors.push(`Approval denied: ${reason}`);
        await finishTaskWithFailure(taskId, plan, observations, evidenceRefs, blockedActions, errors, draft);
      } else if (decision === "cancelled") {
        approvalGate.submitDecision({ taskId, stepId, decision, actor, reason, ticks: nextTime() });
        emit(taskId, "approval_cancelled", "Approval cancelled", reason || "Cancelled by user", "warning", { stepId, actor });
        pendingContinuations.delete(contKey);
        const { draft, plan, evidenceRefs, blockedActions, observations, errors } = cont;
        errors.push(`Approval cancelled: ${reason}`);
        const report = createAgentReport({
          plan, observations, evidenceRefs,
          blockedActions: mapBlockedActions(blockedActions), errors, createdAt: nextTime(),
        });
        emit(taskId, "agent_report_created", "Agent report created", report.summary, "warning", { report });
        emit(taskId, "review_created", "Review summary", report.summary, "info", { report });
        emit(taskId, "task_cancelled", "Task cancelled", reason || "Approval cancelled", "warning", { report });
        sessionEngine.recordTaskCompletion(taskId, "cancelled", draft.input, options.providerEnabled ? "provider" : "fixture");
      }
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
  return step.kind === "analyze_intent" || step.kind === "read_context" || step.kind === "policy_review" || step.kind === "blocked_action";
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
