import type {
  ProviderContinuationOwner,
  ProviderContinuationStorePort,
  ProviderNativeContinuation,
  ProviderRuntimeRequest,
  ProviderRuntimeResponse,
  ProviderStreamChunk,
  ProviderRuntimeError,
} from "@uagent/shared";
import type { ProviderAdapter, ProviderCallOptions } from "../provider-adapter.js";
import { createProviderRuntimeError } from "../provider-error.js";
import {
  createResponsesSession,
  type ResponsesSessionOptions,
  type ResponsesProjectContext,
} from "./session.js";
import { validateNativeReplay, type ResponsesResult } from "./protocol.js";

export interface ResponsesRuntimeSessionOptions extends Omit<
  ResponsesSessionOptions,
  "replayNativeOutput" | "getProjectContext"
> {
  wireApi: "responses";
  /** Supplied by the fresh runtime run owner, never loaded from a settings/history record. */
  owner: ProviderContinuationOwner;
  /** Current fresh RunScopeLease check. This function is never restored from stored data. */
  isCurrent: () => boolean;
  getProjectContext: () => ResponsesProjectContext;
  continuationStore: ProviderContinuationStorePort;
}
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const signature = (message: {
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}) =>
  JSON.stringify([
    message.content,
    message.toolCalls?.map((call) => [call.id, call.name, call.arguments]) ?? null,
  ]);
const ownerKey = (owner: ProviderContinuationOwner) =>
  JSON.stringify([
    owner.providerId,
    owner.modelId,
    owner.projectId,
    owner.projectEpoch,
    owner.runId,
    owner.conversationId,
  ]);

