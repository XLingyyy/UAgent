import {
  createProviderRuntimeSession,
  createProviderRuntimeError,
  type OutboundConsentGate,
  type OutboundEnvelope,
  type OutboundSendIntent,
  type ProviderAdapter,
  type ProviderCallOptions,
  type RunScopeLease,
} from "@uagent/runtime";
import type {
  ProviderContinuationOwner,
  ProviderNativeContinuation,
  ProviderRuntimeRequest,
} from "@uagent/shared";
import type { NativeInvoke } from "./project-native-adapter";
import { createNativeProjectMemoryDispatch, type NativeProjectMemoryDispatch, type NativeMemoryDispatchCompletion } from "./native-project-memory-dispatch";
import { PROJECT_MEMORY_MESSAGE_PREFIX, parseProjectMemorySelectedRevisions, parseProjectMemoryUniqueJson,
  type ProjectMemoryDispatchOwner } from "../../../../../packages/runtime/src/project-memory/dispatch-contract";
import type { ProviderVersion } from "../types/provider";

const RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
const MAX_BYTES = 4_194_304;
const MAX_CHUNKS = 4096;
const MAX_CHUNK_BYTES = 65_536;
const MEMORY_CLEANUP_MS = 2000;
export type NativeResponsesDispatchStatus = "notDispatched" | "mayHaveBeenSent" | "sent";
function dispatchStatus(value: unknown): value is NativeResponsesDispatchStatus {
  return value === "notDispatched" || value === "mayHaveBeenSent" || value === "sent";
}

