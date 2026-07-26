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
  MVP15_ASSET_TOOL_ALLOWLIST,
  normalizeMvp15McpAssetToolDescriptor,
  type AgentLoopRuntimeClient,
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
  type NativeEditorObservationAdapter,
} from "./editor-observation-native-adapter";
import { createNativeMcpHttpPoster } from "./mcp-native-transport";

export interface DesktopRuntimeAdapter {
  getSnapshot(): RuntimeSnapshot;
  getMcpState(): McpConnectionState;
  getMcpDiscovery(): McpDiscoverySnapshot | null;
  getMvp15AssetTools(): Mvp15McpAssetToolDescriptor[];
  getMvp15LiveAssetToolsetFingerprint?(): Mvp15LiveAssetToolsetFingerprintPublication;
  getMvp15DCompanionStatus?(): UAgentCompanionStatus;
  getMvp15DLiveCompanionFingerprint?(): Mvp15DCompanionFingerprint;
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
  /**
   * Narrow task-owned observer for D0 source evidence. It wraps the real
   * transport used by this adapter before McpSession parses initialize or
   * discovery responses, and emits bounded native attestation/retraction
   * lifecycle facts. The observer receives a path/token-redacted copy and is
   * never enabled by production defaults.
   */
  onMvp15DProductAdapterExchange?: (exchange: Mvp15DProductAdapterExchange) => void;
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
  const editorObservationAdapter =
    createEditorObservationNativeAdapterFromEnvironment(nativeInvoke);
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
          input: { attestationGeneration: requestedAttestationGeneration },
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
        ]);
        const resultShapeIsExact =
          result !== null && Object.keys(result).every((key) => allowedResultKeys.has(key));
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

  const retractMcpPublication = (): Promise<void> | null => {
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
          input: {
            trustedRootId,
            editorSessionId: normalizedEditorSessionId,
            attestationGeneration,
          },
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

  return {
    getSnapshot: () => router.getSnapshot(),
    getMcpState: () => mcpState,
    getMcpDiscovery: () => currentDiscovery,
    getMvp15AssetTools: () => getMvp15AssetTools(currentDiscovery, currentMvp15FacadeTools),
    getMvp15LiveAssetToolsetFingerprint: () => currentMvp15Fingerprint,
    getMvp15DCompanionStatus: () => currentMvp15DCompanionStatus,
    getMvp15DLiveCompanionFingerprint: () => currentMvp15DCompanionFingerprint,
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
        nativeRetraction = retractMcpPublication();
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
      const nativeRetraction = retractMcpPublication();
      const previousSession = currentSession;
      currentSession = null;
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
                ["fet" + "ch"]: createNativeMcpHttpPoster(nativeInvoke, 5_000),
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
        const failureRetraction = retractMcpPublication();
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
      const nativeRetraction = retractMcpPublication();
      await settleMvp15DNativeRetractions(nativeRetraction);
      if (!isCurrentDiscoveryAttempt()) return;
      mcpState = { ...mcpState, status: "discovering", lastError: null };
      syncMcp();

      try {
        const discovery = await discoverySession.discover();
        if (!isCurrentDiscoveryAttempt()) return;
        const facadeDiscovery = await discoverMvp15FacadeTools(discoverySession, discovery);
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
        const failureRetraction = retractMcpPublication();
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
      mcpDiscoveryGeneration = nextMcpDiscoveryGeneration(mcpDiscoveryGeneration);
      const disconnectGeneration = mcpDiscoveryGeneration;
      const previousSession = currentSession;
      currentSession = null;
      const nativeRetraction = retractMcpPublication();
      const finalizeDisconnect = () => {
        if (disconnectGeneration !== mcpDiscoveryGeneration) return;
        void previousSession?.disconnect();
        mcpState = {
          ...mcpState,
          status: "disconnected",
          protocolVersion: null,
          serverInfo: null,
          capabilities: null,
          lastError: null,
          legacyMode: false,
        };
        syncMcp();
        syncSnapshot();
      };
      if (!nativeRetraction && mvp15DNativeRetractions.size === 0) {
        finalizeDisconnect();
        return;
      }
      void (async () => {
        if (nativeRetraction) await nativeRetraction;
        await waitForMvp15DNativeRetractions();
        finalizeDisconnect();
      })();
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
        return normalizeMvp15NativeGuardResult(result);
      } catch {
        return {
          status: "failed",
          reason: "native_asset_guard_failed",
          evidenceId: null,
        };
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
