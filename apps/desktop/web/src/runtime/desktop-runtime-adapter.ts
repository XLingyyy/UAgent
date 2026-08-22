import {
  createAgentLoopRuntime,
  createMvp15ExactToolFacade,
  createMvp15FacadeWrapperCall,
  attestMvp15DCompanion,
  createMvp15DCompanionLiveFingerprint,
  createMvp15DCompanionStatus,
  createMvp15LiveAssetToolsetFingerprint,
  createMvp15McpAssetToolInventory,
  createMvp9RuntimeService,
  buildExactDryRunPayload,
  computeAggregateBindingHash,
  computeArgsHash,
  MVP15_ASSET_TOOL_ALLOWLIST,
  normalizeMvp15McpAssetToolDescriptor,
  unwrapPluginDryRunResult,
  validatePluginDryRunResult,
  type AgentLoopRuntimeClient,
  type DryRunBindingContext,
  type DryRunBindingInput,
  type ExternalBindingOperation,
  type Mvp15ExactToolFacadeToolset,
  type Mvp15McpAssetToolCallResult,
  type Mvp15McpAssetToolDescriptor,
  type Mvp15McpAssetToolName,
  type Mvp15LiveAssetToolsetFingerprintResult,
  type Mvp15DCompanionFingerprint,
  type Mvp15NativeAssetGuardInput,
  type Mvp15NativeAssetGuardResult,
  type Mvp9RuntimeService,
  type Mvp9RuntimeState,
} from "@uagent/runtime";
import {
  LegacySseTransport,
  McpSession,
  McpTransportError,
  StreamableHttpTransport,
} from "@uagent/mcp-client";
import type {
  ApprovalDecisionValue,
  AssetContentEvidenceObservation,
  AssetContentEvidenceRequest,
  AssetContentManifestObservation,
  AssetMutationOperationKind,
  AssetMutationExternalRegistrationBinding,
  UAgentCompanionStatus,
  McpConnectionState,
  McpDiscoverySnapshot,
  RuntimeSnapshot,
  TaskDraft,
  TaskRecord,
} from "@uagent/shared";
import type { McpInitializeResult, McpTransportClient } from "@uagent/mcp-client";
import { resolveTrustedNativeRootRef, type NativeInvoke } from "./project-native-adapter";
import { createDesktopTerminalAdapterFromEnvironment } from "./terminal-native-adapter";
import { createDesktopWatcherAdapterFromEnvironment } from "./watcher-native-adapter";
import { createDesktopBrowserAdapterFromEnvironment } from "./browser-native-adapter";
import {
  createDesktopTextMutationAdapterFromEnvironment,
  type NativeTextMutationAdapter,
} from "./text-mutation-native-adapter";
import {
  createEditorObservationNativeAdapterFromEnvironment,
  type NativeEditorAttachInput,
  type NativeEditorObservationAdapter,
  type NativeEditorProcessConfigInput,
} from "./editor-observation-native-adapter";
import { createNativeMcpHttpPoster } from "./mcp-native-transport";
export type Mvp15dToolSearchMode = "on" | "off";

export interface Mvp15dRawObservedCall {
  receiptId: string;
  request: Record<string, unknown>;
}

export interface Mvp15dCanonicalToolDescriptor {
  affectedAssetsSchema: Record<string, unknown>;
  dryRunSchema: Record<string, unknown>;
  evidenceQuery: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  methodId: string | null;
  name: string;
  rollbackContract: Record<string, unknown>;
  schemaVersion: string;
  source: "direct" | "facade";
  toolsetId: string | null;
}

export interface Mvp15dProductDiscoveryRaw {
  mode: Mvp15dToolSearchMode;
  configCall: Mvp15dRawObservedCall;
  rendererInstanceCall: Mvp15dRawObservedCall;
  connectCall: Mvp15dRawObservedCall;
  initializeCall: Mvp15dRawObservedCall;
  discoverCall: Mvp15dRawObservedCall;
  normalizeCall: Mvp15dRawObservedCall;
  fingerprintCall: Mvp15dRawObservedCall;
  nativeAttestation: Mvp15dRawObservedCall;
  mutationCounterCall: Mvp15dRawObservedCall;
  toolSearchCalls: Mvp15dRawObservedCall[];
}

export interface Mvp15dProductRetractionRaw {
  reason:
    | "refresh_tools"
    | "reconnect"
    | "endpoint_change"
    | "renderer_restart"
    | "ue_restart"
    | "stale_completion";
  rendererInstanceCall: Mvp15dRawObservedCall;
  transitionCall: Mvp15dRawObservedCall;
  nativeRetraction: Mvp15dRawObservedCall;
  readyDiscovery: Mvp15dProductDiscoveryRaw;
  rendererHandoff?: {
    requestCall: Mvp15dRawObservedCall;
    parentAcknowledgementCall: Mvp15dRawObservedCall;
    claimCall: Mvp15dRawObservedCall;
  };
}

interface Mvp15dManagedEditorOwnerBinding {
  taskId: string;
  phase: "product-capture" | "ui-lifecycle";
  projectId: string;
  rootRef: string;
  uprojectRelativePath: string;
  processId: string;
  pidHash: string;
  pid: number;
  processCreationFiletime: string;
  listenerInstanceSha256: string;
  ownerBindingSha256: string;
  createCall: Mvp15dRawObservedCall | null;
}

export interface Mvp15dMutationCounters {
  dryRun: number;
  execute: number;
  rollback: number;
}

export interface Mvp15dProductObservationPort {
  readMutationCounters(): Promise<Mvp15dMutationCounters>;
  discover(input: { toolSearchEnabled: boolean }): Promise<Mvp15dProductDiscoveryRaw>;
  retract(reason: Mvp15dProductRetractionRaw["reason"]): Promise<Mvp15dProductRetractionRaw>;
  requestRendererRestart?(segment: Omit<Mvp15dProductAuthorityInput, "mutationAfter">): Promise<never>;
}

export interface Mvp15dProductAuthorityInput {
  discoveries: Mvp15dProductDiscoveryRaw[];
  retractions: Mvp15dProductRetractionRaw[];
  mutationBefore: Mvp15dMutationCounters;
  mutationAfter: Mvp15dMutationCounters;
}

export type Mvp15dProductAuthorityResume = Omit<Mvp15dProductAuthorityInput, "mutationAfter">;

const PRODUCT_RETRACTIONS: Mvp15dProductRetractionRaw["reason"][] = [
  "refresh_tools",
  "reconnect",
  "endpoint_change",
  "renderer_restart",
  "ue_restart",
  "stale_completion",
];

export async function collectMvp15dProductAuthority(
  port: Mvp15dProductObservationPort,
): Promise<Mvp15dProductAuthorityInput> {
  const mutationBefore = { ...(await port.readMutationCounters()) };
  const discoveries: Mvp15dProductDiscoveryRaw[] = [];
  for (const mode of ["on", "off"] as const) {
    const observation = await port.discover({ toolSearchEnabled: mode === "on" });
    const intent = observation.configCall.request.intent as Record<string, unknown> | undefined;
    if (
      observation.mode !== mode ||
      intent?.toolSearchMode !== mode
    ) {
      throw new Error("mvp15d_product_discovery_observation_invalid");
    }
    discoveries.push(observation);
  }
  const retractions: Mvp15dProductRetractionRaw[] = [];
  for (const reason of PRODUCT_RETRACTIONS) {
    if (reason === "renderer_restart" && port.requestRendererRestart) {
      await port.requestRendererRestart({ discoveries, retractions, mutationBefore });
    }
    const observation = await port.retract(reason);
    if (observation.reason !== reason) {
      throw new Error("mvp15d_product_retraction_observation_invalid");
    }
    retractions.push(observation);
  }
  return {
    discoveries,
    retractions,
    mutationBefore,
    mutationAfter: { ...(await port.readMutationCounters()) },
  };
}

export interface Mvp15dContentManifestRaw {
  stage: "before" | "after";
  registrationId: string;
  runId: string;
  receiptId: string;
  request: Record<string, unknown>;
}

export type Mvp15dCounterVector = [number, number, number, number, number];

export interface Mvp15dUiSessionBinding {
  sessionId: string;
  nativeSessionId: string;
  runId: string;
  registrationId: string;
  sessionBegin: Mvp15dRawObservedCall;
  registrationCall: Mvp15dRawObservedCall;
  sessionSetupCalls?: Mvp15dRawObservedCall[];
  renderedControlCall?: Mvp15dRawObservedCall;
}

export interface Mvp15dNegativeCaseRaw extends Mvp15dUiSessionBinding {
  caseId: string;
  evidenceSource: "rendered_product_control";
  renderedControlCall: Mvp15dRawObservedCall;
  guardApi: string;
  guardCall: Mvp15dRawObservedCall;
  contentBefore: Mvp15dContentManifestRaw;
  contentAfter: Mvp15dContentManifestRaw;
  countersBefore: Mvp15dCounterVector;
  countersAfter: Mvp15dCounterVector;
  counterReadBefore: Mvp15dRawObservedCall;
  counterReadAfter: Mvp15dRawObservedCall;
  observationStop: Mvp15dRawObservedCall;
  mcpDisconnect: Mvp15dRawObservedCall;
  setupCalls: Mvp15dRawObservedCall[];
  cleanupCalls: Mvp15dRawObservedCall[];
  registrationCount: number;
  tokenCount: number;
  mcpMutationCount: number;
  manifestOwnershipCount: number;
}

export interface Mvp15dPartialOperationRaw {
  direction: "forward" | "inverse" | "control";
  action: string;
  api: string;
  receiptId: string;
  request: Record<string, unknown>;
  setupCalls: Mvp15dRawObservedCall[];
}

export interface Mvp15dPartialUnknownRaw extends Mvp15dUiSessionBinding {
  operationResults: Mvp15dPartialOperationRaw[];
  contentBefore: Mvp15dContentManifestRaw;
  contentAfter: Mvp15dContentManifestRaw;
  countersBefore: Mvp15dCounterVector;
  countersAfter: Mvp15dCounterVector;
  counterReadBefore: Mvp15dRawObservedCall;
  counterReadAfter: Mvp15dRawObservedCall;
  observationStop: Mvp15dRawObservedCall;
  mcpDisconnect: Mvp15dRawObservedCall;
}

export interface Mvp15dUiObservationPort {
  beginSession(input: {
    caseId?: string;
    renderedNegative?: boolean;
    attachInput: Record<string, unknown>;
    registrationInput: Record<string, unknown>;
    guardRequests: {
      execute: Record<string, unknown>;
      rollback: Record<string, unknown>;
      invalidPath: Record<string, unknown>;
      mcpExecute?: Record<string, unknown>;
      mcpRollback?: Record<string, unknown>;
    };
  }): Promise<Mvp15dUiSessionBinding>;
  beginRenderedNegativeCase?(
    caseId: string,
    context: {
      attachInput: Record<string, unknown>;
      registrationInput: Record<string, unknown>;
      guardRequests: {
        execute: Record<string, unknown>;
        rollback: Record<string, unknown>;
        invalidPath: Record<string, unknown>;
        mcpExecute?: Record<string, unknown>;
        mcpRollback?: Record<string, unknown>;
      };
    },
  ): Promise<Mvp15dUiSessionBinding>;
  snapshotContent(
    binding: Mvp15dUiSessionBinding,
    stage: "before" | "after",
  ): Promise<Mvp15dContentManifestRaw>;
  readCounters(
    binding: Mvp15dUiSessionBinding,
    stage: "before" | "after",
  ): Promise<{ values: Mvp15dCounterVector; receipt: Mvp15dRawObservedCall }>;
  guard(
    input: Mvp15dUiSessionBinding & { caseId: string; api: string },
  ): Promise<{
    guardCall: Mvp15dRawObservedCall;
    setupCalls: Mvp15dRawObservedCall[];
    cleanupCalls?: Mvp15dRawObservedCall[];
    registrationCount?: number;
    tokenCount?: number;
    mcpMutationCount?: number;
    manifestOwnershipCount?: number;
  }>;
  runPartialOperation(
    binding: Mvp15dUiSessionBinding,
    operation: Pick<Mvp15dPartialOperationRaw, "direction" | "action" | "api" | "request">,
  ): Promise<Mvp15dPartialOperationRaw>;
  stopObservation(binding: Mvp15dUiSessionBinding): Promise<Mvp15dRawObservedCall>;
  disconnectMcp(binding: Mvp15dUiSessionBinding): Promise<Mvp15dRawObservedCall>;
}

export interface Mvp15dUiAuthorityInput {
  negativeCases: Mvp15dNegativeCaseRaw[];
  partialUnknown: Mvp15dPartialUnknownRaw;
}

const NEGATIVE_CASES = [
  ["N1", "register_asset_mutation_approval"],
  ["N2", "register_asset_mutation_approval"],
  ["N3", "execute_asset_mutation"],
  ["N4", "execute_asset_mutation"],
  ["N5", "execute_asset_mutation"],
  ["N6", "dry_run_asset_mutation"],
  ["N7", "execute_asset_mutation"],
  ["N8", "rollback_asset_mutation"],
] as const;

export type Mvp15dNegativeCaseId = (typeof NEGATIVE_CASES)[number][0];

export async function collectMvp15dRenderedNegativeCase(
  port: Mvp15dUiObservationPort,
  caseId: Mvp15dNegativeCaseId,
  context: {
    attachInput: Record<string, unknown>;
    registrationInput: Record<string, unknown>;
    guardRequests: {
      execute: Record<string, unknown>;
      rollback: Record<string, unknown>;
      invalidPath: Record<string, unknown>;
      mcpExecute?: Record<string, unknown>;
      mcpRollback?: Record<string, unknown>;
    };
  },
): Promise<Mvp15dNegativeCaseRaw> {
  const definition = NEGATIVE_CASES.find(([candidate]) => candidate === caseId);
  if (!definition) throw new Error("mvp15d_negative_case_invalid");
  const [, guardApi] = definition;
  const binding = port.beginRenderedNegativeCase
    ? await port.beginRenderedNegativeCase(caseId, context)
    : await port.beginSession({ ...context, caseId });
  const contentBefore = await port.snapshotContent(binding, "before");
  const counterBefore = await port.readCounters(binding, "before");
  const countersBefore = [...counterBefore.values] as Mvp15dCounterVector;
  const guard = await port.guard(Object.assign(binding, { caseId, api: guardApi }));
  if (caseId === "N1" || caseId === "N2") binding.registrationCall = guard.guardCall;
  const counterAfter = await port.readCounters(binding, "after");
  const countersAfter = [...counterAfter.values] as Mvp15dCounterVector;
  const contentAfter = await port.snapshotContent(binding, "after");
  const observationStop = await port.stopObservation(binding);
  const mcpDisconnect = await port.disconnectMcp(binding);
  return {
    ...binding,
    caseId,
    evidenceSource: "rendered_product_control",
    renderedControlCall: binding.renderedControlCall ?? binding.sessionBegin,
    guardApi,
    guardCall: guard.guardCall,
    setupCalls: [...(binding.sessionSetupCalls ?? []), ...guard.setupCalls],
    cleanupCalls: guard.cleanupCalls ?? [],
    contentBefore,
    contentAfter,
    countersBefore,
    countersAfter,
    counterReadBefore: counterBefore.receipt,
    counterReadAfter: counterAfter.receipt,
    observationStop,
    mcpDisconnect,
    registrationCount: guard.registrationCount ?? 1,
    tokenCount: guard.tokenCount ?? 1,
    mcpMutationCount: guard.mcpMutationCount ?? 0,
    manifestOwnershipCount: guard.manifestOwnershipCount ?? 1,
  };
}

export async function collectMvp15dUiAuthority(
  port: Mvp15dUiObservationPort,
  partialOperations: ReadonlyArray<
    Pick<Mvp15dPartialOperationRaw, "direction" | "action" | "api" | "request">
  >,
  context: {
    attachInput: Record<string, unknown>;
    registrationInput: Record<string, unknown>;
    guardRequests: {
      execute: Record<string, unknown>;
      rollback: Record<string, unknown>;
      invalidPath: Record<string, unknown>;
      mcpExecute?: Record<string, unknown>;
      mcpRollback?: Record<string, unknown>;
    };
  },
  includeNegativeCases = true,
): Promise<Mvp15dUiAuthorityInput> {
  const negativeCases: Mvp15dNegativeCaseRaw[] = [];
  if (includeNegativeCases) {
    for (const [caseId] of NEGATIVE_CASES) {
      negativeCases.push(await collectMvp15dRenderedNegativeCase(port, caseId, context));
    }
  }

  const partialBinding = await port.beginSession(context);
  const partialBefore = await port.snapshotContent(partialBinding, "before");
  const partialCounterBefore = await port.readCounters(partialBinding, "before");
  const partialCountersBefore = [...partialCounterBefore.values] as Mvp15dCounterVector;
  const operationResults: Mvp15dPartialOperationRaw[] = [];
  for (const operation of partialOperations) {
    operationResults.push(await port.runPartialOperation(partialBinding, operation));
  }
  const partialCounterAfter = await port.readCounters(partialBinding, "after");
  const partialCountersAfter = [...partialCounterAfter.values] as Mvp15dCounterVector;
  const partialAfter = await port.snapshotContent(partialBinding, "after");
  const observationStop = await port.stopObservation(partialBinding);
  const mcpDisconnect = await port.disconnectMcp(partialBinding);
  return {
    negativeCases,
    partialUnknown: {
      ...partialBinding,
      operationResults,
      contentBefore: partialBefore,
      contentAfter: partialAfter,
      countersBefore: partialCountersBefore,
      countersAfter: partialCountersAfter,
      counterReadBefore: partialCounterBefore.receipt,
      counterReadAfter: partialCounterAfter.receipt,
      observationStop,
      mcpDisconnect,
    },
  };
}


