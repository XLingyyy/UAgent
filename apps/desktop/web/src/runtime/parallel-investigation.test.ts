import {writeFileSync} from "node:fs";
import {join} from "node:path";
import {createNativeRunStore,type NativeRunCommitInput} from "./native-run-store";
import {expect,it,vi} from "vitest";
import {RunCoordinator,ToolRegistry,createDeepSeekAccountSession,createOutboundConsentGate,DEEPSEEK_MODEL,type ProviderAdapter} from "@uagent/runtime";
import type {TaskRunScope,TaskDraft,ProviderRuntimeRequest,ProviderRuntimeResponse,RunStoreCommit} from "@uagent/shared";
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
function fixture(mode="normal",models=false){
 const scope:TaskRunScope={id:"scope",runId:"run",projectId:"project",conversationId:"conversation",rootRef:"root",providerId:"synthetic",modelId:"model",endpoint:"https://invalid.example",mode:"read_only",collaboration:"independent_review",readPrefixes:["Source"],sharePrefixes:["Source"],toolIds:["project.read"],expiresAt:Date.now()+60000,limits:{maxModelRequests:9,maxToolCalls:6,maxDurationMs:60000,maxAttemptsPerFailure:2,maxToolResultBytes:8192,maxContextBytes:24576}};
 const draft={input:"Investigate value",projectId:scope.projectId,conversationId:scope.conversationId,providerId:scope.providerId,modelId:scope.modelId,investigationScopeId:scope.id,taskMode:"investigation",collaboration:"independent_review",permissionMode:"request_approval",reasoningEffort:"medium",runMode:"local",branch:null,contextPercent:null} as TaskDraft;
 if(mode.startsWith("dynamic")){scope.collaboration="dynamic_delegation";draft.collaboration="dynamic_delegation";}
 if(models){scope.collaborationMembers={investigator:{role:"test_analyst",focus:"Cancellation cases",model:{providerId:"configured-a",modelId:"model-a",endpoint:"https://api.openai.com/v1/responses"}},reviewer:{role:"performance_analyst",focus:"Disk reads",model:{providerId:"configured-b",modelId:"model-b",endpoint:"https://api.openai.com/v1/responses"}}};draft.collaborationMembers=structuredClone(scope.collaborationMembers);}
 if(mode.startsWith("dynamic-four")||mode==="dynamic-removed"){
  scope.collaborationMembers={...(scope.collaborationMembers??{investigator:{role:"source_analyst",focus:""},reviewer:{role:"risk_reviewer",focus:""}}),member_3:{role:"test_analyst",focus:"Coverage"},member_4:{role:"performance_analyst",focus:"Bottlenecks"}};
  if(mode==="dynamic-removed")delete scope.collaborationMembers.investigator;
  draft.collaborationMembers=structuredClone(scope.collaborationMembers);scope.limits.maxModelRequests=12;scope.limits.maxToolCalls=8;
 }
 if(mode.includes("serial-parent")){
  if(!mode.endsWith("blocked"))for(const [id,member] of Object.entries(scope.collaborationMembers!))if(!(mode.endsWith("one-shared")&&id==="member_4"))member.model={providerId:"configured-"+id,modelId:"model-"+id,endpoint:"https://api.openai.com/v1/responses"};
  draft.collaborationMembers=structuredClone(scope.collaborationMembers);
 }
 const memberIds=Object.keys(scope.collaborationMembers??{investigator:null,reviewer:null});
 const releases=memberIds.map(()=>deferred<void>()),requests:ProviderRuntimeRequest[]=[],commits:RunStoreCommit[]=[];let active=0,peak=0,current=true;
 const reads:string[]=[];
 const registry=new ToolRegistry([{id:"project.read",definition:{name:"read_source",description:"read",parameters:{type:"object",properties:{path:{type:"string"}},required:["path"],additionalProperties:false}},validate:()=>{},paths:a=>[a.path as string],execute:async(a,c)=>{reads.push(a.path as string);return {status:"completed",effectState:"not_started",output:{value:7},sources:[{projectId:c.projectId,path:a.path as string,version:"v1",kind:"file_preview"}],truncated:false};}}]);
 const counts=new Map<string,number>();
 const adapter:ProviderAdapter={id:"synthetic",getCapabilities:()=>({providerId:"synthetic",modelIds:["model"],supportsTools:true,supportsStreaming:false,supportsParallelInvestigation:!mode.includes("serial-parent"),isMock:true}),complete:async(request,options)=>{
  requests.push(request);const planning=scope.collaboration==="dynamic_delegation"&&!memberIds.some(id=>request.id.includes(":"+id+":"))&&!counts.has("planner");
  if(planning){counts.set("planner",1);expect(request.toolChoice).toBe("none");return {id:request.id+"-response",requestId:request.id,providerId:request.providerId,modelId:request.modelId,text:JSON.stringify(mode==="dynamic-invalid"?{investigator:"read",reviewer:"check",model:"override"}:Object.fromEntries(memberIds.map(id=>[id,id==="investigator"?"Trace source lifecycle and cancellation":id==="reviewer"?"Find missing tests and counterexamples":"Inspect "+id]))),finishReason:mode==="dynamic-length"?"length":"stop",createdAt:Date.now()} as ProviderRuntimeResponse;}
  const role=memberIds.find(id=>request.id.includes(":"+id+":"))??"synthesizer";
  const n=(counts.get(role)??0)+1;counts.set(role,n);active++;peak=Math.max(peak,active);
  try{
   if(role!=="synthesizer"&&n===1){
    expect(options?.parallelInvestigation).toBeDefined();
    await Promise.race([releases[memberIds.indexOf(role)].promise,new Promise<void>(resolve=>{if(options?.signal?.aborted)resolve();else options?.signal?.addEventListener("abort",()=>resolve(),{once:true});})]);
   }
   if((mode==="failure"||mode==="dynamic-failure"||mode==="dynamic-four-failure")&&role==="investigator")throw Error("synthetic provider failure");
   const call=role!=="synthesizer"&&(mode==="greedy"?request.toolChoice!=="none":n===1);
   return {id:request.id+"-response",requestId:request.id,providerId:request.providerId,modelId:request.modelId,text:role+"_REPORT",finishReason:call?"tool_calls":"stop",createdAt:Date.now(),...(call?{toolCalls:[{id:"same_id",name:"read_source",arguments:JSON.stringify({path:`Source/${role}.cpp`})}]}:{})} as ProviderRuntimeResponse;
  }finally{active--;}
 }};
 const nativeInputs:NativeRunCommitInput[]=[];
 const revisions=new Map<string,{revision:number;count:number}>();
 const nativeStore=createNativeRunStore(async(_command,args)=>{
   const c=args.input as NativeRunCommitInput;nativeInputs.push(c);const previous=revisions.get(c.runId)??{revision:0,count:0};
   expect(c.expectedRevision).toBe(previous.revision);expect(c.expectedMessageCount).toBe(previous.count);
   const next={revision:previous.revision+1,count:previous.count+c.batch.messages.length};revisions.set(c.runId,next);
   return {schemaVersion:1,projectId:c.projectId,runId:c.runId,revision:next.revision,messageCount:next.count};
 });
 const finalSaveRelease=deferred<void>();let finalSaveEntered=false;
 let failFinalSave=mode==="dynamic-final-save";
 let pauseAfterTool=mode==="native-pause";
 const coordinator=new RunCoordinator({adapter,registry,...(models?{createMemberAdapter:(_role,lease)=>{
 if(mode==="adapter-failure"&&_role==="reviewer")throw Error("unavailable");
 return {...adapter,id:lease.scope.providerId,getCapabilities:()=>({...adapter.getCapabilities(),providerId:lease.scope.providerId,modelIds:[lease.scope.modelId]})};
 }}:{}),lease:{scope,isCurrent:()=>current},store:{commit:async(c)=>{if(mode==="dynamic-save-inflight"&&c.run.runId==="run"&&c.run.status==="completed"){finalSaveEntered=true;await finalSaveRelease.promise;}if(failFinalSave&&c.run.runId==="run"&&c.run.status==="completed"){failFinalSave=false;throw Error("synthetic final save failure");}if(mode==="persist"&&c.run.runId.endsWith(":reviewer"))throw Error("synthetic storage failure");if(mode==="native-pause"||mode.startsWith("dynamic"))await nativeStore.commit(c);commits.push(c);
 if(pauseAfterTool&&c.run.runId.endsWith(":investigator")&&c.run.steps.some(step=>step.status==="completed")){pauseAfterTool=false;coordinator.requestPause();}
 }},contextSources:{validate:async()=>current}});
 return {scope,draft,coordinator,requests,commits,reads,releases,finalSaveRelease,finalSaveEntered:()=>finalSaveEntered,exportReplay:(name:string)=>{if(process.env.UAGENT_PARALLEL_REPLAY_DIR)writeFileSync(join(process.env.UAGENT_PARALLEL_REPLAY_DIR,name+".json"),JSON.stringify(nativeInputs));},peak:()=>peak,active:()=>active,stale:()=>{current=false;}};
}
it("parallel investigation overlaps isolated workers and joins both reports with append-only archives",async()=>{
 const f=fixture(),pending=f.coordinator.start("task",f.draft);await vi.waitFor(()=>expect(f.active()).toBe(2));expect(f.requests).toHaveLength(2);
 expect(f.requests.every(r=>r.messages.filter(m=>m.role==="tool").length===0)).toBe(true);
 f.releases[1].resolve();await vi.waitFor(()=>expect(f.reads).toHaveLength(1));expect(f.requests.some(r=>r.id==="run:model:5")).toBe(false);
 f.releases[0].resolve();const result=await pending;expect(result.run.status).toBe("completed");expect(f.peak()).toBe(2);expect(result.run.modelRequests).toBe(5);expect(result.run.toolCalls).toBe(2);
 expect(result.run.collaboration?.reports.map(r=>r.agentId)).toEqual(["investigator","reviewer"]);
 const synthesis=f.requests.at(-1)!;expect(synthesis.toolChoice).toBe("none");expect(JSON.stringify(synthesis)).toContain("investigator_REPORT");expect(JSON.stringify(synthesis)).toContain("reviewer_REPORT");
 expect(new Set(result.run.collaboration?.calls.map(c=>c.callId)).size).toBe(2);
 for(const id of ["run","run:investigator","run:reviewer"]){const rows=f.commits.filter(c=>c.run.runId===id);expect(rows.length).toBeGreaterThan(1);for(let i=1;i<rows.length;i++)expect(rows[i].messages.slice(0,rows[i-1].messages.length)).toEqual(rows[i-1].messages);}
});
it("parallel investigation partitions the total model and tool budget including synthesis",async()=>{
 const f=fixture("greedy"),pending=f.coordinator.start("task",f.draft);await vi.waitFor(()=>expect(f.active()).toBe(2));f.releases.forEach(r=>r.resolve());const result=await pending;
 expect(result.run.status).toBe("completed");expect(result.run.modelRequests).toBe(9);expect(result.run.toolCalls).toBe(6);expect(result.run.collaboration?.reports.map(r=>r.stepIds.length)).toEqual([3,3]);
});
it("parallel investigation pauses both tool queues and resumes without duplicate requests",async()=>{
 const f=fixture(),pending=f.coordinator.start("task",f.draft);await vi.waitFor(()=>expect(f.active()).toBe(2));f.coordinator.requestPause();f.releases.forEach(r=>r.resolve());
 expect((await pending).run.status).toBe("paused");expect(f.reads).toHaveLength(0);expect(f.requests).toHaveLength(2);
 const result=await f.coordinator.resume();expect(result.run.status).toBe("completed");expect(f.requests).toHaveLength(5);expect(f.reads).toHaveLength(2);
});
it.each(["cancel","failure","stale"])("parallel investigation drains both workers on %s and never synthesizes",async(mode)=>{
 const f=fixture(mode),pending=f.coordinator.start("task",f.draft);await vi.waitFor(()=>expect(f.active()).toBe(2));
 if(mode==="cancel")f.coordinator.cancel();if(mode==="stale")f.stale();f.releases[0].resolve();if(mode==="stale")f.releases[1].resolve();
 const result=await pending;expect(result.run.status).toBe(mode==="cancel"?"cancelled":mode==="failure"?"failed":"paused");expect(f.active()).toBe(0);expect(f.requests).toHaveLength(2);expect(result.run.collaboration?.reports).toHaveLength(0);
});
it("parallel investigation storage failure pauses the sibling without false success",async()=>{
 const f=fixture("persist"),pending=f.coordinator.start("task",f.draft);f.releases.forEach(r=>r.resolve());const result=await pending;expect(result.run.status).toBe("paused");expect(result.run.stopReason).toBe("persistence_failed");expect(result.run.collaboration?.reports).toHaveLength(0);
});
const envelope={endpoint:"https://invalid.example",model:"synthetic",projectId:"p",epoch:1,revision:"r",body:"first"};
it("parallel investigation approval queue binds each body and aborts only the matching entry",async()=>{
 const gate=createOutboundConsentGate(),abort=new AbortController();const a=gate.review(envelope),id=gate.getPending()!.id;
 const b=gate.review({...envelope,body:"second"},abort.signal);const rejection=expect(b).rejects.toThrow("revoked");abort.abort();await rejection;expect(gate.getPending()!.id).toBe(id);gate.approve(id);expect((await a).consume(envelope)).toBe(true);expect(gate.getPending()).toBeNull();
});
it("parallel investigation invalidation revokes queued reviews and previously approved grants",async()=>{
 const gate=createOutboundConsentGate(),a=gate.review(envelope);gate.approve(gate.getPending()!.id);const grant=await a;
 const b=gate.review(envelope),c=gate.review({...envelope,body:"third"});const checks=[expect(b).rejects.toThrow("revoked"),expect(c).rejects.toThrow("revoked")];gate.invalidate();await Promise.all(checks);expect(gate.getPending()).toBeNull();expect(grant.consume(envelope)).toBe(false);
});
it("parallel investigation account transport overlaps after separate queued approvals and rejects unrelated work",async()=>{
 const gate=createOutboundConsentGate(),releases=[deferred<Response>(),deferred<Response>()];let count=0;
 const fetcher=vi.fn(()=>releases[count++].promise) as unknown as typeof fetch;
 const session=createDeepSeekAccountSession({mode:"offline",expiresAt:Date.now()+60000,outboundGate:gate,fetcher});session.setCredential("synthetic-key");
 const group={},request=(id:string):ProviderRuntimeRequest=>({id,providerId:"deepseek",modelId:DEEPSEEK_MODEL,messages:[{role:"user",content:id}],metadata:{purpose:"investigation",runId:id,scopeRef:"scope"}});
 const a=session.adapter.complete(request("a"),{parallelInvestigation:group}),b=session.adapter.complete(request("b"),{parallelInvestigation:group});
 await vi.waitFor(()=>expect(gate.getPending()).not.toBeNull());const first=gate.getPending()!;gate.approve(first.id);await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
 await expect(session.adapter.complete(request("different-group"),{parallelInvestigation:{}})).rejects.toMatchObject({code:"provider_unavailable"});
 expect(gate.getPending()!.envelope.body).not.toBe(first.envelope.body);gate.approve(first.id);expect(fetcher).toHaveBeenCalledTimes(1);gate.approve(gate.getPending()!.id);await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));
 await expect(session.adapter.complete(request("third"),{parallelInvestigation:group})).rejects.toMatchObject({code:"provider_unavailable"});await expect(session.adapter.complete(request("unrelated"))).rejects.toMatchObject({code:"provider_unavailable"});
 const response=()=>new Response('data: {"choices":[{"delta":{"content":"synthetic"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}}\n\ndata: [DONE]\n\n',{headers:{"Content-Type":"text/event-stream"}});
 releases.forEach(r=>r.resolve(response()));expect((await Promise.all([a,b])).map(r=>r.text)).toEqual(["synthetic","synthetic"]);session.clearCredential();
});

