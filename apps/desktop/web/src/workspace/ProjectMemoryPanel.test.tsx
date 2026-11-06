import {useLayoutEffect} from "react";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import type {ProjectMemory,ProjectMemoryPage,ProjectMemoryStorePort} from "@uagent/runtime";
import {createLocaleStore,I18nProvider} from "../i18n";
import {ProjectMemoryPanel} from "./ProjectMemoryPanel";
afterEach(cleanup);
const sample=(projectId="A"):ProjectMemory=>({id:"m",projectId,kind:"decision",body:"Synthetic project "+projectId,sourceRefs:[],sharePaths:["Source"],priority:"normal",visibility:"private",origin:{kind:"user",sessionId:null,messageId:null},readAt:1,revision:1,validity:"pending",confirmation:null});
const page=(projectId:string,memories:ProjectMemory[]):ProjectMemoryPage=>({schemaVersion:1,projectId,afterId:null,limit:30,nextAfterId:null,memories});
function port():ProjectMemoryStorePort{
 return{list:vi.fn(async (input:Parameters<ProjectMemoryStorePort["list"]>[0])=>page(input.projectId,[sample(input.projectId)])),get:vi.fn(async(project:string,id:string)=>({...sample(project),id})),create:vi.fn(async()=>{throw Error("unused");}),update:vi.fn(async()=>{throw Error("conflict");})};
}
function frame(projectId:string,storage:ProjectMemoryStorePort){
 return <I18nProvider store={createLocaleStore({initialLocale:"en",storage:null})}><ProjectMemoryPanel projectId={projectId} port={storage}/></I18nProvider>;
}
describe("project memory panel",()=>{
 it("marks a confirmed source stale after a metadata change and disables confirmation",async()=>{
  const storage=port(),memory={...sample(),kind:"fact" as const,validity:"valid" as const,confirmation:{kind:"user" as const,confirmedAt:2},sourceRefs:[{projectId:"A",path:"Source/Main.cpp",version:"old",freshness:"old",kind:"file_preview" as const}]};
  storage.list=vi.fn(async()=>page("A",[memory]));
  render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null})}><ProjectMemoryPanel projectId="A" port={storage} captureSources={async()=>[{projectId:"A",path:"Source/Main.cpp",version:"new",freshness:"new",kind:"file_preview"}]}/></I18nProvider>);
  await screen.findByText("Fact · Source is stale");
  expect((screen.getByText("Confirm as user") as HTMLButtonElement).disabled).toBe(true);
 });
 it("shows a failed revision update without claiming a successful save",async()=>{
  const storage=port();render(frame("A",storage));
  await screen.findByText("Synthetic project A");
  fireEvent.click(screen.getByText("Confirm as user"));
  await waitFor(()=>expect(screen.getByRole("alert").textContent).toContain("Reload native records"));
  expect(screen.queryByText("Saved in native records")).toBeNull();expect(storage.update).toHaveBeenCalledTimes(1);
 });
 it("discards a pending A catalog response after switching to B",async()=>{
  let release!:(value:ProjectMemoryPage)=>void;
  const waiting=new Promise<ProjectMemoryPage>(resolve=>{release=resolve;}),storage=port();
  storage.list=vi.fn(async (input:Parameters<ProjectMemoryStorePort["list"]>[0])=>input.projectId==="A"?waiting:page("B",[sample("B")]));
  const view=render(frame("A",storage));view.rerender(frame("B",storage));
  await screen.findByText("Synthetic project B");release(page("A",[sample("A")]));
  await waitFor(()=>expect(screen.queryByText("Synthetic project A")).toBeNull());
  expect(screen.getByText("Synthetic project B")).toBeTruthy();
 });
 it("edits only content fields and keeps the original expected revision",async()=>{
  const storage=port();render(frame("A",storage));await screen.findByText("Synthetic project A");
  fireEvent.click(screen.getByText("Edit"));fireEvent.change(screen.getByLabelText("Memory text"),{target:{value:"Edited synthetic"}});
  fireEvent.submit(screen.getByRole("form",{name:"Save as pending"}));
  await waitFor(()=>expect(storage.update).toHaveBeenCalledTimes(1));
  const call=vi.mocked(storage.update).mock.calls[0]![0];
  expect(call.expectedRevision).toBe(1);expect(call.mutation.type).toBe("replace");
  if(call.mutation.type==="replace"){expect(call.mutation.content.body).toBe("Edited synthetic");expect(call.mutation.content).not.toHaveProperty("revision");expect(call.mutation.content).not.toHaveProperty("projectId");}
 });
 it("starts new memory private and does not carry an A draft into B's first commit",async()=>{
  const storage=port(),seen:Array<string|null>=[];
  function Probe({projectId}:{projectId:string}){
    useLayoutEffect(()=>{if(projectId==="B")seen.push((screen.queryByLabelText("Memory text") as HTMLTextAreaElement|null)?.value??null);},[projectId]);
    return frame(projectId,storage);
  }
  const view=render(<Probe projectId="A"/>);await screen.findByText("Synthetic project A");
  expect((screen.getByLabelText("Visibility") as HTMLSelectElement).value).toBe("private");
  fireEvent.change(screen.getByLabelText("Memory text"),{target:{value:"A private draft"}});
  view.rerender(<Probe projectId="B"/>);await screen.findByText("Synthetic project B");
  expect(seen).not.toContain("A private draft");expect((screen.getByLabelText("Memory text") as HTMLTextAreaElement).value).toBe("");
  expect(storage.create).not.toHaveBeenCalled();expect(storage.update).not.toHaveBeenCalled();
 });
 it("does not dispatch an old project's write when a source capture resolves after switching",async()=>{
  const storage=port(),a={...sample(),kind:"fact" as const,sourceRefs:[{projectId:"A",path:"Source/Main.cpp",kind:"file_preview" as const,version:"old",freshness:"old"}]};
  storage.list=vi.fn(async(input:Parameters<ProjectMemoryStorePort["list"]>[0])=>page(input.projectId,input.projectId==="A"?[a]:[sample("B")]));
  let release!:(refs:ProjectMemory["sourceRefs"])=>void;
  const waiting=new Promise<ProjectMemory["sourceRefs"]>(resolve=>{release=resolve;}),capture=vi.fn(async()=>waiting);
  const draw=(projectId:string)=><I18nProvider store={createLocaleStore({initialLocale:"en",storage:null})}><ProjectMemoryPanel projectId={projectId} port={storage} captureSources={capture}/></I18nProvider>;
  const view=render(draw("A"));await screen.findByText("Synthetic project A");
  fireEvent.click(screen.getByText("Edit"));fireEvent.submit(screen.getByRole("form",{name:"Save as pending"}));
  await waitFor(()=>expect(capture).toHaveBeenCalledTimes(1));
  view.rerender(draw("B"));await screen.findByText("Synthetic project B");
  await act(async()=>{release(a.sourceRefs);await waiting;});
  expect(storage.update).not.toHaveBeenCalled();expect(storage.create).not.toHaveBeenCalled();
 });
 it("retiring preserves the displayed original text and reports only a native receipt",async()=>{
  const storage=port(),original=sample();
  storage.update=vi.fn(async()=>({...original,revision:2,validity:"retired" as const}));
  render(frame("A",storage));await screen.findByText(original.body);
  fireEvent.click(screen.getByText("Retire"));
  await screen.findByText("Decision · Retired");expect(screen.getByText(original.body)).toBeTruthy();
  expect(screen.getByText("Saved in native records")).toBeTruthy();
  expect(storage.update).toHaveBeenCalledWith({projectId:"A",id:"m",expectedRevision:1,mutation:{type:"retire"}},expect.any(AbortSignal));
 });
});
