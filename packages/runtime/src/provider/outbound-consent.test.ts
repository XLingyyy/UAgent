import { describe,expect,it,vi } from "vitest";
import { createOutboundConsentGate, type OutboundEnvelope } from "./outbound-consent.js";
import { createDeepSeekSession,DEEPSEEK_CAMPAIGN,DEEPSEEK_ENDPOINT,DEEPSEEK_MODEL,type DeepSeekBudgetStore } from "./deepseek-session.js";
const envelope:OutboundEnvelope={endpoint:DEEPSEEK_ENDPOINT,model:DEEPSEEK_MODEL,projectId:"synthetic-A",epoch:1,revision:"draft-1",body:'{"messages":[{"role":"user","content":"synthetic"}]}' };
describe("exact outbound consent",()=>{
 it("binds all fields and consumes a grant only once",async()=>{
  const gate=createOutboundConsentGate();const pending=gate.review(envelope);gate.approve(gate.getPending()!.id);const grant=await pending;
  for(const field of ["endpoint","model","projectId","revision","body"] as const) expect(grant.consume({...envelope,[field]:"changed"})).toBe(false);
  expect(grant.consume({...envelope,epoch:2})).toBe(false);expect(grant.consume(envelope)).toBe(true);expect(grant.consume(envelope)).toBe(false);
 });
 it("revokes both pending and confirmed requests on context changes",async()=>{
  const gate=createOutboundConsentGate();const pending=gate.review(envelope);gate.invalidate();await expect(pending).rejects.toThrow("revoked");
  const next=gate.review(envelope);gate.approve(gate.getPending()!.id);const grant=await next;gate.invalidate();expect(grant.consume(envelope)).toBe(false);
 });
 it("rejects stale confirmation ids and honors Stop",async()=>{
  const gate=createOutboundConsentGate(),controller=new AbortController();const pending=gate.review(envelope,controller.signal);
  gate.approve(999);expect(gate.getPending()).not.toBeNull();controller.abort();await expect(pending).rejects.toThrow("revoked");
 });
 it("reserves and sends only after exact confirmation; usage uses the reservation id",async()=>{
  const gate=createOutboundConsentGate();const order:string[]=[];
  const usage=vi.fn();const store:DeepSeekBudgetStore={durable:false,read:()=>({campaign:DEEPSEEK_CAMPAIGN,limitMicros:10_000_000,reservedMicros:0,requests:0,inputTokens:0,outputTokens:0,uncertainRequests:0}),reserve:()=>{order.push("reserve");return "1234567890abcdef1234567890abcdef";},recordUsage:usage};
  const fetcher=vi.fn(async()=>{order.push("send");return new Response('data: {"choices":[{"delta":{"content":"synthetic"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\ndata: [DONE]\n\n',{headers:{"Content-Type":"text/event-stream"}});});
  const session=createDeepSeekSession({mode:"offline",ledger:store,outboundGate:gate,getProjectContext:()=>({projectId:"synthetic-A",epoch:1,revision:"draft-1"}),fetcher,consent:{endpoint:DEEPSEEK_ENDPOINT,model:DEEPSEEK_MODEL,campaign:DEEPSEEK_CAMPAIGN,pricesVerified:true,inputMicrosPerToken:10,outputMicrosPerToken:10,expiresAt:Date.now()+60_000}});session.setCredential("synthetic-session-key");
  const pending=session.adapter.complete({id:"synthetic",providerId:"deepseek",modelId:DEEPSEEK_MODEL,messages:[{role:"user",content:"synthetic"}],metadata:{projectId:"synthetic-A"}});
  await vi.waitFor(()=>expect(gate.getPending()).not.toBeNull());expect(order).toEqual([]);
  const shown=gate.getPending()!;gate.approve(shown.id);await pending;
  expect(order).toEqual(["reserve","send"]);expect(fetcher.mock.calls[0]).toBeDefined();
  expect(usage).toHaveBeenCalledWith({inputTokens:2,outputTokens:3,totalTokens:5},"1234567890abcdef1234567890abcdef");
 });
 it("a changed draft after approval but during persistence never sends",async()=>{
  const gate=createOutboundConsentGate();let release!:()=>void;let revision="first";
  const fetcher=vi.fn();const session=createDeepSeekSession({mode:"offline",fetcher,outboundGate:gate,getProjectContext:()=>({projectId:null,epoch:1,revision}),consent:{endpoint:DEEPSEEK_ENDPOINT,model:DEEPSEEK_MODEL,campaign:DEEPSEEK_CAMPAIGN,pricesVerified:true,inputMicrosPerToken:10,outputMicrosPerToken:10,expiresAt:Date.now()+60_000},ledger:{durable:false,read:()=>({campaign:DEEPSEEK_CAMPAIGN,limitMicros:10_000_000,reservedMicros:0,requests:0,inputTokens:0,outputTokens:0,uncertainRequests:0}),reserve:()=>new Promise<void>(resolve=>{release=resolve;}),recordUsage:()=>{}}});session.setCredential("synthetic-session-key");
  const pending=session.adapter.complete({id:"synthetic",providerId:"deepseek",modelId:DEEPSEEK_MODEL,messages:[{role:"user",content:"synthetic"}]});
  await vi.waitFor(()=>expect(gate.getPending()).not.toBeNull());gate.approve(gate.getPending()!.id);
  await vi.waitFor(()=>expect(release).toBeDefined());revision="changed";release();await expect(pending).rejects.toMatchObject({code:"cancelled"});expect(fetcher).not.toHaveBeenCalled();
 });
});
