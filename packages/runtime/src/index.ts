import type { PlanItem, Evidence, ChatMessage, ToolCall } from "@uagent/shared";
export { createMockRuntime, type MockRuntimeClient, type MockRuntimeOptions } from "./mock-runtime.js";
export { classifyMcpToolRisk, isRiskAllowed } from "./mcp-readonly-policy.js";
export { createSemanticCapabilityIndex, type McpResolvedIntent, type SemanticCapabilityIndex } from "./mcp-semantic-index.js";
export {
  DeterministicPlanner,
  type DeterministicPlannerOptions,
  type Planner,
  type PlannerInput,
} from "./agent-planner.js";
export {
  selectAction,
  type AgentAction,
  type AgentActionSelectorContext,
} from "./agent-action-selector.js";
export {
  createAgentLoopRuntime,
  type AgentLoopContextUpdate,
  type AgentLoopOptions,
  type AgentLoopRuntimeClient,
} from "./agent-loop-runtime.js";
export {
  createEvidenceFromObservation,
  normalizeObservation,
  summarizePayload,
  type NormalizeObservationInput,
} from "./agent-observation.js";
export {
  createAgentReport,
  type CreateAgentReportInput,
} from "./agent-report.js";
export { buildAgentRunTrace } from "./agent-run-recorder.js";
export { replayAgentRunTrace, type AgentRunReplaySummary } from "./agent-run-replay.js";
export { buildPromptEnvelope, type BuildPromptEnvelopeInput, type PromptEnvelope } from "./prompt/prompt-builder.js";
export { buildContextPack, buildToolPolicyPack, type PromptProviderMetadata } from "./prompt/context-pack.js";
export type { ProviderAdapter } from "./provider/provider-adapter.js";
export {
  buildProviderRuntimeRequest,
  type BuildProviderRuntimeRequestInput,
} from "./provider/provider-request-builder.js";
export {
  createProviderRuntimeError,
  normalizeProviderError,
} from "./provider/provider-error.js";
export {
  runProviderComplete,
  runProviderStream,
  type ProviderCompleteResult,
  type ProviderExecutionOptions,
  type ProviderStreamResult,
} from "./provider/provider-runner.js";
export {
  FailingProvider,
  MockStreamingProvider,
  MockTextProvider,
} from "./provider/mock-provider.js";
export { ProviderRegistry, type ProviderRegistration, type ProviderRegistryValidationResult } from "./provider/provider-registry.js";
export { OpenAICompatibleAdapter, type OpenAICompatibleAdapterOptions } from "./provider/openai-compatible-adapter.js";
export { createMcpReadOnlyRuntime, type McpReadOnlyRuntimeClient, type McpReadOnlyRuntimeOptions } from "./mcp-readonly-runtime.js";
export { createProviderHttpTransport, type ProviderHttpRequest, type ProviderHttpResponse, type ProviderHttpTransport, type ProviderHttpTransportOptions } from "./provider/provider-http-transport.js";
export { createRuntimeRouter, type RuntimeRouterOptions } from "./runtime-router.js";
export { assessToolRiskLevel, evaluateApprovalPolicy } from "./approval-policy.js";
export {
  createApprovalGate,
  type ApprovalGate,
  type ApprovalGateState,
  type ApprovalGateDecisionInput,
  type ApprovalRequestInput,
} from "./approval-gate.js";
export { applyTaskEvent, reduceTaskEvents } from "./task-event-reducer.js";
export { createChangeSet, applyChangeSetEvent, reduceChangeSetEvents, type CreateChangeSetInput } from "./change-set-reducer.js";
export { createFixtureChangeSetAdapter, type FixtureChangeSetAdapter, type ChangeSetOperationResult } from "./fixture-changeset.js";
export { InMemorySecretStore, type SecretStore } from "./secrets/secret-store.js";
export { redactSecret, redactErrorMessage, createRedactedString } from "./secrets/redaction.js";
export { createProviderFixtureScenario, type ProviderFixtureScenario } from "./provider/fixtures/index.js";
export {
  evaluateSandboxPolicy,
  createFixtureSandboxPolicy,
  DEFAULT_BLOCKED_CAPABILITIES,
} from "./sandbox-policy.js";
export {
  createFixtureSandboxAdapter,
  type FixtureSandboxAdapter,
  type FixtureSandboxResult,
  type FixtureResultMode,
} from "./fixture-sandbox.js";
export { emitSandboxEvent } from "./sandbox-bridge.js";
export { AnthropicCompatibleAdapter, type AnthropicCompatibleAdapterOptions } from "./provider/anthropic-compatible-adapter.js";
export { extractProviderTraceSummary, formatProviderTraceSummary, type ProviderTraceSummary } from "./provider/provider-trace.js";
export { mapProviderRuntimeEvent, type ProviderEventMappingResult } from "./provider/provider-event-bridge.js";
export { runProviderScenarioMatrix, type Mvp4ScenarioMatrixResult, type Mvp4ScenarioResult } from "./provider/mvp4-scenarios.js";

