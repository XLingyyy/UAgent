import type { ContextPackRedactionSummary } from "./ue-diagnostics.js";

export const UE_EDITOR_OPERATION_RISKS = [
  "read_only",
  "state_only",
  "text_backed_change",
  "medium_editor_state",
  "high_asset_risk",
  "blocked_asset_write",
  "blocked_unknown",
] as const;

export type UEEditorOperationRisk = (typeof UE_EDITOR_OPERATION_RISKS)[number];

export type UEEditorSessionMode = "fixture" | "attached" | "launched";
export type UEEditorSessionStatus =
  | "disabled"
  | "blocked"
  | "attaching"
  | "attached"
  | "launching"
  | "launched"
  | "stopped"
  | "expired"
  | "degraded";

export interface UEEditorCapabilityStatus {
  enabled: boolean;
  mode: "disabled" | "fixture" | "native";
  reason: string;
  trustedRootRequired: true;
  mutationExecution: "blocked" | "state_only";
}

export interface UEEditorSession {
  sessionId: string;
  projectId: string;
  rootId: string;
  uprojectDisplayPath: string;
  pidHash?: string | null;
  mode: UEEditorSessionMode;
  status: UEEditorSessionStatus;
  createdAt: number;
  expiresAt: number;
  replayOnly: boolean;
}

export type UEEditorOperationKind =
  | "status"
  | "open_asset"
  | "focus_content_browser"
  | "select_asset"
  | "run_read_only_validation"
  | "refresh_diagnostics"
  | "open_local_preview"
  | "patch_text_file"
  | "save_asset"
  | "delete_asset"
  | "rename_asset"
  | "move_asset"
  | "compile_blueprint"
  | string;

export type UEEditorOperationProposalStatus = "proposed" | "approval_required" | "approved" | "executed" | "cancelled" | "blocked" | "expired";

export interface UEEditorOperationProposal {
  proposalId: string;
  sessionId: string;
  projectId: string;
  rootId: string;
  operationKind: UEEditorOperationKind;
  argsHash: string;
  risk: UEEditorOperationRisk;
  status: UEEditorOperationProposalStatus;
  summary: string;
  redaction: ContextPackRedactionSummary;
  createdAt: number;
  expiresAt: number;
}

export interface UEEditorOperationApproval {
  token: string;
  proposalId: string;
  sessionId: string;
  projectId: string;
  rootId: string;
  operationKind: UEEditorOperationKind;
  argsHash: string;
  actor: string;
  reason: string;
  approvedAt: number;
  expiresAt: number;
}

export interface UEEditorOperationResult {
  proposalId: string;
  status: "executed" | "blocked" | "cancelled";
  outputSummary: string;
  durationMs: number;
  redaction: ContextPackRedactionSummary;
  evidenceId: string | null;
  executedAt: number;
  replayOnly: boolean;
  reason?: string;
}

export type UEEditorProcessState = "unknown" | "running" | "attached" | "exited" | "degraded";
export type UEEditorStatusReason =
  | "feature_disabled"
  | "launch_feature_disabled"
  | "fixture_ready"
  | "heartbeat_ok"
  | "process_unavailable"
  | "process_exited"
  | "process_not_found"
  | "process_descriptor_expired"
  | "pid_hash_mismatch"
  | "pid_session_root_project_mismatch"
  | "native_discovery_unavailable"
  | "native_process_observation_unavailable"
  | "platform_unsupported"
  | "session_not_found"
  | "session_expired"
  | "project_mismatch"
  | "root_mismatch"
  | "local_observation_stopped";

export interface UEEditorProcessDescriptor {
  id: string;
  pidHash: string;
  displayName: string;
  displayExecutableHash: string;
  displayProjectHint: string;
  processState: UEEditorProcessState;
  discoveredAt: number;
  expiresAt: number;
  source: "fixture" | "native" | "degraded";
}

export interface UEEditorAttachRequest {
  projectId: string;
  rootId: string;
  uprojDisplayPath: string;
  processId: string;
  mode: UEEditorSessionMode;
}

export interface UEEditorHeartbeat {
  sessionId: string;
  processState: UEEditorProcessState;
  statusReason: UEEditorStatusReason;
  processAlive: boolean;
  projectMatched: boolean;
  checkedAt: number;
}

export interface UEEditorObservationSnapshot {
  sessionId: string;
  editorState: UEEditorProcessState;
  sessionState: "active" | "blocked" | "expired" | "stopped" | "degraded" | "exited";
  projectMatched: boolean;
  processAlive: boolean;
  lastHeartbeatAt: number | null;
  displayProject: string;
  displayProcess: string;
  readOnlyDiagnostics: string[];
  createdAt: number;
}

export type UEEditorObservationEventType =
  | "editor_process_discovered"
  | "editor_attached"
  | "editor_heartbeat"
  | "editor_observation_snapshot"
  | "editor_session_expired"
  | "editor_process_exited";

export interface UEEditorObservationPayload {
  id?: string;
  displayPath?: string;
  displayCommand?: string;
  redactedArgs?: string[];
  hash?: string;
  summary?: string;
}

export interface UEEditorObservationEvent {
  type: UEEditorObservationEventType;
  sessionId: string | null;
  summary: string;
  payload: UEEditorObservationPayload;
  createdAt: number;
}

export interface UEEditorLaunchPolicy {
  enabled: boolean;
  reason: UEEditorStatusReason | "launch_allowed";
  allowlistedArgs: string[];
  blockedArgs: string[];
}
