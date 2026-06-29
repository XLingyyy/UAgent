export type ApprovalTokenStatus = "issued" | "used" | "expired" | "revoked";

export interface ApprovalToken {
  id: string;
  proposalId: string;
  taskId: string | null;
  status: ApprovalTokenStatus;
  actor: string;
  createdAt: number;
  usedAt: number | null;
  expiresAt: number;
}

export interface ApprovalTokenRequest {
  proposalId: string;
  taskId: string | null;
  actor: string;
  ttlMs: number;
}

export interface ApprovalTokenValidator {
  validate(token: ApprovalToken): { valid: boolean; reason: string | null };
  isExpired(token: ApprovalToken): boolean;
  canBeUsed(token: ApprovalToken): boolean;
}

export type ApprovalTokenAction =
  | { type: "token_issued"; token: ApprovalToken }
  | { type: "token_used"; tokenId: string; usedAt: number }
  | { type: "token_expired"; tokenId: string }
  | { type: "token_revoked"; tokenId: string; reason: string };