export {
  BUILD_TEMPLATES,
  findBuildTemplate,
  getBuildTemplatesByCategory,
  getAcceptanceChecklistTemplates,
  createBuildRun,
  nextBuildRunId,
  type BuildCommandTemplate,
  type BuildRun,
  type BuildCommandRun,
  type BuildRunRequest,
} from "./mvp10-build-templates.js";
export { classifyTerminalCommandRisk, isProposalExecutable, createAllowlistTerminalPolicy } from "./mvp9-terminal-policy.js";
export {
  parseCommand,
  classifyMvp10TerminalCommand,
  isAllowlistedCommand,
  detectDeniedCommand,
  sanitizeTerminalEnv,
  detectMutation,
  getDefaultExecutionLimits,
  MVP10_ALLOWLIST,
  MVP10_DENYLIST_COMMANDS,
} from "./mvp10-terminal-policy.js";
export type { TerminalCommandClassification } from "@uagent/shared";
export { createApprovalTokenService, issueApprovalToken, validateApprovalToken, useApprovalToken, revokeApprovalToken, getApprovalToken } from "./mvp10-approval-token.js";
export {
  createRealTerminalService,
  createRealTerminalServiceWithOptions,
  type RealTerminalAdapter,
  type RealTerminalService,
  type RealTerminalServiceState,
  type RealTerminalStage,
} from "./mvp10-terminal-service.js";
export {
  runMvp10ScenarioMatrix,
  type Mvp10Scenario,
} from "./mvp10-scenarios.js";
export { createFixtureTerminalAdapter, type FixtureTerminalAdapter } from "./mvp9-terminal-adapter.js";
export { classifyBrowserUrl, createFixtureBrowserPreviewAdapter, createFixtureScreenshotAdapter } from "./mvp9-browser-screenshot.js";
export type { FixtureBrowserPreviewAdapter, FixtureScreenshotAdapter, NativeBrowserAdapter } from "./mvp9-browser-screenshot.js";
export { createDefaultWatcherPolicy, isRootAllowedForWatch, computeProjectIndexDiff, createFixtureWatcherAdapter, debounceWatcherEvents } from "./mvp9-project-watcher.js";
export type { FixtureWatcherAdapter, NativeWatcherAdapter, WatcherCapabilityStatus } from "./mvp9-project-watcher.js";
export { runMvp9ScenarioMatrix, type Mvp9ScenarioMatrixResult, type Mvp9ScenarioResult } from "./mvp9-scenarios.js";
export { createTerminalService, type TerminalService, type TerminalServiceState, type TerminalStage } from "./mvp9-terminal-service.js";
export { createBrowserService, type BrowserService, type BrowserServiceState, type BrowserStage } from "./mvp9-browser-service.js";
export { createScreenshotService, type ScreenshotService, type ScreenshotServiceState, type ScreenshotStage } from "./mvp9-screenshot-service.js";
export { createWatcherService, type WatcherService, type WatcherServiceState, type WatcherStage } from "./mvp9-watcher-service.js";
export { createMvp9RuntimeService, type Mvp9RuntimeService, type Mvp9RuntimeServiceOptions, type Mvp9RuntimeState } from "./mvp9-runtime-service.js";
export { createMvp10RuntimeService, type Mvp10RuntimeService, type Mvp10RuntimeServiceOptions, type Mvp10RuntimeServiceState } from "./mvp10-runtime-service.js";