it("parallel investigation saves native-mapped child tool evidence across pause and resume",async()=>{
 const f=fixture("native-pause"),pending=f.coordinator.start("task",f.draft);await vi.waitFor(()=>expect(f.active()).toBe(2));f.releases.forEach(r=>r.resolve());
 const paused=await pending;expect(paused.run.status).toBe("paused");expect(paused.run.stopReason).toBe("user_paused");expect(paused.run.steps).toHaveLength(0);expect(paused.run.collaboration?.workers).toHaveLength(2);expect(f.reads.length).toBeGreaterThan(0);
 const result=await f.coordinator.resume();expect(result.run.status).toBe("completed");expect(result.run.steps).toHaveLength(2);expect(f.reads).toHaveLength(2);expect(f.requests).toHaveLength(5);f.exportReplay("completed");
});

it("parallel investigation account cancellation drains in-flight and queued approvals without a second send",async()=>{
 const gate=createOutboundConsentGate(),fetcher=vi.fn(()=>new Promise<Response>(()=>{})) as unknown as typeof fetch;
 const session=createDeepSeekAccountSession({mode:"offline",expiresAt:Date.now()+60000,outboundGate:gate,fetcher});session.setCredential("synthetic-key");
 const group={},request=(id:string):ProviderRuntimeRequest=>({id,providerId:"deepseek",modelId:DEEPSEEK_MODEL,messages:[{role:"user",content:id}],metadata:{purpose:"investigation",runId:id,scopeRef:"scope"}});
 const requests=[session.adapter.complete(request("a"),{parallelInvestigation:group}),session.adapter.complete(request("b"),{parallelInvestigation:group})];const settled=Promise.allSettled(requests);
 gate.approve(gate.getPending()!.id);await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));expect(gate.getPending()).not.toBeNull();session.clearCredential();
 const results=await settled;expect(results.every(r=>r.status==="rejected"&&r.reason.code==="cancelled")).toBe(true);expect(gate.getPending()).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
});
it("parallel investigation native-mapped cancellation after tools retains child evidence without synthesis",async()=>{
 const f=fixture("native-pause"),pending=f.coordinator.start("task",f.draft);await vi.waitFor(()=>expect(f.active()).toBe(2));f.releases.forEach(r=>r.resolve());await pending;
 const before=f.requests.length;f.coordinator.cancel();await vi.waitFor(()=>expect(f.commits.filter(c=>c.run.runId==="run").at(-1)?.run.status).toBe("cancelled"));
 expect(f.coordinator.getSnapshot()?.stopReason).toBe("cancelled");expect(f.requests).toHaveLength(before);expect(f.commits.some(c=>c.run.parentRunId==="run"&&c.run.steps.some(s=>s.status==="completed"))).toBe(true);f.exportReplay("cancelled");
});

