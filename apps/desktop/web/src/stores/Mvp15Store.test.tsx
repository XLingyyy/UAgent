import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { McpTransportClient } from "@uagent/mcp-client";
import {
  MVP15_ASSET_TOOL_ALLOWLIST,
  computeMvp15DManifestSha256,
  type Mvp15McpAssetToolInventory,
  type Mvp15McpAssetToolName,
} from "@uagent/runtime";
import { AssetMutationPanel, formatMvp15UiBlocker } from "../inspector/AssetMutationPanel";
import { McpMutationPanel } from "../inspector/McpMutationPanel";
import { createDesktopRuntimeAdapter } from "../runtime/desktop-runtime-adapter";
import { createEmptyMvp14State, createEmptyMvp15State, type Mvp14RuntimeState } from "../runtime/runtime-store";
import { createNativeProjectAdapter, type NativeInvoke } from "../runtime/project-native-adapter";
import { ChangesPanel } from "../inspector/ChangesPanel";
import { ConfigSettings } from "../settings/pages/ConfigSettings";
import { UIProvider, useOptionalRuntimeActions, useRuntimeStore } from "./ui-store";
import {
  UAGENT_COMPANION_CONTRACT_VERSION,
  UAGENT_COMPANION_IDENTITY_SCHEMA_VERSION,
  UAGENT_COMPANION_MANIFEST_SCHEMA_VERSION,
  UAGENT_COMPANION_PLUGIN_ID,
  UAGENT_COMPANION_PLUGIN_VERSION,
  UAGENT_COMPANION_UE_BUILD_ID,
  UAGENT_COMPANION_UE_VERSION,
} from "@uagent/shared";

const MVP15_TEST_TOOL_NAMES = MVP15_ASSET_TOOL_ALLOWLIST;

describe("MVP15 UI blocker redaction", () => {
  it("keeps stable reasons and replaces raw authority facts", () => {
    expect(formatMvp15UiBlocker("feature_disabled")).toBe("feature_disabled");
    expect(formatMvp15UiBlocker("transaction_expired")).toBe("transaction_expired");
    expect(formatMvp15UiBlocker("G:\\private\\project")).toBe("asset_mutation_blocked");
    expect(formatMvp15UiBlocker("pid:12345")).toBe("asset_mutation_blocked");
    expect(formatMvp15UiBlocker("session:private-session")).toBe("asset_mutation_blocked");
  });
});

const MVP15_READY_CONTRACT_TEXT = [
  "Live exact-six contract: attestation required",
  `Exact-six tools (6/6): ${MVP15_TEST_TOOL_NAMES.join(", ")}`,
  "Input schemas: ready",
  "Dry-run schemas: ready",
  "Rollback metadata: ready",
  "Affected-assets schemas: ready",
  "Read-only evidence queries: ready",
] as const;

const MVP15_TEST_TOOL_CONTRACTS = {
  inputSchema: { type: "object" },
  dryRunSchema: { type: "object" },
  rollbackContract: { type: "reverse_operation" },
  affectedAssetsSchema: { type: "array" },
  evidenceQuery: { type: "read_only" },
};

function createMvp15DCompanionEvidence() {
  const manifestBase = {
    schemaVersion: UAGENT_COMPANION_MANIFEST_SCHEMA_VERSION,
    pluginId: UAGENT_COMPANION_PLUGIN_ID,
    pluginVersion: UAGENT_COMPANION_PLUGIN_VERSION,
    contractVersion: UAGENT_COMPANION_CONTRACT_VERSION,
    sourceCommit: "a".repeat(40),
    sourceTreeSha256: "b".repeat(64),
    dirty: false as const,
    ueVersion: UAGENT_COMPANION_UE_VERSION,
    ueBuildId: UAGENT_COMPANION_UE_BUILD_ID,
    targetPlatform: "Win64" as const,
    configuration: "Development" as const,
    compiler: "MSVC",
    windowsSdk: "Windows SDK (fixture)",
    buildCommandFingerprint: "c".repeat(64),
    uplugin: { name: "UAgentAssetTools.uplugin", size: 1, sha256: "d".repeat(64) },
    schema: { name: "uagent-asset-tools.schema.json", size: 2, sha256: "e".repeat(64) },
    moduleIndex: { name: "UnrealEditor.modules", size: 3, sha256: "1".repeat(64) },
    modules: [{ name: "UAgentAssetTools-Win64-Development.dll", size: 3, sha256: "f".repeat(64) }],
    toolNames: MVP15_TEST_TOOL_NAMES,
    generatedAt: "2026-07-20T00:00:00.000Z",
    builder: { kind: "local" as const, name: "desktop-test" },
  };
  const manifest = {
    ...manifestBase,
    manifestSha256: computeMvp15DManifestSha256({ ...manifestBase, manifestSha256: "" }),
  };
  return {
    manifest,
    installedModules: manifest.modules,
    loadedModules: manifest.modules,
    identity: {
      schemaVersion: UAGENT_COMPANION_IDENTITY_SCHEMA_VERSION,
      pluginId: UAGENT_COMPANION_PLUGIN_ID,
      pluginVersion: UAGENT_COMPANION_PLUGIN_VERSION,
      contractVersion: UAGENT_COMPANION_CONTRACT_VERSION,
      sourceCommit: manifest.sourceCommit,
      sourceTreeSha256: manifest.sourceTreeSha256,
      buildManifestSha256: manifest.manifestSha256,
      ueBuildId: UAGENT_COMPANION_UE_BUILD_ID,
      buildCommandFingerprint: manifest.buildCommandFingerprint,
      loadedModuleName: manifest.modules[0]!.name,
      loadedModuleSha256: manifest.modules[0]!.sha256,
    },
  };
}

