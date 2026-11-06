import {expect,it} from "vitest";
import {RunCoordinator,ToolRegistry,type ProviderAdapter} from "@uagent/runtime";
import type {TaskRunScope,TaskDraft,ProviderRuntimeRequest,ProviderRuntimeResponse,RunStoreCommit} from "@uagent/shared";
function fixture(mode="normal"){
 const scope:TaskRunScope={id:"scope",runId:"run",projectId:"project",conversationId:"conversation",rootRef:"root",providerId:"synthetic",modelId:"model",endpoint:"https://invalid.example",mode:"read_only",collaboration:"independent_review",readPrefixes:["Source"],sharePrefixes:["Source"],toolIds:["project.read"],expiresAt:Date.now()+60000,limits:{maxModelRequests:mode==="budget"?4:9,maxToolCalls:mode==="pending"?2:6,maxDurationMs:60000,maxAttemptsPerFailure:2,maxToolResultBytes:8192,maxContextBytes:24576}};
 const draft={input:"Investigate value",projectId:scope.projectId,conversationId:scope.conversationId,providerId:scope.providerId,modelId:scope.modelId,investigationScopeId:scope.id,taskMode:"investigation",collaboration:"independent_review",permissionMode:"request_approval",reasoningEffort:"medium",runMode:"local",branch:null,contextPercent:null} as TaskDraft;
 const requests:ProviderRuntimeRequest[]=[],commits:RunStoreCommit[]=[];let current=true;const abort=new AbortController();
 const registry=new ToolRegistry([{id:"project.read",definition:{name:"read_source",description:"read synthetic source",parameters:{type:"object",properties:{path:{type:"string"}},required:["path"],additionalProperties:false}},validate:a=>{if(typeof a.path!=="string")throw Error("path");},paths:a=>[a.path as string],execute:async(a,c)=>({status:"completed",effectState:"not_started",output:{value:7},sources:[{projectId:c.projectId,path:a.path as string,version:"v1",kind:"file_preview"}],truncated:false})}]);
 const adapter:ProviderAdapter={id:"synthetic",getCapabilities:()=>({providerId:"synthetic",modelIds:["model"],supportsTools:true,supportsStreaming:false,isMock:true}),complete:async(request)=>{
  requests.push(request);const n=requests.length;
  if(mode==="cancel"&&n===3)abort.abort();if(mode==="stale"&&n===3)current=false;
  if(mode==="pause"&&n===1)coordinator.requestPause();
  const call=mode==="greedy"?request.toolChoice!=="none":n===1||n===3||(mode==="merge-tool"&&n===5);
  const path=mode==="outside"&&n===3?"Other/private.cpp":"Source/Main.cpp";
  return {id:"response"+n,requestId:request.id,providerId:"synthetic",modelId:"model",text:n===2?"INVESTIGATOR_PRIVATE_REPORT":n===4?"REVIEWER_PRIVATE_REPORT":"Merged result",finishReason:mode==="report-length"&&n===2?"length":call?"tool_calls":"stop",createdAt:Date.now(),...(call?{toolCalls:[{id:"call_1",name:"read_source",arguments:JSON.stringify({path})},...(mode==="pending"?[{id:"call_pending",name:"read_source",arguments:JSON.stringify({path})}]:[])]}:{})} as ProviderRuntimeResponse;
 }};
 const coordinator=new RunCoordinator({adapter,registry,lease:{scope,isCurrent:()=>current},signal:abort.signal,store:{commit:async(update)=>{if(mode==="persist"&&update.run.collaboration?.activeAgent==="reviewer")throw Error("storage");commits.push(update);}},contextSources:{validate:async()=>true}});
 return {coordinator,draft,requests,commits,scope};
}
it("collaborative investigation uses separate worker contexts and merges actual evidence under one budget",async()=>{
 const f=fixture();const result=await f.coordinator.start("task",f.draft);expect(result.run.status).toBe("completed");expect(result.run.modelRequests).toBe(5);expect(result.run.toolCalls).toBe(2);expect(result.run.collaboration?.reports).toHaveLength(2);
 expect(JSON.stringify(f.requests[2])).not.toContain("INVESTIGATOR_PRIVATE_REPORT");expect(f.requests[2].messages.filter(m=>m.role==="tool")).toHaveLength(0);
 expect(JSON.stringify(f.requests[4])).toContain("INVESTIGATOR_PRIVATE_REPORT");expect(JSON.stringify(f.requests[4])).toContain("REVIEWER_PRIVATE_REPORT");expect(f.requests[4].toolChoice).toBe("none");
 for(let i=1;i<f.commits.length;i++)expect(f.commits[i].messages.slice(0,f.commits[i-1].messages.length)).toEqual(f.commits[i-1].messages);
 const agents=new Set(f.commits.flatMap(c=>c.events.map(e=>e.agentId)));expect(agents).toEqual(new Set(["investigator","reviewer","synthesizer"]));
});
it.each(["cancel","stale","outside","persist","merge-tool"])("collaborative investigation stops safely on %s without false completion",async(mode)=>{
 const f=fixture(mode);const result=await f.coordinator.start("task",f.draft);expect(result.run.status).not.toBe("completed");
 if(mode==="cancel")expect(result.run.status).toBe("cancelled");
 if(mode==="outside")expect(result.run.toolCalls).toBe(2);
 if(mode==="persist")expect(f.requests).toHaveLength(2);
 if(mode==="merge-tool")expect(["synthesis_tool_call_rejected","provider_failed"]).toContain(result.run.stopReason);
});
it("collaborative investigation cannot upgrade an ordinary approved scope",async()=>{const f=fixture();delete f.scope.collaboration;await expect(f.coordinator.start("task",f.draft)).rejects.toThrow("run_scope_mismatch");expect(f.requests).toHaveLength(0);});

