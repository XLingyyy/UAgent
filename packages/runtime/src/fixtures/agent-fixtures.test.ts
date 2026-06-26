import { describe, expect, it } from "vitest";
import { createAgentLoopRuntime } from "../agent-loop-runtime.js";
import { buildAgentRunTrace } from "../agent-run-recorder.js";
import { replayAgentRunTrace } from "../agent-run-replay.js";
import {
  agentTaskFixtures,
  mcpDiscoveryFixtures,
  runAgentFixture,
} from "./agent-fixtures.js";

describe("Agent replay fixtures", () => {
  it("exports deterministic task and discovery fixture names", () => {
    expect(Object.keys(agentTaskFixtures)).toEqual([
      "mockFallback",
      "mcpCurrentSelection",
      "blockedDelete",
      "unknownIntent",
      "failureInjection",
    ]);
    expect(Object.keys(mcpDiscoveryFixtures)).toEqual([
      "resourceFirst",
      "readOnlyToolOnly",
      "blockedToolsOnly",
      "emptyDiscovery",
    ]);
  });

  it("replays a resource-first fixture with stable event types and report summary", async () => {
    const first = await runAgentFixture({
      draft: agentTaskFixtures.mcpCurrentSelection,
      discovery: mcpDiscoveryFixtures.resourceFirst,
    });
    const second = await runAgentFixture({
      draft: agentTaskFixtures.mcpCurrentSelection,
      discovery: mcpDiscoveryFixtures.resourceFirst,
    });

    expect(second.replay).toEqual(first.replay);
    expect(first.replay.eventTypes).toContain("action_selected");
    expect(first.replay.terminalEventType).toBe("run_completed");
    expect(first.replay.reportSummary).toBe("read-only completed: Agent loop finished without write actions.");
  });

  it("uses the read-only tool fixture only after policy classification", async () => {
    const calls: string[] = [];
    const result = await runAgentFixture({
      draft: agentTaskFixtures.mcpCurrentSelection,
      discovery: mcpDiscoveryFixtures.readOnlyToolOnly,
      callTool: async (name) => {
        calls.push(name);
        return { toolName: name, text: "StaticMeshActor_1" };
      },
    });

    expect(calls).toEqual(["ue.selection.get"]);
    expect(result.trace.observations[0]?.source).toBe("mcp-readonly");
  });

  it("does not call tools for blocked or unknown fixtures", async () => {
    const calls: string[] = [];
    const blocked = await runAgentFixture({
      draft: agentTaskFixtures.blockedDelete,
      discovery: mcpDiscoveryFixtures.blockedToolsOnly,
      callTool: async (name) => {
        calls.push(name);
        return { toolName: name };
      },
    });
    const unknown = await runAgentFixture({
      draft: agentTaskFixtures.unknownIntent,
      discovery: mcpDiscoveryFixtures.emptyDiscovery,
      callTool: async (name) => {
        calls.push(name);
        return { toolName: name };
      },
    });

    expect(calls).toEqual([]);
    expect(blocked.trace.status).toBe("completed");
    expect(blocked.trace.blockedActions).toHaveLength(1);
    expect(unknown.trace.status).toBe("failed");
    expect(unknown.replay.terminalEventType).toBe("run_failed");
  });

  it("can be reproduced manually from raw runtime events", async () => {
    const runtime = createAgentLoopRuntime({
      runtimeMode: "mock",
      discovery: null,
      clockStart: 2_000,
    });
    const record = await runtime.submitTask(agentTaskFixtures.mockFallback);
    const snapshot = runtime.getSnapshot();
    const trace = buildAgentRunTrace(snapshot.eventsByTaskId[record.id], snapshot.tasksById[record.id]);

    expect(replayAgentRunTrace(trace)).toEqual(
      (await runAgentFixture({ draft: agentTaskFixtures.mockFallback, discovery: null })).replay,
    );
  });
});
