import { act,cleanup,fireEvent,render,screen,waitFor } from "@testing-library/react";
import {afterEach,expect,it,vi} from "vitest";
import {I18nProvider,createLocaleStore} from "../i18n";
import {SessionCatalogPanel} from "./SessionCatalogPanel";
import {createNativeSessionCatalog,type NativeSessionCatalogPort,type NativeSessionPage} from "../runtime/native-session-catalog";
const session=(id:string,title:string)=>({projectId:"A",id,title,createdAt:1,archived:false,parentId:null,origin:"native" as const,messageCount:0,lastOrdinal:0,latestRunId:null});
function page(input:Parameters<NativeSessionCatalogPort["list"]>[0]):NativeSessionPage{return {schemaVersion:1,projectId:input.projectId,requestId:input.requestId??"request",includeArchived:input.includeArchived??false,offset:input.offset??0,limit:30,hasMore:false,sessions:[],...(input.titleQuery?{titleQuery:input.titleQuery}:{})};}
function port(list:NativeSessionCatalogPort["list"]):NativeSessionCatalogPort{return {list,update:vi.fn(),branch:vi.fn(),read:vi.fn(),cancel:vi.fn(async i=>({schemaVersion:1,...i,cancellationRequested:true}))};}
function mount(catalog:NativeSessionCatalogPort){return render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null})}><SessionCatalogPanel projectId="A" catalog={catalog} onContinue={()=>{}}/></I18nProvider>);}
function search(value:string){fireEvent.change(screen.getByLabelText("Search all session names in this project"),{target:{value}});fireEvent.click(screen.getByText("Search names"));}
afterEach(cleanup);
it("queries the complete catalog and paginates matches while retaining archived preference",async()=>{
 const list=vi.fn(async(i:Parameters<NativeSessionCatalogPort["list"]>[0])=>({...page(i),hasMore:!!i.titleQuery&&!i.offset,sessions:i.titleQuery?[session("match",i.offset?"Alpha second page":"Alpha old session")]:[session("new","Newest unrelated session")]}));
 mount(port(list));await screen.findByText("Newest unrelated session");search("Alpha");await screen.findByText("Alpha old session");expect(screen.queryByText("Newest unrelated session")).toBeNull();
 fireEvent.click(screen.getByText("Next"));await screen.findByText("Alpha second page");expect(list.mock.calls.at(-1)?.[0]).toMatchObject({titleQuery:"Alpha",offset:30});
 fireEvent.click(screen.getByLabelText("Include archived sessions"));await waitFor(()=>expect(list.mock.calls.at(-1)?.[0]).toMatchObject({titleQuery:"Alpha",includeArchived:true,offset:0}));
 fireEvent.click(screen.getByText("Clear search"));await screen.findByText("Newest unrelated session");expect(list.mock.calls.at(-1)?.[0].titleQuery).toBeUndefined();
});
it("new title queries cancel and isolate late earlier results",async()=>{
 let resolve:(v:NativeSessionPage)=>void=()=>{};let old:Parameters<NativeSessionCatalogPort["list"]>[0]|undefined;
 const list=vi.fn(async(i:Parameters<NativeSessionCatalogPort["list"]>[0])=>{if(i.titleQuery==="Old"){old=i;return new Promise<NativeSessionPage>(r=>{resolve=r;});}return {...page(i),sessions:i.titleQuery?[session("fresh","New match")]:[]};});const catalog=port(list);mount(catalog);
 await waitFor(()=>expect(list).toHaveBeenCalled());search("Old");await waitFor(()=>expect(old).toBeDefined());search("New");await screen.findByText("New match");
 await act(async()=>{resolve({...page(old!),sessions:[session("stale","Old stale")]});});expect(screen.queryByText("Old stale")).toBeNull();expect(catalog.cancel).toHaveBeenCalledWith({projectId:"A",requestId:old!.requestId});
});
it("the native adapter binds literal query and rejects ignored or mismatched searches",async()=>{
 const invoke=vi.fn(async(_command:string,args:unknown)=>{const input=(args as {input:Record<string,unknown>}).input;return {schemaVersion:1,...input,hasMore:false,sessions:[session("x","100%_done")]};});
 const catalog=createNativeSessionCatalog(invoke as never);const result=await catalog.list({projectId:"A",requestId:"q",titleQuery:"100%_DONE"});expect(result.titleQuery).toBe("100%_DONE");expect(invoke.mock.calls[0][1]).toMatchObject({input:{titleQuery:"100%_DONE"}});
 const ignored=createNativeSessionCatalog(vi.fn(async()=>({schemaVersion:1,projectId:"A",requestId:"q",includeArchived:false,offset:0,limit:30,hasMore:false,sessions:[]})) as never);
 await expect(ignored.list({projectId:"A",requestId:"q",titleQuery:"Alpha"})).rejects.toThrow();
});
it("invalid query text never enters native IPC",async()=>{const invoke=vi.fn();const catalog=createNativeSessionCatalog(invoke);await expect(catalog.list({projectId:"A",titleQuery:"bad\nquery"})).rejects.toThrow();expect(invoke).not.toHaveBeenCalled();});

it("title search keeps rename and legacy empty-query receipts compatible",async()=>{
 const invoke=vi.fn(async(command:string)=>command==="update_native_session_catalog"?{schemaVersion:1,projectId:"A",requestId:"q",session:session("x","Renamed"),requiresFreshAuthorization:true}:{schemaVersion:1,projectId:"A",requestId:"q",includeArchived:false,offset:0,limit:30,hasMore:false,sessions:[]});
 const catalog=createNativeSessionCatalog(invoke as never);
 expect((await catalog.update({projectId:"A",sessionId:"x",requestId:"q",patch:{kind:"rename",title:"Renamed",expectedTitle:"Alpha"}})).session.title).toBe("Renamed");
 expect((await catalog.list({projectId:"A",requestId:"q"})).sessions).toEqual([]);
});
