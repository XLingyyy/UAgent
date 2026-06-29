import { describe, it, expect } from "vitest";
import {
  BUILD_TEMPLATES,
  findBuildTemplate,
  getBuildTemplatesByCategory,
  getAcceptanceChecklistTemplates,
  createBuildRun,
  nextBuildRunId,
} from "./mvp10-build-templates.js";

describe("BUILD_TEMPLATES", () => {
  it("has exactly 12 templates", () => {
    expect(BUILD_TEMPLATES).toHaveLength(12);
  });

  it("all templates have unique ids", () => {
    const ids = BUILD_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all templates have required fields", () => {
    for (const t of BUILD_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.label).toBeTruthy();
      expect(t.command).toBeTruthy();
      expect(t.allowlistEntry).toBeTruthy();
      expect(["read_only", "low_risk", "medium_write"]).toContain(t.riskLevel);
      expect(["none", "possible", "certain"]).toContain(t.expectedMutation);
      expect(t.approvalCopy).toBeTruthy();
      expect(t.timeoutSecs).toBeGreaterThan(0);
      expect(["typecheck", "lint", "test", "build", "git", "cargo"]).toContain(t.category);
    }
  });

  it("has correct category distribution", () => {
    const typecheck = BUILD_TEMPLATES.filter((t) => t.category === "typecheck");
    const lint = BUILD_TEMPLATES.filter((t) => t.category === "lint");
    const test = BUILD_TEMPLATES.filter((t) => t.category === "test");
    const build = BUILD_TEMPLATES.filter((t) => t.category === "build");
    const git = BUILD_TEMPLATES.filter((t) => t.category === "git");
    const cargo = BUILD_TEMPLATES.filter((t) => t.category === "cargo");

    expect(typecheck).toHaveLength(1);
    expect(lint).toHaveLength(1);
    expect(test).toHaveLength(5);
    expect(build).toHaveLength(1);
    expect(git).toHaveLength(3);
    expect(cargo).toHaveLength(1);
  });
});

describe("findBuildTemplate", () => {
  it("finds template by exact command match", () => {
    const t = findBuildTemplate("pnpm typecheck");
    expect(t).toBeDefined();
    expect(t!.id).toBe("typecheck");
  });

  it("returns undefined for unknown command", () => {
    expect(findBuildTemplate("rm -rf /")).toBeUndefined();
  });

  it("returns undefined for partial match", () => {
    expect(findBuildTemplate("pnpm")).toBeUndefined();
  });

  it("finds all templates by their command", () => {
    for (const template of BUILD_TEMPLATES) {
      expect(findBuildTemplate(template.command)!.id).toBe(template.id);
    }
  });
});

describe("getBuildTemplatesByCategory", () => {
  it("returns correct templates for 'test' category", () => {
    const tests = getBuildTemplatesByCategory("test");
    expect(tests).toHaveLength(5);
    expect(tests.every((t) => t.category === "test")).toBe(true);
  });

  it("returns correct templates for 'git' category", () => {
    const git = getBuildTemplatesByCategory("git");
    expect(git).toHaveLength(3);
    expect(git.every((t) => t.category === "git")).toBe(true);
  });

  it("returns empty array for unknown category", () => {
    expect(getBuildTemplatesByCategory("unknown")).toHaveLength(0);
  });
});

describe("getAcceptanceChecklistTemplates", () => {
  it("returns all templates", () => {
    expect(getAcceptanceChecklistTemplates()).toHaveLength(12);
    expect(getAcceptanceChecklistTemplates()).toBe(BUILD_TEMPLATES);
  });
});

describe("createBuildRun", () => {
  it("creates a BuildRun with all commands in pending state", () => {
    const run = createBuildRun("task-1", ["typecheck", "lint", "test-shared"]);
    expect(run.taskId).toBe("task-1");
    expect(run.commands).toHaveLength(3);
    expect(run.failedCount).toBe(0);
    expect(run.passedCount).toBe(0);
    expect(run.blockedCount).toBe(0);
    expect(run.completedAt).toBeNull();
    expect(run.createdAt).toBeGreaterThan(0);

    for (const cmd of run.commands) {
      expect(cmd.status).toBe("pending");
      expect(cmd.exitCode).toBeNull();
      expect(cmd.durationMs).toBe(0);
      expect(cmd.outputSummary).toBe("");
    }
  });

  it("filters out unknown template ids", () => {
    const run = createBuildRun(null, ["typecheck", "nonexistent", "lint"]);
    expect(run.commands).toHaveLength(2);
    expect(run.commands[0].template.id).toBe("typecheck");
    expect(run.commands[1].template.id).toBe("lint");
  });

  it("produces unique run ids", () => {
    const run1 = createBuildRun(null, ["typecheck"]);
    const run2 = createBuildRun(null, ["typecheck"]);
    expect(run1.id).not.toBe(run2.id);
  });

  it("assigns correct template references", () => {
    const run = createBuildRun(null, ["typecheck", "git-status"]);
    expect(run.commands[0].template.id).toBe("typecheck");
    expect(run.commands[1].template.id).toBe("git-status");
  });

  it("creates run with empty taskId", () => {
    const run = createBuildRun(null, []);
    expect(run.taskId).toBeNull();
    expect(run.commands).toHaveLength(0);
  });
});

describe("nextBuildRunId", () => {
  it("produces incrementing run ids", () => {
    const id1 = nextBuildRunId();
    const id2 = nextBuildRunId();
    expect(id1).toMatch(/^build-run-\d+$/);
    expect(id2).toMatch(/^build-run-\d+$/);
    expect(id1).not.toBe(id2);
  });
});
