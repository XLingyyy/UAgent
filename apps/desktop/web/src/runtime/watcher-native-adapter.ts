import type {
  ProjectWatchSession,
  ProjectIndexDiff,
} from "@uagent/shared";
import { resolveTrustedNativeRootRef, type NativeInvoke } from "./project-native-adapter";
import type { WatcherCapabilityStatus } from "@uagent/runtime";

export type NativeWatcherStatus = "watching" | "stopped" | "blocked";

export interface NativeWatcherSessionInfo {
  sessionId: string;
  rootId?: string;
  projectId: string;
  displayRoot: string;
  status: NativeWatcherStatus;
  startedAt: number;
  stoppedAt: number | null;
  overflowed: boolean;
  queuedCount: number;
  dirty: boolean;
}

interface NativeStartResult {
  sessionId: string;
  rootId?: string;
  status: string;
  displayRoot: string;
  blocked: boolean;
  reason: string;
}

interface NativeStopResult {
  sessionId: string;
  status: string;
}

interface NativeDiffEntry {
  kind: string;
  rootRelativePath: string;
  displayPath: string;
}

interface NativeDiffSummary {
  added: number;
  modified: number;
  deleted: number;
}

interface NativeDiffResult {
  sessionId: string;
  entries: NativeDiffEntry[];
  summary: NativeDiffSummary;
  overflowed: boolean;
  queuedCount: number;
}

export interface NativeWatcherAdapter {
  getCapability: () => WatcherCapabilityStatus;
  refreshCapability: () => Promise<WatcherCapabilityStatus>;
  startSession: (projectId: string, rootRef: string) => Promise<ProjectWatchSession>;
  stopSession: (sessionId: string) => Promise<ProjectWatchSession>;
  readDiff: (sessionId: string) => Promise<ProjectIndexDiff>;
  getSession: (sessionId: string) => Promise<NativeWatcherSessionInfo | null>;
}

interface NativeWatcherCapabilityResult {
  enabled?: boolean;
  mode?: "native" | "fixture" | "disabled";
  reason?: string | null;
  trustedRootRequired?: boolean;
  trusted_root_required?: boolean;
  debounceMs?: number;
  debounce_ms?: number;
  maxQueueSize?: number;
  max_queue_size?: number;
  overflowAction?: "warn" | "stop";
  overflow_action?: "warn" | "stop";
  readDiffOnly?: boolean;
  read_diff_only?: boolean;
}

const DEFAULT_WATCHER_CAPABILITY: WatcherCapabilityStatus = {
  enabled: false,
  mode: "disabled",
  reason: "native_capability_status_pending",
  trustedRootRequired: true,
  debounceMs: 500,
  maxQueueSize: 10000,
  overflowAction: "warn",
  readDiffOnly: true,
};

function getGlobalInvoke(): NativeInvoke | null {
  const tauriInternals = (globalThis as { __TAURI_INTERNALS__?: { invoke?: NativeInvoke } })
    .__TAURI_INTERNALS__;
  return tauriInternals?.invoke ?? null;
}

