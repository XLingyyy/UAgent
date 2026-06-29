import { describe, it, expect } from "vitest";
import {
  parseCommand,
  hasShellMetachar,
  isCwdContained,
  isAllowlistedCommand,
  detectDeniedCommand,
  sanitizeTerminalEnv,
  detectMutation,
  getDefaultExecutionLimits,
  classifyMvp10TerminalCommand,
  MVP10_ALLOWLIST,
} from "./mvp10-terminal-policy.js";

describe("parseCommand", () => {
  it("parses simple command", () => {
    const result = parseCommand("git status");
    expect(result.base).toBe("git");
    expect(result.args).toEqual(["status"]);
  });

  it("parses command with multiple arguments", () => {
    const result = parseCommand("pnpm --filter @uagent/shared test");
    expect(result.base).toBe("pnpm");
    expect(result.args).toEqual(["--filter", "@uagent/shared", "test"]);
  });

  it("handles empty command", () => {
    const result = parseCommand("");
    expect(result.base).toBe("");
    expect(result.args).toEqual([]);
  });

  it("handles just spaces", () => {
    const result = parseCommand("   ");
    expect(result.base).toBe("");
    expect(result.args).toEqual([]);
  });

  it("handles quoted arguments", () => {
    const result = parseCommand("echo \"hello world\"");
    expect(result.base).toBe("echo");
    expect(result.args).toEqual(["hello world"]);
  });

  it("handles single-quoted arguments", () => {
    const result = parseCommand("echo 'hello world'");
    expect(result.base).toBe("echo");
    expect(result.args).toEqual(["hello world"]);
  });
});

describe("hasShellMetachar", () => {
  it("detects semicolon chaining", () => {
    expect(hasShellMetachar("pnpm test; pnpm lint")).toBe(true);
  });

  it("detects double ampersand", () => {
    expect(hasShellMetachar("pnpm test && pnpm lint")).toBe(true);
  });

  it("detects pipe", () => {
    expect(hasShellMetachar("ls | grep foo")).toBe(true);
  });

  it("detects redirect write", () => {
    expect(hasShellMetachar("echo foo > bar.txt")).toBe(true);
  });

  it("detects backtick execution", () => {
    expect(hasShellMetachar("echo `whoami`")).toBe(true);
  });

  it("returns false for clean command", () => {
    expect(hasShellMetachar("git status")).toBe(false);
  });
});

describe("isCwdContained", () => {
  it("returns true for cwd inside trusted root", () => {
    expect(isCwdContained("G:/Projects/MyApp/src", "G:/Projects/MyApp")).toBe(true);
  });

  it("returns false for cwd outside trusted root", () => {
    expect(isCwdContained("C:/Windows/System32", "G:/Projects/MyApp")).toBe(false);
  });

  it("returns false for sibling path with same prefix", () => {
    expect(isCwdContained("G:/Projects/MyApplication", "G:/Projects/MyApp")).toBe(false);
  });

  it("returns true for exact match", () => {
    expect(isCwdContained("G:/Projects/MyApp", "G:/Projects/MyApp")).toBe(true);
  });
});

describe("isAllowlistedCommand", () => {
  const allowlistedCommands = [
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
  ];

  for (const cmd of allowlistedCommands) {
    it(`matches exact command: ${cmd}`, () => {
      const result = isAllowlistedCommand(cmd);
      expect(result.matched).toBe(true);
      expect(result.template).toBe(cmd);
    });
  }

  it("does not match command with extra args", () => {
    expect(isAllowlistedCommand("pnpm lint --fix").matched).toBe(false);
  });

  it("does not match command with prefix only", () => {
    expect(isAllowlistedCommand("pnpm typecheck --watch").matched).toBe(false);
  });

  it("classifies git status as read_only", () => {
    expect(isAllowlistedCommand("git status").riskLevel).toBe("read_only");
  });

  it("classifies pnpm typecheck as low_risk", () => {
    expect(isAllowlistedCommand("pnpm typecheck").riskLevel).toBe("low_risk");
  });

  it("classifies web:build as medium_write", () => {
    expect(isAllowlistedCommand("pnpm --filter @uagent/desktop web:build").riskLevel).toBe("medium_write");
  });
});