const configuredMembers={investigator:{role:"test_analyst" as const,focus:"Cancellation coverage"},reviewer:{role:"performance_analyst" as const,focus:"Repeated disk reads"}};
it("configurable members independently execute assigned specialties and persist through pause resume",async()=>{
 const f=fixture("native-pause");f.scope.collaborationMembers=structuredClone(configuredMembers);f.draft.collaborationMembers=structuredClone(configuredMembers);
 const pending=f.coordinator.start("task",f.draft);await vi.waitFor(()=>expect(f.active()).toBe(2));
 const first=f.requests.find(r=>r.id.includes(":investigator:"))!,second=f.requests.find(r=>r.id.includes(":reviewer:"))!;
 expect(JSON.stringify(first)).toContain("test_analyst");expect(JSON.stringify(first)).toContain("Cancellation coverage");expect(JSON.stringify(first)).not.toContain("Repeated disk reads");
 expect(JSON.stringify(second)).toContain("performance_analyst");expect(JSON.stringify(second)).not.toContain("Cancellation coverage");expect(first.modelId).toBe(second.modelId);
 f.releases.forEach(r=>r.resolve());expect((await pending).run.status).toBe("paused");const result=await f.coordinator.resume();expect(result.run.status).toBe("completed");expect(result.run.collaboration?.members).toEqual(configuredMembers);
 expect(JSON.stringify(f.requests.at(-1))).toContain("Cancellation coverage");expect(JSON.stringify(f.requests.at(-1))).toContain("Repeated disk reads");expect(result.run.toolCalls).toBe(2);f.exportReplay("completed");
});
it("configurable members cannot change assignments after scope approval",async()=>{
 const f=fixture();f.scope.collaborationMembers=structuredClone(configuredMembers);f.draft.collaborationMembers=structuredClone(configuredMembers);f.draft.collaborationMembers.reviewer.focus="Changed after approval";
 await expect(f.coordinator.start("task",f.draft)).rejects.toThrow("run_scope_mismatch");expect(f.requests).toHaveLength(0);
});
it.each(["role","focus","authority","control"])("configurable members reject invalid %s before requesting a model",async(kind)=>{
 const f=fixture(),members:any=structuredClone(configuredMembers);if(kind==="role")members.investigator.role="executor";if(kind==="focus")members.investigator.focus="x".repeat(241);if(kind==="authority")members.investigator.approval=true;if(kind==="control")members.investigator.focus="bad\u0085focus";
 f.scope.collaborationMembers=members;f.draft.collaborationMembers=structuredClone(members);await expect(f.coordinator.start("task",f.draft)).rejects.toThrow("invalid_collaboration_members");expect(f.requests).toHaveLength(0);
});

