import { describe, expect, it } from "vitest";
import type {
  ApplyChangeSetRequest,
  BoundChangeSetApproval,
  ChangeOperationKind,
  ChangeRiskLevel,
  RepairIntent,
  TextMutationPolicy,
  WorkspaceChangeSetV2,
} from "./mvp12-change-set.js";
import { CHANGE_OPERATION_KINDS, CHANGE_RISK_LEVELS, createDefaultTextMutationPolicy } from "./mvp12-change-set.js";

describe("MVP12 ChangeSet v2 shared contracts", () => {
  it("exports the required operation kinds and risk levels", () => {
    const requiredKinds: ChangeOperationKind[] = [
      "replace_range",
      "insert_after",
      "delete_key",
      "set_json_field",
      "disable_plugin",
      "append_dependency",
    ];
    const requiredRisks: ChangeRiskLevel[] = [
      "low_text",
      "medium_config",
      "high_code",
      "blocked_binary",
      "blocked_root_escape",
    ];

    expect(CHANGE_OPERATION_KINDS).toEqual(requiredKinds);
    expect(CHANGE_RISK_LEVELS).toEqual(requiredRisks);
  });

  it("creates a default policy for allowed UE text mutation files", () => {
    const policy: TextMutationPolicy = createDefaultTextMutationPolicy();

    expect(policy.allowedExtensions).toContain(".ini");
    expect(policy.allowedExtensions).toContain(".Build.cs");
    expect(policy.allowedExtensions).toContain(".Target.cs");
    expect(policy.allowedExtensions).toContain(".uproject");
    expect(policy.blockedDirectories).toEqual(
      expect.arrayContaining(["Binaries", "Intermediate", "Saved", "DerivedDataCache", "node_modules"]),
    );
    expect(policy.approvalRequired).toBe(true);
  });

  it("models approval-gated apply requests and repair proposals without raw roots", () => {
    const changeSet: WorkspaceChangeSetV2 = {
      id: "changeset:test",
      projectId: "project:test",
      state: "approval_required",
      title: "Disable missing plugin",
      operations: [
        {
          id: "operation:test",
          kind: "disable_plugin",
          target: {
            rootId: "root:abc",
            rootRelativePath: "Game.uproject",
            displayPath: "[project-root]/Game.uproject",
            extension: ".uproject",
          },
          beforeHash: "before",
          afterHash: "after",
          risk: "medium_config",
          intent: "disable_missing_plugin",
          sourceDiagnosticIds: ["diag-1"],
          summary: "Set MissingPlugin Enabled to false.",
          unifiedDiff: "--- a/[project-root]/Game.uproject\n+++ b/[project-root]/Game.uproject",
          displayDiff: "- true\n+ false",
        },
      ],
      proposalIds: ["proposal:test"],
      risk: "medium_config",
      diffSummary: "1 config file",
      rollback: null,
      evidenceIds: [],
      createdAt: 1,
      updatedAt: 1,
      redaction: { redacted: true, replacedPaths: 1, replacedSecrets: 0 },
    };
    const approval: BoundChangeSetApproval = {
      token: "approval-token:redacted",
      changeSetId: changeSet.id,
      operationIds: ["operation:test"],
      beforeHashes: { "operation:test": "before" },
      afterHashes: { "operation:test": "after" },
      actor: "implementer",
      reason: "Fix linked MVP11 diagnostic",
      approvedAt: 10,
      expiresAt: 70,
    };
    const request: ApplyChangeSetRequest = {
      changeSetId: changeSet.id,
      approval,
      expectedBeforeHashes: { "operation:test": "before" },
      trustedRootId: "root:abc",
    };
    const intent: RepairIntent = changeSet.operations[0].intent;

    expect(intent).toBe("disable_missing_plugin");
    expect(request.approval.token).toContain("approval-token");
    expect(request.approval.operationIds).toEqual(["operation:test"]);
    expect(request.approval.afterHashes).toEqual({ "operation:test": "after" });
    expect(JSON.stringify(changeSet)).not.toContain("C:/Users/");
  });
});
