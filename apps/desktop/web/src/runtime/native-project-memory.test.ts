import {describe,expect,it,vi} from "vitest";
import type {ProjectMemory,ProjectMemoryContent} from "@uagent/runtime";
import {createNativeProjectMemory} from "./native-project-memory";
function content():ProjectMemoryContent{
 return{kind:"decision",body:"Synthetic decision",sourceRefs:[],sharePaths:["Source"],priority:"normal",visibility:"private",origin:{kind:"user",sessionId:null,messageId:null},readAt:1};
}
function record():ProjectMemory{return{...content(),id:"m",projectId:"A",validity:"pending",revision:1,confirmation:null};}
describe("native project memory IPC",()=>{
 it("sends only data and preserves expected revision on update",async()=>{
  const invoke=vi.fn(async(command:string,args:{input:unknown})=>{
   if(command==="create_project_memory")return record();
   const input=args.input as {expectedRevision:number};return{...record(),revision:input.expectedRevision+1,validity:"retired"};
  }),port=createNativeProjectMemory(invoke);
  await port.create({projectId:"A",id:"m",content:content()});
  await port.update({projectId:"A",id:"m",expectedRevision:1,mutation:{type:"retire"}});
  expect(invoke).toHaveBeenLastCalledWith("update_project_memory",{input:{schemaVersion:1,projectId:"A",id:"m",expectedRevision:1,mutation:{type:"retire"}}});
  expect(JSON.stringify(invoke.mock.calls)).not.toContain("scope");
 });
 it("rejects cross-project replies and serialized authority",async()=>{
  const port=createNativeProjectMemory(async()=>({...record(),projectId:"B"}));
  await expect(port.get("A","m")).rejects.toThrow("project_memory_invalid");
  await expect(createNativeProjectMemory(async()=>({...record(),scope:{}})).get("A","m")).rejects.toThrow("project_memory_invalid");
 });
 it("rejects duplicate pages, broken cursors, and wrong update revisions",async()=>{
  const port=createNativeProjectMemory(async()=>({schemaVersion:1,projectId:"A",afterId:null,limit:30,nextAfterId:"m",memories:[record(),record()]}));
  await expect(port.list({projectId:"A"})).rejects.toThrow("project_memory_invalid");
  await expect(createNativeProjectMemory(async()=>record()).update({projectId:"A",id:"m",expectedRevision:1,mutation:{type:"retire"}})).rejects.toThrow("project_memory_invalid");
 });
 it("does not imply rollback if cancellation happens after a native write was sent",async()=>{
  let resolve!:(value:unknown)=>void;const native=new Promise<unknown>(done=>{resolve=done;}),invoke=vi.fn(async()=>native);
  const signal=new AbortController(),pending=createNativeProjectMemory(invoke).create({projectId:"A",id:"m",content:content()},signal.signal);
  signal.abort();resolve(record());
  await expect(pending).rejects.toThrow("project_memory_write_outcome_unknown");expect(invoke).toHaveBeenCalledTimes(1);
 });
 it("never falls back to renderer-only persistence",async()=>{
  await expect(createNativeProjectMemory(null).create({projectId:"A",id:"m",content:content()})).rejects.toThrow("project_memory_native_unavailable");
 });
 it("rejects backwards or unordered keyset pages",async()=>{
  const unordered=createNativeProjectMemory(async()=>({schemaVersion:1,projectId:"A",afterId:null,limit:30,nextAfterId:null,memories:[{...record(),id:"z"},{...record(),id:"a"}]}));
  await expect(unordered.list({projectId:"A"})).rejects.toThrow("project_memory_invalid");
  const backwards=createNativeProjectMemory(async()=>({schemaVersion:1,projectId:"A",afterId:"z",limit:30,nextAfterId:null,memories:[record()]}));
  await expect(backwards.list({projectId:"A",afterId:"z"})).rejects.toThrow("project_memory_invalid");
 });
 it("binds successful create and replace receipts to the submitted text and visibility",async()=>{
  const wrongCreate=createNativeProjectMemory(async()=>({...record(),body:"Different native text",visibility:"project"}));
  await expect(wrongCreate.create({projectId:"A",id:"m",content:content()})).rejects.toThrow("project_memory_invalid");
  const wrongReplace=createNativeProjectMemory(async()=>({...record(),revision:2,body:"Different native text"}));
  await expect(wrongReplace.update({projectId:"A",id:"m",expectedRevision:1,mutation:{type:"replace",content:content()}})).rejects.toThrow("project_memory_invalid");
 });
});
