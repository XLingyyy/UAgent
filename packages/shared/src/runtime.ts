import type { TaskDraft, TaskEvent, TaskRecord } from "./task.js";
import type { ApprovalDecisionValue } from "./approval.js";

export type RuntimeStatus =
  | "offline"
  | "starting"
  | "ready"
  | "running"
  | "waiting_for_approval"
  | "completed"
  | "error";

export interface RuntimeSnapshot {
  status: RuntimeStatus;
  activeTaskId: string | null;
  tasksById: Record<string, TaskRecord>;
  eventsByTaskId: Record<string, TaskEvent[]>;
  lastError: string | null;
}

export type RuntimeCommand =
  | { type: "submit_task"; draft: TaskDraft }
  | { type: "cancel_task"; taskId: string };

export interface RuntimeClient {
  submitTask(draft: TaskDraft): Promise<TaskRecord>;
  cancelTask(taskId: string): Promise<void>;
  submitApprovalDecision?(taskId: string, stepId: string | null, decision: ApprovalDecisionValue, actor: string, reason: string): Promise<void>;
  getSnapshot(): RuntimeSnapshot;
  subscribe(listener: (snapshot: RuntimeSnapshot) => void): () => void;
}

export function createEmptyRuntimeSnapshot(): RuntimeSnapshot {
  return {
    status: "ready",
    activeTaskId: null,
    tasksById: {},
    eventsByTaskId: {},
    lastError: null,
  };
}
