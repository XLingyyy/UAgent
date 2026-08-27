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
import {
  collectMvp15dProductAuthority,
  collectMvp15dRenderedNegativeCase,
  collectMvp15dUiAuthority,
  createDesktopRuntimeAdapter,
  type Mvp15dProductObservationPort,
  type Mvp15dProductRetractionRaw,
} from "./desktop-runtime-adapter";
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
import * as Runtime from "@uagent/runtime";
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

describe("MVP15D authoritative product observations", () => {
  const receipt = (label: string, request: Record<string, unknown> = {}) => ({
    receiptId: `fixture-receipt:${label}`,
    request,
  });
  it("installs production observation ports only after the fixed bridge activates its native ledger", async () => {
    let sequence = 0;
    const nativeInvokeMock = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      if (command !== "mvp15d_bridge_observe_native_state") {
        return { status: "unavailable", reason: "fixed_wiring_test" };
      }
      expect(args).toMatchObject({
        input: {
          schemaVersion: "uagent.mvp15d.native-state-observation.v1",
          kind: "renderer_process",
        },
      });
      sequence += 1;
      return {
        schemaVersion: "uagent.mvp15d.native-state-observation.v1",
        receiptId: `mvp15d-observation-receipt:${String(sequence).padStart(64, "a")}`,
        request: { reason: "fixed_app_activation", taskId: "TASK-MVP15D-FIXED-WIRING" },
        observation: {
          status: "begun",
          rendererInstanceId: "renderer-process:4243:1",
          processIdentitySha256: "a".repeat(64),
        },
      };
    });
    const nativeInvoke = nativeInvokeMock as NativeInvoke;
    const runtime = createDesktopRuntimeAdapter({ nativeInvoke });

    expect(runtime.getMvp15dProductObservationPort?.()).toBeNull();
    expect(runtime.getMvp15dUiObservationPort?.()).toBeNull();
    nativeInvokeMock.mockClear();
    await runtime.activateMvp15dFixedObservationAuthority?.({
      taskId: "TASK-MVP15D-FIXED-WIRING",
      phase: "product-capture",
      session: "fixed-product-session-0001",
      generation: 7,
      receiptLedgerEnabled: true,
    });

    expect(runtime.getMvp15dProductObservationPort?.()).not.toBeNull();
    expect(runtime.getMvp15dUiObservationPort?.()).toBeNull();
    expect(nativeInvokeMock).toHaveBeenCalledTimes(1);
  });

  it("accepts a renderer restart acknowledgement window with serde_json wire key order", async () => {
    const { StreamableHttpTransport: RealStreamableHttpTransport } =
      await vi.importActual<typeof import("@uagent/mcp-client")>("@uagent/mcp-client");
    vi.mocked(StreamableHttpTransport).mockImplementation(
      (options) => new RealStreamableHttpTransport(options),
    );
    const taskId = "TASK-MVP15D-RENDERER-WIRE-ORDER";
    const handoffId = `renderer-handoff:${"b".repeat(64)}`;
    const predecessorWindowIdentitySha256 = "c".repeat(64);
    const predecessorWindow = {
      schemaVersion: "uagent.mvp15d.predecessor-window-identity.v1",
      status: "observed",
      windowLabel: "main",
      taskId,
      phase: "product-capture",
      handoffId,
      stableIdentitySha256: predecessorWindowIdentitySha256,
    };
    const acknowledgementWindow = {
      handoffId,
      phase: "product-capture",
      schemaVersion: "uagent.mvp15d.predecessor-window-identity.v1",
      stableIdentitySha256: predecessorWindowIdentitySha256,
      status: "observed",
      taskId,
      windowLabel: "main",
    };
    const harness = createMvp15dNativeBoundaryHarness({
      handleNativeCommand: async (command) => {
        if (command !== "mvp15d_bridge_claim_renderer_restart") return undefined;
        return {
          schemaVersion: "uagent.mvp15d.renderer-restart-claim-result.v3",
          handoffId,
          claimReceiptId: `mvp15d-observation-receipt:${"f".repeat(64)}`,
          requestReceiptId: `mvp15d-observation-receipt:${"1".repeat(64)}`,
          requestReceiptRequest: { schemaVersion: "uagent.mvp15d.renderer-restart-request.v2" },
          parentAcknowledgementReceiptId: `mvp15d-observation-receipt:${"2".repeat(64)}`,
          parentAcknowledgementReceiptRequest: {
            handoffId,
            phase: "product-capture",
            predecessorWindow: acknowledgementWindow,
            schemaVersion: "uagent.mvp15d.renderer-parent-lifecycle-acknowledgement.v2",
            taskId,
          },
          parentAcknowledgementReceiptSequence: 2,
          claimReceiptRequest: { predecessorWindowIdentitySha256 },
          segment: {},
          predecessorWindow,
        };
      },
    });
    const adapter = createDesktopRuntimeAdapter({
      nativeInvoke: harness.nativeInvoke,
    });
    await adapter.activateMvp15dFixedObservationAuthority?.({
      taskId,
      phase: "product-capture",
      session: "renderer-wire-order-session",
      generation: 1,
      receiptLedgerEnabled: true,
      minimumMcpGeneration: 1,
      predecessorWindowIdentitySha256,
    });

    await expect(
      adapter.resumeMvp15dProductAuthority?.(handoffId, "http://127.0.0.1:18765/mcp"),
    ).rejects.toThrow("mvp15d_renderer_successor_segment_invalid");
  });

  it("drives the production product port through raw MCP and native calls", async () => {
    const { StreamableHttpTransport: RealStreamableHttpTransport } =
      await vi.importActual<typeof import("@uagent/mcp-client")>("@uagent/mcp-client");
    vi.mocked(StreamableHttpTransport).mockImplementation(
      (options) => new RealStreamableHttpTransport(options),
    );
    const harness = createMvp15dNativeBoundaryHarness();
    const adapter = createDesktopRuntimeAdapter({
      nativeInvoke: harness.nativeInvoke,
    });
    await makeMvp15DForwardReady(adapter);
    await adapter.activateMvp15dFixedObservationAuthority?.({
      taskId: "TASK-MVP15D-FIXED-RAW-PRODUCT",
      phase: "product-capture",
      session: "fixed-product-session-raw-0001",
      generation: 9,
      receiptLedgerEnabled: true,
    });

    await expect(collectMvp15dProductAuthority(
      adapter.getMvp15dProductObservationPort!()!,
    )).rejects.toThrow("native_handoff_requires_production_rust");
    const fixedWireCalls = harness.wireCalls.filter(({ mode }) => mode === "on" || mode === "off");
    expect(fixedWireCalls.filter(({ method }) => method === "initialize").length).toBeGreaterThanOrEqual(8);
    expect(fixedWireCalls.filter(({ method }) => method === "tools/list").length).toBeGreaterThanOrEqual(8);
    expect(fixedWireCalls.filter(({ mode, toolName }) => mode === "on" && toolName !== null)
      .map(({ toolName }) => toolName)).toEqual(["list_toolsets", "describe_toolset"]);
    expect(fixedWireCalls.filter(({ mode, toolName }) => mode === "off" && toolName !== null)).toEqual([]);
    const initializedSessions = fixedWireCalls
      .filter(({ method }) => method === "initialize")
      .map(({ responseSessionId }) => responseSessionId);
    expect(new Set(initializedSessions).size).toBe(initializedSessions.length);
    expect(fixedWireCalls.filter(({ requestSessionId }) => requestSessionId !== null).every(
      ({ requestSessionId, responseSessionId }) => requestSessionId === responseSessionId,
    )).toBe(true);
    expect(harness.nativeCommands.filter((command) => command === "attest_mvp15_companion").length)
      .toBeGreaterThanOrEqual(7);
    expect(harness.nativeCommands.filter((command) => command === "retract_mvp15_companion_approvals").length)
      .toBeGreaterThanOrEqual(6);
    expect(harness.nativeCommands).toContain("mcp_streamable_http_request");
    expect(harness.nativeCommands).toContain("mvp15d_bridge_observe_native_state");
    expect(harness.nativeCommands).toContain("mvp15d_bridge_request_renderer_restart");
    expect(harness.nativeCommands).not.toContain("mvp15d_bridge_claim_renderer_restart");
    expect(harness.nativeCommands).not.toContain("mvp15d_bridge_issue_observation_receipt");
  });

  it("pins renderer restart to the verified ready connect generation during a concurrent discovery", async () => {
    const { StreamableHttpTransport: RealStreamableHttpTransport } =
      await vi.importActual<typeof import("@uagent/mcp-client")>("@uagent/mcp-client");
    vi.mocked(StreamableHttpTransport).mockImplementation(
      (options) => new RealStreamableHttpTransport(options),
    );
    const harness = createMvp15dNativeBoundaryHarness();
    const adapterRef: { current: ReturnType<typeof createDesktopRuntimeAdapter> | null } = {
      current: null,
    };
    let concurrentDiscoveryObserved = false;
    const nativeInvoke: NativeInvoke = async <T = unknown>(command: string, payload?: unknown) => {
      const input = (payload as { input?: Record<string, unknown> } | undefined)?.input ?? {};
      const request = (input.request as Record<string, unknown> | undefined) ?? {};
      if (
        command === "mvp15d_bridge_observe_native_state" &&
        input.kind === "renderer_process" &&
        request.reason === "renderer_restart" &&
        request.stage === "predecessor" &&
        !concurrentDiscoveryObserved
      ) {
        concurrentDiscoveryObserved = true;
        await adapterRef.current!.discoverMcp();
      }
      return harness.nativeInvoke<T>(command, payload);
    };
    const adapter = createDesktopRuntimeAdapter({ nativeInvoke });
    adapterRef.current = adapter;
    await makeMvp15DForwardReady(adapter);
    await adapter.activateMvp15dFixedObservationAuthority?.({
      taskId: "TASK-MVP15D-RENDERER-GENERATION-BINDING",
      phase: "product-capture",
      session: "renderer-generation-binding-session",
      generation: 1,
      receiptLedgerEnabled: true,
    });

    await expect(
      collectMvp15dProductAuthority(adapter.getMvp15dProductObservationPort!()!),
    ).rejects.toThrow("native_handoff_requires_production_rust");
    const restartIndex = harness.nativeCommands.lastIndexOf("mvp15d_bridge_request_renderer_restart");
    const restartInput = harness.nativeInputs[restartIndex]!;
    const segment = restartInput.segment as Record<string, unknown>;
    const readyDiscovery = segment.readyDiscovery as Record<string, unknown>;
    const connectCall = readyDiscovery.connectCall as Record<string, unknown>;
    const connectRequest = connectCall.request as Record<string, unknown>;
    const connectIntent = connectRequest.intent as Record<string, unknown>;
    const readyConnectGeneration = Number(connectIntent.connectionGeneration);
    const latestObservedGeneration = Math.max(
      ...harness.nativeInputs.flatMap((candidate) => {
        const observation = candidate.observation as Record<string, unknown> | undefined;
        return Number.isSafeInteger(observation?.connectionGeneration)
          ? [Number(observation?.connectionGeneration)]
          : [];
      }),
    );
    expect(concurrentDiscoveryObserved).toBe(true);
    expect(Number.isSafeInteger(readyConnectGeneration)).toBe(true);
    expect(latestObservedGeneration).toBeGreaterThan(readyConnectGeneration);
    expect(restartInput.predecessorMcpGeneration).toBe(readyConnectGeneration);
  });

  it("resolves an opaque trusted root before creating and discovering the fixed phase listener", async () => {
    const rawRoot = "G:/Fixture/TrustedFinalHost";
    const nativeRoots: Array<{ command: string; rootRef: unknown }> = [];
    const owner = {
      processId: "managed-owner-trusted-root",
      pidHash: "managed-pid-trusted-root",
      pid: 7_101,
      processCreationFiletime: "133000000000010101",
      listenerInstanceSha256: "a".repeat(64),
      ownerBindingSha256: "b".repeat(64),
    };
    const harness = createMvp15dNativeBoundaryHarness({
      handleNativeCommand: async (command, input, nextReceipt) => {
        if (command === "validate_native_project_root") {
          return {
            ok: true,
            reason: "valid",
            displayRoot: "[project-root]/TrustedFinalHost",
            projectName: "TrustedFinalHost",
            engine: { label: "UE 5.8", association: "5.8", source: "uproject" },
          };
        }
        if (command === "trust_native_project_root") {
          return {
            rootId: "root:trusted-final-host",
            displayRoot: "[project-root]/TrustedFinalHost",
            trustState: "trusted",
          };
        }
        if (command === "create_managed_editor_process") {
          nativeRoots.push({ command, rootRef: input.rootRef });
          return {
            schemaVersion: "uagent.mvp15d.managed-editor-process-create-result.v2",
            status: "ready",
            reason: "task_owned_listener_accepting",
            purpose: "phase_listener_owner",
            ownerTaskId: input.taskId,
            ownerPhase: input.phase,
            processPid: owner.pid,
            processCreationFiletime: owner.processCreationFiletime,
            listenerInstanceSha256: owner.listenerInstanceSha256,
            ownerBindingSha256: owner.ownerBindingSha256,
            process: {
              id: owner.processId,
              pidHash: owner.pidHash,
              displayName: "UnrealEditor-Cmd.exe",
              source: "managed",
            },
            nativeReceiptId: nextReceipt(),
          };
        }
        if (command === "discover_editor_processes") {
          nativeRoots.push({ command, rootRef: input.rootRef });
          return {
            status: "ready",
            reason: "task_owned_managed_process_matched",
            processes: [{
              id: owner.processId,
              pidHash: owner.pidHash,
              displayName: "UnrealEditor-Cmd.exe",
              displayExecutableHash: "fixture-executable",
              displayProjectHint: "[project-root]/TrustedFinalHost.uproject",
              processState: "running",
              discoveredAt: 1,
              expiresAt: 9_999_999_999_999,
              source: "managed",
              managedPurpose: "phase_listener_owner",
              processPid: owner.pid,
              processCreationFiletime: owner.processCreationFiletime,
              listenerInstanceSha256: owner.listenerInstanceSha256,
              ownerBindingSha256: owner.ownerBindingSha256,
            }],
          };
        }
        return undefined;
      },
    });
    const projectAdapter = createNativeProjectAdapter({ invoke: harness.nativeInvoke, now: () => 1 });
    const project = await projectAdapter.addProject(rawRoot);
    const trusted = await projectAdapter.confirmTrust(project.id);
    const adapter = createDesktopRuntimeAdapter({ nativeInvoke: harness.nativeInvoke });
    await adapter.activateMvp15dFixedObservationAuthority?.({
      taskId: "TASK-MVP15D-TRUSTED-ROOT",
      phase: "product-capture",
      session: "fixed-product-session-trusted-root-0001",
      generation: 10,
      receiptLedgerEnabled: true,
    });

    expect(trusted.rootRef).not.toBe(rawRoot);
    await expect(adapter.getEditorObservationAdapter()!.discoverProcesses({
      projectId: trusted.id,
      rootRef: trusted.rootRef,
      uprojectRelativePath: "TrustedFinalHost.uproject",
    })).resolves.toMatchObject({ status: "ready" });
    expect(nativeRoots).toEqual([
      { command: "create_managed_editor_process", rootRef: rawRoot },
      { command: "discover_editor_processes", rootRef: rawRoot },
    ]);
    projectAdapter.removeProject(trusted.id);
  });

  it.each([
    ["process_not_managed", "mvp15d_product_ue_restart_termination_failed"],
    ["session_not_found", "mvp15d_product_ue_restart_termination_failed"],
    ["termination_failed", "mvp15d_product_ue_restart_termination_failed"],
    ["same_process", "mvp15d_product_ue_restart_successor_identity_stale"],
    ["stale_listener", "mvp15d_product_ue_restart_successor_identity_stale"],
    ["missing_successor_identity", "mvp15d_phase_listener_owner_identity_invalid"],
    ["same_session", "mvp15d_product_ue_restart_attach_failed"],
    ["stale_observation_generation", "mvp15d_product_ue_restart_attach_failed"],
  ] as const)("fails UE restart closed for %s", async (failure, expectedError) => {
    const { StreamableHttpTransport: RealStreamableHttpTransport } =
      await vi.importActual<typeof import("@uagent/mcp-client")>("@uagent/mcp-client");
    vi.mocked(StreamableHttpTransport).mockImplementation(
      (options) => new RealStreamableHttpTransport(options),
    );
    type Owner = {
      processId: string;
      pidHash: string;
      pid: number;
      processCreationFiletime: string;
      listenerInstanceSha256: string;
      ownerBindingSha256: string;
    };
    const rawRoot = `G:/Fixture/RestartFinalHost-${failure}`;
    let createSequence = 0;
    let sessionSequence = 0;
    let observationGeneration = 0;
    let activeOwner: Owner | null = null;
    let predecessor: Owner | null = null;
    let predecessorSessionId = "";
    const harness = createMvp15dNativeBoundaryHarness({
      handleNativeCommand: async (command, input, nextReceipt) => {
        if (command === "validate_native_project_root") {
          return {
            ok: true,
            reason: "valid",
            displayRoot: "[project-root]/FinalHost",
            projectName: "FinalHost",
            engine: { label: "UE 5.8", association: "5.8", source: "uproject" },
          };
        }
        if (command === "trust_native_project_root") {
          return {
            rootId: `root:restart-${failure}`,
            displayRoot: "[project-root]/FinalHost",
            trustState: "trusted",
          };
        }
        if (command === "create_managed_editor_process") {
          expect(input.rootRef).toBe(rawRoot);
          createSequence += 1;
          const sequence = createSequence === 2 && failure === "same_process" ? 1 : createSequence;
          const listenerSequence = createSequence === 2 && failure === "stale_listener" ? 1 : createSequence;
          activeOwner = {
            processId: `managed-owner-${sequence}`,
            pidHash: `managed-pid-${sequence}`,
            pid: 7_000 + sequence,
            processCreationFiletime: String(133_000_000_000_010_000n + BigInt(sequence)),
            listenerInstanceSha256: listenerSequence.toString(16).repeat(64).slice(0, 64),
            ownerBindingSha256: (sequence + 8).toString(16).repeat(64).slice(0, 64),
          };
          if (createSequence === 1) predecessor = { ...activeOwner };
          const response = {
            schemaVersion: "uagent.mvp15d.managed-editor-process-create-result.v2",
            status: "ready",
            reason: "task_owned_listener_accepting",
            purpose: "phase_listener_owner",
            ownerTaskId: input.taskId,
            ownerPhase: input.phase,
            processPid: activeOwner.pid,
            processCreationFiletime: activeOwner.processCreationFiletime,
            listenerInstanceSha256:
              createSequence === 2 && failure === "missing_successor_identity"
                ? null
                : activeOwner.listenerInstanceSha256,
            ownerBindingSha256: activeOwner.ownerBindingSha256,
            process: {
              id: activeOwner.processId,
              pidHash: activeOwner.pidHash,
              displayName: "UnrealEditor-Cmd.exe",
              source: "managed",
            },
            nativeReceiptId: nextReceipt(),
          };
          return response;
        }
        if (command === "discover_editor_processes") {
          if (!activeOwner) return { status: "blocked", reason: "owner_missing", processes: [] };
          return {
            status: "ready",
            reason: "native_metadata",
            processes: [{
              id: activeOwner.processId,
              pidHash: activeOwner.pidHash,
              displayName: "UnrealEditor-Cmd.exe",
              displayExecutableHash: "fixture-executable",
              displayProjectHint: "[project-root]/FinalHost.uproject",
              processState: "running",
              discoveredAt: 1,
              expiresAt: 9_999_999_999_999,
              source: "managed",
              managedPurpose: "phase_listener_owner",
              processPid: activeOwner.pid,
              processCreationFiletime: activeOwner.processCreationFiletime,
              listenerInstanceSha256: activeOwner.listenerInstanceSha256,
              ownerBindingSha256: activeOwner.ownerBindingSha256,
            }],
          };
        }
        if (command === "attach_editor_process") {
          expect(input.rootRef).toBe(rawRoot);
          sessionSequence += 1;
          observationGeneration += 1;
          const sessionId =
            sessionSequence === 2 && failure === "same_session"
              ? predecessorSessionId
              : `managed-editor-session-${sessionSequence}`;
          if (sessionSequence === 1) predecessorSessionId = sessionId;
          return {
            status: "attached",
            reason: "attached",
            sessionId,
            projectId: input.projectId,
            rootId: "root:managed-owner-test",
            uprojectDisplayPath: "[project-root]/FinalHost.uproject",
            processId: input.processId,
            pidHash: input.pidHash,
            observationGeneration:
              sessionSequence === 2 && failure === "stale_observation_generation"
                ? observationGeneration - 1
                : observationGeneration,
            mode: "attached",
            createdAt: 1,
            expiresAt: 9_999_999_999_999,
            replayOnly: false,
            nativeReceiptId: nextReceipt(),
          };
        }
        if (command === "terminate_managed_editor_process") {
          if (!predecessor) throw new Error("fixture_predecessor_missing");
          if (failure === "process_not_managed" || failure === "session_not_found") {
            return {
              schemaVersion: "uagent.mvp15d.managed-editor-process-terminate-result.v2",
              status: "blocked",
              reason: failure,
              nativeReceiptId: nextReceipt(),
            };
          }
          if (failure === "termination_failed") {
            return {
              schemaVersion: "uagent.mvp15d.managed-editor-process-terminate-result.v2",
              status: "failed",
              reason: "process_exit_not_observed",
              nativeReceiptId: nextReceipt(),
            };
          }
          const response = {
            schemaVersion: "uagent.mvp15d.managed-editor-process-terminate-result.v2",
            status: "terminated",
            reason: "task_owned_process_exited",
            purpose: "phase_listener_owner",
            ownerTaskId: input.taskId,
            ownerPhase: input.phase,
            sessionId: input.sessionId,
            processId: predecessor.processId,
            pid: predecessor.pid,
            processCreationFiletime: predecessor.processCreationFiletime,
            pidHash: predecessor.pidHash,
            observationGeneration,
            processIdentitySha256: "e".repeat(64),
            listenerInstanceSha256: predecessor.listenerInstanceSha256,
            ownerBindingSha256: predecessor.ownerBindingSha256,
            exitObserved: true,
            listenerClosed: true,
            nativeReceiptId: nextReceipt(),
          };
          activeOwner = null;
          return response;
        }
        return undefined;
      },
    });
    const projectAdapter = createNativeProjectAdapter({ invoke: harness.nativeInvoke, now: () => 1 });
    const project = await projectAdapter.addProject(rawRoot);
    const trusted = await projectAdapter.confirmTrust(project.id);
    const adapter = createDesktopRuntimeAdapter({ nativeInvoke: harness.nativeInvoke });
    await adapter.activateMvp15dFixedObservationAuthority?.({
      taskId: "TASK-MVP15D-UE-RESTART-NEGATIVE",
      phase: "product-capture",
      session: "fixed-product-session-ue-restart-negative",
      generation: 21,
      receiptLedgerEnabled: true,
    });
    const editor = adapter.getEditorObservationAdapter();
    const editorConfig = {
      projectId: "project:managed-owner-test",
      rootRef: trusted.rootRef,
      uprojectRelativePath: "FinalHost.uproject",
    };
    const discovery = await editor!.discoverProcesses(editorConfig);
    const process = discovery.processes[0]!;
    const attached = await editor!.attachProcess({
      ...editorConfig,
      processId: process.id,
      pidHash: process.pidHash,
      processDisplayName: process.displayName,
      mode: "attached",
    });
    await makeMvp15DForwardReady(adapter, "root:managed-owner-test", attached!.sessionId);

    await expect(adapter.getMvp15dProductObservationPort!()!.retract("ue_restart"))
      .rejects.toThrow(expectedError);
    expect(harness.nativeInputs.some((input) => input.reason === "ue_restart")).toBe(false);
    projectAdapter.removeProject(trusted.id);
  });

  it("drives the partial/unknown UI authority records through raw native and MCP calls", async () => {
    const { StreamableHttpTransport: RealStreamableHttpTransport } =
      await vi.importActual<typeof import("@uagent/mcp-client")>("@uagent/mcp-client");
    vi.mocked(StreamableHttpTransport).mockImplementation(
      (options) => new RealStreamableHttpTransport(options),
    );
    let attestationValid = true;
    let nativeNow = 1_000;
    let sessionSequence = 0;
    let registrationSequence = 0;
    let evidenceSequence = 0;
    const rawRoot = "G:/Projects/RawUi";
    const sessions = new Map<string, { generation: number; stopped: boolean; processAlive: boolean }>();
    const registrations = new Map<string, {
      sessionId: string;
      approvalToken: string;
      expiresAt: number;
      executed: Set<string>;
      rolledBack: Set<string>;
    }>();
    const harness = createMvp15dNativeBoundaryHarness({
      onAttestation: () => {
        attestationValid = true;
      },
      onRetraction: () => {
        attestationValid = false;
      },
      handleNativeCommand: async (command, input, nextReceipt) => {
      if (command === "validate_native_project_root") {
        return {
          ok: true,
          reason: "valid",
          displayRoot: "[project-root]/RawUi",
          projectName: "RawUi",
          engine: { label: "UE 5.8", association: "5.8", source: "uproject" },
        };
      }
      if (command === "trust_native_project_root") {
        return {
          rootId: "root:raw-ui-trusted",
          displayRoot: "[project-root]/RawUi",
          trustState: "trusted",
        };
      }
      if (command === "create_managed_editor_process") {
        expect(input.rootRef).toBe(rawRoot);
        return {
          schemaVersion: "uagent.mvp15d.managed-editor-process-create-result.v2",
          status: "created",
          reason: "task_owned_process_started",
          purpose: "negative_case_fixture",
          ownerTaskId: input.taskId,
          ownerPhase: input.phase,
          processPid: 4_000 + sessionSequence,
          processCreationFiletime: String(133_000_000_000_020_000n + BigInt(sessionSequence)),
          process: {
            id: `managed-process-${sessionSequence + 1}`,
            pidHash: `managed-pid-${sessionSequence + 1}`,
            displayName: "UAgentManagedEditorFixture.exe",
            source: "managed",
          },
          nativeReceiptId: nextReceipt(),
        };
      }
      if (command === "attach_editor_process") {
        expect(input.rootRef).toBe(rawRoot);
        sessionSequence += 1;
        const sessionId = `native-editor-session-${sessionSequence.toString().padStart(4, "0")}`;
        sessions.set(sessionId, { generation: sessionSequence, stopped: false, processAlive: true });
        return {
          status: "attached",
          sessionId,
          processId: input.processId,
          pidHash: input.pidHash,
          observationGeneration: sessionSequence,
          nativeReceiptId: nextReceipt(),
        };
      }
      if (command === "register_asset_mutation_approval") {
        registrationSequence += 1;
        const registrationId = `native-registration-${registrationSequence.toString().padStart(4, "0")}`;
        const approvalToken = `approval-token-${registrationSequence.toString().padStart(4, "0")}`;
        registrations.set(registrationId, {
          sessionId: String(input.editorSessionId ?? ""),
          approvalToken,
          expiresAt: nativeNow + 60_000,
          executed: new Set(),
          rolledBack: new Set(),
        });
        return {
          status: "registered",
          registrationId,
          approvalToken,
          nativeReceiptId: nextReceipt(),
        };
      }
      if (command === "snapshot_mvp15_asset_content_manifest") {
        evidenceSequence += 1;
        return {
          status: "observed",
          reason: "content_manifest_observed",
          evidenceId: `content-evidence-${evidenceSequence.toString().padStart(4, "0")}`,
          aggregateSha256: "c".repeat(64),
          entries: [],
          nativeReceiptId: nextReceipt(),
        };
      }
      if (command === "stop_editor_observation_session") {
        const session = sessions.get(String(input.sessionId ?? ""));
        if (session) session.stopped = true;
        return { status: "stopped", sessionId: input.sessionId, nativeReceiptId: nextReceipt() };
      }
      if (command === "terminate_managed_editor_process") {
        const session = sessions.get(String(input.sessionId ?? ""));
        if (session) session.processAlive = false;
        return {
          status: "degraded",
          reason: "process_exited",
          sessionId: input.sessionId,
          processId: `managed-process-${session?.generation ?? 0}`,
          nativeReceiptId: nextReceipt(),
        };
      }
      if (command === "record_asset_mutation_outcome") {
        return {
          status: "recorded",
          reason: "operation_outcome_recorded",
          registrationId: input.registrationId,
          phase: input.phase,
          operationId: input.operationId,
          nativeReceiptId: nextReceipt(),
        };
      }
      if (["execute_asset_mutation", "rollback_asset_mutation", "dry_run_asset_mutation"].includes(command)) {
        evidenceSequence += 1;
        const registration = registrations.get(String(input.registrationId ?? ""));
        const session = registration ? sessions.get(registration.sessionId) : undefined;
        const operation = (input.operation as { operationId?: unknown; assetPath?: unknown } | undefined) ?? {};
        const operationId = String(operation.operationId ?? "operation:default");
        const serialized = JSON.stringify(input);
        let status = "accepted_by_native_guard";
        let reason = "registered_binding_matched";
        if (command === "dry_run_asset_mutation" && input.assetMutationGateEnabled !== true) {
          status = "blocked";
          reason = "asset_mutation_gate_disabled";
        } else if (serialized.includes("/Game/Outside")) {
          status = "blocked";
          reason = "sandbox_path_required";
        } else if (!attestationValid) {
          status = "blocked";
          reason = "companion_attestation_retracted";
        } else if (!registration || !session?.processAlive) {
          status = "blocked";
          reason = "process_exited";
        } else if (session.stopped) {
          status = "blocked";
          reason = "observation_session_stopped";
        } else if (session.generation !== sessionSequence) {
          status = "blocked";
          reason = "stale_generation";
        } else if (nativeNow >= registration.expiresAt) {
          status = "blocked";
          reason = "approval_expired";
        } else if (command === "execute_asset_mutation") {
          if (registration.executed.has(operationId) || input.approvalToken !== registration.approvalToken) {
            status = "blocked";
            reason = "execute_replay";
          } else {
            registration.executed.add(operationId);
          }
        } else if (command === "rollback_asset_mutation") {
          if (registration.rolledBack.has(operationId)) {
            status = "blocked";
            reason = "rollback_replay";
          } else {
            registration.rolledBack.add(operationId);
          }
        }
        return {
          status,
          reason,
          registrationId: input.registrationId,
          phase: input.phase,
          operationId,
          evidenceId: `guard-evidence-${evidenceSequence.toString().padStart(4, "0")}`,
          nativeReceiptId: nextReceipt(),
        };
      }
      return undefined;
    },
    });
    const projectAdapter = createNativeProjectAdapter({ invoke: harness.nativeInvoke, now: () => 1 });
    const project = await projectAdapter.addProject(rawRoot);
    const trusted = await projectAdapter.confirmTrust(project.id);
    const adapter = createDesktopRuntimeAdapter({
      nativeInvoke: harness.nativeInvoke,
      mvp15dAdvanceClock: async (milliseconds) => {
        nativeNow += milliseconds;
      },
    });
    await makeMvp15DForwardReady(adapter);
    await adapter.activateMvp15dFixedObservationAuthority?.({
      taskId: "TASK-MVP15D-FIXED-RAW-UI",
      phase: "ui-lifecycle",
      session: "fixed-ui-session-raw-0001",
      generation: 11,
      receiptLedgerEnabled: true,
    });
    const executeRequest = {
      phase: "execute",
      operationIndex: 0,
      operationCount: 1,
      projectBindingId: "project-binding:raw-ui",
      aggregateDryRunHash: "a".repeat(64),
      aggregateArgsHash: "b".repeat(64),
      operation: { operationId: "operation:execute", assetPath: "/Game/UAgentSandbox/Run/Asset" },
    };
    const rollbackRequest = {
      ...executeRequest,
      phase: "rollback",
      operation: { operationId: "operation:rollback", assetPath: "/Game/UAgentSandbox/Run/Asset" },
    };
    const guardRequests = {
      execute: executeRequest,
      rollback: rollbackRequest,
      mcpExecute: {
        toolName: "ue.asset.create_folder",
        args: {
          operationId: "operation:execute",
          execute: true,
          rollback: false,
          folderPath: "/Game/UAgentSandbox/run-raw-ui",
        },
      },
      mcpRollback: {
        toolName: "ue.asset.delete",
        args: {
          operationId: "operation:rollback",
          execute: false,
          rollback: true,
          assetPath: "/Game/UAgentSandbox/run-raw-ui",
        },
      },
      invalidPath: {
        assetMutationGateEnabled: true,
        operation: { operationId: "operation:invalid", assetPath: "/Game/Outside/Asset" },
      },
    };
    const partialOperations: Array<{
      direction: "forward" | "inverse" | "control";
      action: string;
      api: string;
      request: Record<string, unknown>;
    }> = [
      ["forward", "create_run_root", "ue.asset.create_folder", false],
      ["forward", "duplicate_test01", "ue.asset.duplicate", false],
      ["forward", "rename_duplicate", "ue.asset.rename", false],
      ["forward", "move_duplicate", "ue.asset.move", true],
      ["inverse", "rename_back", "ue.asset.rename", false],
      ["inverse", "delete_duplicate", "ue.asset.delete", false],
      ["inverse", "cleanup_empty_folder", "ue.asset.delete", false],
    ].map(([direction, action, toolName, simulateUnknown], index) => ({
      direction: direction as "forward" | "inverse",
      action: String(action),
      api: "mcp_asset_tool_call",
      request: { toolName, args: { dryRun: true, index, simulateUnknown } },
    }));
    partialOperations.push(
      { direction: "control", action: "cross_ttl", api: "execute_asset_mutation", request: executeRequest },
      { direction: "control", action: "second_rollback", api: "rollback_asset_mutation", request: rollbackRequest },
    );
    const authorityContext = {
      attachInput: {
        projectId: "project-binding:raw-ui",
        rootRef: trusted.rootRef,
        processId: "editor-process:raw-ui",
        pidHash: "pid:raw-ui",
      },
      registrationInput: {
        changeSetId: "change-set:raw-ui",
        runId: "run-raw-ui",
        projectBindingId: "project-binding:raw-ui",
        trustedProjectRoot: "G:/Projects/RawUi",
        editorSessionId: "editor-session:raw-ui",
        mcpBinding: "mcp-binding:raw-ui",
        aggregateDryRunHash: "a".repeat(64),
        aggregateArgsHash: "b".repeat(64),
        requestedTtlMs: 60_000,
        operations: [
          {
            operationId: "raw-ui-operation-1",
            kind: "create_folder",
            toolName: "ue.asset.create_folder",
            pluginDryRunHash: "a".repeat(40),
            argsHash: "a".repeat(64),
            sourceAssetPath: null,
            assetPath: "/Game/UAgentSandbox/run-raw-ui",
            targetAssetPath: null,
            rollbackAction: "cleanup_empty_folder",
            rollbackToolName: "ue.asset.delete",
            saveAll: false,
            bulk: false,
          },
          {
            operationId: "raw-ui-operation-2",
            kind: "duplicate",
            toolName: "ue.asset.duplicate",
            pluginDryRunHash: "b".repeat(40),
            argsHash: "b".repeat(64),
            sourceAssetPath: "/Game/Test01",
            assetPath: null,
            targetAssetPath: "/Game/UAgentSandbox/run-raw-ui/Test01Copy",
            rollbackAction: "delete_duplicate",
            rollbackToolName: "ue.asset.delete",
            saveAll: false,
            bulk: false,
          },
          {
            operationId: "raw-ui-operation-3",
            kind: "rename",
            toolName: "ue.asset.rename",
            pluginDryRunHash: "c".repeat(40),
            argsHash: "c".repeat(64),
            sourceAssetPath: null,
            assetPath: "/Game/UAgentSandbox/run-raw-ui/Test01Copy",
            targetAssetPath: "/Game/UAgentSandbox/run-raw-ui/Test01Renamed",
            rollbackAction: "rename_back",
            rollbackToolName: "ue.asset.rename",
            saveAll: false,
            bulk: false,
          },
          {
            operationId: "raw-ui-operation-4",
            kind: "move",
            toolName: "ue.asset.move",
            pluginDryRunHash: "d".repeat(40),
            argsHash: "d".repeat(64),
            sourceAssetPath: null,
            assetPath: "/Game/UAgentSandbox/run-raw-ui/Test01Renamed",
            targetAssetPath: "/Game/UAgentSandbox/run-raw-ui/Final/Test01Renamed",
            rollbackAction: "move_back",
            rollbackToolName: "ue.asset.move",
            saveAll: false,
            bulk: false,
          },
          {
            operationId: "raw-ui-operation-5",
            kind: "save",
            toolName: "ue.asset.save",
            pluginDryRunHash: "e".repeat(40),
            argsHash: "e".repeat(64),
            sourceAssetPath: null,
            assetPath: "/Game/UAgentSandbox/run-raw-ui/Final/Test01Renamed",
            targetAssetPath: null,
            rollbackAction: "none",
            rollbackToolName: null,
            saveAll: false,
            bulk: false,
          },
        ],
      },
      guardRequests,
    };
    const n7 = await collectMvp15dRenderedNegativeCase(
      adapter.getMvp15dUiObservationPort!()!,
      "N7",
      authorityContext,
    );
    const n8 = await collectMvp15dRenderedNegativeCase(
      adapter.getMvp15dUiObservationPort!()!,
      "N8",
      authorityContext,
    );

    const authority = await collectMvp15dUiAuthority(
      adapter.getMvp15dUiObservationPort!()!,
      partialOperations,
      authorityContext,
      false,
    );

    expect(n7).toMatchObject({
      caseId: "N7",
      evidenceSource: "rendered_product_control",
      guardApi: "execute_asset_mutation",
      mcpMutationCount: 2,
    });
    expect(n7.setupCalls.map(({ request }) => request)).toHaveLength(8);
    expect(n7.cleanupCalls).toHaveLength(3);
    expect(n8).toMatchObject({
      caseId: "N8",
      evidenceSource: "rendered_product_control",
      guardApi: "rollback_asset_mutation",
      mcpMutationCount: 2,
    });
    expect(n7.runId).not.toBe("run-raw-ui");
    expect(n8.runId).not.toBe("run-raw-ui");
    expect(n8.runId).not.toBe(n7.runId);
    expect(n7.setupCalls.slice(0, 5)).toHaveLength(5);
    expect(n8.setupCalls.slice(0, 5)).toHaveLength(5);
    expect(n8.setupCalls).toHaveLength(11);
    expect(n8.cleanupCalls).toHaveLength(0);
    expect(authority.negativeCases).toHaveLength(0);
    expect(authority.partialUnknown.operationResults).toHaveLength(9);
    expect(harness.nativeCommands.filter((command) => command === "attach_editor_process")).toHaveLength(5);
    expect(harness.nativeCommands.filter((command) => command === "register_asset_mutation_approval"))
      .toHaveLength(5);
    expect(harness.nativeCommands.filter((command) => command === "snapshot_mvp15_asset_content_manifest"))
      .toHaveLength(6);
    expect(
      harness.nativeCommands.filter((command) =>
        ["execute_asset_mutation", "rollback_asset_mutation", "dry_run_asset_mutation"].includes(command),
      ),
    ).toHaveLength(10);
    expect(harness.wireCalls.filter(({ method, toolName }) => method === "tools/call" && toolName?.startsWith("ue.asset.")))
      .toHaveLength(21);
    expect(JSON.stringify(harness.nativeInputs)).not.toContain("testCaseId");
    expect(authority.partialUnknown.operationResults.at(-2)?.setupCalls.map(({ request }) => request))
      .toHaveLength(2);
    expect(authority.partialUnknown.operationResults.at(-1)?.setupCalls).toHaveLength(6);
    projectAdapter.removeProject(trusted.id);
  });

  it.each([
    ["attach_failure", 1],
    ["registration_failure", 1],
    ["invalid_create_receipt", 1],
    ["guard_failure", 1],
    ["normal_n4_success", 0],
  ] as const)("releases the N4 managed child for %s", async (failure, expectedReleaseCount) => {
    const { StreamableHttpTransport: RealStreamableHttpTransport } =
      await vi.importActual<typeof import("@uagent/mcp-client")>("@uagent/mcp-client");
    vi.mocked(StreamableHttpTransport).mockImplementation(
      (options) => new RealStreamableHttpTransport(options),
    );
    const rawRoot = `G:/Fixture/FinalHost-${failure}`;
    const activeManaged = new Map<string, { pid: number; processCreationFiletime: string }>();
    let releaseCount = 0;
    const harness = createMvp15dNativeBoundaryHarness({
      handleNativeCommand: async (command, input, nextReceipt) => {
        if (command === "validate_native_project_root") {
          return {
            ok: true,
            reason: "valid",
            displayRoot: "[project-root]/FinalHost",
            projectName: "FinalHost",
            engine: { label: "UE 5.8", association: "5.8", source: "uproject" },
          };
        }
        if (command === "trust_native_project_root") {
          return {
            rootId: `root:n4-${failure}`,
            displayRoot: "[project-root]/FinalHost",
            trustState: "trusted",
          };
        }
        if (command === "create_managed_editor_process") {
          expect(input.rootRef).toBe(rawRoot);
          const processId = "managed-process-cleanup-1";
          const identity = {
            pid: 9_001,
            processCreationFiletime: "133000000000030001",
          };
          activeManaged.set(processId, identity);
          return {
            schemaVersion: "uagent.mvp15d.managed-editor-process-create-result.v2",
            status: "created",
            reason: "task_owned_process_started",
            purpose: "negative_case_fixture",
            ownerTaskId: input.taskId,
            ownerPhase: input.phase,
            processPid: identity.pid,
            processCreationFiletime: identity.processCreationFiletime,
            process: {
              id: processId,
              pidHash: "managed-pid-cleanup-1",
              displayName: "UAgentManagedEditorFixture.exe",
              source: "managed",
            },
            ...(failure === "invalid_create_receipt" ? {} : { nativeReceiptId: nextReceipt() }),
          };
        }
        if (command === "release_managed_editor_process") {
          const identity = activeManaged.get(String(input.processId));
          if (
            !identity ||
            input.pid !== identity.pid ||
            input.processCreationFiletime !== identity.processCreationFiletime
          ) {
            return {
              schemaVersion: "uagent.mvp15d.managed-editor-process-release-result.v2",
              status: "blocked",
              reason: "managed_process_identity_mismatch",
              nativeReceiptId: nextReceipt(),
            };
          }
          activeManaged.delete(String(input.processId));
          releaseCount += 1;
          return {
            schemaVersion: "uagent.mvp15d.managed-editor-process-release-result.v2",
            status: "released",
            reason: "task_owned_process_released",
            ownerTaskId: input.taskId,
            ownerPhase: input.phase,
            processId: input.processId,
            pid: input.pid,
            processCreationFiletime: input.processCreationFiletime,
            nativeReceiptId: nextReceipt(),
          };
        }
        if (command === "attach_editor_process") {
          expect(input.rootRef).toBe(rawRoot);
          if (failure === "attach_failure") {
            return { status: "blocked", reason: "fixture_attach_failure", nativeReceiptId: nextReceipt() };
          }
          return {
            status: "attached",
            sessionId: "native-editor-session-cleanup-1",
            processId: input.processId,
            pidHash: input.pidHash,
            observationGeneration: 1,
            nativeReceiptId: nextReceipt(),
          };
        }
        if (command === "register_asset_mutation_approval") {
          if (failure === "registration_failure") {
            return { status: "blocked", reason: "fixture_registration_failure", nativeReceiptId: nextReceipt() };
          }
          return {
            status: "registered",
            registrationId: "native-registration-cleanup-1",
            approvalToken: "approval-token-cleanup-1",
            nativeReceiptId: nextReceipt(),
          };
        }
        if (command === "terminate_managed_editor_process") {
          if (failure === "guard_failure") throw new Error("fixture_guard_failure");
          activeManaged.delete("managed-process-cleanup-1");
          return {
            status: "degraded",
            reason: "process_exited",
            sessionId: input.sessionId,
            processId: "managed-process-cleanup-1",
            nativeReceiptId: nextReceipt(),
          };
        }
        if (command === "execute_asset_mutation") {
          return {
            status: "blocked",
            reason: "process_exited",
            registrationId: input.registrationId,
            phase: "execute",
            nativeReceiptId: nextReceipt(),
          };
        }
        return undefined;
      },
    });
    const projectAdapter = createNativeProjectAdapter({ invoke: harness.nativeInvoke, now: () => 1 });
    const project = await projectAdapter.addProject(rawRoot);
    const trusted = await projectAdapter.confirmTrust(project.id);
    const adapter = createDesktopRuntimeAdapter({ nativeInvoke: harness.nativeInvoke });
    await makeMvp15DForwardReady(adapter);
    await adapter.activateMvp15dFixedObservationAuthority?.({
      taskId: "TASK-MVP15D-MANAGED-CLEANUP",
      phase: "ui-lifecycle",
      session: "fixed-ui-session-cleanup-0001",
      generation: 17,
      receiptLedgerEnabled: true,
    });
    const port = adapter.getMvp15dUiObservationPort!()!;
    const begin = () => port.beginSession({
      caseId: "N4",
      attachInput: {
        projectId: "project:managed-cleanup",
        rootRef: trusted.rootRef,
        uprojectRelativePath: "FinalHost.uproject",
      },
      registrationInput: { changeSetId: "change-set:managed-cleanup", operations: [] },
      guardRequests: { execute: {}, rollback: {}, invalidPath: {} },
    });

    if (["attach_failure", "registration_failure", "invalid_create_receipt"].includes(failure)) {
      await expect(begin()).rejects.toThrow();
    } else {
      const binding = await begin();
      if (failure === "guard_failure") {
        await expect(port.guard({ ...binding, caseId: "N4", api: "execute_asset_mutation" }))
          .rejects.toThrow("fixture_guard_failure");
      } else {
        await expect(port.guard({ ...binding, caseId: "N4", api: "execute_asset_mutation" }))
          .resolves.toBeTruthy();
      }
    }
    expect(activeManaged.size).toBe(0);
    expect(releaseCount).toBe(expectedReleaseCount);
    expect(harness.nativeCommands.filter((command) => command === "release_managed_editor_process"))
      .toHaveLength(expectedReleaseCount);
    projectAdapter.removeProject(trusted.id);
  });

  it("calls two actual configuration discoveries and all six native retraction transitions", async () => {
    const calls: string[] = [];
    let generation = 10;
    const observationPort = {
      readMutationCounters: async () => ({ dryRun: 0, execute: 0, rollback: 0 }),
      discover: async ({ toolSearchEnabled }) => {
        calls.push(`discover:${toolSearchEnabled ? "on" : "off"}`);
        generation += 1;
        return {
          mode: toolSearchEnabled ? "on" : "off",
          configCall: receipt(`config-${generation}`, { intent: { toolSearchMode: toolSearchEnabled ? "on" : "off" } }),
          rendererInstanceCall: receipt(`renderer-${generation}`),
          connectCall: receipt(`connect-${generation}`),
          initializeCall: receipt(`initialize-${generation}`),
          discoverCall: receipt(`discover-${generation}`),
          normalizeCall: receipt(`normalize-${generation}`),
          fingerprintCall: receipt(`fingerprint-${generation}`),
          nativeAttestation: receipt(`attestation-${generation}`),
          mutationCounterCall: receipt(`counter-${generation}`),
          toolSearchCalls: toolSearchEnabled ? [receipt(`tool-search-${generation}`)] : [],
        };
      },
      retract: async (reason) => {
        calls.push(`retract:${reason}`);
        generation += 1;
        const rendererRestart = reason === "renderer_restart";
        const readyDiscovery = {
          mode: "off" as const,
          configCall: receipt(`ready-config-${generation}`, { intent: { toolSearchMode: "off" } }),
          rendererInstanceCall: receipt(`ready-renderer-${generation}`),
          connectCall: receipt(`ready-connect-${generation}`),
          initializeCall: receipt(`ready-initialize-${generation}`),
          discoverCall: receipt(`ready-discover-${generation}`),
          normalizeCall: receipt(`ready-normalize-${generation}`),
          fingerprintCall: receipt(`ready-fingerprint-${generation}`),
          nativeAttestation: receipt(`ready-attestation-${generation}`),
          mutationCounterCall: receipt(`ready-counter-${generation}`),
          toolSearchCalls: [],
        };
        return {
          reason,
          readyDiscovery,
          rendererInstanceCall: receipt(`retraction-renderer-${generation}-${rendererRestart}`),
          transitionCall: receipt(`transition-${generation}`, { reason }),
          nativeRetraction: receipt(`native-retraction-${generation}`, { reason }),
        } satisfies Mvp15dProductRetractionRaw;
      },
    } satisfies Mvp15dProductObservationPort;
    const runtime = createDesktopRuntimeAdapter({
      nativeInvoke: null,
      mvp15dFixtureProductObservationPort: observationPort,
    });
    expect(runtime.getMvp15dProductObservationPort?.()).toBe(observationPort);
    const result = await collectMvp15dProductAuthority(
      runtime.getMvp15dProductObservationPort!()!,
    );

    expect(calls).toEqual([
      "discover:on",
      "discover:off",
      "retract:refresh_tools",
      "retract:reconnect",
      "retract:endpoint_change",
      "retract:renderer_restart",
      "retract:ue_restart",
      "retract:stale_completion",
    ]);
    expect(result.discoveries.map(({ mode }) => mode)).toEqual(["on", "off"]);
    expect(result.retractions).toHaveLength(6);
    expect(result.mutationAfter).toEqual(result.mutationBefore);
  });

  it("rejects a hardcoded Tool Search label that disagrees with the observed configuration", async () => {
    await expect(
      collectMvp15dProductAuthority({
        readMutationCounters: async () => ({ dryRun: 0, execute: 0, rollback: 0 }),
        discover: async ({ toolSearchEnabled }) => ({
          mode: toolSearchEnabled ? "off" : "on",
          configCall: receipt("invalid-config", { intent: { toolSearchMode: toolSearchEnabled ? "off" : "on" } }),
          rendererInstanceCall: receipt("invalid-renderer"),
          connectCall: receipt("invalid-connect"),
          initializeCall: receipt("invalid-initialize"),
          discoverCall: receipt("invalid-discover"),
          normalizeCall: receipt("invalid-normalize"),
          fingerprintCall: receipt("invalid-fingerprint"),
          nativeAttestation: receipt("invalid-attestation"),
          mutationCounterCall: receipt("invalid-counter"),
          toolSearchCalls: [],
        }),
        retract: async () => {
          throw new Error("retraction_must_not_run");
        },
      }),
    ).rejects.toThrow("mvp15d_product_discovery_observation_invalid");
  });

  it("rejects N1-N8 orchestration when an underlying native guard call is missing", async () => {
    const calls: string[] = [];
    let sessionSequence = 0;
    await expect(
      collectMvp15dUiAuthority({
        beginSession: async () => {
          sessionSequence += 1;
          const caseId = `N${sessionSequence}`;
          calls.push(`begin:${caseId}`);
          return {
            sessionId: `session-${caseId}-authority`,
            nativeSessionId: `native-${caseId}-authority`,
            runId: `run-${caseId}-authority`,
            registrationId: `registration-${caseId}-authority`,
            sessionBegin: receipt(`session-${caseId}`),
            registrationCall: receipt(`registration-${caseId}`),
          };
        },
        snapshotContent: async (binding, stage) => ({
          stage,
          registrationId: binding.registrationId,
          runId: binding.runId,
          receiptId: `fixture-content-${binding.runId}-${stage}`,
          request: { stage },
        }),
        readCounters: async (_binding, stage) => ({
          values: [0, 0, 0, 0, 0],
          receipt: receipt(`counter-${stage}`),
        }),
        guard: async ({ caseId, api }) => {
          calls.push(`guard:${caseId}:${api}`);
          if (caseId === "N4") throw new Error("native_guard_call_missing");
          return {
            guardCall: {
              receiptId: `fixture-guard-${caseId}`,
              request: { api },
            },
            setupCalls: [],
          };
        },
        runPartialOperation: async () => {
          throw new Error("partial_must_not_run");
        },
        stopObservation: async ({ sessionId }) => receipt(`stop-${sessionId}`, { sessionId }),
        disconnectMcp: async ({ sessionId }) => receipt(`disconnect-${sessionId}`, { sessionId }),
      }, [], {
        attachInput: {},
        registrationInput: {},
        guardRequests: { execute: {}, rollback: {}, invalidPath: {} },
      }),
    ).rejects.toThrow("native_guard_call_missing");
    expect(calls.filter((call) => call.startsWith("guard:"))).toEqual([
      "guard:N1:register_asset_mutation_approval",
      "guard:N2:register_asset_mutation_approval",
      "guard:N3:execute_asset_mutation",
      "guard:N4:execute_asset_mutation",
    ]);
    expect(calls).not.toContain("begin:N5");
  });
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

