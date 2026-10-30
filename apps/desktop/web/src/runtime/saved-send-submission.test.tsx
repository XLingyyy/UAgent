import {act,cleanup,render,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {createOutboundConsentGate,DEEPSEEK_MODEL} from "@uagent/runtime";
import type {ProviderRuntimeRequest,TaskDraft} from "@uagent/shared";
import type {ComposerStoreState} from "../types/ui";
import {createDesktopRuntimeAdapter} from "./desktop-runtime-adapter";
import {createSafeProviderSession,safeProviderSession} from "./safe-provider-session";
import {createAttachmentStore} from "./attachment-store";
import {nativeProviderCredentials} from "./native-provider-credentials";
import {createSupportedProvider} from "../provider/runtime-availability";
import {
 UIProvider,useComposerActions,useComposerStore,useProjectActions,useProjectStore,
 useThreadActions,useThreadStore,useRuntimeStore,
} from "../stores/ui-store";

const active:ReturnType<typeof createSafeProviderSession>[]=[];
afterEach(()=>{
 cleanup();active.splice(0).forEach(manager=>manager.dispose());
 expect(fetch).not.toHaveBeenCalled();
 vi.restoreAllMocks();vi.unstubAllGlobals();safeProviderSession.close("cleared");
});
function deferred(){
 let resolve!:()=>void;
 const promise=new Promise<void>(done=>{resolve=done;});
 return{promise,resolve};
}
async function harness({holdStream=false,threadId=null as string|null}={}){
 vi.stubGlobal("fetch",vi.fn(()=>{throw Error("REAL NETWORK FORBIDDEN");}));
 const log:string[]=[],sent:string[]=[],gate=createOutboundConsentGate();
 const opened=deferred();
 const fetcher=vi.fn(async(_input:unknown,init?:RequestInit)=>{
  log.push("synthetic:dispatch");sent.push(String(init?.body));
  const encoder=new TextEncoder();
  const frame=(text:string,finish=false)=>"data: "+JSON.stringify({
   model:DEEPSEEK_MODEL,choices:[{delta:{content:text},...(finish?{finish_reason:"stop"}:{})}],
   ...(finish?{usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5}}:{}),
  })+"\n\n"+(finish?"data: [DONE]\n\n":"");
  return new Response(new ReadableStream<Uint8Array>({
   start(controller){
    controller.enqueue(encoder.encode(frame("Synthetic visible text.",!holdStream)));
    if(!holdStream)controller.close();
   },
  }),{headers:{"Content-Type":"text/event-stream"}});
 });
 const manager=createSafeProviderSession({
  mode:"live",liveAuthorized:true,fetcher,gate,attachments:createAttachmentStore(),
 });
 active.push(manager);
 const snapshots=new WeakMap<object,ReturnType<typeof safeProviderSession.getSnapshot>>();
 vi.spyOn(safeProviderSession,"getSnapshot").mockImplementation(()=>{
  const state=manager.getSnapshot();let cached=snapshots.get(state);
  if(!cached){cached={...state,savedCredential:true,savedKeyVersion:"synthetic-vault-generation"};snapshots.set(state,cached);}
  return cached;
 });
 vi.spyOn(safeProviderSession,"subscribe").mockImplementation(manager.subscribe);
 vi.spyOn(safeProviderSession,"whenSettled").mockImplementation(manager.whenSettled);
 vi.spyOn(safeProviderSession,"updateContext").mockImplementation(manager.updateContext);
 vi.spyOn(safeProviderSession,"getSessionGeneration").mockImplementation(manager.getSessionGeneration);
 vi.spyOn(safeProviderSession,"close").mockImplementation(reason=>{log.push("session:close");manager.close(reason);});
 vi.spyOn(safeProviderSession,"closeAsync").mockImplementation(reason=>{log.push("session:closeAsync");return manager.closeAsync(reason);});
 vi.spyOn(safeProviderSession,"stop").mockImplementation(()=>{log.push("session:stop");manager.stop();});
 vi.spyOn(nativeProviderCredentials,"available").mockReturnValue(true);
 const saved={
  saved:true,version:"synthetic-vault-generation",mask:"********",
  providerVersion:{providerId:"deepseek",exists:true,generation:"synthetic-provider-generation",revision:1},
 } as const;
 const getCredential=vi.spyOn(nativeProviderCredentials,"get").mockResolvedValue(saved);
 const openSaved=vi.spyOn(safeProviderSession,"openSaved").mockImplementation(async(providerId,modelId)=>{
  log.push("open:start");expect(providerId).toBe("deepseek");expect(modelId).toBe(DEEPSEEK_MODEL);
  await opened.promise;manager.openAccount("synthetic-ui-only-memory-key");
  log.push("open:ready");return true;
 });
 const captures:Array<{
  draft:TaskDraft;current:()=>boolean;authorize:ReturnType<typeof manager.captureOrdinarySend>;
 }>=[];
 const runtime=createDesktopRuntimeAdapter({
  nativeInvoke:null,providerAdapter:manager.adapter,providerEnabled:true,
  captureOrdinarySend:(draft,current)=>{
   log.push("intent:capture");
   expect(manager.getSnapshot().ready).toBe(true);
   const authorize=manager.captureOrdinarySend(draft,current);
   captures.push({draft,current,authorize});return authorize;
  },
 });
 const realSubmit=runtime.submitTask.bind(runtime);
 const submit=vi.spyOn(runtime,"submitTask").mockImplementation(async(...args)=>{
  log.push("runtime:submit");return realSubmit(...args);
 });
 const approve=vi.spyOn(runtime,"submitApprovalDecision");
 const cancel=vi.spyOn(runtime,"cancelTask");
 let composer!:ReturnType<typeof useComposerActions>,projects!:ReturnType<typeof useProjectActions>,
  threads!:ReturnType<typeof useThreadActions>,composerState!:ComposerStoreState,
  projectId:string|null=null,activeThread:string|null=null,taskId:string|null=null;
 function Probe(){
  composer=useComposerActions();projects=useProjectActions();threads=useThreadActions();
  composerState=useComposerStore(state=>state);projectId=useProjectStore(state=>state.activeProjectId);
  activeThread=useThreadStore(state=>state.activeThreadId);taskId=useRuntimeStore(state=>state.activeTaskId);
  return null;
 }
 const view=render(<UIProvider runtimeClient={runtime} initialState={{
  provider:{providers:[createSupportedProvider()]},
  project:{activeProjectId:null},thread:{activeThreadId:threadId},
  composer:{selectedModelId:JSON.stringify(["deepseek",DEEPSEEK_MODEL]),taskMode:"discussion",input:"Original question."},
 }}><Probe/></UIProvider>);
 await act(async()=>{await Promise.resolve();});
 function draft(mode:"discussion"|"investigation"="discussion"):TaskDraft{
  return{
   input:composerState.input,projectId,providerId:"deepseek",modelId:DEEPSEEK_MODEL,
   taskMode:mode,permissionMode:"request_approval",reasoningEffort:composerState.reasoningEffort,
   runMode:"local",branch:null,contextPercent:null,
  };
 }
 function start(mode:"discussion"|"investigation"="discussion"){
  let pending!:Promise<string>;
  act(()=>{pending=composer.submitComposerTask(draft(mode));});
  // Attach immediately so a controlled failure cannot become an unhandled
  // rejection while the test changes state and releases its synthetic opener.
  const outcome=pending.then(value=>({value,error:null}),error=>({value:null,error}));
  return{pending,outcome};
 }
 async function release(){
  await act(async()=>{opened.resolve();await Promise.resolve();});
 }
 async function input(value:string){await act(async()=>{composer.setComposerInput(value);});}
 return{
  log,sent,gate,manager,fetcher,openSaved,getCredential,captures,runtime,submit,approve,cancel,
  start,release,input,view,composer:()=>composer,projects:()=>projects,threads:()=>threads,
  composerState:()=>composerState,projectId:()=>projectId,threadId:()=>activeThread,taskId:()=>taskId,
 };
}

