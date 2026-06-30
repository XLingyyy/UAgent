import type { ApplyChangeSetRequest, RepairProposal } from "@uagent/shared";
import {
  createChangeSetServiceV2,
  createTextBackedOperation,
  type ChangeSetServiceV2Options,
} from "./mvp12-change-set.js";

export interface Mvp13TextBackedSource {
  dryRunId: string;
  toolName: string;
}

export interface Mvp13TextChangeIntent {
  rootRelativePath: string;
  before: string;
  after: string;
  summary: string;
}

export interface Mvp13TextBackedBridgeOptions extends ChangeSetServiceV2Options {
  source: Mvp13TextBackedSource;
}

type BoundChangeSetApproval = ApplyChangeSetRequest["approval"];

export function createMvp13TextBackedChangeSetBridge(options: Mvp13TextBackedBridgeOptions) {
  const service = createChangeSetServiceV2(options);
  let lastChangeSetId: string | null = null;

  return {
    previewTextChanges(changes: Mvp13TextChangeIntent[]) {
      const operations = changes.map((change, index) =>
        createTextBackedOperation({
          id: `operation:${options.source.dryRunId}:${index + 1}`,
          rootId: options.rootId,
          rootRelativePath: change.rootRelativePath,
          before: change.before,
          after: change.after,
          intent: "manual_descriptor_repair",
          summary: change.summary,
          sourceDiagnosticIds: [options.source.dryRunId],
        }),
      );
      const proposal: RepairProposal = {
        id: `proposal:${options.source.dryRunId}`,
        diagnosticId: options.source.dryRunId,
        title: `MCP dry-run ${options.source.toolName}`,
        recipe: { id: "R-DESCRIPTOR-MALFORMED", label: "MCP text-backed dry-run", automatic: true },
        intent: "manual_descriptor_repair",
        sourceDiagnostics: [
          {
            diagnosticId: options.source.dryRunId,
            kind: "malformed_descriptor",
            displayPath: operations[0]?.target.displayPath ?? null,
          },
        ],
        risk: operations[0]?.risk ?? "low_text",
        explanation: `MCP dry-run ${options.source.toolName} produced text-backed intent.`,
        expectedEffect: "Preview and approval use MVP12 ChangeSet v2 before any file write.",
        rollbackNote: "Rollback uses MVP12 before/current hash binding.",
        operations,
        manualNote: null,
        createdAt: options.createdAt ?? Date.now(),
      };
      const changeSet = service.previewExternalProposal(proposal);
      lastChangeSetId = changeSet.id;
      return { ...changeSet, diffSummary: `MCP dry-run ${options.source.toolName}: ${changeSet.diffSummary}` };
    },
    createApproval(changeSetId: string, actor: string, reason: string): BoundChangeSetApproval {
      const changeSet = service.getChangeSet(changeSetId);
      if (!changeSet) throw new Error("unknown_change_set");
      const approvedAt = options.now?.() ?? Date.now();
      return {
        token: `approval-token:${changeSetId}`,
        changeSetId,
        operationIds: changeSet.operations.map((operation) => operation.id),
        beforeHashes: Object.fromEntries(changeSet.operations.map((operation) => [operation.id, operation.beforeHash])),
        afterHashes: Object.fromEntries(changeSet.operations.map((operation) => [operation.id, operation.afterHash])),
        actor,
        reason,
        approvedAt,
        expiresAt: approvedAt + 60_000,
      };
    },
    approve(changeSetId: string, approval: BoundChangeSetApproval) {
      return service.approve(changeSetId, approval);
    },
    apply(changeSetId: string, approval: BoundChangeSetApproval) {
      const changeSet = service.getChangeSet(changeSetId);
      if (!changeSet) throw new Error("unknown_change_set");
      return service.apply({
        changeSetId,
        approval,
        trustedRootId: options.rootId,
        expectedBeforeHashes: Object.fromEntries(changeSet.operations.map((operation) => [operation.id, operation.beforeHash])),
      });
    },
    rollback(changeSetId: string = lastChangeSetId ?? "", expectedCurrentHashes: Record<string, string>) {
      return service.rollback({ changeSetId, expectedCurrentHashes });
    },
    getFile(rootRelativePath: string) {
      return service.getFile(rootRelativePath);
    },
  };
}
