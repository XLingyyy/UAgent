import {
  type ProjectWatchSession,
  type ProjectChangeEvent,
  type ProjectIndexDiff,
  type AuditEvent,
  redactPathForUi,
} from "@uagent/shared";
import {
  createFixtureWatcherAdapter,
  createDefaultWatcherPolicy,
  isRootAllowedForWatch,
  type FixtureWatcherAdapter,
  type NativeWatcherAdapter,
  type WatcherCapabilityStatus,
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
  dirty?: boolean;
  queuedCount?: number;
  lastError?: string | null;
  capability?: WatcherCapabilityStatus;
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
  refreshCapability?(): Promise<WatcherCapabilityStatus>;
  refreshNativeSession?(): Promise<void>;
  subscribe(listener: (state: WatcherServiceState) => void): () => void;
  replayTask(taskId: string): WatcherServiceState;
  getNativeSession?(): Promise<{ sessionId: string; rootId?: string; projectId: string; displayRoot: string; status: string; startedAt: number; stoppedAt: number | null; overflowed: boolean; queuedCount: number; dirty: boolean } | null>;
}

const DEFAULT_PROJECT_ROOT = "[project-root]";
const DEFAULT_WATCHER_CAPABILITY: WatcherCapabilityStatus = {
  enabled: false,
  mode: "fixture",
  reason: "native_watcher_unavailable",
  trustedRootRequired: true,
  debounceMs: 500,
  maxQueueSize: 10000,
  overflowAction: "warn",
  readDiffOnly: true,
};

function isRawPath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("/Users/") || value.startsWith("/home/");
}

function rootIdFor(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return `root:${hash.toString(16)}`;
}

function safeDisplayRoot(rootRef: string): string {
  if (!rootRef || rootRef === DEFAULT_PROJECT_ROOT || rootRef.startsWith("[project-root]")) return DEFAULT_PROJECT_ROOT;
  if (rootRef.startsWith("fixture://")) return DEFAULT_PROJECT_ROOT;
  if (rootRef.startsWith("root:")) return rootRef;
  if (isRawPath(rootRef)) return redactPathForUi(rootRef);
  return DEFAULT_PROJECT_ROOT;
}

function sanitizeText(text: string, rootRef: string): string {
  const displayRoot = safeDisplayRoot(rootRef);
  return text
    .replaceAll(rootRef, displayRoot)
    .replace(/[A-Za-z]:[\\/][^\s,)]+/g, "[outside-root]")
    .replace(/\/Users\/[^\s,)]+/g, "[outside-root]")
    .replace(/\/home\/[^\s,)]+/g, "[outside-root]");
}

function sanitizeSession(sess: ProjectWatchSession, fallbackRootRef: string): ProjectWatchSession {
  const sourceRoot = sess.rootRef || fallbackRootRef;
  const safeRootRef = sourceRoot.startsWith("root:") || sourceRoot === DEFAULT_PROJECT_ROOT
    ? sourceRoot
    : rootIdFor(sourceRoot);
  const displayRoot = sess.displayRoot && !isRawPath(sess.displayRoot)
    ? sess.displayRoot
    : safeDisplayRoot(sourceRoot);
  return {
    ...sess,
    rootRef: safeRootRef,
    displayRoot,
    policy: {
      ...sess.policy,
      allowedRoots: sess.policy.allowedRoots.map((root) =>
        root.startsWith("root:") || root === DEFAULT_PROJECT_ROOT ? root : rootIdFor(root),
      ),
    },
  };
}

function watcherPayload(projectId: string, rootRef: string, displayRoot?: string, rootId?: string) {
  return {
    projectId,
    rootId: rootId ?? (rootRef.startsWith("root:") ? rootRef : rootIdFor(rootRef)),
    displayRoot: displayRoot ?? safeDisplayRoot(rootRef),
  };
}

function emptyState(capability: WatcherCapabilityStatus = DEFAULT_WATCHER_CAPABILITY): WatcherServiceState {
  return {
    session: null,
    events: [],
    diff: null,
    stage: "idle",
    stopReason: null,
    overflowed: false,
    dirty: false,
    queuedCount: 0,
    lastError: null,
    capability,
  };
}

