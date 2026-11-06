import { memoryFixture, memoryPort, memoryRun, memoryScope } from "./test-fixtures.js";
import { describe, expect, it, vi } from "vitest";
import type { ProviderRuntimeMessage } from "@uagent/shared";
import { prepareRunContext } from "../context/run-context.js";
import { createProjectMemoryContext, selectProjectMemory } from "./selection.js";
import { parseProjectMemory, type ProjectMemory, type ProjectMemoryStorePort } from "./contract.js";

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
function base(run=memoryRun()):ProviderRuntimeMessage[]{
  return prepareRunContext({run,records:[{role:"system",content:"Mandatory safety"},{role:"developer",content:"Mandatory Source-only scope"},{role:"user",content:run.goal}],goalMessageIndex:2}).messages;
}
const input=(memories:ProjectMemory[],scope=memoryScope())=>({memories,scope,messages:base(memoryRun(scope)),sources:{validate:vi.fn(async()=>true)},signal:new AbortController().signal,isCurrent:()=>true});
describe("project memory selection",()=>{
  it("isolates A/B, enforces current outbound paths, and never sends private text",async()=>{
    const other=memoryFixture("B",{projectId:"B",sourceRefs:[{projectId:"B",path:"Source/Main.cpp",version:"v1",freshness:"stamp1",kind:"file_preview"}]});
    const chosen=await selectProjectMemory(input([memoryFixture(),other,other,memoryFixture("denied",{sharePaths:["Private"]}),memoryFixture("private",{visibility:"private"})]));
    expect(chosen.plan.used.map(item=>item.id)).toEqual(["fact"]);
    expect(chosen.plan.omitted).toContainEqual({id:"[other project]",revision:0,reason:"other_project"});
    expect(chosen.plan.omitted.map(item=>item.reason)).toEqual(expect.arrayContaining(["other_project","scope","private"]));
    expect(JSON.stringify(chosen.plan)).not.toContain('"id":"B"');
    const wire=JSON.stringify(chosen.messages);expect(wire).not.toContain("SYNTHETIC_MEMORY_B");expect(wire).not.toContain("SYNTHETIC_MEMORY_denied");expect(wire).not.toContain("SYNTHETIC_MEMORY_private");
  });
  it("does not promote unconfirmed model inference or a source-free fact",async()=>{
    const chosen=await selectProjectMemory(input([memoryFixture("pending",{validity:"pending",confirmation:null}),memoryFixture("unconfirmed",{confirmation:null}),memoryFixture("missing",{sourceRefs:[]})]));
    expect(chosen.plan.used).toEqual([]);expect(chosen.plan.omitted.map(item=>item.reason)).toEqual(expect.arrayContaining(["pending","unconfirmed","missing_source"]));
  });
  it("rechecks source freshness before selection and again immediately before sending",async()=>{
    let fresh=true;const sources={validate:vi.fn(async()=>fresh)};
    const values=[memoryFixture()],context=createProjectMemoryContext(memoryPort(values),sources),run=memoryRun();
    const prepared=await context.prepare({run,messages:base(run),signal:new AbortController().signal,isCurrent:()=>true});
    expect(prepared.plan.used).toHaveLength(1);fresh=false;
    await expect(prepared.beforeSend()).rejects.toThrow("project_memory_stale");
    const next=await context.prepare({run,messages:base(run),signal:new AbortController().signal,isCurrent:()=>true});
    expect(next.plan.omitted[0]?.reason).toBe("stale");expect(JSON.stringify(next.messages)).not.toContain("SYNTHETIC_MEMORY");
  });
  it("rejects a revision change, retirement, or missing record during approval",async()=>{
    const values=[memoryFixture()],context=createProjectMemoryContext(memoryPort(values),{validate:async()=>true}),run=memoryRun();
    const prepare=()=>context.prepare({run,messages:base(run),signal:new AbortController().signal,isCurrent:()=>true});
    let chosen=await prepare();values[0]={...values[0]!,revision:3};
    await expect(chosen.beforeSend()).rejects.toThrow("project_memory_stale");
    chosen=await prepare();values[0]={...values[0]!,revision:4,validity:"retired"};
    await expect(chosen.beforeSend()).rejects.toThrow("project_memory_stale");
  });
  it("preserves exact constraints and explains UTF-8 budget omissions without truncating memory",async()=>{
    const scope=memoryScope(),run=memoryRun(scope),messages=base(run);
    const critical=memoryFixture("critical",{kind:"decision",body:"不能降低安全限制",priority:"constraint"});
    const large=memoryFixture("a-large",{body:"中".repeat(2000)});
    scope.limits.maxContextBytes=bytes(messages)+1800;
    const chosen=await selectProjectMemory({...input([large,critical],scope),messages});
    expect(chosen.messages.slice(0,2)).toEqual(messages.slice(0,2));
    expect(chosen.plan.used.map(item=>item.id)).toEqual(["critical"]);expect(chosen.plan.omitted).toContainEqual({id:"a-large",revision:2,reason:"budget"});
    expect(bytes(chosen.messages)).toBe(chosen.plan.usedBytes);expect(chosen.plan.usedBytes).toBeLessThanOrEqual(scope.limits.maxContextBytes);
    expect(JSON.stringify(chosen.messages)).not.toContain("中中中");
  });
  it("discards asynchronous results after project switch or cancellation",async()=>{
    let release!:()=>void,current=true;
    const wait=new Promise<void>(resolve=>{release=resolve;});
    const pending=selectProjectMemory({...input([memoryFixture()]),sources:{validate:async()=>{await wait;return true;}},isCurrent:()=>current});
    current=false;release();await expect(pending).rejects.toThrow("project_memory_context_changed");
    const aborted=new AbortController();aborted.abort();
    await expect(selectProjectMemory({...input([memoryFixture()]),signal:aborted.signal})).rejects.toThrow("project_memory_context_changed");
  });
  it("rejects serialized authority, cross-project source refs, and malformed payloads",()=>{
    expect(()=>parseProjectMemory({...memoryFixture(),scope:{readPrefixes:[""]}})).toThrow("project_memory_invalid");
    expect(()=>parseProjectMemory({...memoryFixture(),id:"\ud800"})).toThrow("project_memory_invalid");
    expect(()=>parseProjectMemory({...memoryFixture(),sourceRefs:[{...memoryFixture().sourceRefs[0],projectId:"B"}]})).toThrow("project_memory_invalid");
  });
  it("requires full-project sharing for a source-free root note and never probes private entries",async()=>{
    const note=memoryFixture("root-note",{kind:"decision",origin:{kind:"user",sessionId:null,messageId:null},sourceRefs:[],sharePaths:[""]});
    const options=input([note,memoryFixture("private",{visibility:"private"})]);
    const chosen=await selectProjectMemory(options);
    expect(chosen.plan.used).toEqual([]);
    expect(chosen.plan.omitted.map(entry=>entry.reason)).toEqual(expect.arrayContaining(["scope","private"]));
    expect(options.sources.validate).not.toHaveBeenCalled();
  });
  it("rechecks expiry after awaiting source freshness",async()=>{
    const scope=memoryScope();scope.expiresAt=100;
    const options={...input([memoryFixture()],scope),sources:{validate:async()=>{clock.mockReturnValue(100);return true;}}};
    const clock=vi.spyOn(Date,"now").mockReturnValue(99);
    try{await expect(selectProjectMemory(options)).rejects.toThrow("project_memory_context_changed");}
    finally{clock.mockRestore();}
  });
  it("rechecks expiry after an awaited revision read in the send barrier",async()=>{
    const run=memoryRun(),values=[memoryFixture("note",{kind:"decision",sourceRefs:[],body:"Inspect Main decision"})],port=memoryPort(values);
    run.scope.expiresAt=100;
    const clock=vi.spyOn(Date,"now").mockReturnValue(99);
    try{
      const prepared=await createProjectMemoryContext(port,{validate:async()=>true}).prepare({run,messages:base(run),signal:new AbortController().signal,isCurrent:()=>true});
      port.get=vi.fn(async()=>{clock.mockReturnValue(100);return values[0]!;});
      await expect(prepared.beforeSend()).rejects.toThrow("project_memory_context_changed");
    }finally{clock.mockRestore();}
  });
  it("accepts the exact UTF-8 wire budget and omits the entry one byte below it",async()=>{
    const options=input([memoryFixture("utf8",{body:"中文🙂"})]),full=await selectProjectMemory(options);
    const exact=full.plan.usedBytes;
    const atLimit=await selectProjectMemory({...options,scope:{...options.scope,limits:{...options.scope.limits,maxContextBytes:exact}}});
    expect(atLimit.plan.used).toHaveLength(1);expect(atLimit.plan.usedBytes).toBe(exact);
    const below=await selectProjectMemory({...options,scope:{...options.scope,limits:{...options.scope.limits,maxContextBytes:exact-1}}});
    expect(below.plan.used).toEqual([]);expect(below.plan.omitted[0]?.reason).toBe("budget");
  });
  it("rejects an overlong base message list even when the memory catalog is empty",async()=>{
    const options=input([]);
    options.messages=[options.messages[0]!,options.messages[1]!,...Array.from({length:29},()=>({role:"user" as const,content:"x"}))];
    await expect(selectProjectMemory(options)).rejects.toThrow("project_memory_context_limit");
  });
  it("rejects unordered pages instead of silently skipping catalog entries",async()=>{
    const port=memoryPort([]);
    port.list=vi.fn(async({projectId,afterId=null,limit=50}:Parameters<ProjectMemoryStorePort["list"]>[0])=>({schemaVersion:1 as const,projectId,afterId,limit,nextAfterId:null,memories:[memoryFixture("z"),memoryFixture("a")]}));
    const run=memoryRun();
    await expect(createProjectMemoryContext(port,{validate:async()=>true}).prepare({run,messages:base(run),signal:new AbortController().signal,isCurrent:()=>true})).rejects.toThrow("project_memory_catalog_invalid");
  });
  it("does not overwrite a concurrently replaced record when persisting source invalidation",async()=>{
    const values=[memoryFixture()],port=memoryPort(values),run=memoryRun();
    const sources={validate:async()=>{values[0]={...values[0]!,revision:3,body:"New user edit",validity:"pending",confirmation:null};return false;}};
    const prepared=await createProjectMemoryContext(port,sources).prepare({run,messages:base(run),signal:new AbortController().signal,isCurrent:()=>true});
    expect(prepared.plan.used).toEqual([]);expect(prepared.plan.omitted[0]?.reason).toBe("stale");
    expect(values[0]?.body).toBe("New user edit");expect(values[0]?.revision).toBe(3);expect(values[0]?.validity).toBe("pending");
  });
});