interface ProfileReceipt {
  profileId: string;
  providerId: string;
  modelId: string;
  endpoint: string;
  expiresAt: number;
  fixture: boolean;
  nativeProjectMemoryDispatch?: boolean;
  modelSettings?: {
    supportsReasoning: boolean;
    requestDefaults: { temperature: number | null; maxOutputTokens: number | null };
  };
}
interface MemoryScopeReceipt {
  scopeId: string; projectId: string; runId: string; conversationId: string;
  readPrefixes: string[]; sharePrefixes: string[]; maxContextBytes: number;
  expiresAt: number; productionMemoryDispatchEnabled: boolean;
}
interface RunReceipt {
  runHandle: string;
  owner: ProviderContinuationOwner;
}
interface PreparedReceipt {
  requestId: string;
  endpoint: string;
  modelId: string;
  bodySha256: string;
}
interface ResponseHead {
  status: number;
  contentType: string;
}
interface PollReceipt {
  cursor: number;
  nextCursor: number;
  chunks: number[][];
  head: ResponseHead | null;
  done: boolean;
  error: string | null;
  dispatchStatus: "notDispatched" | "mayHaveBeenSent" | "sent";
}
export interface NativeResponsesProfileOptions {
  wireApi?: "responses" | "anthropic";
  invoke: NativeInvoke;
  providerId: string;
  modelId: string;
  /** Legacy one-off memory input, or a nonsecret marker for saved mode. */
  credential: string;
  /** Native vault mutation token; never a credential or reusable send grant. */
  savedVersion?: string;
  savedProviderVersion?: Readonly<ProviderVersion>;
  gate: OutboundConsentGate;
  signal?: AbortSignal;
  now?: () => number;
}
export interface NativeResponsesRunOptions {
  /** The actual ephemeral lease object, not a deserialized scope description. */
  lease: RunScopeLease;
  /** Existing trusted project owner callback; native assigns the data epoch. */
  getProjectContext: () => { projectId: string | null; revision: string };
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
}
export interface NativeResponsesConversationOptions {
  projectId:string|null;
  conversationId:string;
  /** Captured live controller authority; never rebuilt from an archive. */
  isCurrent:()=>boolean;
  getProjectContext:()=>{projectId:string|null;revision:string};
}
function terminalUnsentProof(value: PollReceipt | null, cursor: number): boolean {
  return (
    !!value &&
    value.cursor === cursor &&
    value.nextCursor === cursor &&
    value.done === true &&
    value.dispatchStatus === "notDispatched" &&
    typeof value.error === "string" &&
    value.error.length > 0 &&
    value.head === null &&
    Array.isArray(value.chunks) &&
    value.chunks.length === 0
  );
}
export function validResponsesCredential(value: string): boolean {
  return value.length >= 8 && value.length <= 16384 && !/[^\x21-\x7e]/.test(value);
}
function validModelSettings(value: ProfileReceipt["modelSettings"]): boolean {
  if (!value || typeof value.supportsReasoning !== "boolean" || !value.requestDefaults) return false;
  const { temperature, maxOutputTokens } = value.requestDefaults;
  return (temperature === null || (typeof temperature === "number" && Number.isFinite(temperature) && temperature >= 0 && temperature <= 2)) &&
    (maxOutputTokens === null || (Number.isSafeInteger(maxOutputTokens) && maxOutputTokens! > 0));
}
function failure(): Error {
  // Native/transport exceptions are deliberately never copied into renderer errors.
  return new Error("native_responses_unavailable");
}
function cancelled(): DOMException {
  return new DOMException("Native Responses request cancelled.", "AbortError");
}
function id(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    Array.from(value).every((char) => {
      const code = char.charCodeAt(0);
      return code > 0x20 && (code < 0x7f || code > 0x9f);
    })
  );
}
function sameOwner(a: ProviderContinuationOwner, b: ProviderContinuationOwner): boolean {
  return (
    a.providerId === b.providerId &&
    a.modelId === b.modelId &&
    a.projectId === b.projectId &&
    a.projectEpoch === b.projectEpoch &&
    a.runId === b.runId &&
    a.conversationId === b.conversationId
  );
}
async function sha256(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function pause(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(cancelled());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, 25);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Explicit memory-only profile, with a new protocol adapter for each actual run lease.
 * All request I/O uses native IPC. This module never calls browser/global fetch.
 * Native handles and continuation descriptions do not confer authorization.
 */
export async function createNativeResponsesProfile(options: NativeResponsesProfileOptions) {
  if (["responses","anthropic"].includes(options.wireApi ?? "responses")) throw Error("provider_api_archived");
  const anthropic=options.wireApi==="anthropic";
  if(anthropic)throw failure(); // Archived product API; no profile or IPC is created.
  const ENDPOINT=anthropic?"https://api.anthropic.com/v1/messages":RESPONSES_ENDPOINT;
  if(anthropic&&options.savedVersion)throw failure();
  const invoke = options.invoke,
    providerId = options.providerId,
    modelId = options.modelId,
    gate = options.gate,
    now = options.now ?? Date.now,
    openingSignal = options.signal;
  const savedVersion = options.savedVersion;
  const savedProviderVersion = options.savedProviderVersion ? Object.freeze({...options.savedProviderVersion}) : undefined;
  let credential = savedVersion ? "native-saved-responses-parser-marker" : options.credential;
  if (
    !id(providerId) ||
    !id(modelId) ||
    !validResponsesCredential(credential) ||
    (savedVersion !== undefined && (!id(savedVersion) || !savedProviderVersion || savedProviderVersion.providerId !== providerId || !savedProviderVersion.exists || !id(savedProviderVersion.generation) || !Number.isSafeInteger(savedProviderVersion.revision) || savedProviderVersion.revision < 0)) ||
    openingSignal?.aborted
  )
    throw failure();
  async function call<T>(command: string, input: unknown): Promise<T> {
    try {
      return await invoke<T>(command, { input });
    } catch {
      throw failure();
    }
  }
  let profile: ProfileReceipt;
  try {
    profile = savedVersion
      ? await call<ProfileReceipt>("open_saved_native_responses_profile", {providerId, modelId, expectedVaultVersion: savedVersion, expectedProviderVersion: savedProviderVersion})
      : await call<ProfileReceipt>("open_native_responses_profile", {providerId, modelId, credential});
  } catch (error) {
    credential = "";
    throw error;
  }
  const validProfile =
    profile &&
    id(profile.profileId) &&
    profile.providerId === providerId &&
    profile.modelId === modelId &&
    profile.endpoint === ENDPOINT &&
    typeof profile.fixture === "boolean" &&
    (profile.nativeProjectMemoryDispatch === undefined || typeof profile.nativeProjectMemoryDispatch === "boolean") &&
    (profile.fixture || validModelSettings(profile.modelSettings)) &&
    Number.isSafeInteger(profile.expiresAt) &&
    profile.expiresAt > now() &&
    profile.expiresAt - now() <= 3_600_000 &&
    !profile.profileId.includes(credential);
  if (!validProfile || openingSignal?.aborted) {
    credential = "";
    if (profile && id(profile.profileId))
      await call("close_native_responses_profile", { profileId: profile.profileId }).catch(
        () => undefined,
      );
    throw failure();
  }
  let closed = false;
  let requestOrdinal = 0;
  let lastDispatchStatus: NativeResponsesDispatchStatus = "notDispatched";
  const sessions = new Set<ReturnType<typeof createProviderRuntimeSession>>();
  const cancelRuns = new Set<() => void>();
  let closing: Promise<void> | null = null;
  let closeAcknowledgement: Promise<void> | null = null;
  const expiry = setTimeout(
    () => {
      void close();
    },
    Math.max(0, profile.expiresAt - now()),
  );
  function checkProfile() {
    if (closed || !credential || now() >= profile.expiresAt) {
      void close();
      throw cancelled();
    }
  }
  function close(): Promise<void> {
    if (closing) return closing;
    closed = true;
    credential = "";
    clearTimeout(expiry);
    for (const cancel of cancelRuns) cancel();
    for (const session of sessions) session.dispose();
    sessions.clear();
    cancelRuns.clear();
    closeAcknowledgement = call("close_native_responses_profile", {
      profileId: profile.profileId,
    }).then(() => undefined);
    // Expiry/unload callers keep a handled best-effort close, while explicit
    // transition barriers observe the original acknowledgement failure.
    closing = closeAcknowledgement.catch(() => undefined);
    return closing;
  }
  return {
    /** Connectivity remains unverified until separately observed; opening is never a test. */
    getSnapshot: () =>
      Object.freeze({
        ready: !closed && now() < profile.expiresAt,
        providerId,
        modelId,
        endpoint: ENDPOINT,
        expiresAt: profile.expiresAt,
        connectionVerified: false as const,
        fixture: profile.fixture,
        modelSettings: profile.modelSettings ? Object.freeze({
          supportsReasoning: profile.modelSettings.supportsReasoning,
          requestDefaults: Object.freeze({ ...profile.modelSettings.requestDefaults }),
        }) : undefined,
        lastDispatchStatus,
        savedCredential: savedVersion !== undefined,
        savedKeyVersion: savedVersion ?? null,
      }),
    close,
    closeAcknowledged(): Promise<void> {
      void close();
      return closeAcknowledgement!;
    },
    createRunAdapter(runOptions: NativeResponsesRunOptions):ProviderAdapter {return createBoundAdapter(runOptions);},
    createConversationAdapter(runOptions:NativeResponsesConversationOptions):ProviderAdapter {return createBoundAdapter(runOptions);},
  };
  function createBoundAdapter(runOptions:NativeResponsesRunOptions|NativeResponsesConversationOptions):ProviderAdapter {
      checkProfile();
      const chat=!("lease" in runOptions);
      if (savedVersion && !chat) throw failure();
      const isCurrent=chat?runOptions.isCurrent:runOptions.lease.isCurrent,
        getProjectContext=runOptions.getProjectContext,
        logicalProject=chat?runOptions.projectId:runOptions.lease.scope.projectId,
        scope=chat?{providerId,modelId,endpoint:ENDPOINT,projectId:logicalProject===null?"chat:local":"chat:project:"+logicalProject,runId:"",conversationId:runOptions.conversationId}:runOptions.lease.scope,
        scopeExpiresAt=chat?Math.min(profile.expiresAt,now()+600000):runOptions.lease.scope.expiresAt;
      if(chat&&(!id(scope.conversationId)||(logicalProject!==null&&!id(logicalProject))))throw failure();
      if (
        scope.providerId !== providerId ||
        scope.modelId !== modelId ||
        scope.endpoint !== ENDPOINT ||
        !id(scope.projectId) ||
        (!chat&&!id(scope.runId)) ||
        !id(scope.conversationId) ||
        !Number.isSafeInteger(scopeExpiresAt) ||
        scopeExpiresAt <= now()
      )
        throw failure();
      const runAbort = new AbortController();
      let memoryMode: boolean | null = null;
      let memoryScopeId: string | null = null, memoryExpiresAt = 0;
      let memoryScopeRevocation: Promise<boolean> | null = null;
      let preparingMemory: NativeProjectMemoryDispatch | null = null;
      async function memoryCleanupCall(command: string, input: unknown, deadline: number): Promise<void> {
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          // Invoke once even when the shared waiting budget is spent. A timeout
          // is uncertainty, never native stop proof or authorization to retry.
          await Promise.race([call(command, input), new Promise<never>((_, reject) => {
            timeout = setTimeout(() => reject(failure()), Math.max(0, Math.min(MEMORY_CLEANUP_MS, deadline - performance.now())));
          })]);
        } finally { if (timeout !== undefined) clearTimeout(timeout); }
      }
      function revokeMemoryScope(deadline = performance.now() + MEMORY_CLEANUP_MS): Promise<boolean> {
        if (memoryScopeRevocation) return memoryScopeRevocation;
        if (!memoryScopeId) return Promise.resolve(true);
        return memoryScopeRevocation = memoryCleanupCall("revoke_native_project_memory_scope", { scopeId: memoryScopeId }, deadline)
          .then(() => true, () => false);
      }
      cancelRuns.add(() => runAbort.abort());
      function check(signal?: AbortSignal) {
        checkProfile();
        if (
          runAbort.signal.aborted ||
          signal?.aborted ||
          !isCurrent() ||
          getProjectContext().projectId !== logicalProject
        ) {
          runAbort.abort();
          throw cancelled();
        }
      }
      type Pending = {
        requestId: string;
        body: string;
        envelope: string;
        consumed: boolean;
        approved: boolean;
        dispatched: boolean;
        cleanup: Promise<void> | null;
        cleanupDeadline: number | null;
        detachSignal?: () => void;
        ordinal: number;
        cursor: number;
        status: NativeResponsesDispatchStatus;
        bodySha256: string;
        memory: NativeProjectMemoryDispatch | null;
        terminalSuccess: NativeMemoryDispatchCompletion | null;
      };
      let pending: Pending | null = null;
      let lastRunDispatchStatus: NativeResponsesDispatchStatus = "notDispatched";
      function rememberStatus(
        request: Pending,
        status: NativeResponsesDispatchStatus,
        terminalProof = false,
      ) {
        // A confirmed complete write can never become an unsent request later.
        if (request.status === "sent" && status !== "sent") return;
        // A scheduled dispatch may outlive lost acknowledgements. Neither an
        // unsuccessful cancel nor a nonterminal zero status proves an unsent call.
        if (request.dispatched && status === "notDispatched" && !terminalProof) return;
        request.status = status;
        lastRunDispatchStatus = status;
        if (request.ordinal === requestOrdinal) lastDispatchStatus = status;
      }
      function tagged(error: unknown): unknown {
        const safe = error && typeof error === "object" ? error : failure();
        try {
          Object.defineProperty(safe, "dispatchStatus", {
            value: lastRunDispatchStatus,
            enumerable: true,
            configurable: true,
          });
        } catch {
          /* Static status also remains in profile snapshot. */
        }
        return safe;
      }
      async function cleanup(request: Pending, cancel: boolean) {
        if (request.cleanup) return request.cleanup;
        request.detachSignal?.();
        // Publish the one cleanup promise before callbacks can synchronously
        // abort the run and reenter this function.
        request.cleanup = Promise.resolve().then(async () => {
          let cleanupFailed = false;
          const deadline = performance.now() + MEMORY_CLEANUP_MS;
          request.cleanupDeadline = deadline;
          if (request.memory) {
            let detached = false;
            if (!cancel && request.terminalSuccess) {
              try { request.memory.complete(request.terminalSuccess); detached = true; }
              catch { cleanupFailed = true; }
            }
            if (!detached) {
              const cancelling = request.memory.cancel();
              runAbort.abort();
              const result = await cancelling;
              rememberStatus(request, result.dispatchStatus, result.cancellation === "confirmed");
              if (!await revokeMemoryScope(deadline)) cleanupFailed = true;
              if (!cancel) cleanupFailed = true;
            }
          } else if (cancel) {
            await call("cancel_native_responses_request", { requestId: request.requestId }).catch(
              () => undefined,
            );
            // Read only the final send fact after cancellation; never release stale bytes.
            const final = await call<PollReceipt>("poll_native_responses_request", {
              requestId: request.requestId,
              cursor: request.cursor,
            }).catch(() => null);
            if (final && dispatchStatus(final.dispatchStatus))
              rememberStatus(
                request,
                final.dispatchStatus,
                terminalUnsentProof(final, request.cursor),
              );
          }
          try {
            if (request.memory) await memoryCleanupCall("release_native_responses_request", { requestId: request.requestId }, deadline);
            else await call("release_native_responses_request", { requestId: request.requestId });
          } catch { if (request.memory) { cleanupFailed = true; runAbort.abort(); } }
          if (pending === request) pending = null;
          if (cleanupFailed) { await revokeMemoryScope(deadline); throw failure(); }
        });
        return request.cleanup;
      }
      const stop = () => {
        if (pending) void cleanup(pending, true).catch(() => undefined);
        else if (preparingMemory) void preparingMemory.cancel();
        if (memoryMode) void revokeMemoryScope(pending?.cleanupDeadline ?? performance.now() + MEMORY_CLEANUP_MS);
      };
      runAbort.signal.addEventListener("abort", stop, { once: true });
      let ready: Promise<ReturnType<typeof createProviderRuntimeSession>> | null = null;
      let nativeOwner:ProviderContinuationOwner|null=null;
      let logicalRequestId:string|null=null;
      async function initialize() {
        check();
        let bound: RunReceipt;
        if (memoryMode) {
          if (!("lease" in runOptions) || chat || profile.fixture || savedVersion || profile.nativeProjectMemoryDispatch !== true) throw failure();
          const originalScope = runOptions.lease.scope;
          const expiresAt = Math.min(scopeExpiresAt, profile.expiresAt, now() + 600_000);
          try {
            const receipt = await call<MemoryScopeReceipt>("authorize_native_project_memory_scope", {
              profileId: profile.profileId, projectId: scope.projectId, runId: scope.runId,
              conversationId: scope.conversationId, readPrefixes: originalScope.readPrefixes,
              sharePrefixes: originalScope.sharePrefixes, expiresAt,
            });
            // Capture a returned ID even on an invalid/late reply so it can be revoked.
            if (receipt && id(receipt.scopeId)) memoryScopeId = receipt.scopeId;
            if (!receipt || !memoryScopeId || receipt.projectId !== scope.projectId || receipt.runId !== scope.runId ||
                receipt.conversationId !== scope.conversationId || receipt.productionMemoryDispatchEnabled !== true ||
                JSON.stringify(receipt.readPrefixes) !== JSON.stringify(originalScope.readPrefixes) ||
                JSON.stringify(receipt.sharePrefixes) !== JSON.stringify(originalScope.sharePrefixes) ||
                receipt.maxContextBytes !== 24576 || !Number.isSafeInteger(receipt.expiresAt) ||
                receipt.expiresAt <= now() || receipt.expiresAt > expiresAt) throw failure();
            memoryExpiresAt = receipt.expiresAt;
            check();
            bound = await call<RunReceipt>("bind_native_project_memory_run", {
              schemaVersion: 1, profileId: profile.profileId, projectId: scope.projectId,
              runId: scope.runId, conversationId: scope.conversationId,
              memoryScopeId, scopeExpiresAt: memoryExpiresAt,
            });
          } catch (error) { runAbort.abort(); await revokeMemoryScope(); throw error; }
        } else {
          bound = chat?await call<RunReceipt>("bind_native_responses_conversation",{profileId:profile.profileId,projectId:logicalProject,conversationId:scope.conversationId}):await call<RunReceipt>("bind_native_responses_run", {
            profileId: profile.profileId,projectId: scope.projectId,runId: scope.runId,scopeExpiresAt,
          });
        }
        check();
        const owner = bound?.owner;
        if (
          !bound ||
          !id(bound.runHandle) ||
          !owner ||
          owner.providerId !== providerId ||
          owner.modelId !== modelId ||
          owner.projectId !== scope.projectId ||
          (!chat&&owner.runId !== scope.runId) ||
          !id(owner.runId) ||
          owner.conversationId !== scope.conversationId ||
          !Number.isSafeInteger(owner.projectEpoch) ||
          owner.projectEpoch < 0 ||
          Object.values(owner).some(
            (field) => typeof field === "string" && field.includes(credential),
          )
        ) {
          if (memoryMode) { runAbort.abort(); await revokeMemoryScope(); }
          throw failure();
        }
        nativeOwner=owner;
        const memoryOwner: ProjectMemoryDispatchOwner = Object.freeze({runHandle:bound.runHandle,
          runId:owner.runId,projectId:owner.projectId,projectEpoch:owner.projectEpoch,providerId:owner.providerId,modelId:owner.modelId});
        const memoryIdentity = {};

        const context = () => {
          check();
          const current = getProjectContext();
          if (typeof current.revision !== "string" || !current.revision) throw failure();
          return {
            projectId: owner.projectId,
            epoch: owner.projectEpoch,
            revision: current.revision,
          };
        };
        const nativeGate: OutboundConsentGate = {
          getPending: () => gate.getPending(),
          subscribe: (listener) => gate.subscribe(listener),
          approve: (reviewId) => gate.approve(reviewId),
          invalidate: () => {
            gate.invalidate();
            if (memoryMode) runAbort.abort(); else stop();
          },
          async review(envelope: OutboundEnvelope, signal?: AbortSignal, intent?: OutboundSendIntent) {
            check(signal);
            if (
              pending ||
              envelope.endpoint !== ENDPOINT ||
              envelope.model !== modelId ||
              envelope.projectId !== owner.projectId ||
              envelope.epoch !== owner.projectEpoch ||
              typeof envelope.body !== "string"
            )
              throw failure();
            let receipt: PreparedReceipt;
            let memory: NativeProjectMemoryDispatch | null = null;
            try {
              if (memoryMode) {
                const wire = parseProjectMemoryUniqueJson(envelope.body) as { input?: Array<{content?: Array<{text?: unknown}>}> };
                const text = wire?.input?.[2]?.content?.[0]?.text;
                if (typeof text !== "string" || !text.startsWith(PROJECT_MEMORY_MESSAGE_PREFIX)) throw failure();
                const members = parseProjectMemoryUniqueJson(text.slice(PROJECT_MEMORY_MESSAGE_PREFIX.length));
                if (!Array.isArray(members)) throw failure();
                const selected = parseProjectMemorySelectedRevisions(members.map(member => ({id:member?.id,revision:member?.revision})));
                memory = createNativeProjectMemoryDispatch({invoke:(command,args)=>invoke(command,args), owner:memoryOwner,
                  expiresAt:memoryExpiresAt, now, signal:signal ?? runAbort.signal,
                  getCurrentContext:()=>{check(signal); return {identity:memoryIdentity,owner:memoryOwner};}});
                preparingMemory = memory;
                await memory.select(selected);
                const prepared = await memory.prepare(envelope.body);
                receipt = {requestId:prepared.requestId,endpoint:prepared.endpoint,modelId,bodySha256:prepared.bodySha256};
              } else {
                receipt = await call<PreparedReceipt>("prepare_native_responses_request", {
                  runHandle: bound.runHandle, body: envelope.body, ...(chat?{logicalRequestId}:{}),
                });
              }
            } catch (error) {
              if (memory) { await memory.cancel(); runAbort.abort(); await revokeMemoryScope(); }
              throw error;
            } finally { if (preparingMemory === memory) preparingMemory = null; }
            const request: Pending = {
              requestId: receipt?.requestId,
              body: envelope.body,
              envelope: JSON.stringify(envelope),
              consumed: false,
              approved: false,
              dispatched: false,
              cleanup: null,
              cleanupDeadline: null,
              ordinal: ++requestOrdinal,
              cursor: 0,
              status: "notDispatched",
              bodySha256: receipt?.bodySha256,
              memory,
              terminalSuccess: null,
            };
            // An uncertain preparation cannot be retried automatically.
            if (!receipt || !id(receipt.requestId)) throw failure();
            pending = request;
            rememberStatus(request, "notDispatched");
            const abort = () => {
              void cleanup(request, true).catch(() => undefined);
            };
            signal?.addEventListener("abort", abort, { once: true });
            request.detachSignal = () => signal?.removeEventListener("abort", abort);
            try {
              check(signal);
              if (
                receipt.endpoint !== ENDPOINT ||
                receipt.modelId !== modelId ||
                !/^[a-fA-F0-9]{64}$/.test(receipt.bodySha256) ||
                receipt.bodySha256.toLowerCase() !== (await sha256(envelope.body))
              )
                throw failure();
              check(signal);
              const grant = await gate.review(envelope, signal, intent);
              check(signal);
              if (request.memory) await request.memory.approve();
              else await call("approve_native_responses_request", { requestId: request.requestId });
              check(signal);
              request.approved = true;
              return {
                consume(current) {
                  try {
                    check(signal);
                    if (
                      pending !== request ||
                      request.cleanup ||
                      request.consumed ||
                      JSON.stringify(current) !== request.envelope ||
                      !grant.consume(current)
                    ) {
                      void cleanup(request, true).catch(() => undefined);
                      return false;
                    }
                    request.consumed = true;
                    return true;
                  } catch {
                    void cleanup(request, true).catch(() => undefined);
                    return false;
                  }
                },
              };
            } catch {
              await cleanup(request, true);
              throw cancelled();
            }
          },
        };
        const fetcher: typeof fetch = async (input, init) => {
          const request = pending,
            signal = init?.signal ?? undefined;
          check(signal ?? undefined);
          const url = typeof input === "string" ? input : input instanceof URL ? input.href : "";
          const headers = new Headers(init?.headers);
          if (
            !request ||
            request.cleanup ||
            !request.approved ||
            !request.consumed ||
            request.dispatched ||
            url !== ENDPOINT ||
            init?.method !== "POST" ||
            init.body !== request.body ||
            init.redirect !== "error" ||
            (anthropic ? headers.get("x-api-key")!==credential || headers.get("anthropic-version")!=="2023-06-01" : headers.get("authorization") !== "Bearer " + credential) ||
            headers.get("content-type") !== "application/json" ||
            !["text/event-stream", "application/json"].includes(headers.get("accept") ?? "")
          ) {
            if (request) await cleanup(request, true);
            throw failure();
          }
          request.dispatched = true;
          let cursor = 0,
            bytes = 0,
            head: ResponseHead | null = null,
            completed = false,
            controllerSettled = false,
            streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
          let httpFailure: ReturnType<typeof createProviderRuntimeError> | null = null;
          const abort = () => {
            if (!completed) {
              completed = true;
              if (streamController && !controllerSettled) {
                controllerSettled = true;
                streamController.error(cancelled());
              }
              void cleanup(request, true).catch(() => undefined);
            }
          };
          signal?.addEventListener("abort", abort, { once: true });
          runAbort.signal.addEventListener("abort", abort, { once: true });
          const finish = async (cancel: boolean) => {
            signal?.removeEventListener("abort", abort);
            runAbort.signal.removeEventListener("abort", abort);
            await cleanup(request, cancel);
          };
          async function poll(): Promise<{ chunks: Uint8Array[]; done: boolean }> {
            check(signal ?? undefined);
            const result = await call<PollReceipt>("poll_native_responses_request", {
              requestId: request!.requestId,
              cursor,
            });
            check(signal ?? undefined);
            if (
              !result ||
              result.cursor !== cursor ||
              !Array.isArray(result.chunks) ||
              !Number.isSafeInteger(result.nextCursor) ||
              result.nextCursor !== cursor + result.chunks.length ||
              result.nextCursor > MAX_CHUNKS ||
              typeof result.done !== "boolean" ||
              (result.error !== null && typeof result.error !== "string") ||
              !["notDispatched", "mayHaveBeenSent", "sent"].includes(result.dispatchStatus)
            )
              throw failure();
            rememberStatus(request!, result.dispatchStatus, terminalUnsentProof(result, cursor));
            if (result.done && result.error === "native_transport_failed" && result.chunks.length === 0 &&
                result.dispatchStatus !== "notDispatched" && result.head &&
                Number.isInteger(result.head.status) && result.head.status >= 400 && result.head.status <= 599 &&
                result.head.contentType === "application/json" &&
                (!head || JSON.stringify(head) === JSON.stringify(result.head))) {
              const status = result.head.status;
              httpFailure = createProviderRuntimeError(providerId,
                status === 401 || status === 403 ? "auth_missing" : status === 429 ? "rate_limited" :
                  status >= 500 ? "provider_unavailable" : "malformed_response",
                "Responses returned HTTP " + status + ". No automatic retry was sent.");
              throw httpFailure;
            }
            if (
              result.error !== null ||
              (result.dispatchStatus === "notDispatched" &&
                (result.done || result.head !== null || result.chunks.length > 0))
            )
              throw failure();
            if (result.head) {
              const candidate = result.head;
              if (
                !Number.isInteger(candidate.status) ||
                candidate.status < 200 ||
                candidate.status > 599 ||
                [204, 205, 304].includes(candidate.status) ||
                typeof candidate.contentType !== "string" ||
                candidate.contentType.length > 128 ||
                /[\r\n]/.test(candidate.contentType) ||
                !["text/event-stream", "application/json"].includes(
                  candidate.contentType.split(";")[0].trim().toLowerCase(),
                ) ||
                (head && JSON.stringify(head) !== JSON.stringify(candidate))
              )
                throw failure();
              // A numeric rejection head is not a terminal proof until the worker closes.
              if (candidate.status >= 400 && !result.done) {
                if (result.chunks.length) throw failure();
                return { chunks: [], done: false };
              }
              head = { status: candidate.status, contentType: candidate.contentType };
            }
            const chunks = result.chunks.map((chunk) => {
              if (
                !Array.isArray(chunk) ||
                chunk.length > MAX_CHUNK_BYTES ||
                chunk.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)
              )
                throw failure();
              bytes += chunk.length;
              if (bytes > MAX_BYTES) throw failure();
              return new Uint8Array(chunk);
            });
            cursor = result.nextCursor;
            request!.cursor = cursor;
            if (!head && chunks.length) throw failure();
            if (result.done && !head) throw failure();
            if (request!.memory && result.done) {
              if (result.error !== null || result.dispatchStatus !== "sent") throw failure();
              const batchId = request!.memory.snapshot().batchId;
              if (!batchId) throw failure();
              request!.terminalSuccess = {batchId,requestId:request!.requestId,bodySha256:request!.bodySha256,
                done:true,error:null,dispatchStatus:"sent"};
            }
            return { chunks, done: result.done };
          }
          try {
            check(signal ?? undefined);
            // The IPC outcome may be uncertain before the first native poll.
            // Conservatively report possible transmission until native refines it.
            rememberStatus(request, "mayHaveBeenSent");
            if (request.memory) await request.memory.dispatch();
            else await call("dispatch_native_responses_request", { requestId: request.requestId });
            check(signal ?? undefined);
            let initial = await poll();
            while (!head) {
              await pause(signal ?? undefined);
              initial = await poll();
            }
            const responseHead = head as ResponseHead;
            const body = new ReadableStream<Uint8Array>({
              start(controller) {
                streamController = controller;
                void (async () => {
                  try {
                    let batch = initial;
                    while (true) {
                      check(signal ?? undefined);
                      if (completed) return;
                      for (const chunk of batch.chunks) controller.enqueue(chunk);
                      if (batch.done) {
                        completed = true;
                        await finish(false);
                        if (!controllerSettled) { controllerSettled = true; controller.close(); }
                        return;
                      }
                      await pause(signal ?? undefined);
                      batch = await poll();
                    }
                  } catch {
                    completed = true;
                    // Polling may already be stopped while terminal cleanup is
                    // still pending. Always settle an unclosed consumer on error.
                    if (!controllerSettled) { controllerSettled = true; controller.error(failure()); }
                    await finish(true).catch(() => undefined);
                  }
                })();
              },
              async cancel() {
                completed = true;
                controllerSettled = true;
                await finish(true);
              },
            });
            return new Response(body, {
              status: responseHead.status,
              headers: { "Content-Type": responseHead.contentType },
            });
          } catch {
            completed = true;
            await finish(true).catch(() => undefined);
            throw httpFailure ?? failure();
          }
        };
        const session = createProviderRuntimeSession({
          wireApi: anthropic ? "anthropic" : "responses",
          disableNativeReplay:chat || memoryMode === true,
          providerId,
          modelId,
          endpoint: ENDPOINT,
          mode: "live",
          owner,
          isCurrent,
          getProjectContext: context,
          fetcher,
          outboundGate: nativeGate,
          reasoningEffort: "reasoningEffort" in runOptions?runOptions.reasoningEffort:undefined,
          continuationStore: {
            async load(query, signal) {
              check(signal);
              if (!sameOwner(query, owner)) throw failure();
              const records = await call<ProviderNativeContinuation[]>(
                "load_native_provider_continuations",
                { runHandle: bound.runHandle },
              );
              check(signal);
              if (!Array.isArray(records)) throw failure();
              return records;
            },
            async save(record, signal) {
              check(signal);
              if (!sameOwner(record.owner, owner)) throw failure();
              await call("save_native_provider_continuation", {
                runHandle: bound.runHandle,
                record,
              });
              check(signal);
            },
          },
        });
        check();
        session.setCredential(credential);
        const base=session.adapter;
        async function persistAnthropic(requestId:string,responseId:string,text:string){
          if(!anthropic||!chat)return;
          try{check();await call("complete_native_anthropic_chat",{runHandle:bound.runHandle,requestId,responseId,text});check();}
          catch(error){runAbort.abort();throw error;}
        }
        const wrapped=anthropic?{...session,adapter:{...base,
          async complete(request:ProviderRuntimeRequest,callOptions?:ProviderCallOptions){const result=await base.complete(request,callOptions);await persistAnthropic(request.id,result.id,result.text);return result;},
          async *stream(request:ProviderRuntimeRequest,callOptions?:ProviderCallOptions){let text="";for await(const chunk of base.stream!(request,callOptions)){text+=chunk.delta;if(chunk.done){const responseId=(chunk as {responseId?:string}).responseId;if(!responseId)throw failure();await persistAnthropic(request.id,responseId,text);}yield chunk;}}
        }}:session;
        sessions.add(wrapped);
        return wrapped;
      }
      async function selected(request: ProviderRuntimeRequest, callOptions?: ProviderCallOptions) {
        check(callOptions?.signal);
        if (
          request.providerId !== providerId ||
          request.modelId !== modelId ||
          (!chat&&request.metadata?.runId !== undefined && request.metadata.runId !== scope.runId) ||
          (request.metadata?.projectId !== undefined && request.metadata.projectId !== logicalProject) ||
          (chat&&(request.metadata?.conversationId!==scope.conversationId||request.tools?.length||request.messages.some(m=>m.role==="tool"||m.toolCalls?.length||m.toolCallId)))
        )
          throw failure();
        const wantsMemory = !chat && request.messages.some(message => message.content.includes(PROJECT_MEMORY_MESSAGE_PREFIX));
        if ((wantsMemory && (anthropic || profile.fixture || savedVersion || profile.nativeProjectMemoryDispatch !== true)) ||
            (memoryMode !== null && memoryMode !== wantsMemory)) { runAbort.abort(); throw failure(); }
        memoryMode ??= wantsMemory;
        ready ??= initialize();
        const session = await ready;
        check(callOptions?.signal);
        return session.adapter;
      }
      function ownedRequest(request:ProviderRuntimeRequest):ProviderRuntimeRequest{
        if(!chat)return request;
        if(!nativeOwner)throw failure();
        return {...request,metadata:{...request.metadata,projectId:nativeOwner.projectId,runId:nativeOwner.runId,projectEpoch:nativeOwner.projectEpoch}};
      }
      return {
        id: providerId,
        getCapabilities: () => ({
          providerId,
          modelIds: [modelId],
          supportsStreaming: true,
          supportsTools: !chat,
          supportsPreSendValidation: true,
          supportsNativeProjectMemory: !anthropic && !chat && !profile.fixture && !savedVersion && profile.nativeProjectMemoryDispatch === true,
          isMock: profile.fixture,
        }),
        async complete(request, callOptions) {
          if(logicalRequestId)throw failure();
          logicalRequestId=request.id;
          if (!pending) lastRunDispatchStatus = "notDispatched";
          try {
            const adapter=await selected(request,callOptions);
            return await adapter.complete(ownedRequest(request),callOptions);
          } catch (error) {throw tagged(error);} finally {logicalRequestId=null;}
        },
        async *stream(request, callOptions) {
          if(logicalRequestId)throw failure();
          logicalRequestId=request.id;
          if (!pending) lastRunDispatchStatus = "notDispatched";
          try {
            const adapter = await selected(request, callOptions);
            yield* adapter.stream!(ownedRequest(request), callOptions);
          } catch (error) {throw tagged(error);} finally {logicalRequestId=null;}
        },
      };
  }
}
