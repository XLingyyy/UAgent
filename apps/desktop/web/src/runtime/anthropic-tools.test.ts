// @vitest-environment node
import {it,expect,vi,afterEach} from "vitest";
import {webcrypto,createHash} from "node:crypto";
import {createOutboundConsentGate,RunScopeAuthority,RunCoordinator} from "@uagent/runtime";
import {anthropicBody} from "../../../../../packages/runtime/src/provider/anthropic-protocol";
import {createSafeProviderSession} from "./safe-provider-session";
import {createProjectReadToolRegistry} from "./project-read-tools";
import {collaborationSessions,createCollaborationMemberAdapter} from "./collaboration-sessions";
import type {NativeInvoke,NativeProjectAdapter} from "./project-native-adapter";
import type {ProviderRuntimeRequest,TaskDraft,RunStoreCommit} from "@uagent/shared";
vi.stubGlobal("crypto",webcrypto);
const endpoint="https://api.anthropic.com/v1/messages",provider="claude-synthetic",model="claude-mock-model",projectId="root:synthetic-tools";
const managers:ReturnType<typeof createSafeProviderSession>[]=[];
afterEach(async()=>{for(const m of managers.splice(0)){m.dispose();await m.whenSettled();}});
const use={role:"assistant" as const,content:"",toolCalls:[{id:"toolu_a",name:"project_read_file",arguments:'{"path":"Source/A.cpp"}'},{id:"toolu_b",name:"project_read_file",arguments:'{"path":"Source/B.cpp"}'}]};
const result=(id:string,status="completed")=>({role:"tool" as const,toolCallId:id,content:JSON.stringify({callId:id,toolId:"project.read_file",status,effectState:"not_started",sources:[],output:"synthetic",truncated:false})});
const request=(messages:ProviderRuntimeRequest["messages"]):ProviderRuntimeRequest=>({id:"r",providerId:provider,modelId:model,messages});
it("groups all paired results in the next user message and signals matching tool failure",()=>{
 const body=anthropicBody(request([{role:"user",content:"inspect"},use,result("toolu_a"),result("toolu_b","failed")]),true);
 expect(body.messages).toHaveLength(3);expect(body.messages[2]).toMatchObject({role:"user",content:[{type:"tool_result",tool_use_id:"toolu_a"},{type:"tool_result",tool_use_id:"toolu_b",is_error:true}]});
});
it.each([
 [result("toolu_a")],
 [use,result("toolu_a")],
 [use,result("toolu_a"),result("toolu_a"),result("toolu_b")],
 [use,{role:"user" as const,content:"gap"},result("toolu_a"),result("toolu_b")],
])("rejects orphan, missing, duplicate or interrupted tool history before sending: %#",(...messages)=>{expect(()=>anthropicBody(request(messages),false)).toThrow();});
function sse(answer:any){const events:any[]=[{type:"message_start",message:{...answer,content:[],stop_reason:null}}];answer.content.forEach((block:any,index:number)=>{events.push({type:"content_block_start",index,content_block:block.type==="text"?{type:"text",text:""}:{...block,input:{}}});const payload=block.type==="text"?{type:"text_delta",text:block.text}:{type:"input_json_delta",partial_json:JSON.stringify(block.input)};events.push({type:"content_block_delta",index,delta:payload},{type:"content_block_stop",index});});events.push({type:"message_delta",delta:{stop_reason:answer.stop_reason},usage:{output_tokens:2}},{type:"message_stop"});return events.map(e=>"data: "+JSON.stringify(e)+"\n\n").join("");}
async function setup(role:"investigator"|"reviewer",cancelSecond=false,failRead=false,incomplete=false){
 const gate=createOutboundConsentGate(),bodies:any[]=[],approvals:string[]=[],dispatched:string[]=[],calls:string[]=[],commits:RunStoreCommit[]=[];const wire=new Map<string,{body:any,index:number}>();
 const invoke:NativeInvoke=async<T>(command:string,payload?:unknown)=>{const input=(payload as any)?.input;calls.push(command);let value:any=null;
  if(command==="open_native_responses_profile")value={profileId:"profile-"+role,providerId:provider,modelId:model,endpoint,fixture:false,expiresAt:Date.now()+60000,modelSettings:{supportsReasoning:false,requestDefaults:{temperature:null,maxOutputTokens:null}},nativeProjectMemoryDispatch:false};
  if(command==="bind_native_responses_run")value={runHandle:"native-"+role,owner:{providerId:provider,modelId:model,projectId,projectEpoch:1,runId:input.runId,conversationId:"conversation"}};
  if(command==="prepare_native_responses_request"){const body=JSON.parse(input.body);const id="native-request-"+bodies.length;wire.set(id,{body,index:bodies.length});bodies.push(body);value={requestId:id,endpoint,modelId:model,bodySha256:createHash("sha256").update(input.body).digest("hex")};}
  if(command==="dispatch_native_responses_request")dispatched.push(input.requestId);
  if(command==="poll_native_responses_request"){const current=wire.get(input.requestId)!;const content=current.index===0?use.toolCalls.map(t=>({type:"tool_use",id:t.id,name:t.name,input:JSON.parse(t.arguments)})):[{type:"text",text:"Synthetic final report"}];const answer={type:"message",role:"assistant",id:"msg_"+current.index,model,content,stop_reason:current.index===0?"tool_use":"end_turn",usage:{input_tokens:3,output_tokens:2}};const text=sse(answer);const sent=incomplete&&current.index===0?text.slice(0,text.lastIndexOf("data: ")):text;value={cursor:input.cursor,nextCursor:input.cursor+1,chunks:[Array.from(new TextEncoder().encode(sent))],head:{status:200,contentType:"text/event-stream"},done:true,error:null,dispatchStatus:"sent"};}
  return value as T;
 };
 const external=vi.fn(()=>{throw Error("external fetch forbidden");});const manager=createSafeProviderSession({mode:"live",liveAuthorized:true,nativeInvoke:invoke,gate,fetcher:external});managers.push(manager);manager.updateContext(projectId,"investigation",model,"conversation");await manager.openResponses(provider,model,"synthetic-only-credential","anthropic");
 const lease=new RunScopeAuthority().approve({id:"scope-"+role,runId:"run-"+role,projectId,conversationId:"conversation",rootRef:"synthetic-root",providerId:provider,modelId:model,endpoint,mode:"read_only",readPrefixes:["Source"],sharePrefixes:["Source"],toolIds:["project.read_file"],limits:{maxToolCalls:3,maxModelRequests:3,maxDurationMs:60000,maxAttemptsPerFailure:1,maxToolResultBytes:8192,maxContextBytes:24576},expiresAt:Date.now()+60000},()=>manager.getSnapshot().ready);
 const draft={input:"Investigate both synthetic files",taskMode:"investigation",projectId,conversationId:"conversation",providerId:provider,modelId:model,investigationScopeId:lease.scope.id} as TaskDraft;
 const original=collaborationSessions[role];collaborationSessions[role]=manager;
 const adapter=createCollaborationMemberAdapter(role,lease,{...draft,collaborationMembers:{[role]:{role:"source_analyst",focus:"synthetic",model:{providerId:provider,modelId:model,endpoint}}}} as TaskDraft);collaborationSessions[role]=original;
 const previews=vi.fn(async(pid:string,_root:string,path:string)=>{if(failRead&&path.endsWith("B.cpp"))throw Error("synthetic read failure");return {projectId:pid,rootRelativePath:path,status:"ready",content:"int synthetic = 1;",createdAt:Date.now(),redaction:{redacted:false},truncation:{truncated:false,originalBytes:18,originalLines:1}};});
 const registry=createProjectReadToolRegistry({source:"fixture",getProject:()=>({id:projectId,trustState:"trusted",rootRef:"synthetic-root"}),previewFile:previews} as unknown as NativeProjectAdapter,{allowFixture:true});
 const coordinator=new RunCoordinator({adapter,lease,registry,contextSources:{validate:async()=>true},store:{commit:async c=>{commits.push(c);}}});
 const seen=new Set<number>();gate.subscribe(()=>{const review=gate.getPending();if(!review||seen.has(review.id))return;seen.add(review.id);approvals.push(review.envelope.body);queueMicrotask(()=>{if(cancelSecond&&approvals.length===2)coordinator.cancel();else gate.approve(review.id);});});
 const outcome=await coordinator.start("synthetic-task",draft);
 return {outcome,bodies,approvals,dispatched,calls,previews,commits,external};
}
it.each(["investigator","reviewer"] as const)("%s Claude member completes streamed tools -> actual read registry -> paired results -> saved report",async role=>{
 const h=await setup(role);expect(h.outcome.run.status).toBe("completed");expect(h.outcome.text).toContain("Synthetic final report");expect(h.previews).toHaveBeenCalledTimes(2);expect(h.bodies).toHaveLength(2);expect(h.dispatched).toHaveLength(2);
 const followup=h.bodies[1].messages.at(-1);expect(followup.role).toBe("user");expect(followup.content.filter((b:any)=>b.type==="tool_result").map((b:any)=>b.tool_use_id)).toEqual(["toolu_a","toolu_b"]);expect(followup.content.slice(0,2).every((b:any)=>b.type==="tool_result")).toBe(true);expect(followup.content.slice(2).every((b:any)=>b.type==="text")).toBe(true);
 expect(h.approvals.map(JSON.parse)).toEqual(h.bodies);expect(h.commits.at(-1)?.run.status).toBe("completed");expect(h.external).not.toHaveBeenCalled();expect(h.calls).not.toContain("complete_native_anthropic_chat");
});
it("failed read is returned as is_error without losing the other result",async()=>{const h=await setup("investigator",false,true);expect(h.outcome.run.status).toBe("completed");expect(h.bodies[1].messages.at(-1).content[1].is_error).toBe(true);expect(h.previews).toHaveBeenCalledTimes(2);});
it("cancellation during follow-up approval sends no tool-result request",async()=>{const h=await setup("reviewer",true);expect(h.outcome.run.status).toBe("cancelled");expect(h.dispatched).toHaveLength(1);expect(h.previews).toHaveBeenCalledTimes(2);expect(h.external).not.toHaveBeenCalled();});
it("an unfinished Claude tool stream never executes the accumulated calls",async()=>{const h=await setup("investigator",false,false,true);expect(h.outcome.run.status).toBe("failed");expect(h.outcome.run.stopReason).toBe("provider_failed");expect(h.previews).not.toHaveBeenCalled();expect(h.dispatched).toHaveLength(1);});
