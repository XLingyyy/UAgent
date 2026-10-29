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
export interface OutboundConsentGate {
  review(envelope: OutboundEnvelope, signal?: AbortSignal): Promise<OutboundGrant>;
  getPending(): OutboundReview | null;
  subscribe(listener: () => void): () => void;
  approve(id: number): void;
  invalidate(): void;
}
export function createOutboundConsentGate(): OutboundConsentGate {
  let generation=0, nextId=0;
  let pending: OutboundReview | null=null;
  let settle: ((approved:boolean)=>void) | null=null;
  const listeners=new Set<()=>void>();
  const notify=()=>listeners.forEach(listener=>listener());
  return {
    getPending:()=>pending,
    subscribe(listener) { listeners.add(listener); return ()=>{listeners.delete(listener);}; },
    invalidate() { generation++; settle?.(false); pending=null; notify(); },
    approve(id) { if(pending?.id===id) settle?.(true); },
    review(envelope,signal) {
      if(pending || signal?.aborted) return Promise.reject(new Error("outbound_confirmation_unavailable"));
      const bound=JSON.stringify(envelope), epoch=generation;
      pending=Object.freeze({id:++nextId,envelope:Object.freeze({...envelope})});
      return new Promise<OutboundGrant>((resolve,reject)=>{
        const abort=()=>settle?.(false);
        signal?.addEventListener("abort",abort,{once:true});
        settle=(approved)=>{
          signal?.removeEventListener("abort",abort); settle=null; pending=null; notify();
          if(!approved || generation!==epoch || signal?.aborted) { reject(new Error("outbound_confirmation_revoked")); return; }
          let consumed=false;
          resolve({consume(current){
            if(consumed || generation!==epoch || signal?.aborted || JSON.stringify(current)!==bound) return false;
            consumed=true; return true;
          }});
        };
        notify();
      });
    },
  };
}