export interface DesktopRuntimeAdapter {
  getSnapshot(): RuntimeSnapshot;
  getMcpState(): McpConnectionState;
  getMcpDiscovery(): McpDiscoverySnapshot | null;
  getMvp15AssetTools(): Mvp15McpAssetToolDescriptor[];
  getMvp15LiveAssetToolsetFingerprint?(): Mvp15LiveAssetToolsetFingerprintPublication;
  getMvp15DCompanionStatus?(): UAgentCompanionStatus;
  getMvp15DLiveCompanionFingerprint?(): Mvp15DCompanionFingerprint;
  getMvp15DProductRetractionEvidence?(): readonly Mvp15DProductRetractionEvidence[];
  getMvp15dProductObservationPort?(): Mvp15dProductObservationPort | null;
  getMvp15dUiObservationPort?(): Mvp15dUiObservationPort | null;
  activateMvp15dFixedObservationAuthority?(input: {
    taskId: string;
    phase: "product-capture" | "ui-lifecycle";
    session: string;
    generation: number;
    receiptLedgerEnabled: boolean;
    minimumMcpGeneration?: number;
    predecessorWindowIdentitySha256?: string;
  }): Promise<void>;
  resumeMvp15dProductAuthority?(
    handoffId: string,
    endpoint: string,
  ): Promise<Mvp15dProductAuthorityResume>;
  observeMvp15dNativeState?(
    kind:
      | "mutation_counters"
      | "recorded_replay"
      | "mcp_disconnect"
      | "renderer_process"
      | "managed_listener_alive_through_use",
    request: Record<string, unknown>,
  ): Promise<Mvp15dRawObservedCall>;
  observeMvp15dManagedListenerAliveThroughUse?(): Promise<Mvp15dRawObservedCall>;
  takeMvp15dMcpObservationReceipt?(api: "mcp_asset_tool_call"): Mvp15dRawObservedCall | null;
  runMvp15DProductRetractionOrchestration?(
    trustedRootId: string,
    editorSessionId: string,
    endpoint: string,
  ): Promise<void>;
  /** Refreshes native, trusted-root-bound package/loaded-module evidence. */
  refreshMvp15DCompanionAttestation?(
    trustedRootId: string,
    editorSessionId?: string,
  ): Promise<UAgentCompanionStatus>;
  captureMvp15McpBinding?(): string | null;
  isMvp15McpBindingCurrent?(binding: string): boolean;
  subscribe(listener: (snapshot: RuntimeSnapshot) => void): () => void;
  subscribeMcp(listener: (state: McpConnectionState) => void): () => void;
  submitTask(draft: TaskDraft): Promise<TaskRecord>;
  cancelTask(taskId: string): Promise<void>;
  submitApprovalDecision(
    taskId: string,
    stepId: string | null,
    decision: ApprovalDecisionValue,
    actor: string,
    reason: string,
  ): Promise<void>;
  setMcpEndpoint(endpoint: string): void;
  connectMcp(): Promise<void>;
  discoverMcp(): Promise<void>;
  disconnectMcp(): void;
  getMvp9(): Mvp9RuntimeService;
  subscribeMvp9(listener: (state: Mvp9RuntimeState) => void): () => void;
  getTextMutationAdapter(): NativeTextMutationAdapter | null;
  getEditorObservationAdapter(): NativeEditorObservationAdapter | null;
  guardMvp15AssetMutation?: (
    input: Mvp15NativeAssetGuardInput,
  ) => Promise<Mvp15NativeAssetGuardResult>;
  dryRunMvp15AssetMutation?: (
    input: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  callMvp15AssetTool?: (
    toolName: Mvp15McpAssetToolName,
    args: Record<string, unknown>,
  ) => Promise<Mvp15McpAssetToolCallResult | unknown>;
  runMvp15DProductNoOpProbe?(
    route: "direct" | "toolset_registry",
    toolSearch: boolean,
  ): Promise<unknown>;
  readMvp15AssetContentEvidence?: (
    input: AssetContentEvidenceRequest,
  ) => Promise<AssetContentEvidenceObservation>;
  snapshotMvp15AssetContentManifest?: (
    input: AssetMutationExternalRegistrationBinding,
  ) => Promise<AssetContentManifestObservation>;
}

export interface Mvp15DProductRetractionEvidence {
  reason: "disconnect" | "endpoint_change" | "failure" | "reconnect" | "renderer_restart" | "newer_generation";
  count: number;
  sessionId: string;
  generationBefore: number;
  generationAfter: number;
  statusBefore: "ready";
  statusAfter: "blocked";
}

export interface Mvp15LiveAssetToolsetFingerprintPublication extends Mvp15LiveAssetToolsetFingerprintResult {
  discoveryGeneration: number;
  binding: {
    session: "current";
    endpoint: "redacted";
    generation: number;
  } | null;
}

export interface DesktopRuntimeAdapterOptions {
  createTransport?: (endpoint: string, transportKind: string) => McpTransportClient;
  nativeInvoke?: NativeInvoke | null;
  /** Explicit source-only fixtures. These are never promoted to fixed live authority. */
  mvp15dFixtureProductObservationPort?: Mvp15dProductObservationPort;
  mvp15dFixtureUiObservationPort?: Mvp15dUiObservationPort;
  /**
   * Narrow task-owned observer for D0 source evidence. It wraps the real
   * transport used by this adapter before McpSession parses initialize or
   * discovery responses, and emits bounded native attestation/retraction
   * lifecycle facts. The observer receives a path/token-redacted copy and is
   * never enabled by production defaults.
   */
  onMvp15DProductAdapterExchange?: (exchange: Mvp15DProductAdapterExchange) => void;
  /** Source-test clock seam. Production waits on the bridge-provided TTL. */
  mvp15dAdvanceClock?: (milliseconds: number) => Promise<void>;
}

export interface Mvp15DProductAdapterExchange {
  generation: number;
  direction: "request" | "response" | "error";
  method: string;
  payload: unknown;
}

let latestMcpDiscoveryGeneration = 0;
let latestMvp15McpBindingGeneration = 0;

// Instance-local counters can reuse stale DTO values after adapter reconstruction.
function nextMcpDiscoveryGeneration(current: number): number {
  latestMcpDiscoveryGeneration = Math.max(
    latestMcpDiscoveryGeneration + 1,
    current + 1,
    Date.now(),
  );
  return latestMcpDiscoveryGeneration;
}

function nextMvp15McpBindingGeneration(current: number): number {
  latestMvp15McpBindingGeneration = Math.max(
    latestMvp15McpBindingGeneration + 1,
    current + 1,
    Date.now(),
  );
  return latestMvp15McpBindingGeneration;
}

export function createDesktopRuntimeAdapter(
  options?: DesktopRuntimeAdapterOptions,
): DesktopRuntimeAdapter {
  let currentSession: McpSession | null = null;
  const mvp15McpBindingEpoch = globalThis.crypto.randomUUID();
  const nativeInvoke = Object.prototype.hasOwnProperty.call(options ?? {}, "nativeInvoke")
    ? (options?.nativeInvoke ?? null)
    : getGlobalInvoke();
  const router: AgentLoopRuntimeClient = createAgentLoopRuntime({
    runtimeMode: "mock",
    discovery: null,
    clockStart: 1_000,
  });
  const terminalAdapter = createDesktopTerminalAdapterFromEnvironment(nativeInvoke);
  const watcherAdapter = createDesktopWatcherAdapterFromEnvironment(nativeInvoke);
  const browserAdapter = createDesktopBrowserAdapterFromEnvironment(nativeInvoke);
  const textMutationAdapter = createDesktopTextMutationAdapterFromEnvironment(nativeInvoke);
  let latestEditorAttachInput: NativeEditorAttachInput | null = null;
  let latestEditorSessionId: string | null = null;
  let latestEditorObservationGeneration = 0;
  let phaseManagedEditorOwner: Mvp15dManagedEditorOwnerBinding | null = null;
  const resolveNativeEditorRootRef = (rootRef: unknown): unknown =>
    typeof rootRef === "string" ? resolveTrustedNativeRootRef(rootRef) ?? rootRef : rootRef;
  const nativeEditorObservationAdapter =
    createEditorObservationNativeAdapterFromEnvironment(nativeInvoke);
  const editorObservationAdapter: NativeEditorObservationAdapter | null = nativeEditorObservationAdapter
    ? {
        ...nativeEditorObservationAdapter,
        discoverProcesses: async (input) => {
          const authority = fixedObservationAuthority;
          if (authority && !phaseManagedEditorOwner && !authority.predecessorWindowIdentitySha256) {
            await createMvp15dManagedEditorOwner(input);
          }
          const discovery = await nativeEditorObservationAdapter.discoverProcesses(input);
          if (authority) {
            phaseManagedEditorOwner = recoverMvp15dManagedEditorOwner(
              authority,
              input,
              discovery.processes,
              phaseManagedEditorOwner,
            );
          }
          return discovery;
        },
        attachProcess: async (input) => {
          const session = await nativeEditorObservationAdapter.attachProcess(input);
          if (session?.status === "attached") {
            if (
              currentMvp15DAttestationBinding &&
              currentMvp15DAttestationBinding.editorSessionId !== session.sessionId
            ) {
              const retraction = retractMvp15DCompanionAttestation(
                "installed_unverified",
                "BLOCKED_BY_PLUGIN_PROVENANCE",
                "editor_observation_identity_changed",
              );
              await settleMvp15DNativeRetractions(retraction);
              syncMcp();
            }
            latestEditorAttachInput = structuredClone(input);
            latestEditorSessionId = session.sessionId;
            latestEditorObservationGeneration = session.observationGeneration ?? 0;
          }
          return session;
        },
      }
    : null;
  const mvp9Service = createMvp9RuntimeService({
    mvp10: { terminalAdapter },
    nativeWatcherAdapter: watcherAdapter ?? undefined,
    nativeBrowserAdapter: browserAdapter ?? undefined,
  });
  const mvp9Listeners = new Set<(state: Mvp9RuntimeState) => void>();

  function syncMvp9() {
    const state = mvp9Service.getState();
    for (const listener of mvp9Listeners) {
      listener(state);
    }
  }

  mvp9Service.subscribe(() => syncMvp9());
  if (terminalAdapter) {
    void mvp9Service.mvp10.terminal.refreshCapability().then(() => syncMvp9());
  }
  if (browserAdapter) {
    void mvp9Service.browser.refreshCapability().then(() => syncMvp9());
  }

  let mcpState: McpConnectionState = {
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
  };
  let currentDiscovery: McpDiscoverySnapshot | null = null;
  let currentMvp15FacadeTools: Mvp15McpAssetToolDescriptor[] = [];
  let mcpDiscoveryGeneration = 0;
  let fixedObservationAuthority: {
    taskId: string;
    phase: "product-capture" | "ui-lifecycle";
    session: string;
    generation: number;
    predecessorWindowIdentitySha256?: string;
  } | null = null;
  let currentMvp15dMcpSessionId: string | null = null;
  let currentMvp15dToolSearchMode: Mvp15dToolSearchMode | "ui" = "ui";
  const mvp15dTransportObservations: Array<{
    api: string;
    call: Mvp15dRawObservedCall;
  }> = [];
  let lastMvp15dNativeAttestation: {
    request: Record<string, unknown>;
    response: Record<string, unknown>;
  } | null = null;
  let lastMvp15dNativeRetraction: {
    request: Record<string, unknown>;
    response: Record<string, unknown>;
  } | null = null;
  type NativeMcpObservationResult = {
    method?: "POST" | "DELETE";
    sessionId?: string | null;
    session_id?: string | null;
    observationRequest?: Record<string, unknown>;
    observationReceipts?: Record<string, string>;
  };
  const observationNativeInvoke: NativeInvoke = async <T = unknown>(command: string, payload?: unknown) => {
    if (command !== "mcp_streamable_http_request" || !nativeInvoke || !fixedObservationAuthority) {
      if (!nativeInvoke) throw new Error("native_invoke_unavailable");
      return nativeInvoke<T>(command, payload);
    }
    const envelope = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as { input?: Record<string, unknown> }
      : null;
    const input = envelope?.input;
    if (!input || Object.prototype.hasOwnProperty.call(input, "observation")) {
      throw new Error("mvp15d_native_mcp_observation_input_invalid");
    }
    const observedInput = {
      ...structuredClone(input),
      observation: {
        schemaVersion: "uagent.mvp15d.mcp-observation-intent.v1",
        taskId: fixedObservationAuthority.taskId,
        phase: fixedObservationAuthority.phase,
        phaseSessionId: fixedObservationAuthority.session,
        phaseGeneration: fixedObservationAuthority.generation,
        connectionGeneration: Math.max(1, mcpDiscoveryGeneration),
        toolSearchMode: currentMvp15dToolSearchMode,
      },
    };
    const raw = await nativeInvoke<NativeMcpObservationResult>(command, { input: observedInput });
    const observationRequest = raw.observationRequest;
    const receipts = raw.observationReceipts;
    if (!observationRequest || !receipts || typeof receipts !== "object") {
      throw new Error("mvp15d_native_mcp_observation_receipt_missing");
    }
    for (const [api, receiptId] of Object.entries(receipts)) {
      if (!receiptId.startsWith("mvp15d-observation-receipt:")) {
        throw new Error("mvp15d_native_mcp_observation_receipt_invalid");
      }
      mvp15dTransportObservations.push({
        api,
        call: { receiptId, request: structuredClone(observationRequest) },
      });
    }
    const responseSession = raw.sessionId ?? raw.session_id;
    const requestSession = typeof input.sessionId === "string" ? input.sessionId : null;
    if (input.method === "DELETE") {
      currentMvp15dMcpSessionId = null;
    } else if (typeof responseSession === "string" && responseSession.length > 0) {
      currentMvp15dMcpSessionId = responseSession;
    } else if (requestSession) {
      currentMvp15dMcpSessionId = requestSession;
    }
    return raw as T;
  };

  const observeNativeState = async (
    kind: string,
    request: Record<string, unknown>,
  ): Promise<{ call: Mvp15dRawObservedCall; observation: Record<string, unknown> }> => {
    if (!nativeInvoke || !fixedObservationAuthority) {
      throw new Error("mvp15d_native_state_observation_unavailable");
    }
    const raw = await nativeInvoke<{
      schemaVersion?: string;
      receiptId?: string;
      request?: Record<string, unknown>;
      observation?: Record<string, unknown>;
    }>("mvp15d_bridge_observe_native_state", {
      input: {
        schemaVersion: "uagent.mvp15d.native-state-observation.v1",
        kind,
        request,
      },
    });
    if (
      raw.schemaVersion !== "uagent.mvp15d.native-state-observation.v1" ||
      typeof raw.receiptId !== "string" ||
      !raw.receiptId.startsWith("mvp15d-observation-receipt:") ||
      !raw.request ||
      !raw.observation
    ) {
      throw new Error("mvp15d_native_state_observation_invalid");
    }
    return {
      call: { receiptId: raw.receiptId, request: structuredClone(raw.request) },
      observation: structuredClone(raw.observation),
    };
  };

  const requireTransportObservation = (
    records: ReadonlyArray<{ api: string; call: Mvp15dRawObservedCall }>,
    api: string,
  ): Mvp15dRawObservedCall => {
    const record = records.find((candidate) => candidate.api === api);
    if (!record) throw new Error(`mvp15d_transport_observation_missing:${api}`);
    return record.call;
  };
  let mvp15McpBindingGeneration = 0;
  let currentMvp15McpBinding: { identity: string; endpoint: string; session: McpSession } | null =
    null;
  let currentMvp15Fingerprint: Mvp15LiveAssetToolsetFingerprintPublication = {
    ...createMvp15LiveAssetToolsetFingerprint([]),
    discoveryGeneration: 0,
    binding: null,
  };
  let currentMvp15DCompanionFingerprint: Mvp15DCompanionFingerprint =
    createMvp15DCompanionLiveFingerprint({
      directTools: [],
      discoveryGeneration: 0,
    });
  let currentMvp15DCompanionStatus = createMvp15DCompanionStatus();
  let currentMvp15DAttestationBinding: {
    trustedRootId: string;
    editorSessionId: string;
    discoveryGeneration: number;
    session: McpSession | null;
    attestationGeneration: number;
  } | null = null;
  let mvp15DAttestationGeneration = 0;
  let mvp15DNativeAttestationPending = 0;
  // Renderer publication is not an authority boundary.  Keep a local barrier
  // while native revocation is in flight so a direct guard call cannot race a
  // stale native companion approval between the local retraction and the native
  // acknowledgement.
  let mvp15DNativeRetractionPending = 0;
  let mvp15DNativeRetractionFailureGeneration = 0;
  let mvp15DNativeRetractionSuccessGeneration = 0;
  const mvp15DNativeRetractions = new Set<Promise<void>>();
  const mvp15DProductRetractions: Mvp15DProductRetractionEvidence[] = [];
  const listeners = new Set<(snapshot: RuntimeSnapshot) => void>();
  const mcpListeners = new Set<(state: McpConnectionState) => void>();

  const captureMvp15DProductAdapterExchange = (
    direction: Mvp15DProductAdapterExchange["direction"],
    method: string,
    payload: unknown,
    generation = mcpDiscoveryGeneration,
  ) => {
    if (!options?.onMvp15DProductAdapterExchange) return;
    try {
      options.onMvp15DProductAdapterExchange({
        generation,
        direction,
        method,
        payload: redactMvp15DProductAdapterPayload(payload),
      });
    } catch {
      // Evidence observation must not alter the desktop connection boundary.
    }
  };

  const captureMvp15DProductTransport = (transport: McpTransportClient): McpTransportClient => {
    if (!options?.onMvp15DProductAdapterExchange) return transport;
    return {
      sendRequest: async (request) => {
        const requestGeneration = mcpDiscoveryGeneration;
        captureMvp15DProductAdapterExchange("request", request.method, request, requestGeneration);
        try {
          const response = await transport.sendRequest(request);
          captureMvp15DProductAdapterExchange(
            "response",
            request.method,
            response,
            requestGeneration,
          );
          return response;
        } catch (error) {
          captureMvp15DProductAdapterExchange(
            "error",
            request.method,
            {
              code: error instanceof Error ? error.name : "transport_error",
            },
            requestGeneration,
          );
          throw error;
        }
      },
      sendNotification: async (notification) => {
        const requestGeneration = mcpDiscoveryGeneration;
        captureMvp15DProductAdapterExchange(
          "request",
          notification.method,
          notification,
          requestGeneration,
        );
        try {
          await transport.sendNotification(notification);
          captureMvp15DProductAdapterExchange(
            "response",
            notification.method,
            {
              notification: "accepted",
            },
            requestGeneration,
          );
        } catch (error) {
          captureMvp15DProductAdapterExchange(
            "error",
            notification.method,
            {
              code: error instanceof Error ? error.name : "transport_error",
            },
            requestGeneration,
          );
          throw error;
        }
      },
      close: () => transport.close(),
    };
  };

  const syncSnapshot = () => {
    const snapshot = router.getSnapshot();
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const syncMcp = () => {
    if (
      mvp15DNativeRetractionPending === 0 &&
      mvp15DNativeRetractionFailureGeneration > 0 &&
      (!currentMvp15DAttestationBinding ||
        mvp15DNativeRetractionFailureGeneration >=
          currentMvp15DAttestationBinding.attestationGeneration)
    ) {
      currentMvp15DCompanionFingerprint = createMvp15DCompanionLiveFingerprint({
        directTools: [],
        discoveryGeneration: mcpDiscoveryGeneration,
      });
      currentMvp15DCompanionStatus = createMvp15DCompanionStatus({
        status: "installed_unverified",
        blocker: "BLOCKED_BY_PLUGIN_PROVENANCE",
        reason: "native_companion_retraction_failed",
        currentGeneration: mcpDiscoveryGeneration,
      });
    }
    for (const listener of mcpListeners) {
      listener(mcpState);
    }
  };

  const invalidateMvp15McpBinding = () => {
    currentMvp15McpBinding = null;
  };

  const publishMvp15McpBinding = (session: McpSession, endpoint: string) => {
    mvp15McpBindingGeneration = nextMvp15McpBindingGeneration(
      mvp15McpBindingGeneration,
    );
    currentMvp15McpBinding = {
      identity: `mcp-binding:${mvp15McpBindingEpoch}:${mvp15McpBindingGeneration}`,
      endpoint,
      session,
    };
  };

  /**
   * Companion provenance is a separate authority from a successful MCP discovery.
   * Clear its complete publication before notifying observers of every negative
   * attestation transition.  In particular, a listener must never observe a new
   * blocked status paired with the SHA or generation binding from a prior verified
   * companion.
   */
  const nextMvp15DAttestationGeneration = () => {
    // Wall-clock generations remain monotonic across a renderer reload while the
    // native process stays alive. The local increment handles multiple attempts
    // in the same millisecond without reusing an approval-binding generation.
    mvp15DAttestationGeneration = Math.max(mvp15DAttestationGeneration + 1, Date.now());
    return mvp15DAttestationGeneration;
  };

  const retractNativeMvp15DApprovals = (
    force = false,
    zeroAuthorityBaseline = false,
  ): { generation: number; settled: Promise<void> } | null => {
    if (
      !nativeInvoke ||
      (!force &&
        !currentMvp15DAttestationBinding &&
        mvp15DNativeAttestationPending === 0 &&
        mvp15DNativeRetractionFailureGeneration === 0)
    )
      return null;
    const retractionSequence = nextMvp15DAttestationGeneration();
    const requestedAttestationGeneration = zeroAuthorityBaseline ? null : retractionSequence;
    const discoveryGeneration = mcpDiscoveryGeneration;
    const attestationBindingPresent = currentMvp15DAttestationBinding !== null;
    const nativeRequest = { attestationGeneration: requestedAttestationGeneration };
    mvp15DNativeRetractionPending += 1;
    // Native revocation must settle before a listener sees this renderer's
    // invalidation.  The result is deliberately shape-checked: a resolved
    // invoke that did not report `retracted` is still a failed authority
    // transition, not a successful no-op.
    // NativeInvoke is typed async, but a bridge implementation can still throw
    // synchronously (for example during an IPC serialization failure).  Start
    // from a resolved promise so every failed retraction follows the same
    // pending-barrier and fail-closed path.
    const settled = Promise.resolve()
      .then(() => {
        captureMvp15DProductAdapterExchange(
          "request",
          "native/retract_mvp15_companion_approvals",
          {
            status: "requested",
            attestationGeneration: requestedAttestationGeneration,
            retractionSequence,
            attestationBindingPresent,
            force,
            zeroAuthorityBaseline,
          },
          discoveryGeneration,
        );
        return nativeInvoke("retract_mvp15_companion_approvals", {
          input: nativeRequest,
        });
      })
      .then((raw) => {
        const result = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
        const allowedResultKeys = new Set([
          "status",
          "reason",
          "applied",
          "requestedAttestationGeneration",
          "minimumAttestationGeneration",
          "generation",
          "revokedApprovalCount",
          "nativeReceiptId",
        ]);
        const resultShapeIsExact =
          result !== null && Object.keys(result).every((key) => allowedResultKeys.has(key));
        if (result) {
          lastMvp15dNativeRetraction = { request: nativeRequest, response: { ...result } };
        }
        const minimumGenerationIsValid =
          Number.isSafeInteger(result?.minimumAttestationGeneration) &&
          (result?.minimumAttestationGeneration as number) >= 0 &&
          (requestedAttestationGeneration === null ||
            result?.minimumAttestationGeneration === requestedAttestationGeneration);
        const succeeded =
          !resultShapeIsExact || result?.status !== "retracted"
            ? false
            : result.applied === true &&
              result.reason === "companion_approval_retracted" &&
              result.requestedAttestationGeneration === requestedAttestationGeneration &&
              minimumGenerationIsValid &&
              Number.isSafeInteger(result.generation) &&
              (result.generation as number) > 0 &&
              Number.isSafeInteger(result.revokedApprovalCount) &&
              (result.revokedApprovalCount as number) >= 0;
        captureMvp15DProductAdapterExchange(
          "response",
          "native/retract_mvp15_companion_approvals",
          {
            status: succeeded
              ? "retracted"
              : result?.status === "stale"
                ? "stale"
                : "invalid",
            attestationGeneration: requestedAttestationGeneration,
            retractionSequence,
            attestationBindingPresent,
            nativeGeneration: succeeded ? result?.generation : null,
            nativeMinimumAttestationGeneration:
              Number.isSafeInteger(result?.minimumAttestationGeneration) &&
              (result?.minimumAttestationGeneration as number) > 0
                ? result?.minimumAttestationGeneration
                : null,
          },
          discoveryGeneration,
        );
        if (!succeeded) {
          if (retractionSequence <= mvp15DNativeRetractionSuccessGeneration) return;
          mvp15DNativeRetractionFailureGeneration = Math.max(
            mvp15DNativeRetractionFailureGeneration,
            retractionSequence,
          );
          return;
        }
        mvp15DNativeRetractionSuccessGeneration = Math.max(
          mvp15DNativeRetractionSuccessGeneration,
          retractionSequence,
        );
        if (mvp15DNativeRetractionSuccessGeneration >= mvp15DNativeRetractionFailureGeneration) {
          mvp15DNativeRetractionFailureGeneration = 0;
        }
      })
      .catch((error) => {
        captureMvp15DProductAdapterExchange(
          "error",
          "native/retract_mvp15_companion_approvals",
          {
            status: "failed",
            attestationGeneration: requestedAttestationGeneration,
            retractionSequence,
            attestationBindingPresent,
            code: error instanceof Error ? error.name : "native_invoke_error",
          },
          discoveryGeneration,
        );
        if (retractionSequence <= mvp15DNativeRetractionSuccessGeneration) return;
        mvp15DNativeRetractionFailureGeneration = Math.max(
          mvp15DNativeRetractionFailureGeneration,
          retractionSequence,
        );
      })
      .finally(() => {
        mvp15DNativeRetractionPending = Math.max(0, mvp15DNativeRetractionPending - 1);
      });
    mvp15DNativeRetractions.add(settled);
    void settled.finally(() => {
      mvp15DNativeRetractions.delete(settled);
    });
    return { generation: retractionSequence, settled };
  };

  const waitForMvp15DNativeRetractions = async () => {
    while (mvp15DNativeRetractions.size > 0) {
      await Promise.all([...mvp15DNativeRetractions]);
    }
  };

  const settleMvp15DNativeRetractions = async (nativeRetraction: Promise<void> | null) => {
    if (nativeRetraction) await nativeRetraction;
    await waitForMvp15DNativeRetractions();
  };

  const mvp15DNativeAuthorityIsBlocked = () =>
    mvp15DNativeRetractionPending > 0 ||
    (mvp15DNativeRetractionFailureGeneration > 0 &&
      (!currentMvp15DAttestationBinding ||
        mvp15DNativeRetractionFailureGeneration >=
          currentMvp15DAttestationBinding.attestationGeneration));

  const mvp15DForwardAuthorityIsReady = () =>
    !mvp15DNativeAuthorityIsBlocked() &&
    currentMvp15DCompanionStatus.status === "verified" &&
    currentMvp15DCompanionFingerprint.status === "ready" &&
    currentMvp15DCompanionFingerprint.sha256 !== null &&
    currentMvp15DCompanionFingerprint.identity !== null &&
    currentMvp15DAttestationBinding !== null &&
    currentMvp15DAttestationBinding.discoveryGeneration === mcpDiscoveryGeneration &&
    currentMvp15DAttestationBinding.session === currentSession &&
    currentDiscovery !== null;

  const retractMvp15DCompanionAttestation = (
    status: UAgentCompanionStatus["status"],
    blocker: UAgentCompanionStatus["blocker"],
    reason: string,
    generation = mcpDiscoveryGeneration,
    forceNativeRetraction = false,
  ): Promise<void> | null => {
    const nativeRetraction = retractNativeMvp15DApprovals(forceNativeRetraction);
    currentMvp15DAttestationBinding = null;
    currentMvp15DCompanionFingerprint = createMvp15DCompanionLiveFingerprint({
      directTools: [],
      discoveryGeneration: generation,
    });
    currentMvp15DCompanionStatus = createMvp15DCompanionStatus({
      status,
      blocker,
      reason,
      currentGeneration: generation,
    });
    return nativeRetraction?.settled ?? null;
  };

  const retractMcpPublication = (
    reason?: Mvp15DProductRetractionEvidence["reason"],
  ): Promise<void> | null => {
    const readyToolCount = currentMvp15Fingerprint.status === "ready"
      && currentMvp15DCompanionFingerprint.status === "ready"
      && currentMvp15DCompanionStatus.status === "verified"
      ? currentMvp15Fingerprint.toolCount
      : 0;
    const generationBefore = currentMvp15Fingerprint.discoveryGeneration;
    invalidateMvp15McpBinding();
    currentDiscovery = null;
    currentMvp15FacadeTools = [];
    currentMvp15Fingerprint = {
      ...createMvp15LiveAssetToolsetFingerprint([]),
      discoveryGeneration: mcpDiscoveryGeneration,
      binding: null,
    };
    const nativeRetraction = retractMvp15DCompanionAttestation(
      "installed_unverified",
      "BLOCKED_BY_MCP_TRANSPORT",
      "mcp_publication_retracted",
    );
    if (reason && readyToolCount === 6) {
      mvp15DProductRetractions.push({
        reason,
        count: readyToolCount,
        sessionId: `mvp15d-retraction:${reason}:${mvp15DProductRetractions.length + 1}`,
        generationBefore,
        generationAfter: mcpDiscoveryGeneration,
        statusBefore: "ready",
        statusAfter: "blocked",
      });
    }
    router.updateContext({
      runtimeMode: "mock",
      discovery: null,
      readResource: undefined,
      callTool: undefined,
    });
    return nativeRetraction;
  };

  const refreshMvp15DCompanionAttestation = async (
    trustedRootId: string,
    editorSessionId?: string,
  ): Promise<UAgentCompanionStatus> => {
    // A new native binding must never race an older retraction.  This also
    // serializes explicit refresh with endpoint/reconnect invalidation.
    await waitForMvp15DNativeRetractions();
    const normalizedEditorSessionId =
      typeof editorSessionId === "string" ? editorSessionId.trim() : "";
    if (
      !nativeInvoke ||
      !currentDiscovery ||
      !isSafeTrustedRootId(trustedRootId) ||
      !normalizedEditorSessionId
    ) {
      const retraction = retractMvp15DCompanionAttestation(
        "installed_unverified",
        "BLOCKED_BY_PLUGIN_PROVENANCE",
        !nativeInvoke
          ? "native_companion_attestation_unavailable"
          : "trusted_root_discovery_or_editor_session_required",
      );
      await settleMvp15DNativeRetractions(retraction);
      syncMcp();
      return currentMvp15DCompanionStatus;
    }
    const discovery = currentDiscovery;
    const facadeTools = currentMvp15FacadeTools;
    const generation = mcpDiscoveryGeneration;
    const session = currentSession;
    const refreshRequiresRetraction = Boolean(
      currentMvp15DAttestationBinding ||
      mvp15DNativeAttestationPending > 0 ||
      mvp15DNativeRetractionFailureGeneration > 0,
    );
    if (refreshRequiresRetraction) {
      const refreshRetraction = retractMvp15DCompanionAttestation(
        "installed_unverified",
        "BLOCKED_BY_PLUGIN_PROVENANCE",
        "native_companion_attestation_refresh",
        generation,
        mvp15DNativeRetractionFailureGeneration > 0,
      );
      await settleMvp15DNativeRetractions(refreshRetraction);
      if (
        generation !== mcpDiscoveryGeneration ||
        session !== currentSession ||
        discovery !== currentDiscovery
      ) {
        return currentMvp15DCompanionStatus;
      }
      syncMcp();
      if (
        generation !== mcpDiscoveryGeneration ||
        session !== currentSession ||
        discovery !== currentDiscovery
      ) {
        return currentMvp15DCompanionStatus;
      }
      if (mvp15DNativeAuthorityIsBlocked()) return currentMvp15DCompanionStatus;
    }
    const attestationGeneration = nextMvp15DAttestationGeneration();
    const nativeAttestationRequest = {
      trustedRootId,
      editorSessionId: normalizedEditorSessionId,
      attestationGeneration,
    };
    try {
      mvp15DNativeAttestationPending += 1;
      let raw: unknown;
      try {
        captureMvp15DProductAdapterExchange(
          "request",
          "native/attest_mvp15_companion",
          {
            status: "requested",
            attestationGeneration,
            discoveryGeneration: generation,
            bindingRequested: true,
          },
          generation,
        );
        raw = await nativeInvoke("attest_mvp15_companion", {
          input: nativeAttestationRequest,
        });
      } finally {
        mvp15DNativeAttestationPending = Math.max(0, mvp15DNativeAttestationPending - 1);
      }
      if (
        attestationGeneration !== mvp15DAttestationGeneration ||
        generation !== mcpDiscoveryGeneration ||
        session !== currentSession ||
        discovery !== currentDiscovery
      ) {
        captureMvp15DProductAdapterExchange(
          "response",
          "native/attest_mvp15_companion",
          {
            status: "stale",
            attestationGeneration,
            discoveryGeneration: generation,
            bindingEstablished: false,
          },
          generation,
        );
        return currentMvp15DCompanionStatus;
      }
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        lastMvp15dNativeAttestation = {
          request: nativeAttestationRequest,
          response: { ...(raw as Record<string, unknown>) },
        };
      }
      const evidence = normalizeNativeMvp15DCompanionEvidence(raw);
      if (!evidence) {
        captureMvp15DProductAdapterExchange(
          "response",
          "native/attest_mvp15_companion",
          {
            status: "invalid",
            attestationGeneration,
            discoveryGeneration: generation,
            bindingEstablished: false,
          },
          generation,
        );
        const retraction = retractMvp15DCompanionAttestation(
          "installed_unverified",
          "BLOCKED_BY_PLUGIN_PROVENANCE",
          "native_companion_attestation_invalid",
          generation,
          true,
        );
        await settleMvp15DNativeRetractions(retraction);
        syncMcp();
        return currentMvp15DCompanionStatus;
      }
      if (evidence.status === "blocked") {
        captureMvp15DProductAdapterExchange(
          "response",
          "native/attest_mvp15_companion",
          {
            status: "blocked",
            attestationGeneration,
            discoveryGeneration: generation,
            bindingEstablished: false,
          },
          generation,
        );
        const retraction = retractMvp15DCompanionAttestation(
          "installed_unverified",
          "BLOCKED_BY_PLUGIN_PROVENANCE",
          evidence.reason,
          generation,
          true,
        );
        await settleMvp15DNativeRetractions(retraction);
        syncMcp();
        return currentMvp15DCompanionStatus;
      }
      const attestation = attestMvp15DCompanion({
        manifest: evidence.manifest,
        installedModules: evidence.installedModules,
        loadedModules: evidence.loadedModules,
        directTools: discovery.tools,
        facadeTools,
        discoveryGeneration: generation,
      });
      if (attestation.status.status === "verified" && attestation.fingerprint.status === "ready") {
        currentMvp15DCompanionFingerprint = attestation.fingerprint;
        currentMvp15DCompanionStatus = attestation.status;
        currentMvp15DAttestationBinding = {
          trustedRootId,
          editorSessionId: normalizedEditorSessionId,
          discoveryGeneration: generation,
          session,
          attestationGeneration,
        };
        if (attestationGeneration > mvp15DNativeRetractionFailureGeneration) {
          mvp15DNativeRetractionFailureGeneration = 0;
        }
        captureMvp15DProductAdapterExchange(
          "response",
          "native/attest_mvp15_companion",
          {
            status: "verified",
            attestationGeneration,
            discoveryGeneration: generation,
            bindingEstablished: true,
          },
          generation,
        );
      } else {
        const taskOnlyRevocationBinding =
          Boolean(options?.onMvp15DProductAdapterExchange) &&
          evidence.status === "observed" &&
          attestation.status.status === "incompatible" &&
          attestation.status.reason === "companion_live_identity_missing";
        if (taskOnlyRevocationBinding) {
          // D0 publishes a mutation-incapable Probe inventory rather than the
          // exact-six asset facade, so the public companion status must remain
          // blocked. Retain only enough native observation state for the
          // task-owned exchange observer to prove that disconnect/reconnect
          // completion-orders a real native revocation. This branch is absent
          // from production defaults and cannot make a guard ready.
          currentMvp15DCompanionFingerprint = attestation.fingerprint;
          currentMvp15DCompanionStatus = attestation.status;
          currentMvp15DAttestationBinding = {
            trustedRootId,
            editorSessionId: normalizedEditorSessionId,
            discoveryGeneration: generation,
            session,
            attestationGeneration,
          };
          captureMvp15DProductAdapterExchange(
            "response",
            "native/attest_mvp15_companion",
            {
              status: "native_observed_revocation_bound",
              publicStatus: attestation.status.status,
              attestationGeneration,
              discoveryGeneration: generation,
              bindingEstablished: true,
            },
            generation,
          );
          syncMcp();
          return currentMvp15DCompanionStatus;
        }
        captureMvp15DProductAdapterExchange(
          "response",
          "native/attest_mvp15_companion",
          {
            status: attestation.status.status,
            attestationGeneration,
            discoveryGeneration: generation,
            bindingEstablished: false,
          },
          generation,
        );
        const retraction = retractMvp15DCompanionAttestation(
          attestation.status.status,
          attestation.status.blocker,
          attestation.status.reason,
          generation,
          true,
        );
        await settleMvp15DNativeRetractions(retraction);
      }
      syncMcp();
      return currentMvp15DCompanionStatus;
    } catch (error) {
      captureMvp15DProductAdapterExchange(
        "error",
        "native/attest_mvp15_companion",
        {
          status: "failed",
          attestationGeneration,
          discoveryGeneration: generation,
          bindingEstablished: false,
          code: error instanceof Error ? error.name : "native_invoke_error",
        },
        generation,
      );
      if (
        attestationGeneration === mvp15DAttestationGeneration &&
        generation === mcpDiscoveryGeneration &&
        session === currentSession
      ) {
        const retraction = retractMvp15DCompanionAttestation(
          "installed_unverified",
          "BLOCKED_BY_PLUGIN_PROVENANCE",
          "native_companion_attestation_failed",
          generation,
          true,
        );
        await settleMvp15DNativeRetractions(retraction);
        syncMcp();
      }
      return currentMvp15DCompanionStatus;
    }
  };

  const runMvp15DProductNoOpProbe = options?.onMvp15DProductAdapterExchange
    ? async (route: "direct" | "toolset_registry", toolSearch: boolean): Promise<unknown> => {
        if (!currentSession || !currentDiscovery || mcpState.status !== "connected") {
          throw new Error("mvp15d_product_probe_requires_current_discovery");
        }
        const probeSession = currentSession;
        const probeDiscovery = currentDiscovery;
        const probeGeneration = mcpDiscoveryGeneration;
        const assertCurrentProbeSession = () => {
          if (
            currentSession !== probeSession ||
            currentDiscovery !== probeDiscovery ||
            mcpDiscoveryGeneration !== probeGeneration ||
            mcpState.status !== "connected"
          ) {
            throw new Error("mvp15d_product_probe_session_stale");
          }
        };
        const callCurrentProbe = async (
          name: string,
          args: Record<string, unknown>,
        ): Promise<unknown> => {
          assertCurrentProbeSession();
          const result = await probeSession.callTool(name, args);
          assertCurrentProbeSession();
          return result;
        };
        assertMvp15D0ProbeInventory(probeDiscovery, route, toolSearch);
        if (route === "direct") {
          const directProbes = probeDiscovery.tools.filter(
            (tool) =>
              tool.name === "uagent.d0.probe" && isMvp15D0EmptyInputSchema(tool.inputSchema),
          );
          if (directProbes.length !== 1) throw new Error("mvp15d_direct_probe_descriptor_required");
          return callCurrentProbe(directProbes[0]!.name, {});
        }
        if (toolSearch) {
          const toolsetList = await callCurrentProbe("list_toolsets", {});
          const toolsetIds = getToolsetIds(unwrapMcpToolPayload(toolsetList)).filter(
            isMvp15D0ToolsetId,
          );
          const matches: Array<{ toolsetName: string; toolName: string }> = [];
          for (const toolsetName of toolsetIds) {
            const description = unwrapMcpToolPayload(
              await callCurrentProbe("describe_toolset", { toolset_name: toolsetName }),
            );
            const toolName = findMvp15D0ProbeToolName(description);
            if (toolName) matches.push({ toolsetName, toolName });
          }
          if (matches.length !== 1) throw new Error("mvp15d_toolset_probe_descriptor_required");
          const match = matches[0]!;
          return callCurrentProbe("call_tool", {
            toolset_name: match.toolsetName,
            tool_name: match.toolName,
            arguments: {},
          });
        }
        const eagerProbes = probeDiscovery.tools.filter(isMvp15D0EagerProbeDescriptor);
        if (eagerProbes.length !== 1) throw new Error("mvp15d_eager_probe_descriptor_required");
        return callCurrentProbe(eagerProbes[0]!.name, {});
      }
    : undefined;

  let startupMvp15DNativeRetractionStarted = false;
  let startupMvp15DNativeRetraction: {
    generation: number;
    settled: Promise<void>;
  } | null = null;
  const ensureStartupMvp15DNativeRetraction = () => {
    if (startupMvp15DNativeRetractionStarted) return startupMvp15DNativeRetraction;
    startupMvp15DNativeRetractionStarted = true;
    // The Tauri process outlives a renderer. A reconstructed adapter must
    // establish zero native authority before its first MCP connection can publish.
    startupMvp15DNativeRetraction = retractNativeMvp15DApprovals(true, true);
    void startupMvp15DNativeRetraction?.settled.then(() => {
      if (mvp15DNativeRetractionFailureGeneration > 0) {
        currentMvp15DCompanionFingerprint = createMvp15DCompanionLiveFingerprint({
          directTools: [],
          discoveryGeneration: mcpDiscoveryGeneration,
        });
        currentMvp15DCompanionStatus = createMvp15DCompanionStatus({
          status: "installed_unverified",
          blocker: "BLOCKED_BY_PLUGIN_PROVENANCE",
          reason: "native_companion_retraction_failed",
          currentGeneration: mcpDiscoveryGeneration,
        });
        mcpState = {
          ...mcpState,
          status: "error",
          lastError: "Native companion authority baseline retraction failed.",
        };
        syncMcp();
      }
    });
    return startupMvp15DNativeRetraction;
  };

  let pendingRendererInstanceReceipt: Mvp15dRawObservedCall | null = null;

  const nativeReceiptReference = (
    observation: { request: Record<string, unknown>; response: Record<string, unknown> } | null,
  ): Mvp15dRawObservedCall => {
    const receiptId = observation?.response.nativeReceiptId;
    if (!observation || typeof receiptId !== "string" || !receiptId.startsWith("mvp15d-observation-receipt:")) {
      throw new Error("mvp15d_native_observation_receipt_missing");
    }
    return { receiptId, request: structuredClone(observation.request) };
  };

  const isMvp15dSha256 = (value: unknown): value is string =>
    typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  const isMvp15dCreationFiletime = (value: unknown): value is string =>
    typeof value === "string" && /^[1-9][0-9]{0,19}$/.test(value);

  const managedEditorOwnerFromRecord = (
    authority: NonNullable<typeof fixedObservationAuthority>,
    input: NativeEditorProcessConfigInput,
    process: Record<string, unknown>,
    owner: Record<string, unknown>,
    createCall: Mvp15dRawObservedCall | null,
  ): Mvp15dManagedEditorOwnerBinding => {
    const pid = Number(owner.processPid ?? process.processPid ?? 0);
    const processCreationFiletime =
      owner.processCreationFiletime ?? process.processCreationFiletime;
    const listenerInstanceSha256 =
      owner.listenerInstanceSha256 ?? process.listenerInstanceSha256;
    const ownerBindingSha256 = owner.ownerBindingSha256 ?? process.ownerBindingSha256;
    if (
      typeof process.id !== "string" ||
      !process.id ||
      typeof process.pidHash !== "string" ||
      !process.pidHash ||
      process.source !== "managed" ||
      !Number.isSafeInteger(pid) ||
      pid <= 0 ||
      !isMvp15dCreationFiletime(processCreationFiletime) ||
      !isMvp15dSha256(listenerInstanceSha256) ||
      !isMvp15dSha256(ownerBindingSha256)
    ) {
      throw new Error("mvp15d_phase_listener_owner_identity_invalid");
    }
    return {
      taskId: authority.taskId,
      phase: authority.phase,
      projectId: input.projectId,
      rootRef: input.rootRef,
      uprojectRelativePath: input.uprojectRelativePath,
      processId: process.id,
      pidHash: process.pidHash,
      pid,
      processCreationFiletime,
      listenerInstanceSha256,
      ownerBindingSha256,
      createCall,
    };
  };

  const createMvp15dManagedEditorOwner = async (
    input: NativeEditorProcessConfigInput,
  ): Promise<Mvp15dManagedEditorOwnerBinding> => {
    const authority = fixedObservationAuthority;
    if (!nativeInvoke || !authority || phaseManagedEditorOwner) {
      throw new Error("mvp15d_phase_listener_owner_create_rejected");
    }
    const request = {
      schemaVersion: "uagent.mvp15d.managed-editor-process-create.v2",
      purpose: "phase_listener_owner",
      taskId: authority.taskId,
      phase: authority.phase,
      projectId: input.projectId,
      rootRef: resolveNativeEditorRootRef(input.rootRef),
      uprojectRelativePath: input.uprojectRelativePath,
    };
    const response = await nativeInvoke<Record<string, unknown>>(
      "create_managed_editor_process",
      { input: request },
    );
    const process = response.process && typeof response.process === "object" && !Array.isArray(response.process)
      ? response.process as Record<string, unknown>
      : null;
    if (
      response.schemaVersion !== "uagent.mvp15d.managed-editor-process-create-result.v2" ||
      response.status !== "ready" ||
      response.reason !== "task_owned_listener_accepting" ||
      response.purpose !== "phase_listener_owner" ||
      response.ownerTaskId !== authority.taskId ||
      response.ownerPhase !== authority.phase ||
      !process
    ) {
      throw new Error("mvp15d_phase_listener_owner_create_failed");
    }
    const createCall = nativeReceiptReference({ request, response });
    const owner = managedEditorOwnerFromRecord(authority, input, process, response, createCall);
    phaseManagedEditorOwner = owner;
    return owner;
  };

  const recoverMvp15dManagedEditorOwner = (
    authority: NonNullable<typeof fixedObservationAuthority>,
    input: NativeEditorProcessConfigInput,
    processes: ReadonlyArray<unknown>,
    expected: Mvp15dManagedEditorOwnerBinding | null,
  ): Mvp15dManagedEditorOwnerBinding => {
    const managed = processes.filter((candidate): candidate is Record<string, unknown> =>
      Boolean(candidate) &&
      typeof candidate === "object" &&
      !Array.isArray(candidate) &&
      (candidate as Record<string, unknown>).managedPurpose === "phase_listener_owner",
    );
    if (managed.length !== 1) {
      throw new Error("mvp15d_phase_listener_owner_discovery_invalid");
    }
    const recovered = managedEditorOwnerFromRecord(authority, input, managed[0]!, managed[0]!, expected?.createCall ?? null);
    if (
      expected &&
      (recovered.processId !== expected.processId ||
        recovered.pidHash !== expected.pidHash ||
        recovered.pid !== expected.pid ||
        recovered.processCreationFiletime !== expected.processCreationFiletime ||
        recovered.listenerInstanceSha256 !== expected.listenerInstanceSha256 ||
        recovered.ownerBindingSha256 !== expected.ownerBindingSha256)
    ) {
      throw new Error("mvp15d_phase_listener_owner_discovery_mismatch");
    }
    return recovered;
  };

  const canonicalProductDescriptors = (): Mvp15dCanonicalToolDescriptor[] => {
    const directNames = new Set((currentDiscovery?.tools ?? []).map((tool) => tool.name));
    return getMvp15AssetTools(currentDiscovery, currentMvp15FacadeTools).map((tool) => ({
      affectedAssetsSchema: tool.affectedAssetsSchema as Record<string, unknown>,
      dryRunSchema: tool.dryRunSchema as Record<string, unknown>,
      evidenceQuery: tool.evidenceQuery as Record<string, unknown>,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      methodId: null,
      name: tool.name,
      rollbackContract: tool.rollbackContract as Record<string, unknown>,
      schemaVersion: String(tool.schemaVersion ?? ""),
      source: directNames.has(tool.name) ? "direct" : "facade",
      toolsetId: null,
    }));
  };

  let productTransitionState: {
    stateReceiptId: string;
    sessionId: string;
    generation: number;
  } | null = null;
  const productionProductObservationPort: Mvp15dProductObservationPort = {
    readMutationCounters: async () => {
      const observation = await observeNativeState("mutation_counters", { scope: "product-summary" });
      const values = observation.observation.values;
      if (!Array.isArray(values) || values.length !== 5 || values.some((value) => !Number.isSafeInteger(value))) {
        throw new Error("mvp15d_product_counter_source_invalid");
      }
      return { dryRun: Number(values[0]), execute: Number(values[1]), rollback: Number(values[4]) };
    },
    discover: async ({ toolSearchEnabled }) => {
      const authority = fixedObservationAuthority;
      if (!authority || authority.phase !== "product-capture") {
        throw new Error("mvp15d_product_authority_port_unavailable");
      }
      currentMvp15dToolSearchMode = toolSearchEnabled ? "on" : "off";
      const rendererInstanceCall = pendingRendererInstanceReceipt ?? (
        await observeNativeState("renderer_process", { reason: "product_discovery" })
      ).call;
      pendingRendererInstanceReceipt = null;
      if (mcpState.status === "connected" || currentMvp15dMcpSessionId) {
        adapter.disconnectMcp();
        const disconnectDeadline = Date.now() + 5_000;
        while (mcpState.status !== "disconnected" && Date.now() < disconnectDeadline) {
          await new Promise((resolve) => globalThis.setTimeout(resolve, 10));
        }
        if (mcpState.status !== "disconnected") {
          throw new Error("mvp15d_product_discovery_disconnect_failed");
        }
      }
      const observationStart = mvp15dTransportObservations.length;
      await adapter.connectMcp();
      if (adapter.getMcpState().status !== "connected" || !currentMvp15dMcpSessionId) {
        throw new Error("mvp15d_product_connect_failed");
      }
      const sessionId = currentMvp15dMcpSessionId;
      await adapter.discoverMcp();
      if (!currentDiscovery || currentMvp15Fingerprint.status !== "ready") {
        throw new Error("mvp15d_product_discovery_failed");
      }
      const generation = mcpDiscoveryGeneration;
      const transportRecords = mvp15dTransportObservations.slice(observationStart);
      const configCall = requireTransportObservation(transportRecords, "mcp_configure_tool_search");
      const connectCall = requireTransportObservation(transportRecords, "mcp_connect");
      const initializeCall = requireTransportObservation(transportRecords, "mcp_initialize");
      const discoverCall = requireTransportObservation(transportRecords, "mcp_discover");
      const normalizeCall = requireTransportObservation(transportRecords, "mcp_normalize");
      const fingerprintCall = requireTransportObservation(transportRecords, "mcp_fingerprint");
      const toolSearchCalls = transportRecords
        .filter(({ api }) => api === "mcp_tool_search_call")
        .map(({ call }) => call);
      if ((toolSearchEnabled && toolSearchCalls.length === 0) || (!toolSearchEnabled && toolSearchCalls.length > 0)) {
        throw new Error("mvp15d_product_tool_search_wire_mode_invalid");
      }
      const attestationRequest = lastMvp15dNativeAttestation?.request;
      if (!attestationRequest) throw new Error("mvp15d_product_attestation_context_missing");
      await refreshMvp15DCompanionAttestation(
        String(attestationRequest.trustedRootId ?? ""),
        String(attestationRequest.editorSessionId ?? ""),
      );
      const descriptors = canonicalProductDescriptors();
      if (descriptors.length !== MVP15_ASSET_TOOL_ALLOWLIST.length) {
        throw new Error("mvp15d_product_exact_six_required");
      }
      const mutationCounterCall = (
        await observeNativeState("mutation_counters", { scope: "product", mcpSessionId: sessionId })
      ).call;
      productTransitionState = {
        stateReceiptId: fingerprintCall.receiptId,
        sessionId,
        generation,
      };
      return {
        mode: toolSearchEnabled ? "on" : "off",
        configCall,
        rendererInstanceCall,
        connectCall,
        initializeCall,
        discoverCall,
        normalizeCall,
        fingerprintCall,
        nativeAttestation: nativeReceiptReference(lastMvp15dNativeAttestation),
        mutationCounterCall,
        toolSearchCalls,
      };
    },
    retract: async (reason) => {
      const authority = fixedObservationAuthority;
      if (!authority || authority.phase !== "product-capture") {
        throw new Error("mvp15d_product_retraction_source_not_ready");
      }
      const readyDiscovery = await productionProductObservationPort.discover({ toolSearchEnabled: false });
      const before = productTransitionState;
      if (!before || before.stateReceiptId !== readyDiscovery.fingerprintCall.receiptId) {
        throw new Error("mvp15d_product_retraction_ready_state_invalid");
      }
      const endpoint = mcpState.profile?.endpoint ?? "";
      const rendererBefore = await observeNativeState("renderer_process", { reason, stage: "before" });
      const rendererAfter = rendererBefore;
      if (reason === "refresh_tools") {
        await adapter.discoverMcp();
      } else if (reason === "reconnect") {
        const observationStart = mvp15dTransportObservations.length;
        await disconnectMcpAndWait();
        if (mcpState.status !== "disconnected") throw new Error("mvp15d_product_retraction_disconnect_failed");
        const disconnectCall = requireTransportObservation(
          mvp15dTransportObservations.slice(observationStart),
          "mcp_disconnect",
        );
        if (disconnectCall.request.sessionId !== before.sessionId) {
          throw new Error("mvp15d_product_retraction_disconnect_session_mismatch");
        }
        await adapter.connectMcp();
        await adapter.discoverMcp();
      } else if (reason === "endpoint_change") {
        adapter.setMcpEndpoint("http://127.0.0.1:9/mcp");
        await adapter.connectMcp();
        if (mcpState.status !== "error") throw new Error("mvp15d_product_retraction_failure_not_observed");
        adapter.setMcpEndpoint(endpoint);
        await adapter.connectMcp();
        if (adapter.getMcpState().status !== "connected") {
          throw new Error("mvp15d_product_retraction_endpoint_restore_failed");
        }
        await adapter.discoverMcp();
      } else if (reason === "ue_restart") {
        const attestationBinding = currentMvp15DAttestationBinding;
        const attachInput = latestEditorAttachInput;
        const predecessor = phaseManagedEditorOwner;
        if (
          !attestationBinding ||
          !attachInput ||
          !predecessor ||
          !editorObservationAdapter ||
          !latestEditorSessionId ||
          latestEditorObservationGeneration <= 0 ||
          attestationBinding.editorSessionId !== latestEditorSessionId ||
          attachInput.processId !== predecessor.processId ||
          attachInput.pidHash !== predecessor.pidHash
        ) {
          throw new Error("mvp15d_product_ue_restart_context_unavailable");
        }
        const predecessorObservationGeneration = latestEditorObservationGeneration;
        const predecessorAttestationGeneration = attestationBinding.attestationGeneration;
        const trustedRootId = attestationBinding.trustedRootId;
        try {
          await disconnectMcpAndWait();
          const terminated = await invokeObservedNative("terminate_managed_editor_process", {
            schemaVersion: "uagent.mvp15d.managed-editor-process-terminate.v2",
            purpose: "phase_listener_owner",
            taskId: predecessor.taskId,
            phase: predecessor.phase,
            sessionId: attestationBinding.editorSessionId,
            processId: predecessor.processId,
            pid: predecessor.pid,
            processCreationFiletime: predecessor.processCreationFiletime,
            listenerInstanceSha256: predecessor.listenerInstanceSha256,
            ownerBindingSha256: predecessor.ownerBindingSha256,
          });
          const termination = terminated.response;
          if (
            termination.schemaVersion !== "uagent.mvp15d.managed-editor-process-terminate-result.v2" ||
            termination.status !== "terminated" ||
            termination.reason !== "task_owned_process_exited" ||
            termination.purpose !== "phase_listener_owner" ||
            termination.ownerTaskId !== predecessor.taskId ||
            termination.ownerPhase !== predecessor.phase ||
            termination.sessionId !== attestationBinding.editorSessionId ||
            termination.processId !== predecessor.processId ||
            termination.pid !== predecessor.pid ||
            termination.processCreationFiletime !== predecessor.processCreationFiletime ||
            termination.pidHash !== predecessor.pidHash ||
            termination.observationGeneration !== predecessorObservationGeneration ||
            !isMvp15dSha256(termination.processIdentitySha256) ||
            termination.listenerInstanceSha256 !== predecessor.listenerInstanceSha256 ||
            termination.ownerBindingSha256 !== predecessor.ownerBindingSha256 ||
            termination.exitObserved !== true ||
            termination.listenerClosed !== true
          ) {
            throw new Error("mvp15d_product_ue_restart_termination_failed");
          }
          phaseManagedEditorOwner = null;
          const successorOwner = await createMvp15dManagedEditorOwner({
            projectId: predecessor.projectId,
            rootRef: predecessor.rootRef,
            uprojectRelativePath: predecessor.uprojectRelativePath,
          });
          if (
            successorOwner.processId === predecessor.processId ||
            successorOwner.pidHash === predecessor.pidHash ||
            (successorOwner.pid === predecessor.pid &&
              successorOwner.processCreationFiletime === predecessor.processCreationFiletime) ||
            successorOwner.listenerInstanceSha256 === predecessor.listenerInstanceSha256 ||
            successorOwner.ownerBindingSha256 === predecessor.ownerBindingSha256
          ) {
            throw new Error("mvp15d_product_ue_restart_successor_identity_stale");
          }
          const successorDiscovery = await editorObservationAdapter.discoverProcesses({
            projectId: predecessor.projectId,
            rootRef: predecessor.rootRef,
            uprojectRelativePath: predecessor.uprojectRelativePath,
          });
          const successorProcess = successorDiscovery.processes.find(
            (process) => process.id === successorOwner.processId && process.pidHash === successorOwner.pidHash,
          );
          if (successorDiscovery.status !== "ready" || !successorProcess) {
            throw new Error("mvp15d_product_ue_restart_successor_discovery_failed");
          }
          const successorAttachInput: NativeEditorAttachInput = {
            ...attachInput,
            projectId: predecessor.projectId,
            rootRef: predecessor.rootRef,
            uprojectRelativePath: predecessor.uprojectRelativePath,
            processId: successorOwner.processId,
            pidHash: successorOwner.pidHash,
            processDisplayName: successorProcess.displayName,
            mode: "attached",
          };
          const successor = await invokeObservedNative("attach_editor_process", {
            ...successorAttachInput,
            rootRef: resolveNativeEditorRootRef(successorAttachInput.rootRef),
          });
          const successorSessionId = successor.response.sessionId;
          const successorObservationGeneration = Number(successor.response.observationGeneration ?? 0);
          if (
            successor.response.status !== "attached" ||
            typeof successorSessionId !== "string" ||
            !successorSessionId ||
            successorSessionId === attestationBinding.editorSessionId ||
            successor.response.processId !== successorOwner.processId ||
            successor.response.pidHash !== successorOwner.pidHash ||
            !Number.isSafeInteger(successorObservationGeneration) ||
            successorObservationGeneration <= predecessorObservationGeneration
          ) {
            throw new Error("mvp15d_product_ue_restart_attach_failed");
          }
          latestEditorAttachInput = structuredClone(successorAttachInput);
          latestEditorSessionId = successorSessionId;
          latestEditorObservationGeneration = successorObservationGeneration;
          await adapter.connectMcp();
          if (
            adapter.getMcpState().status !== "connected" ||
            !currentMvp15dMcpSessionId ||
            currentMvp15dMcpSessionId === before.sessionId
          ) {
            throw new Error("mvp15d_product_ue_restart_connect_failed");
          }
          await adapter.discoverMcp();
          if (
            !currentDiscovery ||
            currentMvp15Fingerprint.status !== "ready" ||
            mcpDiscoveryGeneration <= before.generation
          ) {
            throw new Error("mvp15d_product_ue_restart_discovery_failed");
          }
          await refreshMvp15DCompanionAttestation(trustedRootId, successorSessionId);
          if (
            currentMvp15DCompanionStatus.status !== "verified" ||
            currentMvp15DCompanionFingerprint.status !== "ready" ||
            !currentMvp15DAttestationBinding ||
            currentMvp15DAttestationBinding.editorSessionId !== successorSessionId ||
            currentMvp15DAttestationBinding.discoveryGeneration !== mcpDiscoveryGeneration ||
            currentMvp15DAttestationBinding.attestationGeneration <= predecessorAttestationGeneration
          ) {
            throw new Error("mvp15d_product_ue_restart_attestation_failed");
          }
        } catch (error) {
          productTransitionState = null;
          const failureRetraction = retractNativeMvp15DApprovals(true, false);
          if (failureRetraction) await failureRetraction.settled;
          throw error;
        }
      } else if (reason === "stale_completion") {
        await adapter.discoverMcp();
        await adapter.discoverMcp();
      }
      const nativeTransition = retractNativeMvp15DApprovals(true, false);
      if (!nativeTransition) throw new Error("mvp15d_product_retraction_native_unavailable");
      await nativeTransition.settled;
      const nativeRetraction = nativeReceiptReference(lastMvp15dNativeRetraction);
      const transitionRequest = { reason, stateBeforeReceiptId: before.stateReceiptId };
      const transition = await observeNativeState("mcp_retraction_transition", transitionRequest);
      productTransitionState = null;
      return {
        reason,
        readyDiscovery,
        rendererInstanceCall: rendererAfter.call,
        transitionCall: transition.call,
        nativeRetraction,
      };
    },
    requestRendererRestart: async (segment) => {
      const authority = fixedObservationAuthority;
      if (!authority || authority.phase !== "product-capture" || !nativeInvoke) {
        throw new Error("mvp15d_renderer_restart_parent_authority_required");
      }
      const readyDiscovery = await productionProductObservationPort.discover({ toolSearchEnabled: false });
      const before = productTransitionState;
      if (
        !before ||
        before.stateReceiptId !== readyDiscovery.fingerprintCall.receiptId ||
        !currentMvp15dMcpSessionId
      ) {
        throw new Error("mvp15d_renderer_restart_ready_state_invalid");
      }
      const rendererBefore = await observeNativeState("renderer_process", {
        reason: "renderer_restart",
        stage: "predecessor",
      });
      const result = await nativeInvoke<{
        schemaVersion?: string;
        handoffId?: string;
        requestReceiptId?: string;
        taskId?: string;
        phase?: string;
      }>("mvp15d_bridge_request_renderer_restart", {
        input: {
          schemaVersion: "uagent.mvp15d.renderer-restart-request.v2",
          taskId: authority.taskId,
          phase: authority.phase,
          rendererBefore: rendererBefore.call,
          predecessorMcpSessionId: currentMvp15dMcpSessionId,
          predecessorMcpGeneration: mcpDiscoveryGeneration,
          segment: { ...segment, readyDiscovery },
        },
      });
      if (
        result.schemaVersion !== "uagent.mvp15d.renderer-restart-response.v2" ||
        typeof result.handoffId !== "string" ||
        !result.handoffId.startsWith("renderer-handoff:") ||
        typeof result.requestReceiptId !== "string" ||
        !result.requestReceiptId.startsWith("mvp15d-observation-receipt:") ||
        result.taskId !== authority.taskId ||
        result.phase !== authority.phase
      ) {
        throw new Error("mvp15d_renderer_restart_request_rejected");
      }
      throw new Error("mvp15d_renderer_restart_handoff_requested");
    },
  };

  const uiBindingState = new Map<string, {
    approvalToken: string | null;
    attachInput: Record<string, unknown>;
    registrationInput: Record<string, unknown>;
    guardRequests: {
      execute: Record<string, unknown>;
      rollback: Record<string, unknown>;
      invalidPath: Record<string, unknown>;
      mcpExecute?: Record<string, unknown>;
      mcpRollback?: Record<string, unknown>;
    };
    processId: string;
    observationGeneration: number;
    managedProcess: {
      taskId: string;
      phase: string;
      processId: string;
      pid: number;
      processCreationFiletime: string;
    } | null;
    negativeCaseId: string | null;
    renderedControlCall: Mvp15dRawObservedCall | null;
  }>();
  const invokeObservedNative = async (
    api: string,
    request: Record<string, unknown>,
  ): Promise<{ reference: Mvp15dRawObservedCall; response: Record<string, unknown> }> => {
    if (!nativeInvoke) throw new Error("mvp15d_native_observation_unavailable");
    const raw = await nativeInvoke<Record<string, unknown>>(api, { input: request });
    const reference = nativeReceiptReference({ request, response: raw });
    return { reference, response: raw };
  };
  const prepareIndependentNegativeRegistration = async (
    caseId: string,
    context: {
      attachInput: Record<string, unknown>;
      registrationInput: Record<string, unknown>;
      guardRequests: {
        execute: Record<string, unknown>;
        rollback: Record<string, unknown>;
        invalidPath: Record<string, unknown>;
        mcpExecute?: Record<string, unknown>;
        mcpRollback?: Record<string, unknown>;
      };
    },
    attachedSessionId: string,
    effectiveAttachInput: Record<string, unknown>,
    identitySuffix: string,
  ): Promise<{
    registrationInput: Record<string, unknown>;
    guardRequests: {
      execute: Record<string, unknown>;
      rollback: Record<string, unknown>;
      invalidPath: Record<string, unknown>;
      mcpExecute: Record<string, unknown>;
      mcpRollback: Record<string, unknown>;
    };
    setupCalls: Mvp15dRawObservedCall[];
  }> => {
    if (!adapter.callMvp15AssetTool || !currentMvp15McpBinding) {
      throw new Error("mvp15d_negative_dry_run_bridge_unavailable");
    }
    const source = context.registrationInput;
    const sourceRunId = String(source.runId ?? "");
    const sourceOperations = Array.isArray(source.operations)
      ? source.operations.filter(
          (operation): operation is Record<string, unknown> =>
            Boolean(operation) && typeof operation === "object" && !Array.isArray(operation),
        )
      : [];
    if (!sourceRunId || sourceOperations.length !== 5) {
      throw new Error("mvp15d_negative_registration_source_invalid");
    }
    const caseSlug = caseId.toLowerCase();
    const suffix = identitySuffix.replace(/[^A-Za-z0-9_-]/g, "");
    const runId = `negative-${caseSlug}-${suffix}`;
    const changeSetId = `negative-${caseSlug}-change-${suffix}`;
    const sourceRunRoot = `/Game/UAgentSandbox/${sourceRunId}`;
    const runRoot = `/Game/UAgentSandbox/${runId}`;
    const rewritePath = (value: unknown): string | null => {
      if (typeof value !== "string") return null;
      if (value === sourceRunRoot) return runRoot;
      return value.startsWith(`${sourceRunRoot}/`)
        ? `${runRoot}${value.slice(sourceRunRoot.length)}`
        : value;
    };
    const bindingKinds: AssetMutationOperationKind[] = [
      "create_folder",
      "duplicate_asset",
      "rename_asset",
      "move_asset",
      "save_single_asset",
    ];
    const nativeKinds = ["create_folder", "duplicate", "rename", "move", "save"] as const;
    const bindingContext: DryRunBindingContext = {
      changeSetId,
      runId,
      projectId: String(source.projectBindingId ?? context.attachInput.projectId ?? ""),
      trustedRootId: String(context.attachInput.rootRef ?? source.trustedProjectRoot ?? ""),
      editorSessionId: attachedSessionId,
      pidHash: String(effectiveAttachInput.pidHash ?? ""),
      sandboxRoot: "/Game/UAgentSandbox",
    };
    if (
      !bindingContext.projectId ||
      !bindingContext.trustedRootId ||
      !bindingContext.editorSessionId ||
      !bindingContext.pidHash
    ) {
      throw new Error("mvp15d_negative_binding_context_invalid");
    }

    const setupCalls: Mvp15dRawObservedCall[] = [];
    const nativeOperations: Record<string, unknown>[] = [];
    const aggregateOperations: ExternalBindingOperation[] = [];
    const dryRunPayloads: Array<{ toolName: Mvp15McpAssetToolName; args: Record<string, unknown> }> = [];
    for (const [index, sourceOperation] of sourceOperations.entries()) {
      if (sourceOperation.kind !== nativeKinds[index]) {
        throw new Error("mvp15d_negative_registration_operation_order_invalid");
      }
      const operationId = `${caseSlug}-operation-${index + 1}-${suffix.slice(0, 12)}`;
      const assetPath = rewritePath(sourceOperation.assetPath);
      const sourceAssetPath = rewritePath(sourceOperation.sourceAssetPath);
      const targetAssetPath = rewritePath(sourceOperation.targetAssetPath);
      const operationKind = bindingKinds[index]!;
      const bindingInput: DryRunBindingInput = {
        operationId,
        operationKind,
        assetPathBefore:
          operationKind === "duplicate_asset"
            ? sourceAssetPath
            : operationKind === "create_folder"
              ? null
              : assetPath,
        assetPathAfter:
          operationKind === "create_folder"
            ? assetPath
            : operationKind === "duplicate_asset" || operationKind === "rename_asset" || operationKind === "move_asset"
              ? targetAssetPath
              : assetPath,
        exactToolName: String(sourceOperation.toolName ?? ""),
        context: bindingContext,
      };
      const payload = buildExactDryRunPayload(bindingInput);
      if (!isMvp15AssetToolName(payload.toolName)) {
        throw new Error("mvp15d_negative_dry_run_tool_invalid");
      }
      const observationStart = mvp15dTransportObservations.length;
      const raw = await adapter.callMvp15AssetTool(payload.toolName, payload.args);
      const observed = requireTransportObservation(
        mvp15dTransportObservations.slice(observationStart),
        "mcp_asset_tool_call",
      );
      const validated = validatePluginDryRunResult(unwrapPluginDryRunResult(raw), {
        expectedToolName: payload.toolName,
        expectedOperationKind: operationKind,
        expectedOperationId: operationId,
        context: bindingContext,
        operation: {
          kind: operationKind,
          assetPathBefore: bindingInput.assetPathBefore,
          assetPathAfter: bindingInput.assetPathAfter,
        },
      });
      if (!validated.ok) {
        throw new Error(`mvp15d_negative_dry_run_invalid:${validated.reason}`);
      }
      const argsHash = computeArgsHash(bindingInput);
      nativeOperations.push({
        ...structuredClone(sourceOperation),
        operationId,
        kind: nativeKinds[index],
        toolName: payload.toolName,
        pluginDryRunHash: validated.provenance.dryRunHash,
        argsHash,
        sourceAssetPath,
        assetPath,
        targetAssetPath,
      });
      aggregateOperations.push({
        operationId,
        kind: operationKind,
        exactToolName: payload.toolName,
        assetPathBefore: bindingInput.assetPathBefore,
        assetPathAfter: bindingInput.assetPathAfter,
        normalizedArgsHash: argsHash,
        pluginDryRunHash: validated.provenance.dryRunHash,
        pluginHashAlgorithm: validated.provenance.dryRunHashAlgorithm,
        pluginSchemaVersion: validated.provenance.dryRunSchemaVersion,
      });
      dryRunPayloads.push({ toolName: payload.toolName, args: structuredClone(payload.args) });
      setupCalls.push(observed);
    }
    const aggregate = computeAggregateBindingHash(aggregateOperations, bindingContext);
    const registrationInput: Record<string, unknown> = {
      ...structuredClone(source),
      changeSetId,
      runId,
      editorSessionId: attachedSessionId,
      mcpBinding: currentMvp15McpBinding.identity,
      aggregateDryRunHash: aggregate.aggregateDryRunHash,
      aggregateArgsHash: aggregate.aggregateArgsHash,
      operations: nativeOperations,
    };
    const executeOperation = nativeOperations[0]!;
    const rollbackOperation = {
      ...structuredClone(executeOperation),
      kind: "cleanup_empty_folder",
      toolName: "ue.asset.delete",
      sourceAssetPath: null,
      targetAssetPath: null,
      rollbackAction: "none",
      rollbackToolName: null,
    };
    const commonGuard = {
      changeSetId,
      runId,
      projectBindingId: registrationInput.projectBindingId,
      mcpBinding: registrationInput.mcpBinding,
      aggregateDryRunHash: aggregate.aggregateDryRunHash,
      aggregateArgsHash: aggregate.aggregateArgsHash,
      operationIndex: 0,
      operationCount: nativeOperations.length,
    };
    const execute = {
      ...structuredClone(context.guardRequests.execute),
      ...commonGuard,
      phase: "execute",
      operation: executeOperation,
    };
    const rollback = {
      ...structuredClone(context.guardRequests.rollback),
      ...commonGuard,
      phase: "rollback",
      operation: rollbackOperation,
    };
    const invalidPath = {
      ...structuredClone(context.guardRequests.invalidPath),
      editorSessionId: attachedSessionId,
      pidHash: effectiveAttachInput.pidHash,
      observedEditorSessionId: attachedSessionId,
      observedPidHash: effectiveAttachInput.pidHash,
    };
    const executeDryRun = dryRunPayloads[0]!;
    const dryRunHash = String(executeOperation.pluginDryRunHash ?? "");
    const mcpExecute = {
      toolName: executeDryRun.toolName,
      args: {
        ...executeDryRun.args,
        dryRun: false,
        execute: true,
        rollback: false,
        dryRunHash,
        approvalToken: null,
      },
    };
    const mcpRollback = {
      toolName: "ue.asset.delete",
      args: {
        changeSetId,
        runId,
        operationId: executeOperation.operationId,
        assetPath: runRoot,
        dryRun: false,
        execute: false,
        rollback: true,
        dryRunHash,
        approvalToken: null,
      },
    };
    return {
      registrationInput,
      guardRequests: { execute, rollback, invalidPath, mcpExecute, mcpRollback },
      setupCalls,
    };
  };
  const callObservedMcpMutation = async (
    template: Record<string, unknown> | undefined,
    guardResponse: Record<string, unknown>,
    binding: Mvp15dUiSessionBinding,
    registrationInput: Record<string, unknown>,
    phase: "execute" | "rollback",
  ): Promise<{ call: Mvp15dRawObservedCall; outcome: Record<string, unknown> }> => {
    if (!template || !adapter.callMvp15AssetTool) {
      throw new Error("mvp15d_mcp_asset_bridge_unavailable");
    }
    const toolName = String(template.toolName ?? "") as Mvp15McpAssetToolName;
    const templateArgs = template.args && typeof template.args === "object"
      ? template.args as Record<string, unknown>
      : null;
    if (!isMvp15AssetToolName(toolName) || !templateArgs) {
      throw new Error("mvp15d_negative_mcp_request_invalid");
    }
    const nativeFactKeys = [
      "acceptedPlanBinding",
      "nativeRegistrationId",
      "nativePhase",
      "nativeOperationIndex",
      "nativeOperationCount",
      "nativeCreatedAt",
      "connectionGeneration",
      "sessionGeneration",
      "nativeSourceIdentity",
      "nativeManifestIdentity",
      "nativePluginIdentity",
      "nativePackageIdentity",
    ] as const;
    const args: Record<string, unknown> = {
      ...structuredClone(templateArgs),
      changeSetId: registrationInput.changeSetId,
      runId: binding.runId,
      approvalToken: uiBindingState.get(binding.registrationId)?.approvalToken ?? null,
    };
    for (const key of nativeFactKeys) args[key] = guardResponse[key];
    const observationStart = mvp15dTransportObservations.length;
    const raw = await adapter.callMvp15AssetTool(toolName, args);
    const call = requireTransportObservation(
      mvp15dTransportObservations.slice(observationStart),
      "mcp_asset_tool_call",
    );
    const envelope = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : null;
    const nestedResult = envelope?.result && typeof envelope.result === "object" && !Array.isArray(envelope.result)
      ? envelope.result as Record<string, unknown>
      : null;
    const outcome = envelope?.structuredContent && typeof envelope.structuredContent === "object"
      && !Array.isArray(envelope.structuredContent)
      ? envelope.structuredContent as Record<string, unknown>
      : nestedResult?.structuredContent && typeof nestedResult.structuredContent === "object"
        && !Array.isArray(nestedResult.structuredContent)
        ? nestedResult.structuredContent as Record<string, unknown>
        : null;
    const expectedStatus = phase === "execute" ? "executed" : "rolled_back";
    if (
      !outcome ||
      outcome.blocked !== false ||
      outcome.status !== expectedStatus ||
      outcome.reasonCode !== "none" ||
      outcome.phase !== phase ||
      outcome.toolName !== toolName ||
      outcome.changeSetId !== registrationInput.changeSetId ||
      outcome.runId !== binding.runId ||
      outcome.operationId !== guardResponse.operationId ||
      outcome.sideEffectObserved !== true ||
      outcome.effectState !== "known_effect" ||
      outcome.implementationStatus !== "execution_capable" ||
      typeof outcome.evidenceId !== "string" ||
      !outcome.evidenceId
    ) {
      throw new Error(`mvp15d_negative_mcp_${phase}_outcome_invalid`);
    }
    return { call, outcome };
  };
  const releaseManagedProcess = async (managedProcess: {
    taskId: string;
    phase: string;
    processId: string;
    pid: number;
    processCreationFiletime: string;
  }): Promise<Mvp15dRawObservedCall> => {
    const request = {
      schemaVersion: "uagent.mvp15d.managed-editor-process-release.v2",
      ...managedProcess,
    };
    const released = await invokeObservedNative("release_managed_editor_process", request);
    if (
      released.response.schemaVersion !== "uagent.mvp15d.managed-editor-process-release-result.v2" ||
      released.response.status !== "released" ||
      released.response.reason !== "task_owned_process_released" ||
      released.response.ownerTaskId !== managedProcess.taskId ||
      released.response.ownerPhase !== managedProcess.phase ||
      released.response.processId !== managedProcess.processId ||
      released.response.pid !== managedProcess.pid ||
      released.response.processCreationFiletime !== managedProcess.processCreationFiletime
    ) {
      throw new Error("mvp15d_ui_managed_process_release_failed");
    }
    return released.reference;
  };
  const productionUiObservationPort: Mvp15dUiObservationPort = {
    beginRenderedNegativeCase: async (caseId, context) => {
      const control = await observeNativeState("rendered_control", {
        caseId,
        controlId: `mvp15d-negative-${caseId.toLowerCase()}`,
      });
      if (caseId !== "N1" && caseId !== "N2") {
        const binding = await productionUiObservationPort.beginSession({
          ...context,
          caseId,
          renderedNegative: true,
        });
        const state = uiBindingState.get(binding.registrationId);
        if (!state) throw new Error("mvp15d_ui_negative_binding_unavailable");
        state.negativeCaseId = caseId;
        state.renderedControlCall = control.call;
        binding.renderedControlCall = control.call;
        return binding;
      }

      const identitySuffix = globalThis.crypto.randomUUID();
      const registrationInput: Record<string, unknown> = {
        ...structuredClone(context.registrationInput),
        changeSetId: `${String(context.registrationInput.changeSetId ?? "negative-change")}:${identitySuffix}`,
      };
      const attemptId = `asset-approval-attempt:${identitySuffix}`;
      const binding: Mvp15dUiSessionBinding = {
        sessionId: `rendered-negative-session:${identitySuffix}`,
        nativeSessionId: `rendered-negative-native:${identitySuffix}`,
        runId: String(registrationInput.runId),
        registrationId: attemptId,
        sessionBegin: control.call,
        registrationCall: { receiptId: "", request: {} },
        sessionSetupCalls: [],
        renderedControlCall: control.call,
      };
      uiBindingState.set(attemptId, {
        approvalToken: null,
        attachInput: structuredClone(context.attachInput),
        registrationInput,
        guardRequests: structuredClone(context.guardRequests),
        processId: "",
        observationGeneration: 0,
        managedProcess: null,
        negativeCaseId: caseId,
        renderedControlCall: control.call,
      });
      return binding;
    },
    beginSession: async ({ caseId, renderedNegative, attachInput, registrationInput, guardRequests }) => {
      const authority = fixedObservationAuthority;
      if (!authority || authority.phase !== "ui-lifecycle") {
        throw new Error("mvp15d_ui_authority_port_unavailable");
      }
      if (mcpState.status === "connected" && !currentMvp15dMcpSessionId) {
        await adapter.discoverMcp();
      } else if (!currentMvp15dMcpSessionId || mcpState.status !== "connected") {
        await adapter.connectMcp();
        await adapter.discoverMcp();
      }
      if (!mvp15DForwardAuthorityIsReady()) {
        const attestation = lastMvp15dNativeAttestation?.request;
        if (!attestation) throw new Error("mvp15d_ui_attestation_context_missing");
        await refreshMvp15DCompanionAttestation(
          String(attestation.trustedRootId ?? ""),
          String(attestation.editorSessionId ?? ""),
        );
      }
      if (!currentMvp15dMcpSessionId) throw new Error("mvp15d_ui_mcp_session_unavailable");
      const sessionSetupCalls: Mvp15dRawObservedCall[] = [];
      let effectiveAttachInput = structuredClone(attachInput);
      let managedProcess: {
        taskId: string;
        phase: string;
        processId: string;
        pid: number;
        processCreationFiletime: string;
      } | null = null;
      try {
        if (caseId === "N4") {
          if (!nativeInvoke) throw new Error("mvp15d_native_observation_unavailable");
          const createRequest = {
            schemaVersion: "uagent.mvp15d.managed-editor-process-create.v2",
            purpose: "negative_case_fixture",
            taskId: authority.taskId,
            phase: authority.phase,
            projectId: attachInput.projectId,
            rootRef: resolveNativeEditorRootRef(attachInput.rootRef),
            uprojectRelativePath: attachInput.uprojectRelativePath,
          };
          const createResponse = await nativeInvoke<Record<string, unknown>>(
            "create_managed_editor_process",
            { input: createRequest },
          );
          const process = createResponse.process && typeof createResponse.process === "object"
            ? createResponse.process as Record<string, unknown>
            : null;
          const processPid = Number(createResponse.processPid ?? 0);
          const processCreationFiletime = createResponse.processCreationFiletime;
          if (
            process &&
            typeof process.id === "string" &&
            Number.isSafeInteger(processPid) && processPid > 0 &&
            isMvp15dCreationFiletime(processCreationFiletime)
          ) {
            managedProcess = {
              taskId: authority.taskId,
              phase: authority.phase,
              processId: process.id,
              pid: processPid,
              processCreationFiletime,
            };
          }
          const createReference = nativeReceiptReference({
            request: createRequest,
            response: createResponse,
          });
          if (
            createResponse.schemaVersion !== "uagent.mvp15d.managed-editor-process-create-result.v2" ||
            createResponse.status !== "created" ||
            createResponse.reason !== "task_owned_process_started" ||
            createResponse.purpose !== "negative_case_fixture" ||
            createResponse.ownerTaskId !== authority.taskId ||
            createResponse.ownerPhase !== authority.phase ||
            !process ||
            typeof process.id !== "string" ||
            typeof process.pidHash !== "string" ||
            process.source !== "managed" ||
            !managedProcess
          ) {
            throw new Error("mvp15d_ui_managed_process_create_failed");
          }
          sessionSetupCalls.push(createReference);
          effectiveAttachInput = {
            ...effectiveAttachInput,
            processId: process.id,
            pidHash: process.pidHash,
            processDisplayName: process.displayName,
            mode: "managed",
          };
        }
        const nativeAttachInput = {
          ...effectiveAttachInput,
          rootRef: resolveNativeEditorRootRef(effectiveAttachInput.rootRef),
        };
        const attached = await invokeObservedNative("attach_editor_process", nativeAttachInput);
        const sessionId = String(attached.response.sessionId ?? "");
        const processId = String(attached.response.processId ?? "");
        const observationGeneration = Number(attached.response.observationGeneration ?? 0);
        if (
          attached.response.status !== "attached" ||
          !sessionId ||
          !processId ||
          !Number.isSafeInteger(observationGeneration) ||
          observationGeneration <= 0 ||
          processId !== String(effectiveAttachInput.processId ?? "") ||
          attached.response.pidHash !== effectiveAttachInput.pidHash
        ) {
          throw new Error("mvp15d_ui_observation_session_begin_failed");
        }
        const identitySuffix = globalThis.crypto.randomUUID();
        let nextRegistrationInput: Record<string, unknown> = {
          ...structuredClone(registrationInput),
          changeSetId: `${String(registrationInput.changeSetId ?? "change-set")}-${identitySuffix}`,
          runId: registrationInput.runId,
          editorSessionId: sessionId,
          mcpBinding: currentMvp15McpBinding?.identity ?? "",
        };
        let nextGuardRequests = structuredClone(guardRequests);
        if (caseId && renderedNegative) {
          const prepared = await prepareIndependentNegativeRegistration(
            caseId,
            { attachInput, registrationInput, guardRequests },
            sessionId,
            effectiveAttachInput,
            identitySuffix,
          );
          nextRegistrationInput = prepared.registrationInput;
          nextGuardRequests = prepared.guardRequests;
          sessionSetupCalls.push(...prepared.setupCalls);
        }
        const registered = await invokeObservedNative(
          "register_asset_mutation_approval",
          nextRegistrationInput,
        );
        const registrationId = String(registered.response.registrationId ?? "");
        if (registered.response.status !== "registered" || !registrationId) {
          throw new Error("mvp15d_ui_registration_failed");
        }
        uiBindingState.set(registrationId, {
          approvalToken: typeof registered.response.approvalToken === "string"
            ? registered.response.approvalToken
            : null,
          attachInput: structuredClone(effectiveAttachInput),
          registrationInput: nextRegistrationInput,
          guardRequests: nextGuardRequests,
          processId,
          observationGeneration,
          managedProcess,
          negativeCaseId: caseId ?? null,
          renderedControlCall: null,
        });
        return {
          sessionId,
          nativeSessionId: currentMvp15dMcpSessionId,
          runId: String(nextRegistrationInput.runId),
          registrationId,
          sessionBegin: attached.reference,
          registrationCall: registered.reference,
          sessionSetupCalls,
        };
      } catch (error) {
        if (managedProcess) await releaseManagedProcess(managedProcess);
        throw error;
      }
    },
    snapshotContent: async (binding, stage) => {
      const state = uiBindingState.get(binding.registrationId);
      if (state?.negativeCaseId === "N1" || state?.negativeCaseId === "N2") {
        const observation = await observeNativeState("project_content_manifest", {
          caseId: state.negativeCaseId,
          stage,
          attemptId: binding.registrationId,
          runId: binding.runId,
        });
        return {
          stage,
          registrationId: binding.registrationId,
          runId: binding.runId,
          receiptId: observation.call.receiptId,
          request: observation.call.request,
        };
      }
      const request = { registrationId: binding.registrationId };
      const observation = await invokeObservedNative("snapshot_mvp15_asset_content_manifest", request);
      return {
        stage,
        registrationId: binding.registrationId,
        runId: binding.runId,
        receiptId: observation.reference.receiptId,
        request,
      };
    },
    readCounters: async (binding, stage) => {
      const state = uiBindingState.get(binding.registrationId);
      if (!state) throw new Error("mvp15d_ui_counter_source_unavailable");
      const request = { registrationId: binding.registrationId, runId: binding.runId, stage };
      const observation = await observeNativeState("mutation_counters", request);
      const rawValues = observation.observation.values;
      if (!Array.isArray(rawValues) || rawValues.length !== 5 || rawValues.some((value) => !Number.isSafeInteger(value))) {
        throw new Error("mvp15d_ui_counter_source_invalid");
      }
      return { values: [...rawValues] as Mvp15dCounterVector, receipt: observation.call };
    },
    guard: async ({ caseId, api, ...binding }) => {
      const state = uiBindingState.get(binding.registrationId);
      if (!state) {
        throw new Error("mvp15d_ui_guard_request_unavailable");
      }
      if (caseId === "N1" || caseId === "N2") {
        const registration = caseId === "N1"
          ? await invokeObservedNative("register_asset_mutation_approval", state.registrationInput)
          : await invokeObservedNative("mvp15d_bridge_run_gate_off_child", {
              caseId,
              registrationInput: state.registrationInput,
            });
        if (
          registration.response.status !== "blocked" ||
          registration.response.reason !== (caseId === "N1" ? "untrusted_root" : "feature_disabled") ||
          String(registration.response.registrationId ?? "") !== "" ||
          registration.response.approvalToken != null ||
          (caseId === "N2" && (
            registration.response.uiGateEnabled !== true ||
            registration.response.registrationCount !== 0 ||
            registration.response.tokenCount !== 0 ||
            registration.response.mcpMutationCount !== 0 ||
            registration.response.manifestOwnershipCount !== 0 ||
            registration.response.childClosed !== true ||
            registration.response.childCleanupComplete !== true ||
            registration.response.processResidualCount !== 0 ||
            registration.response.portResidualCount !== 0 ||
            registration.response.rootResidualCount !== 0
          ))
        ) {
          throw new Error(`mvp15d_ui_${caseId.toLowerCase()}_registration_semantics_invalid`);
        }
        const ownership = caseId === "N1"
          ? await observeNativeState("approval_ownership", { caseId, stage: "post_attempt" })
          : null;
        const ownershipValues = ownership?.observation ?? registration.response;
        if (
          ownershipValues.registrationCount !== 0 ||
          ownershipValues.tokenCount !== 0 ||
          ownershipValues.mcpMutationCount !== 0 ||
          ownershipValues.manifestOwnershipCount !== 0
        ) {
          throw new Error(`mvp15d_ui_${caseId.toLowerCase()}_ownership_not_empty`);
        }
        binding.registrationCall = registration.reference;
        return {
          guardCall: registration.reference,
          setupCalls: [],
          cleanupCalls: ownership ? [ownership.call] : [],
          registrationCount: Number(ownershipValues.registrationCount),
          tokenCount: Number(ownershipValues.tokenCount),
          mcpMutationCount: Number(ownershipValues.mcpMutationCount),
          manifestOwnershipCount: Number(ownershipValues.manifestOwnershipCount),
        };
      }
      const template = caseId === "N2" || caseId === "N6"
        ? state.guardRequests.invalidPath
        : caseId === "N8"
          ? state.guardRequests.rollback
          : state.guardRequests.execute;
      let request: Record<string, unknown> = api === "dry_run_asset_mutation"
        ? structuredClone(template)
        : {
            ...structuredClone(template),
            registrationId: binding.registrationId,
            approvalToken: state.approvalToken,
            changeSetId: state.registrationInput.changeSetId,
            runId: binding.runId,
            mcpBinding: state.registrationInput.mcpBinding,
          };
      const setupCalls: Mvp15dRawObservedCall[] = [];
      if (caseId === "N1") {
        const retraction = retractNativeMvp15DApprovals(true, false);
        if (!retraction) throw new Error("mvp15d_ui_attestation_retraction_unavailable");
        await retraction.settled;
        setupCalls.push(nativeReceiptReference(lastMvp15dNativeRetraction));
      } else if (caseId === "N2") {
        request = { toolName: String(request.toolName ?? "ue.asset.create_folder") };
      } else if (caseId === "N3") {
        setupCalls.push((await invokeObservedNative(
          "stop_editor_observation_session",
          { sessionId: binding.sessionId },
        )).reference);
      } else if (caseId === "N4") {
        try {
          const terminated = await invokeObservedNative(
            "terminate_managed_editor_process",
            { sessionId: binding.sessionId },
          );
          if (
            terminated.response.status !== "degraded" ||
            terminated.response.reason !== "process_exited" ||
            terminated.response.sessionId !== binding.sessionId ||
            terminated.response.processId !== state.processId
          ) {
            throw new Error("mvp15d_ui_managed_process_termination_failed");
          }
          state.managedProcess = null;
          setupCalls.push(terminated.reference);
        } catch (error) {
          if (state.managedProcess) {
            await releaseManagedProcess(state.managedProcess);
            state.managedProcess = null;
          }
          throw error;
        }
      } else if (caseId === "N5") {
        const successor = await invokeObservedNative("attach_editor_process", {
          ...state.attachInput,
          rootRef: resolveNativeEditorRootRef(state.attachInput.rootRef),
        });
        const successorGeneration = Number(successor.response.observationGeneration ?? 0);
        if (
          successor.response.status !== "attached" ||
          successor.response.processId !== state.processId ||
          successor.response.sessionId === binding.sessionId ||
          !Number.isSafeInteger(successorGeneration) ||
          successorGeneration <= state.observationGeneration
        ) {
          throw new Error("mvp15d_ui_observation_generation_replacement_failed");
        }
        setupCalls.push(successor.reference);
      } else if (caseId === "N7") {
        const first = await invokeObservedNative("execute_asset_mutation", request);
        if (
          first.response.status !== "accepted_by_native_guard" ||
          first.response.registrationId !== binding.registrationId ||
          first.response.phase !== "execute"
        ) {
          throw new Error("mvp15d_ui_execute_setup_rejected");
        }
        setupCalls.push(first.reference);
        const operationId = String(first.response.operationId ?? (request.operation as { operationId?: unknown })?.operationId ?? "");
        const mcp = await callObservedMcpMutation(
          state.guardRequests.mcpExecute,
          first.response,
          binding,
          state.registrationInput,
          "execute",
        );
        setupCalls.push(mcp.call);
        const outcome = await invokeObservedNative("record_asset_mutation_outcome", {
          registrationId: binding.registrationId,
          phase: "execute",
          operationId,
          success: true,
          sideEffectObserved: mcp.outcome.sideEffectObserved,
          effectState: mcp.outcome.effectState,
          rollbackAvailable: mcp.outcome.rollbackAvailable,
          evidenceId: mcp.outcome.evidenceId,
          reasonCode: mcp.outcome.reasonCode,
        });
        if (
          outcome.response.status !== "recorded" ||
          outcome.response.registrationId !== binding.registrationId ||
          outcome.response.phase !== "execute" ||
          outcome.response.operationId !== operationId
        ) {
          throw new Error("mvp15d_ui_execute_outcome_not_recorded");
        }
        setupCalls.push(outcome.reference);
        request.approvalToken = null;
      } else if (caseId === "N8") {
        const executeRequest: Record<string, unknown> = {
          ...structuredClone(state.guardRequests.execute),
          registrationId: binding.registrationId,
          approvalToken: state.approvalToken,
          changeSetId: state.registrationInput.changeSetId,
          runId: binding.runId,
          mcpBinding: state.registrationInput.mcpBinding,
        };
        const execute = await invokeObservedNative("execute_asset_mutation", executeRequest);
        if (
          execute.response.status !== "accepted_by_native_guard" ||
          execute.response.registrationId !== binding.registrationId ||
          execute.response.phase !== "execute"
        ) {
          throw new Error("mvp15d_ui_execute_setup_rejected");
        }
        setupCalls.push(execute.reference);
        const executeOperationId = String(execute.response.operationId ?? (executeRequest.operation as { operationId?: unknown })?.operationId ?? "");
        const executeMcp = await callObservedMcpMutation(
          state.guardRequests.mcpExecute,
          execute.response,
          binding,
          state.registrationInput,
          "execute",
        );
        setupCalls.push(executeMcp.call);
        const executeOutcome = await invokeObservedNative("record_asset_mutation_outcome", {
          registrationId: binding.registrationId,
          phase: "execute",
          operationId: executeOperationId,
          success: true,
          sideEffectObserved: executeMcp.outcome.sideEffectObserved,
          effectState: executeMcp.outcome.effectState,
          rollbackAvailable: executeMcp.outcome.rollbackAvailable,
          evidenceId: executeMcp.outcome.evidenceId,
          reasonCode: executeMcp.outcome.reasonCode,
        });
        if (
          executeOutcome.response.status !== "recorded" ||
          executeOutcome.response.registrationId !== binding.registrationId ||
          executeOutcome.response.phase !== "execute" ||
          executeOutcome.response.operationId !== executeOperationId
        ) {
          throw new Error("mvp15d_ui_execute_outcome_not_recorded");
        }
        setupCalls.push(executeOutcome.reference);
        request.approvalToken = null;
        const firstRollback = await invokeObservedNative("rollback_asset_mutation", request);
        if (
          firstRollback.response.status !== "accepted_by_native_guard" ||
          firstRollback.response.registrationId !== binding.registrationId ||
          firstRollback.response.phase !== "rollback"
        ) {
          throw new Error("mvp15d_ui_rollback_setup_rejected");
        }
        setupCalls.push(firstRollback.reference);
        const rollbackOperationId = String(firstRollback.response.operationId ?? (request.operation as { operationId?: unknown })?.operationId ?? "");
        const rollbackMcp = await callObservedMcpMutation(
          state.guardRequests.mcpRollback,
          firstRollback.response,
          binding,
          state.registrationInput,
          "rollback",
        );
        setupCalls.push(rollbackMcp.call);
        const rollbackOutcome = await invokeObservedNative("record_asset_mutation_outcome", {
          registrationId: binding.registrationId,
          phase: "rollback",
          operationId: rollbackOperationId,
          success: true,
          sideEffectObserved: rollbackMcp.outcome.sideEffectObserved,
          effectState: rollbackMcp.outcome.effectState,
          rollbackAvailable: rollbackMcp.outcome.rollbackAvailable,
          evidenceId: rollbackMcp.outcome.evidenceId,
          reasonCode: rollbackMcp.outcome.reasonCode,
        });
        if (
          rollbackOutcome.response.status !== "recorded" ||
          rollbackOutcome.response.registrationId !== binding.registrationId ||
          rollbackOutcome.response.phase !== "rollback" ||
          rollbackOutcome.response.operationId !== rollbackOperationId
        ) {
          throw new Error("mvp15d_ui_rollback_outcome_not_recorded");
        }
        setupCalls.push(rollbackOutcome.reference);
      }
      const observation = await invokeObservedNative(api, request);
      const cleanupCalls: Mvp15dRawObservedCall[] = [];
      if (caseId === "N7") {
        const rollbackRequest: Record<string, unknown> = {
          ...structuredClone(state.guardRequests.rollback),
          registrationId: binding.registrationId,
          approvalToken: null,
          changeSetId: state.registrationInput.changeSetId,
          runId: binding.runId,
          mcpBinding: state.registrationInput.mcpBinding,
        };
        const rollback = await invokeObservedNative("rollback_asset_mutation", rollbackRequest);
        const operationId = String(
          rollback.response.operationId ??
            (rollbackRequest.operation as { operationId?: unknown })?.operationId ??
            "",
        );
        if (
          rollback.response.status !== "accepted_by_native_guard" ||
          rollback.response.registrationId !== binding.registrationId ||
          rollback.response.phase !== "rollback" ||
          !operationId
        ) {
          throw new Error("mvp15d_ui_execute_replay_cleanup_guard_rejected");
        }
        cleanupCalls.push(rollback.reference);
        const rollbackMcp = await callObservedMcpMutation(
          state.guardRequests.mcpRollback,
          rollback.response,
          binding,
          state.registrationInput,
          "rollback",
        );
        cleanupCalls.push(rollbackMcp.call);
        const rollbackOutcome = await invokeObservedNative("record_asset_mutation_outcome", {
          registrationId: binding.registrationId,
          phase: "rollback",
          operationId,
          success: true,
          sideEffectObserved: rollbackMcp.outcome.sideEffectObserved,
          effectState: rollbackMcp.outcome.effectState,
          rollbackAvailable: rollbackMcp.outcome.rollbackAvailable,
          evidenceId: rollbackMcp.outcome.evidenceId,
          reasonCode: rollbackMcp.outcome.reasonCode,
        });
        if (
          rollbackOutcome.response.status !== "recorded" ||
          rollbackOutcome.response.registrationId !== binding.registrationId ||
          rollbackOutcome.response.phase !== "rollback" ||
          rollbackOutcome.response.operationId !== operationId
        ) {
          throw new Error("mvp15d_ui_execute_replay_cleanup_outcome_not_recorded");
        }
        cleanupCalls.push(rollbackOutcome.reference);
      }
      return {
        guardCall: observation.reference,
        setupCalls,
        cleanupCalls,
        mcpMutationCount: caseId === "N7" || caseId === "N8" ? 2 : 0,
      };
    },
    runPartialOperation: async (binding, operation) => {
      const authority = fixedObservationAuthority;
      const state = uiBindingState.get(binding.registrationId);
      if (!authority || !state) throw new Error("mvp15d_partial_operation_source_unavailable");
      const request: Record<string, unknown> = {
        ...structuredClone(operation.request),
        registrationId: binding.registrationId,
        approvalToken: state.approvalToken,
        changeSetId: state.registrationInput.changeSetId,
        runId: binding.runId,
        editorSessionId: binding.sessionId,
        mcpBinding: state.registrationInput.mcpBinding,
      };
      let receipt: Mvp15dRawObservedCall;
      const setupCalls: Mvp15dRawObservedCall[] = [];
      if (operation.api === "mcp_asset_tool_call") {
        const toolName = String(request.toolName ?? "") as Mvp15McpAssetToolName;
        const args = request.args && typeof request.args === "object"
          ? request.args as Record<string, unknown>
          : {};
        if (!adapter.callMvp15AssetTool) throw new Error("mvp15d_mcp_asset_bridge_unavailable");
        const observationStart = mvp15dTransportObservations.length;
        await adapter.callMvp15AssetTool(toolName, args);
        receipt = requireTransportObservation(
          mvp15dTransportObservations.slice(observationStart),
          "mcp_asset_tool_call",
        );
      } else {
        if (operation.action === "cross_ttl" || operation.action === "second_rollback") {
          const attached = await invokeObservedNative("attach_editor_process", {
            ...state.attachInput,
            rootRef: resolveNativeEditorRootRef(state.attachInput.rootRef),
          });
          setupCalls.push(attached.reference);
          const freshSessionId = String(attached.response.sessionId ?? "");
          const freshGeneration = Number(attached.response.observationGeneration ?? 0);
          if (
            attached.response.status !== "attached" ||
            !freshSessionId ||
            freshSessionId === binding.sessionId ||
            attached.response.processId !== state.processId ||
            !Number.isSafeInteger(freshGeneration) ||
            freshGeneration <= state.observationGeneration
          ) {
            throw new Error("mvp15d_partial_control_session_failed");
          }
          const identitySuffix = globalThis.crypto.randomUUID();
          const freshRegistrationInput = {
            ...structuredClone(state.registrationInput),
            changeSetId: `${String(state.registrationInput.changeSetId ?? "change-set")}:${identitySuffix}`,
            runId: state.registrationInput.runId,
            editorSessionId: freshSessionId,
            mcpBinding: currentMvp15McpBinding?.identity ?? "",
          };
          const registered = await invokeObservedNative(
            "register_asset_mutation_approval",
            freshRegistrationInput,
          );
          setupCalls.push(registered.reference);
          const freshRegistrationId = String(registered.response.registrationId ?? "");
          const freshApprovalToken = typeof registered.response.approvalToken === "string"
            ? registered.response.approvalToken
            : null;
          if (registered.response.status !== "registered" || !freshRegistrationId || !freshApprovalToken) {
            throw new Error("mvp15d_partial_control_registration_failed");
          }
          request.registrationId = freshRegistrationId;
          request.approvalToken = freshApprovalToken;
          request.changeSetId = freshRegistrationInput.changeSetId;
          request.runId = freshRegistrationInput.runId;
          request.editorSessionId = freshSessionId;
          request.mcpBinding = freshRegistrationInput.mcpBinding;
        }
        if (operation.action === "cross_ttl") {
          const wait = options?.mvp15dAdvanceClock
            ?? ((milliseconds: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, milliseconds)));
          await wait(70_000);
        }
        if (operation.action === "second_rollback") {
          const executeRequest: Record<string, unknown> = {
            ...structuredClone(state.guardRequests.execute),
            registrationId: request.registrationId,
            approvalToken: request.approvalToken,
            changeSetId: request.changeSetId,
            runId: request.runId,
            editorSessionId: request.editorSessionId,
            mcpBinding: request.mcpBinding,
          };
          const execute = await invokeObservedNative("execute_asset_mutation", executeRequest);
          const executeOperationId = String(
            execute.response.operationId ??
              (executeRequest.operation as { operationId?: unknown })?.operationId ??
              "",
          );
          if (
            execute.response.status !== "accepted_by_native_guard" ||
            execute.response.registrationId !== request.registrationId ||
            execute.response.phase !== "execute" ||
            !executeOperationId
          ) {
            throw new Error("mvp15d_partial_execute_setup_rejected");
          }
          setupCalls.push(execute.reference);
          const executeOutcome = await invokeObservedNative("record_asset_mutation_outcome", {
            registrationId: String(request.registrationId ?? ""),
            phase: "execute",
            operationId: executeOperationId,
            success: true,
            sideEffectObserved: true,
            effectState: "known_effect",
            rollbackAvailable: true,
            evidenceId: String(execute.response.evidenceId ?? "native-partial-execute"),
            reasonCode: null,
          });
          if (
            executeOutcome.response.status !== "recorded" ||
            executeOutcome.response.registrationId !== request.registrationId ||
            executeOutcome.response.phase !== "execute" ||
            executeOutcome.response.operationId !== executeOperationId
          ) {
            throw new Error("mvp15d_partial_execute_outcome_not_recorded");
          }
          setupCalls.push(executeOutcome.reference);
          request.approvalToken = null;
          const firstRollback = await invokeObservedNative(operation.api, request);
          if (
            firstRollback.response.status !== "accepted_by_native_guard" ||
            firstRollback.response.registrationId !== request.registrationId ||
            firstRollback.response.phase !== "rollback"
          ) {
            throw new Error("mvp15d_partial_rollback_setup_rejected");
          }
          setupCalls.push(firstRollback.reference);
          const operationId = String(
            firstRollback.response.operationId ?? (request.operation as { operationId?: unknown })?.operationId ?? "",
          );
          const rollbackOutcome = await invokeObservedNative("record_asset_mutation_outcome", {
            registrationId: String(request.registrationId ?? ""),
            phase: "rollback",
            operationId,
            success: true,
            sideEffectObserved: true,
            effectState: "known_effect",
            rollbackAvailable: false,
            evidenceId: String(firstRollback.response.evidenceId ?? "native-partial-rollback"),
            reasonCode: null,
          });
          if (
            rollbackOutcome.response.status !== "recorded" ||
            rollbackOutcome.response.registrationId !== request.registrationId ||
            rollbackOutcome.response.phase !== "rollback" ||
            rollbackOutcome.response.operationId !== operationId
          ) {
            throw new Error("mvp15d_partial_rollback_outcome_not_recorded");
          }
          setupCalls.push(rollbackOutcome.reference);
        }
        const observation = await invokeObservedNative(operation.api, request);
        if (
          operation.action === "second_rollback" &&
          (observation.response.status !== "blocked" || observation.response.reason !== "rollback_replay")
        ) {
          throw new Error("mvp15d_partial_second_rollback_not_replay");
        }
        receipt = observation.reference;
      }
      return {
        ...operation,
        receiptId: receipt.receiptId,
        request: structuredClone(receipt.request),
        setupCalls,
      };
    },
    stopObservation: async (binding) => {
      const state = uiBindingState.get(binding.registrationId);
      if (state?.negativeCaseId === "N1" || state?.negativeCaseId === "N2") {
        const observation = await observeNativeState("negative_closeout", {
          caseId: state.negativeCaseId,
          stage: "observation_stop",
          attemptId: binding.registrationId,
        });
        return observation.call;
      }
      const observation = await invokeObservedNative("stop_editor_observation_session", {
        sessionId: binding.sessionId,
      });
      return observation.reference;
    },
    disconnectMcp: async (binding) => {
      const state = uiBindingState.get(binding.registrationId);
      if (state?.negativeCaseId === "N1" || state?.negativeCaseId === "N2") {
        const observation = await observeNativeState("negative_closeout", {
          caseId: state.negativeCaseId,
          stage: "mcp_closed",
          attemptId: binding.registrationId,
        });
        uiBindingState.delete(binding.registrationId);
        return observation.call;
      }
      const request = { mcpSessionId: binding.nativeSessionId };
      const observationStart = mvp15dTransportObservations.length;
      await disconnectMcpAndWait();
      if (mcpState.status !== "disconnected") throw new Error("mvp15d_ui_disconnect_failed");
      const call = requireTransportObservation(
        mvp15dTransportObservations.slice(observationStart),
        "mcp_disconnect",
      );
      if (call.request.sessionId !== request.mcpSessionId) {
        throw new Error(
          `mvp15d_ui_disconnect_session_mismatch:${String(call.request.sessionId)}:${request.mcpSessionId}`,
        );
      }
      return call;
    },
  };

