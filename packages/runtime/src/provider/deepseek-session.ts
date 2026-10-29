import type { OutboundConsentGate, OutboundEnvelope } from "./outbound-consent.js";
import type { ProviderRuntimeRequest, ProviderRuntimeResponse, ProviderStreamChunk, ProviderUsage } from "@uagent/shared";
import type { ProviderAdapter, ProviderCallOptions } from "./provider-adapter.js";
import { createProviderRuntimeError } from "./provider-error.js";
import { redactString } from "../secrets/redaction.js";

export const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
export const DEEPSEEK_MODEL = "deepseek-flash";
export const DEEPSEEK_CAMPAIGN = "uagent-flash-validation-20261026";
export const DEEPSEEK_BUDGET_MICROS = 10_000_000; // CNY 10, including uncertain/failed requests.

export interface DeepSeekBudgetRecord {
  campaign: typeof DEEPSEEK_CAMPAIGN;
  limitMicros: number;
  reservedMicros: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  uncertainRequests: number;
}
/** Implementations must atomically persist the reservation BEFORE returning.
 * A live store must coordinate processes/windows and fail on corruption or reset.
 * No credential, prompt, response, path, or header belongs in this ledger. */
export interface DeepSeekBudgetStore {
  readonly durable: boolean;
  reserve(maximumMicros: number): string | void | Promise<string | void>;
  recordUsage(usage: ProviderUsage, reservationId?: string): void | Promise<void>;
  read(): DeepSeekBudgetRecord | Promise<DeepSeekBudgetRecord>;
}
export interface DeepSeekConsent {
  endpoint: typeof DEEPSEEK_ENDPOINT;
  model: typeof DEEPSEEK_MODEL;
  campaign: typeof DEEPSEEK_CAMPAIGN;
  expiresAt: number;
  // Conservative, verified upper rates (ceil to whole micro-CNY/token).
  inputMicrosPerToken: number;
  outputMicrosPerToken: number;
  pricesVerified: true;
}
export interface DeepSeekSessionOptions {
  mode: "offline" | "live";
  ledger: DeepSeekBudgetStore;
  consent?: DeepSeekConsent;
  /** Offline tests must supply a synthetic transport; no implicit network. */
  fetcher?: typeof fetch;
  timeoutMs?: number;
  outboundGate?: OutboundConsentGate;
  getProjectContext?: () => { projectId: string | null; epoch: number; revision: string };
}

const fail = (code: "auth_missing" | "provider_unavailable" | "malformed_response" | "cancelled" | "timeout" | "network_error", message: string) =>
  createProviderRuntimeError("deepseek", code, message);
const bytes = (text: string) => new TextEncoder().encode(text).length;
const validInt = (n: number) => Number.isSafeInteger(n) && n >= 0;

/** The original validation policy remains available for its existing tests/history.
 * Desktop product sessions use provider billing and never access this ledger. */
