import {anthropicBody,parseAnthropicResult,AnthropicEvents} from "../anthropic-protocol.js";
import type {
  ProviderRuntimeError,
  ProviderRuntimeErrorCode,
  ProviderRuntimeRequest,
  ProviderRuntimeResponse,
  ProviderStreamChunk,
} from "@uagent/shared";
import type { ProviderAdapter, ProviderCallOptions } from "../provider-adapter.js";
import type { OutboundConsentGate, OutboundEnvelope } from "../outbound-consent.js";
import { createProviderRuntimeError } from "../provider-error.js";
import { ResponsesEvents } from "./events.js";
import {
  parseResponsesResult,
  responsesBody,
  validateNativeReplay,
  type ResponsesItem,
  type ResponsesResult,
} from "./protocol.js";
import { responsesSse } from "./sse.js";

export const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
/** Compatible with the pre-beforeSend baseline and the integration's extended contract. */
export type ResponsesCallOptions = ProviderCallOptions & { beforeSend?: () => Promise<void> };
export interface ResponsesProjectContext {
  projectId: string | null;
  epoch: number;
  revision: string;
}
export interface ResponsesNativeReplay {
  projectId: string;
  projectEpoch: number;
  runId?: string;
  output: ResponsesItem[];
}
export interface ResponsesSessionOptions {
  protocol?: "responses" | "anthropic";
  providerId?: string;
  modelId: string;
  endpoint?: string;
  mode: "offline" | "live";
  fetcher?: typeof fetch;
  outboundGate?: OutboundConsentGate;
  getProjectContext?: () => ResponsesProjectContext;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  /** Supply persisted native output for an assistant turn when restoring a run. */
  replayNativeOutput?: (
    request: ProviderRuntimeRequest,
    assistantIndex: number,
    context: Readonly<ResponsesProjectContext>,
  ) => ResponsesNativeReplay | undefined;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  /** Text-only conversations send selected plain history, never native output items. */
  disableNativeReplay?: boolean;
}
export interface ResponsesStreamChunk extends ProviderStreamChunk {
  usageStatus?: "reported" | "unknown";
  responseId?: string;
  nativeOutput?: ResponsesItem[];
}
interface ReplayEntry {
  scope: string;
  messages: string;
  assistant: string;
  output: ResponsesItem[];
}

