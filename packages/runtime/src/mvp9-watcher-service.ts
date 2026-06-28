import {
  type ProjectWatchSession,
  type ProjectChangeEvent,
  type ProjectIndexDiff,
  type AuditEvent,
} from "@uagent/shared";
import {
  createFixtureWatcherAdapter,
  createDefaultWatcherPolicy,
  isRootAllowedForWatch,
  type FixtureWatcherAdapter,
} from "./mvp9-project-watcher.js";
import { createAuditProjection, type AuditProjectionEngine } from "./audit-projection.js";
import { createSessionHistory, type SessionHistoryEngine } from "./session-history.js";

export type WatcherStage = "idle" | "active" | "stopped" | "blocked";

export interface WatcherServiceState {
  session: ProjectWatchSession | null;
  events: ProjectChangeEvent[];
  diff: ProjectIndexDiff | null;
  stage: WatcherStage;
  stopReason: string | null;
  overflowed: boolean;
}

let watcherIdCounter = 0;

function nextId(prefix: string): string {
  watcherIdCounter++;
  return `${prefix}-${watcherIdCounter}`;
}

export interface WatcherService {
  getState(): WatcherServiceState;
  start(projectId: string, rootRef: string): void;
  generateChanges(count: number): void;
  computeDiff(): void;
  applyChanges(): void;
  rescan(): void;
  stop(): void;
  reset(): void;
  subscribe(listener: (state: WatcherServiceState) => void): () => void;
  replayTask(taskId: string): WatcherServiceState;
}

const DEFAULT_PROJECT_ROOT = "[project-root]";

