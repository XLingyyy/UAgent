import type { UEEditorOperationApproval, UEEditorOperationKind, UEEditorOperationProposal, UEEditorOperationResult, UEEditorSession } from "@uagent/shared";
import { createSha256Hash, redactMvp12Text } from "./mvp12-change-set.js";
import { classifyEditorOperation } from "./mvp13-editor-policy.js";
import type { EditorSessionRegistry } from "./mvp13-editor-session.js";
import type { EditorObservationStatusResult } from "./mvp14-editor-observation-service.js";

export interface EditorOperationServiceOptions {
  sessions: EditorSessionRegistry;
  observation?: {
    getSession: () => UEEditorSession | null;
    readStatus: (sessionId: string) => EditorObservationStatusResult;
  };
  now?: () => number;
  ttlMs?: number;
}

export interface ProposeEditorOperationInput {
  sessionId: string;
  operationKind: UEEditorOperationKind;
  args: Record<string, unknown>;
}

type OperationActionResult =
  | { status: "approval_required"; reason: null; proposal: UEEditorOperationProposal }
  | { status: "blocked"; reason: string; proposal: null };

type ApprovalActionResult =
  | { status: "approved"; reason: null; approval: UEEditorOperationApproval }
  | { status: "blocked"; reason: string; approval: null };

type ExecuteActionResult = UEEditorOperationResult & { reason?: string };

function stableArgsHash(args: Record<string, unknown>): string {
  return createSha256Hash(JSON.stringify(args, Object.keys(args).sort()));
}