it("member models route two concurrent specialists to distinct adapters and keep main-model synthesis",async()=>{
 const f=fixture("native-pause",true),pending=f.coordinator.start("task",f.draft);await vi.waitFor(()=>expect(f.active()).toBe(2));
 expect(f.requests.map(r=>[r.providerId,r.modelId])).toEqual([["configured-a","model-a"],["configured-b","model-b"]]);
 f.releases.forEach(r=>r.resolve());expect((await pending).run.status).toBe("paused");const result=await f.coordinator.resume();expect(result.run.status).toBe("completed");expect(f.peak()).toBe(2);
 expect(f.requests.at(-1)?.providerId).toBe("synthetic");expect(f.requests.at(-1)?.modelId).toBe("model");expect(result.run.modelRequests).toBe(5);expect(result.run.toolCalls).toBe(2);
 const children=f.commits.filter(c=>c.run.parentRunId==="run");expect(new Set(children.map(c=>c.run.scope.providerId))).toEqual(new Set(["configured-a","configured-b"]));f.exportReplay("completed");
});
it.each(["cancel","failure"])("member models stop both selected adapters on %s without synthesis",async(mode)=>{
 const f=fixture(mode,true),pending=f.coordinator.start("task",f.draft);await vi.waitFor(()=>expect(f.active()).toBe(2));if(mode==="cancel")f.coordinator.cancel();f.releases[0].resolve();const result=await pending;
 expect(result.run.status).toBe(mode==="cancel"?"cancelled":"failed");expect(f.active()).toBe(0);expect(f.requests).toHaveLength(2);
});
it("member models reject a missing adapter before either member starts",async()=>{
 const f=fixture("adapter-failure",true);const result=await f.coordinator.start("task",f.draft);expect(result.run.status).toBe("failed");expect(f.requests).toHaveLength(0);expect(result.run.collaboration?.reports).toHaveLength(0);
});
it("member models cannot change the approved model identity",async()=>{
 const f=fixture("normal",true);f.draft.collaborationMembers!.reviewer.model!.modelId="changed";await expect(f.coordinator.start("task",f.draft)).rejects.toThrow("run_scope_mismatch");expect(f.requests).toHaveLength(0);
});

