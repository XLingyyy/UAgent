// @vitest-environment node
import {it,expect,vi,afterEach} from "vitest";
import {webcrypto,createHash} from "node:crypto";
import {createSafeProviderSession} from "./safe-provider-session";
import {createOutboundConsentGate} from "@uagent/runtime";
import type {NativeInvoke} from "./project-native-adapter";
import {anthropicBody,AnthropicEvents} from "../../../../../packages/runtime/src/provider/anthropic-protocol";
const endpoint="https://api.anthropic.com/v1/messages",model="claude-test-model",provider="configured-claude";
vi.stubGlobal("crypto",webcrypto);
const managers:ReturnType<typeof createSafeProviderSession>[]=[];
afterEach(async()=>{for(const m of managers.splice(0)){m.dispose();await m.whenSettled();}});
function harness(stream=false,model="claude-test-model",provider="configured-claude"){
 const gate=createOutboundConsentGate(),calls:{command:string;input:any}[]=[];let prepared="",sent=false;
 const result={id:"msg_synthetic",model,type:"message",role:"assistant",content:[{type:"text",text:"synthetic answer"}],stop_reason:"end_turn",usage:{input_tokens:3,output_tokens:2}};
 const events=[{type:"message_start",message:{...result,content:[],stop_reason:null}}, {type:"content_block_start",index:0,content_block:{type:"text",text:""}}, {type:"content_block_delta",index:0,delta:{type:"text_delta",text:"synthetic answer"}}, {type:"content_block_stop",index:0},{type:"message_delta",delta:{stop_reason:"end_turn"},usage:{output_tokens:2}},{type:"message_stop"}];
 const invoke:NativeInvoke=async<T>(command:string,payload?:unknown)=>{const input=(payload as any).input;calls.push({command,input});let value:any=null;
 if(command==="open_native_responses_profile")value={profileId:"profile",providerId:provider,modelId:model,endpoint,fixture:false,expiresAt:Date.now()+60000,modelSettings:{supportsReasoning:false,requestDefaults:{temperature:null,maxOutputTokens:null}},nativeProjectMemoryDispatch:false};
 else if(command==="bind_native_responses_conversation")value={runHandle:"chat",owner:{providerId:provider,modelId:model,projectId:"chat:local",projectEpoch:1,runId:"run",conversationId:"conversation"}};
 else if(command==="bind_native_responses_run")value={runHandle:"investigation",owner:{providerId:provider,modelId:model,projectId:input.projectId,projectEpoch:1,runId:input.runId,conversationId:"conversation"}};
 else if(command==="prepare_native_responses_request"){prepared=input.body;value={requestId:"request",endpoint,modelId:model,bodySha256:createHash("sha256").update(prepared).digest("hex")};}
 else if(command==="dispatch_native_responses_request"){sent=true;}
 else if(command==="poll_native_responses_request")value={cursor:input.cursor,nextCursor:input.cursor+1,chunks:[Array.from(new TextEncoder().encode(stream?events.map(e=>"data: "+JSON.stringify(e)+"\n\n").join(""):JSON.stringify(result)))],head:{status:200,contentType:stream?"text/event-stream":"application/json"},done:true,error:null,dispatchStatus:"sent"};
 return value as T;};
 const fallback=vi.fn(()=>{throw Error("unexpected external fetch");});
 const manager=createSafeProviderSession({mode:"live",liveAuthorized:true,nativeInvoke:invoke,gate,fetcher:fallback});managers.push(manager);manager.updateContext(null,"question",model,"conversation");
 const request={id:"logical",providerId:provider,modelId:model,messages:[{role:"user" as const,content:"synthetic question"}],metadata:{projectId:null,conversationId:"conversation"}};
 return {manager,gate,calls,request,fallback,get prepared(){return prepared;},get sent(){return sent;}};
}
it("Claude complete waits for exact-body approval and archives through native receipt",async()=>{
 const h=harness();await h.manager.openResponses(provider,model,"synthetic-only-key", "anthropic");
 const pending=h.manager.adapter.complete(h.request);await vi.waitFor(()=>expect(h.gate.getPending()).not.toBeNull());
 expect(h.sent).toBe(false);expect(JSON.parse(h.gate.getPending()!.envelope.body)).toMatchObject({model,max_tokens:1024});
 h.gate.approve(h.gate.getPending()!.id);const result=await pending;
 expect(result.text).toBe("synthetic answer");expect(h.calls.find(c=>c.command==="complete_native_anthropic_chat")?.input).toMatchObject({requestId:"logical",responseId:"msg_synthetic",text:"synthetic answer"});
 expect(h.fallback).not.toHaveBeenCalled();expect(h.prepared).not.toContain("synthetic-only-key");
 expect(h.calls.some(c=>c.command==="save_native_provider_continuation")).toBe(false);
});
it("Claude streams text then saves before yielding terminal success",async()=>{
 const h=harness(true);await h.manager.openResponses(provider,model,"synthetic-only-key","anthropic");h.gate.subscribe(()=>{const p=h.gate.getPending();if(p)queueMicrotask(()=>h.gate.approve(p.id));});
 const chunks=[];for await(const chunk of h.manager.adapter.stream!(h.request)){if(chunk.done)expect(h.calls.some(c=>c.command==="complete_native_anthropic_chat")).toBe(true);chunks.push(chunk);}
 expect(chunks.map(c=>c.delta).join("")).toBe("synthetic answer");expect(chunks.at(-1)).toMatchObject({done:true,usage:{inputTokens:3,outputTokens:2,totalTokens:5}});
});
it("cancel while awaiting approval sends nothing",async()=>{
 const h=harness();await h.manager.openResponses(provider,model,"synthetic-only-key","anthropic");const abort=new AbortController();const result=h.manager.adapter.complete(h.request,{signal:abort.signal});const rejected=expect(result).rejects.toBeDefined();await vi.waitFor(()=>expect(h.gate.getPending()).not.toBeNull());abort.abort();await rejected;expect(h.sent).toBe(false);
});
it("tool deltas remain nonexecutable until complete Anthropic result",()=>{
 const request={id:"r",providerId:provider,modelId:model,messages:[{role:"user" as const,content:"inspect"}],tools:[{name:"read",description:"read",parameters:{type:"object"}}]};
 expect(anthropicBody(request,true)).toMatchObject({tools:[{name:"read",input_schema:{type:"object"}}]});
 const parser=new AnthropicEvents(request);parser.accept({type:"message_start",message:{id:"m",model,usage:{input_tokens:1}}});parser.accept({type:"content_block_start",index:0,content_block:{type:"tool_use",id:"t",name:"read",input:{}}});
 expect(parser.accept({type:"content_block_delta",index:0,delta:{type:"input_json_delta",partial_json:'{"path":"Source"}'}}).result).toBeUndefined();parser.accept({type:"content_block_stop",index:0});parser.accept({type:"message_delta",delta:{stop_reason:"tool_use"},usage:{output_tokens:1}});
 expect(parser.accept({type:"message_stop"}).result?.toolCalls).toEqual([{id:"t",name:"read",arguments:'{"path":"Source"}'}]);
});

