import {
  createAgentLoopRuntime,
  createMvp15ExactToolFacade,
  createMvp15FacadeWrapperCall,
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
  type Mvp15NativeAssetGuardInput,
  type Mvp15NativeAssetGuardResult,
  type Mvp9RuntimeService,
  type Mvp9RuntimeState,
} from "@uagent/runtime";
import { LegacySseTransport, McpSession, McpTransportError, StreamableHttpTransport } from "@uagent/mcp-client";
import type {
  ApprovalDecisionValue,
  AssetContentEvidenceObservation,
  AssetContentEvidenceRequest,
  AssetContentManifestObservation,
  AssetMutationExternalRegistrationBinding,
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
import { createDesktopTextMutationAdapterFromEnvironment, type NativeTextMutationAdapter } from "./text-mutation-native-adapter";
import { createEditorObservationNativeAdapterFromEnvironment, type NativeEditorObservationAdapter } from "./editor-observation-native-adapter";
import { createNativeMcpHttpPoster } from "./mcp-native-transport";

export interface DesktopRuntimeAdapter {
  getSnapshot(): RuntimeSnapshot;
  getMcpState(): McpConnectionState;
  getMcpDiscovery(): McpDiscoverySnapshot | null;
  getMvp15AssetTools(): Mvp15McpAssetToolDescriptor[];
  getMvp15LiveAssetToolsetFingerprint?(): Mvp15LiveAssetToolsetFingerprintPublication;
  captureMvp15McpBinding?(): string | null;
  isMvp15McpBindingCurrent?(binding: string): boolean;
  subscribe(listener: (snapshot: RuntimeSnapshot) => void): () => void;
  subscribeMcp(listener: (state: McpConnectionState) => void): () => void;
  submitTask(draft: TaskDraft): Promise<TaskRecord>;
  cancelTask(taskId: string): Promise<void>;
  submitApprovalDecision(taskId: string, stepId: string | null, decision: ApprovalDecisionValue, actor: string, reason: string): Promise<void>;
  setMcpEndpoint(endpoint: string): void;
  connectMcp(): Promise<void>;
  discoverMcp(): Promise<void>;
  disconnectMcp(): void;
  getMvp9(): Mvp9RuntimeService;
  subscribeMvp9(listener: (state: Mvp9RuntimeState) => void): () => void;
  getTextMutationAdapter(): NativeTextMutationAdapter | null;
  getEditorObservationAdapter(): NativeEditorObservationAdapter | null;
  guardMvp15AssetMutation?: (input: Mvp15NativeAssetGuardInput) => Promise<Mvp15NativeAssetGuardResult>;
  callMvp15AssetTool?: (
    toolName: Mvp15McpAssetToolName,
    args: Record<string, unknown>,
  ) => Promise<Mvp15McpAssetToolCallResult | unknown>;
  readMvp15AssetContentEvidence?: (input: AssetContentEvidenceRequest) => Promise<AssetContentEvidenceObservation>;
  snapshotMvp15AssetContentManifest?: (input: AssetMutationExternalRegistrationBinding) => Promise<AssetContentManifestObservation>;
}

export interface Mvp15LiveAssetToolsetFingerprintPublication
  extends Mvp15LiveAssetToolsetFingerprintResult {
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
}

export function createDesktopRuntimeAdapter(options?: DesktopRuntimeAdapterOptions): DesktopRuntimeAdapter {
  let currentSession: McpSession | null = null;
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
  const editorObservationAdapter = createEditorObservationNativeAdapterFromEnvironment(nativeInvoke);
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
  let currentMvp15McpBinding: { identity: string; endpoint: string; session: McpSession } | null = null;
  let currentMvp15Fingerprint: Mvp15LiveAssetToolsetFingerprintPublication = {
    ...createMvp15LiveAssetToolsetFingerprint([]),
    discoveryGeneration: 0,
    binding: null,
  };
  const listeners = new Set<(snapshot: RuntimeSnapshot) => void>();
  const mcpListeners = new Set<(state: McpConnectionState) => void>();

  const syncSnapshot = () => {
    const snapshot = router.getSnapshot();
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const syncMcp = () => {
    for (const listener of mcpListeners) {
      listener(mcpState);
    }
  };

  const invalidateMvp15McpBinding = () => {
    currentMvp15McpBinding = null;
  };

  const publishMvp15McpBinding = (session: McpSession, endpoint: string) => {
    mvp15McpBindingGeneration += 1;
    currentMvp15McpBinding = {
      identity: `mcp-binding:${mvp15McpBindingGeneration}`,
      endpoint,
      session,
    };
  };

  const retractMcpPublication = () => {
    invalidateMvp15McpBinding();
    currentDiscovery = null;
    currentMvp15FacadeTools = [];
    currentMvp15Fingerprint = {
      ...createMvp15LiveAssetToolsetFingerprint([]),
      discoveryGeneration: mcpDiscoveryGeneration,
      binding: null,
    };
    router.updateContext({ runtimeMode: "mock", discovery: null, readResource: undefined, callTool: undefined });
  };

  return {
    getSnapshot: () => router.getSnapshot(),
    getMcpState: () => mcpState,
    getMcpDiscovery: () => currentDiscovery,
    getMvp15AssetTools: () => getMvp15AssetTools(currentDiscovery, currentMvp15FacadeTools),
    getMvp15LiveAssetToolsetFingerprint: () => currentMvp15Fingerprint,
    captureMvp15McpBinding: () => currentMvp15McpBinding?.identity ?? null,
    isMvp15McpBindingCurrent: (binding) => Boolean(
      currentMvp15McpBinding
      && binding === currentMvp15McpBinding.identity
      && currentSession === currentMvp15McpBinding.session
      && currentDiscovery
      && mcpState.status === "connected"
      && mcpState.profile?.endpoint === currentMvp15McpBinding.endpoint
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
      if (endpoint !== mcpState.profile?.endpoint) {
        mcpDiscoveryGeneration += 1;
        retractMcpPublication();
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
      syncMcp();
    },
    async connectMcp() {
      const connectionGeneration = ++mcpDiscoveryGeneration;
      retractMcpPublication();
      const previousSession = currentSession;
      currentSession = null;
      const endpoint = mcpState.profile?.endpoint ?? "";
      const transportKind = mcpState.profile?.transport ?? "streamable-http";
      const isCurrentConnectionAttempt = () => (
        mcpDiscoveryGeneration === connectionGeneration
        && mcpState.profile?.endpoint === endpoint
      );

      if (!isLocalEndpoint(endpoint)) {
        void previousSession?.disconnect();
        mcpState = { ...mcpState, status: "error", lastError: "Only localhost MCP endpoints are allowed in MVP2." };
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
          const transport = options.createTransport(endpoint, transportKind);
          session = new McpSession({ transport });
          initializeResult = await session.connect();
        } else if (transportKind === "http-sse") {
          const transport = new LegacySseTransport({ endpoint, timeoutMs: 5_000 });
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
              Object.assign(transportOptions, { ["fet" + "ch"]: createNativeMcpHttpPoster(nativeInvoke, 5_000) });
            }
            const transport = new StreamableHttpTransport(transportOptions);
            session = new McpSession({ transport });
            initializeResult = await session.connect();
          } catch (error) {
            if (!isLegacyFallbackCandidate(error)) throw error;
            const transport = new LegacySseTransport({ endpoint, timeoutMs: 5_000 });
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
        invalidateMvp15McpBinding();
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
        mcpState = { ...mcpState, status: "error", lastError: "Connect to a localhost MCP endpoint before discovery." };
        syncMcp();
        return;
      }

      const discoverySession = currentSession;
      const discoveryEndpoint = mcpState.profile?.endpoint ?? "";
      const discoveryGeneration = ++mcpDiscoveryGeneration;
      const isCurrentDiscoveryAttempt = () => (
        currentSession === discoverySession
        && mcpState.profile?.endpoint === discoveryEndpoint
        && mcpDiscoveryGeneration === discoveryGeneration
      );
      retractMcpPublication();
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
        syncMcp();
      } catch (err) {
        if (!isCurrentDiscoveryAttempt()) return;
        retractMcpPublication();
        mcpState = {
          ...mcpState,
          status: "error",
          lastError: err instanceof Error ? err.message : "MCP discovery failed.",
        };
        syncMcp();
      }
    },
    disconnectMcp() {
      mcpDiscoveryGeneration += 1;
      retractMcpPublication();
      void currentSession?.disconnect();
      currentSession = null;
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
    },
    getMvp9: () => mvp9Service,
    getTextMutationAdapter: () => textMutationAdapter,
    getEditorObservationAdapter: () => editorObservationAdapter,
    guardMvp15AssetMutation: async (input) => {
      if (!nativeInvoke) {
        return { status: "blocked", reason: "native_asset_guard_unavailable", evidenceId: null };
      }
      try {
        const command = input.command === "register"
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
        return { ok: false, status: "blocked", reason: "mvp15_tool_not_allowlisted", evidenceId: null };
      }
      if (!currentSession) {
        return { ok: false, status: "blocked", reason: "mcp_session_required", evidenceId: null };
      }
      const isMutationPhase = args.execute === true || args.rollback === true;
      if (isMutationPhase) {
        const directTool = (currentDiscovery?.tools ?? []).find((tool) => tool.name === toolName);
        const directToolAvailable = directTool
          ? isCompleteMvp15AssetToolDescriptor(toMvp15AssetToolDescriptor(directTool))
          : false;
        if (!directToolAvailable) {
          return { ok: false, status: "blocked", reason: "mvp15_direct_exact_tool_required", evidenceId: null };
        }
        return currentSession.callTool(toolName, args);
      }
      const selectedDescriptor = getMvp15AssetTools(currentDiscovery, currentMvp15FacadeTools).find((tool) => tool.name === toolName);
      const wrapperCall = selectedDescriptor ? createMvp15FacadeWrapperCall(selectedDescriptor, args) : null;
      if (wrapperCall) {
        return currentSession.callTool(wrapperCall.wrapperToolName, wrapperCall.args);
      }
      return currentSession.callTool(toolName, args);
    },
    readMvp15AssetContentEvidence: async (input) => {
      if (!nativeInvoke) return blockedMvp15ContentEvidence(input.assetPath, "native_asset_evidence_unavailable");
      if (!isSafeMvp15EvidenceBinding(input) || !isCanonicalMvp15AssetPath(input.assetPath)) {
        return blockedMvp15ContentEvidence(input.assetPath, "asset_evidence_input_invalid");
      }
      try {
        const raw = await nativeInvoke("read_asset_content_evidence", { input });
        return normalizeMvp15ContentEvidence(raw, input.assetPath);
      } catch {
        return blockedMvp15ContentEvidence(input.assetPath, "native_asset_evidence_failed", "failed");
      }
    },
    snapshotMvp15AssetContentManifest: async (input) => {
      if (!nativeInvoke) return blockedMvp15ContentManifest("native_content_manifest_unavailable");
      if (!isSafeMvp15EvidenceBinding(input)) return blockedMvp15ContentManifest("content_manifest_input_invalid");
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
  const byName = new Map<string, Mvp15McpAssetToolDescriptor>();
  for (const tool of directTools) {
    byName.set(tool.name, tool);
  }
  for (const tool of facadeTools) {
    const directTool = byName.get(tool.name);
    if (!directTool || !isCompleteMvp15AssetToolDescriptor(directTool)) {
      byName.set(tool.name, tool);
    }
  }
  return [...byName.values()];
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
  if (!toolNames.has("list_toolsets") || !toolNames.has("describe_toolset") || !toolNames.has("call_tool")) {
    return { tools: [], candidates: [] };
  }
  try {
    const toolsetList = unwrapMcpToolPayload(await session.callTool("list_toolsets", {}));
    const toolsetIds = getToolsetIds(toolsetList);
    const toolsets: Mvp15ExactToolFacadeToolset[] = [];
    for (const toolsetId of toolsetIds) {
      const description = unwrapMcpToolPayload(await session.callTool("describe_toolset", { toolsetId }));
      const normalized = normalizeFacadeToolset(description, toolsetId);
      if (normalized) toolsets.push(normalized);
    }
    const facade = createMvp15ExactToolFacade(toolsets);
    return { tools: facade.tools, candidates: facade.candidates };
  } catch {
    return { tools: [], candidates: [] };
  }
}

function toMvp15AssetToolDescriptor(tool: McpDiscoverySnapshot["tools"][number]): Mvp15McpAssetToolDescriptor {
  return normalizeMvp15McpAssetToolDescriptor(tool);
}

function unwrapMcpToolPayload(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const payload = raw as { content?: unknown };
  if (!Array.isArray(payload.content)) return raw;
  const text = payload.content
    .map((item) => (item && typeof item === "object" && "text" in item ? (item as { text?: unknown }).text : null))
    .find((value): value is string => typeof value === "string" && value.trim().length > 0);
  if (!text) return raw;
  try {
    return JSON.parse(text);
  } catch {
    return raw;
  }
}

function getToolsetIds(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const record = raw as { toolsets?: unknown; toolSets?: unknown };
  const items = Array.isArray(record.toolsets) ? record.toolsets : Array.isArray(record.toolSets) ? record.toolSets : [];
  return items
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return null;
      const toolset = item as { id?: unknown; toolsetId?: unknown; toolset_id?: unknown; name?: unknown };
      return firstString(toolset.id, toolset.toolsetId, toolset.toolset_id, toolset.name);
    })
    .filter((value): value is string => Boolean(value));
}

function normalizeFacadeToolset(raw: unknown, fallbackToolsetId: string): Mvp15ExactToolFacadeToolset | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as { toolset?: unknown; toolsetId?: unknown; toolset_id?: unknown; id?: unknown; methods?: unknown };
  const source = record.toolset && typeof record.toolset === "object" ? record.toolset as typeof record : record;
  const toolsetId = firstString(source.toolsetId, source.toolset_id, source.id, fallbackToolsetId);
  if (!toolsetId) return null;
  const methods = Array.isArray(source.methods) ? source.methods : [];
  return {
    toolsetId,
    methods: methods.map(normalizeFacadeMethod).filter((method): method is Mvp15ExactToolFacadeToolset["methods"][number] => Boolean(method)),
  };
}

