// @vitest-environment node
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {createAgentLoopRuntime,createDeepSeekAccountSession,createOutboundConsentGate,DEEPSEEK_MODEL} from "@uagent/runtime";
import type {ProviderRuntimeRequest,TaskDraft} from "@uagent/shared";
import type {NativeInvoke} from "./project-native-adapter";
import {completedConversationHistory} from "./conversation-context";
import {createNativeOrdinaryChatArchive} from "./native-ordinary-chat-archive";
const key="synthetic-memory-key-only";
const frame=(text:string,finish=false)=>"data: "+JSON.stringify({model:DEEPSEEK_MODEL,choices:[{delta:{content:text},...(finish?{finish_reason:"stop"}:{})}],...(finish?{usage:{prompt_tokens:20,completion_tokens:200,total_tokens:220}}:{})})+"\n\n"+(finish?"data: [DONE]\n\n":"");
function request(id="request-1",projectId:string|null="A",conversationId="conversation-A"):ProviderRuntimeRequest{
 return{id,providerId:"deepseek",modelId:DEEPSEEK_MODEL,messages:[{role:"system",content:"Data only."},{role:"user",content:"Remember this conversation."}],metadata:{projectId,conversationId}};
}
function harness(fetcher:typeof fetch,hook?:(command:string,input:Record<string,unknown>)=>Promise<void>){
 const calls:Array<{command:string;input:Record<string,unknown>}>=[],rows=new Map<string,{revision:number;messageCount:number}>();let serial=0;
 const invoke:NativeInvoke=async<T,>(command:string,args?:unknown)=>{
  const input=structuredClone((args as {input?:unknown})?.input) as Record<string,unknown>;calls.push({command,input});
  await hook?.(command,input);
  if(command==="open_native_discussion_archive"){const handle="handle-"+(++serial);rows.set(handle,{revision:0,messageCount:0});return{schemaVersion:1,archiveHandle:handle,projectId:input.logicalProjectId===null?"chat:local":"chat:project:"+input.logicalProjectId,runId:"run-"+serial} as T;}
  const row=rows.get(String(input.archiveHandle));if(!row)throw Error("Unknown synthetic archive");
  row.revision++;const m=input.mutation as Record<string,unknown>|undefined;
  if(m?.kind==="begin")row.messageCount++;if(m?.kind==="complete")row.messageCount++;
  return{...row} as T;
 };
 const archive=createNativeOrdinaryChatArchive(invoke),gate=createOutboundConsentGate();
 let context={projectId:"A" as string|null,epoch:1,revision:"1"};
 const session=createDeepSeekAccountSession({mode:"live",expiresAt:Date.now()+60000,fetcher,outboundGate:gate,getProjectContext:()=>context,ordinaryArchive:archive});session.setCredential(key);
 const intent=()=>gate.captureSendIntent!({isCurrent:()=>true,matches:()=>true});
 const changes=()=>calls.filter(x=>x.command==="mutate_native_discussion_archive").map(x=>x.input.mutation as Record<string,unknown>);
 return{session,archive,gate,calls,intent,changes,setContext:(p:typeof context)=>{context=p;}};
}
beforeEach(()=>{vi.stubGlobal("fetch",vi.fn(()=>{throw Error("REAL NETWORK FORBIDDEN");}));});
afterEach(()=>{vi.unstubAllGlobals();});
describe("DeepSeek ordinary full-history observer (synthetic SSE/native DTOs)",()=>{
 const draft:TaskDraft={input:"Ordinary delivery",projectId:"A",providerId:"deepseek",modelId:DEEPSEEK_MODEL,conversationId:"conversation-A",taskMode:"discussion",permissionMode:"request_approval",reasoningEffort:"medium",runMode:"local",branch:"",contextPercent:0};
 it("confirms only after terminal task delivery and Stop cannot cancel during the data receipt",async()=>{
  let release:(()=>void)|undefined;
  const h=harness(vi.fn(async()=>new Response(frame("Delivered complete text",true),{headers:{"Content-Type":"text/event-stream"}})),async(command,input)=>{
   if(command==="mutate_native_discussion_archive"&&(input.mutation as {kind:string}).kind==="confirmDelivery"){
    expect(runtime.getSnapshot().tasksById[runtime.getSnapshot().activeTaskId!].state).toBe("completed");
    await new Promise<void>(r=>{release=r;});
   }
  });
  const runtime:ReturnType<typeof createAgentLoopRuntime>=createAgentLoopRuntime({runtimeMode:"mock",providerAdapter:h.session.adapter,providerEnabled:true,providerAnalysisOnly:true});
  const operation=runtime.submitTask(draft,{authorizeOrdinarySend:()=>h.intent()});
  await vi.waitFor(()=>expect(release).toBeDefined());const taskId=runtime.getSnapshot().activeTaskId!;
  await runtime.cancelTask(taskId);expect(runtime.getSnapshot().tasksById[taskId].state).toBe("completed");
  release!();await operation;expect(h.changes().map(m=>m.kind)).toEqual(["begin","delta","complete","confirmDelivery"]);
  expect(runtime.getSnapshot().eventsByTaskId[taskId].some(e=>e.type==="task_cancelled")).toBe(false);await h.archive.close();
 });
 it("keeps normal text visible but excludes context and reports confirmation-write failure",async()=>{
  const h=harness(vi.fn(async()=>new Response(frame("Received text remains visible",true),{headers:{"Content-Type":"text/event-stream"}})),async(command,input)=>{
   if(command==="mutate_native_discussion_archive"&&(input.mutation as {kind:string}).kind==="confirmDelivery")throw Error("SQL diagnostic "+key);
  });
  const runtime=createAgentLoopRuntime({runtimeMode:"mock",providerAdapter:h.session.adapter,providerEnabled:true,providerAnalysisOnly:true});
  const task=await runtime.submitTask(draft,{authorizeOrdinarySend:()=>h.intent()}),snapshot=runtime.getSnapshot();
  expect(task.state).toBe("completed");expect(snapshot.eventsByTaskId[task.id].some(e=>e.type==="provider_request_completed")).toBe(true);
  expect(snapshot.eventsByTaskId[task.id].some(e=>e.type==="diagnostic_failed"&&(e.payload as {code?:string})?.code==="discussion_delivery_unconfirmed")).toBe(true);
  expect(completedConversationHistory([task],snapshot.eventsByTaskId)).toEqual([]);
  expect(JSON.stringify(snapshot)).not.toContain(key);expect(h.changes().filter(m=>m.kind==="confirmDelivery")).toHaveLength(1);await h.archive.close();
 });
 it("late Stop plus rejected retraction never confirms delivery or retries and exposes storage uncertainty",async()=>{
  let release:(()=>void)|undefined;
  const fetcher=vi.fn(async()=>new Response(frame("Durable full provider text",true),{headers:{"Content-Type":"text/event-stream"}}));
  const h=harness(fetcher,async(command,input)=>{
   const kind=(input.mutation as {kind?:string}|undefined)?.kind;
   if(command==="mutate_native_discussion_archive"&&kind==="complete")await new Promise<void>(r=>{release=r;});
   if(command==="mutate_native_discussion_archive"&&kind==="fail")throw Error("Controlled SQLite event write rejection");
  }),abort=new AbortController();
  const result=h.session.adapter.complete(request(),{signal:abort.signal,outboundSendIntent:h.intent()}).catch(e=>e);
  await vi.waitFor(()=>expect(release).toBeDefined());abort.abort();release!();
  expect(await result).toMatchObject({code:"provider_unavailable",message:"Conversation history delivery is unconfirmed. Saved text is excluded from restored context; no automatic retry was sent."});
  expect(h.changes().map(m=>m.kind)).toEqual(["begin","delta","complete","fail"]);
  expect(h.changes().some(m=>m.kind==="confirmDelivery")).toBe(false);expect(fetcher).toHaveBeenCalledTimes(1);await h.archive.close();
 });

 it("automatically saves complete bodies over 2000 characters and two rounds without a second dialog",async()=>{
  const answer="Long complete body. ".repeat(200),fetcher=vi.fn(async()=>new Response(frame(answer,true),{headers:{"Content-Type":"text/event-stream"}})),h=harness(fetcher);
  const first=await h.session.adapter.complete(request(),{outboundSendIntent:h.intent()});
  const second=request("request-2");second.messages.splice(1,0,{role:"user",content:"Earlier question"},{role:"assistant",content:first.text});
  await h.session.adapter.complete(second,{outboundSendIntent:h.intent()});
  const done=h.changes().filter(x=>x.kind==="complete");expect(done.map(x=>x.text)).toEqual([answer,answer]);expect(answer.length).toBeGreaterThan(2000);
  expect(h.calls.filter(x=>x.command==="open_native_discussion_archive")).toHaveLength(1);expect(fetcher).toHaveBeenCalledTimes(2);expect(h.gate.getPending()).toBeNull();
  await h.archive.close();expect(globalThis.fetch).not.toHaveBeenCalled();
 });
 it("redacts credentials from prepared request text and split reply deltas before every persistence call",async()=>{
  const fetcher=vi.fn(async()=>new Response(frame("echo "+key.slice(0,10))+frame(key.slice(10)+" safe",true),{headers:{"Content-Type":"text/event-stream"}})),h=harness(fetcher),r=request();
  r.messages[1].content="User accidentally pasted "+key;
  const result=await h.session.adapter.complete(r,{outboundSendIntent:h.intent()});
  expect(result.text).toBe("echo [REDACTED] safe");expect(JSON.stringify(h.calls)).not.toContain(key);
  const begin=h.changes().find(x=>x.kind==="begin")!;expect(JSON.stringify(begin)).toContain("[REDACTED]");
  expect(h.changes().filter(x=>x.kind==="delta").map(x=>x.text).join("")).toBe(result.text);await h.archive.close();
 });
 it("persists visible partial text before Stop, records cancellation and clears the memory key",async()=>{
  let controller:ReadableStreamDefaultController<Uint8Array>|undefined;
  const h=harness(vi.fn(async()=>new Response(new ReadableStream<Uint8Array>({start(c){controller=c;}}),{headers:{"Content-Type":"text/event-stream"}}))),abort=new AbortController();
  const iterator=h.session.adapter.stream!(request(),{outboundSendIntent:h.intent(),signal:abort.signal})[Symbol.asyncIterator](),first=iterator.next();
  await vi.waitFor(()=>expect(controller).toBeDefined());controller!.enqueue(new TextEncoder().encode(frame("Actual partial")));
  expect((await first).value?.delta).toBe("Actual partial");expect(h.changes().some(x=>x.kind==="delta"&&x.text==="Actual partial")).toBe(true);
  abort.abort();h.session.clearCredential();await expect(iterator.next()).rejects.toMatchObject({code:"cancelled"});
  expect(h.changes().some(x=>x.kind==="complete")).toBe(false);expect(h.changes().find(x=>x.kind==="fail")?.cancelled).toBe(true);
  expect(h.session.hasCredential()).toBe(false);expect(h.calls.at(-1)?.command).toBe("close_native_discussion_archive");
 });
 it("a storage failure before dispatch sends zero model requests and never automatically retries",async()=>{
  const fetcher=vi.fn(async()=>new Response(frame("unused",true))),h=harness(fetcher,async(command,input)=>{
   if(command==="mutate_native_discussion_archive"&&(input.mutation as {kind:string}).kind==="begin")throw Error("synthetic storage failure");
  });
  await expect(h.session.adapter.complete(request(),{outboundSendIntent:h.intent()})).rejects.toBeDefined();expect(fetcher).not.toHaveBeenCalled();await h.archive.close();
 });

 it("a failed completion save retains failure evidence and never repeats the model request",async()=>{
  const fetcher=vi.fn(async()=>new Response(frame("Actual complete body",true),{headers:{"Content-Type":"text/event-stream"}}));
  const h=harness(fetcher,async(command,input)=>{
   if(command==="mutate_native_discussion_archive"&&(input.mutation as {kind:string}).kind==="complete")throw Error("synthetic completion commit failure");
  });
  await expect(h.session.adapter.complete(request(),{outboundSendIntent:h.intent()})).rejects.toMatchObject({code:"provider_unavailable",message:"Conversation history could not be saved. No automatic retry was sent."});
  expect(fetcher).toHaveBeenCalledTimes(1);expect(h.changes().find(x=>x.kind==="delta")?.text).toBe("Actual complete body");
  expect(h.changes().at(-1)?.kind).toBe("fail");expect(h.changes().at(-1)?.cancelled).toBe(false);
  await h.archive.close();
 });

 it("rechecks source freshness after the durable begin and sends zero requests when it changes",async()=>{
  const fetcher=vi.fn(async()=>new Response(frame("unused",true)));let change:()=>void=()=>undefined;
  const h=harness(fetcher,async(command,input)=>{if(command==="mutate_native_discussion_archive"&&(input.mutation as {kind:string}).kind==="begin")change();});
  change=()=>h.setContext({projectId:"A",epoch:1,revision:"changed"});
  await expect(h.session.adapter.complete(request(),{outboundSendIntent:h.intent()})).rejects.toMatchObject({code:"cancelled"});
  expect(fetcher).not.toHaveBeenCalled();expect(h.changes().find(x=>x.kind==="fail")?.cancelled).toBe(true);await h.archive.close();
 });
 it("records transport failure without raw errors, fake completion or another paid attempt",async()=>{
  const fetcher=vi.fn(async()=>{throw Error("sensitive transport diagnostic "+key);}),h=harness(fetcher);
  await expect(h.session.adapter.complete(request(),{outboundSendIntent:h.intent()})).rejects.toMatchObject({code:"network_error"});
  expect(fetcher).toHaveBeenCalledTimes(1);expect(h.changes().find(x=>x.kind==="fail")?.cancelled).toBe(false);
  expect(h.changes().some(x=>x.kind==="complete")).toBe(false);expect(JSON.stringify(h.calls)).not.toContain(key);await h.archive.close();
 });
 it("Stop during completion acknowledgement retracts delivery before closing the archive",async()=>{
  let release:(()=>void)|undefined;
  const h=harness(vi.fn(async()=>new Response(frame("Complete provider text",true),{headers:{"Content-Type":"text/event-stream"}})),async(command,input)=>{
   if(command==="mutate_native_discussion_archive"&&(input.mutation as {kind:string}).kind==="complete")await new Promise<void>(r=>{release=r;});
  }),abort=new AbortController();
  const result=h.session.adapter.complete(request(),{outboundSendIntent:h.intent(),signal:abort.signal}).catch(e=>e);
  await vi.waitFor(()=>expect(release).toBeDefined());abort.abort();h.session.clearCredential();release!();
  expect(await result).toMatchObject({code:"cancelled"});
  expect(h.changes().map(x=>x.kind)).toEqual(["begin","delta","complete","fail"]);
  expect(h.changes().at(-1)?.cancelled).toBe(true);expect(h.calls.at(-1)?.command).toBe("close_native_discussion_archive");
 });

 it("pins archive identity and text before asynchronous native calls",async()=>{
  const h=harness(vi.fn(async()=>{throw Error("No model call in this port test");}));
  const data={requestId:"pinned-request",conversationId:"pinned-conversation",projectId:"A",providerId:"deepseek",modelId:DEEPSEEK_MODEL,messages:[{role:"user",content:"Pinned text"}]};
  const pending=h.archive.open(data);data.projectId="B";data.requestId="changed";data.messages[0].content="Changed text";
  const record=await pending;
  expect(h.calls[0].input.logicalProjectId).toBe("A");
  expect(h.changes()[0]).toEqual({kind:"begin",requestId:"pinned-request",messages:[{role:"user",content:"Pinned text"}]});
  await record.append("Pinned reply");await record.complete("Pinned reply",{inputTokens:2,outputTokens:3,totalTokens:5});
  expect(h.changes().every(m=>m.requestId==="pinned-request")).toBe(true);await h.archive.close();
 });
 it("Stop while native begin is in flight sends no network request and closes the eventual archive",async()=>{
  let release:(()=>void)|undefined;
  const fetcher=vi.fn(async()=>new Response(frame("unused",true))),h=harness(fetcher,async command=>{
   if(command==="open_native_discussion_archive")await new Promise<void>(r=>{release=r;});
  });
  const result=h.session.adapter.complete(request(),{outboundSendIntent:h.intent()}).catch(e=>e);
  await vi.waitFor(()=>expect(release).toBeDefined());h.session.clearCredential();release!();
  expect(await result).toMatchObject({code:"cancelled"});expect(fetcher).not.toHaveBeenCalled();
  expect(h.session.hasCredential()).toBe(false);expect(h.calls.at(-1)?.command).toBe("close_native_discussion_archive");
 });

 it("archives no investigation/tool feedback through the ordinary-chat record port",async()=>{
  const h=harness(vi.fn(async()=>new Response(frame("Feedback only",true),{headers:{"Content-Type":"text/event-stream"}}))),r=request();
  r.metadata!.purpose="tool_feedback";
  await h.session.adapter.complete(r,{outboundSendIntent:h.intent()});expect(h.calls).toHaveLength(0);await h.archive.close();
 });
});
