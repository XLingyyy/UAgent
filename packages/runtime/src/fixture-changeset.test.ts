import { describe, expect, it } from "vitest";
import type { ChangeOperation, ChangeSetScope, WorkspaceChangeSet } from "@uagent/shared";
import { type ToolRiskLevel } from "@uagent/shared";
import { createFixtureChangeSetAdapter } from "./fixture-changeset.js";

const baseScope: ChangeSetScope = {
  assets: [],
  files: ["src/index.ts"],
  commands: [],
  riskLevel: "low_risk" as ToolRiskLevel,
  sandboxResultRef: null,
};

const baseOperations: ChangeOperation[] = [
  { id: "op-1", type: "update", target: "src/index.ts", description: "Update index", oldValue: null, newValue: "new content", riskLevel: "low_risk" as ToolRiskLevel },
  { id: "op-2", type: "create", target: "src/new.ts", description: "Create new file", oldValue: null, newValue: "file content", riskLevel: "low_risk" as ToolRiskLevel },
];

function makeChangeSet(overrides?: Partial<WorkspaceChangeSet>): WorkspaceChangeSet {
  const now = Date.now();
  return {
    id: "cs-test-1",
    taskId: "task-1",
    state: "planned",
    scope: baseScope,
    operations: baseOperations,
    diffSummary: "",
    evidenceRefs: [],
    rollbackRef: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("FixtureChangeSetAdapter", () => {
  const adapter = createFixtureChangeSetAdapter();

  describe("preview", () => {
    it("returns diffSummary from operations", () => {
      const cs = makeChangeSet();
      const result = adapter.preview(cs);
      expect(result.success).toBe(true);
      expect(result.changeSet.diffSummary).toContain("[2 operation(s)]");
      expect(result.changeSet.diffSummary).toContain("update: src/index.ts - Update index");
    });

    it("transitions to previewed state", () => {
      const cs = makeChangeSet();
      const result = adapter.preview(cs);
      expect(result.changeSet.state).toBe("previewed");
    });

    it("fails if not in planned state", () => {
      const cs = makeChangeSet({ state: "applied" });
      const result = adapter.preview(cs);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot preview");
    });
  });

  describe("promote", () => {
    it("succeeds from applied state", () => {
      const cs = makeChangeSet({ state: "applied" });
      const result = adapter.promote(cs);
      expect(result.success).toBe(true);
      expect(result.changeSet.state).toBe("promoted");
    });

    it("fails from planned state", () => {
      const cs = makeChangeSet({ state: "planned" });
      const result = adapter.promote(cs);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot promote");
    });

    it("fails from previewed state", () => {
      const cs = makeChangeSet({ state: "previewed" });
      const result = adapter.promote(cs);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot promote");
    });
  });

  describe("rollback", () => {
    it("succeeds from applied state", () => {
      const cs = makeChangeSet({ state: "applied" });
      const result = adapter.rollback(cs);
      expect(result.success).toBe(true);
      expect(result.changeSet.state).toBe("rolled_back");
    });

    it("sets rollbackRef", () => {
      const cs = makeChangeSet({ state: "applied", rollbackRef: null });
      const result = adapter.rollback(cs);
      expect(result.changeSet.rollbackRef).toBe("rollback-cs-test-1");
    });

    it("preserves existing rollbackRef", () => {
      const cs = makeChangeSet({ state: "applied", rollbackRef: "existing-ref" });
      const result = adapter.rollback(cs);
      expect(result.changeSet.rollbackRef).toBe("existing-ref");
    });

    it("fails from planned state", () => {
      const cs = makeChangeSet({ state: "planned" });
      const result = adapter.rollback(cs);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot rollback");
    });
  });

  describe("discard", () => {
    it("succeeds from previewed state", () => {
      const cs = makeChangeSet({ state: "previewed" });
      const result = adapter.discard(cs);
      expect(result.success).toBe(true);
      expect(result.changeSet.state).toBe("discarded");
    });

    it("succeeds from applied state", () => {
      const cs = makeChangeSet({ state: "applied" });
      const result = adapter.discard(cs);
      expect(result.success).toBe(true);
      expect(result.changeSet.state).toBe("discarded");
    });

    it("fails from planned state", () => {
      const cs = makeChangeSet({ state: "planned" });
      const result = adapter.discard(cs);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot discard");
    });
  });
});
