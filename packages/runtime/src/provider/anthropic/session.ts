import type {
  ProviderContinuationOwner,
  ProviderRuntimeError,
  ProviderRuntimeErrorCode,
  ProviderRuntimeRequest,
  ProviderRuntimeResponse,
  ProviderStreamChunk,
} from "@uagent/shared";
import type { ProviderAdapter, ProviderCallOptions } from "../provider-adapter.js";
import type { OutboundConsentGate, OutboundEnvelope } from "../outbound-consent.js";
import { createProviderRuntimeError } from "../provider-error.js";
import { MessagesEvents } from "./events.js";
import { messagesSse } from "./sse.js";
import {
  assistantSignature,
  messagesBody,
  parseMessage,
  prefixSignature,
  type AnthropicAssistantBlock,
  type AnthropicResult,
  type AnthropicThinking,
} from "./protocol.js";
import { argumentsObject, bytes, clone, invalid, MessagesError, rejectEcho } from "./utils.js";

export const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
/** Version pinned intentionally: no implicit migration/fallback to another wire contract. */
export const ANTHROPIC_API_VERSION = "2023-06-01";
export interface AnthropicProjectContext {
  projectId: string | null;
  epoch: number;
  revision: string;
}
export interface AnthropicSessionOptions {
  wireApi: "anthropic-compatible";
  providerId?: string;
  modelId: string;
  mode: "offline" | "live";
  endpoint?: string;
  /** Fresh run/conversation identity supplied by the caller, never restored permissions. */
  owner: ProviderContinuationOwner;
  isCurrent: () => boolean;
  getProjectContext: () => AnthropicProjectContext;
  fetcher?: typeof fetch;
  outboundGate?: OutboundConsentGate;
  thinking?: AnthropicThinking;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}