describe.skipIf(process.env.UAGENT_MVP15C14_READONLY_DISCOVERY !== "1")(
  "MVP15C14 controlled product-adapter read-only discovery",
  () => {
    it("publishes the live exact-six fingerprint with zero asset method calls", async () => {
      const { StreamableHttpTransport: RealStreamableHttpTransport } =
        await vi.importActual<typeof import("@uagent/mcp-client")>("@uagent/mcp-client");
      const endpoint = process.env.UAGENT_MVP15C14_ENDPOINT ?? "http://127.0.0.1:18080/mcp";
      const callCounts: Record<string, number> = {};
      const adapter = createDesktopRuntimeAdapter({
        nativeInvoke: null,
        createTransport: (transportEndpoint) => {
          const transport = new RealStreamableHttpTransport({
            endpoint: transportEndpoint,
            timeoutMs: 30_000,
          });
          return {
            sendRequest: async (request) => {
              const params = request.params as { name?: string } | undefined;
              const key =
                request.method === "tools/call"
                  ? `tools/call:${params?.name ?? "unknown"}`
                  : request.method;
              callCounts[key] = (callCounts[key] ?? 0) + 1;
              if (
                request.method === "tools/call" &&
                params?.name !== "list_toolsets" &&
                params?.name !== "describe_toolset"
              ) {
                throw new Error("forbidden_non_discovery_tool_call");
              }
              return transport.sendRequest(request);
            },
            sendNotification: (notification) => transport.sendNotification(notification),
            close: () => transport.close(),
          } satisfies McpTransportClient;
        },
      });
      let exactAssetCalls = 0;
      const originalExactAssetCall = adapter.callMvp15AssetTool;
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
          throw new Error(
            `c14_connect_failed:${sanitizeMvp15c07eLastError(adapter.getMcpState().lastError)}`,
          );
        }
        await adapter.discoverMcp();
        if (adapter.getMcpState().status !== "connected") {
          throw new Error(
            `c14_discover_failed:${sanitizeMvp15c07eLastError(adapter.getMcpState().lastError)}`,
          );
        }
        const inventory = createMvp15McpAssetToolInventory(adapter.getMvp15AssetTools());
        const fingerprint = adapter.getMvp15LiveAssetToolsetFingerprint!();

        expect(exactAssetCalls).toBe(0);
        expect(callCounts["tools/call:call_tool"] ?? 0).toBe(0);
        console.log(
          JSON.stringify({
            environment: "task-owned-product-adapter",
            connectionStatus: adapter.getMcpState().status,
            inventoryStatus: inventory.status,
            inventoryTools: inventory.availableTools,
            fingerprint,
            callCounts,
            exactAssetCalls,
            registrationCalls: 0,
            tokenCalls: 0,
            dryRunCalls: 0,
            executeCalls: 0,
            verifyCalls: 0,
            rollbackCalls: 0,
            replayCalls: 0,
            mutationCalls: 0,
          }),
        );
      } catch (error) {
        const safeLastError = sanitizeMvp15c07eLastError(
          error instanceof Error ? error.message : adapter.getMcpState().lastError,
        );
        console.error(
          JSON.stringify({
            environment: "task-owned-product-adapter",
            connectionStatus: adapter.getMcpState().status,
            fingerprint: adapter.getMvp15LiveAssetToolsetFingerprint!(),
            callCounts,
            exactAssetCalls,
            registrationCalls: 0,
            tokenCalls: 0,
            dryRunCalls: 0,
            executeCalls: 0,
            verifyCalls: 0,
            rollbackCalls: 0,
            replayCalls: 0,
            mutationCalls: 0,
            lastError: safeLastError,
          }),
        );
        throw error;
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

function exactAssetDiscoveryFixtures(
  extraTools: Array<Record<string, unknown>> = [],
): Record<string, unknown> {
  const contract = {
    schemaVersion: "ue.asset.contract.v1",
    dryRunSchema: { type: "object" },
    rollbackContract: { type: "reverse_operation" },
    affectedAssetsSchema: { type: "array" },
    evidenceQuery: { type: "read_only" },
  };
  return {
    initialize: fullDiscoveryFixtures.initialize,
    "tools/list": {
      tools: [
        ...MVP15_ASSET_TOOL_ALLOWLIST.map((name) => ({
          name,
          inputSchema: { type: "object" },
          outputSchema: contract,
        })),
        ...extraTools,
      ],
    },
    "resources/list": { resources: [] },
    "prompts/list": { prompts: [] },
  };
}

function verifiedMvp15DNativeEvidence() {
  const base = {
    schemaVersion: "uagent.ue-companion-plugin.build-manifest.v3" as const,
    taskGeneration: "final-d13-d16" as const,
    taskId: "TASK-MVP15D-UAGENT-DESKTOP-ADAPTER-TEST",
    pluginId: "UAgentAssetTools" as const,
    pluginVersion: "0.1.0" as const,
    contractVersion: "mvp15d.asset-tools.v1" as const,
    sourceCommit: "a".repeat(40),
    sourceTreeSha256: "b".repeat(64),
    physicalFixtures: [
      { path: "fixture-a.json", size: 1, sha256: "2".repeat(64), gitObjectSha256: "2".repeat(64) },
      { path: "fixture-b.json", size: 1, sha256: "3".repeat(64), gitObjectSha256: "3".repeat(64) },
    ],
    dirty: false as const,
    engineVersion: "5.8.1" as const,
    engineChangelist: 56057345 as const,
    compatibleChangelist: 55116800 as const,
    moduleBuildId: "55116800" as const,
    targetPlatform: "Win64" as const,
    configuration: "Development" as const,
    compiler: { name: "MSVC" as const, version: "14.44.35207" },
    windowsSdk: { name: "Windows SDK" as const, version: "10.0.26100.0" },
    buildCommandFingerprint: "c".repeat(64),
    buildEvidenceArtifacts: [
      { path: "logs/stdout.log", size: 1, sha256: "4".repeat(64) },
      { path: "metadata/build-command.json", size: 1, sha256: "5".repeat(64) },
      { path: "metadata/build-result.json", size: 1, sha256: "6".repeat(64) },
    ],
    artifacts: [
      { path: "Binaries/Win64/UnrealEditor-UAgentAssetTools.dll", size: 3, sha256: "f".repeat(64) },
      { path: "Binaries/Win64/UnrealEditor.modules", size: 3, sha256: "1".repeat(64) },
      { path: "Resources/mvp15d-native-binding-v2.json", size: 4, sha256: "9".repeat(64) },
      { path: "Resources/uagent-asset-tools.schema.json", size: 2, sha256: "e".repeat(64) },
      { path: "UAgentAssetTools.uplugin", size: 1, sha256: "d".repeat(64) },
    ],
    modules: [{ path: "Binaries/Win64/UnrealEditor-UAgentAssetTools.dll", size: 3, sha256: "f".repeat(64) }],
    toolNames: [
      "ue.asset.create_folder",
      "ue.asset.duplicate",
      "ue.asset.rename",
      "ue.asset.move",
      "ue.asset.delete",
      "ue.asset.save",
    ] as const,
    generatedAt: "2026-07-20T00:00:00.000Z",
    builder: { kind: "local" as const, name: "desktop-test" },
  };
  const manifest = {
    ...base,
    manifestSelfSha256: Runtime.computeMvp15DManifestSha256({
      ...base,
      manifestSelfSha256: "",
    }),
  };
  const modules = manifest.modules.map((module) => ({
    name: module.path.split("/").at(-1)!,
    size: module.size,
    sha256: module.sha256,
  }));
  const identity = {
    schemaVersion: "uagent.ue-companion-plugin.identity.v2" as const,
    pluginId: manifest.pluginId,
    pluginVersion: manifest.pluginVersion,
    contractVersion: manifest.contractVersion,
    sourceCommit: manifest.sourceCommit,
    buildManifestSha256: manifest.manifestSelfSha256,
    engineVersion: manifest.engineVersion,
    engineChangelist: manifest.engineChangelist,
    compatibleChangelist: manifest.compatibleChangelist,
    moduleBuildId: manifest.moduleBuildId,
    sourceTreeSha256: manifest.sourceTreeSha256,
    buildCommandFingerprint: manifest.buildCommandFingerprint,
    loadedModuleName: manifest.modules[0]!.path.split("/").at(-1)!,
    loadedModuleSha256: manifest.modules[0]!.sha256,
  };
  return {
    manifest,
    installedModules: modules,
    loadedModules: modules,
    descriptors: Runtime.createMvp15DCompanionToolDescriptors(identity),
  };
}

function createMvp15dNativeBoundaryHarness(options?: {
  onAttestation?: () => void;
  onRetraction?: () => void;
  handleNativeCommand?: (
    command: string,
    input: Record<string, unknown>,
    nextReceipt: () => string,
  ) => Promise<unknown | undefined>;
}) {
  const evidence = verifiedMvp15DNativeEvidence();
  const nativeCommands: string[] = [];
  const nativeInputs: Record<string, unknown>[] = [];
  const wireCalls: Array<{
    endpoint: string;
    method: string;
    toolName: string | null;
    mode: string | null;
    requestSessionId: string | null;
    responseSessionId: string | null;
  }> = [];
  let receiptSequence = 0;
  let mcpSessionSequence = 0;
  let nativeGeneration = 8_000_000_000_000_000;
  const rendererProcessGeneration = 1;
  const nextReceipt = () => {
    receiptSequence += 1;
    return `mvp15d-observation-receipt:${receiptSequence.toString(16).padStart(64, "0")}`;
  };
  const observedState = (request: Record<string, unknown>, observation: Record<string, unknown>) => ({
    schemaVersion: "uagent.mvp15d.native-state-observation.v1",
    receiptId: nextReceipt(),
    request,
    observation,
  });
  const nativeInvoke = createNativeInvokeMockAdapter(async (command, payload) => {
    nativeCommands.push(command);
    const input = (payload as { input?: Record<string, unknown> } | undefined)?.input ?? {};
    nativeInputs.push(structuredClone(input));
    if (command === "mcp_streamable_http_request") {
      if (input.method === "DELETE") {
        const observationRequest = {
          schemaVersion: "uagent.mvp15d.native-mcp-request.v2",
          httpMethod: "DELETE",
          endpoint: input.endpoint,
          body: null,
          protocolVersion: input.protocolVersion,
          sessionId: input.sessionId,
          intent: input.observation,
        };
        return {
          method: "DELETE",
          status: 204,
          body: "",
          contentType: null,
          sessionId: null,
          protocolVersion: input.protocolVersion,
          observationRequest,
          observationReceipts: { mcp_disconnect: nextReceipt() },
        };
      }
      const request = JSON.parse(String(input.body ?? "{}")) as {
        id?: string | number;
        method?: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      };
      const intent = input.observation as { toolSearchMode?: string } | undefined;
      const requestSessionId = typeof input.sessionId === "string" ? input.sessionId : null;
      let responseSessionId = requestSessionId;
      if (request.method === "initialize") {
        mcpSessionSequence += 1;
        responseSessionId = `native-mcp-session-${mcpSessionSequence.toString().padStart(4, "0")}`;
      }
      const toolName = request.method === "tools/call" ? request.params?.name ?? null : null;
      wireCalls.push({
        endpoint: String(input.endpoint ?? ""),
        method: String(request.method ?? ""),
        toolName,
        mode: intent?.toolSearchMode ?? null,
        requestSessionId,
        responseSessionId,
      });
      if (String(input.endpoint).includes("127.0.0.1:9")) {
        throw new Error("native_request_failed");
      }
      let result: unknown;
      if (request.method === "initialize") {
        result = fullDiscoveryFixtures.initialize;
      } else if (request.method === "tools/list") {
        result = intent?.toolSearchMode === "on"
          ? {
              tools: ["list_toolsets", "describe_toolset", "call_tool"].map((name) => ({
                name,
                inputSchema: { type: "object" },
              })),
            }
          : { tools: evidence.descriptors };
      } else if (request.method === "resources/list") {
        result = { resources: [] };
      } else if (request.method === "prompts/list") {
        result = { prompts: [] };
      } else if (request.method === "tools/call" && toolName === "list_toolsets") {
        result = {
          content: [{ type: "text", text: JSON.stringify({ toolsets: [{ id: "UAgentAssetTools" }] }) }],
        };
      } else if (request.method === "tools/call" && toolName === "describe_toolset") {
        result = {
          content: [{
            type: "text",
            text: JSON.stringify({
              toolset: {
                toolsetId: "UAgentAssetTools",
                methods: evidence.descriptors.map((descriptor, index) => ({
                  exactToolName: descriptor.name,
                  methodId: `asset-method-${index + 1}`,
                  schemaVersion: descriptor.schemaVersion,
                  inputSchema: descriptor.inputSchema,
                  dryRunSchema: descriptor.dryRunSchema,
                  rollbackContract: descriptor.rollbackContract,
                  affectedAssetsSchema: descriptor.affectedAssetsSchema,
                  evidenceQuery: descriptor.evidenceQuery,
                })),
              },
            }),
          }],
        };
      } else if (request.method === "tools/call") {
        const simulateUnknown = request.params?.arguments?.simulateUnknown === true;
        const args = request.params?.arguments ?? {};
        const phase = args.rollback === true ? "rollback" : "execute";
        const formalDryRun = args.dryRun === true &&
          typeof args.changeSetId === "string" &&
          typeof args.runId === "string" &&
          typeof args.operationId === "string";
        const dryRunOperation = toolName === "ue.asset.duplicate"
          ? "duplicate"
          : toolName === "ue.asset.rename"
            ? "rename"
            : toolName === "ue.asset.move"
              ? "move"
              : toolName === "ue.asset.save"
                ? "save"
                : "create_folder";
        const dryRunTargets = toolName === "ue.asset.create_folder"
          ? [String(args.folderPath)]
          : toolName === "ue.asset.duplicate"
            ? [String(args.targetAssetPath)]
            : toolName === "ue.asset.rename" || toolName === "ue.asset.move"
              ? [String(args.assetPath), String(args.targetAssetPath)]
              : [String(args.assetPath)];
        const dryRunSources = toolName === "ue.asset.duplicate"
          ? [String(args.sourceAssetPath)]
          : [];
        const rollbackAvailable = toolName !== "ue.asset.save";
        const inverseOperation = toolName === "ue.asset.create_folder"
          ? "cleanup_empty_folder"
          : toolName === "ue.asset.duplicate"
            ? "delete_duplicate"
            : toolName === "ue.asset.rename"
              ? "rename_back"
              : toolName === "ue.asset.move"
                ? "move_back"
                : "none";
        result = args.execute === true || args.rollback === true
          ? {
              structuredContent: {
                blocked: false,
                status: phase === "rollback" ? "rolled_back" : "executed",
                reasonCode: "none",
                phase,
                toolName,
                changeSetId: args.changeSetId,
                runId: args.runId,
                operationId: args.operationId,
                sideEffectObserved: true,
                effectState: "known_effect",
                rollbackAvailable: phase === "execute",
                implementationStatus: "execution_capable",
                evidenceId: `mcp-evidence-${wireCalls.length}`,
              },
            }
          : formalDryRun
            ? {
                structuredContent: {
                  blocked: false,
                  status: "dry_run_completed",
                  reasonCode: "none",
                  toolName,
                  operation: dryRunOperation,
                  phase: "dry_run",
                  changeSetId: args.changeSetId,
                  runId: args.runId,
                  operationId: args.operationId,
                  sandboxRoot: `/Game/UAgentSandbox/${String(args.runId)}`,
                  wouldChange: true,
                  wouldModify: dryRunTargets,
                  wouldRead: dryRunSources,
                  affectedAssets: {
                    readOnlySources: dryRunSources,
                    sandboxTargets: dryRunTargets,
                    externalTargets: [],
                  },
                  rollbackPlan: {
                    strategy: "ledger_inverse",
                    executionEnabled: false,
                    inverseOperation,
                  },
                  externalEvidenceQueries: [{
                    queryKind: "asset_registry_snapshot",
                    readOnly: true,
                    paths: [...dryRunSources, ...dryRunTargets],
                  }],
                  dryRunHash: wireCalls.length.toString(16).padStart(40, "a").slice(-40),
                  hashAlgorithm: "sha1",
                  schemaVersion: "mvp15c.dry-run.v1",
                  approvalRequired: true,
                  sideEffectObserved: false,
                  effectState: "known_none",
                  rollbackAvailable,
                  rollbackStatus: rollbackAvailable ? "available" : "not_available",
                  implementationStatus: "execution_capable",
                  evidenceId: `mcp-dry-run-${wireCalls.length}`,
                },
              }
          : {
              status: simulateUnknown ? "failed" : "succeeded",
              reason: simulateUnknown ? "effect_unknown" : "none",
              effectState: simulateUnknown ? "unknown" : "known_effect",
              evidenceId: `mcp-evidence-${wireCalls.length}`,
            };
      } else {
        result = null;
      }
      const observationRequest = {
        endpoint: input.endpoint,
        protocolVersion: input.protocolVersion,
        sessionId: input.sessionId ?? null,
        body: request,
        intent: input.observation,
      };
      let receiptApis: string[] = [];
      if (intent && request.method === "initialize") {
        receiptApis = ["mcp_configure_tool_search", "mcp_connect", "mcp_initialize"];
      } else if (intent && request.method === "tools/list") {
        receiptApis = ["mcp_discover", "mcp_normalize", "mcp_fingerprint"];
      } else if (intent && request.method === "tools/call") {
        receiptApis = [
          toolName === "list_toolsets" || toolName === "describe_toolset" || toolName === "call_tool"
            ? "mcp_tool_search_call"
            : "mcp_asset_tool_call",
        ];
      } else if (intent) {
        receiptApis = ["mcp_auxiliary_transport"];
      }
      return {
        status: 200,
        body: JSON.stringify({ jsonrpc: "2.0", id: request.id, result }),
        contentType: "application/json",
        sessionId: responseSessionId,
        ...(intent
          ? {
              observationRequest,
              observationReceipts: Object.fromEntries(receiptApis.map((api) => [api, nextReceipt()])),
            }
          : {}),
      };
    }
    if (command === "mvp15d_bridge_observe_native_state") {
      const kind = String(input.kind ?? "");
      const request = (input.request as Record<string, unknown> | undefined) ?? {};
      if (kind === "renderer_process") {
        return observedState(request, {
          status: "begun",
          rendererInstanceId: `renderer-process:5252:${rendererProcessGeneration}`,
          processIdentitySha256: rendererProcessGeneration.toString(16).padStart(64, "a"),
        });
      }
      if (kind === "rendered_control") {
        return observedState(request, {
          status: "observed",
          reason: "rendered_product_control_dispatched",
          caseId: request.caseId,
          controlId: request.controlId,
        });
      }
      if (kind === "mutation_counters") {
        return observedState(request, {
          counterNames: ["native", "mcp", "provider", "verify", "rollback"],
          values: [0, 0, 0, 0, 0],
        });
      }
      if (kind === "mcp_disconnect") {
        return observedState(request, { status: "disconnected", mcpSessionId: request.mcpSessionId });
      }
      if (kind === "recorded_replay") {
        return observedState(request, { status: "observed", eventCount: 0, representationSha256: "f".repeat(64) });
      }
      if (kind === "mcp_retraction_transition") {
        return observedState(request, {
          status: "retracted",
          reason: request.reason,
          stateBeforeReceiptId: request.stateBeforeReceiptId,
          stateAfterReceiptId: nextReceipt(),
          sessionIdAfter: wireCalls.at(-1)?.responseSessionId ?? "",
          generationAfter: wireCalls.length,
        });
      }
    }
    if (command === "mvp15d_bridge_request_renderer_restart") {
      throw new Error("native_handoff_requires_production_rust");
    }
    if (command === "attest_mvp15_companion") {
      options?.onAttestation?.();
      return {
        status: "observed",
        reason: "native_loaded_modules_observed",
        manifest: evidence.manifest,
        installedModules: evidence.installedModules,
        loadedModules: evidence.loadedModules,
        nativeReceiptId: nextReceipt(),
      };
    }
    if (command === "retract_mvp15_companion_approvals") {
      options?.onRetraction?.();
      nativeGeneration += 1;
      return {
        ...successfulNativeRetraction(payload, nativeGeneration),
        nativeReceiptId: nextReceipt(),
      };
    }
    const custom = await options?.handleNativeCommand?.(command, input, nextReceipt);
    if (custom !== undefined) return custom;
    throw new Error(`unsupported_native_command:${command}`);
  });
  return {
    nativeInvoke,
    nativeCommands,
    nativeInputs,
    wireCalls,
  };
}

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
  guardMvp15AssetMutation?: (
    input: Mvp15NativeAssetGuardInput,
  ) => Promise<{ status: string; reason: string | null; evidenceId?: string | null }>;
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
  return async <T = unknown>(command: string, payload?: unknown) => {
    const result = await mock(command, payload);
    if (command === "retract_mvp15_companion_approvals" && result == null) {
      return successfulNativeRetraction(payload) as T;
    }
    return result as T;
  };
}

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
};

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function requestedNativeRetractionGeneration(payload: unknown): number | null {
  const generation = (payload as { input?: { attestationGeneration?: unknown } } | undefined)
    ?.input?.attestationGeneration;
  return typeof generation === "number" && Number.isSafeInteger(generation) && generation > 0
    ? generation
    : null;
}

function successfulNativeRetraction(payload?: unknown, generation = 1) {
  const requestedAttestationGeneration = requestedNativeRetractionGeneration(payload);
  return {
    status: "retracted",
    reason: "companion_approval_retracted",
    applied: true,
    requestedAttestationGeneration,
    minimumAttestationGeneration: requestedAttestationGeneration ?? 0,
    generation,
    revokedApprovalCount: 0,
  };
}

function bindSuccessfulNativeRetractionToRequest(result: unknown, payload: unknown): unknown {
  if (
    !result ||
    typeof result !== "object" ||
    (result as { status?: unknown }).status !== "retracted" ||
    (result as { applied?: unknown }).applied !== true
  ) {
    return result;
  }
  const requestedAttestationGeneration = requestedNativeRetractionGeneration(payload);
  return {
    ...(result as Record<string, unknown>),
    requestedAttestationGeneration,
    minimumAttestationGeneration: requestedAttestationGeneration ?? 0,
  };
}

function createVerifiedMvp15DTransport(): McpTransportClient {
  const evidence = verifiedMvp15DNativeEvidence();
  return createMockTransport({
    initialize: fullDiscoveryFixtures.initialize,
    "tools/list": { tools: evidence.descriptors },
    "resources/list": { resources: [] },
    "prompts/list": { prompts: [] },
  });
}

function createVerifiedMvp15DNativeInvoke(
  mock: (command: string, payload?: unknown) => Promise<unknown>,
): NativeInvoke {
  const evidence = verifiedMvp15DNativeEvidence();
  return createNativeInvokeMockAdapter(async (command, payload) => {
    if (command === "retract_mvp15_companion_approvals") {
      return successfulNativeRetraction(payload);
    }
    if (command === "attest_mvp15_companion") {
      return {
        status: "observed",
        reason: "native_loaded_modules_observed",
        manifest: evidence.manifest,
        installedModules: evidence.installedModules,
        loadedModules: evidence.loadedModules,
      };
    }
    return mock(command, payload);
  });
}

async function makeMvp15DForwardReady(
  adapter: ReturnType<typeof createDesktopRuntimeAdapter>,
  trustedRootId = "root:verified-test",
  editorSessionId = "editor-session:verified-test",
) {
  await adapter.connectMcp();
  await adapter.discoverMcp();
  const status = await adapter.refreshMvp15DCompanionAttestation?.(trustedRootId, editorSessionId);
  if (status?.status !== "verified") {
    throw new Error(`mvp15d_test_attestation_not_verified:${JSON.stringify({
      status,
      mcp: adapter.getMcpState(),
      discovery: adapter.getMcpDiscovery(),
      tools: adapter.getMvp15AssetTools(),
    })}`);
  }
}

async function createVerifiedCompanionRevocationHarness() {
  const evidence = verifiedMvp15DNativeEvidence();
  const fixtures = {
    initialize: fullDiscoveryFixtures.initialize,
    "tools/list": { tools: evidence.descriptors },
    "resources/list": { resources: [] },
    "prompts/list": { prompts: [] },
  };
  let failNextConnect = false;
  let failNextDiscovery = false;
  const retractionGates: Array<Deferred<unknown>> = [];
  const attestationResults: Array<unknown | Promise<unknown>> = [];
  const events: string[] = [];
  const nativeCalls: string[] = [];
  let nativeGuardCalls = 0;
  const adapter = createDesktopRuntimeAdapter({
    createTransport: () => {
      const transport = createMockTransport(fixtures);
      const sendRequest = transport.sendRequest.bind(transport);
      transport.sendRequest = vi.fn(async (request) => {
        if (request.method === "initialize" && failNextConnect) {
          failNextConnect = false;
          throw new Error("revocation_connect_failure");
        }
        if (request.method === "tools/list" && failNextDiscovery) {
          failNextDiscovery = false;
          throw new Error("revocation_discovery_failure");
        }
        return sendRequest(request);
      });
      return transport;
    },
    nativeInvoke: createNativeInvokeMockAdapter(async (command, payload) => {
      nativeCalls.push(command);
      if (command === "retract_mvp15_companion_approvals") {
        events.push("native-retraction:start");
        const gate = retractionGates.shift();
        const result = gate ? await gate.promise : successfulNativeRetraction(payload);
        events.push("native-retraction:settled");
        return bindSuccessfulNativeRetractionToRequest(result, payload) as never;
      }
      if (command === "attest_mvp15_companion") {
        const queued = attestationResults.shift();
        if (queued !== undefined) return (await queued) as never;
        return {
          status: "observed",
          reason: "native_loaded_modules_observed",
          manifest: evidence.manifest,
          installedModules: evidence.installedModules,
          loadedModules: evidence.loadedModules,
        } as never;
      }
      if (command === "execute_asset_mutation") {
        nativeGuardCalls += 1;
        events.push("native-guard");
        return {
          status: "blocked",
          reason: "companion_attestation_required",
          evidenceId: null,
        } as never;
      }
      return null as never;
    }),
  });
  await adapter.connectMcp();
  await adapter.discoverMcp();
  expect(
    (
      await adapter.refreshMvp15DCompanionAttestation?.(
        "root:revocation-harness",
        "editor-session:revocation-harness",
      )
    )?.status,
  ).toBe("verified");
  events.length = 0;
  nativeCalls.length = 0;
  nativeGuardCalls = 0;
  return {
    adapter,
    events,
    nativeCalls,
    queueRetraction: () => {
      const gate = createDeferred<unknown>();
      retractionGates.push(gate);
      return gate;
    },
    queueAttestation: (result: unknown | Promise<unknown>) => {
      attestationResults.push(result);
    },
    failConnect: () => {
      failNextConnect = true;
    },
    failDiscovery: () => {
      failNextDiscovery = true;
    },
    getNativeGuardCalls: () => nativeGuardCalls,
  };
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
    expect(firstBinding).toMatch(
      /^mcp-binding:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:\d+$/,
    );
    expect(adapter.isMvp15McpBindingCurrent!(firstBinding!)).toBe(true);

    adapter.setMcpEndpoint("http://127.0.0.1:8766/mcp");
    expect(adapter.captureMvp15McpBinding!()).toBeNull();
    expect(adapter.isMvp15McpBindingCurrent!(firstBinding!)).toBe(false);

    await adapter.connectMcp();
    await adapter.discoverMcp();
    const secondBinding = adapter.captureMvp15McpBinding!();
    expect(secondBinding).toMatch(
      /^mcp-binding:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:\d+$/,
    );
    expect(secondBinding).not.toBe(firstBinding);
    expect(adapter.isMvp15McpBindingCurrent!(secondBinding!)).toBe(true);

    adapter.disconnectMcp();
    expect(adapter.isMvp15McpBindingCurrent!(secondBinding!)).toBe(false);
  });

  it("captures redacted initialize and discovery exchanges at the desktop transport boundary without issuing a mutation", async () => {
    const exchanges: Array<{
      generation: number;
      direction: string;
      method: string;
      payload: unknown;
    }> = [];
    const fixtures = exactAssetDiscoveryFixtures();
    fixtures.initialize = {
      ...(fullDiscoveryFixtures.initialize as Record<string, unknown>),
      serverInfo: {
        ...(fullDiscoveryFixtures.initialize as { serverInfo: Record<string, unknown> }).serverInfo,
        authorization: "Bearer boundary-capture-secret",
      },
    };
    const adapter = createDesktopRuntimeAdapter({
      createTransport: () => createMockTransport(fixtures),
      onMvp15DProductAdapterExchange: (exchange) => exchanges.push(exchange),
    });

    await adapter.connectMcp();
    await adapter.discoverMcp();

    const capturedMethods = exchanges.map((exchange) => `${exchange.direction}:${exchange.method}`);
    expect(capturedMethods).toEqual(
      expect.arrayContaining([
        "request:initialize",
        "response:initialize",
        "request:tools/list",
        "response:tools/list",
        "request:resources/list",
        "response:resources/list",
        "request:prompts/list",
        "response:prompts/list",
      ]),
    );
    expect(capturedMethods.some((method) => method.startsWith("request:tools/call"))).toBe(false);
    const initializeResponse = exchanges.find(
      (exchange) => exchange.direction === "response" && exchange.method === "initialize",
    );
    expect(initializeResponse?.payload).toMatchObject({
      result: { serverInfo: { authorization: "[redacted]" } },
    });
    const toolListResponse = exchanges.find(
      (exchange) => exchange.direction === "response" && exchange.method === "tools/list",
    );
    const capturedToolsValue = (
      toolListResponse?.payload as { result?: { tools?: unknown } } | undefined
    )?.result?.tools;
    expect(Array.isArray(capturedToolsValue)).toBe(true);
    const capturedTools: unknown[] = Array.isArray(capturedToolsValue) ? capturedToolsValue : [];
    const createFolderDescriptor = capturedTools.find(
      (tool): tool is Record<string, unknown> =>
        Boolean(tool) &&
        typeof tool === "object" &&
        (tool as { name?: unknown }).name === "ue.asset.create_folder",
    );
    expect(createFolderDescriptor?.outputSchema).toMatchObject({
      schemaVersion: "ue.asset.contract.v1",
    });
    expect(JSON.stringify(exchanges)).not.toContain("boundary-capture-secret");
    expect(adapter.getMvp15AssetTools()).toHaveLength(6);
  });

  it("does not expose the task-only D0 product probe without exchange capture", () => {
    const adapter = createAdapterWithTransport();
    expect(adapter.runMvp15DProductNoOpProbe).toBeUndefined();
  });

  it.each([true, false])(
    "calls the discovered direct D0 no-op with an empty object when Tool Search is %s",
    async (toolSearch) => {
      const transport = createMockTransport({
        initialize: fullDiscoveryFixtures.initialize,
        "tools/list": {
          tools: [
            {
              name: "uagent.d0.probe",
              description: "Task-only mutation-incapable D0 probe",
              inputSchema: {
                type: "object",
                properties: {},
                required: [],
                additionalProperties: false,
              },
            },
            {
              name: "list_toolsets",
              description: "Stock Unreal MCP Toolset Registry inventory",
              inputSchema: { type: "object" },
            },
            {
              name: "describe_toolset",
              description: "Stock Unreal MCP Toolset Registry descriptor",
              inputSchema: { type: "object" },
            },
            {
              name: "call_tool",
              description: "Stock Unreal MCP Toolset Registry dispatcher",
              inputSchema: { type: "object" },
            },
          ],
        },
        "resources/list": { resources: [] },
        "prompts/list": { prompts: [] },
        "tools/call": { content: [{ type: "text", text: "uagent_mvp15d_d0_noop" }] },
      });
      const adapter = createDesktopRuntimeAdapter({
        createTransport: () => transport,
        onMvp15DProductAdapterExchange: vi.fn(),
      });
      await adapter.connectMcp();
      await adapter.discoverMcp();
      const callsBeforeProbe = vi.mocked(transport.sendRequest).mock.calls.length;

      await expect(
        adapter.runMvp15DProductNoOpProbe?.("direct", toolSearch),
      ).resolves.toBeDefined();

      const probeCalls = vi
        .mocked(transport.sendRequest)
        .mock.calls.slice(callsBeforeProbe)
        .map(([request]) => request)
        .filter((request) => request.method === "tools/call");
      expect(probeCalls).toHaveLength(1);
      expect(probeCalls[0]?.params).toEqual({
        name: "uagent.d0.probe",
        arguments: {},
      });
    },
  );

  it("parses Epic text toolset inventory and uses exact search-on meta-tool keys for the D0 Probe", async () => {
    const requests: Array<{ method: string; params?: unknown }> = [];
    const d0Toolset = "UAgentAssetTools.UAgentAssetToolsD0Toolset";
    const transport: McpTransportClient = {
      sendRequest: vi.fn(async (request) => {
        requests.push({ method: request.method, params: request.params });
        const params = request.params as
          | { name?: string; arguments?: Record<string, unknown> }
          | undefined;
        let result: unknown = null;
        if (request.method === "initialize") {
          result = fullDiscoveryFixtures.initialize;
        } else if (request.method === "tools/list") {
          result = {
            tools: [
              { name: "list_toolsets", inputSchema: { type: "object" } },
              { name: "describe_toolset", inputSchema: { type: "object" } },
              { name: "call_tool", inputSchema: { type: "object" } },
            ],
          };
        } else if (request.method === "resources/list") {
          result = { resources: [] };
        } else if (request.method === "prompts/list") {
          result = { prompts: [] };
        } else if (request.method === "tools/call" && params?.name === "list_toolsets") {
          result = {
            content: [
              {
                type: "text",
                text: [
                  "Available toolsets:",
                  `- ${d0Toolset}`,
                  "- EditorToolset.OtherTools: Unrelated editor helpers",
                ].join("\n"),
              },
            ],
          };
        } else if (request.method === "tools/call" && params?.name === "describe_toolset") {
          const toolsetName = params.arguments?.toolset_name ?? params.arguments?.toolsetId;
          result = {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  name: toolsetName,
                  tools:
                    toolsetName === d0Toolset
                      ? [
                          {
                            name: `${d0Toolset}.Probe`,
                            inputSchema: { type: "object" },
                          },
                        ]
                      : [{ name: "Unrelated" }],
                }),
              },
            ],
          };
        } else if (request.method === "tools/call" && params?.name === "call_tool") {
          result = { content: [{ type: "text", text: "uagent_mvp15d_d0_noop" }] };
        }
        return { jsonrpc: "2.0" as const, id: request.id, result };
      }),
      sendNotification: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const adapter = createDesktopRuntimeAdapter({
      createTransport: () => transport,
      onMvp15DProductAdapterExchange: vi.fn(),
    });
    await adapter.connectMcp();
    await adapter.discoverMcp();
    const requestCountBeforeProbe = requests.length;

    await expect(
      adapter.runMvp15DProductNoOpProbe?.("toolset_registry", true),
    ).resolves.toBeDefined();

    const productCalls = requests
      .slice(requestCountBeforeProbe)
      .filter((request) => request.method === "tools/call")
      .map((request) => request.params);
    expect(productCalls).toEqual([
      { name: "list_toolsets", arguments: {} },
      { name: "describe_toolset", arguments: { toolset_name: d0Toolset } },
      {
        name: "call_tool",
        arguments: {
          toolset_name: d0Toolset,
          tool_name: "Probe",
          arguments: {},
        },
      },
    ]);
  });

  it("calls the one discovered eager D0 Toolset Probe descriptor directly when Tool Search is off", async () => {
    const eagerProbeName = "UAgentAssetTools.UAgentAssetToolsD0Toolset.Probe";
    const transport = createMockTransport({
      initialize: fullDiscoveryFixtures.initialize,
      "tools/list": {
        tools: [
          {
            name: eagerProbeName,
            description: "Task-only mutation-incapable D0 toolset Probe",
            inputSchema: { type: "object" },
          },
        ],
      },
      "resources/list": { resources: [] },
      "prompts/list": { prompts: [] },
      "tools/call": { content: [{ type: "text", text: "uagent_mvp15d_d0_noop" }] },
    });
    const adapter = createDesktopRuntimeAdapter({
      createTransport: () => transport,
      onMvp15DProductAdapterExchange: vi.fn(),
    });
    await adapter.connectMcp();
    await adapter.discoverMcp();
    const callsBeforeProbe = vi.mocked(transport.sendRequest).mock.calls.length;

    await expect(
      adapter.runMvp15DProductNoOpProbe?.("toolset_registry", false),
    ).resolves.toBeDefined();

    const productCalls = vi
      .mocked(transport.sendRequest)
      .mock.calls.slice(callsBeforeProbe)
      .map(([request]) => request)
      .filter((request) => request.method === "tools/call");
    expect(productCalls).toHaveLength(1);
    expect(productCalls[0]?.params).toEqual({
      name: eagerProbeName,
      arguments: {},
    });
  });

  it.each([
    "Probe",
    "EvilUAgentAssetTools.UAgentAssetToolsD0Toolset.Probe",
    "UAgentAssetTools.UAgentAssetToolsD0ToolsetCopy.Probe",
  ])("rejects an unqualified or collision D0 eager Probe descriptor: %s", async (name) => {
    const adapter = createDesktopRuntimeAdapter({
      createTransport: () =>
        createMockTransport({
          initialize: fullDiscoveryFixtures.initialize,
          "tools/list": {
            tools: [
              {
                name,
                description: "Untrusted collision probe",
                inputSchema: {
                  type: "object",
                  properties: {},
                  required: [],
                  additionalProperties: false,
                },
              },
            ],
          },
          "resources/list": { resources: [] },
          "prompts/list": { prompts: [] },
        }),
      onMvp15DProductAdapterExchange: vi.fn(),
    });
    await adapter.connectMcp();
    await adapter.discoverMcp();

    await expect(adapter.runMvp15DProductNoOpProbe?.("toolset_registry", false)).rejects.toThrow(
      "mvp15d_eager_probe_descriptor_required",
    );
  });

  it("rejects the exact eager D0 Probe when its input schema accepts arguments", async () => {
    const adapter = createDesktopRuntimeAdapter({
      createTransport: () =>
        createMockTransport({
          initialize: fullDiscoveryFixtures.initialize,
          "tools/list": {
            tools: [
              {
                name: "UAgentAssetTools.UAgentAssetToolsD0Toolset.Probe",
                description: "Non-empty collision probe",
                inputSchema: {
                  type: "object",
                  properties: { mutate: { type: "boolean" } },
                  additionalProperties: false,
                },
              },
            ],
          },
          "resources/list": { resources: [] },
          "prompts/list": { prompts: [] },
        }),
      onMvp15DProductAdapterExchange: vi.fn(),
    });
    await adapter.connectMcp();
    await adapter.discoverMcp();

    await expect(adapter.runMvp15DProductNoOpProbe?.("toolset_registry", false)).rejects.toThrow(
      "mvp15d_eager_probe_descriptor_required",
    );
  });

  it("rejects an otherwise empty D0 Probe schema with any additional schema keyword", async () => {
    const adapter = createDesktopRuntimeAdapter({
      createTransport: () =>
        createMockTransport({
          initialize: fullDiscoveryFixtures.initialize,
          "tools/list": {
            tools: [
              {
                name: "uagent.d0.probe",
                inputSchema: {
                  type: "object",
                  properties: {},
                  required: [],
                  additionalProperties: false,
                  minProperties: 0,
                },
              },
            ],
          },
          "resources/list": { resources: [] },
          "prompts/list": { prompts: [] },
        }),
      onMvp15DProductAdapterExchange: vi.fn(),
    });
    await adapter.connectMcp();
    await adapter.discoverMcp();

    await expect(adapter.runMvp15DProductNoOpProbe?.("direct", false)).rejects.toThrow(
      "mvp15d_direct_probe_descriptor_required",
    );
  });

  it.each([
    {
      conflictName: "UAgentAssetTools.UAgentAssetToolsD0Toolset.Probe",
      expectedError: "mvp15d_probe_inventory_route_conflict",
    },
    {
      conflictName: "UAGENT.D0.PROBE",
      expectedError: "mvp15d_probe_inventory_case_mismatch",
    },
    {
      conflictName: "Call_Tool",
      expectedError: "mvp15d_probe_inventory_case_mismatch",
    },
  ])(
    "rejects Direct inventory conflict or case collision $conflictName",
    async ({ conflictName, expectedError }) => {
      const adapter = createDesktopRuntimeAdapter({
        createTransport: () =>
          createMockTransport({
            initialize: fullDiscoveryFixtures.initialize,
            "tools/list": {
              tools: [
                {
                  name: "uagent.d0.probe",
                  inputSchema: {
                    type: "object",
                    properties: {},
                    required: [],
                    additionalProperties: false,
                  },
                },
                { name: conflictName, inputSchema: { type: "object" } },
              ],
            },
            "resources/list": { resources: [] },
            "prompts/list": { prompts: [] },
          }),
        onMvp15DProductAdapterExchange: vi.fn(),
      });
      await adapter.connectMcp();
      await adapter.discoverMcp();

      await expect(adapter.runMvp15DProductNoOpProbe?.("direct", false)).rejects.toThrow(
        expectedError,
      );
    },
  );

  it.each([
    {
      label: "Direct call",
      route: "direct",
      toolSearch: false,
      deferredTool: "uagent.d0.probe",
    },
    {
      label: "Toolset search list",
      route: "toolset_registry",
      toolSearch: true,
      deferredTool: "list_toolsets",
    },
    {
      label: "Toolset search describe",
      route: "toolset_registry",
      toolSearch: true,
      deferredTool: "describe_toolset",
    },
    {
      label: "Toolset search call",
      route: "toolset_registry",
      toolSearch: true,
      deferredTool: "call_tool",
    },
    {
      label: "Toolset eager call",
      route: "toolset_registry",
      toolSearch: false,
      deferredTool: "UAgentAssetTools.UAgentAssetToolsD0Toolset.Probe",
    },
  ] as const)(
    "fails closed when a deferred $label completes after disconnect and reconnect",
    async ({ route, toolSearch, deferredTool }) => {
      const d0Toolset = "UAgentAssetTools.UAgentAssetToolsD0Toolset";
      const exactEmptySchema = {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      };
      const exchanges: Array<{
        generation: number;
        direction: string;
        method: string;
        payload: unknown;
      }> = [];
      const deferredResponse = createDeferred<{
        jsonrpc: "2.0";
        id: string | number | null;
        result: unknown;
      }>();
      let deferredRequest: { id: string | number | null; method: string; params?: unknown } | null =
        null;
      let deferArmed = false;
      let deferOnce = true;
      const discoveryTools =
        route === "direct"
          ? [{ name: "uagent.d0.probe", inputSchema: exactEmptySchema }]
          : toolSearch
            ? [
                { name: "list_toolsets", inputSchema: { type: "object" } },
                { name: "describe_toolset", inputSchema: { type: "object" } },
                { name: "call_tool", inputSchema: { type: "object" } },
              ]
            : [
                {
                  name: `${d0Toolset}.Probe`,
                  inputSchema: { type: "object" },
                },
              ];
      const toolResult = (name: string): unknown => {
        if (name === "list_toolsets") {
          return {
            content: [
              {
                type: "text",
                text: `Available toolsets:\n- ${d0Toolset}: Task-only no-op probe`,
              },
            ],
          };
        }
        if (name === "describe_toolset") {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  name: d0Toolset,
                  tools: [
                    {
                      name: `${d0Toolset}.Probe`,
                      inputSchema: { type: "object" },
                    },
                  ],
                }),
              },
            ],
          };
        }
        return { content: [{ type: "text", text: "uagent_mvp15d_d0_noop" }] };
      };
      const createProbeTransport = (): McpTransportClient => ({
        sendRequest: vi.fn(async (request) => {
          const params = request.params as { name?: string } | undefined;
          let result: unknown = null;
          if (request.method === "initialize") {
            result = fullDiscoveryFixtures.initialize;
          } else if (request.method === "tools/list") {
            result = { tools: discoveryTools };
          } else if (request.method === "resources/list") {
            result = { resources: [] };
          } else if (request.method === "prompts/list") {
            result = { prompts: [] };
          } else if (request.method === "tools/call" && params?.name) {
            if (deferArmed && deferOnce && params.name === deferredTool) {
              deferOnce = false;
              deferredRequest = request;
              return deferredResponse.promise;
            }
            result = toolResult(params.name);
          }
          return { jsonrpc: "2.0" as const, id: request.id, result };
        }),
        sendNotification: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
      });
      const adapter = createDesktopRuntimeAdapter({
        createTransport: createProbeTransport,
        nativeInvoke: null,
        onMvp15DProductAdapterExchange: (exchange) => exchanges.push(exchange),
      });
      await adapter.connectMcp();
      await adapter.discoverMcp();

      deferArmed = true;
      const probe = adapter.runMvp15DProductNoOpProbe!(route, toolSearch);
      const staleProbe = expect(probe).rejects.toThrow("mvp15d_product_probe_session_stale");
      await vi.waitFor(() => expect(deferredRequest).not.toBeNull());
      adapter.disconnectMcp();
      await adapter.connectMcp();
      await adapter.discoverMcp();
      const request = deferredRequest!;
      deferredResponse.resolve({
        jsonrpc: "2.0",
        id: request.id,
        result: toolResult(deferredTool),
      });
      await staleProbe;

      const capturedRequest = exchanges.find(
        (exchange) =>
          exchange.direction === "request" &&
          exchange.method === "tools/call" &&
          (exchange.payload as { params?: { name?: unknown } }).params?.name === deferredTool,
      );
      const requestId = (capturedRequest?.payload as { id?: unknown } | undefined)?.id;
      const capturedResponse = exchanges.find(
        (exchange) =>
          exchange.direction === "response" &&
          exchange.method === "tools/call" &&
          (exchange.payload as { id?: unknown }).id === requestId,
      );
      expect(capturedRequest).toBeDefined();
      expect(capturedResponse?.generation).toBe(capturedRequest?.generation);
      expect(
        exchanges
          .filter(
            (exchange) => exchange.direction === "request" && exchange.method === "initialize",
          )
          .at(-1)?.generation,
      ).toBeGreaterThan(capturedRequest!.generation);
    },
  );

  it.each(["success", "error"] as const)(
    "retracts accepted MCP publication before the first synchronous reconnect notification on %s",
    async (outcome) => {
      let transportCount = 0;
      const adapter = createDesktopRuntimeAdapter({
        createTransport: () => {
          transportCount += 1;
          if (transportCount === 1 || outcome === "success") {
            return createMockTransport(exactAssetDiscoveryFixtures());
          }
          const transport = createMockTransport(exactAssetDiscoveryFixtures());
          transport.sendRequest = vi.fn(async () => {
            throw new Error("reconnect_transport_failure");
          });
          return transport;
        },
      });
      await adapter.connectMcp();
      await adapter.discoverMcp();
      expect(adapter.getMvp15LiveAssetToolsetFingerprint!().sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(adapter.getMcpDiscovery()).not.toBeNull();
      expect(adapter.getMvp15AssetTools()).toHaveLength(6);
      expect(adapter.captureMvp15McpBinding!()).not.toBeNull();

      const observations: Array<{
        status: string;
        sha256: string | null;
        canonicalByteLength: number | null;
        binding: unknown;
        discovery: unknown;
        tools: unknown[];
        capturedBinding: string | null;
      }> = [];
      const unsubscribe = adapter.subscribeMcp((state) => {
        const fingerprint = adapter.getMvp15LiveAssetToolsetFingerprint!();
        observations.push({
          status: state.status,
          sha256: fingerprint.sha256,
          canonicalByteLength: fingerprint.canonicalByteLength,
          binding: fingerprint.binding,
          discovery: adapter.getMcpDiscovery(),
          tools: adapter.getMvp15AssetTools(),
          capturedBinding: adapter.captureMvp15McpBinding!(),
        });
      });
      await adapter.connectMcp();
      unsubscribe();

      expect(observations[0]).toEqual({
        status: "connecting",
        sha256: null,
        canonicalByteLength: null,
        binding: null,
        discovery: null,
        tools: [],
        capturedBinding: null,
      });
      expect(adapter.getMcpState().status).toBe(outcome === "success" ? "connected" : "error");
      expect(adapter.getMvp15LiveAssetToolsetFingerprint!()).toMatchObject({
        sha256: null,
        canonicalByteLength: null,
        binding: null,
      });
      expect(adapter.getMcpDiscovery()).toBeNull();
      expect(adapter.getMvp15AssetTools()).toEqual([]);
      expect(adapter.captureMvp15McpBinding!()).toBeNull();
    },
  );

  it("keeps an invalid endpoint notification fail closed after a prior accepted publication", async () => {
    const adapter = createAdapterWithTransport(exactAssetDiscoveryFixtures());
    await adapter.connectMcp();
    await adapter.discoverMcp();
    expect(adapter.getMvp15LiveAssetToolsetFingerprint!().sha256).toMatch(/^[0-9a-f]{64}$/);

    const observations: Array<{ status: string; sha256: string | null; binding: unknown }> = [];
    const unsubscribe = adapter.subscribeMcp((state) => {
      const fingerprint = adapter.getMvp15LiveAssetToolsetFingerprint!();
      observations.push({
        status: state.status,
        sha256: fingerprint.sha256,
        binding: fingerprint.binding,
      });
    });
    adapter.setMcpEndpoint("https://example.invalid/token=endpoint-canary");
    await adapter.connectMcp();
    unsubscribe();

    expect(observations[0]).toEqual({ status: "connected", sha256: null, binding: null });
    expect(observations.at(-1)).toEqual({ status: "error", sha256: null, binding: null });
    expect(adapter.getMcpDiscovery()).toBeNull();
    expect(adapter.getMvp15AssetTools()).toEqual([]);
    expect(adapter.captureMvp15McpBinding!()).toBeNull();
  });

  it.each(
    (["disconnect", "endpoint", "rediscover", "reconnect"] as const).flatMap((action) =>
      (["success", "error"] as const).map((completion) => ({ action, completion })),
    ),
  )(
    "does not publish a stale facade discovery $completion after $action",
    async ({ action, completion }) => {
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
            listToolsetsCalls += 1;
            if (listToolsetsCalls === 1) {
              markOldFacadeStarted();
              await oldFacadeGate;
              if (completion === "error") throw new Error("stale_facade_error");
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
      expect(adapter.getMvp15LiveAssetToolsetFingerprint!().sha256).toBeNull();
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
      const latestFingerprint = adapter.getMvp15LiveAssetToolsetFingerprint!();
      releaseOldFacade();
      await staleDiscovery;

      if (action === "rediscover" || action === "reconnect") {
        expect(latestDiscovery).not.toBeNull();
        expect(latestBinding).not.toBeNull();
        expect(adapter.getMcpDiscovery()).toBe(latestDiscovery);
        expect(adapter.captureMvp15McpBinding!()).toBe(latestBinding);
        expect(adapter.getMvp15LiveAssetToolsetFingerprint!()).toBe(latestFingerprint);
        expect(adapter.getMcpState().status).toBe("connected");
      } else {
        expect(adapter.getMcpDiscovery()).toBeNull();
        expect(adapter.captureMvp15McpBinding!()).toBeNull();
        expect(adapter.getMvp15LiveAssetToolsetFingerprint!()).toBe(latestFingerprint);
        expect(latestFingerprint.sha256).toBeNull();
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
      schemaVersion: "ue.asset.contract.v1",
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
    const fingerprint = adapter.getMvp15LiveAssetToolsetFingerprint!();
    expect(fingerprint).toMatchObject({
      status: "ready",
      schemaVersion: "uagent.mvp15.live-asset-toolset-fingerprint.v1",
      toolCount: 6,
      source: "direct",
      binding: { session: "current", endpoint: "redacted" },
      issues: {
        missingTools: [],
        duplicateTools: [],
        unexpectedToolCount: 0,
        unexpectedDuplicateCount: 0,
        malformedToolCount: 0,
        reordered: false,
        invalidTools: [],
      },
    });
    expect(fingerprint.sha256).toMatch(/^[0-9a-f]{64}$/);
    const serialized = JSON.stringify(fingerprint);
    expect(serialized).not.toMatch(
      /https?:|127\.0\.0\.1|localhost|session.?id|pid|token|assetPath|properties/i,
    );

    adapter.disconnectMcp();
    expect(adapter.getMvp15LiveAssetToolsetFingerprint!()).toMatchObject({
      status: "blocked_by_mcp_schema",
      sha256: null,
      canonicalByteLength: null,
      binding: null,
    });
  });

  it("publishes redacted blocked issue counts for unexpected discovery names", async () => {
    const unexpectedNames = [
      "ue.asset.http://127.0.0.1/private",
      "ue.asset.C:\\Users\\operator\\token=secret-value",
      "ue.asset.Bearer secret-credential",
    ];
    const adapter = createAdapterWithTransport(
      exactAssetDiscoveryFixtures([
        ...unexpectedNames.map((name) => ({ name })),
        { name: unexpectedNames[0] },
      ]),
    );
    await adapter.connectMcp();
    await adapter.discoverMcp();

    const publication = adapter.getMvp15LiveAssetToolsetFingerprint!();
    expect(publication).toMatchObject({
      status: "blocked_by_mcp_schema",
      sha256: null,
      canonicalByteLength: null,
      tools: [],
      issues: {
        duplicateTools: [],
        unexpectedToolCount: 4,
        unexpectedDuplicateCount: 1,
        malformedToolCount: 0,
      },
    });
    const serialized = JSON.stringify(publication);
    for (const canary of [
      "http://127.0.0.1",
      "127.0.0.1",
      "C:\\Users\\operator",
      "token=",
      "secret-value",
      "Bearer",
      "secret-credential",
    ]) {
      expect(serialized).not.toContain(canary);
    }
  });

  it("keeps companion attestation blocked when native evidence status is blocked", async () => {
    const attestSpy = vi.spyOn(Runtime, "attestMvp15DCompanion");
    const adapter = createDesktopRuntimeAdapter({
      createTransport: () => createMockTransport(exactAssetDiscoveryFixtures()),
      nativeInvoke: createNativeInvokeMockAdapter(async (command, payload) => {
        if (command === "attest_mvp15_companion") {
          return {
            status: "blocked",
            reason: "loaded_module_evidence_unavailable",
            manifest: {},
            installedModules: [{ name: "installed.dll", size: 3, sha256: "a".repeat(64) }],
            loadedModules: [{ name: "loaded.dll", size: 3, sha256: "b".repeat(64) }],
          } as never;
        }
        if (command === "retract_mvp15_companion_approvals") {
          return successfulNativeRetraction(payload) as never;
        }
        return null as never;
      }),
    });

    try {
      await adapter.connectMcp();
      await adapter.discoverMcp();
      attestSpy.mockClear();
      const status = await adapter.refreshMvp15DCompanionAttestation?.(
        "root:phase-f",
        "editor-session:phase-f",
      );
      expect(status).toMatchObject({
        status: "installed_unverified",
        blocker: "BLOCKED_BY_PLUGIN_PROVENANCE",
        reason: "loaded_module_evidence_unavailable",
      });
      expect(attestSpy).not.toHaveBeenCalled();
    } finally {
      attestSpy.mockRestore();
    }
  });

  it("retracts a verified companion fingerprint before publishing a blocked native refresh", async () => {
    const evidence = verifiedMvp15DNativeEvidence();
    let nativeStatus: "observed" | "blocked" = "observed";
    const nativeCalls: string[] = [];
    const adapter = createDesktopRuntimeAdapter({
      createTransport: () =>
        createMockTransport({
          initialize: fullDiscoveryFixtures.initialize,
          "tools/list": { tools: evidence.descriptors },
          "resources/list": { resources: [] },
          "prompts/list": { prompts: [] },
        }),
      nativeInvoke: createNativeInvokeMockAdapter(async (command, payload) => {
        nativeCalls.push(command);
        if (command === "retract_mvp15_companion_approvals") {
          return successfulNativeRetraction(payload) as never;
        }
        if (command !== "attest_mvp15_companion") return null as never;
        expect((payload as { input?: Record<string, unknown> } | undefined)?.input).toMatchObject({
          trustedRootId: "root:attestation",
          editorSessionId: expect.stringMatching(/^editor-session:attestation/),
          attestationGeneration: expect.any(Number),
        });
        if (nativeStatus === "observed") {
          return {
            status: "observed",
            reason: "native_loaded_modules_observed",
            manifest: evidence.manifest,
            installedModules: evidence.installedModules,
            loadedModules: evidence.loadedModules,
          } as never;
        }
        return {
          status: "blocked",
          reason: "loaded_module_evidence_unavailable",
          manifest: evidence.manifest,
          installedModules: evidence.installedModules,
          loadedModules: [],
        } as never;
      }),
    });

    await adapter.connectMcp();
    await adapter.discoverMcp();
    expect(
      (
        await adapter.refreshMvp15DCompanionAttestation?.(
          "root:attestation",
          "editor-session:attestation",
        )
      )?.status,
    ).toBe("verified");
    expect(adapter.getMvp15DLiveCompanionFingerprint?.()).toMatchObject({
      status: "ready",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      identity: expect.objectContaining({ loadedModuleSha256: "f".repeat(64) }),
    });

    const synchronousPublications: Array<{ sha256: string | null; identity: unknown }> = [];
    const unsubscribe = adapter.subscribeMcp(() => {
      const fingerprint = adapter.getMvp15DLiveCompanionFingerprint?.();
      synchronousPublications.push({
        sha256: fingerprint?.sha256 ?? null,
        identity: fingerprint?.identity ?? null,
      });
    });
    nativeStatus = "blocked";
    try {
      const nativeCallsBeforeBlockedRefresh = nativeCalls.length;
      expect(
        (
          await adapter.refreshMvp15DCompanionAttestation?.(
            "root:attestation",
            "editor-session:attestation-restarted",
          )
        )?.status,
      ).toBe("installed_unverified");
      expect(adapter.getMvp15DLiveCompanionFingerprint?.()).toMatchObject({
        status: "blocked",
        sha256: null,
        identity: null,
      });
      expect(synchronousPublications).toEqual([
        { sha256: null, identity: null },
        { sha256: null, identity: null },
      ]);
      // Refresh clears the prior authority before attesting again; the blocked
      // native result is then explicitly retracted before its final publication.
      expect(nativeCalls.slice(nativeCallsBeforeBlockedRefresh)).toEqual([
        "retract_mvp15_companion_approvals",
        "attest_mvp15_companion",
        "retract_mvp15_companion_approvals",
      ]);
    } finally {
      unsubscribe();
    }
  });

  it("keeps D0 native observation revocation-bound while the public asset facade remains blocked", async () => {
    const evidence = verifiedMvp15DNativeEvidence();
    const nativeCalls: string[] = [];
    const mcpToolCalls: string[] = [];
    const nativeExchanges: Array<{
      direction: string;
      method: string;
      payload: unknown;
    }> = [];
    const adapter = createDesktopRuntimeAdapter({
      createTransport: () => {
        const transport = createMockTransport({
          initialize: fullDiscoveryFixtures.initialize,
          "tools/list": {
            tools: [
              {
                name: "uagent.d0.probe",
                description: "Mutation-incapable D0 probe",
                inputSchema: {
                  type: "object",
                  properties: {},
                  required: [],
                  additionalProperties: false,
                },
              },
            ],
          },
          "resources/list": { resources: [] },
          "prompts/list": { prompts: [] },
        });
        const sendRequest = transport.sendRequest.bind(transport);
        transport.sendRequest = vi.fn(async (request) => {
          if (request.method === "tools/call") {
            mcpToolCalls.push(
              ((request.params as { name?: unknown } | undefined)?.name as string | undefined) ??
                "missing",
            );
          }
          return sendRequest(request);
        });
        return transport;
      },
      nativeInvoke: createNativeInvokeMockAdapter(async (command, payload) => {
        nativeCalls.push(command);
        if (command === "attest_mvp15_companion") {
          return {
            status: "observed",
            reason: "native_loaded_modules_observed",
            manifest: evidence.manifest,
            installedModules: evidence.installedModules,
            loadedModules: evidence.loadedModules,
          } as never;
        }
        if (command === "retract_mvp15_companion_approvals")
          return successfulNativeRetraction(payload) as never;
        if (command === "register_asset_mutation_approval") {
          return {
            status: "registered",
            reason: "permissive_native_registration",
            registrationId: "asset-approval:d0-must-not-exist",
            operationCount: 1,
            approvalToken: "f".repeat(64),
            issuedAt: 1,
            expiresAt: 60_000,
          } as never;
        }
        if (command === "execute_asset_mutation" || command === "rollback_asset_mutation") {
          return {
            status: "accepted_by_native_guard",
            reason: "permissive_native_guard",
            registrationId: "asset-approval:d0-existing",
            phase: command === "rollback_asset_mutation" ? "rollback" : "execute",
            operationId: "op-d0",
            operationIndex: 0,
            operationCount: 1,
            evidenceId: "native:d0-permissive",
          } as never;
        }
        if (command === "cancel_asset_mutation_approval")
          return {
            status: "cancelled",
            reason: "approval_registration_cancelled",
            registrationId: "asset-approval:d0-existing",
          } as never;
        if (command === "record_asset_mutation_outcome")
          return {
            status: "recorded",
            reason: "operation_outcome_recorded",
            registrationId: "asset-approval:d0-existing",
            phase: "rollback",
            operationId: "op-d0",
            rollbackAvailable: false,
            terminal: true,
          } as never;
        return null as never;
      }),
      onMvp15DProductAdapterExchange: (exchange) => {
        if (exchange.method.startsWith("native/")) nativeExchanges.push(exchange);
      },
    });

    await adapter.connectMcp();
    await adapter.discoverMcp();
    expect(
      (
        await adapter.refreshMvp15DCompanionAttestation?.(
          "root:d0-revocation",
          "editor-session:d0-revocation",
        )
      )?.status,
    ).toBe("incompatible");
    expect(adapter.getMvp15DCompanionStatus?.()).toMatchObject({
      status: "incompatible",
      reason: "companion_live_identity_missing",
    });
    expect(
      nativeExchanges.find(
        (exchange) =>
          exchange.direction === "response" && exchange.method === "native/attest_mvp15_companion",
      )?.payload,
    ).toMatchObject({
      status: "native_observed_revocation_bound",
      publicStatus: "incompatible",
      bindingEstablished: true,
    });

    const operation = {
      operationId: "op-d0",
      kind: "create_folder" as const,
      toolName: "ue.asset.create_folder",
      pluginDryRunHash: "a".repeat(40),
      argsHash: "b".repeat(64),
      assetPath: "/Game/UAgentSandbox/run-d0",
      rollbackAction: "cleanup_empty_folder" as const,
      rollbackToolName: "ue.asset.delete",
      saveAll: false as const,
      bulk: false as const,
    };
    const guardFacts = {
      registrationId: "asset-approval:d0-existing",
      approvalToken: "native-only-token",
      operationIndex: 0,
      operationCount: 1,
      changeSetId: "changeset:d0",
      runId: "run-d0",
      projectBindingId: "project:d0",
      mcpBinding: "mcp-binding:d0",
      aggregateDryRunHash: "c".repeat(64),
      aggregateArgsHash: "d".repeat(64),
      operation,
    };
    const nativeForwardCountBefore = nativeCalls.length;
    await expect(
      adapter.guardMvp15AssetMutation!({
        command: "register",
        phase: "register",
        trustedRootRef: "root:d0",
        editorSessionId: "editor-session:d0-revocation",
        requestedTtlMs: 60_000,
        operations: [operation],
        ...guardFacts,
      } as never),
    ).resolves.toMatchObject({
      status: "blocked",
      reason: "companion_attestation_required",
    });
    await expect(
      adapter.guardMvp15AssetMutation!({
        command: "guard",
        phase: "execute",
        ...guardFacts,
      } as never),
    ).resolves.toMatchObject({
      status: "blocked",
      reason: "companion_attestation_required",
    });
    expect(
      nativeCalls
        .slice(nativeForwardCountBefore)
        .filter(
          (command) =>
            command === "register_asset_mutation_approval" ||
            command === "execute_asset_mutation",
        ),
    ).toEqual([]);

    await expect(
      adapter.guardMvp15AssetMutation!({
        command: "guard",
        phase: "rollback",
        ...guardFacts,
      } as never),
    ).resolves.toMatchObject({ status: "accepted_by_native_guard", phase: "rollback" });
    await expect(
      adapter.guardMvp15AssetMutation!({
        command: "record_outcome",
        phase: "rollback",
        registrationId: guardFacts.registrationId,
        operationIndex: 0,
        operationId: operation.operationId,
        success: true,
        sideEffectObserved: true,
        effectState: "known_effect",
        rollbackAvailable: false,
        evidenceId: "mcp:d0-rollback",
        reasonCode: "none",
      } as never),
    ).resolves.toMatchObject({ status: "recorded" });
    await expect(
      adapter.guardMvp15AssetMutation!({
        command: "cancel_registration",
        registrationId: guardFacts.registrationId,
        approvalToken: guardFacts.approvalToken,
      } as never),
    ).resolves.toMatchObject({ status: "cancelled" });

    await expect(
      adapter.callMvp15AssetTool!("ue.asset.save", {
        changeSetId: "changeset:d0",
        runId: "run-d0",
        dryRun: false,
        execute: true,
        rollback: false,
        dryRunHash: "a".repeat(40),
        assetPath: "/Game/UAgentSandbox/run-d0/Hero",
        saveAll: false,
      }),
    ).resolves.toMatchObject({
      status: "blocked",
      reason: "companion_attestation_required",
    });
    expect(mcpToolCalls.filter((name) => name.startsWith("ue.asset."))).toEqual([]);
    await adapter.runMvp15DProductNoOpProbe?.("direct", false);
    expect(mcpToolCalls).toEqual(["uagent.d0.probe"]);

    adapter.disconnectMcp();
    await vi.waitFor(() => expect(adapter.getMcpState().status).toBe("disconnected"));
    expect(nativeCalls).toContain("retract_mvp15_companion_approvals");
    expect(
      nativeExchanges
        .filter(
          (exchange) =>
            exchange.direction === "response" &&
            exchange.method === "native/retract_mvp15_companion_approvals",
        )
        .at(-1)?.payload,
    ).toMatchObject({
      status: "retracted",
      attestationBindingPresent: true,
    });
  });

  it("retracts adapter A native authority before adapter B publishes after renderer reconstruction and clock regression", async () => {
    const evidence = verifiedMvp15DNativeEvidence();
    const events: string[] = [];
    let nativeAuthority = false;
    let nativeMinimumAttestationGeneration = 0;
    let nativeAuthorityGeneration = 0;
    let forwardNativeCalls = 0;
    const now = vi.spyOn(Date, "now").mockReturnValue(9_000_000);
    const nativeInvoke = createNativeInvokeMockAdapter(async (command, payload) => {
      if (command === "retract_mvp15_companion_approvals") {
        const requested = requestedNativeRetractionGeneration(payload);
        events.push(`retract:${requested ?? "baseline"}`);
        nativeAuthorityGeneration += 1;
        if (requested === null) {
          nativeAuthority = false;
          return successfulNativeRetraction(payload, nativeAuthorityGeneration);
        }
        if (requested < nativeMinimumAttestationGeneration) {
          return {
            status: "stale",
            reason: "companion_retraction_stale",
            applied: false,
            requestedAttestationGeneration: requested,
            minimumAttestationGeneration: nativeMinimumAttestationGeneration,
            generation: nativeAuthorityGeneration,
            revokedApprovalCount: 0,
          };
        }
        nativeMinimumAttestationGeneration = requested;
        nativeAuthority = false;
        return successfulNativeRetraction(payload, nativeAuthorityGeneration);
      }
      if (command === "attest_mvp15_companion") {
        const generation = (
          payload as { input?: { attestationGeneration?: number } } | undefined
        )?.input?.attestationGeneration;
        expect(generation).toEqual(expect.any(Number));
        nativeMinimumAttestationGeneration = Math.max(
          nativeMinimumAttestationGeneration,
          generation ?? 0,
        );
        nativeAuthority = true;
        events.push("attest");
        return {
          status: "observed",
          reason: "native_loaded_modules_observed",
          manifest: evidence.manifest,
          installedModules: evidence.installedModules,
          loadedModules: evidence.loadedModules,
        };
      }
      if (
        command === "register_asset_mutation_approval" ||
        command === "execute_asset_mutation"
      ) {
        forwardNativeCalls += 1;
        return nativeAuthority
          ? {
              status:
                command === "register_asset_mutation_approval"
                  ? "registered"
                  : "accepted_by_native_guard",
              reason: "permissive_native_authority",
            }
          : { status: "blocked", reason: "companion_attestation_required" };
      }
      return null;
    });
    const adapterA = createDesktopRuntimeAdapter({
      createTransport: createVerifiedMvp15DTransport,
      nativeInvoke,
    });
    try {
      await makeMvp15DForwardReady(adapterA, "root:adapter-a", "editor-session:adapter-a");
      expect(nativeAuthority).toBe(true);
      const adapterAGeneration = adapterA.getMvp15LiveAssetToolsetFingerprint?.();
      const adapterABinding = adapterA.captureMvp15McpBinding?.();
      expect(adapterAGeneration?.binding).not.toBeNull();
      expect(adapterABinding).toEqual(expect.any(String));
      events.length = 0;

      now.mockReturnValue(1);
      const adapterB = createDesktopRuntimeAdapter({
        createTransport: () => {
          const transport = createVerifiedMvp15DTransport();
          const sendRequest = transport.sendRequest.bind(transport);
          transport.sendRequest = vi.fn(async (request) => {
            if (request.method === "initialize") events.push("adapter-b:initialize");
            return sendRequest(request);
          });
          return transport;
        },
        nativeInvoke,
      });
      const publications: Array<{ status: string; reason: string; nativeAuthority: boolean }> = [];
      const unsubscribe = adapterB.subscribeMcp(() => {
        const companion = adapterB.getMvp15DCompanionStatus?.();
        publications.push({
          status: companion?.status ?? "missing",
          reason: companion?.reason ?? "missing",
          nativeAuthority,
        });
      });
      try {
        await adapterB.connectMcp();
        expect(nativeAuthority).toBe(false);
        await adapterB.discoverMcp();
        const adapterBGeneration = adapterB.getMvp15LiveAssetToolsetFingerprint?.();
        const adapterBBinding = adapterB.captureMvp15McpBinding?.();
        expect(events[0]).toBe("retract:baseline");
        expect(events.indexOf("retract:baseline")).toBeLessThan(
          events.indexOf("adapter-b:initialize"),
        );
        expect(publications.length).toBeGreaterThan(0);
        expect(publications.every((publication) => !publication.nativeAuthority)).toBe(true);
        expect(publications.some((publication) => publication.status === "verified")).toBe(false);
        expect(adapterBGeneration?.discoveryGeneration).toBeGreaterThan(
          adapterAGeneration?.discoveryGeneration ?? 0,
        );
        expect(adapterBGeneration?.binding?.generation).toBeGreaterThan(
          adapterAGeneration?.binding?.generation ?? 0,
        );
        expect(adapterBBinding).not.toBe(adapterABinding);
        expect(adapterB.isMvp15McpBindingCurrent?.(adapterABinding!)).toBe(false);
        expect(adapterB.isMvp15McpBindingCurrent?.(adapterBBinding!)).toBe(true);

        const forwardCountBefore = forwardNativeCalls;
        await expect(
          adapterB.guardMvp15AssetMutation!({ command: "register", phase: "register" } as never),
        ).resolves.toMatchObject({
          status: "blocked",
          reason: "companion_attestation_required",
        });
        await expect(
          adapterB.guardMvp15AssetMutation!({
            command: "guard",
            phase: "execute",
          } as never),
        ).resolves.toMatchObject({
          status: "blocked",
          reason: "companion_attestation_required",
        });
        expect(forwardNativeCalls).toBe(forwardCountBefore);
      } finally {
        unsubscribe();
      }
    } finally {
      now.mockRestore();
    }
  });

  it.each(["stale", "malformed", "throwing"] as const)(
    "keeps startup native authority fail closed when renderer reconstruction retraction is %s",
    async (outcome) => {
      let initializeCalls = 0;
      let forwardNativeCalls = 0;
      const publications: string[] = [];
      const nativeInvoke = createNativeInvokeMockAdapter(async (command, payload) => {
        if (command === "retract_mvp15_companion_approvals") {
          if (outcome === "throwing") throw new Error("startup_retraction_failed");
          if (outcome === "stale") {
            return {
              status: "stale",
              reason: "companion_retraction_stale",
              applied: false,
              requestedAttestationGeneration: null,
              minimumAttestationGeneration: 9_000_000,
              generation: 7,
              revokedApprovalCount: 0,
            };
          }
          return {
            ...successfulNativeRetraction(payload),
            unexpectedAuthorityField: true,
          };
        }
        if (
          command === "register_asset_mutation_approval" ||
          command === "execute_asset_mutation"
        ) {
          forwardNativeCalls += 1;
          return { status: "accepted_by_native_guard", reason: "permissive_native_authority" };
        }
        return null;
      });
      const adapter = createDesktopRuntimeAdapter({
        createTransport: () => {
          initializeCalls += 1;
          return createVerifiedMvp15DTransport();
        },
        nativeInvoke,
      });
      const unsubscribe = adapter.subscribeMcp(() => {
        publications.push(adapter.getMvp15DCompanionStatus?.().reason ?? "missing");
      });
      try {
        await adapter.connectMcp();
        expect(initializeCalls).toBe(0);
        expect(adapter.getMcpState()).toMatchObject({
          status: "error",
          lastError: "Native companion authority baseline retraction failed.",
        });
        expect(adapter.getMvp15DCompanionStatus?.()).toMatchObject({
          status: "installed_unverified",
          reason: "native_companion_retraction_failed",
        });
        expect(publications).toContain("native_companion_retraction_failed");
        await expect(
          adapter.guardMvp15AssetMutation!({ command: "register", phase: "register" } as never),
        ).resolves.toMatchObject({
          status: "blocked",
          reason: "native_companion_retraction_failed",
        });
        expect(forwardNativeCalls).toBe(0);
      } finally {
        unsubscribe();
      }
    },
  );

  it("waits for native companion revocation before publishing disconnect and blocks guards during the barrier", async () => {
    const evidence = verifiedMvp15DNativeEvidence();
    const nativeCalls: string[] = [];
    const nativeExchanges: Array<{
      direction: string;
      method: string;
      payload: unknown;
    }> = [];
    const publicationOrder: string[] = [];
    let resolveRetraction: ((value: unknown) => void) | null = null;
    const adapter = createDesktopRuntimeAdapter({
      createTransport: () =>
        createMockTransport({
          initialize: fullDiscoveryFixtures.initialize,
          "tools/list": { tools: evidence.descriptors },
          "resources/list": { resources: [] },
          "prompts/list": { prompts: [] },
        }),
      nativeInvoke: createNativeInvokeMockAdapter(async (command, payload) => {
        nativeCalls.push(command);
        if (command === "attest_mvp15_companion") {
          return {
            status: "observed",
            reason: "native_loaded_modules_observed",
            manifest: evidence.manifest,
            installedModules: evidence.installedModules,
            loadedModules: evidence.loadedModules,
          } as never;
        }
        if (command === "retract_mvp15_companion_approvals") {
          if (requestedNativeRetractionGeneration(payload) === null) {
            return successfulNativeRetraction(payload) as never;
          }
          return new Promise((resolve) => {
            resolveRetraction = (value) =>
              resolve(bindSuccessfulNativeRetractionToRequest(value, payload));
          }) as never;
        }
        if (command === "execute_asset_mutation") {
          return {
            status: "blocked",
            reason: "companion_attestation_required",
            evidenceId: null,
          } as never;
        }
        return null as never;
      }),
      onMvp15DProductAdapterExchange: (exchange) => {
        if (exchange.method.startsWith("native/")) {
          nativeExchanges.push(exchange);
          publicationOrder.push(`${exchange.direction}:${exchange.method}`);
        }
      },
    });

    await adapter.connectMcp();
    await adapter.discoverMcp();
    expect(
      (
        await adapter.refreshMvp15DCompanionAttestation?.(
          "root:retraction-barrier",
          "editor-session:retraction-barrier",
        )
      )?.status,
    ).toBe("verified");
    expect(
      nativeExchanges.find(
        (exchange) =>
          exchange.direction === "response" && exchange.method === "native/attest_mvp15_companion",
      )?.payload,
    ).toMatchObject({
      status: "verified",
      attestationGeneration: expect.any(Number),
      discoveryGeneration: expect.any(Number),
      bindingEstablished: true,
    });

    const publications: string[] = [];
    let listenerGuard: Promise<unknown> | null = null;
    const unsubscribe = adapter.subscribeMcp((state) => {
      publications.push(state.status);
      publicationOrder.push(`listener:${state.status}`);
      listenerGuard = adapter.guardMvp15AssetMutation!({ command: "guard" } as never);
    });
    adapter.disconnectMcp();

    expect(publications).toEqual([]);
    await vi.waitFor(() => expect(nativeCalls.at(-1)).toBe("retract_mvp15_companion_approvals"));
    expect(nativeExchanges.at(-1)).toMatchObject({
      direction: "request",
      method: "native/retract_mvp15_companion_approvals",
      payload: {
        status: "requested",
        attestationGeneration: expect.any(Number),
        attestationBindingPresent: true,
      },
    });
    await expect(
      adapter.guardMvp15AssetMutation!({ command: "guard" } as never),
    ).resolves.toMatchObject({
      status: "blocked",
      reason: "native_companion_retraction_pending",
    });

    expect(resolveRetraction).toBeTypeOf("function");
    const releaseNativeRetraction = resolveRetraction as unknown as (value: unknown) => void;
    releaseNativeRetraction(successfulNativeRetraction());
    await vi.waitFor(() => expect(publications).toEqual(["disconnected"]));
    const settledExchange = nativeExchanges
      .filter(
        (exchange) =>
          exchange.direction === "response" &&
          exchange.method === "native/retract_mvp15_companion_approvals",
      )
      .at(-1);
    expect(settledExchange?.payload).toMatchObject({
      status: "retracted",
      attestationGeneration: expect.any(Number),
      attestationBindingPresent: true,
      nativeGeneration: 1,
    });
    expect(
      publicationOrder.indexOf("response:native/retract_mvp15_companion_approvals"),
    ).toBeLessThan(publicationOrder.indexOf("listener:disconnected"));
    await expect(listenerGuard).resolves.toMatchObject({
      status: "blocked",
      reason: "companion_attestation_required",
    });
    expect(adapter.getMcpState().status).toBe("disconnected");
    unsubscribe();
  });

  it("keeps a verified renderer fail closed when native retraction reports a numeric stale generation", async () => {
    const evidence = verifiedMvp15DNativeEvidence();
    const nativeCalls: Array<{ command: string; payload: unknown }> = [];
    const nativeExchanges: Array<{
      direction: string;
      method: string;
      payload: unknown;
    }> = [];
    let attestationGeneration: number | null = null;
    let staleRetraction:
      | {
          status: "stale";
          reason: "companion_retraction_stale";
          applied: false;
          requestedAttestationGeneration: number;
          minimumAttestationGeneration: number;
          generation: number;
          revokedApprovalCount: 0;
        }
      | undefined;
    const adapter = createDesktopRuntimeAdapter({
      createTransport: () =>
        createMockTransport({
          initialize: fullDiscoveryFixtures.initialize,
          "tools/list": { tools: evidence.descriptors },
          "resources/list": { resources: [] },
          "prompts/list": { prompts: [] },
        }),
      nativeInvoke: createNativeInvokeMockAdapter(async (command, payload) => {
        nativeCalls.push({ command, payload });
        if (command === "attest_mvp15_companion") {
          attestationGeneration =
            (payload as { input?: { attestationGeneration?: number } } | undefined)?.input
              ?.attestationGeneration ?? null;
          return {
            status: "observed",
            reason: "native_loaded_modules_observed",
            manifest: evidence.manifest,
            installedModules: evidence.installedModules,
            loadedModules: evidence.loadedModules,
          } as never;
        }
        if (command === "retract_mvp15_companion_approvals") {
          const requestedAttestationGeneration = requestedNativeRetractionGeneration(payload);
          if (requestedAttestationGeneration === null) {
            return successfulNativeRetraction(payload) as never;
          }
          staleRetraction = {
            status: "stale",
            reason: "companion_retraction_stale",
            applied: false,
            requestedAttestationGeneration,
            minimumAttestationGeneration: requestedAttestationGeneration + 1,
            generation: 17,
            revokedApprovalCount: 0,
          };
          return staleRetraction as never;
        }
        if (
          command === "register_asset_mutation_approval" ||
          command === "execute_asset_mutation"
        ) {
          return {
            status:
              command === "register_asset_mutation_approval"
                ? "registered"
                : "accepted_by_native_guard",
            reason: "permissive_native_authority",
          } as never;
        }
        return null as never;
      }),
      onMvp15DProductAdapterExchange: (exchange) => {
        if (exchange.method.startsWith("native/")) nativeExchanges.push(exchange);
      },
    });

    await adapter.connectMcp();
    await adapter.discoverMcp();
    await expect(
      adapter.refreshMvp15DCompanionAttestation?.(
        "root:numeric-stale-retraction",
        "editor-session:numeric-stale-retraction",
      ),
    ).resolves.toMatchObject({ status: "verified" });
    expect(attestationGeneration).toEqual(expect.any(Number));
    expect(attestationGeneration).toBeGreaterThan(0);
    expect(adapter.getMvp15DCompanionStatus?.()).toMatchObject({ status: "verified" });
    expect(
      nativeExchanges.find(
        (exchange) =>
          exchange.direction === "response" && exchange.method === "native/attest_mvp15_companion",
      )?.payload,
    ).toMatchObject({
      status: "verified",
      attestationGeneration,
      bindingEstablished: true,
    });

    const forwardCommands = ["register_asset_mutation_approval", "execute_asset_mutation"];
    const forwardCountBeforeRetraction = nativeCalls.filter((call) =>
      forwardCommands.includes(call.command),
    ).length;
    adapter.disconnectMcp();
    await vi.waitFor(() => expect(adapter.getMcpState().status).toBe("disconnected"));

    expect(staleRetraction).toEqual({
      status: "stale",
      reason: "companion_retraction_stale",
      applied: false,
      requestedAttestationGeneration: expect.any(Number),
      minimumAttestationGeneration: expect.any(Number),
      generation: 17,
      revokedApprovalCount: 0,
    });
    const requestedAttestationGeneration = staleRetraction!.requestedAttestationGeneration;
    expect(requestedAttestationGeneration).toBeGreaterThan(attestationGeneration!);
    expect(staleRetraction!.minimumAttestationGeneration).toBeGreaterThan(
      requestedAttestationGeneration,
    );
    expect(staleRetraction!.generation).toBeGreaterThan(0);
    const numericRetractionCall = nativeCalls
      .filter(
        (call) =>
          call.command === "retract_mvp15_companion_approvals" &&
          requestedNativeRetractionGeneration(call.payload) !== null,
      )
      .at(-1);
    expect(numericRetractionCall?.payload).toEqual({
      input: { attestationGeneration: requestedAttestationGeneration },
    });
    const retractionResponse = nativeExchanges
      .filter(
        (exchange) =>
          exchange.direction === "response" &&
          exchange.method === "native/retract_mvp15_companion_approvals",
      )
      .at(-1);
    expect(retractionResponse?.payload).toMatchObject({
      status: "stale",
      attestationGeneration: requestedAttestationGeneration,
      attestationBindingPresent: true,
      nativeGeneration: null,
      nativeMinimumAttestationGeneration: staleRetraction!.minimumAttestationGeneration,
    });
    expect(retractionResponse?.payload).not.toMatchObject({ status: "retracted" });
    expect(adapter.getMvp15DCompanionStatus?.()).toMatchObject({
      status: "installed_unverified",
      reason: "native_companion_retraction_failed",
    });

    await expect(
      adapter.guardMvp15AssetMutation!({ command: "register", phase: "register" } as never),
    ).resolves.toMatchObject({
      status: "blocked",
      reason: "native_companion_retraction_failed",
    });
    await expect(
      adapter.guardMvp15AssetMutation!({ command: "guard", phase: "execute" } as never),
    ).resolves.toMatchObject({
      status: "blocked",
      reason: "native_companion_retraction_failed",
    });
    expect(nativeCalls.filter((call) => forwardCommands.includes(call.command))).toHaveLength(
      forwardCountBeforeRetraction,
    );
    expect(adapter.getMvp15DCompanionStatus?.().reason).toBe("native_companion_retraction_failed");
  });

  it.each(["malformed", "throwing"] as const)(
    "keeps listener publication and a subsequent guard fail closed when native retraction is %s",
    async (outcome) => {
      const evidence = verifiedMvp15DNativeEvidence();
      const nativeCalls: string[] = [];
      const adapter = createDesktopRuntimeAdapter({
        createTransport: () =>
          createMockTransport({
            initialize: fullDiscoveryFixtures.initialize,
            "tools/list": { tools: evidence.descriptors },
            "resources/list": { resources: [] },
            "prompts/list": { prompts: [] },
          }),
        nativeInvoke: createNativeInvokeMockAdapter(async (command, payload) => {
          nativeCalls.push(command);
          if (command === "attest_mvp15_companion") {
            return {
              status: "observed",
              reason: "native_loaded_modules_observed",
              manifest: evidence.manifest,
              installedModules: evidence.installedModules,
              loadedModules: evidence.loadedModules,
            } as never;
          }
          if (command === "retract_mvp15_companion_approvals") {
            if (requestedNativeRetractionGeneration(payload) === null) {
              return successfulNativeRetraction(payload) as never;
            }
            if (outcome === "throwing") throw new Error("native_retraction_throw");
            return { status: "blocked", reason: "malformed_retraction", generation: 0 } as never;
          }
          return null as never;
        }),
      });

      await adapter.connectMcp();
      await adapter.discoverMcp();
      expect(
        (
          await adapter.refreshMvp15DCompanionAttestation?.(
            "root:retraction-failure",
            "editor-session:retraction-failure",
          )
        )?.status,
      ).toBe("verified");
      const publications: string[] = [];
      const unsubscribe = adapter.subscribeMcp((state) => publications.push(state.status));
      adapter.disconnectMcp();
      expect(publications).toEqual([]);
      await vi.waitFor(() => expect(publications).toEqual(["disconnected"]));
      expect(nativeCalls).toContain("retract_mvp15_companion_approvals");
      await expect(
        adapter.guardMvp15AssetMutation!({ command: "guard" } as never),
      ).resolves.toMatchObject({
        status: "blocked",
        reason: "native_companion_retraction_failed",
      });
      unsubscribe();
    },
  );

  it.each([
    "endpoint_change",
    "connect_failure",
    "discovery_failure",
    "disconnect",
    "reconnect",
  ] as const)(
    "settles native revocation before the first listener-to-guard observation on %s",
    async (path) => {
      const harness = await createVerifiedCompanionRevocationHarness();
      const retraction = harness.queueRetraction();
      const observations: Array<{
        fingerprintSha256: string | null;
        companionStatus: string;
        companionReason: string;
        discovery: unknown;
        tools: unknown[];
        binding: string | null;
      }> = [];
      let firstListenerGuard: Promise<unknown> | null = null;
      const unsubscribe = harness.adapter.subscribeMcp(() => {
        const fingerprint = harness.adapter.getMvp15DLiveCompanionFingerprint?.();
        const companion = harness.adapter.getMvp15DCompanionStatus?.();
        observations.push({
          fingerprintSha256: fingerprint?.sha256 ?? null,
          companionStatus: companion?.status ?? "missing",
          companionReason: companion?.reason ?? "missing",
          discovery: harness.adapter.getMcpDiscovery(),
          tools: harness.adapter.getMvp15AssetTools(),
          binding: harness.adapter.captureMvp15McpBinding?.() ?? null,
        });
        if (!firstListenerGuard) {
          harness.events.push("listener");
          firstListenerGuard = harness.adapter.guardMvp15AssetMutation!({
            command: "guard",
          } as never);
        }
      });

      let action: Promise<void> | null = null;
      if (path === "endpoint_change") {
        harness.adapter.setMcpEndpoint("http://127.0.0.1:8766/mcp");
      } else if (path === "connect_failure") {
        harness.failConnect();
        action = harness.adapter.connectMcp();
      } else if (path === "discovery_failure") {
        harness.failDiscovery();
        action = harness.adapter.discoverMcp();
      } else if (path === "disconnect") {
        harness.adapter.disconnectMcp();
      } else {
        action = harness.adapter.connectMcp();
      }

      await vi.waitFor(() => {
        expect(harness.events).toContain("native-retraction:start");
      });
      expect(observations).toEqual([]);
      await expect(
        harness.adapter.guardMvp15AssetMutation!({ command: "guard" } as never),
      ).resolves.toMatchObject({
        status: "blocked",
        reason: "native_companion_retraction_pending",
      });
      expect(harness.getNativeGuardCalls()).toBe(0);

      retraction.resolve(successfulNativeRetraction());
      if (action) await action;
      await vi.waitFor(() => expect(observations.length).toBeGreaterThan(0));
      const first = observations[0]!;
      expect(first).toEqual({
        fingerprintSha256: null,
        companionStatus: "installed_unverified",
        companionReason: "mcp_publication_retracted",
        discovery: null,
        tools: [],
        binding: null,
      });
      await expect(firstListenerGuard).resolves.toMatchObject({
        status: "blocked",
        reason: "companion_attestation_required",
      });
      expect(harness.events.indexOf("native-retraction:settled")).toBeLessThan(
        harness.events.indexOf("listener"),
      );
      expect(harness.events).not.toContain("native-guard");
      expect(harness.getNativeGuardCalls()).toBe(0);
      unsubscribe();
    },
  );

  it.each([
    "endpoint_change",
    "connect_failure",
    "discovery_failure",
    "disconnect",
    "reconnect",
  ] as const)(
    "publishes the fail-closed blocker and does not enter native guard after failed revocation on %s",
    async (path) => {
      const harness = await createVerifiedCompanionRevocationHarness();
      const retraction = harness.queueRetraction();
      const observations: Array<{ reason: string; sha256: string | null }> = [];
      let firstListenerGuard: Promise<unknown> | null = null;
      const unsubscribe = harness.adapter.subscribeMcp(() => {
        observations.push({
          reason: harness.adapter.getMvp15DCompanionStatus?.().reason ?? "missing",
          sha256: harness.adapter.getMvp15DLiveCompanionFingerprint?.().sha256 ?? null,
        });
        if (!firstListenerGuard) {
          firstListenerGuard = harness.adapter.guardMvp15AssetMutation!({
            command: "guard",
          } as never);
        }
      });

      let action: Promise<void> | null = null;
      if (path === "endpoint_change") {
        harness.adapter.setMcpEndpoint("http://127.0.0.1:8766/mcp");
      } else if (path === "connect_failure") {
        harness.failConnect();
        action = harness.adapter.connectMcp();
      } else if (path === "discovery_failure") {
        harness.failDiscovery();
        action = harness.adapter.discoverMcp();
      } else if (path === "disconnect") {
        harness.adapter.disconnectMcp();
      } else {
        action = harness.adapter.connectMcp();
      }

      await vi.waitFor(() => expect(harness.events).toContain("native-retraction:start"));
      expect(observations).toEqual([]);
      retraction.resolve({
        status: "blocked",
        reason: "native_authority_unavailable",
        generation: 0,
      });
      if (action) await action;
      await vi.waitFor(() => expect(observations.length).toBeGreaterThan(0));
      expect(observations[0]).toEqual({
        reason: "native_companion_retraction_failed",
        sha256: null,
      });
      await expect(firstListenerGuard).resolves.toMatchObject({
        status: "blocked",
        reason: "native_companion_retraction_failed",
      });
      expect(harness.getNativeGuardCalls()).toBe(0);
      unsubscribe();
    },
  );

  it.each([
    { path: "refresh", editorSessionId: "editor-session:revocation-harness" },
    { path: "restart", editorSessionId: "editor-session:revocation-restarted" },
  ] as const)(
    "publishes cleared authority after revocation settles, then re-attests on $path",
    async ({ editorSessionId }) => {
      const harness = await createVerifiedCompanionRevocationHarness();
      const retraction = harness.queueRetraction();
      const observations: Array<{ status: string; reason: string; sha256: string | null }> = [];
      let firstListenerGuard: Promise<unknown> | null = null;
      const unsubscribe = harness.adapter.subscribeMcp(() => {
        const companion = harness.adapter.getMvp15DCompanionStatus?.();
        observations.push({
          status: companion?.status ?? "missing",
          reason: companion?.reason ?? "missing",
          sha256: harness.adapter.getMvp15DLiveCompanionFingerprint?.().sha256 ?? null,
        });
        if (!firstListenerGuard) {
          harness.events.push("listener");
          firstListenerGuard = harness.adapter.guardMvp15AssetMutation!({
            command: "guard",
          } as never);
        }
      });

      const refresh = harness.adapter.refreshMvp15DCompanionAttestation!(
        "root:revocation-harness",
        editorSessionId,
      );
      await vi.waitFor(() => expect(harness.events).toContain("native-retraction:start"));
      expect(observations).toEqual([]);
      retraction.resolve(successfulNativeRetraction());
      await expect(refresh).resolves.toMatchObject({ status: "verified" });

      expect(observations).toHaveLength(2);
      expect(observations[0]).toEqual({
        status: "installed_unverified",
        reason: "native_companion_attestation_refresh",
        sha256: null,
      });
      expect(observations[1]).toMatchObject({
        status: "verified",
        reason: "companion_verified_current_generation",
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      });
      await expect(firstListenerGuard).resolves.toMatchObject({
        status: "blocked",
        reason: "companion_attestation_required",
      });
      expect(harness.events.indexOf("native-retraction:settled")).toBeLessThan(
        harness.events.indexOf("listener"),
      );
      unsubscribe();
    },
  );

  it.each(["malformed", "blocked"] as const)(
    "waits for explicit native retraction before listener-to-guard publication of %s attestation",
    async (outcome) => {
      const harness = await createVerifiedCompanionRevocationHarness();
      const refreshRetraction = harness.queueRetraction();
      const negativeRetraction = harness.queueRetraction();
      harness.queueAttestation(
        outcome === "malformed"
          ? { status: "observed", reason: "missing_evidence" }
          : {
              status: "blocked",
              reason: "loaded_module_evidence_unavailable",
              manifest: null,
              installedModules: [],
              loadedModules: [],
            },
      );
      const observations: Array<{ reason: string; sha256: string | null }> = [];
      const listenerGuards: Array<Promise<unknown>> = [];
      const unsubscribe = harness.adapter.subscribeMcp(() => {
        observations.push({
          reason: harness.adapter.getMvp15DCompanionStatus?.().reason ?? "missing",
          sha256: harness.adapter.getMvp15DLiveCompanionFingerprint?.().sha256 ?? null,
        });
        listenerGuards.push(
          harness.adapter.guardMvp15AssetMutation!({ command: "guard" } as never),
        );
      });

      const refresh = harness.adapter.refreshMvp15DCompanionAttestation!(
        "root:revocation-harness",
        "editor-session:revocation-negative",
      );
      await vi.waitFor(() => {
        expect(harness.events.filter((event) => event === "native-retraction:start")).toHaveLength(
          1,
        );
      });
      expect(observations).toEqual([]);
      refreshRetraction.resolve(successfulNativeRetraction(undefined, 1));
      await vi.waitFor(() => {
        expect(harness.events.filter((event) => event === "native-retraction:start")).toHaveLength(
          2,
        );
      });
      expect(observations).toEqual([
        {
          reason: "native_companion_attestation_refresh",
          sha256: null,
        },
      ]);
      await expect(
        harness.adapter.guardMvp15AssetMutation!({ command: "guard" } as never),
      ).resolves.toMatchObject({
        status: "blocked",
        reason: "native_companion_retraction_pending",
      });

      negativeRetraction.resolve(successfulNativeRetraction(undefined, 2));
      await refresh;
      expect(observations).toEqual([
        { reason: "native_companion_attestation_refresh", sha256: null },
        {
          reason:
            outcome === "malformed"
              ? "native_companion_attestation_invalid"
              : "loaded_module_evidence_unavailable",
          sha256: null,
        },
      ]);
      await Promise.all(
        listenerGuards.map(async (guard) => {
          await expect(guard).resolves.toMatchObject({
            status: "blocked",
            reason: "companion_attestation_required",
          });
        }),
      );
      expect(harness.getNativeGuardCalls()).toBe(0);
      unsubscribe();
    },
  );

  it("retracts an in-flight attestation before reconnect notification and ignores its stale completion", async () => {
    const harness = await createVerifiedCompanionRevocationHarness();
    const refreshRetraction = harness.queueRetraction();
    const staleAttestation = createDeferred<unknown>();
    harness.queueAttestation(staleAttestation.promise);
    const refresh = harness.adapter.refreshMvp15DCompanionAttestation!(
      "root:revocation-harness",
      "editor-session:stale-attestation",
    );
    await vi.waitFor(() => expect(harness.events).toContain("native-retraction:start"));
    refreshRetraction.resolve(successfulNativeRetraction(undefined, 1));
    await vi.waitFor(() => {
      expect(
        harness.nativeCalls.filter((command) => command === "attest_mvp15_companion"),
      ).toHaveLength(1);
    });

    const reconnectRetraction = harness.queueRetraction();
    const observations: Array<{ reason: string; sha256: string | null }> = [];
    let firstListenerGuard: Promise<unknown> | null = null;
    const unsubscribe = harness.adapter.subscribeMcp(() => {
      observations.push({
        reason: harness.adapter.getMvp15DCompanionStatus?.().reason ?? "missing",
        sha256: harness.adapter.getMvp15DLiveCompanionFingerprint?.().sha256 ?? null,
      });
      if (!firstListenerGuard) {
        firstListenerGuard = harness.adapter.guardMvp15AssetMutation!({
          command: "guard",
        } as never);
      }
    });
    const reconnect = harness.adapter.connectMcp();
    await vi.waitFor(() => {
      expect(harness.events.filter((event) => event === "native-retraction:start")).toHaveLength(2);
    });
    expect(observations).toEqual([]);
    reconnectRetraction.resolve(successfulNativeRetraction(undefined, 2));
    await reconnect;
    await vi.waitFor(() => expect(observations.length).toBeGreaterThan(0));
    const publicationCountBeforeStaleCompletion = observations.length;

    const evidence = verifiedMvp15DNativeEvidence();
    staleAttestation.resolve({
      status: "observed",
      reason: "native_loaded_modules_observed",
      manifest: evidence.manifest,
      installedModules: evidence.installedModules,
      loadedModules: evidence.loadedModules,
    });
    await refresh;
    expect(observations).toHaveLength(publicationCountBeforeStaleCompletion);
    expect(observations[0]).toEqual({
      reason: "mcp_publication_retracted",
      sha256: null,
    });
    await expect(firstListenerGuard).resolves.toMatchObject({
      status: "blocked",
      reason: "companion_attestation_required",
    });
    expect(harness.adapter.getMvp15DCompanionStatus?.().status).toBe("installed_unverified");
    expect(harness.adapter.getMvp15DLiveCompanionFingerprint?.().sha256).toBeNull();
    unsubscribe();
  });

  it("exposes a narrow MVP15 asset bridge through native guard and allowlisted MCP tools only", async () => {
    const evidence = verifiedMvp15DNativeEvidence();
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
            result: { tools: evidence.descriptors },
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
    const nativeInvoke = createVerifiedMvp15DNativeInvoke(nativeInvokeMock);
    const adapter = createDesktopRuntimeAdapter({
      createTransport: () => transport,
      nativeInvoke,
    }) as ReturnType<typeof createDesktopRuntimeAdapter> & Mvp15AssetBridge;
    await makeMvp15DForwardReady(adapter);

    expect(adapter.guardMvp15AssetMutation).toBeTypeOf("function");
    expect(adapter.callMvp15AssetTool).toBeTypeOf("function");

    const guard = await adapter.guardMvp15AssetMutation!({
      command: "guard",
      registrationId: "asset-registration:bridge",
      approvalToken: "asset-approval-token:redacted",
      phase: "execute",
      operationIndex: 0,
      operationCount: 1,
      changeSetId: "changeset:bridge",
      runId: "run-1",
      projectBindingId: "project:bridge",
      mcpBinding: "mcp-binding:bridge-1",
      aggregateDryRunHash: "a".repeat(64),
      aggregateArgsHash: "b".repeat(64),
      operation: {
        operationId: "op-save",
        kind: "save",
        toolName: "ue.asset.save",
        pluginDryRunHash: "c".repeat(40),
        argsHash: "d".repeat(64),
        sourceAssetPath: null,
        assetPath: "/Game/UAgentSandbox/run-1/Hero",
        targetAssetPath: null,
        rollbackAction: "none",
        rollbackToolName: null,
        saveAll: false,
        bulk: false,
      },
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
        return {
          ok: true,
          reason: "valid",
          displayRoot: "[project]/PhaseD",
          projectName: "PhaseD",
          engine: { label: "UE", association: null, source: "fixture" },
        } as never;
      }
      if (command === "trust_native_project_root")
        return {
          rootId: "root:phase-d",
          displayRoot: "[project]/PhaseD",
          trustState: "trusted",
        } as never;
      if (command === "register_asset_mutation_approval")
        return {
          status: "registered",
          reason: "approval_binding_registered",
          registrationId: "asset-approval:phase-d",
          operationCount: 5,
          approvalToken: "a".repeat(64),
          issuedAt: 1,
          expiresAt: 2000,
        } as never;
      if (command === "cancel_asset_mutation_approval")
        return {
          status: "cancelled",
          reason: "approval_registration_cancelled",
          registrationId: "asset-approval:phase-d",
        } as never;
      if (command === "execute_asset_mutation")
        return {
          status: "accepted_by_native_guard",
          reason: "registered_binding_matched",
          registrationId: "asset-approval:phase-d",
          phase: "execute",
          operationId: "op-1",
          operationIndex: 0,
          operationCount: 5,
          evidenceId: "native:phase-d",
          accepted_plan_binding: "1".repeat(64),
          native_created_at: 1_753_305_600_000,
          connection_generation: 17,
          session_generation: 23,
          native_source_identity: "2".repeat(64),
          native_manifest_identity: "3".repeat(64),
          native_plugin_identity: "4".repeat(64),
          native_package_identity: "5".repeat(64),
        } as never;
      if (command === "record_asset_mutation_outcome")
        return {
          status: "recorded",
          reason: "operation_outcome_recorded",
          registrationId: "asset-approval:phase-d",
          phase: "execute",
          operationId: "op-1",
          rollbackAvailable: true,
          terminal: false,
        } as never;
      return null as never;
    };
    const projectAdapter = createNativeProjectAdapter({ invoke: nativeInvoke, now: () => 1 });
    const project = await projectAdapter.addProject(rawRoot);
    const trusted = await projectAdapter.confirmTrust(project.id);
    const adapter = createDesktopRuntimeAdapter({
      nativeInvoke: createVerifiedMvp15DNativeInvoke(async (command, payload) =>
        nativeInvoke(command, payload),
      ),
      createTransport: createVerifiedMvp15DTransport,
    });
    await makeMvp15DForwardReady(adapter);
    const operation = {
      operationId: "op-1",
      kind: "create_folder" as const,
      toolName: "ue.asset.create_folder",
      pluginDryRunHash: "a".repeat(40),
      argsHash: "b".repeat(64),
      sourceAssetPath: null,
      assetPath: "/Game/UAgentSandbox/run-1",
      targetAssetPath: null,
      rollbackAction: "cleanup_empty_folder" as const,
      rollbackToolName: "ue.asset.delete",
      saveAll: false as const,
      bulk: false as const,
    };
    const guardCommon = {
      changeSetId: "changeset-1",
      runId: "run-1",
      projectBindingId: trusted.id,
      mcpBinding: "mcp-binding:phase-d",
      aggregateDryRunHash: "c".repeat(64),
      aggregateArgsHash: "d".repeat(64),
    };

    const registered = await adapter.guardMvp15AssetMutation!({
      command: "register",
      phase: "register",
      trustedRootRef: trusted.rootRef,
      editorSessionId: "editor-session:1",
      requestedTtlMs: 1_999,
      operations: [operation, operation, operation, operation, operation],
      ...guardCommon,
    });
    const guarded = await adapter.guardMvp15AssetMutation!({
      command: "guard",
      registrationId: "asset-approval:phase-d",
      approvalToken: "raw-token-native-only",
      phase: "execute",
      operationIndex: 0,
      operationCount: 5,
      operation,
      ...guardCommon,
    });
    const recorded = await adapter.guardMvp15AssetMutation!({
      command: "record_outcome",
      operationIndex: 0,
      registrationId: "asset-approval:phase-d",
      phase: "execute",
      operationId: "op-1",
      success: true,
      sideEffectObserved: true,
      effectState: "known_effect",
      rollbackAvailable: true,
      evidenceId: "mcp:op-1",
      reasonCode: "none",
    });
    const cancelled = await adapter.guardMvp15AssetMutation!({
      command: "cancel_registration",
      phase: "cancel",
      registrationId: "asset-approval:phase-d",
      approvalToken: "a".repeat(64),
    });

    expect(registered).toMatchObject({
      status: "registered",
      registrationId: "asset-approval:phase-d",
      operationCount: 5,
    });
    expect(guarded).toMatchObject({
      status: "accepted_by_native_guard",
      operationIndex: 0,
      evidenceId: "native:phase-d",
      acceptedPlanBinding: "1".repeat(64),
      nativeRegistrationId: "asset-approval:phase-d",
      nativePhase: "execute",
      nativeOperationIndex: 0,
      nativeOperationCount: 5,
      nativeCreatedAt: 1_753_305_600_000,
      connectionGeneration: 17,
      sessionGeneration: 23,
      nativeSourceIdentity: "2".repeat(64),
      nativeManifestIdentity: "3".repeat(64),
      nativePluginIdentity: "4".repeat(64),
      nativePackageIdentity: "5".repeat(64),
    });
    expect(recorded).toMatchObject({
      status: "recorded",
      operationId: "op-1",
      rollbackAvailable: true,
    });
    expect(cancelled).toMatchObject({
      status: "cancelled",
      registrationId: "asset-approval:phase-d",
    });
    const relevantCalls = nativeCalls.filter((call) =>
      [
        "validate_native_project_root",
        "trust_native_project_root",
        "register_asset_mutation_approval",
        "execute_asset_mutation",
        "record_asset_mutation_outcome",
        "cancel_asset_mutation_approval",
      ].includes(call.command),
    );
    expect(relevantCalls.map((call) => call.command)).toEqual([
      "validate_native_project_root",
      "trust_native_project_root",
      "register_asset_mutation_approval",
      "execute_asset_mutation",
      "record_asset_mutation_outcome",
      "cancel_asset_mutation_approval",
    ]);
    const registrationPayload = relevantCalls[2]?.payload as { input?: Record<string, unknown> };
    expect(registrationPayload.input?.trustedProjectRoot).toBe(rawRoot);
    expect(registrationPayload.input).not.toHaveProperty("trustedRootRef");
    for (const forbidden of [
      "pidHash",
      "observedEditorSessionId",
      "observedPidHash",
      "assetMutationGateEnabled",
    ])
      expect(registrationPayload.input).not.toHaveProperty(forbidden);
    const guardPayload = relevantCalls[3]?.payload as { input?: Record<string, unknown> };
    for (const forbidden of [
      "trustedRootId",
      "editorSessionId",
      "pidHash",
      "observedEditorSessionId",
      "observedPidHash",
      "assetMutationGateEnabled",
    ])
      expect(guardPayload.input).not.toHaveProperty(forbidden);
    expect(relevantCalls[5]?.payload).toEqual({
      input: { registrationId: "asset-approval:phase-d", approvalToken: "a".repeat(64) },
    });
    expect(JSON.stringify({ registered, guarded, recorded })).not.toContain(rawRoot);
  });

  it("blocks mutation registration before confirmTrust without invoking the native registration command", async () => {
    const rawRoot = "G:/Projects/A20Desktop";
    const nativeCommands: string[] = [];
    const nativeInvoke: NativeInvoke = async (command) => {
      nativeCommands.push(command);
      if (command === "validate_native_project_root")
        return {
          ok: true,
          reason: "valid",
          displayRoot: "[project]/A20Desktop",
          projectName: "A20Desktop",
          engine: { label: "UE", association: null, source: "fixture" },
        } as never;
      if (command === "trust_native_project_root")
        return {
          rootId: "root:a20-desktop",
          displayRoot: "[project]/A20Desktop",
          trustState: "trusted",
        } as never;
      if (command === "register_asset_mutation_approval")
        return {
          status: "registered",
          reason: null,
          registrationId: "registration:a20",
          operationCount: 1,
          approvalToken: "a".repeat(64),
          issuedAt: 1,
          expiresAt: 60_000,
        } as never;
      return null as never;
    };
    const projectAdapter = createNativeProjectAdapter({ invoke: nativeInvoke, now: () => 1 });
    const project = await projectAdapter.addProject(rawRoot);
    const adapter = createDesktopRuntimeAdapter({
      nativeInvoke: createVerifiedMvp15DNativeInvoke(async (command, payload) =>
        nativeInvoke(command, payload),
      ),
      createTransport: createVerifiedMvp15DTransport,
    });
    await makeMvp15DForwardReady(adapter);
    const registration = {
      command: "register" as const,
      phase: "register" as const,
      changeSetId: "changeset:a20",
      runId: "run-a20",
      projectBindingId: project.id,
      trustedRootRef: project.rootRef,
      editorSessionId: "observation:a20",
      mcpBinding: "mcp-binding:a20",
      aggregateDryRunHash: "b".repeat(64),
      aggregateArgsHash: "c".repeat(64),
      requestedTtlMs: 60_000,
      operations: [
        {
          operationId: "operation:a20",
          kind: "create_folder" as const,
          toolName: "ue.asset.create_folder",
          pluginDryRunHash: "d".repeat(40),
          argsHash: "e".repeat(64),
          sourceAssetPath: null,
          assetPath: "/Game/UAgentSandbox/run-a20",
          targetAssetPath: null,
          rollbackAction: "cleanup_empty_folder" as const,
          rollbackToolName: "ue.asset.delete",
          saveAll: false as const,
          bulk: false as const,
        },
      ],
    };
    await expect(adapter.guardMvp15AssetMutation!(registration)).resolves.toMatchObject({
      status: "blocked",
      reason: "trusted_root_ref_unavailable",
    });
    expect(
      nativeCommands.filter((command) => command === "register_asset_mutation_approval"),
    ).toHaveLength(0);
    const trusted = await projectAdapter.confirmTrust(project.id);
    await expect(
      adapter.guardMvp15AssetMutation!({
        ...registration,
        projectBindingId: trusted.id,
        trustedRootRef: trusted.rootRef,
      }),
    ).resolves.toMatchObject({ status: "registered", registrationId: "registration:a20" });
    expect(
      nativeCommands.filter((command) => command === "register_asset_mutation_approval"),
    ).toHaveLength(1);
  });

  it("redacts malformed native guard identifiers and reasons before they cross the desktop boundary", async () => {
    const adapter = createDesktopRuntimeAdapter({
      createTransport: createVerifiedMvp15DTransport,
      nativeInvoke: createVerifiedMvp15DNativeInvoke(async (command) =>
        command === "execute_asset_mutation"
          ? {
              status: "accepted_by_native_guard",
              reason: "G:\\private\\project",
              registrationId: "G:\\private\\registration",
              phase: "execute",
              operationId: "op-1",
              operationIndex: 0,
              operationCount: 1,
              evidenceId: "C:\\private\\evidence",
            }
          : null,
      ),
    });
    await makeMvp15DForwardReady(adapter);

    const result = await adapter.guardMvp15AssetMutation!({
      command: "guard",
      registrationId: "registration:redaction",
      approvalToken: "token-native-only",
      phase: "execute",
      operationIndex: 0,
      operationCount: 1,
      changeSetId: "changeset:redaction",
      runId: "run-redaction",
      projectBindingId: "project:redaction",
      mcpBinding: "mcp-binding:redaction",
      aggregateDryRunHash: "a".repeat(64),
      aggregateArgsHash: "b".repeat(64),
      operation: {
        operationId: "op-1",
        kind: "save",
        toolName: "ue.asset.save",
        pluginDryRunHash: "c".repeat(40),
        argsHash: "d".repeat(64),
        sourceAssetPath: null,
        assetPath: "/Game/UAgentSandbox/run-1/Hero",
        targetAssetPath: null,
        rollbackAction: "none",
        rollbackToolName: null,
        saveAll: false,
        bulk: false,
      },
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
      if (command === "retract_mvp15_companion_approvals") {
        return successfulNativeRetraction(payload) as never;
      }
      if (command === "read_asset_content_evidence") {
        return {
          status: "observed",
          reason: "asset_present",
          assetPath: "/Game/Test01",
          exists: true,
          size: 12,
          sha256: "a".repeat(64),
          evidenceId: "asset-content:source",
        } as never;
      }
      if (command === "snapshot_asset_content_manifest") {
        return {
          status: "observed",
          reason: "content_manifest_captured",
          entries: [{ assetPath: "/Game/Test01", size: 12, sha256: "a".repeat(64) }],
          aggregateSha256: "b".repeat(64),
          evidenceId: "asset-content-manifest:before",
        } as never;
      }
      return null as never;
    };
    const adapter = createDesktopRuntimeAdapter({ nativeInvoke }) as ReturnType<
      typeof createDesktopRuntimeAdapter
    > & {
      readMvp15AssetContentEvidence?: (input: Record<string, unknown>) => Promise<unknown>;
      snapshotMvp15AssetContentManifest?: (input: Record<string, unknown>) => Promise<unknown>;
    };
    expect(adapter.readMvp15AssetContentEvidence).toBeTypeOf("function");
    expect(adapter.snapshotMvp15AssetContentManifest).toBeTypeOf("function");
    if (!adapter.readMvp15AssetContentEvidence || !adapter.snapshotMvp15AssetContentManifest)
      return;

    const binding = { registrationId: "registration:phase-e" };
    const evidence = await adapter.readMvp15AssetContentEvidence({
      ...binding,
      assetPath: "/Game/Test01",
    });
    const manifest = await adapter.snapshotMvp15AssetContentManifest(binding);

    expect(evidence).toEqual({
      status: "observed",
      reason: "asset_present",
      assetPath: "/Game/Test01",
      exists: true,
      size: 12,
      sha256: "a".repeat(64),
      evidenceId: "asset-content:source",
    });
    expect(manifest).toEqual({
      status: "observed",
      reason: "content_manifest_captured",
      entries: [{ assetPath: "/Game/Test01", size: 12, sha256: "a".repeat(64) }],
      aggregateSha256: "b".repeat(64),
      evidenceId: "asset-content-manifest:before",
    });
    expect(nativeCalls).toHaveLength(4);
    expect(nativeCalls).toEqual(
      expect.arrayContaining([
      { command: "terminal_capability_status", payload: undefined },
      { command: "browser_capability_status", payload: undefined },
      {
        command: "read_asset_content_evidence",
        payload: { input: { ...binding, assetPath: "/Game/Test01" } },
      },
      { command: "snapshot_asset_content_manifest", payload: { input: binding } },
      ]),
    );
    expect(JSON.stringify({ evidence, manifest })).not.toContain("G:/");

    const leakingAdapter = createDesktopRuntimeAdapter({
      nativeInvoke: async (command) =>
        command === "read_asset_content_evidence"
          ? ({
              status: "observed",
              reason: "asset_present",
              assetPath: "/Game/Test01",
              exists: true,
              size: 12,
              sha256: "a".repeat(64),
              evidenceId: "asset-content:source",
              unexpectedRoot: "/home/user/project",
            } as never)
          : (null as never),
    });
    const rejectedLeak = await leakingAdapter.readMvp15AssetContentEvidence?.({
      ...binding,
      assetPath: "/Game/Test01",
    });
    expect(rejectedLeak).toMatchObject({
      status: "failed",
      reason: "native_asset_evidence_invalid_result",
      evidenceId: null,
    });
  });

  it("routes Phase F registered rollback guard and outcome through rollback-native DTOs", async () => {
    const nativeCalls: Array<{ command: string; payload: unknown }> = [];
    const nativeInvoke: NativeInvoke = async (command, payload) => {
      nativeCalls.push({ command, payload });
      const input = (payload as { input?: Record<string, unknown> } | undefined)?.input ?? {};
      if (command === "retract_mvp15_companion_approvals") {
        return successfulNativeRetraction(payload) as never;
      }
      if (command === "rollback_asset_mutation") {
        const operation = input.operation as { operationId?: string } | undefined;
        return {
          status: "accepted_by_native_guard",
          reason: "registered_binding_matched",
          registrationId: input.registrationId,
          phase: "rollback",
          operationId: operation?.operationId,
          operationIndex: input.operationIndex,
          operationCount: input.operationCount,
          evidenceId: "native:rollback:3",
        } as never;
      }
      if (command === "record_asset_mutation_outcome") {
        return {
          status: "recorded",
          reason: "operation_succeeded",
          registrationId: input.registrationId,
          phase: "rollback",
          operationId: input.operationId,
          rollbackAvailable: true,
          terminal: false,
        } as never;
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
      operation: {
        operationId: "op-move",
        kind: "move_back",
        toolName: "ue.asset.move",
        pluginDryRunHash: "c".repeat(40),
        argsHash: "d".repeat(64),
        assetPath: "/Game/UAgentSandbox/run-phase-f/Sub/Hero",
        targetAssetPath: "/Game/UAgentSandbox/run-phase-f/Hero",
        rollbackAction: "none",
        saveAll: false,
        bulk: false,
      },
    };

    const guarded = await adapter.guardMvp15AssetMutation!({
      command: "guard",
      approvalToken: null,
      ...common,
    } as never);
    const recorded = await adapter.guardMvp15AssetMutation!({
      command: "record_outcome",
      operationIndex: 3,
      registrationId: common.registrationId,
      phase: "rollback",
      operationId: "op-move",
      success: true,
      sideEffectObserved: true,
      rollbackAvailable: false,
      evidenceId: "mcp:rollback:move",
      reasonCode: "none",
    } as never);

    expect(guarded).toMatchObject({
      status: "accepted_by_native_guard",
      phase: "rollback",
      operationId: "op-move",
      operationIndex: 3,
    });
    expect(recorded).toMatchObject({
      status: "recorded",
      phase: "rollback",
      operationId: "op-move",
      rollbackAvailable: true,
    });
    expect(
      nativeCalls
        .filter((call) => call.command.includes("asset_mutation"))
        .map((call) => call.command),
    ).toEqual(["rollback_asset_mutation", "record_asset_mutation_outcome"]);
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
    expect(adapter.getMvp15LiveAssetToolsetFingerprint!()).toMatchObject({
      status: "ready",
      toolCount: 6,
      source: "facade",
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      binding: { session: "current", endpoint: "redacted" },
    });
    expect(
      sendRequest.mock.calls
        .filter((call) => call[0].method === "tools/call")
        .map((call) => (call[0].params as { name?: string }).name),
    ).toEqual(["list_toolsets", "describe_toolset"]);

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
        arguments: { toolset_name: "editor_toolset.toolsets.asset.AssetTools" },
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
    expect(mutationAttempt).toMatchObject({
      status: "blocked",
      reason: "companion_attestation_required",
    });
    expect(sendRequest.mock.calls.filter((call) => call[0].method === "tools/call")).toHaveLength(
      3,
    );
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

    const result = await adapter.callMvp15AssetTool!("ue.asset.save", saveArgs);

    expect(result).toMatchObject({
      status: "blocked",
      reason: "companion_attestation_required",
    });
    expect(
      sendRequest.mock.calls
        .filter((call) => call[0].method === "tools/call")
        .map((call) => call[0].params),
    ).toEqual([]);
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
    await vi.waitFor(() => expect(adapter.getMcpState().status).toBe("disconnected"));

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
      if (command === "retract_mvp15_companion_approvals") {
        return successfulNativeRetraction(payload);
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
