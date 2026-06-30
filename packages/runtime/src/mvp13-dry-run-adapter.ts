import type { AssetMutationPlan, McpMutationDryRunResult } from "@uagent/shared";

export type Mvp13MappedOperation =
  | { kind: "changeset_v2"; dryRunId: string; affectedFiles: string[]; summary: string }
  | { kind: "editor_operation"; dryRunId: string; operationKind: string; summary: string }
  | { kind: "asset_plan_blocked"; dryRunId: string; plan: AssetMutationPlan }
  | { kind: "blocked"; dryRunId: string; reason: string };

export function mapMcpDryRunToOperation(dryRun: McpMutationDryRunResult): Mvp13MappedOperation {
  if (dryRun.blockedReason) return { kind: "blocked", dryRunId: dryRun.id, reason: dryRun.blockedReason };
  if (dryRun.assetRisk) {
    return {
      kind: "asset_plan_blocked",
      dryRunId: dryRun.id,
      plan: {
        id: `asset-plan:${dryRun.id}`,
        toolName: dryRun.toolName,
        operationKind: dryRun.operationKind,
        affectedAssets: dryRun.affectedFiles,
        status: "blocked",
        reason: "asset_mutation_blocked",
        summary: dryRun.summary,
        redaction: dryRun.redaction,
      },
    };
  }
  if (dryRun.textBacked) return { kind: "changeset_v2", dryRunId: dryRun.id, affectedFiles: dryRun.affectedFiles, summary: dryRun.summary };
  if (dryRun.stateOnly) return { kind: "editor_operation", dryRunId: dryRun.id, operationKind: dryRun.operationKind, summary: dryRun.summary };
  return { kind: "blocked", dryRunId: dryRun.id, reason: "no_safe_mapping" };
}
