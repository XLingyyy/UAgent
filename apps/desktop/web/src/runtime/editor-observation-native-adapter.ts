import type {
  UEEditorCapabilityStatus,
  UEEditorHeartbeat,
  UEEditorObservationSnapshot,
  UEEditorProcessDescriptor,
  UEEditorSession,
  UEEditorStatusReason,
} from "@uagent/shared";
import { resolveTrustedNativeRootRef, type NativeInvoke } from "./project-native-adapter";

export interface NativeEditorObservationAdapter {
  refreshCapability: () => Promise<UEEditorCapabilityStatus>;
  discoverProcesses: (input: NativeEditorProcessConfigInput) => Promise<NativeEditorProcessDiscoveryResult>;
  validateAttachConfig: (input: NativeEditorProcessConfigInput) => Promise<NativeEditorAttachValidationResult>;
  attachProcess: (input: NativeEditorAttachInput) => Promise<UEEditorSession | null>;
  readStatus: (sessionId: string) => Promise<UEEditorHeartbeat | null>;
  readSnapshot: (sessionId: string) => Promise<UEEditorObservationSnapshot | null>;
  stopSession: (sessionId: string) => Promise<UEEditorSession | null>;
}

export interface NativeEditorProcessConfigInput {
  projectId: string;
  rootRef: string;
  uprojectRelativePath: string;
  editorExecutable?: string | null;
  args?: string[] | null;
}

export interface NativeEditorProcessDiscoveryResult {
  status: "ready" | "blocked" | "degraded";
  reason: string;
  processes: UEEditorProcessDescriptor[];
}

export interface NativeEditorAttachValidationResult {
  ok: boolean;
  reason: string;
  rootId: string | null;
  displayRoot: string;
  uprojectDisplayPath: string | null;
}

export interface NativeEditorAttachInput extends NativeEditorProcessConfigInput {
  processId: string;
  pidHash: string;
  processDisplayName: string;
  mode: "fixture" | "attached" | "launched";
}

interface NativeSessionResult {
  sessionId?: string | null;
  projectId: string;
  rootId?: string | null;
  uprojectDisplayPath?: string | null;
  pidHash?: string | null;
  mode: "fixture" | "attached" | "launched";
  status: UEEditorSession["status"];
  reason: string;
  createdAt: number;
  expiresAt: number;
  lastHeartbeatAt?: number | null;
  replayOnly: boolean;
}

function getGlobalInvoke(): NativeInvoke | null {
  const tauriInternals = (globalThis as { __TAURI_INTERNALS__?: { invoke?: NativeInvoke } }).__TAURI_INTERNALS__;
  return tauriInternals?.invoke ?? null;
}

export function createEditorObservationNativeAdapter(invoke: NativeInvoke): NativeEditorObservationAdapter {
  const withTrustedRoot = (input: NativeEditorProcessConfigInput): NativeEditorProcessConfigInput => ({
    ...input,
    rootRef: resolveTrustedNativeRootRef(input.rootRef) ?? input.rootRef,
  });

  return {
    async refreshCapability() {
      return invoke<UEEditorCapabilityStatus>("editor_observation_capability_status");
    },
    async discoverProcesses(input) {
      return invoke<NativeEditorProcessDiscoveryResult>("discover_editor_processes", { input: withTrustedRoot(input) });
    },
    async validateAttachConfig(input) {
      return invoke<NativeEditorAttachValidationResult>("validate_editor_attach_config", { input: withTrustedRoot(input) });
    },
    async attachProcess(input) {
      const result = await invoke<NativeSessionResult>("attach_editor_process", { input: withTrustedRoot(input) });
      return toSession(result);
    },
    async readStatus(sessionId) {
      const result = await invoke<NativeSessionResult>("read_editor_process_status", { input: { sessionId } });
      if (!result.sessionId) return null;
      const processAlive = result.reason === "heartbeat_ok" && result.status !== "expired" && result.status !== "stopped" && result.status !== "degraded";
      return {
        sessionId: result.sessionId,
        processState: processAlive ? "running" : "degraded",
        statusReason: result.reason as UEEditorStatusReason,
        processAlive,
        projectMatched: true,
        checkedAt: result.lastHeartbeatAt ?? Date.now(),
      };
    },
    async readSnapshot(sessionId) {
      return invoke<UEEditorObservationSnapshot>("read_editor_observation_snapshot", { input: { sessionId } });
    },
    async stopSession(sessionId) {
      const result = await invoke<NativeSessionResult>("stop_editor_observation_session", { input: { sessionId } });
      return toSession(result);
    },
  };
}

export function createEditorObservationNativeAdapterFromEnvironment(
  invoke: NativeInvoke | null = getGlobalInvoke(),
): NativeEditorObservationAdapter | null {
  return invoke ? createEditorObservationNativeAdapter(invoke) : null;
}

function toSession(result: NativeSessionResult): UEEditorSession | null {
  if (!result.sessionId || !result.rootId || !result.uprojectDisplayPath) return null;
  return {
    sessionId: result.sessionId,
    projectId: result.projectId,
    rootId: result.rootId,
    uprojectDisplayPath: result.uprojectDisplayPath,
    pidHash: result.pidHash ?? null,
    mode: result.mode,
    status: result.status,
    createdAt: result.createdAt,
    expiresAt: result.expiresAt,
    replayOnly: result.replayOnly,
  };
}
