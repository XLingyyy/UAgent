export type TerminalCommandRisk =
  | "allowlisted"
  | "unknown"
  | "shell_metachar"
  | "dangerous_command"
  | "root_escape"
  | "denied_combination"
  | "network_hint";

export interface TerminalCommandClassification {
  command: string;
  risk: TerminalCommandRisk;
  reason: string;
  matchedKeyword: string | null;
  cwd: string;
  cwdIsContained: boolean;
  hasShellMetachar: boolean;
  envHints: string[];
}

export interface TerminalCommandProposal {
  id: string;
  taskId: string | null;
  projectId?: string | null;
  command: string;
  cwd: string;
  expiresAt?: number;
  classification: TerminalCommandClassification;
  outputLimitBytes: number;
  outputLimitLines: number;
  timeoutMs: number;
  proposedAt: number;
}

export interface TerminalExecutionCapabilityStatus {
  enabled: boolean;
  mode: "native" | "fixture" | "disabled";
  reason: string | null;
  allowlistSummary: string;
  trustedRootRequired: boolean;
  approvalRequired: boolean;
  timeoutMs: number;
  outputLimitBytes: number;
  outputLimitLines: number;
}

export type TerminalProposalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled";

export interface TerminalApprovalState {
  proposalId: string;
  status: TerminalProposalStatus;
  approvedAt: number | null;
  rejectedAt: number | null;
  actor: string | null;
  reason: string | null;
}

export interface TerminalExecutionRequest {
  id: string;
  proposalId: string;
  command: string;
  cwd: string;
  approvedToken: string;
  timeoutMs: number;
  outputLimitBytes: number;
  outputLimitLines: number;
}

export type TerminalExitCode = 0 | 1 | 2 | 137 | 139 | 143 | number;

export interface TerminalExitState {
  code: TerminalExitCode;
  signal: string | null;
  durationMs: number;
}

export interface TerminalOutputChunk {
  index: number;
  stream: "stdout" | "stderr";
  text: string;
  truncated: boolean;
  timestamp: number;
}

export interface TerminalExecutionResult {
  id: string;
  requestId: string;
  status: "running" | "completed" | "failed" | "cancelled" | "timed_out";
  chunks: TerminalOutputChunk[];
  exitState: TerminalExitState | null;
  outputSummary: string;
  outputTruncated: boolean;
  totalBytes: number;
  totalLines: number;
  redactionSummary: { replacedSecrets: number; replacedPaths: number };
  createdAt: number;
  completedAt: number | null;
}

export type TerminalProposalAction =
  | { type: "propose"; proposal: TerminalCommandProposal }
  | { type: "approve"; proposalId: string; actor: string; reason: string }
  | { type: "reject"; proposalId: string; actor: string; reason: string }
  | { type: "cancel"; proposalId: string; reason: string }
  | { type: "execute"; request: TerminalExecutionRequest }
  | { type: "output"; chunk: TerminalOutputChunk }
  | { type: "complete"; result: TerminalExecutionResult };
