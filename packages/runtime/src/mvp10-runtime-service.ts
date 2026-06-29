import {
  type EvidenceRecord,
  type AuditEvent,
} from "@uagent/shared";
import {
  createRealTerminalServiceWithOptions,
  type RealTerminalService,
  type RealTerminalServiceState,
  type RealTerminalAdapter,
} from "./mvp10-terminal-service.js";
import { createAuditProjection, type AuditProjectionEngine } from "./audit-projection.js";
import { createSessionHistory, type SessionHistoryEngine } from "./session-history.js";

export interface Mvp10RuntimeServiceState {
  terminal: RealTerminalServiceState;
}

export interface Mvp10RuntimeService {
  getState(): Mvp10RuntimeServiceState;
  terminal: RealTerminalService;
  subscribe(listener: (state: Mvp10RuntimeServiceState) => void): () => void;
  getAuditEngine(): AuditProjectionEngine;
  getSessionEngine(): SessionHistoryEngine;
  replayTask(taskId: string): Mvp10RuntimeServiceState;
}

export interface Mvp10RuntimeServiceOptions {
  terminalAdapter?: RealTerminalAdapter | null;
}

let serviceIdCounter = 0;

function nextId(prefix: string): string {
  serviceIdCounter++;
  return `${prefix}-${serviceIdCounter}`;
}

