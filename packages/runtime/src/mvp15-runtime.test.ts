import { describe, expect, it } from "vitest";
import {
  classifyMvp15McpAssetTool,
  createMvp15ExactToolFacade,
  createAssetChangeSetService,
  createAssetManifestRegistry,
  createFixtureAssetMutationAdapter,
  createMvp15McpAssetMutationAdapter,
  createMvp15McpAssetToolInventory,
  createMvp15ScenarioMatrix,
  createSandboxAssetPathPolicy,
  replayAssetMutationSummary,
  verifyAssetExists,
  verifyAssetMoved,
  verifySingleAssetSaved,
  type AssetMutationAdapter,
  type AssetMutationVerificationAdapter,
} from "./index.js";

function createReadyService() {
  return createAssetChangeSetService({
    now: (() => {
      let tick = 1;
      return () => tick++;
    })(),
    manifest: createAssetManifestRegistry(),
    adapter: createFixtureAssetMutationAdapter(),
  });
}

async function executeApprovedChangeSet(
  service: ReturnType<typeof createAssetChangeSetService>,
  operations: Parameters<typeof service.dryRun>[0]["operations"],
  runId = "run-1",
) {
  const dryRun = service.dryRun({
    projectId: "project:fixture",
    trustedRootId: "root:fixture",
    editorSessionId: "editor-session:1",
    pidHash: "pid:fixture",
    runId,
    operations,
  });
  service.preview(dryRun.changeSet.id);
  const approval = service.approve({ changeSetId: dryRun.changeSet.id, actor: "tester", reason: "verify" });
  const executed = await service.execute({
    changeSetId: dryRun.changeSet.id,
    approvalToken: approval.approvalToken!,
    editorSessionId: "editor-session:1",
    pidHash: "pid:fixture",
  });
  return { dryRun, approval, executed };
}

describe("MVP15 sandbox asset policy", () => {
  it("allows only canonical UAgentSandbox game/content paths and blocks escapes", () => {
    const policy = createSandboxAssetPathPolicy();

    expect(policy.validateAssetPath("/Game/UAgentSandbox/run-1/Folder").ok).toBe(true);
    expect(policy.validatePackagePath("/Content/UAgentSandbox/run-1/Folder").ok).toBe(true);
    expect(policy.mapContentPathToAssetPath("/Content/UAgentSandbox/run-1/Folder")).toBe("/Game/UAgentSandbox/run-1/Folder");
    expect(policy.validateAssetPath("/Game/Characters/Hero").reason).toBe("non_sandbox_path");
    expect(policy.validateAssetPath("/Game/UAgentSandbox/../Hero").reason).toBe("path_traversal");
    expect(policy.validateAssetPath("/Game/UAgentSandbox//Hero").reason).toBe("empty_segment");
    expect(policy.validateAssetPath("/Engine/UAgentSandbox/Hero").reason).toBe("engine_content_blocked");
    expect(policy.validateAssetPath("/Plugin/UAgentSandbox/Hero").reason).toBe("plugin_content_blocked");
    expect(policy.validateRunId("run-1_ABC").ok).toBe(true);
    expect(policy.validateRunId("../run").reason).toBe("invalid_run_id");
  });
});

describe("MVP15 manifest registry", () => {
  it("tracks only UAgent-managed sandbox assets and binds rollback state", () => {
    const registry = createAssetManifestRegistry();
    const created = registry.registerCreated({
      projectId: "project:fixture",
      editorSessionId: "editor-session:1",
      runId: "run-1",
      assetPath: "/Game/UAgentSandbox/run-1/Hero",
      sourceOperationId: "op:create",
      evidenceId: "evidence:create",
    });

    registry.markRenamed(created.id, "/Game/UAgentSandbox/run-1/HeroRenamed", "op:rename", "evidence:rename");
    registry.markMoved(created.id, "/Game/UAgentSandbox/run-1/Sub/HeroRenamed", "op:move", "evidence:move");
    registry.markSaved(created.id, "evidence:save");
    registry.markDeleted(created.id, "evidence:delete");
    registry.rollbackState(created.id, "evidence:rollback");

    const entry = registry.get(created.id)!;
    expect(entry.assetPath).toBe("/Game/UAgentSandbox/run-1/Sub/HeroRenamed");
    expect(entry.currentState).toBe("rolled_back");
    expect(entry.rollbackAction).toBe("none");
    expect(JSON.stringify(entry)).not.toContain("C:/Users/");
    expect(() => registry.markDeleted("missing", "evidence")).toThrow(/manifest_entry_required/);
  });
});

