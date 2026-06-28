export type WatcherStatus =
  | "idle"
  | "starting"
  | "active"
  | "stopped"
  | "error";

export type WatcherStopReason =
  | "user_stopped"
  | "project_switched"
  | "root_removed"
  | "error"
  | "overflow";

export interface WatcherPolicy {
  allowedRoots: string[];
  ignoredDirs: string[];
  ignorePatterns: string[];
  maxQueueSize: number;
  debounceMs: number;
  overflowAction: "warn" | "stop";
}

export interface ProjectWatchSession {
  id: string;
  projectId: string;
  rootRef: string;
  displayRoot: string;
  status: WatcherStatus;
  policy: WatcherPolicy;
  startedAt: number;
  stoppedAt: number | null;
  stopReason: WatcherStopReason | null;
  totalChanges: number;
  overflowed: boolean;
}

export type ChangeKind = "added" | "modified" | "deleted" | "ignored";

export type ChangeSource = "file" | "directory";

export interface ProjectChangeEvent {
  id: string;
  watchSessionId: string;
  kind: ChangeKind;
  source: ChangeSource;
  rootRelativePath: string;
  displayPath: string;
  timestamp: number;
}

export interface ProjectIndexDiffEntry {
  kind: ChangeKind;
  rootRelativePath: string;
  displayPath: string;
  previousEntry: Record<string, unknown> | null;
  currentEntry: Record<string, unknown> | null;
}

export interface ProjectIndexDiff {
  sessionId: string;
  projectId: string;
  entries: ProjectIndexDiffEntry[];
  summary: {
    added: number;
    modified: number;
    deleted: number;
    ignored: number;
    rootEscapes: number;
  };
  generatedAt: number;
}

export interface WatcherEventBatch {
  sessionId: string;
  events: ProjectChangeEvent[];
  batchIndex: number;
  overflow: boolean;
  timestamp: number;
}

export type WatcherAction =
  | { type: "start"; sessionId: string; projectId: string; rootRef: string }
  | { type: "change"; batch: WatcherEventBatch }
  | { type: "diff"; diff: ProjectIndexDiff }
  | { type: "overflow"; sessionId: string; warning: string }
  | { type: "stop"; sessionId: string; reason: WatcherStopReason }
  | { type: "error"; sessionId: string; error: string };
