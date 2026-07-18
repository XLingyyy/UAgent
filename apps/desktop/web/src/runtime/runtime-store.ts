import {
  createMockRuntime,
  createAssetChangeSetService,
  createAssetManifestRegistry,
  createFixtureAssetMutationAdapter,
  parseBuildOutputToDiagnostics,
  type AssetChangeSetService,
  type AssetMutationReplaySummary,
  type BuildOutputDiagnosticSummary,
  type Mvp15McpAssetToolInventory,
  type MockRuntimeClient,
} from "@uagent/runtime";
import type {
  Mvp9RuntimeState,
  TerminalServiceState,
  BrowserServiceState,
  ScreenshotServiceState,
  WatcherServiceState,
  RealTerminalServiceState,
  EditorObservationDiscoveryResult,
  EditorObservationReplaySummary,
  EditorObservationSnapshotResult,
  EditorObservationStatusResult,
} from "@uagent/runtime";
import type {
  ApprovalDecisionValue,
  BuildDiagnostic,
  ContextPack,
  ContextPackRedactionSummary,
  DiagnosticKind,
  DiagnosticObservation,
  DiagnosticSeverity,
  McpConnectionState,
  ProjectDiagnostic,
  RepairProposal,
  RuntimeSnapshot,
  TaskDraft,
  TextMutationPolicy,
  UEEditorCapabilityStatus,
  UEEditorOperationProposal,
  UEEditorOperationResult,
  UEEditorSession,
  McpMutationDryRunResult,
  McpMutationProposal,
  AssetMutationPlan,
  AssetChangeSet,
  AssetDryRunResult,
  AssetExecutionResult,
  AssetManifestEntry,
  AssetVerificationResult,
  UEProjectMetadata,
  WorkspaceChangeSetV2,
} from "@uagent/shared";
import { createDefaultTextMutationPolicy } from "@uagent/shared";

export type Mvp11ActionStatus = "idle" | "running" | "completed" | "failed";

export interface Mvp11DiagnosticCounts {
  total: number;
  blocker: number;
  error: number;
  warning: number;
  info: number;
  byKind: Partial<Record<DiagnosticKind, number>>;
}

export interface Mvp11AffectedFileSummary {
  path: string;
  projectCount: number;
  buildCount: number;
  total: number;
  severities: DiagnosticSeverity[];
  kinds: DiagnosticKind[];
}

export interface Mvp11RuntimeState {
  metadataStatus: Mvp11ActionStatus;
  buildAnalysisStatus: Mvp11ActionStatus;
  contextPackStatus: Mvp11ActionStatus;
  metadata: UEProjectMetadata | null;
  projectDiagnostics: ProjectDiagnostic[];
  buildAnalysis: BuildOutputDiagnosticSummary | null;
  mcpObservations: DiagnosticObservation[];
  mcpDiagnostics: ProjectDiagnostic[];
  contextPack: ContextPack | null;
  redactionSummary: ContextPackRedactionSummary;
  affectedFiles: Record<string, Mvp11AffectedFileSummary>;
  diagnosticCounts: Mvp11DiagnosticCounts;
  terminalEvidenceSummary: string | null;
  analysisRequested: boolean;
  lastError: string | null;
}

export type Mvp12ActionStatus = "idle" | "running" | "completed" | "failed" | "blocked";
export type Mvp12FileMarker = "diagnostic" | "proposed" | "modified" | "verified" | "rollback_available";

export interface Mvp12CapabilityStatus {
  enabled: boolean;
  mode: "disabled" | "approval_required" | "fixture_only" | "native";
  reason: string;
  approvalRequired: boolean;
  allowedExtensions: string[];
  blockedDirectories: string[];
}

export interface Mvp12ChangedFileSummary {
  path: string;
  diagnosticCount: number;
  proposed: boolean;
  modified: boolean;
  verified: boolean;
  rollbackAvailable: boolean;
}

export interface Mvp12RuntimeState {
  capability: Mvp12CapabilityStatus;
  proposals: RepairProposal[];
  activeChangeSet: WorkspaceChangeSetV2 | null;
  applyStatus: Mvp12ActionStatus;
  verifyStatus: Mvp12ActionStatus;
  rollbackStatus: Mvp12ActionStatus;
  lastError: string | null;
  changedFiles: Record<string, Mvp12ChangedFileSummary>;
  fileMarkers: Record<string, Mvp12FileMarker[]>;
  evidenceIds: string[];
  auditFilters: {
    changeSetId: string | null;
    file: string | null;
    diagnosticId: string | null;
  };
}

