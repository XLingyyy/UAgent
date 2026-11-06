import {afterEach,expect,it,vi} from "vitest";
import {RunCoordinator,RunScopeAuthority,ToolRegistry,createDeepSeekAccountSession,createOutboundConsentGate,DEEPSEEK_MODEL} from "@uagent/runtime";
import type {TaskRunScope,TaskDraft,RunStoreCommit} from "@uagent/shared";
import {codexLeadSession,CODEX_ENDPOINT,type CodexView} from "./codex-member-session";
import {createInvestigationAdapter,createCollaborationMemberAdapter} from "./collaboration-sessions";
import type {NativeInvoke} from "./project-native-adapter";
afterEach(()=>{codexLeadSession.close();vi.unstubAllGlobals();vi.restoreAllMocks();});
function scope():TaskRunScope{return {id:"scope",runId:"parent",projectId:"synthetic",conversationId:"chat",rootRef:"root",providerId:"codex",modelId:"test-model",endpoint:CODEX_ENDPOINT,mode:"read_only",collaboration:"dynamic_delegation",collaborationMembers:{investigator:{role:"risk_reviewer",focus:"text analysis"},reviewer:{role:"source_analyst",focus:"evidence"}},readPrefixes:["Source"],sharePrefixes:["Source"],toolIds:["project.read"],expiresAt:Date.now()+60000,limits:{maxModelRequests:9,maxToolCalls:6,maxDurationMs:60000,maxAttemptsPerFailure:2,maxToolResultBytes:8192,maxContextBytes:24576}};}
it("Codex scope approval remains exact, collaborative and one-use",()=>{
 for(const override of [{endpoint:"codex://other"},{providerId:"other"},{collaboration:undefined}])expect(()=>new RunScopeAuthority().approve({...scope(),...override},()=>true)).toThrow();
 const auth=new RunScopeAuthority(),lease=auth.approve(scope(),()=>true);expect(auth.claim(lease.scope.id)).toBe(lease);expect(auth.claim(lease.scope.id)).toBeNull();auth.invalidate();expect(lease.isCurrent()).toBe(false);
});
it.each(["mixed","all-codex","bad-plan","cancel-synthesis","stale-synthesis"])("official Codex lead %s delegates and synthesizes with isolated contexts",async mode=>{
 const s=scope();if(mode!=="all-codex")s.collaborationMembers!.reviewer.model={providerId:"deepseek",modelId:DEEPSEEK_MODEL,endpoint:"https://api.deepseek.com/chat/completions"};
 const draft={input:"Investigate synthetic lifecycle",projectId:s.projectId,conversationId:s.conversationId,providerId:s.providerId,modelId:s.modelId,investigationScopeId:s.id,taskMode:"investigation",collaboration:s.collaboration,collaborationMembers:s.collaborationMembers,permissionMode:"request_approval",reasoningEffort:"medium",runMode:"local",branch:null,contextPercent:null} as TaskDraft;
 const starts:any[]=[],dispatches:string[]=[],cancels:string[]=[],views=new Map<string,CodexView>(),commits:RunStoreCommit[]=[];let leadCount=0,sourceCurrent=true,coordinator:RunCoordinator;
 const invoke=(async(command:string,payload:any)=>{const i=payload.input;if(command==="start_codex_turn"){
 const n=starts.length+1;starts.push(structuredClone(i));const lead=i.member.memberId==="lead";if(lead)leadCount++;
 if(lead&&leadCount===2){if(mode==="cancel-synthesis")coordinator.cancel();if(mode==="stale-synthesis")sourceCurrent=false;}
 const text=lead?(leadCount===1?(mode==="bad-plan"?"invalid":"{\"investigator\":\"Review lifecycle evidence gaps\",\"reviewer\":\"Read the permitted source\"}"):"CODEX_SYNTHESIS"):"CODEX_MEMBER_"+i.member.memberId;
 const v={requestId:"q"+n,sessionId:i.sessionId??"s"+n,threadId:"t"+n,turnId:"turn",status:"completed",text,persisted:true,error:null};views.set(v.requestId,v);return {...v,status:"preparing",text:"",persisted:false};}
 if(command==="dispatch_codex_turn"){dispatches.push(i.requestId);return;}
 if(command==="poll_codex_turn")return views.get(i.requestId);
 if(command==="cancel_codex_turn"){cancels.push(i.requestId);return;}throw Error(command);}) as NativeInvoke;
 vi.stubGlobal("__TAURI_INTERNALS__",{invoke});codexLeadSession.configure(s.projectId,s.modelId,"E:/synthetic/codex.exe");
 const gate=createOutboundConsentGate();let deepCalls=0;const fetcher=vi.fn(async()=>{deepCalls++;return new Response('data: '+JSON.stringify({choices:[{delta:deepCalls===1?{tool_calls:[{index:0,id:"read1",type:"function",function:{name:"read_source",arguments:'{"path":"Source/A.cpp"}'}}]}:{content:"DEEPSEEK_REPORT"},finish_reason:deepCalls===1?"tool_calls":"stop"}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})+'\n\ndata: [DONE]\n\n',{headers:{"Content-Type":"text/event-stream"}});}) as unknown as typeof fetch;
 const deep=createDeepSeekAccountSession({mode:"offline",expiresAt:Date.now()+60000,outboundGate:gate,fetcher});deep.setCredential("synthetic-only");
 const registry=new ToolRegistry([{id:"project.read",definition:{name:"read_source",description:"read synthetic",parameters:{type:"object",properties:{path:{type:"string"}},required:["path"],additionalProperties:false}},validate:()=>{},paths:a=>[a.path as string],execute:async(a,c)=>({status:"completed",effectState:"not_started",output:{value:1},sources:[{projectId:c.projectId,path:a.path as string,version:"v1",kind:"file_preview"}],truncated:false})}]);
 const lease=new RunScopeAuthority().approve(s,()=>true);const memory=vi.fn(async()=>{throw Error("unexpected memory injection");});
 coordinator=new RunCoordinator({adapter:createInvestigationAdapter(lease,draft),registry,lease,createMemberAdapter:(role,child,d)=>child.scope.providerId==="codex"?createCollaborationMemberAdapter(role,child,d):deep.adapter,contextSources:{validate:async()=>sourceCurrent},projectMemory:mode==="all-codex"?{prepare:memory}:undefined,store:{commit:async c=>{commits.push(c);}}});
 const approvals=setInterval(()=>{const pending=gate.getPending();if(pending)gate.approve(pending.id);},5);
 try{const result=await coordinator.start("task",draft);
 if(mode==="bad-plan"){expect(result.run.stopReason).toBe("delegation_plan_invalid");expect(starts).toHaveLength(1);expect(deepCalls).toBe(0);return;}
 const lead=starts.filter(i=>i.member.memberId==="lead"),worker=starts.find(i=>i.member.memberId==="investigator");expect(lead).toHaveLength(2);expect(lead[0].sessionId).toBeNull();expect(lead[1].sessionId).toBe("s1");expect(worker.sessionId).toBeNull();expect(worker.member.runId).toBe("parent:investigator");expect(worker.prompt).not.toContain("DEEPSEEK_REPORT");expect(lead[1].prompt).toContain("CODEX_MEMBER_investigator");
 if(mode==="all-codex"){expect(deepCalls).toBe(0);expect(memory).not.toHaveBeenCalled();expect(new Set(starts.filter(i=>i.member.memberId!=="lead").map(i=>i.member.runId)).size).toBe(2);}
 else{expect(deepCalls).toBe(2);expect(lead[1].prompt).toContain("DEEPSEEK_REPORT");expect(lead[1].prompt).toContain("Source/A.cpp");expect(lead[1].prompt).toContain('"role":"tool"');}
 if(mode==="cancel-synthesis"||mode==="stale-synthesis"){expect(result.run.status).not.toBe("completed");expect(dispatches).not.toContain("q"+starts.length);expect(cancels).toContain("q"+starts.length);}
 else{expect(result.run.status).toBe("completed");expect(result.text).toBe("CODEX_SYNTHESIS");expect(result.run.modelRequests).toBe(mode==="all-codex"?4:5);expect(commits.at(-1)?.run.scope.providerId).toBe("codex");expect(commits.some(c=>c.run.parentRunId==="parent")).toBe(true);}
 }finally{clearInterval(approvals);deep.clearCredential();}
});