export interface AnthropicStreamChunk extends ProviderStreamChunk {
  messageId?: string;
  stopReason?: AnthropicResult["stopReason"];
  /** Data only; does not restore a session, lease, approval or credential. */
  nativeContent?: AnthropicAssistantBlock[];
}
const publicMessages: Record<ProviderRuntimeErrorCode, string> = {
  auth_missing: "Anthropic session authentication is unavailable.",
  rate_limited: "Anthropic request was rate limited. No automatic retry was sent.",
  timeout: "Anthropic request timed out.",
  network_error: "Anthropic transport failed. No automatic retry was sent.",
  malformed_response: "Anthropic message or protocol data was invalid or unsupported.",
  cancelled: "Anthropic request or its fresh run ownership was cancelled.",
  provider_unavailable: "Anthropic session, request preparation or provider is unavailable.",
};
export function createAnthropicSession(options: AnthropicSessionOptions) {
  const providerId = options.providerId ?? "anthropic-messages",
    modelId = options.modelId;
  const endpoint = options.endpoint ?? ANTHROPIC_MESSAGES_ENDPOINT,
    mode = options.mode;
  let owner: ProviderContinuationOwner, thinking: AnthropicThinking | undefined;
  try {
    owner = clone(options.owner);
    thinking = options.thinking && clone(options.thinking);
  } catch {
    throw createProviderRuntimeError(
      providerId,
      "provider_unavailable",
      publicMessages.provider_unavailable,
    );
  }
  const isCurrent = options.isCurrent,
    getContext = options.getProjectContext,
    gate = options.outboundGate;
  const fetcher = options.fetcher ?? (mode === "live" ? fetch : undefined);
  const timeoutMs = options.timeoutMs ?? 60_000,
    maxRequestBytes = options.maxRequestBytes ?? 1_048_576,
    maxResponseBytes = options.maxResponseBytes ?? 4_194_304;
  const configurationFailure = () => {
    throw createProviderRuntimeError(
      providerId,
      "provider_unavailable",
      publicMessages.provider_unavailable,
    );
  };
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return configurationFailure();
  }
  if (
    options.wireApi !== "anthropic-compatible" ||
    !["offline", "live"].includes(mode) ||
    url.origin !== "https://api.anthropic.com" ||
    url.pathname !== "/v1/messages" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    typeof providerId !== "string" ||
    !providerId.trim() ||
    providerId.length > 128 ||
    typeof modelId !== "string" ||
    !/^[A-Za-z0-9._:-]{1,128}$/.test(modelId) ||
    !owner ||
    owner.providerId !== providerId ||
    owner.modelId !== modelId ||
    [owner.projectId, owner.runId, owner.conversationId].some(
      (v) => typeof v !== "string" || !v.trim() || v.length > 512,
    ) ||
    !Number.isSafeInteger(owner.projectEpoch) ||
    owner.projectEpoch < 0 ||
    typeof isCurrent !== "function" ||
    typeof getContext !== "function" ||
    ![timeoutMs, maxRequestBytes, maxResponseBytes].every(Number.isSafeInteger) ||
    timeoutMs < 1 ||
    timeoutMs > 300_000 ||
    maxRequestBytes < 1 ||
    maxRequestBytes > 8_388_608 ||
    maxResponseBytes < 1 ||
    maxResponseBytes > 16_777_216
  )
    return configurationFailure();
  if (
    thinking &&
    (!["disabled", "enabled", "adaptive"].includes(thinking.type) ||
      Object.keys(thinking).some(
        (k) => !(thinking!.type === "enabled" ? ["type", "budget_tokens"] : ["type"]).includes(k),
      ))
  )
    return configurationFailure();
  let credential = "",
    busy = false,
    revoked = false,
    historyBytes = 0;
  const active = new Set<AbortController>();
  const records = new Map<string, AnthropicAssistantBlock[]>();
  const safeFailure = (
    error: unknown,
    key: string,
    beforeTransport: boolean,
  ): ProviderRuntimeError => {
    let code: ProviderRuntimeErrorCode = beforeTransport ? "provider_unavailable" : "network_error";
    try {
      if (error instanceof MessagesError && Object.hasOwn(publicMessages, error.code))
        code = error.code;
    } catch {
      /* Hostile callback error accessors are never inspected further. */
    }
    // No callback/native/HTTP error text, causes, headers or arbitrary error objects escape.
    const scrub = (s: string) => (key ? s.split(key).join("[REDACTED]") : s);
    return createProviderRuntimeError(scrub(providerId), code, scrub(publicMessages[code]));
  };
  const checkOwner = (): AnthropicProjectContext => {
    if (revoked || isCurrent() !== true) throw new MessagesError("cancelled");
    const raw = getContext(),
      current = { projectId: raw.projectId, epoch: raw.epoch, revision: raw.revision };
    if (
      revoked ||
      isCurrent() !== true ||
      current.projectId !== owner.projectId ||
      current.epoch !== owner.projectEpoch
    )
      throw new MessagesError("cancelled");
    if (typeof current.revision !== "string" || !current.revision || current.revision.length > 4096)
      invalid();
    return current;
  };
  const close = () => {
    revoked = true;
    credential = "";
    records.clear();
    historyBytes = 0;
    for (const controller of active) controller.abort();
  };
  async function* execute(
    source: ProviderRuntimeRequest,
    stream: boolean,
    call: ProviderCallOptions,
  ): AsyncGenerator<AnthropicStreamChunk, AnthropicResult> {
    const key = credential;
    let controller: AbortController | undefined,
      reader: ReadableStreamDefaultReader<Uint8Array> | undefined,
      timer: ReturnType<typeof setTimeout> | undefined,
      removeAbort: (() => void) | undefined,
      releaseBusy = false,
      beforeTransport = true,
      timedOut = false;
    try {
      if (busy) throw new MessagesError("provider_unavailable");
      if (revoked) throw new MessagesError("cancelled");
      if (!key) throw new MessagesError("auth_missing");
      if (!fetcher || (mode === "live" && !gate)) throw new MessagesError("provider_unavailable");
      busy = true;
      releaseBusy = true;
      // Options may have throwing/reentrant accessors. Own cleanup before reading
      // them, and retain each original value exactly once before any await.
      const signal = call.signal,
        beforeSend = call.beforeSend;
      if (signal?.aborted) throw new MessagesError("cancelled");
      controller = new AbortController();
      active.add(controller);
      const currentController = controller;
      const abort = () => currentController.abort();
      removeAbort = () => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(() => {
        timedOut = true;
        currentController.abort();
      }, timeoutMs);
      const interrupted = new Promise<never>((_, reject) => {
        currentController.signal.addEventListener(
          "abort",
          () => reject(new MessagesError(timedOut ? "timeout" : "cancelled")),
          { once: true },
        );
      });
      void interrupted.catch(() => undefined);
      if (signal?.aborted) currentController.abort();
      const request = clone(source),
        scope = checkOwner();
      if (
        request.providerId !== providerId ||
        request.modelId !== modelId ||
        typeof request.id !== "string" ||
        !request.id ||
        request.id.length > 512 ||
        (request.metadata?.projectId !== undefined &&
          request.metadata.projectId !== owner.projectId) ||
        (request.metadata?.projectEpoch !== undefined &&
          request.metadata.projectEpoch !== owner.projectEpoch) ||
        (request.metadata?.runId !== undefined && request.metadata.runId !== owner.runId)
      )
        throw new MessagesError("cancelled");
      if (records.size >= 128 || historyBytes > 8_388_608)
        throw new MessagesError("provider_unavailable");
      rejectEcho(request, key);
      rejectEcho(owner, key);
      for (const message of request.messages)
        for (const tool of message.toolCalls ?? [])
          rejectEcho(argumentsObject(tool.arguments), key);
      const body = messagesBody(request, stream, thinking, (message, index) => {
        const native = records.get(
          prefixSignature(request.messages.slice(0, index)) + "\n" + assistantSignature(message),
        );
        if (!native) throw new MessagesError("provider_unavailable");
        return clone(native);
      });
      const serialized = JSON.stringify(body);
      if (bytes(serialized) > maxRequestBytes) throw new MessagesError("provider_unavailable");
      rejectEcho(JSON.parse(serialized), key);
      const check = () => {
        const current = checkOwner();
        if (
          currentController.signal.aborted ||
          current.projectId !== scope.projectId ||
          current.epoch !== scope.epoch ||
          current.revision !== scope.revision
        )
          throw new MessagesError("cancelled");
        return current;
      };
      const envelope: OutboundEnvelope = { endpoint, model: modelId, ...scope, body: serialized };
      check();
      const grant = gate
        ? await Promise.race([
            gate.review(envelope, currentController.signal).catch(() => {
              throw new MessagesError("cancelled");
            }),
            interrupted,
          ])
        : undefined;
      check();
      if (beforeSend) await Promise.race([beforeSend(), interrupted]);
      check();
      if (grant && !grant.consume({ ...envelope, ...check() }))
        throw new MessagesError("cancelled");
      const init = {
        method: "POST",
        redirect: "error" as const,
        credentials: "omit" as const,
        cache: "no-store" as const,
        referrerPolicy: "no-referrer" as const,
        headers: {
          "Content-Type": "application/json",
          Accept: stream ? "text/event-stream" : "application/json",
          "x-api-key": key,
          "anthropic-version": ANTHROPIC_API_VERSION,
        },
        body: serialized,
        signal: currentController.signal,
      };
      // Final synchronous lease/context gate, AFTER approval/source validation/consume.
      check();
      beforeTransport = false;
      const response = await Promise.race([fetcher(endpoint, init), interrupted]);
      check();
      if (!response.ok)
        throw new MessagesError(
          response.status === 401 || response.status === 403
            ? "auth_missing"
            : response.status === 429
              ? "rate_limited"
              : response.status >= 500
                ? "provider_unavailable"
                : "malformed_response",
        );
      const type = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
      if (!response.body || type !== (stream ? "text/event-stream" : "application/json")) invalid();
      reader = response.body!.getReader();
      let result: AnthropicResult | undefined,
        chunkIndex = 0,
        heldText = "";
      const chunk = (
        delta: string,
        extra: Partial<AnthropicStreamChunk> = {},
      ): AnthropicStreamChunk => {
        check();
        const value = {
          id: request.id + "-anthropic-" + chunkIndex,
          requestId: request.id,
          providerId,
          modelId,
          index: chunkIndex++,
          delta,
          done: false,
          ...extra,
        };
        rejectEcho(value, key);
        for (const call of value.toolCalls ?? []) rejectEcho(argumentsObject(call.arguments), key);
        if (value.toolCallDelta)
          rejectEcho(argumentsObject(value.toolCallDelta.argumentsDelta), key);
        return value;
      };
      const safeText = (text: string) => {
        heldText += text;
        if (heldText.includes(key)) invalid();
        let suffix = Math.min(key.length - 1, heldText.length);
        while (suffix > 0 && !heldText.endsWith(key.slice(0, suffix))) suffix--;
        const safe = heldText.slice(0, heldText.length - suffix);
        heldText = heldText.slice(heldText.length - suffix);
        return safe;
      };
      if (!stream) {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let text = "",
          size = 0;
        while (true) {
          const next = await Promise.race([reader.read(), interrupted]);
          check();
          if (next.done) {
            try {
              text += decoder.decode();
            } catch {
              invalid();
            }
            break;
          }
          size += next.value.byteLength;
          if (size > maxResponseBytes) invalid();
          try {
            text += decoder.decode(next.value, { stream: true });
          } catch {
            invalid();
          }
        }
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          invalid();
        }
        rejectEcho(raw, key);
        result = parseMessage(raw, request);
      } else {
        const events = new MessagesEvents(request);
        for await (const event of messagesSse(reader, interrupted, maxResponseBytes)) {
          check();
          rejectEcho(event.data, key);
          const next = events.accept(event.data, event.event);
          if (next.result) rejectEcho(next.result, key);
          for (const emission of next.emissions) {
            if (emission.toolCallDelta) {
              // Complete JSON only: decoded keys/values are checked BEFORE publication.
              rejectEcho(argumentsObject(emission.toolCallDelta.argumentsDelta), key);
              yield chunk("", { toolCallDelta: emission.toolCallDelta });
            } else if (emission.text) {
              const safe = safeText(emission.text);
              if (safe) yield chunk(safe);
            }
          }
          if (next.result) {
            result = next.result;
            break;
          }
        }
        if (!result) invalid();
      }
      check();
      rejectEcho(result, key);
      for (const tool of result!.toolCalls) rejectEcho(argumentsObject(tool.arguments), key);
      const assistant = {
        content: result!.text,
        ...(result!.toolCalls.length ? { toolCalls: result!.toolCalls } : {}),
      };
      const recordKey = prefixSignature(request.messages) + "\n" + assistantSignature(assistant);
      const native = clone(result!.content),
        old = records.get(recordKey);
      if (old && JSON.stringify(old) !== JSON.stringify(native)) invalid();
      if (!old) {
        const size = bytes(recordKey) + bytes(JSON.stringify(native));
        if (historyBytes + size > 8_388_608) throw new MessagesError("provider_unavailable");
        historyBytes += size;
        records.set(recordKey, native);
      }
      if (stream)
        yield chunk(heldText, {
          done: true,
          finishReason: result!.finishReason,
          usage: result!.usage,
          usageStatus: result!.usageStatus,
          messageId: result!.id,
          stopReason: result!.stopReason,
          nativeContent: clone(result!.content),
          ...(result!.toolCalls.length ? { toolCalls: clone(result!.toolCalls) } : {}),
        });
      return result!;
    } catch (error) {
      const reason = controller?.signal.aborted
        ? new MessagesError(timedOut ? "timeout" : "cancelled")
        : error;
      throw safeFailure(reason, key, beforeTransport);
    } finally {
      try {
        if (timer !== undefined) clearTimeout(timer);
        // Best-effort cleanup must never replace a sanitized failure or a
        // completed result with a credential-bearing callback exception.
        try {
          removeAbort?.();
        } catch {
          /* Keep cleanup callback failures private. */
        }
        try {
          controller?.abort();
        } catch {
          /* Continue releasing remaining resources. */
        }
        if (reader) {
          try {
            void reader.cancel().catch(() => undefined);
          } catch {
            /* Raw transport cleanup errors stay private. */
          }
          try {
            reader.releaseLock();
          } catch {
            /* A hostile/noncompliant reader cannot leak from finally. */
          }
        }
      } finally {
        if (controller) active.delete(controller);
        if (releaseBusy) busy = false;
      }
    }
  }
  const completeNative = async (
    request: ProviderRuntimeRequest,
    call: ProviderCallOptions = {},
  ) => {
    const generator = execute(request, false, call);
    while (true) {
      const next = await generator.next();
      if (next.done) return next.value;
    }
  };
  const adapter: ProviderAdapter = {
    id: providerId,
    getCapabilities: () => ({
      providerId,
      modelIds: [modelId],
      endpoint,
      wireApi: "anthropic-compatible",
      credentialStorage: "session-only",
      supportsStreaming: true,
      supportsTools: true,
      supportsPreSendValidation: true,
      isMock: mode === "offline",
    }),
    complete: async (request, call = {}): Promise<ProviderRuntimeResponse> => {
      const result = await completeNative(request, call);
      return {
        id: result.id,
        requestId: result.requestId,
        providerId,
        modelId,
        text: result.text,
        finishReason: result.finishReason,
        ...(result.toolCalls.length ? { toolCalls: clone(result.toolCalls) } : {}),
        usage: result.usage,
        usageStatus: result.usageStatus,
        createdAt: Date.now(),
      };
    },
    async *stream(request, call = {}) {
      yield* execute(request, true, call);
    },
  };
  return {
    ...adapter,
    completeNative,
    async *stream(
      request: ProviderRuntimeRequest,
      call: ProviderCallOptions = {},
    ): AsyncGenerator<AnthropicStreamChunk> {
      yield* execute(request, true, call);
    },
    setCredential(value: string) {
      if (busy || revoked) throw safeFailure(new MessagesError("cancelled"), credential, true);
      if (typeof value !== "string" || !/^[\x21-\x7e]{8,4096}$/.test(value))
        throw safeFailure(new MessagesError("auth_missing"), credential, true);
      credential = value;
      records.clear();
      historyBytes = 0;
      try {
        rejectEcho({ providerId, modelId, endpoint, owner }, value);
      } catch (error) {
        credential = "";
        throw safeFailure(error, value, true);
      }
    },
    close,
    getStatus: () => ({
      hasCredential: Boolean(credential),
      busy,
      revoked,
      connectivity: "unverified" as const,
    }),
  };
}
