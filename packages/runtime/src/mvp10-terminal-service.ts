import type {
  TerminalCommandProposal,
  TerminalApprovalState,
  TerminalExecutionResult,
  TerminalExecutionCapabilityStatus,
} from "@uagent/shared";
import type {
  ApprovalToken,
} from "@uagent/shared";
import {
  classifyMvp10TerminalCommand,
  getDefaultExecutionLimits,
} from "./mvp10-terminal-policy.js";

export type RealTerminalStage =
  | "idle"
  | "proposed"
  | "approved"
  | "rejected"
  | "executing"
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out";

export interface RealTerminalServiceState {
  proposals: TerminalCommandProposal[];
  activeProposal: TerminalCommandProposal | null;
  approvalState: TerminalApprovalState | null;
  token: ApprovalToken | null;
  executionResult: TerminalExecutionResult | null;
  stage: RealTerminalStage;
  capability?: TerminalExecutionCapabilityStatus;
}

export interface RealTerminalService {
  getState(): RealTerminalServiceState;
  refreshCapability(): Promise<TerminalExecutionCapabilityStatus>;
  propose(
    command: string,
    cwd: string,
    taskId: string | null,
    trustedRoot: string,
    projectId?: string | null,
  ): TerminalCommandProposal | Promise<TerminalCommandProposal>;
  approve(proposalId: string, actor: string, reason: string): Promise<ApprovalToken | null>;
  reject(proposalId: string, actor: string, reason: string): void;
  cancel(executionId: string): void;
  reset(): void;
  subscribe(listener: (event: { type: "state_changed"; state: RealTerminalServiceState }) => void): () => void;
}

export interface RealTerminalAdapter {
  getCapability(): TerminalExecutionCapabilityStatus;
  refreshCapability?: () => Promise<TerminalExecutionCapabilityStatus>;
  propose(
    command: string,
    cwd: string,
    taskId: string | null,
    trustedRoot: string,
    projectId: string | null,
  ): Promise<TerminalCommandProposal>;
  approve(proposal: TerminalCommandProposal, actor: string, reason: string): Promise<ApprovalToken>;
  execute(proposal: TerminalCommandProposal): Promise<TerminalExecutionResult>;
}

export interface RealTerminalServiceOptions {
  adapter?: RealTerminalAdapter | null;
}

let serviceIdCounter = 0;
function nextId(prefix: string): string {
  serviceIdCounter++;
  return `${prefix}-${serviceIdCounter}`;
}

function mapDenyReasonToRisk(
  denyReason: ReturnType<typeof classifyMvp10TerminalCommand>["denyReason"],
): TerminalCommandProposal["classification"]["risk"] {
  switch (denyReason) {
    case null:
      return "allowlisted";
    case "cwd_escape":
      return "root_escape";
    case "shell_metachar":
      return "shell_metachar";
    case "network_operation":
      return "network_hint";
    case "blocked_command":
    case "dangerous_pattern":
      return "dangerous_command";
    case "forbidden_flag":
    case "install_operation":
    case "git_mutating_operation":
      return "denied_combination";
    case "unknown_command":
    default:
      return "unknown";
  }
}

export function createRealTerminalService(): RealTerminalService {
  return createRealTerminalServiceWithOptions();
}