export function createDesktopWatcherAdapter(invoke: NativeInvoke): NativeWatcherAdapter {
  let capability = DEFAULT_WATCHER_CAPABILITY;

  function normalizeCapability(raw: NativeWatcherCapabilityResult): WatcherCapabilityStatus {
    const enabled = Boolean(raw.enabled);
    return {
      enabled,
      mode: raw.mode ?? (enabled ? "native" : "disabled"),
      reason: raw.reason ?? (enabled ? null : "feature_disabled"),
      trustedRootRequired: raw.trustedRootRequired ?? raw.trusted_root_required ?? true,
      debounceMs: raw.debounceMs ?? raw.debounce_ms ?? DEFAULT_WATCHER_CAPABILITY.debounceMs,
      maxQueueSize: raw.maxQueueSize ?? raw.max_queue_size ?? DEFAULT_WATCHER_CAPABILITY.maxQueueSize,
      overflowAction: raw.overflowAction ?? raw.overflow_action ?? DEFAULT_WATCHER_CAPABILITY.overflowAction,
      readDiffOnly: raw.readDiffOnly ?? raw.read_diff_only ?? true,
    };
  }

  return {
    getCapability() {
      return capability;
    },

    async refreshCapability(): Promise<WatcherCapabilityStatus> {
      try {
        const raw = await invoke<NativeWatcherCapabilityResult>("watcher_capability_status");
        capability = normalizeCapability(raw);
      } catch {
        capability = {
          ...DEFAULT_WATCHER_CAPABILITY,
          reason: "native_capability_status_unavailable",
        };
      }
      return capability;
    },

    async startSession(projectId: string, rootRef: string): Promise<ProjectWatchSession> {
      const resolvedRootRef =
        resolveTrustedNativeRootRef(rootRef) ??
        resolveTrustedNativeRootRef(projectId) ??
        rootRef;
      const raw = await invoke<NativeStartResult>("start_watcher", {
        input: { projectId, rootRef: resolvedRootRef },
      });
      if (raw.blocked) {
        throw new Error(`Watcher blocked: ${raw.reason}`);
      }
      return {
        id: raw.sessionId,
        projectId,
        rootRef: raw.rootId ?? "root:native-watcher",
        displayRoot: raw.displayRoot,
        status: raw.status === "watching" ? "active" : "stopped",
        policy: {
          allowedRoots: [raw.rootId ?? "root:native-watcher"],
          ignoredDirs: [".git", "node_modules", "dist", "build", "Binaries", "Intermediate", "Saved", "DerivedDataCache", ".vs", "coverage", ".agent-bus"],
          ignorePatterns: ["*.log", "*.tmp", "*.swp", "*.lock"],
          maxQueueSize: capability.maxQueueSize,
          debounceMs: capability.debounceMs,
          overflowAction: capability.overflowAction,
        },
        startedAt: Date.now(),
        stoppedAt: null,
        stopReason: null,
        totalChanges: 0,
        overflowed: false,
      };
    },

    async stopSession(sessionId: string): Promise<ProjectWatchSession> {
      const raw = await invoke<NativeStopResult>("stop_watcher", {
        input: { sessionId },
      });
      return {
        id: raw.sessionId,
        projectId: "",
        rootRef: "",
        displayRoot: "",
        status: "stopped",
        policy: {
          allowedRoots: [],
          ignoredDirs: [],
          ignorePatterns: [],
          maxQueueSize: 10000,
          debounceMs: 500,
          overflowAction: "warn",
        },
        startedAt: Date.now(),
        stoppedAt: Date.now(),
        stopReason: "user_stopped",
        totalChanges: 0,
        overflowed: false,
      };
    },

    async readDiff(sessionId: string): Promise<ProjectIndexDiff> {
      const raw = await invoke<NativeDiffResult>("read_watcher_diff", {
        input: { sessionId },
      });
      return {
        sessionId: raw.sessionId,
        projectId: "",
        entries: raw.entries.map((e: NativeDiffEntry) => ({
          kind: e.kind as ProjectIndexDiff["entries"][0]["kind"],
          rootRelativePath: e.rootRelativePath,
          displayPath: e.displayPath,
          previousEntry: null,
          currentEntry: null,
        })),
        summary: {
          added: raw.summary.added,
          modified: raw.summary.modified,
          deleted: raw.summary.deleted,
          ignored: 0,
          rootEscapes: 0,
        },
        generatedAt: Date.now(),
      };
    },

    async getSession(sessionId: string): Promise<NativeWatcherSessionInfo | null> {
      try {
        const raw = await invoke<NativeWatcherSessionInfo | null>("get_watcher_session", {
          input: { sessionId },
        });
        return raw;
      } catch {
        return null;
      }
    },
  };
}

export function createDesktopWatcherAdapterFromEnvironment(
  invoke: NativeInvoke | null = getGlobalInvoke(),
): NativeWatcherAdapter | null {
  return invoke ? createDesktopWatcherAdapter(invoke) : null;
}
