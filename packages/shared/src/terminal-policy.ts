export type CommandAllowlistEntry =
  | "pnpm typecheck"
  | "pnpm lint"
  | "pnpm test"
  | "pnpm --filter @uagent/shared test"
  | "pnpm --filter @uagent/runtime test"
  | "pnpm --filter @uagent/mcp-client test"
  | "pnpm --filter @uagent/desktop test"
  | "pnpm --filter @uagent/desktop web:build"
  | "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml"
  | "git status"
  | "git diff"
  | "git diff --check";

export type CommandDenyReason =
  | "blocked_command"
  | "dangerous_pattern"
  | "forbidden_flag"
  | "network_operation"
  | "install_operation"
  | "git_mutating_operation"
  | "shell_metachar"
  | "cwd_escape"
  | "unknown_command";

export interface ExecutionFeatureGate {
  feature: string;
  enabled: boolean;
  defaultEnabled: boolean;
  requiresApprovalToken: boolean;
}

export interface CommandDenyResult {
  allowed: boolean;
  denyReason: CommandDenyReason | null;
  detail: string;
}

export interface CommandAllowlistMatch {
  matched: boolean;
  template: string | null;
  riskLevel: "read_only" | "low_risk" | "medium_write";
}

export interface TerminalExecutionPolicy {
  classifyCommand(command: string): CommandDenyResult;
  matchAllowlist(command: string): CommandAllowlistMatch;
  isCwdContained(cwd: string, trustedRoot: string): boolean;
  sanitizeEnv(env: Record<string, string>): Record<string, string>;
  detectMutation(command: string, changedFiles: string[]): MutationDetectionResult;
}

export interface MutationDetectionResult {
  mutated: boolean;
  changedFiles: string[];
  violation: boolean;
  detail: string;
}

export interface BuildRunSummary {
  id: string;
  taskId: string | null;
  commands: BuildCommandResult[];
  totalDurationMs: number;
  failedCount: number;
  passedCount: number;
  blockedCount: number;
  mutationProof: MutationProof | null;
  createdAt: number;
}

export interface BuildCommandResult {
  template: string;
  command: string;
  status: "passed" | "failed" | "blocked" | "skipped";
  exitCode: number | null;
  durationMs: number;
  outputSummary: string;
  redactionSummary: { replacedSecrets: number; replacedPaths: number };
}

export interface MutationProof {
  id: string;
  buildRunId: string;
  filesChanged: string[];
  filesBefore: Record<string, string>;
  filesAfter: Record<string, string>;
  mutationDetected: boolean;
  verifiedAt: number;
}