export function createWatcherService(
  auditEngine?: AuditProjectionEngine,
  sessionEngine?: SessionHistoryEngine,
  adapter?: FixtureWatcherAdapter,
): WatcherService {
  const policy = createDefaultWatcherPolicy(DEFAULT_PROJECT_ROOT);
  const watcherAdapter = adapter ?? createFixtureWatcherAdapter(policy);
  const audit = auditEngine ?? createAuditProjection();
  const session = sessionEngine ?? createSessionHistory();
  const listeners = new Set<(state: WatcherServiceState) => void>();

  let state: WatcherServiceState = {
    session: null,
    events: [],
    diff: null,
    stage: "idle",
    stopReason: null,
    overflowed: false,
  };

  function notify() {
    for (const listener of listeners) {
      listener({ ...state });
    }
  }

  function recordAudit(type: string, title: string, body: string, payload?: Record<string, unknown>) {
    audit.recordAuditEvent({
      id: nextId("audit"),
      type: type as AuditEvent["type"],
      taskId: state.session?.projectId ?? null,
      sessionId: "session-default",
      actor: { type: "fixture", id: "watcher-service", label: "Watcher Service" },
      title,
      body,
      summary: title,
      redacted: true,
      createdAt: Date.now(),
      payload,
    });
  }

  return {
    getState() {
      return { ...state };
    },

    start(projectId: string, rootRef: string) {
      const { allowed, reason } = isRootAllowedForWatch(rootRef, policy);
      if (!allowed) {
        state = { ...state, stage: "blocked", stopReason: reason };
        session.recordCapabilityEvent(projectId, "watcher_error", `Watcher blocked: ${reason}`, "watcher", "blocked");
        recordAudit("watcher_error", "Watcher blocked", reason, { rootRef });
        notify();
        return;
      }
      const sess = watcherAdapter.startSession(projectId, rootRef);
      state = {
        session: sess,
        events: [],
        diff: null,
        stage: "active",
        stopReason: null,
        overflowed: false,
      };
      session.recordCapabilityEvent(projectId, "watcher_started", `Watcher started: ${rootRef}`, "watcher", "active");
      recordAudit("watcher_started", "Watcher started", `Root: ${rootRef}`, { rootRef });
      notify();
    },

    generateChanges(count: number) {
      const sess = state.session;
      if (!sess) return;
      const newEvents = watcherAdapter.generateChangeEvents(sess.id, count);
      sess.totalChanges = sess.totalChanges + count;
      const allEvents = [...state.events, ...newEvents];
      const policy = createDefaultWatcherPolicy(DEFAULT_PROJECT_ROOT);
      const overflowed = allEvents.length > policy.maxQueueSize;
      state = { ...state, session: sess, events: allEvents, overflowed };
      session.recordCapabilityEvent(
        sess.projectId,
        "watcher_changed",
        `Watcher changes: ${count} events`,
        "watcher",
        "changed",
      );
      recordAudit("watcher_changed", "Watcher changed", `${count} change events`);
      if (overflowed) {
        const msg = `Overflow: ${allEvents.length} events exceeds max queue size ${policy.maxQueueSize}`;
        session.recordCapabilityEvent(sess.projectId, "watcher_overflow", msg, "watcher", "overflow");
        recordAudit("watcher_overflow", "Watcher overflow", msg);
      }
      notify();
    },

    computeDiff() {
      const sess = state.session;
      if (!sess) return;
      const diff = watcherAdapter.computeDiff(sess.id);
      state = { ...state, diff };
      session.recordCapabilityEvent(
        sess.projectId,
        "watcher_diff_generated",
        `Watcher diff: ${diff.summary.added + diff.summary.modified + diff.summary.deleted} changes`,
        "watcher",
        "diff",
      );
      recordAudit("watcher_diff_generated", "Watcher diff generated",
        `Added: ${diff.summary.added}, Modified: ${diff.summary.modified}, Deleted: ${diff.summary.deleted}`);
      notify();
    },

    applyChanges() {
      const sess = state.session;
      if (!sess) return;
      const prevDiff = state.diff;
      state = {
        ...state,
        events: [],
        diff: null,
      };
      session.recordCapabilityEvent(
        sess.projectId,
        "watcher_applied",
        `Watcher changes applied: ${prevDiff ? `${prevDiff.summary.added + prevDiff.summary.modified + prevDiff.summary.deleted} changes` : "no diff"}`,
        "watcher",
        "applied",
      );
      recordAudit("watcher_applied", "Watcher changes applied",
        prevDiff
          ? `Added: ${prevDiff.summary.added}, Modified: ${prevDiff.summary.modified}, Deleted: ${prevDiff.summary.deleted}`
          : "No changes to apply");
      notify();
    },

    rescan() {
      const sess = state.session;
      if (!sess) return;
      const newDiff = watcherAdapter.computeDiff(sess.id);
      state = {
        ...state,
        events: [],
        diff: newDiff,
      };
      session.recordCapabilityEvent(
        sess.projectId,
        "watcher_rescanned",
        `Watcher rescanned: ${newDiff.summary.added + newDiff.summary.modified + newDiff.summary.deleted} changes`,
        "watcher",
        "rescanned",
      );
      recordAudit("watcher_rescanned", "Watcher rescanned",
        `Added: ${newDiff.summary.added}, Modified: ${newDiff.summary.modified}, Deleted: ${newDiff.summary.deleted}`);
      notify();
    },

    stop() {
      const sess = state.session;
      if (!sess) return;
      const stopped = watcherAdapter.stopSession(sess.id, "user_stopped");
      state = {
        ...state,
        session: stopped,
        stage: "stopped",
        stopReason: stopped.stopReason,
      };
      session.recordCapabilityEvent(
        stopped.projectId,
        "watcher_stopped",
        `Watcher stopped: ${stopped.stopReason}`,
        "watcher",
        "stopped",
      );
      recordAudit("watcher_stopped", "Watcher stopped", `Reason: ${stopped.stopReason}`);
      notify();
    },

    reset() {
      state = { session: null, events: [], diff: null, stage: "idle", stopReason: null, overflowed: false };
      notify();
    },

    subscribe(listener: (state: WatcherServiceState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    replayTask(taskId: string): WatcherServiceState {
      const replay = session.replayTask(taskId);
      if (replay.summary.eventCount === 0) {
        return { session: null, events: [], diff: null, stage: "idle", stopReason: null, overflowed: false };
      }
      const lastEvent = replay.events[replay.events.length - 1];
      const stage: WatcherStage =
        lastEvent?.type === "watcher_stopped" ? "stopped"
        : lastEvent?.type === "watcher_error" ? "blocked"
        : (lastEvent?.type === "watcher_started" ||
           lastEvent?.type === "watcher_changed" ||
           lastEvent?.type === "watcher_diff_generated" ||
           lastEvent?.type === "watcher_applied" ||
           lastEvent?.type === "watcher_rescanned") ? "active"
        : "idle";
      return { session: null, events: [], diff: null, stage, stopReason: null, overflowed: false };
    },
  };
}
