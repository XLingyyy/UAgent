export interface OutboundEnvelope {
  endpoint: string;
  model: string;
  projectId: string | null;
  epoch: number;
  revision: string;
  body: string;
  /** Bound to this exact request; conservative full reservation, never a refund promise. */
  maximumCostMicros?: number;
}
export interface OutboundReview { id: number; envelope: Readonly<OutboundEnvelope> }
export interface OutboundGrant { consume(envelope: OutboundEnvelope): boolean }
declare const sendIntentBrand: unique symbol;
/** Memory-only object capability. Serialized or reconstructed objects confer no permission. */
export interface OutboundSendIntent { readonly [sendIntentBrand]: true }
export interface OutboundSendSnapshot {
  isCurrent(): boolean;
  matches(envelope: Readonly<OutboundEnvelope>): boolean;
}
export interface OutboundConsentGate {
  review(envelope: OutboundEnvelope, signal?: AbortSignal, intent?: OutboundSendIntent): Promise<OutboundGrant>;
  /** Called only by the trusted ordinary-chat send action, never by tools or restored data. */
  captureSendIntent?(snapshot: OutboundSendSnapshot): OutboundSendIntent;
  getPending(): OutboundReview | null;
  subscribe(listener: () => void): () => void;
  approve(id: number): void;
  invalidate(): void;
}
export function createOutboundConsentGate(): OutboundConsentGate {
  let generation = 0, nextId = 0;
  let pending: OutboundReview | null = null;
  let settle: ((approved: boolean) => void) | null = null;
  const listeners = new Set<() => void>();
  const intents = new WeakMap<OutboundSendIntent, OutboundSendSnapshot & { generation: number }>();
  const notify = () => listeners.forEach(listener => listener());
  const valid = (check: () => boolean) => { try { return check() === true; } catch { return false; } };
  function grantFor(envelope: OutboundEnvelope, epoch: number, signal?: AbortSignal, current = () => true): OutboundGrant {
    const bound = JSON.stringify(envelope);
    let consumed = false;
    return { consume(actual) {
      if (consumed || generation !== epoch || signal?.aborted || !valid(current) || JSON.stringify(actual) !== bound) return false;
      consumed = true;
      return true;
    } };
  }
  return {
    getPending: () => pending,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    invalidate() { generation++; settle?.(false); pending = null; notify(); },
    approve(id) { if (pending?.id === id) settle?.(true); },
    captureSendIntent(snapshot) {
      const isCurrent = snapshot.isCurrent, matches = snapshot.matches;
      if (typeof isCurrent !== "function" || typeof matches !== "function" || !valid(isCurrent))
        throw new Error("outbound_send_stale");
      const intent = Object.freeze({}) as OutboundSendIntent;
      intents.set(intent, { isCurrent, matches, generation });
      return intent;
    },
    review(envelope, signal, intent) {
      if (intent !== undefined) {
        const snapshot = intents.get(intent);
        // Even a rejected attempt consumes the intent; a new click is required.
        intents.delete(intent);
        const exact = Object.freeze({ ...envelope });
        if (!snapshot || pending || signal?.aborted || snapshot.generation !== generation ||
            !valid(snapshot.isCurrent) || !valid(() => snapshot.matches(exact)))
          return Promise.reject(new Error("outbound_send_revoked"));
        return Promise.resolve(grantFor(exact, snapshot.generation, signal, snapshot.isCurrent));
      }
      if (pending || signal?.aborted) return Promise.reject(new Error("outbound_confirmation_unavailable"));
      const epoch = generation, exact = Object.freeze({ ...envelope });
      pending = Object.freeze({ id: ++nextId, envelope: exact });
      return new Promise<OutboundGrant>((resolve, reject) => {
        const abort = () => settle?.(false);
        signal?.addEventListener("abort", abort, { once: true });
        settle = approved => {
          signal?.removeEventListener("abort", abort); settle = null; pending = null; notify();
          if (!approved || generation !== epoch || signal?.aborted) {
            reject(new Error("outbound_confirmation_revoked")); return;
          }
          resolve(grantFor(exact, epoch, signal));
        };
        notify();
      });
    },
  };
}
