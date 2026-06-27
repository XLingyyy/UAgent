import { type ChangeOperation, type WorkspaceChangeSet } from "@uagent/shared";

export interface ChangeSetOperationResult {
  success: boolean;
  changeSet: WorkspaceChangeSet;
  error?: string;
}

export interface FixtureChangeSetAdapter {
  preview(changeSet: WorkspaceChangeSet): ChangeSetOperationResult;
  promote(changeSet: WorkspaceChangeSet): ChangeSetOperationResult;
  rollback(changeSet: WorkspaceChangeSet): ChangeSetOperationResult;
  discard(changeSet: WorkspaceChangeSet): ChangeSetOperationResult;
}

function generateDiffSummary(operations: ChangeOperation[]): string {
  if (operations.length === 0) {
    return "No changes";
  }
  const lines = operations.map(
    (op) => `${op.type}: ${op.target}${op.description ? ` - ${op.description}` : ""}`,
  );
  return `[${operations.length} operation(s)]\n${lines.join("\n")}`;
}

export function createFixtureChangeSetAdapter(): FixtureChangeSetAdapter {
  return {
    preview(changeSet) {
      if (changeSet.state !== "planned") {
        return { success: false, changeSet, error: `Cannot preview from state ${changeSet.state}` };
      }
      const diffSummary = generateDiffSummary(changeSet.operations);
      const updated: WorkspaceChangeSet = {
        ...changeSet,
        state: "previewed",
        diffSummary,
        updatedAt: Date.now(),
      };
      return { success: true, changeSet: updated };
    },

    promote(changeSet) {
      if (changeSet.state !== "applied") {
        return { success: false, changeSet, error: `Cannot promote from state ${changeSet.state}` };
      }
      const updated: WorkspaceChangeSet = { ...changeSet, state: "promoted", updatedAt: Date.now() };
      return { success: true, changeSet: updated };
    },

    rollback(changeSet) {
      if (changeSet.state !== "applied") {
        return { success: false, changeSet, error: `Cannot rollback from state ${changeSet.state}` };
      }
      const rollbackRef = changeSet.rollbackRef ?? `rollback-${changeSet.id}`;
      const updated: WorkspaceChangeSet = {
        ...changeSet,
        state: "rolled_back",
        rollbackRef,
        updatedAt: Date.now(),
      };
      return { success: true, changeSet: updated };
    },

    discard(changeSet) {
      if (changeSet.state !== "previewed" && changeSet.state !== "applied") {
        return { success: false, changeSet, error: `Cannot discard from state ${changeSet.state}` };
      }
      const updated: WorkspaceChangeSet = { ...changeSet, state: "discarded", updatedAt: Date.now() };
      return { success: true, changeSet: updated };
    },
  };
}
