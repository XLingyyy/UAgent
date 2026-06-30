export type Mvp14EditorProcessPolicyReason =
  | "allowed"
  | "feature_disabled"
  | "untrusted_root"
  | "network_root"
  | "root_escape"
  | "missing_uproject"
  | "executable_outside_allowlist"
  | "shell_metachar"
  | "raw_env_injection"
  | "pid_session_root_project_mismatch";

export interface Mvp14EditorProcessPolicyInput {
  projectId: string;
  rootId: string;
  trustedRootIds: string[];
  uprojDisplayPath: string;
  displayCommand?: string | null;
  displayExecutableHash?: string | null;
  allowedExecutableHashes?: string[];
  redactedEnv?: Record<string, string> | null;
  sessionProjectId?: string | null;
  sessionRootId?: string | null;
}

export interface Mvp14EditorProcessPolicyResult {
  status: "allowed" | "blocked";
  reason: Mvp14EditorProcessPolicyReason;
}

export function evaluateEditorProcessPolicy(input: Mvp14EditorProcessPolicyInput): Mvp14EditorProcessPolicyResult {
  if (!input.trustedRootIds.includes(input.rootId)) return blocked("untrusted_root");
  const path = input.uprojDisplayPath.replace(/\\/g, "/");
  if (path.startsWith("//")) return blocked("network_root");
  if (path.includes("..") || path.startsWith("/") || /^[A-Za-z]:\//.test(path)) return blocked("root_escape");
  if (!path.startsWith("[project-root]/") || !path.endsWith(".uproject")) return blocked("missing_uproject");
  if (input.displayCommand && /[;&|`$<>]/.test(input.displayCommand)) return blocked("shell_metachar");
  if (input.redactedEnv && Object.keys(input.redactedEnv).length > 0) return blocked("raw_env_injection");
  if (
    input.displayExecutableHash &&
    input.allowedExecutableHashes &&
    !input.allowedExecutableHashes.includes(input.displayExecutableHash)
  ) {
    return blocked("executable_outside_allowlist");
  }
  if (
    (input.sessionProjectId && input.sessionProjectId !== input.projectId) ||
    (input.sessionRootId && input.sessionRootId !== input.rootId)
  ) {
    return blocked("pid_session_root_project_mismatch");
  }
  return { status: "allowed", reason: "allowed" };
}

function blocked(reason: Mvp14EditorProcessPolicyReason): Mvp14EditorProcessPolicyResult {
  return { status: "blocked", reason };
}
