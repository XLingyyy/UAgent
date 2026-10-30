// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {webcrypto} from "node:crypto";
import {createSavedDeepSeekProfile,type SavedDeepSeekProfileOptions} from "./native-saved-deepseek-session";
import type {NativeInvoke} from "./project-native-adapter";
const ENDPOINT="https://api.deepseek.com/chat/completions",BODY='{"model":"deepseek-flash","stream":true,"messages":[{"role":"user","content":"Synthetic only"}]}';
type Json=Record<string,unknown>;
type Hook=(input:Json)=>unknown|Promise<unknown>;
type Profile=Awaited<ReturnType<typeof createSavedDeepSeekProfile>>;
const profiles:Profile[]=[];
const encoded=(text:string)=>Array.from(new TextEncoder().encode(text));
const frame='data: {"choices":[{"delta":{"content":"Synthetic safe text"}}]}\n\n';
const head={status:200,contentType:"text/event-stream"};
function batch(cursor:number,chunks:number[][],done:boolean,status="sent",extra:Json={}){
 return{cursor,nextCursor:cursor+chunks.length,chunks,head,done,error:null,dispatchStatus:status,...extra};
}
function fixture(){
 const calls:Array<{command:string;input:Json}>=[],hooks=new Map<string,Hook>();
 let current=true,context={projectId:null as string|null,conversationId:"synthetic-conversation"},polled=0,dispatched=false;
 const receipt={profileId:"synthetic-native-profile",providerId:"deepseek",modelId:"deepseek-flash",endpoint:ENDPOINT,expiresAt:Date.now()+60000,fixture:true,vaultVersion:"synthetic-vault-version"};
 const invoke:NativeInvoke=async<T,>(command:string,payload?:unknown)=>{
  const input=structuredClone((payload as {input:Json}).input);calls.push({command,input});
  if(hooks.has(command))return await hooks.get(command)!(input) as T;
  if(command==="open_saved_deepseek_profile")return {...receipt} as T;
  if(command==="prepare_saved_deepseek_request"){
   const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(input.body)));
   return {requestId:"synthetic-request-"+calls.filter(c=>c.command===command).length,endpoint:ENDPOINT,modelId:"deepseek-flash",bodySha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("")} as T;
  }
  if(command==="dispatch_saved_deepseek_request"){dispatched=true;return undefined as T;}
  if(command==="poll_saved_deepseek_request"){
   const cursor=Number(input.cursor);
   if(!dispatched)return batch(cursor,[],true,"notDispatched",{head:null,error:"cancelled"}) as T;
   if(polled++===0)return batch(cursor,[encoded(frame)],true) as T;
   return batch(cursor,[],true) as T;
  }
  if(command==="cancel_saved_deepseek_request")return{dispatchStatus:dispatched?"sent":"notDispatched",done:true} as T;
  return undefined as T;
 };
 const options:SavedDeepSeekProfileOptions={invoke,providerId:"deepseek",modelId:"deepseek-flash",expectedVaultVersion:receipt.vaultVersion,expectedProviderVersion:{providerId:"deepseek",generation:"synthetic-provider-generation",revision:1,exists:true},getContext:()=>context,isCurrent:()=>current};
 return{calls,hooks,receipt,options,setCurrent:(value:boolean)=>{current=value;},setContext:(value:typeof context)=>{context=value;},
  async open(){const profile=await createSavedDeepSeekProfile(options);profiles.push(profile);return profile;},
  count:(command:string)=>calls.filter(c=>c.command===command).length};
}
const request=(signal?:AbortSignal):RequestInit=>({method:"POST",redirect:"error",body:BODY,signal});
beforeEach(()=>{
 vi.stubGlobal("crypto",webcrypto);
 vi.stubGlobal("fetch",vi.fn(()=>{throw Error("REAL NETWORK FORBIDDEN");}));
});
afterEach(async()=>{
 for(const profile of profiles.splice(0))await profile.closeAcknowledged().catch(()=>undefined);
 expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();
});
describe("saved DeepSeek native IPC fetcher (synthetic only)",()=>{
 it("opens a native-owned metadata profile without sending or exposing a key",async()=>{
  const f=fixture(),p=await f.open();
  expect(p.getSnapshot()).toMatchObject({ready:true,providerId:"deepseek",modelId:"deepseek-flash",endpoint:ENDPOINT,fixture:true,vaultVersion:f.receipt.vaultVersion,connectionVerified:false,lastDispatchStatus:"notDispatched"});
  expect(f.calls).toEqual([{command:"open_saved_deepseek_profile",input:{providerId:"deepseek",modelId:"deepseek-flash",expectedVaultVersion:f.receipt.vaultVersion,expectedProviderVersion:{providerId:"deepseek",generation:"synthetic-provider-generation",revision:1,exists:true}}}]);
 });
 it("refuses stale or absent provider identities locally instead of opening a new configuration",async()=>{
  for(const expected of [{providerId:"other",generation:"g",revision:1,exists:true},{providerId:"deepseek",generation:null,revision:1,exists:true},{providerId:"deepseek",generation:"g",revision:1,exists:false}]){
   const f=fixture();f.options.expectedProviderVersion=expected;
   await expect(f.open()).rejects.toMatchObject({message:"native_saved_deepseek_unavailable"});
   expect(f.count("open_saved_deepseek_profile")).toBe(0);
  }
 });
 it("sends only the exact prepared body and never reads browser Authorization headers",async()=>{
  const f=fixture(),p=await f.open(),init=request();
  Object.defineProperty(init,"headers",{get(){throw Error("Authorization must never be read");}});
  expect(await(await p.fetcher(ENDPOINT,init)).text()).toBe(frame);
  expect(f.calls.find(c=>c.command==="prepare_saved_deepseek_request")!.input).toMatchObject({body:BODY,projectId:null,conversationId:"synthetic-conversation"});
  expect(f.count("approve_saved_deepseek_request")).toBe(1);expect(f.count("dispatch_saved_deepseek_request")).toBe(1);
  expect(p.getSnapshot().lastDispatchStatus).toBe("sent");
 });
 it("rejects URL, method, redirect and non-string or oversized body before prepare",async()=>{
  const f=fixture(),p=await f.open();
  for(const [url,init] of [["http://127.0.0.1/chat/completions",request()],[ENDPOINT,{...request(),method:"GET"}],[ENDPOINT,{...request(),redirect:"follow"}],[ENDPOINT,{...request(),body:new Uint8Array(2)}],[ENDPOINT,{...request(),body:"x".repeat(32769)}]] as Array<[string,RequestInit]>)
   await expect(p.fetcher(url,init)).rejects.toMatchObject({dispatchStatus:"notDispatched"});
  expect(f.count("prepare_saved_deepseek_request")).toBe(0);
 });
 it("an already aborted send has zero prepare and dispatch calls",async()=>{
  const f=fixture(),p=await f.open(),abort=new AbortController();abort.abort();
  await expect(p.fetcher(ENDPOINT,request(abort.signal))).rejects.toMatchObject({name:"AbortError",dispatchStatus:"notDispatched"});
  expect(f.count("prepare_saved_deepseek_request")).toBe(0);
 });
 it("a changed body hash is cancelled without approval or dispatch",async()=>{
  const f=fixture(),p=await f.open();
  f.hooks.set("prepare_saved_deepseek_request",()=>({requestId:"wrong-hash-request",endpoint:ENDPOINT,modelId:"deepseek-flash",bodySha256:"0".repeat(64)}));
  await expect(p.fetcher(ENDPOINT,request())).rejects.toMatchObject({dispatchStatus:"notDispatched"});
  expect(f.count("approve_saved_deepseek_request")).toBe(0);expect(f.count("dispatch_saved_deepseek_request")).toBe(0);
  expect(f.count("cancel_saved_deepseek_request")).toBe(1);
 });
 it("source invalidation during native prepare prevents approval and dispatch",async()=>{
  const f=fixture(),p=await f.open();
  f.hooks.set("prepare_saved_deepseek_request",async(input)=>{
   const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(String(input.body)));
   f.setCurrent(false);return{requestId:"prepared-then-stale",endpoint:ENDPOINT,modelId:"deepseek-flash",bodySha256:Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("")};
  });
  await expect(p.fetcher(ENDPOINT,request())).rejects.toMatchObject({name:"AbortError",dispatchStatus:"notDispatched"});
  expect(f.count("approve_saved_deepseek_request")).toBe(0);expect(f.count("dispatch_saved_deepseek_request")).toBe(0);
 });
 it("invalidation during native approval prevents dispatch",async()=>{
  const f=fixture(),p=await f.open();
  f.hooks.set("approve_saved_deepseek_request",()=>{f.setCurrent(false);});
  await expect(p.fetcher(ENDPOINT,request())).rejects.toMatchObject({dispatchStatus:"notDispatched"});
  expect(f.count("dispatch_saved_deepseek_request")).toBe(0);
 });
 it("same-project context revision changes during approval prevent dispatch",async()=>{
  const f=fixture();let revision="first";
  f.options.getContext=()=>({projectId:null,conversationId:"synthetic-conversation",revision});
  const p=await f.open();f.hooks.set("approve_saved_deepseek_request",()=>{revision="changed";});
  await expect(p.fetcher(ENDPOINT,request())).rejects.toMatchObject({dispatchStatus:"notDispatched"});
  expect(f.count("dispatch_saved_deepseek_request")).toBe(0);
 });
 it("replacing the caller option callback cannot replace the captured authority",async()=>{
  const f=fixture(),p=await f.open();
  f.hooks.set("approve_saved_deepseek_request",()=>{f.setCurrent(false);f.options.isCurrent=()=>true;});
  await expect(p.fetcher(ENDPOINT,request())).rejects.toMatchObject({dispatchStatus:"notDispatched"});
  expect(f.count("dispatch_saved_deepseek_request")).toBe(0);
 });
 it("lost dispatch acknowledgement plus failed cancel and nonterminal zero poll stays may-have-sent",async()=>{
  const f=fixture(),p=await f.open();
  f.hooks.set("dispatch_saved_deepseek_request",()=>{throw Error("synthetic-private-diagnostic");});
  f.hooks.set("cancel_saved_deepseek_request",()=>{throw Error("cancel transport failed");});
  f.hooks.set("poll_saved_deepseek_request",()=>batch(0,[],false,"notDispatched",{head:null}));
  f.hooks.set("release_saved_deepseek_request",()=>{throw Error("release failed");});
  const error=await p.fetcher(ENDPOINT,request()).catch(e=>e);
  expect(error).toMatchObject({message:"native_saved_deepseek_unavailable",dispatchStatus:"mayHaveBeenSent"});
  expect(String(error)).not.toContain("synthetic-private");
  expect(p.getSnapshot()).toMatchObject({lastDispatchStatus:"mayHaveBeenSent",cleanupUnconfirmed:true,ready:false});
 });
 it("only a terminal unsent poll can refine a lost dispatch acknowledgement to zero",async()=>{
  const f=fixture(),p=await f.open();
  f.hooks.set("dispatch_saved_deepseek_request",()=>{throw Error("lost ack");});
  f.hooks.set("cancel_saved_deepseek_request",()=>{throw Error("lost cancel ack");});
  f.hooks.set("poll_saved_deepseek_request",()=>batch(0,[],true,"notDispatched",{head:null,error:"cancelled"}));
  await expect(p.fetcher(ENDPOINT,request())).rejects.toMatchObject({dispatchStatus:"notDispatched"});
 });
 it("a confirmed native cancel closes the unsent gate even if its final poll fails",async()=>{
  const f=fixture(),p=await f.open();
  f.hooks.set("dispatch_saved_deepseek_request",()=>{throw Error("lost ack");});
  f.hooks.set("cancel_saved_deepseek_request",()=>({dispatchStatus:"notDispatched",done:true}));
  f.hooks.set("poll_saved_deepseek_request",()=>{throw Error("poll failed");});
  await expect(p.fetcher(ENDPOINT,request())).rejects.toMatchObject({dispatchStatus:"notDispatched"});
 });
 it("a sent request never becomes unsent after abort and a contradictory zero cleanup",async()=>{
  const f=fixture(),p=await f.open(),abort=new AbortController();let polls=0;
  f.hooks.set("poll_saved_deepseek_request",input=>polls++===0?batch(Number(input.cursor),[encoded(frame)],false):batch(Number(input.cursor),[],true,"notDispatched",{head:null,error:"cancelled"}));
  f.hooks.set("cancel_saved_deepseek_request",()=>({dispatchStatus:"notDispatched",done:true}));
  const response=await p.fetcher(ENDPOINT,request(abort.signal)),reader=response.body!.getReader();
  expect((await reader.read()).value).toBeTruthy();abort.abort();
  await expect(reader.read()).rejects.toMatchObject({name:"AbortError",dispatchStatus:"sent"});
  await new Promise(r=>setTimeout(r,30));expect(p.getSnapshot().lastDispatchStatus).toBe("sent");
 });
 it("streams batches in place and validates split UTF-8 without changing bytes",async()=>{
  const f=fixture(),p=await f.open(),text="data: \u4f60\u597d\n\n",bytes=encoded(text);let polls=0;
  f.hooks.set("poll_saved_deepseek_request",input=>polls++===0?batch(0,[bytes.slice(0,7)],false):batch(Number(input.cursor),[bytes.slice(7)],true));
  const response=await p.fetcher(ENDPOINT,request()),reader=response.body!.getReader();
  const first=await reader.read();expect(first.done).toBe(false);expect(polls).toBe(1);
  const second=await reader.read();expect(second.done).toBe(false);expect(new TextDecoder().decode(new Uint8Array([...first.value!,...second.value!]))).toBe(text);
  expect((await reader.read()).done).toBe(true);
 });
 it("an invalid native cursor is rejected without leaking chunks",async()=>{
  const f=fixture(),p=await f.open();
  f.hooks.set("poll_saved_deepseek_request",()=>batch(8,[encoded("private-invalid-chunk")],true));
  await expect(p.fetcher(ENDPOINT,request())).rejects.toMatchObject({message:"native_saved_deepseek_unavailable"});
 });
 it("rejects invalid UTF-8 and malformed byte/chunk bounds",async()=>{
  for(const chunks of [[[255]],[[999]],[new Array(65537).fill(1)]]){
   const f=fixture(),p=await f.open();f.hooks.set("poll_saved_deepseek_request",()=>batch(0,chunks,true));
   await expect(p.fetcher(ENDPOINT,request())).rejects.toMatchObject({message:"native_saved_deepseek_unavailable"});
  }
 });
 it("an HTTP status is returned only after a terminal safe empty native rejection",async()=>{
  const f=fixture(),p=await f.open();let polls=0;
  f.hooks.set("poll_saved_deepseek_request",()=>batch(0,[],polls++>0,"sent",{head:{status:401,contentType:"application/json"},error:polls>1?"native_transport_failed":null}));
  const response=await p.fetcher(ENDPOINT,request());expect(response.status).toBe(401);expect(await response.text()).toBe("");
  expect(p.getSnapshot().lastDispatchStatus).toBe("sent");
 });
 it("HTTP error bytes and unrecognized native errors never become response bodies",async()=>{
  const f=fixture(),p=await f.open();
  f.hooks.set("poll_saved_deepseek_request",()=>batch(0,[encoded("sensitive remote error")],true,"sent",{head:{status:401,contentType:"application/json"},error:"native_transport_failed"}));
  await expect(p.fetcher(ENDPOINT,request())).rejects.toMatchObject({message:"native_saved_deepseek_unavailable"});
 });
 it("text validation is a native-only call and rejects oversized input locally",async()=>{
  const f=fixture(),p=await f.open();await p.validateText("Synthetic public user text");
  expect(f.calls.find(c=>c.command==="validate_saved_deepseek_text")!.input).toEqual({profileId:f.receipt.profileId,text:"Synthetic public user text"});
  await expect(p.validateText("x".repeat(131073))).rejects.toMatchObject({message:"native_saved_deepseek_unavailable"});
  expect(f.count("validate_saved_deepseek_text")).toBe(1);
 });
 it("native text rejection and callback failures stay static",async()=>{
  const f=fixture(),p=await f.open();
  f.hooks.set("validate_saved_deepseek_text",()=>{throw Error("private secret diagnostic");});
  await expect(p.validateText("Synthetic text")).rejects.toMatchObject({message:"native_saved_deepseek_unavailable"});
  f.options.getContext=()=>{throw Error("replacement callback must not be captured");};
  expect(await(await p.fetcher(ENDPOINT,request())).text()).toBe(frame);
 });
 it("explicit close rejects an unconfirmed native revocation and stays locally closed",async()=>{
  const f=fixture(),p=await f.open();
  f.hooks.set("close_saved_deepseek_profile",()=>{throw Error("secret OS path");});
  await expect(p.closeAcknowledged()).rejects.toMatchObject({message:"native_saved_deepseek_revocation_unconfirmed",revocationUnconfirmed:true});
  await expect(p.closeAcknowledged()).rejects.toMatchObject({revocationUnconfirmed:true});
  expect(f.count("close_saved_deepseek_profile")).toBe(1);expect(p.getSnapshot().ready).toBe(false);
  await expect(p.fetcher(ENDPOINT,request())).rejects.toMatchObject({dispatchStatus:"notDispatched"});
 });
 it("close ends local streaming immediately while native acknowledgement is awaited",async()=>{
  const f=fixture(),p=await f.open();
  f.hooks.set("poll_saved_deepseek_request",input=>batch(Number(input.cursor),Number(input.cursor)===0?[encoded(frame)]:[],false));
  const reader=(await p.fetcher(ENDPOINT,request())).body!.getReader();await reader.read();
  await p.closeAcknowledged();
  await expect(reader.read()).rejects.toMatchObject({name:"AbortError",dispatchStatus:"sent"});
  expect(p.getSnapshot().ready).toBe(false);
 });
 it("release failure is visible and blocks reuse until native close is acknowledged",async()=>{
  const f=fixture(),p=await f.open();f.hooks.set("release_saved_deepseek_request",()=>{throw Error("lost release");});
  expect(await(await p.fetcher(ENDPOINT,request())).text()).toBe(frame);
  expect(p.getSnapshot()).toMatchObject({cleanupUnconfirmed:true,ready:false,lastDispatchStatus:"sent"});
  await p.closeAcknowledged();expect(p.getSnapshot().cleanupUnconfirmed).toBe(false);
 });
 it("a busy profile rejects another send without dispatching a second intent",async()=>{
  const f=fixture(),p=await f.open();
  f.hooks.set("poll_saved_deepseek_request",input=>batch(Number(input.cursor),Number(input.cursor)===0?[encoded(frame)]:[],false));
  const response=await p.fetcher(ENDPOINT,request());
  await expect(p.fetcher(ENDPOINT,request())).rejects.toMatchObject({dispatchStatus:"notDispatched"});
  expect(f.count("dispatch_saved_deepseek_request")).toBe(1);await response.body!.cancel();
 });
 it("a context change during polling does not expose the next batch or send again",async()=>{
  const f=fixture(),p=await f.open();let polls=0;
  f.hooks.set("poll_saved_deepseek_request",input=>{
   if(polls++===0)return batch(0,[encoded(frame)],false);
   f.setContext({projectId:"other-project",conversationId:"other-conversation"});
   return batch(Number(input.cursor),[encoded("must not be visible")],true);
  });
  const reader=(await p.fetcher(ENDPOINT,request())).body!.getReader();expect((await reader.read()).value).toBeTruthy();
  await expect(reader.read()).rejects.toMatchObject({name:"AbortError"});expect(f.count("dispatch_saved_deepseek_request")).toBe(1);
 });
 it("a mismatched native profile is closed before any request can be prepared",async()=>{
  const f=fixture();f.hooks.set("open_saved_deepseek_profile",()=>({...f.receipt,providerId:"other-provider"}));
  await expect(f.open()).rejects.toMatchObject({message:"native_saved_deepseek_unavailable"});
  expect(f.count("close_saved_deepseek_profile")).toBe(1);expect(f.count("prepare_saved_deepseek_request")).toBe(0);
 });
 it("failed cleanup of an invalid opening is explicitly unconfirmed",async()=>{
  const f=fixture();f.hooks.set("open_saved_deepseek_profile",()=>({...f.receipt,vaultVersion:"wrong-version"}));
  f.hooks.set("close_saved_deepseek_profile",()=>{throw Error("private detail");});
  await expect(f.open()).rejects.toMatchObject({revocationUnconfirmed:true,dispatchStatus:"notDispatched"});
 });
});