export type Mvp13FileMarker = "affected" | "proposed" | "editor_opened" | "mutation_blocked";

export interface Mvp13RuntimeState {
  editorCapability: UEEditorCapabilityStatus;
  editorSession: UEEditorSession | null;
  editorProposals: UEEditorOperationProposal[];
  editorResults: UEEditorOperationResult[];
  mcpDryRuns: McpMutationDryRunResult[];
  mcpProposals: McpMutationProposal[];
  assetPlans: AssetMutationPlan[];
  replayOnly: boolean;
  evidenceIds: string[];
  auditFilters: {
    sessionId: string | null;
    operationId: string | null;
    changeSetId: string | null;
    toolName: string | null;
    affectedFile: string | null;
  };
  fileMarkers: Record<string, Mvp13FileMarker[]>;
  lastError: string | null;
}

export interface Mvp14RuntimeState {
  capability: UEEditorCapabilityStatus;
  discovery: EditorObservationDiscoveryResult | null;
  session: UEEditorSession | null;
  status: EditorObservationStatusResult | null;
  snapshot: EditorObservationSnapshotResult | null;
  replaySummary: EditorObservationReplaySummary | null;
  safetyBoundaries: string[];
  lastError: string | null;
}

export type Mvp15GateMode = "disabled" | "dry-run-only" | "sandbox-enabled" | "supervisor-local-smoke-required";
export type Mvp15AssetMarker = "sandbox_created" | "sandbox_modified" | "sandbox_deleted" | "rollback_available";

export interface Mvp15RuntimeState {
  gate: {
    mode: Mvp15GateMode;
    sandboxRoot: "/Game/UAgentSandbox";
    reason: string;
  };
  executionMode: "fixture" | "real" | "blocked_by_mcp_schema";
  sourceAssetPath: string | null;
  runId: string | null;
  mcpInventory: Mvp15McpAssetToolInventory | null;
  manifestEntries: AssetManifestEntry[];
  changeSets: AssetChangeSet[];
  activeChangeSet: AssetChangeSet | null;
  latestDryRun: AssetDryRunResult | null;
  latestExecution: AssetExecutionResult | null;
  latestVerification: AssetVerificationResult | null;
  replaySummary: AssetMutationReplaySummary | null;
  fileMarkers: Record<string, Mvp15AssetMarker[]>;
  lastError: string | null;
}

export interface RuntimeStoreState extends RuntimeSnapshot {
  mockOnlyWarning: string | null;
  mcp: McpConnectionState;
  mvp9: Mvp9RuntimeState;
  mvp11: Mvp11RuntimeState;
  mvp12: Mvp12RuntimeState;
  mvp13: Mvp13RuntimeState;
  mvp14: Mvp14RuntimeState;
  mvp15: Mvp15RuntimeState;
}