describe("MVP15 MCP exact allowlist", () => {
  it("requires exact tool names, schemas, dry-run support, and sandbox arguments", () => {
    const fullContracts = {
      inputSchema: { type: "object" },
      dryRunSchema: { type: "object" },
      rollbackContract: { type: "reverse_operation" },
      affectedAssetsSchema: { type: "array" },
      evidenceQuery: { type: "read_only" },
    };

    expect(classifyMvp15McpAssetTool({ toolName: "ue.asset.create_folder", ...fullContracts }).decision).toBe("dry_run_required");
    expect(classifyMvp15McpAssetTool({ toolName: "ue.asset.compile_blueprint", ...fullContracts }).reason).toBe("not_allowlisted");
    expect(classifyMvp15McpAssetTool({ toolName: "ue.asset.save", ...fullContracts, inputSchema: null }).reason).toBe("schema_required");
    expect(classifyMvp15McpAssetTool({ toolName: "ue.asset.save", ...fullContracts, dryRunSchema: null }).reason).toBe("dry_run_required");
    expect(classifyMvp15McpAssetTool({ toolName: "ue.asset.save", ...fullContracts, rollbackContract: null }).reason).toBe("rollback_contract_required");
    expect(classifyMvp15McpAssetTool({ toolName: "ue.asset.save", ...fullContracts, evidenceQuery: null }).reason).toBe("external_evidence_required");
    expect(classifyMvp15McpAssetTool({ toolName: "ue.asset.save", ...fullContracts, args: { assetPath: "/Game/Hero" } }).reason).toBe("sandbox_path_required");
  });

  it("allows duplicate from an explicit read-only non-sandbox source only when the target stays in sandbox", () => {
    const fullContracts = {
      inputSchema: { type: "object" },
      dryRunSchema: { type: "object" },
      rollbackContract: { type: "reverse_operation" },
      affectedAssetsSchema: { type: "array" },
      evidenceQuery: { type: "read_only" },
    };
    const legalDuplicate = classifyMvp15McpAssetTool({
      toolName: "ue.asset.duplicate",
      ...fullContracts,
      args: {
        sourceAssetPath: "/Game/Templates/Hero",
        targetAssetPath: "/Game/UAgentSandbox/run-1/HeroCopy",
      },
    });
    const unsafeTarget = classifyMvp15McpAssetTool({
      toolName: "ue.asset.duplicate",
      ...fullContracts,
      args: {
        sourceAssetPath: "/Game/Templates/Hero",
        targetAssetPath: "/Game/Characters/HeroCopy",
      },
    });

    expect(legalDuplicate.decision).toBe("dry_run_required");
    expect(legalDuplicate.reason).toBe("exact_asset_allowlist");
    expect(unsafeTarget.decision).toBe("blocked");
    expect(unsafeTarget.reason).toBe("sandbox_path_required");
  });

  it("reports exact asset tool inventory gaps for supervisor smoke decisions", () => {
    const fullContracts = {
      rollbackContract: { type: "reverse_operation" },
      affectedAssetsSchema: { type: "array" },
      evidenceQuery: { type: "read_only" },
    };
    const inventory = createMvp15McpAssetToolInventory([
      { name: "ue.asset.create_folder", inputSchema: { type: "object" }, dryRunSchema: { type: "object" }, ...fullContracts },
      { name: "ue.asset.duplicate", inputSchema: { type: "object" }, dryRunSchema: { type: "object" }, ...fullContracts },
      { name: "ue.asset.rename", inputSchema: { type: "object" }, ...fullContracts },
      { name: "ue.asset.save", dryRunSchema: { type: "object" }, ...fullContracts },
    ]);

    expect(inventory.status).toBe("blocked_by_mcp_schema");
    expect(inventory.availableTools).toEqual(["ue.asset.create_folder", "ue.asset.duplicate"]);
    expect(inventory.missingTools).toEqual(["ue.asset.move", "ue.asset.delete"]);
    expect(inventory.missingSchemas).toEqual(["ue.asset.save"]);
    expect(inventory.missingDryRunSchemas).toEqual(["ue.asset.rename"]);
  });

  it("blocks inventory when rollback contracts or external evidence queries are missing", () => {
    const baseTool = { inputSchema: { type: "object" }, dryRunSchema: { type: "object" } };
    const completeTool = {
      ...baseTool,
      rollbackContract: { type: "reverse_operation" },
      affectedAssetsSchema: { type: "array" },
      evidenceQuery: { type: "read_only" },
    };
    const inventory = createMvp15McpAssetToolInventory([
      { name: "ue.asset.create_folder", ...completeTool },
      { name: "ue.asset.duplicate", ...completeTool },
      { name: "ue.asset.rename", ...completeTool },
      { name: "ue.asset.move", ...baseTool, evidenceQuery: { type: "read_only" }, affectedAssetsSchema: { type: "array" } },
      { name: "ue.asset.delete", ...baseTool, rollbackContract: { type: "reverse_operation" }, affectedAssetsSchema: { type: "array" } },
      { name: "ue.asset.save", ...completeTool },
    ]);

    expect(inventory.status).toBe("blocked_by_mcp_schema");
    expect(inventory.missingRollbackContracts).toEqual(["ue.asset.move"]);
    expect(inventory.missingEvidenceQueries).toEqual(["ue.asset.delete"]);
    expect(inventory.availableTools).not.toContain("ue.asset.move");
    expect(inventory.availableTools).not.toContain("ue.asset.delete");
  });

  it("builds an exact-tool facade only from fully described wrapper toolset methods", () => {
    const facade = createMvp15ExactToolFacade([
      {
        toolsetId: "editor_toolset.toolsets.asset.AssetTools",
        methods: [
          {
            exactToolName: "ue.asset.create_folder",
            methodId: "create_folder",
            schemaVersion: "2026-07-09",
            inputSchema: { type: "object" },
            dryRunSchema: { type: "object" },
            rollbackContract: { type: "delete_created" },
            affectedAssetsSchema: { type: "array" },
            evidenceQuery: { type: "read_only_asset_state" },
          },
          {
            exactToolName: "ue.asset.duplicate",
            methodId: "duplicate",
            schemaVersion: "2026-07-09",
            inputSchema: { type: "object" },
            dryRunSchema: { type: "object" },
            rollbackContract: { type: "delete_created" },
            affectedAssetsSchema: { type: "array" },
            evidenceQuery: { type: "read_only_asset_state" },
          },
          {
            exactToolName: "ue.asset.rename",
            methodId: "rename",
            schemaVersion: "2026-07-09",
            inputSchema: { type: "object" },
            dryRunSchema: { type: "object" },
            rollbackContract: { type: "rename_back" },
            affectedAssetsSchema: { type: "array" },
            evidenceQuery: { type: "read_only_asset_state" },
          },
          {
            exactToolName: "ue.asset.move",
            methodId: "move",
            schemaVersion: "2026-07-09",
            inputSchema: { type: "object" },
            dryRunSchema: { type: "object" },
            rollbackContract: { type: "move_back" },
            affectedAssetsSchema: { type: "array" },
            evidenceQuery: { type: "read_only_asset_state" },
          },
          {
            exactToolName: "ue.asset.save",
            methodId: "save",
            schemaVersion: "2026-07-09",
            inputSchema: { type: "object" },
            dryRunSchema: { type: "object" },
            rollbackContract: { type: "save_single_restore" },
            affectedAssetsSchema: { type: "array" },
            evidenceQuery: { type: "read_only_asset_state" },
          },
          {
            exactToolName: "ue.asset.delete",
            methodId: "delete",
            schemaVersion: "2026-07-09",
            inputSchema: { type: "object" },
            dryRunSchema: { type: "object" },
            rollbackContract: { type: "restore_from_trash" },
            affectedAssetsSchema: { type: "array" },
          },
        ],
      },
    ]);

    expect(facade.status).toBe("blocked_by_mcp_schema");
    expect(facade.tools.map((tool) => tool.name)).toEqual([
      "ue.asset.create_folder",
      "ue.asset.duplicate",
      "ue.asset.rename",
      "ue.asset.move",
      "ue.asset.save",
    ]);
    expect(facade.inventory.missingEvidenceQueries).toEqual(["ue.asset.delete"]);
    expect(facade.tools[0]?.annotations?.mvp15Facade).toMatchObject({
      wrapperToolName: "call_tool",
      toolsetId: "editor_toolset.toolsets.asset.AssetTools",
      methodId: "create_folder",
      schemaVersion: "2026-07-09",
    });
  });
});

