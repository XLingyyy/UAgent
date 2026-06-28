import {
  type TerminalCommandProposal,
  type TerminalApprovalState,
  type TerminalExecutionRequest,
  type TerminalExecutionResult,
  type EvidenceRecord,
  type AuditEvent,
} from "@uagent/shared";
import {
  createFixtureTerminalAdapter,
  type FixtureTerminalAdapter,
} from "./mvp9-terminal-adapter.js";
import { classifyTerminalCommandRisk, isProposalExecutable } from "./mvp9-terminal-policy.js";
import { createAuditProjection, type AuditProjectionEngine } from "./audit-projection.js";
import { createSessionHistory, type SessionHistoryEngine } from "./session-history.js";

export type TerminalStage =
  | "idle"
  | "proposed"
  | "approved"
  | "rejected"
  | "executing"
  | "completed"
  | "failed";

export interface TerminalServiceState {
  proposals: TerminalCommandProposal[];
  activeProposal: TerminalCommandProposal | null;
  approvalState: TerminalApprovalState | null;
  executionResult: TerminalExecutionResult | null;
  stage: TerminalStage;
}

interface TerminalServiceEvent {
  type: "state_changed";
  state: TerminalServiceState;
}

export interface TerminalService {
  getState(): TerminalServiceState;
  propose(command: string, cwd: string, taskId: string | null): TerminalCommandProposal;
  approve(proposalId: string, actor: string, reason: string): Promise<void>;
  reject(proposalId: string, actor: string, reason: string): void;
  cancel(executionId: string): void;
  reset(): void;
  subscribe(listener: (event: TerminalServiceEvent) => void): () => void;
  replayTask(taskId: string): TerminalServiceState;
}

let terminalIdCounter = 0;

function nextId(prefix: string): string {
  terminalIdCounter++;
  return `${prefix}-${terminalIdCounter}`;
}