export function createRealTerminalServiceWithOptions(
  options: RealTerminalServiceOptions = {},
): RealTerminalService {
  const listeners = new Set<(event: { type: "state_changed"; state: RealTerminalServiceState }) => void>();
  const tokenStore = new Map<string, ApprovalToken>();
  const adapter = options.adapter ?? null;

  const defaultCapability: TerminalExecutionCapabilityStatus = adapter?.getCapability() ?? {
    enabled: false,
    mode: "fixture",
    reason: "native_terminal_unavailable",
    allowlistSummary: "MVP10 verification commands only",
    trustedRootRequired: true,
    approvalRequired: true,
    timeoutMs: 60_000,
    outputLimitBytes: 1_048_576,
    outputLimitLines: 5_000,
  };

  let state: RealTerminalServiceState = {
    proposals: [],
    activeProposal: null,
    approvalState: null,
    token: null,
    executionResult: null,
    stage: "idle",
    capability: defaultCapability,
  };

  function notify() {
    const event = { type: "state_changed" as const, state: { ...state, proposals: [...state.proposals] } };
    for (const listener of listeners) {
      listener(event);
    }
  }

  async function refreshCapability(): Promise<TerminalExecutionCapabilityStatus> {
    const capability = adapter?.refreshCapability
      ? await adapter.refreshCapability()
      : adapter?.getCapability() ?? defaultCapability;
    state = {
      ...state,
      capability,
    };
    notify();
    return capability;
  }

  function issueToken(proposalId: string, taskId: string | null, actor: string, ttlMs: number): ApprovalToken {
    const id = nextId("approval-token");
    const token: ApprovalToken = {
      id,
      proposalId,
      taskId,
      status: "issued",
      actor,
      createdAt: Date.now(),
      usedAt: null,
      expiresAt: Date.now() + ttlMs,
    };
    tokenStore.set(id, token);
    return token;
  }

  return {
    getState() {
      return { ...state, proposals: [...state.proposals] };
    },

    refreshCapability,

    propose(
      command: string,
      cwd: string,
      taskId: string | null,
      trustedRoot: string,
      projectId: string | null = null,
    ): TerminalCommandProposal | Promise<TerminalCommandProposal> {
      if (adapter) {
        return adapter.propose(command, cwd, taskId, trustedRoot, projectId).then((proposal) => {
          state = {
            ...state,
            capability: adapter.getCapability(),
            proposals: [...state.proposals, proposal],
            activeProposal: proposal,
            approvalState: null,
            token: null,
            executionResult: null,
            stage: proposal.classification.risk === "allowlisted" ? "proposed" : "rejected",
          };
          if (state.stage === "rejected") {
            state = {
              ...state,
              approvalState: {
                proposalId: proposal.id,
                status: "rejected",
                approvedAt: null,
                rejectedAt: Date.now(),
                actor: "native-policy",
                reason: proposal.classification.reason,
              },
            };
          }
          notify();
          return proposal;
        }).catch((error) => {
          const limits = getDefaultExecutionLimits();
          const message = error instanceof Error ? error.message : String(error);
          const proposal: TerminalCommandProposal = {
            id: nextId("mvp10-rejected"),
            taskId,
            projectId,
            command,
            cwd: "[project-root]",
            classification: {
              command,
              risk: message.includes("feature_disabled") ? "denied_combination" : "unknown",
              reason: message,
              matchedKeyword: null,
              cwd: "[project-root]",
              cwdIsContained: !message.includes("cwd_escape"),
              hasShellMetachar: false,
              envHints: [],
            },
            outputLimitBytes: limits.outputLimitBytes,
            outputLimitLines: limits.outputLimitLines,
            timeoutMs: limits.timeoutMs,
            proposedAt: Date.now(),
            expiresAt: Date.now(),
          };
          state = {
            ...state,
            capability: adapter.getCapability(),
            proposals: [...state.proposals, proposal],
            activeProposal: proposal,
            approvalState: {
              proposalId: proposal.id,
              status: "rejected",
              approvedAt: null,
              rejectedAt: Date.now(),
              actor: "native-policy",
              reason: message,
            },
            token: null,
            executionResult: null,
            stage: "rejected",
          };
          notify();
          return proposal;
        });
      }

      const limits = getDefaultExecutionLimits();
      const policy = classifyMvp10TerminalCommand(command, cwd, trustedRoot);
      const proposal: TerminalCommandProposal = {
        id: nextId("mvp10-proposal"),
        taskId,
        projectId,
        command,
        cwd,
        classification: {
          command: policy.command,
          risk: mapDenyReasonToRisk(policy.denyReason),
          reason: policy.detail,
          matchedKeyword: policy.denyReason ? policy.parsed.base || null : null,
          cwd,
          cwdIsContained: policy.denyReason !== "cwd_escape",
          hasShellMetachar: policy.denyReason === "shell_metachar",
          envHints: [],
        },
        outputLimitBytes: limits.outputLimitBytes,
        outputLimitLines: limits.outputLimitLines,
        timeoutMs: limits.timeoutMs,
        proposedAt: Date.now(),
        expiresAt: Date.now() + 300_000,
      };
      state = {
        ...state,
        proposals: [...state.proposals, proposal],
        activeProposal: proposal,
        approvalState: null,
        token: null,
        executionResult: null,
        stage: "proposed",
      };
      notify();
      return proposal;
    },

    async approve(proposalId: string, actor: string, reason: string): Promise<ApprovalToken | null> {
      const proposal = state.proposals.find(p => p.id === proposalId);
      if (!proposal) return null;
      if (proposal.classification.risk !== "allowlisted" || !proposal.classification.cwdIsContained) {
        state = {
          ...state,
          approvalState: {
            proposalId,
            status: "rejected",
            approvedAt: null,
            rejectedAt: Date.now(),
            actor,
            reason: proposal.classification.reason,
          },
          token: null,
          stage: "rejected",
        };
        notify();
        return null;
      }

      if (adapter) {
        try {
          const token = await adapter.approve(proposal, actor, reason);
          const approvalState: TerminalApprovalState = {
            proposalId,
            status: "approved",
            approvedAt: Date.now(),
            rejectedAt: null,
            actor,
            reason,
          };
          state = {
            ...state,
            approvalState,
            token,
            stage: "approved",
          };
          notify();

          state = {
            ...state,
            executionResult: {
              id: nextId("native-exec"),
              requestId: proposal.id,
              status: "running",
              chunks: [],
              exitState: null,
              outputSummary: "Native execution started",
              outputTruncated: false,
              totalBytes: 0,
              totalLines: 0,
              redactionSummary: { replacedSecrets: 0, replacedPaths: 0 },
              createdAt: Date.now(),
              completedAt: null,
            },
            stage: "executing",
          };
          notify();

          const result = await adapter.execute(proposal);
          state = {
            ...state,
            executionResult: result,
            stage: result.status === "completed"
              ? "completed"
              : result.status === "timed_out"
                ? "timed_out"
                : result.status === "cancelled"
                  ? "cancelled"
                  : "failed",
          };
          notify();
          return token;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          state = {
            ...state,
            approvalState: {
              proposalId,
              status: message.includes("approve") || message.includes("proposal") ? "rejected" : "approved",
              approvedAt: null,
              rejectedAt: Date.now(),
              actor,
              reason: message,
            },
            token: null,
            executionResult: {
              id: nextId("native-exec-failed"),
              requestId: proposal.id,
              status: message.includes("expired") ? "timed_out" : "failed",
              chunks: [],
              exitState: null,
              outputSummary: message,
              outputTruncated: false,
              totalBytes: 0,
              totalLines: 0,
              redactionSummary: { replacedSecrets: 0, replacedPaths: 0 },
              createdAt: Date.now(),
              completedAt: Date.now(),
            },
            stage: message.includes("expired") ? "timed_out" : "failed",
          };
          notify();
          return null;
        }
      }

      const approvalState: TerminalApprovalState = {
        proposalId,
        status: "approved",
        approvedAt: Date.now(),
        rejectedAt: null,
        actor,
        reason,
      };

      const token = issueToken(proposalId, proposal.taskId, actor, 300_000);

      state = {
        ...state,
        approvalState,
        token,
        stage: "approved",
      };
      notify();
      return token;
    },

    reject(proposalId: string, actor: string, reason: string) {
      const proposal = state.proposals.find(p => p.id === proposalId);
      if (!proposal) return;
      state = {
        ...state,
        approvalState: {
          proposalId,
          status: "rejected",
          approvedAt: null,
          rejectedAt: Date.now(),
          actor,
          reason,
        },
        stage: "rejected",
        executionResult: null,
      };
      notify();
    },

    cancel(_executionId: string) {
      void _executionId;
      state = { ...state, stage: "cancelled" };
      notify();
    },

    reset() {
      state = {
        proposals: [],
        activeProposal: null,
        approvalState: null,
        token: null,
        executionResult: null,
        stage: "idle",
        capability: adapter?.getCapability() ?? defaultCapability,
      };
      notify();
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
