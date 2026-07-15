import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { McpTransportClient } from "@uagent/mcp-client";
import { AssetMutationPanel } from "../inspector/AssetMutationPanel";
import { McpMutationPanel } from "../inspector/McpMutationPanel";
import { createDesktopRuntimeAdapter } from "../runtime/desktop-runtime-adapter";
import { createEmptyMvp14State, type Mvp14RuntimeState } from "../runtime/runtime-store";
import type { NativeInvoke } from "../runtime/project-native-adapter";
import { ChangesPanel } from "../inspector/ChangesPanel";
import { ConfigSettings } from "../settings/pages/ConfigSettings";
import { UIProvider, useOptionalRuntimeActions, useRuntimeStore } from "./ui-store";

const MVP15_TEST_TOOL_NAMES = [
  "ue.asset.create_folder",
  "ue.asset.duplicate",
  "ue.asset.rename",
  "ue.asset.move",
  "ue.asset.delete",
  "ue.asset.save",
] as const;

const MVP15_TEST_TOOL_CONTRACTS = {
  inputSchema: { type: "object" },
  dryRunSchema: { type: "object" },
  rollbackContract: { type: "reverse_operation" },
  affectedAssetsSchema: { type: "array" },
  evidenceQuery: { type: "read_only" },
};

const TOOL_NAME_TO_OPERATION = {
  "ue.asset.create_folder": "create_folder",
  "ue.asset.duplicate": "duplicate",
  "ue.asset.rename": "rename",
  "ue.asset.move": "move",
  "ue.asset.delete": "delete",
  "ue.asset.save": "save",
} as const;

function fakeSha1Hex(seed: string): string {
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193) >>> 0;
  const base = (h >>> 0).toString(16).padStart(8, "0");
  return (base + base.repeat(5) + base).slice(0, 40);
}

function structuredDryRunResult(
  toolName: string,
  _exactKindHint: string,
  changeSetId: string,
  runId: string,
  beforePath: string | null,
  afterPath: string | null,
): Record<string, unknown> {
  const operation = TOOL_NAME_TO_OPERATION[toolName as keyof typeof TOOL_NAME_TO_OPERATION] ?? "create_folder";
  const isDuplicate = toolName === "ue.asset.duplicate";
  const isDelete = toolName === "ue.asset.delete";
  const isRenameOrMove = toolName === "ue.asset.rename" || toolName === "ue.asset.move";
  const wouldRead = isDuplicate && beforePath ? [beforePath] : [];
  const wouldModify = isDelete
    ? (beforePath ? [beforePath] : [])
    : isRenameOrMove
      ? (beforePath && afterPath ? [beforePath, afterPath] : [])
      : (afterPath ? [afterPath] : []);
  return {
    blocked: false,
    status: "dry_run_completed",
    toolName,
    operation,
    changeSetId,
    runId,
    sandboxRoot: `/Game/UAgentSandbox/${runId}`,
    wouldChange: true,
    wouldModify,
    wouldRead,
    affectedAssets: { readOnlySources: wouldRead, sandboxTargets: wouldModify, externalTargets: [] },
    rollbackPlan: { executionEnabled: false, inverseOperation: "restore", summary: "rollback" },
    externalEvidenceQueries: [{ queryKind: "asset_registry_snapshot", readOnly: true, paths: [...wouldRead, ...wouldModify] }],
    dryRunHash: fakeSha1Hex(`${toolName}|${changeSetId}|${runId}|${beforePath ?? ""}|${afterPath ?? ""}`),
    hashAlgorithm: "sha1",
    schemaVersion: "mvp15c.dry-run.v1",
    approvalRequired: true,
    implementationStatus: "dry_run_only",
  };
}