function createNativeMvp15DCompanionAttestation() {
  const evidence = createMvp15DCompanionEvidence();
  return {
    status: "observed",
    reason: "companion_observed",
    manifest: evidence.manifest,
    installedModules: evidence.installedModules,
    loadedModules: evidence.loadedModules,
  };
}

function createNativeMvp15DCompanionRetraction(payload?: unknown) {
  const requested = (payload as { input?: { attestationGeneration?: unknown } } | undefined)
    ?.input?.attestationGeneration;
  const requestedAttestationGeneration =
    typeof requested === "number" && Number.isSafeInteger(requested) && requested > 0
      ? requested
      : null;
  return {
    status: "retracted",
    reason: "companion_approval_retracted",
    applied: true,
    requestedAttestationGeneration,
    minimumAttestationGeneration: requestedAttestationGeneration ?? 0,
    generation: 1,
    revokedApprovalCount: 0,
  };
}

function createMvp15InventoryForAssetsDom(
  availableTools: readonly string[],
  status: Mvp15McpAssetToolInventory["status"] = "ready",
): Mvp15McpAssetToolInventory {
  return {
    status,
    availableTools: [...availableTools] as Mvp15McpAssetToolName[],
    duplicateTools: [],
    missingTools: [],
    missingSchemas: [],
    missingDryRunSchemas: [],
    missingRollbackContracts: [],
    missingEvidenceQueries: [],
    decisions: [],
  };
}

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
  operationId: string,
  beforePath: string | null,
  afterPath: string | null,
): Record<string, unknown> {
  const operation = TOOL_NAME_TO_OPERATION[toolName as keyof typeof TOOL_NAME_TO_OPERATION] ?? "create_folder";
  const isDuplicate = toolName === "ue.asset.duplicate";
  const isDelete = toolName === "ue.asset.delete";
  const isRenameOrMove = toolName === "ue.asset.rename" || toolName === "ue.asset.move";
  const rollbackAvailable = toolName !== "ue.asset.save" && toolName !== "ue.asset.delete";
  const inverseOperation = toolName === "ue.asset.create_folder"
    ? "cleanup_empty_folder"
    : toolName === "ue.asset.duplicate"
      ? "delete_duplicate"
      : toolName === "ue.asset.rename"
        ? "rename_back"
        : toolName === "ue.asset.move"
          ? "move_back"
          : "none";
  const wouldRead = isDuplicate && beforePath ? [beforePath] : [];
  const wouldModify = isDelete
    ? (beforePath ? [beforePath] : [])
    : isRenameOrMove
      ? (beforePath && afterPath ? [beforePath, afterPath] : [])
      : (afterPath ? [afterPath] : []);
  return {
    blocked: false,
    status: "dry_run_completed",
    reasonCode: "none",
    toolName,
    operation,
    phase: "dry_run",
    changeSetId,
    runId,
    operationId,
    sandboxRoot: `/Game/UAgentSandbox/${runId}`,
    wouldChange: true,
    wouldModify,
    wouldRead,
    affectedAssets: { readOnlySources: wouldRead, sandboxTargets: wouldModify, externalTargets: [] },
    rollbackPlan: { strategy: "ledger_inverse", executionEnabled: false, inverseOperation },
    externalEvidenceQueries: [{ queryKind: "asset_registry_snapshot", readOnly: true, paths: [...wouldRead, ...wouldModify] }],
    dryRunHash: fakeSha1Hex(`${toolName}|${changeSetId}|${runId}|${beforePath ?? ""}|${afterPath ?? ""}`),
    hashAlgorithm: "sha1",
    schemaVersion: "mvp15c.dry-run.v1",
    approvalRequired: true,
    sideEffectObserved: false,
    effectState: "known_none",
    rollbackAvailable,
    rollbackStatus: rollbackAvailable ? "available" : "not_available",
    implementationStatus: "execution_capable",
    evidenceId: `mcp-evidence:dry-run:${operation}`,
  };
}