describe("MVP15 asset ChangeSet service", () => {
  it("blocks real adapter execution before native guard or MCP call when exact schema is missing", async () => {
    const nativeGuardCalls: string[] = [];
    const mcpCalls: string[] = [];
    const service = createAssetChangeSetService({
      executionMode: "real",
      manifest: createAssetManifestRegistry(),
      adapter: createMvp15McpAssetMutationAdapter({
        tools: [{ name: "ue.asset.create_folder", inputSchema: { type: "object" } }],
        assetMutationGateEnabled: true,
        observedEditorSessionId: "editor-session:1",
        observedPidHash: "pid:fixture",
        nativeGuard: (input) => {
          nativeGuardCalls.push(input.toolName);
          return { status: "accepted_by_native_guard", reason: "sandbox_guard_passed", evidenceId: "guard:evidence" };
        },
        callTool: (toolName) => {
          mcpCalls.push(toolName);
          return { status: "executed", reason: null, evidenceId: `mcp:${toolName}` };
        },
      }),
    });

    const { executed } = await executeApprovedChangeSet(service, [
      { kind: "create_folder", assetPathAfter: "/Game/UAgentSandbox/run-1" },
    ]);

    expect(executed.status).toBe("failed");
    expect(executed.reason).toBe("blocked_by_mcp_schema:dry_run_required:ue.asset.create_folder");
    expect(executed.changeSet?.state).toBe("failed");
    expect(nativeGuardCalls).toEqual([]);
    expect(mcpCalls).toEqual([]);
  });

  it("real adapter calls native guard before exact MCP tools and verifies with external evidence", async () => {
    const events: string[] = [];
    const tools = [
      "ue.asset.create_folder",
      "ue.asset.duplicate",
      "ue.asset.rename",
      "ue.asset.move",
      "ue.asset.delete",
      "ue.asset.save",
    ].map((name) => ({
      name,
      inputSchema: { type: "object" },
      dryRunSchema: { type: "object" },
      rollbackContract: { type: "reverse_operation" },
      affectedAssetsSchema: { type: "array" },
      evidenceQuery: { type: "read_only" },
    }));
    const verifier: AssetMutationVerificationAdapter = {
      verify: (changeSet) => ({
        id: "asset-verification:real",
        changeSetId: changeSet.id,
        status: "passed",
        checkedAt: 10,
        evidenceId: "asset-evidence:real-verify",
        redaction: { redacted: true, replacedPaths: 0, replacedSecrets: 0 },
        summary: "Verified through read-only UE/MCP asset state.",
        checks: [
          { id: "exists", kind: "asset_exists", status: "passed", assetPath: "/Game/UAgentSandbox/run-1/HeroCopy", summary: "duplicate target exists" },
          { id: "renamed", kind: "asset_moved", status: "passed", assetPath: "/Game/UAgentSandbox/run-1/HeroRenamed", summary: "old rename path absent and new path exists" },
          { id: "moved", kind: "asset_moved", status: "passed", assetPath: "/Game/UAgentSandbox/run-1/Sub/HeroRenamed", summary: "old move path absent and new path exists" },
          { id: "saved", kind: "single_asset_saved", status: "passed", assetPath: "/Game/UAgentSandbox/run-1/Sub/HeroRenamed", summary: "single asset save observed" },
          { id: "source", kind: "source_asset_untouched", status: "passed", assetPath: "/Game/Templates/Hero", summary: "source asset remains read-only" },
        ],
      }),
    };
    const service = createAssetChangeSetService({
      executionMode: "real",
      manifest: createAssetManifestRegistry(),
      adapter: createMvp15McpAssetMutationAdapter({
        tools,
        assetMutationGateEnabled: true,
        observedEditorSessionId: "editor-session:1",
        observedPidHash: "pid:fixture",
        nativeGuard: (input) => {
          events.push(`guard:${input.toolName}`);
          expect(input.approvalToken).toMatch(/^asset-approval-token:/);
          expect(input.editorSessionId).toBe("editor-session:1");
          expect(input.pidHash).toBe("pid:fixture");
          return { status: "accepted_by_native_guard", reason: "sandbox_guard_passed", evidenceId: `guard:${input.toolName}` };
        },
        callTool: (toolName, args) => {
          events.push(`mcp:${toolName}`);
          expect(JSON.stringify(args)).toContain("/Game/UAgentSandbox/run-1");
          return { status: "executed", reason: null, evidenceId: `mcp:${toolName}` };
        },
      }),
      verification: verifier,
    });

    const dryRun = service.dryRun({
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      runId: "run-1",
      operations: [
        { kind: "create_folder", assetPathAfter: "/Game/UAgentSandbox/run-1" },
        { kind: "duplicate_asset", assetPathBefore: "/Game/Templates/Hero", assetPathAfter: "/Game/UAgentSandbox/run-1/HeroCopy" },
        { kind: "rename_asset", assetPathBefore: "/Game/UAgentSandbox/run-1/HeroCopy", assetPathAfter: "/Game/UAgentSandbox/run-1/HeroRenamed" },
        { kind: "move_asset", assetPathBefore: "/Game/UAgentSandbox/run-1/HeroRenamed", assetPathAfter: "/Game/UAgentSandbox/run-1/Sub/HeroRenamed" },
        { kind: "save_single_asset", assetPathBefore: "/Game/UAgentSandbox/run-1/Sub/HeroRenamed", assetPathAfter: "/Game/UAgentSandbox/run-1/Sub/HeroRenamed" },
      ],
    });
    service.preview(dryRun.changeSet.id);
    const approval = service.approve({ changeSetId: dryRun.changeSet.id, actor: "tester", reason: "supervisor real smoke" });
    const executed = await service.execute({
      changeSetId: dryRun.changeSet.id,
      approvalToken: approval.approvalToken!,
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
    });
    const verified = await service.verify(dryRun.changeSet.id);

    expect(executed.status).toBe("executed");
    expect(verified.status).toBe("verified");
    expect(events).toEqual([
      "guard:ue.asset.create_folder",
      "mcp:ue.asset.create_folder",
      "guard:ue.asset.duplicate",
      "mcp:ue.asset.duplicate",
      "guard:ue.asset.rename",
      "mcp:ue.asset.rename",
      "guard:ue.asset.move",
      "mcp:ue.asset.move",
      "guard:ue.asset.save",
      "mcp:ue.asset.save",
    ]);
    expect(JSON.stringify(executed.changeSet)).not.toContain("asset-approval-token:");
  });

  it("blocks real verification when no UE/MCP or read-only filesystem evidence source is configured", async () => {
    const service = createAssetChangeSetService({
      executionMode: "real",
      manifest: createAssetManifestRegistry(),
      adapter: createFixtureAssetMutationAdapter(),
    });

    const { dryRun, executed } = await executeApprovedChangeSet(service, [
      { kind: "create_folder", assetPathAfter: "/Game/UAgentSandbox/run-1" },
    ]);
    const verified = await service.verify(dryRun.changeSet.id);

    expect(executed.status).toBe("executed");
    expect(verified.status).toBe("blocked");
    expect(verified.reason).toBe("real_verification_required");
    expect(verified.changeSet?.state).toBe("rollback_available");
    expect(verified.verification?.checks.every((check) => check.status === "blocked")).toBe(true);
  });

  it("dry-runs, approves, executes, verifies, rolls back, and replays recorded summaries only", async () => {
    const service = createReadyService();
    const dryRun = service.dryRun({
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      runId: "run-1",
      operations: [
        { kind: "create_folder", assetPathAfter: "/Game/UAgentSandbox/run-1" },
        { kind: "duplicate_asset", assetPathBefore: "/Game/Templates/Hero", assetPathAfter: "/Game/UAgentSandbox/run-1/HeroCopy" },
        { kind: "rename_asset", assetPathBefore: "/Game/UAgentSandbox/run-1/HeroCopy", assetPathAfter: "/Game/UAgentSandbox/run-1/HeroRenamed" },
        { kind: "move_asset", assetPathBefore: "/Game/UAgentSandbox/run-1/HeroRenamed", assetPathAfter: "/Game/UAgentSandbox/run-1/Sub/HeroRenamed" },
        { kind: "save_single_asset", assetPathBefore: "/Game/UAgentSandbox/run-1/Sub/HeroRenamed", assetPathAfter: "/Game/UAgentSandbox/run-1/Sub/HeroRenamed" },
      ],
    });
    const preview = service.preview(dryRun.changeSet.id);
    const approval = service.approve({
      changeSetId: preview.changeSet!.id,
      actor: "tester",
      reason: "supervisor local sandbox smoke",
    });
    const executed = await service.execute({
      changeSetId: preview.changeSet!.id,
      approvalToken: approval.approvalToken!,
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
    });
    const verified = await service.verify(preview.changeSet!.id);
    const replay = replayAssetMutationSummary(verified.changeSet!);
    const rolledBack = await service.rollback(preview.changeSet!.id);

    expect(dryRun.status).toBe("dry_run_completed");
    expect(dryRun.dryRun.rollbackPlan.actions).toHaveLength(5);
    expect(dryRun.dryRun.externalEvidenceQueries.length).toBeGreaterThanOrEqual(5);
    expect(dryRun.dryRun.externalEvidenceQueries.every((query) => query.readOnly && query.required)).toBe(true);
    expect(preview.changeSet?.state).toBe("approval_required");
    expect(approval.changeSet?.approval?.status).toBe("issued");
    expect(JSON.stringify(approval.changeSet)).not.toContain(approval.approvalToken!);
    expect(executed.status).toBe("executed");
    expect(verified.verification?.status).toBe("passed");
    expect(verifyAssetExists(verified.changeSet!, "/Game/UAgentSandbox/run-1").status).toBe("passed");
    expect(verifyAssetMoved(verified.changeSet!, "/Game/UAgentSandbox/run-1/HeroRenamed", "/Game/UAgentSandbox/run-1/Sub/HeroRenamed").status).toBe("passed");
    expect(verifySingleAssetSaved(verified.changeSet!, "/Game/UAgentSandbox/run-1/Sub/HeroRenamed").status).toBe("passed");
    expect(replay.replayOnly).toBe(true);
    expect(replay.recordedOnlyActions).toEqual(["dry-run", "preview", "approval", "execute", "verify"]);
    expect(replay.reexecutionBlocked).toBe(true);
    expect(rolledBack.changeSet?.state).toBe("rolled_back");
  });

  it("blocks manifest-owned operations before adapter execution when no matching manifest entry exists", async () => {
    const calls: string[] = [];
    const adapter: AssetMutationAdapter = {
      execute: (operation) => {
        calls.push(operation.kind);
        return { ok: true, reason: null, evidenceId: `asset-evidence:execute:${operation.id}` };
      },
      rollback: (operation) => ({ ok: true, reason: null, evidenceId: `asset-evidence:rollback:${operation.id}` }),
    };

    for (const operation of [
      { kind: "rename_asset" as const, assetPathBefore: "/Game/UAgentSandbox/run-1/A", assetPathAfter: "/Game/UAgentSandbox/run-1/B" },
      { kind: "move_asset" as const, assetPathBefore: "/Game/UAgentSandbox/run-1/A", assetPathAfter: "/Game/UAgentSandbox/run-1/Sub/A" },
      { kind: "save_single_asset" as const, assetPathBefore: "/Game/UAgentSandbox/run-1/A", assetPathAfter: "/Game/UAgentSandbox/run-1/A" },
      { kind: "delete_sandbox_asset" as const, assetPathBefore: "/Game/UAgentSandbox/run-1/A", assetPathAfter: null },
    ]) {
      const service = createAssetChangeSetService({
        now: () => 1,
        manifest: createAssetManifestRegistry(),
        adapter,
      });
      const { executed } = await executeApprovedChangeSet(service, [operation]);

      expect(executed.status).toBe("blocked");
      expect(executed.reason).toBe("manifest_entry_required");
    }
    expect(calls).toEqual([]);
  });

  it("fails execution when the adapter returns an execution failure", async () => {
    const manifest = createAssetManifestRegistry();
    const service = createAssetChangeSetService({
      now: () => 1,
      manifest,
      adapter: {
        execute: (operation) => ({ ok: false, reason: "adapter_execute_failed", evidenceId: `asset-evidence:execute:${operation.id}` }),
        rollback: (operation) => ({ ok: true, reason: null, evidenceId: `asset-evidence:rollback:${operation.id}` }),
      },
    });

    const { executed } = await executeApprovedChangeSet(service, [{ kind: "create_folder", assetPathAfter: "/Game/UAgentSandbox/run-1" }]);

    expect(executed.status).toBe("failed");
    expect(executed.reason).toBe("adapter_execute_failed");
    expect(executed.changeSet?.state).toBe("rollback_available");
    expect(manifest.list()).toHaveLength(0);
  });

  it("fails rollback when the adapter returns a rollback failure", async () => {
    const service = createAssetChangeSetService({
      now: () => 1,
      manifest: createAssetManifestRegistry(),
      adapter: {
        execute: (operation) => ({ ok: true, reason: null, evidenceId: `asset-evidence:execute:${operation.id}` }),
        rollback: (operation) => ({ ok: false, reason: "adapter_rollback_failed", evidenceId: `asset-evidence:rollback:${operation.id}` }),
      },
    });

    const { dryRun, executed } = await executeApprovedChangeSet(service, [{ kind: "create_folder", assetPathAfter: "/Game/UAgentSandbox/run-1" }]);
    const rolledBack = await service.rollback(dryRun.changeSet.id);

    expect(executed.status).toBe("executed");
    expect(rolledBack.status).toBe("failed");
    expect(rolledBack.reason).toBe("adapter_rollback_failed");
    expect(rolledBack.changeSet?.state).toBe("rollback_available");
  });

  it("verifies manifest state instead of only ChangeSet operation presence", async () => {
    const manifest = createAssetManifestRegistry();
    const service = createAssetChangeSetService({
      now: () => 1,
      manifest,
      adapter: createFixtureAssetMutationAdapter(),
    });

    const { executed, dryRun } = await executeApprovedChangeSet(service, [{ kind: "create_folder", assetPathAfter: "/Game/UAgentSandbox/run-1/Hero" }]);
    const entryId = executed.changeSet?.operations[0]?.manifestEntryId;
    manifest.markMoved(entryId!, "/Game/UAgentSandbox/run-1/Unexpected", "op:outside", "asset-evidence:outside");
    const verified = await service.verify(dryRun.changeSet.id);

    expect(verified.status).toBe("failed");
    expect(verified.reason).toBe("verification_failed");
    expect(verified.verification?.checks[0]?.status).toBe("failed");
  });

  it("keeps duplicate source read-only and verifies only the sandbox target as manifest-owned", async () => {
    const manifest = createAssetManifestRegistry();
    const service = createAssetChangeSetService({
      now: () => 1,
      manifest,
      adapter: createFixtureAssetMutationAdapter(),
    });

    const { executed, dryRun } = await executeApprovedChangeSet(service, [
      { kind: "duplicate_asset", assetPathBefore: "/Game/Templates/Hero", assetPathAfter: "/Game/UAgentSandbox/run-1/HeroCopy" },
    ]);
    const verified = await service.verify(dryRun.changeSet.id);

    expect(executed.status).toBe("executed");
    expect(verified.status).toBe("verified");
    expect(manifest.list()).toHaveLength(1);
    expect(manifest.list()[0]?.assetPath).toBe("/Game/UAgentSandbox/run-1/HeroCopy");
    expect(manifest.list()[0]?.sourceAssetPath).toBe("/Game/Templates/Hero");
    expect(manifest.list().some((entry) => entry.assetPath === "/Game/Templates/Hero")).toBe(false);
    expect(verified.verification?.checks.some((check) => check.kind === "source_asset_untouched" && check.status === "passed")).toBe(true);
  });

  it("blocks forged, expired, replayed, mismatched, non-sandbox, and bulk execution", async () => {
    const service = createAssetChangeSetService({
      now: (() => {
        let tick = 1;
        return () => tick++;
      })(),
      approvalTtlMs: 2,
      manifest: createAssetManifestRegistry(),
      adapter: createFixtureAssetMutationAdapter(),
    });
    const blockedPath = service.dryRun({
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      runId: "run-1",
      operations: [{ kind: "create_folder", assetPathAfter: "/Game/NotSandbox" }],
    });
    const blockedBulk = service.dryRun({
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      runId: "run-1",
      operations: [
        { kind: "delete_sandbox_asset", assetPathBefore: "/Game/UAgentSandbox/run-1/A", assetPathAfter: null },
        { kind: "delete_sandbox_asset", assetPathBefore: "/Game/UAgentSandbox/run-1/B", assetPathAfter: null },
      ],
    });
    const good = service.dryRun({
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      runId: "run-2",
      operations: [{ kind: "create_folder", assetPathAfter: "/Game/UAgentSandbox/run-2" }],
    });
    service.preview(good.changeSet.id);
    const approval = service.approve({ changeSetId: good.changeSet.id, actor: "tester", reason: "verify" });

    expect(blockedPath.status).toBe("blocked");
    expect(blockedPath.reason).toBe("non_sandbox_path");
    expect(blockedBulk.status).toBe("blocked");
    expect(blockedBulk.reason).toBe("bulk_operation_blocked");
    expect((await service.execute({ changeSetId: good.changeSet.id, approvalToken: "forged", editorSessionId: "editor-session:1", pidHash: "pid:fixture" })).reason).toBe("forged_token");
    expect((await service.execute({ changeSetId: good.changeSet.id, approvalToken: approval.approvalToken!, editorSessionId: "editor-session:other", pidHash: "pid:fixture" })).reason).toBe("session_mismatch");
    expect((await service.execute({ changeSetId: good.changeSet.id, approvalToken: approval.approvalToken!, editorSessionId: "editor-session:1", pidHash: "pid:other" })).reason).toBe("pid_mismatch");
    expect((await service.execute({ changeSetId: good.changeSet.id, approvalToken: approval.approvalToken!, editorSessionId: "editor-session:1", pidHash: "pid:fixture" })).status).toBe("executed");
    expect((await service.execute({ changeSetId: good.changeSet.id, approvalToken: approval.approvalToken!, editorSessionId: "editor-session:1", pidHash: "pid:fixture" })).reason).toBe("replay_token");

    const expires = service.dryRun({
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      runId: "run-3",
      operations: [{ kind: "create_folder", assetPathAfter: "/Game/UAgentSandbox/run-3" }],
    });
    service.preview(expires.changeSet.id);
    const expiringApproval = service.approve({ changeSetId: expires.changeSet.id, actor: "tester", reason: "verify" });
    service.dryRun({
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      runId: "run-4",
      operations: [{ kind: "create_folder", assetPathAfter: "/Game/UAgentSandbox/run-4" }],
    });

    expect((await service.execute({ changeSetId: expires.changeSet.id, approvalToken: expiringApproval.approvalToken!, editorSessionId: "editor-session:1", pidHash: "pid:fixture" })).reason).toBe("expired_token");
  });

  it("covers at least 60 MVP15 scenarios and 240 assertions", async () => {
    const matrix = await createMvp15ScenarioMatrix();

    expect(matrix.scenarios.length).toBeGreaterThanOrEqual(60);
    expect(matrix.totalAssertions).toBeGreaterThanOrEqual(240);
    expect(matrix.scenarios.every((scenario) => scenario.pass)).toBe(true);
  });
});
