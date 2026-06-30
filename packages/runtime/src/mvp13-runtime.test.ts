import { describe, expect, it } from "vitest";
import {
  classifyEditorOperation,
  classifyMcpMutationTool,
  createEditorOperationService,
  createEditorSessionRegistry,
  createMcpMutationService,
  createMvp13TextBackedChangeSetBridge,
  mapMcpDryRunToOperation,
  runMvp13ScenarioMatrix,
} from "./index.js";

describe("MVP13 policy classifiers", () => {
  it("allows only read-only or state-only editor operations and blocks asset writes", () => {
    expect(classifyEditorOperation({ operationKind: "status" }).decision).toBe("allow_read_only");
    expect(classifyEditorOperation({ operationKind: "select_asset" }).risk).toBe("state_only");
    expect(classifyEditorOperation({ operationKind: "save_asset" }).risk).toBe("blocked_asset_write");
    expect(classifyEditorOperation({ operationKind: "compile_blueprint" }).decision).toBe("blocked");
  });

  it("blocks mutating MCP tools by default and allows dry-run only for exact allowlist entries", () => {
    const blocked = classifyMcpMutationTool({ name: "ue.asset.delete", annotations: { destructiveHint: true } });
    const allowed = classifyMcpMutationTool(
      { name: "ue.asset.select", annotations: { mutating: true }, inputSchema: { type: "object" } },
      { allowlist: [{ toolName: "ue.asset.select", stateOnly: true, requiresDryRun: true }] },
    );

    expect(blocked.decision).toBe("blocked");
    expect(blocked.reason).toBe("not_allowlisted");
    expect(allowed.decision).toBe("dry_run_required");
    expect(allowed.stateOnly).toBe(true);
  });
});