  const disconnectMcpAndWait = async (): Promise<void> => {
    mcpDiscoveryGeneration = nextMcpDiscoveryGeneration(mcpDiscoveryGeneration);
    const disconnectGeneration = mcpDiscoveryGeneration;
    const previousSession = currentSession;
    currentMvp15dMcpSessionId = null;
    currentSession = null;
    const nativeRetraction = retractMcpPublication("disconnect");
    if (nativeRetraction) await nativeRetraction;
    await waitForMvp15DNativeRetractions();
    let closeError: unknown = null;
    try {
      await previousSession?.disconnect();
    } catch (error) {
      closeError = error;
    }
    if (disconnectGeneration === mcpDiscoveryGeneration) {
      mcpState = {
        ...mcpState,
        status: "disconnected",
        protocolVersion: null,
        serverInfo: null,
        capabilities: null,
        lastError: closeError instanceof Error ? closeError.message : null,
        legacyMode: false,
      };
      syncMcp();
      syncSnapshot();
    }
    if (closeError) throw closeError;
  };

  const adapter: DesktopRuntimeAdapter = {
    getSnapshot: () => router.getSnapshot(),
    getMcpState: () => mcpState,
    getMcpDiscovery: () => currentDiscovery,
    getMvp15AssetTools: () => getMvp15AssetTools(currentDiscovery, currentMvp15FacadeTools),
    getMvp15LiveAssetToolsetFingerprint: () => currentMvp15Fingerprint,
    getMvp15DCompanionStatus: () => currentMvp15DCompanionStatus,
    getMvp15DLiveCompanionFingerprint: () => currentMvp15DCompanionFingerprint,
    getMvp15DProductRetractionEvidence: () =>
      mvp15DProductRetractions.map((record) => ({ ...record })),
    getMvp15dProductObservationPort: () =>
      fixedObservationAuthority?.phase === "product-capture"
        ? productionProductObservationPort
        : (options?.mvp15dFixtureProductObservationPort ?? null),
    getMvp15dUiObservationPort: () =>
      fixedObservationAuthority?.phase === "ui-lifecycle"
        ? productionUiObservationPort
        : (options?.mvp15dFixtureUiObservationPort ?? null),
    activateMvp15dFixedObservationAuthority: async (input) => {
      if (
        !input.receiptLedgerEnabled ||
        !nativeInvoke ||
        !input.taskId ||
        !input.session ||
        input.generation <= 0 ||
        fixedObservationAuthority
      ) {
        throw new Error("mvp15d_fixed_observation_authority_rejected");
      }
      const authority = {
        taskId: input.taskId,
        phase: input.phase,
        session: input.session,
        generation: input.generation,
        predecessorWindowIdentitySha256: input.predecessorWindowIdentitySha256,
      };
      if (
        input.minimumMcpGeneration !== undefined &&
        (!Number.isSafeInteger(input.minimumMcpGeneration) || input.minimumMcpGeneration < 1)
      ) {
        throw new Error("mvp15d_fixed_observation_authority_rejected");
      }
      if (
        (input.minimumMcpGeneration !== undefined) !==
          (input.predecessorWindowIdentitySha256 !== undefined) ||
        (input.predecessorWindowIdentitySha256 !== undefined &&
          !/^[0-9a-f]{64}$/.test(input.predecessorWindowIdentitySha256))
      ) {
        throw new Error("mvp15d_fixed_observation_authority_rejected");
      }
      if (input.minimumMcpGeneration !== undefined) {
        mcpDiscoveryGeneration = Math.max(mcpDiscoveryGeneration, input.minimumMcpGeneration);
      }
      fixedObservationAuthority = authority;
      if (currentMvp15dMcpSessionId?.startsWith("ordinary-mcp:")) {
        currentMvp15dMcpSessionId = null;
      }
      try {
        pendingRendererInstanceReceipt = (
          await observeNativeState("renderer_process", {
            reason: "fixed_app_activation",
            taskId: input.taskId,
          })
        ).call;
      } catch (error) {
        fixedObservationAuthority = null;
        throw error;
      }
    },
    resumeMvp15dProductAuthority: async (handoffId, endpoint) => {
      const authority = fixedObservationAuthority;
      const rendererAfter = pendingRendererInstanceReceipt;
      if (
        !authority ||
        authority.phase !== "product-capture" ||
        !nativeInvoke ||
        !rendererAfter ||
        !handoffId.startsWith("renderer-handoff:") ||
        !authority.predecessorWindowIdentitySha256
      ) {
        throw new Error("mvp15d_renderer_successor_authority_unavailable");
      }
      pendingRendererInstanceReceipt = null;
      adapter.setMcpEndpoint(endpoint);
      if (mcpState.status !== "connected" || !currentMvp15dMcpSessionId) {
        await adapter.connectMcp();
        await adapter.discoverMcp();
      }
      if (!currentMvp15dMcpSessionId || mcpState.status !== "connected") {
        throw new Error("mvp15d_renderer_successor_mcp_unavailable");
      }
      const claimInput = {
        schemaVersion: "uagent.mvp15d.renderer-restart-claim.v3",
        handoffId,
        taskId: authority.taskId,
        phase: authority.phase,
        predecessorWindowIdentitySha256: authority.predecessorWindowIdentitySha256,
        rendererAfter,
        successorMcpSessionId: currentMvp15dMcpSessionId,
        successorMcpGeneration: mcpDiscoveryGeneration,
      };
      const claim = await nativeInvoke<{
        schemaVersion?: string;
        handoffId?: string;
        claimReceiptId?: string;
        requestReceiptId?: string;
        requestReceiptRequest?: Record<string, unknown>;
        parentAcknowledgementReceiptId?: string;
        parentAcknowledgementReceiptRequest?: Record<string, unknown>;
        parentAcknowledgementReceiptSequence?: number;
        claimReceiptRequest?: Record<string, unknown>;
        segment?: Record<string, unknown>;
        predecessorWindow?: Record<string, unknown>;
      }>("mvp15d_bridge_claim_renderer_restart", { input: claimInput });
      const predecessorWindow = claim.predecessorWindow;
      const acknowledgementWindow = claim.parentAcknowledgementReceiptRequest
        ?.predecessorWindow as Record<string, unknown> | undefined;
      // serde_json::Value and struct responses can emit the same flat record in different key orders.
      const acknowledgementWindowMatches =
        !!predecessorWindow &&
        !!acknowledgementWindow &&
        Object.keys(predecessorWindow).length === Object.keys(acknowledgementWindow).length &&
        Object.entries(predecessorWindow).every(
          ([key, value]) => acknowledgementWindow[key] === value,
        );
      if (
        claim.schemaVersion !== "uagent.mvp15d.renderer-restart-claim-result.v3" ||
        claim.handoffId !== handoffId ||
        typeof claim.claimReceiptId !== "string" ||
        typeof claim.requestReceiptId !== "string" ||
        !claim.requestReceiptRequest ||
        typeof claim.parentAcknowledgementReceiptId !== "string" ||
        !claim.parentAcknowledgementReceiptId.startsWith("mvp15d-observation-receipt:") ||
        !claim.parentAcknowledgementReceiptRequest ||
        !Number.isSafeInteger(claim.parentAcknowledgementReceiptSequence) ||
        Number(claim.parentAcknowledgementReceiptSequence) <= 0 ||
        !claim.claimReceiptRequest ||
        !claim.segment ||
        !predecessorWindow ||
        !acknowledgementWindow ||
        predecessorWindow.schemaVersion !== "uagent.mvp15d.predecessor-window-identity.v1" ||
        predecessorWindow.status !== "observed" ||
        predecessorWindow.windowLabel !== "main" ||
        predecessorWindow.taskId !== authority.taskId ||
        predecessorWindow.phase !== authority.phase ||
        predecessorWindow.handoffId !== handoffId ||
        predecessorWindow.stableIdentitySha256 !== authority.predecessorWindowIdentitySha256 ||
        !acknowledgementWindowMatches ||
        claim.parentAcknowledgementReceiptRequest.schemaVersion !==
          "uagent.mvp15d.renderer-parent-lifecycle-acknowledgement.v2" ||
        claim.parentAcknowledgementReceiptRequest.handoffId !== handoffId ||
        claim.parentAcknowledgementReceiptRequest.taskId !== authority.taskId ||
        claim.parentAcknowledgementReceiptRequest.phase !== authority.phase ||
        claim.claimReceiptRequest.predecessorWindowIdentitySha256 !==
          authority.predecessorWindowIdentitySha256
      ) {
        throw new Error("mvp15d_renderer_successor_claim_rejected");
      }
      const discoveries = claim.segment.discoveries as Mvp15dProductDiscoveryRaw[];
      const retractions = claim.segment.retractions as Mvp15dProductRetractionRaw[];
      const mutationBefore = claim.segment.mutationBefore as Mvp15dMutationCounters;
      const readyDiscovery = claim.segment.readyDiscovery as Mvp15dProductDiscoveryRaw;
      if (
        !Array.isArray(discoveries) || discoveries.length !== 2 ||
        !Array.isArray(retractions) || retractions.length !== 3 ||
        !readyDiscovery || typeof readyDiscovery !== "object" ||
        !mutationBefore || typeof mutationBefore !== "object"
      ) {
        throw new Error("mvp15d_renderer_successor_segment_invalid");
      }
      const nativeTransition = retractNativeMvp15DApprovals(true, false);
      if (!nativeTransition) throw new Error("mvp15d_renderer_successor_retraction_unavailable");
      await nativeTransition.settled;
      const nativeRetraction = nativeReceiptReference(lastMvp15dNativeRetraction);
      const transition = await observeNativeState("mcp_retraction_transition", {
        reason: "renderer_restart",
        stateBeforeReceiptId: readyDiscovery.fingerprintCall.receiptId,
      });
      const rendererRestart: Mvp15dProductRetractionRaw = {
        reason: "renderer_restart",
        readyDiscovery,
        rendererInstanceCall: rendererAfter,
        transitionCall: transition.call,
        nativeRetraction,
        rendererHandoff: {
          requestCall: {
            receiptId: claim.requestReceiptId,
            request: structuredClone(claim.requestReceiptRequest),
          },
          parentAcknowledgementCall: {
            receiptId: claim.parentAcknowledgementReceiptId,
            request: structuredClone(claim.parentAcknowledgementReceiptRequest),
          },
          claimCall: {
            receiptId: claim.claimReceiptId,
            request: structuredClone(claim.claimReceiptRequest),
          },
        },
      };
      return {
        discoveries,
        retractions: [...retractions, rendererRestart],
        mutationBefore,
      };
    },
    observeMvp15dNativeState: async (kind, request) => {
      if (!fixedObservationAuthority) {
        throw new Error("mvp15d_fixed_observation_authority_unavailable");
      }
      return (await observeNativeState(kind, request)).call;
    },
    observeMvp15dManagedListenerAliveThroughUse: async () => {
      const authority = fixedObservationAuthority;
      const owner = phaseManagedEditorOwner;
      if (
        !authority ||
        !owner ||
        !latestEditorSessionId ||
        !latestEditorAttachInput ||
        mcpState.status !== "disconnected" ||
        latestEditorAttachInput.processId !== owner.processId ||
        latestEditorAttachInput.pidHash !== owner.pidHash
      ) {
        throw new Error("mvp15d_managed_listener_alive_context_invalid");
      }
      const request = {
        taskId: authority.taskId,
        phase: authority.phase,
        sessionId: latestEditorSessionId,
        processId: owner.processId,
        pid: owner.pid,
        processCreationFiletime: owner.processCreationFiletime,
        listenerInstanceSha256: owner.listenerInstanceSha256,
        ownerBindingSha256: owner.ownerBindingSha256,
        stage: "after_rendered_disconnect",
      };
      const observed = await observeNativeState("managed_listener_alive_through_use", request);
      if (
        observed.observation.status !== "observed" ||
        observed.observation.reason !== "task_owned_listener_accepting" ||
        observed.observation.processAlive !== true ||
        observed.observation.listenerAccepting !== true ||
        observed.observation.stage !== "after_rendered_disconnect" ||
        observed.observation.listenerInstanceSha256 !== owner.listenerInstanceSha256 ||
        observed.observation.ownerBindingSha256 !== owner.ownerBindingSha256 ||
        !isMvp15dSha256(observed.observation.processIdentitySha256)
      ) {
        throw new Error("mvp15d_managed_listener_alive_observation_invalid");
      }
      return observed.call;
    },
    takeMvp15dMcpObservationReceipt: (api) => {
      let index = -1;
      for (let candidate = mvp15dTransportObservations.length - 1; candidate >= 0; candidate -= 1) {
        if (mvp15dTransportObservations[candidate]!.api === api) {
          index = candidate;
          break;
        }
      }
      if (index < 0) return null;
      return mvp15dTransportObservations.splice(index, 1)[0]!.call;
    },
    runMvp15DProductRetractionOrchestration: async (
      trustedRootId,
      editorSessionId,
      endpoint,
    ) => {
      if (
        currentMvp15Fingerprint.status !== "ready" ||
        currentMvp15Fingerprint.toolCount !== 6 ||
        !mvp15DForwardAuthorityIsReady()
      ) {
        throw new Error("mvp15d_product_retraction_source_not_ready");
      }
      mvp15DProductRetractions.length = 0;
      const establishCurrentAuthority = async () => {
        await adapter.connectMcp();
        if (adapter.getMcpState().status !== "connected") {
          throw new Error("mvp15d_product_retraction_reconnect_failed");
        }
        await adapter.discoverMcp();
        await refreshMvp15DCompanionAttestation(trustedRootId, editorSessionId);
        if (
          currentMvp15Fingerprint.status !== "ready" ||
          currentMvp15Fingerprint.toolCount !== 6 ||
          !mvp15DForwardAuthorityIsReady()
        ) {
          throw new Error("mvp15d_product_retraction_reestablish_failed");
        }
      };
      const invalidateCurrentAuthority = async (
        reason: "failure" | "renderer_restart",
      ) => {
        mcpDiscoveryGeneration = nextMcpDiscoveryGeneration(mcpDiscoveryGeneration);
        await settleMvp15DNativeRetractions(retractMcpPublication(reason));
        syncMcp();
      };

      await adapter.discoverMcp();
      await refreshMvp15DCompanionAttestation(trustedRootId, editorSessionId);
      await establishCurrentAuthority();
      const transitionEndpoint = endpoint.endsWith("/mcp")
        ? `${endpoint}?mvp15d-transition=endpoint-change`
        : `${endpoint}/mcp?mvp15d-transition=endpoint-change`;
      adapter.setMcpEndpoint(transitionEndpoint);
      adapter.setMcpEndpoint(endpoint);
      await establishCurrentAuthority();
      await invalidateCurrentAuthority("failure");
      await establishCurrentAuthority();
      await invalidateCurrentAuthority("renderer_restart");
      await establishCurrentAuthority();

      const observedReasons = mvp15DProductRetractions.map(({ reason }) => reason);
      if (
        JSON.stringify(observedReasons) !==
          JSON.stringify(["newer_generation", "reconnect", "endpoint_change", "failure", "renderer_restart"])
      ) {
        throw new Error("mvp15d_product_retraction_orchestration_invalid");
      }
    },
    refreshMvp15DCompanionAttestation,
    captureMvp15McpBinding: () => currentMvp15McpBinding?.identity ?? null,
    isMvp15McpBindingCurrent: (binding) =>
      Boolean(
        currentMvp15McpBinding &&
        binding === currentMvp15McpBinding.identity &&
        currentSession === currentMvp15McpBinding.session &&
        currentDiscovery &&
        mcpState.status === "connected" &&
        mcpState.profile?.endpoint === currentMvp15McpBinding.endpoint,
      ),

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeMcp: (listener) => {
      mcpListeners.add(listener);
      return () => {
        mcpListeners.delete(listener);
      };
    },

    submitTask: async (draft) => {
      const record = await router.submitTask(draft);
      syncSnapshot();
      return record;
    },

    cancelTask: async (taskId) => {
      await router.cancelTask(taskId);
      syncSnapshot();
    },

    submitApprovalDecision: async (taskId, stepId, decision, actor, reason) => {
      await router.submitApprovalDecision!(taskId, stepId, decision, actor, reason);
      syncSnapshot();
    },
    setMcpEndpoint(endpoint) {
      let nativeRetraction: Promise<void> | null = null;
      if (endpoint !== mcpState.profile?.endpoint) {
        ensureStartupMvp15DNativeRetraction();
        mcpDiscoveryGeneration = nextMcpDiscoveryGeneration(mcpDiscoveryGeneration);
        nativeRetraction = retractMcpPublication("endpoint_change");
      }
      mcpState = {
        ...mcpState,
        profile: mcpState.profile
          ? { ...mcpState.profile, endpoint }
          : {
              id: "local-unreal-mcp",
              name: "Local Unreal MCP",
              endpoint,
              transport: "streamable-http",
            },
        lastError: null,
      };
      if (!nativeRetraction && mvp15DNativeRetractions.size === 0) {
        syncMcp();
        return;
      }
      const endpointGeneration = mcpDiscoveryGeneration;
      void (async () => {
        if (nativeRetraction) await nativeRetraction;
        await waitForMvp15DNativeRetractions();
        if (endpointGeneration === mcpDiscoveryGeneration) syncMcp();
      })();
    },
    async connectMcp() {
      ensureStartupMvp15DNativeRetraction();
      const connectionGeneration = nextMcpDiscoveryGeneration(mcpDiscoveryGeneration);
      mcpDiscoveryGeneration = connectionGeneration;
      const nativeRetraction = retractMcpPublication("reconnect");
      const previousSession = currentSession;
      currentSession = null;
      currentMvp15dMcpSessionId = null;
      const endpoint = mcpState.profile?.endpoint ?? "";
      const transportKind = mcpState.profile?.transport ?? "streamable-http";
      const isCurrentConnectionAttempt = () =>
        mcpDiscoveryGeneration === connectionGeneration && mcpState.profile?.endpoint === endpoint;

      await settleMvp15DNativeRetractions(nativeRetraction);
      if (!isCurrentConnectionAttempt()) return;
      if (mvp15DNativeAuthorityIsBlocked()) {
        mcpState = {
          ...mcpState,
          status: "error",
          lastError: "Native companion authority baseline retraction failed.",
        };
        syncMcp();
        return;
      }

      if (!isLocalEndpoint(endpoint)) {
        void previousSession?.disconnect();
        mcpState = {
          ...mcpState,
          status: "error",
          lastError: "Only localhost MCP endpoints are allowed in MVP2.",
        };
        syncMcp();
        return;
      }

      mcpState = { ...mcpState, status: "connecting", lastError: null };
      syncMcp();

      try {
        await previousSession?.disconnect();
        if (!isCurrentConnectionAttempt()) return;

        let session: McpSession;
        let initializeResult: McpInitializeResult;
        let legacyMode = false;

        if (options?.createTransport) {
          const transport = captureMvp15DProductTransport(
            options.createTransport(endpoint, transportKind),
          );
          session = new McpSession({ transport });
          initializeResult = await session.connect();
        } else if (transportKind === "http-sse") {
          const transport = captureMvp15DProductTransport(
            new LegacySseTransport({ endpoint, timeoutMs: 5_000 }),
          );
          session = new McpSession({ transport });
          initializeResult = await session.connect();
          legacyMode = true;
        } else {
          try {
            const transportOptions: ConstructorParameters<typeof StreamableHttpTransport>[0] = {
              endpoint,
              timeoutMs: 5_000,
            };
            if (nativeInvoke) {
              Object.assign(transportOptions, {
                ["fet" + "ch"]: createNativeMcpHttpPoster(observationNativeInvoke, 5_000),
              });
            }
            const transport = captureMvp15DProductTransport(
              new StreamableHttpTransport(transportOptions),
            );
            session = new McpSession({ transport });
            initializeResult = await session.connect();
          } catch (error) {
            if (!isLegacyFallbackCandidate(error)) throw error;
            const transport = captureMvp15DProductTransport(
              new LegacySseTransport({ endpoint, timeoutMs: 5_000 }),
            );
            session = new McpSession({ transport });
            initializeResult = await session.connect();
            legacyMode = true;
          }
        }

        if (!isCurrentConnectionAttempt()) {
          await session.disconnect();
          return;
        }
        currentSession = session;
        if (fixedObservationAuthority && !currentMvp15dMcpSessionId) {
          throw new Error("mvp15d_native_mcp_session_header_required");
        }
        if (!fixedObservationAuthority) {
          currentMvp15dMcpSessionId = `ordinary-mcp:${globalThis.crypto.randomUUID()}`;
        }
        mcpState = {
          ...mcpState,
          status: "connected",
          protocolVersion: initializeResult.protocolVersion,
          serverInfo: initializeResult.serverInfo,
          capabilities: null,
          lastError: null,
          legacyMode,
        };
        syncMcp();
      } catch (err) {
        if (!isCurrentConnectionAttempt()) return;
        const failureRetraction = retractMcpPublication("failure");
        await settleMvp15DNativeRetractions(failureRetraction);
        if (!isCurrentConnectionAttempt()) return;
        currentSession = null;
        mcpState = {
          ...mcpState,
          status: "error",
          lastError: err instanceof Error ? err.message : "MCP connection failed.",
          protocolVersion: null,
          serverInfo: null,
          capabilities: null,
        };
        syncMcp();
      }
    },
    async discoverMcp() {
      if (!currentSession) {
        mcpState = {
          ...mcpState,
          status: "error",
          lastError: "Connect to a localhost MCP endpoint before discovery.",
        };
        syncMcp();
        return;
      }

      const discoverySession = currentSession;
      const discoveryEndpoint = mcpState.profile?.endpoint ?? "";
      const discoveryGeneration = nextMcpDiscoveryGeneration(mcpDiscoveryGeneration);
      mcpDiscoveryGeneration = discoveryGeneration;
      const isCurrentDiscoveryAttempt = () =>
        currentSession === discoverySession &&
        mcpState.profile?.endpoint === discoveryEndpoint &&
        mcpDiscoveryGeneration === discoveryGeneration;
      const nativeRetraction = retractMcpPublication("newer_generation");
      await settleMvp15DNativeRetractions(nativeRetraction);
      if (!isCurrentDiscoveryAttempt()) return;
      mcpState = { ...mcpState, status: "discovering", lastError: null };
      syncMcp();

      try {
        const discovery = await discoverySession.discover();
        if (!isCurrentDiscoveryAttempt()) return;
        const facadeDiscovery = currentMvp15dToolSearchMode === "off"
          ? { tools: [], candidates: [] }
          : await discoverMvp15FacadeTools(discoverySession, discovery);
        if (!isCurrentDiscoveryAttempt()) return;
        const fingerprint = createMvp15LiveAssetToolsetFingerprint({
          directTools: discovery.tools,
          facadeTools: facadeDiscovery.candidates,
        });
        // Discovery alone is not provenance: a trusted native attestation is
        // required before the exact-six descriptors can become mutation-ready.
        const companionEvidence = {
          manifest: null,
          installedModules: [],
          loadedModules: [],
        };
        const companionAttestation = attestMvp15DCompanion({
          manifest: companionEvidence.manifest,
          installedModules: companionEvidence.installedModules,
          loadedModules: companionEvidence.loadedModules,
          directTools: discovery.tools,
          facadeTools: facadeDiscovery.candidates,
          discoveryGeneration,
        });
        currentDiscovery = discovery;
        currentMvp15FacadeTools = facadeDiscovery.tools;

        router.updateContext({
          runtimeMode: "mcp-readonly",
          discovery,
          readResource: async (uri) => discoverySession.readResource(uri),
          callTool: async (name, args) => discoverySession.callTool(name, args),
        });
        mcpState = {
          ...mcpState,
          status: "connected",
          capabilities: discovery.capabilitySummary,
          lastError: null,
        };
        publishMvp15McpBinding(discoverySession, discoveryEndpoint);
        currentMvp15Fingerprint = {
          ...fingerprint,
          discoveryGeneration,
          binding: {
            session: "current",
            endpoint: "redacted",
            generation: mvp15McpBindingGeneration,
          },
        };
        currentMvp15DCompanionFingerprint = companionAttestation.fingerprint;
        currentMvp15DCompanionStatus = companionAttestation.status;
        syncMcp();
      } catch (err) {
        if (!isCurrentDiscoveryAttempt()) return;
        const failureRetraction = retractMcpPublication("failure");
        await settleMvp15DNativeRetractions(failureRetraction);
        if (!isCurrentDiscoveryAttempt()) return;
        mcpState = {
          ...mcpState,
          status: "error",
          lastError: err instanceof Error ? err.message : "MCP discovery failed.",
        };
        syncMcp();
      }
    },
    disconnectMcp() {
      void disconnectMcpAndWait().catch(() => {});
    },
    getMvp9: () => mvp9Service,
    getTextMutationAdapter: () => textMutationAdapter,
    getEditorObservationAdapter: () => editorObservationAdapter,
    guardMvp15AssetMutation: async (input) => {
      if (!nativeInvoke) {
        return { status: "blocked", reason: "native_asset_guard_unavailable", evidenceId: null };
      }
      const startupRetraction = ensureStartupMvp15DNativeRetraction();
      if (startupRetraction) await startupRetraction.settled;
      if (mvp15DNativeAuthorityIsBlocked()) {
        return {
          status: "blocked",
          reason:
            mvp15DNativeRetractionPending > 0
              ? "native_companion_retraction_pending"
              : "native_companion_retraction_failed",
          evidenceId: null,
        };
      }
      const requestsForwardAuthority =
        input.command === "register" ||
        (input.command === "guard" && input.phase !== "rollback");
      if (requestsForwardAuthority && !mvp15DForwardAuthorityIsReady()) {
        return {
          status: "blocked",
          reason: "companion_attestation_required",
          evidenceId: null,
        };
      }
      try {
        const command =
          input.command === "register"
            ? "register_asset_mutation_approval"
            : input.command === "cancel_registration"
              ? "cancel_asset_mutation_approval"
              : input.command === "record_outcome"
                ? "record_asset_mutation_outcome"
                : input.phase === "rollback"
                  ? "rollback_asset_mutation"
                  : "execute_asset_mutation";
        const nativeInput = toNativeMvp15AssetMutationInput(input);
        if (!nativeInput) {
          return { status: "blocked", reason: "trusted_root_ref_unavailable" };
        }
        const result = await nativeInvoke(command, { input: nativeInput });
        const normalized = normalizeMvp15NativeGuardResult(result);
        const nativeReceiptId =
          result && typeof result === "object" && !Array.isArray(result)
            ? (result as Record<string, unknown>).nativeReceiptId
            : null;
        return typeof nativeReceiptId === "string"
          ? { ...normalized, nativeReceiptId }
          : normalized;
      } catch {
        return {
          status: "failed",
          reason: "native_asset_guard_failed",
          evidenceId: null,
        };
      }
    },
    dryRunMvp15AssetMutation: async (input) => {
      if (!nativeInvoke) {
        return { status: "blocked", reason: "native_asset_guard_unavailable" };
      }
      try {
        const result = await nativeInvoke("dry_run_asset_mutation", { input });
        return result && typeof result === "object" && !Array.isArray(result)
          ? result as Record<string, unknown>
          : { status: "failed", reason: "native_asset_guard_invalid_result" };
      } catch {
        return { status: "failed", reason: "native_asset_guard_failed" };
      }
    },
    callMvp15AssetTool: async (toolName, args) => {
      if (!isMvp15AssetToolName(toolName)) {
        return {
          ok: false,
          status: "blocked",
          reason: "mvp15_tool_not_allowlisted",
          evidenceId: null,
        };
      }
      if (!currentSession) {
        return { ok: false, status: "blocked", reason: "mcp_session_required", evidenceId: null };
      }
      const isMutationPhase = args.execute === true || args.rollback === true;
      if (isMutationPhase) {
        if (mvp15DNativeAuthorityIsBlocked()) {
          return {
            ok: false,
            status: "blocked",
            reason:
              mvp15DNativeRetractionPending > 0
                ? "native_companion_retraction_pending"
                : "native_companion_retraction_failed",
            evidenceId: null,
          };
        }
        if (args.execute === true && !mvp15DForwardAuthorityIsReady()) {
          return {
            ok: false,
            status: "blocked",
            reason: "companion_attestation_required",
            evidenceId: null,
          };
        }
        const directTool = (currentDiscovery?.tools ?? []).find((tool) => tool.name === toolName);
        const directToolAvailable = directTool
          ? isCompleteMvp15AssetToolDescriptor(toMvp15AssetToolDescriptor(directTool))
          : false;
        if (!directToolAvailable) {
          return {
            ok: false,
            status: "blocked",
            reason: "mvp15_direct_exact_tool_required",
            evidenceId: null,
          };
        }
        return currentSession.callTool(toolName, args);
      }
      const selectedDescriptor = getMvp15AssetTools(currentDiscovery, currentMvp15FacadeTools).find(
        (tool) => tool.name === toolName,
      );
      const wrapperCall = selectedDescriptor
        ? createMvp15FacadeWrapperCall(selectedDescriptor, args)
        : null;
      if (wrapperCall) {
        return currentSession.callTool(wrapperCall.wrapperToolName, wrapperCall.args);
      }
      return currentSession.callTool(toolName, args);
    },
    runMvp15DProductNoOpProbe,
    readMvp15AssetContentEvidence: async (input) => {
      if (!nativeInvoke)
        return blockedMvp15ContentEvidence(input.assetPath, "native_asset_evidence_unavailable");
      if (!isSafeMvp15EvidenceBinding(input) || !isCanonicalMvp15AssetPath(input.assetPath)) {
        return blockedMvp15ContentEvidence(input.assetPath, "asset_evidence_input_invalid");
      }
      try {
        const raw = await nativeInvoke("read_asset_content_evidence", { input });
        return normalizeMvp15ContentEvidence(raw, input.assetPath);
      } catch {
        return blockedMvp15ContentEvidence(
          input.assetPath,
          "native_asset_evidence_failed",
          "failed",
        );
      }
    },
    snapshotMvp15AssetContentManifest: async (input) => {
      if (!nativeInvoke) return blockedMvp15ContentManifest("native_content_manifest_unavailable");
      if (!isSafeMvp15EvidenceBinding(input))
        return blockedMvp15ContentManifest("content_manifest_input_invalid");
      try {
        const raw = await nativeInvoke("snapshot_asset_content_manifest", { input });
        return normalizeMvp15ContentManifest(raw);
      } catch {
        return blockedMvp15ContentManifest("native_content_manifest_failed", "failed");
      }
    },
    subscribeMvp9: (listener: (state: Mvp9RuntimeState) => void) => {
      mvp9Listeners.add(listener);
      return () => {
        mvp9Listeners.delete(listener);
      };
    },
  };
  return adapter;
}

