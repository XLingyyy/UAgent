
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {UIProvider,useComposerActions,useComposerStore,useProjectActions,useProjectStore} from "./ui-store";
import {nativeProductSettings,type ProductSettingsSnapshot} from "../runtime/native-product-settings";
import * as nativeProjects from "../runtime/project-native-adapter";
import type {ProjectProfile} from "@uagent/shared";
import type {ProviderConfig} from "../types/provider";
const config:ProviderConfig={providerId:"synthetic",displayName:"Synthetic",baseUrl:"https://configured.invalid/v1",
 wireApi:"responses",authMode:"none",models:[{id:"model",label:"Model",contextWindow:32768,supportsReasoning:true,
 reasoningEfforts:["low","medium","high","xhigh"]}],defaultModel:"model",enabled:true};
function Probe(){
 const actions=useProjectActions(),composer=useComposerActions(),project=useProjectStore(s=>s.activeProjectId);
 const effort=useComposerStore(s=>s.reasoningEffort);
 return <><output data-testid="project">{project}</output><output data-testid="effort">{effort}</output>
  <button onClick={()=>actions.setActiveProject("A")}>Project A</button>
  <button onClick={()=>actions.setActiveProject("B")}>Project B</button>
  <button onClick={()=>composer.setComposerReasoning("high")}>User chooses high</button></>;
}
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe("settings P2 project reasoning hydration",()=>{
 it("publishes native filesystem readiness after trusting a restored project without changing selection",async()=>{
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("No network");}));
  const snapshot:ProductSettingsSnapshot={preferences:{revision:1,preferences:{theme:"dark",locale:"en",activeProjectId:"A",selectedProviderId:null,defaultProviderId:null}},providers:[],projects:[{id:"A",root:"E:/Synthetic/A",label:"A",createdAt:1}],projectPreferences:[]};
  vi.spyOn(nativeProductSettings,"getBootstrap").mockReturnValue(snapshot);
  vi.spyOn(nativeProductSettings,"projectPreferences").mockReturnValue(null);
  const real=nativeProjects.createNativeProjectAdapter(),capabilities=[{kind:"Files",mode:"native_read_only",status:"completed"}];
  let project:ProjectProfile={id:"A",name:"A",rootRef:"A",displayRoot:"[project-root]",trustState:"untrusted",indexStatus:"validated",engine:{label:"Synthetic",association:null,source:"unknown"},createdAt:1,updatedAt:1};
  const add=vi.fn(async()=>project),trust=vi.fn(async()=>{project={...project,trustState:"trusted",updatedAt:2};return project;});
  vi.spyOn(nativeProjects,"createNativeProjectAdapter").mockReturnValue({...real,source:"native",addProject:add,confirmTrust:trust,listProjects:()=>[project],getCapabilityStatus:()=>capabilities});
  function RestoredProbe(){const state=useProjectStore(s=>s),actions=useProjectActions();return <><output data-testid="restored-project">{JSON.stringify(state)}</output><button onClick={()=>void actions.trustProjectRoot("A")}>Trust restored project</button></>;}
  render(<UIProvider><RestoredProbe/></UIProvider>);
  const state=()=>JSON.parse(screen.getByTestId("restored-project").textContent!);
  await waitFor(()=>expect(state().activeProjectId).toBe("A"));
  expect(state().nativeSource).toBe("unknown");expect(state().registeredProjects[0].trustState).toBe("untrusted");
  fireEvent.click(screen.getByRole("button",{name:"Trust restored project"}));
  await waitFor(()=>expect(state().registeredProjects[0].trustState).toBe("trusted"));
  expect(state().nativeSource).toBe("native");expect(state().capabilityStatus).toEqual(capabilities);expect(state().fsPolicy).toEqual(real.getPolicy());
  expect(state().activeProjectId).toBe("A");expect(add).toHaveBeenCalledTimes(1);expect(trust).toHaveBeenCalledWith("A");expect(fetch).not.toHaveBeenCalled();
 });
 it.each([undefined,"low"] as const)("keeps B null, restores default %s and never writes hydration during A B A",async defaultEffort=>{
  vi.stubGlobal("fetch",vi.fn(()=>{throw Error("No network");}));
  const provider={...config,defaultReasoningEffort:defaultEffort};
  const snapshot:ProductSettingsSnapshot={preferences:{revision:1,preferences:{theme:"dark",locale:"en",
   activeProjectId:"A",selectedProviderId:config.providerId,defaultProviderId:config.providerId}},
   providers:[],projects:["A","B"].map(id=>({id,root:"E:/Synthetic/"+id,label:id,createdAt:1})),projectPreferences:[]};
  vi.spyOn(nativeProductSettings,"getBootstrap").mockReturnValue(snapshot);
  vi.spyOn(nativeProductSettings,"projectPreferences").mockImplementation(id=>({projectId:id,revision:1,
   preferences:{providerId:config.providerId,modelId:"model",reasoningEffort:id==="A"?"xhigh":null},requiresFreshProjectTrust:true}));
  vi.spyOn(nativeProductSettings,"savePreferences").mockResolvedValue(snapshot.preferences);
  const write=vi.spyOn(nativeProductSettings,"saveProjectPreferences").mockImplementation(async(projectId,preferences)=>({
   projectId,revision:2,preferences,requiresFreshProjectTrust:true}));
  const real=nativeProjects.createNativeProjectAdapter();
  vi.spyOn(nativeProjects,"createNativeProjectAdapter").mockReturnValue({...real,async addProject(root){
   const id=root.slice(-1);
   return {id,name:id,rootRef:id,displayRoot:root,trustState:"untrusted",indexStatus:"not_indexed",
    engine:{label:"Synthetic",association:null,source:"fixture"},createdAt:1,updatedAt:1} as ProjectProfile;
  }});
  render(<UIProvider initialState={{provider:{providers:[provider],selectedProviderId:provider.providerId,
   defaultProviderId:provider.providerId,testStatus:"idle"}}}><Probe/></UIProvider>);
  await waitFor(()=>expect(screen.getByTestId("project").textContent).toBe("A"));
  expect(screen.getByTestId("effort").textContent).toBe("xhigh");
  expect(write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Project B"}));
  expect(screen.getByTestId("effort").textContent).toBe(defaultEffort??"medium");
  expect(write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Project A"}));
  expect(screen.getByTestId("effort").textContent).toBe("xhigh");expect(write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button",{name:"Project B"}));
  await act(async()=>fireEvent.click(screen.getByRole("button",{name:"User chooses high"})));
  expect(write).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenCalledWith("B",{providerId:provider.providerId,modelId:"model",reasoningEffort:"high"});
  expect(fetch).not.toHaveBeenCalled();
 });
});