describe("MVP13 editor session and operation lifecycle", () => {
  it("requires feature gate and trusted root before attach", () => {
    const disabled = createEditorSessionRegistry({ featureEnabled: false, now: () => 1 });
    const enabled = createEditorSessionRegistry({ featureEnabled: true, trustedRootIds: ["root:trusted"], now: () => 1 });

    expect(disabled.attach({ projectId: "p", rootId: "root:trusted", uprojectDisplayPath: "[project-root]/Game.uproject", mode: "fixture" }).status).toBe("blocked");
    expect(enabled.attach({ projectId: "p", rootId: "root:other", uprojectDisplayPath: "[project-root]/Game.uproject", mode: "fixture" }).reason).toBe("untrusted_root");
    expect(enabled.attach({ projectId: "p", rootId: "root:trusted", uprojectDisplayPath: "[project-root]/Game.uproject", mode: "fixture" }).status).toBe("attached");
  });

  it("binds approvals to proposal/session/root/kind/args and rejects replay", () => {
    let now = 100;
    const sessions = createEditorSessionRegistry({ featureEnabled: true, trustedRootIds: ["root:trusted"], now: () => now });
    const session = sessions.attach({ projectId: "p", rootId: "root:trusted", uprojectDisplayPath: "[project-root]/Game.uproject", mode: "fixture" }).session;
    const service = createEditorOperationService({ sessions, now: () => now });
    const proposal = service.propose({ sessionId: session!.sessionId, operationKind: "select_asset", args: { asset: "/Game/Hero" } });
    const approved = service.approve({ proposalId: proposal.proposal!.proposalId, actor: "tester", reason: "state-only fixture selection" });
    const executed = service.execute({
      proposalId: proposal.proposal!.proposalId,
      approvalToken: approved.approval!.token,
      operationKind: "select_asset",
      args: { asset: "/Game/Hero" },
    });
    const replay = service.execute({
      proposalId: proposal.proposal!.proposalId,
      approvalToken: approved.approval!.token,
      operationKind: "select_asset",
      args: { asset: "/Game/Hero" },
    });

    expect(proposal.status).toBe("approval_required");
    expect(approved.status).toBe("approved");
    expect(executed.status).toBe("executed");
    expect(replay.status).toBe("blocked");
    expect(replay.reason).toBe("proposal_not_executable");
    now = 200_000;
    expect(service.propose({ sessionId: session!.sessionId, operationKind: "select_asset", args: {} }).reason).toBe("session_expired");
  });

  it("blocks terminal proposal states from reapproval and execution", () => {
    const sessions = createEditorSessionRegistry({ featureEnabled: true, trustedRootIds: ["root:trusted"], now: () => 100 });
    const session = sessions.attach({ projectId: "p", rootId: "root:trusted", uprojectDisplayPath: "[project-root]/Game.uproject", mode: "fixture" }).session;
    const service = createEditorOperationService({ sessions, now: () => 100 });
    const proposal = service.propose({ sessionId: session!.sessionId, operationKind: "select_asset", args: { asset: "/Game/Hero" } }).proposal!;
    const approved = service.approve({ proposalId: proposal.proposalId, actor: "tester", reason: "state-only fixture selection" }).approval!;

    expect(service.approve({ proposalId: proposal.proposalId, actor: "tester", reason: "second approval" }).reason).toBe("proposal_not_approvable");
    expect(
      service.execute({
        proposalId: proposal.proposalId,
        approvalToken: approved.token,
        operationKind: "select_asset",
        args: { asset: "/Game/Hero" },
      }).status,
    ).toBe("executed");
    expect(service.approve({ proposalId: proposal.proposalId, actor: "tester", reason: "reapprove after execute" }).reason).toBe("proposal_not_approvable");
    expect(
      service.execute({
        proposalId: proposal.proposalId,
        approvalToken: approved.token,
        operationKind: "select_asset",
        args: { asset: "/Game/Hero" },
      }).reason,
    ).toBe("proposal_not_executable");
  });

  it("blocks cancelled proposals, forged tokens, args mismatch, and expired sessions", () => {
    let now = 100;
    const sessions = createEditorSessionRegistry({ featureEnabled: true, trustedRootIds: ["root:trusted"], now: () => now, ttlMs: 100 });
    const session = sessions.attach({ projectId: "p", rootId: "root:trusted", uprojectDisplayPath: "[project-root]/Game.uproject", mode: "fixture" }).session;
    const service = createEditorOperationService({ sessions, now: () => now, ttlMs: 1_000 });

    const cancelBeforeApprove = service.propose({ sessionId: session!.sessionId, operationKind: "select_asset", args: { asset: "/Game/Hero" } }).proposal!;
    service.cancel(cancelBeforeApprove.proposalId);
    expect(service.approve({ proposalId: cancelBeforeApprove.proposalId, actor: "tester", reason: "after cancel" }).reason).toBe("proposal_not_approvable");

    const cancelAfterApprove = service.propose({ sessionId: session!.sessionId, operationKind: "select_asset", args: { asset: "/Game/Hero" } }).proposal!;
    const approved = service.approve({ proposalId: cancelAfterApprove.proposalId, actor: "tester", reason: "before cancel" }).approval!;
    service.cancel(cancelAfterApprove.proposalId);
    expect(
      service.execute({
        proposalId: cancelAfterApprove.proposalId,
        approvalToken: approved.token,
        operationKind: "select_asset",
        args: { asset: "/Game/Hero" },
      }).reason,
    ).toBe("proposal_not_executable");

    const mismatch = service.propose({ sessionId: session!.sessionId, operationKind: "select_asset", args: { asset: "/Game/Hero" } }).proposal!;
    const mismatchApproval = service.approve({ proposalId: mismatch.proposalId, actor: "tester", reason: "mismatch checks" }).approval!;
    expect(service.execute({ proposalId: mismatch.proposalId, approvalToken: "forged", operationKind: "select_asset", args: { asset: "/Game/Hero" } }).reason).toBe("forged_token");
    expect(service.execute({ proposalId: mismatch.proposalId, approvalToken: mismatchApproval.token, operationKind: "select_asset", args: { asset: "/Game/Villain" } }).reason).toBe("args_hash_mismatch");
    now = 250;
    expect(service.execute({ proposalId: mismatch.proposalId, approvalToken: mismatchApproval.token, operationKind: "select_asset", args: { asset: "/Game/Hero" } }).reason).toBe("session_expired");
  });
});

