import type { RunScopeLease } from "@uagent/runtime";
import type { NativeInvoke } from "./project-native-adapter";
import { localNativeInvoke } from "./native-provider-budget";
import { RuntimeHostError, parseRuntimeHostIdentity, parseRuntimeHostJob, parseRuntimeHostSnapshot,
  validateRuntimeHostModelInput, type RuntimeHostIdentity, type RuntimeHostJobSnapshot,
  type RuntimeHostModelJobInput, type RuntimeHostOwnerRef, type RuntimeHostOwnerSnapshot,
  type RuntimeHostTicketRef } from "./runtime-host-contract";

export interface SharedRuntimeHostTicket {
  /** Correlation data for a protected native sender, never an approval or bearer token. */
  readonly nativeRef: RuntimeHostTicketRef;
  getSnapshot(): Promise<RuntimeHostJobSnapshot>;
  cancel(): Promise<RuntimeHostJobSnapshot>;
  /** Admission alone cannot execute. The native sender must register the real pending worker. */
  waitForAdmission(signal?: AbortSignal): Promise<RuntimeHostJobSnapshot>;
}
export interface SharedRuntimeHostOwner {
  readonly identity: RuntimeHostIdentity;
  readonly nativeRef: RuntimeHostOwnerRef;
  isCurrent(): boolean;
  getSnapshot(): Promise<RuntimeHostOwnerSnapshot>;
  reserveModel(input: RuntimeHostModelJobInput): Promise<SharedRuntimeHostTicket>;
  disconnect(): Promise<RuntimeHostOwnerSnapshot>;
}
export interface SharedRuntimeHostQueue {
  available(): boolean;
  connect(lease: RunScopeLease): Promise<SharedRuntimeHostOwner>;
  /** Application-lifetime cleanup. Components must not call this on ordinary unmount. */
  dispose(): Promise<void>;
}
function safeFailure(error: unknown): RuntimeHostError {
  if (error instanceof RuntimeHostError) return error;
  const code = typeof error === "string" ? error : "";
  return new RuntimeHostError(/capacity/.test(code) ? "capacity" :
    /revoked|generation_changed|owner_unknown|owner_mismatch|closed/.test(code) ? "revoked" :
    /not_admitted/.test(code) ? "not_admitted" : "unavailable");
}
function identity(lease: RunScopeLease): RuntimeHostIdentity {
  const scope = lease.scope;
  return parseRuntimeHostIdentity({ scopeId: scope.id, runId: scope.runId, projectId: scope.projectId,
    rootRef: scope.rootRef, conversationId: scope.conversationId, providerId: scope.providerId, modelId: scope.modelId });
}
function current(lease: RunScopeLease, captured: string): boolean {
  try { return lease.isCurrent() && JSON.stringify(identity(lease)) === captured; } catch { return false; }
}
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new RuntimeHostError("cancelled"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    const abort = () => { clearTimeout(timer); signal?.removeEventListener("abort", abort); reject(new RuntimeHostError("cancelled")); };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
/** One adapter per renderer module; the one managed native service arbitrates ALL windows.
 * There is deliberately no exported constructor/factory for a component-local queue.
 * No RunResourceQueue instance, fallback local scheduler or force-release endpoint is created.
 */
function createSharedAdapter(invoke: NativeInvoke | null): SharedRuntimeHostQueue {
  const connections = new WeakMap<RunScopeLease, Promise<SharedRuntimeHostOwner>>();
  const liveOwners = new Set<{ pulse(): Promise<void>; disconnect(): Promise<RuntimeHostOwnerSnapshot> }>();
  let disposed = false, timer: ReturnType<typeof setTimeout> | null = null;
  async function call(command: string, input: unknown): Promise<unknown> {
    if (!invoke) throw new RuntimeHostError("unavailable");
    // Lost IPC is unknown. A late native reservation remains tracked until native expiry.
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([invoke(command, { input }), new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new RuntimeHostError("unavailable")), 3000);
      })]);
    } catch (error) { throw safeFailure(error); }
    finally { if (timeout !== undefined) clearTimeout(timeout); }
  }
  function arm() {
    if (disposed || timer !== null || liveOwners.size === 0) return;
    timer = setTimeout(() => {
      timer = null;
      void Promise.allSettled([...liveOwners].map(owner => owner.pulse())).finally(arm);
    }, 5000);
  }
  async function connectNew(lease: RunScopeLease): Promise<SharedRuntimeHostOwner> {
    if (disposed || !invoke) throw new RuntimeHostError("unavailable");
    if (!lease.isCurrent()) throw new RuntimeHostError("revoked");
    const ownerIdentity = identity(lease), captured = JSON.stringify(ownerIdentity);
    const initial = parseRuntimeHostSnapshot(await call("connect_runtime_host_owner", ownerIdentity));
    if (JSON.stringify(initial.identity) !== captured || !initial.connected) throw new RuntimeHostError("invalid");
    const nativeRef = initial.owner;
    let connected = true, pulseRunning = false;
    const isCurrent = () => !disposed && connected && current(lease, captured);
    async function snapshot(command: string): Promise<RuntimeHostOwnerSnapshot> {
      const result = parseRuntimeHostSnapshot(await call(command, nativeRef), nativeRef);
      if (JSON.stringify(result.identity) !== captured) throw new RuntimeHostError("invalid");
      if (!result.connected) { connected = false; liveOwners.delete(lifecycle); }
      return result;
    }
    async function disconnect(): Promise<RuntimeHostOwnerSnapshot> {
      connected = false;
      liveOwners.delete(lifecycle);
      // Still attempt native revocation after a local lease change or disconnected transport.
      return snapshot("disconnect_runtime_host_owner");
    }
    const lifecycle = {
      disconnect,
      async pulse() {
        if (pulseRunning) return;
        pulseRunning = true;
        try {
          if (!isCurrent()) { await disconnect(); return; }
          await snapshot("heartbeat_runtime_host_owner");
          if (!current(lease, captured)) await disconnect();
        } catch {
          // Do not renew/reconnect automatically. Native watchdog expires the old owner.
          connected = false;
          liveOwners.delete(lifecycle);
        } finally { pulseRunning = false; }
      },
    };
    const owner: SharedRuntimeHostOwner = Object.freeze({
      identity: ownerIdentity, nativeRef, isCurrent, disconnect,
      getSnapshot: () => snapshot("get_runtime_host_status"),
      async reserveModel(raw: RuntimeHostModelJobInput): Promise<SharedRuntimeHostTicket> {
        if (!isCurrent()) throw new RuntimeHostError("revoked");
        const input = validateRuntimeHostModelInput(raw);
        const admitted = parseRuntimeHostJob(await call("enqueue_runtime_host_model_job", { ...input, owner: nativeRef }), nativeRef);
        if (admitted.jobId !== input.jobId || admitted.stepId !== input.stepId || admitted.kind !== "model") throw new RuntimeHostError("invalid");
        const ticket = admitted.ticket;
        const cancel = async () => parseRuntimeHostJob(await call("cancel_runtime_host_job", ticket), nativeRef);
        async function getSnapshot(): Promise<RuntimeHostJobSnapshot> {
          const result = await snapshot("get_runtime_host_status");
          const job = result.jobs.find(job => job.ticket.ticketId === ticket.ticketId);
          // A missing/expired/pruned row cannot be presented as stopped or completed.
          if (!job) throw new RuntimeHostError("unavailable");
          if (job.jobId !== input.jobId || job.executionId !== admitted.executionId || job.stepId !== input.stepId) throw new RuntimeHostError("invalid");
          return job;
        }
        if (!isCurrent()) { await cancel(); throw new RuntimeHostError("revoked"); }
        return Object.freeze({ nativeRef: ticket, getSnapshot, cancel,
          async waitForAdmission(signal?: AbortSignal) {
            const until = performance.now() + input.queueTimeoutMs;
            for (;;) {
              if (signal?.aborted) { await cancel(); throw new RuntimeHostError("cancelled"); }
              if (!isCurrent()) { await cancel(); throw new RuntimeHostError("revoked"); }
              const job = await getSnapshot();
              if (job.phase === "admitted") return job;
              if (job.phase !== "queued") throw new RuntimeHostError("not_admitted");
              if (performance.now() >= until) { await cancel(); throw new RuntimeHostError("timed_out"); }
              try { await delay(Math.min(250, Math.max(1, until - performance.now())), signal); }
              catch { await cancel(); throw new RuntimeHostError("cancelled"); }
            }
          },
        });
      },
    });
    if (!current(lease, captured) || disposed) { await disconnect(); throw new RuntimeHostError("revoked"); }
    liveOwners.add(lifecycle);
    arm();
    return owner;
  }
  return Object.freeze({
    available: () => invoke !== null && !disposed,
    connect(lease: RunScopeLease) {
      const existing = connections.get(lease);
      if (existing) return existing;
      const pending = connectNew(lease);
      connections.set(lease, pending);
      // Failed/lost registration is not retried under the same old lease automatically.
      return pending;
    },
    async dispose() {
      disposed = true;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      const owners = [...liveOwners];
      liveOwners.clear();
      await Promise.allSettled(owners.map(owner => owner.disconnect()));
    },
  });
}
let shared: SharedRuntimeHostQueue | undefined;
/** Resolve once at application bootstrap; pass this same object to every coordinator. */
export function getSharedRuntimeHostQueue(): SharedRuntimeHostQueue {
  shared ??= createSharedAdapter(localNativeInvoke());
  return shared;
}
