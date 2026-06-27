import type { ToolRiskLevel } from "./risk.js";

export type ChangeSetState =
  | "planned"
  | "previewed"
  | "applied"
  | "promoted"
  | "rolled_back"
  | "discarded";

export type ChangeOperationType = "create" | "update" | "delete" | "rename" | "move";

export interface ChangeOperation {
  id: string;
  type: ChangeOperationType;
  target: string;
  description: string;
  oldValue: string | null;
  newValue: string | null;
  riskLevel: ToolRiskLevel;
}

export interface WorkspaceChangeSet {
  id: string;
  taskId: string;
  state: ChangeSetState;
  scope: ChangeSetScope;
  operations: ChangeOperation[];
  diffSummary: string;
  evidenceRefs: string[];
  rollbackRef: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ChangeSetScope {
  assets: string[];
  files: string[];
  commands: string[];
  riskLevel: ToolRiskLevel;
  sandboxResultRef: string | null;
}

export interface ChangeSetEvent {
  id: string;
  taskId: string;
  changeSetId: string;
  type: "change_set_created" | "change_set_previewed" | "change_set_applied" | "change_set_promoted" | "change_set_rolled_back" | "change_set_discarded";
  title: string;
  body?: string;
  createdAt: number;
  payload?: Record<string, unknown>;
}
