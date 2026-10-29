import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskDraft, ProviderRuntimeRequest } from "@uagent/shared";
import type { ProviderAdapter } from "@uagent/runtime";
import { createDesktopRuntimeAdapter } from "./desktop-runtime-adapter";

const draft: TaskDraft = { input: "Analyze the synthetic cube only", projectId: "synthetic-A", providerId: "deepseek", modelId: "deepseek-flash", permissionMode: "request_approval", reasoningEffort: "medium", runMode: "local", branch: null, contextPercent: null };
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
function synthetic(gate = deferred()) {
  let observed: ProviderRuntimeRequest | undefined;
  let signal: AbortSignal | undefined;
  const adapter: ProviderAdapter = {
    id: "deepseek", getCapabilities: () => ({ providerId: "deepseek", modelIds: ["deepseek-flash"], supportsStreaming: true, supportsTools: false, isMock: true }),
    complete: vi.fn(),
    async *stream(request, options) {
      observed = request; signal = options?.signal;
      yield { id: "synthetic-1", requestId: request.id, providerId: "deepseek", modelId: request.modelId, index: 0, delta: "first part", done: false };
      await gate.promise;
      yield { id: "synthetic-2", requestId: request.id, providerId: "deepseek", modelId: request.modelId, index: 1, delta: " last part", done: true, usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } };
    },
  };
  return { adapter, gate, request: () => observed, signal: () => signal };
}
afterEach(() => { vi.unstubAllGlobals(); });
describe("desktop provider integration (offline only)", () => {
  it("forwards streaming before completion with the selected model and no tool execution", async () => {
    vi.stubGlobal("fetch", vi.fn(() => { throw Error("NETWORK FORBIDDEN"); }));
    const provider = synthetic();
    const runtime = createDesktopRuntimeAdapter({ nativeInvoke: null, providerAdapter: provider.adapter, providerEnabled: true });
    const observed: string[] = [];
    runtime.subscribe(snapshot => { for (const events of Object.values(snapshot.eventsByTaskId)) for (const event of events) if (!observed.includes(event.type)) observed.push(event.type); });
    const pending = runtime.submitTask(draft);
    await vi.waitFor(() => expect(observed).toContain("provider_stream_delta"));
    expect(observed).not.toContain("task_completed");
    expect(provider.request()).toMatchObject({ modelId: "deepseek-flash", providerId: "deepseek" });
    provider.gate.resolve();
    expect((await pending).state).toBe("completed");
    expect(observed).not.toContain("sandbox_started");
    expect(observed).not.toContain("mcp_fallback_to_mock");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("project invalidation aborts and suppresses late provider completion", async () => {
    const provider = synthetic();
    const runtime = createDesktopRuntimeAdapter({ nativeInvoke: null, providerAdapter: provider.adapter, providerEnabled: true });
    const pending = runtime.submitTask(draft);
    await vi.waitFor(() => expect(provider.signal()).toBeDefined());
    runtime.invalidateProjectContext?.();
    expect(provider.signal()?.aborted).toBe(true);
    provider.gate.resolve();
    expect((await pending).state).toBe("cancelled");
    const events = Object.values(runtime.getSnapshot().eventsByTaskId).flat();
    expect(events.filter(event => event.type === "provider_request_completed")).toHaveLength(0);
    expect(events.some(event => event.body?.includes("last part"))).toBe(false);
  });
  it("provider failure does not fall through to deterministic tool execution", async () => {
    const provider = synthetic();
    provider.adapter.stream = async function* () { throw Error("synthetic_unavailable"); };
    const runtime = createDesktopRuntimeAdapter({ nativeInvoke: null, providerAdapter: provider.adapter, providerEnabled: true });
    await expect(runtime.submitTask(draft)).rejects.toThrow("task_submission_failed");
    const events = Object.values(runtime.getSnapshot().eventsByTaskId).flat();
    expect(events.some(event => event.type === "task_failed")).toBe(true);
    expect(events.some(event => event.type === "sandbox_started")).toBe(false);
  });
  it("does not implicitly enable an injected provider", async () => {
    const provider = synthetic();
    const runtime = createDesktopRuntimeAdapter({ nativeInvoke: null, providerAdapter: provider.adapter });
    await expect(runtime.submitTask(draft)).rejects.toThrow();
    expect(provider.request()).toBeUndefined();
  });
});
