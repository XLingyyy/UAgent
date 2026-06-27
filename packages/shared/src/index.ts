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
export type { ToolRiskClassification, ToolRiskLevel } from "./risk.js";
export type {
  RuntimeClient,
  RuntimeCommand,
  RuntimeSnapshot,
  RuntimeStatus,
} from "./runtime.js";
export { createEmptyRuntimeSnapshot } from "./runtime.js";
export type { ApprovalRequest, ApprovalRequestState } from "./approval.js";
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
