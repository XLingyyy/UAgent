import type { ApprovalToken, ApprovalTokenRequest } from "@uagent/shared";

let tokenCounter = 0;
const tokens = new Map<string, ApprovalToken>();

export function nextTokenId(): string {
  tokenCounter++;
  return `approval-token-${tokenCounter}`;
}

export function issueApprovalToken(request: ApprovalTokenRequest): ApprovalToken {
  const token: ApprovalToken = {
    id: nextTokenId(),
    proposalId: request.proposalId,
    taskId: request.taskId,
    status: "issued",
    actor: request.actor,
    createdAt: Date.now(),
    usedAt: null,
    expiresAt: Date.now() + request.ttlMs,
  };
  tokens.set(token.id, token);
  return token;
}

export function validateApprovalToken(tokenId: string, proposalId: string): { valid: boolean; reason: string | null } {
  const token = tokens.get(tokenId);
  if (!token) return { valid: false, reason: "token_not_found" };
  if (token.proposalId !== proposalId) return { valid: false, reason: "token_proposal_mismatch" };
  if (token.status === "used") return { valid: false, reason: "token_already_used" };
  if (token.status === "expired") return { valid: false, reason: "token_expired" };
  if (token.status === "revoked") return { valid: false, reason: "token_revoked" };
  if (Date.now() > token.expiresAt) {
    token.status = "expired";
    return { valid: false, reason: "token_expired" };
  }
  return { valid: true, reason: null };
}

export function useApprovalToken(tokenId: string): boolean {
  const token = tokens.get(tokenId);
  if (!token || token.status !== "issued") return false;
  if (Date.now() > token.expiresAt) {
    token.status = "expired";
    return false;
  }
  token.status = "used";
  token.usedAt = Date.now();
  return true;
}

export function revokeApprovalToken(tokenId: string, _reason: string): boolean {
  void _reason;
  const token = tokens.get(tokenId);
  if (!token) return false;
  token.status = "revoked";
  return true;
}

export function getApprovalToken(tokenId: string): ApprovalToken | undefined {
  return tokens.get(tokenId);
}

export function createApprovalTokenService() {
  return {
    issue: issueApprovalToken,
    validate: validateApprovalToken,
    use: useApprovalToken,
    revoke: revokeApprovalToken,
    get: getApprovalToken,
  };
}
