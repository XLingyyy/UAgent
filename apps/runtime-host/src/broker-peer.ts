export interface BrokerRequest {
  kind: "broker_request";
  id: number;
  runId: string;
  method: "provider.complete" | "tool.execute" | "context.validate" | "store.commit" | "store.snapshot";
  input: unknown;
}

/** Private parent/child pipe. The parent retains credentials and validates every dispatch. */
export class BrokerPeer {
  private sequence = 0;
  private closed = false;
  private readonly pending = new Map<number, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    cleanup: () => void;
  }>();

  constructor(private readonly send: (message: unknown) => void) {}

  request<T>(runId: string, method: BrokerRequest["method"], input: unknown, signal?: AbortSignal): Promise<T> {
    if (this.closed) return Promise.reject(Error("host_broker_closed"));
    if (signal?.aborted) return Promise.reject(Error("host_request_cancelled"));
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        const entry = this.pending.get(id);
        if (!entry) return;
        this.pending.delete(id);
        entry.cleanup();
        try { this.send({ kind: "broker_cancel", id, runId }); }
        finally { reject(Error("host_request_cancelled")); }
      };
      this.pending.set(id, {
        resolve: value => resolve(value as T), reject,
        cleanup: () => signal?.removeEventListener("abort", abort),
      });
      signal?.addEventListener("abort", abort, { once: true });
      try { this.send({ kind: "broker_request", id, runId, method, input } satisfies BrokerRequest); }
      catch {
        this.pending.delete(id);
        signal?.removeEventListener("abort", abort);
        reject(Error("host_broker_closed"));
      }
    });
  }

  reply(id: number, ok: boolean, value: unknown): void {
    const entry = this.pending.get(id);
    // Cancellation may race the actual native completion. Never assign it to another request.
    if (!entry) return;
    this.pending.delete(id);
    entry.cleanup();
    if (ok) entry.resolve(value);
    else entry.reject(Error("host_broker_request_failed"));
  }

  close(): void {
    this.closed = true;
    for (const entry of this.pending.values()) {
      entry.cleanup();
      entry.reject(Error("host_broker_closed"));
    }
    this.pending.clear();
  }
}