function normalizeFacadeMethod(raw: unknown): Mvp15ExactToolFacadeToolset["methods"][number] | null {
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
  const exactToolName = firstString(method.exactToolName, method.exact_tool_name, method.toolName, method.name);
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
  const tauriInternals = (globalThis as { __TAURI_INTERNALS__?: { invoke?: NativeInvoke } }).__TAURI_INTERNALS__;
  return tauriInternals?.invoke ?? null;
}

function isMvp15AssetToolName(toolName: string): toolName is Mvp15McpAssetToolName {
  return (MVP15_ASSET_TOOL_ALLOWLIST as readonly string[]).includes(toolName);
}

function toNativeMvp15AssetMutationInput(input: Mvp15NativeAssetGuardInput): Record<string, unknown> | null {
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
    input.command === "guard"
    || input.command === "record_outcome"
    || input.command === "cancel_registration"
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
      registrationId: safeNativeIdentifier(firstString(result.registrationId, result.registration_id)),
      operationCount: firstNumber(result.operationCount, result.operation_count) ?? undefined,
      approvalToken: safeNativeApprovalToken(firstString(result.approvalToken, result.approval_token)),
      issuedAt: firstNumber(result.issuedAt, result.issued_at) ?? undefined,
      expiresAt: firstNumber(result.expiresAt, result.expires_at) ?? undefined,
    };
  }
  if (status === "recorded") {
    return {
      status,
      reason,
      registrationId: safeNativeIdentifier(firstString(result.registrationId, result.registration_id)),
      phase: result.phase === "execute" || result.phase === "rollback" ? result.phase : null,
      operationId: safeNativeIdentifier(firstString(result.operationId, result.operation_id)),
      rollbackAvailable: firstBoolean(result.rollbackAvailable, result.rollback_available),
      terminal: firstBoolean(result.terminal),
    };
  }
  if (status === "cancelled") {
    return {
      status,
      reason,
      registrationId: safeNativeIdentifier(firstString(result.registrationId, result.registration_id)),
    };
  }
  if (status === "accepted_by_native_guard") {
    return {
      status,
      reason,
      registrationId: safeNativeIdentifier(firstString(result.registrationId, result.registration_id)),
      phase: result.phase === "execute" || result.phase === "rollback" ? result.phase : null,
      operationId: safeNativeIdentifier(firstString(result.operationId, result.operation_id)),
      operationIndex: firstNumber(result.operationIndex, result.operation_index) ?? undefined,
      operationCount: firstNumber(result.operationCount, result.operation_count) ?? undefined,
      evidenceId: safeNativeIdentifier(firstString(result.evidenceId, result.evidence_id)),
    };
  }
  return { status: status === "blocked" ? "blocked" : "failed", reason: reason ?? "native_asset_guard_invalid_result" };
}

