import type { McpMutationDryRunResult, McpToolDescriptor } from "@uagent/shared";
import { redactMvp12Text } from "./mvp12-change-set.js";
import { classifyMcpMutationTool, type McpMutationAllowlistEntry } from "./mvp13-mcp-mutation-policy.js";

export interface McpMutationServiceOptions {
  allowlist?: McpMutationAllowlistEntry[];
  now?: () => number;
}

export interface McpMutationDryRunInput {
  tool: McpToolDescriptor;
  args: Record<string, unknown>;
  sessionId: string | null;
  projectId: string;
  rootId: string;
}

export type McpMutationDryRunActionResult =
  | { status: "dry_run_completed"; reason: null; result: McpMutationDryRunResult }
  | { status: "blocked"; reason: string; result: null };

function summarizeArgs(args: Record<string, unknown>): string {
  return redactMvp12Text(JSON.stringify(args)).text;
}

export function createMcpMutationService(options: McpMutationServiceOptions = {}) {
  const now = options.now ?? Date.now;
  const dryRuns = new Map<string, string[]>();
  let sequence = 0;

  return {
    dryRun(input: McpMutationDryRunInput): McpMutationDryRunActionResult {
      const policy = classifyMcpMutationTool(input.tool, { allowlist: options.allowlist });
      if (policy.decision !== "dry_run_required") {
        return { status: "blocked", reason: policy.reason, result: null };
      }
      const createdAt = now();
      const result: McpMutationDryRunResult = {
        id: `mcp-dry-run:${++sequence}`,
        toolName: input.tool.name,
        wouldChange: policy.stateOnly || policy.textBacked || policy.assetRisk,
        operationKind: policy.stateOnly ? "select_asset" : policy.textBacked ? "patch_text_file" : "asset_mutation_plan",
        affectedFiles: policy.textBacked ? ["Config/DefaultGame.ini"] : policy.assetRisk ? ["Content/Hero.uasset"] : [],
        assetRisk: policy.assetRisk,
        textBacked: policy.textBacked,
        stateOnly: policy.stateOnly,
        blockedReason: null,
        summary: `Dry-run ${input.tool.name} with redacted args ${summarizeArgs(input.args)}`,
        redaction: { redacted: true, replacedPaths: 0, replacedSecrets: JSON.stringify(input.args).includes("sk-") ? 1 : 0 },
        createdAt,
      };
      dryRuns.set(result.id, ["dry_run"]);
      return { status: "dry_run_completed", reason: null, result };
    },
    getReplaySummary(dryRunId: string) {
      return { dryRunId, replayOnly: true, recordedOnlyActions: dryRuns.get(dryRunId) ?? [] };
    },
  };
}
