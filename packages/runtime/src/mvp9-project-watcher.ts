import type {
  WatcherPolicy,
  ProjectWatchSession,
  ProjectChangeEvent,
  ProjectIndexDiff,
  ProjectIndexDiffEntry,
  WatcherEventBatch,
  WatcherStopReason,
} from "@uagent/shared";

export function createDefaultWatcherPolicy(
  allowedRoot: string,
  overrides?: Partial<WatcherPolicy>,
): WatcherPolicy {
  return {
    allowedRoots: [allowedRoot],
    ignoredDirs: overrides?.ignoredDirs ?? [
      ".git", "node_modules", "dist", "build",
      "Binaries", "Intermediate", "Saved", "DerivedDataCache",
      ".vs", "coverage", ".agent-bus",
    ],
    ignorePatterns: overrides?.ignorePatterns ?? [
      "*.log", "*.tmp", "*.swp", "*.lock",
    ],
    maxQueueSize: overrides?.maxQueueSize ?? 10000,
    debounceMs: overrides?.debounceMs ?? 500,
    overflowAction: overrides?.overflowAction ?? "warn",
  };
}

export function isRootAllowedForWatch(
  root: string,
  policy: WatcherPolicy,
): { allowed: boolean; reason: string } {
  const normalizedRoot = root.replace(/\\/g, "/").toLowerCase();
  for (const allowed of policy.allowedRoots) {
    const normalizedAllowed = allowed.replace(/\\/g, "/").toLowerCase();
    if (normalizedRoot === normalizedAllowed || normalizedRoot.startsWith(normalizedAllowed + "/")) {
      return { allowed: true, reason: "Root is in allowed list" };
    }
  }
  return { allowed: false, reason: `Root '${root}' is not in the allowed roots list` };
}

export function computeProjectIndexDiff(
  entries: ProjectChangeEvent[],
): ProjectIndexDiff {
  const diffEntries: ProjectIndexDiffEntry[] = [];
  const summary = { added: 0, modified: 0, deleted: 0, ignored: 0, rootEscapes: 0 };

  for (const event of entries) {
    const entry: ProjectIndexDiffEntry = {
      kind: event.kind,
      rootRelativePath: event.rootRelativePath,
      displayPath: event.displayPath,
      previousEntry: null,
      currentEntry: null,
    };

    if (event.kind === "added") summary.added++;
    else if (event.kind === "modified") summary.modified++;
    else if (event.kind === "deleted") summary.deleted++;
    else if (event.kind === "ignored") summary.ignored++;

    diffEntries.push(entry);
  }

  return {
    sessionId: entries[0]?.watchSessionId ?? "",
    projectId: entries[0]?.watchSessionId ?? "",
    entries: diffEntries,
    summary,
    generatedAt: Date.now(),
  };
}

export function debounceWatcherEvents(
  batches: WatcherEventBatch[],
): WatcherEventBatch[] {
  if (batches.length === 0) return [];
  const merged = new Map<string, ProjectChangeEvent>();
  for (const batch of batches) {
    for (const event of batch.events) {
      const key = `${event.kind}:${event.rootRelativePath}`;
      merged.set(key, event);
    }
  }
  return [
    {
      sessionId: batches[0].sessionId,
      events: Array.from(merged.values()),
      batchIndex: batches[0].batchIndex,
      overflow: batches.some((b) => b.overflow),
      timestamp: Date.now(),
    },
  ];
}

export interface FixtureWatcherAdapter {
  startSession(projectId: string, rootRef: string): ProjectWatchSession;
  generateChangeEvents(sessionId: string, count: number): ProjectChangeEvent[];
  computeDiff(sessionId: string): ProjectIndexDiff;
  stopSession(sessionId: string, reason: WatcherStopReason): ProjectWatchSession;
  getSession(sessionId: string): ProjectWatchSession | null;
}

let watcherSessionCounter = 0;
let watcherEventCounter = 0;

export function createFixtureWatcherAdapter(
  policy: WatcherPolicy,
): FixtureWatcherAdapter {
  const sessions = new Map<string, ProjectWatchSession>();
  const pendingEvents = new Map<string, ProjectChangeEvent[]>();

  return {
    startSession(projectId: string, rootRef: string): ProjectWatchSession {
      watcherSessionCounter++;
      const session: ProjectWatchSession = {
        id: `fixture-watcher-${watcherSessionCounter}`,
        projectId,
        rootRef,
        displayRoot: "[project-root]",
        status: "active",
        policy,
        startedAt: Date.now(),
        stoppedAt: null,
        stopReason: null,
        totalChanges: 0,
        overflowed: false,
      };
      sessions.set(session.id, session);
      pendingEvents.set(session.id, []);
      return session;
    },

    generateChangeEvents(sessionId: string, count: number): ProjectChangeEvent[] {
      const session = sessions.get(sessionId);
      if (!session) return [];
      const kinds: Array<"added" | "modified" | "deleted"> = ["added", "modified", "deleted"];
      const events: ProjectChangeEvent[] = [];
      for (let i = 0; i < count; i++) {
        watcherEventCounter++;
        const kind = kinds[watcherEventCounter % kinds.length];
        const event: ProjectChangeEvent = {
          id: `fixture-watcher-ev-${watcherEventCounter}`,
          watchSessionId: sessionId,
          kind,
          source: "file",
          rootRelativePath: `Fixture/File${watcherEventCounter}.txt`,
          displayPath: `[project-root]/Fixture/File${watcherEventCounter}.txt`,
          timestamp: Date.now(),
        };
        events.push(event);
      }

      const existing = pendingEvents.get(sessionId) ?? [];
      pendingEvents.set(sessionId, [...existing, ...events]);
      session.totalChanges += count;
      return events;
    },

    computeDiff(sessionId: string): ProjectIndexDiff {
      const events = pendingEvents.get(sessionId) ?? [];
      const diff = computeProjectIndexDiff(events);
      diff.sessionId = sessionId;
      return diff;
    },

    stopSession(sessionId: string, reason: WatcherStopReason): ProjectWatchSession {
      const session = sessions.get(sessionId);
      if (!session) {
        throw new Error(`Session ${sessionId} not found`);
      }
      session.status = "stopped";
      session.stoppedAt = Date.now();
      session.stopReason = reason;
      pendingEvents.delete(sessionId);
      return session;
    },

    getSession(sessionId: string): ProjectWatchSession | null {
      return sessions.get(sessionId) ?? null;
    },
  };
}