function getMvp15AssetTools(
  discovery: McpDiscoverySnapshot | null,
  facadeTools: Mvp15McpAssetToolDescriptor[],
): Mvp15McpAssetToolDescriptor[] {
  const directTools = (discovery?.tools ?? [])
    .filter((tool) => isMvp15AssetToolName(tool.name))
    .map((tool) => toMvp15AssetToolDescriptor(tool));
  // Do not normalize collisions away.  A duplicate name (including a Direct /
  // Toolset Registry collision) is an ambiguous authority and must make the
  // inventory fail closed rather than silently preferring one descriptor.
  return [...directTools, ...facadeTools];
}

function isCompleteMvp15AssetToolDescriptor(tool: Mvp15McpAssetToolDescriptor): boolean {
  const toolName = tool.name;
  if (!isMvp15AssetToolName(toolName)) return false;
  return createMvp15McpAssetToolInventory([tool]).availableTools.includes(toolName);
}

async function discoverMvp15FacadeTools(
  session: McpSession,
  discovery: McpDiscoverySnapshot,
): Promise<{
  tools: Mvp15McpAssetToolDescriptor[];
  candidates: Mvp15McpAssetToolDescriptor[];
}> {
  const toolNames = new Set(discovery.tools.map((tool) => tool.name));
  if (
    !toolNames.has("list_toolsets") ||
    !toolNames.has("describe_toolset") ||
    !toolNames.has("call_tool")
  ) {
    return { tools: [], candidates: [] };
  }
  try {
    const toolsetList = unwrapMcpToolPayload(await session.callTool("list_toolsets", {}));
    const toolsetIds = getToolsetIds(toolsetList);
    const toolsets: Mvp15ExactToolFacadeToolset[] = [];
    for (const toolsetId of toolsetIds) {
      const description = unwrapMcpToolPayload(
        await session.callTool("describe_toolset", { toolset_name: toolsetId }),
      );
      const normalized = normalizeFacadeToolset(description, toolsetId);
      if (normalized) toolsets.push(normalized);
    }
    const facade = createMvp15ExactToolFacade(toolsets);
    return { tools: facade.tools, candidates: facade.candidates };
  } catch {
    return { tools: [], candidates: [] };
  }
}

