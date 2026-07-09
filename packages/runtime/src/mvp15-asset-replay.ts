import type { AssetChangeSet, ReplaySummary } from "@uagent/shared";

export interface AssetMutationReplaySummary extends ReplaySummary {
  affectedAssets: string[];
  reexecutionBlocked: true;
}

export function replayAssetMutationSummary(changeSet: AssetChangeSet): AssetMutationReplaySummary {
  const actions = ["dry-run", "preview"];
  if (changeSet.approval) actions.push("approval");
  if (["executed", "verifying", "verified", "rollback_available", "rolled_back"].includes(changeSet.state)) actions.push("execute");
  if (changeSet.verification) actions.push("verify");
  if (changeSet.state === "rolled_back") actions.push("rollback");
  return {
    sessionId: changeSet.editorSessionId,
    taskId: null,
    eventCount: changeSet.evidenceIds.length,
    terminalState: changeSet.state,
    filteredCount: changeSet.operations.length,
    redacted: true,
    replayOnly: true,
    recordedOnlyActions: actions,
    affectedAssets: [...new Set(changeSet.operations.flatMap((op) => [op.assetPathBefore, op.assetPathAfter].filter((path): path is string => Boolean(path))))],
    reexecutionBlocked: true,
  };
}