describe("detectDeniedCommand", () => {
  it("allows exact allowlisted command", () => {
    const result = detectDeniedCommand("git status");
    expect(result.allowed).toBe(true);
    expect(result.denyReason).toBeNull();
  });

  it("blocks pnpm lint --fix", () => {
    const result = detectDeniedCommand("pnpm lint --fix");
    expect(result.allowed).toBe(false);
    expect(result.denyReason).toBe("forbidden_flag");
  });

  it("blocks rm command", () => {
    const result = detectDeniedCommand("rm -rf /tmp");
    expect(result.allowed).toBe(false);
    expect(result.denyReason).toBe("blocked_command");
  });

  it("blocks sudo command", () => {
    expect(detectDeniedCommand("sudo pnpm install").allowed).toBe(false);
  });

  it("blocks doas command", () => {
    expect(detectDeniedCommand("doas rm file").allowed).toBe(false);
  });

  it("blocks curl command", () => {
    const result = detectDeniedCommand("curl https://example.com");
    expect(result.allowed).toBe(false);
    expect(result.denyReason).toBe("network_operation");
  });

  it("blocks wget command", () => {
    expect(detectDeniedCommand("wget http://example.com/file").allowed).toBe(false);
  });

  it("blocks ssh command", () => {
    expect(detectDeniedCommand("ssh user@host").allowed).toBe(false);
  });

  it("blocks npm install", () => {
    const result = detectDeniedCommand("npm install lodash");
    expect(result.allowed).toBe(false);
    expect(result.denyReason).toBe("install_operation");
  });

  it("blocks pnpm install", () => {
    expect(detectDeniedCommand("pnpm install lodash").allowed).toBe(false);
  });

  it("blocks yarn add", () => {
    expect(detectDeniedCommand("yarn add lodash").allowed).toBe(false);
  });

  it("blocks pip install", () => {
    expect(detectDeniedCommand("pip install flask").allowed).toBe(false);
  });

  it("blocks cargo install", () => {
    expect(detectDeniedCommand("cargo install some-crate").allowed).toBe(false);
  });

  it("blocks git push", () => {
    const result = detectDeniedCommand("git push origin main");
    expect(result.allowed).toBe(false);
    expect(result.denyReason).toBe("git_mutating_operation");
  });

  it("blocks git commit", () => {
    expect(detectDeniedCommand("git commit -m 'test'").allowed).toBe(false);
  });

  it("blocks git pull", () => {
    expect(detectDeniedCommand("git pull origin main").allowed).toBe(false);
  });

  it("blocks git merge", () => {
    expect(detectDeniedCommand("git merge feature-branch").allowed).toBe(false);
  });

  it("blocks git rebase", () => {
    expect(detectDeniedCommand("git rebase main").allowed).toBe(false);
  });

  it("blocks docker command", () => {
    const result = detectDeniedCommand("docker ps");
    expect(result.allowed).toBe(false);
    expect(result.denyReason).toBe("dangerous_pattern");
  });

  it("blocks --force flag anywhere", () => {
    expect(detectDeniedCommand("git status --force").allowed).toBe(false);
  });

  it("blocks --no-verify flag anywhere", () => {
    expect(detectDeniedCommand("pnpm test --no-verify").allowed).toBe(false);
  });

  it("rejects empty command", () => {
    const result = detectDeniedCommand("");
    expect(result.allowed).toBe(false);
    expect(result.denyReason).toBe("unknown_command");
  });
});

describe("classifyMvp10TerminalCommand", () => {
  const TRUSTED_ROOT = "G:/Projects/UAgent";

  it("allows exact allowlisted command in trusted root", () => {
    const result = classifyMvp10TerminalCommand("git status", TRUSTED_ROOT, TRUSTED_ROOT);
    expect(result.allowed).toBe(true);
    expect(result.denyReason).toBeNull();
    expect(result.parsed.base).toBe("git");
    expect(result.allowlistMatch.matched).toBe(true);
    expect(result.allowlistMatch.template).toBe("git status");
  });

  it("allows pnpm typecheck", () => {
    const result = classifyMvp10TerminalCommand("pnpm typecheck", TRUSTED_ROOT, TRUSTED_ROOT);
    expect(result.allowed).toBe(true);
    expect(result.allowlistMatch.riskLevel).toBe("low_risk");
  });

  it("blocks shell metachar for non-allowlisted command", () => {
    const result = classifyMvp10TerminalCommand("echo hello; ls", TRUSTED_ROOT, TRUSTED_ROOT);
    expect(result.allowed).toBe(false);
    expect(result.denyReason).toBe("shell_metachar");
  });

  it("blocks CWD escape", () => {
    const result = classifyMvp10TerminalCommand("git status", "C:/tmp", TRUSTED_ROOT);
    expect(result.allowed).toBe(false);
    expect(result.denyReason).toBe("cwd_escape");
  });

  it("blocks dangerous commands inside cwd", () => {
    const result = classifyMvp10TerminalCommand("rm -rf /", TRUSTED_ROOT, TRUSTED_ROOT);
    expect(result.allowed).toBe(false);
    expect(result.denyReason).toBe("blocked_command");
  });

  it("returns parsed command details", () => {
    const result = classifyMvp10TerminalCommand(
      "pnpm --filter @uagent/desktop web:build",
      TRUSTED_ROOT,
      TRUSTED_ROOT,
    );
    expect(result.parsed.base).toBe("pnpm");
    expect(result.parsed.args).toEqual(["--filter", "@uagent/desktop", "web:build"]);
    expect(result.allowlistMatch.riskLevel).toBe("medium_write");
  });

  it("rejects unrecognized command", () => {
    const result = classifyMvp10TerminalCommand("some-unknown-tool", TRUSTED_ROOT, TRUSTED_ROOT);
    expect(result.allowed).toBe(false);
    expect(result.denyReason).toBe("unknown_command");
  });

  it("handles very long command", () => {
    const long = "a".repeat(5000);
    const result = classifyMvp10TerminalCommand(long, TRUSTED_ROOT, TRUSTED_ROOT);
    expect(result.allowed).toBe(false);
    expect(result.parsed.base).toBe(long);
  });

  it("blocks pnpm lint --fix even inside trusted root", () => {
    const result = classifyMvp10TerminalCommand("pnpm lint --fix", TRUSTED_ROOT, TRUSTED_ROOT);
    expect(result.allowed).toBe(false);
    expect(result.denyReason).toBe("forbidden_flag");
  });

  it("allows allowlisted command with contained subdirectory cwd", () => {
    const result = classifyMvp10TerminalCommand("pnpm test", `${TRUSTED_ROOT}/packages/runtime`, TRUSTED_ROOT);
    expect(result.allowed).toBe(true);
  });
});