export interface RuntimeStoreActions {
  submitComposerTask: (draft: TaskDraft) => Promise<string>;
  cancelRuntimeTask: (taskId: string) => Promise<void>;
  submitApprovalDecision: (taskId: string, stepId: string | null, decision: ApprovalDecisionValue, actor: string, reason: string) => Promise<void>;
  setMcpEndpoint: (endpoint: string) => void;
  connectMcp: () => Promise<void>;
  discoverMcp: () => Promise<void>;
  disconnectMcp: () => void;
  proposeTerminalCommand: (command: string, cwd: string, taskId: string | null) => void;
  approveTerminalProposal: (proposalId: string, actor: string, reason: string) => Promise<void>;
  rejectTerminalProposal: (proposalId: string, actor: string, reason: string) => void;
  cancelTerminalExecution: (executionId: string) => void;
  resetTerminal: () => void;
  proposeMvp10TerminalCommand: (
    command: string,
    cwd: string,
    taskId: string | null,
    trustedRoot: string,
    projectId: string | null,
  ) => Promise<void>;
  approveMvp10TerminalProposal: (proposalId: string, actor: string, reason: string) => Promise<string | null>;
  rejectMvp10TerminalProposal: (proposalId: string, actor: string, reason: string) => void;
  cancelMvp10TerminalExecution: (executionId: string) => void;
  resetMvp10Terminal: () => void;
  analyzeBuildOutputEvidence: () => void;
  analyzeActiveProjectDiagnostics: () => Promise<void>;
  createMvp11ContextPack: () => void;
  resetMvp11Diagnostics: () => void;
  proposeRepairForDiagnostic: (diagnosticId: string) => Promise<void>;
  previewChangeSet: (proposalId: string) => Promise<void>;
  approveChangeSet: (changeSetId: string) => void;
  applyChangeSet: (changeSetId: string) => Promise<void>;
  runVerification: (changeSetId: string) => void;
  rollbackChangeSet: (changeSetId: string) => Promise<void>;
  discardChangeSet: (changeSetId: string) => void;
  requestBrowserPreview: (url: string, taskId: string | null, trustedRootRef?: string | null) => void;
  launchBrowserPreview: () => void;
  resetBrowser: () => void;
  requestScreenshotCapture: (scope: string, reason: string, taskId: string | null) => void;
  approveScreenshot: () => void;
  denyScreenshot: (reason: string) => void;
  resetScreenshot: () => void;
  startWatcher: (projectId: string, rootRef: string) => void;
  refreshWatcherCapability: () => Promise<void>;
  refreshWatcherSession: () => Promise<void>;
  generateWatcherChanges: (count: number) => void;
  computeWatcherDiff: () => void;
  applyWatcherChanges: () => void;
  rescanWatcher: () => void;
  stopWatcher: () => void;
  resetWatcher: () => void;
  refreshMvp13EditorCapability: () => void;
  attachMvp13FixtureEditorSession: () => void;
  proposeMvp13StateOnlyEditorOperation: () => void;
  approveMvp13EditorOperation: () => void;
  executeMvp13EditorOperation: () => void;
  cancelMvp13EditorOperation: () => void;
  runMvp13McpMutationDryRun: () => void;
  refreshMvp14ObservationCapability: () => void;
  discoverMvp14EditorProcesses: () => void;
  attachMvp14EditorProcess: () => void;
  readMvp14EditorStatus: () => void;
  readMvp14EditorSnapshot: () => void;
  stopMvp14ObservationSession: () => void;
  runMvp15AssetDryRun: (sourceAssetPath?: string) => void;
  approveMvp15AssetChangeSet: () => Promise<void>;
  executeMvp15AssetChangeSet: () => Promise<void>;
  verifyMvp15AssetChangeSet: () => Promise<void>;
  rollbackMvp15AssetChangeSet: () => Promise<void>;
}

export const DESKTOP_MOCK_RUNTIME_FLUSH_DELAY_MS = 500;

const EMPTY_REDACTION: ContextPackRedactionSummary = {
  replacedPaths: 0,
  replacedSecrets: 0,
  redacted: false,
};

export function createEmptyMvp11DiagnosticCounts(): Mvp11DiagnosticCounts {
  return { total: 0, blocker: 0, error: 0, warning: 0, info: 0, byKind: {} };
}

export function createEmptyMvp11State(): Mvp11RuntimeState {
  return {
    metadataStatus: "idle",
    buildAnalysisStatus: "idle",
    contextPackStatus: "idle",
    metadata: null,
    projectDiagnostics: [],
    buildAnalysis: null,
    mcpObservations: [],
    mcpDiagnostics: [],
    contextPack: null,
    redactionSummary: EMPTY_REDACTION,
    affectedFiles: {},
    diagnosticCounts: createEmptyMvp11DiagnosticCounts(),
    terminalEvidenceSummary: null,
    analysisRequested: false,
    lastError: null,
  };
}

function createMvp12Capability(policy: TextMutationPolicy = createDefaultTextMutationPolicy()): Mvp12CapabilityStatus {
  return {
    enabled: false,
    mode: "approval_required",
    reason: "controlled_text_mutation_requires_explicit_approval",
    approvalRequired: policy.approvalRequired,
    allowedExtensions: [...policy.allowedExtensions],
    blockedDirectories: [...policy.blockedDirectories],
  };
}

export function createEmptyMvp12State(): Mvp12RuntimeState {
  return {
    capability: createMvp12Capability(),
    proposals: [],
    activeChangeSet: null,
    applyStatus: "idle",
    verifyStatus: "idle",
    rollbackStatus: "idle",
    lastError: null,
    changedFiles: {},
    fileMarkers: {},
    evidenceIds: [],
    auditFilters: { changeSetId: null, file: null, diagnosticId: null },
  };
}