describe("saved credential Send uses the real UI store critical section (no network)",()=>{
 it("opens inside this Send and reaches ready before capturing its one-use intent",async()=>{
  const h=await harness();
  expect(h.openSaved).not.toHaveBeenCalled();expect(h.submit).not.toHaveBeenCalled();
  const first=h.start();
  await waitFor(()=>expect(h.openSaved).toHaveBeenCalledTimes(1));
  expect(h.captures).toHaveLength(0);expect(h.submit).not.toHaveBeenCalled();
  expect(h.fetcher).not.toHaveBeenCalled();
  await h.release();
  await act(async()=>{expect((await first.outcome).error).toBeNull();});
  expect(h.log.indexOf("open:start")).toBeLessThan(h.log.indexOf("open:ready"));
  expect(h.log.indexOf("open:ready")).toBeLessThan(h.log.indexOf("intent:capture"));
  expect(h.log.indexOf("intent:capture")).toBeLessThan(h.log.indexOf("runtime:submit"));
  expect(h.log.indexOf("runtime:submit")).toBeLessThan(h.log.indexOf("synthetic:dispatch"));
  expect(h.sent).toHaveLength(1);expect(h.gate.getPending()).toBeNull();
 });

 it.each(["missing","corrupt","unavailable"] as const)("blocks a cached ready saved session after %s without a send intent",async(recovery)=>{
  const h=await harness(),first=h.start();await h.release();
  await act(async()=>{expect((await first.outcome).error).toBeNull();});
  const before={sent:h.sent.length,intents:h.captures.length,submits:h.submit.mock.calls.length};
  h.getCredential.mockResolvedValue({...await nativeProviderCredentials.get("deepseek"),saved:false,mask:null,recovery});
  await h.input("Must wait for explicit credential recovery.");
  const next=h.start();
  await act(async()=>{expect((await next.outcome).error).toMatchObject({message:"task_submission_failed"});});
  expect(h.sent).toHaveLength(before.sent);expect(h.captures).toHaveLength(before.intents);
  expect(h.submit).toHaveBeenCalledTimes(before.submits);
  expect(h.composerState().input).toBe("Must wait for explicit credential recovery.");
 });

 it.each([
  {name:"active",saved:true,mask:"********",recovery:null},
  {name:"recovery",saved:false,mask:null,recovery:"missing" as const},
  {name:"inactive",saved:false,mask:null,recovery:null},
 ])("blocks cached session in $name plus cleanup-pending state",async(state)=>{
  const h=await harness(),first=h.start();await h.release();
  await act(async()=>{expect((await first.outcome).error).toBeNull();});
  const before={sent:h.sent.length,intents:h.captures.length,submits:h.submit.mock.calls.length};
  h.getCredential.mockResolvedValue({...await nativeProviderCredentials.get("deepseek"),...state,cleanupPending:true});
  await h.input("Do not send before explicit cleanup succeeds.");
  const next=h.start();
  await act(async()=>{expect((await next.outcome).error).toMatchObject({message:"task_submission_failed"});});
  expect(h.sent).toHaveLength(before.sent);expect(h.captures).toHaveLength(before.intents);
  expect(h.submit).toHaveBeenCalledTimes(before.submits);
 });

 it("rejects a concurrent second submit during a slow opener without another task or intent",async()=>{
  const h=await harness(),first=h.start();
  await waitFor(()=>expect(h.openSaved).toHaveBeenCalledTimes(1));
  const second=h.start();
  expect((await second.outcome).error).toMatchObject({message:"submission_in_progress"});
  expect(h.openSaved).toHaveBeenCalledTimes(1);expect(h.captures).toHaveLength(0);
  await h.release();
  await act(async()=>{expect((await first.outcome).error).toBeNull();});
  expect(h.submit).toHaveBeenCalledTimes(1);expect(h.sent).toHaveLength(1);
  expect(h.captures).toHaveLength(1);expect(h.approve).not.toHaveBeenCalled();
 });

 it.each(["input","model","project","new-thread"] as const)(
  "drops this pending Send when %s changes while native saved-session open is waiting",async(kind)=>{
   const h=await harness(),first=h.start();
   await waitFor(()=>expect(h.openSaved).toHaveBeenCalledTimes(1));
   await act(async()=>{
    if(kind==="input")h.composer().setComposerInput("Edited while waiting.");
    if(kind==="model")await h.composer().setComposerModel("not-configured");
    if(kind==="project")await h.projects().setActiveProject("synthetic-other-project");
    if(kind==="new-thread")h.threads().setActiveThread(null);
   });
   await h.release();
   await act(async()=>{expect((await first.outcome).error).toMatchObject({message:"task_submission_failed"});});
   expect(h.captures).toHaveLength(0);expect(h.submit).not.toHaveBeenCalled();
   expect(h.fetcher).not.toHaveBeenCalled();expect(h.approve).not.toHaveBeenCalled();
   if(kind==="input")expect(h.composerState().input).toBe("Edited while waiting.");
   if(kind==="model")expect(h.composerState().selectedModelId).toBe("not-configured");
   if(kind==="project")expect(h.projectId()).toBe("synthetic-other-project");
   expect(h.composerState().submitting).toBe(false);
  },
 );

 it("a new-thread click also invalidates a pending Send from a previously selected thread",async()=>{
  const h=await harness({threadId:"synthetic-old-thread"}),first=h.start();
  await waitFor(()=>expect(h.openSaved).toHaveBeenCalledTimes(1));
  await act(async()=>{h.threads().setActiveThread(null);});
  await h.release();
  await act(async()=>{expect((await first.outcome).error).toMatchObject({message:"task_submission_failed"});});
  expect(h.threadId()).toBeNull();expect(h.submit).not.toHaveBeenCalled();expect(h.fetcher).not.toHaveBeenCalled();
 });

 it("an unavailable saved credential keeps input and does not capture, send or retry",async()=>{
  const h=await harness();
  h.openSaved.mockResolvedValueOnce(false);
  const first=h.start();
  await act(async()=>{expect((await first.outcome).error).toMatchObject({message:"task_submission_failed"});});
  expect(h.openSaved).toHaveBeenCalledTimes(1);
  expect(h.captures).toHaveLength(0);expect(h.submit).not.toHaveBeenCalled();
  expect(h.fetcher).not.toHaveBeenCalled();expect(h.composerState().input).toBe("Original question.");
  await act(async()=>{await Promise.resolve();await Promise.resolve();});
  expect(h.openSaved).toHaveBeenCalledTimes(1);
 });

 it("closing after a completed reply leaves the next task unopened until a fresh explicit Send",async()=>{
  const h=await harness(),first=h.start();await h.release();
  await act(async()=>{expect((await first.outcome).error).toBeNull();await safeProviderSession.closeAsync("cleared");});
  const before={open:h.openSaved.mock.calls.length,sent:h.sent.length};
  await h.input("A different question after close.");
  await act(async()=>{h.threads().setActiveThread(null);await Promise.resolve();});
  expect(h.openSaved).toHaveBeenCalledTimes(before.open);expect(h.sent).toHaveLength(before.sent);
  const next=h.start();
  await act(async()=>{expect((await next.outcome).error).toBeNull();});
  expect(h.openSaved).toHaveBeenCalledTimes(before.open+1);
  expect(h.sent).toHaveLength(before.sent+1);expect(h.captures).toHaveLength(2);
  expect(h.captures[0].authorize).not.toBe(h.captures[1].authorize);
 });

 it("Stop closes only the active synthetic session; another Send opens again without auto-dispatch",async()=>{
  const h=await harness({holdStream:true}),first=h.start();await h.release();
  await waitFor(()=>expect(h.sent).toHaveLength(1));
  await waitFor(()=>expect(h.taskId()).not.toBeNull());
  await act(async()=>{await h.composer().cancelRuntimeTask(h.taskId()!);await first.outcome;});
  expect(h.manager.getSnapshot().ready).toBe(false);
  expect(h.openSaved).toHaveBeenCalledTimes(1);
  await h.input("Retry only when I explicitly send.");
  await act(async()=>{await Promise.resolve();await Promise.resolve();});
  expect(h.openSaved).toHaveBeenCalledTimes(1);expect(h.sent).toHaveLength(1);
  const next=h.start();
  await waitFor(()=>expect(h.sent).toHaveLength(2));
  expect(h.openSaved).toHaveBeenCalledTimes(2);
  await act(async()=>{await h.composer().cancelRuntimeTask(h.taskId()!);await next.outcome;});
  expect(h.approve).not.toHaveBeenCalled();
 });

 it("saved metadata does not bypass project scope or implicitly approve investigation tools",async()=>{
  const h=await harness();
  const first=h.start("investigation");
  await act(async()=>{expect((await first.outcome).error).toMatchObject({message:"task_submission_failed"});});
  expect(h.openSaved).not.toHaveBeenCalled();expect(h.submit).not.toHaveBeenCalled();
  expect(h.fetcher).not.toHaveBeenCalled();expect(h.approve).not.toHaveBeenCalled();
 });

 it("the actual captured ordinary intent rejects an injected tool-bearing provider request",async()=>{
  const h=await harness();
  h.submit.mockImplementationOnce(async(draft,options)=>{
   expect(h.captures).toHaveLength(1);expect(h.captures[0].current()).toBe(true);
   expect(options?.authorizeOrdinarySend).toBe(h.captures[0].authorize);
   const injected:ProviderRuntimeRequest={
    id:"synthetic-unapproved-tool-call",providerId:"deepseek",modelId:DEEPSEEK_MODEL,
    reasoningEffort:draft.reasoningEffort as ProviderRuntimeRequest["reasoningEffort"],messages:[
     {role:"system",content:"Synthetic ordinary system."},
     {role:"developer",content:"Synthetic ordinary instruction."},
     {role:"user",content:draft.input+"\n\nNo tool execution is enabled by this request."},
    ],metadata:{projectId:draft.projectId,conversationId:draft.conversationId},
    tools:[{name:"unapproved_tool",description:"Must stay unapproved.",parameters:{type:"object"}}],
   };
   expect(()=>options!.authorizeOrdinarySend!(injected,true)).toThrow("ordinary_send_snapshot_changed");
   throw Error("Synthetic malicious request rejected.");
  });
  const first=h.start();await h.release();
  await act(async()=>{expect((await first.outcome).error).toMatchObject({message:"task_submission_failed"});});
  expect(h.fetcher).not.toHaveBeenCalled();expect(h.approve).not.toHaveBeenCalled();
  expect(h.gate.getPending()).toBeNull();
 });
});
