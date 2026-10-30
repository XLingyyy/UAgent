import {
  createProviderRuntimeSession,
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

const ENDPOINT = "https://api.openai.com/v1/responses";
const MAX_BYTES = 4_194_304;
const MAX_CHUNKS = 4096;
const MAX_CHUNK_BYTES = 65_536;
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
  modelSettings?: {
    supportsReasoning: boolean;
    requestDefaults: { temperature: number | null; maxOutputTokens: number | null };
  };
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
  invoke: NativeInvoke;
  providerId: string;
  modelId: string;
  /** Supplied only by the current local input event. Never read from persistence. */
  credential: string;
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
  const invoke = options.invoke,
    providerId = options.providerId,
    modelId = options.modelId,
    gate = options.gate,
    now = options.now ?? Date.now,
    openingSignal = options.signal;
  let credential = options.credential;
  if (
    !id(providerId) ||
    !id(modelId) ||
    !validResponsesCredential(credential) ||
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
    profile = await call<ProfileReceipt>("open_native_responses_profile", {
      providerId,
      modelId,
      credential,
    });
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
        detachSignal?: () => void;
        ordinal: number;
        cursor: number;
        status: NativeResponsesDispatchStatus;
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
        request.cleanup = (async () => {
          if (cancel) {
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
          await call("release_native_responses_request", { requestId: request.requestId }).catch(
            () => undefined,
          );
          if (pending === request) pending = null;
        })();
        return request.cleanup;
      }
      const stop = () => {
        if (pending) void cleanup(pending, true);
      };
      runAbort.signal.addEventListener("abort", stop, { once: true });
      let ready: Promise<ReturnType<typeof createProviderRuntimeSession>> | null = null;
      let nativeOwner:ProviderContinuationOwner|null=null;
      let logicalRequestId:string|null=null;
      async function initialize() {
        check();
        const bound = chat?await call<RunReceipt>("bind_native_responses_conversation",{profileId:profile.profileId,projectId:logicalProject,conversationId:scope.conversationId}):await call<RunReceipt>("bind_native_responses_run", {
          profileId: profile.profileId,projectId: scope.projectId,runId: scope.runId,scopeExpiresAt,
        });
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
        )
          throw failure();
        nativeOwner=owner;
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
            stop();
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
            const receipt = await call<PreparedReceipt>("prepare_native_responses_request", {
              runHandle: bound.runHandle,
              body: envelope.body,
              ...(chat?{logicalRequestId}:{}),
            });
            const request: Pending = {
              requestId: receipt?.requestId,
              body: envelope.body,
              envelope: JSON.stringify(envelope),
              consumed: false,
              approved: false,
              dispatched: false,
              cleanup: null,
              ordinal: ++requestOrdinal,
              cursor: 0,
              status: "notDispatched",
            };
            // An uncertain preparation cannot be retried automatically.
            if (!receipt || !id(receipt.requestId)) throw failure();
            pending = request;
            rememberStatus(request, "notDispatched");
            const abort = () => {
              void cleanup(request, true);
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
              await call("approve_native_responses_request", { requestId: request.requestId });
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
                      void cleanup(request, true);
                      return false;
                    }
                    request.consumed = true;
                    return true;
                  } catch {
                    void cleanup(request, true);
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
            headers.get("authorization") !== "Bearer " + credential ||
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
            streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
          const abort = () => {
            if (!completed) {
              completed = true;
              streamController?.error(cancelled());
              void cleanup(request, true);
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
            return { chunks, done: result.done };
          }
          try {
            check(signal ?? undefined);
            // The IPC outcome may be uncertain before the first native poll.
            // Conservatively report possible transmission until native refines it.
            rememberStatus(request, "mayHaveBeenSent");
            await call("dispatch_native_responses_request", { requestId: request.requestId });
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
                        controller.close();
                        return;
                      }
                      await pause(signal ?? undefined);
                      batch = await poll();
                    }
                  } catch {
                    if (!completed) {
                      completed = true;
                      controller.error(failure());
                    }
                    await finish(true);
                  }
                })();
              },
              async cancel() {
                completed = true;
                await finish(true);
              },
            });
            return new Response(body, {
              status: responseHead.status,
              headers: { "Content-Type": responseHead.contentType },
            });
          } catch {
            completed = true;
            await finish(true);
            throw failure();
          }
        };
        const session = createProviderRuntimeSession({
          wireApi: "responses",
          disableNativeReplay:chat,
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
        sessions.add(session);
        return session;
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