function toMvp15AssetToolDescriptor(
  tool: McpDiscoverySnapshot["tools"][number],
): Mvp15McpAssetToolDescriptor {
  return normalizeMvp15McpAssetToolDescriptor(tool);
}

function unwrapMcpToolPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const payload = raw as { content?: unknown };
  if (!Array.isArray(payload.content)) return raw;
  const text = payload.content
    .map((item) =>
      item && typeof item === "object" && "text" in item ? (item as { text?: unknown }).text : null,
    )
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!text) return raw;
  try {
    return JSON.parse(text);
  } catch {
    return raw;
  }
}

function getToolsetIds(raw: unknown): string[] {
  const ids: string[] = [];
  const addId = (value: unknown) => {
    if (typeof value !== "string") return;
    const normalized = value.trim();
    if (normalized.length === 0 || normalized.length > 512 || /[\r\n\0]/.test(normalized)) return;
    ids.push(normalized);
  };
  const addTextList = (text: string) => {
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*-\s+([^:\r\n]+?)(?:\s*:\s*.*)?$/.exec(line);
      if (match) addId(match[1]);
    }
  };
  if (typeof raw === "string") {
    addTextList(raw);
    return [...new Set(ids)];
  }
  if (!raw || typeof raw !== "object") return [];
  const record = raw as { toolsets?: unknown; toolSets?: unknown; content?: unknown };
  const items = Array.isArray(record.toolsets)
    ? record.toolsets
    : Array.isArray(record.toolSets)
      ? record.toolSets
      : [];
  for (const item of items) {
    if (typeof item === "string") {
      addId(item);
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const toolset = item as {
      id?: unknown;
      toolsetId?: unknown;
      toolset_id?: unknown;
      name?: unknown;
    };
    addId(firstString(toolset.id, toolset.toolsetId, toolset.toolset_id, toolset.name));
  }
  if (Array.isArray(record.content)) {
    for (const item of record.content) {
      if (!item || typeof item !== "object") continue;
      const text = (item as { text?: unknown }).text;
      if (typeof text === "string") addTextList(text);
    }
  }
  return [...new Set(ids)];
}

