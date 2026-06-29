import type { CommandAllowlistEntry } from "@uagent/shared";

export interface BuildCommandTemplate {
  id: string;
  label: string;
  command: string;
  allowlistEntry: CommandAllowlistEntry;
  riskLevel: "read_only" | "low_risk" | "medium_write";
  expectedMutation: "none" | "possible" | "certain";
  approvalCopy: string;
  timeoutSecs: number;
  category: "typecheck" | "lint" | "test" | "build" | "git" | "cargo";
}

export const BUILD_TEMPLATES: BuildCommandTemplate[] = [
  {
    id: "typecheck",
    label: "TypeScript type check",
    command: "pnpm typecheck",
    allowlistEntry: "pnpm typecheck",
    riskLevel: "read_only",
    expectedMutation: "none",
    approvalCopy: "Run TypeScript type checking (read-only, no side effects)",
    timeoutSecs: 120,
    category: "typecheck",
  },
  {
    id: "lint",
    label: "ESLint static analysis",
    command: "pnpm lint",
    allowlistEntry: "pnpm lint",
    riskLevel: "read_only",
    expectedMutation: "none",
    approvalCopy: "Run ESLint static analysis (read-only, no side effects)",
    timeoutSecs: 120,
    category: "lint",
  },
  {
    id: "test-full",
    label: "Full test suite",
    command: "pnpm test",
    allowlistEntry: "pnpm test",
    riskLevel: "low_risk",
    expectedMutation: "none",
    approvalCopy: "Run full test suite (read-only fixtures, no network)",
    timeoutSecs: 300,
    category: "test",
  },
  {
    id: "test-shared",
    label: "Shared package tests",
    command: "pnpm --filter @uagent/shared test",
    allowlistEntry: "pnpm --filter @uagent/shared test",
    riskLevel: "low_risk",
    expectedMutation: "none",
    approvalCopy: "Run shared package unit tests",
    timeoutSecs: 120,
    category: "test",
  },
  {
    id: "test-runtime",
    label: "Runtime package tests",
    command: "pnpm --filter @uagent/runtime test",
    allowlistEntry: "pnpm --filter @uagent/runtime test",
    riskLevel: "low_risk",
    expectedMutation: "none",
    approvalCopy: "Run runtime package unit tests",
    timeoutSecs: 120,
    category: "test",
  },
  {
    id: "test-mcp-client",
    label: "MCP client tests",
    command: "pnpm --filter @uagent/mcp-client test",
    allowlistEntry: "pnpm --filter @uagent/mcp-client test",
    riskLevel: "low_risk",
    expectedMutation: "none",
    approvalCopy: "Run MCP client package unit tests",
    timeoutSecs: 120,
    category: "test",
  },
  {
    id: "test-desktop",
    label: "Desktop app tests",
    command: "pnpm --filter @uagent/desktop test",
    allowlistEntry: "pnpm --filter @uagent/desktop test",
    riskLevel: "low_risk",
    expectedMutation: "none",
    approvalCopy: "Run desktop app unit tests",
    timeoutSecs: 120,
    category: "test",
  },
  {
    id: "web-build",
    label: "Desktop web production build",
    command: "pnpm --filter @uagent/desktop web:build",
    allowlistEntry: "pnpm --filter @uagent/desktop web:build",
    riskLevel: "low_risk",
    expectedMutation: "possible",
    approvalCopy: "Build desktop web frontend (Vite production build, generates dist/)",
    timeoutSecs: 180,
    category: "build",
  },
  {
    id: "cargo-test",
    label: "Rust native tests",
    command: "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml",
    allowlistEntry: "cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml",
    riskLevel: "low_risk",
    expectedMutation: "possible",
    approvalCopy: "Run Rust native tests (compiles and tests Tauri commands)",
    timeoutSecs: 300,
    category: "cargo",
  },
  {
    id: "git-status",
    label: "Git status",
    command: "git status",
    allowlistEntry: "git status",
    riskLevel: "read_only",
    expectedMutation: "none",
    approvalCopy: "Check git working tree status (read-only)",
    timeoutSecs: 30,
    category: "git",
  },
  {
    id: "git-diff",
    label: "Git diff",
    command: "git diff",
    allowlistEntry: "git diff",
    riskLevel: "read_only",
    expectedMutation: "none",
    approvalCopy: "Show git diff (read-only, unstaged changes)",
    timeoutSecs: 30,
    category: "git",
  },
  {
    id: "git-diff-check",
    label: "Git diff --check",
    command: "git diff --check",
    allowlistEntry: "git diff --check",
    riskLevel: "read_only",
    expectedMutation: "none",
    approvalCopy: "Check git diff for whitespace errors (read-only)",
    timeoutSecs: 30,
    category: "git",
  },
];

export interface BuildRunRequest {
  templateIds: string[];
  taskId: string | null;
  approvedToken: string;
}

export interface BuildCommandRun {
  template: BuildCommandTemplate;
  status: "pending" | "running" | "passed" | "failed" | "blocked" | "skipped";
  exitCode: number | null;
  durationMs: number;
  outputSummary: string;
}

export interface BuildRun {
  id: string;
  taskId: string | null;
  commands: BuildCommandRun[];
  totalDurationMs: number;
  failedCount: number;
  passedCount: number;
  blockedCount: number;
  createdAt: number;
  completedAt: number | null;
}

let buildRunCounter = 0;

export function nextBuildRunId(): string {
  buildRunCounter++;
  return `build-run-${buildRunCounter}`;
}

export function createBuildRun(taskId: string | null, templateIds: string[]): BuildRun {
  const templates = templateIds
    .map((id) => BUILD_TEMPLATES.find((t) => t.id === id))
    .filter((t): t is BuildCommandTemplate => t !== undefined);

  return {
    id: nextBuildRunId(),
    taskId,
    commands: templates.map((t) => ({
      template: t,
      status: "pending",
      exitCode: null,
      durationMs: 0,
      outputSummary: "",
    })),
    totalDurationMs: 0,
    failedCount: 0,
    passedCount: 0,
    blockedCount: 0,
    createdAt: Date.now(),
    completedAt: null,
  };
}

export function findBuildTemplate(command: string): BuildCommandTemplate | undefined {
  return BUILD_TEMPLATES.find((t) => t.command === command);
}

export function getBuildTemplatesByCategory(category: string): BuildCommandTemplate[] {
  return BUILD_TEMPLATES.filter((t) => t.category === category);
}

export function getAcceptanceChecklistTemplates(): BuildCommandTemplate[] {
  return BUILD_TEMPLATES;
}
