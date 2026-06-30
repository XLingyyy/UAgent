import type { ContextPackRedactionSummary } from "./ue-diagnostics.js";

export const MCP_MUTATION_EXECUTION_DECISIONS = [
  "read_only",
  "blocked",
  "dry_run_required",
  "proposal_required",
  "changeset_required",
] as const;

export type McpMutationExecutionDecision = (typeof MCP_MUTATION_EXECUTION_DECISIONS)[number];

export type McpMutationToolClassification = "read_only" | "mutating" | "unknown";

export interface McpMutationToolPolicy {
  toolName: string;
  classification: McpMutationToolClassification;
  allowlisted: boolean;
  requiresDryRun: boolean;
  textBacked: boolean;
  stateOnly: boolean;
  assetRisk: boolean;
  decision: McpMutationExecutionDecision;
  reason: string;
}

export interface McpMutationProposal {
  proposalId: string;
  toolName: string;
  sessionId: string | null;
  projectId: string;
  rootId: string;
  dryRunId: string;
  operationKind: string;
  status: "blocked" | "approval_required" | "mapped_to_changeset" | "mapped_to_editor_operation";
  summary: string;
  redaction: ContextPackRedactionSummary;
  createdAt: number;
}

export interface McpMutationDryRunResult {
  id: string;
  toolName: string;
  wouldChange: boolean;
  operationKind: string;
  affectedFiles: string[];
  assetRisk: boolean;
  textBacked: boolean;
  stateOnly: boolean;
  blockedReason: string | null;
  summary: string;
  redaction: ContextPackRedactionSummary;
  createdAt: number;
}

export interface AssetMutationPlan {
  id: string;
  toolName: string;
  operationKind: string;
  affectedAssets: string[];
  status: "blocked";
  reason: "asset_mutation_blocked";
  summary: string;
  redaction: ContextPackRedactionSummary;
}