export function createTerminalService(
  auditEngine?: AuditProjectionEngine,
  sessionEngine?: SessionHistoryEngine,
  adapter?: FixtureTerminalAdapter,
): TerminalService {
  const termAdapter = adapter ?? createFixtureTerminalAdapter();
  const audit = auditEngine ?? createAuditProjection();
  const session = sessionEngine ?? createSessionHistory();
  const listeners = new Set<(event: TerminalServiceEvent) => void>();

  let state: TerminalServiceState = {
    proposals: [],
    activeProposal: null,
    approvalState: null,
    executionResult: null,
    stage: "idle",
  };

  function notify() {
    const event: TerminalServiceEvent = { type: "state_changed", state: { ...state } };
    for (const listener of listeners) {
      listener(event);
    }
  }

  function recordAudit(type: string, title: string, body: string, payload?: Record<string, unknown>) {
    audit.recordAuditEvent({
      id: nextId("audit"),
      type: type as AuditEvent["type"],
      taskId: state.activeProposal?.taskId ?? null,
      sessionId: "session-default",
      actor: { type: "fixture", id: "terminal-service", label: "Terminal Service" },
      title,
      body,
      summary: title,
      redacted: true,
      createdAt: Date.now(),
      payload,
    });
  }

  return {
    getState() {
      return { ...state };
    },

    propose(command: string, cwd: string, taskId: string | null): TerminalCommandProposal {
      const raw = termAdapter.propose(command, cwd, taskId);
      const classification = classifyTerminalCommandRisk(command, cwd, cwd);
      const proposal: TerminalCommandProposal = { ...raw, classification };
      state = {
        ...state,
        proposals: [...state.proposals, proposal],
        activeProposal: proposal,
        approvalState: null,
        executionResult: null,
        stage: "proposed",
      };
      session.recordCapabilityEvent(
        taskId ?? "terminal",
        "terminal_proposed",
        `Terminal proposal: ${command}`,
        "terminal",
        "proposed",
      );
      recordAudit("terminal_proposed", "Terminal proposed", `Command: ${command}`);
      notify();
      return proposal;
    },

    async approve(proposalId: string, actor: string, reason: string) {
      const proposal = state.proposals.find((p) => p.id === proposalId);
      if (!proposal) return;
      if (!isProposalExecutable(proposal.classification)) {
        state = { ...state, stage: "failed" };
        recordAudit("terminal_blocked", "Terminal blocked", `Command not executable: ${proposal.classification.reason}`);
        notify();
        return;
      }
      const approvalState: TerminalApprovalState = {
        proposalId,
        status: "approved",
        approvedAt: Date.now(),
        rejectedAt: null,
        actor,
        reason,
      };
      state = { ...state, approvalState, stage: "approved" };
      session.recordCapabilityEvent(
        proposal.taskId ?? "terminal",
        "terminal_approved",
        `Terminal approved: ${proposal.command}`,
        "terminal",
        "approved",
      );
      recordAudit("terminal_approved", "Terminal approved", `Proposal ${proposalId} approved by ${actor}`);

      const execId = nextId("exec");
      const request: TerminalExecutionRequest = {
        id: execId,
        proposalId: proposal.id,
        command: proposal.command,
        cwd: proposal.cwd,
        approvedToken: `approved-token-${Date.now()}`,
        timeoutMs: proposal.timeoutMs,
        outputLimitBytes: proposal.outputLimitBytes,
        outputLimitLines: proposal.outputLimitLines,
      };

      state = { ...state, stage: "executing" };
      session.recordCapabilityEvent(
        proposal.taskId ?? "terminal",
        "terminal_started",
        `Terminal execution started: ${proposal.command}`,
        "terminal",
        "executing",
      );
      recordAudit("terminal_started", "Terminal started", `Executing: ${proposal.command}`);
      notify();

      try {
        const result = await termAdapter.execute(request);
        const outputSummary = result.outputSummary.length > 500
          ? result.outputSummary.slice(0, 500) + "..."
          : result.outputSummary;
        const executionResult: TerminalExecutionResult = {
          ...result,
          outputSummary,
        };
        state = {
          ...state,
          executionResult,
          stage: result.status === "completed" ? "completed" : "failed",
        };

        const terminalTaskId = proposal.taskId ?? "terminal";

        const terminalEvidence: EvidenceRecord = {
          id: nextId("evidence"),
          taskId: terminalTaskId,
          kind: "terminal_output",
          title: "Terminal output",
          summary: `Terminal output: ${result.exitState?.code === 0 ? "completed" : "failed"} (${result.totalLines} lines, ${result.totalBytes} bytes)`,
          source: "capability-bridge",
          createdAt: Date.now(),
          payload: {
            totalLines: result.totalLines,
            totalBytes: result.totalBytes,
            redactionSummary: result.redactionSummary,
            outputSummary: outputSummary,
            exitCode: result.exitState?.code,
          },
        };

        session.recordCapabilityEvent(
          terminalTaskId,
          "terminal_output",
          `Terminal output: ${result.exitState?.code === 0 ? "completed" : "failed"} (${result.totalLines} lines, ${result.totalBytes} bytes)`,
          "terminal",
          result.status,
          terminalEvidence,
        );
        recordAudit(
          "terminal_output",
          "Terminal output",
          `${result.exitState?.code === 0 ? "Exit code 0" : `Exit code ${result.exitState?.code}`}, ${result.totalLines} lines, ${result.totalBytes} bytes`,
          {
            outputSummary: outputSummary,
            totalLines: result.totalLines,
            totalBytes: result.totalBytes,
            redactionSummary: result.redactionSummary,
          },
        );

        session.recordCapabilityEvent(
          terminalTaskId,
          result.status === "completed" ? "terminal_completed" : "terminal_failed",
          `Terminal ${result.status}: ${proposal.command}`,
          "terminal",
          result.status,
        );
        recordAudit(
          result.status === "completed" ? "terminal_completed" : "terminal_failed",
          `Terminal ${result.status}`,
          `Exit code: ${result.exitState?.code}, redactions: ${result.redactionSummary.replacedSecrets} secrets`,
        );
        notify();
      } catch (err) {
        state = { ...state, stage: "failed" };
        recordAudit("terminal_failed", "Terminal failed", String(err));
        notify();
      }
    },

    reject(proposalId: string, actor: string, reason: string) {
      const proposal = state.proposals.find((p) => p.id === proposalId);
      if (!proposal) return;
      const approvalState: TerminalApprovalState = {
        proposalId,
        status: "rejected",
        approvedAt: null,
        rejectedAt: Date.now(),
        actor,
        reason,
      };
      state = { ...state, approvalState, stage: "rejected", executionResult: null };
      session.recordCapabilityEvent(
        proposal.taskId ?? "terminal",
        "terminal_rejected",
        `Terminal rejected: ${proposal.command}`,
        "terminal",
        "rejected",
      );
      recordAudit("terminal_rejected", "Terminal rejected", `Proposal ${proposalId} rejected by ${actor}: ${reason}`);
      notify();
    },

    cancel(executionId: string) {
      termAdapter.cancel(executionId);
      state = { ...state, stage: "failed" };
      recordAudit("terminal_cancelled", "Terminal cancelled", `Execution ${executionId} cancelled`);
      notify();
    },

    reset() {
      state = {
        proposals: [],
        activeProposal: null,
        approvalState: null,
        executionResult: null,
        stage: "idle",
      };
      notify();
    },

    subscribe(listener: (event: TerminalServiceEvent) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    replayTask(taskId: string): TerminalServiceState {
      const replay = session.replayTask(taskId);
      if (replay.summary.eventCount === 0) {
        return { proposals: [], activeProposal: null, approvalState: null, executionResult: null, stage: "idle" };
      }
      const lastStage = replay.events[replay.events.length - 1]?.type ?? "idle";
      const mappedStage: TerminalStage =
        lastStage === "terminal_completed" ? "completed"
          : lastStage === "terminal_failed" ? "failed"
          : lastStage === "terminal_rejected" ? "rejected"
          : lastStage === "terminal_started" ? "executing"
          : lastStage === "terminal_approved" ? "approved"
          : lastStage === "terminal_proposed" ? "proposed"
          : "idle";
      return {
        proposals: [],
        activeProposal: null,
        approvalState: null,
        executionResult: null,
        stage: mappedStage,
      };
    },
  };
}
