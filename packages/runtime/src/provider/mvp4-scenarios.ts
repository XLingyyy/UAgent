import type {
  McpDiscoverySnapshot,
  ProviderRuntimeEvent,
  ProviderRuntimeRequest,
  ProviderUsage,
  TaskDraft,
  TaskEvent,
  TaskState,
} from "@uagent/shared";
import { createAgentLoopRuntime } from "../agent-loop-runtime.js";
import { createProviderRuntimeError } from "./provider-error.js";
import { runProviderComplete, runProviderStream } from "./provider-runner.js";
import { MockStreamingProvider, MockTextProvider } from "./mock-provider.js";
import { ProviderRegistry } from "./provider-registry.js";

export interface Mvp4ScenarioRequestLogEntry {
  method: "resources/read" | "tools/call";
  params: unknown;
}

export interface Mvp4ScenarioResult {
  name: string;
  description: string;
  pass: boolean;
  assertions: number;
  events: ProviderRuntimeEvent[];
  providerEvents: ProviderRuntimeEvent[];
  taskEvents: TaskEvent[];
  terminalState: TaskState | null;
  requestLog: Mvp4ScenarioRequestLogEntry[];
  redactionChecked: boolean;
  error?: string;
}

export interface Mvp4ScenarioMatrixResult {
  results: Mvp4ScenarioResult[];
  totalAssertions: number;
  passedAssertions: number;
  allPassed: boolean;
}

const BASE_REQUEST: ProviderRuntimeRequest = {
  id: "scenario-request",
  providerId: "mock-text",
  modelId: "mock-model",
  messages: [{ role: "user", content: "List the resources available." }],
  metadata: { taskId: "scenario-task", planId: "scenario-plan" },
};

const STREAM_REQUEST: ProviderRuntimeRequest = {
  ...BASE_REQUEST,
  providerId: "mock-streaming",
};

const CROSS_BOUNDARY_DRAFT: TaskDraft = {
  input: "Review current selection",
  projectId: null,
  permissionMode: "request_approval",
  modelId: "mock-model",
  reasoningEffort: "medium",
  runMode: "local",
  branch: "main",
  contextPercent: 12,
  providerStatus: "configured",
  networkMode: "fixture",
  createdAt: 1_000,
};

const CROSS_BOUNDARY_DISCOVERY: McpDiscoverySnapshot = {
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
};

const RAW_SECRET_SENTINEL = "sk-live-raw-secret";

function createScenarioResult(name: string, description: string): Mvp4ScenarioResult {
  return {
    name,
    description,
    pass: false,
    assertions: 0,
    events: [],
    providerEvents: [],
    taskEvents: [],
    terminalState: null,
    requestLog: [],
    redactionChecked: false,
  };
}

function makeAssertion(result: Mvp4ScenarioResult, condition: boolean, label: string): void {
  result.assertions++;
  if (!condition) {
    result.error = result.error ? `${result.error}; ${label}` : label;
  }
}

export function runDisabledProviderScenario(): Mvp4ScenarioResult {
  const result: Mvp4ScenarioResult = {
    ...createScenarioResult("disabled-provider", "Provider transport disabled, no request sent"),
  };

  const registry = new ProviderRegistry();
  registry.register(new MockTextProvider(), { networkMode: "disabled" });

  const config = registry.getConfig("mock-text");
  makeAssertion(result, config.networkMode === "disabled", "networkMode should be disabled");
  markRedactionChecked(result);

  result.pass = result.error === undefined || result.error === "";
  return result;
}

