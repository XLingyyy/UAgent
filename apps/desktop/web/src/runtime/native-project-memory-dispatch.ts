import {
  PROJECT_MEMORY_RESPONSES_ENDPOINT, ProjectMemoryDispatchError,
  parseProjectMemoryActionReply, parseProjectMemoryDispatchOwner,
  parseProjectMemoryPreparedReply, parseProjectMemorySelectedRevisions,
  parseProjectMemorySelectionReply, sameProjectMemoryDispatchOwner,
  sameProjectMemorySelectedRevisions, validateProjectMemoryResponsesBody,
  type MemoryDispatchReason, type MemoryDispatchStatus,
  type ProjectMemoryActionReply, type ProjectMemoryActionInputDTO,
  type ProjectMemoryCancelInputDTO, type ProjectMemoryPrepareInputDTO,
  type ProjectMemorySelectionInputDTO, type ProjectMemoryDispatchOwner,
  type ProjectMemoryPreparedReply, type ProjectMemorySelectedRevision,
  type ProjectMemorySelectionReply,
} from "../../../../../packages/runtime/src/project-memory/dispatch-contract";

export type NativeMemoryDispatchInvoke = (command: string, args: { input: unknown }) => Promise<unknown>;
export interface NativeMemoryDispatchContext {
  /** Original live renderer lifecycle object; a clone is stale, never authority. */
  readonly identity: object;
  readonly owner: ProjectMemoryDispatchOwner;
}
export interface NativeMemoryDispatchOptions {
  /** Supplied by the established native Responses session. No fixture/fetch fallback. */
  readonly invoke: NativeMemoryDispatchInvoke | null;
  readonly owner: ProjectMemoryDispatchOwner;
  /** Native run/profile ceiling. Native must independently enforce its deadline. */
  readonly expiresAt: number;
  readonly getCurrentContext: () => NativeMemoryDispatchContext | null;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}
export type NativeMemoryDispatchState = "idle" | "selecting" | "selected" | "preparing" | "prepared" | "approving" | "approved" | "dispatching" | "dispatched" | "completed" | "rejected" | "cancelled" | "expired" | "contextChanged" | "outcomeUnknown";
/** Local cleanup data, never native admission or a new send grant. */
export interface NativeMemoryDispatchCompletion {
  readonly batchId: string;
  readonly requestId: string;
  readonly bodySha256: string;
  readonly done: true;
  readonly error: null;
  readonly dispatchStatus: "sent";
}
export interface NativeMemoryDispatchSnapshot {
  readonly state: NativeMemoryDispatchState;
  readonly dispatchStatus: MemoryDispatchStatus;
  readonly reason: MemoryDispatchReason | null;
  readonly invalidatedBy: "cancelled" | "expired" | "contextChanged" | null;
  readonly cancellation: "none" | "pending" | "confirmed" | "outcomeUnknown";
  readonly batchId: string | null;
  readonly requestId: string | null;
}
async function sha256(text: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new ProjectMemoryDispatchError("unavailable");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}
/**
 * Companion of ONE existing native Responses run. No receipt hydration, Permit,
 * renderer authority issuer, network transport, stream reader or persistence.
 * Native admission and the existing sender remain the only dispatch authority.
 */