/** No credential/config persistence, hidden model substitution, fallback or retries. */
export function createResponsesSession(options: ResponsesSessionOptions) {
  const anthropic=options.protocol==="anthropic";
  const nativeReplayEnabled=!anthropic&&options.disableNativeReplay!==true;
  const providerId = options.providerId ?? "openai-responses",
    modelId = options.modelId;
  const endpoint = options.endpoint ?? OPENAI_RESPONSES_ENDPOINT,
    mode = options.mode;
  const fetcher = options.fetcher ?? (mode === "live" ? fetch : undefined);
  const gate = options.outboundGate,
    getContext = options.getProjectContext;
  const timeoutMs = options.timeoutMs ?? 60_000,
    maxRequestBytes = options.maxRequestBytes ?? 1_048_576;
  const maxResponseBytes = options.maxResponseBytes ?? 4_194_304,
    reasoningEffort = options.reasoningEffort;
  const fail = (code: ProviderRuntimeErrorCode, message: string) =>
    createProviderRuntimeError(providerId, code, message);
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw fail("provider_unavailable", "Invalid Responses endpoint.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !(anthropic ? endpoint === "https://api.anthropic.com/v1/messages" : url.pathname.endsWith("/responses")) ||
    !modelId ||
    modelId.length > 128 ||
    /[\r\n]/.test(modelId) ||
    !providerId ||
    !["offline", "live"].includes(mode)
  )
    throw fail(
      "provider_unavailable",
      "An explicit HTTPS Responses endpoint and model are required.",
    );
  if (
    ![timeoutMs, maxRequestBytes, maxResponseBytes].every(Number.isSafeInteger) ||
    timeoutMs < 1 ||
    timeoutMs > 300_000 ||
    maxRequestBytes < 1 ||
    maxRequestBytes > 8_388_608 ||
    maxResponseBytes < 1 ||
    maxResponseBytes > 16_777_216
  )
    throw fail("provider_unavailable", "Invalid Responses transport limits.");
  const replayNativeOutput = options.replayNativeOutput;
  let historyBytes = 0;
  let credential = "",
    busy = false,
    revoked = false;
  const active = new Set<AbortController>(),
    replay: ReplayEntry[] = [];
  const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
  const containsCredential = (value: unknown, key: string): boolean => {
    if (!key) return false;
    const pending: unknown[] = [value],
      seen = new Set<object>();
    while (pending.length) {
      const next = pending.pop();
      if (typeof next === "string") {
        if (next.includes(key)) return true;
      } else if (next && typeof next === "object" && !seen.has(next)) {
        seen.add(next);
        for (const [name, child] of Object.entries(next)) {
          if (name.includes(key)) return true;
          pending.push(child);
        }
      }
    }
    return false;
  };
  const rejectCredentialEcho = (value: unknown, key: string) => {
    if (containsCredential(value, key))
      throw fail("malformed_response", "Credential echo in Responses result.");
  };
  /** Decode only the protocol-defined arguments JSON, exactly once.
   * Strings nested inside that object remain strings; no URL/base64/JSON guessing.
   */
  const rejectArgumentCredentialEcho = (
    argumentsText: unknown,
    key: string,
    code: "auth_missing" | "malformed_response" = "malformed_response",
    allowIncomplete = false,
  ) => {
    if (typeof argumentsText !== "string")
      throw fail("malformed_response", "Invalid Responses function arguments.");
    let decoded: unknown;
    try {
      decoded = JSON.parse(argumentsText);
    } catch {
      if (allowIncomplete) return;
      throw fail("malformed_response", "Invalid Responses function arguments JSON.");
    }
    if (containsCredential(decoded, key))
      throw fail(code, "Credential echo in Responses function arguments.");
  };
  const rejectResultCredentialEcho = (result: ResponsesResult, key: string) => {
    rejectCredentialEcho(result, key);
    for (const call of result.toolCalls) rejectArgumentCredentialEcho(call.arguments, key);
    for (const item of result.output)
      if (item.type === "function_call") rejectArgumentCredentialEcho(item.arguments, key);
  };
  function normalizeFailure(
    error: unknown,
    key: string,
    beforeTransport = false,
    hasReader = false,
  ): ProviderRuntimeError {
    try {
      if (
        error &&
        typeof error === "object" &&
        "name" in error &&
        error.name === "ProviderRuntimeError"
      ) {
        const safe = error as { code?: ProviderRuntimeErrorCode; message?: unknown };
        const allowed: ProviderRuntimeErrorCode[] = [
          "auth_missing",
          "rate_limited",
          "timeout",
          "network_error",
          "malformed_response",
          "cancelled",
          "provider_unavailable",
        ];
        const code = safe.code && allowed.includes(safe.code) ? safe.code : "provider_unavailable";
        const message =
          typeof safe.message === "string"
            ? key
              ? safe.message.split(key).join("[REDACTED]")
              : safe.message
            : "Responses request failed.";
        return fail(code, message);
      }
      if (error instanceof TypeError && hasReader)
        return fail("malformed_response", "Invalid Responses body encoding.");
    } catch {
      /* Callback error objects may have throwing accessors. Never expose them. */
    }
    return fail(
      beforeTransport ? "provider_unavailable" : "network_error",
      beforeTransport
        ? "Responses request preparation failed. No request was sent."
        : "Responses transport failed. No automatic retry was sent.",
    );
  }
  function bindContext(request: ProviderRuntimeRequest) {
    const trusted = getContext?.();
    const scope: Readonly<ResponsesProjectContext> = Object.freeze(
      trusted
        ? {
            projectId: trusted.projectId,
            epoch: trusted.epoch,
            revision: trusted.revision,
          }
        : {
            projectId: request.metadata?.projectId ?? null,
            epoch: request.metadata?.projectEpoch ?? 0,
            revision: request.id,
          },
    );
    if (
      (scope.projectId !== null &&
        (typeof scope.projectId !== "string" || !scope.projectId.trim())) ||
      !Number.isSafeInteger(scope.epoch) ||
      scope.epoch < 0 ||
      typeof scope.revision !== "string" ||
      !scope.revision
    )
      throw fail("provider_unavailable", "Invalid Responses project context.");
    if (
      (request.metadata?.projectId !== undefined &&
        request.metadata.projectId !== scope.projectId) ||
      (request.metadata?.projectEpoch !== undefined &&
        request.metadata.projectEpoch !== scope.epoch)
    )
      throw fail("cancelled", "Project changed before Responses outbound review.");
    // Metadata can narrow a scope, but cannot supply the trusted project identity.
    const nativeScope =
      trusted && scope.projectId !== null
        ? JSON.stringify([
            providerId,
            modelId,
            scope.projectId,
            scope.epoch,
            request.metadata?.runId ?? null,
          ])
        : undefined;
    return { scope, nativeScope };
  }
  const messageSignature = (message: ProviderRuntimeRequest["messages"][number]) =>
    JSON.stringify([
      message.role,
      message.content,
      message.name ?? null,
      message.toolCallId ?? null,
      message.toolCalls?.map((call) => [call.id, call.name, call.arguments]) ?? null,
    ]);
  const messagesSignature = (messages: ProviderRuntimeRequest["messages"]) =>
    JSON.stringify(messages.map(messageSignature));
  function prepare(source: ProviderRuntimeRequest, stream: boolean, key: string) {
    if (replay.length >= 128 || historyBytes > 8_388_608)
      throw fail(
        "provider_unavailable",
        "Native Responses history capacity reached. Persist its output and start a fresh session.",
      );
    // Snapshot every wire-relevant field before review/callbacks can mutate caller objects.
    let request: ProviderRuntimeRequest;
    try {
      request = JSON.parse(JSON.stringify(source)) as ProviderRuntimeRequest;
    } catch {
      throw fail("provider_unavailable", "Responses request is not serializable.");
    }
    if (request.providerId !== providerId || request.modelId !== modelId)
      throw fail(
        "provider_unavailable",
        "Responses requires the explicitly configured provider and model.",
      );
    const { scope, nativeScope } = bindContext(request);
    // Runtime handlers will JSON.parse each historical call's arguments once.
    for (const message of request.messages)
      for (const call of message.toolCalls ?? [])
        rejectArgumentCredentialEcho(call.arguments, key, "auth_missing");
    const body = anthropic ? anthropicBody(request,stream) : responsesBody(
      request,
      stream,
      (message, index) => {
        if(!nativeReplayEnabled)return undefined;
        const matches = (entry: ReplayEntry) =>
          entry.messages === messagesSignature(request.messages.slice(0, index)) &&
          entry.assistant === messageSignature(message);
        if (!nativeScope) {
          if (replayNativeOutput || replay.some(matches))
            throw fail(
              "provider_unavailable",
              "Trusted project identity is required for native Responses continuation.",
            );
          return undefined;
        }
        const previous = [...replay]
          .reverse()
          .find((entry) => entry.scope === nativeScope && matches(entry));
        if (previous) return validateNativeReplay(previous.output, message, request);
        const restored = replayNativeOutput?.(request, index, scope);
        if (!restored) return undefined;
        if (
          restored.projectId !== scope.projectId ||
          restored.projectEpoch !== scope.epoch ||
          (restored.runId ?? null) !== (request.metadata?.runId ?? null)
        )
          throw fail(
            "cancelled",
            "Stored native Responses continuation belongs to another project, epoch or run.",
          );
        return validateNativeReplay(restored.output, message, request);
      },
      reasoningEffort,
    );
    let serialized: string;
    try {
      serialized = JSON.stringify(body);
    } catch {
      throw fail("provider_unavailable", "Responses request is not serializable.");
    }
    if (bytes(serialized) > maxRequestBytes)
      throw fail("provider_unavailable", "Responses request exceeds the configured byte limit.");
    const wire = JSON.parse(serialized) as { input: ResponsesItem[] };
    if (containsCredential(request, key) || containsCredential(wire, key))
      throw fail("auth_missing", "Credential material cannot be included in Responses input.");
    // Inspect actual wire items after replay/serialization, without changing bytes.
    for (const item of wire.input ?? [])
      if (item.type === "function_call")
        rejectArgumentCredentialEcho(item.arguments, key, "auth_missing");
    return { request, serialized, scope, nativeScope };
  }
  function remember(
    request: ProviderRuntimeRequest,
    result: ResponsesResult,
    nativeScope: string | undefined,
    key: string,
  ) {
    rejectResultCredentialEcho(result, key);
    if (!nativeScope||!nativeReplayEnabled) return;
    const assistant = {
      role: "assistant",
      content: result.text,
      ...(result.toolCalls.length ? { toolCalls: result.toolCalls } : {}),
    };
    // Clone: callers must not mutate the retained native continuation.
    const entry: ReplayEntry = {
      scope: nativeScope,
      messages: messagesSignature(request.messages),
      assistant: messageSignature(assistant as ProviderRuntimeRequest["messages"][number]),
      output: JSON.parse(JSON.stringify(result.output)) as ResponsesItem[],
    };
    historyBytes += bytes(JSON.stringify(entry));
    replay.push(entry);
  }
  async function* execute(
    source: ProviderRuntimeRequest,
    stream: boolean,
    call: ResponsesCallOptions,
  ): AsyncGenerator<ResponsesStreamChunk, ResponsesResult> {
    if (busy) throw fail("provider_unavailable", "A Responses request is already pending.");
    if (revoked || call.signal?.aborted)
      throw fail("cancelled", "Responses session was cancelled.");
    if (!credential) throw fail("auth_missing", "Enter a session-only credential locally.");
    if (!fetcher)
      throw fail(
        "provider_unavailable",
        "Offline Responses mode requires an explicit synthetic transport.",
      );
    if (mode === "live" && (!gate || !getContext))
      throw fail(
        "provider_unavailable",
        "Live Responses requires exact outbound confirmation and project context.",
      );
    const key = credential;
    busy = true;
    const controller = new AbortController();
    active.add(controller);
    let timedOut = false,
      beforeTransport = true,
      reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const abort = () => controller.abort();
    call.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    let rejectAbort!: () => void;
    const interrupted = new Promise<never>((_, reject) => {
      rejectAbort = () =>
        reject(
          fail(
            timedOut ? "timeout" : "cancelled",
            timedOut ? "Responses request timed out." : "Responses request was cancelled.",
          ),
        );
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    void interrupted.catch(() => undefined);
    if (call.signal?.aborted) controller.abort();
    let chunkIndex = 0,
      heldText = "";
    const heldArguments = new Map<number, string>();
    const streamedArguments = new Map<number, string>();
    const safeText = (value: string) => {
      heldText = (heldText + value).split(key).join("[REDACTED]");
      let suffix = Math.min(key.length - 1, heldText.length);
      while (suffix > 0 && !heldText.endsWith(key.slice(0, suffix))) suffix--;
      const safe = heldText.slice(0, heldText.length - suffix);
      heldText = heldText.slice(heldText.length - suffix);
      return safe;
    };
    try {
      const { request, serialized, scope, nativeScope } = prepare(source, stream, key);
      const requireCurrentProject = () => {
        if (!getContext) return;
        const current = getContext();
        if (current.projectId !== scope.projectId || current.epoch !== scope.epoch)
          throw fail("cancelled", "Responses project identity changed during the request.");
      };
      const chunk = (
        delta: string,
        extra: Partial<ResponsesStreamChunk> = {},
      ): ResponsesStreamChunk => {
        const value: ResponsesStreamChunk = {
          id: request.id + "-responses-" + chunkIndex,
          requestId: request.id,
          providerId,
          modelId,
          index: chunkIndex++,
          delta,
          done: false,
          ...extra,
        };
        requireCurrentProject();
        rejectCredentialEcho(value, key);
        for (const call of value.toolCalls ?? []) rejectArgumentCredentialEcho(call.arguments, key);
        return value;
      };
      requireCurrentProject();
      const envelope: OutboundEnvelope = { endpoint, model: modelId, ...scope, body: serialized };
      const grant = gate
        ? await Promise.race([
            gate.review(envelope, controller.signal, call.outboundSendIntent).catch(() => {
              throw fail("cancelled", "Responses outbound confirmation was withdrawn.");
            }),
            interrupted,
          ])
        : undefined;
      // Exact serialized body is approved first. This hook never reserializes it.
      if (call.beforeSend) await Promise.race([call.beforeSend(), interrupted]);
      const current = getContext?.() ?? scope;
      if (
        JSON.stringify(current) !== JSON.stringify(scope) ||
        (grant && !grant.consume({ ...envelope, ...current }))
      )
        throw fail(
          "cancelled",
          "Responses outbound approval no longer matches the project context.",
        );
      if (controller.signal.aborted || revoked)
        throw fail("cancelled", "Responses was cancelled before sending.");
      const init = {
        method: "POST",
        redirect: "error" as const,
        credentials: "omit" as const,
        cache: "no-store" as const,
        referrerPolicy: "no-referrer" as const,
        headers: {
          "Content-Type": "application/json",
          Accept: stream ? "text/event-stream" : "application/json",
          ...(anthropic ? {"x-api-key":key,"anthropic-version":"2023-06-01"} : {Authorization: "Bearer " + key}),
        },
        body: serialized,
        signal: controller.signal,
      };
      beforeTransport = false;
      const response = await Promise.race([fetcher(endpoint, init), interrupted]);
      if (!response.ok)
        throw fail(
          response.status === 401 || response.status === 403
            ? "auth_missing"
            : response.status === 429
              ? "rate_limited"
              : response.status >= 500
                ? "provider_unavailable"
                : "malformed_response",
          "Responses returned HTTP " + response.status + ". No automatic retry was sent.",
        );
      const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
      if (!response.body || contentType !== (stream ? "text/event-stream" : "application/json"))
        throw fail("malformed_response", "Unexpected Responses content type.");
      reader = response.body.getReader();
      let result: ResponsesResult | undefined;
      if (!stream) {
        const decoder = new TextDecoder("utf-8", { fatal: true });
        let body = "",
          seen = 0;
        while (true) {
          const next = await Promise.race([reader.read(), interrupted]);
          if (next.done) {
            body += decoder.decode();
            break;
          }
          seen += next.value.byteLength;
          if (seen > maxResponseBytes)
            throw fail("malformed_response", "Responses body exceeds the configured byte limit.");
          body += decoder.decode(next.value, { stream: true });
        }
        try {
          result = anthropic ? parseAnthropicResult(JSON.parse(body),request) : parseResponsesResult(JSON.parse(body), request);
        } catch (error) {
          if (error instanceof SyntaxError)
            throw fail("malformed_response", "Invalid Responses JSON.");
          throw error;
        }
      } else {
        const events = anthropic ? new AnthropicEvents(request) : new ResponsesEvents(request);
        for await (const event of responsesSse(reader, providerId, interrupted, maxResponseBytes)) {
          const next = events.accept(event.data, event.event);
          // Refuse a dangerous authoritative result before yielding its final deltas.
          if (next.result) rejectResultCredentialEcho(next.result, key);
          for (const emission of next.emissions) {
            if (controller.signal.aborted)
              throw fail("cancelled", "Responses request was cancelled.");
            if (emission.toolCallDelta) {
              const delta = emission.toolCallDelta;
              const argumentsText =
                (streamedArguments.get(delta.index) ?? "") + delta.argumentsDelta;
              streamedArguments.set(delta.index, argumentsText);
              rejectArgumentCredentialEcho(argumentsText, key, "malformed_response", true);
              if ((delta.id && delta.id.includes(key)) || (delta.name && delta.name.includes(key)))
                throw fail("malformed_response", "Credential echo in Responses function identity.");
              let held = (heldArguments.get(delta.index) ?? "") + delta.argumentsDelta;
              if (held.includes(key))
                throw fail(
                  "malformed_response",
                  "Credential echo in Responses function arguments.",
                );
              let suffix = Math.min(key.length - 1, held.length);
              while (suffix > 0 && !held.endsWith(key.slice(0, suffix))) suffix--;
              const safe = held.slice(0, held.length - suffix);
              held = held.slice(held.length - suffix);
              heldArguments.set(delta.index, held);
              yield chunk("", { toolCallDelta: { ...delta, argumentsDelta: safe } });
            } else {
              const safe = safeText(emission.delta);
              if (safe) yield chunk(safe);
            }
          }
          if (next.result) {
            result = next.result;
            break;
          }
        }
        if (!result)
          throw fail("malformed_response", "Responses stream ended without a terminal event.");
      }
      // Check the whole public result, including response ID and nested keys.
      rejectResultCredentialEcho(result, key);
      requireCurrentProject();
      if (controller.signal.aborted || revoked)
        throw fail("cancelled", "Responses request was cancelled.");
      remember(request, result, nativeScope, key);
      if (stream) {
        // The shared runtime runner consumes toolCallDelta, not terminal-only toolCalls.
        // Anthropic holds all arguments until message_stop and full validation above.
        if(anthropic)for(const [index,call] of result.toolCalls.entries()){
          if(controller.signal.aborted||revoked)throw fail("cancelled","Anthropic request was cancelled.");
          yield chunk("",{toolCallDelta:{index,id:call.id,name:call.name,argumentsDelta:call.arguments}});
        }
        for (const [index, tail] of heldArguments)
          if (tail) {
            if (controller.signal.aborted)
              throw fail("cancelled", "Responses request was cancelled.");
            yield chunk("", { toolCallDelta: { index, argumentsDelta: tail } });
          }
        if (controller.signal.aborted) throw fail("cancelled", "Responses request was cancelled.");
        yield chunk(heldText, {
          done: true,
          finishReason: result.finishReason,
          usage: result.usage,
          usageStatus: result.usageStatus,
          responseId: result.id,
          nativeOutput: result.output,
          ...(result.toolCalls.length ? { toolCalls: result.toolCalls } : {}),
        });
      }
      return result;
    } catch (error) {
      if (controller.signal.aborted)
        throw fail(
          timedOut ? "timeout" : "cancelled",
          timedOut ? "Responses request timed out." : "Responses request was cancelled.",
        );
      throw normalizeFailure(error, key, beforeTransport, Boolean(reader));
    } finally {
      clearTimeout(timer);
      call.signal?.removeEventListener("abort", abort);
      controller.signal.removeEventListener("abort", rejectAbort);
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      active.delete(controller);
      busy = false;
    }
  }
  async function completeNative(
    request: ProviderRuntimeRequest,
    call: ResponsesCallOptions = {},
  ): Promise<ResponsesResult> {
    const iterator = execute(request, false, call);
    const result = await iterator.next();
    if (!result.done) throw fail("malformed_response", "Unexpected non-streaming Responses delta.");
    return result.value;
  }
  const adapter: ProviderAdapter = {
    id: providerId,
    getCapabilities: () => ({
      providerId,
      modelIds: [modelId],
      supportsStreaming: true,
      supportsTools: true,
      supportsPreSendValidation: true,
      wireApi: anthropic ? "anthropic-compatible" : "responses",
      endpoint,
      credentialStorage: "session-only",
      isMock: mode === "offline",
    }),
    stream: (request, call = {}) => execute(request, true, call),
    async complete(request, call = {}): Promise<ProviderRuntimeResponse> {
      const key = credential,
        requestId = request.id;
      const result = await completeNative(request, call);
      const response: ProviderRuntimeResponse = {
        id: result.id,
        requestId,
        providerId,
        modelId,
        text: result.text,
        finishReason: result.finishReason,
        usage: result.usage,
        usageStatus: result.usageStatus,
        createdAt: result.createdAt,
        ...(result.toolCalls.length ? { toolCalls: result.toolCalls } : {}),
      };
      rejectCredentialEcho(response, key);
      for (const call of response.toolCalls ?? [])
        rejectArgumentCredentialEcho(call.arguments, key);
      return response;
    },
  };
  return {
    adapter,
    completeNative,
    /** Direct native streaming keeps usageStatus and complete continuation items. */
    stream: (request: ProviderRuntimeRequest, call: ResponsesCallOptions = {}) =>
      execute(request, true, call),
    setCredential(value: string) {
      if (
        busy ||
        revoked ||
        typeof value !== "string" ||
        value.trim().length < 8 ||
        value.length > 4096 ||
        /[\r\n]/.test(value)
      )
        throw fail("auth_missing", "Invalid or inactive session credential input.");
      credential = value.trim();
    },
    clearCredential() {
      credential = "";
      for (const controller of active) controller.abort();
    },
    dispose() {
      revoked = true;
      credential = "";
      replay.length = 0;
      historyBytes = 0;
      for (const controller of active) controller.abort();
    },
    hasCredential: () => Boolean(credential),
    getStatus: () => ({
      providerId,
      modelId,
      endpoint,
      mode,
      hasCredential: Boolean(credential),
      capabilityVerification: "unverified" as const,
      liveApiValidated: false as const,
    }),
    preview(request: ProviderRuntimeRequest, stream = true) {
      const key = credential;
      try {
        const value = {
          endpoint,
          modelId,
          body: prepare(request, stream, key).serialized,
          automaticRetries: 0,
        };
        rejectCredentialEcho(value, key);
        return value;
      } catch (error) {
        throw normalizeFailure(error, key, true);
      }
    },
  };
}
