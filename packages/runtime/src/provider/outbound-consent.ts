export interface OutboundEnvelope {
  endpoint: string;
  model: string;
  projectId: string | null;
  epoch: number;
  revision: string;
  body: string;
  /** Bound to this exact request; conservative full reservation, never a refund promise. */
  maximumCostMicros?: number;
  /** Estimate from user-confirmed prices, not a reserved account budget. */
  estimatedCostMicros?: number;
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
  type Entry = {review: OutboundReview; finish(approved: boolean): void};
  const queue: Entry[] = [];
  let invalidating=false;
  const advance = () => { pending = queue[0]?.review ?? null; if(!invalidating)notify(); };
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
    invalidate() { generation++; invalidating=true; try { for (const entry of [...queue]) entry.finish(false); } finally { invalidating=false; advance(); } },
    approve(id) { if (pending?.id === id) queue[0]?.finish(true); },
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
        if (!snapshot || invalidating || pending || signal?.aborted || snapshot.generation !== generation ||
            !valid(snapshot.isCurrent) || !valid(() => snapshot.matches(exact)))
          return Promise.reject(new Error("outbound_send_revoked"));
        return Promise.resolve(grantFor(exact, snapshot.generation, signal, snapshot.isCurrent));
      }
      if (invalidating || signal?.aborted || queue.length >= 4) return Promise.reject(new Error("outbound_confirmation_unavailable"));
      const epoch = generation, exact = Object.freeze({ ...envelope });
      return new Promise<OutboundGrant>((resolve, reject) => {
        let settled = false;
        const abort = () => entry.finish(false);
        const entry: Entry = {
          review: Object.freeze({ id: ++nextId, envelope: exact }),
          finish(approved) {
            if(settled)return;
            settled=true; signal?.removeEventListener("abort",abort);
            const index=queue.indexOf(entry); if(index>=0)queue.splice(index,1);
            advance();
            if(!approved || generation!==epoch || signal?.aborted){reject(new Error("outbound_confirmation_revoked"));return;}
            resolve(grantFor(exact,epoch,signal));
          }
        };
        queue.push(entry); signal?.addEventListener("abort",abort,{once:true}); advance();
      });
    },
  };
}
