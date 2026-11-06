import {expect,it,vi} from "vitest";
import {RunCoordinator,ToolRegistry,createDeepSeekAccountSession,createOutboundConsentGate,DEEPSEEK_MODEL} from "@uagent/runtime";
import type {TaskRunScope,TaskDraft,ProviderRuntimeRequest,RunStoreCommit,RunEvent} from "@uagent/shared";
import {createCodexMemberSession,CODEX_ENDPOINT,type CodexView} from "./codex-member-session";
import type {NativeInvoke} from "./project-native-adapter";
import {createNativeRunStore,type NativeRunCommitInput} from "./native-run-store";
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
function scope(runId="run:investigator"):TaskRunScope{return {id:"scope",runId,projectId:"synthetic",conversationId:"chat",rootRef:"root",providerId:"codex",modelId:"test-model",endpoint:CODEX_ENDPOINT,mode:"read_only",readPrefixes:["Source"],sharePrefixes:["Source"],toolIds:["project.read"],expiresAt:Date.now()+60000,limits:{maxModelRequests:9,maxToolCalls:6,maxDurationMs:60000,maxAttemptsPerFailure:2,maxToolResultBytes:8192,maxContextBytes:24576}};}
function mockNative(){
 const starts:any[]=[],dispatches:string[]=[],cancels:string[]=[],views=new Map<string,CodexView>();let approval:Promise<void>|undefined;
 const invoke=(async(command:string,payload:any)=>{const i=payload.input;
 if(command==="start_codex_turn"){starts.push(structuredClone(i));await approval;const q="q"+starts.length,v={requestId:q,sessionId:i.sessionId??"s"+starts.length,threadId:"t"+starts.length,turnId:"turn",status:"preparing",text:"",persisted:false,error:null};views.set(q,v);return v;}
 if(command==="dispatch_codex_turn"){dispatches.push(i.requestId);return;}
 if(command==="cancel_codex_turn"){cancels.push(i.requestId);return;}
 if(command==="poll_codex_turn")return {...views.get(i.requestId)};
 throw Error(command);
 }) as NativeInvoke;
 return {invoke,starts,dispatches,cancels,views,holdApproval:(p:Promise<void>)=>approval=p,finish:(text="CODEX_REPORT")=>{for(const [id,v] of views)views.set(id,{...v,text,status:"completed",persisted:true});}};
}
function setup(){const h=mockNative(),session=createCodexMemberSession(()=>h.invoke),s=scope();session.configure(s.projectId,s.modelId,"E:/synthetic/codex.exe");const adapter=session.createAdapter("investigator",{scope:s,isCurrent:()=>true});const request:ProviderRuntimeRequest={id:"request",providerId:"codex",modelId:"test-model",messages:[{role:"user",content:"synthetic text"}],tools:[],toolChoice:"none",metadata:{runId:s.runId,projectId:s.projectId}};return {h,session,s,adapter,request};}
it("Codex member revalidates after native approval, streams and resumes only its linked session",async()=>{
 const f=setup(),approval=deferred<void>(),before=vi.fn(async()=>{});f.h.holdApproval(approval.promise);
 const run=f.adapter.complete(f.request,{beforeSend:before});await vi.waitFor(()=>expect(f.h.starts).toHaveLength(1));expect(before).not.toHaveBeenCalled();expect(f.h.dispatches).toHaveLength(0);approval.resolve();await vi.waitFor(()=>expect(f.h.dispatches).toHaveLength(1));expect(before).toHaveBeenCalledOnce();f.h.finish();expect((await run).text).toBe("CODEX_REPORT");
 const next=f.adapter.complete({...f.request,id:"second"});await vi.waitFor(()=>expect(f.h.starts).toHaveLength(2));expect(f.h.starts[1].sessionId).toBe("s1");expect(f.h.starts[1].member).toEqual({runId:"run:investigator",memberId:"investigator"});f.h.finish("SECOND");expect((await next).text).toBe("SECOND");expect(f.h.cancels).toEqual([]);await expect(f.adapter.complete(f.request)).rejects.toThrow("scope_changed");f.session.close();
});
it.each(["abort","stale","preflight"])("Codex member %s after approval cannot dispatch",async kind=>{
 const f=setup(),approval=deferred<void>(),controller=new AbortController();f.h.holdApproval(approval.promise);
 const run=f.adapter.complete(f.request,{signal:controller.signal,beforeSend:async()=>{if(kind==="preflight")throw Error("source changed");}});const settled=Promise.allSettled([run]);await vi.waitFor(()=>expect(f.h.starts).toHaveLength(1));if(kind==="abort")controller.abort();if(kind==="stale")f.session.close();approval.resolve();expect((await settled)[0].status).toBe("rejected");expect(f.h.dispatches).toEqual([]);expect(f.h.cancels).toHaveLength(1);f.session.close();
});
it("Codex member uncertain result stops without replay or false completion",async()=>{const f=setup();const run=f.adapter.complete(f.request),settled=Promise.allSettled([run]);await vi.waitFor(()=>expect(f.h.dispatches).toHaveLength(1));const v=f.h.views.get("q1")!;f.h.views.set("q1",{...v,status:"uncertain",error:"persistence uncertain"});expect((await settled)[0].status).toBe("rejected");expect(f.h.starts).toHaveLength(1);expect(f.h.cancels).toHaveLength(1);f.session.close();});
it.each(["complete","cancel","failure"])("dynamic mixed Codex/DeepSeek collaboration %s uses real coordinator and mocked transports",async mode=>{
 const h=mockNative(),codex=createCodexMemberSession(()=>h.invoke),s=scope("mixed-run");codex.configure(s.projectId,"test-model","E:/synthetic/codex.exe");s.providerId="deepseek";s.modelId=DEEPSEEK_MODEL;s.endpoint="https://api.deepseek.com/chat/completions";s.collaboration="dynamic_delegation";s.collaborationMembers={investigator:{role:"risk_reviewer",focus:"Codex text review",model:{providerId:"codex",modelId:"test-model",endpoint:CODEX_ENDPOINT}},reviewer:{role:"source_analyst",focus:"DeepSeek source investigation"}};
 const draft={input:"Analyze synthetic lifecycle",projectId:s.projectId,conversationId:s.conversationId,providerId:s.providerId,modelId:s.modelId,investigationScopeId:s.id,taskMode:"investigation",collaboration:s.collaboration,collaborationMembers:s.collaborationMembers,permissionMode:"request_approval",reasoningEffort:"medium",runMode:"local",branch:null,contextPercent:null} as TaskDraft;
 const gate=createOutboundConsentGate(),deepRelease=deferred<void>(),bodies:any[]=[],commits:RunStoreCommit[]=[],events:RunEvent[]=[],nativeInputs:NativeRunCommitInput[]=[];let workerStarted=false;
 const fetcher=vi.fn(async(_url:any,init:any)=>{const body=JSON.parse(init.body);bodies.push(body);const n=bodies.length;
 if(n===2){workerStarted=true;await deepRelease.promise;if(mode==="failure")throw Error("mock transport failure");}
 const tool=n===2;const content=n===1?JSON.stringify({investigator:"Review lifecycle gaps from task context",reviewer:"Read Source/A.cpp"}):n===3?"DEEPSEEK_REPORT":"SYNTHESIS";
 return new Response('data: '+JSON.stringify({choices:[{delta:tool?{tool_calls:[{index:0,id:"read1",type:"function",function:{name:"read_source",arguments:'{"path":"Source/A.cpp"}'}}]}:{content},finish_reason:tool?"tool_calls":"stop"}],usage:{prompt_tokens:2,completion_tokens:3,total_tokens:5}})+'\n\ndata: [DONE]\n\n',{headers:{"Content-Type":"text/event-stream"}});
 }) as unknown as typeof fetch;
 const deep=createDeepSeekAccountSession({mode:"offline",expiresAt:Date.now()+60000,outboundGate:gate,fetcher});deep.setCredential("synthetic-only");
 const registry=new ToolRegistry([{id:"project.read",definition:{name:"read_source",description:"read synthetic",parameters:{type:"object",properties:{path:{type:"string"}},required:["path"],additionalProperties:false}},validate:()=>{},paths:a=>[a.path as string],execute:async(a,c)=>({status:"completed",effectState:"not_started",output:{value:1},sources:[{projectId:c.projectId,path:a.path as string,version:"v1",kind:"file_preview"}],truncated:false})}]);
 const revisions=new Map<string,{revision:number;count:number}>();const native=createNativeRunStore(async(_cmd,args)=>{const c=args.input as NativeRunCommitInput;nativeInputs.push(c);const p=revisions.get(c.runId)??{revision:0,count:0};expect(c.expectedRevision).toBe(p.revision);const next={revision:p.revision+1,count:p.count+c.batch.messages.length};revisions.set(c.runId,next);return {schemaVersion:1,projectId:c.projectId,runId:c.runId,revision:next.revision,messageCount:next.count};});
 const coordinator=new RunCoordinator({adapter:deep.adapter,registry,lease:{scope:s,isCurrent:()=>true},createMemberAdapter:(role,lease)=>role==="investigator"?codex.createAdapter(role,lease):deep.adapter,contextSources:{validate:async()=>true},store:{commit:async c=>{await native.commit(c);commits.push(c);}},onEvent:e=>events.push(e)});
 const approvals=setInterval(()=>{const pending=gate.getPending();if(pending)gate.approve(pending.id);},5);
 try{const running=coordinator.start("task",draft);await vi.waitFor(()=>{expect(workerStarted).toBe(true);expect(h.dispatches).toHaveLength(1);});
 expect(h.starts[0].sessionId).toBeNull();expect(h.starts[0].member.runId).toBe("mixed-run:investigator");expect(h.starts[0].prompt).not.toContain("Source/A.cpp");expect(JSON.stringify(bodies[1])).not.toContain("CODEX_REPORT");
 if(mode==="cancel")coordinator.cancel();if(mode==="complete")h.finish();deepRelease.resolve();const result=await running;
 if(mode==="complete"){expect(result.run.status).toBe("completed");expect(result.run.modelRequests).toBe(5);expect(result.run.toolCalls).toBe(1);expect(result.run.collaboration?.reports.map(r=>r.stepIds.length)).toEqual([0,1]);expect(JSON.stringify(bodies.at(-1))).toContain("CODEX_REPORT");expect(JSON.stringify(bodies.at(-1))).toContain("DEEPSEEK_REPORT");expect(events.some(e=>e.type==="model_text_delta"&&e.agentId==="investigator")).toBe(true);expect(nativeInputs.some(c=>c.runId==="mixed-run:investigator")).toBe(true);expect(commits.at(-1)?.run.status).toBe("completed");}
 else{expect(result.run.status).toBe(mode==="cancel"?"cancelled":"failed");expect(bodies).toHaveLength(2);expect(h.cancels).toHaveLength(1);}
 }finally{clearInterval(approvals);codex.close();deep.clearCredential();}
});
