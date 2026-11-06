import type { OrdinaryChatArchive, OrdinaryChatRequestArchive } from "./ordinary-chat-archive.js";
import { chatToolDefinitions, chatToolMessages } from "./chat-tool-messages.js";
import { ToolCallAccumulator } from "./tool-call-stream.js";
import type { OutboundConsentGate, OutboundEnvelope } from "./outbound-consent.js";
import type { ProviderRuntimeRequest, ProviderRuntimeResponse, ProviderStreamChunk, ProviderUsage, ProviderToolCallDelta, ProviderFinishReason } from "@uagent/shared";
import type { ProviderAdapter, ProviderCallOptions } from "./provider-adapter.js";
import { createProviderRuntimeError } from "./provider-error.js";

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
  /** Native text archive only; receives prepared credential-redacted messages, never a key. */
  ordinaryArchive?: OrdinaryChatArchive;
}

const fail = (code: "auth_missing" | "provider_unavailable" | "malformed_response" | "cancelled" | "timeout" | "network_error" | "rate_limited", message: string) =>
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
  const groups = new Map<AbortController, object | undefined>();
  const pending = new Set<AbortController>();
  const deliveryCandidates = new Map<string, OrdinaryChatRequestArchive>();
  const consent = validation?.consent ? Object.freeze({ ...validation.consent }) : undefined;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw fail("provider_unavailable", "Invalid timeout bound.");

  function prepare(request: ProviderRuntimeRequest) {
    if (request.providerId !== "deepseek" || request.modelId !== DEEPSEEK_MODEL) throw fail("provider_unavailable", "Only deepseek / deepseek-flash is allowed.");
    if (!request.messages.length || request.messages.length > 32) throw fail("provider_unavailable", "Message count exceeds the request bound.");
    const toolMode = !validation && request.metadata?.purpose === "investigation" && Boolean(request.metadata.runId && request.metadata.scopeRef);
    if ((request.tools?.length || request.messages.some(message=>message.role==="tool" || message.toolCalls)) && !toolMode) throw fail("provider_unavailable","Tool messages require a separately approved workflow.");
    const tools = request.tools?.length ? chatToolDefinitions(request.tools) : undefined;
    const messages = chatToolMessages(request.messages, toolMode && Boolean(tools), credential);
    const maxTokens = request.maxOutputTokens ?? 1024;
    if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 1024) throw fail("provider_unavailable", "Output limit must be between 1 and 1024 tokens.");
    const body = { model: DEEPSEEK_MODEL, messages, max_tokens: maxTokens, stream: true, stream_options: { include_usage: true }, thinking: { type: "disabled" }, temperature: 0, ...(tools ? {tools, tool_choice:request.toolChoice ?? "auto"} : {}) };
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
    const group = !validation && request.metadata?.purpose === "investigation" && request.metadata.runId && request.metadata.scopeRef ? call.parallelInvestigation : undefined;
    if (pending.size && (!group || pending.size >= 4 || [...groups.values()].some(value => value !== group)))
      throw fail("provider_unavailable", "A provider request is already pending.");
    if (revoked || call.signal?.aborted) throw fail("cancelled", "Provider session cancelled.");
    const prepared = prepare(request);
    if (!credential) throw fail("auth_missing", "Enter a session-only credential locally.");
    if (options.mode === "offline" && !options.fetcher) throw fail("provider_unavailable", "Offline mode requires an explicit synthetic transport.");
    const controller = new AbortController();
    pending.add(controller);
    groups.set(controller, group);
    const abort = () => controller.abort();
    call.signal?.addEventListener("abort", abort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const key = credential;
    let archive: OrdinaryChatRequestArchive | undefined, archivedOutput = "", archiveCompleted = false, archiveCancelled = true;
    let errorToReport: unknown;
    const saveHistory = async <T,>(operation: () => Promise<T>): Promise<T> => {
      try { return await operation(); }
      catch { throw fail("provider_unavailable", "Conversation history could not be saved. No automatic retry was sent."); }
    };
    const persistDelta = async (text: string) => {
      if (!text) return;
      if (archive) { await saveHistory(() => archive!.append(text)); archivedOutput += text; }
      if (controller.signal.aborted) throw fail("cancelled", "Provider request cancelled.");
    };
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
      const rates=call.costEstimateRates;
      if(rates && ![rates.input,rates.output].every(n=>Number.isFinite(n)&&n>0&&Number.isSafeInteger(Math.ceil(n))))throw fail("provider_unavailable","Invalid request price estimate.");
      const estimate=rates ? prepared.inputBound*Math.ceil(rates.input)+prepared.body.max_tokens*Math.ceil(rates.output) : undefined;
      if(estimate!==undefined&&!Number.isSafeInteger(estimate))throw fail("provider_unavailable","Request cost estimate overflow.");
      const envelope: OutboundEnvelope={...(estimate!==undefined&&!consent?{estimatedCostMicros:estimate}:{}),endpoint:DEEPSEEK_ENDPOINT,model:DEEPSEEK_MODEL,...scope,body:prepared.serialized,...(consent?{maximumCostMicros:prepared.inputBound*consent.inputMicrosPerToken+prepared.body.max_tokens*consent.outputMicrosPerToken}:{})};
      const grant=options.outboundGate ? await Promise.race([options.outboundGate.review(envelope,controller.signal,call.outboundSendIntent).catch(()=>{throw fail("cancelled", "Outbound confirmation was withdrawn.");}),interrupted]) : null;
      if(call.beforeSend)await Promise.race([call.beforeSend(),interrupted]);
      const reservationId=await Promise.race([reserve(prepared.inputBound, prepared.body.max_tokens), interrupted]);
      if (options.ordinaryArchive && !request.metadata?.purpose && !prepared.body.tools &&
          !request.messages.some(message => message.role === "tool" || message.toolCalls?.length || message.toolCallId)) {
        const conversationId = request.metadata?.conversationId;
        if (typeof conversationId !== "string" || !conversationId) throw fail("provider_unavailable", "Conversation archive identity is unavailable.");
        archive = await saveHistory(() => options.ordinaryArchive!.open({
          requestId: request.id, conversationId, projectId: scope.projectId,
          providerId: "deepseek", modelId: DEEPSEEK_MODEL,
          messages: prepared.body.messages.map(message => ({ role: message.role, content: message.content })),
        }));
      }
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
      if (!response.ok) throw fail(response.status===401 || response.status===403 ? "auth_missing" : response.status===429 ? "rate_limited" : "network_error", `Provider returned HTTP ${response.status}. No automatic retry was sent.`);
      if (!response.headers.get("content-type")?.includes("text/event-stream") || !response.body) throw fail("malformed_response", "Expected a bounded SSE response.");
      reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let buffer = "", held = "", seen = 0, index = 0, outputBytes = 0;
      let finished = false, completionSeen = false, usage: ProviderUsage | undefined;
      let finishReason: Exclude<ProviderFinishReason,"error"> = "stop";
      const toolCalls = new ToolCallAccumulator();
      const toolHeld = new Map<number,string>();
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
          const event = JSON.parse(data);
          if (completionSeen && !(event.usage && Array.isArray(event.choices) && event.choices.length===0)) throw fail("malformed_response","Unexpected event after completion.");
          if (event.error || (event.model && event.model !== DEEPSEEK_MODEL)) throw fail("malformed_response", "Unexpected provider response identity or error.");
          const choice = event.choices?.[0];
          if (choice?.delta?.reasoning_content) throw fail("malformed_response", "Unexpected thinking output in the non-thinking session.");
          if (choice?.delta?.function_call) throw fail("malformed_response","Legacy function output rejected.");
          if (choice?.delta?.tool_calls !== undefined) {
            if (!prepared.body.tools || !Array.isArray(choice.delta.tool_calls)) throw fail("malformed_response","Unapproved tool output rejected.");
            for (const raw of choice.delta.tool_calls) {
              if (!raw || typeof raw!=="object" || (raw.type!==undefined && raw.type!=="function")) throw fail("malformed_response","Invalid tool delta.");
              const delta:ProviderToolCallDelta={index:raw.index, ...(raw.id!==undefined?{id:raw.id}:{}), ...(raw.function?.name!==undefined?{name:raw.function.name}:{}),argumentsDelta:raw.function?.arguments??""};
              if ((typeof delta.id==="string" && delta.id.includes(key)) || (typeof delta.name==="string" && delta.name.includes(key))) throw fail("malformed_response","Credential echo in tool identity.");
              toolCalls.push(delta);
              let pendingText=(toolHeld.get(delta.index)??"")+delta.argumentsDelta;
              if (pendingText.includes(key)) throw fail("malformed_response","Credential echo in tool arguments.");
              let heldLength=Math.min(key.length-1,pendingText.length);
              while(heldLength>0&&!pendingText.endsWith(key.slice(0,heldLength)))heldLength--;
              const safe=pendingText.slice(0,pendingText.length-heldLength);
              pendingText=pendingText.slice(pendingText.length-heldLength);
              toolHeld.set(delta.index,pendingText);
              yield {id:`${request.id}-tool-${index}-${delta.index}`,requestId:request.id,providerId:"deepseek",modelId:DEEPSEEK_MODEL,index,delta:"",done:false,toolCallDelta:{...delta,argumentsDelta:safe}};
            }
          }
          if (choice?.finish_reason != null) {
            if (!["stop", "length", "tool_calls"].includes(choice.finish_reason)) throw fail("malformed_response", "Unsupported provider completion reason.");
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
            await persistDelta(safe);
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
      const completedCalls=toolCalls.finish(finishReason);
      if(completedCalls.some(call=>!prepared.body.tools?.some(tool=>tool.function.name===call.name)))throw fail("malformed_response","Unadvertised tool call rejected.");
      for (const [toolIndex,tail] of toolHeld) if(tail) yield {id:`${request.id}-tool-tail-${toolIndex}`,requestId:request.id,providerId:"deepseek",modelId:DEEPSEEK_MODEL,index:++index,delta:"",done:false,toolCallDelta:{index:toolIndex,argumentsDelta:tail}};
      if (validation) await validation.ledger.recordUsage(usage, typeof reservationId === "string" ? reservationId : undefined);
      if (controller.signal.aborted) throw fail("cancelled", "Provider request cancelled.");
      const tail = held.split(key).join("[REDACTED]");
      await persistDelta(tail);
      if (archive) { await saveHistory(() => archive!.complete(archivedOutput, usage!)); archiveCompleted = true; }
      if (controller.signal.aborted) throw fail("cancelled", "Provider request cancelled.");
      yield { id: `${request.id}-done`, requestId: request.id, providerId: "deepseek", modelId: DEEPSEEK_MODEL, index: index + 1, delta: tail, done: true, usage, finishReason, ...(completedCalls.length?{toolCalls:completedCalls}:{}) };
      // Iteration was consumed, but only the terminal runtime owner can confirm
      // completed delivery. A transport return or durable output is insufficient.
      if (archive && !controller.signal.aborted) deliveryCandidates.set(request.id, archive);
    } catch (error) {
      archiveCancelled = (controller.signal.aborted && !timedOut) || (error !== null && typeof error === "object" && "code" in error && error.code === "cancelled");
      if (controller.signal.aborted) errorToReport = fail(timedOut ? "timeout" : "cancelled", timedOut ? "Provider timed out." : "Provider request cancelled.");
      // No raw transport errors, HTTP bodies, headers or request values enter logs.
      else if (error && typeof error === "object" && "name" in error && error.name === "ProviderRuntimeError") {
        if ("code" in error && error.code === "malformed_response") { revoked = true; credential = ""; for (const other of pending) if(other !== controller) other.abort(); }
        errorToReport = error;
      } else errorToReport = fail("network_error", "Provider request failed. No automatic retry.");
    } finally {
      let archiveFailure = false;
      if (archive && (!archiveCompleted || controller.signal.aborted)) {
        deliveryCandidates.delete(request.id);
        try { await archive.fail(archiveCancelled); }
        catch { archiveFailure = true; }
      }
      clearTimeout(timer);
      call.signal?.removeEventListener("abort", abort);
      if (releaseAbort) controller.signal.removeEventListener("abort", releaseAbort);
      controller.abort();
      void reader?.cancel().catch(() => undefined);
      pending.delete(controller); groups.delete(controller);
      if (revoked) { try { await options.ordinaryArchive?.close(); } catch { archiveFailure = true; } }
      if (archiveFailure) errorToReport = fail("provider_unavailable",
        "Conversation history delivery is unconfirmed. Saved text is excluded from restored context; no automatic retry was sent.");
    }
    if (errorToReport) throw errorToReport;
  }
  const adapter: ProviderAdapter = {
    id: "deepseek", stream,
    async confirmOrdinaryDelivery(requestId, identity) {
      if (!options.ordinaryArchive) return;
      if (identity.providerId !== "deepseek" || identity.modelId !== DEEPSEEK_MODEL)
        throw fail("provider_unavailable", "Conversation history delivery identity changed.");
      const candidate = deliveryCandidates.get(requestId);
      deliveryCandidates.delete(requestId);
      if (!candidate || revoked || !credential) throw fail("provider_unavailable", "Conversation history delivery is unconfirmed.");
      try { await candidate.confirmDelivery(); }
      catch { throw fail("provider_unavailable", "Conversation history delivery is unconfirmed."); }
    },
    getCapabilities: () => ({ providerId: "deepseek", modelIds: [DEEPSEEK_MODEL], supportsStreaming: true, supportsTools: !validation, supportsPreSendValidation:true, supportsParallelInvestigation:!validation, isMock: options.mode === "offline" }),
    async complete(request, call): Promise<ProviderRuntimeResponse> {
      let text = "", usage: ProviderUsage | undefined, finishReason: Exclude<ProviderFinishReason,"error"> = "stop";
      let completedCalls:ProviderRuntimeResponse["toolCalls"];
      for await (const chunk of stream(request, call)) { text += chunk.delta; if (chunk.usage) usage = chunk.usage; if (chunk.finishReason) finishReason = chunk.finishReason; if(chunk.toolCalls)completedCalls=chunk.toolCalls; }
      if (!usage) throw fail("malformed_response", "Missing measured usage.");
      return { id: `${request.id}-response`, requestId: request.id, providerId: "deepseek", modelId: DEEPSEEK_MODEL, text, usage, finishReason, createdAt: Date.now(), ...(completedCalls?.length?{toolCalls:completedCalls}:{}) };
    },
  };
  return {
    adapter,
    setCredential(value: string) {
      if (pending.size || revoked || value.trim().length < 8 || value.length > 512 || /[\r\n]/.test(value)) throw fail("auth_missing", "Invalid or inactive session credential input.");
      credential = value.trim();
    },
    clearCredential() { credential = ""; revoked = true; deliveryCandidates.clear(); for (const controller of pending) controller.abort(); if (!pending.size) void options.ordinaryArchive?.close().catch(() => undefined); },
    hasCredential: () => Boolean(credential),
    preview(request: ProviderRuntimeRequest) { return { endpoint: DEEPSEEK_ENDPOINT, ...prepare(request).body, automaticRetries: 0 }; },
  };
}
