import { describe, expect, it } from "vitest";
import type { ProviderRuntimeRequest, ProviderRuntimeResponse, TaskDraft } from "@uagent/shared";
import type { ProviderAdapter } from "../provider/provider-adapter.js";
import { RunCoordinator } from "../run/run-coordinator.js";
import { ToolRegistry } from "../run/tool-registry.js";
import { createProjectMemoryContext } from "./selection.js";
import { memoryFixture, memoryPort, memoryScope } from "./test-fixtures.js";

/** Requires central's RunCoordinator projectMemory integration. No paid API or filesystem. */
describe("coordinator project-memory transport barrier",()=>{
  async function execute(changeDuringApproval:boolean, isMock=true){
    const scope=memoryScope(),values=[memoryFixture("current"),memoryFixture("stale"),memoryFixture("outside",{sharePaths:["Private"]})];
    const sent:ProviderRuntimeRequest[]=[];
    let changed=false;
    const sources={validate:async(refs:readonly {version:string}[])=>!changed&&refs.every(ref=>ref.version!=="old")};
    values[1]!.sourceRefs[0]!.version="old";
    values.push(memoryFixture("unrelated",{body:"SYNTHETIC_AUDIO_ONLY",kind:"decision",sourceRefs:[]}));
    values.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    const projectMemory=createProjectMemoryContext(memoryPort(values),sources);
    const adapter:ProviderAdapter={
      id:"synthetic",
      getCapabilities:()=>({providerId:"synthetic",modelIds:["model"],supportsTools:true,supportsStreaming:false,isMock}),
      async complete(request,options):Promise<ProviderRuntimeResponse>{
        // Simulate an exact-body approval wait followed by its transport barrier.
        if(changeDuringApproval)changed=true;
        await options?.beforeSend?.();
        sent.push(structuredClone(request));
        return{id:"answer",requestId:request.id,providerId:request.providerId,modelId:request.modelId,text:"done",finishReason:"stop",usage:{inputTokens:1,outputTokens:1,totalTokens:2},createdAt:3};
      },
    };
    const registry=new ToolRegistry([{id:"read",definition:{name:"read",description:"synthetic read",parameters:{type:"object",properties:{},additionalProperties:false}},validate:()=>{},paths:()=>[],execute:async()=>({status:"completed",effectState:"not_started",output:null,sources:[],truncated:false})}]);
    const options={adapter,registry,lease:{scope,isCurrent:()=>true},contextSources:sources,projectMemory};
    const coordinator=new RunCoordinator(options);
    const draft:TaskDraft={input:"Inspect Main",projectId:scope.projectId,conversationId:scope.conversationId,taskMode:"investigation",investigationScopeId:scope.id,providerId:scope.providerId,modelId:scope.modelId,permissionMode:"request_approval",reasoningEffort:"low",runMode:"local",branch:null,contextPercent:null};
    await coordinator.start("task",draft);
    if (!isMock) expect(coordinator.getSnapshot()?.status).toBe("paused");
    return sent;
  }
  it("sends current memory through the actual coordinator and excludes stale/outbound-denied text",async()=>{
    const sent=await execute(false);
    expect(sent).toHaveLength(1);const wire=JSON.stringify(sent[0]);
    expect(wire).toContain("SYNTHETIC_MEMORY_current");expect(wire).not.toContain("SYNTHETIC_MEMORY_stale");expect(wire).not.toContain("SYNTHETIC_MEMORY_outside");expect(wire).not.toContain("SYNTHETIC_AUDIO_ONLY");
  });
  it("keeps unvalidated native dispatch closed",async()=>{expect(await execute(false,false)).toEqual([]);});
  it("prevents transport if a chosen source changes during approval",async()=>{
    expect(await execute(true)).toEqual([]);
  });
});