function safeNativeApprovalToken(value: string | null): string | null {
  return value && /^[0-9a-f]{64}$/.test(value) ? value : null;
}

function normalizeMvp15ContentEvidence(raw: unknown, expectedAssetPath: string): AssetContentEvidenceObservation {
  if (!isSafeNativeEvidenceObject(raw)) return blockedMvp15ContentEvidence(expectedAssetPath, "native_asset_evidence_invalid_result", "failed");
  const result = raw as Record<string, unknown>;
  if (!hasOnlyNativeKeys(result, ["status", "reason", "assetPath", "exists", "size", "sha256", "evidenceId"])) {
    return blockedMvp15ContentEvidence(expectedAssetPath, "native_asset_evidence_invalid_result", "failed");
  }
  const reason = safeNativeReason(result.reason);
  if (result.status === "blocked" || result.status === "failed") {
    return blockedMvp15ContentEvidence(expectedAssetPath, reason ?? "native_asset_evidence_blocked", result.status);
  }
  if (
    result.status !== "observed"
    || !reason
    || result.assetPath !== expectedAssetPath
    || typeof result.exists !== "boolean"
    || typeof result.evidenceId !== "string"
    || !result.evidenceId.trim()
  ) {
    return blockedMvp15ContentEvidence(expectedAssetPath, "native_asset_evidence_invalid_result", "failed");
  }
  if (result.exists) {
    if (reason !== "asset_present" || !isSafeMvp15Size(result.size) || !isMvp15Sha256(result.sha256)) {
      return blockedMvp15ContentEvidence(expectedAssetPath, "native_asset_evidence_invalid_result", "failed");
    }
  } else if (reason !== "asset_absent" || result.size !== null || result.sha256 !== null) {
    return blockedMvp15ContentEvidence(expectedAssetPath, "native_asset_evidence_invalid_result", "failed");
  }
  return {
    status: "observed",
    reason,
    assetPath: expectedAssetPath,
    exists: result.exists,
    size: result.exists ? result.size as number : null,
    sha256: result.exists ? result.sha256 as string : null,
    evidenceId: result.evidenceId,
  };
}

