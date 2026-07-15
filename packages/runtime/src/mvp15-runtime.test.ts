import { describe, expect, it } from "vitest";
import { validateRealExternalBinding } from "./mvp15-asset-changeset.js";
import {
  buildExactDryRunPayload,
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
  validatePluginDryRunResult,
  unwrapPluginDryRunResult,
  expectedReadOnlySources,
  expectedSandboxTargets,
  verifyAssetExists,
  verifyAssetMoved,
  verifySingleAssetSaved,
  type AssetMutationAdapter,
  type AssetMutationExternalBinder,
  type AssetMutationVerificationAdapter,
  type DryRunBindingContext,
  type DryRunBindingInput,
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

const KIND_TO_OPERATION_PLUGIN_NAME = {
  create_folder: "create_folder",
  duplicate_asset: "duplicate",
  rename_asset: "rename",
  move_asset: "move",
  save_single_asset: "save",
  delete_sandbox_asset: "delete",
} as const;

type AssetMutationOperationKindForHelper = "create_folder" | "duplicate_asset" | "rename_asset" | "move_asset" | "save_single_asset" | "delete_sandbox_asset";

function exactNameFor(kind: keyof typeof KIND_TO_OPERATION_PLUGIN_NAME): string {
  switch (kind) {
    case "create_folder": return "ue.asset.create_folder";
    case "duplicate_asset": return "ue.asset.duplicate";
    case "rename_asset": return "ue.asset.rename";
    case "move_asset": return "ue.asset.move";
    case "save_single_asset": return "ue.asset.save";
    case "delete_sandbox_asset": return "ue.asset.delete";
    default: return "ue.asset.create_folder";
  }
}

function pluginOperationKind(kind: AssetMutationOperationKindForHelper): string {
  return KIND_TO_OPERATION_PLUGIN_NAME[kind];
}

function structuredDryRunResult(
  toolName: string,
  operationKind: AssetMutationOperationKindForHelper,
  changeSetId: string,
  runId: string,
  assetPathBefore: string | null,
  assetPathAfter: string | null,
): Record<string, unknown> {
  const wouldRead = operationKind === "duplicate_asset" && assetPathBefore ? [assetPathBefore] : [];
  const wouldModify = operationKind === "delete_sandbox_asset"
    ? (assetPathBefore ? [assetPathBefore] : [])
    : (operationKind === "rename_asset" || operationKind === "move_asset")
      ? (assetPathBefore && assetPathAfter ? [assetPathBefore, assetPathAfter] : [])
      : (assetPathAfter ? [assetPathAfter] : []);
  return {
    blocked: false,
    status: "dry_run_completed",
    toolName,
    operation: pluginOperationKind(operationKind),
    changeSetId,
    runId,
    sandboxRoot: `/Game/UAgentSandbox/${runId}`,
    wouldChange: true,
    wouldModify,
    wouldRead,
    affectedAssets: {
      readOnlySources: wouldRead,
      sandboxTargets: wouldModify,
      externalTargets: [],
    },
    rollbackPlan: { executionEnabled: false, inverseOperation: "restore", summary: "rollback" },
    externalEvidenceQueries: [{ queryKind: "asset_registry_snapshot", readOnly: true, paths: [...wouldRead, ...wouldModify] }],
    dryRunHash: fakeSha1(`${toolName}|${operationKind}|${changeSetId}|${runId}|${assetPathBefore ?? ""}|${assetPathAfter ?? ""}`),
    hashAlgorithm: "sha1",
    schemaVersion: "mvp15c.dry-run.v1",
    approvalRequired: true,
    implementationStatus: "dry_run_only",
  };
}

function fakeSha1(seed: string): string {
  // Deterministic 40-char lowercase-hex placeholder for tests only; not cryptographic.
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  }
  const base = (h >>> 0).toString(16).padStart(8, "0");
  return (base + base.repeat(5) + base).slice(0, 40);
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
  const exactAssetToolNames = [
    "ue.asset.create_folder",
    "ue.asset.duplicate",
    "ue.asset.rename",
    "ue.asset.move",
    "ue.asset.delete",
    "ue.asset.save",
  ] as const;
  const outputSchemaContract = {
    dryRunSchema: { source: "output", type: "object" },
    rollbackContract: { source: "output", type: "reverse_operation" },
    affectedAssetsSchema: { source: "output", type: "array" },
    evidenceQuery: { source: "output", type: "read_only" },
  };

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

  it("accepts all six direct exact descriptors when contracts exist only in outputSchema", () => {
    const inventory = createMvp15McpAssetToolInventory(
      exactAssetToolNames.map((name) => ({
        name,
        inputSchema: { type: "object", properties: { assetPath: { type: "string" } } },
        outputSchema: outputSchemaContract,
      })),
    );

    expect(inventory).toMatchObject({
      status: "ready",
      availableTools: exactAssetToolNames,
      missingTools: [],
      missingSchemas: [],
      missingDryRunSchemas: [],
      missingRollbackContracts: [],
      missingEvidenceQueries: [],
    });
  });

  it.each([
    ["dryRunSchema", "missingDryRunSchemas"],
    ["rollbackContract", "missingRollbackContracts"],
    ["affectedAssetsSchema", "missingEvidenceQueries"],
    ["evidenceQuery", "missingEvidenceQueries"],
  ] as const)("fails closed when outputSchema omits %s", (missingField, missingArray) => {
    const incompleteOutputSchema: Record<string, unknown> = { ...outputSchemaContract };
    delete incompleteOutputSchema[missingField];
    const inventory = createMvp15McpAssetToolInventory(
      exactAssetToolNames.map((name) => ({
        name,
        inputSchema: { type: "object" },
        outputSchema: name === "ue.asset.save" ? incompleteOutputSchema : outputSchemaContract,
      })),
    );

    expect(inventory.status).toBe("blocked_by_mcp_schema");
    expect(inventory[missingArray]).toEqual(["ue.asset.save"]);
    expect(inventory.availableTools).not.toContain("ue.asset.save");
  });

  it("does not treat an arbitrary non-empty outputSchema as an MVP15 contract", () => {
    const inventory = createMvp15McpAssetToolInventory(
      exactAssetToolNames.map((name) => ({
        name,
        inputSchema: { type: "object" },
        outputSchema: { type: "object", properties: { ok: { type: "boolean" } } },
      })),
    );

    expect(inventory.status).toBe("blocked_by_mcp_schema");
    expect(inventory.availableTools).toEqual([]);
    expect(inventory.missingDryRunSchemas).toEqual(exactAssetToolNames);
  });

  it("recognizes descriptor and outputSchema x-uagent-contract compatibility containers", () => {
    const inventory = createMvp15McpAssetToolInventory(
      exactAssetToolNames.map((name, index) => ({
        name,
        inputSchema: { type: "object" },
        ...(index < 3
          ? { "x-uagent-contract": outputSchemaContract }
          : { outputSchema: { "x-uagent-contract": outputSchemaContract } }),
      })),
    );

    expect(inventory.status).toBe("ready");
    expect(inventory.availableTools).toEqual(exactAssetToolNames);
  });

  it("recognizes annotations and inputSchema compatibility containers", () => {
    const inventory = createMvp15McpAssetToolInventory(
      exactAssetToolNames.map((name, index) => ({
        name,
        ...(index % 3 === 0
          ? { inputSchema: { type: "object" }, annotations: outputSchemaContract }
          : index % 3 === 1
            ? { inputSchema: { type: "object" }, annotations: { "x-uagent-contract": outputSchemaContract } }
            : { inputSchema: { type: "object", "x-uagent-contract": outputSchemaContract } }),
      })),
    );

    expect(inventory.status).toBe("ready");
    expect(inventory.availableTools).toEqual(exactAssetToolNames);
  });

  it("keeps complete direct fields ahead of incomplete lower-priority containers", () => {
    const directContracts = {
      dryRunSchema: { source: "direct", type: "object" },
      rollbackContract: { source: "direct", type: "reverse_operation" },
      affectedAssetsSchema: { source: "direct", type: "array" },
      evidenceQuery: { source: "direct", type: "read_only" },
    };
    const inventory = createMvp15McpAssetToolInventory(
      exactAssetToolNames.map((name) => ({
        name,
        inputSchema: { type: "object" },
        ...directContracts,
        "x-uagent-contract": { dryRunSchema: "invalid-lower-priority" },
        outputSchema: { rollbackContract: null },
        annotations: { affectedAssetsSchema: false, evidenceQuery: [] },
      })),
    );

    expect(inventory.status).toBe("ready");
    expect(inventory.availableTools).toEqual(exactAssetToolNames);
  });

  it("does not bypass an invalid declared direct field with a valid fallback container", () => {
    const inventory = createMvp15McpAssetToolInventory(
      exactAssetToolNames.map((name) => ({
        name,
        inputSchema: { type: "object" },
        dryRunSchema: name === "ue.asset.save" ? "invalid-direct" : outputSchemaContract.dryRunSchema,
        rollbackContract: outputSchemaContract.rollbackContract,
        affectedAssetsSchema: outputSchemaContract.affectedAssetsSchema,
        evidenceQuery: outputSchemaContract.evidenceQuery,
        outputSchema: outputSchemaContract,
      })),
    );

    expect(inventory.status).toBe("blocked_by_mcp_schema");
    expect(inventory.missingDryRunSchemas).toEqual(["ue.asset.save"]);
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

describe("MVP15 strict external dry-run binding", () => {
  it("maps all six operation impacts to the literal UE plugin contract", () => {
    const cases = [
      { kind: "create_folder" as const, before: null, after: "/Game/UAgentSandbox/run-contract/Work", sandboxTargets: ["/Game/UAgentSandbox/run-contract/Work"], readOnlySources: [] },
      { kind: "duplicate_asset" as const, before: "/Game/Test01/Hero", after: "/Game/UAgentSandbox/run-contract/Work/HeroCopy", sandboxTargets: ["/Game/UAgentSandbox/run-contract/Work/HeroCopy"], readOnlySources: ["/Game/Test01/Hero"] },
      { kind: "rename_asset" as const, before: "/Game/UAgentSandbox/run-contract/Work/HeroCopy", after: "/Game/UAgentSandbox/run-contract/Work/HeroRenamed", sandboxTargets: ["/Game/UAgentSandbox/run-contract/Work/HeroCopy", "/Game/UAgentSandbox/run-contract/Work/HeroRenamed"], readOnlySources: [] },
      { kind: "move_asset" as const, before: "/Game/UAgentSandbox/run-contract/Work/HeroRenamed", after: "/Game/UAgentSandbox/run-contract/Work/Sub/HeroRenamed", sandboxTargets: ["/Game/UAgentSandbox/run-contract/Work/HeroRenamed", "/Game/UAgentSandbox/run-contract/Work/Sub/HeroRenamed"], readOnlySources: [] },
      { kind: "delete_sandbox_asset" as const, before: "/Game/UAgentSandbox/run-contract/Work/Sub/HeroRenamed", after: null, sandboxTargets: ["/Game/UAgentSandbox/run-contract/Work/Sub/HeroRenamed"], readOnlySources: [] },
      { kind: "save_single_asset" as const, before: "/Game/UAgentSandbox/run-contract/Work/Sub/HeroRenamed", after: "/Game/UAgentSandbox/run-contract/Work/Sub/HeroRenamed", sandboxTargets: ["/Game/UAgentSandbox/run-contract/Work/Sub/HeroRenamed"], readOnlySources: [] },
    ];

    for (const item of cases) {
      const operation = { kind: item.kind, assetPathBefore: item.before, assetPathAfter: item.after };
      expect(expectedSandboxTargets(operation), item.kind).toEqual(item.sandboxTargets);
      expect(expectedReadOnlySources(operation), item.kind).toEqual(item.readOnlySources);
    }
  });

  it("fails closed when an exact operation lacks a contract-required impact path", () => {
    const context = {
      changeSetId: "cs-missing-path",
      runId: "run-missing-path",
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      sandboxRoot: "/Game/UAgentSandbox" as const,
    };
    const result = validatePluginDryRunResult(
      unwrapPluginDryRunResult({
        structuredContent: structuredDryRunResult(
          "ue.asset.rename",
          "rename_asset",
          context.changeSetId,
          context.runId,
          null,
          "/Game/UAgentSandbox/run-missing-path/Work/HeroRenamed",
        ),
      }),
      {
        expectedToolName: "ue.asset.rename",
        expectedOperationKind: "rename_asset",
        context,
        operation: {
          kind: "rename_asset",
          assetPathBefore: null,
          assetPathAfter: "/Game/UAgentSandbox/run-missing-path/Work/HeroRenamed",
        },
      },
    );

    expect(result).toEqual({ ok: false, reason: "mcp_dry_run_contract_mismatch:expected_paths" });
  });

  it("rejects every rename and move write-target variant other than ordered [before, after]", () => {
    const context = {
      changeSetId: "cs-impact-variants",
      runId: "run-impact-variants",
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      sandboxRoot: "/Game/UAgentSandbox" as const,
    };

    for (const item of [
      { kind: "rename_asset" as const, toolName: "ue.asset.rename", before: "/Game/UAgentSandbox/run-impact-variants/Work/HeroCopy", after: "/Game/UAgentSandbox/run-impact-variants/Work/HeroRenamed" },
      { kind: "move_asset" as const, toolName: "ue.asset.move", before: "/Game/UAgentSandbox/run-impact-variants/Work/HeroRenamed", after: "/Game/UAgentSandbox/run-impact-variants/Work/Sub/HeroRenamed" },
    ]) {
      const valid = structuredDryRunResult(item.toolName, item.kind, context.changeSetId, context.runId, item.before, item.after);
      for (const [name, targets] of [
        ["after_only", [item.after]],
        ["before_only", [item.before]],
        ["reordered", [item.after, item.before]],
        ["duplicate", [item.before, item.before]],
        ["extra", [item.before, item.after, `${item.after}/Extra`]],
      ] as const) {
        for (const response of [
          { ...valid, wouldModify: targets },
          { ...valid, affectedAssets: { ...(valid.affectedAssets as Record<string, unknown>), sandboxTargets: targets } },
        ]) {
          const checked = validatePluginDryRunResult(unwrapPluginDryRunResult({ structuredContent: response }), {
            expectedToolName: item.toolName,
            expectedOperationKind: item.kind,
            context,
            operation: { kind: item.kind, assetPathBefore: item.before, assetPathAfter: item.after },
          });
          expect(checked.ok, `${item.kind}:${name}`).toBe(false);
        }
      }
    }
  });

  it("accepts the expected ordered paths for all six exact operations", () => {
    const cases = [
      { kind: "create_folder" as const, before: null, after: "/Game/UAgentSandbox/run-strict/Work" },
      { kind: "duplicate_asset" as const, before: "/Game/Templates/Hero", after: "/Game/UAgentSandbox/run-strict/Work/HeroCopy" },
      { kind: "rename_asset" as const, before: "/Game/UAgentSandbox/run-strict/Work/HeroCopy", after: "/Game/UAgentSandbox/run-strict/Work/HeroRenamed" },
      { kind: "move_asset" as const, before: "/Game/UAgentSandbox/run-strict/Work/HeroRenamed", after: "/Game/UAgentSandbox/run-strict/Work/Sub/HeroRenamed" },
      { kind: "save_single_asset" as const, before: "/Game/UAgentSandbox/run-strict/Work/Sub/HeroRenamed", after: "/Game/UAgentSandbox/run-strict/Work/Sub/HeroRenamed" },
      { kind: "delete_sandbox_asset" as const, before: "/Game/UAgentSandbox/run-strict/Work/Sub/HeroRenamed", after: null },
    ];

    for (const item of cases) {
      const input: DryRunBindingInput = {
        operationId: `op-${item.kind}`,
        operationKind: item.kind,
        assetPathBefore: item.before,
        assetPathAfter: item.after,
        exactToolName: exactNameFor(item.kind),
        context: {
          changeSetId: "cs-strict",
          runId: "run-strict",
          projectId: "project:fixture",
          trustedRootId: "root:fixture",
          editorSessionId: "editor-session:1",
          pidHash: "pid:fixture",
          sandboxRoot: "/Game/UAgentSandbox",
        },
      };
      const result = validatePluginDryRunResult(
        unwrapPluginDryRunResult({
          structuredContent: structuredDryRunResult(
            input.exactToolName,
            item.kind,
            input.context.changeSetId,
            input.context.runId,
            item.before,
            item.after,
          ),
        }),
        {
          expectedToolName: input.exactToolName,
          expectedOperationKind: item.kind,
          context: input.context,
          operation: { kind: item.kind, assetPathBefore: item.before, assetPathAfter: item.after },
        },
      );
      expect(result.ok, item.kind).toBe(true);
    }
  });

  it("rejects missing, extra, wrong, duplicate, and reordered impact arrays", () => {
    const source = "/Game/Templates/Hero";
    const target = "/Game/UAgentSandbox/run-strict/Work/HeroCopy";
    const input: DryRunBindingInput = {
      operationId: "op-duplicate",
      operationKind: "duplicate_asset",
      assetPathBefore: source,
      assetPathAfter: target,
      exactToolName: "ue.asset.duplicate",
      context: {
        changeSetId: "cs-strict-arrays",
        runId: "run-strict",
        projectId: "project:fixture",
        trustedRootId: "root:fixture",
        editorSessionId: "editor-session:1",
        pidHash: "pid:fixture",
        sandboxRoot: "/Game/UAgentSandbox",
      },
    };
    const valid = structuredDryRunResult(
      input.exactToolName,
      "duplicate_asset",
      input.context.changeSetId,
      input.context.runId,
      source,
      target,
    );
    const expected = {
      wouldModify: [target],
      wouldRead: [source],
      sandboxTargets: [target],
      readOnlySources: [source],
    };
    const mismatchValues = {
      missing: [],
      extra: [target, `${target}/extra`],
      wrong: [`${target}-wrong`],
      duplicate: [target, target],
    };

    for (const [field, expectedPaths] of Object.entries(expected)) {
      for (const [variant, paths] of Object.entries(mismatchValues)) {
        const result = field === "sandboxTargets" || field === "readOnlySources"
          ? {
              ...valid,
              affectedAssets: {
                ...(valid.affectedAssets as Record<string, unknown>),
                [field]: paths,
              },
            }
          : { ...valid, [field]: paths };
        const checked = validatePluginDryRunResult(unwrapPluginDryRunResult({ structuredContent: result }), {
          expectedToolName: input.exactToolName,
          expectedOperationKind: input.operationKind,
          context: input.context,
          operation: { kind: input.operationKind, assetPathBefore: source, assetPathAfter: target },
        });
        expect(checked.ok, `${field}:${variant}:${expectedPaths.join(",")}`).toBe(false);
      }
    }

    const twoTargets = ["/Game/UAgentSandbox/run-strict/A", "/Game/UAgentSandbox/run-strict/B"];
    const twoSources = ["/Game/Templates/A", "/Game/Templates/B"];
    const orderedResult = {
      ...valid,
      wouldModify: twoTargets,
      wouldRead: twoSources,
      affectedAssets: { readOnlySources: twoSources, sandboxTargets: twoTargets, externalTargets: [] },
    };
    const explicitPaths = {
      expectedSandboxTargets: twoTargets,
      expectedReadOnlySources: twoSources,
    };
    for (const result of [
      { ...orderedResult, wouldModify: [...twoTargets].reverse() },
      { ...orderedResult, wouldRead: [...twoSources].reverse() },
      { ...orderedResult, affectedAssets: { ...orderedResult.affectedAssets, sandboxTargets: [...twoTargets].reverse() } },
      { ...orderedResult, affectedAssets: { ...orderedResult.affectedAssets, readOnlySources: [...twoSources].reverse() } },
    ]) {
      const checked = validatePluginDryRunResult(unwrapPluginDryRunResult({ structuredContent: result }), {
        expectedToolName: input.exactToolName,
        expectedOperationKind: input.operationKind,
        context: input.context,
        ...explicitPaths,
      });
      expect(checked.ok).toBe(false);
    }
  });

  it("keeps returned ChangeSets detached from authoritative aggregate binding state", async () => {
    const service = createAssetChangeSetService({
      executionMode: "real",
      manifest: createAssetManifestRegistry(),
      adapter: createFixtureAssetMutationAdapter(),
    });
    const dryRun = service.dryRun({
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      runId: "run-detached",
      operations: [{ kind: "create_folder", assetPathAfter: "/Game/UAgentSandbox/run-detached/Work" }],
    });
    const bound = await service.bindExternalDryRun({
      changeSetId: dryRun.changeSet.id,
      binder: {
        call: async (input) => ({
          structuredContent: structuredDryRunResult(
            input.exactToolName,
            input.operationKind as AssetMutationOperationKindForHelper,
            input.context.changeSetId,
            input.context.runId,
            input.assetPathBefore,
            input.assetPathAfter,
          ),
        }),
      },
    });
    const aggregateDryRunHash = bound.changeSet?.aggregateDryRunHash;
    const aggregateArgsHash = bound.changeSet?.aggregateArgsHash;
    bound.changeSet!.aggregateDryRunHash = null;
    bound.changeSet!.aggregateArgsHash = null;
    bound.changeSet!.operations[0]!.provenance = null;
    expect(service.get(dryRun.changeSet.id)?.aggregateDryRunHash).toBe(aggregateDryRunHash);
    expect(service.get(dryRun.changeSet.id)?.aggregateArgsHash).toBe(aggregateArgsHash);
    expect(service.get(dryRun.changeSet.id)?.operations[0]?.provenance?.dryRunHashSource).toBe("ue_mcp_exact_tool");
  });

  it("returns blocked nested dry-run state and clears partial external binding data", async () => {
    const service = createAssetChangeSetService({
      executionMode: "real",
      manifest: createAssetManifestRegistry(),
      adapter: createFixtureAssetMutationAdapter(),
    });
    const dryRun = service.dryRun({
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      runId: "run-blocked-nested",
      operations: [
        { kind: "create_folder", assetPathAfter: "/Game/UAgentSandbox/run-blocked-nested/A" },
        { kind: "save_single_asset", assetPathBefore: "/Game/UAgentSandbox/run-blocked-nested/A", assetPathAfter: "/Game/UAgentSandbox/run-blocked-nested/A" },
      ],
    });
    let calls = 0;
    const bound = await service.bindExternalDryRun({
      changeSetId: dryRun.changeSet.id,
      binder: {
        call: async (input) => {
          calls += 1;
          if (calls === 2) return { structuredContent: { blocked: false, status: "dry_run_completed" } };
          return {
            structuredContent: structuredDryRunResult(
              input.exactToolName,
              input.operationKind as AssetMutationOperationKindForHelper,
              input.context.changeSetId,
              input.context.runId,
              input.assetPathBefore,
              input.assetPathAfter,
            ),
          };
        },
      },
    });
    expect(bound.status).toBe("blocked");
    expect(bound.dryRun?.status).toBe("blocked");
    expect(bound.dryRun?.operations).toEqual([]);
    expect(bound.dryRun?.aggregateDryRunHash).toBeNull();
    expect(bound.dryRun?.aggregateArgsHash).toBeNull();
    expect(bound.changeSet?.externalBindingStatus).toBe("blocked");
    expect(bound.changeSet?.aggregateDryRunHash).toBeNull();
    expect(bound.changeSet?.aggregateArgsHash).toBeNull();
    expect(bound.changeSet?.operations.every((operation) => operation.provenance === null)).toBe(true);
  });

  it("rejects missing, invalid, mismatched aggregate hashes and incomplete provenance before real approval", async () => {
    const service = createAssetChangeSetService({
      executionMode: "real",
      manifest: createAssetManifestRegistry(),
      adapter: createFixtureAssetMutationAdapter(),
    });
    const dryRun = service.dryRun({
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      runId: "run-aggregate-gates",
      operations: [{ kind: "create_folder", assetPathAfter: "/Game/UAgentSandbox/run-aggregate-gates/Work" }],
    });
    const bound = await service.bindExternalDryRun({
      changeSetId: dryRun.changeSet.id,
      binder: {
        call: async (input) => ({
          structuredContent: structuredDryRunResult(
            input.exactToolName,
            input.operationKind as AssetMutationOperationKindForHelper,
            input.context.changeSetId,
            input.context.runId,
            input.assetPathBefore,
            input.assetPathAfter,
          ),
        }),
      },
    });
    const valid = bound.changeSet!;
    expect(validateRealExternalBinding(valid)).toBeNull();
    const invalidCases = [
      { name: "missing dry-run aggregate", changeSet: { ...valid, aggregateDryRunHash: null }, reason: "aggregate_dry_run_hash_required" },
      { name: "invalid args aggregate", changeSet: { ...valid, aggregateArgsHash: "not-a-sha256" }, reason: "aggregate_args_hash_invalid" },
      { name: "mismatched dry-run aggregate", changeSet: { ...valid, aggregateDryRunHash: "0".repeat(64) }, reason: "aggregate_dry_run_hash_mismatch" },
      { name: "incomplete provenance", changeSet: { ...valid, operations: [{ ...valid.operations[0]!, provenance: null }] }, reason: "external_binding_provenance_missing" },
    ];
    for (const invalid of invalidCases) {
      expect(validateRealExternalBinding(invalid.changeSet), invalid.name).toBe(invalid.reason);
    }

    const preview = service.preview(dryRun.changeSet.id);
    expect(preview.status).toBe("previewed");
    const approval = service.approve({ changeSetId: dryRun.changeSet.id, actor: "tester", reason: "aggregate gate" });
    expect(approval.status).toBe("approved");
    expect(approval.approvalToken).toBeTruthy();
    expect(approval.changeSet?.approval?.aggregateDryRunHash).toMatch(/^[0-9a-f]{64}$/);
    expect(approval.changeSet?.approval?.aggregateArgsHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("MVP15 service boundary and deferred real gates", () => {
  const inputFor = (runId: string, operations = [{ kind: "create_folder" as const, assetPathAfter: `/Game/UAgentSandbox/${runId}/Work` }]) => ({
    projectId: "project:fixture",
    trustedRootId: "root:fixture",
    editorSessionId: "editor-session:1",
    pidHash: "pid:fixture",
    runId,
    operations,
  });

  const validBinder: AssetMutationExternalBinder = {
    call: async (input) => ({
      structuredContent: structuredDryRunResult(
        input.exactToolName,
        input.operationKind as AssetMutationOperationKindForHelper,
        input.context.changeSetId,
        input.context.runId,
        input.assetPathBefore,
        input.assetPathAfter,
      ),
    }),
  };

  it("detaches duplicate-bind, real-only, empty-operation, and execute blocked returns", async () => {
    const real = createAssetChangeSetService({
      executionMode: "real",
      manifest: createAssetManifestRegistry(),
      adapter: createFixtureAssetMutationAdapter(),
    });
    const dry = real.dryRun(inputFor("run-boundary-duplicate"));
    const bound = await real.bindExternalDryRun({ changeSetId: dry.changeSet.id, binder: validBinder });
    const expectedHash = bound.changeSet!.aggregateDryRunHash;
    const duplicate = await real.bindExternalDryRun({ changeSetId: dry.changeSet.id, binder: validBinder });
    expect(duplicate.reason).toBe("external_binding_already_bound");
    duplicate.changeSet!.aggregateDryRunHash = null;
    duplicate.changeSet!.operations[0]!.provenance = null;
    expect(duplicate.changeSet!.rollbackPlan.actions).toHaveLength(1);
    duplicate.changeSet!.rollbackPlan.actions[0]!.summary = "mutated return";
    expect(real.get(dry.changeSet.id)!.aggregateDryRunHash).toBe(expectedHash);
    expect(real.get(dry.changeSet.id)!.operations[0]!.provenance).not.toBeNull();
    expect(real.get(dry.changeSet.id)!.rollbackPlan.actions[0]!.summary).not.toBe("mutated return");

    const empty = real.dryRun(inputFor("run-boundary-empty", []));
    const emptyBinding = await real.bindExternalDryRun({ changeSetId: empty.changeSet.id, binder: validBinder });
    expect(emptyBinding.reason).toBe("external_binding_no_operations");
    emptyBinding.changeSet!.state = "verified";
    expect(real.get(empty.changeSet.id)!.state).toBe("dry_run_completed");

    const executed = await real.execute({
      changeSetId: dry.changeSet.id,
      approvalToken: "forged",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
    });
    expect(executed.reason).toBe("execute_not_enabled");
    executed.changeSet!.aggregateArgsHash = null;
    executed.changeSet!.operations[0]!.assetPathAfter = "/Game/UAgentSandbox/leaked";
    expect(real.get(dry.changeSet.id)!.aggregateArgsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(real.get(dry.changeSet.id)!.operations[0]!.assetPathAfter).toBe("/Game/UAgentSandbox/run-boundary-duplicate/Work");

    const fixture = createAssetChangeSetService({
      manifest: createAssetManifestRegistry(),
      adapter: createFixtureAssetMutationAdapter(),
    });
    const fixtureDry = fixture.dryRun(inputFor("run-boundary-fixture"));
    const fixtureBinding = await fixture.bindExternalDryRun({ changeSetId: fixtureDry.changeSet.id, binder: validBinder });
    expect(fixtureBinding.reason).toBe("external_binding_real_only");
    fixtureBinding.changeSet!.operations[0]!.assetPathAfter = "/Game/UAgentSandbox/fixture-leaked";
    expect(fixture.get(fixtureDry.changeSet.id)!.operations[0]!.assetPathAfter).toBe("/Game/UAgentSandbox/run-boundary-fixture/Work");
  });

  it("passes detached operation and ChangeSet snapshots to every external adapter", async () => {
    const executeService = createAssetChangeSetService({
      manifest: createAssetManifestRegistry(),
      adapter: {
        execute: (operation, context) => {
          operation.assetPathAfter = "/Game/UAgentSandbox/adapter-operation-leak";
          context.changeSet.aggregateDryRunHash = null;
          context.changeSet.operations[0]!.assetPathAfter = "/Game/UAgentSandbox/adapter-context-leak";
          context.changeSet.rollbackPlan.actions[0]!.summary = "adapter mutation";
          return { ok: true, reason: null, evidenceId: "asset-evidence:execute:detached" };
        },
        rollback: (operation, context) => {
          operation.assetPathAfter = "/Game/UAgentSandbox/rollback-operation-leak";
          context.changeSet.operations[0]!.assetPathAfter = "/Game/UAgentSandbox/rollback-context-leak";
          return { ok: true, reason: null, evidenceId: "asset-evidence:rollback:detached" };
        },
      },
    });
    const executeDry = executeService.dryRun(inputFor("run-adapter-boundary"));
    executeService.preview(executeDry.changeSet.id);
    const approval = executeService.approve({ changeSetId: executeDry.changeSet.id, actor: "tester", reason: "boundary" });
    const executed = await executeService.execute({
      changeSetId: executeDry.changeSet.id,
      approvalToken: approval.approvalToken!,
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
    });
    expect(executed.status).toBe("executed");
    expect(executeService.get(executeDry.changeSet.id)!.operations[0]!.assetPathAfter).toBe("/Game/UAgentSandbox/run-adapter-boundary/Work");
    expect(executeService.get(executeDry.changeSet.id)!.rollbackPlan.actions[0]!.summary).not.toBe("adapter mutation");

    const rolledBack = await executeService.rollback(executeDry.changeSet.id);
    expect(rolledBack.status).toBe("rolled_back");
    expect(executeService.get(executeDry.changeSet.id)!.operations[0]!.assetPathAfter).toBe("/Game/UAgentSandbox/run-adapter-boundary/Work");

    let verificationCalls = 0;
    const verificationAdapter: AssetMutationVerificationAdapter = {
      verify: (changeSet) => {
        verificationCalls += 1;
        changeSet.aggregateDryRunHash = null;
        changeSet.operations[0]!.assetPathAfter = "/Game/UAgentSandbox/verification-leak";
        return {
          id: "asset-verification:detached",
          changeSetId: changeSet.id,
          status: "blocked",
          checkedAt: 1,
          checks: [],
          evidenceId: "asset-evidence:verify:detached",
          redaction: { redacted: true, replacedPaths: 0, replacedSecrets: 0 },
          summary: "verification adapter mutation probe",
        };
      },
    };
    const verifyService = createAssetChangeSetService({
      manifest: createAssetManifestRegistry(),
      adapter: createFixtureAssetMutationAdapter(),
      verification: verificationAdapter,
    });
    const verifyDry = verifyService.dryRun(inputFor("run-verification-boundary"));
    const expectedAggregate = verifyDry.changeSet.aggregateDryRunHash;
    const verified = await verifyService.verify(verifyDry.changeSet.id);
    expect(verified.status).toBe("blocked");
    expect(verificationCalls).toBe(1);
    expect(verifyService.get(verifyDry.changeSet.id)!.aggregateDryRunHash).toBe(expectedAggregate);
    expect(verifyService.get(verifyDry.changeSet.id)!.operations[0]!.assetPathAfter).toBe("/Game/UAgentSandbox/run-verification-boundary/Work");
  });

  it("blocks real verify and rollback before any adapter, manifest, or state transition across all statuses", async () => {
    let rollbackCalls = 0;
    let verificationCalls = 0;
    const service = createAssetChangeSetService({
      executionMode: "real",
      manifest: createAssetManifestRegistry(),
      adapter: {
        execute: () => ({ ok: false, reason: "must_not_run", evidenceId: "execute-called" }),
        rollback: () => {
          rollbackCalls += 1;
          return { ok: true, reason: null, evidenceId: "rollback-called" };
        },
      },
      verification: {
        verify: () => {
          verificationCalls += 1;
          return {
            id: "asset-verification:called",
            changeSetId: "unexpected",
            status: "passed" as const,
            checkedAt: 1,
            checks: [],
            evidenceId: "verify-called",
            redaction: { redacted: true, replacedPaths: 0, replacedSecrets: 0 },
            summary: "must not run",
          };
        },
      },
    });

    const pending = service.dryRun(inputFor("run-real-pending")).changeSet.id;
    const bound = await service.bindExternalDryRun({ changeSetId: service.dryRun(inputFor("run-real-bound")).changeSet.id, binder: validBinder });
    const approvalRequired = service.preview(bound.changeSet!.id).changeSet!.id;
    const approvedDry = service.dryRun(inputFor("run-real-approved"));
    const approvedBound = await service.bindExternalDryRun({ changeSetId: approvedDry.changeSet.id, binder: validBinder });
    service.preview(approvedBound.changeSet!.id);
    const approved = service.approve({ changeSetId: approvedBound.changeSet!.id, actor: "tester", reason: "deferred gate" }).changeSet!.id;
    const failedDry = service.dryRun(inputFor("run-real-failed"));
    const failed = await service.bindExternalDryRun({
      changeSetId: failedDry.changeSet.id,
      binder: { call: async () => ({ structuredContent: { blocked: false, status: "dry_run_completed" } }) },
    });
    expect(failed.changeSet?.state).toBe("failed");

    const ids = [pending, bound.changeSet!.id, approvalRequired, approved, failed.changeSet!.id];
    for (const id of ids) {
      const rolledBack = await service.rollback(id);
      expect(rolledBack.status, id).toBe("blocked");
      expect(rolledBack.reason, id).toBe("rollback_not_enabled");
      const verified = await service.verify(id);
      expect(verified.status, id).toBe("blocked");
      expect(verified.reason, id).toBe("verify_not_enabled");
    }
    expect(rollbackCalls).toBe(0);
    expect(verificationCalls).toBe(0);
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

    const dryRun = service.dryRun({
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      runId: "run-block-1",
      operations: [
        { kind: "create_folder", assetPathAfter: "/Game/UAgentSandbox/run-block-1/Work" },
      ],
    });

    // Real mode keeps the ChangeSet external_pending; preview and approve stay blocked.
    expect(dryRun.status).toBe("dry_run_completed");
    expect(dryRun.changeSet.externalBindingStatus).toBe("external_pending");
    const preview = service.preview(dryRun.changeSet.id);
    expect(preview.status).toBe("blocked");
    expect(preview.reason).toBe("external_binding_external_pending");
    const approval = service.approve({ changeSetId: dryRun.changeSet.id, actor: "tester", reason: "verify" });
    expect(approval.status).toBe("blocked");
    expect(approval.reason).toBe("external_binding_external_pending");
    const executed = await service.execute({
      changeSetId: dryRun.changeSet.id,
      approvalToken: "forged",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
    });
    expect(executed.status).toBe("blocked");
    expect(executed.reason).toBe("execute_not_enabled");
    expect(nativeGuardCalls).toEqual([]);
    expect(mcpCalls).toEqual([]);
  });

  it("binds real ChangeSet through live plugin exact dry-run, validates structured results, and keeps execute not-enabled", async () => {
    const events: string[] = [];
    const runId = "run-1";
    const changeSetRef = { id: "" };
    const toolOperations = [
      { kind: "create_folder" as const, assetPathBefore: null, assetPathAfter: `/Game/UAgentSandbox/${runId}/Work` },
      { kind: "duplicate_asset" as const, assetPathBefore: "/Game/Templates/Hero", assetPathAfter: `/Game/UAgentSandbox/${runId}/Work/HeroCopy` },
      { kind: "rename_asset" as const, assetPathBefore: `/Game/UAgentSandbox/${runId}/Work/HeroCopy`, assetPathAfter: `/Game/UAgentSandbox/${runId}/Work/HeroRenamed` },
      { kind: "move_asset" as const, assetPathBefore: `/Game/UAgentSandbox/${runId}/Work/HeroRenamed`, assetPathAfter: `/Game/UAgentSandbox/${runId}/Work/Sub/HeroRenamed` },
      { kind: "save_single_asset" as const, assetPathBefore: `/Game/UAgentSandbox/${runId}/Work/Sub/HeroRenamed`, assetPathAfter: `/Game/UAgentSandbox/${runId}/Work/Sub/HeroRenamed` },
    ];
    const binder: AssetMutationExternalBinder = {
      call: async (input) => {
        events.push(`bind:${input.exactToolName}`);
        expect(input.context.changeSetId).toBe(changeSetRef.id);
        expect(input.context.runId).toBe(runId);
        const argsDryRun = (input.context as DryRunBindingContext & { __args?: unknown }).__args;
        // The binder only receives the canonical payload; execute/rollback flags are always false.
        const dryArgs = buildExactDryRunPayload(input).args as Record<string, unknown>;
        expect(dryArgs.dryRun).toBe(true);
        expect(dryArgs.execute).toBe(false);
        expect(dryArgs.rollback).toBe(false);
        expect(dryArgs).not.toHaveProperty("dryRunHash");
        expect(dryArgs).not.toHaveProperty("approvalToken");
        void argsDryRun;
        return { structuredContent: structuredDryRunResult(input.exactToolName, input.operationKind as AssetMutationOperationKindForHelper, changeSetRef.id, runId, input.assetPathBefore, input.assetPathAfter) };
      },
    };
    const service = createAssetChangeSetService({
      executionMode: "real",
      manifest: createAssetManifestRegistry(),
      adapter: createMvp15McpAssetMutationAdapter({
        tools: [
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
        })),
        assetMutationGateEnabled: true,
        observedEditorSessionId: "editor-session:1",
        observedPidHash: "pid:fixture",
        nativeGuard: () => {
          events.push("native-guard-reached");
          return { status: "accepted_by_native_guard", reason: "should-not-run", evidenceId: "x" };
        },
        callTool: () => {
          events.push("mcp-execute-reached");
          return { status: "executed", reason: null, evidenceId: "x" };
        },
      }),
    });

    const dryRun = service.dryRun({
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      runId,
      operations: toolOperations,
    });
    changeSetRef.id = dryRun.changeSet.id;
    expect(dryRun.changeSet.id).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(dryRun.changeSet.externalBindingStatus).toBe("external_pending");

    const bindingBeforePreview = service.preview(dryRun.changeSet.id);
    expect(bindingBeforePreview.status).toBe("blocked");
    expect(bindingBeforePreview.reason).toBe("external_binding_external_pending");

    const bound = await service.bindExternalDryRun({ changeSetId: dryRun.changeSet.id, binder });
    expect(bound.status).toBe("dry_run_completed");
    expect(bound.changeSet?.externalBindingStatus).toBe("external_bound");
    expect(bound.changeSet?.aggregateDryRunHash).toBeTruthy();
    expect(bound.changeSet?.aggregateArgsHash).toBeTruthy();
    expect(bound.dryRun?.operations.every((op) => op.provenance?.dryRunHashSource === "ue_mcp_exact_tool" && /^[0-9a-f]{40}$/.test(op.provenance!.dryRunHash))).toBe(true);
    expect(bound.dryRun?.operations.every((op) => op.provenance?.dryRunHashAlgorithm === "sha1" && op.provenance?.dryRunSchemaVersion === "mvp15c.dry-run.v1")).toBe(true);
    expect(events).toEqual(toolOperations.map((op) => `bind:${exactNameFor(op.kind)}`));

    const preview = service.preview(dryRun.changeSet.id);
    expect(preview.status).toBe("previewed");

    const approval = service.approve({ changeSetId: dryRun.changeSet.id, actor: "tester", reason: "supervisor real smoke" });
    expect(approval.status).toBe("approved");
    expect(approval.changeSet?.approval?.orderedOperationIds).toEqual(dryRun.changeSet.operations.map((op) => op.id));
    expect(approval.changeSet?.approval?.aggregateDryRunHash).toBe(bound.changeSet?.aggregateDryRunHash);
    expect(JSON.stringify(approval.changeSet)).not.toContain("asset-approval-token:");

    // Aggregate is stable: re-binding via the same binder over the same payload yields the same aggregate hash.
    const second = createAssetChangeSetService({
      executionMode: "real" as const,
      manifest: createAssetManifestRegistry(),
      adapter: createFixtureAssetMutationAdapter(),
    });
    const secondDry = second.dryRun({
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      runId,
      operations: toolOperations,
    });
    const secondBound = await second.bindExternalDryRun({ changeSetId: secondDry.changeSet.id, binder });
    expect(secondBound.changeSet?.aggregateDryRunHash).toBe(bound.changeSet?.aggregateDryRunHash);
    expect(secondBound.changeSet?.aggregateArgsHash).toBe(bound.changeSet?.aggregateArgsHash);

    // Execute stays not-enabled in real mode even after a complete binding; no native guard or MCP call runs.
    const executed = await service.execute({
      changeSetId: dryRun.changeSet.id,
      approvalToken: approval.approvalToken!,
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
    });
    expect(executed.status).toBe("blocked");
    expect(executed.reason).toBe("execute_not_enabled");
    expect(events).not.toContain("native-guard-reached");
    expect(events).not.toContain("mcp-execute-reached");
  });

  it("blocks real ChangeSet binding when plugin result mismatches changeSetId, and never keeps partial hashes", async () => {
    const ctxOf = (csId: string, runId: string): DryRunBindingContext => ({
      changeSetId: csId,
      runId,
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      sandboxRoot: "/Game/UAgentSandbox",
    });
    const validInput = { operationId: "op-1", operationKind: "create_folder" as const, assetPathBefore: null, assetPathAfter: "/Game/UAgentSandbox/run-wrong/Work", exactToolName: "ue.asset.create_folder", context: ctxOf("cs-1", "run-wrong") };
    // Stale/wrong changeSetId inside the plugin result must fail closed.
    const mismatch = structuredDryRunResult("ue.asset.create_folder", "create_folder", "cs-different", "run-wrong", null, "/Game/UAgentSandbox/run-wrong/Work");
    expect(validatePluginDryRunResult(unwrapPluginDryRunResult({ structuredContent: mismatch }), { expectedToolName: "ue.asset.create_folder", expectedOperationKind: "create_folder", context: validInput.context }).ok).toBe(false);
    // Malformed / unknown object must fail closed (not default to success).
    expect(validatePluginDryRunResult(unwrapPluginDryRunResult({ ok: true }), { expectedToolName: "ue.asset.create_folder", expectedOperationKind: "create_folder", context: validInput.context }).ok).toBe(false);
    expect(validatePluginDryRunResult(null, { expectedToolName: "ue.asset.create_folder", expectedOperationKind: "create_folder", context: validInput.context }).ok).toBe(false);
    // Blocked plugin result must fail closed with a stable reason.
    const blocked = { ...mismatch, blocked: true, status: "dry_run_blocked", reasonCode: "blocked_by_sandbox" };
    expect(validatePluginDryRunResult(unwrapPluginDryRunResult({ structuredContent: blocked }), { expectedToolName: "ue.asset.create_folder", expectedOperationKind: "create_folder", context: validInput.context }).ok).toBe(false);

    // The runtime service never keeps partial hashes on atomic binding failure.
    const service = createAssetChangeSetService({ executionMode: "real", manifest: createAssetManifestRegistry(), adapter: createFixtureAssetMutationAdapter() });
    const dryRun = service.dryRun({
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      runId: "run-wrong",
      operations: [{ kind: "create_folder", assetPathAfter: "/Game/UAgentSandbox/run-wrong/Work" }],
    });
    const failingBinder: AssetMutationExternalBinder = { call: async () => ({ structuredContent: mismatch }) };
    const bound = await service.bindExternalDryRun({ changeSetId: dryRun.changeSet.id, binder: failingBinder });
    expect(bound.status).toBe("blocked");
    expect(bound.changeSet?.externalBindingStatus).toBe("blocked");
    expect(bound.changeSet?.aggregateDryRunHash).toBeNull();
    expect(bound.changeSet?.operations.every((op) => op.provenance === null)).toBe(true);
  });

  it("blocks real approve and execute when no external binder has bound the ChangeSet", async () => {
    const service = createAssetChangeSetService({
      executionMode: "real",
      manifest: createAssetManifestRegistry(),
      adapter: createFixtureAssetMutationAdapter(),
    });

    const dryRun = service.dryRun({
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      runId: "run-pending",
      operations: [{ kind: "create_folder", assetPathAfter: "/Game/UAgentSandbox/run-pending/Work" }],
    });
    expect(service.preview(dryRun.changeSet.id).status).toBe("blocked");
    const approval = service.approve({ changeSetId: dryRun.changeSet.id, actor: "tester", reason: "pending" });
    expect(approval.status).toBe("blocked");
    expect(approval.approvalToken).toBeFalsy();
    const executed = await service.execute({ changeSetId: dryRun.changeSet.id, approvalToken: "forged", editorSessionId: "editor-session:1", pidHash: "pid:fixture" });
    expect(executed.status).toBe("blocked");
    expect(executed.reason).toBe("execute_not_enabled");
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
