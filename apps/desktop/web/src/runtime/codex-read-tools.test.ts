import {expect,it} from "vitest";
import {RunCoordinator,RunScopeAuthority,ToolRegistry} from "@uagent/runtime";
import type {TaskRunScope,TaskDraft,RunStoreCommit} from "@uagent/shared";
import {createCodexMemberSession,CODEX_ENDPOINT,type CodexView} from "./codex-member-session";
import type {NativeInvoke} from "./project-native-adapter";
function scope():TaskRunScope{return {id:"scope",runId:"parent",projectId:"synthetic",conversationId:"chat",rootRef:"root",providerId:"codex",modelId:"test-model",endpoint:CODEX_ENDPOINT,mode:"read_only",collaboration:"dynamic_delegation",collaborationMembers:{investigator:{role:"risk_reviewer",focus:"text analysis"},reviewer:{role:"source_analyst",focus:"evidence"}},readPrefixes:["Source"],sharePrefixes:["Source"],toolIds:["project.read"],expiresAt:Date.now()+60000,limits:{maxModelRequests:9,maxToolCalls:6,maxDurationMs:60000,maxAttemptsPerFailure:2,maxToolResultBytes:8192,maxContextBytes:24576}};}

it.each(["success","declined","stale","cancelled","outside-scope","budget"])("dynamic Codex project tools: %s",async mode=>{
 const s=scope();s.limits.maxToolCalls=2;
 const draft={input:"Inspect synthetic source",projectId:s.projectId,conversationId:s.conversationId,providerId:s.providerId,modelId:s.modelId,investigationScopeId:s.id,taskMode:"investigation",collaboration:s.collaboration,collaborationMembers:s.collaborationMembers,permissionMode:"request_approval",reasoningEffort:"medium",runMode:"local",branch:null,contextPercent:null} as TaskDraft;
 const starts:any[]=[],approved:any[]=[],sent:any[]=[],commits:RunStoreCommit[]=[];const views=new Map<string,any>();let sourceCurrent=true,coordinator:RunCoordinator;
 const invoke=(async(command:string,payload:any)=>{const i=payload.input;
 if(command==="start_codex_turn"){
 const n=starts.length+1;starts.push(i);const lead=i.member.memberId==="lead";
 const v={requestId:"q"+n,sessionId:i.sessionId??"s"+n,threadId:"thread"+n,turnId:"turn"+n,status:"completed",text:lead?(n===1?'{'+'"investigator":"Inspect source","reviewer":"Review source"}':"final report"):"member report",persisted:true,error:null,member:!lead,count:0};views.set(v.requestId,v);return {...v,text:"",persisted:false,status:"preparing"};}
 const v=views.get(i.requestId);
 if(command==="dispatch_codex_turn")return;
 if(command==="poll_codex_turn"){
 if(v.member&&(!v.count||mode==="budget"&&v.count===1))return {...v,text:"",persisted:false,status:"streaming",pendingTool:{callId:"read-"+v.count,name:"project_read_file",arguments:{path:mode==="outside-scope"?"Private/key.txt":"Source/A.cpp"}}};return v;}
 if(command==="approve_codex_tool_result"){approved.push(i);if(mode==="declined")throw Error("codex_tool_declined");if(mode==="stale")sourceCurrent=false;if(mode==="cancelled")coordinator.cancel();return;}
 if(command==="dispatch_codex_tool_result"){sent.push(i);v.count++;return;}
 if(command==="cancel_codex_turn")return;throw Error(command);
 }) as NativeInvoke;
 const sessions=[0,1,2].map(()=>{const session=createCodexMemberSession(()=>invoke);session.configure(s.projectId,s.modelId,"E:/synthetic/codex.exe");return session;});
 const registry=new ToolRegistry([{id:"project.read",definition:{name:"project_read_file",description:"synthetic text",parameters:{type:"object",properties:{path:{type:"string"}},required:["path"]}},validate:()=>{},paths:a=>[a.path as string],execute:async(a,c)=>({status:"completed",effectState:"not_started",output:{text:"SYNTHETIC_ONLY"},sources:[{projectId:c.projectId,path:a.path as string,version:"v1",kind:"file_preview"}],truncated:false})}]);
 const lease=new RunScopeAuthority().approve(s,()=>true);
 coordinator=new RunCoordinator({adapter:sessions[0].createAdapter("lead",lease),lease,registry,createMemberAdapter:(role,child)=>sessions[role==="investigator"?1:2].createAdapter(role,child),contextSources:{validate:async()=>sourceCurrent},store:{commit:async c=>{commits.push(structuredClone(c));}}});
 try{const result=await coordinator.start("task",draft);
 expect(starts[0].tools).toEqual([]);expect(starts.filter(i=>i.member.memberId!=="lead").every(i=>i.tools[0].name==="project_read_file"&&i.tools[0].type==="function")).toBe(true);
 if(mode==="success"){expect(result.run.status,JSON.stringify({reason:result.run.stopReason,workers:result.run.collaboration?.workers,steps:result.run.steps,sent,approved})).toBe("completed");expect(result.run.toolCalls).toBe(2);expect(sent).toHaveLength(2);expect(approved.every(i=>i.text.includes("SYNTHETIC_ONLY"))).toBe(true);expect(result.run.steps.filter(s=>s.status==="completed")).toHaveLength(2);expect(commits.some(c=>c.messages.some(m=>m.role==="tool"&&m.content.includes("SYNTHETIC_ONLY")))).toBe(true);}
 else{expect(result.run.status).not.toBe("completed");if(mode==="outside-scope")expect(approved).toHaveLength(0);if(["declined","stale","cancelled"].includes(mode))expect(approved.length).toBeGreaterThan(0);if(mode!=="budget")expect(sent).toHaveLength(0);else {expect(sent.length).toBeLessThanOrEqual(2);expect(result.run.stopReason).toBe("tool_limit");}}
 }finally{sessions.forEach(s=>s.close());}
});