export function createDeepSeekSession(options: DeepSeekSessionOptions) {
  return createDeepSeekTransport(options);
}
export type DeepSeekAccountSessionOptions = Omit<DeepSeekSessionOptions, "ledger" | "consent"> & { expiresAt: number };
export function createDeepSeekAccountSession(options: DeepSeekAccountSessionOptions) {
  return createDeepSeekTransport({...options, accountManaged: true});
}
function createDeepSeekTransport(options: DeepSeekSessionOptions | (DeepSeekAccountSessionOptions & {accountManaged:true})) {
  const validation = "accountManaged" in options ? undefined : options;
  // Never put the credential on adapter/config/snapshot/event objects.
  let credential = "";
  let revoked = false;
  let busy = false;
  const pending = new Set<AbortController>();
  const consent = validation?.consent ? Object.freeze({ ...validation.consent }) : undefined;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw fail("provider_unavailable", "Invalid timeout bound.");

  function prepare(request: ProviderRuntimeRequest) {
    if (request.providerId !== "deepseek" || request.modelId !== DEEPSEEK_MODEL) throw fail("provider_unavailable", "Only deepseek / deepseek-flash is allowed.");
    if (!request.messages.length || request.messages.length > 32) throw fail("provider_unavailable", "Message count exceeds the request bound.");
    const messages = request.messages.map(message => {
      if (!["system", "developer", "user", "assistant"].includes(message.role)) throw fail("provider_unavailable", "Tool messages require a separately approved workflow.");
      return { role: message.role === "developer" ? "system" : message.role, content: redactString(message.content.split(credential || "\u0000").join("[REDACTED]")) };
    });
    const maxTokens = request.maxOutputTokens ?? 1024;
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 1024) throw fail("provider_unavailable", "Output limit must be between 1 and 1024 tokens.");
    const body = { model: DEEPSEEK_MODEL, messages, max_tokens: maxTokens, stream: true, stream_options: { include_usage: true }, thinking: { type: "disabled" }, temperature: 0 };
    const serialized = JSON.stringify(body);
    if (bytes(serialized) > 32_768) throw fail("provider_unavailable", "Request exceeds 32 KiB. Select less context.");
    // Byte upper bound plus deliberately generous per-message template overhead.
    return { body, serialized, inputBound: bytes(serialized) + messages.length * 2048 };
  }

  async function reserve(inputBound: number, outputBound: number) {
    if (!validation) {
      if (!("expiresAt" in options) || !Number.isFinite(options.expiresAt) || options.expiresAt <= Date.now()) throw fail("provider_unavailable", "The memory-only Provider session has expired.");
      return;
    }
    if (!consent || consent.endpoint !== DEEPSEEK_ENDPOINT || consent.model !== DEEPSEEK_MODEL || consent.campaign !== DEEPSEEK_CAMPAIGN || consent.pricesVerified !== true || !Number.isFinite(consent.expiresAt) || consent.expiresAt <= Date.now()) throw fail("provider_unavailable", "Current endpoint, model, price and budget consent is required.");
    if (![consent.inputMicrosPerToken, consent.outputMicrosPerToken].every(n => validInt(n) && n > 0)) throw fail("provider_unavailable", "Verified conservative prices are required.");
    if (options.mode === "live" && (consent.inputMicrosPerToken < 2 || consent.outputMicrosPerToken < 8)) throw fail("provider_unavailable", "Peak cache-miss prices are required; discounted rates are not accepted.");
    if (options.mode === "live" && !validation.ledger.durable) throw fail("provider_unavailable", "Live requests require a durable, coordinated budget ledger.");
    const ledger = await validation.ledger.read();
    if (ledger.campaign !== DEEPSEEK_CAMPAIGN || ledger.limitMicros !== DEEPSEEK_BUDGET_MICROS || ![ledger.reservedMicros, ledger.requests, ledger.inputTokens, ledger.outputTokens, ledger.uncertainRequests].every(validInt) || ledger.reservedMicros > ledger.limitMicros || ledger.uncertainRequests > ledger.requests || ledger.requests >= 100) throw fail("provider_unavailable", "Budget ledger is missing or invalid.");
    const amount = inputBound * consent.inputMicrosPerToken + outputBound * consent.outputMicrosPerToken;
    if (!validInt(amount) || ledger.reservedMicros + amount > ledger.limitMicros) throw fail("provider_unavailable", "The remaining CNY 10 budget cannot cover this request.");
    // Keep the full reservation even on cancellation, network failure or missing usage.
    return await validation.ledger.reserve(amount);
  }

  async function* stream(request: ProviderRuntimeRequest, call: ProviderCallOptions = {}): AsyncIterable<ProviderStreamChunk> {
    if (busy) throw fail("provider_unavailable", "A provider request is already pending.");
    if (revoked || call.signal?.aborted) throw fail("cancelled", "Provider session cancelled.");
    const prepared = prepare(request);
    if (!credential) throw fail("auth_missing", "Enter a session-only credential locally.");
    if (options.mode === "offline" && !options.fetcher) throw fail("provider_unavailable", "Offline mode requires an explicit synthetic transport.");
    busy = true;
    const controller = new AbortController();
    pending.add(controller);
    const abort = () => controller.abort();
    call.signal?.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const key = credential;
    let releaseAbort: (() => void) | undefined;
    const interrupted = new Promise<never>((_, reject) => {
      releaseAbort = () => reject(fail(timedOut ? "timeout" : "cancelled", timedOut ? "Provider timed out." : "Provider request cancelled."));
      controller.signal.addEventListener("abort", releaseAbort, { once: true });
    });
    // The promise may reject while a consumer is paused between iterator steps.
    void interrupted.catch(() => undefined);
    try {
      if (options.mode === "live" && (!options.outboundGate || !options.getProjectContext)) throw fail("provider_unavailable", "Exact outbound confirmation and project context are required.");
      const scope=options.getProjectContext?.() ?? {projectId:request.metadata?.projectId??null,epoch:request.metadata?.projectEpoch??0,revision:request.id};
      if (request.metadata?.projectId !== undefined && request.metadata.projectId !== scope.projectId) throw fail("cancelled", "Project changed before outbound review.");
      const envelope: OutboundEnvelope={endpoint:DEEPSEEK_ENDPOINT,model:DEEPSEEK_MODEL,...scope,body:prepared.serialized,...(consent?{maximumCostMicros:prepared.inputBound*consent.inputMicrosPerToken+prepared.body.max_tokens*consent.outputMicrosPerToken}:{})};
      const grant=options.outboundGate ? await Promise.race([options.outboundGate.review(envelope,controller.signal).catch(()=>{throw fail("cancelled", "Outbound confirmation was withdrawn.");}),interrupted]) : null;
      const reservationId=await Promise.race([reserve(prepared.inputBound, prepared.body.max_tokens), interrupted]);
      const current=options.getProjectContext?.()??scope;
      if (JSON.stringify(current)!==JSON.stringify(scope) || (grant && !grant.consume({...envelope,...current}))) throw fail("cancelled", "Outbound confirmation no longer matches the current context.");
      if (consent && consent.expiresAt<=Date.now()) throw fail("provider_unavailable", "Price consent expired before sending.");
      if (controller.signal.aborted) throw fail("cancelled", "Provider request cancelled before send.");
      const init = {
        method: "POST", redirect: "error" as const, credentials: "omit" as const, cache: "no-store" as const, referrerPolicy: "no-referrer" as const,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: prepared.serialized, signal: controller.signal,
      };
      const response = await Promise.race([(options.fetcher ?? fetch)(DEEPSEEK_ENDPOINT, init), interrupted]);
      if (!response.ok) throw fail("network_error", `Provider returned HTTP ${response.status}. No automatic retry was sent.`);
      if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) throw fail("malformed_response", "Expected a bounded SSE response.");
      reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let buffer = "", held = "", seen = 0, index = 0, outputBytes = 0;
      let finished = false, completionSeen = false, usage: ProviderUsage | undefined;
      let finishReason: "stop" | "length" = "stop";
      while (!finished) {
        const item = await Promise.race([reader.read(), interrupted]);
        if (item.done) throw fail("malformed_response", "Provider stream ended without DONE.");
        seen += item.value.length;
        if (seen > 262_144) throw fail("malformed_response", "Provider response exceeds 256 KiB.");
        buffer += decoder.decode(item.value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).replace(/\r$/, ""); buffer = buffer.slice(newline + 1);
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (data === "[DONE]") { finished = true; break; }
          if (!data) continue;
          if (++index > 2048) throw fail("malformed_response", "Provider event limit exceeded.");
          if (completionSeen) throw fail("malformed_response", "Unexpected event after completion.");
          const event = JSON.parse(data);
          if (event.error || (event.model && event.model !== DEEPSEEK_MODEL)) throw fail("malformed_response", "Unexpected provider response identity or error.");
          const choice = event.choices?.[0];
          if (choice?.delta?.reasoning_content) throw fail("malformed_response", "Unexpected thinking output in the non-thinking session.");
          if (choice?.delta?.tool_calls || choice?.delta?.function_call) throw fail("malformed_response", "Unapproved tool output rejected.");
          if (choice?.finish_reason != null) {
            if (!["stop", "length"].includes(choice.finish_reason)) throw fail("malformed_response", "Unsupported provider completion reason.");
            finishReason = choice.finish_reason;
            completionSeen = true;
          }
          const delta = choice?.delta?.content ?? "";
          if (typeof delta !== "string") throw fail("malformed_response", "Invalid provider text.");
          outputBytes += bytes(delta);
          if (outputBytes > 16_384) throw fail("malformed_response", "Provider output exceeds 16 KiB.");
          held += delta;
          // Hold only a suffix that can still become this credential. Ordinary
          // short deltas render immediately; split credential echoes stay masked.
          held = held.split(key).join("[REDACTED]");
          let suffixLength=Math.min(key.length-1,held.length);
          while(suffixLength>0&&!held.endsWith(key.slice(0,suffixLength)))suffixLength--;
          const safeLength = held.length-suffixLength;
          if (safeLength) {
            const safe = held.slice(0, safeLength); held = held.slice(safeLength);
            yield { id: `${request.id}-${index}`, requestId: request.id, providerId: "deepseek", modelId: DEEPSEEK_MODEL, index, delta: safe, done: false };
          }
          if (event.usage) {
            const { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: totalTokens } = event.usage;
            const reasoningTokens = event.usage.completion_tokens_details?.reasoning_tokens;
            if (reasoningTokens != null && reasoningTokens !== 0) throw fail("malformed_response", "Unexpected thinking usage in the non-thinking session.");
            if (![inputTokens, outputTokens, totalTokens].every(validInt) || inputTokens + outputTokens !== totalTokens || inputTokens > prepared.inputBound || outputTokens > prepared.body.max_tokens) throw fail("malformed_response", "Unreliable provider usage. Further requests require review.");
            usage = { inputTokens, outputTokens, totalTokens };
          }
        }
      }
      if (!usage || !completionSeen) throw fail("malformed_response", "Provider usage or completion marker missing. No automatic retry.");
      if (validation) await validation.ledger.recordUsage(usage, typeof reservationId === "string" ? reservationId : undefined);
      if (controller.signal.aborted) throw fail("cancelled", "Provider request cancelled.");
      yield { id: `${request.id}-done`, requestId: request.id, providerId: "deepseek", modelId: DEEPSEEK_MODEL, index: index + 1, delta: held.split(key).join("[REDACTED]"), done: true, usage, finishReason };
    } catch (error) {
      if (controller.signal.aborted) throw fail(timedOut ? "timeout" : "cancelled", timedOut ? "Provider timed out." : "Provider request cancelled.");
      // No raw transport errors, HTTP bodies, headers or request values enter logs.
      if (error && typeof error === "object" && "name" in error && error.name === "ProviderRuntimeError") {
        if ("code" in error && error.code === "malformed_response") { revoked = true; credential = ""; }
        throw error;
      }
      throw fail("network_error", "Provider request failed. No automatic retry.");
    } finally {
      clearTimeout(timer);
      call.signal?.removeEventListener("abort", abort);
      if (releaseAbort) controller.signal.removeEventListener("abort", releaseAbort);
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      pending.delete(controller); busy = false;
    }
  }
  const adapter: ProviderAdapter = {
    id: "deepseek", stream,
    getCapabilities: () => ({ providerId: "deepseek", modelIds: [DEEPSEEK_MODEL], supportsStreaming: true, supportsTools: false, isMock: options.mode === "offline" }),
    async complete(request, call): Promise<ProviderRuntimeResponse> {
      let text = "", usage: ProviderUsage | undefined, finishReason: "stop" | "length" = "stop";
      for await (const chunk of stream(request, call)) { text += chunk.delta; if (chunk.usage) usage = chunk.usage; if (chunk.finishReason) finishReason = chunk.finishReason; }
      if (!usage) throw fail("malformed_response", "Missing measured usage.");
      return { id: `${request.id}-response`, requestId: request.id, providerId: "deepseek", modelId: DEEPSEEK_MODEL, text, usage, finishReason, createdAt: Date.now() };
    },
  };
  return {
    adapter,
    setCredential(value: string) {
      if (busy || revoked || value.trim().length < 8 || value.length > 512 || /[\r\n]/.test(value)) throw fail("auth_missing", "Invalid or inactive session credential input.");
      credential = value.trim();
    },
    clearCredential() { credential = ""; revoked = true; for (const controller of pending) controller.abort(); },
    hasCredential: () => Boolean(credential),
    preview(request: ProviderRuntimeRequest) { return { endpoint: DEEPSEEK_ENDPOINT, ...prepare(request).body, automaticRetries: 0 }; },
  };
}
