export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: number;
}

export interface Command {
  id: string;
  type: "chat" | "tool" | "system";
  payload: unknown;
  timestamp: number;
}

export interface PlanItem {
  id: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  title: string;
  description: string;
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ToolCall {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed";
  startedAt: number;
  finishedAt: number | null;
  result: unknown | null;
  error: string | null;
}

export interface Evidence {
  id: string;
  type: "screenshot" | "log" | "artifact" | "metrics";
  source: string;
  data: unknown;
  capturedAt: number;
}

export interface WorkspaceState {
  messages: ChatMessage[];
  plan: PlanItem[];
  timeline: ToolCall[];
  evidence: Evidence[];
}

export type {
  PermissionMode,
  TaskDraft,
  TaskEvent,
  TaskEventLevel,
  TaskEventType,
  TaskRecord,
  TaskState,
} from "./task.js";
export {
  createEventId,
  createEvidenceId,
  createTaskId,
  createTaskTitle,
  isTerminalTaskState,
} from "./task.js";
export type { EvidenceKind, EvidenceRecord, EvidenceSource } from "./evidence.js";
export type {
  AgentActionType,
  AgentBlockedAction,
  AgentObservation,
  AgentObservationSource,
  AgentPlan,
  AgentPlanStep,
  AgentReport,
  AgentRunState,
  AgentStepAction,
  AgentStepKind,
  AgentStepStatus,
  AgentStepTarget,
} from "./agent.js";
export type {
  AgentRunTrace,
  AgentTraceEvent,
  AgentTraceEventType,
  AgentTraceStatus,
  AgentTraceStepSnapshot,
  AgentTraceSummary,
} from "./agent-trace.js";
export { createAgentTraceSummary } from "./agent-trace.js";
export type {
  McpCapabilitySummary,
  McpConnectionProfile,
  McpConnectionState,
  McpConnectionStatus,
  McpDiscoverySnapshot,
  McpPromptDescriptor,
  McpResourceDescriptor,
  McpServerInfo,
  McpToolDescriptor,
  McpTransportKind,
} from "./mcp.js";
export type { ToolRiskClassification, ToolRiskLevel, SafetyPolicy, PolicyDecision, RiskAssessment, WorkflowCapability } from "./risk.js";
export type {
  RuntimeClient,
  RuntimeCommand,
  RuntimeSnapshot,
  RuntimeStatus,
} from "./runtime.js";
export { createEmptyRuntimeSnapshot } from "./runtime.js";
export type {
  AssetIndexEntry,
  AssetIndexType,
  IndexLimitReason,
  IndexScanSummary,
  NativeRootKind,
  NativeRootTrustRecord,
  PathErrorCode,
  ProjectDirectoryEntry,
  ProjectEngineInfo,
  ProjectFileEntry,
  ProjectIndexNodeType,
  ProjectIndexSnapshot,
  ProjectIndexStatus,
  ProjectPathPolicyOptions,
  ProjectProfile,
  ProjectRootRef,
  ProjectRootValidationResult,
  ProjectTrustState,
  ReadOnlyFilesystemPolicy,
  ScanProgressEvent,
} from "./project.js";
export {
  DEFAULT_PROJECT_IGNORES,
  createDefaultReadOnlyFsPolicy,
  isInsideProjectRoot,
  isTextPreviewAllowed,
  normalizeProjectPath,
  redactPathForUi,
  shouldIgnoreProjectPath,
} from "./project.js";
export type {
  CapabilityDecision,
  CapabilityDecisionStatus,
  CapabilityKind,
  CapabilityMode,
  CapabilityRequest,
  CapabilityResult,
  CapabilityRuntimeEvent,
  ContentRedactionSummary,
  PreviewStatus,
  PreviewTruncation,
  SafeFilePreviewRequest,
  SafeFilePreviewResult,
} from "./capability.js";
export type {
  TerminalCommandRisk,
  TerminalCommandClassification,
  TerminalCommandProposal,
  TerminalProposalStatus,
  TerminalApprovalState,
  TerminalExecutionRequest,
  TerminalExitCode,
  TerminalExitState,
  TerminalOutputChunk,
  TerminalExecutionResult,
  TerminalExecutionCapabilityStatus,
  TerminalProposalAction,
} from "./terminal.js";
export type {
  BrowserPreviewCapabilityStatus,
  BrowserPreviewUrlPolicy,
  BrowserPreviewStatus,
  BrowserPreviewTargetSummary,
  BrowserPreviewRequest,
  BrowserPreviewResult,
  BrowserPreviewSession,
  ScreenshotCaptureStatus,
  ScreenshotCaptureRequest,
  ScreenshotCaptureResult,
  ScreenshotMetadata,
  PreviewArtifact,
  BrowserScreenshotAction,
} from "./browser-preview.js";
export type {
  WatcherStatus,
  WatcherStopReason,
  WatcherPolicy,
  ProjectWatchSession,
  ChangeKind,
  ChangeSource,
  ProjectChangeEvent,
  ProjectIndexDiffEntry,
  ProjectIndexDiff,
  WatcherEventBatch,
  WatcherAction,
} from "./project-watcher.js";

// MVP10 Terminal Execution Policy
export type {
  CommandAllowlistEntry,
  CommandDenyReason,
  CommandDenyResult,
  CommandAllowlistMatch,
  TerminalExecutionPolicy,
  MutationDetectionResult,
  MutationProof,
  BuildRunSummary,
  BuildCommandResult,
  ExecutionFeatureGate,
} from "./terminal-policy.js";

// MVP10 Approval Token
export type {
  ApprovalToken,
  ApprovalTokenStatus,
  ApprovalTokenRequest,
  ApprovalTokenValidator,
  ApprovalTokenAction,
} from "./approval-token.js";
export type { ApprovalRequest, ApprovalRequestState, ApprovalDecision, ApprovalDecisionValue, ApprovalState, ApprovalScope } from "./approval.js";
export type {
  ProviderCapability,
  ProviderConfig,
  ProviderMessageRole,
  ProviderNetworkMode,
  ProviderRedactedStatus,
  ProviderRuntimeErrorCode,
  ProviderRuntimeEvent,
  ProviderRuntimeError,
  ProviderRuntimeMessage,
  ProviderRuntimeRequest,
  ProviderRuntimeResponse,
  ProviderStreamChunk,
  ProviderUsage,
  ProviderWireApi,
} from "./provider-runtime.js";
export { createDefaultProviderConfig, redactProviderConfig } from "./provider-runtime.js";

// MVP5 Workflow & Safety types
export type { WorkflowEventType, WorkflowEvent, WorkflowPolicy } from "./workflow.js";
export type {
  SandboxMode,
  SandboxExecutionStatus,
  SandboxPolicy,
  SandboxExecutionRequest,
  SandboxExecutionResult,
  SandboxEvent,
} from "./sandbox.js";
export { createDefaultSandboxPolicy } from "./sandbox.js";
export type {
  ChangeSetState,
  ChangeOperationType,
  ChangeOperation,
  WorkspaceChangeSet,
  ChangeSetScope,
  ChangeSetEvent,
} from "./change-set.js";
export type {
  AuditEventType,
  AuditActor,
  AuditEvent,
  AuditProjection,
  AuditFilterSummary,
} from "./audit.js";
export type {
  SessionSummary,
  TaskHistoryEntry,
  ReplayCursor,
  ReplayFilter,
  ReplaySummary,
} from "./session.js";