export function createMvp10RuntimeService(options: Mvp10RuntimeServiceOptions = {}): Mvp10RuntimeService {
  const auditEngine = createAuditProjection();
  const sessionEngine = createSessionHistory();
  const listeners = new Set<(state: Mvp10RuntimeServiceState) => void>();
  const terminalService = createRealTerminalServiceWithOptions({
    adapter: options.terminalAdapter ?? null,
  });
  const replaySnapshots = new Map<string, RealTerminalServiceState>();
  const recordedExecutionIds = new Set<string>();
  let recordedStartedExecutionId: string | null = null;

  function getCombinedState(): Mvp10RuntimeServiceState {
    return {
      terminal: terminalService.getState(),
    };
  }

  function notify() {
    const state = getCombinedState();
    for (const listener of listeners) {
      listener(state);
    }
  }

  function recordAudit(type: string, title: string, body: string, payload?: Record<string, unknown>) {
    const activeProposal = terminalService.getState().activeProposal;
    auditEngine.recordAuditEvent({
      id: nextId("audit-mvp10"),
      type: type as AuditEvent["type"],
      taskId: activeProposal?.taskId ?? null,
      sessionId: "session-default",
      actor: { type: "system", id: "mvp10-terminal-service", label: "MVP10 Terminal Service" },
      title,
      body,
      summary: title,
      redacted: true,
      createdAt: Date.now(),
      payload,
    });
  }

  function recordSessionEvent(
    eventType: string,
    title: string,
    status: string,
    payload?: unknown,
  ) {
    const activeProposal = terminalService.getState().activeProposal;
    const taskId = activeProposal?.taskId ?? "terminal";
    sessionEngine.recordCapabilityEvent(
      taskId,
      eventType,
      title,
      "terminal",
      status,
      payload,
    );
  }

  function emptyTerminalState(): RealTerminalServiceState {
    return {
      proposals: [],
      activeProposal: null,
      approvalState: null,
      token: null,
      executionResult: null,
      stage: "idle",
      capability: terminalService.getState().capability,
    };
  }

  function cloneReplaySafeState(state: RealTerminalServiceState): RealTerminalServiceState {
    return {
      ...state,
      proposals: state.proposals.map((proposal) => ({ ...proposal })),
      activeProposal: state.activeProposal ? { ...state.activeProposal } : null,
      approvalState: state.approvalState ? { ...state.approvalState } : null,
      token: state.token ? { ...state.token, id: "[native-issued]" } : null,
      executionResult: state.executionResult
        ? {
            ...state.executionResult,
            chunks: state.executionResult.chunks.map((chunk) => ({ ...chunk })),
          }
        : null,
    };
  }

  const origPropose = terminalService.propose.bind(terminalService);
  terminalService.propose = function propose(
    command: string,
    cwd: string,
    taskId: string | null,
    trustedRoot: string,
    projectId?: string | null,
  ) {
    const proposed = origPropose(command, cwd, taskId, trustedRoot, projectId ?? null);
    const recordProposal = (proposal: Awaited<typeof proposed>) => {
      void proposal;
      const state = terminalService.getState();
      const activeProposal = state.activeProposal;
      if (!activeProposal) return proposal;
      const auditType = state.stage === "rejected" ? "terminal_blocked" : "terminal_proposed";
      recordAudit(auditType, state.stage === "rejected" ? "Terminal blocked" : "Terminal proposed", `Command: ${command}`, {
        command,
        cwd: activeProposal.cwd,
        proposalId: activeProposal.id,
        projectId: activeProposal.projectId ?? null,
        risk: activeProposal.classification.risk,
        expiresAt: activeProposal.expiresAt ?? null,
      });
      recordSessionEvent(
        state.stage === "rejected" ? "terminal_rejected" : "terminal_proposed",
        `${state.stage === "rejected" ? "Terminal blocked" : "Terminal proposal"}: ${command}`,
        state.stage,
      );
      notify();
      return proposal;
    };
    if (proposed instanceof Promise) {
      return proposed.then(recordProposal);
    }
    return recordProposal(proposed);
  };

  const origApprove = terminalService.approve.bind(terminalService);
  terminalService.approve = async function approve(proposalId: string, actor: string, reason: string) {
    const activeProposal = terminalService.getState().proposals.find(p => p.id === proposalId);
    const token = await origApprove(proposalId, actor, reason);
    if (token) {
      recordAudit("terminal_approved", "Terminal approved", `Proposal ${proposalId} approved by ${actor}`, {
        proposalId,
        actor,
        reason,
        tokenStatus: token.status,
      });
      recordSessionEvent("terminal_approved", `Terminal approved: ${activeProposal?.command}`, "approved");
    } else {
      const state = terminalService.getState();
      if (state.stage === "rejected") {
        recordAudit("terminal_blocked", "Terminal blocked", `Proposal ${proposalId} rejected: ${state.approvalState?.reason}`);
        recordSessionEvent("terminal_rejected", `Terminal rejected: ${activeProposal?.command}`, "rejected");
      }
    }
    notify();
    return token;
  };

  const origReject = terminalService.reject.bind(terminalService);
  terminalService.reject = function reject(proposalId: string, actor: string, reason: string) {
    const activeProposal = terminalService.getState().proposals.find(p => p.id === proposalId);
    origReject(proposalId, actor, reason);
    recordAudit("terminal_rejected", "Terminal rejected", `Proposal ${proposalId} rejected by ${actor}: ${reason}`);
    recordSessionEvent("terminal_rejected", `Terminal rejected: ${activeProposal?.command}`, "rejected");
    notify();
  };

  const origCancel = terminalService.cancel.bind(terminalService);
  terminalService.cancel = function cancel(executionId: string) {
    origCancel(executionId);
    recordAudit("terminal_cancelled", "Terminal cancelled", `Execution ${executionId} cancelled`);
    recordSessionEvent("terminal_cancelled", "Terminal execution cancelled", "cancelled");
    notify();
  };

  const origReset = terminalService.reset.bind(terminalService);
  terminalService.reset = function reset() {
    origReset();
    notify();
  };

  terminalService.subscribe((event) => {
    if (event.type === "state_changed") {
      const state = event.state;
      if (state.executionResult && state.stage === "executing" && recordedStartedExecutionId !== state.executionResult.id) {
        recordedStartedExecutionId = state.executionResult.id;
        recordAudit("terminal_started", "Terminal started", `Executing: ${state.activeProposal?.command ?? "terminal command"}`, {
          proposalId: state.activeProposal?.id ?? null,
          command: state.activeProposal?.command ?? null,
          cwd: state.activeProposal?.cwd ?? null,
        });
        recordSessionEvent(
          "terminal_started",
          `Terminal started: ${state.activeProposal?.command ?? "terminal command"}`,
          "executing",
        );
      }
      if (state.executionResult && (state.stage === "completed" || state.stage === "failed" || state.stage === "timed_out")) {
        const result = state.executionResult;
        if (recordedExecutionIds.has(result.id)) {
          notify();
          return;
        }
        recordedExecutionIds.add(result.id);
        const outputSummary = result.outputSummary.length > 500
          ? result.outputSummary.slice(0, 500) + "..."
          : result.outputSummary;

        const exitCode = result.exitState?.code ?? -1;
        const durationMs = result.exitState?.durationMs ?? 0;

        const terminalEvidence: EvidenceRecord = {
          id: nextId("evidence"),
          taskId: state.activeProposal?.taskId ?? "terminal",
          kind: "terminal_real_output",
          title: "Terminal output",
          summary: `Terminal output: ${exitCode === 0 ? "completed" : "failed"} (${result.totalLines} lines, ${result.totalBytes} bytes)`,
          source: "capability-bridge",
          createdAt: Date.now(),
          payload: {
            totalLines: result.totalLines,
            totalBytes: result.totalBytes,
            redactionSummary: result.redactionSummary,
            outputSummary,
            exitCode,
          },
        };

        recordSessionEvent(
          "terminal_output",
          `Terminal output: ${exitCode === 0 ? "completed" : "failed"} (${result.totalLines} lines, ${result.totalBytes} bytes)`,
          result.status,
          terminalEvidence,
        );
        recordAudit(
          "terminal_output",
          "Terminal output",
          `${exitCode === 0 ? "Exit code 0" : `Exit code ${exitCode}`}, ${result.totalLines} lines, ${result.totalBytes} bytes`,
          {
            outputSummary,
            totalLines: result.totalLines,
            totalBytes: result.totalBytes,
            redactionSummary: result.redactionSummary,
          },
        );

        recordSessionEvent(
          state.stage === "completed" ? "terminal_completed" : "terminal_failed",
          `Terminal ${state.stage}: ${state.activeProposal?.command}`,
          state.stage,
        );
        recordAudit(
          state.stage === "completed" ? "terminal_completed" : "terminal_failed",
          `Terminal ${state.stage}`,
          `Duration: ${durationMs}ms, redactions: ${result.redactionSummary.replacedSecrets} secrets`,
        );
        const taskId = state.activeProposal?.taskId ?? "terminal";
        replaySnapshots.set(taskId, cloneReplaySafeState(state));
        notify();
      }
    }
  });

  return {
    getState: getCombinedState,

    terminal: terminalService,

    subscribe(listener: (state: Mvp10RuntimeServiceState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getAuditEngine() {
      return auditEngine;
    },

    getSessionEngine() {
      return sessionEngine;
    },

    replayTask(taskId: string): Mvp10RuntimeServiceState {
      const replay = sessionEngine.replayTask(taskId);
      if (replay.summary.eventCount === 0) {
        return {
          terminal: emptyTerminalState(),
        };
      }
      const snapshot = replaySnapshots.get(taskId);
      if (snapshot) {
        return { terminal: cloneReplaySafeState(snapshot) };
      }
      return {
        terminal: emptyTerminalState(),
      };
    },
  };
}
