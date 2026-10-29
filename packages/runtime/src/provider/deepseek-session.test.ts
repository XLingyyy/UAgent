import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderRuntimeRequest } from "@uagent/shared";
import { createDeepSeekSession, DEEPSEEK_BUDGET_MICROS, DEEPSEEK_CAMPAIGN, DEEPSEEK_ENDPOINT, DEEPSEEK_MODEL, type DeepSeekBudgetRecord, type DeepSeekBudgetStore, type DeepSeekConsent } from "./deepseek-session.js";

const syntheticKey = "synthetic-session-key";
const request: ProviderRuntimeRequest = { id: "synthetic-request", providerId: "deepseek", modelId: DEEPSEEK_MODEL, messages: [{ role: "user", content: "Explain a synthetic cube." }] };
const consent: DeepSeekConsent = { endpoint: DEEPSEEK_ENDPOINT, model: DEEPSEEK_MODEL, campaign: DEEPSEEK_CAMPAIGN, expiresAt: Date.now() + 60_000, inputMicrosPerToken: 10, outputMicrosPerToken: 10, pricesVerified: true };
function ledger(): DeepSeekBudgetStore & { read(): DeepSeekBudgetRecord } {
  let state: DeepSeekBudgetRecord = { campaign: DEEPSEEK_CAMPAIGN, limitMicros: DEEPSEEK_BUDGET_MICROS, reservedMicros: 0, requests: 0, inputTokens: 0, outputTokens: 0, uncertainRequests: 0 };
  return { durable: false, read: () => ({ ...state }), reserve(amount) { if (state.reservedMicros + amount > state.limitMicros) throw Error("budget"); state = { ...state, reservedMicros: state.reservedMicros + amount, requests: state.requests + 1, uncertainRequests: state.uncertainRequests + 1 }; }, recordUsage(usage) { state = { ...state, inputTokens: state.inputTokens + usage.inputTokens, outputTokens: state.outputTokens + usage.outputTokens, uncertainRequests: state.uncertainRequests - 1 }; } };
}
function sse(deltas = ["Synthetic analysis."], withUsage = true): Response {
  const events: unknown[] = deltas.map(content => ({ model: DEEPSEEK_MODEL, choices: [{ delta: { content } }] }));
  events.push({ choices: [{ delta: {}, finish_reason: "stop" }], ...(withUsage ? { usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } } : {}) });
  return new Response(events.map(e => `data: ${JSON.stringify(e)}\r\n\r\n`).join("") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } });
}
function setup(fetcher: typeof fetch = vi.fn(async () => sse()), store: DeepSeekBudgetStore & { read(): DeepSeekBudgetRecord } = ledger()) {
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("REAL NETWORK FORBIDDEN"); }));
  const session = createDeepSeekSession({ mode: "offline", ledger: store, consent, fetcher });
  session.setCredential(syntheticKey);
  return { session, fetcher: vi.mocked(fetcher), store };
}
afterEach(() => { vi.unstubAllGlobals(); });

