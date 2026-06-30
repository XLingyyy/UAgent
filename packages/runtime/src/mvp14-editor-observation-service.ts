import type {
  UEEditorAttachRequest,
  UEEditorCapabilityStatus,
  UEEditorHeartbeat,
  UEEditorObservationSnapshot,
  UEEditorProcessDescriptor,
  UEEditorSession,
  UEEditorSessionMode,
} from "@uagent/shared";
import { evaluateEditorProcessPolicy } from "./mvp14-editor-process-policy.js";

export interface EditorObservationServiceOptions {
  bridgeEnabled: boolean;
  launchEnabled: boolean;
  trustedRootIds: string[];
  ttlMs?: number;
  now?: () => number;
}

export interface EditorObservationDiscoveryInput {
  projectId: string;
  rootId: string;
  uprojDisplayPath: string;
  source?: "fixture" | "native";
}

export interface EditorObservationDiscoveryResult {
  status: "ready" | "blocked" | "degraded";
  reason: string | null;
  processes: UEEditorProcessDescriptor[];
}

export interface EditorObservationAttachResult {
  status: "attached" | "blocked" | "degraded";
  reason: string | null;
  session: UEEditorSession | null;
}

export interface EditorObservationStatusResult {
  status: "ready" | "blocked" | "degraded" | "expired" | "exited" | "stopped";
  reason: string | null;
  heartbeat: UEEditorHeartbeat | null;
}

export interface EditorObservationSnapshotResult {
  status: "ready" | "blocked" | "degraded";
  reason: string | null;
  snapshot: UEEditorObservationSnapshot | null;
}

export interface EditorObservationReplaySummary {
  sessionId: string;
  replayOnly: true;
  recordedOnlyActions: string[];
  snapshot: UEEditorObservationSnapshot | null;
}

export interface EditorObservationService {
  refreshCapability(): UEEditorCapabilityStatus;
  discoverProcesses(input: EditorObservationDiscoveryInput): EditorObservationDiscoveryResult;
  attachProcess(input: UEEditorAttachRequest): EditorObservationAttachResult;
  readStatus(sessionId: string): EditorObservationStatusResult;
  readSnapshot(sessionId: string): EditorObservationSnapshotResult;
  stopSession(sessionId: string): EditorObservationStatusResult;
  createReplaySummary(sessionId: string): EditorObservationReplaySummary;
}

interface SessionRecord {
  session: UEEditorSession;
  process: UEEditorProcessDescriptor;
  lastHeartbeatAt: number | null;
  stopped: boolean;
}

interface ProcessRecord {
  process: UEEditorProcessDescriptor;
  projectId: string;
  rootId: string;
  uprojDisplayPath: string;
  expiresAt: number;
}

