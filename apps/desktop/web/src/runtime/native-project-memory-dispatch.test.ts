import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PROJECT_MEMORY_MESSAGE_PREFIX as PREFIX, PROJECT_MEMORY_RESPONSES_ENDPOINT as ENDPOINT,
  type MemoryDispatchStatus, type ProjectMemoryActionReply,
} from "../../../../../packages/runtime/src/project-memory/dispatch-contract";
import { createNativeProjectMemoryDispatch } from "./native-project-memory-dispatch";

async function digest(text: string) {
  const bytes = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture() {
  const owner = { runHandle: "native-run", runId: "run", projectId: "A", projectEpoch: 7, providerId: "openai", modelId: "gpt-test" };
  const row = { id: "m", revision: 1, kind: "decision", body: "Complete synthetic body", sourceRefs: [{ projectId: "A", path: "Source/main.cpp", version: "original-native-metadata", freshness: "original-native-metadata", kind: "file_preview" }], origin: { kind: "user", sessionId: null, messageId: null }, confirmation: { kind: "user", confirmedAt: 1 }, readAt: 1 };
  const content = PREFIX + JSON.stringify([row]);
  const batch = { schemaVersion: 1, batchId: "a".repeat(32), projectId: "A", selected: [{ id: "m", revision: 1 }], message: { role: "user", content }, sectionSha256: await digest(content), maxContextBytes: 24576 };
  const selectedReply = { schemaVersion: 1, owner, expiresAt: 10_000, batch };
  const message = (role: string, text: string) => ({ type: "message", role, content: [{ type: "input_text", text }] });
  const body = JSON.stringify({ model: owner.modelId, input: [message("system", "System"), message("developer", "Developer"), message("user", content), message("user", "Goal")], stream: true, store: false }, null, 2);
  const preparedReply = { schemaVersion: 1, owner, expiresAt: 10_000, batchId: batch.batchId, requestId: "request", endpoint: ENDPOINT, body, bodySha256: await digest(body) };
  let current = { owner, identity: {} }, cancelStatus: MemoryDispatchStatus = "notDispatched";
  const overrides = new Map<string, (input: Record<string, unknown>) => unknown | Promise<unknown>>();
  const action = (kind: ProjectMemoryActionReply["action"], status: MemoryDispatchStatus, reason: ProjectMemoryActionReply["reason"] = null) => ({ schemaVersion: 1, owner, batchId: batch.batchId, requestId: preparedReply.requestId, action: kind, dispatchStatus: status, terminal: kind === "cancelled" || kind === "rejected", reason });
  const invoke = vi.fn(async (command: string, args: { input: unknown }): Promise<unknown> => {
    const input = args.input as Record<string, unknown>;
    if (overrides.has(command)) return overrides.get(command)!(input);
    if (command === "prepare_native_project_memory_selection") return selectedReply;
    if (command === "prepare_native_responses_request") return preparedReply;
    if (command === "approve_native_responses_request") return action("approved", "notDispatched");
    if (command === "dispatch_native_responses_request") { cancelStatus = "mayHaveBeenSent"; return action("scheduled", "mayHaveBeenSent"); }
    if (command === "cancel_native_project_memory_dispatch") return { ...action("cancelled", cancelStatus, "cancelled"), batchId: input.batchId, requestId: input.requestId };
    throw Error("unexpected synthetic IPC command");
  });
  const signal = new AbortController();
  const bridge = createNativeProjectMemoryDispatch({ invoke, owner, expiresAt: 10_000, getCurrentContext: () => current, signal: signal.signal });
  const ready = async () => { await bridge.select(batch.selected); await bridge.prepare(body); await bridge.approve(); };
  return { owner, batch, body, selectedReply, preparedReply, action, invoke, overrides, signal, bridge, ready,
    switchContext: () => { current = { owner: { ...owner }, identity: {} }; },
    setCancelStatus: (status: MemoryDispatchStatus) => { cancelStatus = status; },
  };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000); vi.stubGlobal("crypto", webcrypto); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const count = (f: Awaited<ReturnType<typeof fixture>>, command: string) => f.invoke.mock.calls.filter(call => call[0] === command).length;

describe("native memory request companion (synthetic IPC only)", () => {
  it("detaches only the completed request and ignores its later expiry/abort/close", async () => {
    const f = await fixture(); await f.ready(); await f.bridge.dispatch();
    const result = f.bridge.complete({batchId:f.batch.batchId,requestId:f.preparedReply.requestId,
      bodySha256:f.preparedReply.bodySha256,done:true,error:null,dispatchStatus:"sent"});
    expect(result.state).toBe("completed"); expect(result.dispatchStatus).toBe("sent");
    f.switchContext(); f.signal.abort(); await vi.advanceTimersByTimeAsync(10_000);
    expect((await f.bridge.close()).state).toBe("completed");
    expect(count(f,"cancel_native_project_memory_dispatch")).toBe(0);
    await expect(f.bridge.dispatch()).rejects.toThrow("project_memory_dispatch_replay");
  });
  it("requires exact terminal sent data for detach and preserves genuine cancellation", async () => {
    const f = await fixture(); await f.ready(); await f.bridge.dispatch();
    const terminal={batchId:f.batch.batchId,requestId:f.preparedReply.requestId,
      bodySha256:f.preparedReply.bodySha256,done:true as const,error:null,dispatchStatus:"sent" as const};
    expect(()=>f.bridge.complete({...terminal,requestId:"foreign"})).toThrow("project_memory_dispatch_invalid");
    expect(()=>f.bridge.complete({...terminal,bodySha256:"0".repeat(64)})).toThrow("project_memory_dispatch_invalid");
    expect(()=>f.bridge.complete({...terminal,done:false} as never)).toThrow("project_memory_dispatch_invalid");
    expect(f.bridge.snapshot().state).toBe("dispatched");
    await f.bridge.cancel(); expect(count(f,"cancel_native_project_memory_dispatch")).toBe(1);
    expect(()=>f.bridge.complete(terminal)).toThrow("project_memory_dispatch_cancelled");
  });
  it("retains exact full review bytes and uses the same run/request for one dispatch", async () => {
    const f = await fixture();
    await f.bridge.select(f.batch.selected);
    const prepared = await f.bridge.prepare(f.body);
    expect(prepared.body).toBe(f.body);
    await f.bridge.approve();
    const result = await f.bridge.dispatch();
    expect(result.dispatchStatus).toBe("mayHaveBeenSent");
    expect(f.bridge.snapshot().state).toBe("dispatched");
    await expect(f.bridge.dispatch()).rejects.toThrow("project_memory_dispatch_replay");
    expect(count(f, "dispatch_native_responses_request")).toBe(1);
    expect(f.invoke).toHaveBeenCalledWith("prepare_native_responses_request", { input: { schemaVersion: 1, runHandle: f.owner.runHandle, body: f.body, memoryBatchId: f.batch.batchId } });
    expect(f.invoke).toHaveBeenCalledWith("dispatch_native_responses_request", { input: { schemaVersion: 1, runHandle: f.owner.runHandle, requestId: "request", memoryBatchId: f.batch.batchId, bodySha256: f.preparedReply.bodySha256 } });
    expect(JSON.stringify(f.invoke.mock.calls)).not.toMatch(/"(?:grant|permit|readPrefixes|sharePrefixes|approved)":/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await f.bridge.close();
  });
  it("has no receipt hydration or unavailable-native fallback", async () => {
    const f = await fixture();
    await expect(f.bridge.prepare(f.body)).rejects.toThrow("project_memory_dispatch_replay");
    await expect(f.bridge.dispatch()).rejects.toThrow("project_memory_dispatch_replay");
    const nativeMissing = createNativeProjectMemoryDispatch({ invoke: null, owner: f.owner, expiresAt: 10_000, getCurrentContext: () => ({ owner: f.owner, identity: f.owner }) });
    await expect(nativeMissing.select(f.batch.selected)).rejects.toThrow("project_memory_dispatch_unavailable");
    expect(globalThis.fetch).not.toHaveBeenCalled();
    await nativeMissing.close(); await f.bridge.close();
  });
  it("retains structured whole-batch rejection reasons during select and prepare", async () => {
    const selecting = await fixture();
    selecting.overrides.set("prepare_native_project_memory_selection", () => ({ ...selecting.action("rejected", "notDispatched", "stale"), batchId: null, requestId: null }));
    await expect(selecting.bridge.select(selecting.batch.selected)).rejects.toThrow("project_memory_dispatch_stale");
    expect(count(selecting, "prepare_native_responses_request")).toBe(0);
    await selecting.bridge.close();
    const preparing = await fixture(); await preparing.bridge.select(preparing.batch.selected);
    preparing.overrides.set("prepare_native_responses_request", () => ({ ...preparing.action("rejected", "notDispatched", "replay"), requestId: null }));
    await expect(preparing.bridge.prepare(preparing.body)).rejects.toThrow("project_memory_dispatch_replay");
    expect(count(preparing, "dispatch_native_responses_request")).toBe(0);
    await preparing.bridge.close();
  });
  it("rejects a bad section hash and never downgrades to renderer memory selection", async () => {
    const f = await fixture();
    f.overrides.set("prepare_native_project_memory_selection", () => ({ ...f.selectedReply, batch: { ...f.batch, sectionSha256: "0".repeat(64) } }));
    await expect(f.bridge.select(f.batch.selected)).rejects.toThrow("project_memory_dispatch_outcomeUnknown");
    expect(f.bridge.snapshot().state).toBe("outcomeUnknown");
    expect(count(f, "prepare_native_responses_request")).toBe(0);
    await f.bridge.close();
    expect(count(f, "cancel_native_project_memory_dispatch")).toBe(1);
  });
  it("rejects another native run or a byte-different prepared body", async () => {
    for (const kind of ["owner", "body", "hash"] as const) {
      const f = await fixture();
      await f.bridge.select(f.batch.selected);
      const reply = kind === "owner" ? { ...f.preparedReply, owner: { ...f.owner, runHandle: "another-run" } } : kind === "body" ? { ...f.preparedReply, body: f.body + " " } : { ...f.preparedReply, bodySha256: "0".repeat(64) };
      f.overrides.set("prepare_native_responses_request", () => reply);
      await expect(f.bridge.prepare(f.body)).rejects.toThrow("project_memory_dispatch_outcomeUnknown");
      expect(count(f, "approve_native_responses_request")).toBe(0);
      expect(count(f, "dispatch_native_responses_request")).toBe(0);
      await f.bridge.close();
    }
  });
  it("cancels an in-flight selection by its original run even before IDs are known", async () => {
    const f = await fixture(), reply = deferred<unknown>();
    f.overrides.set("prepare_native_project_memory_selection", () => reply.promise);
    const selecting = expect(f.bridge.select(f.batch.selected)).rejects.toThrow("project_memory_dispatch_cancelled");
    f.signal.abort();
    const cancelled = await f.bridge.close();
    expect(cancelled.cancellation).toBe("confirmed");
    expect(f.invoke).toHaveBeenCalledWith("cancel_native_project_memory_dispatch", { input: { schemaVersion: 1, runHandle: f.owner.runHandle, batchId: null, requestId: null } });
    await selecting;
    reply.resolve(f.selectedReply);
    await Promise.resolve();
    await expect(f.bridge.prepare(f.body)).rejects.toThrow("project_memory_dispatch_cancelled");
    expect(count(f, "dispatch_native_responses_request")).toBe(0);
  });
  it("does not wait for a pending prepare before native cancellation or accept its late reply", async () => {
    const f = await fixture(), reply = deferred<unknown>(), entered = deferred<void>();
    await f.bridge.select(f.batch.selected);
    f.overrides.set("prepare_native_responses_request", () => { entered.resolve(); return reply.promise; });
    const preparing = expect(f.bridge.prepare(f.body)).rejects.toThrow("project_memory_dispatch_cancelled");
    await entered.promise;
    const result = await f.bridge.cancel();
    expect(result.cancellation).toBe("confirmed");
    expect(f.invoke).toHaveBeenCalledWith("cancel_native_project_memory_dispatch", { input: { schemaVersion: 1, runHandle: f.owner.runHandle, batchId: f.batch.batchId, requestId: null } });
    await preparing;
    reply.resolve(f.preparedReply);
    await Promise.resolve();
    expect(f.bridge.snapshot().requestId).toBeNull();
  });
  it("bounds a lost cancellation acknowledgement without retry or a zero-send claim", async () => {
    const f = await fixture(), never = deferred<unknown>(); await f.ready();
    f.overrides.set("dispatch_native_responses_request", () => { throw Error("lost dispatch ack"); });
    f.overrides.set("cancel_native_project_memory_dispatch", () => never.promise);
    await expect(f.bridge.dispatch()).rejects.toThrow("project_memory_dispatch_outcomeUnknown");
    const closing = f.bridge.close();
    await vi.advanceTimersByTimeAsync(2000);
    const result = await closing;
    expect(result.cancellation).toBe("outcomeUnknown");
    expect(result.dispatchStatus).toBe("mayHaveBeenSent");
    expect(count(f, "cancel_native_project_memory_dispatch")).toBe(1);
    never.resolve(f.action("cancelled", "notDispatched", "cancelled"));
    await Promise.resolve(); await Promise.resolve();
    expect(f.bridge.snapshot().dispatchStatus).toBe("mayHaveBeenSent");
  });
  it("installs a shorter selection deadline before a delayed digest and ignores its late result", async () => {
    const f = await fixture(), entered = deferred<void>(), delayed = deferred<ArrayBuffer>();
    f.selectedReply.expiresAt = 2000; // Original run/profile ceiling is still 10000.
    const completed = await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode(f.batch.message.content));
    const digest = vi.fn(() => { entered.resolve(); return delayed.promise; });
    vi.stubGlobal("crypto", { subtle: { digest } });
    const selecting = expect(f.bridge.select(f.batch.selected)).rejects.toThrow("project_memory_dispatch_expired");
    await entered.promise;
    expect(digest).toHaveBeenCalledTimes(1);
    expect(f.bridge.snapshot()).toMatchObject({ state: "selecting", batchId: null, requestId: null });
    await vi.advanceTimersByTimeAsync(999);
    expect(f.bridge.snapshot().state).toBe("selecting");
    expect(count(f, "cancel_native_project_memory_dispatch")).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(Date.now()).toBe(2000);
    expect(f.bridge.snapshot()).toMatchObject({ state: "expired", invalidatedBy: "expired", cancellation: "confirmed", dispatchStatus: "notDispatched", batchId: null, requestId: null });
    await selecting; // Must finish while the digest is STILL pending.
    expect(f.invoke).toHaveBeenCalledWith("cancel_native_project_memory_dispatch", { input: { schemaVersion: 1, runHandle: f.owner.runHandle, batchId: null, requestId: null } });
    expect(count(f, "cancel_native_project_memory_dispatch")).toBe(1);
    for (const command of ["prepare_native_responses_request", "approve_native_responses_request", "dispatch_native_responses_request"]) expect(count(f, command)).toBe(0);
    delayed.resolve(completed);
    await Promise.resolve(); await Promise.resolve();
    expect(f.bridge.snapshot()).toMatchObject({ state: "expired", invalidatedBy: "expired", batchId: null, requestId: null });
    await expect(f.bridge.select(f.batch.selected)).rejects.toThrow("project_memory_dispatch_expired");
    await f.bridge.close();
    expect(count(f, "cancel_native_project_memory_dispatch")).toBe(1);
  });
  it("expires autonomously and asks native to revoke before any dispatch", async () => {
    const f = await fixture(); await f.ready();
    await vi.advanceTimersByTimeAsync(9000);
    const result = f.bridge.snapshot();
    expect(result.invalidatedBy).toBe("expired");
    expect(result.cancellation).toBe("confirmed");
    expect(result.dispatchStatus).toBe("notDispatched");
    await expect(f.bridge.dispatch()).rejects.toThrow("project_memory_dispatch_expired");
    expect(count(f, "dispatch_native_responses_request")).toBe(0);
  });
  it("detects A-to-B-to-A lifecycle replacement even when owner strings match", async () => {
    const f = await fixture(); await f.ready();
    f.switchContext();
    await expect(f.bridge.dispatch()).rejects.toThrow("project_memory_dispatch_contextChanged");
    const result = await f.bridge.contextChanged();
    expect(result.invalidatedBy).toBe("contextChanged");
    expect(result.cancellation).toBe("confirmed");
    expect(count(f, "dispatch_native_responses_request")).toBe(0);
  });
  it("never automatically retries a lost dispatch ack or exposes its exception text", async () => {
    const f = await fixture(); await f.ready();
    f.overrides.set("dispatch_native_responses_request", () => { throw Error("private native diagnostic and credential-like text"); });
    f.overrides.set("cancel_native_project_memory_dispatch", () => { throw Error("lost cancellation ack"); });
    await expect(f.bridge.dispatch()).rejects.toThrow("project_memory_dispatch_outcomeUnknown");
    const result = await f.bridge.close();
    expect(result.state).toBe("outcomeUnknown");
    expect(result.cancellation).toBe("outcomeUnknown");
    expect(result.dispatchStatus).toBe("mayHaveBeenSent");
    await expect(f.bridge.dispatch()).rejects.toThrow("project_memory_dispatch_outcomeUnknown");
    expect(count(f, "dispatch_native_responses_request")).toBe(1);
    expect(count(f, "cancel_native_project_memory_dispatch")).toBe(1);
  });
  it("rejects concurrent replay while the original dispatch is awaiting acknowledgement", async () => {
    const f = await fixture(), reply = deferred<unknown>(); await f.ready();
    f.overrides.set("dispatch_native_responses_request", () => reply.promise);
    const first = f.bridge.dispatch();
    await expect(f.bridge.dispatch()).rejects.toThrow("project_memory_dispatch_replay");
    reply.resolve(f.action("scheduled", "mayHaveBeenSent"));
    await expect(first).resolves.toMatchObject({ action: "scheduled" });
    expect(count(f, "dispatch_native_responses_request")).toBe(1);
    f.setCancelStatus("mayHaveBeenSent"); await f.bridge.close();
  });
  it("keeps native whole-batch stale/replay rejections distinct and never resubmits", async () => {
    for (const reason of ["stale", "replay"] as const) {
      const f = await fixture(); await f.ready();
      f.overrides.set("dispatch_native_responses_request", () => f.action("rejected", "notDispatched", reason));
      await expect(f.bridge.dispatch()).rejects.toThrow(`project_memory_dispatch_${reason}`);
      expect(f.bridge.snapshot().dispatchStatus).toBe("notDispatched");
      await expect(f.bridge.dispatch()).rejects.toThrow();
      expect(count(f, "dispatch_native_responses_request")).toBe(1);
      await f.bridge.close();
    }
  });
  it("preserves mayHaveBeenSent for cleanup failure after native admission", async () => {
    const f = await fixture(); await f.ready(); f.setCancelStatus("mayHaveBeenSent");
    f.overrides.set("dispatch_native_responses_request", () => f.action("rejected", "mayHaveBeenSent", "cleanupFailed"));
    await expect(f.bridge.dispatch()).rejects.toThrow("project_memory_dispatch_cleanupFailed");
    const result = await f.bridge.close();
    expect(result.dispatchStatus).toBe("mayHaveBeenSent");
    expect(count(f, "dispatch_native_responses_request")).toBe(1);
  });
  it("treats malformed or foreign acknowledgements as unknown, never as zero-send proof", async () => {
    const f = await fixture(); await f.ready(); f.setCancelStatus("mayHaveBeenSent");
    f.overrides.set("dispatch_native_responses_request", () => ({ ...f.action("scheduled", "mayHaveBeenSent"), requestId: "other" }));
    f.overrides.set("cancel_native_project_memory_dispatch", () => ({ ...f.action("cancelled", "notDispatched", "cancelled"), terminal: false }));
    await expect(f.bridge.dispatch()).rejects.toThrow("project_memory_dispatch_outcomeUnknown");
    expect((await f.bridge.close()).dispatchStatus).toBe("mayHaveBeenSent");
    expect(f.bridge.snapshot().cancellation).toBe("outcomeUnknown");
  });
  it("does not downgrade a native terminal may-have-sent result on a contradictory cancel ack", async () => {
    const f = await fixture(); await f.ready();
    f.overrides.set("dispatch_native_responses_request", () => f.action("rejected", "mayHaveBeenSent", "cleanupFailed"));
    await expect(f.bridge.dispatch()).rejects.toThrow("project_memory_dispatch_cleanupFailed");
    const result = await f.bridge.close();
    expect(result.cancellation).toBe("outcomeUnknown");
    expect(result.dispatchStatus).toBe("mayHaveBeenSent");
    expect(count(f, "dispatch_native_responses_request")).toBe(1);
  });
  it("preserves a sent native cancellation status and never promises rollback", async () => {
    const f = await fixture(); await f.ready(); await f.bridge.dispatch();
    f.setCancelStatus("sent");
    const result = await f.bridge.cancel();
    expect(result.dispatchStatus).toBe("sent");
    expect(result.cancellation).toBe("confirmed");
    await expect(f.bridge.dispatch()).rejects.toThrow("project_memory_dispatch_cancelled");
  });
  it("revokes promptly during a dispatch/context race without accepting its late ack", async () => {
    const f = await fixture(), reply = deferred<unknown>(); await f.ready(); f.setCancelStatus("mayHaveBeenSent");
    f.overrides.set("dispatch_native_responses_request", () => reply.promise);
    const dispatching = expect(f.bridge.dispatch()).rejects.toThrow("project_memory_dispatch_contextChanged"); f.switchContext();
    const changed = await f.bridge.contextChanged();
    expect(changed.invalidatedBy).toBe("contextChanged");
    expect(changed.dispatchStatus).toBe("mayHaveBeenSent");
    await dispatching;
    reply.resolve(f.action("scheduled", "mayHaveBeenSent"));
    await Promise.resolve();
    expect(count(f, "dispatch_native_responses_request")).toBe(1);
  });
});