describe("MVP13 MCP mutation dry-run mapping and scenario matrix", () => {
  it("maps text-backed dry-runs into ChangeSet v2 and asset-risk dry-runs into blocked plans", () => {
    const text = mapMcpDryRunToOperation({
      id: "dry:text",
      toolName: "ue.config.patch",
      wouldChange: true,
      operationKind: "patch_text_file",
      affectedFiles: ["Config/DefaultGame.ini"],
      assetRisk: false,
      textBacked: true,
      stateOnly: false,
      blockedReason: null,
      summary: "Would patch config",
      redaction: { redacted: true, replacedPaths: 1, replacedSecrets: 0 },
      createdAt: 1,
    });
    const asset = mapMcpDryRunToOperation({
      id: "dry:asset",
      toolName: "ue.asset.save",
      wouldChange: true,
      operationKind: "save_asset",
      affectedFiles: ["Content/Hero.uasset"],
      assetRisk: true,
      textBacked: false,
      stateOnly: false,
      blockedReason: null,
      summary: "Would save asset",
      redaction: { redacted: true, replacedPaths: 1, replacedSecrets: 0 },
      createdAt: 1,
    });

    expect(text.kind).toBe("changeset_v2");
    expect(asset.kind).toBe("asset_plan_blocked");
  });

  it("redacts MCP args and never calls tools/call for mutating execution", () => {
    const service = createMcpMutationService({
      allowlist: [{ toolName: "ue.asset.select", stateOnly: true, requiresDryRun: true }],
      now: () => 1,
    });
    const dryRun = service.dryRun({
      tool: { name: "ue.asset.select", annotations: { mutating: true }, inputSchema: { type: "object" } },
      args: { asset: "/Game/Hero", token: "sk-secret" },
      sessionId: "editor-session:1",
      projectId: "project:1",
      rootId: "root:1",
    });

    expect(dryRun.status).toBe("dry_run_completed");
    expect(JSON.stringify(dryRun)).not.toContain("sk-secret");
    expect(service.getReplaySummary(dryRun.result!.id).recordedOnlyActions).toEqual(["dry_run"]);
  });

  it("bridges MCP-origin text changes through MVP12 ChangeSet v2 apply and rollback", () => {
    const bridge = createMvp13TextBackedChangeSetBridge({
      projectId: "project:1",
      rootId: "root:1",
      files: { "Config/DefaultGame.ini": "ProjectName=Old\n" },
      createdAt: 1,
      source: { dryRunId: "mcp-dry-run:1", toolName: "ue.config.patch" },
    });
    const changeSet = bridge.previewTextChanges([
      {
        rootRelativePath: "Config/DefaultGame.ini",
        before: "ProjectName=Old\n",
        after: "ProjectName=New\n",
        summary: "Patch project name from dry-run.",
      },
    ]);
    const approval = bridge.createApproval(changeSet.id, "tester", "MCP dry-run text-backed preview approved.");
    bridge.approve(changeSet.id, approval);
    const applied = bridge.apply(changeSet.id, approval);
    const rolledBack = bridge.rollback(changeSet.id, applied.afterHashes);

    expect(changeSet.state).toBe("approval_required");
    expect(changeSet.diffSummary).toContain("MCP dry-run");
    expect(applied.status).toBe("applied");
    expect(rolledBack.status).toBe("rolled_back");
    expect(bridge.getFile("Config/DefaultGame.ini")).toBe("ProjectName=Old\n");
  });

  it("covers at least 32 MVP13 scenarios and 128 assertions", () => {
    const matrix = runMvp13ScenarioMatrix();

    expect(matrix.scenarios.length).toBeGreaterThanOrEqual(32);
    expect(matrix.totalAssertions).toBeGreaterThanOrEqual(128);
    expect(matrix.scenarios.every((scenario) => scenario.pass)).toBe(true);
  });
});
