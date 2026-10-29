import { describe, expect, it, vi } from "vitest";
import type { TaskRunScope } from "@uagent/shared";
import { RunScopeAuthority } from "../run-scope.js";
import {
  RunResourceQueue,
  type ExecutionObservation,
  type QueueClock,
  type QueueExecutionContext,
  type QueueJob,
  type QueueOwner,
  type ResourceClaim,
} from "./resource-queue.js";

class ManualClock implements QueueClock {
  time = 0;
  next = 0;
  timers = new Map<number, { at: number; callback: () => void }>();
  now = () => this.time;
  schedule = (callback: () => void, ms: number) => {
    const id = ++this.next;
    this.timers.set(id, { at: this.time + ms, callback });
    return () => {
      this.timers.delete(id);
    };
  };
  advance(ms: number) {
    const until = this.time + ms;
    let steps = 0;
    while (true) {
      const next = [...this.timers]
        .filter(([, t]) => t.at <= until)
        .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      if (++steps > 10000) throw Error("timer did not make progress");
      this.time = next[1].at;
      this.timers.delete(next[0]);
      next[1].callback();
    }
    this.time = until;
  }
}
function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error?: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function harness(options: { modelConcurrency?: number; maxOutstanding?: number } = {}) {
  const clock = new ManualClock(),
    queue = new RunResourceQueue({
      clock,
      leaseCheckIntervalMs: 10,
      observationTimeoutMs: 5,
      ...options,
    });
  let next = 0;
  const approval = (projectId = "A", rootRef = "root_" + projectId, expiresAt = 1000) => {
    const id = String(++next),
      authority = new RunScopeAuthority(clock.now);
    const scope: TaskRunScope = {
      id: "scope_" + id,
      runId: "run_" + id,
      projectId,
      rootRef,
      conversationId: "conversation_" + id,
      providerId: "synthetic",
      modelId: "model",
      endpoint: "https://synthetic.invalid/v1",
      mode: "read_only",
      readPrefixes: ["Source"],
      sharePrefixes: [],
      toolIds: ["read_file"],
      expiresAt,
      limits: {
        maxToolCalls: 3,
        maxModelRequests: 4,
        maxDurationMs: 10000,
        maxAttemptsPerFailure: 2,
        maxToolResultBytes: 8192,
        maxContextBytes: 24576,
      },
    };
    authority.approve(scope, () => true);
    return { lease: authority.claim(scope.id)!, authority, scope };
  };
  const job = (patch: Partial<QueueJob> = {}) => {
    const lease = patch.lease ?? approval().lease;
    return queue.enqueue({
      id: "job_" + ++next,
      kind: "model",
      lease,
      queueTimeoutMs: 200,
      executionTimeoutMs: 100,
      execution: { mode: "in-process" },
      execute: () => undefined,
      ...patch,
    });
  };
  const operation = (key: string, project = "A", patch: Partial<QueueJob> = {}) =>
    job({
      kind: "operation",
      lease: approval(project).lease,
      resources: [{ kind: "file-write", key }],
      ...patch,
    });
  return { clock, queue, approval, job, operation };
}

