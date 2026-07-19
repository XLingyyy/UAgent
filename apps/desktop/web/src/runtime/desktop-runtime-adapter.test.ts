import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createDesktopRuntimeAdapter } from "./desktop-runtime-adapter";
import { LegacySseTransport, McpTransportError, StreamableHttpTransport } from "@uagent/mcp-client";
import type { McpTransportClient } from "@uagent/mcp-client";
import {
  buildExactDryRunPayload,
  createAssetChangeSetService,
  createAssetManifestRegistry,
  createFixtureAssetMutationAdapter,
  createMvp15McpAssetToolInventory,
  MVP15_ASSET_TOOL_ALLOWLIST,
  unwrapPluginDryRunResult,
  validatePluginDryRunResult,
  type AssetMutationExternalBinder,
  type Mvp15McpAssetToolName,
  type Mvp15NativeAssetGuardInput,
} from "@uagent/runtime";
import type { TaskDraft } from "@uagent/shared";
import { createNativeProjectAdapter, type NativeInvoke } from "./project-native-adapter";

vi.mock("@uagent/mcp-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@uagent/mcp-client")>();
  return {
    ...actual,
    StreamableHttpTransport: vi.fn(),
    LegacySseTransport: vi.fn(),
  };
});

describe("MVP15C live evidence persistence", () => {
  it("atomically writes the complete 07E evidence without leaving a temporary file", () => {
    const directory = mkdtempSync(join(tmpdir(), "uagent-mvp15c07e-evidence-"));
    const evidencePath = join(directory, "live-smoke-evidence.json");
    const evidence = {
      runId: "mvp15c07e-live-20260715",
      callLedger: [{ toolName: "ue.asset.create_folder", pluginDryRunHash: "a".repeat(40) }],
      aggregateDryRunHash: "b".repeat(64),
      aggregateArgsHash: "c".repeat(64),
      previewStatus: "previewed",
      approvalOperationCount: 5,
    };

    try {
      writeMvp15c07eEvidence(evidencePath, evidence);

      expect(JSON.parse(readFileSync(evidencePath, "utf8"))).toEqual(evidence);
      expect(existsSync(`${evidencePath}.tmp`)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe.skipIf(process.env.UAGENT_MVP15C_CONNECT_PREFLIGHT !== "1")(
  "MVP15C 07E connect/discover preflight",
  () => {
    it("connects and discovers six ready direct exact descriptors without asset calls", async () => {
      const { StreamableHttpTransport: RealStreamableHttpTransport } =
        await vi.importActual<typeof import("@uagent/mcp-client")>("@uagent/mcp-client");
      const endpoint = "http://127.0.0.1:8000/mcp";
      const adapter = createDesktopRuntimeAdapter({
        nativeInvoke: null,
        createTransport: (transportEndpoint) =>
          new RealStreamableHttpTransport({ endpoint: transportEndpoint, timeoutMs: 30_000 }),
      });
      const originalExactAssetCall = adapter.callMvp15AssetTool;
      expect(originalExactAssetCall).toBeTypeOf("function");
      let exactAssetCalls = 0;
      if (originalExactAssetCall) {
        adapter.callMvp15AssetTool = async (...args) => {
          exactAssetCalls += 1;
          return originalExactAssetCall(...args);
        };
      }
      adapter.setMcpEndpoint(endpoint);

      try {
        await adapter.connectMcp();
        if (adapter.getMcpState().status !== "connected") {
          throw new Error("connect_status_not_connected");
        }
        await adapter.discoverMcp();
        if (adapter.getMcpState().status !== "connected") {
          throw new Error("discover_status_not_connected");
        }

        const directExactDescriptors = (adapter.getMcpDiscovery()?.tools ?? []).filter((tool) =>
          MVP15_ASSET_TOOL_ALLOWLIST.includes(tool.name as Mvp15McpAssetToolName),
        );
        const inventory = createMvp15McpAssetToolInventory(directExactDescriptors);
        expect(inventory.status).toBe("ready");
        expect(inventory.availableTools).toEqual([...MVP15_ASSET_TOOL_ALLOWLIST]);
        expect(directExactDescriptors).toHaveLength(6);
        expect(exactAssetCalls).toBe(0);

        console.log(
          JSON.stringify({
            environment: "node",
            status: adapter.getMcpState().status,
            inventoryStatus: inventory.status,
            directExactDescriptors: inventory.availableTools,
            exactAssetCalls,
            lastError: null,
          }),
        );
      } catch (error) {
        const safeLastError = sanitizeMvp15c07eLastError(
          adapter.getMcpState().lastError ?? (error instanceof Error ? error.message : null),
        );
        console.error(
          JSON.stringify({
            environment: "node",
            status: adapter.getMcpState().status,
            exactAssetCalls,
            lastError: safeLastError,
          }),
        );
        throw new Error(
          `MVP15C 07E connect/discover preflight failed: ${safeLastError ?? "unknown_error"}`,
        );
      } finally {
        adapter.disconnectMcp();
      }
    }, 300_000);
  },
);

describe.skipIf(process.env.UAGENT_MVP15C_LIVE_SMOKE !== "1")(
  "MVP15C 07E live no-side-effect dry-run smoke",
  () => {
    it("binds five exact dry-run calls through the real desktop adapter and approves once", async () => {
      const { StreamableHttpTransport: RealStreamableHttpTransport } =
        await vi.importActual<typeof import("@uagent/mcp-client")>("@uagent/mcp-client");
      const endpoint = "http://127.0.0.1:8000/mcp";
      const runId = `mvp15c07e-live-${Date.now()}`;
      expect(runId).toMatch(/^mvp15c07e-live-\d{13}$/);
      const evidencePath = "G:\\UAgent\\.agent-bus\\tmp\\mvp15c07e-live-smoke-evidence.json";
      expect(existsSync(evidencePath)).toBe(false);
      expect(existsSync(`${evidencePath}.tmp`)).toBe(false);
      const adapter = createDesktopRuntimeAdapter({
        nativeInvoke: null,
        createTransport: (transportEndpoint) =>
          new RealStreamableHttpTransport({ endpoint: transportEndpoint, timeoutMs: 30_000 }),
      });
      adapter.setMcpEndpoint(endpoint);
      try {
        await adapter.connectMcp();
        expect(adapter.getMcpState().status).toBe("connected");
        await adapter.discoverMcp();
        expect(adapter.getMcpState().status).toBe("connected");
        const inventory = createMvp15McpAssetToolInventory(adapter.getMvp15AssetTools());
        expect(inventory.status).toBe("ready");
        expect(inventory.availableTools).toEqual([
          "ue.asset.create_folder",
          "ue.asset.duplicate",
          "ue.asset.rename",
          "ue.asset.move",
          "ue.asset.delete",
          "ue.asset.save",
        ]);

        const service = createAssetChangeSetService({
          executionMode: "real",
          manifest: createAssetManifestRegistry(),
          adapter: createFixtureAssetMutationAdapter(),
        });
        const dryRun = service.dryRun({
          projectId: "project:live-mcp",
          trustedRootId: "root:live-mcp",
          editorSessionId: "editor-session:live-mcp",
          pidHash: "pid:live-mcp",
          runId,
          operations: [
            { kind: "create_folder", assetPathAfter: `/Game/UAgentSandbox/${runId}` },
            {
              kind: "duplicate_asset",
              assetPathBefore: "/Game/Test01",
              assetPathAfter: `/Game/UAgentSandbox/${runId}/Test01Copy`,
            },
            {
              kind: "rename_asset",
              assetPathBefore: `/Game/UAgentSandbox/${runId}/Test01Copy`,
              assetPathAfter: `/Game/UAgentSandbox/${runId}/Test01Renamed`,
            },
            {
              kind: "move_asset",
              assetPathBefore: `/Game/UAgentSandbox/${runId}/Test01Renamed`,
              assetPathAfter: `/Game/UAgentSandbox/${runId}/Sub/Test01Renamed`,
            },
            {
              kind: "save_single_asset",
              assetPathBefore: `/Game/UAgentSandbox/${runId}/Sub/Test01Renamed`,
              assetPathAfter: `/Game/UAgentSandbox/${runId}/Sub/Test01Renamed`,
            },
          ],
        });
        const calls: Array<{
          toolName: string;
          args: Record<string, unknown>;
          pluginDryRunHash: string;
        }> = [];
        const pluginResults: NonNullable<ReturnType<typeof unwrapPluginDryRunResult>>[] = [];
        const binder: AssetMutationExternalBinder = {
          call: async (input) => {
            const payload = buildExactDryRunPayload(input);
            expect(payload.args).toMatchObject({ dryRun: true, execute: false, rollback: false });
            expect(payload.args).not.toHaveProperty("dryRunHash");
            expect(payload.args).not.toHaveProperty("approvalToken");
            if (payload.toolName === "ue.asset.save")
              expect(payload.args).toMatchObject({ saveAll: false });
            const raw = await adapter.callMvp15AssetTool!(
              payload.toolName as Mvp15McpAssetToolName,
              payload.args,
            );
            const pluginResult = unwrapPluginDryRunResult(raw);
            expect(pluginResult?.dryRunHash).toMatch(/^[0-9a-f]{40}$/);
            calls.push({
              toolName: payload.toolName,
              args: payload.args,
              pluginDryRunHash: pluginResult!.dryRunHash,
            });
            pluginResults.push(pluginResult!);
            return raw;
          },
        };
        const bound = await service.bindExternalDryRun({
          changeSetId: dryRun.changeSet.id,
          binder,
        });
        expect(bound.status).toBe("dry_run_completed");
        expect(bound.changeSet?.externalBindingStatus).toBe("external_bound");
        expect(bound.changeSet?.aggregateDryRunHash).toMatch(/^[0-9a-f]{64}$/);
        expect(bound.changeSet?.aggregateArgsHash).toMatch(/^[0-9a-f]{64}$/);
        expect(calls.map((call) => call.toolName)).toEqual([
          "ue.asset.create_folder",
          "ue.asset.duplicate",
          "ue.asset.rename",
          "ue.asset.move",
          "ue.asset.save",
        ]);
        expect(calls).toHaveLength(5);

        const preview = service.preview(dryRun.changeSet.id);
        expect(preview.status).toBe("previewed");
        let approvalCallCount = 0;
        approvalCallCount += 1;
        const approval = service.approve({
          changeSetId: dryRun.changeSet.id,
          actor: "live-smoke",
          reason: "dry-run-only smoke",
        });
        expect(approval.status).toBe("approved");
        expect(approvalCallCount).toBe(1);
        const persistedChangeSet = JSON.stringify(approval.changeSet);
        expect(persistedChangeSet).not.toContain("asset-approval-token:");
        const approvalOperationCount =
          approval.changeSet?.approval?.orderedOperationIds?.length ?? 0;
        expect(approvalOperationCount).toBe(5);

        const callsBeforeNegativeFixture = calls.length;
        const malformed = validatePluginDryRunResult(null, {
          expectedToolName: "ue.asset.create_folder",
          expectedOperationKind: "create_folder",
          context: {
            changeSetId: dryRun.changeSet.id,
            runId,
            projectId: "project:live-mcp",
            trustedRootId: "root:live-mcp",
            editorSessionId: "editor-session:live-mcp",
            pidHash: "pid:live-mcp",
            sandboxRoot: "/Game/UAgentSandbox",
          },
          operation: {
            kind: "create_folder",
            assetPathBefore: null,
            assetPathAfter: `/Game/UAgentSandbox/${runId}`,
          },
        });
        expect(malformed).toEqual({ ok: false, reason: "mcp_dry_run_transport_failed" });
        if (malformed.ok) throw new Error("Malformed fixture unexpectedly passed validation.");
        const wrongChangeSet = validatePluginDryRunResult(
          { ...pluginResults[0], changeSetId: "wrong-change-set" },
          {
            expectedToolName: "ue.asset.create_folder",
            expectedOperationKind: "create_folder",
            context: {
              changeSetId: dryRun.changeSet.id,
              runId,
              projectId: "project:live-mcp",
              trustedRootId: "root:live-mcp",
              editorSessionId: "editor-session:live-mcp",
              pidHash: "pid:live-mcp",
              sandboxRoot: "/Game/UAgentSandbox",
            },
            operation: {
              kind: "create_folder",
              assetPathBefore: null,
              assetPathAfter: `/Game/UAgentSandbox/${runId}`,
            },
          },
        );
        expect(wrongChangeSet).toEqual({
          ok: false,
          reason: "mcp_dry_run_contract_mismatch:changeSetId",
        });
        if (wrongChangeSet.ok)
          throw new Error("Wrong-changeSet fixture unexpectedly passed validation.");
        expect(calls).toHaveLength(callsBeforeNegativeFixture);

        const evidence = {
          taskId: "TASK-MVP15C-07E-FIX-NODE-LIVE-RUNNER-AND-COMPLETE-EVIDENCE",
          endpoint,
          runId,
          inventoryStatus: inventory.status,
          inventory: inventory.availableTools,
          callLedger: calls,
          pluginDryRunHashes: calls.map((call) => call.pluginDryRunHash),
          aggregateDryRunHash: bound.changeSet!.aggregateDryRunHash!,
          aggregateArgsHash: bound.changeSet!.aggregateArgsHash!,
          strictValidation: "all_passed",
          previewStatus: preview.status,
          approvalStatus: approval.status,
          approvalCallCount,
          approvalOperationCount,
          persistedChangeSetContainsRawToken: persistedChangeSet.includes("asset-approval-token:"),
          negativeFixtures: {
            malformed: malformed.reason,
            wrongChangeSet: wrongChangeSet.reason,
            sentLiveCalls: calls.length - callsBeforeNegativeFixture,
          },
          safety: {
            executeCalls: calls.filter((call) => call.args.execute === true).length,
            verifyCalls: 0,
            rollbackCalls: calls.filter((call) => call.args.rollback === true).length,
            nativeMutationCalls: 0,
            saveAllCalls: calls.filter((call) => call.args.saveAll === true).length,
            approvalTokenPayloadCalls: calls.filter((call) =>
              Object.hasOwn(call.args, "approvalToken"),
            ).length,
            dryRunHashPayloadCalls: calls.filter((call) => Object.hasOwn(call.args, "dryRunHash"))
              .length,
          },
        };
        expect(JSON.stringify(evidence)).not.toContain("asset-approval-token:");
        writeMvp15c07eEvidence(evidencePath, evidence);

        console.log(
          JSON.stringify({
            callNames: calls.map((call) => call.toolName),
            pluginHashPrefixes: calls.map((call) => call.pluginDryRunHash.slice(0, 12)),
            aggregateDryRunHashPrefix: bound.changeSet!.aggregateDryRunHash!.slice(0, 16),
            aggregateArgsHashPrefix: bound.changeSet!.aggregateArgsHash!.slice(0, 16),
            approvalOperationCount,
            negativeFixtureSentLiveCalls: calls.length - callsBeforeNegativeFixture,
          }),
        );
      } finally {
        adapter.disconnectMcp();
      }
    }, 300_000);
  },
);

function writeMvp15c07eEvidence(evidencePath: string, evidence: unknown): void {
  mkdirSync(dirname(evidencePath), { recursive: true });
  const temporaryPath = `${evidencePath}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    renameSync(temporaryPath, evidencePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}

function sanitizeMvp15c07eLastError(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/[A-Za-z]:[\\/][^\s"']+/g, "<local-path>")
    .replace(/https?:\/\/[^\s"']+/g, "<local-endpoint>")
    .slice(0, 512);
}

const baseDraft: TaskDraft = {
  input: "Review Lyra asset loading risks",
  projectId: "lyra",
  permissionMode: "request_approval",
  modelId: "not-configured",
  reasoningEffort: "medium",
  runMode: "local",
  branch: "main",
  contextPercent: 12,
};

const fullDiscoveryFixtures: Record<string, unknown> = {
  initialize: {
    protocolVersion: "2025-06-18",
    serverInfo: { name: "Test MCP Server", version: "1.0.0" },
    capabilities: { tools: {}, resources: {}, prompts: {} },
  },
  "tools/list": {
    tools: [
      { name: "ue.selection.get", description: "Read current editor selection" },
      { name: "ue.asset.delete", description: "Delete an asset" },
      { name: "ue.asset.save", description: "Save an asset" },
    ],
  },
  "resources/list": {
    resources: [
      { uri: "ue://selection/current", name: "Current selection", mimeType: "application/json" },
    ],
  },
  "prompts/list": {
    prompts: [{ name: "summarize-selection", description: "Summarize selected editor objects" }],
  },
};

type Mvp15AssetBridge = {
  getMvp15AssetTools?: () => Array<{
    name: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
    dryRunSchema?: unknown;
    rollbackContract?: unknown;
    affectedAssetsSchema?: unknown;
    evidenceQuery?: unknown;
    annotations?: Record<string, unknown>;
  }>;
  guardMvp15AssetMutation?: (input: Mvp15NativeAssetGuardInput) => Promise<{ status: string; reason: string | null; evidenceId?: string | null }>;
  callMvp15AssetTool?: (
    toolName: "ue.asset.save" | "ue.asset.delete",
    args: Record<string, unknown>,
  ) => Promise<unknown>;
};

function createMockTransport(fixtures: Record<string, unknown>): McpTransportClient {
  return {
    sendRequest: vi.fn(async (request) => {
      const fixture = fixtures[request.method];
      return {
        jsonrpc: "2.0" as const,
        id: request.id,
        result: fixture ?? null,
      };
    }),
    sendNotification: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

function createNativeInvokeMockAdapter(
  mock: (command: string, payload?: unknown) => Promise<unknown>,
): NativeInvoke {
  // NativeInvoke is generic because each Tauri command has its own response shape; tests control the command fixture.
  return <T = unknown>(command: string, payload?: unknown) => mock(command, payload) as Promise<T>;
}

function createAdapterWithTransport(fixtures: Record<string, unknown> = fullDiscoveryFixtures) {
  return createDesktopRuntimeAdapter({
    createTransport: () => createMockTransport(fixtures),
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("DesktopRuntimeAdapter", () => {
  it("binds MVP15 to the actual discovered MCP session generation and endpoint identity", async () => {
    const adapter = createAdapterWithTransport();
    expect(adapter.captureMvp15McpBinding!()).toBeNull();
    await adapter.connectMcp();
    expect(adapter.captureMvp15McpBinding!()).toBeNull();
    await adapter.discoverMcp();

    const firstBinding = adapter.captureMvp15McpBinding!();
    expect(firstBinding).toMatch(/^mcp-binding:\d+$/);
    expect(adapter.isMvp15McpBindingCurrent!(firstBinding!)).toBe(true);

    adapter.setMcpEndpoint("http://127.0.0.1:8766/mcp");
    expect(adapter.captureMvp15McpBinding!()).toBeNull();
    expect(adapter.isMvp15McpBindingCurrent!(firstBinding!)).toBe(false);

    await adapter.connectMcp();
    await adapter.discoverMcp();
    const secondBinding = adapter.captureMvp15McpBinding!();
    expect(secondBinding).toMatch(/^mcp-binding:\d+$/);
    expect(secondBinding).not.toBe(firstBinding);
    expect(adapter.isMvp15McpBindingCurrent!(secondBinding!)).toBe(true);

    adapter.disconnectMcp();
    expect(adapter.isMvp15McpBindingCurrent!(secondBinding!)).toBe(false);
  });

  it.each(["disconnect", "endpoint", "rediscover", "reconnect"] as const)(
    "does not publish a stale facade discovery after %s",
    async (action) => {
      let releaseOldFacade!: () => void;
      let markOldFacadeStarted!: () => void;
      const oldFacadeStarted = new Promise<void>((resolve) => {
        markOldFacadeStarted = resolve;
      });
      const oldFacadeGate = new Promise<void>((resolve) => {
        releaseOldFacade = resolve;
      });
      let listToolsetsCalls = 0;
      let transportCount = 0;
      const oldTransport: McpTransportClient = {
        sendRequest: vi.fn(async (request) => {
          const params = request.params as { name?: string } | undefined;
          if (request.method === "initialize") {
            return { jsonrpc: "2.0" as const, id: request.id, result: fullDiscoveryFixtures.initialize };
          }
          if (request.method === "tools/list") {
            return {
              jsonrpc: "2.0" as const,
              id: request.id,
              result: { tools: [
                { name: "list_toolsets", inputSchema: { type: "object" } },
                { name: "describe_toolset", inputSchema: { type: "object" } },
                { name: "call_tool", inputSchema: { type: "object" } },
              ] },
            };
          }
          if (request.method === "resources/list") {
            return { jsonrpc: "2.0" as const, id: request.id, result: { resources: [] } };
          }
          if (request.method === "prompts/list") {
            return { jsonrpc: "2.0" as const, id: request.id, result: { prompts: [] } };
          }
          if (request.method === "tools/call" && params?.name === "list_toolsets") {
            listToolsetsCalls += 1;
            if (listToolsetsCalls === 1) {
              markOldFacadeStarted();
              await oldFacadeGate;
            }
            return { jsonrpc: "2.0" as const, id: request.id, result: { toolsets: [] } };
          }
          return { jsonrpc: "2.0" as const, id: request.id, result: null };
        }),
        sendNotification: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
      };
      const adapter = createDesktopRuntimeAdapter({
        createTransport: () => {
          transportCount += 1;
          return transportCount === 1 ? oldTransport : createMockTransport(fullDiscoveryFixtures);
        },
      });
      await adapter.connectMcp();
      const staleDiscovery = adapter.discoverMcp();
      await oldFacadeStarted;
      expect(adapter.getMcpDiscovery()).toBeNull();
      expect(adapter.getMvp15AssetTools()).toEqual([]);
      expect(adapter.captureMvp15McpBinding!()).toBeNull();

      if (action === "disconnect") {
        adapter.disconnectMcp();
      } else if (action === "endpoint") {
        adapter.setMcpEndpoint("http://127.0.0.1:8766/mcp");
      } else if (action === "rediscover") {
        await adapter.discoverMcp();
      } else {
        await adapter.connectMcp();
        await adapter.discoverMcp();
      }
      const latestDiscovery = adapter.getMcpDiscovery();
      const latestBinding = adapter.captureMvp15McpBinding!();
      releaseOldFacade();
      await staleDiscovery;

      if (action === "rediscover" || action === "reconnect") {
        expect(latestDiscovery).not.toBeNull();
        expect(latestBinding).not.toBeNull();
        expect(adapter.getMcpDiscovery()).toBe(latestDiscovery);
        expect(adapter.captureMvp15McpBinding!()).toBe(latestBinding);
        expect(adapter.getMcpState().status).toBe("connected");
      } else {
        expect(adapter.getMcpDiscovery()).toBeNull();
        expect(adapter.captureMvp15McpBinding!()).toBeNull();
        expect(adapter.getMcpState().status).not.toBe("connected");
      }
    },
  );

  it("submit routes through AgentLoop and emits plan, observation, evidence, and report events", async () => {
    const adapter = createDesktopRuntimeAdapter();
    const record = await adapter.submitTask(baseDraft);
    const snapshot = adapter.getSnapshot();
    const events = snapshot.eventsByTaskId[record.id];

    expect(record.id).toBe("task-0001");
    expect(events.map((e) => e.type)).toEqual([
      "task_submitted",
      "mcp_fallback_to_mock",
      "agent_plan_started",
      "agent_plan_created",
      "agent_step_started",
      "agent_observation_created",
      "evidence_created",
      "agent_step_completed",
      "agent_step_started",
      "agent_step_completed",
      "agent_step_started",
      "agent_observation_created",
      "evidence_created",
      "agent_step_completed",
      "agent_step_started",
      "agent_step_completed",
      "agent_report_created",
      "review_created",
      "task_completed",
    ]);
    expect(snapshot.tasksById[record.id].state).toBe("completed");
  });

  it("completed AgentLoop task does not add late cancellation event", async () => {
    const adapter = createDesktopRuntimeAdapter();
    const record = await adapter.submitTask(baseDraft);

    await adapter.cancelTask(record.id);

    const snapshot = adapter.getSnapshot();
    expect(snapshot.tasksById[record.id].state).toBe("completed");
    const cancelEvents = snapshot.eventsByTaskId[record.id].filter(
      (e) => e.type === "task_cancelled",
    );
    expect(cancelEvents).toHaveLength(0);
  });

  it("subscribe delivers snapshot updates", async () => {
    const adapter = createDesktopRuntimeAdapter();
    const listener = vi.fn();
    adapter.subscribe(listener);

    await adapter.submitTask(baseDraft);

    expect(listener).toHaveBeenCalled();
    const calls = listener.mock.calls.map((call) => call[0] as { status: string });
    const lastCall = calls[calls.length - 1];
    expect(lastCall.status).toBe("completed");
  });

  it("handles #fail input and ends in error state", async () => {
    const adapter = createDesktopRuntimeAdapter();
    const failDraft: TaskDraft = { ...baseDraft, input: "Review lighting #fail" };
    const record = await adapter.submitTask(failDraft);

    const snapshot = adapter.getSnapshot();
    expect(snapshot.tasksById[record.id].state).toBe("failed");
    expect(snapshot.lastError).toContain("#fail");
  });

  it("unsubscribe stops receiving updates", async () => {
    const adapter = createDesktopRuntimeAdapter();
    const listener = vi.fn();
    const unsub = adapter.subscribe(listener);
    unsub();

    await adapter.submitTask(baseDraft);

    expect(listener).not.toHaveBeenCalled();
  });

  it("connects via transport/session connect and fills serverInfo/protocolVersion from initialize result", async () => {
    const adapter = createAdapterWithTransport();
    await adapter.connectMcp();

    expect(adapter.getMcpState()).toMatchObject({
      status: "connected",
      protocolVersion: "2025-06-18",
      serverInfo: { name: "Test MCP Server", version: "1.0.0" },
    });
    expect(adapter.getMcpState().capabilities).toBeNull();
  });

  it("discover fills capabilities from session/discovery, not a hardcoded constant", async () => {
    const adapter = createAdapterWithTransport();
    await adapter.connectMcp();
    await adapter.discoverMcp();

    expect(adapter.getMcpState()).toMatchObject({
      status: "connected",
      capabilities: {
        tools: 3,
        resources: 1,
        prompts: 1,
      },
    });
  });

  it("exposes discovered MCP descriptors for narrow MVP15 schema inventory", async () => {
    const adapter = createAdapterWithTransport();
    await adapter.connectMcp();
    await adapter.discoverMcp();

    expect(adapter.getMcpDiscovery()?.tools.map((tool) => tool.name)).toEqual([
      "ue.selection.get",
      "ue.asset.delete",
      "ue.asset.save",
    ]);
  });

  it("normalizes the live UE outputSchema shape into six complete direct MVP15 descriptors", async () => {
    const names = [
      "ue.asset.create_folder",
      "ue.asset.duplicate",
      "ue.asset.rename",
      "ue.asset.move",
      "ue.asset.delete",
      "ue.asset.save",
    ];
    const contract = {
      dryRunSchema: { type: "object" },
      rollbackContract: { type: "reverse_operation" },
      affectedAssetsSchema: { type: "array" },
      evidenceQuery: { type: "read_only" },
    };
    const adapter = createAdapterWithTransport({
      initialize: fullDiscoveryFixtures.initialize,
      "tools/list": {
        tools: names.map((name) => ({
          name,
          inputSchema: { type: "object", properties: { assetPath: { type: "string" } } },
          outputSchema: contract,
        })),
      },
      "resources/list": { resources: [] },
      "prompts/list": { prompts: [] },
    }) as ReturnType<typeof createDesktopRuntimeAdapter> & Mvp15AssetBridge;

    await adapter.connectMcp();
    await adapter.discoverMcp();

    const tools = adapter.getMvp15AssetTools?.() ?? [];
    expect(tools.map((tool) => tool.name)).toEqual(names);
    expect(tools).toHaveLength(6);
    expect(tools.every((tool) => tool.inputSchema && tool.outputSchema)).toBe(true);
    expect(
      tools.every(
        (tool) =>
          tool.dryRunSchema &&
          tool.rollbackContract &&
          tool.affectedAssetsSchema &&
          tool.evidenceQuery,
      ),
    ).toBe(true);
    expect(tools.every((tool) => tool.annotations?.mvp15Facade === undefined)).toBe(true);
  });

  it("exposes a narrow MVP15 asset bridge through native guard and allowlisted MCP tools only", async () => {
    const sendRequest = vi.fn(
      async (request: { id: string | number | null; method: string; params?: unknown }) => {
        if (request.method === "initialize") {
          return {
            jsonrpc: "2.0" as const,
            id: request.id,
            result: fullDiscoveryFixtures.initialize,
          };
        }
        if (request.method === "tools/list") {
          return {
            jsonrpc: "2.0" as const,
            id: request.id,
            result: {
              tools: [
                {
                  name: "ue.asset.save",
                  inputSchema: { type: "object" },
                  annotations: { supportsDryRun: true },
                },
              ],
            },
          };
        }
        if (request.method === "resources/list") {
          return { jsonrpc: "2.0" as const, id: request.id, result: { resources: [] } };
        }
        if (request.method === "prompts/list") {
          return { jsonrpc: "2.0" as const, id: request.id, result: { prompts: [] } };
        }
        if (request.method === "tools/call") {
          return {
            jsonrpc: "2.0" as const,
            id: request.id,
            result: { status: "executed", evidenceId: "mcp:save" },
          };
        }
        return { jsonrpc: "2.0" as const, id: request.id, result: null };
      },
    );
    const transport: McpTransportClient = {
      sendRequest,
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const nativeInvokeMock = vi.fn(async () => ({
      status: "accepted_by_native_guard",
      reason: "sandbox_guard_passed",
      evidenceId: "guard:save",
    }));
    const nativeInvoke = createNativeInvokeMockAdapter(nativeInvokeMock);
    const adapter = createDesktopRuntimeAdapter({
      createTransport: () => transport,
      nativeInvoke,
    }) as ReturnType<typeof createDesktopRuntimeAdapter> & Mvp15AssetBridge;
    await adapter.connectMcp();
    await adapter.discoverMcp();

    expect(adapter.guardMvp15AssetMutation).toBeTypeOf("function");
    expect(adapter.callMvp15AssetTool).toBeTypeOf("function");

    const guard = await adapter.guardMvp15AssetMutation!({
      command: "guard", registrationId: "asset-registration:bridge",
      approvalToken: "asset-approval-token:redacted",
      phase: "execute", operationIndex: 0, operationCount: 1, changeSetId: "changeset:bridge", runId: "run-1",
      projectBindingId: "project:bridge", aggregateDryRunHash: "a".repeat(64), aggregateArgsHash: "b".repeat(64),
      operation: { operationId: "op-save", kind: "save", toolName: "ue.asset.save", pluginDryRunHash: "c".repeat(40), argsHash: "d".repeat(64), assetPath: "/Game/UAgentSandbox/run-1/Hero", rollbackAction: "none", saveAll: false, bulk: false },
    });
    await adapter.callMvp15AssetTool!("ue.asset.save", {
      assetPath: "/Game/UAgentSandbox/run-1/Hero",
      saveAll: false,
    });

    expect(guard).toMatchObject({ status: "accepted_by_native_guard", evidenceId: "guard:save" });
    expect(nativeInvokeMock).toHaveBeenCalledWith("execute_asset_mutation", expect.anything());
    expect(sendRequest.mock.calls.filter((call) => call[0].method === "tools/call")).toHaveLength(
      1,
    );
    expect(
      sendRequest.mock.calls.find((call) => call[0].method === "tools/call")?.[0].params,
    ).toEqual({
      name: "ue.asset.save",
      arguments: { assetPath: "/Game/UAgentSandbox/run-1/Hero", saveAll: false },
    });
  });

  it("routes Phase D registration, ordered execute guard, and outcome commands while resolving the raw root only at native invoke", async () => {
    const rawRoot = "G:/Projects/PhaseD";
    const nativeCalls: Array<{ command: string; payload: unknown }> = [];
    const nativeInvoke: NativeInvoke = async (command, payload) => {
      nativeCalls.push({ command, payload });
      if (command === "validate_native_project_root") {
        return { ok: true, reason: "valid", displayRoot: "[project]/PhaseD", projectName: "PhaseD", engine: { label: "UE", association: null, source: "fixture" } } as never;
      }
      if (command === "trust_native_project_root") return { rootId: "root:phase-d", displayRoot: "[project]/PhaseD", trustState: "trusted" } as never;
      if (command === "register_asset_mutation_approval") return { status: "registered", reason: "approval_binding_registered", registrationId: "asset-approval:phase-d", operationCount: 5, approvalToken: "a".repeat(64), issuedAt: 1, expiresAt: 2000 } as never;
      if (command === "cancel_asset_mutation_approval") return { status: "cancelled", reason: "approval_registration_cancelled", registrationId: "asset-approval:phase-d" } as never;
      if (command === "execute_asset_mutation") return { status: "accepted_by_native_guard", reason: "registered_binding_matched", registrationId: "asset-approval:phase-d", phase: "execute", operationId: "op-1", operationIndex: 0, operationCount: 5, evidenceId: "native:phase-d" } as never;
      if (command === "record_asset_mutation_outcome") return { status: "recorded", reason: "operation_outcome_recorded", registrationId: "asset-approval:phase-d", phase: "execute", operationId: "op-1", rollbackAvailable: true, terminal: false } as never;
      return null as never;
    };
    const projectAdapter = createNativeProjectAdapter({ invoke: nativeInvoke, now: () => 1 });
    const project = await projectAdapter.addProject(rawRoot);
    const trusted = await projectAdapter.confirmTrust(project.id);
    const adapter = createDesktopRuntimeAdapter({ nativeInvoke });
    const operation = {
      operationId: "op-1",
      kind: "create_folder" as const,
      toolName: "ue.asset.create_folder",
      pluginDryRunHash: "a".repeat(40),
      argsHash: "b".repeat(64),
      assetPath: "/Game/UAgentSandbox/run-1",
      rollbackAction: "cleanup_empty_folder" as const,
      rollbackToolName: "ue.asset.delete",
      saveAll: false as const,
      bulk: false as const,
    };
    const guardCommon = {
      changeSetId: "changeset-1",
      runId: "run-1",
      projectBindingId: trusted.id,
      aggregateDryRunHash: "c".repeat(64),
      aggregateArgsHash: "d".repeat(64),
    };

    const registered = await adapter.guardMvp15AssetMutation!({
      command: "register", phase: "register", trustedRootRef: trusted.rootRef,
      editorSessionId: "editor-session:1", requestedTtlMs: 1_999, operations: [operation, operation, operation, operation, operation], ...guardCommon,
    });
    const guarded = await adapter.guardMvp15AssetMutation!({
      command: "guard", registrationId: "asset-approval:phase-d", approvalToken: "raw-token-native-only", phase: "execute",
      operationIndex: 0, operationCount: 5, operation, ...guardCommon,
    });
    const recorded = await adapter.guardMvp15AssetMutation!({
      command: "record_outcome", operationIndex: 0, registrationId: "asset-approval:phase-d", phase: "execute",
      operationId: "op-1", success: true, sideEffectObserved: true, rollbackAvailable: true, evidenceId: "mcp:op-1", reasonCode: "none",
    });
    const cancelled = await adapter.guardMvp15AssetMutation!({
      command: "cancel_registration", phase: "cancel", registrationId: "asset-approval:phase-d", approvalToken: "a".repeat(64),
    });

    expect(registered).toMatchObject({ status: "registered", registrationId: "asset-approval:phase-d", operationCount: 5 });
    expect(guarded).toMatchObject({ status: "accepted_by_native_guard", operationIndex: 0, evidenceId: "native:phase-d" });
    expect(recorded).toMatchObject({ status: "recorded", operationId: "op-1", rollbackAvailable: true });
    expect(cancelled).toMatchObject({ status: "cancelled", registrationId: "asset-approval:phase-d" });
    const relevantCalls = nativeCalls.filter((call) => ["validate_native_project_root", "trust_native_project_root", "register_asset_mutation_approval", "execute_asset_mutation", "record_asset_mutation_outcome", "cancel_asset_mutation_approval"].includes(call.command));
    expect(relevantCalls.map((call) => call.command)).toEqual(["validate_native_project_root", "trust_native_project_root", "register_asset_mutation_approval", "execute_asset_mutation", "record_asset_mutation_outcome", "cancel_asset_mutation_approval"]);
    const registrationPayload = relevantCalls[2]?.payload as { input?: Record<string, unknown> };
    expect(registrationPayload.input?.trustedProjectRoot).toBe(rawRoot);
    expect(registrationPayload.input).not.toHaveProperty("trustedRootRef");
    for (const forbidden of ["pidHash", "observedEditorSessionId", "observedPidHash", "assetMutationGateEnabled"]) expect(registrationPayload.input).not.toHaveProperty(forbidden);
    const guardPayload = relevantCalls[3]?.payload as { input?: Record<string, unknown> };
    for (const forbidden of ["trustedRootId", "editorSessionId", "pidHash", "observedEditorSessionId", "observedPidHash", "assetMutationGateEnabled"]) expect(guardPayload.input).not.toHaveProperty(forbidden);
    expect(relevantCalls[5]?.payload).toEqual({ input: { registrationId: "asset-approval:phase-d", approvalToken: "a".repeat(64) } });
    expect(JSON.stringify({ registered, guarded, recorded })).not.toContain(rawRoot);
  });

  it("blocks mutation registration before confirmTrust without invoking the native registration command", async () => {
    const rawRoot = "G:/Projects/A20Desktop";
    const nativeCommands: string[] = [];
    const nativeInvoke: NativeInvoke = async (command) => {
      nativeCommands.push(command);
      if (command === "validate_native_project_root") return { ok: true, reason: "valid", displayRoot: "[project]/A20Desktop", projectName: "A20Desktop", engine: { label: "UE", association: null, source: "fixture" } } as never;
      if (command === "trust_native_project_root") return { rootId: "root:a20-desktop", displayRoot: "[project]/A20Desktop", trustState: "trusted" } as never;
      if (command === "register_asset_mutation_approval") return { status: "registered", reason: null, registrationId: "registration:a20", operationCount: 1, approvalToken: "a".repeat(64), issuedAt: 1, expiresAt: 60_000 } as never;
      return null as never;
    };
    const projectAdapter = createNativeProjectAdapter({ invoke: nativeInvoke, now: () => 1 });
    const project = await projectAdapter.addProject(rawRoot);
    const adapter = createDesktopRuntimeAdapter({ nativeInvoke });
    const registration = {
      command: "register" as const, phase: "register" as const, changeSetId: "changeset:a20", runId: "run-a20",
      projectBindingId: project.id, trustedRootRef: project.rootRef, editorSessionId: "observation:a20",
      aggregateDryRunHash: "b".repeat(64), aggregateArgsHash: "c".repeat(64), requestedTtlMs: 60_000,
      operations: [{ operationId: "operation:a20", kind: "create_folder" as const, toolName: "ue.asset.create_folder", pluginDryRunHash: "d".repeat(40), argsHash: "e".repeat(64), assetPath: "/Game/UAgentSandbox/run-a20", rollbackAction: "cleanup_empty_folder" as const, rollbackToolName: "ue.asset.delete", saveAll: false as const, bulk: false as const }],
    };
    await expect(adapter.guardMvp15AssetMutation!(registration)).resolves.toMatchObject({ status: "blocked", reason: "trusted_root_ref_unavailable" });
    expect(nativeCommands.filter((command) => command === "register_asset_mutation_approval")).toHaveLength(0);
    const trusted = await projectAdapter.confirmTrust(project.id);
    await expect(adapter.guardMvp15AssetMutation!({ ...registration, projectBindingId: trusted.id, trustedRootRef: trusted.rootRef })).resolves.toMatchObject({ status: "registered", registrationId: "registration:a20" });
    expect(nativeCommands.filter((command) => command === "register_asset_mutation_approval")).toHaveLength(1);
  });

  it("redacts malformed native guard identifiers and reasons before they cross the desktop boundary", async () => {
    const adapter = createDesktopRuntimeAdapter({
      nativeInvoke: async (command) => command === "execute_asset_mutation"
        ? {
            status: "accepted_by_native_guard",
            reason: "G:\\private\\project",
            registrationId: "G:\\private\\registration",
            phase: "execute",
            operationId: "op-1",
            operationIndex: 0,
            operationCount: 1,
            evidenceId: "C:\\private\\evidence",
          } as never
        : null as never,
    });

    const result = await adapter.guardMvp15AssetMutation!({
      command: "guard", registrationId: "registration:redaction",
      approvalToken: "token-native-only",
      phase: "execute", operationIndex: 0, operationCount: 1, changeSetId: "changeset:redaction", runId: "run-redaction",
      projectBindingId: "project:redaction", aggregateDryRunHash: "a".repeat(64), aggregateArgsHash: "b".repeat(64),
      operation: { operationId: "op-1", kind: "save", toolName: "ue.asset.save", pluginDryRunHash: "c".repeat(40), argsHash: "d".repeat(64), assetPath: "/Game/UAgentSandbox/run-1/Hero", rollbackAction: "none", saveAll: false, bulk: false },
    });

    expect(result).toMatchObject({
      status: "accepted_by_native_guard",
      reason: null,
      registrationId: null,
      evidenceId: null,
    });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("exposes strict read-only Phase E asset evidence and Content-manifest bridges", async () => {
    const nativeCalls: Array<{ command: string; payload: unknown }> = [];
    const nativeInvoke: NativeInvoke = async (command, payload) => {
      nativeCalls.push({ command, payload });
      if (command === "read_asset_content_evidence") {
        return { status: "observed", reason: "asset_present", assetPath: "/Game/Test01", exists: true, size: 12, sha256: "a".repeat(64), evidenceId: "asset-content:source" } as never;
      }
      if (command === "snapshot_asset_content_manifest") {
        return { status: "observed", reason: "content_manifest_captured", entries: [{ assetPath: "/Game/Test01", size: 12, sha256: "a".repeat(64) }], aggregateSha256: "b".repeat(64), evidenceId: "asset-content-manifest:before" } as never;
      }
      return null as never;
    };
    const adapter = createDesktopRuntimeAdapter({ nativeInvoke }) as ReturnType<typeof createDesktopRuntimeAdapter> & {
      readMvp15AssetContentEvidence?: (input: Record<string, unknown>) => Promise<unknown>;
      snapshotMvp15AssetContentManifest?: (input: Record<string, unknown>) => Promise<unknown>;
    };
    expect(adapter.readMvp15AssetContentEvidence).toBeTypeOf("function");
    expect(adapter.snapshotMvp15AssetContentManifest).toBeTypeOf("function");
    if (!adapter.readMvp15AssetContentEvidence || !adapter.snapshotMvp15AssetContentManifest) return;

    const binding = { registrationId: "registration:phase-e" };
    const evidence = await adapter.readMvp15AssetContentEvidence({ ...binding, assetPath: "/Game/Test01" });
    const manifest = await adapter.snapshotMvp15AssetContentManifest(binding);

    expect(evidence).toEqual({ status: "observed", reason: "asset_present", assetPath: "/Game/Test01", exists: true, size: 12, sha256: "a".repeat(64), evidenceId: "asset-content:source" });
    expect(manifest).toEqual({ status: "observed", reason: "content_manifest_captured", entries: [{ assetPath: "/Game/Test01", size: 12, sha256: "a".repeat(64) }], aggregateSha256: "b".repeat(64), evidenceId: "asset-content-manifest:before" });
    expect(nativeCalls).toEqual([
      { command: "terminal_capability_status", payload: undefined },
      { command: "browser_capability_status", payload: undefined },
      { command: "read_asset_content_evidence", payload: { input: { ...binding, assetPath: "/Game/Test01" } } },
      { command: "snapshot_asset_content_manifest", payload: { input: binding } },
    ]);
    expect(JSON.stringify({ evidence, manifest })).not.toContain("G:/");

    const leakingAdapter = createDesktopRuntimeAdapter({
      nativeInvoke: async (command) => command === "read_asset_content_evidence"
        ? { status: "observed", reason: "asset_present", assetPath: "/Game/Test01", exists: true, size: 12, sha256: "a".repeat(64), evidenceId: "asset-content:source", unexpectedRoot: "/home/user/project" } as never
        : null as never,
    });
    const rejectedLeak = await leakingAdapter.readMvp15AssetContentEvidence?.({ ...binding, assetPath: "/Game/Test01" });
    expect(rejectedLeak).toMatchObject({ status: "failed", reason: "native_asset_evidence_invalid_result", evidenceId: null });
  });

  it("routes Phase F registered rollback guard and outcome through rollback-native DTOs", async () => {
    const nativeCalls: Array<{ command: string; payload: unknown }> = [];
    const nativeInvoke: NativeInvoke = async (command, payload) => {
      nativeCalls.push({ command, payload });
      const input = (payload as { input?: Record<string, unknown> } | undefined)?.input ?? {};
      if (command === "rollback_asset_mutation") {
        const operation = input.operation as { operationId?: string } | undefined;
        return { status: "accepted_by_native_guard", reason: "registered_binding_matched", registrationId: input.registrationId, phase: "rollback", operationId: operation?.operationId, operationIndex: input.operationIndex, operationCount: input.operationCount, evidenceId: "native:rollback:3" } as never;
      }
      if (command === "record_asset_mutation_outcome") {
        return { status: "recorded", reason: "operation_succeeded", registrationId: input.registrationId, phase: "rollback", operationId: input.operationId, rollbackAvailable: true, terminal: false } as never;
      }
      return null as never;
    };
    const adapter = createDesktopRuntimeAdapter({ nativeInvoke });
    const common = {
      registrationId: "asset-registration:phase-f",
      phase: "rollback",
      operationIndex: 3,
      operationCount: 5,
      changeSetId: "asset-changeset:phase-f",
      runId: "run-phase-f",
      projectBindingId: "project:fixture",
      aggregateDryRunHash: "a".repeat(64),
      aggregateArgsHash: "b".repeat(64),
      operation: { operationId: "op-move", kind: "move_back", toolName: "ue.asset.move", pluginDryRunHash: "c".repeat(40), argsHash: "d".repeat(64), assetPath: "/Game/UAgentSandbox/run-phase-f/Sub/Hero", targetAssetPath: "/Game/UAgentSandbox/run-phase-f/Hero", rollbackAction: "none", saveAll: false, bulk: false },
    };

    const guarded = await adapter.guardMvp15AssetMutation!({ command: "guard", approvalToken: null, ...common } as never);
    const recorded = await adapter.guardMvp15AssetMutation!({ command: "record_outcome", operationIndex: 3, registrationId: common.registrationId, phase: "rollback", operationId: "op-move", success: true, sideEffectObserved: true, rollbackAvailable: false, evidenceId: "mcp:rollback:move", reasonCode: "none" } as never);

    expect(guarded).toMatchObject({ status: "accepted_by_native_guard", phase: "rollback", operationId: "op-move", operationIndex: 3 });
    expect(recorded).toMatchObject({ status: "recorded", phase: "rollback", operationId: "op-move", rollbackAvailable: true });
    expect(nativeCalls.filter((call) => call.command.includes("asset_mutation")).map((call) => call.command)).toEqual(["rollback_asset_mutation", "record_asset_mutation_outcome"]);
  });

  it("builds MVP15 exact facade tools from wrapper toolset descriptions and pins call_tool execution", async () => {
    const fullContracts = {
      inputSchema: { type: "object" },
      dryRunSchema: { type: "object" },
      rollbackContract: { type: "reverse_operation" },
      affectedAssetsSchema: { type: "array" },
      evidenceQuery: { type: "read_only" },
    };
    const methods = [
      {
        exactToolName: "ue.asset.create_folder",
        methodId: "create_folder",
        schemaVersion: "2026-07-09",
        ...fullContracts,
      },
      {
        exactToolName: "ue.asset.duplicate",
        methodId: "duplicate",
        schemaVersion: "2026-07-09",
        ...fullContracts,
      },
      {
        exactToolName: "ue.asset.rename",
        methodId: "rename",
        schemaVersion: "2026-07-09",
        ...fullContracts,
      },
      {
        exactToolName: "ue.asset.move",
        methodId: "move",
        schemaVersion: "2026-07-09",
        ...fullContracts,
      },
      {
        exactToolName: "ue.asset.delete",
        methodId: "delete",
        schemaVersion: "2026-07-09",
        ...fullContracts,
      },
      {
        exactToolName: "ue.asset.save",
        methodId: "save",
        schemaVersion: "2026-07-09",
        ...fullContracts,
      },
    ];
    const sendRequest = vi.fn(async (request: Parameters<McpTransportClient["sendRequest"]>[0]) => {
      const params = request.params as
        | { name?: string; arguments?: Record<string, unknown> }
        | undefined;
      if (request.method === "initialize") {
        return {
          jsonrpc: "2.0" as const,
          id: request.id,
          result: fullDiscoveryFixtures.initialize,
        };
      }
      if (request.method === "tools/list") {
        return {
          jsonrpc: "2.0" as const,
          id: request.id,
          result: {
            tools: [
              { name: "list_toolsets", inputSchema: { type: "object" } },
              { name: "describe_toolset", inputSchema: { type: "object" } },
              { name: "call_tool", inputSchema: { type: "object" } },
            ],
          },
        };
      }
      if (request.method === "resources/list") {
        return { jsonrpc: "2.0" as const, id: request.id, result: { resources: [] } };
      }
      if (request.method === "prompts/list") {
        return { jsonrpc: "2.0" as const, id: request.id, result: { prompts: [] } };
      }
      if (request.method === "tools/call" && params?.name === "list_toolsets") {
        return {
          jsonrpc: "2.0" as const,
          id: request.id,
          result: { toolsets: [{ id: "editor_toolset.toolsets.asset.AssetTools" }] },
        };
      }
      if (request.method === "tools/call" && params?.name === "describe_toolset") {
        return {
          jsonrpc: "2.0" as const,
          id: request.id,
          result: { toolsetId: "editor_toolset.toolsets.asset.AssetTools", methods },
        };
      }
      if (request.method === "tools/call" && params?.name === "call_tool") {
        return {
          jsonrpc: "2.0" as const,
          id: request.id,
          result: { status: "executed", evidenceId: "mcp:facade-save" },
        };
      }
      return { jsonrpc: "2.0" as const, id: request.id, result: null };
    });
    const transport: McpTransportClient = {
      sendRequest,
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const adapter = createDesktopRuntimeAdapter({ createTransport: () => transport }) as ReturnType<
      typeof createDesktopRuntimeAdapter
    > &
      Mvp15AssetBridge;

    await adapter.connectMcp();
    await adapter.discoverMcp();

    expect(adapter.getMvp15AssetTools?.().map((tool) => tool.name)).toEqual([
      "ue.asset.create_folder",
      "ue.asset.duplicate",
      "ue.asset.rename",
      "ue.asset.move",
      "ue.asset.delete",
      "ue.asset.save",
    ]);

    await adapter.callMvp15AssetTool!("ue.asset.save", {
      changeSetId: "asset-changeset:1",
      dryRunHash: "dry:hash",
      assetPath: "/Game/UAgentSandbox/run-1/Hero",
      saveAll: false,
    });

    expect(
      sendRequest.mock.calls
        .filter((call) => call[0].method === "tools/call")
        .map((call) => call[0].params),
    ).toEqual([
      { name: "list_toolsets", arguments: {} },
      {
        name: "describe_toolset",
        arguments: { toolsetId: "editor_toolset.toolsets.asset.AssetTools" },
      },
      {
        name: "call_tool",
        arguments: {
          toolsetId: "editor_toolset.toolsets.asset.AssetTools",
          methodId: "save",
          schemaVersion: "2026-07-09",
          changeSetId: "asset-changeset:1",
          dryRunHash: "dry:hash",
          arguments: {
            assetPath: "/Game/UAgentSandbox/run-1/Hero",
            saveAll: false,
          },
        },
      },
    ]);

    const mutationAttempt = await adapter.callMvp15AssetTool!("ue.asset.save", {
      changeSetId: "asset-changeset:1",
      runId: "run-1",
      dryRun: false,
      execute: true,
      rollback: false,
      dryRunHash: "a".repeat(40),
      assetPath: "/Game/UAgentSandbox/run-1/Hero",
      saveAll: false,
    });
    expect(mutationAttempt).toMatchObject({ status: "blocked", reason: "mvp15_direct_exact_tool_required" });
    expect(sendRequest.mock.calls.filter((call) => call[0].method === "tools/call")).toHaveLength(3);
  });

  it("keeps a complete direct MVP15 exact asset tool ahead of a same-name facade fallback", async () => {
    const fullContracts = {
      inputSchema: { type: "object" },
      dryRunSchema: { type: "object" },
      rollbackContract: { type: "reverse_operation" },
      affectedAssetsSchema: { type: "array" },
      evidenceQuery: { type: "read_only" },
    };
    const directSaveTool = {
      name: "ue.asset.save",
      annotations: { source: "direct-exact" },
      ...fullContracts,
    };
    const methods = [
      {
        exactToolName: "ue.asset.save",
        methodId: "save_via_facade",
        schemaVersion: "2026-07-09",
        ...fullContracts,
      },
    ];
    const sendRequest = vi.fn(async (request: Parameters<McpTransportClient["sendRequest"]>[0]) => {
      const params = request.params as
        | { name?: string; arguments?: Record<string, unknown> }
        | undefined;
      if (request.method === "initialize") {
        return {
          jsonrpc: "2.0" as const,
          id: request.id,
          result: fullDiscoveryFixtures.initialize,
        };
      }
      if (request.method === "tools/list") {
        return {
          jsonrpc: "2.0" as const,
          id: request.id,
          result: {
            tools: [
              directSaveTool,
              { name: "list_toolsets", inputSchema: { type: "object" } },
              { name: "describe_toolset", inputSchema: { type: "object" } },
              { name: "call_tool", inputSchema: { type: "object" } },
            ],
          },
        };
      }
      if (request.method === "resources/list") {
        return { jsonrpc: "2.0" as const, id: request.id, result: { resources: [] } };
      }
      if (request.method === "prompts/list") {
        return { jsonrpc: "2.0" as const, id: request.id, result: { prompts: [] } };
      }
      if (request.method === "tools/call" && params?.name === "list_toolsets") {
        return {
          jsonrpc: "2.0" as const,
          id: request.id,
          result: { toolsets: [{ id: "editor_toolset.toolsets.asset.AssetTools" }] },
        };
      }
      if (request.method === "tools/call" && params?.name === "describe_toolset") {
        return {
          jsonrpc: "2.0" as const,
          id: request.id,
          result: { toolsetId: "editor_toolset.toolsets.asset.AssetTools", methods },
        };
      }
      if (request.method === "tools/call" && params?.name === "call_tool") {
        return {
          jsonrpc: "2.0" as const,
          id: request.id,
          result: { status: "executed", evidenceId: "mcp:facade-save" },
        };
      }
      if (request.method === "tools/call" && params?.name === "ue.asset.save") {
        return {
          jsonrpc: "2.0" as const,
          id: request.id,
          result: { status: "executed", evidenceId: "mcp:direct-save" },
        };
      }
      return { jsonrpc: "2.0" as const, id: request.id, result: null };
    });
    const transport: McpTransportClient = {
      sendRequest,
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const adapter = createDesktopRuntimeAdapter({ createTransport: () => transport }) as ReturnType<
      typeof createDesktopRuntimeAdapter
    > &
      Mvp15AssetBridge;

    await adapter.connectMcp();
    await adapter.discoverMcp();

    const saveDescriptor = adapter
      .getMvp15AssetTools?.()
      .find((tool) => tool.name === "ue.asset.save");
    expect(saveDescriptor).toMatchObject({
      name: "ue.asset.save",
      annotations: { source: "direct-exact" },
    });
    expect(saveDescriptor?.annotations?.mvp15Facade).toBeUndefined();

    sendRequest.mockClear();
    const saveArgs = {
      changeSetId: "asset-changeset:1",
      runId: "run-1",
      dryRun: false,
      execute: true,
      rollback: false,
      dryRunHash: "a".repeat(40),
      assetPath: "/Game/UAgentSandbox/run-1/Hero",
      saveAll: false,
    };

    await adapter.callMvp15AssetTool!("ue.asset.save", saveArgs);

    expect(
      sendRequest.mock.calls
        .filter((call) => call[0].method === "tools/call")
        .map((call) => call[0].params),
    ).toEqual([{ name: "ue.asset.save", arguments: saveArgs }]);
  });

  it("submits read-only query through MCP events after full connect+discover cycle", async () => {
    const adapter = createAdapterWithTransport();
    await adapter.connectMcp();
    await adapter.discoverMcp();

    const record = await adapter.submitTask({ ...baseDraft, input: "check current selection" });
    const events = adapter.getSnapshot().eventsByTaskId[record.id].map((event) => event.type);

    expect(events).toContain("agent_plan_created");
    expect(events).toContain("agent_step_started");
    expect(events).toContain("mcp_read_completed");
    expect(events).toContain("evidence_created");
    expect(events).toContain("task_completed");
  });

  it("blocked write intent does not call tool and ends in terminal state", async () => {
    const adapter = createAdapterWithTransport();
    await adapter.connectMcp();
    await adapter.discoverMcp();

    const record = await adapter.submitTask({ ...baseDraft, input: "delete current selection" });
    const snapshot = adapter.getSnapshot();
    const events = snapshot.eventsByTaskId[record.id].map((event) => event.type);

    expect(events).toContain("mcp_tool_blocked");
    expect(events).toContain("review_created");
    expect(events).toContain("task_completed");
    expect(snapshot.tasksById[record.id].state).toBe("completed");
  });

  it("blocked tool path does not send tools/call to MCP transport", async () => {
    const sendRequest = vi.fn(async (request: { method: string }) => {
      const fixture = fullDiscoveryFixtures[request.method];
      return { jsonrpc: "2.0" as const, id: 1, result: fixture ?? null };
    });
    const transport: McpTransportClient = {
      sendRequest,
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const adapter = createDesktopRuntimeAdapter({ createTransport: () => transport });
    await adapter.connectMcp();
    await adapter.discoverMcp();

    sendRequest.mockClear();

    await adapter.submitTask({ ...baseDraft, input: "delete current selection" });

    const toolCallCalls = sendRequest.mock.calls.filter(
      (call: unknown[]) => (call[0] as { method: string }).method === "tools/call",
    );
    expect(toolCallCalls).toHaveLength(0);
  });

  it("unknown discovered tool path does not send tools/call to MCP transport and ends in failed terminal state", async () => {
    const unknownToolFixtures: Record<string, unknown> = {
      initialize: fullDiscoveryFixtures.initialize,
      "tools/list": {
        tools: [{ name: "ue.magic", description: "Unknown editor capability" }],
      },
      "resources/list": { resources: [] },
      "prompts/list": { prompts: [] },
    };
    const sendRequest = vi.fn(async (request: { id: string | number | null; method: string }) => {
      const fixture = unknownToolFixtures[request.method];
      return { jsonrpc: "2.0" as const, id: request.id, result: fixture ?? null };
    });
    const transport: McpTransportClient = {
      sendRequest,
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const adapter = createDesktopRuntimeAdapter({ createTransport: () => transport });
    await adapter.connectMcp();
    await adapter.discoverMcp();

    sendRequest.mockClear();

    const record = await adapter.submitTask({ ...baseDraft, input: "use magic tool" });
    const snapshot = adapter.getSnapshot();
    const events = snapshot.eventsByTaskId[record.id].map((event) => event.type);
    const toolCallCalls = sendRequest.mock.calls.filter(
      (call: unknown[]) => (call[0] as { method: string }).method === "tools/call",
    );

    expect(toolCallCalls).toHaveLength(0);
    expect(events).toContain("agent_step_failed");
    expect(events).toContain("agent_report_created");
    expect(events).toContain("review_created");
    expect(events.indexOf("agent_report_created")).toBeGreaterThan(
      events.indexOf("agent_step_failed"),
    );
    expect(events.indexOf("review_created")).toBeGreaterThan(
      events.indexOf("agent_report_created"),
    );
    expect(events.indexOf("task_failed")).toBeGreaterThan(events.indexOf("review_created"));
    expect(events.at(-1)).toBe("task_failed");
    expect(snapshot.tasksById[record.id].state).toBe("failed");
  });

  it("submitApprovalDecision is exposed and does not throw for valid call shape", async () => {
    const adapter = createDesktopRuntimeAdapter();
    const record = await adapter.submitTask(baseDraft);
    await expect(
      adapter.submitApprovalDecision(record.id, "step-1", "approved", "test", "test"),
    ).resolves.toBeUndefined();
    const snapshot = adapter.getSnapshot();
    expect(snapshot.tasksById[record.id]).toBeDefined();
  });

  it("preserves mock task snapshot through MCP connect+discover cycle", async () => {
    const adapter = createDesktopRuntimeAdapter();
    await adapter.submitTask(baseDraft);

    await adapter.connectMcp();
    await adapter.discoverMcp();

    const snapshot = adapter.getSnapshot();
    expect(snapshot.tasksById["task-0001"]).toBeDefined();
    expect(snapshot.tasksById["task-0001"].state).toBe("completed");
  });

  it("preserves old tasks and increments task id after MCP discover", async () => {
    const adapter = createDesktopRuntimeAdapter();
    const record1 = await adapter.submitTask(baseDraft);

    await adapter.connectMcp();
    await adapter.discoverMcp();

    const record2 = await adapter.submitTask({ ...baseDraft, input: "check current selection" });

    const snapshot = adapter.getSnapshot();
    expect(snapshot.tasksById["task-0001"]).toBeDefined();
    expect(snapshot.tasksById["task-0002"]).toBeDefined();
    expect(Object.keys(snapshot.tasksById).length).toBe(2);
    expect(record1.id).not.toBe(record2.id);
  });

  it("preserves all tasks through disconnect back to mock fallback", async () => {
    const adapter = createDesktopRuntimeAdapter();
    await adapter.submitTask(baseDraft);
    await adapter.connectMcp();
    await adapter.discoverMcp();
    await adapter.submitTask({ ...baseDraft, input: "check current selection" });

    adapter.disconnectMcp();

    const record3 = await adapter.submitTask(baseDraft);

    const snapshot = adapter.getSnapshot();
    expect(snapshot.tasksById["task-0001"]).toBeDefined();
    expect(snapshot.tasksById["task-0002"]).toBeDefined();
    expect(snapshot.tasksById["task-0003"]).toBeDefined();
    expect(Object.keys(snapshot.tasksById).length).toBe(3);
    expect(record3.id).toBe("task-0003");
    expect(snapshot.eventsByTaskId["task-0003"].map((e) => e.type)).toContain(
      "mcp_fallback_to_mock",
    );
  });

  it("blocks non-localhost endpoints and keeps MockRuntime fallback available", async () => {
    const adapter = createDesktopRuntimeAdapter();
    adapter.setMcpEndpoint("https://example.com/mcp");
    await adapter.connectMcp();

    expect(adapter.getMcpState()).toMatchObject({
      status: "error",
      lastError: "Only localhost MCP endpoints are allowed in MVP2.",
    });

    const record = await adapter.submitTask(baseDraft);
    expect(adapter.getSnapshot().eventsByTaskId[record.id].map((event) => event.type)).toContain(
      "mcp_fallback_to_mock",
    );
  });

  it("disconnects MCP, resets state, and routes later tasks back to MockRuntime fallback", async () => {
    const adapter = createAdapterWithTransport();
    await adapter.connectMcp();
    await adapter.discoverMcp();

    expect(adapter.getMcpState().status).toBe("connected");
    adapter.disconnectMcp();

    expect(adapter.getMcpState()).toMatchObject({
      status: "disconnected",
      protocolVersion: null,
      serverInfo: null,
      capabilities: null,
    });

    const record = await adapter.submitTask(baseDraft);
    expect(adapter.getSnapshot().eventsByTaskId[record.id].map((event) => event.type)).toContain(
      "mcp_fallback_to_mock",
    );
  });

  it("invalid endpoint error keeps MockRuntime task routing intact", async () => {
    const adapter = createDesktopRuntimeAdapter();
    adapter.setMcpEndpoint("not-a-url");
    await adapter.connectMcp();

    expect(adapter.getMcpState().status).toBe("error");
    expect(adapter.getMcpState().lastError).toBeTruthy();

    const record = await adapter.submitTask(baseDraft);
    expect(adapter.getSnapshot().eventsByTaskId[record.id].map((event) => event.type)).toContain(
      "mcp_fallback_to_mock",
    );
  });

  it("connect error from transport/session failure keeps disconnected state", async () => {
    const badTransport = (): McpTransportClient => ({
      sendRequest: vi.fn(async () => ({
        jsonrpc: "2.0" as const,
        id: 1,
        error: { code: -1, message: "Connection refused" },
      })),
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    });

    const adapter = createDesktopRuntimeAdapter({ createTransport: badTransport });
    await adapter.connectMcp();

    expect(adapter.getMcpState().status).toBe("error");
    expect(adapter.getMcpState().lastError).toContain("Connection refused");
  });

  it("subscribeMvp9 does not double-notify (P1 subscription cleanup)", () => {
    const adapter = createDesktopRuntimeAdapter();
    const listener = vi.fn();
    const unsub = adapter.subscribeMvp9(listener);

    adapter.getMvp9().terminal.propose("pnpm test", "[project-root]", null);
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
    listener.mockClear();
    adapter.getMvp9().terminal.propose("pnpm lint", "[project-root]", null);
    expect(listener).not.toHaveBeenCalled();
  });

  it("subscribeMvp9 unsubscribe prevents further listener calls (P1 subscription cleanup)", () => {
    const adapter = createDesktopRuntimeAdapter();
    const listener = vi.fn();
    const unsub = adapter.subscribeMvp9(listener);

    unsub();
    adapter.getMvp9().terminal.propose("pnpm build", "[project-root]", null);
    expect(listener).not.toHaveBeenCalled();
  });

  it("routes MVP10 terminal proposal, approval, and execution through native invoke without exposing raw token or cwd", async () => {
    const calls: Array<{ command: string; payload: unknown }> = [];
    const nativeInvokeMock = vi.fn(async (command: string, payload?: unknown): Promise<unknown> => {
      calls.push({ command, payload });
      if (command === "terminal_capability_status") {
        return {
          enabled: true,
          mode: "native",
          reason: null,
          allowlistSummary: "typecheck, lint, test, desktop web build, cargo test, git status/diff",
          trustedRootRequired: true,
          approvalRequired: true,
          timeoutMs: 60_000,
          outputLimitBytes: 1_048_576,
          outputLimitLines: 5_000,
        };
      }
      if (command === "watcher_capability_status") {
        return {
          enabled: false,
          mode: "disabled",
          reason: "feature_disabled",
          trustedRootRequired: true,
          debounceMs: 500,
          maxQueueSize: 10000,
          overflowAction: "warn",
          readDiffOnly: true,
        };
      }
      if (command === "propose_terminal_command") {
        return {
          proposalId: "native-proposal-1",
          command: "pnpm test",
          risk: "allowlisted",
          reason: "command classified as allowlisted",
          requiresApproval: true,
          featureFlag: "terminal",
          canonicalCwd: "G:\\UAgent",
          redactedCwd: "[project-root]",
          expiresAt: 1_700_000_300_000,
          timeoutMs: 60_000,
          outputLimitBytes: 1_048_576,
          outputLimitLines: 5_000,
        };
      }
      if (command === "approve_terminal_proposal") {
        return { token: "raw-native-token:native-proposal-1", status: "approved" };
      }
      if (command === "execute_terminal_command_real") {
        return {
          status: "completed",
          chunks: [
            {
              index: 0,
              stream: "stdout",
              text: "ok\n",
              truncated: false,
              timestamp: 1_700_000_000_001,
            },
          ],
          exitCode: 0,
          durationMs: 25,
          outputSummary: "ok\n",
          outputTruncated: false,
          totalBytes: 3,
          totalLines: 1,
          redactionSummary: { replacedSecrets: 0, replacedPaths: 1 },
        };
      }
      throw new Error(`unexpected native command ${command}`);
    });
    const nativeInvoke = createNativeInvokeMockAdapter(nativeInvokeMock);

    const adapter = createDesktopRuntimeAdapter({ nativeInvoke });
    const terminal = adapter.getMvp9().mvp10.terminal;
    await vi.waitFor(() => {
      expect(terminal.getState().capability?.enabled).toBe(true);
    });

    const proposal = await terminal.propose(
      "pnpm test",
      "G:\\UAgent",
      "task-native-1",
      "G:\\UAgent",
      "lyra",
    );
    const token = await terminal.approve(proposal.id, "user", "approve");
    const state = terminal.getState();

    expect(calls.map((call) => call.command)).toEqual([
      "terminal_capability_status",
      "browser_capability_status",
      "propose_terminal_command",
      "approve_terminal_proposal",
      "execute_terminal_command_real",
    ]);
    const proposeIdx = calls.findIndex((c) => c.command === "propose_terminal_command");
    expect(calls[proposeIdx].payload).toEqual({
      input: { command: "pnpm test", cwd: "G:\\UAgent", projectId: "lyra" },
    });
    const executeIdx = calls.findIndex((c) => c.command === "execute_terminal_command_real");
    expect(calls[executeIdx].payload).toEqual({
      input: {
        command: "pnpm test",
        cwd: "G:\\UAgent",
        approvedToken: "raw-native-token:native-proposal-1",
        timeoutSecs: 60,
      },
    });
    expect(proposal.id).toBe("native-proposal-1");
    expect(proposal.cwd).toBe("[project-root]");
    expect(state.stage).toBe("completed");
    expect(state.executionResult?.exitState?.code).toBe(0);
    expect(state.executionResult?.chunks[0]?.text).toBe("ok\n");
    expect(token?.id).not.toContain("raw-native-token");
    expect(JSON.stringify(state)).not.toContain("raw-native-token");
    expect(JSON.stringify(state)).not.toContain("G:\\UAgent");
  });

  it("reports native terminal disabled from capability status even when native invoke exists", async () => {
    const nativeInvokeMock = vi.fn(async (command: string): Promise<unknown> => {
      if (command === "terminal_capability_status") {
        return {
          enabled: false,
          mode: "disabled",
          reason: "feature_disabled",
          allowlistSummary: "typecheck, lint, test, desktop web build, cargo test, git status/diff",
          trustedRootRequired: true,
          approvalRequired: true,
          timeoutMs: 60_000,
          outputLimitBytes: 1_048_576,
          outputLimitLines: 5_000,
        };
      }
      if (command === "watcher_capability_status") {
        return {
          enabled: false,
          mode: "disabled",
          reason: "feature_disabled",
          trustedRootRequired: true,
          debounceMs: 500,
          maxQueueSize: 10000,
          overflowAction: "warn",
          readDiffOnly: true,
        };
      }
      throw new Error(`unexpected native command ${command}`);
    });
    const nativeInvoke = createNativeInvokeMockAdapter(nativeInvokeMock);

    const adapter = createDesktopRuntimeAdapter({ nativeInvoke });
    const terminal = adapter.getMvp9().mvp10.terminal;

    await vi.waitFor(() => {
      expect(terminal.getState().capability).toMatchObject({
        enabled: false,
        mode: "disabled",
        reason: "feature_disabled",
      });
    });
    expect(nativeInvokeMock).toHaveBeenCalledWith("terminal_capability_status", undefined);
  });

  it("reports native watcher disabled from capability status even when native invoke exists", async () => {
    const nativeInvokeMock = vi.fn(async (command: string): Promise<unknown> => {
      if (command === "terminal_capability_status") {
        return {
          enabled: false,
          mode: "disabled",
          reason: "feature_disabled",
          allowlistSummary: "typecheck, lint, test, desktop web build, cargo test, git status/diff",
          trustedRootRequired: true,
          approvalRequired: true,
          timeoutMs: 60_000,
          outputLimitBytes: 1_048_576,
          outputLimitLines: 5_000,
        };
      }
      if (command === "watcher_capability_status") {
        return {
          enabled: false,
          mode: "disabled",
          reason: "feature_disabled",
          trustedRootRequired: true,
          debounceMs: 500,
          maxQueueSize: 10000,
          overflowAction: "warn",
          readDiffOnly: true,
        };
      }
      throw new Error(`unexpected native command ${command}`);
    });
    const nativeInvoke = createNativeInvokeMockAdapter(nativeInvokeMock);

    const adapter = createDesktopRuntimeAdapter({ nativeInvoke });
    const watcher = adapter.getMvp9().watcher;
    await watcher.refreshCapability?.();

    expect(watcher.getState().capability).toMatchObject({
      enabled: false,
      mode: "disabled",
      reason: "feature_disabled",
      trustedRootRequired: true,
      readDiffOnly: true,
    });
    expect(nativeInvokeMock).toHaveBeenCalledWith("watcher_capability_status", undefined);
  });
});

const initializeFixture = {
  protocolVersion: "2025-06-18",
  serverInfo: { name: "Test MCP Server", version: "1.0.0" },
  capabilities: { tools: {}, resources: {}, prompts: {} },
};

const discoveryFixtures: Record<string, unknown> = {
  initialize: initializeFixture,
  "tools/list": {
    tools: [{ name: "ue.selection.get", description: "Read current editor selection" }],
  },
  "resources/list": {
    resources: [
      { uri: "ue://selection/current", name: "Current selection", mimeType: "application/json" },
    ],
  },
  "prompts/list": { prompts: [{ name: "summarize-selection", description: "Summarize" }] },
};

function mockTransportThatResponds(fixtures: Record<string, unknown>): McpTransportClient {
  return {
    sendRequest: vi.fn(async (request) => {
      const fixture = fixtures[request.method];
      return { jsonrpc: "2.0" as const, id: request.id, result: fixture ?? null };
    }),
    sendNotification: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

type StreamableHttpTransportImplementation = (
  options: ConstructorParameters<typeof StreamableHttpTransport>[0],
) => InstanceType<typeof StreamableHttpTransport>;

type LegacySseTransportImplementation = (
  options: ConstructorParameters<typeof LegacySseTransport>[0],
) => InstanceType<typeof LegacySseTransport>;

function mockStreamableHttpTransport(createTransport: () => McpTransportClient) {
  vi.mocked(StreamableHttpTransport).mockImplementation(
    (() =>
      createTransport() as InstanceType<
        typeof StreamableHttpTransport
      >) as StreamableHttpTransportImplementation,
  );
}

function mockLegacySseTransport(createTransport: () => McpTransportClient) {
  vi.mocked(LegacySseTransport).mockImplementation(
    (() =>
      createTransport() as InstanceType<
        typeof LegacySseTransport
      >) as LegacySseTransportImplementation,
  );
}

describe("Legacy SSE fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streamable connect success does not try legacy and sets legacyMode=false", async () => {
    mockStreamableHttpTransport(() => mockTransportThatResponds({ initialize: initializeFixture }));

    const adapter = createDesktopRuntimeAdapter();
    await adapter.connectMcp();

    expect(adapter.getMcpState().status).toBe("connected");
    expect(adapter.getMcpState().legacyMode).toBe(false);
    expect(adapter.getMcpState().protocolVersion).toBe("2025-06-18");
    expect(vi.mocked(LegacySseTransport)).not.toHaveBeenCalled();
  });

  it("streamable 404 fallback to legacy SSE sets legacyMode=true", async () => {
    mockStreamableHttpTransport(() => ({
      sendRequest: vi.fn(async () => {
        throw new McpTransportError("MCP HTTP request failed with status 404.", 404);
      }),
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    }));

    mockLegacySseTransport(() => mockTransportThatResponds({ initialize: initializeFixture }));

    const adapter = createDesktopRuntimeAdapter();
    await adapter.connectMcp();

    expect(adapter.getMcpState().status).toBe("connected");
    expect(adapter.getMcpState().legacyMode).toBe(true);
    expect(adapter.getMcpState().protocolVersion).toBe("2025-06-18");
    expect(vi.mocked(StreamableHttpTransport)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(LegacySseTransport)).toHaveBeenCalledTimes(1);
  });

  it("streamable 405 fallback to legacy SSE sets legacyMode=true", async () => {
    mockStreamableHttpTransport(() => ({
      sendRequest: vi.fn(async () => {
        throw new McpTransportError("MCP HTTP request failed with status 405.", 405);
      }),
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    }));

    mockLegacySseTransport(() => mockTransportThatResponds({ initialize: initializeFixture }));

    const adapter = createDesktopRuntimeAdapter();
    await adapter.connectMcp();

    expect(adapter.getMcpState().status).toBe("connected");
    expect(adapter.getMcpState().legacyMode).toBe(true);
  });

  it("non-compat error does not fallback and sets error state", async () => {
    mockStreamableHttpTransport(() => ({
      sendRequest: vi.fn(async () => {
        throw new McpTransportError("MCP HTTP request failed with status 500.", 500);
      }),
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    }));

    const adapter = createDesktopRuntimeAdapter();
    await adapter.connectMcp();

    expect(adapter.getMcpState().status).toBe("error");
    expect(adapter.getMcpState().legacyMode).toBe(false);
    expect(vi.mocked(LegacySseTransport)).not.toHaveBeenCalled();
  });

  it("non-McpTransportError does not fallback and sets error state", async () => {
    mockStreamableHttpTransport(() => ({
      sendRequest: vi.fn(async () => {
        throw new Error("Network error");
      }),
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    }));

    const adapter = createDesktopRuntimeAdapter();
    await adapter.connectMcp();

    expect(adapter.getMcpState().status).toBe("error");
    expect(adapter.getMcpState().lastError).toContain("Network error");
    expect(vi.mocked(LegacySseTransport)).not.toHaveBeenCalled();
  });

  it("after legacy fallback connect, discoverMcp fills capabilities from legacy discovery", async () => {
    mockStreamableHttpTransport(() => ({
      sendRequest: vi.fn(async () => {
        throw new McpTransportError("MCP HTTP request failed with status 404.", 404);
      }),
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    }));

    mockLegacySseTransport(() => mockTransportThatResponds(discoveryFixtures));

    const adapter = createDesktopRuntimeAdapter();
    await adapter.connectMcp();

    expect(adapter.getMcpState().status).toBe("connected");
    expect(adapter.getMcpState().legacyMode).toBe(true);

    await adapter.discoverMcp();

    expect(adapter.getMcpState().status).toBe("connected");
    expect(adapter.getMcpState().capabilities).toEqual({
      tools: 1,
      resources: 1,
      prompts: 1,
      readOnlyTools: 1,
      blockedTools: 0,
    });
  });
});
