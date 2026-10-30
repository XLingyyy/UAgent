import { describe, expect, it } from "vitest";
import { createOutboundConsentGate, type OutboundEnvelope, type OutboundSendIntent } from "./outbound-consent.js";
const envelope: OutboundEnvelope = { endpoint:"https://fixture.invalid/v1",model:"synthetic",projectId:"P",epoch:1,revision:"r1",body:'{"text":"one ordinary send"}' };
describe("ordinary send intent is one exact memory-only grant", () => {
  const capture = (gate: ReturnType<typeof createOutboundConsentGate>, current = () => true) =>
    gate.captureSendIntent!({ isCurrent: current, matches: candidate => JSON.stringify(candidate) === JSON.stringify(envelope) });
  it("does not create a review dialog and consumes exact bytes once", async () => {
    const gate=createOutboundConsentGate(),intent=capture(gate);
    const grant=await gate.review(envelope,undefined,intent);
    expect(gate.getPending()).toBeNull();
    for(const key of ["endpoint","model","projectId","revision","body"] as const)expect(grant.consume({...envelope,[key]:"changed"})).toBe(false);
    expect(grant.consume({...envelope,epoch:2})).toBe(false);
    expect(grant.consume(envelope)).toBe(true);expect(grant.consume(envelope)).toBe(false);
    await expect(gate.review(envelope,undefined,intent)).rejects.toThrow("revoked");
  });
  it("rejects forged, serialized and cross-gate capabilities", async () => {
    const gate=createOutboundConsentGate(),intent=capture(gate),other=createOutboundConsentGate();
    for(const forged of [{} as OutboundSendIntent,JSON.parse(JSON.stringify(intent)) as OutboundSendIntent])
      await expect(gate.review(envelope,undefined,forged)).rejects.toThrow("revoked");
    await expect(other.review(envelope,undefined,intent)).rejects.toThrow("revoked");
    const grant=await gate.review(envelope,undefined,intent);expect(grant.consume(envelope)).toBe(true);
  });
  it("revokes on source changes before review or after grant creation", async () => {
    const gate=createOutboundConsentGate();let current=true;
    const intent=capture(gate,()=>current);current=false;
    await expect(gate.review(envelope,undefined,intent)).rejects.toThrow("revoked");
    current=true;const grant=await gate.review(envelope,undefined,capture(gate,()=>current));
    current=false;expect(grant.consume(envelope)).toBe(false);
  });
  it("captures callback identities and cannot be revived by caller replacement", async () => {
    const gate=createOutboundConsentGate();let current=true;
    const source={isCurrent:()=>current,matches:()=>true},intent=gate.captureSendIntent!(source);
    current=false;source.isCurrent=()=>true;source.matches=()=>true;
    await expect(gate.review(envelope,undefined,intent)).rejects.toThrow("revoked");
  });
  it("consumes rejected mismatches and honors Stop and invalidation", async () => {
    const gate=createOutboundConsentGate(),intent=capture(gate);
    await expect(gate.review({...envelope,body:"different"},undefined,intent)).rejects.toThrow("revoked");
    await expect(gate.review(envelope,undefined,intent)).rejects.toThrow("revoked");
    const stopped=capture(gate),signal=new AbortController();signal.abort();
    await expect(gate.review(envelope,signal.signal,stopped)).rejects.toThrow("revoked");
    const old=capture(gate);gate.invalidate();await expect(gate.review(envelope,undefined,old)).rejects.toThrow("revoked");
  });
  it("never approves a separate pending review", async () => {
    const gate=createOutboundConsentGate(),intent=capture(gate),pending=gate.review(envelope);
    const id=gate.getPending()!.id;
    await expect(gate.review(envelope,undefined,intent)).rejects.toThrow("revoked");
    expect(gate.getPending()!.id).toBe(id);gate.approve(id);
    expect((await pending).consume(envelope)).toBe(true);
  });
  it("keeps manual approvals bound to the original immutable snapshot", async () => {
    const gate=createOutboundConsentGate(),mutable={...envelope},pending=gate.review(mutable);
    mutable.body="changed after review";expect(gate.getPending()!.envelope.body).toBe(envelope.body);
    gate.approve(gate.getPending()!.id);const grant=await pending;
    expect(grant.consume(mutable)).toBe(false);expect(grant.consume(envelope)).toBe(true);
  });
});