it("configured Claude members use independent native sessions and existing member adapter selection",async()=>{
 const {RunScopeAuthority}=await import("@uagent/runtime");
 const {collaborationSessions,captureMemberSessions,createCollaborationMemberAdapter}=await import("./collaboration-sessions");
 const first=harness(),second=harness(false,"claude-second","configured-second");
 first.manager.updateContext("root:synthetic","inspect",model,"conversation");second.manager.updateContext("root:synthetic","inspect","claude-second","conversation");
 await first.manager.openResponses(provider,model,"synthetic-key-first","anthropic");await second.manager.openResponses("configured-second","claude-second","synthetic-key-second","anthropic");
 const original1=collaborationSessions.investigator,original2=collaborationSessions.reviewer;
 collaborationSessions.investigator=first.manager;collaborationSessions.reviewer=second.manager;
 try{
  const members={investigator:{role:"source_analyst" as const,focus:"source",model:{providerId:provider,modelId:model,endpoint}},reviewer:{role:"risk_reviewer" as const,focus:"review",model:{providerId:"configured-second",modelId:"claude-second",endpoint}}};
  expect(captureMemberSessions(members).isCurrent()).toBe(true);
  const invokeMember=async(slot:"investigator"|"reviewer",h:ReturnType<typeof harness>)=>{
   const selected=members[slot].model;
   const lease=new RunScopeAuthority().approve({id:"scope-"+slot,runId:"run-"+slot,projectId:"root:synthetic",conversationId:"conversation",rootRef:"E:/SyntheticProject",...selected,mode:"read_only",readPrefixes:["Source"],sharePrefixes:["Source"],toolIds:["project.read_file"],limits:{maxToolCalls:2,maxModelRequests:3,maxDurationMs:60000,maxAttemptsPerFailure:1,maxToolResultBytes:8192,maxContextBytes:24576},expiresAt:Date.now()+60000},()=>h.manager.getSnapshot().ready);
   const draft={taskMode:"investigation",projectId:"root:synthetic",providerId:selected.providerId,modelId:selected.modelId,conversationId:"conversation",collaborationMembers:members} as import("@uagent/shared").TaskDraft;
   const adapter=createCollaborationMemberAdapter(slot,lease,draft);h.gate.subscribe(()=>{const p=h.gate.getPending();if(p)queueMicrotask(()=>h.gate.approve(p.id));});
   return adapter.complete({...h.request,metadata:{projectId:"root:synthetic",conversationId:"conversation",purpose:"investigation",runId:"run-"+slot}});
  };
  const results=await Promise.all([invokeMember("investigator",first),invokeMember("reviewer",second)]);
  expect(results.map(r=>r.modelId)).toEqual([model,"claude-second"]);expect(first.calls.some(c=>c.command==="complete_native_anthropic_chat")).toBe(false);
 }finally{collaborationSessions.investigator=original1;collaborationSessions.reviewer=original2;}
});

it("Anthropic parser rejects early termination, stream errors and unconfigured tools",()=>{
 const request={id:"r",providerId:provider,modelId:model,messages:[{role:"user" as const,content:"inspect"}]};
 expect(()=>new AnthropicEvents(request).accept({type:"message_stop"})).toThrow();
 expect(()=>new AnthropicEvents(request).accept({type:"error",error:{type:"rate_limit_error"}})).toThrow();
 const parser=new AnthropicEvents(request);parser.accept({type:"message_start",message:{id:"m",model}});parser.accept({type:"content_block_start",index:0,content_block:{type:"tool_use",id:"t",name:"unconfigured",input:{}}});parser.accept({type:"content_block_stop",index:0});parser.accept({type:"message_delta",delta:{stop_reason:"tool_use"}});expect(()=>parser.accept({type:"message_stop"})).toThrow();
});
