/** Local UE build contracts. Native preparation is authoritative for paths and authorization. */
export interface UEBuildProfile {
  schemaVersion: 1;
  profileId: string;
  projectId: string;
  engineRoot: string;
  uprojectRelativePath: string;
  target: string;
  platform: "Win64";
  configuration: "Debug" | "DebugGame" | "Development" | "Shipping" | "Test";
  method: "ubt" | "build_bat";
  /** Required for ubt: exact engine-bundled SDK directory, e.g. 10.0. Never PATH lookup. */
  bundledDotnetVersion?: string | null;
  timeoutMs: number;
}

export interface PreparedUEBuild {
  profile: UEBuildProfile;
  fingerprint: string;
  engineVersion: string;
  projectRoot: string;
  uproject: string;
  targetFile: string;
  program: string;
  arguments: string[];
  cwd: string;
  timeoutMs: number;
  expectedMutation: "build_artifacts_and_project_build_logic";
  verification: "not_started";
}

export interface UEBuildOwner {
  runId: string;
  stepId: string;
  fingerprint: string;
}

export type UEBuildStatus =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "not_started"
  | "termination_unknown";

export interface UEBuildExecutionResult {
  owner: UEBuildOwner;
  status: UEBuildStatus;
  reason: string;
  pid: number | null;
  exitCode: number | null;
  durationMs: number;
  /** Only true after the owned process tree is confirmed empty. */
  treeStopped: boolean;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
  outputComplete: boolean;
  /** A cancellation or timeout can leave build artifacts behind. */
  effects: "not_started" | "possible";
}

/** Early UI feedback only: it neither approves a build nor verifies filesystem paths. */
export function validateUEBuildProfileShape(profile: UEBuildProfile): string[] {
  const hasControl = (value: string): boolean =>
    [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  const issues: string[] = [];
  if (profile.schemaVersion !== 1) issues.push("unsupported_schema");
  for (const key of ["profileId", "projectId"] as const) {
    if (!profile[key].trim() || profile[key].length > 256 || hasControl(profile[key]))
      issues.push(`invalid_${key}`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(profile.target)) issues.push("invalid_target");
  if (profile.platform !== "Win64") issues.push("unsupported_platform");
  if (!["Debug", "DebugGame", "Development", "Shipping", "Test"].includes(profile.configuration)) {
    issues.push("invalid_configuration");
  }
  if (!["ubt", "build_bat"].includes(profile.method)) issues.push("invalid_method");
  if (
    !Number.isInteger(profile.timeoutMs) ||
    profile.timeoutMs < 1_000 ||
    profile.timeoutMs > 7_200_000
  ) {
    issues.push("invalid_timeout");
  }
  if (
    !/^(?:[A-Za-z]:[\\/]|\/)/.test(profile.engineRoot) ||
    hasControl(profile.engineRoot) ||
    /["%!&|<>^]/.test(profile.engineRoot)
  ) {
    issues.push("invalid_engine_root");
  }
  const relative = profile.uprojectRelativePath.replace(/\\/g, "/");
  if (
    !relative ||
    relative.startsWith("/") ||
    relative.includes(":") ||
    relative.split("/").some((part) => !part || part === "." || part === "..") ||
    !relative.endsWith(".uproject") ||
    hasControl(relative) ||
    /["%!&|<>^]/.test(relative)
  ) {
    issues.push("invalid_uproject_path");
  }
  if (profile.method === "ubt" && !/^\d+(?:\.\d+){1,3}$/.test(profile.bundledDotnetVersion ?? "")) {
    issues.push("invalid_bundled_dotnet_version");
  }
  return issues;
}

/** Log text never overrides process evidence, including logs that say 'BUILD SUCCESSFUL'. */
export function isVerifiedUEBuildSuccess(result: UEBuildExecutionResult): boolean {
  return (
    result.status === "succeeded" &&
    result.exitCode === 0 &&
    result.treeStopped &&
    result.outputComplete
  );
}