it("dynamic delegation plans first then overlaps assigned members and archives synthesis",async()=>{
 const f=fixture("dynamic",true),pending=f.coordinator.start("task",f.draft);await vi.waitFor(()=>expect(f.active()).toBe(2));
 expect(f.requests).toHaveLength(3);expect(f.requests[0].messages[1].content).toContain("lead agent");
 const investigator=f.requests.find(r=>r.id.includes(":investigator:"))!,reviewer=f.requests.find(r=>r.id.includes(":reviewer:"))!;
 expect(investigator.providerId).toBe("configured-a");expect(reviewer.providerId).toBe("configured-b");expect(JSON.stringify(investigator)).toContain("Trace source lifecycle and cancellation");expect(JSON.stringify(investigator)).not.toContain("Find missing tests and counterexamples");expect(JSON.stringify(reviewer)).toContain("Find missing tests and counterexamples");
 f.releases.forEach(r=>r.resolve());const result=await pending;expect(result.run.status).toBe("completed");expect(f.peak()).toBe(2);expect(result.run.modelRequests).toBe(6);expect(result.run.toolCalls).toBe(2);expect(result.run.collaboration?.assignments?.investigator).toContain("lifecycle");expect(JSON.stringify(f.requests.at(-1))).toContain("reviewer_REPORT");f.exportReplay("completed");
});
it("dynamic delegation rejects invalid planner authority fields before creating workers",async()=>{const f=fixture("dynamic-invalid");const result=await f.coordinator.start("task",f.draft);expect(result.run.status).toBe("failed");expect(result.run.stopReason).toBe("delegation_plan_invalid");expect(f.requests).toHaveLength(1);expect(f.reads).toHaveLength(0);});
it("dynamic delegation cancellation drains assigned workers and never synthesizes",async()=>{const f=fixture("dynamic"),pending=f.coordinator.start("task",f.draft);await vi.waitFor(()=>expect(f.active()).toBe(2));f.coordinator.cancel();const result=await pending;expect(result.run.status).toBe("cancelled");expect(f.active()).toBe(0);expect(f.requests).toHaveLength(3);f.exportReplay("cancelled");});
it("dynamic delegation pause resumes assigned workers without repeating planning",async()=>{const f=fixture("dynamic"),pending=f.coordinator.start("task",f.draft);await vi.waitFor(()=>expect(f.active()).toBe(2));f.coordinator.requestPause();f.releases.forEach(r=>r.resolve());expect((await pending).run.status).toBe("paused");const result=await f.coordinator.resume();expect(result.run.status).toBe("completed");expect(f.requests).toHaveLength(6);expect(result.run.modelRequests).toBe(6);});
it("dynamic delegation requires its separately approved mode and adequate shared budget",async()=>{const f=fixture("dynamic");f.draft.collaboration="independent_review";await expect(f.coordinator.start("task",f.draft)).rejects.toThrow("run_scope_mismatch");expect(f.requests).toHaveLength(0);const low=fixture("dynamic");low.scope.limits.maxModelRequests=5;await expect(low.coordinator.start("task",low.draft)).rejects.toThrow("invalid_run_limits");});

