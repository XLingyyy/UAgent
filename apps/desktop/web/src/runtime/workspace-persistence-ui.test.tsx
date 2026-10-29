import {localizeText,getLocale} from "../i18n";
const uiText=(source:string)=>localizeText(getLocale(),source);
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {NativeInvoke,NativeProjectAdapter} from "./project-native-adapter";
import type {ProjectProfile} from "@uagent/shared";
import {createLocalWorkspaceStore,emptyWorkspace,localWorkspaceStore,type WorkspaceRecord} from "./local-workspace-store";
import {LocalWorkspaceBootstrap,LocalWorkspacePanel} from "../settings/pages/LocalWorkspacePanel";
import {ArchivedChatsSettings} from "../settings/pages/ArchivedChatsSettings";
import {UIProvider,useWorkspacePersistenceActions,useLayoutStore,useProjectStore,useComposerActions,useProviderStore} from "../stores/ui-store";
const setup=vi.hoisted(()=>({adapter:null as NativeProjectAdapter|null}));
vi.mock("./project-native-adapter",async(original)=>{const actual=await original<typeof import("./project-native-adapter")>();return{...actual,createNativeProjectAdapter:(...args:Parameters<typeof actual.createNativeProjectAdapter>)=>setup.adapter??actual.createNativeProjectAdapter(...args)};});
let saved:WorkspaceRecord|null;let failSave=false;
const invoke=vi.fn(async(command:string,payload?:unknown)=>{
 if(command==="read_local_workspace")return structuredClone(saved);
 if(command==="save_local_workspace"){const {input}=payload as {input:{expectedRevision:number;workspace:WorkspaceRecord["workspace"]}};if(failSave||input.expectedRevision!==(saved?.revision??0))throw Error("synthetic_conflict");saved={revision:input.expectedRevision+1,workspace:structuredClone(input.workspace)};return structuredClone(saved);}
 throw Error("unexpected_native_command");
});
let probe!:ReturnType<typeof useProbe>;
function useProbe(){return{actions:useWorkspacePersistenceActions(),layout:useLayoutStore(s=>s),project:useProjectStore(s=>s),composer:useComposerActions(),provider:useProviderStore(s=>s)};}
function Probe(){probe=useProbe();return null;}
beforeEach(async()=>{saved=null;failSave=false;invoke.mockClear();vi.stubGlobal("__TAURI_INTERNALS__",{invoke});vi.stubGlobal("fetch",vi.fn(()=>{throw Error("NO NETWORK");}));setup.adapter={source:"native",listProjects:()=>[],getCapabilityStatus:()=>[],resolveRawRoot:()=>"G:\\Synthetic",addProject:vi.fn(async()=>({id:"A",name:"Synthetic",rootRef:"root:A",displayRoot:"[project-root]",trustState:"trusted",indexStatus:"not_indexed"} as ProjectProfile))} as unknown as NativeProjectAdapter;await localWorkspaceStore.load();});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe("non-secret local persistence UI",()=>{
 it("explicitly saves config and restores after remount with fresh trust and network disabled",async()=>{
  const view=render(<UIProvider initialState={{layout:{theme:"light"}}}><Probe/><LocalWorkspacePanel/></UIProvider>);
  await waitFor(()=>expect((screen.getByText(uiText("Save local configuration")) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByText(uiText("Save local configuration")));await waitFor(()=>expect(saved?.revision).toBe(1));expect(saved?.workspace.theme).toBe("light");
  view.unmount();saved!.workspace={...saved!.workspace,projectRoots:["G:\\Synthetic"],selectedProjectRoot:"G:\\Synthetic",deepseekConfigured:true};
  render(<UIProvider><Probe/><LocalWorkspaceBootstrap/></UIProvider>);
  await waitFor(()=>expect(probe.project.activeProjectId).toBe("A"));expect(probe.layout.theme).toBe("light");expect(probe.project.registeredProjects[0].trustState).toBe("untrusted");expect(probe.provider.providers.find(p=>p.providerId==="deepseek")?.networkMode).toBe("disabled");expect(fetch).not.toHaveBeenCalled();
 });
 it("late restored project cannot overwrite a newly edited draft",async()=>{
  let release!:(p:ProjectProfile)=>void;vi.mocked(setup.adapter!.addProject).mockReturnValue(new Promise(r=>release=r));
  render(<UIProvider><Probe/></UIProvider>);let pending!:Promise<void>;
  act(()=>{pending=probe.actions.restore({...emptyWorkspace(),projectRoots:["G:\\Synthetic"],selectedProjectRoot:"G:\\Synthetic"});probe.composer.setComposerInput("new user draft");});
  await act(async()=>{release({id:"A",name:"Synthetic",rootRef:"root:A"} as ProjectProfile);await pending;});expect(probe.project.activeProjectId).toBeNull();
 });
 it("reads, searches, archives and reopens saved text without resuming execution",async()=>{
  saved={revision:1,workspace:{...emptyWorkspace(),chats:[{id:"chat-1",title:"Synthetic chat",projectLabel:"Synthetic",createdAt:1,archived:false,messages:[{role:"user",text:"hello"},{role:"assistant",text:"saved answer"}]}]}};
  render(<UIProvider><ArchivedChatsSettings/></UIProvider>);
  fireEvent.click(await screen.findByText(/Synthetic chat/));expect(screen.getByLabelText(uiText("Saved conversation")).textContent).toContain("saved answer");
  fireEvent.click(screen.getByText(uiText("Archive")));await waitFor(()=>expect(saved?.workspace.chats[0].archived).toBe(true));
  fireEvent.click(screen.getByLabelText(uiText("Archived only")));fireEvent.change(screen.getByLabelText(uiText("Search saved conversations")),{target:{value:"no match"}});expect(screen.queryByText(/Synthetic chat/)).toBeNull();
  fireEvent.change(screen.getByLabelText(uiText("Search saved conversations")),{target:{value:"Synthetic"}});fireEvent.click(screen.getByText(uiText("Restore from archive")));await waitFor(()=>expect(saved?.workspace.chats[0].archived).toBe(false));expect(fetch).not.toHaveBeenCalled();expect(invoke.mock.calls.some(c=>/^(execute_|approve_|propose_)/.test(c[0]))).toBe(false);
 });
 it("projects a safe schema, redacts synthetic secrets and excludes arbitrary attachment fields",async()=>{
  const store=createLocalWorkspaceStore(()=>invoke as NativeInvoke);await store.load();
  await store.save({...emptyWorkspace(),credential:"do-not-save",attachments:["raw"],chats:[{id:"chat-1",title:"test",projectLabel:"test",createdAt:1,archived:false,messages:[{role:"user",text:"sk-synthetic-not-a-real-key"}]}]} as Parameters<typeof store.save>[0]);
  expect(JSON.stringify(saved)).not.toContain("sk-synthetic");expect(JSON.stringify(saved)).not.toContain("credential");expect(JSON.stringify(saved)).not.toContain("attachments");
 });
 it("saves selected-task feedback only on explicit click and after its tool result",async()=>{
  const draft={input:"Synthetic request",projectId:null,modelId:"deepseek-flash",providerId:"deepseek",permissionMode:"request_approval" as const,reasoningEffort:"medium",runMode:"local" as const,branch:null,contextPercent:null};
  const task={id:"task-one",title:"Synthetic task",state:"completed" as const,draft,createdAt:1,updatedAt:4,completedAt:4,error:null};
  const events=[{id:"e1",taskId:task.id,type:"tool_completed" as const,title:"Tool result",body:"Synthetic result",createdAt:2,level:"info" as const},{id:"e2",taskId:task.id,type:"task_completed" as const,title:"Model result analysis completed",body:"Synthetic follow-up sk-short-canary",createdAt:3,level:"info" as const}];
  render(<UIProvider initialState={{thread:{activeThreadId:task.id},runtime:{tasksById:{[task.id]:task},eventsByTaskId:{[task.id]:events}}}}><LocalWorkspacePanel/></UIProvider>);
  await waitFor(()=>expect((screen.getByText(uiText("Save redacted conversation copy")) as HTMLButtonElement).disabled).toBe(false));expect(saved).toBeNull();fireEvent.click(screen.getByText(uiText("Save redacted conversation copy")));await waitFor(()=>expect(saved?.workspace.chats).toHaveLength(1));const messages=saved!.workspace.chats[0].messages;expect(messages.map(m=>m.role)).toEqual(["user","tool","assistant"]);expect(messages.at(-1)?.text).toContain("Synthetic follow-up");expect(JSON.stringify(saved)).not.toContain("sk-short-canary");expect(fetch).not.toHaveBeenCalled();
 });
 it("save failure blocks retries until reload, and missing acknowledgment never claims success",async()=>{
  const store=createLocalWorkspaceStore(()=>invoke as NativeInvoke);await store.load();failSave=true;await expect(store.save(emptyWorkspace())).rejects.toThrow();expect(store.getSnapshot().error).toContain("Reload");await expect(store.save(emptyWorkspace())).rejects.toThrow("not_ready");failSave=false;await store.load();await store.save(emptyWorkspace());expect(store.getSnapshot().record?.revision).toBe(1);
  const broken=createLocalWorkspaceStore(()=>(async()=>null) as NativeInvoke);await broken.load();await expect(broken.save(emptyWorkspace())).rejects.toThrow();expect(broken.getSnapshot().error).not.toBeNull();
 });
});