export function createEmptyMvp13State(): Mvp13RuntimeState {
  return {
    editorCapability: {
      enabled: false,
      mode: "disabled",
      reason: "feature_disabled",
      trustedRootRequired: true,
      mutationExecution: "blocked",
    },
    editorSession: null,
    editorProposals: [],
    editorResults: [],
    mcpDryRuns: [],
    mcpProposals: [],
    assetPlans: [],
    replayOnly: false,
    evidenceIds: [],
    auditFilters: {
      sessionId: null,
      operationId: null,
      changeSetId: null,
      toolName: null,
      affectedFile: null,
    },
    fileMarkers: {},
    lastError: null,
  };
}

export function createEmptyMvp14State(): Mvp14RuntimeState {
  return {
    capability: {
      enabled: false,
      mode: "disabled",
      reason: "feature_disabled",
      trustedRootRequired: true,
      mutationExecution: "blocked",
    },
    discovery: null,
    session: null,
    status: null,
    snapshot: null,
    replaySummary: null,
    safetyBoundaries: [
      "Save All blocked",
      "MCP mutation default blocked",
      "Replay recorded summaries only",
      "Trusted root required",
    ],
    lastError: null,
  };
}

export function createEmptyMvp15State(): Mvp15RuntimeState {
  return {
    gate: {
      mode: "sandbox-enabled",
      sandboxRoot: "/Game/UAgentSandbox",
      reason: "fixture sandbox asset mutation requires dry-run, approval, execute, verify, and rollback",
    },
    executionMode: "fixture",
    sourceAssetPath: null,
    runId: null,
    mcpInventory: null,
    manifestEntries: [],
    changeSets: [],
    activeChangeSet: null,
    latestDryRun: null,
    latestExecution: null,
    latestVerification: null,
    replaySummary: null,
    fileMarkers: {},
    lastError: null,
  };
}

export function createMvp12FileMarkers(state: Mvp12RuntimeState): Record<string, Mvp12FileMarker[]> {
  const markers: Record<string, Mvp12FileMarker[]> = {};
  for (const [path, summary] of Object.entries(state.changedFiles)) {
    const fileMarkers: Mvp12FileMarker[] = [];
    if (summary.diagnosticCount > 0) fileMarkers.push("diagnostic");
    if (summary.proposed) fileMarkers.push("proposed");
    if (summary.modified) fileMarkers.push("modified");
    if (summary.verified) fileMarkers.push("verified");
    if (summary.rollbackAvailable) fileMarkers.push("rollback_available");
    markers[path] = fileMarkers;
  }
  return markers;
}

export function createMvp13FileMarkers(state: Mvp13RuntimeState): Record<string, Mvp13FileMarker[]> {
  const markers: Record<string, Mvp13FileMarker[]> = {};
  for (const dryRun of state.mcpDryRuns) {
    for (const path of dryRun.affectedFiles) {
      const current = markers[path] ?? [];
      if (!current.includes("affected")) current.push("affected");
      if (dryRun.blockedReason || dryRun.assetRisk) current.push("mutation_blocked");
      markers[path] = [...new Set(current)];
    }
  }
  for (const proposal of state.editorProposals) {
    const current = markers[proposal.summary] ?? [];
    if (!current.includes("proposed")) current.push("proposed");
    markers[proposal.summary] = current;
  }
  for (const result of state.editorResults) {
    const current = markers[result.proposalId] ?? [];
    if (result.status === "executed" && !current.includes("editor_opened")) current.push("editor_opened");
    markers[result.proposalId] = current;
  }
  return markers;
}

export function refreshMvp12DerivedState(state: Mvp12RuntimeState): Mvp12RuntimeState {
  return {
    ...state,
    fileMarkers: createMvp12FileMarkers(state),
    evidenceIds: [
      ...new Set([
        ...state.evidenceIds,
        ...(state.activeChangeSet?.evidenceIds ?? []),
      ]),
    ],
  };
}

export function refreshMvp13DerivedState(state: Mvp13RuntimeState): Mvp13RuntimeState {
  return {
    ...state,
    fileMarkers: createMvp13FileMarkers(state),
    evidenceIds: [
      ...new Set([
        ...state.evidenceIds,
        ...state.editorResults.flatMap((result) => (result.evidenceId ? [result.evidenceId] : [])),
      ]),
    ],
  };
}