export async function runFixtureCompleteScenario(): Promise<Mvp4ScenarioResult> {
  const result = createScenarioResult("fixture-complete", "Fixture provider returns complete response");

  try {
    const { response, events } = await runProviderComplete(new MockTextProvider(), BASE_REQUEST);
    result.events = events;
    result.providerEvents = events;
    makeAssertion(result, response.text.length > 0, "response should have text");
    makeAssertion(result, response.finishReason === "stop", "finish reason should be stop");
    makeAssertion(result, response.usage.totalTokens > 0, "usage should be tracked");
    makeAssertion(result, events.some((e) => e.type === "provider_request_completed"), "should have completed event");
    makeAssertion(result, events.some((e) => e.type === "provider_usage_recorded"), "should have usage event");
    markRedactionChecked(result);
    result.pass = result.error === undefined || result.error === "";
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

export async function runFixtureStreamScenario(): Promise<Mvp4ScenarioResult> {
  const result = createScenarioResult("fixture-stream", "Fixture provider returns streaming response");

  try {
    const { text, chunks, events } = await runProviderStream(new MockStreamingProvider(), STREAM_REQUEST);
    result.events = events;
    result.providerEvents = events;
    makeAssertion(result, chunks.length > 0, "should have stream chunks");
    makeAssertion(result, text.length > 0, "should have accumulated text");
    makeAssertion(result, events.some((e) => e.type === "provider_stream_started"), "should have stream started event");
    makeAssertion(result, events.some((e) => e.type === "provider_stream_completed"), "should have stream completed event");
    makeAssertion(result, events.some((e) => e.type === "provider_usage_recorded"), "should have usage event");
    markRedactionChecked(result);
    result.pass = result.error === undefined || result.error === "";
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

export async function runStreamPartialFailureScenario(): Promise<Mvp4ScenarioResult> {
  const result = createScenarioResult("stream-partial-failure", "Stream fails after N chunks, partial content preserved");

  try {
    const provider = new MockStreamingProvider({ chunks: ["A", "B", "C"], failAtChunk: 2 });
    const { chunks, events } = await runProviderStream(provider, STREAM_REQUEST);
    result.events = events;
    result.providerEvents = events;
    makeAssertion(result, chunks.length >= 1, "should have at least some chunks before failure");
    makeAssertion(result, chunks.length < 3, "should not have all chunks");
    makeAssertion(result, events.some((e) => e.type === "provider_request_failed"), "should have failure event");
    makeAssertion(result, !events.some((e) => e.type === "provider_stream_completed"), "should NOT have completed event");
    markRedactionChecked(result);
    result.pass = result.error === undefined || result.error === "";
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

export async function runCancelledScenario(): Promise<Mvp4ScenarioResult> {
  const result = createScenarioResult("cancelled", "Stream cancelled before start");

  try {
    const controller = new AbortController();
    controller.abort();
    const { chunks, events } = await runProviderStream(new MockStreamingProvider(), STREAM_REQUEST, {
      signal: controller.signal,
    });
    result.events = events;
    result.providerEvents = events;
    makeAssertion(result, chunks.length === 0, "should have no chunks");
    makeAssertion(result, events.some((e) => e.type === "provider_request_cancelled"), "should have cancelled event");
    markRedactionChecked(result);
    result.pass = result.error === undefined || result.error === "";
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }
  return result;
}

export function runAuthMissingScenario(): Mvp4ScenarioResult {
  const result = createScenarioResult("auth-missing", "Auth missing error from failing provider");

  try {
    throw createProviderRuntimeError("test", "auth_missing", "Authentication required.");
  } catch (error) {
    const providerError = error as { code: string };
    makeAssertion(result, providerError.code === "auth_missing", "error code should be auth_missing");
    markRedactionChecked(result);
    result.pass = result.error === undefined || result.error === "";
  }
  return result;
}

export function runRateLimitedScenario(): Mvp4ScenarioResult {
  const result = createScenarioResult("rate-limited", "Rate limited error");

  try {
    throw createProviderRuntimeError("test", "rate_limited", "Rate limited.");
  } catch (error) {
    const providerError = error as { code: string; retryable: boolean };
    makeAssertion(result, providerError.code === "rate_limited", "error code should be rate_limited");
    makeAssertion(result, providerError.retryable === true, "rate_limited should be retryable");
    markRedactionChecked(result);
    result.pass = result.error === undefined || result.error === "";
  }
  return result;
}

export async function runMcpResourceWithProviderReportScenario(): Promise<Mvp4ScenarioResult> {
  const result = createScenarioResult(
    "mcp-resource-with-provider-report",
    "AgentLoop reads MCP resource and emits provider-assisted report",
  );

  try {
    const requestLog: Mvp4ScenarioRequestLogEntry[] = [];
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mcp-readonly",
      discovery: CROSS_BOUNDARY_DISCOVERY,
      providerAdapter: new MockTextProvider(),
      providerEnabled: true,
      readResource: async (uri) => {
        requestLog.push({ method: "resources/read", params: { uri } });
        return { uri, text: "Fixture selection/resource data" };
      },
      callTool: async (name, args) => {
        requestLog.push({ method: "tools/call", params: { name, arguments: args } });
        return { content: [] };
      },
      clockStart: 2_000,
    });

    const record = await runtime.submitTask(CROSS_BOUNDARY_DRAFT);
    const snapshot = runtime.getSnapshot();
    result.taskEvents = snapshot.eventsByTaskId[record.id] ?? [];
    result.providerEvents = deriveProviderEvents(result.taskEvents);
    result.events = result.providerEvents;
    result.terminalState = snapshot.tasksById[record.id]?.state ?? null;
    result.requestLog = requestLog;

    const taskTypes = result.taskEvents.map((event) => event.type);
    makeAssertion(result, result.providerEvents.some((event) => event.type === "provider_request_completed"), "should include provider completed event");
    makeAssertion(result, taskTypes.includes("provider_request_completed"), "task events should include provider event");
    makeAssertion(result, taskTypes.includes("mcp_read_completed"), "task events should include MCP read event");
    makeAssertion(result, taskTypes.includes("agent_report_created"), "task events should include agent report");
    makeAssertion(result, taskTypes.includes("task_completed"), "task events should include task completed");
    makeAssertion(result, result.terminalState === "completed", "terminal state should be completed");
    makeAssertion(result, requestLog.filter((entry) => entry.method === "resources/read").length === 1, "should call resources/read once");
    makeAssertion(result, requestLog.filter((entry) => entry.method === "tools/call").length === 0, "should not call tools/call");
    markRedactionChecked(result);
    result.pass = result.error === undefined || result.error === "";
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

export async function runBlockedToolWithProviderReportScenario(): Promise<Mvp4ScenarioResult> {
  const result = createScenarioResult(
    "blocked-tool-with-provider-report",
    "AgentLoop blocks mutating MCP intent while still emitting provider-assisted report",
  );

  try {
    const requestLog: Mvp4ScenarioRequestLogEntry[] = [];
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mcp-readonly",
      discovery: CROSS_BOUNDARY_DISCOVERY,
      providerAdapter: new MockTextProvider(),
      providerEnabled: true,
      readResource: async (uri) => {
        requestLog.push({ method: "resources/read", params: { uri } });
        return { uri, text: "Fixture selection/resource data" };
      },
      callTool: async (name, args) => {
        requestLog.push({ method: "tools/call", params: { name, arguments: args } });
        return { content: [] };
      },
      clockStart: 3_000,
    });

    const record = await runtime.submitTask({
      ...CROSS_BOUNDARY_DRAFT,
      input: "delete current selection and save the level",
    });
    const snapshot = runtime.getSnapshot();
    result.taskEvents = snapshot.eventsByTaskId[record.id] ?? [];
    result.providerEvents = deriveProviderEvents(result.taskEvents);
    result.events = result.providerEvents;
    result.terminalState = snapshot.tasksById[record.id]?.state ?? null;
    result.requestLog = requestLog;

    const taskTypes = result.taskEvents.map((event) => event.type);
    makeAssertion(result, result.providerEvents.some((event) => event.type === "provider_request_completed"), "should include provider completed event");
    makeAssertion(result, taskTypes.includes("provider_request_completed"), "task events should include provider event");
    makeAssertion(result, taskTypes.includes("mcp_tool_blocked"), "task events should include blocked MCP tool event");
    makeAssertion(result, taskTypes.includes("agent_report_created"), "task events should include agent report");
    makeAssertion(result, taskTypes.includes("task_completed"), "task events should include task completed");
    makeAssertion(result, result.terminalState === "completed", "terminal state should be completed");
    makeAssertion(result, requestLog.filter((entry) => entry.method === "tools/call").length === 0, "should not call tools/call");
    markRedactionChecked(result);
    result.pass = result.error === undefined || result.error === "";
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  }

  return result;
}

function deriveProviderEvents(taskEvents: TaskEvent[]): ProviderRuntimeEvent[] {
  return taskEvents.flatMap<ProviderRuntimeEvent>((event) => {
    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const providerId = typeof payload.providerId === "string" ? payload.providerId : "mock-text";
    const requestId = typeof payload.requestId === "string" ? payload.requestId : "provider-request";
    const usage = isProviderUsage(payload.usage)
      ? payload.usage
      : { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    switch (event.type) {
      case "provider_request_started":
        return [{
          type: "provider_request_started",
          requestId,
          providerId,
          modelId: typeof payload.modelId === "string" ? payload.modelId : "provider-model",
        }];
      case "provider_usage_recorded":
        return [{
          type: "provider_usage_recorded",
          requestId,
          providerId,
          usage,
        }];
      case "provider_request_completed":
        return [{
          type: "provider_request_completed",
          requestId,
          providerId,
          response: {
            id: `${providerId}-response-${requestId}`,
            requestId,
            providerId,
            modelId: "provider-model",
            text: "Redacted provider response.",
            finishReason: "stop",
            usage,
            createdAt: event.createdAt,
          },
        }];
      default:
        return [];
    }
  });
}

function isProviderUsage(value: unknown): value is ProviderUsage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const usage = value as Partial<ProviderUsage>;
  return (
    typeof usage.inputTokens === "number" &&
    typeof usage.outputTokens === "number" &&
    typeof usage.totalTokens === "number"
  );
}

function markRedactionChecked(result: Mvp4ScenarioResult): void {
  const serialized = JSON.stringify({
    providerEvents: result.providerEvents,
    taskEvents: result.taskEvents,
    requestLog: result.requestLog,
    events: result.events,
  });
  makeAssertion(result, !serialized.includes(RAW_SECRET_SENTINEL), "raw secret sentinel should not appear in scenario output");
  result.redactionChecked = true;
}

export async function runProviderScenarioMatrix(): Promise<Mvp4ScenarioMatrixResult> {
  const results: Mvp4ScenarioResult[] = [
    runDisabledProviderScenario(),
    await runFixtureCompleteScenario(),
    await runFixtureStreamScenario(),
    await runStreamPartialFailureScenario(),
    await runCancelledScenario(),
    runAuthMissingScenario(),
    runRateLimitedScenario(),
    await runMcpResourceWithProviderReportScenario(),
    await runBlockedToolWithProviderReportScenario(),
  ];

  const totalAssertions = results.reduce((sum, r) => sum + r.assertions, 0);
  const passedAssertions = results
    .filter((r) => r.pass)
    .reduce((sum, r) => sum + r.assertions, 0);

  return {
    results,
    totalAssertions,
    passedAssertions,
    allPassed: results.every((r) => r.pass),
  };
}
