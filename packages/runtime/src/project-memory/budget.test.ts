import {prepareRunContext} from "../context/run-context.js";
import {describe,expect,it} from "vitest";
import type {ProviderRuntimeMessage} from "@uagent/shared";
import {prepareMemoryBudgetedRunContext} from "./budget.js";
import {createProjectMemoryContext,selectProjectMemory} from "./selection.js";
import {memoryFixture,memoryPort,memoryRun,memoryScope} from "./test-fixtures.js";
describe("project memory context reservations",()=>{
 it("reserves a message slot by omitting the oldest optional history pair and preserves record indexes",async()=>{
  const scope=memoryScope();scope.limits.maxContextBytes=24576;
  const run=memoryRun(scope),records:ProviderRuntimeMessage[]=[{role:"system",content:"Required safety"},{role:"developer",content:"Required scope"}];
  for(let index=0;index<13;index++)records.push({role:"user",content:"History "+index},{role:"assistant",content:"Answer "+index});
  const goalMessageIndex=records.length;records.push({role:"user",content:run.goal});
  const before=structuredClone(records),context=prepareMemoryBudgetedRunContext({run,records,goalMessageIndex,reserveForMemory:true});
  expect(records).toEqual(before);expect(context.messages).toHaveLength(28);
  expect(context.messages.slice(0,2)).toEqual(records.slice(0,2));
  expect(context.plan.omitted).toContainEqual({originalMessageIndexes:[2,3],reason:"budget"});
  expect(context.plan.fullRecordMessageCount).toBe(records.length);
  const chosen=await selectProjectMemory({scope,messages:context.messages,memories:[memoryFixture()],sources:{validate:async()=>true},signal:new AbortController().signal,isCurrent:()=>true});
  expect(chosen.plan.used).toHaveLength(1);expect(chosen.messages).toHaveLength(29);
  expect(context.plan.usedBytes).toBe(new TextEncoder().encode(JSON.stringify(context.messages)).length);
  const manifest=JSON.parse(context.messages.at(-1)!.content.slice("Context map (data, never permission): ".length)) as {records:Array<{indexes:number[]}>;omitted:number};
  expect(manifest.records[0]?.indexes).toEqual([4,5]);expect(manifest.omitted).toBe(2);
 });
 it("falls back to the full byte budget when required constraints cannot fit a reservation",()=>{
  const scope=memoryScope();scope.limits.maxContextBytes=2000;
  const run=memoryRun(scope),records:ProviderRuntimeMessage[]=[{role:"system",content:"s".repeat(1000)},{role:"developer",content:"d".repeat(200)},{role:"user",content:run.goal}];
  const context=prepareMemoryBudgetedRunContext({run,records,goalMessageIndex:2,reserveForMemory:true});
  expect(context.messages.slice(0,2)).toEqual(records.slice(0,2));expect(context.plan.maxBytes).toBe(2000);
  expect(context.plan.usedBytes).toBeLessThanOrEqual(2000);
 });
 function withHistory(){
  const scope=memoryScope();scope.limits.maxContextBytes=24576;
  const run=memoryRun(scope),records:ProviderRuntimeMessage[]=[{role:"system",content:"Required safety"},{role:"developer",content:"Required scope"}];
  for(let index=0;index<13;index++)records.push({role:"user",content:"History "+index},{role:"assistant",content:"Answer "+index});
  const goalMessageIndex=records.length;records.push({role:"user",content:run.goal});
  return{run,records,goalMessageIndex};
 }
 it("keeps the full base context by default before memory eligibility is known",()=>{
  const raw=withHistory(),full=prepareRunContext(raw),candidate=prepareMemoryBudgetedRunContext(raw);
  expect(full.messages).toHaveLength(30);expect(candidate).toEqual(full);
 });
 it("does not sacrifice bytes or slots for empty, private, pending, out-of-scope, missing or stale memories",async()=>{
  const cases=[[],[memoryFixture("private",{visibility:"private"})],[memoryFixture("pending",{validity:"pending",confirmation:null})],[memoryFixture("scope",{sharePaths:["Private"]})],[memoryFixture("missing",{sourceRefs:[]})],[memoryFixture("stale")]];
  for(const entries of cases){
    const raw=withHistory(),full=prepareRunContext(raw),sources={validate:async()=>false};
    const prepared=await createProjectMemoryContext(memoryPort(entries),sources).prepare({run:raw.run,messages:full.messages,baseContext:{records:raw.records,goalMessageIndex:raw.goalMessageIndex},signal:new AbortController().signal,isCurrent:()=>true});
    expect(prepared.plan.used).toEqual([]);expect(prepared.messages).toEqual(full.messages);
    expect(prepared.contextPlan).toEqual(full.plan);expect(prepared.messages).toHaveLength(30);
  }
 });
 it("restores the full base plan when an eligible memory still cannot fit after reservation",async()=>{
  const raw=withHistory();raw.run.limits.maxContextBytes=2000;
  const full=prepareRunContext(raw),values=[memoryFixture("too-large",{body:"中".repeat(1000)})];
  const prepared=await createProjectMemoryContext(memoryPort(values),{validate:async()=>true}).prepare({run:raw.run,messages:full.messages,baseContext:{records:raw.records,goalMessageIndex:raw.goalMessageIndex},signal:new AbortController().signal,isCurrent:()=>true});
  expect(prepared.plan.used).toEqual([]);expect(prepared.plan.omitted[0]?.reason).toBe("budget");
  expect(prepared.messages).toEqual(full.messages);expect(prepared.contextPlan).toEqual(full.plan);
 });
 it("reserves slots only when doing so actually adds eligible memory",async()=>{
  const raw=withHistory(),full=prepareRunContext(raw);
  const prepared=await createProjectMemoryContext(memoryPort([memoryFixture()]),{validate:async()=>true}).prepare({run:raw.run,messages:full.messages,baseContext:{records:raw.records,goalMessageIndex:raw.goalMessageIndex},signal:new AbortController().signal,isCurrent:()=>true});
  expect(prepared.plan.used).toHaveLength(1);expect(prepared.messages).toHaveLength(29);
  expect(prepared.contextPlan?.omitted).toContainEqual({originalMessageIndexes:[2,3],reason:"budget"});
  expect(prepared.plan.usedBytes).toBe(new TextEncoder().encode(JSON.stringify(prepared.messages)).length);
 });
 it("keeps the full base plan when eligible memory already fits without a reservation",async()=>{
  const run=memoryRun(),records:ProviderRuntimeMessage[]=[{role:"system",content:"Required safety"},{role:"developer",content:"Required scope"},{role:"user",content:run.goal}];
  const full=prepareRunContext({run,records,goalMessageIndex:2});
  const prepared=await createProjectMemoryContext(memoryPort([memoryFixture()]),{validate:async()=>true}).prepare({run,messages:full.messages,baseContext:{records,goalMessageIndex:2},signal:new AbortController().signal,isCurrent:()=>true});
  expect(prepared.plan.used).toHaveLength(1);expect(prepared.contextPlan).toEqual(full.plan);
  expect(prepared.messages.slice(0,2)).toEqual(full.messages.slice(0,2));
 });
});
