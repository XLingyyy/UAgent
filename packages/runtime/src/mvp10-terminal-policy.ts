import type {
  CommandDenyResult,
  CommandAllowlistMatch,
  MutationDetectionResult,
} from "@uagent/shared";

const MVP10_ALLOWLIST_ENTRIES = [
  "pnpm typecheck",
  "pnpm lint",
  "pnpm test",
  "pnpm --filter @uagent/shared test",
  "pnpm --filter @uagent/runtime test",
  "pnpm --filter @uagent/mcp-client test",
  "pnpm --filter @uagent/desktop test",
  "pnpm --filter @uagent/desktop web:build",
  "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml",
  "git status",
  "git diff",
  "git diff --check",
] as const;

export const MVP10_ALLOWLIST: readonly string[] = MVP10_ALLOWLIST_ENTRIES;

const ALLOWLIST_SET = new Set<string>(MVP10_ALLOWLIST_ENTRIES);

const ALLOWLIST_RISK_MAP: Record<string, CommandAllowlistMatch["riskLevel"]> = {
  "git status": "read_only",
  "git diff": "read_only",
  "git diff --check": "read_only",
  "pnpm typecheck": "low_risk",
  "pnpm lint": "low_risk",
  "pnpm test": "low_risk",
  "pnpm --filter @uagent/shared test": "low_risk",
  "pnpm --filter @uagent/runtime test": "low_risk",
  "pnpm --filter @uagent/mcp-client test": "low_risk",
  "pnpm --filter @uagent/desktop test": "low_risk",
  "pnpm --filter @uagent/desktop web:build": "medium_write",
  "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml": "low_risk",
};

const DENYLIST_BASE_COMMANDS = new Set([
  "rm", "del", "rd", "rmdir", "sudo", "doas", "chmod", "chown", "attrib",
]);

const NETWORK_COMMANDS = new Set([
  "curl", "wget", "ssh", "scp", "sftp", "ftp",
]);

const INSTALL_PREFIXES = [
  "npm install", "pnpm install", "yarn add", "pip install", "cargo install",
];

const GIT_MUTATING_COMMANDS = new Set([
  "push", "pull", "fetch", "merge", "rebase", "commit",
]);

const DANGEROUS_COMMANDS = new Set([
  "docker", "shutdown", "reboot", "dd", "mkfs", "format", "shred",
]);

