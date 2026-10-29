import type { RunScopeLease } from "../run-coordinator.js";

export type ResourceKind = "ue-editor" | "ubt" | "file-write";
/** Trusted, canonical identity supplied by the host, never a raw-path authorization. */
export interface ResourceClaim {
  kind: ResourceKind;
  key: string;
}
export interface QueueOwner {
  scopeId: string;
  runId: string;
  projectId: string;
  rootRef: string;
  conversationId: string;
  providerId: string;
  modelId: string;
}
export type ExecutionObservation = "quiescent" | "active" | "unknown";
export type QueueStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "timed_out"
  | "revoked"
  | "reconciling";
export interface QueueResult {
  id: string;
  owner: Readonly<QueueOwner>;
  status: QueueStatus;
  resources: "released" | "retained";
}
export interface QueueJobSnapshot {
  id: string;
  owner: Readonly<QueueOwner>;
  kind: "model" | "operation";
  phase: "queued" | "running" | "retained" | "finished";
  status: QueueStatus | null;
  resources: readonly Readonly<ResourceClaim>[];
  holdsResources: boolean;
  callbackSettled: boolean;
}
export interface QueueClock {
  /** Monotonic elapsed time. It need not share the lease's wall-clock domain. */
  now(): number;
  schedule(callback: () => void, delayMs: number): () => void;
}
export interface ResourceQueueOptions {
  modelConcurrency?: number;
  maxOutstanding?: number;
  leaseCheckIntervalMs?: number;
  observationTimeoutMs?: number;
  clock?: QueueClock;
}
export interface QueueExecutionContext {
  owner: Readonly<QueueOwner>;
  signal: AbortSignal;
  isCurrent(): boolean;
  /** An identity/freshness guard, never permission to launch or mutate anything. */
  assertCurrent(): void;
}
export interface QueueJob {
  id: string;
  kind: "model" | "operation";
  lease: RunScopeLease;
  resources?: readonly ResourceClaim[];
  signal?: AbortSignal;
  queueTimeoutMs: number;
  executionTimeoutMs: number;
  execution:
    | { mode: "in-process" }
    | {
        mode: "external";
        /** Host-owned observer bound to this exact native execution owner, not a PID.
         * Quiescent means no owned conflicting operation/process tree can continue.
         * It must never terminate a process or grant access as a side effect. */
        observe(signal: AbortSignal): ExecutionObservation | Promise<ExecutionObservation>;
      };
  execute(context: QueueExecutionContext): void | Promise<void>;
}
export interface QueueTicket {
  /** First bounded decision; retained resources can outlive this immutable notice. */
  result: Promise<QueueResult>;
  cancel(): boolean;
  getSnapshot(): QueueJobSnapshot;
  /** Bounded cleanup observation; cannot release an unsettled local callback. */
  reconcile(): Promise<QueueJobSnapshot>;
}
export class ResourceQueueError extends Error {
  constructor(readonly code: "invalid_job" | "queue_closed" | "capacity" | "owner_revoked") {
    super(code);
    this.name = "ResourceQueueError";
  }
}
type StopStatus = "cancelled" | "timed_out" | "revoked";
interface Entry {
  id: string;
  kind: QueueJob["kind"];
  owner: Readonly<QueueOwner>;
  identity: string;
  lease: RunScopeLease;
  current: () => boolean;
  resources: readonly Readonly<ResourceClaim>[];
  execute: QueueJob["execute"];
  observe?: (signal: AbortSignal) => ExecutionObservation | Promise<ExecutionObservation>;
  controller: AbortController;
  detach?: () => void;
  queuedDeadline: number;
  runtimeMs: number;
  runningDeadline?: number;
  phase: QueueJobSnapshot["phase"];
  reserved: boolean;
  dispatched: boolean;
  callbackSettled: boolean;
  failed: boolean;
  stop?: StopStatus;
  status: QueueStatus | null;
  noticed: boolean;
  resolve: (result: QueueResult) => void;
  observing?: Promise<QueueJobSnapshot>;
}
const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.trim() === value &&
  value.length <= 512 &&
  [...value].every((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127);
const duration = (value: unknown, max = 3_600_000): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= max;
function identity(lease: RunScopeLease) {
  const scope = lease.scope;
  return JSON.stringify([
    scope.id,
    scope.runId,
    scope.projectId,
    scope.rootRef,
    scope.conversationId,
    scope.providerId,
    scope.modelId,
    scope.expiresAt,
    scope.mode,
  ]);
}
/** Single-process queue shared by cooperating coordinators. No OS lock/permission authority. */
export class RunResourceQueue {
  private readonly jobs = new Map<string, Entry>();
  private readonly now: () => number;
  private readonly schedule: QueueClock["schedule"];
  private readonly concurrency: number;
  private readonly maximum: number;
  private readonly checkInterval: number;
  private readonly observationTimeout: number;
  private pumping = false;
  private repump = false;
  private closed = false;
  private cancelMonitor: (() => void) | undefined;
  private monitorAt = Infinity;
  constructor(options: ResourceQueueOptions = {}) {
    const clock = options.clock ?? {
      now: () => performance.now(),
      schedule: (callback: () => void, ms: number) => {
        const timer = setTimeout(callback, ms);
        return () => clearTimeout(timer);
      },
    };
    this.concurrency = options.modelConcurrency ?? 3;
    this.maximum = options.maxOutstanding ?? 128;
    this.checkInterval = options.leaseCheckIntervalMs ?? 100;
    this.observationTimeout = options.observationTimeoutMs ?? 1000;
    if (
      !duration(this.concurrency, 3) ||
      !duration(this.maximum, 1024) ||
      !duration(this.checkInterval, 1000) ||
      !duration(this.observationTimeout, 5000) ||
      typeof clock.now !== "function" ||
      typeof clock.schedule !== "function"
    )
      throw new ResourceQueueError("invalid_job");
    this.now = clock.now.bind(clock);
    this.schedule = clock.schedule.bind(clock);
  }
  enqueue(input: QueueJob): QueueTicket {
    if (this.closed) throw new ResourceQueueError("queue_closed");
    let entry: Entry, signal: AbortSignal | undefined, result: Promise<QueueResult>;
    try {
      const id = input.id,
        kind = input.kind,
        lease = input.lease,
        scope = lease.scope,
        current = lease.isCurrent.bind(lease),
        execute = input.execute,
        execution = input.execution,
        mode = execution.mode,
        rawObserve = mode === "external" ? execution.observe : undefined;
      const resources = Object.freeze(
        (input.resources ?? []).map((r) => {
          const kind = r.kind,
            key = r.key;
          if (!["ue-editor", "ubt", "file-write"].includes(kind) || !validId(key))
            throw new ResourceQueueError("invalid_job");
          return Object.freeze({ kind, key });
        }),
      );
      const owner = Object.freeze({
        scopeId: scope.id,
        runId: scope.runId,
        projectId: scope.projectId,
        rootRef: scope.rootRef,
        conversationId: scope.conversationId,
        providerId: scope.providerId,
        modelId: scope.modelId,
      });
      const queueMs = input.queueTimeoutMs,
        runtimeMs = input.executionTimeoutMs,
        expiresAt = scope.expiresAt,
        scopeMode = scope.mode,
        maxDurationMs = scope.limits.maxDurationMs;
      signal = input.signal;
      if (
        !validId(id) ||
        !["model", "operation"].includes(kind) ||
        this.jobs.has(id) ||
        Object.values(owner).some((v) => !validId(v)) ||
        scopeMode !== "read_only" ||
        !Number.isFinite(expiresAt) ||
        !duration(queueMs) ||
        !duration(runtimeMs) ||
        !duration(maxDurationMs) ||
        typeof execute !== "function" ||
        !["in-process", "external"].includes(mode) ||
        (mode === "external" && typeof rawObserve !== "function") ||
        resources.length > 32 ||
        new Set(resources.map((r) => r.key)).size !== resources.length ||
        (kind === "operation" && !resources.length) ||
        (resources.some((r) => r.kind === "ue-editor" || r.kind === "ubt") && mode !== "external")
      )
        throw new ResourceQueueError("invalid_job");
      let resolve!: (result: QueueResult) => void;
      result = new Promise<QueueResult>((done) => {
        resolve = done;
      });
      entry = {
        id,
        kind,
        lease,
        current,
        owner,
        identity: JSON.stringify([
          owner.scopeId,
          owner.runId,
          owner.projectId,
          owner.rootRef,
          owner.conversationId,
          owner.providerId,
          owner.modelId,
          expiresAt,
          scopeMode,
        ]),
        resources,
        execute,
        ...(rawObserve ? { observe: rawObserve.bind(execution) } : {}),
        controller: new AbortController(),
        queuedDeadline: this.now() + queueMs,
        runtimeMs: Math.min(runtimeMs, maxDurationMs),
        phase: "queued",
        reserved: false,
        dispatched: false,
        callbackSettled: false,
        failed: false,
        status: null,
        noticed: false,
        resolve,
      };
    } catch {
      throw new ResourceQueueError("invalid_job");
    }
    // Recheck after accessor-bearing input has been captured.
    if (this.closed) throw new ResourceQueueError("queue_closed");
    if (this.jobs.size >= this.maximum) throw new ResourceQueueError("capacity");
    if (this.jobs.has(entry.id)) throw new ResourceQueueError("invalid_job");
    this.jobs.set(entry.id, entry);
    const ticket: QueueTicket = Object.freeze({
      result,
      cancel: () => this.stop(entry, "cancelled"),
      getSnapshot: () => this.snapshot(entry),
      reconcile: () =>
        entry.callbackSettled && entry.reserved
          ? this.observe(entry)
          : Promise.resolve(this.snapshot(entry)),
    });
    try {
      const abort = () => this.stop(entry, "cancelled");
      entry.detach = () => signal?.removeEventListener("abort", abort);
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) this.stop(entry, "cancelled");
    } catch {
      this.stop(entry, "cancelled");
      throw new ResourceQueueError("invalid_job");
    }
    this.pump();
    return ticket;
  }
  /** Call immediately on host owner changes; an active timer also checks bounded intervals. */
  refresh(): void {
    this.pump();
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const entry of [...this.jobs.values()]) this.stop(entry, "cancelled");
    this.arm();
  }
  getSnapshot() {
    return {
      closed: this.closed,
      modelLimit: this.concurrency,
      modelSlotsInUse: this.models(),
      jobs: [...this.jobs.values()].map((entry) => this.snapshot(entry)),
    };
  }
  private snapshot(entry: Entry): QueueJobSnapshot {
    return {
      id: entry.id,
      owner: { ...entry.owner },
      kind: entry.kind,
      phase: entry.phase,
      status: entry.status,
      resources: entry.resources.map((r) => ({ ...r })),
      holdsResources: entry.reserved,
      callbackSettled: entry.callbackSettled,
    };
  }
  private current(entry: Entry): boolean {
    try {
      const usable = () =>
        entry.phase !== "finished" &&
        !this.closed &&
        !entry.stop &&
        !entry.controller.signal.aborted;
      return (
        usable() &&
        entry.current() === true &&
        identity(entry.lease) === entry.identity &&
        entry.current() === true &&
        usable()
      );
    } catch {
      return false;
    }
  }
  private models() {
    return [...this.jobs.values()].filter((e) => e.reserved && e.kind === "model").length;
  }
  private conflicts(a: Entry, b: Entry): boolean {
    return Boolean(
      a.resources.length &&
      b.resources.length &&
      (a.owner.projectId === b.owner.projectId ||
        a.owner.rootRef === b.owner.rootRef ||
        a.resources.some((x) => b.resources.some((y) => x.key === y.key))),
    );
  }
  private notice(entry: Entry, status: QueueStatus) {
    entry.status = status;
    if (entry.noticed) return;
    entry.noticed = true;
    entry.resolve(
      Object.freeze({
        id: entry.id,
        owner: entry.owner,
        status,
        resources: entry.reserved ? "retained" : "released",
      }),
    );
  }
  private stop(entry: Entry, status: StopStatus): boolean {
    if (entry.phase === "finished" || entry.stop) return false;
    entry.stop = status;
    try {
      entry.controller.abort();
    } catch {
      /* Cleanup cannot replace a bounded queue decision. */
    }
    if (!entry.dispatched) this.release(entry, status);
    else {
      entry.phase = "retained";
      this.notice(entry, status);
      if (entry.callbackSettled) void this.observe(entry);
    }
    this.pump();
    return true;
  }
  private release(entry: Entry, status: QueueStatus) {
    if (entry.phase === "finished") return;
    entry.reserved = false;
    entry.phase = "finished";
    try {
      entry.detach?.();
    } catch {
      /* A host signal cannot prevent state/resource release. */
    }
    if (this.jobs.get(entry.id) === entry) this.jobs.delete(entry.id);
    this.notice(entry, status);
    this.pump();
  }
  private pump() {
    if (this.pumping) {
      this.repump = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.repump = false;
        for (const entry of [...this.jobs.values()]) {
          if (entry.stop) continue;
          if (this.closed) this.stop(entry, "cancelled");
          else if (!this.current(entry)) this.stop(entry, "revoked");
          else if (
            this.now() >= (entry.phase === "queued" ? entry.queuedDeadline : entry.runningDeadline!)
          )
            this.stop(entry, "timed_out");
        }
        const blocked: Entry[] = [];
        for (const entry of [...this.jobs.values()]) {
          if (entry.phase !== "queued") continue;
          if (this.closed) {
            this.stop(entry, "cancelled");
            continue;
          }
          const unavailable =
            (entry.kind === "model" && this.models() >= this.concurrency) ||
            [...this.jobs.values()].some(
              (other) => other.reserved && this.conflicts(entry, other),
            ) ||
            blocked.some((other) => this.conflicts(entry, other));
          if (unavailable) {
            blocked.push(entry);
            continue;
          }
          this.start(entry);
        }
      } while (this.repump);
    } finally {
      this.pumping = false;
      this.arm();
    }
  }
  private start(entry: Entry) {
    const admittedAt = this.now();
    if (admittedAt >= entry.queuedDeadline) {
      this.stop(entry, "timed_out");
      return;
    }
    entry.phase = "running";
    entry.reserved = true;
    entry.runningDeadline = admittedAt + entry.runtimeMs;
    // Reserve every claim atomically before the last synchronous ownership check.
    if (!this.current(entry) || entry.phase !== "running") {
      this.stop(entry, "revoked");
      return;
    }
    if (this.now() >= entry.runningDeadline!) {
      this.stop(entry, "timed_out");
      return;
    }
    const executionCurrent = () => {
      if (entry.callbackSettled || !this.current(entry)) return false;
      if (this.now() >= entry.runningDeadline!) {
        this.stop(entry, "timed_out");
        return false;
      }
      return !entry.stop && entry.phase !== "finished";
    };
    const context: QueueExecutionContext = Object.freeze({
      owner: entry.owner,
      signal: entry.controller.signal,
      isCurrent: executionCurrent,
      assertCurrent: () => {
        if (!executionCurrent()) {
          this.stop(entry, "revoked");
          throw new ResourceQueueError("owner_revoked");
        }
      },
    });
    entry.dispatched = true;
    const settled = (failed: boolean) => {
      if (entry.callbackSettled) return;
      entry.callbackSettled = true;
      entry.failed = failed;
      if (entry.observe) void this.observe(entry);
      else this.release(entry, entry.stop ?? (failed ? "failed" : "completed"));
    };
    try {
      Promise.resolve(entry.execute.call(undefined, context)).then(
        () => settled(false),
        () => settled(true),
      );
    } catch {
      settled(true);
    }
  }
  private observe(entry: Entry): Promise<QueueJobSnapshot> {
    if (!entry.reserved || !entry.callbackSettled) return Promise.resolve(this.snapshot(entry));
    if (entry.observing) return entry.observing;
    if (!entry.observe) {
      this.release(entry, entry.stop ?? (entry.failed ? "failed" : "completed"));
      return Promise.resolve(this.snapshot(entry));
    }
    let resolve!: (snapshot: QueueJobSnapshot) => void,
      done = false;
    const pending = new Promise<QueueJobSnapshot>((complete) => {
      resolve = complete;
    });
    entry.observing = pending;
    const controller = new AbortController();
    const finish = (observation: ExecutionObservation) => {
      if (done) return;
      done = true;
      try {
        cancelTimer?.();
      } catch {
        /* Timer cleanup cannot affect lock ownership. */
      }
      try {
        controller.abort();
      } catch {
        /* No release is inferred from abort. */
      }
      entry.observing = undefined;
      if (observation === "quiescent")
        this.release(entry, entry.stop ?? (entry.failed ? "failed" : "completed"));
      else {
        entry.phase = "retained";
        this.notice(entry, entry.stop ?? "reconciling");
        this.arm();
      }
      resolve(this.snapshot(entry));
    };
    const cancelTimer = this.schedule(() => finish("unknown"), this.observationTimeout);
    try {
      Promise.resolve(entry.observe(controller.signal)).then(
        (value) => finish(value === "quiescent" || value === "active" ? value : "unknown"),
        () => finish("unknown"),
      );
    } catch {
      finish("unknown");
    }
    return pending;
  }
  private arm() {
    const pending = [...this.jobs.values()].filter((e) => !e.stop);
    if (!pending.length) {
      try {
        this.cancelMonitor?.();
      } catch {
        /* Clock port is host-owned. */
      }
      this.cancelMonitor = undefined;
      this.monitorAt = Infinity;
      return;
    }
    const now = this.now(),
      at = Math.min(
        now + this.checkInterval,
        ...pending.map((e) => (e.phase === "queued" ? e.queuedDeadline : e.runningDeadline!)),
      );
    if (this.cancelMonitor && this.monitorAt <= at) return;
    this.cancelMonitor?.();
    this.monitorAt = at;
    this.cancelMonitor = this.schedule(
      () => {
        this.cancelMonitor = undefined;
        this.monitorAt = Infinity;
        this.pump();
      },
      Math.max(0, at - now),
    );
  }
}
