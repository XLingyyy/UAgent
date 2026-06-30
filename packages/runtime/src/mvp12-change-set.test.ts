import { describe, expect, it } from "vitest";
import type { ApplyChangeSetRequest, ProjectDiagnostic } from "@uagent/shared";
import {
  classifyTextMutationTarget,
  createChangeSetServiceV2,
  createRepairProposalEngine,
  createSha256Hash,
  redactMvp12Text,
  renderUnifiedDiff,
  runMvp12ScenarioMatrix,
} from "./mvp12-change-set.js";

const pluginDiagnostic: ProjectDiagnostic = {
  id: "diag-plugin",
  kind: "plugin_descriptor_missing",
  severity: "warning",
  title: "Plugin descriptor missing",
  message: "MissingPlugin is enabled but no descriptor was indexed.",
  displayPath: "[project-root]/Plugins/MissingPlugin/MissingPlugin.uplugin",
  evidence: [],
  createdAt: 1,
};

type BoundChangeSetApproval = ApplyChangeSetRequest["approval"];

describe("MVP12 text mutation policy and diff", () => {
  it("allows UE text files and blocks binary/root escape targets", () => {
    expect(classifyTextMutationTarget("root:fixture", "Config/DefaultGame.ini").allowed).toBe(true);
    expect(classifyTextMutationTarget("root:fixture", "Content/Hero.uasset").reason).toBe("blocked_binary");
    expect(classifyTextMutationTarget("root:fixture", "../Config/DefaultGame.ini").reason).toBe("root_escape");
    expect(classifyTextMutationTarget("root:fixture", "Intermediate/Cache.ini").reason).toBe("blocked_directory");
  });

  it("hashes content, renders unified diff, and redacts roots/secrets", () => {
    const before = "Authorization=Bearer sk-before\nValue=true\n";
    const after = "Authorization=\nValue=false\n";
    const diff = renderUnifiedDiff({
      displayPath: "[project-root]/Config/DefaultGame.ini",
      before,
      after,
      projectRoot: "C:/Users/Alice/Game",
    });
    const redacted = redactMvp12Text("C:/Users/Alice/Game/Config/DefaultGame.ini token=abc", "C:/Users/Alice/Game");

    expect(createSha256Hash(before)).toHaveLength(64);
    expect(createSha256Hash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(diff.unifiedDiff).toContain("--- a/[project-root]/Config/DefaultGame.ini");
    expect(diff.unifiedDiff).not.toContain("sk-before");
    expect(redacted.text).toBe("[project-root]/Config/DefaultGame.ini token=[REDACTED]");
  });
});

describe("MVP12 repair proposal engine and lifecycle", () => {
  it("creates deterministic proposals for repairable diagnostics", () => {
    const proposal = createRepairProposalEngine().propose({
      diagnostics: [pluginDiagnostic],
      files: {
        "Game.uproject": '{ "Plugins": [{ "Name": "MissingPlugin", "Enabled": true }] }\n',
      },
      projectId: "project:test",
      rootId: "root:test",
    })[0];

    expect(proposal.recipe.id).toBe("R-PLUGIN-DISABLE");
    expect(proposal.risk).toBe("medium_config");
    expect(proposal.operations[0].kind).toBe("disable_plugin");
    expect(proposal.explanation).not.toContain("C:/Users/");
  });

  it("moves a change set through preview, approval, apply, verify, rollback, and replay summaries", () => {
    const service = createChangeSetServiceV2({
      projectId: "project:test",
      rootId: "root:test",
      files: {
        "Game.uproject": '{ "Plugins": [{ "Name": "MissingPlugin", "Enabled": true }] }\n',
      },
    });
    const proposal = service.propose([pluginDiagnostic])[0];
    const previewed = service.preview(proposal.id);
    const approval: BoundChangeSetApproval = {
      token: "approval-token:test",
      changeSetId: previewed.id,
      operationIds: previewed.operations.map((operation) => operation.id),
      beforeHashes: Object.fromEntries(previewed.operations.map((operation) => [operation.id, operation.beforeHash])),
      afterHashes: Object.fromEntries(previewed.operations.map((operation) => [operation.id, operation.afterHash])),
      actor: "implementer",
      reason: "Fix linked diagnostic",
      approvedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    const approved = service.approve(previewed.id, approval);
    const applied = service.apply({
      changeSetId: approved.id,
      approval,
      trustedRootId: "root:test",
      expectedBeforeHashes: Object.fromEntries(approved.operations.map((op) => [op.id, op.beforeHash])),
    });
    const verified = service.verify(applied.changeSetId, { command: "pnpm test", exitCode: 0, outputSummary: "pass" });
    const replay = service.createReplaySummary(verified.changeSetId);
    const rolledBack = service.rollback({ changeSetId: verified.changeSetId, expectedCurrentHashes: applied.afterHashes });

    expect(applied.status).toBe("applied");
    expect(verified.status).toBe("verified");
    expect(replay.replaySafe).toBe(true);
    expect(replay.recordedOnlyActions).toEqual(["preview", "apply", "verify"]);
    expect(rolledBack.status).toBe("rolled_back");
    expect(service.getFile("Game.uproject")).toContain('"Enabled": true');
  });

  it("rejects unbound, expired, and replayed approvals", () => {
    let now = 1_500;
    const service = createChangeSetServiceV2({
      projectId: "project:test",
      rootId: "root:test",
      files: {
        "Game.uproject": '{ "Plugins": [{ "Name": "MissingPlugin", "Enabled": true }] }\n',
      },
      createdAt: 1_000,
      now: () => now,
    });
    const previewed = service.preview(service.propose([pluginDiagnostic])[0].id);
    const baseApproval: BoundChangeSetApproval = {
      token: "approval-token:test",
      changeSetId: previewed.id,
      operationIds: previewed.operations.map((operation) => operation.id),
      beforeHashes: Object.fromEntries(previewed.operations.map((operation) => [operation.id, operation.beforeHash])),
      afterHashes: Object.fromEntries(previewed.operations.map((operation) => [operation.id, operation.afterHash])),
      actor: "implementer",
      reason: "Fix linked diagnostic",
      approvedAt: 1_100,
      expiresAt: 2_000,
    };

    expect(() => service.approve(previewed.id, { ...baseApproval, token: "wrong-token" })).toThrow("approval_required");
    expect(() => service.approve(previewed.id, { ...baseApproval, changeSetId: "changeset:other" })).toThrow("approval_change_set_mismatch");
    expect(() => service.approve(previewed.id, { ...baseApproval, beforeHashes: { [previewed.operations[0].id]: "wrong" } })).toThrow("approval_hash_mismatch");
    expect(() => service.approve(previewed.id, { ...baseApproval, afterHashes: { [previewed.operations[0].id]: "wrong" } })).toThrow("approval_hash_mismatch");
    expect(() => service.approve(previewed.id, { ...baseApproval, expiresAt: 1_050 })).toThrow("approval_expired");
    expect(() => service.approve(previewed.id, { ...baseApproval, actor: "" })).toThrow("approval_actor_required");
    now = 2_500;
    expect(() => service.approve(previewed.id, { ...baseApproval, token: "approval-token:expired-now" })).toThrow("approval_expired");
    now = 1_500;
    const approved = service.approve(previewed.id, baseApproval);
    const applied = service.apply({
      changeSetId: approved.id,
      approval: baseApproval,
      trustedRootId: "root:test",
      expectedBeforeHashes: Object.fromEntries(approved.operations.map((op) => [op.id, op.beforeHash])),
    });

    expect(applied.status).toBe("applied");
    expect(service.apply({
      changeSetId: approved.id,
      approval: baseApproval,
      trustedRootId: "root:test",
      expectedBeforeHashes: Object.fromEntries(approved.operations.map((op) => [op.id, op.beforeHash])),
    }).status).toBe("blocked");
  });

  it("does not leak raw secrets in proposals, preview, evidence, or verification status", () => {
    const diagnostic: ProjectDiagnostic = {
      id: "diag-config",
      kind: "config_secret_redacted",
      severity: "warning",
      title: "Secret",
      message: "Authorization=Bearer sk-secret was found.",
      displayPath: "[project-root]/Config/DefaultGame.ini",
      evidence: [],
      createdAt: 1,
    };
    const service = createChangeSetServiceV2({
      projectId: "project:test",
      rootId: "root:test",
      files: {
        "Config/DefaultGame.ini": "Authorization=Bearer sk-secret\nValue=true\n",
      },
    });
    const proposal = service.propose([diagnostic])[0];
    const previewed = service.preview(proposal.id);
    const serialized = JSON.stringify({ proposal, previewed });

    expect(proposal.operations).toHaveLength(1);
    expect(serialized).not.toContain("sk-secret");
    expect(serialized).not.toContain("Bearer sk-secret");
    expect(serialized).toContain("[REDACTED]");
  });

  it("blocks multi-file rollback when expected hashes are swapped and writes no files", () => {
    const files = {
      "Game.uproject": '{ "Plugins": [{ "Name": "MissingPlugin", "Enabled": true }] }\n',
      "Config/DefaultGame.ini": "Authorization=Bearer sk-secret\nValue=true\n",
    };
    const diagnostics: ProjectDiagnostic[] = [
      pluginDiagnostic,
      {
        id: "diag-config",
        kind: "config_secret_redacted",
        severity: "warning",
        title: "Secret",
        message: "Authorization was redacted.",
        displayPath: "[project-root]/Config/DefaultGame.ini",
        evidence: [],
        createdAt: 1,
      },
    ];
    const service = createChangeSetServiceV2({ projectId: "project:test", rootId: "root:test", files });
    const proposals = service.propose(diagnostics);
    const combined = service.previewProposals([proposals[0].id, proposals[1].id]);
    const approval: BoundChangeSetApproval = {
      token: "approval-token:combined",
      changeSetId: combined.id,
      operationIds: combined.operations.map((operation) => operation.id),
      beforeHashes: Object.fromEntries(combined.operations.map((operation) => [operation.id, operation.beforeHash])),
      afterHashes: Object.fromEntries(combined.operations.map((operation) => [operation.id, operation.afterHash])),
      actor: "implementer",
      reason: "Fix linked diagnostics",
      approvedAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    service.approve(combined.id, approval);
    const applied = service.apply({
      changeSetId: combined.id,
      approval,
      trustedRootId: "root:test",
      expectedBeforeHashes: approval.beforeHashes,
    });
    const entries = Object.entries(applied.afterHashes);
    const swapped = { [entries[0][0]]: entries[1][1], [entries[1][0]]: entries[0][1] };
    const rollback = service.rollback({ changeSetId: combined.id, expectedCurrentHashes: swapped });

    expect(rollback.status).toBe("conflict");
    expect(service.getFile("Game.uproject")).toContain('"Enabled": false');
    expect(service.getFile("Config/DefaultGame.ini")).toContain("[REDACTED]");
  });

  it("covers at least 24 scenarios and 90 assertions", () => {
    const matrix = runMvp12ScenarioMatrix();

    expect(matrix.scenarios).toHaveLength(24);
    expect(matrix.totalAssertions).toBeGreaterThanOrEqual(90);
    expect(matrix.scenarios.every((scenario) => scenario.pass)).toBe(true);
  });
});