function structuredExecutionResult(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const operation = TOOL_NAME_TO_OPERATION[toolName as keyof typeof TOOL_NAME_TO_OPERATION] ?? "create_folder";
  const beforePath = typeof args.sourceAssetPath === "string"
    ? args.sourceAssetPath
    : typeof args.assetPath === "string"
      ? args.assetPath
      : null;
  const afterCandidate = args.folderPath ?? args.targetAssetPath ?? args.assetPath;
  const afterPath = typeof afterCandidate === "string" ? afterCandidate : null;
  const isDuplicate = toolName === "ue.asset.duplicate";
  const isRenameOrMove = toolName === "ue.asset.rename" || toolName === "ue.asset.move";
  const isDelete = toolName === "ue.asset.delete";
  const wouldRead = isDuplicate && beforePath ? [beforePath] : [];
  const wouldModify = isDelete
    ? (beforePath ? [beforePath] : [])
    : isRenameOrMove
      ? (beforePath && afterPath ? [beforePath, afterPath] : [])
      : (afterPath ? [afterPath] : []);
  const rollback = args.rollback === true;
  const rollbackAvailable = !rollback && toolName !== "ue.asset.save";
  return {
    blocked: false,
    status: rollback ? "rolled_back" : "executed",
    reasonCode: "none",
    toolName,
    operation,
    phase: rollback ? "rollback" : "execute",
    changeSetId: args.changeSetId,
    runId: args.runId,
    operationId: args.operationId,
    sandboxRoot: `/Game/UAgentSandbox/${String(args.runId ?? "")}`,
    wouldChange: true,
    wouldModify,
    wouldRead,
    affectedAssets: { readOnlySources: wouldRead, sandboxTargets: wouldModify, externalTargets: [] },
    rollbackPlan: { strategy: "ledger_inverse", inverseOperation: "recorded_inverse", executionEnabled: rollbackAvailable },
    externalEvidenceQueries: [{ queryKind: "asset_registry_snapshot", readOnly: true, paths: [...wouldRead, ...wouldModify] }],
    dryRunHash: args.dryRunHash,
    hashAlgorithm: "sha1",
    schemaVersion: "mvp15c.dry-run.v1",
    approvalRequired: true,
    evidenceId: `mcp-evidence:${rollback ? "rollback" : "execute"}:${operation}`,
    sideEffectObserved: true,
    effectState: "known_effect",
    rollbackAvailable,
    rollbackStatus: rollback ? "completed" : rollbackAvailable ? "available" : "none",
    implementationStatus: "execution_capable",
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

function createMvp15ReadyTransport(
  events: string[],
  lifecycleTrace?: string[],
  nativeBoundCalls?: Record<string, unknown>[],
): McpTransportClient {
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
        const companionIdentity = createMvp15DCompanionEvidence().identity;
        return {
          jsonrpc: "2.0" as const,
          id: request.id,
          result: {
            tools: MVP15_TEST_TOOL_NAMES.map((name) => ({
              name,
              schemaVersion: UAGENT_COMPANION_CONTRACT_VERSION,
              inputSchema: MVP15_TEST_TOOL_CONTRACTS.inputSchema,
                outputSchema: {
                  dryRunSchema: MVP15_TEST_TOOL_CONTRACTS.dryRunSchema,
                  rollbackContract: MVP15_TEST_TOOL_CONTRACTS.rollbackContract,
                  affectedAssetsSchema: MVP15_TEST_TOOL_CONTRACTS.affectedAssetsSchema,
                  evidenceQuery: MVP15_TEST_TOOL_CONTRACTS.evidenceQuery,
                  "x-uagent-plugin": companionIdentity,
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
        lifecycleTrace?.push(`mcp:${args.rollback === true ? "rollback" : args.execute === true ? "execute" : "dry-run"}:${params.name ?? "unknown"}`);
        if (args.dryRun === true) {
          // Produce a contract-compliant structured dry-run result for the binding validator.
          const runId = typeof args.runId === "string" ? args.runId : "";
          const changeSetId = typeof args.changeSetId === "string" ? args.changeSetId : "";
          const operationId = typeof args.operationId === "string" ? args.operationId : "";
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
            operationId,
            beforePath,
            afterPath,
          );
          return { jsonrpc: "2.0" as const, id: request.id, result: { structuredContent: result } };
        }
        nativeBoundCalls?.push(args);
        const result = structuredExecutionResult(params.name ?? "ue.asset.create_folder", args);
        return { jsonrpc: "2.0" as const, id: request.id, result: { structuredContent: result } };
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
  return async <T = unknown>(command: string, payload?: unknown) => {
    const result = await mock(command, payload);
    if (command === "retract_mvp15_companion_approvals") {
      const status =
        result && typeof result === "object"
          ? (result as { status?: unknown }).status
          : null;
      if (status !== "retracted" && status !== "stale" && status !== "blocked") {
        return createNativeMvp15DCompanionRetraction(payload) as T;
      }
    }
    return result as T;
  };
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
      <button type="button" onClick={() => void actions?.executeMvp15AssetChangeSet()}>Direct real execute</button>
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
    const css = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../inspector/UtilityPlaceholderPanel.css",
      ),
      "utf8",
    );
    expect(css).toMatch(/\.ua-utility-placeholder__action-row\s*\{[^}]*display:\s*flex;/s);
    expect(css).toMatch(/\.ua-utility-placeholder__action-row\s*\{[^}]*flex-wrap:\s*wrap;/s);
    expect(css).toMatch(/\.ua-utility-placeholder__button\s*\{[^}]*white-space:\s*nowrap;/s);
    expect(css).toMatch(
      /\.ua-utility-placeholder__action-row \.ua-utility-placeholder__button\s*\{[^}]*overflow-wrap:\s*normal;/s,
    );
  });

  it("documents MCP endpoint connect and discovery before MVP15 asset dry-run", () => {
    const manualSmoke = readFileSync(
      resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../../../docs/mvp15-manual-smoke.md",
      ),
      "utf8",
    );
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

  it("composes real verification through read-only Content evidence bridges with fail-closed fallbacks", () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "ui-store.ts"),
      "utf8",
    );
    const start = source.indexOf("function createMvp15RealAssetMutationService(");
    const end = source.indexOf("/**\n * Build the external dry-run binder", start);
    const factorySource = source.slice(start, end);

    expect(factorySource).toContain("externalVerification: createMvp15NativeAssetVerificationAdapter");
    expect(factorySource).toContain("runtimeClient.readMvp15AssetContentEvidence");
    expect(factorySource).toContain("runtimeClient.snapshotMvp15AssetContentManifest");
    expect(factorySource).toContain("native_asset_evidence_unavailable");
    expect(factorySource).toContain("native_content_manifest_unavailable");
    expect(factorySource).not.toContain("read_asset_content_evidence");
    expect(factorySource).not.toContain("snapshot_asset_content_manifest");
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

  it("requires companion attestation before a nominally real-ready dry-run", async () => {
    const runtimeClient = createDesktopRuntimeAdapter({
      createTransport: () => createMvp15ReadyTransport([]),
    });
    await runtimeClient.connectMcp();
    await runtimeClient.discoverMcp();

    render(
      <UIProvider
        runtimeClient={runtimeClient}
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
      expect(screen.getByText(/Last issue: companion_attestation_required/)).toBeTruthy();
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
    for (const readyContractText of MVP15_READY_CONTRACT_TEXT) {
      expect(screen.queryByText(readyContractText)).toBeNull();
    }

    fireEvent.change(screen.getByLabelText("Source asset path"), { target: { value: "/Game/Characters/Hero" } });
    fireEvent.click(screen.getByRole("button", { name: "Dry-run sandbox asset mutation" }));

    await waitFor(() => {
      expect(screen.getByText(/Last issue: blocked_by_mcp_schema:missing_tool:ue\.asset\.create_folder/)).toBeTruthy();
    });
    expect(screen.queryByText(/Dry-run: dry_run_completed/)).toBeNull();
    expect(events).toEqual(["wrapper:list_toolsets"]);
    expect(events).not.toContain("wrapper:call_tool");
  });

  it("renders exact-six MCP contracts with explicit companion attestation pending", async () => {
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
        <AssetMutationPanel />
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
    const panel = screen.getByLabelText("Asset mutation panel");
    for (const readyContractText of MVP15_READY_CONTRACT_TEXT) {
      expect(screen.getByText(readyContractText)).toBeTruthy();
    }
    for (const exactFacadeTool of MVP15_TEST_TOOL_NAMES) {
      expect(panel.textContent).toContain(exactFacadeTool);
    }
    expect(events).toEqual([]);
  });

  it("surfaces a verified companion identity in the asset panel and Config settings", async () => {
    const runtimeClient = createDesktopRuntimeAdapter({
      createTransport: () => createMvp15ReadyTransport([]),
      nativeInvoke: createNativeInvokeMockAdapter(async (command) => (
        command === "attest_mvp15_companion" ? createNativeMvp15DCompanionAttestation() : null
      )),
    });
    await runtimeClient.connectMcp();
    await runtimeClient.discoverMcp();
    await runtimeClient.refreshMvp15DCompanionAttestation?.("root:trusted", "editor-session:trusted");
    render(
      <UIProvider
        runtimeClient={runtimeClient}
        initialState={{
          runtime: {
            mvp15: {
              ...createEmptyMvp15State(),
              mcpInventory: createMvp15InventoryForAssetsDom(MVP15_TEST_TOOL_NAMES),
            },
          },
        }}
      >
        <AssetMutationPanel />
        <ConfigSettings />
      </UIProvider>,
    );

    expect(screen.getByLabelText("Asset mutation panel").textContent).toContain("Live exact-six contract: ready");
    expect(screen.getByLabelText("UAgent UE Companion Plugin").textContent).toContain("Verified");
    expect(screen.getByLabelText("Asset mutation panel").textContent).not.toContain("Manifest SHA: unverified");
    expect(screen.getByLabelText("Asset mutation panel").textContent).not.toContain("Live fingerprint: unverified");
  });

  it("fails closed for null, blocked, incomplete, duplicate, unexpected, and reordered asset inventories", () => {
    const inventoryCases: Array<{
      name: string;
      inventory: Mvp15McpAssetToolInventory | null;
      expectedMissingText?: string;
    }> = [
      { name: "null inventory", inventory: null },
      {
        name: "blocked inventory",
        inventory: {
          ...createMvp15InventoryForAssetsDom(MVP15_TEST_TOOL_NAMES, "blocked_by_mcp_schema"),
          missingSchemas: [MVP15_TEST_TOOL_NAMES[0]],
        },
        expectedMissingText: `Missing MCP schema: ${MVP15_TEST_TOOL_NAMES[0]}`,
      },
      {
        name: "incomplete status-ready inventory",
        inventory: createMvp15InventoryForAssetsDom(MVP15_TEST_TOOL_NAMES.slice(0, -1)),
      },
      {
        name: "duplicate status-ready inventory",
        inventory: createMvp15InventoryForAssetsDom([...MVP15_TEST_TOOL_NAMES.slice(0, -1), MVP15_TEST_TOOL_NAMES[0]]),
      },
      {
        name: "unexpected status-ready inventory",
        inventory: createMvp15InventoryForAssetsDom([...MVP15_TEST_TOOL_NAMES.slice(0, -1), "ue.asset.unexpected"]),
      },
      {
        name: "reordered status-ready inventory",
        inventory: createMvp15InventoryForAssetsDom([...MVP15_TEST_TOOL_NAMES].reverse()),
      },
    ];

    for (const { name, inventory, expectedMissingText } of inventoryCases) {
      const { queryByText, unmount } = render(
        <UIProvider
          initialState={{
            runtime: {
              mvp15: {
                ...createEmptyMvp15State(),
                mcpInventory: inventory,
              },
            },
          }}
        >
          <AssetMutationPanel />
        </UIProvider>,
      );

      for (const readyContractText of MVP15_READY_CONTRACT_TEXT) {
        expect(queryByText(readyContractText), name).toBeNull();
      }
      if (expectedMissingText) {
        expect(queryByText(expectedMissingText), name).toBeTruthy();
      }
      unmount();
    }
  });

  it("completes the real execute verify rollback lifecycle with recorded-only replay", async () => {
    const uiNativeGuardFacts = {
      acceptedPlanBinding: "b".repeat(64),
      nativeRegistrationId: "asset-registration:ui-real",
      nativeCreatedAt: 190,
      connectionGeneration: 17,
      sessionGeneration: 29,
      nativeSourceIdentity: "1".repeat(64),
      nativeManifestIdentity: "4".repeat(64),
      nativePluginIdentity: "2".repeat(64),
      nativePackageIdentity: "5".repeat(64),
    };
    const events: string[] = [];
    const lifecycleTrace: string[] = [];
    const nativeCalls: Array<{ command: string; input: Record<string, unknown> }> = [];
    const nativeBoundCalls: Record<string, unknown>[] = [];
    let manifestReads = 0;
    let finalTarget = "";
    let runRoot = "";
    let releaseNativeRegistration!: () => void;
    const nativeIssuedToken = "d".repeat(64);
    const nativeRegistrationResponse = new Promise<void>((resolve) => {
      releaseNativeRegistration = resolve;
    });
    const nativeInvokeMock = vi.fn(async (command: string, payload?: unknown): Promise<unknown> => {
      const input = ((payload as { input?: Record<string, unknown> } | undefined)?.input ?? {});
      nativeCalls.push({ command, input });
      lifecycleTrace.push(`native:${command}`);
      if (command === "attest_mvp15_companion") {
        return createNativeMvp15DCompanionAttestation();
      }
      if (command === "retract_mvp15_companion_approvals") {
        return createNativeMvp15DCompanionRetraction(payload);
      }
      if (command === "validate_native_project_root") {
        return {
          ok: true,
          reason: "valid",
          displayRoot: "[project-root]/Mvp15",
          projectName: "Mvp15",
          engine: { label: "UE", association: null, source: "fixture" },
        };
      }
      if (command === "trust_native_project_root") {
        return { rootId: "root:trusted", displayRoot: "[project-root]/Mvp15", trustState: "trusted" };
      }
      if (command === "register_asset_mutation_approval") {
        const operations = Array.isArray(input.operations) ? input.operations as Array<Record<string, unknown>> : [];
        const save = operations.find((operation) => operation.kind === "save");
        const issuedAt = Date.now();
        finalTarget = String(save?.assetPath ?? "");
        runRoot = `/Game/UAgentSandbox/${String(input.runId ?? "")}`;
        expect(operations[0]?.assetPath).toBe(runRoot);
        await nativeRegistrationResponse;
        return {
          status: "registered",
          reason: "approval_binding_registered",
          registrationId: uiNativeGuardFacts.nativeRegistrationId,
          trustedRootId: "trusted-root:ui-real",
          operationCount: operations.length,
          approvalToken: nativeIssuedToken,
          issuedAt,
          expiresAt: issuedAt + 60_000,
        };
      }
      if (command === "cancel_asset_mutation_approval") {
        return {
          status: "cancelled",
          reason: "approval_registration_cancelled",
          registrationId: input.registrationId,
        };
      }
      if (command === "execute_asset_mutation" || command === "rollback_asset_mutation") {
        const operation = input.operation as Record<string, unknown> | undefined;
        return {
          status: "accepted_by_native_guard",
          reason: "registered_binding_matched",
          registrationId: input.registrationId,
          phase: input.phase,
          operationId: operation?.operationId,
          operationIndex: input.operationIndex,
          operationCount: input.operationCount,
          evidenceId: `native-guard:${String(input.phase)}:${String(input.operationIndex)}`,
          acceptedPlanBinding: uiNativeGuardFacts.acceptedPlanBinding,
          nativeRegistrationId: input.registrationId,
          nativePhase: input.phase,
          nativeOperationIndex: input.operationIndex,
          nativeOperationCount: input.operationCount,
          nativeCreatedAt: uiNativeGuardFacts.nativeCreatedAt,
          connectionGeneration: uiNativeGuardFacts.connectionGeneration,
          sessionGeneration: uiNativeGuardFacts.sessionGeneration,
          nativeSourceIdentity: uiNativeGuardFacts.nativeSourceIdentity,
          nativeManifestIdentity: uiNativeGuardFacts.nativeManifestIdentity,
          nativePluginIdentity: uiNativeGuardFacts.nativePluginIdentity,
          nativePackageIdentity: uiNativeGuardFacts.nativePackageIdentity,
        };
      }
      if (command === "record_asset_mutation_outcome") {
        return {
          status: "recorded",
          reason: "operation_outcome_recorded",
          registrationId: input.registrationId,
          phase: input.phase,
          operationId: input.operationId,
          rollbackAvailable: input.phase === "execute",
          terminal: false,
        };
      }
      if (command === "read_asset_content_evidence") {
        const assetPath = String(input.assetPath ?? "");
        const present = assetPath === "/Game/Test01" || assetPath === finalTarget;
        return {
          status: "observed",
          reason: present ? "asset_present" : "asset_absent",
          assetPath,
          exists: present,
          size: present ? 12 : null,
          sha256: present ? (assetPath === "/Game/Test01" ? "a" : "c").repeat(64) : null,
          evidenceId: `asset-content:${present ? "present" : "absent"}:${fakeSha1Hex(assetPath).slice(0, 8)}`,
        };
      }
      if (command === "snapshot_asset_content_manifest") {
        manifestReads += 1;
        const baselineEntries = [
          { assetPath: "/Game/Outside/Stable", size: 8, sha256: "b".repeat(64) },
          { assetPath: "/Game/Test01", size: 12, sha256: "a".repeat(64) },
        ];
        const entries = manifestReads === 2
          ? [...baselineEntries, { assetPath: finalTarget, size: 12, sha256: "c".repeat(64) }]
          : baselineEntries;
        return {
          status: "observed",
          reason: "content_manifest_captured",
          entries,
          aggregateSha256: String(manifestReads).repeat(64),
          evidenceId: `asset-content-manifest:${manifestReads}`,
        };
      }
      return null;
    });
    const projectAdapter = createNativeProjectAdapter({ invoke: createNativeInvokeMockAdapter(nativeInvokeMock), now: () => 1 });
    const project = await projectAdapter.addProject("G:/Projects/Mvp15");
    await projectAdapter.confirmTrust(project.id);
    const runtimeClient = createDesktopRuntimeAdapter({
      createTransport: () => createMvp15ReadyTransport(events, lifecycleTrace, nativeBoundCalls),
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
        <ChangesPanel />
        <Mvp15DirectActionProbe />
        <Mvp15StateProbe />
      </UIProvider>,
    );

    fireEvent.change(screen.getByLabelText("Source asset path"), { target: { value: "/Game/Test01" } });
    fireEvent.click(screen.getByRole("button", { name: "Dry-run sandbox asset mutation" }));
    await waitFor(() => {
      expect(screen.getByText(/Execution mode: real/)).toBeTruthy();
      expect(screen.getByText(/Binding: external_bound/)).toBeTruthy();
      expect(screen.getByText(/Dry-run: dry_run_completed/)).toBeTruthy();
      expect(screen.getByText(/Native registration: required/)).toBeTruthy();
    });
    const dryRunState = JSON.parse(screen.getByTestId("mvp15-state-probe").textContent ?? "null") as {
      activeChangeSet?: { runId?: string; operations?: Array<{ kind?: string; assetPathAfter?: string }> };
    };
    expect(dryRunState.activeChangeSet?.operations?.[0]).toMatchObject({
      kind: "create_folder",
      assetPathAfter: `/Game/UAgentSandbox/${dryRunState.activeChangeSet?.runId}`,
    });

    fireEvent.click(screen.getByRole("button", { name: "Approve sandbox asset mutation" }));
    await waitFor(() => {
      expect(screen.getByText(/Approval: issued/)).toBeTruthy();
      expect(screen.getByText(/Native registration: required/)).toBeTruthy();
    });
    expect((screen.getByRole("button", { name: "Execute sandbox asset mutation" }) as HTMLButtonElement).disabled).toBe(true);
    releaseNativeRegistration();
    await waitFor(() => {
      expect(screen.getByText(/Native registration: registered/)).toBeTruthy();
    });
    const registrationCall = nativeCalls.find(({ command }) => command === "register_asset_mutation_approval");
    expect(registrationCall?.input).not.toHaveProperty("approvalToken");
    expect(screen.getByTestId("mvp15-state-probe").textContent).not.toContain(nativeIssuedToken);
    expect(document.body.textContent).not.toContain(nativeIssuedToken);
    expect(nativeCalls.filter(({ command }) => command === "register_asset_mutation_approval")).toHaveLength(1);
    expect((screen.getByRole("button", { name: "Execute sandbox asset mutation" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Execute sandbox asset mutation" }));
    await waitFor(() => {
      const executionState = JSON.parse(
        screen.getByTestId("mvp15-state-probe").textContent ?? "null",
      ) as { activeChangeSet?: { state?: string }; lastError?: string | null };
      expect(executionState).toMatchObject({
        activeChangeSet: { state: "executed" },
        lastError: null,
      });
      expect(screen.getByText(/Execution: executed/)).toBeTruthy();
      expect(screen.getByText(/Asset ChangeSet: executed/)).toBeTruthy();
      expect(screen.getAllByText(/Asset operation audit: phase execute \/ tool ue\.asset\.create_folder \/ virtual path .* \/ result executed \/ evidence mcp-evidence:execute:create_folder/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/Asset operation audit: phase execute \/ tool ue\.asset\.save \/ virtual path .*\/Work\/Sub\/Test01Renamed \/ result executed \/ evidence mcp-evidence:execute:save/).length).toBeGreaterThanOrEqual(1);
    });
    expect(lifecycleTrace.indexOf("native:register_asset_mutation_approval")).toBeGreaterThan(-1);
    expect(lifecycleTrace.indexOf("native:register_asset_mutation_approval")).toBeLessThan(
      lifecycleTrace.findIndex((event) => event.startsWith("mcp:execute:")),
    );
    expect((screen.getByRole("button", { name: "Verify sandbox asset mutation" }) as HTMLButtonElement).disabled).toBe(false);

    const nativeCallsAfterFirstExecuteAttempt = nativeInvokeMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Direct real execute" }));
    await waitFor(() => expect(screen.getByText(/Last issue: asset_approval_required/)).toBeTruthy());
    // The attestation remains bound to this unchanged root/session/discovery generation.
    // Re-attesting here would revoke the just-registered native approval instead of merely
    // checking the one-shot renderer token path.
    expect(nativeInvokeMock.mock.calls.slice(nativeCallsAfterFirstExecuteAttempt).map(([command]) => command)).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Verify sandbox asset mutation" }));
    await waitFor(() => {
      const verifyState = JSON.parse(screen.getByTestId("mvp15-state-probe").textContent ?? "null") as { lastError?: string | null };
      expect(verifyState.lastError).toBeNull();
      expect(screen.getByText(/Verification: passed/)).toBeTruthy();
      expect(screen.getByText(/Asset ChangeSet: verified/)).toBeTruthy();
      expect(screen.getAllByText(/Replay: recorded summaries only/).length).toBeGreaterThanOrEqual(1);
    });
    expect((screen.getByRole("button", { name: "Rollback sandbox asset mutation" }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Rollback sandbox asset mutation" }));
    await waitFor(() => {
      expect(screen.getByText(/Rollback: rolled_back/)).toBeTruthy();
      expect(screen.getByText(/Asset ChangeSet: rolled_back/)).toBeTruthy();
      expect(screen.getAllByText(/Asset operation audit: phase rollback \/ tool ue\.asset\.move .* result completed \/ evidence mcp-evidence:rollback:move/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Asset replay audit: recorded-only .* 0 runtime side effects/)).toBeTruthy();
    });

    expect(runRoot).toMatch(/^\/Game\/UAgentSandbox\/ui-/);
    expect(finalTarget).toBe(`${runRoot}/Work/Sub/Test01Renamed`);
    expect(nativeCalls.filter(({ command }) => command === "register_asset_mutation_approval")).toHaveLength(1);
    expect(nativeCalls.filter(({ command }) => command === "execute_asset_mutation")).toHaveLength(5);
    expect(nativeCalls.filter(({ command }) => command === "rollback_asset_mutation")).toHaveLength(4);
    expect(nativeBoundCalls).toHaveLength(9);
    expect(nativeBoundCalls[0]).toMatchObject({
      ...uiNativeGuardFacts,
      nativePhase: "execute",
      nativeOperationIndex: 0,
      nativeOperationCount: 5,
    });
    expect(nativeBoundCalls.every(
      (args) =>
        args.acceptedPlanBinding
          === uiNativeGuardFacts.acceptedPlanBinding
        && args.nativeRegistrationId
          === uiNativeGuardFacts.nativeRegistrationId
        && args.connectionGeneration
          === uiNativeGuardFacts.connectionGeneration
        && args.sessionGeneration
          === uiNativeGuardFacts.sessionGeneration
        && args.nativeSourceIdentity
          === uiNativeGuardFacts.nativeSourceIdentity
        && args.nativeManifestIdentity
          === uiNativeGuardFacts.nativeManifestIdentity
        && args.nativePluginIdentity
          === uiNativeGuardFacts.nativePluginIdentity
        && args.nativePackageIdentity
          === uiNativeGuardFacts.nativePackageIdentity,
    )).toBe(true);
    expect(nativeBoundCalls.map(({ nativePhase }) => nativePhase)).toEqual([
      "execute",
      "execute",
      "execute",
      "execute",
      "execute",
      "rollback",
      "rollback",
      "rollback",
      "rollback",
    ]);
    expect(nativeCalls.filter(({ command }) => command === "read_asset_content_evidence")).toHaveLength(6);
    expect(nativeCalls.filter(({ command }) => command === "snapshot_asset_content_manifest")).toHaveLength(3);
    expect(events).toEqual([
      "mcp:ue.asset.create_folder",
      "mcp:ue.asset.duplicate",
      "mcp:ue.asset.rename",
      "mcp:ue.asset.move",
      "mcp:ue.asset.save",
      "mcp:ue.asset.create_folder",
      "mcp:ue.asset.duplicate",
      "mcp:ue.asset.rename",
      "mcp:ue.asset.move",
      "mcp:ue.asset.save",
      "mcp:ue.asset.move",
      "mcp:ue.asset.rename",
      "mcp:ue.asset.delete",
      "mcp:ue.asset.delete",
    ]);
    const callCountsBeforeReplayInspection = { mcp: events.length, native: nativeInvokeMock.mock.calls.length };
    const serializedState = screen.getByTestId("mvp15-state-probe").textContent ?? "";
    expect(serializedState).toContain('"state":"rolled_back"');
    expect(serializedState).toContain('"replayOnly":true');
    expect(serializedState).toContain('"recordedOnlyActions"');
    expect(serializedState).not.toContain("asset-approval-token:");
    expect(serializedState).not.toContain("G:/Projects/Mvp15");
    const userVisibleAudit = [
      screen.getByLabelText("Asset mutation panel").textContent,
      screen.getByLabelText("Changes panel").textContent,
    ].join("\n");
    expect(userVisibleAudit).not.toContain("editor-session:real");
    expect(userVisibleAudit).not.toContain("pid:real-attached");
    expect(userVisibleAudit).not.toContain("G:/Projects/Mvp15");
    expect({ mcp: events.length, native: nativeInvokeMock.mock.calls.length }).toEqual(callCountsBeforeReplayInspection);
  });

  it("keeps raw path and session-like exception text out of desktop state", async () => {
    const runtimeClient = createDesktopRuntimeAdapter({
      createTransport: () => createMvp15ReadyTransport([]),
      nativeInvoke: createNativeInvokeMockAdapter(async (command) => {
        if (command === "attest_mvp15_companion") {
          return createNativeMvp15DCompanionAttestation();
        }
        return null;
      }),
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

  it("keeps premature real verify and rollback disabled with stable state reasons", async () => {
    const events: string[] = [];
    const nativeInvokeMock = vi.fn(async (command: string, payload?: unknown): Promise<unknown> => {
      const input = (payload as { input?: { toolName?: string } } | undefined)?.input;
      events.push(`native:${command}:${input?.toolName ?? "unknown"}`);
      if (command === "attest_mvp15_companion") {
        return createNativeMvp15DCompanionAttestation();
      }
      if (command === "retract_mvp15_companion_approvals") {
        return createNativeMvp15DCompanionRetraction(payload);
      }
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
        <ChangesPanel />
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

    fireEvent.click(screen.getByRole("button", { name: "Direct real verify" }));
    await waitFor(() => expect(screen.getByText(/Last issue: external_verification_state_invalid/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Direct real rollback" }));
    await waitFor(() => {
      expect(screen.getByText(/Last issue: rollback_state_invalid/)).toBeTruthy();
      expect(screen.getByText(/Asset blocked reason: rollback_state_invalid/)).toBeTruthy();
    });

    expect(events.filter((event) => event.startsWith("mcp:"))).toEqual(bindingEvents.filter((event) => event.startsWith("mcp:")));
    expect(events.some((event) => event.startsWith("native:register_asset_mutation_approval:"))).toBe(false);
    expect(events.some((event) => event.startsWith("native:execute_asset_mutation:"))).toBe(false);
    expect(events.some((event) => event.startsWith("native:rollback_asset_mutation:"))).toBe(false);
    const serializedState = screen.getByTestId("mvp15-state-probe").textContent ?? "";
    expect(serializedState).toContain("rollback_state_invalid");
    expect(serializedState).not.toContain("real_verification_required");
  });

  it("blocks ready real inventory when the attached observation session has no pid hash", async () => {
    const events: string[] = [];
    const nativeInvokeMock = vi.fn(async (command: string, payload?: unknown): Promise<unknown> => {
      const input = (payload as { input?: { toolName?: string } } | undefined)?.input;
      events.push(`native:${command}:${input?.toolName ?? "unknown"}`);
      if (command === "attest_mvp15_companion") {
        return createNativeMvp15DCompanionAttestation();
      }
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
