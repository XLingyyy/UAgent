import type { TaskDraft, TaskRun } from "@uagent/shared";
import { RunCoordinator, type RunCoordinatorOptions, type RunOutcome } from "./run-coordinator.js";

export interface HostedRunSnapshot {
  revision: number;
  run: TaskRun;
  text: string;
  settled: boolean;
}

interface HostedRun {
  coordinator: RunCoordinator;
  snapshot: HostedRunSnapshot | null;
  listeners: Set<(snapshot: HostedRunSnapshot) => void>;
  pending: Promise<RunOutcome> | null;
  cancelling: Promise<void> | null;
}

/** Owns coordinators independently of observers. Execution authority remains in the supplied ports. */
export class RunHost {
  private readonly runs = new Map<string, HostedRun>();
  private closed = false;

  start(taskId: string, draft: TaskDraft, options: RunCoordinatorOptions): Promise<RunOutcome> {
    if (this.closed) throw Error("run_host_closed");
    const runId = options.lease.scope.runId;
    if (this.runs.has(runId)) throw Error("run_already_started");
    if (!options.lease.isCurrent()) throw Error("run_scope_unavailable");
    const entry: HostedRun = {
      coordinator: new RunCoordinator({
        ...options,
        onEvent: (event, run) => {
          const previous = entry.snapshot;
          const delta = event.type === "model_text_delta"
            ? (event.payload as { text: string }).text : "";
          this.publish(entry, run, event.type === "model_started" ? "" : (previous?.text ?? "") + delta, false);
          options.onEvent?.(event, run);
        },
      }),
      snapshot: null,
      listeners: new Set(),
      pending: null,
      cancelling: null,
    };
    this.runs.set(runId, entry);
    return this.drive(entry, () => entry.coordinator.start(taskId, draft));
  }

  getSnapshot(runId: string): HostedRunSnapshot | null {
    const snapshot = this.get(runId).snapshot;
    return snapshot ? structuredClone(snapshot) : null;
  }

  subscribe(runId: string, listener: (snapshot: HostedRunSnapshot) => void): () => void {
    const entry = this.get(runId);
    entry.listeners.add(listener);
    if (entry.snapshot) this.deliver(listener, entry.snapshot);
    // A view disappearing does not cancel, renew or recreate execution authority.
    return () => { entry.listeners.delete(listener); };
  }

  pause(runId: string): void { this.get(runId).coordinator.requestPause(); }
  async cancel(runId: string): Promise<void> {
    const entry = this.get(runId);
    if (entry.cancelling) return entry.cancelling;
    const cancelling = entry.coordinator.cancel().then(() => {
      if (!entry.pending) {
        const run = entry.coordinator.getSnapshot();
        if (run) this.publish(entry, run, entry.snapshot?.text ?? "", true);
      }
    }).finally(() => { entry.cancelling = null; });
    entry.cancelling = cancelling;
    return cancelling;
  }

  resume(runId: string): Promise<RunOutcome> {
    if (this.closed) throw Error("run_host_closed");
    const entry = this.get(runId);
    if (entry.pending) throw Error("run_still_running");
    return this.drive(entry, () => entry.coordinator.resume());
  }

  amend(runId: string, instructions: string, expectedPlanVersion: number): Promise<RunOutcome> {
    if (this.closed) throw Error("run_host_closed");
    const entry = this.get(runId);
    if (entry.pending || entry.cancelling) throw Error("run_still_running");
    return this.drive(entry, () => entry.coordinator.amend(instructions, expectedPlanVersion));
  }

  /** The process owner must keep its broker alive until these checkpoints settle. */
  async close(): Promise<{ checkpointed: boolean }> {
    this.closed = true;
    const pending: Promise<unknown>[] = [];
    for (const entry of this.runs.values()) {
      if (entry.pending) {
        entry.coordinator.requestPause();
        pending.push(entry.pending);
      }
      if (entry.cancelling) pending.push(entry.cancelling);
    }
    const results = await Promise.allSettled(pending);
    return { checkpointed: results.every(result => result.status === "fulfilled")
      && [...this.runs.values()].every(entry => Boolean(entry.snapshot?.settled)
        && !entry.snapshot?.run.stopReason?.startsWith("persistence_failed")) };
  }

  private get(runId: string): HostedRun {
    const entry = this.runs.get(runId);
    if (!entry) throw Error("run_not_found");
    return entry;
  }

  private drive(entry: HostedRun, action: () => Promise<RunOutcome>): Promise<RunOutcome> {
    const pending = action().then(outcome => {
      this.publish(entry, outcome.run, outcome.text, true);
      return outcome;
    }).finally(() => { entry.pending = null; });
    entry.pending = pending;
    return pending;
  }

  private publish(entry: HostedRun, run: TaskRun, text: string, settled: boolean): void {
    entry.snapshot = structuredClone({ revision: (entry.snapshot?.revision ?? 0) + 1, run, text, settled });
    for (const listener of entry.listeners) this.deliver(listener, entry.snapshot);
  }

  private deliver(listener: (snapshot: HostedRunSnapshot) => void, snapshot: HostedRunSnapshot): void {
    // A disconnected or broken observer must not turn a completed tool into a failed run.
    try { listener(structuredClone(snapshot)); } catch { /* Observer has no execution authority. */ }
  }
}
