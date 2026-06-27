import { describe, expect, it } from "vitest";
import type { ChangeOperation, ChangeSetScope, ChangeSetEvent } from "@uagent/shared";
import { type ToolRiskLevel } from "@uagent/shared";
import { createChangeSet, applyChangeSetEvent, reduceChangeSetEvents, type CreateChangeSetInput } from "./change-set-reducer.js";

const baseScope: ChangeSetScope = {
  assets: [],
  files: ["src/index.ts"],
  commands: [],
  riskLevel: "low_risk" as ToolRiskLevel,
  sandboxResultRef: null,
};

const baseOperations: ChangeOperation[] = [
  { id: "op-1", type: "update", target: "src/index.ts", description: "Update index", oldValue: null, newValue: "new content", riskLevel: "low_risk" as ToolRiskLevel },
];

function createValidInput(overrides?: Partial<CreateChangeSetInput>): CreateChangeSetInput {
  return {
    id: "cs-1",
    taskId: "task-1",
    scope: baseScope,
    operations: baseOperations,
    diffSummary: "",
    evidenceRefs: [],
    ...overrides,
  };
}

function makeChangeSet(overrides?: Partial<CreateChangeSetInput>): ReturnType<typeof createChangeSet> {
  return createChangeSet(createValidInput(overrides));
}

describe("createChangeSet", () => {
  it("starts in planned state", () => {
    const cs = makeChangeSet();
    expect(cs.state).toBe("planned");
    expect(cs.id).toBe("cs-1");
    expect(cs.rollbackRef).toBeNull();
  });
});

describe("applyChangeSetEvent", () => {
  it("preview transitions from planned to previewed", () => {
    const cs = makeChangeSet();
    const result = applyChangeSetEvent(cs, "change_set_previewed");
    expect(result.state).toBe("previewed");
  });

  it("apply transitions from previewed to applied", () => {
    const cs = { ...makeChangeSet(), state: "previewed" as const };
    const result = applyChangeSetEvent(cs, "change_set_applied");
    expect(result.state).toBe("applied");
  });

  it("promote from applied succeeds", () => {
    const cs = { ...makeChangeSet(), state: "applied" as const };
    const result = applyChangeSetEvent(cs, "change_set_promoted");
    expect(result.state).toBe("promoted");
  });

  it("rollback from applied succeeds", () => {
    const cs = { ...makeChangeSet(), state: "applied" as const, rollbackRef: null };
    const result = applyChangeSetEvent(cs, "change_set_rolled_back");
    expect(result.state).toBe("rolled_back");
    expect(result.rollbackRef).toBe("rollback-cs-1");
  });

  it("discard from previewed succeeds", () => {
    const cs = { ...makeChangeSet(), state: "previewed" as const };
    const result = applyChangeSetEvent(cs, "change_set_discarded");
    expect(result.state).toBe("discarded");
  });

  it("discard from applied succeeds", () => {
    const cs = { ...makeChangeSet(), state: "applied" as const };
    const result = applyChangeSetEvent(cs, "change_set_discarded");
    expect(result.state).toBe("discarded");
  });

  it("returns unchanged for invalid transition from planned to promoted", () => {
    const cs = makeChangeSet();
    const result = applyChangeSetEvent(cs, "change_set_promoted");
    expect(result.state).toBe("planned");
    expect(result).toBe(cs);
  });

  it("returns unchanged for invalid transition from previewed to promoted", () => {
    const cs = { ...makeChangeSet(), state: "previewed" as const };
    const result = applyChangeSetEvent(cs, "change_set_promoted");
    expect(result.state).toBe("previewed");
    expect(result).toBe(cs);
  });

  it("returns unchanged for unknown event type", () => {
    const cs = makeChangeSet();
    const result = applyChangeSetEvent(cs, "unknown_event");
    expect(result).toBe(cs);
  });

  it("returns unchanged for terminal states", () => {
    const cs = { ...makeChangeSet(), state: "promoted" as const };
    const result = applyChangeSetEvent(cs, "change_set_previewed");
    expect(result.state).toBe("promoted");
    expect(result).toBe(cs);
  });
});

describe("reduceChangeSetEvents", () => {
  it("reduces a full lifecycle from created through promoted", () => {
    const events: ChangeSetEvent[] = [
      {
        id: "evt-1",
        taskId: "task-1",
        changeSetId: "cs-1",
        type: "change_set_created",
        title: "Change set created",
        createdAt: 1000,
        payload: {
          scope: baseScope,
          operations: baseOperations,
        },
      },
      {
        id: "evt-2",
        taskId: "task-1",
        changeSetId: "cs-1",
        type: "change_set_previewed",
        title: "Change set previewed",
        createdAt: 2000,
      },
      {
        id: "evt-3",
        taskId: "task-1",
        changeSetId: "cs-1",
        type: "change_set_applied",
        title: "Change set applied",
        createdAt: 3000,
      },
      {
        id: "evt-4",
        taskId: "task-1",
        changeSetId: "cs-1",
        type: "change_set_promoted",
        title: "Change set promoted",
        createdAt: 4000,
      },
    ];

    const result = reduceChangeSetEvents(events);
    expect(result.state).toBe("promoted");
    expect(result.id).toBe("cs-1");
    expect(result.taskId).toBe("task-1");
  });

  it("throws if no change_set_created event is present", () => {
    const events: ChangeSetEvent[] = [
      {
        id: "evt-1",
        taskId: "task-1",
        changeSetId: "cs-1",
        type: "change_set_previewed",
        title: "Change set previewed",
        createdAt: 2000,
      },
    ];
    expect(() => reduceChangeSetEvents(events)).toThrow("No change_set_created event");
  });
});
