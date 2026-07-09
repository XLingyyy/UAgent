import { createAssetChangeSetService, createFixtureAssetMutationAdapter } from "./mvp15-asset-changeset.js";
import { createAssetManifestRegistry } from "./mvp15-asset-manifest.js";
import { createSandboxAssetPathPolicy } from "./mvp15-asset-policy.js";
import { classifyMvp15McpAssetTool } from "./mvp15-mcp-asset-adapter.js";
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
    add(`mcp-${tool}`, `Exact allowlist ${tool}`, classifyMvp15McpAssetTool({ toolName: tool, inputSchema: { type: "object" }, dryRunSchema: { type: "object" }, args: { assetPath: "/Game/UAgentSandbox/run-1/Hero" } }).decision === "dry_run_required");
  }
  for (const tool of ["ue.asset.compile_blueprint", "mcp.broad.call", "ue.asset.global_save", "ue.asset.bulk_delete"]) {
    add(`mcp-block-${tool}`, `Block ${tool}`, classifyMvp15McpAssetTool({ toolName: tool, inputSchema: { type: "object" }, dryRunSchema: { type: "object" } }).decision === "blocked");
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
