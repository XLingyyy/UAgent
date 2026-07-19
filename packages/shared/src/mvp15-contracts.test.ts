import { describe, expect, it } from "vitest";
import type {
  AssetApproval,
  AssetChangeSet,
  AssetChangeSetState,
  AssetDryRunResult,
  AssetExternalBindingStatus,
  AssetExternalEvidenceQuery,
  AssetManifestEntry,
  AssetMutationApprovalRegistrationRequest,
  AssetMutationEvidencePayload,
  AssetMutationOperation,
  AssetMutationOperationKind,
  AssetMutationOperationProvenance,
  AssetMutationPluginExecutionResult,
  AssetMutationRisk,
  AssetRollbackPlan,
  AssetVerificationResult,
  AuditEventType,
  EvidenceKind,
  McpToolDescriptor,
} from "./index.js";
import {
  ASSET_MUTATION_OPERATION_KINDS,
  ASSET_MUTATION_RISKS,
} from "./index.js";

describe("MVP15 asset mutation shared contracts", () => {
  it("preserves an explicit MCP descriptor schema version for live fingerprinting", () => {
    const descriptor: McpToolDescriptor = {
      name: "ue.asset.save",
      schemaVersion: "ue.asset.contract.v1",
      inputSchema: { type: "object" },
    };

    expect(descriptor.schemaVersion).toBe("ue.asset.contract.v1");
  });

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
      runId: "run-1",
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
          status: "pending",
          evidenceId: null,
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
      runId: "run-1",
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

  it("records external dry-run binding provenance, aggregate hashes, and ordered operation binding on ChangeSets and approvals", () => {
    const provenance: AssetMutationOperationProvenance = {
      exactToolName: "ue.asset.duplicate",
      dryRunHash: "a".repeat(40),
      dryRunHashSource: "ue_mcp_exact_tool",
      dryRunHashAlgorithm: "sha1",
      dryRunSchemaVersion: "mvp15c.dry-run.v1",
      argsHash: "sha256:args",
    };
    const operation: AssetMutationOperation = {
      id: "op:duplicate",
      kind: "duplicate_asset",
      assetPathBefore: "/Game/Templates/Hero",
      assetPathAfter: "/Game/UAgentSandbox/run-1/HeroCopy",
      sandboxRoot: "/Game/UAgentSandbox",
      manifestEntryId: null,
      dryRunHash: provenance.dryRunHash,
      argsHash: provenance.argsHash,
      summary: "duplicate sandbox asset",
      blockedReason: null,
      provenance,
    };
    const dryRun: AssetDryRunResult = {
      id: "asset-dry-run:ext-1",
      changeSetId: "asset-changeset-run1",
      status: "dry_run_completed",
      reason: null,
      wouldChange: true,
      operations: [operation],
      risk: "low_sandbox",
      dryRunHash: provenance.dryRunHash,
      argsHash: provenance.argsHash,
      affectedAssets: [operation.assetPathAfter!],
      rollbackPlan: {
        id: "asset-rollback:1",
        changeSetId: "asset-changeset-run1",
        actions: [],
        cleanupRequired: false,
        summary: "rollback",
      },
      externalEvidenceQueries: [],
      redaction: { redacted: true, replacedPaths: 0, replacedSecrets: 0 },
      createdAt: 5,
      externalBindingStatus: "external_bound",
      externalBindingReason: null,
      aggregateDryRunHash: "sha256:aggregate:dry",
      aggregateArgsHash: "sha256:aggregate:args",
    };
    const approval: AssetApproval = {
      approvalId: "asset-approval:ext",
      changeSetId: dryRun.changeSetId,
      projectId: "project:real",
      trustedRootId: "root:trusted",
      editorSessionId: "editor-session:real",
      pidHash: "pid:real",
      runId: "run-1",
      operationKind: operation.kind,
      assetPaths: [operation.assetPathAfter!],
      dryRunHash: operation.dryRunHash,
      argsHash: operation.argsHash,
      manifestEntryIds: [],
      orderedOperationIds: [operation.id],
      orderedOperationKinds: [operation.kind],
      aggregateDryRunHash: dryRun.aggregateDryRunHash,
      aggregateArgsHash: dryRun.aggregateArgsHash,
      externalBindingStatus: "external_bound",
      actor: "desktop-real",
      reason: "real approval bound to aggregate ChangeSet",
      issuedAt: 6,
      expiresAt: 60,
      status: "issued",
      tokenHash: "token:hash",
    };
    const changeSet: AssetChangeSet = {
      id: dryRun.changeSetId,
      projectId: approval.projectId,
      trustedRootId: approval.trustedRootId,
      editorSessionId: approval.editorSessionId,
      pidHash: approval.pidHash,
      dryRunId: dryRun.id,
      runId: "run-1",
      state: "approval_required",
      operations: [operation],
      risk: "low_sandbox",
      approval,
      rollbackPlan: dryRun.rollbackPlan,
      verification: null,
      evidenceIds: [],
      redaction: { redacted: true, replacedPaths: 0, replacedSecrets: 0 },
      externalBindingStatus: "external_bound",
      externalBindingReason: null,
      aggregateDryRunHash: dryRun.aggregateDryRunHash,
      aggregateArgsHash: dryRun.aggregateArgsHash,
    };

    const serialized = JSON.stringify({ dryRun, changeSet, approval });
    const bindingStatus: AssetExternalBindingStatus = "external_bound";

    expect(operation.provenance?.dryRunHashSource).toBe("ue_mcp_exact_tool");
    expect(operation.provenance?.dryRunHashAlgorithm).toBe("sha1");
    expect(operation.provenance?.dryRunSchemaVersion).toBe("mvp15c.dry-run.v1");
    expect(operation.provenance?.dryRunHash).toMatch(/^[0-9a-f]{40}$/);
    expect(dryRun.externalBindingStatus).toBe(bindingStatus);
    expect(approval.orderedOperationIds).toEqual([operation.id]);
    expect(approval.orderedOperationKinds).toEqual(["duplicate_asset"]);
    expect(approval.aggregateDryRunHash).toBe(dryRun.aggregateDryRunHash);
    expect(changeSet.runId).toBe("run-1");
    expect(serialized).not.toContain("rawArgs");
    expect(serialized).not.toContain("approval-token-value");
    expect(serialized).not.toContain("C:/Users/");
  });

  it("keeps caller tokens out of registration requests and makes side effects explicit", () => {
    const registration: AssetMutationApprovalRegistrationRequest = {
      changeSetId: "changeset-1",
      runId: "run-1",
      projectBindingId: "project-1",
      trustedRootRef: "root-ref-1",
      editorSessionId: "editor-1",
      aggregateDryRunHash: "a".repeat(64),
      aggregateArgsHash: "b".repeat(64),
      requestedTtlMs: 60_000,
      operations: [],
    };
    const partial: AssetMutationPluginExecutionResult = {
      blocked: true,
      status: "partial_failure",
      reasonCode: "mutation_failed",
      toolName: "ue.asset.create_folder",
      operation: "create_folder",
      phase: "execute",
      changeSetId: "changeset-1",
      runId: "run-1",
      sandboxRoot: "/Game/UAgentSandbox/run-1",
      sideEffectObserved: true,
      wouldChange: true,
      wouldModify: ["/Game/UAgentSandbox/run-1"],
      wouldRead: [],
      affectedAssets: { readOnlySources: [], sandboxTargets: ["/Game/UAgentSandbox/run-1"], externalTargets: [] },
      rollbackPlan: { strategy: "registry_owned_inverse", executionEnabled: true, inverseOperation: "cleanup_empty_folder" },
      externalEvidenceQueries: [{ queryKind: "asset_registry_snapshot", readOnly: true, paths: ["/Game/UAgentSandbox/run-1"] }],
      dryRunHash: "c".repeat(40),
      hashAlgorithm: "sha1",
      schemaVersion: "mvp15c.dry-run.v1",
      approvalRequired: true,
      evidenceId: "evidence-partial-1",
      rollbackAvailable: true,
      rollbackStatus: "available",
      implementationStatus: "execution_capable",
    };

    expect(registration).not.toHaveProperty("approvalToken");
    expect(registration).not.toHaveProperty("pidHash");
    expect(registration).not.toHaveProperty("observedEditorSessionId");
    expect(registration).not.toHaveProperty("observedPidHash");
    expect(registration).not.toHaveProperty("assetMutationGateEnabled");
    expect(registration.requestedTtlMs).toBe(60_000);
    expect(partial).toMatchObject({ status: "partial_failure", sideEffectObserved: true, rollbackAvailable: true });
  });
});
