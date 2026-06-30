import type { TaskState } from "./task.js";
import type { ToolRiskLevel } from "./risk.js";

export interface SessionSummary {
  id: string;
  label: string;
  taskCount: number;
  terminalStates: Record<string, number>;
  lastActivityAt: number;
  riskSummary: Record<string, number>;
  providerModes: string[];
  approvalCount: number;
  changeSetCount: number;
  createdAt: number;
  archivedAt: number | null;
}

export interface TaskHistoryEntry {
  taskId: string;
  title: string;
  state: TaskState;
  providerMode: string;
  approvalCount: number;
  changeSetCount: number;
  createdAt: number;
  completedAt: number | null;
}

export interface ReplayCursor {
  sessionId: string;
  taskId: string | null;
  fromEventIndex: number;
  toEventIndex: number | null;
  filter: ReplayFilter | null;
}

export interface ReplayFilter {
  taskId: string | null;
  eventTypes: string[];
  riskLevels: ToolRiskLevel[];
  terminalStates: TaskState[];
  providerModes: string[];
  diagnosticKinds?: string[];
  diagnosticSeverities?: string[];
  editorSessionIds?: string[];
  operationIds?: string[];
  changeSetIds?: string[];
  toolNames?: string[];
  affectedFiles?: string[];
}

export interface ReplaySummary {
  sessionId: string;
  taskId: string | null;
  eventCount: number;
  terminalState: string | null;
  filteredCount: number;
  redacted: boolean;
  replayOnly?: boolean;
  recordedOnlyActions?: string[];
}