export function createEditorOperationService(options: EditorOperationServiceOptions) {
  const proposals = new Map<string, UEEditorOperationProposal>();
  const approvals = new Map<string, UEEditorOperationApproval>();
  const usedTokens = new Set<string>();
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 60_000;
  let sequence = 0;

  function blocked(proposalId: string, reason: string): ExecuteActionResult {
    return {
      proposalId,
      status: "blocked",
      reason,
      outputSummary: reason,
      durationMs: 0,
      redaction: { redacted: true, replacedPaths: 0, replacedSecrets: 0 },
      evidenceId: null,
      executedAt: now(),
      replayOnly: false,
    };
  }

  function validateObservationBinding(proposal: UEEditorOperationProposal): string | null {
    if (!options.observation) return null;
    const observationSession = options.observation.getSession();
    if (!observationSession) return "observation_session_required";
    if (observationSession.projectId !== proposal.projectId) return "project_mismatch";
    if (observationSession.rootId !== proposal.rootId) return "root_mismatch";
    if (now() > observationSession.expiresAt || observationSession.status === "expired") return "session_expired";
    if (observationSession.status === "stopped") return "local_observation_stopped";
    if (observationSession.status !== "attached" && observationSession.status !== "launched") return "observation_session_required";
    const status = options.observation.readStatus(observationSession.sessionId);
    if (status.status === "expired") return "session_expired";
    if (status.status === "stopped" || status.reason === "local_observation_stopped") return "local_observation_stopped";
    if (!status.heartbeat) return status.reason ?? "process_unavailable";
    if (!status.heartbeat.projectMatched) return "project_mismatch";
    if (!status.heartbeat.processAlive) return status.heartbeat.statusReason === "process_exited" ? "process_exited" : "process_unavailable";
    return null;
  }

  return {
    propose(input: ProposeEditorOperationInput): OperationActionResult {
      const session = options.sessions.get(input.sessionId);
      if (!session) return { status: "blocked", reason: "session_not_found", proposal: null };
      if (!options.sessions.isActive(input.sessionId)) return { status: "blocked", reason: "session_expired", proposal: null };
      const policy = classifyEditorOperation({ operationKind: input.operationKind });
      if (policy.decision === "blocked" || policy.decision === "changeset_required") {
        return { status: "blocked", reason: policy.reason, proposal: null };
      }
      const createdAt = now();
      const summary = redactMvp12Text(`Editor ${input.operationKind} for ${session.uprojectDisplayPath}`).text;
      const proposal: UEEditorOperationProposal = {
        proposalId: `editor-operation:${++sequence}`,
        sessionId: session.sessionId,
        projectId: session.projectId,
        rootId: session.rootId,
        operationKind: input.operationKind,
        argsHash: stableArgsHash(input.args),
        risk: policy.risk,
        status: policy.decision === "allow_read_only" ? "proposed" : "approval_required",
        summary,
        redaction: { redacted: true, replacedPaths: summary.includes("[project-root]") ? 1 : 0, replacedSecrets: 0 },
        createdAt,
        expiresAt: createdAt + ttlMs,
      };
      proposals.set(proposal.proposalId, proposal);
      return { status: "approval_required", reason: null, proposal };
    },
    approve(input: { proposalId: string; actor: string; reason: string }): ApprovalActionResult {
      const proposal = proposals.get(input.proposalId);
      if (!proposal) return { status: "blocked", reason: "proposal_not_found", approval: null };
      if (now() > proposal.expiresAt) {
        proposals.set(proposal.proposalId, { ...proposal, status: "expired" });
        return { status: "blocked", reason: "proposal_expired", approval: null };
      }
      if (proposal.status !== "approval_required" && proposal.status !== "proposed") {
        return { status: "blocked", reason: "proposal_not_approvable", approval: null };
      }
      if (!input.actor.trim() || !input.reason.trim()) return { status: "blocked", reason: "approval_actor_required", approval: null };
      const approval: UEEditorOperationApproval = {
        token: `editor-approval-token:${proposal.proposalId}:${proposal.argsHash}`,
        proposalId: proposal.proposalId,
        sessionId: proposal.sessionId,
        projectId: proposal.projectId,
        rootId: proposal.rootId,
        operationKind: proposal.operationKind,
        argsHash: proposal.argsHash,
        actor: input.actor,
        reason: input.reason,
        approvedAt: now(),
        expiresAt: proposal.expiresAt,
      };
      approvals.set(proposal.proposalId, approval);
      proposals.set(proposal.proposalId, { ...proposal, status: "approved" });
      return { status: "approved", reason: null, approval };
    },
    execute(input: { proposalId: string; approvalToken: string; operationKind: UEEditorOperationKind; args: Record<string, unknown> }): ExecuteActionResult {
      const proposal = proposals.get(input.proposalId);
      const approval = approvals.get(input.proposalId);
      if (!proposal || !approval) return blocked(input.proposalId, "approval_required");
      if (now() > proposal.expiresAt) {
        proposals.set(proposal.proposalId, { ...proposal, status: "expired" });
        return blocked(input.proposalId, "proposal_expired");
      }
      if (proposal.status !== "approved") return blocked(input.proposalId, "proposal_not_executable");
      if (!options.sessions.isActive(proposal.sessionId)) return blocked(input.proposalId, "session_expired");
      const observationBlockReason = validateObservationBinding(proposal);
      if (observationBlockReason) return blocked(input.proposalId, observationBlockReason);
      if (approval.token !== input.approvalToken) return blocked(input.proposalId, "forged_token");
      if (usedTokens.has(approval.token)) return blocked(input.proposalId, "approval_replay");
      if (now() > approval.expiresAt) return blocked(input.proposalId, "approval_expired");
      if (
        approval.proposalId !== proposal.proposalId ||
        approval.sessionId !== proposal.sessionId ||
        approval.projectId !== proposal.projectId ||
        approval.rootId !== proposal.rootId ||
        approval.operationKind !== proposal.operationKind ||
        approval.argsHash !== proposal.argsHash ||
        approval.expiresAt !== proposal.expiresAt
      ) {
        return blocked(input.proposalId, "approval_binding_mismatch");
      }
      if (approval.operationKind !== input.operationKind) return blocked(input.proposalId, "operation_mismatch");
      if (approval.argsHash !== stableArgsHash(input.args)) return blocked(input.proposalId, "args_hash_mismatch");
      usedTokens.add(approval.token);
      proposals.set(input.proposalId, { ...proposal, status: "executed" });
      return {
        proposalId: input.proposalId,
        status: "executed",
        outputSummary: `Executed ${input.operationKind} in controlled fixture/native editor path.`,
        durationMs: 1,
        redaction: { redacted: true, replacedPaths: 0, replacedSecrets: 0 },
        evidenceId: `evidence:${input.proposalId}:execute`,
        executedAt: now(),
        replayOnly: false,
      };
    },
    cancel(proposalId: string) {
      const proposal = proposals.get(proposalId);
      if (proposal) {
        proposals.set(proposalId, { ...proposal, status: "cancelled" });
        const approval = approvals.get(proposalId);
        if (approval) usedTokens.add(approval.token);
      }
      return { proposalId, status: proposal ? "cancelled" : "blocked", reason: proposal ? null : "proposal_not_found" };
    },
    createReplaySummary(proposalId: string) {
      const proposal = proposals.get(proposalId);
      return proposal ? { proposalId, replayOnly: true, recordedOnlyActions: ["propose", "approve", "execute"], status: proposal.status } : null;
    },
  };
}
