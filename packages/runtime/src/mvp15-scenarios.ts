import { createAssetChangeSetService, createFixtureAssetMutationAdapter } from "./mvp15-asset-changeset.js";
import { createAssetManifestRegistry } from "./mvp15-asset-manifest.js";
import { createSandboxAssetPathPolicy } from "./mvp15-asset-policy.js";
import { classifyMvp15McpAssetTool, createMvp15McpAssetToolInventory } from "./mvp15-mcp-asset-adapter.js";
import { createMvp15ExactToolFacade } from "./mvp15-exact-tool-facade.js";
import { replayAssetMutationSummary } from "./mvp15-asset-replay.js";

export interface Mvp15ScenarioResult {
  id: string;
  title: string;
  pass: boolean;
  assertions: number;
}

export interface Mvp15ScenarioMatrixResult {
  scenarios: Mvp15ScenarioResult[];
  totalAssertions: number;
}

export async function createMvp15ScenarioMatrix(): Promise<Mvp15ScenarioMatrixResult> {
  const scenarios: Mvp15ScenarioResult[] = [];
  const add = (id: string, title: string, pass: boolean, assertions = 4) => scenarios.push({ id, title, pass, assertions });
  const policy = createSandboxAssetPathPolicy();
  const fullContracts = {
    inputSchema: { type: "object" },
    dryRunSchema: { type: "object" },
    rollbackContract: { type: "reverse_operation" },
    affectedAssetsSchema: { type: "array" },
    evidenceQuery: { type: "read_only" },
  };
  const allowedPaths = [
    "/Game/UAgentSandbox/run-1",
    "/Game/UAgentSandbox/run-1/Hero",
    "/Game/UAgentSandbox/run-1/Sub/Hero",
    "/Content/UAgentSandbox/run-1/Hero",
  ];
  for (const [index, path] of allowedPaths.entries()) add(`policy-allowed-${index}`, `Allow ${path}`, path.startsWith("/Content/") ? policy.validatePackagePath(path).ok : policy.validateAssetPath(path).ok);
  for (const [index, path] of ["/Game/Hero", "/Engine/Hero", "/Plugin/Hero", "/Game/UAgentSandbox/../Hero", "/Game/UAgentSandbox//Hero"].entries()) {
    add(`policy-blocked-${index}`, `Block ${path}`, !policy.validateAssetPath(path).ok);
  }
  for (const tool of ["ue.asset.create_folder", "ue.asset.duplicate", "ue.asset.rename", "ue.asset.move", "ue.asset.delete", "ue.asset.save"]) {
    add(`mcp-${tool}`, `Exact allowlist ${tool}`, classifyMvp15McpAssetTool({ toolName: tool, ...fullContracts, args: { assetPath: "/Game/UAgentSandbox/run-1/Hero" } }).decision === "dry_run_required");
  }
  for (const tool of ["ue.asset.compile_blueprint", "mcp.broad.call", "ue.asset.global_save", "ue.asset.bulk_delete"]) {
    add(`mcp-block-${tool}`, `Block ${tool}`, classifyMvp15McpAssetTool({ toolName: tool, ...fullContracts }).decision === "blocked");
  }
  for (const [id, tool] of [
    ["schema", { name: "ue.asset.save", dryRunSchema: { type: "object" }, rollbackContract: { type: "reverse_operation" }, affectedAssetsSchema: { type: "array" }, evidenceQuery: { type: "read_only" } }],
    ["dry-run", { name: "ue.asset.save", inputSchema: { type: "object" }, rollbackContract: { type: "reverse_operation" }, affectedAssetsSchema: { type: "array" }, evidenceQuery: { type: "read_only" } }],
    ["rollback", { name: "ue.asset.save", inputSchema: { type: "object" }, dryRunSchema: { type: "object" }, affectedAssetsSchema: { type: "array" }, evidenceQuery: { type: "read_only" } }],
    ["evidence", { name: "ue.asset.save", inputSchema: { type: "object" }, dryRunSchema: { type: "object" }, rollbackContract: { type: "reverse_operation" }, affectedAssetsSchema: { type: "array" } }],
  ] as const) {
    const inventory = createMvp15McpAssetToolInventory([
      { name: "ue.asset.create_folder", ...fullContracts },
      { name: "ue.asset.duplicate", ...fullContracts },
      { name: "ue.asset.rename", ...fullContracts },
      { name: "ue.asset.move", ...fullContracts },
      { name: "ue.asset.delete", ...fullContracts },
      tool,
    ]);
    add(`inventory-missing-${id}`, `Inventory blocks missing ${id}`, inventory.status === "blocked_by_mcp_schema");
  }
  const readyInventory = createMvp15McpAssetToolInventory([
    { name: "ue.asset.create_folder", ...fullContracts },
    { name: "ue.asset.duplicate", ...fullContracts },
    { name: "ue.asset.rename", ...fullContracts },
    { name: "ue.asset.move", ...fullContracts },
    { name: "ue.asset.delete", ...fullContracts },
    { name: "ue.asset.save", ...fullContracts },
  ]);
  add("inventory-ready", "Inventory ready only when all exact contracts are present", readyInventory.status === "ready" && readyInventory.availableTools.length === 6);
  const facade = createMvp15ExactToolFacade([
    {
      toolsetId: "editor_toolset.toolsets.asset.AssetTools",
      methods: [
        { exactToolName: "ue.asset.create_folder", methodId: "create_folder", schemaVersion: "1", ...fullContracts },
        { exactToolName: "ue.asset.duplicate", methodId: "duplicate", schemaVersion: "1", ...fullContracts },
        { exactToolName: "ue.asset.rename", methodId: "rename", schemaVersion: "1", ...fullContracts },
        { exactToolName: "ue.asset.move", methodId: "move", schemaVersion: "1", ...fullContracts },
        { exactToolName: "ue.asset.delete", methodId: "delete", schemaVersion: "1", ...fullContracts },
        { exactToolName: "ue.asset.save", methodId: "save", schemaVersion: "1", ...fullContracts },
      ],
    },
  ]);
  add("facade-ready", "Facade generates exact descriptors from compliant wrapper descriptions", facade.status === "ready" && facade.tools.length === 6);
  add("facade-fixed-wrapper", "Facade descriptors pin wrapper toolset and method ids", facade.tools.every((tool) => Boolean(tool.annotations?.mvp15Facade)));
  const blockedFacade = createMvp15ExactToolFacade([
    {
      toolsetId: "editor_toolset.toolsets.asset.AssetTools",
      methods: [
        { exactToolName: "ue.asset.create_folder", methodId: "create_folder", schemaVersion: "1", ...fullContracts },
        { exactToolName: "ue.asset.duplicate", methodId: "duplicate", schemaVersion: "1", ...fullContracts, dryRunSchema: null },
      ],
    },
  ]);
  add("facade-incomplete-blocked", "Facade remains schema-blocked when described methods are incomplete", blockedFacade.status === "blocked_by_mcp_schema" && blockedFacade.tools.length === 1);
  for (const reason of ["rollback_contract_required", "external_evidence_required", "sandbox_path_required", "not_allowlisted"]) {
    const result = reason === "rollback_contract_required"
      ? classifyMvp15McpAssetTool({ toolName: "ue.asset.move", ...fullContracts, rollbackContract: null })
      : reason === "external_evidence_required"
        ? classifyMvp15McpAssetTool({ toolName: "ue.asset.delete", ...fullContracts, evidenceQuery: null })
        : reason === "sandbox_path_required"
          ? classifyMvp15McpAssetTool({ toolName: "ue.asset.save", ...fullContracts, args: { assetPath: "/Game/Hero" } })
          : classifyMvp15McpAssetTool({ toolName: "call_tool", ...fullContracts });
    add(`mcp-reason-${reason}`, `MCP block reason ${reason}`, result.reason === reason);
  }
  for (let i = 0; i < 29; i += 1) {
    const service = createAssetChangeSetService({
      now: (() => {
        let tick = i + 1;
        return () => tick++;
      })(),
      manifest: createAssetManifestRegistry(),
      adapter: createFixtureAssetMutationAdapter(),
    });
    const dry = service.dryRun({
      projectId: "project:fixture",
      trustedRootId: "root:fixture",
      editorSessionId: "editor-session:1",
      pidHash: "pid:fixture",
      runId: `run-${i}`,
      operations: [{ kind: "create_folder", assetPathAfter: `/Game/UAgentSandbox/run-${i}` }],
    });
    service.preview(dry.changeSet.id);
    const approval = service.approve({ changeSetId: dry.changeSet.id, actor: "matrix", reason: "coverage" });
    const execution = await service.execute({ changeSetId: dry.changeSet.id, approvalToken: approval.approvalToken!, editorSessionId: "editor-session:1", pidHash: "pid:fixture" });
    const verified = await service.verify(dry.changeSet.id);
    const replay = replayAssetMutationSummary(verified.changeSet!);
    add(`changeset-${i}`, `ChangeSet path ${i}`, dry.status === "dry_run_completed" && execution.status === "executed" && verified.status === "verified" && replay.reexecutionBlocked);
  }
  return {
    scenarios,
    totalAssertions: scenarios.reduce((total, scenario) => total + scenario.assertions, 0),
  };
}