const SHELL_METACHAR_RE = /[;&|`$()<>{}!^]/;

const SENSITIVE_KEY_PATTERNS = ["SECRET", "KEY", "TOKEN", "AUTH", "PASSWORD", "CREDENTIAL", "API_KEY"];
const SENSITIVE_VALUE_PATTERNS = [/^sk-/, /^Bearer\s/, /^token=/];

export function parseCommand(command: string): { base: string; args: string[] } {
  const trimmed = command.trim();
  if (!trimmed) return { base: "", args: [] };

  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (ch === " " && !inSingle && !inDouble) {
      if (current) {
        parts.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);

  return {
    base: parts[0] || "",
    args: parts.slice(1),
  };
}

export function hasShellMetachar(command: string): boolean {
  return SHELL_METACHAR_RE.test(command);
}

export function isCwdContained(cwd: string, trustedRoot: string): boolean {
  const normalizedCwd = cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const normalizedRoot = trustedRoot.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return normalizedCwd === normalizedRoot || normalizedCwd.startsWith(`${normalizedRoot}/`);
}

function hasForbiddenFlags(command: string, parsed: { base: string; args: string[] }): boolean {
  const trimmed = command.trim();
  if (parsed.args.includes("--fix") && trimmed.startsWith("pnpm lint")) {
    return true;
  }
  if (parsed.args.includes("--force")) {
    return true;
  }
  if (parsed.args.includes("--no-verify")) {
    return true;
  }
  return false;
}

function isInstallCommand(command: string): boolean {
  const trimmed = command.trim().toLowerCase();
  return INSTALL_PREFIXES.some((prefix) => trimmed.startsWith(prefix));
}

function isGitMutating(args: string[]): boolean {
  return args.length > 0 && GIT_MUTATING_COMMANDS.has(args[0]);
}

export function isAllowlistedCommand(command: string): CommandAllowlistMatch {
  const trimmed = command.trim();
  if (ALLOWLIST_SET.has(trimmed)) {
    return {
      matched: true,
      template: trimmed,
      riskLevel: ALLOWLIST_RISK_MAP[trimmed] ?? "read_only",
    };
  }
  return { matched: false, template: null, riskLevel: "read_only" };
}

export function detectDeniedCommand(command: string): CommandDenyResult {
  const trimmed = command.trim();
  if (!trimmed) {
    return { allowed: false, denyReason: "unknown_command", detail: "Empty command" };
  }
  const parsed = parseCommand(trimmed);

  if (hasForbiddenFlags(trimmed, parsed)) {
    return { allowed: false, denyReason: "forbidden_flag", detail: "Command contains forbidden flags" };
  }

  if (DENYLIST_BASE_COMMANDS.has(parsed.base)) {
    return { allowed: false, denyReason: "blocked_command", detail: `'${parsed.base}' is blocked` };
  }

  if (isInstallCommand(trimmed)) {
    return { allowed: false, denyReason: "install_operation", detail: `Install command blocked` };
  }

  if (parsed.base === "git" && isGitMutating(parsed.args)) {
    return { allowed: false, denyReason: "git_mutating_operation", detail: `Git mutating command blocked` };
  }

  if (NETWORK_COMMANDS.has(parsed.base)) {
    return { allowed: false, denyReason: "network_operation", detail: `Network command '${parsed.base}' blocked` };
  }

  if (DANGEROUS_COMMANDS.has(parsed.base)) {
    return { allowed: false, denyReason: "dangerous_pattern", detail: `Dangerous command '${parsed.base}' blocked` };
  }

  if (isAllowlistedCommand(trimmed).matched) {
    return { allowed: true, denyReason: null, detail: "Command is allowlisted" };
  }

  return { allowed: false, denyReason: "unknown_command", detail: `Command not recognized: ${trimmed}` };
}

export function sanitizeTerminalEnv(env: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const upperKey = key.toUpperCase();
    const hasSensitiveKey = SENSITIVE_KEY_PATTERNS.some((pat) => upperKey.includes(pat));
    const hasSensitiveValue = SENSITIVE_VALUE_PATTERNS.some((re) => re.test(value));
    if (!hasSensitiveKey && !hasSensitiveValue) {
      result[key] = value;
    }
  }
  return result;
}

export function detectMutation(
  command: string,
  changedFilesBefore: string[],
  changedFilesAfter: string[],
): MutationDetectionResult {
  const beforeSet = new Set(changedFilesBefore);
  const afterSet = new Set(changedFilesAfter);

  const hasNewFiles = changedFilesAfter.some((f) => !beforeSet.has(f));
  const hasRemovedFiles = changedFilesBefore.some((f) => !afterSet.has(f));
  const mutated = hasNewFiles || hasRemovedFiles;

  const allowlistMatch = isAllowlistedCommand(command);
  const expectedToMutate = allowlistMatch.riskLevel === "medium_write";
  const violation = mutated && !expectedToMutate;

  const changedFiles = mutated
    ? changedFilesAfter.filter((f) => !beforeSet.has(f))
    : [];

  const detail = violation
    ? `Unexpected mutation: command risk level '${allowlistMatch.riskLevel}' should not produce file changes`
    : mutated
      ? "Mutation detected as expected"
      : "No mutation detected";

  return { mutated, changedFiles, violation, detail };
}

export function getDefaultExecutionLimits(): {
  timeoutMs: number;
  maxTimeoutMs: number;
  outputLimitBytes: number;
  outputLimitLines: number;
} {
  return {
    timeoutMs: 60_000,
    maxTimeoutMs: 300_000,
    outputLimitBytes: 1_048_576,
    outputLimitLines: 5_000,
  };
}

export function classifyMvp10TerminalCommand(
  command: string,
  cwd: string,
  trustedRoot: string,
): CommandDenyResult & {
  command: string;
  parsed: { base: string; args: string[] };
  allowlistMatch: CommandAllowlistMatch;
} {
  const trimmed = command.trim();
  const parsed = parseCommand(trimmed);
  const allowlistMatch = isAllowlistedCommand(trimmed);
  const shellMeta = hasShellMetachar(trimmed);
  const contained = isCwdContained(cwd, trustedRoot);

  if (!allowlistMatch.matched && shellMeta) {
    return {
      allowed: false, denyReason: "shell_metachar", detail: "Command contains shell metacharacters",
      command: trimmed, parsed, allowlistMatch,
    };
  }

  if (hasForbiddenFlags(trimmed, parsed)) {
    return {
      allowed: false, denyReason: "forbidden_flag", detail: "Command contains forbidden flags",
      command: trimmed, parsed, allowlistMatch,
    };
  }

  if (DENYLIST_BASE_COMMANDS.has(parsed.base)) {
    return {
      allowed: false, denyReason: "blocked_command", detail: `'${parsed.base}' is blocked`,
      command: trimmed, parsed, allowlistMatch,
    };
  }

  if (isInstallCommand(trimmed)) {
    return {
      allowed: false, denyReason: "install_operation", detail: "Install command blocked",
      command: trimmed, parsed, allowlistMatch,
    };
  }

  if (parsed.base === "git" && isGitMutating(parsed.args)) {
    return {
      allowed: false, denyReason: "git_mutating_operation", detail: "Git mutating command blocked",
      command: trimmed, parsed, allowlistMatch,
    };
  }

  if (NETWORK_COMMANDS.has(parsed.base)) {
    return {
      allowed: false, denyReason: "network_operation", detail: `Network command '${parsed.base}' blocked`,
      command: trimmed, parsed, allowlistMatch,
    };
  }

  if (DANGEROUS_COMMANDS.has(parsed.base)) {
    return {
      allowed: false, denyReason: "dangerous_pattern", detail: `Dangerous command '${parsed.base}' blocked`,
      command: trimmed, parsed, allowlistMatch,
    };
  }

  if (!contained) {
    return {
      allowed: false, denyReason: "cwd_escape", detail: `CWD '${cwd}' is outside trusted root '${trustedRoot}'`,
      command: trimmed, parsed, allowlistMatch,
    };
  }

  if (allowlistMatch.matched) {
    return {
      allowed: true, denyReason: null, detail: "Command is in the allowlist",
      command: trimmed, parsed, allowlistMatch,
    };
  }

  return {
    allowed: false, denyReason: "unknown_command", detail: `Command not recognized: '${trimmed}'`,
    command: trimmed, parsed, allowlistMatch,
  };
}

export const MVP10_DENYLIST_COMMANDS = {
  baseCommands: Array.from(DENYLIST_BASE_COMMANDS),
  networkCommands: Array.from(NETWORK_COMMANDS),
  gitMutatingCommands: Array.from(GIT_MUTATING_COMMANDS),
  dangerousCommands: Array.from(DANGEROUS_COMMANDS),
  installPrefixes: [...INSTALL_PREFIXES],
} as const;
