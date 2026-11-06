import {expect,it} from "vitest";
import {RunCoordinator,RunScopeAuthority,ToolRegistry} from "@uagent/runtime";
import type {TaskRunScope,TaskDraft,RunStoreCommit} from "@uagent/shared";
import {createCodexMemberSession,CODEX_ENDPOINT,type CodexView} from "./codex-member-session";
import type {NativeInvoke} from "./project-native-adapter";
function scope():TaskRunScope{return {id:"scope",runId:"parent",projectId:"synthetic",conversationId:"chat",rootRef:"root",providerId:"codex",modelId:"test-model",endpoint:CODEX_ENDPOINT,mode:"read_only",collaboration:"dynamic_delegation",collaborationMembers:{investigator:{role:"risk_reviewer",focus:"text analysis"},reviewer:{role:"source_analyst",focus:"evidence"}},readPrefixes:["Source"],sharePrefixes:["Source"],toolIds:["project.read"],expiresAt:Date.now()+60000,limits:{maxModelRequests:9,maxToolCalls:6,maxDurationMs:60000,maxAttemptsPerFailure:2,maxToolResultBytes:8192,maxContextBytes:24576}};}

it.each(["success","planner-budget","declined-synthesis","stale-synthesis","cancelled-planning","minimum-budget"])("Codex lead phase read tools: %s",async mode=>{
 const s=scope();s.limits.maxToolCalls=mode==="minimum-budget"?2:6;
 const draft={input:"Inspect synthetic source",projectId:s.projectId,conversationId:s.conversationId,providerId:s.providerId,modelId:s.modelId,investigationScopeId:s.id,taskMode:"investigation",collaboration:s.collaboration,collaborationMembers:s.collaborationMembers,permissionMode:"request_approval",reasoningEffort:"medium",runMode:"local",branch:null,contextPercent:null} as TaskDraft;
 const starts:any[]=[],approved:any[]=[],sent:any[]=[],commits:RunStoreCommit[]=[];const views=new Map<string,any>();let sourceCurrent=true,coordinator:RunCoordinator;
 const invoke=(async(command:string,payload:any)=>{const i=payload.input;
 if(command==="start_codex_turn"){
 const n=starts.length+1;starts.push(i);const lead=i.member.memberId==="lead";
 const v={requestId:"q"+n,sessionId:i.sessionId??"s"+n,threadId:"thread"+n,turnId:"turn"+n,status:"completed",text:lead?(n===1?'{'+'"investigator":"Inspect source","reviewer":"Review source"}':"final report"):"member report",persisted:true,error:null,member:!lead,phase:lead?(n===1?"planner":"synthesizer"):"member",count:0};views.set(v.requestId,v);return {...v,text:"",persisted:false,status:"preparing"};}
 const v=views.get(i.requestId);
 if(command==="dispatch_codex_turn")return;
 if(command==="poll_codex_turn"){
 if((v.member||mode!=="minimum-budget")&&(!v.count||mode==="planner-budget"&&v.phase==="planner"))return {...v,text:"",persisted:false,status:"streaming",pendingTool:{callId:"read-"+v.count,name:"project_read_file",arguments:{path:"Source/A.cpp"}}};return v;}
 if(command==="approve_codex_tool_result"){approved.push(i);if(mode==="declined-synthesis"&&v.phase==="synthesizer")throw Error("codex_tool_declined");if(mode==="stale-synthesis"&&v.phase==="synthesizer")sourceCurrent=false;if(mode==="cancelled-planning"&&v.phase==="planner")coordinator.cancel();return;}
 if(command==="dispatch_codex_tool_result"){sent.push(i);v.count++;return;}
 if(command==="cancel_codex_turn")return;throw Error(command);
 }) as NativeInvoke;
 const sessions=[0,1,2].map(()=>{const session=createCodexMemberSession(()=>invoke);session.configure(s.projectId,s.modelId,"E:/synthetic/codex.exe");return session;});
 const registry=new ToolRegistry([{id:"project.read",definition:{name:"project_read_file",description:"synthetic text",parameters:{type:"object",properties:{path:{type:"string"}},required:["path"]}},validate:()=>{},paths:a=>[a.path as string],execute:async(a,c)=>({status:"completed",effectState:"not_started",output:{text:"SYNTHETIC_ONLY"},sources:[{projectId:c.projectId,path:a.path as string,version:"v1",kind:"file_preview"}],truncated:false})}]);
 const lease=new RunScopeAuthority().approve(s,()=>true);
 coordinator=new RunCoordinator({adapter:sessions[0].createAdapter("lead",lease),lease,registry,createMemberAdapter:(role,child)=>sessions[role==="investigator"?1:2].createAdapter(role,child),contextSources:{validate:async()=>sourceCurrent},store:{commit:async c=>{commits.push(structuredClone(c));}}});
 try{const result=await coordinator.start("task",draft);
 if(mode==="minimum-budget")expect(starts[0].tools).toEqual([]);else expect(starts[0].tools[0].name).toBe("project_read_file");
 if(mode==="success"||mode==="minimum-budget"){
 expect(result.run.status,result.run.stopReason).toBe("completed");const count=mode==="success"?4:2;
 expect(result.run.toolCalls).toBe(count);expect(sent).toHaveLength(count);expect(result.run.steps).toHaveLength(count);expect(new Set(result.run.steps.map(s=>s.callId)).size).toBe(count);
 expect(result.run.collaboration?.calls).toHaveLength(count);expect(result.run.modelRequests).toBe(4);
 if(mode==="success"){
 expect(result.run.collaboration?.calls.map(c=>c.agentId)).toContain("planner");expect(result.run.collaboration?.calls.map(c=>c.agentId)).toContain("synthesizer");
 const leads=starts.filter(i=>i.member.memberId==="lead");expect(leads[1].sessionId).toBe(leads[0].sessionId??"s1");expect(leads[1].tools[0].name).toBe("project_read_file");expect(leads[1].prompt).toContain("SYNTHETIC_ONLY");
 expect(views.get("q1").count).toBe(1);expect(views.get("q4").count).toBe(1);
 expect(commits.at(-1)?.messages.filter(m=>m.role==="tool")).toHaveLength(4);
 }
 }else{
 expect(result.run.status).not.toBe("completed");
 if(mode==="planner-budget"){expect(result.run.stopReason).toBe("planner_tool_budget_reserved");expect(result.run.toolCalls).toBe(3);expect(sent).toHaveLength(3);expect(starts).toHaveLength(1);}
 if(mode==="cancelled-planning"){expect(sent).toHaveLength(0);expect(starts).toHaveLength(1);}
 if(mode.endsWith("synthesis")){expect(sent).toHaveLength(3);expect(approved).toHaveLength(4);expect(sent.some(i=>i.requestId==="q4")).toBe(false);expect(result.run.steps).toHaveLength(4);}
 }

 }finally{sessions.forEach(s=>s.close());}
});
