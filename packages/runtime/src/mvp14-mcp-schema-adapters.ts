import type { AssetMutationPlan, ContextPackRedactionSummary } from "@uagent/shared";

export type Mvp14McpSchemaClassification =
  | "read_only_status"
  | "read_only_resources"
  | "state_only_operation"
  | "text_backed_patch_intent"
  | "asset_plan_blocked"
  | "blocked_unknown";

export interface Mvp14McpSchemaAdapterInput {
  toolName: string;
  inputSchema: unknown;
  args?: Record<string, unknown>;
}

export interface Mvp14McpSchemaAdapterResult {
  classification: Mvp14McpSchemaClassification;
  reason: string;
  redactedArgs: Record<string, unknown>;
  dryRunSummary: string;
  changeSetMapped: boolean;
  assetPlan: AssetMutationPlan | null;
  redaction: ContextPackRedactionSummary;
}

export function classifyMvp14McpSchema(input: Mvp14McpSchemaAdapterInput): Mvp14McpSchemaAdapterResult {
  const redactedArgs = redactArgs(input.args ?? {});
  const hasSchema = input.inputSchema !== null && input.inputSchema !== undefined;
  const lowerName = input.toolName.toLowerCase();
  if (!hasSchema) return result("blocked_unknown", "schema_required", redactedArgs);
  if (lowerName.includes("status") || lowerName.includes("diagnostic")) {
    return result("read_only_status", "read_only_status_schema", redactedArgs);
  }
  if (lowerName.includes("resources") || lowerName.includes("list")) {
    return result("read_only_resources", "read_only_resource_schema", redactedArgs);
  }
  if (lowerName.includes("select") || lowerName.includes("open") || lowerName.includes("focus")) {
    return result("state_only_operation", "state_only_schema", redactedArgs);
  }
  if (lowerName.includes("patch") || lowerName.includes("config") || lowerName.includes("text")) {
    return result("text_backed_patch_intent", "changeset_v2_required", redactedArgs, true);
  }
  if (lowerName.includes("save") || lowerName.includes("delete") || lowerName.includes("rename") || lowerName.includes("move") || lowerName.includes("compile")) {
    const plan: AssetMutationPlan = {
      id: `asset-plan:${hash(input.toolName)}`,
      toolName: input.toolName,
      operationKind: input.toolName,
      affectedAssets: typeof redactedArgs.asset === "string" ? [redactedArgs.asset] : ["[project-root]/Content/Unknown.uasset"],
      status: "blocked",
      reason: "asset_mutation_blocked",
      summary: "Asset mutation remains a blocked plan for MVP14.",
      redaction: { redacted: true, replacedPaths: 0, replacedSecrets: 0 },
    };
    return { ...result("asset_plan_blocked", "asset_write_blocked", redactedArgs), assetPlan: plan };
  }
  return result("blocked_unknown", "unknown_schema", redactedArgs);
}

function result(
  classification: Mvp14McpSchemaClassification,
  reason: string,
  redactedArgs: Record<string, unknown>,
  changeSetMapped = false,
): Mvp14McpSchemaAdapterResult {
  return {
    classification,
    reason,
    redactedArgs,
    dryRunSummary: `${classification}:${reason}`,
    changeSetMapped,
    assetPlan: null,
    redaction: { redacted: true, replacedPaths: 0, replacedSecrets: 0 },
  };
}

function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (/token|secret|key|authorization/i.test(key)) {
      redacted[key] = "[redacted]";
    } else if (typeof value === "string") {
      redacted[key] = value.replace(/[A-Za-z]:[\\/][^\s"']+/g, "[outside-root]").replace(/\/(?:Users|home)\/[^\s"']+/g, "[outside-root]");
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

function hash(value: string): string {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) result = (result * 31 + value.charCodeAt(i)) >>> 0;
  return result.toString(16);
}