export {
  createAuditProjection,
  buildAuditFromTaskEvents,
  type AuditProjectionEngine,
  type AuditQuery,
} from "./audit-projection.js";
export {
  createSessionHistory,
  type SessionHistoryEngine,
  type TaskHistoryFilter,
  type ReplayResult,
} from "./session-history.js";
export { runMvp5ScenarioMatrix, type Mvp5ScenarioMatrixResult, type Mvp5ScenarioResult } from "./mvp5-scenarios.js";
export {
  createCapabilityBridge,
  createFixtureProjectRegistry,
  createProjectIndexer,
  createSafeFilePreviewer,
  runMvp7ScenarioMatrix,
  type CapabilityBridge,
  type Mvp7ScenarioMatrixResult,
  type Mvp7ScenarioResult,
  type ProjectIndexerService,
  type ProjectRegistryService,
  type SafeFilePreviewer,
} from "./mvp7-project-index.js";
export {
  createMvp8FixtureProjectRegistry,
  createMvp8ProjectIndexer,
  createMvp8SafeFilePreviewer,
  createMvp8CapabilityBridge,
  runMvp8ScenarioMatrix,
  type Mvp8ScenarioMatrixResult,
  type Mvp8ScenarioResult,
} from "./mvp8-project-index.js";
export {
  createContextPackV1,
  createMcpDiagnosticBridge,
  createUEProjectDiagnosticsEngine,
  parseBuildOutputToDiagnostics,
  parseUEProjectMetadata,
  runMvp11ScenarioMatrix,
  type BuildOutputDiagnosticSummary,
  type BuildOutputParseInput,
  type CreateContextPackV1Input,
  type McpDiagnosticBridgeOptions,
  type McpDiagnosticCollection,
  type Mvp11ScenarioMatrixResult,
  type Mvp11ScenarioResult,
  type ParseUEProjectMetadataInput,
  type ProjectDiagnosticsInput,
} from "./ue-diagnostics.js";
export {
  classifyTextMutationTarget,
  createChangeSetServiceV2,
  createRepairProposalEngine,
  createSha256Hash,
  redactMvp12Text,
  renderUnifiedDiff,
  runMvp12ScenarioMatrix,
  type ChangeSetServiceV2Options,
  type DiffInput,
  type DiffResult,
  type Mvp12ScenarioMatrixResult,
  type Mvp12ScenarioResult,
  type ReplayChangeSetSummary,
  type RepairProposalEngineInput,
  type TextMutationTargetClassification,
  type VerifyChangeSetInput,
} from "./mvp12-change-set.js";

export type AgentStatus = "idle" | "thinking" | "acting" | "waiting" | "finished" | "error";

export interface AgentState {
  status: AgentStatus;
  currentTaskId: string | null;
  plan: PlanItem[];
  evidence: Evidence[];
  history: ChatMessage[];
  toolCalls: ToolCall[];
  startedAt: number | null;
  finishedAt: number | null;
}

export function createInitialState(): AgentState {
  return {
    status: "idle",
    currentTaskId: null,
    plan: [],
    evidence: [],
    history: [],
    toolCalls: [],
    startedAt: null,
    finishedAt: null,
  };
}

export type AgentTransition =
  | { type: "START"; taskId: string }
  | { type: "THINK" }
  | { type: "ACT" }
  | { type: "WAIT" }
  | { type: "FINISH" }
  | { type: "ERROR"; error: string };

export function reduceAgentState(state: AgentState, transition: AgentTransition): AgentState {
  const timestamp = Date.now();
  switch (transition.type) {
    case "START":
      return {
        ...state,
        status: "thinking",
        currentTaskId: transition.taskId,
        startedAt: timestamp,
      };
    case "THINK":
      return { ...state, status: "thinking" };
    case "ACT":
      return { ...state, status: "acting" };
    case "WAIT":
      return { ...state, status: "waiting" };
    case "FINISH":
      return { ...state, status: "finished", finishedAt: timestamp };
    case "ERROR":
      return { ...state, status: "error", finishedAt: timestamp };
    default:
      return state;
  }
}