it("dynamic delegation truncated planner resume preserves worker and synthesis budget",async()=>{const f=fixture("dynamic-length");f.scope.limits.maxModelRequests=6;const first=await f.coordinator.start("task",f.draft);expect(first.run.stopReason).toBe("output_limit");expect(f.requests).toHaveLength(1);const resumed=await f.coordinator.resume();expect(resumed.run.stopReason).toBe("delegation_planner_budget_reserved");expect(f.requests).toHaveLength(1);expect(f.reads).toHaveLength(0);});

it("dynamic execution resumes final persistence without repeating synthesis",async()=>{
 const f=fixture("dynamic-final-save"),pending=f.coordinator.start("task",f.draft);await vi.waitFor(()=>expect(f.active()).toBe(2));f.releases.forEach(r=>r.resolve());
 const paused=await pending;expect(paused.run.status).toBe("paused");expect(paused.run.stopReason).toBe("persistence_failed");expect(f.requests).toHaveLength(6);expect(paused.text).toBe("synthesizer_REPORT");expect(paused.run.finishedAt).toBeUndefined();
 const result=await f.coordinator.resume();expect(result.run.status).toBe("completed");expect(f.requests).toHaveLength(6);expect(result.messages.filter(m=>m.role==="assistant"&&m.content==="synthesizer_REPORT")).toHaveLength(1);f.exportReplay("completed");
});

