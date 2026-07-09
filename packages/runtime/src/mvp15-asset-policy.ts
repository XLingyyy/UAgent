import type { AssetMutationOperationKind, AssetMutationRisk } from "@uagent/shared";

export type AssetPathPolicyReason =
  | "ok"
  | "empty_path"
  | "path_traversal"
  | "empty_segment"
  | "non_sandbox_path"
  | "engine_content_blocked"
  | "plugin_content_blocked"
  | "generated_content_blocked"
  | "external_package_blocked"
  | "invalid_run_id";

export interface AssetPathPolicyResult {
  ok: boolean;
  reason: AssetPathPolicyReason;
  canonicalPath: string | null;
}

export interface SandboxAssetPathPolicy {
  sandboxRoot: "/Game/UAgentSandbox";
  contentRoot: "/Content/UAgentSandbox";
  validateAssetPath(path: string | null | undefined): AssetPathPolicyResult;
  validatePackagePath(path: string | null | undefined): AssetPathPolicyResult;
  mapContentPathToAssetPath(path: string): string;
  mapAssetPathToPackagePath(path: string): string;
  validateRunId(runId: string): AssetPathPolicyResult;
}

export function createSandboxAssetPathPolicy(): SandboxAssetPathPolicy {
  const validate = (path: string | null | undefined, root: string): AssetPathPolicyResult => {
    const canonicalPath = canonicalize(path);
    if (!canonicalPath) return { ok: false, reason: "empty_path", canonicalPath: null };
    if (canonicalPath.includes("..")) return { ok: false, reason: "path_traversal", canonicalPath };
    if (/\/{2,}/.test(canonicalPath)) return { ok: false, reason: "empty_segment", canonicalPath };
    if (canonicalPath.startsWith("/Engine/")) return { ok: false, reason: "engine_content_blocked", canonicalPath };
    if (canonicalPath.startsWith("/Plugin/") || canonicalPath.startsWith("/Plugins/")) return { ok: false, reason: "plugin_content_blocked", canonicalPath };
    if (canonicalPath.includes("/Generated/") || canonicalPath.includes("/DerivedDataCache/")) return { ok: false, reason: "generated_content_blocked", canonicalPath };
    if (canonicalPath.startsWith("/External/")) return { ok: false, reason: "external_package_blocked", canonicalPath };
    if (canonicalPath !== root && !canonicalPath.startsWith(`${root}/`)) return { ok: false, reason: "non_sandbox_path", canonicalPath };
    return { ok: true, reason: "ok", canonicalPath };
  };

  return {
    sandboxRoot: "/Game/UAgentSandbox",
    contentRoot: "/Content/UAgentSandbox",
    validateAssetPath: (path) => validate(path, "/Game/UAgentSandbox"),
    validatePackagePath: (path) => validate(path, "/Content/UAgentSandbox"),
    mapContentPathToAssetPath: (path) => canonicalize(path)?.replace(/^\/Content\/UAgentSandbox/, "/Game/UAgentSandbox") ?? "",
    mapAssetPathToPackagePath: (path) => canonicalize(path)?.replace(/^\/Game\/UAgentSandbox/, "/Content/UAgentSandbox") ?? "",
    validateRunId: (runId) =>
      /^[A-Za-z0-9_-]+$/.test(runId)
        ? { ok: true, reason: "ok", canonicalPath: runId }
        : { ok: false, reason: "invalid_run_id", canonicalPath: runId },
  };
}

export function classifyAssetMutationRisk(kind: AssetMutationOperationKind, blockedReason: string | null): AssetMutationRisk {
  if (blockedReason === "bulk_operation_blocked") return "blocked_bulk";
  if (blockedReason) return blockedReason.includes("sandbox") ? "blocked_non_sandbox" : "blocked_unknown";
  if (kind === "delete_sandbox_asset") return "high_destructive";
  if (kind === "rename_asset" || kind === "move_asset" || kind === "save_single_asset" || kind === "duplicate_asset") return "medium_sandbox";
  return "low_sandbox";
}

function canonicalize(path: string | null | undefined): string | null {
  const trimmed = path?.trim().replace(/\\/g, "/");
  if (!trimmed) return null;
  return trimmed.endsWith("/") && trimmed.length > 1 ? trimmed.slice(0, -1) : trimmed;
}
