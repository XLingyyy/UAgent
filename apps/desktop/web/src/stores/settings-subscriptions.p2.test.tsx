
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {UIProvider,useComposerActions,useComposerStore,useLayoutActions,useProjectActions,useProjectStore,useProviderActions} from "./ui-store";
import {createNativeProductSettings,nativeProductSettings,type ProductSettingsSnapshot} from "../runtime/native-product-settings";
import type {NativeInvoke} from "../runtime/project-native-adapter";
import * as nativeProjects from "../runtime/project-native-adapter";
import {createDesktopRuntimeAdapter,type DesktopRuntimeAdapter} from "../runtime/desktop-runtime-adapter";
import {safeProviderSession} from "../runtime/safe-provider-session";
import * as availability from "../provider/runtime-availability";
import {createSupportedProvider} from "../provider/runtime-availability";
import {ProviderSettings} from "../settings/pages/ProviderSettings";
import {ComposerDock} from "../composer/ComposerDock";
import {I18nProvider,createLocaleStore} from "../i18n";
import type {ProjectProfile} from "@uagent/shared";
import type {ProviderConfig,ProviderVersion} from "../types/provider";

const clone=<T,>(value:T):T=>structuredClone(value);
function snapshot():ProductSettingsSnapshot{
 return {preferences:{revision:1,preferences:{theme:"dark",locale:"en",activeProjectId:null,selectedProviderId:null,defaultProviderId:null}},
  providers:[],projects:[],projectPreferences:[]};
}
function nativeHarness(state:ProductSettingsSnapshot){
 const calls:Array<{command:string;input:Record<string,unknown>|undefined}>=[];
 const invoke:NativeInvoke=async<T,>(command:string,args?:unknown)=>{
  const input=(args as {input?:Record<string,unknown>}|undefined)?.input;
  calls.push({command,input:input?clone(input):undefined});
  if(command==="initialize_product_settings"||command==="read_product_settings")return clone(state) as T;
  if(command==="get_product_provider_version"){
   const current=state.providers.find(p=>p.config.providerId===input!.providerId);
   return (current?{providerId:current.config.providerId,generation:current.generation,revision:current.revision,exists:true}:
    {providerId:input!.providerId,generation:null,revision:0,exists:false}) as T;
  }
  if(command==="save_product_preferences"){
   if(input!.expectedRevision!==state.preferences.revision)throw {kind:"conflict"};
   state.preferences={revision:state.preferences.revision+1,preferences:clone(input!.preferences) as ProductSettingsSnapshot["preferences"]["preferences"]};
   return clone(state.preferences) as T;
  }
  if(command==="save_product_provider"){
   const expected=input!.version as ProviderVersion;
   const current=state.providers.find(p=>p.config.providerId===expected.providerId);
   if(!current||!expected.exists||expected.generation!==current.generation||expected.revision!==current.revision)throw {kind:"conflict"};
   current.config=clone(input!.config) as ProviderConfig;current.revision++;
   return clone(current) as T;
  }
  if(command==="save_product_project_preferences"){
   const current=state.projectPreferences.find(p=>p.projectId===input!.projectId);
   if((current?.revision??0)!==input!.expectedRevision)throw {kind:"conflict"};
   const next={projectId:String(input!.projectId),revision:(current?.revision??0)+1,
    preferences:clone(input!.preferences) as ProductSettingsSnapshot["projectPreferences"][number]["preferences"],requiresFreshProjectTrust:true as const};
   if(current)Object.assign(current,next);else state.projectPreferences.push(next);
   return clone(next) as T;
  }
  throw Error("unexpected synthetic native command "+command);
 };
 const client=createNativeProductSettings(invoke);
 async function install(){
  await client.initialize("en");
  // Delegate every method to the real client closure. Only NativeInvoke is synthetic.
  // This retains the real bootstrap, revision queue, blocked state and project cache.
  for(const key of Object.keys(client) as Array<keyof typeof client>)
   vi.spyOn(nativeProductSettings,key).mockImplementation(client[key] as never);
 }
 return {client,calls,install,state};
}
function mockProjects(ids:string[]){
 const profiles=ids.map(id=>({id,name:id,rootRef:id,displayRoot:"E:/Synthetic/"+id,trustState:"untrusted",indexStatus:"not_indexed",
  engine:{label:"Synthetic",association:null,source:"fixture"},createdAt:1,updatedAt:1} as ProjectProfile));
 const base=nativeProjects.createNativeProjectAdapter();
 vi.spyOn(nativeProjects,"createNativeProjectAdapter").mockReturnValue({...base,
  async addProject(root){return profiles.find(p=>p.displayRoot===root)!;},
  getProject:id=>profiles.find(p=>p.id===id)??null,listProjects:()=>profiles});
}
function Controls(){
 const projects=useProjectActions(),composer=useComposerActions(),layout=useLayoutActions(),providers=useProviderActions();
 const project=useProjectStore(s=>s.activeProjectId),effort=useComposerStore(s=>s.reasoningEffort);
 return <><output data-testid="active-project">{project}</output><output data-testid="actual-effort">{effort}</output>
  <button onClick={()=>projects.setActiveProject("A")}>Switch A</button><button onClick={()=>projects.setActiveProject("B")}>Switch B</button>
  <button onClick={()=>layout.setTheme("light")}>Choose light theme</button>
  <button onClick={()=>composer.setComposerInput("Synthetic question")}>Enter question</button>
  <button onClick={()=>void providers.reviewExistingProvider("synthetic")}>Review current provider</button>
  <button onClick={()=>composer.setComposerModel(JSON.stringify(["synthetic","wide"]))}>Select Wide</button>
  <button onClick={()=>composer.setComposerModel(JSON.stringify(["synthetic","narrow"]))}>Select Narrow</button>
  <button onClick={()=>composer.setComposerReasoning("high")}>Request high reasoning</button></>;
}
function mount(children:React.ReactNode,runtimeClient?:DesktopRuntimeAdapter){
 return render(<I18nProvider store={createLocaleStore({initialLocale:"en",storage:null,eventTarget:null})}>
  <UIProvider runtimeClient={runtimeClient}>{children}</UIProvider></I18nProvider>);
}
function refreshReasoningState():ProductSettingsSnapshot{
 const state=snapshot();
 const config:ProviderConfig={providerId:"synthetic",displayName:"Synthetic",baseUrl:"https://configured.invalid/v1",wireApi:"responses",
  authMode:"none",enabled:true,defaultModel:"wide",defaultReasoningEffort:"xhigh",models:[
   {id:"wide",label:"Wide",contextWindow:32768,supportsReasoning:true,reasoningEfforts:["xhigh"]},
   {id:"narrow",label:"Narrow",contextWindow:32768,supportsReasoning:true,reasoningEfforts:["low","high","xhigh"]}]};
 state.preferences.preferences={...state.preferences.preferences,activeProjectId:"B",selectedProviderId:config.providerId,defaultProviderId:config.providerId};
 state.providers=[{config,generation:"e".repeat(64),revision:1,connectionVerified:false,requiresNewSession:true,transportSupported:false}];
 state.projects=[{id:"B",label:"B",root:"E:/Synthetic/B",createdAt:1}];
 state.projectPreferences=[{projectId:"B",revision:1,preferences:{providerId:config.providerId,modelId:"narrow",reasoningEffort:null},requiresFreshProjectTrust:true}];
 return state;
}
function submissionCapture(){
 vi.spyOn(availability,"supportsProviderModel").mockReturnValue(true);
 const ready={...safeProviderSession.getSnapshot(),ready:true};
 vi.spyOn(safeProviderSession,"getSnapshot").mockReturnValue(ready);
 const runtime=createDesktopRuntimeAdapter();
 const submit=vi.fn<Parameters<DesktopRuntimeAdapter["submitTask"]>,ReturnType<DesktopRuntimeAdapter["submitTask"]>>(
  async()=>({id:"synthetic-task",state:"completed"} as Awaited<ReturnType<DesktopRuntimeAdapter["submitTask"]>>));
 return {runtime:{...runtime,submitTask:submit},submit};
}
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe("T08 P2 real settings-client subscription regressions",()=>{
 it("reviews a cross-window creation without preference writes or poisoning, then saves the explicit reviewed edit",async()=>{
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("No network");}));
  mockProjects([]);
  const h=nativeHarness(snapshot());await h.install();
  mount(<><ProviderSettings/><Controls/></>);
  expect(h.client.getBootstrap()!.preferences.revision).toBe(1);
  const config={...createSupportedProvider(),displayName:"Created in another window"};
  h.state.providers.push({config,generation:"b".repeat(64),revision:7,connectionVerified:false,requiresNewSession:true,transportSupported:true});
  h.state.preferences={revision:2,preferences:{...h.state.preferences.preferences,selectedProviderId:"deepseek",defaultProviderId:"deepseek"}};
  fireEvent.click(screen.getByRole("button",{name:"Add provider"}));
  const template=await screen.findByRole("combobox",{name:"Provider type"});
  fireEvent.change(template,{target:{value:"deepseek"}});
  await screen.findByRole("heading",{name:config.displayName});
  await h.client.whenIdle();
  expect(h.client.getBootstrap()!.preferences.revision).toBe(2);
  expect(h.calls.filter(c=>c.command==="save_product_preferences"||c.command==="save_product_project_preferences"||c.command==="save_product_provider")).toHaveLength(0);
  expect(h.client.getStatus().error).toBeNull();
  expect(h.state.preferences.revision).toBe(2);
  expect(screen.queryByRole("button",{name:"Save provider"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Edit provider"}));
  fireEvent.change(screen.getByRole("textbox",{name:"Display name"}),{target:{value:"Explicit reviewed update"}});
  fireEvent.click(screen.getByRole("button",{name:"Save provider"}));
  await waitFor(()=>expect(h.state.providers[0].revision).toBe(8));
  await act(async()=>h.client.whenIdle());
  expect(h.state.providers[0].config.displayName).toBe("Explicit reviewed update");
  const write=h.calls.find(c=>c.command==="save_product_provider")!;
  expect(write.input!.version).toEqual({providerId:"deepseek",generation:"b".repeat(64),revision:7,exists:true});
  expect(h.client.getStatus().error).toBeNull();
  // A subsequent explicit UI preference edit uses the refreshed version, not cached revision 1.
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Choose light theme"}));await h.client.whenIdle();});
  const preferences=h.calls.filter(c=>c.command==="save_product_preferences");
  expect(preferences).toHaveLength(1);expect(preferences[0].input!.expectedRevision).toBe(2);
  expect(h.state.preferences.preferences).toMatchObject({theme:"light",selectedProviderId:"deepseek",defaultProviderId:"deepseek"});
  expect(h.client.getStatus().error).toBeNull();expect(fetch).not.toHaveBeenCalled();
 });
 it("keeps a remounted bootstrap config paired with its snapshot token after the real client's cache advances",async()=>{
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("No network");}));mockProjects([]);
  const state=snapshot(),config={...createSupportedProvider(),displayName:"Displayed bootstrap name"};
  state.providers=[{config,generation:"d".repeat(64),revision:1,connectionVerified:false,requiresNewSession:true,transportSupported:true}];
  state.preferences.preferences.selectedProviderId="deepseek";
  const h=nativeHarness(state);await h.install();
  await h.client.saveProvider({...config,displayName:"Newer name not displayed by bootstrap"},
   {providerId:"deepseek",generation:"d".repeat(64),revision:1,exists:true});
  expect(h.client.getBootstrap()!.providers[0].revision).toBe(1);
  expect(h.client.providerVersions().deepseek.revision).toBe(2);
  mount(<ProviderSettings/>);
  expect(screen.getByRole("heading",{name:config.displayName})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Edit provider"}));
  fireEvent.click(screen.getByRole("button",{name:"Save provider"}));
  await screen.findByRole("alert");
  const writes=h.calls.filter(c=>c.command==="save_product_provider");
  expect(writes).toHaveLength(2);
  expect((writes[1].input!.version as ProviderVersion).revision).toBe(1);
  expect(h.state.providers[0].revision).toBe(2);
  expect(h.state.providers[0].config.displayName).toBe("Newer name not displayed by bootstrap");
  expect(h.client.getStatus().error).toBe("conflict");
 });
 it("derives B's null default from its actual model and keeps selector, state and submitted task aligned",async()=>{
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("No network");}));
  const config:ProviderConfig={providerId:"synthetic",displayName:"Synthetic",baseUrl:"https://configured.invalid/v1",wireApi:"responses",
   authMode:"none",enabled:true,defaultModel:"wide",defaultReasoningEffort:"xhigh",models:[
    {id:"wide",label:"Wide",contextWindow:32768,supportsReasoning:true,reasoningEfforts:["xhigh"]},
    {id:"narrow",label:"Narrow",contextWindow:32768,supportsReasoning:true,reasoningEfforts:["low"]}]};
  const state=snapshot();state.preferences.preferences={...state.preferences.preferences,activeProjectId:"A",selectedProviderId:config.providerId,defaultProviderId:config.providerId};
  state.providers=[{config,generation:"c".repeat(64),revision:1,connectionVerified:false,requiresNewSession:true,transportSupported:false}];
  state.projects=["A","B"].map(id=>({id,label:id,root:"E:/Synthetic/"+id,createdAt:1}));
  state.projectPreferences=["A","B"].map(id=>({projectId:id,revision:1,preferences:{providerId:config.providerId,modelId:id==="A"?"wide":"narrow",
   reasoningEffort:id==="A"?"xhigh":null},requiresFreshProjectTrust:true}));
  mockProjects(["A","B"]);
  const h=nativeHarness(state);await h.install();
  // UI-only readiness doubles: no credential is opened and submitTask cannot send.
  vi.spyOn(availability,"supportsProviderModel").mockReturnValue(true);
  const ready={...safeProviderSession.getSnapshot(),ready:true};
  vi.spyOn(safeProviderSession,"getSnapshot").mockReturnValue(ready);
  const runtime=createDesktopRuntimeAdapter();
  const submit=vi.fn<Parameters<DesktopRuntimeAdapter["submitTask"]>,ReturnType<DesktopRuntimeAdapter["submitTask"]>>(
   async()=>({id:"synthetic-task",state:"completed"} as Awaited<ReturnType<DesktopRuntimeAdapter["submitTask"]>>));
  mount(<><Controls/><ComposerDock/></>,{...runtime,submitTask:submit});
  await waitFor(()=>expect(screen.getByTestId("active-project").textContent).toBe("A"));
  expect(screen.getByTestId("actual-effort").textContent).toBe("xhigh");
  fireEvent.click(screen.getByRole("button",{name:"Switch B"}));
  expect(screen.getByTestId("actual-effort").textContent).toBe("low");
  expect(screen.getByRole("button",{name:/Model: Narrow, Reasoning Low/})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Switch A"}));
  expect(screen.getByTestId("actual-effort").textContent).toBe("xhigh");
  fireEvent.click(screen.getByRole("button",{name:"Switch B"}));
  fireEvent.click(screen.getByRole("button",{name:"Enter question"}));
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Send task"})));
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit.mock.calls[0][0]).toMatchObject({projectId:"B",modelId:"narrow",reasoningEffort:"low"});
  await h.client.whenIdle();
  expect(h.client.projectPreferences("B")!.preferences.reasoningEffort).toBeNull();
  expect(h.state.projectPreferences.find(p=>p.projectId==="B")!.preferences.reasoningEffort).toBeNull();
  expect(h.calls.filter(c=>c.command==="save_product_project_preferences")).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
 });
 it.each([true,false])("reconciles a same-model provider capability refresh (changed=%s) with null and zero hydration writes",async changed=>{
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("No network");}));
  mockProjects(["B"]);const h=nativeHarness(refreshReasoningState());await h.install();
  const capture=submissionCapture();
  mount(<><Controls/><ComposerDock/></>,capture.runtime);
  await waitFor(()=>expect(screen.getByTestId("active-project").textContent).toBe("B"));
  expect(screen.getByTestId("actual-effort").textContent).toBe("xhigh");
  // Same provider, selected Narrow, provider default Wide/xhigh and project null.
  // Only another window's capability declaration/version changes.
  h.state.providers[0].revision=2;
  h.state.providers[0].config.displayName="Updated in another window";
  if(changed)h.state.providers[0].config.models[1].reasoningEfforts=["low"];
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Review current provider"}));await h.client.whenIdle();});
  await waitFor(()=>expect(h.client.getBootstrap()!.providers[0].revision).toBe(2));
  const expected=changed?"low":"xhigh";
  expect(screen.getByTestId("actual-effort").textContent).toBe(expected);
  expect(screen.getByRole("button",{name:changed?/Model: Narrow, Reasoning Low/:/Model: Narrow, Reasoning XHigh/})).toBeTruthy();
  expect(h.calls.filter(c=>c.command.startsWith("save_"))).toHaveLength(0);
  expect(h.state.projectPreferences[0].preferences.reasoningEffort).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Enter question"}));
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"Send task"})));
  expect(capture.submit.mock.calls[0][0]).toMatchObject({projectId:"B",modelId:"narrow",reasoningEffort:expected});
  await h.client.whenIdle();
  expect(h.client.projectPreferences("B")!.preferences.reasoningEffort).toBeNull();
  expect(h.calls.filter(c=>c.command.startsWith("save_"))).toHaveLength(0);
  expect(fetch).not.toHaveBeenCalled();
 });
 it("uses the same constrained resolver for model changes and reasoning edits",async()=>{
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("No network");}));
  mockProjects(["B"]);const state=refreshReasoningState();
  state.providers[0].config.models[1].reasoningEfforts=["low"];
  const h=nativeHarness(state);await h.install();
  const capture=submissionCapture();mount(<><Controls/><ComposerDock/></>,capture.runtime);
  await waitFor(()=>expect(screen.getByTestId("active-project").textContent).toBe("B"));
  expect(screen.getByTestId("actual-effort").textContent).toBe("low");
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Select Wide"}));await h.client.whenIdle();});
  expect(screen.getByTestId("actual-effort").textContent).toBe("xhigh");
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Select Narrow"}));await h.client.whenIdle();});
  expect(screen.getByTestId("actual-effort").textContent).toBe("low");
  const writes=h.calls.filter(c=>c.command==="save_product_project_preferences").length;
  await act(async()=>{fireEvent.click(screen.getByRole("button",{name:"Request high reasoning"}));await h.client.whenIdle();});
  expect(screen.getByTestId("actual-effort").textContent).toBe("low");
  expect(screen.getByRole("button",{name:/Model: Narrow, Reasoning Low/})).toBeTruthy();
  expect(h.calls.filter(c=>c.command==="save_product_project_preferences")).toHaveLength(writes);
  expect(h.state.projectPreferences[0].preferences).toMatchObject({modelId:"narrow",reasoningEffort:"low"});
 });

});
