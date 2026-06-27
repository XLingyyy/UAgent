import { type ChangeSetState, type ChangeOperation, type WorkspaceChangeSet, type ChangeSetScope, type ChangeSetEvent } from "@uagent/shared";
import { type ToolRiskLevel } from "@uagent/shared";

export interface CreateChangeSetInput {
  id: string;
  taskId: string;
  scope: ChangeSetScope;
  operations: ChangeOperation[];
  diffSummary?: string;
  evidenceRefs?: string[];
}

export function createChangeSet(input: CreateChangeSetInput): WorkspaceChangeSet {
  const now = Date.now();
  return {
    id: input.id,
    taskId: input.taskId,
    state: "planned",
    scope: input.scope,
    operations: input.operations,
    diffSummary: input.diffSummary ?? "",
    evidenceRefs: input.evidenceRefs ?? [],
    rollbackRef: null,
    createdAt: now,
    updatedAt: now,
  };
}

const EVENT_TO_STATE: Record<string, ChangeSetState> = {
  change_set_previewed: "previewed",
  change_set_applied: "applied",
  change_set_promoted: "promoted",
  change_set_rolled_back: "rolled_back",
  change_set_discarded: "discarded",
};

const ALLOWED_FROM: Record<string, ChangeSetState[]> = {
  change_set_previewed: ["planned"],
  change_set_applied: ["previewed"],
  change_set_promoted: ["applied"],
  change_set_rolled_back: ["applied"],
  change_set_discarded: ["previewed", "applied"],
};

export function applyChangeSetEvent(changeSet: WorkspaceChangeSet, eventType: string): WorkspaceChangeSet {
  const targetState = EVENT_TO_STATE[eventType];
  if (!targetState) {
    return changeSet;
  }
  const allowedFrom = ALLOWED_FROM[eventType];
  if (!allowedFrom?.includes(changeSet.state)) {
    return changeSet;
  }
  return {
    ...changeSet,
    state: targetState,
    updatedAt: Date.now(),
    ...(eventType === "change_set_rolled_back"
      ? { rollbackRef: changeSet.rollbackRef ?? `rollback-${changeSet.id}` }
      : {}),
  };
}

export function reduceChangeSetEvents(events: ChangeSetEvent[]): WorkspaceChangeSet {
  let changeSet: WorkspaceChangeSet | null = null;
  for (const event of events) {
    if (event.type === "change_set_created") {
      const payload = event.payload as Record<string, unknown> | undefined;
      const scope = (payload?.scope as ChangeSetScope) ?? {
        assets: [],
        files: [],
        commands: [],
        riskLevel: "low_risk" as ToolRiskLevel,
        sandboxResultRef: null,
      };
      changeSet = createChangeSet({
        id: event.changeSetId,
        taskId: event.taskId,
        scope,
        operations: (payload?.operations as ChangeOperation[]) ?? [],
        diffSummary: payload?.diffSummary as string | undefined,
        evidenceRefs: payload?.evidenceRefs as string[] | undefined,
      });
    } else if (changeSet) {
      changeSet = applyChangeSetEvent(changeSet, event.type);
    }
  }
  if (!changeSet) {
    throw new Error("No change_set_created event found in the event list");
  }
  return changeSet;
}
