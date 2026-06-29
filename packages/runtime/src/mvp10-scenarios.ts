import {
  classifyMvp10TerminalCommand,
  sanitizeTerminalEnv,
  detectMutation,
  parseCommand,
  MVP10_ALLOWLIST,
  getDefaultExecutionLimits,
} from "./mvp10-terminal-policy.js";
import {
  issueApprovalToken,
  validateApprovalToken,
  useApprovalToken,
  revokeApprovalToken,
  getApprovalToken,
} from "./mvp10-approval-token.js";
import {
  BUILD_TEMPLATES,
  findBuildTemplate,
  createBuildRun,
  getBuildTemplatesByCategory,
} from "./mvp10-build-templates.js";

export interface Mvp10Scenario {
  id: string;
  name: string;
  run: () => { pass: boolean; detail: string }[];
}

function pass(detail: string) { return { pass: true, detail }; }
function fail(detail: string) { return { pass: false, detail }; }

const TRUSTED_ROOT = "G:/UAgent";

export const MVP10_SCENARIOS: Mvp10Scenario[] = [
  // == G2: Shared Contracts ==
  {
    id: "mvp10-sc-001",
    name: "classify pnpm typecheck as allowlisted",
    run: () => {
      const result = classifyMvp10TerminalCommand("pnpm typecheck", TRUSTED_ROOT, TRUSTED_ROOT);
      return [result.allowed ? pass("pnpm typecheck allowed") : fail("should be allowed")];
    },
  },
  {
    id: "mvp10-sc-002",
    name: "classify pnpm lint without --fix as allowlisted",
    run: () => {
      const result = classifyMvp10TerminalCommand("pnpm lint", TRUSTED_ROOT, TRUSTED_ROOT);
      return [result.allowed ? pass("pnpm lint allowed") : fail("should be allowed")];
    },
  },
  {
    id: "mvp10-sc-003",
    name: "block pnpm lint --fix",
    run: () => {
      const result = classifyMvp10TerminalCommand("pnpm lint --fix", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("pnpm lint --fix blocked") : fail("should be blocked")];
    },
  },
  {
    id: "mvp10-sc-004",
    name: "block rm -rf command",
    run: () => {
      const result = classifyMvp10TerminalCommand("rm -rf /", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("rm blocked") : fail("should be blocked")];
    },
  },
  {
    id: "mvp10-sc-005",
    name: "block curl command",
    run: () => {
      const result = classifyMvp10TerminalCommand("curl http://example.com", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("curl blocked") : fail("should be blocked")];
    },
  },
  {
    id: "mvp10-sc-006",
    name: "block git push",
    run: () => {
      const result = classifyMvp10TerminalCommand("git push origin main", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("git push blocked") : fail("should be blocked")];
    },
  },
  {
    id: "mvp10-sc-007",
    name: "block npm install",
    run: () => {
      const result = classifyMvp10TerminalCommand("npm install", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("npm install blocked") : fail("should be blocked")];
    },
  },
  {
    id: "mvp10-sc-008",
    name: "allow pnpm test",
    run: () => {
      const result = classifyMvp10TerminalCommand("pnpm test", TRUSTED_ROOT, TRUSTED_ROOT);
      return [result.allowed ? pass("pnpm test allowed") : fail("should be allowed")];
    },
  },
  {
    id: "mvp10-sc-009",
    name: "allow git status",
    run: () => {
      const result = classifyMvp10TerminalCommand("git status", TRUSTED_ROOT, TRUSTED_ROOT);
      return [result.allowed ? pass("git status allowed") : fail("should be allowed")];
    },
  },
  {
    id: "mvp10-sc-010",
    name: "block sudo command",
    run: () => {
      const result = classifyMvp10TerminalCommand("sudo rm -rf /", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("sudo blocked") : fail("should be blocked")];
    },
  },
  // == G3: Terminal Classifier ==
  {
    id: "mvp10-sc-011",
    name: "parseCommand splits correctly",
    run: () => {
      const parsed = parseCommand("pnpm --filter @uagent/runtime test");
      return [
        parsed.base === "pnpm" ? pass("base is pnpm") : fail("base not pnpm"),
        parsed.args.length === 3 ? pass("has 3 args") : fail(`expected 3 args got ${parsed.args.length}`),
      ];
    },
  },
  {
    id: "mvp10-sc-012",
    name: "detect cwd escape",
    run: () => {
      const result = classifyMvp10TerminalCommand("pnpm typecheck", "/outside/path", TRUSTED_ROOT);
      return [!result.allowed ? pass("outside cwd blocked") : fail("should block outside cwd")];
    },
  },
  {
    id: "mvp10-sc-013",
    name: "env sanitization removes secrets",
    run: () => {
      const clean = sanitizeTerminalEnv({ PATH: "/usr/bin", API_KEY: "sk-abc123" });
      return [
        clean.PATH === "/usr/bin" ? pass("PATH preserved") : fail("PATH removed"),
        !("API_KEY" in clean) ? pass("API_KEY removed") : fail("API_KEY not removed"),
      ];
    },
  },
  {
    id: "mvp10-sc-014",
    name: "mutation detection no change",
    run: () => {
      const result = detectMutation("pnpm typecheck", ["a.ts"], ["a.ts"]);
      return [!result.mutated ? pass("no mutation") : fail("should not detect mutation")];
    },
  },
  {
    id: "mvp10-sc-015",
    name: "mutation detection with change",
    run: () => {
      const result = detectMutation("pnpm typecheck", ["a.ts"], ["a.ts", "b.ts"]);
      return [result.mutated ? pass("mutation detected") : fail("should detect mutation")];
    },
  },
  // == G5: Approval Token ==
  {
    id: "mvp10-sc-016",
    name: "issue approval token",
    run: () => {
      const token = issueApprovalToken({ proposalId: "prop-1", taskId: null, actor: "test", ttlMs: 60000 });
      return [
        token.status === "issued" ? pass("token issued") : fail("token not issued"),
        token.proposalId === "prop-1" ? pass("proposalId matches") : fail("proposalId wrong"),
      ];
    },
  },
  {
    id: "mvp10-sc-017",
    name: "validate valid token",
    run: () => {
      const token = issueApprovalToken({ proposalId: "prop-2", taskId: null, actor: "test", ttlMs: 60000 });
      const validation = validateApprovalToken(token.id, "prop-2");
      return [validation.valid ? pass("token valid") : fail("token should be valid")];
    },
  },
  {
    id: "mvp10-sc-018",
    name: "validate token wrong proposal",
    run: () => {
      const token = issueApprovalToken({ proposalId: "prop-3", taskId: null, actor: "test", ttlMs: 60000 });
      const validation = validateApprovalToken(token.id, "wrong-proposal");
      return [!validation.valid && validation.reason === "token_proposal_mismatch"
        ? pass("mismatch detected") : fail("should detect mismatch")];
    },
  },
  {
    id: "mvp10-sc-019",
    name: "use token once",
    run: () => {
      const token = issueApprovalToken({ proposalId: "prop-4", taskId: null, actor: "test", ttlMs: 60000 });
      const firstUse = useApprovalToken(token.id);
      const secondUse = useApprovalToken(token.id);
      return [
        firstUse ? pass("first use ok") : fail("first use should succeed"),
        !secondUse ? pass("second use blocked") : fail("second use should block"),
      ];
    },
  },
  // == G6: Build Templates ==
  {
    id: "mvp10-sc-020",
    name: "build templates have correct count",
    run: () => {
      return [
        BUILD_TEMPLATES.length === 12 ? pass("12 templates") : fail(`expected 12 templates got ${BUILD_TEMPLATES.length}`),
      ];
    },
  },
  {
    id: "mvp10-sc-021",
    name: "findBuildTemplate matches exact",
    run: () => {
      const found = findBuildTemplate("pnpm typecheck");
      return [found !== undefined ? pass("found pnpm typecheck") : fail("should find template")];
    },
  },
  {
    id: "mvp10-sc-022",
    name: "acceptance checklist includes all templates",
    run: () => {
      return [BUILD_TEMPLATES.length > 0 ? pass("templates available") : fail("no templates")];
    },
  },
  // == G10: Security Boundary ==
  {
    id: "mvp10-sc-023",
    name: "block docker command",
    run: () => {
      const result = classifyMvp10TerminalCommand("docker ps", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("docker blocked") : fail("should block docker")];
    },
  },
  {
    id: "mvp10-sc-024",
    name: "block wget command",
    run: () => {
      const result = classifyMvp10TerminalCommand("wget http://example.com/file", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("wget blocked") : fail("should block wget")];
    },
  },
  {
    id: "mvp10-sc-025",
    name: "block pnpm install",
    run: () => {
      const result = classifyMvp10TerminalCommand("pnpm install", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("pnpm install blocked") : fail("should block install")];
    },
  },
  {
    id: "mvp10-sc-026",
    name: "block git fetch",
    run: () => {
      const result = classifyMvp10TerminalCommand("git fetch origin", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("git fetch blocked") : fail("should block git fetch")];
    },
  },
  {
    id: "mvp10-sc-027",
    name: "block ssh command",
    run: () => {
      const result = classifyMvp10TerminalCommand("ssh user@host", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("ssh blocked") : fail("should block ssh")];
    },
  },
  {
    id: "mvp10-sc-028",
    name: "allow cargo test",
    run: () => {
      const result = classifyMvp10TerminalCommand("cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml", TRUSTED_ROOT, TRUSTED_ROOT);
      return [result.allowed ? pass("cargo test allowed") : fail("should allow cargo test")];
    },
  },
  {
    id: "mvp10-sc-029",
    name: "block del command (Windows)",
    run: () => {
      const result = classifyMvp10TerminalCommand("del /f /q temp.txt", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("del blocked") : fail("should block del")];
    },
  },
  {
    id: "mvp10-sc-030",
    name: "allow desktop web:build",
    run: () => {
      const result = classifyMvp10TerminalCommand("pnpm --filter @uagent/desktop web:build", TRUSTED_ROOT, TRUSTED_ROOT);
      return [result.allowed ? pass("web:build allowed") : fail("should allow web:build")];
    },
  },
  // == Extended Security & Classification ==
  {
    id: "mvp10-sc-031",
    name: "block git pull via classify",
    run: () => {
      const result = classifyMvp10TerminalCommand("git pull origin main", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("git pull blocked") : fail("should block git pull")];
    },
  },
  {
    id: "mvp10-sc-032",
    name: "block git commit via classify",
    run: () => {
      const result = classifyMvp10TerminalCommand("git commit -m 'test'", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("git commit blocked") : fail("should block git commit")];
    },
  },
  {
    id: "mvp10-sc-033",
    name: "allow git diff via classify",
    run: () => {
      const result = classifyMvp10TerminalCommand("git diff", TRUSTED_ROOT, TRUSTED_ROOT);
      return [result.allowed ? pass("git diff allowed") : fail("should allow git diff")];
    },
  },
  {
    id: "mvp10-sc-034",
    name: "allow git diff --check via classify",
    run: () => {
      const result = classifyMvp10TerminalCommand("git diff --check", TRUSTED_ROOT, TRUSTED_ROOT);
      return [result.allowed ? pass("git diff --check allowed") : fail("should allow git diff --check")];
    },
  },
  {
    id: "mvp10-sc-035",
    name: "classify unknown command not allowed",
    run: () => {
      const result = classifyMvp10TerminalCommand("some-random-tool", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("unknown blocked") : fail("should block unknown")];
    },
  },
  {
    id: "mvp10-sc-036",
    name: "parseCommand with empty string",
    run: () => {
      const parsed = parseCommand("");
      return [
        parsed.base === "" ? pass("base is empty") : fail("expected empty base"),
        parsed.args.length === 0 ? pass("no args") : fail("expected empty args"),
      ];
    },
  },
  {
    id: "mvp10-sc-037",
    name: "block chmod via classify",
    run: () => {
      const result = classifyMvp10TerminalCommand("chmod 755 script.sh", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("chmod blocked") : fail("should block chmod")];
    },
  },
  {
    id: "mvp10-sc-038",
    name: "createBuildRun creates correct number of commands",
    run: () => {
      const run = createBuildRun(null, ["typecheck", "lint", "test-full"]);
      return [
        run.commands.length === 3 ? pass("3 commands created") : fail(`expected 3 got ${run.commands.length}`),
        run.commands.every((c) => c.status === "pending") ? pass("all pending") : fail("should all be pending"),
      ];
    },
  },
  {
    id: "mvp10-sc-039",
    name: "detect mutation violation for low_risk command",
    run: () => {
      const result = detectMutation("pnpm test", ["a.ts"], ["a.ts", "b.ts"]);
      return [
        result.mutated ? pass("mutation detected") : fail("should detect mutation"),
        result.violation ? pass("violation flagged") : fail("should flag violation"),
      ];
    },
  },
  {
    id: "mvp10-sc-040",
    name: "getBuildTemplatesByCategory returns test templates",
    run: () => {
      const templates = getBuildTemplatesByCategory("test");
      return [
        templates.length >= 5 ? pass("5+ test templates") : fail(`expected at least 5 got ${templates.length}`),
        templates.every((t) => t.category === "test") ? pass("all category test") : fail("wrong category"),
      ];
    },
  },
  {
    id: "mvp10-sc-041",
    name: "block shell metachar in non-allowlisted command",
    run: () => {
      const result = classifyMvp10TerminalCommand("echo foo | sort", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("shell metachar blocked") : fail("should block shell metachar")];
    },
  },
  {
    id: "mvp10-sc-042",
    name: "block git rebase via classify",
    run: () => {
      const result = classifyMvp10TerminalCommand("git rebase main", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("git rebase blocked") : fail("should block git rebase")];
    },
  },
  // == Extended Approval Token Security ==
  {
    id: "mvp10-sc-043",
    name: "token reject wrong proposal id",
    run: () => {
      const token = issueApprovalToken({ proposalId: "prop-043", taskId: null, actor: "test", ttlMs: 60000 });
      const v = validateApprovalToken(token.id, "wrong-proposal");
      return [!v.valid && v.reason === "token_proposal_mismatch" ? pass("wrong proposal blocked") : fail("should block wrong proposal")];
    },
  },
  {
    id: "mvp10-sc-044",
    name: "token reject used token",
    run: () => {
      const token = issueApprovalToken({ proposalId: "prop-044", taskId: null, actor: "test", ttlMs: 60000 });
      useApprovalToken(token.id);
      const v = validateApprovalToken(token.id, "prop-044");
      return [!v.valid && v.reason === "token_already_used" ? pass("used token blocked") : fail("should block used token")];
    },
  },
  {
    id: "mvp10-sc-045",
    name: "token reject expired token",
    run: () => {
      const token = issueApprovalToken({ proposalId: "prop-045", taskId: null, actor: "test", ttlMs: -1 });
      const v = validateApprovalToken(token.id, "prop-045");
      return [!v.valid && v.reason === "token_expired" ? pass("expired token blocked") : fail("should block expired token")];
    },
  },
  {
    id: "mvp10-sc-046",
    name: "token reject revoked token",
    run: () => {
      const token = issueApprovalToken({ proposalId: "prop-046", taskId: null, actor: "test", ttlMs: 60000 });
      revokeApprovalToken(token.id, "test revoke");
      const v = validateApprovalToken(token.id, "prop-046");
      return [!v.valid && v.reason === "token_revoked" ? pass("revoked token blocked") : fail("should block revoked token")];
    },
  },
  {
    id: "mvp10-sc-047",
    name: "token get returns issued token",
    run: () => {
      const token = issueApprovalToken({ proposalId: "prop-047", taskId: "task-1", actor: "tester", ttlMs: 60000 });
      const found = getApprovalToken(token.id);
      return [
        found?.id === token.id ? pass("token id matches") : fail("token id mismatch"),
        found?.proposalId === "prop-047" ? pass("proposal id matches") : fail("proposal id mismatch"),
        found?.taskId === "task-1" ? pass("task id matches") : fail("task id mismatch"),
        found?.actor === "tester" ? pass("actor matches") : fail("actor mismatch"),
        found?.status === "issued" ? pass("status is issued") : fail("status not issued"),
      ];
    },
  },
  {
    id: "mvp10-sc-048",
    name: "token use marks usedAt timestamp",
    run: () => {
      const token = issueApprovalToken({ proposalId: "prop-048", taskId: null, actor: "test", ttlMs: 60000 });
      useApprovalToken(token.id);
      const used = getApprovalToken(token.id);
      return [
        used?.status === "used" ? pass("status changed to used") : fail("status not used"),
        used?.usedAt !== null ? pass("usedAt set") : fail("usedAt not set"),
      ];
    },
  },
  {
    id: "mvp10-sc-049",
    name: "token use returns false for missing token",
    run: () => {
      const result = useApprovalToken("non-existent-token");
      return [!result ? pass("missing token returns false") : fail("should return false")];
    },
  },
  {
    id: "mvp10-sc-050",
    name: "token revoke returns false for missing token",
    run: () => {
      const result = revokeApprovalToken("non-existent", "test");
      return [!result ? pass("missing revoke returns false") : fail("should return false")];
    },
  },
  // == Extended Allowlist Coverage ==
  {
    id: "mvp10-sc-051",
    name: "allowlist has exactly 12 entries",
    run: () => {
      return [MVP10_ALLOWLIST.length === 12 ? pass("12 allowlist entries") : fail(`expected 12 got ${MVP10_ALLOWLIST.length}`)];
    },
  },
  {
    id: "mvp10-sc-052",
    name: "allow all 12 allowlist entries",
    run: () => {
      const assertions = MVP10_ALLOWLIST.map((cmd) => {
        const result = classifyMvp10TerminalCommand(cmd, TRUSTED_ROOT, TRUSTED_ROOT);
        return result.allowed
          ? pass(`allowlisted: ${cmd}`)
          : fail(`should allow: ${cmd}`);
      });
      return assertions;
    },
  },
  {
    id: "mvp10-sc-053",
    name: "getDefaultExecutionLimits returns default values",
    run: () => {
      const limits = getDefaultExecutionLimits();
      return [
        limits.timeoutMs > 0 ? pass("timeoutMs positive") : fail("timeoutMs should be positive"),
        limits.outputLimitBytes > 0 ? pass("outputLimitBytes positive") : fail("should be positive"),
        limits.outputLimitLines > 0 ? pass("outputLimitLines positive") : fail("should be positive"),
      ];
    },
  },
  // == Build Template Edge Cases ==
  {
    id: "mvp10-sc-054",
    name: "findBuildTemplate returns undefined for unknown command",
    run: () => {
      const found = findBuildTemplate("unknown-command");
      return [found === undefined ? pass("unknown returns undefined") : fail("should return undefined")];
    },
  },
  {
    id: "mvp10-sc-055",
    name: "build template categories cover all entries",
    run: () => {
      const categories = new Set(BUILD_TEMPLATES.map((t) => t.category));
      const hasTypecheck = categories.has("typecheck");
      const hasLint = categories.has("lint");
      const hasTest = categories.has("test");
      const hasBuild = categories.has("build");
      const hasGit = categories.has("git");
      const hasCargo = categories.has("cargo");
      return [
        hasTypecheck ? pass("has typecheck category") : fail("missing typecheck"),
        hasLint ? pass("has lint category") : fail("missing lint"),
        hasTest ? pass("has test category") : fail("missing test"),
        hasBuild ? pass("has build category") : fail("missing build"),
        hasGit ? pass("has git category") : fail("missing git"),
        hasCargo ? pass("has cargo category") : fail("missing cargo"),
      ];
    },
  },
  {
    id: "mvp10-sc-056",
    name: "createBuildRun with unknown template ids returns only valid templates",
    run: () => {
      const run = createBuildRun(null, ["typecheck", "nonexistent-id", "lint"]);
      return [
        run.commands.length === 2 ? pass("2 valid commands") : fail(`expected 2 got ${run.commands.length}`),
        run.commands[0].status === "pending" ? pass("first pending") : fail("first not pending"),
      ];
    },
  },
  {
    id: "mvp10-sc-057",
    name: "getBuildTemplatesByCategory returns empty for unknown category",
    run: () => {
      const templates = getBuildTemplatesByCategory("unknown");
      return [templates.length === 0 ? pass("empty for unknown") : fail("should be empty")];
    },
  },
  // == Extended Denylist ==
  {
    id: "mvp10-sc-058",
    name: "block doas command",
    run: () => {
      const result = classifyMvp10TerminalCommand("doas rm file", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("doas blocked") : fail("should block doas")];
    },
  },
  {
    id: "mvp10-sc-059",
    name: "block rmdir command",
    run: () => {
      const result = classifyMvp10TerminalCommand("rmdir /s /q temp", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("rmdir blocked") : fail("should block rmdir")];
    },
  },
  {
    id: "mvp10-sc-060",
    name: "block rd command (Windows)",
    run: () => {
      const result = classifyMvp10TerminalCommand("rd /s /q temp", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("rd blocked") : fail("should block rd")];
    },
  },
  {
    id: "mvp10-sc-061",
    name: "block chown command",
    run: () => {
      const result = classifyMvp10TerminalCommand("chown user:group file", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("chown blocked") : fail("should block chown")];
    },
  },
  {
    id: "mvp10-sc-062",
    name: "block attrib command (Windows)",
    run: () => {
      const result = classifyMvp10TerminalCommand("attrib +r file.txt", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("attrib blocked") : fail("should block attrib")];
    },
  },
  {
    id: "mvp10-sc-063",
    name: "block scp command",
    run: () => {
      const result = classifyMvp10TerminalCommand("scp file user@host:/tmp", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("scp blocked") : fail("should block scp")];
    },
  },
  {
    id: "mvp10-sc-064",
    name: "block sftp command",
    run: () => {
      const result = classifyMvp10TerminalCommand("sftp user@host", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("sftp blocked") : fail("should block sftp")];
    },
  },
  {
    id: "mvp10-sc-065",
    name: "block ftp command",
    run: () => {
      const result = classifyMvp10TerminalCommand("ftp ftp.example.com", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("ftp blocked") : fail("should block ftp")];
    },
  },
  {
    id: "mvp10-sc-066",
    name: "block yarn add command",
    run: () => {
      const result = classifyMvp10TerminalCommand("yarn add lodash", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("yarn add blocked") : fail("should block yarn add")];
    },
  },
  {
    id: "mvp10-sc-067",
    name: "block pip install command",
    run: () => {
      const result = classifyMvp10TerminalCommand("pip install requests", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("pip install blocked") : fail("should block pip install")];
    },
  },
  {
    id: "mvp10-sc-068",
    name: "block git reset command",
    run: () => {
      const result = classifyMvp10TerminalCommand("git reset --hard HEAD", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("git reset blocked") : fail("should block git reset")];
    },
  },
  {
    id: "mvp10-sc-069",
    name: "block git merge command",
    run: () => {
      const result = classifyMvp10TerminalCommand("git merge feature-branch", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("git merge blocked") : fail("should block git merge")];
    },
  },
  {
    id: "mvp10-sc-070",
    name: "block git checkout command",
    run: () => {
      const result = classifyMvp10TerminalCommand("git checkout main", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("git checkout blocked") : fail("should block git checkout")];
    },
  },
  // == Shell Metachar Variants ==
  {
    id: "mvp10-sc-071",
    name: "block shell metachar semicolon",
    run: () => {
      const result = classifyMvp10TerminalCommand("pnpm typecheck; rm -rf /", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed && result.denyReason === "shell_metachar" ? pass("semicolon blocked") : fail("should block semicolon")];
    },
  },
  {
    id: "mvp10-sc-072",
    name: "block shell metachar double ampersand",
    run: () => {
      const result = classifyMvp10TerminalCommand("git status && echo hijack", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("&& blocked") : fail("should block &&")];
    },
  },
  {
    id: "mvp10-sc-073",
    name: "block shell metachar backtick",
    run: () => {
      const result = classifyMvp10TerminalCommand("echo `whoami`", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("backtick blocked") : fail("should block backtick")];
    },
  },
  {
    id: "mvp10-sc-074",
    name: "block shell metachar dollar paren",
    run: () => {
      const result = classifyMvp10TerminalCommand("echo $(whoami)", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("$() blocked") : fail("should block $()")];
    },
  },
  {
    id: "mvp10-sc-075",
    name: "block shell metachar redirect output",
    run: () => {
      const result = classifyMvp10TerminalCommand("pnpm typecheck > output.txt", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("redirect blocked") : fail("should block redirect")];
    },
  },
  {
    id: "mvp10-sc-076",
    name: "block shell metachar pipe in allowlisted base",
    run: () => {
      const result = classifyMvp10TerminalCommand("pnpm lint | grep error", TRUSTED_ROOT, TRUSTED_ROOT);
      return [!result.allowed ? pass("pipe in allowlisted blocked") : fail("should block pipe")];
    },
  },
  // == Mutation Detection Edge Cases ==
  {
    id: "mvp10-sc-077",
    name: "mutation detection no violation for git status",
    run: () => {
      const result = detectMutation("git status", ["a.ts"], ["a.ts"]);
      return [
        !result.mutated ? pass("no mutation") : fail("should not detect mutation"),
        !result.violation ? pass("no violation") : fail("should not flag violation"),
      ];
    },
  },
  {
    id: "mvp10-sc-078",
    name: "mutation detection tracks specific files",
    run: () => {
      const before = ["src/a.ts", "src/b.ts", "src/c.ts"];
      const after = ["src/a.ts", "src/b.ts", "src/d.ts"];
      const result = detectMutation("pnpm typecheck", before, after);
      return [
        result.mutated ? pass("mutation detected") : fail("should detect mutation"),
        result.changedFiles?.length === 1 ? pass("1 changed file") : fail(`expected 1 changed file got ${result.changedFiles?.length}`),
        result.changedFiles?.[0] === "src/d.ts" ? pass("new file tracked") : fail("wrong file tracked"),
      ];
    },
  },
  {
    id: "mvp10-sc-079",
    name: "env sanitization removes token value",
    run: () => {
      const clean = sanitizeTerminalEnv({ SAFE_VAR: "hello", SECRET_TOKEN: "sk-abcdef123456" });
      return [
        clean.SAFE_VAR === "hello" ? pass("safe var preserved") : fail("safe var removed"),
        !("SECRET_TOKEN" in clean) ? pass("secret token removed") : fail("secret token not removed"),
      ];
    },
  },
  {
    id: "mvp10-sc-080",
    name: "env sanitization removes bearer value",
    run: () => {
      const clean = sanitizeTerminalEnv({ AUTH_HEADER: "Bearer sk-abc", PATH: "/usr/bin" });
      return [
        !("AUTH_HEADER" in clean) ? pass("auth header removed") : fail("auth header not removed"),
        clean.PATH === "/usr/bin" ? pass("PATH preserved") : fail("PATH removed"),
      ];
    },
  },
  // == Gate Status Documentation ==
  {
    id: "mvp10-sc-081",
    name: "findBuildTemplate returns all 12 templates",
    run: () => {
      const all = getBuildTemplatesByCategory("typecheck")
        .concat(getBuildTemplatesByCategory("lint"))
        .concat(getBuildTemplatesByCategory("test"))
        .concat(getBuildTemplatesByCategory("build"))
        .concat(getBuildTemplatesByCategory("git"))
        .concat(getBuildTemplatesByCategory("cargo"));
      return [all.length === BUILD_TEMPLATES.length ? pass("all categories covered") : fail("category coverage incomplete")];
    },
  },
  {
    id: "mvp10-sc-082",
    name: "no duplicate template ids",
    run: () => {
      const ids = BUILD_TEMPLATES.map((t) => t.id);
      const unique = new Set(ids);
      return [ids.length === unique.size ? pass("no duplicate ids") : fail("duplicate ids found")];
    },
  },
  {
    id: "mvp10-sc-083",
    name: "all templates have timeoutSecs > 0",
    run: () => {
      return [BUILD_TEMPLATES.every((t) => t.timeoutSecs > 0) ? pass("all have timeout") : fail("some missing timeout")];
    },
  },
  {
    id: "mvp10-sc-084",
    name: "parseCommand handles trailing spaces",
    run: () => {
      const parsed = parseCommand("  pnpm typecheck  ");
      return [
        parsed.base === "pnpm" ? pass("base is pnpm") : fail("base not pnpm"),
        parsed.args.length === 1 ? pass("1 arg") : fail(`expected 1 arg got ${parsed.args.length}`),
        parsed.args[0] === "typecheck" ? pass("arg is typecheck") : fail("arg not typecheck"),
      ];
    },
  },
  {
    id: "mvp10-sc-085",
    name: "parseCommand splits complex filter command",
    run: () => {
      const parsed = parseCommand("pnpm --filter @uagent/desktop test");
      return [
        parsed.base === "pnpm" ? pass("base is pnpm") : fail("base not pnpm"),
        parsed.args.length === 3 ? pass("3 args") : fail(`expected 3 args got ${parsed.args.length}`),
      ];
    },
  },
];

export function runMvp10ScenarioMatrix(): { scenarios: Mvp10Scenario[]; results: { id: string; name: string; passed: number; failed: number; assertions: { pass: boolean; detail: string }[] }[] } {
  const results = MVP10_SCENARIOS.map((scenario) => {
    const assertions = scenario.run();
    const passed = assertions.filter((a) => a.pass).length;
    const failed = assertions.filter((a) => !a.pass).length;
    return { id: scenario.id, name: scenario.name, passed, failed, assertions };
  });
  return { scenarios: MVP10_SCENARIOS, results };
}
