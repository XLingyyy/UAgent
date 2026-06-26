import type { McpDiscoverySnapshot, TaskDraft } from "@uagent/shared";
import { createAgentLoopRuntime, type AgentLoopOptions } from "../agent-loop-runtime.js";
import { buildAgentRunTrace } from "../agent-run-recorder.js";
import { replayAgentRunTrace, type AgentRunReplaySummary } from "../agent-run-replay.js";

const baseDraft: TaskDraft = {
  input: "Review current selection",
  projectId: null,
  permissionMode: "request_approval",
  modelId: "not-configured",
  reasoningEffort: "medium",
  runMode: "local",
  branch: "main",
  contextPercent: 12,
  providerStatus: "not_configured",
  createdAt: 1_000,
};

export const agentTaskFixtures = {
  mockFallback: { ...baseDraft, input: "Review Lyra asset loading risks" },
  mcpCurrentSelection: { ...baseDraft, input: "current selection" },
  blockedDelete: { ...baseDraft, input: "delete current selection" },
  unknownIntent: { ...baseDraft, input: "optimize lighting blueprint" },
  failureInjection: { ...baseDraft, input: "Review current selection #fail" },
} satisfies Record<string, TaskDraft>;

export const mcpDiscoveryFixtures = {
  resourceFirst: {
    tools: [{ name: "ue.selection.get", description: "Read current editor selection" }],
    resources: [{ uri: "ue://selection/current", name: "Current selection" }],
    prompts: [],
    capabilitySummary: {
      tools: 1,
      resources: 1,
      prompts: 0,
      readOnlyTools: 1,
      blockedTools: 0,
    },
    discoveredAt: 1_000,
  },
  readOnlyToolOnly: {
    tools: [{ name: "ue.selection.get", description: "Read current editor selection" }],
    resources: [],
    prompts: [],
    capabilitySummary: {
      tools: 1,
      resources: 0,
      prompts: 0,
      readOnlyTools: 1,
      blockedTools: 0,
    },
    discoveredAt: 1_000,
  },
  blockedToolsOnly: {
    tools: [{ name: "ue.asset.delete", description: "Delete an asset from the project" }],
    resources: [],
    prompts: [],
    capabilitySummary: {
      tools: 1,
      resources: 0,
      prompts: 0,
      readOnlyTools: 0,
      blockedTools: 1,
    },
    discoveredAt: 1_000,
  },
  emptyDiscovery: {
    tools: [],
    resources: [],
    prompts: [],
    capabilitySummary: {
      tools: 0,
      resources: 0,
      prompts: 0,
      readOnlyTools: 0,
      blockedTools: 0,
    },
    discoveredAt: 1_000,
  },
} satisfies Record<string, McpDiscoverySnapshot>;

export interface RunAgentFixtureInput {
  draft: TaskDraft;
  discovery: McpDiscoverySnapshot | null;
  readResource?: AgentLoopOptions["readResource"];
  callTool?: AgentLoopOptions["callTool"];
}

export interface RunAgentFixtureResult {
  trace: ReturnType<typeof buildAgentRunTrace>;
  replay: AgentRunReplaySummary;
}

export async function runAgentFixture(input: RunAgentFixtureInput): Promise<RunAgentFixtureResult> {
  const runtime = createAgentLoopRuntime({
    runtimeMode: input.discovery ? "mcp-readonly" : "mock",
    discovery: input.discovery,
    clockStart: 2_000,
    readResource:
      input.readResource ??
      (async (uri) => ({
        uri,
        text: "StaticMeshActor_1",
      })),
    callTool: input.callTool,
  });
  const record = await runtime.submitTask(input.draft);
  const snapshot = runtime.getSnapshot();
  const trace = buildAgentRunTrace(snapshot.eventsByTaskId[record.id], snapshot.tasksById[record.id]);
  return {
    trace,
    replay: replayAgentRunTrace(trace),
  };
}
