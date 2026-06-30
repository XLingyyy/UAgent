import type { McpToolDescriptor } from "@uagent/shared";
import type { McpMutationToolPolicy } from "@uagent/shared";

export interface McpMutationAllowlistEntry {
  toolName: string;
  requiresDryRun?: boolean;
  textBacked?: boolean;
  stateOnly?: boolean;
  assetRisk?: boolean;
}

export interface McpMutationPolicyOptions {
  allowlist?: McpMutationAllowlistEntry[];
}

function isMutatingTool(tool: McpToolDescriptor): boolean {
  const name = tool.name.toLowerCase();
  const annotations = tool.annotations ?? {};
  return Boolean(
    annotations.destructiveHint ||
      annotations.mutating ||
      /\b(create|update|write|patch|delete|rename|move|save|compile|select|open|focus)\b/.test(name),
  );
}

export function classifyMcpMutationTool(tool: McpToolDescriptor, options: McpMutationPolicyOptions = {}): McpMutationToolPolicy {
  const mutating = isMutatingTool(tool);
  if (!mutating) {
    return {
      toolName: tool.name,
      classification: "read_only",
      allowlisted: false,
      requiresDryRun: false,
      textBacked: false,
      stateOnly: false,
      assetRisk: false,
      decision: "read_only",
      reason: "read_only_tool",
    };
  }
  const allow = (options.allowlist ?? []).find((entry) => entry.toolName === tool.name);
  if (!allow) {
    return {
      toolName: tool.name,
      classification: "mutating",
      allowlisted: false,
      requiresDryRun: true,
      textBacked: false,
      stateOnly: false,
      assetRisk: false,
      decision: "blocked",
      reason: "not_allowlisted",
    };
  }
  if (!tool.inputSchema || typeof tool.inputSchema !== "object") {
    return {
      toolName: tool.name,
      classification: "mutating",
      allowlisted: true,
      requiresDryRun: true,
      textBacked: false,
      stateOnly: false,
      assetRisk: false,
      decision: "blocked",
      reason: "schema_required",
    };
  }
  return {
    toolName: tool.name,
    classification: "mutating",
    allowlisted: true,
    requiresDryRun: allow.requiresDryRun ?? true,
    textBacked: allow.textBacked ?? false,
    stateOnly: allow.stateOnly ?? false,
    assetRisk: allow.assetRisk ?? false,
    decision: "dry_run_required",
    reason: allow.stateOnly ? "allowlisted_state_only" : allow.textBacked ? "allowlisted_text_backed" : "allowlisted_dry_run",
  };
}
