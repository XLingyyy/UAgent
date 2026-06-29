import { createMockRuntime, type MockRuntimeClient } from "@uagent/runtime";
import type {
  Mvp9RuntimeState,
  TerminalServiceState,
  BrowserServiceState,
  ScreenshotServiceState,
  WatcherServiceState,
  RealTerminalServiceState,
} from "@uagent/runtime";
import type { ApprovalDecisionValue, McpConnectionState, RuntimeSnapshot, TaskDraft } from "@uagent/shared";

export interface RuntimeStoreState extends RuntimeSnapshot {
  mockOnlyWarning: string | null;
  mcp: McpConnectionState;
  mvp9: Mvp9RuntimeState;
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
