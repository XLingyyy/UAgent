import { describe, expect, it } from "vitest";
import type {
  McpMutationDryRunResult,
  McpMutationToolPolicy,
  UEEditorOperationProposal,
  UEEditorOperationResult,
  UEEditorOperationRisk,
  UEEditorSession,
} from "./index.js";
import {
  MCP_MUTATION_EXECUTION_DECISIONS,
  UE_EDITOR_OPERATION_RISKS,
} from "./index.js";

describe("MVP13 shared contracts", () => {
  it("exports the controlled UE Editor risk ladder", () => {
    const risks: UEEditorOperationRisk[] = [
      "read_only",
      "state_only",
      "text_backed_change",
      "medium_editor_state",
      "high_asset_risk",
      "blocked_asset_write",
      "blocked_unknown",
    ];

    expect(UE_EDITOR_OPERATION_RISKS).toEqual(risks);
  });

  it("models editor sessions and operation proposals without raw paths or tokens", () => {
    const session: UEEditorSession = {
      sessionId: "editor-session:1",
      projectId: "project:lyra",
      rootId: "root:trusted",
      uprojectDisplayPath: "[project-root]/Lyra.uproject",
      mode: "fixture",
      status: "attached",
      createdAt: 10,
      expiresAt: 70,
      replayOnly: false,
    };
    const proposal: UEEditorOperationProposal = {
      proposalId: "editor-operation:1",
      sessionId: session.sessionId,
      projectId: session.projectId,
      rootId: session.rootId,
      operationKind: "select_asset",
      argsHash: "hash:args",
      risk: "state_only",
      status: "approval_required",
      summary: "Select [project-root]/Content/Hero.Hero",
      redaction: { redacted: true, replacedPaths: 1, replacedSecrets: 0 },
      createdAt: 20,
      expiresAt: 60,
    };
    const result: UEEditorOperationResult = {
      proposalId: proposal.proposalId,
      status: "executed",
      outputSummary: "Selected asset in fixture editor.",
      durationMs: 12,
      redaction: { redacted: true, replacedPaths: 0, replacedSecrets: 0 },
      evidenceId: "evidence:editor:1",
      executedAt: 30,
      replayOnly: false,
    };

    const serialized = JSON.stringify({ session, proposal, result });
    expect(serialized).not.toContain("C:/Users/");
    expect(serialized).not.toContain("approval-token:");
    expect(result.outputSummary).toContain("Selected");
  });

  it("models MCP mutation dry-run decisions with redacted summaries", () => {
    const policy: McpMutationToolPolicy = {
      toolName: "ue.asset.select",
      classification: "mutating",
      allowlisted: true,
      requiresDryRun: true,
      textBacked: false,
      stateOnly: true,
      assetRisk: false,
      decision: "dry_run_required",
      reason: "allowlisted_state_only",
    };
    const dryRun: McpMutationDryRunResult = {
      id: "mcp-dry-run:1",
      toolName: policy.toolName,
      wouldChange: true,
      operationKind: "select_asset",
      affectedFiles: [],
      assetRisk: false,
      textBacked: false,
      stateOnly: true,
      blockedReason: null,
      summary: "Would select asset in active editor session.",
      redaction: { redacted: true, replacedPaths: 0, replacedSecrets: 1 },
      createdAt: 40,
    };

    expect(MCP_MUTATION_EXECUTION_DECISIONS).toContain("blocked");
    expect(policy.decision).toBe("dry_run_required");
    expect(JSON.stringify(dryRun)).not.toContain("sk-");
  });
});
