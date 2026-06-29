import {
  createMockRuntime,
  parseBuildOutputToDiagnostics,
  type BuildOutputDiagnosticSummary,
  type MockRuntimeClient,
} from "@uagent/runtime";
import type {
  Mvp9RuntimeState,
  TerminalServiceState,
  BrowserServiceState,
  ScreenshotServiceState,
  WatcherServiceState,
  RealTerminalServiceState,
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
  RuntimeSnapshot,
  TaskDraft,
  UEProjectMetadata,
} from "@uagent/shared";

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

export interface RuntimeStoreState extends RuntimeSnapshot {
  mockOnlyWarning: string | null;
  mcp: McpConnectionState;
  mvp9: Mvp9RuntimeState;
  mvp11: Mvp11RuntimeState;
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
  };
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
