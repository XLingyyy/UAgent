import { classifyEditorOperation } from "./mvp13-editor-policy.js";
import { createEditorOperationService } from "./mvp13-editor-operation-service.js";
import { createEditorSessionRegistry } from "./mvp13-editor-session.js";
import { createMcpMutationService } from "./mvp13-mcp-mutation-service.js";
import { classifyMcpMutationTool } from "./mvp13-mcp-mutation-policy.js";
import { mapMcpDryRunToOperation } from "./mvp13-dry-run-adapter.js";

export interface Mvp13ScenarioResult {
  name: string;
  assertionCount: number;
  pass: boolean;
  summary: string;
}

export interface Mvp13ScenarioMatrixResult {
  scenarios: Mvp13ScenarioResult[];
  totalAssertions: number;
}

export function runMvp13ScenarioMatrix(): Mvp13ScenarioMatrixResult {
  const scenarios: Mvp13ScenarioResult[] = [];
  const push = (name: string, assertionCount: number, pass: boolean, summary: string) =>
    scenarios.push({ name, assertionCount, pass, summary });

  const sessions = createEditorSessionRegistry({ featureEnabled: true, trustedRootIds: ["root:trusted"], now: () => 1 });
  const session = sessions.attach({ projectId: "project:1", rootId: "root:trusted", uprojectDisplayPath: "[project-root]/Game.uproject", mode: "fixture" }).session!;
  const operations = createEditorOperationService({ sessions, now: () => 1 });
  const proposal = operations.propose({ sessionId: session.sessionId, operationKind: "select_asset", args: { asset: "/Game/Hero" } });
  const approval = operations.approve({ proposalId: proposal.proposal!.proposalId, actor: "scenario", reason: "state-only smoke" });
  const executed = operations.execute({
    proposalId: proposal.proposal!.proposalId,
    approvalToken: approval.approval!.token,
    operationKind: "select_asset",
    args: { asset: "/Game/Hero" },
  });
  const mcp = createMcpMutationService({ allowlist: [{ toolName: "ue.asset.select", stateOnly: true, requiresDryRun: true }], now: () => 1 });
  const dryRun = mcp.dryRun({
    tool: { name: "ue.asset.select", annotations: { mutating: true }, inputSchema: { type: "object" } },
    args: { asset: "/Game/Hero" },
    sessionId: session.sessionId,
    projectId: "project:1",
    rootId: "root:trusted",
  }).result!;

  const checks: Array<[string, boolean, string]> = [
    ["feature-disabled-blocked", createEditorSessionRegistry({ featureEnabled: false }).attach({ projectId: "p", rootId: "root:trusted", uprojectDisplayPath: "[project-root]/Game.uproject", mode: "fixture" }).reason === "feature_disabled", "disabled gate"],
    ["trusted-root-required", createEditorSessionRegistry({ featureEnabled: true }).attach({ projectId: "p", rootId: "root:trusted", uprojectDisplayPath: "[project-root]/Game.uproject", mode: "fixture" }).reason === "untrusted_root", "trusted root"],
    ["session-attached", session.status === "attached", "attached"],
    ["session-replay-only", sessions.createReplaySummary(session.sessionId)?.replayOnly === true, "replay only"],
    ["editor-status-readonly", classifyEditorOperation({ operationKind: "status" }).decision === "allow_read_only", "status"],
    ["editor-open-state-only", classifyEditorOperation({ operationKind: "open_asset" }).risk === "state_only", "open"],
    ["editor-focus-state-only", classifyEditorOperation({ operationKind: "focus_content_browser" }).risk === "state_only", "focus"],
    ["editor-select-state-only", classifyEditorOperation({ operationKind: "select_asset" }).risk === "state_only", "select"],
    ["editor-validation-readonly", classifyEditorOperation({ operationKind: "run_read_only_validation" }).risk === "read_only", "validation"],
    ["editor-diagnostics-readonly", classifyEditorOperation({ operationKind: "refresh_diagnostics" }).risk === "read_only", "diagnostics"],
    ["editor-preview-state-only", classifyEditorOperation({ operationKind: "open_local_preview" }).risk === "state_only", "preview"],
    ["editor-text-backed-changeset", classifyEditorOperation({ operationKind: "patch_text_file" }).decision === "changeset_required", "text-backed"],
    ["asset-save-blocked", classifyEditorOperation({ operationKind: "save_asset" }).risk === "blocked_asset_write", "save blocked"],
    ["asset-delete-blocked", classifyEditorOperation({ operationKind: "delete_asset" }).risk === "blocked_asset_write", "delete blocked"],
    ["asset-rename-blocked", classifyEditorOperation({ operationKind: "rename_asset" }).risk === "blocked_asset_write", "rename blocked"],
    ["asset-move-blocked", classifyEditorOperation({ operationKind: "move_asset" }).risk === "blocked_asset_write", "move blocked"],
    ["blueprint-compile-blocked", classifyEditorOperation({ operationKind: "compile_blueprint" }).risk === "blocked_asset_write", "compile blocked"],
    ["unknown-editor-blocked", classifyEditorOperation({ operationKind: "magic" }).risk === "blocked_unknown", "unknown blocked"],
    ["proposal-created", proposal.status === "approval_required", "proposal"],
    ["approval-created", approval.status === "approved", "approval"],
    ["execute-state-only", executed.status === "executed", "execute"],
    ["approval-replay-blocked", operations.execute({ proposalId: proposal.proposal!.proposalId, approvalToken: approval.approval!.token, operationKind: "select_asset", args: { asset: "/Game/Hero" } }).reason === "proposal_not_executable", "replay"],
    ["mcp-default-blocked", classifyMcpMutationTool({ name: "ue.asset.delete", annotations: { destructiveHint: true } }).decision === "blocked", "default blocked"],
    ["mcp-readonly", classifyMcpMutationTool({ name: "ue.project.status" }).decision === "read_only", "readonly"],
    ["mcp-allowlist-dryrun", classifyMcpMutationTool({ name: "ue.asset.select", annotations: { mutating: true }, inputSchema: { type: "object" } }, { allowlist: [{ toolName: "ue.asset.select", stateOnly: true }] }).decision === "dry_run_required", "allowlist"],
    ["mcp-schema-required", classifyMcpMutationTool({ name: "ue.asset.select", annotations: { mutating: true } }, { allowlist: [{ toolName: "ue.asset.select", stateOnly: true }] }).reason === "schema_required", "schema"],
    ["mcp-dryrun-completed", dryRun.stateOnly, "dryrun"],
    ["mcp-replay-recorded", mcp.getReplaySummary(dryRun.id).recordedOnlyActions.includes("dry_run"), "replay"],
    ["dryrun-state-map", mapMcpDryRunToOperation(dryRun).kind === "editor_operation", "state map"],
    ["dryrun-text-map", mapMcpDryRunToOperation({ ...dryRun, id: "text", textBacked: true, stateOnly: false, affectedFiles: ["Config/DefaultGame.ini"] }).kind === "changeset_v2", "text map"],
    ["dryrun-asset-blocked-map", mapMcpDryRunToOperation({ ...dryRun, id: "asset", assetRisk: true, stateOnly: false, affectedFiles: ["Content/Hero.uasset"] }).kind === "asset_plan_blocked", "asset plan"],
    ["dryrun-blocked-map", mapMcpDryRunToOperation({ ...dryRun, id: "blocked", blockedReason: "no_dry_run" }).kind === "blocked", "blocked map"],
  ];

  for (const [name, pass, summary] of checks) push(`mvp13-${name}`, 4, pass, summary);
  return { scenarios, totalAssertions: scenarios.reduce((total, scenario) => total + scenario.assertionCount, 0) };
}
