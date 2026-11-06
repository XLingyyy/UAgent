import { vi } from "vitest";
import type { TaskRun, TaskRunScope } from "@uagent/shared";
import type { ProjectMemory, ProjectMemoryStorePort } from "./contract.js";
export function memoryScope(): TaskRunScope {
  return { id:"scope",runId:"run",projectId:"A",conversationId:"chat",rootRef:"root",providerId:"synthetic",modelId:"model",endpoint:"https://invalid.example",mode:"read_only",readPrefixes:["Source"],sharePrefixes:["Source"],toolIds:["read"],expiresAt:Date.now()+60000,limits:{maxToolCalls:2,maxModelRequests:3,maxDurationMs:60000,maxAttemptsPerFailure:1,maxToolResultBytes:8192,maxContextBytes:6000} };
}
export function memoryRun(scope=memoryScope()): TaskRun {
  return {schemaVersion:1,runId:scope.runId,taskId:"task",projectId:scope.projectId,conversationId:scope.conversationId,goal:"Inspect Main",planVersion:1,status:"running",limits:scope.limits,scope,steps:[],modelRequests:0,toolCalls:0,createdAt:1,updatedAt:1};
}
export function memoryFixture(id="fact",overrides:Partial<ProjectMemory>={}):ProjectMemory{
  return {id,projectId:"A",kind:"fact",body:"SYNTHETIC_MEMORY_"+id,sourceRefs:[{projectId:"A",path:"Source/Main.cpp",version:"v1",freshness:"stamp1",kind:"file_preview"}],sharePaths:["Source"],priority:"normal",visibility:"project",origin:{kind:"model",sessionId:null,messageId:null},readAt:1,validity:"valid",revision:2,confirmation:{kind:"user",confirmedAt:2},...overrides};
}
export function memoryPort(memories:ProjectMemory[]):ProjectMemoryStorePort {
  return {
    list:vi.fn(async(input:Parameters<ProjectMemoryStorePort["list"]>[0])=>{const {projectId,afterId=null,limit=50}=input;return {schemaVersion:1 as const,projectId,afterId,limit,nextAfterId:null,memories:memories.filter(item=>item.projectId===projectId)};}),
    get:vi.fn(async(projectId:string,id:string)=>{const item=memories.find(memory=>memory.projectId===projectId&&memory.id===id);if(!item)throw Error("notFound");return structuredClone(item);}),
    create:vi.fn(async()=>{throw Error("unused");}),update:vi.fn(async(input:Parameters<ProjectMemoryStorePort["update"]>[0])=>{
      const index=memories.findIndex(memory=>memory.projectId===input.projectId&&memory.id===input.id);
      if(index<0)throw {kind:"notFound"};
      const current=memories[index]!;
      if(current.revision!==input.expectedRevision)throw {kind:"conflict"};
      if(input.mutation.type!=="markStale")throw Error("unused");
      memories[index]={...current,revision:current.revision+1,validity:"stale"};
      return structuredClone(memories[index]!);
    }),
  };
}