export function createNativeProjectMemoryDispatch(options: NativeMemoryDispatchOptions) {
  const owner = parseProjectMemoryDispatchOwner(options.owner), invoke = options.invoke;
  const now = options.now ?? Date.now, signal = options.signal;
  let initial: NativeMemoryDispatchContext | null;
  try { initial = options.getCurrentContext(); } catch { initial = null; }
  if (!initial || !initial.identity || typeof initial.identity !== "object" || !sameProjectMemoryDispatchOwner(parseProjectMemoryDispatchOwner(initial.owner), owner)) throw new ProjectMemoryDispatchError("contextChanged");
  const identity = initial.identity;
  const clock = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) throw new ProjectMemoryDispatchError("invalid");
    return value;
  };
  let expiresAt = options.expiresAt;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= clock() || expiresAt - clock() > 3_600_000) throw new ProjectMemoryDispatchError("expired");
  let state: NativeMemoryDispatchState = "idle", dispatchStatus: MemoryDispatchStatus = "notDispatched";
  let reason: MemoryDispatchReason | null = null;
  let invalidatedBy: NativeMemoryDispatchSnapshot["invalidatedBy"] = null;
  let cancellation: NativeMemoryDispatchSnapshot["cancellation"] = "none";
  let selection: ProjectMemorySelectionReply | null = null, prepared: ProjectMemoryPreparedReply | null = null;
  let touchedNative = false, dispatchAttempted = false;
  let nativeTerminalStatus: MemoryDispatchStatus | null = null;
  let interrupt!: (cause: MemoryDispatchReason) => void;
  const interrupted = new Promise<MemoryDispatchReason>(resolve => { interrupt = resolve; });
  function interruptible<T>(promise: Promise<T>): Promise<T> {
    return Promise.race([promise, interrupted.then(cause => { throw new ProjectMemoryDispatchError(cause); })]);
  }
  function callNative(command: string, input: ProjectMemorySelectionInputDTO | ProjectMemoryPrepareInputDTO | ProjectMemoryActionInputDTO): Promise<unknown> {
    assertCurrent();
    if (!invoke) throw new ProjectMemoryDispatchError("unavailable");
    touchedNative = true;
    // Invoke once immediately; racing only changes local waiting, not native work.
    return interruptible(invoke(command, { input }));
  }
  let cancellationPromise: Promise<NativeMemoryDispatchSnapshot> | null = null;
  let expiry: ReturnType<typeof setTimeout> | null = null;
  const snapshot = (): NativeMemoryDispatchSnapshot => Object.freeze({ state, dispatchStatus, reason, invalidatedBy, cancellation, batchId: selection?.batch.batchId ?? null, requestId: prepared?.requestId ?? null });
  function detach(): void {
    if (expiry !== null) clearTimeout(expiry);
    expiry = null;
    signal?.removeEventListener("abort", abort);
  }
  function startNativeCancellation(): Promise<NativeMemoryDispatchSnapshot> {
    if (cancellationPromise) return cancellationPromise;
    detach();
    if (!touchedNative) {
      cancellation = "confirmed";
      return cancellationPromise = Promise.resolve(snapshot());
    }
    cancellation = "pending";
    const batchId = selection?.batch.batchId ?? null, requestId = prepared?.requestId ?? null;
    const cancelInput: ProjectMemoryCancelInputDTO = { schemaVersion: 1, runHandle: owner.runHandle, batchId, requestId };
    // Run correlation covers a lost select/prepare reply. Native must tombstone
    // the original workflow BEFORE ack; late queued work may never resurrect it.
    cancellationPromise = Promise.resolve().then(async () => {
      try {
        if (!invoke) throw new ProjectMemoryDispatchError("unavailable");
        let timeout: ReturnType<typeof setTimeout> | undefined;
        let raw: unknown;
        try {
          raw = await Promise.race([
            invoke("cancel_native_project_memory_dispatch", { input: cancelInput }),
            new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new ProjectMemoryDispatchError("outcomeUnknown")), 2000); }),
          ]);
        } finally { if (timeout !== undefined) clearTimeout(timeout); }
        const result = parseProjectMemoryActionReply(raw, owner, batchId, requestId);
        if (result.action !== "cancelled" || (nativeTerminalStatus !== null && result.dispatchStatus !== nativeTerminalStatus)) throw new ProjectMemoryDispatchError("invalid");
        cancellation = "confirmed";
        // Exact native terminal proof may refine an uncertain IPC result. Native
        // must have made all future dispatch for this original request impossible.
        dispatchStatus = result.dispatchStatus;
      } catch {
        cancellation = "outcomeUnknown";
        state = "outcomeUnknown";
        reason = "outcomeUnknown";
        if (dispatchAttempted && dispatchStatus !== "sent") dispatchStatus = "mayHaveBeenSent";
      }
      return snapshot();
    });
    return cancellationPromise;
  }
  function invalidate(cause: NonNullable<NativeMemoryDispatchSnapshot["invalidatedBy"]>): Promise<NativeMemoryDispatchSnapshot> {
    if (state === "completed") return Promise.resolve(snapshot());
    if (invalidatedBy === null) {
      invalidatedBy = cause;
      interrupt(cause);
      if (state !== "outcomeUnknown") { state = cause; reason = cause; }
    }
    return startNativeCancellation();
  }
  function abort(): void { void invalidate("cancelled"); }
  function armExpiry(): void {
    if (expiry !== null) clearTimeout(expiry);
    expiry = setTimeout(() => { void invalidate("expired"); }, Math.max(0, expiresAt - clock()));
  }
  function assertCurrent(): void {
    if (state === "completed") throw new ProjectMemoryDispatchError("replay");
    if (invalidatedBy !== null) throw new ProjectMemoryDispatchError(reason === "outcomeUnknown" ? reason : invalidatedBy);
    if (signal?.aborted) { void invalidate("cancelled"); throw new ProjectMemoryDispatchError("cancelled"); }
    let current: NativeMemoryDispatchContext | null;
    try { current = options.getCurrentContext(); } catch { current = null; }
    let same = false;
    try { same = !!current && current.identity === identity && sameProjectMemoryDispatchOwner(parseProjectMemoryDispatchOwner(current.owner), owner); } catch { /* Fixed contextChanged error below. */ }
    if (!same) { void invalidate("contextChanged"); throw new ProjectMemoryDispatchError("contextChanged"); }
    if (clock() >= expiresAt) { void invalidate("expired"); throw new ProjectMemoryDispatchError("expired"); }
    if (state === "outcomeUnknown" || state === "rejected") throw new ProjectMemoryDispatchError(reason ?? "replay");
  }
  function requireState(expected: NativeMemoryDispatchState): void {
    assertCurrent();
    if (state !== expected) throw new ProjectMemoryDispatchError("replay");
    if (!invoke) throw new ProjectMemoryDispatchError("unavailable");
  }
  function fail(): never {
    if (invalidatedBy !== null) throw new ProjectMemoryDispatchError(reason === "outcomeUnknown" ? reason : invalidatedBy);
    if (state === "rejected") throw new ProjectMemoryDispatchError(reason ?? "invalid");
    state = "outcomeUnknown";
    reason = "outcomeUnknown";
    void startNativeCancellation();
    throw new ProjectMemoryDispatchError("outcomeUnknown");
  }
  function checkEarlyRejection(raw: unknown, batchId: string | null, requestId: string | null): void {
    // Inspect only an own data descriptor. Accessors/foreign shapes still go to
    // strict parsers, without executing a getter or copying raw exception text.
    const descriptor = raw && typeof raw === "object" ? Object.getOwnPropertyDescriptor(raw, "action") : undefined;
    if (descriptor && "value" in descriptor && descriptor.value === "rejected") {
      checkAction(parseProjectMemoryActionReply(raw, owner, batchId, requestId), "approved");
    }
  }
  function checkAction(result: ProjectMemoryActionReply, expected: "approved" | "scheduled"): void {
    if (result.action === "rejected") {
      dispatchStatus = result.dispatchStatus;
      nativeTerminalStatus = result.dispatchStatus;
      state = "rejected";
      reason = result.reason!;
      void startNativeCancellation();
      throw new ProjectMemoryDispatchError(reason);
    }
    if (result.action !== expected) throw new ProjectMemoryDispatchError("invalid");
  }
  const actionInput = (): ProjectMemoryActionInputDTO => ({ schemaVersion: 1, runHandle: owner.runHandle, requestId: prepared!.requestId, memoryBatchId: selection!.batch.batchId, bodySha256: prepared!.bodySha256 });
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort(); else armExpiry();

  return Object.freeze({
    snapshot,
    async select(value: readonly ProjectMemorySelectedRevision[]): Promise<ProjectMemorySelectionReply> {
      requireState("idle");
      const selected = parseProjectMemorySelectedRevisions(value);
      state = "selecting";
      touchedNative = true;
      try {
        const raw = await callNative("prepare_native_project_memory_selection", { schemaVersion: 1, runHandle: owner.runHandle, selected });
        assertCurrent();
        checkEarlyRejection(raw, null, null);
        const result = parseProjectMemorySelectionReply(raw, owner);
        if (result.expiresAt > expiresAt || !sameProjectMemorySelectedRevisions(selected, result.batch.selected)) throw new ProjectMemoryDispatchError("invalid");
        if (clock() >= result.expiresAt) { void invalidate("expired"); throw new ProjectMemoryDispatchError("expired"); }
        // The validated shorter native deadline must interrupt even a stalled
        // digest. Keep the selection unpublished until its hash is verified.
        expiresAt = result.expiresAt;
        armExpiry();
        if (await interruptible(sha256(result.batch.message.content)) !== result.batch.sectionSha256) throw new ProjectMemoryDispatchError("invalid");
        assertCurrent();
        if (clock() >= result.expiresAt) { void invalidate("expired"); throw new ProjectMemoryDispatchError("expired"); }
        selection = result;
        state = "selected";
        return result;
      } catch { return fail(); }
    },
    async prepare(body: string): Promise<ProjectMemoryPreparedReply> {
      requireState("selected");
      validateProjectMemoryResponsesBody(body, selection!.batch, owner.modelId);
      state = "preparing";
      try {
        const digest = await interruptible(sha256(body));
        assertCurrent();
        const raw = await callNative("prepare_native_responses_request", { schemaVersion: 1, runHandle: owner.runHandle, body, memoryBatchId: selection!.batch.batchId });
        assertCurrent();
        checkEarlyRejection(raw, selection!.batch.batchId, null);
        const result = parseProjectMemoryPreparedReply(raw, selection!, body);
        if (result.bodySha256 !== digest) throw new ProjectMemoryDispatchError("invalid");
        if (clock() >= result.expiresAt) { void invalidate("expired"); throw new ProjectMemoryDispatchError("expired"); }
        prepared = result;
        expiresAt = result.expiresAt;
        state = "prepared";
        armExpiry();
        return result;
      } catch { return fail(); }
    },
    /** Call only after the actual gate reviewed the entire prepared.body. */
    async approve(): Promise<ProjectMemoryActionReply> {
      requireState("prepared");
      state = "approving";
      try {
        const raw = await callNative("approve_native_responses_request", actionInput());
        assertCurrent();
        const result = parseProjectMemoryActionReply(raw, owner, selection!.batch.batchId, prepared!.requestId);
        checkAction(result, "approved");
        state = "approved";
        return result;
      } catch { return fail(); }
    },
    /** Replaces the existing ONE dispatch IPC; native still owns all admission. */
    async dispatch(): Promise<ProjectMemoryActionReply> {
      requireState("approved");
      if (dispatchAttempted || prepared!.endpoint !== PROJECT_MEMORY_RESPONSES_ENDPOINT) throw new ProjectMemoryDispatchError("replay");
      dispatchAttempted = true;
      state = "dispatching";
      dispatchStatus = "mayHaveBeenSent";
      try {
        const raw = await callNative("dispatch_native_responses_request", actionInput());
        assertCurrent();
        const result = parseProjectMemoryActionReply(raw, owner, selection!.batch.batchId, prepared!.requestId);
        checkAction(result, "scheduled");
        state = "dispatched";
        return result;
      } catch { return fail(); }
    },
    /** Called by the original stream reader only after its validated successful
     * terminal poll. Detaches this ONE request without tombstoning its live run. */
    complete(value: NativeMemoryDispatchCompletion): NativeMemoryDispatchSnapshot {
      requireState("dispatched");
      const keys = ["batchId", "requestId", "bodySha256", "done", "error", "dispatchStatus"];
      if (!value || typeof value !== "object" || ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
          Reflect.ownKeys(value).length !== keys.length || keys.some(key => {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            return !descriptor || !("value" in descriptor);
          })) throw new ProjectMemoryDispatchError("invalid");
      if (value.batchId !== selection!.batch.batchId || value.requestId !== prepared!.requestId ||
          value.bodySha256 !== prepared!.bodySha256 || value.done !== true || value.error !== null ||
          value.dispatchStatus !== "sent") throw new ProjectMemoryDispatchError("invalid");
      detach();
      dispatchStatus = "sent";
      nativeTerminalStatus = "sent";
      state = "completed";
      return snapshot();
    },
    /** Resolves with confirmation or explicit uncertainty; never promises zero-send. */
    cancel: () => invalidate("cancelled"),
    contextChanged: () => invalidate("contextChanged"),
    close: () => invalidate("cancelled"),
  });
}
export type NativeProjectMemoryDispatch = ReturnType<typeof createNativeProjectMemoryDispatch>;