function normalizeMvp15ContentManifest(raw: unknown): AssetContentManifestObservation {
  if (!isSafeNativeEvidenceObject(raw)) return blockedMvp15ContentManifest("native_content_manifest_invalid_result", "failed");
  const result = raw as Record<string, unknown>;
  if (!hasOnlyNativeKeys(result, ["status", "reason", "entries", "aggregateSha256", "evidenceId"])) {
    return blockedMvp15ContentManifest("native_content_manifest_invalid_result", "failed");
  }
  const reason = safeNativeReason(result.reason);
  if (result.status === "blocked" || result.status === "failed") {
    return blockedMvp15ContentManifest(reason ?? "native_content_manifest_blocked", result.status);
  }
  if (
    result.status !== "observed"
    || reason !== "content_manifest_captured"
    || !Array.isArray(result.entries)
    || !isMvp15Sha256(result.aggregateSha256)
    || typeof result.evidenceId !== "string"
    || !result.evidenceId.trim()
  ) {
    return blockedMvp15ContentManifest("native_content_manifest_invalid_result", "failed");
  }
  const entries: AssetContentManifestObservation["entries"] = [];
  let previousPath = "";
  for (const item of result.entries) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return blockedMvp15ContentManifest("native_content_manifest_invalid_result", "failed");
    const entry = item as Record<string, unknown>;
    if (!hasOnlyNativeKeys(entry, ["assetPath", "size", "sha256"])) return blockedMvp15ContentManifest("native_content_manifest_invalid_result", "failed");
    if (!isCanonicalMvp15AssetPath(entry.assetPath) || !isSafeMvp15Size(entry.size) || !isMvp15Sha256(entry.sha256)) {
      return blockedMvp15ContentManifest("native_content_manifest_invalid_result", "failed");
    }
    if (previousPath && entry.assetPath <= previousPath) return blockedMvp15ContentManifest("native_content_manifest_invalid_result", "failed");
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
  return typeof value === "string"
    && value.length > 0
    && value.length <= 256
    && !/[\\/\r\n\t]/.test(value)
    && !/^[A-Za-z]:/.test(value);
}

function isCanonicalMvp15AssetPath(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith("/Game/")
    && value.length > "/Game/".length
    && !value.includes("\\")
    && !value.includes("//")
    && !value.includes("..")
    && !value.includes(":")
    && !value.includes(".")
    && value.split("/").slice(2).every((segment) => Boolean(segment));
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
  return typeof value === "string"
    && value.length > 0
    && value.length <= 512
    && /^[A-Za-z0-9:._-]+$/.test(value)
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
    return /^[A-Za-z]:[\\/]/.test(value)
      || /^\\\\/.test(value)
      || /^file:/i.test(value)
      || (value.startsWith("/") && !value.startsWith("/Game/"))
      || /approval.?token|trusted.?project.?root|pid.?hash|editor.?session|\bsk-[a-z0-9_-]{8,}/i.test(value);
  }
  if (Array.isArray(value)) return value.some(containsSensitiveNativeEvidence);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => (
    /approval.?token|trusted.?project.?root|pid.?hash|editor.?session/i.test(key)
    || containsSensitiveNativeEvidence(nested)
  ));
}

function firstNumber(...values: unknown[]): number | null {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value)) ?? null;
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
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]";
  } catch {
    return false;
  }
}