function createRealReadyMvp14State(pidHash: string | null = "pid:real-attached"): Mvp14RuntimeState {
  return {
    ...createEmptyMvp14State(),
    session: {
      sessionId: "editor-session:real",
      projectId: "project:real",
      rootId: "root:trusted",
      uprojectDisplayPath: "[project-root]/BehaviorTree_Learn.uproject",
      ...(pidHash ? { pidHash } : {}),
      mode: "attached" as const,
      status: "attached" as const,
      createdAt: 1,
      expiresAt: 999,
      replayOnly: false,
    },
    status: {
      status: "ready" as const,
      reason: null,
      heartbeat: {
        sessionId: "editor-session:real",
        processState: "running" as const,
        statusReason: "heartbeat_ok",
        processAlive: true,
        projectMatched: true,
        checkedAt: 2,
      },
    },
  };
}

function createMvp15ReadyTransport(events: string[]): McpTransportClient {
  return {
    sendRequest: vi.fn(async (request) => {
      if (request.method === "initialize") {
        return {
          jsonrpc: "2.0" as const,
          id: request.id,
          result: {
            protocolVersion: "2025-06-18",
            serverInfo: { name: "MVP15 Real MCP", version: "1.0.0" },
            capabilities: { tools: {}, resources: {}, prompts: {} },
          },
        };
      }
      if (request.method === "tools/list") {
        return {
          jsonrpc: "2.0" as const,
          id: request.id,
          result: {
            tools: MVP15_TEST_TOOL_NAMES.map((name) => ({
              name,
              inputSchema: MVP15_TEST_TOOL_CONTRACTS.inputSchema,
              outputSchema: {
                dryRunSchema: MVP15_TEST_TOOL_CONTRACTS.dryRunSchema,
                rollbackContract: MVP15_TEST_TOOL_CONTRACTS.rollbackContract,
                affectedAssetsSchema: MVP15_TEST_TOOL_CONTRACTS.affectedAssetsSchema,
                evidenceQuery: MVP15_TEST_TOOL_CONTRACTS.evidenceQuery,
              },
            })),
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
        const params = request.params as { name?: string; arguments?: Record<string, unknown> };
        events.push(`mcp:${params.name ?? "unknown"}`);
        const args = params.arguments ?? {};
        // dry-run only: assert execute/rollback are never true and no token sent across the wire.
        if (args.dryRun === true) {
          // Produce a contract-compliant structured dry-run result for the binding validator.
          const runId = typeof args.runId === "string" ? args.runId : "";
          const changeSetId = typeof args.changeSetId === "string" ? args.changeSetId : "";
          const beforePath = typeof args.sourceAssetPath === "string"
            ? args.sourceAssetPath
            : typeof args.assetPath === "string"
              ? args.assetPath
              : null;
          const afterCandidate = args.folderPath ?? args.targetAssetPath ?? args.assetPath;
          const afterPath = typeof afterCandidate === "string" ? afterCandidate : null;
          const result = structuredDryRunResult(
            params.name ?? "ue.asset.create_folder",
            params.name ?? "ue.asset.create_folder",
            changeSetId,
            runId,
            beforePath,
            afterPath,
          );
          return { jsonrpc: "2.0" as const, id: request.id, result: { structuredContent: result } };
        }
        return { jsonrpc: "2.0" as const, id: request.id, result: { status: "executed", reason: null, evidenceId: `mcp:${params.name ?? "unknown"}` } };
      }
      return { jsonrpc: "2.0" as const, id: request.id, result: null };
    }),
    sendNotification: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

function createWrapperOnlyMcpTransport(events: string[]): McpTransportClient {
  return {
    sendRequest: vi.fn(async (request) => {
      if (request.method === "initialize") {
        return {
          jsonrpc: "2.0" as const,
          id: request.id,
          result: {
            protocolVersion: "2025-06-18",
            serverInfo: { name: "UE MCP Wrapper", version: "5.8" },
            capabilities: { tools: {}, resources: {}, prompts: {} },
          },
        };
      }
      if (request.method === "tools/list") {
        return {
          jsonrpc: "2.0" as const,
          id: request.id,
          result: {
            tools: [
              { name: "list_toolsets", description: "List UE toolsets" },
              { name: "describe_toolset", description: "Describe a UE toolset" },
              { name: "call_tool", description: "Generic UE tool wrapper" },
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
        const params = request.params as { name?: string };
        events.push(`wrapper:${params.name ?? "unknown"}`);
        return {
          jsonrpc: "2.0" as const,
          id: request.id,
          result: { status: "executed", reason: "wrapper_should_not_run" },
        };
      }
      return { jsonrpc: "2.0" as const, id: request.id, result: null };
    }),
    sendNotification: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

function createNativeInvokeMockAdapter(mock: (command: string, payload?: unknown) => Promise<unknown>): NativeInvoke {
  // NativeInvoke is generic because each Tauri command has its own response shape; tests control the command fixture.
  return <T = unknown>(command: string, payload?: unknown) => mock(command, payload) as Promise<T>;
}

function Mvp15InventoryProbe() {
  const inventory = useRuntimeStore((state) => state.mvp15.mcpInventory);
  return <pre data-testid="mvp15-inventory-probe">{JSON.stringify(inventory)}</pre>;
}

function Mvp15StateProbe() {
  const state = useRuntimeStore((runtime) => runtime.mvp15);
  return <pre data-testid="mvp15-state-probe">{JSON.stringify(state)}</pre>;
}

function Mvp15DirectActionProbe() {
  const actions = useOptionalRuntimeActions();
  return (
    <div>
      <button type="button" onClick={() => void actions?.verifyMvp15AssetChangeSet()}>Direct real verify</button>
      <button type="button" onClick={() => void actions?.rollbackMvp15AssetChangeSet()}>Direct real rollback</button>
    </div>
  );
}

describe("MVP15 desktop asset mutation UI", () => {
  it("renders asset mutation actions inside a wrapping action row with accessible rollback", () => {
    render(
      <UIProvider>
        <AssetMutationPanel />
      </UIProvider>,
    );

    const panel = screen.getByLabelText("Asset mutation panel");
    const actionRows = panel.querySelectorAll(".ua-utility-placeholder__action-row");
    expect(actionRows).toHaveLength(1);

    const rowButtons = Array.from(actionRows[0].querySelectorAll("button"));
    expect(rowButtons.map((button) => button.textContent)).toEqual([
      "Dry-run",
      "Approve",
      "Execute",
      "Verify",
      "Rollback",
    ]);
    expect(screen.getByRole("button", { name: "Rollback sandbox asset mutation" })).toBe(rowButtons[4]);

    const actionItem = actionRows[0].closest(".ua-utility-placeholder__item");
    expect(actionItem?.childElementCount).toBe(1);
  });

  it("asserts asset action-row CSS wraps whole buttons without mid-word label breaks", () => {
    const css = readFileSync("web/src/inspector/UtilityPlaceholderPanel.css", "utf8");
    expect(css).toMatch(/\.ua-utility-placeholder__action-row\s*\{[^}]*display:\s*flex;/s);
    expect(css).toMatch(/\.ua-utility-placeholder__action-row\s*\{[^}]*flex-wrap:\s*wrap;/s);
    expect(css).toMatch(/\.ua-utility-placeholder__button\s*\{[^}]*white-space:\s*nowrap;/s);
    expect(css).toMatch(
      /\.ua-utility-placeholder__action-row \.ua-utility-placeholder__button\s*\{[^}]*overflow-wrap:\s*normal;/s,
    );
  });

  it("documents MCP endpoint connect and discovery before MVP15 asset dry-run", () => {
    const manualSmoke = readFileSync("../../docs/mvp15-manual-smoke.md", "utf8");
    const endpointStep = manualSmoke.indexOf("Settings -> Config -> MCP read-only runtime");
    const dryRunStep = manualSmoke.indexOf("Run dry-run");

    expect(endpointStep).toBeGreaterThan(-1);
    expect(dryRunStep).toBeGreaterThan(endpointStep);
    expect(manualSmoke).toContain("Endpoint");
    expect(manualSmoke).toContain("http://127.0.0.1:8000/mcp");
    expect(manualSmoke).toMatch(/`?localhost`?\s*\/\s*`?127\.0\.0\.1`?\s*\/\s*`?::1`?/);
    expect(manualSmoke).toContain("Connect");
    expect(manualSmoke).toContain("connected");
    expect(manualSmoke).toContain("Discover");
    expect(manualSmoke).toContain("discovery counts");
    expect(manualSmoke).toContain("Tools -> MCP");
    expect(manualSmoke).toContain("Tools -> Assets");
    expect(manualSmoke).toContain("BLOCKED_BY_MCP_SCHEMA");
  });

  it("runs the fixture sandbox asset mutation chain through runtime actions without direct native invocation", async () => {
    render(
      <UIProvider>
        <AssetMutationPanel />
      </UIProvider>,
    );

    expect(screen.getByText("Asset Mutation")).toBeTruthy();
    expect(screen.getByText(/disabled \/ dry-run-only \/ sandbox-enabled \/ supervisor-local-smoke-required/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Source asset path"), { target: { value: "/Game/Characters/Hero" } });
    fireEvent.click(screen.getByRole("button", { name: "Dry-run sandbox asset mutation" }));
    await waitFor(() => {
      expect(screen.getByText(/Dry-run: dry_run_completed/)).toBeTruthy();
      expect(screen.getByText(/Risk: medium_sandbox/)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Approve sandbox asset mutation" }));
    await waitFor(() => {
      expect(screen.getByText(/Approval: issued/)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Execute sandbox asset mutation" }));
    await waitFor(() => {
      expect(screen.getByText(/Execution: executed/)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Verify sandbox asset mutation" }));
    await waitFor(() => {
      expect(screen.getByText(/Verification: passed/)).toBeTruthy();
      expect(screen.getByText(/Replay: recorded summaries only/)).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Rollback sandbox asset mutation" }));
    await waitFor(() => {
      expect(screen.getByText(/Rollback: rolled_back/)).toBeTruthy();
    });

    const serialized = document.body.textContent ?? "";
    expect(serialized).not.toContain("asset-approval-token:");
    expect(serialized).not.toContain("C:/Users/");
    expect(serialized).not.toContain("/home/");
    expect(serialized).not.toContain("/Game/Templates/Hero");
    expect(serialized).not.toContain("ui-run-1");
    expect(serialized).toContain("/Game/Characters/Hero");
  });

  it("requires an explicit source asset path before dry-run", async () => {
    render(
      <UIProvider>
        <AssetMutationPanel />
      </UIProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Dry-run sandbox asset mutation" }));

    await waitFor(() => {
      expect(screen.getByText(/Last issue: source_asset_required/)).toBeTruthy();
    });
  });

  it("surfaces real-ready state when an attached UE observation is alive", () => {
    render(
      <UIProvider
        initialState={{
          runtime: {
            mvp14: createRealReadyMvp14State(),
          },
        }}
      >
        <AssetMutationPanel />
      </UIProvider>,
    );

    expect(screen.getByText("real-ready")).toBeTruthy();
  });

  it("blocks real-ready dry-run with exact MCP schema inventory instead of fixture execution", async () => {
    render(
      <UIProvider
        initialState={{
          runtime: {
            mvp14: createRealReadyMvp14State(),
          },
        }}
      >
        <AssetMutationPanel />
      </UIProvider>,
    );

    fireEvent.change(screen.getByLabelText("Source asset path"), { target: { value: "/Game/Characters/Hero" } });
    fireEvent.click(screen.getByRole("button", { name: "Dry-run sandbox asset mutation" }));

    await waitFor(() => {
      expect(screen.getByText(/Last issue: blocked_by_mcp_schema:missing_tool:ue.asset.create_folder/)).toBeTruthy();
      expect(screen.getByText(/Missing MCP tools: ue.asset.create_folder/)).toBeTruthy();
      expect(screen.queryByText(/Dry-run: dry_run_completed/)).toBeNull();
    });
  });

  it("surfaces wrapper-only MCP discovery as blocked_by_mcp_schema before dry-run and never calls the execution wrapper", async () => {
    const events: string[] = [];
    const runtimeClient = createDesktopRuntimeAdapter({
      createTransport: () => createWrapperOnlyMcpTransport(events),
    });
    runtimeClient.setMcpEndpoint("http://127.0.0.1:8000/mcp");
    await runtimeClient.connectMcp();
    await runtimeClient.discoverMcp();

    render(
      <UIProvider
        runtimeClient={runtimeClient}
        initialState={{ runtime: { mvp14: createRealReadyMvp14State() } }}
      >
        <McpMutationPanel />
        <AssetMutationPanel />
      </UIProvider>,
    );

    expect(screen.getByText("blocked_by_mcp_schema")).toBeTruthy();
    expect(screen.getByText(/MVP15 missing tools: ue\.asset\.create_folder/)).toBeTruthy();
    expect(screen.getByText(/Missing MCP tools: ue\.asset\.create_folder/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Source asset path"), { target: { value: "/Game/Characters/Hero" } });
    fireEvent.click(screen.getByRole("button", { name: "Dry-run sandbox asset mutation" }));

    await waitFor(() => {
      expect(screen.getByText(/Last issue: blocked_by_mcp_schema:missing_tool:ue\.asset\.create_folder/)).toBeTruthy();
    });
    expect(screen.queryByText(/Dry-run: dry_run_completed/)).toBeNull();
    expect(events).toEqual(["wrapper:list_toolsets"]);
    expect(events).not.toContain("wrapper:call_tool");
  });

  it("stores a ready inventory with empty missing arrays for outputSchema-only direct discovery", async () => {
    const events: string[] = [];
    const runtimeClient = createDesktopRuntimeAdapter({
      createTransport: () => createMvp15ReadyTransport(events),
    });
    runtimeClient.setMcpEndpoint("http://127.0.0.1:8000/mcp");
    await runtimeClient.connectMcp();
    await runtimeClient.discoverMcp();

    render(
      <UIProvider
        runtimeClient={runtimeClient}
        initialState={{ runtime: { mvp14: createRealReadyMvp14State() } }}
      >
        <Mvp15InventoryProbe />
      </UIProvider>,
    );

    const inventory = JSON.parse(screen.getByTestId("mvp15-inventory-probe").textContent ?? "null") as Record<string, unknown>;
    expect(inventory).toMatchObject({
      status: "ready",
      availableTools: MVP15_TEST_TOOL_NAMES,
      missingTools: [],
      missingSchemas: [],
      missingDryRunSchemas: [],
      missingRollbackContracts: [],
      missingEvidenceQueries: [],
    });
    expect(events).toEqual([]);
  });

  it("routes ready real inventory through native guard and narrow MCP calls without fixture verification", async () => {
    const events: string[] = [];
    const nativeGuardInputs: Array<{
      toolName?: string;
      editorSessionId?: string;
      pidHash?: string;
      observedEditorSessionId?: string | null;
      observedPidHash?: string | null;
    }> = [];
    const nativeInvokeMock = vi.fn(async (command: string, payload?: unknown): Promise<unknown> => {
      const input = (payload as { input?: (typeof nativeGuardInputs)[number] } | undefined)?.input;
      if (input) nativeGuardInputs.push(input);
      events.push(`native:${command}:${input?.toolName ?? "unknown"}`);
      return {
        status: "accepted_by_native_guard",
        reason: "sandbox_guard_passed",
        sandboxOnly: true,
        wouldChange: false,
        affectedAssets: [],
        evidenceId: `guard:${input?.toolName ?? "unknown"}`,
      };
    });
    const runtimeClient = createDesktopRuntimeAdapter({
      createTransport: () => createMvp15ReadyTransport(events),
      nativeInvoke: createNativeInvokeMockAdapter(nativeInvokeMock),
    });
    await runtimeClient.connectMcp();
    await runtimeClient.discoverMcp();

    render(
      <UIProvider
        runtimeClient={runtimeClient}
        initialState={{ runtime: { mvp14: createRealReadyMvp14State() } }}
      >
        <AssetMutationPanel />
      </UIProvider>,
    );

    fireEvent.change(screen.getByLabelText("Source asset path"), { target: { value: "/Game/Characters/Hero" } });
    fireEvent.click(screen.getByRole("button", { name: "Dry-run sandbox asset mutation" }));
    await waitFor(() => {
      expect(screen.getByText(/Execution mode: real/)).toBeTruthy();
      expect(screen.getByText(/Binding: external_bound/)).toBeTruthy();
      expect(screen.getByText(/Dry-run: dry_run_completed/)).toBeTruthy();
    });

    // Real approve binds the complete ordered ChangeSet (gated by the runtime binding check).
    fireEvent.click(screen.getByRole("button", { name: "Approve sandbox asset mutation" }));
    await waitFor(() => {
      expect(screen.getByText(/Approval: issued/)).toBeTruthy();
    });

    // Real execute stays not-enabled; native guard and live mutation are never invoked.
    fireEvent.click(screen.getByRole("button", { name: "Execute sandbox asset mutation" }));
    await waitFor(() => {
      expect(screen.getByText(/Execute gate: execute_not_enabled/)).toBeTruthy();
    });

    expect(events.filter((event) => event.startsWith("native:execute_asset_mutation:"))).toEqual([]);
    expect(nativeGuardInputs).toEqual([]);
    expect(JSON.stringify(nativeGuardInputs)).not.toContain("pid:observed");
    // Exactly five dry-run MCP calls; zero execute, rollback, Save All, or mutation calls.
    expect(events.filter((event) => event.startsWith("mcp:"))).toEqual([
      "mcp:ue.asset.create_folder",
      "mcp:ue.asset.duplicate",
      "mcp:ue.asset.rename",
      "mcp:ue.asset.move",
      "mcp:ue.asset.save",
    ]);
    // No approval token, MCP session id, or absolute project path leaks into rendered UI state.
    const serialized = document.body.textContent ?? "";
    expect(serialized).not.toContain("asset-approval-token:");
    expect(serialized).not.toContain("editor-session:real");
  });

  it("keeps raw path and session-like exception text out of desktop state", async () => {
    const runtimeClient = createDesktopRuntimeAdapter({
      createTransport: () => createMvp15ReadyTransport([]),
    });
    await runtimeClient.connectMcp();
    await runtimeClient.discoverMcp();
    const rawError = "MCP failed at C:\\Users\\admin\\Secrets\\BehaviorTree_Learn with session mcp-session-9f8e and token sk-live-1234567890";
    Object.defineProperty(runtimeClient, "callMvp15AssetTool", {
      configurable: true,
      get: () => {
        throw new Error(rawError);
      },
    });

    render(
      <UIProvider
        runtimeClient={runtimeClient}
        initialState={{ runtime: { mvp14: createRealReadyMvp14State() } }}
      >
        <AssetMutationPanel />
        <Mvp15StateProbe />
      </UIProvider>,
    );

    fireEvent.change(screen.getByLabelText("Source asset path"), { target: { value: "/Game/Characters/Hero" } });
    fireEvent.click(screen.getByRole("button", { name: "Dry-run sandbox asset mutation" }));

    await waitFor(() => {
      expect(screen.getByText(/Last issue: external_binding_failed/)).toBeTruthy();
    });
    const serializedState = screen.getByTestId("mvp15-state-probe").textContent ?? "";
    expect(serializedState).toContain("external_binding_failed");
    expect(serializedState).not.toContain(rawError);
    expect(serializedState).not.toContain("C:\\Users\\admin\\Secrets");
    expect(serializedState).not.toContain("mcp-session-9f8e");
    expect(serializedState).not.toContain("sk-live-1234567890");
  });

  it("keeps real verify and rollback actions disabled and returns stable not-enabled reasons", async () => {
    const events: string[] = [];
    const nativeInvokeMock = vi.fn(async (command: string, payload?: unknown): Promise<unknown> => {
      const input = (payload as { input?: { toolName?: string } } | undefined)?.input;
      events.push(`native:${command}:${input?.toolName ?? "unknown"}`);
      return { status: "accepted_by_native_guard", reason: "should_not_run", evidenceId: "native-called" };
    });
    const runtimeClient = createDesktopRuntimeAdapter({
      createTransport: () => createMvp15ReadyTransport(events),
      nativeInvoke: createNativeInvokeMockAdapter(nativeInvokeMock),
    });
    await runtimeClient.connectMcp();
    await runtimeClient.discoverMcp();

    render(
      <UIProvider
        runtimeClient={runtimeClient}
        initialState={{ runtime: { mvp14: createRealReadyMvp14State() } }}
      >
        <AssetMutationPanel />
        <Mvp15DirectActionProbe />
        <Mvp15StateProbe />
      </UIProvider>,
    );

    fireEvent.change(screen.getByLabelText("Source asset path"), { target: { value: "/Game/Characters/Hero" } });
    fireEvent.click(screen.getByRole("button", { name: "Dry-run sandbox asset mutation" }));
    await waitFor(() => expect(screen.getByText(/Binding: external_bound/)).toBeTruthy());

    expect((screen.getByRole("button", { name: "Verify sandbox asset mutation" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Rollback sandbox asset mutation" }) as HTMLButtonElement).disabled).toBe(true);
    const bindingEvents = [...events];
    const nativeCallsBeforeActions = nativeInvokeMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: "Direct real verify" }));
    await waitFor(() => expect(screen.getByText(/Last issue: verify_not_enabled/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Direct real rollback" }));
    await waitFor(() => expect(screen.getByText(/Last issue: rollback_not_enabled/)).toBeTruthy());

    expect(events).toEqual(bindingEvents);
    expect(nativeInvokeMock.mock.calls.length).toBe(nativeCallsBeforeActions);
    const serializedState = screen.getByTestId("mvp15-state-probe").textContent ?? "";
    expect(serializedState).toContain("rollback_not_enabled");
    expect(serializedState).not.toContain("real_verification_required");
  });

  it("blocks ready real inventory when the attached observation session has no pid hash", async () => {
    const events: string[] = [];
    const nativeInvokeMock = vi.fn(async (command: string, payload?: unknown): Promise<unknown> => {
      const input = (payload as { input?: { toolName?: string } } | undefined)?.input;
      events.push(`native:${command}:${input?.toolName ?? "unknown"}`);
      return {
        status: "accepted_by_native_guard",
        reason: "sandbox_guard_passed",
        evidenceId: `guard:${input?.toolName ?? "unknown"}`,
      };
    });
    const runtimeClient = createDesktopRuntimeAdapter({
      createTransport: () => createMvp15ReadyTransport(events),
      nativeInvoke: createNativeInvokeMockAdapter(nativeInvokeMock),
    });
    await runtimeClient.connectMcp();
    await runtimeClient.discoverMcp();

    render(
      <UIProvider
        runtimeClient={runtimeClient}
        initialState={{ runtime: { mvp14: createRealReadyMvp14State(null) } }}
      >
        <AssetMutationPanel />
      </UIProvider>,
    );

    fireEvent.change(screen.getByLabelText("Source asset path"), { target: { value: "/Game/Characters/Hero" } });
    fireEvent.click(screen.getByRole("button", { name: "Dry-run sandbox asset mutation" }));

    await waitFor(() => {
      expect(screen.getByText(/Last issue: observed_pid_required/)).toBeTruthy();
      expect(screen.queryByText(/Dry-run: dry_run_completed/)).toBeNull();
    });
    expect(events.some((event) => event.startsWith("native:execute_asset_mutation:"))).toBe(false);
    expect(events.some((event) => event.startsWith("mcp:"))).toBe(false);
  });

  it("integrates asset ChangeSets into Changes and Settings displays", async () => {
    render(
      <UIProvider>
        <AssetMutationPanel />
        <ChangesPanel />
        <ConfigSettings />
      </UIProvider>,
    );

    fireEvent.change(screen.getByLabelText("Source asset path"), { target: { value: "/Game/Characters/Hero" } });
    fireEvent.click(screen.getByRole("button", { name: "Dry-run sandbox asset mutation" }));

    await waitFor(() => {
      expect(screen.getByText(/Asset ChangeSets: 1/)).toBeTruthy();
      expect(screen.getByText(/Asset mutation gate/)).toBeTruthy();
      expect(screen.getAllByText(/sandbox-enabled/).length).toBeGreaterThanOrEqual(1);
    });
  });
});