/** Data restoration never opens a credential/session, grants access, or dispatches saved tools. */
export function createResponsesRuntimeSession(options: ResponsesRuntimeSessionOptions) {
  const providerId = options.providerId ?? "openai-responses",
    owner = clone(options.owner);
  const ownErrors = new WeakSet<object>();
  const fail = (code: ProviderRuntimeError["code"], message: string) => {
    const error = createProviderRuntimeError(providerId, code, message);
    ownErrors.add(error);
    return error;
  };
  if (
    options.wireApi !== "responses" ||
    typeof options.isCurrent !== "function" ||
    owner.providerId !== providerId ||
    owner.modelId !== options.modelId ||
    [owner.providerId, owner.modelId, owner.projectId, owner.runId, owner.conversationId].some(
      (value) => typeof value !== "string" || !value.trim() || value.length > 512,
    ) ||
    !Number.isSafeInteger(owner.projectEpoch) ||
    owner.projectEpoch < 0
  )
    throw fail(
      "provider_unavailable",
      "Explicit Responses protocol and fresh run ownership are required.",
    );
  const getProjectContext = options.getProjectContext,
    isCurrent = options.isCurrent,
    continuationStore = options.continuationStore;
  const expectedOwner = ownerKey(owner),
    records = new Map<string, ProviderNativeContinuation>();
  let busy = false,
    disposed = false,
    poisoned = false;
  const active = new Set<AbortController>();
  const recordKey = (record: ProviderNativeContinuation) =>
    JSON.stringify([record.requestId, record.responseId]);
  const checkOwner = (): ResponsesProjectContext => {
    if (!isCurrent())
      throw fail("cancelled", "The fresh Responses run lease is no longer current.");
    const current = getProjectContext();
    const snapshot = {
      projectId: current.projectId,
      epoch: current.epoch,
      revision: current.revision,
    };
    if (!isCurrent())
      throw fail("cancelled", "The fresh Responses run lease is no longer current.");
    if (snapshot.projectId !== owner.projectId || snapshot.epoch !== owner.projectEpoch)
      throw fail("cancelled", "Responses runtime ownership is no longer current.");
    return snapshot;
  };
  const transport = options.fetcher ?? (options.mode === "live" ? fetch : undefined);
  // Last synchronous gate: approval, source validation and grant consumption have
  // already happened in native transport. Never mutate the approved request here.
  const guardedFetch: typeof fetch | undefined = transport
    ? (input, init) => {
        checkOwner();
        if (init?.signal?.aborted)
          throw fail("cancelled", "Responses runtime request was interrupted.");
        return transport(input, init);
      }
    : undefined;
  const native = createResponsesSession({
    ...options,
    providerId,
    getProjectContext: checkOwner,
    fetcher: guardedFetch,
    replayNativeOutput(request, index, context) {
      const assistant = request.messages[index]!;
      if (!assistant.toolCalls?.length) return undefined;
      const matches = [...records.values()].filter(
        (record) => signature(record.assistant) === signature(assistant),
      );
      if (!matches.length)
        throw fail(
          "provider_unavailable",
          "Native Responses continuation is missing; selected history cannot be reconstructed.",
        );
      if (
        matches.some(
          (record) => JSON.stringify(record.output) !== JSON.stringify(matches[0]!.output),
        )
      )
        throw fail("provider_unavailable", "Native Responses continuation is ambiguous.");
      return {
        projectId: context.projectId!,
        projectEpoch: context.epoch,
        runId: owner.runId,
        output: clone(matches[0]!.output),
      };
    },
  });
  function checkedRecord(raw: ProviderNativeContinuation, request: ProviderRuntimeRequest) {
    const record = clone(raw);
    const keys = new Set([
      "schemaVersion",
      "wireApi",
      "owner",
      "requestId",
      "responseId",
      "createdAt",
      "assistant",
      "output",
    ]);
    const ownerKeys = new Set([
      "providerId",
      "modelId",
      "projectId",
      "projectEpoch",
      "runId",
      "conversationId",
    ]);
    if (
      !record ||
      Object.keys(record).some((key) => !keys.has(key)) ||
      record.schemaVersion !== 1 ||
      record.wireApi !== "responses" ||
      !record.owner ||
      Object.keys(record.owner).some((key) => !ownerKeys.has(key)) ||
      ownerKey(record.owner) !== expectedOwner ||
      typeof record.requestId !== "string" ||
      !record.requestId ||
      typeof record.responseId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(record.responseId) ||
      !Number.isSafeInteger(record.createdAt) ||
      record.createdAt < 0 ||
      !record.assistant ||
      Object.keys(record.assistant).some((key) => !["content", "toolCalls"].includes(key)) ||
      new TextEncoder().encode(JSON.stringify(record)).length > 1_048_576
    )
      throw fail(
        "provider_unavailable",
        "Stored native Responses data does not match this fresh run owner.",
      );
    validateNativeReplay(record.output, { role: "assistant", ...record.assistant }, request);
    return record;
  }
  async function* execute(
    source: ProviderRuntimeRequest,
    stream: boolean,
    call: ProviderCallOptions = {},
  ): AsyncGenerator<ProviderStreamChunk, ProviderRuntimeResponse> {
    if (busy || disposed || poisoned)
      throw fail(
        "provider_unavailable",
        "Responses runtime session is busy, closed or needs store reconciliation.",
      );
    if (!native.hasCredential())
      throw fail(
        "auth_missing",
        "A fresh memory-only credential is required; history cannot open a session.",
      );
    busy = true;
    const controller = new AbortController();
    active.add(controller);
    const abort = () => controller.abort();
    call.signal?.addEventListener("abort", abort, { once: true });
    let timeout = false,
      stage: "prepare" | "load" | "provider" | "save" = "prepare";
    const timer = setTimeout(() => {
      timeout = true;
      controller.abort();
    }, options.timeoutMs ?? 60_000);
    let rejectAbort!: () => void;
    const interrupted = new Promise<never>((_, reject) => {
      rejectAbort = () =>
        reject(
          fail(timeout ? "timeout" : "cancelled", "Responses runtime request was interrupted."),
        );
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    void interrupted.catch(() => undefined);
    if (call.signal?.aborted) controller.abort();
    const check = () => {
      if (controller.signal.aborted)
        throw fail(timeout ? "timeout" : "cancelled", "Responses runtime request was interrupted.");
      checkOwner();
    };
    const io = <T>(operation: Promise<T>) => Promise.race([operation, interrupted]);
    const failedStage = (): "prepare" | "load" | "provider" | "save" => stage;
    try {
      check();
      const request = clone(source);
      if (
        request.providerId !== providerId ||
        request.modelId !== owner.modelId ||
        (request.metadata?.runId !== undefined && request.metadata.runId !== owner.runId) ||
        (request.metadata?.projectId !== undefined &&
          request.metadata.projectId !== owner.projectId) ||
        (request.metadata?.projectEpoch !== undefined &&
          request.metadata.projectEpoch !== owner.projectEpoch)
      )
        throw fail("cancelled", "Provider request differs from its fresh runtime owner.");
      request.metadata = {
        ...request.metadata,
        runId: owner.runId,
        projectId: owner.projectId,
        projectEpoch: owner.projectEpoch,
      };
      stage = "load";
      const loaded = await io(continuationStore.load(clone(owner), controller.signal));
      if (
        !Array.isArray(loaded) ||
        loaded.length > 128 ||
        new TextEncoder().encode(JSON.stringify(loaded)).length > 8_388_608
      )
        throw fail("provider_unavailable", "Stored native Responses history exceeds its bounds.");
      for (const raw of loaded) {
        const record = checkedRecord(raw, request),
          previous = records.get(recordKey(record));
        if (previous && JSON.stringify(previous) !== JSON.stringify(record))
          throw fail(
            "provider_unavailable",
            "Stored native Responses record changed; reconcile history.",
          );
        records.set(recordKey(record), record);
      }
      check();
      const persist = async (result: ResponsesResult): Promise<ProviderNativeContinuation> => {
        check();
        const record = checkedRecord(
          {
            schemaVersion: 1,
            wireApi: "responses",
            owner: clone(owner),
            requestId: request.id,
            responseId: result.id,
            createdAt: Date.now(),
            assistant: {
              content: result.text,
              ...(result.toolCalls.length ? { toolCalls: clone(result.toolCalls) } : {}),
            },
            output: clone(result.output),
          },
          request,
        );
        stage = "save";
        await io(continuationStore.save(clone(record), controller.signal));
        check();
        records.set(recordKey(record), record);
        return record;
      };
      const sourceBeforeSend = call.beforeSend;
      const transportCall = {
        signal: controller.signal,
        outboundSendIntent: call.outboundSendIntent,
        // Native invokes this after exact-body approval. Preserve the caller's
        // source validation and recheck this fixed lease after its await.
        beforeSend: async () => {
          check();
          if (sourceBeforeSend) await sourceBeforeSend();
          check();
        },
      };
      stage = "provider";
      if (!stream) {
        const result = await native.completeNative(request, transportCall);
        const nativeContinuation = await persist(result);
        return {
          id: result.id,
          requestId: request.id,
          providerId,
          modelId: owner.modelId,
          text: result.text,
          finishReason: result.finishReason,
          usage: result.usage,
          usageStatus: result.usageStatus,
          createdAt: result.createdAt,
          nativeContinuation,
          ...(result.toolCalls.length ? { toolCalls: clone(result.toolCalls) } : {}),
        };
      }
      let text = "",
        complete: ProviderRuntimeResponse | undefined;
      for await (const chunk of native.stream(request, transportCall)) {
        check();
        text += chunk.delta;
        const { nativeOutput, responseId, ...publicChunk } = chunk;
        if (!chunk.done) {
          yield publicChunk;
          continue;
        }
        if (!nativeOutput || !responseId)
          throw fail("malformed_response", "Responses terminal native output is missing.");
        const result: ResponsesResult = {
          id: responseId,
          modelId: owner.modelId,
          text,
          finishReason: chunk.finishReason ?? "stop",
          toolCalls: chunk.toolCalls ?? [],
          usage: chunk.usage,
          usageStatus: chunk.usageStatus ?? "unknown",
          createdAt: Date.now(),
          output: nativeOutput,
        };
        const nativeContinuation = await persist(result);
        complete = {
          id: responseId,
          requestId: request.id,
          providerId,
          modelId: owner.modelId,
          text,
          finishReason: result.finishReason,
          usage: result.usage,
          usageStatus: result.usageStatus,
          createdAt: nativeContinuation.createdAt,
          nativeContinuation,
          ...(result.toolCalls.length ? { toolCalls: clone(result.toolCalls) } : {}),
        };
        yield { ...publicChunk, nativeContinuation };
      }
      check();
      if (!complete)
        throw fail("malformed_response", "Responses runtime stream has no terminal result.");
      return complete;
    } catch (error) {
      if (failedStage() === "save") poisoned = true;
      if (controller.signal.aborted)
        throw fail(timeout ? "timeout" : "cancelled", "Responses runtime request was interrupted.");
      if (error && typeof error === "object" && ownErrors.has(error)) throw error;
      if (
        failedStage() === "provider" &&
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "ProviderRuntimeError"
      )
        throw error;
      throw fail(
        "provider_unavailable",
        failedStage() === "load" || failedStage() === "save"
          ? "Responses continuation storage failed; reconcile before retrying."
          : "Responses runtime preparation failed.",
      );
    } finally {
      clearTimeout(timer);
      call.signal?.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", rejectAbort);
      controller.abort();
      active.delete(controller);
      busy = false;
    }
  }
  const adapter: ProviderAdapter = {
    id: providerId,
    getCapabilities: () => native.adapter.getCapabilities(),
    async complete(request, call) {
      const result = await execute(request, false, call).next();
      if (!result.done) throw fail("malformed_response", "Unexpected Responses runtime delta.");
      return result.value;
    },
    stream: (request, call) => execute(request, true, call),
  };
  return {
    adapter,
    setCredential(value: string) {
      if (busy || disposed)
        throw fail("provider_unavailable", "Responses runtime is busy or closed.");
      const key = value.trim();
      if (
        key &&
        Object.values(owner).some((field) => typeof field === "string" && field.includes(key))
      )
        throw Error("credential_matches_runtime_identity");
      native.setCredential(value);
    },
    clearCredential() {
      native.clearCredential();
      for (const controller of active) controller.abort();
    },
    dispose() {
      disposed = true;
      native.dispose();
      records.clear();
      for (const controller of active) controller.abort();
    },
    hasCredential: () => native.hasCredential(),
    getStatus: () => ({
      ...native.getStatus(),
      requiresStoreReconciliation: poisoned,
      owner: clone(owner),
    }),
  };
}