export function refreshMvp15DerivedState(state: Mvp15RuntimeState): Mvp15RuntimeState {
  const fileMarkers: Record<string, Mvp15AssetMarker[]> = {};
  for (const changeSet of state.changeSets) {
    for (const operation of changeSet.operations) {
      const path = operation.assetPathAfter ?? operation.assetPathBefore;
      if (!path) continue;
      const markers = fileMarkers[path] ?? [];
      if (operation.kind === "create_folder" || operation.kind === "duplicate_asset" || operation.kind === "create_test_asset") markers.push("sandbox_created");
      if (operation.kind === "rename_asset" || operation.kind === "move_asset" || operation.kind === "save_single_asset") markers.push("sandbox_modified");
      if (operation.kind === "delete_sandbox_asset") markers.push("sandbox_deleted");
      if (changeSet.state === "verified" || changeSet.state === "rollback_available") markers.push("rollback_available");
      fileMarkers[path] = [...new Set(markers)];
    }
  }
  return { ...state, fileMarkers };
}

export function mergeMvp11RedactionSummaries(
  ...summaries: Array<ContextPackRedactionSummary | null | undefined>
): ContextPackRedactionSummary {
  const replacedPaths = summaries.reduce((total, item) => total + (item?.replacedPaths ?? 0), 0);
  const replacedSecrets = summaries.reduce((total, item) => total + (item?.replacedSecrets ?? 0), 0);
  return {
    replacedPaths,
    replacedSecrets,
    redacted: replacedPaths + replacedSecrets > 0 || summaries.some((item) => item?.redacted),
  };
}

function countMvp11Diagnostics(
  projectDiagnostics: ProjectDiagnostic[],
  buildDiagnostics: BuildDiagnostic[],
): Mvp11DiagnosticCounts {
  const counts = createEmptyMvp11DiagnosticCounts();
  for (const diagnostic of [...projectDiagnostics, ...buildDiagnostics]) {
    counts.total += 1;
    counts[diagnostic.severity] += 1;
    counts.byKind[diagnostic.kind] = (counts.byKind[diagnostic.kind] ?? 0) + 1;
  }
  return counts;
}

function normalizedDisplayPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("[project-root]") || normalized.startsWith("[user-home]")) {
    return normalized;
  }
  return `[project-root]/${normalized.replace(/^\//, "")}`;
}

export function rootRelativeToDisplayPath(rootRelativePath: string): string {
  return normalizedDisplayPath(rootRelativePath) ?? "[project-root]";
}

export function createMvp11AffectedFileMap(
  projectDiagnostics: ProjectDiagnostic[],
  buildDiagnostics: BuildDiagnostic[],
): Record<string, Mvp11AffectedFileSummary> {
  const affected: Record<string, Mvp11AffectedFileSummary> = {};

  function add(path: string | null | undefined, diagnostic: ProjectDiagnostic | BuildDiagnostic, source: "project" | "build") {
    const displayPath = normalizedDisplayPath(path);
    if (!displayPath) return;
    const current =
      affected[displayPath] ??
      {
        path: displayPath,
        projectCount: 0,
        buildCount: 0,
        total: 0,
        severities: [],
        kinds: [],
      };
    if (source === "project") current.projectCount += 1;
    if (source === "build") current.buildCount += 1;
    current.total += 1;
    if (!current.severities.includes(diagnostic.severity)) current.severities.push(diagnostic.severity);
    if (!current.kinds.includes(diagnostic.kind)) current.kinds.push(diagnostic.kind);
    affected[displayPath] = current;
  }

  for (const diagnostic of projectDiagnostics) add(diagnostic.displayPath, diagnostic, "project");
  for (const diagnostic of buildDiagnostics) add(diagnostic.displayPath, diagnostic, "build");
  return affected;
}

export function refreshMvp11DerivedState(state: Mvp11RuntimeState): Mvp11RuntimeState {
  const allProjectDiagnostics = [...state.projectDiagnostics, ...state.mcpDiagnostics];
  const buildDiagnostics = state.buildAnalysis?.diagnostics ?? [];
  return {
    ...state,
    diagnosticCounts: countMvp11Diagnostics(allProjectDiagnostics, buildDiagnostics),
    affectedFiles: createMvp11AffectedFileMap(allProjectDiagnostics, buildDiagnostics),
    redactionSummary: mergeMvp11RedactionSummaries(
      state.metadata?.redaction,
      state.buildAnalysis?.redaction,
      state.contextPack?.redaction,
    ),
  };
}