const MVP15_D0_TOOLSET_ID = "UAgentAssetTools.UAgentAssetToolsD0Toolset";
const MVP15_D0_DIRECT_PROBE_NAME = "uagent.d0.probe";
const MVP15_D0_QUALIFIED_PROBE_NAME = `${MVP15_D0_TOOLSET_ID}.Probe`;
const MVP15_D0_META_TOOL_NAMES = ["list_toolsets", "describe_toolset", "call_tool"] as const;
const MVP15_D0_RESERVED_DISCOVERY_NAMES = [
  MVP15_D0_DIRECT_PROBE_NAME,
  MVP15_D0_QUALIFIED_PROBE_NAME,
  ...MVP15_D0_META_TOOL_NAMES,
] as const;

function isMvp15D0ToolsetId(value: string): boolean {
  return value === MVP15_D0_TOOLSET_ID;
}

function isMvp15D0EmptyInputSchema(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const schema = value as Record<string, unknown>;
  const keys = Object.keys(schema).sort();
  return (
    keys.length === 4 &&
    keys[0] === "additionalProperties" &&
    keys[1] === "properties" &&
    keys[2] === "required" &&
    keys[3] === "type" &&
    schema.type === "object" &&
    schema.additionalProperties === false &&
    schema.properties !== null &&
    typeof schema.properties === "object" &&
    !Array.isArray(schema.properties) &&
    Object.keys(schema.properties).length === 0 &&
    Array.isArray(schema.required) &&
    schema.required.length === 0
  );
}