it("dynamic execution cancelling pending completion never resends or records success",async()=>{
 const f=fixture("dynamic-final-save"),pending=f.coordinator.start("task",f.draft);await vi.waitFor(()=>expect(f.active()).toBe(2));f.releases.forEach(r=>r.resolve());expect((await pending).run.status).toBe("paused");f.coordinator.cancel();await vi.waitFor(()=>expect(f.commits.filter(c=>c.run.runId==="run").at(-1)?.run.status).toBe("cancelled"));expect(f.requests).toHaveLength(6);await expect(f.coordinator.resume()).rejects.toThrow("run_not_paused");f.exportReplay("cancelled");
});
it("dynamic execution member failure drains sibling and archives failure without synthesis",async()=>{
 const f=fixture("dynamic-failure",true),pending=f.coordinator.start("task",f.draft);await vi.waitFor(()=>expect(f.active()).toBe(2));f.releases[0].resolve();const result=await pending;expect(result.run.status).toBe("failed");expect(f.active()).toBe(0);expect(f.requests).toHaveLength(3);expect(result.run.collaboration?.reports).toHaveLength(0);expect(f.commits.filter(c=>c.run.runId==="run").at(-1)?.run.status).toBe("failed");
});

it("dynamic execution acknowledged final save wins cancellation without rewriting terminal archive",async()=>{
 const f=fixture("dynamic-save-inflight"),pending=f.coordinator.start("task",f.draft);await vi.waitFor(()=>expect(f.active()).toBe(2));f.releases.forEach(r=>r.resolve());await vi.waitFor(()=>expect(f.finalSaveEntered()).toBe(true));f.coordinator.cancel();f.finalSaveRelease.resolve();const result=await pending;expect(result.run.status).toBe("completed");expect(f.requests).toHaveLength(6);expect(f.commits.filter(c=>c.run.runId==="run").at(-1)?.run.status).toBe("completed");expect(f.commits.filter(c=>c.run.runId==="run"&&c.run.status==="cancelled")).toHaveLength(0);f.exportReplay("completed");
});