function createEmptyMvp9State(): Mvp9RuntimeState {
  const emptyTerminal: TerminalServiceState = {
    proposals: [], activeProposal: null, approvalState: null, executionResult: null, stage: "idle",
  };
  const emptyBrowser: BrowserServiceState = {
    request: null, session: null, artifact: null, stage: "idle", blockedReason: null,
    capability: {
      enabled: false,
      mode: "disabled",
      reason: "native_browser_unavailable",
      localhostAllowed: true,
      loopbackAllowed: true,
      fileAllowed: true,
      externalBlocked: true,
    },
    lastError: null,
  };
  const emptyScreenshot: ScreenshotServiceState = {
    request: null, result: null, stage: "idle", evidence: null,
  };
  const emptyWatcher: WatcherServiceState = {
    session: null,
    events: [],
    diff: null,
    stage: "idle",
    stopReason: null,
    overflowed: false,
    dirty: false,
    queuedCount: 0,
    lastError: null,
    capability: {
      enabled: false,
      mode: "fixture",
      reason: "native_watcher_unavailable",
      trustedRootRequired: true,
      debounceMs: 500,
      maxQueueSize: 10000,
      overflowAction: "warn",
      readDiffOnly: true,
    },
  };
  const emptyMvp10Terminal: RealTerminalServiceState = {
    proposals: [],
    activeProposal: null,
    approvalState: null,
    token: null,
    executionResult: null,
    stage: "idle",
    capability: {
      enabled: false,
      mode: "disabled",
      reason: "native_terminal_unavailable",
      allowlistSummary: "MVP10 verification commands only",
      trustedRootRequired: true,
      approvalRequired: true,
      timeoutMs: 60_000,
      outputLimitBytes: 1_048_576,
      outputLimitLines: 5_000,
    },
  };
  return {
    terminal: emptyTerminal,
    browser: emptyBrowser,
    screenshot: emptyScreenshot,
    watcher: emptyWatcher,
    mvp10: { terminal: emptyMvp10Terminal },
  };
}

export function createRuntimeStoreState(snapshot: RuntimeSnapshot): RuntimeStoreState {
  return {
    ...snapshot,
    mockOnlyWarning: null,
    mcp: {
      status: "disconnected",
      profile: {
        id: "local-unreal-mcp",
        name: "Local Unreal MCP",
        endpoint: "http://127.0.0.1:8765/mcp",
        transport: "streamable-http",
      },
      protocolVersion: null,
      serverInfo: null,
      capabilities: null,
      lastError: null,
      legacyMode: false,
    },
    mvp9: createEmptyMvp9State(),
    mvp11: createEmptyMvp11State(),
    mvp12: createEmptyMvp12State(),
    mvp13: createEmptyMvp13State(),
    mvp14: createEmptyMvp14State(),
    mvp15: createEmptyMvp15State(),
  };
}

export function createMvp15FixtureService(): AssetChangeSetService {
  return createAssetChangeSetService({
    manifest: createAssetManifestRegistry(),
    adapter: createFixtureAssetMutationAdapter(),
  });
}

export function analyzeRecordedBuildOutput(state: RuntimeStoreState): RuntimeStoreState {
  const output = state.mvp9.mvp10.terminal.executionResult?.outputSummary ?? "";
  if (!output.trim()) {
    return {
      ...state,
      mvp11: {
        ...refreshMvp11DerivedState({
          ...state.mvp11,
          buildAnalysis: {
            diagnostics: [],
            errorCount: 0,
            warningCount: 0,
            topIssues: [],
            nextChecks: ["No recorded terminal output is available for analysis."],
            outputSummary: "",
            outputTruncated: false,
            rawOutputStored: false,
            redaction: { replacedPaths: 0, replacedSecrets: 0, redacted: false },
          },
          buildAnalysisStatus: "completed",
          terminalEvidenceSummary: null,
          analysisRequested: true,
          lastError: null,
        }),
      },
    };
  }
  const summary = parseBuildOutputToDiagnostics({
    output,
    createdAt: Date.now(),
  });
  return {
    ...state,
    mvp11: {
      ...refreshMvp11DerivedState({
        ...state.mvp11,
        buildAnalysis: summary,
        buildAnalysisStatus: "completed",
        terminalEvidenceSummary: summary.outputSummary,
        analysisRequested: true,
        lastError: null,
      }),
    },
  };
}

export function createDesktopMockRuntimeClient(): MockRuntimeClient {
  return createMockRuntime({ clockStart: 1_000, autoFlush: false });
}

export function getRuntimeTaskIds(state: RuntimeStoreState): string[] {
  return Object.keys(state.tasksById).sort(
    (left, right) => state.tasksById[right].updatedAt - state.tasksById[left].updatedAt,
  );
}
