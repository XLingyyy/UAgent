import { describe, expect, it } from "vitest";
import { createProjectMemoryContext, selectProjectMemory } from "./selection.js";
import { memoryFixture, memoryPort, memoryRun, memoryScope } from "./test-fixtures.js";
import type { ProviderRuntimeMessage } from "@uagent/shared";
const messages: ProviderRuntimeMessage[] = [{role:"system",content:"Safety"},{role:"developer",content:"Scope"},{role:"user",content:"Inspect renderer"}];
const source = {validate: async () => true};
const input = () => ({scope:memoryScope(),messages,sources:source,signal:new AbortController().signal,isCurrent:()=>true});
describe("task goal memory retrieval",()=>{
  it("retrieves matching evidence, preserves constraints, excludes unrelated and private entries",async()=>{
    const chosen=await selectProjectMemory({...input(),query:"修复渲染renderer",memories:[
      memoryFixture("a",{body:"Audio mixer",sourceRefs:[] ,kind:"decision"}),
      memoryFixture("b",{body:"渲染线程 renderer",sourceRefs:[] ,kind:"decision"}),
      memoryFixture("c",{body:"Keep compatibility",priority:"constraint",sourceRefs:[],kind:"decision"}),
      memoryFixture("d",{body:"renderer secret",visibility:"private"}),
    ]});
    expect(chosen.plan.used.map(x=>x.id)).toEqual(["c","b"]);
    expect(chosen.plan.omitted).toContainEqual({id:"a",revision:2,reason:"not_relevant"});
    expect(JSON.stringify(chosen.messages)).not.toContain("Audio mixer");
    expect(JSON.stringify(chosen.messages)).not.toContain("renderer secret");
    expect(chosen.plan.usedBytes).toBeLessThanOrEqual(chosen.plan.maxBytes);
  });
  it("ranks matched memories ahead of earlier IDs within the existing byte budget",async()=>{
    const a=memoryFixture("a",{body:"renderer"+"x".repeat(1800)}),z=memoryFixture("z",{body:"renderer shader"+"x".repeat(1800)});
    const scope=memoryScope();scope.limits.maxContextBytes=3000;
    const chosen=await selectProjectMemory({...input(),scope,query:"renderer shader",memories:[a,z]});
    expect(chosen.plan.used.map(x=>x.id)).toEqual(["z"]);
    expect(chosen.plan.omitted).toContainEqual({id:"a",revision:2,reason:"budget"});
  });
  it("uses the actual goal, retains provenance and rejects a changed selection before transport",async()=>{
    const values=[memoryFixture("a",{body:"Audio",sourceRefs:[],kind:"decision"}),memoryFixture("z",{body:"Renderer design"})];
    const run=memoryRun();run.goal="Renderer";
    const prepared=await createProjectMemoryContext(memoryPort(values),source).prepare({run,messages,signal:new AbortController().signal,isCurrent:()=>true});
    expect(prepared.plan.used.map(x=>x.id)).toEqual(["z"]);
    expect(prepared.messages[2]!.content).toContain('"freshness":"stamp1"');
    expect(prepared.messages[2]!.content).toContain('"origin"');
    await prepared.beforeSend();values[1]!.revision++;
    await expect(prepared.beforeSend()).rejects.toThrow("project_memory_stale");
  });
  it("does not inject unrelated normal entries for a punctuation-only task",async()=>{
    const chosen=await selectProjectMemory({...input(),query:"?!",memories:[memoryFixture()]});
    expect(chosen.plan.used).toEqual([]);
    expect(chosen.plan.omitted[0]!.reason).toBe("not_relevant");
  });
});