it.each(["dynamic-four","dynamic-removed"])("configured members execute, budget and archive %s",async(mode)=>{
 const f=fixture(mode,true),ids=Object.keys(f.scope.collaborationMembers!),pending=f.coordinator.start("task",f.draft);
 await vi.waitFor(()=>expect(f.active()).toBe(ids.length));f.releases.forEach(r=>r.resolve());const result=await pending;
 expect(result.run.status).toBe("completed");expect(f.peak()).toBe(ids.length);expect(result.run.collaboration?.reports.map(r=>r.agentId)).toEqual(ids);
 expect(Object.keys(result.run.collaboration!.assignments!)).toEqual(ids);expect(result.run.modelRequests).toBe(2*ids.length+2);expect(result.run.toolCalls).toBe(ids.length);
 for(const id of ids){expect(JSON.stringify(f.requests.at(-1))).toContain(id+"_REPORT");expect(f.commits.some(c=>c.run.runId==="run:"+id&&c.run.status==="completed")).toBe(true);}
 expect(f.requests.some(q=>q.providerId==="configured-b")).toBe(true);expect(f.requests.filter(q=>q.id.includes(":member_3:")).every(q=>q.providerId==="synthetic")).toBe(true);
 if(mode==="dynamic-removed")expect(f.requests.some(q=>q.id.includes(":investigator:"))).toBe(false);
 f.exportReplay(mode);
});
it.each(["cancel","failure"])("configured members drain all siblings on %s",async(kind)=>{
 const f=fixture(kind==="failure"?"dynamic-four-failure":"dynamic-four"),pending=f.coordinator.start("task",f.draft);
 await vi.waitFor(()=>expect(f.active()).toBe(4));if(kind==="cancel")f.coordinator.cancel();else f.releases[0].resolve();
 const result=await pending;expect(result.run.status).toBe(kind==="cancel"?"cancelled":"failed");expect(f.active()).toBe(0);expect(f.requests).toHaveLength(5);
});

it("configured members independent mode can remove investigator before first native commit",async()=>{
 const f=fixture("dynamic-removed",true);f.scope.collaboration="independent_review";f.draft.collaboration="independent_review";
 const pending=f.coordinator.start("task",f.draft);await vi.waitFor(()=>expect(f.active()).toBe(3));f.releases.forEach(r=>r.resolve());const result=await pending;
 expect(result.run.status).toBe("completed");expect(f.commits[0].run.collaboration?.activeAgent).toBe("reviewer");expect(f.requests).toHaveLength(7);f.exportReplay("independent-removed");
});

it.each(["all-profiles","one-shared"])("serial parent with independent member sessions completes %s",async(kind)=>{
 const f=fixture("dynamic-four-serial-parent-"+kind,true),pending=f.coordinator.start("task",f.draft);
 await vi.waitFor(()=>expect(f.active()).toBe(4));f.releases.forEach(r=>r.resolve());const result=await pending;
 expect(result.run.status).toBe("completed");expect(f.requests).toHaveLength(10);expect(result.run.collaboration?.reports).toHaveLength(4);expect(f.peak()).toBe(4);
});
it("serial parent rejects multiple shared member sessions before any request",async()=>{
 const f=fixture("dynamic-four-serial-parent-blocked",true);await expect(f.coordinator.start("task",f.draft)).rejects.toThrow("configured_members_parallel_required");expect(f.requests).toHaveLength(0);expect(f.commits).toHaveLength(0);
});
