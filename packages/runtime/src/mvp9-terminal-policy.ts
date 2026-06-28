import type { TerminalCommandClassification, TerminalCommandRisk } from "@uagent/shared";

const ALLOWLIST_COMMANDS = new Set([
  "pnpm", "npm", "node", "tsc", "eslint", "prettier", "vitest",
  "cargo", "rustc", "clippy-driver", "rustfmt",
  "git", "dir", "ls", "cat", "type", "findstr", "where",
  "dotnet", "cmake", "make",
]);

const DENYLIST_COMMANDS = new Set([
  "rm", "del", "rmdir", "rd", "sudo", "doas",
  "shred", "dd", "mkfs", "format",
  "chmod", "chown", "attrib",
  "reg", "regedit", "regedt32",
  "sc", "net", "wmic",
]);

const DANGEROUS_PATTERNS = [
  { re: /\bcurl\s+/i, label: "curl" },
  { re: /\bwget\s+/i, label: "wget" },
  { re: /\b(?:bash|sh|zsh|powershell|pwsh|cmd)\s+-[ec]/i, label: "inline shell" },
  { re: /\|+\s*(?:bash|sh|zsh|powershell|pwsh|cmd)\b/i, label: "pipe to shell" },
  { re: />>?\s+/i, label: "redirect write" },
  { re: /;\s*(?:rm|del|sudo|shutdown|format|mkfs)/i, label: "chained dangerous" },
  { re: /2>&1\s*\|\s*/i, label: "pipe stderr" },
  { re: /\$\s*\(/i, label: "command substitution" },
  { re: /`[^`]+`/, label: "backtick execution" },
  { re: /--no-verify\b/i, label: "skip verification" },
  { re: /--force\b/i, label: "force flag" },
];

const SHELL_METACHARS = /[;&|`$()<>{}!^]/;

const NETWORK_HINTS = [
  "http://", "https://", "api.", ".com", ".org",
  "github.com", "npmjs.com", "registry",
];

function getBaseCommand(fullCommand: string): string {
  const trimmed = fullCommand.trim();
  const firstSpace = trimmed.indexOf(" ");
  return firstSpace > 0 ? trimmed.slice(0, firstSpace) : trimmed;
}

function hasShellMetachar(command: string): boolean {
  return SHELL_METACHARS.test(command);
}

function detectDeniedCombination(command: string): string | null {
  if (DENYLIST_COMMANDS.has(getBaseCommand(command))) {
    return `command '${getBaseCommand(command)}' is denylisted`;
  }
  for (const pat of DANGEROUS_PATTERNS) {
    if (pat.re.test(command)) {
      return `matched dangerous pattern: ${pat.label}`;
    }
  }
  return null;
}

function detectNetworkHints(command: string): string[] {
  return NETWORK_HINTS.filter((hint) => command.includes(hint));
}

function isCwdContained(cwd: string, trustedRoot: string): boolean {
  const normalizedCwd = cwd.replace(/\\/g, "/").toLowerCase();
  const normalizedRoot = trustedRoot.replace(/\\/g, "/").toLowerCase();
  return normalizedCwd.startsWith(normalizedRoot);
}

export function classifyTerminalCommandRisk(
  command: string,
  cwd: string,
  trustedRoot: string,
): TerminalCommandClassification {
  const baseCmd = getBaseCommand(command);
  const denied = detectDeniedCombination(command);
  const networkHints = detectNetworkHints(command);
  const shellMeta = hasShellMetachar(command);
  const contained = isCwdContained(cwd, trustedRoot);

  let risk: TerminalCommandRisk;
  let reason: string;
  let matchedKeyword: string | null = null;

  if (denied) {
    risk = "denied_combination";
    reason = denied;
    matchedKeyword = baseCmd;
  } else if (!contained) {
    risk = "root_escape";
    reason = `cwd '${cwd}' is outside trusted root '${trustedRoot}'`;
    matchedKeyword = cwd;
  } else if (shellMeta && !ALLOWLIST_COMMANDS.has(baseCmd)) {
    risk = "shell_metachar";
    reason = `command contains shell metacharacters and base command '${baseCmd}' is not allowlisted`;
    matchedKeyword = baseCmd;
  } else if (DENYLIST_COMMANDS.has(baseCmd)) {
    risk = "dangerous_command";
    reason = `command '${baseCmd}' is denylisted`;
    matchedKeyword = baseCmd;
  } else if (ALLOWLIST_COMMANDS.has(baseCmd)) {
    risk = "allowlisted";
    reason = `command '${baseCmd}' is in the allowlist`;
    matchedKeyword = null;
  } else if (networkHints.length > 0) {
    risk = "network_hint";
    reason = `command contains network hints: ${networkHints.join(", ")}`;
    matchedKeyword = networkHints[0];
  } else {
    risk = "unknown";
    reason = `command '${baseCmd}' is not in the allowlist`;
    matchedKeyword = baseCmd;
  }

  return {
    command,
    risk,
    reason,
    matchedKeyword,
    cwd,
    cwdIsContained: contained,
    hasShellMetachar: shellMeta,
    envHints: networkHints,
  };
}

export function isProposalExecutable(classification: TerminalCommandClassification): boolean {
  return classification.risk === "allowlisted" || classification.risk === "unknown";
}

export function createAllowlistTerminalPolicy(trustedRoot: string) {
  return {
    trustedRoot,
    allowedCommands: ALLOWLIST_COMMANDS,
    classify: (command: string, cwd: string) =>
      classifyTerminalCommandRisk(command, cwd, trustedRoot),
    isExecutable: isProposalExecutable,
  };
}