it("collaborative investigation preserves original IDs for pending calls when the tool budget stops execution",async()=>{
 const f=fixture("pending");const result=await f.coordinator.start("task",f.draft);expect(result.run.status).toBe("paused");expect(result.run.stopReason).toBe("reviewer_tool_budget_reserved");expect(result.run.toolCalls).toBe(1);
 expect(f.commits.at(-1)?.run.collaboration?.calls.map(c=>c.providerCallId)).toEqual(["call_1","call_pending"]);
 expect(new Set(result.run.collaboration?.calls.map(c=>c.callId)).size).toBe(2);
});

it("collaborative investigation reserves report and synthesis budgets despite tool-hungry workers",async()=>{
 const f=fixture("greedy");const result=await f.coordinator.start("task",f.draft);
 expect(result.run.status).toBe("completed");expect(result.run.modelRequests).toBe(9);expect(result.run.toolCalls).toBe(6);
 expect(result.run.collaboration?.reports.map(r=>r.stepIds.length)).toEqual([3,3]);
 expect(f.requests.map(r=>r.toolChoice)).toEqual(["auto","auto","auto","none","auto","auto","auto","none","none"]);
 expect(f.requests[3].messages[1].content).toContain("Explain limitations");
});
it("collaborative investigation rejects budgets unable to fund both workers before any request",async()=>{
 const f=fixture("budget");await expect(f.coordinator.start("task",f.draft)).rejects.toThrow("invalid_run_limits");expect(f.requests).toHaveLength(0);
});
it("collaborative investigation retains pending work and shared allowance across pause and resume",async()=>{
 const f=fixture("pause");const paused=await f.coordinator.start("task",f.draft);expect(paused.run.stopReason).toBe("user_paused");expect(paused.run.modelRequests).toBe(1);
 const result=await f.coordinator.resume();expect(result.run.status).toBe("completed");expect(result.run.modelRequests).toBe(5);expect(result.run.toolCalls).toBe(2);expect(result.run.collaboration?.reports).toHaveLength(2);
});
it("collaborative investigation cancellation while paused never starts the reviewer",async()=>{
 const f=fixture("pause");await f.coordinator.start("task",f.draft);f.coordinator.cancel();expect(f.coordinator.getSnapshot()?.status).toBe("cancelled");await expect(f.coordinator.resume()).rejects.toThrow("run_not_paused");expect(f.requests).toHaveLength(1);
});

it("collaborative investigation cannot spend the next worker budget by resuming a truncated report",async()=>{
 const f=fixture("report-length");f.scope.limits.maxModelRequests=5;f.scope.limits.maxToolCalls=2;
 const paused=await f.coordinator.start("task",f.draft);expect(paused.run.stopReason).toBe("output_limit");expect(f.requests).toHaveLength(2);
 const resumed=await f.coordinator.resume();expect(resumed.run.stopReason).toBe("agent_model_limit");expect(f.requests).toHaveLength(2);
 const again=await f.coordinator.resume();expect(again.run.stopReason).toBe("agent_model_limit");expect(f.requests).toHaveLength(2);
});