describe("bounded DeepSeek session (synthetic transport only)", () => {
  it("sends only the fixed Flash endpoint after reservation and records measured usage", async () => {
    const { session, fetcher, store } = setup();
    const result = await session.adapter.complete(request);
    expect(result.text).toBe("Synthetic analysis.");
    expect(result.usage.totalTokens).toBe(20);
    expect(store.read()).toMatchObject({ requests: 1, inputTokens: 12, outputTokens: 8, uncertainRequests: 0 });
    expect((await store.read()).reservedMicros).toBeGreaterThan(0);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(DEEPSEEK_ENDPOINT); expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body as string)).toMatchObject({ model: DEEPSEEK_MODEL, max_tokens: 1024, thinking: { type: "disabled" } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("rejects other models before reserving or sending", async () => {
    const { session, fetcher, store } = setup();
    await expect(session.adapter.complete({ ...request, modelId: "deepseek-v4-pro" })).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(fetcher).not.toHaveBeenCalled(); expect((await store.read()).requests).toBe(0);
  });
  it("rejects unconfirmed consent and missing credentials without transport", async () => {
    const fetcher = vi.fn(async () => sse());
    const session = createDeepSeekSession({ mode: "offline", ledger: ledger(), fetcher });
    await expect(session.adapter.complete(request)).rejects.toMatchObject({ code: "auth_missing" });
    session.setCredential(syntheticKey);
    await expect(session.adapter.complete(request)).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("requires a durable ledger for live mode even with an injected transport", async () => {
    const fetcher = vi.fn(async () => sse());
    const session = createDeepSeekSession({ mode: "live", consent, ledger: ledger(), fetcher });
    session.setCredential(syntheticKey);
    await expect(session.adapter.complete(request)).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("retains failed-request reservations across session reconstruction; budget cannot reset", async () => {
    const store = ledger(); store.reserve(DEEPSEEK_BUDGET_MICROS - 60_000);
    const failed = vi.fn(async () => { throw Error(syntheticKey); });
    const first = setup(failed, store);
    await expect(first.session.adapter.complete(request)).rejects.toMatchObject({ message: "Provider request failed. Reservation retained; no automatic retry." });
    expect(failed).toHaveBeenCalledTimes(1);
    const second = setup(vi.fn(async () => sse()), store);
    await expect(second.session.adapter.complete(request)).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(second.fetcher).not.toHaveBeenCalled();
  });
  it("does not send when budget persistence fails", async () => {
    const store = ledger(); store.reserve = () => { throw Error("synthetic_disk_failure"); };
    const { session, fetcher } = setup(vi.fn(async () => sse()), store);
    await expect(session.adapter.complete(request)).rejects.toBeDefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("removes the credential from preview and an echo split across SSE chunks", async () => {
    const { session } = setup(vi.fn(async () => sse(["Result: synthetic-", "session-", "key done"])));
    expect(JSON.stringify(session.preview({ ...request, messages: [{ role: "user", content: syntheticKey }] }))).not.toContain(syntheticKey);
    const result = await session.adapter.complete(request);
    expect(result.text).toBe("Result: [REDACTED] done");
    expect(JSON.stringify(session)).not.toContain(syntheticKey);
  });
  it("cancels a stalled transport and retains its reservation", async () => {
    const { session, store } = setup(vi.fn(() => new Promise<Response>(() => undefined)));
    const abort = new AbortController();
    const result = session.adapter.complete(request, { signal: abort.signal });
    abort.abort();
    await expect(result).rejects.toMatchObject({ code: "cancelled" });
    expect(store.read()).toMatchObject({ requests: 1, uncertainRequests: 1 });
  });
  it("times out a stalled transport without retrying", async () => {
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined));
    const session = createDeepSeekSession({ mode: "offline", consent, ledger: ledger(), fetcher, timeoutMs: 5 }); session.setCredential(syntheticKey);
    await expect(session.adapter.complete(request)).rejects.toMatchObject({ code: "timeout" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects excessive input and output limits without transport", async () => {
    const { session, fetcher } = setup();
    await expect(session.adapter.complete({ ...request, messages: [{ role: "user", content: "a ".repeat(20_000) }] })).rejects.toMatchObject({ code: "provider_unavailable" });
    await expect(session.adapter.complete({ ...request, maxOutputTokens: 1025 })).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("missing usage fails instead of inventing a token count", async () => {
    const { session, store } = setup(vi.fn(async () => sse(["text"], false)));
    await expect(session.adapter.complete(request)).rejects.toMatchObject({ code: "malformed_response" });
    expect(store.read()).toMatchObject({ inputTokens: 0, outputTokens: 0, uncertainRequests: 1 });
  });
  it("waits for durable reservation completion before transport", async () => {
    const store = ledger();
    let release!: () => void;
    const original = store.reserve;
    store.reserve = async amount => { await new Promise<void>(resolve => { release = resolve; }); original(amount); };
    const { session, fetcher } = setup(vi.fn(async () => sse()), store);
    const pending = session.adapter.complete(request);
    await vi.waitFor(() => expect(release).toBeDefined());
    expect(fetcher).not.toHaveBeenCalled();
    release(); await pending;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not send if cancellation arrives while the ledger is persisting", async () => {
    const store = ledger();
    let release!: () => void;
    const original = store.reserve;
    store.reserve = async amount => { await new Promise<void>(resolve => { release = resolve; }); original(amount); };
    const { session, fetcher } = setup(vi.fn(async () => sse()), store);
    const controller = new AbortController();
    const pending = session.adapter.complete(request, { signal: controller.signal });
    await vi.waitFor(() => expect(release).toBeDefined());
    controller.abort(); release();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("times out during budget persistence without ever sending", async () => {
    const store = ledger(); store.reserve = () => new Promise<void>(() => undefined);
    const fetcher = vi.fn(async () => sse());
    const session = createDeepSeekSession({ mode: "offline", consent, ledger: store, fetcher, timeoutMs: 5 });
    session.setCredential(syntheticKey);
    await expect(session.adapter.complete(request)).rejects.toMatchObject({ code: "timeout" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects unapproved tool output and revokes the unreliable session", async () => {
    const fetcher = vi.fn(async () => new Response('data: {"choices":[{"delta":{"tool_calls":[{"function":{"name":"delete_file"}}]}}]}\n\ndata: [DONE]\n\n', { headers: { "Content-Type": "text/event-stream" } }));
    const { session } = setup(fetcher);
    await expect(session.adapter.complete(request)).rejects.toMatchObject({ code: "malformed_response" });
    expect(session.hasCredential()).toBe(false);
    await expect(session.adapter.complete(request)).rejects.toMatchObject({ code: "cancelled" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("clearing a credential revokes the pending request and reuse", async () => {
    const { session } = setup(vi.fn(() => new Promise<Response>(() => undefined)));
    const pending = session.adapter.complete(request); session.clearCredential();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(session.hasCredential()).toBe(false);
    expect(() => session.setCredential(syntheticKey)).toThrow();
  });
});

describe("verified non-thinking output accounting", () => {
  it.each(["delta", "usage"])("rejects unexpected reasoning %s and keeps reservation", async kind => {
    const event=kind==="delta" ? {choices:[{delta:{reasoning_content:"Synthetic thought"}}]} : {choices:[{delta:{},finish_reason:"stop"}],usage:{prompt_tokens:12,completion_tokens:8,total_tokens:20,completion_tokens_details:{reasoning_tokens:2}}};
    const response=new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`,{headers:{"Content-Type":"text/event-stream"}});
    const {session,store,fetcher}=setup(vi.fn(async()=>response));
    await expect(session.adapter.complete(request)).rejects.toMatchObject({code:"malformed_response"});
    expect((await store.read()).reservedMicros).toBeGreaterThan(0);
    expect((await store.read()).uncertainRequests).toBe(1);
    expect(session.hasCredential()).toBe(false);
    await expect(session.adapter.complete(request)).rejects.toBeDefined();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