export function createWatcherService(
  auditEngine?: AuditProjectionEngine,
  sessionEngine?: SessionHistoryEngine,
  adapter?: FixtureWatcherAdapter,
  nativeAdapter?: NativeWatcherAdapter,
): WatcherService {
  const policy = createDefaultWatcherPolicy(DEFAULT_PROJECT_ROOT);
  const watcherAdapter = adapter ?? createFixtureWatcherAdapter(policy);
  const audit = auditEngine ?? createAuditProjection();
  const session = sessionEngine ?? createSessionHistory();
  const listeners = new Set<(state: WatcherServiceState) => void>();
  const isNative = nativeAdapter != null;
  const defaultCapability = nativeAdapter?.getCapability() ?? DEFAULT_WATCHER_CAPABILITY;

  let state: WatcherServiceState = emptyState(defaultCapability);

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

    async refreshCapability() {
      const capability = nativeAdapter?.refreshCapability
        ? await nativeAdapter.refreshCapability()
        : nativeAdapter?.getCapability() ?? state.capability ?? DEFAULT_WATCHER_CAPABILITY;
      state = { ...state, capability };
      notify();
      return capability;
    },

    start(projectId: string, rootRef: string) {
      if (isNative && nativeAdapter) {
        nativeAdapter.startSession(projectId, rootRef).then((sess) => {
          const safeSession = sanitizeSession(sess, rootRef);
          state = {
            session: safeSession,
            events: [],
            diff: null,
            stage: "active",
            stopReason: null,
            lastError: null,
            overflowed: false,
            dirty: false,
            queuedCount: 0,
          };
          const payload = watcherPayload(projectId, safeSession.rootRef, safeSession.displayRoot, safeSession.rootRef);
          session.recordCapabilityEvent(projectId, "watcher_started", `Watcher started: ${safeSession.displayRoot}`, "watcher", "active", payload);
          recordAudit("watcher_started", "Watcher started", `Root: ${safeSession.displayRoot}`, payload);
          notify();
        }).catch((err: Error) => {
          const safeMessage = sanitizeText(err.message, rootRef);
          state = { ...state, stage: "blocked", stopReason: safeMessage, lastError: safeMessage };
          const payload = watcherPayload(projectId, rootRef);
          session.recordCapabilityEvent(projectId, "watcher_error", `Watcher blocked: ${safeMessage}`, "watcher", "blocked", payload);
          recordAudit("watcher_error", "Watcher blocked", safeMessage, payload);
          notify();
        });
        return;
      }
      const { allowed, reason } = isRootAllowedForWatch(rootRef, policy);
      if (!allowed) {
        const safeReason = sanitizeText(reason, rootRef);
        state = { ...state, stage: "blocked", stopReason: safeReason, lastError: safeReason };
        const payload = watcherPayload(projectId, rootRef);
        session.recordCapabilityEvent(projectId, "watcher_error", `Watcher blocked: ${safeReason}`, "watcher", "blocked", payload);
        recordAudit("watcher_error", "Watcher blocked", safeReason, payload);
        notify();
        return;
      }
      const sess = sanitizeSession(watcherAdapter.startSession(projectId, rootRef), rootRef);
      state = {
        session: sess,
        events: [],
        diff: null,
        stage: "active",
        stopReason: null,
        lastError: null,
        overflowed: false,
        dirty: false,
        queuedCount: 0,
      };
      const payload = watcherPayload(projectId, sess.rootRef, sess.displayRoot, sess.rootRef);
      session.recordCapabilityEvent(projectId, "watcher_started", `Watcher started: ${sess.displayRoot}`, "watcher", "active", payload);
      recordAudit("watcher_started", "Watcher started", `Root: ${sess.displayRoot}`, payload);
      notify();
    },

    generateChanges(count: number) {
      if (isNative) return;
      const sess = state.session;
      if (!sess) return;
      const newEvents = watcherAdapter.generateChangeEvents(sess.id, count);
      sess.totalChanges = sess.totalChanges + count;
      const allEvents = [...state.events, ...newEvents];
      const policy = createDefaultWatcherPolicy(DEFAULT_PROJECT_ROOT);
      const overflowed = allEvents.length > policy.maxQueueSize;
      state = { ...state, session: sess, events: allEvents, overflowed, dirty: allEvents.length > 0, queuedCount: allEvents.length };
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
      if (isNative && nativeAdapter) {
        const sess = state.session;
        if (!sess) return;
        nativeAdapter.readDiff(sess.id).then((diff) => {
          state = { ...state, diff, dirty: false, queuedCount: 0, overflowed: diff.entries.length > 0 ? state.overflowed : false, lastError: null };
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
          return nativeAdapter.getSession(sess.id).then((info) => {
            if (!info) return;
            state = {
              ...state,
              dirty: info.dirty,
              queuedCount: info.queuedCount,
              overflowed: info.overflowed,
            };
            notify();
          });
        }).catch((err: Error) => {
          const safeMessage = sanitizeText(err.message, sess.displayRoot);
          state = { ...state, stage: "blocked", stopReason: safeMessage, lastError: safeMessage };
          const payload = watcherPayload(sess.projectId, sess.rootRef, sess.displayRoot, sess.rootRef);
          session.recordCapabilityEvent(sess.projectId, "watcher_error", `Watcher read diff failed: ${safeMessage}`, "watcher", "blocked", payload);
          recordAudit("watcher_error", "Watcher read diff failed", safeMessage, payload);
          notify();
        });
        return;
      }
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
      if (isNative) return;
      const sess = state.session;
      if (!sess) return;
      const prevDiff = state.diff;
      state = {
        ...state,
        events: [],
        diff: null,
        dirty: false,
        queuedCount: 0,
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
      if (isNative) return;
      const sess = state.session;
      if (!sess) return;
      const newDiff = watcherAdapter.computeDiff(sess.id);
      state = {
        ...state,
        events: [],
        diff: newDiff,
        dirty: false,
        queuedCount: 0,
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
      if (isNative && nativeAdapter) {
        nativeAdapter.stopSession(sess.id).then((stopped) => {
          const safeStopped = sanitizeSession(stopped, sess.rootRef);
          state = {
            ...state,
            session: safeStopped,
            stage: "stopped",
            stopReason: "user_stopped",
            dirty: false,
            queuedCount: 0,
          };
          session.recordCapabilityEvent(
            safeStopped.projectId || sess.projectId,
            "watcher_stopped",
            `Watcher stopped: user_stopped`,
            "watcher",
            "stopped",
            watcherPayload(sess.projectId, sess.rootRef, sess.displayRoot, sess.rootRef),
          );
          recordAudit("watcher_stopped", "Watcher stopped", "Reason: user_stopped");
          notify();
        }).catch(() => {
          state = { ...state, stage: "stopped", stopReason: "error" };
          notify();
        });
        return;
      }
      const stopped = watcherAdapter.stopSession(sess.id, "user_stopped");
      state = {
        ...state,
        session: stopped,
        stage: "stopped",
        stopReason: stopped.stopReason,
        dirty: false,
        queuedCount: 0,
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
      state = emptyState(state.capability);
      notify();
    },

    async refreshNativeSession() {
      if (!isNative || !nativeAdapter || !state.session) return;
      const currentSession = state.session;
      const info = await nativeAdapter.getSession(currentSession.id);
      if (!info) return;
      state = {
        ...state,
        session: {
          ...currentSession,
          rootRef: info.rootId ?? currentSession.rootRef,
          displayRoot: info.displayRoot,
          status: info.status === "watching" ? "active" : currentSession.status,
          stoppedAt: info.stoppedAt,
          overflowed: info.overflowed,
        },
        overflowed: info.overflowed,
        dirty: info.dirty,
        queuedCount: info.queuedCount,
      };
      if (info.dirty) {
        const msg = `${info.queuedCount} queued change events`;
        const payload = watcherPayload(info.projectId, info.rootId ?? currentSession.rootRef, info.displayRoot, info.rootId ?? currentSession.rootRef);
        session.recordCapabilityEvent(info.projectId, "watcher_changed", `Watcher changed: ${msg}`, "watcher", "changed", payload);
        recordAudit("watcher_changed", "Watcher changed", msg, payload);
        if (info.overflowed) {
          const overflowMsg = `Overflow: queued change count ${info.queuedCount} reached watcher backpressure limits`;
          session.recordCapabilityEvent(info.projectId, "watcher_overflow", overflowMsg, "watcher", "overflow", payload);
          recordAudit("watcher_overflow", "Watcher overflow", overflowMsg, payload);
        }
      }
      notify();
    },

    subscribe(listener: (state: WatcherServiceState) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async getNativeSession() {
      if (!isNative || !nativeAdapter || !state.session) return null;
      try {
        return await nativeAdapter.getSession(state.session.id);
      } catch {
        return null;
      }
    },

    replayTask(taskId: string): WatcherServiceState {
      const replay = session.replayTask(taskId);
      if (replay.summary.eventCount === 0) {
        return emptyState(state.capability);
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
      return { ...emptyState(state.capability), stage };
    },
  };
}
