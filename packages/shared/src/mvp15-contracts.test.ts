import { describe, expect, it } from "vitest";
import type {
  AssetApproval,
  AssetChangeSet,
  AssetChangeSetState,
  AssetDryRunResult,
  AssetExternalEvidenceQuery,
  AssetManifestEntry,
  AssetMutationEvidencePayload,
  AssetMutationOperation,
  AssetMutationOperationKind,
  AssetMutationRisk,
  AssetRollbackPlan,
  AssetVerificationResult,
  AuditEventType,
  EvidenceKind,
} from "./index.js";
import {
  ASSET_MUTATION_OPERATION_KINDS,
  ASSET_MUTATION_RISKS,
} from "./index.js";

describe("MVP15 asset mutation shared contracts", () => {
  it("models additive asset mutation contracts without raw paths or approval tokens", () => {
    const manifest: AssetManifestEntry = {
      id: "manifest:run-1:folder",
      projectId: "project:fixture",
      editorSessionId: "editor-session:1",
      runId: "run-1",
      assetPath: "/Game/UAgentSandbox/run-1",
      packagePath: "/Content/UAgentSandbox/run-1",
      sourceOperationId: "op:create-folder",
      createdAt: 1,
      currentState: "created",
      rollbackAction: "delete_created",
      evidenceIds: ["evidence:dry-run"],
    };
    const operation: AssetMutationOperation = {
      id: "op:create-folder",
      kind: "create_folder",
      assetPathBefore: null,
      assetPathAfter: "/Game/UAgentSandbox/run-1",
      sandboxRoot: "/Game/UAgentSandbox",
      manifestEntryId: manifest.id,
      dryRunHash: "dry:hash",
      argsHash: "args:hash",
      summary: "Create sandbox folder for run-1",
      blockedReason: null,
    };
    const approval: AssetApproval = {
      approvalId: "asset-approval:1",
      changeSetId: "asset-changeset:1",
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      operationKind: "create_folder",
      assetPaths: [operation.assetPathAfter!],
      dryRunHash: operation.dryRunHash,
      argsHash: operation.argsHash,
      manifestEntryIds: [manifest.id],
      actor: "tester",
      reason: "sandbox smoke",
      issuedAt: 2,
      expiresAt: 20,
      status: "issued",
      tokenHash: "approval-token:hash",
    };
    const rollbackPlan: AssetRollbackPlan = {
      id: "asset-rollback:1",
      changeSetId: "asset-changeset:1",
      actions: [
        {
          id: "rollback:folder",
          operationId: operation.id,
          action: "delete_created",
          assetPath: operation.assetPathAfter!,
          summary: "Remove empty sandbox folder or mark cleanup pending.",
        },
      ],
      cleanupRequired: false,
      summary: "Rollback sandbox-created assets only.",
    };
    const externalEvidenceQueries: AssetExternalEvidenceQuery[] = [
      {
        id: "asset-evidence-query:folder",
        kind: "ue_mcp_asset_state",
        assetPath: operation.assetPathAfter!,
        readOnly: true,
        required: true,
        summary: "Read-only UE/MCP state must confirm sandbox folder exists.",
      },
    ];
    const dryRun: AssetDryRunResult = {
      id: "asset-dry-run:1",
      changeSetId: "asset-changeset:1",
      status: "dry_run_completed",
      reason: null,
      wouldChange: true,
      operations: [operation],
      risk: "low_sandbox",
      dryRunHash: "dry:hash",
      argsHash: "args:hash",
      affectedAssets: [operation.assetPathAfter!],
      rollbackPlan,
      externalEvidenceQueries,
      redaction: { redacted: true, replacedPaths: 0, replacedSecrets: 0 },
      createdAt: 1,
    };
    const verification: AssetVerificationResult = {
      id: "asset-verification:1",
      changeSetId: "asset-changeset:1",
      status: "passed",
      checkedAt: 3,
      checks: [
        {
          id: "verify:folder",
          kind: "asset_exists",
          status: "passed",
          assetPath: operation.assetPathAfter!,
          summary: "Folder exists in sandbox.",
        },
      ],
      evidenceId: "evidence:verify",
      redaction: { redacted: true, replacedPaths: 0, replacedSecrets: 0 },
      summary: "All sandbox checks passed.",
    };
    const changeSet: AssetChangeSet = {
      id: "asset-changeset:1",
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      dryRunId: "asset-dry-run:1",
      state: "approval_required",
      operations: [operation],
      risk: "low_sandbox",
      approval,
      rollbackPlan,
      verification,
      evidenceIds: ["evidence:dry-run", "evidence:verify"],
      redaction: { redacted: true, replacedPaths: 0, replacedSecrets: 0 },
    };
    const payload: AssetMutationEvidencePayload = {
      changeSetId: changeSet.id,
      eventType: "asset_mutation_verified",
      summary: "Verified sandbox-only mutation.",
      affectedAssets: [operation.assetPathAfter!],
      manifestEntryIds: [manifest.id],
      verification,
      redaction: changeSet.redaction,
      replayOnly: true,
    };
    const serialized = JSON.stringify({ dryRun, changeSet, payload });

    expect(operation.kind satisfies AssetMutationOperationKind).toBe("create_folder");
    expect(dryRun.rollbackPlan.actions[0]?.action).toBe("delete_created");
    expect(dryRun.externalEvidenceQueries[0]?.readOnly).toBe(true);
    expect(changeSet.state satisfies AssetChangeSetState).toBe("approval_required");
    expect(changeSet.risk satisfies AssetMutationRisk).toBe("low_sandbox");
    expect(serialized).not.toContain("C:/Users/");
    expect(serialized).not.toContain("/home/");
    expect(serialized).not.toContain("rawArgs");
    expect(serialized).not.toContain("approved-token-value");
    expect(serialized).not.toContain("secret");
  });

  it("declares required operation kinds, risks, evidence kinds, and audit event types", () => {
    expect(ASSET_MUTATION_OPERATION_KINDS).toEqual([
      "create_folder",
      "duplicate_asset",
      "create_test_asset",
      "rename_asset",
      "move_asset",
      "save_single_asset",
      "delete_sandbox_asset",
    ]);
    expect(ASSET_MUTATION_RISKS).toEqual([
      "low_sandbox",
      "medium_sandbox",
      "high_destructive",
      "blocked_non_sandbox",
      "blocked_bulk",
      "blocked_unknown",
    ]);

    const evidenceKinds: EvidenceKind[] = [
      "asset_mutation_plan",
      "asset_mutation_dry_run",
      "asset_changeset_summary",
      "asset_mutation_execution",
      "asset_mutation_verification",
      "asset_mutation_rollback",
    ];
    const auditTypes: AuditEventType[] = [
      "asset_mutation_dry_run",
      "asset_changeset_created",
      "asset_mutation_approved",
      "asset_mutation_executed",
      "asset_mutation_verified",
      "asset_mutation_rolled_back",
    ];

    expect(evidenceKinds).toContain("asset_mutation_verification");
    expect(auditTypes).toContain("asset_mutation_rolled_back");
  });
});