describe("single-process shared run resource queue", () => {
  it("limits model dispatch to three shared slots and starts queued work as settled callbacks release slots", async () => {
    const h = harness(),
      waits = Array.from({ length: 5 }, () => deferred()),
      started: number[] = [];
    let active = 0,
      maximum = 0;
    const tickets = waits.map((wait, i) =>
      h.job({
        execute: () => {
          started.push(i);
          active++;
          maximum = Math.max(maximum, active);
          return wait.promise.finally(() => {
            active--;
          });
        },
      }),
    );
    expect(started).toEqual([0, 1, 2]);
    expect(h.queue.getSnapshot().modelSlotsInUse).toBe(3);
    waits[0]!.resolve();
    await flush();
    expect(started).toEqual([0, 1, 2, 3]);
    waits[1]!.resolve();
    await flush();
    expect(started).toEqual([0, 1, 2, 3, 4]);
    for (const wait of waits) wait.resolve();
    await flush();
    expect(
      (await Promise.all(tickets.map((t) => t.result))).every((r) => r.status === "completed"),
    ).toBe(true);
    expect(maximum).toBe(3);
    expect(h.queue.getSnapshot().jobs).toHaveLength(0);
    expect(h.clock.timers.size).toBe(0);
  });
  it("serializes Editor, UBT and file writes within a project while unrelated projects progress", async () => {
    const h = harness(),
      editor = deferred(),
      build = deferred(),
      write = deferred(),
      started: string[] = [];
    const one = h.operation("editor-instance", "A", {
      resources: [{ kind: "ue-editor", key: "editor-instance" }],
      execution: { mode: "external", observe: () => "quiescent" },
      execute: () => {
        started.push("editor");
        return editor.promise;
      },
    });
    const two = h.operation("engine-build", "A", {
      resources: [{ kind: "ubt", key: "engine-build" }],
      execution: { mode: "external", observe: () => "quiescent" },
      execute: () => {
        started.push("build");
        return build.promise;
      },
    });
    const three = h.operation("file-object", "A", {
      execute: () => {
        started.push("write");
        return write.promise;
      },
    });
    const other = h.operation("other-file", "B", {
      execute: () => {
        started.push("other");
      },
    });
    expect(started).toEqual(["editor", "other"]);
    await flush();
    expect((await other.result).status).toBe("completed");
    editor.resolve();
    await flush();
    expect(started).toEqual(["editor", "other", "build"]);
    build.resolve();
    await flush();
    expect(started).toEqual(["editor", "other", "build", "write"]);
    write.resolve();
    await flush();
    expect(
      (await Promise.all([one.result, two.result, three.result])).map((r) => r.status),
    ).toEqual(["completed", "completed", "completed"]);
  });
  it("uses root identity and shared resource keys across project IDs", async () => {
    const h = harness(),
      hold = deferred(),
      started: string[] = [];
    const a = h.operation("shared", "A", {
      lease: h.approval("A", "same-root").lease,
      execute: () => hold.promise,
    });
    const rootAlias = h.operation("different", "B", {
      lease: h.approval("B", "same-root").lease,
      execute: () => {
        started.push("root-alias");
      },
    });
    const shared = h.operation("shared", "C", {
      execute: () => {
        started.push("shared");
      },
    });
    const independent = h.operation("other", "D", {
      execute: () => {
        started.push("independent");
      },
    });
    expect(started).toEqual(["independent"]);
    await flush();
    hold.resolve();
    await flush();
    expect(started).toEqual(["independent", "root-alias", "shared"]);
    await Promise.all([a.result, rootAlias.result, shared.result, independent.result]);
  });
  it("reserves all claims atomically and gives an older conflicting waiter priority without blocking unrelated work", async () => {
    const h = harness(),
      x = deferred(),
      xy = deferred(),
      started: string[] = [];
    const first = h.operation("X", "A", { execute: () => x.promise });
    const multi = h.operation("X", "B", {
      resources: [
        { kind: "file-write", key: "X" },
        { kind: "file-write", key: "Y" },
      ],
      execute: () => {
        started.push("XY");
        return xy.promise;
      },
    });
    const later = h.operation("Y", "C", {
      execute: () => {
        started.push("Y");
      },
    });
    const other = h.operation("Z", "D", {
      execute: () => {
        started.push("Z");
      },
    });
    expect(started).toEqual(["Z"]);
    x.resolve();
    await flush();
    expect(started).toEqual(["Z", "XY"]);
    xy.resolve();
    await flush();
    expect(started).toEqual(["Z", "XY", "Y"]);
    await Promise.all([first.result, multi.result, later.result, other.result]);
  });
  it("cancels a queued waiter once without releasing another owner's active slot", async () => {
    const h = harness({ modelConcurrency: 1 }),
      hold = deferred(),
      second = vi.fn();
    const active = h.job({ execute: () => hold.promise }),
      waiter = h.job({ execute: second });
    expect(waiter.getSnapshot().phase).toBe("queued");
    expect(waiter.cancel()).toBe(true);
    expect(waiter.cancel()).toBe(false);
    expect(await waiter.result).toMatchObject({ status: "cancelled", resources: "released" });
    expect(h.queue.getSnapshot().modelSlotsInUse).toBe(1);
    expect(second).not.toHaveBeenCalled();
    hold.resolve();
    await flush();
    await active.result;
    expect(h.clock.timers.size).toBe(0);
  });
  it("does not release an executing local callback on cancellation until its promise actually settles", async () => {
    const h = harness(),
      hold = deferred(),
      started = vi.fn();
    let context: QueueExecutionContext | undefined;
    const active = h.operation("file", "A", {
      execute: (ctx) => {
        context = ctx;
        return hold.promise;
      },
    });
    const waiter = h.operation("next", "A", { execute: started });
    expect(active.cancel()).toBe(true);
    expect(context!.signal.aborted).toBe(true);
    expect(context!.isCurrent()).toBe(false);
    expect(await active.result).toMatchObject({ status: "cancelled", resources: "retained" });
    expect((await active.reconcile()).holdsResources).toBe(true);
    expect(started).not.toHaveBeenCalled();
    hold.resolve();
    await flush();
    expect(started).toHaveBeenCalledOnce();
    await waiter.result;
    expect(active.getSnapshot()).toMatchObject({
      phase: "finished",
      status: "cancelled",
      holdsResources: false,
    });
  });
  it.each(["sync", "async"] as const)(
    "handles %s execution errors without leaking callback messages or blocking the next job",
    async (kind) => {
      const h = harness(),
        next = vi.fn();
      const failed = h.operation("file", "A", {
        execute: () => {
          if (kind === "sync") throw Error("private callback detail");
          return Promise.reject(Error("private callback detail"));
        },
      });
      const waiter = h.operation("file", "A", { execute: next });
      await flush();
      const outcome = await failed.result;
      expect(outcome).toMatchObject({ status: "failed", resources: "released" });
      expect(JSON.stringify(outcome)).not.toContain("private callback detail");
      expect(next).toHaveBeenCalledOnce();
      await waiter.result;
    },
  );
  it("retains unknown external execution after callback success and releases only after a fresh confirmed quiescent observation", async () => {
    const h = harness(),
      started = vi.fn();
    let state: ExecutionObservation = "unknown";
    const observe = vi.fn(() => state),
      active = h.operation("editor", "A", {
        resources: [{ kind: "ue-editor", key: "editor" }],
        execution: { mode: "external", observe },
      });
    const waiter = h.operation("other", "A", { execute: started });
    await flush();
    const notice = await active.result;
    expect(notice).toMatchObject({ status: "reconciling", resources: "retained" });
    expect(started).not.toHaveBeenCalled();
    expect(active.getSnapshot().holdsResources).toBe(true);
    state = "quiescent";
    expect((await active.reconcile()).holdsResources).toBe(false);
    await flush();
    expect(started).toHaveBeenCalledOnce();
    await waiter.result;
    const count = observe.mock.calls.length;
    await active.reconcile();
    expect(active.cancel()).toBe(false);
    expect(observe).toHaveBeenCalledTimes(count);
    expect(notice.status).toBe("reconciling");
    expect(active.getSnapshot().status).toBe("completed");
  });
  it("does not infer stopped external work from failure, cancellation, timeout or lease revocation", async () => {
    for (const reason of ["failed", "cancelled", "timed_out", "revoked"] as const) {
      const h = harness(),
        hold = deferred(),
        approval = h.approval(),
        next = vi.fn();
      let state: ExecutionObservation = "active";
      const active = h.operation("build", "A", {
        lease: approval.lease,
        execution: { mode: "external", observe: () => state },
        execute: () => hold.promise,
        executionTimeoutMs: 20,
      });
      const waiter = h.operation("same-project", "A", { execute: next, queueTimeoutMs: 80 });
      if (reason === "failed") hold.reject(Error("synthetic process failure"));
      else if (reason === "cancelled") active.cancel();
      else if (reason === "timed_out") h.clock.advance(20);
      else {
        approval.authority.invalidate();
        h.queue.refresh();
      }
      await flush();
      expect((await active.result).resources).toBe("retained");
      expect(next).not.toHaveBeenCalled();
      state = "quiescent";
      if (reason !== "failed") {
        await active.reconcile();
        expect(next).not.toHaveBeenCalled(); // A still-running local continuation cannot be discarded.
        hold.resolve();
        await flush();
      } else await active.reconcile();
      await flush();
      expect(next).toHaveBeenCalledOnce();
      await waiter.result;
      expect(active.getSnapshot().status).toBe(reason === "failed" ? "failed" : reason);
    }
  });
  it("bounds hung observation and queued waiting, ignores a late stale observation, and permits a new explicit reconciliation", async () => {
    const h = harness(),
      late = deferred<ExecutionObservation>(),
      next = vi.fn();
    let calls = 0,
      observationSignal: AbortSignal | undefined;
    const active = h.operation("external", "A", {
      execution: {
        mode: "external",
        observe: (signal) => {
          observationSignal = signal;
          return ++calls === 1 ? late.promise : "quiescent";
        },
      },
    });
    const waiter = h.operation("file", "A", { execute: next, queueTimeoutMs: 25 });
    await flush();
    h.clock.advance(5);
    await flush();
    expect(await active.result).toMatchObject({ status: "reconciling", resources: "retained" });
    expect(observationSignal!.aborted).toBe(true);
    late.resolve("quiescent");
    await flush();
    expect(active.getSnapshot().holdsResources).toBe(true);
    h.clock.advance(20);
    expect(await waiter.result).toMatchObject({ status: "timed_out", resources: "released" });
    expect(next).not.toHaveBeenCalled();
    expect(h.clock.timers.size).toBeGreaterThan(0);
    await active.reconcile();
    expect(active.getSnapshot().holdsResources).toBe(false);
    expect(h.clock.timers.size).toBe(0);
  });
  it("shares a bounded observation between duplicate reconciliation callers and treats observer errors as unknown", async () => {
    const h = harness(),
      proof = deferred<ExecutionObservation>();
    let calls = 0;
    const active = h.operation("file", "A", {
      execution: {
        mode: "external",
        observe: () => {
          if (++calls === 1) throw Error("private observer detail");
          return proof.promise;
        },
      },
    });
    await flush();
    expect((await active.result).status).toBe("reconciling");
    const one = active.reconcile(),
      two = active.reconcile();
    expect(one).toBe(two);
    expect(calls).toBe(2);
    proof.resolve("quiescent");
    await Promise.all([one, two]);
    expect(active.getSnapshot().holdsResources).toBe(false);
    await active.reconcile();
    expect(calls).toBe(2);
  });
  it("revokes live/expired ownership through the existing authority while preserving a running model slot", async () => {
    const h = harness({ modelConcurrency: 1 }),
      hold = deferred(),
      approval = h.approval("A", "root_A", 25);
    let context: QueueExecutionContext | undefined;
    const active = h.job({
      lease: approval.lease,
      executionTimeoutMs: 100,
      execute: (ctx) => {
        context = ctx;
        return hold.promise;
      },
    });
    const next = vi.fn(),
      waiter = h.job({ execute: next });
    h.clock.advance(30);
    expect(await active.result).toMatchObject({ status: "revoked", resources: "retained" });
    expect(context!.signal.aborted).toBe(true);
    expect(next).not.toHaveBeenCalled();
    hold.resolve();
    await flush();
    expect(next).toHaveBeenCalledOnce();
    await waiter.result;
  });
  it("checks owner again after reading its scope, rejects scope replacement, and never restores a serialized lease", async () => {
    const h = harness(),
      approval = h.approval(),
      execute = vi.fn();
    let reads = 0;
    const lease = {
      isCurrent: approval.lease.isCurrent,
      get scope() {
        if (++reads > 1) approval.authority.invalidate();
        return approval.lease.scope;
      },
    };
    expect((await h.job({ lease, execute }).result).status).toBe("revoked");
    expect(execute).not.toHaveBeenCalled();
    const other = h.approval(),
      hold = deferred(),
      binding = { scope: other.lease.scope, isCurrent: other.lease.isCurrent };
    const active = h.job({ lease: binding, execute: () => hold.promise });
    binding.scope = h.approval("B").lease.scope;
    h.queue.refresh();
    expect((await active.result).status).toBe("revoked");
    hold.resolve();
    await flush();
    expect(() => h.job({ lease: JSON.parse(JSON.stringify(other.lease)) })).toThrow("invalid_job");
  });
  it("keeps a released old ticket from releasing a newer job that reuses its ID", async () => {
    const h = harness(),
      old = h.job({ id: "same" });
    await old.result;
    await flush();
    const hold = deferred(),
      fresh = h.job({ id: "same", execute: () => hold.promise });
    expect(old.cancel()).toBe(false);
    expect((await old.reconcile()).phase).toBe("finished");
    expect(fresh.getSnapshot().holdsResources).toBe(true);
    expect(h.queue.getSnapshot().modelSlotsInUse).toBe(1);
    hold.resolve();
    await fresh.result;
    expect(h.queue.getSnapshot().modelSlotsInUse).toBe(0);
  });
  it("invalidates completed callback context and isolates public snapshot mutations", async () => {
    const h = harness(),
      hold = deferred();
    let context: QueueExecutionContext | undefined;
    const active = h.operation("file", "A", {
      execute: (ctx) => {
        context = ctx;
        return hold.promise;
      },
    });
    const snapshot = active.getSnapshot();
    (snapshot.owner as QueueOwner).projectId = "tampered";
    (snapshot.resources as ResourceClaim[])[0]!.key = "tampered";
    expect(active.getSnapshot().owner.projectId).toBe("A");
    expect(active.getSnapshot().resources[0]!.key).toBe("file");
    expect(Object.isFrozen(context!.owner)).toBe(true);
    hold.resolve();
    await active.result;
    expect(context!.isCurrent()).toBe(false);
    expect(() => context!.assertCurrent()).toThrow("owner_revoked");
  });
  it("closes with bounded notices, preserves in-flight callbacks, and allows cleanup without reopening access", async () => {
    const h = harness({ modelConcurrency: 1 }),
      hold = deferred(),
      active = h.job({ execute: () => hold.promise }),
      waiter = h.job();
    h.queue.close();
    h.queue.close();
    expect((await active.result).status).toBe("cancelled");
    expect((await waiter.result).status).toBe("cancelled");
    expect(active.getSnapshot().holdsResources).toBe(true);
    expect(() => h.job()).toThrow("queue_closed");
    hold.resolve();
    await flush();
    expect(active.getSnapshot().holdsResources).toBe(false);
    expect(h.clock.timers.size).toBe(0);
  });
  it("limits outstanding entries and rejects unsupported resource/lifecycle declarations without consuming capacity", async () => {
    const h = harness({ modelConcurrency: 1, maxOutstanding: 2 }),
      hold = deferred(),
      active = h.job({ execute: () => hold.promise }),
      waiter = h.job();
    expect(() => h.job()).toThrow("capacity");
    waiter.cancel();
    const replacement = h.job();
    replacement.cancel();
    expect(() =>
      h.operation("editor", "A", { resources: [{ kind: "ue-editor", key: "editor" }] }),
    ).toThrow("invalid_job");
    expect(() => h.job({ queueTimeoutMs: 0 })).toThrow("invalid_job");
    expect(() => h.job({ executionTimeoutMs: Infinity })).toThrow("invalid_job");
    expect(() => h.job({ id: active.getSnapshot().id })).toThrow("invalid_job");
    hold.resolve();
    await active.result;
    expect(h.queue.getSnapshot().jobs).toHaveLength(0);
    expect(() => new RunResourceQueue({ modelConcurrency: 4 })).toThrow("invalid_job");
  });

  it("honors pre-aborted and waiting/running AbortSignals without freeing a live callback", async () => {
    const h = harness({ modelConcurrency: 1 }),
      already = new AbortController(),
      execute = vi.fn();
    already.abort();
    expect((await h.job({ signal: already.signal, execute }).result).status).toBe("cancelled");
    expect(execute).not.toHaveBeenCalled();
    const hold = deferred(),
      running = new AbortController(),
      waiting = new AbortController();
    const active = h.job({ signal: running.signal, execute: () => hold.promise });
    const waiter = h.job({ signal: waiting.signal, execute });
    waiting.abort();
    expect((await waiter.result).resources).toBe("released");
    running.abort();
    expect((await active.result).resources).toBe("retained");
    expect(h.queue.getSnapshot().modelSlotsInUse).toBe(1);
    hold.resolve();
    await flush();
    expect(h.queue.getSnapshot().modelSlotsInUse).toBe(0);
  });
  it("settles both a hung callback deadline and blocked queue deadline while deliberately retaining the unresolved slot", async () => {
    const h = harness({ modelConcurrency: 1 }),
      hold = deferred(),
      next = vi.fn();
    const active = h.job({ execute: () => hold.promise, executionTimeoutMs: 20 });
    const waiter = h.job({ execute: next, queueTimeoutMs: 40 });
    h.clock.advance(40);
    expect(await active.result).toMatchObject({ status: "timed_out", resources: "retained" });
    expect(await waiter.result).toMatchObject({ status: "timed_out", resources: "released" });
    expect(next).not.toHaveBeenCalled();
    expect(h.queue.getSnapshot().modelSlotsInUse).toBe(1);
    expect(h.clock.timers.size).toBe(0);
    hold.resolve();
    await flush();
    expect(h.queue.getSnapshot().modelSlotsInUse).toBe(0);
  });
  it("retains an externally unknown execution across close and permits only its bound cleanup observation afterwards", async () => {
    const h = harness();
    let state: ExecutionObservation = "unknown";
    const active = h.operation("editor", "A", {
      resources: [{ kind: "ue-editor", key: "editor" }],
      execution: { mode: "external", observe: () => state },
    });
    await flush();
    expect((await active.result).status).toBe("reconciling");
    h.queue.close();
    await flush();
    expect(active.getSnapshot()).toMatchObject({ status: "cancelled", holdsResources: true });
    state = "quiescent";
    await active.reconcile();
    expect(active.getSnapshot()).toMatchObject({ phase: "finished", holdsResources: false });
    expect(h.queue.getSnapshot().closed).toBe(true);
    expect(() => h.job()).toThrow("queue_closed");
  });
  it("does not expose its mutable internal entry as the execution callback receiver", async () => {
    const h = harness();
    const receivers: unknown[] = [];
    const ticket = h.job({
      execute: function (this: unknown) {
        receivers.push(this);
      },
    });
    await ticket.result;
    expect(receivers).toEqual([undefined]);
  });
  it("does not return a current execution context when a lease callback reentrantly cancels that same job", async () => {
    const h = harness(),
      approval = h.approval(),
      hold = deferred();
    let armed = false,
      context: QueueExecutionContext | undefined;

    const lease = {
      scope: approval.lease.scope,
      isCurrent: () => {
        if (armed) ticket.cancel();
        return approval.lease.isCurrent();
      },
    };
    const ticket = h.job({
      lease,
      execute: (ctx) => {
        context = ctx;
        return hold.promise;
      },
    });
    armed = true;
    expect(context!.isCurrent()).toBe(false);
    expect(await ticket.result).toMatchObject({ status: "cancelled", resources: "retained" });
    hold.resolve();
    await flush();
    expect(ticket.getSnapshot().holdsResources).toBe(false);
  });
  it("checks its own execution deadline at final callback dispatch and inside the supplied context even before timer delivery", async () => {
    const h = harness(),
      approval = h.approval(),
      execute = vi.fn();
    let checks = 0;
    const lease = {
      scope: approval.lease.scope,
      isCurrent: () => {
        if (++checks === 3) h.clock.time = 20;
        return approval.lease.isCurrent();
      },
    };
    const neverStarted = h.job({ lease, execute, executionTimeoutMs: 10 });
    expect(await neverStarted.result).toMatchObject({ status: "timed_out", resources: "released" });
    expect(execute).not.toHaveBeenCalled();
    const queued = harness(),
      queuedApproval = queued.approval(),
      queuedExecute = vi.fn();
    let ownerChecks = 0;
    const queuedLease = {
      scope: queuedApproval.lease.scope,
      isCurrent: () => {
        if (++ownerChecks === 2) queued.clock.time = 20;
        return queuedApproval.lease.isCurrent();
      },
    };
    const expiredWaiter = queued.job({
      lease: queuedLease,
      execute: queuedExecute,
      queueTimeoutMs: 10,
    });
    expect(await expiredWaiter.result).toMatchObject({
      status: "timed_out",
      resources: "released",
    });
    expect(queuedExecute).not.toHaveBeenCalled();
    const next = harness(),
      hold = deferred();
    let context: QueueExecutionContext | undefined;
    const active = next.job({
      execute: (ctx) => {
        context = ctx;
        return hold.promise;
      },
      executionTimeoutMs: 10,
    });
    next.clock.time = 20;
    expect(context!.isCurrent()).toBe(false);
    expect(await active.result).toMatchObject({ status: "timed_out", resources: "retained" });
    hold.resolve();
    await flush();
    expect(active.getSnapshot().holdsResources).toBe(false);
  });
  it("continues owner monitoring after an unknown external outcome without releasing that owner's lock", async () => {
    const h = harness(),
      approval = h.approval();
    let state: ExecutionObservation = "unknown",
      signal: AbortSignal | undefined;
    const active = h.operation("external", "A", {
      lease: approval.lease,
      execution: { mode: "external", observe: () => state },
      execute: (ctx) => {
        signal = ctx.signal;
      },
    });
    await flush();
    const first = await active.result;
    expect(first.status).toBe("reconciling");
    expect(signal!.aborted).toBe(false);
    approval.authority.invalidate();
    h.queue.refresh();
    expect(signal!.aborted).toBe(true);
    expect(active.getSnapshot()).toMatchObject({ status: "revoked", holdsResources: true });
    await flush();
    state = "quiescent";
    await active.reconcile();
    expect(active.getSnapshot()).toMatchObject({ status: "revoked", holdsResources: false });
    expect(first.status).toBe("reconciling");
    expect(h.clock.timers.size).toBe(0);
  });
});