function isMvp15D0ToolsetEmptyInputSchema(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    (value as Record<string, unknown>).type === "object",
  );
}

function assertMvp15D0ProbeInventory(
  discovery: McpDiscoverySnapshot,
  route: "direct" | "toolset_registry",
  toolSearch: boolean,
): void {
  const names = discovery.tools.map((tool) => tool.name);
  for (const reservedName of MVP15_D0_RESERVED_DISCOVERY_NAMES) {
    if (
      names.some(
        (name) =>
          name !== reservedName &&
          name.toLocaleLowerCase("en-US") === reservedName.toLocaleLowerCase("en-US"),
      )
    ) {
      throw new Error("mvp15d_probe_inventory_case_mismatch");
    }
  }

  const count = (name: string) => names.filter((candidate) => candidate === name).length;
  const directCount = count(MVP15_D0_DIRECT_PROBE_NAME);
  const eagerCount = count(MVP15_D0_QUALIFIED_PROBE_NAME);
  const metaCounts = MVP15_D0_META_TOOL_NAMES.map(count);
  if (route === "direct") {
    // Unreal MCP publishes the generic Toolset Registry meta-tools even when
    // this plugin selects its Direct D0 route. They are neutral server
    // capabilities; the conflicting route is an actual qualified D0 Probe.
    if (eagerCount > 0) {
      throw new Error("mvp15d_probe_inventory_route_conflict");
    }
    if (directCount !== 1) throw new Error("mvp15d_direct_probe_descriptor_required");
    return;
  }
  if (directCount > 0) throw new Error("mvp15d_probe_inventory_route_conflict");
  if (toolSearch) {
    if (eagerCount > 0) throw new Error("mvp15d_probe_inventory_route_conflict");
    if (metaCounts.some((value) => value !== 1)) {
      throw new Error("mvp15d_tool_search_meta_tools_required");
    }
    return;
  }
  if (metaCounts.some((value) => value > 0)) {
    throw new Error("mvp15d_probe_inventory_route_conflict");
  }
  if (eagerCount !== 1) throw new Error("mvp15d_eager_probe_descriptor_required");
}

