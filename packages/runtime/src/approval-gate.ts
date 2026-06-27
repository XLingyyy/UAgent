import {
  type ToolRiskLevel,
  type ApprovalRequest,
  type ApprovalDecision,
  type ApprovalDecisionValue,
  type ApprovalScope,
} from "@uagent/shared";

export interface ApprovalRequestInput {
  taskId: string;
  stepId: string | null;
  riskLevel: ToolRiskLevel;
  title: string;
  summary: string;
  scope: ApprovalScope;
  checks: string[];
  timeoutTicks: number;
}

export interface ApprovalGateState {
  pendingRequests: ApprovalRequest[];
  resolvedRequests: ApprovalRequest[];
  decisions: ApprovalDecision[];
}

export interface ApprovalGateDecisionInput {
  taskId: string;
  stepId: string | null;
  decision: ApprovalDecisionValue;
  actor: string;
  reason: string;
  ticks: number;
}

export interface ApprovalGate {
  requestApproval(params: ApprovalRequestInput): ApprovalRequest;
  submitDecision(input: ApprovalGateDecisionInput): void;
  getPendingRequests(): ApprovalRequest[];
  hasPendingRequest(taskId: string): boolean;
  getDecision(taskId: string, stepId: string | null): ApprovalDecision | null;
}

let requestSeq = 0;
let decisionSeq = 0;

export function createApprovalGate(clock?: () => number): ApprovalGate {
  const now = clock ?? (() => Date.now());
  const state: ApprovalGateState = {
    pendingRequests: [],
    resolvedRequests: [],
    decisions: [],
  };

  function tickTimeout(request: ApprovalRequest): boolean {
    const elapsed = now() - request.createdAt;
    return elapsed > request.timeoutTicks;
  }

  function gcTimeouts(): void {
    const stillPending: ApprovalRequest[] = [];
    for (const req of state.pendingRequests) {
      if (tickTimeout(req)) {
        const timedOut: ApprovalRequest = { ...req, state: "timed_out", resolvedAt: now() };
        state.resolvedRequests.push(timedOut);
      } else {
        stillPending.push(req);
      }
    }
    state.pendingRequests = stillPending;
  }

  return {
    requestApproval(params: ApprovalRequestInput): ApprovalRequest {
      gcTimeouts();

      const request: ApprovalRequest = {
        id: `approval-${++requestSeq}`,
        taskId: params.taskId,
        stepId: params.stepId,
        riskLevel: params.riskLevel,
        title: params.title,
        summary: params.summary,
        scope: params.scope,
        checks: params.checks,
        timeoutTicks: params.timeoutTicks,
        state: "pending",
        createdAt: now(),
        resolvedAt: null,
      };

      state.pendingRequests.push(request);
      return request;
    },

    submitDecision(input: ApprovalGateDecisionInput): void {
      gcTimeouts();

      const pendingIdx = state.pendingRequests.findIndex(
        (r) => r.taskId === input.taskId && r.stepId === input.stepId,
      );
      if (pendingIdx === -1) {
        return;
      }

      const request = state.pendingRequests[pendingIdx];
      const resolvedAt = now();

      state.pendingRequests.splice(pendingIdx, 1);
      state.resolvedRequests.push({
        ...request,
        state: input.decision as ApprovalRequest["state"],
        resolvedAt,
      });

      state.decisions.push({
        id: `decision-${++decisionSeq}`,
        approvalId: request.id,
        decision: input.decision,
        actor: input.actor,
        reason: input.reason,
        ticks: input.ticks,
        createdAt: resolvedAt,
      });
    },

    getPendingRequests(): ApprovalRequest[] {
      gcTimeouts();
      return [...state.pendingRequests];
    },

    hasPendingRequest(taskId: string): boolean {
      gcTimeouts();
      return state.pendingRequests.some((r) => r.taskId === taskId);
    },

    getDecision(taskId: string, stepId: string | null): ApprovalDecision | null {
      gcTimeouts();

      const resolved = [...state.resolvedRequests].reverse().find(
        (r) => r.taskId === taskId && r.stepId === stepId,
      );
      if (!resolved) {
        return null;
      }

      const decision = [...state.decisions].reverse().find(
        (d) => d.approvalId === resolved.id,
      );
      return decision ?? null;
    },
  };
}
