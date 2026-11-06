import {expect,it,vi} from "vitest";
import {RunCoordinator,RunScopeAuthority,type ProviderAdapter} from "@uagent/runtime";
import type {ProviderRuntimeRequest,ProviderRuntimeResponse,RunStoreCommit,TaskDraft,TaskRunScope} from "@uagent/shared";
import {createProjectReadToolRegistry} from "./project-read-tools";
import type {NativeProjectAdapter} from "./project-native-adapter";

function setup(limits:number[],outsideScope=false,clientTools=true){
 const s:TaskRunScope={id:"scope",runId:"parent",projectId:"synthetic",conversationId:"chat",rootRef:"root",providerId:"synthetic",modelId:"test",endpoint:"https://invalid.example",mode:"read_only",collaboration:"dynamic_delegation",readPrefixes:outsideScope?["Source"]:[""],sharePrefixes:[""],toolIds:["project.list_files"],expiresAt:Date.now()+60000,limits:{maxModelRequests:6,maxToolCalls:2,maxDurationMs:60000,maxAttemptsPerFailure:2,maxToolResultBytes:8192,maxContextBytes:24576}};
 if(!clientTools){delete s.collaboration;s.limits.maxToolCalls=1;s.limits.maxModelRequests=4;}
 const inspect=vi.fn(async()=>({projectId:s.projectId,rootCurrent:true,sources:[{path:"Source/A.cpp",status:"ready",version:"v1"}]}));
 const snapshot={id:"index",status:"ready",projectId:s.projectId,rootRef:s.rootRef,files:[{rootRelativePath:"Source/A.cpp",byteSize:1,extension:".cpp",isIgnored:false}],summary:{scannedAt:1}};
 const project={source:"fixture",getProject:()=>({id:s.projectId,rootRef:s.rootRef,trustState:"trusted"}),getStableSnapshot:()=>snapshot,inspectSources:inspect} as unknown as NativeProjectAdapter;
 const registry=createProjectReadToolRegistry(project,{allowFixture:true});
 const feedback:any[]=[],commits:RunStoreCommit[]=[];let leadTurns=0,ordinaryTurns=0;
 const response=(r:ProviderRuntimeRequest,text:string):ProviderRuntimeResponse=>({id:r.id+":response",requestId:r.id,providerId:r.providerId,modelId:r.modelId,text,finishReason:"stop",usageStatus:"unknown",createdAt:Date.now()});
 const adapter:ProviderAdapter={id:"synthetic",getCapabilities:()=>({providerId:"synthetic",modelIds:["test"],supportsTools:!clientTools,supportsTextInvestigation:true,supportsClientToolCalls:clientTools,supportsParallelInvestigation:true,supportsPreSendValidation:true,isMock:true}),async complete(request,options){
  if(!clientTools){
   const turn=++ordinaryTurns;
   if(turn===2)feedback.push(JSON.parse(request.messages.filter(message=>message.role==="tool").at(-1)!.content));
   return turn<=2?{...response(request,""),finishReason:"tool_calls",toolCalls:[{id:"ordinary-"+turn,name:"project_list_files",arguments:JSON.stringify({limit:turn===1?200:25,prefix:""})}]}:response(request,"Final report");
  }
  const role=String(request.metadata?.runId).split(":")[1];
  if(!role)return response(request,++leadTurns===1?'{"investigator":"Inspect source","reviewer":"Review gaps"}':"Final report");
  const sequence=role==="investigator"?limits:[100];
  for(const [index,limit] of sequence.entries()){
   const result=JSON.parse(await options!.executeClientTool!({id:role+"-invalid-"+index,name:"project_list_files",arguments:JSON.stringify({limit,prefix:""})}));
   feedback.push(result);
  }
  const result=JSON.parse(await options!.executeClientTool!({id:role+"-corrected",name:"project_list_files",arguments:JSON.stringify({limit:25,prefix:""})}));
  expect(result.status).toBe("completed");
  return response(request,role+" report");
 }};
 const lease=new RunScopeAuthority().approve(s,()=>true);
 const coordinator=new RunCoordinator({adapter,lease,registry,contextSources:{validate:async()=>true},store:{commit:async value=>{commits.push(structuredClone(value));}}});
 const draft={input:"Inspect synthetic project",projectId:s.projectId,conversationId:s.conversationId,providerId:s.providerId,modelId:s.modelId,investigationScopeId:s.id,taskMode:"investigation",collaboration:s.collaboration,permissionMode:"request_approval",reasoningEffort:"medium",runMode:"local",branch:null,contextPercent:null} as TaskDraft;
 return {coordinator,draft,inspect,feedback,commits};
}

it("corrects the recorded 200/100 limits without consuming either member's only read",async()=>{
 const h=setup([200]);const outcome=await h.coordinator.start("task",h.draft);
 expect(outcome.run.status,JSON.stringify({reason:outcome.run.stopReason,workers:outcome.run.collaboration?.workers,feedback:h.feedback,steps:outcome.run.steps})).toBe("completed");
 expect(outcome.run.toolCalls).toBe(2);
 expect(h.inspect).toHaveBeenCalledTimes(2);
 expect(h.feedback).toHaveLength(2);
 expect(h.feedback.every(result=>result.diagnosticCode==="invalid_tool_limit"&&result.effectState==="not_started"&&result.sources.length===0)).toBe(true);
 expect(outcome.run.steps).toHaveLength(4);
 expect(new Set(outcome.run.steps.map(step=>step.callId)).size).toBe(4);
 expect(h.commits.filter(commit=>commit.run.status==="completed").at(-1)?.run.toolCalls).toBe(2);
});

it("bounds correction feedback across different arguments and parallel members",async()=>{
 const h=setup([200,150,300]);const outcome=await h.coordinator.start("task",h.draft);
 expect(outcome.run).toMatchObject({status:"paused",stopReason:"failure_limit"});
 expect(h.feedback.length).toBeLessThanOrEqual(2);
 const invalidSteps=new Map(h.commits.flatMap(commit=>commit.run.steps).filter(step=>step.result?.diagnosticCode==="invalid_tool_limit").map(step=>[step.stepId,step]));
 expect(invalidSteps.size).toBe(3);
 expect(outcome.run.toolCalls).toBeLessThanOrEqual(1);
});

it("still blocks a corrected request outside the approved path scope without reading",async()=>{
 const h=setup([],true);const outcome=await h.coordinator.start("task",h.draft);
 expect(outcome.run).toMatchObject({status:"failed",stopReason:"tool_path_outside_scope"});
 expect(h.inspect).not.toHaveBeenCalled();
});

it("also corrects an ordinary provider tool call while preserving its only read",async()=>{
 const h=setup([200],false,false);const outcome=await h.coordinator.start("task",h.draft);
 expect(outcome.run.status,outcome.run.stopReason).toBe("completed");
 expect(outcome.run.toolCalls).toBe(1);
 expect(outcome.run.steps).toHaveLength(2);
 expect(h.inspect).toHaveBeenCalledTimes(1);
 expect(h.feedback[0]).toMatchObject({status:"failed",diagnosticCode:"invalid_tool_limit",effectState:"not_started",sources:[]});
 expect(h.feedback[0].output.parameters.properties.limit).toEqual({type:"integer",minimum:1,maximum:25});
});