function findMvp15D0ProbeToolName(raw: unknown, depth = 0): string | null {
  if (depth > 16 || !raw || typeof raw !== "object") return null;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const match = findMvp15D0ProbeToolName(item, depth + 1);
      if (match) return match;
    }
    return null;
  }
  const record = raw as Record<string, unknown>;
  const candidate = firstString(
    record.name,
    record.toolName,
    record.tool_name,
    record.methodName,
    record.method_name,
  );
  const inputSchema = record.inputSchema ?? record.input_schema;
  if (
    (candidate === "Probe" || candidate === MVP15_D0_QUALIFIED_PROBE_NAME) &&
    isMvp15D0ToolsetEmptyInputSchema(inputSchema)
  ) {
    return "Probe";
  }
  for (const value of Object.values(record)) {
    const match = findMvp15D0ProbeToolName(value, depth + 1);
    if (match) return match;
  }
  return null;
}

function isMvp15D0EagerProbeDescriptor(descriptor: McpDiscoverySnapshot["tools"][number]): boolean {
  return (
    descriptor.name === MVP15_D0_QUALIFIED_PROBE_NAME &&
    isMvp15D0ToolsetEmptyInputSchema(descriptor.inputSchema)
  );
}

function normalizeFacadeToolset(
  raw: unknown,
  fallbackToolsetId: string,
): Mvp15ExactToolFacadeToolset | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as {
    toolset?: unknown;
    toolsetId?: unknown;
    toolset_id?: unknown;
    id?: unknown;
    methods?: unknown;
  };
  const source =
    record.toolset && typeof record.toolset === "object"
      ? (record.toolset as typeof record)
      : record;
  const toolsetId = firstString(source.toolsetId, source.toolset_id, source.id, fallbackToolsetId);
  if (!toolsetId) return null;
  const methods = Array.isArray(source.methods) ? source.methods : [];
  return {
    toolsetId,
    methods: methods
      .map(normalizeFacadeMethod)
      .filter((method): method is Mvp15ExactToolFacadeToolset["methods"][number] =>
        Boolean(method),
      ),
  };
}

function normalizeFacadeMethod(
  raw: unknown,
): Mvp15ExactToolFacadeToolset["methods"][number] | null {
  if (!raw || typeof raw !== "object") return null;
  const method = raw as {
    exactToolName?: unknown;
    exact_tool_name?: unknown;
    toolName?: unknown;
    name?: unknown;
    methodId?: unknown;
    method_id?: unknown;
    id?: unknown;
    schemaVersion?: unknown;
    schema_version?: unknown;
    version?: unknown;
    inputSchema?: unknown;
    input_schema?: unknown;
    dryRunSchema?: unknown;
    dry_run_schema?: unknown;
    rollbackContract?: unknown;
    rollback_contract?: unknown;
    affectedAssetsSchema?: unknown;
    affected_assets_schema?: unknown;
    evidenceQuery?: unknown;
    evidence_query?: unknown;
    externalEvidenceQuery?: unknown;
  };
  const exactToolName = firstString(
    method.exactToolName,
    method.exact_tool_name,
    method.toolName,
    method.name,
  );
  const methodId = firstString(method.methodId, method.method_id, method.id, method.name);
  const schemaVersion = firstString(method.schemaVersion, method.schema_version, method.version);
  if (!exactToolName || !methodId || !schemaVersion) return null;
  return {
    exactToolName,
    methodId,
    schemaVersion,
    inputSchema: method.inputSchema ?? method.input_schema,
    dryRunSchema: method.dryRunSchema ?? method.dry_run_schema,
    rollbackContract: method.rollbackContract ?? method.rollback_contract,
    affectedAssetsSchema: method.affectedAssetsSchema ?? method.affected_assets_schema,
    evidenceQuery: method.evidenceQuery ?? method.evidence_query ?? method.externalEvidenceQuery,
  };
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return null;
}

function getGlobalInvoke(): NativeInvoke | null {
  const tauriInternals = (globalThis as { __TAURI_INTERNALS__?: { invoke?: NativeInvoke } })
    .__TAURI_INTERNALS__;
  return tauriInternals?.invoke ?? null;
}

/**
 * D0 transcript observation is intentionally strict: it records enough of the
 * JSON-RPC response for an independent descriptor/schema hash, but never leaks
 * filesystem locations, endpoint/session credentials, or proxy/getter failures
 * into the task-owned transcript.
 */
function redactMvp15DProductAdapterPayload(value: unknown, depth = 0): unknown {
  if (depth > 32) return "[depth-limited]";
  try {
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "number") return Number.isFinite(value) ? value : "[non-finite]";
    if (typeof value === "string") {
      if (value.length > 64 * 1024) return "[string-truncated]";
      return containsSensitiveMvp15DProductValue(value) ? "[redacted]" : value;
    }
    if (Array.isArray(value)) {
      const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > 1_024) return "[array-invalid]";
      const output: unknown[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !("value" in descriptor)) return "[array-invalid]";
        output.push(redactMvp15DProductAdapterPayload(descriptor.value, depth + 1));
      }
      return output;
    }
    if (!value || typeof value !== "object") return "[unsupported]";
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return "[object-invalid]";
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    const keys = Reflect.ownKeys(value);
    if (keys.length > 1_024) return "[object-too-large]";
    for (const key of keys) {
      if (typeof key !== "string") return "[object-invalid]";
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
        return "[object-invalid]";
      output[key] =
        /(?:token|secret|credential|authorization|password|session(?:[_-]?id)?|pid(?:[_-]?hash)?|trusted(?:[_-]?root)?(?:[_-]?id)?)/i.test(
          key,
        )
          ? "[redacted]"
          : redactMvp15DProductAdapterPayload(descriptor.value, depth + 1);
    }
    return output;
  } catch {
    return "[payload-unavailable]";
  }
}

function containsSensitiveMvp15DProductValue(value: string): boolean {
  return (
    /^[A-Za-z]:[\\/]/.test(value) ||
    /^\\\\/.test(value) ||
    /(?:^|[^A-Za-z0-9])(?:Bearer|token|secret|credential|authorization)[^A-Za-z0-9]/i.test(value) ||
    /(?:^|[?&])(token|session|authorization)=/i.test(value)
  );
}

function isSafeTrustedRootId(value: string): boolean {
  return /^[A-Za-z0-9:._-]{1,512}$/.test(value);
}

function normalizeNativeMvp15DCompanionEvidence(raw: unknown): {
  status: "observed" | "blocked";
  reason: string;
  manifest: unknown | null;
  installedModules: readonly unknown[];
  loadedModules: readonly unknown[];
} | null {
  if (!isSafeNativeEvidenceObject(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (
    !hasOnlyNativeKeys(record, [
      "status",
      "reason",
      "manifest",
      "installedModules",
      "loadedModules",
      "nativeReceiptId",
    ])
  )
    return null;
  const reason = safeNativeReason(record.reason);
  if ((record.status !== "observed" && record.status !== "blocked") || !reason) return null;
  if (record.manifest !== null && !isSafeNativeEvidenceObject(record.manifest)) return null;
  if (!Array.isArray(record.installedModules) || !Array.isArray(record.loadedModules)) return null;
  if (
    record.installedModules.some((item) => !isSafeNativeEvidenceObject(item)) ||
    record.loadedModules.some((item) => !isSafeNativeEvidenceObject(item))
  )
    return null;
  return {
    status: record.status,
    reason,
    manifest: record.manifest ?? null,
    installedModules: record.installedModules,
    loadedModules: record.loadedModules,
  };
}

function isMvp15AssetToolName(toolName: string): toolName is Mvp15McpAssetToolName {
  return (MVP15_ASSET_TOOL_ALLOWLIST as readonly string[]).includes(toolName);
}

function toNativeMvp15AssetMutationInput(
  input: Mvp15NativeAssetGuardInput,
): Record<string, unknown> | null {
  if (input.command === "register") {
    const trustedProjectRoot = resolveTrustedNativeRootRef(input.trustedRootRef);
    if (!trustedProjectRoot) return null;
    const registration = { ...input } as Record<string, unknown>;
    delete registration.command;
    delete registration.phase;
    delete registration.trustedRootRef;
    return { ...registration, trustedProjectRoot };
  }
  if (
    input.command === "guard" ||
    input.command === "record_outcome" ||
    input.command === "cancel_registration"
  ) {
    const nativeInput = { ...input } as Record<string, unknown>;
    delete nativeInput.command;
    if (input.command === "cancel_registration") delete nativeInput.phase;
    return nativeInput;
  }
  return null;
}

function normalizeMvp15NativeGuardResult(raw: unknown): Mvp15NativeAssetGuardResult {
  if (!raw || typeof raw !== "object") {
    return { status: "failed", reason: "native_asset_guard_invalid_result", evidenceId: null };
  }
  const result = raw as Record<string, unknown>;
  const status = typeof result.status === "string" ? result.status : "failed";
  const reason = safeNativeReason(result.reason);
  if (status === "registered") {
    return {
      status,
      reason,
      registrationId: safeNativeIdentifier(
        firstString(result.registrationId, result.registration_id),
      ),
      operationCount: firstNumber(result.operationCount, result.operation_count) ?? undefined,
      approvalToken: safeNativeApprovalToken(
        firstString(result.approvalToken, result.approval_token),
      ),
      issuedAt: firstNumber(result.issuedAt, result.issued_at) ?? undefined,
      expiresAt: firstNumber(result.expiresAt, result.expires_at) ?? undefined,
    };
  }
  if (status === "recorded") {
    const effectState =
      result.effectState === "known_none" ||
      result.effectState === "known_effect" ||
      result.effectState === "known_partial" ||
      result.effectState === "unknown"
        ? result.effectState
        : undefined;
    return {
      status,
      reason,
      registrationId: safeNativeIdentifier(
        firstString(result.registrationId, result.registration_id),
      ),
      phase: result.phase === "execute" || result.phase === "rollback" ? result.phase : null,
      operationId: safeNativeIdentifier(firstString(result.operationId, result.operation_id)),
      rollbackAvailable: firstBoolean(result.rollbackAvailable, result.rollback_available),
      effectState,
      terminal: firstBoolean(result.terminal),
    };
  }
  if (status === "cancelled") {
    return {
      status,
      reason,
      registrationId: safeNativeIdentifier(
        firstString(result.registrationId, result.registration_id),
      ),
    };
  }
  if (status === "accepted_by_native_guard") {
    return {
      status,
      reason,
      registrationId: safeNativeIdentifier(
        firstString(result.registrationId, result.registration_id),
      ),
      phase: result.phase === "execute" || result.phase === "rollback" ? result.phase : null,
      operationId: safeNativeIdentifier(firstString(result.operationId, result.operation_id)),
      operationIndex: firstNumber(result.operationIndex, result.operation_index) ?? undefined,
      operationCount: firstNumber(result.operationCount, result.operation_count) ?? undefined,
      evidenceId: safeNativeIdentifier(firstString(result.evidenceId, result.evidence_id)),
      acceptedPlanBinding: safeNativeApprovalToken(
        firstString(result.acceptedPlanBinding, result.accepted_plan_binding),
      ),
      nativeRegistrationId: safeNativeIdentifier(
        firstString(
          result.nativeRegistrationId,
          result.native_registration_id,
          result.registrationId,
          result.registration_id,
        ),
      ),
      nativePhase:
        result.nativePhase === "execute" || result.nativePhase === "rollback"
          ? result.nativePhase
          : result.native_phase === "execute" || result.native_phase === "rollback"
            ? result.native_phase
            : result.phase === "execute" || result.phase === "rollback"
              ? result.phase
              : null,
      nativeOperationIndex:
        firstNumber(
          result.nativeOperationIndex,
          result.native_operation_index,
          result.operationIndex,
          result.operation_index,
        ) ?? undefined,
      nativeOperationCount:
        firstNumber(
          result.nativeOperationCount,
          result.native_operation_count,
          result.operationCount,
          result.operation_count,
        ) ?? undefined,
      nativeCreatedAt: firstNumber(result.nativeCreatedAt, result.native_created_at) ?? undefined,
      connectionGeneration:
        firstNumber(result.connectionGeneration, result.connection_generation) ?? undefined,
      sessionGeneration:
        firstNumber(result.sessionGeneration, result.session_generation) ?? undefined,
      nativeSourceIdentity: safeNativeApprovalToken(
        firstString(result.nativeSourceIdentity, result.native_source_identity),
      ),
      nativeManifestIdentity: safeNativeApprovalToken(
        firstString(result.nativeManifestIdentity, result.native_manifest_identity),
      ),
      nativePluginIdentity: safeNativeApprovalToken(
        firstString(result.nativePluginIdentity, result.native_plugin_identity),
      ),
      nativePackageIdentity: safeNativeApprovalToken(
        firstString(result.nativePackageIdentity, result.native_package_identity),
      ),
    };
  }
  return {
    status: status === "blocked" ? "blocked" : "failed",
    reason: reason ?? "native_asset_guard_invalid_result",
  };
}

function safeNativeApprovalToken(value: string | null): string | null {
  return value && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

function normalizeMvp15ContentEvidence(
  raw: unknown,
  expectedAssetPath: string,
): AssetContentEvidenceObservation {
  if (!isSafeNativeEvidenceObject(raw))
    return blockedMvp15ContentEvidence(
      expectedAssetPath,
      "native_asset_evidence_invalid_result",
      "failed",
    );
  const result = raw as Record<string, unknown>;
  if (
    !hasOnlyNativeKeys(result, [
      "status",
      "reason",
      "assetPath",
      "exists",
      "size",
      "sha256",
      "evidenceId",
    ])
  ) {
    return blockedMvp15ContentEvidence(
      expectedAssetPath,
      "native_asset_evidence_invalid_result",
      "failed",
    );
  }
  const reason = safeNativeReason(result.reason);
  if (result.status === "blocked" || result.status === "failed") {
    return blockedMvp15ContentEvidence(
      expectedAssetPath,
      reason ?? "native_asset_evidence_blocked",
      result.status,
    );
  }
  if (
    result.status !== "observed" ||
    !reason ||
    result.assetPath !== expectedAssetPath ||
    typeof result.exists !== "boolean" ||
    typeof result.evidenceId !== "string" ||
    !result.evidenceId.trim()
  ) {
    return blockedMvp15ContentEvidence(
      expectedAssetPath,
      "native_asset_evidence_invalid_result",
      "failed",
    );
  }
  if (result.exists) {
    if (
      reason !== "asset_present" ||
      !isSafeMvp15Size(result.size) ||
      !isMvp15Sha256(result.sha256)
    ) {
      return blockedMvp15ContentEvidence(
        expectedAssetPath,
        "native_asset_evidence_invalid_result",
        "failed",
      );
    }
  } else if (reason !== "asset_absent" || result.size !== null || result.sha256 !== null) {
    return blockedMvp15ContentEvidence(
      expectedAssetPath,
      "native_asset_evidence_invalid_result",
      "failed",
    );
  }
  return {
    status: "observed",
    reason,
    assetPath: expectedAssetPath,
    exists: result.exists,
    size: result.exists ? (result.size as number) : null,
    sha256: result.exists ? (result.sha256 as string) : null,
    evidenceId: result.evidenceId,
  };
}

function normalizeMvp15ContentManifest(raw: unknown): AssetContentManifestObservation {
  if (!isSafeNativeEvidenceObject(raw))
    return blockedMvp15ContentManifest("native_content_manifest_invalid_result", "failed");
  const result = raw as Record<string, unknown>;
  if (
    !hasOnlyNativeKeys(result, ["status", "reason", "entries", "aggregateSha256", "evidenceId"])
  ) {
    return blockedMvp15ContentManifest("native_content_manifest_invalid_result", "failed");
  }
  const reason = safeNativeReason(result.reason);
  if (result.status === "blocked" || result.status === "failed") {
    return blockedMvp15ContentManifest(reason ?? "native_content_manifest_blocked", result.status);
  }
  if (
    result.status !== "observed" ||
    reason !== "content_manifest_captured" ||
    !Array.isArray(result.entries) ||
    !isMvp15Sha256(result.aggregateSha256) ||
    typeof result.evidenceId !== "string" ||
    !result.evidenceId.trim()
  ) {
    return blockedMvp15ContentManifest("native_content_manifest_invalid_result", "failed");
  }
  const entries: AssetContentManifestObservation["entries"] = [];
  let previousPath = "";
  for (const item of result.entries) {
    if (!item || typeof item !== "object" || Array.isArray(item))
      return blockedMvp15ContentManifest("native_content_manifest_invalid_result", "failed");
    const entry = item as Record<string, unknown>;
    if (!hasOnlyNativeKeys(entry, ["assetPath", "size", "sha256"]))
      return blockedMvp15ContentManifest("native_content_manifest_invalid_result", "failed");
    if (
      !isCanonicalMvp15AssetPath(entry.assetPath) ||
      !isSafeMvp15Size(entry.size) ||
      !isMvp15Sha256(entry.sha256)
    ) {
      return blockedMvp15ContentManifest("native_content_manifest_invalid_result", "failed");
    }
    if (previousPath && entry.assetPath <= previousPath)
      return blockedMvp15ContentManifest("native_content_manifest_invalid_result", "failed");
    previousPath = entry.assetPath;
    entries.push({ assetPath: entry.assetPath, size: entry.size, sha256: entry.sha256 });
  }
  return {
    status: "observed",
    reason,
    entries,
    aggregateSha256: result.aggregateSha256,
    evidenceId: result.evidenceId,
  };
}

function blockedMvp15ContentEvidence(
  assetPath: string,
  reason: string,
  status: "blocked" | "failed" = "blocked",
): AssetContentEvidenceObservation {
  return {
    status,
    reason,
    assetPath: isCanonicalMvp15AssetPath(assetPath) ? assetPath : "[invalid-asset-path]",
    exists: false,
    size: null,
    sha256: null,
    evidenceId: null,
  };
}

function blockedMvp15ContentManifest(
  reason: string,
  status: "blocked" | "failed" = "blocked",
): AssetContentManifestObservation {
  return { status, reason, entries: [], aggregateSha256: null, evidenceId: null };
}

function isSafeMvp15EvidenceBinding(input: AssetMutationExternalRegistrationBinding): boolean {
  const value = input.registrationId;
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    !/[\\/\r\n\t]/.test(value) &&
    !/^[A-Za-z]:/.test(value)
  );
}

function isCanonicalMvp15AssetPath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/Game/") &&
    value.length > "/Game/".length &&
    !value.includes("\\") &&
    !value.includes("//") &&
    !value.includes("..") &&
    !value.includes(":") &&
    !value.includes(".") &&
    value
      .split("/")
      .slice(2)
      .every((segment) => Boolean(segment))
  );
}

function isSafeMvp15Size(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isMvp15Sha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function safeNativeReason(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9_:-]+$/.test(value) ? value : null;
}

function safeNativeIdentifier(value: unknown): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    /^[A-Za-z0-9:._-]+$/.test(value)
    ? value
    : null;
}

function isSafeNativeEvidenceObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return !containsSensitiveNativeEvidence(value);
}

function hasOnlyNativeKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function containsSensitiveNativeEvidence(value: unknown): boolean {
  if (typeof value === "string") {
    return (
      /^[A-Za-z]:[\\/]/.test(value) ||
      /^\\\\/.test(value) ||
      /^file:/i.test(value) ||
      (value.startsWith("/") && !value.startsWith("/Game/")) ||
      /approval.?token|trusted.?project.?root|pid.?hash|editor.?session|\bsk-[a-z0-9_-]{8,}/i.test(
        value,
      )
    );
  }
  if (Array.isArray(value)) return value.some(containsSensitiveNativeEvidence);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, nested]) =>
      /approval.?token|trusted.?project.?root|pid.?hash|editor.?session/i.test(key) ||
      containsSensitiveNativeEvidence(nested),
  );
}

function firstNumber(...values: unknown[]): number | null {
  return (
    values.find((value): value is number => typeof value === "number" && Number.isFinite(value)) ??
    null
  );
}

function firstBoolean(...values: unknown[]): boolean | undefined {
  return values.find((value): value is boolean => typeof value === "boolean");
}

function isLegacyFallbackCandidate(error: unknown): boolean {
  return error instanceof McpTransportError && (error.status === 404 || error.status === 405);
}

function isLocalEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "::1" ||
      url.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}