describe("sanitizeTerminalEnv", () => {
  it("removes env vars with sensitive key names", () => {
    const env = {
      PATH: "/usr/bin",
      HOME: "/home/user",
      MY_SECRET_KEY: "super-secret-value",
      ACCESS_TOKEN: "abc123",
      API_KEY: "xyz789",
      NORMAL_VAR: "hello",
    };
    const result = sanitizeTerminalEnv(env);
    expect(result).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/user",
      NORMAL_VAR: "hello",
    });
    expect(result.MY_SECRET_KEY).toBeUndefined();
    expect(result.ACCESS_TOKEN).toBeUndefined();
    expect(result.API_KEY).toBeUndefined();
  });

  it("removes env vars with sensitive values", () => {
    const env = {
      OPENAI_API_KEY: "sk-abc123def456",
      AUTH_HEADER: "Bearer eyJhbGciOiJIUzI1NiJ9",
      NORMAL: "hello",
    };
    const result = sanitizeTerminalEnv(env);
    expect(result.NORMAL).toBe("hello");
    expect(result.OPENAI_API_KEY).toBeUndefined();
    expect(result.AUTH_HEADER).toBeUndefined();
  });

  it("removes token= pattern values", () => {
    const env = {
      GIT_TOKEN: "token=ghp_abcdef123",
    };
    expect(sanitizeTerminalEnv(env)).toEqual({});
  });

  it("handles empty env", () => {
    expect(sanitizeTerminalEnv({})).toEqual({});
  });
});

describe("detectMutation", () => {
  it("detects mutated files for read_only command", () => {
    const result = detectMutation("git status", ["a.ts", "b.ts"], ["a.ts", "b.ts", "c.ts"]);
    expect(result.mutated).toBe(true);
    expect(result.violation).toBe(true);
    expect(result.changedFiles).toEqual(["c.ts"]);
    expect(result.detail).toContain("Unexpected mutation");
  });

  it("detects no mutation", () => {
    const result = detectMutation("pnpm test", ["a.ts"], ["a.ts"]);
    expect(result.mutated).toBe(false);
    expect(result.violation).toBe(false);
    expect(result.changedFiles).toEqual([]);
  });

  it("allows mutation for medium_write command", () => {
    const result = detectMutation(
      "pnpm --filter @uagent/desktop web:build",
      ["src/a.ts"],
      ["src/a.ts", "dist/bundle.js"],
    );
    expect(result.mutated).toBe(true);
    expect(result.violation).toBe(false);
    expect(result.detail).toBe("Mutation detected as expected");
  });

  it("detects file removal as mutation", () => {
    const result = detectMutation("pnpm lint", ["a.ts", "b.ts"], ["a.ts"]);
    expect(result.mutated).toBe(true);
    expect(result.violation).toBe(true);
  });
});

describe("getDefaultExecutionLimits", () => {
  it("returns default limits", () => {
    const limits = getDefaultExecutionLimits();
    expect(limits.timeoutMs).toBe(60_000);
    expect(limits.maxTimeoutMs).toBe(300_000);
    expect(limits.outputLimitBytes).toBe(1_048_576);
    expect(limits.outputLimitLines).toBe(5_000);
  });
});

describe("MVP10_ALLOWLIST", () => {
  it("has exactly 12 entries", () => {
    expect(MVP10_ALLOWLIST.length).toBe(12);
  });

  it("includes git status", () => {
    expect(MVP10_ALLOWLIST).toContain("git status");
  });

  it("includes pnpm typecheck", () => {
    expect(MVP10_ALLOWLIST).toContain("pnpm typecheck");
  });

  it("includes cargo test", () => {
    expect(MVP10_ALLOWLIST).toContain("cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml");
  });
});