export function createEditorObservationService(options: EditorObservationServiceOptions): EditorObservationService {
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 120_000;
  const processes = new Map<string, ProcessRecord>();
  const sessions = new Map<string, SessionRecord>();
  let sequence = 0;

  function capability(): UEEditorCapabilityStatus {
    return {
      enabled: options.bridgeEnabled,
      mode: options.bridgeEnabled ? "fixture" : "disabled",
      reason: options.bridgeEnabled ? "fixture_ready" : "feature_disabled",
      trustedRootRequired: true,
      mutationExecution: "blocked",
    };
  }

  function expire(record: SessionRecord): boolean {
    if (now() <= record.session.expiresAt || record.stopped) return false;
    record.session = { ...record.session, status: "expired" };
    return true;
  }

  return {
    refreshCapability: capability,
    discoverProcesses(input) {
      if (!options.bridgeEnabled) return { status: "blocked", reason: "feature_disabled", processes: [] };
      const policy = evaluateEditorProcessPolicy({ ...input, trustedRootIds: options.trustedRootIds });
      if (policy.status === "blocked") return { status: "blocked", reason: policy.reason, processes: [] };
      if (input.source === "native") {
        return { status: "degraded", reason: "native_discovery_unavailable", processes: [] };
      }
      const discoveredAt = now();
      const process: UEEditorProcessDescriptor = {
        id: `process:${hash(`${input.projectId}:${input.rootId}:${input.uprojDisplayPath}`)}`,
        pidHash: `pid:${hash(`${input.projectId}:${input.rootId}:${input.uprojDisplayPath}`)}`,
        displayName: "UnrealEditor.exe",
        displayExecutableHash: "exe:fixture",
        displayProjectHint: input.uprojDisplayPath,
        processState: "running",
        discoveredAt,
        expiresAt: discoveredAt + ttlMs,
        source: "fixture",
      };
      processes.set(process.id, {
        process,
        projectId: input.projectId,
        rootId: input.rootId,
        uprojDisplayPath: input.uprojDisplayPath,
        expiresAt: process.expiresAt,
      });
      return { status: "ready", reason: null, processes: [process] };
    },
    attachProcess(input) {
      if (!options.bridgeEnabled) return { status: "blocked", reason: "feature_disabled", session: null };
      const processRecord = processes.get(input.processId);
      if (!processRecord) return { status: "degraded", reason: "process_not_found", session: null };
      const policy = evaluateEditorProcessPolicy({
        projectId: input.projectId,
        rootId: input.rootId,
        trustedRootIds: options.trustedRootIds,
        uprojDisplayPath: input.uprojDisplayPath,
      });
      if (policy.status === "blocked") return { status: "blocked", reason: policy.reason, session: null };
      if (now() > processRecord.expiresAt) {
        return { status: "blocked", reason: "process_descriptor_expired", session: null };
      }
      if (
        processRecord.projectId !== input.projectId ||
        processRecord.rootId !== input.rootId ||
        processRecord.uprojDisplayPath !== input.uprojDisplayPath
      ) {
        return { status: "blocked", reason: "pid_session_root_project_mismatch", session: null };
      }
      if (processRecord.process.processState !== "running") {
        return { status: "degraded", reason: "process_unavailable", session: null };
      }
      const createdAt = now();
      const mode: UEEditorSessionMode = input.mode === "launched" && options.launchEnabled ? "launched" : input.mode;
      const session: UEEditorSession = {
        sessionId: `editor-observation:${++sequence}`,
        projectId: input.projectId,
        rootId: input.rootId,
        uprojectDisplayPath: input.uprojDisplayPath,
        mode,
        status: mode === "launched" ? "launched" : "attached",
        createdAt,
        expiresAt: createdAt + ttlMs,
        replayOnly: false,
      };
      sessions.set(session.sessionId, { session, process: processRecord.process, lastHeartbeatAt: null, stopped: false });
      return { status: "attached", reason: null, session };
    },
    readStatus(sessionId) {
      const record = sessions.get(sessionId);
      if (!record) return { status: "blocked", reason: "session_not_found", heartbeat: null };
      if (expire(record)) return { status: "expired", reason: "session_expired", heartbeat: null };
      if (record.stopped) return { status: "blocked", reason: "local_observation_stopped", heartbeat: null };
      const checkedAt = now();
      record.lastHeartbeatAt = checkedAt;
      const heartbeat: UEEditorHeartbeat = {
        sessionId,
        processState: record.process.processState,
        statusReason: record.process.processState === "running" ? "heartbeat_ok" : "process_unavailable",
        processAlive: record.process.processState === "running",
        projectMatched: true,
        checkedAt,
      };
      return { status: heartbeat.processAlive ? "ready" : "degraded", reason: null, heartbeat };
    },
    readSnapshot(sessionId) {
      const record = sessions.get(sessionId);
      if (!record) return { status: "blocked", reason: "session_not_found", snapshot: null };
      if (expire(record)) return { status: "blocked", reason: "session_expired", snapshot: null };
      const snapshot: UEEditorObservationSnapshot = {
        sessionId,
        editorState: record.process.processState === "running" ? "attached" : "degraded",
        sessionState: record.stopped ? "stopped" : "active",
        projectMatched: true,
        processAlive: record.process.processState === "running",
        lastHeartbeatAt: record.lastHeartbeatAt,
        displayProject: record.session.uprojectDisplayPath,
        displayProcess: record.process.displayName,
        readOnlyDiagnostics: ["process metadata only", "Save All blocked", "MCP mutation default blocked"],
        createdAt: now(),
      };
      return { status: "ready", reason: null, snapshot };
    },
    stopSession(sessionId) {
      const record = sessions.get(sessionId);
      if (!record) return { status: "blocked", reason: "session_not_found", heartbeat: null };
      record.stopped = true;
      record.session = { ...record.session, status: "stopped" };
      return { status: "stopped", reason: "local_observation_stopped", heartbeat: null };
    },
    createReplaySummary(sessionId) {
      const snapshot = this.readSnapshot(sessionId).snapshot;
      return { sessionId, replayOnly: true, recordedOnlyActions: ["discover", "attach", "status", "snapshot"], snapshot };
    },
  };
}

function hash(value: string): string {
  let result = 0;
  for (let i = 0; i < value.length; i += 1) result = (result * 33 + value.charCodeAt(i)) >>> 0;
  return result.toString(16);
}
